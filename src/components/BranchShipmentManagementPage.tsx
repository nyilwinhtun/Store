import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, PackagePlus, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { useBusinessAccess } from '../lib/businessAccess';
import { firebaseAuth } from '../lib/firebase';
import { BRANCH_SHIPMENT_CLOUD_COMMIT_CANCELLED, BRANCH_SHIPMENT_CLOUD_COMMIT_STARTED, commitBranchShipmentToCloud, BranchShipmentCloudCommitUnknownError } from '../lib/branchShipmentCloudCommit';
import { AUTO_SYNC_STATUS_EVENT, readAutoSyncStatus, type AutoSyncStatus } from '../lib/autoSyncStatus';
import { formatQuantity, isValidQuantity, quantityMin, quantityModeForProduct, summarizeQuantities } from '../lib/quantity';
import { usePosStore, type BranchShipmentDraftItem, type BranchStockShipment, type Product, type StockBatch } from '../store/usePosStore';

const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
type DraftLine = { key: string; productId: string; quantity: string };
const newKey = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `line-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function rollbackLocalShipment(beforeProducts: Product[], beforeBatches: StockBatch[], shipment: BranchStockShipment) {
  const productIds = new Set(shipment.items.map((item) => item.sourceProductId));
  const beforeProductById = new Map(beforeProducts.filter((item) => item.branchId === shipment.fromBranchId && productIds.has(item.id)).map((item) => [item.id, item]));
  const current = usePosStore.getState();
  const affectedBatchIds = new Set([
    ...beforeBatches.filter((item) => item.branchId === shipment.fromBranchId && productIds.has(item.productId)).map((item) => item.id),
    ...current.stockBatches.filter((item) => item.branchId === shipment.fromBranchId && productIds.has(item.productId)).map((item) => item.id),
  ]);
  const beforeBatchById = new Map(beforeBatches.filter((item) => affectedBatchIds.has(item.id)).map((item) => [item.id, item]));
  usePosStore.setState((state) => ({
    products: state.products.map((item) => item.branchId === shipment.fromBranchId && beforeProductById.has(item.id) ? beforeProductById.get(item.id)! : item),
    stockBatches: [
      ...state.stockBatches.filter((item) => !affectedBatchIds.has(item.id)),
      ...beforeBatchById.values(),
    ],
    stockShipments: state.stockShipments.filter((item) => item.id !== shipment.id),
    activityLogs: state.activityLogs.filter((item) => item.entityId !== shipment.id),
  }));
}

function shipmentHasException(shipment: BranchStockShipment): boolean {
  if (shipment.status !== 'received') return false;
  return shipment.items.some((item) => {
    const received = shipment.receivedItems?.find((entry) => entry.sourceProductId === item.sourceProductId);
    return !received || received.receivedQuantity !== item.quantity || received.damagedQuantity > 0;
  });
}

function ShipmentStatus({ shipment }: { shipment: BranchStockShipment }) {
  const isException = shipmentHasException(shipment);
  const config = {
    dispatched: { label: 'ပို့ပြီး · လက်ခံရန်', className: 'tag-info' },
    received: isException
      ? { label: 'ကွာခြားချက်ရှိ · Owner Review', className: 'tag-warn' }
      : { label: 'အရေအတွက်ကိုက်ညီ · Stock Commit စောင့်နေ', className: 'tag-info' },
    approved: shipment.completionMode === 'auto'
      ? { label: 'ပုံမှန်လက်ခံ · Auto Complete', className: 'tag-success' }
      : { label: 'Owner အတည်ပြုပြီး · Stock ဝင်ပြီး', className: 'tag-success' },
    cancelled: { label: 'ပယ်ဖျက်ပြီး', className: 'tag-warn' },
  }[shipment.status];
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
      <ShipmentStatus shipment={shipment} />
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
    {shipment.status === 'received' && <div className="shipment-receipt-review"><div><strong>{shipmentHasException(shipment) ? 'Exception စစ်ဆေးရန်' : 'ပုံမှန်လက်ခံမှု · အရေအတွက်ကိုက်ညီ'}</strong><small>လက်ခံသူ: {shipment.receivedByName || shipment.receivedByEmail || 'Receiver'} · {shipment.receivedAt ? dateLabel(shipment.receivedAt) : ''} · {shipment.receiverNote || 'မှတ်ချက်မရှိ'}</small></div><button className="button button-primary" type="button" onClick={() => onApprove(shipment)} disabled={busy}><CheckCircle2 size={15} /> {shipmentHasException(shipment) ? 'Exception အတည်ပြုရန်' : 'Stock ထည့်သွင်းရန်'}</button></div>}
    {shipment.status === 'dispatched' && <div className="shipment-receipt-review"><small>ပစ္စည်းလက်ခံသူက မအတည်ပြုရသေးပါ။ ဒီအခြေအနေမှာ Destination Stock မတိုးသေးပါ။</small><button className="button button-outline" type="button" onClick={() => onCancel(shipment)} disabled={busy}><XCircle size={15} /> ပို့မှု ပယ်ဖျက်ရန်</button></div>}
    {shipment.status === 'approved' && <div className="shipment-status-note shipment-success"><CheckCircle2 size={15} /> {shipment.completionMode === 'auto' ? `လက်ခံသူ ${shipment.approvedByName || shipment.receivedByName || 'Cashier'} က အရေအတွက်အပြည့် အတည်ပြုပြီး ${shipment.toBranchName} Stock ထဲ အလိုအလျောက်ဝင်သွားပါပြီ။` : `Owner အတည်ပြုပြီး ${shipment.toBranchName} Branch Stock ထဲ ထည့်သွင်းပြီးပါပြီ။ Approved by ${shipment.approvedByName || 'Owner'}.`}</div>}
    {shipment.status === 'cancelled' && <div className="shipment-status-note"><XCircle size={15} /> ပယ်ဖျက်ထားသည်။ {shipment.cancellationNote || ''}</div>}
  </article>;
}

export function BranchShipmentManagementPage({ authorize, notify }: { authorize: (action: string) => boolean; notify: (message: string) => void }) {
  const access = useBusinessAccess();
  const branches = usePosStore((state) => state.branches);
  const products = usePosStore((state) => state.products);
  const stockBatches = usePosStore((state) => state.stockBatches);
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
  const [shipmentCommitUncertain, setShipmentCommitUncertain] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : false);
  const requestId = useRef(newKey());
  const [cloudStatus, setCloudStatus] = useState<AutoSyncStatus>(() => access.uid ? readAutoSyncStatus(access.uid) : { state: 'idle', message: 'Firebase Owner Account Login လိုအပ်ပါတယ်။' });
  const isFirebaseOwner = access.status === 'active' && access.role === 'owner' && !!access.uid && firebaseAuth?.currentUser?.uid === access.uid;
  // The shipment is committed by a dedicated Firestore transaction. Do not gate
  // dispatch on the app-wide Auto Sync badge; that badge may still be bootstrapping.
  const cloudReady = isFirebaseOwner && isOnline && !shipmentCommitUncertain;

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!access.uid) {
      setCloudStatus({ state: 'idle', message: 'Firebase Owner Account Login လိုအပ်ပါတယ်။' });
      return;
    }
    const refresh = (event?: Event) => {
      if (event) {
        const detail = (event as CustomEvent<{ uid?: string; status?: AutoSyncStatus }>).detail;
        if (detail?.uid && detail.uid !== access.uid) return;
      }
      setCloudStatus(readAutoSyncStatus(access.uid));
    };
    refresh();
    window.addEventListener(AUTO_SYNC_STATUS_EVENT, refresh);
    const onStorage = (event: StorageEvent) => { if (event.key?.includes(access.uid)) refresh(); };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(AUTO_SYNC_STATUS_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [access.uid]);

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
  const currentDate = new Date();
  const currentDay = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
  const batchAvailabilityByProduct = useMemo(() => {
    const result = new Map<string, { tracked: number; valid: number; expired: number; untracked: number; available: number; mismatch: boolean }>();
    for (const product of sourceProducts) {
      const productBatches: StockBatch[] = stockBatches.filter((batch) => batch.branchId === sourceBranchId && batch.productId === product.id && Number(batch.quantity) > 0);
      const tracked = productBatches.reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
      const valid = productBatches.filter((batch) => {
        const expiry = String(batch.expiryDate || '').trim().slice(0, 10);
        return !expiry || expiry >= currentDay;
      }).reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
      const expired = Math.max(0, tracked - valid);
      const untracked = Math.max(0, Number(product.stock) - tracked);
      const available = Math.max(0, Math.min(Number(product.stock) || 0, valid + untracked));
      result.set(product.id, { tracked, valid, expired, untracked, available, mismatch: tracked > Number(product.stock) + 0.000001 });
    }
    return result;
  }, [sourceProducts, stockBatches, sourceBranchId, currentDay]);
  const chosenIds = new Set(lines.map((line) => line.productId).filter(Boolean));

  const updateLine = (key: string, changes: Partial<Pick<DraftLine, 'productId' | 'quantity'>>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line));
  const addLine = () => setLines((current) => current.length >= 50 ? current : [...current, { key: newKey(), productId: '', quantity: '1' }]);
  const removeLine = (key: string) => setLines((current) => current.length <= 1 ? [{ key: newKey(), productId: '', quantity: '1' }] : current.filter((line) => line.key !== key));

  const dispatch = async () => {
    if (busy || !sourceBranch || !destinationBranch) return;
    // A Firebase transaction below writes Source Stock, Batch changes, and the
    // Destination Shipment atomically before the UI reports dispatch success.
    if (!isFirebaseOwner || !firebaseAuth?.currentUser || firebaseAuth.currentUser.uid !== access.uid) {
      notify('ပစ္စည်းမပို့ရသေးပါ။ Profile → Firebase Business Account မှ Owner Account နဲ့ Login ဝင်ပါ။ Local mode မှာ ပို့လို့မရပါ။');
      return;
    }
    if (!navigator.onLine) {
      notify('Internet မရှိပါ။ Offline အခြေအနေမှာ Branch Shipment ပို့လို့မရပါ။ Internet ပြန်ချိတ်ပြီး ထပ်စမ်းပါ။');
      return;
    }
    if (shipmentCommitUncertain) {
      notify('ယခင် Shipment ရဲ့ Cloud အတည်ပြုချက် မသေချာသေးပါ။ Shipment History ကို အရင်စစ်ပြီး Page ကို Refresh လုပ်ပါ။ ထပ်မပို့ပါနှင့်။');
      return;
    }
    if (!authorize('ဆိုင်ခွဲသို့ ပစ္စည်းအများအပြား ပို့ရန်')) return;
    const inputItems: BranchShipmentDraftItem[] = [];
    const batchMismatchWarnings: string[] = [];
    const used = new Set<string>();
    for (const line of lines) {
      if (!line.productId) continue;
      if (used.has(line.productId)) { notify('ပစ္စည်းတစ်မျိုးကို စာရင်းထဲ ထပ်မထည့်ပါနဲ့။'); return; }
      used.add(line.productId);
      const product = sourceProducts.find((entry) => entry.id === line.productId);
      const quantity = Number(line.quantity);
      if (!product || !isValidQuantity(quantity, quantityModeForProduct(product)) || quantity <= 0 || quantity > product.stock) {
        notify(`${product?.name || 'ပစ္စည်း'} ရဲ့ ပို့မည့်အရေအတွက်ကို ပြန်စစ်ပါ။ လက်ရှိ Stock ထက် ပိုပို့လို့မရပါ။`);
        return;
      }
      const availability = batchAvailabilityByProduct.get(product.id) || { tracked: 0, valid: 0, expired: 0, untracked: product.stock, available: product.stock, mismatch: false };
      if (quantity > availability.available + 0.000001) {
        notify(`${product.name}: Batch သို့မဟုတ် သက်တမ်းစာရင်းကြောင့် ဒီပစ္စည်းကို ယခု ပို့မရသေးပါ။ Stock Batch ကို စစ်ဆေးပါ။`);
        return;
      }
      if (availability.mismatch) batchMismatchWarnings.push(product.name);
      inputItems.push({ sourceProductId: product.id, quantity });
    }
    if (inputItems.length === 0) { notify('ပို့မည့်ပစ္စည်း အနည်းဆုံးတစ်မျိုး ရွေးပါ။'); return; }
    if (batchMismatchWarnings.length && !window.confirm(`အောက်ပါပစ္စည်းများ၏ Batch စာရင်းကို Product Stock နဲ့ တိုက်စစ်ရန် လိုအပ်ပါတယ်။\n${batchMismatchWarnings.join('\n')}\n\nမပိုပို့နိုင်အောင် System က ကန့်သတ်ထားပါတယ်။ Audit မှတ်တမ်းတင်ပြီး ဆက်လုပ်မလား?`)) return;
    if (!window.confirm(`${sourceBranch.name} မှ ${destinationBranch.name} သို့ ပစ္စည်း ${inputItems.length} မျိုး ပို့မလား?\n\nပို့ပြီးတာနဲ့ Source Stock လျှော့ပါမယ်။ Destination Stock က Receiver လက်ခံမှု အပြည့်ဖြစ်မှ Auto Complete ဖြစ်မယ်။ ကွာခြားချက်ရှိမှ Owner Review လုပ်ပါမယ်။`)) return;

    setBusy(true);
    const beforeState = usePosStore.getState();
    window.dispatchEvent(new CustomEvent(BRANCH_SHIPMENT_CLOUD_COMMIT_STARTED, { detail: { uid: access.uid } }));
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
      if (!shipment.ok) {
        window.dispatchEvent(new CustomEvent(BRANCH_SHIPMENT_CLOUD_COMMIT_CANCELLED, { detail: { uid: access.uid } }));
        notify(shipment.reason);
        return;
      }
      const savedShipment = shipment.shipment;
      const afterState = usePosStore.getState();
      try {
        const result = await commitBranchShipmentToCloud({
          uid: access.uid || '',
          shipment: savedShipment,
          beforeProducts: beforeState.products,
          afterProducts: afterState.products,
          beforeBatches: beforeState.stockBatches,
          afterBatches: afterState.stockBatches,
          activityLogs: afterState.activityLogs.filter((entry) => entry.entityId === savedShipment.id),
        });
        requestId.current = newKey();
        setLines([{ key: newKey(), productId: '', quantity: '1' }]);
        setNote('');
        notify(result.alreadyCommitted
          ? `${savedShipment.shipmentNo} ကို Firebase မှာ ရှိပြီးသားဖြစ်ကြောင်း အတည်ပြုပြီးပါပြီ။ ${destinationBranch.name} Cashier က လက်ခံနိုင်ပါပြီ။`
          : `${savedShipment.shipmentNo} ကို Firebase Cloud မှာ အတည်ပြုသိမ်းပြီးပါပြီ။ ${destinationBranch.name} Cashier က လက်ခံနိုင်ပါပြီ။`);
      } catch (cloudError) {
        if (cloudError instanceof BranchShipmentCloudCommitUnknownError) {
          // Do not leave an unverified local dispatch in the persistent store.
          // If the server did commit, the Owner listener will pull the committed
          // Source Stock + Shipment; if it did not, local data stays unchanged.
          rollbackLocalShipment(beforeState.products, beforeState.stockBatches, savedShipment);
          window.dispatchEvent(new CustomEvent(BRANCH_SHIPMENT_CLOUD_COMMIT_CANCELLED, { detail: { uid: access.uid } }));
          setShipmentCommitUncertain(true);
          notify(cloudError.message);
          return;
        }
        rollbackLocalShipment(beforeState.products, beforeState.stockBatches, savedShipment);
        window.dispatchEvent(new CustomEvent(BRANCH_SHIPMENT_CLOUD_COMMIT_CANCELLED, { detail: { uid: access.uid } }));
        const message = cloudError instanceof Error ? cloudError.message : 'Firebase Cloud သိမ်းဆည်းမှု မအောင်မြင်ပါ။';
        notify(`ပစ္စည်း မပို့ရသေးပါ။ Local Stock ကို မူလအတိုင်း ပြန်ထားပါတယ်။ ${message}`);
      }
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
  const awaitingReceiptCount = sortedShipments.filter((shipment) => shipment.status === 'dispatched').length;
  const matchedReceiptCount = sortedShipments.filter((shipment) => shipment.status === 'received' && !shipmentHasException(shipment)).length;
  const exceptionCount = sortedShipments.filter((shipment) => shipment.status === 'received' && shipmentHasException(shipment)).length;
  return <section className="page-stack shipment-management">
    <div className="section-heading"><div><h2>Central Inventory · Branch Receiving</h2><p>Owner က ပစ္စည်းနဲ့ ဈေးနှုန်းသတ်မှတ်ပြီး ဆိုင်ခွဲသို့ စာရင်းလိုက် ပို့နိုင်ပါတယ်။</p></div><span className="tag tag-success">Owner Only</span></div>
    <div className="shipment-info-banner"><PackagePlus size={19} /><div><strong>ပစ္စည်းပို့ခြင်းနှင့် လက်ခံခြင်း</strong><p>ပို့ပြီးချိန် Source Stock လျှော့မယ်။ Receiver က အမှန်တကယ်ရောက်ရှိမှုကို မှတ်တမ်းတင်မယ်။ အရေအတွက်ကိုက်ညီမှုနဲ့ Exception ကို သီးခြားခွဲပြမယ်။ လက်ရှိ Cloud Commit စည်းမျဉ်းအရ Destination Stock ထည့်သွင်းမှုမှာ Owner Commit ကို ဆက်လက်လိုအပ်နေသေးပါတယ်။</p></div></div>

    <div className="shipment-quick-stats">
      <div className="shipment-quick-stat"><small>လက်ခံရန်ကျန်</small><strong>{awaitingReceiptCount}</strong></div>
      <div className="shipment-quick-stat"><small>အရေအတွက်ကိုက်ညီ</small><strong>{matchedReceiptCount}</strong></div>
      <div className="shipment-quick-stat shipment-quick-stat-warning"><small>Owner Review လိုအပ်</small><strong>{exceptionCount}</strong></div>
    </div>

    <div className="panel form-panel shipment-form">
      <div className="panel-heading"><div className="panel-icon"><Send size={18} /></div><div><h3>ပစ္စည်းအများအပြား ပို့ရန်</h3><p>Shipment တစ်ခုထဲမှာ ပစ္စည်း ၅၀ မျိုးအထိ ထည့်နိုင်ပါတယ်။ Product/Barcode/ဈေးနှုန်းကို Source Branch ကနေ Snapshot ယူပါမယ်။</p></div></div>
      <div className={`shipment-cloud-gate ${cloudReady ? 'shipment-cloud-ready' : 'shipment-cloud-blocked'}`} role="status">
        {shipmentCommitUncertain
          ? <><strong>ယခင် Shipment Cloud အတည်ပြုချက် မသေချာသေးပါ။</strong><p>Duplicate ကုန်ပို့မှု မဖြစ်စေရန် ပို့ခလုတ်ကို ခေတ္တပိတ်ထားပါတယ်။ Shipment History ကို စစ်ဆေးပြီး Page ကို Refresh လုပ်ပါ။</p></>
          : !isFirebaseOwner ? <><strong>Firebase Owner Session ကို အတည်မပြုနိုင်သေးပါ။</strong><p>Profile → Firebase Business Account မှ Owner Account နဲ့ ပြန်ဝင်ပါ။ Owner Business Access UID နဲ့ Firebase Authentication UID တူညီရပါမယ်။ ပို့ရန်ခလုတ်ကိုနှိပ်လျှင် လိုအပ်တဲ့အချက်ကို ပြသပေးပါမယ်။</p></>
            : !isOnline ? <><strong>Internet ချိတ်ဆက်မှု မရှိပါ။</strong><p>Offline အခြေအနေမှာ Shipment Dispatch မလုပ်နိုင်ပါ။ Internet ပြန်ချိတ်ပါ။</p></>
              : <><strong>Firebase Owner Account ချိတ်ဆက်ထားပါတယ်။</strong><p>ပို့မည့် Product၊ Source Stock၊ Batch နဲ့ Shipment ကို Firebase Server Transaction ဖြင့် တစ်ပြိုင်နက် အတည်ပြုပြီးမှ ပို့မှုအောင်မြင်ကြောင်း ပြပါမယ်။ App-wide Auto Sync ({cloudStatus.state}) က ပို့ခလုတ်ကို မပိတ်တော့ပါ။</p></>}
      </div>
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
            <label className="shipment-product-select">ပစ္စည်း<select value={line.productId} onChange={(event) => updateLine(line.key, { productId: event.target.value })}><option value="">ပစ္စည်းရွေးပါ</option>{sourceProducts.filter((entry) => !chosenIds.has(entry.id) || entry.id === line.productId).map((entry: Product) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            <label className="shipment-qty-select">ပို့မည့်အရေအတွက်<input type="number" min={product ? quantityMin(quantityModeForProduct(product)) : '1'} step={product ? quantityMin(quantityModeForProduct(product)) : '1'} value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
            <button className="small-action small-action-danger" type="button" title="ဒီစာကြောင်းဖယ်ရန်" onClick={() => removeLine(line.key)} disabled={busy}><Trash2 size={14} /></button>
            {product && <div className="shipment-price-snapshot"><strong>လက်ရှိ Stock: {formatQuantity(product.stock, quantityModeForProduct(product))} {product.unit || 'ခု'}</strong><span>SKU: {product.sku || '—'}</span><span>Barcode: {product.barcode || '—'}</span><span>အရင်း {product.costPrice.toLocaleString('en-US')}</span><span>လက်လီ {product.retailPrice.toLocaleString('en-US')}</span><span>လက်ကား {product.wholesalePrice.toLocaleString('en-US')}</span></div>}
          </div>;
        })}
      </div>
      <label>ပို့ဆောင်မှတ်ချက်<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ကားနံပါတ်၊ ပို့ဆောင်သူ၊ အခြားမှတ်ချက်..." /></label>
      <div className="shipment-form-footer"><small>လက်ရှိ Stock အရေအတွက်ကိုသာ ပြထားပါတယ်။ ပို့နိုင်သည့်အရေအတွက်နဲ့ ပို့ပြီးနောက် လက်ကျန်ကို Form မှာ မပြပါ။ အတွင်းပိုင်းမှာ Stock/Batch ကို စစ်ဆေးပြီး Firebase Transaction အောင်မြင်မှ Source Stock လျှော့မည်။ Destination Stock က Cashier လက်ခံပြီး Owner Approve လုပ်မှသာ တိုးမည်။</small><button className="button button-primary" type="button" onClick={dispatch} disabled={busy || !sourceBranch || !destinationBranch || lines.every((line) => !line.productId)}><Send size={16} /> {busy ? 'Cloud မှာ သိမ်းနေသည်...' : 'ပစ္စည်းစာရင်း ပို့မယ်'}</button></div>
    </div>

    <div className="section-heading shipment-history-heading"><div><h2>ပို့ဆောင်မှု / လက်ခံမှု မှတ်တမ်း</h2><p>{sortedShipments.length} shipments · Owner က လက်ခံမှုကို စစ်ဆေးအတည်ပြုနိုင်ပါတယ်။</p></div></div>
    {sortedShipments.length === 0 ? <div className="panel empty-state"><ClipboardList size={24} /><strong>ကုန်ပို့စာရင်း မရှိသေးပါ</strong><p>Branch တစ်ခုထက်ပိုရှိလာပါက ပစ္စည်းစာရင်းကို အပေါ်က Form မှာ ဖန်တီးနိုင်ပါတယ်။</p></div> : sortedShipments.map((shipment) => <ShipmentHistoryCard key={shipment.id} shipment={shipment} onApprove={approve} onCancel={cancel} busy={busy} />)}
  </section>;
}
