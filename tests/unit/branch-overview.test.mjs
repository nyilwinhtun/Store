import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBranchOverview } from '../../.qa-build/branchOverview.mjs';

const TODAY = '2026-11-13';

// Mirrors `dayKey(new Date(...))` in src/App.tsx: the app counts sales by the
// local calendar day, so the reference implementation must do the same.
function localDayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function branch(id) {
  return {
    id, name: `Branch ${id}`, code: id.toUpperCase(), address: '', phone: '',
    status: 'active', isDefault: false, createdAt: TODAY, updatedAt: TODAY, settings: {},
  };
}

function product(branchId, id, stock, lowStockAt) {
  return { id, branchId, name: `P${id}`, sku: id, barcode: '', category: 'c', costPrice: 1, retailPrice: 2, wholesalePrice: 2, stock, lowStockAt, unit: 'pcs', quantityMode: 'whole', priceGroupId: '', createdAt: TODAY, updatedAt: TODAY };
}

function sale(branchId, id, date, total, profit, status = 'completed') {
  return { id, branchId, receiptNo: `R${id}`, customer: '', date, total, profit, status, paymentMethod: 'Cash', items: [] };
}

function expense(branchId, id, approvalStatus) {
  return { id, branchId, amount: 1, category: 'x', note: '', date: `${TODAY}T00:00:00.000Z`, approvalStatus, createdByUid: 'u' };
}

function batch(branchId, productId, expiryDate, quantity) {
  return { id: `${branchId}-${productId}-${expiryDate}`, branchId, productId, batchNo: 'b', quantity, expiryDate, receivedAt: TODAY };
}

test('summarizes each branch from a single grouping pass', () => {
  const branches = [branch('a'), branch('b')];
  const input = {
    branches,
    products: [product('a', 'p1', 10, 2), product('a', 'p2', 1, 5), product('b', 'p3', 0, 1)],
    sales: [
      sale('a', 's1', `${TODAY}T08:00:00.000Z`, 100, 30),
      sale('a', 's2', `${TODAY}T09:00:00.000Z`, 50, 10),
      sale('a', 's3', '2026-11-12T09:00:00.000Z', 999, 999),
      sale('a', 's4', `${TODAY}T10:00:00.000Z`, 500, 500, 'voided'),
      sale('b', 's5', `${TODAY}T10:00:00.000Z`, 7, 3),
    ],
    expenses: [expense('a', 'e1', 'pending'), expense('a', 'e2', 'approved'), expense('b', 'e3', 'pending')],
    stockBatches: [batch('a', 'p2', '2026-11-01', 4), batch('a', 'p1', TODAY, 99)],
    cashShifts: [{ branchId: 'a' }, { branchId: 'a', closedAt: `${TODAY}T12:00:00.000Z` }, { branchId: 'b' }],
    todayKey: TODAY,
  };
  const { summaries, totals, recentSales } = buildBranchOverview(input);

  assert.equal(summaries.length, 2);
  assert.deepEqual(
    summaries.map((s) => ({ id: s.branch.id, products: s.productCount, low: s.lowStockCount, count: s.salesCount, revenue: s.revenue, profit: s.profit, pending: s.pendingExpenses, shifts: s.openShiftCount })),
    [
      { id: 'a', products: 2, low: 1, count: 2, revenue: 150, profit: 40, pending: 1, shifts: 1 },
      { id: 'b', products: 1, low: 1, count: 1, revenue: 7, profit: 3, pending: 1, shifts: 1 },
    ],
  );
  assert.deepEqual(totals, { revenue: 157, profit: 43, products: 3, lowStock: 2, pendingExpenses: 2, salesCount: 3 });
  // Recent sales list every completed sale in an active branch, newest first.
  assert.deepEqual(recentSales.map((s) => s.id), ['s5', 's2', 's1', 's3']);
});

test('ignores archived-branch sales and unknown branch records in recent sales', () => {
  const input = {
    branches: [branch('a')],
    products: [],
    sales: [
      sale('a', 's1', `${TODAY}T08:00:00.000Z`, 1, 1),
      sale('gone', 's2', `${TODAY}T09:00:00.000Z`, 1, 1),
      sale('a', 's3', `${TODAY}T10:00:00.000Z`, 1, 1, 'voided'),
    ],
    expenses: [], stockBatches: [], cashShifts: [], todayKey: TODAY,
  };
  const result = buildBranchOverview(input);
  assert.deepEqual(result.recentSales.map((s) => s.id), ['s1']);
  assert.equal(result.totals.salesCount, 1);
});

