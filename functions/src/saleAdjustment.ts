import { getFirestore, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const BUSINESS_ID = 'store-mini-main';
const FUNCTION_REGION = 'asia-southeast1';
const EPSILON = 0.000001;
const MAX_LINES = 100;
const MAX_UNITS = 200;
const MAX_WRITES = 450;
const REASON_MIN_LENGTH = 3;
const REASON_MAX_LENGTH = 300;
const MAX_REFUND_REFERENCE_LENGTH = 120;
const DOC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{3,99}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

type Dict = Record<string, unknown>;
type Disposition = 'restock' | 'damaged';
type SaleLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  batchAllocations: Array<{ batchId: string; quantity: number }>;
  selections: Array<{ registryId: string; unitId: string; barcode: string; batchId?: string }>;
};
type ReturnLineInput = {
  productId: string;
  quantity: number;
  disposition: Disposition;
  units: Array<{ registryId: string; unitId: string; disposition: Disposition }>;
};

function asRecord(value: unknown): Dict | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Dict : null;
}

function asRecordList(value: unknown): Dict[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item): item is Dict => !!item);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : Number.NaN;
}

function cleanQuantity(value: number, whole: boolean): number {
  return whole && Math.abs(value - Math.round(value)) < 1e-8 ? Math.round(value) : Math.round(value * 1000) / 1000;
}

function moneyRound(value: number): number {
  return Math.round(value * 100) / 100;
}

function failed(message: string): never {
  throw new HttpsError('failed-precondition', message);
}

function invalid(message: string): never {
  throw new HttpsError('invalid-argument', message);
}

function limitedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function dispositionOf(value: unknown, label: string): Disposition {
  if (value === 'restock' || value === 'damaged') return value;
  invalid(`${label}: ပြန်လည်ထည့်မည် / ပျက်စီး Quarantine ရွေးချယ်မှု မမှန်ကန်ပါ။`);
}

function isPathSafe(value: string): boolean {
  return DOC_ID_PATTERN.test(value);
}

function payloadOf(snapshot: { exists: boolean; data: () => DocumentData | undefined }, ...expected: Array<[string, string]>): Dict | null {
  if (!snapshot.exists) return null;
  const record = snapshot.data() || {};
  for (const [key, value] of expected) if (record[key] !== value) return null;
  return asRecord(record.payload);
}

function branchRecord(ref: DocumentReference<DocumentData>, kind: string, branchId: string, uid: string, now: string, payload: Dict) {
  return { scope: 'branchRecord', kind, branchId, deleted: false, updatedAt: now, updatedBy: uid, payload };
}

