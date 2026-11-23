import { readDurableValue, writeDurableValue } from './persistentStateStorage';
import { firebaseRuntime } from './firebaseRuntime';
import { isManifestSupersededByReset } from './syncSafety';
import type { ManifestEntry, SyncManifest } from './syncTypes';

/**
 * Durable Owner sync manifest.
 *
 * The full manifest describes every synced record and grows with the business,
 * so IndexedDB is the source of truth. A tiny LocalStorage marker records that a
 * baseline was saved, and the previous LocalStorage manifest key is migrated
 * once and then removed. Reads are served from an in-memory cache that the sync
 * engine preloads before it attaches listeners; that keeps reconciliation
 * synchronous without re-parsing the whole manifest from LocalStorage.
 */
const DURABLE_PREFIX = 'minimart-sync-manifest-v2';
const LEGACY_PREFIX = 'minimart-cloud-sync-manifest-v2';
const MARKER_PREFIX = 'minimart-sync-manifest-marker-v3';
const UPDATED_EVENT = 'minimart-cloud-manifest-updated';
const FAILED_EVENT = 'minimart-cloud-manifest-write-failed';
const PRELOAD_TIMEOUT_MS = 4_000;

const cache = new Map<string, SyncManifest | null>();
const preloading = new Map<string, Promise<SyncManifest | null>>();

// Emulator keeps its existing keys. Each cloud target gets its own baseline
// namespace so a demo/emulator manifest can never authorize a cloud write and
// Staging can never reuse a Production manifest.
const STORAGE_SCOPE = firebaseRuntime.mode === 'emulator' ? '' : `:${firebaseRuntime.projectId}`;

function cacheKey(uid: string, businessId: string): string {
  return `${businessId}:${uid}${STORAGE_SCOPE}`;
}

export function manifestStorageKey(uid: string, businessId: string): string {
  return `${DURABLE_PREFIX}:${businessId}:${uid}${STORAGE_SCOPE}`;
}

export function legacyManifestStorageKey(uid: string, businessId: string): string {
  return `${LEGACY_PREFIX}:${businessId}:${uid}${STORAGE_SCOPE}`;
}

function markerKey(uid: string, businessId: string): string {
  return `${MARKER_PREFIX}:${businessId}:${uid}${STORAGE_SCOPE}`;
}

function dispatch(name: string, uid: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(name, { detail: { uid } }));
  } catch {
    // UI notification is optional.
  }
}

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ManifestEntry>;
  return (entry.scope === 'branch' || entry.scope === 'branchRecord' || entry.scope === 'shared' || entry.scope === 'meta')
    && typeof entry.kind === 'string' && entry.kind.length > 0
    && typeof entry.id === 'string' && entry.id.length > 0
    && typeof entry.hash === 'string'
    && (entry.branchId === undefined || typeof entry.branchId === 'string');
}

/** Pure parser shared by IndexedDB, legacy LocalStorage and unit tests. */
export function parseManifest(raw: string, businessId: string): SyncManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<SyncManifest>;
  if (candidate.version !== 2 || candidate.businessId !== businessId) return null;
  if (typeof candidate.savedAt !== 'string' || Number.isNaN(Date.parse(candidate.savedAt))) return null;
  if (!candidate.records || typeof candidate.records !== 'object' || Array.isArray(candidate.records)) return null;
  const records: Record<string, ManifestEntry> = {};
  for (const [key, entry] of Object.entries(candidate.records as Record<string, unknown>)) {
    if (!isManifestEntry(entry)) return null;
    records[key] = entry;
  }
  return { version: 2, businessId, savedAt: candidate.savedAt, records };
}

