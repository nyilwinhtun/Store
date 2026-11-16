import test, { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startEmulator, clearDatabase } from './emulator.mjs';
import * as H from './helpers.mjs';

const RESULTS = {};
let emulator;
let hive;

function record(name, result, extra = {}) {
  RESULTS[name] = {
    status: result.status,
    result: result.body?.result ?? result.body?.code ?? null,
    reads: result.reads,
    writes: result.writes,
    subrequests: result.subrequests,
    requestBytes: result.requestBytes,
    firestoreBytesOut: result.firestoreBytesOut,
    wallMs: Math.round(result.wallMs * 10) / 10,
    ...extra,
  };
}

async function attempt(sale, options = {}) {
  const token = options.token ?? await hive.tokenFor(options.uid ?? sale.createdByUid, options.tokenOverrides);
  const body = options.body ?? { branchId: options.branchId ?? sale.branchId, sale };
  return hive.postSale({ token, body, ...(options.request || {}) });
}

function assertFailed(response, status, text) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  if (text) assert.match(response.body?.message || '', text);
}

const HOUR = 60 * 60 * 1000;
const DEVICE_A = 'device-poc-01';
const DEVICE_B = 'device-poc-02';

function allowancePath(allowanceId) {
  return `${H.BIZ}/branches/${H.BRANCH_A}/offlineAllowances/${allowanceId}`;
}

function ledgerPath() {
  return `${H.BIZ}/branches/${H.BRANCH_A}/meta/offlineStockReservations`;
}

function allowanceItem(productId, quantity = 1) {
  return { productId, quantity, batchAllocations: [{ batchId: H.SPECS[productId].batchId, quantity }] };
}

async function issueAllowance(base, offset = 0, options = {}) {
  hive.setNow(base + offset);
  return hive.issueAllowance({
    token: options.token ?? await hive.tokenFor(options.uid ?? 'cashier-a'),
    body: {
      branchId: options.branchId ?? H.BRANCH_A,
      deviceId: options.deviceId ?? DEVICE_A,
      items: options.items ?? [allowanceItem('P1')],
      ...(options.leaseId ? { leaseId: options.leaseId } : {}),
    },
  });
}

function offlineSale(id, issued, at, overrides = {}) {
  return H.buildSale({
    id,
    items: [H.line('P1')],
    date: new Date(at).toISOString(),
    ...overrides,
  });
}

function offlineBody(sale, issued, options = {}) {
  return {
    branchId: sale.branchId,
    sale,
    allowanceId: issued.body.allowanceId,
    allowanceToken: issued.body.allowanceToken,
    leaseId: issued.body.leaseId,
    deviceId: options.deviceId ?? issued.body.deviceId,
  };
}

async function submitOffline(sale, issued, at, options = {}) {
  hive.setNow(at);
  return attempt(sale, { body: offlineBody(sale, issued, options) });
}

before(async () => {
  emulator = await startEmulator();
  hive = await H.createHarness();
});

beforeEach(async () => {
  await clearDatabase();
  await H.seedAll();
  hive.setNow(Date.now());
  hive.restore('cashier-a');
});

after(async () => {
  const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results.json');
  writeFileSync(output, JSON.stringify(RESULTS, null, 2));
  if (emulator) await emulator.stop();
});

describe('Firebase ID token verification', () => {
  it('rejects a missing token', async () => {
    const sale = H.buildSale({ id: 'AUTH-NO-TOKEN', items: [H.line('P1')] });
    const response = await hive.postSale({ body: { branchId: H.BRANCH_A, sale } });
    assertFailed(response, 401);
    assert.equal(await H.saleExists('AUTH-NO-TOKEN'), null);
  });

  it('rejects a token signed by another key', async () => {
    const sale = H.buildSale({ id: 'AUTH-BAD-SIG', items: [H.line('P1')] });
    const attacker = await H.generateSigningKeys();
    const token = await H.signToken(attacker.privateKey, H.tokenPayload('cashier-a'));
    const response = await attempt(sale, { token });
    assertFailed(response, 401);
  });

  it('rejects a wrong audience and a wrong issuer', async () => {
    const sale = H.buildSale({ id: 'AUTH-AUD', items: [H.line('P1')] });
    const wrongAudience = await hive.tokenFor('cashier-a', { aud: 'another-project' });
    assertFailed(await attempt(sale, { token: wrongAudience }), 401);
    const wrongIssuer = await hive.tokenFor('cashier-a', { iss: 'https://securetoken.google.com/another-project' });
    assertFailed(await attempt(sale, { token: wrongIssuer }), 401);
  });

  it('rejects an expired token', async () => {
    const sale = H.buildSale({ id: 'AUTH-EXPIRED', items: [H.line('P1')] });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await hive.tokenFor('cashier-a', { exp: nowSeconds - 60 });
    assertFailed(await attempt(sale, { token }), 401);
  });

  it('rejects a disabled Cashier member even with a valid token', async () => {
    const sale = H.buildSale({ id: 'AUTH-DISABLED', items: [H.line('P1')], uid: 'cashier-disabled', email: H.EMAILS['cashier-disabled'] });
    assertFailed(await attempt(sale), 403, /Active Cashier/);
  });

  it('rejects a Cashier whose membership belongs to another Branch', async () => {
    const sale = H.buildSale({ id: 'AUTH-BRANCH-MISMATCH', items: [H.line('P1')], uid: 'cashier-b', email: H.EMAILS['cashier-b'] });
    assertFailed(await attempt(sale), 403, /Active Cashier/);
  });

  it('rejects an inactive Branch', async () => {
    const sale = H.buildSale({ id: 'AUTH-INACTIVE-BRANCH', items: [H.line('P1')], branchId: H.BRANCH_C, uid: 'cashier-c', email: H.EMAILS['cashier-c'] });
    assertFailed(await attempt(sale), 403, /Active မဟုတ်/);
  });

  it('rejects a revoked Cashier token before any write', async () => {
    hive.revoke('cashier-a');
    const sale = H.buildSale({ id: 'AUTH-REVOKED', items: [H.line('P1')] });
    const response = await attempt(sale);
    assertFailed(response, 401, /ပယ်ဖျက်/);
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('AUTH-REVOKED'), null);
  });
});