/** The Sale document created by the trusted callable is the only adjustment source. */
function saleLines(sale: Dict): SaleLine[] {
  const items = asRecordList(sale.items);
  if (!items.length) failed('Sale ထဲမှာ ပစ္စည်းစာရင်း မရှိပါ။');
  return items.map((item, index) => {
    const productId = str(item.productId).trim();
    const quantity = num(item.quantity);
    const unitPrice = num(item.unitPrice);
    const costPrice = num(item.costPrice);
    if (!productId || !isPathSafe(productId) || !Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(costPrice) || costPrice < 0) {
      failed(`Sale Item ${index + 1} အချက်အလက် မမှန်ကန်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
    }
    const batchAllocations = asRecordList(item.batchAllocations).map((allocation) => {
      const batchId = str(allocation.batchId).trim();
      const allocatedQuantity = num(allocation.quantity);
      if (!batchId || !isPathSafe(batchId) || !Number.isFinite(allocatedQuantity) || allocatedQuantity <= 0) {
        failed(`Sale Item ${index + 1}: Stock Batch ခွဲဝေမှု မမှန်ကန်ပါ။`);
      }
      return { batchId, quantity: allocatedQuantity };
    });
    const selections = asRecordList(item.stockUnitSelections).map((selection) => {
      const registryId = str(selection.registryId).trim();
      const unitId = str(selection.unitId).trim();
      const barcode = str(selection.barcode).trim();
      if (!registryId || !isPathSafe(registryId) || !unitId || !barcode) {
        failed(`Sale Item ${index + 1}: Sticker Unit အချက်အလက် မမှန်ကန်ပါ။`);
      }
      return { registryId, unitId, barcode, ...(str(selection.batchId) ? { batchId: str(selection.batchId) } : {}) };
    });
    if (selections.length > 0 && (!Number.isInteger(quantity) || selections.length !== quantity)) {
      failed(`Sale Item ${index + 1}: Sticker Unit စာရင်းနှင့် ပမာဏ မကိုက်ညီပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
    }
    return { productId, quantity, unitPrice, costPrice, batchAllocations, selections };
  });
}

/**
 * Trusted identity/branch only. Role, status and Branch assignment are read from
 * the Firestore membership document; the request cannot self-assign them.
 */
async function authorizedActor(request: { auth?: { uid: string; token: Dict } }, body: Dict) {
  const auth = request.auth;
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Login လိုအပ်ပါတယ်။');
  const uid = auth.uid;
  if (str(body.uid) !== uid) throw new HttpsError('permission-denied', 'Request UID မကိုက်ညီပါ။');
  const branchId = str(body.branchId).trim();
  const saleId = str(body.saleId).trim();
  const requestId = str(body.requestId).trim();
  const reason = limitedString(body.reason, REASON_MAX_LENGTH);
  const deviceId = str(body.deviceId).trim();
  if (!isPathSafe(branchId)) invalid('Branch ID မမှန်ကန်ပါ။');
  if (!isPathSafe(saleId)) invalid('Sale ID မမှန်ကန်ပါ။');
  if (!REQUEST_ID_PATTERN.test(requestId)) invalid('Adjustment Request ID မမှန်ကန်ပါ။');
  if (reason.length < REASON_MIN_LENGTH) invalid('အကြောင်းပြချက် အနည်းဆုံး ၃ လုံး ဖြည့်ပါ။');
  if (!DEVICE_ID_PATTERN.test(deviceId)) invalid('Device ID မမှန်ကန်ပါ။');

  const authEmail = str(auth.token.email).trim().toLowerCase();
  const actorName = str(auth.token.name) || authEmail || 'User';
  const now = new Date().toISOString();
  const db = getFirestore();
  const businessRef = db.collection('businesses').doc(BUSINESS_ID);
  const branchRef = businessRef.collection('branches').doc(branchId);
  const memberRef = businessRef.collection('members').doc(uid);

  const [businessSnapshot, memberSnapshot, branchSnapshot] = await Promise.all([
    businessRef.get(), memberRef.get(), branchRef.get(),
  ]);
  if (!businessSnapshot.exists || businessSnapshot.data()?.active === false) {
    throw new HttpsError('failed-precondition', 'Minimart Business မရရှိနိုင်ပါ။');
  }
  const business = businessSnapshot.data() || {};
  const isBusinessOwner = str(business.ownerUid) === uid;
  if (!isBusinessOwner) {
    if (!memberSnapshot.exists) throw new HttpsError('permission-denied', 'Membership မတွေ့ပါ။');
    const member = memberSnapshot.data() || {};
    const memberEmail = str(member.email).trim().toLowerCase();
    const branchIds = Array.isArray(member.branchIds) ? member.branchIds.map(String) : [];
    if (member.uid !== uid || member.role !== 'cashier' || member.status !== 'active') {
      throw new HttpsError('permission-denied', 'Active Owner / Cashier ခွင့်မရှိပါ။');
    }
    if (!authEmail || !memberEmail || memberEmail !== authEmail) {
      throw new HttpsError('permission-denied', 'Login Email နှင့် Membership မကိုက်ညီပါ။');
    }
    if (!branchIds.includes(branchId)) {
      throw new HttpsError('permission-denied', 'ဒီ Branch အတွက် Active Cashier ခွင့်မရှိပါ။');
    }
  } else if (!authEmail) {
    throw new HttpsError('permission-denied', 'Login Email မရှိပါ။');
  }
  const branchPayload = payloadOf(branchSnapshot, ['kind', 'branches']);
  if (!branchPayload) throw new HttpsError('failed-precondition', 'Branch မတွေ့ပါ။');
  if (branchPayload.status !== 'active') throw new HttpsError('permission-denied', 'Branch သည် Active မဟုတ်ပါ။');

  return {
    uid, branchId, saleId, requestId, reason, deviceId, authEmail, actorName, now,
    db, businessRef, branchRef,
    saleRef: branchRef.collection('sales').doc(saleId),
  };
}

function refundOutcome(paymentMethod: string, paidAmount: number, total: number, value: number): { status: string; amount: number } {
  if (paymentMethod === 'Cash') return { status: 'cash-refunded', amount: moneyRound(Math.min(value, paidAmount || total)) };
  if (paymentMethod === 'KPay') return { status: 'kpay-pending', amount: moneyRound(Math.min(value, paidAmount || total)) };
  return { status: 'credit-review', amount: moneyRound(value) };
}

/**
 * Cashier/Owner Void. One atomic transaction restores Product stock, Batch
 * quantities and the exact sold stickers, preserves the original Sale and
 * writes an immutable SALE_VOIDED audit event. No approval step is required.
 */
export const cashierSaleVoid = onCall(
  { region: FUNCTION_REGION, timeoutSeconds: 60, memory: '512MiB', maxInstances: 10 },
  async (request) => {
    const body = asRecord(request.data);
    if (!body) invalid('Request မမှန်ကန်ပါ။');
    const actor = await authorizedActor(request as { auth?: { uid: string; token: Dict } }, body);
    const { branchRef, branchId, uid, now, authEmail, actorName, saleId, requestId, reason, deviceId, db, saleRef } = actor;
    const auditRef = branchRef.collection('auditEvents').doc(`${saleId}__void`);

    return db.runTransaction(async (transaction) => {
      const saleSnapshot = await transaction.get(saleRef);
      const auditSnapshot = await transaction.get(auditRef);
      const salePayload = payloadOf(saleSnapshot, ['kind', 'sales']);
      if (!salePayload) failed('Cloud Sale မတွေ့ပါ။ Cloud Sync ပြီးမှ Void လုပ်ပါ။');
      if (salePayload.branchId !== branchId) failed('Sale Branch မကိုက်ညီပါ။');
      if (salePayload.status === 'voided') {
        if (auditSnapshot.exists && auditSnapshot.data()?.voidRequestId === requestId) {
          const existingAudit = auditSnapshot.data() || {};
          return {
            result: 'already-committed', kind: 'void', occurredAt: existingAudit.occurredAt,
            refundStatus: existingAudit.refundStatus, refundAmount: existingAudit.refundAmount,
            total: existingAudit.total,
          };
        }
        failed('Voucher ကို ပယ်ဖျက်ထားပြီးဖြစ်ပါတယ်။ Owner စစ်ဆေးရန်လိုပါတယ်။');
      }
      if (salePayload.status !== 'completed') failed('Completed Sale မဟုတ်ပါ။');
      if (salePayload.paymentMethod === 'Credit' && Number(salePayload.paidAmount || 0) > 0) {
        failed('ကြိုတင်ပေးချေထားသော Credit Sale ကို Void မလုပ်နိုင်ပါ။ Payment ပြန်အမ်းမှုကို သီးခြားစီမံရန်လိုပါတယ်။');
      }
      if ((num(salePayload.returnCount) || 0) > 0 || asRecordList(salePayload.returns).length > 0 || (num(salePayload.returnedTotal) || 0) > 0) {
        failed('Return ပြုလုပ်ပြီးသား Sale ကို Void မလုပ်နိုင်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
      }
      if (auditSnapshot.exists) failed('ဒီ Voucher အတွက် Void Audit Record ရှိပြီးသား ဖြစ်နေပါတယ်။ Owner စစ်ဆေးရန်လိုပါတယ်။');

      const lines = saleLines(salePayload);
      if (lines.length > MAX_LINES) throw new HttpsError('resource-exhausted', 'Sale ပစ္စည်းအရေအတွက် များလွန်းပါတယ်။');
      const productIds = [...new Set(lines.map((line) => line.productId))];
      const productQuantities = new Map<string, number>();
      const batchTotals = new Map<string, { productId: string; quantity: number }>();
      const registryUnits = new Map<string, { productId: string; unitIds: Set<string> }>();
      lines.forEach((line) => {
        productQuantities.set(line.productId, (productQuantities.get(line.productId) || 0) + line.quantity);
        line.batchAllocations.forEach((allocation) => {
          const previous = batchTotals.get(allocation.batchId);
          if (previous && previous.productId !== line.productId) failed('Stock Batch တစ်ခုကို Product မတူဘဲ သုံးထားပါတယ်။');
          batchTotals.set(allocation.batchId, {
            productId: line.productId,
            quantity: (previous?.quantity || 0) + allocation.quantity,
          });
        });
        line.selections.forEach((selection) => {
          const entry = registryUnits.get(selection.registryId) || { productId: line.productId, unitIds: new Set<string>() };
          if (entry.productId !== line.productId) failed('Sticker Registry Product မကိုက်ညီပါ။');
          entry.unitIds.add(selection.unitId);
          registryUnits.set(selection.registryId, entry);
        });
      });
      if ([...registryUnits.values()].reduce((sum, entry) => sum + entry.unitIds.size, 0) > MAX_UNITS) {
        throw new HttpsError('resource-exhausted', 'Sticker Unit အရေအတွက် များလွန်းပါတယ်။');
      }

      const productRefs = productIds.map((id) => branchRef.collection('products').doc(id));
      const batchIds = [...batchTotals.keys()];
      const batchRefs = batchIds.map((id) => branchRef.collection('stockBatches').doc(id));
      const registryIds = [...registryUnits.keys()];
      const registryRefs = registryIds.map((id) => branchRef.collection('stockUnitRegistries').doc(id));
      const [productSnapshots, batchSnapshots, registrySnapshots] = await Promise.all([
        Promise.all(productRefs.map((ref) => transaction.get(ref))),
        Promise.all(batchRefs.map((ref) => transaction.get(ref))),
        Promise.all(registryRefs.map((ref) => transaction.get(ref))),
      ]);

      const productWrites: Array<{ ref: DocumentReference<DocumentData>; payload: Dict }> = [];
      productIds.forEach((productId, index) => {
        const snapshot = productSnapshots[index];
        const payload = payloadOf(snapshot, ['kind', 'products']);
        if (!payload || snapshot.data()?.deleted === true) failed(`Cloud Product မတွေ့ပါ: ${productId}`);
        if (str(payload.branchId || branchId) !== branchId) failed(`Cloud Product Branch မကိုက်ညီပါ: ${productId}`);
        const currentStock = num(payload.stock);
        if (!Number.isFinite(currentStock) || currentStock < 0) failed(`Cloud Product Stock မမှန်ပါ: ${productId}`);
        productWrites.push({
          ref: productRefs[index],
          payload: { ...payload, stock: cleanQuantity(currentStock + (productQuantities.get(productId) || 0), str(payload.quantityMode || 'whole') !== 'decimal') },
        });
      });

      const batchWrites: Array<{ ref: DocumentReference<DocumentData>; payload: Dict }> = [];
      batchIds.forEach((batchId, index) => {
        const expected = batchTotals.get(batchId)!;
        const snapshot = batchSnapshots[index];
        const record = snapshot.data() || {};
        const payload = payloadOf(snapshot, ['kind', 'stockBatches']);
        if (!payload || record.deleted === true || record.branchId !== branchId || payload.productId !== expected.productId) {
          failed(`Cloud Stock Batch မတွေ့ပါ / Data မကိုက်ညီပါ: ${batchId}`);
        }
        const currentQuantity = num(payload.quantity);
        if (!Number.isFinite(currentQuantity) || currentQuantity < 0) failed(`Cloud Batch Quantity မမှန်ပါ: ${batchId}`);
        const productPayload = productSnapshots[productIds.indexOf(expected.productId)]?.data()?.payload;
        batchWrites.push({
          ref: batchRefs[index],
          payload: { ...payload, quantity: cleanQuantity(currentQuantity + expected.quantity, str(productPayload?.quantityMode || 'whole') !== 'decimal') },
        });
      });

      const registryWrites: Array<{ ref: DocumentReference<DocumentData>; payload: Dict }> = [];
      registryIds.forEach((registryId, index) => {
        const expected = registryUnits.get(registryId)!;
        const snapshot = registrySnapshots[index];
        const payload = payloadOf(snapshot, ['kind', 'stockUnitRegistries']);
        if (!payload || snapshot.data()?.deleted === true) failed(`Cloud Sticker Registry မတွေ့ပါ: ${registryId}`);
        if (payload.productId !== expected.productId) failed(`Sticker Registry Product မကိုက်ညီပါ: ${registryId}`);
        const units = asRecordList(payload.units);
        let restored = 0;
        const nextUnits = units.map((unit) => {
          if (!expected.unitIds.has(str(unit.id))) return unit;
          if (str(unit.status) !== 'sold' || str(unit.saleId) !== saleId) {
            failed(`Void ပြန်လည် Stock ဝင်မည့် Sticker Unit အခြေအနေ မကိုက်ညီပါ: ${str(unit.barcode || unit.id)}`);
          }
          restored += 1;
          const { saleId: _saleId, soldAt: _soldAt, soldByUid: _soldByUid, ...restoredUnit } = unit;
          return {
            ...restoredUnit, status: 'in_stock', lastSaleId: saleId, voidedSaleId: saleId,
            returnedAt: now, returnedByUid: uid,
          };
        });
        if (restored !== expected.unitIds.size) failed(`Void Sticker Unit အရေအတွက် မကိုက်ညီပါ: ${registryId}`);
        registryWrites.push({
          ref: registryRefs[index],
          payload: branchRecord(registryRefs[index], 'stockUnitRegistries', branchId, uid, now,
            { ...payload, units: nextUnits, updatedAt: now, updatedByUid: uid }),
        });
      });

      const paymentMethod = str(salePayload.paymentMethod);
      const total = num(salePayload.total);
      const paidAmount = num(salePayload.paidAmount);
      const dueAmount = num(salePayload.dueAmount);
      if (!Number.isFinite(total) || total < 0) failed('Sale Total မမှန်ပါ။');
      const refund = paymentMethod === 'Credit'
        ? { status: 'credit-cancelled', amount: 0 }
        : refundOutcome(paymentMethod, Number.isFinite(paidAmount) ? paidAmount : 0, total, total);
      const writeCount = 1 + productWrites.length + batchWrites.length + registryWrites.length + 1;
      if (writeCount > MAX_WRITES) throw new HttpsError('resource-exhausted', 'ဒီ Voucher ကို တစ်ကြိမ်တည်း Void လုပ်ရန် များလွန်းနေပါတယ်။ Owner စစ်ဆေးရန်လိုပါတယ်။');
      const saleFingerprint = str(salePayload.saleFingerprint) || `legacy:${saleId}`;
      const fingerprint = JSON.stringify({ kind: 'void', saleId, requestId, reason, deviceId, uid, saleFingerprint });
      const nextPayload = {
        ...salePayload, status: 'voided', dueAmount: 0, voidReason: reason,
        voidedAt: now, voidedByUid: uid, voidedByEmail: authEmail, voidedByName: actorName,
        voidRequested: false, voidRequestId: requestId, voidFingerprint: fingerprint,
        voidRefundStatus: refund.status, voidRefundAmount: refund.amount,
        lastAdjustmentKind: 'void', lastAdjustedAt: now, lastAdjustedByUid: uid,
      };
      const audit = {
        id: `${saleId}__void`, eventType: 'SALE_VOIDED', branchId, saleId,
        receiptNo: str(salePayload.receiptNo), actorUid: uid, actorEmail: authEmail,
        actorName, occurredAt: now, total, reason, deviceId, requestId, voidRequestId: requestId,
        refundStatus: refund.status, refundAmount: refund.amount,
        saleSnapshot: {
          status: salePayload.status, total,
          paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
          dueAmount: Number.isFinite(dueAmount) ? dueAmount : 0, paymentMethod,
        },
      };

      transaction.set(saleRef, branchRecord(saleRef, 'sales', branchId, uid, now, nextPayload));
      productWrites.forEach((write) => transaction.set(write.ref, branchRecord(write.ref, 'products', branchId, uid, now, write.payload)));
      batchWrites.forEach((write) => transaction.set(write.ref, branchRecord(write.ref, 'stockBatches', branchId, uid, now, write.payload)));
      registryWrites.forEach((write) => transaction.set(write.ref, write.payload));
      transaction.set(auditRef, audit);
      return {
        result: 'created', kind: 'void', occurredAt: now, refundStatus: refund.status,
        refundAmount: refund.amount, total, writeCount,
        items: lines.map((line) => ({
          productId: line.productId, quantity: line.quantity, disposition: 'restock',
          units: line.selections.map((selection) => ({ registryId: selection.registryId, unitId: selection.unitId, disposition: 'restock' })),
        })),
      };
    });
  },
);

/**
 * Cashier/Owner Return. Validates the original Sale line, exact sold Unit IDs,
 * remaining sellable quantity and idempotent Request ID inside one transaction.
 * Damaged units are quarantined and never returned to sellable stock.
 */
export const cashierSaleReturn = onCall(
  { region: FUNCTION_REGION, timeoutSeconds: 60, memory: '512MiB', maxInstances: 10 },
  async (request) => {
    const body = asRecord(request.data);
    if (!body) invalid('Request မမှန်ကန်ပါ။');
    const rawItems = asRecordList(body.items);
    if (!rawItems.length || rawItems.length > MAX_LINES) invalid('Return ပစ္စည်းစာရင်း မမှန်ကန်ပါ။');
    if (asRecordList(body.items).some((item) => asRecordList(item.units).length > MAX_UNITS)) {
      throw new HttpsError('resource-exhausted', 'Sticker Unit အရေအတွက် များလွန်းပါတယ်။');
    }
    const inputLines = rawItems.map((item, index): ReturnLineInput => {
      const productId = str(item.productId).trim();
      if (!isPathSafe(productId)) invalid(`Return Item ${index + 1}: Product ID မမှန်ကန်ပါ။`);
      const quantity = num(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) invalid(`Return Item ${index + 1}: ပမာဏ မမှန်ကန်ပါ။`);
      const disposition = dispositionOf(item.disposition, `Return Item ${index + 1}`);
      const units = asRecordList(item.units).map((unit) => {
        const registryId = str(unit.registryId).trim();
        const unitId = str(unit.unitId).trim();
        if (!isPathSafe(registryId) || !unitId) invalid(`Return Item ${index + 1}: Sticker Unit မမှန်ကန်ပါ။`);
        return { registryId, unitId, disposition: dispositionOf(unit.disposition ?? disposition, `Return Item ${index + 1} Unit`) };
      });
      return { productId, quantity, disposition, units };
    });
    const uniqueProducts = new Set(inputLines.map((line) => line.productId));
    if (uniqueProducts.size !== inputLines.length) invalid('Product တစ်ခုတည်းကို Return စာရင်းထဲ နှစ်ကြိမ် မထည့်ပါနဲ့။');
    const maxUnits = inputLines.reduce((sum, line) => sum + line.units.length, 0);
    if (maxUnits > MAX_UNITS) throw new HttpsError('resource-exhausted', 'Sticker Unit အရေအတွက် များလွန်းပါတယ်။');
    const refundReference = limitedString(body.refundReference, MAX_REFUND_REFERENCE_LENGTH);

    const actor = await authorizedActor(request as { auth?: { uid: string; token: Dict } }, body);
    const { branchRef, branchId, uid, now, authEmail, actorName, saleId, requestId, reason, deviceId, db, saleRef } = actor;
    const returnRef = branchRef.collection('saleReturns').doc(requestId);
    const auditRef = branchRef.collection('auditEvents').doc(`${saleId}__return__${requestId}`);
    const fingerprint = JSON.stringify({
      kind: 'return', saleId, requestId, reason, deviceId, uid,
      items: inputLines.map((line) => ({
        productId: line.productId, quantity: line.quantity, disposition: line.disposition,
        units: line.units.map((unit) => ({ registryId: unit.registryId, unitId: unit.unitId, disposition: unit.disposition })),
      })),
    });

    return db.runTransaction(async (transaction) => {
      const [saleSnapshot, returnSnapshot, auditSnapshot] = await Promise.all([
        transaction.get(saleRef), transaction.get(returnRef), transaction.get(auditRef),
      ]);
      const salePayload = payloadOf(saleSnapshot, ['kind', 'sales']);
      if (!salePayload) failed('Cloud Sale မတွေ့ပါ။ Cloud Sync ပြီးမှ Return လုပ်ပါ။');
      if (salePayload.branchId !== branchId) failed('Sale Branch မကိုက်ညီပါ။');
      if (returnSnapshot.exists) {
        const existing = returnSnapshot.data() || {};
        if (existing.fingerprint === fingerprint && existing.saleId === saleId) {
          return {
            result: 'already-committed', kind: 'return', returnId: requestId,
            occurredAt: existing.occurredAt, value: existing.value,
            refundStatus: existing.refund?.status, refundAmount: existing.refund?.amount,
            dueAmount: existing.dueAmount,
            returnedProductQuantities: existing.returnedProductQuantities || {},
            returnedBatchQuantities: existing.returnedBatchQuantities || {},
            items: asRecordList(existing.responseItems),
          };
        }
        failed('Return Request ID တူနေသော်လည်း အချက်အလက် မတူပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
      }
      if (auditSnapshot.exists) failed('Return Audit Record ရှိပြီး Return Record မတွေ့ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
      if (salePayload.status !== 'completed') failed('Completed Sale မဟုတ်သောကြောင့် Return မလုပ်နိုင်ပါ။');

      const lines = saleLines(salePayload);
      const lineByProduct = new Map<string, SaleLine[]>();
      const originalQuantities = new Map<string, number>();
      const grossByProduct = new Map<string, number>();
      lines.forEach((line) => {
        const list = lineByProduct.get(line.productId) || [];
        list.push(line);
        lineByProduct.set(line.productId, list);
        originalQuantities.set(line.productId, (originalQuantities.get(line.productId) || 0) + line.quantity);
        grossByProduct.set(line.productId, (grossByProduct.get(line.productId) || 0) + line.unitPrice * line.quantity);
      });
      const returnedProductQuantities = asRecord(salePayload.returnedProductQuantities) || {};
      const returnedBatchQuantities = asRecord(salePayload.returnedBatchQuantities) || {};
      inputLines.forEach((line, index) => {
        if (!lineByProduct.has(line.productId)) invalid(`Return Item ${index + 1}: Sale ထဲမှာ မပါဝင်သော Product ဖြစ်ပါတယ်။`);
        const already = num(returnedProductQuantities[line.productId]) || 0;
        if (already + line.quantity > (originalQuantities.get(line.productId) || 0) + EPSILON) {
          failed(`Return ပမာဏသည် မူလရောင်းချပမာဏထက် ကျော်နေပါတယ်: ${line.productId}`);
        }
      });

      const productIds = inputLines.map((line) => line.productId);
      const productRefs = productIds.map((id) => branchRef.collection('products').doc(id));
      const productSnapshots = await Promise.all(productRefs.map((ref) => transaction.get(ref)));
      const productPayloads = new Map<string, Dict>();
      const trackedProducts = new Set<string>();
      productIds.forEach((productId, index) => {
        const snapshot = productSnapshots[index];
        const payload = payloadOf(snapshot, ['kind', 'products']);
        if (!payload || snapshot.data()?.deleted === true) failed(`Cloud Product မတွေ့ပါ: ${productId}`);
        if (str(payload.branchId || branchId) !== branchId) failed(`Cloud Product Branch မကိုက်ညီပါ: ${productId}`);
        productPayloads.set(productId, payload);
        if (payload.tracksIndividualUnits === true || lineByProduct.get(productId)!.some((line) => line.selections.length > 0)) {
          trackedProducts.add(productId);
        }
      });
      inputLines.forEach((line) => {
        if (trackedProducts.has(line.productId) && !line.units.length) failed(`Sticker Unit အားလုံး မပါဝင်ပါ: ${line.productId}`);
        if (!trackedProducts.has(line.productId) && line.units.length) failed(`Unit Tracking မဖွင့်ထားသော Product တွင် Sticker Unit မပါရပါ: ${line.productId}`);
        if (trackedProducts.has(line.productId) && (!Number.isInteger(line.quantity) || line.units.length !== line.quantity)) {
          failed(`Sticker Unit စာရင်းနှင့် Return ပမာဏ မကိုက်ညီပါ: ${line.productId}`);
        }
      });

      const allUnits = inputLines.flatMap((line) => line.units.map((unit) => ({ ...unit, productId: line.productId })));
      const registryRefsById = new Map<string, DocumentReference<DocumentData>>();
      allUnits.forEach((unit) => {
        if (!registryRefsById.has(unit.registryId)) {
          registryRefsById.set(unit.registryId, branchRef.collection('stockUnitRegistries').doc(unit.registryId));
        }
      });
      const registryIds = [...registryRefsById.keys()];
      const registryRefs = registryIds.map((id) => registryRefsById.get(id)!);
      const registrySnapshots = await Promise.all(registryRefs.map((ref) => transaction.get(ref)));
      const registryPayloads = new Map<string, Dict>();
      registryIds.forEach((registryId, index) => {
        const snapshot = registrySnapshots[index];
        const payload = payloadOf(snapshot, ['kind', 'stockUnitRegistries']);
        if (!payload || snapshot.data()?.deleted === true) failed(`Cloud Sticker Registry မတွေ့ပါ: ${registryId}`);
        registryPayloads.set(registryId, payload);
      });

      const unitDetails = new Map<string, { productId: string; batchId: string; barcode: string; disposition: Disposition }>();
      const saleUnitKeysByProduct = new Map<string, Set<string>>();
      lineByProduct.forEach((saleLinesForProduct, productId) => {
        saleUnitKeysByProduct.set(productId, new Set(
          saleLinesForProduct.flatMap((line) => line.selections.map((selection) => `${selection.registryId}::${selection.unitId}`)),
        ));
      });
      allUnits.forEach((selection) => {
        const payload = registryPayloads.get(selection.registryId)!;
        if (payload.productId !== selection.productId) failed(`Sticker Registry Product မကိုက်ညီပါ: ${selection.registryId}`);
        const matches = asRecordList(payload.units).filter((unit) => str(unit.id) === selection.unitId);
        if (matches.length !== 1) failed(`Sticker Unit ကို Registry မှာ တစ်ခုတည်း မတွေ့ပါ: ${selection.unitId}`);
        const unit = matches[0];
        if (str(unit.status) !== 'sold' || str(unit.saleId) !== saleId) {
          failed(`Return ပြန်လုပ်နိုင်သော Sticker Unit မဟုတ်ပါ: ${str(unit.barcode || selection.unitId)}`);
        }
        const unitKey = `${selection.registryId}::${selection.unitId}`;
        if (!saleUnitKeysByProduct.get(selection.productId)?.has(unitKey)) {
          failed(`မူလ Sale တွင် မပါဝင်သော Sticker Unit ကို Return မလုပ်နိုင်ပါ: ${selection.unitId}`);
        }
        if (unitDetails.has(unitKey)) failed('Sticker Unit တစ်ခုတည်းကို Return စာရင်းထဲ နှစ်ကြိမ် မထည့်ပါနဲ့။');
        unitDetails.set(unitKey, {
          productId: selection.productId, batchId: str(unit.batchId),
          barcode: str(unit.barcode), disposition: selection.disposition,
        });
      });

      const batchDeltas = new Map<string, { productId: string; restock: number; consumed: number }>();
      inputLines.forEach((line) => {
        if (trackedProducts.has(line.productId)) {
          line.units.forEach((unit) => {
            const detail = unitDetails.get(`${unit.registryId}::${unit.unitId}`)!;
            if (!detail.batchId) return;
            const entry = batchDeltas.get(detail.batchId) || { productId: line.productId, restock: 0, consumed: 0 };
            if (entry.productId !== line.productId) failed('Stock Batch Product မကိုက်ညီပါ။');
            entry.consumed += 1;
            if (detail.disposition === 'restock') entry.restock += 1;
            batchDeltas.set(detail.batchId, entry);
          });
          return;
        }
        let remaining = line.quantity;
        for (const allocation of lineByProduct.get(line.productId)!.flatMap((entry) => entry.batchAllocations)) {
          if (remaining <= EPSILON) break;
          const priorConsumed = num(returnedBatchQuantities[allocation.batchId]) || 0;
          const available = allocation.quantity - priorConsumed;
          if (available <= EPSILON) continue;
          const take = Math.min(available, remaining);
          const entry = batchDeltas.get(allocation.batchId) || { productId: line.productId, restock: 0, consumed: 0 };
          if (entry.productId !== line.productId) failed('Stock Batch Product မကိုက်ညီပါ။');
          entry.consumed += take;
          if (line.disposition === 'restock') entry.restock += take;
          batchDeltas.set(allocation.batchId, entry);
          remaining -= take;
        }
        if (remaining > EPSILON) {
          failed(`Return ပမာဏသည် မူလ Batch ခွဲဝေမှုထက် ကျော်နေပါတယ်: ${line.productId}။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
        }
      });

      const batchIds = [...batchDeltas.keys()];
      const batchRefs = batchIds.map((id) => branchRef.collection('stockBatches').doc(id));
      const batchSnapshots = await Promise.all(batchRefs.map((ref) => transaction.get(ref)));

      const productWrites: Array<{ ref: DocumentReference<DocumentData>; payload: Dict }> = [];
      inputLines.forEach((line, index) => {
        const payload = productPayloads.get(line.productId)!;
        const currentStock = num(payload.stock);
        if (!Number.isFinite(currentStock) || currentStock < 0) failed(`Cloud Product Stock မမှန်ပါ: ${line.productId}`);
        const restockQuantity = trackedProducts.has(line.productId)
          ? line.units.filter((unit) => unitDetails.get(`${unit.registryId}::${unit.unitId}`)?.disposition === 'restock').length
          : line.disposition === 'restock' ? line.quantity : 0;
        productWrites.push({
          ref: productRefs[index],
          payload: { ...payload, stock: cleanQuantity(currentStock + restockQuantity, str(payload.quantityMode || 'whole') !== 'decimal') },
        });
      });

      const batchWrites: Array<{ ref: DocumentReference<DocumentData>; payload: Dict }> = [];
      batchIds.forEach((batchId, index) => {
        const expected = batchDeltas.get(batchId)!;
        const snapshot = batchSnapshots[index];
        const record = snapshot.data() || {};
        const payload = payloadOf(snapshot, ['kind', 'stockBatches']);
        if (!payload || record.deleted === true || record.branchId !== branchId || payload.productId !== expected.productId) {
          failed(`Cloud Stock Batch မတွေ့ပါ / Data မကိုက်ညီပါ: ${batchId}`);
        }
        const currentQuantity = num(payload.quantity);
        if (!Number.isFinite(currentQuantity) || currentQuantity < 0) failed(`Cloud Batch Quantity မမှန်ပါ: ${batchId}`);
        batchWrites.push({
          ref: batchRefs[index],
          payload: {
            ...payload,
            quantity: cleanQuantity(currentQuantity + expected.restock,
              str(productPayloads.get(expected.productId)?.quantityMode || 'whole') !== 'decimal'),
          },
        });
      });

      const registryWrites: Array<{ ref: DocumentReference<DocumentData>; payload: Dict }> = [];
      registryIds.forEach((registryId, index) => {
        const payload = registryPayloads.get(registryId)!;
        let changed = 0;
        const nextUnits = asRecordList(payload.units).map((unit) => {
          const detail = unitDetails.get(`${registryId}::${str(unit.id)}`);
          if (!detail) return unit;
          changed += 1;
          const { saleId: _saleId, soldAt: _soldAt, soldByUid: _soldByUid, ...priorUnit } = unit;
          if (detail.disposition === 'damaged') {
            return {
              ...priorUnit, status: 'damaged', lastSaleId: saleId, returnId: requestId,
              damagedAt: now, damagedByUid: uid, damageReason: reason,
            };
          }
          return {
            ...priorUnit, status: 'in_stock', lastSaleId: saleId, returnId: requestId,
            returnedAt: now, returnedByUid: uid,
          };
        });
        const expectedCount = allUnits.filter((unit) => unit.registryId === registryId).length;
        if (changed !== expectedCount) failed(`Return Sticker Unit အရေအတွက် မကိုက်ညီပါ: ${registryId}`);
        registryWrites.push({
          ref: registryRefs[index],
          payload: branchRecord(registryRefs[index], 'stockUnitRegistries', branchId, uid, now,
            { ...payload, units: nextUnits, updatedAt: now, updatedByUid: uid }),
        });
      });

      const saleSubtotal = num(salePayload.subtotal);
      const saleTotal = num(salePayload.total);
      if (!Number.isFinite(saleSubtotal) || !Number.isFinite(saleTotal) || saleSubtotal < 0 || saleTotal < 0) failed('Sale Total မမှန်ပါ။');
      const ratio = saleSubtotal > EPSILON ? Math.min(1, saleTotal / saleSubtotal) : 1;
      let returnedValue = 0;
      inputLines.forEach((line) => {
        const originalQuantity = originalQuantities.get(line.productId) || 0;
        const averageUnitPrice = originalQuantity > 0 ? (grossByProduct.get(line.productId) || 0) / originalQuantity : 0;
        returnedValue += averageUnitPrice * line.quantity * ratio;
      });
      returnedValue = moneyRound(returnedValue);

      const paymentMethod = str(salePayload.paymentMethod);
      const paidAmount = Number.isFinite(num(salePayload.paidAmount)) ? num(salePayload.paidAmount) : 0;
      const currentDue = Number.isFinite(num(salePayload.dueAmount)) ? num(salePayload.dueAmount) : 0;
      let dueReduction = 0;
      let refundStatus = 'none';
      let refundAmount = 0;
      if (paymentMethod === 'Credit') {
        dueReduction = moneyRound(Math.min(currentDue, returnedValue));
        refundAmount = moneyRound(Math.max(0, returnedValue - dueReduction));
        refundStatus = refundAmount > EPSILON ? 'credit-refund-review' : 'credit-adjusted';
      } else {
        const refund = refundOutcome(paymentMethod, paidAmount, saleTotal, returnedValue);
        refundStatus = refund.status;
        refundAmount = refund.amount;
      }

      const previousReturned = new Map<string, number>(
        Object.entries(returnedProductQuantities).map(([key, value]) => [key, Number(value) || 0]),
      );
      const previousBatchReturned = new Map<string, number>(
        Object.entries(returnedBatchQuantities).map(([key, value]) => [key, Number(value) || 0]),
      );
      const nextProductReturned: Record<string, number> = Object.fromEntries(previousReturned);
      const nextBatchReturned: Record<string, number> = Object.fromEntries(previousBatchReturned);
      inputLines.forEach((line) => {
        nextProductReturned[line.productId] = cleanQuantity((nextProductReturned[line.productId] || 0) + line.quantity, false);
      });
      batchDeltas.forEach((entry, batchId) => {
        nextBatchReturned[batchId] = cleanQuantity((nextBatchReturned[batchId] || 0) + entry.consumed, false);
      });

      const returnItemRecords = inputLines.map((line) => ({
        productId: line.productId,
        name: str(productPayloads.get(line.productId)?.name) || line.productId,
        quantity: line.quantity,
        disposition: line.disposition,
        units: line.units.map((unit) => {
          const detail = unitDetails.get(`${unit.registryId}::${unit.unitId}`)!;
          return {
            registryId: unit.registryId, unitId: unit.unitId, barcode: detail.barcode,
            ...(detail.batchId ? { batchId: detail.batchId } : {}), disposition: detail.disposition,
          };
        }),
      }));
      const previousReturns = asRecordList(salePayload.returns);
      const nextReturns = [...previousReturns, {
        id: requestId, at: now, actorUid: uid, actorName, reason, deviceId,
        value: returnedValue, refundStatus, refundAmount,
        items: inputLines.map((line) => ({
          productId: line.productId, quantity: line.quantity,
          units: line.units.map((unit) => `${unit.registryId}::${unit.unitId}`),
        })),
      }].slice(-50);
      const nextPayload = {
        ...salePayload,
        dueAmount: moneyRound(Math.max(0, currentDue - dueReduction)),
        returnedProductQuantities: nextProductReturned,
        returnedBatchQuantities: nextBatchReturned,
        returns: nextReturns,
        returnCount: (num(salePayload.returnCount) || previousReturns.length) + 1,
        returnedTotal: moneyRound((num(salePayload.returnedTotal) || 0) + returnedValue),
        lastReturnId: requestId, lastReturnReason: reason,
        lastReturnedAt: now, lastReturnedByUid: uid, lastReturnedByName: actorName,
        lastAdjustmentKind: 'return', lastAdjustedAt: now, lastAdjustedByUid: uid,
      };
      const responseItems = inputLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        disposition: line.disposition,
        batchAllocations: [...batchDeltas.entries()]
          .filter(([, entry]) => entry.productId === line.productId && entry.restock > 0)
          .map(([batchId, entry]) => ({ batchId, quantity: entry.restock })),
        units: line.units.map((unit) => ({
          registryId: unit.registryId, unitId: unit.unitId,
          disposition: unitDetails.get(`${unit.registryId}::${unit.unitId}`)!.disposition,
        })),
      }));
      const returnRecord = {
        id: requestId, eventType: 'SALE_RETURN', kind: 'saleReturns', branchId,
        saleId, receiptNo: str(salePayload.receiptNo),
        actorUid: uid, actorEmail: authEmail, actorName,
        occurredAt: now, reason, deviceId, items: returnItemRecords, responseItems, value: returnedValue,
        dueAmount: nextPayload.dueAmount,
        returnedProductQuantities: nextProductReturned,
        returnedBatchQuantities: nextBatchReturned,
        refund: {
          method: paymentMethod, amount: refundAmount, status: refundStatus,
          ...(refundReference ? { reference: refundReference } : {}),
        },
        dueReduction, fingerprint,
        saleSnapshot: {
          status: salePayload.status, total: saleTotal, paidAmount,
          dueAmount: currentDue, paymentMethod,
        },
      };
      const audit = {
        id: `${saleId}__return__${requestId}`, eventType: 'SALE_RETURNED',
        branchId, saleId, receiptNo: str(salePayload.receiptNo),
        actorUid: uid, actorEmail: authEmail, actorName,
        occurredAt: now, total: returnedValue, reason, deviceId, requestId,
        refundStatus, refundAmount, dueReduction,
      };
      const writeCount = 1 + productWrites.length + batchWrites.length + registryWrites.length + 2;
      if (writeCount > MAX_WRITES) throw new HttpsError('resource-exhausted', 'ဒီ Return ကို တစ်ကြိမ်တည်း လုပ်ရန် များလွန်နေပါတယ်။ အပိုင်းခွဲပြီး လုပ်ပါ။');

      transaction.set(saleRef, branchRecord(saleRef, 'sales', branchId, uid, now, nextPayload));
      productWrites.forEach((write) => transaction.set(write.ref, branchRecord(write.ref, 'products', branchId, uid, now, write.payload)));
      batchWrites.forEach((write) => transaction.set(write.ref, branchRecord(write.ref, 'stockBatches', branchId, uid, now, write.payload)));
      registryWrites.forEach((write) => transaction.set(write.ref, write.payload));
      transaction.set(returnRef, returnRecord);
      transaction.set(auditRef, audit);
      return {
        result: 'created', kind: 'return', returnId: requestId, occurredAt: now,
        value: returnedValue, refundStatus, refundAmount, dueReduction,
        dueAmount: nextPayload.dueAmount, returnedTotal: nextPayload.returnedTotal,
        returnedProductQuantities: nextProductReturned,
        returnedBatchQuantities: nextBatchReturned,
        items: responseItems,
        writeCount,
      };
    });
  },
);
