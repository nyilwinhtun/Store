import type { Sale, StockUnit, StockUnitRegistry } from '../store/usePosStore';

/**
 * Cloud registry snapshots are read-only for Cashiers. A unit sold on this
 * device may be marked sold locally before the durable queue is acknowledged,
 * but only a Sale the server has confirmed may override a stale Cloud snapshot.
 * Pending or review-blocked Sales never establish a local sold claim, and a
 * voided Sale drops it so the Cloud status wins.
 */
export function mergeCashierUnitRegistries(
  current: StockUnitRegistry[],
  incoming: StockUnitRegistry[],
  branchId: string,
  sales: Sale[],
): StockUnitRegistry[] {
  const completedSaleIds = new Set(
    sales.filter((sale) => sale.branchId === branchId && sale.status === 'completed'
      && sale.cloudSyncStatus === 'synced').map((sale) => sale.id),
  );
  const localUnits = new Map<string, StockUnit>();
  current
    .filter((registry) => registry.branchId === branchId)
    .forEach((registry) => registry.units.forEach((unit) => localUnits.set(unit.id, unit)));

  const merged = incoming.map((registry) => ({
    ...registry,
    units: registry.units.map((unit) => {
      const local = localUnits.get(unit.id);
      if (!local || local.status !== 'sold' || !local.saleId) return unit;
      if (!completedSaleIds.has(local.saleId)) return unit;
      // Keep the local sold claim until the Cloud copy carries the same claim.
      if (unit.status === 'sold' && unit.saleId === local.saleId) return unit;
      return local;
    }),
  }));

  return [...current.filter((registry) => registry.branchId !== branchId), ...merged];
}
