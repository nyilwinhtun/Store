import { test } from 'node:test';
import assert from 'node:assert/strict';

const moduleUrl = new URL('../.qa-build/cashierCashRecords.mjs', import.meta.url);
const {
  buildCashierShiftOpenPayload,
  buildCashierShiftClosePayload,
  buildCashierMovementPayload,
  buildCashierCustomerPaymentPayload,
} = await import(moduleUrl.href);

const UID = 'cashier-uid-1';
const BRANCH = 'branch-a';
const OPEN_KEYS = ['branchId', 'id', 'note', 'openedAt', 'openedBy', 'openedByUid', 'openingCash'];
const CLOSE_KEYS = [
  'branchId', 'closedAt', 'closedByName', 'closedByUid', 'closingCash', 'expectedCash',
  'id', 'note', 'openedAt', 'openedBy', 'openedByUid', 'openingCash', 'variance',
];
const MOVEMENT_KEYS = [
  'amount', 'branchId', 'createdByName', 'createdByUid', 'date', 'direction', 'id', 'note', 'shiftId',
];
const PAYMENT_KEYS = ['amount', 'branchId', 'customerId', 'date', 'id', 'note', 'paymentMethod', 'saleId'];

function baseShift(overrides = {}) {
  return {
    id: 'shift-1',
    branchId: BRANCH,
    openedAt: '2026-11-13T01:00:00.000Z',
    openedBy: 'Test Cashier',
    openedByUid: UID,
    openingCash: 1000,
    note: 'opening',
    ...overrides,
  };
}

function baseMovement(overrides = {}) {
  return {
    id: 'movement-1',
    branchId: BRANCH,
    shiftId: 'shift-1',
    date: '2026-11-13T02:00:00.000Z',
    direction: 'in',
    amount: 250,
    note: 'Cash in',
    createdByName: 'Test Cashier',
    ...overrides,
  };
}

function basePayment(overrides = {}) {
  return {
    id: 'payment-1',
    branchId: BRANCH,
    customerId: 'customer-1',
    saleId: 'sale-1',
    amount: 500,
    date: '2026-11-13T03:00:00.000Z',
    note: 'credit payment',
    paymentMethod: 'Cash',
    ...overrides,
  };
}

test('shift open payload contains exactly the Rule allowlist', () => {
  const payload = buildCashierShiftOpenPayload(baseShift(), BRANCH, UID, 'Cashier');
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload).sort(), OPEN_KEYS);
  assert.equal(payload.branchId, BRANCH);
  assert.equal(payload.openedByUid, UID);
  assert.equal(payload.openingCash, 1000);
});

test('shift open payload omits openedByUid when the shift has no actor uid', () => {
  const payload = buildCashierShiftOpenPayload(baseShift({ openedByUid: undefined }), BRANCH, UID, 'Cashier');
  assert.ok(payload);
  assert.equal('openedByUid' in payload, false);
  assert.equal(payload.openedBy, 'Test Cashier');
});

test('shift open payload rejects foreign uid, invalid cash, and missing openedAt', () => {
  assert.equal(buildCashierShiftOpenPayload(baseShift({ openedByUid: 'other-uid' }), BRANCH, UID, 'Cashier'), null);
  assert.equal(buildCashierShiftOpenPayload(baseShift({ openingCash: -1 }), BRANCH, UID, 'Cashier'), null);
  assert.equal(buildCashierShiftOpenPayload(baseShift({ openedAt: '' }), BRANCH, UID, 'Cashier'), null);
});

test('shift note is trimmed to the Rule limits', () => {
  const payload = buildCashierShiftOpenPayload(baseShift({ note: `  ${'x'.repeat(900)}  ` }), BRANCH, UID, 'Cashier');
  assert.ok(payload);
  assert.equal(payload.note.length, 500);
});

test('shift close payload copies immutable opening fields and recomputes variance', () => {
  const previous = {
    id: 'shift-1', branchId: BRANCH, openedAt: '2026-11-13T01:00:00.000Z', openedBy: 'Original Opener',
    openedByUid: UID, openingCash: 1000, note: 'opening',
  };
  const payload = buildCashierShiftClosePayload(
    previous,
    baseShift({ closedAt: '2026-11-13T04:00:00.000Z', closingCash: 900, expectedCash: 1000, closedByName: 'Test Cashier', note: 'closing' }),
    BRANCH,
    UID,
    'Cashier',
  );
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload).sort(), CLOSE_KEYS);
  assert.equal(payload.openedBy, 'Original Opener');
  assert.equal(payload.openedAt, previous.openedAt);
  assert.equal(payload.closedByUid, UID);
  assert.equal(payload.variance, -100);
});

