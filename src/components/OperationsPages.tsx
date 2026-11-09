import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, ArrowDownCircle, ArrowUpCircle, CheckCircle2, ClipboardList, Coins, Download, LockKeyhole, Plus, Wallet } from 'lucide-react';
import { usePosStore } from '../store/usePosStore';
import { useBusinessAccess } from '../lib/businessAccess';
import { loadBranchSalesAudit, type SalesAuditEvent } from '../lib/salesAudit';

const money = (value: number, currency = 'MMK') => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value || 0))} ${currency}`;
const dateTime = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const downloadCsv = (name: string, rows: unknown[][]) => {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
};

export function CashManagementPage() {
  const access = useBusinessAccess();
  const allShifts = usePosStore((state) => state.cashShifts);
  const allMovements = usePosStore((state) => state.cashMovements);
  const allSales = usePosStore((state) => state.sales);
  const allExpenses = usePosStore((state) => state.expenses);
  const advanceReconciliations = usePosStore((state) => state.cashierAdvanceReconciliations);
  const allPayments = usePosStore((state) => state.customerPayments);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const shifts = useMemo(() => allShifts.filter((entry) => entry.branchId === activeBranchId), [allShifts, activeBranchId]);
  const movements = useMemo(() => allMovements.filter((entry) => entry.branchId === activeBranchId), [allMovements, activeBranchId]);
  const sales = useMemo(() => allSales.filter((entry) => entry.branchId === activeBranchId), [allSales, activeBranchId]);
  const expenses = useMemo(() => {
    const appliedToAdvance = new Set(advanceReconciliations.filter((entry) => entry.kind === 'expense-applied' && entry.relatedExpenseId).map((entry) => entry.relatedExpenseId as string));
    return allExpenses.filter((entry) => entry.branchId === activeBranchId && entry.fundedBy === 'branch-cash' && !appliedToAdvance.has(entry.id));
  }, [allExpenses, activeBranchId, advanceReconciliations]);
  const payments = useMemo(() => allPayments.filter((entry) => entry.branchId === activeBranchId), [allPayments, activeBranchId]);
  const settings = usePosStore((state) => state.settings);
  const openCashShift = usePosStore((state) => state.openCashShift);
  const closeCashShift = usePosStore((state) => state.closeCashShift);
  const addCashMovement = usePosStore((state) => state.addCashMovement);
  const [openingCash, setOpeningCash] = useState('0');
  const [closingCash, setClosingCash] = useState('');
  const [shiftNote, setShiftNote] = useState('');
  const [movementDirection, setMovementDirection] = useState<'in' | 'out'>('in');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementNote, setMovementNote] = useState('');
  const activeShift = shifts.find((shift) => !shift.closedAt);

  const totals = useMemo(() => {
    if (!activeShift) return { cashSales: 0, creditCollection: 0, cashIn: 0, cashOut: 0, branchCashExpenses: 0, expected: 0 };
    const afterOpen = (value: string) => new Date(value).getTime() >= new Date(activeShift.openedAt).getTime();
    const cashSales = sales.filter((sale) => sale.status === 'completed' && afterOpen(sale.date)).reduce((sum, sale) => {
      if (sale.paymentMethod === 'Cash') return sum + sale.total;
      // KPay is tracked in the separate KPay ledger and must never inflate the physical cash drawer.
      if (sale.paymentMethod === 'KPay') return sum;
      // Any deposit recorded on a credit invoice is treated as cash for this shift.
      return sum + (sale.paidAmount || 0);
    }, 0);
    const creditCollection = payments.filter((payment) => afterOpen(payment.date) && (payment.paymentMethod || 'Cash') === 'Cash').reduce((sum, payment) => sum + payment.amount, 0);
    const branchCashExpenses = expenses.filter((expense) => expense.fundedBy === 'branch-cash' && expense.approvalStatus !== 'pending' && expense.approvalStatus !== 'rejected' && afterOpen(expense.date)).reduce((sum, expense) => sum + expense.amount, 0);
    const shiftMovements = movements.filter((movement) => movement.shiftId === activeShift.id);
    const cashIn = shiftMovements.filter((movement) => movement.direction === 'in').reduce((sum, movement) => sum + movement.amount, 0);
    const cashOut = shiftMovements.filter((movement) => movement.direction === 'out').reduce((sum, movement) => sum + movement.amount, 0);
    return { cashSales, creditCollection, cashIn, cashOut, branchCashExpenses, expected: activeShift.openingCash + cashSales + creditCollection + cashIn - cashOut - branchCashExpenses };
  }, [activeShift, sales, payments, movements, expenses]);

  const openSubmit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(openingCash);
    if (!Number.isFinite(amount) || amount < 0) return;
    openCashShift(amount, shiftNote.trim(), { uid: access.uid, name: access.displayName || access.email || 'Owner' });
    setOpeningCash('0'); setShiftNote('');
  };
  const movementSubmit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(movementAmount);
    if (!activeShift || !(amount > 0) || !movementNote.trim()) return;
    addCashMovement({ shiftId: activeShift.id, direction: movementDirection, amount, note: movementNote.trim(), createdByUid: access.uid || undefined, createdByName: access.displayName || access.email || 'Cashier' });
    setMovementAmount(''); setMovementNote('');
  };
  const closeSubmit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(closingCash);
    if (!activeShift || !Number.isFinite(amount) || amount < 0) return;
    if (!window.confirm('ရေတွက်ထားသောငွေပမာဏဖြင့် Cash Shift ကို ပိတ်မလား။ ပိတ်ပြီးလျှင် ဒီ Shift ကို ပြန်ဖွင့်၍မရပါ။')) return;
    closeCashShift(activeShift.id, amount, totals.expected, shiftNote.trim(), { uid: access.uid, name: access.displayName || access.email || 'Owner' });
    setClosingCash(''); setShiftNote('');
  };
  const exportShifts = () => downloadCsv(`minimart-cash-shifts-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Opened At', 'Opened By', 'Closed At', 'Closed By', 'Opening Cash', 'Expected Cash', 'Counted Cash', 'Difference', 'Note'],
    ...shifts.map((shift) => [shift.openedAt, shift.openedBy, shift.closedAt || 'OPEN', shift.closedByName || '', shift.openingCash, shift.expectedCash ?? '', shift.closingCash ?? '', shift.variance ?? (shift.closingCash !== undefined && shift.expectedCash !== undefined ? shift.closingCash - shift.expectedCash : ''), shift.note || '']),
  ]);

  return <section className="page-stack">
    <div className="section-heading"><div><h2>Cash Register & Shift</h2><p>နေ့စဉ် ငွေကောင်တာဖွင့်/ပိတ်၊ လက်ခံ/ထုတ်ငွေနှင့် ငွေစာရင်းကို စစ်ဆေးပါ။</p></div><button className="button button-outline" onClick={exportShifts}><Download size={15} /> Shift CSV</button></div>
    {!activeShift ? <form className="panel form-panel" onSubmit={openSubmit}>
      <div className="panel-heading"><div className="panel-icon"><LockKeyhole size={18} /></div><div><h3>ငွေကောင်တာဖွင့်ရန်</h3><p>အဖွင့်ငွေကို ရေတွက်ပြီး စတင်ပါ။</p></div></div>
      <div className="form-grid"><label>အဖွင့်ငွေ (MMK) *<input required type="number" min="0" step="1" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label><label>မှတ်ချက်<input value={shiftNote} onChange={(event) => setShiftNote(event.target.value)} placeholder="ဥပမာ - မနက်ပိုင်း Shift" /></label></div>
      <button className="button button-primary" type="submit"><Plus size={15} /> Cash Shift စတင်ရန်</button>
    </form> : <>
      <div className="mini-stats">
        <div className="mini-stat"><div className="mini-stat-icon"><Wallet size={17} /></div><div><small>အဖွင့်ငွေ</small><strong>{money(activeShift.openingCash, settings.currency)}</strong></div></div>
        <div className="mini-stat"><div className="mini-stat-icon"><Coins size={17} /></div><div><small>ငွေသားရောင်းရငွေ</small><strong>{money(totals.cashSales, settings.currency)}</strong></div></div>
        <div className="mini-stat"><div className="mini-stat-icon"><ArrowDownCircle size={17} /></div><div><small>အကြွေးပြန်ဆပ် (Cash)</small><strong>{money(totals.creditCollection, settings.currency)}</strong></div></div>
        <div className="mini-stat"><div className="mini-stat-icon"><Activity size={17} /></div><div><small>မျှော်မှန်းလက်ကျန်ငွေ</small><strong>{money(totals.expected, settings.currency)}</strong></div></div>
      </div>
      <div className="panel"><div className="panel-heading"><div><h3>လက်ရှိ Shift</h3><p>စတင်ချိန် {dateTime(activeShift.openedAt)} · {activeShift.openedBy}</p></div><span className="tag tag-success">OPEN</span></div>
        <div className="cash-summary-grid"><div><small>ငွေဝင်</small><strong className="stock-ok">+{money(totals.cashIn, settings.currency)}</strong></div><div><small>ငွေထွက်</small><strong className="stock-warning">-{money(totals.cashOut, settings.currency)}</strong></div><div><small>ဆိုင် Cash အသုံးစရိတ်</small><strong className="stock-warning">-{money(totals.branchCashExpenses, settings.currency)}</strong></div><div><small>မျှော်မှန်းငွေ</small><strong>{money(totals.expected, settings.currency)}</strong></div></div>
      </div>
      <div className="business-grid">
        <form className="panel form-panel" onSubmit={movementSubmit}>
          <div className="panel-heading"><div className="panel-icon"><ArrowUpCircle size={18} /></div><div><h3>ငွေဝင် / ငွေထွက် မှတ်တမ်း</h3><p>အရောင်းမဟုတ်သော ကောင်တာငွေ ရွှေ့ပြောင်းမှုများ။</p></div></div>
          <label>အမျိုးအစား<select value={movementDirection} onChange={(event) => setMovementDirection(event.target.value as 'in' | 'out')}><option value="in">ငွေဝင် (Cash In)</option><option value="out">ငွေထွက် (Cash Out)</option></select></label>
          <label>ပမာဏ (MMK) *<input required type="number" min="1" step="1" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} /></label>
          <label>အကြောင်းအရင်း *<input required value={movementNote} onChange={(event) => setMovementNote(event.target.value)} placeholder="ဥပမာ - ဆိုင်အသုံးစရိတ် ထုတ်ပေး" /></label>
          <button className="button button-primary" type="submit"><Plus size={15} /> မှတ်တမ်းတင်ရန်</button>
        </form>
        <form className="panel form-panel" onSubmit={closeSubmit}>
          <div className="panel-heading"><div className="panel-icon"><CheckCircle2 size={18} /></div><div><h3>နေ့ကုန် Cash Shift ပိတ်ရန်</h3><p>လက်ရှိငွေသားကို ကိုယ်တိုင်ရေတွက်ပြီး ထည့်ပါ။</p></div></div>
          <div className="ledger-balance"><span>System မျှော်မှန်းငွေ</span><strong>{money(totals.expected, settings.currency)}</strong></div>
          <label>အမှန်တကယ် ရေတွက်ထားသောငွေ (MMK) *<input required type="number" min="0" step="1" value={closingCash} onChange={(event) => setClosingCash(event.target.value)} placeholder="0" /></label>
          <label>မှတ်ချက်<input value={shiftNote} onChange={(event) => setShiftNote(event.target.value)} placeholder="ငွေကွာဟချက် ရှိပါက ရှင်းပြရန်" /></label>
          <button className="button button-primary" type="submit" disabled={closingCash === ''}><LockKeyhole size={15} /> Shift ပိတ်ရန်</button>
        </form>
      </div>
      <div className="panel"><div className="panel-heading"><div><h3>ယခု Shift ငွေဝင်/ထွက် မှတ်တမ်း</h3><p>ငွေရွှေ့ပြောင်းမှုများ</p></div><span className="subtle-count">{movements.filter((movement) => movement.shiftId === activeShift.id).length} records</span></div>
        {movements.filter((movement) => movement.shiftId === activeShift.id).length === 0 ? <div className="empty-state"><div className="empty-icon"><Wallet size={23} /></div><strong>ငွေဝင်/ထွက် မှတ်တမ်း မရှိသေးပါ</strong><p>လိုအပ်သည့်အခါ အပေါ်က Form မှာ မှတ်တမ်းတင်ပါ။</p></div> : <div className="table-wrap"><table><thead><tr><th>အချိန်</th><th>အမျိုးအစား</th><th>အကြောင်းအရင်း</th><th>မှတ်တမ်းတင်သူ</th><th>ပမာဏ</th></tr></thead><tbody>{movements.filter((movement) => movement.shiftId === activeShift.id).map((movement) => <tr key={movement.id}><td>{dateTime(movement.date)}</td><td><span className={`tag ${movement.direction === 'in' ? 'tag-success' : 'tag-warn'}`}>{movement.direction === 'in' ? 'ငွေဝင်' : 'ငွေထွက်'}</span></td><td>{movement.note}</td><td>{movement.createdByName || '—'}</td><td><b>{movement.direction === 'in' ? '+' : '-'}{money(movement.amount, settings.currency)}</b></td></tr>)}</tbody></table></div>}
      </div>
    </>}
    <div className="panel"><div className="panel-heading"><div><h3>ယခင် Shift မှတ်တမ်း</h3><p>နေ့စဉ် ပိတ်သိမ်းမှုနှင့် ငွေကွာဟချက်</p></div><span className="subtle-count">{shifts.filter((shift) => shift.closedAt).length} closed</span></div>
      {shifts.filter((shift) => shift.closedAt).length === 0 ? <div className="empty-state"><div className="empty-icon"><ClipboardList size={23} /></div><strong>ပိတ်ပြီးသော Shift မရှိသေးပါ</strong><p>ပထမဆုံး Cash Shift ကို ပိတ်ပြီးနောက် ဒီနေရာမှာ ပြပါမယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>ဖွင့်ချိန်</th><th>ပိတ်ချိန်</th><th>ဖွင့်သူ</th><th>ပိတ်သူ</th><th>အဖွင့်ငွေ</th><th>မျှော်မှန်းငွေ</th><th>ရေတွက်ငွေ</th><th>ကွာဟချက်</th></tr></thead><tbody>{shifts.filter((shift) => shift.closedAt).map((shift) => { const variance = shift.variance ?? ((shift.closingCash ?? 0) - (shift.expectedCash ?? 0)); return <tr key={shift.id}><td>{dateTime(shift.openedAt)}</td><td>{shift.closedAt ? dateTime(shift.closedAt) : '—'}</td><td>{shift.openedBy || '—'}</td><td>{shift.closedByName || '—'}</td><td>{money(shift.openingCash, settings.currency)}</td><td>{money(shift.expectedCash ?? 0, settings.currency)}</td><td>{money(shift.closingCash ?? 0, settings.currency)}</td><td><b className={variance === 0 ? 'stock-ok' : 'stock-warning'}>{variance > 0 ? '+' : ''}{money(variance, settings.currency)}</b></td></tr>; })}</tbody></table></div>}
    </div>
    <div className="panel security-note"><Activity size={18} /><div><strong>ငွေစာရင်းတွက်ချက်မှု မှတ်ချက်</strong><p>မျှော်မှန်းငွေ = အဖွင့်ငွေ + Cash Sale + Credit Sale တွင် ကြိုပေးထားသော Cash + Cash အကြွေးပြန်ဆပ် + Cash In − Cash Out − Branch Cash ဖြင့်ပေးထားသော Expense ဖြစ်ပါတယ်။ Branch KPay Expense နဲ့ KPay Sale ကို Cash Drawer ထဲ မပေါင်းပါ။ Cashier ကိုယ်ပိုင်ငွေသုံးထားသော Expense ကိုလည်း ဤ Cash Shift မှ မနုတ်ပါ။</p></div></div>
  </section>;
}

