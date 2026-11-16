import type { Branch, Customer, CustomerPayment, Sale } from '../store/usePosStore';

export type CustomerStatementLineKind = 'invoice' | 'payment';

export type CustomerStatementLine = {
  id: string;
  kind: CustomerStatementLineKind;
  date: string;
  day: string;
  reference: string;
  description: string;
  note: string;
  debit: number;
  credit: number;
  balance: number;
  /** Down payment captured when the invoice was created. */
  synthetic?: boolean;
  /** Record had no branchId and belongs to the default Branch. */
  legacyBranch?: boolean;
};

export type CustomerStatementInput = {
  customer: Pick<Customer, 'id' | 'name' | 'phone' | 'address'>;
  branch: Pick<Branch, 'id' | 'name' | 'code' | 'phone' | 'address' | 'isDefault'>;
  sales: readonly Sale[];
  payments: readonly CustomerPayment[];
  /** Local calendar date, inclusive: YYYY-MM-DD. */
  fromDate?: string;
  /** Local calendar date, inclusive: YYYY-MM-DD. */
  toDate?: string;
  currency?: string;
  generatedAt?: string;
};

export type CustomerStatement = {
  customer: Pick<Customer, 'id' | 'name' | 'phone' | 'address'>;
  branch: Pick<Branch, 'id' | 'name' | 'code' | 'phone' | 'address' | 'isDefault'>;
  currency: string;
  fromDate: string | null;
  toDate: string | null;
  openingBalance: number;
  closingBalance: number;
  currentOutstanding: number;
  totalInvoiced: number;
  totalPaid: number;
  invoiceCount: number;
  paymentCount: number;
  lines: CustomerStatementLine[];
  excludedVoidedInvoices: number;
  excludedVoidedPayments: number;
  includesLegacyUnassignedBranchRecords: boolean;
  skippedInvalidRecords: number;
  generatedAt: string;
};

const MONEY_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function statementDayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatStatementMoney(value: number, currency = 'MMK'): string {
  return `${MONEY_FORMAT.format(Math.round(value || 0))} ${currency}`;
}

export function formatStatementDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Same outstanding formula used by the existing Credit Ledger. */
export function saleOutstandingDue(sale: Pick<Sale, 'paymentMethod' | 'total' | 'paidAmount' | 'dueAmount'>): number {
  return Math.max(0, sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total - (sale.paidAmount ?? 0) : 0));
}

export function customerCurrentOutstanding(
  sales: readonly Sale[],
  customerId: string,
  branch: Pick<Branch, 'id' | 'isDefault'>,
): number {
  return sales.reduce((sum, sale) => {
    if (sale.customerId !== customerId || sale.status !== 'completed' || sale.paymentMethod !== 'Credit') return sum;
    if (!recordBranchMatches(sale.branchId, branch)) return sum;
    return sum + saleOutstandingDue(sale);
  }, 0);
}

type BranchScope = 'matched' | 'legacy-default' | 'other';

function recordBranchMatches(branchId: string | undefined, branch: Pick<Branch, 'id' | 'isDefault'>): boolean {
  return branchScope(branchId, branch) !== 'other';
}

function branchScope(branchId: string | undefined, branch: Pick<Branch, 'id' | 'isDefault'>): BranchScope {
  if (branchId === branch.id) return 'matched';
  // Pre-branch legacy records belong to the default Branch only. They are never
  // exposed on another Branch, so a Cashier cannot see cross-Branch history.
  if ((branchId === undefined || branchId === '') && branch.isDefault) return 'legacy-default';
  return 'other';
}

function assertDateInput(value: string | undefined, label: string): void {
  if (value !== undefined && value !== '' && !DAY_PATTERN.test(value)) {
    throw new Error(`Customer statement ${label} must use the YYYY-MM-DD format.`);
  }
}

