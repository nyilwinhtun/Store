import { doc, getDocFromServer, runTransaction } from 'firebase/firestore';
import { firebaseAuth, firestore, FIREBASE_BUSINESS_ID } from './firebase';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import type { SyncItem } from '../components/CloudSyncPanel';
import type { ActivityLog, BranchStockShipment, Product, StockBatch } from '../store/usePosStore';

export const BRANCH_SHIPMENT_CLOUD_COMMIT_STARTED = 'minimart-branch-shipment-cloud-commit-started';
export const BRANCH_SHIPMENT_CLOUD_COMMIT_COMPLETED = 'minimart-branch-shipment-cloud-commit-completed';
export const BRANCH_SHIPMENT_CLOUD_COMMIT_CANCELLED = 'minimart-branch-shipment-cloud-commit-cancelled';

export type BranchShipmentCloudCommitInput = {
  uid: string;
  shipment: BranchStockShipment;
  beforeProducts: Product[];
  afterProducts: Product[];
  beforeBatches: StockBatch[];
  afterBatches: StockBatch[];
  activityLogs: ActivityLog[];
};

export class BranchShipmentCloudCommitUnknownError extends Error {
  readonly commitUnknown = true;
  constructor(message: string) {
    super(message);
    this.name = 'BranchShipmentCloudCommitUnknownError';
  }
}

const closeEnough = (a: unknown, b: unknown) =>
  Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= 0.000001;

function cleanForCloud<T>(value: T): T {
  // Match the existing Auto Sync JSON-normalization behavior: omit undefined
  // object fields before Firestore receives the record, and strip device-only images.
  const serialized = JSON.stringify(value, (key, child: unknown) => {
    if (typeof child === 'string' && ['logoUrl', 'bannerUrl', 'photoUrl', 'image'].includes(key)
      && (child.startsWith('local-image:') || child.startsWith('data:image/'))) return '';
    return child;
  });
  return (serialized === undefined ? value : JSON.parse(serialized)) as T;
}

function cloudRecord(item: SyncItem, uid: string) {
  return {
    scope: item.scope,
    kind: item.kind,
    ...(item.branchId ? { branchId: item.branchId } : {}),
    payload: cleanForCloud(item.payload),
    deleted: false,
    updatedAt: new Date().toISOString(),
    updatedBy: uid,
  };
}

function makeItem(kind: SyncItem['kind'], id: string, branchId: string, payload: unknown): SyncItem {
  return {
    key: `branchRecord::${branchId}::${kind}::${id}`, 
    scope: 'branchRecord',
    kind,
    id,
    branchId,
    payload: cleanForCloud(payload),
  };
}

function sameBatchBefore(remote: Record<string, unknown>, before: StockBatch): boolean {
  const payload = remote.payload && typeof remote.payload === 'object' ? remote.payload as Record<string, unknown> : {};
  return payload.id === before.id
    && payload.productId === before.productId
    && (payload.branchId || remote.branchId) === before.branchId
    && closeEnough(payload.quantity, before.quantity)
    && String(payload.expiryDate || '') === String(before.expiryDate || '')
    && closeEnough(payload.unitCost, before.unitCost);
}

function sameProductBefore(remote: Record<string, unknown>, before: Product): boolean {
  const payload = remote.payload && typeof remote.payload === 'object' ? remote.payload as Record<string, unknown> : {};
  return payload.id === before.id
    && payload.branchId === before.branchId
    && closeEnough(payload.stock, before.stock)
    && String(payload.barcode || '') === String(before.barcode || '')
    && String(payload.sku || '') === String(before.sku || '')
    && String(payload.name || '') === String(before.name || '')
    && closeEnough(payload.costPrice, before.costPrice)
    && closeEnough(payload.retailPrice, before.retailPrice)
    && closeEnough(payload.wholesalePrice, before.wholesalePrice);
}

/**
 * Commit the dispatch-critical data directly to Firestore before reporting success.
 * This removes the fragile dependency on the app-wide Auto Sync status badge while
 * still ensuring that Source Stock and the destination Shipment are committed atomically.
 */
