import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, runTransaction, type DocumentReference } from 'firebase/firestore';
import { ArrowLeftRight, Cloud, ShieldCheck, UserRound } from 'lucide-react';
import { firebaseAuth, firebaseConfigured, firestore, FIREBASE_BUSINESS_ID } from '../lib/firebase';
import { useBusinessAccess } from '../lib/businessAccess';
import { usePosStore, type Branch } from '../store/usePosStore';
import { OwnerAutoSyncStatus } from './OwnerAutoSyncStatus';
import { clearFirestoreDiagnostics, FIRESTORE_DIAGNOSTICS_EVENT, readFirestoreDiagnostics, type FirestoreDiagnosticsSummary, recordFirestoreActivity } from '../lib/firestoreDiagnostics';

export type BranchRecordKind = 'categories' | 'products' | 'sales' | 'expenses' | 'cashierSettlements' | 'heldItems' | 'customerPayments' | 'purchases' | 'supplierPayments' | 'purchaseReturns' | 'stockBatches' | 'stockReceipts' | 'stockTransfers' | 'stockShipments' | 'stockUnitRegistries' | 'cashShifts' | 'cashMovements' | 'activityLogs' | 'branchFinanceLedgerEntries' | 'cashierAdvanceReconciliations' | 'branchFinanceReconciliations';
export type SharedRecordKind = 'customers' | 'suppliers';
export type SyncScope = 'branch' | 'branchRecord' | 'shared' | 'meta';
export type SyncKind = BranchRecordKind | SharedRecordKind | 'branches' | 'settings';
export type SyncItem = { key: string; scope: SyncScope; kind: SyncKind; id: string; branchId?: string; payload: unknown; deleted?: boolean };
export type ManifestEntry = { scope: SyncScope; kind: SyncKind; id: string; branchId?: string; hash: string };
export type SyncManifest = { version: 2; businessId: string; savedAt: string; records: Record<string, ManifestEntry> };
export type CloudRead = { items: Map<string, SyncItem>; unavailableSharedKinds: SharedRecordKind[] };

export const branchRecordKinds: BranchRecordKind[] = ['categories', 'products', 'sales', 'expenses', 'cashierSettlements', 'heldItems', 'customerPayments', 'purchases', 'supplierPayments', 'purchaseReturns', 'stockBatches', 'stockReceipts', 'stockTransfers', 'stockShipments', 'stockUnitRegistries', 'cashShifts', 'cashMovements', 'activityLogs', 'branchFinanceLedgerEntries', 'cashierAdvanceReconciliations', 'branchFinanceReconciliations'];
export const sharedRecordKinds: SharedRecordKind[] = ['customers', 'suppliers'];
const DELETED_HASH = '__MINIMART_DELETED__';
const MISSING_HASH = '__MINIMART_MISSING__';
const manifestKey = (uid: string) => `minimart-cloud-sync-manifest-v2:${FIREBASE_BUSINESS_ID}:${uid}`;
const safeJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
export function hashPayload(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function stripDeviceImages<T>(value: T): T {
  const clean = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(clean);
    if (!input || typeof input !== 'object') return input;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
      if (typeof child === 'string' && ['logoUrl', 'bannerUrl', 'photoUrl', 'image'].includes(key) && (child.startsWith('local-image:') || child.startsWith('data:image/'))) output[key] = '';
      else output[key] = clean(child);
    }
    return output;
  };
  return clean(safeJson(value)) as T;
}
export function keyOf(scope: SyncScope, kind: SyncKind, id: string, branchId?: string) { return `${scope}::${branchId || ''}::${kind}::${id}`; }

