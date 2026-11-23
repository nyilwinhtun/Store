import { firebaseConfig, firestore, FIREBASE_BUSINESS_ID } from './firebase';
import { readDurableValue, writeDurableValue, removeDurableValue } from './persistentStateStorage';
import { usePosStore, type CashMovement, type CashShift, type CustomerPayment } from '../store/usePosStore';
import {
  applyCashierCashEntry,
  type CashierCashEntryKind,
  type CashierCashQueueEntry,
  type CashierCashSettlement,
} from './cashierCashApply';

export type { CashierCashEntryKind, CashierCashQueueEntry, CashierCashSettlement } from './cashierCashApply';

export type CashierCashFlushResult = { synced: number; pending: number; needsReview: number; rulesError: boolean };

const QUEUE_PREFIX = 'minimart-cashier-cash-queue-v1';
const QUEUE_EVENT = 'minimart-cashier-cash-queued';
const STATUS_EVENT = 'minimart-cashier-cash-status';
const validKinds: CashierCashEntryKind[] = ['shift-open', 'shift-close', 'cash-movement', 'customer-payment'];
const activeFlushes = new Map<string, Promise<CashierCashFlushResult>>();
const queueLocks = new Map<string, Promise<void>>();

function queueKey(uid: string, branchId: string): string {
  return `${QUEUE_PREFIX}:${firebaseConfig.projectId}:${FIREBASE_BUSINESS_ID}:${uid}:${branchId}`;
}

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
  if (lockManager?.request) return lockManager.request(`minimart-cashier-cash:${key}`, runInProcess);
  return runInProcess();
}

function parseQueue(value: unknown): CashierCashQueueEntry[] {
  if (!Array.isArray(value)) throw new Error('Cashier Cash Offline Queue ပုံစံ မမှန်ပါ။ Data ကို မဖျက်ဘဲ ရပ်ထားပါတယ်။');
  const invalid = value.find((entry) => {
    if (!entry || typeof entry !== 'object') return true;
    const candidate = entry as Partial<CashierCashQueueEntry>;
    if (typeof candidate.key !== 'string' || typeof candidate.recordId !== 'string'
      || typeof candidate.branchId !== 'string' || typeof candidate.queuedAt !== 'string'
      || typeof candidate.attempts !== 'number' || !candidate.kind
      || !validKinds.includes(candidate.kind)) return true;
    if (candidate.kind === 'shift-open' || candidate.kind === 'shift-close') return !candidate.shift;
    if (candidate.kind === 'cash-movement') return !candidate.movement;
    return !candidate.payment || !candidate.settlement;
  });
  if (invalid) throw new Error('Cashier Cash Offline Queue ထဲမှာ ဖတ်မရသော Record တစ်ခုရှိနေပါတယ်။ မူရင်း Data ကို မဖျက်ထားပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
  return value as CashierCashQueueEntry[];
}

async function readQueueInternal(uid: string, branchId: string): Promise<CashierCashQueueEntry[]> {
  const stored = await readDurableValue(queueKey(uid, branchId));
  if (stored === null) return [];
  const queue = parseQueue(JSON.parse(stored));
  const mismatched = queue.some((entry) => {
    if (entry.branchId !== branchId) return true;
    if (entry.kind === 'cash-movement') {
      return !entry.movement || entry.movement.id !== entry.recordId
        || (!!entry.movement.branchId && entry.movement.branchId !== branchId)
        || (!!entry.movement.createdByUid && entry.movement.createdByUid !== uid);
    }
    if (entry.kind === 'customer-payment') {
      return !entry.payment || !entry.settlement || entry.payment.id !== entry.recordId
        || (!!entry.payment.branchId && entry.payment.branchId !== branchId);
    }
    return !entry.shift || entry.shift.id !== entry.recordId
      || (!!entry.shift.branchId && entry.shift.branchId !== branchId)
      || (!!entry.shift.openedByUid && entry.shift.openedByUid !== uid);
  });
  if (mismatched) {
    throw new Error('Cash Offline Queue ထဲရှိ UID / Branch / Record ID မကိုက်ညီပါ။ Data ကို မဖျက်ဘဲ ရပ်ထားပါတယ်။');
  }
  return queue;
}

async function saveQueue(uid: string, branchId: string, queue: CashierCashQueueEntry[]): Promise<void> {
  const key = queueKey(uid, branchId);
  if (queue.length) await writeDurableValue(key, JSON.stringify(queue));
  else await removeDurableValue(key);
}

export async function readCashierCashQueue(uid: string, branchId: string): Promise<CashierCashQueueEntry[]> {
  return withQueueLock(uid, branchId, () => readQueueInternal(uid, branchId));
}

export async function getPendingCashierCashCount(uid: string, branchId: string): Promise<number> {
  return (await readCashierCashQueue(uid, branchId)).length;
}

function emitQueueEvent(uid: string, branchId: string): void {
  try {
    window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: { uid, branchId } }));
  } catch { /* UI notification is optional. */ }
}

