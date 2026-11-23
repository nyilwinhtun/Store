import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, '.qa-build');
const fakeFirestore = resolve(root, 'tests/support/fakeFirestore.mjs');
const devEmulatorEnv = '{"DEV":true,"PROD":false,"MODE":"emulator"}';

/**
 * Declarative registry for unit test suites that bundle TypeScript modules
 * into `.qa-build/` via esbuild and execute `node --test`.
 */
const SUITES = {
  sync: {
    builds: [
      { entry: 'src/lib/syncSafety.ts', outfile: 'syncSafety.mjs' },
      { entry: 'src/lib/syncManifestStorage.ts', outfile: 'syncManifestStorage.mjs' },
      { entry: 'src/lib/activityLogPolicy.ts', outfile: 'activityLogPolicy.mjs' },
    ],
    tests: ['tests/sync-safety.test.mjs'],
  },
  autosync: {
    builds: [{ entry: 'src/lib/autoSyncStatus.ts', outfile: 'autoSyncStatus.mjs' }],
    tests: ['tests/auto-sync-status.test.mjs'],
  },
  cash: {
    builds: [
      { entry: 'src/lib/cashierCashRecords.ts', outfile: 'cashierCashRecords.mjs' },
      {
        entry: 'src/lib/cashierCashApply.ts',
        outfile: 'cashierCashApply.mjs',
        alias: { 'firebase/firestore': fakeFirestore },
      },
    ],
    tests: ['tests/cashier-cash-records.test.mjs', 'tests/cashier-cash-apply.test.mjs'],
  },
  qr: {
    builds: [{ entry: 'src/lib/kpayQr.ts', outfile: 'kpayQr.mjs' }],
    tests: ['tests/kpay-qr.test.mjs'],
  },
  cursor: {
    builds: [{ entry: 'src/lib/cashierSyncCursor.ts', outfile: 'cashierSyncCursor.mjs' }],
    tests: ['tests/cashier-sync-cursor.test.mjs'],
  },
  overview: {
    builds: [{ entry: 'src/lib/branchOverview.ts', outfile: 'branchOverview.mjs', target: 'node20' }],
    tests: ['tests/branch-overview.test.mjs'],
  },
  runtime: {
    builds: [{ entry: 'src/lib/firebaseRuntime.ts', outfile: 'firebaseRuntime.mjs', target: 'node20' }],
    tests: ['tests/firebase-runtime.test.mjs'],
  },
  statement: {
    builds: [{ entry: 'src/lib/customerStatement.ts', outfile: 'customerStatement.mjs', target: 'node20' }],
    tests: ['tests/customer-statement.test.mjs'],
  },
  checkout: {
    builds: [
      { entry: 'src/lib/kpayReference.ts', outfile: 'kpayReference.mjs' },
      { entry: 'src/lib/kpayAccount.ts', outfile: 'kpayAccount.mjs' },
      { entry: 'src/lib/posPaymentState.ts', outfile: 'posPaymentState.mjs' },
      { entry: 'src/lib/posProductSelection.ts', outfile: 'posProductSelection.mjs' },
    ],
    tests: ['tests/pos-checkout.test.mjs', 'tests/pos-product-payment.test.mjs'],
  },
  store: {
    builds: [
      {
        entry: 'src/store/usePosStore.ts',
        outfile: 'usePosStore.mjs',
        define: { 'import.meta.env': devEmulatorEnv },
      },
      { entry: 'src/lib/receiptNumber.ts', outfile: 'receiptNumber.mjs' },
    ],
    tests: ['tests/pos-store-inventory.test.mjs'],
    env: { TZ: 'Asia/Yangon' },
  },
  units: {
    builds: [
      {
        entry: 'src/store/usePosStore.ts',
        outfile: 'usePosStore.mjs',
        define: { 'import.meta.env': devEmulatorEnv },
      },
      { entry: 'src/lib/unitTracking.ts', outfile: 'unitTracking.mjs' },
      { entry: 'src/lib/cashierUnitRegistryMerge.ts', outfile: 'cashierUnitRegistryMerge.mjs' },
    ],
    tests: ['tests/pos-unit-tracking.test.mjs'],
    env: { TZ: 'Asia/Yangon' },
  },
  transfer: {
    builds: [
      {
        entry: 'src/store/usePosStore.ts',
        outfile: 'usePosStore.mjs',
        define: { 'import.meta.env': devEmulatorEnv },
      },
      { entry: 'src/lib/unitTracking.ts', outfile: 'unitTracking.mjs' },
    ],
    tests: ['tests/pos-branch-transfer.test.mjs'],
    env: { TZ: 'Asia/Yangon' },
  },
  'worker-client': {
    builds: [
      {
        entry: 'src/lib/workerSaleClient.ts',
        outfile: 'workerSaleClient.mjs',
        define: {
          'import.meta.env': JSON.stringify({
            VITE_WORKER_SALES_ENABLED: 'false',
            VITE_WORKER_SALES_URL: '',
          }),
        },
      },
    ],
    tests: ['tests/worker-sale-client.test.mjs'],
  },
};

async function runSuite(suiteName) {
  const suite = SUITES[suiteName];
  if (!suite) {
    console.error(`Unknown test suite "${suiteName}". Available suites: ${Object.keys(SUITES).join(', ')}`);
    return 1;
  }

  mkdirSync(outputDirectory, { recursive: true });

  for (const spec of suite.builds) {
    await build({
      entryPoints: [resolve(root, spec.entry)],
      outfile: resolve(outputDirectory, spec.outfile),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: spec.target ?? 'node18',
      logLevel: 'warning',
      ...(spec.define ? { define: spec.define } : {}),
      ...(spec.alias ? { alias: spec.alias } : {}),
    });
  }

  const result = spawnSync(
    process.execPath,
    ['--test', ...suite.tests.map((testPath) => resolve(root, testPath))],
    {
      cwd: root,
      stdio: 'inherit',
      env: suite.env ? { ...process.env, ...suite.env } : process.env,
    },
  );
  return result.status ?? 1;
}

const requested = process.argv.slice(2);
const targets = requested.length === 0 || requested.includes('all') ? Object.keys(SUITES) : requested;

for (const name of targets) {
  const status = await runSuite(name);
  if (status !== 0) process.exit(status);
}
