import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PRODUCTION_PROJECT_ID = 'minimart-production';

export function resolveFirestoreTarget(project, options = {}) {
  const emulatorHost = options.emulatorHost || process.env.FIRESTORE_EMULATOR_HOST || '';
  const baseUrl = emulatorHost
    ? `http://${emulatorHost}/v1/projects/${project}/databases/(default)/documents`
    : `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  return { baseUrl, mode: emulatorHost ? 'emulator' : 'project' };
}

export function assertTargetAllowed(project, { allowProduction = false, serviceAccount = '', mode }) {
  if (project === PRODUCTION_PROJECT_ID && !allowProduction) {
    throw new Error('Refusing to touch minimart-production without --allow-production and explicit Owner authorization.');
  }
  if (mode === 'project' && !serviceAccount) {
    throw new Error('A service account JSON is required for a real Firebase project (--service-account).');
  }
}

export async function fetchAccessToken(serviceAccountPath) {
  const account = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  if (!account.client_email || !account.private_key) {
    throw new Error('Service account JSON is missing client_email or private_key.');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = toBase64Url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: account.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  const signature = signer.sign(account.private_key).toString('base64url');
  const response = await fetch(account.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`Service account token exchange failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Service account token exchange returned no access token.');
  return payload.access_token;
}

export async function firestoreFetch(baseUrl, path, token, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || response.statusText;
    throw new Error(`Firestore HTTP ${response.status}: ${String(message).slice(0, 300)}`);
  }
  return body || {};
}

export function encodeDocumentPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}
