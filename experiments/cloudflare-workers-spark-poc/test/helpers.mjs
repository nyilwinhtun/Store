import { createApp } from '../src/app.js';
import { SaleError } from '../src/errors.js';
import { createIdTokenVerifier } from '../src/auth/verifyIdToken.js';
import { createEmulatorCredential } from '../src/firestore/credentials.js';
import { FirestoreRest } from '../src/firestore/rest.js';
import { decodeFields, encodeFields } from '../src/firestore/values.js';
import { DOCUMENTS_BASE, HOST, PROJECT_ID } from './emulator.mjs';

export const BUSINESS_ID = 'store-mini-main';
export const BRANCH_A = 'branch-a';
export const BRANCH_B = 'branch-b';
export const BRANCH_C = 'branch-c';
export const JWKS_URL = 'https://mock.local/jwks';
export const CORS_ORIGIN = 'https://staging.example.test';

export const BIZ = `businesses/${BUSINESS_ID}`;

export const EMAILS = {
  'owner-1': 'owner@example.com',
  'cashier-a': 'cashier.a@example.com',
  'cashier-a2': 'cashier.a2@example.com',
  'cashier-b': 'cashier.b@example.com',
  'cashier-c': 'cashier.c@example.com',
  'cashier-disabled': 'disabled.cashier@example.com',
};

export const SPECS = {
  P1: { retail: 1000, wholesale: 900, cost: 700, stock: 100, batchId: 'B1' },
  P2: { retail: 2500, wholesale: 2300, cost: 1800, stock: 50, batchId: 'B3' },
  P3: { retail: 500, wholesale: 450, cost: 300, stock: 10, batchId: 'B4', tracked: true },
  P4: { retail: 4000, wholesale: 3600, cost: 3000, stock: 30, batchId: 'B5', priceGroupId: 'G1', priceVersion: 2 },
  P5: { retail: 100, wholesale: 90, cost: 50, stock: 20.5, batchId: 'B6', quantityMode: 'decimal' },
  PEXP: { retail: 100, wholesale: 90, cost: 60, stock: 10, batchId: 'BEXP' },
};
for (let index = 6; index <= 21; index += 1) {
  SPECS[`P${index}`] = { retail: 100, wholesale: 90, cost: 60, stock: 100, batchId: `B-P${index}` };
}

export const UNITS = [
  { id: 'U1', barcode: 'BC-U1', barcodeSource: 'sticker', status: 'in_stock', registeredAt: '2026-01-01T00:00:00.000Z', batchId: 'B4' },
  { id: 'U2', barcode: 'BC-U2', barcodeSource: 'sticker', status: 'in_stock', registeredAt: '2026-01-01T00:00:00.000Z', batchId: 'B4' },
  { id: 'U3', barcode: 'BC-U3', barcodeSource: 'sticker', status: 'in_stock', registeredAt: '2026-01-01T00:00:00.000Z', batchId: 'B4' },
  { id: 'U4', barcode: 'BC-U4', barcodeSource: 'sticker', status: 'sold', registeredAt: '2026-01-01T00:00:00.000Z', batchId: 'B4', saleId: 'OLD-SALE-1', soldAt: '2026-02-01T00:00:00.000Z', soldByUid: 'cashier-a' },
  { id: 'U5', barcode: 'BC-U5', barcodeSource: 'sticker', status: 'damaged', registeredAt: '2026-01-01T00:00:00.000Z', batchId: 'B4' },
];

const NOW = '2026-11-01T00:00:00.000Z';

function branchDoc(branchId, status) {
  return {
    scope: 'branchRecord', kind: 'branches', branchId, deleted: false, updatedAt: NOW, updatedBy: 'owner-1',
    payload: {
      id: branchId, name: `Branch ${branchId}`, status, currency: 'MMK', createdAt: NOW,
      settings: {
        kpayEnabled: true,
        kpayAccountName: 'Daw Mya',
        kpayAccountNumber: '09123456789',
        kpayQrVersion: 3,
        cashierExpenseApprovalLimit: 50000,
      },
    },
  };
}

