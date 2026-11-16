import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, '.qa-build');

mkdirSync(outputDirectory, { recursive: true });
const entries = {
  'syncSafety.mjs': 'src/lib/syncSafety.ts',
  'syncManifestStorage.mjs': 'src/lib/syncManifestStorage.ts',
  'activityLogPolicy.mjs': 'src/lib/activityLogPolicy.ts',
};
await build({
  entryPoints: Object.values(entries).map((relative) => resolve(root, relative)),
  outdir: outputDirectory,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});

const result = spawnSync(process.execPath, ['--test', resolve(root, 'tests/sync-safety.test.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
