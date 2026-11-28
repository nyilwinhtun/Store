import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { cleanQuantity, formatQuantity, inferQuantityMode, isValidQuantity, quantityModeForProduct, summarizeQuantities, type QuantityMode } from '../lib/quantity';
import { normalizeBarcode } from '../lib/barcode';
import { persistentStateStorage, writePosStateDurably } from '../lib/persistentStateStorage';
import type { BranchFinanceLedgerEntry, BranchFinanceLedgerEntryInput, BranchFinanceReconciliationInput, BranchFinanceReconciliationRecord, CashierAdvanceReconciliationInput, CashierAdvanceReconciliationRecord, CashierExpenseFields, CashierSettlementRecord } from '../types/finance';

/** Stable Zustand persistence key; also used by durable checkout flush. */
const POS_PERSIST_STORAGE_KEY = 'minimart-pos-data-v1';

export type PriceMode = 'retail' | 'wholesale';
export const DEFAULT_CASHIER_EXPENSE_APPROVAL_LIMIT = 50000;
export type BranchSettings = { storeName: string; currency: string; receiptFooter: string; receiptHeader?: string; kpayAccountName?: string; kpayAccountNumber?: string; kpayAccountLabel?: string; cashLedgerOpeningBalance?: number; kpayLedgerOpeningBalance?: number; financeLedgerStartDate?: string; /** Per-expense threshold above which a Cashier must obtain Owner approval before spending branch funds. */ cashierExpenseApprovalLimit?: number };
export type Branch = { id: string; name: string; code: string; address: string; phone: string; ownerName?: string; email?: string; logoUrl?: string; bannerUrl?: string; status: 'active' | 'archived'; isDefault: boolean; createdAt: string; updatedAt: string; settings: BranchSettings };
export type OwnerProfile = { displayName: string; phone: string; photoUrl: string; updatedAt?: string };
export type Category = { id: string; branchId: string; name: string; color: string; isActive: boolean; createdAt: string };
export const DEFAULT_BRANCH_ID = 'branch-main';
export const DEFAULT_CATEGORY_NAMES = ['အထွေထွေ', 'အစားအသောက်', 'အဖျော်ယမကာ', 'အိမ်သုံးပစ္စည်း', 'ကိုယ်ရေးကိုယ်တာ', 'အခြား'];
export type BatchAllocation = { batchId: string; quantity: number };
export type StockUnitStatus = 'in_stock' | 'reserved' | 'in_transit' | 'pending_approval' | 'sold' | 'damaged' | 'missing' | 'returned' | 'written_off';
export type StockUnitBarcodeSource = 'manufacturer_serial' | 'app_generated' | 'purchased_sticker';
export type StockUnit = {
  id: string;
  barcode: string;
  barcodeSource: StockUnitBarcodeSource;
  status: StockUnitStatus;
  registeredAt: string;
  registeredByUid?: string;
  registeredByName?: string;
  batchId?: string;
  note?: string;
};
/** Chunked registry records per Product + Branch; each record stores up to 250 physical units. */
export type StockUnitRegistry = {
  id: string;
  branchId: string;
  productId: string;
  /** Stable chunk number; keeps Firestore registry documents well below the 1 MiB document limit. */
  chunkIndex?: number;
  units: StockUnit[];
  updatedAt: string;
  updatedByUid?: string;
};
export type StockUnitRegistrationInput = {
  branchId?: string;
  productId: string;
  units: Array<{ barcode: string; barcodeSource: StockUnitBarcodeSource; note?: string }>;
  actorUid?: string;
  actorName?: string;
};
export type StockUnitRegistrationResult = { ok: true; created: number; remainingUnregistered: number } | { ok: false; message: string };
export type Product = {
  branchId?: string;
  /** Explicit owner-approved shared retail/wholesale price link. */
  priceGroupId?: string;
  priceVersion?: number;
  id: string;
  name: string;
  sku: string;
  /** Optional retail barcode; old products without this field remain valid. */
  barcode?: string;
  category: string;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  stock: number;
  lowStockAt: number;
  unit: string;
  quantityMode?: QuantityMode;
  image?: string;
  createdAt: string;
};

export type SharedPriceGroup = {
  id: string;
  name: string;
  retailPrice: number;
  wholesalePrice: number;
  currency: string;
  version: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  updatedByUid?: string;
  /** Branch ID -> Product ID membership map; one Product per Branch. */
  membersByBranch: Record<string, string>;
};
export type SharedPriceProductRef = { branchId: string; productId: string };

export type CartItem = {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  mode: PriceMode;
  stockAtAdd: number;
  /** Snapshot the sale unit so old receipts remain accurate if the catalog is edited later. */
  unit?: string;
  quantityMode?: QuantityMode;
  batchAllocations?: BatchAllocation[];
  /** Shared price metadata snapshot for audit; historical unitPrice remains authoritative. */
  priceGroupId?: string;
  priceVersion?: number;
};
export type Sale = {
  branchId?: string;
  id: string;
  receiptNo: string;
  date: string;
  customer: string;
  customerId?: string;
  paymentMethod: 'Cash' | 'KPay' | 'Credit';
  /** Cash physically handed over by the customer; optional for older sales. */
  cashReceivedAmount?: number;
  /** KPay provider receipt/reference entered after the transfer is completed. */
  kpayTransactionReference?: string;
  /** Change returned to the customer; optional for older sales. */
  changeAmount?: number;
  paidAmount?: number;
  dueAmount?: number;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  profit: number;
  status: 'completed' | 'voided';
  voidRequested?: boolean;
  voidRequestReason?: string;
  voidRequestedAt?: string;
  voidRequestedByUid?: string;
  voidRequestedByName?: string;
  voidReason?: string;
  voidedAt?: string;
  voidedByUid?: string;
  voidedByEmail?: string;
  voidedByName?: string;
  createdByUid?: string;
  createdByEmail?: string;
  createdByName?: string;
  /** Customer snapshot used to safely create a shared customer during a Cashier credit sale. */
  customerSnapshot?: Customer;
  /** Local-only Cloud queue state; deliberately removed from Firestore Sale payloads. */
  cloudSyncStatus?: 'pending' | 'synced';
  cloudSyncError?: string;
};
export type Expense = CashierExpenseFields & {
  branchId?: string;
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  note: string;
  /** Local queue state; excluded from Firestore payload. */
  cloudSyncStatus?: 'pending' | 'synced';
  cloudSyncError?: string;
};
export type HeldItem = CartItem & { heldAt: string; branchId?: string };
export type Customer = {
  id: string;
  name: string;
  phone: string;
  address: string;
  note: string;
  createdAt: string;
};
export type Supplier = {
  id: string;
  name: string;
  phone: string;
  address: string;
  note: string;
  createdAt: string;
};
export type CustomerPayment = {
  branchId?: string;
  id: string;
  customerId: string;
  saleId: string;
  amount: number;
  date: string;
  note: string;
  paymentMethod?: 'Cash' | 'Transfer';
};
export type Purchase = {
  branchId?: string;
  id: string;
  receiptNo: string;
  date: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  total: number;
  expiryDate: string;
  note: string;
  paymentTracking?: 'tracked' | 'legacy-untracked';
};
export type SupplierPayment = {
  branchId?: string;
  id: string;
  supplierId: string;
  purchaseId: string;
  amount: number;
  date: string;
  paymentMethod: 'Cash' | 'Transfer';
  note: string;
};
export type PurchaseReturn = {
  branchId?: string;
  id: string;
  supplierId: string;
  purchaseId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  total: number;
  date: string;
  note: string;
};
export type StockBatch = {
  branchId?: string;
  id: string;
  productId: string;
  purchaseId: string;
  supplierId: string;
  stockReceiptId?: string;
  /** Server-audited link for branch shipment Auto Complete batches. */
  sourceShipmentId?: string;
  sourceShipmentLineIndex?: number;
  sourceShipmentBatchIndex?: number;
  quantity: number;
  receivedAt: string;
  expiryDate: string;
  unitCost: number;
};
export type StockReceiptLine = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  barcode?: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  retailPrice?: number;
  wholesalePrice?: number;
  expiryDate: string;
  unit?: string;
};
export type StockReceipt = {
  branchId: string;
  id: string;
  receiptNo: string;
  date: string;
  supplierId?: string;
  supplierName: string;
  referenceNo: string;
  note: string;
  items: StockReceiptLine[];
  totalQuantity: number;
  totalCost: number;
};
export type StockReceiptDraftItem = {
  productId?: string;
  /** Optional manual selling-price updates for an existing product during receiving. */
  retailPrice?: number;
  wholesalePrice?: number;
  newProduct?: {
    name: string;
    sku: string;
    category: string;
    retailPrice: number;
    wholesalePrice: number;
    lowStockAt: number;
    unit: string;
    quantityMode?: QuantityMode;
  };
  quantity: number;
  unitCost: number;
  expiryDate?: string;
};
export type StockReceiptDraft = {
  supplierId?: string;
  referenceNo?: string;
  note?: string;
  receivedDate?: string;
  items: StockReceiptDraftItem[];
};
export type QuickGoodsArrivalItem = { name: string; quantity: number; unit?: string; barcode?: string };
export type StockTransferBatchAllocation = {
  sourceBatchId: string;
  destinationBatchId: string;
  quantity: number;
  unitCost: number;
  expiryDate: string;
  sourceBatchReceivedAt?: string;
  sourceBatchPurchaseId?: string;
  sourceBatchSupplierId?: string;
};
export type StockTransferLine = {
  sourceProductId: string;
  destinationProductId: string;
  productName: string;
  quantity: number;
  unit: string;
  transferredUnitCost: number;
  batchAllocations: StockTransferBatchAllocation[];
  /** Auditable product balances captured when the local transfer commits. */
  sourceStockBefore?: number;
  sourceStockAfter?: number;
  destinationStockBefore?: number;
  destinationStockAfter?: number;
  destinationCostPriceBefore?: number;
  sourceStockAfterReversal?: number;
  destinationStockAfterReversal?: number;
};
export type StockTransferCommitResult = {
  id: string;
  transferNo: string;
  fromBranchId: string;
  toBranchId: string;
  items: StockTransferLine[];
};
export type StockTransfer = {
  id: string;
  transferNo: string;
  requestId?: string;
  date: string;
  fromBranchId: string;
  toBranchId: string;
  fromBranchName?: string;
  toBranchName?: string;
  initiatedByUid?: string;
  initiatedByEmail?: string;
  initiatedByName?: string;
  items: StockTransferLine[];
  totalQuantity: number;
  note: string;
  status: 'completed' | 'reversed';
  reversedAt?: string;
  reversedByUid?: string;
  reversedByEmail?: string;
  reversedByName?: string;
  reversalNote?: string;
};
export type StockTransferActor = { uid?: string; email?: string; name?: string };
export type StockTransferReversalResult = { ok: true; transferId: string; transferNo: string } | { ok: false; reason: 'not-found' | 'already-reversed' | 'invalid-transfer' | 'source-product-missing' | 'destination-product-missing' | 'destination-stock-insufficient' | 'transferred-batch-missing' | 'transferred-batch-insufficient' | 'batch-reconciliation-failed' | 'state-changed' };
export type StockTransferDraftItem = { sourceProductId: string; quantity: number };
export type ShipmentBatchAllocation = {
  sourceBatchId: string;
  quantity: number;
  unitCost: number;
  expiryDate: string;
  receivedAt: string;
  purchaseId?: string;
  supplierId?: string;
};
export type BranchShipmentItem = {
  sourceProductId: string;
  productName: string;
  sku: string;
  barcode?: string;
  category: string;
  quantity: number;
  unit: string;
  quantityMode?: QuantityMode;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  lowStockAt: number;
  sourceStockBefore: number;
  sourceStockAfter: number;
  batchAllocations: ShipmentBatchAllocation[];
  receivedQuantity?: number;
  damagedQuantity?: number;
  acceptedQuantity?: number;
  receiverNote?: string;
};
export type BranchShipmentAutoCompletionPlan = {
  destinationProductId: string;
  destinationStockBefore: number;
  destinationStockAfter: number;
  destinationBatchIds: string[];
};
export type BranchStockShipment = {
  id: string;
  /** Stored under the destination branch's stockShipments collection. */
  branchId: string;
  shipmentNo: string;
  requestId?: string;
  date: string;
  fromBranchId: string;
  toBranchId: string;
  fromBranchName: string;
  toBranchName: string;
  dispatchedByUid?: string;
  dispatchedByEmail?: string;
  dispatchedByName?: string;
  items: BranchShipmentItem[];
  totalQuantity: number;
  note: string;
  status: 'dispatched' | 'received' | 'approved' | 'cancelled';
  completionMode?: 'owner' | 'auto';
  autoCompletedByUid?: string;
  autoCompletionPlan?: BranchShipmentAutoCompletionPlan[];
  receivedItems?: Array<{ sourceProductId: string; receivedQuantity: number; damagedQuantity: number; note?: string }>;
  receivedAt?: string;
  receivedByUid?: string;
  receivedByEmail?: string;
  receivedByName?: string;
  receiverNote?: string;
  approvedAt?: string;
  approvedByUid?: string;
  approvedByEmail?: string;
  approvedByName?: string;
  approvalNote?: string;
  cancelledAt?: string;
  cancelledByUid?: string;
  cancelledByEmail?: string;
  cancelledByName?: string;
  cancellationNote?: string;
};
export type BranchShipmentDraftItem = { sourceProductId: string; quantity: number };
export type BranchShipmentDispatchResult = { ok: true; shipment: BranchStockShipment } | { ok: false; reason: string };
export type BranchShipmentReceiptInput = { sourceProductId: string; receivedQuantity: number; damagedQuantity: number; note?: string };
export type CashShift = {
  branchId?: string;
  id: string;
  openedAt: string;
  openedBy: string;
  openedByUid?: string;
  openingCash: number;
  closedAt?: string;
  closedByUid?: string;
  closedByName?: string;
  closingCash?: number;
  expectedCash?: number;
  variance?: number;
  note?: string;
};
export type CashMovement = {
  branchId?: string;
  sourceSettlementId?: string;
  createdByUid?: string;
  createdByName?: string;
  id: string;
  shiftId: string;
  date: string;
  direction: 'in' | 'out';
  amount: number;
  note: string;
};
export type ActivityLog = {
  branchId?: string;
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId?: string;
  description: string;
  actorUid?: string;
  actorEmail?: string;
};
export type StoreSettings = {
  storeName: string;
  currency: string;
  adminPin: string;
  receiptFooter: string;
  maxCashierDiscountPercent?: number;
};

