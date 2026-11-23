import test, { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startEmulator, clearDatabase } from './emulator.mjs';
import * as H from './helpers.mjs';

let emulator;
let hive;

const BRANCH = H.BRANCH_A;
const DEVICE = 'poc-device-adjust-01';
const REASON = 'Cashier confirmed customer request';

function salePath(saleId) {
  return `${H.BIZ}/branches/${BRANCH}/sales/${saleId}`;
}

async function patchDoc(path, mutate) {
  const data = await H.readDoc(path);
  if (!data) throw new Error(`Missing fixture document: ${path}`);
  mutate(data);
  await H.writeDocs([[path, data]]);
}

async function seedSale(sale, { productId = 'P1', stock, batchId, batchQuantity, units } = {}) {
  await H.writeDocs([[salePath(sale.id), {
    scope: 'branchRecord', kind: 'sales', branchId: BRANCH, deleted: false,
    updatedAt: sale.date, updatedBy: sale.createdByUid, payload: sale,
  }]]);
  if (stock !== undefined) {
    await patchDoc(`${H.BIZ}/branches/${BRANCH}/products/${productId}`, (data) => { data.payload.stock = stock; });
  }
  if (batchId && batchQuantity !== undefined) {
    await patchDoc(`${H.BIZ}/branches/${BRANCH}/stockBatches/${batchId}`, (data) => { data.payload.quantity = batchQuantity; });
  }
  if (units) {
    await patchDoc(`${H.BIZ}/branches/${BRANCH}/stockUnitRegistries/REG-P3-1`, (data) => {
      data.payload.units = data.payload.units.map((unit) => units[unit.id] ?? unit);
    });
  }
}

async function post(path, body, { uid = 'cashier-a', token } = {}) {
  return hive.postSale({ token: token ?? await hive.tokenFor(uid), body, path });
}

function voidBody(saleId, requestId) {
  return { branchId: BRANCH, saleId, requestId, reason: REASON, deviceId: DEVICE };
}

function returnBody(saleId, requestId, items) {
  return { branchId: BRANCH, saleId, requestId, reason: REASON, deviceId: DEVICE, items };
}

async function readSale(saleId) {
  return (await H.readDoc(salePath(saleId)))?.payload ?? null;
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
  if (emulator) await emulator.stop();
});

describe('Worker POC Cashier Void', () => {
  it('voids a synced sale, restores stock and is idempotent on retry', async () => {
    const sale = H.buildSale({ id: 'POC-VOID-1', items: [H.line('P1', { quantity: 2 })] });
    await seedSale(sale);
    const body = voidBody(sale.id, 'void-req-0001');

    const first = await post('/api/sales/void', body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.result, 'created');
    assert.equal(first.body.refundStatus, 'cash-refunded');
    assert.equal(await H.productStock('P1'), 102);
    assert.equal(await H.batchQuantity('B1'), 62);
    const voided = await readSale(sale.id);
    assert.equal(voided.status, 'voided');
    assert.equal(voided.voidRefundStatus, 'cash-refunded');
    assert.equal(voided.voidRequestId, 'void-req-0001');
    assert.ok(await H.readDoc(`${H.BIZ}/branches/${BRANCH}/auditEvents/${sale.id}__void`));

    const replay = await post('/api/sales/void', body);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.result, 'already-committed');
    assert.equal(replay.body.refundStatus, 'cash-refunded');
    assert.equal(await H.productStock('P1'), 102);
    assert.equal(await H.batchQuantity('B1'), 62);
  });

  it('rejects a different request against an already voided sale', async () => {
    const sale = H.buildSale({ id: 'POC-VOID-2', items: [H.line('P1')] });
    await seedSale(sale);
    assert.equal((await post('/api/sales/void', voidBody(sale.id, 'void-req-0002'))).status, 200);
    const second = await post('/api/sales/void', voidBody(sale.id, 'void-req-0003'));
    assert.equal(second.status, 409, JSON.stringify(second.body));
    assert.match(second.body.message, /ပယ်ဖျက်ထားပြီး/);
  });

  it('rejects a disabled cashier and a foreign branch', async () => {
    const sale = H.buildSale({ id: 'POC-VOID-3', items: [H.line('P1')] });
    await seedSale(sale);
    const disabled = await post('/api/sales/void', voidBody(sale.id, 'void-req-0004'), { uid: 'cashier-disabled' });
    assert.equal(disabled.status, 403, JSON.stringify(disabled.body));
    const foreign = await post('/api/sales/void', voidBody(sale.id, 'void-req-0005'), { uid: 'cashier-b' });
    assert.equal(foreign.status, 403, JSON.stringify(foreign.body));
    assert.equal((await readSale(sale.id)).status, 'completed');
  });
});

