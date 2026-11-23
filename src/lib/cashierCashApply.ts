import { doc, runTransaction, type DocumentData, type DocumentReference, type Firestore } from 'firebase/firestore';
import type { CashMovement, CashShift, CustomerPayment } from '../store/usePosStore';
import {
  buildCashierCustomerPaymentPayload,
  buildCashierMovementPayload,
  buildCashierShiftClosePayload,
  buildCashierShiftOpenPayload,
} from './cashierCashRecords';

export type CashierCashEntryKind = 'shift-open' | 'shift-close' | 'cash-movement' | 'customer-payment';

export type CashierCashSettlement = { saleId: string; paidAmount: number; dueAmount: number };

export type CashierCashQueueEntry = {
  key: string;
  kind: CashierCashEntryKind;
  recordId: string;
  branchId: string;
  queuedAt: string;
  attempts: number;
  needsReview?: boolean;
  lastError?: string;
  shift?: CashShift;
  movement?: CashMovement;
  payment?: CustomerPayment;
  settlement?: CashierCashSettlement;
};

export type CashierCashApplyOutcome = 'created' | 'duplicate';

/**
 * A Credit Sale is committed by a separate offline queue. Until that queue
 * catches up, a payment that arrives first is retryable rather than a data
 * problem; after this many attempts it becomes an Owner review item.
 */
const MISSING_CREDIT_SALE_ATTEMPTS = 5;

