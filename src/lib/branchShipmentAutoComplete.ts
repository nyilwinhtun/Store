import { doc, getDocFromServer, runTransaction } from 'firebase/firestore';
import { firebaseAuth, firestore, FIREBASE_BUSINESS_ID } from './firebase';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import type { BranchStockShipment, Product, StockBatch } from '../store/usePosStore';

export class BranchShipmentAutoCompleteUnknownError extends Error {
  readonly commitUnknown = true;
  constructor(message: string) {
    super(message);
    this.name = 'BranchShipmentAutoCompleteUnknownError';
  }
}

const closeEnough = (a: unknown, b: unknown) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= 0.000001;

function sameProduct(remote: Record<string, unknown>, before: Product): boolean {
  const payload = remote.payload && typeof remote.payload === 'object' ? remote.payload as Record<string, unknown> : {};
  return remote.kind === 'products' && remote.branchId === before.branchId
    && payload.id === before.id && payload.branchId === before.branchId
    && closeEnough(payload.stock, before.stock)
    && String(payload.barcode || '') === String(before.barcode || '')
    && String(payload.sku || '') === String(before.sku || '')
    && String(payload.name || '') === String(before.name || '')
    && String(payload.category || '') === String(before.category || '')
    && closeEnough(payload.costPrice, before.costPrice)
    && closeEnough(payload.retailPrice, before.retailPrice)
    && closeEnough(payload.wholesalePrice, before.wholesalePrice)
    && closeEnough(payload.lowStockAt, before.lowStockAt)
    && String(payload.unit || '') === String(before.unit || '')
    && String(payload.quantityMode || '') === String(before.quantityMode || '');
}

function sameBatch(remote: Record<string, unknown>, before: StockBatch): boolean {
  const payload = remote.payload && typeof remote.payload === 'object' ? remote.payload as Record<string, unknown> : {};
  return remote.kind === 'stockBatches' && remote.branchId === before.branchId
    && payload.id === before.id && payload.productId === before.productId
    && (payload.branchId || remote.branchId) === before.branchId
    && closeEnough(payload.quantity, before.quantity)
    && String(payload.expiryDate || '') === String(before.expiryDate || '')
    && closeEnough(payload.unitCost, before.unitCost)
    && String(payload.purchaseId || '') === String(before.purchaseId || '')
    && String(payload.supplierId || '') === String(before.supplierId || '')
    && String(payload.receivedAt || '') === String(before.receivedAt || '')
    && String(payload.stockReceiptId || '') === String(before.stockReceiptId || '');
}

function cleanForCloud<T>(value: T): T {
  const serialized = JSON.stringify(value, (key, child: unknown) => {
    if (typeof child === 'string' && ['logoUrl', 'bannerUrl', 'photoUrl', 'image'].includes(key)
      && (child.startsWith('local-image:') || child.startsWith('data:image/'))) return '';
    return child;
  });
  return (serialized === undefined ? value : JSON.parse(serialized)) as T;
}

export type BranchShipmentAutoCompleteInput = {
  uid: string;
  shipment: BranchStockShipment;
  beforeProducts: Product[];
  afterProducts: Product[];
  beforeBatches: StockBatch[];
  afterBatches: StockBatch[];
};

/**
 * Atomically commits an exact-match receipt and the destination Product/Batch
 * additions. Firestore Rules only allow the receiver to make writes that point
 * back to this exact shipment, line index, and batch-allocation index.
 */
