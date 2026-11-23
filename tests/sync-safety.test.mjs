import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size; },
};
let lastEvent = null;
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};
globalThis.dispatchEvent = (event) => { lastEvent = event; return true; };

const {
  announceLocalDataReplacement,
  clearFullRefreshPending,
  isFullRefreshPending,
  isLocalDataResetPending,
  isManifestSupersededByReset,
  LOCAL_DATA_RESET_EVENT,
  markFullRefreshPending,
  markLocalDataReplacement,
  markLocalDataResetHandled,
  readLocalDataReplacement,
} = await import('../.qa-build/syncSafety.mjs');

const manifestStorage = await import('../.qa-build/syncManifestStorage.mjs');
const activityLogPolicy = await import('../.qa-build/activityLogPolicy.mjs');

beforeEach(() => {
  store.clear();
  lastEvent = null;
});

test('no marker means no pending replacement and no manifest supersession', () => {
  assert.equal(readLocalDataReplacement(), null);
  assert.equal(isLocalDataResetPending(), false);
  assert.equal(isManifestSupersededByReset(new Date(0).toISOString()), false);
});

test('marking a replacement is pending until the sync engine handles that exact marker', () => {
  const marker = markLocalDataReplacement('local-reset');
  assert.equal(marker.reason, 'local-reset');
  assert.ok(Date.parse(marker.at));
  assert.equal(readLocalDataReplacement()?.id, marker.id);
  assert.equal(isLocalDataResetPending(), true);

  markLocalDataResetHandled('some-other-marker');
  assert.equal(isLocalDataResetPending(), true);

  markLocalDataResetHandled(marker.id);
  assert.equal(isLocalDataResetPending(), false);
});

test('announcing a replacement dispatches the reset event with the marker detail', () => {
  const marker = markLocalDataReplacement('backup-restore');
  announceLocalDataReplacement(marker);
  assert.equal(lastEvent?.type, LOCAL_DATA_RESET_EVENT);
  assert.equal(lastEvent?.detail?.id, marker.id);
});

test('manifests saved before the replacement are superseded', () => {
  const marker = markLocalDataReplacement('local-reset');
  const markerTime = Date.parse(marker.at);
  assert.equal(isManifestSupersededByReset(new Date(markerTime - 1000).toISOString()), true);
  assert.equal(isManifestSupersededByReset(new Date(markerTime + 1000).toISOString()), false);
  assert.equal(isManifestSupersededByReset('not-a-date'), true);
});

test('a new replacement clears the previously handled marker and full-refresh flag', () => {
  const first = markLocalDataReplacement('local-reset');
  markLocalDataResetHandled(first.id);
  markFullRefreshPending();
  assert.equal(isFullRefreshPending(), true);

  const second = markLocalDataReplacement('backup-restore');
  assert.notEqual(second.id, first.id);
  assert.equal(isLocalDataResetPending(), true);
  assert.equal(isFullRefreshPending(), false);
});

test('full refresh flag can be set and cleared independently', () => {
  assert.equal(isFullRefreshPending(), false);
  markFullRefreshPending();
  assert.equal(isFullRefreshPending(), true);
  clearFullRefreshPending();
  assert.equal(isFullRefreshPending(), false);
});

test('malformed stored markers are ignored instead of blocking sync forever', () => {
  store.set('minimart-local-data-replacement-v1', '{"id":"broken"');
  assert.equal(readLocalDataReplacement(), null);
  assert.equal(isLocalDataResetPending(), false);
  store.set('minimart-local-data-replacement-v1', JSON.stringify({ id: 'x', at: 'nope' }));
  assert.equal(readLocalDataReplacement(), null);
});

// ---------------------------------------------------------------------------
// V3.2.6 durable sync manifest
// ---------------------------------------------------------------------------

const BUSINESS = 'store-mini-main';
const UID = 'owner-uid-1';
const manifestEntry = (id) => ({ scope: 'branchRecord', kind: 'products', id, branchId: 'branch-a', hash: 'deadbeef' });
const manifestJson = (records = { 'branchRecord::branch-a::products::p1': manifestEntry('p1') }) => JSON.stringify({
  version: 2, businessId: BUSINESS, savedAt: new Date().toISOString(), records,
});

beforeEach(() => {
  store.clear();
  lastEvent = null;
  manifestStorage.resetManifestCacheForTests();
});

test('manifest parser rejects malformed, wrong-business and stale-shaped baselines', () => {
  assert.equal(manifestStorage.parseManifest('not json', BUSINESS), null);
  assert.equal(manifestStorage.parseManifest(JSON.stringify({ version: 1, businessId: BUSINESS, savedAt: new Date().toISOString(), records: {} }), BUSINESS), null);
  assert.equal(manifestStorage.parseManifest(manifestJson(), 'other-business'), null);
  const badEntry = manifestStorage.parseManifest(manifestJson({ k: { scope: 'branchRecord', kind: 'products', id: '', hash: 'x' } }), BUSINESS);
  assert.equal(badEntry, null);
  assert.ok(manifestStorage.parseManifest(manifestJson(), BUSINESS));
});

