import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeftRight, CheckCircle2, ClipboardList, Package, Store } from 'lucide-react';
import { usePosStore } from '../store/usePosStore';
import { formatQuantity, isValidQuantity, normalizeUnit, quantityModeForProduct, quantityMin, summarizeQuantities } from '../lib/quantity';
import { firebaseAuth } from '../lib/firebase';
import { useBusinessAccess } from '../lib/businessAccess';

const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

type TransferResult = { id: string; transferNo: string; fromBranchId: string; toBranchId: string; productName: string; quantity: number; unit: string; sourceStockBefore: number; sourceStockAfter: number; destinationStockBefore: number; destinationStockAfter: number };

export function StockTransferPage({ authorize, notify, onViewDestination }: {
  authorize: (action: string) => boolean;
  notify: (message: string) => void;
  onViewDestination?: (branchId: string) => void;
}) {
  const branches = usePosStore((state) => state.branches);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const products = usePosStore((state) => state.products);
  const stockBatches = usePosStore((state) => state.stockBatches);
  const stockUnitRegistries = usePosStore((state) => state.stockUnitRegistries);
  const stockTransfers = usePosStore((state) => state.stockTransfers);
  const transferStock = usePosStore((state) => state.transferStock);
  const reverseStockTransfer = usePosStore((state) => state.reverseStockTransfer);
  const access = useBusinessAccess();
  const setActiveBranch = usePosStore((state) => state.setActiveBranch);
  const activeBranches = branches.filter((branch) => branch.status === 'active');
  const [sourceBranchId, setSourceBranchId] = useState(activeBranches.some((branch) => branch.id === activeBranchId) ? activeBranchId : activeBranches.find((branch) => branch.isDefault)?.id || activeBranches[0]?.id || '');
  const [destinationBranchId, setDestinationBranchId] = useState('');
  const [sourceProductId, setSourceProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [lastTransfer, setLastTransfer] = useState<TransferResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reversingId, setReversingId] = useState('');
  const submitLock = useRef(false);
  const requestIdRef = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tr-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!activeBranches.some((branch) => branch.id === sourceBranchId)) {
      setSourceBranchId(activeBranches.find((branch) => branch.id === activeBranchId)?.id || activeBranches.find((branch) => branch.isDefault)?.id || activeBranches[0]?.id || '');
    }
  }, [activeBranchId, branches, sourceBranchId]);

  const sourceBranch = activeBranches.find((branch) => branch.id === sourceBranchId);
  const destinationBranches = activeBranches.filter((branch) => branch.id !== sourceBranchId);
  useEffect(() => {
    if (!destinationBranches.some((branch) => branch.id === destinationBranchId)) {
      setDestinationBranchId(destinationBranches[0]?.id || '');
    }
    setSourceProductId('');
    setQuantity('1');
  }, [sourceBranchId, branches]);

  const destinationBranch = destinationBranches.find((branch) => branch.id === destinationBranchId);
  const sourceProducts = useMemo(() => products
    .filter((product) => product.branchId === sourceBranchId && product.stock > 0)
    .sort((a, b) => a.name.localeCompare(b.name)), [products, sourceBranchId]);
  const selectedProduct = sourceProducts.find((product) => product.id === sourceProductId);
  const selectedProductHasUnitBarcodes = !!selectedProduct && stockUnitRegistries.some((registry) => registry.branchId === sourceBranchId && registry.productId === selectedProduct.id && registry.units.some((unit) => unit.status === 'in_stock' || unit.status === 'reserved'));
  const localNow = new Date();
  const currentDay = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
  const selectedBatches = selectedProduct ? stockBatches.filter((batch) => batch.branchId === sourceBranchId && batch.productId === selectedProduct.id && batch.quantity > 0) : [];
  const trackedQuantity = selectedBatches.reduce((sum, batch) => sum + batch.quantity, 0);
  const validBatchQuantity = selectedBatches.filter((batch) => !batch.expiryDate || batch.expiryDate >= currentDay).reduce((sum, batch) => sum + batch.quantity, 0);
  // Legacy products can have stock but no StockBatch records. Treat only the uncovered balance as an opening batch.
  const batchMismatch = !!selectedProduct && trackedQuantity > selectedProduct.stock + 0.000001;
  const untrackedQuantity = selectedProduct ? Math.max(0, selectedProduct.stock - trackedQuantity) : 0;
  const availableQuantity = selectedProduct ? Math.min(selectedProduct.stock, validBatchQuantity + untrackedQuantity) : 0;
  const destinationMatch = selectedProduct && destinationBranch ? products.find((product) => product.branchId === destinationBranch.id && normalizeUnit(product.name) === normalizeUnit(selectedProduct.name) && normalizeUnit(product.unit || 'ခု') === normalizeUnit(selectedProduct.unit || 'ခု')) : undefined;
  const destinationModeMismatch = !!(selectedProduct && destinationMatch && quantityModeForProduct(destinationMatch) !== quantityModeForProduct(selectedProduct));
  const transferHistory = stockTransfers.filter((transfer) => transfer.fromBranchId === activeBranchId || transfer.toBranchId === activeBranchId);
  const quantityMode = selectedProduct ? quantityModeForProduct(selectedProduct) : 'whole';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitLock.current || submitting) return;
    if (!sourceBranch || !destinationBranch || !sourceProductId) { notify('မူလဆိုင်၊ လက်ခံမည့်ဆိုင်နဲ့ ပစ္စည်းကို ရွေးပါ။'); return; }
    const qty = Number(quantity);
    if (batchMismatch && !window.confirm('ဒီပစ္စည်း၏ Stock Batch စုစုပေါင်းသည် Product Stock ထက်ပိုနေပါတယ်။ လွှဲနိုင်မည့်ပမာဏကို Product Stock နှင့် Expiry မှန်ကန်သော Batch ပမာဏအတွင်းသာ ကန့်သတ်ပါမယ်။ Transfer ပြီးနောက် Batch မှတ်တမ်းကို ထပ်စစ်ပါမယ်။ ဆက်လွှဲမလား။')) return;
    if (destinationModeMismatch) { notify('လက်ခံဆိုင်မှာ ရှိပြီးသား Product ရဲ့ အရေအတွက်တွက်ချက်ပုံ မတူပါ။ Destination Product ကို ပြင်ပြီးမှ လွှဲပါ။'); return; }
    if (selectedProductHasUnitBarcodes) { notify('ဒီ Product မှာ Unique Barcode Sticker Tracking ရှိပါတယ်။ Barcode တစ်ခုချင်း Branch Transfer မပြီးသေးတဲ့အတွက် ယာယီမလွှဲနိုင်သေးပါ။'); return; }
    if (!selectedProduct || !isValidQuantity(qty, quantityMode) || qty > availableQuantity) {
      notify(`လွှဲနိုင်သော Stock ${selectedProduct ? formatQuantity(availableQuantity, quantityMode) : '0'} ${selectedProduct?.unit || 'ခု'} ထက် မပိုရပါ။ အရေအတွက်ယူနစ်ဖြစ်ပါက ဒသမမထည့်ပါနဲ့။`);
      return;
    }
    if (!authorize('ဆိုင်အချင်းချင်း ကုန်လွှဲရန်')) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const user = firebaseAuth?.currentUser;
      const actor = {
        uid: user?.uid || access.uid || '',
        email: user?.email || access.email || '',
        name: access.displayName || user?.displayName || user?.email || 'Owner',
      };
      const commit = transferStock({ fromBranchId: sourceBranch.id, toBranchId: destinationBranch.id, items: [{ sourceProductId, quantity: qty }], note, requestId: requestIdRef.current, actor });
      if (!commit) {
        notify('ကုန်လွှဲမှုကို မသိမ်းနိုင်ပါ။ Source Stock နုတ်ခြင်း၊ Destination Stock ပေါင်းခြင်းနဲ့ Batch စာရင်းကို အတည်မပြုနိုင်ခဲ့ပါ။ Stock မပြောင်းထားပါ။ လက်ကျန်နဲ့ Branch ရွေးချယ်မှုကို ပြန်စစ်ပါ။');
        return;
      }
      const line = commit.items[0];
      const updated = usePosStore.getState();
      const transfer = updated.stockTransfers.find((item) => item.id === commit.id);
      const sourceAfter = updated.products.find((product) => product.id === line.sourceProductId && product.branchId === sourceBranch.id);
      const destinationAfter = updated.products.find((product) => product.id === line.destinationProductId && product.branchId === destinationBranch.id);
      const sourceVerified = !!sourceAfter && Math.abs(sourceAfter.stock - (line.sourceStockAfter ?? Number.NaN)) < 0.000001;
      const destinationVerified = !!destinationAfter && Math.abs(destinationAfter.stock - (line.destinationStockAfter ?? Number.NaN)) < 0.000001;
      if (!transfer || !sourceVerified || !destinationVerified) {
        notify('ကုန်လွှဲအတည်ပြုမှု မအောင်မြင်ပါ။ Stock နှစ်ဖက်လုံးကို ပြန်စစ်ရန် လိုအပ်ပါတယ်။ ထပ်မလွှဲပါနှင့်။');
        return;
      }
      const result: TransferResult = {
        id: commit.id, transferNo: commit.transferNo, fromBranchId: sourceBranch.id, toBranchId: destinationBranch.id,
        productName: selectedProduct.name, quantity: qty, unit: selectedProduct.unit || 'ခု',
        sourceStockBefore: line.sourceStockBefore ?? selectedProduct.stock,
        sourceStockAfter: line.sourceStockAfter ?? sourceAfter.stock,
        destinationStockBefore: line.destinationStockBefore ?? 0,
        destinationStockAfter: line.destinationStockAfter ?? destinationAfter.stock,
      };
      setLastTransfer(result);
      notify(`${selectedProduct.name} ${formatQuantity(qty, quantityMode)} ${selectedProduct.unit || 'ခု'} လွှဲပြီးပါပြီ။ ${sourceBranch.name}: ${formatQuantity(result.sourceStockBefore, quantityMode)} → ${formatQuantity(result.sourceStockAfter, quantityMode)}၊ ${destinationBranch.name}: ${formatQuantity(result.destinationStockBefore, quantityMode)} → ${formatQuantity(result.destinationStockAfter, quantityMode)}။`);
      requestIdRef.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setSourceProductId(''); setQuantity('1'); setNote('');
      // Open the receiving branch immediately so the user can verify the new stock on this device.
      if (onViewDestination) onViewDestination(destinationBranch.id); else setActiveBranch(destinationBranch.id);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const reverseTransfer = (transferId: string) => {
    if (reversingId) return;
    const selected = stockTransfers.find((entry) => entry.id === transferId);
    if (!selected || selected.status !== 'completed') return;
    const itemSummary = selected.items.map((item) => `${item.productName} × ${formatQuantity(item.quantity, quantityModeForProduct({ unit: item.unit }))} ${item.unit}`).join('၊ ');
    if (!window.confirm(`${selected.transferNo} ကို ပြန်လည်ပယ်ဖျက်ပါမယ်။\n${itemSummary}\n\nလက်ခံဆိုင်မှာ လွှဲပို့ထားတဲ့ Batch အရေအတွက် အပြည့်ကျန်နေမှသာ ပြန်လှန်နိုင်ပါတယ်။ ဆက်လုပ်မလား။`)) return;
    const reversalNote = window.prompt('ပြန်လည်ပယ်ဖျက်ရသည့် အကြောင်းပြချက် (မဖြစ်မနေ)');
    if (reversalNote === null) return;
    if (!reversalNote.trim()) { notify('ပြန်လည်ပယ်ဖျက်ရသည့် အကြောင်းပြချက် ဖြည့်ပါ။'); return; }
    if (!authorize('ကုန်လွှဲမှု ပြန်လည်ပယ်ဖျက်ရန်')) return;
    setReversingId(transferId);
    try {
      const user = firebaseAuth?.currentUser;
      const result = reverseStockTransfer({
        transferId, note: reversalNote.trim(),
        actor: { uid: user?.uid || access.uid || '', email: user?.email || access.email || '', name: access.displayName || user?.displayName || user?.email || 'Owner' },
      });
      if (!result.ok) {
        const messages: Record<string, string> = {
          'not-found': 'ကုန်လွှဲမှတ်တမ်း မတွေ့ပါ။',
          'already-reversed': 'ဒီကုန်လွှဲမှုကို အရင်က ပြန်လည်ပယ်ဖျက်ပြီးပါပြီ။',
          'invalid-transfer': 'ဒီကုန်လွှဲမှတ်တမ်းဟောင်းမှာ မူလ/လက်ခံ Stock အတည်ပြုမှတ်တမ်း မပြည့်စုံပါ။ မှားယွင်းစွာ Stock ပြန်မပြောင်းမိစေရန် ပယ်ဖျက်ခွင့် မပေးထားပါ။',
          'source-product-missing': 'မူလဆိုင် Product မရှိတော့ပါ။ Stock ကို အလိုအလျောက် မပြင်ထားပါ။',
          'destination-product-missing': 'လက်ခံဆိုင် Product မရှိတော့ပါ။ Stock ကို အလိုအလျောက် မပြင်ထားပါ။',
          'destination-stock-insufficient': 'လက်ခံဆိုင် Stock မလုံလောက်ပါ။ ကုန်အချို့ကို ရောင်းချ/ပြင်ဆင်ထားနိုင်ပါတယ်။',
          'transferred-batch-missing': 'လွှဲပေးခဲ့သော Batch ကို လက်ခံဆိုင်မှာ မတွေ့ပါ။',
          'transferred-batch-insufficient': 'လွှဲပေးခဲ့သော Batch အရေအတွက် အပြည့်မကျန်တော့ပါ။ အခြားကုန်ကို မှားယွင်းနုတ်မိခြင်းမှ ကာကွယ်ရန် ပယ်ဖျက်မှုကို ရပ်ထားပါတယ်။',
          'batch-reconciliation-failed': 'Batch နဲ့ Product Stock မကိုက်ညီပါ။ Stock ကို မပြောင်းထားပါ။',
          'state-changed': 'စစ်ဆေးနေစဉ် Stock ပြောင်းလဲသွားပါတယ်။ Refresh လုပ်ပြီး ပြန်စစ်ပါ။',
        };
        notify(messages[result.reason] || 'ကုန်လွှဲမှုကို ပြန်လည်ပယ်ဖျက်၍ မရပါ။');
        return;
      }
      notify(`${result.transferNo} ကို ပြန်လည်ပယ်ဖျက်ပြီးပါပြီ။ မူလဆိုင် Stock ပြန်တိုးပြီး လက်ခံဆိုင် Stock ပြန်လျော့ထားပါတယ်။`);
    } finally {
      setReversingId('');
    }
  };
  const viewDestination = () => {
    if (!lastTransfer) return;
    if (onViewDestination) onViewDestination(lastTransfer.toBranchId);
    else setActiveBranch(lastTransfer.toBranchId);
  };

  return <section className="page-stack">
    <div className="section-heading"><div><h2>ဆိုင်အချင်းချင်း ကုန်လွှဲခြင်း</h2><p>မူလဆိုင်ကို ရွေးပြီး အခြားဆိုင်သို့ Owner က တိုက်ရိုက်လွှဲပေးပါ။ လက်ခံဆိုင်မှာ Product ရှိပြီးသားဆို Stock ပေါင်းမယ်၊ မရှိသေးရင် အသစ်ဖန်တီးမယ်။</p></div><div className="sales-summary-chip"><ArrowLeftRight size={16} /> Owner Direct Transfer</div></div>
    {activeBranches.length < 2 ? <div className="panel empty-state"><Store size={24} /><strong>ဆိုင်ခွဲ မရှိသေးပါ</strong><p>Branch Management မှာ ဒုတိယဆိုင် ဖန်တီးပြီးမှ ကုန်လွှဲနိုင်ပါတယ်။</p></div> : <>
      <div className="mini-stats">
        <div className="mini-stat"><div className="mini-stat-icon"><Store size={17} /></div><div><small>မူလဆိုင်</small><strong>{sourceBranch?.name || 'မရွေးရသေး'}</strong></div></div>
        <div className="mini-stat"><div className="mini-stat-icon"><Store size={17} /></div><div><small>လက်ခံနိုင်သော ဆိုင်ခွဲ</small><strong>{destinationBranches.length}</strong></div></div>
        <div className="mini-stat"><div className="mini-stat-icon"><ArrowLeftRight size={17} /></div><div><small>လက်ရှိဆိုင် ကုန်လွှဲမှတ်တမ်း</small><strong>{transferHistory.length}</strong></div></div>
      </div>
      <div className="two-column-layout">
        <form className="panel form-panel" onSubmit={submit}>
          <div className="panel-heading"><div className="panel-icon"><ArrowLeftRight size={18} /></div><div><h3>ကုန်လွှဲရန်</h3><p>မူလဆိုင်နဲ့ လက်ခံမည့်ဆိုင်ကို သေချာရွေးပါ။</p></div></div>
          <label>မူလဆိုင် (ကုန်ရှိနေသည့်ဆိုင်) *<select required value={sourceBranchId} onChange={(event) => { setSourceBranchId(event.target.value); setLastTransfer(null); }}><option value="">ဆိုင်ရွေးပါ</option>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>လက်ခံမည့်ဆိုင် *<select required value={destinationBranchId} onChange={(event) => setDestinationBranchId(event.target.value)}><option value="">ဆိုင်ရွေးပါ</option>{destinationBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>လွှဲမည့်ပစ္စည်း *<select required value={sourceProductId} onChange={(event) => setSourceProductId(event.target.value)}><option value="">ပစ္စည်းရွေးပါ</option>{sourceProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {formatQuantity(product.stock, quantityModeForProduct(product))} {product.unit} (စုစုပေါင်း)</option>)}</select></label>
          {selectedProduct && <div className="receiving-selected-product"><span>မူလဆိုင် လက်ကျန် / လွှဲနိုင်</span><b>{formatQuantity(selectedProduct.stock, quantityMode)} {selectedProduct.unit} · {formatQuantity(availableQuantity, quantityMode)} {selectedProduct.unit}</b></div>}
          {batchMismatch && <div className="backup-warning"><Package size={16} /><span>သတိပြုရန် — Stock Batch စုစုပေါင်း ({formatQuantity(trackedQuantity, quantityMode)} {selectedProduct?.unit}) က Product Stock ({formatQuantity(selectedProduct?.stock || 0, quantityMode)} {selectedProduct?.unit}) ထက်များနေပါတယ်။ လွှဲနိုင်သည့်ပမာဏကို Product Stock နှင့် သက်တမ်းမကုန်သေးသော Batch ပမာဏဖြင့် ကန့်သတ်ထားပြီး Batch မညီမျှမှုကို Activity Log ထဲ မှတ်တမ်းတင်ပါမယ်။</span></div>}
          {destinationModeMismatch && <div className="backup-warning"><Package size={16} /><span>{destinationBranch?.name} မှာ ဒီ Product ရှိပြီးသားဖြစ်ပေမဲ့ Quantity Mode မတူပါ။ လက်ခံဆိုင် Product မှာ ယူနစ်တွက်ချက်ပုံကို မူလဆိုင်နဲ့ တူအောင် ပြင်ပါ။</span></div>}
          <label>လွှဲမည့်အရေအတွက် *<input type="number" min={quantityMin(quantityMode)} step={quantityMin(quantityMode)} max={availableQuantity || undefined} value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
          {selectedProduct && quantityMode === 'whole' && Number.isFinite(selectedProduct.stock) && Math.abs(selectedProduct.stock - Math.round(selectedProduct.stock)) > 1e-8 && <div className="backup-warning"><Package size={16} /><span>ဒီပစ္စည်းယူနစ် ({selectedProduct.unit}) က အရေအတွက်ပြည့်ကိန်းဖြစ်သင့်ပေမဲ့ လက်ရှိ Stock မှာ ဒသမရှိနေပါတယ်။ လွှဲမီ တကယ်ရေတွက်ပြီး Inventory ရဲ့ Stock ± မှာ အမှန်တကယ်လက်ကျန်ကို ပြင်ဆင်ပါ။ အလိုအလျောက် Round မလုပ်ထားပါ။</span></div>}
          <label>မှတ်ချက် (မဖြစ်မနေ မဟုတ်)<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ဥပမာ - ဆိုင် ၂ မှာ နေရာရလို့ လွှဲပေးသည်" /></label>
          {selectedProduct && destinationBranch && !destinationModeMismatch && <div className="backup-warning"><Package size={16} /><span>{destinationMatch ? `${destinationBranch.name} မှာ ${destinationMatch.name} ရှိပြီးသားဖြစ်လို့ အဲဒီဆိုင်ရဲ့ Product ထဲ Stock ပေါင်းပါမယ်။ သူ့ Barcode နဲ့ ဈေးနှုန်းတွေ မပြောင်းပါ။` : `${destinationBranch.name} မှာ ဒီပစ္စည်း မရှိသေးပါ။ လွှဲတဲ့အချိန် Product ID အသစ်ဖန်တီးပြီး Barcode / လက်လီ / လက်ကားဈေးကို မဖြည့်သေးဘဲ ထားပါမယ်။ နောက်မှ အဲဒီဆိုင်မှာ သီးခြားပြင်နိုင်ပါတယ်။`}</span></div>}
          <button className="button button-primary" type="submit" disabled={submitting || !selectedProduct || !destinationBranch || destinationModeMismatch || !isValidQuantity(Number(quantity), quantityMode) || Number(quantity) > availableQuantity}><ArrowLeftRight size={16} /> {submitting ? 'ကုန်လွှဲနေသည်…' : 'ကုန်လွှဲပြီး အတည်ပြုရန်'}</button>
          <small className="field-hint">Expired Batch များကို လွှဲခွင့်မပြုပါ။ Legacy Batch မရှိသည့် Stock ကို Opening Batch အဖြစ် ချိတ်ဆက်ပြီး လွှဲပေးပါမယ်။</small>
        </form>
        <div className="panel form-panel">
          <div className="panel-heading"><div className="panel-icon"><CheckCircle2 size={18} /></div><div><h3>ကုန်လွှဲပြီးနောက်</h3><p>လွှဲပြောင်းမှုကို Source နဲ့ Destination နှစ်ဖက်လုံးမှာ မှတ်တမ်းတင်ပါမယ်။</p></div></div>
          <div className="branch-list-item"><div className="branch-list-icon"><Store size={18} /></div><div className="branch-list-info"><strong>{sourceBranch?.name || 'မူလဆိုင်'}</strong><small>မူလ Product ID ထဲက Stock လျှော့ပါမယ်။</small></div></div>
          <div className="branch-list-item"><div className="branch-list-icon"><Store size={18} /></div><div className="branch-list-info"><strong>{destinationBranch?.name || 'လက်ခံမည့်ဆိုင်'}</strong><small>Product ရှိပြီးသားဆို Stock ပေါင်းမယ်။ မရှိသေးရင် သီးခြား Product ID အသစ်ဖန်တီးမယ်။</small></div></div>
          {lastTransfer && <div className="backup-warning"><CheckCircle2 size={16} /><span>လွှဲပြီးပါပြီ · {lastTransfer.productName} × {formatQuantity(lastTransfer.quantity, quantityModeForProduct({ unit: lastTransfer.unit }))} {lastTransfer.unit} · Transfer No. {lastTransfer.transferNo}<br />မူလဆိုင် {formatQuantity(lastTransfer.sourceStockBefore, quantityModeForProduct({ unit: lastTransfer.unit }))} → {formatQuantity(lastTransfer.sourceStockAfter, quantityModeForProduct({ unit: lastTransfer.unit }))} {lastTransfer.unit}<br />လက်ခံဆိုင် {formatQuantity(lastTransfer.destinationStockBefore, quantityModeForProduct({ unit: lastTransfer.unit }))} → {formatQuantity(lastTransfer.destinationStockAfter, quantityModeForProduct({ unit: lastTransfer.unit }))} {lastTransfer.unit}</span></div>}
          {lastTransfer && <button type="button" className="button button-primary" onClick={viewDestination}>လက်ခံဆိုင် Inventory ကို ကြည့်ရန်</button>}
          <div className="backup-warning"><CheckCircle2 size={16} /><span>Batch ရဲ့ Expiry Date နဲ့ Cost ကို လွှဲပေးမယ်။ Destination Product ရဲ့ လက်လီဈေး၊ လက်ကားဈေးနဲ့ Barcode ကို မူလဆိုင်ကနေ မကူးပေးပါ။</span></div>
        </div>
      </div>
    </>}
    <div className="panel">
      <div className="panel-heading"><div className="panel-icon"><ClipboardList size={18} /></div><div><h3>ကုန်လွှဲမှတ်တမ်း</h3><p>လက်ရှိရွေးထားသောဆိုင်၏ အဝင်/အထွက် ကုန်လွှဲမှတ်တမ်းများ</p></div></div>
      {transferHistory.length === 0 ? <div className="empty-state"><ArrowLeftRight size={23} /><strong>ကုန်လွှဲမှတ်တမ်း မရှိသေးပါ</strong><p>ဆိုင်တစ်ဆိုင်မှ တစ်ဆိုင်သို့ ကုန်လွှဲပြီးပါက ဒီနေရာမှာ မှတ်တမ်းပေါ်လာပါမယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>နေ့စွဲ</th><th>Transfer No.</th><th>မူလဆိုင်</th><th>လက်ခံဆိုင်</th><th>ပစ္စည်း</th><th>အရေအတွက်</th><th>Stock ပြောင်းလဲမှု</th><th>လုပ်ဆောင်သူ</th><th>အခြေအနေ</th><th>မှတ်ချက်</th><th>လုပ်ဆောင်ချက်</th></tr></thead><tbody>{transferHistory.map((transfer) => <tr key={transfer.id}><td>{dateLabel(transfer.date)}</td><td><b className="mono">{transfer.transferNo}</b></td><td>{branches.find((branch) => branch.id === transfer.fromBranchId)?.name || transfer.fromBranchName || 'မသိရှိ'}</td><td>{branches.find((branch) => branch.id === transfer.toBranchId)?.name || transfer.toBranchName || 'မသိရှိ'}</td><td>{transfer.items.map((item) => `${item.productName} (${formatQuantity(item.quantity, quantityModeForProduct({ unit: item.unit }))} ${item.unit})`).join('၊ ')}</td><td><b>{summarizeQuantities(transfer.items.map((item) => ({ quantity: item.quantity, unit: item.unit })))}</b></td><td>{transfer.items.map((item) => item.sourceStockBefore !== undefined && item.sourceStockAfter !== undefined && item.destinationStockBefore !== undefined && item.destinationStockAfter !== undefined ? <span key={item.sourceProductId}>{branches.find((branch) => branch.id === transfer.fromBranchId)?.name || transfer.fromBranchName || 'မူလဆိုင်'}: {formatQuantity(item.sourceStockBefore, quantityModeForProduct({ unit: item.unit }))} → {formatQuantity(item.sourceStockAfter, quantityModeForProduct({ unit: item.unit }))}<br />{branches.find((branch) => branch.id === transfer.toBranchId)?.name || transfer.toBranchName || 'လက်ခံဆိုင်'}: {formatQuantity(item.destinationStockBefore, quantityModeForProduct({ unit: item.unit }))} → {formatQuantity(item.destinationStockAfter, quantityModeForProduct({ unit: item.unit }))}</span> : <span className="subtle-count">အရင် Version မှတ်တမ်း · Stock အတည်ပြုရန်</span>)}</td><td>{transfer.initiatedByName || transfer.initiatedByEmail || 'အဟောင်းမှတ်တမ်း'}</td><td>{transfer.status === 'reversed' ? <span className="tag">ပြန်လည်ပယ်ဖျက်ပြီး</span> : <span className="tag">ပြီးဆုံး</span>}{transfer.reversedAt && <small className="field-hint">{dateLabel(transfer.reversedAt)} · {transfer.reversedByName || 'Owner'}</small>}</td><td>{transfer.status === 'reversed' ? (transfer.reversalNote || 'ပြန်လည်ပယ်ဖျက်ပြီး') : (transfer.note || '—')}</td><td>{transfer.status === 'reversed' ? <span className="subtle-count">ပြန်လှန်ပြီး</span> : transfer.items.every((item) => item.sourceStockBefore !== undefined && item.sourceStockAfter !== undefined && item.destinationStockBefore !== undefined && item.destinationStockAfter !== undefined && Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0) ? <button type="button" className="button button-danger" disabled={!!reversingId} onClick={() => reverseTransfer(transfer.id)}>{reversingId === transfer.id ? 'ပြန်လှန်နေသည်…' : 'ပြန်လည်ပယ်ဖျက်ရန်'}</button> : <span className="subtle-count">အဟောင်းမှတ်တမ်း · မပြန်လှန်နိုင်</span>}</td></tr>)}</tbody></table></div>}
    </div>
    <div className="panel security-note"><ArrowLeftRight size={18} /><div><strong>ကုန်လွှဲစည်းမျဉ်း</strong><p>Source Branch ရဲ့ Stock ကို လျှော့ပြီး Destination Branch ရဲ့ Product/Stock ထဲ တစ်ခါတည်း ပေါင်းထည့်ပါတယ်။ ထပ်ခါနှိပ်မှုကို Request ID နဲ့ ကာကွယ်ပြီး လွှဲသူ၊ လွှဲချိန်၊ Batch/Expiry နဲ့ Stock အရင်/နောက်ကို မှတ်တမ်းတင်ပါတယ်။ ပြန်လည်ပယ်ဖျက်ရာမှာ လွှဲပေးခဲ့တဲ့ Batch အပြည့်ကျန်နေမှသာ Owner PIN ဖြင့် ပြန်လှန်နိုင်ပါတယ်။</p></div></div>
  </section>;
}
