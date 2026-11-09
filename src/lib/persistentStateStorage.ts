import type { StateStorage } from 'zustand/middleware';

/**
 * Durable Zustand storage for the POS state.
 *
 * Existing v3.1.x LocalStorage data is read and copied to IndexedDB on first
 * hydration. The legacy entry is deliberately retained as a recovery copy.
 * If IndexedDB is unavailable, LocalStorage remains a compatibility fallback.
 */
const DB_NAME = 'minimart-pos-local-db';
const DB_VERSION = 1;
const STORE_NAME = 'zustand-state';
const FALLBACK_MARKER_PREFIX = 'minimart-idb-fallback:';
const REMOVED_MARKER_PREFIX = 'minimart-idb-removed:';
export const STORAGE_HEALTH_EVENT = 'minimart-storage-health';

let databasePromise: Promise<IDBDatabase> | null = null;
const writeQueues = new Map<string, Promise<unknown>>();
let lastStorageHealth: { state: 'indexeddb' | 'fallback' | 'error'; message: string } | null = null;

export function getStorageHealth() {
  return lastStorageHealth;
}

function emitStorageHealth(state: 'indexeddb' | 'fallback' | 'error', message: string) {
  lastStorageHealth = { state, message };
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STORAGE_HEALTH_EVENT, { detail: lastStorageHealth }));
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  if (databasePromise) return databasePromise;

  const pending: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error('Could not open IndexedDB.'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another open tab.'));
  }).catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });

  databasePromise = pending;
  return pending;
}

async function readIndexedDb(key: string): Promise<string | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error || new Error('Could not read POS data from IndexedDB.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB read transaction aborted.'));
  });
}

async function writeIndexedDb(key: string, value: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not save POS data to IndexedDB.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write transaction aborted.'));
  });
}

async function removeIndexedDb(key: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not remove POS data from IndexedDB.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB delete transaction aborted.'));
  });
}

function readLegacyLocalStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function hasFallbackMarker(key: string): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(`${FALLBACK_MARKER_PREFIX}${key}`) === '1'; }
  catch { return false; }
}

function setFallbackMarker(key: string, active: boolean) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (active) localStorage.setItem(`${FALLBACK_MARKER_PREFIX}${key}`, '1');
    else localStorage.removeItem(`${FALLBACK_MARKER_PREFIX}${key}`);
  } catch { /* The main storage health message reports fallback limitations. */ }
}

function hasRemovedMarker(key: string): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(`${REMOVED_MARKER_PREFIX}${key}`) === '1'; }
  catch { return false; }
}

function setRemovedMarker(key: string, active: boolean) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (active) localStorage.setItem(`${REMOVED_MARKER_PREFIX}${key}`, '1');
    else localStorage.removeItem(`${REMOVED_MARKER_PREFIX}${key}`);
  } catch { /* A tombstone is best-effort when browser storage is restricted. */ }
}

function writeLegacyLocalStorage(key: string, value: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Write a serialized Zustand snapshot and wait for the chosen browser store. */
export async function writePosStateDurably(key: string, value: string): Promise<'indexeddb' | 'localstorage'> {
  const previous = writeQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    try {
      await writeIndexedDb(key, value);
      setFallbackMarker(key, false);
      return 'indexeddb' as const;
    } catch (indexedDbError) {
      if (writeLegacyLocalStorage(key, value)) {
        setFallbackMarker(key, true);
        emitStorageHealth('fallback', 'IndexedDB မရသေးပါ။ နောက်ဆုံး Data ကို LocalStorage ထဲ အစားထိုးသိမ်းထားပါတယ်။ Storage ကို စစ်ဆေးပါ။');
        return 'localstorage' as const;
      }
      emitStorageHealth('error', 'POS Data ကို IndexedDB / LocalStorage နှစ်ခုလုံးတွင် မသိမ်းနိုင်ပါ။ အရောင်းကို အတည်မပြုသေးပါ။ Browser Storage နှင့် Backup ကို စစ်ဆေးပါ။');
      throw indexedDbError instanceof Error ? indexedDbError : new Error('Could not persist POS data.');
    }
  });
  writeQueues.set(key, current.then(() => undefined, () => undefined));
  return current;
}

