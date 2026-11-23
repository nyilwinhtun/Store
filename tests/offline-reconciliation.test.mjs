import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const BUNDLE = pathToFileURL(resolve(process.cwd(), '.qa-build/cashierSalesSync.mjs')).href;
const queue = await import(BUNDLE);

const UID_A = 'cashier-a';
const UID_B = 'cashier-b';
const BRANCH = 'branch-a';

function sale(id, overrides = {}) {
  return {
    id,
    branchId: BRANCH,
    receiptNo: `POS-${id}`,
    date: '2026-11-15T10:00:00.000Z',
    customer: 'Walk-in',
    paymentMethod: 'Cash',
    subtotal: 1000,
    discount: 0,
    total: 1000,
    profit: 300,
    status: 'completed',
    createdByUid: UID_A,
    paidAmount: 1000,
    dueAmount: 0,
    items: [{
      productId: 'P1', name: 'Product P1', sku: 'P1', quantity: 1, unitPrice: 1000,
      costPrice: 700, mode: 'retail', stockAtAdd: 20, unit: 'pcs', quantityMode: 'whole',
      batchAllocations: [{ batchId: 'B1', quantity: 1 }],
      stockUnitSelections: [{ unitId: 'U1', barcode: 'BC-U1', batchId: 'B1' }],
    }],
    ...overrides,
  };
}

function resetFake() {
  const state = {
    calls: 0,
    sales: new Map(),
    stock: new Map([['P1', 20]]),
    barcodeTransitions: [],
    dropAfterCommitOnce: false,
    dropUsed: false,
    rejectNext: null,
    expectedBatch: null,
  };
  globalThis.__commitFake = async (candidate) => {
    state.calls += 1;
    const batchId = candidate.items?.[0]?.batchAllocations?.[0]?.batchId;
    if (state.expectedBatch && batchId !== state.expectedBatch) {
      const error = new Error('Cloud Stock Batch မကိုက်ညီပါ။');
      error.code = 'functions/failed-precondition';
      throw error;
    }
    if (state.rejectNext) {
      const { code, message } = state.rejectNext;
      state.rejectNext = null;
      const error = new Error(message);
      error.code = code;
      throw error;
    }
    if (state.dropAfterCommitOnce && !state.dropUsed) {
      state.dropUsed = true;
      applyOnce(state, candidate);
      const error = new TypeError('simulated network loss after commit');
      error.code = 'functions/unavailable';
      throw error;
    }
    if (state.sales.has(candidate.id)) return 'already-committed';
    applyOnce(state, candidate);
    return 'created';
  };
  globalThis.__commitState = state;
  globalThis.__durableStore = new Map();
}

function applyOnce(state, candidate) {
  if (state.sales.has(candidate.id)) return;
  state.sales.set(candidate.id, structuredClone(candidate));
  const line = candidate.items[0];
  state.stock.set(line.productId, (state.stock.get(line.productId) || 0) - line.quantity);
  for (const selection of line.stockUnitSelections || []) {
    state.barcodeTransitions.push(`${selection.unitId}:sold`);
  }
}

beforeEach(() => {
  resetFake();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
    writable: false,
  });
});

test('a pending sale survives a simulated browser restart', async () => {
  navigator.onLine = false;
  const queued = await queue.submitCashierSale(sale('RESTART-1'), UID_A, BRANCH);
  assert.equal(queued, 'queued');
  assert.equal(globalThis.__commitState.calls, 0);

  const restarted = await import(`${BUNDLE}?restart=1`);
  const pending = await restarted.readCashierSaleQueue(UID_A, BRANCH);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].sale.id, 'RESTART-1');

  navigator.onLine = true;
  const flushed = await restarted.flushCashierSaleQueue(UID_A, BRANCH);
  assert.deepEqual(
    { synced: flushed.synced, pending: flushed.pending, needsReview: flushed.needsReview },
    { synced: 1, pending: 0, needsReview: 0 },
  );
  assert.equal(globalThis.__commitState.sales.size, 1);
});

