import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, CloudUpload, RefreshCw } from 'lucide-react';
import { flushCashierSaleQueue, getPendingCashierSaleCount, listenForCashierQueue } from '../lib/cashierSalesSync';

type QueueState = 'ready' | 'synced' | 'queued' | 'review' | 'error' | 'rules-error';

export function CashierSalesQueueStatus({ uid, branchId }: { uid: string; branchId: string }) {
  const [pending, setPending] = useState(() => getPendingCashierSaleCount(uid, branchId));
  const [state, setState] = useState<QueueState>('ready');
  const [message, setMessage] = useState('Cashier ရောင်းအားကို Cloud သို့ အလိုအလျောက် Sync လုပ်ပါမယ်။');
  const [busy, setBusy] = useState(false);

  const refreshCount = useCallback(() => {
    setPending(getPendingCashierSaleCount(uid, branchId));
  }, [uid, branchId]);

  useEffect(() => {
    refreshCount();
    const stopQueue = listenForCashierQueue(uid, branchId, refreshCount);
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; branchId?: string; state?: string; message?: string }>).detail;
      if (detail?.uid !== uid || detail.branchId !== branchId) return;
      const next = detail.state === 'synced' ? 'synced'
        : detail.state === 'review' ? 'review'
          : detail.state === 'rules-error' ? 'rules-error'
            : detail.state === 'error' ? 'error' : 'queued';
      setState(next);
      setMessage(detail.message || 'Cashier Sale Sync အခြေအနေ ပြောင်းလဲသွားပါတယ်။');
      refreshCount();
    };
    const onOnline = () => refreshCount();
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
      setPending(result.pending);
      if (result.needsReview > 0) {
        setState('review');
        setMessage(`${result.needsReview} ခုသော အရောင်းမှာ Cloud Stock/Voucher မကိုက်ညီပါ။ Owner စစ်ဆေးရန် လိုအပ်ပါတယ်။`);
      } else if (result.rulesError) {
        setState('rules-error');
        setMessage('Firestore Rules က Cashier Sale ကို ခွင့်မပြုသေးပါ။ Owner က v2.9.8 Rules Publish လုပ်ပြီးမှ ပြန်ကြိုးစားပါ။');
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
      refreshCount();
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
      {pending > 0 && <button className="button button-outline" type="button" onClick={() => void retry()} disabled={busy || !navigator.onLine}>
        <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? 'စစ်ဆေးနေသည်' : 'ပြန်ပို့မည်'}
      </button>}
    </div>
  );
}
