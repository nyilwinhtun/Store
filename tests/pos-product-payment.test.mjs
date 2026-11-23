import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { POS_ALL_CATEGORIES, filterPosProducts, isProductSelectable, otherBranchProductCounts, posProductViewState, productsForBranch, sellableStockFor } = await import(
  new URL('../.qa-build/posProductSelection.mjs', import.meta.url).href
);
const { describeKpayUnavailable, isPaymentMethodSelectable, kpayUnavailableReason } = await import(
  new URL('../.qa-build/posPaymentState.mjs', import.meta.url).href
);

const root = fileURLToPath(new URL('..', import.meta.url));
const appSource = readFileSync(`${root}/src/App.tsx`, 'utf8');
const cssSource = readFileSync(`${root}/src/index.css`, 'utf8');

function product(overrides = {}) {
  return {
    id: 'p1', branchId: 'branch-a', name: 'Royal D', sku: 'SKU-001', barcode: ' 0215 66 ',
    category: 'Drink', stock: 10, lowStockAt: 2, ...overrides,
  };
}

test('POS product loading is isolated to the selected branch', () => {
  const products = [
    product({ id: 'a1', branchId: 'branch-a', name: 'A1' }),
    product({ id: 'a2', branchId: 'branch-a', name: 'A2' }),
    product({ id: 'b1', branchId: 'branch-b', name: 'B1' }),
    product({ id: 'none', branchId: undefined, name: 'Legacy' }),
  ];
  assert.deepEqual(productsForBranch(products, 'branch-a').map((entry) => entry.id), ['a1', 'a2']);
  assert.deepEqual(productsForBranch(products, 'branch-b').map((entry) => entry.id), ['b1']);
  assert.deepEqual(productsForBranch(products, 'branch-c'), []);
});

test('All category and search cover name, SKU, and normalized barcode', () => {
  const products = [
    product({ id: 'p1', name: 'Royal D', sku: 'RD-01', barcode: '021566', category: 'Drink' }),
    product({ id: 'p2', name: 'Speed', sku: 'SP-02', barcode: '987654', category: 'Snack' }),
  ];
  assert.equal(filterPosProducts(products, '', POS_ALL_CATEGORIES).length, 2);
  assert.deepEqual(filterPosProducts(products, 'royal', POS_ALL_CATEGORIES).map((entry) => entry.id), ['p1']);
  assert.deepEqual(filterPosProducts(products, 'sp-02', POS_ALL_CATEGORIES).map((entry) => entry.id), ['p2']);
  assert.deepEqual(filterPosProducts(products, '0215 66', POS_ALL_CATEGORIES).map((entry) => entry.id), ['p1']);
  assert.deepEqual(filterPosProducts(products, '', 'Drink').map((entry) => entry.id), ['p1']);
  assert.deepEqual(filterPosProducts(products, 'royal', 'Snack'), []);
});

test('Out-of-stock and expired-batch units are not selectable', () => {
  const expired = new Map([['p1', 4]]);
  assert.equal(sellableStockFor(product({ stock: 10 }), expired), 6);
  assert.equal(isProductSelectable(product({ stock: 10 }), expired), true);
  assert.equal(sellableStockFor(product({ stock: 4 }), expired), 0);
  assert.equal(isProductSelectable(product({ stock: 4 }), expired), false);
  assert.equal(isProductSelectable(product({ stock: 0 }), expired), false);
  assert.equal(sellableStockFor(product({ stock: 2 }), new Map([['p1', 10]])), 0);
});

test('Empty branch explains that other branches hold products', () => {
  const branches = [
    { id: 'branch-a', name: 'My Minimart' },
    { id: 'branch-b', name: 'Cherry' },
    { id: 'branch-c', name: 'Empty' },
  ];
  const products = [product({ branchId: 'branch-b' }), product({ branchId: 'branch-b' }), product({ branchId: 'branch-c', id: 'gone' })];
  assert.deepEqual(otherBranchProductCounts(branches, products, 'branch-a'), [
    { id: 'branch-b', name: 'Cherry', count: 2 },
    { id: 'branch-c', name: 'Empty', count: 1 },
  ]);
  assert.deepEqual(otherBranchProductCounts(branches, products, 'branch-b'), [
    { id: 'branch-c', name: 'Empty', count: 1 },
  ]);
});