function memberDoc(uid, branchId, status = 'active') {
  return {
    uid, email: EMAILS[uid], displayName: `Cashier ${uid}`, role: 'cashier', status,
    branchIds: [branchId], createdAt: NOW,
  };
}

function productDoc(productId, overrides = {}, branchId = BRANCH_A) {
  const spec = SPECS[productId] || {};
  return {
    scope: 'branchRecord', kind: 'products', branchId, deleted: false, updatedAt: NOW, updatedBy: 'owner-1',
    payload: {
      id: productId, branchId, name: `Product ${productId}`, sku: productId, category: 'General',
      costPrice: spec.cost ?? 600, retailPrice: spec.retail ?? 1000, wholesalePrice: spec.wholesale ?? 900,
      stock: spec.stock ?? 100, lowStockAt: 5, unit: 'pcs', quantityMode: spec.quantityMode || 'whole',
      tracksIndividualUnits: spec.tracked === true, createdAt: NOW,
      ...(spec.priceGroupId ? { priceGroupId: spec.priceGroupId, priceVersion: spec.priceVersion } : {}),
      ...overrides,
    },
  };
}

function batchDoc(batchId, productId, quantity, extra = {}, branchId = BRANCH_A) {
  return {
    scope: 'branchRecord', kind: 'stockBatches', branchId, deleted: false, updatedAt: NOW, updatedBy: 'owner-1',
    payload: { id: batchId, productId, quantity, receivedAt: NOW, ...extra },
  };
}

function registryDoc(registryId, productId, units, branchId = BRANCH_A) {
  return {
    scope: 'branchRecord', kind: 'stockUnitRegistries', branchId, deleted: false, updatedAt: NOW, updatedBy: 'owner-1',
    payload: { id: registryId, productId, units, updatedAt: NOW, updatedByUid: 'owner-1' },
  };
}

export function fixtureDocs() {
  const docs = [
    [`${BIZ}`, { ownerUid: 'owner-1', name: 'POC Mini Mart', active: true, createdAt: NOW }],
    [`${BIZ}/meta/settings`, { payload: { settings: { maxCashierDiscountPercent: 10 } }, updatedAt: NOW }],
    [`${BIZ}/members/cashier-a`, memberDoc('cashier-a', BRANCH_A)],
    [`${BIZ}/members/cashier-a2`, memberDoc('cashier-a2', BRANCH_A)],
    [`${BIZ}/members/cashier-b`, memberDoc('cashier-b', BRANCH_B)],
    [`${BIZ}/members/cashier-c`, memberDoc('cashier-c', BRANCH_C)],
    [`${BIZ}/members/cashier-disabled`, memberDoc('cashier-disabled', BRANCH_A, 'disabled')],
    [`${BIZ}/branches/${BRANCH_A}`, branchDoc(BRANCH_A, 'active')],
    [`${BIZ}/branches/${BRANCH_B}`, branchDoc(BRANCH_B, 'active')],
    [`${BIZ}/branches/${BRANCH_C}`, branchDoc(BRANCH_C, 'inactive')],
  ];
  for (const productId of Object.keys(SPECS)) {
    if (productId === 'P3') continue;
    docs.push([`${BIZ}/branches/${BRANCH_A}/products/${productId}`, productDoc(productId)]);
    if (productId === 'PEXP') {
      docs.push([`${BIZ}/branches/${BRANCH_A}/stockBatches/BEXP`, batchDoc('BEXP', 'PEXP', 10, { expiryDate: '2020-01-01' })]);
    } else if (productId === 'P1') {
      docs.push([`${BIZ}/branches/${BRANCH_A}/stockBatches/B1`, batchDoc('B1', 'P1', 60, { expiryDate: '2099-12-31' })]);
      docs.push([`${BIZ}/branches/${BRANCH_A}/stockBatches/B2`, batchDoc('B2', 'P1', 40)]);
    } else {
      const spec = SPECS[productId];
      docs.push([`${BIZ}/branches/${BRANCH_A}/stockBatches/${spec.batchId}`, batchDoc(spec.batchId, productId, spec.stock)]);
    }
  }
  docs.push([`${BIZ}/branches/${BRANCH_A}/products/P3`, productDoc('P3')]);
  docs.push([`${BIZ}/branches/${BRANCH_A}/stockBatches/B4`, batchDoc('B4', 'P3', 10)]);
  docs.push([`${BIZ}/branches/${BRANCH_A}/stockUnitRegistries/REG-P3-1`, registryDoc('REG-P3-1', 'P3', UNITS)]);
  docs.push([`${BIZ}/branches/${BRANCH_B}/products/P3`, productDoc('P3', { stock: 5 }, BRANCH_B)]);
  docs.push([`${BIZ}/branches/${BRANCH_B}/stockBatches/B4B`, batchDoc('B4B', 'P3', 5, {}, BRANCH_B)]);
  docs.push([`${BIZ}/branches/${BRANCH_B}/stockUnitRegistries/REG-P3-B`, registryDoc('REG-P3-B', 'P3', [
    { id: 'UB1', barcode: 'BC-UB1', barcodeSource: 'sticker', status: 'in_stock', registeredAt: NOW, batchId: 'B4B' },
  ], BRANCH_B)]);
  docs.push([`${BIZ}/shared/priceGroups/records/G1`, {
    scope: 'shared', kind: 'priceGroups', deleted: false, updatedAt: NOW, updatedBy: 'owner-1',
    payload: {
      id: 'G1', name: 'Group 1', currency: 'MMK', status: 'active', version: 2,
      retailPrice: 4000, wholesalePrice: 3600, membersByBranch: { [BRANCH_A]: 'P4' }, createdAt: NOW,
    },
  }]);
  docs.push([`${BIZ}/shared/customers/records/CUST1`, {
    scope: 'shared', kind: 'customers', deleted: false, updatedAt: NOW, updatedBy: 'owner-1',
    payload: { id: 'CUST1', name: 'Daw Hla', phone: '0999999999', address: 'Yangon', note: '', createdAt: NOW },
  }]);
  return docs;
}

