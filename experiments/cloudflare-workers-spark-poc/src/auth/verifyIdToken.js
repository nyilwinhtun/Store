import { authenticated, SaleError } from '../errors.js';
import { defaultFetch } from '../fetch.js';

const DEFAULT_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const MAX_TOKEN_AGE_SKEW_SECONDS = 300;

function base64UrlDecode(input) {
  const normalized = String(input).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64UrlDecodeJson(input) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(input)));
  } catch {
    return null;
  }
}

function parseCacheMaxAge(headerValue) {
  const match = /max-age=(\d+)/i.exec(String(headerValue || ''));
  if (!match) return 3600 * 1000;
  return Math.min(6 * 3600, Math.max(300, Number(match[1]))) * 1000;
}

/**
 * Verifies a Firebase ID token (RS256) against Firebase's public JWKS and the
 * project's issuer/audience. Signature validity alone is not account status:
 * membership and Branch authorization are always re-read from Firestore, and an
 * optional Identity Toolkit `validSince` check covers revoked refresh tokens.
 */
export function createIdTokenVerifier({
  projectId,
  fetchImpl = defaultFetch,
  jwksUrl = DEFAULT_JWKS_URL,
  now = () => Date.now(),
} = {}) {
  if (!projectId) throw new Error('projectId is required');
  let keyCache = null;
  let cacheExpiresAt = 0;
  let lastForcedFetch = 0;
  let inFlight = null;

  async function loadKeys(force) {
    if (!force && keyCache && now() < cacheExpiresAt) return keyCache;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const response = await fetchImpl(jwksUrl);
      if (!response.ok) throw new SaleError(503, 'unavailable', 'Firebase Auth Public Key ကို မရယူနိုင်ပါ။');
      const body = await response.json();
      if (!body || !Array.isArray(body.keys)) throw new SaleError(503, 'unavailable', 'Firebase Auth Public Key ပုံစံ မမှန်ပါ။');
      keyCache = body.keys;
      cacheExpiresAt = now() + parseCacheMaxAge(response.headers.get('cache-control'));
      return keyCache;
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  async function signatureIsValid(header, signingInput, signature) {
    let keys = await loadKeys(false);
    let candidates = keys.filter((key) => !header.kid || key.kid === header.kid);
    if (!candidates.length && header.kid && now() - lastForcedFetch > 60 * 1000) {
      lastForcedFetch = now();
      keys = await loadKeys(true);
      candidates = keys.filter((key) => key.kid === header.kid);
    }
    if (!candidates.length) return false;
    for (const jwk of candidates) {
      try {
        const key = await crypto.subtle.importKey(
          'jwk',
          { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        );
        const valid = await crypto.subtle.verify(
          'RSASSA-PKCS1-v1_5',
          key,
          signature,
          new TextEncoder().encode(signingInput),
        );
        if (valid) return true;
      } catch {
        // Try the next key; malformed keys must not authenticate anything.
      }
    }
    return false;
  }

  return async function verifyIdToken(token) {
    if (typeof token !== 'string' || !token) authenticated('Cashier Login လိုအပ်ပါတယ်။');
    const parts = token.split('.');
    if (parts.length !== 3) authenticated('Firebase Token ပုံစံ မမှန်ပါ။');
    const header = base64UrlDecodeJson(parts[0]);
    const payload = base64UrlDecodeJson(parts[1]);
    if (!header || !payload) authenticated('Firebase Token ကို ဖတ်မရပါ။');
    if (header.alg !== 'RS256') authenticated('Firebase Token Algorithm မမှန်ပါ။');
    if (!(await signatureIsValid(header, `${parts[0]}.${parts[1]}`, base64UrlDecode(parts[2])))) {
      authenticated('Firebase Token လက်မှတ် မမှန်ပါ။');
    }

    const nowSeconds = Math.floor(now() / 1000);
    if (payload.aud !== projectId) authenticated('Firebase Token Audience မမှန်ပါ။');
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) authenticated('Firebase Token Issuer မမှန်ပါ။');
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) authenticated('Firebase UID မမှန်ပါ။');
    if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) authenticated('Firebase Token သက်တမ်း ကုန်သွားပါပြီ။');
    if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + MAX_TOKEN_AGE_SKEW_SECONDS) {
      authenticated('Firebase Token အချိန် မမှန်ပါ။');
    }
    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      name: typeof payload.name === 'string' ? payload.name : '',
      authTime: typeof payload.auth_time === 'number' ? payload.auth_time : payload.iat,
      claims: payload,
    };
  };
}

/**
 * Optional token-revocation check. Firebase ID tokens remain valid until `exp`
 * even after the Owner disables a Cashier; only `validSince` (server-side)
 * closes that window. The membership status check already blocks disabled
 * accounts before the next token refresh.
 */
export function createRevocationChecker({ projectId, credential, fetchImpl = defaultFetch, now = () => Date.now(), cacheTtlMs = 5 * 60 * 1000 }) {
  const cache = new Map();

  return async function assertNotRevoked(identity) {
    const cached = cache.get(identity.uid);
    if (cached && now() < cached.expiresAt) {
      if (cached.validSince > identity.authTime) authenticated('Cashier Login ကို ပြန်လည် ဝင်ရောက်ရန် လိုအပ်ပါတယ်။');
      return;
    }
    const authorization = await credential.getAuthorizationHeader();
    const response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:lookup`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ localId: [identity.uid] }),
    });
    if (!response.ok) throw new SaleError(503, 'unavailable', 'Cashier အကောင့် အခြေအနေကို စစ်ဆေးနိုင်ခြင်း မရှိပါ။');
    const body = await response.json();
    const user = Array.isArray(body.users) ? body.users[0] : null;
    if (!user) authenticated('Cashier အကောင့် မတွေ့ပါ။');
    const validSince = Number(user.validSince || 0);
    cache.set(identity.uid, { validSince, expiresAt: now() + cacheTtlMs });
    if (validSince > identity.authTime) authenticated('Cashier Login ကို ပြန်လည် ဝင်ရောက်ရန် လိုအပ်ပါတယ်။');
  };
}
