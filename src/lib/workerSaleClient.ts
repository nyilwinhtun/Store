import type { Sale } from '../store/usePosStore';
import { firebaseRuntime } from './firebaseRuntime';

export type WorkerSaleResult = 'created' | 'already-committed';

const WORKER_SALES_URL = (import.meta.env.VITE_WORKER_SALES_URL || '').trim();
const WORKER_SALES_FLAG = import.meta.env.VITE_WORKER_SALES_ENABLED === 'true';

export function resolveWorkerSalesGate(input: {
  flag: string;
  url: string;
  mode: string;
  dev: boolean;
}): { enabled: boolean; endpoint: string } {
  const endpoint = (input.url || '').trim();
  const stagingBuild = input.mode === 'staging';
  return {
    enabled: stagingBuild && input.flag === 'true' && isAllowedEndpoint(endpoint, input.dev),
    endpoint,
  };
}

/**
 * The Worker path stays disabled until Staging, security and workerd gates pass.
 * Only a Staging runtime can enable the Staging Worker endpoint; Production and
 * the local emulator always keep the existing trusted callable path.
 */
export function workerSalesGate(): { enabled: boolean; endpoint: string } {
  return resolveWorkerSalesGate({
    flag: WORKER_SALES_FLAG ? 'true' : 'false',
    url: WORKER_SALES_URL,
    mode: firebaseRuntime.mode,
    dev: import.meta.env.DEV === true,
  });
}

function isAllowedEndpoint(endpoint: string, dev = false): boolean {
  try {
    const url = new URL(endpoint);
    const localLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.protocol === 'https:' || (dev && localLoopback);
  } catch {
    return false;
  }
}

export class WorkerSaleError extends Error {
  readonly code: string;
  readonly status: number;
  readonly needsReview: boolean;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; status: number; needsReview: boolean; retryable: boolean }) {
    super(input.message);
    this.name = 'WorkerSaleError';
    this.code = input.code;
    this.status = input.status;
    this.needsReview = input.needsReview;
    this.retryable = input.retryable;
  }
}

export type WorkerSaleRequest = {
  endpoint: string;
  getIdToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function responseError(status: number, body: unknown): WorkerSaleError {
  const record = body && typeof body === 'object' ? body as { code?: unknown; message?: unknown } : {};
  const code = typeof record.code === 'string' ? record.code : `worker/http-${status}`;
  const message = typeof record.message === 'string' && record.message
    ? record.message
    : 'Worker မှ အရောင်းကို အတည်မပြုနိုင်ပါ။';
  if (status === 409) return new WorkerSaleError({ code, message, status, needsReview: true, retryable: false });
  if (status === 403) return new WorkerSaleError({ code, message, status, needsReview: true, retryable: false });
  if (status === 400) return new WorkerSaleError({ code, message, status, needsReview: true, retryable: false });
  if (status === 401) {
    return new WorkerSaleError({
      code, message, status,
      needsReview: code === 'authorization-expired',
      retryable: code !== 'authorization-expired',
    });
  }
  if (status === 429 || status === 503) {
    return new WorkerSaleError({ code, message, status, needsReview: false, retryable: true });
  }
  return new WorkerSaleError({ code, message, status, needsReview: false, retryable: status >= 500 });
}

/**
 * Sends exactly one commit attempt. The Worker owns transaction retries and
 * fingerprint idempotency; this client never retries a write on its own.
 */
export async function commitSaleThroughWorker(
  sale: Sale,
  uid: string,
  branchId: string,
  request: WorkerSaleRequest,
): Promise<WorkerSaleResult> {
  if (!uid || sale.createdByUid !== uid) throw new Error('Cashier UID နဲ့ Sale UID မကိုက်ညီပါ။');
  if (!branchId || sale.branchId !== branchId) throw new Error('Cashier Branch နဲ့ Sale Branch မကိုက်ညီပါ။');
  if (sale.status !== 'completed' || !sale.id || !sale.items.length) throw new Error('မှန်ကန်သော Completed Sale မဟုတ်ပါ။');
  if (!isAllowedEndpoint(request.endpoint, import.meta.env.DEV === true)) throw new Error('Worker Endpoint မမှန်ကန်ပါ။ HTTPS လိုအပ်ပါတယ်။');

  const token = await request.getIdToken();
  if (!token) throw new Error('Firebase ID Token မရနိုင်ပါ။ ပြန် Login လုပ်ပါ။');

  const { cloudSyncStatus: _status, cloudSyncError: _error, ...salePayload } = sale;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30000);
  let response: Response;
  try {
    response = await (request.fetchImpl || fetch)(request.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ branchId, sale: salePayload }),
      signal: controller.signal,
    });
  } catch {
    throw new WorkerSaleError({
      code: 'worker/network',
      message: 'Worker နှင့် ချိတ်ဆက်မရပါ။ Internet ကို စစ်ပြီး ပြန်စမ်းပါ။',
      status: 0,
      needsReview: false,
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }

  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }

  if (response.ok) {
    const record = body && typeof body === 'object' ? body as { result?: unknown } : {};
    if (record.result === 'created' || record.result === 'already-committed') return record.result;
    throw new WorkerSaleError({
      code: 'worker/invalid-response',
      message: 'Worker မှ မမျှော်လင့်ထားသော အဖြေပြန်လာပါတယ်။',
      status: response.status,
      needsReview: false,
      retryable: true,
    });
  }

  throw responseError(response.status, body);
}
