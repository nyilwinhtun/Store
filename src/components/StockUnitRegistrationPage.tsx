import { useMemo, useState, type ReactNode } from 'react';
import { Barcode, Camera, Check, PackageCheck, Plus, Printer, ScanLine, Search, ShieldCheck, Trash2, WandSparkles } from 'lucide-react';
import { usePosStore, type StockUnitBarcodeSource } from '../store/usePosStore';
import { useBusinessAccess } from '../lib/businessAccess';
import { normalizeBarcode } from '../lib/barcode';
import { generateUnitBarcode, renderCode128Svg } from '../lib/code128';
import { quantityModeForProduct } from '../lib/quantity';
import { BarcodeCameraScanner } from './BarcodeCameraScanner';

type RegistrationMode = 'existing' | 'generate';

function unitLabelHtml(productName: string, barcode: string): string {
  const safeName = productName.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
  return `<article class="label"><strong>${safeName}</strong>${renderCode128Svg(barcode, { moduleWidth: 1.05, barHeight: 31, includeText: false })}<small>${barcode}</small></article>`;
}

function printLabels(productName: string, barcodes: string[]) {
  const popup = window.open('', '_blank', 'width=850,height=650');
  if (!popup) throw new Error('Print Window ပိတ်ထားပါတယ်။ Browser Popup ကို Allow လုပ်ပါ။');
  const labels = barcodes.map((barcode) => unitLabelHtml(productName, barcode)).join('');
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Barcode Labels</title><style>
    *{box-sizing:border-box}body{margin:8mm;font-family:Arial,sans-serif;color:#111}.sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}.label{height:27mm;border:1px dashed #bbb;padding:2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;break-inside:avoid}.label strong{font-size:8pt;margin-bottom:1mm;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.label svg{display:block;max-width:100%;height:12mm}.label small{font-size:7pt;letter-spacing:.2px;margin-top:0.5mm}@page{size:A4;margin:8mm}@media print{body{margin:0}}
    </style></head><body><div class="sheet">${labels}</div><script>window.onload=()=>{window.focus();window.print();};</script></body></html>`);
  popup.document.close();
}

function makeGeneratedBarcodes(count: number, alreadyUsed: Set<string>): string[] {
  const values: string[] = [];
  let attempts = 0;
  while (values.length < count && attempts < count * 20 + 100) {
    attempts += 1;
    const code = generateUnitBarcode();
    const normalized = normalizeBarcode(code);
    if (!alreadyUsed.has(normalized) && !values.includes(normalized)) values.push(normalized);
  }
  if (values.length !== count) throw new Error('Unique Barcode အသစ်တွေ ထုတ်မရပါ။ ထပ်စမ်းပါ။');
  return values;
}

export function StockUnitRegistrationPage({ notify }: { notify: (message: string) => void }) {
  const access = useBusinessAccess();
  const productsAll = usePosStore((state) => state.products);
  const branches = usePosStore((state) => state.branches);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const registries = usePosStore((state) => state.stockUnitRegistries);
  const registerStockUnits = usePosStore((state) => state.registerStockUnits);
  const [productId, setProductId] = useState('');
  const [mode, setMode] = useState<RegistrationMode>('existing');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [pendingBarcodes, setPendingBarcodes] = useState<string[]>([]);
  const [generateCount, setGenerateCount] = useState('1');
  const [lastGenerated, setLastGenerated] = useState<string[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const branchProducts = useMemo(() => productsAll
    .filter((product) => (product.branchId || 'branch-main') === activeBranchId)
    .filter((product) => quantityModeForProduct(product) === 'whole')
    .sort((a, b) => a.name.localeCompare(b.name)), [productsAll, activeBranchId]);
  const selectedProduct = branchProducts.find((product) => product.id === productId) || branchProducts[0];
  const productRegistries = selectedProduct ? registries.filter((entry) => entry.branchId === activeBranchId && entry.productId === selectedProduct.id) : [];
  const registeredUnits = productRegistries.flatMap((entry) => entry.units);
  const stockOnHand = selectedProduct ? Math.max(0, Math.floor(selectedProduct.stock)) : 0;
  const registeredInStock = registeredUnits.filter((unit) => unit.status === 'in_stock' || unit.status === 'reserved').length;
  const remaining = Math.max(0, stockOnHand - registeredInStock);
  const filteredProducts = branchProducts.filter((product) => !search || `${product.name} ${product.sku} ${product.barcode || ''}`.toLowerCase().includes(search.toLowerCase()));
  const allUsedCodes = useMemo(() => {
    const codes = registries.flatMap((entry) => entry.units.map((unit) => normalizeBarcode(unit.barcode)));
    productsAll.forEach((product) => { if (product.barcode) codes.push(normalizeBarcode(product.barcode)); if (product.sku) codes.push(normalizeBarcode(product.sku)); });
    return new Set(codes.filter(Boolean));
  }, [registries, productsAll]);

  const addPending = (raw: string) => {
    const values = raw.split(/[\s,;]+/).map(normalizeBarcode).filter(Boolean);
    if (!values.length) return;
    const next = [...pendingBarcodes];
    const errors: string[] = [];
    for (const value of values) {
      if (!/^[\x20-\x7E]{1,128}$/.test(value)) { errors.push(`${value}: ASCII Barcode မဟုတ်ပါ`); continue; }
      if (allUsedCodes.has(value) || next.includes(value)) { errors.push(`${value}: Barcode ရှိပြီးသား/ထပ်နေပါတယ်`); continue; }
      next.push(value);
    }
    setPendingBarcodes(next);
    setBarcodeInput('');
    if (errors.length) notify(errors.slice(0, 2).join(' · ') + (errors.length > 2 ? ` · နောက်ထပ် ${errors.length - 2} ခု` : ''));
    else notify(`${values.length} Barcode ကို စာရင်းထဲ ထည့်ပြီးပါပြီ။`);
  };

  const saveExisting = () => {
    if (!selectedProduct) { notify('Product ရွေးချယ်ပါ။'); return; }
    const result = registerStockUnits({
      branchId: activeBranchId, productId: selectedProduct.id,
      actorUid: access.uid || undefined, actorName: access.displayName || access.email || 'Owner',
      units: pendingBarcodes.map((barcode) => ({ barcode, barcodeSource: 'manufacturer_serial' as StockUnitBarcodeSource })),
    });
    if (!result.ok) { notify(result.message); return; }
    setPendingBarcodes([]);
    setLastGenerated([]);
    notify(`${result.created} ဘူးရဲ့ ရှိပြီးသား Unique Barcode ကို မှတ်ပုံတင်ပြီးပါပြီ။`);
  };

  const generateAndSave = () => {
    if (!selectedProduct) { notify('Product ရွေးချယ်ပါ။'); return; }
    const count = Number(generateCount);
    if (!Number.isInteger(count) || count <= 0 || count > 500) { notify('Generate အရေအတွက်ကို 1 မှ 500 အတွင်း ထည့်ပါ။'); return; }
    if (count > remaining) { notify(`လက်ရှိ Stock မှာ ${remaining} ဘူးသာ မှတ်ပုံတင်နိုင်ပါတယ်။`); return; }
    try {
      const codes = makeGeneratedBarcodes(count, allUsedCodes);
      const result = registerStockUnits({
        branchId: activeBranchId, productId: selectedProduct.id,
        actorUid: access.uid || undefined, actorName: access.displayName || access.email || 'Owner',
        units: codes.map((barcode) => ({ barcode, barcodeSource: 'app_generated' as StockUnitBarcodeSource })),
      });
      if (!result.ok) { notify(result.message); return; }
      setLastGenerated(codes);
      setPendingBarcodes([]);
      notify(`${result.created} Unique Barcode အသစ် မှတ်ပုံတင်ပြီးပါပြီ။ Label ထုတ်နိုင်ပါပြီ။`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Barcode Generate မအောင်မြင်ပါ။');
    }
  };

  const handlePrint = () => {
    if (!selectedProduct || !lastGenerated.length) return;
    try { printLabels(selectedProduct.name, lastGenerated); }
    catch (error) { notify(error instanceof Error ? error.message : 'Label Print မအောင်မြင်ပါ။'); }
  };

  const handlePrintRegistered = () => {
    if (!selectedProduct) return;
    const labels = registeredUnits
      .filter((unit) => unit.barcodeSource === 'app_generated')
      .map((unit) => unit.barcode);
    if (!labels.length) { notify('App မှ Generate လုပ်ထားသော Label မရှိသေးပါ။'); return; }
    try { printLabels(selectedProduct.name, labels); }
    catch (error) { notify(error instanceof Error ? error.message : 'Label Reprint မအောင်မြင်ပါ။'); }
  };

  if (access.role === 'cashier') return <section className="panel"><div className="empty-state"><ShieldCheck size={28}/><strong>Owner သာ အသုံးပြုနိုင်ပါတယ်</strong><p>Stock Unit Registration ကို Owner Account ဖြင့်သာ အသုံးပြုနိုင်ပါတယ်။</p></div></section>;

  return <section className="page-stack stock-unit-page">
    <div className="section-heading"><div><h2>ပစ္စည်းတစ်ဘူးချင်း Barcode မှတ်ပုံတင်ခြင်း</h2><p>ရှိပြီးသား Unique Barcode ကို Scan လုပ်ပါ၊ မရှိပါက App က အသစ် Generate လုပ်ပေးပါမယ်။</p></div><span className="tag tag-success">Owner Only</span></div>
    <div className="analytics-note stock-unit-note"><ShieldCheck size={18}/><div><strong>မူလ Stock ကို မပြောင်းပါ</strong><p>ဒီအဆင့်မှာ Barcode နဲ့ Unit Identity ကိုသာ မှတ်ပုံတင်ပါတယ်။ Product Stock ကို တိုးခြင်း၊ လျှော့ခြင်း၊ Shipment ပို့ခြင်း၊ POS ရောင်းချခြင်း မလုပ်သေးပါ။</p></div></div>
    <div className="mini-stats stock-unit-stats">
      <MiniStat icon={<PackageCheck size={17}/>} label="ဆိုင်ရှိ Stock" value={`${stockOnHand}`} />
      <MiniStat icon={<Barcode size={17}/>} label="မှတ်ပုံတင်ပြီး" value={`${registeredInStock}`} />
      <MiniStat icon={<Plus size={17}/>} label="ထပ်မှတ်ပုံတင်နိုင်" value={`${remaining}`} tone={remaining === 0 ? 'warning' : undefined}/>
    </div>
    <div className="panel stock-unit-panel">
      <div className="panel-heading"><div><h3>၁။ Product ရွေးချယ်ပါ</h3><p>လက်ရှိဆိုင်ခွဲ: {branches.find((branch) => branch.id === activeBranchId)?.name || 'ဆိုင်'}</p></div><span className="subtle-count">{branchProducts.length} products</span></div>
      <div className="stock-unit-product-select"><div className="search-box"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Product / SKU / Product Barcode ရှာရန်"/></div><select value={selectedProduct?.id || ''} onChange={(event) => { setProductId(event.target.value); setPendingBarcodes([]); setLastGenerated([]); }} aria-label="Product ရွေးချယ်ရန်"><option value="">Product ရွေးပါ</option>{filteredProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · Stock {product.stock} {product.unit}</option>)}</select></div>
      {selectedProduct ? <>
        <div className="stock-unit-selected-product"><div><strong>{selectedProduct.name}</strong><small>SKU: {selectedProduct.sku || '—'} · Product Barcode: {selectedProduct.barcode || 'မရှိသေး'}</small></div><span className="tag">{selectedProduct.unit}</span></div>
        <div className="stock-unit-barcode-warning"><Barcode size={16}/><span>ပစ္စည်းဘူးအားလုံးမှာ တူညီတဲ့ Product Barcode / EAN ကို Unit Barcode အဖြစ် ထပ်မသုံးပါနှင့်။ ဘူးတစ်ဘူးချင်းစီမှာ မတူညီတဲ့ Serial ရှိမှ Scan လုပ်ပါ။ အားလုံးတူနေပါက App မှ Unique Barcode Generate လုပ်ပြီး Label ကပ်ပါ။</span></div>
        <div className="stock-unit-progress"><div><span>မှတ်ပုံတင်ထားသော Unit</span><strong>{registeredInStock} / {stockOnHand}</strong></div><div className="stock-unit-progress-track"><span style={{ width: `${stockOnHand > 0 ? Math.min(100, registeredInStock / stockOnHand * 100) : 0}%` }}/></div></div>
        <div className="stock-unit-mode-switch"><button type="button" className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}><ScanLine size={16}/> ရှိပြီးသား Barcode Scan</button><button type="button" className={mode === 'generate' ? 'active' : ''} onClick={() => setMode('generate')}><WandSparkles size={16}/> App မှ Generate</button></div>
        {mode === 'existing' ? <div className="stock-unit-method-card">
          <h3>၂။ ဘူးတစ်ဘူးချင်း Barcode ထည့်ပါ</h3><p>Bluetooth Scanner ကို Input ထဲနှိပ်ပြီး Scan ဖတ်ပါ။ Enter နှိပ်တိုင်း Barcode တစ်ခု စာရင်းထဲဝင်ပါမယ်။ Camera နဲ့လည်း ဖတ်နိုင်ပါတယ်။</p>
          <div className="stock-unit-scan-row"><input value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPending(barcodeInput); } }} placeholder="Barcode Scan / Paste လုပ်ပါ" autoComplete="off"/><button className="button button-outline" type="button" onClick={() => setScannerOpen(true)}><Camera size={16}/> Camera Scan</button><button className="button button-primary" type="button" onClick={() => addPending(barcodeInput)}>ထည့်မယ်</button></div>
          <div className="stock-unit-pending-heading"><strong>မှတ်ပုံတင်မည့် Barcode</strong><span>{pendingBarcodes.length} ခု</span></div>
          {pendingBarcodes.length ? <div className="stock-unit-pending-list">{pendingBarcodes.map((barcode) => <div key={barcode}><code>{barcode}</code><button className="icon-btn danger-icon" type="button" aria-label="ဖယ်ရှားရန်" onClick={() => setPendingBarcodes((items) => items.filter((item) => item !== barcode))}><Trash2 size={15}/></button></div>)}</div> : <div className="stock-unit-empty-hint">Scan ဖတ်ထားသော Barcode မရှိသေးပါ။</div>}
          <div className="stock-unit-actions"><span>{remaining} ဘူးအထိ ထည့်နိုင်ပါတယ်။</span><button className="button button-primary" type="button" disabled={!pendingBarcodes.length || pendingBarcodes.length > remaining} onClick={saveExisting}><Check size={16}/> Barcode မှတ်ပုံတင်မယ် ({pendingBarcodes.length})</button></div>
        </div> : <div className="stock-unit-method-card">
          <h3>၂။ App ကနေ Unique Barcode ထုတ်ပါ</h3><p>Barcode မပါသေးတဲ့ ဘူးများအတွက် Code 128 Label အသစ်ထုတ်ပေးပါမယ်။ တစ်ဘူးချင်း Barcode မတူပါ။</p>
          <div className="stock-unit-generate-row"><label>Generate အရေအတွက်<input type="number" min="1" max={Math.min(500, remaining)} step="1" value={generateCount} onChange={(event) => setGenerateCount(event.target.value)}/></label><div className="stock-unit-generate-summary"><span>မှတ်ပုံတင်နိုင်သေး</span><strong>{remaining} {selectedProduct.unit}</strong></div><button className="button button-primary" type="button" disabled={remaining === 0 || !generateCount || Number(generateCount) > remaining} onClick={generateAndSave}><WandSparkles size={16}/> Generate & Register</button></div>
          {lastGenerated.length > 0 && <div className="stock-unit-generated-result"><div className="panel-heading"><div><h3>အသစ်ထုတ်ထားသော Barcode</h3><p>{lastGenerated.length} ခု မှတ်ပုံတင်ပြီးပါပြီ။ Label ကပ်နိုင်ပါတယ်။</p></div><button className="button button-outline" type="button" onClick={handlePrint}><Printer size={16}/> Label Print</button></div><div className="stock-unit-label-preview">{lastGenerated.slice(0, 12).map((barcode) => <div key={barcode}><CodePreview value={barcode}/><code>{barcode}</code></div>)}</div>{lastGenerated.length > 12 && <small className="subtle-count">နောက်ထပ် {lastGenerated.length - 12} ခုကို Print ထုတ်နိုင်ပါတယ်။</small>}</div>}
        </div>}
      </> : <div className="empty-state"><Barcode size={28}/><strong>Product ရွေးချယ်ပါ</strong><p>Barcode မှတ်ပုံတင်ရန် Whole Quantity Product တစ်ခုကို ရွေးပါ။</p></div>}
    </div>
    {selectedProduct && <div className="panel stock-unit-registered-panel"><div className="panel-heading"><div><h3>၃။ မှတ်ပုံတင်ပြီးသော Unit Barcode များ</h3><p>ဒီဆိုင်ခွဲနဲ့ ရွေးထားတဲ့ Product အတွက်သာ ပြထားပါတယ်။</p></div><div className="stock-unit-heading-actions"><span className="subtle-count">{registeredUnits.length} units</span>{registeredUnits.some((unit) => unit.barcodeSource === 'app_generated') && <button className="button button-outline" type="button" onClick={handlePrintRegistered}><Printer size={15}/> Label Reprint</button>}</div></div>{registeredUnits.length ? <div className="table-wrap"><table><thead><tr><th>Unit Barcode</th><th>Source</th><th>Status</th><th>မှတ်ပုံတင်သည့်ရက်</th></tr></thead><tbody>{registeredUnits.slice().sort((a,b) => a.registeredAt.localeCompare(b.registeredAt)).map((unit) => <tr key={unit.id}><td><code className="mono">{unit.barcode}</code></td><td>{unit.barcodeSource === 'app_generated' ? 'App Generate' : 'ရှိပြီးသား Serial'}</td><td><span className={`tag ${unit.status === 'in_stock' ? 'tag-success' : ''}`}>{unit.status}</span></td><td>{new Date(unit.registeredAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="stock-unit-empty-hint">ဒီ Product အတွက် Unit Barcode မမှတ်ပုံတင်ရသေးပါ။</div>}</div>}
    <BarcodeCameraScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={(value) => { setScannerOpen(false); addPending(value); }} title="ပစ္စည်း Unit Barcode ဖတ်ရန်"/>
  </section>;
}

function MiniStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: 'warning' }) {
  return <div className="mini-stat"><div className={`mini-stat-icon ${tone === 'warning' ? 'warning' : ''}`}>{icon}</div><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function CodePreview({ value }: { value: string }) {
  const markup = renderCode128Svg(value, { moduleWidth: 1.0, barHeight: 30, includeText: false });
  return <span className="unit-barcode-svg" dangerouslySetInnerHTML={{ __html: markup }} />;
}
