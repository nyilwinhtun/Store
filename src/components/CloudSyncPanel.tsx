import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { collection, doc, getDocFromServer, getDocsFromServer, runTransaction, writeBatch, type DocumentReference } from 'firebase/firestore';
import { ArrowLeftRight, Cloud, CloudDownload, CloudUpload, LogIn, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { firebaseAuth, firebaseConfigured, firestore, FIREBASE_BUSINESS_ID } from '../lib/firebase';
import { useBusinessAccess } from '../lib/businessAccess';
import { usePosStore, type Branch } from '../store/usePosStore';
import { OwnerAutoSyncStatus } from './OwnerAutoSyncStatus';

export type BranchRecordKind = 'categories' | 'products' | 'sales' | 'expenses' | 'heldItems' | 'customerPayments' | 'purchases' | 'supplierPayments' | 'purchaseReturns' | 'stockBatches' | 'stockReceipts' | 'stockTransfers' | 'cashShifts' | 'cashMovements' | 'activityLogs';
export type SharedRecordKind = 'customers' | 'suppliers';
export type SyncScope = 'branch' | 'branchRecord' | 'shared' | 'meta';
export type SyncKind = BranchRecordKind | SharedRecordKind | 'branches' | 'settings';
export type SyncItem = { key: string; scope: SyncScope; kind: SyncKind; id: string; branchId?: string; payload: unknown; deleted?: boolean };
export type ManifestEntry = { scope: SyncScope; kind: SyncKind; id: string; branchId?: string; hash: string };
export type SyncManifest = { version: 2; businessId: string; savedAt: string; records: Record<string, ManifestEntry> };
export type CloudRead = { items: Map<string, SyncItem>; unavailableSharedKinds: SharedRecordKind[] };

export const branchRecordKinds: BranchRecordKind[] = ['categories', 'products', 'sales', 'expenses', 'heldItems', 'customerPayments', 'purchases', 'supplierPayments', 'purchaseReturns', 'stockBatches', 'stockReceipts', 'stockTransfers', 'cashShifts', 'cashMovements', 'activityLogs'];
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
    categories: state.categories, products: state.products, sales: state.sales, expenses: state.expenses, heldItems: state.heldItems,
    customerPayments: state.customerPayments, purchases: state.purchases, supplierPayments: state.supplierPayments,
    purchaseReturns: state.purchaseReturns, stockBatches: state.stockBatches, stockReceipts: state.stockReceipts,
    stockTransfers: state.stockTransfers, cashShifts: state.cashShifts, cashMovements: state.cashMovements, activityLogs: state.activityLogs,
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
      const branchId = typeof requestedBranch === 'string' && validBranches.has(requestedBranch) ? requestedBranch : fallbackBranch;
      const payload = stripDeviceImages(kind === 'stockTransfers' ? record : { ...record, branchId });
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

// StrictMode can mount effects twice in development. Share one bootstrap promise
// per Owner UID so two initial reads do not race and overwrite one another.
const deviceBootstrapPromises = new Map<string, Promise<DeviceBootstrapResult>>();

/**
 * Safely initializes a new Owner device without requiring a manual first-sync click.
 * The merge is additive: Cloud-only records are pulled, Local-only records are
 * uploaded, and same-key/different-value records stop with a conflict.
 */
export function initializeOwnerDeviceSync(uid: string): Promise<DeviceBootstrapResult> {
  const existing = deviceBootstrapPromises.get(uid);
  if (existing) return existing;

  const task = (async (): Promise<DeviceBootstrapResult> => {
    const cloud = await readBusinessCloud(uid);
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

    // Import the union before persisting the baseline, so the local state and
    // manifest always describe the same merged dataset.
    importCloudItems(merged, { unavailableSharedKinds: cloud.unavailableSharedKinds });
    saveManifest(uid, manifestFromItems(merged));

    return {
      cloudRecords: cloud.items.size,
      localOnlyRecords: localOnly.length,
      mergedRecords: merged.size,
      unavailableSharedKinds: cloud.unavailableSharedKinds,
    };
  })();

  deviceBootstrapPromises.set(uid, task);
  task.then(
    () => { if (deviceBootstrapPromises.get(uid) === task) deviceBootstrapPromises.delete(uid); },
    () => { if (deviceBootstrapPromises.get(uid) === task) deviceBootstrapPromises.delete(uid); },
  );
  return task;
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
function parseCloudItem(id: string, data: Record<string, unknown>, scope: SyncScope, kind: SyncKind, branchId?: string): SyncItem {
  const actualScope = (data.scope as SyncScope) || scope;
  const actualKind = (data.kind as SyncKind) || kind;
  const actualBranch = typeof data.branchId === 'string' ? data.branchId : branchId;
  return { key: keyOf(actualScope, actualKind, id, actualBranch), scope: actualScope, kind: actualKind, id, branchId: actualBranch, payload: data.payload, deleted: data.deleted === true };
}

export async function readBusinessCloud(uid: string): Promise<CloudRead> {
  const business = await getDocFromServer(doc(firestore, 'businesses', FIREBASE_BUSINESS_ID));
  if (!business.exists()) throw new Error(`Business Document မတွေ့ပါ: businesses/${FIREBASE_BUSINESS_ID}`);
  const businessData = business.data();
  if (businessData.ownerUid !== uid) throw new Error('လက်ရှိ Firebase Account သည် ဒီ Business ၏ Owner မဟုတ်ပါ။');
  if (businessData.active === false) throw new Error('Business ကို ပိတ်ထားပါတယ်။');

  const items = new Map<string, SyncItem>();
  const branches = await getDocsFromServer(collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches'));
  const branchIds: string[] = [];
  branches.forEach((snapshot) => {
    branchIds.push(snapshot.id);
    const item = parseCloudItem(snapshot.id, snapshot.data() as Record<string, unknown>, 'branch', 'branches', snapshot.id);
    if (item.payload !== undefined || item.deleted) items.set(item.key, item);
  });

  const jobs = branchIds.flatMap((branchId) => branchRecordKinds.map((kind) => ({ branchId, kind, promise: getDocsFromServer(collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, kind)) })));
  const recordSnapshots = await Promise.all(jobs.map((job) => job.promise));
  recordSnapshots.forEach((snapshot, index) => {
    const { branchId, kind } = jobs[index];
    snapshot.forEach((record) => {
      const item = parseCloudItem(record.id, record.data() as Record<string, unknown>, 'branchRecord', kind, branchId);
      if (item.payload !== undefined || item.deleted) items.set(item.key, item);
    });
  });

  const unavailableSharedKinds: SharedRecordKind[] = [];
  const sharedResults = await Promise.all(sharedRecordKinds.map(async (kind) => {
    try {
      const snapshot = await getDocsFromServer(collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'shared', kind, 'records'));
      return { kind, snapshot };
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
      // Older Firebase Console Rules may still allow branch inventory but deny
      // the newer nested shared/{kind}/records path. Keep core POS sync usable.
      if (code === 'permission-denied') {
        unavailableSharedKinds.push(kind);
        return { kind, snapshot: null };
      }
      throw error;
    }
  }));
  sharedResults.forEach(({ kind, snapshot }) => {
    if (!snapshot) return;
    snapshot.forEach((record) => {
      const item = parseCloudItem(record.id, record.data() as Record<string, unknown>, 'shared', kind);
      if (item.payload !== undefined || item.deleted) items.set(item.key, item);
    });
  });

  const meta = await getDocFromServer(doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'meta', 'settings'));
  if (meta.exists()) {
    const item = parseCloudItem('settings', meta.data() as Record<string, unknown>, 'meta', 'settings');
    if (item.payload !== undefined || item.deleted) items.set(item.key, item);
  }
  return { items, unavailableSharedKinds };
}