describe('CORS origin enforcement', () => {
  it('keeps the approved origin but still rejects a cross-branch Cashier', async () => {
    const sale = H.buildSale({
      id: 'AUTH-CORS-BRANCH', items: [H.line('P1')],
      uid: 'cashier-b', email: H.EMAILS['cashier-b'],
    });
    const response = await attempt(sale, { request: { origin: H.CORS_ORIGIN } });
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal(response.headers['access-control-allow-origin'], H.CORS_ORIGIN);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
  });
});

describe('Trusted server-issued offline allowance and authorization lease', () => {
  it('accepts a 23-hour offline sale and consumes the reservation', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    assert.equal(issued.body.result, 'issued');
    assert.equal(issued.writes, 4);
    assert.equal(Date.parse(issued.body.expiresAt) - Date.parse(issued.body.issuedAt), 24 * HOUR);
    assert.equal(Date.parse(issued.body.leaseExpiresAt) - Date.parse(issued.body.issuedAt), 72 * HOUR);

    const sale = offlineSale('OFFLINE-23H', issued, base + 23 * HOUR);
    const response = await submitOffline(sale, issued, base + 23 * HOUR);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.result, 'created');
    const doc = await H.saleExists('OFFLINE-23H');
    assert.equal(doc.payload.saleOrigin, 'offline-allowance');
    assert.equal(doc.payload.offlineAllowanceId, issued.body.allowanceId);
    assert.equal(await H.productStock('P1'), 99);
    assert.equal(await H.batchQuantity('B1'), 59);
    const allowance = await H.readDoc(allowancePath(issued.body.allowanceId));
    assert.equal(allowance.payload.status, 'consumed');
    assert.deepEqual(allowance.payload.remaining, []);
    const ledger = await H.readDoc(ledgerPath());
    assert.deepEqual(ledger.payload.byProduct, {});
    record('offline allowance 23h', response);
  });

  it('expires the allowance exactly at 24 hours and keeps stock reserved', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    const sale = offlineSale('OFFLINE-24H', issued, base + 24 * HOUR);
    const response = await submitOffline(sale, issued, base + 24 * HOUR);
    assertFailed(response, 409, /24/);
    assert.equal(response.body.code, 'expired-hold');
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('OFFLINE-24H'), null);
    assert.equal(await H.productStock('P1'), 100);

    const expiry = await hive.expireStale(base + 24 * HOUR);
    assert.ok(expiry.allowancesExpired >= 1, JSON.stringify(expiry));
    const allowance = await H.readDoc(allowancePath(issued.body.allowanceId));
    assert.equal(allowance.payload.status, 'expired-hold');
    const ledger = await H.readDoc(ledgerPath());
    assert.equal(ledger.payload.byProduct.P1, 1);
    record('offline allowance exactly 24h', response);
  });

  it('rejects a 25-hour offline sale and keeps the reservation held', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    const sale = offlineSale('OFFLINE-25H', issued, base + 25 * HOUR);
    const response = await submitOffline(sale, issued, base + 25 * HOUR);
    assertFailed(response, 409, /24/);
    assert.equal(response.body.code, 'expired-hold');
    assert.equal(await H.productStock('P1'), 100);
    const ledger = await H.readDoc(ledgerPath());
    assert.equal(ledger.payload.byProduct.P1, 1);
    record('offline allowance 25h', response);
  });

  it('does not extend the allowance when the device clock moves backwards', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    hive.setNow(base + 25 * HOUR);
    const sale = offlineSale('OFFLINE-CLOCK-BACK', issued, base + 1 * HOUR);
    const response = await submitOffline(sale, issued, base + 25 * HOUR);
    assertFailed(response, 409, /24/);
    assert.equal(response.body.code, 'expired-hold');
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('OFFLINE-CLOCK-BACK'), null);
    assert.equal(await H.productStock('P1'), 100);
    record('device clock moved backwards', response);
  });

  it('rejects a fabricated old sale date without a server-issued allowance', async () => {
    const base = Date.now();
    hive.setNow(base + 25 * HOUR);
    const sale = H.buildSale({ id: 'FABRICATED-OLD', items: [H.line('P1')], date: new Date(base).toISOString() });
    const response = await attempt(sale);
    assertFailed(response, 400, /Allowance/);
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('FABRICATED-OLD'), null);
    assert.equal(await H.productStock('P1'), 100);
    record('fabricated old sale date', response);
  });

  it('returns already-committed for a duplicate retry after the allowance expires', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    const sale = offlineSale('OFFLINE-RETRY', issued, base);
    const first = await submitOffline(sale, issued, base);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    hive.setNow(base + 25 * HOUR);
    const retry = await submitOffline(sale, issued, base + 25 * HOUR);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.result, 'already-committed');
    assert.equal(retry.writes, 0);
    assert.equal(await H.productStock('P1'), 99);
    record('duplicate retry after allowance expiry', retry);
  });

  it('never releases stock automatically and lets the Owner reconcile the hold', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    hive.setNow(base + 25 * HOUR);
    const expiry = await hive.expireStale(base + 25 * HOUR);
    assert.ok(expiry.allowancesExpired >= 1, JSON.stringify(expiry));
    assert.equal(await H.productStock('P1'), 100);
    let ledger = await H.readDoc(ledgerPath());
    assert.equal(ledger.payload.byProduct.P1, 1);

    const sale = offlineSale('OFFLINE-EXPIRED-HOLD', issued, base + 25 * HOUR);
    const blocked = await submitOffline(sale, issued, base + 25 * HOUR);
    assertFailed(blocked, 409, /Owner/);
    assert.equal(blocked.writes, 0);
    ledger = await H.readDoc(ledgerPath());
    assert.equal(ledger.payload.byProduct.P1, 1);
    assert.equal(await H.productStock('P1'), 100);

    const ownerToken = await hive.tokenFor('owner-1');
    const released = await hive.reconcileAllowance({
      token: ownerToken,
      body: { branchId: H.BRANCH_A, allowanceId: issued.body.allowanceId, action: 'release' },
    });
    assert.equal(released.status, 200, JSON.stringify(released.body));
    assert.equal(released.body.result, 'released');
    assert.equal(released.body.releasedItems.length, 1);
    ledger = await H.readDoc(ledgerPath());
    assert.deepEqual(ledger.payload.byProduct, {});
    assert.equal(await H.productStock('P1'), 100);

    const again = await hive.reconcileAllowance({
      token: ownerToken,
      body: { branchId: H.BRANCH_A, allowanceId: issued.body.allowanceId, action: 'release' },
    });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.result, 'already-reconciled');
    assert.equal(again.writes, 0);
    record('expired allowance held and reconciled', released);
  });

  it('rejects reuse of another device\'s allowance', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    const sale = offlineSale('OFFLINE-DEVICE-B', issued, base);
    const response = await submitOffline(sale, issued, base, { deviceId: DEVICE_B });
    assertFailed(response, 403, /Device/);
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('OFFLINE-DEVICE-B'), null);
    assert.equal(await H.productStock('P1'), 100);
    record('allowance reuse from another device', response);
  });

  it('rejects a tampered allowance token', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    const sale = offlineSale('OFFLINE-BAD-TOKEN', issued, base);
    const token = issued.body.allowanceToken;
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    const response = await attempt(sale, {
      body: { ...offlineBody(sale, issued), allowanceToken: tampered },
    });
    assertFailed(response, 403, /Token/);
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('OFFLINE-BAD-TOKEN'), null);
    record('tampered allowance token', response);
  });

  it('does not allow a consumed allowance to be reused for a second sale', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    const first = offlineSale('OFFLINE-ONCE-1', issued, base);
    assert.equal((await submitOffline(first, issued, base)).status, 200);
    const second = offlineSale('OFFLINE-ONCE-2', issued, base);
    const response = await submitOffline(second, issued, base);
    assertFailed(response, 409, /အသုံးပြုပြီးသား/);
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('OFFLINE-ONCE-2'), null);
    assert.equal(await H.productStock('P1'), 99);
    record('consumed allowance reuse', response);
  });

  it('accepts an offline sale at 71 hours with an unexpired authorization lease', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    const renewed = await issueAllowance(base, 60 * HOUR, { leaseId: issued.body.leaseId });
    assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
    assert.equal(renewed.body.leaseId, issued.body.leaseId);
    assert.equal(renewed.body.leaseExpiresAt, issued.body.leaseExpiresAt);
    assert.equal(renewed.writes, 3);

    const sale = offlineSale('LEASE-71H', renewed, base + 71 * HOUR);
    const response = await submitOffline(sale, renewed, base + 71 * HOUR);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.result, 'created');
    assert.equal(await H.productStock('P1'), 99);
    record('authorization lease 71h', response);
  });

  it('expires the authorization lease exactly at 72 hours', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    const renewed = await issueAllowance(base, 60 * HOUR, { leaseId: issued.body.leaseId });
    assert.equal(renewed.status, 200, JSON.stringify(renewed.body));

    hive.setNow(base + 72 * HOUR);
    const expiry = await hive.expireStale(base + 72 * HOUR);
    assert.ok(expiry.leasesExpired >= 1, JSON.stringify(expiry));
    const sale = offlineSale('LEASE-72H', renewed, base + 72 * HOUR);
    const response = await submitOffline(sale, renewed, base + 72 * HOUR);
    assertFailed(response, 401, /72/);
    assert.equal(response.body.code, 'authorization-expired');
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('LEASE-72H'), null);
    assert.equal(await H.productStock('P1'), 100);
    record('authorization lease exactly 72h', response);
  });

  it('rejects an offline sale at 73 hours', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    const renewed = await issueAllowance(base, 60 * HOUR, { leaseId: issued.body.leaseId });
    hive.setNow(base + 73 * HOUR);
    const sale = offlineSale('LEASE-73H', renewed, base + 73 * HOUR);
    const response = await submitOffline(sale, renewed, base + 73 * HOUR);
    assertFailed(response, 401, /72/);
    assert.equal(response.body.code, 'authorization-expired');
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('LEASE-73H'), null);
    record('authorization lease 73h', response);
  });

  it('rejects an inactive Cashier both at issuance and at commit', async () => {
    const base = Date.now();
    const issued = await issueAllowance(base);
    const member = await H.readDoc(`${H.BIZ}/members/cashier-a`);
    await H.writeDocs([[`${H.BIZ}/members/cashier-a`, { ...member, status: 'disabled' }]]);

    const sale = offlineSale('OFFLINE-DISABLED', issued, base);
    const response = await submitOffline(sale, issued, base);
    assertFailed(response, 403, /Active Cashier/);
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('OFFLINE-DISABLED'), null);
    assert.equal(await H.productStock('P1'), 100);

    const reissue = await issueAllowance(base);
    assertFailed(reissue, 403, /Active Cashier/);
    record('inactive cashier offline commit', response);
  });

  it('rejects a wrong Branch for both allowance issuance and commit', async () => {
    const base = Date.now();
    const wrongIssue = await issueAllowance(base, 0, { branchId: H.BRANCH_B });
    assertFailed(wrongIssue, 403, /Active Cashier/);

    hive.setNow(base);
    const sale = H.buildSale({ id: 'ONLINE-WRONG-BRANCH', items: [H.line('P1')], branchId: H.BRANCH_B });
    const response = await attempt(sale);
    assertFailed(response, 403, /Active Cashier/);
    assert.equal(response.writes, 0);
    assert.equal(await H.saleExists('ONLINE-WRONG-BRANCH'), null);
    record('wrong branch rejection', response);
  });
});