test('shift close payload rejects Cloud/local mismatches and invalid amounts', () => {
  const previous = { id: 'shift-1', openedAt: '2026-11-13T01:00:00.000Z', openedBy: 'Opener', openingCash: 1000 };
  const closed = baseShift({ closedAt: '2026-11-13T04:00:00.000Z', closingCash: 900, expectedCash: 1000 });
  assert.equal(buildCashierShiftClosePayload({ ...previous, openedAt: '2026-11-13T00:00:00.000Z' }, closed, BRANCH, UID, 'Cashier'), null);
  assert.equal(buildCashierShiftClosePayload(previous, { ...closed, closingCash: -5 }, BRANCH, UID, 'Cashier'), null);
  assert.equal(buildCashierShiftClosePayload(previous, { ...closed, closedAt: '' }, BRANCH, UID, 'Cashier'), null);
  assert.equal(buildCashierShiftClosePayload({ ...previous, openedByUid: 'other-uid' }, closed, BRANCH, UID, 'Cashier'), null);
});

test('movement payload drops non-Rule fields and stamps the authenticated uid', () => {
  const payload = buildCashierMovementPayload(
    { ...baseMovement(), sourceSettlementId: 'settlement-1' },
    BRANCH,
    UID,
    'Cashier',
  );
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload).sort(), MOVEMENT_KEYS);
  assert.equal('sourceSettlementId' in payload, false);
  assert.equal(payload.createdByUid, UID);
  assert.equal(payload.createdByName, 'Test Cashier');
});

test('movement payload rejects empty notes, zero amounts, and foreign uid', () => {
  assert.equal(buildCashierMovementPayload(baseMovement({ note: '   ' }), BRANCH, UID, 'Cashier'), null);
  assert.equal(buildCashierMovementPayload(baseMovement({ amount: 0 }), BRANCH, UID, 'Cashier'), null);
  assert.equal(buildCashierMovementPayload(baseMovement({ direction: 'sideways' }), BRANCH, UID, 'Cashier'), null);
  assert.equal(buildCashierMovementPayload(baseMovement({ createdByUid: 'other-uid' }), BRANCH, UID, 'Cashier'), null);
});

test('customer payment payload contains exactly the Rule allowlist', () => {
  const payload = buildCashierCustomerPaymentPayload(basePayment(), BRANCH);
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload).sort(), PAYMENT_KEYS);
  assert.equal(payload.branchId, BRANCH);
  assert.equal(payload.paymentMethod, 'Cash');
});

test('customer payment payload omits an unknown/absent method and limits notes', () => {
  const withoutMethod = buildCashierCustomerPaymentPayload(basePayment({ paymentMethod: undefined }), BRANCH);
  assert.ok(withoutMethod);
  assert.equal('paymentMethod' in withoutMethod, false);
  const limited = buildCashierCustomerPaymentPayload(basePayment({ note: 'y'.repeat(800) }), BRANCH);
  assert.ok(limited);
  assert.equal(limited.note.length, 500);
});

test('customer payment payload rejects invalid amount and method', () => {
  assert.equal(buildCashierCustomerPaymentPayload(basePayment({ amount: 0 }), BRANCH), null);
  assert.equal(buildCashierCustomerPaymentPayload(basePayment({ paymentMethod: 'KPay' }), BRANCH), null);
  assert.equal(buildCashierCustomerPaymentPayload(basePayment({ saleId: '' }), BRANCH), null);
});

test('customer payment payload carries KPay account snapshots for transfer payments', () => {
  const payload = buildCashierCustomerPaymentPayload(basePayment({
    paymentMethod: 'Transfer',
    kpayAccountNameSnapshot: '  Owner Account  ',
    kpayAccountNumberSnapshot: '09510000000',
    kpayAccountLabelSnapshot: 'KPay',
    kpayQrVersionSnapshot: 4,
  }), BRANCH);
  assert.ok(payload);
  assert.equal(payload.kpayAccountNameSnapshot, 'Owner Account');
  assert.equal(payload.kpayAccountNumberSnapshot, '09510000000');
  assert.equal(payload.kpayAccountLabelSnapshot, 'KPay');
  assert.equal(payload.kpayQrVersionSnapshot, 4);
});

test('customer payment payload omits KPay snapshots when none were captured', () => {
  const payload = buildCashierCustomerPaymentPayload(basePayment({ paymentMethod: 'Cash' }), BRANCH);
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload).sort(), PAYMENT_KEYS);
});
