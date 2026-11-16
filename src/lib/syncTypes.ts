/** Shared types for the Owner device sync engine and its durable manifest. */

export type BranchRecordKind = 'categories' | 'products' | 'sales' | 'expenses' | 'cashierSettlements' | 'heldItems' | 'customerPayments' | 'purchases' | 'supplierPayments' | 'purchaseReturns' | 'stockBatches' | 'stockReceipts' | 'stockTransfers' | 'stockShipments' | 'stockUnitRegistries' | 'cashShifts' | 'cashMovements' | 'activityLogs' | 'branchFinanceLedgerEntries' | 'cashierAdvanceReconciliations' | 'branchFinanceReconciliations';
export type SharedRecordKind = 'customers' | 'suppliers';
export type SyncScope = 'branch' | 'branchRecord' | 'shared' | 'meta';
export type SyncKind = BranchRecordKind | SharedRecordKind | 'branches' | 'settings';
export type SyncItem = { key: string; scope: SyncScope; kind: SyncKind; id: string; branchId?: string; payload: unknown; deleted?: boolean };
export type ManifestEntry = { scope: SyncScope; kind: SyncKind; id: string; branchId?: string; hash: string };
export type SyncManifest = { version: 2; businessId: string; savedAt: string; records: Record<string, ManifestEntry> };
export type CloudRead = { items: Map<string, SyncItem>; unavailableSharedKinds: SharedRecordKind[] };

export const branchRecordKinds: BranchRecordKind[] = ['categories', 'products', 'sales', 'expenses', 'cashierSettlements', 'heldItems', 'customerPayments', 'purchases', 'supplierPayments', 'purchaseReturns', 'stockBatches', 'stockReceipts', 'stockTransfers', 'stockShipments', 'stockUnitRegistries', 'cashShifts', 'cashMovements', 'activityLogs', 'branchFinanceLedgerEntries', 'cashierAdvanceReconciliations', 'branchFinanceReconciliations'];
export const sharedRecordKinds: SharedRecordKind[] = ['customers', 'suppliers'];
