import { connectFunctionsEmulator, getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { firebaseApp, firebaseAuth } from './firebase';
import { firebaseRuntime } from './firebaseRuntime';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import { getDeviceId } from './deviceIdentity';
import type { SaleReturnDisposition } from '../store/usePosStore';

const FUNCTION_REGION = 'asia-southeast1';
let functionsInstance: Functions | null = null;

export type SaleAdjustmentUnitInput = {
  registryId: string;
  unitId: string;
  disposition: SaleReturnDisposition;
};

export type SaleReturnRequestItem = {
  productId: string;
  quantity: number;
  disposition: SaleReturnDisposition;
  units: SaleAdjustmentUnitInput[];
};

export type SaleReturnRequest = {
  saleId: string;
  branchId: string;
  requestId: string;
  reason: string;
  items: SaleReturnRequestItem[];
  refundReference?: string;
};

export type SaleVoidRequest = {
  saleId: string;
  branchId: string;
  requestId: string;
  reason: string;
};

export type SaleAdjustmentUnitResult = { registryId: string; unitId: string; disposition: SaleReturnDisposition };
export type SaleAdjustmentItemResult = {
  productId: string;
  quantity: number;
  disposition: SaleReturnDisposition;
  batchAllocations?: Array<{ batchId: string; quantity: number }>;
  units?: SaleAdjustmentUnitResult[];
};
export type SaleVoidResult = {
  result: 'created' | 'already-committed';
  kind: 'void';
  occurredAt: string;
  total?: number;
  refundStatus?: string;
  refundAmount?: number;
  writeCount?: number;
  items?: SaleAdjustmentItemResult[];
};
export type SaleReturnResult = {
  result: 'created' | 'already-committed';
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
  items?: SaleAdjustmentItemResult[];
};

function functionsForCallables(): Functions {
  if (functionsInstance) return functionsInstance;
  functionsInstance = getFunctions(firebaseApp, FUNCTION_REGION);
  if (firebaseRuntime.emulator) {
    connectFunctionsEmulator(functionsInstance, firebaseRuntime.emulator.host, firebaseRuntime.emulator.functionsPort);
  }
  return functionsInstance;
}

function adjustmentError(error: unknown): Error {
  const code = String((error as { code?: unknown } | null)?.code || '');
  const message = error instanceof Error ? error.message : String(error || '');
  if (code === 'functions/unimplemented' || code === 'functions/not-found') {
    return new Error('Void / Return ကို Cloud မှာ အတည်ပြုရန် Server Function မရောက်ရှိသေးပါ။ Owner ထံ အကြောင်းကြားပါ။');
  }
  const mapped = new Error(message || 'Cloud Void / Return မအောင်မြင်ပါ။');
  (mapped as Error & { code?: string }).code = code;
  return mapped;
}

function actorUid(): string {
  const user = firebaseAuth?.currentUser;
  if (!user?.uid) throw new Error('Cloud Void / Return အတွက် Firebase Login လိုအပ်ပါတယ်။');
  return user.uid;
}

/** Cashier and Owner both use this one server-authoritative void path. */
export async function voidSaleOnServer(input: SaleVoidRequest): Promise<SaleVoidResult> {
  const uid = actorUid();
  if (firebaseAuth?.currentUser?.uid !== uid) throw new Error('Firebase Login မမှန်ပါ။');
  const callable = httpsCallable<Record<string, unknown>, SaleVoidResult>(
    functionsForCallables(), 'cashierSaleVoid', { timeout: 65000 },
  );
  try {
    const response = await callable({
      uid, branchId: input.branchId, saleId: input.saleId,
      requestId: input.requestId, reason: input.reason, deviceId: getDeviceId(),
    });
    recordFirestoreActivity(uid, 'write', 'sale-void-commit', Math.max(0, Number(response.data?.writeCount) || 0));
    return response.data;
  } catch (error) {
    throw adjustmentError(error);
  }
}

/** Cashier and Owner both use this one server-authoritative return path. */
export async function returnSaleOnServer(input: SaleReturnRequest): Promise<SaleReturnResult> {
  const uid = actorUid();
  const callable = httpsCallable<Record<string, unknown>, SaleReturnResult>(
    functionsForCallables(), 'cashierSaleReturn', { timeout: 65000 },
  );
  try {
    const response = await callable({
      uid, branchId: input.branchId, saleId: input.saleId, requestId: input.requestId,
      reason: input.reason, deviceId: getDeviceId(), items: input.items,
      refundReference: input.refundReference || '',
    });
    recordFirestoreActivity(uid, 'write', 'sale-return-commit', Math.max(0, Number(response.data?.writeCount) || 0));
    return response.data;
  } catch (error) {
    throw adjustmentError(error);
  }
}

export function makeAdjustmentRequestId(prefix: 'return' | 'void', saleId: string): string {
  if (prefix === 'void') return `void-${saleId}`.slice(0, 99);
  return `ret-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}-${saleId}`.slice(0, 99);
}
