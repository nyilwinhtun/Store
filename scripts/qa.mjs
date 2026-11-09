import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipRules = process.argv.includes('--skip-rules');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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
  steps.push(['Firestore Rules emulator tests', npm, ['run', 'test:rules']]);
}

steps.push(['Production website build', npm, ['run', 'build']]);
steps.push(['Bundle size report', npm, ['run', 'report:bundle']]);

for (const [label, command, args] of steps) {
  const ok = await run(label, command, args);
  if (!ok) {
    console.error(`\nQA ရပ်လိုက်ပါပြီ။ အပေါ်က ${label} ကို အရင်ပြင်ပါ။`);
    process.exit(1);
  }
}
console.log(`\n✓ QA ${skipRules ? '(quick)' : '(full)'} အောင်မြင်ပါပြီ။`);
