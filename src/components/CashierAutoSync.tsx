import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore';
import { firebaseAuth, firestore, FIREBASE_BUSINESS_ID } from '../lib/firebase';
import { useBusinessAccess } from '../lib/businessAccess';
import { usePosStore, type Branch, type Category, type Product, type Sale, type StockBatch, type BranchStockShipment, type Expense } from '../store/usePosStore';
import type { CashierSettlementRecord } from '../types/finance';
import { publishAutoSyncStatus } from '../lib/autoSyncStatus';
import { recordFirestoreActivity } from '../lib/firestoreDiagnostics';
import { flushCashierSaleQueue, listenForCashierQueue } from '../lib/cashierSalesSync';
import { flushPendingCashierExpenses } from '../lib/cashierExpenseSync';

const listenOptions = { includeMetadataChanges: true } as const;

function decodeRecords<T extends { id: string; branchId?: string }>(snapshot: QuerySnapshot<DocumentData>, branchId: string): T[] {
  return snapshot.docs
    .filter((entry) => entry.data().deleted !== true)
    .map((entry) => {
      const data = entry.data();
      const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : data;
      return { ...payload, id: typeof payload.id === 'string' ? payload.id : entry.id, branchId } as T;
    });
}

function replaceBranchRecords<T extends { branchId?: string }>(current: T[], branchId: string, incoming: T[]): T[] {
  return [...current.filter((entry) => entry.branchId !== branchId), ...incoming];
}

