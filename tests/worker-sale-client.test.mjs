import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { WorkerSaleError, commitSaleThroughWorker, resolveWorkerSalesGate, workerSalesGate } = await import(
  new URL('../.qa-build/workerSaleClient.mjs', import.meta.url).href
);

const root = fileURLToPath(new URL('..', import.meta.url));
const endpoint = 'https://worker.example.test/api/sales/commit';
const token = 'id-token-for-test';

function sale(overrides = {}) {
  return {
    id: 'SALE-1', branchId: 'branch-a', receiptNo: 'R-1', date: new Date().toISOString(),
    customer: 'Walk-in', paymentMethod: 'Cash', items: [{
      productId: 'p1', name: 'P1', sku: 'P1', quantity: 1, unitPrice: 1000,
      costPrice: 700, mode: 'retail', unit: 'pcs', quantityMode: 'whole',
    }],
    subtotal: 1000, discount: 0, total: 1000, profit: 300, status: 'completed',
    paidAmount: 1000, dueAmount: 0, createdByUid: 'cashier-a', createdByEmail: 'a@example.test',
    cloudSyncStatus: 'pending', cloudSyncError: 'old error',
    ...overrides,
  };
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function request(fetchImpl) {
  return { endpoint, getIdToken: async () => token, fetchImpl };
}

test('posts one sale envelope with a Bearer token and strips sync-only fields', async () => {
  const calls = [];
  const result = await commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', request(async (url, init) => {
    calls.push({ url, init });
    return response(200, { ok: true, result: 'created', readCount: 8, writeCount: 4 });
  }));

  assert.equal(result, 'created');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, endpoint);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${token}`);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.branchId, 'branch-a');
  assert.equal(body.uid, undefined);
  assert.equal(body.sale.cloudSyncStatus, undefined);
  assert.equal(body.sale.cloudSyncError, undefined);
  assert.equal(body.sale.id, 'SALE-1');
});

test('accepts an already-committed replay without a second write', async () => {
  let calls = 0;
  const result = await commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', request(async () => {
    calls += 1;
    return response(200, { ok: true, result: 'already-committed', writeCount: 0 });
  }));
  assert.equal(result, 'already-committed');
  assert.equal(calls, 1);
});

test('maps expired-hold to Owner review without retry', async () => {
  await assert.rejects(
    commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', request(async () => response(409, {
      ok: false, code: 'expired-hold', message: '24 နာရီ ကျော်ပါပြီ။',
    }))),
    (error) => {
      assert.ok(error instanceof WorkerSaleError);
      assert.equal(error.code, 'expired-hold');
      assert.equal(error.needsReview, true);
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test('maps authorization-expired to review and generic 401 to retry', async () => {
  await assert.rejects(
    commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', request(async () => response(401, {
      ok: false, code: 'authorization-expired', message: 'ပြန် Login လုပ်ပါ။',
    }))),
    (error) => error.code === 'authorization-expired' && error.needsReview === true && error.retryable === false,
  );
  await assert.rejects(
    commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', request(async () => response(401, {
      ok: false, code: 'unauthenticated', message: 'Login လိုအပ်ပါတယ်။',
    }))),
    (error) => error.code === 'unauthenticated' && error.needsReview === false && error.retryable === true,
  );
});

test('maps 503 and network loss to transient retry', async () => {
  await assert.rejects(
    commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', request(async () => response(503, {
      ok: false, code: 'unavailable', message: 'ခဏနေမှ ပြန်စမ်းပါ။',
    }))),
    (error) => error.retryable === true && error.needsReview === false,
  );
  await assert.rejects(
    commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', request(async () => { throw new TypeError('offline'); })),
    (error) => error.code === 'worker/network' && error.retryable === true && error.needsReview === false,
  );
});

test('maps permission-denied to review', async () => {
  await assert.rejects(
    commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', request(async () => response(403, {
      ok: false, code: 'permission-denied', message: 'ခွင့်မရှိပါ။',
    }))),
    (error) => error.needsReview === true && error.retryable === false,
  );
});

test('rejects a UID/branch mismatch and a non-HTTPS endpoint before fetch', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(200, { result: 'created' }); };
  await assert.rejects(commitSaleThroughWorker(sale(), 'cashier-b', 'branch-a', request(fetchImpl)), /UID/);
  await assert.rejects(commitSaleThroughWorker(sale(), 'cashier-a', 'branch-b', request(fetchImpl)), /Branch/);
  await assert.rejects(
    commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', { ...request(fetchImpl), endpoint: 'http://worker.example.test/api/sales/commit' }),
    /HTTPS/,
  );
  assert.equal(calls, 0);
});

test('the Worker gate stays off in this build and checkout routes through it only when enabled', () => {
  assert.equal(workerSalesGate().enabled, false);
  const syncSource = readFileSync(`${root}/src/lib/cashierSalesSync.ts`, 'utf8');
  assert.match(syncSource, /workerSalesGate\(\)/);
  assert.match(syncSource, /commitSaleThroughWorker/);
  assert.match(syncSource, /commitCashierUnitSaleToCloud/);
});

test('the Worker gate requires an explicit Staging build and a safe endpoint', () => {
  const base = { flag: 'true', url: endpoint, mode: 'staging', dev: false };
  assert.equal(resolveWorkerSalesGate(base).enabled, true);
  assert.equal(resolveWorkerSalesGate({ ...base, mode: 'production' }).enabled, false);
  assert.equal(resolveWorkerSalesGate({ ...base, mode: 'emulator' }).enabled, false);
  assert.equal(resolveWorkerSalesGate({ ...base, flag: 'false' }).enabled, false);
  assert.equal(resolveWorkerSalesGate({ ...base, url: 'http://worker.example.test/api/sales/commit' }).enabled, false);
  assert.equal(resolveWorkerSalesGate({ ...base, url: 'http://localhost:8787/api/sales/commit', dev: true }).enabled, true);
});
