import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSync(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

async function readAsync(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function walkAsync(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await walkAsync(fullPath));
    else results.push(fullPath);
  }
  return results;
}

/**
 * Verifies core Firebase security rules, Auth blocking functions, and offline queue invariants.
 */
async function runSecurity() {
  const failures = [];
  const checks = [];

  const check = (label, condition, detail = '') => {
    checks.push({ label, passed: Boolean(condition), detail });
    if (!condition) failures.push(label);
  };

  const [rules, authFunctions, firebaseConfig, packageJson, loginPage, appSource] = await Promise.all([
    readAsync('firestore.rules'),
    readAsync('functions/src/index.ts'),
    readAsync('firebase.json'),
    readAsync('package.json'),
    readAsync('src/components/LoginPage.tsx'),
    readAsync('src/App.tsx'),
  ]);

  const config = JSON.parse(firebaseConfig);
  const pkg = JSON.parse(packageJson);
  const allSourceFiles = await walkAsync(path.join(root, 'src'));
  const sourceText = (
    await Promise.all(allSourceFiles.filter((file) => /\.(ts|tsx|js|jsx)$/.test(file)).map((file) => readFile(file, 'utf8')))
  ).join('\n');
  const [saleSyncSource, storageSource, rulesTests, cashierUnitSaleSource] = await Promise.all([
    readAsync('src/lib/cashierSalesSync.ts'),
    readAsync('src/lib/persistentStateStorage.ts'),
    readAsync('tests/firestore.rules.test.mjs'),
    readAsync('functions/src/cashierUnitSale.ts'),
  ]);

  check('Firebase Functions source is configured', config.functions?.source === 'functions' && config.functions?.runtime === 'nodejs22');
  check('Firestore rules are configured', config.firestore?.rules === 'firestore.rules');
  check(
    'Firestore emulator is configured for local tests',
    Number.isInteger(config.emulators?.firestore?.port) && config.emulators.firestore.port >= 1024 && config.emulators.firestore.port <= 65535,
  );
  check('Public registration blocking function exists', /export const blockPublicAccountRegistration\s*=\s*beforeUserCreated/.test(authFunctions));
  check('Owner/Cashier sign-in blocking function exists', /export const allowOnlyOwnerAndActiveCashiers\s*=\s*beforeUserSignedIn/.test(authFunctions));
  check('Blocking functions use the 7-second timeout', (authFunctions.match(/timeoutSeconds:\s*7/g) || []).length === 2);
  check('Owner access is tied to the Business ownerUid', /function isBusinessOwner\([\s\S]*?get\(businessPath\(businessId\)\)\.data\.ownerUid == request\.auth\.uid/.test(rules));
  check(
    'Bootstrap UID is not a permanent Owner fallback',
    /function isOwner\(businessId\)\s*\{\s*\/\/ Never use the bootstrap UID as a permanent Owner fallback\.\s*return isBusinessOwner\(businessId\);\s*\}/.test(rules) &&
      !/isOwner\(businessId\)\s*\{[^}]*isInitialBusinessBootstrapper/s.test(rules),
  );
  check('Bootstrap UID is used only for initial Business creation', (rules.match(/isInitialBusinessBootstrapper\(businessId\)/g) || []).length === 2);
  check(
    'Cashier authorization checks UID, email, role, status and one Branch',
    /get\(memberPath\(businessId, request\.auth\.uid\)\)\.data\.uid == request\.auth\.uid[\s\S]*?get\(memberPath\(businessId, request\.auth\.uid\)\)\.data\.email == request\.auth\.token\.email[\s\S]*?get\(memberPath\(businessId, request\.auth\.uid\)\)\.data\.role == 'cashier'[\s\S]*?get\(memberPath\(businessId, request\.auth\.uid\)\)\.data\.status == 'active'[\s\S]*?get\(memberPath\(businessId, request\.auth\.uid\)\)\.data\.branchIds\.size\(\) == 1/.test(
      rules,
    ),
  );
  check(
    'Cashier membership helper receives the matched businessId explicitly',
    /function validCashierMember\(businessId, memberId\)[\s\S]*?isActiveBranch\(businessId, request\.resource\.data\.branchIds\[0\]\)/.test(rules) &&
      /allow create: if isOwner\(businessId\) && validCashierMember\(businessId, memberId\);/.test(rules),
  );
  check(
    'Missing Branches are denied before Branch fields are read',
    /function isActiveBranch\(businessId, branchId\)\s*\{[\s\S]*?return exists\(path\)\s*&& get\(path\)\.data\.payload is map/.test(rules),
  );
  check('Login page uses sign-in but no account creation', /signInWithEmailAndPassword/.test(loginPage) && !/createUserWithEmailAndPassword/.test(loginPage));
  check('No public account creation or anonymous login SDK calls in app source', !/createUserWithEmailAndPassword|signInAnonymously/.test(sourceText));
  check('Role-gated app shell remains present', /access\.status === 'unassigned' \|\| access\.status === 'disabled' \|\| access\.status === 'error'/.test(appSource));
  check('Rules test dependency and script are configured', Boolean(pkg.devDependencies?.['@firebase/rules-unit-testing']) && typeof pkg.scripts?.['test:rules'] === 'string');
  check('Rules unit test file exists', existsSync(path.join(root, 'tests/firestore.rules.test.mjs')));
  check('Cashier offline sale queue uses durable IndexedDB-backed storage', /readDurableValue|writeDurableValue/.test(saleSyncSource) && /function writeDurableValue/.test(storageSource));
  check('Legacy v1 Cashier queue migrates non-destructively to v2', /LEGACY_QUEUE_PREFIX = 'minimart-cashier-sale-queue-v1'/.test(saleSyncSource) && /writeDurableValue\(currentKey/.test(saleSyncSource));
  check(
    'Cashier sales are committed only by the trusted server callable',
    /commitCashierUnitSaleToCloud/.test(saleSyncSource) &&
      !/collection\('sales'\)/.test(saleSyncSource) &&
      /productDeltas/.test(cashierUnitSaleSource) &&
      /batchWrites/.test(cashierUnitSaleSource),
  );
  check('Cashier sale uses a stable idempotency fingerprint', /saleFingerprint/.test(saleSyncSource) && /already-committed/.test(saleSyncSource));
  check(
    'Queue read/migration and mutations share one serialized lock',
    /export async function readCashierSaleQueue\(uid: string, branchId: string\)[\s\S]*?return withQueueLock/.test(saleSyncSource) &&
      /readCashierSaleQueueInternal/.test(saleSyncSource) &&
      /withQueueLock/.test(saleSyncSource) &&
      /navigator.*locks|lockManager\?\.request/s.test(saleSyncSource),
  );
  check(
    'Offline queue fallback and deletion tombstones prevent stale records resurfacing',
    /FALLBACK_MARKER_PREFIX/.test(storageSource) &&
      /REMOVED_MARKER_PREFIX/.test(storageSource) &&
      /setRemovedMarker\(key, !\(indexedDbRemoved && localStorageRemoved\)\)/.test(storageSource),
  );
  check(
    'Server enforces complete Batch allocation coverage',
    /allocatedQuantity|const allocated = allocations\.reduce/.test(cashierUnitSaleSource) &&
      /Batch ခွဲဝေမှု မပြည့်စုံ/.test(cashierUnitSaleSource) &&
      /batchAllocationIncomplete/.test(sourceText),
  );
  check(
    'Firestore Rules deny direct Cashier Sale and stock bypasses',
    !/validCashierSaleCreate/.test(rules) && !/linkedProductStockReduction/.test(rules) && !/linkedBatchStockReduction/.test(rules) && /trusted Admin SDK callable/.test(rules),
  );
  check('Rules Emulator suite contains at least 13 Security/Batch test cases', (rulesTests.match(/^test\(/gm) || []).length >= 13 && /Cashier cannot create a Sale/.test(rulesTests));

  for (const item of checks) {
    process.stdout.write(`${item.passed ? 'PASS' : 'FAIL'}  ${item.label}${item.detail ? ` — ${item.detail}` : ''}\n`);
  }
  process.stdout.write(`\n${checks.filter((item) => item.passed).length}/${checks.length} security preflight checks passed.\n`);
  if (failures.length) process.exitCode = 1;
}

/**
 * Verifies Staging and Production Cloudflare Worker configs, .gitignore rules, and credential hygiene.
 */
function runStaging() {
  const pocDir = path.join(root, 'experiments/cloudflare-workers-spark-poc');
  const stagingConfig = path.join(pocDir, 'wrangler.staging.toml');
  const exampleConfig = path.join(pocDir, 'wrangler.staging.example.toml');
  const productionConfig = path.join(pocDir, 'wrangler.production.toml');
  const productionExampleConfig = path.join(pocDir, 'wrangler.production.example.toml');
  const fixturePath = path.join(pocDir, 'staging.fixture.example.json');
  const productionProject = 'minimart-production';
  const productionBusiness = 'store-mini-main';

  let failures = 0;
  let warnings = 0;

  const pass = (message) => console.log(`✓ ${message}`);
  const fail = (message) => {
    failures += 1;
    console.error(`✖ ${message}`);
  };
  const warn = (message) => {
    warnings += 1;
    console.warn(`! ${message}`);
  };

  const gitFiles = () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
    const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0');
    return [...tracked, ...untracked].filter(Boolean);
  };

  if (!existsSync(exampleConfig)) fail('wrangler.staging.example.toml is missing.');
  else {
    const example = readFileSync(exampleConfig, 'utf8');
    if (!example.includes('REPLACE_WITH_STAGING_PROJECT_ID')) fail('Staging example must keep the project placeholder.');
    else if (!/ENVIRONMENT\s*=\s*"staging"/.test(example)) fail('Staging example must set ENVIRONMENT = "staging".');
    else if (!/CORS_ALLOWED_ORIGINS\s*=\s*"[^"]+"/.test(example)) fail('Staging example must include CORS_ALLOWED_ORIGINS.');
    else if (/private_key|FIRESTORE_SERVICE_ACCOUNT\s*=/.test(example)) fail('Staging example must not contain secrets.');
    else pass('Staging example keeps placeholders, staging guard, CORS origins and no secret values.');
  }

  if (!existsSync(stagingConfig)) {
    warn('wrangler.staging.toml is not created yet (Owner action after the Staging project exists).');
  } else {
    const local = readFileSync(stagingConfig, 'utf8');
    if (local.includes('REPLACE_WITH_STAGING_PROJECT_ID')) fail('wrangler.staging.toml still has the project placeholder.');
    else if (local.includes(`FIREBASE_PROJECT_ID = "${productionProject}"`)) fail('Staging Worker must not target minimart-production.');
    else if (local.includes(`BUSINESS_ID = "${productionBusiness}"`)) fail('Staging Worker must use an isolated Staging business ID.');
    else if (!local.includes('FIREBASE_PROJECT_ID = "minimart-staging"')) fail('wrangler.staging.toml must target the minimart-staging project.');
    else if (!local.includes('BUSINESS_ID = "store-staging-main"')) fail('wrangler.staging.toml must use store-staging-main.');
    else if (!/ENVIRONMENT\s*=\s*"staging"/.test(local)) fail('wrangler.staging.toml must set ENVIRONMENT = "staging".');
    else if (/\b(FIRESTORE_EMULATOR_HOST|FIREBASE_JWKS_URL|POC_NOW|POC_DEBUG)\b/.test(local)) fail('wrangler.staging.toml must not contain test-only overrides.');
    else if (/private_key|FIRESTORE_SERVICE_ACCOUNT\s*=/.test(local)) fail('wrangler.staging.toml must not contain a secret value.');
    else {
      const origins = /CORS_ALLOWED_ORIGINS\s*=\s*"([^"]+)"/.exec(local)?.[1]?.split(',').map((value) => value.trim()).filter(Boolean) || [];
      if (!origins.length) fail('wrangler.staging.toml must declare exact CORS_ALLOWED_ORIGINS.');
      else if (origins.some((origin) => origin === '*' || origin.includes('*'))) fail('CORS_ALLOWED_ORIGINS must never use a wildcard.');
      else if (
        origins.some((origin) => {
          try {
            const parsed = new URL(origin);
            return parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol);
          } catch {
            return true;
          }
        })
      ) {
        fail('CORS_ALLOWED_ORIGINS must contain exact origins without paths or trailing slashes.');
      } else pass('wrangler.staging.toml targets minimart-staging/store-staging-main and contains no secret.');
    }
    try {
      execFileSync('git', ['check-ignore', '-q', path.relative(root, stagingConfig)], { cwd: root });
      pass('wrangler.staging.toml is Git-ignored.');
    } catch {
      fail('wrangler.staging.toml is not Git-ignored.');
    }
  }

  const wrangler = readSync('experiments/cloudflare-workers-spark-poc/wrangler.toml');
  if (!/workers_dev\s*=\s*false/.test(wrangler)) fail('Production Worker config must keep workers_dev = false.');
  else pass('Production Worker config is not publicly deployed (workers_dev = false).');

  if (!existsSync(productionExampleConfig)) fail('wrangler.production.example.toml is missing.');
  else {
    const prodExample = readFileSync(productionExampleConfig, 'utf8');
    if (!prodExample.includes('REPLACE_WITH_PRODUCTION_PROJECT_ID')) fail('Production example must keep the project placeholder.');
    else if (!/BUSINESS_ID\s*=\s*"store-mini-main"/.test(prodExample)) fail('Production example must set BUSINESS_ID = "store-mini-main".');
    else if (!/ENVIRONMENT\s*=\s*"production"/.test(prodExample)) fail('Production example must set ENVIRONMENT = "production".');
    else if (!/CHECK_TOKEN_REVOCATION\s*=\s*"true"/.test(prodExample)) fail('Production example must set CHECK_TOKEN_REVOCATION = "true".');
    else if (!/CORS_ALLOWED_ORIGINS\s*=\s*"[^"]+"/.test(prodExample)) fail('Production example must include CORS_ALLOWED_ORIGINS.');
    else if (/private_key|FIRESTORE_SERVICE_ACCOUNT\s*=/.test(prodExample)) fail('Production example must not contain secrets.');
    else pass('Production example keeps placeholders, production guard, CORS origins and no secret values.');
  }

  if (!existsSync(productionConfig)) {
    warn('wrangler.production.toml is not created yet (Owner action for Production Worker deploy).');
  } else {
    const localProd = readFileSync(productionConfig, 'utf8');
    if (localProd.includes('REPLACE_WITH_PRODUCTION_PROJECT_ID')) fail('wrangler.production.toml still has the project placeholder.');
    else if (!localProd.includes(`FIREBASE_PROJECT_ID = "${productionProject}"`)) fail('wrangler.production.toml must target minimart-production.');
    else if (!localProd.includes(`BUSINESS_ID = "${productionBusiness}"`)) fail('wrangler.production.toml must use store-mini-main.');
    else if (!/ENVIRONMENT\s*=\s*"production"/.test(localProd)) fail('wrangler.production.toml must set ENVIRONMENT = "production".');
    else if (!/CHECK_TOKEN_REVOCATION\s*=\s*"true"/.test(localProd)) fail('wrangler.production.toml must set CHECK_TOKEN_REVOCATION = "true".');
    else if (/\b(FIRESTORE_EMULATOR_HOST|FIREBASE_JWKS_URL|POC_NOW|POC_DEBUG)\b/.test(localProd)) fail('wrangler.production.toml must not contain test-only overrides.');
    else if (/private_key|FIRESTORE_SERVICE_ACCOUNT\s*=/.test(localProd)) fail('wrangler.production.toml must not contain a secret value.');
    else {
      const origins = /CORS_ALLOWED_ORIGINS\s*=\s*"([^"]+)"/.exec(localProd)?.[1]?.split(',').map((value) => value.trim()).filter(Boolean) || [];
      if (!origins.length) fail('wrangler.production.toml must declare exact HTTPS CORS_ALLOWED_ORIGINS.');
      else if (origins.some((origin) => origin === '*' || origin.includes('*'))) fail('CORS_ALLOWED_ORIGINS must never use a wildcard.');
      else if (
        origins.some((origin) => {
          try {
            const parsed = new URL(origin);
            return parsed.origin !== origin || parsed.protocol !== 'https:';
          } catch {
            return true;
          }
        })
      ) {
        fail('Production CORS_ALLOWED_ORIGINS must contain exact HTTPS origins without paths or trailing slashes.');
      } else pass('wrangler.production.toml targets minimart-production/store-mini-main with HTTPS CORS and no secret.');
    }
    try {
      execFileSync('git', ['check-ignore', '-q', path.relative(root, productionConfig)], { cwd: root });
      pass('wrangler.production.toml is Git-ignored.');
    } catch {
      fail('wrangler.production.toml is not Git-ignored.');
    }
  }

  const gitignore = readSync('.gitignore');
  for (const pattern of ['**/.wrangler/', '**/.dev.vars', 'wrangler.staging.toml', 'wrangler.production.toml', 'backups/']) {
    if (gitignore.includes(pattern)) pass(`.gitignore covers ${pattern}`);
    else fail(`.gitignore is missing ${pattern}`);
  }

  const workerClient = readSync('src/lib/workerSaleClient.ts');
  if (!/VITE_WORKER_SALES_ENABLED\s*===\s*'true'/.test(workerClient)) fail('Worker sale client must stay opt-in via VITE_WORKER_SALES_ENABLED === "true".');
  else pass('Worker sale client remains disabled unless explicitly enabled.');

  const forbiddenExtensions = new Set(['.json', '.env', '.toml', '.vars', '.ts', '.js', '.mjs', '.pem', '.key']);
  const skipPrefixes = ['node_modules/', 'functions/node_modules/', 'dist/', '.qa-build/', 'experiments/cloudflare-workers-spark-poc/node_modules/'];
  const suspiciousNames = /(^|[-_.])service[-_]?account[^/]*\.json$|\.pem$|(^|\/)\.dev\.vars$|\.key$/i;
  let scanned = 0;
  for (const relativePath of gitFiles()) {
    if (skipPrefixes.some((prefix) => relativePath.startsWith(prefix))) continue;
    if (relativePath.includes('node_modules/')) continue;
    if (suspiciousNames.test(relativePath) && !relativePath.endsWith('.example.json')) {
      fail(`Suspicious credential-like file in the working tree: ${relativePath}`);
      continue;
    }
    const extension = path.extname(relativePath);
    if (!forbiddenExtensions.has(extension)) continue;
    const absolute = path.join(root, relativePath);
    try {
      if (statSync(absolute).size > 1024 * 1024) continue;
    } catch {
      continue;
    }
    let content;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    scanned += 1;
    if (/"private_key"\s*:/.test(content) || /"type"\s*:\s*"service_account"/.test(content)) {
      fail(`Service-account material found in ${relativePath}.`);
    }
  }
  pass(`Scanned ${scanned} credential-capable files for service-account material.`);

  if (existsSync(fixturePath)) {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    if (fixture.projectId === productionProject) fail('Staging fixture must not use the Production project ID.');
    if (fixture.businessId === productionBusiness) fail('Staging fixture must use an isolated business ID.');
    if (fixture.projectId !== 'minimart-staging') fail('Staging fixture must use minimart-staging.');
    else if (fixture.businessId !== 'store-staging-main') fail('Staging fixture must use store-staging-main.');
    else if (fixture.environment !== 'staging') fail('Staging fixture must declare environment "staging".');
    else pass('Staging fixture targets minimart-staging/store-staging-main.');
  } else {
    fail('staging.fixture.example.json is missing.');
  }

  console.log(`\nStaging preflight: ${failures ? `${failures} failure(s)` : 'PASS'}, ${warnings} warning(s).`);
  if (failures) {
    console.error('Fix the failures above. This does not deploy anything.');
    process.exit(1);
  }
}