export function buildLocalItems(state: ReturnType<typeof usePosStore.getState>): Map<string, SyncItem> {
  const result = new Map<string, SyncItem>();
  for (const branch of state.branches) {
    const item: SyncItem = { key: keyOf('branch', 'branches', branch.id, branch.id), scope: 'branch', kind: 'branches', id: branch.id, branchId: branch.id, payload: stripDeviceImages(branch) };
    result.set(item.key, item);
  }

  const data: Record<BranchRecordKind, unknown[]> = {
    categories: state.categories, products: state.products, sales: state.sales, expenses: state.expenses, cashierSettlements: state.cashierSettlements, heldItems: state.heldItems,
    customerPayments: state.customerPayments, purchases: state.purchases, supplierPayments: state.supplierPayments,
    purchaseReturns: state.purchaseReturns, stockBatches: state.stockBatches, stockReceipts: state.stockReceipts,
    stockTransfers: state.stockTransfers, stockShipments: state.stockShipments, stockUnitRegistries: state.stockUnitRegistries, cashShifts: state.cashShifts, cashMovements: state.cashMovements, activityLogs: state.activityLogs, branchFinanceLedgerEntries: state.branchFinanceLedgerEntries, cashierAdvanceReconciliations: state.cashierAdvanceReconciliations, branchFinanceReconciliations: state.branchFinanceReconciliations,
  };
  const validBranches = new Set(state.branches.map((branch) => branch.id));
  const fallbackBranch = state.branches.find((branch) => branch.isDefault)?.id || state.activeBranchId;
  for (const kind of branchRecordKinds) {
    for (const raw of data[kind]) {
      if (!raw || typeof raw !== 'object') continue;
      const record = raw as Record<string, unknown>;
      const id = typeof record.id === 'string' && record.id ? record.id : kind === 'heldItems' && typeof record.productId === 'string' ? record.productId : '';
      if (!id) continue;
      const requestedBranch = kind === 'stockTransfers' ? record.fromBranchId : record.branchId;
      const resolvedBranch = kind === 'stockShipments' ? record.toBranchId : requestedBranch;
      const branchId = typeof resolvedBranch === 'string' && validBranches.has(resolvedBranch) ? resolvedBranch : fallbackBranch;
      const sourceRecord = { ...record };
      // Device-local queue indicators must never become shared Firestore fields.
      delete sourceRecord.cloudSyncStatus;
      delete sourceRecord.cloudSyncError;
      const payload = stripDeviceImages(kind === 'stockTransfers' ? sourceRecord : { ...sourceRecord, branchId });
      const item: SyncItem = { key: keyOf('branchRecord', kind, id, branchId), scope: 'branchRecord', kind, id, branchId, payload };
      result.set(item.key, item);
    }
  }

  for (const kind of sharedRecordKinds) {
    const records = kind === 'customers' ? state.customers : state.suppliers;
    for (const raw of records) {
      if (!raw?.id) continue;
      const item: SyncItem = { key: keyOf('shared', kind, raw.id), scope: 'shared', kind, id: raw.id, payload: stripDeviceImages(raw) };
      result.set(item.key, item);
    }
  }

  const { adminPin: _localOnlyPin, ...cloudSettings } = state.settings;
  const payload = stripDeviceImages({ settings: cloudSettings, ownerProfile: { ...state.ownerProfile, photoUrl: '' } });
  const meta: SyncItem = { key: keyOf('meta', 'settings', 'settings'), scope: 'meta', kind: 'settings', id: 'settings', payload };
  result.set(meta.key, meta);
  return result;
}

function hashOf(item: SyncItem): string { return item.deleted ? DELETED_HASH : hashPayload(item.payload); }
function manifestEntry(item: SyncItem): ManifestEntry { return { scope: item.scope, kind: item.kind, id: item.id, branchId: item.branchId, hash: hashOf(item) }; }

function withoutBootstrapTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutBootstrapTimestamps);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'createdAt' || key === 'updatedAt') continue;
    output[key] = withoutBootstrapTimestamps(child);
  }
  return output;
}

function isDefaultMetaPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const source = payload as Record<string, unknown>;
  const settings = source.settings && typeof source.settings === 'object' ? source.settings as Record<string, unknown> : {};
  const owner = source.ownerProfile && typeof source.ownerProfile === 'object' ? source.ownerProfile as Record<string, unknown> : {};
  return settings.storeName === 'My Minimart'
    && settings.currency === 'MMK'
    && settings.receiptFooter === 'Thank you. Please come again!'
    && !owner.displayName && !owner.phone;
}

