import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import { firebaseAuth, firestore, FIREBASE_BUSINESS_ID } from '../lib/firebase';
import { useBusinessAccess } from '../lib/businessAccess';
import { usePosStore } from '../store/usePosStore';
import { publishAutoSyncStatus } from '../lib/autoSyncStatus';
import { BRANCH_SHIPMENT_CLOUD_COMMIT_CANCELLED, BRANCH_SHIPMENT_CLOUD_COMMIT_COMPLETED, BRANCH_SHIPMENT_CLOUD_COMMIT_STARTED } from '../lib/branchShipmentCloudCommit';
import { recordFirestoreActivity } from '../lib/firestoreDiagnostics';
import {
  branchRecordKinds,
  buildLocalItems,
  hashPayload,
  importCloudItems,
  initializeOwnerDeviceSyncFromSnapshot,
  keyOf,
  manifestFromItems,
  readManifest,
  saveManifest,
  writeItemsIfBaselineUnchanged,
  type BranchRecordKind,
  sharedRecordKinds,
  type SharedRecordKind,
  type SyncItem,
} from './CloudSyncPanel';

const DELETED_HASH = '__MINIMART_DELETED__';
const MISSING_HASH = '__MINIMART_MISSING__';
const listenOptions = { includeMetadataChanges: true } as const;
const SESSION_UID_KEY = 'minimart-active-session-uid-v1';