function emitStatus(uid: string, branchId: string, state: 'synced' | 'review' | 'rules-error' | 'error', message: string, entry: CashierCashQueueEntry): void {
  try {
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, {
      detail: { uid, branchId, state, message, kind: entry.kind, recordId: entry.recordId },
    }));
  } catch { /* UI notification is optional. */ }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
}

function userFacingError(error: unknown): string {
  const code = errorCode(error);
  if (code === 'permission-denied') return 'Cashier Cash Rules ကို Firebase မှ ခွင့်မပြုပါ။ Firestore Rules ကို နောက်ဆုံး Version အတိုင်း Publish လုပ်ထားကြောင်း စစ်ပါ။';
  if (code === 'resource-exhausted') return 'Firebase Usage Quota ပြည့်နေသောကြောင့် Cloud သို့ မပို့နိုင်သေးပါ။ Cash Record ကို Local Queue ထဲ ထိန်းထားပါတယ်။';
  if (code === 'unavailable' || code === 'deadline-exceeded' || !navigator.onLine) return 'Internet မရှိသေးပါ။ Cash Record ကို ဒီ Device မှာ သိမ်းထားပြီး ပြန်ချိတ်မိလျှင် ပို့ပါမယ်။';
  return error instanceof Error ? error.message : 'Cashier Cash Record ကို Cloud သို့ မပို့နိုင်သေးပါ။';
}

export function flushCashierCashQueue(uid: string, branchId: string): Promise<CashierCashFlushResult> {
  if (!firestore || !navigator.onLine) {
    return getPendingCashierCashCount(uid, branchId).then((pending) => ({ synced: 0, pending, needsReview: 0, rulesError: false }));
  }
  const db = firestore;
  const flushKey = `${uid}::${branchId}`;
  const inFlight = activeFlushes.get(flushKey);
  if (inFlight) return inFlight;
  const flushPromise = withQueueLock(uid, branchId, async (): Promise<CashierCashFlushResult> => {
    let queue = await readQueueInternal(uid, branchId);
    let synced = 0;
    let rulesError = false;
    for (const entry of [...queue]) {
      if (entry.needsReview) continue;
      if (!navigator.onLine) break;
      try {
        await applyCashierCashEntry(db, FIREBASE_BUSINESS_ID, entry, uid);
        queue = queue.filter((candidate) => candidate.key !== entry.key);
        await saveQueue(uid, branchId, queue);
        synced += 1;
        emitStatus(uid, branchId, 'synced', 'Cashier Cash Record ကို Cloud သို့ ပို့ပြီးပါပြီ။', entry);
      } catch (error) {
        const code = errorCode(error);
        const review = code === 'failed-precondition';
        rulesError = code === 'permission-denied';
        const message = userFacingError(error);
        queue = queue.map((candidate) => candidate.key === entry.key
          ? { ...candidate, attempts: candidate.attempts + 1, ...(review ? { needsReview: true } : {}), lastError: message }
          : candidate);
        await saveQueue(uid, branchId, queue);
        emitStatus(uid, branchId, review ? 'review' : rulesError ? 'rules-error' : 'error', message, entry);
        if (!review) break;
      }
    }
    const needsReview = queue.filter((entry) => entry.needsReview).length;
    return { synced, pending: queue.length, needsReview, rulesError };
  });
  activeFlushes.set(flushKey, flushPromise);
  return flushPromise.finally(() => {
    if (activeFlushes.get(flushKey) === flushPromise) activeFlushes.delete(flushKey);
  });
}

async function appendEntry(entry: CashierCashQueueEntry, uid: string): Promise<void> {
  await withQueueLock(uid, entry.branchId, async () => {
    const queue = await readQueueInternal(uid, entry.branchId);
    if (queue.some((candidate) => candidate.key === entry.key)) return;
    queue.push(entry);
    await saveQueue(uid, entry.branchId, queue);
  });
  emitQueueEvent(uid, entry.branchId);
}

export async function enqueueCashierShift(shift: CashShift, uid: string, branchId: string): Promise<void> {
  const kind: CashierCashEntryKind = shift.closedAt ? 'shift-close' : 'shift-open';
  if (shift.branchId !== branchId) throw new Error('Shift Branch နှင့် Cashier Branch မကိုက်ညီပါ။');
  if (shift.openedByUid && shift.openedByUid !== uid) throw new Error('အခြား Cashier ၏ Shift ကို မိမိ Queue ထဲ မထည့်နိုင်ပါ။');
  const entry: CashierCashQueueEntry = {
    key: `${kind}:${shift.id}`,
    kind,
    recordId: shift.id,
    branchId,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    shift,
  };
  await appendEntry(entry, uid);
}

