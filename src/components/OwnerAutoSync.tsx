import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import { firebaseAuth, firestore, FIREBASE_BUSINESS_ID } from '../lib/firebase';
import { firebaseRuntime } from '../lib/firebaseRuntime';
import { useBusinessAccess } from '../lib/businessAccess';
import { usePosStore } from '../store/usePosStore';
import { publishAutoSyncStatus } from '../lib/autoSyncStatus';
import { BRANCH_SHIPMENT_CLOUD_COMMIT_CANCELLED, BRANCH_SHIPMENT_CLOUD_COMMIT_COMPLETED, BRANCH_SHIPMENT_CLOUD_COMMIT_STARTED } from '../lib/branchShipmentCloudCommit';
import { recordFirestoreActivity } from '../lib/firestoreDiagnostics';
import { clearFullRefreshPending, isFullRefreshPending, isLocalDataResetPending, LOCAL_DATA_RESET_EVENT, markFullRefreshPending, markLocalDataResetHandled, readLocalDataReplacement } from '../lib/syncSafety';
import { preloadManifest, readManifest, saveManifest } from '../lib/syncManifestStorage';
import { activityLogWindowStart } from '../lib/activityLogPolicy';
import { branchRecordKinds, sharedRecordKinds, type BranchRecordKind, type SharedRecordKind, type SyncItem } from '../lib/syncTypes';
import {
  buildLocalItems,
  hashPayload,
  importCloudItems,
  initializeOwnerDeviceSyncFromSnapshot,
  keyOf,
  manifestFromItems,
  writeItemsIfBaselineUnchanged,
} from './CloudSyncPanel';

const DELETED_HASH = '__MINIMART_DELETED__';
const MISSING_HASH = '__MINIMART_MISSING__';
const listenOptions = { includeMetadataChanges: false } as const;
const SESSION_UID_KEY = 'minimart-active-session-uid-v1';

// Historical collections are synchronized incrementally. Only categories and products
// stay full-collection listeners because the checkout flow needs them immediately.
// Activity logs are always windowed to the retention cutoff instead of a full scan.
const incrementalBranchKinds = new Set<BranchRecordKind>([
  'sales', 'expenses', 'cashierSettlements', 'customerPayments', 'purchases', 'supplierPayments',
  'purchaseReturns', 'stockBatches', 'stockReceipts', 'stockTransfers', 'stockShipments', 'cashShifts', 'cashMovements', 'activityLogs', 'branchFinanceLedgerEntries', 'cashierAdvanceReconciliations', 'branchFinanceReconciliations',
]);

const cursorStorageKey = (uid: string, scope: string, branchId: string, kind: string) =>
  `minimart-cloud-cursor-v1:${FIREBASE_BUSINESS_ID}:${uid}:${scope}:${branchId}:${kind}`;