function isBootstrapEquivalent(local: SyncItem, remote: SyncItem): boolean {
  if (remote.deleted) return false;
  if (local.scope === 'branch' && local.id === 'branch-main') {
    const branch = local.payload as Record<string, unknown>;
    const settings = branch.settings && typeof branch.settings === 'object' ? branch.settings as Record<string, unknown> : {};
    const isEmptyDefaultBranch = branch.code === 'MAIN'
      && (branch.name === 'My Minimart' || branch.name === 'Main Store')
      && !branch.address && !branch.phone
      && branch.status === 'active' && branch.isDefault === true
      && (!branch.logoUrl || String(branch.logoUrl).startsWith('local-image:'))
      && (!branch.bannerUrl || String(branch.bannerUrl).startsWith('local-image:'))
      && (settings.storeName === 'My Minimart' || settings.storeName === 'Main Store')
      && (settings.currency === 'MMK' || !settings.currency)
      && (settings.receiptFooter === 'Thank you. Please come again!' || !settings.receiptFooter);
    if (isEmptyDefaultBranch) return true;
  }
  if (local.scope === 'branchRecord' && local.kind === 'categories') {
    return hashPayload(withoutBootstrapTimestamps(local.payload)) === hashPayload(withoutBootstrapTimestamps(remote.payload));
  }
  if (local.scope === 'meta' && isDefaultMetaPayload(local.payload)) return true;
  return false;
}
export function readManifest(uid: string): SyncManifest | null {
  try {
    const raw = localStorage.getItem(manifestKey(uid));
    if (!raw) return null;
    const value = JSON.parse(raw) as SyncManifest;
    return value.version === 2 && value.businessId === FIREBASE_BUSINESS_ID && value.records ? value : null;
  } catch { return null; }
}
export function saveManifest(uid: string, records: Record<string, ManifestEntry>) {
  localStorage.setItem(manifestKey(uid), JSON.stringify({ version: 2, businessId: FIREBASE_BUSINESS_ID, savedAt: new Date().toISOString(), records } satisfies SyncManifest));
  window.dispatchEvent(new CustomEvent('minimart-cloud-manifest-updated', { detail: { uid } }));
}
export function manifestFromItems(items: Map<string, SyncItem>) {
  const records: Record<string, ManifestEntry> = {};
  for (const [key, item] of items) records[key] = manifestEntry(item);
  return records;
}

export type DeviceBootstrapResult = {
  cloudRecords: number;
  localOnlyRecords: number;
  mergedRecords: number;
  unavailableSharedKinds: SharedRecordKind[];
};

// Bootstrap from the already-received realtime snapshots. This avoids a full
// Do not run a separate full server scan before attaching the realtime listeners.
async function mergeOwnerDeviceSnapshot(uid: string, cloud: CloudRead): Promise<DeviceBootstrapResult> {
  const local = buildLocalItems(usePosStore.getState());
  const merged = new Map<string, SyncItem>(cloud.items);
  const localOnly: SyncItem[] = [];
  const conflicts: string[] = [];

  const unavailableShared = new Set(cloud.unavailableSharedKinds);
  for (const [key, item] of local) {
    if (item.scope === 'shared' && unavailableShared.has(item.kind as SharedRecordKind)) continue;
    const remote = cloud.items.get(key);
    if (!remote) {
      localOnly.push(item);
      merged.set(key, item);
      continue;
    }
    if (!remote.deleted && hashPayload(remote.payload) === hashPayload(item.payload)) continue;
    if (isBootstrapEquivalent(item, remote)) continue;
    conflicts.push(key);
  }

  if (conflicts.length) {
    const examples = conflicts.slice(0, 5).map((key) => key.split('::').filter(Boolean).slice(-2).join(' / ')).join(', ');
    const conflict = new Error(`ဒီ Device နဲ့ Cloud မှာ ID တူပြီး Data မတူတဲ့ Record ${conflicts.length} ခု ရှိပါတယ်။ ဘယ်ဖက်ကိုမှ အလိုအလျောက် မအစားထိုးပါ။ ဥပမာ: ${examples}${conflicts.length > 5 ? ' …' : ''}။ JSON Backup ထုတ်ပြီး Record တွေကို စစ်ဆေးပါ။`);
    conflict.name = 'SyncConflictError';
    throw conflict;
  }

  if (localOnly.length) {
    const emptyBaseline: SyncManifest = {
      version: 2,
      businessId: FIREBASE_BUSINESS_ID,
      savedAt: new Date().toISOString(),
      records: {},
    };
    await writeItemsIfBaselineUnchanged(localOnly, uid, emptyBaseline);
  }

  // Import the union before persisting the baseline, so local state and the
  // manifest describe the same merged dataset.
  importCloudItems(merged, { unavailableSharedKinds: cloud.unavailableSharedKinds });
  saveManifest(uid, manifestFromItems(merged));

  return {
    cloudRecords: cloud.items.size,
    localOnlyRecords: localOnly.length,
    mergedRecords: merged.size,
    unavailableSharedKinds: cloud.unavailableSharedKinds,
  };
}

