import { getFirestore, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const BUSINESS_ID = 'store-mini-main';
const FUNCTION_REGION = 'asia-southeast1';
const EPSILON = 0.000001;
const MAX_ITEMS = 200;
const MAX_UNIT_SELECTIONS = 200;
const MAX_WRITES = 450;
const MAX_KPAY_REFERENCE_LENGTH = 120;
const MAX_FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000;
const DOC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const CUSTOMER_ID_PATTERN = DOC_ID_PATTERN;
const KPAY_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Dict = Record<string, unknown>;
type UnitSelection = { registryId: string; unitId: string; barcode: string; batchId?: string };
type Allocation = { batchId: string; quantity: number };

function asRecord(value: unknown): Dict | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Dict : null;
}

function asArray(value: unknown, label: string): Dict[] {
  if (!Array.isArray(value)) throw new HttpsError('invalid-argument', `${label} must be a list.`);
  return value.map((item, index) => {
    const record = asRecord(item);
    if (!record) throw new HttpsError('invalid-argument', `${label}[${index}] is invalid.`);
    return record;
  });
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : Number.NaN;
}

function near(a: unknown, b: unknown): boolean {
  const left = num(a);
  const right = num(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= EPSILON;
}

function normalizedCode(value: unknown): string {
  return str(value).trim().replace(/\s+/g, '').toUpperCase();
}

function cleanQuantity(value: number, whole: boolean): number {
  return whole && Math.abs(value - Math.round(value)) < 1e-8 ? Math.round(value) : Math.round(value * 1000) / 1000;
}

/** Branch-local business day; never derived from the client-supplied Sale date. */
function branchDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function limitedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function failed(message: string): never {
  throw new HttpsError('failed-precondition', message);
}

function invalid(message: string): never {
  throw new HttpsError('invalid-argument', message);
}

/** Must stay byte-identical to the client fingerprint in cashierSalesSync.ts. */
function saleFingerprint(sale: Dict): string {
  const items = asArray(sale.items, 'Sale items');
  const normalized = {
    id: sale.id, branchId: sale.branchId || '', receiptNo: sale.receiptNo, date: sale.date,
    customer: sale.customer, customerId: sale.customerId || '', paymentMethod: sale.paymentMethod,
    cashReceivedAmount: sale.cashReceivedAmount ?? null, kpayTransactionReference: sale.kpayTransactionReference || '',
    kpayAccountNameSnapshot: sale.kpayAccountNameSnapshot || '',
    kpayAccountNumberSnapshot: sale.kpayAccountNumberSnapshot || '',
    kpayAccountLabelSnapshot: sale.kpayAccountLabelSnapshot || '',
    kpayQrVersionSnapshot: sale.kpayQrVersionSnapshot ?? null,
    changeAmount: sale.changeAmount ?? null, paidAmount: sale.paidAmount ?? null, dueAmount: sale.dueAmount ?? null,
    subtotal: sale.subtotal, discount: sale.discount, total: sale.total, profit: sale.profit, status: sale.status,
    createdByUid: sale.createdByUid || '',
    items: items.map((item) => ({
      productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice, costPrice: item.costPrice,
      mode: item.mode, priceGroupId: item.priceGroupId || '', priceVersion: item.priceVersion ?? null,
      batchAllocations: asRecordList(item.batchAllocations).map((allocation) => ({ batchId: allocation.batchId, quantity: allocation.quantity })),
      stockUnitSelections: asRecordList(item.stockUnitSelections).map((selection) => ({ unitId: selection.unitId, barcode: selection.barcode, batchId: selection.batchId || '' })),
    })),
  };
  return JSON.stringify(normalized);
}

function asRecordList(value: unknown): Dict[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item): item is Dict => !!item);
}

function selectionsOf(item: Dict): UnitSelection[] {
  return asRecordList(item.stockUnitSelections).map((selection, index) => {
    const unitId = str(selection.unitId).trim();
    const registryId = str(selection.registryId).trim();
    const barcode = normalizedCode(selection.barcode);
    if (!unitId || !registryId || !DOC_ID_PATTERN.test(registryId) || !barcode || barcode.length > 128) {
      throw new HttpsError('invalid-argument', `Item ${index + 1}: Sticker Unit selection မမှန်ကန်ပါ။`);
    }
    return { registryId, unitId, barcode, ...(str(selection.batchId) ? { batchId: str(selection.batchId) } : {}) };
  });
}

function allocationsOf(item: Dict): Allocation[] {
  return asRecordList(item.batchAllocations).map((allocation) => {
    const batchId = str(allocation.batchId).trim();
    const quantity = num(allocation.quantity);
    if (!batchId || !Number.isFinite(quantity) || quantity <= 0 || !DOC_ID_PATTERN.test(batchId)) {
      throw new HttpsError('invalid-argument', 'Stock Batch ခွဲဝေမှု မမှန်ကန်ပါ။');
    }
    return { batchId, quantity };
  });
}