describe('Line capacity and atomic writes', () => {
  it('commits a 1-line sale and updates stock, batch, and audit together', async () => {
    const sale = H.buildSale({ id: 'LINE-1', items: [H.line('P1')] });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.result, 'created');
    const doc = await H.saleExists('LINE-1');
    assert.equal(doc.payload.total, 1000);
    assert.equal(doc.payload.branchId, H.BRANCH_A);
    assert.equal(doc.payload.serverSaleDay.length, 10);
    assert.equal(doc.payload.cashierSyncVersion, 2);
    assert.equal(doc.payload.unitSaleVersion, 1);
    assert.ok(doc.payload.saleFingerprint);
    assert.equal(await H.productStock('P1'), 99);
    assert.equal(await H.batchQuantity('B1'), 59);
    const audit = await H.auditDoc('LINE-1');
    assert.equal(audit.eventType, 'SALE_CREATED');
    assert.equal(audit.total, 1000);
    assert.equal(audit.actorUid, 'cashier-a');
    record('1 line', response);
    assert.equal(response.reads, 9);
    assert.equal(response.writes, 4);
  });

  it('commits a 5-line sale', async () => {
    const sale = H.buildSale({ id: 'LINE-5', items: ['P1', 'P2', 'P3', 'P4', 'P5'].map((id) => H.line(id)) });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.writes, 13);
    assert.equal(await H.productStock('P1'), 99);
    assert.equal(await H.productStock('P5'), 19.5);
    const units = await H.registryUnits();
    assert.equal(units.find((unit) => unit.id === 'U1').status, 'sold');
    record('5 lines', response);
  });

  it('commits a 10-line sale', async () => {
    const items = Array.from({ length: 10 }, (_, index) => H.line(`P${index + 1}`));
    const sale = H.buildSale({ id: 'LINE-10', items });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.writes, 23);
    record('10 lines', response);
  });

  it('commits a 20-line sale (no artificial 3/4-line cap)', async () => {
    const items = Array.from({ length: 20 }, (_, index) => H.line(`P${index + 1}`));
    const sale = H.buildSale({ id: 'LINE-20', items });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.writes, 43);
    assert.equal(await H.productStock('P20'), 99);
    const doc = await H.saleExists('LINE-20');
    assert.equal(doc.payload.items.length, 20);
    record('20 lines', response);
  });

  it('handles multi-quantity of one product across two batches', async () => {
    const sale = H.buildSale({
      id: 'MULTI-QTY',
      items: [H.line('P1', { quantity: 3, batchAllocations: [{ batchId: 'B1', quantity: 2 }, { batchId: 'B2', quantity: 1 }] })],
    });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await H.productStock('P1'), 97);
    assert.equal(await H.batchQuantity('B1'), 58);
    assert.equal(await H.batchQuantity('B2'), 39);
    record('multi-qty same product', response);
  });

  it('handles multiple batches across multiple products', async () => {
    const sale = H.buildSale({
      id: 'MULTI-BATCH',
      items: [
        H.line('P1', { quantity: 3, batchAllocations: [{ batchId: 'B1', quantity: 1 }, { batchId: 'B2', quantity: 2 }] }),
        H.line('P2', { quantity: 2, batchAllocations: [{ batchId: 'B3', quantity: 2 }] }),
      ],
    });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(await H.batchQuantity('B1'), 59);
    assert.equal(await H.batchQuantity('B2'), 38);
    assert.equal(await H.batchQuantity('B3'), 48);
    record('multi-batch across products', response);
  });

  it('sells sticker barcodes and marks exactly those units sold', async () => {
    const sale = H.buildSale({ id: 'UNIT-2', items: [H.line('P3', { quantity: 2 })] });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const units = await H.registryUnits();
    const byId = Object.fromEntries(units.map((unit) => [unit.id, unit]));
    assert.equal(byId.U1.status, 'sold');
    assert.equal(byId.U2.status, 'sold');
    assert.equal(byId.U3.status, 'in_stock');
    assert.equal(byId.U1.saleId, 'UNIT-2');
    assert.equal(byId.U1.soldByUid, 'cashier-a');
    assert.equal(await H.productStock('P3'), 8);
    assert.equal(await H.batchQuantity('B4'), 8);
    record('sticker barcode sale', response);
  });

  it('rejects a duplicate barcode inside one receipt without partial writes', async () => {
    const sale = H.buildSale({
      id: 'DUP-UNIT-IN-RECEIPT',
      items: [H.line('P3', { quantity: 2, units: [
        H.unitSelection('REG-P3-1', 'U1', 'BC-U1', 'B4'),
        H.unitSelection('REG-P3-1', 'U1', 'BC-U1', 'B4'),
      ] })],
    });
    const response = await attempt(sale);
    assertFailed(response, 409, /နှစ်ကြိမ်/);
    assert.equal(await H.productStock('P3'), 10);
    assert.equal((await H.registryUnits()).find((unit) => unit.id === 'U1').status, 'in_stock');
    assert.equal(await H.saleExists('DUP-UNIT-IN-RECEIPT'), null);
    record('duplicate barcode in receipt', response);
  });

  it('rejects an already-sold unit', async () => {
    const sale = H.buildSale({
      id: 'UNIT-ALREADY-SOLD',
      items: [H.line('P3', { quantity: 1, units: [H.unitSelection('REG-P3-1', 'U4', 'BC-U4', 'B4')] })],
    });
    const response = await attempt(sale);
    assertFailed(response, 409, /မရှိတော့/);
    assert.equal(await H.saleExists('UNIT-ALREADY-SOLD'), null);
    record('already-sold unit', response);
  });

  it('rejects a unit that belongs to another Branch', async () => {
    const sale = H.buildSale({
      id: 'UNIT-WRONG-BRANCH',
      items: [H.line('P3', {
        quantity: 1,
        noAllocation: true,
        units: [H.unitSelection('REG-P3-B', 'UB1', 'BC-UB1', 'B4B')],
      })],
    });
    const response = await attempt(sale);
    assertFailed(response, 409, /မတွေ့/);
    assert.equal(await H.saleExists('UNIT-WRONG-BRANCH'), null);
    record('wrong-branch barcode', response);
  });
});