const deviceBootstrapPromises = new Map<string, Promise<DeviceBootstrapResult>>();

function rememberBootstrap(uid: string, task: Promise<DeviceBootstrapResult>) {
  deviceBootstrapPromises.set(uid, task);
  task.then(
    () => { if (deviceBootstrapPromises.get(uid) === task) deviceBootstrapPromises.delete(uid); },
    () => { if (deviceBootstrapPromises.get(uid) === task) deviceBootstrapPromises.delete(uid); },
  );
  return task;
}

/**
 * Initializes a new Owner device from snapshots already delivered by onSnapshot.
 * The caller must wait until every required query has a server-confirmed snapshot.
 */
export function initializeOwnerDeviceSyncFromSnapshot(
  uid: string,
  items: Map<string, SyncItem>,
  unavailableSharedKinds: SharedRecordKind[] = [],
): Promise<DeviceBootstrapResult> {
  const existing = deviceBootstrapPromises.get(uid);
  if (existing) return existing;
  const cloud: CloudRead = { items: new Map(items), unavailableSharedKinds: [...unavailableSharedKinds] };
  return rememberBootstrap(uid, mergeOwnerDeviceSnapshot(uid, cloud));
}

function pathFor(item: SyncItem): string[] {
  if (item.scope === 'branch') return ['businesses', FIREBASE_BUSINESS_ID, 'branches', item.id];
  if (item.scope === 'shared') return ['businesses', FIREBASE_BUSINESS_ID, 'shared', item.kind, 'records', item.id];
  if (item.scope === 'meta') return ['businesses', FIREBASE_BUSINESS_ID, 'meta', 'settings'];
  return ['businesses', FIREBASE_BUSINESS_ID, 'branches', item.branchId || '', String(item.kind), item.id];
}
function refFor(item: SyncItem): DocumentReference {
  // Pass a single slash-delimited document path to avoid Firestore overload inference
  // errors from spreading a dynamic string[] into doc().
  const documentPath = pathFor(item).join('/');
  return doc(firestore, documentPath);
}
function cloudDocument(item: SyncItem, uid: string) {
  return { scope: item.scope, kind: item.kind, ...(item.branchId ? { branchId: item.branchId } : {}), payload: item.deleted ? null : item.payload, deleted: item.deleted === true, updatedAt: new Date().toISOString(), updatedBy: uid };
}
/** Auto-sync write path: compare the live server value with the per-device baseline inside a transaction. */
export async function writeItemsIfBaselineUnchanged(items: SyncItem[], uid: string, baseline: SyncManifest) {
  let committedWriteCount = 0;
  let transactionChunkCount = 0;
  for (let offset = 0; offset < items.length; offset += 400) {
    const chunk = items.slice(offset, offset + 400);
    let committedAttemptWriteCount = 0;
    await runTransaction(firestore, async (transaction) => {
      const refs = chunk.map((item) => refFor(item));
      const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const writes: Array<{ item: SyncItem; index: number }> = [];
      snapshots.forEach((snapshot, index) => {
        const item = chunk[index];
        const data = snapshot.exists() ? snapshot.data() : null;
        const remoteHash = !data ? MISSING_HASH : data.deleted === true ? DELETED_HASH : hashPayload(data.payload);
        const desiredHash = hashOf(item);
        if (remoteHash === desiredHash) return;
        const baseHash = baseline.records[item.key]?.hash ?? MISSING_HASH;
        if (remoteHash !== baseHash) {
          const conflict = new Error(`Server data changed during Auto Sync: ${item.kind} / ${item.id}`);
          conflict.name = 'SyncConflictError';
          throw conflict;
        }
        writes.push({ item, index });
      });
      committedAttemptWriteCount = writes.length;
      for (const { item, index } of writes) transaction.set(refs[index], cloudDocument(item, uid), { merge: true });
    });
    transactionChunkCount += 1;
    committedWriteCount += committedAttemptWriteCount;
    recordFirestoreActivity(uid, 'read', 'sync-transaction-check', chunk.length);
    recordFirestoreActivity(uid, 'write', 'sync-transaction-commit', committedAttemptWriteCount);
  }
  // Count-only diagnostics stay in this device's console; never write usage
  // telemetry back to Firestore, which would create more billing traffic.
  if (items.length) console.info('[Minimart Sync Write]', {
    candidateDocs: items.length,
    transactionChunks: transactionChunkCount,
    transactionReadDocsPerAttempt: items.length,
    committedWriteDocs: committedWriteCount,
  });
}

