/**
 * Branch KPay QR preparation.
 *
 * The QR is stored inside the branch document as a data URL so every Cashier
 * receives it through the cached branch document and can display it offline.
 * Only raster formats are accepted (never SVG or a remote URL), and the encoded
 * string is capped so a branch document can never approach the 1 MiB limit.
 */
export const KPAY_QR_MAX_DATA_URL_LENGTH = 60_000;
export const KPAY_QR_ACCEPT = 'image/png,image/jpeg,image/webp';

const KPAY_QR_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const KPAY_QR_MAX_DIMENSION = 720;
const KPAY_QR_QUIET_ZONE_RATIO = 0.04;
const KPAY_QR_TARGET_DIMENSIONS = [720, 560, 440, 360] as const;
const KPAY_QR_ALLOWED_PREFIXES = ['data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,'] as const;
const KPAY_QR_ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function isAllowedKpayQrMimeType(value: unknown): value is string {
  return typeof value === 'string' && KPAY_QR_ALLOWED_MIME_TYPES.has(value.toLowerCase());
}

/**
 * True only for an in-document raster QR data URL within the size budget.
 * An empty string is the explicit "no QR configured" marker and is allowed.
 */
export function isAllowedKpayQrDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (value.length > KPAY_QR_MAX_DATA_URL_LENGTH) return false;
  return KPAY_QR_ALLOWED_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function nextKpayQrVersion(current?: number): number {
  return (typeof current === 'number' && Number.isFinite(current) && current >= 0 ? Math.floor(current) : 0) + 1;
}

type LoadedImage = { source: CanvasImageSource; width: number; height: number; dispose: () => void };

async function loadImageSource(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function renderQrDataUrl(image: LoadedImage, maxDimension: number, type: string, quality?: number): string {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('QR ပုံကို ပြင်ဆင်ရန် Canvas မရနိုင်ပါ။ Browser ကို ပြန်ဖွင့်ပြီး စမ်းပါ။');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const margin = Math.round(Math.min(width, height) * KPAY_QR_QUIET_ZONE_RATIO);
  context.drawImage(image.source, margin, margin, Math.max(1, width - margin * 2), Math.max(1, height - margin * 2));
  return canvas.toDataURL(type, quality);
}

/**
 * Validates and compresses an Owner-selected QR image into a small data URL.
 * Throws a Myanmar-language error for rejected formats or uncompressible files.
 */
export async function prepareKpayQrDataUrl(file: File): Promise<string> {
  if (!isAllowedKpayQrMimeType(file.type)) {
    throw new Error('QR ပုံကို PNG, JPEG သို့မဟုတ် WebP ဖိုင်ဖြင့်သာ ရွေးပါ။ SVG နှင့် အင်တာနက် Link ကို လက်မခံပါ။');
  }
  if (file.size <= 0) throw new Error('QR ပုံဖိုင် ဗလာဖြစ်နေပါတယ်။ အခြားပုံကို ရွေးပါ။');
  if (file.size > KPAY_QR_MAX_SOURCE_BYTES) throw new Error('QR ပုံဖိုင် အရွယ်အစားကို 5 MB အောက် ရွေးပါ။');

  const image = await loadImageSource(file);
  try {
    if (!image.width || !image.height) throw new Error('QR ပုံကို ဖတ်မရပါ။ အခြားပုံကို ရွေးပါ။');
    for (const dimension of KPAY_QR_TARGET_DIMENSIONS) {
      const png = renderQrDataUrl(image, Math.min(dimension, KPAY_QR_MAX_DIMENSION), 'image/png');
      if (isAllowedKpayQrDataUrl(png)) return png;
      const webp = renderQrDataUrl(image, Math.min(dimension, KPAY_QR_MAX_DIMENSION), 'image/webp', 0.86);
      if (isAllowedKpayQrDataUrl(webp)) return webp;
      const jpeg = renderQrDataUrl(image, Math.min(dimension, KPAY_QR_MAX_DIMENSION), 'image/jpeg', 0.86);
      if (isAllowedKpayQrDataUrl(jpeg)) return jpeg;
    }
  } finally {
    image.dispose();
  }
  throw new Error('QR ပုံကို သတ်မှတ်ထားတဲ့ အရွယ်အစားအထိ မချုံ့နိုင်ပါ။ ပိုသေးပြီး ရှင်းလင်းတဲ့ QR ပုံကို ရွေးပါ။');
}
