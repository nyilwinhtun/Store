import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, readRecord } from './support/fakeFirestore.mjs';
import { applyCashierCashEntry } from '../.qa-build/cashierCashApply.mjs';

const BUSINESS = 'biz-1';
const BRANCH = 'branch-a';
const UID = 'cashier-uid-1';
const CUSTOMER = 'customer-1';

const recordPath = (kind, id) => `businesses/${BUSINESS}/branches/${BRANCH}/${kind}/${id}`;

let db;
beforeEach(() => {
  db = createFakeFirestore();
});

function entry(overrides) {
  return {
    key: `${overrides.kind}:${overrides.recordId}`,
    branchId: BRANCH,
    queuedAt: '2026-11-13T00:00:00.000Z',
    attempts: 0,
    ...overrides,
  };
}

function openShift(overrides = {}) {
  return {
    id: 'shift-1',
    branchId: BRANCH,
    openedAt: '2026-11-13T01:00:00.000Z',
    openedBy: 'Test Cashier',
    openedByUid: UID,
    openingCash: 1000,
    note: '',
    ...overrides,
  };
}

function openEntry(shift = openShift()) {
  return entry({ kind: 'shift-open', recordId: shift.id, shift });
}

function closeShift(overrides = {}) {
  return {
    ...openShift(),
    closedAt: '2026-11-13T09:00:00.000Z',
    closedByUid: UID,
    closedByName: 'Test Cashier',
    closingCash: 900,
    expectedCash: 1000,
    variance: -100,
    note: 'closing',
    ...overrides,
  };
}

function closeEntry(shift = closeShift()) {
  return entry({ kind: 'shift-close', recordId: shift.id, shift });
}

function movement(overrides = {}) {
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

function movementEntry(record = movement()) {
  return entry({ kind: 'cash-movement', recordId: record.id, movement: record });
}

function payment(overrides = {}) {
  return {
    id: 'payment-1',
    branchId: BRANCH,
    customerId: CUSTOMER,
    saleId: 'sale-1',
    amount: 1000,
    date: '2026-11-13T03:00:00.000Z',
    note: '',
    paymentMethod: 'Cash',
    ...overrides,
  };
}

function settlement(paidAmount, dueAmount) {
  return { saleId: 'sale-1', paidAmount, dueAmount };
}

function paymentEntry(record = payment(), settle = settlement(1000, 2000)) {
  return entry({ kind: 'customer-payment', recordId: record.id, payment: record, settlement: settle });
}

function seedCreditSale(overrides = {}) {
  db.records.set(recordPath('sales', 'sale-1'), {
    scope: 'branchRecord',
    kind: 'sales',
    branchId: BRANCH,
    deleted: false,
    updatedAt: '2026-11-13T01:30:00.000Z',
    updatedBy: 'owner-uid',
    payload: {
      id: 'sale-1',
      branchId: BRANCH,
      status: 'completed',
      paymentMethod: 'Credit',
      customerId: CUSTOMER,
      total: 3000,
      paidAmount: 0,
      dueAmount: 3000,
      items: [],
      ...overrides,
    },
  });
}

const isReview = (error) => error?.code === 'failed-precondition';

test('shift open is created once and replays as a duplicate', async () => {
  assert.equal(await applyCashierCashEntry(db, BUSINESS, openEntry(), UID), 'created');
  const stored = readRecord(db, recordPath('cashShifts', 'shift-1'));
  assert.equal(stored.kind, 'cashShifts');
  assert.equal(stored.branchId, BRANCH);
  assert.equal(stored.updatedBy, UID);
  assert.equal(stored.payload.openingCash, 1000);
  assert.equal(stored.payload.openedByUid, UID);
  assert.equal(await applyCashierCashEntry(db, BUSINESS, openEntry(), UID), 'duplicate');
});

test('shift open with a conflicting opening balance requires review and keeps Cloud data', async () => {
  await applyCashierCashEntry(db, BUSINESS, openEntry(), UID);
  const conflicting = openEntry(openShift({ openingCash: 2000 }));
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, conflicting, UID), isReview);
  assert.equal(readRecord(db, recordPath('cashShifts', 'shift-1')).payload.openingCash, 1000);
});

