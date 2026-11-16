import type { ActivityLog } from '../store/usePosStore';

/**
 * Activity log retention policy.
 *
 * Cloud history is never deleted. Devices keep a generous local copy for offline
 * viewing, and sync only the most recent window; anything older is fetched on
 * demand from the cloud.
 */
export const ACTIVITY_LOG_LOCAL_LIMIT = 1000;
export const ACTIVITY_LOG_SYNC_DAYS = 90;
export const ACTIVITY_LOG_QUERY_PAGE_SIZE = 50;

const SYNC_OVERLAP_MS = 120_000;

export function activityLogCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - ACTIVITY_LOG_SYNC_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Start of the incremental activity log query window.
 * Clamps to the retention cutoff so listeners never scan beyond the synced window,
 * while keeping the usual overlap to absorb clock skew.
 */
export function activityLogWindowStart(cursor: string | null | undefined, now: Date = new Date()): string {
  const cutoff = activityLogCutoffIso(now);
  const cursorMs = cursor ? Date.parse(cursor) : Number.NaN;
  if (!cursor || Number.isNaN(cursorMs)) return cutoff;
  const overlapMs = cursorMs - SYNC_OVERLAP_MS;
  return new Date(Math.max(overlapMs, Date.parse(cutoff))).toISOString();
}

function logTimestamp(log: ActivityLog): number {
  const parsed = Date.parse(log.at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Merge cloud activity logs into the local list without losing unsynced local
 * entries. Incoming copies win for the same id; result is newest-first.
 */
export function mergeActivityLogs(
  local: ActivityLog[],
  incoming: ActivityLog[],
  limit: number = ACTIVITY_LOG_LOCAL_LIMIT,
): ActivityLog[] {
  const seen = new Set<string>();
  const merged: ActivityLog[] = [];
  for (const log of [...incoming, ...local]) {
    if (!log || typeof log.id !== 'string' || seen.has(log.id)) continue;
    seen.add(log.id);
    merged.push(log);
  }
  merged.sort((a, b) => logTimestamp(b) - logTimestamp(a));
  return merged.slice(0, limit);
}

export function trimActivityLogs(
  logs: ActivityLog[],
  limit: number = ACTIVITY_LOG_LOCAL_LIMIT,
): ActivityLog[] {
  if (logs.length <= limit) return logs;
  return [...logs].sort((a, b) => logTimestamp(b) - logTimestamp(a)).slice(0, limit);
}