export async function writeItems(items: SyncItem[], uid: string) {
  for (let offset = 0; offset < items.length; offset += 400) {
    const batch = writeBatch(firestore);
    for (const item of items.slice(offset, offset + 400)) batch.set(refFor(item), cloudDocument(item, uid), { merge: true });
    await batch.commit();
  }
}

/** Auto-sync write path: compare the live server value with the per-device baseline inside a transaction. */
export async function writeItemsIfBaselineUnchanged(items: SyncItem[], uid: string, baseline: SyncManifest) {
  for (let offset = 0; offset < items.length; offset += 400) {
    const chunk = items.slice(offset, offset + 400);
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
      for (const { item, index } of writes) transaction.set(refs[index], cloudDocument(item, uid), { merge: true });
    });
  }
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
    categories: [], products: [], sales: [], expenses: [], heldItems: [], customerPayments: [], purchases: [], supplierPayments: [], purchaseReturns: [], stockBatches: [], stockReceipts: [], stockTransfers: [], cashShifts: [], cashMovements: [], activityLogs: [],
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
    sales: grouped.sales as never[], expenses: grouped.expenses as never[], heldItems: grouped.heldItems as never[],
    customers: unavailableShared.has('customers') ? undefined : customers as never[], suppliers: unavailableShared.has('suppliers') ? undefined : suppliers as never[], customerPayments: grouped.customerPayments as never[],
    purchases: grouped.purchases as never[], supplierPayments: grouped.supplierPayments as never[], purchaseReturns: grouped.purchaseReturns as never[],
    stockBatches: grouped.stockBatches as never[], stockReceipts: grouped.stockReceipts as never[], stockTransfers: grouped.stockTransfers as never[],
    cashShifts: grouped.cashShifts as never[], cashMovements: grouped.cashMovements as never[], activityLogs: grouped.activityLogs as never[],
    ownerProfile: ownerProfile as never, settings: settings as never,
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'SyncConflictError') return `Sync Conflict ဖြစ်နေပါတယ်။ ${error.message}။ တစ်ဖက်ကို အစားမထိုးဘဲ ရပ်ထားပါတယ်။`;
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Email သို့မဟုတ် Password မှားနေပါတယ်။',
    'auth/network-request-failed': 'Internet connection မရပါ။',
    'permission-denied': 'Firestore Security Rules က Owner Account ကို ခွင့်မပြုပါ။ Rules ကို စစ်ဆေးပါ။',
    'unavailable': 'Firebase ချိတ်ဆက်မှု ယာယီမရနိုင်ပါ။',
    'deadline-exceeded': 'Firebase တုံ့ပြန်မှု ကြာနေပါတယ်။ Internet ကို စစ်ပြီး ပြန်စမ်းပါ။',
    'resource-exhausted': 'Firestore အသုံးပြုမှု Quota ပြည့်နေပါတယ်။ Usage ကို စစ်ဆေးပါ။',
  };
  return messages[code] || (error instanceof Error ? error.message : 'Cloud Sync မအောင်မြင်ပါ။');
}