export function buildCustomerStatement(input: CustomerStatementInput): CustomerStatement {
  assertDateInput(input.fromDate, 'from date');
  assertDateInput(input.toDate, 'to date');
  if (input.fromDate && input.toDate && input.fromDate > input.toDate) {
    throw new Error('Customer statement start date must not be after the end date.');
  }

  const currency = input.currency || 'MMK';
  const customerId = input.customer.id;
  const customerSales = input.sales.filter((sale) => sale.customerId === customerId);
  const voidedSaleIds = new Set(customerSales.filter((sale) => sale.status === 'voided').map((sale) => sale.id));
  const scopeBranch = input.branch;

  let skippedInvalidRecords = 0;
  let includesLegacyUnassignedBranchRecords = false;

  const scopedSales = customerSales.filter((sale) => {
    if (branchScope(sale.branchId, scopeBranch) === 'other') return false;
    if (branchScope(sale.branchId, scopeBranch) === 'legacy-default') includesLegacyUnassignedBranchRecords = true;
    if (!statementDayKey(sale.date)) { skippedInvalidRecords += 1; return false; }
    return true;
  });
  const completedCreditSales = scopedSales.filter((sale) => sale.status === 'completed' && sale.paymentMethod === 'Credit');

  const scopedPayments = input.payments.filter((payment) => {
    if (payment.customerId !== customerId) return false;
    const scope = branchScope(payment.branchId, scopeBranch);
    if (scope === 'other') return false;
    if (scope === 'legacy-default') includesLegacyUnassignedBranchRecords = true;
    if (voidedSaleIds.has(payment.saleId)) return false;
    if (!statementDayKey(payment.date)) { skippedInvalidRecords += 1; return false; }
    return true;
  });

  const paymentsBySale = new Map<string, number>();
  for (const payment of scopedPayments) {
    paymentsBySale.set(payment.saleId, (paymentsBySale.get(payment.saleId) || 0) + payment.amount);
  }

  const allLines: CustomerStatementLine[] = [];
  const saleById = new Map(completedCreditSales.map((sale) => [sale.id, sale]));

  for (const sale of completedCreditSales) {
    const day = statementDayKey(sale.date);
    const legacyBranch = branchScope(sale.branchId, scopeBranch) === 'legacy-default';
    const initialPaid = Math.max(0, Math.round((sale.paidAmount ?? 0) - (paymentsBySale.get(sale.id) || 0)));
    allLines.push({
      id: `invoice:${sale.id}`,
      kind: 'invoice',
      date: sale.date,
      day,
      reference: sale.receiptNo,
      description: 'အကြွေးဖက် Invoice',
      note: '',
      debit: Math.max(0, Math.round(sale.total)),
      credit: 0,
      balance: 0,
      ...(legacyBranch ? { legacyBranch: true } : {}),
    });
    if (initialPaid > 0) {
      allLines.push({
        id: `initial:${sale.id}`,
        kind: 'payment',
        date: sale.date,
        day,
        reference: sale.receiptNo,
        description: 'စတင်ပေးချေငွေ',
        note: '',
        debit: 0,
        credit: initialPaid,
        balance: 0,
        synthetic: true,
        ...(legacyBranch ? { legacyBranch: true } : {}),
      });
    }
  }

  for (const payment of scopedPayments) {
    const sale = saleById.get(payment.saleId);
    const legacyBranch = branchScope(payment.branchId, scopeBranch) === 'legacy-default';
    allLines.push({
      id: `payment:${payment.id}`,
      kind: 'payment',
      date: payment.date,
      day: statementDayKey(payment.date),
      reference: sale?.receiptNo || '—',
      description: sale ? 'အကြွေးပြန်ဆပ်ငွေ' : 'အကြွေးပြန်ဆပ်ငွေ (Invoice မချိတ်ဆက်ထား)',
      note: payment.note || '',
      debit: 0,
      credit: Math.max(0, Math.round(payment.amount)),
      balance: 0,
      ...(legacyBranch ? { legacyBranch: true } : {}),
    });
  }

  const kindOrder: Record<CustomerStatementLineKind, number> = { invoice: 0, payment: 1 };
  allLines.sort((left, right) => {
    if (left.day !== right.day) return left.day < right.day ? -1 : 1;
    const leftTime = new Date(left.date).getTime();
    const rightTime = new Date(right.date).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    const order = kindOrder[left.kind] - kindOrder[right.kind];
    return order !== 0 ? order : left.id.localeCompare(right.id);
  });

  const fromDate = input.fromDate && input.fromDate !== '' ? input.fromDate : null;
  const toDate = input.toDate && input.toDate !== '' ? input.toDate : null;
  let running = 0;
  let openingBalance = 0;
  const lines: CustomerStatementLine[] = [];
  for (const line of allLines) {
    if (fromDate && line.day < fromDate) {
      running += line.debit - line.credit;
      openingBalance = running;
      continue;
    }
    if (toDate && line.day > toDate) continue;
    running += line.debit - line.credit;
    line.balance = running;
    lines.push(line);
  }

  const totalInvoiced = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalPaid = lines.reduce((sum, line) => sum + line.credit, 0);
  const excludedVoidedPayments = input.payments
    .filter((payment) => payment.customerId === customerId && voidedSaleIds.has(payment.saleId))
    .reduce((sum, payment) => sum + payment.amount, 0);

  return {
    customer: input.customer,
    branch: input.branch,
    currency,
    fromDate,
    toDate,
    openingBalance,
    closingBalance: openingBalance + totalInvoiced - totalPaid,
    currentOutstanding: customerCurrentOutstanding(input.sales, customerId, input.branch),
    totalInvoiced,
    totalPaid,
    invoiceCount: lines.filter((line) => line.kind === 'invoice').length,
    paymentCount: lines.filter((line) => line.kind === 'payment' && !line.synthetic).length,
    lines,
    excludedVoidedInvoices: scopedSales.filter((sale) => sale.status === 'voided').length,
    excludedVoidedPayments,
    includesLegacyUnassignedBranchRecords,
    skippedInvalidRecords,
    generatedAt: input.generatedAt || new Date().toISOString(),
  };
}

