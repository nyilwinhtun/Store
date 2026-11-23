import type { Branch, Product } from '../store/usePosStore';
import { normalizeBarcode } from './barcode';
import type { AutoSyncState } from './autoSyncStatus';

export const POS_ALL_CATEGORIES = 'အားလုံး';

export type PosProductView = 'loading' | 'offline' | 'empty' | 'ready';

/**
 * Local storage starts with a placeholder branch. Until the first cloud
 * snapshot lands, an empty list is not an authoritative "no products".
 */
export function posProductViewState(productCount: number, syncState: AutoSyncState): PosProductView {
  if (productCount > 0) return 'ready';
  if (syncState === 'idle' || syncState === 'connecting') return 'loading';
  if (syncState === 'offline' || syncState === 'error') return 'offline';
  return 'empty';
}

export function productsForBranch(products: readonly Product[], branchId: string): Product[] {
  return products.filter((product) => product.branchId === branchId);
}

export function filterPosProducts(products: readonly Product[], search: string, category: string): Product[] {
  const query = search.trim().toLowerCase();
  const normalizedQuery = normalizeBarcode(query);
  return products.filter((product) => {
    const matchesSearch = !query
      || product.name.toLowerCase().includes(query)
      || product.sku.toLowerCase().includes(query)
      || normalizeBarcode(product.barcode).toLowerCase().includes(normalizedQuery);
    return matchesSearch && (category === POS_ALL_CATEGORIES || product.category === category);
  });
}

export function sellableStockFor(product: Pick<Product, 'id' | 'stock'>, expiredUnits: ReadonlyMap<string, number>): number {
  return Math.max(0, product.stock - (expiredUnits.get(product.id) || 0));
}

export function isProductSelectable(product: Pick<Product, 'id' | 'stock'>, expiredUnits: ReadonlyMap<string, number>): boolean {
  return sellableStockFor(product, expiredUnits) > 0;
}

export type OtherBranchProductCount = { id: string; name: string; count: number };

/** Active branches other than the selected one that currently hold products. */
export function otherBranchProductCounts(
  branches: ReadonlyArray<Pick<Branch, 'id' | 'name'>>,
  products: ReadonlyArray<Pick<Product, 'branchId'>>,
  activeBranchId: string,
): OtherBranchProductCount[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    if (!product.branchId || product.branchId === activeBranchId) continue;
    counts.set(product.branchId, (counts.get(product.branchId) || 0) + 1);
  }
  return branches
    .filter((branch) => branch.id !== activeBranchId)
    .map((branch) => ({ id: branch.id, name: branch.name, count: counts.get(branch.id) || 0 }))
    .filter((branch) => branch.count > 0);
}