function docName(path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `projects/${PROJECT_ID}/databases/(default)/documents/${encoded}`;
}

export async function writeDocs(docs) {
  const response = await fetch(`${DOCUMENTS_BASE}:commit`, {
    method: 'POST',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ writes: docs.map(([path, data]) => ({ update: { name: docName(path), fields: encodeFields(data) } })) }),
  });
  if (!response.ok) throw new Error(`Seed failed HTTP ${response.status}: ${await response.text()}`);
}

export async function readDoc(path) {
  const response = await fetch(`${DOCUMENTS_BASE}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { authorization: 'Bearer owner' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Read failed HTTP ${response.status}`);
  return decodeFields((await response.json()).fields || {});
}

export async function listDocs(collectionPath) {
  const response = await fetch(`${DOCUMENTS_BASE}/${collectionPath.split('/').map(encodeURIComponent).join('/')}?pageSize=100`, {
    headers: { authorization: 'Bearer owner' },
  });
  if (!response.ok) throw new Error(`List failed HTTP ${response.status}`);
  const body = await response.json();
  return (body.documents || []).map((doc) => ({ path: doc.name.split('/documents/')[1], data: decodeFields(doc.fields || {}) }));
}

export async function seedAll() {
  await writeDocs(fixtureDocs());
}

// ---- Auth fixtures -------------------------------------------------------

export async function generateSigningKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk: { ...publicJwk, kid: 'kid-1', alg: 'RS256', use: 'sig' } };
}

function base64Url(text) {
  return Buffer.from(text).toString('base64url');
}

export async function signToken(privateKey, payload) {
  const header = { alg: 'RS256', kid: 'kid-1', typ: 'JWT' };
  const input = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

export function tokenPayload(uid, overrides = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: uid,
    user_id: uid,
    email: overrides.email ?? EMAILS[uid],
    name: overrides.name ?? `Cashier ${uid}`,
    iat: overrides.iat ?? nowSeconds - 10,
    exp: overrides.exp ?? nowSeconds + 3600,
    auth_time: overrides.auth_time ?? nowSeconds - 10,
    firebase: { sign_in_provider: 'password' },
    ...overrides,
  };
}

// ---- App harness ---------------------------------------------------------

