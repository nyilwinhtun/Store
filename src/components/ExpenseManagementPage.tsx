import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CircleDollarSign, ClipboardList, Download, Plus, Receipt, RotateCw, Trash2, Wallet } from 'lucide-react';
import type { Expense } from '../store/usePosStore';

type ExpenseDraft = Omit<Expense, 'id' | 'branchId'>;
type ExpenseFilter = 'all' | 'submitted';
type Props = {
  expenses: Expense[];
  isCashier: boolean;
  cashierUid: string;
  cashierName: string;
  branchName: string;
  currency: string;
  onSubmit: (draft: ExpenseDraft) => Promise<void>;
  onDelete: (expense: Expense) => void;
  onRetryPending: () => Promise<void>;
  onExport: () => void;
};

const money = (value: number, currency: string) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value || 0))} ${currency}`;
const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const isReviewed = (expense: Expense) => expense.reviewStatus === 'reviewed';
const statusLabel = (expense: Expense) => {
  if (expense.reimbursedBySettlementId) return { label: 'ငွေပြန်အမ်းပြီး', className: 'tag-success' };
  if (expense.cloudSyncStatus === 'pending') return { label: 'Cloud Sync စောင့်နေ', className: 'tag-warn' };
  if (isReviewed(expense)) return { label: 'Owner ကြည့်ရှုပြီး', className: 'tag-success' };
  if (expense.createdByRole === 'cashier' || (!expense.createdByRole && (expense.reviewStatus === 'submitted' || ['pending', 'approved', 'not-required', 'rejected'].includes(expense.approvalStatus || '')))) {
    return { label: 'Owner ဆီ တင်ပြပြီး', className: 'tag-warn' };
  }
  return { label: 'မှတ်တမ်းတင်ပြီး', className: 'tag' };
};

export function ExpenseManagementPage({ expenses, isCashier, cashierUid, cashierName, branchName, currency, onSubmit, onDelete, onRetryPending, onExport }: Props) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('ဆိုင်အသုံးစရိတ်');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'kpay'>('cash');
  const [fundedBy, setFundedBy] = useState<'cashier-personal' | 'branch-cash' | 'branch-kpay'>(isCashier ? 'cashier-personal' : 'branch-cash');
  const [filter, setFilter] = useState<ExpenseFilter>('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => setFundedBy(isCashier ? 'cashier-personal' : 'branch-cash'), [isCashier]);

  const submittedCount = expenses.filter((expense) => (expense.createdByRole === 'cashier' || (!expense.createdByRole && !!expense.createdByUid)) && expense.cloudSyncStatus !== 'pending').length;
  const pendingSyncCount = expenses.filter((expense) => expense.cloudSyncStatus === 'pending').length;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthTotal = expenses.filter((expense) => new Date(expense.date).getTime() >= monthStart.getTime()).reduce((sum, expense) => sum + expense.amount, 0);
  const totalReported = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const shownExpenses = useMemo(() => expenses
    .filter((expense) => filter === 'all' || (filter === 'submitted' ? (expense.createdByRole === 'cashier' || (!expense.createdByRole && !!expense.createdByUid)) : true))
    .sort((a, b) => b.date.localeCompare(a.date)), [expenses, filter]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!title.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0 || !Number.isSafeInteger(numericAmount)) return;
    setSaving(true);
    try {
      const method = fundedBy === 'branch-kpay' ? 'kpay' : fundedBy === 'branch-cash' ? 'cash' : paymentMethod;
      await onSubmit({
        title: title.trim(), category, amount: numericAmount, date: new Date().toISOString(), note: note.trim(),
        paymentMethod: method, fundedBy,
      });
      setTitle(''); setAmount(''); setNote(''); setPaymentMethod('cash'); setFundedBy(isCashier ? 'cashier-personal' : 'branch-cash');
    } finally { setSaving(false); }
  };

  return (
    <section className="page-stack">
      <div className="section-heading">
        <div>
          <h2>{isCashier ? 'မိမိအသုံးစရိတ်' : 'Expense Management'}</h2>
          <p>{isCashier
            ? `${branchName} · အသုံးစရိတ်ကို သုံးစွဲပြီးနောက် Owner ထံ စာရင်းတင်ပြနိုင်ပါတယ်။ Approval စောင့်ရန် မလိုပါ။`
            : 'Cashier များ၏ အသုံးစရိတ်တင်ပြချက်များကို ကြည့်ရှုနိုင်ပါတယ်။ Approve လုပ်မှ သုံးစွဲခွင့်ရမည့်စနစ် မဟုတ်ပါ။'}</p>
        </div>
        <div className="heading-actions"><button className="button button-outline" onClick={onExport}><Download size={15} /> CSV</button></div>
      </div>

      <div className="mini-stats">
        <div className="mini-stat"><span className="mini-stat-icon"><Wallet size={17}/></span><div><small>{isCashier ? 'ဒီလ အသုံးစရိတ်' : 'စာရင်းထဲရှိ စုစုပေါင်းအသုံးစရိတ်'}</small><strong>{money(isCashier ? monthTotal : totalReported, currency)}</strong></div></div>
        <div className="mini-stat"><span className="mini-stat-icon warning"><ClipboardList size={17}/></span><div><small>Cashier တင်ပြထားသောစာရင်း</small><strong>{submittedCount} ခု</strong></div></div>
        <div className="mini-stat"><span className="mini-stat-icon"><CircleDollarSign size={17}/></span><div><small>{isCashier ? 'တင်ပြထားသော မှတ်တမ်း' : 'စာရင်းထဲရှိ မှတ်တမ်း'}</small><strong>{expenses.length} ခု</strong></div></div>
      </div>

      <div className="expense-workspace">
        <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
          <div className="panel-heading"><div className="panel-icon"><CircleDollarSign size={18}/></div><div><h3>အသုံးစရိတ်အသစ်</h3><p>{isCashier ? 'အသုံးစရိတ်ကို သုံးစွဲပြီးနောက် Owner ထံ တင်ပြရန် မှတ်တမ်းတင်ပါ။' : 'ဆိုင်အသုံးစရိတ်ကို မှတ်တမ်းတင်ပါ။'}</p></div></div>
          <label>အသုံးစရိတ်အမည်<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="ဥပမာ - သယ်ယူစရိတ်၊ ရေသန့်ဝယ်" /></label>
          <label>အမျိုးအစား<select value={category} onChange={(event) => setCategory(event.target.value)}><option>ဆိုင်အသုံးစရိတ်</option><option>သယ်ယူပို့ဆောင်ရေး</option><option>မီး/ရေ</option><option>ပြုပြင်ထိန်းသိမ်းရေး</option><option>သန့်ရှင်းရေး</option><option>အစားအသောက်</option><option>အခြား</option></select></label>
          <label>ပမာဏ (MMK)<input required type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
          <label>ငွေကို ဘယ်သူစိုက်/ပေးခဲ့သလဲ<select value={fundedBy} onChange={(event) => setFundedBy(event.target.value as typeof fundedBy)}><option value="cashier-personal">Cashier ကိုယ်ပိုင်ငွေ</option><option value="branch-cash">ဆိုင် Cash</option><option value="branch-kpay">ဆိုင် KPay</option></select></label>
          {fundedBy === 'cashier-personal' && <label>ပေးချေသည့်နည်းလမ်း<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'cash' | 'kpay')}><option value="cash">Cash</option><option value="kpay">KPay</option></select></label>}
          <label>မှတ်ချက်<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="အသေးစိတ် မှတ်ချက်..." /></label>
          {isCashier && <div className="expense-submit-hint">ဒီစာရင်းကို Owner ထံ တင်ပြပါမယ်။ တင်ပြပြီးတာနဲ့ အသုံးစရိတ်သုံးစွဲမှုကို ပိတ်ထားခြင်း မရှိပါ။</div>}
          <button className="button button-primary" type="submit" disabled={saving}><Plus size={16}/>{saving ? 'သိမ်းဆည်းနေသည်…' : isCashier ? 'Owner ထံ အသုံးစရိတ် တင်ပြရန်' : 'အသုံးစရိတ် သိမ်းဆည်းရန်'}</button>
          {isCashier && <small className="field-hint">Internet မရှိချိန်တွင် ဒီ Device ထဲမှာ စောင့်သိမ်းထားပြီး Cloud ပြန်ချိတ်သည့်အခါ Owner ထံ ပို့ပါမယ်။</small>}
        </form>

        <div className="panel expense-record-panel">
          <div className="panel-heading"><div className="panel-icon"><Receipt size={18}/></div><div><h3>Expense Records</h3><p>{isCashier ? 'မိမိတင်ပြထားသော မှတ်တမ်းများ' : 'Cashier နှင့် ဆိုင်အသုံးစရိတ် တင်ပြချက်များ'}</p></div></div>
          <div className="expense-list-toolbar">
            <select value={filter} onChange={(event) => setFilter(event.target.value as ExpenseFilter)}>
              <option value="all">အားလုံး</option><option value="submitted">Cashier တင်ပြချက်များ</option>
            </select>
            {pendingSyncCount > 0 && <button className="button button-outline" type="button" onClick={() => void onRetryPending()}><RotateCw size={14}/> Sync ပြန်စမ်း ({pendingSyncCount})</button>}
          </div>
          {shownExpenses.length === 0 ? <div className="empty-state"><div className="empty-icon"><Wallet size={24}/></div><strong>အသုံးစရိတ် မရှိသေးပါ</strong><p>အသုံးစရိတ်အသစ်ကို Form မှာ ထည့်သွင်းနိုင်ပါတယ်။</p></div> : <div className="expense-list">
            {shownExpenses.map((expense) => {
              const status = statusLabel(expense);
              const ownName = expense.createdByName || (expense.createdByUid === cashierUid ? cashierName : 'ယခင်စာရင်း / Owner');
              return <article className="expense-record-card" key={expense.id}>
                <div className="expense-record-main"><div className="expense-badge"><Receipt size={17}/></div><div className="expense-details"><strong>{expense.title}</strong><small>{expense.category} · {dateLabel(expense.date)}</small><small>{isCashier ? '' : `${ownName} · `}{expense.fundedBy === 'cashier-personal' ? 'Cashier ကိုယ်ပိုင်ငွေ' : expense.fundedBy === 'branch-kpay' ? 'ဆိုင် KPay' : expense.fundedBy === 'branch-cash' ? 'ဆိုင် Cash' : 'ငွေအရင်းအမြစ် မသတ်မှတ်ထား'} · {(expense.paymentMethod || 'cash').toUpperCase()}</small>{expense.note && <small>{expense.note}</small>}</div><div className="expense-record-amount"><strong>{money(expense.amount, currency)}</strong><span className={`tag ${status.className}`}>{status.label}</span></div></div>
                {!isCashier && <div className="expense-record-footer"><small>{expense.createdByUid ? `UID: ${expense.createdByUid}` : 'Legacy Expense'}</small><button className="icon-btn danger-icon" type="button" title="Delete" onClick={() => onDelete(expense)}><Trash2 size={14}/></button></div>}
                {isCashier && expense.cloudSyncStatus === 'pending' && <small className="expense-rejection-note">{expense.cloudSyncError || 'Cloud မရောက်သေးပါ။ Internet ရလျှင် ပြန် Sync လုပ်ပါမယ်။'}</small>}
              </article>;
            })}
          </div>}
        </div>
      </div>
    </section>
  );
}
