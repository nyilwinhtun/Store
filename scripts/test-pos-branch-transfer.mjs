import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, '.qa-build');

mkdirSync(outputDirectory, { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/store/usePosStore.ts')],
  outfile: resolve(outputDirectory, 'usePosStore.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  logLevel: 'warning',
  define: { 'import.meta.env': '{"DEV":true,"PROD":false,"MODE":"emulator"}' },
});
await build({
  entryPoints: [resolve(root, 'src/lib/unitTracking.ts')],
  outfile: resolve(outputDirectory, 'unitTracking.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  logLevel: 'warning',
});

const result = spawnSync(process.execPath, ['--test', resolve(root, 'tests/pos-branch-transfer.test.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TZ: 'Asia/Yangon' },
});
process.exit(result.status ?? 1);
