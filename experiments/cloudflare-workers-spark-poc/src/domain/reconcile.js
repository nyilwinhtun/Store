import { denied, failed, invalid } from '../errors.js';
import {
  assertReservationLedgerCovers, isExpiredAt, ledgerAfterConsumption, payloadOf,
  remainingOfAllowance, reservationLedgerOf,
} from './allowance.js';
import { asRecord, str } from './sale.js';

const RECONCILE_FIELDS = new Set(['branchId', 'allowanceId', 'action']);

/**
 * Owner-only release of an expired reservation. Nothing is released while the
 * allowance is still active; stock stays reserved until this explicit review.
 */
export async function reconcileAllowance({ fs, businessId, identity, body, serverNow }) {
  const record = asRecord(body);
  if (!record) invalid('Reconcile Request မမှန်ကန်ပါ။');
  for (const key of Object.keys(record)) {
    if (!RECONCILE_FIELDS.has(key)) invalid(`Reconcile Request တွင် ခွင့်မပြုထားသော Field ပါဝင်နေပါတယ်: ${key}`);
  }
  const branchId = str(record.branchId).trim();
  const allowanceId = str(record.allowanceId).trim();
  if (!branchId || !allowanceId || str(record.action) !== 'release') {
    invalid('Branch / Allowance / Release Action မမှန်ကန်ပါ။');
  }
  const businessPath = `businesses/${businessId}`;
  const branchPath = `${businessPath}/branches/${branchId}`;
  const allowancePath = `${branchPath}/offlineAllowances/${allowanceId}`;
  const ledgerPath = `${branchPath}/meta/offlineStockReservations`;
  const auditPath = `${branchPath}/auditEvents/${allowanceId}__reconciled`;
  const now = serverNow.toISOString();

  const transaction = await fs.beginTransaction();
  try {
    const base = await fs.batchGet([businessPath, branchPath, allowancePath, ledgerPath, auditPath], transaction);
    const business = base.get(businessPath)?.data || {};
    if (!business || business.active === false || str(business.ownerUid) !== identity.uid) {
      denied('Offline Reservation ကို ပြန်လွှတ်ရန် Owner ခွင့်မရှိပါ။');
    }
    if (!base.get(branchPath)) failed('Branch မတွေ့ပါ။');
    const allowanceDoc = base.get(allowancePath);
    const allowance = payloadOf(allowanceDoc);
    if (!allowanceDoc || allowanceDoc.data.deleted === true || allowanceDoc.data.kind !== 'offlineAllowances'
      || allowanceDoc.data.branchId !== branchId || !allowance || str(allowance.id) !== allowanceId) {
      failed('Offline Stock Allowance မတွေ့ပါ။');
    }
    if (allowance.status === 'reconciled') {
      await fs.rollback(transaction);
      return { result: 'already-reconciled', writeCount: 0 };
    }
    if (allowance.status === 'active' && !isExpiredAt(allowance.expiresAt, serverNow)) {
      failed('Offline Stock Allowance သက်တမ်းမကုန်သေးသဖြင့် Reservation ကို မလွှတ်နိုင်ပါ။');
    }
    if (!['active', 'expired-hold', 'consumed'].includes(allowance.status)) {
      failed('Offline Stock Allowance အခြေအနေကို ပြန်လွှတ်၍ မရပါ။');
    }
    const ledger = reservationLedgerOf(base.get(ledgerPath));
    const remaining = remainingOfAllowance(allowance);
    if (allowance.status !== 'consumed') assertReservationLedgerCovers(ledger, remaining);
    const nextLedger = ledgerAfterConsumption(ledger, { productDeltas: remaining.byProduct, batchDeltas: remaining.byBatch });

    const writes = [
      {
        path: allowancePath,
        data: {
          updatedAt: now,
          updatedBy: identity.uid,
          payload: {
            remaining: [],
            status: 'reconciled',
            reconciledAt: now,
            reconciledBy: identity.uid,
            updatedAt: now,
            updatedBy: identity.uid,
          },
        },
        mask: [
          'payload.remaining', 'payload.status', 'payload.reconciledAt', 'payload.reconciledBy',
          'payload.updatedAt', 'payload.updatedBy', 'updatedAt', 'updatedBy',
        ],
      },
      {
        path: ledgerPath,
        data: {
          updatedAt: now,
          updatedBy: identity.uid,
          payload: {
            byProduct: nextLedger.byProduct,
            byBatch: nextLedger.byBatch,
            updatedAt: now,
            updatedBy: identity.uid,
          },
        },
        mask: ['payload.byProduct', 'payload.byBatch', 'payload.updatedAt', 'payload.updatedBy', 'updatedAt', 'updatedBy'],
      },
      {
        path: auditPath,
        data: {
          id: `${allowanceId}__reconciled`, eventType: 'OFFLINE_ALLOWANCE_RECONCILED', branchId,
          allowanceId, actorUid: identity.uid, occurredAt: now,
          releasedItems: remaining.items,
          previousStatus: allowance.status,
        },
      },
    ];
    await fs.commit(transaction, writes);
    return { result: 'released', writeCount: writes.length, releasedItems: remaining.items };
  } catch (error) {
    await fs.rollback(transaction);
    throw error;
  }
}
