/**
 * v3.1.1 finance contracts for Cashier Expense Reporting and Cashier
 * Cash/KPay Settlement. Branch payment-account management remains a later phase.
 */

export type FinancePaymentMethod = 'cash' | 'kpay';

export type CashierExpenseFundingSource =
  | 'cashier-personal'
  | 'branch-cash'
  | 'branch-kpay';

/** Legacy approval values are retained only so older saved records remain readable.
 * New Cashier expenses are reports of spending already made and never wait for approval.
 */
export type CashierExpenseApprovalStatus =
  | 'not-required'
  | 'pending'
  | 'approved'
  | 'rejected';

export type CashierExpenseReviewStatus = 'submitted' | 'reviewed';

/** Optional, backward-compatible fields for the existing branch-scoped Expense record. */
export interface CashierExpenseFields {
  /** Firebase Auth UID of the Cashier who submitted/owns this expense. */
  createdByUid?: string;
  createdByEmail?: string;
  createdByName?: string;
  createdByRole?: 'owner' | 'cashier';
  /** Who funded the expense; separate from the method used to reimburse the Cashier. */
  fundedBy?: CashierExpenseFundingSource;
  /** How the expense itself was paid. */
  paymentMethod?: FinancePaymentMethod;
  /** Legacy field; new expense submissions always use not-required. */
  approvalStatus?: CashierExpenseApprovalStatus;
  /** Owner acknowledgement only. It never blocks the Cashier from spending. */
  reviewStatus?: CashierExpenseReviewStatus;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedByUid?: string;
  reviewedByName?: string;
  /** Set when this personal expense has been reimbursed in full. */
  reimbursedBySettlementId?: string;
  approvedAt?: string;
  approvedByUid?: string;
  approvedByName?: string;
  rejectedAt?: string;
  rejectedByUid?: string;
  rejectionReason?: string;
  receiptImageRef?: string;
  updatedAt?: string;
  updatedByUid?: string;
}

export type CashierSettlementStatus = 'paid' | 'voided';

export type CashierSettlementPurpose = 'expense_reimbursement' | 'cash_advance' | 'salary' | 'other';

/**
 * Cash/KPay money paid by the Owner to a specific Cashier.
 * A settlement is recorded only after the Owner has actually paid the Cashier.
 */
export interface CashierSettlementRecord {
  id: string;
  branchId: string;
  cashierUid: string;
  cashierName: string;
  purpose: CashierSettlementPurpose;
  amount: number;
  paymentMethod: FinancePaymentMethod;
  status: CashierSettlementStatus;
  receiverAccountName?: string;
  receiverAccountNumber?: string;
  senderAccountName?: string;
  senderAccountNumber?: string;
  relatedExpenseId?: string;
  transactionReference?: string;
  receiptImageRef?: string;
  note?: string;
  /** Device-local sync diagnostics; stripped before writing to Firestore. */
  cloudSyncStatus?: 'pending' | 'synced';
  cloudSyncError?: string;
  createdAt: string;
  createdByUid: string;
  paidAt?: string;
  paidByUid?: string;
  paidByName?: string;
  voidedAt?: string;
  voidedByUid?: string;
  voidReason?: string;
}

export type CashierSettlementCreateInput = Pick<CashierSettlementRecord,
  | 'cashierUid' | 'cashierName' | 'purpose' | 'amount' | 'paymentMethod'
  | 'receiverAccountName' | 'receiverAccountNumber' | 'senderAccountName'
  | 'senderAccountNumber' | 'relatedExpenseId' | 'transactionReference' | 'note'
>;

/** Branch-owned KPay account for payments received by that branch. */
export interface BranchPaymentAccount {
  id: string;
  branchId: string;
  provider: 'kpay';
  accountName: string;
  accountNumber: string;
  label?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  updatedByUid: string;
}

/** Owner-managed per-Cashier expense policy. The threshold unit needs confirmation. */
export interface CashierExpensePolicy {
  cashierUid: string;
  branchId: string;
  enabled: boolean;
  /** Leave undefined until Owner selects per-transaction or period-based rules. */
  maxPerTransaction?: number;
  dailyLimit?: number;
  weeklyLimit?: number;
  monthlyLimit?: number;
  updatedAt: string;
  updatedByUid: string;
}

/** FCM payload contract; shipment data remains the source of truth in Firestore. */
export interface BranchShipmentPushPayload {
  type: 'branch-stock-shipment';
  event: 'dispatched' | 'received' | 'approved';
  businessId: string;
  branchId: string;
  shipmentId: string;
}
