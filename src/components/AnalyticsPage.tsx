import { useMemo, useState, type ReactNode } from 'react';
import {
  Activity, BarChart3, CalendarDays, CircleDollarSign, CreditCard, Download,
  Package, Receipt, Store, TrendingUp, Users, Wallet,
} from 'lucide-react';
import type { Branch, CashShift, CustomerPayment, Expense, Product, Sale } from '../store/usePosStore';
import type { CashierSettlementRecord } from '../types/finance';

type PeriodPreset = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom';

type AnalyticsPageProps = {
  sales: Sale[];
  expenses: Expense[];
  settlements: CashierSettlementRecord[];
  cashShifts: CashShift[];
  customerPayments: CustomerPayment[];
  products: Product[];
  branches: Branch[];
  activeBranchId: string;
  isOwner: boolean;
  viewerUid: string;
  currency: string;
};

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseKey = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
};
const asDateKey = (value?: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : dateKey(parsed);
};
const money = (value: number, currency: string) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value || 0))} ${currency}`;
const sum = (values: number[]) => values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
const safeAmount = (value: number | undefined) => Number.isFinite(value) ? Number(value) : 0;
const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getPresetRange(preset: PeriodPreset) {
  const end = new Date();
  const start = new Date(end);
  if (preset === 'today') return { start: dateKey(start), end: dateKey(end) };
  if (preset === '7d') start.setDate(start.getDate() - 6);
  else if (preset === '30d') start.setDate(start.getDate() - 29);
  else if (preset === 'month') start.setDate(1);
  else if (preset === 'year') { start.setMonth(0, 1); }
  else start.setDate(start.getDate() - 29);
  return { start: dateKey(start), end: dateKey(end) };
}

function Metric({ icon, label, value, hint, tone = 'teal' }: { icon: ReactNode; label: string; value: string; hint?: string; tone?: 'teal' | 'green' | 'amber' | 'blue' }) {
  return <div className={`report-metric report-metric-${tone}`}>
    <div className="report-metric-top"><span>{label}</span><i>{icon}</i></div>
    <strong>{value}</strong>
    {hint && <small>{hint}</small>}
  </div>;
}

function HorizontalBar({ label, value, max, amount, currency, tone = 0 }: { label: string; value: number; max: number; amount?: number; currency: string; tone?: number }) {
  const width = max > 0 ? Math.max(value > 0 ? 1.5 : 0, value / max * 100) : 0;
  return <div className="report-bar-row">
    <div className="report-bar-label"><span>{label}</span><strong>{money(amount ?? value, currency)}</strong></div>
    <div className="report-bar-track"><div className={`report-bar-fill report-fill-${tone % 5}`} style={{ width: `${Math.min(100, width)}%` }} /></div>
  </div>;
}

export function AnalyticsPage({
  sales, expenses, settlements, cashShifts, customerPayments, products, branches,
  activeBranchId, isOwner, viewerUid, currency,
}: AnalyticsPageProps) {
  const initialRange = getPresetRange('30d');
  const [preset, setPreset] = useState<PeriodPreset>('30d');
  const [fromDate, setFromDate] = useState(initialRange.start);
  const [toDate, setToDate] = useState(initialRange.end);
  const [branchFilter, setBranchFilter] = useState(isOwner ? 'all' : activeBranchId);

  const changePreset = (next: PeriodPreset) => {
    setPreset(next);
    if (next !== 'custom') {
      const range = getPresetRange(next);
      setFromDate(range.start);
      setToDate(range.end);
    }
  };

  const visibleBranches = useMemo(() => branches, [branches]);
  const scopedSales = useMemo(() => sales.filter((sale) => {
    const ownerAllowed = isOwner || sale.createdByUid === viewerUid;
    const branchAllowed = branchFilter === 'all' ? true : (sale.branchId || activeBranchId) === branchFilter;
    const key = asDateKey(sale.date);
    return ownerAllowed && branchAllowed && sale.status === 'completed' && key >= fromDate && key <= toDate;
  }), [sales, isOwner, viewerUid, branchFilter, activeBranchId, fromDate, toDate]);
  const scopedExpenses = useMemo(() => expenses.filter((expense) => {
    if (expense.approvalStatus === 'pending' || expense.approvalStatus === 'rejected') return false;
    const ownerAllowed = isOwner || expense.createdByUid === viewerUid;
    const branchAllowed = branchFilter === 'all' ? true : (expense.branchId || activeBranchId) === branchFilter;
    const key = asDateKey(expense.date);
    return ownerAllowed && branchAllowed && key >= fromDate && key <= toDate;
  }), [expenses, isOwner, viewerUid, branchFilter, activeBranchId, fromDate, toDate]);
  const scopedSettlements = useMemo(() => settlements.filter((record) => {
    const ownerAllowed = isOwner || record.cashierUid === viewerUid;
    const branchAllowed = branchFilter === 'all' ? true : record.branchId === branchFilter;
    const key = asDateKey(record.paidAt || record.createdAt);
    return ownerAllowed && branchAllowed && record.status === 'paid' && key >= fromDate && key <= toDate;
  }), [settlements, isOwner, viewerUid, branchFilter, fromDate, toDate]);
  const scopedPayments = useMemo(() => customerPayments.filter((payment) => {
    const branchAllowed = branchFilter === 'all' ? true : (payment.branchId || activeBranchId) === branchFilter;
    const key = asDateKey(payment.date);
    return branchAllowed && key >= fromDate && key <= toDate;
  }), [customerPayments, branchFilter, activeBranchId, fromDate, toDate]);
  const scopedShifts = useMemo(() => cashShifts.filter((shift) => {
    const branchAllowed = branchFilter === 'all' ? true : (shift.branchId || activeBranchId) === branchFilter;
    const actorAllowed = isOwner || shift.openedByUid === viewerUid || shift.closedByUid === viewerUid;
    const key = asDateKey(shift.closedAt || shift.openedAt);
    return branchAllowed && actorAllowed && Boolean(shift.closedAt) && key >= fromDate && key <= toDate;
  }), [cashShifts, branchFilter, activeBranchId, isOwner, viewerUid, fromDate, toDate]);

  const revenue = sum(scopedSales.map((sale) => safeAmount(sale.total)));
  const grossProfit = sum(scopedSales.map((sale) => safeAmount(sale.profit)));
  const expenseTotal = sum(scopedExpenses.map((expense) => safeAmount(expense.amount)));
  const estimatedNet = grossProfit - expenseTotal;
  const averageOrder = scopedSales.length ? revenue / scopedSales.length : 0;

  const paymentMix = useMemo(() => {
    const result = { cash: 0, kpay: 0, credit: 0 };
    scopedSales.forEach((sale) => {
      if (sale.paymentMethod === 'Cash') result.cash += safeAmount(sale.total);
      else if (sale.paymentMethod === 'KPay') result.kpay += safeAmount(sale.total);
      else if (sale.paymentMethod === 'Credit') result.credit += safeAmount(sale.total);
    });
    return result;
  }, [scopedSales]);
  const actualCollections = useMemo(() => {
    const fromSales = { cash: 0, kpay: 0 };
    scopedSales.forEach((sale) => {
      const fallback = sale.paymentMethod === 'Cash' || sale.paymentMethod === 'KPay' ? sale.total : 0;
      const paid = Math.max(0, safeAmount(sale.paidAmount ?? fallback));
      if (sale.paymentMethod === 'Cash' || sale.paymentMethod === 'Credit') fromSales.cash += paid;
      if (sale.paymentMethod === 'KPay') fromSales.kpay += paid;
    });
    scopedPayments.forEach((payment) => {
      if ((payment.paymentMethod || 'Cash') === 'Cash') fromSales.cash += safeAmount(payment.amount);
      else fromSales.kpay += safeAmount(payment.amount);
    });
    return fromSales;
  }, [scopedSales, scopedPayments]);

  const settlementSummary = useMemo(() => {
    const result = { cash: 0, kpay: 0, count: scopedSettlements.length, reimbursement: 0, advance: 0, salary: 0, other: 0 };
    scopedSettlements.forEach((record) => {
      if (record.paymentMethod === 'cash') result.cash += record.amount;
      else result.kpay += record.amount;
      if (record.purpose === 'expense_reimbursement') result.reimbursement += record.amount;
      else if (record.purpose === 'cash_advance') result.advance += record.amount;
      else if (record.purpose === 'salary') result.salary += record.amount;
      else result.other += record.amount;
    });
    return result;
  }, [scopedSettlements]);

  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const topProducts = useMemo(() => {
    const totals = new Map<string, { name: string; quantity: number; revenue: number; profit: number; unit: string }>();
    scopedSales.forEach((sale) => {
      const itemSubtotal = sum(sale.items.map((item) => safeAmount(item.quantity) * safeAmount(item.unitPrice)));
      const discountRatio = itemSubtotal > 0 ? Math.min(1, safeAmount(sale.discount) / itemSubtotal) : 0;
      sale.items.forEach((item) => {
        const lineRevenue = safeAmount(item.quantity) * safeAmount(item.unitPrice);
        const existing = totals.get(item.productId) || {
          name: item.name,
          quantity: 0,
          revenue: 0,
          profit: 0,
          unit: productMap.get(item.productId)?.unit || item.unit || 'ခု',
        };
        existing.quantity += safeAmount(item.quantity);
        existing.revenue += lineRevenue * (1 - discountRatio);
        existing.profit += (safeAmount(item.quantity) * (safeAmount(item.unitPrice) - safeAmount(item.costPrice))) - (lineRevenue * discountRatio);
        totals.set(item.productId, existing);
      });
    });
    return [...totals.entries()].map(([id, value]) => ({ id, ...value })).sort((a, b) => b.quantity - a.quantity).slice(0, 8);
  }, [scopedSales, productMap]);

  const categoryBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    scopedSales.forEach((sale) => {
      const itemSubtotal = sum(sale.items.map((item) => safeAmount(item.quantity) * safeAmount(item.unitPrice)));
      const discountRatio = itemSubtotal > 0 ? Math.min(1, safeAmount(sale.discount) / itemSubtotal) : 0;
      sale.items.forEach((item) => {
        const category = productMap.get(item.productId)?.category || 'အမျိုးအစား မသတ်မှတ်ထား';
        const netLineRevenue = safeAmount(item.quantity) * safeAmount(item.unitPrice) * (1 - discountRatio);
        totals.set(category, (totals.get(category) || 0) + netLineRevenue);
      });
    });
    return [...totals.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 7);
  }, [scopedSales, productMap]);

  const expenseBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    scopedExpenses.forEach((expense) => totals.set(expense.category || 'အခြား', (totals.get(expense.category || 'အခြား') || 0) + safeAmount(expense.amount)));
    return [...totals.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 7);
  }, [scopedExpenses]);

  const cashierRows = useMemo(() => {
    const totals = new Map<string, { uid: string; name: string; sales: number; revenue: number; profit: number; expenses: number }>();
    const keyFor = (uid?: string, name?: string) => uid || `name:${name || 'မသတ်မှတ်ထား'}`;
    scopedSales.forEach((sale) => {
      const uid = sale.createdByUid || '';
      const name = sale.createdByName || sale.createdByEmail || (uid ? 'Cashier' : 'Owner / Legacy');
      const key = keyFor(uid, name);
      const row = totals.get(key) || { uid, name, sales: 0, revenue: 0, profit: 0, expenses: 0 };
      row.sales += 1;
      row.revenue += safeAmount(sale.total);
      row.profit += safeAmount(sale.profit);
      totals.set(key, row);
    });
    scopedExpenses.forEach((expense) => {
      const uid = expense.createdByUid || '';
      const name = expense.createdByName || expense.createdByEmail || (uid ? 'Cashier' : 'Owner / Legacy');
      const key = keyFor(uid, name);
      const row = totals.get(key) || { uid, name, sales: 0, revenue: 0, profit: 0, expenses: 0 };
      row.expenses += safeAmount(expense.amount);
      totals.set(key, row);
    });
    return [...totals.values()].sort((a, b) => b.revenue - a.revenue || b.sales - a.sales);
  }, [scopedSales, scopedExpenses]);

  const branchRows = useMemo(() => visibleBranches
    .filter((branch) => branchFilter === 'all' || branch.id === branchFilter)
    .map((branch) => {
      const branchSales = scopedSales.filter((sale) => (sale.branchId || activeBranchId) === branch.id);
      const branchExpenses = scopedExpenses.filter((expense) => (expense.branchId || activeBranchId) === branch.id);
      return {
        id: branch.id, name: branch.name,
        sales: branchSales.length,
        revenue: sum(branchSales.map((sale) => sale.total)),
        profit: sum(branchSales.map((sale) => sale.profit)),
        expenses: sum(branchExpenses.map((expense) => expense.amount)),
      };
    })
    .sort((a, b) => b.revenue - a.revenue), [visibleBranches, branchFilter, scopedSales, scopedExpenses, activeBranchId]);

  const shiftVariance = sum(scopedShifts.map((shift) => safeAmount(shift.variance ?? ((shift.closingCash ?? 0) - (shift.expectedCash ?? 0)))));
  const shiftDifferenceCount = scopedShifts.filter((shift) => safeAmount(shift.variance ?? ((shift.closingCash ?? 0) - (shift.expectedCash ?? 0))) !== 0).length;
  const trendRows = useMemo(() => {
    const start = parseKey(fromDate);
    const end = parseKey(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
    const daySpan = Math.min(370, Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1));
    const monthly = daySpan > 62;
    const map = new Map<string, { key: string; label: string; revenue: number; profit: number }>();
    for (let i = 0; i < daySpan; i += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const key = monthly ? `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}` : dateKey(day);
      if (!map.has(key)) map.set(key, { key, label: monthly ? day.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : day.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }), revenue: 0, profit: 0 });
    }
    scopedSales.forEach((sale) => {
      const parsed = new Date(sale.date);
      if (Number.isNaN(parsed.getTime())) return;
      const key = monthly ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}` : dateKey(parsed);
      const row = map.get(key);
      if (row) { row.revenue += safeAmount(sale.total); row.profit += safeAmount(sale.profit); }
    });
    return [...map.values()];
  }, [fromDate, toDate, scopedSales]);
  const trendMax = Math.max(1, ...trendRows.map((row) => row.revenue));
  const maxProductQuantity = Math.max(1, ...topProducts.map((row) => row.quantity));
  const maxExpenseValue = Math.max(1, ...expenseBreakdown.map((row) => row.value));
  const maxPaymentValue = Math.max(1, paymentMix.cash, paymentMix.kpay, paymentMix.credit);

  const exportReport = () => {
    const rows: unknown[][] = [
      ['Minimart Finance & Sales Report'],
      ['From', fromDate, 'To', toDate, 'Branch', branchFilter === 'all' ? 'All Branches' : (branches.find((branch) => branch.id === branchFilter)?.name || branchFilter)],
      [],
      ['Summary', 'Value'],
      ['Revenue', revenue], ['Gross Profit', grossProfit], ['Reported Expenses', expenseTotal], ['Estimated Net Profit', estimatedNet], ['Sales Count', scopedSales.length], ['Average Order', averageOrder],
      ['Cash Collection', actualCollections.cash], ['KPay / Transfer Collection', actualCollections.kpay], ['Cash Shift Variance', shiftVariance],
      ['Cash Sales Value', paymentMix.cash], ['KPay Sales Value', paymentMix.kpay], ['Credit Sales Value', paymentMix.credit],
      ['Cashier Settlement Cash', settlementSummary.cash], ['Cashier Settlement KPay', settlementSummary.kpay], ['Expense Reimbursement Paid', settlementSummary.reimbursement], ['Cash Advance Paid', settlementSummary.advance], ['Salary Paid', settlementSummary.salary], ['Other Settlement Paid', settlementSummary.other],
      [],
      ['Cashier Performance'], ['Cashier', 'Sales Count', 'Revenue', 'Gross Profit', 'Expenses'],
      ...cashierRows.map((row) => [row.name, row.sales, row.revenue, row.profit, row.expenses]),
      [],
      ['Branch Performance'], ['Branch', 'Sales Count', 'Revenue', 'Gross Profit', 'Expenses'],
      ...branchRows.map((row) => [row.name, row.sales, row.revenue, row.profit, row.expenses]),
      [],
      ['Top Products'], ['Product', 'Quantity', 'Unit', 'Revenue', 'Gross Profit'],
      ...topProducts.map((row) => [row.name, row.quantity, row.unit, row.revenue, row.profit]),
      [],
      ['Expenses'], ['Date', 'Branch', 'Cashier', 'Category', 'Title', 'Amount', 'Funding Source', 'Payment Method', 'Note'],
      ...scopedExpenses.map((expense) => [expense.date, branches.find((branch) => branch.id === expense.branchId)?.name || expense.branchId || '', expense.createdByName || '', expense.category, expense.title, expense.amount, expense.fundedBy || '', expense.paymentMethod || '', expense.note]),
    ];
    downloadCsv(`minimart-analytics-${fromDate}-to-${toDate}.csv`, rows);
  };

  const rangeInvalid = !fromDate || !toDate || toDate < fromDate;
  const rangeLabel = `${fromDate} မှ ${toDate} အထိ`;

  return <section className="page-stack reports-page">
    <div className="section-heading reports-heading">
      <div><h2>Business Reports & Analytics</h2><p>ရောင်းအား၊ အမြတ်၊ အသုံးစရိတ်၊ Branch နဲ့ Cashier စွမ်းဆောင်ရည်များကို တစ်နေရာတည်းမှာ ကြည့်ရှုနိုင်ပါတယ်။</p></div>
      <button className="button button-outline" type="button" onClick={exportReport} disabled={rangeInvalid}><Download size={15} /> Report CSV</button>
    </div>

    <div className="panel report-filter-panel">
      <div className="report-filter-top"><div className="panel-heading"><div className="panel-icon"><CalendarDays size={18}/></div><div><h3>Report Filter</h3><p>{rangeLabel}</p></div></div>
        <div className="period-switch report-period-switch">
          {([['today', 'Today'], ['7d', '7 Days'], ['30d', '30 Days'], ['month', 'This Month'], ['year', 'This Year'], ['custom', 'Custom']] as Array<[PeriodPreset, string]>).map(([value, label]) => <button key={value} type="button" className={preset === value ? 'active' : ''} onClick={() => changePreset(value)}>{label}</button>)}
        </div>
      </div>
      <div className="report-filter-fields">
        <label>စတင်ရက်<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setPreset('custom'); }}/></label>
        <label>ပြီးဆုံးရက်<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setPreset('custom'); }}/></label>
        {isOwner && <label>ဆိုင်ခွဲ<select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">ဆိုင်ခွဲအားလုံး</option>{visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.status === 'archived' ? ' (Archived)' : ''}</option>)}</select></label>}
        {!isOwner && <div className="report-fixed-branch"><small>ဆိုင်ခွဲ</small><strong>{branches.find((branch) => branch.id === activeBranchId)?.name || 'မိမိတာဝန်ကျဆိုင်'}</strong></div>}
      </div>
      {rangeInvalid && <p className="field-hint report-error">ရက်စွဲအပိုင်းအခြားကို မှန်ကန်စွာ ရွေးချယ်ပါ။</p>}
    </div>

    <div className="report-metrics-grid">
      <Metric icon={<TrendingUp size={17}/>} label="စုစုပေါင်း အရောင်း" value={money(revenue, currency)} hint={`${scopedSales.length} completed sales`} tone="teal" />
      <Metric icon={<CircleDollarSign size={17}/>} label="Gross Profit" value={money(grossProfit, currency)} hint="Sale မှတ်တမ်းတွင် သိမ်းထားသော အမြတ်" tone="green" />
      <Metric icon={<Wallet size={17}/>} label="အသုံးစရိတ်" value={money(expenseTotal, currency)} hint="Cashier / Owner တင်ပြ Expense" tone="amber" />
      <Metric icon={<Activity size={17}/>} label="ခန့်မှန်း Net Profit" value={money(estimatedNet, currency)} hint="Gross Profit − Expense" tone={estimatedNet >= 0 ? 'blue' : 'amber'} />
    </div>

    <div className="report-secondary-grid">
      <Metric icon={<Receipt size={17}/>} label="ပျမ်းမျှ အော်ဒါတန်ဖိုး" value={money(averageOrder, currency)} hint="Revenue ÷ Completed Sales" />
      <Metric icon={<CreditCard size={17}/>} label="Cash ကောက်ခံမှု" value={money(actualCollections.cash, currency)} hint="Cash Sale + Cash Credit Collection" tone="green" />
      <Metric icon={<Wallet size={17}/>} label="KPay / Transfer ကောက်ခံမှု" value={money(actualCollections.kpay, currency)} hint="KPay Sale + Transfer Credit Collection" tone="blue" />
      <Metric icon={<Activity size={17}/>} label="Cash Shift ကွာဟချက်" value={money(shiftVariance, currency)} hint={`${shiftDifferenceCount} shifts with variance`} tone={shiftVariance === 0 ? 'teal' : 'amber'} />
    </div>

    <div className="analytics-grid report-charts-grid">
      <div className="panel chart-panel report-chart-panel">
        <div className="panel-heading"><div><h3>Sales & Profit Trend</h3><p>{trendRows.length > 62 ? 'လစဉ်' : 'နေ့စဉ်'} Revenue နဲ့ Gross Profit</p></div><span className="chart-legend"><i/> Revenue</span></div>
        {scopedSales.length === 0 ? <div className="empty-state"><div className="empty-icon"><BarChart3 size={23}/></div><strong>အရောင်းမှတ်တမ်း မရှိသေးပါ</strong><p>ရွေးထားတဲ့ ရက်စွဲအတွင်း အရောင်းမရှိသေးပါ။</p></div> : <div className="report-trend-chart">{trendRows.map((row) => <div className="report-trend-column" key={row.key}><div className="report-trend-track"><div className="report-trend-revenue" style={{ height: `${row.revenue > 0 ? Math.max(2, row.revenue / trendMax * 100) : 0}%` }} title={`Revenue ${money(row.revenue, currency)}`}/><div className="report-trend-profit" style={{ height: `${row.profit > 0 ? Math.max(2, row.profit / trendMax * 100) : 0}%` }} title={`Gross Profit ${money(row.profit, currency)}`}/></div><small>{row.label}</small></div>)}</div>}
        <div className="report-chart-legend"><span><i className="legend-revenue"/> Revenue</span><span><i className="legend-profit"/> Gross Profit</span></div>
      </div>
      <div className="panel chart-panel report-chart-panel">
        <div className="panel-heading"><div><h3>Sales by Payment Type</h3><p>Checkout မှာ ရွေးခဲ့တဲ့ ငွေပေးချေမှုအမျိုးအစား</p></div></div>
        <div className="report-bars-list">
          <HorizontalBar label="Cash Sales" value={paymentMix.cash} max={maxPaymentValue} amount={paymentMix.cash} currency={currency} tone={0}/>
          <HorizontalBar label="KPay Sales" value={paymentMix.kpay} max={maxPaymentValue} amount={paymentMix.kpay} currency={currency} tone={1}/>
          <HorizontalBar label="Credit Sales" value={paymentMix.credit} max={maxPaymentValue} amount={paymentMix.credit} currency={currency} tone={2}/>
        </div>
        <div className="report-inline-note">ဒီ Chart သည် အရောင်း Voucher ရဲ့ Payment Type ကို ပြခြင်းဖြစ်ပြီး လက်ရှိ Cash/KPay Account Balance ကို မဆိုလိုပါ။</div>
      </div>
    </div>

    <div className="analytics-grid report-charts-grid">
      <div className="panel chart-panel report-chart-panel">
        <div className="panel-heading"><div><h3>Revenue by Category</h3><p>ပစ္စည်းအမျိုးအစားအလိုက် ရောင်းအား</p></div><span className="subtle-count">{categoryBreakdown.length} categories</span></div>
        {categoryBreakdown.length === 0 ? <div className="empty-state"><div className="empty-icon"><BarChart3 size={23}/></div><strong>အမျိုးအစားအလိုက် အရောင်းမရှိသေးပါ</strong></div> : <div className="report-bars-list">{categoryBreakdown.map((item, index) => <HorizontalBar key={item.label} label={item.label} value={item.value} max={Math.max(1, ...categoryBreakdown.map((entry) => entry.value))} currency={currency} tone={index}/>)}</div>}
      </div>
      <div className="panel chart-panel report-chart-panel">
        <div className="panel-heading"><div><h3>Expense by Category</h3><p>အသုံးစရိတ်အမျိုးအစားအလိုက်</p></div><span className="subtle-count">{scopedExpenses.length} entries</span></div>
        {expenseBreakdown.length === 0 ? <div className="empty-state"><div className="empty-icon"><Wallet size={23}/></div><strong>အသုံးစရိတ် မရှိသေးပါ</strong><p>ရွေးထားတဲ့ ရက်စွဲအတွင်း Expense မရှိသေးပါ။</p></div> : <div className="report-bars-list">{expenseBreakdown.map((item, index) => <HorizontalBar key={item.label} label={item.label} value={item.value} max={maxExpenseValue} currency={currency} tone={index}/>)}</div>}
      </div>
    </div>

    <div className="analytics-grid report-charts-grid">
      <div className="panel chart-panel report-chart-panel">
        <div className="panel-heading"><div><h3>Top Selling Products</h3><p>အရေအတွက်အလိုက် အရောင်းအများဆုံး ပစ္စည်းများ</p></div><span className="subtle-count">{topProducts.length} products</span></div>
        {topProducts.length === 0 ? <div className="empty-state"><div className="empty-icon"><Package size={23}/></div><strong>ပစ္စည်းအရောင်း မရှိသေးပါ</strong><p>အရောင်းရလာသည့်အခါ ပြသပေးပါမယ်။</p></div> : <div className="report-bars-list">{topProducts.map((item, index) => <div key={item.id} className="report-product-row"><div className="report-bar-label"><span>{index + 1}. {item.name}</span><strong>{item.quantity.toLocaleString('en-US')} {item.unit}</strong></div><div className="report-bar-track"><div className={`report-bar-fill report-fill-${index % 5}`} style={{ width: `${Math.min(100, item.quantity / maxProductQuantity * 100)}%` }}/></div><small>Revenue {money(item.revenue, currency)} · Profit {money(item.profit, currency)}</small></div>)}</div>}
      </div>
      <div className="panel chart-panel report-chart-panel">
        <div className="panel-heading"><div><h3>Product Performance</h3><p>Revenue နဲ့ Gross Profit အလိုက် ထိပ်ဆုံးပစ္စည်းများ</p></div><span className="subtle-count">{topProducts.length} products</span></div>
        {topProducts.length === 0 ? <div className="empty-state"><div className="empty-icon"><Package size={23}/></div><strong>ပစ္စည်းအရောင်း မရှိသေးပါ</strong><p>အရောင်းရလာသည့်အခါ ပြပါမယ်။</p></div> : <div className="report-bars-list">{[...topProducts].sort((a, b) => b.revenue - a.revenue).map((item, index) => <div key={item.id} className="report-product-row"><div className="report-bar-label"><span>{index + 1}. {item.name}</span><strong>{money(item.revenue, currency)}</strong></div><div className="report-bar-track"><div className={`report-bar-fill report-fill-${index % 5}`} style={{ width: `${Math.min(100, item.revenue / Math.max(1, ...topProducts.map((entry) => entry.revenue)) * 100)}%` }}/></div><small>Qty {item.quantity.toLocaleString('en-US')} {item.unit} · Profit {money(item.profit, currency)}</small></div>)}</div>}
      </div>
    </div>

    {isOwner && <div className="panel report-table-panel">
      <div className="panel-heading"><div><h3><Store size={16}/> Branch Performance</h3><p>ဆိုင်ခွဲအလိုက် Revenue, Gross Profit နဲ့ Expense</p></div><span className="subtle-count">{branchRows.length} branches</span></div>
      {branchRows.length === 0 ? <div className="empty-state"><strong>ဆိုင်ခွဲစာရင်း မရှိသေးပါ</strong></div> : <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Sales</th><th>Revenue</th><th>Gross Profit</th><th>Expenses</th><th>ခန့်မှန်း Net</th></tr></thead><tbody>{branchRows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.sales}</td><td>{money(row.revenue, currency)}</td><td>{money(row.profit, currency)}</td><td>{money(row.expenses, currency)}</td><td><b className={row.profit - row.expenses >= 0 ? 'stock-ok' : 'stock-warning'}>{money(row.profit - row.expenses, currency)}</b></td></tr>)}</tbody></table></div>}
    </div>}

    <div className="panel report-table-panel">
      <div className="panel-heading"><div><h3><Users size={16}/> Cashier Performance</h3><p>{isOwner ? 'Cashier တစ်ယောက်ချင်းစီရဲ့ အရောင်းနဲ့ Expense' : 'မိမိအကောင့်ရဲ့ အရောင်းနဲ့ Expense'}</p></div><span className="subtle-count">{cashierRows.length} users</span></div>
      {cashierRows.length === 0 ? <div className="empty-state"><strong>Cashier စာရင်း မရှိသေးပါ</strong><p>အရောင်း / Expense မှတ်တမ်းရှိလာသည့်အခါ ပြပါမယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>Cashier</th><th>Sales</th><th>Revenue</th><th>Gross Profit</th><th>Expenses</th><th>ခန့်မှန်း Contribution</th></tr></thead><tbody>{cashierRows.map((row) => <tr key={row.uid || row.name}><td><strong>{row.name}</strong>{row.uid && <small className="report-muted">{row.uid.slice(0, 12)}…</small>}</td><td>{row.sales}</td><td>{money(row.revenue, currency)}</td><td>{money(row.profit, currency)}</td><td>{money(row.expenses, currency)}</td><td><b className={row.profit - row.expenses >= 0 ? 'stock-ok' : 'stock-warning'}>{money(row.profit - row.expenses, currency)}</b></td></tr>)}</tbody></table></div>}
    </div>

    <div className="panel report-table-panel">
      <div className="panel-heading"><div><h3><CreditCard size={16}/> Cashier Settlement Summary</h3><p>Owner က Cashier များထံ ပေးချေထားသော ငွေများ — Expense Total နှင့် သီးခြားပြထားသည်။</p></div><span className="subtle-count">{settlementSummary.count} payments</span></div>
      <div className="report-settlement-grid">
        <div><small>Cash ပေးချေမှု</small><strong>{money(settlementSummary.cash, currency)}</strong></div>
        <div><small>KPay ပေးချေမှု</small><strong>{money(settlementSummary.kpay, currency)}</strong></div>
        <div><small>Expense ပြန်အမ်း</small><strong>{money(settlementSummary.reimbursement, currency)}</strong></div>
        <div><small>Cash Advance</small><strong>{money(settlementSummary.advance, currency)}</strong></div>
        <div><small>Salary</small><strong>{money(settlementSummary.salary, currency)}</strong></div>
        <div><small>အခြား</small><strong>{money(settlementSummary.other, currency)}</strong></div>
      </div>
    </div>

    <div className="panel analytics-note report-method-note"><Activity size={18}/><div><strong>Report တွက်ချက်မှုနှင့် ကန့်သတ်ချက်</strong><p>Revenue နဲ့ Gross Profit ကို Completed Sales များမှတွက်ထားပါတယ်။ Expense ကို Cashier/Owner တင်ပြမှတ်တမ်းအားလုံးမှတွက်ထားပြီး Owner Approval မလိုပါ။ ခန့်မှန်း Net Profit = Gross Profit − Reported Expenses ဖြစ်ပြီး အခွန်၊ ပိုင်ရှင်ကိုယ်ပိုင်ထုတ်ငွေ၊ မမှတ်တမ်းတင်ရသေးသော ကုန်ကျစရိတ်နှင့် အခြားစာရင်းညှိမှုများ မပါဝင်နိုင်ပါ။ Cash/KPay Collection က Sale ပေးချေမှုနဲ့ Credit Collection ကိုသာပြပြီး Ledger လက်ကျန်အဖြစ် မသတ်မှတ်ပါ။ Cashier Settlement များကို Expense Total ထဲ ထပ်မနုတ်ဘဲ သီးခြား Outflow အဖြစ်သာပြထားပါတယ်။</p></div></div>
  </section>;
}

