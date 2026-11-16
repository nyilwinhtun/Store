import { authorizationExpired, denied, failed, held, invalid } from '../errors.js';
import {
  DOC_ID_PATTERN, EPSILON, MAX_ITEMS, allocationsOf, asArray, asRecord, branchDay,
  num, str,
} from './sale.js';

export const AUTHORIZATION_LEASE_MS = 72 * 60 * 60 * 1000;
export const OFFLINE_STOCK_ALLOWANCE_MS = 24 * 60 * 60 * 1000;
export const ONLINE_COMMIT_MAX_AGE_MS = 10 * 60 * 1000;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ALLOWANCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const ALLOWANCE_BODY_FIELDS = new Set(['branchId', 'deviceId', 'items', 'leaseId']);
const ALLOWANCE_ITEM_FIELDS = new Set(['productId', 'quantity', 'batchAllocations']);

export function payloadOf(doc) {
  return doc && asRecord(doc.data?.payload);
}

export function parseIsoMs(value) {
  const parsed = Date.parse(str(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function isExpiredAt(expiresAt, serverNow) {
  const expiresMs = parseIsoMs(expiresAt);
  return !Number.isFinite(expiresMs) || serverNow.getTime() >= expiresMs;
}

export function qtyOf(map, id) {
  const value = map instanceof Map ? map.get(id) : map?.[id];
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function assertOnlyFields(record, allowed, label) {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalid(`${label} တွင် ခွင့်မပြုထားသော Field ပါဝင်နေပါတယ်: ${key}`);
  }
}

function assertPositiveQuantity(value, label) {
  const quantity = num(value);
  if (!Number.isFinite(quantity) || quantity <= 0) invalid(`${label} ပမာဏ မမှန်ကန်ပါ။`);
  return quantity;
}

/** Strict request parser: the server clock is the only issuance authority. */
export function parseAllowanceRequest(body) {
  const record = asRecord(body);
  if (!record) invalid('Allowance Request မမှန်ကန်ပါ။');
  assertOnlyFields(record, ALLOWANCE_BODY_FIELDS, 'Allowance Request');
  const branchId = str(record.branchId).trim();
  if (!branchId || !DOC_ID_PATTERN.test(branchId)) invalid('Branch ID မမှန်ကန်ပါ။');
  const deviceId = str(record.deviceId).trim();
  if (!DEVICE_ID_PATTERN.test(deviceId)) invalid('Device ID မမှန်ကန်ပါ။');
  const leaseId = str(record.leaseId).trim();
  if (leaseId && !DOC_ID_PATTERN.test(leaseId)) invalid('Authorization Lease ID မမှန်ကန်ပါ။');
  const rawItems = asArray(record.items, 'Allowance items');
  if (rawItems.length === 0 || rawItems.length > MAX_ITEMS) invalid('Allowance items အရေအတွက် မမှန်ကန်ပါ။');
  const seen = new Set();
  const items = rawItems.map((item, index) => {
    assertOnlyFields(item, ALLOWANCE_ITEM_FIELDS, `Allowance Item ${index + 1}`);
    const productId = str(item.productId).trim();
    if (!productId || !DOC_ID_PATTERN.test(productId)) invalid(`Allowance Item ${index + 1}: Product ID မမှန်ကန်ပါ။`);
    if (seen.has(productId)) invalid(`Allowance Item ${index + 1}: Product တစ်ခုတည်းကို နှစ်ကြိမ် ထည့်ထားပါတယ်။`);
    seen.add(productId);
    const quantity = assertPositiveQuantity(item.quantity, `Allowance Item ${index + 1}: Quantity`);
    const batchAllocations = allocationsOf(item);
    if (batchAllocations.length) {
      const allocated = batchAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
      if (Math.abs(allocated - quantity) > EPSILON) invalid(`Allowance Item ${index + 1}: Batch ခွဲဝေမှု မပြည့်စုံပါ။`);
    }
    return { productId, quantity, ...(batchAllocations.length ? { batchAllocations } : {}) };
  });
  return { branchId, deviceId, leaseId, items };
}

/**
 * Reuses an unexpired lease for the same Cashier / Business / Branch / Device.
 * The Worker clock alone decides whether the lease is still valid; an expired
 * lease is replaced by a fresh 72-hour lease only after this online request has
 * already passed the trusted authorization check.
 */
export function reusableLeaseOf({ leaseDoc, identity, businessId, branchId, deviceId, leaseId, serverNow }) {
  if (!leaseDoc) return null;
  const record = leaseDoc.data || {};
  const lease = asRecord(record.payload);
  if (!lease || record.kind !== 'authorizationLeases' || record.branchId !== branchId
    || record.deleted === true || str(lease.id) !== leaseId) {
    failed('Authorization Lease Data မမှန်ကန်ပါ။');
  }
  if (str(lease.businessId) !== businessId || str(lease.branchId) !== branchId
    || str(lease.uid) !== identity.uid || str(lease.deviceId) !== deviceId) {
    denied('Authorization Lease သည် ဒီ Cashier / Branch / Device အတွက် မဟုတ်ပါ။');
  }
  const issuedMs = parseIsoMs(lease.issuedAt);
  const expiresMs = parseIsoMs(lease.expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)
    || expiresMs - issuedMs !== AUTHORIZATION_LEASE_MS) {
    failed('Authorization Lease သက်တမ်း Data မမှန်ကန်ပါ။');
  }
  if (lease.status !== 'active' || serverNow.getTime() >= expiresMs) return null;
  return lease;
}

export function assertCashierContext({ businessDoc, memberDoc, branchDoc, identity, branchId }) {
  const business = businessDoc?.data;
  if (!business || business.active === false) failed('Minimart Business မရရှိနိုင်ပါ။');
  if (!memberDoc) denied('Cashier Membership မတွေ့ပါ။');
  const member = memberDoc.data || {};
  const authEmail = identity.email.trim().toLowerCase();
  const branchIds = Array.isArray(member.branchIds) ? member.branchIds : [];
  if (member.uid !== identity.uid || member.role !== 'cashier' || member.status !== 'active'
    || str(member.email).trim().toLowerCase() !== authEmail || !authEmail
    || branchIds.length !== 1 || branchIds[0] !== branchId) {
    denied('ဒီ Branch အတွက် Active Cashier ခွင့်မရှိပါ။');
  }
  if (!branchDoc) failed('Branch မတွေ့ပါ။');
  const branch = payloadOf(branchDoc) || {};
  if (branch.status !== 'active') denied('Branch သည် Active မဟုတ်ပါ။');
  return {
    authEmail,
    actorName: identity.name || authEmail || 'Cashier',
    member,
    branch,
  };
}

export function reservationLedgerOf(doc) {
  const payload = payloadOf(doc);
  const clean = (source, label) => {
    const record = asRecord(source) || {};
    const result = {};
    for (const [key, value] of Object.entries(record)) {
      if (!DOC_ID_PATTERN.test(key)) failed(`${label} တွင် မမှန်ကန်သော ID ပါဝင်နေပါတယ်။`);
      const quantity = num(value);
      if (!Number.isFinite(quantity) || quantity < 0) failed(`${label} ပမာဏ မမှန်ကန်ပါ။`);
      if (quantity > EPSILON) result[key] = quantity;
    }
    return result;
  };
  return {
    byProduct: clean(payload?.byProduct, 'Product Reservation'),
    byBatch: clean(payload?.byBatch, 'Batch Reservation'),
  };
}

export function remainingOfAllowance(payload) {
  const items = asArray(payload?.remaining, 'Allowance remaining');
  const byProduct = new Map();
  const byBatch = new Map();
  const normalized = items.map((item, index) => {
    const productId = str(item.productId).trim();
    if (!productId || !DOC_ID_PATTERN.test(productId) || byProduct.has(productId)) {
      failed(`Allowance Remaining ${index + 1} မမှန်ကန်ပါ။`);
    }
    const quantity = num(item.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) failed(`Allowance Remaining ${index + 1} မမှန်ကန်ပါ။`);
    byProduct.set(productId, quantity);
    const batchAllocations = allocationsOf(item);
    for (const allocation of batchAllocations) {
      const previous = byBatch.get(allocation.batchId) || 0;
      byBatch.set(allocation.batchId, previous + allocation.quantity);
    }
    return { productId, quantity, ...(batchAllocations.length ? { batchAllocations } : {}) };
  });
  return { items: normalized.filter((item) => item.quantity > EPSILON), byProduct, byBatch };
}

export function assertReservationLedgerCovers(ledger, remaining) {
  for (const [productId, quantity] of remaining.byProduct) {
    if (qtyOf(ledger.byProduct, productId) + EPSILON < quantity) {
      failed(`Offline Reservation နှင့် Stock Ledger မကိုက်ညီပါ: ${productId}။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
    }
  }
  for (const [batchId, quantity] of remaining.byBatch) {
    if (qtyOf(ledger.byBatch, batchId) + EPSILON < quantity) {
      failed(`Offline Reservation နှင့် Batch Ledger မကိုက်ညီပါ: ${batchId}။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
    }
  }
}

export function assertWithinAllowance(parsed, remaining) {
  for (const [productId, quantity] of parsed.productDeltas) {
    if (qtyOf(remaining.byProduct, productId) + EPSILON < quantity) {
      held(`Offline Stock Allowance ထဲတွင် ${productId} အတွက် လုံလောက်သော ခွင့်ပြုပမာဏ မရှိပါ။`);
    }
  }
  for (const [batchId, quantity] of parsed.batchDeltas) {
    if (qtyOf(remaining.byBatch, batchId) + EPSILON < quantity) {
      held(`Offline Stock Allowance ထဲတွင် Batch ${batchId} အတွက် လုံလောက်သော ခွင့်ပြုပမာဏ မရှိပါ။`);
    }
  }
}

export function consumeRemaining(remaining, parsed) {
  const nextItems = [];
  const nextByProduct = new Map();
  const nextByBatch = new Map();
  for (const item of remaining.items) {
    const usedProduct = parsed.productDeltas.get(item.productId) || 0;
    const nextQuantity = item.quantity - usedProduct;
    if (nextQuantity < -EPSILON) held(`Offline Stock Allowance ပမာဏ ကျော်လွန်နေပါတယ်: ${item.productId}`);
    const allocations = (item.batchAllocations || []).map((allocation) => {
      const usedBatch = parsed.batchDeltas.get(allocation.batchId) || 0;
      const quantity = allocation.quantity - usedBatch;
      if (quantity < -EPSILON) held(`Offline Stock Allowance Batch ပမာဏ ကျော်လွန်နေပါတယ်: ${allocation.batchId}`);
      return { batchId: allocation.batchId, quantity };
    });
    if (nextQuantity > EPSILON) {
      nextByProduct.set(item.productId, nextQuantity);
      nextItems.push({
        productId: item.productId,
        quantity: nextQuantity,
        ...(allocations.length ? { batchAllocations: allocations.filter((entry) => entry.quantity > EPSILON) } : {}),
      });
    }
    for (const allocation of allocations) {
      if (allocation.quantity > EPSILON) {
        nextByBatch.set(allocation.batchId, (nextByBatch.get(allocation.batchId) || 0) + allocation.quantity);
      }
    }
  }
  return {
    items: nextItems,
    byProduct: nextByProduct,
    byBatch: nextByBatch,
    exhausted: nextItems.length === 0,
  };
}

export function ledgerAfterConsumption(ledger, parsed) {
  const nextByProduct = { ...ledger.byProduct };
  const nextByBatch = { ...ledger.byBatch };
  for (const [productId, quantity] of parsed.productDeltas) {
    const next = (nextByProduct[productId] || 0) - quantity;
    if (next < -EPSILON) failed(`Stock Reservation Ledger မမှန်ပါ: ${productId}`);
    if (next > EPSILON) nextByProduct[productId] = next;
    else delete nextByProduct[productId];
  }
  for (const [batchId, quantity] of parsed.batchDeltas) {
    const next = (nextByBatch[batchId] || 0) - quantity;
    if (next < -EPSILON) failed(`Batch Reservation Ledger မမှန်ပါ: ${batchId}`);
    if (next > EPSILON) nextByBatch[batchId] = next;
    else delete nextByBatch[batchId];
  }
  return { byProduct: nextByProduct, byBatch: nextByBatch };
}

export function availableForSale(currentStock, reservedMap, id, ownReservation = 0) {
  const reserved = qtyOf(reservedMap, id);
  const own = Number(ownReservation);
  return num(currentStock) - reserved + (Number.isFinite(own) && own > 0 ? own : 0);
}

export async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let binary = '';
  const bytes = new Uint8Array(digest);
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomBase64Url(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function safeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Validates the trusted allowance and lease records. Client-supplied timestamps
 * are never accepted; both expiries were written by the Worker from its clock.
 */
export async function assertAllowanceBinding({
  allowanceDoc, leaseDoc, identity, businessId, branchId, deviceId,
  allowanceId, leaseId, allowanceToken, serverNow,
}) {
  if (!allowanceDoc) held('Server-issued Offline Stock Allowance မတွေ့ပါ။ ပြန် Online ဖြစ်ပြီး Allowance အသစ် ယူပါ။');
  const record = allowanceDoc.data || {};
  const allowance = asRecord(record.payload);
  if (record.kind !== 'offlineAllowances' || record.branchId !== branchId || record.deleted === true
    || !allowance || str(allowance.id) !== allowanceId) {
    failed('Offline Stock Allowance Data မမှန်ကန်ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
  }
  if (!ALLOWANCE_TOKEN_PATTERN.test(allowanceToken)) denied('Offline Stock Allowance Token မမှန်ကန်ပါ။');
  const tokenHash = await sha256Base64Url(allowanceToken);
  if (!safeEqual(tokenHash, str(allowance.tokenHash))) denied('Offline Stock Allowance Token မကိုက်ညီပါ။');
  if (str(allowance.businessId) !== businessId || str(allowance.branchId) !== branchId
    || str(allowance.uid) !== identity.uid || str(allowance.deviceId) !== deviceId
    || str(allowance.leaseId) !== leaseId) {
    denied('Offline Stock Allowance သည် ဒီ Cashier / Branch / Device အတွက် မဟုတ်ပါ။');
  }
  const issuedMs = parseIsoMs(allowance.issuedAt);
  const expiresMs = parseIsoMs(allowance.expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)
    || expiresMs - issuedMs !== OFFLINE_STOCK_ALLOWANCE_MS) {
    failed('Offline Stock Allowance သက်တမ်း Data မမှန်ကန်ပါ။');
  }
  if (allowance.status === 'expired-hold') held('Offline Stock Allowance သက်တမ်း ကုန်ဆုံးပြီး Stock ကို Owner စစ်ဆေးရန် ထိန်းထားပါတယ်။');
  if (allowance.status === 'consumed') held('Offline Stock Allowance ကို အသုံးပြုပြီးသားဖြစ်ပါတယ်။');
  if (allowance.status !== 'active') held('Offline Stock Allowance ကို အသုံးပြုနိုင်သော အခြေအနေမှာ မရှိပါ။');
  if (serverNow.getTime() >= expiresMs) {
    held('Offline Stock Allowance သက်တမ်း 24 နာရီ ကျော်သွားပါပြီ။ Stock ကို အလိုအလျောက် မပြန်လွှတ်ပါ။');
  }

  if (!leaseDoc) authorizationExpired('Server-issued Authorization Lease မတွေ့ပါ။ ပြန် Login လုပ်ပါ။');
  const leaseRecord = leaseDoc.data || {};
  const lease = asRecord(leaseRecord.payload);
  if (leaseRecord.kind !== 'authorizationLeases' || leaseRecord.branchId !== branchId
    || leaseRecord.deleted === true || !lease || str(lease.id) !== leaseId) {
    authorizationExpired('Authorization Lease Data မမှန်ကန်ပါ။ ပြန် Login လုပ်ပါ။');
  }
  if (str(lease.businessId) !== businessId || str(lease.branchId) !== branchId
    || str(lease.uid) !== identity.uid || str(lease.deviceId) !== deviceId) {
    denied('Authorization Lease သည် ဒီ Cashier / Branch / Device အတွက် မဟုတ်ပါ။');
  }
  const leaseIssuedMs = parseIsoMs(lease.issuedAt);
  const leaseExpiresMs = parseIsoMs(lease.expiresAt);
  if (!Number.isFinite(leaseIssuedMs) || !Number.isFinite(leaseExpiresMs)
    || leaseExpiresMs - leaseIssuedMs !== AUTHORIZATION_LEASE_MS || leaseIssuedMs > issuedMs) {
    authorizationExpired('Authorization Lease သက်တမ်း Data မမှန်ကန်ပါ။ ပြန် Login လုပ်ပါ။');
  }
  if (lease.status !== 'active' || serverNow.getTime() >= leaseExpiresMs) {
    authorizationExpired('Authorization သက်တမ်း 72 နာရီ ကျော်သွားပါပြီ။ ပြန် Login လုပ်ပါ။');
  }
  return { allowance, lease };
}

export function assertOnlineSaleIsCurrent(sale, serverNow) {
  const saleTime = Date.parse(str(sale.date));
  if (!Number.isFinite(saleTime)) invalid('Sale Date မမှန်ကန်ပါ။');
  if (serverNow.getTime() - saleTime > ONLINE_COMMIT_MAX_AGE_MS) {
    invalid('Offline Sale အတွက် Server-issued Offline Stock Allowance မပါပါ။ ပြန် Online ဖြစ်ပြီး Allowance အသစ် ယူပါ။');
  }
}

export function assertSaleAfterAllowanceIssuance(sale, allowance) {
  const saleTime = Date.parse(str(sale.date));
  const issuedMs = parseIsoMs(allowance.issuedAt);
  if (!Number.isFinite(saleTime) || !Number.isFinite(issuedMs)
    || saleTime < issuedMs - ONLINE_COMMIT_MAX_AGE_MS) {
    invalid('Sale Date သည် Server-issued Allowance မတိုင်မီ ဖြစ်နေပါတယ်။ Owner စစ်ဆေးရန်လိုပါတယ်။');
  }
}

export async function issueOfflineAllowance({ fs, businessId, identity, body, serverNow }) {
  const { branchId, deviceId, leaseId: requestedLeaseId, items } = parseAllowanceRequest(body);
  const businessPath = `businesses/${businessId}`;
  const memberPath = `${businessPath}/members/${identity.uid}`;
  const branchPath = `${businessPath}/branches/${branchId}`;
  const ledgerPath = `${branchPath}/meta/offlineStockReservations`;
  const allowanceId = `allowance-${crypto.randomUUID()}`;
  const leaseId = `lease-${crypto.randomUUID()}`;
  const allowanceToken = randomBase64Url(32);
  const tokenHash = await sha256Base64Url(allowanceToken);
  const issuedAt = serverNow.toISOString();
  const expiresAt = new Date(serverNow.getTime() + OFFLINE_STOCK_ALLOWANCE_MS).toISOString();
  const leaseExpiresAt = new Date(serverNow.getTime() + AUTHORIZATION_LEASE_MS).toISOString();
  const allowancePath = `${branchPath}/offlineAllowances/${allowanceId}`;
  const leasePath = `${branchPath}/authorizationLeases/${leaseId}`;
  const requestedLeasePath = requestedLeaseId ? `${branchPath}/authorizationLeases/${requestedLeaseId}` : '';
  const auditPath = `${branchPath}/auditEvents/${allowanceId}__issued`;

  const transaction = await fs.beginTransaction();
  try {
    const base = await fs.batchGet(
      [businessPath, memberPath, branchPath, ledgerPath, ...(requestedLeasePath ? [requestedLeasePath] : [])],
      transaction,
    );
    const { authEmail, actorName } = assertCashierContext({
      businessDoc: base.get(businessPath),
      memberDoc: base.get(memberPath),
      branchDoc: base.get(branchPath),
      identity,
      branchId,
    });
    const ledger = reservationLedgerOf(base.get(ledgerPath));

    const productIds = items.map((item) => item.productId);
    const batchIds = [...new Set(items.flatMap((item) => (item.batchAllocations || []).map((allocation) => allocation.batchId)))];
    const productPaths = productIds.map((id) => `${branchPath}/products/${id}`);
    const batchPaths = batchIds.map((id) => `${branchPath}/stockBatches/${id}`);
    const inventory = await fs.batchGet([...productPaths, ...batchPaths], transaction);
    const nextByProduct = { ...ledger.byProduct };
    const nextByBatch = { ...ledger.byBatch };
    const serverDay = branchDay(serverNow);

    for (const item of items) {
      const productPath = `${branchPath}/products/${item.productId}`;
      const snapshot = inventory.get(productPath);
      const product = payloadOf(snapshot);
      if (!snapshot || snapshot.data.deleted === true || !product) {
        failed(`Cloud Product မတွေ့ပါ: ${item.productId}`);
      }
      if (str(product.branchId || branchId) !== branchId) failed(`Cloud Product Branch မကိုက်ညီပါ: ${item.productId}`);
      if (str(product.quantityMode || 'whole') !== 'decimal' && !Number.isInteger(item.quantity)) {
        invalid(`ပြည့်ကိန်းယူနစ် Product အတွက် ပမာဏ ပြည့်ကိန်း ဖြစ်ရပါမည်: ${item.productId}`);
      }
      const currentStock = num(product.stock);
      if (!Number.isFinite(currentStock)) failed(`Cloud Stock မမှန်ပါ: ${item.productId}`);
      if (availableForSale(currentStock, nextByProduct, item.productId) + EPSILON < item.quantity) {
        failed(`Cloud Stock မလုံလောက်ပါ: ${str(product.name || item.productId)} · လက်ကျန် ${currentStock} / Reserved ${qtyOf(nextByProduct, item.productId)} / တောင်းခံ ${item.quantity}`);
      }
      nextByProduct[item.productId] = (nextByProduct[item.productId] || 0) + item.quantity;

      for (const allocation of item.batchAllocations || []) {
        const batchPath = `${branchPath}/stockBatches/${allocation.batchId}`;
        const batchSnapshot = inventory.get(batchPath);
        const record = batchSnapshot?.data || {};
        const batch = asRecord(record.payload);
        if (!batchSnapshot || record.deleted === true || !batch || record.kind !== 'stockBatches'
          || record.branchId !== branchId || str(batch.productId) !== item.productId) {
          failed(`Cloud Stock Batch မကိုက်ညီပါ: ${allocation.batchId}`);
        }
        const batchQuantity = num(batch.quantity);
        if (!Number.isFinite(batchQuantity)) failed(`Stock Batch လက်ကျန် မမှန်ပါ: ${allocation.batchId}`);
        if (availableForSale(batchQuantity, nextByBatch, allocation.batchId) + EPSILON < allocation.quantity) {
          failed(`Stock Batch လက်ကျန် မလုံလောက်ပါ: ${allocation.batchId}`);
        }
        const expiryDate = str(batch.expiryDate).trim();
        if (expiryDate) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) failed(`Stock Batch Expiry Date မမှန်ပါ: ${allocation.batchId}`);
          if (expiryDate < serverDay) failed(`Server ရက်စွဲအရ Expiry ကျော်နေသော Batch ပါဝင်နေပါတယ်: ${allocation.batchId}`);
        }
        nextByBatch[allocation.batchId] = (nextByBatch[allocation.batchId] || 0) + allocation.quantity;
      }
    }

    const reusableLease = requestedLeaseId
      ? reusableLeaseOf({
        leaseDoc: base.get(requestedLeasePath),
        identity, businessId, branchId, deviceId, leaseId: requestedLeaseId, serverNow,
      })
      : null;
    const finalLeaseId = reusableLease ? requestedLeaseId : leaseId;
    const finalLeaseExpiresAt = reusableLease ? reusableLease.expiresAt : leaseExpiresAt;
    const allowancePayload = {
      id: allowanceId,
      businessId,
      branchId,
      uid: identity.uid,
      email: authEmail,
      deviceId,
      leaseId: finalLeaseId,
      issuedAt,
      expiresAt,
      status: 'active',
      items,
      remaining: items,
      tokenHash,
      saleCount: 0,
      updatedAt: issuedAt,
      updatedBy: identity.uid,
    };
    const leasePayload = {
      id: leaseId,
      businessId,
      branchId,
      uid: identity.uid,
      email: authEmail,
      deviceId,
      issuedAt,
      expiresAt: leaseExpiresAt,
      status: 'active',
      verifiedAt: issuedAt,
      authTime: Number.isFinite(Number(identity.authTime)) ? Number(identity.authTime) : null,
    };
    const ledgerPayload = { byProduct: nextByProduct, byBatch: nextByBatch, updatedAt: issuedAt, updatedBy: identity.uid };

    const writes = [
      {
        path: allowancePath,
        data: {
          scope: 'branchRecord', kind: 'offlineAllowances', branchId, deleted: false,
          createdAt: issuedAt, createdBy: identity.uid, updatedAt: issuedAt, updatedBy: identity.uid,
          payload: allowancePayload,
        },
      },
      {
        path: ledgerPath,
        data: {
          scope: 'branchRecord', kind: 'offlineStockReservations', branchId, deleted: false,
          updatedAt: issuedAt, updatedBy: identity.uid, payload: ledgerPayload,
        },
      },
      {
        path: auditPath,
        data: {
          id: `${allowanceId}__issued`, eventType: 'OFFLINE_ALLOWANCE_ISSUED', branchId,
          allowanceId, leaseId: finalLeaseId, actorUid: identity.uid, actorEmail: authEmail, actorName,
          deviceId, occurredAt: issuedAt, expiresAt, items,
        },
      },
    ];
    if (!reusableLease) {
      writes.splice(1, 0, {
        path: leasePath,
        data: {
          scope: 'branchRecord', kind: 'authorizationLeases', branchId, deleted: false,
          createdAt: issuedAt, createdBy: identity.uid, updatedAt: issuedAt, updatedBy: identity.uid,
          payload: leasePayload,
        },
      });
    }

    await fs.commit(transaction, writes);
    return {
      allowanceId,
      leaseId: finalLeaseId,
      allowanceToken,
      issuedAt,
      expiresAt,
      leaseExpiresAt: finalLeaseExpiresAt,
      deviceId,
      items,
      writeCount: writes.length,
    };
  } catch (error) {
    await fs.rollback(transaction);
    throw error;
  }
}
