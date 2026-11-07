import {
  doc,
  runTransaction,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { firebaseConfig, firestore, FIREBASE_BUSINESS_ID } from './firebase';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import { cleanQuantity, quantityModeForProduct } from './quantity';
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

const QUEUE_PREFIX = 'minimart-cashier-sale-queue-v1';
const QUEUE_EVENT = 'minimart-cashier-sale-queued';
const QUEUE_STATUS_EVENT = 'minimart-cashier-sale-status';
type FlushResult = { synced: number; pending: number; needsReview: number; rulesError: boolean };
const activeFlushes = new Map<string, Promise<FlushResult>>();

function queueKey(uid: string, branchId: string): string {
  return `${QUEUE_PREFIX}:${firebaseConfig.projectId}:${FIREBASE_BUSINESS_ID}:${uid}:${branchId}`;
}

function readQueue(uid: string, branchId: string): CashierSaleQueueEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(queueKey(uid, branchId)) || '[]') as unknown;
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') as CashierSaleQueueEntry[] : [];
  } catch {
    return [];
  }
}

function saveQueue(uid: string, branchId: string, queue: CashierSaleQueueEntry[]): void {
  try {
    if (queue.length) localStorage.setItem(queueKey(uid, branchId), JSON.stringify(queue));
    else localStorage.removeItem(queueKey(uid, branchId));
  } catch {
    // The completed sale remains in the POS store. Surface the queue issue rather than blocking checkout.
  }
}

function emitStatus(uid: string, branchId: string, state: 'synced' | 'queued' | 'review' | 'error' | 'rules-error', message: string): void {
  try {
    window.dispatchEvent(new CustomEvent(QUEUE_STATUS_EVENT, { detail: { uid, branchId, state, message } }));
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
  if (code === 'permission-denied') return 'Cashier Sales / Stock Rules ကို Firebase မှ ခွင့်မပြုပါ။ Firestore Rules ကို v2.9.8 အတိုင်း Publish လုပ်ထားကြောင်း စစ်ပါ။';
  if (code === 'failed-precondition') return error instanceof Error ? error.message : 'Cloud Stock ပြောင်းလဲသွားသောကြောင့် အရောင်းကို အတည်မပြုနိုင်ပါ။';
  if (code === 'resource-exhausted') return 'Firebase Usage Quota ပြည့်နေသောကြောင့် Cloud သို့ မပို့နိုင်သေးပါ။ Sale ကို Local Queue ထဲ ထိန်းထားပါတယ်။';
  if (code === 'unavailable' || code === 'deadline-exceeded' || !navigator.onLine) return 'Internet မရှိသေးပါ။ အရောင်းကို ဒီ Device မှာ သိမ်းထားပြီး ပြန်ချိတ်မိလျှင် ပို့ပါမယ်။';
  return error instanceof Error ? error.message : 'Cashier Sale ကို Cloud သို့ မပို့နိုင်သေးပါ။';
}

function productRef(branchId: string, productId: string): DocumentReference<DocumentData> {
  if (!firestore) throw new Error('Firebase Firestore မချိတ်ဆက်ရသေးပါ။');
  return doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'products', productId);
}

function batchRef(branchId: string, batchId: string): DocumentReference<DocumentData> {
  if (!firestore) throw new Error('Firebase Firestore မချိတ်ဆက်ရသေးပါ။');
  return doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'stockBatches', batchId);
}

/**
 * Commit a Cashier sale and its stock deductions atomically. A stable sale ID
 * is the idempotency key: replays return success without decrementing stock twice.
 */
