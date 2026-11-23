import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('../.qa-build/kpayReference.mjs', import.meta.url);
const { checkKpayReference, normalizeKpayReference } = await import(moduleUrl.href);
const { isKpayEnabled } = await import(new URL('../.qa-build/kpayAccount.mjs', import.meta.url).href);

const root = fileURLToPath(new URL('..', import.meta.url));
const appSource = readFileSync(`${root}/src/App.tsx`, 'utf8');
const cssSource = readFileSync(`${root}/src/index.css`, 'utf8');

test('KPay reference must be present', () => {
  for (const value of ['', '   ', '\n\t', null, undefined]) {
    const result = checkKpayReference(value);
    assert.equal(result.ok, false);
    assert.equal(result.issue, 'empty');
  }
});

test('KPay reference is trimmed before saving', () => {
  assert.equal(normalizeKpayReference('  KBZ-20261110-88421  '), 'KBZ-20261110-88421');
  const result = checkKpayReference('  KBZ-20261110-88421  ');
  assert.equal(result.ok, true);
  assert.equal(result.value, 'KBZ-20261110-88421');
});

test('KPay reference rejects short values', () => {
  assert.equal(checkKpayReference('12').ok, false);
  assert.equal(checkKpayReference('12').issue, 'too-short');
  assert.equal(checkKpayReference('a1').issue, 'too-short');
});

test('KPay reference rejects letters without any digit', () => {
  const result = checkKpayReference('KPAYREF');
  assert.equal(result.ok, false);
  assert.equal(result.issue, 'no-digit');
});

test('KPay reference rejects whitespace and markup characters', () => {
  for (const value of ['KBZ 2026', '<script>1</script>', 'KBZ/2026', '1234#']) {
    const result = checkKpayReference(value);
    assert.equal(result.ok, false);
    assert.equal(result.issue, 'invalid-format', `expected ${value} to be rejected`);
  }
});

test('KPay reference rejects separator-only and overlong values', () => {
  assert.equal(checkKpayReference('----').issue, 'invalid-format');
  const overlong = `KBZ-${'9'.repeat(130)}`;
  assert.equal(checkKpayReference(overlong).issue, 'too-long');
});

test('KPay reference accepts realistic transaction formats', () => {
  for (const value of ['12345678', 'KBZ-20261110-88421', 'FT260113123456', 'KPay.2026_001-1']) {
    const result = checkKpayReference(value);
    assert.equal(result.ok, true, `expected ${value} to be accepted`);
    assert.equal(result.message, '');
  }
});

test('Owner can disable KPay independently per branch', () => {
  assert.equal(isKpayEnabled(undefined), false);
  assert.equal(isKpayEnabled({ kpayAccountName: '', kpayAccountNumber: '09-790000001', kpayEnabled: true }), false);
  assert.equal(isKpayEnabled({ kpayAccountName: 'ဦးမင်းထွန်း', kpayAccountNumber: '09-790000001' }), true, 'legacy branches stay enabled when both fields exist');
  assert.equal(isKpayEnabled({ kpayAccountName: 'ဦးမင်းထွန်း', kpayAccountNumber: '09-790000001', kpayEnabled: true }), true);
  assert.equal(isKpayEnabled({ kpayAccountName: 'ဦးမင်းထွန်း', kpayAccountNumber: '09-790000001', kpayEnabled: false }), false);
  assert.ok(appSource.includes('const branchKpayEnabled = isKpayEnabled(activeBranch?.settings);'), 'POS must derive KPay availability from the flag');
  assert.ok(appSource.includes('disabled={!kpaySelectable}'), 'the KPay switch must be disabled when the branch disables KPay or the cart is empty');
  assert.ok(appSource.includes("if (paymentMethod === 'KPay' && !branchKpayEnabled)"), 'checkout must reject KPay when the branch disables it');
});

test('Checkout summary sits outside the scrollable cart middle', () => {
  const scrollOpen = appSource.indexOf('<div className="cart-scroll">');
  const summaryOpen = appSource.indexOf('<div className="cart-summary">');
  assert.notEqual(scrollOpen, -1, 'cart-scroll wrapper is required');
  assert.notEqual(summaryOpen, -1, 'cart-summary is required');
  assert.ok(scrollOpen < summaryOpen, 'cart-scroll must open before the summary');
  const between = appSource.slice(scrollOpen, summaryOpen);
  assert.ok(between.includes('\n              </div>\n'), 'the scroll region must close before the summary');
  assert.ok(between.includes('cart-items'), 'cart lines belong inside the scroll region');
  assert.ok(between.includes('cart-customer'), 'customer and payment switch belong inside the scroll region');
});

test('Cart footer keeps the checkout button in normal flow and reachable', () => {
  assert.match(appSource, /className="button button-primary checkout-button"[\s\S]*?disabled=\{!cart\.length\}/);
  assert.match(cssSource, /\.cart-summary\{flex:0 0 auto/);
  assert.match(cssSource, /\.cart-scroll\{[^}]*overflow-y:auto/);
  assert.match(cssSource, /\.pos-layout-mobile-split \.cart-scroll\{[^}]*overflow-y:auto/);
  assert.match(cssSource, /\.pos-layout-mobile-split \.checkout-button\{[^}]*position:static/);
});

test('KPay completion is gated by the validated reference', () => {
  assert.ok(
    appSource.includes("if (paymentMethod === 'KPay' && !kpayReferenceCheck.ok) { notify(kpayReferenceCheck.message); return; }"),
    'completeSale must reject invalid KPay references',
  );
  assert.ok(
    appSource.includes("(paymentMethod === 'KPay' && !kpayReferenceCheck.ok)"),
    'the confirm button must stay disabled for invalid KPay references',
  );
  assert.ok(
    appSource.includes("kpayTransactionReference: normalizeKpayReference(kpayTransactionReference)"),
    'the saved sale must store the trimmed reference',
  );
});

test('Duplicate taps cannot create a second sale', () => {
  assert.match(appSource, /const checkoutInFlight = useRef\(false\)/, 'a synchronous re-entry ref is required');
  assert.ok(
    appSource.includes('if (savingSale || checkoutInFlight.current) return;'),
    'completeSale must bail out when a checkout is already in flight',
  );
  const lockIndex = appSource.indexOf('Synchronous lock: two taps');
  const addSaleIndex = appSource.indexOf('const savedSale = addSale(sale);');
  assert.notEqual(lockIndex, -1, 'the lock must be taken on the main checkout path');
  assert.notEqual(addSaleIndex, -1);
  assert.ok(lockIndex < addSaleIndex, 'the lock must be taken before addSale runs');
  assert.ok(
    appSource.slice(addSaleIndex).includes('checkoutInFlight.current = false;'),
    'every exit path must release the lock',
  );
  assert.equal(appSource.match(/addSale\(sale\)/g)?.length, 1, 'completeSale must call addSale exactly once');
});