export function importCloudItems(items: Map<string, SyncItem>, options: { unavailableSharedKinds?: readonly SharedRecordKind[] } = {}) {
  const current = usePosStore.getState();
  const live = [...items.values()].filter((item) => !item.deleted);
  const branches = live.filter((item) => item.scope === 'branch').map((item) => {
    const branch = item.payload as Branch;
    const local = current.branches.find((entry) => entry.id === item.id);
    return { ...branch, logoUrl: local?.logoUrl || branch.logoUrl || '', bannerUrl: local?.bannerUrl || branch.bannerUrl || '' };
  });
  const grouped: Record<BranchRecordKind, unknown[]> = {
    categories: [], products: [], sales: [], expenses: [], cashierSettlements: [], heldItems: [], customerPayments: [], purchases: [], supplierPayments: [], purchaseReturns: [], stockBatches: [], stockReceipts: [], stockTransfers: [], stockShipments: [], stockUnitRegistries: [], cashShifts: [], cashMovements: [], activityLogs: [], branchFinanceLedgerEntries: [], cashierAdvanceReconciliations: [], branchFinanceReconciliations: [],
  };
  const customers: unknown[] = [];
  const suppliers: unknown[] = [];
  const unavailableShared = new Set(options.unavailableSharedKinds || []);
  let cloudSettings: Record<string, unknown> = {};
  let cloudOwner: Record<string, unknown> = {};

  for (const item of live) {
    if (item.scope === 'branchRecord') {
      const payload = item.payload && typeof item.payload === 'object' ? { ...(item.payload as Record<string, unknown>) } : item.payload;
      if (payload && typeof payload === 'object' && item.kind !== 'stockTransfers') (payload as Record<string, unknown>).branchId = item.branchId;
      grouped[item.kind as BranchRecordKind].push(payload);
    } else if (item.scope === 'shared') {
      if (item.kind === 'customers') customers.push(item.payload);
      if (item.kind === 'suppliers') suppliers.push(item.payload);
    } else if (item.scope === 'meta' && item.payload && typeof item.payload === 'object') {
      const payload = item.payload as Record<string, unknown>;
      cloudSettings = payload.settings && typeof payload.settings === 'object' ? payload.settings as Record<string, unknown> : {};
      cloudOwner = payload.ownerProfile && typeof payload.ownerProfile === 'object' ? payload.ownerProfile as Record<string, unknown> : {};
    }
  }

  const activeBranchId = branches.some((branch) => branch.id === current.activeBranchId && branch.status === 'active')
    ? current.activeBranchId : branches.find((branch) => branch.isDefault)?.id || branches[0]?.id;
  const settings = { ...current.settings, ...cloudSettings, adminPin: current.settings.adminPin };
  const ownerProfile = { ...current.ownerProfile, ...cloudOwner, photoUrl: current.ownerProfile.photoUrl || (typeof cloudOwner.photoUrl === 'string' ? cloudOwner.photoUrl : '') };
  usePosStore.getState().importData({
    branches: branches as never[], activeBranchId, categories: grouped.categories as never[], products: grouped.products as never[],
    sales: grouped.sales as never[], expenses: grouped.expenses as never[], cashierSettlements: grouped.cashierSettlements as never[], branchFinanceLedgerEntries: grouped.branchFinanceLedgerEntries as never[], cashierAdvanceReconciliations: grouped.cashierAdvanceReconciliations as never[], branchFinanceReconciliations: grouped.branchFinanceReconciliations as never[], heldItems: grouped.heldItems as never[],
    customers: unavailableShared.has('customers') ? undefined : customers as never[], suppliers: unavailableShared.has('suppliers') ? undefined : suppliers as never[], customerPayments: grouped.customerPayments as never[],
    purchases: grouped.purchases as never[], supplierPayments: grouped.supplierPayments as never[], purchaseReturns: grouped.purchaseReturns as never[],
    stockBatches: grouped.stockBatches as never[], stockReceipts: grouped.stockReceipts as never[], stockTransfers: grouped.stockTransfers as never[], stockShipments: grouped.stockShipments as never[], stockUnitRegistries: grouped.stockUnitRegistries as never[],
    cashShifts: grouped.cashShifts as never[], cashMovements: grouped.cashMovements as never[], activityLogs: grouped.activityLogs as never[],
    ownerProfile: ownerProfile as never, settings: settings as never,
  });
}


