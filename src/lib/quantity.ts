/** Quantity rules shared by POS, receiving, stock adjustment and branch transfer. */
export type QuantityMode = 'whole' | 'decimal';

const DECIMAL_UNITS = new Set([
  'kg', 'kgs', 'kilogram', 'kilograms', 'ကီလို', 'ကီလိုဂရမ်',
  'l', 'lt', 'liter', 'litre', 'liters', 'litres', 'လီတာ',
  'm', 'meter', 'metre', 'meters', 'metres', 'မီတာ',
  'g', 'gm', 'gram', 'grams', 'ဂရမ်', 'ml', 'milliliter', 'millilitre', 'မီလီလီတာ',
  'oz', 'ounce', 'ounces', 'အောင်စ', 'lb', 'lbs', 'pound', 'ပေါင်',
  'ပိဿာ', 'ကျပ်သား', 'သား', 'cm', 'mm', 'inch', 'in', 'လက်မ', 'yard', 'yd', 'ft', 'feet', 'foot', 'ပေ',
]);

export function normalizeUnit(unit?: string): string {
  return String(unit || 'ခု').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function inferQuantityMode(unit?: string): QuantityMode {
  return DECIMAL_UNITS.has(normalizeUnit(unit)) ? 'decimal' : 'whole';
}

export function quantityModeForProduct(product: { unit?: string; quantityMode?: QuantityMode }): QuantityMode {
  return product.quantityMode === 'decimal' || product.quantityMode === 'whole'
    ? product.quantityMode
    : inferQuantityMode(product.unit);
}

export function quantityStep(modeOrUnit: QuantityMode | string | undefined): string {
  const mode = modeOrUnit === 'whole' || modeOrUnit === 'decimal'
    ? modeOrUnit
    : inferQuantityMode(modeOrUnit);
  return mode === 'decimal' ? '0.001' : '1';
}

export function quantityMin(modeOrUnit: QuantityMode | string | undefined): string {
  return quantityStep(modeOrUnit);
}

export function isValidQuantity(value: number, modeOrUnit: QuantityMode | string | undefined, allowZero = false): boolean {
  if (!Number.isFinite(value) || value > 1_000_000 || (allowZero ? value < 0 : value <= 0)) return false;
  const mode = modeOrUnit === 'whole' || modeOrUnit === 'decimal'
    ? modeOrUnit
    : inferQuantityMode(modeOrUnit);
  if (mode === 'whole') return Math.abs(value - Math.round(value)) < 1e-9;
  return Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7;
}

/** Remove IEEE-754 tails without changing the intended quantity precision. */
export function cleanQuantity(value: number, modeOrUnit: QuantityMode | string | undefined): number {
  const mode = modeOrUnit === 'whole' || modeOrUnit === 'decimal'
    ? modeOrUnit
    : inferQuantityMode(modeOrUnit);
  return mode === 'whole' && Math.abs(value - Math.round(value)) < 1e-8
    ? Math.round(value)
    : Math.round(value * 1000) / 1000;
}

export function formatQuantity(value: number, modeOrUnit: QuantityMode | string | undefined): string {
  const mode = modeOrUnit === 'whole' || modeOrUnit === 'decimal'
    ? modeOrUnit
    : inferQuantityMode(modeOrUnit);
  const safe = Math.round((Number(value) || 0) * 1000) / 1000;
  // Legacy fractional quantities in whole-unit products remain visible for correction;
  // they are never silently rounded to an integer.
  const isWholeValue = Math.abs(safe - Math.round(safe)) < 1e-8;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: mode === 'whole' && isWholeValue ? 0 : 3, minimumFractionDigits: 0 }).format(safe);
}

export function hasLegacyFractionalQuantity(value: number, modeOrUnit: QuantityMode | string | undefined): boolean {
  const mode = modeOrUnit === 'whole' || modeOrUnit === 'decimal'
    ? modeOrUnit
    : inferQuantityMode(modeOrUnit);
  return mode === 'whole' && Number.isFinite(value) && Math.abs(value - Math.round(value)) > 1e-8;
}

/** Summarize mixed-unit quantities without adding incomparable units together. */
export function summarizeQuantities(items: Array<{ quantity: number; unit?: string; quantityMode?: QuantityMode }>): string {
  const totals = new Map<string, { unit: string; mode: QuantityMode; quantity: number }>();
  for (const item of items) {
    const unit = String(item.unit || 'ခု').trim() || 'ခု';
    const key = normalizeUnit(unit);
    const mode = item.quantityMode || inferQuantityMode(unit);
    const current = totals.get(key) || { unit, mode, quantity: 0 };
    current.quantity = cleanQuantity(current.quantity + (Number(item.quantity) || 0), current.mode);
    totals.set(key, current);
  }
  return [...totals.values()].map((entry) => `${formatQuantity(entry.quantity, entry.mode)} ${entry.unit}`).join(' · ') || '0 ခု';
}