export async function commitCashierSale(sale: Sale, uid: string, branchId: string): Promise<CashierSaleCommitResult> {
  if (!firestore) throw new Error('Firebase Firestore မချိတ်ဆက်ရသေးပါ။');
  if (!uid || sale.createdByUid !== uid) throw new Error('Cashier UID နဲ့ Sale UID မကိုက်ညီပါ။');
  if (!branchId || sale.branchId !== branchId) throw new Error('Cashier ရဲ့ တာဝန်ပေးထားတဲ့ Branch နဲ့ Sale Branch မကိုက်ညီပါ။');
  if (sale.status !== 'completed' || !sale.id || !sale.items.length) throw new Error('မှန်ကန်သော Completed Sale မဟုတ်ပါ။');

  const productDeltas = new Map<string, number>();
  const batchDeltas = new Map<string, number>();
  const itemModes = new Map<string, Product['quantityMode']>();
  for (const item of sale.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('ပစ္စည်းအရေအတွက် မမှန်ကန်ပါ။');
    productDeltas.set(item.productId, (productDeltas.get(item.productId) || 0) + item.quantity);
    itemModes.set(item.productId, item.quantityMode);
    for (const allocation of item.batchAllocations || []) {
      if (!allocation.batchId || !Number.isFinite(allocation.quantity) || allocation.quantity <= 0) continue;
      batchDeltas.set(allocation.batchId, (batchDeltas.get(allocation.batchId) || 0) + allocation.quantity);
    }
  }
  if (!productDeltas.size) throw new Error('ရောင်းချမည့် Product မရှိပါ။');

  // If a product has batch allocations, they must account for the full sale quantity.
  // A partial allocation indicates stale or inconsistent local batch data.
  for (const [productId, quantity] of productDeltas) {
    const allocated = sale.items
      .filter((item) => item.productId === productId)
      .flatMap((item) => item.batchAllocations || [])
      .reduce((sum, allocation) => sum + allocation.quantity, 0);
    if (allocated > 0 && Math.abs(allocated - quantity) > 0.000001) {
      throw new Error(`ပစ္စည်း ${productId} ရဲ့ Batch လက်ကျန်နဲ့ Product လက်ကျန် မကိုက်ညီပါ။ Owner ကို စစ်ဆေးခိုင်းပါ။`);
    }
  }

  const saleRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'sales', sale.id);
  const auditId = `${sale.id}__created`;
  const auditRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'auditEvents', auditId);
  const productRefs = new Map([...productDeltas.keys()].map((id) => [id, productRef(branchId, id)]));
  const batchRefs = new Map([...batchDeltas.keys()].map((id) => [id, batchRef(branchId, id)]));
  const sharedCustomerRef = sale.paymentMethod === 'Credit' && sale.customerId
    ? doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'shared', 'customers', 'records', sale.customerId)
    : null;

  let readsAcrossAttempts = 0;
  let writesCommitted = 0;
  const updatedAt = new Date().toISOString();
  const productDeltaObject = Object.fromEntries(productDeltas);
  const batchDeltaObject = Object.fromEntries(batchDeltas);
  const stockLines = [...productDeltas].map(([productId, quantity]) => ({ productId, quantity }));
  const batchLines = [...batchDeltas].map(([batchId, quantity]) => ({ batchId, quantity }));
  const cloudSale = {
    ...sale,
    branchId,
    productDeltas: productDeltaObject,
    batchDeltas: batchDeltaObject,
    stockLines,
    batchLines,
    cashierSyncVersion: 1,
  };

  let result: CashierSaleCommitResult;
  try {
    result = await runTransaction(firestore, async (transaction) => {
    // Firestore may retry this callback after a concurrent change. Reset the
    // write estimate on every attempt so only the final successful attempt counts.
    writesCommitted = 0;
    const existingSale = await transaction.get(saleRef);
    readsAcrossAttempts += 1;
    if (existingSale.exists()) {
      const existing = existingSale.data().payload as Record<string, unknown> | undefined;
      if (existing?.createdByUid === uid && existing?.receiptNo === sale.receiptNo && existing?.total === sale.total) {
        return 'already-committed' as const;
      }
      throw new Error('Voucher ID တူနေသော်လည်း Cloud Sale အချက်အလက် မတူပါ။ Owner ကို စစ်ဆေးခိုင်းပါ။');
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
    for (let index = 0; index < productEntries.length; index += 1) {
      const [productId, ref] = productEntries[index];
      const snapshot = productSnapshots[index];
      if (!snapshot.exists() || snapshot.data().deleted === true || !snapshot.data().payload || typeof snapshot.data().payload !== 'object') {
        throw new Error(`Cloud Product မတွေ့ပါ: ${productId}`);
      }
      const currentPayload = snapshot.data().payload as Record<string, unknown>;
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
    for (let index = 0; index < batchEntries.length; index += 1) {
      const [batchId, ref] = batchEntries[index];
      const snapshot = batchSnapshots[index];
      if (!snapshot.exists() || snapshot.data().deleted === true || !snapshot.data().payload || typeof snapshot.data().payload !== 'object') {
        throw new Error(`Cloud Stock Batch မတွေ့ပါ: ${batchId}`);
      }
      const currentPayload = snapshot.data().payload as Record<string, unknown>;
      const currentQuantity = Number(currentPayload.quantity);
      const delta = batchDeltas.get(batchId) || 0;
      if (!Number.isFinite(currentQuantity) || currentQuantity + 0.000001 < delta) {
        const error = new Error(`Cloud Batch လက်ကျန် မလုံလောက်ပါ: ${batchId}`);
        (error as Error & { code?: string }).code = 'failed-precondition';
        throw error;
      }
      const productId = String(currentPayload.productId || '');
      const saleProduct = sale.items.find((item) => item.productId === productId);
      const modeProduct = saleProduct ? ({ unit: saleProduct.unit || '', quantityMode: itemModes.get(productId) } as Product) : ({ unit: '', quantityMode: 'whole' } as Product);
      batchUpdates.push({ ref, payload: { ...currentPayload, quantity: cleanQuantity(Math.max(0, currentQuantity - delta), quantityModeForProduct(modeProduct)) } });
    }

    // All reads are complete. The following writes commit together or not at all.
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
    batchCount: batchDeltas.size,
    result,
    transactionReadEstimate: readsAcrossAttempts,
    committedWrites: writesCommitted,
  });
  return result;
}

export function enqueueCashierSale(sale: Sale, uid: string, branchId: string): void {
  const queue = readQueue(uid, branchId);
  if (!queue.some((entry) => entry.sale.id === sale.id)) {
    queue.push({ sale, uid, branchId, queuedAt: new Date().toISOString(), attempts: 0 });
    saveQueue(uid, branchId, queue);
  }
  try { window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: { uid, branchId } })); } catch { /* optional */ }
}

