import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, '.qa-build');

mkdirSync(outputDirectory, { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/lib/workerSaleClient.ts')],
  outfile: resolve(outputDirectory, 'workerSaleClient.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  logLevel: 'warning',
  define: {
    'import.meta.env': JSON.stringify({
      VITE_WORKER_SALES_ENABLED: 'false',
      VITE_WORKER_SALES_URL: '',
    }),
  },
});

const result = spawnSync(process.execPath, ['--test', resolve(root, 'tests/worker-sale-client.test.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