test('shift open rejects a foreign openedByUid without writing', async () => {
  const foreign = openEntry(openShift({ openedByUid: 'other-uid' }));
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, foreign, UID), isReview);
  assert.equal(readRecord(db, recordPath('cashShifts', 'shift-1')), undefined);
});

test('shift close applies from the Cloud opener and preserves opening fields', async () => {
  await applyCashierCashEntry(db, BUSINESS, openEntry(), UID);
  assert.equal(await applyCashierCashEntry(db, BUSINESS, closeEntry(), UID), 'created');
  const stored = readRecord(db, recordPath('cashShifts', 'shift-1')).payload;
  assert.equal(stored.openedAt, '2026-11-13T01:00:00.000Z');
  assert.equal(stored.openingCash, 1000);
  assert.equal(stored.openedBy, 'Test Cashier');
  assert.equal(stored.closedAt, '2026-11-13T09:00:00.000Z');
  assert.equal(stored.closedByUid, UID);
  assert.equal(stored.closingCash, 900);
  assert.equal(stored.variance, -100);
  assert.equal(await applyCashierCashEntry(db, BUSINESS, closeEntry(), UID), 'duplicate');
});

test('shift close needs review when the Cloud shift is missing or already closed at another time', async () => {
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, closeEntry(), UID), isReview);
  assert.equal(readRecord(db, recordPath('cashShifts', 'shift-1')), undefined);

  await applyCashierCashEntry(db, BUSINESS, openEntry(), UID);
  await applyCashierCashEntry(db, BUSINESS, closeEntry(), UID);
  const differentTime = closeEntry(closeShift({ closedAt: '2026-11-13T10:00:00.000Z' }));
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, differentTime, UID), isReview);
  assert.equal(readRecord(db, recordPath('cashShifts', 'shift-1')).payload.closedAt, '2026-11-13T09:00:00.000Z');
});

test('cash movement requires an open shift and records the cashier identity', async () => {
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, movementEntry(), UID), isReview);
  assert.equal(readRecord(db, recordPath('cashMovements', 'movement-1')), undefined);

  await applyCashierCashEntry(db, BUSINESS, openEntry(), UID);
  assert.equal(await applyCashierCashEntry(db, BUSINESS, movementEntry(), UID), 'created');
  const stored = readRecord(db, recordPath('cashMovements', 'movement-1'));
  assert.equal(stored.kind, 'cashMovements');
  assert.equal(stored.payload.createdByUid, UID);
  assert.equal(stored.payload.amount, 250);
  assert.equal('sourceSettlementId' in stored.payload, false);
  assert.equal(await applyCashierCashEntry(db, BUSINESS, movementEntry(), UID), 'duplicate');
});

test('cash movement is rejected after the shift closes', async () => {
  await applyCashierCashEntry(db, BUSINESS, openEntry(), UID);
  await applyCashierCashEntry(db, BUSINESS, closeEntry(), UID);
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, movementEntry(), UID), isReview);
  assert.equal(readRecord(db, recordPath('cashMovements', 'movement-1')), undefined);
});

test('cash movement id reuse with different figures requires review', async () => {
  await applyCashierCashEntry(db, BUSINESS, openEntry(), UID);
  await applyCashierCashEntry(db, BUSINESS, movementEntry(), UID);
  const conflicting = movementEntry(movement({ amount: 999 }));
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, conflicting, UID), isReview);
  assert.equal(readRecord(db, recordPath('cashMovements', 'movement-1')).payload.amount, 250);
});

test('customer payment applies to the credit sale and replays as a duplicate', async () => {
  seedCreditSale();
  assert.equal(await applyCashierCashEntry(db, BUSINESS, paymentEntry(), UID), 'created');
  let sale = readRecord(db, recordPath('sales', 'sale-1')).payload;
  assert.equal(sale.paidAmount, 1000);
  assert.equal(sale.dueAmount, 2000);
  const storedPayment = readRecord(db, recordPath('customerPayments', 'payment-1'));
  assert.equal(storedPayment.kind, 'customerPayments');
  assert.equal(storedPayment.payload.amount, 1000);
  assert.equal(await applyCashierCashEntry(db, BUSINESS, paymentEntry(), UID), 'duplicate');
  sale = readRecord(db, recordPath('sales', 'sale-1')).payload;
  assert.equal(sale.paidAmount, 1000);
  assert.equal(sale.dueAmount, 2000);
});