export function getPendingCashierSaleCount(uid: string, branchId: string): number {
  return readQueue(uid, branchId).length;
}

export async function flushCashierSaleQueue(uid: string, branchId: string): Promise<FlushResult> {
  if (!firestore || !navigator.onLine) return { synced: 0, pending: getPendingCashierSaleCount(uid, branchId), needsReview: 0, rulesError: false };
  const flushKey = `${uid}::${branchId}`;
  const inFlight = activeFlushes.get(flushKey);
  if (inFlight) return inFlight;
  const flushPromise = (async () => {
    let queue = readQueue(uid, branchId);
    let synced = 0;
    let rulesError = false;
    for (const entry of queue) {
      if (entry.needsReview) continue;
      if (!navigator.onLine) break;
      try {
        await commitCashierSale(entry.sale, uid, branchId);
        queue = queue.filter((candidate) => candidate.sale.id !== entry.sale.id);
        saveQueue(uid, branchId, queue);
        synced += 1;
        emitStatus(uid, branchId, 'synced', `Cashier Sale ${entry.sale.receiptNo} ကို Cloud ထဲ တစ်ကြိမ်တည်း သိမ်းဆည်းပြီးပါပြီ။`);
      } catch (error) {
        const code = errorCode(error);
        // Permission errors remain retryable: the Owner can publish corrected Rules.
        rulesError = code === 'permission-denied';
        const review = code === 'failed-precondition'
          || /Voucher ID တူနေ|Cloud Product မတွေ့|Stock Batch မတွေ့|Batch လက်ကျန်|Product .*Batch လက်ကျန်/i.test(error instanceof Error ? error.message : '');
        queue = queue.map((candidate) => candidate.sale.id === entry.sale.id
          ? { ...candidate, attempts: candidate.attempts + 1, needsReview: review, lastError: userFacingError(error) }
          : candidate);
        saveQueue(uid, branchId, queue);
        emitStatus(uid, branchId, review ? 'review' : rulesError ? 'rules-error' : 'queued', userFacingError(error));
        // Stop on the first failure to preserve FIFO stock ordering.
        break;
      }
    }
    const needsReview = queue.filter((entry) => entry.needsReview).length;
    return { synced, pending: queue.length, needsReview, rulesError };
  })();
  activeFlushes.set(flushKey, flushPromise);
  try {
    return await flushPromise;
  } finally {
    if (activeFlushes.get(flushKey) === flushPromise) activeFlushes.delete(flushKey);
  }
}

export async function submitCashierSale(sale: Sale, uid: string, branchId: string): Promise<'synced' | 'queued' | 'needs-review' | 'rules-error'> {
  enqueueCashierSale(sale, uid, branchId);
  if (!navigator.onLine) {
    emitStatus(uid, branchId, 'queued', 'Internet မရှိသေးပါ။ Sale ကို Local Queue ထဲ သိမ်းထားပါတယ်။');
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
