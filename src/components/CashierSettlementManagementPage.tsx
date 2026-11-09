import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Banknote, Briefcase, CalendarDays, CheckCircle2, CreditCard, Download, Gift, Receipt, Wallet } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { FIREBASE_BUSINESS_ID, firestore } from '../lib/firebase';
import { useBusinessAccess } from '../lib/businessAccess';
import { recordFirestoreActivity } from '../lib/firestoreDiagnostics';
import type { Expense } from '../store/usePosStore';
import type { CashierSettlementCreateInput, CashierSettlementPurpose, CashierSettlementRecord } from '../types/finance';

type CashierOption = { uid: string; displayName: string; email: string; branchIds: string[] };
type Props = {
  settlements: CashierSettlementRecord[];
  expenses: Expense[];
  branchId: string;
  branchName: string;
  currency: string;
  isCashier: boolean;
  cashierUid: string;
  cashierName: string;
  branchKpayAccountName?: string;
  branchKpayAccountNumber?: string;
  onCreate: (input: CashierSettlementCreateInput) => Promise<void>;
};

const money = (value: number, currency: string) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value || 0))} ${currency}`;
const dateLabel = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'ရက်စွဲ မမှတ်တမ်းတင်ထားပါ';
const settlementDate = (entry: CashierSettlementRecord) => entry.paidAt || entry.createdAt || '';
const purposeLabel: Record<CashierSettlementPurpose, string> = {
  expense_reimbursement: 'ကိုယ်ပိုင်စိုက်ထားသော Expense ပြန်အမ်းခြင်း',
  cash_advance: 'ကြိုတင်ငွေထုတ်ပေးခြင်း',
  salary: 'လစာပေးချေခြင်း',
  other: 'အခြားငွေပေးချေမှု',
};
const purposeIcon = (purpose: CashierSettlementPurpose) => purpose === 'salary' ? <Briefcase size={17} /> : purpose === 'cash_advance' ? <Wallet size={17} /> : purpose === 'expense_reimbursement' ? <Receipt size={17} /> : <Gift size={17} />;
const csvDownload = (rows: unknown[][]) => {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `minimart-cashier-settlements-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function CashierSettlementManagementPage({ settlements, expenses, branchId, branchName, currency, isCashier, cashierUid, cashierName, branchKpayAccountName = '', branchKpayAccountNumber = '', onCreate }: Props) {
  const access = useBusinessAccess();
  const [members, setMembers] = useState<CashierOption[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [selectedCashierUid, setSelectedCashierUid] = useState('');
  const [purpose, setPurpose] = useState<CashierSettlementPurpose>('expense_reimbursement');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'kpay'>('kpay');
  const [amount, setAmount] = useState('');
  const [relatedExpenseId, setRelatedExpenseId] = useState('');
  const [receiverAccountName, setReceiverAccountName] = useState('');
  const [receiverAccountNumber, setReceiverAccountNumber] = useState('');
  const [senderAccountName, setSenderAccountName] = useState(branchKpayAccountName);
  const [senderAccountNumber, setSenderAccountNumber] = useState(branchKpayAccountNumber);
  useEffect(() => { setSenderAccountName(branchKpayAccountName); setSenderAccountNumber(branchKpayAccountNumber); }, [branchKpayAccountName, branchKpayAccountNumber]);
  const [transactionReference, setTransactionReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState<'all' | 'cash' | 'kpay'>('all');

  useEffect(() => {
    if (isCashier || access.status !== 'active' || access.role !== 'owner' || !firestore) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    setMembersLoading(true); setMemberError('');
    void getDocs(collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members')).then((snapshot) => {
      if (cancelled) return;
      recordFirestoreActivity(access.uid, 'read', 'cashier-settlement-members', snapshot.metadata.fromCache ? 0 : snapshot.size);
      const rows = snapshot.docs.map((entry) => {
        const data = entry.data();
        return {
          uid: entry.id,
          displayName: typeof data.displayName === 'string' ? data.displayName : '',
          email: typeof data.email === 'string' ? data.email : '',
          role: data.role,
          status: data.status,
          branchIds: Array.isArray(data.branchIds) ? data.branchIds.filter((value): value is string => typeof value === 'string') : [],
        };
      }).filter((entry) => entry.role === 'cashier' && entry.status === 'active' && entry.branchIds.includes(branchId))
        .map(({ uid, displayName, email, branchIds }) => ({ uid, displayName: displayName || email || uid, email, branchIds } as CashierOption))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      setMembers(rows);
      setSelectedCashierUid((current) => rows.some((row) => row.uid === current) ? current : rows[0]?.uid || '');
    }).catch((reason: unknown) => {
      if (cancelled) return;
      const code = typeof reason === 'object' && reason && 'code' in reason ? String((reason as { code: unknown }).code) : '';
      setMemberError(code === 'permission-denied' ? 'Owner သည် Cashier Member စာရင်းကို ဖတ်ခွင့်မရပါ။ Firestore Rules ကို စစ်ဆေးပါ။' : reason instanceof Error ? reason.message : 'Cashier စာရင်း ဖတ်မရပါ။');
    }).finally(() => { if (!cancelled) setMembersLoading(false); });
    return () => { cancelled = true; };
  }, [isCashier, access.status, access.role, access.uid, branchId]);

  const eligibleExpenses = useMemo(() => expenses.filter((expense) =>
    expense.branchId === branchId
    && expense.createdByUid === selectedCashierUid
    && expense.fundedBy === 'cashier-personal'
    && expense.approvalStatus !== 'pending' && expense.approvalStatus !== 'rejected'
    && !expense.reimbursedBySettlementId
    && !settlements.some((entry) => entry.relatedExpenseId === expense.id && entry.status === 'paid')
  ).sort((a, b) => b.date.localeCompare(a.date)), [expenses, branchId, selectedCashierUid, settlements]);
  const selectedExpense = eligibleExpenses.find((expense) => expense.id === relatedExpenseId);
  const scopedSettlements = useMemo(() => isCashier ? settlements.filter((entry) => entry.cashierUid === cashierUid) : settlements, [settlements, isCashier, cashierUid]);
  const filteredSettlements = useMemo(() => scopedSettlements
    .filter((entry) => entry.status === 'paid')
    .filter((entry) => filter === 'all' || entry.paymentMethod === filter)
    .sort((a, b) => settlementDate(b).localeCompare(settlementDate(a))), [scopedSettlements, filter]);
  const thisMonthStart = new Date(); thisMonthStart.setDate(1); thisMonthStart.setHours(0, 0, 0, 0);
  const monthSettlements = scopedSettlements.filter((entry) => { const timestamp = Date.parse(settlementDate(entry)); return Number.isFinite(timestamp) && timestamp >= thisMonthStart.getTime(); });
  const monthTotal = monthSettlements.reduce((sum, entry) => sum + entry.amount, 0);
  const cashTotal = monthSettlements.filter((entry) => entry.paymentMethod === 'cash').reduce((sum, entry) => sum + entry.amount, 0);
  const kpayTotal = monthSettlements.filter((entry) => entry.paymentMethod === 'kpay').reduce((sum, entry) => sum + entry.amount, 0);

  const changePurpose = (value: CashierSettlementPurpose) => {
    setPurpose(value); setRelatedExpenseId(''); setAmount('');
  };
  const exportRows = () => csvDownload([
    ['Date', 'Branch', 'Cashier', 'Purpose', 'Amount', 'Method', 'Receiver Account', 'Sender Account', 'Transaction Reference', 'Related Expense', 'Note'],
    ...filteredSettlements.map((entry) => [entry.paidAt, branchName, entry.cashierName, purposeLabel[entry.purpose], entry.amount, entry.paymentMethod, `${entry.receiverAccountName || ''} ${entry.receiverAccountNumber || ''}`.trim(), `${entry.senderAccountName || ''} ${entry.senderAccountNumber || ''}`.trim(), entry.transactionReference || '', entry.relatedExpenseId || '', entry.note || '']),
  ]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setSuccess('');
    const numericAmount = Number(amount);
    if (!selectedCashierUid || !members.some((member) => member.uid === selectedCashierUid)) { setError('ဒီ Branch အတွက် Active Cashier တစ်ယောက်ကို ရွေးပါ။'); return; }
    if (!Number.isSafeInteger(numericAmount) || numericAmount <= 0) { setError('ငွေပမာဏကို အပေါင်း ပြည့်ကိန်းဖြင့် ထည့်ပါ။'); return; }
    if (purpose === 'expense_reimbursement' && (!selectedExpense || numericAmount !== selectedExpense.amount)) { setError('ပြန်အမ်းမည့် ကိုယ်ပိုင် Expense ကို ရွေးပြီး ပမာဏ အပြည့်ဖြည့်ပါ။'); return; }
    if (paymentMethod === 'kpay' && (!receiverAccountName.trim() || !receiverAccountNumber.trim() || !transactionReference.trim())) {
      setError('KPay ငွေလွှဲအတွက် လက်ခံသူအမည်၊ Account ဖုန်းနံပါတ်နဲ့ Transaction ID ဖြည့်ပါ။'); return;
    }
    if (paymentMethod === 'kpay' && settlements.some((entry) => entry.paymentMethod === 'kpay' && entry.status === 'paid'
      && entry.transactionReference?.trim().toLowerCase() === transactionReference.trim().toLowerCase())) {
      setError('ဒီ KPay Transaction ID ကို အရင်က မှတ်တမ်းတင်ပြီးသားဖြစ်ပါတယ်။ Transaction ID ကို ပြန်စစ်ပါ။'); return;
    }
    const recipient = members.find((member) => member.uid === selectedCashierUid)!;
    const promptText = `${recipient.displayName} ထံ ${money(numericAmount, currency)} ကို ${paymentMethod.toUpperCase()} ဖြင့် အမှန်တကယ် ပေးချေ/လွှဲပြီးပြီလား။\n\nဒီမှတ်တမ်းကို “ပေးချေပြီး” အဖြစ် သိမ်းပြီး Cashier ဆီ ပြသပါမယ်။`;
    if (!window.confirm(promptText)) return;
    setBusy(true);
    try {
      await onCreate({
        cashierUid: recipient.uid,
        cashierName: recipient.displayName,
        purpose,
        amount: numericAmount,
        paymentMethod,
        ...(receiverAccountName.trim() ? { receiverAccountName: receiverAccountName.trim() } : {}),
        ...(receiverAccountNumber.trim() ? { receiverAccountNumber: receiverAccountNumber.trim() } : {}),
        ...(senderAccountName.trim() ? { senderAccountName: senderAccountName.trim() } : {}),
        ...(senderAccountNumber.trim() ? { senderAccountNumber: senderAccountNumber.trim() } : {}),
        ...(transactionReference.trim() ? { transactionReference: transactionReference.trim() } : {}),
        ...(purpose === 'expense_reimbursement' && selectedExpense ? { relatedExpenseId: selectedExpense.id } : {}),
        note: note.trim(),
      });
      setSuccess('ငွေရှင်းမှတ်တမ်း သိမ်းပြီးပါပြီ။ Owner Cloud Sync ပြီးလျှင် သက်ဆိုင်ရာ Cashier ဆီ ပေါ်လာပါမယ်။');
      setAmount(''); setRelatedExpenseId(''); setReceiverAccountName(''); setReceiverAccountNumber('');
      setSenderAccountName(''); setSenderAccountNumber(''); setTransactionReference(''); setNote('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ငွေရှင်းမှတ်တမ်း မသိမ်းနိုင်ပါ။');
    } finally { setBusy(false); }
  };

  if (isCashier) {
    return <section className="page-stack">
      <div className="section-heading"><div><h2>မိမိငွေလက်ခံမှတ်တမ်း</h2><p>{cashierName} · {branchName} · Owner က Cash သို့မဟုတ် KPay နဲ့ ပေးချေပြီး မှတ်တမ်းတင်ထားသော ငွေစာရင်းများ။</p></div><button className="button button-outline" type="button" onClick={exportRows}><Download size={15}/> CSV</button></div>
      <div className="mini-stats">
        <div className="mini-stat"><span className="mini-stat-icon"><Wallet size={17}/></span><div><small>ဒီလ လက်ခံရရှိငွေ</small><strong>{money(monthTotal, currency)}</strong></div></div>
        <div className="mini-stat"><span className="mini-stat-icon"><Banknote size={17}/></span><div><small>Cash</small><strong>{money(cashTotal, currency)}</strong></div></div>
        <div className="mini-stat"><span className="mini-stat-icon"><CreditCard size={17}/></span><div><small>KPay</small><strong>{money(kpayTotal, currency)}</strong></div></div>
      </div>
      <div className="panel">
        <div className="panel-heading"><div><h3>ငွေလက်ခံမှတ်တမ်း</h3><p>Owner က ပေးချေပြီး မှတ်တမ်းတင်ထားသော စာရင်းများသာ ပြပါမယ်။</p></div><span className="subtle-count">{scopedSettlements.length} records</span></div>
        {filteredSettlements.length === 0 ? <div className="empty-state"><div className="empty-icon"><Wallet size={24}/></div><strong>ငွေလက်ခံမှတ်တမ်း မရှိသေးပါ</strong><p>Owner က ငွေရှင်းပြီး မှတ်တမ်းတင်သည့်အခါ ဒီနေရာမှာ ပေါ်လာပါမယ်။</p></div> : <div className="settlement-list">{filteredSettlements.map((entry) => <article className="settlement-card" key={entry.id}>
          <div className="settlement-icon">{purposeIcon(entry.purpose)}</div><div className="settlement-main"><strong>{purposeLabel[entry.purpose]}</strong><small>{dateLabel(settlementDate(entry))} · {entry.paymentMethod.toUpperCase()}</small>{entry.transactionReference && <small>Transaction ID: {entry.transactionReference}</small>}{entry.receiverAccountName && <small>လက်ခံသူ: {entry.receiverAccountName} · {entry.receiverAccountNumber}</small>}{entry.senderAccountName && <small>ပေးချေသူ: {entry.senderAccountName} · {entry.senderAccountNumber || ''}</small>}{entry.note && <small>{entry.note}</small>}</div><div className="settlement-amount"><strong>{money(entry.amount, currency)}</strong><span className="tag tag-success">ပေးချေပြီး</span></div>
        </article>)}</div>}
      </div>
      <div className="panel security-note"><CheckCircle2 size={18}/><div><strong>အချက်အလက် လုံခြုံရေး</strong><p>ဒီစာမျက်နှာမှာ မိမိ UID နဲ့ သက်ဆိုင်တဲ့ ငွေရှင်းမှတ်တမ်းတွေကိုသာ Cloud မှ ဖတ်ရှုနိုင်ပါတယ်။ အခြား Cashier ရဲ့ ငွေစာရင်းကို မမြင်နိုင်ပါ။</p></div></div>
    </section>;
  }

  return <section className="page-stack">
    <div className="section-heading"><div><h2>Cashier KPay & Cash Settlement</h2><p>{branchName} · Cashier တွေကို ငွေရှင်းပေးပြီး မှတ်တမ်းတင်ရန်။</p></div><button className="button button-outline" type="button" onClick={exportRows}><Download size={15}/> CSV Export</button></div>
    <div className="mini-stats">
      <div className="mini-stat"><span className="mini-stat-icon"><Wallet size={17}/></span><div><small>ဒီလ စုစုပေါင်းငွေရှင်း</small><strong>{money(monthTotal, currency)}</strong></div></div>
      <div className="mini-stat"><span className="mini-stat-icon"><Banknote size={17}/></span><div><small>Cash ပေးချေမှု</small><strong>{money(cashTotal, currency)}</strong></div></div>
      <div className="mini-stat"><span className="mini-stat-icon"><CreditCard size={17}/></span><div><small>KPay ပေးချေမှု</small><strong>{money(kpayTotal, currency)}</strong></div></div>
    </div>
    <div className="settlement-workspace">
      <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
        <div className="panel-heading"><div className="panel-icon"><CreditCard size={18}/></div><div><h3>Cashier ထံ ငွေရှင်းမှတ်တမ်း အသစ်</h3><p>ငွေကို အမှန်တကယ် ပေးချေပြီးမှ မှတ်တမ်းတင်ပါ။ ဒီ Form မှ KPay ကို တိုက်ရိုက်လွှဲပေးခြင်း မဟုတ်ပါ။</p></div></div>
        {memberError && <div className="inline-error">{memberError}</div>}
        <label>Cashier ရွေးချယ်ရန်<select value={selectedCashierUid} onChange={(event) => { setSelectedCashierUid(event.target.value); setRelatedExpenseId(''); setAmount(''); }} disabled={membersLoading || members.length === 0}><option value="">{membersLoading ? 'Cashier စာရင်းဖတ်နေသည်…' : 'Cashier ရွေးပါ'}</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.displayName}{member.email ? ` · ${member.email}` : ''}</option>)}</select></label>
        <label>ငွေရှင်းအမျိုးအစား<select value={purpose} onChange={(event) => changePurpose(event.target.value as CashierSettlementPurpose)}><option value="expense_reimbursement">ကိုယ်ပိုင်စိုက်ထားသော Expense ပြန်အမ်းခြင်း</option><option value="cash_advance">ကြိုတင်ငွေထုတ်ပေးခြင်း</option><option value="salary">လစာပေးချေခြင်း</option><option value="other">အခြားငွေပေးချေမှု</option></select></label>
        {purpose === 'expense_reimbursement' && <label>ပြန်အမ်းမည့် Cashier Expense<select value={relatedExpenseId} onChange={(event) => { const id = event.target.value; setRelatedExpenseId(id); const expense = eligibleExpenses.find((entry) => entry.id === id); setAmount(expense ? String(expense.amount) : ''); }}><option value="">Expense ရွေးပါ</option>{eligibleExpenses.map((expense) => <option key={expense.id} value={expense.id}>{expense.title} · {money(expense.amount, currency)} · {dateLabel(expense.date)}</option>)}</select><small className="field-hint">ကိုယ်ပိုင်ငွေစိုက်ပြီး တင်ပြထားသော Expense ကိုသာ တစ်ကြိမ်ပြန်အမ်းနိုင်ပါတယ်။</small></label>}
        <label>ပေးချေမည့်နည်းလမ်း<select value={paymentMethod} onChange={(event) => { const value = event.target.value as 'cash' | 'kpay'; setPaymentMethod(value); if (value === 'cash') { setReceiverAccountName(''); setReceiverAccountNumber(''); setSenderAccountName(''); setSenderAccountNumber(''); setTransactionReference(''); } }}><option value="cash">Cash</option><option value="kpay">KPay</option></select></label>
        <label>ပမာဏ ({currency})<input required type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} readOnly={purpose === 'expense_reimbursement'} placeholder="ပေးချေမည့် ပမာဏ" /></label>
        {paymentMethod === 'kpay' && <div className="settlement-kpay-fields">
          <strong>KPay ငွေလွှဲအချက်အလက်</strong>
          <label>Cashier လက်ခံသူအမည် *<input required value={receiverAccountName} onChange={(event) => setReceiverAccountName(event.target.value)} placeholder="ဥပမာ - Aung Aung" /></label>
          <label>Cashier KPay ဖုန်းနံပါတ် / Account *<input required value={receiverAccountNumber} onChange={(event) => setReceiverAccountNumber(event.target.value)} placeholder="09xxxxxxxxx" inputMode="tel" /></label>
          <label>ဆိုင်ဘက်မှ ပေးချေသည့် KPay Account အမည်<input value={senderAccountName} onChange={(event) => setSenderAccountName(event.target.value)} placeholder="Branch KPay Account မသတ်မှတ်ရသေး" /></label>
          <label>ဆိုင်ဘက်မှ KPay Account နံပါတ်<input value={senderAccountNumber} onChange={(event) => setSenderAccountNumber(event.target.value)} placeholder="Branch KPay Account မသတ်မှတ်ရသေး" inputMode="tel" /></label>
          <label>KPay Transaction ID *<input required value={transactionReference} onChange={(event) => setTransactionReference(event.target.value)} placeholder="ငွေလွှဲပြီးနောက် ရရှိသည့် Transaction ID" maxLength={120} /></label>
        </div>}
        <label>မှတ်ချက်<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="ဥပမာ - November လစာ / Expense ပြန်အမ်း" /></label>
        {paymentMethod === 'cash' && <div className="settlement-hint">လက်ရှိ Branch မှာ Cash Shift ဖွင့်ထားပါက ဒီငွေရှင်းမှုကို Cash Out အဖြစ် အလိုအလျောက် ထည့်ပေးပါမယ်။</div>}
        {paymentMethod === 'kpay' && <div className="settlement-hint">ဒီ Version မှာ KPay Transfer ကို App က အလိုအလျောက် မလွှဲပါ။ KPay App မှ လွှဲပြီး Transaction ID ဖြည့်ကာ မှတ်တမ်းတင်ပါ။</div>}
        {success && <div className="inline-success">{success}</div>}
        {error && <div className="inline-error">{error}</div>}
        <button className="button button-primary" type="submit" disabled={busy || membersLoading || members.length === 0}>{busy ? 'သိမ်းဆည်းနေသည်…' : 'ငွေရှင်းပြီး မှတ်တမ်းတင်မည်'}</button>
      </form>
      <div className="panel expense-record-panel">
        <div className="panel-heading"><div className="panel-icon"><Receipt size={18}/></div><div><h3>Cashier ငွေရှင်းမှတ်တမ်း</h3><p>ဒီ Branch အတွက် Owner က ပေးချေပြီး မှတ်တမ်းတင်ထားသော စာရင်းများ။</p></div></div>
        <div className="expense-list-toolbar"><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">အားလုံး</option><option value="cash">Cash သာ</option><option value="kpay">KPay သာ</option></select><span className="subtle-count">{filteredSettlements.length} records</span></div>
        {filteredSettlements.length === 0 ? <div className="empty-state"><div className="empty-icon"><Wallet size={24}/></div><strong>ငွေရှင်းမှတ်တမ်း မရှိသေးပါ</strong><p>Cashier တစ်ယောက်ကို ငွေရှင်းပြီး မှတ်တမ်းတင်လိုက်ပါ။</p></div> : <div className="settlement-list">{filteredSettlements.map((entry) => <article className="settlement-card" key={entry.id}>
          <div className="settlement-icon">{purposeIcon(entry.purpose)}</div><div className="settlement-main"><strong>{entry.cashierName} · {purposeLabel[entry.purpose]}</strong><small>{dateLabel(settlementDate(entry))} · {entry.paymentMethod.toUpperCase()}</small>{entry.receiverAccountNumber && <small>လက်ခံသူ: {entry.receiverAccountName} · {entry.receiverAccountNumber}</small>}{entry.senderAccountName && <small>ပေးချေသူ: {entry.senderAccountName} · {entry.senderAccountNumber || ''}</small>}{entry.transactionReference && <small>Transaction ID: {entry.transactionReference}</small>}{entry.note && <small>{entry.note}</small>}</div><div className="settlement-amount"><strong>{money(entry.amount, currency)}</strong><span className="tag tag-success">ပေးချေပြီး</span></div>
        </article>)}</div>}
      </div>
    </div>
    <div className="panel security-note"><CalendarDays size={18}/><div><strong>စာရင်းကို မှန်ကန်စွာ ထိန်းသိမ်းရန်</strong><p>Cashier ကို KPay လွှဲပြီးမှ Transaction ID နှင့်တကွ မှတ်တမ်းတင်ပါ။ Expense Reimbursement ကိုတော့ Cashier ကိုယ်ပိုင်ငွေဖြင့် စိုက်သုံးထားသော Expense တစ်ခုချင်းစီကို တစ်ကြိမ်သာ ပြန်အမ်းနိုင်ပါတယ်။ ပြန်အမ်းငွေကို Expense ထပ်မတွက်ဘဲ Settlement အဖြစ် သီးခြားမှတ်တမ်းတင်ထားပါတယ်။ Salary / Cash Advance / Other Payment များကို ဒီ Preview တွင် ငွေပေးချေမှုမှတ်တမ်းအဖြစ်သာ သိမ်းပြီး Profit Analytics ထဲ အသုံးစရိတ်အဖြစ် အလိုအလျောက် မပေါင်းသေးပါ။</p></div></div>
  </section>;
}
