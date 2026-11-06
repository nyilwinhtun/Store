/** Normalize scanner input without removing leading zeroes or meaningful code characters. */
export function normalizeBarcode(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '').toUpperCase() : '';
}