function createCountingFetch(publicJwk) {
  const state = { subrequests: 0, dropCommitResponseOnce: false };
  const fetchImpl = async (url, init) => {
    state.subrequests += 1;
    if (String(url) === JWKS_URL) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
      });
    }
    if (state.dropCommitResponseOnce && String(url).includes(':commit')) {
      state.dropCommitResponseOnce = false;
      await globalThis.fetch(url, init);
      throw new TypeError('simulated network loss after Firestore commit');
    }
    return globalThis.fetch(url, init);
  };
  fetchImpl.state = state;
  return fetchImpl;
}

export async function createHarness({ now, revokedUids = [], allowedOrigins = [CORS_ORIGIN] } = {}) {
  const { privateKey, publicJwk } = await generateSigningKeys();
  const fetchImpl = createCountingFetch(publicJwk);
  const firestore = new FirestoreRest({
    projectId: PROJECT_ID,
    host: `http://${HOST}`,
    credential: createEmulatorCredential(),
    fetchImpl,
  });
  const verifier = createIdTokenVerifier({ projectId: PROJECT_ID, fetchImpl, jwksUrl: JWKS_URL });
  const revoked = new Set(revokedUids);
  const revocationChecker = async (identity) => {
    if (revoked.has(identity.uid)) {
      throw new SaleError(401, 'unauthenticated', 'Cashier Token ကို ပယ်ဖျက်ထားပါတယ်။');
    }
  };
  let clockNow = Date.now();
  const appNow = now || (() => clockNow);
  const app = createApp({
    projectId: PROJECT_ID,
    businessId: BUSINESS_ID,
    firestore,
    verifier,
    revocationChecker,
    allowedOrigins,
    now: appNow,
  });

  function setNow(ms) {
    if (now) throw new Error('Cannot move an injected clock.');
    clockNow = Number(ms);
  }

  async function tokenFor(uid, overrides = {}) {
    return signToken(privateKey, tokenPayload(uid, overrides));
  }

  async function postSale({ token, body, rawBody, contentType = 'application/json', method = 'POST', path = '/api/sales/commit', origin }) {
    fetchImpl.state.subrequests = 0;
    const before = { reads: firestore.metrics.reads, writes: firestore.metrics.writes, bytesOut: firestore.metrics.bytesOut };
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (contentType) headers['content-type'] = contentType;
    if (origin) headers.origin = origin;
    const payload = rawBody === undefined ? JSON.stringify(body) : rawBody;
    const startedAt = performance.now();
    const response = await app.handle(new Request(`https://poc.local${path}`, { method, headers, body: method === 'GET' || method === 'OPTIONS' ? undefined : payload }));
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    return {
      status: response.status,
      body: parsed,
      headers: Object.fromEntries(response.headers),
      subrequests: fetchImpl.state.subrequests,
      reads: Number(response.headers.get('x-poc-reads') || firestore.metrics.reads - before.reads),
      writes: Number(response.headers.get('x-poc-writes') || firestore.metrics.writes - before.writes),
      attempt: Number(response.headers.get('x-poc-attempts') || 0),
      requestBytes: payload ? Buffer.byteLength(payload) : 0,
      firestoreBytesOut: firestore.metrics.bytesOut - before.bytesOut,
      wallMs: performance.now() - startedAt,
    };
  }

  async function issueAllowance({ token, body }) {
    return postSale({ token, body, path: '/api/offline-allowances' });
  }

  async function reconcileAllowance({ token, body }) {
    return postSale({ token, body, path: '/api/offline-allowances/reconcile' });
  }

  async function expireStale(atMs) {
    fetchImpl.state.subrequests = 0;
    const before = { reads: firestore.metrics.reads, writes: firestore.metrics.writes };
    const startedAt = performance.now();
    const result = await app.expireStale(new Date(atMs));
    return {
      ...result,
      subrequests: fetchImpl.state.subrequests,
      reads: firestore.metrics.reads - before.reads,
      writes: firestore.metrics.writes - before.writes,
      wallMs: performance.now() - startedAt,
    };
  }

  function revoke(uid) {
    revoked.add(uid);
  }

  function restore(uid) {
    revoked.delete(uid);
  }

  return {
    app, firestore, fetchImpl, tokenFor, postSale, issueAllowance, reconcileAllowance,
    expireStale, setNow, revoke, restore, privateKey,
  };
}