export async function commitBranchShipmentAutoCompleteToCloud(input: BranchShipmentAutoCompleteInput): Promise<{ alreadyCommitted: boolean }> {
  const { uid, shipment } = input;
  const currentUser = firebaseAuth?.currentUser;
  if (!firestore || !currentUser || currentUser.uid !== uid) throw new Error('Firebase Cashier Login မမှန်ပါ။');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Internet မရှိပါ။ ပုံမှန်လက်ခံမှု Auto Complete အတွက် Online ဖြစ်ရန်လိုပါတယ်။');
  if (shipment.status !== 'approved' || shipment.completionMode !== 'auto' || shipment.autoCompletedByUid !== uid
    || !shipment.autoCompletionPlan || shipment.autoCompletionPlan.length !== shipment.items.length
    || !shipment.receivedItems || shipment.receivedItems.length !== shipment.items.length) {
    throw new Error('Auto Complete Plan / Receipt အချက်အလက် မပြည့်စုံပါ။');
  }

  const branchId = shipment.toBranchId;
  const shipmentRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'stockShipments', shipment.id);
  const updatedAt = new Date().toISOString();
  const productWrites = shipment.autoCompletionPlan.map((plan, lineIndex) => {
    const line = shipment.items[lineIndex];
    const receipt = shipment.receivedItems![lineIndex];
    const after = input.afterProducts.find((entry) => entry.id === plan.destinationProductId && entry.branchId === branchId);
    const before = input.beforeProducts.find((entry) => entry.id === plan.destinationProductId && entry.branchId === branchId);
    if (!line || !receipt || receipt.sourceProductId !== line.sourceProductId
      || !closeEnough(receipt.receivedQuantity, line.quantity) || Number(receipt.damagedQuantity) !== 0
      || !after || !closeEnough(plan.destinationStockAfter, plan.destinationStockBefore + line.quantity)
      || !closeEnough(after.stock, plan.destinationStockAfter)
      || (before && !closeEnough(before.stock, plan.destinationStockBefore))
      || (!before && !closeEnough(plan.destinationStockBefore, 0))) {
      throw new Error(`${line?.productName || 'Product'}: Auto Complete အတွက် Stock / Receipt အချက်အလက် မကိုက်ညီပါ။`);
    }
    return { lineIndex, plan, before, after, ref: doc(firestore!, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'products', plan.destinationProductId) };
  });

  const referencedProductIds = new Set(productWrites.map((entry) => entry.plan.destinationProductId));
  const existingBatchSnapshots = input.beforeBatches.filter((entry) => entry.branchId === branchId && referencedProductIds.has(entry.productId));
  const batchWrites = shipment.autoCompletionPlan.flatMap((plan, lineIndex) => plan.destinationBatchIds.map((batchId, batchIndex) => {
    const after = input.afterBatches.find((entry) => entry.id === batchId && entry.branchId === branchId && entry.productId === plan.destinationProductId);
    if (!after || after.sourceShipmentId !== shipment.id || after.sourceShipmentLineIndex !== lineIndex || after.sourceShipmentBatchIndex !== batchIndex
      || after.stockReceiptId !== shipment.id) throw new Error('Destination Stock Batch အချက်အလက် မကိုက်ညီပါ။');
    return {
      lineIndex, batchIndex, after,
      ref: doc(firestore!, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'stockBatches', batchId),
    };
  }));

  if (productWrites.length + batchWrites.length + 1 > 450) throw new Error('Shipment ထဲရှိ Product / Batch အရေအတွက်များလွန်းပါတယ်။ ပစ္စည်းအမျိုးအစား လျှော့ပြီး ပြန်စမ်းပါ။');
  const readRefs = [
    ...productWrites.map((entry) => entry.ref),
    ...existingBatchSnapshots.map((entry) => doc(firestore!, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'stockBatches', entry.id)),
    ...batchWrites.map((entry) => entry.ref),
  ];

  const commit = async () => runTransaction(firestore!, async (transaction) => {
    const shipmentSnapshot = await transaction.get(shipmentRef);
    if (!shipmentSnapshot.exists()) throw new Error('Cloud Shipment ကို မတွေ့ပါ။');
    const remoteShipment = shipmentSnapshot.data();
    const remotePayload = remoteShipment.payload as BranchStockShipment | undefined;
    if (remoteShipment.kind !== 'stockShipments' || remoteShipment.branchId !== branchId || remotePayload?.id !== shipment.id) throw new Error('Cloud Shipment Data မကိုက်ညီပါ။');
    if (remotePayload.status === 'approved' && remotePayload.completionMode === 'auto' && remotePayload.autoCompletedByUid === uid) return 'already' as const;
    if (remotePayload.status !== 'dispatched' || remotePayload.toBranchId !== branchId) throw new Error('ဒီ Shipment ကို လက်ခံပြီးသား သို့မဟုတ် ပြောင်းလဲသွားပါပြီ။ History ကို Refresh လုပ်ပါ။');
    const sameShipmentItems = Array.isArray(remotePayload.items) && remotePayload.items.length === shipment.items.length
      && remotePayload.items.every((remoteItem, index) => {
        const localItem = shipment.items[index];
        if (!localItem || remoteItem.sourceProductId !== localItem.sourceProductId
          || remoteItem.productName !== localItem.productName || String(remoteItem.sku || '') !== String(localItem.sku || '')
          || String(remoteItem.barcode || '') !== String(localItem.barcode || '') || remoteItem.category !== localItem.category
          || !closeEnough(remoteItem.quantity, localItem.quantity) || remoteItem.unit !== localItem.unit
          || remoteItem.quantityMode !== localItem.quantityMode || !closeEnough(remoteItem.costPrice, localItem.costPrice)
          || !closeEnough(remoteItem.retailPrice, localItem.retailPrice) || !closeEnough(remoteItem.wholesalePrice, localItem.wholesalePrice)
          || !closeEnough(remoteItem.lowStockAt, localItem.lowStockAt)
          || !Array.isArray(remoteItem.batchAllocations) || remoteItem.batchAllocations.length !== localItem.batchAllocations.length) return false;
        return remoteItem.batchAllocations.every((allocation, batchIndex) => {
          const localAllocation = localItem.batchAllocations[batchIndex];
          return !!localAllocation && allocation.sourceBatchId === localAllocation.sourceBatchId
            && closeEnough(allocation.quantity, localAllocation.quantity)
            && closeEnough(allocation.unitCost, localAllocation.unitCost)
            && String(allocation.expiryDate || '') === String(localAllocation.expiryDate || '')
            && String(allocation.purchaseId || '') === String(localAllocation.purchaseId || '')
            && String(allocation.supplierId || '') === String(localAllocation.supplierId || '');
        });
      });
    if (!sameShipmentItems) throw new Error('Cloud Shipment Items / Batch ခွဲဝေစာရင်း ပြောင်းလဲသွားပါတယ်။ ထပ်မံ Auto Complete မလုပ်ပါနှင့်။');

    const snapshots = [];
    for (const ref of readRefs) snapshots.push(await transaction.get(ref));
    let offset = 0;
    const productSnapshots = snapshots.slice(offset, offset += productWrites.length);
    const batchBeforeSnapshots = snapshots.slice(offset, offset += existingBatchSnapshots.length);
    const newBatchSnapshots = snapshots.slice(offset, offset + batchWrites.length);

    productWrites.forEach((entry, index) => {
      const snapshot = productSnapshots[index];
      if (entry.before) {
        if (!snapshot.exists() || !sameProduct(snapshot.data(), entry.before)) throw new Error('Destination Product Stock က Cloud နဲ့ မကိုက်ညီပါ။ Refresh လုပ်ပြီး ပြန်စစ်ပါ။');
      } else if (snapshot.exists()) {
        throw new Error('Destination Product ID တူညီသော Cloud Record ရှိနေပါတယ်။ Duplicate မဖြစ်စေရန် ရပ်ထားပါတယ်။');
      }
    });
    batchBeforeSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists() || !sameBatch(snapshot.data(), existingBatchSnapshots[index])) throw new Error('Destination Batch စာရင်း Cloud နဲ့ မကိုက်ညီပါ။ Owner Review သို့ ပြန်ပို့ပါ။');
    });
    newBatchSnapshots.forEach((snapshot) => {
      if (snapshot.exists()) throw new Error('Destination Batch ID တူညီပြီးသား Cloud Record ရှိနေပါတယ်။ Duplicate Stock မဖြစ်စေရန် ရပ်ထားပါတယ်။');
    });

    // All reads are complete. Write the stock, its lot batches, and the approved
    // shipment in one Firestore transaction so a retry cannot add stock twice.
    productWrites.forEach(({ lineIndex, ref, after }) => transaction.set(ref, {
      scope: 'branchRecord', kind: 'products', branchId, payload: cleanForCloud(after), deleted: false,
      updatedAt, updatedBy: uid, sourceShipmentId: shipment.id, sourceShipmentLineIndex: lineIndex,
    }, { merge: true }));
    batchWrites.forEach(({ lineIndex, batchIndex, after, ref }) => transaction.set(ref, {
      scope: 'branchRecord', kind: 'stockBatches', branchId, payload: cleanForCloud(after), deleted: false,
      updatedAt, updatedBy: uid, sourceShipmentId: shipment.id, sourceShipmentLineIndex: lineIndex, sourceShipmentBatchIndex: batchIndex,
    }, { merge: true }));
    transaction.set(shipmentRef, {
      scope: 'branchRecord', kind: 'stockShipments', branchId, payload: cleanForCloud(shipment), deleted: false,
      updatedAt, updatedBy: uid,
    }, { merge: true });
    return 'committed' as const;
  });

  try {
    const result = await commit();
    recordFirestoreActivity(uid, 'read', 'branch-shipment-auto-complete-validation', readRefs.length + 1);
    recordFirestoreActivity(uid, 'write', 'branch-shipment-auto-complete-commit', productWrites.length + batchWrites.length + 1);
    return { alreadyCommitted: result === 'already' };
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code || '');
    const message = error instanceof Error ? error.message : String(error || '');
    const mayHaveLostAck = ['unavailable', 'deadline-exceeded', 'network-request-failed', 'cancelled', 'unknown'].includes(code)
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
      throw new BranchShipmentAutoCompleteUnknownError('Auto Complete ရဲ့ Cloud အတည်ပြုချက် မရသေးပါ။ ထပ်မံ Scan/Submit မလုပ်ပါနှင့်။ Shipment History ကို Refresh လုပ်ပြီး အရင်စစ်ပါ။');
    }
    throw error;
  }
}
