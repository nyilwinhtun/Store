import { useEffect, useState } from 'react';

const DB_NAME = 'minimart-pos-local-media';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const REF_PREFIX = 'local-image:';

type StoredImage = { id: string; blob: Blob; updatedAt: string; mimeType: string };

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('ဒီ Browser မှာ IndexedDB မရနိုင်ပါ။ Chrome ကို အသုံးပြုပါ။'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local Image Database ဖွင့်မရပါ။'));
    request.onblocked = () => reject(new Error('Image Database ကို အခြား Tab တစ်ခုက အသုံးပြုနေပါတယ်။ Tab အဟောင်းကို ပိတ်ပြီး ပြန်စမ်းပါ။'));
  });
}

export const makeLocalImageRef = (id: string) => `${REF_PREFIX}${id}`;
export const getLocalImageId = (value?: string | null) => value?.startsWith(REF_PREFIX) ? value.slice(REF_PREFIX.length) : '';

export async function saveLocalImage(id: string, blob: Blob): Promise<string> {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch { /* IndexedDB remains usable even if persistent-storage permission is unavailable. */ }
  const db = await openImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ id, blob, updatedAt: new Date().toISOString(), mimeType: blob.type || 'image/webp' } satisfies StoredImage);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('ပုံကို IndexedDB ထဲ သိမ်းမရပါ။'));
      tx.onabort = () => reject(tx.error || new Error('ပုံသိမ်းဆည်းမှု ပယ်ဖျက်ခံရပါတယ်။'));
    });
    return makeLocalImageRef(id);
  } finally {
    db.close();
  }
}

export async function getLocalImage(id: string): Promise<Blob | null> {
  const db = await openImageDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve((request.result as StoredImage | undefined)?.blob || null);
      request.onerror = () => reject(request.error || new Error('သိမ်းထားတဲ့ ပုံကို ဖတ်မရပါ။'));
    });
  } finally {
    db.close();
  }
}

export async function deleteLocalImage(id: string): Promise<void> {
  const db = await openImageDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('ပုံဟောင်းကို ဖျက်မရပါ။'));
    });
  } finally {
    db.close();
  }
}

export function useLocalImageSource(reference?: string | null): string {
  const [source, setSource] = useState('');
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    const id = getLocalImageId(reference);
    if (!reference) {
      setSource('');
      return;
    }
    if (!id) {
      setSource(reference);
      return;
    }
    setSource('');
    void getLocalImage(id).then((blob) => {
      if (!blob) throw new Error('ဤ Device ထဲမှာ ပုံဖိုင် မတွေ့ပါ။ JSON Backup ကို Restore လုပ်ပါ။');
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch((error: unknown) => {
      console.warn('Local image could not be loaded:', error);
      if (!cancelled) setSource('');
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reference]);
  return source;
}

export const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Backup အတွက် ပုံဖိုင်ဖတ်မရပါ။'));
  reader.onerror = () => reject(new Error('Backup အတွက် ပုံဖိုင်ဖတ်မရပါ။'));
  reader.readAsDataURL(blob);
});

export async function exportLocalImages(references: Array<string | undefined | null>): Promise<Record<string, string>> {
  const ids = Array.from(new Set(references.map((value) => getLocalImageId(value)).filter(Boolean)));
  const result: Record<string, string> = {};
  for (const id of ids) {
    const blob = await getLocalImage(id);
    if (blob) result[id] = await blobToDataUrl(blob);
  }
  return result;
}

export async function importLocalImages(images: unknown): Promise<void> {
  if (!images || typeof images !== 'object') return;
  for (const [id, value] of Object.entries(images as Record<string, unknown>)) {
    if (!id || typeof value !== 'string' || !value.startsWith('data:image/')) continue;
    const response = await fetch(value);
    if (!response.ok) throw new Error(`Backup ထဲက ပုံ (${id}) ကို ဖတ်မရပါ။`);
    const blob = await response.blob();
    await saveLocalImage(id, blob);
  }
}

export async function migrateDataUrlImage(dataUrl: string, id: string): Promise<string> {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error('အရင်သိမ်းထားတဲ့ ပုံကို ပြောင်းရွှေ့မရပါ။');
  return saveLocalImage(id, await response.blob());
}
