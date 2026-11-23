import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const {
  WorkerSaleError,
  commitSaleThroughWorker,
  issueOfflineAllowanceThroughWorker,
  reconcileOfflineAllowanceThroughWorker,
  resolveWorkerSalesGate,
  returnSaleThroughWorker,
  voidSaleThroughWorker,
  workerEndpointFor,
  workerSalesGate,
} = await import(
  new URL('../../.qa-build/workerSaleClient.mjs', import.meta.url).href
);

const root = fileURLToPath(new URL('../..', import.meta.url));
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

test('the Worker gate allows explicit Staging or Production opt-in with a safe endpoint and keeps emulator disabled', () => {
  const base = { flag: 'true', url: endpoint, mode: 'staging', dev: false };
  assert.equal(resolveWorkerSalesGate(base).enabled, true);
  assert.equal(resolveWorkerSalesGate({ ...base, mode: 'production' }).enabled, true);
  assert.equal(resolveWorkerSalesGate({ ...base, mode: 'production', flag: 'false' }).enabled, false);
  assert.equal(resolveWorkerSalesGate({ ...base, mode: 'production', url: 'http://worker.example.test/api/sales/commit' }).enabled, false);
  assert.equal(resolveWorkerSalesGate({ ...base, mode: 'production', url: 'http://localhost:8787/api/sales/commit', dev: true }).enabled, false);
  assert.equal(resolveWorkerSalesGate({ ...base, mode: 'emulator' }).enabled, false);
  assert.equal(resolveWorkerSalesGate({ ...base, flag: 'false' }).enabled, false);
  assert.equal(resolveWorkerSalesGate({ ...base, url: 'http://worker.example.test/api/sales/commit' }).enabled, false);
  assert.equal(resolveWorkerSalesGate({ ...base, url: 'http://localhost:8787/api/sales/commit', dev: true }).enabled, true);
});

test('derives Worker adjustment and allowance endpoints from the configured commit URL', () => {
  assert.equal(workerEndpointFor(endpoint, '/api/sales/commit'), 'https://worker.example.test/api/sales/commit');
  assert.equal(workerEndpointFor(endpoint, '/api/sales/void'), 'https://worker.example.test/api/sales/void');
  assert.equal(workerEndpointFor(endpoint, '/api/sales/return'), 'https://worker.example.test/api/sales/return');
  assert.equal(workerEndpointFor(endpoint, '/api/offline-allowances'), 'https://worker.example.test/api/offline-allowances');
  assert.equal(
    workerEndpointFor(endpoint, '/api/offline-allowances/reconcile'),
    'https://worker.example.test/api/offline-allowances/reconcile',
  );
});

test('attaches offline allowance and lease metadata to /api/sales/commit and rejects partial metadata', async () => {
  const calls = [];
  const allowance = {
    allowanceId: 'allowance-1',
    allowanceToken: 'tok_abcdefghijklmnopqrstuvwxyz012345',
    leaseId: 'lease-1',
    deviceId: 'dev-12345678',
  };
  const result = await commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', {
    ...request(async (url, init) => {
      calls.push({ url, init });
      return response(200, { ok: true, result: 'created', writeCount: 4 });
    }),
    allowance,
  });
  assert.equal(result, 'created');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.allowanceId, allowance.allowanceId);
  assert.equal(body.allowanceToken, allowance.allowanceToken);
  assert.equal(body.leaseId, allowance.leaseId);
  assert.equal(body.deviceId, allowance.deviceId);

  await assert.rejects(
    commitSaleThroughWorker(sale(), 'cashier-a', 'branch-a', {
      ...request(async () => response(200, { ok: true, result: 'created' })),
      allowance: { ...allowance, leaseId: '' },
    }),
    /Offline Allowance/,
  );
});

