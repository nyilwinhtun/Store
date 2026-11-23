import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('.qa-build', { recursive: true });

buildSync({
  entryPoints: ['src/lib/branchOverview.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: '.qa-build/branchOverview.mjs',
  logLevel: 'warning',
});

const result = spawnSync('node', ['--test', 'tests/branch-overview.test.mjs'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