test('a second customer payment builds on the first settlement', async () => {
  seedCreditSale();
  await applyCashierCashEntry(db, BUSINESS, paymentEntry(), UID);
  const second = paymentEntry(payment({ id: 'payment-2', amount: 500 }), settlement(1500, 1500));
  assert.equal(await applyCashierCashEntry(db, BUSINESS, second, UID), 'created');
  const sale = readRecord(db, recordPath('sales', 'sale-1')).payload;
  assert.equal(sale.paidAmount, 1500);
  assert.equal(sale.dueAmount, 1500);
});

test('stale credit settlement requires review and writes nothing', async () => {
  seedCreditSale();
  await applyCashierCashEntry(db, BUSINESS, paymentEntry(), UID);
  const stale = paymentEntry(payment({ id: 'payment-3', amount: 500 }), settlement(1000, 2000));
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, stale, UID), isReview);
  const sale = readRecord(db, recordPath('sales', 'sale-1')).payload;
  assert.equal(sale.paidAmount, 1000);
  assert.equal(sale.dueAmount, 2000);
  assert.equal(readRecord(db, recordPath('customerPayments', 'payment-3')), undefined);
});

test('missing credit sale is retried while the sale queue catches up, then reviewed', async () => {
  await assert.rejects(
    applyCashierCashEntry(db, BUSINESS, paymentEntry(), UID),
    (error) => error?.code !== 'failed-precondition' && /မတွေ့သေးပါ/.test(error.message),
  );
  assert.equal(readRecord(db, recordPath('customerPayments', 'payment-1')), undefined);

  const exhausted = { ...paymentEntry(), attempts: 5 };
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, exhausted, UID), isReview);
  assert.equal(readRecord(db, recordPath('customerPayments', 'payment-1')), undefined);
});

test('customer payment settlement must reference the payment sale', async () => {
  seedCreditSale();
  const mismatchedSale = paymentEntry(payment(), { saleId: 'another-sale', paidAmount: 1000, dueAmount: 2000 });
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, mismatchedSale, UID), isReview);
  assert.equal(readRecord(db, recordPath('customerPayments', 'payment-1')), undefined);
});

test('customer payment requires a matching credit sale with a numeric due balance', async () => {
  seedCreditSale({ dueAmount: undefined });
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, paymentEntry(), UID), isReview);
  assert.equal(readRecord(db, recordPath('customerPayments', 'payment-1')), undefined);

  seedCreditSale({ paymentMethod: 'Cash' });
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, paymentEntry(), UID), isReview);

  seedCreditSale({ customerId: 'someone-else' });
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, paymentEntry(), UID), isReview);
});

test('payment settlement must reconcile against the sale total', async () => {
  seedCreditSale();
  const mismatched = paymentEntry(payment(), settlement(1000, 1500));
  await assert.rejects(applyCashierCashEntry(db, BUSINESS, mismatched, UID), isReview);
  assert.equal(readRecord(db, recordPath('customerPayments', 'payment-1')), undefined);
  assert.equal(readRecord(db, recordPath('sales', 'sale-1')).payload.dueAmount, 3000);
});

test('malformed cash entries are rejected before any transaction', async () => {
  await assert.rejects(
    applyCashierCashEntry(db, BUSINESS, entry({ kind: 'cash-movement', recordId: 'x' }), UID),
    (error) => error?.code !== 'failed-precondition' && /မမှန်ကန်ပါ/.test(error.message),
  );
  await assert.rejects(
    applyCashierCashEntry(db, BUSINESS, entry({ kind: 'customer-payment', recordId: 'y', payment: payment() }), UID),
    (error) => error?.code !== 'failed-precondition' && /မမှန်ကန်ပါ/.test(error.message),
  );
  assert.equal(db.records.size, 0);
});
