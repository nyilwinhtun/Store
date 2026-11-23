import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntime, resolveCorsOrigins, resolveWorkerTarget } from '../src/index.js';
import { createCredentialFromEnv } from '../src/firestore/credentials.js';

const STAGING = {
  FIREBASE_PROJECT_ID: 'minimart-staging',
  BUSINESS_ID: 'store-staging-main',
  ENVIRONMENT: 'staging',
  CORS_ALLOWED_ORIGINS: 'https://staging.example.test',
};

const PRODUCTION = {
  FIREBASE_PROJECT_ID: 'minimart-production',
  BUSINESS_ID: 'store-mini-main',
  ENVIRONMENT: 'production',
  CHECK_TOKEN_REVOCATION: 'true',
  CORS_ALLOWED_ORIGINS: 'https://nyilwinhtun.github.io',
};

test('requires an explicit project and business', () => {
  assert.throws(() => resolveWorkerTarget({}), /FIREBASE_PROJECT_ID/);
});

test('refuses unresolved placeholder values', () => {
  assert.throws(
    () => resolveWorkerTarget({ ...STAGING, FIREBASE_PROJECT_ID: 'REPLACE_WITH_STAGING_PROJECT_ID' }),
    /placeholder/,
  );
});

test('staging refuses the Production project', () => {
  assert.throws(
    () => resolveWorkerTarget({ ...STAGING, FIREBASE_PROJECT_ID: 'minimart-production' }),
    /must never target Production/,
  );
});

test('staging refuses the Production business', () => {
  assert.throws(
    () => resolveWorkerTarget({ ...STAGING, BUSINESS_ID: 'store-mini-main' }),
    /must never target Production/,
  );
});

test('service account must belong to the configured project', () => {
  const env = {
    FIREBASE_PROJECT_ID: 'minimart-staging',
    FIRESTORE_SERVICE_ACCOUNT: JSON.stringify({
      project_id: 'minimart-production',
      client_email: 'unused@example.invalid',
      private_key: 'not-a-real-key',
    }),
  };
  assert.throws(() => createCredentialFromEnv(env, {}, 'minimart-staging'), /မဟုတ်ပါ/);
});

test('staging rejects test-only overrides', () => {
  for (const [name, value] of [
    ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:8101'],
    ['FIREBASE_JWKS_URL', 'https://mock.local/jwks'],
    ['POC_NOW', '1767225600000'],
    ['POC_DEBUG', 'true'],
  ]) {
    assert.throws(
      () => resolveWorkerTarget({ ...STAGING, [name]: value }),
      /test-only overrides/,
      name,
    );
  }
});

test('staging requires an exact CORS origin', () => {
  const { CORS_ALLOWED_ORIGINS: _origins, ...withoutOrigins } = STAGING;
  assert.throws(() => buildRuntime(withoutOrigins), /CORS_ALLOWED_ORIGINS/);
});

test('CORS origins must be exact and must not use a wildcard', () => {
  assert.deepEqual(
    resolveCorsOrigins({ CORS_ALLOWED_ORIGINS: 'https://staging.example.test,http://localhost:5173' }),
    ['https://staging.example.test', 'http://localhost:5173'],
  );
  assert.throws(() => resolveCorsOrigins({ CORS_ALLOWED_ORIGINS: '*' }), /wildcard/);
  assert.throws(() => resolveCorsOrigins({ CORS_ALLOWED_ORIGINS: 'https://staging.example.test/' }), /exact HTTPS origins/);
  assert.throws(() => resolveCorsOrigins({ CORS_ALLOWED_ORIGINS: 'http://staging.example.test' }), /exact HTTPS origins/);
});

test('builds a runtime only for an isolated Staging target', () => {
  const runtime = buildRuntime({
    ...STAGING,
    FIRESTORE_SERVICE_ACCOUNT: JSON.stringify({
      project_id: 'minimart-staging',
      client_email: 'worker@example.invalid',
      private_key: 'not-a-real-key',
    }),
  });
  assert.equal(typeof runtime.handle, 'function');
  assert.equal(typeof runtime.expireStale, 'function');
});

test('builds a local runtime without the Staging guard', () => {
  const runtime = buildRuntime({
    FIREBASE_PROJECT_ID: 'minimart-staging',
    BUSINESS_ID: 'store-staging-main',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8101',
  });
  assert.equal(typeof runtime.handle, 'function');
  assert.equal(typeof runtime.expireStale, 'function');
});

test('production requires strict pairing of minimart-production and store-mini-main', () => {
  assert.throws(
    () => resolveWorkerTarget({ ...PRODUCTION, FIREBASE_PROJECT_ID: 'minimart-staging' }),
    /must strictly target minimart-production and store-mini-main/,
  );
  assert.throws(
    () => resolveWorkerTarget({ ...PRODUCTION, BUSINESS_ID: 'store-staging-main' }),
    /must strictly target minimart-production and store-mini-main/,
  );
});

test('production project or business requires ENVIRONMENT = "production"', () => {
  assert.throws(
    () => resolveWorkerTarget({ FIREBASE_PROJECT_ID: 'minimart-production', BUSINESS_ID: 'store-mini-main' }),
    /requires ENVIRONMENT = "production"/,
  );
  assert.throws(
    () => resolveWorkerTarget({ FIREBASE_PROJECT_ID: 'minimart-production', BUSINESS_ID: 'store-staging-main', ENVIRONMENT: 'local' }),
    /requires ENVIRONMENT = "production"/,
  );
  assert.throws(
    () => resolveWorkerTarget({ FIREBASE_PROJECT_ID: 'minimart-staging', BUSINESS_ID: 'store-mini-main' }),
    /requires ENVIRONMENT = "production"/,
  );
});

test('production rejects test-only overrides', () => {
  for (const [name, value] of [
    ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:8101'],
    ['FIREBASE_JWKS_URL', 'https://mock.local/jwks'],
    ['POC_NOW', '1767225600000'],
    ['POC_DEBUG', 'true'],
  ]) {
    assert.throws(
      () => resolveWorkerTarget({ ...PRODUCTION, [name]: value }),
      /test-only overrides/,
      name,
    );
  }
});

test('production requires non-empty exact HTTPS CORS origins and CHECK_TOKEN_REVOCATION=true', () => {
  const { CORS_ALLOWED_ORIGINS: _origins, ...withoutOrigins } = PRODUCTION;
  assert.throws(() => buildRuntime(withoutOrigins), /exact HTTPS CORS_ALLOWED_ORIGINS/);
  assert.throws(
    () => buildRuntime({ ...PRODUCTION, CORS_ALLOWED_ORIGINS: 'http://localhost:5173' }),
    /exact HTTPS CORS_ALLOWED_ORIGINS/,
  );
  assert.throws(
    () => buildRuntime({ ...PRODUCTION, CHECK_TOKEN_REVOCATION: 'false' }),
    /CHECK_TOKEN_REVOCATION/,
  );
});

test('builds a runtime for a valid Production target', () => {
  const runtime = buildRuntime({
    ...PRODUCTION,
    FIRESTORE_SERVICE_ACCOUNT: JSON.stringify({
      project_id: 'minimart-production',
      client_email: 'worker@example.invalid',
      private_key: 'not-a-real-key',
    }),
  });
  assert.equal(typeof runtime.handle, 'function');
  assert.equal(typeof runtime.expireStale, 'function');
});