function readLegacyManifest(uid: string, businessId: string): SyncManifest | null {
  const store = localStore();
  if (!store) return null;
  try {
    const raw = store.getItem(legacyManifestStorageKey(uid, businessId));
    if (!raw) return null;
    const parsed = parseManifest(raw, businessId);
    if (!parsed) return null;
    if (isManifestSupersededByReset(parsed.savedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeMarker(uid: string, businessId: string, savedAt: string): boolean {
  const store = localStore();
  if (!store) return false;
  try {
    store.setItem(markerKey(uid, businessId), JSON.stringify({ savedAt }));
    return true;
  } catch {
    return false;
  }
}

function removeLegacy(uid: string, businessId: string): void {
  try {
    localStore()?.removeItem(legacyManifestStorageKey(uid, businessId));
  } catch {
    // A retained recovery copy is harmless.
  }
}

async function migrateLegacy(uid: string, businessId: string, manifest: SyncManifest): Promise<void> {
  try {
    await writeDurableValue(manifestStorageKey(uid, businessId), JSON.stringify(manifest));
    // Read back before deleting the old copy so a failed IndexedDB write cannot
    // leave the device with no durable baseline at all.
    const stored = await readDurableValue(manifestStorageKey(uid, businessId));
    if (stored && parseManifest(stored, businessId)) {
      writeMarker(uid, businessId, manifest.savedAt);
      removeLegacy(uid, businessId);
    }
  } catch {
    // Keep the legacy copy; the next preload retries the migration.
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sync manifest read timed out.')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Synchronous read for reconciliation and listener setup. Returns the preloaded
 * manifest, a legacy manifest that is being migrated, or null when this device
 * has no baseline. Callers that may run at startup should await preloadManifest.
 */
export function readManifest(uid: string, businessId: string): SyncManifest | null {
  const key = cacheKey(uid, businessId);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const legacy = readLegacyManifest(uid, businessId);
  if (legacy) {
    cache.set(key, legacy);
    void migrateLegacy(uid, businessId, legacy);
    return legacy;
  }
  return null;
}

/** Load the durable baseline once per signed-in Owner before starting sync. */
export function preloadManifest(uid: string, businessId: string): Promise<SyncManifest | null> {
  const key = cacheKey(uid, businessId);
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = preloading.get(key);
  if (pending) return pending;

  const task = (async (): Promise<SyncManifest | null> => {
    try {
      const raw = await withTimeout(readDurableValue(manifestStorageKey(uid, businessId)), PRELOAD_TIMEOUT_MS);
      if (raw) {
        const manifest = parseManifest(raw, businessId);
        if (manifest && !isManifestSupersededByReset(manifest.savedAt)) {
          cache.set(key, manifest);
          writeMarker(uid, businessId, manifest.savedAt);
          removeLegacy(uid, businessId);
          return manifest;
        }
        // A malformed or superseded baseline must not be used for reconciliation.
        if (manifest) {
          cache.set(key, null);
          return null;
        }
      }
    } catch {
      // Fall back to the legacy copy below.
    }

    const legacy = readLegacyManifest(uid, businessId);
    if (legacy) {
      cache.set(key, legacy);
      void migrateLegacy(uid, businessId, legacy);
      return legacy;
    }
    cache.set(key, null);
    return null;
  })();

  preloading.set(key, task);
  void task.catch(() => undefined).then(() => {
    if (preloading.get(key) === task) preloading.delete(key);
  });
  return task;
}

/**
 * Persist the merge baseline. The in-memory cache is updated first so an
 * in-flight reconcile always sees a consistent baseline. If neither IndexedDB
 * nor the LocalStorage marker can be written, the caller is told the baseline is
 * not durable and the sync engine surfaces a storage warning.
 */
export async function saveManifest(uid: string, businessId: string, records: Record<string, ManifestEntry>): Promise<boolean> {
  const manifest: SyncManifest = { version: 2, businessId, savedAt: new Date().toISOString(), records };
  cache.set(cacheKey(uid, businessId), manifest);
  const markerSaved = writeMarker(uid, businessId, manifest.savedAt);
  try {
    await writeDurableValue(manifestStorageKey(uid, businessId), JSON.stringify(manifest));
    removeLegacy(uid, businessId);
    dispatch(UPDATED_EVENT, uid);
    return true;
  } catch (error) {
    console.error('Minimart sync baseline could not be saved durably:', error);
    dispatch(FAILED_EVENT, uid);
    // The marker only proves a save was attempted; it cannot rebuild the
    // baseline after reload, so the failure event above stays required.
    if (markerSaved) dispatch(UPDATED_EVENT, uid);
    return markerSaved;
  }
}

export function resetManifestCacheForTests(): void {
  cache.clear();
  preloading.clear();
}
