import { doc, getDocFromServer } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { firebaseApp, firebaseAuth, firestore, FIREBASE_BUSINESS_ID } from './firebase';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import type { BranchStockShipment, Product, StockBatch } from '../store/usePosStore';

const FUNCTION_REGION = 'asia-southeast1';

export class BranchShipmentAutoCompleteUnknownError extends Error {
  readonly commitUnknown = true;
  constructor(message: string) {
    super(message);
    this.name = 'BranchShipmentAutoCompleteUnknownError';
  }
}

export type BranchShipmentAutoCompleteInput = {
  uid: string;
  shipment: BranchStockShipment;
  beforeProducts: Product[];
  afterProducts: Product[];
  beforeBatches: StockBatch[];
  afterBatches: StockBatch[];
};

type CompleteShipmentResponse = {
  alreadyCommitted?: boolean;
  readCount?: number;
  writeCount?: number;
};

function cleanCallableImages<T>(value: T): T {
  const serialized = JSON.stringify(value, (key, child: unknown) => {
    if (typeof child === 'string' && ['logoUrl', 'bannerUrl', 'photoUrl', 'image'].includes(key)
      && (child.startsWith('local-image:') || child.startsWith('data:image/'))) return '';
    return child;
  });
  return (serialized === undefined ? value : JSON.parse(serialized)) as T;
}

/**
 * Calls the server-authoritative Firebase Function. The Admin SDK validates the
 * active Cashier, one-Branch assignment, receipt, Product/Batch snapshots and
 * commits Product + Batch + Shipment in a single Firestore transaction. Client
 * Firestore Rules therefore remain closed to direct Cashier stock increases.
 */
export async function commitBranchShipmentAutoCompleteToCloud(
  input: BranchShipmentAutoCompleteInput,
): Promise<{ alreadyCommitted: boolean }> {
  const { uid, shipment } = input;
  const currentUser = firebaseAuth?.currentUser;
  if (!firestore || !currentUser || currentUser.uid !== uid) throw new Error('Firebase Cashier Login မမှန်ပါ။');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Internet မရှိပါ။ Shipment Auto Complete အတွက် Online ဖြစ်ရန်လိုပါတယ်။');
  if (shipment.status !== 'approved' || shipment.completionMode !== 'auto' || shipment.autoCompletedByUid !== uid
    || !shipment.autoCompletionPlan || shipment.autoCompletionPlan.length !== shipment.items.length
    || !shipment.receivedItems || shipment.receivedItems.length !== shipment.items.length) {
    throw new Error('Auto Complete Plan / Receipt အချက်အလက် မပြည့်စုံပါ။');
  }

  const shipmentRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', shipment.toBranchId, 'stockShipments', shipment.id);
  const callable = httpsCallable<BranchShipmentAutoCompleteInput, CompleteShipmentResponse>(
    getFunctions(firebaseApp, FUNCTION_REGION),
    'completeBranchStockShipment',
    { timeout: 65000 },
  );
  try {
    // Strip browser-local image blobs before sending snapshots through the
    // Callable payload; the server applies the same sanitizer before writing.
    const callableInput: BranchShipmentAutoCompleteInput = {
      ...input,
      beforeProducts: cleanCallableImages(input.beforeProducts),
      afterProducts: cleanCallableImages(input.afterProducts),
    };
    const response = await callable(callableInput);
    const result = response.data || {};
    recordFirestoreActivity(uid, 'read', 'branch-shipment-auto-complete-validation', Math.max(1, Number(result.readCount) || 1));
    recordFirestoreActivity(uid, 'write', 'branch-shipment-auto-complete-commit', Math.max(0, Number(result.writeCount) || 0));
    return { alreadyCommitted: result.alreadyCommitted === true };
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code || '');
    const message = error instanceof Error ? error.message : String(error || '');
    const mayHaveLostAck = ['functions/unavailable', 'functions/deadline-exceeded', 'functions/cancelled', 'functions/unknown', 'unavailable', 'deadline-exceeded', 'cancelled', 'unknown'].includes(code)
      || /network|offline|internet|timed out|timeout|connection/i.test(message);
    if (!mayHaveLostAck) throw error;
    try {
      const serverSnapshot = await getDocFromServer(shipmentRef);
      const payload = serverSnapshot.exists() ? serverSnapshot.data().payload as BranchStockShipment | undefined : undefined;
      if (payload?.status === 'approved' && payload.completionMode === 'auto' && payload.autoCompletedByUid === uid) {
        recordFirestoreActivity(uid, 'read', 'branch-shipment-auto-complete-verify', 1);
        return { alreadyCommitted: true };
      }
    } catch {
      throw new BranchShipmentAutoCompleteUnknownError('Auto Complete ရဲ့ Cloud အတည်ပြုချက် မရသေးပါ။ ထပ်မံ Submit မလုပ်ပါနှင့်။ Shipment History ကို Refresh လုပ်ပြီး အရင်စစ်ပါ။');
    }
    throw error;
  }
}
