import { parseRequest } from '../src/domain/sale.js';
import { encodeFields } from '../src/firestore/values.js';
import { signToken, tokenPayload, generateSigningKeys, line, buildSale, BUSINESS_ID, BRANCH_A } from './helpers.mjs';
import { createIdTokenVerifier } from '../src/auth/verifyIdToken.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const NOW = new Date();
const identity = { uid: 'cashier-a', email: 'cashier.a@example.com', name: 'Cashier A' };
const items = Array.from({ length: 20 }, (_, index) => line(`P${index + 1}`));
const sale = buildSale({ id: 'BENCH-20', items });
const body = { branchId: BRANCH_A, sale };

function measure(label, iterations, fn) {
  for (let index = 0; index < 20; index += 1) fn();
  const started = process.cpuUsage();
  for (let index = 0; index < iterations; index += 1) fn();
  const delta = process.cpuUsage(started);
  const totalMicros = delta.user + delta.system;
  return { label, iterations, usPerOp: Math.round((totalMicros / iterations) * 10) / 10 };
}

// Compute one trusted 20-line result set from the fixture again (same pure path).
const parsed = parseRequest(body, identity, NOW);
const trustedItems = parsed.items.map((item) => ({ ...item }));
const writes = [];
for (let index = 1; index <= 20; index += 1) {
  writes.push({
    path: `businesses/${BUSINESS_ID}/branches/${BRANCH_A}/products/P${index}`,
    data: { scope: 'branchRecord', kind: 'products', branchId: BRANCH_A, deleted: false, payload: { stock: 99 }, updatedAt: NOW.toISOString(), updatedBy: 'cashier-a', sourceSaleId: 'BENCH-20' },
    mask: ['payload.stock', 'updatedAt', 'updatedBy', 'sourceSaleId'],
  });
  writes.push({
    path: `businesses/${BUSINESS_ID}/branches/${BRANCH_A}/stockBatches/B-P${index}`,
    data: { scope: 'branchRecord', kind: 'stockBatches', branchId: BRANCH_A, deleted: false, payload: { quantity: 99 }, updatedAt: NOW.toISOString(), updatedBy: 'cashier-a', sourceSaleId: 'BENCH-20' },
    mask: ['payload.quantity', 'updatedAt', 'updatedBy', 'sourceSaleId'],
  });
}
writes.push({
  path: `businesses/${BUSINESS_ID}/branches/${BRANCH_A}/stockUnitRegistries/REG-P3-1`,
  data: {
    scope: 'branchRecord', kind: 'stockUnitRegistries', branchId: BRANCH_A, deleted: false,
    payload: {
      units: [
        { id: 'U1', barcode: 'BC-U1', status: 'sold', saleId: 'BENCH-20', soldAt: NOW.toISOString(), soldByUid: 'cashier-a', registeredAt: '2026-01-01T00:00:00.000Z', barcodeSource: 'sticker', batchId: 'B4' },
        { id: 'U2', barcode: 'BC-U2', status: 'in_stock', registeredAt: '2026-01-01T00:00:00.000Z', barcodeSource: 'sticker', batchId: 'B4' },
      ],
      updatedAt: NOW.toISOString(), updatedByUid: 'cashier-a',
    },
    updatedAt: NOW.toISOString(), updatedBy: 'cashier-a', sourceSaleId: 'BENCH-20',
  },
  mask: ['payload.units', 'payload.updatedAt', 'payload.updatedByUid', 'updatedAt', 'updatedBy', 'sourceSaleId'],
});
writes.push({
  path: `businesses/${BUSINESS_ID}/branches/${BRANCH_A}/sales/BENCH-20`,
  data: {
    scope: 'branchRecord', kind: 'sales', branchId: BRANCH_A, deleted: false, updatedAt: NOW.toISOString(), updatedBy: 'cashier-a',
    payload: {
      ...sale, items: trustedItems, saleFingerprint: parsed.fingerprint, cashierSyncVersion: 2, unitSaleVersion: 1,
      serverReceivedAt: NOW.toISOString(), serverSaleDay: '2026-11-15',
      stockLines: [], batchLines: [], productDeltas: {}, batchDeltas: {},
    },
  },
});
writes.push({
  path: `businesses/${BUSINESS_ID}/branches/${BRANCH_A}/auditEvents/BENCH-20__created`,
  data: { id: 'BENCH-20__created', eventType: 'SALE_CREATED', branchId: BRANCH_A, saleId: 'BENCH-20', receiptNo: sale.receiptNo, actorUid: 'cashier-a', actorEmail: identity.email, actorName: 'Cashier A', occurredAt: NOW.toISOString(), total: sale.total },
});

const validation = measure('parse + fingerprint (20 lines)', 3000, () => parseRequest(body, identity, NOW));
const encode = measure('encode commit writes (20 lines)', 3000, () => encodeFields({ writes: writes.map((write) => write.data) }));
const stringify = measure('JSON.stringify commit body (20 lines)', 3000, () => JSON.stringify({ transaction: 'x'.repeat(24), writes: writes.map((write) => ({ update: { name: write.path, fields: encodeFields(write.data) }, updateMask: { fieldPaths: write.mask } })) }));

// Native RS256 verification is not charged as Worker JS CPU, but measure wall time.
const { privateKey, publicJwk } = await generateSigningKeys();
const token = await signToken(privateKey, tokenPayload('cashier-a'));
const verifier = createIdTokenVerifier({
  projectId: 'demo-minimart-spark-poc',
  jwksUrl: 'https://bench.local/jwks',
  fetchImpl: async () => new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'cache-control': 'max-age=3600' } }),
});
await verifier(token);
const verifyStarted = performance.now();
const verifyIterations = 200;
for (let index = 0; index < verifyIterations; index += 1) await verifier(token);
const verifyWallUs = Math.round(((performance.now() - verifyStarted) / verifyIterations) * 1000);

const commitBodyBytes = Buffer.byteLength(JSON.stringify({ writes: writes.map((write) => ({ update: { name: write.path, fields: encodeFields(write.data) }, updateMask: { fieldPaths: write.mask } })) }));
const pureJsUs = validation.usPerOp + encode.usPerOp + stringify.usPerOp;
const summary = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  scenario: '20-line Cashier sale, 20 products + 20 batches + 1 registry + sale + audit',
  validation,
  encode,
  stringify,
  pureJsUsPerCommit: Math.round(pureJsUs * 10) / 10,
  rsaVerifyWallUs: verifyWallUs,
  commitJsonBytes: commitBodyBytes,
  clientRequestBytes: Buffer.byteLength(JSON.stringify(body)),
  caveat: 'Node process CPU time; Cloudflare Workers bills JavaScript CPU only, so native crypto and network waits are not included. Not measured inside workerd.',
};

const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cpu-results.json');
writeFileSync(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