export function ActivityLogPage() {
  const access = useBusinessAccess();
  const allLogs = usePosStore((state) => state.activityLogs);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const [cloudAudit, setCloudAudit] = useState<SalesAuditEvent[]>([]);
  const [cloudAuditState, setCloudAuditState] = useState('Owner Cloud Audit ကို ဖွင့်မှတ်တမ်းကြည့်သည့်အခါမှသာ ဖတ်ပါမယ်။');
  useEffect(() => {
    if (access.status !== 'active' || access.role !== 'owner') { setCloudAudit([]); return; }
    let cancelled = false;
    setCloudAuditState('Cloud Sales Audit ကို ဖတ်နေပါတယ်။');
    void loadBranchSalesAudit(activeBranchId).then((events) => {
      if (cancelled) return;
      setCloudAudit(events);
      setCloudAuditState(`${events.length} ခုသော Cloud Audit Event ကို ဖတ်ပြီးပါပြီ။`);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setCloudAuditState(error instanceof Error ? error.message : 'Cloud Audit ကို ဖတ်မရပါ။');
    });
    return () => { cancelled = true; };
  }, [activeBranchId, access.status, access.role]);
  const logs = useMemo(() => allLogs.filter((entry) => entry.branchId === activeBranchId), [allLogs, activeBranchId]);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => logs.filter((log) => `${log.action} ${log.entity} ${log.description} ${log.actor}`.toLowerCase().includes(query.toLowerCase())), [logs, query]);
  const exportLogs = () => downloadCsv(`minimart-activity-log-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Date', 'Actor', 'Action', 'Entity', 'Description'],
    ...filtered.map((log) => [log.at, log.actor, log.action, log.entity, log.description]),
  ]);
  return <section className="page-stack">
    <div className="section-heading"><div><h2>Activity & Audit Log</h2><p>Device Local လုပ်ဆောင်ချက်များနှင့် Cloud Sales Audit ကို ခွဲခြားကြည့်နိုင်ပါတယ်။</p></div><button className="button button-outline" onClick={exportLogs}><Download size={15} /> CSV Export</button></div>
    {access.status === 'active' && access.role === 'owner' && <div className="panel"><div className="panel-heading"><div><h3>Cloud Sales Audit (နောက်ဆုံး ၁၀၀ ခု)</h3><p>{cloudAuditState}</p></div><button className="button button-outline" type="button" onClick={() => { setCloudAuditState('Cloud Audit ကို ပြန်ဖတ်နေပါတယ်။'); void loadBranchSalesAudit(activeBranchId).then((events) => { setCloudAudit(events); setCloudAuditState(`${events.length} ခုသော Cloud Audit Event ကို ဖတ်ပြီးပါပြီ။`); }).catch((error: unknown) => setCloudAuditState(error instanceof Error ? error.message : 'Cloud Audit ကို ဖတ်မရပါ။')); }}>ပြန်ဖတ်ရန်</button></div>
      {cloudAudit.length === 0 ? <div className="empty-state"><div className="empty-icon"><Activity size={23} /></div><strong>Cloud Sales Audit မရှိသေးပါ</strong><p>Cashier Sale Sync အသစ်များနှင့် Owner Void လုပ်ဆောင်ချက်များကို ဒီနေရာမှာ ပြပါမယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>အချိန်</th><th>လုပ်ဆောင်သူ</th><th>လုပ်ဆောင်ချက်</th><th>Voucher</th><th>ပမာဏ</th><th>အကြောင်းပြချက်</th></tr></thead><tbody>{cloudAudit.map((event) => <tr key={event.id}><td>{dateTime(event.occurredAt)}</td><td>{event.actorName || event.actorEmail}</td><td><span className={`tag ${event.eventType === 'SALE_VOIDED' ? 'tag-danger' : 'tag-success'}`}>{event.eventType === 'SALE_VOIDED' ? 'VOID' : 'SALE'}</span></td><td><strong className="mono">{event.receiptNo}</strong></td><td><b>{money(event.total)}</b></td><td>{event.reason || '—'}</td></tr>)}</tbody></table></div>}
    </div>}
    <div className="panel"><div className="panel-heading"><div><h3>Device Activity Log</h3><p>နောက်ဆုံးလုပ်ဆောင်ချက် ၁,၀၀၀ ခုအထိ သိမ်းဆည်းထားပါမည်။</p></div><input className="inline-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Action / Description ရှာရန်" /></div>
      {filtered.length === 0 ? <div className="empty-state"><div className="empty-icon"><Activity size={23} /></div><strong>မှတ်တမ်း မရှိသေးပါ</strong><p>Product, Sale, Stock, Payment, Purchase နှင့် Cash Shift လုပ်ဆောင်ချက်များ ဒီနေရာမှာ ပေါ်လာပါမယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>အချိန်</th><th>လုပ်ဆောင်သူ</th><th>Action</th><th>အမျိုးအစား</th><th>အသေးစိတ်</th></tr></thead><tbody>{filtered.map((log) => <tr key={log.id}><td>{dateTime(log.at)}</td><td>{log.actor}</td><td><span className="tag">{log.action}</span></td><td>{log.entity}</td><td>{log.description}</td></tr>)}</tbody></table></div>}
    </div>
    <div className="panel security-note"><LockKeyhole size={18} /><div><strong>Audit Log ၏ ကန့်သတ်ချက်</strong><p>အပေါ်က Cloud Sales Audit သည် Firestore ထဲတွင် append-only သိမ်းထားသော Cashier Sale / Owner Void Event များဖြစ်ပါတယ်။ အောက်က Device Activity Log ကတော့ လက်ရှိ Device မှတ်တမ်းဖြစ်ပြီး Local ဖြစ်နေဆဲပါ။ ငွေပြန်အမ်းခြင်းနှင့် Partial Refund ကို ဒီ Version မှာ မထည့်သေးပါ။</p></div></div>
  </section>;
}
