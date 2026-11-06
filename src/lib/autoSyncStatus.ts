export type AutoSyncState = 'idle' | 'connecting' | 'synced' | 'offline' | 'conflict' | 'error';
export type AutoSyncStatus = { state: AutoSyncState; message: string; savedAt?: string; conflictCount?: number };
export const AUTO_SYNC_STATUS_EVENT = 'minimart-auto-sync-status-changed';
export const autoSyncStatusKey = (uid: string) => `minimart-auto-sync-status:store-mini-main:${uid}`;

export function publishAutoSyncStatus(uid: string, status: AutoSyncStatus) {
  try { localStorage.setItem(autoSyncStatusKey(uid), JSON.stringify(status)); } catch { /* UI status is non-critical. */ }
  window.dispatchEvent(new CustomEvent(AUTO_SYNC_STATUS_EVENT, { detail: { uid, status } }));
}

export function readAutoSyncStatus(uid: string): AutoSyncStatus {
  try {
    const value = JSON.parse(localStorage.getItem(autoSyncStatusKey(uid)) || 'null') as AutoSyncStatus | null;
    if (value && typeof value.state === 'string' && typeof value.message === 'string') return value;
  } catch { /* Ignore a damaged status cache. */ }
  return { state: 'idle', message: 'Sync Baseline မရှိသေးပါ။ Initial Snapshot လုပ်ပါ။' };
}