/**
 * Verifies release readiness invariants (login gating, PWA cache version, lockfile, Firebase identity).
 */
function runRelease() {
  const checks = [];
  const pass = (name, detail) => checks.push({ status: 'PASS', name, detail });
  const warn = (name, detail) => checks.push({ status: 'WARN', name, detail });
  const fail = (name, detail) => checks.push({ status: 'FAIL', name, detail });

  try {
    const login = readSync('src/features/auth/LoginPage.tsx');
    if (login.includes('signInWithEmailAndPassword') && !login.includes('createUserWithEmailAndPassword')) {
      pass('Standalone Login uses sign-in only', 'LoginPage has Firebase sign-in and no account-creation API.');
    } else {
      fail('Standalone Login uses sign-in only', 'Check LoginPage: account creation must not be available on this page.');
    }

    const app = readSync('src/App.tsx');
    if (app.includes("access.status === 'local'") && app.includes('<LoginPage />')) {
      pass('Unauthenticated entry renders Login', 'App returns the standalone LoginPage when Firebase Auth has no active user.');
    } else {
      fail('Unauthenticated entry renders Login', 'Login route guard not found in App.tsx.');
    }

    const bootstrap = readSync('src/components/AccessBootstrap.tsx');
    if (/if\s*\(!user\)\s*\{\s*resetAccess\(\);\s*return;\s*\}/m.test(bootstrap)) {
      pass('Signed-out session resets access state', 'AccessBootstrap resets Business Access when Firebase Auth reports no user.');
    } else {
      fail('Signed-out session resets access state', 'Expected signed-out reset behavior not found.');
    }

    const team = readSync('src/components/TeamAccessPanel.tsx');
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
    const walkSync = (directory) => {
      for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const relative = path.posix.join(directory, entry.name);
        if (entry.isDirectory()) walkSync(relative);
        else if (/\.(tsx?|jsx?)$/.test(entry.name)) sourceFiles.push(relative);
      }
    };
    walkSync('src');
    const stale = [];
    for (const file of sourceFiles) {
      const contents = readSync(file);
      for (const phrase of oldLoginGuidance) if (contents.includes(phrase)) stale.push(`${file}: ${phrase}`);
    }
    if (stale.length === 0) pass('Standalone Login guidance is consistent', 'No obsolete “Profile Login” directions remain in source files.');
    else fail('Standalone Login guidance is consistent', stale.join('\n'));

    const serviceWorker = readSync('public/sw.js');
    if (serviceWorker.includes('v320-preview6-release-readiness')) {
      pass('PWA cache version is bumped', 'Preview 6 uses a new Minimart service-worker cache key so deployed clients can fetch the updated app shell/assets.');
    } else {
      fail('PWA cache version is bumped', 'Update the service-worker CACHE_NAME before publishing changed assets.');
    }

    const shipment = readSync('src/components/BranchShipmentManagementPage.tsx');
    if (shipment.includes('သီးခြား Login Page')) pass('Shipment help points to standalone Login', 'Owner login instruction points to the website Login page.');
    else warn('Shipment help points to standalone Login', 'Review the shipment help text.');

    if (existsSync(path.join(root, 'package-lock.json'))) {
      pass('Dependency lockfile exists', 'npm ci can be used after installing dependencies.');
    } else {
      warn('Dependency lockfile exists', 'package-lock.json is missing; npm ci cannot run until npm install generates and commits it.');
    }

    const appConfig = readSync('src/lib/firebase.ts');
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
}