export function CloudSyncPanel() {
  const access = useBusinessAccess();
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastSynced, setLastSynced] = useState('');

  useEffect(() => {
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, setUser);
  }, []);
  const isOwner = access.status === 'active' && access.role === 'owner' && !!user && user.uid === access.uid;
  const manifest = useMemo(() => user ? readManifest(user.uid) : null, [user, lastSynced]);

  const uploadInitial = async () => {
    if (!user || !isOwner) throw new Error('Business Owner Account ဖြင့် Login ဝင်ထားရန် လိုအပ်ပါတယ်။');
    const cloud = await readBusinessCloud(user.uid);
    const local = buildLocalItems(usePosStore.getState());
    if (!local.size) throw new Error('တင်ရန် Local Data မရှိပါ။');
    // Idempotent first upload: resume partial writes; never silently overwrite a different cloud record.
    const merged = new Map<string, SyncItem>(cloud.items);
    const push: SyncItem[] = [];
    const conflicts: string[] = [];
    const unavailableShared = new Set(cloud.unavailableSharedKinds);
    for (const [key, item] of local) {
      if (item.scope === 'shared' && unavailableShared.has(item.kind as SharedRecordKind)) continue;
      const remote = cloud.items.get(key);
      if (!remote) { push.push(item); merged.set(key, item); }
      else if (remote.deleted || (hashPayload(remote.payload) !== hashPayload(item.payload) && !isBootstrapEquivalent(item, remote))) conflicts.push(key);
      else merged.set(key, remote);
    }
    if (conflicts.length) {
      const examples = conflicts.slice(0, 4).map((key) => key.split('::').filter(Boolean).slice(-2).join(' / ')).join(', ');
      throw new Error(`Cloud မှာ မတူညီတဲ့ Record Conflict ${conflicts.length} ခု တွေ့ပါတယ်။ ဒီ Device အသစ်ဆိုရင် Cloud နှင့် ပေါင်းစည်းရန် ကို အရင်လုပ်ပါ။ ဥပမာ: ${examples}${conflicts.length > 4 ? ' …' : ''}`);
    }
    if (push.length) await writeItemsIfBaselineUnchanged(push, user.uid, { version: 2, businessId: FIREBASE_BUSINESS_ID, savedAt: new Date().toISOString(), records: {} });
    // The baseline must describe the data that is actually on this device.
    // Import cloud-only records before saving it; otherwise the next Auto Sync
    // can mistake those records for local deletions and upload tombstones.
    importCloudItems(merged, { unavailableSharedKinds: cloud.unavailableSharedKinds });
    saveManifest(user.uid, manifestFromItems(merged));
    setLastSynced(new Date().toLocaleString());
    setMessage(`Business Cloud Snapshot ပြီးပါပြီ။ ${push.length} records အသစ်တင်ပြီး Cloud ရှိပြီးသား ${cloud.items.size} records ကို ထိန်းထားပါတယ်.${cloud.unavailableSharedKinds.length ? ` Customer/Supplier (${cloud.unavailableSharedKinds.join(', ')}) Sync အတွက် Firestore Rules ပြင်ရန် လိုအပ်နေပါသေးတယ်။` : ''}`);
  };

  const downloadCloud = async () => {
    if (!user || !isOwner) throw new Error('Business Owner Account ဖြင့် Login ဝင်ထားရန် လိုအပ်ပါတယ်။');
    const result = await initializeOwnerDeviceSync(user.uid);
    setLastSynced(new Date().toLocaleString());
    setMessage(`Device Sync ပြီးပါပြီ။ Cloud မှ ${result.cloudRecords} records ကို ဖတ်ယူပြီး ဒီ Device မှာသာရှိတဲ့ ${result.localOnlyRecords} records ကို ထိန်းသိမ်းထားပါတယ်.${result.unavailableSharedKinds.length ? ` Customer/Supplier (${result.unavailableSharedKinds.join(', ')}) Sync အတွက် Firestore Rules ပြင်ရန် လိုအပ်ပါတယ်။` : ''}`);
  };

  const syncChanges = async () => {
    if (!user || !isOwner) throw new Error('Business Owner Account ဖြင့် Login ဝင်ထားရန် လိုအပ်ပါတယ်။');
    const baseline = readManifest(user.uid);
    if (!baseline) throw new Error('ဒီ Device မှာ Sync Baseline မရှိသေးပါ။ ပထမဆုံး Device ဆိုရင် Upload Initial Snapshot၊ Device အသစ်ဆိုရင် Cloud နှင့် ပေါင်းစည်းရန် ကို အရင်လုပ်ပါ။');
    const [cloud, local] = await Promise.all([readBusinessCloud(user.uid), Promise.resolve(buildLocalItems(usePosStore.getState()))]);
    const keys = new Set([...Object.keys(baseline.records), ...local.keys(), ...cloud.items.keys()]);
    const push: SyncItem[] = [];
    const merged = new Map<string, SyncItem>(local);
    const conflicts: string[] = [];

    const unavailableShared = new Set(cloud.unavailableSharedKinds);
    for (const key of keys) {
      const localItem = local.get(key);
      const remoteItem = cloud.items.get(key);
      const recordScope = localItem?.scope || remoteItem?.scope || baseline.records[key]?.scope;
      const recordKind = localItem?.kind || remoteItem?.kind || baseline.records[key]?.kind;
      if (recordScope === 'shared' && unavailableShared.has(recordKind as SharedRecordKind)) continue;
      const baseHash = baseline.records[key]?.hash;
      const localHash = localItem ? hashPayload(localItem.payload) : DELETED_HASH;
      const remoteHash = remoteItem ? (remoteItem.deleted ? DELETED_HASH : hashPayload(remoteItem.payload)) : MISSING_HASH;
      if (localHash === remoteHash) continue;

      if (baseHash === undefined) {
        if (remoteHash === MISSING_HASH && localItem) push.push(localItem);
        else if (!localItem && remoteItem && !remoteItem.deleted) merged.set(key, remoteItem);
        else if (localItem && remoteItem) conflicts.push(key);
        else if (remoteItem?.deleted) merged.delete(key);
        continue;
      }
      if (localHash === baseHash) {
        if (!remoteItem) conflicts.push(key);
        else if (remoteItem.deleted) merged.delete(key);
        else merged.set(key, remoteItem);
        continue;
      }
      if (remoteHash === baseHash) {
        if (localItem) push.push(localItem);
        else {
          const prior = baseline.records[key];
          push.push({ key, scope: prior.scope, kind: prior.kind, id: prior.id, branchId: prior.branchId, payload: null, deleted: true });
        }
        continue;
      }
      conflicts.push(key);
    }

    if (conflicts.length) {
      const examples = conflicts.slice(0, 4).map((key) => key.split('::').filter(Boolean).slice(-2).join(' / ')).join(', ');
      throw new Error(`Device နှစ်ခုမှာ တူညီတဲ့ Record ကို ပြင်ထားတဲ့ Conflict ${conflicts.length} ခု တွေ့ပါတယ်။ Data တစ်ဖက်ကို မရွေးချယ်ဘဲ Sync ရပ်ထားပါတယ်။ ဥပမာ: ${examples}${conflicts.length > 4 ? ' …' : ''}။ Backup ထုတ်ပြီး Cloud Download ဖြင့် အရင်ညှိပါ။`);
    }

    if (push.length) await writeItemsIfBaselineUnchanged(push, user.uid, baseline);
    importCloudItems(merged, { unavailableSharedKinds: cloud.unavailableSharedKinds });
    const nextManifest = manifestFromItems(merged);
    for (const key of Object.keys(nextManifest)) {
      const entry = nextManifest[key];
      if (entry.scope === 'shared' && unavailableShared.has(entry.kind as SharedRecordKind)) {
        if (baseline.records[key]) nextManifest[key] = baseline.records[key];
        else delete nextManifest[key];
      }
    }
    for (const [key, entry] of Object.entries(baseline.records)) {
      if (entry.scope === 'shared' && unavailableShared.has(entry.kind as SharedRecordKind)) nextManifest[key] = entry;
    }
    for (const item of push) if (item.deleted) nextManifest[item.key] = manifestEntry(item);
    for (const [key, item] of cloud.items) if (item.deleted && !nextManifest[key]) nextManifest[key] = manifestEntry(item);
    saveManifest(user.uid, nextManifest);
    setLastSynced(new Date().toLocaleString());
    setMessage(`Two-way Sync ပြီးပါပြီ။ Cloud သို့ ${push.length} updates တင်ပြီး Cloud မှ အသစ်/ပြောင်းလဲမှုများကို ပြန်ယူထားပါတယ်.${cloud.unavailableSharedKinds.length ? ` Customer/Supplier (${cloud.unavailableSharedKinds.join(', ')}) Sync ကို Firestore Rules မပြင်မချင်း ကျော်ထားပါတယ်။` : ''}`);
  };

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    window.dispatchEvent(new Event('minimart-cloud-manual-sync-started'));
    try { await action(); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); window.dispatchEvent(new Event('minimart-cloud-manual-sync-finished')); }
  };

  if (!firebaseConfigured || !firebaseAuth || !firestore) return <div className="panel cloud-panel"><div className="panel-heading"><div className="panel-icon"><Cloud size={18} /></div><div><h3>Business Cloud Sync</h3><p>Firebase Configuration မရရှိသေးပါ။</p></div></div></div>;

  return <div className="panel cloud-panel">
    <div className="panel-heading"><div className="panel-icon"><Cloud size={18} /></div><div><h3>Business Cloud Sync</h3><p>Branch အလိုက် Product / Stock / Sales နှင့် Shared Customer / Supplier ကို Owner Device များအကြား Sync လုပ်ပါ။</p></div><span className="tag tag-success">{access.status === 'active' ? 'Access Active' : access.status}</span></div>
    {user ? <>
      <div className="cloud-status"><ShieldCheck size={19} color="#0f766e" /><div><strong>{isOwner ? 'Business Owner Account ချိတ်ဆက်ထားသည်' : 'Owner Permission အတည်ပြုရန် လိုအပ်သည်'}</strong><small className="cloud-email">{user.email || user.uid} · {FIREBASE_BUSINESS_ID}</small></div><button className="button button-outline" onClick={() => void runAction(async () => { await signOut(firebaseAuth); setMessage('Sign Out လုပ်ပြီးပါပြီ။'); })} disabled={busy}><LogOut size={14} /> Sign Out</button></div>
      {!isOwner ? <div className="cloud-error">Business Cloud Sync ကို Owner Account သာ အသုံးပြုနိုင်ပါတယ်။ Access Status: {access.status}။ Cashier Auto Sync ကို နောက် Phase မှာ သီးခြားစီမံပါမယ်။</div> : <>
        <div className="cloud-help"><strong>Owner Device Auto Setup</strong><br />Owner Account ဖြင့် Device အသစ် Login ဝင်လျှင် Cloud နဲ့ ဒီ Device ရဲ့ Local Data ကို အလိုအလျောက် Safe Merge လုပ်ပြီး Sync Baseline တည်ဆောက်ပါမယ်။ Cloud-only records ကို ဒီ Device သို့ ရယူပြီး Device-only records ကို Cloud သို့ ထိန်းသိမ်းတင်ပါမယ်။ ID တူ Data မတူပါက တစ်ဖက်ကိုမှ အလိုအလျောက် မအစားထိုးဘဲ Conflict ပြပါမယ်။<br />Device နှစ်ခုလုံးမှာ Baseline ရှိပြီး Realtime Listener ချိတ်ဆက်ပြီးနောက် Product, Stock, Sales စသည့် Owner Data များကို Auto Sync လုပ်ပါမယ်။ <strong>Sync Changes</strong> ကို လိုအပ်သည့်အခါ ကိုယ်တိုင်လည်း နှိပ်နိုင်ပါတယ်။<br /><br />Customer / Supplier Profile ကို Shared ထားပြီး Purchase / Payment / Stock / Sales ကို Branch အလိုက် ခွဲထားပါတယ်။ Product ကို အခြား Device မှာ မမြင်ရလျှင် အပေါ်ဘက် Branch Selector မှာ Device နှစ်ခုလုံး Branch တူနေသလား စစ်ပါ။ Branch မတူပါက Product / Stock ကို ရည်ရွယ်ချက်ရှိရှိ သီးခြားပြထားပါတယ်။ Admin PIN နဲ့ Local Logo / Banner / Owner Photo ကို Cloud သို့ မတင်ပါ။ Cashier Auto Sync ကို ဒီ Phase မှာ မဖွင့်သေးပါ။ IndexedDB Cloud Cache သည် Sign Out လုပ်ရုံဖြင့် မရှင်းပါ။ Public / မျှဝေသုံး Device များတွင် မသုံးပါနှင့်။</div>
        <div className="cloud-actions">
          <button className="button button-primary" disabled={busy} onClick={() => { if (window.confirm('ဒီ Device ရဲ့ Local POS Data ကို Business Cloud Snapshot အဖြစ် တင်မလား။ Cloud မှာ ရှိပြီးသား Data နဲ့ ID တူပြီး အကြောင်းအရာမတူလျှင် Upload ကို ရပ်ပါမယ်။ အရင် JSON Backup ထုတ်ထားပါ။')) void runAction(uploadInitial); }}><CloudUpload size={15} /> Upload Initial Snapshot</button>
          <button className="button button-outline" disabled={busy} onClick={() => { if (window.confirm('Cloud Data နဲ့ ဒီ Device မှာသာရှိတဲ့ Record တွေကို ပေါင်းစည်းမလား။ ID တူ Data မတူပါက မည်သည့်ဘက်ကိုမှ အစားမထိုးဘဲ ရပ်ပါမယ်။ အရင် JSON Backup ထုတ်ထားပါ။')) void runAction(downloadCloud); }}><CloudDownload size={15} /> Cloud နှင့် ပေါင်းစည်းရန်</button>
          <button className="button button-outline" disabled={busy || !manifest} onClick={() => { if (window.confirm('ဒီ Device နဲ့ Business Cloud ကြားက ပြောင်းလဲမှုတွေကို နှိုင်းယှဉ်ပြီး Sync လုပ်မလား။ တစ်ပြိုင်နက်ပြင်ထားတဲ့ Record တွေရှိရင် Sync ကို ရပ်ပါမယ်။')) void runAction(syncChanges); }}><ArrowLeftRight size={15} /> Sync Changes</button>
          {busy && <span className="subtle-count"><RefreshCw size={13} className="spin-icon" /> Sync လုပ်နေသည်...</span>}
        </div>
        <small className="field-hint">{manifest ? `ဒီ Device မှာ Sync Baseline ရှိပါတယ်။ နောက်ဆုံး Baseline: ${new Date(manifest.savedAt).toLocaleString()}` : 'ဒီ Device မှာ Sync Baseline မရှိသေးပါ။ ပထမဆုံး Upload သို့မဟုတ် Download လုပ်ပါ။'}</small>
        {lastSynced && <small className="field-hint">ဒီ Session ၏ နောက်ဆုံး Manual Sync: {lastSynced}</small>}<OwnerAutoSyncStatus userUid={user.uid} />
      </>}
    </> : <>
      <div className="form-grid cloud-form"><label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="owner@example.com" /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" /></label></div>
      <div className="cloud-actions"><button className="button button-primary" disabled={busy || !email.trim() || !password} onClick={() => void runAction(async () => { await signInWithEmailAndPassword(firebaseAuth, email.trim(), password); setPassword(''); setMessage('Firebase Login အောင်မြင်ပါပြီ။ Owner Access အတည်ပြုပြီးမှ Cloud Sync လုပ်နိုင်ပါမယ်။'); })}><LogIn size={15} /> Sign In</button></div>
      <small className="field-hint">Account အသစ်ဖန်တီးခြင်းကို ဒီနေရာမှာ မဖွင့်ထားပါ။ Owner Account ကို Firebase Authentication မှာ ကြိုတင်ဖန်တီးထားရပါမယ်။</small>
    </>}
    {message && <div className="cloud-help">{message}</div>}{error && <div className="cloud-error">{error}</div>}
  </div>;
}
