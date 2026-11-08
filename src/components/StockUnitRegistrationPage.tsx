import { useMemo, useState } from 'react';
import { Barcode, Camera, Check, PackagePlus, ScanLine, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { usePosStore } from '../store/usePosStore';
import { normalizeBarcode } from '../lib/barcode';
import { BarcodeCameraScanner } from './BarcodeCameraScanner';
import { useBusinessAccess } from '../lib/businessAccess';

export function StockUnitRegistrationPage({ notify }: { notify: (message: string) => void }) {
  const access = useBusinessAccess();
  const productsAll = usePosStore((state) => state.products);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const registries = usePosStore((state) => state.stockUnitRegistries);
  const registerStockUnits = usePosStore((state) => state.registerStockUnits);
  const [productId, setProductId] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [pendingBarcodes, setPendingBarcodes] = useState<string[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const branchProducts = useMemo(() => productsAll
    .filter((product) => (product.branchId || 'branch-main') === activeBranchId)
    .filter((product) => product.quantityMode !== 'decimal')
    .sort((a, b) => a.name.localeCompare(b.name)), [productsAll, activeBranchId]);
  const selectedProduct = branchProducts.find((product) => product.id === productId) || null;
  const productRegistries = selectedProduct
    ? registries.filter((entry) => entry.branchId === activeBranchId && entry.productId === selectedProduct.id)
    : [];
  const registeredUnits = productRegistries.flatMap((entry) => entry.units);
  const inStockUnits = registeredUnits.filter((unit) => unit.status === 'in_stock' || unit.status === 'reserved').length;
  const filteredProducts = branchProducts.filter((product) => !search || `${product.name} ${product.sku} ${product.barcode || ''}`.toLowerCase().includes(search.toLowerCase()));
  const allUsedCodes = useMemo(() => {
    const codes = registries.flatMap((entry) => entry.units.map((unit) => normalizeBarcode(unit.barcode)));
    productsAll.forEach((product) => {
      if (product.barcode) codes.push(normalizeBarcode(product.barcode));
      if (product.sku) codes.push(normalizeBarcode(product.sku));
    });
    return new Set(codes.filter(Boolean));
  }, [registries, productsAll]);

  const addPending = (raw: string) => {
    const values = raw.split(/[\s,;]+/).map(normalizeBarcode).filter(Boolean);
    if (!values.length) return;
    const next = [...pendingBarcodes];
    const errors: string[] = [];
    for (const value of values) {
      if (!/^[\x20-\x7E]{1,128}$/.test(value)) { errors.push(`${value}: Barcode ပုံစံမမှန်ပါ`); continue; }
      if (allUsedCodes.has(value) || next.includes(value)) { errors.push(`${value}: Barcode ထပ်နေပါတယ်`); continue; }
      next.push(value);
    }
    setPendingBarcodes(next);
    setBarcodeInput('');
    if (errors.length) notify(errors.slice(0, 2).join(' · ') + (errors.length > 2 ? ` · နောက်ထပ် ${errors.length - 2} ခု` : ''));
    else notify(`${values.length} ခု Scan စာရင်းထဲ ထည့်ပြီးပါပြီ။`);
  };

  const save = () => {
    if (!selectedProduct) { notify('Product ရွေးချယ်ပါ။'); return; }
    if (!pendingBarcodes.length) { notify('Barcode Sticker ကို အရင် Scan ဖတ်ပါ။'); return; }
    const result = registerStockUnits({
      branchId: activeBranchId,
      productId: selectedProduct.id,
      actorUid: access.uid || undefined,
      actorName: access.displayName || access.email || 'Owner',
      units: pendingBarcodes.map((barcode) => ({ barcode, barcodeSource: 'purchased_sticker' as const })),
    });
    if (!result.ok) { notify(result.message); return; }
    notify(`${result.created} ခု စာရင်းသွင်းပြီး Stock တိုးပြီးပါပြီ။`);
    setPendingBarcodes([]);
  };

  if (access.role === 'cashier') return <section className="panel"><div className="empty-state"><ShieldCheck size={28}/><strong>Owner သာ အသုံးပြုနိုင်ပါတယ်</strong><p>ပုံမှန်ကုန်ဝင် Barcode Registration ကို Owner Account ဖြင့်သာ အသုံးပြုနိုင်ပါတယ်။</p></div></section>;

  return <section className="page-stack stock-unit-page">
    <div className="section-heading">
      <div><h2>Barcode Sticker Scan ဖြင့် Stock ထည့်ရန်</h2><p>ဆိုင်က ဝယ်ထားတဲ့ Sticker ကို ပစ္စည်းတစ်ခုချင်းကပ်ပြီး Scan ဖတ်ပါ။ Scan တစ်ကြိမ် = Stock တစ်ခု တိုးပါမယ်။</p></div>
      <span className="tag tag-success">Owner Only</span>
    </div>
    <div className="analytics-note stock-unit-note"><ShieldCheck size={18}/><div><strong>ဆိုင်သုံး Barcode Sticker ကိုပဲ အသုံးပြုပါ</strong><p>App က Barcode အသစ်ထုတ်ပေးခြင်း၊ Label Print ထုတ်ခြင်း မလုပ်ပါ။ Product ကို အရင်ဖန်တီးပြီး ဈေးနှုန်းသတ်မှတ်ပါ။ ဒီနေရာမှာ Scan ဖတ်ထားတဲ့ Sticker တစ်ခုစီအတွက် Stock တစ်ခုတိုးပါမယ်။ Product အသစ်ဖန်တီးချိန် Stock ကို 0 ထားပြီး ဒီနေရာမှာ စာရင်းသွင်းပါ။</p></div></div>
    <div className="panel stock-unit-panel">
      <div className="panel-heading"><div><h3>၁။ Product ရွေးချယ်ပါ</h3><p>လက်ရှိ Branch: {activeBranchId}</p></div><span className="subtle-count">{branchProducts.length} products</span></div>
      <div className="stock-unit-product-select">
        <div className="search-box"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Product / SKU ရှာရန်"/></div>
        <select value={productId} onChange={(event) => { setProductId(event.target.value); setPendingBarcodes([]); }} aria-label="Product ရွေးချယ်ရန်">
          <option value="">Product ရွေးပါ</option>
          {filteredProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · Stock {product.stock} {product.unit}</option>)}
        </select>
      </div>
      {selectedProduct ? <>
        <div className="stock-unit-selected-product"><div><strong>{selectedProduct.name}</strong><small>ဝယ်ဈေး: {selectedProduct.costPrice.toLocaleString()} · ရောင်းဈေး: {selectedProduct.retailPrice.toLocaleString()}</small></div><span className="tag">{selectedProduct.unit}</span></div>
        <div className="mini-stats stock-unit-stats">
          <div className="mini-stat"><div className="mini-stat-icon"><PackagePlus size={17}/></div><div><small>လက်ရှိ Product Stock</small><strong>{selectedProduct.stock}</strong></div></div>
          <div className="mini-stat"><div className="mini-stat-icon"><Barcode size={17}/></div><div><small>မှတ်ပုံတင်ပြီး In Stock Unit</small><strong>{inStockUnits}</strong></div></div>
          <div className="mini-stat"><div className="mini-stat-icon"><ScanLine size={17}/></div><div><small>အသစ် Scan ထား</small><strong>{pendingBarcodes.length}</strong></div></div>
        </div>
        <div className="stock-unit-method-card">
          <h3>၂။ Barcode Sticker တစ်ခုချင်း Scan ဖတ်ပါ</h3>
          <p>ပစ္စည်းတစ်ခုမှာ Sticker တစ်ခုကပ်ပြီး Bluetooth Scanner ဖြင့် Scan ဖတ်ပါ။ Scanner က Enter ပို့တဲ့အခါ စာရင်းထဲ အလိုအလျောက်ဝင်ပါမယ်။ ဖုန်း Camera သို့မဟုတ် Barcode ကို ကိုယ်တိုင်ရိုက်ထည့်တာလည်း ရပါတယ်။</p>
          <div className="stock-unit-scan-row">
            <input autoFocus value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPending(barcodeInput); } }} placeholder="Sticker Barcode Scan / ရိုက်ထည့်ပါ" autoComplete="off" />
            <button className="button button-outline" type="button" onClick={() => setScannerOpen(true)}><Camera size={16}/> Camera Scan</button>
            <button className="button button-primary" type="button" onClick={() => addPending(barcodeInput)}>ထည့်မယ်</button>
          </div>
          <div className="stock-unit-pending-heading"><strong>စာရင်းသွင်းမည့် ပစ္စည်းများ</strong><span>{pendingBarcodes.length} ခု</span></div>
          {pendingBarcodes.length ? <div className="stock-unit-pending-list">{pendingBarcodes.map((barcode) => <div key={barcode}><code>{barcode}</code><button className="icon-btn danger-icon" type="button" aria-label="ဖယ်ရှားရန်" onClick={() => setPendingBarcodes((items) => items.filter((item) => item !== barcode))}><Trash2 size={15}/></button></div>)}</div> : <div className="stock-unit-empty-hint">Sticker Barcode မ Scan ရသေးပါ။</div>}
          <div className="stock-unit-actions"><span>Scan စာရင်းဝင်ပြီးမှ Stock တိုးပါမယ်။</span><button className="button button-primary" type="button" disabled={!pendingBarcodes.length} onClick={save}><Check size={16}/> Stock သိမ်းမယ် ({pendingBarcodes.length})</button></div>
        </div>
        <div className="panel stock-unit-registered-panel">
          <div className="panel-heading"><div><h3>၃။ Unit Barcode History</h3><p>ရောင်းပြီးသား Barcode များလည်း History အဖြစ် ကျန်ပါမယ်။</p></div><span className="subtle-count">{registeredUnits.length} units</span></div>
          {registeredUnits.length ? <div className="table-wrap"><table><thead><tr><th>Barcode</th><th>Status</th><th>မှတ်ပုံတင်ရက်</th></tr></thead><tbody>{registeredUnits.slice().sort((a,b) => b.registeredAt.localeCompare(a.registeredAt)).slice(0, 100).map((unit) => <tr key={unit.id}><td><code className="mono">{unit.barcode}</code></td><td><span className={`tag ${unit.status === 'in_stock' ? 'tag-success' : unit.status === 'sold' ? 'tag-warn' : ''}`}>{unit.status}</span></td><td>{new Date(unit.registeredAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="stock-unit-empty-hint">ဒီ Product အတွက် Barcode History မရှိသေးပါ။</div>}
        </div>
      </> : <div className="empty-state"><Barcode size={28}/><strong>Product ရွေးချယ်ပါ</strong><p>Product နဲ့ ဈေးနှုန်းသတ်မှတ်ပြီးမှ Sticker Barcode တွေ ထည့်နိုင်ပါတယ်။</p></div>}
    </div>
    <BarcodeCameraScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={(value) => { setScannerOpen(false); addPending(value); }} title="ဝယ်ထားတဲ့ Barcode Sticker Scan လုပ်ရန်"/>
  </section>;
}
