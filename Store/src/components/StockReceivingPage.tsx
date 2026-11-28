import { useMemo, useState, type FormEvent } from 'react';
import { Camera, ClipboardList, PackagePlus, Plus, RotateCcw, Save, Store, X } from 'lucide-react';
import { DEFAULT_BRANCH_ID, usePosStore } from '../store/usePosStore';
import { formatQuantity, inferQuantityMode, quantityModeForProduct, quantityStep, summarizeQuantities } from '../lib/quantity';
import { BarcodeCameraScanner } from './BarcodeCameraScanner';
import { normalizeBarcode } from '../lib/barcode';

type IntakeLine = { key: string; name: string; quantity: string; unit: string; barcode: string };
const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const blankLine = (): IntakeLine => ({ key: newKey(), name: '', quantity: '1', unit: 'ခု', barcode: '' });
const dateLabel = (value: string) => value ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export function StockReceivingPage({ notify }: { notify: (message: string) => void }) {
  const branches = usePosStore((state) => state.branches);
  const allProducts = usePosStore((state) => state.products);
  const allReceipts = usePosStore((state) => state.stockReceipts);
  const stockUnitRegistries = usePosStore((state) => state.stockUnitRegistries);
  const addQuickGoodsArrival = usePosStore((state) => state.addQuickGoodsArrival);
  const hubBranch = branches.find((branch) => branch.isDefault) || branches.find((branch) => branch.id === DEFAULT_BRANCH_ID) || branches[0];
  const products = useMemo(() => allProducts.filter((product) => product.branchId === hubBranch?.id), [allProducts, hubBranch?.id]);
  const receipts = useMemo(() => allReceipts.filter((receipt) => receipt.branchId === hubBranch?.id).sort((a, b) => b.date.localeCompare(a.date)), [allReceipts, hubBranch?.id]);
  const [receivedDate, setReceivedDate] = useState(today());
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<IntakeLine[]>([blankLine()]);
  const [search, setSearch] = useState('');
  const [cameraLineKey, setCameraLineKey] = useState<string | null>(null);

  const updateLine = (key: string, changes: Partial<IntakeLine>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line));
  const findBarcodeProduct = (rawCode: string) => {
    const code = normalizeBarcode(rawCode);
    if (!code) return undefined;
    return products.find((product) => normalizeBarcode(product.barcode) === code || normalizeBarcode(product.sku) === code);
  };
  const findLineProduct = (line: IntakeLine) => {
    const code = normalizeBarcode(line.barcode);
    return (code ? findBarcodeProduct(code) : undefined)
      || products.find((product) => product.name.trim().toLocaleLowerCase() === line.name.trim().toLocaleLowerCase()
        && (product.unit || 'ခု').trim().toLocaleLowerCase() === (line.unit || 'ခု').trim().toLocaleLowerCase());
  };
  const applyScannedBarcode = (lineKey: string, rawCode: string) => {
    const code = normalizeBarcode(rawCode);
    if (!code) return;
    const product = findBarcodeProduct(code);
    updateLine(lineKey, { barcode: code, ...(product ? { name: product.name, unit: product.unit || 'ခု' } : {}) });
    notify(product
      ? `${product.name} ကို Barcode / SKU ဖြင့် တွေ့ရှိပါပြီ။ အရေအတွက်ကို စစ်ပြီး ကုန်ဝင်စာရင်းသိမ်းပါ။`
      : `Barcode ${code} ကို ဖတ်ပြီးပါပြီ။ Product အသစ်ဖြစ်ပါက အမည်နဲ့ ယူနစ်ကို ဖြည့်ပါ။`);
  };
  const lineMode = (line: IntakeLine) => { const existing = findLineProduct(line); return existing ? quantityModeForProduct(existing) : inferQuantityMode(line.unit); };
  const trackedUnits = summarizeQuantities(receipts.flatMap((receipt) => receipt.items.map((item) => ({ quantity: item.quantity, unit: item.unit || 'ခု' }))));
  const filteredReceipts = receipts.filter((receipt) => {
    const query = search.trim().toLocaleLowerCase();
    return !query || `${receipt.receiptNo} ${receipt.note} ${receipt.items.map((item) => item.productName).join(' ')}`.toLocaleLowerCase().includes(query);
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!hubBranch) { notify('အဓိကဆိုင် မရှိသေးပါ။ ဆိုင်စာရင်းကို စစ်ဆေးပါ။'); return; }
    const items = lines.map((line) => ({ name: line.name.trim(), quantity: Number(line.quantity), unit: line.unit.trim() || 'ခု', barcode: normalizeBarcode(line.barcode) || undefined }));
    if (items.some((item) => !item.name || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      notify('ပစ္စည်းအမည်နဲ့ အရေအတွက်ကို မှန်ကန်စွာ ဖြည့်ပါ။'); return;
    }
    const trackedProduct = items.map((item) => findLineProduct({ ...blankLine(), name: item.name, unit: item.unit, barcode: item.barcode || '', quantity: String(item.quantity) }))
      .find((product) => product && stockUnitRegistries.some((registry) => registry.branchId === hubBranch.id && registry.productId === product.id && registry.units.length > 0));
    if (trackedProduct) { notify(`${trackedProduct.name}: ဒီ Product မှာ Barcode Sticker Unit Tracking အသုံးပြုထားပါတယ်။ Quantity နဲ့ ကုန်ရောက်စာရင်း ထပ်မတိုးနိုင်ပါ။ Product/Stock ထဲက Sticker Scan Registration ကို သုံးပါ။`); return; }
    const receiptId = addQuickGoodsArrival({ receivedDate, note, items });
    if (!receiptId) { notify('ကုန်ရောက်စာရင်း မသိမ်းနိုင်ပါ။ အမည်၊ ယူနစ်နဲ့ အရေအတွက်ကို စစ်ဆေးပါ။'); return; }
    setLines([blankLine()]); setNote(''); setReceivedDate(today());
    notify(`${hubBranch.name} သို့ ကုန်ရောက်စာရင်း သိမ်းပြီး Stock တိုးပြီးပါပြီ။ ဈေးနှုန်းနဲ့ Barcode ကို နောက်မှ ဖြည့်နိုင်ပါတယ်။`);
  };

  const handleCameraDetected = (rawCode: string) => {
    if (cameraLineKey) applyScannedBarcode(cameraLineKey, rawCode);
    setCameraLineKey(null);
  };

  return <section className="page-stack">
    <div className="section-heading">
      <div><h2>ရိုးရှင်းသော ကုန်ရောက်စာရင်း</h2><p>ကုန်ရောက်လာချိန် ပစ္စည်းအမည်နဲ့ အရေအတွက်သာ အရင်ထည့်ပါ။</p></div>
      <div className="sales-summary-chip"><Store size={16} /> အဓိကဆိုင်</div>
    </div>

    <div className="mini-stats">
      <div className="mini-stat"><div className="mini-stat-icon"><Store size={17} /></div><div><small>ကုန်လက်ခံမည့်ဆိုင်</small><strong>{hubBranch?.name || 'မသတ်မှတ်ရသေး'}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon"><PackagePlus size={17} /></div><div><small>အဓိကဆိုင် Product</small><strong>{products.length}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon"><ClipboardList size={17} /></div><div><small>ကုန်ရောက်မှတ်တမ်း</small><strong>{receipts.length}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon"><PackagePlus size={17} /></div><div><small>ယူနစ်အလိုက် ကုန်ရောက်စုစုပေါင်း</small><strong>{trackedUnits}</strong></div></div>
    </div>

    <div className="panel security-note"><Store size={18} /><div><strong>ကုန်အားလုံးကို အရင်ဆုံး {hubBranch?.name || 'အဓိကဆိုင်'} မှာပဲ လက်ခံမယ်</strong><p>လက်ရှိ Branch Selector မှာ ဘယ်ဆိုင်ကိုရွေးထားသည်ဖြစ်စေ ဒီစာမျက်နှာက ကုန်ရောက်စာရင်းကို အဓိကဆိုင်ထဲမှာသာ ထည့်ပါမယ်။ တခြားဆိုင်မှာ နေရာမရှိရင် အဲဒီဆိုင်အတွက် Product/Stock မဖန်တီးပါဘူး။ လိုအပ်လာမှ Owner က ကုန်လွှဲစာမျက်နှာကနေ လွှဲပေးနိုင်ပါတယ်။</p></div></div>

    <form className="panel form-panel stock-receiving-form" onSubmit={submit}>
      <div className="panel-heading"><div className="panel-icon"><PackagePlus size={18} /></div><div><h3>ရောက်လာသော ပစ္စည်းများ ထည့်ရန်</h3><p>Barcode / SKU ကို Bluetooth သို့မဟုတ် USB Scanner ဖြင့် Scan ဖတ်ပြီး Product အချက်အလက်ကို အလိုအလျောက်ရှာနိုင်ပါတယ်။</p></div></div>
      <div className="form-grid">
        <label>ရောက်ရှိသည့်ရက်<input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} required /></label>
        <label>မှတ်ချက် (မဖြစ်မနေ မဟုတ်)<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="ဥပမာ - မနက်ပိုင်း ကုန်ရောက်" /></label>
      </div>
      <div className="receiving-lines-heading"><div><strong>ကုန်ပစ္စည်းများ</strong><small>ပစ္စည်းတစ်မျိုးစီအတွက် အမည်၊ အရေအတွက်နဲ့ ယူနစ်ကိုသာ ဖြည့်ပါ။</small></div><button className="button button-outline" type="button" onClick={() => setLines((current) => [...current, blankLine()])}><Plus size={15} /> ပစ္စည်းထပ်ထည့်ရန်</button></div>
      <datalist id="hub-product-suggestions">{products.map((product) => <option key={product.id} value={product.name}>{product.unit}</option>)}</datalist>
      <div className="receiving-lines">
        {lines.map((line, index) => <div className="receiving-line-card" key={line.key}>
          <div className="receiving-line-title"><strong>ပစ္စည်း {index + 1}</strong><button className="small-action danger-action" type="button" onClick={() => setLines((current) => current.length > 1 ? current.filter((entry) => entry.key !== line.key) : [blankLine()])} title="ဖယ်ရှားရန်"><X size={14} /></button></div>
          <div className="form-grid receiving-new-product">
            <label className="span-2">ပစ္စည်းအမည် *<input list="hub-product-suggestions" required value={line.name} onChange={(event) => {
              const name = event.target.value;
              const match = products.find((product) => product.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
              updateLine(line.key, { name, ...(match ? { unit: match.unit || 'ခု' } : {}) });
            }} placeholder="ဥပမာ - Coca Cola" /></label>
            <label>Barcode / SKU (optional)<div className="barcode-field-control"><input value={line.barcode} onChange={(event) => { const barcode = event.target.value; const match = findBarcodeProduct(barcode); updateLine(line.key, { barcode, ...(match ? { name: match.name, unit: match.unit || 'ခု' } : {}) }); }} placeholder="Bluetooth / USB Scanner ဖြင့် ဖတ်ပါ" inputMode="text" autoComplete="off" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyScannedBarcode(line.key, line.barcode); } }} /><button className="button button-outline barcode-camera-button" type="button" onClick={() => setCameraLineKey(line.key)} title="Camera ဖြင့် Barcode ဖတ်ရန်"><Camera size={14} /> Scan</button></div></label>
            <label>အရေအတွက် *<input required type="number" min={quantityStep(lineMode(line))} step={quantityStep(lineMode(line))} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
            <label>ယူနစ်<input value={line.unit} onChange={(event) => updateLine(line.key, { unit: event.target.value })} placeholder="ခု / ဘူး / ထုပ် / အိတ်" /></label>
          </div>
          <small className="field-hint">Barcode / SKU ရှိပြီးသား Product ကို Scan လုပ်ပါက အမည်နဲ့ ယူနစ်ကို အလိုအလျောက်ဖြည့်ပေးပါမယ်။ မရှိသေးတဲ့ Barcode ဖြစ်ပါက Product အမည်နဲ့ ယူနစ်ဖြည့်ပြီး သိမ်းပါ။</small>
        </div>)}
      </div>
      <div className="receiving-total-row"><div><small>ကုန်ရောက်အရေအတွက် စုစုပေါင်း</small><strong>{summarizeQuantities(lines.filter((line) => line.name.trim()).map((line) => ({ quantity: Number(line.quantity) || 0, unit: line.unit || 'ခု', quantityMode: lineMode(line) })))}</strong></div><div><small>ပစ္စည်းအမျိုးအစား</small><strong>{lines.filter((line) => line.name.trim()).length} မျိုး</strong></div></div>
      <div className="receiving-actions"><button className="button button-outline" type="button" onClick={() => { setLines([blankLine()]); setNote(''); setReceivedDate(today()); }}><RotateCcw size={15} /> ပြန်ရှင်းရန်</button><button className="button button-primary" type="submit"><Save size={16} /> ကုန်ရောက်စာရင်း သိမ်းရန်</button></div>
      <div className="backup-warning"><ClipboardList size={16} /><span>အသစ်ဖန်တီးသော Product တွင် Barcode၊ အရင်းဈေး၊ လက်လီဈေး၊ လက်ကားဈေးကို မဖြည့်သေးဘဲ သိမ်းပါမယ်။ Inventory ထဲမှာ နောက်မှ ဖြည့်နိုင်ပါတယ်။ ဈေးနှုန်း မသတ်မှတ်ရသေးလျှင် POS မှာ ရောင်းချခွင့်မပေးပါ။</span></div>
    </form>

    <div className="panel">
      <div className="panel-heading"><div><h3>အဓိကဆိုင် ကုန်ရောက်မှတ်တမ်း</h3><p>ဆိုင်တစ်ဆိုင်တည်းအတွက် မဟုတ်ဘဲ ကုန်စရောက်လာသည့် မူလမှတ်တမ်းများ</p></div><div className="heading-actions"><input className="inline-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Receipt / ပစ္စည်း ရှာရန်" /></div></div>
      {filteredReceipts.length === 0 ? <div className="empty-state"><div className="empty-icon"><ClipboardList size={23} /></div><strong>ကုန်ရောက်မှတ်တမ်း မရှိသေးပါ</strong><p>အပေါ်ကနေ ပစ္စည်းအမည်နဲ့ အရေအတွက် ထည့်နိုင်ပါတယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>နေ့စွဲ</th><th>Receipt No.</th><th>ပစ္စည်းများ</th><th>စုစုပေါင်း Qty</th><th>မှတ်ချက်</th><th>အသေးစိတ်</th></tr></thead><tbody>{filteredReceipts.map((receipt) => <tr key={receipt.id}><td>{dateLabel(receipt.date)}</td><td><b className="mono">{receipt.receiptNo}</b></td><td>{receipt.items.length} မျိုး</td><td><b>{summarizeQuantities(receipt.items.map((item) => ({ quantity: item.quantity, unit: item.unit || 'ခု' })))}</b></td><td>{receipt.note || '—'}</td><td><details className="receipt-details"><summary>ကြည့်ရန်</summary><div>{receipt.items.map((item) => <p key={item.id}>{item.productName} × {formatQuantity(item.quantity, inferQuantityMode(item.unit || 'ခု'))} {item.unit || 'ခု'} · {item.barcode ? `Barcode: ${item.barcode}` : item.sku ? `SKU: ${item.sku}` : 'Barcode မထည့်ရသေး'}</p>)}</div></details></td></tr>)}</tbody></table></div>}
    </div>
    <BarcodeCameraScanner open={cameraLineKey !== null} onClose={() => setCameraLineKey(null)} onDetected={handleCameraDetected} title="ကုန်ရောက် Barcode ဖတ်ရန်" />
  </section>;
}
