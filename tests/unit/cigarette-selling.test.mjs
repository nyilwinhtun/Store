import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cartItemTotalQuantityForProduct,
  cartLineKey,
  computeAmountBundleQuantity,
  computePackCostPerStick,
  DEFAULT_AMOUNT_PRESETS,
  formatAmountPresets,
  formatReceiptItemDetail,
  isStickUnit,
  normalizeSticksPerPack,
  parseAmountPresets,
} from '../../.qa-build/cigaretteSelling.mjs';

test('stick unit detection and sticks-per-pack normalization', () => {
  assert.equal(isStickUnit('လိပ်'), true);
  assert.equal(isStickUnit('stick'), true);
  assert.equal(isStickUnit('ဘူး'), false);

  assert.equal(normalizeSticksPerPack('20'), 20);
  assert.equal(normalizeSticksPerPack(1), undefined);
  assert.equal(normalizeSticksPerPack(12.5), undefined);
  assert.equal(normalizeSticksPerPack(''), undefined);
});

test('amount presets parsing and formatting', () => {
  assert.deepEqual(parseAmountPresets('1000, 500, 2000, 500'), [500, 1000, 2000]);
  assert.deepEqual(parseAmountPresets('invalid'), [...DEFAULT_AMOUNT_PRESETS]);
  assert.equal(formatAmountPresets([500, 1000, 2000]), '500, 1000, 2000');
});

test('pack cost per stick and amount bundle quantity math', () => {
  assert.equal(computePackCostPerStick(2500, 20), 125);
  assert.deepEqual(computeAmountBundleQuantity(500, 1000), { ok: true, quantity: 0.5, actualAmount: 500 });
  assert.deepEqual(computeAmountBundleQuantity(1000, 1000), { ok: true, quantity: 1, actualAmount: 1000 });
  assert.deepEqual(computeAmountBundleQuantity(300, 1000), { ok: true, quantity: 0.3, actualAmount: 300 });
  assert.equal(computeAmountBundleQuantity(0, 1000).ok, false);
});

test('cart line key and product total quantity across retail and wholesale lines', () => {
  const cart = [
    { productId: 'cig-1', mode: 'retail', quantity: 3 },
    { productId: 'cig-1', mode: 'wholesale', quantity: 20 },
  ];
  assert.equal(cartLineKey(cart[0]), 'cig-1::retail');
  assert.equal(cartLineKey(cart[1]), 'cig-1::wholesale');
  assert.equal(cartItemTotalQuantityForProduct(cart, 'cig-1'), 23);
});

test('receipt item detail formatting for pack, stick, and amount-based items', () => {
  const fmtQty = (q) => String(q);
  const fmtMoney = (m, c) => `${m} ${c}`;
  assert.equal(
    formatReceiptItemDetail({ quantity: 1, unitPrice: 3000, mode: 'retail', unit: 'ဘူး' }, 'MMK', fmtQty, fmtMoney),
    '1 ဘူး × 3000 MMK · လက်လီ',
  );
  assert.equal(
    formatReceiptItemDetail({ quantity: 0.5, unitPrice: 1000, mode: 'retail', unit: 'ထုပ်', quantityMode: 'decimal', amountBased: true }, 'MMK', fmtQty, fmtMoney),
    '500 MMK ဖိုး (0.5 ထုပ် × 1000 MMK)',
  );
});
