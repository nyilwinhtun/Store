import { renderCode128Svg } from '../lib/code128';

export function Code128Barcode({ value, className = '' }: { value: string; className?: string }) {
  const markup = renderCode128Svg(value, { moduleWidth: 1.15, barHeight: 34, includeText: false });
  return <span className={`unit-barcode-svg ${className}`} dangerouslySetInnerHTML={{ __html: markup }} />;
}
