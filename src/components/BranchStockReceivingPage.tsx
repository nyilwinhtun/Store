import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck, PackageCheck, Truck } from 'lucide-react';
import { useBusinessAccess } from '../lib/businessAccess';
import { submitBranchShipmentReceipt } from '../lib/branchShipmentSync';
import { commitBranchShipmentAutoCompleteToCloud, BranchShipmentAutoCompleteUnknownError } from '../lib/branchShipmentAutoComplete';
import { formatQuantity, isValidQuantity, quantityMin, quantityModeForProduct } from '../lib/quantity';
import { firebaseAuth } from '../lib/firebase';
import { usePosStore, type BranchShipmentReceiptInput, type BranchStockShipment } from '../store/usePosStore';

const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });


type ReceiptDraft = Record<string, { received: string; damaged: string; note: string }>;

function normalizedKey(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function canAutoCompleteLocally(shipment: BranchStockShipment): { ok: boolean; reason: string; hardBlock?: boolean } {
  const state = usePosStore.getState();
  const epsilon = 0.000001;
  for (const item of shipment.items) {
    // Older shipments may predate explicit whole/decimal metadata. Keep those
    // on the established Owner Review route rather than guessing a Cloud rule value.
    if (item.quantityMode !== 'whole' && item.quantityMode !== 'decimal') {
      return { ok: false, reason: `${item.productName}: ဒီ Shipment က Quantity Mode အချက်အလက်ဟောင်းဖြစ်လို့ Owner Review မှတစ်ဆင့် လက်ခံပါမယ်။` };
    }
    const allocationTotal = item.batchAllocations.reduce((sum, allocation) => sum + Math.max(0, Number(allocation.quantity) || 0), 0);
    if (Math.abs(allocationTotal - item.quantity) > epsilon || item.batchAllocations.length === 0) {
      return { ok: false, hardBlock: true, reason: `${item.productName}: ပို့ထားတဲ့ Batch ခွဲဝေစာရင်း မပြည့်စုံပါ။ Owner က Shipment ကို စစ်ဆေး/ပြင်ဆင်ရန်လိုပါတယ်။` };
    }
    const matches = state.products.filter((product) => product.branchId === shipment.toBranchId && (
      (!!item.barcode && normalizedKey(product.barcode) === normalizedKey(item.barcode))
      || (!!item.sku && normalizedKey(product.sku) === normalizedKey(item.sku))
      || (normalizedKey(product.name) === normalizedKey(item.productName) && normalizedKey(product.unit || 'ခု') === normalizedKey(item.unit || 'ခု'))
    ));
    if (matches.length > 1) return { ok: false, hardBlock: true, reason: `${item.productName}: လက်ခံမည့်ဆိုင်မှာ ကိုက်ညီတဲ့ Product တစ်ခုထက်ပိုရှိပါတယ်။ Owner က Duplicate Product ကို အရင်ရှင်းပေးပါ။` };
    const destination = matches[0];
    if (!destination) {
      const hasCategory = state.categories.some((category) => category.branchId === shipment.toBranchId && category.isActive);
      if (!hasCategory) return { ok: false, reason: 'လက်ခံမည့်ဆိုင်မှာ Active Category မရှိသေးပါ။' };
      continue;
    }
    if (state.stockUnitRegistries.some((registry) => registry.branchId === shipment.toBranchId && registry.productId === destination.id && registry.units.length > 0)) {
      return { ok: false, hardBlock: true, reason: `${item.productName}: Destination မှာ Unit Barcode Tracking ရှိပြီးသားဖြစ်လို့ Quantity-only Shipment နဲ့ မရောနိုင်ပါ။ Barcode Unit Transfer လုပ်ငန်းစဉ်ကို အသုံးပြုရန်လိုပါတယ်။` };
    }
    if (quantityModeForProduct(destination) !== (item.quantityMode || quantityModeForProduct(destination))) {
      return { ok: false, hardBlock: true, reason: `${item.productName}: Destination Product ရဲ့ Unit ပုံစံ မတူညီပါ။ Owner က Product ကို အရင်စစ်ပေးပါ။` };
    }
    const trackedBatchTotal = state.stockBatches
      .filter((batch) => batch.branchId === shipment.toBranchId && batch.productId === destination.id)
      .reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
    if (trackedBatchTotal > Math.max(0, Number(destination.stock) || 0) + epsilon) {
      return { ok: false, hardBlock: true, reason: `${item.productName}: Destination Batch Stock က Product Stock ထက်ပိုနေပါတယ်။ Owner က စာရင်းကို အရင်ညှိပေးပါ။` };
    }
    if (trackedBatchTotal + epsilon < Math.max(0, Number(destination.stock) || 0)) {
      return { ok: false, reason: `${item.productName}: Destination Product Stock နဲ့ Batch Stock မပြည့်စုံသေးပါ။ Owner Review မှာ Opening Batch စစ်ဆေးပါမယ်။` };
    }
  }
  return { ok: true, reason: '' };
}

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
    const exactMatch = receivedItems.length === shipment.items.length && shipment.items.every((item, index) =>
      receivedItems[index]?.sourceProductId === item.sourceProductId
      && Math.abs(receivedItems[index].receivedQuantity - item.quantity) <= 0.000001
      && receivedItems[index].damagedQuantity === 0);
    const localAutoCheck = exactMatch ? canAutoCompleteLocally(shipment) : { ok: false, reason: '' };
    const shouldAutoComplete = exactMatch && localAutoCheck.ok;
    if (exactMatch && !localAutoCheck.ok && localAutoCheck.hardBlock) {
      notify(`${localAutoCheck.reason} Shipment ကို မပြောင်းထားပါ။ Owner က ပြင်ဆင်ပြီးမှ လက်ခံပါ။`);
      return;
    }
    const confirmMessage = shouldAutoComplete
      ? `${shipment.shipmentNo} ကို ပို့ထားတဲ့အရေအတွက်အတိုင်း အပြည့်အဝ လက်ခံရရှိကြောင်း အတည်ပြုမလား?\n\nအတည်ပြုပြီးတာနဲ့ Destination Stock ကို Cloud Transaction တစ်ခုတည်းနဲ့ တိုးပြီး Auto Complete လုပ်ပါမယ်။ Owner Approval စောင့်စရာမလိုပါ။`
      : `${shipment.shipmentNo} ကို လက်ခံမှုမှတ်တမ်းတင်မလား?\n\n${exactMatch ? `${localAutoCheck.reason}\n\nလက်ခံမှုကို Owner Review အဖြစ် ပို့ပါမယ်။` : 'ပို့ထားတဲ့အရေအတွက်နဲ့ လက်ခံရရှိမှု မတူတာ/ပျက်စီးမှု ရှိတဲ့အတွက် Owner Review လိုအပ်ပါတယ်။'}\n\nဒီအဆင့်မှာ Destination Stock မတိုးသေးပါ။`;
    if (!window.confirm(confirmMessage)) return;

    setBusy(true);
    const actor = firebaseAuth?.currentUser;
    const actorInfo = {
      uid: access.uid,
      email: actor?.email || access.email,
      name: access.displayName || actor?.displayName || actor?.email || 'Stock Receiver',
    };

    if (shouldAutoComplete) {
      const beforeState = usePosStore.getState();
      const localReceived = confirmLocal({ shipmentId: shipment.id, receivedItems, actor: actorInfo, note });
      const localApproved = localReceived && usePosStore.getState().approveBranchStockShipment({
        shipmentId: shipment.id, actor: actorInfo, note: 'Exact-match receiver confirmation', autoComplete: true,
      });
      if (!localApproved) {
        usePosStore.setState({ products: beforeState.products, stockBatches: beforeState.stockBatches, stockShipments: beforeState.stockShipments, categories: beforeState.categories, activityLogs: beforeState.activityLogs });
        setBusy(false);
        notify('Auto Complete အတွက် Local Stock Plan မအောင်မြင်ပါ။ Owner Review လုပ်ရန် Refresh ပြီး ပြန်စစ်ပါ။');
        return;
      }
      const afterState = usePosStore.getState();
      const completedShipment = afterState.stockShipments.find((entry) => entry.id === shipment.id);
      if (!completedShipment) {
        usePosStore.setState({ products: beforeState.products, stockBatches: beforeState.stockBatches, stockShipments: beforeState.stockShipments, categories: beforeState.categories, activityLogs: beforeState.activityLogs });
        setBusy(false);
        notify('Auto Complete Shipment Plan ကို မတွေ့ပါ။ Stock ကို မပြောင်းဘဲ ပြန်ထားပါတယ်။');
        return;
      }
      const destinationProductIds = new Set(completedShipment.autoCompletionPlan?.map((entry) => entry.destinationProductId) || []);
      try {
        const result = await commitBranchShipmentAutoCompleteToCloud({
          uid: access.uid,
          shipment: completedShipment,
          beforeProducts: beforeState.products.filter((product) => product.branchId === shipment.toBranchId && destinationProductIds.has(product.id)),
          afterProducts: afterState.products.filter((product) => product.branchId === shipment.toBranchId && destinationProductIds.has(product.id)),
          beforeBatches: beforeState.stockBatches.filter((batch) => batch.branchId === shipment.toBranchId && destinationProductIds.has(batch.productId)),
          afterBatches: afterState.stockBatches.filter((batch) => batch.branchId === shipment.toBranchId && destinationProductIds.has(batch.productId)),
        });
        notify(result.alreadyCommitted
          ? `${shipment.shipmentNo} ကို Cloud မှာ Auto Complete ဖြစ်ပြီးသားဖြစ်ကြောင်း အတည်ပြုပြီးပါပြီ။`
          : `${shipment.shipmentNo} ကို Auto Complete လုပ်ပြီး ${shipment.toBranchName} Stock ထဲ ထည့်ပြီးပါပြီ။`);
      } catch (error) {
        usePosStore.setState({ products: beforeState.products, stockBatches: beforeState.stockBatches, stockShipments: beforeState.stockShipments, categories: beforeState.categories, activityLogs: beforeState.activityLogs });
        if (error instanceof BranchShipmentAutoCompleteUnknownError) {
          notify(error.message);
          setBusy(false);
          return;
        }
        // Safe fallback: retain the normal receipt + Owner review route if the
        // narrowly-scoped auto-complete transaction is rejected by Rules/validation.
        try {
          await submitBranchShipmentReceipt({ branchId: shipment.toBranchId, shipmentId: shipment.id, uid: access.uid, email: actorInfo.email, name: actorInfo.name, receivedItems, note });
          const localApplied = confirmLocal({ shipmentId: shipment.id, receivedItems, actor: actorInfo, note });
          notify(localApplied
            ? `Auto Complete မအောင်မြင်လို့ Owner Review အဖြစ် လက်ခံမှတ်တမ်းတင်ထားပါတယ်။ ${error instanceof Error ? error.message : ''}`
            : 'Cloud မှ လက်ခံမှုသိမ်းပြီးပါပြီ။ ဒီ Device ကို Refresh လုပ်ပြီး ပြန် Sync လုပ်ပါ။');
        } catch (fallbackError) {
          notify(`Auto Complete မအောင်မြင်ပါ။ ${fallbackError instanceof Error ? fallbackError.message : error instanceof Error ? error.message : 'Cloud Error'}`);
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      await submitBranchShipmentReceipt({
        branchId: shipment.toBranchId,
        shipmentId: shipment.id,
        uid: access.uid,
        email: actorInfo.email,
        name: actorInfo.name,
        receivedItems,
        note,
      });
      const localApplied = confirmLocal({ shipmentId: shipment.id, receivedItems, actor: actorInfo, note });
      if (!localApplied) {
        notify('Cloud မှ လက်ခံမှုသိမ်းပြီးပါပြီ။ ဒီ Device ရဲ့ Local Copy ကို ပြန် Sync လုပ်ရန် Refresh လုပ်ပါ။');
        return;
      }
      notify(`${shipment.shipmentNo} ကို Owner Review အတွက် လက်ခံမှတ်တမ်းတင်ပြီးပါပြီ။ ကွာခြားချက်ကို Owner စစ်ဆေးပြီးမှ Stock ဝင်ပါမယ်။`);
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
      <span className={`tag ${shipment.status === 'approved' ? 'tag-success' : shipment.status === 'received' ? 'tag-warn' : 'tag-info'}`}>{shipment.status === 'dispatched' ? 'လက်ခံရန်' : shipment.status === 'received' ? 'Owner Review စောင့်နေ' : shipment.status === 'approved' ? (shipment.completionMode === 'auto' ? 'Auto Complete ပြီး' : 'Owner အတည်ပြုပြီး') : 'ပယ်ဖျက်'}</span>
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
    {shipment.status === 'approved' && <div className="shipment-status-note shipment-success"><CheckCircle2 size={15} /> {shipment.completionMode === 'auto' ? `ပုံမှန်လက်ခံမှုကို ${shipment.approvedByName || shipment.receivedByName || 'Cashier'} က အတည်ပြုပြီး Destination Stock ထဲ အလိုအလျောက်ဝင်သွားပါပြီ။` : `Owner က ${shipment.approvedByName || 'Owner'} မှ အတည်ပြုပြီးပါပြီ။`}</div>}
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
  const ownerReview = branchShipments.filter((entry) => entry.status === 'received').length;

  if (!access.canReceiveStock || access.role !== 'cashier' || !branchId) return <section className="panel empty-state"><PackageCheck size={25} /><strong>Stock Receiver ခွင့် မရှိသေးပါ</strong><p>Owner က Profile → ဝန်ထမ်းအကောင့်မှာ ဒီ Account အတွက် Stock Receiver ခွင့် ဖွင့်ပေးရပါမယ်။</p></section>;

  return <section className="page-stack shipment-management">
    <div className="section-heading"><div><h2>ရောက်လာသော ကုန်စစ်ဆေးရန်</h2><p>အရေအတွက်အပြည့်၊ ပျက်စီးမှုမရှိပါက လက်ခံပြီးတာနဲ့ Auto Complete လုပ်ပါမယ်။ ကွာခြားချက်ရှိမှ Owner Review ပို့ပါမယ်။</p></div><div className="shipment-receiver-counts"><span className="tag tag-info">{pending} ခု လက်ခံရန်</span><span className="tag tag-warn">{ownerReview} ခု Owner Review</span></div></div>
    <div className="shipment-info-banner"><Truck size={18} /><div><strong>Stock Receiver · {branchId}</strong><p>အရေအတွက်အပြည့်ရပြီး ပျက်စီးမှုမရှိပါက လက်ခံပြီးချင်း Cloud ထဲမှာ Stock တိုးပြီး Auto Complete ဖြစ်ပါမယ်။ ကွာခြားချက်ရှိမှ Owner Review ပို့ပါမယ်။</p></div></div>
    {branchShipments.length === 0 ? <div className="panel empty-state"><PackageCheck size={25} /><strong>ပစ္စည်းပို့ထားတာ မရှိသေးပါ</strong><p>Owner က ဒီဆိုင်ခွဲသို့ ပစ္စည်းပို့လိုက်တဲ့အခါ ဒီနေရာမှာ ပေါ်လာပါမယ်။</p></div> : branchShipments.map((shipment) => <ShipmentReceiptCard key={shipment.id} shipment={shipment} notify={notify} />)}
  </section>;
}