function readStoredCollectionCursor(uid: string, scope: string, branchId: string, kind: string): string | null {
  try {
    const value = localStorage.getItem(cursorStorageKey(uid, scope, branchId, kind));
    return value && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch { return null; }
}

function readCollectionCursor(uid: string, scope: string, branchId: string, kind: string): string | null {
  // After a reset/restore the old cursors point at a dataset that no longer
  // matches local state, so every listener must replay a full server snapshot.
  if (isLocalDataResetPending() || isFullRefreshPending()) return null;
  const stored = readStoredCollectionCursor(uid, scope, branchId, kind);
  if (stored) return stored;
  const baselineTime = readManifest(uid, FIREBASE_BUSINESS_ID)?.savedAt;
  return baselineTime && !Number.isNaN(Date.parse(baselineTime)) ? baselineTime : null;
}

function clearCollectionCursors(uid: string) {
  try {
    const prefix = `minimart-cloud-cursor-v1:${FIREBASE_BUSINESS_ID}:${uid}:`;
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch { /* cursor cleanup is best-effort */ }
}

function saveCollectionCursor(uid: string, scope: string, branchId: string, kind: string, value: string) {
  try { localStorage.setItem(cursorStorageKey(uid, scope, branchId, kind), value); } catch { /* keep sync functional if storage is full */ }
}

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
 * Owner-only app-wide realtime sync. Cashier sales are committed separately
 * through an idempotent atomic Firestore transaction and arrive through these listeners.
 *
 * The sync baseline now lives in IndexedDB, so the engine waits for the durable
 * preload to finish before mounting. Reconciling against an empty baseline would
 * otherwise look like a first-time device and trigger a needless full re-merge.
 */
export function OwnerAutoSyncProvider() {
  const access = useBusinessAccess();
  const [user, setUser] = useState<User | null>(null);
  const [baselineReady, setBaselineReady] = useState(false);

  useEffect(() => {
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, setUser);
  }, []);

  const uid = user?.uid;
  const isOwner = !!uid && access.status === 'active' && access.role === 'owner' && access.uid === uid;

  useEffect(() => {
    if (!uid || !isOwner) {
      setBaselineReady(false);
      return;
    }
    let active = true;
    void preloadManifest(uid, FIREBASE_BUSINESS_ID).finally(() => { if (active) setBaselineReady(true); });
    return () => { active = false; };
  }, [uid, isOwner]);

  if (!user || !isOwner || !baselineReady) return null;
  return <OwnerAutoSyncEngine user={user} />;
}

function OwnerAutoSyncEngine({ user }: { user: User }) {
  const access = useBusinessAccess();

  useEffect(() => {
    const uid = user.uid;
    if (!(access.status === 'active' && access.role === 'owner' && access.uid === uid) || !firestore) return;

    try {
      localStorage.setItem(SESSION_UID_KEY, uid);
    } catch { /* ignore storage errors */ }

    let bootstrapping = isLocalDataResetPending() || !readManifest(uid, FIREBASE_BUSINESS_ID);
    // Reset/restore must be re-baselined from cloud snapshots before any push.
    if (isLocalDataResetPending()) {
      clearCollectionCursors(uid);
      markFullRefreshPending();
    }
    let handledReplacementId: string | null = null;
    let localReplacementGeneration = 0;
    let bootstrapGeneration = 0;
    let bootstrapAttempted = false;
    let disposed = false;
    let isReconciling = false;
    let reconcileAgain = false;
    let applyingRemote = false;
    let branchIds: string[] = [];
    let activeBranchIds: string[] = [];
    const ready = new Set<string>();
    const serverSnapshotSeen = new Set<string>();
    const recordServerSnapshotReads = (listenerKey: string, size: number, addedOrModified: number) => {
      if (!serverSnapshotSeen.has(listenerKey)) {
        recordFirestoreActivity(uid, 'read', `listener-initial:${listenerKey}`, size);
        serverSnapshotSeen.add(listenerKey);
      } else {
        recordFirestoreActivity(uid, 'read', `listener-changes:${listenerKey}`, addedOrModified);
      }
    };
    const remoteItems = new Map<string, SyncItem>();
    const sharedReady = new Set<SharedRecordKind>();
    const sharedBlocked = new Set<SharedRecordKind>();
    const unsubscribers: Array<() => void> = [];
    const branchUnsubscribers = new Map<string, Map<BranchRecordKind, () => void>>();
    const sharedUnsubscribers = new Map<SharedRecordKind, () => void>();
    let localTimer: number | undefined;
    let remoteTimer: number | undefined;
    let shipmentCommitInProgress = false;
    let tryBootstrapFromSnapshots: () => void = () => undefined;

    const coreListenersReady = () => ready.has('branches') && ready.has('meta')
      && activeBranchIds.every((branchId) => branchRecordKinds.every((kind) => ready.has(`branch:${branchId}:${kind}`)));
    const isReady = () => coreListenersReady() && navigator.onLine;
    const isBootstrapReady = () => coreListenersReady()
      && sharedReady.size + sharedBlocked.size >= sharedRecordKinds.length
      && navigator.onLine;
    const reconcile = async () => {
      if (disposed || bootstrapping || !isReady()) return;
      // A merge must never run against the pre-hydration default store: local
      // collections would look empty and be pushed as cloud deletions.
      if (!usePosStore.persist.hasHydrated()) {
        publishAutoSyncStatus(uid, { state: 'connecting', message: 'Local Data ကို Browser Storage မှ ပြန်ဖွင့်နေပါတယ်။ Sync ကို ဒီအဆင့်ပြီးမှ စတင်ပါမယ်။' });
        return;
      }
      if (isLocalDataResetPending()) {
        publishAutoSyncStatus(uid, { state: 'connecting', message: 'Local Data အစားထိုးမှုကို Safe Rebaseline လုပ်နေပါတယ်။ Cloud Data ကို မဖျက်ပါ။' });
        return;
      }
      if (isReconciling) { reconcileAgain = true; return; }
      isReconciling = true;
      const generationAtStart = localReplacementGeneration;
      try {
        const baseline = readManifest(uid, FIREBASE_BUSINESS_ID);
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
          const baselineEntry = baseline.records[key];
          const recordScope = localItem?.scope || remoteItem?.scope || baselineEntry?.scope;
          const recordKind = localItem?.kind || remoteItem?.kind || baselineEntry?.kind;
          if (recordScope === 'shared' && !sharedReady.has(recordKind as SharedRecordKind)) continue;
          const baseHash = baselineEntry?.hash;
          const localHash = localItem ? hashPayload(localItem.payload) : DELETED_HASH;
          // Archived branches are not listened to, so a missing remote item only
          // means "no listener data" for them, not a cloud deletion.
          const recordBranchId = localItem?.branchId || remoteItem?.branchId || baselineEntry?.branchId;
          const unlistenedBranchRecord = recordScope === 'branchRecord' && !!recordBranchId && !activeBranchIds.includes(recordBranchId);
          const remoteHash = remoteItem
            ? (remoteItem.deleted ? DELETED_HASH : hashPayload(remoteItem.payload))
            : (baselineEntry && (unlistenedBranchRecord
              || (recordScope === 'branchRecord' && incrementalBranchKinds.has(recordKind as BranchRecordKind))
              || recordScope === 'shared') ? baseHash as string : MISSING_HASH);
          if (localHash === remoteHash) continue;

          if (baseHash === undefined) {
            if (remoteHash === MISSING_HASH && localItem) push.push(localItem);
            else if (!localItem && remoteItem && !remoteItem.deleted) { merged.set(key, remoteItem); hasPull = true; }
            else if (localItem && remoteItem) {
              // Prefer remote for cashier-updated records like sales and shifts to prevent unnecessary sync conflicts.
              if (recordKind === 'sales' || recordKind === 'cashShifts' || recordKind === 'expenses') {
                merged.set(key, remoteItem);
                hasPull = true;
              } else {
                conflicts.push(key);
              }
            }
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
          if (remoteItem && !remoteItem.deleted && (recordKind === 'sales' || recordKind === 'cashShifts' || recordKind === 'stockShipments')) {
            merged.set(key, remoteItem);
            hasPull = true;
            continue;
          }
          conflicts.push(key);
        }

        if (conflicts.length) {
          publishAutoSyncStatus(uid, {
            state: 'conflict',
            message: `ပြိုင်တူပြင်ဆင်ထားသော Record ${conflicts.length} ခု တွေ့ပါတယ်။ Data မအစားထိုးဘဲ Sync ကို ရပ်ထားပါတယ်။ ဥပမာ ${conflicts.slice(0, 3).map(friendlyConflict).join(', ')}`,
            conflictCount: conflicts.length,
            conflictKeys: conflicts.slice(0, 20),
          });
          return;
        }

        if (push.length || hasPull) {
          console.info('[Minimart Sync Reconcile]', {
            localRecords: local.size,
            trackedCloudChanges: remoteItems.size,
            recordsToWrite: push.length,
            recordsToPull: hasPull,
          });
        }
        if (push.length) await writeItemsIfBaselineUnchanged(push, uid, baseline);
        if (disposed) return;
        // A reset/restore that happened while the write was in flight wins:
        // never apply a merge computed from the replaced dataset.
        if (generationAtStart !== localReplacementGeneration) return;
        if (hasPull) {
          applyingRemote = true;
          try { importCloudItems(merged, { unavailableSharedKinds: (['customers', 'suppliers', 'priceGroups'] as SharedRecordKind[]).filter((kind) => !sharedReady.has(kind)) }); }
          finally { applyingRemote = false; }
        }
        const nextManifest = manifestFromItems(merged);
        for (const key of Object.keys(nextManifest)) {
          const entry = nextManifest[key];
          if (entry.scope === 'shared' && !sharedReady.has(entry.kind as SharedRecordKind)) {
            if (baseline.records[key]) nextManifest[key] = baseline.records[key];
            else delete nextManifest[key];
          }
        }
        for (const [key, entry] of Object.entries(baseline.records)) {
          if (entry.scope === 'shared' && !sharedReady.has(entry.kind as SharedRecordKind)) nextManifest[key] = entry;
        }
        for (const item of push) if (item.deleted) nextManifest[item.key] = { scope: item.scope, kind: item.kind, id: item.id, branchId: item.branchId, hash: DELETED_HASH };
        for (const [key, item] of remoteItems) if (item.deleted && !nextManifest[key]) nextManifest[key] = { scope: item.scope, kind: item.kind, id: item.id, branchId: item.branchId, hash: DELETED_HASH };
        const manifestSaved = await saveManifest(uid, FIREBASE_BUSINESS_ID, nextManifest);
        clearFullRefreshPending();
        const sharedWarning = sharedBlocked.size
          ? ` Shared Data (${[...sharedBlocked].join(', ')}) Sync ကို Firestore Rules ခွင့်မပြုသေးပါ။ Product / Stock / Sales Sync ကို ဆက်လုပ်နေပါတယ်။ Rules ပြင်ပြီး App ကို ပြန်ဖွင့်ပါ။`
          : '';
        publishAutoSyncStatus(uid, manifestSaved
          ? { state: 'synced', message: `Owner Device Auto Sync အလုပ်လုပ်နေပါတယ်။${sharedWarning}`, savedAt: new Date().toISOString() }
          : {
            state: 'error',
            message: 'Cloud Sync ပြီးပါပြီ။ ဒါပေမယ့် Sync Baseline ကို Browser Storage ထဲ သိမ်းမရပါ။ Storage ပြည့်နေနိုင်ပါတယ်။ Data မပျက်ပါ၊ သို့သော် နောက် Sync တွင် Record အချို့ကို ထပ်မံစစ်ဆေးရပါမယ်။',
          });
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
      const timer = window.setTimeout(() => void reconcile(), kind === 'local' ? 700 : 250);
      if (kind === 'local') localTimer = timer;
      else remoteTimer = timer;
    };

    const eventUidMatches = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string }>).detail;
      return detail?.uid === uid;
    };
    const onShipmentCommitStarted = (event: Event) => {
      if (eventUidMatches(event)) shipmentCommitInProgress = true;
    };
    const onShipmentCommitCancelled = (event: Event) => {
      if (!eventUidMatches(event)) return;
      shipmentCommitInProgress = false;
      if (isReady()) scheduleReconcile('remote');
    };
    const onShipmentCommitCompleted = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; records?: SyncItem[] }>).detail;
      if (detail?.uid !== uid || !Array.isArray(detail.records)) return;
      detail.records.forEach((item) => remoteItems.set(item.key, item));
      const baseline = readManifest(uid, FIREBASE_BUSINESS_ID);
      if (baseline) {
        const nextRecords = { ...baseline.records };
        detail.records.forEach((item) => {
          nextRecords[item.key] = {
            scope: item.scope, kind: item.kind, id: item.id, branchId: item.branchId,
            hash: hashPayload(item.payload),
          };
        });
        void saveManifest(uid, FIREBASE_BUSINESS_ID, nextRecords).then((saved) => {
          if (saved || disposed) return;
          publishAutoSyncStatus(uid, {
            state: 'error',
            message: 'Shipment Sync Baseline ကို Browser Storage ထဲ သိမ်းမရပါ။ Storage ပြည့်နေနိုင်ပါတယ်။ Owner Sync ကို ဆက်လုပ်နေပါတယ်။',
          });
        });
      }
      shipmentCommitInProgress = false;
      if (isReady()) scheduleReconcile('remote');
    };
    window.addEventListener(BRANCH_SHIPMENT_CLOUD_COMMIT_STARTED, onShipmentCommitStarted);
    window.addEventListener(BRANCH_SHIPMENT_CLOUD_COMMIT_CANCELLED, onShipmentCommitCancelled);
    window.addEventListener(BRANCH_SHIPMENT_CLOUD_COMMIT_COMPLETED, onShipmentCommitCompleted);

    tryBootstrapFromSnapshots = () => {
      if (disposed || !bootstrapping || bootstrapAttempted || !isBootstrapReady()) return;
      bootstrapAttempted = true;
      const generation = bootstrapGeneration;
      publishAutoSyncStatus(uid, {
        state: 'connecting',
        message: 'Realtime Listener မှ Server Snapshot များကို အသုံးပြုပြီး Device အသစ်၏ Safe Merge ကို စတင်နေပါတယ်။ Collection အားလုံးကို သီးခြား Full Scan ထပ်မလုပ်ပါ။',
      });
      void initializeOwnerDeviceSyncFromSnapshot(uid, remoteItems, [...sharedBlocked], {
        preferRemoteOnConflict: isLocalDataResetPending(),
        // A brand-new cloud device starts from the live dataset. Local template
        // records are never written into Production or Staging by the bootstrap.
        skipLocalOnlyPush: firebaseRuntime.mode !== 'emulator',
      }).then((result) => {
        if (disposed) return;
        if (generation !== bootstrapGeneration) {
          bootstrapAttempted = false;
          window.setTimeout(() => { if (!disposed) tryBootstrapFromSnapshots(); }, 150);
          return;
        }
        bootstrapping = false;
        const replaced = readLocalDataReplacement();
        if (replaced) {
          handledReplacementId = replaced.id;
          markLocalDataResetHandled(replaced.id);
          clearFullRefreshPending();
        }
        publishAutoSyncStatus(uid, {
          state: 'connecting',
          message: replaced
            ? `Local Data အစားထိုးမှုကို Cloud နဲ့ Safe Rebaseline ပြီးပါပြီ။ Cloud ${result.cloudRecords} records ကို ထိန်းသိမ်းထားပြီး Device-only ${result.localOnlyRecords} records ကို ထည့်သွင်းထားပါတယ်။`
            : `ပထမဆုံး Device Sync ပြီးပါပြီ။ Listener Snapshot မှ Cloud ${result.cloudRecords} records ကို ပေါင်းစည်းပြီး Device-only ${result.localOnlyRecords} records ကို ထိန်းသိမ်းထားပါတယ်။`,
        });
        scheduleReconcile('remote');
      }).catch((error: unknown) => {
        if (disposed) return;
        if (generation !== bootstrapGeneration) {
          bootstrapAttempted = false;
          window.setTimeout(() => { if (!disposed) tryBootstrapFromSnapshots(); }, 150);
          return;
        }
        const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
        const isConflict = error instanceof Error && error.name === 'SyncConflictError';
        const isNetwork = ['unavailable', 'deadline-exceeded', 'network-request-failed', 'cancelled'].includes(code)
          || (error instanceof Error && /network|offline|internet/i.test(error.message));
        if (isNetwork) bootstrapAttempted = false;
        publishAutoSyncStatus(uid, {
          state: isConflict ? 'conflict' : isNetwork ? 'offline' : 'error',
          message: isConflict
            ? `${error instanceof Error ? error.message : 'Data Conflict ဖြစ်နေပါတယ်။'} Local နဲ့ Cloud Data ကို မပြောင်းထားပါ။ Backup ထုတ်ပြီး စစ်ဆေးပါ။`
            : isNetwork
              ? 'Cloud ချိတ်ဆက်မှု မရသေးပါ။ Listener Server Snapshot ပြန်ရမှ Safe Merge ကို ပြန်စမ်းပါမယ်။'
              : error instanceof Error ? error.message : 'Device Sync စတင်မရပါ။ Firebase Business Setup နဲ့ Rules ကို စစ်ဆေးပါ။',
        });
      });
    };

    // Cache snapshots never unlock a merge: only a server-confirmed snapshot may
    // add readiness, and once ready the listener stays ready until offline.
    const markReady = (key: string, fromCache: boolean) => {
      if (!fromCache) ready.add(key);
      else if (!navigator.onLine) publishAutoSyncStatus(uid, { state: 'offline', message: 'Offline Cache မှာ ဖတ်ထားပါတယ်။ Server နဲ့ မချိတ်မိသေးပါ။' });
      if (bootstrapping) tryBootstrapFromSnapshots();
      else if (isReady()) scheduleReconcile('remote');
    };

    const attachBranchCollection = (branchId: string, kind: BranchRecordKind) => {
      if (branchUnsubscribers.get(branchId)?.has(kind)) return;
      const listenerKey = `branch:${branchId}:${kind}`;
      serverSnapshotSeen.delete(listenerKey);
      const collectionRef = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, kind);
      const savedBaseline = bootstrapping ? null : readManifest(uid, FIREBASE_BUSINESS_ID);
      const branchHasBaseline = !!savedBaseline && Object.values(savedBaseline.records).some((entry) => entry.scope === 'branch' && entry.id === branchId);
      const existingCursor = bootstrapping || !branchHasBaseline ? null : readCollectionCursor(uid, 'branchRecord', branchId, kind);
      const isIncremental = incrementalBranchKinds.has(kind) && (!!existingCursor || kind === 'activityLogs');
      const listenedRef = kind === 'activityLogs'
        ? query(collectionRef, where('updatedAt', '>=', activityLogWindowStart(existingCursor)))
        : isIncremental && existingCursor
          ? query(collectionRef, where('updatedAt', '>=', new Date(Date.parse(existingCursor) - 120_000).toISOString()))
          : collectionRef;
      recordFirestoreActivity(uid, 'listenerStart', `listener:${listenerKey}`, 1);
      const unsubscribe = onSnapshot(listenedRef, listenOptions, (snapshot) => {
        if (disposed) return;
        const changes = snapshot.docChanges();
        if (snapshot.metadata.fromCache) serverSnapshotSeen.delete(listenerKey);
        else {
          const billableLikeChanges = changes.filter((change) => change.type === 'added' || change.type === 'modified').length;
          recordServerSnapshotReads(listenerKey, snapshot.size, billableLikeChanges);
        }
        changes.forEach((change) => {
          const item = toItem(change.doc.id, change.doc.data(), 'branchRecord', kind, branchId);
          if (change.type === 'removed') remoteItems.delete(item.key);
          else if (item.payload !== undefined || item.deleted) remoteItems.set(item.key, item);
        });
        if (!snapshot.metadata.fromCache && incrementalBranchKinds.has(kind)) {
          const maxUpdatedAt = snapshot.docs.reduce((max, record) => {
            const updatedAt = record.get('updatedAt');
            return typeof updatedAt === 'string' && updatedAt > max ? updatedAt : max;
          }, existingCursor || '');
          if (maxUpdatedAt) saveCollectionCursor(uid, 'branchRecord', branchId, kind, maxUpdatedAt);
        }
        markReady(listenerKey, snapshot.metadata.fromCache);
      }, (error) => {
        ready.delete(listenerKey);
        publishAutoSyncStatus(uid, { state: error.code === 'unavailable' ? 'offline' : 'error', message: error.message || 'Branch Sync Listener error.' });
      });
      const branchMap = branchUnsubscribers.get(branchId) || new Map<BranchRecordKind, () => void>();
      branchMap.set(kind, unsubscribe);
      branchUnsubscribers.set(branchId, branchMap);
    };

    const branchCollectionRef = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches');
    recordFirestoreActivity(uid, 'listenerStart', 'listener:branches', 1);
    const unsubscribeBranches = onSnapshot(branchCollectionRef, listenOptions, (snapshot) => {
      if (disposed) return;
      const nextIds = snapshot.docs.map((record) => record.id).sort();
      const nextActiveIds = snapshot.docs
        .filter((record) => {
          const data = record.data();
          if (data.deleted === true) return false;
          const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : null;
          return payload?.status === 'active';
        })
        .map((record) => record.id)
        .sort();
      if (snapshot.metadata.fromCache) serverSnapshotSeen.delete('branches');
      else {
        const billableLikeChanges = snapshot.docChanges().filter((change) => change.type === 'added' || change.type === 'modified').length;
        recordServerSnapshotReads('branches', snapshot.size, billableLikeChanges);
      }
      snapshot.docChanges().forEach((change) => {
        const item = toItem(change.doc.id, change.doc.data(), 'branch', 'branches', change.doc.id);
        if (change.type === 'removed') remoteItems.delete(item.key);
        else if (item.payload !== undefined || item.deleted) remoteItems.set(item.key, item);
      });

      const previousActive = new Set(activeBranchIds);
      const next = new Set(nextIds);
      const nextActive = new Set(nextActiveIds);
      const removed = branchIds.filter((id) => !next.has(id));
      const noLongerActive = activeBranchIds.filter((id) => !nextActive.has(id));
      const addedActive = nextActiveIds.filter((id) => !previousActive.has(id));

      for (const branchId of removed) {
        const listeners = branchUnsubscribers.get(branchId);
        listeners?.forEach((unsubscribe, kind) => {
          unsubscribe();
          serverSnapshotSeen.delete(`branch:${branchId}:${kind}`);
          ready.delete(`branch:${branchId}:${kind}`);
        });
        branchUnsubscribers.delete(branchId);
        for (const [key, item] of remoteItems) {
          if ((item.scope === 'branchRecord' && item.branchId === branchId) || (item.scope === 'branch' && item.id === branchId)) remoteItems.delete(key);
        }
      }
      // Archived branches stop paying for record listeners. Their last known
      // cloud items stay cached in remoteItems so the merge treats them as
      // unchanged rather than missing until the branch is restored.
      for (const branchId of noLongerActive) {
        const listeners = branchUnsubscribers.get(branchId);
        listeners?.forEach((unsubscribe, kind) => {
          unsubscribe();
          serverSnapshotSeen.delete(`branch:${branchId}:${kind}`);
          ready.delete(`branch:${branchId}:${kind}`);
        });
        branchUnsubscribers.delete(branchId);
      }
      for (const branchId of addedActive) {
        branchRecordKinds.forEach((kind) => attachBranchCollection(branchId, kind));
      }
      branchIds = nextIds;
      activeBranchIds = nextActiveIds;
      markReady('branches', snapshot.metadata.fromCache);
      if (bootstrapping) tryBootstrapFromSnapshots();
      else if (isReady()) scheduleReconcile('remote');
    }, (error) => publishAutoSyncStatus(uid, { state: error.code === 'unavailable' ? 'offline' : 'error', message: error.message || 'Branch List Listener error.' }));
    unsubscribers.push(unsubscribeBranches);

    const attachSharedCollection = (kind: SharedRecordKind) => {
      if (sharedUnsubscribers.has(kind)) return;
      const listenerKey = `shared:${kind}`;
      serverSnapshotSeen.delete(listenerKey);
      const ref = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'shared', kind, 'records');
      const priorManifest = bootstrapping ? null : readManifest(uid, FIREBASE_BUSINESS_ID);
      const hasSharedBaseline = !!priorManifest && Object.values(priorManifest.records)
        .some((entry) => entry.scope === 'shared' && entry.kind === kind);
      const existingCursor = bootstrapping || isLocalDataResetPending() || isFullRefreshPending() ? null : (readStoredCollectionCursor(uid, 'shared', '', kind)
        || (hasSharedBaseline ? priorManifest?.savedAt || null : null));
      const listenedRef = existingCursor
        ? query(ref, where('updatedAt', '>=', new Date(Date.parse(existingCursor) - 120_000).toISOString()))
        : ref;
      recordFirestoreActivity(uid, 'listenerStart', `listener:${listenerKey}`, 1);
      const unsubscribe = onSnapshot(listenedRef, listenOptions, (snapshot) => {
        if (disposed) return;
        if (snapshot.metadata.fromCache) serverSnapshotSeen.delete(listenerKey);
        else {
          const billableLikeChanges = snapshot.docChanges().filter((change) => change.type === 'added' || change.type === 'modified').length;
          recordServerSnapshotReads(listenerKey, snapshot.size, billableLikeChanges);
        }
        snapshot.docChanges().forEach((change) => {
          const item = toItem(change.doc.id, change.doc.data(), 'shared', kind);
          if (change.type === 'removed') remoteItems.delete(item.key);
          else if (item.payload !== undefined || item.deleted) remoteItems.set(item.key, item);
        });
        if (!snapshot.metadata.fromCache) {
          sharedReady.add(kind);
          sharedBlocked.delete(kind);
          const maxUpdatedAt = snapshot.docs.reduce((max, record) => {
            const updatedAt = record.get('updatedAt');
            return typeof updatedAt === 'string' && updatedAt > max ? updatedAt : max;
          }, existingCursor || '');
          if (maxUpdatedAt) saveCollectionCursor(uid, 'shared', '', kind, maxUpdatedAt);
        } else {
          sharedReady.delete(kind);
        }
        markReady(listenerKey, snapshot.metadata.fromCache);
      }, (error) => {
        ready.delete(listenerKey);
        sharedReady.delete(kind);
        if (error.code === 'permission-denied') {
          sharedBlocked.add(kind);
          publishAutoSyncStatus(uid, {
            state: 'connecting',
            message: `Shared Data (${kind}) Cloud Rules မပြည့်စုံသေးပါ။ Product / Stock / Sales Auto Sync ကို ဆက်လုပ်နေပြီး Shared Data ကို ခေတ္တကျော်ထားပါတယ်။`,
          });
          if (bootstrapping) tryBootstrapFromSnapshots();
          else if (isReady()) scheduleReconcile('remote');
          return;
        }
        publishAutoSyncStatus(uid, {
          state: error.code === 'unavailable' ? 'offline' : 'error',
          message: error.message || `Shared ${kind} Listener error.`,
        });
      });
      sharedUnsubscribers.set(kind, unsubscribe);
    };

    sharedRecordKinds.forEach(attachSharedCollection);

    const forceFullListenerRefresh = () => {
      for (const [branchId, listeners] of [...branchUnsubscribers.entries()]) {
        for (const [kind, unsubscribe] of [...listeners.entries()]) {
          unsubscribe();
          serverSnapshotSeen.delete(`branch:${branchId}:${kind}`);
          ready.delete(`branch:${branchId}:${kind}`);
          listeners.delete(kind);
        }
      }
      for (const [kind, unsubscribe] of [...sharedUnsubscribers.entries()]) {
        unsubscribe();
        sharedUnsubscribers.delete(kind);
        serverSnapshotSeen.delete(`shared:${kind}`);
        ready.delete(`shared:${kind}`);
        sharedReady.delete(kind);
        sharedBlocked.delete(kind);
      }
      for (const branchId of activeBranchIds) branchRecordKinds.forEach((kind) => attachBranchCollection(branchId, kind));
      sharedRecordKinds.forEach(attachSharedCollection);
    };

    const handleLocalDataReplacement = () => {
      if (disposed) return;
      const marker = readLocalDataReplacement();
      if (!marker || marker.id === handledReplacementId) return;
      handledReplacementId = marker.id;
      localReplacementGeneration += 1;
      bootstrapGeneration += 1;
      // The local dataset was intentionally replaced (reset, restore or role
      // switch). Drop stale cursors and re-read cloud state before any push so
      // missing local records are never interpreted as cloud deletions.
      clearCollectionCursors(uid);
      markFullRefreshPending();
      bootstrapping = true;
      bootstrapAttempted = false;
      publishAutoSyncStatus(uid, {
        state: 'connecting',
        message: 'Local Data အစားထိုးမှုကို တွေ့ပါတယ်။ Cloud Data ကို မဖျက်ဘဲ Snapshot အသစ်နဲ့ Safe Rebaseline ပြန်လုပ်နေပါတယ်။',
      });
      forceFullListenerRefresh();
      if (isBootstrapReady()) tryBootstrapFromSnapshots();
    };
    const onCrossTabStorage = (event: StorageEvent) => {
      if (event.key && !event.key.startsWith('minimart-local-data-replacement')) return;
      handleLocalDataReplacement();
    };

    const metaRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'meta', 'settings');
    recordFirestoreActivity(uid, 'listenerStart', 'listener:meta-settings', 1);
    const unsubscribeMeta = onSnapshot(metaRef, listenOptions, (snapshot) => {
      if (disposed) return;
      if (snapshot.metadata.fromCache) serverSnapshotSeen.delete('meta-settings');
      else recordServerSnapshotReads('meta-settings', snapshot.exists() ? 1 : 0, snapshot.exists() ? 1 : 0);
      const key = keyOf('meta', 'settings', 'settings');
      if (snapshot.exists()) remoteItems.set(key, toItem('settings', snapshot.data(), 'meta', 'settings'));
      else remoteItems.delete(key);
      markReady('meta', snapshot.metadata.fromCache);
    }, (error) => publishAutoSyncStatus(uid, { state: error.code === 'unavailable' ? 'offline' : 'error', message: error.message || 'Settings Listener error.' }));
    unsubscribers.push(unsubscribeMeta);

    const localSyncFields = [
      'branches', 'categories', 'products', 'sales', 'expenses', 'cashierSettlements',
      'customerPayments', 'purchases', 'supplierPayments', 'purchaseReturns',
      'stockBatches', 'stockReceipts', 'stockTransfers', 'stockShipments', 'cashShifts',
      'cashMovements', 'branchFinanceLedgerEntries', 'cashierAdvanceReconciliations', 'branchFinanceReconciliations', 'customers', 'suppliers', 'priceGroups', 'settings', 'ownerProfile',
    ] as const;
    const unsubscribeStore = usePosStore.subscribe((state, previousState) => {
      if (applyingRemote || shipmentCommitInProgress || !isReady()) return;
      const businessDataChanged = localSyncFields.some((field) => state[field] !== previousState[field]);
      if (businessDataChanged) {
        publishAutoSyncStatus(uid, { state: 'connecting', message: 'ပြောင်းလဲမှုကို Firebase Cloud သို့ Sync လုပ်နေပါတယ်။' });
        scheduleReconcile('local');
      }
    });
    const unsubscribeHydration = usePosStore.persist.onFinishHydration(() => {
      if (!disposed) scheduleReconcile('local');
    });
    let lastIncrementalRefreshAt = 0;
    let hiddenSince: number | null = null;
    const refreshIncrementalListeners = () => {
      if (disposed || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastIncrementalRefreshAt < 30_000) return;
      lastIncrementalRefreshAt = now;
      branchUnsubscribers.forEach((listeners, branchId) => {
        for (const kind of incrementalBranchKinds) {
          const oldUnsubscribe = listeners.get(kind);
          oldUnsubscribe?.();
          listeners.delete(kind);
          ready.delete(`branch:${branchId}:${kind}`);
          attachBranchCollection(branchId, kind);
        }
      });
      for (const kind of sharedRecordKinds) {
        sharedUnsubscribers.get(kind)?.();
        sharedUnsubscribers.delete(kind);
        ready.delete(`shared:${kind}`);
        sharedReady.delete(kind);
        sharedBlocked.delete(kind);
        attachSharedCollection(kind);
      }
    };
    const onOnline = () => {
      if (bootstrapping) bootstrapAttempted = false;
      publishAutoSyncStatus(uid, { state: 'connecting', message: 'Internet ပြန်ရရှိပါပြီ။ နောက်ဆုံးပြောင်းလဲထားသော Cloud Record များကိုသာ ပြန်ချိတ်ဆက်နေပါတယ်။' });
      refreshIncrementalListeners();
      if (bootstrapping) tryBootstrapFromSnapshots();
      else scheduleReconcile('remote');
    };
    const onOffline = () => {
      lastIncrementalRefreshAt = 0;
      ready.clear();
      branchUnsubscribers.forEach((listeners, branchId) => {
        for (const kind of incrementalBranchKinds) {
          listeners.get(kind)?.();
          listeners.delete(kind);
          serverSnapshotSeen.delete(`branch:${branchId}:${kind}`);
          ready.delete(`branch:${branchId}:${kind}`);
        }
      });
      sharedUnsubscribers.forEach((unsubscribe) => unsubscribe());
      sharedUnsubscribers.clear();
      sharedReady.clear();
      sharedBlocked.clear();
      publishAutoSyncStatus(uid, { state: 'offline', message: 'Internet မရှိပါ။ POS Local Data ကို ဆက်သုံးနိုင်ပြီး ပြန်ချိတ်မိလျှင် နောက်ဆုံးပြောင်းလဲမှုများကိုသာ ပြန်ညှိပါမယ်။' });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now();
        return;
      }
      if (document.visibilityState === 'visible' && hiddenSince !== null) {
        const hiddenFor = Date.now() - hiddenSince;
        hiddenSince = null;
        if (hiddenFor >= 25 * 60_000) refreshIncrementalListeners();
      }
    };
    const onManualSyncRequested = () => {
      if (bootstrapping) tryBootstrapFromSnapshots();
      else scheduleReconcile('remote');
    };
    const onManifestWriteFailed = (event: Event) => {
      if (!eventUidMatches(event)) return;
      publishAutoSyncStatus(uid, {
        state: 'error',
        message: 'Sync Baseline ကို Browser Storage ထဲ သိမ်းမရပါ။ Storage ပြည့်နေနိုင်ပါတယ်။ Cloud Data မပျက်ပါ။ နေရာလွတ်ပြီး App ကို ပြန်ဖွင့်ပါ။',
      });
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('minimart-cloud-sync-requested', onManualSyncRequested);
    window.addEventListener('minimart-cloud-manifest-write-failed', onManifestWriteFailed);
    window.addEventListener(LOCAL_DATA_RESET_EVENT, handleLocalDataReplacement);
    window.addEventListener('storage', onCrossTabStorage);
    publishAutoSyncStatus(uid, { state: 'connecting', message: 'Owner Cloud Listener များကို ချိတ်ဆက်နေပါတယ်။' });

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      branchUnsubscribers.forEach((listeners) => listeners.forEach((unsubscribe) => unsubscribe()));
      sharedUnsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribeStore();
      unsubscribeHydration();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('minimart-cloud-sync-requested', onManualSyncRequested);
      window.removeEventListener('minimart-cloud-manifest-write-failed', onManifestWriteFailed);
      window.removeEventListener(LOCAL_DATA_RESET_EVENT, handleLocalDataReplacement);
      window.removeEventListener('storage', onCrossTabStorage);
      window.removeEventListener(BRANCH_SHIPMENT_CLOUD_COMMIT_STARTED, onShipmentCommitStarted);
      window.removeEventListener(BRANCH_SHIPMENT_CLOUD_COMMIT_CANCELLED, onShipmentCommitCancelled);
      window.removeEventListener(BRANCH_SHIPMENT_CLOUD_COMMIT_COMPLETED, onShipmentCommitCompleted);
      if (localTimer !== undefined) window.clearTimeout(localTimer);
      if (remoteTimer !== undefined) window.clearTimeout(remoteTimer);
    };
  }, [user.uid, access.status, access.role, access.uid]);

  return null;
}
