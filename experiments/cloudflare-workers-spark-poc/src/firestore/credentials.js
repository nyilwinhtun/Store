// Credentials for Firestore REST.
//
// Production mode uses a Google service-account JSON held only in a Cloudflare
// Worker secret (`FIRESTORE_SERVICE_ACCOUNT`). It must never be shipped in the
// APK, committed to Git, written to logs, or pasted into chat. An OAuth access
// token is minted locally with RS256 and cached for up to one hour.

import { defaultFetch } from '../fetch.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/identitytoolkit',
];

export class CredentialConfigError extends Error {}

function base64UrlEncode(bytes) {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let index = 0; index < view.length; index += 1) binary += String.fromCharCode(view[index]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeText(text) {
  return base64UrlEncode(new TextEncoder().encode(text));
}

function pemToArrayBuffer(pem) {
  const body = String(pem)
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  if (!body) throw new CredentialConfigError('Service account private key မမှန်ပါ။');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function signRs256(privateKeyPem, signingInput) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return base64UrlEncode(signature);
}

export function createEmulatorCredential() {
  return { async getAuthorizationHeader() { return 'Bearer owner'; } };
}

export function createServiceAccountCredential(serviceAccount, { fetchImpl = defaultFetch, now = () => Date.now() } = {}) {
  if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new CredentialConfigError('FIRESTORE_SERVICE_ACCOUNT Secret မမှန်ကန်ပါ။');
  }
  let cachedToken = '';
  let cachedUntil = 0;
  let inFlight = null;

  async function mint() {
    const issuedAt = Math.floor(now() / 1000);
    const header = base64UrlEncodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64UrlEncodeText(JSON.stringify({
      iss: serviceAccount.client_email,
      scope: SCOPES.join(' '),
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }));
    const assertion = `${header}.${claims}.${await signRs256(serviceAccount.private_key, `${header}.${claims}`)}`;
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(assertion)}`,
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (!response.ok || !parsed || typeof parsed.access_token !== 'string') {
      throw new CredentialConfigError(`Service account access token မရနိုင်ပါ (HTTP ${response.status})။`);
    }
    cachedToken = parsed.access_token;
    cachedUntil = now() + Math.max(60, Number(parsed.expires_in || 3600) - 300) * 1000;
    return cachedToken;
  }

  return {
    async getAuthorizationHeader() {
      if (cachedToken && now() < cachedUntil) return `Bearer ${cachedToken}`;
      if (!inFlight) {
        inFlight = mint().finally(() => { inFlight = null; });
      }
      return `Bearer ${await inFlight}`;
    },
  };
}

export function createCredentialFromEnv(env, options = {}, expectedProjectId = '') {
  if (env.FIRESTORE_EMULATOR_HOST) return createEmulatorCredential();
  if (!env.FIRESTORE_SERVICE_ACCOUNT) {
    throw new CredentialConfigError('FIRESTORE_SERVICE_ACCOUNT Secret မသတ်မှတ်ရသေးပါ။');
  }
  let parsed;
  try {
    parsed = JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT);
  } catch {
    throw new CredentialConfigError('FIRESTORE_SERVICE_ACCOUNT JSON ကို ဖတ်မရပါ။');
  }
  // A key from another project would only fail later with an opaque IAM 403.
  // Refuse it up front so a Production key can never be attached to Staging.
  if (expectedProjectId && parsed.project_id !== expectedProjectId) {
    throw new CredentialConfigError('Service account သည် ဤ Firebase project အတွက် မဟုတ်ပါ။');
  }
  return createServiceAccountCredential(parsed, options);
}
