import test from 'node:test';
import assert from 'node:assert/strict';
import { usePosStore } from '../.qa-build/usePosStore.mjs';
import { findUnitMatches } from '../.qa-build/unitTracking.mjs';
import { mergeCashierUnitRegistries } from '../.qa-build/cashierUnitRegistryMerge.mjs';

const baseSettings = usePosStore.getState().settings;
const actor = { uid: 'owner-1', name: 'Owner', email: 'owner@example.test' };

function makeBranch(id, name) {
  return {
    id, name, code: id.toUpperCase(), address: '', phone: '',
    status: 'active', isDefault: id === 'branch-main',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    settings: { ...baseSettings, storeName: 'Test Store', kpayEnabled: false },
  };
}

function makeProduct(id = 'p1', branchId = 'branch-main', overrides = {}) {
  return {
    id, branchId, name: 'Bottle', sku: `SKU-${id}`, barcode: '8850000000012',
    category: 'Drink', costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400,
    stock: 0, lowStockAt: 2, unit: 'ခု', quantityMode: 'whole',
    tracksIndividualUnits: true, createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBatch(id, quantity, overrides = {}) {
  return {
    id, branchId: 'branch-main', productId: 'p1', purchaseId: '', supplierId: '',
    quantity, receivedAt: '2026-01-01T00:00:00.000Z', expiryDate: '', unitCost: 1000,
    ...overrides,
  };
}

function makeSale(overrides = {}) {
  return {
    id: 'sale-1', branchId: 'branch-main', receiptNo: 'MM-20261115-UNIT01',
    date: '2026-11-15T03:00:00.000Z', customer: 'Walk-in', paymentMethod: 'Cash',
    items: [], subtotal: 0, discount: 0, total: 0, profit: 0,
    status: 'completed', createdByUid: actor.uid, ...overrides,
  };
}

function saleLine(quantity, selections = []) {
  return {
    productId: 'p1', name: 'Bottle', sku: 'SKU-p1', quantity, unitPrice: 1500,
    costPrice: 1000, mode: 'retail', stockAtAdd: quantity, unit: 'ခု', quantityMode: 'whole',
    ...(selections.length ? { stockUnitSelections: selections } : {}),
  };
}

function selectionFor(barcode) {
  const match = state().stockUnitRegistries
    .flatMap((registry) => registry.units.map((unit) => ({ registryId: registry.id, unit })))
    .find((entry) => entry.unit.barcode === barcode);
  assert.ok(match, `unit ${barcode} must exist`);
  return {
    registryId: match.registryId,
    unitId: match.unit.id,
    barcode: match.unit.barcode,
    ...(match.unit.batchId ? { batchId: match.unit.batchId } : {}),
  };
}

function barcodes(count, prefix = 'STICKER') {
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(4, '0')}`);
}

function resetState({ stock = 0, products = [], batches = [], registries = [], sales = [], receipts = [] } = {}) {
  usePosStore.setState({
    branches: [makeBranch('branch-main', 'Main'), makeBranch('branch-b', 'Branch B')],
    activeBranchId: 'branch-main',
    categories: [],
    products: products.length ? products : [makeProduct()],
    stockBatches: batches,
    sales,
    activityLogs: [],
    customers: [],
    customerPayments: [],
    purchases: [],
    supplierPayments: [],
    purchaseReturns: [],
    stockReceipts: receipts,
    stockTransfers: [],
    stockShipments: [],
    stockUnitRegistries: registries,
    cashShifts: [],
    cashMovements: [],
  });
  if (stock) {
    usePosStore.setState((current) => ({
      products: current.products.map((product) => product.id === 'p1' && product.branchId === 'branch-main' ? { ...product, stock } : product),
    }));
  }
}

const state = () => usePosStore.getState();
const productStock = () => state().products.find((product) => product.id === 'p1' && product.branchId === 'branch-main').stock;
const allUnits = () => state().stockUnitRegistries.flatMap((registry) => registry.units);
const unitByBarcode = (barcode) => allUnits().find((unit) => unit.barcode === barcode);

test('receiving 150 unique bottle stickers registers exactly 150 sellable units with one stock increase', () => {
  resetState();
  const codes = barcodes(150);
  const result = state().receiveTrackedStockUnits({
    requestId: 'receive-150', branchId: 'branch-main', productId: 'p1',
    quantity: 150, barcodes: codes, unitCost: 1000, receivedDate: '2026-11-15', actorUid: actor.uid, actorName: actor.name,
  });

  assert.equal(result.ok, true);
  assert.equal(result.created, 150);
  assert.equal(result.duplicate, false);
  assert.equal(productStock(), 150, 'stock must increase by exactly the received quantity');
  assert.equal(state().stockBatches.reduce((sum, batch) => sum + batch.quantity, 0), 150);
  assert.equal(allUnits().length, 150);
  assert.equal(allUnits().every((unit) => unit.status === 'in_stock'), true);
  assert.equal(allUnits().every((unit) => unit.batchId === result.batchId), true);
  assert.equal(state().stockReceipts.length, 1);
  assert.equal(state().stockReceipts[0].items[0].batchId, result.batchId);
  assert.equal(state().stockReceipts[0].requestId, 'receive-150');
  assert.equal(findUnitMatches(state().stockUnitRegistries, codes[44]).length, 1);
});

test('a duplicate sticker inside one receipt is rejected without touching stock', () => {
  resetState();
  const result = state().receiveTrackedStockUnits({
    branchId: 'branch-main', productId: 'p1', quantity: 2, barcodes: ['DUP-001', 'DUP-001'],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /ထပ်နေ/);
  assert.equal(productStock(), 0);
  assert.equal(allUnits().length, 0);
  assert.equal(state().stockReceipts.length, 0);
});

test('a sticker registered in another branch is rejected globally', () => {
  resetState({
    products: [makeProduct(), makeProduct('p2', 'branch-b', { stock: 1, barcode: '8850000000099' })],
  });
  const branchB = state().registerStockUnits({
    branchId: 'branch-b', productId: 'p2', units: [{ barcode: 'GLOBAL-DUP', barcodeSource: 'purchased_sticker' }],
  });
  assert.equal(branchB.ok, true);

  const result = state().receiveTrackedStockUnits({
    branchId: 'branch-main', productId: 'p1', quantity: 1, barcodes: ['GLOBAL-DUP'],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /GLOBAL-DUP/);
  assert.equal(productStock(), 0);
});

test('factory EAN/UPC values cannot be reused as unit stickers', () => {
  resetState();
  assert.equal(state().products[0].barcode, '8850000000012');

  const result = state().receiveTrackedStockUnits({
    branchId: 'branch-main', productId: 'p1', quantity: 1, barcodes: ['8850000000012'],
  });
  assert.equal(result.ok, false);
  assert.equal(productStock(), 0);
  assert.equal(allUnits().length, 0);

  const unknownFactory = state().receiveTrackedStockUnits({
    branchId: 'branch-main', productId: 'p1', quantity: 1, barcodes: ['8850000000013'],
  });
  assert.equal(unknownFactory.ok, true, 'a sticker that merely resembles an EAN is still a valid sticker');
});

test('receiving into an existing batch links every unit to that batch and preserves weighted cost', () => {
  resetState({ stock: 5, products: [makeProduct('p1', 'branch-main', { stock: 5 })], batches: [makeBatch('batch-old', 5)] });

  const result = state().receiveTrackedStockUnits({
    branchId: 'branch-main', productId: 'p1', quantity: 3,
    barcodes: ['BATCH-001', 'BATCH-002', 'BATCH-003'], batchId: 'batch-old', unitCost: 1600,
  });
  assert.equal(result.ok, true);
  assert.equal(result.batchId, 'batch-old');
  const batch = state().stockBatches.find((entry) => entry.id === 'batch-old');
  assert.equal(batch.quantity, 8);
  assert.equal(batch.unitCost, 1225);
  assert.equal(productStock(), 8);
  assert.equal(allUnits().every((unit) => unit.batchId === 'batch-old'), true);
  assert.equal(state().products[0].costPrice, 1225);
});

test('incomplete sticker scanning never finalizes or increases stock', () => {
  resetState();
  const result = state().receiveTrackedStockUnits({
    branchId: 'branch-main', productId: 'p1', quantity: 3, barcodes: ['PART-001', 'PART-002'],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /2\/3/);
  assert.equal(productStock(), 0);
  assert.equal(allUnits().length, 0);
  assert.equal(state().stockReceipts.length, 0);
});

test('duplicate submission with the same request id is idempotent', () => {
  resetState();
  const input = {
    requestId: 'stable-request', branchId: 'branch-main', productId: 'p1',
    quantity: 2, barcodes: ['IDEMP-001', 'IDEMP-002'],
  };
  const first = state().receiveTrackedStockUnits(input);
  const second = state().receiveTrackedStockUnits(input);

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.created, 0);
  assert.equal(productStock(), 2);
  assert.equal(allUnits().length, 2);
  assert.equal(state().stockReceipts.length, 1);
});

test('a second receiving with different request id cannot reuse scanned stickers', () => {
  resetState();
  const first = state().receiveTrackedStockUnits({
    requestId: 'race-a', branchId: 'branch-main', productId: 'p1', quantity: 1, barcodes: ['RACE-001'],
  });
  const second = state().receiveTrackedStockUnits({
    requestId: 'race-b', branchId: 'branch-main', productId: 'p1', quantity: 1, barcodes: ['RACE-001'],
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(productStock(), 1);
  assert.equal(allUnits().filter((unit) => unit.barcode === 'RACE-001').length, 1);
});

function receiveTwoUnits() {
  resetState();
  const result = state().receiveTrackedStockUnits({
    requestId: 'sale-stock', branchId: 'branch-main', productId: 'p1', quantity: 2, barcodes: ['SALE-001', 'SALE-002'],
  });
  assert.equal(result.ok, true);
}

test('checkout cannot use the factory EAN only for a unit-tracked product', () => {
  receiveTwoUnits();
  const saved = state().addSale(makeSale({
    items: [saleLine(1)], subtotal: 1500, total: 1500, profit: 500,
  }));
  assert.equal(saved, null);
  assert.equal(productStock(), 2);
  assert.equal(state().sales.length, 0);
});

test('the same unit cannot be added twice within one sale', () => {
  receiveTwoUnits();
  const selection = selectionFor('SALE-001');
  const saved = state().addSale(makeSale({
    items: [saleLine(1, [selection]), { ...saleLine(1, [selection]), productId: 'p1' }],
    subtotal: 3000, total: 3000, profit: 1000,
  }));
  assert.equal(saved, null);
  assert.equal(productStock(), 2);
  assert.equal(unitByBarcode('SALE-001').status, 'in_stock');
  assert.equal(state().sales.length, 0);
});

test('a sold unit becomes unavailable, keeps its history, and its barcode cannot be registered again', () => {
  receiveTwoUnits();
  const selection = selectionFor('SALE-001');
  const saved = state().addSale(makeSale({
    id: 'sale-unit', items: [saleLine(1, [selection])], subtotal: 1500, total: 1500, profit: 500,
  }));
  assert.ok(saved);
  assert.equal(productStock(), 1);
  assert.equal(unitByBarcode('SALE-001').status, 'sold');
  assert.equal(unitByBarcode('SALE-001').saleId, 'sale-unit');
  assert.equal(unitByBarcode('SALE-001').soldAt !== undefined, true);

  const secondSale = state().addSale(makeSale({
    id: 'sale-unit-2', receiptNo: 'MM-20261115-UNIT02', items: [saleLine(1, [selection])], subtotal: 1500, total: 1500, profit: 500,
  }));
  assert.equal(secondSale, null);
  assert.equal(productStock(), 1);

  const reuse = state().receiveTrackedStockUnits({
    branchId: 'branch-main', productId: 'p1', quantity: 1, barcodes: ['SALE-001'],
  });
  assert.equal(reuse.ok, false, 'a sold sticker is never accepted as a new unit');
  assert.equal(unitByBarcode('SALE-001').status, 'sold');
});

test('voiding a unit sale restores the exact unit and keeps its sold-history record', () => {
  receiveTwoUnits();
  const selection = selectionFor('SALE-001');
  const saved = state().addSale(makeSale({
    id: 'sale-void', items: [saleLine(1, [selection])], subtotal: 1500, total: 1500, profit: 500,
  }));
  assert.ok(saved);
  assert.equal(productStock(), 1);

  assert.equal(state().voidSale('sale-void', 'ဘောင်ချာ မှားရိုက်မိသည်', actor), true);
  assert.equal(productStock(), 2);
  assert.equal(unitByBarcode('SALE-001').status, 'in_stock');
  assert.equal(unitByBarcode('SALE-001').lastSaleId, 'sale-void');
  assert.equal(unitByBarcode('SALE-001').saleId, undefined);
  assert.equal(allUnits().length, 2, 'the unit record is restored, never deleted');

  assert.equal(state().voidSale('sale-void', 'ဘောင်ချာ မှားရိုက်မိသည်', actor), true);
  assert.equal(productStock(), 2, 'a repeated void must not restore stock twice');
});

test('unit registries survive a persistence round trip and keep sold status', () => {
  receiveTwoUnits();
  const selection = selectionFor('SALE-002');
  state().addSale(makeSale({
    id: 'sale-persist', items: [saleLine(1, [selection])], subtotal: 1500, total: 1500, profit: 500,
  }));
  const roundTrip = JSON.parse(JSON.stringify(state().stockUnitRegistries));
  const units = roundTrip.flatMap((registry) => registry.units);
  assert.equal(units.length, 2);
  assert.equal(units.find((unit) => unit.barcode === 'SALE-002').status, 'sold');
  assert.equal(units.find((unit) => unit.barcode === 'SALE-001').status, 'in_stock');
  assert.equal(findUnitMatches(roundTrip, 'SALE-001')[0].unit.status, 'in_stock');
});

test('manual stock changes and deletion are blocked while units exist', () => {
  receiveTwoUnits();
  assert.equal(state().adjustStock('p1', 5), false, 'manual stock increase must not desync units');
  assert.equal(productStock(), 2);
  assert.equal(state().updateProduct('p1', { stock: 9 }), undefined);
  assert.equal(productStock(), 2);
  assert.equal(state().deleteProduct('p1'), false, 'sold unit history must not be orphaned by deletion');
  assert.ok(state().products.some((product) => product.id === 'p1'));
});

test('cashier registry sync merge keeps server-confirmed sold units and ignores pending or voided local states', () => {
  const cloudRegistry = (units) => [{ id: 'reg-1', branchId: 'branch-main', productId: 'p1', chunkIndex: 0, units }];
  const cloudServerUnits = [
    { id: 'u1', barcode: 'A-1', status: 'sold', saleId: 'sale-local' },
    { id: 'u2', barcode: 'A-2', status: 'sold', saleId: 'sale-other' },
    { id: 'u3', barcode: 'A-3', status: 'in_stock' },
  ];
  const localRegistries = [{ id: 'reg-1', branchId: 'branch-main', productId: 'p1', chunkIndex: 0, units: [
    { id: 'u1', barcode: 'A-1', status: 'sold', saleId: 'sale-local', soldAt: '2026-11-15T00:00:00.000Z' },
    { id: 'u2', barcode: 'A-2', status: 'sold', saleId: 'sale-pending' },
    { id: 'u3', barcode: 'A-3', status: 'sold', saleId: 'sale-voided' },
  ] }];
  const sales = [
    { id: 'sale-local', branchId: 'branch-main', status: 'completed', cloudSyncStatus: 'synced' },
    { id: 'sale-pending', branchId: 'branch-main', status: 'completed', cloudSyncStatus: 'pending' },
    { id: 'sale-voided', branchId: 'branch-main', status: 'voided', cloudSyncStatus: 'synced' },
  ];

  const merged = mergeCashierUnitRegistries(localRegistries, cloudRegistry(cloudServerUnits), 'branch-main', sales);
  const units = merged.flatMap((registry) => registry.units);
  assert.equal(units.find((unit) => unit.id === 'u1').saleId, 'sale-local');
  assert.equal(units.find((unit) => unit.id === 'u1').status, 'sold', 'an agreeing cloud copy stays sold for the same synced local sale');
  assert.equal(units.find((unit) => unit.id === 'u2').saleId, 'sale-other', 'cloud wins while the local sale is still pending server confirmation');
  assert.equal(units.find((unit) => unit.id === 'u3').status, 'in_stock', 'a voided local sale must not pin a sold unit locally');

  const unsyncedLocal = [{ id: 'reg-1', branchId: 'branch-main', productId: 'p1', chunkIndex: 0, units: [
    { id: 'u1', barcode: 'A-1', status: 'sold', saleId: 'sale-local' },
  ] }];
  const conflictingCloud = [{ id: 'reg-1', branchId: 'branch-main', productId: 'p1', chunkIndex: 0, units: [
    { id: 'u1', barcode: 'A-1', status: 'sold', saleId: 'sale-cloud-other' },
  ] }];
  const noSyncStatus = mergeCashierUnitRegistries(unsyncedLocal, conflictingCloud, 'branch-main',
    [{ id: 'sale-local', branchId: 'branch-main', status: 'completed' }]);
  assert.equal(noSyncStatus[0].units.find((unit) => unit.id === 'u1').saleId, 'sale-cloud-other',
    'a completed sale without a confirmed cloud acknowledgement cannot override the server registry');

  const otherBranch = [{ id: 'reg-b', branchId: 'branch-b', productId: 'p1', chunkIndex: 0, units: [] }];
  const mergedWithOtherBranch = mergeCashierUnitRegistries(otherBranch, cloudRegistry(cloudServerUnits), 'branch-main', sales);
  assert.deepEqual(mergedWithOtherBranch.map((registry) => registry.branchId), ['branch-b', 'branch-main'], 'other Branch registries are preserved while the active Branch is replaced');
  assert.equal(mergedWithOtherBranch.find((registry) => registry.branchId === 'branch-main').units.length, 3);
});

test('unit tracking stays optional and does not affect untracked products', () => {
  resetState();
  usePosStore.setState((current) => ({
    products: [...current.products, makeProduct('p-untracked', 'branch-main', {
      name: 'Candy', sku: 'CANDY-1', barcode: '9900000000011', tracksIndividualUnits: false, stock: 3,
    })],
    stockBatches: [makeBatch('batch-candy', 3, { productId: 'p-untracked' })],
  }));
  const saved = state().addSale(makeSale({
    items: [{ ...saleLine(2), productId: 'p-untracked', name: 'Candy', sku: 'CANDY-1' }],
    subtotal: 3000, total: 3000, profit: 1000,
  }));
  assert.ok(saved, 'untracked products keep quantity-based selling');
  assert.equal(state().products.find((product) => product.id === 'p-untracked').stock, 1);
});
