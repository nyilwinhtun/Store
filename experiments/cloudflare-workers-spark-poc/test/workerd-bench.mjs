import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEmulator, clearDatabase, HOST as FIRESTORE_HOST } from './emulator.mjs';
import * as H from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPort = Number(process.env.POC_WORKER_PORT || 8787);
const jwksPort = Number(process.env.POC_JWKS_PORT || 8102);
const workerBase = `http://127.0.0.1:${workerPort}`;
const jwksUrl = `http://127.0.0.1:${jwksPort}/jwks`;
const configPath = path.join(os.tmpdir(), `minimart-workerd-${process.pid}.toml`);
const resultsPath = path.join(here, 'workerd-results.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FIVE = ['P1', 'P2', 'P4', 'P5', 'P6'];
const TEN = ['P1', 'P2', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11'];
// 20 lines without P3: its sticker units are single-use, so repeats would fail.
const TWENTY = ['P1', 'P2', ...Array.from({ length: 18 }, (_, index) => `P${index + 4}`)];

function processTimeSeconds(pid) {
  try {
    const text = execFileSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const match = /^(\d+):(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) return 0;
    return Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`);
  } catch {
    return 0;
  }
}

function processRssKb(pid) {
  try {
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) || 0;
  } catch {
    return 0;
  }
}

function findWorkerd(pid) {
  let entries = [];
  try {
    entries = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter(Boolean)
      .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }));
  } catch {
    return [pid];
  }
  const byParent = new Map();
  for (const entry of entries) {
    const list = byParent.get(entry.ppid) || [];
    list.push(entry);
    byParent.set(entry.ppid, list);
  }
  const found = [];
  const queue = [pid];
  while (queue.length) {
    const current = queue.shift();
    for (const child of byParent.get(current) || []) {
      if (/workerd-darwin|bin\/workerd|workerd serve/.test(child.command)) found.push(child.pid);
      queue.push(child.pid);
    }
  }
  return found.length ? found : [pid];
}

function processDetail(pid) {
  try {
    const text = execFileSync('ps', ['-o', 'pid=,time=,rss=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const match = /^(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/.exec(text);
    return match ? { pid: Number(match[1]), cpu: match[2], rssKb: Number(match[3]), command: match[4] } : null;
  } catch {
    return null;
  }
}

async function waitForWorker(timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${workerBase}/api/unknown`);
      if (response.status > 0) return;
    } catch {
      // still starting
    }
    await sleep(250);
  }
  throw new Error('Wrangler/workerd did not become ready.');
}

function saleFor(id, productIds) {
  return H.buildSale({ id, items: productIds.map((productId) => H.line(productId)) });
}

