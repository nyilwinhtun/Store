/**
 * Emulator-only regression test for server-authoritative Cashier/Owner Void and
 * Return callables. Requires the staging emulators (auth 9099, firestore 8099,
 * functions 5001). Project: demo-minimart-staging. Never points at production.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ID = 'demo-minimart-staging';
const BUSINESS_ID = 'store-mini-main';
const REGION = 'asia-southeast1';
const BRANCH_ID = 'branch-qa-adjustments';
const CASHIER_UID = 'qa-adjust-cashier';
const CASHIER_EMAIL = 'qa.adjustments@demo.minimart.test';
const OWNER_UID = 'qa-adjust-owner';
const OWNER_EMAIL = 'qa.adjust.owner@demo.minimart.test';
const FIRESTORE_PORT = process.env.QA_FIRESTORE_PORT || '8099';
const AUTH_PORT = process.env.QA_AUTH_PORT || '9099';
const FUNCTIONS_PORT = process.env.QA_FUNCTIONS_PORT || '5001';
const FUNCTIONS_BASE = `http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT_ID}/${REGION}`;
const DEVICE_ID = 'qa-device-adjust-01';

const TRACKED_ID = 'qa-adjust-tracked';
const PLAIN_ID = 'qa-adjust-plain';
const REGISTRY_ID = 'qa-adjust-registry-0';
const BATCH_A = 'qa-adjust-batch-a';
const BATCH_P = 'qa-adjust-batch-p';
const SALE_ID = 'qa-adjust-sale';
const NOW = new Date().toISOString();

process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${AUTH_PORT}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const require = createRequire(resolve(root, 'functions/package.json'));
const admin = require('firebase-admin');
const app = admin.initializeApp({ projectId: PROJECT_ID }, 'qa-sale-adjustments');
const auth = admin.auth(app);
const db = admin.firestore(app);
const businessRef = db.doc(`businesses/${BUSINESS_ID}`);
const branchRef = businessRef.collection('branches').doc(BRANCH_ID);

const results = [];
function pass(name) {
  results.push(name);
  console.log(`ok - ${name}`);
}

function productPayload(id, patch) {
  return {
    id, branchId: BRANCH_ID, name: id, sku: `SKU-${id}`, barcode: '', category: 'QA',
    costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400, stock: 0, lowStockAt: 1,
    unit: 'ခု', quantityMode: 'whole', createdAt: NOW, ...patch,
  };
}

function writeDoc(collectionName, id, kind, payload) {
  return {
    scope: 'branchRecord', kind, branchId: BRANCH_ID, deleted: false,
    updatedAt: NOW, updatedBy: 'qa', payload,
  };
}

async function wipeBranch() {
  const collections = await branchRef.listCollections();
  for (const collection of collections) {
    const docs = await collection.listDocuments();
    for (let index = 0; index < docs.length; index += 400) {
      const batch = db.batch();
      docs.slice(index, index + 400).forEach((doc) => batch.delete(doc));
      await batch.commit();
    }
  }
}

function unit1(batchId = BATCH_A) {
  return { id: 'qa-adjust-unit-1', barcode: 'QA-ADJ-0001', barcodeSource: 'purchased_sticker', status: 'in_stock', registeredAt: NOW, batchId };
}
function unit2(batchId = BATCH_A) {
  return { id: 'qa-adjust-unit-2', barcode: 'QA-ADJ-0002', barcodeSource: 'purchased_sticker', status: 'in_stock', registeredAt: NOW, batchId };
}

function salePayload({ saleId = SALE_ID, paymentMethod = 'Cash', paidAmount, dueAmount, patch = {} } = {}) {
  const items = [
    {
      productId: TRACKED_ID, name: 'QA Adjust Tracked', sku: 'SKU-qa-adjust-tracked',
      quantity: 2, unitPrice: 1500, costPrice: 1000, mode: 'retail', unit: 'ခု', quantityMode: 'whole',
      batchAllocations: [{ batchId: BATCH_A, quantity: 2 }],
      stockUnitSelections: [
        { registryId: REGISTRY_ID, unitId: 'qa-adjust-unit-1', barcode: 'QA-ADJ-0001', batchId: BATCH_A },
        { registryId: REGISTRY_ID, unitId: 'qa-adjust-unit-2', barcode: 'QA-ADJ-0002', batchId: BATCH_A },
      ],
    },
    {
      productId: PLAIN_ID, name: 'QA Adjust Plain', sku: 'SKU-qa-adjust-plain',
      quantity: 2, unitPrice: 500, costPrice: 300, mode: 'retail', unit: 'ခု', quantityMode: 'whole',
      batchAllocations: [{ batchId: BATCH_P, quantity: 2 }],
    },
  ];
  const subtotal = 4000;
  const resolvedPaid = paidAmount ?? (paymentMethod === 'Credit' ? 0 : subtotal);
  const resolvedDue = dueAmount ?? (paymentMethod === 'Credit' ? subtotal : 0);
  return {
    id: saleId, branchId: BRANCH_ID, receiptNo: `QA-${saleId}`, date: NOW,
    customer: 'QA Customer', paymentMethod, items, subtotal, discount: 0, total: subtotal,
    profit: 1100, status: 'completed', paidAmount: resolvedPaid, dueAmount: resolvedDue,
    ...(paymentMethod === 'Cash' ? { cashReceivedAmount: resolvedPaid, changeAmount: 0 } : {}),
    ...(paymentMethod === 'KPay' ? {
      kpayTransactionReference: 'QA-ADJ-KPAY-1',
      kpayAccountNameSnapshot: 'QA KPay', kpayAccountNumberSnapshot: '09123456789',
    } : {}),
    createdByUid: CASHIER_UID, createdByEmail: CASHIER_EMAIL, createdByName: 'QA Cashier',
    saleFingerprint: `qa-fingerprint-${saleId}`,
    ...patch,
  };
}

async function resetFixture(options = {}) {
  await wipeBranch();
  await branchRef.set({
    scope: 'branch', kind: 'branches', branchId: BRANCH_ID, id: BRANCH_ID,
    deleted: false, updatedAt: NOW, updatedBy: 'qa',
    payload: {
      id: BRANCH_ID, name: 'QA Adjustments Branch', code: 'QA-ADJ',
      address: '', phone: '', status: 'active', isDefault: false,
      createdAt: NOW, updatedAt: NOW,
      settings: {
        storeName: 'QA Store', currency: 'MMK', kpayEnabled: true,
        kpayAccountName: 'QA KPay', kpayAccountNumber: '09123456789',
      },
    },
  });
  await branchRef.collection('products').doc(TRACKED_ID).set(writeDoc('products', TRACKED_ID, 'products',
    productPayload(TRACKED_ID, { name: 'QA Adjust Tracked', sku: 'SKU-qa-adjust-tracked', stock: 3, tracksIndividualUnits: true })));
  await branchRef.collection('products').doc(PLAIN_ID).set(writeDoc('products', PLAIN_ID, 'products',
    productPayload(PLAIN_ID, { name: 'QA Adjust Plain', sku: 'SKU-qa-adjust-plain', stock: 8, costPrice: 300, retailPrice: 500 })));

  const fixtureSaleId = options.saleId || SALE_ID;
  const units = [
    { ...unit1(), status: 'sold', saleId: fixtureSaleId, soldAt: NOW, soldByUid: CASHIER_UID },
    { ...unit2(), status: 'sold', saleId: fixtureSaleId, soldAt: NOW, soldByUid: CASHIER_UID },
    { ...unit1(), id: 'qa-adjust-unit-3', barcode: 'QA-ADJ-0003', status: 'in_stock' },
  ];
  await branchRef.collection('stockUnitRegistries').doc(REGISTRY_ID).set(writeDoc('stockUnitRegistries', REGISTRY_ID, 'stockUnitRegistries', {
    id: REGISTRY_ID, branchId: BRANCH_ID, productId: TRACKED_ID, chunkIndex: 0, units, updatedAt: NOW,
  }));
  await branchRef.collection('stockBatches').doc(BATCH_A).set(writeDoc('stockBatches', BATCH_A, 'stockBatches', {
    id: BATCH_A, branchId: BRANCH_ID, productId: TRACKED_ID, purchaseId: '', supplierId: '',
    quantity: 1, receivedAt: NOW, expiryDate: '2027-12-31', unitCost: 1000,
  }));
  await branchRef.collection('stockBatches').doc(BATCH_P).set(writeDoc('stockBatches', BATCH_P, 'stockBatches', {
    id: BATCH_P, branchId: BRANCH_ID, productId: PLAIN_ID, purchaseId: '', supplierId: '',
    quantity: 8, receivedAt: NOW, expiryDate: '2027-12-31', unitCost: 300,
  }));
  const sale = salePayload(options);
  await branchRef.collection('sales').doc(sale.id).set(writeDoc('sales', sale.id, 'sales', sale));
  await branchRef.collection('auditEvents').doc(`${sale.id}__created`).set({
    id: `${sale.id}__created`, eventType: 'SALE_CREATED', branchId: BRANCH_ID,
    saleId: sale.id, receiptNo: sale.receiptNo, actorUid: CASHIER_UID,
    actorEmail: CASHIER_EMAIL, actorName: 'QA Cashier', occurredAt: NOW, total: sale.total,
  });
}

async function readProduct(id) {
  return (await branchRef.collection('products').doc(id).get()).data().payload;
}
async function readBatch(id) {
  return (await branchRef.collection('stockBatches').doc(id).get()).data().payload;
}
async function readUnits() {
  return (await branchRef.collection('stockUnitRegistries').doc(REGISTRY_ID).get()).data().payload.units;
}
async function readSale(id = SALE_ID) {
  return (await branchRef.collection('sales').doc(id).get()).data()?.payload;
}
async function docExists(collectionName, id) {
  return (await branchRef.collection(collectionName).doc(id).get()).exists;
}

let cashierToken = '';
let ownerToken = '';
async function signIn(uid, email) {
  try { await auth.deleteUser(uid); } catch { /* not created yet */ }
  await auth.createUser({ uid, email, displayName: uid });
  const customToken = await auth.createCustomToken(uid);
  const response = await fetch(
    `http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) },
  );
  const body = await response.json();
  assert.ok(body.idToken, `custom token sign-in failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function call(name, data, token = cashierToken) {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

function voidBody(overrides = {}) {
  return {
    uid: CASHIER_UID, branchId: BRANCH_ID, saleId: SALE_ID,
    requestId: 'qa-void-request-001', reason: 'QA void reason', deviceId: DEVICE_ID,
    ...overrides,
  };
}
function returnBody(items, overrides = {}) {
  return {
    uid: CASHIER_UID, branchId: BRANCH_ID, saleId: SALE_ID,
    requestId: 'qa-return-request-001', reason: 'QA return reason', deviceId: DEVICE_ID,
    items, refundReference: '', ...overrides,
  };
}

async function prepare() {
  await wipeBranch();
  await businessRef.set({ active: true }, { merge: true });
  await businessRef.collection('members').doc(CASHIER_UID).set({
    uid: CASHIER_UID, email: CASHIER_EMAIL, displayName: 'QA Cashier',
    role: 'cashier', status: 'active', branchIds: [BRANCH_ID],
    createdAt: NOW, updatedAt: NOW, createdBy: 'qa', canReceiveStock: false,
  });
  await auth.deleteUser(OWNER_UID).catch(() => {});
  cashierToken = await signIn(CASHIER_UID, CASHIER_EMAIL);
  ownerToken = await signIn(OWNER_UID, OWNER_EMAIL);
}

async function cleanup() {
  try { await wipeBranch(); } catch { /* emulator may be stopped */ }
  try { await branchRef.delete(); } catch { /* already gone */ }
  try { await businessRef.collection('members').doc(CASHIER_UID).delete(); } catch { /* already gone */ }
  try { await businessRef.update({ ownerUid: admin.firestore.FieldValue.delete() }); } catch { /* none */ }
  try { await auth.deleteUser(CASHIER_UID); } catch { /* already gone */ }
  try { await auth.deleteUser(OWNER_UID); } catch { /* already gone */ }
}

async function main() {
  await prepare();

  // 1. Cashier Return: only saleable stock restocks; damaged units are quarantined.
  await resetFixture();
  const returned = assertOk(await call('cashierSaleReturn', returnBody([
    {
      productId: TRACKED_ID, quantity: 2, disposition: 'restock',
      units: [
        { registryId: REGISTRY_ID, unitId: 'qa-adjust-unit-1', disposition: 'restock' },
        { registryId: REGISTRY_ID, unitId: 'qa-adjust-unit-2', disposition: 'damaged' },
      ],
    },
    { productId: PLAIN_ID, quantity: 1, disposition: 'restock', units: [] },
  ])), 'cashier return');
  assert.equal(returned.result, 'created');
  assert.equal((await readProduct(TRACKED_ID)).stock, 4, 'only one tracked unit restocked');
  assert.equal((await readProduct(PLAIN_ID)).stock, 9, 'one plain quantity restocked');
  assert.equal((await readBatch(BATCH_A)).quantity, 2, 'tracked batch restocked once');
  assert.equal((await readBatch(BATCH_P)).quantity, 9, 'plain batch restocked once');
  const unitsAfterReturn = await readUnits();
  assert.equal(unitsAfterReturn.find((entry) => entry.id === 'qa-adjust-unit-1').status, 'in_stock');
  assert.equal(unitsAfterReturn.find((entry) => entry.id === 'qa-adjust-unit-2').status, 'damaged');
  assert.equal(unitsAfterReturn.find((entry) => entry.id === 'qa-adjust-unit-2').damageReason, 'QA return reason');
  let sale = await readSale();
  assert.equal(sale.status, 'completed', 'original sale is preserved');
  assert.equal(sale.returnCount, 1);
  assert.equal(sale.returnedProductQuantities[TRACKED_ID], 2);
  assert.equal(sale.returnedProductQuantities[PLAIN_ID], 1);
  assert.equal(sale.returns[0].refundStatus, 'cash-refunded');
  assert.equal(await docExists('saleReturns', 'qa-return-request-001'), true);
  assert.equal(await docExists('auditEvents', `${SALE_ID}__return__qa-return-request-001`), true);
  pass('Cashier Return restocks only saleable stock and quarantines damaged units');

  // 2. Return replay is idempotent and never restocks twice.
  const replay = assertOk(await call('cashierSaleReturn', returnBody([
    {
      productId: TRACKED_ID, quantity: 2, disposition: 'restock',
      units: [
        { registryId: REGISTRY_ID, unitId: 'qa-adjust-unit-1', disposition: 'restock' },
        { registryId: REGISTRY_ID, unitId: 'qa-adjust-unit-2', disposition: 'damaged' },
      ],
    },
    { productId: PLAIN_ID, quantity: 1, disposition: 'restock', units: [] },
  ])), 'return replay');
  assert.equal(replay.result, 'already-committed');
  assert.equal(replay.items.length, 2, 'replay returns the original client item records');
  assert.deepEqual(replay.returnedProductQuantities, { [TRACKED_ID]: 2, [PLAIN_ID]: 1 });
  assert.equal((await readProduct(TRACKED_ID)).stock, 4);
  assert.equal((await readProduct(PLAIN_ID)).stock, 9);
  assert.equal((await readBatch(BATCH_A)).quantity, 2);
  pass('Return request replay is idempotent and returns the original item records');

  // 3. Over-return and re-returning a quarantined unit fail closed.
  assertError(await call('cashierSaleReturn', returnBody([
    { productId: PLAIN_ID, quantity: 2, disposition: 'restock', units: [] },
  ], { requestId: 'qa-return-request-over' })), 'FAILED_PRECONDITION', 'over-return');
  assertError(await call('cashierSaleReturn', returnBody([
    {
      productId: TRACKED_ID, quantity: 1, disposition: 'damaged',
      units: [{ registryId: REGISTRY_ID, unitId: 'qa-adjust-unit-2', disposition: 'damaged' }],
    },
  ], { requestId: 'qa-return-request-again' })), 'FAILED_PRECONDITION', 'double unit return');
  assert.equal((await readProduct(PLAIN_ID)).stock, 9);
  assert.equal((await readProduct(TRACKED_ID)).stock, 4);
  pass('Over-return and repeated unit return are rejected without writes');

  // 4. A Sale that already has a Return cannot be Voided.
  assertError(await call('cashierSaleVoid', voidBody()), 'FAILED_PRECONDITION', 'void after return', /Return/);
  pass('Void after Return is blocked');

  // 5. Cashier Void restores product, batch and exact sticker state once.
  await resetFixture({ saleId: 'qa-adjust-void-sale' });
  const voided = assertOk(await call('cashierSaleVoid', voidBody({ saleId: 'qa-adjust-void-sale' })), 'cashier void');
  assert.equal(voided.result, 'created');
  assert.equal(voided.refundStatus, 'cash-refunded');
  assert.equal((await readProduct(TRACKED_ID)).stock, 5);
  assert.equal((await readProduct(PLAIN_ID)).stock, 10);
  assert.equal((await readBatch(BATCH_A)).quantity, 3);
  assert.equal((await readBatch(BATCH_P)).quantity, 10);
  const voidedUnits = await readUnits();
  assert.equal(voidedUnits.find((entry) => entry.id === 'qa-adjust-unit-1').status, 'in_stock');
  assert.equal(voidedUnits.find((entry) => entry.id === 'qa-adjust-unit-1').saleId, undefined);
  assert.equal(voidedUnits.find((entry) => entry.id === 'qa-adjust-unit-2').status, 'in_stock');
  sale = await readSale('qa-adjust-void-sale');
  assert.equal(sale.status, 'voided');
  assert.equal(sale.total, 4000, 'void preserves original amounts');
  assert.equal(sale.voidRequested, false);
  assert.equal(sale.voidRefundStatus, 'cash-refunded');
  assert.equal(await docExists('auditEvents', 'qa-adjust-void-sale__void'), true);
  pass('Cashier Void atomically restores stock, batches, units and audit');

  // 6. Void replay is idempotent; a different request is rejected.
  const voidReplay = assertOk(await call('cashierSaleVoid', voidBody({ saleId: 'qa-adjust-void-sale' })), 'void replay');
  assert.equal(voidReplay.result, 'already-committed');
  assert.equal((await readProduct(TRACKED_ID)).stock, 5);
  assertError(await call('cashierSaleVoid', voidBody({ saleId: 'qa-adjust-void-sale', requestId: 'qa-void-request-002' })),
    'FAILED_PRECONDITION', 'second void');
  pass('Void request replay is idempotent');

  // 7. A Voided Sale cannot be Returned.
  assertError(await call('cashierSaleReturn', returnBody([
    { productId: PLAIN_ID, quantity: 1, disposition: 'restock', units: [] },
  ], { saleId: 'qa-adjust-void-sale', requestId: 'qa-return-after-void' })), 'FAILED_PRECONDITION', 'return after void');
  pass('Return after Void is blocked');

  // 8. KPay refunds stay pending; the server never claims a completed transfer.
  await resetFixture({ saleId: 'qa-adjust-kpay-sale', paymentMethod: 'KPay' });
  const kpayReturn = assertOk(await call('cashierSaleReturn', returnBody([
    { productId: PLAIN_ID, quantity: 1, disposition: 'restock', units: [] },
  ], { saleId: 'qa-adjust-kpay-sale', requestId: 'qa-return-kpay-001' })), 'KPay return');
  assert.equal(kpayReturn.refundStatus, 'kpay-pending');
  pass('KPay Return records an honest pending refund status');

  // 9. Pre-paid Credit sales cannot be Voided; the adjustment is a Return.
  await resetFixture({ saleId: 'qa-adjust-credit-sale', paymentMethod: 'Credit', paidAmount: 1000 });
  assertError(await call('cashierSaleVoid', voidBody({ saleId: 'qa-adjust-credit-sale' })),
    'FAILED_PRECONDITION', 'credit paid void', /Credit/);
  pass('Pre-paid Credit Void is rejected in favour of Return');

  // 10. Input validation and Branch/Role authorization are server-side.
  await resetFixture({ saleId: 'qa-adjust-auth-sale' });
  assertError(await call('cashierSaleVoid', voidBody({ saleId: 'qa-adjust-auth-sale', reason: 'x' })),
    'INVALID_ARGUMENT', 'short reason');
  assertError(await call('cashierSaleVoid', voidBody({ saleId: 'qa-adjust-auth-sale', branchId: 'branch-not-assigned' })),
    'PERMISSION_DENIED', 'wrong branch');
  await businessRef.collection('members').doc(CASHIER_UID).update({ status: 'disabled' });
  assertError(await call('cashierSaleVoid', voidBody({ saleId: 'qa-adjust-auth-sale' })),
    'PERMISSION_DENIED', 'disabled cashier');
  await businessRef.collection('members').doc(CASHIER_UID).update({ status: 'active' });
  pass('Reason, Branch assignment and Cashier status are enforced server-side');

  // 11. Owner remains authorized without a membership document.
  await resetFixture({ saleId: 'qa-adjust-owner-sale' });
  await businessRef.set({ ownerUid: OWNER_UID }, { merge: true });
  const ownerReturn = assertOk(await call('cashierSaleReturn', returnBody([
    { productId: PLAIN_ID, quantity: 1, disposition: 'damaged', units: [] },
  ], { uid: OWNER_UID, saleId: 'qa-adjust-owner-sale', requestId: 'qa-return-owner-001' }), ownerToken), 'owner return');
  assert.equal(ownerReturn.result, 'created');
  assert.equal((await readProduct(PLAIN_ID)).stock, 8, 'damaged Owner return does not restock');
  await businessRef.update({ ownerUid: admin.firestore.FieldValue.delete() });
  pass('Owner Return is authorized from the trusted business ownerUid');

  console.log(`\n${results.length} sale-adjustment checks passed.`);
}

try {
  await main();
} finally {
  await cleanup();
}
