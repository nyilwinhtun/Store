import { SaleError, errorBody } from './errors.js';
import { commitSaleOnce } from './domain/commitSale.js';
import { expireStalePolicies } from './domain/expire.js';
import { issueOfflineAllowance } from './domain/allowance.js';
import { reconcileAllowance } from './domain/reconcile.js';
import { voidSaleOnce, returnSaleOnce } from './domain/adjustment.js';
import { isAbortError } from './firestore/rest.js';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 5;
const ADJUSTMENT_ROUTES = {
  '/api/sales/void': voidSaleOnce,
  '/api/sales/return': returnSaleOnce,
};
const ROUTES = new Set([
  '/api/sales/commit', '/api/offline-allowances', '/api/offline-allowances/reconcile',
  ...Object.keys(ADJUSTMENT_ROUTES),
]);
const CORS_METHODS = 'POST, OPTIONS';
const CORS_HEADERS = 'Authorization, Content-Type';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt) {
  // Jittered exponential backoff, matching the Admin SDK's contention policy.
  return 30 * 2 ** (attempt - 1) + Math.floor(Math.random() * 40);
}

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': CORS_METHODS,
    'access-control-allow-headers': CORS_HEADERS,
    'access-control-max-age': '600',
    'vary': 'Origin',
  };
}