test('a legacy LocalStorage manifest is still readable before migration completes', () => {
  store.set(manifestStorage.legacyManifestStorageKey(UID, BUSINESS), manifestJson());
  const manifest = manifestStorage.readManifest(UID, BUSINESS);
  assert.ok(manifest);
  assert.equal(Object.keys(manifest.records).length, 1);
});

test('saveManifest persists records and readManifest returns them after a cache reset', async () => {
  const saved = await manifestStorage.saveManifest(UID, BUSINESS, { 'branchRecord::branch-a::products::p1': manifestEntry('p1') });
  assert.equal(saved, true);
  assert.equal(manifestStorage.readManifest(UID, BUSINESS)?.records['branchRecord::branch-a::products::p1']?.hash, 'deadbeef');
  manifestStorage.resetManifestCacheForTests();
  const preloaded = await manifestStorage.preloadManifest(UID, BUSINESS);
  assert.equal(preloaded?.records['branchRecord::branch-a::products::p1']?.hash, 'deadbeef');
});

test('saving a manifest removes the migrated legacy copy', async () => {
  store.set(manifestStorage.legacyManifestStorageKey(UID, BUSINESS), manifestJson());
  await manifestStorage.preloadManifest(UID, BUSINESS);
  store.set(manifestStorage.legacyManifestStorageKey(UID, BUSINESS), manifestJson());
  await manifestStorage.saveManifest(UID, BUSINESS, { 'branchRecord::branch-a::products::p1': manifestEntry('p1') });
  assert.equal(store.has(manifestStorage.legacyManifestStorageKey(UID, BUSINESS)), false);
});

test('a malformed legacy manifest never becomes a sync baseline', async () => {
  store.set(manifestStorage.legacyManifestStorageKey(UID, BUSINESS), '{"version":2');
  assert.equal(manifestStorage.readManifest(UID, BUSINESS), null);
  assert.equal(await manifestStorage.preloadManifest(UID, BUSINESS), null);
});

// ---------------------------------------------------------------------------
// V3.2.6 activity log retention policy
// ---------------------------------------------------------------------------

const log = (id, at) => ({ id, at, actor: 'owner', action: 'TEST', entity: 'Test', description: id, branchId: 'branch-a' });

test('activity log window is clamped to the 90-day retention cutoff', () => {
  const now = new Date('2026-11-13T00:00:00.000Z');
  const cutoff = activityLogPolicy.activityLogCutoffIso(now);
  assert.equal(cutoff, '2026-08-15T00:00:00.000Z');
  assert.equal(activityLogPolicy.activityLogWindowStart(null, now), cutoff);
  assert.equal(activityLogPolicy.activityLogWindowStart('old-cursor', now), cutoff);
  // A recent cursor keeps its 120-second overlap.
  assert.equal(activityLogPolicy.activityLogWindowStart('2026-11-12T00:00:00.000Z', now), '2026-11-11T23:58:00.000Z');
  // A cursor older than the cutoff can never widen the query past retention.
  assert.equal(activityLogPolicy.activityLogWindowStart('2026-01-01T00:00:00.000Z', now), cutoff);
});

test('mergeActivityLogs keeps unsynced local entries, dedupes ids and stays newest-first', () => {
  const local = [log('a', '2026-11-01T00:00:00.000Z'), log('b', '2026-11-03T00:00:00.000Z')];
  const incoming = [log('b', '2026-11-03T00:00:00.000Z'), log('c', '2026-11-02T00:00:00.000Z')];
  const merged = activityLogPolicy.mergeActivityLogs(local, incoming);
  assert.deepEqual(merged.map((entry) => entry.id), ['b', 'c', 'a']);
  assert.equal(activityLogPolicy.mergeActivityLogs(local, incoming, 2).length, 2);
});

test('mergeActivityLogs never deletes local history when the cloud window is empty', () => {
  const local = [log('a', '2026-11-01T00:00:00.000Z')];
  assert.deepEqual(activityLogPolicy.mergeActivityLogs(local, []).map((entry) => entry.id), ['a']);
});

test('trimActivityLogs caps the local device copy at the newest entries', () => {
  const logs = [log('old', '2026-01-01T00:00:00.000Z'), log('new', '2026-11-01T00:00:00.000Z')];
  assert.deepEqual(activityLogPolicy.trimActivityLogs(logs, 1).map((entry) => entry.id), ['new']);
  assert.equal(activityLogPolicy.trimActivityLogs(logs, 5).length, 2);
});
