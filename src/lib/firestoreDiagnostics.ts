import { firebaseConfig, FIREBASE_BUSINESS_ID } from './firebase';

export type FirestoreActivityKind = 'read' | 'write' | 'delete' | 'listenerStart';
type HourBucket = {
  hourStart: number;
  reads: number;
  writes: number;
  deletes: number;
  listenerStarts: number;
  operations: Record<string, number>;
};
type StoredDiagnostics = { version: 1; buckets: HourBucket[] };
export type FirestoreDiagnosticsSummary = {
  reads: number;
  writes: number;
  deletes: number;
  listenerStarts: number;
  operations: Record<string, number>;
  updatedAt: number | null;
};

export const FIRESTORE_DIAGNOSTICS_EVENT = 'minimart-firestore-diagnostics-changed';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_BUCKETS = 25;
const STORAGE_PREFIX = 'minimart-firestore-local-diagnostics-v1';

function storageKey(uid: string): string {
  return `${STORAGE_PREFIX}:${firebaseConfig.projectId}:${FIREBASE_BUSINESS_ID}:${uid || 'anonymous'}`;
}

function load(uid: string): StoredDiagnostics {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(uid)) || 'null') as StoredDiagnostics | null;
    if (parsed?.version === 1 && Array.isArray(parsed.buckets)) return parsed;
  } catch { /* Local diagnostics are optional and must never block POS. */ }
  return { version: 1, buckets: [] };
}

function save(uid: string, value: StoredDiagnostics): void {
  try { localStorage.setItem(storageKey(uid), JSON.stringify(value)); } catch { /* Keep app functional when storage is full or unavailable. */ }
  try { window.dispatchEvent(new CustomEvent(FIRESTORE_DIAGNOSTICS_EVENT, { detail: { uid } })); } catch { /* Event notification is optional. */ }
}

export function recordFirestoreActivity(
  uid: string,
  kind: FirestoreActivityKind,
  operation: string,
  documents = 1,
): void {
  if (typeof window === 'undefined' || documents <= 0) return;
  const now = Date.now();
  const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
  const stored = load(uid);
  const recent = stored.buckets.filter((bucket) => now - bucket.hourStart < WINDOW_MS && bucket.hourStart <= now);
  let bucket = recent.find((entry) => entry.hourStart === hourStart);
  if (!bucket) {
    bucket = { hourStart, reads: 0, writes: 0, deletes: 0, listenerStarts: 0, operations: {} };
    recent.push(bucket);
  }
  if (kind === 'read') bucket.reads += documents;
  else if (kind === 'write') bucket.writes += documents;
  else if (kind === 'delete') bucket.deletes += documents;
  else bucket.listenerStarts += documents;
  bucket.operations[`${kind}:${operation}`] = (bucket.operations[`${kind}:${operation}`] || 0) + documents;
  const buckets = recent.sort((a, b) => a.hourStart - b.hourStart).slice(-MAX_BUCKETS);
  save(uid, { version: 1, buckets });
}

export function readFirestoreDiagnostics(uid: string): FirestoreDiagnosticsSummary {
  const now = Date.now();
  const buckets = load(uid).buckets.filter((bucket) => now - bucket.hourStart < WINDOW_MS && bucket.hourStart <= now);
  const summary: FirestoreDiagnosticsSummary = { reads: 0, writes: 0, deletes: 0, listenerStarts: 0, operations: {}, updatedAt: null };
  for (const bucket of buckets) {
    summary.reads += bucket.reads;
    summary.writes += bucket.writes;
    summary.deletes += bucket.deletes;
    summary.listenerStarts += bucket.listenerStarts;
    summary.updatedAt = Math.max(summary.updatedAt || 0, bucket.hourStart);
    for (const [name, count] of Object.entries(bucket.operations)) summary.operations[name] = (summary.operations[name] || 0) + count;
  }
  return summary;
}

export function clearFirestoreDiagnostics(uid: string): void {
  try { localStorage.removeItem(storageKey(uid)); } catch { /* Local diagnostics are optional. */ }
  try { window.dispatchEvent(new CustomEvent(FIRESTORE_DIAGNOSTICS_EVENT, { detail: { uid } })); } catch { /* Event notification is optional. */ }
}
