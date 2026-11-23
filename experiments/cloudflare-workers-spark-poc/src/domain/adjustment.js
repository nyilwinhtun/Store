import { failed, invalid } from '../errors.js';
import {
  asRecord, cleanQuantity, limitedString, num, str, DOC_ID_PATTERN, MAX_WRITES, EPSILON,
} from './sale.js';
import { assertCashierContext, payloadOf } from './allowance.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{3,99}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_LINES = 100;
const MAX_UNITS = 200;
const REASON_MAX = 300;
const REFUND_REFERENCE_MAX = 120;
const DISPOSITIONS = new Set(['restock', 'damaged']);

function moneyRound(value) {
  return Math.round(value * 100) / 100;
}

function asList(value) {
  return Array.isArray(value) ? value.map(asRecord).filter(Boolean) : [];
}

function assertFields(record, allowed, label) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalid(`${label} တွင် ခွင့်မပြုထားသော Field ပါဝင်နေပါတယ်: ${key}`);
  }
}

function parseCommon(body, label) {
  const record = asRecord(body);
  if (!record) invalid(`${label} မမှန်ကန်ပါ။`);
  const branchId = str(record.branchId).trim();
  const saleId = str(record.saleId).trim();
  const requestId = str(record.requestId).trim();
  const reason = limitedString(record.reason, REASON_MAX);
  const deviceId = str(record.deviceId).trim();
  if (!DOC_ID_PATTERN.test(branchId)) invalid('Branch ID မမှန်ကန်ပါ။');
  if (!DOC_ID_PATTERN.test(saleId)) invalid('Sale ID မမှန်ကန်ပါ။');
  if (!REQUEST_ID_PATTERN.test(requestId)) invalid('Adjustment Request ID မမှန်ကန်ပါ။');
  if (reason.length < 3) invalid('အကြောင်းပြချက် အနည်းဆုံး ၃ လုံး ဖြည့်ပါ။');
  if (!DEVICE_ID_PATTERN.test(deviceId)) invalid('Device ID မမှန်ကန်ပါ။');
  return { branchId, saleId, requestId, reason, deviceId };
}

export function parseVoidRequest(body) {
  const record = asRecord(body);
  if (!record) invalid('Void Request မမှန်ကန်ပါ။');
  assertFields(record, new Set(['branchId', 'saleId', 'requestId', 'reason', 'deviceId']), 'Void Request');
  return parseCommon(record, 'Void Request');
}

export function parseReturnRequest(body) {
  const record = asRecord(body);
  if (!record) invalid('Return Request မမှန်ကန်ပါ။');
  assertFields(record, new Set([
    'branchId', 'saleId', 'requestId', 'reason', 'deviceId', 'items', 'refundReference',
  ]), 'Return Request');
  const common = parseCommon(record, 'Return Request');
  const items = asList(record.items);
  if (!items.length || items.length > MAX_LINES) invalid('Return ပစ္စည်းစာရင်း မမှန်ကန်ပါ။');
  let unitCount = 0;
  const lines = items.map((item, index) => {
    assertFields(item, new Set(['productId', 'quantity', 'disposition', 'units']), `Return Item ${index + 1}`);
    const productId = str(item.productId).trim();
    const quantity = num(item.quantity);
    const disposition = str(item.disposition);
    if (!DOC_ID_PATTERN.test(productId)) invalid(`Return Item ${index + 1}: Product ID မမှန်ကန်ပါ။`);
    if (!Number.isFinite(quantity) || quantity <= 0) invalid(`Return Item ${index + 1}: ပမာဏ မမှန်ကန်ပါ။`);
    if (!DISPOSITIONS.has(disposition)) invalid(`Return Item ${index + 1}: အခြေအနေ မမှန်ကန်ပါ။`);
    const units = asList(item.units).map((unit, position) => {
      assertFields(unit, new Set(['registryId', 'unitId', 'disposition']), `Return Item ${index + 1} Unit ${position + 1}`);
      const registryId = str(unit.registryId).trim();
      const unitId = str(unit.unitId).trim();
      const unitDisposition = str(unit.disposition);
      if (!DOC_ID_PATTERN.test(registryId) || !unitId) invalid(`Return Item ${index + 1}: Sticker Unit မမှန်ကန်ပါ။`);
      if (!DISPOSITIONS.has(unitDisposition)) invalid(`Return Item ${index + 1}: Sticker Unit အခြေအနေ မမှန်ကန်ပါ။`);
      return { registryId, unitId, disposition: unitDisposition };
    });
    unitCount += units.length;
    return { productId, quantity, disposition, units };
  });
  if (unitCount > MAX_UNITS) invalid('Return Sticker Unit များလွန်းပါတယ်။');
  return {
    ...common,
    items: lines,
    refundReference: limitedString(record.refundReference, REFUND_REFERENCE_MAX),
  };
}