/** Shared durable key/value storage for workflow queues and recovery metadata.
 * IndexedDB is authoritative; LocalStorage is a backward-compatible fallback.
 * Existing legacy keys are retained as recovery copies after successful migration.
 */
export async function readDurableValue(key: string): Promise<string | null> {
  // A tombstone prevents a stale IndexedDB copy from reappearing if a previous
  // delete succeeded only in LocalStorage while IndexedDB was temporarily unavailable.
  if (hasRemovedMarker(key)) {
    let indexedDbRemoved = false;
    let localStorageRemoved = false;
    try { await removeIndexedDb(key); indexedDbRemoved = true; } catch { /* Keep tombstone. */ }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
        localStorageRemoved = true;
      }
    } catch { /* Keep tombstone until both stores can be cleaned. */ }
    if (indexedDbRemoved && localStorageRemoved) {
      setFallbackMarker(key, false);
      setRemovedMarker(key, false);
    }
    return null;
  }

  // When IndexedDB previously failed, the LocalStorage fallback is newer and
  // must win over any stale IndexedDB value until it can be migrated back.
  if (hasFallbackMarker(key)) {
    const fallbackValue = readLegacyLocalStorage(key);
    if (fallbackValue === null) {
      emitStorageHealth('error', 'LocalStorage Fallback အမှတ်အသားရှိသော်လည်း နောက်ဆုံး Queue Data ကို မတွေ့ပါ။ Stale IndexedDB Data ကို မသုံးဘဲ ရပ်ထားပါတယ်။');
      throw new Error('Pending Queue Fallback Data မတွေ့ပါ။ Browser Storage ကို မရှင်းဘဲ Owner/Developer ထံ ဆက်သွယ်ပါ။');
    }
    try {
      await writeIndexedDb(key, fallbackValue);
      setFallbackMarker(key, false);
      emitStorageHealth('indexeddb', 'Pending Queue နောက်ဆုံး Data ကို IndexedDB သို့ ပြန်လည်ကူးယူပြီးပါပြီ။');
    } catch {
      emitStorageHealth('fallback', 'IndexedDB မရသေးပါ။ နောက်ဆုံး Pending Queue ကို LocalStorage မှ ဖတ်နေပါတယ်။');
    }
    return fallbackValue;
  }

  try {
    const value = await readIndexedDb(key);
    if (value !== null) return value;
  } catch {
    // Fall through to the LocalStorage compatibility copy when IndexedDB is unavailable.
  }
  const legacyValue = readLegacyLocalStorage(key);
  if (legacyValue !== null) {
    try {
      await writeIndexedDb(key, legacyValue);
      setFallbackMarker(key, false);
      setRemovedMarker(key, false);
    } catch { /* Keep using the legacy copy. */ }
  }
  return legacyValue;
}

export async function writeDurableValue(key: string, value: string): Promise<'indexeddb' | 'localstorage'> {
  const previous = writeQueues.get(`kv:${key}`) || Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    try {
      await writeIndexedDb(key, value);
      setFallbackMarker(key, false);
      setRemovedMarker(key, false);
      return 'indexeddb' as const;
    } catch (indexedDbError) {
      if (writeLegacyLocalStorage(key, value)) {
        setFallbackMarker(key, true);
        setRemovedMarker(key, false);
        emitStorageHealth('fallback', 'IndexedDB မရသေးပါ။ Pending Queue ကို LocalStorage ထဲ အစားထိုးသိမ်းထားပါတယ်။');
        return 'localstorage' as const;
      }
      emitStorageHealth('error', 'Pending Queue ကို IndexedDB / LocalStorage နှစ်ခုလုံးတွင် မသိမ်းနိုင်ပါ။');
      throw indexedDbError instanceof Error ? indexedDbError : new Error('Could not persist the workflow queue.');
    }
  });
  writeQueues.set(`kv:${key}`, current.then(() => undefined, () => undefined));
  return current;
}

