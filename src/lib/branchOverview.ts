import type { Branch, Expense, Product, Sale, StockBatch } from '../store/usePosStore';

export type BranchOverviewInput = {
  branches: Branch[];
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  stockBatches: StockBatch[];
  cashShifts: Array<{ branchId?: string; closedAt?: string }>;
  todayKey: string;
};

export type BranchOverviewSummary = {
  branch: Branch;
  productCount: number;
  lowStockCount: number;
  salesCount: number;
  revenue: number;
  profit: number;
  pendingExpenses: number;
  openShiftCount: number;
};

export type BranchOverviewTotals = {
  revenue: number;
  profit: number;
  products: number;
  lowStock: number;
  pendingExpenses: number;
  salesCount: number;
};

const RECENT_SALES_LIMIT = 8;

function pushToGroup<T>(map: Map<string, T[]>, branchId: string, record: T): void {
  const list = map.get(branchId);
  if (list) list.push(record);
  else map.set(branchId, [record]);
}

type TimedSale = { sale: Sale; time: number; isToday: boolean };

/**
 * Builds the Branch Overview in one pass per collection. The previous
 * implementation re-filtered every collection once per branch, which is
 * O(branches × records); this is O(records + branches × branch records).
 */
export function buildBranchOverview(input: BranchOverviewInput) {
  const productsByBranch = new Map<string, Product[]>();
  const completedSalesByBranch = new Map<string, TimedSale[]>();
  const expensesByBranch = new Map<string, Expense[]>();
  const expiredUnitsByBranch = new Map<string, Map<string, number>>();
  const openShiftsByBranch = new Map<string, number>();

  const [todayYear, todayMonth, todayDay] = input.todayKey.split('-').map(Number);

  for (const product of input.products) {
    if (product.branchId) pushToGroup(productsByBranch, product.branchId, product);
  }
  const activeBranchIds = new Set(input.branches.map((branch) => branch.id));
  const recentSales: TimedSale[] = [];
  for (const sale of input.sales) {
    if (sale.status !== 'completed' || !sale.branchId) continue;
    const date = new Date(sale.date);
    const time = date.getTime();
    // One parse per sale serves both today's totals and the recent list.
    const entry: TimedSale = {
      sale,
      time,
      isToday: date.getFullYear() === todayYear && date.getMonth() + 1 === todayMonth && date.getDate() === todayDay,
    };
    pushToGroup(completedSalesByBranch, sale.branchId, entry);
    if (!activeBranchIds.has(sale.branchId)) continue;
    if (recentSales.length === RECENT_SALES_LIMIT && time <= recentSales[RECENT_SALES_LIMIT - 1].time) continue;
    let index = recentSales.length;
    while (index > 0 && recentSales[index - 1].time < time) index -= 1;
    recentSales.splice(index, 0, entry);
    if (recentSales.length > RECENT_SALES_LIMIT) recentSales.pop();
  }
  for (const expense of input.expenses) {
    if (expense.branchId) pushToGroup(expensesByBranch, expense.branchId, expense);
  }
  for (const batch of input.stockBatches) {
    if (!batch.branchId || !batch.expiryDate || batch.expiryDate >= input.todayKey || batch.quantity <= 0) continue;
    let units = expiredUnitsByBranch.get(batch.branchId);
    if (!units) { units = new Map<string, number>(); expiredUnitsByBranch.set(batch.branchId, units); }
    units.set(batch.productId, (units.get(batch.productId) || 0) + batch.quantity);
  }
  for (const shift of input.cashShifts) {
    if (!shift.branchId || shift.closedAt) continue;
    openShiftsByBranch.set(shift.branchId, (openShiftsByBranch.get(shift.branchId) || 0) + 1);
  }

  const summaries: BranchOverviewSummary[] = input.branches.map((branch) => {
    const branchProducts = productsByBranch.get(branch.id) || [];
    const todayBranchSales = (completedSalesByBranch.get(branch.id) || []).filter((entry) => entry.isToday);
    const pendingExpenses = (expensesByBranch.get(branch.id) || [])
      .filter((expense) => expense.approvalStatus === 'pending').length;
    const branchExpiredUnits = expiredUnitsByBranch.get(branch.id);
    const lowStockCount = branchProducts.filter((product) =>
      Math.max(0, product.stock - (branchExpiredUnits?.get(product.id) || 0)) <= product.lowStockAt).length;
    return {
      branch,
      productCount: branchProducts.length,
      lowStockCount,
      salesCount: todayBranchSales.length,
      revenue: todayBranchSales.reduce((sum, entry) => sum + entry.sale.total, 0),
      profit: todayBranchSales.reduce((sum, entry) => sum + entry.sale.profit, 0),
      pendingExpenses,
      openShiftCount: openShiftsByBranch.get(branch.id) || 0,
    };
  });

  const totals = summaries.reduce<BranchOverviewTotals>((sum, summary) => ({
    revenue: sum.revenue + summary.revenue,
    profit: sum.profit + summary.profit,
    products: sum.products + summary.productCount,
    lowStock: sum.lowStock + summary.lowStockCount,
    pendingExpenses: sum.pendingExpenses + summary.pendingExpenses,
    salesCount: sum.salesCount + summary.salesCount,
  }), { revenue: 0, profit: 0, products: 0, lowStock: 0, pendingExpenses: 0, salesCount: 0 });

  return { summaries, totals, recentSales: recentSales.map((entry) => entry.sale) };
}