function parseSaleLines(sale) {
  const items = asList(sale.items);
  if (!items.length) failed('Sale ထဲမှာ ပစ္စည်းစာရင်း မရှိပါ။');
  return items.map((item, index) => {
    const productId = str(item.productId).trim();
    const quantity = num(item.quantity);
    const unitPrice = num(item.unitPrice);
    const costPrice = num(item.costPrice);
    if (!DOC_ID_PATTERN.test(productId) || !Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(costPrice) || costPrice < 0) {
      failed(`Sale Item ${index + 1} အချက်အလက် မမှန်ကန်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
    }
    const batchAllocations = asList(item.batchAllocations).map((entry) => {
      const batchId = str(entry.batchId).trim();
      const allocated = num(entry.quantity);
      if (!DOC_ID_PATTERN.test(batchId) || !Number.isFinite(allocated) || allocated <= 0) {
        failed(`Sale Item ${index + 1}: Batch ခွဲဝေမှု မမှန်ကန်ပါ။`);
      }
      return { batchId, quantity: allocated };
    });
    const selections = asList(item.stockUnitSelections).map((entry) => {
      const registryId = str(entry.registryId).trim();
      const unitId = str(entry.unitId).trim();
      const barcode = str(entry.barcode).trim();
      if (!DOC_ID_PATTERN.test(registryId) || !unitId || !barcode) {
        failed(`Sale Item ${index + 1}: Sticker Unit မမှန်ကန်ပါ။`);
      }
      return { registryId, unitId, barcode };
    });
    if (selections.length && (!Number.isInteger(quantity) || selections.length !== quantity)) {
      failed(`Sale Item ${index + 1}: Sticker Unit စာရင်းနှင့် ပမာဏ မကိုက်ညီပါ။`);
    }
    return { productId, quantity, unitPrice, costPrice, batchAllocations, selections };
  });
}

function branchRecord(existing, kind, branchId, uid, now, payload) {
  return { ...existing, scope: 'branchRecord', kind, branchId, deleted: false, updatedAt: now, updatedBy: uid, payload };
}

function wholeQuantity(payload, quantity) {
  return cleanQuantity(quantity, str(payload.quantityMode || 'whole') !== 'decimal');
}

function refundFor(paymentMethod, paidAmount, total, value) {
  if (paymentMethod === 'Cash') return { status: 'cash-refunded', amount: moneyRound(Math.min(value, paidAmount || total)) };
  if (paymentMethod === 'KPay') return { status: 'kpay-pending', amount: moneyRound(Math.min(value, paidAmount || total)) };
  return { status: 'credit-review', amount: moneyRound(value) };
}

function voidOutcome(now, refund, total, lines, writeCount) {
  return {
    result: 'created', kind: 'void', occurredAt: now,
    refundStatus: refund.status, refundAmount: refund.amount, total, writeCount,
    items: lines.map((line) => ({
      productId: line.productId, quantity: line.quantity, disposition: 'restock', batchAllocations: [],
      units: line.selections.map((selection) => ({
        registryId: selection.registryId, unitId: selection.unitId, disposition: 'restock',
      })),
    })),
  };
}

export async function voidSaleOnce({ fs, businessId, identity, body, serverNow }) {
  const request = parseVoidRequest(body);
  const { branchId, saleId, requestId, reason, deviceId } = request;
  const now = serverNow.toISOString();
  const businessPath = `businesses/${businessId}`;
  const branchPath = `${businessPath}/branches/${branchId}`;
  const salePath = `${branchPath}/sales/${saleId}`;
  const auditPath = `${branchPath}/auditEvents/${saleId}__void`;
  const transaction = await fs.beginTransaction();
  try {
    const base = await fs.batchGet([
      businessPath, `${businessPath}/members/${identity.uid}`, branchPath, salePath, auditPath,
    ], transaction);
    const saleDoc = base.get(salePath);
    const sale = payloadOf(saleDoc);
    const auditDoc = base.get(auditPath);
    if (!sale) failed('Cloud Sale မတွေ့ပါ။ Cloud Sync ပြီးမှ Void လုပ်ပါ။');
    if (sale.branchId !== branchId) failed('Sale Branch မကိုက်ညီပါ။');
    if (sale.status === 'voided') {
      if (auditDoc && str(auditDoc.data?.voidRequestId) === requestId) {
        await fs.rollback(transaction);
        return {
          result: 'already-committed', kind: 'void', occurredAt: str(auditDoc.data?.occurredAt),
          refundStatus: str(auditDoc.data?.refundStatus), refundAmount: num(auditDoc.data?.refundAmount),
          total: num(auditDoc.data?.total),
        };
      }
      failed('Voucher ကို ပယ်ဖျက်ထားပြီးဖြစ်ပါတယ်။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    }
    if (sale.status !== 'completed') failed('Completed Sale မဟုတ်ပါ။');
    if (str(sale.paymentMethod) === 'Credit' && num(sale.paidAmount) > 0) {
      failed('ကြိုပေးချေထားသော Credit Sale ကို Void မလုပ်နိုင်ပါ။ Return ကို အသုံးပြုပါ။');
    }
    if ((num(sale.returnCount) || 0) > 0 || asList(sale.returns).length > 0 || (num(sale.returnedTotal) || 0) > 0) {
      failed('Return ပြုလုပ်ပြီးသား Sale ကို Void မလုပ်နိုင်ပါ။');
    }
    if (auditDoc) failed('ဒီ Voucher အတွက် Void Audit Record ရှိပြီးသား ဖြစ်နေပါတယ်။');

    const { authEmail, actorName } = assertCashierContext({
      businessDoc: base.get(businessPath),
      memberDoc: base.get(`${businessPath}/members/${identity.uid}`),
      branchDoc: base.get(branchPath),
      identity,
      branchId,
    });
    const lines = parseSaleLines(sale);
    if (lines.length > MAX_LINES) invalid('Sale ပစ္စည်းအရေအတွက် များလွန်းပါတယ်။');
    const productQuantities = new Map();
    const batchTotals = new Map();
    const registryUnits = new Map();
    lines.forEach((line) => {
      productQuantities.set(line.productId, (productQuantities.get(line.productId) || 0) + line.quantity);
      line.batchAllocations.forEach((allocation) => {
        const prior = batchTotals.get(allocation.batchId);
        if (prior && prior.productId !== line.productId) failed('Stock Batch Product မကိုက်ညီပါ။');
        batchTotals.set(allocation.batchId, {
          productId: line.productId, quantity: (prior?.quantity || 0) + allocation.quantity,
        });
      });
      line.selections.forEach((selection) => {
        const entry = registryUnits.get(selection.registryId) || { productId: line.productId, unitIds: new Set() };
        if (entry.productId !== line.productId) failed('Sticker Registry Product မကိုက်ညီပါ။');
        entry.unitIds.add(selection.unitId);
        registryUnits.set(selection.registryId, entry);
      });
    });
    if ([...registryUnits.values()].reduce((sum, entry) => sum + entry.unitIds.size, 0) > MAX_UNITS) {
      invalid('Sticker Unit အရေအတွက် များလွန်းပါတယ်။');
    }

    const productPaths = [...productQuantities.keys()].map((id) => `${branchPath}/products/${id}`);
    const batchPaths = [...batchTotals.keys()].map((id) => `${branchPath}/stockBatches/${id}`);
    const registryPaths = [...registryUnits.keys()].map((id) => `${branchPath}/stockUnitRegistries/${id}`);
    const inventory = await fs.batchGet([...productPaths, ...batchPaths, ...registryPaths], transaction);
    const productPayloads = new Map();
    const writes = [];
    for (const [productId, quantity] of productQuantities) {
      const snapshot = inventory.get(`${branchPath}/products/${productId}`);
      const payload = payloadOf(snapshot);
      if (!snapshot || snapshot.data?.deleted === true || snapshot.data?.kind !== 'products' || !payload) {
        failed(`Cloud Product မတွေ့ပါ: ${productId}`);
      }
      if (str(payload.branchId || branchId) !== branchId) failed(`Cloud Product Branch မကိုက်ညီပါ: ${productId}`);
      const stock = num(payload.stock);
      if (!Number.isFinite(stock) || stock < 0) failed(`Cloud Product Stock မမှန်ပါ: ${productId}`);
      productPayloads.set(productId, payload);
      writes.push({
        path: `${branchPath}/products/${productId}`,
        data: branchRecord(snapshot.data, 'products', branchId, identity.uid, now,
          { ...payload, stock: wholeQuantity(payload, stock + quantity) }),
      });
    }
    for (const [batchId, expected] of batchTotals) {
      const snapshot = inventory.get(`${branchPath}/stockBatches/${batchId}`);
      const payload = payloadOf(snapshot);
      if (!snapshot || snapshot.data?.deleted === true || snapshot.data?.kind !== 'stockBatches'
        || snapshot.data?.branchId !== branchId || !payload || str(payload.productId) !== expected.productId) {
        failed(`Cloud Stock Batch မတွေ့ပါ / Data မကိုက်ညီပါ: ${batchId}`);
      }
      const current = num(payload.quantity);
      if (!Number.isFinite(current) || current < 0) failed(`Cloud Batch Quantity မမှန်ပါ: ${batchId}`);
      writes.push({
        path: `${branchPath}/stockBatches/${batchId}`,
        data: branchRecord(snapshot.data, 'stockBatches', branchId, identity.uid, now,
          { ...payload, quantity: wholeQuantity(productPayloads.get(expected.productId), current + expected.quantity) }),
      });
    }
    for (const [registryId, expected] of registryUnits) {
      const snapshot = inventory.get(`${branchPath}/stockUnitRegistries/${registryId}`);
      const payload = payloadOf(snapshot);
      if (!snapshot || snapshot.data?.deleted === true || snapshot.data?.kind !== 'stockUnitRegistries' || !payload) {
        failed(`Cloud Sticker Registry မတွေ့ပါ: ${registryId}`);
      }
      if (str(payload.productId) !== expected.productId) failed(`Sticker Registry Product မကိုက်ညီပါ: ${registryId}`);
      let restored = 0;
      const units = asList(payload.units).map((unit) => {
        if (!expected.unitIds.has(str(unit.id))) return unit;
        if (str(unit.status) !== 'sold' || str(unit.saleId) !== saleId) {
          failed(`Void ပြန်လည် Stock ဝင်မည့် Sticker Unit အခြေအနေ မကိုက်ညီပါ: ${str(unit.barcode || unit.id)}`);
        }
        restored += 1;
        const { saleId: _saleId, soldAt: _soldAt, soldByUid: _soldByUid, ...priorUnit } = unit;
        return {
          ...priorUnit, status: 'in_stock', lastSaleId: saleId, voidedSaleId: saleId,
          returnedAt: now, returnedByUid: identity.uid,
        };
      });
      if (restored !== expected.unitIds.size) failed(`Void Sticker Unit အရေအတွက် မကိုက်ညီပါ: ${registryId}`);
      writes.push({
        path: `${branchPath}/stockUnitRegistries/${registryId}`,
        data: branchRecord(snapshot.data, 'stockUnitRegistries', branchId, identity.uid, now,
          { ...payload, units, updatedAt: now, updatedByUid: identity.uid }),
      });
    }

    const total = num(sale.total);
    if (!Number.isFinite(total) || total < 0) failed('Sale Total မမှန်ပါ။');
    const refund = refundFor(str(sale.paymentMethod), num(sale.paidAmount), total, total);
    const nextPayload = {
      ...sale, status: 'voided', dueAmount: 0, voidReason: reason,
      voidedAt: now, voidedByUid: identity.uid, voidedByEmail: authEmail, voidedByName: actorName,
      voidRequested: false, voidRequestId: requestId,
      voidFingerprint: JSON.stringify({ kind: 'void', saleId, requestId, reason, deviceId, uid: identity.uid }),
      voidRefundStatus: refund.status, voidRefundAmount: refund.amount,
      lastAdjustmentKind: 'void', lastAdjustedAt: now, lastAdjustedByUid: identity.uid,
    };
    writes.push({
      path: salePath,
      data: branchRecord(saleDoc.data, 'sales', branchId, identity.uid, now, nextPayload),
    });
    writes.push({
      path: auditPath,
      data: {
        id: `${saleId}__void`, eventType: 'SALE_VOIDED', branchId, saleId,
        receiptNo: str(sale.receiptNo), actorUid: identity.uid, actorEmail: authEmail,
        actorName, occurredAt: now, total, reason, deviceId, requestId, voidRequestId: requestId,
        refundStatus: refund.status, refundAmount: refund.amount,
      },
    });
    if (writes.length > MAX_WRITES) invalid('ဒီ Voucher ကို တစ်ကြိမ်တည်း Void လုပ်ရန် များလွန်းပါတယ်။');
    await fs.commit(transaction, writes);
    return voidOutcome(now, refund, total, lines, writes.length);
  } catch (error) {
    if (!(error?.message || '').includes('already-committed')) {
      try { await fs.rollback(transaction); } catch { /* transaction may already be closed */ }
    }
    throw error;
  }
}

export async function returnSaleOnce({ fs, businessId, identity, body, serverNow }) {
  const request = parseReturnRequest(body);
  const { branchId, saleId, requestId, reason, deviceId, refundReference } = request;
  const now = serverNow.toISOString();
  const businessPath = `businesses/${businessId}`;
  const branchPath = `${businessPath}/branches/${branchId}`;
  const salePath = `${branchPath}/sales/${saleId}`;
  const returnPath = `${branchPath}/saleReturns/${requestId}`;
  const auditPath = `${branchPath}/auditEvents/${saleId}__return__${requestId}`;
  const fingerprint = JSON.stringify({
    kind: 'return', saleId, requestId, reason, deviceId, uid: identity.uid,
    items: request.items,
  });
  const transaction = await fs.beginTransaction();
  try {
    const base = await fs.batchGet([
      businessPath, `${businessPath}/members/${identity.uid}`, branchPath, salePath, returnPath, auditPath,
    ], transaction);
    const saleDoc = base.get(salePath);
    const sale = payloadOf(saleDoc);
    const existingReturn = base.get(returnPath)?.data;
    const auditDoc = base.get(auditPath);
    if (!sale) failed('Cloud Sale မတွေ့ပါ။ Cloud Sync ပြီးမှ Return လုပ်ပါ။');
    if (sale.branchId !== branchId) failed('Sale Branch မကိုက်ညီပါ။');
    if (existingReturn) {
      if (existingReturn.fingerprint === fingerprint && existingReturn.saleId === saleId) {
        await fs.rollback(transaction);
        return {
          result: 'already-committed', kind: 'return', returnId: requestId,
          occurredAt: existingReturn.occurredAt, value: existingReturn.value,
          refundStatus: existingReturn.refund?.status, refundAmount: existingReturn.refund?.amount,
          dueAmount: existingReturn.dueAmount,
          returnedProductQuantities: existingReturn.returnedProductQuantities || {},
          returnedBatchQuantities: existingReturn.returnedBatchQuantities || {},
          items: asList(existingReturn.responseItems),
        };
      }
      failed('Return Request ID တူနေသော်လည်း အချက်အလက် မတူပါ။');
    }
    if (auditDoc) failed('Return Audit Record ရှိပြီး Return Record မတွေ့ပါ။');
    if (sale.status !== 'completed') failed('Completed Sale မဟုတ်သောကြောင့် Return မလုပ်နိုင်ပါ။');

    const { authEmail, actorName } = assertCashierContext({
      businessDoc: base.get(businessPath),
      memberDoc: base.get(`${businessPath}/members/${identity.uid}`),
      branchDoc: base.get(branchPath),
      identity,
      branchId,
    });
    const lines = parseSaleLines(sale);
    const lineByProduct = new Map();
    const originalQuantities = new Map();
    const grossByProduct = new Map();
    lines.forEach((line) => {
      const list = lineByProduct.get(line.productId) || [];
      list.push(line);
      lineByProduct.set(line.productId, list);
      originalQuantities.set(line.productId, (originalQuantities.get(line.productId) || 0) + line.quantity);
      grossByProduct.set(line.productId, (grossByProduct.get(line.productId) || 0) + line.unitPrice * line.quantity);
    });
    const priorProduct = asRecord(sale.returnedProductQuantities) || {};
    const priorBatch = asRecord(sale.returnedBatchQuantities) || {};
    request.items.forEach((line, index) => {
      if (!lineByProduct.has(line.productId)) invalid(`Return Item ${index + 1}: Sale ထဲမှာ မပါဝင်ပါ။`);
      const already = num(priorProduct[line.productId]) || 0;
      if (already + line.quantity > (originalQuantities.get(line.productId) || 0) + EPSILON) {
        failed(`Return ပမာဏသည် မူလရောင်းချပမာဏထက် ကျော်နေပါတယ်: ${line.productId}`);
      }
    });

    const productIds = [...new Set(request.items.map((line) => line.productId))];
    const productPaths = productIds.map((id) => `${branchPath}/products/${id}`);
    const productDocs = await fs.batchGet(productPaths, transaction);
    const productPayloads = new Map();
    const trackedProducts = new Set();
    productIds.forEach((productId) => {
      const snapshot = productDocs.get(`${branchPath}/products/${productId}`);
      const payload = payloadOf(snapshot);
      if (!snapshot || snapshot.data?.deleted === true || snapshot.data?.kind !== 'products' || !payload) {
        failed(`Cloud Product မတွေ့ပါ: ${productId}`);
      }
      if (str(payload.branchId || branchId) !== branchId) failed(`Cloud Product Branch မကိုက်ညီပါ: ${productId}`);
      productPayloads.set(productId, payload);
      if (payload.tracksIndividualUnits === true || lineByProduct.get(productId).some((line) => line.selections.length)) {
        trackedProducts.add(productId);
      }
    });
    request.items.forEach((line) => {
      const tracked = trackedProducts.has(line.productId);
      if (tracked && !line.units.length) failed(`Sticker Unit အားလုံး မပါဝင်ပါ: ${line.productId}`);
      if (!tracked && line.units.length) failed(`Unit Tracking မဖွင့်ထားသော Product တွင် Sticker Unit မပါရပါ။`);
      if (tracked && (!Number.isInteger(line.quantity) || line.units.length !== line.quantity)) {
        failed(`Sticker Unit စာရင်းနှင့် Return ပမာဏ မကိုက်ညီပါ: ${line.productId}`);
      }
    });

    const registryIds = [...new Set(request.items.flatMap((line) => line.units.map((unit) => unit.registryId)))];
    const registryDocs = await fs.batchGet(registryIds.map((id) => `${branchPath}/stockUnitRegistries/${id}`), transaction);
    const registryPayloads = new Map();
    registryIds.forEach((registryId) => {
      const snapshot = registryDocs.get(`${branchPath}/stockUnitRegistries/${registryId}`);
      const payload = payloadOf(snapshot);
      if (!snapshot || snapshot.data?.deleted === true || snapshot.data?.kind !== 'stockUnitRegistries' || !payload) {
        failed(`Cloud Sticker Registry မတွေ့ပါ: ${registryId}`);
      }
      registryPayloads.set(registryId, payload);
    });

    const saleKeysByProduct = new Map();
    lineByProduct.forEach((productLines, productId) => {
      saleKeysByProduct.set(productId, new Set(productLines.flatMap((line) => (
        line.selections.map((selection) => `${selection.registryId}::${selection.unitId}`)
      ))));
    });
    const unitDetails = new Map();
    request.items.forEach((line) => {
      line.units.forEach((selection) => {
        const payload = registryPayloads.get(selection.registryId);
        if (str(payload.productId) !== line.productId) failed(`Sticker Registry Product မကိုက်ညီပါ: ${selection.registryId}`);
        const matches = asList(payload.units).filter((unit) => str(unit.id) === selection.unitId);
        if (matches.length !== 1) failed(`Sticker Unit ကို Registry မှာ တစ်ခုတည်း မတွေ့ပါ: ${selection.unitId}`);
        const unit = matches[0];
        if (str(unit.status) !== 'sold' || str(unit.saleId) !== saleId) {
          failed(`Return ပြန်လုပ်နိုင်သော Sticker Unit မဟုတ်ပါ: ${str(unit.barcode || selection.unitId)}`);
        }
        const key = `${selection.registryId}::${selection.unitId}`;
        if (!saleKeysByProduct.get(line.productId)?.has(key)) failed(`မူလ Sale တွင် မပါဝင်သော Sticker Unit ကို Return မလုပ်နိုင်ပါ။`);
        if (unitDetails.has(key)) failed('Sticker Unit တစ်ခုတည်းကို Return စာရင်းထဲ နှစ်ကြိမ် မထည့်ပါနဲ့။');
        unitDetails.set(key, {
          productId: line.productId, batchId: str(unit.batchId),
          barcode: str(unit.barcode), disposition: selection.disposition,
        });
      });
    });

    const batchDeltas = new Map();
    request.items.forEach((line) => {
      if (trackedProducts.has(line.productId)) {
        line.units.forEach((unit) => {
          const detail = unitDetails.get(`${unit.registryId}::${unit.unitId}`);
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
      for (const allocation of lineByProduct.get(line.productId).flatMap((entry) => entry.batchAllocations)) {
        if (remaining <= EPSILON) break;
        const available = allocation.quantity - (num(priorBatch[allocation.batchId]) || 0);
        if (available <= EPSILON) continue;
        const take = Math.min(available, remaining);
        const entry = batchDeltas.get(allocation.batchId) || { productId: line.productId, restock: 0, consumed: 0 };
        if (entry.productId !== line.productId) failed('Stock Batch Product မကိုက်ညီပါ။');
        entry.consumed += take;
        if (line.disposition === 'restock') entry.restock += take;
        batchDeltas.set(allocation.batchId, entry);
        remaining -= take;
      }
      if (remaining > EPSILON) failed(`Return ပမာဏသည် မူလ Batch ခွဲဝေမှုထက် ကျော်နေပါတယ်: ${line.productId}`);
    });

    const batchIds = [...batchDeltas.keys()];
    const batchDocs = await fs.batchGet(batchIds.map((id) => `${branchPath}/stockBatches/${id}`), transaction);
    const writes = [];
    const productRestock = new Map();
    request.items.forEach((line) => {
      const tracked = trackedProducts.has(line.productId);
      const restock = tracked
        ? line.units.filter((unit) => unitDetails.get(`${unit.registryId}::${unit.unitId}`)?.disposition === 'restock').length
        : line.disposition === 'restock' ? line.quantity : 0;
      productRestock.set(line.productId, (productRestock.get(line.productId) || 0) + restock);
    });
    for (const [productId, restock] of productRestock) {
      const snapshot = productDocs.get(`${branchPath}/products/${productId}`);
      const payload = productPayloads.get(productId);
      const stock = num(payload.stock);
      if (!Number.isFinite(stock) || stock < 0) failed(`Cloud Product Stock မမှန်ပါ: ${productId}`);
      writes.push({
        path: `${branchPath}/products/${productId}`,
        data: branchRecord(snapshot.data, 'products', branchId, identity.uid, now,
          { ...payload, stock: wholeQuantity(payload, stock + restock) }),
      });
    }
    for (const [batchId, entry] of batchDeltas) {
      const snapshot = batchDocs.get(`${branchPath}/stockBatches/${batchId}`);
      const payload = payloadOf(snapshot);
      if (!snapshot || snapshot.data?.deleted === true || snapshot.data?.kind !== 'stockBatches'
        || snapshot.data?.branchId !== branchId || !payload || str(payload.productId) !== entry.productId) {
        failed(`Cloud Stock Batch မတွေ့ပါ / Data မကိုက်ညီပါ: ${batchId}`);
      }
      const current = num(payload.quantity);
      if (!Number.isFinite(current) || current < 0) failed(`Cloud Batch Quantity မမှန်ပါ: ${batchId}`);
      writes.push({
        path: `${branchPath}/stockBatches/${batchId}`,
        data: branchRecord(snapshot.data, 'stockBatches', branchId, identity.uid, now,
          { ...payload, quantity: wholeQuantity(productPayloads.get(entry.productId), current + entry.restock) }),
      });
    }

    const unitsByRegistry = new Map();
    request.items.forEach((line) => {
      line.units.forEach((selection) => {
        const detail = unitDetails.get(`${selection.registryId}::${selection.unitId}`);
        const list = unitsByRegistry.get(selection.registryId) || [];
        list.push({ selection, detail });
        unitsByRegistry.set(selection.registryId, list);
      });
    });
    for (const [registryId, entries] of unitsByRegistry) {
      const snapshot = registryDocs.get(`${branchPath}/stockUnitRegistries/${registryId}`);
      const payload = registryPayloads.get(registryId);
      const keys = new Set(entries.map((entry) => entry.selection.unitId));
      let changed = 0;
      const units = asList(payload.units).map((unit) => {
        if (!keys.has(str(unit.id))) return unit;
        const entry = entries.find((candidate) => candidate.selection.unitId === str(unit.id));
        const { saleId: _saleId, soldAt: _soldAt, soldByUid: _soldByUid, ...priorUnit } = unit;
        changed += 1;
        if (entry.detail.disposition === 'damaged') {
          return {
            ...priorUnit, status: 'damaged', lastSaleId: saleId, returnId: requestId,
            damagedAt: now, damagedByUid: identity.uid, damageReason: reason,
          };
        }
        return {
          ...priorUnit, status: 'in_stock', lastSaleId: saleId, returnId: requestId,
          returnedAt: now, returnedByUid: identity.uid,
        };
      });
      if (changed !== entries.length) failed(`Return Sticker Unit အရေအတွက် မကိုက်ညီပါ: ${registryId}`);
      writes.push({
        path: `${branchPath}/stockUnitRegistries/${registryId}`,
        data: branchRecord(snapshot.data, 'stockUnitRegistries', branchId, identity.uid, now,
          { ...payload, units, updatedAt: now, updatedByUid: identity.uid }),
      });
    }

    const saleSubtotal = num(sale.subtotal);
    const saleTotal = num(sale.total);
    if (!Number.isFinite(saleSubtotal) || !Number.isFinite(saleTotal) || saleSubtotal < 0 || saleTotal < 0) {
      failed('Sale Total မမှန်ပါ။');
    }
    const ratio = saleSubtotal > EPSILON ? Math.min(1, saleTotal / saleSubtotal) : 1;
    let returnedValue = 0;
    request.items.forEach((line) => {
      const quantity = originalQuantities.get(line.productId) || 0;
      const average = quantity > 0 ? (grossByProduct.get(line.productId) || 0) / quantity : 0;
      returnedValue += average * line.quantity * ratio;
    });
    returnedValue = moneyRound(returnedValue);
    const paymentMethod = str(sale.paymentMethod);
    const paidAmount = Number.isFinite(num(sale.paidAmount)) ? num(sale.paidAmount) : 0;
    const currentDue = Number.isFinite(num(sale.dueAmount)) ? num(sale.dueAmount) : 0;
    let dueReduction = 0;
    let refundStatus = 'none';
    let refundAmount = 0;
    if (paymentMethod === 'Credit') {
      dueReduction = moneyRound(Math.min(currentDue, returnedValue));
      refundAmount = moneyRound(Math.max(0, returnedValue - dueReduction));
      refundStatus = refundAmount > EPSILON ? 'credit-refund-review' : 'credit-adjusted';
    } else {
      const refund = refundFor(paymentMethod, paidAmount, saleTotal, returnedValue);
      refundStatus = refund.status;
      refundAmount = refund.amount;
    }

    const nextProductReturned = { ...priorProduct };
    const nextBatchReturned = { ...priorBatch };
    request.items.forEach((line) => {
      nextProductReturned[line.productId] = cleanQuantity((num(nextProductReturned[line.productId]) || 0) + line.quantity, false);
    });
    batchDeltas.forEach((entry, batchId) => {
      nextBatchReturned[batchId] = cleanQuantity((num(nextBatchReturned[batchId]) || 0) + entry.consumed, false);
    });
    const responseItems = request.items.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      disposition: line.disposition,
      batchAllocations: [...batchDeltas.entries()]
        .filter(([, entry]) => entry.productId === line.productId && entry.restock > 0)
        .map(([batchId, entry]) => ({ batchId, quantity: entry.restock })),
      units: line.units.map((unit) => ({
        registryId: unit.registryId, unitId: unit.unitId,
        disposition: unitDetails.get(`${unit.registryId}::${unit.unitId}`).disposition,
      })),
    }));
    const priorReturns = asList(sale.returns);
    const nextReturns = [...priorReturns, {
      id: requestId, at: now, actorUid: identity.uid, actorName, reason, deviceId,
      value: returnedValue, refundStatus, refundAmount,
      items: request.items.map((line) => ({
        productId: line.productId, quantity: line.quantity,
        units: line.units.map((unit) => `${unit.registryId}::${unit.unitId}`),
      })),
    }].slice(-50);
    const nextDueAmount = moneyRound(Math.max(0, currentDue - dueReduction));
    const nextPayload = {
      ...sale,
      dueAmount: nextDueAmount,
      returnedProductQuantities: nextProductReturned,
      returnedBatchQuantities: nextBatchReturned,
      returns: nextReturns,
      returnCount: (num(sale.returnCount) || priorReturns.length) + 1,
      returnedTotal: moneyRound((num(sale.returnedTotal) || 0) + returnedValue),
      lastReturnId: requestId, lastReturnReason: reason,
      lastReturnedAt: now, lastReturnedByUid: identity.uid, lastReturnedByName: actorName,
      lastAdjustmentKind: 'return', lastAdjustedAt: now, lastAdjustedByUid: identity.uid,
    };
    const returnItemRecords = request.items.map((line) => ({
      productId: line.productId,
      name: str(productPayloads.get(line.productId)?.name) || line.productId,
      quantity: line.quantity,
      disposition: line.disposition,
      units: line.units.map((unit) => {
        const detail = unitDetails.get(`${unit.registryId}::${unit.unitId}`);
        return {
          registryId: unit.registryId, unitId: unit.unitId, barcode: detail.barcode,
          ...(detail.batchId ? { batchId: detail.batchId } : {}), disposition: detail.disposition,
        };
      }),
    }));
    writes.push({
      path: salePath,
      data: branchRecord(saleDoc.data, 'sales', branchId, identity.uid, now, nextPayload),
    });
    writes.push({
      path: returnPath,
      data: {
        id: requestId, eventType: 'SALE_RETURN', kind: 'saleReturns', branchId,
        saleId, receiptNo: str(sale.receiptNo),
        actorUid: identity.uid, actorEmail: authEmail, actorName,
        occurredAt: now, reason, deviceId, items: returnItemRecords, responseItems, value: returnedValue,
        dueAmount: nextDueAmount,
        returnedProductQuantities: nextProductReturned,
        returnedBatchQuantities: nextBatchReturned,
        refund: {
          method: paymentMethod, amount: refundAmount, status: refundStatus,
          ...(refundReference ? { reference: refundReference } : {}),
        },
        dueReduction, fingerprint,
      },
    });
    writes.push({
      path: auditPath,
      data: {
        id: `${saleId}__return__${requestId}`, eventType: 'SALE_RETURNED', branchId, saleId,
        receiptNo: str(sale.receiptNo), actorUid: identity.uid, actorEmail: authEmail,
        actorName, occurredAt: now, total: returnedValue, reason, deviceId, requestId,
        refundStatus, refundAmount, dueReduction,
      },
    });
    if (writes.length > MAX_WRITES) invalid('ဒီ Return ကို တစ်ကြိမ်တည်း လုပ်ရန် များလွန်းပါတယ်။');
    await fs.commit(transaction, writes);
    return {
      result: 'created', kind: 'return', returnId: requestId, occurredAt: now,
      value: returnedValue, refundStatus, refundAmount, dueReduction,
      dueAmount: nextDueAmount, returnedTotal: nextPayload.returnedTotal,
      returnedProductQuantities: nextProductReturned,
      returnedBatchQuantities: nextBatchReturned,
      items: responseItems,
      writeCount: writes.length,
    };
  } catch (error) {
    try { await fs.rollback(transaction); } catch { /* transaction may already be closed */ }
    throw error;
  }
}
