import { invalid, denied } from '../errors.js';

export const MAX_ITEMS = 200;
export const MAX_UNIT_SELECTIONS = 200;
export const MAX_WRITES = 450;
export const MAX_KPAY_REFERENCE_LENGTH = 120;
export const MAX_FUTURE_CLOCK_SKEW_MS = 10 * 60 * 1000;
export const DOC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
export const CUSTOMER_ID_PATTERN = DOC_ID_PATTERN;
export const KPAY_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const EPSILON = 0.000001;
const ALLOWANCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

// Strict allowlists: anything not named here is rejected before any Firestore
// read, so an unexpected path or field can never reach a write.
export const SALE_FIELDS = new Set([
  'id', 'branchId', 'receiptNo', 'date', 'customer', 'customerId', 'paymentMethod',
  'cashReceivedAmount', 'kpayTransactionReference', 'kpayAccountNameSnapshot',
  'kpayAccountNumberSnapshot', 'kpayAccountLabelSnapshot', 'kpayQrVersionSnapshot',
  'changeAmount', 'paidAmount', 'dueAmount', 'items', 'subtotal', 'discount', 'total',
  'profit', 'status', 'createdByUid', 'createdByEmail', 'createdByName', 'customerSnapshot',
  'cloudSyncStatus', 'cloudSyncError',
]);
export const ITEM_FIELDS = new Set([
  'productId', 'name', 'sku', 'quantity', 'unitPrice', 'costPrice', 'mode', 'stockAtAdd',
  'unit', 'quantityMode', 'priceGroupId', 'priceVersion', 'batchAllocations', 'stockUnitSelections',
  'amountBased',
]);
const ALLOCATION_FIELDS = new Set(['batchId', 'quantity']);
const SELECTION_FIELDS = new Set(['registryId', 'unitId', 'barcode', 'batchId']);
export const CUSTOMER_SNAPSHOT_FIELDS = new Set(['id', 'name', 'phone', 'address', 'note', 'createdAt']);

export function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function asArray(value, label) {
  if (!Array.isArray(value)) invalid(`${label} သည် List ဖြစ်ရပါမည်။`);
  return value.map((item, index) => {
    const record = asRecord(item);
    if (!record) invalid(`${label}[${index}] မမှန်ကန်ပါ။`);
    return record;
  });
}

export function str(value) {
  return typeof value === 'string' ? value : '';
}

export function num(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : Number.NaN;
}

export function near(a, b) {
  const left = num(a);
  const right = num(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= EPSILON;
}

export function normalizedCode(value) {
  return str(value).trim().replace(/\s+/g, '').toUpperCase();
}

export function cleanQuantity(value, whole) {
  return whole && Math.abs(value - Math.round(value)) < 1e-8 ? Math.round(value) : Math.round(value * 1000) / 1000;
}

export function branchDay(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function limitedString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function assertOnlyFields(record, allowed, label) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalid(`${label} တွင် ခွင့်မပြုထားသော Field ပါဝင်နေပါတယ်: ${key}`);
  }
}

export function asRecordList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item) => !!item);
}

export function selectionsOf(item, index) {
  const records = Array.isArray(item.stockUnitSelections) ? item.stockUnitSelections : [];
  if (item.stockUnitSelections !== undefined && !Array.isArray(item.stockUnitSelections)) {
    invalid(`Item ${index + 1}: Sticker Unit စာရင်း မမှန်ကန်ပါ။`);
  }
  return records.map((selection, position) => {
    const record = asRecord(selection);
    if (!record) invalid(`Item ${index + 1}: Sticker Unit မမှန်ကန်ပါ။`);
    assertOnlyFields(record, SELECTION_FIELDS, `Item ${index + 1} Sticker Unit ${position + 1}`);
    const unitId = str(record.unitId).trim();
    const registryId = str(record.registryId).trim();
    const barcode = normalizedCode(record.barcode);
    if (!unitId || !registryId || !DOC_ID_PATTERN.test(registryId) || !barcode || barcode.length > 128) {
      invalid(`Item ${index + 1}: Sticker Unit selection မမှန်ကန်ပါ။`);
    }
    return { registryId, unitId, barcode, ...(str(record.batchId) ? { batchId: str(record.batchId) } : {}) };
  });
}

export function allocationsOf(item) {
  const records = Array.isArray(item.batchAllocations) ? item.batchAllocations : [];
  if (item.batchAllocations !== undefined && !Array.isArray(item.batchAllocations)) {
    invalid('Stock Batch ခွဲဝေမှု မမှန်ကန်ပါ။');
  }
  return records.map((allocation) => {
    const record = asRecord(allocation);
    if (!record) invalid('Stock Batch ခွဲဝေမှု မမှန်ကန်ပါ။');
    assertOnlyFields(record, ALLOCATION_FIELDS, 'Stock Batch ခွဲဝေမှု');
    const batchId = str(record.batchId).trim();
    const quantity = num(record.quantity);
    if (!batchId || !Number.isFinite(quantity) || quantity <= 0 || !DOC_ID_PATTERN.test(batchId)) {
      invalid('Stock Batch ခွဲဝေမှု မမှန်ကန်ပါ။');
    }
    return { batchId, quantity };
  });
}

