import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
  type QuerySnapshot,
} from 'firebase/firestore';
import { firebaseAuth, firestore, FIREBASE_BUSINESS_ID } from '../lib/firebase';
import { useBusinessAccess } from '../lib/businessAccess';
import {
  usePosStore,
  type Branch,
  type CashMovement,
  type CashShift,
  type Category,
  type Customer,
  type CustomerPayment,
  type Expense,
  type Product,
  type Sale,
  type StockBatch,
  type StockUnitRegistry,
  type BranchStockShipment,
} from '../store/usePosStore';
import type { CashierSettlementRecord } from '../types/finance';
import { publishAutoSyncStatus } from '../lib/autoSyncStatus';
import { recordFirestoreActivity } from '../lib/firestoreDiagnostics';
import { flushCashierSaleQueue, listenForCashierQueue, recoverPendingCashierSales } from '../lib/cashierSalesSync';
import { mergeCashierUnitRegistries } from '../lib/cashierUnitRegistryMerge';
import { flushPendingCashierExpenses } from '../lib/cashierExpenseSync';
import {
  clearCashierCursors,
  incrementalCursorQueryStart,
  mergeById,
  nextCashierCursor,
  readCashierCursor,
  saveCashierCursor,
  shouldUseIncrementalCursor,
  type CashierCursorKind,
} from '../lib/cashierSyncCursor';
import { isLocalDataResetPending } from '../lib/syncSafety';
import {
  enqueueCashierCustomerPayment,
  enqueueCashierMovement,
  enqueueCashierShift,
  flushCashierCashQueue,
  listenForCashierCashQueue,
  listenForCashierCashStatus,
  recoverPendingCashierCash,
} from '../lib/cashierCashSync';

const listenOptions = { includeMetadataChanges: true } as const;
const SESSION_UID_KEY = 'minimart-active-session-uid-v1';

function decodeRecords<T extends { id: string; branchId?: string }>(snapshot: QuerySnapshot<DocumentData>, branchId?: string): T[] {
  return snapshot.docs
    .filter((entry) => entry.data().deleted !== true)
    .map((entry) => {
      const data = entry.data();
      const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : data;
      return {
        ...payload,
        id: typeof payload.id === 'string' ? payload.id : entry.id,
        ...(branchId ? { branchId } : {}),
      } as T;
    });
}

function replaceBranchRecords<T extends { branchId?: string }>(current: T[], branchId: string, incoming: T[]): T[] {
  return [...current.filter((entry) => entry.branchId !== branchId), ...incoming];
}

