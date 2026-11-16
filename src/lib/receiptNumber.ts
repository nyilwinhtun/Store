/**
 * Receipt numbers are customer-facing and used as statement references, so the
 * day must be the shop's local day and the suffix must not repeat during a day.
 * The previous 5-digit millisecond suffix repeated every 100 seconds.
 */
const SUFFIX_LENGTH = 12;

function receiptSuffix(): string {
  try {
    const cryptoValue = (globalThis as { crypto?: Crypto }).crypto;
    if (cryptoValue?.randomUUID) {
      return cryptoValue.randomUUID().replace(/-/g, '').slice(0, SUFFIX_LENGTH).toUpperCase();
    }
  } catch {
    // Fall back to time plus randomness below.
  }
  const fallback = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`.toUpperCase();
  return fallback.slice(-SUFFIX_LENGTH).padStart(SUFFIX_LENGTH, '0');
}

export function makeReceiptNo(now: Date = new Date(), suffix: string = receiptSuffix()): string {
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `MM-${day}-${suffix}`;
}