/** Must stay byte-identical to the client fingerprint in cashierSalesSync.ts. */
export function saleFingerprint(sale) {
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

export function assertSaleShape(sale, uid, branchId, serverNow) {
  assertOnlyFields(sale, SALE_FIELDS, 'Sale');
  if (str(sale.createdByUid) !== uid) denied('Sale UID မကိုက်ညီပါ။');
  if (str(sale.branchId) !== branchId) denied('Sale Branch မကိုက်ညီပါ။');
  const saleId = str(sale.id).trim();
  if (!saleId || !DOC_ID_PATTERN.test(saleId)) invalid('Sale ID မမှန်ကန်ပါ။');
  if (!str(sale.receiptNo).trim()) invalid('Receipt No မပါဝင်ပါ။');
  if (str(sale.customer).length > 120) invalid('Customer အမည် ရှည်လွန်းပါတယ်။');
  if (sale.status !== 'completed') invalid('Completed Sale မဟုတ်ပါ။');
  const date = new Date(str(sale.date));
  if (!Number.isFinite(date.getTime())) invalid('Sale Date မမှန်ကန်ပါ။');
  if (date.getTime() - serverNow.getTime() > MAX_FUTURE_CLOCK_SKEW_MS) {
    invalid('Sale Date သည် Server အချိန်ထက် များလွန်းနေပါတယ်။');
  }
  const customerId = str(sale.customerId).trim();
  if (customerId && (!CUSTOMER_ID_PATTERN.test(customerId) || customerId !== str(sale.customerId))) {
    invalid('Customer ID မမှန်ကန်ပါ။');
  }
  if (str(sale.paymentMethod) === 'Credit' && !customerId) invalid('Credit Sale တွင် Customer ID မပါဝင်ပါ။');
  const items = asArray(sale.items, 'Sale items');
  if (items.length === 0 || items.length > MAX_ITEMS) invalid('Sale items အရေအတွက် မမှန်ကန်ပါ။');

  const subtotal = num(sale.subtotal);
  const discount = num(sale.discount);
  const total = num(sale.total);
  const paid = num(sale.paidAmount);
  const due = num(sale.dueAmount);
  if (![subtotal, discount, total, paid, due].every((value) => Number.isFinite(value) && value >= 0)) {
    invalid('Sale ငွေပမာဏ မမှန်ကန်ပါ။');
  }
  if (!near(total, subtotal - discount)) invalid('Sale Total မကိုက်ညီပါ။');
  const method = str(sale.paymentMethod);
  if (!['Cash', 'KPay', 'Credit'].includes(method)) invalid('Payment Method မမှန်ကန်ပါ။');
  if (method === 'Credit') {
    if (!near(paid + due, total)) invalid('Credit ငွေရှင်းမှု မကိုက်ညီပါ။');
  } else if (!near(paid, total) || !near(due, 0)) {
    invalid('ငွေရှင်းမှု မကိုက်ညီပါ။');
  }
  if (sale.cashReceivedAmount !== undefined && (!Number.isFinite(num(sale.cashReceivedAmount)) || num(sale.cashReceivedAmount) < total)) {
    invalid('Cash Received မလုံလောက်ပါ။');
  }
  if (sale.changeAmount !== undefined && (!Number.isFinite(num(sale.changeAmount)) || num(sale.changeAmount) < 0)) {
    invalid('Change Amount မမှန်ကန်ပါ။');
  }
  if (method === 'KPay') {
    const reference = str(sale.kpayTransactionReference).trim();
    const alphanumeric = reference.match(/[A-Za-z0-9]/g) ?? [];
    if (!reference || reference.length > MAX_KPAY_REFERENCE_LENGTH
      || !KPAY_REFERENCE_PATTERN.test(reference) || alphanumeric.length < 4 || !/\d/.test(reference)) {
      invalid('KPay Transaction ID မမှန်ကန်ပါ။');
    }
  }
  for (const key of ['kpayAccountNameSnapshot', 'kpayAccountNumberSnapshot', 'kpayAccountLabelSnapshot']) {
    if (sale[key] !== undefined && str(sale[key]).length > 120) invalid(`${key} ရှည်လွန်းပါတယ်။`);
  }
  if (sale.customerSnapshot !== undefined && sale.customerSnapshot !== null && !asRecord(sale.customerSnapshot)) {
    invalid('Customer Snapshot မမှန်ကန်ပါ။');
  }

  return items;
}

/**
 * Request-level parse. The UID is taken only from the verified token; any UID in
 * the body is rejected as an unexpected field. The Branch is later checked
 * against the trusted Member document. An offline commit must carry the
 * server-issued allowance, lease and device reference; a missing reference is
 * an online commit and is checked against the server clock instead.
 */
export function parseRequest(body, identity, serverNow) {
  const record = asRecord(body);
  if (!record) invalid('Request မမှန်ကန်ပါ။');
  for (const key of Object.keys(record)) {
    if (!['branchId', 'sale', 'allowanceId', 'allowanceToken', 'leaseId', 'deviceId'].includes(key)) {
      invalid(`Request တွင် ခွင့်မပြုထားသော Field ပါဝင်နေပါတယ်: ${key}`);
    }
  }
  const branchId = str(record.branchId).trim();
  const sale = asRecord(record.sale);
  if (!branchId || !sale) invalid('Branch / Sale မပြီးပြည့်စုံပါ။');
  const allowanceId = str(record.allowanceId).trim();
  const allowanceToken = str(record.allowanceToken).trim();
  const leaseId = str(record.leaseId).trim();
  const deviceId = str(record.deviceId).trim();
  const allowanceFields = [allowanceId, allowanceToken, leaseId, deviceId];
  const allowanceCount = allowanceFields.filter(Boolean).length;
  if (allowanceCount !== 0 && allowanceCount !== allowanceFields.length) {
    invalid('Offline Commitment တွင် Allowance / Lease / Device အချက်အလက် အားလုံး ပါရပါမည်။');
  }
  if (allowanceCount === allowanceFields.length) {
    if (!DOC_ID_PATTERN.test(allowanceId) || !DOC_ID_PATTERN.test(leaseId)) {
      invalid('Allowance / Lease ID မမှန်ကန်ပါ။');
    }
    if (!ALLOWANCE_TOKEN_PATTERN.test(allowanceToken)) invalid('Allowance Token မမှန်ကန်ပါ။');
    if (!DEVICE_ID_PATTERN.test(deviceId)) invalid('Device ID မမှန်ကန်ပါ။');
  }
  if (str(sale.createdByUid) !== identity.uid) denied('Sale UID မကိုက်ညီပါ။');
  if (str(sale.branchId) !== branchId) denied('Sale Branch မကိုက်ညီပါ။');
  const items = assertSaleShape(sale, identity.uid, branchId, serverNow);

  const selectionsByItem = items.map((item, index) => selectionsOf(item, index));
  const totalSelections = selectionsByItem.reduce((sum, value) => sum + value.length, 0);
  if (totalSelections > MAX_UNIT_SELECTIONS) invalid('Sticker Unit အရေအတွက် များလွန်းပါတယ်။');

  const productDeltas = new Map();
  const batchDeltas = new Map();
  const batchProductIds = new Map();
  const productsWithoutAllocations = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    assertOnlyFields(item, ITEM_FIELDS, `Item ${index + 1}`);
    const productId = str(item.productId).trim();
    const quantity = num(item.quantity);
    if (!productId || !DOC_ID_PATTERN.test(productId) || !Number.isFinite(quantity) || quantity <= 0) {
      invalid(`Item ${index + 1}: Product / Quantity မမှန်ကန်ပါ။`);
    }
    const selections = selectionsByItem[index];
    if (selections.length > 0 && (!Number.isInteger(quantity) || selections.length !== quantity)) {
      invalid(`Item ${index + 1}: Sticker Unit စာရင်းနှင့် ပမာဏ မကိုက်ညီပါ။`);
    }
    productDeltas.set(productId, (productDeltas.get(productId) || 0) + quantity);
    const allocations = allocationsOf(item);
    if (!allocations.length) {
      productsWithoutAllocations.add(productId);
      continue;
    }
    const allocated = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    if (!near(allocated, quantity)) invalid(`Item ${index + 1}: Stock Batch ခွဲဝေမှု မပြည့်စုံပါ။`);
    for (const allocation of allocations) {
      batchDeltas.set(allocation.batchId, (batchDeltas.get(allocation.batchId) || 0) + allocation.quantity);
      const previous = batchProductIds.get(allocation.batchId);
      if (previous && previous !== productId) invalid('Stock Batch တစ်ခုကို Product မတူဘဲ အသုံးပြုထားပါတယ်။');
      batchProductIds.set(allocation.batchId, productId);
    }
  }
  if (!productDeltas.size) invalid('ရောင်းချမည့် Product မရှိပါ။');
  if (sale.customerSnapshot) assertOnlyFields(asRecord(sale.customerSnapshot), CUSTOMER_SNAPSHOT_FIELDS, 'Customer Snapshot');

  return {
    branchId,
    sale,
    items,
    selectionsByItem,
    productDeltas,
    batchDeltas,
    batchProductIds,
    productsWithoutAllocations,
    fingerprint: saleFingerprint(sale),
    offline: allowanceCount > 0
      ? { allowanceId, allowanceToken, leaseId, deviceId }
      : null,
  };
}