async function post(pathname, body, token) {
  const startedAt = performance.now();
  const response = await fetch(`${workerBase}${pathname}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return {
    status: response.status,
    body: parsed,
    wallMs: performance.now() - startedAt,
    requestBytes: Buffer.byteLength(JSON.stringify(body)),
    firestoreRequests: Number(response.headers.get('x-poc-requests') || 0),
    reads: Number(response.headers.get('x-poc-reads') || 0),
    writes: Number(response.headers.get('x-poc-writes') || 0),
    firestoreBytesIn: Number(response.headers.get('x-poc-bytes-in') || 0),
    firestoreBytesOut: Number(response.headers.get('x-poc-bytes-out') || 0),
    attempts: Number(response.headers.get('x-poc-attempts') || 0),
  };
}

function cpuSeconds(pids) {
  return pids.reduce((total, pid) => total + processTimeSeconds(pid), 0);
}

async function measureBatch(pids, run) {
  const cpuBefore = cpuSeconds(pids);
  const wallBefore = performance.now();
  const responses = await run();
  return {
    responses,
    wallMs: performance.now() - wallBefore,
    cpuMs: (cpuSeconds(pids) - cpuBefore) * 1000,
  };
}

async function main() {
  const emulator = await startEmulator();
  const { privateKey, publicJwk } = await H.generateSigningKeys();
  const token = await H.signToken(privateKey, H.tokenPayload('cashier-a'));
  const jwks = createServer((request, response) => {
    if (request.url !== '/jwks') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise((resolve) => jwks.listen(jwksPort, '127.0.0.1', resolve));

  writeFileSync(configPath, `name = "minimart-workerd-bench"
main = "${path.join(here, '../src/index.js')}"
compatibility_date = "2026-11-15"
workers_dev = false

[vars]
FIREBASE_PROJECT_ID = "demo-minimart-spark-poc"
BUSINESS_ID = "store-mini-main"
CHECK_TOKEN_REVOCATION = "false"
POC_DEBUG = "true"
FIRESTORE_EMULATOR_HOST = "${FIRESTORE_HOST}"
FIREBASE_JWKS_URL = "${jwksUrl}"
`);

  const logs = [];
  const wrangler = spawn('npx', ['wrangler', 'dev', '--local', '--config', configPath, '--ip', '127.0.0.1', '--port', String(workerPort)], {
    cwd: path.join(here, '..'),
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  wrangler.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  wrangler.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  const results = { runtime: 'local workerd via wrangler dev', measuredAt: new Date().toISOString(), cases: {} };
  try {
    await waitForWorker();
    const workerdPids = findWorkerd(wrangler.pid);
    results.workerdPids = workerdPids;
    results.pidResolved = !workerdPids.includes(wrangler.pid);
    results.processesAtStart = workerdPids.map(processDetail);

    await clearDatabase();
    await H.seedAll();
    const allowanceBody = {
      branchId: H.BRANCH_A,
      deviceId: 'workerd-bench-device',
      items: [{
        productId: 'P1',
        quantity: 1,
        batchAllocations: [{ batchId: 'B1', quantity: 1 }],
      }],
    };

    // Warm the JWKS cache and the isolate so CPU measurements exclude startup.
    const warm = await post('/api/sales/commit', { branchId: H.BRANCH_A, sale: saleFor('WORKERD-WARM', ['P1']) }, token);
    results.cases.warmup = { status: warm.status, result: warm.body?.result, wallMs: warm.wallMs, requests: warm.firestoreRequests };

    for (const [label, products, count] of [
      ['line1', ['P1'], 50],
      ['line5', FIVE, 20],
      ['line10', TEN, 10],
      ['line20', TWENTY, 5],
    ]) {
      await clearDatabase();
      await H.seedAll();
      const responses = [];
      const batch = await measureBatch(workerdPids, async () => {
        for (let index = 0; index < count; index += 1) {
          responses.push(await post('/api/sales/commit', {
            branchId: H.BRANCH_A,
            sale: saleFor(`WORKERD-${label.toUpperCase()}-${index}`, products),
          }, token));
        }
        return responses;
      });
      const ok = responses.filter((response) => response.status === 200);
      if (ok.length !== responses.length) {
        throw new Error(`${label} failed: ${JSON.stringify(responses.map((response) => ({ status: response.status, body: response.body })))}`);
      }
      const maxRequests = Math.max(...responses.map((response) => response.firestoreRequests));
      const maxReads = Math.max(...responses.map((response) => response.reads));
      const maxWrites = Math.max(...responses.map((response) => response.writes));
      const maxRequestBytes = Math.max(...responses.map((response) => response.requestBytes));
      const maxFirestoreBytesOut = Math.max(...responses.map((response) => response.firestoreBytesOut));
      results.cases[label] = {
        requests: responses.length,
        wallMsPerRequest: Math.round((batch.wallMs / responses.length) * 100) / 100,
        cpuMsPerRequest: Math.round((batch.cpuMs / responses.length) * 1000) / 1000,
        maxFirestoreRequests: maxRequests,
        maxDocumentReads: maxReads,
        maxWrites,
        maxRequestBytes,
        maxFirestoreBytesOut,
        result: ok[0]?.body?.result,
      };
    }

    await clearDatabase();
    await H.seedAll();
    const issue = await measureBatch(workerdPids, async () => [await post('/api/offline-allowances', allowanceBody, token)]);
    const issued = issue.responses[0];
    if (issued.status !== 200) throw new Error(`allowance issuance failed: ${JSON.stringify(issued.body)}`);
    const offlineSale = saleFor('WORKERD-OFFLINE', ['P1']);
    const commit = await measureBatch(workerdPids, async () => [await post('/api/sales/commit', {
      branchId: H.BRANCH_A,
      sale: offlineSale,
      allowanceId: issued.body.allowanceId,
      allowanceToken: issued.body.allowanceToken,
      leaseId: issued.body.leaseId,
      deviceId: issued.body.deviceId,
    }, token)]);
    const offline = commit.responses[0];
    if (offline.status !== 200) throw new Error(`offline commit failed: ${JSON.stringify(offline.body)}`);
    results.cases.allowanceIssuance = {
      wallMs: Math.round(issue.wallMs * 100) / 100,
      cpuMs: Math.round(issue.cpuMs * 1000) / 1000,
      maxFirestoreRequests: issued.firestoreRequests,
      reads: issued.reads,
      writes: issued.writes,
      requestBytes: issued.requestBytes,
      firestoreBytesOut: issued.firestoreBytesOut,
      result: issued.body?.result,
    };
    results.cases.offlineCommit = {
      wallMs: Math.round(commit.wallMs * 100) / 100,
      cpuMs: Math.round(commit.cpuMs * 1000) / 1000,
      maxFirestoreRequests: offline.firestoreRequests,
      reads: offline.reads,
      writes: offline.writes,
      requestBytes: offline.requestBytes,
      firestoreBytesOut: offline.firestoreBytesOut,
      result: offline.body?.result,
    };

    const contentionRounds = [];
    for (let round = 1; round <= 3; round += 1) {
      await clearDatabase();
      await H.seedAll();
      const contentionStart = performance.now();
      const contention = await Promise.all([
        post('/api/sales/commit', { branchId: H.BRANCH_A, sale: H.buildSale({ id: `WORKERD-RACE-${round}-A`, items: [H.line('P2', { quantity: 40 })] }) }, token),
        post('/api/sales/commit', { branchId: H.BRANCH_A, sale: H.buildSale({ id: `WORKERD-RACE-${round}-B`, items: [H.line('P2', { quantity: 40 })] }) }, token),
      ]);
      contentionRounds.push({
        round,
        wallMs: Math.round((performance.now() - contentionStart) * 100) / 100,
        statuses: contention.map((response) => response.status).sort(),
        attempts: contention.map((response) => response.attempts),
        maxFirestoreRequests: Math.max(...contention.map((response) => response.firestoreRequests)),
        results: contention.map((response) => response.body?.result || response.body?.code),
      });
    }
    const allContention = contentionRounds.flatMap((round) => round.attempts);
    results.cases.contention = {
      rounds: contentionRounds,
      maxAttempts: Math.max(...allContention),
      retriedRounds: contentionRounds.filter((round) => round.attempts.some((attempts) => attempts > 1)).length,
      maxFirestoreRequests: Math.max(...contentionRounds.map((round) => round.maxFirestoreRequests)),
      maxWallMs: Math.max(...contentionRounds.map((round) => round.wallMs)),
      outcomes: contentionRounds.map((round) => ({ statuses: round.statuses, results: round.results })),
    };

    results.processesAtEnd = workerdPids.map(processDetail);
    results.rssKb = workerdPids.reduce((total, pid) => total + processRssKb(pid), 0);
    const measured = Object.values(results.cases).filter((entry) => typeof entry.cpuMsPerRequest === 'number');
    const peakCpu = Math.max(...measured.map((entry) => entry.cpuMsPerRequest));
    const peakRequests = Math.max(...Object.values(results.cases).map((entry) => entry.maxFirestoreRequests ?? 0));
    results.freePlanAssessment = {
      note: 'Local workerd only, not Cloudflare metering. CPU is the OS-reported workerd process CPU delta divided by requests; it includes local server overhead and has ~10 ms sampling granularity.',
      cpuLimitMsPerInvocation: 10,
      peakLocalCpuMsPerRequest: peakCpu,
      cpuHeadroomMs: Math.round((10 - peakCpu) * 1000) / 1000,
      subrequestLimit: 50,
      peakFirestoreRequestsPerRequest: peakRequests,
      subrequestHeadroom: 50 - peakRequests,
    };
    results.logTail = logs.join('').split('\n').slice(-8).join('\n');
    writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error('--- wrangler log tail ---');
    console.error(logs.join('').split('\n').slice(-80).join('\n'));
    throw error;
  } finally {
    wrangler.kill('SIGTERM');
    await sleep(500);
    if (wrangler.exitCode === null) wrangler.kill('SIGKILL');
    await new Promise((resolve) => jwks.close(resolve));
    await emulator.stop();
    rmSync(configPath, { force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
