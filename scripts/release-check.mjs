import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const checks = [];
const pass = (name, detail) => checks.push({ status: 'PASS', name, detail });
const warn = (name, detail) => checks.push({ status: 'WARN', name, detail });
const fail = (name, detail) => checks.push({ status: 'FAIL', name, detail });

try {
  const login = read('src/features/auth/LoginPage.tsx');
  if (login.includes('signInWithEmailAndPassword') && !login.includes('createUserWithEmailAndPassword')) {
    pass('Standalone Login uses sign-in only', 'LoginPage has Firebase sign-in and no account-creation API.');
  } else {
    fail('Standalone Login uses sign-in only', 'Check LoginPage: account creation must not be available on this page.');
  }

  const app = read('src/App.tsx');
  if (app.includes("access.status === 'local'") && app.includes('<LoginPage />')) {
    pass('Unauthenticated entry renders Login', 'App returns the standalone LoginPage when Firebase Auth has no active user.');
  } else {
    fail('Unauthenticated entry renders Login', 'Login route guard not found in App.tsx.');
  }

  const bootstrap = read('src/components/AccessBootstrap.tsx');
  if (/if\s*\(!user\)\s*\{\s*resetAccess\(\);\s*return;\s*\}/m.test(bootstrap)) {
    pass('Signed-out session resets access state', 'AccessBootstrap resets Business Access when Firebase Auth reports no user.');
  } else {
    fail('Signed-out session resets access state', 'Expected signed-out reset behavior not found.');
  }

  const team = read('src/components/TeamAccessPanel.tsx');
  if (team.includes("role: 'cashier' as const") && team.includes("savedData.role !== 'cashier'")) {
    pass('Owner Team Access provisions Cashier only', 'Created member role is fixed to cashier and verified after save.');
  } else {
    fail('Owner Team Access provisions Cashier only', 'Review TeamAccessPanel: cashier provisioning must not grant owner role.');
  }

  const oldLoginGuidance = [
    'Profile → Firebase Business Account',
    'Profile Login ကို ဖွင့်ရန်',
    'Profile မှ Owner Account နဲ့ Login',
  ];
  const sourceFiles = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) sourceFiles.push(relative);
    }
  };
  walk('src');
  const stale = [];
  for (const file of sourceFiles) {
    const contents = read(file);
    for (const phrase of oldLoginGuidance) if (contents.includes(phrase)) stale.push(`${file}: ${phrase}`);
  }
  if (stale.length === 0) pass('Standalone Login guidance is consistent', 'No obsolete “Profile Login” directions remain in source files.');
  else fail('Standalone Login guidance is consistent', stale.join('\n'));

  const serviceWorker = read('public/sw.js');
  if (serviceWorker.includes('v320-preview6-release-readiness')) {
    pass('PWA cache version is bumped', 'Preview 6 uses a new Minimart service-worker cache key so deployed clients can fetch the updated app shell/assets.');
  } else {
    fail('PWA cache version is bumped', 'Update the service-worker CACHE_NAME before publishing changed assets.');
  }

  const shipment = read('src/components/BranchShipmentManagementPage.tsx');
  if (shipment.includes('သီးခြား Login Page')) pass('Shipment help points to standalone Login', 'Owner login instruction points to the website Login page.');
  else warn('Shipment help points to standalone Login', 'Review the shipment help text.');

  if (fs.existsSync(path.join(root, 'package-lock.json'))) {
    pass('Dependency lockfile exists', 'npm ci can be used after installing dependencies.');
  } else {
    warn('Dependency lockfile exists', 'package-lock.json is missing; npm ci cannot run until npm install generates and commits it.');
  }

  const appConfig = read('src/lib/firebase.ts');
  if (appConfig.includes("projectId: 'minimart-production'") && appConfig.includes("FIREBASE_BUSINESS_ID = 'store-mini-main'")) {
    pass('Firebase identity configuration unchanged', 'Expected project and business identifiers remain present in the source copy.');
  } else {
    warn('Firebase identity configuration unchanged', 'Compare Firebase identity configuration against the known production baseline.');
  }
} catch (error) {
  console.error('Release check could not complete:', error);
  process.exit(2);
}

for (const item of checks) {
  const icon = item.status === 'PASS' ? '✓' : item.status === 'WARN' ? '!' : '✗';
  console.log(`${icon} [${item.status}] ${item.name}\n  ${item.detail.replaceAll('\n', '\n  ')}`);
}

const failed = checks.filter((item) => item.status === 'FAIL').length;
const warned = checks.filter((item) => item.status === 'WARN').length;
console.log(`\nSummary: ${checks.length - failed - warned} passed, ${warned} warnings, ${failed} failed.`);
if (failed > 0) process.exit(1);
