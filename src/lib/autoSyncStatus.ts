import { firebaseRuntime } from './firebaseRuntime';

export type AutoSyncState = 'idle' | 'connecting' | 'synced' | 'offline' | 'conflict' | 'error';
export type AutoSyncStatus = { state: AutoSyncState; message: string; savedAt?: string; conflictCount?: number; conflictKeys?: string[] };
export const AUTO_SYNC_STATUS_EVENT = 'minimart-auto-sync-status-changed';

// Status is local UI metadata. Namespace it by the active Business so a Staging
// session can never read or overwrite the Production status key (and vice versa).
export const UNRESOLVED_AUTO_SYNC_NAMESPACE = 'unresolved';
const AUTO_SYNC_STATUS_PREFIX = 'minimart-auto-sync-status';

export function activeAutoSyncBusinessId(): string {
  return typeof firebaseRuntime.businessId === 'string' ? firebaseRuntime.businessId.trim() : '';
}

export function autoSyncStatusKey(uid: string, businessId: string = activeAutoSyncBusinessId()): string {
  const namespace = businessId.trim() || UNRESOLVED_AUTO_SYNC_NAMESPACE;
  return `${AUTO_SYNC_STATUS_PREFIX}:${namespace}:${uid}`;
}

export function publishAutoSyncStatus(uid: string, status: AutoSyncStatus, businessId: string = activeAutoSyncBusinessId()) {
  if (businessId.trim()) {
    try { localStorage.setItem(autoSyncStatusKey(uid, businessId), JSON.stringify(status)); } catch { /* UI status is non-critical. */ }
  }
  window.dispatchEvent(new CustomEvent(AUTO_SYNC_STATUS_EVENT, { detail: { uid, status } }));
}

export function readAutoSyncStatus(uid: string, businessId: string = activeAutoSyncBusinessId()): AutoSyncStatus {
  if (!businessId.trim()) return { state: 'idle', message: 'Sync Baseline မရှိသေးပါ။ Initial Snapshot လုပ်ပါ။' };
  try {
    const value = JSON.parse(localStorage.getItem(autoSyncStatusKey(uid, businessId)) || 'null') as AutoSyncStatus | null;
    if (value && typeof value.state === 'string' && typeof value.message === 'string') return value;
  } catch { /* Ignore a damaged status cache. */ }
  return { state: 'idle', message: 'Sync Baseline မရှိသေးပါ။ Initial Snapshot လုပ်ပါ။' };
}