// Historical collections are synchronized incrementally. Only categories and products
// stay full-collection listeners because the checkout flow needs them immediately.
const incrementalBranchKinds = new Set<BranchRecordKind>([
  'sales', 'expenses', 'cashierSettlements', 'customerPayments', 'purchases', 'supplierPayments',
  'purchaseReturns', 'stockBatches', 'stockReceipts', 'stockTransfers', 'stockShipments', 'cashShifts', 'cashMovements', 'branchFinanceLedgerEntries', 'cashierAdvanceReconciliations', 'branchFinanceReconciliations',
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
  const stored = readStoredCollectionCursor(uid, scope, branchId, kind);
  if (stored) return stored;
  const baselineTime = readManifest(uid)?.savedAt;
  return baselineTime && !Number.isNaN(Date.parse(baselineTime)) ? baselineTime : null;
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
 */
export function OwnerAutoSyncProvider() {
  const access = useBusinessAccess();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, setUser);
  }, []);

  useEffect(() => {
    const uid = user?.uid;
    const isOwner = !!uid && access.status === 'active' && access.role === 'owner' && access.uid === uid;
    if (!uid || !isOwner || !firestore) return;

    try {
      localStorage.setItem(SESSION_UID_KEY, uid);
    } catch { /* ignore storage errors */ }

    let bootstrapping = !readManifest(uid);
    let bootstrapAttempted = false;
    let disposed = false;
    let isReconciling = false;
    let reconcileAgain = false;
    let applyingRemote = false;
    let branchIds: string[] = [];
    const ready = new Set<string>();
    const pendingWrites = new Set<string>();
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
      && branchIds.every((branchId) => branchRecordKinds.every((kind) => ready.has(`branch:${branchId}:${kind}`)));
    const isReady = () => coreListenersReady() && pendingWrites.size === 0 && navigator.onLine;
    const isBootstrapReady = () => coreListenersReady()
      && sharedReady.size + sharedBlocked.size >= sharedRecordKinds.length
      && pendingWrites.size === 0 && navigator.onLine;
    const reconcile = async () => {
      if (disposed || bootstrapping || !isReady()) return;
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
          const baselineEntry = baseline.records[key];
          const recordScope = localItem?.scope || remoteItem?.scope || baselineEntry?.scope;
          const recordKind = localItem?.kind || remoteItem?.kind || baselineEntry?.kind;
          if (recordScope === 'shared' && !sharedReady.has(recordKind as SharedRecordKind)) continue;
          const baseHash = baselineEntry?.hash;
          const localHash = localItem ? hashPayload(localItem.payload) : DELETED_HASH;
          const remoteHash = remoteItem
            ? (remoteItem.deleted ? DELETED_HASH : hashPayload(remoteItem.payload))
            : (baselineEntry && ((recordScope === 'branchRecord' && incrementalBranchKinds.has(recordKind as BranchRecordKind))
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
        saveManifest(uid, nextManifest);
        const sharedWarning = sharedBlocked.size
          ? ` Shared Data (${[...sharedBlocked].join(', ')}) Sync ကို Firestore Rules ခွင့်မပြုသေးပါ။ Product / Stock / Sales Sync ကို ဆက်လုပ်နေပါတယ်။ Rules ပြင်ပြီး App ကို ပြန်ဖွင့်ပါ။`
          : '';
        publishAutoSyncStatus(uid, { state: 'synced', message: `Owner Device Auto Sync အလုပ်လုပ်နေပါတယ်။${sharedWarning}`, savedAt: new Date().toISOString() });
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
      const baseline = readManifest(uid);
      if (baseline) {
        const nextRecords = { ...baseline.records };
        detail.records.forEach((item) => {
          nextRecords[item.key] = {
            scope: item.scope, kind: item.kind, id: item.id, branchId: item.branchId,
            hash: hashPayload(item.payload),
          };
        });
        saveManifest(uid, nextRecords);
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
      publishAutoSyncStatus(uid, {
        state: 'connecting',
        message: 'Realtime Listener မှ Server Snapshot များကို အသုံးပြုပြီး Device အသစ်၏ Safe Merge ကို စတင်နေပါတယ်။ Collection အားလုံးကို သီးခြား Full Scan ထပ်မလုပ်ပါ။',
      });
      void initializeOwnerDeviceSyncFromSnapshot(uid, remoteItems, [...sharedBlocked]).then((result) => {
        if (disposed) return;
        bootstrapping = false;
        publishAutoSyncStatus(uid, {
          state: 'connecting',
          message: `ပထမဆုံး Device Sync ပြီးပါပြီ။ Listener Snapshot မှ Cloud ${result.cloudRecords} records ကို ပေါင်းစည်းပြီး Device-only ${result.localOnlyRecords} records ကို ထိန်းသိမ်းထားပါတယ်။`,
        });
        scheduleReconcile('remote');
      }).catch((error: unknown) => {
        if (disposed) return;
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

    const markReady = (key: string, fromCache: boolean, hasPending: boolean) => {
      if (!fromCache) ready.add(key);
      else {
        ready.delete(key);
        if (!navigator.onLine) publishAutoSyncStatus(uid, { state: 'offline', message: 'Offline Cache မှာ ဖတ်ထားပါတယ်။ Server နဲ့ မချိတ်မိသေးပါ။' });
      }
      if (hasPending) pendingWrites.add(key);
      else pendingWrites.delete(key);
      if (bootstrapping) tryBootstrapFromSnapshots();
      else if (isReady()) scheduleReconcile('remote');
    };

    const attachBranchCollection = (branchId: string, kind: BranchRecordKind) => {
      if (branchUnsubscribers.get(branchId)?.has(kind)) return;
      const listenerKey = `branch:${branchId}:${kind}`;
      serverSnapshotSeen.delete(listenerKey);
      const collectionRef = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, kind);
      const savedBaseline = bootstrapping ? null : readManifest(uid);
      const branchHasBaseline = !!savedBaseline && Object.values(savedBaseline.records).some((entry) => entry.scope === 'branch' && entry.id === branchId);
      const existingCursor = bootstrapping || !branchHasBaseline ? null : readCollectionCursor(uid, 'branchRecord', branchId, kind);
      const isIncremental = incrementalBranchKinds.has(kind) && !!existingCursor;
      const listenedRef = isIncremental && existingCursor
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
        markReady(listenerKey, snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);
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

      const previous = new Set(branchIds);
      const next = new Set(nextIds);
      const removed = branchIds.filter((id) => !next.has(id));
      const added = nextIds.filter((id) => !previous.has(id));

      for (const branchId of removed) {
        const listeners = branchUnsubscribers.get(branchId);
        listeners?.forEach((unsubscribe, kind) => {
          unsubscribe();
          serverSnapshotSeen.delete(`branch:${branchId}:${kind}`);
          ready.delete(`branch:${branchId}:${kind}`);
          pendingWrites.delete(`branch:${branchId}:${kind}`);
        });
        branchUnsubscribers.delete(branchId);
        for (const [key, item] of remoteItems) {
          if ((item.scope === 'branchRecord' && item.branchId === branchId) || (item.scope === 'branch' && item.id === branchId)) remoteItems.delete(key);
        }
      }
      for (const branchId of added) {
        branchRecordKinds.forEach((kind) => attachBranchCollection(branchId, kind));
      }
      branchIds = nextIds;
      markReady('branches', snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);
      if (bootstrapping) tryBootstrapFromSnapshots();
      else if (isReady()) scheduleReconcile('remote');
    }, (error) => publishAutoSyncStatus(uid, { state: error.code === 'unavailable' ? 'offline' : 'error', message: error.message || 'Branch List Listener error.' }));
    unsubscribers.push(unsubscribeBranches);

    const attachSharedCollection = (kind: SharedRecordKind) => {
      if (sharedUnsubscribers.has(kind)) return;
      const listenerKey = `shared:${kind}`;
      serverSnapshotSeen.delete(listenerKey);
      const ref = collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'shared', kind, 'records');
      const priorManifest = bootstrapping ? null : readManifest(uid);
      const hasSharedBaseline = !!priorManifest && Object.values(priorManifest.records)
        .some((entry) => entry.scope === 'shared' && entry.kind === kind);
      const existingCursor = bootstrapping ? null : (readStoredCollectionCursor(uid, 'shared', '', kind)
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
        markReady(listenerKey, snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);
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

    const metaRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'meta', 'settings');
    recordFirestoreActivity(uid, 'listenerStart', 'listener:meta-settings', 1);
    const unsubscribeMeta = onSnapshot(metaRef, listenOptions, (snapshot) => {
      if (disposed) return;
      if (snapshot.metadata.fromCache) serverSnapshotSeen.delete('meta-settings');
      else recordServerSnapshotReads('meta-settings', snapshot.exists() ? 1 : 0, snapshot.exists() ? 1 : 0);
      const key = keyOf('meta', 'settings', 'settings');
      if (snapshot.exists()) remoteItems.set(key, toItem('settings', snapshot.data(), 'meta', 'settings'));
      else remoteItems.delete(key);
      markReady('meta', snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites);
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
          pendingWrites.delete(`branch:${branchId}:${kind}`);
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
      pendingWrites.clear();
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
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('minimart-cloud-sync-requested', onManualSyncRequested);
    publishAutoSyncStatus(uid, { state: 'connecting', message: 'Owner Cloud Listener များကို ချိတ်ဆက်နေပါတယ်။' });

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      branchUnsubscribers.forEach((listeners) => listeners.forEach((unsubscribe) => unsubscribe()));
      sharedUnsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribeStore();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('minimart-cloud-sync-requested', onManualSyncRequested);
      window.removeEventListener(BRANCH_SHIPMENT_CLOUD_COMMIT_STARTED, onShipmentCommitStarted);
      window.removeEventListener(BRANCH_SHIPMENT_CLOUD_COMMIT_CANCELLED, onShipmentCommitCancelled);
      window.removeEventListener(BRANCH_SHIPMENT_CLOUD_COMMIT_COMPLETED, onShipmentCommitCompleted);
      if (localTimer !== undefined) window.clearTimeout(localTimer);
      if (remoteTimer !== undefined) window.clearTimeout(remoteTimer);
    };
  }, [user?.uid, access.status, access.role, access.uid]);

  return null;
}
