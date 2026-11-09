import {
  doc,
  runTransaction,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { firebaseConfig, firestore, FIREBASE_BUSINESS_ID } from './firebase';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import { cleanQuantity, quantityModeForProduct } from './quantity';
import { readDurableValue, writeDurableValue, removeDurableValue } from './persistentStateStorage';
import type { Product, Sale } from '../store/usePosStore';

export type CashierSaleQueueEntry = {
  sale: Sale;
  uid: string;
  branchId: string;
  queuedAt: string;
  attempts: number;
  needsReview?: boolean;
  lastError?: string;
};

export type CashierSaleCommitResult = 'created' | 'already-committed';

const QUEUE_PREFIX = 'minimart-cashier-sale-queue-v2';
const LEGACY_QUEUE_PREFIX = 'minimart-cashier-sale-queue-v1';
const QUEUE_EVENT = 'minimart-cashier-sale-queued';
const QUEUE_STATUS_EVENT = 'minimart-cashier-sale-status';
type FlushResult = { synced: number; pending: number; needsReview: number; rulesError: boolean };
const activeFlushes = new Map<string, Promise<FlushResult>>();
const queueLocks = new Map<string, Promise<void>>();

/** Serialize queue read/modify/write cycles within and, where supported, across tabs. */
async function withQueueLock<T>(uid: string, branchId: string, operation: () => Promise<T>): Promise<T> {
  const key = `${firebaseConfig.projectId}:${FIREBASE_BUSINESS_ID}:${uid}:${branchId}`;
  const runInProcess = async () => {
    const previous = queueLocks.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const settled = current.then(() => undefined, () => undefined);
    queueLocks.set(key, settled);
    try {
      return await current;
    } finally {
      if (queueLocks.get(key) === settled) queueLocks.delete(key);
    }
  };

  const lockManager = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: { request<R>(name: string, callback: () => Promise<R>): Promise<R> } }).locks
    : undefined;
  if (lockManager?.request) return lockManager.request(`minimart-cashier-queue:${key}`, runInProcess);
  return runInProcess();
}

function queueKey(uid: string, branchId: string): string {
  return `${QUEUE_PREFIX}:${firebaseConfig.projectId}:${FIREBASE_BUSINESS_ID}:${uid}:${branchId}`;
}

function legacyQueueKey(uid: string, branchId: string): string {
  return `${LEGACY_QUEUE_PREFIX}:${firebaseConfig.projectId}:${FIREBASE_BUSINESS_ID}:${uid}:${branchId}`;
}

