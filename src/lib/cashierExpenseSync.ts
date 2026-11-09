import { doc, runTransaction } from 'firebase/firestore';
import { firebaseAuth, firestore, FIREBASE_BUSINESS_ID } from './firebase';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import { usePosStore, type Expense } from '../store/usePosStore';

function expenseDocument(branchId: string, expenseId: string) {
  return doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', branchId, 'expenses', expenseId);
}

function cloudSafeExpense(expense: Expense): Record<string, unknown> {
  const { cloudSyncStatus: _cloudSyncStatus, cloudSyncError: _cloudSyncError, ...payload } = expense;
  return payload;
}

export type ExpenseCloudSyncResult = {
  reviewStatus: 'submitted' | 'reviewed';
  approvalStatus: 'pending' | 'not-required' | 'approved' | 'rejected';
  reviewedAt?: string;
  reviewedByUid?: string;
  reviewedByName?: string;
};

/** Create a Cashier expense record or approval request. Expenses above the
 * configured branch threshold are stored as pending until an Owner approves.
 * One document read is used for idempotency.
 */
export async function submitCashierExpenseToCloud(expense: Expense, uid: string, branchId: string): Promise<ExpenseCloudSyncResult> {
  if (!firestore || !firebaseAuth?.currentUser || firebaseAuth.currentUser.uid !== uid) {
    throw new Error('Cashier Firebase Session မမှန်ပါ။ ပြန်ဝင်ပြီး Sync လုပ်ပါ။');
  }
  if (!navigator.onLine) throw new Error('Internet မရှိသေးပါ။ Expense ကို ဒီ Device မှာ စောင့်သိမ်းထားပါတယ်။');
  if (expense.branchId !== branchId || expense.createdByUid !== uid || expense.id.trim() === '') {
    throw new Error('Expense ပိုင်ရှင် သို့မဟုတ် Branch အချက်အလက် မကိုက်ညီပါ။');
  }

  const ref = expenseDocument(branchId, expense.id);
  const now = new Date().toISOString();
  const result = await runTransaction(firestore, async (transaction): Promise<ExpenseCloudSyncResult> => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) {
      const existingDocument = snapshot.data();
      const existing = existingDocument.payload as Record<string, unknown> | undefined;
      if (existingDocument.kind === 'expenses'
        && existing?.id === expense.id
        && existing?.createdByUid === uid
        && existing?.date === expense.date
        && existing?.amount === expense.amount) {
        return {
          reviewStatus: existing.reviewStatus === 'reviewed' ? 'reviewed' : 'submitted',
          approvalStatus: existing.approvalStatus === 'pending' || existing.approvalStatus === 'approved' || existing.approvalStatus === 'rejected' ? existing.approvalStatus : 'not-required',
          ...(typeof existing.reviewedAt === 'string' ? { reviewedAt: existing.reviewedAt } : {}),
          ...(typeof existing.reviewedByUid === 'string' ? { reviewedByUid: existing.reviewedByUid } : {}),
          ...(typeof existing.reviewedByName === 'string' ? { reviewedByName: existing.reviewedByName } : {}),
        };
      }
      throw new Error('Expense ID ထပ်နေပါတယ်။ Data ကို မပြောင်းဘဲ ရပ်ထားပါတယ်။');
    }

    const payload = cloudSafeExpense({
      ...expense,
      approvalStatus: expense.approvalStatus === 'pending' ? 'pending' : 'not-required',
      reviewStatus: 'submitted',
      submittedAt: expense.submittedAt || now,
      updatedAt: now,
      updatedByUid: uid,
    });
    transaction.set(ref, {
      scope: 'branchRecord', kind: 'expenses', branchId, deleted: false,
      updatedAt: now, updatedBy: uid, payload,
    });
    return { reviewStatus: 'submitted', approvalStatus: expense.approvalStatus === 'pending' ? 'pending' : 'not-required' };
  });
  recordFirestoreActivity(uid, 'read', 'cashier-expense-idempotency-check', 1);
  recordFirestoreActivity(uid, 'write', 'cashier-expense-submit-report', 1);
  return result;
}

let flushPromise: Promise<{ synced: number; failed: number }> | null = null;
/** Flush local Cashier expense reports after the own-expense server listener is ready. */
export function flushPendingCashierExpenses(uid: string, branchId: string): Promise<{ synced: number; failed: number }> {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    let synced = 0;
    let failed = 0;
    if (!navigator.onLine || !firebaseAuth?.currentUser || firebaseAuth.currentUser.uid !== uid) return { synced, failed };
    const pending = usePosStore.getState().expenses.filter((expense) =>
      expense.branchId === branchId && expense.createdByUid === uid && expense.cloudSyncStatus === 'pending'
    );
    for (const expense of pending) {
      try {
        const result = await submitCashierExpenseToCloud(expense, uid, branchId);
        usePosStore.getState().updateExpense(expense.id, {
          approvalStatus: result.approvalStatus,
          reviewStatus: result.reviewStatus,
          ...(result.reviewedAt ? { reviewedAt: result.reviewedAt } : {}),
          ...(result.reviewedByUid ? { reviewedByUid: result.reviewedByUid } : {}),
          ...(result.reviewedByName ? { reviewedByName: result.reviewedByName } : {}),
          cloudSyncStatus: 'synced', cloudSyncError: undefined,
        });
        synced += 1;
      } catch (error) {
        usePosStore.getState().updateExpense(expense.id, {
          cloudSyncStatus: 'pending',
          cloudSyncError: error instanceof Error ? error.message : 'Cloud Sync မအောင်မြင်ပါ။',
        });
        failed += 1;
        break;
      }
    }
    return { synced, failed };
  })().finally(() => { flushPromise = null; });
  return flushPromise;
}
