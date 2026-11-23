import { doc, runTransaction } from 'firebase/firestore';
import { firebaseAuth, firebaseConfig, firestore, FIREBASE_BUSINESS_ID } from './firebase';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import { readDurableValue, writeDurableValue, removeDurableValue } from './persistentStateStorage';
import { commitCashierUnitSaleToCloud } from './cashierUnitSaleSync';
import { commitSaleThroughWorker, WorkerSaleError, workerSalesGate } from './workerSaleClient';
import type { Sale } from '../store/usePosStore';

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
    ? String((error as { code: unknown }).code).replace(/^functions\//, '')
    : '';
}

function userFacingError(error: unknown): string {
  if (error instanceof WorkerSaleError) return error.message;
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
    kpayAccountNameSnapshot: sale.kpayAccountNameSnapshot || '',
    kpayAccountNumberSnapshot: sale.kpayAccountNumberSnapshot || '',
    kpayAccountLabelSnapshot: sale.kpayAccountLabelSnapshot || '',
    kpayQrVersionSnapshot: sale.kpayQrVersionSnapshot ?? null,
    changeAmount: sale.changeAmount ?? null, paidAmount: sale.paidAmount ?? null, dueAmount: sale.dueAmount ?? null,
    subtotal: sale.subtotal, discount: sale.discount, total: sale.total, profit: sale.profit, status: sale.status,
    createdByUid: sale.createdByUid || '',
    items: sale.items.map((item) => ({
      productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, costPrice: item.costPrice,
      mode: item.mode, priceGroupId: item.priceGroupId || '', priceVersion: item.priceVersion ?? null,
      batchAllocations: (item.batchAllocations || []).map((allocation) => ({ batchId: allocation.batchId, quantity: allocation.quantity })),
      stockUnitSelections: (item.stockUnitSelections || []).map((selection) => ({ unitId: selection.unitId, barcode: selection.barcode, batchId: selection.batchId || '' })),
    })),
  };
  return JSON.stringify(normalized);
}

/**
 * Cashier sales use the trusted callable until the Staging Worker gate passes.
 * When that gate is explicitly enabled in a Staging build, the Worker becomes
 * the only commit path; there is no direct Cashier Firestore sale writer.
 */
export async function commitCashierSale(sale: Sale, uid: string, branchId: string): Promise<CashierSaleCommitResult> {
  if (!firestore) throw new Error('Firebase Firestore မချိတ်ဆက်ရသေးပါ။');
  if (!uid || sale.createdByUid !== uid) throw new Error('Cashier UID နဲ့ Sale UID မကိုက်ညီပါ။');
  if (!branchId || sale.branchId !== branchId) throw new Error('Cashier ရဲ့ တာဝန်ပေးထားတဲ့ Branch နဲ့ Sale Branch မကိုက်ညီပါ။');
  if (sale.status !== 'completed' || !sale.id || !sale.items.length) throw new Error('မှန်ကန်သော Completed Sale မဟုတ်ပါ။');

  const worker = workerSalesGate();
  if (worker.enabled) {
    const currentUser = firebaseAuth?.currentUser;
    if (!currentUser || currentUser.uid !== uid) throw new Error('Firebase Cashier Login မမှန်ပါ။');
    return commitSaleThroughWorker(sale, uid, branchId, {
      endpoint: worker.endpoint,
      getIdToken: () => currentUser.getIdToken(),
    });
  }
  return commitCashierUnitSaleToCloud(sale, uid, branchId);
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
        const workerError = error instanceof WorkerSaleError ? error : null;
        rulesError = !workerError && code === 'permission-denied';
        const review = workerError
          ? workerError.needsReview
          : code === 'failed-precondition'
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
