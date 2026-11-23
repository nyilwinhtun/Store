import { decodeFields, encodeFields } from './values.js';
import { defaultFetch } from '../fetch.js';

export class FirestoreHttpError extends Error {
  constructor(status, payload) {
    const detail = payload && typeof payload === 'object' && payload.error ? payload.error : {};
    super(detail.message || `Firestore request failed with HTTP ${status}`);
    this.name = 'FirestoreHttpError';
    this.status = status;
    this.reason = detail.status || '';
  }
}

export function isAbortError(error) {
  return error instanceof FirestoreHttpError && (error.reason === 'ABORTED' || error.status === 409);
}

function chunk(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

/**
 * Minimal Firestore REST v1 adapter. Only the operations this transaction needs
 * are implemented: begin, batchGet, runQuery, commit and rollback.
 */
export class FirestoreRest {
  constructor({ projectId, host, credential, fetchImpl = defaultFetch, metrics = {} }) {
    this.projectId = projectId;
    this.host = (host || 'https://firestore.googleapis.com').replace(/\/$/, '');
    this.credential = credential;
    this.fetchImpl = fetchImpl;
    this.metrics = { reads: 0, writes: 0, requests: 0, bytesIn: 0, bytesOut: 0, ...metrics };
  }

  get baseUrl() {
    return `${this.host}/v1/projects/${encodeURIComponent(this.projectId)}/databases/(default)/documents`;
  }

  docName(path) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `projects/${this.projectId}/databases/(default)/documents/${encoded}`;
  }

  relativeName(fullName) {
    return decodeURIComponent(String(fullName).split('/documents/')[1] || '');
  }

  async sendAt(url, body) {
    this.metrics.requests += 1;
    const authorization = await this.credential.getAuthorizationHeader();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload) this.metrics.bytesOut += payload.length;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: payload,
    });
    const text = await response.text();
    this.metrics.bytesIn += text.length;
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = null; }
    }
    if (!response.ok) throw new FirestoreHttpError(response.status, parsed);
    return parsed;
  }

  async send(suffix, body) {
    return this.sendAt(`${this.baseUrl}:${suffix}`, body);
  }

  async beginTransaction() {
    const result = await this.send('beginTransaction', { options: { readWrite: {} } });
    if (!result || typeof result.transaction !== 'string') throw new Error('Firestore transaction ID မရရှိပါ။');
    return result.transaction;
  }

  async rollback(transaction) {
    try { await this.send('rollback', { transaction }); } catch { /* rollback is best effort */ }
  }

  async batchGet(paths, transaction) {
    const found = new Map();
    if (!paths.length) return found;
    for (const group of chunk(paths, 100)) {
      const body = { documents: group.map((path) => this.docName(path)) };
      if (transaction) body.transaction = transaction;
      const results = await this.send('batchGet', body) || [];
      for (const entry of results) {
        if (entry.found) {
          const path = this.relativeName(entry.found.name);
          found.set(path, { path, data: decodeFields(entry.found.fields || {}) });
        } else if (entry.missing) {
          found.set(this.relativeName(entry.missing), null);
        }
      }
      this.metrics.reads += group.length;
    }
    return found;
  }

  async runQuery(collectionPath, filter, transaction) {
    const segments = collectionPath.split('/');
    const collectionId = segments.pop();
    const parentPath = segments.join('/');
    const body = {
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath: filter.fieldPath },
            op: filter.op,
            value: filter.op === 'IN'
              ? { arrayValue: { values: filter.values.map((value) => ({ stringValue: value })) } }
              : { stringValue: filter.values[0] },
          },
        },
        ...(filter.limit ? { limit: filter.limit } : {}),
      },
    };
    if (transaction) body.transaction = transaction;
    const parentUrl = parentPath
      ? `${this.baseUrl}/${parentPath.split('/').map(encodeURIComponent).join('/')}:runQuery`
      : `${this.baseUrl}:runQuery`;
    const results = await this.sendAt(parentUrl, body) || [];
    const docs = [];
    for (const entry of results) {
      if (!entry.document) continue;
      docs.push({ path: this.relativeName(entry.document.name), data: decodeFields(entry.document.fields || {}) });
    }
    this.metrics.reads += docs.length;
    return docs;
  }

  async commit(transaction, writes) {
    const body = {
      transaction,
      writes: writes.map((write) => {
        const update = { name: this.docName(write.path), fields: encodeFields(write.data) };
        const payload = { update };
        if (write.mask && write.mask.length) payload.updateMask = { fieldPaths: write.mask };
        return payload;
      }),
    };
    const result = await this.send('commit', body);
    this.metrics.writes += writes.length;
    return result;
  }
}
