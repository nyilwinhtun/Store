import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, onSnapshot, type DocumentData } from 'firebase/firestore';
import { firebaseAuth, firestore, FIREBASE_BUSINESS_ID } from '../lib/firebase';
import { useBusinessAccess } from '../lib/businessAccess';
import { usePosStore } from '../store/usePosStore';
import { publishAutoSyncStatus } from '../lib/autoSyncStatus';
import {
  branchRecordKinds,
  buildLocalItems,
  hashPayload,
  importCloudItems,
  keyOf,
  manifestFromItems,
  readManifest,
  saveManifest,
  writeItemsIfBaselineUnchanged,
  type BranchRecordKind,
  type SyncItem,
} from './CloudSyncPanel';

const DELETED_HASH = '__MINIMART_DELETED__';
const MISSING_HASH = '__MINIMART_MISSING__';
const listenOptions = { includeMetadataChanges: true } as const;

function toItem(id: string, data: DocumentData, scope: SyncItem['scope'], kind: SyncItem['kind'], branchId?: string): SyncItem {
  const actualScope = (data.scope as SyncItem['scope']) || scope;
  const actualKind = (data.kind as SyncItem['kind']) || kind;
  const actualBranchId = typeof data.branchId === 'string' ? data.branchId : branchId;
  return {
    key: keyOf(actualScope, actualKind, id, actualBranchId),
    scope: actualScope,
    kind: actualKind,
    id,
    branchId: actualBranchId,
    payload: data.payload,
    deleted: data.deleted === true,
  };
}

function friendlyConflict(key: string): string {
  const parts = key.split('::').filter(Boolean);
  return parts.slice(-2).join(' / ');
}

/**
 * Owner-only app-wide realtime sync. Cashier writes are intentionally excluded
 * until stock-affecting sales can be committed through a trusted server workflow.
 */
