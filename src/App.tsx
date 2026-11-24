import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, AlertTriangle, ArchiveRestore, ArrowDownToLine, ArrowUpRight, BarChart3, ChevronDown,
  Boxes, Camera, Check, CircleDollarSign, ClipboardList, Cloud, CloudOff, CreditCard, Download,
  FileJson, LayoutDashboard, LockKeyhole, Minus, PackagePlus,
  Plus, Printer, Receipt, RefreshCw, Search, Settings, ShoppingBag, ShoppingCart, Copy,
  Smartphone, Store, Trash2, TrendingUp, Truck, Wallet, X, Users, CalendarClock, UserRound, Sun, Moon, LogOut, PackageCheck, Send, ShieldCheck, ScanLine, RotateCcw,
} from 'lucide-react';
import {
  usePosStore, flushPosStorePersistence, DEFAULT_CASHIER_EXPENSE_APPROVAL_LIMIT, type Branch, type CartItem, type Expense, type PriceMode, type Product, type Sale, type StockBatch, type StockUnitSelection,
} from './store/usePosStore';
import { CustomerCreditPage, ExpiryTrackingPage, SupplierPurchasePage } from './components/BusinessPages';
const StockReceivingPage = lazy(() => import('./components/StockReceivingPage').then((module) => ({ default: module.StockReceivingPage })));
const StockTransferPage = lazy(() => import('./components/StockTransferPage').then((module) => ({ default: module.StockTransferPage })));
const BranchShipmentManagementPage = lazy(() => import('./components/BranchShipmentManagementPage').then((module) => ({ default: module.BranchShipmentManagementPage })));
const BranchStockReceivingPage = lazy(() => import('./components/BranchStockReceivingPage').then((module) => ({ default: module.BranchStockReceivingPage })));
import { ActivityLogPage, CashManagementPage } from './components/OperationsPages';
import { ExpenseManagementPage } from './components/ExpenseManagementPage';
import { CashierSettlementManagementPage } from './components/CashierSettlementManagementPage';
import { BranchFinanceManagementPage } from './components/BranchFinanceManagementPage';
import { AnalyticsPage } from './components/AnalyticsPage';
import type { CashierSettlementCreateInput, CashierSettlementRecord } from './types/finance';
const CloudSyncPanel = lazy(() => import('./components/CloudSyncPanel').then((module) => ({ default: module.CloudSyncPanel })));
import { useBusinessAccess, canAccessBranch, canUsePage } from './lib/businessAccess';
import { useAppDialog } from './components/AppDialog';
import { checkKpayReference, normalizeKpayReference } from './lib/kpayReference';
import { firebaseApp, firebaseAuth, firebaseConfigured, FIREBASE_BUSINESS_ID } from './lib/firebase';
import { signOut } from 'firebase/auth';
const BranchManagementPage = lazy(() => import('./components/BranchManagementPage').then((module) => ({ default: module.BranchManagementPage })));
const SharedPricingPage = lazy(() => import('./components/SharedPricingPage').then((module) => ({ default: module.SharedPricingPage })));
const ProfileManagementPage = lazy(() => import('./components/ProfileManagementPage').then((module) => ({ default: module.ProfileManagementPage })));
const LoginPage = lazy(() => import('./components/LoginPage').then((module) => ({ default: module.LoginPage })));
import { BrandMark } from './components/BrandMark';
import { ListLimitToggle } from './components/ListLimitToggle';
const BarcodeCameraScanner = lazy(() => import('./components/BarcodeCameraScanner').then((module) => ({ default: module.BarcodeCameraScanner })));
const StockUnitRegistrationPage = lazy(() => import('./components/StockUnitRegistrationPage').then((module) => ({ default: module.StockUnitRegistrationPage })));
const CashierSalesQueueStatus = lazy(() => import('./components/CashierSalesQueueStatus').then((module) => ({ default: module.CashierSalesQueueStatus })));
import { normalizeBarcode } from './lib/barcode';
import { findUnitMatches, isUnitSellable, productIsUnitTracked, unitAvailabilityMessage } from './lib/unitTracking';
import { buildBranchOverview } from './lib/branchOverview';
import { POS_ALL_CATEGORIES, filterPosProducts, isProductSelectable, otherBranchProductCounts, posProductViewState, productsForBranch, sellableStockFor } from './lib/posProductSelection';
import { cleanCurrencyAmount, computeCashPaymentState, describeKpayUnavailable, isPaymentMethodSelectable, kpayUnavailableReason } from './lib/posPaymentState';
import { AUTO_SYNC_STATUS_EVENT, readAutoSyncStatus, type AutoSyncStatus } from './lib/autoSyncStatus';
import { submitCashierSale } from './lib/cashierSalesSync';
import { flushPendingCashierExpenses, submitCashierExpenseToCloud } from './lib/cashierExpenseSync';
import { makeAdjustmentRequestId, returnSaleOnServer, voidSaleOnServer } from './lib/saleAdjustments';
import { SaleReturnDialog, type SaleReturnSubmission } from './components/SaleReturnDialog';
import { exportLocalImages, importLocalImages, migrateDataUrlImage, useLocalImageSource } from './lib/localImages';
import { isAllowedKpayQrDataUrl } from './lib/kpayQr';
import { isKpayEnabled } from './lib/kpayAccount';
import { cleanQuantity, formatQuantity, hasLegacyFractionalQuantity, inferQuantityMode, isValidQuantity, quantityModeForProduct, quantityStep, type QuantityMode } from './lib/quantity';
import { getStorageHealth, STORAGE_HEALTH_EVENT } from './lib/persistentStateStorage';
import { announceLocalDataReplacement, markLocalDataReplacement } from './lib/syncSafety';
import { makeReceiptNo } from './lib/receiptNumber';
import { RuntimeBadge } from './components/RuntimeBadge';

type Page = 'profile' | 'branches' | 'overview' | 'pricing' | 'dashboard' | 'pos' | 'inventory' | 'receiving' | 'unitReceiving' | 'transfers' | 'shipments' | 'branchReceiving' | 'sales' | 'customers' | 'purchasing' | 'expiry' | 'cash' | 'activity' | 'expenses' | 'settlements' | 'finance' | 'analytics' | 'settings';
const POS_PRODUCT_PAGE_SIZE = 96;
type ProductDraft = {
  name: string; sku: string; barcode: string; category: string; costPrice: string; retailPrice: string;
  wholesalePrice: string; stock: string; lowStockAt: string; unit: string; quantityMode: QuantityMode;
  tracksIndividualUnits: boolean;
};

