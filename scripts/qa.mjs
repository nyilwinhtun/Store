import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipRules = process.argv.includes('--skip-rules');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor !== 24) {
  console.error(`\n✖ Firebase CLI ကို stable Node.js 24 နဲ့သာ မောင်းရပါမယ်။ လက်ရှိ: ${process.versions.node}`);
  console.error('Node 24 ကို ရွေးပြီး `npm run qa` ပြန်လုပ်ပါ။ Node 25/27 ကဲ့သို့ version များကို မသုံးပါနှင့်။');
  process.exit(1);
}

function portInUse(port) {
  return new Promise((resolveResult) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => resolveResult(error.code === 'EADDRINUSE' ? port : 0));
    server.once('listening', () => server.close(() => resolveResult(0)));
    server.listen(port, '127.0.0.1');
  });
}

async function assertPortsFree(label, ports) {
  const busy = [];
  for (const port of ports) {
    const used = await portInUse(port);
    if (used) busy.push(used);
  }
  if (!busy.length) return;
  console.error(`\n✖ ${label}: Emulator port ${busy.join(', ')} ကို အခြား Process က သုံးနေပါတယ်။`);
  console.error('ရှိနေသော Emulator / Process ကို ပိတ်ပြီး `lsof -nP -iTCP:<port> -sTCP:LISTEN` နဲ့ စစ်ဆေးပါ။');
  console.error('မရှင်းလင်းဘဲ ဆက်မလုပ်ပါနှင့်။ မတူညီသော Emulator နှစ်ခု တပြိုင်နက် မောင်းမိလျှင် ရလဒ် မမှန်နိုင်ပါ။');
  process.exit(1);
}

function javaMajorVersion() {
  const result = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = output.match(/version\s+\"?(\d+)/i) || output.match(/openjdk\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function run(label, command, args) {
  return new Promise((resolveResult) => {
    console.log(`\n▶ ${label}`);
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', (error) => {
      console.error(`✖ ${label}: ${error.message}`);
      resolveResult(false);
    });
    child.on('exit', (code) => {
      const ok = code === 0;
      console.log(`${ok ? '✓' : '✖'} ${label}${ok ? '' : ` (exit ${code ?? 'unknown'})`}`);
      resolveResult(ok);
    });
  });
}

const steps = [
  ['Security source preflight', npm, ['run', 'check:security']],
  ['Staging preparation preflight', npm, ['run', 'check:staging']],
  ['Sync safety unit tests', npm, ['run', 'test:sync']],
  ['Auto-sync status namespace tests', npm, ['run', 'test:autosync']],
  ['Cashier cash outbox unit tests', npm, ['run', 'test:cash']],
  ['KPay QR validation unit tests', npm, ['run', 'test:qr']],
  ['Cashier incremental cursor unit tests', npm, ['run', 'test:cursor']],
  ['Branch overview aggregation tests', npm, ['run', 'test:overview']],
  ['Firebase runtime target tests', npm, ['run', 'test:runtime']],
  ['Customer statement tests', npm, ['run', 'test:statement']],
  ['POS checkout tests', npm, ['run', 'test:checkout']],
  ['POS store inventory and receipt tests', npm, ['run', 'test:store']],
  ['Individual unit barcode tracking tests', npm, ['run', 'test:units']],
  ['Branch transfer unit-tracking guard tests', npm, ['run', 'test:transfer']],
  ['Firestore emulator binary', npm, ['run', 'setup:emulators']],
  ['Worker POC transaction tests', npm, ['--prefix', 'experiments/cloudflare-workers-spark-poc', 'test'], [8101]],
  ['Free-only Firestore backup export/restore tests', npm, ['run', 'test:backup'], [8099, 4400, 4500, 9150]],
  ['Worker sale client tests', npm, ['run', 'test:worker-client']],
  ['Offline queue and reconciliation tests', npm, ['run', 'test:offline']],
  ['Website TypeScript check', npm, ['run', 'typecheck']],
  ['Firebase Functions build', npm, ['--prefix', 'functions', 'run', 'build']],
];

if (!skipRules) {
  const javaMajor = javaMajorVersion();
  if (javaMajor === null || javaMajor < 21) {
    console.error(`\n✖ Firestore Emulator test အတွက် Java JDK 21+ လိုအပ်ပါတယ်။ တွေ့ရှိမှု: ${javaMajor ?? 'Java မတွေ့ပါ'}`);
    console.error('Java 21+ တပ်ဆင်ပြီး `npm run qa` ပြန်လုပ်ပါ၊ သို့မဟုတ် Emulator မပါဘဲ စစ်ရန် `npm run qa:quick` သုံးပါ။');
    process.exit(1);
  }
  steps.push(['Firestore Rules emulator tests', npm, ['run', 'test:rules'], [8099, 4400, 4500, 9150]]);
  steps.push(['Cloud Functions server tests (unit sale + sale adjustments)', npm, ['run', 'test:server'], [9099, 8099, 5001, 4400, 4500, 9150]]);
}

steps.push(['Production website build', npm, ['run', 'build']]);
steps.push(['Bundle size report', npm, ['run', 'report:bundle']]);

for (const [label, command, args, ports] of steps) {
  if (ports) await assertPortsFree(label, ports);
  const ok = await run(label, command, args);
  if (!ok) {
    console.error(`\nQA ရပ်လိုက်ပါပြီ။ အပေါ်က ${label} ကို အရင်ပြင်ပါ။`);
    process.exit(1);
  }
}
console.log(`\n✓ QA ${skipRules ? '(quick)' : '(full)'} အောင်မြင်ပါပြီ။`);
