import { createApp } from './app.js';
import { createCredentialFromEnv } from './firestore/credentials.js';
import { FirestoreRest } from './firestore/rest.js';
import { createIdTokenVerifier, createRevocationChecker } from './auth/verifyIdToken.js';

const PRODUCTION_PROJECT_ID = 'minimart-production';
const PRODUCTION_BUSINESS_ID = 'store-mini-main';
const PLACEHOLDER = /^REPLACE_WITH_/;
const TEST_ONLY_ENV = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_JWKS_URL', 'POC_NOW', 'POC_DEBUG'];

let runtime = null;

function assertNoTestOverrides(env, environment) {
  const configured = TEST_ONLY_ENV.filter((name) => String(env?.[name] ?? '').trim() !== '');
  if (configured.length) {
    throw new Error(`${environment === 'production' ? 'Production' : 'Staging'} Worker must not configure test-only overrides: ${configured.join(', ')}`);
  }
}

export function resolveCorsOrigins(env) {
  const raw = String(env?.CORS_ALLOWED_ORIGINS || '').trim();
  if (!raw) return [];
  const origins = raw.split(',').map((value) => value.trim()).filter(Boolean);
  for (const origin of origins) {
    if (origin === '*' || origin.includes('*')) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain exact origins, never a wildcard.');
    }
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin
      || parsed.username || parsed.password || (parsed.protocol === 'http:' && !loopback)) {
      throw new Error(`CORS_ALLOWED_ORIGINS must contain exact HTTPS origins (HTTP only for loopback): ${origin}`);
    }
  }
  return [...new Set(origins)];
}

/**
 * Staging deploys set ENVIRONMENT=staging and must never carry Production IDs.
 * Production deploys set ENVIRONMENT=production and must strictly pair with
 * minimart-production + store-mini-main. Neither may keep placeholders or
 * inherit local test-only overrides.
 */
export function resolveWorkerTarget(env) {
  const projectId = String(env?.FIREBASE_PROJECT_ID || '').trim();
  const businessId = String(env?.BUSINESS_ID || '').trim();
  if (!projectId || !businessId) throw new Error('FIREBASE_PROJECT_ID / BUSINESS_ID မသတ်မှတ်ရသေးပါ။');
  if (PLACEHOLDER.test(projectId) || PLACEHOLDER.test(businessId)) {
    throw new Error('Worker configuration still contains a placeholder value.');
  }
  const environment = String(env?.ENVIRONMENT || '').trim().toLowerCase();
  if (environment === 'staging') {
    assertNoTestOverrides(env, environment);
    if (projectId === PRODUCTION_PROJECT_ID || businessId === PRODUCTION_BUSINESS_ID) {
      throw new Error('Staging Worker must never target Production Firebase.');
    }
  } else if (environment === 'production') {
    assertNoTestOverrides(env, environment);
    if (projectId !== PRODUCTION_PROJECT_ID || businessId !== PRODUCTION_BUSINESS_ID) {
      throw new Error('Production Worker must strictly target minimart-production and store-mini-main.');
    }
  } else if (projectId === PRODUCTION_PROJECT_ID || businessId === PRODUCTION_BUSINESS_ID) {
    throw new Error('Production project/business requires ENVIRONMENT = "production".');
  }
  return { projectId, businessId, environment };
}

export function buildRuntime(env) {
  const { projectId, businessId, environment } = resolveWorkerTarget(env);
  const allowedOrigins = resolveCorsOrigins(env);
  if (environment === 'staging' && allowedOrigins.length === 0) {
    throw new Error('Staging Worker requires at least one exact CORS_ALLOWED_ORIGINS value.');
  }
  if (environment === 'production') {
    if (allowedOrigins.length === 0 || allowedOrigins.some((origin) => !origin.startsWith('https://'))) {
      throw new Error('Production Worker requires non-empty exact HTTPS CORS_ALLOWED_ORIGINS.');
    }
    if (String(env?.CHECK_TOKEN_REVOCATION || '').trim() !== 'true') {
      throw new Error('Production Worker requires CHECK_TOKEN_REVOCATION = "true".');
    }
  }
  const credential = createCredentialFromEnv(env, {}, projectId);
  const firestore = new FirestoreRest({
    projectId,
    host: env.FIRESTORE_EMULATOR_HOST ? `http://${env.FIRESTORE_EMULATOR_HOST}` : env.FIRESTORE_HOST,
    credential,
  });
  const verifier = createIdTokenVerifier({
    projectId,
    ...(env.FIREBASE_JWKS_URL ? { jwksUrl: env.FIREBASE_JWKS_URL } : {}),
  });
  const revocationChecker = env.CHECK_TOKEN_REVOCATION === 'true'
    ? createRevocationChecker({ projectId, credential })
    : null;
  return createApp({
    projectId,
    businessId,
    firestore,
    verifier,
    revocationChecker,
    allowedOrigins,
    ...(env.POC_NOW ? { now: () => Number(env.POC_NOW) } : {}),
    debug: env.POC_DEBUG === 'true',
  });
}

export default {
  async fetch(request, env) {
    try {
      if (!runtime) runtime = buildRuntime(env);
      return await runtime.handle(request);
    } catch (error) {
      // Configuration and credential failures must never leak secret material.
      return new Response(JSON.stringify({ ok: false, code: 'server-config', message: 'Worker ပြင်ဆင်မှု မပြည့်စုံပါ။ Owner က Secret ကို စစ်ဆေးပါ။' }), {
        status: 503,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
  },

  async scheduled(event, env, ctx) {
    if (!runtime) runtime = buildRuntime(env);
    const serverNow = new Date(Number(event.scheduledTime) || Date.now());
    ctx.waitUntil(runtime.expireStale(serverNow));
  },
};
