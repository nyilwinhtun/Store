import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { errorBody, SaleError } from '../src/errors.js';

const ORIGIN = 'https://staging.example.test';
const OTHER_ORIGIN = 'https://evil.example.test';

const verifier = async (token) => {
  if (token !== 'valid-token') throw new SaleError(401, 'unauthenticated', 'Cashier Login လိုအပ်ပါတယ်။');
  return {
    uid: 'cashier-a',
    email: 'cashier.a@example.com',
    name: 'Cashier A',
    authTime: Math.floor(Date.now() / 1000) - 10,
    claims: {},
  };
};

function makeApp({ debug = false, firestoreError = new Error('unexpected'), environment = 'staging' } = {}) {
  const firestore = {
    metrics: { reads: 0, writes: 0, requests: 0, bytesIn: 0, bytesOut: 0 },
    async beginTransaction() { throw firestoreError; },
  };
  return createApp({
    projectId: 'minimart-staging',
    businessId: 'store-staging-main',
    environment,
    firestore,
    verifier,
    allowedOrigins: [ORIGIN],
    debug,
  });
}

async function request(app, { method = 'POST', origin, authorization, headers = {}, body, path = '/api/sales/commit' } = {}) {
  const requestHeaders = { ...headers };
  if (origin) requestHeaders.origin = origin;
  if (authorization) requestHeaders.authorization = authorization;
  if (method === 'POST' && !requestHeaders['content-type']) requestHeaders['content-type'] = 'application/json';
  return app.handle(new Request(`https://worker.example.test${path}`, {
    method,
    headers: requestHeaders,
    body: method === 'POST' ? JSON.stringify(body ?? { branchId: 'branch-a', sale: {} }) : undefined,
  }));
}

test('an approved origin receives CORS headers without allowing credentials', async () => {
  const response = await request(makeApp(), { origin: ORIGIN });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
});

test('an unapproved origin is rejected even with an otherwise valid token', async () => {
  const response = await request(makeApp(), {
    origin: OTHER_ORIGIN,
    authorization: 'Bearer valid-token',
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await response.json()).code, 'origin-denied');
});

test('an approved preflight gets only the required methods and headers', async () => {
  const response = await request(makeApp(), {
    method: 'OPTIONS',
    origin: ORIGIN,
    headers: {
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization, content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
});

test('preflight rejects unapproved origins and unsupported methods or headers', async () => {
  const invalidOrigin = await request(makeApp(), {
    method: 'OPTIONS',
    origin: OTHER_ORIGIN,
    headers: { 'access-control-request-method': 'POST' },
  });
  assert.equal(invalidOrigin.status, 403);
  assert.equal(invalidOrigin.headers.get('access-control-allow-origin'), null);

  const invalidMethod = await request(makeApp(), {
    method: 'OPTIONS',
    origin: ORIGIN,
    headers: { 'access-control-request-method': 'GET' },
  });
  assert.equal(invalidMethod.status, 405);

  const invalidHeader = await request(makeApp(), {
    method: 'OPTIONS',
    origin: ORIGIN,
    headers: {
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization, x-evil',
    },
  });
  assert.equal(invalidHeader.status, 403);
  assert.equal((await invalidHeader.json()).code, 'cors-header-denied');
});

test('an invalid token is still rejected after CORS approval', async () => {
  const response = await request(makeApp(), {
    origin: ORIGIN,
    authorization: 'Bearer invalid-token',
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
});

test('unexpected errors are converted to a generic response without internal text', () => {
  const sentinel = 'private_key=SENTINEL_DO_NOT_LEAK';
  const mapped = errorBody(Object.assign(new Error(sentinel), { code: sentinel }));
  assert.equal(mapped.status, 500);
  assert.equal(mapped.body.code, 'internal');
  assert.equal(JSON.stringify(mapped.body).includes('SENTINEL_DO_NOT_LEAK'), false);
});

test('debug logging and error responses never include an internal secret', async () => {
  const sentinel = 'private_key=SENTINEL_DO_NOT_LEAK';
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.map((value) => String(value)).join(' '));
  try {
    const response = await request(makeApp({ debug: true, firestoreError: new Error(sentinel) }), {
      origin: ORIGIN,
      authorization: 'Bearer valid-token',
      path: '/api/sales/void',
      body: {
        branchId: 'branch-a',
        saleId: 'SALE-1',
        requestId: 'req-0001',
        reason: 'test void',
        deviceId: 'device-test-01',
      },
    });
    const text = await response.text();
    assert.equal(response.status, 500);
    assert.equal(text.includes('SENTINEL_DO_NOT_LEAK'), false);
    assert.equal(logs.join(' ').includes('SENTINEL_DO_NOT_LEAK'), false);
    assert.match(logs.join(' '), /worker-request-failed/);
  } finally {
    console.error = original;
  }
});

test('GET /health returns 200 with service, environment, and CORS headers without touching Firestore', async () => {
  const app = makeApp({ environment: 'staging' });
  const response = await request(app, { method: 'GET', origin: ORIGIN, path: '/health' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'minimart-spark-sales-poc',
    environment: 'staging',
  });
  assert.equal(app.metrics.reads, 0);
  assert.equal(app.metrics.writes, 0);
  assert.equal(app.metrics.requests, 0);

  const preflight = await request(app, {
    method: 'OPTIONS',
    origin: ORIGIN,
    path: '/health',
    headers: { 'access-control-request-method': 'GET' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);

  const postHealth = await request(app, { method: 'POST', origin: ORIGIN, path: '/health' });
  assert.equal(postHealth.status, 405);

  const deniedOrigin = await request(app, { method: 'GET', origin: OTHER_ORIGIN, path: '/health' });
  assert.equal(deniedOrigin.status, 403);
});