describe('Worker POC Cashier Return', () => {
  function trackedSale() {
    return H.buildSale({
      id: 'POC-RETURN-1',
      items: [H.line('P3', {
        quantity: 2,
        units: [H.unitSelection('REG-P3-1', 'U1', 'BC-U1', 'B4'), H.unitSelection('REG-P3-1', 'U2', 'BC-U2', 'B4')],
      })],
    });
  }

  async function seedTrackedSale(sale) {
    await seedSale(sale, {
      productId: 'P3', stock: 8, batchId: 'B4', batchQuantity: 8,
      units: {
        U1: { id: 'U1', barcode: 'BC-U1', status: 'sold', saleId: sale.id, soldAt: sale.date, soldByUid: 'cashier-a', batchId: 'B4' },
        U2: { id: 'U2', barcode: 'BC-U2', status: 'sold', saleId: sale.id, soldAt: sale.date, soldByUid: 'cashier-a', batchId: 'B4' },
      },
    });
  }

  it('restocks saleable units, quarantines damaged units and replays idempotently', async () => {
    const sale = trackedSale();
    await seedTrackedSale(sale);
    const body = returnBody(sale.id, 'return-req-0001', [{
      productId: 'P3', quantity: 2, disposition: 'restock',
      units: [
        { registryId: 'REG-P3-1', unitId: 'U1', disposition: 'restock' },
        { registryId: 'REG-P3-1', unitId: 'U2', disposition: 'damaged' },
      ],
    }]);

    const first = await post('/api/sales/return', body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.result, 'created');
    assert.equal(first.body.value, 1000);
    assert.equal(first.body.refundStatus, 'cash-refunded');
    assert.equal(first.body.items.length, 1);
    assert.deepEqual(first.body.items[0].batchAllocations, [{ batchId: 'B4', quantity: 1 }]);
    assert.equal(await H.productStock('P3'), 9);
    assert.equal(await H.batchQuantity('B4'), 9);

    const units = await H.registryUnits();
    const u1 = units.find((unit) => unit.id === 'U1');
    const u2 = units.find((unit) => unit.id === 'U2');
    assert.equal(u1.status, 'in_stock');
    assert.equal(u1.saleId, undefined);
    assert.equal(u2.status, 'damaged');
    assert.equal(u2.damageReason, REASON);
    assert.equal(u2.saleId, undefined);

    const returned = await readSale(sale.id);
    assert.equal(returned.returnCount, 1);
    assert.equal(returned.returnedTotal, 1000);
    assert.deepEqual(returned.returnedProductQuantities, { P3: 2 });
    assert.deepEqual(returned.returnedBatchQuantities, { B4: 2 });

    const replay = await post('/api/sales/return', body);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.result, 'already-committed');
    assert.equal(replay.body.items.length, 1);
    assert.deepEqual(replay.body.returnedProductQuantities, { P3: 2 });
    assert.equal(await H.productStock('P3'), 9);
    assert.equal(await H.batchQuantity('B4'), 9);
  });

  it('rejects over-return, duplicate units and void after return', async () => {
    const sale = trackedSale();
    await seedTrackedSale(sale);
    const over = await post('/api/sales/return', returnBody(sale.id, 'return-req-0002', [{
      productId: 'P3', quantity: 3, disposition: 'restock',
      units: ['U1', 'U2', 'U3'].map((unitId) => ({ registryId: 'REG-P3-1', unitId, disposition: 'restock' })),
    }]));
    assert.equal(over.status, 409, JSON.stringify(over.body));

    const duplicated = await post('/api/sales/return', returnBody(sale.id, 'return-req-0003', [{
      productId: 'P3', quantity: 2, disposition: 'restock',
      units: [
        { registryId: 'REG-P3-1', unitId: 'U1', disposition: 'restock' },
        { registryId: 'REG-P3-1', unitId: 'U1', disposition: 'restock' },
      ],
    }]));
    assert.equal(duplicated.status, 409, JSON.stringify(duplicated.body));

    const accepted = await post('/api/sales/return', returnBody(sale.id, 'return-req-0004', [{
      productId: 'P3', quantity: 1, disposition: 'restock',
      units: [{ registryId: 'REG-P3-1', unitId: 'U1', disposition: 'restock' }],
    }]));
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

    const voidAfter = await post('/api/sales/void', voidBody(sale.id, 'void-req-0006'));
    assert.equal(voidAfter.status, 409, JSON.stringify(voidAfter.body));
    assert.match(voidAfter.body.message, /Return/);
  });

  it('applies a Credit return to the outstanding balance', async () => {
    const sale = H.buildSale({
      id: 'POC-RETURN-CREDIT', items: [H.line('P1', { quantity: 2 })],
      paymentMethod: 'Credit', customerId: 'CUST1', paidAmount: 1000, dueAmount: 1000,
    });
    await seedSale(sale);
    const response = await post('/api/sales/return', returnBody(sale.id, 'return-req-0005', [{
      productId: 'P1', quantity: 1, disposition: 'restock',
    }]), { uid: 'cashier-a' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.value, 1000);
    assert.equal(response.body.refundStatus, 'credit-adjusted');
    assert.equal(response.body.dueAmount, 0);
    const returned = await readSale(sale.id);
    assert.equal(returned.dueAmount, 0);
    assert.equal(returned.paymentMethod, 'Credit');
  });
});
