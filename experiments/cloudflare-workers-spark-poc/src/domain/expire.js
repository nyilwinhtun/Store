import { isExpiredAt, payloadOf } from './allowance.js';

async function markOne({ fs, path, kind, statusField, serverNow }) {
  const transaction = await fs.beginTransaction();
  try {
    const docs = await fs.batchGet([path], transaction);
    const doc = docs.get(path);
    const payload = payloadOf(doc);
    if (!doc || doc.data.deleted === true || !payload || payload.status !== 'active'
      || !isExpiredAt(payload.expiresAt, serverNow)) {
      await fs.rollback(transaction);
      return false;
    }
    const now = serverNow.toISOString();
    await fs.commit(transaction, [{
      path,
      data: {
        updatedAt: now,
        updatedBy: 'system-expiry',
        payload: { status: statusField, expiredAt: now, updatedAt: now, updatedBy: 'system-expiry' },
      },
      mask: ['payload.status', 'payload.expiredAt', 'payload.updatedAt', 'payload.updatedBy', 'updatedAt', 'updatedBy'],
    }]);
    return true;
  } catch (error) {
    await fs.rollback(transaction);
    throw error;
  }
}

/**
 * Lazy/scheduled expiry transition. It never touches the reservation ledger, so
 * expired stock stays held until an explicit Owner reconciliation.
 */
export async function expireStalePolicies({ fs, businessId, serverNow }) {
  const businesses = `businesses/${businessId}`;
  const branches = await fs.runQuery(`${businesses}/branches`, {
    fieldPath: 'payload.status',
    op: 'IN',
    values: ['active', 'inactive'],
  });
  let allowancesExpired = 0;
  let leasesExpired = 0;
  for (const branch of branches) {
    const branchPath = branch.path;
    const activeAllowances = await fs.runQuery(`${branchPath}/offlineAllowances`, {
      fieldPath: 'payload.status',
      op: 'EQUAL',
      values: ['active'],
    });
    for (const allowance of activeAllowances) {
      if (await markOne({ fs, path: allowance.path, kind: 'offlineAllowances', statusField: 'expired-hold', serverNow })) {
        allowancesExpired += 1;
      }
    }
    const activeLeases = await fs.runQuery(`${branchPath}/authorizationLeases`, {
      fieldPath: 'payload.status',
      op: 'EQUAL',
      values: ['active'],
    });
    for (const lease of activeLeases) {
      if (await markOne({ fs, path: lease.path, kind: 'authorizationLeases', statusField: 'expired', serverNow })) {
        leasesExpired += 1;
      }
    }
  }
  return { allowancesExpired, leasesExpired };
}