export async function enqueueCashierMovement(movement: CashMovement, uid: string, branchId: string): Promise<void> {
  if (movement.branchId !== branchId) throw new Error('Cash Movement Branch နှင့် Cashier Branch မကိုက်ညီပါ။');
  if (movement.createdByUid && movement.createdByUid !== uid) throw new Error('အခြား Cashier ၏ Cash Movement ကို မိမိ Queue ထဲ မထည့်နိုင်ပါ။');
  const entry: CashierCashQueueEntry = {
    key: `cash-movement:${movement.id}`,
    kind: 'cash-movement',
    recordId: movement.id,
    branchId,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    movement,
  };
  await appendEntry(entry, uid);
}

export async function enqueueCashierCustomerPayment(
  payment: CustomerPayment,
  uid: string,
  branchId: string,
  settlement: CashierCashSettlement,
): Promise<void> {
  if (payment.branchId && payment.branchId !== branchId) throw new Error('Customer Payment Branch နှင့် Cashier Branch မကိုက်ညီပါ။');
  if (!settlement.saleId || settlement.saleId !== payment.saleId) throw new Error('Customer Payment နှင့် Credit Sale မကိုက်ညီပါ။');
  if (!Number.isFinite(settlement.paidAmount) || !Number.isFinite(settlement.dueAmount)
    || settlement.paidAmount < 0 || settlement.dueAmount < 0) {
    throw new Error('Customer Credit လက်ကျန်အချက်အလက် မမှန်ကန်ပါ။');
  }
  const entry: CashierCashQueueEntry = {
    key: `customer-payment:${payment.id}`,
    kind: 'customer-payment',
    recordId: payment.id,
    branchId,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    payment,
    settlement,
  };
  await appendEntry(entry, uid);
}

/**
 * Recover Cash records created while the outbox was unavailable (for example an
 * app upgrade mid-session). Only records this Cashier owns and only recent open
 * Shifts / linked Movements are re-queued so old history is never rewritten.
 */
export async function recoverPendingCashierCash(uid: string, branchId: string): Promise<number> {
  const state = usePosStore.getState();
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const closeCutoff = now - 24 * 60 * 60 * 1000;
  let recovered = 0;
  const shifts = state.cashShifts
    .filter((shift) => shift.branchId === branchId && (!shift.openedByUid || shift.openedByUid === uid)
      && Number.isFinite(Date.parse(shift.openedAt)) && Date.parse(shift.openedAt) >= cutoff
      && (!shift.closedAt
        || (shift.closedByUid === uid && Number.isFinite(Date.parse(shift.closedAt)) && Date.parse(shift.closedAt) >= closeCutoff)))
    .slice(0, 30);
  for (const shift of shifts) {
    try {
      await enqueueCashierShift(shift, uid, branchId);
      recovered += 1;
    } catch { /* Skip records that do not belong to this Cashier. */ }
  }
  const openShiftIds = new Set(shifts.filter((shift) => !shift.closedAt).map((shift) => shift.id));
  if (openShiftIds.size) {
    const movements = state.cashMovements
      .filter((movement) => movement.branchId === branchId && openShiftIds.has(movement.shiftId)
        && (!movement.createdByUid || movement.createdByUid === uid)
        && Number.isFinite(Date.parse(movement.date)) && Date.parse(movement.date) >= cutoff)
      .slice(0, 200);
    for (const movement of movements) {
      try {
        await enqueueCashierMovement(movement, uid, branchId);
        recovered += 1;
      } catch { /* Skip records that cannot be owned by this Cashier. */ }
    }
  }
  return recovered;
}

export function listenForCashierCashQueue(uid: string, branchId: string, callback: () => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ uid?: string; branchId?: string }>).detail;
    if (detail?.uid === uid && detail.branchId === branchId) callback();
  };
  window.addEventListener(QUEUE_EVENT, handler);
  return () => window.removeEventListener(QUEUE_EVENT, handler);
}

export function listenForCashierCashStatus(
  uid: string,
  callback: (state: string, message: string, detail: { kind?: string; recordId?: string; branchId?: string }) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ uid?: string; state?: string; message?: string; kind?: string; recordId?: string; branchId?: string }>).detail;
    if (detail?.uid !== uid) return;
    callback(detail.state || '', detail.message || '', { kind: detail.kind, recordId: detail.recordId, branchId: detail.branchId });
  };
  window.addEventListener(STATUS_EVENT, handler);
  return () => window.removeEventListener(STATUS_EVENT, handler);
}