export function OwnerAutoSyncProvider() {
  const access = useBusinessAccess();
  const [user, setUser] = useState<User | null>(null);
  const [hasBaseline, setHasBaseline] = useState(false);

  useEffect(() => {
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, setUser);
  }, []);

  useEffect(() => {
    if (!user) { setHasBaseline(false); return; }
    const refresh = (event?: Event) => {
      const detail = (event as CustomEvent<{ uid?: string }> | undefined)?.detail;
      if (!detail?.uid || detail.uid === user.uid) setHasBaseline(!!readManifest(user.uid));
    };
    refresh();
    window.addEventListener('minimart-cloud-manifest-updated', refresh);
    return () => window.removeEventListener('minimart-cloud-manifest-updated', refresh);
  }, [user]);

  useEffect(() => {
    const uid = user?.uid;
    const isOwner = !!uid && access.status === 'active' && access.role === 'owner' && access.uid === uid;
    if (!uid || !isOwner) return;
    if (!firestore) return;
    if (!hasBaseline || !readManifest(uid)) {
      publishAutoSyncStatus(uid, { state: 'idle', message: 'ဒီ Device မှာ Sync Baseline မရှိသေးပါ။ Upload Initial Snapshot သို့မဟုတ် Download Cloud လုပ်ပါ။' });
      return;
    }

    let disposed = false;
    let isReconciling = false;
    let reconcileAgain = false;
    let applyingRemote = false;
    let manualSyncPaused = false;
    let branchIds: string[] = [];
    let expectedReady = 4;
    const ready = new Set<string>();
    const pendingWrites = new Set<string>();
    const remoteItems = new Map<string, SyncItem>();
    const unsubscribers: Array<() => void> = [];
    const branchUnsubscribers: Array<() => void> = [];
    let localTimer: number | undefined;
    let remoteTimer: number | undefined;

    const isReady = () => ready.size >= expectedReady && pendingWrites.size === 0 && navigator.onLine && !manualSyncPaused;
    const reconcile = async () => {
      if (disposed || !isReady()) return;
      if (isReconciling) { reconcileAgain = true; return; }
      isReconciling = true;
      try {
        const baseline = readManifest(uid);
        if (!baseline) {
          publishAutoSyncStatus(uid, { state: 'idle', message: 'Sync Baseline မရှိတော့ပါ။ Owner က Initial Snapshot ပြန်လုပ်ပါ။' });
          return;
        }
        const local = buildLocalItems(usePosStore.getState());
        const keys = new Set([...Object.keys(baseline.records), ...local.keys(), ...remoteItems.keys()]);
        const push: SyncItem[] = [];
        const merged = new Map<string, SyncItem>(local);
        const conflicts: string[] = [];
        let hasPull = false;

        for (const key of keys) {
          const localItem = local.get(key);
          const remoteItem = remoteItems.get(key);
          const baseHash = baseline.records[key]?.hash;
          const localHash = localItem ? hashPayload(localItem.payload) : DELETED_HASH;
          const remoteHash = remoteItem ? (remoteItem.deleted ? DELETED_HASH : hashPayload(remoteItem.payload)) : MISSING_HASH;
          if (localHash === remoteHash) continue;

          if (baseHash === undefined) {
            if (remoteHash === MISSING_HASH && localItem) push.push(localItem);
            else if (!localItem && remoteItem && !remoteItem.deleted) { merged.set(key, remoteItem); hasPull = true; }
            else if (localItem && remoteItem) conflicts.push(key);
            else if (remoteItem?.deleted) merged.delete(key);
            continue;
          }
          if (localHash === baseHash) {
            if (!remoteItem) conflicts.push(key);
            else if (remoteItem.deleted) { merged.delete(key); hasPull = true; }
            else { merged.set(key, remoteItem); hasPull = true; }
            continue;
          }
          if (remoteHash === baseHash) {
            if (localItem) push.push(localItem);
            else {
              const previous = baseline.records[key];
              push.push({ key, scope: previous.scope, kind: previous.kind, id: previous.id, branchId: previous.branchId, payload: null, deleted: true });
            }
            continue;
          }
          conflicts.push(key);
        }

        if (conflicts.length) {
          publishAutoSyncStatus(uid, {
            state: 'conflict',
            message: `ပြိုင်တူပြင်ဆင်ထားသော Record ${conflicts.length} ခု တွေ့ပါတယ်။ Data မအစားထိုးဘဲ Sync ကို ရပ်ထားပါတယ်။ ဥပမာ ${conflicts.slice(0, 3).map(friendlyConflict).join(', ')}`,
            conflictCount: conflicts.length,
          });
          return;
        }

        if (push.length) await writeItemsIfBaselineUnchanged(push, uid, baseline);
        if (disposed) return;
        if (hasPull) {
          applyingRemote = true;
          try { importCloudItems(merged); }
          finally { applyingRemote = false; }
        }
        const nextManifest = manifestFromItems(merged);
        for (const item of push) if (item.deleted) nextManifest[item.key] = { scope: item.scope, kind: item.kind, id: item.id, branchId: item.branchId, hash: DELETED_HASH };
        for (const [key, item] of remoteItems) if (item.deleted && !nextManifest[key]) nextManifest[key] = { scope: item.scope, kind: item.kind, id: item.id, branchId: item.branchId, hash: DELETED_HASH };
        saveManifest(uid, nextManifest);
        publishAutoSyncStatus(uid, { state: 'synced', message: 'Owner Device Auto Sync အလုပ်လုပ်နေပါတယ်။', savedAt: new Date().toISOString() });
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
        const isConflict = error instanceof Error && error.name === 'SyncConflictError';
        const isNetwork = ['unavailable', 'deadline-exceeded', 'network-request-failed', 'cancelled'].includes(code)
          || (error instanceof Error && /network|offline|internet/i.test(error.message));
        publishAutoSyncStatus(uid, {
          state: isConflict ? 'conflict' : isNetwork ? 'offline' : 'error',
          message: isConflict ? `Server မှာ နောက်ဆုံးအခြေအနေက Sync Baseline နဲ့ မတူတော့ပါ။ ${error instanceof Error ? error.message : ''} Local Data ကို မတင်ဘဲ ရပ်ထားပါတယ်။`
            : isNetwork ? 'Cloud ချိတ်ဆက်မှု ပြတ်တောက်နေပါတယ်။ Local Data ကို ထိန်းထားပြီး ပြန်ချိတ်ရန် စောင့်နေပါတယ်။'
              : error instanceof Error ? error.message : 'Auto Sync မအောင်မြင်ပါ။',
        });
      } finally {
        isReconciling = false;
        if (reconcileAgain && !disposed) {
          reconcileAgain = false;
          window.setTimeout(() => void reconcile(), 200);
        }
      }
    };

    const scheduleReconcile = (kind: 'local' | 'remote') => {
      if (disposed) return;
      const timerRef = kind === 'local' ? localTimer : remoteTimer;
      if (timerRef !== undefined) window.clearTimeout(timerRef);
      const timer = window.setTimeout(() => void reconcile(), kind === 'local' ? 900 : 250);
      if (kind === 'local') localTimer = timer;
      else remoteTimer = timer;
    };

    const markReady = (key: string, fromCache: boolean, hasPending: boolean) => {
      if (!fromCache) ready.add(key);
      else {
        ready.delete(key);
        if (!navigator.onLine) publishAutoSyncStatus(uid, { state: 'offline', message: 'Offline Cache မှာ ဖတ်ထားပါတယ်။ Server နဲ့ မချိတ်မိသေးပါ။' });
      }
      if (hasPending) pendingWrites.add(key);
      else pendingWrites.delete(key);
      if (isReady()) scheduleReconcile('remote');
    };

    const attachBranchCollection = (branchId: string, kind: BranchRecordKind) => {
      const listenerKey = `branch:${branchId}:${kind}`;
      const collectionRef = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, kind);
      const unsubscribe = onSnapshot(collectionRef, listenOptions, (snapshot) => {
        if (disposed) return;
        for (const [key, item] of remoteItems) if (item.scope === 'branchRecord' && item.branchId === branchId && item.kind === kind) remoteItems.delete(key);
        snapshot.forEach((record) => {
          const item = toItem(record.id, record.data(), 'branchRecord', kind, branchId);
          if (item.payload !== undefined || item.deleted) remoteItems.set(item.key, item);
        });
        markReady(listenerKey, snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);
      }, (error) => publishAutoSyncStatus(uid, { state: error.code === 'unavailable' ? 'offline' : 'error', message: error.message || 'Branch Sync Listener error.' }));
      branchUnsubscribers.push(unsubscribe);
    };

    const branchCollectionRef = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches');
    const unsubscribeBranches = onSnapshot(branchCollectionRef, listenOptions, (snapshot) => {
      if (disposed) return;
      for (const [key, item] of remoteItems) if (item.scope === 'branch') remoteItems.delete(key);
      const nextIds: string[] = [];
      snapshot.forEach((record) => {
        nextIds.push(record.id);
        const item = toItem(record.id, record.data(), 'branch', 'branches', record.id);
        if (item.payload !== undefined || item.deleted) remoteItems.set(item.key, item);
      });
      nextIds.sort();
      markReady('branches', snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);

      if (nextIds.join('|') !== branchIds.join('|')) {
        branchUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
        for (const [key, item] of remoteItems) if (item.scope === 'branchRecord') remoteItems.delete(key);
        for (const key of [...ready]) if (key.startsWith('branch:')) ready.delete(key);
        for (const key of [...pendingWrites]) if (key.startsWith('branch:')) pendingWrites.delete(key);
        branchIds = nextIds;
        expectedReady = 4 + branchIds.length * branchRecordKinds.length;
        branchIds.forEach((branchId) => branchRecordKinds.forEach((kind) => attachBranchCollection(branchId, kind)));
        if (branchIds.length === 0 && isReady()) scheduleReconcile('remote');
      } else if (isReady()) scheduleReconcile('remote');
    }, (error) => publishAutoSyncStatus(uid, { state: error.code === 'unavailable' ? 'offline' : 'error', message: error.message || 'Branch List Listener error.' }));
    unsubscribers.push(unsubscribeBranches);

    for (const kind of ['customers', 'suppliers'] as const) {
      const listenerKey = `shared:${kind}`;
      const ref = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'shared', kind, 'records');
      const unsubscribe = onSnapshot(ref, listenOptions, (snapshot) => {
        if (disposed) return;
        for (const [key, item] of remoteItems) if (item.scope === 'shared' && item.kind === kind) remoteItems.delete(key);
        snapshot.forEach((record) => {
          const item = toItem(record.id, record.data(), 'shared', kind);
          if (item.payload !== undefined || item.deleted) remoteItems.set(item.key, item);
        });
        markReady(listenerKey, snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);
      }, (error) => publishAutoSyncStatus(uid, { state: error.code === 'unavailable' ? 'offline' : 'error', message: error.message || 'Shared Listener error.' }));
      unsubscribers.push(unsubscribe);
    }

    const metaRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'meta', 'settings');
    const unsubscribeMeta = onSnapshot(metaRef, listenOptions, (snapshot) => {
      if (disposed) return;
      const key = keyOf('meta', 'settings', 'settings');
      if (snapshot.exists()) remoteItems.set(key, toItem('settings', snapshot.data(), 'meta', 'settings'));
      else remoteItems.delete(key);
      markReady('meta', snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);
    }, (error) => publishAutoSyncStatus(uid, { state: error.code === 'unavailable' ? 'offline' : 'error', message: error.message || 'Settings Listener error.' }));
    unsubscribers.push(unsubscribeMeta);

    const unsubscribeStore = usePosStore.subscribe(() => {
      if (!applyingRemote && isReady()) scheduleReconcile('local');
    });
    const onOnline = () => publishAutoSyncStatus(uid, { state: 'connecting', message: 'Internet ပြန်ရရှိပါပြီ။ Server အချက်အလက် အပြည့်အဝရသည်အထိ စောင့်ပြီးမှ Pending Sync လုပ်ပါမယ်။' });
    const onOffline = () => {
      ready.clear();
      pendingWrites.clear();
      publishAutoSyncStatus(uid, { state: 'offline', message: 'Internet မရှိပါ။ POS Local Data ကို ဆက်သုံးနိုင်ပြီး ပြန်ချိတ်မိလျှင် Server နဲ့ ပြန်ညှိပါမယ်။' });
    };
    const onManualSyncStarted = () => { manualSyncPaused = true; };
    const onManualSyncFinished = () => { manualSyncPaused = false; scheduleReconcile('remote'); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('minimart-cloud-manual-sync-started', onManualSyncStarted);
    window.addEventListener('minimart-cloud-manual-sync-finished', onManualSyncFinished);
    publishAutoSyncStatus(uid, { state: 'connecting', message: 'Owner Cloud Listener များကို ချိတ်ဆက်နေပါတယ်။' });

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      branchUnsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribeStore();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('minimart-cloud-manual-sync-started', onManualSyncStarted);
      window.removeEventListener('minimart-cloud-manual-sync-finished', onManualSyncFinished);
      if (localTimer !== undefined) window.clearTimeout(localTimer);
      if (remoteTimer !== undefined) window.clearTimeout(remoteTimer);
    };
  }, [user?.uid, access.status, access.role, access.uid, hasBaseline]);

  return null;
}

