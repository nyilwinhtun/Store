import { getFirestore, type DocumentData, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const BUSINESS_ID = 'store-mini-main';
const FUNCTION_REGION = 'asia-southeast1';
const EPSILON = 0.000001;
type Dict = Record<string, unknown>;
type Plan = {
  destinationProductId: string;
  destinationStockBefore: number;
  destinationStockAfter: number;
  destinationBatchIds: string[];
};

function asRecord(value: unknown): Dict | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Dict
    : null;
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

function sameOptionalNumber(a: unknown, b: unknown): boolean {
  return (a == null && b == null) || near(a, b);
}

function normalizedText(value: unknown): string {
  return str(value).trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function normalizedCode(value: unknown): string {
  return str(value).trim().replace(/\s+/g, '').toUpperCase();
}

function payloadOf(record: Dict | undefined): Dict {
  return asRecord(record?.payload) || {};
}

function sameProductRecord(remote: Dict, before: Dict): boolean {
  const payload = payloadOf(remote);
  return remote.kind === 'products'
    && remote.branchId === before.branchId
    && payload.id === before.id
    && payload.branchId === before.branchId
    && near(payload.stock, before.stock)
    && str(payload.barcode) === str(before.barcode)
    && str(payload.sku) === str(before.sku)
    && str(payload.name) === str(before.name)
    && str(payload.category) === str(before.category)
    && near(payload.costPrice, before.costPrice)
    && near(payload.retailPrice, before.retailPrice)
    && near(payload.wholesalePrice, before.wholesalePrice)
    && near(payload.lowStockAt, before.lowStockAt)
    && str(payload.unit) === str(before.unit)
    && str(payload.quantityMode) === str(before.quantityMode)
    && str(payload.createdAt) === str(before.createdAt)
    && str(payload.priceGroupId) === str(before.priceGroupId)
    && sameOptionalNumber(payload.priceVersion, before.priceVersion)
    && str(payload.image) === str(cleanForCloud(before).image);
}

function sameBatchRecord(remote: Dict, before: Dict): boolean {
  const payload = payloadOf(remote);
  return remote.kind === 'stockBatches'
    && remote.branchId === before.branchId
    && payload.id === before.id
    && payload.productId === before.productId
    && (payload.branchId || remote.branchId) === before.branchId
    && near(payload.quantity, before.quantity)
    && str(payload.expiryDate) === str(before.expiryDate)
    && near(payload.unitCost, before.unitCost)
    && str(payload.purchaseId) === str(before.purchaseId)
    && str(payload.supplierId) === str(before.supplierId)
    && str(payload.receivedAt) === str(before.receivedAt)
    && str(payload.stockReceiptId) === str(before.stockReceiptId)
    && str(payload.sourceShipmentId) === str(before.sourceShipmentId)
    && sameOptionalNumber(payload.sourceShipmentLineIndex, before.sourceShipmentLineIndex)
    && sameOptionalNumber(payload.sourceShipmentBatchIndex, before.sourceShipmentBatchIndex);
}

function sameShipmentLine(remote: Dict, candidate: Dict): boolean {
  const keys = [
    'sourceProductId', 'productName', 'sku', 'barcode', 'category', 'quantity', 'unit',
    'quantityMode', 'costPrice', 'retailPrice', 'wholesalePrice', 'lowStockAt',
    'sourceStockBefore', 'sourceStockAfter',
  ];
  if (!keys.every((key) => key === 'quantity' || key.endsWith('Price') || key.endsWith('StockBefore') || key.endsWith('StockAfter') || key === 'lowStockAt'
    ? (remote[key] == null && candidate[key] == null) || near(remote[key], candidate[key])
    : str(remote[key]) === str(candidate[key]))) return false;
  const remoteAllocations = asRecordList(remote.batchAllocations);
  const candidateAllocations = asRecordList(candidate.batchAllocations);
  return remoteAllocations.length === candidateAllocations.length && remoteAllocations.every((allocation, index) => {
    const other = candidateAllocations[index];
    return !!other
      && str(allocation.sourceBatchId) === str(other.sourceBatchId)
      && near(allocation.quantity, other.quantity)
      && near(allocation.unitCost, other.unitCost)
      && str(allocation.expiryDate) === str(other.expiryDate)
      && str(allocation.receivedAt) === str(other.receivedAt)
      && str(allocation.purchaseId) === str(other.purchaseId)
      && str(allocation.supplierId) === str(other.supplierId);
  });
}

function asRecordList(value: unknown): Dict[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item): item is Dict => !!item);
}

