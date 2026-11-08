/** Finance data contracts for Cashier Expense Reporting, Settlement, and Branch cashbook. */

export type FinancePaymentMethod = 'cash' | 'kpay';

export type CashierExpenseFundingSource = 'cashier-personal' | 'branch-cash' | 'branch-kpay';

/** Legacy values remain readable. New cashier expenses are reporting-only and never require approval. */
export type CashierExpenseApprovalStatus = 'not-required' | 'pending' | 'approved' | 'rejected';
export type CashierExpenseReviewStatus = 'submitted' | 'reviewed';

export interface CashierExpenseFields {
  createdByUid?: string;
  createdByEmail?: string;
  createdByName?: string;
  createdByRole?: 'owner' | 'cashier';
  fundedBy?: CashierExpenseFundingSource;
  paymentMethod?: FinancePaymentMethod;
  approvalStatus?: CashierExpenseApprovalStatus;
  reviewStatus?: CashierExpenseReviewStatus;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedByUid?: string;
  reviewedByName?: string;
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

/** Branch-owned KPay account is stored inside the Branch Settings document. */
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

export type CashierExpenseReviewPolicy = {
  cashierUid: string;
  branchId: string;
  enabled: boolean;
  maxPerTransaction?: number;
  dailyLimit?: number;
  weeklyLimit?: number;
  monthlyLimit?: number;
  updatedAt: string;
  updatedByUid: string;
};

export type BranchShipmentPushPayload = {
  type: 'branch-stock-shipment';
  event: 'dispatched' | 'received' | 'approved';
  businessId: string;
  branchId: string;
  shipmentId: string;
};

export type BranchFinanceChannel = 'cash' | 'kpay';
export type BranchFinanceDirection = 'in' | 'out';
export type BranchFinanceCategory = 'manual' | 'cashier-settlement' | 'expense' | 'sale' | 'credit-collection' | 'supplier-payment' | 'advance-return' | 'other';

/** Owner-entered non-POS cashbook entry. Other activity is derived from source records to avoid double-counting. */
export interface BranchFinanceLedgerEntry {
  id: string;
  branchId: string;
  channel: BranchFinanceChannel;
  direction: BranchFinanceDirection;
  category: BranchFinanceCategory;
  amount: number;
  date: string;
  note: string;
  transactionReference?: string;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

export type CashierAdvanceReconciliationKind = 'expense-applied' | 'cash-returned';

export interface CashierAdvanceReconciliationRecord {
  id: string;
  branchId: string;
  advanceSettlementId: string;
  cashierUid: string;
  cashierName: string;
  kind: CashierAdvanceReconciliationKind;
  amount: number;
  channel: BranchFinanceChannel;
  relatedExpenseId?: string;
  transactionReference?: string;
  note: string;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

export type BranchFinanceLedgerEntryInput = Pick<BranchFinanceLedgerEntry,
  'channel' | 'direction' | 'category' | 'amount' | 'note' | 'transactionReference'
> & { createdByUid: string; createdByName: string };

export type CashierAdvanceReconciliationInput = Pick<CashierAdvanceReconciliationRecord,
  'advanceSettlementId' | 'kind' | 'amount' | 'channel' | 'relatedExpenseId' | 'transactionReference' | 'note'
> & { createdByUid: string; createdByName: string };

export interface BranchFinanceReconciliationRecord {
  id: string;
  branchId: string;
  businessDate: string;
  channel: BranchFinanceChannel;
  expectedBalance: number;
  actualBalance: number;
  variance: number;
  totalIn: number;
  totalOut: number;
  note: string;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

export type BranchFinanceReconciliationInput = Pick<BranchFinanceReconciliationRecord,
  'businessDate' | 'channel' | 'expectedBalance' | 'actualBalance' | 'totalIn' | 'totalOut' | 'note'
> & { createdByUid: string; createdByName: string };
