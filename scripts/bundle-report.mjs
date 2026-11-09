import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const manifestPath = join(dist, '.vite', 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('Bundle manifest မတွေ့ပါ။ အရင် `npm run build` လုပ်ပါ။');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const jsFiles = new Set();
for (const entry of Object.values(manifest)) {
  if (entry.file?.endsWith('.js')) jsFiles.add(entry.file);
  for (const file of entry.dynamicImports || []) {
    const dynamicEntry = manifest[file];
    if (dynamicEntry?.file?.endsWith('.js')) jsFiles.add(dynamicEntry.file);
  }
}
// Include every generated JS chunk once, whether referenced directly or through nested dynamic imports.
for (const entry of Object.values(manifest)) if (entry.file?.endsWith('.js')) jsFiles.add(entry.file);

const rows = [...jsFiles].map((file) => {
  const path = join(dist, file);
  const data = readFileSync(path);
  return {
    file,
    bytes: statSync(path).size,
    gzip: gzipSync(data).length,
    brotli: brotliCompressSync(data).length,
    entry: Object.values(manifest).some((item) => item.isEntry && item.file === file),
  };
}).sort((a, b) => b.bytes - a.bytes);

const format = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
console.log('\nMinimart POS JavaScript bundle report');
console.log('-------------------------------------');
for (const row of rows) {
  console.log(`${row.entry ? '[ENTRY] ' : '[LAZY]  '}${format(row.bytes).padStart(10)} | gzip ${format(row.gzip).padStart(9)} | br ${format(row.brotli).padStart(9)} | ${row.file}`);
}
const total = rows.reduce((sum, row) => sum + row.bytes, 0);
const entry = rows.filter((row) => row.entry).reduce((sum, row) => sum + row.bytes, 0);
console.log('-------------------------------------');
console.log(`Entry JS total: ${format(entry)}`);
console.log(`All JS chunks:  ${format(total)}`);
console.log('Note: Lazy chunks download when their page/feature is first opened. The PWA caches them after first use.');
