import test from 'node:test';
import assert from 'node:assert/strict';
import { usePosStore } from '../.qa-build/usePosStore.mjs';
import { makeReceiptNo } from '../.qa-build/receiptNumber.mjs';

const baseSettings = usePosStore.getState().settings;
const branch = {
  id: 'branch-main', name: 'Main', code: 'MAIN', address: '', phone: '',
  status: 'active', isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  settings: { ...baseSettings, storeName: 'Test Store', kpayEnabled: false },
};
const actor = { uid: 'owner-1', name: 'Owner', email: 'owner@example.test' };

function makeProduct(stock) {
  return {
    id: 'p1', branchId: branch.id, name: 'Rice', sku: 'SKU1', barcode: '',
    category: 'Food', costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400,
    stock, lowStockAt: 2, unit: 'ခု', quantityMode: 'whole',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeBatch(id, quantity) {
  return {
    id, branchId: branch.id, productId: 'p1', purchaseId: '', supplierId: '',
    quantity, receivedAt: '2026-01-01T00:00:00.000Z', expiryDate: '', unitCost: 1000,
  };
}

function line(quantity, batchAllocations) {
  return {
    productId: 'p1', name: 'Rice', sku: 'SKU1', quantity, unitPrice: 1500,
    costPrice: 1000, mode: 'retail', stockAtAdd: quantity, unit: 'ခု', quantityMode: 'whole',
    ...(batchAllocations ? { batchAllocations } : {}),
  };
}

function makeSale(overrides) {
  return {
    id: 'sale-1', branchId: branch.id, receiptNo: 'MM-20261114-TEST01',
    date: '2026-11-14T00:30:00.000Z', customer: 'Walk-in', paymentMethod: 'Cash',
    items: [line(1)], subtotal: 1500, discount: 0, total: 1500, profit: 500,
    status: 'completed', ...overrides,
  };
}

function resetState({ stock, batches, sales = [] }) {
  usePosStore.setState({
    branches: [branch],
    activeBranchId: branch.id,
    categories: [],
    products: [makeProduct(stock)],
    stockBatches: batches,
    sales,
    activityLogs: [],
    customers: [],
    customerPayments: [],
    purchases: [],
    supplierPayments: [],
    purchaseReturns: [],
    stockReceipts: [],
    stockTransfers: [],
    stockShipments: [],
    stockUnitRegistries: [],
    cashShifts: [],
    cashMovements: [],
  });
}

const state = () => usePosStore.getState();
const stockOf = () => state().products.find((product) => product.id === 'p1').stock;
const batchTotal = () => state().stockBatches.reduce((sum, batch) => sum + batch.quantity, 0);

test('voiding a legacy sale without batch allocations restores batch coverage', () => {
  resetState({
    stock: 5,
    batches: [makeBatch('batch-a', 5)],
    sales: [makeSale({ id: 'sale-legacy', items: [line(2)], subtotal: 3000, total: 3000 })],
  });
  assert.equal(batchTotal(), 5);

  assert.equal(state().voidSale('sale-legacy', 'ဘောင်ချာ မှားရိုက်မိသည်', actor), true);
  assert.equal(stockOf(), 7);
  assert.equal(batchTotal(), 7, 'product stock and batch quantity must stay equal');

  const saved = state().addSale(makeSale({
    id: 'sale-next', receiptNo: 'MM-20261114-NEXT01',
    items: [line(7)], subtotal: 10500, total: 10500, profit: 3500,
  }));
  assert.ok(saved, 'a sale covered by the repaired batches must be accepted');
  assert.equal(stockOf(), 0);
  assert.equal(batchTotal(), 0);
  assert.equal(saved.items[0].batchAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0), 7);
});

test('voiding an allocated sale restores batches exactly and is idempotent', () => {
  resetState({
    stock: 3,
    batches: [makeBatch('batch-a', 3)],
    sales: [makeSale({ id: 'sale-allocated', items: [line(2, [{ batchId: 'batch-a', quantity: 2 }])], subtotal: 3000, total: 3000 })],
  });

  assert.equal(state().voidSale('sale-allocated', 'ဘောင်ချာ မှားရိုက်မိသည်', actor), true);
  assert.equal(stockOf(), 5);
  assert.equal(batchTotal(), 5);
  assert.deepEqual(state().stockBatches.map((batch) => batch.id), ['batch-a']);

  assert.equal(state().voidSale('sale-allocated', 'ဘောင်ချာ မှားရိုက်မိသည်', actor), true);
  assert.equal(stockOf(), 5, 'a repeated void must not restore stock twice');
  assert.equal(batchTotal(), 5, 'a repeated void must not restore batches twice');
  assert.equal(state().sales.filter((sale) => sale.id === 'sale-allocated').length, 1);
});

test('repair merges into an existing opening batch instead of duplicating its id', () => {
  resetState({
    stock: 7,
    batches: [makeBatch('opening-branch-main-p1', 1), makeBatch('batch-a', 4)],
    sales: [makeSale({ id: 'sale-legacy', items: [line(2)], subtotal: 3000, total: 3000 })],
  });

  assert.equal(state().voidSale('sale-legacy', 'ဘောင်ချာ မှားရိုက်မိသည်', actor), true);
  assert.equal(stockOf(), 9);
  assert.equal(batchTotal(), 9);
  const ids = state().stockBatches.map((batch) => batch.id);
  assert.equal(new Set(ids).size, ids.length, 'batch ids must stay unique');
  assert.equal(state().stockBatches.find((batch) => batch.id === 'opening-branch-main-p1').quantity, 5);
});

test('receipt numbers use the shop-local day instead of UTC', () => {
  const localNight = new Date(2026, 10, 14, 0, 15);
  assert.equal(localNight.toISOString().slice(0, 10), '2026-11-13');
  assert.equal(makeReceiptNo(localNight, 'ABC123'), 'MM-20261114-ABC123');
});

test('receipt number suffix is long enough to stay unique in daily volume', () => {
  const now = new Date(2026, 10, 14, 9, 0);
  const numbers = new Set();
  for (let index = 0; index < 20000; index += 1) numbers.add(makeReceiptNo(now));
  assert.equal(numbers.size, 20000);
  for (const number of numbers) assert.match(number, /^MM-20261114-[A-Z0-9]{12}$/);
});

test('cloud import keeps products scoped to their own branch', () => {
  const branchB = { ...branch, id: 'branch-b', name: 'Second', isDefault: false };
  usePosStore.setState({ branches: [branch], activeBranchId: branch.id, products: [], categories: [], sales: [], stockBatches: [], activityLogs: [] });
  state().importData({
    branches: [branch, branchB],
    activeBranchId: branchB.id,
    products: [makeProduct(3), { ...makeProduct(4), id: 'p2', branchId: branchB.id, sku: 'SKU2' }],
  });

  assert.equal(state().activeBranchId, branchB.id);
  assert.deepEqual(state().products.filter((product) => product.branchId === branch.id).map((product) => product.id), ['p1']);
  assert.deepEqual(state().products.filter((product) => product.branchId === branchB.id).map((product) => product.id), ['p2']);
});

test('applying a server Return restocks only saleable units and is idempotent', () => {
  const trackedLine = {
    ...line(2, [{ batchId: 'batch-a', quantity: 2 }]),
    stockUnitSelections: [
      { registryId: 'reg-1', unitId: 'u1', barcode: 'STICKER-1', batchId: 'batch-a' },
      { registryId: 'reg-1', unitId: 'u2', barcode: 'STICKER-2', batchId: 'batch-a' },
    ],
  };
  resetState({
    stock: 3,
    batches: [makeBatch('batch-a', 3)],
    sales: [makeSale({ id: 'sale-return', items: [trackedLine], subtotal: 3000, total: 3000 })],
  });
  usePosStore.setState({
    stockUnitRegistries: [{
      id: 'reg-1', branchId: branch.id, productId: 'p1', chunkIndex: 0,
      updatedAt: '2026-11-14T00:30:00.000Z', units: [
        { id: 'u1', barcode: 'STICKER-1', barcodeSource: 'purchased_sticker', status: 'sold', batchId: 'batch-a', saleId: 'sale-return', soldAt: '2026-11-14T00:30:00.000Z', soldByUid: 'cashier-1', registeredAt: '2026-11-01T00:00:00.000Z' },
        { id: 'u2', barcode: 'STICKER-2', barcodeSource: 'purchased_sticker', status: 'sold', batchId: 'batch-a', saleId: 'sale-return', soldAt: '2026-11-14T00:30:00.000Z', soldByUid: 'cashier-1', registeredAt: '2026-11-01T00:00:00.000Z' },
      ],
    }],
  });

  const input = {
    returnId: 'return-1', saleId: 'sale-return', branchId: branch.id,
    at: '2026-11-15T01:00:00.000Z', actor: { uid: 'cashier-1', name: 'Cashier' },
    reason: 'Customer return', returnedValue: 1500, refundStatus: 'cash-refunded', refundAmount: 1500,
    dueAmount: 0, returnedProductQuantities: { p1: 2 }, returnedBatchQuantities: { 'batch-a': 1 },
    items: [{
      productId: 'p1', quantity: 2, disposition: 'restock',
      batchAllocations: [{ batchId: 'batch-a', quantity: 1 }],
      units: [
        { registryId: 'reg-1', unitId: 'u1', disposition: 'restock' },
        { registryId: 'reg-1', unitId: 'u2', disposition: 'damaged' },
      ],
    }],
  };

  assert.equal(state().applySaleReturn(input), true);
  assert.equal(stockOf(), 4, 'only the restocked unit increases Product stock');
  assert.equal(batchTotal(), 4, 'only the restocked unit increases Batch stock');
  const units = state().stockUnitRegistries[0].units;
  assert.equal(units.find((unit) => unit.id === 'u1').status, 'in_stock');
  assert.equal(units.find((unit) => unit.id === 'u1').saleId, undefined);
  assert.equal(units.find((unit) => unit.id === 'u2').status, 'damaged');
  assert.equal(units.find((unit) => unit.id === 'u2').damageReason, 'Customer return');
  const sale = state().sales.find((entry) => entry.id === 'sale-return');
  assert.equal(sale.returnCount, 1);
  assert.equal(sale.returnedTotal, 1500);
  assert.equal(sale.returnedProductQuantities.p1, 2);
  assert.equal(sale.lastReturnId, 'return-1');

  assert.equal(state().applySaleReturn(input), true, 'replayed return is acknowledged');
  assert.equal(stockOf(), 4, 'replayed return must not restock twice');
  assert.equal(batchTotal(), 4);
  assert.equal(state().sales.find((entry) => entry.id === 'sale-return').returnCount, 1);
});

test('applying a damaged-only Return quarantines units without restocking stock', () => {
  const trackedLine = {
    ...line(1, [{ batchId: 'batch-a', quantity: 1 }]),
    stockUnitSelections: [{ registryId: 'reg-1', unitId: 'u1', barcode: 'STICKER-1', batchId: 'batch-a' }],
  };
  resetState({
    stock: 4,
    batches: [makeBatch('batch-a', 4)],
    sales: [makeSale({ id: 'sale-damaged', items: [trackedLine], subtotal: 1500, total: 1500 })],
  });
  usePosStore.setState({
    stockUnitRegistries: [{
      id: 'reg-1', branchId: branch.id, productId: 'p1', chunkIndex: 0,
      updatedAt: '2026-11-14T00:30:00.000Z', units: [
        { id: 'u1', barcode: 'STICKER-1', barcodeSource: 'purchased_sticker', status: 'sold', batchId: 'batch-a', saleId: 'sale-damaged', registeredAt: '2026-11-01T00:00:00.000Z' },
      ],
    }],
  });

  assert.equal(state().applySaleReturn({
    returnId: 'return-damaged', saleId: 'sale-damaged', branchId: branch.id,
    at: '2026-11-15T01:00:00.000Z', actor: { uid: 'cashier-1', name: 'Cashier' },
    reason: 'Broken bottle', returnedValue: 1500, refundStatus: 'kpay-pending', refundAmount: 1500,
    dueAmount: 0, returnedProductQuantities: { p1: 1 }, returnedBatchQuantities: {},
    items: [{
      productId: 'p1', quantity: 1, disposition: 'damaged', batchAllocations: [],
      units: [{ registryId: 'reg-1', unitId: 'u1', disposition: 'damaged' }],
    }],
  }), true);
  assert.equal(stockOf(), 4);
  assert.equal(batchTotal(), 4);
  assert.equal(state().stockUnitRegistries[0].units[0].status, 'damaged');
  assert.equal(state().sales.find((entry) => entry.id === 'sale-damaged').returns[0].refundStatus, 'kpay-pending');
});
