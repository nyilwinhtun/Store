import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = process.env.GCLOUD_PROJECT || 'demo-minimart-backup';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const base = emulatorHost ? `http://${emulatorHost}/v1/projects/${project}/databases/(default)/documents` : '';

function runScript(script, args) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    encoding: 'utf8',
    env: process.env,
  });
}

async function commit(writes) {
  const response = await fetch(`${base}:commit`, {
    method: 'POST',
    // The Firestore emulator treats "Bearer owner" as the Admin SDK bypass.
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ writes }),
  });
  assert.equal(response.status, 200, await response.text());
}

async function readDocument(docPath) {
  const response = await fetch(`${base}/${docPath}`, { headers: { authorization: 'Bearer owner' } });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}

async function clearEmulator() {
  const response = await fetch(`http://${emulatorHost}/emulator/v1/projects/${project}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  assert.ok(response.ok || response.status === 404, `clear failed: HTTP ${response.status}`);
}

function documentName(docPath) {
  return `projects/${project}/databases/(default)/documents/${docPath}`;
}

test('Firestore JSON export and restore round-trip on the emulator', async () => {
  assert.ok(emulatorHost, 'FIRESTORE_EMULATOR_HOST is required; run through firebase emulators:exec.');
  const outDir = mkdtempSync(path.join(tmpdir(), 'minimart-backup-export-'));
  try {
    await clearEmulator();
    const writes = [{
      update: {
        name: documentName('backupSmoke/s1'),
        fields: {
          title: { stringValue: 'sale-1' },
          quantity: { integerValue: '1' },
          at: { timestampValue: '2026-01-02T03:04:05Z' },
          meta: { mapValue: { fields: { tag: { stringValue: 'nested-value' } } } },
        },
      },
    }];
    for (let index = 2; index <= 5; index += 1) {
      writes.push({
        update: {
          name: documentName(`backupSmoke/s${index}`),
          fields: {
            title: { stringValue: `sale-${index}` },
            quantity: { integerValue: String(index) },
          },
        },
      });
    }
    writes.push({
      update: {
        name: documentName('backupSmoke/s1/children/c1'),
        fields: { title: { stringValue: 'child-one' } },
      },
    });
    writes.push({
      update: {
        name: documentName('backupSmoke/s1/children/c2'),
        fields: { title: { stringValue: 'child-two' } },
      },
    });
    writes.push({
      update: {
        name: documentName('backupOther/o1'),
        fields: { title: { stringValue: 'other' } },
      },
    });
    await commit(writes);

    const exportRun = runScript('scripts/firestore-export.mjs', [
      '--project', project, '--out', outDir, '--page-size', '2',
    ]);
    assert.equal(exportRun.status, 0, exportRun.stderr);
    assert.match(exportRun.stdout, /Documents: 8 across 3 collections/);

    const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.format, 'minimart-firestore-export/1');
    assert.equal(manifest.mode, 'emulator');
    assert.equal(manifest.pageSize, 2);
    assert.equal(manifest.documentCount, 8);
    assert.equal(manifest.collectionCount, 3);
    assert.deepEqual(manifest.rootCollections, { backupOther: 1, backupSmoke: 7 });
    assert.ok(manifest.limitations.some((item) => /not a managed Firebase backup/.test(item)));

    const ndjson = readFileSync(path.join(outDir, 'documents.ndjson'), 'utf8');
    const hash = createHash('sha256').update(ndjson).digest('hex');
    assert.equal(manifest.sha256, hash);
    assert.match(ndjson, /backupSmoke\/s1\/children\/c1/);
    assert.match(ndjson, /timestampValue/);
    assert.doesNotMatch(`${ndjson}${JSON.stringify(manifest)}`, /private_key|access_token|Bearer /);

    await clearEmulator();
    const missing = await fetch(`${base}/backupSmoke/s1`, { headers: { authorization: 'Bearer owner' } });
    assert.equal(missing.status, 404);

    const restoreRun = runScript('scripts/firestore-restore.mjs', [
      '--project', project, '--in', outDir, '--batch-size', '3',
    ]);
    assert.equal(restoreRun.status, 0, restoreRun.stderr);
    assert.match(restoreRun.stdout, /Documents restored: 8/);
    assert.match(restoreRun.stdout, /Integrity verified: yes/);

    const restored = await readDocument('backupSmoke/s1');
    assert.equal(restored.fields.title.stringValue, 'sale-1');
    assert.equal(restored.fields.quantity.integerValue, '1');
    assert.equal(restored.fields.at.timestampValue, '2026-01-02T03:04:05Z');
    assert.equal(restored.fields.meta.mapValue.fields.tag.stringValue, 'nested-value');

    const child = await readDocument('backupSmoke/s1/children/c2');
    assert.equal(child.fields.title.stringValue, 'child-two');

    const other = await readDocument('backupOther/o1');
    assert.equal(other.fields.title.stringValue, 'other');
  } finally {
    await clearEmulator().catch(() => undefined);
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('Production targets are refused without explicit authorization', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'minimart-backup-guard-'));
  try {
    const exportRun = runScript('scripts/firestore-export.mjs', [
      '--project', 'minimart-production', '--out', path.join(outDir, 'export'),
    ]);
    assert.notEqual(exportRun.status, 0);
    assert.match(exportRun.stderr, /allow-production|Owner authorization/);
    assert.doesNotMatch(exportRun.stderr, /service_account|private_key/);

    writeFileSync(path.join(outDir, 'documents.ndjson'), '');
    const restoreRun = runScript('scripts/firestore-restore.mjs', [
      '--project', 'minimart-production', '--in', outDir,
    ]);
    assert.notEqual(restoreRun.status, 0);
    assert.match(restoreRun.stderr, /allow-production|Owner authorization/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
