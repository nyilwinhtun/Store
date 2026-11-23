import type { CashMovement, CashShift, CustomerPayment } from '../store/usePosStore';

const SHIFT_NOTE_LIMIT = 500;
const SHIFT_CLOSE_NOTE_LIMIT = 1000;
const MOVEMENT_NOTE_LIMIT = 500;
const PAYMENT_NOTE_LIMIT = 500;
const ACTOR_NAME_LIMIT = 120;
const KPAY_ACCOUNT_SNAPSHOT_LIMIT = 120;

function trimmed(value: string | undefined, limit: number): string {
  return (value || '').trim().slice(0, limit);
}

function isMoney(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Payload accepted by the Cashier cashShifts create rule. */
export function buildCashierShiftOpenPayload(
  shift: CashShift,
  branchId: string,
  uid: string,
  fallbackName: string,
): Record<string, unknown> | null {
  if (!shift.id || !shift.openedAt || !isMoney(shift.openingCash)) return null;
  if (shift.openedByUid && shift.openedByUid !== uid) return null;
  return {
    id: shift.id,
    branchId,
    openedAt: shift.openedAt,
    openedBy: trimmed(shift.openedBy, ACTOR_NAME_LIMIT) || fallbackName,
    ...(shift.openedByUid === uid ? { openedByUid: uid } : {}),
    openingCash: shift.openingCash,
    note: trimmed(shift.note, SHIFT_NOTE_LIMIT),
  };
}

/**
 * Close payload derived from the Cloud opening payload so fields the Rules
 * treat as immutable are copied verbatim. Returns null when the local record
 * disagrees with the Cloud opener and an Owner review is required.
 */
export function buildCashierShiftClosePayload(
  previous: Record<string, unknown>,
  shift: CashShift,
  branchId: string,
  uid: string,
  fallbackName: string,
): Record<string, unknown> | null {
  if (!shift.id || !shift.closedAt) return null;
  if (!isMoney(shift.closingCash) || !isMoney(shift.expectedCash)) return null;
  if (shift.openedByUid && shift.openedByUid !== uid) return null;
  if (previous.id !== shift.id || previous.openedAt !== shift.openedAt || previous.openingCash !== shift.openingCash) return null;
  const openedByUid = typeof previous.openedByUid === 'string' ? previous.openedByUid : shift.openedByUid;
  if (openedByUid && openedByUid !== uid) return null;
  return {
    id: shift.id,
    branchId,
    openedAt: shift.openedAt,
    openedBy: typeof previous.openedBy === 'string' && previous.openedBy ? previous.openedBy : trimmed(shift.openedBy, ACTOR_NAME_LIMIT) || fallbackName,
    ...(openedByUid === uid ? { openedByUid: uid } : {}),
    openingCash: shift.openingCash,
    closedAt: shift.closedAt,
    closedByUid: uid,
    closedByName: trimmed(shift.closedByName, ACTOR_NAME_LIMIT) || fallbackName,
    closingCash: shift.closingCash,
    expectedCash: shift.expectedCash,
    variance: shift.closingCash - shift.expectedCash,
    note: trimmed(shift.note, SHIFT_CLOSE_NOTE_LIMIT),
  };
}

/** Payload accepted by the Cashier cashMovements create rule. */
export function buildCashierMovementPayload(
  movement: CashMovement,
  branchId: string,
  uid: string,
  fallbackName: string,
): Record<string, unknown> | null {
  if (!movement.id || !movement.shiftId || !movement.date) return null;
  if (movement.direction !== 'in' && movement.direction !== 'out') return null;
  if (!Number.isFinite(movement.amount) || movement.amount <= 0) return null;
  if (movement.createdByUid && movement.createdByUid !== uid) return null;
  const note = trimmed(movement.note, MOVEMENT_NOTE_LIMIT);
  if (!note) return null;
  return {
    id: movement.id,
    branchId,
    shiftId: movement.shiftId,
    date: movement.date,
    direction: movement.direction,
    amount: movement.amount,
    note,
    createdByUid: uid,
    createdByName: trimmed(movement.createdByName, ACTOR_NAME_LIMIT) || fallbackName,
  };
}

/** Payload accepted by the Cashier customerPayments create rule. */
export function buildCashierCustomerPaymentPayload(
  payment: CustomerPayment,
  branchId: string,
): Record<string, unknown> | null {
  if (!payment.id || !payment.customerId || !payment.saleId) return null;
  if (!Number.isFinite(payment.amount) || payment.amount <= 0) return null;
  if (payment.paymentMethod && payment.paymentMethod !== 'Cash' && payment.paymentMethod !== 'Transfer') return null;
  return {
    id: payment.id,
    branchId,
    customerId: payment.customerId,
    saleId: payment.saleId,
    amount: payment.amount,
    date: payment.date,
    note: trimmed(payment.note, PAYMENT_NOTE_LIMIT),
    ...(payment.paymentMethod ? { paymentMethod: payment.paymentMethod } : {}),
    ...(payment.kpayAccountNameSnapshot ? { kpayAccountNameSnapshot: trimmed(payment.kpayAccountNameSnapshot, KPAY_ACCOUNT_SNAPSHOT_LIMIT) } : {}),
    ...(payment.kpayAccountNumberSnapshot ? { kpayAccountNumberSnapshot: trimmed(payment.kpayAccountNumberSnapshot, KPAY_ACCOUNT_SNAPSHOT_LIMIT) } : {}),
    ...(payment.kpayAccountLabelSnapshot ? { kpayAccountLabelSnapshot: trimmed(payment.kpayAccountLabelSnapshot, KPAY_ACCOUNT_SNAPSHOT_LIMIT) } : {}),
    ...(typeof payment.kpayQrVersionSnapshot === 'number' && Number.isFinite(payment.kpayQrVersionSnapshot) ? { kpayQrVersionSnapshot: payment.kpayQrVersionSnapshot } : {}),
  };
}