describe('Server validation of stock, batch, price, totals', () => {
  it('rejects insufficient product stock and leaves stock unchanged', async () => {
    const sale = H.buildSale({ id: 'STOCK-LOW', items: [H.line('P2', { quantity: 60 })] });
    const response = await attempt(sale);
    assertFailed(response, 409, /မလုံလောက်/);
    assert.equal(await H.productStock('P2'), 50);
    record('insufficient stock', response);
  });

  it('rejects an expired batch using the server branch day', async () => {
    const sale = H.buildSale({ id: 'BATCH-EXPIRED', items: [H.line('PEXP')] });
    const response = await attempt(sale);
    assertFailed(response, 409, /Expiry/);
    assert.equal(await H.batchQuantity('BEXP'), 10);
    record('expired batch', response);
  });

  it('rejects a client price that differs from trusted Product price', async () => {
    const sale = H.buildSale({ id: 'PRICE-WRONG', items: [H.line('P1', { unitPrice: 900 })] });
    const response = await attempt(sale);
    assertFailed(response, 409, /ဈေးနှုန်း/);
    assert.equal(await H.productStock('P1'), 100);
    record('client wrong price', response);
  });

  it('rejects a client cost price that differs from trusted Product cost', async () => {
    const sale = H.buildSale({ id: 'COST-WRONG', items: [H.line('P1', { costPrice: 1 })] });
    const response = await attempt(sale);
    assertFailed(response, 409, /ကုန်ကျစရိတ်/);
    record('client wrong cost', response);
  });

  it('rejects a wrong subtotal even when total = subtotal - discount holds', async () => {
    const sale = H.buildSale({ id: 'SUBTOTAL-WRONG', items: [H.line('P1')] });
    sale.subtotal += 100;
    sale.total += 100;
    sale.paidAmount += 100;
    sale.profit += 100;
    const response = await attempt(sale);
    assertFailed(response, 400, /Subtotal/);
    assert.equal(await H.saleExists('SUBTOTAL-WRONG'), null);
    record('client wrong subtotal', response);
  });

  it('rejects a Cashier discount above the configured cap', async () => {
    const sale = H.buildSale({ id: 'DISCOUNT-CAP', items: [H.line('P1')], discount: 200 });
    const response = await attempt(sale);
    assertFailed(response, 400, /Discount/);
    record('discount above cap', response);
  });

  it('rejects a stale shared price-group version', async () => {
    const sale = H.buildSale({ id: 'PRICE-GROUP-STALE', items: [H.line('P4', { priceVersion: 1 })] });
    const response = await attempt(sale);
    assertFailed(response, 409, /ပြောင်းလဲ/);
    record('stale price group version', response);
  });

  it('accepts the trusted shared price-group version', async () => {
    const sale = H.buildSale({ id: 'PRICE-GROUP-OK', items: [H.line('P4', { mode: 'wholesale' })] });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const doc = await H.saleExists('PRICE-GROUP-OK');
    assert.equal(doc.payload.total, 3600);
    assert.equal(doc.payload.items[0].priceVersion, 2);
    record('price group valid', response);
  });

  it('keeps an invalid multi-line receipt fully atomic', async () => {
    const sale = H.buildSale({ id: 'ATOMIC-MIX', items: [H.line('P1'), H.line('P2', { quantity: 999 })] });
    const response = await attempt(sale);
    assertFailed(response, 409, /မလုံလောက်/);
    assert.equal(await H.productStock('P1'), 100);
    assert.equal(await H.productStock('P2'), 50);
    assert.equal(await H.batchQuantity('B1'), 60);
    assert.equal(await H.saleExists('ATOMIC-MIX'), null);
    assert.equal(await H.auditDoc('ATOMIC-MIX'), null);
    record('atomic mixed-line failure', response);
  });
});