const emptyDraft: ProductDraft = {
  name: '', sku: '', barcode: '', category: 'အထွေထွေ', costPrice: '0', retailPrice: '0',
  wholesalePrice: '0', stock: '0', lowStockAt: '5', unit: 'ခု', quantityMode: 'whole', tracksIndividualUnits: false,
};
const money = (value: number, currency = 'MMK') => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value || 0))} ${currency}`;
const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const today = () => dayKey(new Date());
const makeSortableId = (prefix: string) => `${prefix}-${String(9999999999999 - Date.now()).padStart(13, '0')}-${crypto.randomUUID().slice(0, 8)}`;

async function copyAccessValue(
  value: string,
  label: string,
  fallbackPrompt: (value: string, label: string) => Promise<unknown>,
  onCopied?: (message: string) => void,
) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(value);
    if (onCopied) onCopied(`${label} ကို ကူးယူပြီးပါပြီ။`);
  } catch {
    await fallbackPrompt(value, label);
  }
}

function App() {
  const dialog = useAppDialog();
  const [page, setPage] = useState<Page>('dashboard');
  const [localStateHydrated, setLocalStateHydrated] = useState(() => usePosStore.persist.hasHydrated());
  const access = useBusinessAccess();
  const cashierMode = access.status === 'active' && access.role === 'cashier';
  const canUseCloudAdjustments = Boolean(firebaseAuth?.currentUser) && access.status === 'active';
  const [autoSyncStatus, setAutoSyncStatus] = useState<AutoSyncStatus>(() => readAutoSyncStatus(access.uid || ''));
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [manualSyncPending, setManualSyncPending] = useState(false);
  const manualSyncTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const uid = access.uid || '';
    setAutoSyncStatus(readAutoSyncStatus(uid));
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; status?: AutoSyncStatus }>).detail;
      if (!detail?.status || (uid && detail.uid && detail.uid !== uid)) return;
      setAutoSyncStatus(detail.status);
      if (detail.status.state !== 'connecting') {
        setManualSyncPending(false);
        if (manualSyncTimerRef.current !== undefined) {
          window.clearTimeout(manualSyncTimerRef.current);
          manualSyncTimerRef.current = undefined;
        }
      }
    };
    const onOnline = () => setIsOnline(true);
    const onOffline = () => {
      setIsOnline(false);
      setManualSyncPending(false);
    };
    window.addEventListener(AUTO_SYNC_STATUS_EVENT, onStatus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener(AUTO_SYNC_STATUS_EVENT, onStatus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (manualSyncTimerRef.current !== undefined) window.clearTimeout(manualSyncTimerRef.current);
    };
  }, [access.uid]);
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem('minimart-ui-theme-v1');
      if (stored === 'dark' || stored === 'light') return stored;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch { return 'light'; }
  });
  const [toast, setToast] = useState('');
  const [toastActionPage, setToastActionPage] = useState<Page | null>(null);
  const [installPrompt, setInstallPrompt] = useState<(() => Promise<void>) | null>(null);
  const [showProductModal, setShowProductModal] = useState(false);
  const [returnSale, setReturnSale] = useState<Sale | null>(null);
  const [adjustmentBusy, setAdjustmentBusy] = useState(false);
  const [cameraScannerTarget, setCameraScannerTarget] = useState<'product' | 'pos' | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyDraft);
  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(POS_ALL_CATEGORIES);
  const [visibleProductCount, setVisibleProductCount] = useState(POS_PRODUCT_PAGE_SIZE);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState('လက်လီဝယ်သူ');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'KPay' | 'Credit'>('Cash');
  const [kpayTransactionReference, setKpayTransactionReference] = useState('');
  const [discount, setDiscount] = useState('0');
  const [saleSearch, setSaleSearch] = useState('');
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [pendingPersistenceSale, setPendingPersistenceSale] = useState<Sale | null>(null);
  const [savingSale, setSavingSale] = useState(false);
  const [checkoutResultSale, setCheckoutResultSale] = useState<Sale | null>(null);
  const [showCheckoutResult, setShowCheckoutResult] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [cashReceived, setCashReceived] = useState('');
  const [showHeldItems, setShowHeldItems] = useState(false);
  const [amountOnlyMode, setAmountOnlyMode] = useState(false);
  const [printTestMode, setPrintTestMode] = useState(false);
  const [paperWidth, setPaperWidth] = useState<'58' | '80'>(() => {
    try { return localStorage.getItem('minimart-printer-paper-width-v1') === '58' ? '58' : '80'; }
    catch { return '80'; }
  });
  const [chartPeriod, setChartPeriod] = useState<'7' | '30' | '365'>('7');
  const [settingsTab, setSettingsTab] = useState<'store' | 'backup' | 'cloud'>('store');
  const [inventoryExpanded, setInventoryExpanded] = useState(false);
  const [salesExpanded, setSalesExpanded] = useState(false);
  const [saleFilter, setSaleFilter] = useState<'all' | 'Cash' | 'KPay' | 'Credit' | 'voided'>('all');
  const importRef = useRef<HTMLInputElement>(null);
  const ownerOverviewRedirected = useRef(false);
  // Synchronous re-entry lock. State updates are async, so two fast taps can
  // both pass the savingSale check before React re-renders the button.
  const checkoutInFlight = useRef(false);

  const allProducts = usePosStore((s) => s.products);
  const allPriceGroups = usePosStore((s) => s.priceGroups);
  const allSales = usePosStore((s) => s.sales);
  const allExpenses = usePosStore((s) => s.expenses);
  const allCashierSettlements = usePosStore((s) => s.cashierSettlements);
  const allCustomerPayments = usePosStore((s) => s.customerPayments);
  const allCashShifts = usePosStore((s) => s.cashShifts);
  const allHeldItems = usePosStore((s) => s.heldItems);
  const customers = usePosStore((s) => s.customers);
  const allStockBatches = usePosStore((s) => s.stockBatches);
  const stockUnitRegistries = usePosStore((s) => s.stockUnitRegistries);
  const allCategories = usePosStore((s) => s.categories);
  const branches = usePosStore((s) => s.branches);
  const activeBranchId = usePosStore((s) => s.activeBranchId);
  const activeBranch = branches.find((branch) => branch.id === activeBranchId);
  const activeBranches = branches.filter((branch) => branch.status === 'active' && canAccessBranch(access.role, access.branchIds, branch.id));
  // Keep existing shared-price groups manageable even after one member branch is archived.
  const canManageSharedPricing = !cashierMode && (activeBranches.length > 1 || allPriceGroups.some((group) => group.status === 'active'));
  const products = useMemo(() => productsForBranch(allProducts, activeBranchId), [allProducts, activeBranchId]);
  const otherBranchProducts = useMemo(
    () => otherBranchProductCounts(activeBranches, allProducts, activeBranchId),
    [activeBranches, allProducts, activeBranchId],
  );
  const sales = useMemo(() => allSales.filter((record) => record.branchId === activeBranchId), [allSales, activeBranchId]);
  const expenses = useMemo(() => allExpenses.filter((record) => record.branchId === activeBranchId), [allExpenses, activeBranchId]);
  const visibleExpenses = useMemo(() => cashierMode ? expenses.filter((record) => record.createdByUid === access.uid) : expenses, [expenses, cashierMode, access.uid]);
  const branchCashierSettlements = useMemo(() => allCashierSettlements.filter((record) => record.branchId === activeBranchId), [allCashierSettlements, activeBranchId]);
  const visibleCashierSettlements = useMemo(() => cashierMode ? branchCashierSettlements.filter((record) => record.cashierUid === access.uid) : branchCashierSettlements, [branchCashierSettlements, cashierMode, access.uid]);
  const heldItems = useMemo(() => allHeldItems.filter((record) => record.branchId === activeBranchId), [allHeldItems, activeBranchId]);
  const stockBatches = useMemo(() => allStockBatches.filter((record) => record.branchId === activeBranchId), [allStockBatches, activeBranchId]);
  const categories = useMemo(() => allCategories.filter((category) => category.branchId === activeBranchId && category.isActive).map((category) => category.name), [allCategories, activeBranchId]);
  const settings = usePosStore((s) => s.settings);
  const ownerProfile = usePosStore((s) => s.ownerProfile);
  const activeBranchLogoSource = useLocalImageSource(activeBranch?.logoUrl);
  const activeBranchBannerSource = useLocalImageSource(activeBranch?.bannerUrl);
  // Render only a validated in-document raster QR, even if a remote document was tampered with.
  const branchKpayEnabled = isKpayEnabled(activeBranch?.settings);
  const paymentMethodsEnabled = cart.length > 0;
  // Before the first cloud snapshot the local branch is a placeholder, so an
  // empty product list or KPay warning would describe the wrong state.
  const posProductView = posProductViewState(products.length, autoSyncStatus.state);
  const posDataLoading = posProductView === 'loading';
  const posDataUnavailable = posProductView === 'offline';
  const posDataSettled = posProductView === 'ready' || posProductView === 'empty';
  const kpaySelectable = posDataSettled && isPaymentMethodSelectable('KPay', { cartCount: cart.length, kpaySettings: activeBranch?.settings });
  const kpayUnavailable = posDataSettled ? kpayUnavailableReason(activeBranch?.settings) : null;
  const branchKpayQrSource = branchKpayEnabled && isAllowedKpayQrDataUrl(activeBranch?.settings.kpayQrDataUrl) ? (activeBranch?.settings.kpayQrDataUrl || '') : '';
  const ownerPhotoSource = useLocalImageSource(ownerProfile?.photoUrl);
  const setActiveBranch = usePosStore((s) => s.setActiveBranch);
  const addProduct = usePosStore((s) => s.addProduct);
  const updateProduct = usePosStore((s) => s.updateProduct);
  const deleteProduct = usePosStore((s) => s.deleteProduct);
  const addCategory = usePosStore((s) => s.addCategory);
  const adjustStock = usePosStore((s) => s.adjustStock);
  const addSale = usePosStore((s) => s.addSale);
  const updateSaleCloudSyncStatus = usePosStore((s) => s.updateSaleCloudSyncStatus);
  const voidSale = usePosStore((s) => s.voidSale);
  const applySaleReturn = usePosStore((s) => s.applySaleReturn);
  const addExpense = usePosStore((s) => s.addExpense);
  const updateExpense = usePosStore((s) => s.updateExpense);
  const deleteExpense = usePosStore((s) => s.deleteExpense);
  const addCashierSettlement = usePosStore((s) => s.addCashierSettlement);
  const holdItem = usePosStore((s) => s.holdItem);
  const restoreHeldItem = usePosStore((s) => s.restoreHeldItem);
  const updateSettings = usePosStore((s) => s.updateSettings);
  const importData = usePosStore((s) => s.importData);
  const clearAllData = usePosStore((s) => s.clearAllData);

  useEffect(() => {
    if (usePosStore.persist.hasHydrated()) { setLocalStateHydrated(true); return; }
    const unsubscribe = usePosStore.persist.onFinishHydration(() => setLocalStateHydrated(true));
    // Close the small race between the first check and listener registration.
    if (usePosStore.persist.hasHydrated()) setLocalStateHydrated(true);
    return unsubscribe;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    try { localStorage.setItem('minimart-ui-theme-v1', themeMode); } catch { /* Theme still works for this session. */ }
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = themeMode === 'dark' ? '#000000' : '#f2f2f7';
  }, [themeMode]);

  useEffect(() => {
    try { localStorage.setItem('minimart-printer-paper-width-v1', paperWidth); } catch { /* Printer preference remains active for this session. */ }
  }, [paperWidth]);

  useEffect(() => {
    const resetTestMode = () => setPrintTestMode(false);
    window.addEventListener('afterprint', resetTestMode);
    return () => window.removeEventListener('afterprint', resetTestMode);
  }, []);

  useEffect(() => {
    if (!localStateHydrated) return;
    if (cashierMode && !access.branchIds.includes(activeBranchId)) {
      const firstAllowed = branches.find((branch) => branch.status === 'active' && access.branchIds.includes(branch.id));
      if (firstAllowed) { setActiveBranch(firstAllowed.id); setPage('dashboard'); setCart([]); }
    }
  }, [localStateHydrated, cashierMode, access.branchIds, activeBranchId, branches, setActiveBranch]);

  // Multi-branch Owners start at the business overview. Single-branch businesses
  // retain the familiar branch dashboard as their landing page.
  useEffect(() => {
    if (!localStateHydrated || cashierMode) return;
    if (activeBranches.length < 2) {
      ownerOverviewRedirected.current = false;
      return;
    }
    if (!ownerOverviewRedirected.current && page === 'dashboard') {
      ownerOverviewRedirected.current = true;
      setPage('overview');
    }
  }, [localStateHydrated, cashierMode, activeBranches.length, page]);

  useEffect(() => {
    if (cashierMode || page !== 'overview' || activeBranches.length !== 1) return;
    if (activeBranchId !== activeBranches[0].id) setActiveBranch(activeBranches[0].id);
    setPage('dashboard');
  }, [cashierMode, page, activeBranches, activeBranchId, setActiveBranch]);

  useEffect(() => {
    if (!localStateHydrated) return;
    if (cashierMode && !canUsePage(access.role, page, access.canReceiveStock)) setPage('pos');
  }, [localStateHydrated, cashierMode, access.role, access.canReceiveStock, page]);

  useEffect(() => {
    if (branchKpayEnabled || paymentMethod !== 'KPay') return;
    setPaymentMethod('Cash');
    setKpayTransactionReference('');
  }, [branchKpayEnabled, paymentMethod]);

  // An empty cart has no payment choice; never leave a stale method selected.
  useEffect(() => {
    if (cart.length > 0) return;
    setPaymentMethod('Cash');
    setCashReceived('');
    setKpayTransactionReference('');
  }, [cart.length]);

  useEffect(() => {
    const listener = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as Event & { prompt: () => Promise<void> };
      setInstallPrompt(() => async () => { await promptEvent.prompt(); setInstallPrompt(null); });
    };
    window.addEventListener('beforeinstallprompt', listener);
    return () => window.removeEventListener('beforeinstallprompt', listener);
  }, []);

  const notify = (message: string) => {
    setToastActionPage(null);
    setToast(message);
    window.setTimeout(() => setToast(''), 4200);
  };

  useEffect(() => {
    const showStorageWarning = (detail?: { state?: string; message?: string } | null) => {
      if (detail?.state === 'fallback' || detail?.state === 'error') {
        setToast(detail.message || 'Browser Storage ပြဿနာရှိနေပါတယ်။');
      }
    };
    // Hydration can finish before React mounts, so also inspect the last state.
    showStorageWarning(getStorageHealth());
    const onStorageHealth = (event: Event) => {
      showStorageWarning((event as CustomEvent<{ state?: string; message?: string }>).detail);
    };
    window.addEventListener(STORAGE_HEALTH_EVENT, onStorageHealth);
    return () => window.removeEventListener(STORAGE_HEALTH_EVENT, onStorageHealth);
  }, []);

  useEffect(() => {
    const onShipmentNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number; shipmentNos?: string[]; fromBranchName?: string }>).detail || {};
      const count = Math.max(1, Number(detail.count) || 1);
      const firstShipment = Array.isArray(detail.shipmentNos) ? detail.shipmentNos[0] : '';
      const summary = count === 1 && firstShipment
        ? `ကုန်ပို့စာရင်း ${firstShipment} ရောက်ရှိနေပါပြီ။ ရောက်လာသောကုန် စစ်ဆေးရန်ကို ဖွင့်ပါ။`
        : `${detail.fromBranchName || 'အခြားဆိုင်ခွဲ'} မှ ကုန်ပို့စာရင်း ${count} ခု ရောက်ရှိနေပါပြီ။ ရောက်လာသောကုန် စစ်ဆေးရန်ကို ဖွင့်ပါ။`;
      setToastActionPage('branchReceiving');
      setToast(summary);
      window.setTimeout(() => { setToast(''); setToastActionPage(null); }, 4500);
    };
    window.addEventListener('minimart-branch-shipment-notification', onShipmentNotification);
    return () => window.removeEventListener('minimart-branch-shipment-notification', onShipmentNotification);
  }, []);
  const authorize = async (action: string) => {
    if (cashierMode) { notify('ဒီလုပ်ဆောင်ချက်အတွက် Owner ခွင့်ပြုချက် လိုအပ်ပါတယ်။'); return false; }
    const pin = await dialog.prompt({
      title: 'Admin PIN အတည်ပြုရန်',
      message: action,
      label: 'Admin PIN ထည့်ပါ',
      inputType: 'password',
      inputMode: 'numeric',
      placeholder: 'PIN ထည့်ပါ',
      confirmLabel: 'အတည်ပြုမည်',
    });
    if (pin === null) return false;
    if (pin !== settings.adminPin) { notify('Admin PIN မှားယွင်းနေပါတယ်။'); return false; }
    return true;
  };
  const handleVoidSale = async (sale: Sale) => {
    if (sale.status !== 'completed') return;
    if (!cashierMode && !(await authorize('Voucher ပယ်ဖျက်ရန်'))) return;
    if ((sale.returnCount || 0) > 0 || (sale.returnedTotal || 0) > 0) {
      notify('Return ပြုလုပ်ပြီးသား Voucher ကို Void မလုပ်နိုင်ပါ။ Owner ကို ဆက်သွယ်ပါ။');
      return;
    }
    const reason = await dialog.prompt({
      title: 'Voucher ပယ်ဖျက်ရန် (Void)',
      message: `Voucher ${sale.receiptNo} ကို ပယ်ဖျက်ရသည့် အကြောင်းပြချက်ကို ဖြည့်ပါ။`,
      label: 'အကြောင်းပြချက်',
      defaultValue: sale.voidRequestReason || '',
      placeholder: 'ဥပမာ - ပစ္စည်းမှားရိုက်မိသည်',
      required: true,
      minLength: 3,
      confirmLabel: 'ရှေ့ဆက်မည်',
    });
    if (!reason || reason.trim().length < 3) return;
    const confirmed = await dialog.confirm({
      title: 'Voucher Void အတည်ပြုရန်',
      message: `Voucher ${sale.receiptNo} ကို Void လုပ်မလား။ Stock ကို Cloud မှာ တစ်ကြိမ်တည်း ပြန်ပေါင်းပါမယ်။ ငွေပြန်အမ်းမှု Status ကို သီးခြား မှတ်တမ်းတင်ပါမယ်။`,
      confirmLabel: 'Void လုပ်မည်',
      tone: 'danger',
    });
    if (!confirmed) return;
    const actor = {
      uid: access.uid || firebaseAuth?.currentUser?.uid || '',
      email: access.email || firebaseAuth?.currentUser?.email || '',
      name: access.displayName || firebaseAuth?.currentUser?.displayName || access.email || (cashierMode ? 'Cashier' : 'Owner'),
    };
    if (adjustmentBusy) return;
    setAdjustmentBusy(true);
    try {
      if (firebaseAuth?.currentUser && access.status === 'active') {
        const response = await voidSaleOnServer({
          saleId: sale.id, branchId: sale.branchId || activeBranchId,
          requestId: makeAdjustmentRequestId('void', sale.id), reason: reason.trim(),
        });
        const applied = voidSale(sale.id, reason.trim(), actor, response.occurredAt);
        if (!applied) throw new Error('Cloud Void အောင်မြင်သော်လည်း Local Sale ကို ပြင်မရပါ။ Refresh လုပ်ပြီး အခြေအနေကို စစ်ပါ။');
        const refundText = response.refundStatus === 'kpay-pending'
          ? ' KPay ငွေပြန်အမ်းမှုကို Pending အဖြစ် မှတ်ထားပါတယ်။'
          : response.refundStatus === 'cash-refunded' ? ' Cash ငွေပြန်အမ်းမှုကို မှတ်တမ်းတင်ထားပါတယ်။' : '';
        notify(`Voucher ကို Void လုပ်ပြီး Stock ပြန်ပေါင်းထားပါတယ်။${refundText} Audit Log သိမ်းပြီးပါပြီ။`);
        return;
      }
      if (cashierMode) throw new Error('Void အတွက် Firebase Cloud Login လိုအပ်ပါတယ်။');
      const applied = voidSale(sale.id, reason.trim(), actor);
      if (!applied) throw new Error('ဒီ Device ရဲ့ Local Sale ကို ပြင်မရပါ။ Data ကို Refresh လုပ်ပြီး စစ်ဆေးပါ။');
      notify('Voucher ကို ဒီ Device တွင် Void လုပ်ပြီး Stock ပြန်ပေါင်းထားပါတယ်။ Cloud မချိတ်ထားလို့ Audit ကို Local သာ သိမ်းထားပါတယ်။');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Voucher Void မအောင်မြင်ပါ။');
    } finally {
      setAdjustmentBusy(false);
    }
  };
  const handleReturnSubmit = async (submission: SaleReturnSubmission) => {
    if (!returnSale || adjustmentBusy) return;
    if (!firebaseAuth?.currentUser || access.status !== 'active') {
      notify('Return အတွက် Firebase Cloud Login လိုအပ်ပါတယ်။');
      return;
    }
    setAdjustmentBusy(true);
    try {
      const actor = {
        uid: access.uid || firebaseAuth.currentUser.uid,
        email: access.email || firebaseAuth.currentUser.email || '',
        name: access.displayName || firebaseAuth.currentUser.displayName || access.email || 'User',
      };
      const response = await returnSaleOnServer({
        saleId: returnSale.id, branchId: returnSale.branchId || activeBranchId,
        requestId: submission.requestId, reason: submission.reason,
        items: submission.items, refundReference: submission.refundReference,
      });
      const applied = applySaleReturn({
        returnId: response.returnId || submission.requestId,
        saleId: returnSale.id, branchId: returnSale.branchId || activeBranchId,
        at: response.occurredAt || new Date().toISOString(), actor,
        reason: submission.reason, items: response.items || [],
        returnedValue: response.value || 0,
        refundStatus: response.refundStatus || 'none',
        refundAmount: response.refundAmount || 0,
        dueAmount: response.dueAmount,
        returnedProductQuantities: response.returnedProductQuantities,
        returnedBatchQuantities: response.returnedBatchQuantities,
      });
      if (!applied) throw new Error('Cloud Return အောင်မြင်သော်လည်း Local Sale ကို ပြင်မရပါ။ Refresh လုပ်ပြီး အခြေအနေကို စစ်ပါ။');
      const refundText = response.refundStatus === 'kpay-pending'
        ? ' KPay Refund ကို Pending အဖြစ် မှတ်ထားပါတယ်။'
        : response.refundStatus === 'credit-adjusted' || response.refundStatus === 'credit-refund-review'
          ? ' Credit လက်ကျန်ကို ချိန်ညှိထားပါတယ်။' : '';
      notify(`Return ကို မှတ်တမ်းတင်ပြီးပါပြီ။${refundText}`);
      setReturnSale(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Return မအောင်မြင်ပါ။');
    } finally {
      setAdjustmentBusy(false);
    }
  };
  const confirmBranchChange = async (targetName: string) => {
    if (savingSale || pendingPersistenceSale || showCheckoutResult) {
      notify('လက်ရှိအရောင်း/Receipt လုပ်ငန်းစဉ်ကို အရင်ပြီးစီးပါ။ ပြီးမှ ဆိုင်ပြောင်းနိုင်ပါတယ်။');
      return false;
    }
    if (cart.length > 0) {
      return dialog.confirm({
        title: 'ဆိုင်ခွဲပြောင်းရန် အတည်ပြုပါ',
        message: `လက်ရှိ ${activeBranch?.name || 'ဆိုင်'} Cart ထဲမှာ ပစ္စည်း ${cart.length} မျိုး ရှိနေပါတယ်။ ${targetName} သို့ ပြောင်းပါက လက်ရှိ Cart ကို ရှင်းလင်းပါမယ်။ ဆက်လုပ်မလား?`,
        confirmLabel: 'Cart ရှင်းပြီး ပြောင်းမည်',
        tone: 'danger',
      });
    }
    return true;
  };
  const resetBranchScopedPosUi = () => {
    setCart([]); setDiscount('0'); setCashReceived(''); setShowPaymentModal(false);
    setLastSale(null); setCheckoutResultSale(null); setShowCheckoutResult(false); setAmountOnlyMode(false);
    setCustomer('လက်လီဝယ်သူ'); setPaymentMethod('Cash'); setKpayTransactionReference('');
    setShowHeldItems(false); setCategoryFilter('အားလုံး'); setProductSearch('');
  };
  const switchBranch = async (branchId: string) => {
    if (branchId === 'all') {
      if (cashierMode) { notify('ဆိုင်အားလုံး Dashboard ကို Owner သာ ကြည့်ရှုနိုင်ပါတယ်။'); return; }
      if (savingSale || pendingPersistenceSale || showPaymentModal || showCheckoutResult) {
        notify('လက်ရှိ ငွေရှင်း/Receipt လုပ်ငန်းစဉ်ကို အရင်ပြီးစီးပါ။ ပြီးမှ ဆိုင်အားလုံးကို ကြည့်နိုင်ပါတယ်။');
        return;
      }
      setPage('overview');
      return;
    }
    if (!canAccessBranch(access.role, access.branchIds, branchId)) { notify('ဒီဆိုင်ကို ဝင်ခွင့်မရှိပါ။ Owner ကို ဆက်သွယ်ပါ။'); return; }
    if (branchId === activeBranchId) {
      if (page === 'overview' || page === 'branches') setPage('dashboard');
      return;
    }
    if (!cashierMode && !(await authorize('ဆိုင်ခွဲပြောင်းရန်'))) return;
    const target = branches.find((branch) => branch.id === branchId);
    if (!(await confirmBranchChange(target?.name || 'ရွေးချယ်ထားသောဆိုင်'))) return;
    setActiveBranch(branchId);
    resetBranchScopedPosUi();
    setPage('dashboard');
    notify(`${target?.name || 'ဆိုင်'} သို့ ပြောင်းပြီးပါပြီ။`);
  };
  const viewBranchInventory = async (branchId: string) => {
    if (!canAccessBranch(access.role, access.branchIds, branchId)) { notify('ဒီဆိုင်ကို ဝင်ခွင့်မရှိပါ။ Owner ကို ဆက်သွယ်ပါ။'); return; }
    if (branchId !== activeBranchId) {
      if (!cashierMode && !(await authorize('ဆိုင်ခွဲ Inventory ဖွင့်ရန်'))) return;
      const target = branches.find((branch) => branch.id === branchId);
      if (!(await confirmBranchChange(target?.name || 'ရွေးချယ်ထားသောဆိုင်'))) return;
      setActiveBranch(branchId);
      resetBranchScopedPosUi();
    }
    setPage('inventory');
    const target = branches.find((branch) => branch.id === branchId);
    notify(`${target?.name || 'ဆိုင်'} Inventory ကို ဖွင့်ထားပါတယ်။`);
  };

const openManualCopyPrompt = (value: string, label: string) => dialog.prompt({
  title: `${label} ကို ကိုယ်တိုင် Copy လုပ်ပါ`,
  label,
  defaultValue: value,
  readOnlyCopy: true,
});
  const visibleSales = useMemo(() => cashierMode ? sales.filter((sale) => sale.createdByUid === access.uid) : sales, [sales, cashierMode, access.uid]);
  const validSales = useMemo(() => visibleSales.filter((sale) => sale.status === 'completed'), [visibleSales]);
  const todaySales = useMemo(() => validSales.filter((sale) => dayKey(new Date(sale.date)) === today()), [validSales]);
  const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.total, 0);
  const todayProfit = todaySales.reduce((sum, sale) => sum + sale.profit, 0);
  // Different units (pieces, bottles, kg, litres) must not be added into one meaningless total.
  const stockedProductCount = products.filter((product) => product.stock > 0).length;
  const legacyFractionalStockCount = products.filter((product) => hasLegacyFractionalQuantity(product.stock, quantityModeForProduct(product))).length;
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const expiredBatchUnits = useMemo(() => {
    const totals = new Map<string, number>();
    stockBatches.forEach((batch) => { if (batch.expiryDate && batch.expiryDate < today() && batch.quantity > 0) totals.set(batch.productId, (totals.get(batch.productId) || 0) + batch.quantity); });
    return totals;
  }, [stockBatches]);
  const sellableStock = (product: Product) => sellableStockFor(product, expiredBatchUnits);
  const lowStockProducts = useMemo(
    () => products.filter((product) => Math.max(0, product.stock - (expiredBatchUnits.get(product.id) || 0)) <= product.lowStockAt),
    [products, expiredBatchUnits],
  );
  const filteredProducts = useMemo(
    () => filterPosProducts(products, productSearch, categoryFilter),
    [products, productSearch, categoryFilter],
  );
  // Inventory has no category selector; keep it independent of the POS category filter.
  const inventoryProducts = useMemo(
    () => filterPosProducts(products, productSearch, POS_ALL_CATEGORIES),
    [products, productSearch],
  );
  // Branch-scoped search/category state must not hide products after a branch switch.
  useEffect(() => {
    setCategoryFilter(POS_ALL_CATEGORIES);
    setProductSearch('');
    setVisibleProductCount(POS_PRODUCT_PAGE_SIZE);
  }, [activeBranchId]);
  const visibleProducts = useMemo(() => filteredProducts.slice(0, visibleProductCount), [filteredProducts, visibleProductCount]);
  const subtotal = cleanCurrencyAmount(cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
  const maxCashierDiscountPercent = Math.max(0, Math.min(100, Number(settings.maxCashierDiscountPercent ?? 10)));
  const maxAllowedDiscount = cashierMode ? Math.floor(subtotal * (maxCashierDiscountPercent / 100)) : subtotal;
  const discountValue = Math.max(0, Math.min(maxAllowedDiscount, Number(discount) || 0));
  const checkoutTotal = cleanCurrencyAmount(Math.max(0, subtotal - discountValue));
  const cartProfit = cleanCurrencyAmount(cart.reduce((sum, item) => sum + (item.unitPrice - item.costPrice) * item.quantity, 0) - discountValue);
  const filteredSales = visibleSales.filter((sale) => {
    const matchesSearch = sale.receiptNo.toLowerCase().includes(saleSearch.toLowerCase()) || sale.customer.toLowerCase().includes(saleSearch.toLowerCase());
    if (!matchesSearch) return false;
    if (saleFilter === 'all') return true;
    if (saleFilter === 'voided') return sale.status === 'voided';
    return sale.status !== 'voided' && sale.paymentMethod === saleFilter;
  });

  const trend = useMemo(() => {
    if (chartPeriod === '365') {
      return Array.from({ length: 12 }, (_, index) => {
        const date = new Date();
        date.setDate(1);
        date.setMonth(date.getMonth() - (11 - index));
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        return {
          key,
          label: date.toLocaleDateString('en-US', { month: 'short' }),
          value: validSales.filter((sale) => {
            const saleDate = new Date(sale.date);
            return `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}` === key;
          }).reduce((sum, sale) => sum + sale.total, 0),
        };
      });
    }
    const days = Number(chartPeriod);
    return Array.from({ length: days }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - index));
      const key = dayKey(date);
      return {
        key,
        label: date.toLocaleDateString('en-US', { day: 'numeric', month: days > 7 ? 'short' : undefined }),
        value: validSales.filter((sale) => dayKey(new Date(sale.date)) === key).reduce((sum, sale) => sum + sale.total, 0),
      };
    });
  }, [chartPeriod, validSales]);
  const trendMax = Math.max(1, ...trend.map((item) => item.value));
  const openNewProduct = () => {
    setEditingProduct(null);
    setProductDraft(emptyDraft);
    setShowProductModal(true);
  };
  const openEditProduct = (product: Product) => {
    setEditingProduct(product);
    setProductDraft({
      name: product.name, sku: product.sku, barcode: product.barcode || '', category: product.category,
      costPrice: String(product.costPrice), retailPrice: String(product.retailPrice),
      wholesalePrice: String(product.wholesalePrice), stock: String(product.stock),
      lowStockAt: String(product.lowStockAt), unit: product.unit, quantityMode: quantityModeForProduct(product),
      tracksIndividualUnits: productIsUnitTracked(product, stockUnitRegistries, activeBranchId),
    });
    setShowProductModal(true);
  };
  const saveProduct = (event: FormEvent) => {
    event.preventDefault();
    if (!productDraft.name.trim()) { notify('ပစ္စည်းအမည် ဖြည့်ပါ။'); return; }
    if (!categories.includes(productDraft.category)) { notify('လက်ရှိဆိုင်အတွက် Category ရွေးပါ သို့မဟုတ် အသစ်ထည့်ပါ။'); return; }
    const unit = productDraft.unit.trim() || 'ခု';
    const quantityMode = productDraft.quantityMode || inferQuantityMode(unit);
    const tracksIndividualUnits = productDraft.tracksIndividualUnits;
    const stock = Math.max(0, Number(productDraft.stock) || 0);
    const lowStockAt = Math.max(0, Number(productDraft.lowStockAt) || 0);
    const stockChanged = !editingProduct || Math.abs(stock - editingProduct.stock) > 1e-8;
    const modeChanged = !!editingProduct && quantityMode !== quantityModeForProduct(editingProduct);
    const hasRegisteredUnits = !!editingProduct && stockUnitRegistries.some((registry) => registry.branchId === activeBranchId && registry.productId === editingProduct.id && registry.units.length > 0);
    const wasTracked = !!editingProduct && productIsUnitTracked(editingProduct, stockUnitRegistries, activeBranchId);
    if (tracksIndividualUnits && quantityMode !== 'whole') { notify('Individual Unit Tracking ကို ပြည့်ကိန်းယူနစ်ပစ္စည်းများတွင်သာ ဖွင့်နိုင်ပါတယ်။'); return; }
    if (tracksIndividualUnits && !wasTracked && stock !== 0) { notify('Unit Tracking ဖွင့်မည့် Product မှာ လက်ရှိ Stock မရှိရပါ။ ကုန်ကို Unit Barcode Scan Receiving ဖြင့်သာ လက်ခံပါ။'); return; }
    if (!tracksIndividualUnits && hasRegisteredUnits) { notify('Unit Barcode History ရှိနေသေးလို့ Individual Unit Tracking ကို ပိတ်မရပါ။'); return; }
    if ((stockChanged || modeChanged) && !isValidQuantity(stock, quantityMode, true)) {
      notify(quantityMode === 'whole' ? 'ဒီပစ္စည်းကို အရေအတွက်ပြည့်ကိန်းသာ ထည့်နိုင်ပါတယ်။ လက်ရှိလက်ကျန် ဒသမရှိပါက တကယ်ရေတွက်ပြီး Stock ကို ပြင်ပါ။' : 'ဒသမအရေအတွက်ကို အများဆုံး ၃ နေရာအထိ ထည့်နိုင်ပါတယ်။');
      return;
    }
    if (!isValidQuantity(lowStockAt, quantityMode, true)) { notify('Low Stock Alert ကို သတ်မှတ်ထားသော ယူနစ်ပုံစံနဲ့ ကိုက်ညီအောင် ထည့်ပါ။'); return; }
    const payload = {
      name: productDraft.name.trim(), sku: productDraft.sku.trim() || `SKU-${Date.now().toString().slice(-6)}`,
      barcode: normalizeBarcode(productDraft.barcode) || undefined,
      category: productDraft.category, costPrice: Math.max(0, Number(productDraft.costPrice) || 0),
      retailPrice: Math.max(0, Number(productDraft.retailPrice) || 0),
      wholesalePrice: Math.max(0, Number(productDraft.wholesalePrice) || 0),
      stock, lowStockAt, unit, quantityMode, tracksIndividualUnits,
    };
    const normalizedSku = normalizeBarcode(payload.sku);
    const normalizedBarcode = normalizeBarcode(payload.barcode);
    const duplicateCode = products.some((product) => {
      if (product.id === editingProduct?.id) return false;
      const existingSku = normalizeBarcode(product.sku);
      const existingBarcode = normalizeBarcode(product.barcode);
      return (!!normalizedSku && (existingSku === normalizedSku || existingBarcode === normalizedSku))
        || (!!normalizedBarcode && (existingSku === normalizedBarcode || existingBarcode === normalizedBarcode));
    });
    if (duplicateCode) { notify('ဒီဆိုင်မှာ SKU သို့မဟုတ် Barcode နံပါတ် တူညီပြီးသားရှိပါတယ်။'); return; }
    if (editingProduct) {
      updateProduct(editingProduct.id, payload);
    } else if (!addProduct(payload)) {
      notify('ဒီဆိုင်မှာ SKU / Barcode တူညီပြီးသားရှိပါတယ်။');
      return;
    }
    setShowProductModal(false);
    notify(editingProduct ? 'ပစ္စည်းအချက်အလက် ပြင်ဆင်ပြီးပါပြီ။' : 'ပစ္စည်းအသစ် ထည့်ပြီးပါပြီ။');
  };

  const isTrackedProduct = (product: Product) => productIsUnitTracked(product, stockUnitRegistries, activeBranchId);
  const addToCart = (product: Product) => {
    if (isTrackedProduct(product)) { notify('ဒီပစ္စည်းကို Sticker Barcode Scan ဖြင့်သာ Cart ထဲထည့်နိုင်ပါတယ်။ Factory EAN/UPC နဲ့ မရောင်းပါ။'); return; }
    if (!(product.retailPrice > 0)) { notify('ဒီပစ္စည်းရဲ့ လက်လီဈေး မသတ်မှတ်ရသေးပါ။ Inventory မှာ ဈေးထည့်ပါ။'); return; }
    const available = sellableStock(product);
    if (available <= 0) { notify('ရောင်းချနိုင်သော Stock မရှိပါ။ Expiry Date ကို စစ်ဆေးပါ။'); return; }
    const mode = quantityModeForProduct(product);
    setCart((current) => {
      const found = current.find((item) => item.productId === product.id);
      if (found) {
        const increment = mode === 'decimal' ? 0.1 : 1;
        if (found.quantity + increment > available + 1e-8) { notify('သက်တမ်းမကုန်သေးသော လက်ကျန် Stock ထက် ပိုမရောင်းနိုင်ပါ။'); return current; }
        return current.map((item) => item.productId === product.id ? { ...item, quantity: cleanQuantity(item.quantity + increment, mode) } : item);
      }
      const initialQty = mode === 'decimal' ? Math.min(1, cleanQuantity(available, 'decimal')) : 1;
      return [...current, {
        productId: product.id, name: product.name, sku: product.sku, quantity: initialQty,
        unitPrice: product.retailPrice, costPrice: product.costPrice, mode: 'retail', stockAtAdd: product.stock,
        unit: product.unit, quantityMode: mode, priceGroupId: product.priceGroupId, priceVersion: product.priceVersion,
      }];
    });
  };
  const addScannedProductToCart = (rawCode: string) => {
    const code = normalizeBarcode(rawCode);
    if (!code) return;
    const allUnitMatches = findUnitMatches(stockUnitRegistries, code);
    const branchUnitMatches = allUnitMatches.filter((entry) => entry.branchId === activeBranchId);
    if (allUnitMatches.length > 0 && branchUnitMatches.length === 0) {
      notify('ဒီ Sticker Unit က အခြားဆိုင်ခွဲမှာ ရှိနေပါတယ်။ လက်ရှိ POS ဆိုင်နဲ့ မကိုက်ညီပါ။');
      setProductSearch('');
      return;
    }
    if (branchUnitMatches.length > 1) {
      notify('ဒီ Barcode ကို Unit နှစ်ခုမှာ တွေ့နေပါတယ်။ Owner က Barcode Registry ကို စစ်ဆေးရန်လိုပါတယ်။');
      setProductSearch('');
      return;
    }
    if (branchUnitMatches.length === 1) {
      const match = branchUnitMatches[0];
      const product = productMap.get(match.productId);
      if (!product) { notify('Sticker Unit ရဲ့ Product ကို ဒီဆိုင်မှာ မတွေ့ပါ။'); setProductSearch(''); return; }
      if (!isUnitSellable(match.unit)) { notify(unitAvailabilityMessage(match.unit.status)); setProductSearch(''); return; }
      if (!(product.retailPrice > 0)) { notify('ဒီပစ္စည်းရဲ့ လက်လီဈေး မသတ်မှတ်ရသေးပါ။'); setProductSearch(''); return; }
      if (sellableStock(product) <= 0) { notify('ရောင်းချနိုင်သော Stock မရှိပါ။'); setProductSearch(''); return; }
      const selection: StockUnitSelection = {
        registryId: match.registryId, unitId: match.unit.id, barcode: normalizeBarcode(match.unit.barcode),
        ...(match.unit.batchId ? { batchId: match.unit.batchId } : {}),
      };
      let duplicateScan = false;
      let insufficient = false;
      setCart((current) => {
        if (current.some((item) => (item.stockUnitSelections || []).some((entry) => entry.unitId === selection.unitId))) {
          duplicateScan = true;
          return current;
        }
        const found = current.find((item) => item.productId === product.id);
        if (found) {
          if (found.quantity + 1 > sellableStock(product) + 1e-8) { insufficient = true; return current; }
          return current.map((item) => item.productId === product.id ? {
            ...item, quantity: item.quantity + 1,
            stockUnitSelections: [...(item.stockUnitSelections || []), selection],
          } : item);
        }
        return [...current, {
          productId: product.id, name: product.name, sku: product.sku, quantity: 1,
          unitPrice: product.retailPrice, costPrice: product.costPrice, mode: 'retail', stockAtAdd: product.stock,
          unit: product.unit, quantityMode: quantityModeForProduct(product), priceGroupId: product.priceGroupId,
          priceVersion: product.priceVersion, stockUnitSelections: [selection],
        }];
      });
      if (duplicateScan) notify('ဒီ Sticker Unit ကို Cart ထဲ ထည့်ပြီးသားဖြစ်ပါတယ်။ ထပ်မရောင်းနိုင်ပါ။');
      else if (insufficient) notify('သက်တမ်းမကုန်သေးသော လက်ကျန် Stock ထက် ပိုမရောင်းနိုင်ပါ။');
      else notify(`${product.name} · Unit ${selection.barcode} ကို Cart ထဲ ထည့်ပြီးပါပြီ။`);
      setProductSearch('');
      return;
    }
    const match = products.find((product) => normalizeBarcode(product.barcode) === code || normalizeBarcode(product.sku) === code);
    if (!match) { notify(`Barcode မတွေ့ပါ: ${code}`); setProductSearch(''); return; }
    if (isTrackedProduct(match)) {
      notify('ဒီပစ္စည်းက Individual Unit Tracking သုံးထားပါတယ်။ Factory EAN/UPC မဟုတ်ဘဲ ပစ္စည်းတစ်ခုချင်း Sticker Barcode ကို Scan ပါ။');
      setProductSearch('');
      return;
    }
    addToCart(match);
    setProductSearch('');
  };
  const handleCameraBarcodeDetected = (rawCode: string) => {
    const target = cameraScannerTarget;
    setCameraScannerTarget(null);
    if (target === 'product') {
      setProductDraft((current) => ({ ...current, barcode: normalizeBarcode(rawCode) }));
      notify('Barcode ဖတ်ပြီးပါပြီ။ ပစ္စည်းအချက်အလက်ကို စစ်ပြီး Save လုပ်ပါ။');
    } else if (target === 'pos') {
      addScannedProductToCart(rawCode);
    }
  };
  const changeCartQty = (productId: string, quantity: number) => {
    const product = productMap.get(productId);
    if (quantity <= 0) { setCart((items) => items.filter((item) => item.productId !== productId)); return; }
    const tracked = !!product && isTrackedProduct(product);
    if (tracked) {
      const current = cart.find((item) => item.productId === productId);
      if (!current) return;
      if (quantity > current.quantity + 1e-8) { notify('Unit Tracking ပစ္စည်းကို Sticker Barcode Scan ဖြင့်သာ တစ်ခုချင်း ထပ်ထည့်နိုင်ပါတယ်။'); return; }
      const removeCount = Math.round(current.quantity - quantity);
      const selections = current.stockUnitSelections || [];
      if (removeCount <= 0) return;
      if (selections.length < removeCount) { notify('Barcode Unit Selection နဲ့ ပမာဏ မကိုက်ညီပါ။ Cart ကို ရှင်းပြီး ပြန် Scan ပါ။'); return; }
      setCart((items) => items.map((item) => item.productId === productId ? {
        ...item, quantity: Math.round(quantity * 1000) / 1000,
        stockUnitSelections: selections.slice(0, selections.length - removeCount),
      } : item));
      return;
    }
    if (product && (!isValidQuantity(quantity, quantityModeForProduct(product)) || quantity > sellableStock(product) + 1e-8)) { notify(quantityModeForProduct(product) === 'whole' ? 'ဒီပစ္စည်းကို အရေအတွက်ပြည့်ကိန်းသာ ရောင်းနိုင်ပါတယ်။' : 'အရေအတွက်ကို ဒသမ ၃ နေရာအထိ ထည့်ပါ။ Stock ထက် မပိုရပါ။'); return; }
    setCart((items) => items.map((item) => item.productId === productId ? { ...item, quantity: Math.round(quantity * 1000) / 1000 } : item));
  };
  const changePriceMode = (item: CartItem, mode: PriceMode) => {
    const product = productMap.get(item.productId);
    const unitPrice = mode === 'retail' ? (product?.retailPrice ?? item.unitPrice) : (product?.wholesalePrice ?? item.unitPrice);
    if (!(unitPrice > 0)) { notify(mode === 'retail' ? 'လက်လီဈေး မသတ်မှတ်ရသေးပါ။' : 'လက်ကားဈေး မသတ်မှတ်ရသေးပါ။'); return; }
    setCart((items) => items.map((entry) => entry.productId === item.productId ? { ...entry, mode, unitPrice } : entry));
  };
  const setAside = (item: CartItem) => {
    if ((item.stockUnitSelections || []).length) {
      notify('Sticker Unit ပါဝင်တဲ့ Cart Line ကို မယူတော့စာရင်းသိမ်းမရပါ။ မလိုချင်တဲ့ Unit ကို အနုတ်ခလုတ်နဲ့ ဖယ်ပါ။');
      return;
    }
    holdItem(item);
    setCart((items) => items.filter((entry) => entry.productId !== item.productId));
    notify('မယူတော့သောပစ္စည်းစာရင်းထဲ သိမ်းပြီးပါပြီ။');
  };
  const restoreHeld = (productId: string) => {
    const heldProduct = productMap.get(productId);
    if (!heldProduct) { notify('ဒီပစ္စည်းကို လက်ရှိဆိုင်စာရင်းတွင် မတွေ့ပါ။'); return; }
    if (isTrackedProduct(heldProduct)) { notify('Unit Tracking ပစ္စည်းကို Sticker Barcode ပြန် Scan ပြီးမှ Cart ထဲထည့်ပါ။'); return; }
    const heldEntry = heldItems.find((entry) => entry.productId === productId);
    if (!heldEntry) return;
    const mode = quantityModeForProduct(heldProduct);
    const existingQty = cart.find((item) => item.productId === productId)?.quantity || 0;
    const nextQty = cleanQuantity(existingQty + heldEntry.quantity, mode);
    if (nextQty > sellableStock(heldProduct) + 1e-8) {
      notify(`${heldProduct.name} Stock မလုံလောက်ပါ။`);
      return;
    }
    const held = restoreHeldItem(productId);
    if (!held) return;
    setCart((items) => {
      const existing = items.find((item) => item.productId === productId);
      if (existing) return items.map((item) => item.productId === productId ? { ...item, quantity: cleanQuantity(item.quantity + held.quantity, mode) } : item);
      const { heldAt, ...rest } = held;
      void heldAt;
      return [...items, rest];
    });
    notify('ပစ္စည်းကို Cart ထဲ ပြန်ထည့်ပြီးပါပြီ။');
  };
  const validateCheckout = (): boolean => {
    if (cashierMode && (Number(discount) || 0) > maxAllowedDiscount) {
      notify(`Cashier အနေဖြင့် အများဆုံး ${maxCashierDiscountPercent}% (${money(maxAllowedDiscount, settings.currency)}) အထိသာ Discount ပေးနိုင်ပါတယ်။`);
      return false;
    }
    if (!cart.length) { notify('ရောင်းချမည့်ပစ္စည်း မရှိသေးပါ။'); return false; }

    // A shared price may have changed while this cart was open. Refresh the
    // affected line snapshots and require the cashier to review the new total
    // before starting or completing checkout.
    const staleSharedPriceIds = new Set(cart.filter((item) => {
      const product = productMap.get(item.productId);
      if (!product || !(item.priceGroupId || product.priceGroupId)) return false;
      const currentPrice = item.mode === 'wholesale' ? product.wholesalePrice : product.retailPrice;
      return item.priceGroupId !== product.priceGroupId
        || item.priceVersion !== product.priceVersion
        || !Number.isFinite(currentPrice)
        || Math.abs(item.unitPrice - currentPrice) > 1e-8;
    }).map((item) => item.productId));
    if (staleSharedPriceIds.size) {
      setCart((items) => items.map((item) => {
        if (!staleSharedPriceIds.has(item.productId)) return item;
        const product = productMap.get(item.productId);
        if (!product) return item;
        const currentPrice = item.mode === 'wholesale' ? product.wholesalePrice : product.retailPrice;
        return {
          ...item,
          name: product.name,
          sku: product.sku,
          unitPrice: Number.isFinite(currentPrice) ? currentPrice : 0,
          costPrice: product.costPrice,
          stockAtAdd: product.stock,
          unit: product.unit,
          quantityMode: quantityModeForProduct(product),
          priceGroupId: product.priceGroupId,
          priceVersion: product.priceVersion,
        };
      }));
      notify('မျှဝေဈေးနှုန်း ပြောင်းလဲသွားပါတယ်။ Cart ထဲရှိ ဈေးနှုန်းကို အသစ်ပြောင်းထားပါတယ်။ ကျသင့်ငွေကို ပြန်စစ်ပြီးမှ ငွေရှင်းပါ။');
      return false;
    }

    if (cart.some((item) => !Number.isFinite(item.unitPrice) || item.unitPrice <= 0)) { notify('ဈေးနှုန်း မသတ်မှတ်ရသေးသော ပစ္စည်းရှိနေပါတယ်။ အရင်ဆုံး ဈေးဖြည့်ပါ။'); return false; }
    const insufficient = cart.find((item) => { const product = productMap.get(item.productId); return !product || sellableStock(product) < item.quantity; });
    if (insufficient) { notify(`${insufficient.name} Stock မလုံလောက်ပါ။`); return false; }
    const seenUnits = new Set<string>();
    for (const item of cart) {
      const product = productMap.get(item.productId);
      const selections = item.stockUnitSelections || [];
      if (product && isTrackedProduct(product)) {
        if (!Number.isInteger(item.quantity) || selections.length !== item.quantity) {
          notify(`${item.name}: Sticker Unit စာရင်းနဲ့ ပမာဏ မကိုက်ညီပါ။ Cart ကို ပြန်စစ်ပါ။`);
          return false;
        }
      } else if (selections.length > 0) {
        notify(`${item.name}: Unit Tracking မဖွင့်ထားတဲ့ Product မှာ Sticker Unit မပါရပါ။`);
        return false;
      }
      for (const selection of selections) {
        if (seenUnits.has(selection.unitId)) { notify('Cart ထဲမှာ Sticker Unit တစ်ခုတည်းကို နှစ်ကြိမ် ပါဝင်နေပါတယ်။'); return false; }
        seenUnits.add(selection.unitId);
        const registry = stockUnitRegistries.find((entry) => entry.id === selection.registryId);
        const unit = registry?.units.find((entry) => entry.id === selection.unitId);
        if (!registry || !unit || registry.branchId !== activeBranchId || registry.productId !== item.productId || unit.status !== 'in_stock') {
          notify(`${item.name}: Sticker Unit ${selection.barcode} ကို မရောင်းနိုင်တော့ပါ။ ပြန် Scan ပါ။`);
          return false;
        }
      }
    }
    if (paymentMethod === 'Credit' && (!customer.trim() || customer.trim() === 'လက်လီဝယ်သူ')) { notify('အကြွေးဝယ်သူအမည်ကို မှန်ကန်စွာ ဖြည့်ပါ။'); return false; }
    if (paymentMethod === 'KPay' && !branchKpayEnabled) { notify('ဒီ Branch ရဲ့ KPay လက်ခံမှုကို ပိတ်ထားသည် သို့မဟုတ် Account မသတ်မှတ်ရသေးပါ။'); return false; }
    return true;
  };
  const startCheckout = () => {
    if (!validateCheckout()) return;
    // Preserve a previously entered cash amount when the cashier returns to
    // the cart to reduce quantities, but start blank for a new checkout.
    setShowPaymentModal(true);
  };
  const kpayReferenceCheck = checkKpayReference(kpayTransactionReference);
  const { cashReceivedValue, requiredCash, cashShortfall, cashChange } = computeCashPaymentState(paymentMethod, checkoutTotal, cashReceived);
  const finishSaleAfterLocalSave = (savedSale: Sale) => {
    setPendingPersistenceSale(null);
    setShowPaymentModal(false);
    setLastSale(savedSale);
    setCheckoutResultSale(savedSale);
    setAmountOnlyMode(false);
    setShowCheckoutResult(true);
    setPrintTestMode(false);
    setCart([]); setDiscount('0'); setCustomer('လက်လီဝယ်သူ'); setPaymentMethod('Cash'); setCashReceived(''); setKpayTransactionReference(''); setShowHeldItems(false);
    if (cashierMode && access.uid) {
      void submitCashierSale(savedSale, access.uid, activeBranchId).then((result) => {
        const synced = result === 'synced';
        updateSaleCloudSyncStatus(savedSale.id, activeBranchId, synced ? 'synced' : 'pending', synced ? undefined : result);
        if (result === 'synced') notify('အရောင်းကို Cloud ထဲ သိမ်းပြီး Product / Batch Stock ကို တစ်ကြိမ်တည်း လျှော့ပြီးပါပြီ။');
        else if (result === 'queued') notify('အရောင်းကို Durable Offline Queue ထဲ သိမ်းထားပါတယ်။ Internet ပြန်ရလျှင် ပြန်ပို့ပါမယ်။');
        else if (result === 'rules-error') notify('အရောင်းကို ဒီ Device မှာ ထိန်းထားပါတယ်။ Firebase Firestore Rules က ခွင့်မပြုသေးပါ။ Owner ကို အသိပေးပါ။');
        else notify('အရောင်းကို Local မှာ ထိန်းထားပါတယ်။ Cloud Stock / Batch / Shared Price မကိုက်ညီလို့ Owner Review လိုအပ်ပါတယ်။');
      }).catch((error: unknown) => {
        updateSaleCloudSyncStatus(savedSale.id, activeBranchId, 'pending', error instanceof Error ? error.message : 'Offline Queue Save မအောင်မြင်ပါ။');
        notify(error instanceof Error ? `Cloud / Offline Queue Sync မအောင်မြင်ပါ: ${error.message}` : 'Cloud / Offline Queue Sync မအောင်မြင်ပါ။ Sale ကို Local Data ထဲမှာ Pending ထားပါတယ်။');
      });
    }
  };

  const completeSale = async () => {
    if (savingSale || checkoutInFlight.current) return;

    // A previous write may have failed after the sale was added to memory.
    // Retry that same snapshot; never create a second sale for the same checkout.
    if (pendingPersistenceSale) {
      checkoutInFlight.current = true;
      setSavingSale(true);
      try {
        const backend = await flushPosStorePersistence();
        const savedSale = pendingPersistenceSale;
        finishSaleAfterLocalSave(savedSale);
        if (backend === 'localstorage') notify('အရောင်းကို LocalStorage ထဲ သိမ်းထားပါတယ်။ IndexedDB ကို စစ်ဆေးရန် လိုအပ်ပါတယ်။');
      } catch (error) {
        notify(error instanceof Error ? `Local Save မအောင်မြင်သေးပါ။ Sale ကို ထပ်မဖန်တီးထားပါ။ ${error.message} Storage ပြန်ကောင်းမှ ဒီခလုတ်ကို ထပ်နှိပ်ပါ။` : 'Local Save မအောင်မြင်သေးပါ။ App ကို မပိတ်ဘဲ Storage ပြန်စစ်ပြီး ထပ်ကြိုးစားပါ။');
      } finally {
        checkoutInFlight.current = false;
        setSavingSale(false);
      }
      return;
    }

    if (!validateCheckout()) return;
    if (paymentMethod === 'Cash' && cashReceivedValue < requiredCash) {
      notify(`ငွေ ${money(requiredCash - cashReceivedValue, settings.currency)} လိုနေသေးပါတယ်။ Cart ကို ပြန်ပြင်နိုင်ပါတယ်။`);
      return;
    }
    if (paymentMethod === 'KPay' && !kpayReferenceCheck.ok) { notify(kpayReferenceCheck.message); return; }
    const sale: Sale = {
      id: makeSortableId('sale'), receiptNo: makeReceiptNo(), date: new Date().toISOString(),
      customer: customer.trim() || 'လက်လီဝယ်သူ', paymentMethod, items: cart.map((item) => ({ ...item })),
      subtotal, discount: discountValue, total: checkoutTotal, profit: cartProfit, status: 'completed',
      ...(paymentMethod === 'Cash' ? { cashReceivedAmount: cashReceivedValue, changeAmount: cashChange } : {}),
      ...(paymentMethod === 'KPay' ? { kpayTransactionReference: normalizeKpayReference(kpayTransactionReference) } : {}),
      createdByUid: access.uid || firebaseAuth?.currentUser?.uid || '',
      createdByEmail: access.email || firebaseAuth?.currentUser?.email || '',
      createdByName: access.displayName || firebaseAuth?.currentUser?.displayName || access.email || 'Owner',
      ...(cashierMode ? { cloudSyncStatus: 'pending' as const } : {}),
    };
    // Synchronous lock: two taps in the same frame must only create one sale.
    checkoutInFlight.current = true;
    const savedSale = addSale(sale);
    if (!savedSale) { checkoutInFlight.current = false; notify('Stock သို့မဟုတ် Stock Batch လက်ကျန် မလုံလောက်ပါ၊ သို့မဟုတ် Data မကိုက်ညီပါ။ Branch Sync ပြီးကြောင်း စစ်ပြီး Cart ကို ပြန်စစ်ပါ။'); return; }

    setPendingPersistenceSale(savedSale);
    setSavingSale(true);
    try {
      const backend = await flushPosStorePersistence();
      finishSaleAfterLocalSave(savedSale);
      if (backend === 'localstorage') notify('အရောင်းကို LocalStorage ထဲ သိမ်းထားပါတယ်။ IndexedDB ကို စစ်ဆေးရန် လိုအပ်ပါတယ်။');
    } catch (error) {
      notify(error instanceof Error ? `အရောင်းကို Browser Storage ထဲ မသိမ်းနိုင်သေးပါ။ Sale ကို ထပ်မဖန်တီးထားပါ။ Storage ပြန်ကောင်းမှ “Local Save ပြန်ကြိုးစားရန်” ကို နှိပ်ပါ။ ${error.message}` : 'အရောင်းကို Browser Storage ထဲ မသိမ်းနိုင်သေးပါ။ App ကို မပိတ်ဘဲ Storage ပြန်စစ်ပါ။');
    } finally {
      checkoutInFlight.current = false;
      setSavingSale(false);
    }
  };
  const printReceipt = (sale: Sale) => {
    setLastSale(sale);
    setPrintTestMode(false);
    window.setTimeout(() => window.print(), 180);
  };
  const printTestReceipt = () => {
    setLastSale(null);
    setPrintTestMode(true);
    window.setTimeout(() => window.print(), 180);
  };
  const finishWithoutPrinting = () => {
    if (!checkoutResultSale) return;
    // Keep a clean amount-only view on screen so the cashier can show it to the customer.
    setAmountOnlyMode(true);
  };
  const closeCheckoutResult = () => {
    setShowCheckoutResult(false);
    setCheckoutResultSale(null);
    setAmountOnlyMode(false);
  };
  const copyReceipt = async (sale: Sale) => {
    const lines = [settings.storeName, ...(sale.status === 'voided' ? ['*** VOIDED ***'] : []), `Voucher: ${sale.receiptNo}`, dateLabel(sale.date), `Customer: ${sale.customer}`, '------------------------', ...sale.items.map((item) => { const product = productMap.get(item.productId); const quantityMode = item.quantityMode || (product ? quantityModeForProduct(product) : 'whole'); const quantityText = `${formatQuantity(item.quantity, quantityMode)} ${item.unit || product?.unit || ''}`.trim(); return `${item.name}\n${quantityText} x ${money(item.unitPrice, settings.currency)} = ${money(item.unitPrice * item.quantity, settings.currency)}`; }), '------------------------', `Subtotal: ${money(sale.subtotal, settings.currency)}`, `Discount: ${money(sale.discount, settings.currency)}`, `Total: ${money(sale.total, settings.currency)}`, `Payment: ${sale.paymentMethod}`, ...(sale.paymentMethod === 'KPay' && sale.kpayTransactionReference ? [`KPay Transaction ID: ${sale.kpayTransactionReference}`] : []), ...(sale.paymentMethod === 'KPay' && (sale.kpayAccountNameSnapshot || sale.kpayAccountNumberSnapshot) ? [`KPay Account: ${sale.kpayAccountNameSnapshot || '-'}`, `KPay Account No: ${sale.kpayAccountNumberSnapshot || '-'}`] : []), `Paid: ${money(sale.paidAmount ?? (sale.paymentMethod === 'Cash' || sale.paymentMethod === 'KPay' ? sale.total : 0), settings.currency)}`, ...(sale.paymentMethod === 'Cash' ? [`Cash Received: ${money(sale.cashReceivedAmount ?? sale.total, settings.currency)}`, `Change: ${money(sale.changeAmount ?? 0, settings.currency)}`] : []), `Due: ${money(sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), settings.currency)}`, settings.receiptFooter];
    try { await navigator.clipboard.writeText(lines.join('\n')); notify('Voucher စာသား Copy လုပ်ပြီးပါပြီ။ Viber / Telegram မှာ Paste လုပ်နိုင်ပါတယ်။'); }
    catch { notify('Clipboard အသုံးမပြုနိုင်ပါ။ Browser Permission စစ်ပါ။'); }
  };

  const downloadCsv = (filename: string, rows: (string | number)[][]) => {
    const quote = (value: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + rows.map((row) => row.map(quote).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
    URL.revokeObjectURL(url);
    notify('CSV ဖိုင် ထုတ်ယူပြီးပါပြီ။ Excel နဲ့ ဖွင့်နိုင်ပါတယ်။');
  };
  const exportProductsCsv = () => downloadCsv(`minimart-products-${today()}.csv`, [
    ['SKU', 'Barcode', 'Product', 'Category', 'Cost Price', 'Retail Price', 'Wholesale Price', 'Stock', 'Unit', 'Low Stock At'],
    ...products.map((product) => [product.sku, product.barcode || '', product.name, product.category, product.costPrice, product.retailPrice, product.wholesalePrice, product.stock, product.unit, product.lowStockAt]),
  ]);
  const exportSalesCsv = () => downloadCsv(`minimart-sales-${today()}.csv`, cashierMode
    ? [
      ['Voucher', 'Date', 'Customer', 'Payment', 'Items', 'Subtotal', 'Discount', 'Total', 'Paid', 'Cash Received', 'Change', 'Due', 'Status', 'KPay Account', 'KPay Account No'],
      ...visibleSales.map((sale) => [sale.receiptNo, sale.date, sale.customer, sale.paymentMethod, sale.items.length, sale.subtotal, sale.discount, sale.total, sale.paidAmount ?? (sale.paymentMethod === 'Cash' || sale.paymentMethod === 'KPay' ? sale.total : 0), sale.cashReceivedAmount ?? (sale.paymentMethod === 'Cash' ? sale.total : 0), sale.changeAmount ?? 0, sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), sale.status, sale.kpayAccountNameSnapshot || '', sale.kpayAccountNumberSnapshot || '']),
    ]
    : [
      ['Voucher', 'Date', 'Customer', 'Payment', 'Items', 'Subtotal', 'Discount', 'Total', 'Gross Profit', 'Paid', 'Cash Received', 'Change', 'Due', 'Status', 'KPay Account', 'KPay Account No'],
      ...visibleSales.map((sale) => [sale.receiptNo, sale.date, sale.customer, sale.paymentMethod, sale.items.length, sale.subtotal, sale.discount, sale.total, sale.profit, sale.paidAmount ?? (sale.paymentMethod === 'Cash' || sale.paymentMethod === 'KPay' ? sale.total : 0), sale.cashReceivedAmount ?? (sale.paymentMethod === 'Cash' ? sale.total : 0), sale.changeAmount ?? 0, sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), sale.status, sale.kpayAccountNameSnapshot || '', sale.kpayAccountNumberSnapshot || '']),
    ]);
  const exportExpensesCsv = () => downloadCsv(`minimart-expenses-${today()}.csv`, [
    ['Date', 'Branch', 'Cashier', 'Title', 'Category', 'Amount', 'Funding Source', 'Payment Method', 'Approval Status', 'Report Status', 'Note'],
    ...visibleExpenses.map((expense) => [expense.date, activeBranch?.name || activeBranchId, expense.createdByName || 'Legacy / Owner', expense.title, expense.category, expense.amount, expense.fundedBy || '', expense.paymentMethod || '', expense.approvalStatus || 'not-required', expense.reviewStatus || (expense.cloudSyncStatus === 'pending' ? 'cloud-pending' : expense.createdByRole === 'owner' ? 'owner-recorded' : 'submitted'), expense.note]),
  ]);

  const handleExpenseSubmit = async (draft: Omit<Expense, 'id' | 'branchId'>) => {
    const uid = access.uid || firebaseAuth?.currentUser?.uid || '';
    if (cashierMode && !uid) { notify('Cashier Firebase UID မရသေးပါ။ Account ကို ပြန်ဝင်ပြီး စမ်းပါ။'); return; }
    const actorName = access.displayName || firebaseAuth?.currentUser?.displayName || access.email || 'Owner';
    const now = new Date().toISOString();
    const approvalLimit = activeBranch?.settings.cashierExpenseApprovalLimit ?? DEFAULT_CASHIER_EXPENSE_APPROVAL_LIMIT;
    const requiresOwnerApproval = cashierMode && draft.amount > approvalLimit;
    const saved = addExpense({
      ...draft,
      id: makeSortableId('exp'),
      createdByUid: uid || undefined,
      createdByEmail: access.email || firebaseAuth?.currentUser?.email || '',
      createdByName: actorName,
      createdByRole: cashierMode ? 'cashier' : 'owner',
      // A branch-configured threshold gates larger Cashier expenses.
      approvalStatus: requiresOwnerApproval ? 'pending' : 'not-required',
      ...(cashierMode ? { reviewStatus: 'submitted' as const, submittedAt: now } : {}),
      updatedAt: now,
      updatedByUid: uid || undefined,
      ...(cashierMode ? { cloudSyncStatus: 'pending' as const } : {}),
    });
    if (cashierMode) {
      try {
        const syncResult = await submitCashierExpenseToCloud(saved, uid, activeBranchId);
        updateExpense(saved.id, {
          approvalStatus: syncResult.approvalStatus,
          reviewStatus: syncResult.reviewStatus,
          ...(syncResult.reviewedAt ? { reviewedAt: syncResult.reviewedAt } : {}),
          ...(syncResult.reviewedByUid ? { reviewedByUid: syncResult.reviewedByUid } : {}),
          ...(syncResult.reviewedByName ? { reviewedByName: syncResult.reviewedByName } : {}),
          cloudSyncStatus: 'synced', cloudSyncError: undefined,
        });
        notify(requiresOwnerApproval ? 'အသုံးစရိတ် Approval တောင်းဆိုချက်ကို Owner ထံ ပို့ပြီးပါပြီ။ ခွင့်ပြုချက်မရမချင်း ဆိုင်ငွေကို မသုံးပါနှင့်။' : 'အသုံးစရိတ်ကို မှတ်တမ်းတင်ပြီး Owner ထံ အသိပေးပြီးပါပြီ။');
      } catch (error) {
        updateExpense(saved.id, { cloudSyncStatus: 'pending', cloudSyncError: error instanceof Error ? error.message : 'Cloud Sync မအောင်မြင်ပါ။' });
        notify('အသုံးစရိတ်ကို ဒီ Device မှာ သိမ်းထားပါတယ်။ Cloud ပြန်ချိတ်သည့်အခါ Owner ထံ အလိုအလျောက် တင်ပြပါမယ်။');
      }
      return;
    }
    notify('အသုံးစရိတ် မှတ်တမ်းသိမ်းပြီးပါပြီ။');
  };

  const handleApproveCashierExpense = async (expense: Expense) => {
    if (access.status !== 'active' || access.role !== 'owner' || expense.branchId !== activeBranchId || expense.approvalStatus !== 'pending') {
      notify('ဒီ Expense ကို Approval ပေးရန် Owner Access နှင့် မှန်ကန်သော Branch လိုအပ်ပါတယ်။');
      return;
    }
    const confirmed = await dialog.confirm({
      title: 'အသုံးစရိတ် ခွင့်ပြုရန်',
      message: `${expense.title} · ${money(expense.amount, settings.currency)} ကို ခွင့်ပြုမလား။ ခွင့်ပြုပြီးနောက်သာ သက်ဆိုင်ရာ ဆိုင်ငွေကို သုံးစွဲနိုင်ပါတယ်။`,
      confirmLabel: 'ခွင့်ပြုမည်',
    });
    if (!confirmed) return;
    const now = new Date().toISOString();
    updateExpense(expense.id, {
      approvalStatus: 'approved', approvedAt: now, date: now,
      approvedByUid: access.uid, approvedByName: access.displayName || access.email || 'Owner',
      reviewStatus: 'reviewed', reviewedAt: now, reviewedByUid: access.uid,
      reviewedByName: access.displayName || access.email || 'Owner', updatedAt: now, updatedByUid: access.uid,
    });
    window.dispatchEvent(new Event('minimart-cloud-sync-requested'));
    notify('Cashier Expense ကို Owner က ခွင့်ပြုပြီးပါပြီ။');
  };

  const handleRejectCashierExpense = async (expense: Expense) => {
    if (access.status !== 'active' || access.role !== 'owner' || expense.branchId !== activeBranchId || expense.approvalStatus !== 'pending') {
      notify('ဒီ Expense ကို ပယ်ချရန် Owner Access နှင့် မှန်ကန်သော Branch လိုအပ်ပါတယ်။');
      return;
    }
    const reason = await dialog.prompt({
      title: 'အသုံးစရိတ် ပယ်ချရန်',
      message: `${expense.title} ကို ပယ်ချရသည့် အကြောင်းပြချက် ဖြည့်ပါ။`,
      label: 'အကြောင်းပြချက်',
      defaultValue: 'အသုံးစရိတ်ကို ခွင့်မပြုပါ။',
      required: true,
      minLength: 3,
      confirmLabel: 'ပယ်ချမည်',
    });
    if (!reason || reason.trim().length < 3) return;
    const now = new Date().toISOString();
    updateExpense(expense.id, {
      approvalStatus: 'rejected', rejectedAt: now, rejectedByUid: access.uid,
      rejectionReason: reason.trim(), reviewStatus: 'reviewed', reviewedAt: now,
      reviewedByUid: access.uid, reviewedByName: access.displayName || access.email || 'Owner',
      updatedAt: now, updatedByUid: access.uid,
    });
    window.dispatchEvent(new Event('minimart-cloud-sync-requested'));
    notify('Cashier Expense Approval တောင်းဆိုချက်ကို ပယ်ချပြီးပါပြီ။');
  };

  const handleRetryCashierExpenses = async () => {
    const uid = access.uid || firebaseAuth?.currentUser?.uid || '';
    if (!cashierMode || !uid) return;
    const result = await flushPendingCashierExpenses(uid, activeBranchId);
    notify(result.synced > 0 ? `Expense ${result.synced} ခု Cloud ထဲ Sync ပြီးပါပြီ။` : result.failed > 0 ? 'Cloud Sync မအောင်မြင်သေးပါ။ Firebase Rules / Internet ကို စစ်ဆေးပါ။' : 'ပို့ရန် Pending Expense မရှိပါ။');
  };
  const handleCreateCashierSettlement = async (input: CashierSettlementCreateInput) => {
    if (cashierMode || access.status !== 'active' || access.role !== 'owner') throw new Error('Cashier ငွေရှင်းမှတ်တမ်း ဖန်တီးရန် Firebase Owner Access လိုအပ်ပါတယ်။');
    const uid = access.uid || firebaseAuth?.currentUser?.uid || '';
    if (!uid) throw new Error('Owner Firebase UID မရရှိပါ။');
    const saved = addCashierSettlement({ ...input, branchId: activeBranchId, createdByUid: uid, paidByUid: uid, paidByName: access.displayName || access.email || 'Owner' });
    if (!saved) throw new Error('ငွေရှင်းမှတ်တမ်း မသိမ်းနိုင်ပါ။ Cashier၊ ပမာဏ၊ သို့မဟုတ် ပြန်အမ်းမည့် Expense ရှိပြီးသားဖြစ်မဖြစ် စစ်ဆေးပါ။');
    window.dispatchEvent(new Event('minimart-cloud-sync-requested'));
    notify(input.paymentMethod === 'kpay' ? 'KPay ငွေလွှဲမှတ်တမ်း သိမ်းပြီး Cloud Sync ပို့နေပါပြီ။' : 'Cash ငွေရှင်းမှတ်တမ်း သိမ်းပြီး Cloud Sync ပို့နေပါပြီ။');
  };

  const exportBackup = async () => {
    try {
      const state = usePosStore.getState();
      const localImages = await exportLocalImages([
        ...state.branches.flatMap((branch) => [branch.logoUrl, branch.bannerUrl]),
        state.ownerProfile?.photoUrl,
      ]);
      const data = { app: 'minimart-pos', schemaVersion: 20, exportedAt: new Date().toISOString(), branches: state.branches, activeBranchId: state.activeBranchId, categories: state.categories, products: state.products, priceGroups: state.priceGroups, sales: state.sales, expenses: state.expenses, cashierSettlements: state.cashierSettlements, branchFinanceLedgerEntries: state.branchFinanceLedgerEntries, cashierAdvanceReconciliations: state.cashierAdvanceReconciliations, branchFinanceReconciliations: state.branchFinanceReconciliations, heldItems: state.heldItems, customers: state.customers, suppliers: state.suppliers, customerPayments: state.customerPayments, purchases: state.purchases, supplierPayments: state.supplierPayments, purchaseReturns: state.purchaseReturns, stockBatches: state.stockBatches, stockReceipts: state.stockReceipts, stockTransfers: state.stockTransfers, stockShipments: state.stockShipments, stockUnitRegistries: state.stockUnitRegistries, cashShifts: state.cashShifts, cashMovements: state.cashMovements, activityLogs: state.activityLogs, ownerProfile: state.ownerProfile, settings: state.settings, localImages };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `minimart-backup-${today()}.json`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`Backup ဖိုင် ထုတ်ယူပြီးပါပြီ။ ပုံ ${Object.keys(localImages).length} ပုံပါဝင်ပါတယ်။`);
    } catch (reason) {
      notify(reason instanceof Error ? `Backup မထုတ်နိုင်ပါ။ ${reason.message}` : 'Backup မထုတ်နိုင်ပါ။ Browser Storage ကို စစ်ပါ။');
    }
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid backup');
      const data = parsed as Record<string, unknown>;
      if (!Array.isArray(data.products) || !Array.isArray(data.sales) || !Array.isArray(data.expenses)) throw new Error('Missing backup fields');
      const confirmed = await dialog.confirm({
        title: 'Backup ပြန်တင်ရန် (Restore)',
        message: 'လက်ရှိ Data ကို Backup ထဲက Data နဲ့ အစားထိုး/ပြန်တင်ပါမည်။ ပုံဖိုင်များပါ Restore လုပ်ပါမည်။ ဆက်လုပ်မလား။',
        confirmLabel: 'Restore လုပ်မည်',
        tone: 'danger',
      });
      if (!confirmed) return;
      await importLocalImages(data.localImages);
      const importedBranches = Array.isArray(data.branches) ? await Promise.all((data.branches as Array<Record<string, unknown>>).map(async (branch, index) => {
        const next = { ...branch };
        for (const field of ['logoUrl', 'bannerUrl'] as const) {
          const value = typeof next[field] === 'string' ? next[field] as string : '';
          if (value.startsWith('data:image/')) next[field] = await migrateDataUrlImage(value, `backup-branch-${String(branch.id || index)}-${field}`);
        }
        return next;
      })) : undefined;
      const importedOwnerProfile: Record<string, unknown> | undefined = data.ownerProfile && typeof data.ownerProfile === 'object' ? { ...(data.ownerProfile as Record<string, unknown>) } : undefined;
      if (importedOwnerProfile) {
        const photoUrl = typeof importedOwnerProfile.photoUrl === 'string' ? importedOwnerProfile.photoUrl : '';
        if (photoUrl.startsWith('data:image/')) importedOwnerProfile.photoUrl = await migrateDataUrlImage(photoUrl, 'backup-owner-profile-photo');
      }
      const importedSales = (data.sales as Sale[]).map((sale) => ({ ...sale }));
      const importedCustomers = Array.isArray(data.customers) ? [...data.customers as never[]] : [];
      if (!Array.isArray(data.customers)) {
        const byName = new Map<string, string>();
        for (const sale of importedSales) {
          if (sale.paymentMethod !== 'Credit') continue;
          const key = sale.customer.trim().toLowerCase();
          let customerId = byName.get(key);
          if (!customerId) {
            customerId = `legacy-${sale.id}`;
            byName.set(key, customerId);
            importedCustomers.push({ id: customerId, name: sale.customer || 'အမည်မသိ Customer', phone: '', address: '', note: 'Legacy backup မှ အလိုအလျောက် ဖန်တီးထားသည်။', createdAt: sale.date } as never);
          }
          sale.customerId = customerId;
          sale.paidAmount ??= 0;
          sale.dueAmount ??= Math.max(0, sale.total - (sale.paidAmount ?? 0));
        }
      }
      // Mark the replacement before the import so the owner sync layer rebaselines
      // instead of treating every record absent from the backup as a cloud deletion.
      const replacementMarker = markLocalDataReplacement('backup-restore');
      importData({ branches: importedBranches as never[] | undefined, activeBranchId: typeof data.activeBranchId === 'string' ? data.activeBranchId : undefined, categories: Array.isArray(data.categories) ? data.categories as never[] : undefined, products: data.products as Product[], priceGroups: Array.isArray(data.priceGroups) ? data.priceGroups as never[] : [], sales: importedSales, expenses: data.expenses as Expense[], cashierSettlements: Array.isArray(data.cashierSettlements) ? data.cashierSettlements as CashierSettlementRecord[] : [], branchFinanceLedgerEntries: Array.isArray(data.branchFinanceLedgerEntries) ? data.branchFinanceLedgerEntries as never[] : [], cashierAdvanceReconciliations: Array.isArray(data.cashierAdvanceReconciliations) ? data.cashierAdvanceReconciliations as never[] : [], branchFinanceReconciliations: Array.isArray(data.branchFinanceReconciliations) ? data.branchFinanceReconciliations as never[] : undefined, heldItems: Array.isArray(data.heldItems) ? data.heldItems as never[] : [], customers: importedCustomers, suppliers: Array.isArray(data.suppliers) ? data.suppliers as never[] : [], customerPayments: Array.isArray(data.customerPayments) ? data.customerPayments as never[] : [], purchases: Array.isArray(data.purchases) ? data.purchases as never[] : [], supplierPayments: Array.isArray(data.supplierPayments) ? data.supplierPayments as never[] : [], purchaseReturns: Array.isArray(data.purchaseReturns) ? data.purchaseReturns as never[] : [], stockBatches: Array.isArray(data.stockBatches) ? data.stockBatches as never[] : [], stockReceipts: Array.isArray(data.stockReceipts) ? data.stockReceipts as never[] : [], stockTransfers: Array.isArray(data.stockTransfers) ? data.stockTransfers as never[] : [], stockShipments: Array.isArray(data.stockShipments) ? data.stockShipments as never[] : [], stockUnitRegistries: Array.isArray(data.stockUnitRegistries) ? data.stockUnitRegistries as never[] : [], cashShifts: Array.isArray(data.cashShifts) ? data.cashShifts as never[] : [], cashMovements: Array.isArray(data.cashMovements) ? data.cashMovements as never[] : [], activityLogs: Array.isArray(data.activityLogs) ? data.activityLogs as never[] : [], ownerProfile: importedOwnerProfile as never, settings: data.settings as never });
      announceLocalDataReplacement(replacementMarker);
      notify('Backup Restore အောင်မြင်ပါပြီ။');
    } catch { notify('Backup ဖိုင် မမှန်ကန်ပါ။ JSON Backup ကို ရွေးပါ။'); }
    finally { if (importRef.current) importRef.current.value = ''; }
  };

  const triggerManualSync = useCallback(() => {
    if (!isOnline) {
      notify('Internet မချိတ်ဆက်ရသေးပါ။ Local Cache Data ကို ဆက်လက်ပြသထားပါတယ်။');
      return;
    }
    setManualSyncPending(true);
    if (manualSyncTimerRef.current !== undefined) window.clearTimeout(manualSyncTimerRef.current);
    manualSyncTimerRef.current = window.setTimeout(() => {
      setManualSyncPending(false);
      manualSyncTimerRef.current = undefined;
    }, 3500);
    window.dispatchEvent(new Event('minimart-cloud-sync-requested'));
    notify('Cloud မှ နောက်ဆုံးစာရင်းကို ပြန်လည်စစ်ဆေးနေပါတယ်။ Local Cache Data ကို ဆက်သုံးနိုင်ပါတယ်။');
  }, [isOnline]);

  const syncTone = !isOnline || autoSyncStatus.state === 'offline'
    ? 'offline'
    : manualSyncPending || autoSyncStatus.state === 'connecting'
      ? 'syncing'
      : autoSyncStatus.state === 'conflict' || autoSyncStatus.state === 'error'
        ? 'warn'
        : autoSyncStatus.state === 'synced'
          ? 'synced'
          : 'cache';
  const syncSavedTime = autoSyncStatus.savedAt && !Number.isNaN(Date.parse(autoSyncStatus.savedAt))
    ? new Date(autoSyncStatus.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';
  const syncBadgeText = syncTone === 'offline'
    ? 'Offline · Cache'
    : syncTone === 'syncing'
      ? 'Syncing…'
      : syncTone === 'warn'
        ? (autoSyncStatus.state === 'conflict' ? 'Sync Conflict' : 'Local Cache')
        : syncTone === 'synced'
          ? (syncSavedTime ? `Cloud · ${syncSavedTime}` : 'Cloud Synced')
          : 'Local Cache';

  const navItemsAll: { id: Page; label: string; icon: ReactNode }[] = [
    { id: 'branches', label: 'ဆိုင်ခွဲများ', icon: <Store size={18} /> },
    ...(!cashierMode && activeBranches.length > 1 ? [{ id: 'overview' as Page, label: 'ဆိုင်အားလုံး', icon: <LayoutDashboard size={18} /> }] : []),
    { id: 'dashboard', label: activeBranches.length > 1 ? 'ဆိုင်အကျဉ်းချုပ်' : 'ပင်မ', icon: <LayoutDashboard size={18} /> },
    { id: 'pos', label: 'အရောင်း', icon: <ShoppingCart size={18} /> },
    { id: 'inventory', label: 'ပစ္စည်း', icon: <Boxes size={18} /> },
    ...(canManageSharedPricing ? [{ id: 'pricing' as Page, label: 'မျှဝေဈေးနှုန်း', icon: <CircleDollarSign size={18} /> }] : []),
    { id: 'receiving', label: 'ကုန်ဝင်', icon: <PackagePlus size={18} /> },
    ...(!cashierMode ? [{ id: 'unitReceiving' as Page, label: 'Barcode ကုန်လက်ခံ', icon: <ScanLine size={18} /> }] : []),
    ...(activeBranches.length > 1 ? [{ id: 'shipments' as Page, label: 'ကုန်ပို့ / လက်ခံ', icon: <Send size={18} /> }] : []),
    ...(cashierMode && access.canReceiveStock ? [{ id: 'branchReceiving' as Page, label: 'ကုန်စစ်ဆေးရန်', icon: <PackageCheck size={18} /> }] : []),
    { id: 'sales', label: 'မှတ်တမ်း', icon: <Receipt size={18} /> },
    { id: 'customers', label: 'အကြွေး / ဝယ်သူ', icon: <Users size={18} /> },
    { id: 'purchasing', label: 'ကုန်ဝယ် / Supplier', icon: <Truck size={18} /> },
    { id: 'expiry', label: 'သက်တမ်းကုန်', icon: <CalendarClock size={18} /> },
    { id: 'cash', label: 'ငွေကောင်တာ', icon: <Wallet size={18} /> },
    { id: 'activity', label: 'လုပ်ဆောင်ချက်', icon: <ClipboardList size={18} /> },
    { id: 'expenses', label: cashierMode ? 'မိမိအသုံးစရိတ်' : 'အသုံးစရိတ်', icon: <Wallet size={18} /> },
    { id: 'settlements', label: cashierMode ? 'ငွေလက်ခံမှတ်တမ်း' : 'Cashier ငွေရှင်း', icon: <CreditCard size={18} /> },
    ...(!cashierMode ? [{ id: 'finance' as Page, label: 'ငွေစာရင်း', icon: <Wallet size={18} /> }] : []),
    { id: 'analytics', label: 'စာရင်းချုပ်', icon: <BarChart3 size={18} /> },
    { id: 'profile', label: 'ဆိုင်ပရိုဖိုင်', icon: <UserRound size={18} /> },
    { id: 'settings', label: 'ဆက်တင်', icon: <Settings size={18} /> },
  ];
  const navItems = navItemsAll.filter((item) => canUsePage(access.role, item.id, access.canReceiveStock));
  const pageTitle = page === 'overview' ? 'ဆိုင်အားလုံး' : page === 'pricing' ? 'မျှဝေဈေးနှုန်း' : (navItems.find((item) => item.id === page)?.label || 'ပင်မ');
  const navTo = (next: Page) => {
    if (next === 'pricing' && !canManageSharedPricing) {
      notify('မျှဝေဈေးနှုန်းကို ဆိုင်ခွဲ ၂ ဆိုင်နှင့်အထက်ရှိသော Owner သာ စတင်စီမံနိုင်ပါတယ်။ ရှိပြီးသားအုပ်စုများကို ဆိုင်တစ်ဆိုင် Archive လုပ်ပြီးနောက်လည်း ဆက်လက်စီမံနိုင်ပါတယ်။');
      return;
    }
    if (next === 'overview' && (cashierMode || activeBranches.length < 2)) {
      notify('ဆိုင်အားလုံး Dashboard ကို ဆိုင်ခွဲ ၂ ဆိုင်နှင့်အထက်ရှိသော Owner သာ အသုံးပြုနိုင်ပါတယ်။');
      return;
    }
    if (!canUsePage(access.role, next, access.canReceiveStock)) { notify('ဒီစာမျက်နှာကို Owner သာ ဝင်ရောက်နိုင်ပါတယ်။'); return; }
    setPage(next);
  };

  type PrimaryTab = 'pos' | 'inventory' | 'sales' | 'settings';
  const primaryTabForPage = (current: Page): PrimaryTab => {
    if (current === 'pos') return 'pos';
    if (['inventory', 'receiving', 'unitReceiving', 'shipments', 'transfers', 'branchReceiving', 'purchasing', 'expiry', 'pricing'].includes(current)) {
      return 'inventory';
    }
    if (['settings', 'profile', 'branches'].includes(current)) {
      return 'settings';
    }
    return 'sales';
  };
  const activePrimaryTab = primaryTabForPage(page);

  const primaryTabs: { id: PrimaryTab; target: Page; label: string; icon: ReactNode }[] = cashierMode
    ? [
        { id: 'pos', target: 'pos', label: 'အရောင်း', icon: <ShoppingCart size={18} /> },
        ...(access.canReceiveStock ? [{ id: 'inventory' as PrimaryTab, target: 'branchReceiving' as Page, label: 'ပစ္စည်း', icon: <Boxes size={18} /> }] : []),
        { id: 'sales', target: 'sales', label: 'မှတ်တမ်း', icon: <Receipt size={18} /> },
        ...(!access.canReceiveStock ? [{ id: 'sales' as PrimaryTab, target: 'cash' as Page, label: 'ငွေကောင်တာ', icon: <Wallet size={18} /> }] : []),
      ]
    : [
        { id: 'pos', target: 'pos', label: 'အရောင်း', icon: <ShoppingCart size={18} /> },
        { id: 'inventory', target: 'inventory', label: 'ပစ္စည်း', icon: <Boxes size={18} /> },
        { id: 'sales', target: 'sales', label: 'မှတ်တမ်း', icon: <Receipt size={18} /> },
        { id: 'settings', target: 'settings', label: 'ဆက်တင်', icon: <Settings size={18} /> },
      ];

  const subTabsForActiveGroup = useMemo(() => {
    const groupPages: Record<PrimaryTab, Page[]> = {
      pos: [],
      inventory: ['inventory', 'receiving', 'unitReceiving', 'shipments', 'branchReceiving', 'purchasing', 'expiry', 'pricing'],
      sales: ['sales', 'overview', 'dashboard', 'analytics', 'customers', 'cash', 'expenses', 'settlements', 'finance', 'activity'],
      settings: ['settings', 'profile', 'branches'],
    };
    return groupPages[activePrimaryTab]
      .map((id) => navItems.find((item) => item.id === id))
      .filter((item): item is { id: Page; label: string; icon: ReactNode } => Boolean(item));
  }, [activePrimaryTab, navItems]);

  // Production is authenticated-only: never fall back to an unrestricted local workspace.
  if (!firebaseConfigured || !firebaseAuth) {
    return <Suspense fallback={<main className="access-gate"><section className="panel access-gate-card"><h1>Login ဖွင့်နေပါတယ်…</h1><p>လုံခြုံသော Login စာမျက်နှာကို ဖွင့်နေပါတယ်။</p></section></main>}><LoginPage configurationError="Firebase Configuration မရရှိပါ။ လုံခြုံရေးအတွက် Local / Guest Mode ကို ပိတ်ထားပါတယ်။" /></Suspense>;
  }

  if (access.status === 'local') {
    return <Suspense fallback={<main className="access-gate"><section className="panel access-gate-card"><h1>Login ဖွင့်နေပါတယ်…</h1><p>လုံခြုံသော Login စာမျက်နှာကို ဖွင့်နေပါတယ်။</p></section></main>}><LoginPage /></Suspense>;
  }

  if (!localStateHydrated) {
    return <main className="access-gate"><section className="panel access-gate-card"><div className="panel-icon"><Activity size={22} /></div><h1>Local Data ဖွင့်နေပါတယ်</h1><p>သိမ်းထားပြီးသား ဆိုင်စာရင်းများကို Browser Storage မှ ပြန်လည်ရယူနေပါတယ်။ ဒီအဆင့်ပြီးသည်အထိ App ကို မပိတ်ပါနှင့်။</p></section></main>;
  }

  if (access.status === 'loading') {
    return <main className="access-gate" aria-busy="true"><section className="panel access-gate-card" role="status" aria-live="polite"><div className="access-gate-progress"><div className="panel-icon"><ShieldCheck size={22} /></div><span className="public-login-spinner is-brand" aria-hidden="true" /></div><h1>Access စစ်ဆေးနေပါတယ်</h1><p>Firebase Server သို့မဟုတ် ယခင်သိမ်းထားသော Offline Cache မှ Owner / Cashier Access ကို စစ်ဆေးနေပါတယ်။</p></section></main>;
  }

  if (access.status === 'unassigned' || access.status === 'disabled' || access.status === 'error') {
    const cashierMemberPath = `businesses/${FIREBASE_BUSINESS_ID}/members/${access.uid}`;
    return <main className="access-gate"><section className="panel access-gate-card"><div className="panel-icon"><LockKeyhole size={22} /></div><h1>{access.status === 'unassigned' ? 'Business Access မသတ်မှတ်ရသေးပါ' : 'Account Access မရနိုင်ပါ'}</h1><p>{access.message}</p><div className="access-uid"><small>Firebase UID</small><code>{access.uid}</code><small>Firebase Project</small><code>{firebaseApp?.options.projectId || "မချိတ်ဆက်ရသေးပါ"}</code><small>Business ID</small><code>{FIREBASE_BUSINESS_ID}</code></div>{access.status === 'unassigned' && <div className="cloud-help access-membership-help"><strong>Cashier Account ချိတ်ဆက်ရန်</strong><p>ဒီ Firebase Account ကို Cashier အဖြစ် အသုံးပြုမယ်ဆိုရင် Owner က Profile → ဝန်ထမ်းအကောင့် / Branch Permission ထဲမှာ Firebase Authentication UID အတိအကျကို ချိတ်ပေးရပါမယ်။ Member စာရင်းမှာ ပြထားတဲ့ Document UID နဲ့ အောက်က UID တူညီရပါမယ်။</p><strong>Cashier Member Path</strong><code>{cashierMemberPath}</code><div className="access-copy-actions"><button className="button button-outline" type="button" onClick={() => void copyAccessValue(access.uid, 'Firebase UID', openManualCopyPrompt, notify)}><Copy size={14}/> UID ကူးရန်</button><button className="button button-outline" type="button" onClick={() => void copyAccessValue(cashierMemberPath, 'Member Path', openManualCopyPrompt, notify)}><Copy size={14}/> Path ကူးရန်</button></div><small>Owner Account ဖြစ်ပါကလည်း ownerUid ကိုသာ အမှန်တကယ် Owner Firebase UID နဲ့ စစ်ဆေးပါ။ Cashier UID ကို ownerUid ထဲ မထည့်ပါနဲ့။</small></div>}{access.status === 'error' && <button className="button button-primary" type="button" onClick={() => window.location.reload()}>ပြန်စမ်းရန်</button>}{firebaseAuth && <button className="button button-outline" onClick={() => void signOut(firebaseAuth)}> <LogOut size={15}/> Sign Out</button>}</section></main>;
  }

  if (cashierMode && !canUsePage(access.role, page, access.canReceiveStock)) {
    return <main className="access-gate"><section className="panel access-gate-card"><h1>ဝင်ခွင့်စစ်ဆေးနေပါတယ်</h1><p>Cashier အတွက် ခွင့်ပြုထားတဲ့ စာမျက်နှာကို ဖွင့်နေပါတယ်။</p></section></main>;
  }

  if (cashierMode && !access.branchIds.includes(activeBranchId)) {
    return <main className="access-gate"><section className="panel access-gate-card"><h1>Branch Access စစ်ဆေးနေပါတယ်</h1><p>Owner က သတ်မှတ်ထားတဲ့ ဆိုင်ကို ရွေးချယ်နေပါတယ်။</p></section></main>;
  }

  return (
    <div className="app-shell" data-theme={themeMode}>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className={`topbar-brand-dot${activeBranchLogoSource ? ' has-custom-logo' : ''}`}>
              {activeBranchLogoSource ? <img src={activeBranchLogoSource} alt="Shop logo" /> : <BrandMark size={17} />}
            </div>
            <div className="topbar-title-group">
              <h1>{pageTitle}</h1>
              <span className="topbar-branch-name">
                {page === 'overview' && !cashierMode ? 'ဆိုင်အားလုံး' : (activeBranch?.name || settings.storeName)}
              </span>
            </div>
          </div>

          <nav className="desktop-tab-bar" aria-label="အဓိက မီနူး">
            {primaryTabs.map((tab) => {
              const isTabActive = cashierMode && !access.canReceiveStock && tab.target === 'cash'
                ? page === 'cash'
                : cashierMode && !access.canReceiveStock && tab.target === 'sales'
                  ? activePrimaryTab === 'sales' && page !== 'cash'
                  : activePrimaryTab === tab.id;
              return (
                <button
                  key={`${tab.id}-${tab.target}`}
                  type="button"
                  className={`desktop-tab-item ${isTabActive ? 'active' : ''}`}
                  onClick={() => navTo(tab.target)}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  {tab.id === 'pos' && cart.length > 0 && <b className="desktop-tab-badge">{cart.length}</b>}
                </button>
              );
            })}
          </nav>

          <div className="topbar-actions">
            <div className={`sync-status-group sync-tone-${syncTone}`}>
              <button
                type="button"
                className="sync-status-pill"
                title={autoSyncStatus.message}
                aria-label={`Sync အခြေအနေ: ${syncBadgeText} — ${autoSyncStatus.message}`}
                onClick={() => {
                  if (!cashierMode) {
                    setSettingsTab('cloud');
                    navTo('settings');
                  } else {
                    notify(autoSyncStatus.message);
                  }
                }}
              >
                {syncTone === 'offline' ? <CloudOff size={14} /> : syncTone === 'syncing' ? <RefreshCw size={14} className="spin-icon" /> : syncTone === 'warn' ? <AlertTriangle size={14} /> : <Cloud size={14} />}
                <span>{syncBadgeText}</span>
              </button>
              <button
                type="button"
                className="sync-refresh-btn"
                onClick={triggerManualSync}
                disabled={manualSyncPending}
                title={isOnline ? 'Cloud မှ နောက်ဆုံးစာရင်း ပြန်စစ်ရန်' : 'Offline ဖြစ်နေပါသည် (Local Cache ပြထားသည်)'}
                aria-label="Cloud Sync ပြန်စစ်ရန်"
              >
                <RefreshCw size={14} className={manualSyncPending ? 'spin-icon' : ''} />
                <span>Sync</span>
              </button>
            </div>
            {!cashierMode && activeBranches.length > 1 && (
              <select
                className="topbar-branch-select"
                aria-label="ဆိုင်ခွဲ ရွေးချယ်ရန်"
                value={page === 'overview' ? 'all' : activeBranchId}
                onChange={(event) => switchBranch(event.target.value)}
              >
                <option value="all">ဆိုင်အားလုံး</option>
                {activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            )}
            <button
              className="theme-toggle"
              type="button"
              onClick={() => setThemeMode((current) => current === 'light' ? 'dark' : 'light')}
              aria-label={themeMode === 'light' ? 'Dark Mode ပြောင်းရန်' : 'Light Mode ပြောင်းရန်'}
              aria-pressed={themeMode === 'dark'}
              title={themeMode === 'light' ? 'Dark Mode' : 'Light Mode'}
            >
              {themeMode === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              <span>{themeMode === 'light' ? 'Dark' : 'Light'}</span>
            </button>
            {installPrompt && (
              <button className="button button-outline install-btn" type="button" onClick={() => void installPrompt()}>
                <Smartphone size={15} /> Install
              </button>
            )}
            {cashierMode && firebaseAuth && (
              <button className="button button-outline" type="button" onClick={() => void signOut(firebaseAuth)}>
                <LogOut size={14} /> ထွက်မယ်
              </button>
            )}
            {!cashierMode && (
              <button
                className="avatar avatar-button"
                type="button"
                onClick={() => navTo('profile')}
                title="ဆိုင်ပရိုဖိုင်"
                aria-label="ဆိုင်ပရိုဖိုင်"
              >
                {ownerPhotoSource ? <img src={ownerPhotoSource} alt="Owner profile" /> : (typeof ownerProfile?.displayName === 'string' ? ownerProfile.displayName.trim().charAt(0) || 'M' : 'M')}
              </button>
            )}
          </div>
        </header>

        <div className="content-area">
          {subTabsForActiveGroup.length > 1 && (
            <div className="ios-subtabs-wrap">
              <div className="ios-segmented-subtabs" role="tablist" aria-label="စာမျက်နှာခွဲများ">
                {subTabsForActiveGroup.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    role="tab"
                    aria-selected={page === sub.id}
                    className={`ios-subtab-btn ${page === sub.id ? 'active' : ''}`}
                    onClick={() => navTo(sub.id)}
                  >
                    {sub.icon}
                    <span>{sub.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Suspense fallback={<div className="page-stack"><div className="panel"><p>စာမျက်နှာ ဖွင့်နေပါတယ်…</p></div></div>}>
          <ContentErrorBoundary resetKey={page}>
          {page === 'profile' && <ProfileManagementPage authorize={authorize} notify={notify} />}
          {page === 'branches' && <BranchManagementPage authorize={authorize} notify={notify} onOpenBranch={switchBranch} />}
          {page === 'pricing' && !cashierMode && <SharedPricingPage branches={branches} products={allProducts} notify={notify} actorUid={access.uid} />}
          {page === 'overview' && !cashierMode && <BranchOverviewPage
            branches={activeBranches}
            products={allProducts}
            sales={allSales}
            expenses={allExpenses}
            cashShifts={allCashShifts}
            stockBatches={allStockBatches}
            activeBranchName={activeBranch?.name || settings.storeName}
            activeBranchId={activeBranchId}
            activeCartCount={cart.length}
            currency={settings.currency}
            onOpenBranch={switchBranch}
            onManageBranches={() => navTo('branches')}
            onResumePos={() => navTo('pos')}
          />}
          {page === 'dashboard' && <DashboardPage
            todayRevenue={todayRevenue} todayProfit={todayProfit} todayCount={todaySales.length}
            bannerSource={activeBranchBannerSource}
            productCount={products.length} totalStockUnits={stockedProductCount} lowStockProducts={lowStockProducts} sellableStock={sellableStock}
            sales={validSales} settings={settings} trend={trend} trendMax={trendMax}
            chartPeriod={chartPeriod} setChartPeriod={setChartPeriod} navTo={navTo}
          />}

          {page === 'pos' && <section className="pos-layout pos-layout-mobile-split">
            <div className="pos-products-panel">
              <div className="section-heading"><div><h2>ပစ္စည်းစာရင်း</h2></div><span className="subtle-count">{posDataLoading ? 'ပစ္စည်းစာရင်း ရယူနေသည်' : `ပစ္စည်း ${filteredProducts.length} မျိုး`} · {activeBranch?.name || settings.storeName}</span></div>
              <div className="toolbar barcode-pos-toolbar"><div className="search-box"><Search size={17} /><input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addScannedProductToCart(productSearch); } }} placeholder="ပစ္စည်းအမည် / SKU / Barcode..." aria-label="ပစ္စည်းအမည်၊ SKU သို့မဟုတ် Barcode ရှာရန်" />{productSearch && <button className="pos-search-clear" type="button" title="ရှာဖွေမှု ရှင်းရန်" aria-label="ရှာဖွေမှု ရှင်းရန်" onClick={() => setProductSearch('')}><X size={15} /></button>}<button className="barcode-inline-camera" type="button" title="Camera ဖြင့် Barcode ဖတ်ရန်" aria-label="Camera ဖြင့် Barcode ဖတ်ရန်" onClick={() => setCameraScannerTarget('pos')}><Camera size={17} /></button></div><select className="select-control category-select" aria-label="Category ရွေးရန်" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option>{POS_ALL_CATEGORIES}</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></div>{cashierMode && access.uid && <CashierSalesQueueStatus uid={access.uid} branchId={activeBranchId} />}<small className="barcode-scan-hint">Barcode Scanner သုံးရန် Search Box ကို နှိပ်ပြီး Scan ဖတ်ပါ။</small>
              {products.length === 0 ? (posDataLoading
                ? <EmptyState icon={<Activity size={25} />} title="Cloud မှ ပစ္စည်းစာရင်း ရယူနေပါတယ်" text="Initial Sync လုပ်နေပါတယ်။ ဒီအချိန်မှာ Product 0 မျိုးလို့ မသတ်မှတ်သေးပါ။ Sync ပြီးလျှင် စာရင်းအလိုအလျောက် ပြပါမယ်။" />
                : posDataUnavailable
                  ? <EmptyState icon={<AlertTriangle size={25} />} title="Cloud မှ ပစ္စည်းစာရင်း မရနိုင်သေးပါ" text={`${autoSyncStatus.message} Internet ချိတ်ဆက်မှုကို စစ်ပြီး ပြန်စမ်းပါ။`} />
                  : <EmptyState icon={<ShoppingBag size={25} />} title={`${activeBranch?.name || 'ဒီဆိုင်'} တွင် ပစ္စည်း မရှိသေးပါ`} text={otherBranchProducts.length > 0 ? `ဒီဆိုင်အတွက် ပြသနိုင်တဲ့ Product မရှိပါ။ ${otherBranchProducts.map((branch) => `${branch.name} (${branch.count} မျိုး)`).join(' · ')} တွင် ပစ္စည်းရှိပါတယ်။ ဆိုင်ခွဲ ပြောင်းပြီး POS ပြန်ဖွင့်ပါ။` : 'အရင်ဆုံး ဒီဆိုင်ရဲ့ Inventory ထဲမှာ ပစ္စည်းထည့်ပြီးမှ POS မှာ ရောင်းချနိုင်ပါမယ်။'} action={otherBranchProducts.length > 0 ? 'ဆိုင်ခွဲ ရွေးချယ်ရန်' : 'ပစ္စည်းထည့်ရန်'} onAction={() => setPage(otherBranchProducts.length > 0 ? 'overview' : 'inventory')} />) :
                filteredProducts.length === 0 ? <EmptyState icon={<Search size={25} />} title="မတွေ့ပါ" text="ရှာဖွေမှု စကားလုံး သို့မဟုတ် Category ကို ပြောင်းကြည့်ပါ။" /> :
                <><div className="product-grid">{visibleProducts.map((product) => <button key={product.id} className={`product-tile ${!isProductSelectable(product, expiredBatchUnits) ? 'out-of-stock' : ''}`} onClick={() => addToCart(product)} disabled={!isProductSelectable(product, expiredBatchUnits)}><div className="product-tile-icon"><ShoppingBag size={22} /></div><strong>{product.name}</strong><span className="product-sku">{product.sku}</span><div className="product-tile-bottom"><b>{product.retailPrice > 0 ? money(product.retailPrice, settings.currency) : 'ဈေးမသတ်မှတ်ရသေး'}</b><span className={sellableStock(product) <= product.lowStockAt ? 'stock-warning' : 'stock-ok'}>{formatQuantity(sellableStock(product), quantityModeForProduct(product))} {product.unit} ရောင်းနိုင်</span></div></button>)}</div>{visibleProducts.length < filteredProducts.length && <div className="product-grid-more"><span>ပြသနေသည် {visibleProducts.length} / {filteredProducts.length}</span><button className="button button-outline" type="button" onClick={() => setVisibleProductCount((count) => count + POS_PRODUCT_PAGE_SIZE)}>နောက်ထပ် {Math.min(POS_PRODUCT_PAGE_SIZE, filteredProducts.length - visibleProducts.length)} မျိုး ပြမယ်</button></div>}</>}
            </div>
            <aside className="cart-panel">
              <div className="cart-title"><div><h2><ShoppingCart size={19} /> စျေးခြင်း</h2><p>{cart.length} မျိုး</p></div><button className="text-button" onClick={() => { setCart([]); setDiscount('0'); setPaymentMethod('Cash'); setCashReceived(''); setKpayTransactionReference(''); setShowPaymentModal(false); }}>ရှင်းမယ်</button></div>
              <div className="cart-scroll">
              <div className="cart-customer"><label>ဝယ်သူ</label><input list="pos-customer-options" value={customer} onChange={(e) => { setCustomer(e.target.value); setCashReceived(''); }} placeholder="ဝယ်သူအမည်" /><datalist id="pos-customer-options">{customers.map((entry) => <option key={entry.id} value={entry.name} />)}</datalist><div className="payment-switch"><button type="button" className={paymentMethodsEnabled && paymentMethod === 'Cash' ? 'selected' : ''} disabled={!paymentMethodsEnabled} onClick={() => { setPaymentMethod('Cash'); setCashReceived(''); setKpayTransactionReference(''); }}><Wallet size={15} /> ငွေသား</button><button type="button" className={paymentMethodsEnabled && paymentMethod === 'KPay' ? 'selected' : ''} disabled={!kpaySelectable} title={!kpaySelectable ? (kpayUnavailable ? describeKpayUnavailable(kpayUnavailable) : 'Cart ထဲ ပစ္စည်းထည့်မှ KPay ရွေးနိုင်ပါမယ်။') : ''} onClick={() => { setPaymentMethod('KPay'); setCashReceived(''); }}><CreditCard size={15} /> KPay</button><button type="button" className={paymentMethodsEnabled && paymentMethod === 'Credit' ? 'selected' : ''} disabled={!paymentMethodsEnabled} onClick={() => { setPaymentMethod('Credit'); setCashReceived(''); setKpayTransactionReference(''); }}><CreditCard size={15} /> အကြွေး</button></div>{cart.length === 0 && <small className="payment-switch-hint">ပစ္စည်းထည့်ပြီးမှ ငွေပေးချေနည်း ရွေးနိုင်ပါမယ်။</small>}{kpayUnavailable && <small className="payment-switch-hint payment-switch-warning">KPay ရွေးလို့မရပါ — {describeKpayUnavailable(kpayUnavailable)}</small>}</div>
              <div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><ShoppingCart size={27} /><strong>Cart ထဲမှာ ဘာမှမရှိသေးပါ</strong><span>ဘယ်ဘက်က ပစ္စည်းတစ်ခုကို ရွေးပါ။</span></div> : cart.map((item) => <div className="cart-line" key={item.productId}><div className="cart-line-top"><div><strong>{item.name}</strong><small>{item.sku}{(item.stockUnitSelections || []).length ? ` · Sticker Unit ${item.stockUnitSelections!.length}` : ''}</small></div><button className="icon-btn danger-icon" onClick={() => setAside(item)} title="Not buying list ထဲသိမ်း" aria-label="Not buying list ထဲသိမ်း"><ArchiveRestore size={16} /></button></div><div className="price-mode"><button className={item.mode === 'retail' ? 'active' : ''} onClick={() => changePriceMode(item, 'retail')}>လက်လီ</button><button className={item.mode === 'wholesale' ? 'active' : ''} onClick={() => changePriceMode(item, 'wholesale')}>လက်ကား</button><span>{money(item.unitPrice, settings.currency)}</span></div><div className="cart-line-bottom"><div className="qty-control"><button type="button" aria-label="အရေအတွက် လျှော့ရန်" onClick={() => { const product = productMap.get(item.productId); const step = product && quantityModeForProduct(product) === 'decimal' ? 0.1 : 1; changeCartQty(item.productId, Math.round((item.quantity - step) * 1000) / 1000); }}><Minus size={14} /></button><b>{formatQuantity(item.quantity, productMap.get(item.productId) ? quantityModeForProduct(productMap.get(item.productId)!) : 'whole')}</b><button type="button" aria-label="အရေအတွက် တိုးရန်" disabled={!!productMap.get(item.productId) && isTrackedProduct(productMap.get(item.productId)!)} title={productMap.get(item.productId) && isTrackedProduct(productMap.get(item.productId)!) ? 'Sticker Barcode ထပ်မံ Scan ပါ' : undefined} onClick={() => { const product = productMap.get(item.productId); if (product && isTrackedProduct(product)) { notify('ဒီပစ္စည်းအတွက် Sticker Barcode တစ်ခု ထပ်မံ Scan ပါ။'); return; } const step = product && quantityModeForProduct(product) === 'decimal' ? 0.1 : 1; changeCartQty(item.productId, Math.round((item.quantity + step) * 1000) / 1000); }}><Plus size={14} /></button></div><strong>{money(item.unitPrice * item.quantity, settings.currency)}</strong></div></div>)}</div>
              {heldItems.length > 0 && <div className={`held-section ${showHeldItems ? 'held-section-open' : ''}`}><button className="held-heading held-toggle" type="button" onClick={() => setShowHeldItems((current) => !current)} aria-expanded={showHeldItems}><span>မယူတော့သောပစ္စည်းစာရင်း</span><b>{heldItems.length} မျိုး</b><ChevronDown size={15} className={showHeldItems ? 'held-chevron-open' : ''} /></button>{showHeldItems && <div className="held-list">{heldItems.map((item) => <div className="held-row" key={item.productId}><span>{item.name} × {formatQuantity(item.quantity, productMap.get(item.productId) ? quantityModeForProduct(productMap.get(item.productId)!) : 'whole')}</span><button type="button" onClick={() => restoreHeld(item.productId)}>Cart ထဲပြန်ထည့်</button></div>)}</div>}</div>}
              </div>
              <div className="cart-summary"><div><span>ပစ္စည်းဖိုး</span><b>{money(subtotal, settings.currency)}</b></div><div className="discount-row"><label htmlFor="discount-input">လျှော့ဈေး (MMK){cashierMode ? ` · Max ${maxCashierDiscountPercent}%` : ''}</label><input id="discount-input" type="number" min="0" max={maxAllowedDiscount} value={discount} onChange={(e) => setDiscount(e.target.value)} /></div><div className="total-row"><span>စုစုပေါင်း</span><strong>{money(checkoutTotal, settings.currency)}</strong></div><div className="printer-tools"><label>Receipt စက္ကူ<select aria-label="Receipt paper width" value={paperWidth} onChange={(event) => setPaperWidth(event.target.value === '58' ? '58' : '80')}><option value="58">58 mm</option><option value="80">80 mm</option></select></label><button className="button button-outline printer-test-button" type="button" onClick={printTestReceipt}><Printer size={15} /> Test Print</button></div><button className="button button-primary checkout-button" type="button" onClick={startCheckout} disabled={!cart.length}><Check size={18} /> {cart.length > 0 ? `ငွေရှင်းမယ် · ${money(checkoutTotal, settings.currency)}` : 'ငွေရှင်းမယ်'}</button></div>
            </aside>
          </section>}

          {page === 'receiving' && <StockReceivingPage notify={notify} onOpenUnitReceiving={() => navTo('unitReceiving')} />}
          {page === 'unitReceiving' && <StockUnitRegistrationPage notify={notify} />}
          {page === 'transfers' && <StockTransferPage authorize={authorize} notify={notify} onViewDestination={viewBranchInventory} />}
          {page === 'shipments' && <BranchShipmentManagementPage authorize={authorize} notify={notify} />}
          {page === 'branchReceiving' && <BranchStockReceivingPage notify={notify} />}
          {page === 'inventory' && <section className="page-stack"><div className="section-heading"><div><h2>ပစ္စည်းစာရင်း</h2><p>ပစ္စည်း၊ ဈေးနှုန်းနှင့် လက်ကျန် Stock ကို စီမံပါ။</p></div><div className="heading-actions">{canManageSharedPricing && <button className="button button-outline" onClick={() => navTo('pricing')}><CircleDollarSign size={15} /> မျှဝေဈေးနှုန်း</button>}<button className="button button-outline" onClick={exportProductsCsv}><Download size={15} /> CSV</button><button className="button button-primary" onClick={openNewProduct}><Plus size={17} /> ပစ္စည်းအသစ်</button></div></div><div className="mini-stats"><MiniStat icon={<Boxes size={17} />} label="ပစ္စည်းအမျိုးအစား" value={String(products.length)} /><MiniStat icon={<PackagePlus size={17} />} label="လက်ကျန်ရှိသော ပစ္စည်း" value={String(stockedProductCount)} /><MiniStat icon={<AlertTriangle size={17} />} label="Stock နည်းနေသောပစ္စည်း" value={String(lowStockProducts.length)} tone="warning" /></div><div className="panel">{legacyFractionalStockCount > 0 && <div className="backup-warning"><AlertTriangle size={16} /><span>အရေအတွက်ယူနစ်ဖြစ်သော်လည်း ဒသမလက်ကျန်ရှိသော Product {legacyFractionalStockCount} မျိုးရှိပါတယ်။ လက်တွေ့ရေတွက်ပြီး Stock ± ဖြင့် အမှန်တကယ်လက်ကျန်ကို ပြင်ပါ။ App က ဒသမကို အလိုအလျောက် Round မလုပ်ပါ။</span></div>}<div className="table-toolbar"><div className="search-box"><Search size={16} /><input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="ပစ္စည်း / SKU / Barcode ရှာရန်..." /></div><span className="subtle-count">{inventoryProducts.length} မျိုး</span></div><div className="table-wrap table-cards"><table><thead><tr><th>ပစ္စည်း</th><th>Category</th><th>Cost</th><th>လက်လီ</th><th>လက်ကား</th><th>ရောင်းနိုင် / စုစုပေါင်း</th><th>လုပ်ဆောင်ချက်</th></tr></thead><tbody>{(inventoryExpanded ? inventoryProducts : inventoryProducts.slice(0, 20)).map((product) => <tr key={product.id}><td data-label="ပစ္စည်း"><div className="table-product"><span className="table-product-icon"><ShoppingBag size={17} /></span><span><strong>{product.name}</strong><small>SKU: {product.sku || '—'}{product.barcode ? ` · Barcode: ${product.barcode}` : ' · Barcode မထည့်ရသေး'}{product.priceGroupId ? ' · မျှဝေဈေးနှုန်းချိတ်ထားသည်' : ' · သီးခြားဈေးနှုန်း'}</small></span></div></td><td data-label="Category"><span className="tag">{product.category}</span></td><td data-label="Cost">{money(product.costPrice, settings.currency)}</td><td data-label="လက်လီ"><b>{money(product.retailPrice, settings.currency)}</b></td><td data-label="လက်ကား">{money(product.wholesalePrice, settings.currency)}</td><td data-label="ရောင်းနိုင် / စုစုပေါင်း"><span className={sellableStock(product) <= product.lowStockAt ? 'stock-warning' : 'stock-ok'}>{formatQuantity(sellableStock(product), quantityModeForProduct(product))} / {formatQuantity(product.stock, quantityModeForProduct(product))} {product.unit}{hasLegacyFractionalQuantity(product.stock, quantityModeForProduct(product)) ? <small className="stock-warning">ဒသမလက်ကျန် · ပြန်စစ်ရန်</small> : null}</span></td><td className="table-card-actions" data-label="လုပ်ဆောင်ချက်"><div className="table-actions"><button className="small-action" onClick={() => openEditProduct(product)}>ပြင်ရန်</button><button className="small-action" onClick={() => { void (async () => { if (productIsUnitTracked(product, stockUnitRegistries, activeBranchId)) { notify('Unit Tracking ပစ္စည်းဖြစ်လို့ Stock ကို ဒီနေရာမှ မပြင်နိုင်ပါ။ Unit Barcode ကုန်လက်ခံစာမျက်နှာတွင် Sticker Scan ဖြင့်သာ တိုးပါ။'); return; } const amountText = await dialog.prompt({ title: `Stock ± (${product.name})`, message: `Stock ဘယ်လောက် တိုး/လျှော့မလဲ။ ${quantityModeForProduct(product) === 'whole' ? 'နောက်ဆုံးလက်ကျန်က အရေအတွက်ပြည့်ကိန်း ဖြစ်ရပါမယ်။ ဒသမလက်ကျန်ကို မှန်ကန်အောင် ပြင်ရန် 0.012 လို correction amount ထည့်နိုင်ပါတယ်။' : 'ဒသမ ၃ နေရာအထိ ထည့်နိုင်ပါတယ်။'}`, label: `အရေအတွက် (${product.unit})`, inputType: 'number', inputMode: 'decimal', step: 'any', placeholder: 'ဥပမာ +5 သို့မဟုတ် -2', confirmLabel: 'Stock ပြင်မည်' }); if (amountText !== null) { const amount = Number(amountText); if (Number.isFinite(amount) && amount !== 0) { if (adjustStock(product.id, amount)) notify('Stock ပြင်ဆင်ပြီးပါပြီ။'); else notify('Stock ပြင်မရပါ။ ယူနစ်၊ လက်ကျန်နဲ့ အရေအတွက်ကို ပြန်စစ်ပါ။'); } } })(); }}>Stock ±</button><button className="icon-btn danger-icon" title="Delete" onClick={() => { void (async () => { if ((await authorize('ပစ္စည်းဖျက်ရန်')) && (await dialog.confirm({ title: 'ပစ္စည်းဖျက်ရန်', message: `${product.name} ကို ဖျက်မလား။`, confirmLabel: 'ဖျက်မည်', tone: 'danger' }))) { if (!deleteProduct(product.id)) { notify(product.priceGroupId ? 'ဒီ Product ကို မျှဝေဈေးနှုန်းအုပ်စုမှ အရင်ဖြုတ်ပါ။' : productIsUnitTracked(product, stockUnitRegistries, activeBranchId) ? 'Unit Barcode History ရှိနေသေးလို့ ဒီ Product ကို မဖျက်နိုင်ပါ။' : 'ပစ္စည်းဖျက်မရပါ။'); return; } setCart((items) => items.filter((item) => item.productId !== product.id)); notify('ပစ္စည်းဖျက်ပြီးပါပြီ။'); } })(); }}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table>{inventoryProducts.length === 0 && <EmptyState icon={<Boxes size={24} />} title="စာရင်းမရှိသေးပါ" text="ပစ္စည်းအသစ်ထည့်ပြီး စတင်အသုံးပြုပါ။" action="ပစ္စည်းထည့်ရန်" onAction={openNewProduct} />}</div><ListLimitToggle total={inventoryProducts.length} shown={Math.min(20, inventoryProducts.length)} expanded={inventoryExpanded} onToggle={() => setInventoryExpanded((v) => !v)} unitLabel="မျိုး" /></div></section>}

          {page === 'sales' && <section className="page-stack"><div className="section-heading"><div><h2>အရောင်းမှတ်တမ်း</h2><p>{cashierMode ? 'မိမိ၏ အရောင်းမှတ်တမ်းများကို ကြည့်ရှုနိုင်ပါတယ်။' : 'ရောင်းချပြီးသော မှတ်တမ်းများကို ကြည့်ရှု၊ Voucher ပြန်ထုတ်နိုင်ပါတယ်။'}</p></div><div className="heading-actions"><button className="button button-outline" onClick={exportSalesCsv}><Download size={15} /> CSV</button><div className="sales-summary-chip"><TrendingUp size={17} /> {visibleSales.filter((sale) => sale.status === 'completed').length} ကြိမ်</div></div></div><div className="mini-stats"><MiniStat icon={<Receipt size={17} />} label="ပြီးစီးအရောင်း" value={`${visibleSales.filter((sale) => sale.status === 'completed').length} ကြိမ်`} /><MiniStat icon={<TrendingUp size={17} />} label="စုစုပေါင်းရောင်းအား" value={money(visibleSales.filter((sale) => sale.status === 'completed').reduce((sum, sale) => sum + sale.total, 0), settings.currency)} /><MiniStat icon={<CreditCard size={17} />} label="ကြွေးကျန်" value={money(visibleSales.filter((sale) => sale.status === 'completed').reduce((sum, sale) => sum + (sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0)), 0), settings.currency)} tone="warning" /></div><div className="panel"><div className="table-toolbar"><div className="search-box"><Search size={16} /><input value={saleSearch} onChange={(e) => setSaleSearch(e.target.value)} placeholder="Voucher No / ဝယ်သူ ရှာရန်..." /></div><div className="ledger-filter-row"><button type="button" className={`small-action ${saleFilter === 'all' ? 'active' : ''}`} onClick={() => setSaleFilter('all')}>အားလုံး</button><button type="button" className={`small-action ${saleFilter === 'Cash' ? 'active' : ''}`} onClick={() => setSaleFilter('Cash')}>Cash</button><button type="button" className={`small-action ${saleFilter === 'KPay' ? 'active' : ''}`} onClick={() => setSaleFilter('KPay')}>KPay</button><button type="button" className={`small-action ${saleFilter === 'Credit' ? 'active' : ''}`} onClick={() => setSaleFilter('Credit')}>Credit</button><button type="button" className={`small-action ${saleFilter === 'voided' ? 'active' : ''}`} onClick={() => setSaleFilter('voided')}>Voided</button></div><span className="subtle-count">{filteredSales.length} ခု</span></div><div className="table-wrap table-cards"><table><thead><tr><th>Voucher</th><th>နေ့စွဲ</th><th>ဝယ်သူ</th><th>ပစ္စည်း</th><th>ငွေပေးချေမှု</th><th>စုစုပေါင်း</th><th>ကျန်ငွေ</th><th>အခြေအနေ</th></tr></thead><tbody>{(salesExpanded ? filteredSales : filteredSales.slice(0, 20)).map((sale) => <tr key={sale.id}><td data-label="Voucher"><strong className="mono">{sale.receiptNo}</strong></td><td data-label="နေ့စွဲ">{dateLabel(sale.date)}</td><td data-label="ဝယ်သူ">{sale.customer}</td><td data-label="ပစ္စည်း">{sale.items.length} မျိုး</td><td data-label="ငွေပေးချေမှု"><span className={`tag ${sale.paymentMethod === 'Credit' ? 'tag-warn' : ''}`}>{sale.paymentMethod}</span>{sale.paymentMethod === 'KPay' && sale.kpayTransactionReference && <small>TX: {sale.kpayTransactionReference}</small>}{sale.paymentMethod === 'KPay' && (sale.kpayAccountNameSnapshot || sale.kpayAccountNumberSnapshot) && <small>KPay: {sale.kpayAccountNameSnapshot || '-'} · {sale.kpayAccountNumberSnapshot || '-'}</small>}</td><td data-label="စုစုပေါင်း"><b>{money(sale.total, settings.currency)}</b></td><td data-label="ကျန်ငွေ">{money(sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), settings.currency)}</td><td className="table-card-actions" data-label="အခြေအနေ"><div className="table-actions">{sale.status === 'voided' ? <span className="tag tag-danger">Voided</span> : sale.voidRequested ? <span className="tag tag-warn" title={sale.voidRequestReason}>Void တောင်းဆိုထား ({sale.voidRequestReason})</span> : cashierMode && sale.cloudSyncStatus === 'pending' ? <span className="tag tag-warn" title={sale.cloudSyncError || 'Cloud Sync စောင့်နေပါတယ်။'}>Cloud Sync စောင့်နေ</span> : <span className="tag tag-success">ပြီးစီး</span>}<button className="icon-btn" title="Print" onClick={() => printReceipt(sale)}><Printer size={15} /></button><button className="icon-btn" title="Copy voucher" onClick={() => void copyReceipt(sale)}><FileJson size={15} /></button>{sale.returnCount ? <span className="tag tag-warn">Returned ×{sale.returnCount}</span> : null}{sale.voidRefundStatus ? <small>Refund: {sale.voidRefundStatus}</small> : null}{sale.status === 'completed' && canUseCloudAdjustments && sale.cloudSyncStatus !== 'pending' && !sale.voidRequested && <button className="small-action" type="button" title="Return / ပြန်အမ်းရန်" onClick={() => setReturnSale(sale)}><RotateCcw size={14} /> Return</button>}{(!cashierMode || canUseCloudAdjustments) && sale.status === 'completed' && (sale.paymentMethod === 'Cash' || (sale.paidAmount ?? 0) === 0) && <button className="icon-btn danger-icon" title={cashierMode ? 'Void sale' : 'Void sale (Owner)'} onClick={() => void handleVoidSale(sale)}><X size={15} /></button>}</div></td></tr>)}</tbody></table>{filteredSales.length === 0 && <EmptyState icon={<Receipt size={24} />} title="အရောင်းမှတ်တမ်း မရှိသေးပါ" text={cashierMode ? 'အရောင်းပြုလုပ်ပြီးနောက် မိမိ၏ မှတ်တမ်းများ ဒီနေရာမှာ ပေါ်လာပါမယ်။' : 'POS မှာ အရောင်းပြုလုပ်ပြီးနောက် မှတ်တမ်းများ ဒီနေရာမှာ ပေါ်လာပါမယ်။'} />}</div><ListLimitToggle total={filteredSales.length} shown={Math.min(20, filteredSales.length)} expanded={salesExpanded} onToggle={() => setSalesExpanded((v) => !v)} /></div></section>}

          {page === 'customers' && <CustomerCreditPage />}

          {page === 'purchasing' && <SupplierPurchasePage />}

          {page === 'expiry' && <ExpiryTrackingPage />}

          {page === 'cash' && <CashManagementPage />}

          {page === 'activity' && <ActivityLogPage />}

          {page === 'expenses' && <ExpenseManagementPage
            expenses={visibleExpenses}
            isCashier={cashierMode}
            cashierUid={access.uid}
            cashierName={access.displayName || access.email || 'Cashier'}
            branchName={activeBranch?.name || settings.storeName}
            currency={settings.currency}
            approvalLimit={activeBranch?.settings.cashierExpenseApprovalLimit ?? DEFAULT_CASHIER_EXPENSE_APPROVAL_LIMIT}
            onSubmit={handleExpenseSubmit}
            onApprove={handleApproveCashierExpense}
            onReject={handleRejectCashierExpense}
            onMarkReviewed={(expense) => {
              const now = new Date().toISOString();
              updateExpense(expense.id, {
                reviewStatus: 'reviewed',
                reviewedAt: now,
                reviewedByUid: access.uid || 'owner',
                reviewedByName: access.displayName || access.email || 'Owner',
                updatedAt: now,
              });
              window.dispatchEvent(new Event('minimart-cloud-sync-requested'));
              notify('အသုံးစရိတ်ကို ကြည့်ရှုပြီးကြောင်း မှတ်သားပြီးပါပြီ။');
            }}
            onDelete={(expense) => { void (async () => { if ((await authorize('အသုံးစရိတ်ဖျက်ရန်')) && (await dialog.confirm({ title: 'အသုံးစရိတ်ဖျက်ရန်', message: `"${expense.title}" ကို ဖျက်မလား။`, confirmLabel: 'ဖျက်မည်', tone: 'danger' }))) { deleteExpense(expense.id); notify('အသုံးစရိတ် ဖျက်ပြီးပါပြီ။'); } })(); }}
            onRetryPending={handleRetryCashierExpenses}
            onExport={exportExpensesCsv}
          />}
          {page === 'settlements' && <CashierSettlementManagementPage
            settlements={visibleCashierSettlements}
            expenses={expenses}
            branchId={activeBranchId}
            branchName={activeBranch?.name || settings.storeName}
            currency={settings.currency}
            isCashier={cashierMode}
            cashierUid={access.uid}
            cashierName={access.displayName || access.email || 'Cashier'}
            onCreate={handleCreateCashierSettlement}
            branchKpayAccountName={branchKpayEnabled ? activeBranch?.settings.kpayAccountName || '' : ''}
            branchKpayAccountNumber={branchKpayEnabled ? activeBranch?.settings.kpayAccountNumber || '' : ''}
          />}
          {page === 'finance' && <BranchFinanceManagementPage authorize={authorize} notify={notify} />}

          {page === 'analytics' && <AnalyticsPage
            sales={allSales}
            expenses={allExpenses}
            settlements={allCashierSettlements}
            cashShifts={allCashShifts}
            customerPayments={allCustomerPayments}
            products={allProducts}
            branches={branches}
            activeBranchId={activeBranchId}
            isOwner={!cashierMode}
            viewerUid={access.uid}
            currency={settings.currency}
          />}

          {page === 'settings' && <section className="page-stack">
            <div className="section-heading">
              <div>
                <h2>ဆက်တင်နှင့် Data</h2>
                <p>ဆိုင်အချက်အလက်၊ Printer၊ Backup နှင့် Cloud Sync ကို စီမံပါ။</p>
              </div>
              <div className="settings-section-meta">
                <RuntimeBadge inline />
                <small>v3.3.0</small>
              </div>
            </div>

            <div className="ios-subtabs-wrap" role="tablist" aria-label="ဆက်တင် အမျိုးအစားများ">
              <div className="ios-segmented-subtabs">
                <button type="button" role="tab" aria-selected={settingsTab === 'store'} className={`ios-subtab-btn ${settingsTab === 'store' ? 'active' : ''}`} onClick={() => setSettingsTab('store')}>
                  <Settings size={14} /><span>ဆိုင်နှင့် POS</span>
                </button>
                <button type="button" role="tab" aria-selected={settingsTab === 'backup'} className={`ios-subtab-btn ${settingsTab === 'backup' ? 'active' : ''}`} onClick={() => setSettingsTab('backup')}>
                  <FileJson size={14} /><span>Backup နှင့် Data</span>
                </button>
                <button type="button" role="tab" aria-selected={settingsTab === 'cloud'} className={`ios-subtab-btn ${settingsTab === 'cloud' ? 'active' : ''}`} onClick={() => setSettingsTab('cloud')}>
                  <LockKeyhole size={14} /><span>Cloud Sync</span>
                </button>
              </div>
            </div>

            {settingsTab === 'store' && <>
              <div className="panel settings-quick-bar">
                <div className="settings-quick-info">
                  <strong>အသွင်အပြင်နှင့် ဆိုင်စီမံခန့်ခွဲမှု</strong>
                  <small>Theme ပြောင်းလဲခြင်းနှင့် ပရိုဖိုင်/ဆိုင်ခွဲ စာမျက်နှာများသို့ အမြန်သွားပါ။</small>
                </div>
                <div className="settings-quick-actions">
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => setThemeMode((current) => current === 'light' ? 'dark' : 'light')}
                  >
                    {themeMode === 'light' ? <Moon size={15} /> : <Sun size={15} />}
                    <span>{themeMode === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
                  </button>
                  <button type="button" className="button button-outline" onClick={() => navTo('profile')}>
                    <UserRound size={15} /><span>ပရိုဖိုင်နှင့် ဝန်ထမ်း</span>
                  </button>
                  <button type="button" className="button button-outline" onClick={() => navTo('branches')}>
                    <Store size={15} /><span>ဆိုင်ခွဲများ</span>
                  </button>
                </div>
              </div>

              <div className="settings-grid">
                <div className="panel form-panel">
                  <div className="panel-heading">
                    <div className="panel-icon"><Settings size={18} /></div>
                    <div><h3>ဆိုင်နှင့် Receipt</h3><p>Receipt နှင့် POS တွင် အသုံးပြုမည့် အချက်အလက်များ</p></div>
                  </div>
                  <div className="settings-field-pair">
                    <label>ဆိုင်အမည်<input value={settings.storeName} onChange={(e) => updateSettings({ storeName: e.target.value })} /></label>
                    <label>ငွေကြေးအတိုကောက်<input value={settings.currency} onChange={(e) => updateSettings({ currency: e.target.value.toUpperCase() || 'MMK' })} /></label>
                  </div>
                  <label>Receipt အောက်ခြေစာသား<input value={settings.receiptFooter} onChange={(e) => updateSettings({ receiptFooter: e.target.value })} /></label>
                  <div className="printer-settings-card">
                    <div>
                      <strong>Receipt Printer စမ်းသပ်ခြင်း</strong>
                      <small>စက္ကူအကျယ်ရွေးပြီး Test Print ထုတ်ကြည့်နိုင်ပါသည်။</small>
                    </div>
                    <div className="printer-row-inline">
                      <label>Paper Width
                        <select value={paperWidth} onChange={(event) => setPaperWidth(event.target.value === '58' ? '58' : '80')}>
                          <option value="58">58 mm</option>
                          <option value="80">80 mm</option>
                        </select>
                      </label>
                      <button className="button button-outline" type="button" onClick={printTestReceipt}><Printer size={15} /> Test Print</button>
                    </div>
                    <p>Print နှိပ်လျှင် Browser/System Print Dialog ပွင့်ပါမယ်။ Bluetooth Printer ကို Device Print Service မှ ရွေးထုတ်ပါ။</p>
                  </div>
                </div>

                <div className="panel form-panel">
                  <div className="panel-heading">
                    <div className="panel-icon"><LockKeyhole size={18} /></div>
                    <div><h3>POS ကန့်သတ်ချက်နှင့် PIN</h3><p>Cashier Discount နှင့် Browser Admin PIN</p></div>
                  </div>
                  <label>Cashier အများဆုံး Discount ကန့်သတ်ချက် (%)
                    <input type="number" min="0" max="100" step="1" value={settings.maxCashierDiscountPercent ?? 10} onChange={(e) => updateSettings({ maxCashierDiscountPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
                    <small className="field-hint">Cashier များ POS တွင် ပေးနိုင်သော အများဆုံး လျှော့ဈေး ရာခိုင်နှုန်း (Default: 10%)။</small>
                  </label>
                  <label>Admin PIN အသစ်
                    <input type="password" inputMode="numeric" value={settings.adminPin} onChange={(e) => updateSettings({ adminPin: e.target.value.replace(/\D/g, '').slice(0, 12) })} />
                    <small className="field-hint">Default PIN: 1234။ စတင်အသုံးပြုပြီးသည်နှင့် ပြောင်းလဲပါ။</small>
                  </label>
                  <div className="security-note settings-inline-note">
                    <LockKeyhole size={17} />
                    <div>
                      <strong>လုံခြုံရေး မှတ်ချက်</strong>
                      <p>Admin PIN သည် ဒီ Browser အတွင်း UI ကာကွယ်မှုသာဖြစ်ပြီး Cloud Sync အတွက် Owner Account ဖြင့် ဝင်ရောက်ရန် လိုအပ်ပါသည်။</p>
                    </div>
                  </div>
                </div>
              </div>
            </>}

            {settingsTab === 'backup' && <div className="settings-grid">
              <div className="panel form-panel">
                <div className="panel-heading">
                  <div className="panel-icon"><FileJson size={18} /></div>
                  <div><h3>Backup နှင့် CSV Export</h3><p>Data ကို JSON/CSV ဖိုင်အဖြစ် သိမ်းပြီး ပြန်တင်နိုင်ပါတယ်။</p></div>
                </div>
                <div className="backup-card">
                  <div><strong>Backup ထုတ်ရန် (Export)</strong><small>Products, Sales, Credit, Suppliers, Purchases, Expenses နှင့် Cash Shifts အားလုံး ပါဝင်မည်။</small></div>
                  <button className="button button-primary" onClick={exportBackup}><Download size={16} /> Export JSON</button>
                </div>
                <div className="backup-card">
                  <div><strong>Backup ပြန်တင်ရန် (Import)</strong><small>အရင် Export လုပ်ထားသော JSON ဖိုင်ကို ပြန်တင်ပါ။ လက်ရှိ Data ကို အစားထိုးပါမယ်။</small></div>
                  <button className="button button-outline" onClick={() => importRef.current?.click()}><ArrowDownToLine size={16} /> ဖိုင်ရွေးရန်</button>
                  <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importBackup(e.target.files?.[0])} />
                </div>
                <div className="csv-export-row">
                  <strong>CSV ဖိုင်ထုတ်ရန်</strong>
                  <div>
                    <button className="button button-outline" onClick={exportProductsCsv}>Products CSV</button>
                    <button className="button button-outline" onClick={exportSalesCsv}>Sales CSV</button>
                    <button className="button button-outline" onClick={exportExpensesCsv}>Expenses CSV</button>
                  </div>
                </div>
              </div>

              <div className="panel form-panel">
                <div className="panel-heading">
                  <div className="panel-icon"><AlertTriangle size={18} /></div>
                  <div><h3>Data ထိန်းသိမ်းမှုနှင့် Reset</h3><p>Local Device Data သတိပြုရန်နှင့် ဖျက်သိမ်းခြင်း</p></div>
                </div>
                <div className="backup-warning">
                  <AlertTriangle size={17} />
                  <span>Backup ဖိုင်ကို ဖုန်းထဲတင်မကဘဲ အခြားလုံခြုံသောနေရာတွင်လည်း သိမ်းထားပါ။ Browser Data ရှင်းလိုက်လျှင် Local Data ပျောက်နိုင်ပါတယ်။</span>
                </div>
                <div className="danger-zone">
                  <div><strong>Local Data ဖျက်ရန် (Reset)</strong><small>ဒီ Device ရှိ POS စာရင်းများအားလုံးကို ဖယ်ရှားပါမယ်။</small></div>
                  <button className="button button-danger" onClick={() => { void (async () => { if ((await authorize('Data အားလုံး Reset လုပ်ရန်')) && (await dialog.confirm({ title: 'Local Data Reset', message: 'ဒီ Browser ထဲရှိ POS Data အားလုံးကို အပြီးဖျက်မလား။ Backup မရှိလျှင် ပြန်မရနိုင်ပါ။', confirmLabel: 'အားလုံးဖျက်မည်', tone: 'danger' }))) { clearAllData(); setCart([]); notify('Local Data အားလုံး Reset လုပ်ပြီးပါပြီ။'); } })(); }}><Trash2 size={16} /> Reset</button>
                </div>
              </div>
            </div>}

            {settingsTab === 'cloud' && <>
              <CloudSyncPanel onOpenProfile={() => navTo('profile')} />
              <div className="panel security-note">
                <LockKeyhole size={19} />
                <div>
                  <strong>စနစ်နှင့် လုံခြုံရေး အချက်အလက်</strong>
                  <p>Admin PIN သည် ဒီ Browser အတွင်း UI ကာကွယ်မှုသာဖြစ်ပြီး Firebase Cloud Sync အတွက် Owner Account ဖြင့် ဝင်ရောက်ရန် လိုအပ်ပါသည်။</p>
                </div>
              </div>
            </>}
          </section>}
          </ContentErrorBoundary>
          </Suspense>
        </div>
      </main>

      <nav className="mobile-bottom-nav" aria-label="အဓိက မီနူး">
        {primaryTabs.map((tab) => {
          const isTabActive = cashierMode && !access.canReceiveStock && tab.target === 'cash'
            ? page === 'cash'
            : cashierMode && !access.canReceiveStock && tab.target === 'sales'
              ? activePrimaryTab === 'sales' && page !== 'cash'
              : activePrimaryTab === tab.id;
          return (
            <button
              key={`mobile-${tab.id}-${tab.target}`}
              type="button"
              className={isTabActive ? 'active' : ''}
              onClick={() => navTo(tab.target)}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.id === 'pos' && cart.length > 0 && <b>{cart.length}</b>}
            </button>
          );
        })}
      </nav>

      {showPaymentModal && <div className="modal-backdrop payment-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (!pendingPersistenceSale && !savingSale && event.target === event.currentTarget) setShowPaymentModal(false); }}><section className="modal-card payment-confirm-card" role="dialog" aria-modal="true" aria-labelledby="payment-confirm-title"><div className="modal-header"><div><h2 id="payment-confirm-title">ငွေရှင်းအတည်ပြုရန်</h2><p>ပစ္စည်းစာရင်းနဲ့ Customer ပေးငွေကို နောက်ဆုံးစစ်ဆေးပါ။</p></div><button className="icon-btn" type="button" onClick={() => setShowPaymentModal(false)} disabled={Boolean(pendingPersistenceSale) || savingSale} aria-label="ပိတ်ရန်"><X size={19} /></button></div><div className="payment-confirm-total"><small>ကျသင့်ငွေ စုစုပေါင်း</small><strong>{money(checkoutTotal, settings.currency)}</strong><span>{cart.length} မျိုး ရွေးထားပါတယ်</span></div>{paymentMethod === 'Cash' ? <><label className="payment-cash-field">Customer ပေးငွေ ({settings.currency})<input type="number" min="0" step="1" inputMode="numeric" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder="Customer ပေးလိုက်တဲ့ငွေ ထည့်ပါ" /></label><button className="payment-exact-button" type="button" onClick={() => setCashReceived(String(requiredCash))}>ကျသင့်ငွေအတိအကျ ထည့်မယ်</button>{cashShortfall > 0 ? <div className="payment-shortfall"><strong>ငွေမလောက်သေးပါ</strong><span>{money(cashShortfall, settings.currency)} ထပ်လိုနေပါတယ်။ Sale မသိမ်းရသေးပါ၊ Stock လည်း မလျှော့ထားပါ။</span><button className="button button-outline" type="button" onClick={() => setShowPaymentModal(false)}>ပစ္စည်းလျှော့ / Cart ပြန်ပြင်မယ်</button></div> : <div className="payment-change"><span>ပြန်အမ်းရမည့်ငွေ</span><strong>{money(cashChange, settings.currency)}</strong></div>}</> : paymentMethod === 'KPay' ? <div className="payment-kpay-panel"><strong>Branch KPay Account</strong><div className="payment-kpay-account"><span>Account အမည်</span><b>{activeBranch?.settings.kpayAccountName}</b></div><div className="payment-kpay-account"><span>ဖုန်းနံပါတ် / Account</span><b>{activeBranch?.settings.kpayAccountNumber}</b></div>{activeBranch?.settings.kpayAccountLabel && <small>{activeBranch.settings.kpayAccountLabel}</small>}{branchKpayQrSource && <div className="payment-kpay-qr-wrap"><img className="payment-kpay-qr" src={branchKpayQrSource} alt="Branch KPay QR" /><small>ဒီ QR ကို Customer ဖုန်းနဲ့ Scan ဖတ်ပြီး ငွေလွှဲနိုင်ပါတယ်။</small></div>}<button className="payment-exact-button" type="button" onClick={() => void copyAccessValue(activeBranch?.settings.kpayAccountNumber || '', 'Branch KPay Account', openManualCopyPrompt, notify)}>KPay Account နံပါတ် ကူးရန်</button><label className="payment-cash-field">KPay Transaction ID *<input required value={kpayTransactionReference} onChange={(event) => setKpayTransactionReference(event.target.value)} placeholder="KPay ငွေလွှဲပြီးနောက် Transaction ID ထည့်ပါ" maxLength={120} aria-invalid={kpayTransactionReference.trim() !== '' && !kpayReferenceCheck.ok} aria-describedby="kpay-reference-state" /></label><div className="payment-verification" id="kpay-reference-state">{kpayReferenceCheck.ok ? <><span className="tag tag-success">Transaction ID ဖြည့်ပြီး · အတည်ပြုနိုင်သည်</span><small>Cashier က KPay App မှ ငွေလွှဲအောင်မြင်ကြောင်း စစ်ဆေးပြီး မှတ်တမ်းတင်ထားပါသည်။</small></> : <><span className="tag tag-warn">ငွေလွှဲအတည်ပြုချက် · မစစ်ဆေးရသေးပါ</span><small>Transaction ID မှန်ကန်စွာ မထည့်မချင်း Sale ကို သိမ်း၍ မရပါ။</small></>}</div>{kpayTransactionReference.trim() !== '' && !kpayReferenceCheck.ok && <p className="payment-verify-error" role="alert">{kpayReferenceCheck.message}</p>}<small className="field-hint">KPay App မှ ငွေလွှဲပြီး Transaction အောင်မြင်ကြောင်း စစ်ဆေးပြီးမှ Sale ကို အတည်ပြုပါ။</small></div> : <div className="payment-credit-note"><strong>Credit Sale</strong><span>{customer.trim()} အမည်ဖြင့် {money(checkoutTotal, settings.currency)} အကြွေးစာရင်းထဲ ထည့်သိမ်းပါမယ်။</span></div>}<div className="payment-confirm-actions"><button className="button button-outline" type="button" onClick={() => setShowPaymentModal(false)} disabled={Boolean(pendingPersistenceSale) || savingSale}>ပြန်စစ်မယ်</button><button className="button button-primary" type="button" onClick={() => void completeSale()} disabled={savingSale || (!pendingPersistenceSale && ((paymentMethod === 'Cash' && cashShortfall > 0) || (paymentMethod === 'KPay' && !kpayReferenceCheck.ok)))}><Check size={16} /> {savingSale ? 'သိမ်းဆည်းနေသည်…' : pendingPersistenceSale ? 'Local Save ပြန်ကြိုးစားရန်' : paymentMethod === 'KPay' ? 'KPay အတည်ပြုပြီး သိမ်းမယ်' : 'Sale အတည်ပြုပြီး သိမ်းမယ်'}</button></div><small className="payment-confirm-footnote">အတည်ပြုမှသာ အရောင်းစာရင်းသိမ်းပြီး Stock လျှော့ပါမယ်။ KPay ငွေကို App က အလိုအလျောက် မလွှဲပါ။</small></section></div>}
      {showCheckoutResult && checkoutResultSale && <div className="modal-backdrop checkout-result-backdrop" role="presentation"><section className="modal-card checkout-result-card" role="dialog" aria-modal="true" aria-labelledby="checkout-result-title"><div className="checkout-result-icon"><Check size={24} /></div><div className="checkout-result-heading"><h2 id="checkout-result-title">{amountOnlyMode ? 'ကျသင့်ငွေ' : 'ငွေရှင်းအောင်မြင်ပါပြီ'}</h2><p>{amountOnlyMode ? 'Receipt မထုတ်ဘဲ ယူထားတဲ့ပစ္စည်းစာရင်းနဲ့ စုစုပေါင်းပမာဏကို ပြထားပါတယ်။' : 'အရောင်းစာရင်းကို သိမ်းဆည်းပြီးပါပြီ။ ယူထားတဲ့ပစ္စည်းတွေကို စစ်ပြီး Receipt ထုတ်နိုင်ပါတယ်။'}</p></div><div className="checkout-result-total"><small>စုစုပေါင်းကျသင့်ငွေ</small><strong>{money(checkoutResultSale.total, settings.currency)}</strong><span>Voucher: {checkoutResultSale.receiptNo}</span></div><div className="checkout-result-meta"><span>ပစ္စည်း {checkoutResultSale.items.length} မျိုး</span><span>{checkoutResultSale.paymentMethod === 'Credit' ? 'အကြွေး' : checkoutResultSale.paymentMethod === 'KPay' ? 'KPay' : 'ငွေသား'}</span></div>{checkoutResultSale.paymentMethod === 'KPay' && <div className="payment-verification"><span className="tag tag-warn">Manual verification</span><small>TX {checkoutResultSale.kpayTransactionReference} · KPay နှင့် အလိုအလျောက် အတည်ပြုခြင်း မဟုတ်ပါ။</small></div>}<div className="checkout-result-items"><div className="checkout-result-items-heading"><strong>ယူထားတဲ့ပစ္စည်းများ</strong><small>{checkoutResultSale.items.length} မျိုး</small></div>{checkoutResultSale.items.map((item, index) => { const product = productMap.get(item.productId); const quantityMode = item.quantityMode || (product ? quantityModeForProduct(product) : 'whole'); const quantityText = `${formatQuantity(item.quantity, quantityMode)} ${item.unit || product?.unit || ''}`.trim(); return <div className="checkout-result-item" key={`${item.productId}-${index}`}><div className="checkout-result-item-info"><strong>{item.name}</strong><small>{quantityText} × {money(item.unitPrice, settings.currency)} · {item.mode === 'wholesale' ? 'လက်ကား' : 'လက်လီ'}</small></div><b>{money(item.unitPrice * item.quantity, settings.currency)}</b></div>; })}</div><div className="checkout-result-breakdown"><div><span>ပစ္စည်းဖိုး</span><b>{money(checkoutResultSale.subtotal, settings.currency)}</b></div>{checkoutResultSale.discount > 0 && <div><span>လျှော့ဈေး</span><b>−{money(checkoutResultSale.discount, settings.currency)}</b></div>}<div className="checkout-result-breakdown-total"><span>ကျသင့်ငွေ</span><b>{money(checkoutResultSale.total, settings.currency)}</b></div>{checkoutResultSale.paymentMethod === 'Cash' && <><div><span>လက်ခံရရှိငွေ</span><b>{money(checkoutResultSale.cashReceivedAmount ?? checkoutResultSale.total, settings.currency)}</b></div><div><span>ပြန်အမ်းငွေ</span><b>{money(checkoutResultSale.changeAmount ?? 0, settings.currency)}</b></div></>}</div>{amountOnlyMode ? <div className="checkout-result-actions"><button className="button button-primary" type="button" onClick={closeCheckoutResult}>ပြီးပါပြီ</button></div> : <div className="checkout-result-actions"><button className="button button-primary" type="button" onClick={() => { const sale = checkoutResultSale; setShowCheckoutResult(false); setCheckoutResultSale(null); setAmountOnlyMode(false); printReceipt(sale); }}><Printer size={17} /> Printer နဲ့ Receipt ထုတ်မယ်</button><button className="button button-outline" type="button" onClick={finishWithoutPrinting}>မထုတ်တော့ဘူး · ပစ္စည်းစာရင်းပဲကြည့်မယ်</button></div>}<small className="checkout-result-note">Printer မချိတ်ထားပါက Print Dialog ထဲမှာ Save as PDF သို့မဟုတ် ချိတ်ထားသော Printer ကို ရွေးနိုင်ပါတယ်။</small></section></div>}

      {showProductModal && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowProductModal(false); }}><form className="modal-card" onSubmit={saveProduct}><div className="modal-header"><div><h2>{editingProduct ? 'ပစ္စည်းပြင်ဆင်ရန်' : 'ပစ္စည်းအသစ်ထည့်ရန်'}</h2><p>အရင်းဈေးနဲ့ Stock ကို ဆိုင်အလိုက် စီမံပါ။ မျှဝေဈေးနှုန်းချိတ်ထားသော Product ၏ ရောင်းဈေးကို ဒီ Form မှာ မပြင်နိုင်ပါ။</p></div><button className="icon-btn" type="button" onClick={() => setShowProductModal(false)}><X size={19} /></button></div><div className="form-grid"><label className="span-2">ပစ္စည်းအမည် *<input required value={productDraft.name} onChange={(e) => setProductDraft({ ...productDraft, name: e.target.value })} placeholder="ဥပမာ - Drinking Water" /></label><label>SKU / Product Code<input value={productDraft.sku} onChange={(e) => setProductDraft({ ...productDraft, sku: e.target.value })} placeholder="SKU အမှတ် (မဖြည့်လည်းရ)" /></label><label>Factory Barcode (EAN / UPC)<div className="barcode-field-control"><input value={productDraft.barcode} onChange={(e) => setProductDraft({ ...productDraft, barcode: e.target.value })} placeholder="Bluetooth Scanner သို့မဟုတ် ကိုယ်တိုင်ထည့်ပါ" inputMode="text" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} /><button className="button button-outline barcode-camera-button" type="button" onClick={() => setCameraScannerTarget('product')} title="Camera ဖြင့် Barcode ဖတ်ရန်"><Camera size={15} /> Scan</button></div></label><label>Category<select value={productDraft.category} onChange={(e) => { if (e.target.value === '__add_category__') { void (async () => { const name = await dialog.prompt({ title: 'Category အသစ်ထည့်ရန်', label: 'Category အမည်', placeholder: 'ဥပမာ - အချိုရည်', required: true, confirmLabel: 'ထည့်မည်' }); if (name?.trim()) { if (addCategory(name.trim())) { setProductDraft((current) => ({ ...current, category: name.trim() })); notify('Category အသစ် ထည့်ပြီးပါပြီ။'); } else notify('Category အမည် ရှိပြီးသား သို့မဟုတ် မမှန်ကန်ပါ။'); } })(); } else setProductDraft({ ...productDraft, category: e.target.value }); }}><option value="">Category ရွေးပါ</option>{categories.map((category) => <option key={category}>{category}</option>)}<option value="__add_category__">＋ Category အသစ်ထည့်ရန်</option></select></label><label>အရင်းဈေး (Cost Price)<input type="number" min="0" value={productDraft.costPrice} onChange={(e) => setProductDraft({ ...productDraft, costPrice: e.target.value })} /></label><label>လက်လီရောင်းဈေး (Retail Price)<input type="number" min="0" disabled={!!editingProduct?.priceGroupId} value={productDraft.retailPrice} onChange={(e) => setProductDraft({ ...productDraft, retailPrice: e.target.value })} /></label><label>လက်ကားရောင်းဈေး (Wholesale Price)<input type="number" min="0" disabled={!!editingProduct?.priceGroupId} value={productDraft.wholesalePrice} onChange={(e) => setProductDraft({ ...productDraft, wholesalePrice: e.target.value })} /></label><label>လက်ကျန် Stock<input type="number" min="0" step={quantityStep(productDraft.quantityMode)} value={productDraft.stock} disabled={productDraft.tracksIndividualUnits} onChange={(e) => setProductDraft({ ...productDraft, stock: e.target.value })} /><small className="field-hint">{productDraft.tracksIndividualUnits ? 'Unit Tracking ပစ္စည်းများကို Stock Receiving → Unit Barcode Scan မှသာ တိုးနိုင်ပါတယ်။' : ''}</small></label><label>Low Stock Alert<input type="number" min="0" step={quantityStep(productDraft.quantityMode)} value={productDraft.lowStockAt} onChange={(e) => setProductDraft({ ...productDraft, lowStockAt: e.target.value })} /></label><label>Unit<input value={productDraft.unit} onChange={(e) => setProductDraft({ ...productDraft, unit: e.target.value, quantityMode: inferQuantityMode(e.target.value) })} placeholder="ခု / ဘူး / ထုပ် / kg / L" /></label><label>အရေအတွက်တွက်ချက်ပုံ<select value={productDraft.quantityMode} disabled={productDraft.tracksIndividualUnits} onChange={(e) => setProductDraft({ ...productDraft, quantityMode: e.target.value as QuantityMode })}><option value="whole">ပြည့်ကိန်းသာ (ခု / ဘူး / ထုပ်)</option><option value="decimal">ဒသမခွင့်ပြု (kg / L / m)</option></select></label><label className="span-2 unit-tracking-setting"><input type="checkbox" checked={productDraft.tracksIndividualUnits} onChange={(e) => {
                const enabled = e.target.checked;
                const currentlyTracked = !!editingProduct && productIsUnitTracked(editingProduct, stockUnitRegistries, activeBranchId);
                setProductDraft({ ...productDraft, tracksIndividualUnits: enabled, ...(enabled ? { quantityMode: 'whole' as const, ...(!currentlyTracked ? { stock: '0' } : {}) } : {}) });
              }} /><span><b>Individual Unit Tracking</b><small>ဖွင့်ထားလျှင် ပစ္စည်းတစ်ခုချင်းစီအတွက် Sticker Barcode မဖြစ်မနေ Scan ရပါမယ်။ Factory EAN/UPC သည် optional သာဖြစ်ပြီး ရောင်းချရန် မသုံးပါ။</small></span></label></div>{editingProduct?.priceGroupId && <div className="backup-warning"><CircleDollarSign size={16} /><span>ဒီ Product သည် မျှဝေဈေးနှုန်းအုပ်စုနှင့် ချိတ်ထားပါတယ်။ ဆိုင်အားလုံး၏ ရောင်းဈေးကို မပြောင်းမီ 'မျှဝေဈေးနှုန်း' စာမျက်နှာမှ ပြင်ဆင်ပါ။</span></div>}<div className="modal-actions"><button className="button button-outline" type="button" onClick={() => setShowProductModal(false)}>ပယ်ဖျက်</button><button className="button button-primary" type="submit"><Check size={16} /> သိမ်းဆည်းမည်</button></div></form></div>}

      {(lastSale || printTestMode) && <div className="receipt-print-area"><div className={`receipt-paper receipt-paper-${paperWidth}`}>
        {printTestMode ? <><h2>{activeBranch?.name || settings.storeName}</h2><p className="receipt-test-title">*** PRINTER TEST ***</p><p>{new Date().toLocaleString()}</p><hr /><div className="receipt-item"><span>စမ်းသပ်ပစ္စည်း × 1</span><b>1,000 {settings.currency}</b></div><hr /><div className="receipt-total receipt-grand"><span>TEST TOTAL</span><b>1,000 {settings.currency}</b></div><p className="receipt-footer">မြန်မာစာ စမ်းသပ်ခြင်း · {settings.receiptFooter}</p></> : lastSale && <>{activeBranchLogoSource && <img className="receipt-shop-logo" src={activeBranchLogoSource} alt="Shop logo" />}<h2>{activeBranch?.name || settings.storeName}</h2>{lastSale.status === 'voided' && <p className="receipt-test-title">*** VOIDED ***</p>}{activeBranch?.settings.receiptHeader && <p className="receipt-shop-extra">{activeBranch.settings.receiptHeader}</p>}{activeBranch?.address && <p>{activeBranch.address}</p>}{activeBranch?.phone && <p>ဖုန်း: {activeBranch.phone}</p>}<p>Voucher: {lastSale.receiptNo}</p><p>{dateLabel(lastSale.date)}</p><p>Customer: {lastSale.customer}</p><hr />{lastSale.items.map((item, index) => { const product = productMap.get(item.productId); const quantityMode = item.quantityMode || (product ? quantityModeForProduct(product) : 'whole'); const quantityText = `${formatQuantity(item.quantity, quantityMode)} ${item.unit || product?.unit || ''}`.trim(); return <div className="receipt-item receipt-item-detailed" key={`${item.productId}-${index}`}><div className="receipt-item-info"><strong>{item.name}</strong><small>{quantityText} × {money(item.unitPrice, settings.currency)} · {item.mode === 'wholesale' ? 'လက်ကား' : 'လက်လီ'}</small></div><b>{money(item.unitPrice * item.quantity, settings.currency)}</b></div>; })}<hr /><div className="receipt-total"><span>Subtotal</span><b>{money(lastSale.subtotal, settings.currency)}</b></div><div className="receipt-total"><span>Discount</span><b>{money(lastSale.discount, settings.currency)}</b></div><div className="receipt-total receipt-grand"><span>Total</span><b>{money(lastSale.total, settings.currency)}</b></div><p>Payment: {lastSale.paymentMethod}</p>{lastSale.paymentMethod === 'KPay' && lastSale.kpayTransactionReference && <p>KPay Transaction ID: {lastSale.kpayTransactionReference}</p>}{lastSale.paymentMethod === 'KPay' && (lastSale.kpayAccountNameSnapshot || lastSale.kpayAccountNumberSnapshot) && <><p>KPay Account: {lastSale.kpayAccountNameSnapshot || '-'}</p><p>KPay Account No: {lastSale.kpayAccountNumberSnapshot || '-'}</p></>}<p>Paid: {money(lastSale.paidAmount ?? (lastSale.paymentMethod === 'Cash' || lastSale.paymentMethod === 'KPay' ? lastSale.total : 0), settings.currency)}</p>{lastSale.paymentMethod === 'Cash' && <><p>Cash Received: {money(lastSale.cashReceivedAmount ?? lastSale.total, settings.currency)}</p><p>Change: {money(lastSale.changeAmount ?? 0, settings.currency)}</p></>}<p>Due: {money(lastSale.dueAmount ?? (lastSale.paymentMethod === 'Credit' ? lastSale.total : 0), settings.currency)}</p><p className="receipt-footer">{settings.receiptFooter}</p></>}</div></div>}
      {returnSale && <SaleReturnDialog key={returnSale.id} sale={returnSale} registries={stockUnitRegistries} products={products} currency={settings.currency} busy={adjustmentBusy} onClose={() => { if (!adjustmentBusy) setReturnSale(null); }} onSubmit={handleReturnSubmit} />}
      {cameraScannerTarget !== null && <Suspense fallback={<div className="modal-backdrop"><section className="modal-card"><p>Barcode Scanner ဖွင့်နေပါတယ်…</p></section></div>}><BarcodeCameraScanner open onClose={() => setCameraScannerTarget(null)} onDetected={handleCameraBarcodeDetected} title={cameraScannerTarget === 'product' ? 'ပစ္စည်း Barcode ထည့်ရန်' : 'POS Barcode ဖတ်ရန်'} /></Suspense>}
      {toast && (toastActionPage
        ? <button className="toast toast-action" type="button" onClick={() => { setPage(toastActionPage); setToast(''); setToastActionPage(null); }}><PackageCheck size={17} /> {toast}</button>
        : <div className="toast"><Check size={17} /> {toast}</div>)}
    </div>
  );
}

function MiniStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: 'warning' }) {
  return <div className="mini-stat"><div className={`mini-stat-icon ${tone === 'warning' ? 'warning' : ''}`}>{icon}</div><div><small>{label}</small><strong>{value}</strong></div></div>;
}
class ContentErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { message: string }> {
  state = { message: '' };
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : 'Unknown error' };
  }
  componentDidCatch(error: unknown) {
    console.error('[Minimart Page Error]', error);
  }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.message) this.setState({ message: '' });
  }
  render() {
    if (!this.state.message) return this.props.children;
    return <section className="page-stack"><div className="panel empty-state"><div className="empty-icon"><AlertTriangle size={22} /></div><strong>ဒီစာမျက်နှာကို ဖွင့်မရပါ</strong><p>အခြားစာမျက်နှာများနှင့် သိမ်းထားသော Data များ မထိခိုက်ပါ။ ပြန်စမ်းကြည့်ပါ။</p><button className="button button-outline" type="button" onClick={() => this.setState({ message: '' })}>ပြန်စမ်းရန်</button></div></section>;
  }
}

function EmptyState({ icon, title, text, action, onAction }: { icon: ReactNode; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{text}</p>{action && onAction && <button className="button button-outline" onClick={onAction}>{action}</button>}</div>;
}

function BranchOverviewPage({
  branches, products, sales, expenses, cashShifts, stockBatches, activeBranchName, activeBranchId, activeCartCount, currency, onOpenBranch, onManageBranches, onResumePos,
}: {
  branches: Branch[];
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  cashShifts: Array<{ branchId?: string; closedAt?: string }>;
  stockBatches: StockBatch[];
  activeBranchName: string;
  activeBranchId: string;
  activeCartCount: number;
  currency: string;
  onOpenBranch: (branchId: string) => void;
  onManageBranches: () => void;
  onResumePos: () => void;
}) {
  const todayDate = today();
  const overview = useMemo(() => buildBranchOverview({
    branches, products, sales, expenses, stockBatches, cashShifts, todayKey: todayDate,
  }), [branches, products, sales, expenses, stockBatches, cashShifts, todayDate]);
  const branchSummaries = overview.summaries;
  const summaryTotals = overview.totals;
  const recentSales = overview.recentSales;
  const branchNameById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch.name])), [branches]);

  return <section className="page-stack branch-overview-page">
    <div className="section-heading">
      <div>
        <h2>လုပ်ငန်းတစ်ခုလုံး၏ အခြေအနေ</h2>
        <p>ဆိုင်ခွဲအားလုံး၏ ယနေ့လုပ်ငန်းအခြေအနေကို တစ်နေရာတည်းမှ ကြည့်ရှုပါ။ လက်ရှိ POS ဆိုင်မှာ <strong>{activeBranchName}</strong> ဖြစ်ပါတယ်။</p>
      </div>
      <button className="button button-outline" type="button" onClick={onManageBranches}><Store size={15} /> ဆိုင်ခွဲစီမံရန်</button>
    </div>
    {activeCartCount > 0 && <div className="backup-warning branch-overview-cart-note"><ShoppingCart size={17} /><span>လက်ရှိ POS Cart တွင် ပစ္စည်း {activeCartCount} မျိုး ရှိနေပြီး <strong>{activeBranchName}</strong> အတွက်သာ ဖြစ်ပါတယ်။ ဆိုင်ပြောင်းမထားသေးပါ။</span><button className="button button-outline" type="button" onClick={onResumePos}>Cart သို့ပြန်ရန်</button></div>}

    <div className="branch-overview-summary-grid">
      <div className="metric-card metric-primary">
        <div className="metric-head"><span>ဆိုင်အားလုံး ယနေ့အရောင်း</span><div><TrendingUp size={17} /></div></div>
        <strong>{money(summaryTotals.revenue, currency)}</strong>
        <small>{summaryTotals.salesCount} transactions</small>
        <div className="metric-foot">Active Branch အားလုံး၏ စုစုပေါင်း</div>
      </div>
      <div className="metric-card">
        <div className="metric-head"><span>ယနေ့ ခန့်မှန်းအမြတ်</span><div><CircleDollarSign size={17} /></div></div>
        <strong>{money(summaryTotals.profit, currency)}</strong>
        <small>ပြီးစီးပြီးသော အရောင်းများသာ</small>
        <div className="metric-foot">Branch cost snapshot အပေါ် အခြေခံသည်</div>
      </div>
      <div className="metric-card">
        <div className="metric-head"><span>ဆိုင်ခွဲ / Product</span><div><Store size={17} /></div></div>
        <strong>{branches.length} ဆိုင်</strong>
        <small>စုစုပေါင်း Product {summaryTotals.products} မျိုး</small>
        <div className="metric-foot">Product Catalog သီးခြားစီ</div>
      </div>
      <div className="metric-card">
        <div className="metric-head"><span>စစ်ဆေးရန် လိုအပ်ချက်</span><div className="metric-alert"><AlertTriangle size={17} /></div></div>
        <strong>{summaryTotals.lowStock + summaryTotals.pendingExpenses}</strong>
        <small>Stock Alert {summaryTotals.lowStock} · Approval {summaryTotals.pendingExpenses}</small>
        <div className="metric-foot">ဆိုင်တစ်ဆိုင်ချင်း ဝင်ရောက်စစ်ဆေးပါ</div>
      </div>
    </div>

    <div className="panel branch-overview-panel">
      <div className="panel-heading">
        <div><h3>ကျွန်ုပ်၏ ဆိုင်ခွဲများ</h3><p>ဆိုင်တစ်ဆိုင်ကို ရွေးပြီး အသေးစိတ်စီမံခန့်ခွဲပါ။</p></div>
        <span className="sales-summary-chip"><Store size={15} /> {branches.length} Active Branches</span>
      </div>
      {branchSummaries.length === 0 ? <EmptyState icon={<Store size={24} />} title="ဆိုင်ခွဲ မရှိသေးပါ" text="ပထမဆုံး ဆိုင်ခွဲတစ်ခု ဖန်တီးပြီး စတင်အသုံးပြုပါ။" action="ဆိုင်ခွဲဖန်တီးရန်" onAction={onManageBranches} /> : <div className="branch-overview-grid">
        {branchSummaries.map((summary) => <article className="branch-overview-card" key={summary.branch.id}>
          <div className="branch-overview-card-head">
            <div className="branch-overview-icon"><Store size={20} /></div>
            <div className="branch-overview-title"><strong>{summary.branch.name}</strong><small>{summary.branch.code} · {summary.branch.address || 'လိပ်စာ မဖြည့်ရသေး'}</small></div>
            <span className="tag tag-success">Active</span>
            {summary.branch.id === activeBranchId && <span className="tag">လက်ရှိ POS ဆိုင်</span>}
          </div>
          <div className="branch-overview-revenue"><small>ယနေ့အရောင်း</small><strong>{money(summary.revenue, currency)}</strong><span>{summary.salesCount} transactions</span></div>
          <div className="branch-overview-metrics">
            <div><small>Product</small><strong>{summary.productCount}</strong></div>
            <div><small>Stock Alert</small><strong className={summary.lowStockCount > 0 ? 'stock-warning' : ''}>{summary.lowStockCount}</strong></div>
            <div><small>Open Shift</small><strong>{summary.openShiftCount}</strong></div>
            <div><small>Pending Expense</small><strong className={summary.pendingExpenses > 0 ? 'stock-warning' : ''}>{summary.pendingExpenses}</strong></div>
          </div>
          <button className="button button-primary branch-overview-open" type="button" onClick={() => onOpenBranch(summary.branch.id)}>
            ဒီဆိုင်သို့ ဝင်ရန် <ArrowUpRight size={15} />
          </button>
        </article>)}
      </div>}
    </div>

    <div className="panel recent-panel">
      <div className="panel-heading"><div><h3>ဆိုင်အားလုံး၏ နောက်ဆုံးအရောင်း</h3><p>Branch တစ်ခုချင်းစီရဲ့ နောက်ဆုံး Voucher များ</p></div></div>
      {recentSales.length === 0 ? <EmptyState icon={<Receipt size={23} />} title="အရောင်းမှတ်တမ်း မရှိသေးပါ" text="ဆိုင်ခွဲတစ်ခုချင်းစီတွင် POS အသုံးပြုပြီးနောက် မှတ်တမ်းများ ဒီနေရာမှာ ပေါ်လာပါမယ်။" /> : <div className="table-wrap table-cards"><table><thead><tr><th>ဆိုင်</th><th>Voucher</th><th>Customer</th><th>နေ့စွဲ</th><th>Payment</th><th>စုစုပေါင်း</th></tr></thead><tbody>{recentSales.map((sale) => <tr key={`${sale.branchId || 'legacy'}-${sale.id}`}><td data-label="ဆိုင်">{sale.branchId ? (branchNameById.get(sale.branchId) || 'Archived Branch') : 'Branch မသတ်မှတ်ထား'}</td><td data-label="Voucher"><strong className="mono">{sale.receiptNo}</strong></td><td data-label="Customer">{sale.customer}</td><td data-label="နေ့စွဲ">{dateLabel(sale.date)}</td><td data-label="Payment"><span className={`tag ${sale.paymentMethod === 'Credit' ? 'tag-warn' : ''}`}>{sale.paymentMethod}</span></td><td data-label="စုစုပေါင်း"><b>{money(sale.total, currency)}</b></td></tr>)}</tbody></table></div>}
    </div>

    <div className="analytics-note"><Activity size={18} /><div><strong>Branch Data ခွဲခြားထားခြင်း</strong><p>ဒီ Overview မှာ Active Branch များ၏ Local/Cloud မှ ရရှိထားသော Data ကိုသာ စုစည်းပြသပါတယ်။ Stock၊ Cost၊ Cash၊ KPay နဲ့ Expense ကို Branch တစ်ခုချင်းစီအလိုက် သီးခြားစီမံထားပြီး ဆိုင်တစ်ဆိုင်သို့ ဝင်မှသာ အဲဒီဆိုင်၏လုပ်ငန်းများကို ဆောင်ရွက်နိုင်ပါတယ်။</p></div></div>
  </section>;
}

function DashboardPage({
  todayRevenue, todayProfit, todayCount, productCount, totalStockUnits, lowStockProducts, sellableStock,
  sales, settings, trend, trendMax, chartPeriod, setChartPeriod, navTo, bannerSource,
}: {
  todayRevenue: number; todayProfit: number; todayCount: number; productCount: number; bannerSource: string;
  totalStockUnits: number; lowStockProducts: Product[]; sellableStock: (product: Product) => number; sales: Sale[];
  settings: { currency: string; storeName: string };
  trend: { key: string; label: string; value: number }[]; trendMax: number;
  chartPeriod: '7' | '30' | '365'; setChartPeriod: (value: '7' | '30' | '365') => void; navTo: (page: Page) => void;
}) {
  const recentSales = sales.slice(0, 5);
  const productCountLabel = `${productCount} မျိုး`;
  return <section className="page-stack">{bannerSource && <div className="welcome-banner has-shop-banner"><img className="welcome-banner-image" src={bannerSource} alt="Shop banner" /><div className="welcome-banner-copy"><h2>{settings.storeName}</h2></div></div>}<div className="dashboard-stats"><div className="metric-card metric-primary"><div className="metric-head"><span>ယနေ့ ရောင်းအား</span><div><TrendingUp size={17} /></div></div><strong>{money(todayRevenue, settings.currency)}</strong><small>ယနေ့ {todayCount} ကြိမ်</small></div><div className="metric-card"><div className="metric-head"><span>ယနေ့ ခန့်မှန်းအမြတ်</span><div><CircleDollarSign size={17} /></div></div><strong>{money(todayProfit, settings.currency)}</strong><small>Discount နုတ်ပြီး</small></div><div className="metric-card"><div className="metric-head"><span>ပစ္စည်းအမျိုးအစား</span><div><Boxes size={17} /></div></div><strong>{productCountLabel}</strong><small>လက်ကျန်ရှိ {totalStockUnits} မျိုး</small></div><div className="metric-card"><div className="metric-head"><span>Stock သတိပေးချက်</span><div className="metric-alert"><AlertTriangle size={17} /></div></div><strong>{lowStockProducts.length} မျိုး</strong><small>ပြန်လည်မှာယူရန် စစ်ဆေးပါ</small><button className="metric-link" onClick={() => navTo('inventory')}>ပစ္စည်းစာရင်း <ArrowUpRight size={13} /></button></div></div><div className="dashboard-grid"><div className="panel chart-panel"><div className="panel-heading"><div><h3>ရောင်းအား အခြေအနေ</h3><p>နေ့စဉ် ရောင်းအားပြဇယား</p></div><div className="period-switch"><button className={chartPeriod === '7' ? 'active' : ''} onClick={() => setChartPeriod('7')}>7D</button><button className={chartPeriod === '30' ? 'active' : ''} onClick={() => setChartPeriod('30')}>30D</button><button className={chartPeriod === '365' ? 'active' : ''} onClick={() => setChartPeriod('365')}>12M</button></div></div><div className="bar-chart dashboard-chart">{trend.map((item) => <div className="bar-column" key={item.key}><div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(item.value ? 4 : 0, item.value / trendMax * 100)}%` }} title={money(item.value, settings.currency)} /></div><small>{item.label}</small></div>)}</div></div><div className="panel low-stock-panel"><div className="panel-heading"><div><h3>လက်ကျန်နည်းပစ္စည်း</h3><p>ပြန်ဖြည့်ရန် လိုအပ်သောပစ္စည်း</p></div><AlertTriangle className="warning-text" size={18} /></div>{lowStockProducts.length === 0 ? <EmptyState icon={<Check size={23} />} title="အားလုံး အဆင်ပြေပါတယ်" text="Stock နည်းနေသော ပစ္စည်းမရှိပါ။" /> : <div className="low-stock-list">{lowStockProducts.slice(0, 5).map((product) => <div className="low-stock-row" key={product.id}><div className="table-product-icon"><ShoppingBag size={16} /></div><div><strong>{product.name}</strong><small>{product.sku}</small></div><b className="stock-warning">{formatQuantity(sellableStock(product), quantityModeForProduct(product))} {product.unit} ရောင်းနိုင်</b></div>)}</div>}<button className="panel-link" onClick={() => navTo('inventory')}>ပစ္စည်းအားလုံးကြည့်ရန် <ArrowUpRight size={14} /></button></div></div><div className="panel recent-panel"><div className="panel-heading"><div><h3>နောက်ဆုံး အရောင်းများ</h3></div><button className="text-button" onClick={() => navTo('sales')}>အားလုံးကြည့်ရန် <ArrowUpRight size={14} /></button></div>{recentSales.length === 0 ? <EmptyState icon={<Receipt size={23} />} title="အရောင်းမှတ်တမ်း မရှိသေးပါ" text="အရောင်းစာမျက်နှာတွင် စတင်ရောင်းချနိုင်ပါသည်။" action="အရောင်းသို့သွားရန်" onAction={() => navTo('pos')} /> : <div className="table-wrap table-cards"><table><thead><tr><th>Voucher</th><th>ဝယ်သူ</th><th>အချိန်</th><th>ငွေပေးချေမှု</th><th>စုစုပေါင်း</th><th>အခြေအနေ</th></tr></thead><tbody>{recentSales.map((sale) => <tr key={sale.id}><td data-label="Voucher"><strong className="mono">{sale.receiptNo}</strong></td><td data-label="ဝယ်သူ">{sale.customer}</td><td data-label="အချိန်">{dateLabel(sale.date)}</td><td data-label="ငွေပေးချေမှု"><span className={`tag ${sale.paymentMethod === 'Credit' ? 'tag-warn' : ''}`}>{sale.paymentMethod}</span>{sale.paymentMethod === 'KPay' && sale.kpayTransactionReference && <small>TX: {sale.kpayTransactionReference}</small>}{sale.paymentMethod === 'KPay' && (sale.kpayAccountNameSnapshot || sale.kpayAccountNumberSnapshot) && <small>KPay: {sale.kpayAccountNameSnapshot || '-'} · {sale.kpayAccountNumberSnapshot || '-'}</small>}</td><td data-label="စုစုပေါင်း"><b>{money(sale.total, settings.currency)}</b></td><td data-label="အခြေအနေ"><span className="tag tag-success">ပြီးစီး</span></td></tr>)}</tbody></table></div>}</div></section>;
}

export default App;
