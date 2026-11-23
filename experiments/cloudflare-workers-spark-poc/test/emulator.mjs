import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ID = 'demo-minimart-spark-poc';
export const PORT = Number(process.env.POC_EMULATOR_PORT || 8101);
export const HOST = `127.0.0.1:${PORT}`;
export const DOCUMENTS_BASE = `http://${HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const here = path.dirname(fileURLToPath(import.meta.url));
const JAR = path.join(os.homedir(), '.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar');

async function waitForStartup(timeoutMs = 40000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://${HOST}/`);
      if (response.status > 0) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Firestore emulator did not start in time.');
}

export async function startEmulator() {
  if (!existsSync(JAR)) throw new Error(`Firestore emulator jar not found at ${JAR}`);
  const child = spawn('java', [
    '-Duser.language=en', '-Duser.country=US', '-jar', JAR,
    '--host', '127.0.0.1', '--port', String(PORT),
    '--rules', path.join(here, 'emulator.rules'),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  child.on('exit', (code) => {
    if (code && code !== 0) process.stderr.write(`emulator exited ${code}\n${logs.join('')}\n`);
  });
  await waitForStartup();
  return {
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    },
    logs,
  };
}

export async function clearDatabase() {
  const response = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Failed to clear emulator: HTTP ${response.status}`);
}
