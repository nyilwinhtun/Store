import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pocDir = path.join(root, 'experiments/cloudflare-workers-spark-poc');
const stagingConfig = path.join(pocDir, 'wrangler.staging.toml');
const exampleConfig = path.join(pocDir, 'wrangler.staging.example.toml');
const fixturePath = path.join(pocDir, 'staging.fixture.example.json');
const productionProject = 'minimart-production';
const productionBusiness = 'store-mini-main';

let failures = 0;
let warnings = 0;

function pass(message) {
  console.log(`✓ ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`✖ ${message}`);
}

function warn(message) {
  warnings += 1;
  console.warn(`! ${message}`);
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function gitFiles() {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  const untracked = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0');
  return [...tracked, ...untracked].filter(Boolean);
}

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
    else if (origins.some((origin) => {
      try {
        const parsed = new URL(origin);
        return parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol);
      } catch {
        return true;
      }
    })) fail('CORS_ALLOWED_ORIGINS must contain exact origins without paths or trailing slashes.');
    else pass('wrangler.staging.toml targets minimart-staging/store-staging-main and contains no secret.');
  }
  try {
    execFileSync('git', ['check-ignore', '-q', path.relative(root, stagingConfig)], { cwd: root });
    pass('wrangler.staging.toml is Git-ignored.');
  } catch {
    fail('wrangler.staging.toml is not Git-ignored.');
  }
}

const wrangler = read('experiments/cloudflare-workers-spark-poc/wrangler.toml');
if (!/workers_dev\s*=\s*false/.test(wrangler)) fail('Production Worker config must keep workers_dev = false.');
else pass('Production Worker config is not publicly deployed (workers_dev = false).');

const gitignore = read('.gitignore');
for (const pattern of ['**/.wrangler/', '**/.dev.vars', 'wrangler.staging.toml']) {
  if (gitignore.includes(pattern)) pass(`.gitignore covers ${pattern}`);
  else fail(`.gitignore is missing ${pattern}`);
}

const workerClient = read('src/lib/workerSaleClient.ts');
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
