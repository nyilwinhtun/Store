import type { Sale, SaleReturnDisposition } from '../store/usePosStore';
import { firebaseRuntime } from './firebaseRuntime';

export type WorkerSaleResult = 'created' | 'already-committed';

export type OfflineAllowanceBinding = {
  allowanceId: string;
  allowanceToken: string;
  leaseId: string;
  deviceId: string;
};

export type OfflineAllowanceItemInput = {
  productId: string;
  quantity: number;
  batchAllocations?: Array<{ batchId: string; quantity: number }>;
};

export type OfflineAllowanceIssueRequest = {
  branchId: string;
  deviceId: string;
  leaseId?: string;
  items: OfflineAllowanceItemInput[];
};

export type OfflineAllowanceIssueResult = {
  result: 'issued';
  allowanceId: string;
  leaseId: string;
  allowanceToken: string;
  issuedAt: string;
  expiresAt: string;
  leaseExpiresAt: string;
  deviceId: string;
  items: OfflineAllowanceItemInput[];
  writeCount?: number;
};

export type OfflineAllowanceReconcileRequest = {
  branchId: string;
  allowanceId: string;
  action: 'release';
};

export type OfflineAllowanceReconcileResult = {
  result: 'released' | 'already-reconciled';
  releasedItems: OfflineAllowanceItemInput[];
  writeCount?: number;
};

export type WorkerVoidRequest = {
  branchId: string;
  saleId: string;
  requestId: string;
  reason: string;
  deviceId: string;
};

export type WorkerReturnItem = {
  productId: string;
  quantity: number;
  disposition: SaleReturnDisposition;
  units: Array<{ registryId: string; unitId: string; disposition: SaleReturnDisposition }>;
};

export type WorkerReturnRequest = {
  branchId: string;
  saleId: string;
  requestId: string;
  reason: string;
  deviceId: string;
  items: WorkerReturnItem[];
  refundReference?: string;
};

export type WorkerAdjustmentItemResult = {
  productId: string;
  quantity: number;
  disposition: SaleReturnDisposition;
  batchAllocations?: Array<{ batchId: string; quantity: number }>;
  units?: Array<{ registryId: string; unitId: string; disposition: SaleReturnDisposition }>;
};

export type WorkerVoidResult = {
  result: WorkerSaleResult;
  kind: 'void';
  occurredAt: string;
  total?: number;
  refundStatus?: string;
  refundAmount?: number;
  writeCount?: number;
  items?: WorkerAdjustmentItemResult[];
};

export type WorkerReturnResult = {
  result: WorkerSaleResult;
  kind: 'return';
  returnId: string;
  occurredAt: string;
  value?: number;
  refundStatus?: string;
  refundAmount?: number;
  dueReduction?: number;
  dueAmount?: number;
  returnedTotal?: number;
  returnedProductQuantities?: Record<string, number>;
  returnedBatchQuantities?: Record<string, number>;
  writeCount?: number;
  items?: WorkerAdjustmentItemResult[];
};

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
  allowance?: OfflineAllowanceBinding | null;
};

export function workerEndpointFor(
  endpoint: string,
  route: '/api/sales/commit' | '/api/sales/void' | '/api/sales/return' | '/api/offline-allowances' | '/api/offline-allowances/reconcile',
): string {
  const url = new URL(endpoint);
  const basePath = url.pathname.replace(/\/api\/sales\/commit\/?$/, '').replace(/\/+$/, '');
  url.pathname = `${basePath}${route}`;
  return url.toString();
}

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

function invalidWorkerResponse(status: number): WorkerSaleError {
  return new WorkerSaleError({
    code: 'worker/invalid-response',
    message: 'Worker မှ မမျှော်လင့်ထားသော အဖြေပြန်လာပါတယ်။',
    status,
    needsReview: false,
    retryable: true,
  });
}

