import { useMemo, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { makeAdjustmentRequestId, type SaleReturnRequestItem } from '../lib/saleAdjustments';
import { formatQuantity, quantityModeForProduct } from '../lib/quantity';
import type { Product, Sale, SaleReturnDisposition, StockUnit, StockUnitRegistry } from '../store/usePosStore';

export type SaleReturnSubmission = {
  requestId: string;
  reason: string;
  refundReference: string;
  items: SaleReturnRequestItem[];
};

type ReturnLine = {
  productId: string;
  name: string;
  quantityMode: 'whole' | 'decimal';
  tracked: boolean;
  remaining: number;
  selections: Array<{ registryId: string; unitId: string; barcode: string; unit: StockUnit }>;
};

type UnitChoice = { selected: boolean; disposition: SaleReturnDisposition };

export function SaleReturnDialog({
  sale, registries, products, currency, busy, onClose, onSubmit,
}: {
  sale: Sale;
  registries: StockUnitRegistry[];
  products: Product[];
  currency: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (submission: SaleReturnSubmission) => Promise<void>;
}) {
  const [requestId] = useState(() => makeAdjustmentRequestId('return', sale.id));
  const [reason, setReason] = useState('');
  const [refundReference, setRefundReference] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [lineDispositions, setLineDispositions] = useState<Record<string, SaleReturnDisposition>>({});
  const [unitChoices, setUnitChoices] = useState<Record<string, UnitChoice>>({});
  const [error, setError] = useState('');

  const lines = useMemo<ReturnLine[]>(() => {
    const productById = new Map(products.map((product) => [product.id, product]));
    const byProduct = new Map<string, ReturnLine>();
    sale.items.forEach((item) => {
      const current = byProduct.get(item.productId);
      const selections = (item.stockUnitSelections || []).flatMap((selection) => {
        const registry = registries.find((entry) => entry.id === selection.registryId);
        const unit = registry?.units.find((entry) => entry.id === selection.unitId);
        return unit && unit.status === 'sold' && unit.saleId === sale.id
          ? [{ registryId: selection.registryId, unitId: selection.unitId, barcode: selection.barcode, unit }]
          : [];
      });
      if (current) {
        current.remaining += item.quantity;
        current.tracked = current.tracked || selections.length > 0;
        current.selections.push(...selections);
        return;
      }
      byProduct.set(item.productId, {
        productId: item.productId,
        name: item.name,
        quantityMode: item.quantityMode || quantityModeForProduct(productById.get(item.productId) || { unit: item.unit || 'ခု' }),
        tracked: selections.length > 0 || productById.get(item.productId)?.tracksIndividualUnits === true,
        remaining: item.quantity,
        selections,
      });
    });
    return [...byProduct.values()].map((line) => {
      const returned = Number(sale.returnedProductQuantities?.[line.productId] || 0);
      return { ...line, remaining: Math.max(0, line.remaining - returned) };
    });
  }, [sale, registries, products]);

  const toggleUnit = (key: string) => {
    setUnitChoices((current) => {
      const existing = current[key];
      return {
        ...current,
        [key]: { selected: !existing?.selected, disposition: existing?.disposition || 'restock' },
      };
    });
  };
  const setUnitDisposition = (key: string, disposition: SaleReturnDisposition) => {
    setUnitChoices((current) => ({
      ...current,
      [key]: { selected: current[key]?.selected ?? true, disposition },
    }));
  };

  const submit = async () => {
    setError('');
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) { setError('Return အကြောင်းပြချက် အနည်းဆုံး ၃ လုံး ဖြည့်ပါ။'); return; }
    const items: SaleReturnRequestItem[] = [];
    for (const line of lines) {
      if (line.tracked) {
        const units = line.selections
          .filter((selection) => unitChoices[`${selection.registryId}::${selection.unitId}`]?.selected)
          .map((selection) => ({
            registryId: selection.registryId,
            unitId: selection.unitId,
            disposition: unitChoices[`${selection.registryId}::${selection.unitId}`]?.disposition || 'restock',
          }));
        if (!units.length) continue;
        items.push({
          productId: line.productId, quantity: units.length,
          disposition: units.every((unit) => unit.disposition === 'damaged') ? 'damaged' : 'restock',
          units,
        });
        continue;
      }
      const quantity = Number(quantities[line.productId] || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      if (quantity > line.remaining + 0.000001) { setError(`${line.name}: ကျန်ရှိပမာဏ ${formatQuantity(line.remaining, line.quantityMode)} ထက် မကျော်ရပါ။`); return; }
      items.push({
        productId: line.productId, quantity,
        disposition: lineDispositions[line.productId] || 'restock', units: [],
      });
    }
    if (!items.length) { setError('ပြန်လည်လက်ခံမည့် ပစ္စည်း အနည်းဆုံး တစ်ခု ရွေးပါ။'); return; }
    await onSubmit({ requestId, reason: trimmedReason, refundReference: refundReference.trim(), items });
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card return-sale-card" role="dialog" aria-modal="true" aria-labelledby="return-sale-title">
      <div className="modal-header">
        <div><h2 id="return-sale-title">ပစ္စည်းပြန်လည်လက်ခံရန်</h2><p>Voucher {sale.receiptNo} · မူလရောင်းချမှုကို မပြင်ဘဲ ပြန်လည်လက်ခံမှုကို သီးခြားမှတ်တမ်းတင်ပါမယ်။</p></div>
        <button className="icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="ပိတ်ရန်"><X size={19} /></button>
      </div>
      <div className="return-sale-body">
        <div className="return-sale-summary"><span>မူလအရောင်း</span><b>{sale.total.toLocaleString('en-US')} {currency}</b><small>{sale.paymentMethod} · {sale.customer}</small></div>
        <div className="return-sale-lines">
          {lines.map((line) => <div className="return-sale-line" key={line.productId}>
            <div className="return-line-heading"><strong>{line.name}</strong><small>ကျန်ရှိ {formatQuantity(line.remaining, line.quantityMode)} {line.tracked ? 'Unit' : ''}</small></div>
            {line.remaining <= 0 ? <small className="return-line-empty">ဒီပစ္စည်းကို အပြည့်အဝ ပြန်လည်လက်ခံပြီးပါပြီ။</small> : line.tracked
              ? <div className="return-unit-list">{line.selections.length === 0
                ? <small className="return-line-empty">ပြန်လည်လက်ခံနိုင်သော Sticker Unit မတွေ့ပါ။ Cloud Sync ပြီးမှ ပြန်စမ်းပါ။</small>
                : line.selections.map((selection) => {
                  const key = `${selection.registryId}::${selection.unitId}`;
                  const choice = unitChoices[key];
                  return <div className={`return-unit-row ${choice?.selected ? 'selected' : ''}`} key={key}>
                    <label><input type="checkbox" checked={!!choice?.selected} onChange={() => toggleUnit(key)} /> <span className="mono">{selection.barcode}</span></label>
                    {choice?.selected && <select value={choice.disposition} onChange={(event) => setUnitDisposition(key, event.target.value as SaleReturnDisposition)}><option value="restock">ပြန်ရောင်းနိုင်</option><option value="damaged">ပျက်စီး / Quarantine</option></select>}
                  </div>;
                })}</div>
              : <div className="return-plain-row">
                <label>ပမာဏ<input type="number" min="0" max={line.remaining} step={line.quantityMode === 'decimal' ? '0.001' : '1'} value={quantities[line.productId] || ''} onChange={(event) => setQuantities((current) => ({ ...current, [line.productId]: event.target.value }))} disabled={busy} /></label>
                <label>အခြေအနေ<select value={lineDispositions[line.productId] || 'restock'} onChange={(event) => setLineDispositions((current) => ({ ...current, [line.productId]: event.target.value as SaleReturnDisposition }))} disabled={busy}><option value="restock">ပြန်ရောင်းနိုင်</option><option value="damaged">ပျက်စီး / Quarantine</option></select></label>
              </div>}
          </div>)}
        </div>
        <label className="span-2">Return အကြောင်းပြချက် *<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} disabled={busy} placeholder="ဥပမာ - Customer ပြန်လည်အပ်နှံသည်" /></label>
        {sale.paymentMethod === 'KPay' && <label className="span-2">KPay Refund Reference (ရှိပါက)<input value={refundReference} onChange={(event) => setRefundReference(event.target.value)} maxLength={120} disabled={busy} placeholder="KPay Refund Transaction ID" /><small className="field-hint">ဤ Reference ကို မှတ်တမ်းတင်သော်လည်း App က ငွေလွှဲအောင်မြင်ကြောင်း အတည်ပြုပေးမည် မဟုတ်ပါ။ Refund Status သည် Pending ဖြစ်နေပါမည်။</small></label>}
        <div className="backup-warning"><RotateCcw size={16} /><span>ပြန်ရောင်းနိုင်သော ပစ္စည်းသာ Stock ပြန်တိုးပါမယ်။ ပျက်စီးပစ္စည်းကို Quarantine အဖြစ် မှတ်ပြီး ပြန်မရောင်းပါ။ KPay/Credit Refund ကို ငွေလွှဲပြီးကြောင်း အတည်ပြုပြီးမှသာ ပြင်ပမှာ ပြီးစီးပါ။</span></div>
        {error && <p className="payment-verify-error" role="alert">{error}</p>}
      </div>
      <div className="modal-actions">
        <button className="button button-outline" type="button" onClick={onClose} disabled={busy}>ပယ်ဖျက်</button>
        <button className="button button-primary" type="button" onClick={() => void submit()} disabled={busy}><Check size={16} /> {busy ? 'Server မှာ မှတ်တမ်းတင်နေသည်…' : 'Return အတည်ပြု'}</button>
      </div>
    </section>
  </div>;
}
