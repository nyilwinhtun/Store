import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowUpCircle, Banknote, CalendarDays, CheckCircle2, ClipboardList, CreditCard, Download, Plus, RefreshCw, Store, Wallet } from 'lucide-react';
import { usePosStore, type Expense } from '../store/usePosStore';
import { useBusinessAccess } from '../lib/businessAccess';
import type { BranchFinanceChannel, BranchFinanceDirection, BranchFinanceReconciliationRecord, CashierSettlementRecord } from '../types/finance';

type Props = { authorize: (action: string) => boolean; notify: (message: string) => void };
type LedgerRow = {
  id: string; date: string; channel: BranchFinanceChannel; direction: BranchFinanceDirection;
  amount: number; title: string; source: string; reference?: string; note?: string; actor?: string;
};

const money = (value: number, currency: string) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value || 0))} ${currency}`;
const dayKey = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const dateLabel = (value: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const businessDateOf = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return (value || '').slice(0, 10);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
};
const csvDownload = (filename: string, rows: unknown[][]) => {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function expenseChannel(expense: Expense): BranchFinanceChannel | null {
  if (expense.fundedBy === 'branch-cash') return 'cash';
  if (expense.fundedBy === 'branch-kpay') return 'kpay';
  return null;
}
function settlementChannel(entry: CashierSettlementRecord): BranchFinanceChannel { return entry.paymentMethod; }

export function BranchFinanceManagementPage({ authorize, notify }: Props) {
  const access = useBusinessAccess();
  const branches = usePosStore((state) => state.branches);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const activeBranch = branches.find((branch) => branch.id === activeBranchId);
  const settings = usePosStore((state) => state.settings);
  const sales = usePosStore((state) => state.sales);
  const expenses = usePosStore((state) => state.expenses);
  const customerPayments = usePosStore((state) => state.customerPayments);
  const supplierPayments = usePosStore((state) => state.supplierPayments);
  const cashMovements = usePosStore((state) => state.cashMovements);
  const settlements = usePosStore((state) => state.cashierSettlements);
  const manualEntries = usePosStore((state) => state.branchFinanceLedgerEntries);
  const advanceReconciliations = usePosStore((state) => state.cashierAdvanceReconciliations);
  const financeReconciliations = usePosStore((state) => state.branchFinanceReconciliations);
  const updateBranch = usePosStore((state) => state.updateBranch);
  const addBranchFinanceLedgerEntry = usePosStore((state) => state.addBranchFinanceLedgerEntry);
  const addCashierAdvanceReconciliation = usePosStore((state) => state.addCashierAdvanceReconciliation);
  const addBranchFinanceReconciliations = usePosStore((state) => state.addBranchFinanceReconciliations);

  const [kpayAccountName, setKpayAccountName] = useState('');
  const [kpayAccountNumber, setKpayAccountNumber] = useState('');
  const [kpayAccountLabel, setKpayAccountLabel] = useState('');
  const [openingCash, setOpeningCash] = useState('0');
  const [openingKPay, setOpeningKPay] = useState('0');
  const [startDate, setStartDate] = useState(dayKey());
  const [saveBusy, setSaveBusy] = useState(false);

  const [channel, setChannel] = useState<BranchFinanceChannel>('cash');
  const [direction, setDirection] = useState<BranchFinanceDirection>('out');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryNote, setEntryNote] = useState('');
  const [entryReference, setEntryReference] = useState('');
  const [entryBusy, setEntryBusy] = useState(false);

  const [selectedAdvanceId, setSelectedAdvanceId] = useState('');
  const [reconcileKind, setReconcileKind] = useState<'expense-applied' | 'cash-returned'>('cash-returned');
  const [reconcileChannel, setReconcileChannel] = useState<BranchFinanceChannel>('cash');
  const [relatedExpenseId, setRelatedExpenseId] = useState('');
  const [reconcileAmount, setReconcileAmount] = useState('');
  const [reconcileReference, setReconcileReference] = useState('');
  const [reconcileNote, setReconcileNote] = useState('');
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconciliationDate, setReconciliationDate] = useState(dayKey());
  const [actualCashBalance, setActualCashBalance] = useState('');
  const [actualKPayBalance, setActualKPayBalance] = useState('');
  const [reconciliationNote, setReconciliationNote] = useState('');
  const [reconciliationBusy, setReconciliationBusy] = useState(false);

  useEffect(() => {
    if (!activeBranch) return;
    setKpayAccountName(activeBranch.settings.kpayAccountName || '');
    setKpayAccountNumber(activeBranch.settings.kpayAccountNumber || '');
    setKpayAccountLabel(activeBranch.settings.kpayAccountLabel || '');
    setOpeningCash(String(activeBranch.settings.cashLedgerOpeningBalance ?? 0));
    setOpeningKPay(String(activeBranch.settings.kpayLedgerOpeningBalance ?? 0));
    setStartDate(activeBranch.settings.financeLedgerStartDate || dayKey());
    setReconciliationDate(dayKey());
  }, [activeBranch?.id, activeBranch?.updatedAt]);

  const branchExpenses = useMemo(() => expenses.filter((entry) => entry.branchId === activeBranchId), [expenses, activeBranchId]);
  const branchSales = useMemo(() => sales.filter((entry) => entry.branchId === activeBranchId && entry.status === 'completed'), [sales, activeBranchId]);
  const branchPayments = useMemo(() => customerPayments.filter((entry) => entry.branchId === activeBranchId), [customerPayments, activeBranchId]);
  const branchSupplierPayments = useMemo(() => supplierPayments.filter((entry) => entry.branchId === activeBranchId), [supplierPayments, activeBranchId]);
  const branchCashMovements = useMemo(() => cashMovements.filter((entry) => entry.branchId === activeBranchId), [cashMovements, activeBranchId]);
  const branchSettlements = useMemo(() => settlements.filter((entry) => entry.branchId === activeBranchId && entry.status === 'paid'), [settlements, activeBranchId]);
  const branchManualEntries = useMemo(() => manualEntries.filter((entry) => entry.branchId === activeBranchId), [manualEntries, activeBranchId]);
  const branchReconciliations = useMemo(() => advanceReconciliations.filter((entry) => entry.branchId === activeBranchId), [advanceReconciliations, activeBranchId]);
  const branchFinanceAudit = useMemo(() => financeReconciliations.filter((entry) => entry.branchId === activeBranchId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [financeReconciliations, activeBranchId]);
  const ledgerStartDate = activeBranch?.settings.financeLedgerStartDate || dayKey();

  const ledgerRows = useMemo<LedgerRow[]>(() => {
    if (!activeBranchId) return [];
    const rows: LedgerRow[] = [];
    const include = (date: string) => businessDateOf(date) >= ledgerStartDate;
    // An advance is already recorded as a cash/KPay outflow when it is paid.
    // Linked expenses are only the reconciliation detail, not a second payment.
    const advanceFundedExpenseIds = new Set(branchReconciliations
      .filter((entry) => entry.kind === 'expense-applied' && entry.relatedExpenseId)
      .map((entry) => entry.relatedExpenseId as string));
    for (const sale of branchSales) {
      if (!include(sale.date)) continue;
      if (sale.paymentMethod === 'Cash') rows.push({ id: `sale-cash-${sale.id}`, date: sale.date, channel: 'cash', direction: 'in', amount: sale.total, title: `အရောင်း · ${sale.receiptNo}`, source: 'POS Sale' });
      else if (sale.paymentMethod === 'KPay') rows.push({ id: `sale-kpay-${sale.id}`, date: sale.date, channel: 'kpay', direction: 'in', amount: sale.total, title: `KPay အရောင်း · ${sale.receiptNo}`, source: 'POS KPay', reference: sale.kpayTransactionReference });
      else if ((sale.paidAmount || 0) > 0) rows.push({ id: `sale-credit-paid-${sale.id}`, date: sale.date, channel: 'cash', direction: 'in', amount: sale.paidAmount || 0, title: `Credit ကြိုပေးငွေ · ${sale.receiptNo}`, source: 'POS Credit Deposit' });
    }
    for (const payment of branchPayments) {
      if (!include(payment.date) || (payment.paymentMethod || 'Cash') !== 'Cash') continue;
      rows.push({ id: `customer-payment-${payment.id}`, date: payment.date, channel: 'cash', direction: 'in', amount: payment.amount, title: `အကြွေးပြန်ဆပ် · ${payment.saleId}`, source: 'Customer Collection', note: payment.note });
    }
    for (const expense of branchExpenses) {
      const expenseMethod = expenseChannel(expense);
      if (!expenseMethod || !include(expense.date) || advanceFundedExpenseIds.has(expense.id)) continue;
      rows.push({ id: `expense-${expense.id}`, date: expense.date, channel: expenseMethod, direction: 'out', amount: expense.amount, title: expense.title, source: 'Expense', note: expense.note, actor: expense.createdByName || expense.createdByEmail });
    }
    for (const settlement of branchSettlements) {
      const date = settlement.paidAt || settlement.createdAt;
      if (!include(date)) continue;
      rows.push({ id: `settlement-${settlement.id}`, date, channel: settlementChannel(settlement), direction: 'out', amount: settlement.amount, title: `Cashier · ${settlement.cashierName}`, source: settlement.purpose.replace(/_/g, ' '), reference: settlement.transactionReference, note: settlement.note, actor: settlement.paidByName || settlement.createdByUid });
    }
    for (const payment of branchSupplierPayments) {
      if (!include(payment.date) || payment.paymentMethod !== 'Cash') continue;
      rows.push({ id: `supplier-payment-${payment.id}`, date: payment.date, channel: 'cash', direction: 'out', amount: payment.amount, title: `Supplier ပေးချေမှု · ${payment.purchaseId}`, source: 'Supplier Payment', note: payment.note });
    }
    for (const movement of branchCashMovements) {
      if (!include(movement.date) || movement.sourceSettlementId) continue;
      if (movement.note.startsWith('Customer credit payment') || movement.note.startsWith('Supplier payment')) continue;
      rows.push({ id: `cash-movement-${movement.id}`, date: movement.date, channel: 'cash', direction: movement.direction, amount: movement.amount, title: movement.note, source: 'Cash Shift', actor: movement.createdByName || movement.createdByUid });
    }
    for (const reconciliation of branchReconciliations) {
      if (reconciliation.kind !== 'cash-returned' || !include(reconciliation.createdAt)) continue;
      rows.push({ id: `advance-return-${reconciliation.id}`, date: reconciliation.createdAt, channel: reconciliation.channel, direction: 'in', amount: reconciliation.amount, title: `Cash Advance ပြန်အပ် · ${reconciliation.cashierName}`, source: 'Advance Return', reference: reconciliation.transactionReference, note: reconciliation.note, actor: reconciliation.createdByName });
    }
    for (const entry of branchManualEntries) {
      if (!include(entry.date)) continue;
      rows.push({ id: `manual-${entry.id}`, date: entry.date, channel: entry.channel, direction: entry.direction, amount: entry.amount, title: entry.note, source: 'Manual Entry', reference: entry.transactionReference, actor: entry.createdByName });
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [activeBranchId, ledgerStartDate, branchSales, branchPayments, branchExpenses, branchSettlements, branchSupplierPayments, branchCashMovements, branchReconciliations, branchManualEntries]);

  const summarize = (selectedChannel: BranchFinanceChannel, opening: number) => {
    const rows = ledgerRows.filter((row) => row.channel === selectedChannel);
    const totalIn = rows.filter((row) => row.direction === 'in').reduce((sum, row) => sum + row.amount, 0);
    const totalOut = rows.filter((row) => row.direction === 'out').reduce((sum, row) => sum + row.amount, 0);
    return { opening, totalIn, totalOut, balance: opening + totalIn - totalOut };
  };
  const cashSummary = summarize('cash', Number(activeBranch?.settings.cashLedgerOpeningBalance || 0));
  const kpaySummary = summarize('kpay', Number(activeBranch?.settings.kpayLedgerOpeningBalance || 0));

  const balanceAsOf = (selectedChannel: BranchFinanceChannel, selectedDate: string) => {
    const rows = ledgerRows.filter((row) => row.channel === selectedChannel && businessDateOf(row.date) <= selectedDate);
    const totalIn = rows.filter((row) => row.direction === 'in').reduce((sum, row) => sum + row.amount, 0);
    const totalOut = rows.filter((row) => row.direction === 'out').reduce((sum, row) => sum + row.amount, 0);
    const opening = selectedChannel === 'cash'
      ? Number(activeBranch?.settings.cashLedgerOpeningBalance || 0)
      : Number(activeBranch?.settings.kpayLedgerOpeningBalance || 0);
    return { expected: opening + totalIn - totalOut, totalIn, totalOut };
  };
  const reconciliationCash = balanceAsOf('cash', reconciliationDate);
  const reconciliationKPay = balanceAsOf('kpay', reconciliationDate);
  const actualCashNumber = actualCashBalance === '' ? null : Number(actualCashBalance);
  const actualKPayNumber = actualKPayBalance === '' ? null : Number(actualKPayBalance);
  const cashVariance = actualCashNumber === null ? null : actualCashNumber - reconciliationCash.expected;
  const kpayVariance = actualKPayNumber === null ? null : actualKPayNumber - reconciliationKPay.expected;

  const advances = useMemo(() => branchSettlements.filter((entry) => entry.purpose === 'cash_advance').map((entry) => {
    const reconciled = branchReconciliations.filter((row) => row.advanceSettlementId === entry.id).reduce((sum, row) => sum + row.amount, 0);
    return { ...entry, reconciled, outstanding: Math.max(0, entry.amount - reconciled) };
  }).filter((entry) => entry.outstanding > 0).sort((a, b) => (b.paidAt || b.createdAt).localeCompare(a.paidAt || a.createdAt)), [branchSettlements, branchReconciliations]);
  const selectedAdvance = advances.find((entry) => entry.id === selectedAdvanceId);
  const availableExpenses = useMemo(() => branchExpenses.filter((entry) => selectedAdvance
    && entry.createdByUid === selectedAdvance.cashierUid
    && ['branch-cash', 'branch-kpay'].includes(entry.fundedBy || '')
    && !branchReconciliations.some((row) => row.relatedExpenseId === entry.id)
    && entry.amount <= selectedAdvance.outstanding
    && entry.date >= (selectedAdvance.paidAt || selectedAdvance.createdAt)), [branchExpenses, selectedAdvance, branchReconciliations]);
  const chosenExpense = availableExpenses.find((entry) => entry.id === relatedExpenseId);

  const saveAccount = (event: FormEvent) => {
    event.preventDefault();
    if (!activeBranch || !authorize('Branch KPay Account နှင့် Ledger အဖွင့်လက်ကျန် ပြင်ဆင်ရန်')) return;
    const cash = Number(openingCash); const kpay = Number(openingKPay);
    if (!Number.isSafeInteger(cash) || cash < 0 || !Number.isSafeInteger(kpay) || kpay < 0) { notify('အဖွင့်လက်ကျန်ကို သုည သို့မဟုတ် အပေါင်းပြည့်ကိန်းဖြင့် ဖြည့်ပါ။'); return; }
    if ((kpayAccountName.trim() && !kpayAccountNumber.trim()) || (!kpayAccountName.trim() && kpayAccountNumber.trim())) { notify('KPay Account အမည်နဲ့ ဖုန်းနံပါတ်ကို နှစ်ခုလုံးဖြည့်ပါ၊ သို့မဟုတ် နှစ်ခုလုံးရှင်းပါ။'); return; }
    if (kpay > 0 && (!kpayAccountName.trim() || !kpayAccountNumber.trim())) { notify('KPay အဖွင့်လက်ကျန် ထည့်မယ်ဆိုရင် Branch KPay Account ကို အရင်ဖြည့်ပါ။'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(`${startDate}T12:00:00`)) || startDate > dayKey()) { notify(`Ledger စတင်မည့်နေ့ကို ယနေ့ ${dayKey()} သို့မဟုတ် အရင်ရက်သာ ရွေးပါ။`); return; }
    setSaveBusy(true);
    updateBranch(activeBranch.id, { settings: {
      kpayAccountName: kpayAccountName.trim(), kpayAccountNumber: kpayAccountNumber.trim(), kpayAccountLabel: kpayAccountLabel.trim(),
      cashLedgerOpeningBalance: cash, kpayLedgerOpeningBalance: kpay, financeLedgerStartDate: startDate,
    } });
    setSaveBusy(false);
    notify('Branch KPay Account နဲ့ Ledger အဖွင့်လက်ကျန် သိမ်းပြီးပါပြီ။ Cloud Sync ပြီးနောက် ဒီ Branch ရဲ့ Cashier ဖုန်းမှာလည်း Account အချက်အလက် ရောက်ပါမယ်။');
  };

  const addManualEntry = (event: FormEvent) => {
    event.preventDefault();
    if (!authorize('Branch Cash / KPay Ledger မှတ်တမ်းတင်ရန်')) return;
    const amount = Number(entryAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !entryNote.trim()) { notify('ပမာဏနဲ့ အကြောင်းအရင်းကို မှန်ကန်စွာ ဖြည့်ပါ။'); return; }
    if (channel === 'kpay' && (!activeBranch?.settings.kpayAccountNumber || !entryReference.trim())) { notify('KPay Account အရင်သတ်မှတ်ပြီး Transaction ID ဖြည့်ပါ။'); return; }
    setEntryBusy(true);
    const saved = addBranchFinanceLedgerEntry({ channel, direction, category: 'manual', amount, note: entryNote.trim(), ...(entryReference.trim() ? { transactionReference: entryReference.trim() } : {}), createdByUid: access.uid, createdByName: access.displayName || access.email || 'Owner' });
    setEntryBusy(false);
    if (!saved) { notify('Ledger မှတ်တမ်း မသိမ်းနိုင်ပါ။ KPay Transaction ID ထပ်နေခြင်း ရှိမရှိ စစ်ပါ။'); return; }
    setEntryAmount(''); setEntryNote(''); setEntryReference(''); notify('Cash / KPay Ledger မှတ်တမ်း သိမ်းပြီးပါပြီ။');
  };

  const reconcileAdvance = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedAdvance || !authorize('Cashier Cash Advance ရှင်းတမ်း မှတ်တမ်းတင်ရန်')) return;
    const amount = reconcileKind === 'expense-applied' ? Number(chosenExpense?.amount || 0) : Number(reconcileAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > selectedAdvance.outstanding) { notify('ရှင်းတမ်းပမာဏကို ကျန်ရှိ Cash Advance ထက် မပိုအောင် ဖြည့်ပါ။'); return; }
    if (reconcileKind === 'expense-applied' && !chosenExpense) { notify('Advance နဲ့ ချိတ်မယ့် Branch-funded Expense ကို ရွေးပါ။'); return; }
    if (reconcileKind === 'cash-returned' && reconcileChannel === 'kpay' && !reconcileReference.trim()) { notify('KPay ပြန်အပ်ငွေအတွက် Transaction ID ဖြည့်ပါ။'); return; }
    const expectedChannel: BranchFinanceChannel = reconcileKind === 'expense-applied'
      ? (chosenExpense?.fundedBy === 'branch-kpay' ? 'kpay' : 'cash') : reconcileChannel;
    setReconcileBusy(true);
    const saved = addCashierAdvanceReconciliation({
      advanceSettlementId: selectedAdvance.id, kind: reconcileKind, amount, channel: expectedChannel,
      ...(reconcileKind === 'expense-applied' && chosenExpense ? { relatedExpenseId: chosenExpense.id } : {}),
      ...(reconcileReference.trim() ? { transactionReference: reconcileReference.trim() } : {}), note: reconcileNote.trim(),
      createdByUid: access.uid, createdByName: access.displayName || access.email || 'Owner',
    });
    setReconcileBusy(false);
    if (!saved) { notify('Cash Advance ရှင်းတမ်း မသိမ်းနိုင်ပါ။ လက်ကျန်၊ Expense ချိတ်ဆက်မှုနဲ့ Transaction ID ကို ပြန်စစ်ပါ။'); return; }
    setSelectedAdvanceId(''); setRelatedExpenseId(''); setReconcileAmount(''); setReconcileReference(''); setReconcileNote('');
    notify('Cash Advance ရှင်းတမ်း မှတ်တမ်းတင်ပြီးပါပြီ။');
  };

  const saveDailyReconciliation = (event: FormEvent) => {
    event.preventDefault();
    if (!activeBranch || !authorize('နေ့စဉ် Cash / KPay စာရင်းတိုက်စစ်ရန်')) return;
    if (reconciliationDate < ledgerStartDate || reconciliationDate > dayKey()) { notify(`တိုက်စစ်မည့်နေ့ကို Ledger စတင်ရက် ${ledgerStartDate} မှ ယနေ့ ${dayKey()} အတွင်း ရွေးပါ။`); return; }
    const cash = Number(actualCashBalance);
    const hasKPay = !!activeBranch.settings.kpayAccountNumber?.trim();
    const kpay = hasKPay ? Number(actualKPayBalance) : null;
    if (!Number.isSafeInteger(cash) || cash < 0) { notify('အမှန်တကယ် ရေတွက်ထားသော Cash လက်ကျန်ကို မှန်ကန်စွာ ဖြည့်ပါ။'); return; }
    if (hasKPay && (kpay === null || !Number.isSafeInteger(kpay) || kpay < 0)) { notify('KPay App ထဲမှ အမှန်တကယ်လက်ကျန်ကို မှန်ကန်စွာ ဖြည့်ပါ။'); return; }
    const hasVariance = (cash - reconciliationCash.expected) !== 0 || (hasKPay && (kpay as number) - reconciliationKPay.expected !== 0);
    if (hasVariance && !reconciliationNote.trim()) { notify('ငွေကွာဟချက်ရှိပါက အကြောင်းပြချက်ကို ဖြည့်ပါ။'); return; }
    setReconciliationBusy(true);
    const actorName = access.displayName || access.email || 'Owner';
    const inputs = [
      { businessDate: reconciliationDate, channel: 'cash' as const, expectedBalance: reconciliationCash.expected, actualBalance: cash, totalIn: reconciliationCash.totalIn, totalOut: reconciliationCash.totalOut, note: reconciliationNote.trim(), createdByUid: access.uid || 'local-owner', createdByName: actorName },
      ...(hasKPay ? [{ businessDate: reconciliationDate, channel: 'kpay' as const, expectedBalance: reconciliationKPay.expected, actualBalance: kpay as number, totalIn: reconciliationKPay.totalIn, totalOut: reconciliationKPay.totalOut, note: reconciliationNote.trim(), createdByUid: access.uid || 'local-owner', createdByName: actorName }] : []),
    ];
    const saved = addBranchFinanceReconciliations(inputs);
    setReconciliationBusy(false);
    if (!saved) { notify('စာရင်းတိုက်စစ်မှတ်တမ်း မသိမ်းနိုင်ပါ။ အချက်အလက်နဲ့ Branch ကို ပြန်စစ်ပါ။'); return; }
    setActualCashBalance(''); setActualKPayBalance(''); setReconciliationNote('');
    notify(`နေ့စဉ် Finance Reconciliation ${saved.length} ခု သိမ်းပြီးပါပြီ။ Cloud Sync ပြီးနောက် နောက်မှလည်း ပြန်ကြည့်နိုင်ပါမယ်။`);
  };

  const exportReconciliations = () => csvDownload(`branch-finance-reconciliation-${activeBranchId}-${dayKey()}.csv`, [
    ['Business Date', 'Channel', 'Expected Balance', 'Actual Balance', 'Variance', 'Total In', 'Total Out', 'Created At', 'Created By', 'Note'],
    ...branchFinanceAudit.map((entry) => [entry.businessDate, entry.channel, entry.expectedBalance, entry.actualBalance, entry.variance, entry.totalIn, entry.totalOut, entry.createdAt, entry.createdByName, entry.note]),
  ]);

  const exportLedger = () => csvDownload(`branch-finance-ledger-${activeBranchId}-${dayKey()}.csv`, [
    ['Date', 'Channel', 'Direction', 'Title', 'Amount', 'Source', 'Reference', 'Recorded By', 'Note'],
    ...ledgerRows.map((row) => [row.date, row.channel, row.direction, row.title, row.amount, row.source, row.reference || '', row.actor || '', row.note || '']),
  ]);

  if (!activeBranch) return <section className="page-stack"><div className="panel">Branch မရှိသေးပါ။</div></section>;
  return <section className="page-stack">
    <div className="section-heading"><div><h2>Branch Cash & KPay စာရင်း</h2><p>{activeBranch.name} · ဆိုင်ခွဲအလိုက် KPay Account၊ ငွေဝင်/ထွက်နဲ့ Cash Advance ရှင်းတမ်း။</p></div><button className="button button-outline" type="button" onClick={exportLedger}><Download size={15}/> Ledger CSV</button></div>
    <div className="mini-stats">
      <div className="mini-stat"><span className="mini-stat-icon"><Banknote size={17}/></span><div><small>Cash လက်ကျန်</small><strong>{money(cashSummary.balance, settings.currency)}</strong></div></div>
      <div className="mini-stat"><span className="mini-stat-icon"><CreditCard size={17}/></span><div><small>KPay လက်ကျန်</small><strong>{money(kpaySummary.balance, settings.currency)}</strong></div></div>
      <div className="mini-stat"><span className="mini-stat-icon"><Wallet size={17}/></span><div><small>Cashier ကြိုတင်ငွေ ကျန်</small><strong>{money(advances.reduce((sum, entry) => sum + entry.outstanding, 0), settings.currency)}</strong></div></div>
    </div>
    <form className="panel form-panel" onSubmit={saveDailyReconciliation}>
      <div className="panel-heading"><div className="panel-icon"><CheckCircle2 size={18}/></div><div><h3>နေ့စဉ် Cash / KPay စာရင်းတိုက်စစ်ခြင်း</h3><p>App မျှော်မှန်းလက်ကျန်ကို လက်တွေ့ Cash ရေတွက်ငွေနဲ့ KPay App လက်ကျန်တို့ကို နှိုင်းယှဉ်ပြီး Audit Snapshot သိမ်းပါ။ Owner ထံ စာရင်းစစ်ရန်သာ ဖြစ်ပြီး လက်ကျန်ကို အလိုအလျောက် မပြောင်းပါ။</p></div></div>
      <label>တိုက်စစ်မည့်နေ့<input type="date" required min={ledgerStartDate} max={dayKey()} value={reconciliationDate} onChange={(event) => setReconciliationDate(event.target.value)}/></label>
      <div className="business-grid">
        <div className="panel"><div className="panel-heading"><div className="panel-icon"><Banknote size={17}/></div><div><h3>Cash တိုက်စစ်ခြင်း</h3><p>ဆိုင်ကောင်တာမှာ တကယ်ရေတွက်ထားသော ငွေသား။</p></div></div><div className="ledger-balance"><span>App မျှော်မှန်း Cash</span><strong>{money(reconciliationCash.expected, settings.currency)}</strong></div><div className="settlement-hint">ငွေဝင် {money(reconciliationCash.totalIn, settings.currency)} · ငွေထွက် {money(reconciliationCash.totalOut, settings.currency)}</div><label>အမှန်တကယ် ရေတွက်ထားသော Cash ({settings.currency}) *<input required type="number" min="0" step="1" value={actualCashBalance} onChange={(event) => setActualCashBalance(event.target.value)} placeholder="တကယ်ရှိတဲ့ ငွေ"/></label>{cashVariance !== null && <div className="settlement-hint">ကွာဟချက် — <b className={cashVariance === 0 ? 'stock-ok' : 'stock-warning'}>{cashVariance > 0 ? '+' : ''}{money(cashVariance, settings.currency)}</b></div>}</div>
        <div className="panel"><div className="panel-heading"><div className="panel-icon"><CreditCard size={17}/></div><div><h3>Branch KPay တိုက်စစ်ခြင်း</h3><p>Owner ရဲ့ KPay App ထဲမှာ ပြထားတဲ့ လက်ကျန်ငွေ။</p></div></div><div className="ledger-balance"><span>App မျှော်မှန်း KPay</span><strong>{money(reconciliationKPay.expected, settings.currency)}</strong></div><div className="settlement-hint">ငွေဝင် {money(reconciliationKPay.totalIn, settings.currency)} · ငွေထွက် {money(reconciliationKPay.totalOut, settings.currency)}</div>{activeBranch.settings.kpayAccountNumber ? <><label>အမှန်တကယ် KPay လက်ကျန် ({settings.currency}) *<input required type="number" min="0" step="1" value={actualKPayBalance} onChange={(event) => setActualKPayBalance(event.target.value)} placeholder="KPay App ထဲက လက်ကျန်"/></label>{kpayVariance !== null && <div className="settlement-hint">ကွာဟချက် — <b className={kpayVariance === 0 ? 'stock-ok' : 'stock-warning'}>{kpayVariance > 0 ? '+' : ''}{money(kpayVariance, settings.currency)}</b></div>}</> : <div className="empty-state"><strong>Branch KPay Account မသတ်မှတ်ရသေးပါ</strong><p>အပေါ်ရှိ Branch Account Settings မှာ KPay Account ထည့်ပြီးမှ တိုက်စစ်နိုင်ပါမယ်။</p></div>}</div>
      </div>
      <label>ကွာဟချက် / စာရင်းစစ် မှတ်ချက်<textarea rows={2} value={reconciliationNote} onChange={(event) => setReconciliationNote(event.target.value)} placeholder="ကွာဟချက်ရှိပါက အကြောင်းရင်းရေးပါ။"/></label>
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={reconciliationBusy || !actualCashBalance || (Boolean(activeBranch.settings.kpayAccountNumber) && actualKPayBalance === '')}>{reconciliationBusy ? 'တိုက်စစ်မှတ်တမ်း သိမ်းဆည်းနေသည်…' : 'နေ့စဉ်စာရင်းတိုက်စစ် သိမ်းမည်'}</button></div>
      <small className="field-hint">ဒီလုပ်ဆောင်ချက်က အမှန်တကယ်လက်ကျန်ကို စာရင်းစစ် Snapshot အဖြစ်သာ သိမ်းပါတယ်။ Cash / KPay Ledger ကို အလိုအလျောက် တိုး/လျှော့ မလုပ်ပါ။ ကွာဟချက်ရှိပါက အကြောင်းပြချက် မဖြစ်မနေ ဖြည့်ရပါမယ်။</small>
    </form>
    <div className="panel"><div className="panel-heading"><div><h3>Finance Reconciliation Audit History</h3><p>ယခင်နေ့စဉ် Cash / KPay တိုက်စစ်မှတ်တမ်းများ။ ပြင်ဆင်ခြင်း၊ ဖျက်ခြင်းမလုပ်ဘဲ Snapshot အသစ်အဖြစ်သာ ထပ်သိမ်းနိုင်ပါတယ်။</p></div><div className="form-actions"><span className="subtle-count">{branchFinanceAudit.length} records</span><button className="button button-outline" type="button" onClick={exportReconciliations} disabled={!branchFinanceAudit.length}><Download size={15}/> Audit CSV</button></div></div>
      {branchFinanceAudit.length === 0 ? <div className="empty-state"><div className="empty-icon"><ClipboardList size={22}/></div><strong>Reconciliation Audit မရှိသေးပါ</strong><p>နေ့စဉ်စာရင်းတိုက်စစ်ပြီး သိမ်းဆည်းတဲ့အခါ ဒီနေရာမှာ ပေါ်လာပါမယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>နေ့</th><th>Account</th><th>မျှော်မှန်း</th><th>အမှန်</th><th>ကွာဟချက်</th><th>မှတ်တမ်းတင်သူ</th><th>အချိန်</th></tr></thead><tbody>{branchFinanceAudit.slice(0, 100).map((entry: BranchFinanceReconciliationRecord) => <tr key={entry.id}><td>{entry.businessDate}</td><td><span className="tag">{entry.channel.toUpperCase()}</span></td><td>{money(entry.expectedBalance, settings.currency)}</td><td>{money(entry.actualBalance, settings.currency)}</td><td><b className={entry.variance === 0 ? 'stock-ok' : 'stock-warning'}>{entry.variance > 0 ? '+' : ''}{money(entry.variance, settings.currency)}</b>{entry.note && <small>{entry.note}</small>}</td><td>{entry.createdByName}</td><td>{dateLabel(entry.createdAt)}</td></tr>)}</tbody></table></div>}
    </div>
    <form className="panel form-panel" onSubmit={saveAccount}>
      <div className="panel-heading"><div className="panel-icon"><Store size={18}/></div><div><h3>ဒီ Branch ရဲ့ KPay Account</h3><p>ဆိုင်ခွဲတစ်ခုချင်းစီအတွက် ကိုယ်ပိုင် KPay လက်ခံအကောင့် သတ်မှတ်ပါ။ Cashier တွေက ဒီ Account အချက်အလက်ကို Branch Sync ကတစ်ဆင့် ရရှိပါမယ်။</p></div></div>
      <div className="form-grid"><label>Account Label<input value={kpayAccountLabel} onChange={(event) => setKpayAccountLabel(event.target.value)} placeholder="ဥပမာ - Main KPay"/></label><label>KPay Account အမည်<input value={kpayAccountName} onChange={(event) => setKpayAccountName(event.target.value)} placeholder="Account ပိုင်ရှင်အမည်"/></label><label>KPay ဖုန်းနံပါတ် / Account<input value={kpayAccountNumber} onChange={(event) => setKpayAccountNumber(event.target.value)} inputMode="tel" placeholder="09xxxxxxxxx"/></label><label>Ledger စတင်မည့်နေ့<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)}/></label><label>စတင်ချိန် Cash လက်ကျန် ({settings.currency})<input type="number" min="0" step="1" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)}/></label><label>စတင်ချိန် KPay လက်ကျန် ({settings.currency})<input type="number" min="0" step="1" value={openingKPay} onChange={(event) => setOpeningKPay(event.target.value)}/></label></div>
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={saveBusy}>{saveBusy ? 'သိမ်းဆည်းနေသည်…' : 'Branch Account / Opening Balance သိမ်းမည်'}</button></div>
      <small className="field-hint">Ledger စတင်မည့်နေ့မှစပြီး POS အရောင်း၊ Expense၊ Cashier Settlement နဲ့ Manual Entry တွေကို တွက်ချက်ပါမယ်။ နေ့စဉ် Cash Shift အဖွင့်ငွေနဲ့ မတူပါ။</small>
    </form>
    <div className="mini-stats">
      <div className="mini-stat"><span className="mini-stat-icon"><ArrowUpCircle size={17}/></span><div><small>Cash ငွေဝင် / ငွေထွက်</small><strong>{money(cashSummary.totalIn, settings.currency)} / {money(cashSummary.totalOut, settings.currency)}</strong></div></div>
      <div className="mini-stat"><span className="mini-stat-icon"><ArrowUpCircle size={17}/></span><div><small>KPay ငွေဝင် / ငွေထွက်</small><strong>{money(kpaySummary.totalIn, settings.currency)} / {money(kpaySummary.totalOut, settings.currency)}</strong></div></div>
      <div className="mini-stat"><span className="mini-stat-icon"><CalendarDays size={17}/></span><div><small>Ledger Transactions</small><strong>{ledgerRows.length} ခု</strong></div></div>
    </div>
    <div className="business-grid">
      <form className="panel form-panel" onSubmit={addManualEntry}>
        <div className="panel-heading"><div className="panel-icon"><Plus size={18}/></div><div><h3>Manual ငွေဝင် / ငွေထွက်</h3><p>POS / Expense / Settlement မှ အလိုအလျောက်မပါဝင်တဲ့ မှတ်တမ်းများအတွက်သာ အသုံးပြုပါ။</p></div></div>
        <label>Account<select value={channel} onChange={(event) => { setChannel(event.target.value as BranchFinanceChannel); setEntryReference(''); }}><option value="cash">Cash</option><option value="kpay">Branch KPay</option></select></label>
        <label>အမျိုးအစား<select value={direction} onChange={(event) => setDirection(event.target.value as BranchFinanceDirection)}><option value="in">ငွေဝင်</option><option value="out">ငွေထွက်</option></select></label>
        <label>ပမာဏ ({settings.currency})<input required type="number" min="1" step="1" value={entryAmount} onChange={(event) => setEntryAmount(event.target.value)}/></label>
        {channel === 'kpay' && <label>KPay Transaction ID *<input required value={entryReference} onChange={(event) => setEntryReference(event.target.value)} maxLength={120}/></label>}
        <label>အကြောင်းအရင်း *<textarea required rows={3} value={entryNote} onChange={(event) => setEntryNote(event.target.value)} placeholder="ဥပမာ - Owner ထည့်ငွေ / အခြားကုန်ကျစရိတ်"/></label>
        <button className="button button-primary" type="submit" disabled={entryBusy}>{entryBusy ? 'သိမ်းဆည်းနေသည်…' : 'Ledger မှတ်တမ်းတင်မည်'}</button>
      </form>
      <div className="panel">
        <div className="panel-heading"><div className="panel-icon"><ClipboardList size={18}/></div><div><h3>Cash Advance ရှင်းတမ်း</h3><p>Cashier ကို ကြိုတင်ထုတ်ပေးထားသောငွေကို Expense နဲ့ ပြန်အပ်ငွေ နှစ်မျိုးဖြင့် ရှင်းနိုင်ပါတယ်။</p></div></div>
        {advances.length === 0 ? <div className="empty-state"><div className="empty-icon"><CheckCircle2 size={22}/></div><strong>ရှင်းတမ်းလိုအပ်သော Advance မရှိပါ</strong><p>Cashier KPay & Cash Settlement ထဲမှ Cash Advance ပေးပြီးနောက် ဒီနေရာမှာ ပေါ်လာပါမယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>Cashier</th><th>ပေးထားငွေ</th><th>ရှင်းပြီး</th><th>ကျန်ငွေ</th></tr></thead><tbody>{advances.map((entry) => <tr key={entry.id}><td>{entry.cashierName}<small>{dateLabel(entry.paidAt || entry.createdAt)}</small></td><td>{money(entry.amount, settings.currency)}</td><td>{money(entry.reconciled, settings.currency)}</td><td><b className="stock-warning">{money(entry.outstanding, settings.currency)}</b></td></tr>)}</tbody></table></div>}
        {advances.length > 0 && <form className="form-panel compact-form" onSubmit={reconcileAdvance}>
          <label>Cash Advance ရွေးရန်<select value={selectedAdvanceId} onChange={(event) => { setSelectedAdvanceId(event.target.value); setRelatedExpenseId(''); setReconcileAmount(''); }}><option value="">Cashier / Advance ရွေးပါ</option>{advances.map((entry) => <option key={entry.id} value={entry.id}>{entry.cashierName} · ကျန် {money(entry.outstanding, settings.currency)}</option>)}</select></label>
          <label>ရှင်းတမ်းအမျိုးအစား<select value={reconcileKind} onChange={(event) => { setReconcileKind(event.target.value as typeof reconcileKind); setRelatedExpenseId(''); setReconcileReference(''); }}><option value="cash-returned">ကျန်ငွေကို ဆိုင်သို့ ပြန်အပ်ခြင်း</option><option value="expense-applied">ဆိုင်အသုံးစရိတ်နှင့် ချိတ်ဆက်ရှင်းတမ်း</option></select></label>
          {reconcileKind === 'expense-applied' ? <label>သက်ဆိုင်ရာ Expense ရွေးရန်<select value={relatedExpenseId} onChange={(event) => { const id = event.target.value; setRelatedExpenseId(id); const expense = availableExpenses.find((entry) => entry.id === id); setReconcileAmount(expense ? String(expense.amount) : ''); }}><option value="">Expense ရွေးပါ</option>{availableExpenses.map((entry) => <option key={entry.id} value={entry.id}>{entry.title} · {money(entry.amount, settings.currency)}</option>)}</select></label> : <><label>ပြန်အပ်မည့် Channel<select value={reconcileChannel} onChange={(event) => setReconcileChannel(event.target.value as BranchFinanceChannel)}><option value="cash">Cash</option><option value="kpay">KPay</option></select></label><label>ပြန်အပ်ငွေ ({settings.currency})<input type="number" min="1" max={selectedAdvance?.outstanding || undefined} step="1" value={reconcileAmount} onChange={(event) => setReconcileAmount(event.target.value)}/></label>{reconcileChannel === 'kpay' && <label>KPay Transaction ID *<input required value={reconcileReference} onChange={(event) => setReconcileReference(event.target.value)}/></label>}</>}
          {reconcileKind === 'expense-applied' && chosenExpense && <div className="settlement-hint">ဒီ Expense ကို {chosenExpense.fundedBy === 'branch-kpay' ? 'Branch KPay' : 'Branch Cash'} အဖြစ် စာရင်းထဲမှာ ရှိပြီးသားဖြစ်တာကြောင့် Advance လက်ကျန်ကနေသာ နုတ်ပါမယ်။ ငွေထွက်ကို နှစ်ခါမတွက်ပါဘူး။</div>}
          <label>မှတ်ချက်<textarea rows={2} value={reconcileNote} onChange={(event) => setReconcileNote(event.target.value)}/></label>
          <button className="button button-primary" type="submit" disabled={reconcileBusy || !selectedAdvanceId || (reconcileKind === 'expense-applied' && !relatedExpenseId)}>{reconcileBusy ? 'သိမ်းဆည်းနေသည်…' : 'Advance ရှင်းတမ်း သိမ်းမည်'}</button>
        </form>}
      </div>
    </div>
    <div className="panel"><div className="panel-heading"><div><h3>Cash / KPay Ledger History</h3><p>စတင်ရက် {ledgerStartDate} မှစ၍ Source Transaction များနှင့် Manual Entry များကို တစ်စုတစ်စည်းတည်း ပြထားပါတယ်။</p></div><span className="subtle-count">{ledgerRows.length} records</span></div>
      {ledgerRows.length === 0 ? <div className="empty-state"><div className="empty-icon"><Wallet size={23}/></div><strong>Ledger မှတ်တမ်း မရှိသေးပါ</strong><p>POS Sale၊ Expense၊ Cashier Settlement သို့မဟုတ် Manual Entry မှတ်တမ်းအသစ်များ စတင်သည့်အခါ ဒီနေရာမှာ ပေါ်လာပါမယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>အချိန်</th><th>Account</th><th>အကြောင်းအရာ</th><th>Source</th><th>Transaction ID</th><th>မှတ်တမ်းတင်သူ</th><th>ငွေဝင် / ထွက်</th></tr></thead><tbody>{ledgerRows.slice(0, 150).map((row) => <tr key={row.id}><td>{dateLabel(row.date)}</td><td><span className="tag">{row.channel.toUpperCase()}</span></td><td>{row.title}{row.note && <small>{row.note}</small>}</td><td>{row.source}</td><td>{row.reference || '—'}</td><td>{row.actor || '—'}</td><td><b className={row.direction === 'in' ? 'stock-ok' : 'stock-warning'}>{row.direction === 'in' ? '+' : '−'}{money(row.amount, settings.currency)}</b></td></tr>)}</tbody></table></div>}
    </div>
    <div className="panel security-note"><RefreshCw size={18}/><div><strong>စာရင်းတွက်ချက်မှု မှတ်ချက်</strong><p>Ledger မှ POS Cash/KPay Sale၊ Cashier Expense (Branch ပိုက်ဆံသုံးခဲ့လျှင်)၊ Cashier Settlement၊ Customer Cash Collection၊ Supplier Cash Payment၊ Cash Shift Manual Movement နဲ့ Advance ပြန်အပ်ငွေကို Source Record တစ်ခုစီကနေ တွက်ပါတယ်။ Manual Entry ကို အဲဒီ Source ထဲ မပါဝင်တဲ့ ငွေဝင်/ထွက်အတွက်သာ သုံးပါ။ Daily Cash Shift အဖွင့်ငွေနဲ့ Ledger Opening Balance ကို နှစ်ခါမပေါင်းပါ။ Transfer အမျိုးအစားကို KPay လို့ အလိုအလျောက် မယူဆပါ။</p></div></div>
  </section>;
}
