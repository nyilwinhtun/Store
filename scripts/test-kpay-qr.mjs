import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, '.qa-build');

mkdirSync(outputDirectory, { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/lib/kpayQr.ts')],
  outfile: resolve(outputDirectory, 'kpayQr.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  logLevel: 'warning',
});

const result = spawnSync(process.execPath, ['--test', resolve(root, 'tests/kpay-qr.test.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
