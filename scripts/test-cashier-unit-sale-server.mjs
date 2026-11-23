/**
 * Emulator-only regression test for the server-authoritative Cashier unit sale.
 * Requires the staging emulators to be running (defaults:
 * auth 127.0.0.1:9099 · firestore 127.0.0.1:8099 · functions 127.0.0.1:5001).
 * Ports can be overridden with QA_FIRESTORE_PORT / QA_AUTH_PORT / QA_FUNCTIONS_PORT.
 * Project: demo-minimart-staging. Never points at production.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'demo-minimart-staging';
const BUSINESS_ID = 'store-mini-main';
const REGION = 'asia-southeast1';
const BRANCH_ID = 'branch-qa-unit-sale';
const CASHIER_UID = 'qa-unit-sale-cashier';
const CASHIER_EMAIL = 'qa.unit.sale@demo.minimart.test';
const FIRESTORE_PORT = process.env.QA_FIRESTORE_PORT || '8099';
const AUTH_PORT = process.env.QA_AUTH_PORT || '9099';
const FUNCTIONS_PORT = process.env.QA_FUNCTIONS_PORT || '5001';
const FUNCTION_URL = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/${REGION}/completeCashierUnitSale`;

process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${AUTH_PORT}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const require = createRequire(resolve(root, 'functions/package.json'));
const admin = require('firebase-admin');
const app = admin.initializeApp({ projectId: PROJECT_ID }, 'qa-unit-sale');
const auth = admin.auth(app);
const db = admin.firestore(app);
const businessRef = db.doc(`businesses/${BUSINESS_ID}`);
const branchRef = businessRef.collection('branches').doc(BRANCH_ID);

const NOW = new Date().toISOString();
const PRODUCT_ID = 'qa-product-unit';
const CANDY_ID = 'qa-product-candy';
const LEGACY_ID = 'qa-product-legacy';
const BATCHED_ID = 'qa-product-batched';
const REGISTRY_ID = 'unit-registry-qa-unit-0';
const BATCH_A = 'qa-batch-a';
const BATCH_B = 'qa-batch-b';
const CUSTOMER_ID = 'qa-customer-credit';
const PRICE_GROUP_ID = 'qa-price-group';

const results = [];
function pass(name) {
  results.push(name);
  console.log(`ok - ${name}`);
}

function branchPayload(settings = {}) {
  return {
    id: BRANCH_ID, name: 'QA Unit Sale Branch', code: 'QA-US',
    address: '', phone: '', status: 'active', isDefault: false,
    createdAt: NOW, updatedAt: NOW,
    settings: {
      storeName: 'QA Store', currency: 'MMK', kpayEnabled: true,
      kpayAccountName: 'QA KPay Account', kpayAccountNumber: '09123456789',
      ...settings,
    },
  };
}

function productPayload(id, patch = {}) {
  return {
    id, branchId: BRANCH_ID, name: id, sku: `SKU-${id}`, barcode: '', category: 'QA',
    costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400, stock: 0, lowStockAt: 1,
    unit: 'ခု', quantityMode: 'whole', createdAt: NOW, ...patch,
  };
}

function unit(index, batchId) {
  return {
    id: `qa-unit-${index}`, barcode: `QA-STICKER-${String(index).padStart(4, '0')}`,
    barcodeSource: 'purchased_sticker', status: 'in_stock', registeredAt: NOW,
    ...(batchId ? { batchId } : {}),
  };
}

function batch(id, quantity, productId = PRODUCT_ID, expiryDate = '2027-12-31') {
  return { id, branchId: BRANCH_ID, productId, purchaseId: '', supplierId: '', quantity, receivedAt: NOW, expiryDate, unitCost: 1000 };
}

async function wipeBranch() {
  const collections = await branchRef.listCollections();
  for (const collection of collections) {
    const docs = await collection.listDocuments();
    for (let index = 0; index < docs.length; index += 400) {
      const batchWrite = db.batch();
      docs.slice(index, index + 400).forEach((doc) => batchWrite.delete(doc));
      await batchWrite.commit();
    }
  }
}

async function resetInventory({ stock = 5, batchA = 3, batchB = 2, units = [unit(1, BATCH_A), unit(2, BATCH_A), unit(3, BATCH_A), unit(4, BATCH_B), unit(5, BATCH_B)] } = {}) {
  await wipeBranch();
  await branchRef.set({
    scope: 'branch', kind: 'branches', branchId: BRANCH_ID, id: BRANCH_ID,
    deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: branchPayload(),
  });
  await branchRef.collection('products').doc(PRODUCT_ID).set({
    scope: 'branchRecord', kind: 'products', branchId: BRANCH_ID, deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: productPayload(PRODUCT_ID, {
      name: 'QA Unit Bottle', sku: 'QA-UNIT-1', retailPrice: 1500, wholesalePrice: 1400,
      stock, tracksIndividualUnits: true,
    }),
  });
  await branchRef.collection('products').doc(CANDY_ID).set({
    scope: 'branchRecord', kind: 'products', branchId: BRANCH_ID, deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: productPayload(CANDY_ID, { name: 'QA Candy', sku: 'QA-CANDY-1', barcode: '9900000000011', retailPrice: 500, stock: 10, tracksIndividualUnits: false }),
  });
  if (batchA > 0) {
    await branchRef.collection('stockBatches').doc(BATCH_A).set({
      scope: 'branchRecord', kind: 'stockBatches', branchId: BRANCH_ID, deleted: false, updatedAt: NOW, updatedBy: 'qa',
      payload: batch(BATCH_A, batchA),
    });
  }
  if (batchB > 0) {
    await branchRef.collection('stockBatches').doc(BATCH_B).set({
      scope: 'branchRecord', kind: 'stockBatches', branchId: BRANCH_ID, deleted: false, updatedAt: NOW, updatedBy: 'qa',
      payload: batch(BATCH_B, batchB),
    });
  }
  await branchRef.collection('stockUnitRegistries').doc(REGISTRY_ID).set({
    scope: 'branchRecord', kind: 'stockUnitRegistries', branchId: BRANCH_ID, deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: { id: REGISTRY_ID, branchId: BRANCH_ID, productId: PRODUCT_ID, chunkIndex: 0, units, updatedAt: NOW },
  });
}

function selection(unitIndex) {
  const batchId = unitIndex <= 3 ? BATCH_A : BATCH_B;
  return {
    registryId: REGISTRY_ID, unitId: `qa-unit-${unitIndex}`,
    barcode: `QA-STICKER-${String(unitIndex).padStart(4, '0')}`, batchId,
  };
}

function trackedItem(unitIndexes) {
  const allocations = new Map();
  unitIndexes.forEach((index) => {
    const batchId = index <= 3 ? BATCH_A : BATCH_B;
    allocations.set(batchId, (allocations.get(batchId) || 0) + 1);
  });
  return {
    productId: PRODUCT_ID, name: 'QA Unit Bottle', sku: 'QA-UNIT-1',
    quantity: unitIndexes.length, unitPrice: 1500, costPrice: 1000, mode: 'retail', unit: 'ခု', quantityMode: 'whole',
    batchAllocations: [...allocations].map(([batchId, quantity]) => ({ batchId, quantity })),
    stockUnitSelections: unitIndexes.map(selection),
  };
}

function plainItem(productId, quantity, patch = {}) {
  return {
    productId, name: productId, sku: `SKU-${productId}`,
    quantity, unitPrice: 1500, costPrice: 1000, mode: 'retail', unit: 'ခု', quantityMode: 'whole',
    ...patch,
  };
}

function salePayload({ id, items, paymentMethod = 'Cash', discount = 0, patch = {} }) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const itemCost = items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);
  const total = subtotal - discount;
  const base = {
    id, branchId: BRANCH_ID, receiptNo: `QA-${id}`, date: NOW, customer: 'Walk-in',
    paymentMethod, items, subtotal, discount, total, profit: subtotal - itemCost - discount, status: 'completed',
    createdByUid: CASHIER_UID, createdByEmail: CASHIER_EMAIL, createdByName: 'QA Cashier',
  };
  if (paymentMethod === 'Cash') {
    base.cashReceivedAmount = total;
    base.changeAmount = 0;
    base.paidAmount = total;
    base.dueAmount = 0;
  } else if (paymentMethod === 'KPay') {
    base.kpayTransactionReference = 'QA-KPAY-REF1';
    base.kpayAccountNameSnapshot = 'QA KPay Account';
    base.kpayAccountNumberSnapshot = '09123456789';
    base.kpayAccountLabelSnapshot = 'Main';
    base.paidAmount = total;
    base.dueAmount = 0;
  } else {
    base.paidAmount = 0;
    base.dueAmount = total;
  }
  return { ...base, ...patch };
}

let idToken = '';
async function call(data) {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, result: json.result, error: json.error };
}

function assertOk(response, label) {
  assert.equal(response.error, undefined, `${label}: unexpected error ${JSON.stringify(response.error)}`);
  assert.ok(response.result, `${label}: missing result`);
  return response.result;
}

function assertError(response, code, label, pattern) {
  assert.ok(response.error, `${label}: expected error but got ${JSON.stringify(response.result)}`);
  assert.equal(response.error.status, code, `${label}: expected ${code}, got ${JSON.stringify(response.error)}`);
  if (pattern) assert.match(String(response.error.message), pattern, label);
}

async function readProduct(id = PRODUCT_ID) {
  return (await branchRef.collection('products').doc(id).get()).data().payload;
}
async function readBatch(id) {
  return (await branchRef.collection('stockBatches').doc(id).get()).data().payload;
}
async function readUnits() {
  return (await branchRef.collection('stockUnitRegistries').doc(REGISTRY_ID).get()).data().payload.units;
}
async function saleExists(id) {
  return (await branchRef.collection('sales').doc(id).get()).exists;
}
async function auditExists(id) {
  return (await branchRef.collection('auditEvents').doc(`${id}__created`).get()).exists;
}

async function prepare() {
  await wipeBranch();
  await businessRef.set({ active: true }, { merge: true });
  await businessRef.collection('meta').doc('settings').set({
    payload: { settings: { maxCashierDiscountPercent: 10 } },
  });
  await businessRef.collection('members').doc(CASHIER_UID).set({
    uid: CASHIER_UID, email: CASHIER_EMAIL, displayName: 'QA Cashier',
    role: 'cashier', status: 'active', branchIds: [BRANCH_ID],
    createdAt: NOW, updatedAt: NOW, createdBy: 'qa', canReceiveStock: false,
  });
  try { await auth.deleteUser(CASHIER_UID); } catch { /* not created yet */ }
  await auth.createUser({ uid: CASHIER_UID, email: CASHIER_EMAIL, displayName: 'QA Cashier' });
  const customToken = await auth.createCustomToken(CASHIER_UID);
  const signInResponse = await fetch(
    `http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) },
  );
  const signIn = await signInResponse.json();
  assert.ok(signIn.idToken, `custom token sign-in failed: ${JSON.stringify(signIn)}`);
  idToken = signIn.idToken;
}

async function cleanup() {
  try { await wipeBranch(); } catch { /* emulator may be stopped */ }
  try { await branchRef.delete(); } catch { /* already gone */ }
  try { await businessRef.collection('members').doc(CASHIER_UID).delete(); } catch { /* already gone */ }
  try { await businessRef.collection('shared').doc('customers').collection('records').doc(CUSTOMER_ID).delete(); } catch { /* none */ }
  try { await businessRef.collection('shared').doc('priceGroups').collection('records').doc(PRICE_GROUP_ID).delete(); } catch { /* none */ }
  try { await businessRef.collection('meta').doc('settings').delete(); } catch { /* none */ }
  try { await auth.deleteUser(CASHIER_UID); } catch { /* already gone */ }
}

async function main() {
  await prepare();

  // 1. Cash sale marks exactly the scanned units sold, deducts Product + Batch + writes audit.
  await resetInventory();
  const cashSale = salePayload({ id: 'qa-sale-cash-1', items: [trackedItem([1, 4])] });
  const cash = assertOk(await call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: cashSale }), 'cash sale');
  assert.equal(cash.result, 'created');
  let productRecord = await readProduct();
  assert.equal(productRecord.stock, 3);
  assert.equal((await readBatch(BATCH_A)).quantity, 2);
  assert.equal((await readBatch(BATCH_B)).quantity, 1);
  let units = await readUnits();
  assert.equal(units.find((entry) => entry.id === 'qa-unit-1').status, 'sold');
  assert.equal(units.find((entry) => entry.id === 'qa-unit-1').saleId, 'qa-sale-cash-1');
  assert.equal(units.find((entry) => entry.id === 'qa-unit-1').soldByUid, CASHIER_UID);
  assert.equal(units.find((entry) => entry.id === 'qa-unit-4').status, 'sold');
  assert.equal(units.find((entry) => entry.id === 'qa-unit-2').status, 'in_stock');
  assert.equal(await auditExists('qa-sale-cash-1'), true);
  pass('cash sale commits sale + stock + batches + unit status + audit atomically');

  // 2. Idempotent retry: same fingerprint returns already-committed with no extra stock movement.
  const retry = assertOk(await call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: cashSale }), 'retry');
  assert.equal(retry.result, 'already-committed');
  assert.equal((await readProduct()).stock, 3);
  assert.equal((await readBatch(BATCH_A)).quantity, 2);
  assert.equal((await readUnits()).filter((entry) => entry.status === 'sold').length, 2);
  pass('same-fingerprint retry is idempotent');

  // 3. Same Sale ID with different amounts must fail closed instead of silently overwriting.
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: { ...cashSale, customer: 'Divergent Customer' },
  }), 'FAILED_PRECONDITION', 'fingerprint divergence');
  assert.equal((await readProduct()).stock, 3);
  pass('divergent fingerprint is rejected');

  // 4. A sold sticker can never be sold again.
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-reuse', items: [trackedItem([1])] }),
  }), 'FAILED_PRECONDITION', 'sold unit reuse', /ရောင်းချနိုင်သော အခြေအနေမှာ မရှိ/);
  assert.equal(await saleExists('qa-sale-reuse'), false);
  assert.equal((await readProduct()).stock, 3);
  pass('already-sold sticker is rejected without any write');

  // 5. Concurrent sales of one sticker: exactly one commits.
  await resetInventory();
  const [raceA, raceB] = await Promise.all([
    call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: salePayload({ id: 'qa-sale-race-a', items: [trackedItem([1])] }) }),
    call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: salePayload({ id: 'qa-sale-race-b', items: [trackedItem([1])] }) }),
  ]);
  const raceOutcomes = [raceA, raceB].map((entry) => entry.error ? 'failed' : 'created');
  assert.equal(raceOutcomes.filter((value) => value === 'created').length, 1, `race outcomes ${JSON.stringify(raceOutcomes)}`);
  assert.equal(raceOutcomes.filter((value) => value === 'failed').length, 1);
  assert.equal((await readProduct()).stock, 4);
  assert.equal((await readUnits()).filter((entry) => entry.status === 'sold').length, 1);
  pass('concurrent duplicate sticker sale commits exactly one sale');

  // 6. KPay requires a reference and rejects reuse across sales.
  await resetInventory();
  const kpaySale = salePayload({ id: 'qa-sale-kpay-1', items: [trackedItem([2])], paymentMethod: 'KPay' });
  assertOk(await call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: kpaySale }), 'kpay sale');
  assert.equal((await readUnits()).find((entry) => entry.id === 'qa-unit-2').status, 'sold');
  const duplicateReference = salePayload({
    id: 'qa-sale-kpay-2', items: [trackedItem([3])], paymentMethod: 'KPay',
    patch: { kpayTransactionReference: 'qa-kpay-ref1' },
  });
  assertError(await call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: duplicateReference }), 'FAILED_PRECONDITION', 'duplicate KPay reference', /KPay Transaction Reference/);
  assert.equal(await saleExists('qa-sale-kpay-2'), false);
  assert.equal((await readUnits()).find((entry) => entry.id === 'qa-unit-3').status, 'in_stock');
  const missingReference = salePayload({
    id: 'qa-sale-kpay-3', items: [trackedItem([3])], paymentMethod: 'KPay',
    patch: { kpayTransactionReference: '' },
  });
  assertError(await call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: missingReference }), 'INVALID_ARGUMENT', 'missing KPay reference');
  pass('KPay reference is required and cannot be reused');

  // 7. Branch KPay account configuration is enforced server-side.
  await resetInventory();
  await branchRef.update({ 'payload.settings.kpayAccountName': '', 'payload.settings.kpayAccountNumber': '' });
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-kpay-noconfig', items: [trackedItem([1])], paymentMethod: 'KPay' }),
  }), 'FAILED_PRECONDITION', 'KPay branch config', /KPay Account/);
  await branchRef.update({ 'payload.settings.kpayAccountName': 'QA KPay Account', 'payload.settings.kpayAccountNumber': '09123456789' });
  pass('KPay sale is blocked when the Branch has no KPay account');

  // 8. Tracked in_stock quantity without stickers is rejected; untracked products reject stickers.
  await resetInventory();
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-no-stickers', items: [plainItem(PRODUCT_ID, 1, { unitPrice: 1500 })] }),
  }), 'FAILED_PRECONDITION', 'tracked without stickers', /Sticker Unit အားလုံး မပါဝင်ပါ/);
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-untracked-selection', items: [plainItem(CANDY_ID, 1, { unitPrice: 500, stockUnitSelections: [selection(1)], batchAllocations: [] })] }),
  }), 'FAILED_PRECONDITION', 'untracked with sticker', /Unit Tracking မဖွင့်ထားသော/);
  assert.equal(await saleExists('qa-sale-no-stickers'), false);
  assert.equal((await readProduct(CANDY_ID)).stock, 10);
  pass('tracked/untracked sticker rules are enforced');

  // 9. Insufficient Cloud stock fails before any write.
  await resetInventory({ stock: 1 });
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-low-stock', items: [trackedItem([1, 2])] }),
  }), 'FAILED_PRECONDITION', 'insufficient stock', /Cloud Stock မလုံလောက်ပါ/);
  assert.equal((await readProduct()).stock, 1);
  assert.equal((await readUnits()).filter((entry) => entry.status === 'sold').length, 0);
  pass('insufficient Cloud stock is rejected without any write');

  // 10. Legacy Product-only stock without any Batch still sells (no false batch failure).
  await resetInventory();
  await branchRef.collection('products').doc(LEGACY_ID).set({
    scope: 'branchRecord', kind: 'products', branchId: BRANCH_ID, deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: productPayload(LEGACY_ID, { name: 'QA Legacy', sku: 'QA-LEGACY-1', stock: 4 }),
  });
  assertOk(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-legacy', items: [plainItem(LEGACY_ID, 2)] }),
  }), 'legacy product sale');
  assert.equal((await readProduct(LEGACY_ID)).stock, 2);
  pass('Product-only stock without Batches sells exactly once');

  // 11. Batched Product sold without an allocation is treated as client tampering.
  await resetInventory();
  await branchRef.collection('products').doc(BATCHED_ID).set({
    scope: 'branchRecord', kind: 'products', branchId: BRANCH_ID, deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: productPayload(BATCHED_ID, { name: 'QA Batched', sku: 'QA-BATCHED-1', stock: 3 }),
  });
  await branchRef.collection('stockBatches').doc('qa-batch-candy').set({
    scope: 'branchRecord', kind: 'stockBatches', branchId: BRANCH_ID, deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: batch('qa-batch-candy', 3, BATCHED_ID),
  });
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-missing-alloc', items: [plainItem(BATCHED_ID, 1)] }),
  }), 'FAILED_PRECONDITION', 'missing allocation', /Batch ခွဲဝေမှု/);
  assert.equal((await readProduct(BATCHED_ID)).stock, 3);
  assert.equal((await readBatch('qa-batch-candy')).quantity, 3);
  pass('batched stock without a Batch allocation is rejected');

  // 12. Batch allocation must cover every selected unit's Batch.
  await resetInventory();
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({
      id: 'qa-sale-bad-alloc', items: [{ ...trackedItem([4]), batchAllocations: [{ batchId: BATCH_A, quantity: 1 }] }],
    }),
  }), 'FAILED_PRECONDITION', 'wrong batch allocation', /Stock Batch ခွဲဝေမှု မလုံလောက်ပါ/);
  assert.equal((await readUnits()).filter((entry) => entry.status === 'sold').length, 0);
  pass('unit Batch must be covered by the allocation');

  // 13. Credit sale creates the shared Customer exactly once.
  await resetInventory();
  await branchRef.collection('products').doc(LEGACY_ID).set({
    scope: 'branchRecord', kind: 'products', branchId: BRANCH_ID, deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: productPayload(LEGACY_ID, { name: 'QA Legacy', sku: 'QA-LEGACY-1', stock: 4, retailPrice: 500, wholesalePrice: 500 }),
  });
  const customerSnapshot = { id: CUSTOMER_ID, name: 'QA Credit Customer', phone: '0999999999', address: '', note: '', createdAt: NOW };
  const creditSale = salePayload({
    id: 'qa-sale-credit-1', items: [plainItem(LEGACY_ID, 1, { unitPrice: 500 })], paymentMethod: 'Credit',
    patch: { customer: 'QA Credit Customer', customerId: CUSTOMER_ID, customerSnapshot, paidAmount: 100, dueAmount: 400 },
  });
  assertOk(await call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: creditSale }), 'credit sale');
  const customerRef = businessRef.collection('shared').doc('customers').collection('records').doc(CUSTOMER_ID);
  assert.equal((await customerRef.get()).exists, true);
  assert.equal((await customerRef.get()).data().payload.name, 'QA Credit Customer');
  const secondCredit = salePayload({
    id: 'qa-sale-credit-2', items: [plainItem(LEGACY_ID, 1, { unitPrice: 500 })], paymentMethod: 'Credit',
    patch: { customer: 'QA Credit Customer', customerId: CUSTOMER_ID, customerSnapshot, paidAmount: 0, dueAmount: 500 },
  });
  assertOk(await call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: secondCredit }), 'second credit sale');
  assert.equal((await readProduct(LEGACY_ID)).stock, 2);
  assert.equal((await branchRef.collection('sales').doc('qa-sale-credit-2').get()).data().payload.dueAmount, 500);
  pass('Credit sales commit paid/due and create the shared Customer only once');

  // 14. Cross-Branch and UID spoofing are rejected.
  await resetInventory();
  const legitSale = salePayload({ id: 'qa-sale-auth', items: [trackedItem([1])] });
  assertError(await call({
    uid: CASHIER_UID, branchId: 'branch-main', sale: { ...legitSale, branchId: 'branch-main' },
  }), 'PERMISSION_DENIED', 'cross-branch spoof', /Branch/);
  assertError(await call({
    uid: 'someone-else', branchId: BRANCH_ID, sale: legitSale,
  }), 'PERMISSION_DENIED', 'uid spoof', /UID/);
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: { ...legitSale, createdByUid: 'someone-else' },
  }), 'PERMISSION_DENIED', 'sale uid spoof', /UID/);
  assert.equal(await saleExists('qa-sale-auth'), false);
  assert.equal((await readProduct()).stock, 5);
  pass('cross-Branch and UID spoofing are rejected');

  // 15. Non-completed / malformed payment totals are rejected.
  await resetInventory();
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: { ...salePayload({ id: 'qa-sale-bad-total', items: [trackedItem([1])] }), total: 1 },
  }), 'INVALID_ARGUMENT', 'total mismatch', /Total/);
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-void', items: [trackedItem([1])], patch: { status: 'voided' } }),
  }), 'INVALID_ARGUMENT', 'non-completed sale');
  pass('malformed totals and non-completed sales are rejected');

  // 15b. Malformed document IDs fail deterministically so the queue routes them to Owner review.
  await resetInventory();
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-bad-product-id', items: [plainItem('../escape', 1)] }),
  }), 'INVALID_ARGUMENT', 'malformed product id', /Product/);
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: { ...salePayload({ id: 'qa-sale-bad-sale-id', items: [trackedItem([1])] }), id: 'bad/id' },
  }), 'INVALID_ARGUMENT', 'malformed sale id', /Sale ID/);
  assert.equal(await saleExists('qa-sale-bad-sale-id'), false);
  pass('malformed document IDs are rejected as deterministic invalid arguments');

  // 16. A tampered selling price with self-consistent totals is rejected against trusted Product data.
  await resetInventory();
  const tamperedPriceItem = { ...trackedItem([1]), unitPrice: 1000 };
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-price-tamper', items: [tamperedPriceItem] }),
  }), 'FAILED_PRECONDITION', 'tampered selling price', /ဈေးနှုန်း/);
  assert.equal((await readProduct()).stock, 5);
  assert.equal((await readUnits()).filter((entry) => entry.status === 'sold').length, 0);
  pass('tampered selling price cannot bypass the trusted Product price');

  // 17. A re-written Subtotal / Total that no longer matches trusted line items is rejected.
  await resetInventory();
  const arithmeticSale = salePayload({ id: 'qa-sale-subtotal-tamper', items: [trackedItem([1])] });
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: { ...arithmeticSale, subtotal: 1000, total: 1000, profit: 0, paidAmount: 1000, cashReceivedAmount: 1000 },
  }), 'INVALID_ARGUMENT', 'tampered subtotal', /Subtotal/);
  assert.equal(await saleExists('qa-sale-subtotal-tamper'), false);
  pass('server-recomputed Subtotal / Total reject tampered receipts');

  // 18. A profit that does not reconcile with trusted cost and discount is rejected.
  await resetInventory();
  const profitSale = salePayload({ id: 'qa-sale-profit-tamper', items: [trackedItem([1])] });
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: { ...profitSale, profit: profitSale.profit + 1 },
  }), 'INVALID_ARGUMENT', 'tampered profit', /Profit/);
  pass('tampered cost/profit calculation is rejected');

  // 19. Cashier discount cap is enforced server-side; a valid discount still commits.
  await resetInventory();
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-discount-over', items: [trackedItem([1])], discount: 200 }),
  }), 'INVALID_ARGUMENT', 'discount over cap', /Discount/);
  const allowedDiscount = salePayload({ id: 'qa-sale-discount-ok', items: [trackedItem([1])], discount: 150 });
  assertOk(await call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: allowedDiscount }), 'discount within cap');
  const discountedSale = (await branchRef.collection('sales').doc('qa-sale-discount-ok').get()).data().payload;
  assert.equal(discountedSale.total, 1350);
  assert.equal(discountedSale.profit, 350);
  assert.equal((await readProduct()).stock, 4);
  pass('server discount cap accepts a valid discount and rejects an excessive one');

  // 20. Expiry is judged by server time; a backdated client Sale date cannot sell an expired Batch.
  await resetInventory();
  await branchRef.collection('stockBatches').doc(BATCH_A).update({ 'payload.expiryDate': '2020-01-01' });
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({
      id: 'qa-sale-expiry-backdate', items: [trackedItem([1])],
      patch: { date: '2020-01-01T03:00:00.000Z' },
    }),
  }), 'FAILED_PRECONDITION', 'backdated expired batch', /Expiry/);
  assert.equal((await readProduct()).stock, 5);
  assert.equal((await readUnits()).filter((entry) => entry.status === 'sold').length, 0);
  pass('server time blocks an expired Batch even with a backdated client date');

  // 21. Credit customer IDs must be well-formed and present.
  await resetInventory();
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({ id: 'qa-sale-credit-noid', items: [plainItem(CANDY_ID, 1, { unitPrice: 500 })], paymentMethod: 'Credit' }),
  }), 'INVALID_ARGUMENT', 'credit without customer id', /Customer ID/);
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({
      id: 'qa-sale-credit-badid', items: [plainItem(CANDY_ID, 1, { unitPrice: 500 })], paymentMethod: 'Credit',
      patch: { customerId: '../escape', customer: 'QA Customer' },
    }),
  }), 'INVALID_ARGUMENT', 'malformed customer id', /Customer ID/);
  pass('Credit sale customer IDs are required and path-safe');

  // 22. A client Customer snapshot cannot inject fields or forge its ID/createdAt.
  await resetInventory();
  const customerRecordRef = businessRef.collection('shared').doc('customers').collection('records').doc(CUSTOMER_ID);
  try { await customerRecordRef.delete(); } catch { /* none */ }
  await branchRef.collection('products').doc(LEGACY_ID).set({
    scope: 'branchRecord', kind: 'products', branchId: BRANCH_ID, deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: productPayload(LEGACY_ID, { name: 'QA Legacy', sku: 'QA-LEGACY-1', stock: 4, retailPrice: 500, wholesalePrice: 500 }),
  });
  const injectedSnapshot = {
    id: CUSTOMER_ID, name: 'QA Injected Customer', phone: '0911111111', address: '', note: '',
    createdAt: '1999-01-01T00:00:00.000Z', role: 'owner', injectedField: 'must-not-persist',
  };
  assertOk(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({
      id: 'qa-sale-customer-inject', items: [plainItem(LEGACY_ID, 1, { unitPrice: 500 })], paymentMethod: 'Credit',
      patch: { customer: 'QA Injected Customer', customerId: CUSTOMER_ID, customerSnapshot: injectedSnapshot, paidAmount: 100, dueAmount: 400 },
    }),
  }), 'credit customer snapshot');
  const storedCustomer = (await customerRecordRef.get()).data().payload;
  assert.equal(storedCustomer.role, undefined);
  assert.equal(storedCustomer.injectedField, undefined);
  assert.notEqual(storedCustomer.createdAt, '1999-01-01T00:00:00.000Z');
  assert.equal(storedCustomer.id, CUSTOMER_ID);
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({
      id: 'qa-sale-customer-mismatch', items: [plainItem(LEGACY_ID, 1, { unitPrice: 500 })], paymentMethod: 'Credit',
      patch: {
        customer: 'QA Injected Customer', customerId: 'qa-customer-other',
        customerSnapshot: { ...injectedSnapshot, id: CUSTOMER_ID }, paidAmount: 0, dueAmount: 500,
      },
    }),
  }), 'INVALID_ARGUMENT', 'customer snapshot id mismatch', /Snapshot ID/);
  pass('Customer snapshots are allowlisted and cannot forge ownership');

  // 23. Shared Price Group data is trusted over the client line snapshot.
  await resetInventory();
  const groupRef = businessRef.collection('shared').doc('priceGroups').collection('records').doc(PRICE_GROUP_ID);
  await groupRef.set({
    scope: 'shared', kind: 'priceGroups', deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: {
      id: PRICE_GROUP_ID, name: 'QA Shared Price', retailPrice: 1800, wholesalePrice: 1700,
      currency: 'MMK', version: 3, status: 'active', membersByBranch: { [BRANCH_ID]: PRODUCT_ID },
      createdAt: NOW, updatedAt: NOW,
    },
  });
  await branchRef.collection('products').doc(PRODUCT_ID).update({
    'payload.priceGroupId': PRICE_GROUP_ID, 'payload.priceVersion': 3,
    'payload.retailPrice': 1800, 'payload.wholesalePrice': 1700,
  });
  assertError(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({
      id: 'qa-sale-group-stale',
      items: [{ ...trackedItem([1]), unitPrice: 1500, priceGroupId: PRICE_GROUP_ID, priceVersion: 3 }],
    }),
  }), 'FAILED_PRECONDITION', 'stale shared price', /ဈေးနှုန်း/);
  assert.equal((await readProduct()).stock, 5);
  assertOk(await call({
    uid: CASHIER_UID, branchId: BRANCH_ID,
    sale: salePayload({
      id: 'qa-sale-group-ok',
      items: [{ ...trackedItem([1]), unitPrice: 1800, priceGroupId: PRICE_GROUP_ID, priceVersion: 3 }],
    }),
  }), 'shared price sale');
  assert.equal((await readProduct()).stock, 4);
  pass('Shared Price Group data overrides an older client price snapshot');

  // 24. A retry after membership deactivation still acknowledges the committed sale exactly once.
  await resetInventory();
  const idempotentSale = salePayload({ id: 'qa-sale-idempotent-member', items: [trackedItem([1])] });
  assertOk(await call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: idempotentSale }), 'idempotent seed sale');
  await businessRef.collection('members').doc(CASHIER_UID).update({ status: 'disabled' });
  const idempotentRetry = assertOk(await call({ uid: CASHIER_UID, branchId: BRANCH_ID, sale: idempotentSale }), 'retry after deactivation');
  assert.equal(idempotentRetry.result, 'already-committed');
  assert.equal((await readProduct()).stock, 4);
  assert.equal((await readUnits()).filter((entry) => entry.status === 'sold').length, 1);
  await businessRef.collection('members').doc(CASHIER_UID).update({ status: 'active' });
  pass('exactly-once retry survives membership changes');

  console.log(`\n${results.length} callable checks passed`);
}

try {
  await main();
} finally {
  await cleanup();
  await app.delete();
}
