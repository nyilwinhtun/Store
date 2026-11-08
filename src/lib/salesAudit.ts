import {
  collection,
  doc,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  runTransaction,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { firebaseAuth, firestore, FIREBASE_BUSINESS_ID } from './firebase';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import { cleanQuantity, quantityModeForProduct } from './quantity';
import type { Product, Sale } from '../store/usePosStore';

export type SalesAuditEvent = {
  id: string;
  eventType: 'SALE_CREATED' | 'SALE_VOIDED';
  branchId: string;
  saleId: string;
  receiptNo: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  occurredAt: string;
  total: number;
  reason?: string;
};

export type SalesAuditActor = { uid: string; email: string; name: string };

function branchDoc(branchId: string, collectionName: string, id: string): DocumentReference<DocumentData> {
  if (!firestore) throw new Error('Firebase Firestore မချိတ်ဆက်ရသေးပါ။');
  return doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, collectionName, id);
}

/** Owner-only, atomic full void for a cloud-committed sale. It restores product/batch stock once and appends an immutable audit event. */
export async function voidCloudSaleWithAudit(sale: Sale, reason: string, actor: SalesAuditActor): Promise<SalesAuditEvent> {
  if (!firestore || !firebaseAuth?.currentUser) throw new Error('Owner Firebase Session မရှိပါ။');
  if (firebaseAuth.currentUser.uid !== actor.uid) throw new Error('Login UID နဲ့ လုပ်ဆောင်သူ UID မကိုက်ညီပါ။');
  if (!sale.id || !sale.branchId || !reason.trim()) throw new Error('Voucher၊ Branch နဲ့ Void အကြောင်းပြချက် လိုအပ်ပါတယ်။');
  if (sale.paymentMethod === 'Credit' && (sale.paidAmount ?? 0) > 0) throw new Error('ကြိုတင်ပေးချေထားသော Credit Sale ကို ဒီလုပ်ဆောင်ချက်ဖြင့် Void မလုပ်နိုင်ပါ။ Payment ပြန်အမ်းမှုကို သီးခြားစီမံရန်လိုပါတယ်။');

  const saleRef = branchDoc(sale.branchId, 'sales', sale.id);
  const auditId = `${sale.id}__void`;
  const auditRef = branchDoc(sale.branchId, 'auditEvents', auditId);
  const now = new Date().toISOString();
  let readCount = 0;
  let writeCount = 0;

  const result = await runTransaction(firestore, async (transaction) => {
    writeCount = 0;
    const saleSnapshot = await transaction.get(saleRef);
    readCount += 1;
    if (!saleSnapshot.exists() || saleSnapshot.data().kind !== 'sales' || saleSnapshot.data().branchId !== sale.branchId) {
      throw new Error('ဒီ Voucher ကို Cloud ထဲမှာ မတွေ့သေးပါ။ Cloud Sync ပြီးမှ Void လုပ်ပါ။');
    }
    const currentPayload = saleSnapshot.data().payload as Record<string, unknown> | undefined;
    if (!currentPayload || typeof currentPayload !== 'object') throw new Error('Cloud Sale Data မမှန်ကန်ပါ။');
    if (currentPayload.status === 'voided') {
      const priorAudit = await transaction.get(auditRef);
      readCount += 1;
      if (priorAudit.exists()) return priorAudit.data() as SalesAuditEvent;
      throw new Error('Voucher ကို ပယ်ဖျက်ထားပြီးဖြစ်သော်လည်း Audit Record မတွေ့ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    }
    if (currentPayload.status !== 'completed') throw new Error('Completed Sale မဟုတ်သောကြောင့် Void မလုပ်နိုင်ပါ။');
    if (currentPayload.paymentMethod === 'Credit' && Number(currentPayload.paidAmount || 0) > 0) {
      throw new Error('ကြိုတင်ပေးချေထားသော Credit Sale ကို Void မလုပ်နိုင်ပါ။');
    }

    const items = Array.isArray(currentPayload.items) ? currentPayload.items as Array<Record<string, unknown>> : [];
    if (!items.length) throw new Error('Sale ထဲမှာ ပစ္စည်းစာရင်း မရှိပါ။');
    const productDeltas = new Map<string, number>();
    const batchDeltas = new Map<string, number>();
    const unitIdsByRegistry = new Map<string, Set<string>>();
    for (const item of items) {
      const productId = String(item.productId || '');
      const quantity = Number(item.quantity);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Sale Item အချက်အလက် မမှန်ကန်ပါ။');
      productDeltas.set(productId, (productDeltas.get(productId) || 0) + quantity);
      const allocations = Array.isArray(item.batchAllocations) ? item.batchAllocations as Array<Record<string, unknown>> : [];
      const selections = Array.isArray(item.stockUnitSelections) ? item.stockUnitSelections as Array<Record<string, unknown>> : [];
      for (const selection of selections) {
        const registryId = String(selection.registryId || '');
        const unitId = String(selection.unitId || '');
        if (!registryId || !unitId) throw new Error('Sale Barcode Unit အချက်အလက် မမှန်ကန်ပါ။');
        const ids = unitIdsByRegistry.get(registryId) || new Set<string>();
        ids.add(unitId);
        unitIdsByRegistry.set(registryId, ids);
      }
      for (const allocation of allocations) {
        const batchId = String(allocation.batchId || '');
        const allocatedQuantity = Number(allocation.quantity);
        if (!batchId || !Number.isFinite(allocatedQuantity) || allocatedQuantity <= 0) throw new Error('Batch Allocation အချက်အလက် မမှန်ကန်ပါ။');
        batchDeltas.set(batchId, (batchDeltas.get(batchId) || 0) + allocatedQuantity);
      }
    }

    const productEntries = [...productDeltas.entries()].map(([id, quantity]) => ({ id, quantity, ref: branchDoc(sale.branchId!, 'products', id) }));
    const batchEntries = [...batchDeltas.entries()].map(([id, quantity]) => ({ id, quantity, ref: branchDoc(sale.branchId!, 'stockBatches', id) }));
    const unitRegistryEntries = [...unitIdsByRegistry.entries()].map(([id, unitIds]) => ({ id, unitIds, ref: branchDoc(sale.branchId!, 'stockUnitRegistries', id) }));
    const auditSnapshot = await transaction.get(auditRef);
    const productSnapshots = await Promise.all(productEntries.map((entry) => transaction.get(entry.ref)));
    const batchSnapshots = await Promise.all(batchEntries.map((entry) => transaction.get(entry.ref)));
    const unitRegistrySnapshots = await Promise.all(unitRegistryEntries.map((entry) => transaction.get(entry.ref)));
    readCount += 1 + productSnapshots.length + batchSnapshots.length + unitRegistrySnapshots.length;
    if (auditSnapshot.exists()) throw new Error('ဒီ Voucher အတွက် Void Audit Record ရှိပြီးသားပါ။ ထပ်မလုပ်ပါနဲ့။');

    const productUpdates: Array<{ ref: DocumentReference<DocumentData>; payload: Record<string, unknown> }> = [];
    productEntries.forEach((entry, index) => {
      const snapshot = productSnapshots[index];
      if (!snapshot.exists() || snapshot.data().kind !== 'products' || snapshot.data().deleted === true) throw new Error(`Cloud Product မတွေ့ပါ: ${entry.id}`);
      const payload = snapshot.data().payload as Record<string, unknown> | undefined;
      if (!payload || !Number.isFinite(Number(payload.stock))) throw new Error(`Cloud Product Stock မမှန်ပါ: ${entry.id}`);
      const product = payload as unknown as Product;
      productUpdates.push({ ref: entry.ref, payload: { ...payload, stock: cleanQuantity(Number(payload.stock) + entry.quantity, quantityModeForProduct(product)) } });
    });
    const batchUpdates: Array<{ ref: DocumentReference<DocumentData>; payload: Record<string, unknown> }> = [];
    batchEntries.forEach((entry, index) => {
      const snapshot = batchSnapshots[index];
      if (!snapshot.exists() || snapshot.data().kind !== 'stockBatches' || snapshot.data().deleted === true) throw new Error(`Cloud Stock Batch မတွေ့ပါ: ${entry.id}`);
      const payload = snapshot.data().payload as Record<string, unknown> | undefined;
      if (!payload || !Number.isFinite(Number(payload.quantity))) throw new Error(`Cloud Batch Quantity မမှန်ပါ: ${entry.id}`);
      const mode = quantityModeForProduct({ unit: String(payload.unit || 'ခု'), quantityMode: payload.quantityMode as Product['quantityMode'] } as Product);
      batchUpdates.push({ ref: entry.ref, payload: { ...payload, quantity: cleanQuantity(Number(payload.quantity) + entry.quantity, mode) } });
    });

    const unitRegistryUpdates: Array<{ ref: DocumentReference<DocumentData>; payload: Record<string, unknown> }> = [];
    unitRegistryEntries.forEach((entry, index) => {
      const snapshot = unitRegistrySnapshots[index];
      if (!snapshot.exists() || snapshot.data().kind !== 'stockUnitRegistries' || snapshot.data().deleted === true) {
        throw new Error(`Cloud Barcode Registry မတွေ့ပါ: ${entry.id}`);
      }
      const payload = snapshot.data().payload as Record<string, unknown> | undefined;
      const units = Array.isArray(payload?.units) ? payload!.units as Array<Record<string, unknown>> : [];
      let restored = 0;
      const nextUnits = units.map((unit) => {
        if (entry.unitIds.has(String(unit.id || '')) && unit.status === 'sold' && unit.saleId === sale.id) {
          restored += 1;
          return { ...unit, status: 'in_stock', lastSaleId: sale.id, saleId: undefined, soldAt: undefined, soldByUid: undefined };
        }
        return unit;
      });
      if (restored !== entry.unitIds.size) throw new Error(`Void ပြန်လည် Stock ဝင်မည့် Barcode Unit မကိုက်ညီပါ: ${entry.id}`);
      unitRegistryUpdates.push({ ref: entry.ref, payload: { ...payload, units: nextUnits, updatedAt: now, updatedByUid: actor.uid } });
    });

    const auditEvent: SalesAuditEvent = {
      id: auditId, eventType: 'SALE_VOIDED', branchId: sale.branchId!, saleId: sale.id,
      receiptNo: String(currentPayload.receiptNo || sale.receiptNo), actorUid: actor.uid,
      actorEmail: actor.email, actorName: actor.name, occurredAt: now,
      total: Number(currentPayload.total || 0), reason: reason.trim(),
    };
    const voidedPayload = {
      ...currentPayload, status: 'voided', dueAmount: 0, voidReason: reason.trim(),
      voidedAt: now, voidedByUid: actor.uid, voidedByEmail: actor.email, voidedByName: actor.name,
    };
    transaction.update(saleRef, { payload: voidedPayload, updatedAt: now, updatedBy: actor.uid });
    productUpdates.forEach((entry) => transaction.update(entry.ref, { payload: entry.payload, updatedAt: now, updatedBy: actor.uid }));
    batchUpdates.forEach((entry) => transaction.update(entry.ref, { payload: entry.payload, updatedAt: now, updatedBy: actor.uid }));
    unitRegistryUpdates.forEach((entry) => transaction.update(entry.ref, { payload: entry.payload, updatedAt: now, updatedBy: actor.uid }));
    transaction.set(auditRef, auditEvent);
    writeCount = 1 + productUpdates.length + batchUpdates.length + unitRegistryUpdates.length + 1;
    return auditEvent;
  });

  recordFirestoreActivity(actor.uid, 'read', 'owner-sale-void-transaction', readCount);
  recordFirestoreActivity(actor.uid, 'write', 'owner-sale-void-transaction', writeCount);
  console.info('[Minimart Sales Audit]', { eventType: 'SALE_VOIDED', saleId: sale.id, branchId: sale.branchId, readEstimate: readCount, committedWrites: writeCount });
  return result;
}

/** Fetch-on-demand audit history. No realtime listener; reads only when the Owner opens Activity Log. */
export async function loadBranchSalesAudit(branchId: string): Promise<SalesAuditEvent[]> {
  if (!firestore) return [];
  const snapshot = await getDocsFromServer(query(
    collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'auditEvents'),
    orderBy('occurredAt', 'desc'),
    limit(100),
  ));
  const events = snapshot.docs.map((entry) => entry.data() as SalesAuditEvent);
  recordFirestoreActivity(firebaseAuth?.currentUser?.uid || 'local', 'read', 'sales-audit-history', snapshot.size);
  return events;
}
