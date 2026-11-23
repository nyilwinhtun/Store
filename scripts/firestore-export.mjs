import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import {
  assertTargetAllowed,
  encodeDocumentPath,
  fetchAccessToken,
  firestoreFetch,
  resolveFirestoreTarget,
} from './firestoreRestClient.mjs';

const MAX_DEPTH = 32;

function parseArgs(argv) {
  const options = { pageSize: 300, allowProduction: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };
    if (arg === '--project') options.project = next();
    else if (arg === '--out') options.out = next();
    else if (arg === '--page-size') options.pageSize = Number(next());
    else if (arg === '--service-account') options.serviceAccount = next();
    else if (arg === '--emulator-host') options.emulatorHost = next();
    else if (arg === '--allow-production') options.allowProduction = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/firestore-export.mjs --project <id> --out <dir> [options]

Options:
  --page-size <n>          Documents per page (default 300)
  --service-account <path> Service account JSON for a real project
  --emulator-host <host>   Emulator host, e.g. 127.0.0.1:8099
  --allow-production       Required for minimart-production (Owner authorization)

The export is a JSON snapshot, not a managed Firebase backup.`);
}

function documentRelativePath(name) {
  const marker = '/documents/';
  const index = name.indexOf(marker);
  if (index < 0) throw new Error('Unexpected Firestore document name in export.');
  return name.slice(index + marker.length);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (!options.project) throw new Error('--project is required.');
  if (!options.out) throw new Error('--out is required.');
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 1000) {
    throw new Error('--page-size must be an integer between 1 and 1000.');
  }

  const target = resolveFirestoreTarget(options.project, { emulatorHost: options.emulatorHost });
  assertTargetAllowed(options.project, {
    allowProduction: options.allowProduction,
    serviceAccount: options.serviceAccount,
    mode: target.mode,
  });

  const outDir = path.resolve(options.out);
  const documentsPath = path.join(outDir, 'documents.ndjson');
  if (existsSync(documentsPath)) throw new Error(`Export already exists: ${documentsPath}`);
  mkdirSync(outDir, { recursive: true });

  const token = target.mode === 'project' ? await fetchAccessToken(options.serviceAccount) : 'owner';
  const startedAt = new Date().toISOString();
  const stream = createWriteStream(documentsPath, { encoding: 'utf8' });
  const sha256 = createHash('sha256');
  const warnings = [];
  const rootCollections = {};
  let documentCount = 0;
  let collectionCount = 0;

  async function writeRecord(record) {
    const line = `${JSON.stringify(record)}\n`;
    sha256.update(line);
    if (!stream.write(line)) await once(stream, 'drain');
  }

  async function listCollectionIds(parentPath) {
    const ids = [];
    let pageToken;
    do {
      const suffix = parentPath ? `/${encodeDocumentPath(parentPath)}` : '';
      const body = await firestoreFetch(target.baseUrl, `${suffix}:listCollectionIds`, token, {
        method: 'POST',
        body: JSON.stringify({ pageSize: 300, ...(pageToken ? { pageToken } : {}) }),
      });
      ids.push(...(body.collectionIds || []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return ids;
  }

  async function listDocuments(collectionPath) {
    const documents = [];
    let pageToken;
    do {
      const query = new URLSearchParams({ pageSize: String(options.pageSize) });
      if (pageToken) query.set('pageToken', pageToken);
      const body = await firestoreFetch(
        target.baseUrl,
        `/${encodeDocumentPath(collectionPath)}?${query.toString()}`,
        token,
      );
      documents.push(...(body.documents || []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return documents;
  }

  const queue = [{ collectionPath: '', depth: 0 }];
  while (queue.length) {
    const { collectionPath, depth } = queue.shift();
    if (depth > MAX_DEPTH) {
      warnings.push(`Depth limit reached below ${collectionPath || '(root)'}; deeper collections were skipped.`);
      continue;
    }
    const parentPath = collectionPath;
    let collectionIds;
    try {
      collectionIds = await listCollectionIds(parentPath);
    } catch (error) {
      if (parentPath && /HTTP 404/.test(error.message)) {
        warnings.push(`Document disappeared while walking subcollections: ${parentPath}`);
        continue;
      }
      throw error;
    }
    for (const collectionId of collectionIds.sort()) {
      const currentPath = collectionPath ? `${collectionPath}/${collectionId}` : collectionId;
      collectionCount += 1;
      const root = currentPath.split('/')[0];
      rootCollections[root] = rootCollections[root] || 0;
      const documents = await listDocuments(currentPath);
      for (const document of documents) {
        const relativePath = documentRelativePath(document.name);
        await writeRecord({
          path: relativePath,
          name: document.name,
          fields: document.fields || {},
          createTime: document.createTime || null,
          updateTime: document.updateTime || null,
        });
        documentCount += 1;
        rootCollections[root] += 1;
        queue.push({ collectionPath: relativePath, depth: depth + 1 });
      }
    }
  }

  stream.end();
  await once(stream, 'close');

  const manifest = {
    format: 'minimart-firestore-export/1',
    createdAt: startedAt,
    completedAt: new Date().toISOString(),
    sourceProject: options.project,
    mode: target.mode,
    pageSize: options.pageSize,
    collectionCount,
    documentCount,
    rootCollections: Object.fromEntries(Object.entries(rootCollections).sort(([a], [b]) => a.localeCompare(b))),
    sha256: sha256.digest('hex'),
    warnings,
    limitations: [
      'JSON snapshot only; not a managed Firebase backup.',
      'Firestore document createTime/updateTime are recorded but not restored.',
      'Security Rules, indexes, Auth users and Storage objects are not included.',
      'Concurrent writes during export can make root counts inconsistent with later reads.',
    ],
  };
  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Export mode: ${manifest.mode}`);
  console.log(`Documents: ${documentCount} across ${collectionCount} collections`);
  console.log(`SHA-256: ${manifest.sha256}`);
  if (warnings.length) console.log(`Warnings: ${warnings.length}`);
  console.log(`Saved to: ${outDir}`);
}

main().catch((error) => {
  console.error(`Export failed: ${error.message}`);
  process.exitCode = 1;
});