/** Permanent review state: retrying the same write will not succeed. */
export function needsReviewError(message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = 'failed-precondition';
  return error;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function branchDocRef(
  db: Firestore,
  businessId: string,
  kind: 'cashShifts' | 'cashMovements' | 'customerPayments' | 'sales',
  branchId: string,
  id: string,
): DocumentReference<DocumentData> {
  return doc(db, 'businesses', businessId, 'branches', branchId, kind, id);
}

function envelope(
  kind: 'cashShifts' | 'cashMovements' | 'customerPayments',
  branchId: string,
  uid: string,
  now: string,
  payload: Record<string, unknown>,
) {
  return { scope: 'branchRecord', kind, branchId, deleted: false, updatedAt: now, updatedBy: uid, payload };
}

async function applyShiftOpen(
  db: Firestore, businessId: string, entry: CashierCashQueueEntry, uid: string,
): Promise<CashierCashApplyOutcome> {
  if (!entry.shift) throw new Error('Cash Shift မမှန်ကန်ပါ။');
  const payload = buildCashierShiftOpenPayload(entry.shift, entry.branchId, uid, 'Cashier');
  if (!payload) throw needsReviewError('Cash Shift အဖွင့်အချက်အလက် မမှန်ကန်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
  const ref = branchDocRef(db, businessId, 'cashShifts', entry.branchId, entry.recordId);
  const now = new Date().toISOString();
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) {
      const existing = asRecord(snapshot.data().payload);
      if (existing && existing.id === payload.id && existing.openedAt === payload.openedAt
        && existing.openingCash === payload.openingCash) return 'duplicate' as const;
      throw needsReviewError('တူညီသော Shift ID အတွက် Cloud အချက်အလက် မတူပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    }
    transaction.set(ref, envelope('cashShifts', entry.branchId, uid, now, payload));
    return 'created' as const;
  });
}

async function applyShiftClose(
  db: Firestore, businessId: string, entry: CashierCashQueueEntry, uid: string,
): Promise<CashierCashApplyOutcome> {
  if (!entry.shift) throw new Error('Cash Shift မမှန်ကန်ပါ။');
  const shift = entry.shift;
  const ref = branchDocRef(db, businessId, 'cashShifts', entry.branchId, entry.recordId);
  const now = new Date().toISOString();
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw needsReviewError('Cash Shift ကို Cloud မှာ မတွေ့ပါ။ Shift ဖွင့်မှု Cloud Sync ကို အရင်စစ်ပါ။');
    const data = snapshot.data();
    const previous = asRecord(data.payload);
    if (!previous || data.kind !== 'cashShifts' || data.branchId !== entry.branchId) {
      throw needsReviewError('Cloud Cash Shift အချက်အလက် မမှန်ကန်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    }
    if (previous.closedAt === shift.closedAt) return 'duplicate' as const;
    if (typeof previous.closedAt === 'string') throw needsReviewError('Cloud Shift ကို အခြားစက်မှ ပိတ်ထားပြီး ရက်ချိန်း မတူပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    const payload = buildCashierShiftClosePayload(previous, shift, entry.branchId, uid, 'Cashier');
    if (!payload) throw needsReviewError('Shift အဖွင့်အချက်အလက်သည် Cloud နှင့် မကိုက်ညီပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    transaction.update(ref, { payload, updatedAt: now, updatedBy: uid });
    return 'created' as const;
  });
}

async function applyMovement(
  db: Firestore, businessId: string, entry: CashierCashQueueEntry, uid: string,
): Promise<CashierCashApplyOutcome> {
  if (!entry.movement) throw new Error('Cash Movement မမှန်ကန်ပါ။');
  const movement = entry.movement;
  const payload = buildCashierMovementPayload(movement, entry.branchId, uid, 'Cashier');
  if (!payload) throw needsReviewError('Cash Movement အချက်အလက် မမှန်ကန်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
  const ref = branchDocRef(db, businessId, 'cashMovements', entry.branchId, entry.recordId);
  const shiftRef = branchDocRef(db, businessId, 'cashShifts', entry.branchId, movement.shiftId);
  const now = new Date().toISOString();
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) {
      const existing = asRecord(snapshot.data().payload);
      if (existing && existing.id === payload.id && existing.amount === payload.amount
        && existing.shiftId === payload.shiftId && existing.date === payload.date) return 'duplicate' as const;
      throw needsReviewError('တူညီသော Cash Movement ID အတွက် Cloud အချက်အလက် မတူပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    }
    const shiftSnapshot = await transaction.get(shiftRef);
    if (!shiftSnapshot.exists()) throw needsReviewError('Cash Movement အတွက် Shift ကို Cloud မှာ မတွေ့ပါ။');
    const shiftPayload = asRecord(shiftSnapshot.data().payload);
    if (!shiftPayload || shiftPayload.branchId !== entry.branchId) throw needsReviewError('Cash Movement ၏ Shift Branch မကိုက်ညီပါ။');
    if (shiftPayload.closedAt) throw needsReviewError('Shift ပိတ်ထားပြီးဖြစ်၍ Cash Movement ကို Cloud သို့ မပို့နိုင်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    transaction.set(ref, envelope('cashMovements', entry.branchId, uid, now, payload));
    return 'created' as const;
  });
}

async function applyCustomerPayment(
  db: Firestore, businessId: string, entry: CashierCashQueueEntry, uid: string,
): Promise<CashierCashApplyOutcome> {
  if (!entry.payment || !entry.settlement) throw new Error('Customer Payment မမှန်ကန်ပါ။');
  const payment = entry.payment;
  const settlement = entry.settlement;
  const payload = buildCashierCustomerPaymentPayload(payment, entry.branchId);
  if (!payload) throw needsReviewError('Customer Payment အချက်အလက် မမှန်ကန်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
  if (!settlement.saleId || settlement.saleId !== payment.saleId) {
    throw needsReviewError('Customer Payment နှင့် ချိတ်ထားသော Credit Sale မကိုက်ညီပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
  }
  if (!Number.isFinite(settlement.paidAmount) || !Number.isFinite(settlement.dueAmount)
    || settlement.paidAmount < 0 || settlement.dueAmount < 0) {
    throw needsReviewError('Customer Credit လက်ကျန်အချက်အလက် မမှန်ကန်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
  }
  const paymentRef = branchDocRef(db, businessId, 'customerPayments', entry.branchId, entry.recordId);
  const saleRef = branchDocRef(db, businessId, 'sales', entry.branchId, settlement.saleId);
  const now = new Date().toISOString();
  return runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef);
    const saleSnapshot = await transaction.get(saleRef);
    if (!saleSnapshot.exists()) {
      if (entry.attempts < MISSING_CREDIT_SALE_ATTEMPTS) {
        // The Sale's own durable queue may still be ahead of this entry.
        throw new Error('Customer Credit Sale ကို Cloud မှာ မတွေ့သေးပါ။ Sale Sync ပြီးမှ ပြန်ပို့ပါမယ်။');
      }
      throw needsReviewError('Customer Credit Sale ကို Cloud မှာ မတွေ့ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    }
    const saleData = saleSnapshot.data();
    const sale = asRecord(saleData.payload);
    if (!sale || saleData.kind !== 'sales' || saleData.branchId !== entry.branchId || saleData.deleted === true) {
      throw needsReviewError('Customer Credit Sale အချက်အလက် မမှန်ကန်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    }
    if (sale.status !== 'completed' || sale.paymentMethod !== 'Credit' || sale.customerId !== payment.customerId) {
      throw needsReviewError('Customer Payment နှင့် Credit Sale အချက်အလက် မကိုက်ညီပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    }
    const total = Number(sale.total);
    const currentPaid = Number(sale.paidAmount ?? 0);
    // The Customer Payment Rules require a numeric dueAmount on the Cloud Sale.
    if (typeof sale.dueAmount !== 'number' || !Number.isFinite(sale.dueAmount)) {
      throw needsReviewError('Cloud Credit Sale တွင် dueAmount အချက်အလက် မရှိပါ။ Owner က Sale ကို ပြန် Sync လုပ်ရန်လိုပါတယ်။');
    }
    const currentDue = Number(sale.dueAmount);
    if (!Number.isFinite(total) || !Number.isFinite(currentPaid) || !Number.isFinite(currentDue)
      || Math.abs(settlement.paidAmount + settlement.dueAmount - total) > 1e-6) {
      throw needsReviewError('Customer Credit Sale လက်ကျန်နှင့် ပေးချေမှု မကိုက်ညီပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    }

    if (paymentSnapshot.exists()) {
      const existing = asRecord(paymentSnapshot.data().payload);
      if (!existing || existing.id !== payload.id || existing.amount !== payload.amount
        || existing.saleId !== payload.saleId || existing.date !== payload.date) {
        throw needsReviewError('တူညီသော Customer Payment ID အတွက် Cloud အချက်အလက် မတူပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
      }
      if (currentPaid >= settlement.paidAmount - 1e-6 && currentDue <= settlement.dueAmount + 1e-6) return 'duplicate' as const;
    }

    const expectedPaidBefore = settlement.paidAmount - payment.amount;
    const expectedDueBefore = settlement.dueAmount + payment.amount;
    if (Math.abs(currentPaid - expectedPaidBefore) > 1e-6 || Math.abs(currentDue - expectedDueBefore) > 1e-6) {
      throw needsReviewError('Cloud ငွေလက်ခံစာရင်း ပြောင်းလဲနေပါတယ်။ အကြွေးလက်ကျန် မကိုက်ညီသောကြောင့် Owner စစ်ဆေးရန်လိုပါတယ်။');
    }

    transaction.update(saleRef, {
      'payload.paidAmount': settlement.paidAmount,
      'payload.dueAmount': settlement.dueAmount,
      updatedAt: now,
      updatedBy: uid,
    });
    if (!paymentSnapshot.exists()) transaction.set(paymentRef, envelope('customerPayments', entry.branchId, uid, now, payload));
    return 'created' as const;
  });
}

export async function applyCashierCashEntry(
  db: Firestore,
  businessId: string,
  entry: CashierCashQueueEntry,
  uid: string,
): Promise<CashierCashApplyOutcome> {
  if (entry.kind === 'shift-open') return applyShiftOpen(db, businessId, entry, uid);
  if (entry.kind === 'shift-close') return applyShiftClose(db, businessId, entry, uid);
  if (entry.kind === 'cash-movement') return applyMovement(db, businessId, entry, uid);
  return applyCustomerPayment(db, businessId, entry, uid);
}