function assertSaleShape(sale: Dict, uid: string, branchId: string, serverNow: Date): void {
  if (str(sale.createdByUid) !== uid) throw new HttpsError('permission-denied', 'Sale UID မကိုက်ညီပါ။');
  if (str(sale.branchId) !== branchId) throw new HttpsError('permission-denied', 'Sale Branch မကိုက်ညီပါ။');
  const saleId = str(sale.id).trim();
  if (!saleId || !DOC_ID_PATTERN.test(saleId)) throw new HttpsError('invalid-argument', 'Sale ID မမှန်ကန်ပါ။');
  if (!str(sale.receiptNo).trim()) throw new HttpsError('invalid-argument', 'Receipt No မပါဝင်ပါ။');
  if (str(sale.customer).length > 120) throw new HttpsError('invalid-argument', 'Customer အမည် ရှည်လွန်းပါတယ်။');
  if (sale.status !== 'completed') throw new HttpsError('invalid-argument', 'Completed Sale မဟုတ်ပါ။');
  const date = new Date(str(sale.date));
  if (!Number.isFinite(date.getTime())) throw new HttpsError('invalid-argument', 'Sale Date မမှန်ကန်ပါ။');
  if (date.getTime() - serverNow.getTime() > MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new HttpsError('invalid-argument', 'Sale Date သည် Server အချိန်ထက် များလွန်းနေပါတယ်။');
  }
  const customerId = str(sale.customerId).trim();
  if (customerId && (!CUSTOMER_ID_PATTERN.test(customerId) || customerId !== str(sale.customerId))) {
    throw new HttpsError('invalid-argument', 'Customer ID မမှန်ကန်ပါ။');
  }
  if (str(sale.paymentMethod) === 'Credit' && !customerId) {
    throw new HttpsError('invalid-argument', 'Credit Sale တွင် Customer ID မပါဝင်ပါ။');
  }
  const items = asArray(sale.items, 'Sale items');
  if (items.length === 0 || items.length > MAX_ITEMS) throw new HttpsError('invalid-argument', 'Sale items အရေအတွက် မမှန်ကန်ပါ။');

  const subtotal = num(sale.subtotal);
  const discount = num(sale.discount);
  const total = num(sale.total);
  const paid = num(sale.paidAmount);
  const due = num(sale.dueAmount);
  if (![subtotal, discount, total, paid, due].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new HttpsError('invalid-argument', 'Sale ငွေပမာဏ မမှန်ကန်ပါ။');
  }
  if (!near(total, subtotal - discount)) throw new HttpsError('invalid-argument', 'Sale Total မကိုက်ညီပါ။');
  const method = str(sale.paymentMethod);
  if (!['Cash', 'KPay', 'Credit'].includes(method)) throw new HttpsError('invalid-argument', 'Payment Method မမှန်ကန်ပါ။');
  if (method === 'Credit') {
    if (!near(paid + due, total)) throw new HttpsError('invalid-argument', 'Credit ငွေရှင်းမှု မကိုက်ညီပါ။');
  } else if (!near(paid, total) || !near(due, 0)) {
    throw new HttpsError('invalid-argument', 'ငွေရှင်းမှု မကိုက်ညီပါ။');
  }
  if (sale.cashReceivedAmount !== undefined && (!Number.isFinite(num(sale.cashReceivedAmount)) || num(sale.cashReceivedAmount) < total)) {
    throw new HttpsError('invalid-argument', 'Cash Received မလုံလောက်ပါ။');
  }
  if (sale.changeAmount !== undefined && (!Number.isFinite(num(sale.changeAmount)) || num(sale.changeAmount) < 0)) {
    throw new HttpsError('invalid-argument', 'Change Amount မမှန်ကန်ပါ။');
  }
  if (method === 'KPay') {
    const reference = str(sale.kpayTransactionReference).trim();
    const alphanumeric = reference.match(/[A-Za-z0-9]/g) ?? [];
    if (!reference || reference.length > MAX_KPAY_REFERENCE_LENGTH
      || !KPAY_REFERENCE_PATTERN.test(reference) || alphanumeric.length < 4 || !/\d/.test(reference)) {
      throw new HttpsError('invalid-argument', 'KPay Transaction ID မမှန်ကန်ပါ။');
    }
  }
  for (const key of ['kpayAccountNameSnapshot', 'kpayAccountNumberSnapshot', 'kpayAccountLabelSnapshot']) {
    if (sale[key] !== undefined && str(sale[key]).length > 120) throw new HttpsError('invalid-argument', `${key} ရှည်လွန်းပါတယ်။`);
  }
}

/**
 * Server-authoritative Cashier sale for Individual Unit Barcode products.
 * Cashier Firestore Rules deliberately grant no stockUnitRegistries write path,
 * so the Admin SDK validates the exact scanned units and commits the Sale,
 * Product stock, Batch stock, unit statuses and audit record in one transaction.
 * Retries are fingerprint-idempotent; a concurrent second sale of the same unit
 * fails closed to Owner review.
 */