export async function commitBranchShipmentToCloud(input: BranchShipmentCloudCommitInput): Promise<{ alreadyCommitted: boolean }> {
  const { uid, shipment } = input;
  const currentUser = firebaseAuth?.currentUser;
  if (!firestore || !currentUser || currentUser.uid !== uid) throw new Error('Firebase Owner Login မမှန်ပါ။ Owner Account ကို ပြန်ဝင်ပါ။');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Internet မရှိပါ။ Online ပြန်ဖြစ်မှ ပစ္စည်းပို့ပါ။');
  if (shipment.fromBranchId === shipment.toBranchId || !shipment.items.length) throw new Error('Shipment Branch သို့မဟုတ် ပစ္စည်းစာရင်း မမှန်ကန်ပါ။');

  const productIds = new Set(shipment.items.map((item) => item.sourceProductId));
  const beforeProducts = new Map(input.beforeProducts.filter((item) => item.branchId === shipment.fromBranchId && productIds.has(item.id)).map((item) => [item.id, item]));
  const afterProducts = new Map(input.afterProducts.filter((item) => item.branchId === shipment.fromBranchId && productIds.has(item.id)).map((item) => [item.id, item]));
  const productItems: SyncItem[] = shipment.items.map((line) => {
    const before = beforeProducts.get(line.sourceProductId);
    const after = afterProducts.get(line.sourceProductId);
    if (!before || !after) throw new Error(`${line.productName}: Source Product ကို ပြန်မတွေ့ပါ။ Stock မပြောင်းဘဲ ရပ်ထားပါတယ်။`);
    if (!closeEnough(before.stock, line.sourceStockBefore) || !closeEnough(after.stock, line.sourceStockAfter)) {
      throw new Error(`${line.productName}: Dispatch မတိုင်မီ/ပြီးနောက် Stock အချက်အလက် မကိုက်ညီပါ။ Refresh လုပ်ပြီး ပြန်စစ်ပါ။`);
    }
    return makeItem('products', after.id, shipment.fromBranchId, { ...after, branchId: shipment.fromBranchId });
  });

  const beforeBatches = new Map(input.beforeBatches
    .filter((item) => item.branchId === shipment.fromBranchId && productIds.has(item.productId))
    .map((item) => [item.id, item]));
  const afterBatches = input.afterBatches
    .filter((item) => item.branchId === shipment.fromBranchId && productIds.has(item.productId));
  const changedBatches = afterBatches.filter((after) => {
    const before = beforeBatches.get(after.id);
    return !before || before.quantity !== after.quantity || before.expiryDate !== after.expiryDate
      || before.unitCost !== after.unitCost || before.productId !== after.productId;
  });
  const batchItems = changedBatches.map((batch) => makeItem('stockBatches', batch.id, shipment.fromBranchId, { ...batch, branchId: shipment.fromBranchId }));
  const shipmentPayload = { ...shipment, branchId: shipment.toBranchId };
  const shipmentItem = makeItem('stockShipments', shipment.id, shipment.toBranchId, shipmentPayload);
  const auditItems = input.activityLogs
    .filter((entry) => entry.branchId === shipment.fromBranchId && entry.entityId === shipment.id)
    .map((entry) => makeItem('activityLogs', entry.id, shipment.fromBranchId, { ...entry, branchId: shipment.fromBranchId }));
  const records = [...productItems, ...batchItems, shipmentItem, ...auditItems];
  if (records.length > 450) throw new Error('Shipment ထဲက Batch အပြောင်းအလဲများလွန်းနေပါတယ်။ ပစ္စည်းအမျိုးအစား/Batch အရေအတွက်ကို လျှော့ပြီး ပို့ပါ။');

  const shipmentPath = `businesses/${FIREBASE_BUSINESS_ID}/branches/${shipment.toBranchId}/stockShipments/${shipment.id}`;
  const shipmentRef = doc(firestore, shipmentPath);
  const productRefs = shipment.items.map((item) => doc(firestore, `businesses/${FIREBASE_BUSINESS_ID}/branches/${shipment.fromBranchId}/products/${item.sourceProductId}`));
  const batchRefs = changedBatches.map((batch) => doc(firestore, `businesses/${FIREBASE_BUSINESS_ID}/branches/${shipment.fromBranchId}/stockBatches/${batch.id}`));
  const previousBatchById = beforeBatches;

  try {
    const result = await runTransaction(firestore, async (transaction) => {
      const existingShipment = await transaction.get(shipmentRef);
      if (existingShipment.exists()) {
        const existingPayload = existingShipment.data().payload as BranchStockShipment | undefined;
        if (existingPayload?.id === shipment.id && existingPayload.requestId && existingPayload.requestId === shipment.requestId) return 'already' as const;
        throw new Error('Shipment ID တူညီသော စာရင်း Cloud မှာ ရှိပြီးသားဖြစ်ပါတယ်။ History ကို စစ်ဆေးပါ။');
      }

      // All transaction reads are completed before any writes.
      const [remoteProducts, remoteBatches] = await Promise.all([
        Promise.all(productRefs.map((ref) => transaction.get(ref))),
        Promise.all(batchRefs.map((ref) => transaction.get(ref))),
      ]);

      remoteProducts.forEach((snapshot, index) => {
        const line = shipment.items[index];
        const before = beforeProducts.get(line.sourceProductId);
        if (!snapshot.exists() || !before || !sameProductBefore(snapshot.data(), before)) {
          throw new Error(`${line.productName}: Firebase ရှိ Source Stock သို့မဟုတ် Product Data က ဒီ Device နဲ့ မတူပါ။ Cloud Sync/Stock ကို ပြန်စစ်ပြီးမှ ပို့ပါ။`);
        }
      });

      remoteBatches.forEach((snapshot, index) => {
        const batch = changedBatches[index];
        const before = previousBatchById.get(batch.id);
        if (before) {
          if (!snapshot.exists() || !sameBatchBefore(snapshot.data(), before)) {
            throw new Error(`Stock Batch (${batch.id}) က Firebase နဲ့ မကိုက်ညီပါ။ Stock Batch ကို ပြန်စစ်ပါ။`);
          }
        } else if (snapshot.exists()) {
          throw new Error(`Stock Batch ID (${batch.id}) တူညီပြီးသား Cloud Record ရှိနေပါတယ်။ Duplicate မဖြစ်စေရန် ပို့မှုကို ရပ်ထားပါတယ်။`);
        }
      });

      const updatedAt = new Date().toISOString();
      productItems.forEach((item, index) => transaction.set(productRefs[index], {
        ...cloudRecord(item, uid), updatedAt,
      }, { merge: true }));
      batchItems.forEach((item, index) => transaction.set(batchRefs[index], {
        ...cloudRecord(item, uid), updatedAt,
      }, { merge: true }));
      transaction.set(shipmentRef, { ...cloudRecord(shipmentItem, uid), updatedAt }, { merge: true });
      auditItems.forEach((item) => {
        const ref = doc(firestore, `businesses/${FIREBASE_BUSINESS_ID}/branches/${shipment.fromBranchId}/activityLogs/${item.id}`);
        transaction.set(ref, { ...cloudRecord(item, uid), updatedAt }, { merge: true });
      });
      return 'committed' as const;
    });

    recordFirestoreActivity(uid, 'read', 'branch-shipment-transaction-validation', productRefs.length + batchRefs.length + 1);
    recordFirestoreActivity(uid, 'write', 'branch-shipment-transaction-commit', records.length);
    window.dispatchEvent(new CustomEvent(BRANCH_SHIPMENT_CLOUD_COMMIT_COMPLETED, { detail: { uid, records } }));
    return { alreadyCommitted: result === 'already' };
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code || '');
    const message = error instanceof Error ? error.message : String(error || '');
    const mayHaveLostCommitAcknowledgement = ['unavailable', 'deadline-exceeded', 'network-request-failed', 'cancelled', 'unknown'].includes(code)
      || /network|offline|internet|timed out|timeout|connection/i.test(message);
    // Validation, stale-stock, and permission errors are definite failures;
    // only transport/acknowledgement failures need a server-side verification.
    if (!mayHaveLostCommitAcknowledgement) throw error;

    try {
      const serverShipment = await getDocFromServer(shipmentRef);
      if (serverShipment.exists()) {
        const remote = serverShipment.data().payload as BranchStockShipment | undefined;
        if (remote?.id === shipment.id && remote.requestId && remote.requestId === shipment.requestId) {
          recordFirestoreActivity(uid, 'read', 'branch-shipment-commit-verify', 1);
          window.dispatchEvent(new CustomEvent(BRANCH_SHIPMENT_CLOUD_COMMIT_COMPLETED, { detail: { uid, records } }));
          return { alreadyCommitted: true };
        }
      }
    } catch {
      throw new BranchShipmentCloudCommitUnknownError('Firebase ကုန်ပို့မှု အတည်ပြုချက် ပြန်မရသေးပါ။ ပစ္စည်းကို ထပ်မပို့ပါနှင့်။ Shipment History ကို စစ်ပြီး Internet ပြန်ကောင်းချိန်မှာ Cloud Sync ကို ပြန်စစ်ပါ။');
    }
    throw error;
  }
}
