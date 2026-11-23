/**
 * Safety markers for local data replacement (reset, backup restore, role switch).
 *
 * A local replacement is not a user deletion. The owner sync engine must never
 * turn an emptied local store into cloud tombstones. These markers make the
 * distinction explicit and survive a reload, so the sync engine can re-baseline
 * before it is allowed to push anything.
 *
 * Implementation is deliberately dependency-free so it can be unit tested with
 * the Node test runner after a plain transpile.
 */

export type LocalDataReplacementMarker = { id: string; at: string; reason: string };

const MARKER_KEY = 'minimart-local-data-replacement-v1';
const HANDLED_KEY = 'minimart-local-data-replacement-handled-v1';
const FULL_REFRESH_KEY = 'minimart-sync-full-refresh-v1';
export const LOCAL_DATA_RESET_EVENT = 'minimart-local-data-reset';

let memoryMarker: string | null = null;
let memoryHandled: string | null = null;
let memoryFullRefresh: string | null = null;

function storage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  const store = storage();
  if (!store) return key === MARKER_KEY ? memoryMarker : key === HANDLED_KEY ? memoryHandled : memoryFullRefresh;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  if (key === MARKER_KEY) memoryMarker = value;
  if (key === HANDLED_KEY) memoryHandled = value;
  if (key === FULL_REFRESH_KEY) memoryFullRefresh = value;
  const store = storage();
  if (!store) return;
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // The in-memory mirror still protects this tab when storage is unavailable.
  }
}

function createId(): string {
  try {
    const cryptoValue = (globalThis as { crypto?: Crypto }).crypto;
    if (cryptoValue?.randomUUID) return cryptoValue.randomUUID();
  } catch {
    // Fall back to a time-based identifier.
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function markLocalDataReplacement(reason: string): LocalDataReplacementMarker {
  const marker: LocalDataReplacementMarker = { id: createId(), at: new Date().toISOString(), reason };
  write(MARKER_KEY, JSON.stringify(marker));
  write(HANDLED_KEY, null);
  write(FULL_REFRESH_KEY, null);
  return marker;
}

export function readLocalDataReplacement(): LocalDataReplacementMarker | null {
  const raw = read(MARKER_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LocalDataReplacementMarker>;
    if (typeof value.id !== 'string' || typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) return null;
    return { id: value.id, at: value.at, reason: typeof value.reason === 'string' ? value.reason : 'local-replacement' };
  } catch {
    return null;
  }
}

export function announceLocalDataReplacement(marker: LocalDataReplacementMarker): void {
  try {
    const target = globalThis as { dispatchEvent?: (event: Event) => boolean; CustomEvent?: typeof CustomEvent };
    if (!target.dispatchEvent || !target.CustomEvent) return;
    target.dispatchEvent(new target.CustomEvent(LOCAL_DATA_RESET_EVENT, { detail: marker }));
  } catch {
    // The persistent marker still protects the next session.
  }
}

export function markLocalDataResetHandled(id: string): void {
  write(HANDLED_KEY, id);
}

/** True when a local replacement happened but the sync engine has not re-baselined yet. */
export function isLocalDataResetPending(): boolean {
  const marker = readLocalDataReplacement();
  if (!marker) return false;
  return read(HANDLED_KEY) !== marker.id;
}

/**
 * A manifest saved before the replacement must be ignored. Once the sync engine
 * writes a fresh baseline after the replacement, its savedAt is newer and valid.
 */
export function isManifestSupersededByReset(savedAt: string): boolean {
  const marker = readLocalDataReplacement();
  if (!marker) return false;
  const saved = Date.parse(savedAt);
  if (Number.isNaN(saved)) return true;
  return Date.parse(marker.at) > saved;
}

export function markFullRefreshPending(): void {
  write(FULL_REFRESH_KEY, '1');
}

export function isFullRefreshPending(): boolean {
  return read(FULL_REFRESH_KEY) === '1';
}

export function clearFullRefreshPending(): void {
  write(FULL_REFRESH_KEY, null);
}
