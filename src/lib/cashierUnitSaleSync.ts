import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { firebaseApp, firebaseAuth } from './firebase';
import { firebaseRuntime } from './firebaseRuntime';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import type { Sale } from '../store/usePosStore';

const FUNCTION_REGION = 'asia-southeast1';

type UnitSaleResponse = {
  result?: 'created' | 'already-committed';
  readCount?: number;
  writeCount?: number;
};

export function saleHasUnitSelections(sale: Sale): boolean {
  return sale.items.some((item) => (item.stockUnitSelections?.length || 0) > 0);
}

function failedPrecondition(message: string, code = 'failed-precondition'): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

/**
 * Unit-tracked Cashier sales are committed by the `completeCashierUnitSale`
 * callable. The Admin SDK marks the exact scanned units sold in the same
 * transaction as the sale, Product stock, Batch stock and audit record, because
 * Cashier Firestore Rules deliberately have no registry write path.
 */
export async function commitCashierUnitSaleToCloud(
  sale: Sale,
  uid: string,
  branchId: string,
): Promise<'created' | 'already-committed'> {
  const currentUser = firebaseAuth?.currentUser;
  if (!currentUser || currentUser.uid !== uid) throw new Error('Firebase Cashier Login မမှန်ပါ။');
  if (!sale.id || sale.createdByUid !== uid || sale.branchId !== branchId) throw new Error('Cashier Sale ၏ UID / Branch မကိုက်ညီပါ။');

  const functions = getFunctions(firebaseApp, FUNCTION_REGION);
  if (firebaseRuntime.emulator && (globalThis as Record<string, unknown>).__minimartFunctionsEmulatorBound !== true) {
    connectFunctionsEmulator(functions, firebaseRuntime.emulator.host, firebaseRuntime.emulator.functionsPort);
    (globalThis as Record<string, unknown>).__minimartFunctionsEmulatorBound = true;
  }
  const callable = httpsCallable<{ uid: string; branchId: string; sale: Record<string, unknown> }, UnitSaleResponse>(
    functions,
    'completeCashierUnitSale',
    { timeout: 65000 },
  );

  const { cloudSyncStatus: _status, cloudSyncError: _error, ...salePayload } = sale;
  try {
    const response = await callable({ uid, branchId, sale: salePayload });
    const data = response.data || {};
    recordFirestoreActivity(uid, 'read', 'cashier-unit-sale-validation', Math.max(1, Number(data.readCount) || 1));
    recordFirestoreActivity(uid, 'write', 'cashier-unit-sale-commit', Math.max(0, Number(data.writeCount) || 0));
    return data.result === 'already-committed' ? 'already-committed' : 'created';
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code || '');
    const messageText = error instanceof Error ? error.message : String(error || '');
    // A missing callable must fail closed into Owner review, never into a local-only
    // "completed" sale whose units stay sellable in the Cloud registry.
    if (code === 'functions/unimplemented' || code === 'functions/not-found') {
      throw failedPrecondition('Unit Barcode Sale ကို Cloud မှာ အတည်ပြုရန် Server Function မရောက်ရှိသေးပါ။ ဒီအရောင်းကို Owner စစ်ဆေးရန် ရပ်ထားပါတယ်။');
    }
    // Deterministic payload/authorization failures must stop retrying but keep
    // the durable queue entry so the Owner can review it. Transient network and
    // quota errors stay pending for an automatic retry.
    if (code === 'functions/failed-precondition' || code === 'functions/already-exists'
      || code === 'functions/permission-denied' || code === 'functions/invalid-argument'
      || code === 'functions/out-of-range') {
      throw failedPrecondition(messageText || 'Cashier Sale ကို Cloud Data နဲ့ ကိုက်ညီအောင် အတည်မပြုနိုင်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    }
    // resource-exhausted, unavailable, deadline-exceeded and unknown transport
    // failures stay pending so the durable queue retries them automatically.
    throw error;
  }
}
