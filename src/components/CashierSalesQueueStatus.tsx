import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, CloudUpload, RefreshCw, XCircle } from 'lucide-react';
import {
  flushCashierSaleQueue,
  listenForCashierQueue,
  readCashierSaleQueue,
  removeCashierSaleFromQueue,
} from '../lib/cashierSalesSync';
import { flushPosStorePersistence, usePosStore } from '../store/usePosStore';

type QueueState = 'ready' | 'synced' | 'queued' | 'review' | 'error' | 'rules-error';

export function CashierSalesQueueStatus({ uid, branchId }: { uid: string; branchId: string }) {
  const [pending, setPending] = useState(0);
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [state, setState] = useState<QueueState>('ready');
  const [message, setMessage] = useState('Cashier ရောင်းအားကို Cloud သို့ အလိုအလျောက် Sync လုပ်ပါမယ်။');
  const [busy, setBusy] = useState(false);
  const voidSale = usePosStore((s) => s.voidSale);

  const refreshCount = useCallback(async () => {
    try {
      const queue = await readCashierSaleQueue(uid, branchId);
      setPending(queue.length);
      setNeedsReviewCount(queue.filter((entry) => entry.needsReview).length);
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Offline Queue ကို ဖတ်မရပါ။ Data ကို မဖျက်ထားပါ။');
    }
  }, [uid, branchId]);

  useEffect(() => {
    void refreshCount();
    const stopQueue = listenForCashierQueue(uid, branchId, () => { void refreshCount(); });
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; branchId?: string; state?: string; message?: string }>).detail;
      if (detail?.uid !== uid || detail.branchId !== branchId) return;
      const next = detail.state === 'synced' ? 'synced'
        : detail.state === 'review' ? 'review'
          : detail.state === 'rules-error' ? 'rules-error'
            : detail.state === 'error' ? 'error' : 'queued';
      setState(next);
      setMessage(detail.message || 'Cashier Sale Sync အခြေအနေ ပြောင်းလဲသွားပါတယ်။');
      void refreshCount();
    };
    const onOnline = () => { void refreshCount(); };
    window.addEventListener('minimart-cashier-sale-status', onStatus);
    window.addEventListener('online', onOnline);
    return () => {
      stopQueue();
      window.removeEventListener('minimart-cashier-sale-status', onStatus);
      window.removeEventListener('online', onOnline);
    };
  }, [uid, branchId, refreshCount]);

  const retry = async () => {
    if (busy || !navigator.onLine || pending === 0) return;
    setBusy(true);
    try {
      const result = await flushCashierSaleQueue(uid, branchId);
      await refreshCount();
      if (result.needsReview > 0) {
        setState('review');
        setMessage(`${result.needsReview} ခုသော အရောင်းမှာ Cloud Stock မလုံလောက်ပါ။ ပယ်ဖျက်ပြီး လက်ရှိ Stock အတိုင်း ပြန်ရောင်းနိုင်ပါတယ်။`);
      } else if (result.rulesError) {
        setState('rules-error');
        setMessage('Firestore Rules က Cashier Sale ကို ခွင့်မပြုသေးပါ။ Owner က Rules အသစ် Publish လုပ်ပြီးမှ ပြန်ကြိုးစားပါ။');
      } else if (result.pending === 0) {
        setState('synced');
        setMessage(result.synced > 0 ? `${result.synced} ခုသော အရောင်းကို Cloud သို့ ပို့ပြီးပါပြီ။` : 'Cloud Queue ရှင်းလင်းပြီးပါပြီ။');
      } else {
        setState('queued');
        setMessage(`${result.pending} ခုသော အရောင်းကို ဒီ Device မှာ ထိန်းထားပါတယ်။ Network ပြန်စစ်ပြီး ထပ်ကြိုးစားပါ။`);
      }
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Cashier Sale Sync မအောင်မြင်ပါ။');
    } finally {
      setBusy(false);
      void refreshCount();
    }
  };

  const cancelStuckSales = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const queue = await readCashierSaleQueue(uid, branchId);
      const stuck = queue.filter((entry) => entry.needsReview);
      if (!stuck.length) return;
      if (!window.confirm(`Cloud Stock မလောက်၍ ပို့မရသော Offline ဘောင်ချာ ${stuck.length} ခု (${stuck.map((e) => e.sale.receiptNo).join(', ')}) ကို ဒီ Device မှ ပယ်ဖျက်ပြီး Stock ပြန်ပေါင်းမလား?`)) return;
      for (const entry of stuck) {
        const voided = voidSale(entry.sale.id, 'Cloud Stock မလုံလောက်၍ Offline Queue မှ ပယ်ဖျက်သည်', {
          uid,
          email: entry.sale.createdByEmail || '',
          name: entry.sale.createdByName || 'Cashier',
        });
        if (!voided) throw new Error(`Voucher ${entry.sale.receiptNo} ကို Local မှ ပယ်ဖျက်မရပါ။`);
        await flushPosStorePersistence();
        await removeCashierSaleFromQueue(uid, branchId, entry.sale.id);
      }
      await refreshCount();
      setState('ready');
      setMessage('စစ်ဆေးပြီး ပယ်ဖျက်ထားသော ဘောင်ချာများကို Queue မှ ဖယ်ရှားပြီး Local Stock ပြန်ညှိထားပါတယ်။');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Offline Queue ကို ပြင်ဆင်မရပါ။');
    } finally {
      setBusy(false);
    }
  };

  const tone = state === 'review' || state === 'error' || state === 'rules-error'
    ? 'danger' : pending > 0 || state === 'queued' ? 'warning' : 'success';
  const Icon = tone === 'danger' ? AlertTriangle : tone === 'warning' ? CloudUpload : state === 'synced' ? CheckCircle2 : Cloud;

  return (
    <div className={`cashier-cloud-sales-state tone-${tone}`} role="status" aria-live="polite">
      <div className="cashier-cloud-sales-icon"><Icon size={16} /></div>
      <div className="cashier-cloud-sales-copy">
        <strong>{pending > 0 ? `Cloud သို့ မပို့ရသေးသော အရောင်း ${pending} ခု` : state === 'synced' ? 'Cashier Cloud Sales ချိတ်ဆက်ပြီး' : 'Cashier Cloud Sales'}</strong>
        <small>{message}</small>
      </div>
      <div className="table-actions">
        {needsReviewCount > 0 && (
          <button className="button button-outline" type="button" onClick={() => void cancelStuckSales()} disabled={busy}>
            <XCircle size={14} /> ပို့မရသောဘောင်ချာ ပယ်ဖျက် ({needsReviewCount})
          </button>
        )}
        {pending > 0 && (
          <button className="button button-outline" type="button" onClick={() => void retry()} disabled={busy || !navigator.onLine}>
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? 'စစ်ဆေးနေသည်' : 'ပြန်ပို့မည်'}
          </button>
        )}
      </div>
    </div>
  );
}