function requestedHeaders(request) {
  return String(request.headers.get('access-control-request-headers') || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

async function parseJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new SaleError(400, 'invalid-argument', 'JSON Request သာ ခွင့်ပြုပါတယ်။');
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new SaleError(413, 'invalid-argument', 'Request ကြီးလွန်းပါတယ်။');
  try {
    return JSON.parse(raw);
  } catch {
    throw new SaleError(400, 'invalid-argument', 'JSON Request ကို ဖတ်မရပါ။');
  }
}

/**
 * Creates the HTTP handler. Dependencies are injected so the same code runs in
 * Cloudflare Workers (`src/index.js`) and in the isolated Node test harness.
 */
export function createApp({ projectId, businessId, firestore, verifier, revocationChecker = null, allowedOrigins = [], now = () => Date.now(), debug = false }) {
  if (!projectId || !businessId) throw new Error('projectId and businessId are required');
  const approvedOrigins = new Set(allowedOrigins);

  async function runTransactional(operation, serverNow) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const before = {
        reads: firestore.metrics.reads,
        writes: firestore.metrics.writes,
        requests: firestore.metrics.requests,
        bytesIn: firestore.metrics.bytesIn,
        bytesOut: firestore.metrics.bytesOut,
      };
      try {
        const result = await operation(serverNow);
        return {
          result,
          attempt,
          readCount: firestore.metrics.reads - before.reads,
          writeCount: firestore.metrics.writes - before.writes,
          requestCount: firestore.metrics.requests - before.requests,
          firestoreBytesIn: firestore.metrics.bytesIn - before.bytesIn,
          firestoreBytesOut: firestore.metrics.bytesOut - before.bytesOut,
        };
      } catch (error) {
        lastError = error;
        if (isAbortError(error) && attempt < MAX_ATTEMPTS) {
          await sleep(retryDelay(attempt));
          continue;
        }
        break;
      }
    }
    throw lastError;
  }

  function success(payload, headers = {}) {
    return json(200, { ok: true, ...payload }, {
      ...headers,
      'x-poc-reads': String(payload.readCount ?? 0),
      'x-poc-writes': String(payload.writeCount ?? 0),
      'x-poc-requests': String(payload.requestCount ?? 0),
      'x-poc-bytes-in': String(payload.firestoreBytesIn ?? 0),
      'x-poc-bytes-out': String(payload.firestoreBytesOut ?? 0),
      'x-poc-attempts': String(payload.attempts ?? 1),
    });
  }

  async function handle(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    if (origin && !approvedOrigins.has(origin)) {
      return json(403, { ok: false, code: 'origin-denied', message: 'ဤ Web App Origin ကို ခွင့်မပြုပါ။' });
    }
    const cors = origin ? corsHeaders(origin) : {};

    if (request.method === 'OPTIONS') {
      if (!ROUTES.has(url.pathname)) {
        return json(404, { ok: false, code: 'not-found', message: 'Endpoint မတွေ့ပါ။' }, cors);
      }
      const requestedMethod = String(request.headers.get('access-control-request-method') || '').trim().toUpperCase();
      if (requestedMethod && requestedMethod !== 'POST') {
        return json(405, { ok: false, code: 'method-not-allowed', message: 'POST သာ ခွင့်ပြုပါတယ်။' }, cors);
      }
      const unsupported = requestedHeaders(request).filter((name) => name !== 'authorization' && name !== 'content-type');
      if (unsupported.length) {
        return json(403, { ok: false, code: 'cors-header-denied', message: 'ဤ Request Header ကို ခွင့်မပြုပါ။' }, cors);
      }
      return new Response(null, { status: 204, headers: { ...cors, 'cache-control': 'no-store' } });
    }

    if (!ROUTES.has(url.pathname)) {
      return json(404, { ok: false, code: 'not-found', message: 'Endpoint မတွေ့ပါ။' }, cors);
    }
    if (request.method !== 'POST') {
      return json(405, { ok: false, code: 'method-not-allowed', message: 'POST သာ ခွင့်ပြုပါတယ်။' }, cors);
    }

    let identity;
    try {
      const authorization = request.headers.get('authorization') || '';
      if (!/^Bearer /i.test(authorization)) throw new SaleError(401, 'unauthenticated', 'Cashier Login လိုအပ်ပါတယ်။');
      identity = await verifier(authorization.replace(/^Bearer /i, '').trim());
      if (revocationChecker) await revocationChecker(identity);
    } catch (error) {
      const mapped = errorBody(error);
      return json(mapped.status, mapped.body, cors);
    }

    let body;
    try {
      body = await parseJson(request);
    } catch (error) {
      const mapped = errorBody(error);
      return json(mapped.status, mapped.body, cors);
    }

    const serverNow = new Date(now());
    try {
      if (url.pathname === '/api/sales/commit') {
        const outcome = await runTransactional(
          (at) => commitSaleOnce({ fs: firestore, businessId, identity, body, serverNow: at }),
          serverNow,
        );
        return success({
          result: outcome.result.result,
          readCount: outcome.readCount,
          writeCount: outcome.writeCount,
          requestCount: outcome.requestCount,
          firestoreBytesIn: outcome.firestoreBytesIn,
          firestoreBytesOut: outcome.firestoreBytesOut,
          attempts: outcome.attempt,
        }, cors);
      }
      if (ADJUSTMENT_ROUTES[url.pathname]) {
        const operation = ADJUSTMENT_ROUTES[url.pathname];
        const outcome = await runTransactional(
          (at) => operation({ fs: firestore, businessId, identity, body, serverNow: at }),
          serverNow,
        );
        return success({
          ...outcome.result,
          readCount: outcome.readCount,
          writeCount: outcome.writeCount,
          requestCount: outcome.requestCount,
          firestoreBytesIn: outcome.firestoreBytesIn,
          firestoreBytesOut: outcome.firestoreBytesOut,
          attempts: outcome.attempt,
        }, cors);
      }
      if (url.pathname === '/api/offline-allowances') {
        const outcome = await runTransactional(
          (at) => issueOfflineAllowance({ fs: firestore, businessId, identity, body, serverNow: at }),
          serverNow,
        );
        return success({
          result: 'issued',
          allowanceId: outcome.result.allowanceId,
          leaseId: outcome.result.leaseId,
          allowanceToken: outcome.result.allowanceToken,
          issuedAt: outcome.result.issuedAt,
          expiresAt: outcome.result.expiresAt,
          leaseExpiresAt: outcome.result.leaseExpiresAt,
          deviceId: outcome.result.deviceId,
          items: outcome.result.items,
          readCount: outcome.readCount,
          writeCount: outcome.writeCount,
          requestCount: outcome.requestCount,
          firestoreBytesIn: outcome.firestoreBytesIn,
          firestoreBytesOut: outcome.firestoreBytesOut,
          attempts: outcome.attempt,
        }, cors);
      }
      const outcome = await runTransactional(
        (at) => reconcileAllowance({ fs: firestore, businessId, identity, body, serverNow: at }),
        serverNow,
      );
      return success({
        result: outcome.result.result,
        releasedItems: outcome.result.releasedItems ?? [],
        readCount: outcome.readCount,
        writeCount: outcome.writeCount,
        requestCount: outcome.requestCount,
        firestoreBytesIn: outcome.firestoreBytesIn,
        firestoreBytesOut: outcome.firestoreBytesOut,
        attempts: outcome.attempt,
      }, cors);
    } catch (error) {
      if (debug) {
        const safe = error && typeof error === 'object'
          ? { name: error.name, code: error.code, status: error.status }
          : { type: typeof error };
        console.error('worker-request-failed', safe);
      }
      if (isAbortError(error)) {
        return json(503, { ok: false, code: 'unavailable', message: 'Cloud Stock ကို အခြားတစ်ခုက တပြိုင်နက် ပြောင်းလဲနေပါတယ်။ ခဏနေမှ ထပ်ကြိုးစားပါ။' }, cors);
      }
      const mapped = errorBody(error);
      return json(mapped.status, mapped.body, cors);
    }
  }

  async function expireStale(serverNow = new Date(now())) {
    return expireStalePolicies({ fs: firestore, businessId, serverNow });
  }

  return { handle, metrics: firestore.metrics, expireStale };
}
