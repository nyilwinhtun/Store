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
globalThis.window = {
  ...globalThis.window,
  dispatchEvent: (event) => { lastEvent = event; return true; },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const {
  activeAutoSyncBusinessId,
  autoSyncStatusKey,
  publishAutoSyncStatus,
  readAutoSyncStatus,
  UNRESOLVED_AUTO_SYNC_NAMESPACE,
} = await import('../../.qa-build/autoSyncStatus.mjs');

const PRODUCTION = 'store-mini-main';
const STAGING = 'store-staging-main';
const UID = 'cashier-uid-1';

beforeEach(() => {
  store.clear();
  lastEvent = null;
});

test('staging resolves status keys inside the staging business namespace', () => {
  assert.equal(autoSyncStatusKey(UID, STAGING), `minimart-auto-sync-status:${STAGING}:${UID}`);
  assert.ok(!autoSyncStatusKey(UID, STAGING).includes(PRODUCTION));
});

test('production keeps its existing business namespace and key format', () => {
  assert.equal(autoSyncStatusKey(UID, PRODUCTION), `minimart-auto-sync-status:${PRODUCTION}:${UID}`);
});

test('switching business contexts never shares status', () => {
  publishAutoSyncStatus(UID, { state: 'synced', message: 'staging synced', savedAt: '2026-11-16T00:00:00.000Z' }, STAGING);
  assert.equal(readAutoSyncStatus(UID, STAGING).message, 'staging synced');
  assert.equal(readAutoSyncStatus(UID, PRODUCTION).state, 'idle');
  assert.equal(readAutoSyncStatus(UID, PRODUCTION).message, 'Sync Baseline မရှိသေးပါ။ Initial Snapshot လုပ်ပါ။');

  publishAutoSyncStatus(UID, { state: 'offline', message: 'production offline' }, PRODUCTION);
  assert.equal(readAutoSyncStatus(UID, PRODUCTION).message, 'production offline');
  assert.equal(readAutoSyncStatus(UID, STAGING).message, 'staging synced');
});

test('a missing business id fails safely without touching production or staging keys', () => {
  assert.equal(autoSyncStatusKey(UID, ''), `minimart-auto-sync-status:${UNRESOLVED_AUTO_SYNC_NAMESPACE}:${UID}`);
  assert.equal(autoSyncStatusKey(UID, '   '), `minimart-auto-sync-status:${UNRESOLVED_AUTO_SYNC_NAMESPACE}:${UID}`);
  assert.ok(!autoSyncStatusKey(UID, '').includes(PRODUCTION));
  assert.ok(!autoSyncStatusKey(UID, '').includes(STAGING));

  publishAutoSyncStatus(UID, { state: 'synced', message: 'must not persist' }, '');
  assert.equal(store.size, 0, 'no status may be written without a resolved business id');
  assert.equal(readAutoSyncStatus(UID, '').state, 'idle');
  assert.equal(store.size, 0, 'reading without a business id must not create a key');
});

test('existing auto-sync status round-trips and still announces changes', () => {
  const status = { state: 'conflict', message: 'conflict found', savedAt: '2026-11-16T01:02:03.000Z', conflictCount: 2, conflictKeys: ['sales', 'stockBatches'] };
  publishAutoSyncStatus(UID, status, STAGING);
  assert.deepEqual(readAutoSyncStatus(UID, STAGING), status);
  assert.equal(lastEvent?.type, 'minimart-auto-sync-status-changed');
  assert.equal(lastEvent?.detail?.uid, UID);
  assert.deepEqual(lastEvent?.detail?.status, status);
});

test('the default namespace comes from the resolved runtime business context', () => {
  const runtimeBusinessId = activeAutoSyncBusinessId();
  assert.ok(runtimeBusinessId.length > 0, 'the resolved runtime must provide a business id');
  assert.equal(autoSyncStatusKey(UID), autoSyncStatusKey(UID, runtimeBusinessId));
  publishAutoSyncStatus(UID, { state: 'idle', message: 'runtime context' });
  assert.equal(readAutoSyncStatus(UID).message, 'runtime context');
});