test('Payment methods cannot be selected with an empty cart', () => {
  const configured = { kpayEnabled: true, kpayAccountName: 'Shop', kpayAccountNumber: '09-790000001' };
  for (const method of ['Cash', 'KPay', 'Credit']) {
    assert.equal(isPaymentMethodSelectable(method, { cartCount: 0, kpaySettings: configured }), false);
  }
  assert.equal(isPaymentMethodSelectable('Cash', { cartCount: 1, kpaySettings: configured }), true);
  assert.equal(isPaymentMethodSelectable('Credit', { cartCount: 1, kpaySettings: configured }), true);
});

test('KPay is selectable only when the branch account is configured and enabled', () => {
  const configured = { kpayEnabled: true, kpayAccountName: 'Shop', kpayAccountNumber: '09-790000001' };
  assert.equal(isPaymentMethodSelectable('KPay', { cartCount: 1, kpaySettings: configured }), true);
  assert.equal(isPaymentMethodSelectable('KPay', { cartCount: 1, kpaySettings: { kpayEnabled: true } }), false);
  assert.equal(isPaymentMethodSelectable('KPay', { cartCount: 1, kpaySettings: { ...configured, kpayEnabled: false } }), false);
  assert.equal(kpayUnavailableReason(configured), null);
});

test('KPay unavailability carries an actionable reason', () => {
  assert.equal(kpayUnavailableReason(undefined), 'not-configured');
  assert.equal(kpayUnavailableReason({ kpayEnabled: true, kpayAccountName: 'Shop' }), 'not-configured');
  assert.equal(kpayUnavailableReason({ kpayEnabled: false, kpayAccountName: 'Shop', kpayAccountNumber: '09-790000001' }), 'disabled');
  assert.ok(describeKpayUnavailable('not-configured').includes('Branch Finance'));
  assert.ok(describeKpayUnavailable('disabled').includes('ပိတ်ထား'));
});

test('An empty POS distinguishes loading, offline, and truly empty', () => {
  assert.equal(posProductViewState(0, 'idle'), 'loading');
  assert.equal(posProductViewState(0, 'connecting'), 'loading');
  assert.equal(posProductViewState(0, 'offline'), 'offline');
  assert.equal(posProductViewState(0, 'error'), 'offline');
  assert.equal(posProductViewState(0, 'synced'), 'empty');
  assert.equal(posProductViewState(0, 'conflict'), 'empty');
  assert.equal(posProductViewState(3, 'connecting'), 'ready', 'cached products must stay sellable during a resync');
  assert.equal(posProductViewState(3, 'offline'), 'ready');
});

test('POS wiring uses the branch-aware filters and affordable payment hints', () => {
  assert.ok(appSource.includes('filterPosProducts(products, productSearch, categoryFilter)'));
  assert.ok(appSource.includes('productsForBranch(allProducts, activeBranchId)'));
  assert.ok(appSource.includes('otherBranchProductCounts(activeBranches, allProducts, activeBranchId)'));
  assert.ok(appSource.includes('disabled={!paymentMethodsEnabled}'), 'Cash and Credit must be disabled for an empty cart');
  assert.ok(appSource.includes('disabled={!kpaySelectable}'), 'KPay must follow branch configuration and cart state');
  assert.ok(appSource.includes('paymentMethodsEnabled && paymentMethod ==='), 'no method may look selected with an empty cart');
  assert.ok(appSource.includes('payment-switch-hint'), 'the cart/payment state must be explained');
  assert.ok(appSource.includes('setCategoryFilter(POS_ALL_CATEGORIES)'), 'a branch switch must reset the category filter');
  assert.ok(appSource.includes('posProductViewState(products.length, autoSyncStatus.state)'), 'the POS must derive its loading/empty state from sync status');
  assert.ok(appSource.includes('AUTO_SYNC_STATUS_EVENT'), 'the POS must react to sync status changes');
  assert.ok(appSource.includes('Cloud မှ ပစ္စည်းစာရင်း ရယူနေပါတယ်'), 'loading must have its own message');
  assert.ok(appSource.includes('Cloud မှ ပစ္စည်းစာရင်း မရနိုင်သေးပါ'), 'offline/error must have its own message');
  assert.ok(appSource.includes('kpayUnavailable = posDataSettled ? kpayUnavailableReason'), 'KPay must not be judged before branch data settles');
  assert.match(cssSource, /\.payment-switch button:disabled\{/);
});
