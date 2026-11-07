import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck, PackageCheck, Truck } from 'lucide-react';
import { useBusinessAccess } from '../lib/businessAccess';
import { submitBranchShipmentReceipt } from '../lib/branchShipmentSync';
import { formatQuantity, isValidQuantity, quantityMin } from '../lib/quantity';
import { firebaseAuth } from '../lib/firebase';
import { usePosStore, type BranchShipmentReceiptInput, type BranchStockShipment } from '../store/usePosStore';

const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

type ReceiptDraft = Record<string, { received: string; damaged: string; note: string }>;

function ShipmentReceiptCard({ shipment, notify }: { shipment: BranchStockShipment; notify: (message: string) => void }) {
  const access = useBusinessAccess();
  const confirmLocal = usePosStore((state) => state.confirmBranchStockShipmentReceipt);
  const [rows, setRows] = useState<ReceiptDraft>(() => Object.fromEntries(shipment.items.map((item) => [item.sourceProductId, {
    received: String(item.quantity), damaged: '0', note: '',
  }])));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const updateRow = (id: string, field: 'received' | 'damaged' | 'note', value: string) => {
    setRows((current) => ({
      ...current,
      [id]: { ...(current[id] || { received: '0', damaged: '0', note: '' }), [field]: value },
    }));
  };

  const receive = async () => {
    if (busy || shipment.status !== 'dispatched' || !access.canReceiveStock || !access.uid || access.branchIds.length !== 1 || access.branchIds[0] !== shipment.toBranchId) return;
    const receivedItems: BranchShipmentReceiptInput[] = [];
    for (const item of shipment.items) {
      const draft = rows[item.sourceProductId];
      const receivedQuantity = Number(draft?.received);
      const damagedQuantity = Number(draft?.damaged);
      const step = item.quantityMode || item.unit;
      if (!isValidQuantity(receivedQuantity, step, true) || !isValidQuantity(damagedQuantity, step, true)
        || damagedQuantity > receivedQuantity || receivedQuantity > item.quantity) {
        notify(`${item.productName} ရဲ့ လက်ခံ/ပျက်စီး အရေအတွက်ကို ပြန်စစ်ပါ။`);
        return;
      }
      receivedItems.push({ sourceProductId: item.sourceProductId, receivedQuantity, damagedQuantity, note: draft?.note || '' });
    }
    if (!window.confirm(`${shipment.shipmentNo} ကို လက်ခံကြောင်း အတည်ပြုမလား?\n\nသတိ: ဒီအဆင့်မှာ Destination Stock မတိုးသေးပါ။ Owner Approval ပြီးမှ Stock ဝင်ပါမယ်။`)) return;

    setBusy(true);
    try {
      const actor = firebaseAuth?.currentUser;
      await submitBranchShipmentReceipt({
        branchId: shipment.toBranchId,
        shipmentId: shipment.id,
        uid: access.uid,
        email: actor?.email || access.email,
        name: access.displayName || actor?.displayName || actor?.email || 'Stock Receiver',
        receivedItems,
        note,
      });
      const localApplied = confirmLocal({
        shipmentId: shipment.id,
        receivedItems,
        actor: { uid: access.uid, email: actor?.email || access.email, name: access.displayName || actor?.displayName || actor?.email || 'Stock Receiver' },
        note,
      });
      if (!localApplied) {
        notify('Cloud မှ လက်ခံမှုသိမ်းပြီးပါပြီ။ ဒီ Device ရဲ့ Local Copy ကို ပြန် Sync လုပ်ရန် Refresh လုပ်ပါ။');
        return;
      }
      notify(`${shipment.shipmentNo} ကို လက်ခံပြီးပါပြီ။ Owner Approval ပြီးမှ Stock ဝင်ပါမယ်။`);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
      notify(code === 'permission-denied'
        ? 'Stock Receiver Permission မရပါ။ Owner က Team Access နဲ့ Firestore Rules ကို စစ်ဆေးပေးပါ။'
        : error instanceof Error ? error.message : 'ပစ္စည်းလက်ခံမှု မအောင်မြင်ပါ။');
    } finally {
      setBusy(false);
    }
  };

  const receivedSummary = shipment.receivedItems || [];
  return <article className="shipment-card">
    <div className="shipment-card-head">
      <div><strong>{shipment.shipmentNo}</strong><small>{shipment.fromBranchName} မှ ပို့ · {dateLabel(shipment.date)}</small></div>
      <span className={`tag ${shipment.status === 'approved' ? 'tag-success' : shipment.status === 'received' ? 'tag-warn' : 'tag-info'}`}>{shipment.status === 'dispatched' ? 'လက်ခံရန်' : shipment.status === 'received' ? 'Owner Approval စောင့်နေ' : shipment.status === 'approved' ? 'အတည်ပြုပြီး' : 'ပယ်ဖျက်'}</span>
    </div>
    {shipment.note && <p className="shipment-note">{shipment.note}</p>}
    <div className="shipment-items-list">
      {shipment.items.map((item) => {
        const draft = rows[item.sourceProductId] || { received: String(item.quantity), damaged: '0', note: '' };
        const received = receivedSummary.find((entry) => entry.sourceProductId === item.sourceProductId);
        return <div className="shipment-receive-line" key={item.sourceProductId}>
          <div className="shipment-product-meta"><strong>{item.productName}</strong><small>{item.sku || item.barcode || 'Barcode မရှိ'} · {item.unit} · ပို့ထား {formatQuantity(item.quantity, item.quantityMode || item.unit)}</small><small>လက်လီ {item.retailPrice.toLocaleString('en-US')} · လက်ကား {item.wholesalePrice.toLocaleString('en-US')}</small></div>
          {shipment.status === 'dispatched' ? <div className="shipment-receive-inputs">
            <label>လက်ခံ<input type="number" min="0" max={item.quantity} step={quantityMin(item.quantityMode || item.unit)} value={draft.received} onChange={(event) => updateRow(item.sourceProductId, 'received', event.target.value)} /></label>
            <label>ပျက်စီး<input type="number" min="0" max={item.quantity} step={quantityMin(item.quantityMode || item.unit)} value={draft.damaged} onChange={(event) => updateRow(item.sourceProductId, 'damaged', event.target.value)} /></label>
            <label className="shipment-line-note">မှတ်ချက်<input value={draft.note} onChange={(event) => updateRow(item.sourceProductId, 'note', event.target.value)} placeholder="လိုအပ်ပါက" /></label>
          </div> : <div className="shipment-received-summary"><span>လက်ခံ {formatQuantity(received?.receivedQuantity ?? item.receivedQuantity ?? 0, item.quantityMode || item.unit)}</span><span>ပျက်စီး {formatQuantity(received?.damagedQuantity ?? item.damagedQuantity ?? 0, item.quantityMode || item.unit)}</span><strong>Stock ဝင်မည့်ပမာဏ {formatQuantity(Math.max(0, (received?.receivedQuantity ?? item.receivedQuantity ?? 0) - (received?.damagedQuantity ?? item.damagedQuantity ?? 0)), item.quantityMode || item.unit)}</strong></div>}
        </div>;
      })}
    </div>
    {shipment.status === 'dispatched' && <div className="shipment-receive-footer"><label>လက်ခံမှုမှတ်ချက်<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ပစ္စည်းအရေအတွက်၊ ပျက်စီးမှု စသည်..." /></label><button className="button button-primary" type="button" onClick={() => void receive()} disabled={busy}><ClipboardCheck size={16} /> {busy ? 'သိမ်းနေသည်...' : 'လက်ခံကြောင်း အတည်ပြုမယ်'}</button></div>}
    {shipment.status === 'received' && <div className="shipment-status-note"><AlertCircle size={15} /> လက်ခံစာရင်းကို Owner ဆီ ပို့ပြီးပါပြီ။ Owner အတည်ပြုပြီးမှ ပစ္စည်း Stock ထဲ ဝင်ပါမယ်။</div>}
    {shipment.status === 'approved' && <div className="shipment-status-note shipment-success"><CheckCircle2 size={15} /> Owner က {shipment.approvedByName || 'Owner'} မှ အတည်ပြုပြီးပါပြီ။</div>}
  </article>;
}

export function BranchStockReceivingPage({ notify }: { notify: (message: string) => void }) {
  const access = useBusinessAccess();
  const shipments = usePosStore((state) => state.stockShipments);
  const branchId = access.branchIds.length === 1 ? access.branchIds[0] : '';
  const branchShipments = useMemo(() => shipments
    .filter((entry) => entry.toBranchId === branchId && ['dispatched', 'received', 'approved'].includes(entry.status))
    .sort((a, b) => b.date.localeCompare(a.date)), [shipments, branchId]);
  const pending = branchShipments.filter((entry) => entry.status === 'dispatched').length;

  if (!access.canReceiveStock || access.role !== 'cashier' || !branchId) return <section className="panel empty-state"><PackageCheck size={25} /><strong>Stock Receiver ခွင့် မရှိသေးပါ</strong><p>Owner က Profile → ဝန်ထမ်းအကောင့်မှာ ဒီ Account အတွက် Stock Receiver ခွင့် ဖွင့်ပေးရပါမယ်။</p></section>;

  return <section className="page-stack shipment-management">
    <div className="section-heading"><div><h2>ရောက်လာသော ကုန်စစ်ဆေးရန်</h2><p>ဒီ Branch အတွက် ပို့ထားသော ပစ္စည်းစာရင်းကို စစ်ပြီး Owner ဆီ လက်ခံအတည်ပြုချက် ပို့ပါ။</p></div><span className="tag tag-info">{pending} ခု လက်ခံရန်</span></div>
    <div className="shipment-info-banner"><Truck size={18} /><div><strong>Stock Receiver · {branchId}</strong><p>လက်ခံကြောင်း Confirm လုပ်တာနဲ့ Stock မတိုးသေးပါ။ Owner Approval ပြီးမှ Product / Stock ထဲ ထည့်သွင်းပါမယ်။</p></div></div>
    {branchShipments.length === 0 ? <div className="panel empty-state"><PackageCheck size={25} /><strong>ပစ္စည်းပို့ထားတာ မရှိသေးပါ</strong><p>Owner က ဒီဆိုင်ခွဲသို့ ပစ္စည်းပို့လိုက်တဲ့အခါ ဒီနေရာမှာ ပေါ်လာပါမယ်။</p></div> : branchShipments.map((shipment) => <ShipmentReceiptCard key={shipment.id} shipment={shipment} notify={notify} />)}
  </section>;
}
