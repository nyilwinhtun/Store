import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomerStatement,
  buildCustomerStatementText,
  customerCurrentOutstanding,
  formatStatementMoney,
  saleOutstandingDue,
} from '../.qa-build/customerStatement.mjs';

const mainBranch = { id: 'branch-main', name: 'မင်္ဂလာ မီနီမာ့တ် (ဗိုလ်ချုပ်လမ်း)', code: 'MM-01', address: 'ရန်ကုန်', phone: '09-790000001', isDefault: true };
const otherBranch = { id: 'branch-lanmadaw', name: 'မင်္ဂလာ မီနီမာ့တ် (လမ်းမတော်)', code: 'MM-02', address: 'ရန်ကုန်', phone: '09-790000002', isDefault: false };
const customer = { id: 'cust-aung', name: 'ဦးအောင်မြင့်', phone: '09-770000001', address: 'ရန်ကုန်' };
const otherCustomer = { id: 'cust-thiri', name: 'ဒေါ်သီရိလှ', phone: '09-770000002', address: 'ရန်ကုန်' };

const sale = (overrides) => ({
  id: 'sale', receiptNo: 'MM-1', date: '2026-10-05T12:00:00', customer: customer.name, customerId: customer.id,
  paymentMethod: 'Credit', items: [], subtotal: 0, discount: 0, total: 0, profit: 0,
  paidAmount: 0, dueAmount: 0, status: 'completed', branchId: mainBranch.id,
  ...overrides,
});
const payment = (overrides) => ({
  id: 'pay', customerId: customer.id, saleId: 'sale', amount: 0, date: '2026-10-12T12:00:00',
  note: '', paymentMethod: 'Cash', branchId: mainBranch.id, ...overrides,
});

const baseSales = [
  sale({ id: 'sale-m1', receiptNo: 'MM-20261005-00001', date: '2026-10-05T12:00:00', total: 49000, paidAmount: 10000, dueAmount: 39000 }),
  sale({ id: 'sale-m2', receiptNo: 'MM-20261028-00002', date: '2026-10-28T12:00:00', total: 59500, paidAmount: 0, dueAmount: 59500 }),
  sale({ id: 'sale-void', receiptNo: 'MM-20261104-00005', date: '2026-11-04T12:00:00', total: 8000, paidAmount: 0, dueAmount: 8000, status: 'voided', voidedAt: '2026-11-04T13:00:00' }),
  sale({ id: 'sale-legacy', receiptNo: 'MM-20260920-00006', date: '2026-09-20T12:00:00', total: 27100, paidAmount: undefined, dueAmount: undefined, branchId: undefined }),
  sale({ id: 'sale-m3', receiptNo: 'MM-20261101-00007', date: '2026-11-01T12:00:00', total: 18500, paidAmount: 5000, dueAmount: 13500 }),
  sale({ id: 'sale-cash', receiptNo: 'MM-20261102-00003', date: '2026-11-02T12:00:00', paymentMethod: 'Cash', total: 7200, paidAmount: 7200, dueAmount: 0 }),
  sale({ id: 'sale-void-pay', receiptNo: 'MM-20261104-00008', date: '2026-11-04T12:00:00', total: 8000, paidAmount: 8000, dueAmount: 0, status: 'voided' }),
  sale({ id: 'sale-other', receiptNo: 'MM-20261103-00001', date: '2026-11-03T12:00:00', total: 6400, paidAmount: 0, dueAmount: 6400, branchId: otherBranch.id }),
  sale({ id: 'sale-other-customer', receiptNo: 'MM-20261103-00002', date: '2026-11-03T12:00:00', total: 9999, paidAmount: 0, dueAmount: 9999, customerId: otherCustomer.id, customer: otherCustomer.name }),
];

const basePayments = [
  payment({ id: 'pay-1', saleId: 'sale-m1', amount: 10000, date: '2026-10-12T12:00:00', note: 'အောက်တိုဘာ ကြိုတင်ငွေ' }),
  payment({ id: 'pay-2', saleId: 'sale-m3', amount: 5000, date: '2026-11-02T12:00:00' }),
  payment({ id: 'pay-void', saleId: 'sale-void-pay', amount: 8000, date: '2026-11-05T12:00:00' }),
  payment({ id: 'pay-other-branch', saleId: 'sale-other', amount: 1000, date: '2026-11-06T12:00:00', branchId: otherBranch.id }),
  payment({ id: 'pay-other-customer', customerId: otherCustomer.id, saleId: 'sale-m2', amount: 4000, date: '2026-11-06T12:00:00' }),
];

function statement(overrides = {}) {
  return buildCustomerStatement({
    customer, branch: mainBranch, sales: baseSales, payments: basePayments,
    generatedAt: '2026-11-13T03:00:00', ...overrides,
  });
}