type PosState = {
  branches: Branch[];
  activeBranchId: string;
  categories: Category[];
  products: Product[];
  priceGroups: SharedPriceGroup[];
  sales: Sale[];
  expenses: Expense[];
  cashierSettlements: CashierSettlementRecord[];
  branchFinanceLedgerEntries: BranchFinanceLedgerEntry[];
  cashierAdvanceReconciliations: CashierAdvanceReconciliationRecord[];
  branchFinanceReconciliations: BranchFinanceReconciliationRecord[];
  heldItems: HeldItem[];
  customers: Customer[];
  suppliers: Supplier[];
  customerPayments: CustomerPayment[];
  purchases: Purchase[];
  supplierPayments: SupplierPayment[];
  purchaseReturns: PurchaseReturn[];
  stockBatches: StockBatch[];
  stockReceipts: StockReceipt[];
  stockTransfers: StockTransfer[];
  stockShipments: BranchStockShipment[];
  stockUnitRegistries: StockUnitRegistry[];
  cashShifts: CashShift[];
  cashMovements: CashMovement[];
  activityLogs: ActivityLog[];
  ownerProfile: OwnerProfile;
  settings: StoreSettings;
  addBranch: (input: { name: string; address?: string; phone?: string }) => string | null;
  updateBranch: (id: string, changes: Partial<Pick<Branch, 'name' | 'address' | 'phone' | 'ownerName' | 'email' | 'logoUrl' | 'bannerUrl'>> & { settings?: Partial<BranchSettings> }) => void;
  archiveBranch: (id: string) => boolean;
  restoreBranch: (id: string) => boolean;
  setActiveBranch: (id: string) => void;
  addCategory: (name: string, color?: string) => boolean;
  updateCategory: (id: string, name: string, color?: string) => void;
  archiveCategory: (id: string) => void;
  restoreCategory: (id: string) => boolean;
  addProduct: (product: Omit<Product, 'id' | 'createdAt' | 'priceGroupId' | 'priceVersion'>) => boolean;
  createSharedPriceGroup: (input: { name: string; retailPrice: number; wholesalePrice: number; products: SharedPriceProductRef[]; actorUid?: string }) => string | null;
  updateSharedPriceGroup: (id: string, changes: { name?: string; retailPrice: number; wholesalePrice: number; actorUid?: string }) => boolean;
  attachProductsToSharedPriceGroup: (id: string, products: SharedPriceProductRef[], actorUid?: string) => boolean;
  unlinkProductFromSharedPriceGroup: (branchId: string, productId: string, actorUid?: string) => boolean;
  updateProduct: (id: string, changes: Partial<Omit<Product, 'id' | 'createdAt' | 'priceGroupId' | 'priceVersion'>>) => void;
  deleteProduct: (id: string) => boolean;
  adjustStock: (id: string, quantity: number) => boolean;
  addSale: (sale: Sale) => Sale | null;
  updateSaleCloudSyncStatus: (id: string, branchId: string, status: 'pending' | 'synced', error?: string) => void;
  voidSale: (id: string, reason: string, actor: { uid: string; email: string; name: string }, voidedAt?: string) => boolean;
  requestSaleVoid: (id: string, reason: string, actor: { uid: string; name: string }) => boolean;
  addExpense: (expense: Omit<Expense, 'id'> & { id?: string }) => Expense;
  updateExpense: (id: string, changes: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;
  addCashierSettlement: (input: Omit<CashierSettlementRecord, 'id' | 'createdAt' | 'paidAt' | 'status'> & { createdAt?: string }) => CashierSettlementRecord | null;
  addBranchFinanceLedgerEntry: (input: BranchFinanceLedgerEntryInput) => BranchFinanceLedgerEntry | null;
  addCashierAdvanceReconciliation: (input: CashierAdvanceReconciliationInput) => CashierAdvanceReconciliationRecord | null;
  addBranchFinanceReconciliations: (inputs: BranchFinanceReconciliationInput[]) => BranchFinanceReconciliationRecord[] | null;
  addCustomer: (customer: Omit<Customer, 'id' | 'createdAt'>) => string | null;
  updateCustomer: (id: string, changes: Partial<Omit<Customer, 'id' | 'createdAt'>>) => boolean;
  deleteCustomer: (id: string) => void;
  addCustomerPayment: (payment: Omit<CustomerPayment, 'id'>) => boolean;
  addSupplier: (supplier: Omit<Supplier, 'id' | 'createdAt'>) => string | null;
  updateSupplier: (id: string, changes: Partial<Omit<Supplier, 'id' | 'createdAt'>>) => boolean;
  deleteSupplier: (id: string) => void;
  addPurchase: (purchase: Omit<Purchase, 'id' | 'receiptNo' | 'date' | 'total' | 'paymentTracking'> & { initialPaidAmount?: number; paymentMethod?: 'Cash' | 'Transfer' }) => void;
  addStockReceipt: (input: StockReceiptDraft) => string | null;
  addQuickGoodsArrival: (input: { receivedDate?: string; note?: string; items: QuickGoodsArrivalItem[] }) => string | null;
  transferStock: (input: { fromBranchId?: string; toBranchId: string; items: StockTransferDraftItem[]; note?: string; requestId?: string; actor?: StockTransferActor }) => StockTransferCommitResult | null;
  reverseStockTransfer: (input: { transferId: string; actor?: StockTransferActor; note: string }) => StockTransferReversalResult;
  dispatchBranchStockShipment: (input: { fromBranchId?: string; toBranchId: string; items: BranchShipmentDraftItem[]; note?: string; requestId?: string; actor?: StockTransferActor }) => BranchShipmentDispatchResult;
  confirmBranchStockShipmentReceipt: (input: { shipmentId: string; receivedItems: BranchShipmentReceiptInput[]; actor?: StockTransferActor; note?: string }) => boolean;
  approveBranchStockShipment: (input: { shipmentId: string; actor?: StockTransferActor; note?: string; autoComplete?: boolean }) => boolean;
  registerStockUnits: (input: StockUnitRegistrationInput) => StockUnitRegistrationResult;
  cancelBranchStockShipment: (input: { shipmentId: string; actor?: StockTransferActor; note: string }) => boolean;
  addSupplierPayment: (payment: Omit<SupplierPayment, 'id'>) => boolean;
  addPurchaseReturn: (purchaseId: string, quantity: number, note: string) => void;
  openCashShift: (openingCash: number, note?: string, actor?: { uid?: string; name?: string }) => void;
  closeCashShift: (id: string, closingCash: number, expectedCash: number, note?: string, actor?: { uid?: string; name?: string }) => void;
  addCashMovement: (movement: Omit<CashMovement, 'id' | 'date'>) => void;
  addActivityLog: (entry: Omit<ActivityLog, 'id' | 'at'>) => void;
  holdItem: (item: CartItem) => void;
  restoreHeldItem: (productId: string) => HeldItem | undefined;
  removeHeldItem: (productId: string) => void;
  updateSettings: (changes: Partial<StoreSettings>) => void;
  updateOwnerProfile: (changes: Partial<OwnerProfile>) => void;
  importData: (data: Partial<Pick<PosState, 'branches' | 'activeBranchId' | 'categories' | 'products' | 'priceGroups' | 'sales' | 'expenses' | 'cashierSettlements' | 'branchFinanceLedgerEntries' | 'cashierAdvanceReconciliations' | 'branchFinanceReconciliations' | 'heldItems' | 'customers' | 'suppliers' | 'customerPayments' | 'purchases' | 'supplierPayments' | 'purchaseReturns' | 'stockBatches' | 'stockReceipts' | 'stockTransfers' | 'stockShipments' | 'stockUnitRegistries' | 'cashShifts' | 'cashMovements' | 'activityLogs' | 'ownerProfile' | 'settings'>>) => void;
  clearAllData: () => void;
};

function isKPayReferenceUsed(
  state: Pick<PosState, 'sales' | 'cashierSettlements' | 'branchFinanceLedgerEntries' | 'cashierAdvanceReconciliations'>,
  branchId: string,
  reference: string,
): boolean {
  const key = reference.trim().toLocaleLowerCase();
  if (!key) return false;
  return state.sales.some((entry) => entry.branchId === branchId && entry.paymentMethod === 'KPay' && entry.kpayTransactionReference?.trim().toLocaleLowerCase() === key)
    || state.cashierSettlements.some((entry) => entry.branchId === branchId && entry.paymentMethod === 'kpay' && entry.transactionReference?.trim().toLocaleLowerCase() === key)
    || state.branchFinanceLedgerEntries.some((entry) => entry.branchId === branchId && entry.channel === 'kpay' && entry.transactionReference?.trim().toLocaleLowerCase() === key)
    || state.cashierAdvanceReconciliations.some((entry) => entry.branchId === branchId && entry.channel === 'kpay' && entry.transactionReference?.trim().toLocaleLowerCase() === key);
}

const defaultSettings: StoreSettings = {
  storeName: 'My Minimart',
  currency: 'MMK',
  adminPin: '1234',
  receiptFooter: 'Thank you. Please come again!',
  maxCashierDiscountPercent: 10,
};
const defaultOwnerProfile: OwnerProfile = { displayName: '', phone: '', photoUrl: '' };

/** Normalize profile data from older LocalStorage, backups, or Cloud Sync before UI reads it. */
export function normalizeOwnerProfile(value: unknown): OwnerProfile {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    displayName: typeof source.displayName === 'string' ? source.displayName : '',
    phone: typeof source.phone === 'string' ? source.phone : '',
    photoUrl: typeof source.photoUrl === 'string' ? source.photoUrl : '',
    ...(typeof source.updatedAt === 'string' ? { updatedAt: source.updatedAt } : {}),
  };
}
const newId = () => crypto.randomUUID();
const epsilonForQuantity = () => 0.000001;
const makeDefaultBranch = (settings: StoreSettings = defaultSettings): Branch => ({ id: DEFAULT_BRANCH_ID, name: settings.storeName || 'Main Store', code: 'MAIN', address: '', phone: '', bannerUrl: '', status: 'active', isDefault: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), settings: { storeName: settings.storeName || 'Main Store', currency: settings.currency || 'MMK', receiptFooter: settings.receiptFooter || defaultSettings.receiptFooter, receiptHeader: '', cashLedgerOpeningBalance: 0, kpayLedgerOpeningBalance: 0, cashierExpenseApprovalLimit: DEFAULT_CASHIER_EXPENSE_APPROVAL_LIMIT } });
const makeDefaultCategories = (branchId: string, names: string[] = DEFAULT_CATEGORY_NAMES): Category[] => names.map((name, index) => ({ id: `${branchId}-cat-${index + 1}`, branchId, name, color: ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#64748b'][index % 6], isActive: true, createdAt: new Date().toISOString() }));
const normalizedName = (value: string) => (value || '').trim().toLocaleLowerCase();
const normalizedPhone = (value: string) => {
  const digits = (value || '').replace(/[^0-9]/g, '');
  // Treat common Myanmar local (09...) and international (+959...) formats as the same number.
  if (digits.startsWith('959') && digits.length >= 10) return `0${digits.slice(2)}`;
  if (digits.startsWith('95') && digits.length >= 10) return `0${digits.slice(2)}`;
  return digits;
};
const isDuplicateSharedProfile = <T extends { name: string; phone: string; address: string }>(records: T[], candidate: { name: string; phone: string; address: string }, excludeId?: string) => {
  const candidatePhone = normalizedPhone(candidate.phone);
  return records.find((record) => {
    if ((record as T & { id?: string }).id === excludeId) return false;
    const recordPhone = normalizedPhone(record.phone);
    if (candidatePhone && recordPhone) return candidatePhone === recordPhone;
    return normalizedName(record.name) === normalizedName(candidate.name) && normalizedName(record.address) === normalizedName(candidate.address);
  });
};
const makeAudit = (action: string, entity: string, description: string, entityId?: string, branchId = DEFAULT_BRANCH_ID): ActivityLog => ({
  id: newId(), branchId, at: new Date().toISOString(), actor: 'Local device user', action, entity, entityId, description,
});
const prependAudit = (logs: ActivityLog[], entry: ActivityLog) => [entry, ...logs].slice(0, 300);

function removeBatchQuantity(batches: StockBatch[], productId: string, quantity: number, mode: QuantityMode = 'decimal'): StockBatch[] {
  let remaining = Math.max(0, quantity);
  const updated = batches.map((batch) => ({ ...batch }));
  const candidates = updated
    .filter((batch) => batch.productId === productId && batch.quantity > 0)
    .sort((a, b) => (a.expiryDate || '9999-12-31').localeCompare(b.expiryDate || '9999-12-31'));
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const target = updated.find((batch) => batch.id === candidate.id);
    if (!target) continue;
    const take = Math.min(target.quantity, remaining);
    target.quantity = cleanQuantity(target.quantity - take, mode);
    remaining -= take;
  }
  return updated;
}

function ensureStockBatchCoverage(products: Product[], batches: StockBatch[]): StockBatch[] {
  const result = [...batches];
  for (const product of products) {
    const covered = result
      .filter((batch) => batch.branchId === product.branchId && batch.productId === product.id)
      .reduce((sum, batch) => sum + Math.max(0, batch.quantity), 0);
    const missing = Math.max(0, product.stock - covered);
    if (missing > 0.000001) {
      result.push({
        id: `opening-${product.branchId || DEFAULT_BRANCH_ID}-${product.id}`,
        branchId: product.branchId || DEFAULT_BRANCH_ID,
        productId: product.id,
        purchaseId: '',
        supplierId: '',
        quantity: missing,
        receivedAt: product.createdAt || new Date().toISOString(),
        expiryDate: '',
        unitCost: product.costPrice,
      });
    }
  }
  return result;
}

function migrateState(persisted: unknown, version: number): Partial<PosState> {
  const old = (persisted && typeof persisted === 'object' ? persisted : {}) as Record<string, unknown>;
  const oldSettings = old.settings && typeof old.settings === 'object' ? { ...defaultSettings, ...(old.settings as Partial<StoreSettings>) } : defaultSettings;
  const oldBranches = Array.isArray(old.branches) ? (old.branches as Branch[]) : [];
  const branches = oldBranches.length ? oldBranches : [makeDefaultBranch(oldSettings)];
  const defaultBranch = branches.find((branch) => branch.isDefault) || branches[0] || makeDefaultBranch(oldSettings);
  const activeBranchId = typeof old.activeBranchId === 'string' && branches.some((branch) => branch.id === old.activeBranchId && branch.status === 'active') ? old.activeBranchId : defaultBranch.id;
  const branchId = (record: { branchId?: string }) => record.branchId || defaultBranch.id;
  const withBranch = <T extends { branchId?: string }>(items: unknown): T[] => Array.isArray(items) ? (items as T[]).map((item) => ({ ...item, branchId: branchId(item) })) : [];
  const sales = withBranch<Sale>(old.sales).map((sale) => ({ ...sale }));
  let customers = Array.isArray(old.customers) ? [...(old.customers as Customer[])] : [];

  if (version < 2) {
    const customerIds = new Map(customers.map((customer) => [normalizedName(customer.name), customer.id]));
    for (const sale of sales) {
      if (sale.paymentMethod !== 'Credit') {
        sale.paidAmount ??= sale.total;
        sale.dueAmount ??= 0;
        continue;
      }
      const key = normalizedName(sale.customer || 'အမည်မသိ Customer');
      let customerId = sale.customerId || customerIds.get(key);
      if (!customerId) {
        customerId = `legacy-${newId()}`;
        customers.push({ id: customerId, name: sale.customer || 'အမည်မသိ Customer', phone: '', address: '', note: 'ယခင် Credit Sale မှ အလိုအလျောက် ဖန်တီးထားသည်။', createdAt: sale.date });
        customerIds.set(key, customerId);
      }
      sale.customerId = customerId;
      sale.paidAmount ??= 0;
      sale.dueAmount ??= Math.max(0, sale.total - (sale.paidAmount || 0));
    }
  }

  const products = withBranch<Product>(old.products).map((product) => ({ ...product, quantityMode: product.quantityMode || inferQuantityMode(product.unit) }));
  const stockBatches = ensureStockBatchCoverage(products, withBranch<StockBatch>(old.stockBatches));
  const existingCategories = Array.isArray(old.categories) ? (old.categories as Category[]).map((category, index) => ({ ...category, branchId: category.branchId || defaultBranch.id, color: category.color || ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#64748b'][index % 6], isActive: category.isActive !== false, createdAt: category.createdAt || new Date().toISOString() })) : [];
  const productCategoryNames = [...new Set(products.map((product) => product.category).filter(Boolean))];
  const categories = existingCategories.length ? existingCategories : makeDefaultCategories(defaultBranch.id, [...new Set([...DEFAULT_CATEGORY_NAMES, ...productCategoryNames])]);
  const ownerProfile = normalizeOwnerProfile(old.ownerProfile);
  const settings = { ...oldSettings, storeName: branches.find((branch) => branch.id === activeBranchId)?.settings?.storeName || oldSettings.storeName, currency: branches.find((branch) => branch.id === activeBranchId)?.settings?.currency || oldSettings.currency, receiptFooter: branches.find((branch) => branch.id === activeBranchId)?.settings?.receiptFooter || oldSettings.receiptFooter };

  return {
    branches: branches.map((branch) => ({ ...makeDefaultBranch(oldSettings), ...branch, settings: { ...makeDefaultBranch(oldSettings).settings, ...(branch.settings || {}) }, ownerName: branch.ownerName || '', email: branch.email || '', logoUrl: branch.logoUrl || '', bannerUrl: branch.bannerUrl || '' })),
    activeBranchId,
    categories,
    products,
    priceGroups: Array.isArray(old.priceGroups) ? (old.priceGroups as SharedPriceGroup[]).map((group) => {
      const derivedMembers = Object.fromEntries(products.filter((product) => product.priceGroupId === group.id && product.branchId).map((product) => [product.branchId as string, product.id]));
      return { ...group, membersByBranch: group.membersByBranch && typeof group.membersByBranch === 'object' ? group.membersByBranch : derivedMembers };
    }) : [],
    sales,
    expenses: withBranch<Expense>(old.expenses),
    cashierSettlements: withBranch<CashierSettlementRecord>(old.cashierSettlements),
    branchFinanceLedgerEntries: withBranch<BranchFinanceLedgerEntry>(old.branchFinanceLedgerEntries),
    cashierAdvanceReconciliations: withBranch<CashierAdvanceReconciliationRecord>(old.cashierAdvanceReconciliations),
    branchFinanceReconciliations: withBranch<BranchFinanceReconciliationRecord>(old.branchFinanceReconciliations),
    heldItems: withBranch<HeldItem>(old.heldItems),
    customers,
    suppliers: Array.isArray(old.suppliers) ? old.suppliers as Supplier[] : [],
    customerPayments: withBranch<CustomerPayment>(old.customerPayments),
    purchases: withBranch<Purchase>(old.purchases).map((purchase) => ({ ...purchase, paymentTracking: purchase.paymentTracking || 'legacy-untracked' })),
    supplierPayments: withBranch<SupplierPayment>(old.supplierPayments),
    purchaseReturns: withBranch<PurchaseReturn>(old.purchaseReturns),
    stockBatches,
    stockReceipts: withBranch<StockReceipt>(old.stockReceipts),
    stockTransfers: Array.isArray(old.stockTransfers) ? old.stockTransfers as StockTransfer[] : [],
    stockShipments: Array.isArray(old.stockShipments) ? old.stockShipments as BranchStockShipment[] : [],
    stockUnitRegistries: Array.isArray(old.stockUnitRegistries) ? old.stockUnitRegistries as StockUnitRegistry[] : [],
    cashShifts: withBranch<CashShift>(old.cashShifts),
    cashMovements: withBranch<CashMovement>(old.cashMovements),
    activityLogs: withBranch<ActivityLog>(old.activityLogs),
    ownerProfile,
    settings,
  };
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      branches: [makeDefaultBranch()], activeBranchId: DEFAULT_BRANCH_ID, categories: makeDefaultCategories(DEFAULT_BRANCH_ID),
      products: [], priceGroups: [], sales: [], expenses: [], cashierSettlements: [], branchFinanceLedgerEntries: [], cashierAdvanceReconciliations: [], branchFinanceReconciliations: [], heldItems: [], customers: [], suppliers: [],
      customerPayments: [], purchases: [], supplierPayments: [], purchaseReturns: [], stockBatches: [], stockReceipts: [], stockTransfers: [], stockShipments: [], stockUnitRegistries: [], cashShifts: [], cashMovements: [], activityLogs: [], ownerProfile: defaultOwnerProfile, settings: defaultSettings,
      addBranch: (input) => {
        const name = input.name.trim();
        if (!name) return null;
        const current = get();
        if (current.branches.some((branch) => branch.status === 'active' && normalizedName(branch.name) === normalizedName(name))) return null;
        const id = newId();
        const now = new Date().toISOString();
        const branch: Branch = {
          id, name, code: `BR-${String(current.branches.length + 1).padStart(2, '0')}`,
          address: (input.address || '').trim(), phone: (input.phone || '').trim(), ownerName: '', email: '', logoUrl: '', bannerUrl: '', status: 'active', isDefault: false,
          createdAt: now, updatedAt: now,
          settings: { storeName: name, currency: current.settings.currency, receiptFooter: current.settings.receiptFooter, receiptHeader: '', cashLedgerOpeningBalance: 0, kpayLedgerOpeningBalance: 0, cashierExpenseApprovalLimit: DEFAULT_CASHIER_EXPENSE_APPROVAL_LIMIT },
        };
        set((state) => ({ branches: [...state.branches, branch], categories: [...state.categories, ...makeDefaultCategories(id)], activityLogs: prependAudit(state.activityLogs, makeAudit('BRANCH_CREATE', 'Branch', `ဆိုင်ခွဲအသစ် ဖန်တီးသည်: ${name}`, id, state.activeBranchId)) }));
        return id;
      },
      updateBranch: (id, changes) => set((state) => {
        const target = state.branches.find((branch) => branch.id === id);
        if (!target) return state;
        const name = typeof changes.name === 'string' ? changes.name.trim() : target.name;
        if (!name || state.branches.some((branch) => branch.id !== id && branch.status === 'active' && normalizedName(branch.name) === normalizedName(name))) return state;
        const nextBranchSettings = { ...target.settings, ...(changes.settings || {}), storeName: name };
        const updated: Branch = { ...target, ...changes, name, updatedAt: new Date().toISOString(), settings: nextBranchSettings };
        const activeSettings = state.activeBranchId === id ? { ...state.settings, storeName: name, currency: nextBranchSettings.currency || state.settings.currency, receiptFooter: nextBranchSettings.receiptFooter || state.settings.receiptFooter } : state.settings;
        return { branches: state.branches.map((branch) => branch.id === id ? updated : branch), settings: activeSettings, activityLogs: prependAudit(state.activityLogs, makeAudit('BRANCH_PROFILE_UPDATE', 'Branch', `ဆိုင်အချက်အလက် ပြင်ဆင်သည်: ${name}`, id, id)) };
      }),
      archiveBranch: (id) => {
        const state = get();
        const target = state.branches.find((branch) => branch.id === id);
        if (!target || target.isDefault || target.status === 'archived' || id === state.activeBranchId) return false;
        if (state.branches.filter((branch) => branch.status === 'active').length <= 1) return false;
        set((current) => ({ branches: current.branches.map((branch) => branch.id === id ? { ...branch, status: 'archived', updatedAt: new Date().toISOString() } : branch), activityLogs: prependAudit(current.activityLogs, makeAudit('BRANCH_ARCHIVE', 'Branch', `ဆိုင်ခွဲကို Archive လုပ်သည်: ${target.name}`, id, current.activeBranchId)) }));
        return true;
      },
      restoreBranch: (id) => {
        const state = get();
        const target = state.branches.find((branch) => branch.id === id);
        if (!target || target.status !== 'archived' || state.branches.some((branch) => branch.id !== id && branch.status === 'active' && normalizedName(branch.name) === normalizedName(target.name))) return false;
        set((current) => ({ branches: current.branches.map((branch) => branch.id === id ? { ...branch, status: 'active', updatedAt: new Date().toISOString() } : branch), activityLogs: prependAudit(current.activityLogs, makeAudit('BRANCH_RESTORE', 'Branch', `ဆိုင်ခွဲကို ပြန်ဖွင့်သည်: ${target.name}`, id, current.activeBranchId)) }));
        return true;
      },
      setActiveBranch: (id) => set((state) => {
        const branch = state.branches.find((entry) => entry.id === id && entry.status === 'active');
        if (!branch || branch.id === state.activeBranchId) return state;
        return { activeBranchId: id, settings: { ...state.settings, storeName: branch.settings.storeName || branch.name, currency: branch.settings.currency || 'MMK', receiptFooter: branch.settings.receiptFooter || defaultSettings.receiptFooter } };
      }),
      addCategory: (name, color = '#0f766e') => {
        const trimmed = name.trim();
        const state = get();
        if (!trimmed || state.categories.some((category) => category.branchId === state.activeBranchId && category.isActive && normalizedName(category.name) === normalizedName(trimmed))) return false;
        set((current) => ({ categories: [...current.categories, { id: newId(), branchId: current.activeBranchId, name: trimmed, color, isActive: true, createdAt: new Date().toISOString() }], activityLogs: prependAudit(current.activityLogs, makeAudit('CATEGORY_CREATE', 'Category', `Category အသစ် ထည့်သည်: ${trimmed}`, undefined, current.activeBranchId)) }));
        return true;
      },
      updateCategory: (id, name, color) => set((state) => {
        const target = state.categories.find((category) => category.id === id && category.branchId === state.activeBranchId);
        const trimmed = name.trim();
        if (!target || !trimmed || state.categories.some((category) => category.id !== id && category.branchId === state.activeBranchId && category.isActive && normalizedName(category.name) === normalizedName(trimmed))) return state;
        return {
          categories: state.categories.map((category) => category.id === id ? { ...category, name: trimmed, color: color || category.color } : category),
          products: state.products.map((product) => product.branchId === state.activeBranchId && product.category === target.name ? { ...product, category: trimmed } : product),
          activityLogs: prependAudit(state.activityLogs, makeAudit('CATEGORY_UPDATE', 'Category', `Category ပြင်ဆင်သည်: ${trimmed}`, id, state.activeBranchId)),
        };
      }),
      archiveCategory: (id) => set((state) => {
        const target = state.categories.find((category) => category.id === id && category.branchId === state.activeBranchId);
        if (!target || state.products.some((product) => product.branchId === state.activeBranchId && product.category === target.name)) return state;
        return { categories: state.categories.map((category) => category.id === id ? { ...category, isActive: false } : category), activityLogs: prependAudit(state.activityLogs, makeAudit('CATEGORY_ARCHIVE', 'Category', `Category ကို ပိတ်ထားသည်: ${target.name}`, id, state.activeBranchId)) };
      }),
      restoreCategory: (id) => {
        const state = get();
        const target = state.categories.find((category) => category.id === id && category.branchId === state.activeBranchId);
        if (!target || target.isActive || state.categories.some((category) => category.id !== id && category.branchId === state.activeBranchId && category.isActive && normalizedName(category.name) === normalizedName(target.name))) return false;
        set((current) => ({ categories: current.categories.map((category) => category.id === id ? { ...category, isActive: true } : category), activityLogs: prependAudit(current.activityLogs, makeAudit('CATEGORY_RESTORE', 'Category', `Category ပြန်ဖွင့်သည်: ${target.name}`, id, current.activeBranchId)) }));
        return true;
      },
      addProduct: (product) => {
        const state = get();
        const skuKey = normalizeBarcode(product.sku);
        const barcodeKey = normalizeBarcode(product.barcode);
        if (state.products.some((entry) => {
          if (entry.branchId !== state.activeBranchId) return false;
          const existingSku = normalizeBarcode(entry.sku);
          const existingBarcode = normalizeBarcode(entry.barcode);
          // SKU and barcode share the same lookup namespace within a branch.
          return (!!skuKey && (existingSku === skuKey || existingBarcode === skuKey))
            || (!!barcodeKey && (existingSku === barcodeKey || existingBarcode === barcodeKey));
        })) return false;
        const createdAt = new Date().toISOString();
        const saved: Product = { ...product, priceGroupId: undefined, priceVersion: undefined, quantityMode: product.quantityMode || inferQuantityMode(product.unit), branchId: state.activeBranchId, id: newId(), createdAt };
        if (!isValidQuantity(saved.stock, quantityModeForProduct(saved), true) || !isValidQuantity(saved.lowStockAt, quantityModeForProduct(saved), true)) return false;
        const openingBatch: StockBatch | null = saved.stock > 0 ? {
          id: newId(), branchId: state.activeBranchId, productId: saved.id, purchaseId: '', supplierId: '',
          quantity: saved.stock, receivedAt: createdAt, expiryDate: '', unitCost: saved.costPrice,
        } : null;
        set((current) => ({
          products: [...current.products, saved],
          stockBatches: openingBatch ? [openingBatch, ...current.stockBatches] : current.stockBatches,
          activityLogs: prependAudit(current.activityLogs, makeAudit('CREATE', 'Product', `ပစ္စည်းအသစ် ထည့်သည်: ${saved.name}`, saved.id, state.activeBranchId)),
        }));
        return true;
      },
      createSharedPriceGroup: (input) => {
        const state = get();
        const name = input.name.trim();
        const retailPrice = Number(input.retailPrice);
        const wholesalePrice = Number(input.wholesalePrice);
        const refs = Array.from(new Map(input.products.map((ref) => [`${ref.branchId}::${ref.productId}`, ref])).values());
        const branchIds = new Set(refs.map((ref) => ref.branchId));
        if (!name || !Number.isFinite(retailPrice) || retailPrice <= 0 || !Number.isFinite(wholesalePrice) || wholesalePrice < 0 || refs.length < 2 || branchIds.size < 2 || branchIds.size !== refs.length) return null;
        const members = refs.map((ref) => state.products.find((product) => product.id === ref.productId && product.branchId === ref.branchId));
        if (members.some((product) => !product || product.priceGroupId)) return null;
        if (refs.some((ref) => !state.branches.some((branch) => branch.id === ref.branchId && branch.status === 'active'))) return null;
        const id = newId();
        const now = new Date().toISOString();
        const group: SharedPriceGroup = { id, name, retailPrice, wholesalePrice, currency: 'MMK', version: 1, status: 'active', membersByBranch: Object.fromEntries(refs.map((ref) => [ref.branchId, ref.productId])), createdAt: now, updatedAt: now, updatedByUid: input.actorUid };
        const refKeys = new Set(refs.map((ref) => `${ref.branchId}::${ref.productId}`));
        set((current) => ({
          priceGroups: [...current.priceGroups, group],
          products: current.products.map((product) => refKeys.has(`${product.branchId}::${product.id}`)
            ? { ...product, priceGroupId: id, priceVersion: 1, retailPrice, wholesalePrice }
            : product),
          activityLogs: prependAudit(current.activityLogs, makeAudit('SHARED_PRICE_GROUP_CREATE', 'Shared Price Group', `ဆိုင်ခွဲ ${branchIds.size} ခု၏ Product များကို ဈေးနှုန်းအုပ်စု ချိတ်ဆက်သည်: ${name}`, id, current.activeBranchId)),
        }));
        return id;
      },
      updateSharedPriceGroup: (id, changes) => {
        const state = get();
        const currentGroup = state.priceGroups.find((group) => group.id === id && group.status === 'active');
        const retailPrice = Number(changes.retailPrice);
        const wholesalePrice = Number(changes.wholesalePrice);
        const name = changes.name?.trim() || currentGroup?.name || '';
        if (!currentGroup || !name || !Number.isFinite(retailPrice) || retailPrice <= 0 || !Number.isFinite(wholesalePrice) || wholesalePrice < 0) return false;
        const members = state.products.filter((product) => product.priceGroupId === id);
        if (members.length < 2 || new Set(members.map((product) => product.branchId)).size !== members.length) return false;
        const expectedMembers = Object.fromEntries(members.filter((product) => product.branchId).map((product) => [product.branchId as string, product.id]));
        if (JSON.stringify(Object.entries(currentGroup.membersByBranch || {}).sort()) !== JSON.stringify(Object.entries(expectedMembers).sort())) return false;
        const now = new Date().toISOString();
        const sellingPriceChanged = retailPrice !== currentGroup.retailPrice || wholesalePrice !== currentGroup.wholesalePrice;
        // Version tracks the selling-price snapshot only; renaming a group must
        // not force open carts or offline sales into an unnecessary price review.
        const nextVersion = Math.max(1, currentGroup.version || 1) + (sellingPriceChanged ? 1 : 0);
        set((current) => ({
          priceGroups: current.priceGroups.map((group) => group.id === id ? { ...group, name, retailPrice, wholesalePrice, version: nextVersion, updatedAt: now, updatedByUid: changes.actorUid } : group),
          products: sellingPriceChanged
            ? current.products.map((product) => product.priceGroupId === id ? { ...product, retailPrice, wholesalePrice, priceVersion: nextVersion } : product)
            : current.products,
          activityLogs: prependAudit(current.activityLogs, makeAudit('SHARED_PRICE_GROUP_UPDATE', 'Shared Price Group', `မျှဝေဈေးနှုန်းအုပ်စု ပြင်ဆင်သည်: ${name} · လက်လီ ${retailPrice} · လက်ကား ${wholesalePrice}`, id, current.activeBranchId)),
        }));
        return true;
      },
      attachProductsToSharedPriceGroup: (id, inputRefs, actorUid) => {
        const state = get();
        const group = state.priceGroups.find((entry) => entry.id === id && entry.status === 'active');
        if (!group || !inputRefs.length) return false;
        const refs = Array.from(new Map(inputRefs.map((ref) => [`${ref.branchId}::${ref.productId}`, ref])).values());
        const existingBranches = new Set(state.products.filter((product) => product.priceGroupId === id).map((product) => product.branchId));
        if (JSON.stringify([...Object.keys(group.membersByBranch || {}).sort()]) !== JSON.stringify([...existingBranches].filter((value): value is string => !!value).sort())) return false;
        const newBranches = new Set(refs.map((ref) => ref.branchId));
        if (refs.length !== inputRefs.length || [...newBranches].some((branchId) => existingBranches.has(branchId)) || newBranches.size !== refs.length) return false;
        const members = refs.map((ref) => state.products.find((product) => product.id === ref.productId && product.branchId === ref.branchId));
        if (members.some((product) => !product || product.priceGroupId)) return false;
        if (refs.some((ref) => !state.branches.some((branch) => branch.id === ref.branchId && branch.status === 'active'))) return false;
        const refKeys = new Set(refs.map((ref) => `${ref.branchId}::${ref.productId}`));
        const now = new Date().toISOString();
        set((current) => ({
          products: current.products.map((product) => refKeys.has(`${product.branchId}::${product.id}`)
            ? { ...product, priceGroupId: id, priceVersion: group.version, retailPrice: group.retailPrice, wholesalePrice: group.wholesalePrice }
            : product),
          priceGroups: current.priceGroups.map((entry) => entry.id === id ? { ...entry, membersByBranch: { ...(entry.membersByBranch || {}), ...Object.fromEntries(refs.map((ref) => [ref.branchId, ref.productId])) }, updatedAt: now, updatedByUid: actorUid } : entry),
          activityLogs: prependAudit(current.activityLogs, makeAudit('SHARED_PRICE_GROUP_ATTACH', 'Shared Price Group', `ပစ္စည်း ${refs.length} မျိုးကို ${group.name} ဈေးနှုန်းအုပ်စုသို့ ချိတ်ဆက်သည်။`, id, current.activeBranchId)),
        }));
        return true;
      },
      unlinkProductFromSharedPriceGroup: (branchId, productId, actorUid) => {
        const state = get();
        const target = state.products.find((product) => product.id === productId && product.branchId === branchId && !!product.priceGroupId);
        if (!target?.priceGroupId) return false;
        const group = state.priceGroups.find((entry) => entry.id === target.priceGroupId);
        if (!group) return false;
        const remainingMembers = state.products.filter((product) => product.priceGroupId === target.priceGroupId && !(product.id === productId && product.branchId === branchId));
        const shouldArchiveGroup = remainingMembers.length < 2 || new Set(remainingMembers.map((product) => product.branchId)).size < 2;
        set((current) => ({
          products: current.products.map((product) => {
            const isTarget = product.priceGroupId === target.priceGroupId && (shouldArchiveGroup || (product.id === productId && product.branchId === branchId));
            if (!isTarget) return product;
            const { priceGroupId: _priceGroupId, priceVersion: _priceVersion, ...standalone } = product;
            return standalone;
          }),
          priceGroups: current.priceGroups.map((entry) => entry.id === target.priceGroupId ? { ...entry, membersByBranch: shouldArchiveGroup ? {} : Object.fromEntries(Object.entries(entry.membersByBranch || {}).filter(([memberBranchId]) => memberBranchId !== branchId)), status: shouldArchiveGroup ? 'archived' : entry.status, updatedAt: new Date().toISOString(), updatedByUid: actorUid } : entry),
          activityLogs: prependAudit(current.activityLogs, makeAudit('SHARED_PRICE_GROUP_UNLINK', 'Shared Price Group', `${target.name} ကို ${group?.name || 'Price Group'} မှ ချိတ်ဆက်မှုဖြုတ်သည်။${shouldArchiveGroup ? ' ကျန် Product တစ်မျိုးတည်းဖြစ်သွားသောကြောင့် Group ကို Archive လုပ်သည်။' : ''}`, productId, branchId)),
        }));
        return true;
      },
      updateProduct: (id, changes) => set((state) => {
        const current = state.products.find((product) => product.id === id && product.branchId === state.activeBranchId);
        if (current?.priceGroupId && ((changes.retailPrice !== undefined && changes.retailPrice !== current.retailPrice) || (changes.wholesalePrice !== undefined && changes.wholesalePrice !== current.wholesalePrice))) return state;
        const barcodeKey = changes.barcode !== undefined ? normalizeBarcode(changes.barcode) : normalizeBarcode(current?.barcode);
        const skuKey = changes.sku !== undefined ? normalizeBarcode(changes.sku) : normalizeBarcode(current?.sku);
        if (state.products.some((product) => {
          if (product.branchId !== state.activeBranchId || product.id === id) return false;
          const existingBarcode = normalizeBarcode(product.barcode);
          const existingSku = normalizeBarcode(product.sku);
          return (!!barcodeKey && (existingBarcode === barcodeKey || existingSku === barcodeKey))
            || (!!skuKey && (existingBarcode === skuKey || existingSku === skuKey));
        })) return state;
        const nextUnit = changes.unit || current?.unit || 'ခု';
        const nextMode = changes.quantityMode || current?.quantityMode || inferQuantityMode(nextUnit);
        const nextStock = typeof changes.stock === 'number' && Number.isFinite(changes.stock) ? Math.max(0, changes.stock) : current?.stock;
        const stockWasChanged = !!current && nextStock !== undefined && Math.abs(nextStock - current.stock) > 1e-8;
        const quantityModeWasChanged = !!current && changes.quantityMode !== undefined && changes.quantityMode !== quantityModeForProduct(current);
        if (nextStock !== undefined && (stockWasChanged || quantityModeWasChanged) && !isValidQuantity(nextStock, nextMode, true)) return state;
        if (typeof changes.lowStockAt === 'number' && !isValidQuantity(changes.lowStockAt, nextMode, true)) return state;
        let stockBatches = state.stockBatches;
        if (current && nextStock !== undefined && nextStock < current.stock) {
          stockBatches = [...state.stockBatches.filter((batch) => batch.branchId !== state.activeBranchId), ...removeBatchQuantity(state.stockBatches.filter((batch) => batch.branchId === state.activeBranchId), id, current.stock - nextStock, quantityModeForProduct(current))];
        } else if (current && nextStock !== undefined && nextStock > current.stock) {
          const receivedAt = new Date().toISOString();
          stockBatches = [{ id: newId(), branchId: state.activeBranchId, productId: id, purchaseId: '', supplierId: '', quantity: nextStock - current.stock, receivedAt, expiryDate: '', unitCost: typeof changes.costPrice === 'number' ? changes.costPrice : current.costPrice }, ...state.stockBatches];
        }
        const nextProducts = state.products.map((product) => product.id === id && product.branchId === state.activeBranchId ? { ...product, ...changes, ...(nextStock !== undefined ? { stock: nextStock } : {}) } : product);
        const changed = current ? nextProducts.find((product) => product.id === id) : undefined;
        return {
          stockBatches,
          products: nextProducts,
          activityLogs: changed ? prependAudit(state.activityLogs, makeAudit('UPDATE', 'Product', `ပစ္စည်းအချက်အလက် ပြင်ဆင်သည်: ${changed.name}`, id, state.activeBranchId)) : state.activityLogs,
        };
      }),
      deleteProduct: (id) => {
        const state = get();
        const target = state.products.find((product) => product.id === id && product.branchId === state.activeBranchId);
        if (!target || target.priceGroupId) return false;
        set((current) => ({
          products: current.products.filter((product) => !(product.id === id && product.branchId === current.activeBranchId)),
          heldItems: current.heldItems.filter((item) => !(item.productId === id && item.branchId === current.activeBranchId)),
          stockBatches: current.stockBatches.filter((batch) => !(batch.productId === id && batch.branchId === current.activeBranchId)),
          activityLogs: prependAudit(current.activityLogs, makeAudit('DELETE', 'Product', `ပစ္စည်းဖျက်သည်: ${target.name}`, id, current.activeBranchId)),
        }));
        return true;
      },
      adjustStock: (id, quantity) => {
        const state = get();
        if (!Number.isFinite(quantity) || quantity === 0) return false;
        const target = state.products.find((product) => product.id === id && product.branchId === state.activeBranchId);
        if (!target || !isValidQuantity(Math.abs(quantity), 'decimal') || !isValidQuantity(target.stock + quantity, quantityModeForProduct(target), true) || target.stock + quantity < 0) return false;
        const receivedAt = new Date().toISOString();
        const nextStock = cleanQuantity(target.stock + quantity, quantityModeForProduct(target));
        const stockBatches = quantity < 0
          ? [...state.stockBatches.filter((batch) => batch.branchId !== state.activeBranchId), ...removeBatchQuantity(state.stockBatches.filter((batch) => batch.branchId === state.activeBranchId), id, -quantity, quantityModeForProduct(target))]
          : [{ id: newId(), branchId: state.activeBranchId, productId: id, purchaseId: '', supplierId: '', quantity, receivedAt, expiryDate: '', unitCost: target.costPrice }, ...state.stockBatches];
        set((current) => ({
          stockBatches,
          products: current.products.map((product) => product.id === id && product.branchId === state.activeBranchId ? { ...product, stock: nextStock } : product),
          activityLogs: prependAudit(current.activityLogs, makeAudit('STOCK_ADJUST', 'Inventory', `${target.name} Stock ${quantity > 0 ? '+' : ''}${quantity} ပြင်ဆင်သည်`, id, state.activeBranchId)),
        }));
        return true;
      },
      addSale: (sale) => {
        let savedSale: Sale | null = null;
        set((state) => {
        const branchId = state.activeBranchId;
        const invalidSaleItem = sale.items.find((item) => {
          const product = state.products.find((entry) => entry.id === item.productId && entry.branchId === branchId);
          return !product || !isValidQuantity(item.quantity, quantityModeForProduct(product)) || product.stock < item.quantity;
        });
        if (invalidSaleItem) return state;
        if (sale.paymentMethod === 'KPay') {
          const branch = state.branches.find((entry) => entry.id === branchId);
          const reference = sale.kpayTransactionReference?.trim().toLowerCase() || '';
          if (!branch?.settings.kpayAccountName?.trim() || !branch.settings.kpayAccountNumber?.trim() || !reference
            || isKPayReferenceUsed(state, branchId, reference)) return state;
        }
        let customers = state.customers;
        let customerId = sale.customerId;
        let customerSnapshot: Customer | undefined;
        if (sale.paymentMethod === 'Credit') {
          const existing = customers.find((customer) => customer.id === customerId || normalizedName(customer.name) === normalizedName(sale.customer));
          if (existing) { customerId = existing.id; customerSnapshot = { ...existing }; }
          else {
            customerId = newId();
            customerSnapshot = { id: customerId, name: sale.customer || 'အမည်မသိ Customer', phone: '', address: '', note: '', createdAt: new Date().toISOString() };
            customers = [...customers, customerSnapshot];
          }
        }
        const stockBatches = state.stockBatches.map((batch) => ({ ...batch }));
        const currentDate = new Date();
        const currentDay = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
        let batchAllocationIncomplete = false;
        const saleItems = sale.items.map((item) => {
          let remaining = item.quantity;
          const allocations: BatchAllocation[] = [];
          const candidates = stockBatches
            .filter((batch) => batch.branchId === branchId && batch.productId === item.productId && batch.quantity > 0 && (!batch.expiryDate || batch.expiryDate >= currentDay))
            .sort((a, b) => (a.expiryDate || '9999-12-31').localeCompare(b.expiryDate || '9999-12-31'));
          for (const batch of candidates) {
            if (remaining <= 0.000001) break;
            const take = Math.min(batch.quantity, remaining);
            if (take > 0) {
              batch.quantity = cleanQuantity(batch.quantity - take, quantityModeForProduct(state.products.find((product) => product.id === item.productId && product.branchId === branchId)!));
              allocations.push({ batchId: batch.id, quantity: take });
              remaining -= take;
            }
          }
          if (remaining > 0.000001) batchAllocationIncomplete = true;
          return { ...item, ...(allocations.length ? { batchAllocations: allocations } : {}) };
        });
        if (batchAllocationIncomplete) return state;
        const paidAmount = sale.paymentMethod === 'Cash' || sale.paymentMethod === 'KPay' ? sale.total : Math.max(0, Math.min(sale.total, sale.paidAmount ?? 0));
        const dueAmount = sale.paymentMethod === 'Cash' || sale.paymentMethod === 'KPay' ? 0 : Math.max(0, sale.total - paidAmount);
        const saleToSave: Sale = { ...sale, branchId, customerId, paidAmount, dueAmount, items: saleItems, ...(customerSnapshot ? { customerSnapshot } : {}) };
        savedSale = saleToSave;
        return {
          customers,
          stockBatches,
          sales: [saleToSave, ...state.sales],
          activityLogs: prependAudit(state.activityLogs, makeAudit('CHECKOUT', 'Sale', `Voucher ${saleToSave.receiptNo} · ${saleToSave.customer} · ${saleToSave.total} MMK`, saleToSave.id, state.activeBranchId)),
          products: state.products.map((product) => {
            if (product.branchId !== branchId) return product;
            const sold = sale.items.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0);
            return sold ? { ...product, stock: cleanQuantity(Math.max(0, product.stock - sold), quantityModeForProduct(product)) } : product;
          }),
        };
        });
        return savedSale;
      },
      updateSaleCloudSyncStatus: (id, branchId, status, error) => set((state) => ({
        sales: state.sales.map((sale) => sale.id === id && sale.branchId === branchId
          ? { ...sale, cloudSyncStatus: status, cloudSyncError: error }
          : sale),
      })),
      voidSale: (id, reason, actor, voidedAt) => {
        let succeeded = false;
        set((state) => {
          const sale = state.sales.find((entry) => entry.id === id && entry.branchId === state.activeBranchId);
          if (!sale) return state;
          // Idempotent local application: a realtime Cloud snapshot may arrive before this callback.
          if (sale.status === 'voided') { succeeded = true; return state; }
          if (!reason.trim() || (sale.paymentMethod === 'Credit' && (sale.paidAmount ?? 0) > 0)) return state;
          const allocations = sale.items.flatMap((item) => item.batchAllocations || []);
          const now = voidedAt || new Date().toISOString();
          const updatedSale = { ...sale, status: 'voided' as const, voidRequested: false, dueAmount: 0, voidReason: reason.trim(), voidedAt: now, voidedByUid: actor.uid, voidedByEmail: actor.email, voidedByName: actor.name };
          const audit: ActivityLog = {
            id: newId(), branchId: state.activeBranchId, at: now, actor: actor.name || actor.email || 'Owner',
            actorUid: actor.uid, actorEmail: actor.email, action: 'SALE_VOID', entity: 'Sale', entityId: id,
            description: `Voucher ${sale.receiptNo} ကို ပယ်ဖျက်သည် · ${reason.trim()}`,
          };
          succeeded = true;
          return {
            sales: state.sales.map((entry) => entry.id === id && entry.branchId === state.activeBranchId ? updatedSale : entry),
            activityLogs: prependAudit(state.activityLogs, audit),
            products: state.products.map((product) => {
              if (product.branchId !== state.activeBranchId) return product;
              const returned = sale.items.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0);
              return returned ? { ...product, stock: cleanQuantity(product.stock + returned, quantityModeForProduct(product)) } : product;
            }),
            stockBatches: state.stockBatches.map((batch) => ({
              ...batch,
              quantity: batch.branchId === state.activeBranchId ? cleanQuantity(batch.quantity + allocations.filter((allocation) => allocation.batchId === batch.id).reduce((sum, allocation) => sum + allocation.quantity, 0), quantityModeForProduct(state.products.find((product) => product.id === batch.productId && product.branchId === state.activeBranchId) || { unit: 'ခု' })) : batch.quantity,
            })),
          };
        });
        return succeeded;
      },
      requestSaleVoid: (id, reason, actor) => {
        let updated = false;
        set((state) => {
          const sale = state.sales.find((entry) => entry.id === id && entry.branchId === state.activeBranchId);
          if (!sale || sale.status !== 'completed' || !reason.trim()) return state;
          const now = new Date().toISOString();
          updated = true;
          return {
            sales: state.sales.map((entry) => entry.id === id && entry.branchId === state.activeBranchId
              ? { ...entry, voidRequested: true, voidRequestReason: reason.trim(), voidRequestedAt: now, voidRequestedByUid: actor.uid, voidRequestedByName: actor.name }
              : entry),
            activityLogs: prependAudit(state.activityLogs, makeAudit('SALE_VOID_REQUEST', 'Sale', `Voucher ${sale.receiptNo} အတွက် Void တောင်းဆိုသည် · ${reason.trim()}`, id, state.activeBranchId)),
          };
        });
        return updated;
      },
      addExpense: (expense) => {
        const state = get();
        const saved: Expense = { ...expense, branchId: state.activeBranchId, id: expense.id || newId() };
        set((current) => ({ expenses: [saved, ...current.expenses], activityLogs: prependAudit(current.activityLogs, makeAudit('CREATE', 'Expense', `${saved.title} · ${saved.amount} MMK`, saved.id, current.activeBranchId)) }));
        return saved;
      },
      updateExpense: (id, changes) => set((state) => {
        const target = state.expenses.find((expense) => expense.id === id && expense.branchId === state.activeBranchId);
        if (!target) return state;
        const nextExpenses = state.expenses.map((expense) => expense.id === id && expense.branchId === state.activeBranchId ? { ...expense, ...changes } : expense);
        const approvalChanged = typeof changes.approvalStatus === 'string' && changes.approvalStatus !== target.approvalStatus;
        const activityLogs = approvalChanged
          ? prependAudit(state.activityLogs, {
            ...makeAudit(
              changes.approvalStatus === 'approved' ? 'EXPENSE_APPROVE' : changes.approvalStatus === 'rejected' ? 'EXPENSE_REJECT' : 'EXPENSE_APPROVAL_UPDATE',
              'Expense',
              `${target.title} · ${target.amount.toLocaleString('en-US')} MMK · ${changes.approvalStatus}`,
              id,
              target.branchId,
            ),
            actor: changes.approvedByName || changes.reviewedByName || changes.updatedByUid || 'Local device user',
            actorUid: changes.updatedByUid,
          })
          : state.activityLogs;
        return { expenses: nextExpenses, activityLogs };
      }),
      deleteExpense: (id) => set((state) => { const target = state.expenses.find((expense) => expense.id === id && expense.branchId === state.activeBranchId); return { expenses: state.expenses.filter((expense) => !(expense.id === id && expense.branchId === state.activeBranchId)), activityLogs: prependAudit(state.activityLogs, makeAudit('DELETE', 'Expense', `အသုံးစရိတ်ဖျက်သည်: ${target?.title || id}`, id, state.activeBranchId)) }; }),
      addCashierSettlement: (input) => {
        const state = get();
        const branchId = input.branchId || state.activeBranchId;
        const amount = Number(input.amount);
        if (!branchId || !state.branches.some((branch) => branch.id === branchId)
          || !input.cashierUid.trim() || !input.cashierName.trim()
          || !Number.isSafeInteger(amount) || amount <= 0
          || !input.createdByUid.trim()) return null;
        if (input.paymentMethod === 'kpay' && (!input.receiverAccountName?.trim() || !input.receiverAccountNumber?.trim() || !input.transactionReference?.trim() || input.transactionReference.trim().length > 120)) return null;
        if (input.paymentMethod === 'kpay' && isKPayReferenceUsed(state, branchId, input.transactionReference || '')) return null;
        if (input.purpose === 'expense_reimbursement' && !input.relatedExpenseId) return null;
        if (input.purpose !== 'expense_reimbursement' && input.relatedExpenseId) return null;
        if (state.cashierSettlements.some((entry) => input.relatedExpenseId && entry.relatedExpenseId === input.relatedExpenseId && entry.status === 'paid')) return null;
        let linkedExpense: Expense | undefined;
        if (input.relatedExpenseId) {
          linkedExpense = state.expenses.find((entry) => entry.id === input.relatedExpenseId && entry.branchId === branchId);
          if (!linkedExpense || linkedExpense.createdByUid !== input.cashierUid
            || linkedExpense.approvalStatus === 'pending' || linkedExpense.approvalStatus === 'rejected'
            || linkedExpense.fundedBy !== 'cashier-personal'
            || linkedExpense.reimbursedBySettlementId
            || linkedExpense.amount !== amount) return null;
        }
        const now = input.createdAt || new Date().toISOString();
        // A KPay transaction reference yields a deterministic document ID so
        // repeated submissions from another Owner device collide safely instead
        // of creating a second payout record. Cash payouts use a normal new ID.
        const id = input.paymentMethod === 'kpay'
          ? `kpay_${encodeURIComponent(branchId)}_${encodeURIComponent(input.transactionReference!.trim().toLowerCase())}`
          : newId();
        if (state.cashierSettlements.some((entry) => entry.id === id && entry.status === 'paid')) return null;
        const saved: CashierSettlementRecord = {
          ...input,
          id,
          branchId,
          amount,
          status: 'paid',
          createdAt: now,
          paidAt: now,
          receiverAccountName: input.receiverAccountName?.trim() || undefined,
          receiverAccountNumber: input.receiverAccountNumber?.trim() || undefined,
          senderAccountName: input.senderAccountName?.trim() || state.branches.find((branch) => branch.id === branchId)?.settings.kpayAccountName || undefined,
          senderAccountNumber: input.senderAccountNumber?.trim() || state.branches.find((branch) => branch.id === branchId)?.settings.kpayAccountNumber || undefined,
          transactionReference: input.transactionReference?.trim() || undefined,
          note: input.note?.trim() || '',
        };
        const activeShift = state.cashShifts.find((shift) => shift.branchId === branchId && !shift.closedAt);
        const cashMovement: CashMovement | undefined = input.paymentMethod === 'cash' && activeShift ? {
          id: newId(), branchId, shiftId: activeShift.id, date: now, direction: 'out', amount,
          note: `Cashier ${input.cashierName} · ${input.purpose} · Settlement ${id}`,
          sourceSettlementId: id,
          createdByUid: input.paidByUid || input.createdByUid,
          createdByName: input.paidByName || 'Owner',
        } : undefined;
        set((current) => ({
          cashierSettlements: [saved, ...current.cashierSettlements],
          expenses: linkedExpense ? current.expenses.map((entry) => entry.id === linkedExpense!.id && entry.branchId === branchId
            ? { ...entry, reimbursedBySettlementId: id } : entry) : current.expenses,
          cashMovements: cashMovement ? [cashMovement, ...current.cashMovements] : current.cashMovements,
          activityLogs: prependAudit(current.activityLogs, { ...makeAudit('CASHIER_SETTLEMENT_PAID', 'Cashier Settlement', `${input.cashierName} · ${input.purpose} · ${amount} MMK · ${input.paymentMethod.toUpperCase()}`, id, branchId), actor: input.paidByName || 'Owner', actorUid: input.paidByUid || input.createdByUid }),
        }));
        return saved;
      },
      addBranchFinanceLedgerEntry: (input) => {
        const state = get();
        const branchId = state.activeBranchId;
        const amount = Number(input.amount);
        const note = input.note.trim();
        const reference = input.transactionReference?.trim() || '';
        if (!branchId || !state.branches.some((branch) => branch.id === branchId)
          || !Number.isSafeInteger(amount) || amount <= 0 || !note
          || !input.createdByUid.trim() || !input.createdByName.trim()) return null;
        if (input.channel === 'kpay' && (!reference || isKPayReferenceUsed(state, branchId, reference))) return null;
        const now = new Date().toISOString();
        const saved: BranchFinanceLedgerEntry = {
          id: input.channel === 'kpay' && reference ? `kpay-ledger-${encodeURIComponent(branchId)}-${encodeURIComponent(reference.toLowerCase())}` : newId(),
          branchId, channel: input.channel, direction: input.direction, category: input.category,
          amount, date: now, note, ...(reference ? { transactionReference: reference } : {}),
          createdAt: now, createdByUid: input.createdByUid, createdByName: input.createdByName,
        };
        if (state.branchFinanceLedgerEntries.some((entry) => entry.id === saved.id)) return null;
        set((current) => ({
          branchFinanceLedgerEntries: [saved, ...current.branchFinanceLedgerEntries],
          activityLogs: prependAudit(current.activityLogs, { ...makeAudit('BRANCH_FINANCE_ENTRY', 'Branch Finance', `${input.channel.toUpperCase()} ${input.direction} ${amount} MMK · ${note}`, saved.id, branchId), actor: input.createdByName, actorUid: input.createdByUid }),
        }));
        return saved;
      },
      addCashierAdvanceReconciliation: (input) => {
        const state = get();
        const branchId = state.activeBranchId;
        const advance = state.cashierSettlements.find((entry) => entry.id === input.advanceSettlementId && entry.branchId === branchId
          && entry.cashierUid && entry.purpose === 'cash_advance' && entry.status === 'paid');
        const amount = Number(input.amount);
        if (!advance || !Number.isSafeInteger(amount) || amount <= 0 || !input.createdByUid.trim() || !input.createdByName.trim()) return null;
        const alreadyReconciled = state.cashierAdvanceReconciliations.filter((entry) => entry.advanceSettlementId === advance.id && entry.branchId === branchId)
          .reduce((sum, entry) => sum + entry.amount, 0);
        const outstanding = Math.max(0, advance.amount - alreadyReconciled);
        if (amount > outstanding) return null;
        let relatedExpense: Expense | undefined;
        if (input.kind === 'expense-applied') {
          if (!input.relatedExpenseId) return null;
          relatedExpense = state.expenses.find((entry) => entry.id === input.relatedExpenseId && entry.branchId === branchId);
          if (!relatedExpense || relatedExpense.createdByUid !== advance.cashierUid
            || !['branch-cash', 'branch-kpay'].includes(relatedExpense.fundedBy || '')
            || relatedExpense.amount !== amount
            || state.cashierAdvanceReconciliations.some((entry) => entry.relatedExpenseId === relatedExpense!.id)) return null;
          const expectedChannel = relatedExpense.fundedBy === 'branch-kpay' ? 'kpay' : 'cash';
          if (input.channel !== expectedChannel) return null;
        } else {
          if (input.relatedExpenseId) return null;
          if (input.channel === 'kpay' && (!input.transactionReference?.trim()
            || isKPayReferenceUsed(state, branchId, input.transactionReference))) return null;
        }
        const now = new Date().toISOString();
        const saved: CashierAdvanceReconciliationRecord = {
          id: newId(), branchId, advanceSettlementId: advance.id, cashierUid: advance.cashierUid,
          cashierName: advance.cashierName, kind: input.kind, amount, channel: input.channel,
          ...(input.relatedExpenseId ? { relatedExpenseId: input.relatedExpenseId } : {}),
          ...(input.transactionReference?.trim() ? { transactionReference: input.transactionReference.trim() } : {}),
          note: input.note.trim(), createdAt: now, createdByUid: input.createdByUid, createdByName: input.createdByName,
        };
        const activeShift = input.kind === 'cash-returned' && input.channel === 'cash'
          ? state.cashShifts.find((shift) => shift.branchId === branchId && !shift.closedAt)
          : undefined;
        const cashMovement: CashMovement | undefined = activeShift ? {
          id: newId(), branchId, shiftId: activeShift.id, date: now, direction: 'in', amount,
          note: `Cashier Advance return · ${advance.cashierName} · ${advance.id}`,
          sourceSettlementId: advance.id,
          createdByUid: input.createdByUid,
          createdByName: input.createdByName,
        } : undefined;
        const audit = makeAudit('CASH_ADVANCE_RECONCILE', 'Cashier Advance', `${advance.cashierName} · ${input.kind} · ${amount} MMK`, saved.id, branchId);
        audit.actor = input.createdByName;
        audit.actorUid = input.createdByUid;
        set((current) => ({
          cashierAdvanceReconciliations: [saved, ...current.cashierAdvanceReconciliations],
          cashMovements: cashMovement ? [cashMovement, ...current.cashMovements] : current.cashMovements,
          activityLogs: prependAudit(current.activityLogs, audit),
        }));
        return saved;
      },
      addBranchFinanceReconciliations: (inputs) => {
        const state = get();
        const branchId = state.activeBranchId;
        if (!branchId || !state.branches.some((branch) => branch.id === branchId) || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 2) return null;
        const seenChannels = new Set<string>();
        for (const input of inputs) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)
            || Number.isNaN(Date.parse(`${input.businessDate}T00:00:00`))
            || !['cash', 'kpay'].includes(input.channel)
            || seenChannels.has(input.channel)
            || !Number.isSafeInteger(input.expectedBalance)
            || !Number.isSafeInteger(input.actualBalance) || input.actualBalance < 0
            || !Number.isSafeInteger(input.totalIn) || input.totalIn < 0
            || !Number.isSafeInteger(input.totalOut) || input.totalOut < 0
            || !input.createdByUid.trim() || !input.createdByName.trim()) return null;
          seenChannels.add(input.channel);
        }
        const now = new Date().toISOString();
        const saved: BranchFinanceReconciliationRecord[] = inputs.map((input) => ({
          ...input,
          id: newId(),
          branchId,
          variance: input.actualBalance - input.expectedBalance,
          note: input.note.trim(),
          createdAt: now,
        }));
        set((current) => ({
          branchFinanceReconciliations: [...saved, ...current.branchFinanceReconciliations],
          activityLogs: saved.reduce((logs, entry) => prependAudit(logs, { ...makeAudit(
            'FINANCE_RECONCILIATION', 'Branch Finance Reconciliation',
            `${entry.channel.toUpperCase()} · ${entry.businessDate} · မျှော်မှန်း ${entry.expectedBalance} MMK · အမှန် ${entry.actualBalance} MMK · ကွာဟချက် ${entry.variance} MMK`,
            entry.id, branchId,
          ), actor: entry.createdByName }), current.activityLogs),
        }));
        return saved;
      },
      addCustomer: (customer) => {
        const state = get();
        const name = customer.name.trim();
        if (!name || isDuplicateSharedProfile(state.customers, { ...customer, name })) return null;
        const saved: Customer = { ...customer, name, phone: customer.phone.trim(), address: customer.address.trim(), note: customer.note.trim(), id: newId(), createdAt: new Date().toISOString() };
        set((current) => ({ customers: [...current.customers, saved], activityLogs: prependAudit(current.activityLogs, makeAudit('CREATE', 'Shared Customer', `Shared Customer အသစ် ထည့်သည်: ${saved.name}`, saved.id, current.activeBranchId)) }));
        return saved.id;
      },
      updateCustomer: (id, changes) => {
        const state = get();
        const target = state.customers.find((customer) => customer.id === id);
        if (!target) return false;
        const candidate = { ...target, ...changes };
        if (!candidate.name.trim() || isDuplicateSharedProfile(state.customers, candidate, id)) return false;
        set((current) => ({ customers: current.customers.map((customer) => customer.id === id ? { ...customer, ...changes, name: candidate.name.trim(), phone: candidate.phone.trim(), address: candidate.address.trim(), note: candidate.note.trim() } : customer), activityLogs: prependAudit(current.activityLogs, makeAudit('UPDATE', 'Shared Customer', `Shared Customer ပြင်ဆင်သည်: ${candidate.name}`, id, current.activeBranchId)) }));
        return true;
      },
      deleteCustomer: (id) => set((state) => {
        const isReferenced = state.sales.some((sale) => sale.customerId === id) || state.customerPayments.some((payment) => payment.customerId === id);
        const target = state.customers.find((customer) => customer.id === id);
        return isReferenced ? state : { customers: state.customers.filter((customer) => customer.id !== id), activityLogs: prependAudit(state.activityLogs, makeAudit('DELETE', 'Shared Customer', `အသုံးမပြုသေးသော Customer Profile ဖျက်သည်: ${target?.name || id}`, id, state.activeBranchId)) };
      }),
      addCustomerPayment: (payment) => {
        const state = get();
        const sale = state.sales.find((entry) => entry.id === payment.saleId && entry.branchId === state.activeBranchId && entry.customerId === payment.customerId && entry.status === 'completed');
        if (!sale || !Number.isFinite(payment.amount) || payment.amount <= 0) return false;
        const due = Math.max(0, sale.dueAmount ?? (sale.total - (sale.paidAmount ?? 0)));
        if (due <= 0 || payment.amount > due) return false;
        const amount = payment.amount;
        const saved: CustomerPayment = { ...payment, branchId: state.activeBranchId, amount, id: newId(), date: payment.date || new Date().toISOString() };
        const activeShift = state.cashShifts.find((shift) => shift.branchId === state.activeBranchId && !shift.closedAt);
        const cashMovement: CashMovement | null = saved.paymentMethod === 'Cash' && activeShift ? {
          branchId: state.activeBranchId, id: newId(), shiftId: activeShift.id, date: saved.date, direction: 'in', amount,
          note: `Customer credit payment · ${sale.customer} · ${sale.receiptNo}`,
        } : null;
        set((current) => ({
          customerPayments: [saved, ...current.customerPayments],
          sales: current.sales.map((entry) => entry.id === sale.id && entry.branchId === state.activeBranchId ? { ...entry, paidAmount: (entry.paidAmount ?? 0) + amount, dueAmount: Math.max(0, due - amount) } : entry),
          cashMovements: cashMovement ? [cashMovement, ...current.cashMovements] : current.cashMovements,
          activityLogs: prependAudit(current.activityLogs, makeAudit('PAYMENT', 'Customer credit', `${sale.customer} မှ အကြွေးပြန်ဆပ်ငွေ ${amount} MMK`, sale.id, state.activeBranchId)),
        }));
        return true;
      },
      addSupplier: (supplier) => {
        const state = get();
        const name = supplier.name.trim();
        if (!name || isDuplicateSharedProfile(state.suppliers, { ...supplier, name })) return null;
        const saved: Supplier = { ...supplier, name, phone: supplier.phone.trim(), address: supplier.address.trim(), note: supplier.note.trim(), id: newId(), createdAt: new Date().toISOString() };
        set((current) => ({ suppliers: [...current.suppliers, saved], activityLogs: prependAudit(current.activityLogs, makeAudit('CREATE', 'Shared Supplier', `Shared Supplier အသစ် ထည့်သည်: ${saved.name}`, saved.id, current.activeBranchId)) }));
        return saved.id;
      },
      updateSupplier: (id, changes) => {
        const state = get();
        const target = state.suppliers.find((supplier) => supplier.id === id);
        if (!target) return false;
        const candidate = { ...target, ...changes };
        if (!candidate.name.trim() || isDuplicateSharedProfile(state.suppliers, candidate, id)) return false;
        set((current) => ({ suppliers: current.suppliers.map((supplier) => supplier.id === id ? { ...supplier, ...changes, name: candidate.name.trim(), phone: candidate.phone.trim(), address: candidate.address.trim(), note: candidate.note.trim() } : supplier), activityLogs: prependAudit(current.activityLogs, makeAudit('UPDATE', 'Shared Supplier', `Shared Supplier ပြင်ဆင်သည်: ${candidate.name}`, id, current.activeBranchId)) }));
        return true;
      },
      deleteSupplier: (id) => set((state) => { const target = state.suppliers.find((supplier) => supplier.id === id); const isReferenced = state.purchases.some((purchase) => purchase.supplierId === id) || state.supplierPayments.some((payment) => payment.supplierId === id) || state.purchaseReturns.some((entry) => entry.supplierId === id);
        return isReferenced ? state : { suppliers: state.suppliers.filter((supplier) => supplier.id !== id), activityLogs: prependAudit(state.activityLogs, makeAudit('DELETE', 'Shared Supplier', `အသုံးမပြုသေးသော Supplier Profile ဖျက်သည်: ${target?.name || id}`, id, state.activeBranchId)) }; }),
      addPurchase: (purchase) => set((state) => {
        const { initialPaidAmount: requestedInitialPaid, paymentMethod: requestedPaymentMethod, ...purchaseFields } = purchase;
        const product = state.products.find((entry) => entry.id === purchase.productId && entry.branchId === state.activeBranchId);
        const quantity = Number(purchase.quantity);
        const unitCost = Number(purchase.unitCost);
        if (!product || !isValidQuantity(quantity, quantityModeForProduct(product)) || !Number.isFinite(unitCost) || unitCost < 0) return state;
        const id = newId();
        const date = new Date().toISOString();
        const requestedSupplierId = purchase.supplierId || 'general-supplier';
        const existingSupplier = state.suppliers.find((entry) => entry.id === requestedSupplierId);
        const supplier = existingSupplier || {
          id: requestedSupplierId, name: purchase.supplierName || 'အထွေထွေ Supplier',
          phone: '', address: '', note: 'ကုန်ဝယ်စာရင်းမှ အလိုအလျောက် ဖန်တီးထားသည်။', createdAt: date,
        };
        const total = quantity * unitCost;
        const initialPaidAmount = Math.max(0, Math.min(total, Number(requestedInitialPaid) || 0));
        const savedPurchase: Purchase = {
          ...purchaseFields, branchId: state.activeBranchId, id, supplierId: requestedSupplierId, paymentTracking: 'tracked',
          receiptNo: `PUR-${Date.now().toString().slice(-8)}`, date,
          supplierName: supplier.name, productName: product.name, quantity, unitCost, total,
        };
        const batch: StockBatch = {
          branchId: state.activeBranchId, id: newId(), productId: product.id, purchaseId: id, supplierId: requestedSupplierId,
          quantity, receivedAt: date, expiryDate: purchase.expiryDate, unitCost,
        };
        const payment: SupplierPayment | null = initialPaidAmount > 0 ? {
          branchId: state.activeBranchId, id: newId(), supplierId: requestedSupplierId, purchaseId: id, amount: initialPaidAmount,
          date, paymentMethod: requestedPaymentMethod || 'Cash', note: 'ကုန်ဝယ်စဉ် ပေးချေငွေ',
        } : null;
        const activeShift = state.cashShifts.find((shift) => shift.branchId === state.activeBranchId && !shift.closedAt);
        const cashMovement: CashMovement | null = payment?.paymentMethod === 'Cash' && activeShift ? {
          branchId: state.activeBranchId, id: newId(), shiftId: activeShift.id, date, direction: 'out', amount: initialPaidAmount,
          note: `Supplier payment · ${supplier.name} · ${savedPurchase.receiptNo}`,
        } : null;
        return {
          suppliers: existingSupplier ? state.suppliers : [...state.suppliers, supplier],
          purchases: [savedPurchase, ...state.purchases],
          supplierPayments: payment ? [payment, ...state.supplierPayments] : state.supplierPayments,
          cashMovements: cashMovement ? [cashMovement, ...state.cashMovements] : state.cashMovements,
          activityLogs: prependAudit(state.activityLogs, makeAudit('PURCHASE', 'Inventory', `${savedPurchase.supplierName} မှ ${savedPurchase.productName} ${savedPurchase.quantity} ခု ဝယ်ယူသည် · ${savedPurchase.total} MMK · ကြိုတင်ပေး ${initialPaidAmount} MMK`, id, state.activeBranchId)),
          stockBatches: [...state.stockBatches, batch],
          products: state.products.map((entry) => entry.id === product.id && entry.branchId === state.activeBranchId ? { ...entry, stock: cleanQuantity(entry.stock + quantity, quantityModeForProduct(entry)), costPrice: unitCost } : entry),
        };
      }),
      addStockReceipt: (input) => {
        const state = get();
        const branchId = state.activeBranchId;
        if (!Array.isArray(input.items) || input.items.length === 0) return null;
        const supplier = input.supplierId ? state.suppliers.find((entry) => entry.id === input.supplierId) : undefined;
        if (input.supplierId && !supplier) return null;
        const receiptId = newId();
        const receivedDate = input.receivedDate ? new Date(`${input.receivedDate}T12:00:00`) : new Date();
        if (!Number.isFinite(receivedDate.getTime())) return null;
        const receivedAt = receivedDate.toISOString();
        const productUpdates = new Map<string, Product>();
        const createdProducts: Product[] = [];
        const receiptLines: StockReceiptLine[] = [];
        const batches: StockBatch[] = [];
        const existingSkus = new Set(state.products.filter((product) => product.branchId === branchId && product.sku.trim()).map((product) => normalizedName(product.sku)));
        const stagedNames = new Set<string>();
        const stagedSkus = new Set<string>();

        for (const draft of input.items) {
          const quantity = Number(draft.quantity);
          const unitCost = Number(draft.unitCost);
          if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 || !Number.isFinite(unitCost) || unitCost < 0) return null;
          if (draft.retailPrice !== undefined && (!Number.isFinite(draft.retailPrice) || draft.retailPrice < 0)) return null;
          if (draft.wholesalePrice !== undefined && (!Number.isFinite(draft.wholesalePrice) || draft.wholesalePrice < 0)) return null;

          let product: Product | undefined;
          if (draft.newProduct) {
            const name = draft.newProduct.name.trim();
            const category = draft.newProduct.category.trim();
            const categoryExists = state.categories.some((entry) => entry.branchId === branchId && entry.isActive && normalizedName(entry.name) === normalizedName(category));
            if (!name || !categoryExists) return null;
            const sku = draft.newProduct.sku.trim() || `SKU-${newId().slice(0, 8).toUpperCase()}`;
            const skuKey = normalizedName(sku);
            const nameKey = normalizedName(name);
            if (existingSkus.has(skuKey) || stagedSkus.has(skuKey) || stagedNames.has(nameKey)) return null;
            stagedSkus.add(skuKey);
            stagedNames.add(nameKey);
            product = {
              id: newId(), branchId, name, sku, category, costPrice: unitCost, retailPrice: Math.max(0, Number(draft.newProduct.retailPrice) || 0),
              wholesalePrice: Math.max(0, Number(draft.newProduct.wholesalePrice) || 0), stock: 0,
              lowStockAt: Math.max(0, Number(draft.newProduct.lowStockAt) || 0), unit: draft.newProduct.unit.trim() || 'ခု', quantityMode: draft.newProduct.quantityMode || inferQuantityMode(draft.newProduct.unit), createdAt: receivedAt,
            };
            createdProducts.push(product);
          } else {
            product = productUpdates.get(draft.productId || '') || state.products.find((entry) => entry.id === draft.productId && entry.branchId === branchId);
            if (!product) return null;
          }
          if (!isValidQuantity(quantity, quantityModeForProduct(product))) return null;

          const previous = productUpdates.get(product.id) || product;
          const nextStock = cleanQuantity(previous.stock + quantity, quantityModeForProduct(previous));
          const weightedCost = nextStock > 0
            ? ((previous.stock * previous.costPrice) + (quantity * unitCost)) / nextStock
            : unitCost;
          const updatedProduct: Product = {
            ...previous,
            stock: nextStock,
            costPrice: weightedCost,
            ...(!previous.priceGroupId && draft.retailPrice !== undefined ? { retailPrice: draft.retailPrice } : {}),
            ...(!previous.priceGroupId && draft.wholesalePrice !== undefined ? { wholesalePrice: draft.wholesalePrice } : {}),
          };
          productUpdates.set(product.id, updatedProduct);
          const line: StockReceiptLine = {
            id: newId(), productId: product.id, productName: product.name, sku: product.sku,
            quantity, unitCost, lineTotal: quantity * unitCost,
            retailPrice: updatedProduct.retailPrice, wholesalePrice: updatedProduct.wholesalePrice,
            expiryDate: draft.expiryDate || '',
          };
          receiptLines.push(line);
          batches.push({
            id: newId(), branchId, productId: product.id, purchaseId: '', supplierId: supplier?.id || '',
            stockReceiptId: receiptId, quantity, receivedAt, expiryDate: draft.expiryDate || '', unitCost,
          });
        }

        const receipt: StockReceipt = {
          id: receiptId, branchId, receiptNo: `GR-${receivedDate.toISOString().slice(0, 10).replace(/-/g, '')}-${receiptId.slice(0, 6).toUpperCase()}`, date: receivedAt,
          supplierId: supplier?.id, supplierName: supplier?.name || 'Supplier မသတ်မှတ်ထား',
          referenceNo: (input.referenceNo || '').trim(), note: (input.note || '').trim(), items: receiptLines,
          totalQuantity: receiptLines.reduce((sum, item) => sum + item.quantity, 0),
          totalCost: receiptLines.reduce((sum, item) => sum + item.lineTotal, 0),
        };
        const updatedProducts = state.products.map((product) => productUpdates.get(product.id) || product);
        set((current) => ({
          products: [...updatedProducts, ...createdProducts.filter((product) => !updatedProducts.some((entry) => entry.id === product.id)).map((product) => productUpdates.get(product.id) || product)],
          stockBatches: [...batches, ...current.stockBatches],
          stockReceipts: [receipt, ...current.stockReceipts],
          activityLogs: prependAudit(current.activityLogs, makeAudit('STOCK_RECEIVED', 'Inventory', `${receipt.receiptNo} · ${summarizeQuantities(receiptLines.map((item) => ({ quantity: item.quantity, unit: item.unit })))} · ${receipt.totalCost} MMK`, receipt.id, branchId)),
        }));
        return receiptId;
      },
      addQuickGoodsArrival: (input) => {
        const state = get();
        const hubBranch = state.branches.find((branch) => branch.isDefault && branch.status === 'active') || state.branches.find((branch) => branch.status === 'active');
        if (!hubBranch || !Array.isArray(input.items) || input.items.length === 0) return null;
        const receivedDate = input.receivedDate ? new Date(`${input.receivedDate}T12:00:00`) : new Date();
        if (!Number.isFinite(receivedDate.getTime())) return null;
        const receivedAt = receivedDate.toISOString();
        const receiptId = newId();
        const grouped = new Map<string, { name: string; unit: string; quantity: number; barcode?: string }>();
        for (const raw of input.items) {
          const name = String(raw.name || '').trim();
          const unit = String(raw.unit || 'ခု').trim() || 'ခု';
          const barcode = normalizeBarcode(raw.barcode) || undefined;
          const quantity = Number(raw.quantity);
          if (!name || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) return null;
          const key = barcode ? `barcode:${barcode}` : `${normalizedName(name)}::${normalizedName(unit)}`;
          const previous = grouped.get(key);
          if (previous && (normalizedName(previous.name) !== normalizedName(name) || normalizedName(previous.unit) !== normalizedName(unit))) return null;
          grouped.set(key, { name, unit, barcode: barcode || previous?.barcode, quantity: (previous?.quantity || 0) + quantity });
        }

        const categories = [...state.categories];
        let defaultCategory = categories.find((category) => category.branchId === hubBranch.id && category.isActive && normalizedName(category.name) === normalizedName('အထွေထွေ'))
          || categories.find((category) => category.branchId === hubBranch.id && category.isActive);
        if (!defaultCategory) {
          defaultCategory = { id: newId(), branchId: hubBranch.id, name: 'အထွေထွေ', color: '#64748b', isActive: true, createdAt: receivedAt };
          categories.push(defaultCategory);
        }

        const products = [...state.products];
        const batches: StockBatch[] = [];
        const receiptItems: StockReceiptLine[] = [];
        for (const item of grouped.values()) {
          const barcodeMatches = item.barcode ? products.filter((product) => product.branchId === hubBranch.id && (normalizeBarcode(product.barcode) === item.barcode || normalizeBarcode(product.sku) === item.barcode)) : [];
          if (barcodeMatches.length > 1) return null;
          const nameMatches = products.filter((product) => product.branchId === hubBranch.id && normalizedName(product.name) === normalizedName(item.name) && normalizedName(product.unit || 'ခု') === normalizedName(item.unit));
          if (nameMatches.length > 1) return null;
          let product = barcodeMatches[0] || nameMatches[0];
          if (barcodeMatches[0] && (normalizedName(barcodeMatches[0].name) !== normalizedName(item.name) || normalizedName(barcodeMatches[0].unit || 'ခု') !== normalizedName(item.unit))) return null;
          const matchedProductBarcode = !!product && !!item.barcode && normalizeBarcode(product.barcode) === item.barcode;
          const matchedProductSku = !!product && !!item.barcode && normalizeBarcode(product.sku) === item.barcode;
          // A scanned SKU identifies the Product but must never overwrite its separate EAN/UPC Barcode.
          // A name-only match with a different existing code is rejected instead of silently relinking it.
          if (product && item.barcode && !matchedProductBarcode && !matchedProductSku && (product.barcode || product.sku)) return null;
          if (product && !isValidQuantity(item.quantity, quantityModeForProduct(product))) return null;
          if (!product && !isValidQuantity(item.quantity, inferQuantityMode(item.unit))) return null;
          if (!product) {
            product = {
              id: newId(), branchId: hubBranch.id, name: item.name, sku: '', barcode: item.barcode, category: defaultCategory.name,
              costPrice: 0, retailPrice: 0, wholesalePrice: 0, stock: 0, lowStockAt: 5,
              unit: item.unit, quantityMode: inferQuantityMode(item.unit), createdAt: receivedAt,
            };
            products.push(product);
          } else if (item.barcode && !product.barcode && !matchedProductSku) {
            // Only add a new Product Barcode when the scanned value was not an existing SKU.
            product = { ...product, barcode: item.barcode };
          }
          const receivedUnitCost = Math.max(0, Number(product.costPrice) || 0);
          const updatedProduct = { ...product, stock: cleanQuantity(product.stock + item.quantity, quantityModeForProduct(product)) };
          const productIndex = products.findIndex((entry) => entry.id === product!.id && entry.branchId === hubBranch.id);
          if (productIndex >= 0) products[productIndex] = updatedProduct;
          const batchId = newId();
          batches.push({ id: batchId, branchId: hubBranch.id, productId: updatedProduct.id, purchaseId: '', supplierId: '', stockReceiptId: receiptId, quantity: item.quantity, receivedAt, expiryDate: '', unitCost: receivedUnitCost });
          receiptItems.push({ id: newId(), productId: updatedProduct.id, productName: updatedProduct.name, sku: updatedProduct.sku || '', barcode: updatedProduct.barcode || item.barcode, quantity: item.quantity, unit: item.unit, unitCost: receivedUnitCost, lineTotal: item.quantity * receivedUnitCost, retailPrice: updatedProduct.retailPrice, wholesalePrice: updatedProduct.wholesalePrice, expiryDate: '' });
        }

        const receipt: StockReceipt = {
          id: receiptId, branchId: hubBranch.id,
          receiptNo: `ARR-${receivedDate.toISOString().slice(0, 10).replace(/-/g, '')}-${receiptId.slice(0, 6).toUpperCase()}`,
          date: receivedAt, supplierName: 'မသတ်မှတ်ထား', referenceNo: '', note: (input.note || '').trim() || 'ရိုးရှင်းသော ကုန်ရောက်စာရင်း',
          items: receiptItems, totalQuantity: receiptItems.reduce((sum, item) => sum + item.quantity, 0),
          totalCost: receiptItems.reduce((sum, item) => sum + item.lineTotal, 0),
        };
        set((current) => ({
          categories,
          products,
          stockBatches: [...batches, ...current.stockBatches],
          stockReceipts: [receipt, ...current.stockReceipts],
          activityLogs: prependAudit(current.activityLogs, makeAudit('GOODS_ARRIVAL', 'Inventory', `${receipt.receiptNo} · ${summarizeQuantities(receiptItems.map((item) => ({ quantity: item.quantity, unit: item.unit })))} · ${hubBranch.name}`, receipt.id, hubBranch.id)),
        }));
        return receiptId;
      },
      dispatchBranchStockShipment: (input) => {
        const fail = (reason: string): BranchShipmentDispatchResult => ({ ok: false, reason });
        const state = get();
        const requestId = (input.requestId || '').trim();
        if (requestId) {
          const existing = state.stockShipments.find((entry) => entry.requestId === requestId);
          if (existing) return { ok: true, shipment: existing };
        }
        const defaultSourceBranch = state.branches.find((branch) => branch.isDefault && branch.status === 'active') || state.branches.find((branch) => branch.status === 'active');
        const sourceBranch = state.branches.find((branch) => branch.id === (input.fromBranchId || defaultSourceBranch?.id) && branch.status === 'active');
        const destinationBranch = state.branches.find((branch) => branch.id === input.toBranchId && branch.status === 'active');
        if (!sourceBranch) return fail('ပို့မည့် Source Branch မရှိတော့ပါ။ Branch ကို ပြန်ရွေးပြီး ထပ်စမ်းပါ။');
        if (!destinationBranch) return fail('လက်ခံမည့် Destination Branch မရှိတော့ပါ။ Branch ကို ပြန်ရွေးပါ။');
        if (sourceBranch.id === destinationBranch.id) return fail('ပို့မည့်ဆိုင်နဲ့ လက်ခံမည့်ဆိုင် တူနေပါတယ်။ မတူတဲ့ Branch ကို ရွေးပါ။');
        if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 50) return fail('ပို့မည့်ပစ္စည်းစာရင်း မမှန်ကန်ပါ။ ပစ္စည်း ၁ မျိုးမှ ၅၀ မျိုးအထိ ရွေးပါ။');

        const now = new Date();
        const receivedAt = now.toISOString();
        const currentDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const epsilon = 0.000001;
        const products = state.products.map((product) => ({ ...product }));
        const batches = state.stockBatches.map((batch) => ({ ...batch }));
        const shipmentItems: BranchShipmentItem[] = [];
        const seenProducts = new Set<string>();
        const stockBeforeByProduct = new Map<string, number>();
        const batchBeforeById = new Map<string, number>();
        const batchOvercoverage = new Map<string, { productName: string; productStock: number; batchTotal: number }>();

        for (const draft of input.items) {
          const sourceIndex = products.findIndex((product) => product.id === draft.sourceProductId && product.branchId === sourceBranch.id);
          if (sourceIndex < 0) return fail(`ပို့မည့်ဆိုင် (${sourceBranch.name}) ထဲမှာ ရွေးထားတဲ့ Product ကို မတွေ့ပါ။ Branch ပြောင်းထားခြင်းရှိမရှိ စစ်ပါ။`);
          if (seenProducts.has(draft.sourceProductId)) return fail('ပစ္စည်းတစ်မျိုးကို Shipment တစ်ခုထဲမှာ ထပ်ထည့်ထားပါတယ်။ ထပ်နေတဲ့စာကြောင်းကို ဖယ်ပါ။');
          seenProducts.add(draft.sourceProductId);
          const source = products[sourceIndex];
          const quantity = Number(draft.quantity);
          const mode = quantityModeForProduct(source);
          if (!Number.isFinite(quantity) || !isValidQuantity(quantity, mode) || quantity <= 0) {
            return fail(`${source.name}: ပို့မည့်အရေအတွက် မမှန်ပါ။ ${source.unit || 'ခု'} အရေအတွက်ပုံစံနဲ့ ကိုက်ညီအောင် ပြင်ပါ။`);
          }
          if (quantity > Number(source.stock || 0) + epsilon) {
            return fail(`${source.name}: ပို့မည့် ${formatQuantity(quantity, mode)} ${source.unit || 'ခု'} ထက် Source Stock ${formatQuantity(Number(source.stock) || 0, mode)} ${source.unit || 'ခု'} ပဲရှိပါတယ်။`);
          }
          stockBeforeByProduct.set(source.id, Number(source.stock) || 0);

          const tracked = batches.filter((batch) => batch.branchId === sourceBranch.id && batch.productId === source.id && Number(batch.quantity) > 0);
          const trackedTotal = tracked.reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
          // Product.stock is the authoritative sellable balance. Older sales/adjustments
          // can leave the batch ledger above that balance; do not block a valid dispatch
          // solely because of that historical over-coverage. Record it for reconciliation.
          if (trackedTotal > source.stock + epsilon) {
            batchOvercoverage.set(source.id, { productName: source.name, productStock: source.stock, batchTotal: trackedTotal });
          }
          const untracked = Math.max(0, source.stock - trackedTotal);
          if (untracked > epsilon) {
            batches.push({
              id: newId(), branchId: sourceBranch.id, productId: source.id, purchaseId: '', supplierId: '',
              quantity: cleanQuantity(untracked, mode), receivedAt: source.createdAt || receivedAt, expiryDate: '', unitCost: source.costPrice,
            });
          }
          const candidates = batches
            .filter((batch) => {
              const expiry = String(batch.expiryDate || '').trim().slice(0, 10);
              return batch.branchId === sourceBranch.id && batch.productId === source.id
                && Number(batch.quantity) > 0 && (!expiry || expiry >= currentDay);
            })
            .sort((a, b) => (String(a.expiryDate || '').slice(0, 10) || '9999-12-31').localeCompare(String(b.expiryDate || '').slice(0, 10) || '9999-12-31'));
          const available = candidates.reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
          if (quantity > available + epsilon) {
            const expiredQuantity = tracked
              .filter((batch) => {
                const expiry = String(batch.expiryDate || '').trim().slice(0, 10);
                return !!expiry && expiry < currentDay;
              })
              .reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
            const expiredHint = expiredQuantity > epsilon
              ? ` သက်တမ်းကုန် Batch ${formatQuantity(expiredQuantity, mode)} ${source.unit || 'ခု'} ကို ပို့ခွင့်မပြုထားပါ။`
              : '';
            return fail(`${source.name}: Product Stock ${formatQuantity(source.stock, mode)} ${source.unit || 'ခု'} ရှိပေမယ့် ပို့နိုင်တဲ့ (သက်တမ်းမကုန်သေး/Expiry မသတ်မှတ်) Batch က ${formatQuantity(available, mode)} ${source.unit || 'ခု'} ပဲရှိပါတယ်။ လိုအပ်ချက် ${formatQuantity(quantity, mode)} ${source.unit || 'ခု'} ဖြစ်ပါတယ်။${expiredHint} Stock Batch ကို စစ်ဆေး/ညှိပြီးမှ ထပ်ပို့ပါ။`);
          }

          let remaining = quantity;
          let costTotal = 0;
          const allocations: ShipmentBatchAllocation[] = [];
          for (const candidate of candidates) {
            if (remaining <= epsilon) break;
            const batchIndex = batches.findIndex((batch) => batch.id === candidate.id && batch.branchId === sourceBranch.id && batch.productId === source.id);
            if (batchIndex < 0) return fail(`${source.name}: Expiry Batch မှတ်တမ်းကို ရှာမတွေ့တော့ပါ။ Page ကို Refresh လုပ်ပြီး ပြန်စမ်းပါ။`);
            if (state.stockBatches.some((batch) => batch.id === candidate.id && batch.branchId === sourceBranch.id)) {
              batchBeforeById.set(candidate.id, Number(candidate.quantity) || 0);
            }
            const currentBatchQuantity = Math.max(0, Number(batches[batchIndex].quantity) || 0);
            const take = Math.min(currentBatchQuantity, remaining);
            if (take <= epsilon) continue;
            batches[batchIndex] = { ...batches[batchIndex], quantity: Math.max(0, cleanQuantity(currentBatchQuantity - take, mode)) };
            allocations.push({
              sourceBatchId: candidate.id, quantity: take, unitCost: Number(candidate.unitCost) || Number(source.costPrice) || 0,
              expiryDate: candidate.expiryDate || '', receivedAt: candidate.receivedAt || source.createdAt || receivedAt,
              purchaseId: candidate.purchaseId || '', supplierId: candidate.supplierId || '',
            });
            costTotal += take * (Number(candidate.unitCost) || Number(source.costPrice) || 0);
            remaining = Math.max(0, remaining - take);
          }
          if (remaining > epsilon || Math.abs(allocations.reduce((sum, entry) => sum + entry.quantity, 0) - quantity) > epsilon) {
            return fail(`${source.name}: Expiry Batch အလိုက် ခွဲဝေတွက်ချက်မှု မပြည့်စုံပါ။ Stock ကို မပြောင်းထားပါ။ Batch စာရင်းကို ပြန်စစ်ပါ။`);
          }
          const sourceStockAfter = cleanQuantity(source.stock - quantity, mode);
          if (sourceStockAfter < -epsilon) return fail(`${source.name}: ပို့ပြီးနောက် Source Stock အနုတ်ဖြစ်နိုင်ပါတယ်။ Stock ကို ပြန်စစ်ပါ။`);
          products[sourceIndex] = { ...source, stock: Math.max(0, sourceStockAfter) };
          shipmentItems.push({
            sourceProductId: source.id, productName: source.name, sku: source.sku || '', barcode: source.barcode || '',
            category: source.category || 'အထွေထွေ', quantity, unit: source.unit || 'ခု', quantityMode: mode,
            costPrice: quantity > 0 ? costTotal / quantity : Number(source.costPrice) || 0,
            retailPrice: Number(source.retailPrice) || 0, wholesalePrice: Number(source.wholesalePrice) || 0,
            lowStockAt: Number(source.lowStockAt) || 0,
            sourceStockBefore: source.stock, sourceStockAfter, batchAllocations: allocations,
          });
        }

        const shipmentId = newId();
        const shipment: BranchStockShipment = {
          id: shipmentId, branchId: destinationBranch.id,
          shipmentNo: `SH-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${shipmentId.slice(0, 6).toUpperCase()}`,
          ...(requestId ? { requestId } : {}), date: receivedAt, fromBranchId: sourceBranch.id, toBranchId: destinationBranch.id,
          fromBranchName: sourceBranch.name, toBranchName: destinationBranch.name,
          dispatchedByUid: input.actor?.uid || '', dispatchedByEmail: input.actor?.email || '', dispatchedByName: input.actor?.name || 'Owner',
          items: shipmentItems, totalQuantity: shipmentItems.reduce((sum, item) => sum + item.quantity, 0),
          note: (input.note || '').trim(), status: 'dispatched',
        };
        const batchWarningAudits: ActivityLog[] = [...batchOvercoverage.values()].map((entry) => ({
          ...makeAudit('STOCK_SHIPMENT_BATCH_WARNING', 'Branch Stock Shipment', `${shipment.shipmentNo} · ${entry.productName} Batch စုစုပေါင်း ${entry.batchTotal} သည် Product Stock ${entry.productStock} ထက်ပိုနေသဖြင့် Product Stock ကို အမှန်တကယ်လက်ကျန်အဖြစ် အသုံးပြုပြီး ပို့ဆောင်ခဲ့သည်။ Batch ledger ကို ပြန်ညှိရန်လိုသည်။`, shipmentId, sourceBranch.id),
          actor: input.actor?.name || input.actor?.email || 'Owner', actorUid: input.actor?.uid || '', actorEmail: input.actor?.email || '',
        }));
        let commitApplied = false;
        set((current) => {
          const stockStillMatches = [...stockBeforeByProduct.entries()].every(([productId, before]) => {
            const currentProduct = current.products.find((product) => product.id === productId && product.branchId === sourceBranch.id);
            return !!currentProduct && Math.abs(currentProduct.stock - before) <= epsilon;
          });
          const batchesStillMatch = [...batchBeforeById.entries()].every(([batchId, before]) => {
            const currentBatch = current.stockBatches.find((batch) => batch.id === batchId && batch.branchId === sourceBranch.id);
            return !!currentBatch && Math.abs(currentBatch.quantity - before) <= epsilon;
          });
          if (!stockStillMatches || !batchesStillMatch || current.stockShipments.some((entry) => entry.id === shipmentId || (requestId && entry.requestId === requestId))) return current;
          commitApplied = true;
          return {
            products: products.map((product) => ({ ...product })),
            stockBatches: batches.map((batch) => ({ ...batch })),
            stockShipments: [shipment, ...current.stockShipments],
            activityLogs: [...batchWarningAudits, {
              ...makeAudit('STOCK_SHIPMENT_DISPATCHED', 'Branch Stock Shipment', `${shipment.shipmentNo} · ${sourceBranch.name} မှ ${destinationBranch.name} သို့ ${shipment.items.length} မျိုး ပို့ဆောင်သည်`, shipmentId, sourceBranch.id),
              actor: input.actor?.name || input.actor?.email || 'Owner', actorUid: input.actor?.uid || '', actorEmail: input.actor?.email || '',
            }, ...current.activityLogs].slice(0, 1000),
          };
        });
        if (!commitApplied) return fail('Stock အချက်အလက်ကို ပို့နေချိန်အတွင်း ပြောင်းလဲသွားပါတယ်။ Page ကို Refresh လုပ်ပြီး လက်ကျန်အသစ်နဲ့ ပြန်စမ်းပါ။ Stock မပြောင်းထားပါ။');
        const committed = get();
        const committedShipment = committed.stockShipments.find((entry) => entry.id === shipmentId);
        const stockMatches = shipmentItems.every((item) => {
          const product = committed.products.find((entry) => entry.id === item.sourceProductId && entry.branchId === sourceBranch.id);
          return !!product && Math.abs(product.stock - item.sourceStockAfter) <= epsilon;
        });
        if (!committedShipment || !stockMatches) return fail('Shipment ဖန်တီးပြီးနောက် Stock ပြန်စစ်ဆေးမှု မအောင်မြင်ပါ။ ထပ်မံပို့ခြင်းမပြုဘဲ Shipment History ကို အရင်စစ်ပါ။');
        return { ok: true, shipment: committedShipment };
      },
      confirmBranchStockShipmentReceipt: (input) => {
        const state = get();
        const shipment = state.stockShipments.find((entry) => entry.id === input.shipmentId);
        if (!shipment || shipment.status !== 'dispatched' || shipment.toBranchId !== state.stockShipments.find((entry) => entry.id === input.shipmentId)?.branchId) return false;
        if (input.receivedItems.length !== shipment.items.length) return false;
        const normalized = shipment.items.map((item) => {
          const received = input.receivedItems.find((entry) => entry.sourceProductId === item.sourceProductId);
          if (!received) return null;
          const mode = item.quantityMode || inferQuantityMode(item.unit);
          if (!isValidQuantity(received.receivedQuantity, mode, true) || !isValidQuantity(received.damagedQuantity, mode, true)
            || received.receivedQuantity < 0 || received.damagedQuantity < 0
            || received.damagedQuantity > received.receivedQuantity || received.receivedQuantity > item.quantity + epsilonForQuantity()) return null;
          return { sourceProductId: item.sourceProductId, receivedQuantity: received.receivedQuantity, damagedQuantity: received.damagedQuantity, note: (received.note || '').trim() };
        });
        if (normalized.some((entry) => !entry)) return false;
        const now = new Date().toISOString();
        set((current) => ({
          stockShipments: current.stockShipments.map((entry) => entry.id === input.shipmentId && entry.status === 'dispatched' ? {
            ...entry, status: 'received', receivedItems: normalized as NonNullable<(typeof normalized)[number]>[], receivedAt: now,
            receivedByUid: input.actor?.uid || '', receivedByEmail: input.actor?.email || '', receivedByName: input.actor?.name || 'Branch Receiver', receiverNote: (input.note || '').trim(),
          } : entry),
          activityLogs: prependAudit(current.activityLogs, {
            ...makeAudit('STOCK_SHIPMENT_RECEIVED', 'Branch Stock Shipment', `${shipment.shipmentNo} · ${shipment.toBranchName} မှ ပစ္စည်းရောက်ရှိကြောင်း အတည်ပြုသည်`, shipment.id, shipment.toBranchId),
            actor: input.actor?.name || input.actor?.email || 'Branch Receiver', actorUid: input.actor?.uid || '', actorEmail: input.actor?.email || '',
          }),
        }));
        return get().stockShipments.some((entry) => entry.id === input.shipmentId && entry.status === 'received');
      },
      approveBranchStockShipment: (input) => {
        const state = get();
        const shipment = state.stockShipments.find((entry) => entry.id === input.shipmentId);
        if (!shipment || shipment.status !== 'received' || !Array.isArray(shipment.receivedItems) || shipment.receivedItems.length !== shipment.items.length) return false;
        const destinationBranch = state.branches.find((branch) => branch.id === shipment.toBranchId && branch.status === 'active');
        if (!destinationBranch) return false;
        const products = state.products.map((product) => ({ ...product }));
        const batches = state.stockBatches.map((batch) => ({ ...batch }));
        const categories = state.categories.map((category) => ({ ...category }));
        const approvedLines: BranchShipmentItem[] = [];
        const autoCompletionPlan: BranchShipmentAutoCompletionPlan[] = [];
        const autoDestinationIds = new Set<string>();
        const now = new Date().toISOString();
        const epsilon = 0.000001;
        if (input.autoComplete) {
          if (!input.actor?.uid || shipment.receivedItems.length !== shipment.items.length
            || shipment.items.some((item) => {
              const received = shipment.receivedItems?.find((entry) => entry.sourceProductId === item.sourceProductId);
              return !received || Math.abs(received.receivedQuantity - item.quantity) > epsilon || received.damagedQuantity !== 0
                || !Array.isArray(item.batchAllocations) || item.batchAllocations.length === 0
                || item.batchAllocations.some((allocation) => !Number.isFinite(Number(allocation.quantity)) || allocation.quantity <= 0)
                || Math.abs(item.batchAllocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0) - item.quantity) > epsilon;
            })) return false;
        }

        for (const item of shipment.items) {
          const received = shipment.receivedItems.find((entry) => entry.sourceProductId === item.sourceProductId);
          if (!received) return false;
          const quantityMode = item.quantityMode || inferQuantityMode(item.unit);
          if (!isValidQuantity(received.receivedQuantity, quantityMode, true)
            || !isValidQuantity(received.damagedQuantity, quantityMode, true)
            || received.receivedQuantity < 0 || received.receivedQuantity > item.quantity + epsilon
            || received.damagedQuantity < 0 || received.damagedQuantity > received.receivedQuantity) return false;
          const acceptedQuantity = cleanQuantity(Math.max(0, received.receivedQuantity - received.damagedQuantity), quantityMode);
          if (acceptedQuantity <= epsilon) {
            approvedLines.push({ ...item, acceptedQuantity: 0 });
            continue;
          }
          let destinationMatches = products.filter((product) => product.branchId === destinationBranch.id && (
            (item.barcode && normalizeBarcode(product.barcode) === normalizeBarcode(item.barcode))
            || (item.sku && normalizedName(product.sku) === normalizedName(item.sku))
            || (normalizedName(product.name) === normalizedName(item.productName) && normalizedName(product.unit || 'ခု') === normalizedName(item.unit || 'ခု'))
          ));
          if (destinationMatches.length > 1) return false;
          let destination = destinationMatches[0];
          const createdDestination = !destination;
          if (destination && quantityModeForProduct(destination) !== quantityMode) return false;
          if (!destination) {
            let targetCategory = categories.find((category) => category.branchId === destinationBranch.id && category.isActive && normalizedName(category.name) === normalizedName(item.category))
              || categories.find((category) => category.branchId === destinationBranch.id && category.isActive && normalizedName(category.name) === normalizedName('အထွေထွေ'))
              || categories.find((category) => category.branchId === destinationBranch.id && category.isActive);
            if (!targetCategory) {
              targetCategory = { id: newId(), branchId: destinationBranch.id, name: item.category || 'အထွေထွေ', color: '#64748b', isActive: true, createdAt: now };
              categories.push(targetCategory);
            }
            destination = {
              id: newId(), branchId: destinationBranch.id, name: item.productName, sku: item.sku || '', barcode: item.barcode || '',
              category: targetCategory.name, costPrice: item.costPrice, retailPrice: item.retailPrice, wholesalePrice: item.wholesalePrice,
              stock: 0, lowStockAt: item.lowStockAt, unit: item.unit, quantityMode, createdAt: now,
            };
            products.push(destination);
          }

          if (input.autoComplete) {
            if (autoDestinationIds.has(destination.id)) return false;
            autoDestinationIds.add(destination.id);
          }
          const previousStock = Math.max(0, Number(destination.stock) || 0);
          const destinationTracked = batches.filter((batch) => batch.branchId === destinationBranch.id && batch.productId === destination!.id && Number(batch.quantity) > 0);
          const destinationTrackedTotal = destinationTracked.reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
          if (destinationTrackedTotal > previousStock + epsilon) return false;
          const destinationUntracked = Math.max(0, previousStock - destinationTrackedTotal);
          if (destinationUntracked > epsilon) {
            batches.push({
              id: newId(), branchId: destinationBranch.id, productId: destination.id, purchaseId: '', supplierId: '',
              quantity: cleanQuantity(destinationUntracked, quantityMode), receivedAt: destination.createdAt || now, expiryDate: '', unitCost: Number(destination.costPrice) || 0,
            });
          }
          const newStock = cleanQuantity(previousStock + acceptedQuantity, quantityMode);
          const weightedCost = newStock > 0
            ? ((previousStock * (Number(destination.costPrice) || 0)) + (acceptedQuantity * item.costPrice)) / newStock
            : item.costPrice;
          const updatedDestination: Product = {
            ...destination, name: item.productName, sku: item.sku || destination.sku || '', barcode: item.barcode || destination.barcode || '',
            category: createdDestination ? destination.category : (item.category || destination.category), costPrice: weightedCost,
            ...(!destination.priceGroupId ? { retailPrice: item.retailPrice, wholesalePrice: item.wholesalePrice } : {}),
            lowStockAt: item.lowStockAt, stock: newStock, unit: item.unit, quantityMode,
          };
          const productIndex = products.findIndex((product) => product.id === destination!.id && product.branchId === destinationBranch.id);
          if (productIndex >= 0) products[productIndex] = updatedDestination;

          let batchRemaining = acceptedQuantity;
          const destinationBatchIds: string[] = [];
          for (let batchIndex = 0; batchIndex < item.batchAllocations.length; batchIndex += 1) {
            const allocation = item.batchAllocations[batchIndex];
            if (batchRemaining <= epsilon) break;
            const take = Math.min(allocation.quantity, batchRemaining);
            if (take <= epsilon) continue;
            const destinationBatchId = newId();
            batches.push({
              id: destinationBatchId, branchId: destinationBranch.id, productId: updatedDestination.id,
              purchaseId: allocation.purchaseId || '', supplierId: allocation.supplierId || '', stockReceiptId: shipment.id,
              ...(input.autoComplete ? {
                sourceShipmentId: shipment.id,
                sourceShipmentLineIndex: approvedLines.length,
                sourceShipmentBatchIndex: destinationBatchIds.length,
              } : {}),
              quantity: cleanQuantity(take, quantityMode), receivedAt: allocation.receivedAt || now,
              expiryDate: allocation.expiryDate || '', unitCost: allocation.unitCost,
            });
            destinationBatchIds.push(destinationBatchId);
            batchRemaining = Math.max(0, batchRemaining - take);
          }
          if (batchRemaining > epsilon) return false;
          if (input.autoComplete) {
            autoCompletionPlan.push({
              destinationProductId: updatedDestination.id,
              destinationStockBefore: previousStock,
              destinationStockAfter: newStock,
              destinationBatchIds,
            });
          }
          approvedLines.push({ ...item, acceptedQuantity });
        }

        let committed = false;
        set((current) => {
          const latest = current.stockShipments.find((entry) => entry.id === input.shipmentId);
          if (!latest || latest.status !== 'received' || current.stockShipments.some((entry) => entry.id !== input.shipmentId && entry.shipmentNo === shipment.shipmentNo)) return current;
          committed = true;
          const approved: BranchStockShipment = {
            ...latest, items: approvedLines, status: 'approved', approvedAt: now,
            approvedByUid: input.actor?.uid || '', approvedByEmail: input.actor?.email || '', approvedByName: input.actor?.name || 'Owner', approvalNote: (input.note || '').trim(),
            ...(input.autoComplete ? {
              completionMode: 'auto' as const,
              autoCompletedByUid: input.actor?.uid || '',
              autoCompletionPlan,
            } : { completionMode: 'owner' as const }),
          };
          return {
            products: products.map((product) => ({ ...product })), stockBatches: batches.map((batch) => ({ ...batch })), categories,
            stockShipments: current.stockShipments.map((entry) => entry.id === input.shipmentId ? approved : entry),
            activityLogs: prependAudit(current.activityLogs, {
              ...makeAudit('STOCK_SHIPMENT_APPROVED', 'Branch Stock Shipment', `${shipment.shipmentNo} · ${shipment.toBranchName} သို့ ${approvedLines.length} မျိုး၊ အတည်ပြုလက်ခံအရေအတွက် ${summarizeQuantities(approvedLines.map((line) => ({ quantity: line.acceptedQuantity || 0, unit: line.unit })))} ဖြင့် Stock ဝင်သည်`, shipment.id, shipment.toBranchId),
              actor: input.actor?.name || input.actor?.email || 'Owner', actorUid: input.actor?.uid || '', actorEmail: input.actor?.email || '',
            }),
          };
        });
        return committed;
      },
      cancelBranchStockShipment: (input) => {
        const state = get();
        const shipment = state.stockShipments.find((entry) => entry.id === input.shipmentId);
        if (!shipment || shipment.status !== 'dispatched' || !input.note.trim()) return false;
        const products = state.products.map((product) => ({ ...product }));
        const batches = state.stockBatches.map((batch) => ({ ...batch }));
        const now = new Date().toISOString();
        for (const item of shipment.items) {
          const productIndex = products.findIndex((product) => product.id === item.sourceProductId && product.branchId === shipment.fromBranchId);
          if (productIndex < 0) return false;
          const mode = item.quantityMode || inferQuantityMode(item.unit);
          products[productIndex] = { ...products[productIndex], stock: cleanQuantity(products[productIndex].stock + item.quantity, mode) };
          for (const allocation of item.batchAllocations) {
            const batchIndex = batches.findIndex((batch) => batch.id === allocation.sourceBatchId && batch.branchId === shipment.fromBranchId && batch.productId === item.sourceProductId);
            if (batchIndex >= 0) {
              batches[batchIndex] = { ...batches[batchIndex], quantity: cleanQuantity(batches[batchIndex].quantity + allocation.quantity, mode) };
            } else {
              batches.push({
                id: allocation.sourceBatchId, branchId: shipment.fromBranchId, productId: item.sourceProductId,
                purchaseId: allocation.purchaseId || '', supplierId: allocation.supplierId || '', quantity: allocation.quantity,
                receivedAt: allocation.receivedAt || shipment.date, expiryDate: allocation.expiryDate || '', unitCost: allocation.unitCost,
              });
            }
          }
        }
        let cancelled = false;
        set((current) => {
          const latest = current.stockShipments.find((entry) => entry.id === input.shipmentId);
          if (!latest || latest.status !== 'dispatched') return current;
          cancelled = true;
          return {
            products: products.map((product) => ({ ...product })), stockBatches: batches.map((batch) => ({ ...batch })),
            stockShipments: current.stockShipments.map((entry) => entry.id === input.shipmentId ? {
              ...entry, status: 'cancelled', cancelledAt: now, cancelledByUid: input.actor?.uid || '',
              cancelledByEmail: input.actor?.email || '', cancelledByName: input.actor?.name || 'Owner', cancellationNote: input.note.trim(),
            } : entry),
            activityLogs: prependAudit(current.activityLogs, {
              ...makeAudit('STOCK_SHIPMENT_CANCELLED', 'Branch Stock Shipment', `${shipment.shipmentNo} ကို မလက်ခံရသေးခင် ပယ်ဖျက်ပြီး Source Stock ပြန်တိုးသည် · ${input.note.trim()}`, shipment.id, shipment.fromBranchId),
              actor: input.actor?.name || input.actor?.email || 'Owner', actorUid: input.actor?.uid || '', actorEmail: input.actor?.email || '',
            }),
          };
        });
        return cancelled;
      },
      transferStock: (input) => {
        const state = get();
        const requestId = (input.requestId || '').trim();
        if (requestId) {
          const existing = state.stockTransfers.find((entry) => entry.requestId === requestId);
          if (existing?.status === 'completed') return { id: existing.id, transferNo: existing.transferNo, fromBranchId: existing.fromBranchId, toBranchId: existing.toBranchId, items: existing.items };
          if (existing?.status === 'reversed') return null;
        }
        const defaultSourceBranch = state.branches.find((branch) => branch.isDefault && branch.status === 'active') || state.branches.find((branch) => branch.status === 'active');
        const sourceBranch = state.branches.find((branch) => branch.id === (input.fromBranchId || defaultSourceBranch?.id) && branch.status === 'active');
        const destinationBranch = state.branches.find((branch) => branch.id === input.toBranchId && branch.status === 'active');
        if (!sourceBranch || !destinationBranch || sourceBranch.id === destinationBranch.id || !Array.isArray(input.items) || input.items.length === 0) return null;

        const now = new Date();
        const currentDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        // Build the entire transfer against immutable working copies. Nothing is written
        // to Zustand until every source, destination, batch and quantity check passes.
        const products = state.products.map((product) => ({ ...product }));
        const batches = state.stockBatches.map((batch) => ({ ...batch }));
        const categories = state.categories.map((category) => ({ ...category }));
        const transferLines: StockTransferLine[] = [];
        const seenSourceProducts = new Set<string>();
        const sourceBatchOvercoverage = new Set<string>();
        const epsilon = 0.000001;

        for (const draft of input.items) {
          const quantity = Number(draft.quantity);
          if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || !draft.sourceProductId || seenSourceProducts.has(draft.sourceProductId)) return null;
          seenSourceProducts.add(draft.sourceProductId);

          const source = products.find((product) => product.id === draft.sourceProductId && product.branchId === sourceBranch.id);
          if (!source || !isValidQuantity(quantity, quantityModeForProduct(source)) || source.stock + epsilon < quantity) return null;
          const sourceStockBefore = source.stock;
          const sourceTrackedTotal = batches
            .filter((batch) => batch.branchId === sourceBranch.id && batch.productId === source.id)
            .reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
          if (sourceTrackedTotal > sourceStockBefore + epsilon) sourceBatchOvercoverage.add(source.id);

          // If legacy Product.stock is greater than its batch ledger, create an opening
          // batch for only the uncovered amount before allocating the transfer.
          const untrackedStock = Math.max(0, sourceStockBefore - sourceTrackedTotal);
          if (untrackedStock > epsilon) {
            batches.push({
              id: newId(), branchId: sourceBranch.id, productId: source.id, purchaseId: '', supplierId: '',
              quantity: cleanQuantity(untrackedStock, quantityModeForProduct(source)),
              receivedAt: source.createdAt || now.toISOString(), expiryDate: '', unitCost: source.costPrice,
            });
          }

          const candidateBatches = batches
            .filter((batch) => batch.branchId === sourceBranch.id && batch.productId === source.id && Number(batch.quantity) > 0 && (!batch.expiryDate || batch.expiryDate >= currentDay))
            .sort((a, b) => (a.expiryDate || '9999-12-31').localeCompare(b.expiryDate || '9999-12-31'));
          const availableBatchQuantity = candidateBatches.reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
          if (availableBatchQuantity + epsilon < quantity) return null;

          let remaining = quantity;
          let transferredCostTotal = 0;
          const allocations: StockTransferBatchAllocation[] = [];
          for (const candidate of candidateBatches) {
            if (remaining <= epsilon) break;
            const take = Math.min(candidate.quantity, remaining);
            const sourceBatchIndex = batches.findIndex((batch) => batch.id === candidate.id && batch.branchId === sourceBranch.id && batch.productId === source.id);
            if (sourceBatchIndex < 0 || take <= 0) return null;
            const afterBatchQuantity = cleanQuantity(batches[sourceBatchIndex].quantity - take, quantityModeForProduct(source));
            if (afterBatchQuantity < -epsilon) return null;
            batches[sourceBatchIndex] = { ...batches[sourceBatchIndex], quantity: Math.max(0, afterBatchQuantity) };
            const destinationBatchId = newId();
            allocations.push({ sourceBatchId: candidate.id, destinationBatchId, quantity: take, unitCost: candidate.unitCost, expiryDate: candidate.expiryDate || '', sourceBatchReceivedAt: candidate.receivedAt, sourceBatchPurchaseId: candidate.purchaseId || '', sourceBatchSupplierId: candidate.supplierId || '' });
            transferredCostTotal += take * candidate.unitCost;
            remaining = Math.max(0, remaining - take);
          }
          const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
          if (remaining > epsilon || Math.abs(allocatedQuantity - quantity) > epsilon) return null;

          const transferredUnitCost = transferredCostTotal / quantity;
          const targetMatches = products.filter((product) => product.branchId === destinationBranch.id
            && normalizedName(product.name) === normalizedName(source.name)
            && normalizedName(product.unit || 'ခု') === normalizedName(source.unit || 'ခု'));
          if (targetMatches.length > 1) return null;

          let destinationProduct = targetMatches[0];
          if (!destinationProduct) {
            let targetCategory = categories.find((category) => category.branchId === destinationBranch.id && category.isActive && normalizedName(category.name) === normalizedName('အထွေထွေ'))
              || categories.find((category) => category.branchId === destinationBranch.id && category.isActive);
            if (!targetCategory) {
              targetCategory = { id: newId(), branchId: destinationBranch.id, name: 'အထွေထွေ', color: '#64748b', isActive: true, createdAt: now.toISOString() };
              categories.push(targetCategory);
            }
            destinationProduct = {
              id: newId(), branchId: destinationBranch.id, name: source.name, sku: '', category: targetCategory.name,
              costPrice: transferredUnitCost, retailPrice: 0, wholesalePrice: 0, stock: 0, lowStockAt: 5,
              unit: source.unit || 'ခု', quantityMode: quantityModeForProduct(source), createdAt: now.toISOString(),
            };
            products.push(destinationProduct);
          }
          if (quantityModeForProduct(destinationProduct) !== quantityModeForProduct(source)) return null;

          const sourceStockAfter = cleanQuantity(sourceStockBefore - quantity, quantityModeForProduct(source));
          const destinationStockBefore = Number(destinationProduct.stock) || 0;
          const destinationStockAfter = cleanQuantity(destinationStockBefore + quantity, quantityModeForProduct(destinationProduct));
          if (sourceStockAfter < -epsilon || destinationStockAfter + epsilon < destinationStockBefore) return null;

          const weightedDestinationCost = destinationStockAfter > 0
            ? ((destinationStockBefore * destinationProduct.costPrice) + transferredCostTotal) / destinationStockAfter
            : transferredUnitCost;
          const updatedDestinationProduct: Product = { ...destinationProduct, stock: destinationStockAfter, costPrice: weightedDestinationCost };
          // One transfer request must not merge two distinct source IDs into the same
          // destination product silently; the operator can transfer those separately.
          if (transferLines.some((line) => line.destinationProductId === updatedDestinationProduct.id)) return null;
          const destinationBatchBefore = batches.filter((batch) => batch.branchId === destinationBranch.id && batch.productId === updatedDestinationProduct.id).reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
          const destinationIndex = products.findIndex((product) => product.id === destinationProduct!.id && product.branchId === destinationBranch.id);
          const sourceIndex = products.findIndex((product) => product.id === source.id && product.branchId === sourceBranch.id);
          if (destinationIndex < 0 || sourceIndex < 0) return null;
          products[destinationIndex] = updatedDestinationProduct;
          products[sourceIndex] = { ...products[sourceIndex], stock: sourceStockAfter };

          for (const allocation of allocations) {
            batches.push({
              id: allocation.destinationBatchId, branchId: destinationBranch.id, productId: updatedDestinationProduct.id,
              purchaseId: '', supplierId: '', quantity: allocation.quantity, receivedAt: now.toISOString(),
              expiryDate: allocation.expiryDate, unitCost: allocation.unitCost,
            });
          }

          // Verify exact source and destination balances before committing any state.
          const verifiedSource = products.find((product) => product.id === source.id && product.branchId === sourceBranch.id);
          const verifiedDestination = products.find((product) => product.id === updatedDestinationProduct.id && product.branchId === destinationBranch.id);
          const sourceBatchAfter = batches.filter((batch) => batch.branchId === sourceBranch.id && batch.productId === source.id).reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
          const destinationBatchAfter = batches.filter((batch) => batch.branchId === destinationBranch.id && batch.productId === updatedDestinationProduct.id).reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
          const expectedSourceBatchAfter = Math.max(sourceTrackedTotal, sourceStockBefore) - quantity;
          if (!verifiedSource || !verifiedDestination
            || Math.abs(verifiedSource.stock - sourceStockAfter) > epsilon
            || Math.abs(verifiedDestination.stock - destinationStockAfter) > epsilon
            || Math.abs(sourceBatchAfter - expectedSourceBatchAfter) > epsilon
            || Math.abs(destinationBatchAfter - (destinationBatchBefore + quantity)) > epsilon) return null;

          transferLines.push({
            sourceProductId: source.id, destinationProductId: updatedDestinationProduct.id,
            productName: source.name, quantity, unit: source.unit || 'ခု', transferredUnitCost,
            batchAllocations: allocations,
            sourceStockBefore, sourceStockAfter, destinationStockBefore, destinationStockAfter,
            destinationCostPriceBefore: Number(destinationProduct.costPrice) || 0,
          });
        }

        const transferId = newId();
        const transfer: StockTransfer = {
          id: transferId,
          transferNo: `TR-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${transferId.slice(0, 6).toUpperCase()}`,
          ...(requestId ? { requestId } : {}),
          date: now.toISOString(), fromBranchId: sourceBranch.id, toBranchId: destinationBranch.id,
          fromBranchName: sourceBranch.name, toBranchName: destinationBranch.name,
          initiatedByUid: input.actor?.uid || '', initiatedByEmail: input.actor?.email || '', initiatedByName: input.actor?.name || 'Owner / Local User',
          items: transferLines, totalQuantity: transferLines.reduce((sum, item) => sum + item.quantity, 0),
          note: (input.note || '').trim(), status: 'completed',
        };

        // Persist source deductions, destination additions, batch movements and the
        // audit record in one Zustand state commit. A state race aborts the whole commit.
        let commitApplied = false;
        set((current) => {
          const currentMatchesSnapshot = transferLines.every((line) => {
            const sourceNow = current.products.find((product) => product.id === line.sourceProductId && product.branchId === sourceBranch.id);
            const destinationNow = current.products.find((product) => product.id === line.destinationProductId && product.branchId === destinationBranch.id);
            const sourceBeforeMatches = !!sourceNow && Math.abs(sourceNow.stock - (line.sourceStockBefore ?? sourceNow.stock)) <= epsilon;
            const destinationBeforeMatches = (destinationNow?.stock ?? 0) === (line.destinationStockBefore ?? 0);
            return sourceBeforeMatches && destinationBeforeMatches;
          });
          if (!currentMatchesSnapshot) return current;

          const sourceChecks = transferLines.every((line) => {
            const sourceAfter = products.find((product) => product.id === line.sourceProductId && product.branchId === sourceBranch.id);
            return !!sourceAfter && Math.abs(sourceAfter.stock - (line.sourceStockAfter ?? 0)) <= epsilon;
          });
          const destinationChecks = transferLines.every((line) => {
            const destinationAfter = products.find((product) => product.id === line.destinationProductId && product.branchId === destinationBranch.id);
            return !!destinationAfter && Math.abs(destinationAfter.stock - (line.destinationStockAfter ?? 0)) <= epsilon;
          });
          if (!sourceChecks || !destinationChecks) return current;

          commitApplied = true;
          return {
            products: products.map((product) => ({ ...product })),
            categories, stockBatches: batches, stockTransfers: [transfer, ...current.stockTransfers],
            activityLogs: [
              ...[...sourceBatchOvercoverage].map((productId) => makeAudit('STOCK_TRANSFER_BATCH_WARNING', 'Stock Transfer', `${transfer.transferNo} · Source Product ${productId} ၏ Batch စုစုပေါင်းသည် Product Stock ထက်ပိုနေသဖြင့် လွှဲပမာဏကို Product Stock ဖြင့် ကန့်သတ်ခဲ့သည်။ Batch ကို နောက်မှ စစ်ဆေးရန်။`, productId, sourceBranch.id)),
              { ...makeAudit('STOCK_TRANSFER_IN', 'Stock Transfer', `${transfer.transferNo} · ${sourceBranch.name} မှ ${summarizeQuantities(transferLines.map((item) => ({ quantity: item.quantity, unit: item.unit })))} လက်ခံသည်`, transferId, destinationBranch.id), actor: input.actor?.name || input.actor?.email || 'Owner / Local User' },
              { ...makeAudit('STOCK_TRANSFER_OUT', 'Stock Transfer', `${transfer.transferNo} · ${destinationBranch.name} သို့ ${summarizeQuantities(transferLines.map((item) => ({ quantity: item.quantity, unit: item.unit })))} လွှဲသည်`, transferId, sourceBranch.id), actor: input.actor?.name || input.actor?.email || 'Owner / Local User' },
              ...current.activityLogs,
            ].slice(0, 1000),
          };
        });

        if (!commitApplied) return null;
        const committed = get();
        const committedTransfer = committed.stockTransfers.find((item) => item.id === transferId);
        const balancesMatch = transferLines.every((line) => {
          const sourceAfter = committed.products.find((product) => product.id === line.sourceProductId && product.branchId === sourceBranch.id);
          const destinationAfter = committed.products.find((product) => product.id === line.destinationProductId && product.branchId === destinationBranch.id);
          return !!sourceAfter && !!destinationAfter
            && Math.abs(sourceAfter.stock - (line.sourceStockAfter ?? 0)) <= epsilon
            && Math.abs(destinationAfter.stock - (line.destinationStockAfter ?? 0)) <= epsilon;
        });
        if (!committedTransfer || committedTransfer.toBranchId !== destinationBranch.id || !balancesMatch) return null;
        return { id: transferId, transferNo: transfer.transferNo, fromBranchId: sourceBranch.id, toBranchId: destinationBranch.id, items: transferLines };
      },
      reverseStockTransfer: (input) => {
        const state = get();
        const transfer = state.stockTransfers.find((entry) => entry.id === input.transferId);
        if (!transfer) return { ok: false, reason: 'not-found' };
        if (transfer.status === 'reversed') return { ok: false, reason: 'already-reversed' };
        if (transfer.status !== 'completed' || !Array.isArray(transfer.items) || transfer.items.length === 0) return { ok: false, reason: 'invalid-transfer' };
        // Only reverse records whose original before/after stock was verified by v2.7.4+.
        // This prevents reversing legacy false-success transfer records with unknown balances.
        if (transfer.items.some((line) => line.sourceStockBefore === undefined || line.sourceStockAfter === undefined || line.destinationStockBefore === undefined || line.destinationStockAfter === undefined)) return { ok: false, reason: 'invalid-transfer' };

        const epsilon = 0.000001;
        const products = state.products.map((product) => ({ ...product }));
        const batches = state.stockBatches.map((batch) => ({ ...batch }));
        const reversedLines: StockTransferLine[] = [];

        // Reverse only the exact batches originally sent. If those units have since
        // been sold, adjusted, or transferred onward, refuse instead of taking unrelated stock.
        for (const line of transfer.items) {
          const source = products.find((product) => product.id === line.sourceProductId && product.branchId === transfer.fromBranchId);
          const destination = products.find((product) => product.id === line.destinationProductId && product.branchId === transfer.toBranchId);
          if (!source) return { ok: false, reason: 'source-product-missing' };
          if (!destination) return { ok: false, reason: 'destination-product-missing' };
          if (!Number.isFinite(line.quantity) || line.quantity <= 0 || destination.stock + epsilon < line.quantity) return { ok: false, reason: 'destination-stock-insufficient' };
          if (!Array.isArray(line.batchAllocations) || line.batchAllocations.length === 0) return { ok: false, reason: 'invalid-transfer' };
          const allocated = line.batchAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
          if (Math.abs(allocated - line.quantity) > epsilon) return { ok: false, reason: 'batch-reconciliation-failed' };

          const destinationStockBeforeReversal = Number(destination.stock) || 0;
          const sourceStockBeforeReversal = Number(source.stock) || 0;
          for (const allocation of line.batchAllocations) {
            const destinationBatchIndex = batches.findIndex((batch) => batch.id === allocation.destinationBatchId && batch.branchId === transfer.toBranchId && batch.productId === destination.id);
            if (destinationBatchIndex < 0) return { ok: false, reason: 'transferred-batch-missing' };
            const destinationBatch = batches[destinationBatchIndex];
            if (destinationBatch.quantity + epsilon < allocation.quantity) return { ok: false, reason: 'transferred-batch-insufficient' };
            batches[destinationBatchIndex] = { ...destinationBatch, quantity: Math.max(0, cleanQuantity(destinationBatch.quantity - allocation.quantity, quantityModeForProduct(destination))) };

            const sourceBatchIndex = batches.findIndex((batch) => batch.id === allocation.sourceBatchId && batch.branchId === transfer.fromBranchId && batch.productId === source.id);
            if (sourceBatchIndex >= 0) {
              batches[sourceBatchIndex] = { ...batches[sourceBatchIndex], quantity: cleanQuantity(batches[sourceBatchIndex].quantity + allocation.quantity, quantityModeForProduct(source)) };
            } else {
              batches.push({
                id: allocation.sourceBatchId, branchId: transfer.fromBranchId, productId: source.id,
                purchaseId: allocation.sourceBatchPurchaseId || '', supplierId: allocation.sourceBatchSupplierId || '',
                quantity: cleanQuantity(allocation.quantity, quantityModeForProduct(source)),
                receivedAt: allocation.sourceBatchReceivedAt || transfer.date, expiryDate: allocation.expiryDate || '', unitCost: allocation.unitCost,
              });
            }
          }

          const sourceStockAfterReversal = cleanQuantity(sourceStockBeforeReversal + line.quantity, quantityModeForProduct(source));
          const destinationStockAfterReversal = cleanQuantity(destinationStockBeforeReversal - line.quantity, quantityModeForProduct(destination));
          if (destinationStockAfterReversal < -epsilon || sourceStockAfterReversal < sourceStockBeforeReversal - epsilon) return { ok: false, reason: 'batch-reconciliation-failed' };

          const destinationRemainingBatches = batches.filter((batch) => batch.branchId === transfer.toBranchId && batch.productId === destination.id && batch.quantity > 0);
          const remainingBatchQty = destinationRemainingBatches.reduce((sum, batch) => sum + batch.quantity, 0);
          if (remainingBatchQty > destinationStockAfterReversal + epsilon) return { ok: false, reason: 'batch-reconciliation-failed' };
          const remainingBatchValue = destinationRemainingBatches.reduce((sum, batch) => sum + (batch.quantity * batch.unitCost), 0);
          const untrackedRemaining = Math.max(0, destinationStockAfterReversal - remainingBatchQty);
          const restoredToOriginalDestinationBalance = line.destinationStockBefore !== undefined
            && Math.abs(destinationStockAfterReversal - line.destinationStockBefore) <= epsilon;
          const destinationCostAfterReversal = restoredToOriginalDestinationBalance && line.destinationCostPriceBefore !== undefined
            ? line.destinationCostPriceBefore
            : destinationStockAfterReversal > epsilon
              ? (remainingBatchValue + untrackedRemaining * (Number(destination.costPrice) || 0)) / destinationStockAfterReversal
              : (line.destinationCostPriceBefore ?? Number(destination.costPrice) ?? 0);

          const sourceIndex = products.findIndex((product) => product.id === source.id && product.branchId === transfer.fromBranchId);
          const destinationIndex = products.findIndex((product) => product.id === destination.id && product.branchId === transfer.toBranchId);
          if (sourceIndex < 0 || destinationIndex < 0) return { ok: false, reason: 'invalid-transfer' };
          products[sourceIndex] = { ...products[sourceIndex], stock: sourceStockAfterReversal };
          products[destinationIndex] = { ...products[destinationIndex], stock: Math.max(0, destinationStockAfterReversal), costPrice: destinationCostAfterReversal };
          reversedLines.push({ ...line, sourceStockAfterReversal, destinationStockAfterReversal });
        }

        const now = new Date().toISOString();
        let commitApplied = false;
        set((current) => {
          const currentTransfer = current.stockTransfers.find((entry) => entry.id === transfer.id);
          if (!currentTransfer || currentTransfer.status !== 'completed') return current;
          const balancesStillMatch = transfer.items.every((line) => {
            const currentSource = current.products.find((product) => product.id === line.sourceProductId && product.branchId === transfer.fromBranchId);
            const currentDestination = current.products.find((product) => product.id === line.destinationProductId && product.branchId === transfer.toBranchId);
            const expectedSource = state.products.find((product) => product.id === line.sourceProductId && product.branchId === transfer.fromBranchId)?.stock;
            const expectedDestination = state.products.find((product) => product.id === line.destinationProductId && product.branchId === transfer.toBranchId)?.stock;
            return !!currentSource && !!currentDestination && expectedSource !== undefined && expectedDestination !== undefined
              && Math.abs(currentSource.stock - expectedSource) <= epsilon && Math.abs(currentDestination.stock - expectedDestination) <= epsilon;
          });
          const batchesStillMatch = transfer.items.every((line) => line.batchAllocations.every((allocation) => {
            const expectedDestinationBatch = state.stockBatches.find((batch) => batch.id === allocation.destinationBatchId && batch.branchId === transfer.toBranchId && batch.productId === line.destinationProductId);
            const currentDestinationBatch = current.stockBatches.find((batch) => batch.id === allocation.destinationBatchId && batch.branchId === transfer.toBranchId && batch.productId === line.destinationProductId);
            const expectedSourceBatch = state.stockBatches.find((batch) => batch.id === allocation.sourceBatchId && batch.branchId === transfer.fromBranchId && batch.productId === line.sourceProductId);
            const currentSourceBatch = current.stockBatches.find((batch) => batch.id === allocation.sourceBatchId && batch.branchId === transfer.fromBranchId && batch.productId === line.sourceProductId);
            return (expectedDestinationBatch ? !!currentDestinationBatch && Math.abs(currentDestinationBatch.quantity - expectedDestinationBatch.quantity) <= epsilon : !currentDestinationBatch)
              && (expectedSourceBatch ? !!currentSourceBatch && Math.abs(currentSourceBatch.quantity - expectedSourceBatch.quantity) <= epsilon : !currentSourceBatch);
          }));
          if (!balancesStillMatch || !batchesStillMatch) return current;
          commitApplied = true;
          const reversedTransfer: StockTransfer = {
            ...currentTransfer, items: currentTransfer.items.map((line) => reversedLines.find((entry) => entry.sourceProductId === line.sourceProductId) || line),
            status: 'reversed', reversedAt: now, reversedByUid: input.actor?.uid || '', reversedByEmail: input.actor?.email || '',
            reversedByName: input.actor?.name || input.actor?.email || 'Owner / Local User', reversalNote: (input.note || '').trim(),
          };
          const actorName = input.actor?.name || input.actor?.email || 'Owner / Local User';
          return {
            products: products.map((product) => ({ ...product })), stockBatches: batches.map((batch) => ({ ...batch })),
            stockTransfers: current.stockTransfers.map((entry) => entry.id === transfer.id ? reversedTransfer : entry),
            activityLogs: [
              { ...makeAudit('STOCK_TRANSFER_REVERSED_OUT', 'Stock Transfer', `${transfer.transferNo} ကို ${transfer.toBranchName || transfer.toBranchId} မှ ပြန်လက်ခံသည်။ ${reversedTransfer.reversalNote || 'မှတ်ချက်မရှိ'}`, transfer.id, transfer.fromBranchId), actor: actorName },
              { ...makeAudit('STOCK_TRANSFER_REVERSED_IN', 'Stock Transfer', `${transfer.transferNo} ကို ${transfer.fromBranchName || transfer.fromBranchId} သို့ ပြန်ပို့သည်။ ${reversedTransfer.reversalNote || 'မှတ်ချက်မရှိ'}`, transfer.id, transfer.toBranchId), actor: actorName },
              ...current.activityLogs,
            ].slice(0, 1000),
          };
        });
        if (!commitApplied) return { ok: false, reason: 'state-changed' };
        const committed = get();
        const finalTransfer = committed.stockTransfers.find((entry) => entry.id === transfer.id);
        const finalBalancesMatch = reversedLines.every((line) => {
          const source = committed.products.find((product) => product.id === line.sourceProductId && product.branchId === transfer.fromBranchId);
          const destination = committed.products.find((product) => product.id === line.destinationProductId && product.branchId === transfer.toBranchId);
          return !!source && !!destination
            && Math.abs(source.stock - (line.sourceStockAfterReversal ?? Number.NaN)) <= epsilon
            && Math.abs(destination.stock - (line.destinationStockAfterReversal ?? Number.NaN)) <= epsilon;
        });
        if (!finalTransfer || finalTransfer.status !== 'reversed' || !finalBalancesMatch) return { ok: false, reason: 'state-changed' };
        return { ok: true, transferId: transfer.id, transferNo: transfer.transferNo };
      },
      registerStockUnits: (input) => {
        const state = get();
        const branchId = input.branchId || state.activeBranchId;
        const product = state.products.find((entry) => entry.id === input.productId && (entry.branchId || DEFAULT_BRANCH_ID) === branchId);
        if (!product) return { ok: false, message: 'ရွေးချယ်ထားသော Product ကို ဒီဆိုင်မှာ မတွေ့ပါ။' };
        if (quantityModeForProduct(product) !== 'whole' || !Number.isInteger(product.stock)) {
          return { ok: false, message: 'Unit Barcode Registration ကို ပြည့်ကိန်း Stock ပစ္စည်းများမှာသာ အသုံးပြုနိုင်ပါတယ်။' };
        }
        if (!Array.isArray(input.units) || input.units.length === 0) return { ok: false, message: 'မှတ်ပုံတင်မည့် Barcode မရှိပါ။' };
        const productRegistries = state.stockUnitRegistries
          .filter((entry) => entry.branchId === branchId && entry.productId === product.id)
          .sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
        const existingInStock = productRegistries.flatMap((entry) => entry.units)
          .filter((unit) => unit.status === 'in_stock' || unit.status === 'reserved').length;
        const remaining = Math.max(0, Math.floor(product.stock) - existingInStock);
        if (input.units.length > remaining) {
          return { ok: false, message: `လက်ရှိ Stock မှာ Barcode အသစ်ထည့်နိုင်တာ ${remaining} ခုသာ ကျန်ပါတယ်။` };
        }
        const allRegistered = state.stockUnitRegistries.flatMap((entry) => entry.units.map((unit) => normalizeBarcode(unit.barcode)));
        const usedCodes = new Set(allRegistered);
        const productCodes = new Set(state.products.flatMap((entry) => [normalizeBarcode(entry.barcode), normalizeBarcode(entry.sku)]).filter(Boolean));
        const incoming: string[] = [];
        for (const unit of input.units) {
          const code = normalizeBarcode(unit.barcode);
          if (!code || code.length > 128 || /[^\x20-\x7E]/.test(code)) {
            return { ok: false, message: 'Barcode သည် ASCII စာလုံးဖြစ်ပြီး ၁၂၈ လုံးထက် မပိုရပါ။' };
          }
          if (usedCodes.has(code) || productCodes.has(code) || incoming.includes(code)) {
            return { ok: false, message: `Barcode တူညီပြီးသားရှိပါတယ်: ${code}` };
          }
          incoming.push(code);
        }
        const now = new Date().toISOString();
        const newUnits: StockUnit[] = input.units.map((entry) => ({
          id: newId(), barcode: normalizeBarcode(entry.barcode), barcodeSource: entry.barcodeSource,
          status: 'in_stock', registeredAt: now,
          ...(input.actorUid ? { registeredByUid: input.actorUid } : {}),
          ...(input.actorName ? { registeredByName: input.actorName } : {}),
          ...(entry.note?.trim() ? { note: entry.note.trim() } : {}),
        }));
        // Chunk registries by Product + Branch; never create one Firestore document per bottle.
        // 250 units/document leaves ample headroom below Firestore's 1 MiB document limit.
        const maxUnitsPerRegistry = 250;
        const nextProductRegistries = productRegistries.map((entry) => ({ ...entry, units: [...entry.units] }));
        let cursor = 0;
        while (cursor < newUnits.length) {
          const last = nextProductRegistries[nextProductRegistries.length - 1];
          if (last && last.units.length < maxUnitsPerRegistry) {
            const take = Math.min(maxUnitsPerRegistry - last.units.length, newUnits.length - cursor);
            last.units.push(...newUnits.slice(cursor, cursor + take));
            last.updatedAt = now;
            if (input.actorUid) last.updatedByUid = input.actorUid;
            cursor += take;
            continue;
          }
          const chunkIndex = nextProductRegistries.length
            ? Math.max(...nextProductRegistries.map((entry) => entry.chunkIndex ?? 0)) + 1
            : 0;
          const take = Math.min(maxUnitsPerRegistry, newUnits.length - cursor);
          nextProductRegistries.push({
            id: `unit-registry-${encodeURIComponent(branchId)}-${encodeURIComponent(product.id)}-${chunkIndex}`,
            branchId, productId: product.id, chunkIndex,
            units: newUnits.slice(cursor, cursor + take), updatedAt: now,
            ...(input.actorUid ? { updatedByUid: input.actorUid } : {}),
          });
          cursor += take;
        }
        const productRegistryIds = new Set(productRegistries.map((entry) => entry.id));
        const nextRegistryIds = new Set(nextProductRegistries.map((entry) => entry.id));
        set((current) => ({
          stockUnitRegistries: [
            ...current.stockUnitRegistries.filter((entry) => !productRegistryIds.has(entry.id) && !nextRegistryIds.has(entry.id)),
            ...nextProductRegistries,
          ],
          activityLogs: prependAudit(current.activityLogs, makeAudit('STOCK_UNIT_REGISTER', 'Stock Unit', `${product.name} အတွက် Unit Barcode ${newUnits.length} ခု မှတ်ပုံတင်သည်`, product.id, branchId)),
        }));
        return { ok: true, created: newUnits.length, remainingUnregistered: remaining - newUnits.length };
      },
      addSupplierPayment: (payment) => {
        const state = get();
        const purchase = state.purchases.find((entry) => entry.id === payment.purchaseId && entry.branchId === state.activeBranchId && entry.supplierId === payment.supplierId && entry.paymentTracking === 'tracked');
        if (!purchase || !Number.isFinite(payment.amount) || payment.amount <= 0) return false;
        const alreadyPaid = state.supplierPayments.filter((entry) => entry.branchId === state.activeBranchId && entry.purchaseId === purchase.id).reduce((sum, entry) => sum + entry.amount, 0);
        const returnedValue = state.purchaseReturns.filter((entry) => entry.branchId === state.activeBranchId && entry.purchaseId === purchase.id).reduce((sum, entry) => sum + entry.total, 0);
        const due = Math.max(0, purchase.total - alreadyPaid - returnedValue);
        if (due <= 0 || payment.amount > due) return false;
        const saved: SupplierPayment = { ...payment, branchId: state.activeBranchId, id: newId(), amount: payment.amount, date: payment.date || new Date().toISOString() };
        const activeShift = state.cashShifts.find((shift) => shift.branchId === state.activeBranchId && !shift.closedAt);
        const cashMovement: CashMovement | null = saved.paymentMethod === 'Cash' && activeShift ? {
          branchId: state.activeBranchId, id: newId(), shiftId: activeShift.id, date: saved.date, direction: 'out', amount: saved.amount,
          note: `Supplier payment · ${purchase.supplierName} · ${purchase.receiptNo}`,
        } : null;
        set((current) => ({
          supplierPayments: [saved, ...current.supplierPayments],
          cashMovements: cashMovement ? [cashMovement, ...current.cashMovements] : current.cashMovements,
          activityLogs: prependAudit(current.activityLogs, makeAudit('SUPPLIER_PAYMENT', 'Shared Supplier Ledger', `${purchase.supplierName} ကို ${saved.amount} MMK ပေးချေသည် · ${purchase.receiptNo}`, purchase.id, state.activeBranchId)),
        }));
        return true;
      },
      addPurchaseReturn: (purchaseId, quantity, note) => set((state) => {
        const purchase = state.purchases.find((entry) => entry.id === purchaseId && entry.branchId === state.activeBranchId);
        const qty = Number(quantity);
        const productForReturn = state.products.find((entry) => entry.id === purchase?.productId && entry.branchId === state.activeBranchId);
        if (!purchase || !productForReturn || !isValidQuantity(qty, quantityModeForProduct(productForReturn))) return state;
        const batch = state.stockBatches.find((entry) => entry.branchId === state.activeBranchId && entry.purchaseId === purchaseId && entry.productId === purchase.productId);
        const product = state.products.find((entry) => entry.id === purchase.productId && entry.branchId === state.activeBranchId);
        if (!batch || !product || qty > batch.quantity) return state;
        const date = new Date().toISOString();
        const total = qty * purchase.unitCost;
        const saved: PurchaseReturn = {
          branchId: state.activeBranchId, id: newId(), supplierId: purchase.supplierId, purchaseId, productId: purchase.productId,
          productName: purchase.productName, quantity: qty, unitCost: purchase.unitCost, total, date,
          note: note.trim(),
        };
        return {
          purchaseReturns: [saved, ...state.purchaseReturns],
          stockBatches: state.stockBatches.map((entry) => entry.id === batch.id && entry.branchId === state.activeBranchId ? { ...entry, quantity: cleanQuantity(entry.quantity - qty, quantityModeForProduct(product)) } : entry),
          products: state.products.map((entry) => entry.id === product.id && entry.branchId === state.activeBranchId ? { ...entry, stock: Math.max(0, entry.stock - qty) } : entry),
          activityLogs: prependAudit(state.activityLogs, makeAudit('PURCHASE_RETURN', 'Inventory', `${purchase.supplierName} သို့ ${purchase.productName} ${qty} ခု ပြန်ပို့သည် · ${total} MMK`, saved.id, state.activeBranchId)),
        };
      }),
      openCashShift: (openingCash, note = '', actor) => set((state) => {
        if (state.cashShifts.some((shift) => shift.branchId === state.activeBranchId && !shift.closedAt) || !Number.isFinite(openingCash) || openingCash < 0) return state;
        const shift: CashShift = { branchId: state.activeBranchId, id: newId(), openedAt: new Date().toISOString(), openedBy: actor?.name?.trim() || 'Local device user', ...(actor?.uid ? { openedByUid: actor.uid } : {}), openingCash, note };
        return { cashShifts: [shift, ...state.cashShifts], activityLogs: prependAudit(state.activityLogs, { ...makeAudit('OPEN_SHIFT', 'Cash shift', `ငွေကောင်တာဖွင့်သည် · အဖွင့်ငွေ ${openingCash} MMK`, shift.id, state.activeBranchId), actor: actor?.name?.trim() || 'Local device user', actorUid: actor?.uid }) };
      }),
      closeCashShift: (id, closingCash, expectedCash, note = '', actor) => set((state) => {
        const shift = state.cashShifts.find((entry) => entry.id === id && entry.branchId === state.activeBranchId && !entry.closedAt);
        if (!shift || !Number.isFinite(closingCash) || closingCash < 0) return state;
        const closedAt = new Date().toISOString();
        return {
          cashShifts: state.cashShifts.map((entry) => entry.id === id && entry.branchId === state.activeBranchId ? { ...entry, closedAt, closingCash, expectedCash, variance: closingCash - expectedCash, ...(actor?.uid ? { closedByUid: actor.uid } : {}), ...(actor?.name?.trim() ? { closedByName: actor.name.trim() } : {}), note: [entry.note, note].filter(Boolean).join(' · ') } : entry),
          activityLogs: prependAudit(state.activityLogs, { ...makeAudit('CLOSE_SHIFT', 'Cash shift', `ငွေကောင်တာပိတ်သည် · မျှော်မှန်း ${expectedCash} MMK · ရေတွက် ${closingCash} MMK`, id, state.activeBranchId), actor: actor?.name?.trim() || 'Local device user', actorUid: actor?.uid }),
        };
      }),
      addCashMovement: (movement) => set((state) => {
        const active = state.cashShifts.find((shift) => shift.id === movement.shiftId && shift.branchId === state.activeBranchId && !shift.closedAt);
        if (!active || !Number.isSafeInteger(movement.amount) || movement.amount <= 0 || !movement.note.trim()) return state;
        const saved: CashMovement = { ...movement, branchId: state.activeBranchId, id: newId(), date: new Date().toISOString() };
        return {
          cashMovements: [saved, ...state.cashMovements],
          activityLogs: prependAudit(state.activityLogs, { ...makeAudit(movement.direction === 'in' ? 'CASH_IN' : 'CASH_OUT', 'Cash movement', `${movement.note} · ${movement.amount} MMK`, saved.id, state.activeBranchId), actor: movement.createdByName || 'Local device user', actorUid: movement.createdByUid }),
        };
      }),
      addActivityLog: (entry) => set((state) => ({ activityLogs: prependAudit(state.activityLogs, { ...entry, branchId: state.activeBranchId, id: newId(), at: new Date().toISOString() }) })),
      holdItem: (item) => set((state) => {
        const existing = state.heldItems.find((entry) => entry.productId === item.productId && entry.branchId === state.activeBranchId);
        if (existing) {
          return { heldItems: state.heldItems.map((entry) => entry.productId === item.productId && entry.branchId === state.activeBranchId ? { ...entry, quantity: entry.quantity + item.quantity, heldAt: new Date().toISOString() } : entry) };
        }
        return { heldItems: [...state.heldItems, { ...item, branchId: state.activeBranchId, heldAt: new Date().toISOString() }] };
      }),
      restoreHeldItem: (productId) => {
        const held = get().heldItems.find((entry) => entry.productId === productId && entry.branchId === get().activeBranchId);
        if (held) set((state) => ({ heldItems: state.heldItems.filter((entry) => !(entry.productId === productId && entry.branchId === state.activeBranchId)) }));
        return held;
      },
      removeHeldItem: (productId) => set((state) => ({ heldItems: state.heldItems.filter((entry) => !(entry.productId === productId && entry.branchId === state.activeBranchId)) })),
      updateSettings: (changes) => set((state) => { const settings = { ...state.settings, ...changes }; return { settings, branches: state.branches.map((branch) => branch.id === state.activeBranchId ? { ...branch, name: changes.storeName?.trim() || branch.name, updatedAt: new Date().toISOString(), settings: { ...branch.settings, storeName: settings.storeName, currency: settings.currency, receiptFooter: settings.receiptFooter } } : branch) }; }),
      updateOwnerProfile: (changes) => set((state) => ({ ownerProfile: normalizeOwnerProfile({ ...normalizeOwnerProfile(state.ownerProfile), ...changes, updatedAt: new Date().toISOString() }) })),
      importData: (data) => set((state) => {
        const hasIncomingBranches = Array.isArray(data.branches) && data.branches.length > 0;
        const rawBranches = hasIncomingBranches ? data.branches as Branch[] : state.branches;
        // Explicitly type the normalized list as Branch[] so optional legacy fields
        // such as logoUrl/bannerUrl remain compatible with Branch when a default
        // branch is inserted for an empty/older backup.
        let nextBranches: Branch[] = rawBranches.map((branch) => ({
          ...makeDefaultBranch(state.settings),
          ...branch,
          status: branch.status === 'archived' ? 'archived' as const : 'active' as const,
          settings: { ...makeDefaultBranch(state.settings).settings, ...(branch.settings || {}) },
          logoUrl: branch.logoUrl || '', bannerUrl: branch.bannerUrl || '',
        }));
        if (!nextBranches.length) nextBranches = [makeDefaultBranch(state.settings)];
        const defaultBranchId = nextBranches.find((branch) => branch.isDefault)?.id || nextBranches[0].id;
        nextBranches = nextBranches.map((branch) => ({ ...branch, isDefault: branch.id === defaultBranchId }));
        if (!nextBranches.some((branch) => branch.status === 'active')) {
          nextBranches = nextBranches.map((branch) => branch.id === defaultBranchId ? { ...branch, status: 'active' } : branch);
        }
        const requestedActiveId = typeof data.activeBranchId === 'string' ? data.activeBranchId : (hasIncomingBranches ? state.activeBranchId : defaultBranchId);
        const nextActiveBranchId = nextBranches.some((branch) => branch.id === requestedActiveId && branch.status === 'active') ? requestedActiveId : defaultBranchId;
        const normalizeBranchRecords = <T extends { branchId?: string }>(incoming: unknown, current: T[]): T[] => {
          if (!Array.isArray(incoming)) return current;
          const validIds = new Set(nextBranches.map((branch) => branch.id));
          return (incoming as T[]).map((record) => ({ ...record, branchId: record.branchId && validIds.has(record.branchId) ? record.branchId : defaultBranchId }));
        };
        const nextProducts = normalizeBranchRecords<Product>(data.products, state.products).map((product) => ({ ...product, quantityMode: product.quantityMode || inferQuantityMode(product.unit) }));
        const nextSales = normalizeBranchRecords<Sale>(data.sales, state.sales);
        const nextExpenses = normalizeBranchRecords<Expense>(data.expenses, state.expenses);
        const nextCashierSettlements = normalizeBranchRecords<CashierSettlementRecord>(data.cashierSettlements, state.cashierSettlements);
        const nextBranchFinanceLedgerEntries = normalizeBranchRecords<BranchFinanceLedgerEntry>(data.branchFinanceLedgerEntries, state.branchFinanceLedgerEntries);
        const nextCashierAdvanceReconciliations = normalizeBranchRecords<CashierAdvanceReconciliationRecord>(data.cashierAdvanceReconciliations, state.cashierAdvanceReconciliations);
        const nextBranchFinanceReconciliations = normalizeBranchRecords<BranchFinanceReconciliationRecord>(data.branchFinanceReconciliations, state.branchFinanceReconciliations);
        const nextHeldItems = normalizeBranchRecords<HeldItem>(data.heldItems, state.heldItems);
        const nextCustomerPayments = normalizeBranchRecords<CustomerPayment>(data.customerPayments, state.customerPayments);
        const nextPurchases = normalizeBranchRecords<Purchase>(data.purchases, state.purchases);
        const nextSupplierPayments = normalizeBranchRecords<SupplierPayment>(data.supplierPayments, state.supplierPayments);
        const nextPurchaseReturns = normalizeBranchRecords<PurchaseReturn>(data.purchaseReturns, state.purchaseReturns);
        const nextStockBatches = ensureStockBatchCoverage(nextProducts, normalizeBranchRecords<StockBatch>(data.stockBatches, state.stockBatches));
        const nextStockReceipts = normalizeBranchRecords<StockReceipt>(data.stockReceipts, state.stockReceipts);
        const nextStockTransfers = Array.isArray(data.stockTransfers) ? data.stockTransfers as StockTransfer[] : state.stockTransfers;
        const nextStockShipments = Array.isArray(data.stockShipments) ? data.stockShipments as BranchStockShipment[] : state.stockShipments;
        const nextCashShifts = normalizeBranchRecords<CashShift>(data.cashShifts, state.cashShifts);
        const nextCashMovements = normalizeBranchRecords<CashMovement>(data.cashMovements, state.cashMovements);
        const nextActivityLogs = normalizeBranchRecords<ActivityLog>(data.activityLogs, state.activityLogs);
        const incomingCategories = Array.isArray(data.categories) ? (data.categories as Category[]).map((category, index) => ({ ...category, branchId: nextBranches.some((branch) => branch.id === category.branchId) ? category.branchId : defaultBranchId, color: category.color || ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#db2777', '#64748b'][index % 6], isActive: category.isActive !== false, createdAt: category.createdAt || new Date().toISOString() })) : [];
        const categories = incomingCategories.length ? incomingCategories : nextBranches.flatMap((branch) => {
          const names = [...new Set([...DEFAULT_CATEGORY_NAMES, ...nextProducts.filter((product) => product.branchId === branch.id).map((product) => product.category).filter(Boolean)])];
          return makeDefaultCategories(branch.id, names);
        });
        const incomingSettings = data.settings && typeof data.settings === 'object' ? { ...state.settings, ...data.settings } : state.settings;
        const selectedBranch = nextBranches.find((branch) => branch.id === nextActiveBranchId)!;
        const settings = {
          ...incomingSettings,
          storeName: !hasIncomingBranches && data.settings && typeof data.settings === 'object' ? incomingSettings.storeName : (selectedBranch.settings.storeName || selectedBranch.name),
          currency: selectedBranch.settings.currency || incomingSettings.currency || 'MMK',
          receiptFooter: selectedBranch.settings.receiptFooter || incomingSettings.receiptFooter || defaultSettings.receiptFooter,
        };
        if (!hasIncomingBranches && data.settings && typeof data.settings === 'object') {
          nextBranches = nextBranches.map((branch) => branch.id === nextActiveBranchId ? { ...branch, name: settings.storeName || branch.name, settings: { storeName: settings.storeName || branch.name, currency: settings.currency, receiptFooter: settings.receiptFooter } } : branch);
        }
        return {
          branches: nextBranches, activeBranchId: nextActiveBranchId, categories,
          products: nextProducts, priceGroups: Array.isArray(data.priceGroups) ? data.priceGroups : state.priceGroups, sales: nextSales, expenses: nextExpenses, cashierSettlements: nextCashierSettlements, branchFinanceLedgerEntries: nextBranchFinanceLedgerEntries, cashierAdvanceReconciliations: nextCashierAdvanceReconciliations, branchFinanceReconciliations: nextBranchFinanceReconciliations, heldItems: nextHeldItems,
          customers: Array.isArray(data.customers) ? data.customers : state.customers,
          suppliers: Array.isArray(data.suppliers) ? data.suppliers : state.suppliers,
          customerPayments: nextCustomerPayments, purchases: nextPurchases, supplierPayments: nextSupplierPayments,
          purchaseReturns: nextPurchaseReturns, stockBatches: nextStockBatches, stockReceipts: nextStockReceipts, stockTransfers: nextStockTransfers, stockShipments: nextStockShipments, stockUnitRegistries: Array.isArray(data.stockUnitRegistries) ? data.stockUnitRegistries : state.stockUnitRegistries, cashShifts: nextCashShifts,
          cashMovements: nextCashMovements, activityLogs: nextActivityLogs, ownerProfile: data.ownerProfile ? normalizeOwnerProfile({ ...normalizeOwnerProfile(state.ownerProfile), ...data.ownerProfile }) : normalizeOwnerProfile(state.ownerProfile), settings,
        };
      }),
      clearAllData: () => set({ branches: [makeDefaultBranch()], activeBranchId: DEFAULT_BRANCH_ID, categories: makeDefaultCategories(DEFAULT_BRANCH_ID), products: [], sales: [], expenses: [], cashierSettlements: [], branchFinanceLedgerEntries: [], cashierAdvanceReconciliations: [], branchFinanceReconciliations: [], heldItems: [], customers: [], suppliers: [], customerPayments: [], purchases: [], supplierPayments: [], purchaseReturns: [], stockBatches: [], stockReceipts: [], stockTransfers: [], stockShipments: [], stockUnitRegistries: [], priceGroups: [], cashShifts: [], cashMovements: [], activityLogs: [], ownerProfile: defaultOwnerProfile, settings: defaultSettings }),
    }),
    {
      name: POS_PERSIST_STORAGE_KEY,
      storage: createJSONStorage(() => persistentStateStorage),
      version: 20,
      migrate: migrateState,
      // Also normalize same-version or partially-written legacy snapshots on every hydration.
      merge: (persistedState, currentState) => {
        const persisted = persistedState && typeof persistedState === 'object'
          ? persistedState as Partial<PosState>
          : {};
        return {
          ...currentState,
          ...persisted,
          products: Array.isArray(persisted.products) ? persisted.products.map((product) => ({ ...product, quantityMode: product.quantityMode || inferQuantityMode(product.unit) })) : currentState.products,
        priceGroups: Array.isArray(persisted.priceGroups) ? persisted.priceGroups : currentState.priceGroups,
          stockUnitRegistries: Array.isArray(persisted.stockUnitRegistries) ? persisted.stockUnitRegistries : currentState.stockUnitRegistries,
          cashierSettlements: Array.isArray(persisted.cashierSettlements) ? persisted.cashierSettlements : currentState.cashierSettlements,
          branchFinanceLedgerEntries: Array.isArray(persisted.branchFinanceLedgerEntries) ? persisted.branchFinanceLedgerEntries : currentState.branchFinanceLedgerEntries,
          cashierAdvanceReconciliations: Array.isArray(persisted.cashierAdvanceReconciliations) ? persisted.cashierAdvanceReconciliations : currentState.cashierAdvanceReconciliations,
          branchFinanceReconciliations: Array.isArray(persisted.branchFinanceReconciliations) ? persisted.branchFinanceReconciliations : currentState.branchFinanceReconciliations,
          ownerProfile: normalizeOwnerProfile(persisted.ownerProfile ?? currentState.ownerProfile),
        };
      },
      partialize: (state) => ({
        branches: state.branches, activeBranchId: state.activeBranchId, categories: state.categories,
        products: state.products, priceGroups: state.priceGroups, sales: state.sales, expenses: state.expenses, cashierSettlements: state.cashierSettlements, branchFinanceLedgerEntries: state.branchFinanceLedgerEntries, cashierAdvanceReconciliations: state.cashierAdvanceReconciliations, branchFinanceReconciliations: state.branchFinanceReconciliations, heldItems: state.heldItems,
        customers: state.customers, suppliers: state.suppliers, customerPayments: state.customerPayments,
        purchases: state.purchases, supplierPayments: state.supplierPayments, purchaseReturns: state.purchaseReturns, stockBatches: state.stockBatches, stockReceipts: state.stockReceipts, stockTransfers: state.stockTransfers, stockShipments: state.stockShipments, stockUnitRegistries: state.stockUnitRegistries, cashShifts: state.cashShifts,
        cashMovements: state.cashMovements, activityLogs: state.activityLogs, ownerProfile: state.ownerProfile, settings: state.settings,
      }) as PosState,
    },
  ),
);


/** Wait for the current persisted POS snapshot to reach browser storage. */
export async function flushPosStorePersistence(): Promise<'indexeddb' | 'localstorage'> {
  const options = usePosStore.persist.getOptions();
  const currentState = usePosStore.getState();
  const persistedState = options.partialize ? options.partialize(currentState) : currentState;
  const serialized = JSON.stringify({ state: persistedState, version: options.version ?? 0 });
  if (typeof serialized !== 'string') throw new Error('POS Data ကို JSON ပြောင်းမရပါ။');
  // Zustand's PersistOptions types allow name to be undefined even though this
  // store always configures a stable key. Fall back safely for strict TS builds.
  const storageKey = typeof options.name === 'string' && options.name.trim()
    ? options.name
    : POS_PERSIST_STORAGE_KEY;
  return writePosStateDurably(storageKey, serialized);
}