function matchesShipmentProduct(product: Dict, line: Dict): boolean {
  return (!!str(line.barcode) && normalizedCode(product.barcode) === normalizedCode(line.barcode))
    || (!!str(line.sku) && normalizedCode(product.sku) === normalizedCode(line.sku))
    || (normalizedText(product.name) === normalizedText(line.productName)
      && normalizedText(product.unit || 'ခု') === normalizedText(line.unit || 'ခု'));
}

function safeData(value: unknown, label: string): Dict {
  const parsed = asRecord(value);
  if (!parsed) throw new HttpsError('invalid-argument', `${label} is invalid.`);
  return parsed;
}

const PRODUCT_PAYLOAD_KEYS = new Set([
  'branchId', 'priceGroupId', 'priceVersion', 'id', 'name', 'sku', 'barcode', 'category',
  'costPrice', 'retailPrice', 'wholesalePrice', 'stock', 'lowStockAt', 'unit', 'quantityMode', 'image', 'createdAt',
]);
const BATCH_PAYLOAD_KEYS = new Set([
  'branchId', 'id', 'productId', 'purchaseId', 'supplierId', 'stockReceiptId',
  'sourceShipmentId', 'sourceShipmentLineIndex', 'sourceShipmentBatchIndex',
  'quantity', 'receivedAt', 'expiryDate', 'unitCost',
]);

function assertOnlyKeys(value: Dict, allowed: Set<string>, label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length) throw new HttpsError('invalid-argument', `${label} တွင် မခွင့်ပြုထားသော field ပါဝင်ပါတယ်။`);
}

function assertUnchangedFields(before: Dict, after: Dict, mutableKeys: Set<string>, label: string): void {
  for (const [key, value] of Object.entries(before)) {
    if (mutableKeys.has(key)) continue;
    if (JSON.stringify(value) !== JSON.stringify(after[key])) {
      throw new HttpsError('failed-precondition', `${label}: မသက်ဆိုင်သော ${key} field ကို ပြောင်းလဲထားပါတယ်။`);
    }
  }
}

function cleanForCloud(value: Dict): Dict {
  const serialized = JSON.stringify(value, (key, child: unknown) => {
    if (typeof child === 'string' && ['logoUrl', 'bannerUrl', 'photoUrl', 'image'].includes(key)
      && (child.startsWith('local-image:') || child.startsWith('data:image/'))) return '';
    return child;
  });
  return serialized ? JSON.parse(serialized) as Dict : value;
}