export function statementPeriodLabel(statement: Pick<CustomerStatement, 'fromDate' | 'toDate'>): string {
  if (!statement.fromDate && !statement.toDate) return 'အချိန်အားလုံး';
  const from = statement.fromDate ? formatStatementDate(`${statement.fromDate}T00:00:00`) : 'အစ';
  const to = statement.toDate ? formatStatementDate(`${statement.toDate}T00:00:00`) : 'ယနေ့';
  return `${from} မှ ${to}`;
}

export function buildCustomerStatementText(statement: CustomerStatement): string {
  const separator = '--------------------------------';
  const lines = [
    statement.branch.name,
    statement.branch.address || '',
    statement.branch.phone ? `ဖုန်း: ${statement.branch.phone}` : '',
    'CUSTOMER CREDIT STATEMENT',
    `Customer: ${statement.customer.name}`,
    statement.customer.phone ? `ဖုန်း: ${statement.customer.phone}` : '',
    statement.customer.address ? `လိပ်စာ: ${statement.customer.address}` : '',
    `ကာလ: ${statementPeriodLabel(statement)}`,
    separator,
  ];
  for (const line of statement.lines) {
    const amount = line.kind === 'invoice'
      ? `+ ${formatStatementMoney(line.debit, statement.currency)}`
      : `- ${formatStatementMoney(line.credit, statement.currency)}`;
    lines.push(`${formatStatementDate(line.date)} · ${line.reference}`);
    lines.push(`${line.kind === 'invoice' ? 'Invoice' : 'ငွေလက်ခံ'} ${amount} · လက်ကျန် ${formatStatementMoney(line.balance, statement.currency)}`);
    if (line.note) lines.push(`  ${line.note}`);
  }
  lines.push(separator);
  lines.push(`အစ လက်ကျန်: ${formatStatementMoney(statement.openingBalance, statement.currency)}`);
  lines.push(`အကြွေးတင်ငွေ: ${formatStatementMoney(statement.totalInvoiced, statement.currency)}`);
  lines.push(`ငွေလက်ခံ: ${formatStatementMoney(statement.totalPaid, statement.currency)}`);
  lines.push(`ကာလကုန် လက်ကျန်: ${formatStatementMoney(statement.closingBalance, statement.currency)}`);
  lines.push(`လက်ရှိ ကျန်အကြွေး: ${formatStatementMoney(statement.currentOutstanding, statement.currency)}`);
  if (statement.excludedVoidedInvoices > 0) lines.push(`ပယ်ဖျက်ထားသော Invoice ${statement.excludedVoidedInvoices} ခု မပါဝင်ပါ။`);
  if (statement.includesLegacyUnassignedBranchRecords) lines.push('Branch မသတ်မှတ်ထားသော Legacy မှတ်တမ်းများကို Default Branch တွင်သာ ပြထားပါသည်။');
  lines.push(`ထုတ်ပေးသည့်အချိန်: ${formatStatementDate(statement.generatedAt)}`);
  return lines.filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== '')).join('\n');
}
