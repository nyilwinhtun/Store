import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, '.qa-build');
mkdirSync(outputDirectory, { recursive: true });

const stubs = {
  'firebase/firestore': `
    export const doc = () => { throw new Error('fake firestore: doc is not used by queue tests'); };
    export const runTransaction = async () => { throw new Error('fake firestore: runTransaction is not used by queue tests'); };
  `,
  firebase: `
    export const firestore = {};
    export const firebaseConfig = { projectId: 'demo-minimart-offline' };
    export const FIREBASE_BUSINESS_ID = 'store-mini-main';
    export const firebaseAuth = { currentUser: null };
  `,
  firestoreDiagnostics: `
    export const recordFirestoreActivity = () => {};
  `,
  persistentStateStorage: `
    const store = () => (globalThis.__durableStore ??= new Map());
    export async function readDurableValue(key) {
      const values = store();
      return values.has(key) ? values.get(key) : null;
    }
    export async function writeDurableValue(key, value) {
      store().set(key, String(value));
      return 'indexeddb';
    }
    export async function removeDurableValue(key) {
      store().delete(key);
    }
  `,
  cashierUnitSaleSync: `
    export async function commitCashierUnitSaleToCloud(sale) {
      return globalThis.__commitFake(sale);
    }
  `,
};

await build({
  entryPoints: [resolve(root, 'src/lib/cashierSalesSync.ts')],
  outfile: resolve(outputDirectory, 'cashierSalesSync.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  logLevel: 'warning',
  define: { 'import.meta.env': '{"DEV":true,"PROD":false,"MODE":"emulator","VITE_WORKER_SALES_URL":"","VITE_WORKER_SALES_ENABLED":"false"}' },
  plugins: [{
    name: 'offline-queue-stubs',
    setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: stubs['firebase/firestore'], namespace: 'stub' }));
      builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: stubs.firebase, namespace: 'stub' }));
      builder.onResolve({ filter: /^\.\/firestoreDiagnostics$/ }, () => ({ path: stubs.firestoreDiagnostics, namespace: 'stub' }));
      builder.onResolve({ filter: /^\.\/persistentStateStorage$/ }, () => ({ path: stubs.persistentStateStorage, namespace: 'stub' }));
      builder.onResolve({ filter: /^\.\/cashierUnitSaleSync$/ }, () => ({ path: stubs.cashierUnitSaleSync, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: args.path, loader: 'js' }));
    },
  }],
});

const result = spawnSync(process.execPath, ['--test', resolve(root, 'tests/offline-reconciliation.test.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