function parseQueue(value: unknown): CashierSaleQueueEntry[] {
  if (!Array.isArray(value)) throw new Error('Cashier Offline Queue ပုံစံ မမှန်ပါ။ Data ကို မဖျက်ဘဲ ရပ်ထားပါတယ်။');
  const invalid = value.find((entry) => {
    if (!entry || typeof entry !== 'object') return true;
    const candidate = entry as Partial<CashierSaleQueueEntry>;
    return !candidate.sale || typeof candidate.sale.id !== 'string'
      || typeof candidate.uid !== 'string' || typeof candidate.branchId !== 'string'
      || !Array.isArray(candidate.sale.items);
  });
  if (invalid) throw new Error('Cashier Offline Queue ထဲမှာ ဖတ်မရသော Sale တစ်ခုရှိနေပါတယ်။ မူရင်း Data ကို မဖျက်ထားပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
  return value as CashierSaleQueueEntry[];
}

async function readCashierSaleQueueInternal(uid: string, branchId: string): Promise<CashierSaleQueueEntry[]> {
  const currentKey = queueKey(uid, branchId);
  const current = await readDurableValue(currentKey);
  if (current !== null) {
    const queue = parseQueue(JSON.parse(current));
    if (queue.some((entry) => entry.uid !== uid || entry.branchId !== branchId
      || entry.sale.createdByUid !== uid || entry.sale.branchId !== branchId)) {
      throw new Error('Offline Queue ထဲရှိ UID / Branch မကိုက်ညီပါ။ Data ကို မဖျက်ဘဲ ရပ်ထားပါတယ်။');
    }
    return queue;
  }

  // Non-destructive migration from the v1 LocalStorage queue to IndexedDB v2.
  const legacyKey = legacyQueueKey(uid, branchId);
  const legacy = await readDurableValue(legacyKey);
  if (legacy === null) return [];
  const parsed = parseQueue(JSON.parse(legacy));
  if (parsed.some((entry) => entry.uid !== uid || entry.branchId !== branchId
    || entry.sale.createdByUid !== uid || entry.sale.branchId !== branchId)) {
    throw new Error('Legacy Offline Queue UID / Branch မကိုက်ညီပါ။ မူရင်း Queue ကို မဖျက်ထားပါ။');
  }
  await writeDurableValue(currentKey, JSON.stringify(parsed));
  await removeDurableValue(legacyKey);
  return parsed;
}

export async function readCashierSaleQueue(uid: string, branchId: string): Promise<CashierSaleQueueEntry[]> {
  return withQueueLock(uid, branchId, () => readCashierSaleQueueInternal(uid, branchId));
}

async function saveQueue(uid: string, branchId: string, queue: CashierSaleQueueEntry[]): Promise<void> {
  const key = queueKey(uid, branchId);
  if (queue.length) await writeDurableValue(key, JSON.stringify(queue));
  else await removeDurableValue(key);
}

function emitStatus(uid: string, branchId: string, state: 'synced' | 'queued' | 'review' | 'error' | 'rules-error', message: string, saleId?: string): void {
  try {
    window.dispatchEvent(new CustomEvent(QUEUE_STATUS_EVENT, { detail: { uid, branchId, state, message, ...(saleId ? { saleId } : {}) } }));
  } catch {
    // UI notification is optional.
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
}

function userFacingError(error: unknown): string {
  const code = errorCode(error);
  if (code === 'permission-denied') return 'Cashier Sales / Stock Rules ကို Firebase မှ ခွင့်မပြုပါ။ Firestore Rules ကို နောက်ဆုံး Version အတိုင်း Publish လုပ်ထားကြောင်း စစ်ပါ။';
  if (code === 'failed-precondition') return error instanceof Error ? error.message : 'Cloud Stock ပြောင်းလဲသွားသောကြောင့် အရောင်းကို အတည်မပြုနိုင်ပါ။';
  if (code === 'resource-exhausted') return 'Firebase Usage Quota ပြည့်နေသောကြောင့် Cloud သို့ မပို့နိုင်သေးပါ။ Sale ကို Local Queue ထဲ ထိန်းထားပါတယ်။';
  if (code === 'unavailable' || code === 'deadline-exceeded' || !navigator.onLine) return 'Internet မရှိသေးပါ။ အရောင်းကို ဒီ Device မှာ သိမ်းထားပြီး ပြန်ချိတ်မိလျှင် ပို့ပါမယ်။';
  return error instanceof Error ? error.message : 'Cashier Sale ကို Cloud သို့ မပို့နိုင်သေးပါ။';
}

function saleFingerprint(sale: Sale): string {
  const normalized = {
    id: sale.id, branchId: sale.branchId || '', receiptNo: sale.receiptNo, date: sale.date,
    customer: sale.customer, customerId: sale.customerId || '', paymentMethod: sale.paymentMethod,
    cashReceivedAmount: sale.cashReceivedAmount ?? null, kpayTransactionReference: sale.kpayTransactionReference || '',
    changeAmount: sale.changeAmount ?? null, paidAmount: sale.paidAmount ?? null, dueAmount: sale.dueAmount ?? null,
    subtotal: sale.subtotal, discount: sale.discount, total: sale.total, profit: sale.profit, status: sale.status,
    createdByUid: sale.createdByUid || '',
    items: sale.items.map((item) => ({
      productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, costPrice: item.costPrice,
      mode: item.mode, priceGroupId: item.priceGroupId || '', priceVersion: item.priceVersion ?? null,
      batchAllocations: (item.batchAllocations || []).map((allocation) => ({ batchId: allocation.batchId, quantity: allocation.quantity })),
    })),
  };
  return JSON.stringify(normalized);
}

function legacySaleMatches(existing: Record<string, unknown>, sale: Sale, uid: string, branchId: string): boolean {
  if (existing.createdByUid !== uid || existing.branchId !== branchId
    || existing.id !== sale.id || existing.receiptNo !== sale.receiptNo
    || existing.date !== sale.date || existing.customer !== sale.customer
    || existing.customerId !== sale.customerId
    || existing.subtotal !== sale.subtotal || existing.discount !== sale.discount
    || existing.total !== sale.total || existing.profit !== sale.profit
    || existing.paymentMethod !== sale.paymentMethod || existing.status !== 'completed'
    || (existing.cashReceivedAmount ?? null) !== (sale.cashReceivedAmount ?? null)
    || (existing.changeAmount ?? null) !== (sale.changeAmount ?? null)
    || (existing.paidAmount ?? null) !== (sale.paidAmount ?? null)
    || (existing.dueAmount ?? null) !== (sale.dueAmount ?? null)
    || (existing.kpayTransactionReference || '') !== (sale.kpayTransactionReference || '')
    || !Array.isArray(existing.items) || existing.items.length !== sale.items.length) return false;

  // Capture the validated array before entering the callback. TypeScript does not
  // preserve a property-level Array.isArray narrowing across closures, and the
  // Firestore payload is intentionally typed as unknown until it is validated.
  const existingItems = existing.items as unknown[];
  return sale.items.every((line, index) => {
    const storedValue = existingItems[index];
    if (!storedValue || typeof storedValue !== 'object' || Array.isArray(storedValue)) return false;
    const stored = storedValue as Record<string, unknown>;
    if (stored.productId !== line.productId || stored.quantity !== line.quantity
      || stored.unitPrice !== line.unitPrice || stored.costPrice !== line.costPrice || stored.mode !== line.mode
      || (stored.priceGroupId || '') !== (line.priceGroupId || '')
      || (stored.priceVersion ?? null) !== (line.priceVersion ?? null)
      || !Array.isArray(stored.batchAllocations)) return false;
    const storedAllocations = stored.batchAllocations as Array<Record<string, unknown>>;
    const expectedAllocations = line.batchAllocations || [];
    return storedAllocations.length === expectedAllocations.length
      && expectedAllocations.every((allocation, allocationIndex) => {
        const actual = storedAllocations[allocationIndex];
        return actual?.batchId === allocation.batchId && actual?.quantity === allocation.quantity;
      });
  });
}

function failedPrecondition(message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = 'failed-precondition';
  return error;
}

function productRef(branchId: string, productId: string): DocumentReference<DocumentData> {
  if (!firestore) throw new Error('Firebase Firestore မချိတ်ဆက်ရသေးပါ။');
  return doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'products', productId);
}

/**
 * Commit a Cashier sale, Product Stock, and allocated Stock Batch deductions atomically.
 * The same transaction is idempotent: a retry after a lost response verifies the
 * Sale fingerprint and does not deduct stock a second time.
 */
export async function commitCashierSale(sale: Sale, uid: string, branchId: string): Promise<CashierSaleCommitResult> {
  if (!firestore) throw new Error('Firebase Firestore မချိတ်ဆက်ရသေးပါ။');
  if (!uid || sale.createdByUid !== uid) throw new Error('Cashier UID နဲ့ Sale UID မကိုက်ညီပါ။');
  if (!branchId || sale.branchId !== branchId) throw new Error('Cashier ရဲ့ တာဝန်ပေးထားတဲ့ Branch နဲ့ Sale Branch မကိုက်ညီပါ။');
  if (sale.status !== 'completed' || !sale.id || !sale.items.length) throw new Error('မှန်ကန်သော Completed Sale မဟုတ်ပါ။');

  const productDeltas = new Map<string, number>();
  const batchDeltas = new Map<string, number>();
  const batchProductIds = new Map<string, string>();
  for (const item of sale.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('ပစ္စည်းအရေအတွက် မမှန်ကန်ပါ။');
    productDeltas.set(item.productId, (productDeltas.get(item.productId) || 0) + item.quantity);
    for (const allocation of item.batchAllocations || []) {
      if (!allocation.batchId || !Number.isFinite(allocation.quantity) || allocation.quantity <= 0) {
        throw new Error('Stock Batch ခွဲဝေမှု မမှန်ကန်ပါ။');
      }
      batchDeltas.set(allocation.batchId, (batchDeltas.get(allocation.batchId) || 0) + allocation.quantity);
      const previousProductId = batchProductIds.get(allocation.batchId);
      if (previousProductId && previousProductId !== item.productId) throw new Error('Stock Batch တစ်ခုကို Product မတူဘဲ အသုံးပြုထားပါတယ်။');
      batchProductIds.set(allocation.batchId, item.productId);
    }
  }
  if (!productDeltas.size) throw new Error('ရောင်းချမည့် Product မရှိပါ။');

  const batchAllocationByProduct = new Map<string, number>();
  for (const [batchId, quantity] of batchDeltas) {
    const productId = batchProductIds.get(batchId)!;
    batchAllocationByProduct.set(productId, (batchAllocationByProduct.get(productId) || 0) + quantity);
  }
  for (const [productId, quantity] of batchAllocationByProduct) {
    const soldQuantity = productDeltas.get(productId) || 0;
    if (quantity - soldQuantity > 0.000001) throw new Error(`Stock Batch ခွဲဝေမှုက ရောင်းသည့်ပမာဏထက် များနေပါတယ်: ${productId}`);
    if (soldQuantity - quantity > 0.000001) {
      throw failedPrecondition(`Stock Batch အပြည့်အဝ မခွဲဝေရသေးပါ: ${productId}။ Owner က Branch Stock Batch များ Cloud Sync ပြီးကြောင်း စစ်ဆေးပါ။`);
    }
  }
  for (const [productId, soldQuantity] of productDeltas) {
    const allocatedQuantity = batchAllocationByProduct.get(productId) || 0;
    if (Math.abs(allocatedQuantity - soldQuantity) > 0.000001) {
      throw failedPrecondition(`Stock Batch ခွဲဝေမှု မပြည့်စုံပါ: ${productId}။ Branch Batch Data ကို Owner က ပြန်စစ်ဆေးရန်လိုပါတယ်။`);
    }
  }

  const saleRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'sales', sale.id);
  const auditId = `${sale.id}__created`;
  const auditRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'auditEvents', auditId);
  const productRefs = new Map([...productDeltas.keys()].map((id) => [id, productRef(branchId, id)]));
  const batchRefs = new Map([...batchDeltas.keys()].map((id) => [id, doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'stockBatches', id)]));
  const sharedCustomerRef = sale.paymentMethod === 'Credit' && sale.customerId
    ? doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'shared', 'customers', 'records', sale.customerId)
    : null;
  const plannedWrites = productDeltas.size + batchDeltas.size + 2 + (sharedCustomerRef ? 1 : 0);
  if (plannedWrites > 450) throw new Error('ဒီဘောင်ချာမှာ Product / Batch အရေအတွက် များလွန်းနေပါတယ်။ အပိုင်းခွဲပြီး ရောင်းချပါ။');

  let readsAcrossAttempts = 0;
  let writesCommitted = 0;
  const updatedAt = new Date().toISOString();
  const productDeltaObject = Object.fromEntries(productDeltas);
  const stockLines = [...productDeltas].map(([productId, quantity]) => ({ productId, quantity }));
  const batchDeltaObject = Object.fromEntries(batchDeltas);
  const batchLines = [...batchDeltas].map(([batchId, quantity]) => ({ batchId, productId: batchProductIds.get(batchId), quantity }));
  const fingerprint = saleFingerprint({ ...sale, branchId });
  const { cloudSyncStatus: _localSyncStatus, cloudSyncError: _localSyncError, ...cloudSafeSale } = sale;
  const cloudSale = {
    ...cloudSafeSale,
    branchId,
    productDeltas: productDeltaObject,
    batchDeltas: batchDeltaObject,
    stockLines,
    batchLines,
    saleFingerprint: fingerprint,
    cashierSyncVersion: 2,
  };

  let result: CashierSaleCommitResult;
  try {
    result = await runTransaction(firestore, async (transaction) => {
      writesCommitted = 0;
      const existingSale = await transaction.get(saleRef);
      readsAcrossAttempts += 1;
      if (existingSale.exists()) {
        const existing = existingSale.data().payload as Record<string, unknown> | undefined;
        const matches = !!existing && (
          (existing.saleFingerprint === fingerprint && existing.createdByUid === uid && existing.branchId === branchId)
          || (!existing.saleFingerprint && legacySaleMatches(existing, { ...sale, branchId }, uid, branchId))
        );
        if (matches) return 'already-committed' as const;
        throw new Error('Voucher ID တူနေသော်လည်း Cloud Sale အချက်အလက် မတူပါ။ Duplicate အဖြစ် မသိမ်းဘဲ Owner စစ်ဆေးရန် ရပ်ထားပါတယ်။');
      }

      const existingAudit = await transaction.get(auditRef);
      readsAcrossAttempts += 1;
      if (existingAudit.exists()) throw new Error('ဒီ Voucher အတွက် Audit Record ရှိပြီး Sale မတွေ့ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');

      const productEntries = [...productRefs.entries()];
      const batchEntries = [...batchRefs.entries()];
      const productSnapshots = await Promise.all(productEntries.map(([, ref]) => transaction.get(ref)));
      const batchSnapshots = await Promise.all(batchEntries.map(([, ref]) => transaction.get(ref)));
      const customerSnapshot = sharedCustomerRef ? await transaction.get(sharedCustomerRef) : null;
      readsAcrossAttempts += productSnapshots.length + batchSnapshots.length + (customerSnapshot ? 1 : 0);

      const productUpdates: Array<{ ref: DocumentReference<DocumentData>; payload: Record<string, unknown> }> = [];
      const productPayloads = new Map<string, Record<string, unknown>>();
      for (let index = 0; index < productEntries.length; index += 1) {
        const [productId, ref] = productEntries[index];
        const snapshot = productSnapshots[index];
        if (!snapshot.exists() || snapshot.data().deleted === true || !snapshot.data().payload || typeof snapshot.data().payload !== 'object') {
          throw new Error(`Cloud Product မတွေ့ပါ: ${productId}`);
        }
        const currentPayload = snapshot.data().payload as Record<string, unknown>;
        productPayloads.set(productId, currentPayload);
        const saleLines = sale.items.filter((item) => item.productId === productId);
        const currentPriceGroupId = typeof currentPayload.priceGroupId === 'string' ? currentPayload.priceGroupId : undefined;
        // Shared-price snapshots are checked again inside the Cloud transaction.
        // This protects queued/offline Cashier sales if the Owner changed a group
        // price after the cart was created but before the queue reconnects.
        if (currentPriceGroupId || saleLines.some((item) => !!item.priceGroupId)) {
          for (const line of saleLines) {
            const currentVersion = Number(currentPayload.priceVersion);
            const currentUnitPrice = line.mode === 'wholesale'
              ? Number(currentPayload.wholesalePrice)
              : Number(currentPayload.retailPrice);
            const staleSnapshot = !line.priceGroupId
              || line.priceGroupId !== currentPriceGroupId
              || !Number.isFinite(line.priceVersion)
              || line.priceVersion !== currentVersion
              || !Number.isFinite(currentUnitPrice)
              || !Number.isFinite(line.unitPrice)
              || Math.abs(line.unitPrice - currentUnitPrice) > 1e-8;
            if (staleSnapshot) {
              const error = new Error(`မျှဝေဈေးနှုန်း ပြောင်းလဲသွားပါပြီ: ${String(currentPayload.name || productId)}။ ဒီ Offline Sale ကို Owner က ဈေးနှုန်းနှင့် Voucher ပြန်စစ်ပြီးမှ အတည်ပြုပါ။`);
              (error as Error & { code?: string }).code = 'failed-precondition';
              throw error;
            }
          }
        }
        const currentStock = Number(currentPayload.stock);
        const quantity = productDeltas.get(productId) || 0;
        if (!Number.isFinite(currentStock) || currentStock + 0.000001 < quantity) {
          const error = new Error(`Cloud Stock မလုံလောက်ပါ: ${String(currentPayload.name || productId)} · Cloud ${currentStock} / ရောင်းရန် ${quantity}`);
          (error as Error & { code?: string }).code = 'failed-precondition';
          throw error;
        }
        const product = currentPayload as unknown as Product;
        const nextStock = cleanQuantity(Math.max(0, currentStock - quantity), quantityModeForProduct(product));
        productUpdates.push({ ref, payload: { ...currentPayload, stock: nextStock } });
      }

      const batchUpdates: Array<{ ref: DocumentReference<DocumentData>; payload: Record<string, unknown> }> = [];
      const parsedSaleDate = new Date(sale.date);
      if (!Number.isFinite(parsedSaleDate.getTime())) throw new Error('Sale Date မမှန်ကန်ပါ။ Offline Sale ကို ဆက်မပို့သေးပါ။');
      const saleDay = `${parsedSaleDate.getFullYear()}-${String(parsedSaleDate.getMonth() + 1).padStart(2, '0')}-${String(parsedSaleDate.getDate()).padStart(2, '0')}`;
      for (let index = 0; index < batchEntries.length; index += 1) {
        const [batchId, ref] = batchEntries[index];
        const snapshot = batchSnapshots[index];
        const productId = batchProductIds.get(batchId)!;
        if (!snapshot.exists() || snapshot.data().deleted === true || snapshot.data().kind !== 'stockBatches'
          || snapshot.data().branchId !== branchId || !snapshot.data().payload || typeof snapshot.data().payload !== 'object') {
          throw failedPrecondition(`Cloud Stock Batch မတွေ့ပါ: ${batchId}။ Owner က Batch စာရင်းကို စစ်ဆေးပါ။`);
        }
        const payload = snapshot.data().payload as Record<string, unknown>;
        const currentQuantity = Number(payload.quantity);
        const deduction = batchDeltas.get(batchId) || 0;
        if (payload.productId !== productId || !Number.isFinite(currentQuantity) || currentQuantity + 0.000001 < deduction) {
          throw failedPrecondition(`Stock Batch လက်ကျန် မလုံလောက်ပါ: ${batchId}။ Offline Sale ကို Owner စစ်ဆေးရန်လိုပါတယ်။`);
        }
        const expiryDate = typeof payload.expiryDate === 'string' ? payload.expiryDate : '';
        if (expiryDate && saleDay && expiryDate < saleDay) {
          throw failedPrecondition(`ရောင်းချသည့်နေ့တွင် Expiry ကျော်နေသော Batch ပါဝင်နေပါတယ်: ${batchId}။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
        }
        const productPayload = productPayloads.get(productId) || {};
        const product = productPayload as unknown as Product;
        batchUpdates.push({ ref, payload: { ...payload, quantity: cleanQuantity(Math.max(0, currentQuantity - deduction), quantityModeForProduct(product)) } });
      }

      const wrapperBase = { scope: 'branchRecord', branchId, deleted: false, updatedAt, updatedBy: uid };
      productUpdates.forEach(({ ref, payload }) => transaction.update(ref, { ...wrapperBase, kind: 'products', payload, sourceSaleId: sale.id }));
      batchUpdates.forEach(({ ref, payload }) => transaction.update(ref, { ...wrapperBase, kind: 'stockBatches', payload, sourceSaleId: sale.id }));
      transaction.set(saleRef, { ...wrapperBase, kind: 'sales', payload: cloudSale });
      writesCommitted = productUpdates.length + batchUpdates.length + 1;

      if (sharedCustomerRef && !customerSnapshot?.exists() && sale.customerSnapshot) {
        transaction.set(sharedCustomerRef, {
          scope: 'shared', kind: 'customers', branchId, payload: sale.customerSnapshot,
          updatedAt, updatedBy: uid, sourceSaleId: sale.id,
        });
        writesCommitted += 1;
      }
      transaction.set(auditRef, {
        id: auditId, eventType: 'SALE_CREATED', branchId, saleId: sale.id,
        receiptNo: sale.receiptNo, actorUid: uid, actorEmail: sale.createdByEmail || '',
        actorName: sale.createdByName || sale.createdByEmail || 'Cashier',
        occurredAt: updatedAt, total: sale.total,
      });
      writesCommitted += 1;
      return 'created' as const;
    });
  } catch (error) {
    if (readsAcrossAttempts > 0) recordFirestoreActivity(uid, 'read', 'cashier-sale-transaction-failed', readsAcrossAttempts);
    throw error;
  }

  recordFirestoreActivity(uid, 'read', 'cashier-sale-transaction', readsAcrossAttempts);
  recordFirestoreActivity(uid, 'write', 'cashier-sale-transaction', writesCommitted);
  console.info('[Minimart Cashier Sale Commit]', {
    saleId: sale.id,
    branchId,
    productCount: productDeltas.size,
    result,
    transactionReadEstimate: readsAcrossAttempts,
    committedWrites: writesCommitted,
  });
  return result;
}

/**
 * Allows a Cashier to flag their completed sale with a Void Request in Firestore
 * so the Owner can see the reason and approve the Void.
 */
export async function submitCashierVoidRequestToCloud(
  saleId: string,
  branchId: string,
  uid: string,
  actorName: string,
  reason: string,
): Promise<void> {
  if (!firestore || !navigator.onLine) return;
  const saleRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'sales', saleId);
  const now = new Date().toISOString();
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(saleRef);
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : null;
    if (!payload || payload.status !== 'completed') return;
    transaction.update(saleRef, {
      payload: {
        ...payload,
        voidRequested: true,
        voidRequestReason: reason.trim(),
        voidRequestedAt: now,
        voidRequestedByUid: uid,
        voidRequestedByName: actorName,
      },
      updatedAt: now,
      updatedBy: uid,
    });
  });
  recordFirestoreActivity(uid, 'read', 'cashier-void-request-read', 1);
  recordFirestoreActivity(uid, 'write', 'cashier-void-request-write', 1);
}

export async function enqueueCashierSale(sale: Sale, uid: string, branchId: string): Promise<void> {
  if (!uid || sale.createdByUid !== uid || !branchId || sale.branchId !== branchId
    || sale.status !== 'completed' || !sale.id || !Array.isArray(sale.items) || sale.items.length === 0) {
    throw new Error('Offline Queue ထဲသိမ်းမည့် Sale ၏ UID / Branch / Status မမှန်ပါ။');
  }
  await withQueueLock(uid, branchId, async () => {
    const queue = await readCashierSaleQueueInternal(uid, branchId);
    const existing = queue.find((entry) => entry.sale.id === sale.id);
    if (existing) {
      if (saleFingerprint(existing.sale) !== saleFingerprint({ ...sale, branchId })) {
        throw new Error('တူညီသော Sale ID အတွက် အခြားအချက်အလက်ရှိနေပါတယ်။ Duplicate Queue ကို မအစားထိုးဘဲ ရပ်ထားပါတယ်။');
      }
    } else {
      queue.push({ sale, uid, branchId, queuedAt: new Date().toISOString(), attempts: 0 });
      await saveQueue(uid, branchId, queue);
    }
  });
  try { window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: { uid, branchId } })); } catch { /* optional */ }
}

export async function removeCashierSaleFromQueue(uid: string, branchId: string, saleId: string): Promise<void> {
  await withQueueLock(uid, branchId, async () => {
    const queue = (await readCashierSaleQueueInternal(uid, branchId)).filter((entry) => entry.sale.id !== saleId);
    await saveQueue(uid, branchId, queue);
  });
  try { window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: { uid, branchId } })); } catch { /* optional */ }
}

export async function getPendingCashierSaleCount(uid: string, branchId: string): Promise<number> {
  return (await readCashierSaleQueue(uid, branchId)).length;
}

export async function flushCashierSaleQueue(uid: string, branchId: string): Promise<FlushResult> {
  if (!firestore || !navigator.onLine) return { synced: 0, pending: await getPendingCashierSaleCount(uid, branchId), needsReview: 0, rulesError: false };
  const flushKey = `${uid}::${branchId}`;
  const inFlight = activeFlushes.get(flushKey);
  if (inFlight) return inFlight;
  const flushPromise = withQueueLock(uid, branchId, async () => {
    let queue = await readCashierSaleQueueInternal(uid, branchId);
    let synced = 0;
    let rulesError = false;
    for (const entry of queue) {
      if (entry.needsReview) continue;
      if (!navigator.onLine) break;
      try {
        await commitCashierSale(entry.sale, uid, branchId);
        const remainingQueue = queue.filter((candidate) => candidate.sale.id !== entry.sale.id);
        await saveQueue(uid, branchId, remainingQueue);
        queue = remainingQueue;
        synced += 1;
        emitStatus(uid, branchId, 'synced', `Cashier Sale ${entry.sale.receiptNo} ကို Cloud ထဲ Product / Batch Stock နှင့် တစ်ပြိုင်နက် သိမ်းဆည်းပြီးပါပြီ။`, entry.sale.id);
      } catch (error) {
        const code = errorCode(error);
        rulesError = code === 'permission-denied';
        const review = code === 'failed-precondition'
          || /Voucher ID တူနေ|Cloud Product မတွေ့|Stock မလုံလောက်|Batch မလုံလောက်|Expiry ကျော်/i.test(error instanceof Error ? error.message : '');
        const failedQueue = queue.map((candidate) => candidate.sale.id === entry.sale.id
          ? { ...candidate, attempts: candidate.attempts + 1, needsReview: review, lastError: userFacingError(error) }
          : candidate);
        await saveQueue(uid, branchId, failedQueue);
        queue = failedQueue;
        emitStatus(uid, branchId, review ? 'review' : rulesError ? 'rules-error' : 'queued', userFacingError(error), entry.sale.id);
        // Stop on the first failure to preserve FIFO stock ordering.
        break;
      }
    }
    const needsReview = queue.filter((entry) => entry.needsReview).length;
    return { synced, pending: queue.length, needsReview, rulesError };
  });
  activeFlushes.set(flushKey, flushPromise);
  try {
    return await flushPromise;
  } finally {
    if (activeFlushes.get(flushKey) === flushPromise) activeFlushes.delete(flushKey);
  }
}

export async function recoverPendingCashierSales(sales: Sale[], uid: string, branchId: string): Promise<number> {
  const pending = sales.filter((sale) => sale.branchId === branchId && sale.createdByUid === uid
    && sale.status === 'completed' && sale.cloudSyncStatus === 'pending');
  let recovered = 0;
  for (const sale of pending) {
    await enqueueCashierSale(sale, uid, branchId);
    recovered += 1;
  }
  return recovered;
}

export async function submitCashierSale(sale: Sale, uid: string, branchId: string): Promise<'synced' | 'queued' | 'needs-review' | 'rules-error'> {
  // Queue persistence must succeed before we report the Sale as safely queued.
  await enqueueCashierSale(sale, uid, branchId);
  if (!navigator.onLine) {
    emitStatus(uid, branchId, 'queued', 'Internet မရှိသေးပါ။ Sale ကို IndexedDB Offline Queue ထဲ သိမ်းထားပါတယ်။');
    return 'queued';
  }
  const result = await flushCashierSaleQueue(uid, branchId);
  if (result.needsReview) return 'needs-review';
  if (result.rulesError) return 'rules-error';
  return result.pending > 0 ? 'queued' : 'synced';
}

export function listenForCashierQueue(uid: string, branchId: string, callback: () => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ uid?: string; branchId?: string }>).detail;
    if (detail?.uid === uid && detail.branchId === branchId) callback();
  };
  window.addEventListener(QUEUE_EVENT, handler);
  return () => window.removeEventListener(QUEUE_EVENT, handler);
}

export function listenForCashierSaleStatus(uid: string, callback: (message: string, state: string) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ uid?: string; state?: string; message?: string }>).detail;
    if (detail?.uid === uid) callback(detail.message || '', detail.state || '');
  };
  window.addEventListener(QUEUE_STATUS_EVENT, handler);
  return () => window.removeEventListener(QUEUE_STATUS_EVENT, handler);
}
