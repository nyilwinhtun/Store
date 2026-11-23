import { useMemo, useRef, useState } from 'react';
import { Barcode, Camera, Check, PackagePlus, ScanLine, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { usePosStore } from '../store/usePosStore';
import { normalizeBarcode } from '../lib/barcode';
import { BarcodeCameraScanner } from './BarcodeCameraScanner';
import { useBusinessAccess } from '../lib/businessAccess';
import { MAX_UNITS_PER_RECEIPT, isValidUnitBarcode, productIsUnitTracked } from '../lib/unitTracking';

const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

const unitStatusLabel = (status: string) => {
  if (status === 'in_stock') return { text: 'Available', className: 'tag-success' };
  if (status === 'reserved') return { text: 'Reserved', className: 'tag-warn' };
  if (status === 'sold') return { text: 'Sold', className: 'tag-warn' };
  return { text: status, className: '' };
};

export function StockUnitRegistrationPage({ notify }: { notify: (message: string) => void }) {
  const access = useBusinessAccess();
  const productsAll = usePosStore((state) => state.products);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const branches = usePosStore((state) => state.branches);
  const registries = usePosStore((state) => state.stockUnitRegistries);
  const stockBatches = usePosStore((state) => state.stockBatches);
  const receiveTrackedStockUnits = usePosStore((state) => state.receiveTrackedStockUnits);
  const registerStockUnits = usePosStore((state) => state.registerStockUnits);
  const [viewMode, setViewMode] = useState<'receiving' | 'attach'>('receiving');
  const [productId, setProductId] = useState('');
  const [quantityInput, setQuantityInput] = useState('1');
  const [batchId, setBatchId] = useState('');
  const [unitCostInput, setUnitCostInput] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [receivedDate, setReceivedDate] = useState(today());
  const [note, setNote] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [pendingBarcodes, setPendingBarcodes] = useState<string[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const requestIdRef = useRef('');

  const branchProducts = useMemo(() => productsAll
    .filter((product) => (product.branchId || 'branch-main') === activeBranchId)
    .filter((product) => productIsUnitTracked(product, registries, activeBranchId))
    .sort((a, b) => a.name.localeCompare(b.name)), [productsAll, activeBranchId, registries]);
  const selectedProduct = branchProducts.find((product) => product.id === productId) || null;
  const productRegistries = selectedProduct
    ? registries.filter((entry) => entry.branchId === activeBranchId && entry.productId === selectedProduct.id)
    : [];
  const registeredUnits = productRegistries.flatMap((entry) => entry.units);
  const inStockUnits = registeredUnits.filter((unit) => unit.status === 'in_stock' || unit.status === 'reserved').length;
  const soldUnits = registeredUnits.filter((unit) => unit.status === 'sold').length;
  const filteredProducts = branchProducts.filter((product) => !search || `${product.name} ${product.sku} ${product.barcode || ''}`.toLowerCase().includes(search.toLowerCase()));
  const availableBatches = useMemo(() => selectedProduct
    ? stockBatches.filter((batch) => (batch.branchId || 'branch-main') === activeBranchId && batch.productId === selectedProduct.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    : [], [stockBatches, selectedProduct, activeBranchId]);
  const quantity = Math.max(1, Math.floor(Number(quantityInput) || 0));
  const allUsedCodes = useMemo(() => {
    const codes = registries.flatMap((entry) => entry.units.map((unit) => normalizeBarcode(unit.barcode)));
    productsAll.forEach((product) => {
      if (product.barcode) codes.push(normalizeBarcode(product.barcode));
      if (product.sku) codes.push(normalizeBarcode(product.sku));
    });
    return new Set(codes.filter(Boolean));
  }, [registries, productsAll]);

  const branchName = branches.find((branch) => branch.id === activeBranchId)?.name || activeBranchId;

  const resetReceiving = () => {
    setPendingBarcodes([]);
    setBarcodeInput('');
    setNote('');
    setBatchId('');
    setUnitCostInput('');
    setExpiryDate('');
    setReceivedDate(today());
    requestIdRef.current = '';
  };

  const changeProduct = (nextProductId: string) => {
    setProductId(nextProductId);
    const product = branchProducts.find((entry) => entry.id === nextProductId);
    setUnitCostInput(product ? String(product.costPrice) : '');
    resetReceiving();
  };

  const addPending = (raw: string) => {
    const values = raw.split(/[\s,;]+/).map(normalizeBarcode).filter(Boolean);
    if (!values.length) return;
    const next = [...pendingBarcodes];
    const errors: string[] = [];
    for (const value of values) {
      if (next.length >= quantity) { errors.push(`${value}: လက်ခံအရေအတွက် ${quantity} ပြည့်နေပါပြီ`); continue; }
      if (!isValidUnitBarcode(value)) { errors.push(`${value}: Barcode ပုံစံမမှန်ပါ`); continue; }
      if (allUsedCodes.has(value) || next.includes(value)) { errors.push(`${value}: Barcode ထပ်နေပါတယ်`); continue; }
      next.push(value);
    }
    setPendingBarcodes(next);
    setBarcodeInput('');
    if (errors.length) notify(errors.slice(0, 2).join(' · ') + (errors.length > 2 ? ` · နောက်ထပ် ${errors.length - 2} ခု` : ''));
    else if (next.length === quantity) notify(`${quantity}/${quantity} Sticker Scan ပြည့်ပါပြီ။ စစ်ဆေးပြီး ကုန်လက်ခံပါ။`);
    else notify(`${next.length}/${quantity} Sticker Scan ဝင်ပြီးပါပြီ။`);
  };

  const removePending = (barcode: string) => setPendingBarcodes((items) => items.filter((item) => item !== barcode));

  const submitReceiving = () => {
    if (!selectedProduct) { notify('Product ရွေးချယ်ပါ။'); return; }
    if (submitting) return;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_UNITS_PER_RECEIPT) { notify(`လက်ခံအရေအတွက်သည် ၁ မှ ${MAX_UNITS_PER_RECEIPT} အတွင်း ဖြစ်ရပါမယ်။`); return; }
    if (pendingBarcodes.length !== quantity) { notify(`Sticker Scan မပြည့်စုံသေးပါ: ${pendingBarcodes.length}/${quantity}။ အရေအတွက်အတိုင်း Scan ပြီးမှ လက်ခံပါ။`); return; }
    if (!requestIdRef.current) requestIdRef.current = `unit-receive-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setSubmitting(true);
    try {
      const result = receiveTrackedStockUnits({
        requestId: requestIdRef.current,
        branchId: activeBranchId,
        productId: selectedProduct.id,
        quantity,
        barcodes: pendingBarcodes,
        batchId: batchId || undefined,
        unitCost: unitCostInput.trim() === '' ? undefined : Number(unitCostInput),
        expiryDate: expiryDate || undefined,
        receivedDate,
        note: note.trim() || undefined,
        actorUid: access.uid || undefined,
        actorName: access.displayName || access.email || 'Owner',
      });
      if (!result.ok) { notify(result.message); return; }
      notify(result.duplicate
        ? `ဒီကုန်လက်ခံမှုကို သိမ်းပြီးသားဖြစ်ပါတယ် (${result.created} unit အသစ် မထပ်တိုးပါ)။`
        : `${result.created} Unit Barcode ကို ${selectedProduct.name} အတွက် လက်ခံပြီး Stock တစ်ကြိမ်သာ တိုးပြီးပါပြီ။`);
      resetReceiving();
    } finally {
      setSubmitting(false);
    }
  };

  const saveAttachOnly = () => {
    if (!selectedProduct) { notify('Product ရွေးချယ်ပါ။'); return; }
    if (!pendingBarcodes.length) { notify('Barcode Sticker ကို အရင် Scan ဖတ်ပါ။'); return; }
    const result = registerStockUnits({
      branchId: activeBranchId,
      productId: selectedProduct.id,
      actorUid: access.uid || undefined,
      actorName: access.displayName || access.email || 'Owner',
      units: pendingBarcodes.map((barcode) => ({ barcode, barcodeSource: 'purchased_sticker' as const, ...(batchId ? { batchId } : {}) })),
    });
    if (!result.ok) { notify(result.message); return; }
    notify(`${result.created} ခုသော Sticker Barcode များကို လက်ရှိ Stock Unit များနှင့် မှတ်ပုံတင်ပြီးပါပြီ။ Product Stock အရေအတွက် မပြောင်းလဲပါ။`);
    setPendingBarcodes([]);
    setBarcodeInput('');
  };

  if (access.role === 'cashier') return <section className="panel"><div className="empty-state"><ShieldCheck size={28}/><strong>Owner သာ အသုံးပြုနိုင်ပါတယ်</strong><p>Unit Barcode ကုန်လက်ခံခြင်းနှင့် Sticker မှတ်ပုံတင်ခြင်းကို Owner Account ဖြင့်သာ အသုံးပြုနိုင်ပါတယ်။</p></div></section>;

  return <section className="page-stack stock-unit-page">
    <div className="section-heading">
      <div><h2>Unit Barcode ကုန်လက်ခံရန်</h2><p>ကုန်လက်ခံသည့်အခါ ပစ္စည်းတစ်ခုချင်းစီ၏ Sticker Barcode ကို Scan ဖတ်ပြီး Stock Unit အဖြစ် တစ်ကြိမ်တည်း မှတ်တမ်းတင်ပါ။ App က Barcode ထုတ်ပေးခြင်း၊ Print ထုတ်ခြင်း မလုပ်ပါ။</p></div>
      <span className="tag tag-success">Owner Only</span>
    </div>

    <div className="panel security-note"><ShieldCheck size={18}/><div><strong>Barcode ထပ်မနေရ — ဆိုင်ခွဲအားလုံး အတွင်း စစ်ဆေးမည်</strong><p>Scan လုပ်သော Sticker Barcode တစ်ခုသည် လက်ရှိ Branch: {branchName} အတွက် ၁ ကြိမ်သာ မှတ်ပုံတင်နိုင်ပါတယ်။ ရောင်းပြီး၊ Reserved သို့မဟုတ် အခြား Branch မှာ မှတ်ပြီးသား Barcode များကို လက်မခံပါ။</p></div></div>

    <div className="panel stock-unit-panel">
      <div className="panel-heading"><div><h3>၁။ လုပ်ဆောင်ချက် ရွေးချယ်ပါ</h3><p>လက်ရှိ Branch: {branchName}</p></div>
        <div className="heading-actions">
          <button className={`button ${viewMode === 'receiving' ? 'button-primary' : 'button-outline'}`} type="button" onClick={() => setViewMode('receiving')}><PackagePlus size={16}/> ကုန်လက်ခံ + Scan</button>
          <button className={`button ${viewMode === 'attach' ? 'button-primary' : 'button-outline'}`} type="button" onClick={() => setViewMode('attach')}><Barcode size={16}/> ရှိပြီးသား Stock Sticker မှတ်ပုံတင်</button>
        </div>
      </div>
      <div className="stock-unit-product-select">
        <div className="search-box"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Product / SKU ရှာရန်"/></div>
        <select value={productId} onChange={(event) => changeProduct(event.target.value)} aria-label="Product ရွေးချယ်ရန်">
          <option value="">Product ရွေးပါ</option>
          {filteredProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · Stock {product.stock} {product.unit}</option>)}
        </select>
      </div>

      {!branchProducts.length ? <div className="empty-state"><Barcode size={28}/><strong>Unit Tracking Product မရှိသေးပါ</strong><p>Product ဖန်တီး/ပြင်ဆင်ရာတွင် “Individual Unit Tracking” ကို ဖွင့်ပြီးမှ ဒီနေရာမှာ Sticker Barcode လက်ခံနိုင်ပါတယ်။</p></div>
      : selectedProduct ? <>
        <div className="stock-unit-selected-product"><div><strong>{selectedProduct.name}</strong><small>ဝယ်ဈေး: {selectedProduct.costPrice.toLocaleString()} · ရောင်းဈေး: {selectedProduct.retailPrice.toLocaleString()}</small></div><span className="tag">{selectedProduct.unit}</span></div>
        <div className="mini-stats stock-unit-stats">
          <div className="mini-stat"><div className="mini-stat-icon"><PackagePlus size={17}/></div><div><small>လက်ရှိ Product Stock</small><strong>{selectedProduct.stock}</strong></div></div>
          <div className="mini-stat"><div className="mini-stat-icon"><Barcode size={17}/></div><div><small>Available + Reserved Unit</small><strong>{inStockUnits}</strong></div></div>
          <div className="mini-stat"><div className="mini-stat-icon"><ScanLine size={17}/></div><div><small>ရောင်းပြီး Unit (History)</small><strong>{soldUnits}</strong></div></div>
        </div>

        {viewMode === 'receiving' ? <>
          <div className="stock-unit-method-card">
            <h3>၂။ ကုန်လက်ခံအရေအတွက် နှင့် Receiving Batch</h3>
            <p>လက်ခံမည့် အရေအတွက်ထည့်ပြီး Receiving Batch ကို ရွေးပါ သို့မဟုတ် အသစ်ဖန်တီးပါ။ ပြီးမှ Sticker တစ်ခုစီကို Scan ဖတ်ပါ။</p>
            <div className="form-grid">
              <label>လက်ခံအရေအတွက် *<input type="number" min={1} max={MAX_UNITS_PER_RECEIPT} step={1} value={quantityInput} onChange={(event) => { setQuantityInput(event.target.value); requestIdRef.current = ''; }} /></label>
              <label>လက်ခံရက်<input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} /></label>
              <label>Receiving Batch<select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
                <option value="">Batch အသစ် ဖန်တီးမည်</option>
                {availableBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.receivedAt.slice(0, 10)} · Qty {batch.quantity} · {batch.expiryDate || 'သက်တမ်းမရှိ'}</option>)}
              </select></label>
              <label>ယူနစ်တစ်ခု ဝယ်ဈေး<input type="number" min={0} step="0.01" value={unitCostInput} onChange={(event) => setUnitCostInput(event.target.value)} placeholder={String(selectedProduct.costPrice)} /></label>
              <label>သက်တမ်းကုန်ရက် (မဖြစ်မနေ မဟုတ်)<input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
              <label>မှတ်ချက်<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="ဥပမာ - မနက်ပိုင်း ကုန်ရောက်" /></label>
            </div>
          </div>

          <div className="stock-unit-method-card">
            <h3>၃။ Sticker Barcode တစ်ခုချင်း Scan ဖတ်ပါ</h3>
            <p>Sticker တစ်ခုစီကို Scan ဖတ်ပါ။ Scanner က Enter ပို့သည့်အခါ အလိုအလျောက် ဝင်ပါမယ်။ ဖုန်း Camera သို့မဟုတ် ကိုယ်တိုင်ရိုက်ထည့်တာလည်း ရပါတယ်။</p>
            <div className="stock-unit-scan-row">
              <input autoFocus value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPending(barcodeInput); } }} placeholder="Sticker Barcode Scan / ရိုက်ထည့်ပါ" autoComplete="off" />
              <button className="button button-outline" type="button" onClick={() => setScannerOpen(true)}><Camera size={16}/> Camera Scan</button>
              <button className="button button-primary" type="button" onClick={() => addPending(barcodeInput)}>ထည့်မယ်</button>
            </div>
            <div className="stock-unit-pending-heading"><strong>Scan လုပ်ပြီး: {pendingBarcodes.length}/{quantity}</strong><span>{pendingBarcodes.length === quantity ? 'ပြည့်ပါပြီ' : `${quantity - pendingBarcodes.length} ခု ကျန်ပါတယ်`}</span></div>
            <div className="stock-unit-scan-progress" aria-hidden="true"><div className="stock-unit-progress-track"><span style={{ width: `${Math.min(100, (pendingBarcodes.length / quantity) * 100)}%` }} /></div></div>
            {pendingBarcodes.length ? <div className="stock-unit-pending-list">{pendingBarcodes.map((barcode) => <div key={barcode}><code>{barcode}</code><button className="icon-btn danger-icon" type="button" aria-label="ဖယ်ရှားရန်" onClick={() => removePending(barcode)}><Trash2 size={15}/></button></div>)}</div> : <div className="stock-unit-empty-hint">Sticker Barcode မ Scan ရသေးပါ။</div>}
            <div className="stock-unit-actions"><span>Sticker အားလုံး Scan ပြီးမှသာ လက်ခံနိုင်ပါမည်။ Stock သည် တစ်ကြိမ်သာ တိုးပါမည်။</span><button className="button button-primary" type="button" disabled={submitting || pendingBarcodes.length !== quantity} onClick={submitReceiving}><Check size={16}/> {submitting ? 'သိမ်းနေသည်…' : `ကုန်လက်ခံမယ် (${pendingBarcodes.length}/${quantity})`}</button></div>
          </div>
        </> : <>
          <div className="stock-unit-method-card">
            <h3>ရှိပြီးသား Stock အတွက် Sticker မှတ်ပုံတင်ခြင်း</h3>
            <p>Quantity ဖြင့် လက်ခံပြီးသား (Unit Tracking မဖွင့်ခင် ဝင်ထားသော) Stock အတွက် Sticker များကို နောက်ကြုံ ချိတ်ဆက်ရာတွင် သုံးပါ။ ဒီလုပ်ဆောင်ချက်က Product Stock အရေအတွက်ကို ထပ်မတိုးပါ။</p>
            <div className="form-grid">
              <label>Receiving Batch (မဖြစ်မနေ မဟုတ်)<select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
                <option value="">Batch မချိတ်ဆက်ပါ</option>
                {availableBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.receivedAt.slice(0, 10)} · Qty {batch.quantity}</option>)}
              </select></label>
            </div>
            <div className="stock-unit-scan-row">
              <input autoFocus value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPending(barcodeInput); } }} placeholder="Sticker Barcode Scan / ရိုက်ထည့်ပါ" autoComplete="off" />
              <button className="button button-outline" type="button" onClick={() => setScannerOpen(true)}><Camera size={16}/> Camera Scan</button>
              <button className="button button-primary" type="button" onClick={() => addPending(barcodeInput)}>ထည့်မယ်</button>
            </div>
            <div className="stock-unit-pending-heading"><strong>စာရင်းသွင်းမည့် ပစ္စည်းများ</strong><span>{pendingBarcodes.length} ခု</span></div>
            {pendingBarcodes.length ? <div className="stock-unit-pending-list">{pendingBarcodes.map((barcode) => <div key={barcode}><code>{barcode}</code><button className="icon-btn danger-icon" type="button" aria-label="ဖယ်ရှားရန်" onClick={() => removePending(barcode)}><Trash2 size={15}/></button></div>)}</div> : <div className="stock-unit-empty-hint">Sticker Barcode မ Scan ရသေးပါ။</div>}
            <div className="stock-unit-actions"><span>Barcode Registry ထဲတွင်သာ မှတ်ပုံတင်မည်၊ Stock Qty မပြောင်းလဲပါ။</span><button className="button button-primary" type="button" disabled={!pendingBarcodes.length} onClick={saveAttachOnly}><Check size={16}/> Barcode မှတ်ပုံတင်မယ် ({pendingBarcodes.length})</button></div>
          </div>
        </>}

        <div className="panel stock-unit-registered-panel">
          <div className="panel-heading"><div><h3>Unit Barcode History</h3><p>Available / Reserved / Sold အားလုံး အမြဲ မှတ်တမ်းကျန်ပါမည်။ ရောင်းပြီးသား Barcode ကို ဖျက်ခြင်း မရှိပါ။</p></div><span className="subtle-count">{registeredUnits.length} units</span></div>
          {registeredUnits.length ? <div className="table-wrap"><table><thead><tr><th>Barcode</th><th>Status</th><th>Batch</th><th>မှတ်ပုံတင်ရက်</th></tr></thead><tbody>{registeredUnits.slice().sort((a,b) => b.registeredAt.localeCompare(a.registeredAt)).slice(0, 200).map((unit) => {
            const status = unitStatusLabel(unit.status);
            return <tr key={unit.id}><td><code className="mono">{unit.barcode}</code></td><td><span className={`tag ${status.className}`}>{status.text}</span></td><td>{unit.batchId ? <code className="mono">{unit.batchId.slice(0, 8)}</code> : '—'}</td><td>{new Date(unit.registeredAt).toLocaleString()}</td></tr>;
          })}</tbody></table></div> : <div className="stock-unit-empty-hint">ဒီ Product အတွက် Barcode History မရှိသေးပါ။</div>}
        </div>
      </> : <div className="empty-state"><Barcode size={28}/><strong>Product ရွေးချယ်ပါ</strong><p>Individual Unit Tracking ဖွင့်ထားသော Product ကို ရွေးချယ်ပြီးမှ Sticker Barcode လက်ခံနိုင်ပါတယ်။</p></div>}
    </div>
    <BarcodeCameraScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={(value) => { setScannerOpen(false); addPending(value); }} title="Sticker Barcode Scan လုပ်ရန်"/>
  </section>;
}
