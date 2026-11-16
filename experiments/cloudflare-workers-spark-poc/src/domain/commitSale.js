import { failed, exhausted, invalid } from '../errors.js';
import {
  asArray, asRecord, near, num, str, normalizedCode, cleanQuantity, branchDay, limitedString,
  parseRequest, allocationsOf, MAX_WRITES, EPSILON,
} from './sale.js';
import {
  assertAllowanceBinding, assertCashierContext, assertOnlineSaleIsCurrent,
  assertReservationLedgerCovers, assertSaleAfterAllowanceIssuance, assertWithinAllowance,
  availableForSale, consumeRemaining, ledgerAfterConsumption, payloadOf, qtyOf,
  remainingOfAllowance, reservationLedgerOf,
} from './allowance.js';

function chunk(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

/**
 * Server-authoritative commit, mirroring functions/src/cashierUnitSale.ts.
 * All reads happen inside one Firestore transaction and every financial value is
 * rebuilt from Product / Price Group documents; the client receipt is only a
 * request.
 */
export async function commitSaleOnce({ fs, businessId, identity, body, serverNow }) {
  const parsed = parseRequest(body, identity, serverNow);
  const { branchId, sale, items, selectionsByItem, productDeltas, batchDeltas, batchProductIds, productsWithoutAllocations, fingerprint, offline } = parsed;

  const businessPath = `businesses/${businessId}`;
  const memberPath = `${businessPath}/members/${identity.uid}`;
  const branchPath = `${businessPath}/branches/${branchId}`;
  const salePath = `${branchPath}/sales/${str(sale.id)}`;
  const auditPath = `${branchPath}/auditEvents/${str(sale.id)}__created`;
  const metaPath = `${businessPath}/meta/settings`;
  const ledgerPath = `${branchPath}/meta/offlineStockReservations`;
  const allowancePath = offline ? `${branchPath}/offlineAllowances/${offline.allowanceId}` : '';
  const leasePath = offline ? `${branchPath}/authorizationLeases/${offline.leaseId}` : '';
  const serverDay = branchDay(serverNow);
  const now = serverNow.toISOString();

  const transaction = await fs.beginTransaction();
  try {
    const basePaths = [businessPath, memberPath, branchPath, salePath, auditPath, metaPath, ledgerPath];
    if (offline) basePaths.push(allowancePath, leasePath);
    const base = await fs.batchGet(basePaths, transaction);
    const saleSnapshot = base.get(salePath);
    // Exactly-once acknowledgement survives later membership, Branch, lease or allowance changes.
    if (saleSnapshot) {
      const existing = payloadOf(saleSnapshot) || {};
      if (existing.saleFingerprint === fingerprint && existing.createdByUid === identity.uid && existing.branchId === branchId) {
        await fs.rollback(transaction);
        return { result: 'already-committed', writeCount: 0 };
      }
      failed('Voucher ID တူနေသော်လည်း Cloud Sale အချက်အလက် မတူပါ။ Owner စစ်ဆေးရန် ရပ်ထားပါတယ်။');
    }
    if (base.get(auditPath)) failed('ဒီ Voucher အတွက် Audit Record ရှိပြီး Sale မတွေ့ပါ။ Owner စစ်ဆေးရန်လိုပါတယ်။');
    const ledger = reservationLedgerOf(base.get(ledgerPath));
    let allowance = null;
    let remaining = null;
    if (offline) {
      const bound = await assertAllowanceBinding({
        allowanceDoc: base.get(allowancePath),
        leaseDoc: base.get(leasePath),
        identity,
        businessId,
        branchId,
        deviceId: offline.deviceId,
        allowanceId: offline.allowanceId,
        leaseId: offline.leaseId,
        allowanceToken: offline.allowanceToken,
        serverNow,
      });
      allowance = bound.allowance;
      assertSaleAfterAllowanceIssuance(sale, allowance);
      remaining = remainingOfAllowance(allowance);
      assertReservationLedgerCovers(ledger, remaining);
      assertWithinAllowance(parsed, remaining);
    } else {
      assertOnlineSaleIsCurrent(sale, serverNow);
    }

    const { authEmail, actorName, branch: branchPayload } = assertCashierContext({
      businessDoc: base.get(businessPath),
      memberDoc: base.get(memberPath),
      branchDoc: base.get(branchPath),
      identity,
      branchId,
    });
    if (str(sale.paymentMethod) === 'KPay') {
      const settings = asRecord(branchPayload.settings) || {};
      if (!str(settings.kpayAccountName).trim() || !str(settings.kpayAccountNumber).trim()) {
        failed('ဒီ Branch တွင် KPay Account မသတ်မှတ်ရသေးပါ။');
      }
    }
    const metaPayload = payloadOf(base.get(metaPath));
    const businessSettings = asRecord(metaPayload?.settings) || metaPayload || {};
    const configuredDiscount = Number(businessSettings.maxCashierDiscountPercent ?? 10);
    const maxDiscountPercent = Number.isFinite(configuredDiscount)
      ? Math.max(0, Math.min(100, configuredDiscount))
      : 10;

    const productIds = [...productDeltas.keys()];
    const batchIds = [...batchDeltas.keys()];
    const productPaths = productIds.map((id) => `${branchPath}/products/${id}`);
    const batchPaths = batchIds.map((id) => `${branchPath}/stockBatches/${id}`);
    const inventory = await fs.batchGet([...productPaths, ...batchPaths], transaction);

    const productPayloads = new Map();
    const groupProductIds = new Map();
    const productWrites = [];
    for (const productId of productIds) {
      const snapshot = inventory.get(`${branchPath}/products/${productId}`);
      if (!snapshot || snapshot.data.deleted === true) failed(`Cloud Product မတွေ့ပါ: ${productId}`);
      const payload = payloadOf(snapshot);
      if (!payload || str(payload.branchId || branchId) !== branchId) failed(`Cloud Product Branch မကိုက်ညီပါ: ${productId}`);
      productPayloads.set(productId, payload);
      const quantity = productDeltas.get(productId) || 0;
      const currentStock = num(payload.stock);
      const ownReservation = offline ? qtyOf(remaining.byProduct, productId) : 0;
      const availableStock = availableForSale(currentStock, ledger.byProduct, productId, ownReservation);
      if (!Number.isFinite(currentStock) || availableStock + EPSILON < quantity) {
        failed(`Cloud Stock မလုံလောက်ပါ: ${str(payload.name || productId)} · Cloud ${currentStock} / Reserved ${qtyOf(ledger.byProduct, productId) - ownReservation} / ရောင်းရန် ${quantity}`);
      }
      const priceGroupId = str(payload.priceGroupId).trim();
      if (priceGroupId) {
        if (priceGroupId.includes('/') || priceGroupId.length > 200) failed(`Cloud Price Group ID မမှန်ပါ: ${productId}`);
        const previous = groupProductIds.get(priceGroupId);
        if (previous && previous !== productId) failed(`မျှဝေဈေးနှုန်း Group တစ်ခုကို Product နှစ်ခု ချိတ်ထားပါတယ်: ${priceGroupId}`);
        groupProductIds.set(priceGroupId, productId);
      }
      const nextStock = cleanQuantity(Math.max(0, currentStock - quantity), str(payload.quantityMode || 'whole') !== 'decimal');
      productWrites.push({
        path: `${branchPath}/products/${productId}`,
        data: { payload: { stock: nextStock }, updatedAt: now, updatedBy: identity.uid, sourceSaleId: str(sale.id) },
        mask: ['payload.stock', 'updatedAt', 'updatedBy', 'sourceSaleId'],
      });
    }

    const groupIds = [...groupProductIds.keys()];
    const groupPaths = groupIds.map((id) => `${businessPath}/shared/priceGroups/records/${id}`);
    const groupDocs = await fs.batchGet(groupPaths, transaction);
    const priceGroups = new Map();
    for (const groupId of groupIds) {
      const snapshot = groupDocs.get(`${businessPath}/shared/priceGroups/records/${groupId}`);
      const record = snapshot?.data || {};
      const payload = asRecord(record.payload);
      if (!snapshot || record.deleted === true || record.scope !== 'shared' || record.kind !== 'priceGroups'
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
      let trustedPrice;
      let trustedVersion;
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

    const batchWrites = [];
    for (const batchId of batchIds) {
      const snapshot = inventory.get(`${branchPath}/stockBatches/${batchId}`);
      const productId = batchProductIds.get(batchId);
      if (!snapshot || snapshot.data.deleted === true) failed(`Cloud Stock Batch မတွေ့ပါ: ${batchId}။ Owner က Batch စာရင်းကို စစ်ဆေးပါ။`);
      const record = snapshot.data || {};
      const payload = asRecord(record.payload);
      if (record.kind !== 'stockBatches' || record.branchId !== branchId || !payload || payload.productId !== productId) {
        failed(`Cloud Stock Batch Data မကိုက်ညီပါ: ${batchId}`);
      }
      const currentQuantity = num(payload.quantity);
      const deduction = batchDeltas.get(batchId) || 0;
      const ownReservation = offline ? qtyOf(remaining.byBatch, batchId) : 0;
      const availableQuantity = availableForSale(currentQuantity, ledger.byBatch, batchId, ownReservation);
      if (!Number.isFinite(currentQuantity) || availableQuantity + EPSILON < deduction) {
        failed(`Stock Batch လက်ကျန် မလုံလောက်ပါ: ${batchId}။ Offline Sale ကို Owner စစ်ဆေးရန်လိုပါတယ်။`);
      }
      const expiryDate = str(payload.expiryDate).trim();
      if (expiryDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) failed(`Stock Batch Expiry Date မမှန်ပါ: ${batchId}`);
        if (expiryDate < serverDay) {
          failed(`Server ရက်စွဲအရ Expiry ကျော်နေသော Batch ပါဝင်နေပါတယ်: ${batchId}။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
        }
      }
      batchWrites.push({
        path: `${branchPath}/stockBatches/${batchId}`,
        data: {
          payload: { quantity: cleanQuantity(Math.max(0, currentQuantity - deduction), str(productPayloads.get(productId)?.quantityMode || 'whole') !== 'decimal') },
          updatedAt: now,
          updatedBy: identity.uid,
          sourceSaleId: str(sale.id),
        },
        mask: ['payload.quantity', 'updatedAt', 'updatedBy', 'sourceSaleId'],
      });
    }

    const trackedProductIds = [...new Set(items
      .filter((item, index) => selectionsByItem[index].length > 0 || productPayloads.get(str(item.productId))?.tracksIndividualUnits === true)
      .map((item) => str(item.productId)))];
    const registryDocs = [];
    for (const group of chunk(trackedProductIds, 30)) {
      const docs = await fs.runQuery(`${branchPath}/stockUnitRegistries`, { fieldPath: 'payload.productId', op: 'IN', values: group }, transaction);
      for (const doc of docs) {
        if (doc.data.deleted === true || doc.data.branchId !== branchId) continue;
        const payload = asRecord(doc.data.payload);
        if (!payload) continue;
        registryDocs.push({ id: doc.path.split('/').pop(), payload, units: asArray(payload.units, 'Registry units') });
      }
    }
    const unitsByProduct = new Map();
    for (const registry of registryDocs) {
      const productId = str(registry.payload.productId);
      const list = unitsByProduct.get(productId) || [];
      registry.units.forEach((unit) => list.push({ registryId: registry.id, unit }));
      unitsByProduct.set(productId, list);
    }

    const seenUnitIds = new Set();
    const soldUnits = new Map();
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
      const allocatedByBatch = new Map();
      for (const allocation of allocationsOf(item)) {
        allocatedByBatch.set(allocation.batchId, (allocatedByBatch.get(allocation.batchId) || 0) + allocation.quantity);
      }
      const selectedByBatch = new Map();
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

    if (productsWithoutAllocations.size) {
      for (const group of chunk([...productsWithoutAllocations], 30)) {
        const docs = await fs.runQuery(`${branchPath}/stockBatches`, { fieldPath: 'payload.productId', op: 'IN', values: group }, transaction);
        for (const doc of docs) {
          if (doc.data.deleted === true || doc.data.branchId !== branchId) continue;
          const batchPayload = asRecord(doc.data.payload);
          if (!batchPayload || num(batchPayload.quantity) <= EPSILON) continue;
          failed(`Stock Batch ခွဲဝေမှု မပြည့်စုံပါ: ${str(batchPayload.productId)}။ Owner စစ်ဆေးရန်လိုပါတယ်။`);
        }
      }
    }

    let kpayReference = '';
    if (str(sale.paymentMethod) === 'KPay') {
      kpayReference = str(sale.kpayTransactionReference).trim();
      const referenceKey = kpayReference.toLowerCase();
      const keyDocs = await fs.runQuery(`${branchPath}/sales`, { fieldPath: 'payload.kpayReferenceKey', op: 'EQUAL', values: [referenceKey] }, transaction);
      const legacyDocs = await fs.runQuery(`${branchPath}/sales`, { fieldPath: 'payload.kpayTransactionReference', op: 'EQUAL', values: [kpayReference] }, transaction);
      if ([...keyDocs, ...legacyDocs].some((doc) => doc.path.split('/').pop() !== str(sale.id))) {
        failed('ဒီ KPay Transaction Reference ကို အရောင်းတစ်ခုမှာ အသုံးပြုပြီးသားဖြစ်ပါတယ်။ Owner စစ်ဆေးရန်လိုပါတယ်။');
      }
    }

    const customerId = str(sale.customerId).trim();
    const sharedCustomerPath = str(sale.paymentMethod) === 'Credit'
      ? `${businessPath}/shared/customers/records/${customerId}`
      : null;
    const customerDoc = sharedCustomerPath ? (await fs.batchGet([sharedCustomerPath], transaction)).get(sharedCustomerPath) : null;
    let existingCustomerPayload = null;
    if (customerDoc) {
      const record = customerDoc.data || {};
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
    let newCustomerPayload = null;
    if (sharedCustomerPath && !customerDoc) {
      const clientSnapshot = asRecord(sale.customerSnapshot);
      if (clientSnapshot && str(clientSnapshot.id) !== customerId) invalid('Customer Snapshot ID သည် Sale Customer ID နှင့် မကိုက်ညီပါ။');
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

    const registryWrites = [];
    for (const [registryId, units] of soldUnits) {
      const registry = registryDocs.find((entry) => entry.id === registryId);
      if (!registry) failed('Sticker Registry ပြောင်းလဲသွားပါတယ်။ Owner စစ်ဆေးရန်လိုပါတယ်။');
      const soldIds = new Set(units.map((entry) => entry.unitId));
      const nextUnits = registry.units.map((unit) => soldIds.has(str(unit.id))
        ? { ...unit, status: 'sold', saleId: str(sale.id), soldAt: now, soldByUid: identity.uid }
        : unit);
      registryWrites.push({
        path: `${branchPath}/stockUnitRegistries/${registryId}`,
        data: {
          payload: { ...registry.payload, units: nextUnits, updatedAt: now, updatedByUid: identity.uid },
          updatedAt: now,
          updatedBy: identity.uid,
          sourceSaleId: str(sale.id),
        },
        mask: ['payload.units', 'payload.updatedAt', 'payload.updatedByUid', 'updatedAt', 'updatedBy', 'sourceSaleId'],
      });
    }

    const nextRemaining = offline ? consumeRemaining(remaining, parsed) : null;
    const nextLedger = offline ? ledgerAfterConsumption(ledger, parsed) : null;
    const writeCount = productWrites.length + batchWrites.length + registryWrites.length + 2
      + (offline ? 2 : 0) + (newCustomerPayload ? 1 : 0);
    if (writeCount > MAX_WRITES) exhausted('ဒီဘောင်ချာမှာ Product / Batch အရေအတွက် များလွန်းနေပါတယ်။');

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
    const cloudPayload = {
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
      saleOrigin: offline ? 'offline-allowance' : 'online',
      ...(offline ? {
        offlineAllowanceId: offline.allowanceId,
        offlineLeaseId: offline.leaseId,
        deviceId: offline.deviceId,
      } : {}),
      serverReceivedAt: now,
      serverSaleDay: serverDay,
    };

    const writes = [
      ...productWrites.map((write) => ({
        path: write.path,
        data: { scope: 'branchRecord', kind: 'products', branchId, deleted: false, ...write.data },
        mask: write.mask,
      })),
      ...batchWrites.map((write) => ({
        path: write.path,
        data: { scope: 'branchRecord', kind: 'stockBatches', branchId, deleted: false, ...write.data },
        mask: write.mask,
      })),
      ...registryWrites.map((write) => ({
        path: write.path,
        data: { scope: 'branchRecord', kind: 'stockUnitRegistries', branchId, deleted: false, ...write.data },
        mask: write.mask,
      })),
      {
        path: salePath,
        data: { scope: 'branchRecord', kind: 'sales', branchId, deleted: false, updatedAt: now, updatedBy: identity.uid, payload: cloudPayload },
      },
    ];
    if (sharedCustomerPath && newCustomerPayload) {
      writes.push({
        path: sharedCustomerPath,
        data: { scope: 'shared', kind: 'customers', branchId, payload: newCustomerPayload, updatedAt: now, updatedBy: identity.uid, sourceSaleId: str(sale.id) },
      });
    }
    writes.push({
      path: auditPath,
      data: {
        id: `${str(sale.id)}__created`, eventType: 'SALE_CREATED', branchId, saleId: str(sale.id),
        receiptNo: str(sale.receiptNo), actorUid: identity.uid, actorEmail: authEmail,
        actorName, occurredAt: now, total: trustedTotal,
        saleOrigin: offline ? 'offline-allowance' : 'online',
        ...(offline ? { offlineAllowanceId: offline.allowanceId, deviceId: offline.deviceId } : {}),
      },
    });
    if (offline) {
      writes.push({
        path: allowancePath,
        data: {
          updatedAt: now,
          updatedBy: identity.uid,
          sourceSaleId: str(sale.id),
          payload: {
            remaining: nextRemaining.items,
            status: nextRemaining.exhausted ? 'consumed' : 'active',
            saleCount: Number(allowance.saleCount || 0) + 1,
            lastSaleId: str(sale.id),
            updatedAt: now,
            updatedBy: identity.uid,
          },
        },
        mask: [
          'payload.remaining', 'payload.status', 'payload.saleCount', 'payload.lastSaleId',
          'payload.updatedAt', 'payload.updatedBy', 'updatedAt', 'updatedBy', 'sourceSaleId',
        ],
      });
      writes.push({
        path: ledgerPath,
        data: {
          updatedAt: now,
          updatedBy: identity.uid,
          sourceSaleId: str(sale.id),
          payload: {
            byProduct: nextLedger.byProduct,
            byBatch: nextLedger.byBatch,
            updatedAt: now,
            updatedBy: identity.uid,
          },
        },
        mask: ['payload.byProduct', 'payload.byBatch', 'payload.updatedAt', 'payload.updatedBy', 'updatedAt', 'updatedBy', 'sourceSaleId'],
      });
    }

    await fs.commit(transaction, writes);
    return { result: 'created', writeCount };
  } catch (error) {
    await fs.rollback(transaction);
    throw error;
  }
}