/**
 * Reports raw, gzip, and brotli sizes for all built JS chunks in dist/.
 */
function runBundle() {
  const dist = path.join(root, 'dist');
  const manifestPath = path.join(dist, '.vite', 'manifest.json');
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
  for (const entry of Object.values(manifest)) if (entry.file?.endsWith('.js')) jsFiles.add(entry.file);

  const entryFiles = new Set();
  const staticFiles = new Set();
  const addStaticChunk = (entry) => {
    if (!entry?.file?.endsWith('.js') || staticFiles.has(entry.file)) return;
    staticFiles.add(entry.file);
    for (const dependency of entry.imports || []) addStaticChunk(manifest[dependency]);
  };
  for (const entry of Object.values(manifest)) {
    if (!entry.isEntry) continue;
    entryFiles.add(entry.file);
    addStaticChunk(entry);
  }

  const rows = [...jsFiles]
    .map((file) => {
      const filePath = path.join(dist, file);
      const data = readFileSync(filePath);
      return {
        file,
        bytes: statSync(filePath).size,
        gzip: gzipSync(data).length,
        brotli: brotliCompressSync(data).length,
        entry: entryFiles.has(file),
        static: staticFiles.has(file),
      };
    })
    .sort((a, b) => b.bytes - a.bytes);

  const format = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  console.log('\nMinimart POS JavaScript bundle report');
  console.log('-------------------------------------');
  for (const row of rows) {
    const label = row.entry ? '[ENTRY] ' : row.static ? '[VENDOR]' : '[LAZY]  ';
    console.log(`${label}${format(row.bytes).padStart(10)} | gzip ${format(row.gzip).padStart(9)} | br ${format(row.brotli).padStart(9)} | ${row.file}`);
  }
  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  const entry = rows.filter((row) => row.static).reduce((sum, row) => sum + row.bytes, 0);
  console.log('-------------------------------------');
  console.log(`Initial JS total (entry + static vendor): ${format(entry)}`);
  console.log(`All JS chunks:  ${format(total)}`);
  console.log('Note: Lazy chunks download when their page/feature is first opened. The PWA caches them after first use.');
}

const COMMANDS = {
  security: runSecurity,
  staging: runStaging,
  release: runRelease,
  bundle: runBundle,
};

const command = process.argv[2];
if (!command || !COMMANDS[command]) {
  console.error(`Usage: node scripts/checks.mjs <${Object.keys(COMMANDS).join('|')}>`);
  process.exit(1);
}

await COMMANDS[command]();