export const completeCashierUnitSale = onCall(
  { region: FUNCTION_REGION, timeoutSeconds: 60, memory: '512MiB', maxInstances: 10 },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Cashier Login လိုအပ်ပါတယ်။');
    const uid = auth.uid;
    const body = asRecord(request.data);
    if (!body) throw new HttpsError('invalid-argument', 'Request မမှန်ကန်ပါ။');
    if (str(body.uid) !== uid) throw new HttpsError('permission-denied', 'Request UID မကိုက်ညီပါ။');
    const branchId = str(body.branchId).trim();
    const sale = asRecord(body.sale);
    if (!branchId || !sale) throw new HttpsError('invalid-argument', 'Branch / Sale မပြည့်စုံပါ။');
    const serverNow = new Date();
    assertSaleShape(sale, uid, branchId, serverNow);

    const items = asArray(sale.items, 'Sale items');
    const selectionsByItem = items.map(selectionsOf);
    if (selectionsByItem.reduce((sum, value) => sum + value.length, 0) > MAX_UNIT_SELECTIONS) {
      throw new HttpsError('resource-exhausted', 'Sticker Unit အရေအတွက် များလွန်းပါတယ်။ အပိုင်းခွဲပြီး ရောင်းပါ။');
    }

    const productDeltas = new Map<string, number>();
    const batchDeltas = new Map<string, number>();
    const batchProductIds = new Map<string, string>();
    const productsWithoutAllocations = new Set<string>();
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const productId = str(item.productId).trim();
      const quantity = num(item.quantity);
      if (!productId || !DOC_ID_PATTERN.test(productId) || !Number.isFinite(quantity) || quantity <= 0) {
        throw new HttpsError('invalid-argument', `Item ${index + 1}: Product / Quantity မမှန်ကန်ပါ။`);
      }
      const selections = selectionsByItem[index];
      if (selections.length > 0 && (!Number.isInteger(quantity) || selections.length !== quantity)) {
        throw new HttpsError('invalid-argument', `Item ${index + 1}: Sticker Unit စာရင်းနှင့် ပမာဏ မကိုက်ညီပါ။`);
      }
      productDeltas.set(productId, (productDeltas.get(productId) || 0) + quantity);
      const allocations = allocationsOf(item);
      if (!allocations.length) {
        // Legacy stock may predate Batch tracking; it is verified later that the
        // Product truly has no Batch remaining before a Product-only deduction.
        productsWithoutAllocations.add(productId);
        continue;
      }
      const allocated = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
      if (!near(allocated, quantity)) {
        throw new HttpsError('invalid-argument', `Item ${index + 1}: Stock Batch ခွဲဝေမှု မပြည့်စုံပါ။`);
      }
      for (const allocation of allocations) {
        batchDeltas.set(allocation.batchId, (batchDeltas.get(allocation.batchId) || 0) + allocation.quantity);
        const previous = batchProductIds.get(allocation.batchId);
        if (previous && previous !== productId) throw new HttpsError('invalid-argument', 'Stock Batch တစ်ခုကို Product မတူဘဲ အသုံးပြုထားပါတယ်။');
        batchProductIds.set(allocation.batchId, productId);
      }
    }
    if (!productDeltas.size) throw new HttpsError('invalid-argument', 'ရောင်းချမည့် Product မရှိပါ။');

    const db = getFirestore();
    const businessRef = db.collection('businesses').doc(BUSINESS_ID);
    const memberRef = businessRef.collection('members').doc(uid);
    const branchRef = businessRef.collection('branches').doc(branchId);
    const saleRef = branchRef.collection('sales').doc(str(sale.id));
    const auditRef = branchRef.collection('auditEvents').doc(`${str(sale.id)}__created`);
    const authEmail = str(auth.token.email).trim().toLowerCase();
    const actorName = str(auth.token.name) || authEmail || 'Cashier';
    const serverDay = branchDay(serverNow);
    const now = serverNow.toISOString();
    const fingerprint = saleFingerprint(sale);

    return db.runTransaction(async (transaction) => {
      let reads = 0;
      const metaRef = businessRef.collection('meta').doc('settings');
      const [businessSnapshot, memberSnapshot, branchSnapshot, saleSnapshot, auditSnapshot, metaSnapshot] = await Promise.all([
        transaction.get(businessRef), transaction.get(memberRef), transaction.get(branchRef),
        transaction.get(saleRef), transaction.get(auditRef), transaction.get(metaRef),
      ]);
      reads += 6;
      // Exactly-once acknowledgement must survive a later membership, Branch or
      // KPay-account change: a matching committed fingerprint returns immediately.
      if (saleSnapshot.exists) {
        const existing = asRecord(saleSnapshot.data()?.payload) || {};
        if (existing.saleFingerprint === fingerprint && existing.createdByUid === uid && existing.branchId === branchId) {
          return { result: 'already-committed', readCount: reads, writeCount: 0 };
        }
        failed('Voucher ID တူနေသော်လည်း Cloud Sale အချက်အလက် မတူပါ။ Owner စစ်ဆေးရန် ရပ်ထားပါတယ်။');
      }
      if (auditSnapshot.exists) failed('ဒီ Voucher အတွက် Audit Record ရှိပြီး Sale မတွေ့ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
      if (!businessSnapshot.exists || businessSnapshot.data()?.active === false) {
        throw new HttpsError('failed-precondition', 'Minimart Business မရရှိနိုင်ပါ။');
      }
      if (!memberSnapshot.exists) throw new HttpsError('permission-denied', 'Cashier Membership မတွေ့ပါ။');
      const member = memberSnapshot.data() || {};
      const branchIds = Array.isArray(member.branchIds) ? member.branchIds : [];
      if (member.uid !== uid || member.role !== 'cashier' || member.status !== 'active'
        || str(member.email).trim().toLowerCase() !== authEmail || !authEmail
        || branchIds.length !== 1 || branchIds[0] !== branchId) {
        throw new HttpsError('permission-denied', 'ဒီ Branch အတွက် Active Cashier ခွင့်မရှိပါ။');
      }
      if (!branchSnapshot.exists) throw new HttpsError('failed-precondition', 'Branch မတွေ့ပါ။');
      const branchPayload = asRecord(branchSnapshot.data()?.payload) || {};
      if (branchPayload.status !== 'active') throw new HttpsError('permission-denied', 'Branch သည် Active မဟုတ်ပါ။');
      if (str(sale.paymentMethod) === 'KPay') {
        const settings = asRecord(branchPayload.settings) || {};
        if (!str(settings.kpayAccountName).trim() || !str(settings.kpayAccountNumber).trim()) {
          throw new HttpsError('failed-precondition', 'ဒီ Branch တွင် KPay Account မသတ်မှတ်ရသေးပါ။');
        }
      }
      const metaPayload = asRecord(metaSnapshot.data()?.payload);
      const businessSettings = asRecord(metaPayload?.settings) || metaPayload || {};
      const configuredDiscount = Number(businessSettings.maxCashierDiscountPercent ?? 10);
      const maxDiscountPercent = Number.isFinite(configuredDiscount)
        ? Math.max(0, Math.min(100, configuredDiscount))
        : 10;

      const productIds = [...productDeltas.keys()];
      const batchIds = [...batchDeltas.keys()];
      const productRefs = productIds.map((id) => branchRef.collection('products').doc(id));
      const batchRefs = batchIds.map((id) => branchRef.collection('stockBatches').doc(id));
      const productSnapshots = await Promise.all(productRefs.map((ref) => transaction.get(ref)));
      const batchSnapshots = await Promise.all(batchRefs.map((ref) => transaction.get(ref)));
      reads += productSnapshots.length + batchSnapshots.length;

      const productPayloads = new Map<string, Dict>();
      const groupProductIds = new Map<string, string>();
      const productWrites: Array<{ ref: DocumentReference<DocumentData>; payload: Dict }> = [];
      for (let index = 0; index < productIds.length; index += 1) {
        const productId = productIds[index];
        const snapshot = productSnapshots[index];
        if (!snapshot.exists || snapshot.data()?.deleted === true) failed(`Cloud Product မတွေ့ပါ: ${productId}`);
        const payload = asRecord(snapshot.data()?.payload);
        if (!payload || str(payload.branchId || branchId) !== branchId) failed(`Cloud Product Branch မကိုက်ညီပါ: ${productId}`);
        productPayloads.set(productId, payload);
        const quantity = productDeltas.get(productId) || 0;
        const currentStock = num(payload.stock);
        if (!Number.isFinite(currentStock) || currentStock + EPSILON < quantity) {
          failed(`Cloud Stock မလုံလောက်ပါ: ${str(payload.name || productId)} · Cloud ${currentStock} / ရောင်းရန် ${quantity}`);
        }
        const priceGroupId = str(payload.priceGroupId).trim();
        if (priceGroupId) {
          if (priceGroupId.includes('/') || priceGroupId.length > 200) failed(`Cloud Price Group ID မမှန်ပါ: ${productId}`);
          const previous = groupProductIds.get(priceGroupId);
          if (previous && previous !== productId) failed(`မျှဝေဈေးနှုန်း Group တစ်ခုကို Product နှစ်ခု ချိတ်ထားပါတယ်: ${priceGroupId}`);
          groupProductIds.set(priceGroupId, productId);
        }
        const nextStock = cleanQuantity(Math.max(0, currentStock - quantity), str(payload.quantityMode || 'whole') !== 'decimal');
        productWrites.push({ ref: productRefs[index], payload: { ...payload, stock: nextStock } });
      }

      // Shared price groups are the trusted source for linked selling prices.
      const groupIds = [...groupProductIds.keys()];
      const groupRefs = groupIds.map((id) => businessRef.collection('shared').doc('priceGroups').collection('records').doc(id));
      const groupSnapshots = await Promise.all(groupRefs.map((ref) => transaction.get(ref)));
      reads += groupSnapshots.length;
      const priceGroups = new Map<string, { retailPrice: number; wholesalePrice: number; version: number }>();
      for (let index = 0; index < groupIds.length; index += 1) {
        const groupId = groupIds[index];
        const snapshot = groupSnapshots[index];
        const record = snapshot.exists ? snapshot.data() || {} : {};
        const payload = asRecord(record.payload);
        if (!snapshot.exists || record.deleted === true || record.scope !== 'shared' || record.kind !== 'priceGroups'
          || !payload || str(payload.id) !== groupId || str(payload.status) !== 'active') {
          failed(`မျှဝေဈေးနှုန်း Group မရရှိနိုင်ပါ: ${groupId}။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
        }
        const members = asRecord(payload.membersByBranch) || {};
        if (str(members[branchId]) !== groupProductIds.get(groupId)) {
          failed(`မျှဝေဈေးနှုန်း Group သည် ဒီ Branch Product နှင့် မကိုက်ညီပါ: ${groupId}`);
        }
        const retailPrice = num(payload.retailPrice);
        const wholesalePrice = num(payload.wholesalePrice);
        const version = num(payload.version);
        if (!Number.isFinite(retailPrice) || retailPrice <= 0 || !Number.isFinite(wholesalePrice) || wholesalePrice < 0
          || !Number.isInteger(version) || version < 1) {
          failed(`မျှဝေဈေးနှုန်း Group Data မမှန်ပါ: ${groupId}`);
        }
        priceGroups.set(groupId, { retailPrice, wholesalePrice, version });
      }

      // Rebuild every financial figure from trusted Product / Price Group data.
      // The client receipt is only a request; its price, cost, profit, discount
      // and totals must all reconcile with this server-side calculation.
      let trustedSubtotal = 0;
      let trustedCost = 0;
      const trustedItems = items.map((item, index) => {
        const productId = str(item.productId);
        const productPayload = productPayloads.get(productId);
        if (!productPayload) failed(`Cloud Product မတွေ့ပါ: ${productId}`);
        const quantity = num(item.quantity);
        const mode = str(item.mode);
        if (!['retail', 'wholesale'].includes(mode)) invalid(`Item ${index + 1}: ဈေးနှုန်းအမျိုးအစား မမှန်ကန်ပါ။`);
        const groupId = str(productPayload.priceGroupId).trim();
        const lineGroupId = str(item.priceGroupId).trim();
        let trustedPrice: number;
        let trustedVersion: number | undefined;
        if (groupId) {
          const group = priceGroups.get(groupId);
          if (!group) failed(`မျှဝေဈေးနှုန်း Group မတွေ့ပါ: ${groupId}`);
          if (!near(productPayload.retailPrice, group.retailPrice)
            || !near(productPayload.wholesalePrice, group.wholesalePrice)
            || num(productPayload.priceVersion) !== group.version) {
            failed(`Product ဈေးနှုန်းသည် မျှဝေဈေးနှုန်း Group နှင့် မကိုက်ညီပါ: ${str(productPayload.name || productId)}`);
          }
          if (lineGroupId !== groupId || num(item.priceVersion) !== group.version) {
            failed(`မျှဝေဈေးနှုန်း ပြောင်းလဲသွားပါပြီ: ${str(productPayload.name || productId)}။ Offline Sale ကို Owner စစ်ဆေးရန်လိုပါတယ်။`);
          }
          trustedPrice = mode === 'wholesale' ? group.wholesalePrice : group.retailPrice;
          trustedVersion = group.version;
        } else {
          if (lineGroupId || item.priceVersion !== undefined) {
            failed(`မျှဝေဈေးနှုန်း Snapshot မမှန်ပါ: ${str(productPayload.name || productId)}`);
          }
          const candidate = mode === 'wholesale' ? num(productPayload.wholesalePrice) : num(productPayload.retailPrice);
          if (!Number.isFinite(candidate) || candidate <= 0) failed(`Cloud ဈေးနှုန်း မသတ်မှတ်ထားပါ: ${str(productPayload.name || productId)}`);
          trustedPrice = candidate;
        }
        if (!Number.isFinite(trustedPrice) || trustedPrice <= 0 || !near(item.unitPrice, trustedPrice)) {
          failed(`ဈေးနှုန်း မကိုက်ညီပါ: ${str(productPayload.name || productId)}။ Offline Sale ကို Owner စစ်ဆေးရန်လိုပါတယ်။`);
        }
        const productCost = num(productPayload.costPrice);
        if (!Number.isFinite(productCost) || productCost < 0) failed(`Cloud ကုန်ကျစရိတ် မမှန်ပါ: ${str(productPayload.name || productId)}`);
        if (!near(item.costPrice, productCost)) {
          failed(`ကုန်ကျစရိတ် မကိုက်ညီပါ: ${str(productPayload.name || productId)}။ Offline Sale ကို Owner စစ်ဆေးရန်လိုပါတယ်။`);
        }
        trustedSubtotal += trustedPrice * quantity;
        trustedCost += productCost * quantity;
        return {
          ...item,
          unitPrice: trustedPrice,
          costPrice: productCost,
          mode,
          ...(groupId ? { priceGroupId: groupId, priceVersion: trustedVersion } : {}),
        };
      });

      const trustedDiscount = num(sale.discount);
      const maxDiscount = Math.floor(trustedSubtotal * (maxDiscountPercent / 100));
      if (!Number.isFinite(trustedDiscount) || trustedDiscount < 0 || trustedDiscount > maxDiscount + EPSILON) {
        invalid(`Cashier Discount သည် သတ်မှတ်ထားသော ${maxDiscountPercent}% (${maxDiscount}) ထက် မကျော်ရပါ။`);
      }
      const trustedTotal = trustedSubtotal - trustedDiscount;
      if (!near(sale.subtotal, trustedSubtotal)) invalid('Sale Subtotal သည် Server တွက်ချက်မှုနှင့် မကိုက်ညီပါ။');
      if (!near(sale.total, trustedTotal)) invalid('Sale Total သည် Server တွက်ချက်မှုနှင့် မကိုက်ညီပါ။');
      const trustedProfit = trustedSubtotal - trustedCost - trustedDiscount;
      if (!near(sale.profit, trustedProfit)) invalid('Sale Profit သည် Server တွက်ချက်မှုနှင့် မကိုက်ညီပါ။');
      const trustedPaid = num(sale.paidAmount);
      const trustedDue = num(sale.dueAmount);
      if (str(sale.paymentMethod) === 'Credit') {
        if (!near(trustedPaid + trustedDue, trustedTotal)) invalid('Credit ငွေရှင်းမှုသည် Server Total နှင့် မကိုက်ညီပါ။');
      } else if (!near(trustedPaid, trustedTotal) || !near(trustedDue, 0)) {
        invalid('ငွေရှင်းမှုသည် Server Total နှင့် မကိုက်ညီပါ။');
      }
      if (sale.cashReceivedAmount !== undefined && num(sale.cashReceivedAmount) + EPSILON < trustedTotal) {
        invalid('Cash Received သည် Server Total ထက် မလုံလောက်ပါ။');
      }

      const batchWrites: Array<{ ref: DocumentReference<DocumentData>; payload: Dict }> = [];
      for (let index = 0; index < batchIds.length; index += 1) {
        const batchId = batchIds[index];
        const snapshot = batchSnapshots[index];
        const productId = batchProductIds.get(batchId)!;
        if (!snapshot.exists || snapshot.data()?.deleted === true) failed(`Cloud Stock Batch မတွေ့ပါ: ${batchId}။ Owner က Batch စာရင်းကို စစ်ဆေးပါ။`);
        const record = snapshot.data() || {};
        const payload = asRecord(record.payload);
        if (record.kind !== 'stockBatches' || record.branchId !== branchId || !payload || payload.productId !== productId) {
          failed(`Cloud Stock Batch Data မကိုက်ညီပါ: ${batchId}`);
        }
        const currentQuantity = num(payload.quantity);
        const deduction = batchDeltas.get(batchId) || 0;
        if (!Number.isFinite(currentQuantity) || currentQuantity + EPSILON < deduction) {
          failed(`Stock Batch လက်ကျန် မလုံလောက်ပါ: ${batchId}။ Offline Sale ကို Owner စစ်ဆေးရန်လိုပါတယ်။`);
        }
        const expiryDate = str(payload.expiryDate).trim();
        if (expiryDate) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) failed(`Stock Batch Expiry Date မမှန်ပါ: ${batchId}`);
          // Server's Branch-local day is authoritative; a backdated client Sale
          // must not make an expired Batch sellable.
          if (expiryDate < serverDay) {
            failed(`Server ရက်စွဲအရ Expiry ကျော်နေသော Batch ပါဝင်နေပါတယ်: ${batchId}။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
          }
        }
        batchWrites.push({ ref: batchRefs[index], payload: { ...payload, quantity: cleanQuantity(Math.max(0, currentQuantity - deduction), str(productPayloads.get(productId)?.quantityMode || 'whole') !== 'decimal') } });
      }

      // Unit selection validation. Registries are queried by Product so the client
      // cannot point the server at another branch/product chunk.
      const trackedProductIds = [...new Set(items
        .filter((item, index) => selectionsByItem[index].length > 0 || productPayloads.get(str(item.productId))?.tracksIndividualUnits === true)
        .map((item) => str(item.productId)))];
      const registryDocs: Array<{ id: string; payload: Dict; units: Dict[] }> = [];
      for (let index = 0; index < trackedProductIds.length; index += 30) {
        const chunk = trackedProductIds.slice(index, index + 30);
        const querySnapshot = await transaction.get(branchRef.collection('stockUnitRegistries').where('payload.productId', 'in', chunk));
        reads += querySnapshot.size;
        for (const doc of querySnapshot.docs) {
          const record = doc.data();
          if (record.deleted === true || record.branchId !== branchId) continue;
          const payload = asRecord(record.payload);
          if (!payload) continue;
          registryDocs.push({ id: doc.id, payload, units: asArray(payload.units, 'Registry units') });
        }
      }
      const unitsByProduct = new Map<string, Array<{ registryId: string; unit: Dict }>>();
      for (const registry of registryDocs) {
        const productId = str(registry.payload.productId);
        const list = unitsByProduct.get(productId) || [];
        registry.units.forEach((unit) => list.push({ registryId: registry.id, unit }));
        unitsByProduct.set(productId, list);
      }

      const seenUnitIds = new Set<string>();
      const soldUnits = new Map<string, { registryId: string; unitId: string; batchId?: string }[]>();
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const productId = str(item.productId);
        const quantity = num(item.quantity);
        const selections = selectionsByItem[index];
        const productTracked = productPayloads.get(productId)?.tracksIndividualUnits === true
          || (unitsByProduct.get(productId) || []).length > 0;
        if (productTracked) {
          if (!Number.isInteger(quantity) || selections.length !== quantity) {
            failed(`${str(productPayloads.get(productId)?.name || productId)}: Sticker Unit အားလုံး မပါဝင်ပါ။`);
          }
          if (str(productPayloads.get(productId)?.quantityMode || 'whole') !== 'whole') {
            failed(`${str(productPayloads.get(productId)?.name || productId)}: Unit Tracking Product သည် ပြည့်ကိန်းယူနစ် မဟုတ်ပါ။`);
          }
        } else if (selections.length > 0) {
          failed(`${str(productPayloads.get(productId)?.name || productId)}: Unit Tracking မဖွင့်ထားသော Product တွင် Sticker Unit မပါရပါ။`);
        }
        const unitCandidates = unitsByProduct.get(productId) || [];
        const allocatedByBatch = new Map<string, number>();
        for (const allocation of allocationsOf(item)) {
          allocatedByBatch.set(allocation.batchId, (allocatedByBatch.get(allocation.batchId) || 0) + allocation.quantity);
        }
        const selectedByBatch = new Map<string, number>();
        for (const selection of selections) {
          const matches = unitCandidates.filter((candidate) => str(candidate.unit.id) === selection.unitId);
          if (matches.length !== 1) {
            failed(`Sticker Unit ကို Cloud Registry မှာ တစ်ခုတည်း မတွေ့ပါ: ${selection.barcode}။ Owner က Registry ကို စစ်ဆေးပါ။`);
          }
          const match = matches[0];
          if (match.registryId !== selection.registryId) failed(`Sticker Unit Registry ပြောင်းလဲနေပါတယ်: ${selection.barcode}`);
          if (normalizedCode(match.unit.barcode) !== selection.barcode) failed(`Sticker Barcode မကိုက်ညီပါ: ${selection.barcode}`);
          if (str(match.unit.status) !== 'in_stock') {
            failed(`Sticker Unit ကို ရောင်းချနိုင်သော အခြေအနေမှာ မရှိတော့ပါ: ${selection.barcode} (${str(match.unit.status)})။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
          }
          if (str(match.unit.batchId) && selection.batchId && str(match.unit.batchId) !== selection.batchId) {
            failed(`Sticker Unit Batch မကိုက်ညီပါ: ${selection.barcode}`);
          }
          const unitKey = `${productId}::${selection.unitId}`;
          if (seenUnitIds.has(unitKey)) failed(`Sticker Unit တစ်ခုတည်းကို အရောင်းတစ်ခုထဲ နှစ်ကြိမ် ပါဝင်နေပါတယ်: ${selection.barcode}`);
          seenUnitIds.add(unitKey);
          const list = soldUnits.get(match.registryId) || [];
          list.push({ registryId: match.registryId, unitId: selection.unitId, ...(str(match.unit.batchId) ? { batchId: str(match.unit.batchId) } : {}) });
          soldUnits.set(match.registryId, list);
          // Units with a Batch must be covered by that Batch's allocation.
          const unitBatchId = str(match.unit.batchId);
          if (unitBatchId) {
            const nextCount = (selectedByBatch.get(unitBatchId) || 0) + 1;
            if ((allocatedByBatch.get(unitBatchId) || 0) + EPSILON < nextCount) {
              failed(`Stock Batch ခွဲဝေမှု မလုံလောက်ပါ: ${unitBatchId}`);
            }
            selectedByBatch.set(unitBatchId, nextCount);
          }
        }
      }

      // A Product-only deduction is only safe when that Product has no remaining
      // Batch records; otherwise the client omitted a required Batch allocation.
      if (productsWithoutAllocations.size) {
        const unallocatedIds = [...productsWithoutAllocations];
        for (let index = 0; index < unallocatedIds.length; index += 30) {
          const chunk = unallocatedIds.slice(index, index + 30);
          const batchQuery = await transaction.get(branchRef.collection('stockBatches').where('payload.productId', 'in', chunk));
          reads += batchQuery.size;
          for (const doc of batchQuery.docs) {
            const record = doc.data();
            if (record.deleted === true || record.branchId !== branchId) continue;
            const batchPayload = asRecord(record.payload);
            if (!batchPayload || num(batchPayload.quantity) <= EPSILON) continue;
            failed(`Stock Batch ခွဲဝေမှု မပြည့်စုံပါ: ${str(batchPayload.productId)}။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
          }
        }
      }

      let kpayReference = '';
      if (str(sale.paymentMethod) === 'KPay') {
        kpayReference = str(sale.kpayTransactionReference).trim();
        const referenceKey = kpayReference.toLowerCase();
        const keyQuery = await transaction.get(branchRef.collection('sales').where('payload.kpayReferenceKey', '==', referenceKey));
        const legacyQuery = await transaction.get(branchRef.collection('sales').where('payload.kpayTransactionReference', '==', kpayReference));
        reads += keyQuery.size + legacyQuery.size;
        if ([...keyQuery.docs, ...legacyQuery.docs].some((doc) => doc.id !== str(sale.id))) {
          failed('ဒီ KPay Transaction Reference ကို အရောင်းတစ်ခုမှာ အသုံးပြုပြီးသားဖြစ်ပါတယ်။ Owner စစ်ဆေးရန်လိုပါတယ်။');
        }
      }

      const customerId = str(sale.customerId).trim();
      const sharedCustomerRef = str(sale.paymentMethod) === 'Credit'
        ? businessRef.collection('shared').doc('customers').collection('records').doc(customerId)
        : null;
      const customerSnapshot = sharedCustomerRef ? await transaction.get(sharedCustomerRef) : null;
      if (customerSnapshot) reads += 1;
      let existingCustomerPayload: Dict | null = null;
      if (customerSnapshot?.exists) {
        const record = customerSnapshot.data() || {};
        const payload = asRecord(record.payload);
        if (record.scope !== 'shared' || record.kind !== 'customers' || record.deleted === true
          || !payload || str(payload.id) !== customerId) {
          failed('Customer Data သည် ဒီ Business Customer မဟုတ်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
        }
        existingCustomerPayload = {
          id: customerId,
          name: limitedString(payload.name, 120) || 'အမည်မသိ Customer',
          phone: limitedString(payload.phone, 40),
          address: limitedString(payload.address, 300),
          note: limitedString(payload.note, 500),
          createdAt: limitedString(payload.createdAt, 40) || now,
        };
      }
      let newCustomerPayload: Dict | null = null;
      if (sharedCustomerRef && !customerSnapshot?.exists) {
        const clientSnapshot = asRecord(sale.customerSnapshot);
        if (clientSnapshot && str(clientSnapshot.id) !== customerId) {
          invalid('Customer Snapshot ID သည် Sale Customer ID နှင့် မကိုက်ညီပါ။');
        }
        const name = limitedString(clientSnapshot?.name, 120) || limitedString(sale.customer, 120);
        if (!name) invalid('Credit Customer အမည် မပါဝင်ပါ။');
        newCustomerPayload = {
          id: customerId,
          name,
          phone: limitedString(clientSnapshot?.phone, 40),
          address: limitedString(clientSnapshot?.address, 300),
          note: limitedString(clientSnapshot?.note, 500),
          createdAt: now,
        };
      }
      const customerPayloadForSale = newCustomerPayload || existingCustomerPayload;

      const registryWrites: Array<{ ref: DocumentReference<DocumentData>; payload: Dict }> = [];
      for (const [registryId, units] of soldUnits) {
        const registry = registryDocs.find((entry) => entry.id === registryId);
        if (!registry) failed('Sticker Registry ပြောင်းလဲသွားပါတယ်။ Owner စစ်ဆေးရန်လိုပါတယ်။');
        const soldIds = new Set(units.map((entry) => entry.unitId));
        const nextUnits = registry.units.map((unit) => soldIds.has(str(unit.id))
          ? { ...unit, status: 'sold', saleId: str(sale.id), soldAt: now, soldByUid: uid }
          : unit);
        registryWrites.push({
          ref: branchRef.collection('stockUnitRegistries').doc(registryId),
          payload: {
            scope: 'branchRecord', kind: 'stockUnitRegistries', branchId, deleted: false,
            updatedAt: now, updatedBy: uid, sourceSaleId: str(sale.id),
            payload: { ...registry.payload, units: nextUnits, updatedAt: now, updatedByUid: uid },
          },
        });
      }

      const writeCount = productWrites.length + batchWrites.length + registryWrites.length + 2 + (newCustomerPayload ? 1 : 0);
      if (writeCount > MAX_WRITES) throw new HttpsError('resource-exhausted', 'ဒီဘောင်ချာမှာ Product / Batch အရေအတွက် များလွန်းနေပါတယ်။');

      const productDeltaObject = Object.fromEntries(productDeltas);
      const batchDeltaObject = Object.fromEntries(batchDeltas);
      const {
        cloudSyncStatus: _cloudSyncStatus,
        cloudSyncError: _cloudSyncError,
        customerSnapshot: _clientCustomerSnapshot,
        kpayReferenceKey: _clientKpayKey,
        kpayTransactionReference: _clientKpayReference,
        ...saleBase
      } = sale;
      const cloudPayload: Dict = {
        ...saleBase,
        branchId,
        ...(customerId ? { customerId } : {}),
        items: trustedItems,
        subtotal: trustedSubtotal,
        discount: trustedDiscount,
        total: trustedTotal,
        profit: trustedProfit,
        ...(kpayReference ? { kpayTransactionReference: kpayReference, kpayReferenceKey: kpayReference.toLowerCase() } : {}),
        ...(customerPayloadForSale ? { customerSnapshot: customerPayloadForSale } : {}),
        productDeltas: productDeltaObject,
        batchDeltas: batchDeltaObject,
        stockLines: [...productDeltas].map(([productId, quantity]) => ({ productId, quantity })),
        batchLines: [...batchDeltas].map(([batchId, quantity]) => ({ batchId, productId: batchProductIds.get(batchId), quantity })),
        saleFingerprint: fingerprint,
        cashierSyncVersion: 2,
        unitSaleVersion: 1,
        serverReceivedAt: now,
        serverSaleDay: serverDay,
      };

      productWrites.forEach(({ ref, payload }) => transaction.set(ref, {
        scope: 'branchRecord', kind: 'products', branchId, payload, deleted: false,
        updatedAt: now, updatedBy: uid, sourceSaleId: str(sale.id),
      }));
      batchWrites.forEach(({ ref, payload }) => transaction.set(ref, {
        scope: 'branchRecord', kind: 'stockBatches', branchId, payload, deleted: false,
        updatedAt: now, updatedBy: uid, sourceSaleId: str(sale.id),
      }));
      registryWrites.forEach((write) => transaction.set(write.ref, write.payload));
      transaction.set(saleRef, {
        scope: 'branchRecord', kind: 'sales', branchId, deleted: false,
        updatedAt: now, updatedBy: uid, payload: cloudPayload,
      });
      if (sharedCustomerRef && newCustomerPayload) {
        transaction.set(sharedCustomerRef, {
          scope: 'shared', kind: 'customers', branchId,
          payload: newCustomerPayload, updatedAt: now, updatedBy: uid, sourceSaleId: str(sale.id),
        });
      }
      transaction.set(auditRef, {
        id: `${str(sale.id)}__created`, eventType: 'SALE_CREATED', branchId, saleId: str(sale.id),
        receiptNo: str(sale.receiptNo), actorUid: uid, actorEmail: authEmail,
        actorName, occurredAt: now, total: trustedTotal,
      });

      return { result: 'created', readCount: reads, writeCount };
    });
  }
);
