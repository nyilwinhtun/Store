import { cleanQuantity, type QuantityMode } from './quantity';

export const DEFAULT_AMOUNT_PRESETS = [500, 1000, 2000] as const;

const STICK_UNITS = new Set(['လိပ်', 'အလိပ်', 'stick', 'sticks', 'တိုင်']);

export function isStickUnit(unit?: string): boolean {
  return STICK_UNITS.has(String(unit || '').trim().toLocaleLowerCase());
}

export function normalizeSticksPerPack(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  const rounded = Math.round(num);
  if (rounded < 2 || rounded > 1000 || Math.abs(num - rounded) > 1e-8) return undefined;
  return rounded;
}

export function parseAmountPresets(raw: string): number[] {
  const parsed = raw
    .split(/[,\s]+/)
    .map((part) => Math.round(Number(part.trim())))
    .filter((num) => Number.isFinite(num) && num >= 50 && num <= 1_000_000);
  const unique = [...new Set(parsed)].sort((a, b) => a - b);
  return unique.length > 0 ? unique.slice(0, 6) : [...DEFAULT_AMOUNT_PRESETS];
}

export function formatAmountPresets(presets?: number[]): string {
  const list = presets && presets.length > 0 ? presets : [...DEFAULT_AMOUNT_PRESETS];
  return list.join(', ');
}

export function computePackCostPerStick(packCost: number, sticksPerPack: number): number {
  if (!Number.isFinite(packCost) || packCost <= 0 || !Number.isFinite(sticksPerPack) || sticksPerPack < 2) return 0;
  return Math.round((packCost / sticksPerPack) * 100) / 100;
}

export function computeAmountBundleQuantity(
  amountMmk: number,
  unitPrice: number,
): { ok: true; quantity: number; actualAmount: number } | { ok: false; message: string } {
  if (!Number.isFinite(amountMmk) || amountMmk <= 0) {
    return { ok: false, message: 'ရောင်းချမည့် MMK ပမာဏကို မှန်ကန်စွာ ထည့်ပါ။' };
  }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return { ok: false, message: 'ဒီပစ္စည်းရဲ့ လက်လီဈေး မသတ်မှတ်ရသေးပါ။' };
  }
  const quantity = cleanQuantity(amountMmk / unitPrice, 'decimal');
  if (quantity <= 0) {
    return { ok: false, message: 'MMK ပမာဏ အလွန်နည်းနေပါတယ်။ ထပ်တိုး၍ ထည့်ပါ။' };
  }
  const actualAmount = Math.round(quantity * unitPrice * 100) / 100;
  return { ok: true, quantity, actualAmount };
}

export function cartLineKey(item: { productId: string; mode: 'retail' | 'wholesale' }): string {
  return `${item.productId}::${item.mode}`;
}

export function cartItemTotalQuantityForProduct(
  cart: ReadonlyArray<{ productId: string; quantity: number }>,
  productId: string,
): number {
  return cart
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

export function formatReceiptItemDetail(
  item: {
    quantity: number;
    unitPrice: number;
    mode: 'retail' | 'wholesale';
    unit?: string;
    quantityMode?: QuantityMode;
    amountBased?: boolean;
  },
  currency: string,
  formatQty: (qty: number, mode: QuantityMode | string | undefined) => string,
  formatMoney: (amount: number, currency: string) => string,
): string {
  const unitLabel = item.unit || '';
  const quantityText = `${formatQty(item.quantity, item.quantityMode || 'whole')} ${unitLabel}`.trim();
  if (item.amountBased) {
    const amountTotal = Math.round(item.unitPrice * item.quantity * 100) / 100;
    return `${formatMoney(amountTotal, currency)} ဖိုး (${quantityText} × ${formatMoney(item.unitPrice, currency)})`;
  }
  return `${quantityText} × ${formatMoney(item.unitPrice, currency)} · ${item.mode === 'wholesale' ? 'လက်ကား' : 'လက်လီ'}`;
}