function validateProductAfter(
  line: Dict,
  before: Dict | undefined,
  after: Dict,
  plan: Plan,
  branchId: string,
): void {
  assertOnlyKeys(after, PRODUCT_PAYLOAD_KEYS, 'Destination Product');
  if (before) {
    if (!matchesShipmentProduct(before, line)) {
      throw new HttpsError('failed-precondition', `${str(line.productName)}: Destination Product သည် ပို့ထားသော Product နှင့် မူလကတည်းက မကိုက်ညီပါ။`);
    }
    assertUnchangedFields(before, after, new Set([
      'name', 'sku', 'barcode', 'category', 'costPrice', 'retailPrice', 'wholesalePrice',
      'lowStockAt', 'stock', 'unit', 'quantityMode',
    ]), 'Destination Product');
  } else if (typeof after.createdAt !== 'string' || !after.createdAt.trim()) {
    throw new HttpsError('invalid-argument', 'Product အသစ်၏ Created At မပြည့်စုံပါ။');
  }
  const beforeStock = before ? Math.max(0, num(before.stock) || 0) : 0;
  const quantity = num(line.quantity);
  const afterStock = beforeStock + quantity;
  if (after.id !== plan.destinationProductId || after.branchId !== branchId
    || !near(plan.destinationStockBefore, beforeStock)
    || !near(plan.destinationStockAfter, afterStock)
    || !near(after.stock, afterStock)
    || !matchesShipmentProduct(after, line)
    || str(after.name) !== str(line.productName)
    || str(after.sku) !== (str(line.sku) || str(before?.sku))
    || str(after.barcode) !== (str(line.barcode) || str(before?.barcode))
    || (before ? str(after.category) !== (str(line.category) || str(before.category)) : !str(after.category).trim())
    || !near(after.lowStockAt, line.lowStockAt)
    || str(after.unit) !== str(line.unit)
    || str(after.quantityMode) !== str(line.quantityMode)) {
    throw new HttpsError('failed-precondition', `${str(line.productName) || 'Product'}: Destination Product / Stock Plan မကိုက်ညီပါ။`);
  }

  const expectedCost = before && afterStock > 0
    ? ((beforeStock * (num(before.costPrice) || 0)) + (quantity * num(line.costPrice))) / afterStock
    : num(line.costPrice);
  if (!near(after.costPrice, expectedCost)) {
    throw new HttpsError('failed-precondition', `${str(line.productName)}: Weighted Cost Price မကိုက်ညီပါ။`);
  }
  const hasSharedPrice = !!str(before?.priceGroupId);
  const expectedRetail = hasSharedPrice ? before?.retailPrice : line.retailPrice;
  const expectedWholesale = hasSharedPrice ? before?.wholesalePrice : line.wholesalePrice;
  if (!near(after.retailPrice, expectedRetail) || !near(after.wholesalePrice, expectedWholesale)
    || str(after.priceGroupId) !== str(before?.priceGroupId)
    || !((after.priceVersion == null && before?.priceVersion == null) || near(after.priceVersion, before?.priceVersion))) {
    throw new HttpsError('failed-precondition', `${str(line.productName)}: Shared Pricing / Sale Price ကို မပြောင်းနိုင်ပါ။`);
  }
}

function validateShipmentAndReceipt(remotePayload: Dict, candidateShipment: Dict, uid: string): Dict[] {
  if (candidateShipment.status !== 'approved' || candidateShipment.completionMode !== 'auto'
    || candidateShipment.autoCompletedByUid !== uid
    || str(candidateShipment.id) !== str(remotePayload.id)) {
    throw new HttpsError('invalid-argument', 'Auto Complete Shipment Candidate မမှန်ကန်ပါ။');
  }
  const remoteItems = asArray(remotePayload.items, 'Shipment items');
  const localItems = asArray(candidateShipment.items, 'Candidate shipment items');
  if (remoteItems.length === 0 || remoteItems.length !== localItems.length
    || !remoteItems.every((line, index) => sameShipmentLine(line, localItems[index]))) {
    throw new HttpsError('failed-precondition', 'Cloud Shipment Items ပြောင်းလဲသွားပါတယ်။ Refresh လုပ်ပြီး ပြန်စစ်ပါ။');
  }
  const receipts = asArray(candidateShipment.receivedItems, 'Received items');
  if (receipts.length !== remoteItems.length) throw new HttpsError('invalid-argument', 'လက်ခံစာရင်း အရေအတွက် မပြည့်စုံပါ။');
  const seen = new Set<string>();
  const normalizedReceipts = receipts.map((receipt) => {
    const id = str(receipt.sourceProductId);
    const line = remoteItems.find((item) => str(item.sourceProductId) === id);
    if (!line || seen.has(id) || !near(receipt.receivedQuantity, line.quantity) || !near(receipt.damagedQuantity, 0)) {
      throw new HttpsError('failed-precondition', 'ပုံမှန် Auto Complete အတွက် ပို့ထားသည့်အရေအတွက်အပြည့်နှင့် ပျက်စီးမှုမရှိကြောင်း အတည်ပြုရန်လိုပါတယ်။');
    }
    seen.add(id);
    return { sourceProductId: id, receivedQuantity: num(line.quantity), damagedQuantity: 0, note: str(receipt.note).trim() };
  });
  if (seen.size !== remoteItems.length) throw new HttpsError('invalid-argument', 'Shipment ပစ္စည်းအားလုံး၏ လက်ခံစာရင်းကို ဖြည့်ပါ။');
  for (const line of remoteItems) {
    const allocations = asArray(line.batchAllocations, 'Batch allocations');
    const qty = num(line.quantity);
    if (!allocations.length || allocations.some((allocation) => !Number.isFinite(num(allocation.quantity)) || num(allocation.quantity) <= 0)
      || !near(allocations.reduce((sum, allocation) => sum + num(allocation.quantity), 0), qty)
      || (line.quantityMode !== 'whole' && line.quantityMode !== 'decimal')) {
      throw new HttpsError('failed-precondition', `${str(line.productName)}: Shipment Batch Allocation မပြည့်စုံပါ။`);
    }
    if (line.quantityMode === 'whole' && Math.abs(qty - Math.round(qty)) > EPSILON) {
      throw new HttpsError('failed-precondition', `${str(line.productName)}: Whole Quantity မမှန်ကန်ပါ။`);
    }
  }
  return normalizedReceipts;
}