describe('Strict request allowlists', () => {
  it('rejects unknown Sale, Item, and body fields', async () => {
    const withSaleField = H.buildSale({ id: 'STRICT-SALE', items: [H.line('P1')] });
    withSaleField.adminOverride = true;
    let response = await attempt(withSaleField);
    assertFailed(response, 400, /ခွင့်မပြုထားသော Field/);

    const withItemField = H.buildSale({ id: 'STRICT-ITEM', items: [H.line('P1')] });
    withItemField.items[0].extraDiscount = 500;
    response = await attempt(withItemField);
    assertFailed(response, 400, /ခွင့်မပြုထားသော Field/);

    const sale = H.buildSale({ id: 'STRICT-BODY', items: [H.line('P1')] });
    response = await attempt(sale, { body: { branchId: H.BRANCH_A, uid: 'owner-1', sale } });
    assertFailed(response, 400, /uid/);
    assert.equal(await H.saleExists('STRICT-BODY'), null);
    record('strict allowlist rejection', response);
  });

  it('rejects a Sale date beyond the future clock skew', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const sale = H.buildSale({ id: 'FUTURE-DATE', items: [H.line('P1')], date: future });
    const response = await attempt(sale);
    assertFailed(response, 400, /အချိန်/);
    record('future-dated sale', response);
  });

  it('reaches only POST /api/sales/commit', async () => {
    const token = await hive.tokenFor('cashier-a');
    const wrongMethod = await hive.postSale({ token, method: 'GET', body: undefined });
    assert.equal(wrongMethod.status, 405);
    const wrongPath = await hive.postSale({ token, path: '/api/other', body: {} });
    assert.equal(wrongPath.status, 404);
  });
});

