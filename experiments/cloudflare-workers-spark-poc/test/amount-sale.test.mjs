import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest } from '../src/domain/sale.js';
import { commitSaleOnce } from '../src/domain/commitSale.js';

const identity = { uid: 'cashier-a', email: 'cashier.a@example.com', name: 'Cashier A' };

test('parseRequest accepts amountBased item field for decimal cigarette/bundle sales', () => {
  const now = new Date('2026-11-24T08:00:00.000Z');
  const parsed = parseRequest({
    branchId: 'branch-a',
    sale: {
      id: 'SALE-AMT-1',
      branchId: 'branch-a',
      receiptNo: 'R-AMT-1',
      date: now.toISOString(),
      customer: 'Walk-in',
      paymentMethod: 'Cash',
      cashReceivedAmount: 500,
      changeAmount: 0,
      paidAmount: 500,
      dueAmount: 0,
      subtotal: 500,
      discount: 0,
      total: 500,
      profit: 125,
      status: 'completed',
      createdByUid: 'cashier-a',
      items: [{
        productId: 'prod-cig-1',
        name: 'Cigarette Bundle',
        sku: 'CIG-1',
        quantity: 0.5,
        unitPrice: 1000,
        costPrice: 750,
        mode: 'retail',
        unit: 'ထုပ်',
        quantityMode: 'decimal',
        amountBased: true,
      }],
    },
  }, identity, now);

  assert.equal(parsed.items[0].amountBased, true);
  assert.equal(parsed.productDeltas.get('prod-cig-1'), 0.5);
});

test('commitSaleOnce aligns 4-decimal subtotal, total, and profit rounding with client cleanCurrencyAmount', async () => {
  const now = new Date('2026-11-24T08:00:00.000Z');
  // 0.333 * 123.45 = 41.10885 -> client cleanCurrencyAmount rounds to 41.1089 (diff 5e-5 > 1e-6)
  // profit: (123.45 - 80.12) * 0.333 = 14.42889 -> client cleanCurrencyAmount rounds to 14.4289 (diff 1e-5 > 1e-6)
  const unitPrice = 123.45;
  const costPrice = 80.12;
  const quantity = 0.333;
  const subtotal = Math.round(unitPrice * quantity * 10000) / 10000;
  const profit = Math.round((unitPrice - costPrice) * quantity * 10000) / 10000;

  const docs = new Map([
    ['businesses/biz-1', { data: { active: true } }],
    ['businesses/biz-1/members/cashier-a', {
      data: { uid: 'cashier-a', role: 'cashier', status: 'active', email: 'cashier.a@example.com', branchIds: ['branch-a'] },
    }],
    ['businesses/biz-1/branches/branch-a', { data: { payload: { status: 'active' } } }],
    ['businesses/biz-1/meta/settings', { data: { payload: { maxCashierDiscountPercent: 10 } } }],
    ['businesses/biz-1/branches/branch-a/products/prod-cig-1', {
      data: {
        deleted: false,
        payload: {
          id: 'prod-cig-1',
          branchId: 'branch-a',
          name: 'Cigarette Bundle',
          retailPrice: unitPrice,
          wholesalePrice: 110,
          costPrice,
          stock: 10,
          quantityMode: 'decimal',
        },
      },
    }],
  ]);

  let committedWrites = [];
  const fs = {
    async beginTransaction() { return 'tx-1'; },
    async batchGet(paths) {
      const result = new Map();
      for (const p of paths) {
        if (docs.has(p)) result.set(p, docs.get(p));
      }
      return result;
    },
    async runQuery() { return []; },
    async commit(_tx, writes) { committedWrites = writes; },
    async rollback() {},
  };

  const outcome = await commitSaleOnce({
    fs,
    businessId: 'biz-1',
    identity,
    serverNow: now,
    body: {
      branchId: 'branch-a',
      sale: {
        id: 'SALE-DEC-1',
        branchId: 'branch-a',
        receiptNo: 'R-DEC-1',
        date: now.toISOString(),
        customer: 'Walk-in',
        paymentMethod: 'Cash',
        cashReceivedAmount: 42,
        changeAmount: 0.8911,
        paidAmount: subtotal,
        dueAmount: 0,
        subtotal,
        discount: 0,
        total: subtotal,
        profit,
        status: 'completed',
        createdByUid: 'cashier-a',
        items: [{
          productId: 'prod-cig-1',
          name: 'Cigarette Bundle',
          sku: 'CIG-1',
          quantity,
          unitPrice,
          costPrice,
          mode: 'retail',
          unit: 'ထုပ်',
          quantityMode: 'decimal',
          amountBased: true,
        }],
      },
    },
  });

  assert.equal(outcome.result, 'created');
  const saleWrite = committedWrites.find((w) => w.path.endsWith('/sales/SALE-DEC-1'));
  assert.ok(saleWrite);
  assert.equal(saleWrite.data.payload.subtotal, subtotal);
  assert.equal(saleWrite.data.payload.total, subtotal);
  assert.equal(saleWrite.data.payload.profit, profit);
});
