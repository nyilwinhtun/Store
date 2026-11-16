import { normalizeBarcode } from './barcode';

export type UnitLike = {
  id: string;
  barcode: string;
  status: string;
  batchId?: string;
  saleId?: string;
};

export type UnitRegistryLike = {
  id: string;
  branchId: string;
  productId: string;
  chunkIndex?: number;
  units: UnitLike[];
};

export type UnitMatch = {
  registryId: string;
  branchId: string;
  productId: string;
  unit: UnitLike;
};

export type UnitCandidate = { barcode: string; barcodeSource: 'manufacturer_serial' | 'app_generated' | 'purchased_sticker'; note?: string };

export type UnitCandidateValidation =
  | { ok: true; normalized: string[] }
  | { ok: false; reason: 'empty' | 'invalid-format' | 'duplicate-existing' | 'duplicate-input'; barcode: string };

export const MAX_UNIT_BARCODE_LENGTH = 128;
export const MAX_UNITS_PER_REGISTRY = 250;
export const MAX_UNITS_PER_RECEIPT = 1000;
export const UNIT_TRANSFER_UNSUPPORTED_MESSAGE = 'Unit Barcode Sticker Tracking ရှိသော ပစ္စည်းကို Unit Registry မပါဘဲ Branch လွှဲ/ပို့ မလုပ်နိုင်သေးပါ။ Quantity-based ပစ္စည်းများကိုသာ လွှဲပို့နိုင်ပါသည်။';

export function isValidUnitBarcode(value: unknown): value is string {
  const code = normalizeBarcode(value);
  return code.length > 0 && code.length <= MAX_UNIT_BARCODE_LENGTH && /^[\x20-\x7E]+$/.test(code);
}

export function findUnitMatches(registries: UnitRegistryLike[], rawCode: string): UnitMatch[] {
  const code = normalizeBarcode(rawCode);
  if (!code) return [];
  return registries.flatMap((registry) => registry.units
    .filter((unit) => normalizeBarcode(unit.barcode) === code)
    .map((unit) => ({ registryId: registry.id, branchId: registry.branchId, productId: registry.productId, unit })));
}

export function validateUnitCandidates(candidates: UnitCandidate[], usedCodes: Set<string>): UnitCandidateValidation {
  if (!Array.isArray(candidates) || candidates.length === 0) return { ok: false, reason: 'empty', barcode: '' };
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const code = normalizeBarcode(candidate.barcode);
    if (!isValidUnitBarcode(code)) return { ok: false, reason: 'invalid-format', barcode: code };
    if (usedCodes.has(code)) return { ok: false, reason: 'duplicate-existing', barcode: code };
    if (seen.has(code)) return { ok: false, reason: 'duplicate-input', barcode: code };
    seen.add(code);
    normalized.push(code);
  }
  return { ok: true, normalized };
}

export function productIsUnitTracked(
  product: { tracksIndividualUnits?: boolean; id: string; branchId?: string },
  registries: UnitRegistryLike[],
  branchId?: string,
): boolean {
  if (product.tracksIndividualUnits === true) return true;
  return registries.some((registry) => registry.productId === product.id
    && (!branchId || registry.branchId === branchId)
    && registry.units.length > 0);
}

/**
 * A sellable unit must still be physically available. Sold, reserved, in-transit
 * and pending-approval units are deliberately excluded.
 */
export function isUnitSellable(unit: UnitLike): boolean {
  return unit.status === 'in_stock';
}

export function unitAvailabilityMessage(status: string): string {
  switch (status) {
    case 'sold': return 'ဒီ Barcode Unit ကို ရောင်းချပြီးသားဖြစ်ပါတယ်။';
    case 'reserved': return 'ဒီ Barcode Unit ကို ယာယီသိမ်းထားပါတယ်။';
    case 'in_transit': return 'ဒီ Barcode Unit က လမ်းပေါ်ရောက်နေဆဲဖြစ်ပါတယ်။';
    case 'pending_approval': return 'ဒီ Barcode Unit က အတည်ပြုချက် စောင့်နေပါတယ်။';
    case 'damaged': return 'ဒီ Barcode Unit က ပျက်စီးထားတဲ့အတွက် မရောင်းနိုင်ပါ။';
    case 'missing': return 'ဒီ Barcode Unit က ပျောက်ဆုံးစာရင်းထဲ ရောက်နေပါတယ်။';
    case 'returned': return 'ဒီ Barcode Unit က ပြန်အပ်ပြီးသားဖြစ်ပါတယ်။';
    case 'written_off': return 'ဒီ Barcode Unit က စာရင်းပယ်ဖျက်ပြီးသားဖြစ်ပါတယ်။';
    default: return 'ဒီ Barcode Unit ကို ရောင်းချနိုင်တဲ့အခြေအနေမှာ မရှိပါ။';
  }
}

export function unitsForProductInBranch(registries: UnitRegistryLike[], branchId: string, productId: string): UnitLike[] {
  return registries
    .filter((registry) => registry.branchId === branchId && registry.productId === productId)
    .flatMap((registry) => registry.units);
}

export function countReceivableUnits(
  productStock: number,
  registries: UnitRegistryLike[],
  branchId: string,
  productId: string,
): number {
  const registeredInStock = unitsForProductInBranch(registries, branchId, productId)
    .filter((unit) => unit.status === 'in_stock' || unit.status === 'reserved').length;
  return Math.max(0, Math.floor(Number(productStock) || 0) - registeredInStock);
}

export function normalizeUnitSelectionKey(branchId: string, productId: string, unitId: string): string {
  return `${branchId}::${productId}::${unitId}`;
}
