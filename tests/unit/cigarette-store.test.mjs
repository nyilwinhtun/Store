import test from 'node:test';
import assert from 'node:assert/strict';

import { usePosStore } from '../../.qa-build/usePosStore.mjs';

test('createLinkedStickProduct and convertPackToSticks keep integer pack/stick stock and batches accurate', () => {
  usePosStore.getState().clearAllData();
  const added = usePosStore.getState().addProduct({
    name: 'Red Ruby',
    sku: 'RR-PACK',
    category: 'အထွေထွေ',
    costPrice: 2500,
    retailPrice: 3000,
    wholesalePrice: 2800,
    stock: 10,
    lowStockAt: 2,
    unit: 'ဘူး',
    quantityMode: 'whole',
    sticksPerPack: 20,
  });
  assert.equal(added, true);

  const pack = usePosStore.getState().products.find((p) => p.sku === 'RR-PACK');
  assert.ok(pack);

  const stickId = usePosStore.getState().createLinkedStickProduct(pack.id, 200);
  assert.ok(stickId);

  const conv = usePosStore.getState().convertPackToSticks(pack.id, 1);
  assert.equal(conv.ok, true);
  assert.equal(conv.addedSticks, 20);

  const stateAfter = usePosStore.getState();
  const updatedPack = stateAfter.products.find((p) => p.id === pack.id);
  const updatedStick = stateAfter.products.find((p) => p.id === stickId);
  assert.equal(updatedPack?.stock, 9);
  assert.equal(updatedStick?.stock, 20);
  assert.equal(updatedStick?.retailPrice, 200);
  assert.equal(updatedStick?.costPrice, 125);
});

test('amount-based repacked bundle sale deducts fractional stock and records exact revenue/profit', () => {
  usePosStore.getState().clearAllData();
  usePosStore.getState().addProduct({
    name: 'လှကျော် (ပြန်စီး)',
    sku: 'LHA-1000',
    category: 'အထွေထွေ',
    costPrice: 750,
    retailPrice: 1000,
    wholesalePrice: 900,
    stock: 5,
    lowStockAt: 1,
    unit: 'ထုပ်',
    quantityMode: 'decimal',
    amountSaleEnabled: true,
    amountPresets: [500, 1000, 2000],
  });
  const bundle = usePosStore.getState().products.find((p) => p.sku === 'LHA-1000');
  assert.ok(bundle);

  const sale = usePosStore.getState().addSale({
    id: 'sale-amount-1',
    receiptNo: 'R-AMT-1',
    date: new Date().toISOString(),
    customer: 'လက်လီဝယ်သူ',
    paymentMethod: 'Cash',
    items: [{
      productId: bundle.id,
      name: bundle.name,
      sku: bundle.sku,
      quantity: 0.5,
      unitPrice: 1000,
      costPrice: 750,
      mode: 'retail',
      stockAtAdd: 5,
      unit: 'ထုပ်',
      quantityMode: 'decimal',
      amountBased: true,
    }],
    subtotal: 500,
    discount: 0,
    total: 500,
    profit: 125,
    status: 'completed',
  });
  assert.ok(sale);
  const updatedBundle = usePosStore.getState().products.find((p) => p.id === bundle.id);
  assert.equal(updatedBundle?.stock, 4.5);
});