describe('Idempotency, retries and concurrency', () => {
  it('acknowledges the same Sale ID and fingerprint without a second write', async () => {
    const sale = H.buildSale({ id: 'IDEMPOTENT-1', items: [H.line('P1')] });
    const first = await attempt(sale);
    assert.equal(first.status, 200);
    assert.equal(first.body.result, 'created');
    const second = await attempt(sale);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.result, 'already-committed');
    assert.equal(second.writes, 0);
    assert.equal(await H.productStock('P1'), 99);
    assert.equal(await H.batchQuantity('B1'), 59);
    record('repeated request (same fingerprint)', second);
  });

  it('rejects the same Sale ID with a different fingerprint', async () => {
    const sale = H.buildSale({ id: 'IDEMPOTENT-CONFLICT', items: [H.line('P1')] });
    assert.equal((await attempt(sale)).status, 200);
    const conflicting = H.buildSale({ id: 'IDEMPOTENT-CONFLICT', items: [H.line('P1', { quantity: 2 })] });
    const response = await attempt(conflicting);
    assertFailed(response, 409, /မတူ/);
    assert.equal(await H.productStock('P1'), 99);
    record('same Sale ID different payload', response);
  });

  it('still acknowledges a committed sale after the membership is disabled', async () => {
    const sale = H.buildSale({ id: 'IDEMPOTENT-DISABLED', items: [H.line('P1')] });
    assert.equal((await attempt(sale)).status, 200);
    const member = await H.readDoc(`${H.BIZ}/members/cashier-a`);
    await H.writeDocs([[`${H.BIZ}/members/cashier-a`, { ...member, status: 'disabled' }]]);
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.result, 'already-committed');
  });

  it('still acknowledges a committed sale after the authorization lease expires', async () => {
    const base = Date.now();
    hive.setNow(base);
    const issued = await issueAllowance(base);
    const sale = offlineSale('IDEMPOTENT-LEASE', issued, base);
    assert.equal((await submitOffline(sale, issued, base)).status, 200);
    hive.setNow(base + 73 * HOUR);
    const response = await submitOffline(sale, issued, base + 73 * HOUR);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.result, 'already-committed');
    assert.equal(response.writes, 0);
    assert.equal(await H.productStock('P1'), 99);
    record('replay acknowledged after lease expiry', response);
  });

  it('prevents two Cashiers from selling the same unit twice', async () => {
    const a = H.buildSale({ id: 'RACE-UNIT-A', items: [H.line('P3')], uid: 'cashier-a', email: H.EMAILS['cashier-a'] });
    const b = H.buildSale({ id: 'RACE-UNIT-B', items: [H.line('P3')], uid: 'cashier-a2', email: H.EMAILS['cashier-a2'] });
    const [first, second] = await Promise.all([attempt(a), attempt(b)]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify([first.body, second.body]));
    assert.equal(await H.productStock('P3'), 9);
    assert.equal(await H.batchQuantity('B4'), 9);
    const units = await H.registryUnits();
    assert.equal(units.filter((unit) => unit.status === 'sold' && unit.saleId?.startsWith('RACE-UNIT')).length, 1);
    const sales = await Promise.all([H.saleExists('RACE-UNIT-A'), H.saleExists('RACE-UNIT-B')]);
    assert.equal(sales.filter(Boolean).length, 1);
    record('two Cashiers, one unit', first.status === 409 ? second : first, {
      secondStatus: first.status === 409 ? first.status : second.status,
    });
  });

  it('prevents two sales from overdrawing the same limited stock', async () => {
    const a = H.buildSale({ id: 'RACE-STOCK-A', items: [H.line('P2', { quantity: 40 })], uid: 'cashier-a', email: H.EMAILS['cashier-a'] });
    const b = H.buildSale({ id: 'RACE-STOCK-B', items: [H.line('P2', { quantity: 40 })], uid: 'cashier-a2', email: H.EMAILS['cashier-a2'] });
    const [first, second] = await Promise.all([attempt(a), attempt(b)]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify([first.body, second.body]));
    assert.equal(await H.productStock('P2'), 10);
    assert.equal(await H.batchQuantity('B3'), 10);
    record('two sales, limited stock', first.status === 409 ? second : first);
  });

  it('returns already-committed after the commit response is lost and the client retries', async () => {
    const sale = H.buildSale({ id: 'TIMEOUT-AFTER-COMMIT', items: [H.line('P1')] });
    hive.fetchImpl.state.dropCommitResponseOnce = true;
    const lost = await attempt(sale);
    assert.equal(lost.status, 500);
    assert.ok(await H.saleExists('TIMEOUT-AFTER-COMMIT'));
    assert.equal(await H.productStock('P1'), 99);
    const retry = await attempt(sale);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.result, 'already-committed');
    assert.equal(retry.writes, 0);
    assert.equal(await H.productStock('P1'), 99);
    record('timeout after commit + retry', retry);
  });
});

