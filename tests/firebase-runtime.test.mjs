import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMULATOR_AUTH_PORT,
  EMULATOR_FIRESTORE_PORT,
  EMULATOR_FUNCTIONS_PORT,
  EMULATOR_PROJECT_ID,
  PRODUCTION_BUSINESS_ID,
  PRODUCTION_PROJECT_ID,
  STAGING_BUSINESS_ID,
  STAGING_PROJECT_ID,
  emulatorFirebaseConfig,
  productionFirebaseConfig,
  resolveFirebaseRuntime,
  stagingFirebaseConfig,
} from '../.qa-build/firebaseRuntime.mjs';

test('development without flags resolves to the synthetic Emulator project', () => {
  const runtime = resolveFirebaseRuntime({ DEV: true, PROD: false, MODE: 'development' });
  assert.equal(runtime.mode, 'emulator');
  assert.equal(runtime.projectId, EMULATOR_PROJECT_ID);
  assert.equal(runtime.config.projectId, EMULATOR_PROJECT_ID);
  assert.notEqual(runtime.config.projectId, PRODUCTION_PROJECT_ID);
  assert.equal(runtime.businessId, PRODUCTION_BUSINESS_ID);
  assert.equal(runtime.emulator.host, 'localhost');
  assert.equal(runtime.emulator.authPort, EMULATOR_AUTH_PORT);
  assert.equal(runtime.emulator.firestorePort, EMULATOR_FIRESTORE_PORT);
  assert.equal(runtime.emulator.functionsPort, EMULATOR_FUNCTIONS_PORT);
  assert.deepEqual(runtime.config, emulatorFirebaseConfig);
});

test('a bare Node-style environment also defaults to the Emulator project', () => {
  const runtime = resolveFirebaseRuntime({});
  assert.equal(runtime.mode, 'emulator');
  assert.equal(runtime.config.projectId, EMULATOR_PROJECT_ID);
});

test('Emulator mode never exposes a production identifier', () => {
  const runtime = resolveFirebaseRuntime({ DEV: true, MODE: 'emulator' });
  const identifiers = [runtime.config.projectId, runtime.config.authDomain, runtime.config.storageBucket, runtime.config.appId];
  for (const identifier of identifiers) {
    assert.equal(identifier.toLowerCase().includes(PRODUCTION_PROJECT_ID), false, `${identifier} must not reference production`);
  }
  assert.equal(runtime.emulator.authPort, 9099);
  assert.equal(runtime.emulator.firestorePort, 8099);
});

test('development cannot switch to production without explicit authorization', () => {
  assert.throws(
    () => resolveFirebaseRuntime({ DEV: true, PROD: false, VITE_FIREBASE_MODE: 'production' }),
    /development mode resolved to the production Firebase project/,
  );
  assert.throws(
    () => resolveFirebaseRuntime({ DEV: true, PROD: false, MODE: 'production' }),
    /development mode resolved to the production Firebase project/,
  );
  const authorized = resolveFirebaseRuntime({
    DEV: true,
    PROD: false,
    VITE_FIREBASE_MODE: 'production',
    VITE_ALLOW_PRODUCTION_IN_DEV: 'true',
  });
  assert.equal(authorized.mode, 'production');
  assert.equal(authorized.projectId, PRODUCTION_PROJECT_ID);
  assert.equal(authorized.usingProductionInDevelopment, true);
  assert.equal(authorized.emulator, null);
  assert.deepEqual(authorized.config, productionFirebaseConfig);
});

test('production builds always target minimart-production', () => {
  const fromMode = resolveFirebaseRuntime({ DEV: false, PROD: true, MODE: 'production' });
  const fromNothing = resolveFirebaseRuntime({ PROD: true });
  for (const runtime of [fromMode, fromNothing]) {
    assert.equal(runtime.mode, 'production');
    assert.equal(runtime.config.projectId, PRODUCTION_PROJECT_ID);
    assert.equal(runtime.emulator, null);
    assert.equal(runtime.usingProductionInDevelopment, false);
  }
});

test('production builds refuse Emulator mode', () => {
  assert.throws(() => resolveFirebaseRuntime({ PROD: true, VITE_FIREBASE_MODE: 'emulator' }), /not allowed in a production build/);
  assert.throws(() => resolveFirebaseRuntime({ PROD: true, MODE: 'emulator' }), /not allowed in a production build/);
});

test('Staging mode targets the isolated minimart-staging project and business', () => {
  const runtime = resolveFirebaseRuntime({ DEV: true, PROD: false, VITE_FIREBASE_MODE: 'staging' });
  assert.equal(runtime.mode, 'staging');
  assert.equal(runtime.projectId, STAGING_PROJECT_ID);
  assert.equal(runtime.businessId, STAGING_BUSINESS_ID);
  assert.notEqual(runtime.projectId, PRODUCTION_PROJECT_ID);
  assert.equal(runtime.emulator, null);
  assert.equal(runtime.usingProductionInDevelopment, false);
  assert.deepEqual(runtime.config, stagingFirebaseConfig);
  const identifiers = [runtime.config.projectId, runtime.config.authDomain, runtime.config.storageBucket, runtime.config.appId];
  for (const identifier of identifiers) {
    assert.equal(identifier.toLowerCase().includes(PRODUCTION_PROJECT_ID), false, `${identifier} must not reference production`);
  }
});

test('Staging production builds are allowed and still target minimart-staging', () => {
  const runtime = resolveFirebaseRuntime({ PROD: true, VITE_FIREBASE_MODE: 'staging' });
  assert.equal(runtime.mode, 'staging');
  assert.equal(runtime.projectId, STAGING_PROJECT_ID);
  assert.equal(runtime.businessId, STAGING_BUSINESS_ID);
  assert.equal(runtime.productionBuild, true);
  assert.deepEqual(runtime.config, stagingFirebaseConfig);
});

test('unknown runtime modes fail closed', () => {
  assert.throws(() => resolveFirebaseRuntime({ DEV: true, VITE_FIREBASE_MODE: 'sandbox' }), /Unknown Firebase runtime mode/);
  assert.throws(() => resolveFirebaseRuntime({ DEV: true, MODE: 'preview' }), /Unknown Firebase runtime mode/);
});

test('Emulator host must be a bare host name', () => {
  assert.throws(() => resolveFirebaseRuntime({ DEV: true, VITE_EMULATOR_HOST: 'http://localhost' }), /bare host name/);
  assert.throws(() => resolveFirebaseRuntime({ DEV: true, VITE_EMULATOR_HOST: 'localhost:8099/path' }), /bare host name/);
  assert.throws(() => resolveFirebaseRuntime({ DEV: true, VITE_EMULATOR_HOST: 'localhost?x=1' }), /bare host name/);
  const lan = resolveFirebaseRuntime({ DEV: true, VITE_EMULATOR_HOST: '192.168.1.20' });
  assert.equal(lan.emulator.host, '192.168.1.20');
  assert.equal(lan.config.projectId, EMULATOR_PROJECT_ID);
});