export async function removeDurableValue(key: string): Promise<void> {
  let indexedDbRemoved = false;
  let localStorageRemoved = false;
  try {
    await removeIndexedDb(key);
    indexedDbRemoved = true;
  } catch { /* Try the compatibility store; a tombstone protects stale IDB data. */ }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      localStorageRemoved = true;
    }
  } catch { /* Keep the error below if neither store was writable. */ }

  if (!indexedDbRemoved && !localStorageRemoved) {
    throw new Error('Pending Queue ကို IndexedDB / LocalStorage မှ ဖယ်ရှားမရပါ။');
  }
  setFallbackMarker(key, false);
  // If IDB could not be deleted, keep a tombstone so its stale record cannot
  // resurrect an already-synced queue entry on the next read.
  setRemovedMarker(key, !(indexedDbRemoved && localStorageRemoved));
}

export const persistentStateStorage: StateStorage = {
  getItem: async (key) => {
    // If a previous IndexedDB write fell back, prefer that newer LocalStorage
    // value instead of returning an older IndexedDB snapshot.
    if (hasFallbackMarker(key)) {
      const fallbackValue = readLegacyLocalStorage(key);
      if (fallbackValue !== null) {
        try {
          await writeIndexedDb(key, fallbackValue);
          setFallbackMarker(key, false);
          emitStorageHealth('indexeddb', 'LocalStorage မှ နောက်ဆုံး Data ကို IndexedDB သို့ ပြန်လည်ကူးယူပြီးပါပြီ။');
        } catch {
          emitStorageHealth('fallback', 'IndexedDB မရသေးပါ။ နောက်ဆုံး LocalStorage Data ကို အသုံးပြုနေပါတယ်။');
        }
        return fallbackValue;
      }
    }
    try {
      const current = await readIndexedDb(key);
      if (current !== null) return current;

      // One-time, non-destructive migration from the existing v3.1.x key.
      const legacy = readLegacyLocalStorage(key);
      if (legacy !== null) {
        try {
          await writeIndexedDb(key, legacy);
          emitStorageHealth('indexeddb', 'ယခင် LocalStorage Data ကို IndexedDB သို့ ကူးယူပြီးပါပြီ။ မူရင်း Recovery Copy ကို မဖျက်ထားပါ။');
        } catch {
          setFallbackMarker(key, true);
          emitStorageHealth('fallback', 'IndexedDB သို့ ကူးမရသေးပါ။ ယခင် LocalStorage Data ကို အသုံးပြုနေပါတယ်။');
        }
        return legacy;
      }
      return null;
    } catch {
      const legacy = readLegacyLocalStorage(key);
      if (legacy !== null) {
        emitStorageHealth('fallback', 'IndexedDB မရနိုင်သေးပါ။ LocalStorage Recovery Copy ကို အသုံးပြုနေပါတယ်။');
        return legacy;
      }
      emitStorageHealth('error', 'Local Data ဖတ်မရပါ။ Browser Storage ကို မရှင်းလင်းပါနှင့်။ Developer ကို ဆက်သွယ်ပါ။');
      return null;
    }
  },
  setItem: async (key, value) => {
    try {
      await writePosStateDurably(key, value);
    } catch {
      // Zustand's automatic persistence does not gate UI actions. Explicit
      // checkout persistence uses writePosStateDurably directly and awaits it.
    }
  },
  removeItem: async (key) => {
    try {
      await removeIndexedDb(key);
    } catch (error) {
      emitStorageHealth('error', 'Local POS Data ကို ဖယ်ရှားမရပါ။');
      throw error;
    }
    try { localStorage.removeItem(key); localStorage.removeItem(`${FALLBACK_MARKER_PREFIX}${key}`); } catch { /* The IndexedDB copy is authoritative. */ }
  },
};