// ---- Sale fixtures -------------------------------------------------------

export function unitSelection(registryId, unitId, barcode, batchId) {
  return { registryId, unitId, barcode, ...(batchId ? { batchId } : {}) };
}

export function line(productId, options = {}) {
  const spec = SPECS[productId];
  const quantity = options.quantity ?? 1;
  const mode = options.mode || 'retail';
  const item = {
    productId,
    name: `Product ${productId}`,
    sku: productId,
    quantity,
    unitPrice: options.unitPrice ?? (mode === 'wholesale' ? spec.wholesale : spec.retail),
    costPrice: options.costPrice ?? spec.cost,
    mode,
    stockAtAdd: spec.stock,
    unit: 'pcs',
    quantityMode: spec.quantityMode || 'whole',
  };
  if (options.batchAllocations) item.batchAllocations = options.batchAllocations;
  else if (!options.noAllocation) item.batchAllocations = [{ batchId: options.batchId || spec.batchId, quantity }];
  if (spec.priceGroupId) {
    item.priceGroupId = options.priceGroupId ?? spec.priceGroupId;
    item.priceVersion = options.priceVersion ?? spec.priceVersion;
  }
  if (spec.tracked) {
    item.stockUnitSelections = options.units || UNITS.filter((unit) => unit.status === 'in_stock').slice(0, quantity)
      .map((unit) => unitSelection(options.registryId || 'REG-P3-1', unit.id, unit.barcode, unit.batchId));
  }
  return item;
}

export function buildSale({
  id, items, branchId = BRANCH_A, uid = 'cashier-a', email = EMAILS['cashier-a'],
  paymentMethod = 'Cash', discount = 0, customer = 'Walk-in', customerId, customerSnapshot,
  kpayReference, paidAmount, dueAmount, cashReceivedAmount, date,
}) {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const total = subtotal - discount;
  const profit = items.reduce((sum, item) => sum + (item.unitPrice - item.costPrice) * item.quantity, 0) - discount;
  const sale = {
    id, branchId, receiptNo: `POC-${id}`, date: date || new Date().toISOString(), customer,
    paymentMethod, items, subtotal, discount, total, profit, status: 'completed',
    createdByUid: uid, createdByEmail: email, createdByName: `Cashier ${uid}`,
  };
  if (customerId) sale.customerId = customerId;
  if (customerSnapshot) sale.customerSnapshot = customerSnapshot;
  if (paymentMethod === 'KPay') sale.kpayTransactionReference = kpayReference ?? 'KP20261115001';
  if (cashReceivedAmount !== undefined) sale.cashReceivedAmount = cashReceivedAmount;
  if (paymentMethod === 'Credit') {
    sale.paidAmount = paidAmount ?? 0;
    sale.dueAmount = dueAmount ?? total - sale.paidAmount;
  } else {
    sale.paidAmount = paidAmount ?? total;
    sale.dueAmount = 0;
  }
  return sale;
}

export async function saleExists(saleId, branchId = BRANCH_A) {
  return readDoc(`${BIZ}/branches/${branchId}/sales/${saleId}`);
}

export async function productStock(productId, branchId = BRANCH_A) {
  const doc = await readDoc(`${BIZ}/branches/${branchId}/products/${productId}`);
  return doc?.payload?.stock ?? null;
}

export async function batchQuantity(batchId, branchId = BRANCH_A) {
  const doc = await readDoc(`${BIZ}/branches/${branchId}/stockBatches/${batchId}`);
  return doc?.payload?.quantity ?? null;
}

export async function registryUnits(registryId = 'REG-P3-1', branchId = BRANCH_A) {
  const doc = await readDoc(`${BIZ}/branches/${branchId}/stockUnitRegistries/${registryId}`);
  return doc?.payload?.units ?? [];
}

export async function auditDoc(saleId) {
  return readDoc(`${BIZ}/branches/${BRANCH_A}/auditEvents/${saleId}__created`);
}

export async function customerDoc(customerId) {
  return readDoc(`${BIZ}/shared/customers/records/${customerId}`);
}