test('indexed aggregation matches the naive per-branch implementation', () => {
  const branches = Array.from({ length: 8 }, (_, index) => branch(`b${index}`));
  const products = Array.from({ length: 4000 }, (_, index) =>
    product(`b${index % 8}`, `p${index}`, index % 37, 5));
  const sales = Array.from({ length: 20000 }, (_, index) => {
    const day = `${TODAY}T${String(index % 24).padStart(2, '0')}:00:00.000Z`;
    return sale(`b${index % 8}`, `s${index}`, index % 3 === 0 ? day : '2026-11-10T08:00:00.000Z', index % 100, index % 40, index % 11 === 0 ? 'voided' : 'completed');
  });
  const expenses = Array.from({ length: 2000 }, (_, index) => expense(`b${index % 8}`, `e${index}`, index % 2 ? 'pending' : 'approved'));
  const stockBatches = Array.from({ length: 5000 }, (_, index) =>
    batch(`b${index % 8}`, `p${index % 4000}`, index % 2 ? '2026-10-01' : '2027-01-01', index % 4));
  const cashShifts = Array.from({ length: 500 }, (_, index) => ({ branchId: `b${index % 8}`, closedAt: index % 3 === 0 ? `${TODAY}T12:00:00.000Z` : undefined }));

  const input = { branches, products, sales, expenses, stockBatches, cashShifts, todayKey: TODAY };

  function runNaive() {
    return branches.map((item) => {
      const branchProducts = products.filter((record) => record.branchId === item.id);
      const branchSales = sales.filter((record) => record.branchId === item.id && record.status === 'completed');
      const todaySales = branchSales.filter((record) => localDayKey(record.date) === TODAY);
      const branchExpenses = expenses.filter((record) => record.branchId === item.id);
      const pendingExpenses = branchExpenses.filter((record) => record.approvalStatus === 'pending').length;
      const expired = new Map();
      for (const record of stockBatches) {
        if (record.branchId === item.id && record.expiryDate && record.expiryDate < TODAY && record.quantity > 0) {
          expired.set(record.productId, (expired.get(record.productId) || 0) + record.quantity);
        }
      }
      return {
        id: item.id,
        productCount: branchProducts.length,
        lowStockCount: branchProducts.filter((record) => Math.max(0, record.stock - (expired.get(record.id) || 0)) <= record.lowStockAt).length,
        salesCount: todaySales.length,
        revenue: todaySales.reduce((sum, record) => sum + record.total, 0),
        profit: todaySales.reduce((sum, record) => sum + record.profit, 0),
        pendingExpenses,
        openShiftCount: cashShifts.filter((record) => record.branchId === item.id && !record.closedAt).length,
      };
    });
  }

  // Warm both implementations up so the comparison is not dominated by JIT cold starts.
  buildBranchOverview(input);
  runNaive();

  const indexedRuns = [];
  const naiveRuns = [];
  let indexed = buildBranchOverview(input);
  let naive = runNaive();
  for (let round = 0; round < 5; round += 1) {
    const startIndexed = performance.now();
    indexed = buildBranchOverview(input);
    indexedRuns.push(performance.now() - startIndexed);
    const startNaive = performance.now();
    naive = runNaive();
    naiveRuns.push(performance.now() - startNaive);
  }
  const median = (runs) => [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  const indexedMs = median(indexedRuns);
  const naiveMs = median(naiveRuns);

  assert.deepEqual(
    indexed.summaries.map((s) => ({
      id: s.branch.id, productCount: s.productCount, lowStockCount: s.lowStockCount, salesCount: s.salesCount,
      revenue: s.revenue, profit: s.profit, pendingExpenses: s.pendingExpenses, openShiftCount: s.openShiftCount,
    })),
    naive,
  );
  assert.deepEqual(indexed.totals, {
    revenue: naive.reduce((sum, item) => sum + item.revenue, 0),
    profit: naive.reduce((sum, item) => sum + item.profit, 0),
    products: naive.reduce((sum, item) => sum + item.productCount, 0),
    lowStock: naive.reduce((sum, item) => sum + item.lowStockCount, 0),
    pendingExpenses: naive.reduce((sum, item) => sum + item.pendingExpenses, 0),
    salesCount: naive.reduce((sum, item) => sum + item.salesCount, 0),
  });

  console.log(`benchmark: indexed ${indexedMs.toFixed(1)}ms vs naive ${naiveMs.toFixed(1)}ms (8 branches, 20k sales, 4k products, 5k batches)`);
  assert.ok(indexedMs < 1500, `indexed aggregation took ${indexedMs}ms`);
});
