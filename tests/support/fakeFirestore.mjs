/** Minimal in-memory Firestore double for exercising transactional apply logic.
 * Records live on the database object so tests and the esbuild-bundled module
 * under test share the same store even when the module is inlined twice.
 */

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function createFakeFirestore() {
  return { records: new Map() };
}

export function doc(db, ...segments) {
  if (!db || !(db.records instanceof Map)) throw new Error('fake firestore: invalid db handle');
  return { type: 'document', db, path: segments.join('/'), id: segments[segments.length - 1] };
}

export function readRecord(db, path) {
  return clone(db.records.get(path));
}

function setAtPath(target, dotted, value) {
  const parts = dotted.split('.');
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function applyPatch(base, patch) {
  const next = clone(base);
  for (const [key, value] of Object.entries(patch)) setAtPath(next, key, clone(value));
  return next;
}

function readStaged(db, path, staged) {
  const pending = staged.get(path);
  if (!pending) return clone(db.records.get(path));
  if (pending.mode === 'set') return clone(pending.data);
  const committed = db.records.get(path);
  if (committed === undefined) return undefined;
  return applyPatch(committed, pending.data);
}

/** Runs the callback against staged writes; commits only when it resolves. */
export async function runTransaction(db, callback) {
  const staged = new Map();
  const transaction = {
    async get(ref) {
      const data = readStaged(db, ref.path, staged);
      const exists = data !== undefined;
      return {
        id: ref.id,
        ref,
        exists: () => exists,
        data: () => (exists ? clone(data) : undefined),
      };
    },
    set(ref, data) {
      staged.set(ref.path, { mode: 'set', data: clone(data) });
    },
    update(ref, data) {
      const pending = staged.get(ref.path);
      const basePatch = pending && pending.mode === 'update' ? pending.data : {};
      if (!db.records.has(ref.path) && !pending) {
        throw new Error(`fake firestore: update of missing document ${ref.path}`);
      }
      staged.set(ref.path, { mode: 'update', data: { ...basePatch, ...clone(data) } });
    },
  };

  const result = await callback(transaction);
  for (const [path, pending] of staged) {
    if (pending.mode === 'set') {
      db.records.set(path, clone(pending.data));
      continue;
    }
    const committed = db.records.get(path);
    db.records.set(path, applyPatch(committed ?? {}, pending.data));
  }
  return result;
}