test('voidSaleThroughWorker posts strict Worker void payload without uid and handles replay', async () => {
  const calls = [];
  const res = await voidSaleThroughWorker(
    {
      branchId: 'branch-a',
      saleId: 'SALE-1',
      requestId: 'void-SALE-1',
      reason: 'Customer cancelled',
      deviceId: 'dev-12345678',
    },
    request(async (url, init) => {
      calls.push({ url, init });
      return response(200, {
        ok: true,
        result: 'already-committed',
        kind: 'void',
        occurredAt: '2026-11-23T10:00:00.000Z',
        refundStatus: 'cash-refunded',
        refundAmount: 1000,
        total: 1000,
        writeCount: 0,
      });
    }),
  );
  assert.equal(calls[0].url, 'https://worker.example.test/api/sales/void');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${token}`);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    branchId: 'branch-a',
    saleId: 'SALE-1',
    requestId: 'void-SALE-1',
    reason: 'Customer cancelled',
    deviceId: 'dev-12345678',
  });
  assert.equal(body.uid, undefined);
  assert.equal(res.result, 'already-committed');
  assert.equal(res.kind, 'void');
  assert.equal(res.refundAmount, 1000);
});

test('returnSaleThroughWorker posts strict Worker return payload without uid', async () => {
  const calls = [];
  const res = await returnSaleThroughWorker(
    {
      branchId: 'branch-a',
      saleId: 'SALE-1',
      requestId: 'ret-1-SALE-1',
      reason: 'Damaged item',
      deviceId: 'dev-12345678',
      items: [{ productId: 'p1', quantity: 1, disposition: 'damaged', units: [] }],
      refundReference: 'REF-123',
    },
    request(async (url, init) => {
      calls.push({ url, init });
      return response(200, {
        ok: true,
        result: 'created',
        kind: 'return',
        returnId: 'ret-1-SALE-1',
        occurredAt: '2026-11-23T10:05:00.000Z',
        value: 1000,
        refundStatus: 'cash-refunded',
        refundAmount: 1000,
        writeCount: 4,
      });
    }),
  );
  assert.equal(calls[0].url, 'https://worker.example.test/api/sales/return');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.uid, undefined);
  assert.equal(body.refundReference, 'REF-123');
  assert.equal(body.items.length, 1);
  assert.equal(res.result, 'created');
  assert.equal(res.kind, 'return');
  assert.equal(res.returnId, 'ret-1-SALE-1');
});

test('issueOfflineAllowanceThroughWorker and reconcileOfflineAllowanceThroughWorker match Worker contracts', async () => {
  const calls = [];
  const issued = await issueOfflineAllowanceThroughWorker(
    {
      branchId: 'branch-a',
      deviceId: 'dev-12345678',
      leaseId: 'lease-existing',
      items: [{ productId: 'p1', quantity: 2 }],
    },
    request(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return response(200, {
        ok: true,
        result: 'issued',
        allowanceId: 'allowance-99',
        leaseId: 'lease-existing',
        allowanceToken: 'tok_abcdefghijklmnopqrstuvwxyz012345',
        issuedAt: '2026-11-23T10:00:00.000Z',
        expiresAt: '2026-11-24T10:00:00.000Z',
        leaseExpiresAt: '2026-11-26T10:00:00.000Z',
        deviceId: 'dev-12345678',
        items: [{ productId: 'p1', quantity: 2 }],
      });
    }),
  );
  assert.equal(calls[0].url, 'https://worker.example.test/api/offline-allowances');
  assert.equal(issued.allowanceId, 'allowance-99');

  const reconciled = await reconcileOfflineAllowanceThroughWorker(
    { branchId: 'branch-a', allowanceId: 'allowance-99', action: 'release' },
    request(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return response(200, {
        ok: true,
        result: 'released',
        releasedItems: [{ productId: 'p1', quantity: 2 }],
      });
    }),
  );
  assert.equal(calls[1].url, 'https://worker.example.test/api/offline-allowances/reconcile');
  assert.deepEqual(calls[1].body, { branchId: 'branch-a', allowanceId: 'allowance-99', action: 'release' });
  assert.equal(reconciled.result, 'released');
});

test('saleAdjustments routes void/return through Worker when gated and preserves Callable fallback', () => {
  const adjustmentsSource = readFileSync(`${root}/src/lib/saleAdjustments.ts`, 'utf8');
  assert.match(adjustmentsSource, /workerSalesGate\(\)/);
  assert.match(adjustmentsSource, /voidSaleThroughWorker/);
  assert.match(adjustmentsSource, /returnSaleThroughWorker/);
  assert.match(adjustmentsSource, /cashierSaleVoid/);
  assert.match(adjustmentsSource, /cashierSaleReturn/);
});