test('disconnect and reconnect commit the queued sale exactly once', async () => {
  navigator.onLine = false;
  await queue.enqueueCashierSale(sale('RECONNECT-1'), UID_A, BRANCH);
  const offlineFlush = await queue.flushCashierSaleQueue(UID_A, BRANCH);
  assert.equal(offlineFlush.pending, 1);
  assert.equal(globalThis.__commitState.calls, 0);

  navigator.onLine = true;
  const first = await queue.flushCashierSaleQueue(UID_A, BRANCH);
  assert.equal(first.synced, 1);
  assert.equal(first.pending, 0);
  const after = await queue.flushCashierSaleQueue(UID_A, BRANCH);
  assert.equal(after.synced, 0);
  assert.equal(globalThis.__commitState.calls, 1);
  assert.equal(globalThis.__commitState.sales.size, 1);
  assert.equal(globalThis.__commitState.stock.get('P1'), 19);
});

test('network loss after the server commit retries the same fingerprint without double stock', async () => {
  globalThis.__commitState.dropAfterCommitOnce = true;
  const result = await queue.submitCashierSale(sale('TIMEOUT-1'), UID_A, BRANCH);
  assert.equal(result, 'queued');
  assert.equal(globalThis.__commitState.sales.size, 1);
  const pending = await queue.readCashierSaleQueue(UID_A, BRANCH);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].needsReview, false);
  assert.equal(pending[0].attempts, 1);

  const flushed = await queue.flushCashierSaleQueue(UID_A, BRANCH);
  assert.equal(flushed.synced, 1);
  assert.equal(flushed.pending, 0);
  assert.equal(globalThis.__commitState.sales.size, 1);
  assert.equal(globalThis.__commitState.stock.get('P1'), 19);
  assert.deepEqual(globalThis.__commitState.barcodeTransitions, ['U1:sold']);
});

test('duplicate enqueue is deduplicated and a divergent fingerprint is refused', async () => {
  navigator.onLine = false;
  const original = sale('DUP-1');
  await queue.enqueueCashierSale(original, UID_A, BRANCH);
  await queue.enqueueCashierSale(original, UID_A, BRANCH);
  assert.equal((await queue.readCashierSaleQueue(UID_A, BRANCH)).length, 1);

  await assert.rejects(
    queue.enqueueCashierSale(sale('DUP-1', { total: 500, subtotal: 500, paidAmount: 500 }), UID_A, BRANCH),
    /အခြားအချက်အလက်ရှိနေပါတယ်/,
  );
  const pending = await queue.readCashierSaleQueue(UID_A, BRANCH);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].sale.total, 1000);
});

test('a deterministic rejection stays in Owner Review and is never deleted automatically', async () => {
  globalThis.__commitState.rejectNext = {
    code: 'functions/failed-precondition',
    message: 'Cloud Stock Batch မလုံလောက်ပါ။',
  };
  const result = await queue.submitCashierSale(sale('REVIEW-1'), UID_A, BRANCH);
  assert.equal(result, 'needs-review');
  let pending = await queue.readCashierSaleQueue(UID_A, BRANCH);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].needsReview, true);
  assert.equal(pending[0].attempts, 1);

  const rejectedFlush = await queue.flushCashierSaleQueue(UID_A, BRANCH);
  assert.equal(rejectedFlush.needsReview, 1);
  assert.equal(globalThis.__commitState.calls, 1);
  assert.equal((await queue.readCashierSaleQueue(UID_A, BRANCH)).length, 1);

  await queue.enqueueCashierSale(sale('AFTER-REVIEW'), UID_A, BRANCH);
  const mixed = await queue.flushCashierSaleQueue(UID_A, BRANCH);
  assert.equal(mixed.synced, 1);
  assert.equal(mixed.pending, 1);
  pending = await queue.readCashierSaleQueue(UID_A, BRANCH);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].sale.id, 'REVIEW-1');
  assert.equal(pending[0].needsReview, true);
});

test('a local/cloud Batch mismatch is retained for review without rewriting the local Batch ID', async () => {
  globalThis.__commitState.expectedBatch = 'B2';
  const result = await queue.submitCashierSale(sale('BATCH-1'), UID_A, BRANCH);
  assert.equal(result, 'needs-review');
  const pending = await queue.readCashierSaleQueue(UID_A, BRANCH);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].sale.items[0].batchAllocations[0].batchId, 'B1');
  assert.equal(pending[0].needsReview, true);

  globalThis.__commitState.expectedBatch = 'B1';
  await queue.flushCashierSaleQueue(UID_A, BRANCH);
  const stillPending = await queue.readCashierSaleQueue(UID_A, BRANCH);
  assert.equal(stillPending.length, 1);
  assert.equal(stillPending[0].sale.items[0].batchAllocations[0].batchId, 'B1');
  assert.equal(globalThis.__commitState.sales.size, 0);
});