/** Cashier-only catalog, shifts, customer credit, and own-sales listeners. */
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

    // Prevent data leak if an Owner or another Cashier previously signed in on this browser.
    try {
      const previousUid = localStorage.getItem(SESSION_UID_KEY);
      if (previousUid && previousUid !== uid) {
        usePosStore.getState().clearAllData();
      }
      localStorage.setItem(SESSION_UID_KEY, uid);
    } catch { /* ignore storage errors */ }

    let disposed = false;
    let applyingRemote = false;
    let branch: Branch | null = null;
    let categories: Category[] = [];
    let products: Product[] = [];
    let stockBatches: StockBatch[] = [];
    let stockUnitRegistries: StockUnitRegistry[] = [];
    let stockShipments: BranchStockShipment[] = [];
    let cashShifts: CashShift[] = [];
    let cashMovements: CashMovement[] = [];
    let customerPayments: CustomerPayment[] = [];
    let sharedCustomers: Customer[] | null = null;
    const shipmentStatusById = new Map<string, BranchStockShipment['status']>();
    let shipmentServerBaselineReady = false;
    let sales: Sale[] = [];
    let ownExpenses: Expense[] = [];
    let ownSettlements: CashierSettlementRecord[] = [];
    const ready = new Set<string>();
    const firstServerSnapshot = new Set<string>();
    const unsubscribers: Array<() => void> = [];
    let queueFlushStarted = false;
    const cashQueueError = (error: unknown) => publishAutoSyncStatus(uid, {
      state: 'error', message: error instanceof Error ? error.message : 'Cash Record ကို Offline Queue ထဲ မသိမ်းနိုင်ပါ။ Browser Storage ကို စစ်ဆေးပါ။',
    });
    const flushCash = () => {
      void flushCashierCashQueue(uid, branchId).catch(cashQueueError);
    };

    const applyToStore = () => {
      if (disposed) return;
      applyingRemote = true;
      try {
        const current = usePosStore.getState();
        const branches = branch
          ? [...current.branches.filter((entry) => entry.id !== branchId), branch]
          : current.branches;
        const mergedSales = new Map<string, Sale>();
        // Retain local own sales so recent sales never disappear even if a >100 query limit truncates older server docs.
        current.sales
          .filter((entry) => entry.branchId === branchId && entry.createdByUid === uid)
          .forEach((entry) => mergedSales.set(entry.id, entry));
        sales.forEach((entry) => mergedSales.set(entry.id, { ...entry, cloudSyncStatus: 'synced', cloudSyncError: undefined }));

        const mergedOwnExpenses = new Map<string, Expense>();
        current.expenses
          .filter((entry) => entry.branchId === branchId && entry.createdByUid === uid)
          .forEach((entry) => mergedOwnExpenses.set(entry.id, entry));
        ownExpenses.forEach((entry) => mergedOwnExpenses.set(entry.id, { ...entry, cloudSyncStatus: 'synced', cloudSyncError: undefined }));

        const mergedOwnSettlements = new Map<string, CashierSettlementRecord>();
        current.cashierSettlements
          .filter((entry) => entry.cashierUid === uid && entry.branchId === branchId)
          .forEach((entry) => mergedOwnSettlements.set(entry.id, entry));
        ownSettlements.forEach((entry) => mergedOwnSettlements.set(entry.id, { ...entry, cloudSyncStatus: 'synced', cloudSyncError: undefined }));

        // Incremental listeners deliver only changed records, so always union with
        // the persisted dataset; shift totals and the shared ledger stay complete.
        const mergedShifts = mergeById(current.cashShifts.filter((entry) => entry.branchId === branchId), cashShifts);
        const mergedMovements = mergeById(current.cashMovements.filter((entry) => entry.branchId === branchId), cashMovements);
        const mergedPayments = mergeById(current.customerPayments.filter((entry) => entry.branchId === branchId), customerPayments);

        const mergedCustomers = new Map<string, Customer>();
        current.customers.forEach((entry) => mergedCustomers.set(entry.id, entry));
        (sharedCustomers || []).forEach((entry) => mergedCustomers.set(entry.id, entry));

        current.importData({
          ...(branch ? { branches, activeBranchId: branchId } : {}),
          categories: replaceBranchRecords(current.categories, branchId, categories),
          products: replaceBranchRecords(current.products, branchId, products),
          stockBatches: replaceBranchRecords(current.stockBatches, branchId, stockBatches),
          stockUnitRegistries: mergeCashierUnitRegistries(current.stockUnitRegistries, stockUnitRegistries, branchId, current.sales),
          expenses: [...mergedOwnExpenses.values()].sort((a, b) => b.date.localeCompare(a.date)),
          cashierSettlements: [...mergedOwnSettlements.values()],
          cashShifts: mergedShifts,
          cashMovements: mergedMovements,
          customerPayments: mergedPayments,
          customers: [...mergedCustomers.values()],
          ...(access.canReceiveStock ? { stockShipments: replaceBranchRecords(current.stockShipments, branchId, stockShipments) } : {}),
          sales: [...mergedSales.values()].sort((a, b) => b.date.localeCompare(a.date)),
        });
      } finally {
        applyingRemote = false;
      }
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
      const requiredReadyCount = access.canReceiveStock ? 9 : 8;
      if (ready.size >= requiredReadyCount) {
        publishAutoSyncStatus(uid, {
          state: 'synced',
          message: access.canReceiveStock
            ? `Cashier Cloud ချိတ်ဆက်ပြီးပါပြီ။ ${branch?.name || branchId} ၏ Product / Stock / မိမိ Sales / Expense / Shift နဲ့ ကုန်လက်ခံ Shipment ကို Sync လုပ်နေပါတယ်။`
            : `Cashier Cloud ချိတ်ဆက်ပြီးပါပြီ။ ${branch?.name || branchId} ၏ Product / Stock / မိမိ Sales / Expense / Shift ကို Sync လုပ်နေပါတယ်။`,
          savedAt: new Date().toISOString(),
        });
        if (!queueFlushStarted) {
          queueFlushStarted = true;
          void recoverPendingCashierSales(usePosStore.getState().sales, uid, branchId)
            .then(() => flushCashierSaleQueue(uid, branchId))
            .catch((error) => publishAutoSyncStatus(uid, {
              state: 'error', message: error instanceof Error ? error.message : 'Offline Sale Queue ကို ပြန်လည်ရယူမရပါ။',
            }));
          void flushPendingCashierExpenses(uid, branchId);
          void recoverPendingCashierCash(uid, branchId).then(flushCash).catch(cashQueueError);
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

    // A pending local reset replaces the dataset, so the old cursors no longer
    // describe local history. Replay full snapshots for every collection.
    const resetPending = isLocalDataResetPending();
    if (resetPending) clearCashierCursors(FIREBASE_BUSINESS_ID, uid);

    const attachCollection = <T extends { id: string; branchId?: string }>(
      kind: 'categories' | 'products' | 'stockBatches' | 'stockUnitRegistries' | 'stockShipments' | 'cashShifts' | 'cashMovements' | 'customerPayments',
      apply: (items: T[], serverConfirmed: boolean, changedIds: string[]) => void,
      optional = false,
      cursorKind?: CashierCursorKind,
    ) => {
      const collectionRef = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, kind);
      const localRecords: Array<{ branchId?: string }> = cursorKind === 'cashShifts'
        ? usePosStore.getState().cashShifts
        : cursorKind === 'cashMovements'
          ? usePosStore.getState().cashMovements
          : cursorKind === 'customerPayments'
            ? usePosStore.getState().customerPayments
            : [];
      const storedCursor = cursorKind ? readCashierCursor(FIREBASE_BUSINESS_ID, uid, branchId, cursorKind) : null;
      const localRecordCount = localRecords.filter((entry) => entry.branchId === branchId).length;
      const incremental = !!cursorKind && shouldUseIncrementalCursor({
        cursor: storedCursor,
        localRecordCount,
        resetPending,
        hydrated: usePosStore.persist.hasHydrated(),
      });
      const ref = incremental && storedCursor
        ? query(collectionRef, where('updatedAt', '>=', incrementalCursorQueryStart(storedCursor)))
        : collectionRef;
      recordFirestoreActivity(uid, 'listenerStart', `cashier-listener:${kind}`, 1);
      const unsubscribe = onSnapshot(ref, listenOptions, (snapshot) => {
        if (disposed) return;
        const changed = snapshot.docChanges();
        apply(decodeRecords<T>(snapshot, branchId), !snapshot.metadata.fromCache, changed.map((change) => change.doc.id));
        if (!snapshot.metadata.fromCache && cursorKind) {
          const nextCursor = nextCashierCursor(storedCursor, snapshot.docs.map((record) => {
            const updatedAt = record.get('updatedAt');
            return typeof updatedAt === 'string' ? updatedAt : null;
          }));
          if (nextCursor) saveCashierCursor(FIREBASE_BUSINESS_ID, uid, branchId, cursorKind, nextCursor);
        }
        if (!snapshot.metadata.fromCache && !optional) {
          const changes = changed.filter((change) => change.type === 'added' || change.type === 'modified').length;
          recordSnapshot(kind, snapshot.size, changes, false);
        }
        applyToStore();
      }, (error) => {
        if (optional) return;
        publishAutoSyncStatus(uid, {
          state: error.code === 'unavailable' ? 'offline' : 'error',
          message: error.code === 'permission-denied'
            ? (kind === 'stockShipments'
              ? 'ကုန်ပို့စာရင်းဖတ်ခွင့် မရပါ။ Owner က Team Access မှာ ဒီ Cashier အတွက် Stock Receiver ခွင့် ဖွင့်ထားပြီး Firestore Rules ကို နောက်ဆုံး Version အဖြစ် Publish လုပ်ထားကြောင်း စစ်ဆေးပါ။'
              : `Cashier ${kind} Read Permission မရပါ။ Firestore Rules ကို စစ်ဆေးပါ။`)
            : error.message,
        });
      });
      unsubscribers.push(unsubscribe);
    };

    attachCollection<Category>('categories', (items) => { categories = items; });
    attachCollection<Product>('products', (items) => { products = items; });
    attachCollection<StockBatch>('stockBatches', (items) => { stockBatches = items; });
    attachCollection<StockUnitRegistry>('stockUnitRegistries', (items) => { stockUnitRegistries = items; });
    attachCollection<CashShift>('cashShifts', (items) => { cashShifts = items; }, true, 'cashShifts');
    attachCollection<CashMovement>('cashMovements', (items) => { cashMovements = items; }, true, 'cashMovements');
    attachCollection<CustomerPayment>('customerPayments', (items) => { customerPayments = items; }, true, 'customerPayments');

    // Optional listener for shared customers so Cashier POS & Customer Credit pages stay in sync.
    const sharedCustomersRef = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'shared', 'customers', 'records');
    const unsubscribeCustomers = onSnapshot(sharedCustomersRef, listenOptions, (snapshot) => {
      if (disposed) return;
      sharedCustomers = decodeRecords<Customer>(snapshot);
      applyToStore();
    }, () => { /* Ignore if older rules without Cashier customer list permission are still deployed */ });
    unsubscribers.push(unsubscribeCustomers);

    if (access.canReceiveStock) {
      attachCollection<BranchStockShipment>('stockShipments', (items, serverConfirmed, changedIds) => {
        stockShipments = items.filter((shipment) => shipment.toBranchId === branchId);
        if (!serverConfirmed) return;
        const byId = new Map(stockShipments.map((shipment) => [shipment.id, shipment]));
        let arriving: BranchStockShipment[] = [];
        if (!shipmentServerBaselineReady) {
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

    // Own-record lists are ordered newest-first so the 100-document bound keeps
    // recent history instead of an arbitrary document-ID slice. The ordering
    // needs a composite index; until it is deployed the listener falls back to
    // the legacy unordered query rather than losing sync entirely.
    const attachOwnRecords = <T extends { id: string; branchId?: string }>(
      kind: 'sales' | 'expenses' | 'cashierSettlements',
      filterField: 'payload.createdByUid' | 'payload.cashierUid',
      orderField: string,
      readyKey: string,
      apply: (items: T[]) => void,
      permissionMessage: string,
    ) => {
      let activeUnsubscribe: (() => void) | null = null;
      let usedFallback = false;
      const attach = (ordered: boolean) => {
        const constraints: QueryConstraint[] = [where(filterField, '==', uid)];
        if (ordered) constraints.push(orderBy(orderField, 'desc'));
        constraints.push(limit(100));
        activeUnsubscribe = onSnapshot(
          query(collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, kind), ...constraints),
          listenOptions,
          (snapshot) => {
            if (disposed) return;
            apply(decodeRecords<T>(snapshot, branchId));
            if (!snapshot.metadata.fromCache) {
              const changes = snapshot.docChanges().filter((change) => change.type === 'added' || change.type === 'modified').length;
              recordSnapshot(readyKey, snapshot.size, changes, false);
            }
            applyToStore();
          },
          (error) => {
            if (ordered && !usedFallback && error.code === 'failed-precondition') {
              usedFallback = true;
              activeUnsubscribe?.();
              recordFirestoreActivity(uid, 'listenerStart', `cashier-listener:${readyKey}-unordered-fallback`, 1);
              attach(false);
              return;
            }
            publishAutoSyncStatus(uid, {
              state: error.code === 'unavailable' ? 'offline' : 'error',
              message: error.code === 'permission-denied' ? permissionMessage : error.message,
            });
          },
        );
        unsubscribers.push(activeUnsubscribe);
      };
      recordFirestoreActivity(uid, 'listenerStart', `cashier-listener:${readyKey}`, 1);
      attach(true);
    };

    attachOwnRecords<Expense>(
      'expenses', 'payload.createdByUid', 'payload.date', 'own-expenses',
      (items) => { ownExpenses = items.map((expense) => ({ ...expense, cloudSyncStatus: 'synced', cloudSyncError: undefined })); },
      'မိမိ၏ Expense ကို Cloud မှ ဖတ်ခွင့်မရပါ။ Firestore Rules အသစ်ကို Publish လုပ်ထားကြောင်း စစ်ဆေးပါ။',
    );
    attachOwnRecords<CashierSettlementRecord>(
      'cashierSettlements', 'payload.cashierUid', 'payload.createdAt', 'own-settlements',
      (items) => { ownSettlements = items; },
      'မိမိရရှိငွေစာရင်း ဖတ်ခွင့်မရပါ။ Firestore Rules ထဲက cashierSettlements Read Rule ကို Publish လုပ်ထားကြောင်း စစ်ဆေးပါ။',
    );
    attachOwnRecords<Sale>(
      'sales', 'payload.createdByUid', 'payload.date', 'own-sales',
      (items) => { sales = [...items].sort((a, b) => b.date.localeCompare(a.date)); },
      'မိမိရဲ့ Sales History ကို ဖတ်ခွင့်မရပါ။ Cashier Sales Rules ကို စစ်ဆေးပါ။',
    );

    // Queue Cashier-created Cash Shift, Cash Movement, and Customer Credit Payment
    // records in IndexedDB first, then flush them in FIFO order. Offline records are
    // therefore never lost when the browser closes before the network returns.
    const unsubscribeStore = usePosStore.subscribe((state, prev) => {
      if (applyingRemote) return;
      const online = typeof navigator === 'undefined' || navigator.onLine;
      const afterEnqueue = () => { if (online) flushCash(); };
      if (state.cashShifts !== prev.cashShifts) {
        const prevMap = new Map(prev.cashShifts.map((s) => [s.id, s]));
        state.cashShifts.filter((s) => s.branchId === branchId && s !== prevMap.get(s.id)).forEach((shift) => {
          if (prevMap.get(shift.id)?.closedAt === shift.closedAt) return;
          void enqueueCashierShift(shift, uid, branchId).then(afterEnqueue).catch(cashQueueError);
        });
      }
      if (state.cashMovements !== prev.cashMovements) {
        const prevIds = new Set(prev.cashMovements.map((m) => m.id));
        state.cashMovements.filter((m) => m.branchId === branchId && !prevIds.has(m.id)).forEach((movement) => {
          void enqueueCashierMovement(movement, uid, branchId).then(afterEnqueue).catch(cashQueueError);
        });
      }
      if (state.customerPayments !== prev.customerPayments) {
        const prevIds = new Set(prev.customerPayments.map((p) => p.id));
        state.customerPayments.filter((p) => p.branchId === branchId && !prevIds.has(p.id)).forEach((payment) => {
          const sale = state.sales.find((entry) => entry.id === payment.saleId && entry.branchId === branchId);
          if (!sale || sale.paymentMethod !== 'Credit') return;
          const settlement = {
            saleId: sale.id,
            paidAmount: sale.paidAmount ?? 0,
            dueAmount: sale.dueAmount ?? Math.max(0, sale.total - (sale.paidAmount ?? 0)),
          };
          void enqueueCashierCustomerPayment(payment, uid, branchId, settlement).then(afterEnqueue).catch(cashQueueError);
        });
      }
    });
    unsubscribers.push(unsubscribeStore);

    const onOnline = () => {
      void recoverPendingCashierSales(usePosStore.getState().sales, uid, branchId)
        .then(() => flushCashierSaleQueue(uid, branchId))
        .catch((error) => publishAutoSyncStatus(uid, {
          state: 'error', message: error instanceof Error ? error.message : 'Offline Sale Queue ကို Sync မလုပ်နိုင်ပါ။',
        }));
      void flushPendingCashierExpenses(uid, branchId);
      flushCash();
    };
    const onManualSyncRequested = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        publishAutoSyncStatus(uid, {
          state: 'offline',
          message: 'Internet မချိတ်ဆက်ရသေးပါ။ Local Cache Data ကို ပြသထားပါတယ်။',
        });
        return;
      }
      publishAutoSyncStatus(uid, {
        state: 'connecting',
        message: 'Cashier Cloud Sync ကို ပြန်လည်စစ်ဆေးနေပါတယ်။',
      });
      onOnline();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('minimart-cloud-sync-requested', onManualSyncRequested);
    const unlistenQueue = listenForCashierQueue(uid, branchId, () => {
      void flushCashierSaleQueue(uid, branchId).catch((error) => publishAutoSyncStatus(uid, {
        state: 'error', message: error instanceof Error ? error.message : 'Offline Sale Queue ကို ဖတ်မရပါ။',
      }));
    });
    const unlistenCashQueue = listenForCashierCashQueue(uid, branchId, flushCash);
    const unlistenCashStatus = listenForCashierCashStatus(uid, (state, message, detail) => {
      if (detail.branchId !== branchId) return;
      if (state === 'review' || state === 'rules-error' || state === 'error') {
        publishAutoSyncStatus(uid, {
          state: 'error',
          message: `${message}${detail.recordId ? ` · ${detail.recordId}` : ''}`,
        });
      }
    });
    const onSaleQueueStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; branchId?: string; saleId?: string; state?: string; message?: string }>).detail;
      if (detail?.uid !== uid || detail.branchId !== branchId || !detail.saleId) return;
      if (detail.state === 'synced') usePosStore.getState().updateSaleCloudSyncStatus(detail.saleId, branchId, 'synced');
      else if (detail.state === 'review' || detail.state === 'rules-error' || detail.state === 'error') {
        usePosStore.getState().updateSaleCloudSyncStatus(detail.saleId, branchId, 'pending', detail.message || 'Cloud Sync စောင့်နေပါတယ်။');
      }
    };
    window.addEventListener('minimart-cashier-sale-status', onSaleQueueStatus);

    publishAutoSyncStatus(uid, {
      state: 'connecting',
      message: access.canReceiveStock
        ? 'Cashier Catalog / Stock / မိမိ Sales / Expense / Shift / ကုန်ပို့လက်ခံစာရင်းကို Cloud မှ ချိတ်ဆက်နေပါတယ်။'
        : 'Cashier အတွက် Branch Catalog / Stock / မိမိ Sales / Expense / Shift ကို Cloud မှ ချိတ်ဆက်နေပါတယ်။',
    });

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unlistenQueue();
      unlistenCashQueue();
      unlistenCashStatus();
      window.removeEventListener('minimart-cashier-sale-status', onSaleQueueStatus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('minimart-cloud-sync-requested', onManualSyncRequested);
    };
  }, [user?.uid, access.status, access.role, access.uid, access.branchIds.join('|'), access.canReceiveStock]);

  return null;
}