export function CloudSyncPanel({ onOpenProfile }: { onOpenProfile?: () => void }) {
  const access = useBusinessAccess();
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastSynced, setLastSynced] = useState('');
  const [diagnostics, setDiagnostics] = useState<FirestoreDiagnosticsSummary>(() => readFirestoreDiagnostics(access.uid));

  useEffect(() => {
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, setUser);
  }, []);
  const isOwner = access.status === 'active' && access.role === 'owner' && !!user && user.uid === access.uid;

  useEffect(() => {
    if (!user) return;
    const refresh = () => setDiagnostics(readFirestoreDiagnostics(user.uid));
    refresh();
    const onStorage = (event: StorageEvent) => { if (event.key?.includes(user.uid)) refresh(); };
    window.addEventListener(FIRESTORE_DIAGNOSTICS_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(FIRESTORE_DIAGNOSTICS_EVENT, refresh); window.removeEventListener('storage', onStorage); };
  }, [user?.uid]);
  const [manifest, setManifest] = useState<SyncManifest | null>(null);

  useEffect(() => {
    if (!user) {
      setManifest(null);
      return;
    }
    const refreshManifest = () => setManifest(readManifest(user.uid));
    refreshManifest();
    window.addEventListener('minimart-cloud-manifest-updated', refreshManifest);
    return () => window.removeEventListener('minimart-cloud-manifest-updated', refreshManifest);
  }, [user?.uid]);

  const requestIncrementalSync = () => {
    setError('');
    setMessage('လက်ရှိ Realtime Snapshot နှင့် ပြောင်းလဲထားသော Local Data ကိုသာ နှိုင်းယှဉ်နေပါတယ်။ Collection အားလုံးကို Full Scan ထပ်မလုပ်ပါ။');
    setLastSynced(new Date().toLocaleString());
    window.dispatchEvent(new Event('minimart-cloud-sync-requested'));
  };

  if (!firebaseConfigured || !firebaseAuth || !firestore) return <div className="panel cloud-panel"><div className="panel-heading"><div className="panel-icon"><Cloud size={18} /></div><div><h3>Business Cloud Sync</h3><p>Firebase Configuration မရရှိသေးပါ။</p></div></div></div>;

  return <div className="panel cloud-panel">
    <div className="panel-heading"><div className="panel-icon"><Cloud size={18} /></div><div><h3>Business Cloud Sync</h3><p>Branch အလိုက် Product / Stock / Sales နှင့် Shared Customer / Supplier ကို Owner Device များအကြား Sync လုပ်ပါ။</p></div><span className="tag tag-success">{access.status === 'active' ? 'Access Active' : access.status}</span></div>
    {user ? <>
      <div className="cloud-status"><ShieldCheck size={19} color="#0f766e" /><div><strong>{isOwner ? 'Business Owner Account ချိတ်ဆက်ထားသည်' : 'Business Access စစ်ဆေးရန် လိုအပ်သည်'}</strong><small className="cloud-email">{user.email || user.uid} · {FIREBASE_BUSINESS_ID}</small></div><button className="button button-outline" type="button" onClick={onOpenProfile} disabled={!onOpenProfile}><UserRound size={14} /> Account စီမံရန်</button></div>
      {!isOwner ? <div className="cloud-error">Owner Manual Sync ကို Owner Account သာ အသုံးပြုနိုင်ပါတယ်။ Cashier အတွက် Product / Stock Read နဲ့ ကိုယ်ပိုင် Sales Cloud Queue ကို သီးခြား Auto Sync လုပ်နေပါတယ်။ Access Status: {access.status}။</div> : <>
        <div className="cloud-help"><strong>Optimized Owner Device Sync</strong><br />Device အသစ်တွင် Realtime Listener မှ ရရှိပြီးသား Server Snapshot ကို အသုံးပြုပြီး Safe Bootstrap လုပ်ပါမယ်။ တူညီတဲ့ Collection တွေကို Full Scan ထပ်မဖတ်ပါ။ Baseline ရှိပြီးသား Device မှာ Product / Category / Stock လို POS အရေးကြီး Data ကို Realtime ဆက်နားထောင်ပြီး Sales / Purchase / Activity History နဲ့ Customer / Supplier ပြောင်းလဲမှုတွေကို updatedAt Cursor အလိုက်သာ ဖတ်ပါမယ်။ Device နှစ်ခုလုံးမှာ Baseline ရှိပြီးသားဆိုရင် မပြောင်းလဲတဲ့ Record ကို ထပ်မရေးပါ။ ID တူ Data နှစ်ဖက်လုံး ပြောင်းထားရင် Conflict အဖြစ် ရပ်ပါမယ်။<br /><br />Customer / Supplier Profile ကို Shared ထားပြီး Purchase / Payment / Stock / Sales ကို Branch အလိုက် ခွဲထားပါတယ်။ Product ကို အခြား Device မှာ မမြင်ရလျှင် Device နှစ်ခုလုံး Branch တူမတူ စစ်ပါ။ Admin PIN နဲ့ Local Logo / Banner / Owner Photo ကို Cloud သို့ မတင်ပါ။ Cashier ရောင်းအားကို Sale + Product Stock + Stock Batch အဖြစ် Atomic Transaction တစ်ခုတည်းနဲ့ Cloud ထဲ သိမ်းပြီး Owner Device တွေက Sales Sync နဲ့ လက်ခံပါမယ်။ Offline ဖြစ်ချိန်မှာ Cashier Sale ကို Local Queue ထဲ ထိန်းထားပြီး ပြန်ချိတ်မိမှ ပို့ပါမယ်။ IndexedDB Cloud Cache သည် Sign Out လုပ်ရုံဖြင့် မရှင်းပါ။ မျှဝေသုံး Device များတွင် သတိထားပါ။</div>
        <div className="cloud-actions">
          <button className="button button-primary" disabled={!manifest} onClick={requestIncrementalSync}><ArrowLeftRight size={15} /> Sync Now (ပြောင်းလဲမှုများသာ)</button>
        </div>
        <small className="field-hint">{manifest ? `ဒီ Device မှာ Sync Baseline ရှိပါတယ်။ နောက်ဆုံး Baseline: ${new Date(manifest.savedAt).toLocaleString()}` : 'ဒီ Device မှာ Baseline မရှိသေးပါ။ Owner Auto Sync က Listener Server Snapshot ရရှိတာနဲ့ Backup-safe Bootstrap ကို အလိုအလျောက် စတင်ပါမယ်။ Backup JSON ကို အရင်သိမ်းထားပါ။'}</small>
        {lastSynced && <small className="field-hint">နောက်ဆုံး Manual Sync တောင်းဆိုမှု: {lastSynced}</small>}<OwnerAutoSyncStatus userUid={user.uid} />
        <div className="cloud-diagnostics-card">
          <div className="panel-heading"><div><h4>ဒီ Device ၏ Firestore Activity (နောက်ဆုံး 24 နာရီ)</h4><p>Firebase သို့ တကယ် Bill လုပ်သည့် Usage မဟုတ်ဘဲ App မှ မြင်ရသော Read/Write ခန့်မှန်းကိန်း ဖြစ်ပါတယ်။ ဒီကောင်တာကို ဒီ Browser LocalStorage ထဲမှာသာ သိမ်းပြီး Firebase ထဲ Telemetry မပို့ပါ။</p></div></div>
          <div className="cloud-diagnostics-grid">
            <div><small>Read Estimate</small><strong>{diagnostics.reads.toLocaleString()}</strong></div>
            <div><small>Write Estimate</small><strong>{diagnostics.writes.toLocaleString()}</strong></div>
            <div><small>Delete Estimate</small><strong>{diagnostics.deletes.toLocaleString()}</strong></div>
            <div><small>Listener Starts</small><strong>{diagnostics.listenerStarts.toLocaleString()}</strong></div>
          </div>
          {Object.entries(diagnostics.operations).sort((a, b) => b[1] - a[1]).slice(0, 5).length > 0 && <div className="cloud-diagnostics-breakdown"><strong>အများဆုံး လုပ်ဆောင်ချက်များ</strong>{Object.entries(diagnostics.operations).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([operation, count]) => <div key={operation}><span>{operation}</span><b>{count.toLocaleString()}</b></div>)}</div>}
          <div className="cloud-diagnostics-actions"><button className="button button-outline" type="button" onClick={() => setDiagnostics(readFirestoreDiagnostics(user.uid))}>ကောင်တာ ပြန်ဖတ်ရန်</button><button className="button button-outline" type="button" onClick={() => { if (window.confirm('ဒီ Device ၏ Local Usage ကောင်တာကိုသာ ရှင်းမလား။ Firebase Data မထိခိုက်ပါ။')) { clearFirestoreDiagnostics(user.uid); setDiagnostics(readFirestoreDiagnostics(user.uid)); } }}>Local ကောင်တာ ရှင်းရန်</button></div>
          <small className="field-hint">မှတ်ချက်: Query Listener မှာ Server Snapshot ရောက်လာတဲ့ Added/Modified Document များနှင့် Code မှ ခြေရာခံထားသော Transaction Read/Write များကို ခန့်မှန်းတွက်ထားပါတယ်။ Firebase Console → Firestore → Usage ကိုသာ Billable Usage အတည်ပြုချက်အဖြစ် သုံးပါ။ Local-only activity ကြောင့် Browser/Device တစ်ခုချင်းစီမှာ ကောင်တာ သီးခြားဖြစ်ပါတယ်။</small>
        </div>
      </>}
    </> : <>
      <div className="cloud-help"><strong>Login Session မရှိသေးပါ</strong><br />Website ကို Logout အခြေအနေဖြင့် ဖွင့်လိုက်ပါက သီးခြား Login Page ကို အရင်ပြသပါမယ်။ Login အောင်မြင်ပြီး Owner / Cashier Access အတည်ပြုပြီးမှ Workspace ကို ဖွင့်ပေးပါမယ်။ Login Form ကို Profile သို့မဟုတ် Main Menu ထဲမှာ မထားပါ။</div>
      <small className="field-hint">Cashier Account ကို Owner က Team Access မှာ Firebase UID အတိအကျနဲ့ Member ချိတ်ထားရပါမယ်။</small>
    </>}
    {message && <div className="cloud-help">{message}</div>}{error && <div className="cloud-error">{error}</div>}
  </div>;
}
