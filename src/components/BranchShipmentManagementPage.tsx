import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, PackagePlus, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { useBusinessAccess } from '../lib/businessAccess';
import { firebaseAuth } from '../lib/firebase';
import { formatQuantity, isValidQuantity, quantityMin, quantityModeForProduct, summarizeQuantities } from '../lib/quantity';
import { usePosStore, type BranchShipmentDraftItem, type BranchStockShipment, type Product } from '../store/usePosStore';

const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
type DraftLine = { key: string; productId: string; quantity: string };
const newKey = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `line-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function ShipmentStatus({ status }: { status: BranchStockShipment['status'] }) {
  const config = {
    dispatched: { label: 'ပို့ပြီး · လက်ခံရန်', className: 'tag-info' },
    received: { label: 'လက်ခံပြီး · Owner Approval စောင့်နေ', className: 'tag-warn' },
    approved: { label: 'အတည်ပြုပြီး · Stock ဝင်ပြီး', className: 'tag-success' },
    cancelled: { label: 'ပယ်ဖျက်ပြီး', className: 'tag-warn' },
  }[status];
  return <span className={`tag ${config.className}`}>{config.label}</span>;
}

function ShipmentHistoryCard({ shipment, onApprove, onCancel, busy }: {
  shipment: BranchStockShipment;
  onApprove: (shipment: BranchStockShipment) => void;
  onCancel: (shipment: BranchStockShipment) => void;
  busy: boolean;
}) {
  const itemsSummary = summarizeQuantities(shipment.items.map((item) => ({ quantity: item.quantity, unit: item.unit, quantityMode: item.quantityMode })));
  return <article className="shipment-card">
    <div className="shipment-card-head">
      <div><strong>{shipment.shipmentNo}</strong><small>{shipment.fromBranchName} → {shipment.toBranchName} · {dateLabel(shipment.date)}</small></div>
      <ShipmentStatus status={shipment.status} />
    </div>
    <div className="shipment-history-meta"><span>{shipment.items.length} မျိုး</span><span>{itemsSummary}</span><span>ပို့သူ: {shipment.dispatchedByName || shipment.dispatchedByEmail || 'Owner'}</span></div>
    {shipment.note && <p className="shipment-note">မှတ်ချက်: {shipment.note}</p>}
    <div className="shipment-items-list">
      {shipment.items.map((item) => {
        const received = shipment.receivedItems?.find((entry) => entry.sourceProductId === item.sourceProductId);
        const accepted = received ? Math.max(0, received.receivedQuantity - received.damagedQuantity) : item.acceptedQuantity;
        return <div className="shipment-history-line" key={item.sourceProductId}>
          <div><strong>{item.productName}</strong><small>{item.sku || item.barcode || 'Barcode မရှိ'} · လက်လီ {item.retailPrice.toLocaleString('en-US')} · လက်ကား {item.wholesalePrice.toLocaleString('en-US')}</small></div>
          <div className="shipment-history-quantities"><span>ပို့ {formatQuantity(item.quantity, item.quantityMode || item.unit)}</span>{received && <span>လက်ခံ {formatQuantity(received.receivedQuantity, item.quantityMode || item.unit)}</span>}{received && <span>ပျက်စီး {formatQuantity(received.damagedQuantity, item.quantityMode || item.unit)}</span>}{shipment.status === 'approved' && <strong>Stock +{formatQuantity(accepted || 0, item.quantityMode || item.unit)}</strong>}</div>
        </div>;
      })}
    </div>
    {shipment.status === 'received' && <div className="shipment-receipt-review"><div><strong>လက်ခံသူ: {shipment.receivedByName || shipment.receivedByEmail || 'Receiver'}</strong><small>{shipment.receivedAt ? dateLabel(shipment.receivedAt) : ''} · {shipment.receiverNote || 'မှတ်ချက်မရှိ'}</small></div><button className="button button-primary" type="button" onClick={() => onApprove(shipment)} disabled={busy}><CheckCircle2 size={15} /> Owner Approval လုပ်မယ်</button></div>}
    {shipment.status === 'dispatched' && <div className="shipment-receipt-review"><small>ပစ္စည်းလက်ခံသူက မအတည်ပြုရသေးပါ။ ဒီအခြေအနေမှာ Destination Stock မတိုးသေးပါ။</small><button className="button button-outline" type="button" onClick={() => onCancel(shipment)} disabled={busy}><XCircle size={15} /> ပို့မှု ပယ်ဖျက်ရန်</button></div>}
    {shipment.status === 'approved' && <div className="shipment-status-note shipment-success"><CheckCircle2 size={15} /> Owner အတည်ပြုပြီး {shipment.toBranchName} Branch Stock ထဲ ထည့်သွင်းပြီးပါပြီ။ Approved by {shipment.approvedByName || 'Owner'}.</div>}
    {shipment.status === 'cancelled' && <div className="shipment-status-note"><XCircle size={15} /> ပယ်ဖျက်ထားသည်။ {shipment.cancellationNote || ''}</div>}
  </article>;
}

export function BranchShipmentManagementPage({ authorize, notify }: { authorize: (action: string) => boolean; notify: (message: string) => void }) {
  const access = useBusinessAccess();
  const branches = usePosStore((state) => state.branches);
  const products = usePosStore((state) => state.products);
  const shipments = usePosStore((state) => state.stockShipments);
  const dispatchShipment = usePosStore((state) => state.dispatchBranchStockShipment);
  const approveShipment = usePosStore((state) => state.approveBranchStockShipment);
  const cancelShipment = usePosStore((state) => state.cancelBranchStockShipment);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const activeBranches = useMemo(() => branches.filter((branch) => branch.status === 'active'), [branches]);
  const [sourceBranchId, setSourceBranchId] = useState(activeBranchId);
  const [destinationBranchId, setDestinationBranchId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ key: newKey(), productId: '', quantity: '1' }]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newKey());

  useEffect(() => {
    if (!activeBranches.some((branch) => branch.id === sourceBranchId)) {
      setSourceBranchId(activeBranches.find((branch) => branch.id === activeBranchId)?.id || activeBranches.find((branch) => branch.isDefault)?.id || activeBranches[0]?.id || '');
    }
  }, [activeBranchId, activeBranches, sourceBranchId]);

  const sourceBranch = activeBranches.find((branch) => branch.id === sourceBranchId);
  const destinationOptions = activeBranches.filter((branch) => branch.id !== sourceBranchId);
  useEffect(() => {
    if (!destinationOptions.some((branch) => branch.id === destinationBranchId)) setDestinationBranchId(destinationOptions[0]?.id || '');
  }, [sourceBranchId, branches]);
  const destinationBranch = destinationOptions.find((branch) => branch.id === destinationBranchId);
  const sourceProducts = useMemo(() => products.filter((product) => product.branchId === sourceBranchId && product.stock > 0).sort((a, b) => a.name.localeCompare(b.name)), [products, sourceBranchId]);
  const chosenIds = new Set(lines.map((line) => line.productId).filter(Boolean));

  const updateLine = (key: string, changes: Partial<Pick<DraftLine, 'productId' | 'quantity'>>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line));
  const addLine = () => setLines((current) => current.length >= 50 ? current : [...current, { key: newKey(), productId: '', quantity: '1' }]);
  const removeLine = (key: string) => setLines((current) => current.length <= 1 ? [{ key: newKey(), productId: '', quantity: '1' }] : current.filter((line) => line.key !== key));

  const dispatch = () => {
    if (busy || !sourceBranch || !destinationBranch || !authorize('ဆိုင်ခွဲသို့ ပစ္စည်းအများအပြား ပို့ရန်')) return;
    const inputItems: BranchShipmentDraftItem[] = [];
    const used = new Set<string>();
    for (const line of lines) {
      if (!line.productId) continue;
      if (used.has(line.productId)) { notify('ပစ္စည်းတစ်မျိုးကို စာရင်းထဲ ထပ်မထည့်ပါနဲ့။'); return; }
      used.add(line.productId);
      const product = sourceProducts.find((entry) => entry.id === line.productId);
      const quantity = Number(line.quantity);
      if (!product || !isValidQuantity(quantity, quantityModeForProduct(product)) || quantity > product.stock) {
        notify(`${product?.name || 'ပစ္စည်း'} ရဲ့ လွှဲမည့်အရေအတွက်/လက်ကျန်ကို ပြန်စစ်ပါ။`);
        return;
      }
      inputItems.push({ sourceProductId: product.id, quantity });
    }
    if (inputItems.length === 0) { notify('ပို့မည့်ပစ္စည်း အနည်းဆုံးတစ်မျိုး ရွေးပါ။'); return; }
    if (!window.confirm(`${sourceBranch.name} မှ ${destinationBranch.name} သို့ ပစ္စည်း ${inputItems.length} မျိုး ပို့မလား?\n\nပို့ပြီးတာနဲ့ Source Stock လျှော့ပါမယ်။ Destination Stock က Receiver လက်ခံပြီး Owner Approval လုပ်မှသာ တိုးပါမယ်။`)) return;

    setBusy(true);
    try {
      const user = firebaseAuth?.currentUser;
      const shipment = dispatchShipment({
        fromBranchId: sourceBranch.id,
        toBranchId: destinationBranch.id,
        items: inputItems,
        note,
        requestId: requestId.current,
        actor: { uid: access.uid || user?.uid || '', email: access.email || user?.email || '', name: access.displayName || user?.displayName || user?.email || 'Owner' },
      });
      if (!shipment) {
        notify('ပစ္စည်းပို့မရပါ။ Source Stock၊ Expiry Batch၊ အရေအတွက်နဲ့ Branch ရွေးချယ်မှုကို စစ်ပါ။');
        return;
      }
      requestId.current = newKey();
      setLines([{ key: newKey(), productId: '', quantity: '1' }]);
      setNote('');
      notify(`${shipment.shipmentNo} ပို့ဆောင်စာရင်း ဖန်တီးပြီးပါပြီ။ ${destinationBranch.name} မှ လက်ခံပြီး Owner Approval လုပ်ရပါမယ်။`);
    } finally {
      setBusy(false);
    }
  };

  const approve = (shipment: BranchStockShipment) => {
    if (busy || shipment.status !== 'received' || !authorize('ပစ္စည်းရောက်ရှိမှု အတည်ပြုရန်')) return;
    const invalidReceipt = shipment.items.some((item) => {
      const received = shipment.receivedItems?.find((entry) => entry.sourceProductId === item.sourceProductId);
      const mode = item.quantityMode || item.unit;
      return !received
        || !isValidQuantity(received.receivedQuantity, mode, true)
        || !isValidQuantity(received.damagedQuantity, mode, true)
        || received.receivedQuantity < 0 || received.receivedQuantity > item.quantity
        || received.damagedQuantity < 0 || received.damagedQuantity > received.receivedQuantity;
    });
    if (invalidReceipt) { notify('လက်ခံရရှိ/ပျက်စီး အရေအတွက်မှာ မမှန်ကန်သော တန်ဖိုးရှိပါတယ်။ Stock Approval မလုပ်နိုင်ပါ။ Receiver စာရင်းကို ပြန်စစ်ပါ။'); return; }
    const mismatch = shipment.items.some((item) => {
      const received = shipment.receivedItems?.find((entry) => entry.sourceProductId === item.sourceProductId);
      return !received || received.receivedQuantity !== item.quantity || received.damagedQuantity > 0;
    });
    if (!window.confirm(`${shipment.shipmentNo} ကို Owner အဖြစ် အတည်ပြုမလား?\n\n${mismatch ? 'ပို့ထားတဲ့အရေအတွက်နဲ့ လက်ခံရရှိမှု မတူတာ/ပျက်စီးမှု ရှိပါတယ်။ အောက်ပါ Accepted Quantity ကိုသာ Stock ထဲ ထည့်ပါမယ်။' : 'လက်ခံရရှိသော ပစ္စည်းအားလုံးကို Destination Stock ထဲ ထည့်ပါမယ်။'}\n\nအတည်ပြုပြီးနောက် ဒီ Shipment ကို ထပ်မံ Approve လုပ်လို့မရပါ။`)) return;
    setBusy(true);
    try {
      const user = firebaseAuth?.currentUser;
      const ok = approveShipment({ shipmentId: shipment.id, actor: { uid: access.uid || user?.uid || '', email: access.email || user?.email || '', name: access.displayName || user?.displayName || user?.email || 'Owner' } });
      notify(ok ? `${shipment.toBranchName} ဆိုင်ခွဲ၏ Stock ကို လက်ခံရရှိသည့်အရေအတွက်အတိုင်း ထည့်ပြီးပါပြီ။ Cloud Sync အောင်မြင်ကြောင်း စစ်ဆေးပါ။` : 'Approval မအောင်မြင်ပါ။ Shipment Status, Branch Product တူညီမှုနဲ့ Stock Batch ကို စစ်ဆေးပါ။');
    } finally { setBusy(false); }
  };

  const cancel = (shipment: BranchStockShipment) => {
    if (busy || shipment.status !== 'dispatched' || !authorize('ကုန်ပို့မှု ပယ်ဖျက်ရန်')) return;
    const reason = window.prompt(`${shipment.shipmentNo} ကို မလက်ခံရသေးခင် ပယ်ဖျက်မယ်။ အကြောင်းပြချက် ထည့်ပါ။`, 'ပို့မှု မှားယွင်းသွားသည်');
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const user = firebaseAuth?.currentUser;
      const ok = cancelShipment({ shipmentId: shipment.id, actor: { uid: access.uid || user?.uid || '', email: access.email || user?.email || '', name: access.displayName || user?.displayName || user?.email || 'Owner' }, note: reason.trim() });
      notify(ok ? 'ကုန်ပို့မှုကို ပယ်ဖျက်ပြီး Source Stock ပြန်တိုးထားပါတယ်။' : 'ကုန်ပို့မှု ပယ်ဖျက်မရပါ။ လက်ခံပြီးသား သို့မဟုတ် Status ပြောင်းထားနိုင်ပါတယ်။');
    } finally { setBusy(false); }
  };

  const sortedShipments = [...shipments].sort((a, b) => b.date.localeCompare(a.date));
  return <section className="page-stack shipment-management">
    <div className="section-heading"><div><h2>Central Inventory · Branch Receiving</h2><p>Owner က ပစ္စည်းနဲ့ ဈေးနှုန်းသတ်မှတ်ပြီး ဆိုင်ခွဲသို့ စာရင်းလိုက် ပို့နိုင်ပါတယ်။</p></div><span className="tag tag-success">Owner Only</span></div>
    <div className="shipment-info-banner"><PackagePlus size={19} /><div><strong>ပစ္စည်းပို့ခြင်းနှင့် လက်ခံခြင်း</strong><p>ပို့ပြီးချိန် Source Stock လျှော့မယ်။ Receiver က အမှန်တကယ်ရောက်ရှိမှုကို မှတ်တမ်းတင်မယ်။ Owner Approval ပြီးမှ Destination Stock တိုးမယ်။</p></div></div>

    <div className="panel form-panel shipment-form">
      <div className="panel-heading"><div className="panel-icon"><Send size={18} /></div><div><h3>ပစ္စည်းအများအပြား ပို့ရန်</h3><p>Shipment တစ်ခုထဲမှာ ပစ္စည်း ၅၀ မျိုးအထိ ထည့်နိုင်ပါတယ်။ Product/Barcode/ဈေးနှုန်းကို Source Branch ကနေ Snapshot ယူပါမယ်။</p></div></div>
      <div className="form-grid shipment-branch-grid">
        <label>ပို့မည့်ဆိုင်ခွဲ<select value={sourceBranchId} onChange={(event) => setSourceBranchId(event.target.value)}><option value="">ရွေးပါ</option>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label>လက်ခံမည့်ဆိုင်ခွဲ<select value={destinationBranchId} onChange={(event) => setDestinationBranchId(event.target.value)}><option value="">ရွေးပါ</option>{destinationOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      </div>
      <div className="shipment-draft-header"><strong>ပို့မည့်ပစ္စည်းစာရင်း</strong><button className="button button-outline" type="button" onClick={addLine} disabled={lines.length >= 50 || busy}><Plus size={15} /> ပစ္စည်းထပ်ထည့်</button></div>
      <div className="shipment-draft-list">
        {lines.map((line, index) => {
          const product = sourceProducts.find((entry) => entry.id === line.productId);
          return <div className="shipment-draft-row" key={line.key}>
            <span className="shipment-row-number">{index + 1}</span>
            <label className="shipment-product-select">ပစ္စည်း<select value={line.productId} onChange={(event) => updateLine(line.key, { productId: event.target.value })}><option value="">ပစ္စည်းရွေးပါ</option>{sourceProducts.filter((entry) => !chosenIds.has(entry.id) || entry.id === line.productId).map((entry: Product) => <option key={entry.id} value={entry.id}>{entry.name} · လက်ကျန် {formatQuantity(entry.stock, quantityModeForProduct(entry))} {entry.unit}</option>)}</select></label>
            <label className="shipment-qty-select">ပို့မည့်အရေအတွက်<input type="number" min={product ? quantityMin(quantityModeForProduct(product)) : '1'} step={product ? quantityMin(quantityModeForProduct(product)) : '1'} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
            <button className="small-action small-action-danger" type="button" title="ဒီစာကြောင်းဖယ်ရန်" onClick={() => removeLine(line.key)} disabled={busy}><Trash2 size={14} /></button>
            {product && <div className="shipment-price-snapshot"><span>SKU: {product.sku || '—'}</span><span>Barcode: {product.barcode || '—'}</span><span>အရင်း {product.costPrice.toLocaleString('en-US')}</span><span>လက်လီ {product.retailPrice.toLocaleString('en-US')}</span><span>လက်ကား {product.wholesalePrice.toLocaleString('en-US')}</span></div>}
          </div>;
        })}
      </div>
      <label>ပို့ဆောင်မှတ်ချက်<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ကားနံပါတ်၊ ပို့ဆောင်သူ၊ အခြားမှတ်ချက်..." /></label>
      <div className="shipment-form-footer"><small>အတည်ပြု ပို့ပြီးနောက် Source Stock မှ လျှော့မည်။ Destination မှာတော့ လက်ခံပြီး Owner Approve လုပ်မှသာ Stock ဝင်မည်။</small><button className="button button-primary" type="button" onClick={dispatch} disabled={busy || !sourceBranch || !destinationBranch || lines.every((line) => !line.productId)}><Send size={16} /> {busy ? 'လုပ်ဆောင်နေသည်...' : 'ပစ္စည်းစာရင်း ပို့မယ်'}</button></div>
    </div>

    <div className="section-heading shipment-history-heading"><div><h2>ပို့ဆောင်မှု / လက်ခံမှု မှတ်တမ်း</h2><p>{sortedShipments.length} shipments · Owner က လက်ခံမှုကို စစ်ဆေးအတည်ပြုနိုင်ပါတယ်။</p></div></div>
    {sortedShipments.length === 0 ? <div className="panel empty-state"><ClipboardList size={24} /><strong>ကုန်ပို့စာရင်း မရှိသေးပါ</strong><p>Branch တစ်ခုထက်ပိုရှိလာပါက ပစ္စည်းစာရင်းကို အပေါ်က Form မှာ ဖန်တီးနိုင်ပါတယ်။</p></div> : sortedShipments.map((shipment) => <ShipmentHistoryCard key={shipment.id} shipment={shipment} onApprove={approve} onCancel={cancel} busy={busy} />)}
  </section>;
}