describe('KPay and Credit', () => {
  it('accepts a valid KPay reference and stores a lowercase lookup key', async () => {
    const sale = H.buildSale({ id: 'KPAY-OK', items: [H.line('P1')], paymentMethod: 'KPay', kpayReference: 'KP-2026-0001' });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const doc = await H.saleExists('KPAY-OK');
    assert.equal(doc.payload.kpayTransactionReference, 'KP-2026-0001');
    assert.equal(doc.payload.kpayReferenceKey, 'kp-2026-0001');
    record('KPay valid', response);
  });

  it('rejects a malformed KPay reference', async () => {
    const sale = H.buildSale({ id: 'KPAY-BAD', items: [H.line('P1')], paymentMethod: 'KPay', kpayReference: 'AB' });
    const response = await attempt(sale);
    assertFailed(response, 400, /KPay/);
    record('KPay invalid reference', response);
  });

  it('rejects a reused KPay reference', async () => {
    const first = H.buildSale({ id: 'KPAY-FIRST', items: [H.line('P1')], paymentMethod: 'KPay', kpayReference: 'KP-REUSE-01' });
    assert.equal((await attempt(first)).status, 200);
    const second = H.buildSale({ id: 'KPAY-SECOND', items: [H.line('P2')], paymentMethod: 'KPay', kpayReference: 'KP-REUSE-01' });
    const response = await attempt(second);
    assertFailed(response, 409, /အသုံးပြုပြီးသား/);
    assert.equal(await H.productStock('P2'), 50);
    record('KPay reference reused', response);
  });

  it('applies a Credit sale to an existing shared customer', async () => {
    const sale = H.buildSale({
      id: 'CREDIT-EXISTING', items: [H.line('P1', { quantity: 2 })], paymentMethod: 'Credit',
      customerId: 'CUST1', paidAmount: 500, dueAmount: 1500,
    });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const doc = await H.saleExists('CREDIT-EXISTING');
    assert.equal(doc.payload.customerSnapshot.id, 'CUST1');
    assert.equal(doc.payload.customerSnapshot.name, 'Daw Hla');
    assert.equal(doc.payload.dueAmount, 1500);
    const customer = await H.customerDoc('CUST1');
    assert.equal(customer.payload.name, 'Daw Hla');
    record('Credit existing customer', response);
  });

  it('creates a shared customer for a new Credit customer', async () => {
    const sale = H.buildSale({
      id: 'CREDIT-NEW', items: [H.line('P1')], paymentMethod: 'Credit',
      customerId: 'CUST-NEW', paidAmount: 0, dueAmount: 1000,
      customerSnapshot: { id: 'CUST-NEW', name: 'U Aung', phone: '091111111', address: 'Mandalay', note: '', createdAt: '2026-01-01T00:00:00.000Z' },
    });
    const response = await attempt(sale);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const customer = await H.customerDoc('CUST-NEW');
    assert.equal(customer.payload.name, 'U Aung');
    assert.equal(customer.payload.phone, '091111111');
    assert.notEqual(customer.payload.createdAt, '2026-01-01T00:00:00.000Z');
    record('Credit new customer', response);
  });

  it('rejects a Credit sale without a customer', async () => {
    const sale = H.buildSale({ id: 'CREDIT-NO-CUSTOMER', items: [H.line('P1')], paymentMethod: 'Credit' });
    const response = await attempt(sale);
    assertFailed(response, 400, /Customer ID/);
    record('Credit without customer', response);
  });
});