/** Cashier-only catalog and own-sales listeners. Stock changes are committed with each sale transaction. */
export function CashierAutoSyncProvider() {
  const access = useBusinessAccess();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, setUser);
  }, []);

  useEffect(() => {
    const uid = user?.uid;
    const branchId = access.branchIds.length === 1 ? access.branchIds[0] : '';
    const isCashier = !!uid && access.status === 'active' && access.role === 'cashier' && access.uid === uid && !!branchId;
    if (!isCashier || !firestore) return;

    let disposed = false;
    let branch: Branch | null = null;
    let categories: Category[] = [];
    let products: Product[] = [];
    let stockBatches: StockBatch[] = [];
    let stockShipments: BranchStockShipment[] = [];
    const shipmentStatusById = new Map<string, BranchStockShipment['status']>();
    let shipmentServerBaselineReady = false;
    let sales: Sale[] = [];
    let ownExpenses: Expense[] = [];
    let ownSettlements: CashierSettlementRecord[] = [];
    const ready = new Set<string>();
    const firstServerSnapshot = new Set<string>();
    const unsubscribers: Array<() => void> = [];
    let queueFlushStarted = false;

    const applyToStore = () => {
      if (disposed) return;
      const current = usePosStore.getState();
      const branches = branch
        ? [...current.branches.filter((entry) => entry.id !== branchId), branch]
        : current.branches;
      const mergedSales = new Map<string, Sale>();
      current.sales.filter((entry) => entry.branchId === branchId && entry.createdByUid === uid).forEach((entry) => mergedSales.set(entry.id, entry));
      sales.forEach((entry) => mergedSales.set(entry.id, entry));
      const mergedOwnExpenses = new Map<string, Expense>();
      current.expenses
        .filter((entry) => entry.branchId === branchId && entry.createdByUid === uid && entry.cloudSyncStatus === 'pending')
        .forEach((entry) => mergedOwnExpenses.set(entry.id, entry));
      ownExpenses.forEach((entry) => mergedOwnExpenses.set(entry.id, { ...entry, cloudSyncStatus: 'synced', cloudSyncError: undefined }));
      const mergedOwnSettlements = new Map<string, CashierSettlementRecord>();
      current.cashierSettlements
        .filter((entry) => entry.cashierUid === uid && entry.branchId === branchId && entry.cloudSyncStatus === 'pending')
        .forEach((entry) => mergedOwnSettlements.set(entry.id, entry));
      ownSettlements.forEach((entry) => mergedOwnSettlements.set(entry.id, { ...entry, cloudSyncStatus: 'synced', cloudSyncError: undefined }));
      // Never retain another Cashier's private expense or settlement records on this device.
      const otherExpenses = current.expenses.filter((entry) => entry.createdByUid === uid && entry.branchId !== branchId);
      const otherSettlements = current.cashierSettlements.filter((entry) => entry.cashierUid === uid && entry.branchId !== branchId);
      current.importData({
        ...(branch ? { branches, activeBranchId: branchId } : {}),
        categories: replaceBranchRecords(current.categories, branchId, categories),
        products: replaceBranchRecords(current.products, branchId, products),
        stockBatches: replaceBranchRecords(current.stockBatches, branchId, stockBatches),
        expenses: [...otherExpenses, ...mergedOwnExpenses.values()],
        cashierSettlements: [...otherSettlements, ...mergedOwnSettlements.values()],
        ...(access.canReceiveStock ? { stockShipments: replaceBranchRecords(current.stockShipments, branchId, stockShipments) } : {}),
        sales: [
          ...current.sales.filter((entry) => entry.branchId !== branchId || entry.createdByUid !== uid),
          ...mergedSales.values(),
        ],
      });
    };

    const recordSnapshot = (key: string, size: number, changes: number, fromCache: boolean) => {
      if (fromCache) return;
      if (!firstServerSnapshot.has(key)) {
        recordFirestoreActivity(uid, 'read', `cashier-listener-initial:${key}`, size);
        firstServerSnapshot.add(key);
      } else if (changes > 0) {
        recordFirestoreActivity(uid, 'read', `cashier-listener-changes:${key}`, changes);
      }
      ready.add(key);
      const requiredReadyCount = access.canReceiveStock ? 8 : 7;
      if (ready.size >= requiredReadyCount) {
        publishAutoSyncStatus(uid, {
          state: 'synced',
          message: access.canReceiveStock
            ? `Cashier Cloud ချိတ်ဆက်ပြီးပါပြီ။ ${branch?.name || branchId} ၏ Product / Stock / မိမိ Sales / Expense / မိမိရရှိငွေစာရင်း နဲ့ ကုန်လက်ခံ Shipment ကို Sync လုပ်နေပါတယ်။`
            : `Cashier Cloud ချိတ်ဆက်ပြီးပါပြီ။ ${branch?.name || branchId} ၏ Product / Stock / မိမိ Sales / Expense / မိမိရရှိငွေစာရင်း ကို Sync လုပ်နေပါတယ်။ Stock Receiver ခွင့် မဖွင့်ထားပါ။`,
          savedAt: new Date().toISOString(),
        });
        if (!queueFlushStarted) {
          queueFlushStarted = true;
          void flushCashierSaleQueue(uid, branchId);
          void flushPendingCashierExpenses(uid, branchId);
        }
      }
    };

    const branchRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId);
    recordFirestoreActivity(uid, 'listenerStart', 'cashier-listener:branch', 1);
    const unsubscribeBranch = onSnapshot(branchRef, listenOptions, (snapshot) => {
      if (disposed) return;
      if (!snapshot.exists() || snapshot.data().deleted === true || !snapshot.data().payload) {
        publishAutoSyncStatus(uid, { state: 'error', message: `သတ်မှတ်ထားသော Branch ကို Cloud မှ မတွေ့ပါ: ${branchId}` });
        return;
      }
      branch = { ...(snapshot.data().payload as Branch), id: branchId };
      if (!snapshot.metadata.fromCache) recordSnapshot('branch', snapshot.exists() ? 1 : 0, 1, false);
      applyToStore();
    }, (error) => publishAutoSyncStatus(uid, {
      state: error.code === 'unavailable' ? 'offline' : 'error',
      message: error.code === 'permission-denied' ? 'Cashier Branch Read Permission မရပါ။ Firestore Rules ကို စစ်ဆေးပါ။' : error.message,
    }));
    unsubscribers.push(unsubscribeBranch);

    const attachCollection = <T extends { id: string; branchId?: string }>(kind: 'categories' | 'products' | 'stockBatches' | 'stockShipments', apply: (items: T[], serverConfirmed: boolean, changedIds: string[]) => void) => {
      const ref = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, kind);
      recordFirestoreActivity(uid, 'listenerStart', `cashier-listener:${kind}`, 1);
      const unsubscribe = onSnapshot(ref, listenOptions, (snapshot) => {
        if (disposed) return;
        const changed = snapshot.docChanges();
        apply(decodeRecords<T>(snapshot, branchId), !snapshot.metadata.fromCache, changed.map((change) => change.doc.id));
        if (!snapshot.metadata.fromCache) {
          const changes = changed.filter((change) => change.type === 'added' || change.type === 'modified').length;
          recordSnapshot(kind, snapshot.size, changes, false);
        }
        applyToStore();
      }, (error) => publishAutoSyncStatus(uid, {
        state: error.code === 'unavailable' ? 'offline' : 'error',
        message: error.code === 'permission-denied' ? (kind === 'stockShipments' ? 'ကုန်ပို့စာရင်းဖတ်ခွင့် မရပါ။ Owner က Team Access မှာ ဒီ Cashier အတွက် Stock Receiver ခွင့် ဖွင့်ထားပြီး Firestore Rules ကို နောက်ဆုံး Version အဖြစ် Publish လုပ်ထားကြောင်း စစ်ဆေးပါ။' : `Cashier ${kind} Read Permission မရပါ။ Firestore Rules ကို စစ်ဆေးပါ။`) : error.message,
      }));
      unsubscribers.push(unsubscribe);
    };

    attachCollection<Category>('categories', (items) => { categories = items; });
    attachCollection<Product>('products', (items) => { products = items; });
    attachCollection<StockBatch>('stockBatches', (items) => { stockBatches = items; });
    if (access.canReceiveStock) {
      attachCollection<BranchStockShipment>('stockShipments', (items, serverConfirmed, changedIds) => {
        stockShipments = items.filter((shipment) => shipment.toBranchId === branchId);
        if (!serverConfirmed) return;
        // The first server snapshot is the baseline, not a new-arrival event.
        // Notify only when a shipment becomes dispatched after that baseline.
        const byId = new Map(stockShipments.map((shipment) => [shipment.id, shipment]));
        let arriving: BranchStockShipment[] = [];
        if (!shipmentServerBaselineReady) {
          // Pending shipments already waiting when the cashier signs in must
          // also surface as a notification; they are not silently skipped.
          arriving = stockShipments.filter((shipment) => shipment.status === 'dispatched');
          stockShipments.forEach((shipment) => shipmentStatusById.set(shipment.id, shipment.status));
          shipmentServerBaselineReady = true;
        } else {
          arriving = changedIds
            .map((id) => byId.get(id))
            .filter((shipment): shipment is BranchStockShipment => {
              if (!shipment || shipment.status !== 'dispatched') return false;
              return shipmentStatusById.get(shipment.id) !== 'dispatched';
            });
          stockShipments.forEach((shipment) => shipmentStatusById.set(shipment.id, shipment.status));
        }
        if (arriving.length) {
          window.dispatchEvent(new CustomEvent('minimart-branch-shipment-notification', {
            detail: {
              count: arriving.length,
              shipmentNos: arriving.slice(0, 5).map((shipment) => shipment.shipmentNo),
              fromBranchName: arriving[0]?.fromBranchName || '',
            },
          }));
        }
      });
    }

    const ownExpensesQuery = query(
      collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'expenses'),
      where('payload.createdByUid', '==', uid),
      limit(100),
    );
    recordFirestoreActivity(uid, 'listenerStart', 'cashier-listener:own-expenses', 1);
    const unsubscribeExpenses = onSnapshot(ownExpensesQuery, listenOptions, (snapshot) => {
      if (disposed) return;
      ownExpenses = decodeRecords<Expense>(snapshot, branchId).map((expense) => ({ ...expense, cloudSyncStatus: 'synced', cloudSyncError: undefined }));
      if (!snapshot.metadata.fromCache) {
        const changes = snapshot.docChanges().filter((change) => change.type === 'added' || change.type === 'modified').length;
        recordSnapshot('own-expenses', snapshot.size, changes, false);
      }
      applyToStore();
    }, (error) => publishAutoSyncStatus(uid, {
      state: error.code === 'unavailable' ? 'offline' : 'error',
      message: error.code === 'permission-denied' ? 'မိမိ၏ Expense ကို Cloud မှ ဖတ်ခွင့်မရပါ။ Firestore Rules အသစ်ကို Publish လုပ်ထားကြောင်း စစ်ဆေးပါ။' : error.message,
    }));
    unsubscribers.push(unsubscribeExpenses);

    const ownSettlementsQuery = query(
      collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'cashierSettlements'),
      where('payload.cashierUid', '==', uid),
      limit(100),
    );
    recordFirestoreActivity(uid, 'listenerStart', 'cashier-listener:own-settlements', 1);
    const unsubscribeSettlements = onSnapshot(ownSettlementsQuery, listenOptions, (snapshot) => {
      if (disposed) return;
      ownSettlements = decodeRecords<CashierSettlementRecord>(snapshot, branchId);
      if (!snapshot.metadata.fromCache) {
        const changes = snapshot.docChanges().filter((change) => change.type === 'added' || change.type === 'modified').length;
        recordSnapshot('own-settlements', snapshot.size, changes, false);
      }
      applyToStore();
    }, (error) => publishAutoSyncStatus(uid, {
      state: error.code === 'unavailable' ? 'offline' : 'error',
      message: error.code === 'permission-denied'
        ? 'မိမိရရှိငွေစာရင်း ဖတ်ခွင့်မရပါ။ Firestore Rules ထဲက cashierSettlements Read Rule ကို Publish လုပ်ထားကြောင်း စစ်ဆေးပါ။'
        : error.message,
    }));
    unsubscribers.push(unsubscribeSettlements);

    const ownSalesQuery = query(
      collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'sales'),
      where('payload.createdByUid', '==', uid),
      limit(100),
    );
    recordFirestoreActivity(uid, 'listenerStart', 'cashier-listener:own-sales', 1);
    const unsubscribeSales = onSnapshot(ownSalesQuery, listenOptions, (snapshot) => {
      if (disposed) return;
      sales = decodeRecords<Sale>(snapshot, branchId).sort((a, b) => b.date.localeCompare(a.date));
      if (!snapshot.metadata.fromCache) {
        const changes = snapshot.docChanges().filter((change) => change.type === 'added' || change.type === 'modified').length;
        recordSnapshot('own-sales', snapshot.size, changes, false);
      }
      applyToStore();
    }, (error) => publishAutoSyncStatus(uid, {
      state: error.code === 'unavailable' ? 'offline' : 'error',
      message: error.code === 'permission-denied' ? 'မိမိရဲ့ Sales History ကို ဖတ်ခွင့်မရပါ။ Cashier Sales Rules ကို စစ်ဆေးပါ။' : error.message,
    }));
    unsubscribers.push(unsubscribeSales);

    const onOnline = () => { void flushCashierSaleQueue(uid, branchId); void flushPendingCashierExpenses(uid, branchId); };
    window.addEventListener('online', onOnline);
    const unlistenQueue = listenForCashierQueue(uid, branchId, () => { void flushCashierSaleQueue(uid, branchId); });

    publishAutoSyncStatus(uid, { state: 'connecting', message: access.canReceiveStock ? 'Cashier Catalog / Stock / မိမိ Sales / Expense / ရရှိငွေစာရင်း / ကုန်ပို့လက်ခံစာရင်းကို Cloud မှ ချိတ်ဆက်နေပါတယ်။' : 'Cashier အတွက် Branch Catalog / Stock / မိမိ Sales / Expense / ရရှိငွေစာရင်းကို Cloud မှ ချိတ်ဆက်နေပါတယ်။ Stock Receiver ခွင့် မဖွင့်ထားပါ။' });

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unlistenQueue();
      window.removeEventListener('online', onOnline);
    };
  }, [user?.uid, access.status, access.role, access.uid, access.branchIds.join('|'), access.canReceiveStock]);

  return null;
}
