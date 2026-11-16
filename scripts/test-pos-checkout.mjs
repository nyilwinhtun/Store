import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, '.qa-build');

mkdirSync(outputDirectory, { recursive: true });
for (const entry of ['kpayReference', 'kpayAccount', 'posPaymentState', 'posProductSelection']) {
  await build({
    entryPoints: [resolve(root, `src/lib/${entry}.ts`)],
    outfile: resolve(outputDirectory, `${entry}.mjs`),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'warning',
  });
}

const result = spawnSync(process.execPath, ['--test', resolve(root, 'tests/pos-checkout.test.mjs'), resolve(root, 'tests/pos-product-payment.test.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
