import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cashierCursorKey,
  clearCashierCursors,
  incrementalCursorQueryStart,
  mergeById,
  nextCashierCursor,
  readCashierCursor,
  saveCashierCursor,
  shouldUseIncrementalCursor,
} from '../.qa-build/cashierSyncCursor.mjs';

const memoryStorage = () => {
  const store = new Map();
  return {
    get length() { return store.size; },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
};
globalThis.localStorage = memoryStorage();

test('incremental listening requires cursor, local history, hydration and no pending reset', () => {
  const base = { cursor: '2026-01-01T00:00:00.000Z', localRecordCount: 3, resetPending: false, hydrated: true };
  assert.equal(shouldUseIncrementalCursor(base), true);
  assert.equal(shouldUseIncrementalCursor({ ...base, cursor: null }), false);
  assert.equal(shouldUseIncrementalCursor({ ...base, localRecordCount: 0 }), false);
  assert.equal(shouldUseIncrementalCursor({ ...base, resetPending: true }), false);
  assert.equal(shouldUseIncrementalCursor({ ...base, hydrated: false }), false);
});

test('incremental query start overlaps the stored cursor by two minutes', () => {
  assert.equal(incrementalCursorQueryStart('2026-05-10T12:00:00.000Z'), '2026-05-10T11:58:00.000Z');
  assert.equal(incrementalCursorQueryStart('not-a-date'), 'not-a-date');
});

test('next cursor advances only on valid newer updatedAt values', () => {
  assert.equal(nextCashierCursor(null, []), null);
  assert.equal(nextCashierCursor(null, [null, undefined, 'garbage']), null);
  assert.equal(
    nextCashierCursor(null, ['2026-05-10T08:00:00.000Z', '2026-05-10T09:30:00.000Z', 'bad']),
    '2026-05-10T09:30:00.000Z',
  );
  assert.equal(
    nextCashierCursor('2026-05-10T10:00:00.000Z', ['2026-05-10T09:00:00.000Z', null]),
    '2026-05-10T10:00:00.000Z',
  );
});

test('cursors round-trip per business, cashier and branch and can be cleared', () => {
  const key = cashierCursorKey('biz', 'cashier-1', 'branch-a', 'cashShifts');
  assert.equal(readCashierCursor('biz', 'cashier-1', 'branch-a', 'cashShifts'), null);
  saveCashierCursor('biz', 'cashier-1', 'branch-a', 'cashShifts', '2026-05-10T10:00:00.000Z');
  saveCashierCursor('biz', 'cashier-1', 'branch-a', 'cashMovements', '2026-05-10T10:00:00.000Z');
  saveCashierCursor('biz', 'cashier-2', 'branch-a', 'cashShifts', '2026-05-10T10:00:00.000Z');
  saveCashierCursor('biz', 'cashier-1', 'branch-a', 'customerPayments', 'not-a-date');
  assert.equal(readCashierCursor('biz', 'cashier-1', 'branch-a', 'cashShifts'), '2026-05-10T10:00:00.000Z');
  assert.equal(readCashierCursor('biz', 'cashier-1', 'branch-a', 'customerPayments'), null);
  assert.equal(readCashierCursor('biz', 'cashier-2', 'branch-a', 'cashShifts'), '2026-05-10T10:00:00.000Z');
  clearCashierCursors('biz', 'cashier-1');
  assert.equal(readCashierCursor('biz', 'cashier-1', 'branch-a', 'cashShifts'), null);
  assert.equal(readCashierCursor('biz', 'cashier-1', 'branch-a', 'cashMovements'), null);
  assert.equal(localStorage.getItem(key), null);
  assert.equal(readCashierCursor('biz', 'cashier-2', 'branch-a', 'cashShifts'), '2026-05-10T10:00:00.000Z');
});

test('mergeById keeps complete history without duplicating updated records', () => {
  const persisted = [
    { id: 'm1', amount: 100 },
    { id: 'm2', amount: -40 },
    { id: 'm3', amount: 25 },
  ];
  const incrementalWindow = [
    { id: 'm3', amount: 30 },
    { id: 'm4', amount: 12 },
  ];
  const merged = mergeById(persisted, incrementalWindow);
  assert.deepEqual(merged.map((entry) => entry.id).sort(), ['m1', 'm2', 'm3', 'm4']);
  assert.equal(merged.find((entry) => entry.id === 'm3').amount, 30);

  const total = (rows) => rows.reduce((sum, row) => sum + row.amount, 0);
  // The union of persisted history and the incremental window must produce the
  // exact same ledger totals as listening to the full collection.
  const fullSnapshot = [
    { id: 'm1', amount: 100 },
    { id: 'm2', amount: -40 },
    { id: 'm3', amount: 30 },
    { id: 'm4', amount: 12 },
  ];
  assert.equal(total(merged), total(fullSnapshot));
  assert.equal(merged.length, fullSnapshot.length);
});

test('mergeById is idempotent and preserves local only records', () => {
  const local = [{ id: 's1', total: 10 }, { id: 's2', total: 20 }];
  const once = mergeById(local, [{ id: 's2', total: 25 }]);
  const twice = mergeById(once, [{ id: 's2', total: 25 }]);
  assert.deepEqual(twice, once);
  assert.equal(twice.reduce((sum, row) => sum + row.total, 0), 35);
});