test('existing outstanding formula is reused for completed credit sales only', () => {
  assert.equal(saleOutstandingDue({ paymentMethod: 'Credit', total: 27100, paidAmount: undefined, dueAmount: undefined }), 27100);
  assert.equal(saleOutstandingDue({ paymentMethod: 'Credit', total: 49000, paidAmount: 10000, dueAmount: 39000 }), 39000);
  assert.equal(saleOutstandingDue({ paymentMethod: 'Cash', total: 7200, paidAmount: 7200, dueAmount: 0 }), 0);
  assert.equal(customerCurrentOutstanding(baseSales, customer.id, mainBranch), 139100);
});

test('statement is scoped to one customer and one Branch', () => {
  const result = statement();
  const ids = result.lines.map((line) => line.id);
  assert.equal(ids.some((id) => id.includes('sale-other')), false, 'other Branch sale must be excluded');
  assert.equal(ids.some((id) => id.includes('sale-other-customer')), false, 'other customer must be excluded');
  assert.equal(ids.some((id) => id.includes('pay-other-branch')), false, 'other Branch payment must be excluded');
  assert.equal(ids.some((id) => id.includes('pay-other-customer')), false, 'other customer payment must be excluded');
  assert.equal(result.currentOutstanding, 139100);
});

test('running balance, opening balance and closing balance reconcile', () => {
  const result = statement({ fromDate: '2026-10-28', toDate: '2026-11-13' });
  assert.equal(result.openingBalance, 66100);
  assert.deepEqual(result.lines.map((line) => line.balance), [125600, 144100, 139100]);
  assert.equal(result.totalInvoiced, 78000);
  assert.equal(result.totalPaid, 5000);
  assert.equal(result.closingBalance, 139100);
  assert.equal(result.invoiceCount, 2);
  assert.equal(result.paymentCount, 1);
  assert.equal(result.lines[0].day, '2026-10-28');
  assert.equal(result.lines.at(-1).day, '2026-11-02');
});

test('full history closes at the same outstanding balance', () => {
  const result = statement();
  assert.equal(result.openingBalance, 0);
  assert.equal(result.closingBalance, 139100);
  assert.equal(result.invoiceCount, 4);
  assert.equal(result.paymentCount, 2);
  assert.equal(result.includesLegacyUnassignedBranchRecords, true);
});

test('down payments that have no CustomerPayment record become a synthetic credit', () => {
  const result = buildCustomerStatement({
    customer, branch: mainBranch,
    sales: [sale({ id: 'sale-down', total: 50000, paidAmount: 20000, dueAmount: 30000, date: '2026-11-01T12:00:00' })],
    payments: [], generatedAt: '2026-11-13T03:00:00',
  });
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].kind, 'invoice');
  assert.equal(result.lines[0].debit, 50000);
  assert.equal(result.lines[1].kind, 'payment');
  assert.equal(result.lines[1].synthetic, true);
  assert.equal(result.lines[1].credit, 20000);
  assert.equal(result.closingBalance, 30000);
});

test('voided invoices and payments linked to them are excluded and reported', () => {
  const result = statement();
  assert.equal(result.lines.some((line) => line.id.includes('sale-void')), false);
  assert.equal(result.lines.some((line) => line.id.includes('pay-void')), false);
  assert.equal(result.excludedVoidedInvoices, 2);
  assert.equal(result.excludedVoidedPayments, 8000);
});

test('legacy sales without paidAmount or dueAmount use the existing fallback', () => {
  const result = statement({ fromDate: '2026-09-01', toDate: '2026-09-30' });
  const legacyLine = result.lines.find((line) => line.id === 'invoice:sale-legacy');
  assert.ok(legacyLine);
  assert.equal(legacyLine.debit, 27100);
  assert.equal(legacyLine.legacyBranch, true);
  assert.equal(result.closingBalance, 27100);
});

test('unassigned legacy records never appear on a non-default Branch', () => {
  const result = buildCustomerStatement({
    customer, branch: otherBranch, sales: baseSales, payments: basePayments, generatedAt: '2026-11-13T03:00:00',
  });
  assert.equal(result.lines.some((line) => line.id === 'invoice:sale-legacy'), false);
  assert.equal(result.includesLegacyUnassignedBranchRecords, false);
  assert.equal(result.currentOutstanding, 6400);
});

test('invalid date input fails closed', () => {
  assert.throws(() => statement({ fromDate: '28-10-2026' }), /YYYY-MM-DD/);
  assert.throws(() => statement({ fromDate: '2026-11-30', toDate: '2026-11-01' }), /must not be after/);
});

test('statement text is Myanmar-safe and uses MMK formatting', () => {
  const result = statement({ fromDate: '2026-10-28', toDate: '2026-11-13' });
  const text = buildCustomerStatementText(result);
  assert.match(text, /CUSTOMER CREDIT STATEMENT/);
  assert.match(text, /ဦးအောင်မြင့်/);
  assert.match(text, /139,100 MMK/);
  assert.match(text, /လက်ရှိ ကျန်အကြွေး/);
  assert.match(text, /ပယ်ဖျက်ထားသော Invoice 2 ခု မပါဝင်ပါ။/);
  assert.equal(formatStatementMoney(1234567, 'MMK'), '1,234,567 MMK');
});