async function postWorkerJson<T>(
  targetEndpoint: string,
  payload: unknown,
  request: WorkerSaleRequest,
): Promise<{ status: number; body: T }> {
  if (!isAllowedEndpoint(targetEndpoint, import.meta.env.DEV === true)) {
    throw new Error('Worker Endpoint မမှန်ကန်ပါ။ HTTPS လိုအပ်ပါတယ်။');
  }
  const token = await request.getIdToken();
  if (!token) throw new Error('Firebase ID Token မရနိုင်ပါ။ ပြန် Login လုပ်ပါ။');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30000);
  let response: Response;
  try {
    response = await (request.fetchImpl || fetch)(targetEndpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
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
  if (!response.ok) throw responseError(response.status, body);
  return { status: response.status, body: body as T };
}

function validatedAllowance(allowance: OfflineAllowanceBinding | null | undefined): OfflineAllowanceBinding | null {
  if (!allowance) return null;
  const allowanceId = String(allowance.allowanceId || '').trim();
  const allowanceToken = String(allowance.allowanceToken || '').trim();
  const leaseId = String(allowance.leaseId || '').trim();
  const deviceId = String(allowance.deviceId || '').trim();
  if (!allowanceId && !allowanceToken && !leaseId && !deviceId) return null;
  if (!allowanceId || !allowanceToken || !leaseId || !deviceId) {
    throw new Error('Offline Allowance / Lease / Device အချက်အလက် မပြည့်စုံပါ။');
  }
  return { allowanceId, allowanceToken, leaseId, deviceId };
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

  const targetEndpoint = workerEndpointFor(request.endpoint, '/api/sales/commit');
  const allowance = validatedAllowance(request.allowance);
  const { cloudSyncStatus: _status, cloudSyncError: _error, ...salePayload } = sale;
  const { status, body } = await postWorkerJson<{ result?: unknown }>(
    targetEndpoint,
    { branchId, sale: salePayload, ...(allowance ?? {}) },
    request,
  );
  if (body && typeof body === 'object' && (body.result === 'created' || body.result === 'already-committed')) {
    return body.result;
  }
  throw invalidWorkerResponse(status);
}

/** Sends one void adjustment request to the Worker `/api/sales/void` contract. */
export async function voidSaleThroughWorker(
  input: WorkerVoidRequest,
  request: WorkerSaleRequest,
): Promise<WorkerVoidResult> {
  if (!input.branchId || !input.saleId || !input.requestId || !input.deviceId) {
    throw new Error('Void Request အချက်အလက် မပြည့်စုံပါ။');
  }
  const targetEndpoint = workerEndpointFor(request.endpoint, '/api/sales/void');
  const { status, body } = await postWorkerJson<WorkerVoidResult>(
    targetEndpoint,
    {
      branchId: input.branchId,
      saleId: input.saleId,
      requestId: input.requestId,
      reason: input.reason,
      deviceId: input.deviceId,
    },
    request,
  );
  if (body && typeof body === 'object'
    && (body.result === 'created' || body.result === 'already-committed')
    && body.kind === 'void') {
    return body;
  }
  throw invalidWorkerResponse(status);
}

/** Sends one return adjustment request to the Worker `/api/sales/return` contract. */
export async function returnSaleThroughWorker(
  input: WorkerReturnRequest,
  request: WorkerSaleRequest,
): Promise<WorkerReturnResult> {
  if (!input.branchId || !input.saleId || !input.requestId || !input.deviceId || !input.items.length) {
    throw new Error('Return Request အချက်အလက် မပြည့်စုံပါ။');
  }
  const targetEndpoint = workerEndpointFor(request.endpoint, '/api/sales/return');
  const { status, body } = await postWorkerJson<WorkerReturnResult>(
    targetEndpoint,
    {
      branchId: input.branchId,
      saleId: input.saleId,
      requestId: input.requestId,
      reason: input.reason,
      deviceId: input.deviceId,
      items: input.items,
      refundReference: input.refundReference || '',
    },
    request,
  );
  if (body && typeof body === 'object'
    && (body.result === 'created' || body.result === 'already-committed')
    && body.kind === 'return') {
    return body;
  }
  throw invalidWorkerResponse(status);
}

/** Requests a server-issued offline stock allowance and authorization lease. */
export async function issueOfflineAllowanceThroughWorker(
  input: OfflineAllowanceIssueRequest,
  request: WorkerSaleRequest,
): Promise<OfflineAllowanceIssueResult> {
  if (!input.branchId || !input.deviceId || !input.items.length) {
    throw new Error('Offline Allowance Request အချက်အလက် မပြည့်စုံပါ။');
  }
  const targetEndpoint = workerEndpointFor(request.endpoint, '/api/offline-allowances');
  const { status, body } = await postWorkerJson<OfflineAllowanceIssueResult>(
    targetEndpoint,
    {
      branchId: input.branchId,
      deviceId: input.deviceId,
      items: input.items,
      ...(input.leaseId ? { leaseId: input.leaseId } : {}),
    },
    request,
  );
  if (body && typeof body === 'object' && body.result === 'issued'
    && body.allowanceId && body.allowanceToken && body.leaseId) {
    return body;
  }
  throw invalidWorkerResponse(status);
}

/** Releases an expired/consumed offline reservation back to branch stock (Owner only). */
export async function reconcileOfflineAllowanceThroughWorker(
  input: OfflineAllowanceReconcileRequest,
  request: WorkerSaleRequest,
): Promise<OfflineAllowanceReconcileResult> {
  if (!input.branchId || !input.allowanceId || input.action !== 'release') {
    throw new Error('Offline Allowance Reconcile Request အချက်အလက် မပြည့်စုံပါ။');
  }
  const targetEndpoint = workerEndpointFor(request.endpoint, '/api/offline-allowances/reconcile');
  const { status, body } = await postWorkerJson<OfflineAllowanceReconcileResult>(
    targetEndpoint,
    {
      branchId: input.branchId,
      allowanceId: input.allowanceId,
      action: input.action,
    },
    request,
  );
  if (body && typeof body === 'object'
    && (body.result === 'released' || body.result === 'already-reconciled')) {
    return body;
  }
  throw invalidWorkerResponse(status);
}