/**
 * Server-authoritative exact-match shipment completion.
 * Cashiers may invoke this callable only for their one active receiving Branch.
 * Product, Batch and Shipment updates are committed together with Admin SDK;
 * the client cannot grant itself stock-write permission through Firestore Rules.
 */
export const completeBranchStockShipment = onCall(
  { region: FUNCTION_REGION, timeoutSeconds: 60, memory: '512MiB', maxInstances: 10 },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) throw new HttpsError('unauthenticated', 'Cashier Login လိုအပ်ပါတယ်။');
    const uid = auth.uid;
    const body = safeData(request.data, 'Request');
    if (body.uid !== uid) throw new HttpsError('permission-denied', 'Request UID မကိုက်ညီပါ။');

    const candidateShipment = safeData(body.shipment, 'Shipment');
    const shipmentId = str(candidateShipment.id).trim();
    const branchId = str(candidateShipment.toBranchId).trim();
    if (!shipmentId || !branchId) throw new HttpsError('invalid-argument', 'Shipment ID / Branch ID မပြည့်စုံပါ။');

    const beforeProducts = asArray(body.beforeProducts, 'Before products');
    const afterProducts = asArray(body.afterProducts, 'After products');
    const beforeBatches = asArray(body.beforeBatches, 'Before batches');
    const afterBatches = asArray(body.afterBatches, 'After batches');
    const rawPlan = asArray(candidateShipment.autoCompletionPlan, 'Auto completion plan');
    const plan: Plan[] = rawPlan.map((entry) => {
      const destinationBatchIds = Array.isArray(entry.destinationBatchIds)
        ? entry.destinationBatchIds.map((value) => str(value).trim())
        : [];
      const result = {
        destinationProductId: str(entry.destinationProductId).trim(),
        destinationStockBefore: num(entry.destinationStockBefore),
        destinationStockAfter: num(entry.destinationStockAfter),
        destinationBatchIds,
      };
      if (!result.destinationProductId || !Number.isFinite(result.destinationStockBefore)
        || !Number.isFinite(result.destinationStockAfter) || !destinationBatchIds.length
        || destinationBatchIds.some((id) => !id)) {
        throw new HttpsError('invalid-argument', 'Auto Completion Plan မမှန်ကန်ပါ။');
      }
      return result;
    });

    const db = getFirestore();
    const businessRef = db.collection('businesses').doc(BUSINESS_ID);
    const memberRef = businessRef.collection('members').doc(uid);
    const branchRef = businessRef.collection('branches').doc(branchId);
    const shipmentRef = branchRef.collection('stockShipments').doc(shipmentId);
    const authEmail = str(auth.token.email).trim().toLowerCase();
    const actorName = str(auth.token.name) || authEmail || 'Stock Receiver';
    const now = new Date().toISOString();

    return db.runTransaction(async (transaction) => {
      const [businessSnapshot, memberSnapshot, branchSnapshot, shipmentSnapshot] = await Promise.all([
        transaction.get(businessRef), transaction.get(memberRef), transaction.get(branchRef), transaction.get(shipmentRef),
      ]);
      if (!businessSnapshot.exists || businessSnapshot.data()?.active === false) {
        throw new HttpsError('failed-precondition', 'Minimart Business မရရှိနိုင်ပါ။');
      }
      if (!memberSnapshot.exists) throw new HttpsError('permission-denied', 'Cashier Membership မတွေ့ပါ။');
      const member = memberSnapshot.data() || {};
      const memberEmail = str(member.email).trim().toLowerCase();
      const branchIds = Array.isArray(member.branchIds) ? member.branchIds : [];
      if (member.uid !== uid || member.role !== 'cashier' || member.status !== 'active'
        || member.canReceiveStock !== true || !authEmail || memberEmail !== authEmail
        || branchIds.length !== 1 || branchIds[0] !== branchId) {
        throw new HttpsError('permission-denied', 'ဒီ Branch အတွက် Active Stock Receiver ခွင့်မရှိပါ။');
      }
      if (!branchSnapshot.exists) throw new HttpsError('failed-precondition', 'လက်ခံမည့် Branch မတွေ့ပါ။');
      const branchRecord = branchSnapshot.data() || {};
      const branchPayload = asRecord(branchRecord.payload) || branchRecord;
      if (branchPayload.status !== 'active') throw new HttpsError('permission-denied', 'လက်ခံမည့် Branch သည် Active မဟုတ်ပါ။');
      if (!shipmentSnapshot.exists) throw new HttpsError('not-found', 'Cloud Shipment မတွေ့ပါ။');
      const shipmentRecord = shipmentSnapshot.data() || {};
      const remotePayload = asRecord(shipmentRecord.payload);
      if (!remotePayload || shipmentRecord.kind !== 'stockShipments' || shipmentRecord.branchId !== branchId
        || str(remotePayload.id) !== shipmentId || str(remotePayload.toBranchId) !== branchId) {
        throw new HttpsError('failed-precondition', 'Cloud Shipment Data / Branch မကိုက်ညီပါ။');
      }
      if (remotePayload.status === 'approved' && remotePayload.completionMode === 'auto'
        && remotePayload.autoCompletedByUid === uid) {
        return { alreadyCommitted: true, readCount: 4, writeCount: 0 };
      }
      if (remotePayload.status !== 'dispatched' || str(remotePayload.fromBranchId) === branchId) {
        throw new HttpsError('failed-precondition', 'ဒီ Shipment ကို လက်ခံပြီးသား သို့မဟုတ် အခြေအနေပြောင်းလဲပြီးသား ဖြစ်နေပါတယ်။');
      }
      if (plan.length !== asArray(remotePayload.items, 'Shipment items').length) {
        throw new HttpsError('invalid-argument', 'Auto Completion Plan အရေအတွက် မကိုက်ညီပါ။');
      }
      if (plan.length > 30 || beforeBatches.length > 400 || beforeProducts.length > 30) {
        throw new HttpsError('resource-exhausted', 'Shipment ရဲ့ Product / Batch Data အရေအတွက် များလွန်းပါတယ်။ Owner Review လုပ်ပါ။');
      }
      const receipts = validateShipmentAndReceipt(remotePayload, candidateShipment, uid);
      const remoteItems = asArray(remotePayload.items, 'Shipment items');
      const planProductIds = plan.map((entry) => entry.destinationProductId);
      const identityTokens = new Set<string>();
      for (let lineIndex = 0; lineIndex < remoteItems.length; lineIndex += 1) {
        const line = remoteItems[lineIndex];
        const plannedBefore = beforeProducts.find((product) => str(product.id) === plan[lineIndex].destinationProductId);
        if (plannedBefore && !matchesShipmentProduct(plannedBefore, line)) {
          throw new HttpsError('failed-precondition', `${str(line.productName)}: Destination Product Mapping မကိုက်ညီပါ။ Owner Review လုပ်ပါ။`);
        }
        const tokens = [
          str(line.barcode) ? `barcode:${normalizedCode(line.barcode)}` : '',
          str(line.sku) ? `sku:${normalizedCode(line.sku)}` : '',
          `name-unit:${normalizedText(line.productName)}|${normalizedText(line.unit || 'ခု')}`,
        ].filter(Boolean);
        if (tokens.some((token) => identityTokens.has(token))) {
          throw new HttpsError('failed-precondition', `${str(line.productName)}: Shipment အတွင်း Product အမှတ်အသား ထပ်နေပါတယ်။ Owner က Product Mapping ကို ရှင်းပေးပါ။`);
        }
        tokens.forEach((token) => identityTokens.add(token));
      }
      if (new Set(planProductIds).size !== planProductIds.length) {
        throw new HttpsError('failed-precondition', 'Shipment ပစ္စည်းများ Destination Product တစ်ခုတည်းသို့ ထပ်နေပါတယ်။ Owner က Product Mapping ကို စစ်ပေးပါ။');
      }
      const expectedBatchIds = plan.flatMap((entry) => entry.destinationBatchIds);
      if (new Set(expectedBatchIds).size !== expectedBatchIds.length) throw new HttpsError('invalid-argument', 'Destination Batch ID ထပ်နေပါတယ်။');
      const expectedWrites = plan.length + expectedBatchIds.length + 1;
      if (expectedWrites > 450) throw new HttpsError('resource-exhausted', 'Shipment အရွယ်အစားကြီးလွန်းပါတယ်။ Batch / Product အရေအတွက် လျှော့ပါ။');
      if (afterProducts.length !== plan.length || afterBatches.length !== expectedBatchIds.length) {
        throw new HttpsError('invalid-argument', 'Destination Product / Batch Plan အရေအတွက် မကိုက်ညီပါ။');
      }

      const beforeProductById = new Map(beforeProducts.map((item) => [str(item.id), item]));
      const afterProductById = new Map(afterProducts.map((item) => [str(item.id), item]));
      const beforeBatchById = new Map(beforeBatches.map((item) => [str(item.id), item]));
      const afterBatchById = new Map(afterBatches.map((item) => [str(item.id), item]));
      if (beforeProductById.size !== beforeProducts.length || afterProductById.size !== afterProducts.length
        || beforeBatchById.size !== beforeBatches.length || afterBatchById.size !== afterBatches.length) {
        throw new HttpsError('invalid-argument', 'Before / After Data ထဲတွင် ID ထပ်နေပါတယ်။');
      }
      if (planProductIds.some((id) => !afterProductById.has(id))
        || expectedBatchIds.some((id) => !afterBatchById.has(id))) {
        throw new HttpsError('invalid-argument', 'Plan နှင့် Destination Data မကိုက်ညီပါ။');
      }

      const productCollection = branchRef.collection('products');
      const productRefs = plan.map((entry) => productCollection.doc(entry.destinationProductId));
      const newBatchRefs = expectedBatchIds.map((id) => branchRef.collection('stockBatches').doc(id));
      const identityQueries: Array<ReturnType<typeof productCollection.where>> = [];
      for (const line of remoteItems) {
        if (str(line.barcode)) identityQueries.push(productCollection.where('payload.barcode', '==', str(line.barcode)));
        if (str(line.sku)) identityQueries.push(productCollection.where('payload.sku', '==', str(line.sku)));
        if (str(line.productName)) identityQueries.push(productCollection.where('payload.name', '==', str(line.productName)));
      }
      const [productSnapshots, newBatchSnapshots, categoryQuery, identityQuerySnapshots] = await Promise.all([
        Promise.all(productRefs.map((ref) => transaction.get(ref))),
        Promise.all(newBatchRefs.map((ref) => transaction.get(ref))),
        transaction.get(branchRef.collection('categories')),
        Promise.all(identityQueries.map((query) => transaction.get(query))),
      ]);

      const productIdChunks: string[][] = [];
      for (let index = 0; index < planProductIds.length; index += 30) productIdChunks.push(planProductIds.slice(index, index + 30));
      const existingBatchDocs: QueryDocumentSnapshot<DocumentData>[] = [];
      const registryDocs: QueryDocumentSnapshot<DocumentData>[] = [];
      for (const ids of productIdChunks) {
        const [batchSnapshot, registrySnapshot] = await Promise.all([
          transaction.get(branchRef.collection('stockBatches').where('payload.productId', 'in', ids)),
          transaction.get(branchRef.collection('stockUnitRegistries').where('payload.productId', 'in', ids)),
        ]);
        existingBatchDocs.push(...batchSnapshot.docs);
        registryDocs.push(...registrySnapshot.docs);
      }
      if (registryDocs.some((snapshot) => {
        const payload = asRecord(snapshot.data().payload) || {};
        return Array.isArray(payload.units) && payload.units.length > 0;
      })) {
        throw new HttpsError('failed-precondition', 'Destination Product တွင် Unit Barcode Tracking ရှိပြီးသားဖြစ်လို့ Quantity Shipment ဖြင့် Auto Complete မလုပ်နိုင်ပါ။');
      }

      const categories = categoryQuery.docs.map((snapshot) => asRecord(snapshot.data().payload) || {});
      for (let lineIndex = 0; lineIndex < remoteItems.length; lineIndex += 1) {
        const line = remoteItems[lineIndex];
        const matches = new Map<string, Dict>();
        for (const querySnapshot of identityQuerySnapshots) {
          for (const snapshot of querySnapshot.docs) {
            const record = snapshot.data() as Dict;
            const payload = payloadOf(record);
            if (record.deleted !== true && matchesShipmentProduct(payload, line)) matches.set(snapshot.id, record);
          }
        }
        const plannedProductId = plan[lineIndex].destinationProductId;
        const before = beforeProductById.get(plannedProductId);
        if (matches.size > 1 || (before ? (matches.size !== 1 || !matches.has(plannedProductId)) : matches.size !== 0)) {
          throw new HttpsError('failed-precondition', `${str(line.productName)}: Cloud Destination Product Mapping ထပ်နေခြင်း သို့မဟုတ် ပြောင်းလဲနေခြင်းရှိလို့ Owner Review လိုအပ်ပါတယ်။`);
        }
      }
      const currentBatches = existingBatchDocs.filter((snapshot) => snapshot.data().deleted !== true);
      const remoteBatchById = new Map(currentBatches.map((snapshot) => [snapshot.id, snapshot.data()]));
      if (remoteBatchById.size !== beforeBatches.length) {
        throw new HttpsError('failed-precondition', 'Destination Batch စာရင်းသည် Cloud နှင့် Device မတူညီပါ။ Owner Review လုပ်ပါ။');
      }
      for (const before of beforeBatches) {
        const remote = remoteBatchById.get(str(before.id));
        if (!remote || !sameBatchRecord(remote, before)) {
          throw new HttpsError('failed-precondition', 'Destination Batch တစ်ခုသည် Cloud နှင့် Device မတူညီပါ။ Owner Review လုပ်ပါ။');
        }
      }

      const productWrites: Array<{ ref: DocumentReference; payload: Dict; lineIndex: number }> = [];
      const batchWrites: Array<{ ref: DocumentReference; payload: Dict; lineIndex: number; batchIndex: number }> = [];
      let reads = 4 + productSnapshots.length + newBatchSnapshots.length + categoryQuery.size + existingBatchDocs.length + registryDocs.length + identityQuerySnapshots.reduce((sum, snapshot) => sum + snapshot.size, 0);

      for (let lineIndex = 0; lineIndex < plan.length; lineIndex += 1) {
        const line = remoteItems[lineIndex];
        const linePlan = plan[lineIndex];
        const before = beforeProductById.get(linePlan.destinationProductId);
        const after = afterProductById.get(linePlan.destinationProductId);
        const remoteSnapshot = productSnapshots[lineIndex];
        if (!after) throw new HttpsError('invalid-argument', 'Destination Product မတွေ့ပါ။');
        if (before) {
          if (!remoteSnapshot.exists || !sameProductRecord(remoteSnapshot.data() as Dict, before)) {
            throw new HttpsError('failed-precondition', `${str(line.productName)}: Cloud Product Stock က Device နဲ့ မကိုက်ညီပါ။`);
          }
        } else if (remoteSnapshot.exists) {
          throw new HttpsError('already-exists', `${str(line.productName)}: Destination Product ID ရှိပြီးသားဖြစ်ပါတယ်။`);
        }
        validateProductAfter(line, before, after, linePlan, branchId);

        const productBatches = currentBatches.filter((snapshot) => str((asRecord(snapshot.data().payload) || {}).productId) === linePlan.destinationProductId);
        const batchTotal = productBatches.reduce((sum, snapshot) => sum + Math.max(0, num((asRecord(snapshot.data().payload) || {}).quantity) || 0), 0);
        const beforeStock = before ? Math.max(0, num(before.stock) || 0) : 0;
        if (!near(batchTotal, beforeStock)) {
          throw new HttpsError('failed-precondition', `${str(line.productName)}: Product Stock / Batch Stock မညီညွတ်ပါ။ Owner က စာရင်းညှိရန်လိုပါတယ်။`);
        }
        if (!before) {
          const category = categories.find((entry) => entry.isActive === true && str(entry.name) === str(after.category));
          if (!category) throw new HttpsError('failed-precondition', `${str(line.productName)}: Destination မှာ သက်ဆိုင်ရာ Active Category မရှိပါ။`);
        }

        const expectedAllocations = asArray(line.batchAllocations, 'Batch allocations');
        if (linePlan.destinationBatchIds.length !== expectedAllocations.length) {
          throw new HttpsError('invalid-argument', `${str(line.productName)}: Destination Batch ID အရေအတွက် မကိုက်ညီပါ။`);
        }
        productWrites.push({
          ref: productRefs[lineIndex],
          lineIndex,
          payload: {
            scope: 'branchRecord', kind: 'products', branchId, payload: cleanForCloud(after), deleted: false,
            updatedAt: now, updatedBy: uid, sourceShipmentId: shipmentId, sourceShipmentLineIndex: lineIndex,
          },
        });
        for (let batchIndex = 0; batchIndex < expectedAllocations.length; batchIndex += 1) {
          const allocation = expectedAllocations[batchIndex];
          const batchId = linePlan.destinationBatchIds[batchIndex];
          const afterBatch = afterBatchById.get(batchId);
          const snapshot = newBatchSnapshots[expectedBatchIds.indexOf(batchId)];
          if (afterBatch) assertOnlyKeys(afterBatch, BATCH_PAYLOAD_KEYS, 'Destination Stock Batch');
          if (!afterBatch || !snapshot || snapshot.exists
            || afterBatch.id !== batchId || afterBatch.branchId !== branchId
            || afterBatch.productId !== linePlan.destinationProductId
            || !near(afterBatch.quantity, allocation.quantity)
            || !near(afterBatch.unitCost, allocation.unitCost)
            || str(afterBatch.expiryDate) !== str(allocation.expiryDate)
            || str(afterBatch.receivedAt) !== str(allocation.receivedAt)
            || str(afterBatch.purchaseId) !== str(allocation.purchaseId)
            || str(afterBatch.supplierId) !== str(allocation.supplierId)
            || str(afterBatch.stockReceiptId) !== shipmentId
            || str(afterBatch.sourceShipmentId) !== shipmentId
            || num(afterBatch.sourceShipmentLineIndex) !== lineIndex
            || num(afterBatch.sourceShipmentBatchIndex) !== batchIndex) {
            throw new HttpsError('failed-precondition', `${str(line.productName)}: Destination Batch Plan မကိုက်ညီပါ။`);
          }
          batchWrites.push({
            ref: newBatchRefs[expectedBatchIds.indexOf(batchId)], lineIndex, batchIndex,
            payload: {
              scope: 'branchRecord', kind: 'stockBatches', branchId, payload: cleanForCloud(afterBatch), deleted: false,
              updatedAt: now, updatedBy: uid, sourceShipmentId: shipmentId,
              sourceShipmentLineIndex: lineIndex, sourceShipmentBatchIndex: batchIndex,
            },
          });
        }
      }

      const approvedPayload: Dict = {
        ...remotePayload,
        items: remoteItems.map((item) => ({ ...item, acceptedQuantity: num(item.quantity) })),
        status: 'approved',
        completionMode: 'auto',
        autoCompletedByUid: uid,
        autoCompletionPlan: plan,
        receivedItems: receipts,
        receivedAt: str(candidateShipment.receivedAt) || now,
        receivedByUid: uid,
        receivedByEmail: authEmail,
        receivedByName: actorName,
        receiverNote: str(candidateShipment.receiverNote).trim(),
        approvedAt: now,
        approvedByUid: uid,
        approvedByEmail: authEmail,
        approvedByName: actorName,
        approvalNote: 'Exact-match receiver confirmation',
      };

      for (const write of productWrites) transaction.set(write.ref, write.payload, { merge: true });
      for (const write of batchWrites) transaction.set(write.ref, write.payload, { merge: true });
      transaction.set(shipmentRef, {
        scope: 'branchRecord', kind: 'stockShipments', branchId, payload: approvedPayload, deleted: false,
        updatedAt: now, updatedBy: uid,
      }, { merge: true });
      return { alreadyCommitted: false, readCount: reads, writeCount: productWrites.length + batchWrites.length + 1 };
    });
  }
);