test('two Cashier devices keep independent durable queues', async () => {
  navigator.onLine = false;
  await queue.enqueueCashierSale(sale('DEVICE-A-1'), UID_A, BRANCH);
  await queue.enqueueCashierSale(sale('DEVICE-B-1', { createdByUid: UID_B }), UID_B, BRANCH);
  assert.equal((await queue.readCashierSaleQueue(UID_A, BRANCH)).length, 1);
  assert.equal((await queue.readCashierSaleQueue(UID_B, BRANCH)).length, 1);

  navigator.onLine = true;
  const a = await queue.flushCashierSaleQueue(UID_A, BRANCH);
  assert.equal(a.synced, 1);
  assert.equal((await queue.readCashierSaleQueue(UID_A, BRANCH)).length, 0);
  assert.equal((await queue.readCashierSaleQueue(UID_B, BRANCH)).length, 1);

  const b = await queue.flushCashierSaleQueue(UID_B, BRANCH);
  assert.equal(b.synced, 1);
  assert.deepEqual([...globalThis.__commitState.sales.keys()].sort(), ['DEVICE-A-1', 'DEVICE-B-1']);
  assert.equal(globalThis.__commitState.stock.get('P1'), 18);
});

test('worker-enabled offline queue attaches cached allowance/lease metadata and handles expired-hold as needsReview', async () => {
  const WORKER_BUNDLE = pathToFileURL(resolve(process.cwd(), '.qa-build/cashierSalesSyncWorker.mjs')).href;
  const workerQueue = await import(WORKER_BUNDLE);
  globalThis.__authUser = { uid: UID_A, getIdToken: async () => 'worker-test-token' };
  const originalFetch = globalThis.fetch;
  try {
    await workerQueue.saveCachedOfflineAllowance(UID_A, BRANCH, {
      allowanceId: 'allowance-1',
      allowanceToken: 'tok_abcdefghijklmnopqrstuvwxyz012345',
      leaseId: 'lease-1',
      deviceId: 'dev-12345678',
      issuedAt: '2026-11-23T09:00:00.000Z',
      expiresAt: '2026-11-24T09:00:00.000Z',
      leaseExpiresAt: '2026-11-26T09:00:00.000Z',
    });

    navigator.onLine = false;
    await workerQueue.enqueueCashierSale(sale('WORKER-OFFLINE-1'), UID_A, BRANCH);
    const queued = await workerQueue.readCashierSaleQueue(UID_A, BRANCH);
    assert.equal(queued.length, 1);
    assert.deepEqual(queued[0].offlineAllowance, {
      allowanceId: 'allowance-1',
      allowanceToken: 'tok_abcdefghijklmnopqrstuvwxyz012345',
      leaseId: 'lease-1',
      deviceId: 'dev-12345678',
    });

    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, result: 'created', writeCount: 4 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    navigator.onLine = true;
    const synced = await workerQueue.flushCashierSaleQueue(UID_A, BRANCH);
    assert.equal(synced.synced, 1);
    assert.equal(synced.pending, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://worker.example.test/api/sales/commit');
    assert.equal(requests[0].body.allowanceId, 'allowance-1');
    assert.equal(requests[0].body.allowanceToken, 'tok_abcdefghijklmnopqrstuvwxyz012345');
    assert.equal(requests[0].body.leaseId, 'lease-1');
    assert.equal(requests[0].body.deviceId, 'dev-12345678');

    navigator.onLine = false;
    await workerQueue.enqueueCashierSale(sale('WORKER-EXPIRED-1'), UID_A, BRANCH);
    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: false,
      code: 'expired-hold',
      message: 'Offline Stock Allowance သက်တမ်း ကုန်ဆုံးပြီး Stock ကို Owner စစ်ဆေးရန် ထိန်းထားပါတယ်။',
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
    navigator.onLine = true;
    const held = await workerQueue.flushCashierSaleQueue(UID_A, BRANCH);
    assert.equal(held.synced, 0);
    assert.equal(held.pending, 1);
    assert.equal(held.needsReview, 1);
    const pendingAfterHold = await workerQueue.readCashierSaleQueue(UID_A, BRANCH);
    assert.equal(pendingAfterHold[0].needsReview, true);
    assert.match(pendingAfterHold[0].lastError || '', /Owner စစ်ဆေးရန်/);
    assert.equal(await workerQueue.readCachedOfflineAllowance(UID_A, BRANCH), null);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__authUser = null;
  }
});
