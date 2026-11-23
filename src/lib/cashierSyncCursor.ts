/**
 * Cashier incremental listener cursors for the cash collections.
 *
 * Cashier devices previously re-downloaded cashShifts, cashMovements and
 * customerPayments in full on every startup. These collections grow forever, so
 * the recurring read cost grew with the business. After the first full snapshot
 * each device now listens only for documents updated since its own cursor.
 *
 * Older history is never deleted: ApplyToStore merges listener results into the
 * locally persisted records, so shift totals, the shared customer ledger and
 * the CSV export keep using the complete local dataset.
 */
export type CashierCursorKind = 'cashShifts' | 'cashMovements' | 'customerPayments';

const CURSOR_PREFIX = 'minimart-cashier-cursor-v1';
const SYNC_OVERLAP_MS = 120_000;

export function cashierCursorKey(businessId: string, uid: string, branchId: string, kind: CashierCursorKind): string {
  return `${CURSOR_PREFIX}:${businessId}:${uid}:${branchId}:${kind}`;
}

export function readCashierCursor(businessId: string, uid: string, branchId: string, kind: CashierCursorKind): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(cashierCursorKey(businessId, uid, branchId, kind));
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

export function saveCashierCursor(businessId: string, uid: string, branchId: string, kind: CashierCursorKind, value: string): void {
  try {
    if (typeof localStorage === 'undefined' || Number.isNaN(Date.parse(value))) return;
    localStorage.setItem(cashierCursorKey(businessId, uid, branchId, kind), value);
  } catch {
    // A missing cursor only costs a full re-read on the next startup.
  }
}

export function clearCashierCursors(businessId: string, uid: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const prefix = `${CURSOR_PREFIX}:${businessId}:${uid}:`;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Best-effort cleanup; an unusable cursor falls back to a full read below.
  }
}

/**
 * Incremental listening requires a previous cursor, locally persisted history to
 * merge into, and a completed store hydration. A local reset or an empty local
 * dataset must always fall back to a full read so no history is skipped.
 */
export function shouldUseIncrementalCursor(options: {
  cursor: string | null;
  localRecordCount: number;
  resetPending: boolean;
  hydrated: boolean;
}): boolean {
  return !!options.cursor
    && !options.resetPending
    && options.hydrated
    && options.localRecordCount > 0;
}

export function incrementalCursorQueryStart(cursor: string): string {
  const timestamp = Date.parse(cursor);
  if (Number.isNaN(timestamp)) return cursor;
  return new Date(timestamp - SYNC_OVERLAP_MS).toISOString();
}

/** Highest `updatedAt` seen in a server snapshot; null when nothing usable is present. */
export function nextCashierCursor(previous: string | null, updatedAtValues: Array<string | null | undefined>): string | null {
  let max = previous;
  for (const value of updatedAtValues) {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) continue;
    if (!max || value > max) max = value;
  }
  return max;
}

/** Union of persisted and incoming records; incoming wins for the same id. */
export function mergeById<T extends { id: string }>(local: T[], incoming: T[]): T[] {
  const merged = new Map<string, T>();
  local.forEach((record) => merged.set(record.id, record));
  incoming.forEach((record) => merged.set(record.id, record));
  return [...merged.values()];
}
