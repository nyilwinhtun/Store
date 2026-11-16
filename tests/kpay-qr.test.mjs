import { test } from 'node:test';
import assert from 'node:assert/strict';

const moduleUrl = new URL('../.qa-build/kpayQr.mjs', import.meta.url);
const {
  KPAY_QR_MAX_DATA_URL_LENGTH,
  isAllowedKpayQrMimeType,
  isAllowedKpayQrDataUrl,
  nextKpayQrVersion,
} = await import(moduleUrl.href);

const PNG = 'data:image/png;base64,';
const JPEG = 'data:image/jpeg;base64,';
const WEBP = 'data:image/webp;base64,';
const payload = (length) => 'A'.repeat(length);

test('Allows only PNG, JPEG and WebP source images', () => {
  assert.equal(isAllowedKpayQrMimeType('image/png'), true);
  assert.equal(isAllowedKpayQrMimeType('image/jpeg'), true);
  assert.equal(isAllowedKpayQrMimeType('image/webp'), true);
  assert.equal(isAllowedKpayQrMimeType('IMAGE/PNG'), true);
  assert.equal(isAllowedKpayQrMimeType('image/svg+xml'), false);
  assert.equal(isAllowedKpayQrMimeType('image/gif'), false);
  assert.equal(isAllowedKpayQrMimeType('text/html'), false);
  assert.equal(isAllowedKpayQrMimeType(''), false);
  assert.equal(isAllowedKpayQrMimeType(undefined), false);
});

test('Accepts in-document raster data URLs only', () => {
  assert.equal(isAllowedKpayQrDataUrl(`${PNG}AAAA`), true);
  assert.equal(isAllowedKpayQrDataUrl(`${JPEG}AAAA`), true);
  assert.equal(isAllowedKpayQrDataUrl(`${WEBP}AAAA`), true);
  assert.equal(isAllowedKpayQrDataUrl(''), true, 'empty string is the explicit no-QR marker');
  assert.equal(isAllowedKpayQrDataUrl('data:image/svg+xml;base64,AAAA'), false);
  assert.equal(isAllowedKpayQrDataUrl('https://example.com/qr.png'), false);
  assert.equal(isAllowedKpayQrDataUrl('local-image:qr-1'), false);
  assert.equal(isAllowedKpayQrDataUrl('data:text/html;base64,AAAA'), false);
  assert.equal(isAllowedKpayQrDataUrl(null), false);
  assert.equal(isAllowedKpayQrDataUrl(undefined), false);
});

test('Enforces the 60,000 character budget exactly', () => {
  const prefix = PNG;
  const fits = prefix + payload(KPAY_QR_MAX_DATA_URL_LENGTH - prefix.length);
  assert.equal(fits.length, KPAY_QR_MAX_DATA_URL_LENGTH);
  assert.equal(isAllowedKpayQrDataUrl(fits), true);
  assert.equal(isAllowedKpayQrDataUrl(`${fits}A`), false);
});

test('QR version increases monotonically and never goes backwards', () => {
  assert.equal(nextKpayQrVersion(undefined), 1);
  assert.equal(nextKpayQrVersion(0), 1);
  assert.equal(nextKpayQrVersion(1), 2);
  assert.equal(nextKpayQrVersion(41), 42);
  assert.equal(nextKpayQrVersion(-5), 1);
  assert.equal(nextKpayQrVersion(Number.NaN), 1);
  assert.equal(nextKpayQrVersion(Number.POSITIVE_INFINITY), 1);
});
