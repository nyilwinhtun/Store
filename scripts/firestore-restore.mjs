import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import {
  assertTargetAllowed,
  fetchAccessToken,
  firestoreFetch,
  resolveFirestoreTarget,
} from './firestoreRestClient.mjs';

function parseArgs(argv) {
  const options = { batchSize: 400, allowProduction: false, skipIntegrity: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };
    if (arg === '--project') options.project = next();
    else if (arg === '--in') options.input = next();
    else if (arg === '--batch-size') options.batchSize = Number(next());
    else if (arg === '--service-account') options.serviceAccount = next();
    else if (arg === '--emulator-host') options.emulatorHost = next();
    else if (arg === '--allow-production') options.allowProduction = true;
    else if (arg === '--skip-integrity') options.skipIntegrity = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/firestore-restore.mjs --project <id> --in <dir> [options]

Options:
  --batch-size <n>         Writes per commit (default 400, max 500)
  --service-account <path> Service account JSON for a real project
  --emulator-host <host>   Emulator host, e.g. 127.0.0.1:8099
  --allow-production       Required for minimart-production (Owner authorization)
  --skip-integrity         Do not verify the manifest SHA-256`);
}

async function verifyIntegrity(documentsPath, manifest) {
  if (!manifest?.sha256) return false;
  const hash = createHash('sha256');
  const reader = createInterface({ input: createReadStream(documentsPath), crlfDelay: Infinity });
  for await (const line of reader) hash.update(`${line}\n`);
  if (hash.digest('hex') !== manifest.sha256) {
    throw new Error('Export integrity check failed: documents.ndjson SHA-256 does not match manifest.json.');
  }
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (!options.project) throw new Error('--project is required.');
  if (!options.input) throw new Error('--in is required.');
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 500) {
    throw new Error('--batch-size must be an integer between 1 and 500.');
  }

  const inputDir = path.resolve(options.input);
  const documentsPath = path.join(inputDir, 'documents.ndjson');
  if (!existsSync(documentsPath)) throw new Error(`Missing export file: ${documentsPath}`);
  const manifestPath = path.join(inputDir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;

  const target = resolveFirestoreTarget(options.project, { emulatorHost: options.emulatorHost });
  assertTargetAllowed(options.project, {
    allowProduction: options.allowProduction,
    serviceAccount: options.serviceAccount,
    mode: target.mode,
  });

  let integrityVerified = false;
  if (!options.skipIntegrity) integrityVerified = await verifyIntegrity(documentsPath, manifest);

  const token = target.mode === 'project' ? await fetchAccessToken(options.serviceAccount) : 'owner';
  const sourceProject = manifest?.sourceProject || options.project;
  const sourcePrefix = `projects/${sourceProject}/databases/(default)/documents/`;
  const targetPrefix = `projects/${options.project}/databases/(default)/documents/`;

  const reader = createInterface({ input: createReadStream(documentsPath), crlfDelay: Infinity });
  let batch = [];
  let restored = 0;
  let skipped = 0;

  async function flush() {
    if (!batch.length) return;
    await firestoreFetch(target.baseUrl, ':commit', token, {
      method: 'POST',
      body: JSON.stringify({ writes: batch }),
    });
    restored += batch.length;
    batch = [];
  }

  for await (const line of reader) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (!record.path && !record.name) {
      skipped += 1;
      continue;
    }
    const name = record.name && record.name.startsWith(sourcePrefix)
      ? `${targetPrefix}${record.name.slice(sourcePrefix.length)}`
      : `${targetPrefix}${record.path}`;
    batch.push({ update: { name, fields: record.fields || {} } });
    if (batch.length >= options.batchSize) await flush();
  }
  await flush();

  console.log(`Restore mode: ${target.mode}`);
  console.log(`Documents restored: ${restored}${skipped ? `, skipped: ${skipped}` : ''}`);
  console.log(`Integrity verified: ${integrityVerified ? 'yes' : 'no'}`);
  console.log('Note: createTime/updateTime are assigned by Firestore, not restored.');
}

main().catch((error) => {
  console.error(`Restore failed: ${error.message}`);
  process.exitCode = 1;
});
