import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, '.qa-build');
const fakeFirestore = resolve(root, 'tests/support/fakeFirestore.mjs');

mkdirSync(outputDirectory, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/lib/cashierCashRecords.ts')],
  outfile: resolve(outputDirectory, 'cashierCashRecords.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  logLevel: 'warning',
});

// The apply module is bundled against an in-memory Firestore double so the
// transaction logic can be tested without emulator transaction support.
await build({
  entryPoints: [resolve(root, 'src/lib/cashierCashApply.ts')],
  outfile: resolve(outputDirectory, 'cashierCashApply.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  alias: { 'firebase/firestore': fakeFirestore },
  logLevel: 'warning',
});

const result = spawnSync(process.execPath, [
  '--test',
  resolve(root, 'tests/cashier-cash-records.test.mjs'),
  resolve(root, 'tests/cashier-cash-apply.test.mjs'),
], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
