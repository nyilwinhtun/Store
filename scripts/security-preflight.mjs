import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const checks = [];

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

function check(label, condition, detail = '') {
  checks.push({ label, passed: Boolean(condition), detail });
  if (!condition) failures.push(label);
}

async function walk(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await walk(fullPath));
    else results.push(fullPath);
  }
  return results;
}

const [rules, authFunctions, firebaseConfig, packageJson, loginPage, appSource] = await Promise.all([
  read('firestore.rules'),
  read('functions/src/index.ts'),
  read('firebase.json'),
  read('package.json'),
  read('src/components/LoginPage.tsx'),
  read('src/App.tsx'),
]);

const config = JSON.parse(firebaseConfig);
const pkg = JSON.parse(packageJson);
const allSourceFiles = await walk(path.join(root, 'src'));
const sourceText = (await Promise.all(allSourceFiles.filter((file) => /\.(ts|tsx|js|jsx)$/.test(file)).map((file) => readFile(file, 'utf8')))).join('\n');
const [saleSyncSource, storageSource, rulesTests] = await Promise.all([
  read('src/lib/cashierSalesSync.ts'),
  read('src/lib/persistentStateStorage.ts'),
  read('tests/firestore.rules.test.mjs'),
]);

check('Firebase Functions source is configured', config.functions?.source === 'functions' && config.functions?.runtime === 'nodejs22');
check('Firestore rules are configured', config.firestore?.rules === 'firestore.rules');
check('Firestore emulator is configured for local tests', config.emulators?.firestore?.port === 8080);
check('Public registration blocking function exists', /export const blockPublicAccountRegistration\s*=\s*beforeUserCreated/.test(authFunctions));
check('Owner/Cashier sign-in blocking function exists', /export const allowOnlyOwnerAndActiveCashiers\s*=\s*beforeUserSignedIn/.test(authFunctions));
check('Blocking functions use the 7-second timeout', (authFunctions.match(/timeoutSeconds:\s*7/g) || []).length === 2);
check('Owner access is tied to the Business ownerUid', /function isBusinessOwner\([\s\S]*?get\(businessPath\(businessId\)\)\.data\.ownerUid == request\.auth\.uid/.test(rules));
check('Bootstrap UID is not a permanent Owner fallback', /function isOwner\(businessId\)\s*\{\s*\/\/ Never use the bootstrap UID as a permanent Owner fallback\.\s*return isBusinessOwner\(businessId\);\s*\}/.test(rules) && !/isOwner\(businessId\)\s*\{[^}]*isInitialBusinessBootstrapper/s.test(rules));
check('Bootstrap UID is used only for initial Business creation', (rules.match(/isInitialBusinessBootstrapper\(businessId\)/g) || []).length === 2);
check('Cashier authorization checks UID, email, role, status and one Branch', /get\(memberPath\(businessId, request\.auth\.uid\)\)\.data\.uid == request\.auth\.uid[\s\S]*?get\(memberPath\(businessId, request\.auth\.uid\)\)\.data\.email == request\.auth\.token\.email[\s\S]*?get\(memberPath\(businessId, request\.auth\.uid\)\)\.data\.role == 'cashier'[\s\S]*?get\(memberPath\(businessId, request\.auth\.uid\)\)\.data\.status == 'active'[\s\S]*?get\(memberPath\(businessId, request\.auth\.uid\)\)\.data\.branchIds\.size\(\) == 1/.test(rules));
check('Cashier membership helper receives the matched businessId explicitly',
  /function validCashierMember\(businessId, memberId\)[\s\S]*?isActiveBranch\(businessId, request\.resource\.data\.branchIds\[0\]\)/.test(rules)
  && /allow create: if isOwner\(businessId\) && validCashierMember\(businessId, memberId\);/.test(rules));
check('Missing Branches are denied before Branch fields are read',
  /function isActiveBranch\(businessId, branchId\)\s*\{[\s\S]*?return exists\(path\)\s*&& get\(path\)\.data\.payload is map/.test(rules));
check('Login page uses sign-in but no account creation', /signInWithEmailAndPassword/.test(loginPage) && !/createUserWithEmailAndPassword/.test(loginPage));
check('No public account creation or anonymous login SDK calls in app source', !/createUserWithEmailAndPassword|signInAnonymously/.test(sourceText));
check('Role-gated app shell remains present', /access\.status === 'unassigned' \|\| access\.status === 'disabled' \|\| access\.status === 'error'/.test(appSource));
check('Rules test dependency and script are configured', Boolean(pkg.devDependencies?.['@firebase/rules-unit-testing']) && typeof pkg.scripts?.['test:rules'] === 'string');
check('Rules unit test file exists', existsSync(path.join(root, 'tests/firestore.rules.test.mjs')));
check('Cashier offline sale queue uses durable IndexedDB-backed storage', /readDurableValue|writeDurableValue/.test(saleSyncSource) && /function writeDurableValue/.test(storageSource));
check('Legacy v1 Cashier queue migrates non-destructively to v2', /LEGACY_QUEUE_PREFIX = 'minimart-cashier-sale-queue-v1'/.test(saleSyncSource) && /writeDurableValue\(currentKey/.test(saleSyncSource));
check('Cashier sale transaction records Product and Batch stock deltas', /batchDeltas: batchDeltaObject/.test(saleSyncSource) && /batchUpdates\.forEach/.test(saleSyncSource));
check('Cashier sale uses a stable idempotency fingerprint', /saleFingerprint/.test(saleSyncSource) && /already-committed/.test(saleSyncSource));
check('Queue read/migration and mutations share one serialized lock', /export async function readCashierSaleQueue\(uid: string, branchId: string\)[\s\S]*?return withQueueLock/.test(saleSyncSource) && /readCashierSaleQueueInternal/.test(saleSyncSource) && /withQueueLock/.test(saleSyncSource) && /navigator.*locks|lockManager\?\.request/s.test(saleSyncSource));
check('Offline queue fallback and deletion tombstones prevent stale records resurfacing', /FALLBACK_MARKER_PREFIX/.test(storageSource) && /REMOVED_MARKER_PREFIX/.test(storageSource) && /setRemovedMarker\(key, !\(indexedDbRemoved && localStorageRemoved\)\)/.test(storageSource));
check('Cashier checkout requires complete Batch allocation coverage', /Math\.abs\(allocatedQuantity - soldQuantity\)/.test(saleSyncSource) && /batchAllocationIncomplete/.test(sourceText));
check('Firestore Rules bind Batch deductions to the linked Sale', /batchLines\.hasAny/.test(rules) && /payload\.batchDeltas\[batchId\] == reduction/.test(rules) && /batchDeltas\.keys\(\)\.size\(\) >= payload\.productDeltas\.keys\(\)\.size\(\)/.test(rules));
check('Rules Emulator suite contains at least 13 Security/Batch test cases', (rulesTests.match(/^test\(/gm) || []).length >= 13 && /without Batch allocation coverage/.test(rulesTests));

for (const item of checks) {
  process.stdout.write(`${item.passed ? 'PASS' : 'FAIL'}  ${item.label}${item.detail ? ` — ${item.detail}` : ''}\n`);
}
process.stdout.write(`\n${checks.filter((item) => item.passed).length}/${checks.length} security preflight checks passed.\n`);
if (failures.length) process.exitCode = 1;
