/**
 * Minimal Code 128B SVG renderer for internal unit labels.
 * Pattern widths follow the standard Code 128 symbol table.
 * Pattern table attribution: Tyler C. Sarna, as distributed in ReportLab's
 * Code 128 implementation. See THIRD-PARTY-NOTICES.md for the full notice.
 */
const CODE128_PATTERNS = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112"
] as const;

function escapeXml(value: string): string {
  return value.replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&apos;' }[char] || char));
}

/** Encode printable ASCII as Code 128 Set B, including checksum and stop. */
export function encodeCode128B(value: string): number[] {
  if (!value || [...value].some((char) => { const code = char.charCodeAt(0); return code < 32 || code > 126; })) {
    throw new Error('Code 128B သည် ASCII စာလုံး 32–126 ကိုသာ လက်ခံပါတယ်။');
  }
  const data = [...value].map((char) => char.charCodeAt(0) - 32);
  const start = 104;
  const checksum = data.reduce((sum, code, index) => sum + (index + 1) * code, start) % 103;
  return [start, ...data, checksum, 106];
}

/** Return a standards-compliant SVG with quiet zones and readable text. */
export function renderCode128Svg(value: string, options: { moduleWidth?: number; barHeight?: number; includeText?: boolean } = {}): string {
  const encoded = encodeCode128B(value);
  const quiet = 10;
  const moduleWidth = Math.max(1, options.moduleWidth ?? 1.35);
  const barHeight = Math.max(24, options.barHeight ?? 42);
  let modules = 0;
  const rectangles: string[] = [];
  for (const code of encoded) {
    const pattern = CODE128_PATTERNS[code];
    if (!pattern) throw new Error(`Code 128 pattern မတွေ့ပါ: ${code}`);
    let isBar = true;
    for (const widthChar of pattern) {
      const width = Number(widthChar);
      if (isBar) rectangles.push(`<rect x="${(quiet + modules) * moduleWidth}" y="0" width="${width * moduleWidth}" height="${barHeight}" fill="#000"/>`);
      modules += width;
      isBar = !isBar;
    }
  }
  const totalWidth = (modules + quiet * 2) * moduleWidth;
  const textHeight = options.includeText === false ? 0 : 15;
  const text = options.includeText === false ? '' : `<text x="${totalWidth / 2}" y="${barHeight + 12}" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#000">${escapeXml(value)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${barHeight + textHeight}" viewBox="0 0 ${totalWidth} ${barHeight + textHeight}" role="img" aria-label="Barcode ${escapeXml(value)}">${rectangles.join('')}${text}</svg>`;
}

/** Generate a short, scanner-friendly internal unit barcode with 64 random bits. */
export function generateUnitBarcode(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure Barcode Generate အတွက် HTTPS သို့မဟုတ် localhost လိုအပ်ပါတယ်။');
  }
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `MU-${suffix}`;
}
