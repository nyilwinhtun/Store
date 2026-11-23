import test from 'node:test';
import assert from 'node:assert/strict';
import { usePosStore } from '../../.qa-build/usePosStore.mjs';
import { UNIT_TRANSFER_UNSUPPORTED_MESSAGE } from '../../.qa-build/unitTracking.mjs';

const baseSettings = usePosStore.getState().settings;
const branch = {
  id: 'branch-main', name: 'Main', code: 'MAIN', address: '', phone: '',
  status: 'active', isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  settings: { ...baseSettings, storeName: 'Test Store', kpayEnabled: false },
};
const branchB = { ...branch, id: 'branch-b', name: 'Second', code: 'SECOND', isDefault: false };
const actor = { uid: 'owner-1', name: 'Owner', email: 'owner@example.test' };

function makeProduct(overrides) {
  return {
    id: 'p1', branchId: branch.id, name: 'Rice', sku: 'SKU1', barcode: '',
    category: 'Food', costPrice: 1000, retailPrice: 1500, wholesalePrice: 1400,
    stock: 5, lowStockAt: 2, unit: 'ခု', quantityMode: 'whole',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeBatch(id, quantity, productId = 'p1') {
  return {
    id, branchId: branch.id, productId, purchaseId: '', supplierId: '',
    quantity, receivedAt: '2026-01-01T00:00:00.000Z', expiryDate: '', unitCost: 1000,
  };
}

function makeRegistry(productId, units = 1) {
  return {
    id: `reg-${productId}`, branchId: branch.id, productId, chunkIndex: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    units: Array.from({ length: units }, (_, index) => ({
      id: `${productId}-u${index + 1}`, barcode: `STICKER-${productId}-${index + 1}`,
      barcodeSource: 'purchased_sticker', status: 'in_stock', batchId: 'batch-a',
      registeredAt: '2026-01-01T00:00:00.000Z',
    })),
  };
}

function resetState({ products, batches, stockUnitRegistries = [] }) {
  usePosStore.setState({
    branches: [branch, branchB],
    activeBranchId: branch.id,
    categories: [],
    products,
    stockBatches: batches,
    stockUnitRegistries,
    sales: [],
    activityLogs: [],
    customers: [],
    customerPayments: [],
    purchases: [],
    supplierPayments: [],
    purchaseReturns: [],
    stockReceipts: [],
    stockTransfers: [],
    stockShipments: [],
    cashShifts: [],
    cashMovements: [],
  });
}

const state = () => usePosStore.getState();
const stockOf = (productId = 'p1', branchId = branch.id) => state().products
  .find((product) => product.id === productId && product.branchId === branchId)?.stock;
const inventorySnapshot = () => JSON.parse(JSON.stringify({
  products: state().products,
  stockBatches: state().stockBatches,
  stockTransfers: state().stockTransfers,
  stockShipments: state().stockShipments,
  stockUnitRegistries: state().stockUnitRegistries,
  activityLogs: state().activityLogs,
}));

test('quantity-based branch transfer still moves stock and batches', () => {
  resetState({ products: [makeProduct()], batches: [makeBatch('batch-a', 5)] });

  const commit = state().transferStock({
    fromBranchId: branch.id, toBranchId: branchB.id,
    items: [{ sourceProductId: 'p1', quantity: 2 }], actor,
  });

  assert.ok(commit, 'quantity-based transfer must be accepted');
  assert.equal(stockOf(), 3);
  const destination = state().products.find((product) => product.branchId === branchB.id);
  assert.equal(destination.stock, 2);
  assert.equal(state().stockBatches.filter((batch) => batch.branchId === branch.id && batch.productId === 'p1')
    .reduce((sum, batch) => sum + batch.quantity, 0), 3);
  assert.equal(state().stockTransfers.length, 1);
  assert.equal(state().stockTransfers[0].status, 'completed');
});

test('dispatch keeps the quantity-based shipment path working', () => {
  resetState({ products: [makeProduct()], batches: [makeBatch('batch-a', 5)] });

  const result = state().dispatchBranchStockShipment({
    fromBranchId: branch.id, toBranchId: branchB.id,
    items: [{ sourceProductId: 'p1', quantity: 2 }], actor,
  });

  assert.equal(result.ok, true);
  assert.equal(stockOf(), 3);
  assert.equal(state().stockShipments.length, 1);
  assert.equal(state().stockShipments[0].status, 'dispatched');
});

test('unit-flagged product transfer is rejected with zero writes', () => {
  resetState({
    products: [makeProduct({ stock: 5, tracksIndividualUnits: true })],
    batches: [makeBatch('batch-a', 5)],
  });
  const before = inventorySnapshot();

  assert.equal(state().transferStock({
    fromBranchId: branch.id, toBranchId: branchB.id,
    items: [{ sourceProductId: 'p1', quantity: 2 }], actor,
  }), null);
  assert.deepEqual(inventorySnapshot(), before, 'a rejected transfer must not write any state');
  assert.equal(stockOf(), 5);
  assert.equal(state().products.filter((product) => product.branchId === branchB.id).length, 0);
  assert.equal(state().stockBatches[0].quantity, 5);
});

test('unit-registry product transfer is rejected with zero writes', () => {
  resetState({
    products: [makeProduct()],
    batches: [makeBatch('batch-a', 5)],
    stockUnitRegistries: [makeRegistry('p1')],
  });
  const before = inventorySnapshot();

  assert.equal(state().transferStock({
    fromBranchId: branch.id, toBranchId: branchB.id,
    items: [{ sourceProductId: 'p1', quantity: 2 }], actor,
  }), null);
  assert.deepEqual(inventorySnapshot(), before);
  assert.equal(stockOf(), 5);
  assert.equal(state().products.filter((product) => product.branchId === branchB.id).length, 0);
  assert.equal(state().stockBatches[0].quantity, 5);
  assert.equal(state().stockUnitRegistries[0].units[0].status, 'in_stock');
});

test('a mixed transfer rejects before any product is partially written', () => {
  resetState({
    products: [
      makeProduct(),
      makeProduct({ id: 'p2', sku: 'SKU2', name: 'Milk', stock: 3, tracksIndividualUnits: true }),
    ],
    batches: [makeBatch('batch-a', 5), makeBatch('batch-b', 3, 'p2')],
    stockUnitRegistries: [makeRegistry('p2', 3)],
  });
  const before = inventorySnapshot();

  assert.equal(state().transferStock({
    fromBranchId: branch.id, toBranchId: branchB.id,
    items: [{ sourceProductId: 'p1', quantity: 2 }, { sourceProductId: 'p2', quantity: 1 }], actor,
  }), null);
  assert.deepEqual(inventorySnapshot(), before, 'the valid first line must not commit on its own');
  assert.equal(stockOf(), 5);
  assert.equal(state().stockBatches.length, 2);
});

test('shipment dispatch rejects unit-tracked products with a clear reason', () => {
  resetState({
    products: [makeProduct({ stock: 5, tracksIndividualUnits: true })],
    batches: [makeBatch('batch-a', 5)],
  });
  const before = inventorySnapshot();

  const result = state().dispatchBranchStockShipment({
    fromBranchId: branch.id, toBranchId: branchB.id,
    items: [{ sourceProductId: 'p1', quantity: 2 }], actor,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /Unit Barcode Sticker Tracking/);
  assert.match(result.reason, /မလုပ်နိုင်သေးပါ/);
  assert.deepEqual(inventorySnapshot(), before, 'a rejected dispatch must not write any state');
  assert.equal(stockOf(), 5);
});

test('shipment dispatch rejects registry-tracked products with zero writes', () => {
  resetState({
    products: [makeProduct()],
    batches: [makeBatch('batch-a', 5)],
    stockUnitRegistries: [makeRegistry('p1', 2)],
  });
  const before = inventorySnapshot();

  const result = state().dispatchBranchStockShipment({
    fromBranchId: branch.id, toBranchId: branchB.id,
    items: [{ sourceProductId: 'p1', quantity: 2 }], actor,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, `Rice: ${UNIT_TRANSFER_UNSUPPORTED_MESSAGE}`);
  assert.deepEqual(inventorySnapshot(), before);
  assert.equal(stockOf(), 5);
  assert.equal(state().stockUnitRegistries[0].units.length, 2);
});

test('approving a legacy shipment for a tracked product is refused', () => {
  const destinationProduct = makeProduct({ id: 'p1-b', branchId: branchB.id, stock: 0, sku: 'SKU1-B' });
  resetState({
    products: [makeProduct({ stock: 3, tracksIndividualUnits: true }), destinationProduct],
    batches: [makeBatch('batch-a', 3)],
  });
  usePosStore.setState({
    stockShipments: [{
      id: 'ship-legacy', branchId: branchB.id, shipmentNo: 'SHP-LEGACY',
      fromBranchId: branch.id, fromBranchName: branch.name,
      toBranchId: branchB.id, toBranchName: branchB.name,
      status: 'received', dispatchedAt: '2026-11-15T00:00:00.000Z', dispatchedByUid: 'owner-1',
      receivedAt: '2026-11-15T01:00:00.000Z',
      items: [{
        sourceProductId: 'p1', productName: 'Rice', sku: 'SKU1', barcode: '', unit: 'ခု',
        quantityMode: 'whole', quantity: 1, costPrice: 1000, retailPrice: 1500,
        wholesalePrice: 1400, lowStockAt: 2, category: 'Food', acceptedQuantity: 0,
        batchAllocations: [{ sourceBatchId: 'batch-a', quantity: 1, unitCost: 1000, expiryDate: '', receivedAt: '2026-11-15T00:00:00.000Z' }],
      }],
      receivedItems: [{ sourceProductId: 'p1', receivedQuantity: 1, damagedQuantity: 0 }],
    }],
  });
  const before = inventorySnapshot();

  assert.equal(state().approveBranchStockShipment({ shipmentId: 'ship-legacy', actor }), false);
  assert.deepEqual(inventorySnapshot(), before, 'a tracked legacy shipment must not restock on approval');
});

test('reversing a tracked legacy transfer is refused with zero writes', () => {
  const destinationProduct = makeProduct({ id: 'p1-b', branchId: branchB.id, stock: 2, sku: 'SKU1-B' });
  resetState({
    products: [makeProduct({ stock: 3 }), destinationProduct],
    batches: [makeBatch('batch-a', 3)],
    stockUnitRegistries: [makeRegistry('p1', 2)],
  });
  usePosStore.setState({
    stockTransfers: [{
      id: 'tr-legacy', transferNo: 'TR-LEGACY', date: '2026-11-15T00:00:00.000Z',
      fromBranchId: branch.id, toBranchId: branchB.id, note: '', status: 'completed',
      totalQuantity: 2,
      items: [{
        sourceProductId: 'p1', destinationProductId: 'p1-b',
        productName: 'Rice', quantity: 2, unit: 'ခု', transferredUnitCost: 1000,
        sourceStockBefore: 5, sourceStockAfter: 3,
        destinationStockBefore: 0, destinationStockAfter: 2, destinationCostPriceBefore: 1000,
        batchAllocations: [{
          sourceBatchId: 'batch-a', destinationBatchId: 'batch-b', quantity: 2,
          unitCost: 1000, expiryDate: '', receivedAt: '2026-11-15T00:00:00.000Z',
        }],
      }],
    }],
  });
  const before = inventorySnapshot();

  const result = state().reverseStockTransfer({ transferId: 'tr-legacy', note: 'Wrong branch', actor });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unit-tracking-unsupported');
  assert.deepEqual(inventorySnapshot(), before);
});
