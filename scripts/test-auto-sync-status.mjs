import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, '.qa-build');

mkdirSync(outputDirectory, { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/lib/autoSyncStatus.ts')],
  outdir: outputDirectory,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});

const result = spawnSync(process.execPath, ['--test', resolve(root, 'tests/auto-sync-status.test.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
