import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, AlertTriangle, ArchiveRestore, ArrowDownToLine, ArrowUpRight, BarChart3, Barcode, ChevronDown,
  Boxes, Camera, Check, CircleDollarSign, ClipboardList, CreditCard, Download,
  FileJson, LayoutDashboard, LockKeyhole, Menu, Minus, PackagePlus,
  Plus, Printer, Receipt, Search, Settings, ShoppingBag, ShoppingCart, Copy,
  Smartphone, Store, Trash2, TrendingUp, Truck, Wallet, X, Users, CalendarClock, UserRound, Sun, Moon, LogOut, PackageCheck, Send,
} from 'lucide-react';
import {
  usePosStore, type Branch, type CartItem, type Expense, type PriceMode, type Product, type Sale, type StockBatch,
} from './store/usePosStore';
import { CustomerCreditPage, ExpiryTrackingPage, SupplierPurchasePage } from './components/BusinessPages';
import { StockReceivingPage } from './components/StockReceivingPage';
import { StockTransferPage } from './components/StockTransferPage';
import { BranchShipmentManagementPage } from './components/BranchShipmentManagementPage';
import { BranchStockReceivingPage } from './components/BranchStockReceivingPage';
import { StockUnitRegistrationPage } from './components/StockUnitRegistrationPage';
import { ActivityLogPage, CashManagementPage } from './components/OperationsPages';
import { ExpenseManagementPage } from './components/ExpenseManagementPage';
import { CashierSettlementManagementPage } from './components/CashierSettlementManagementPage';
import { BranchFinanceManagementPage } from './components/BranchFinanceManagementPage';
import { AnalyticsPage } from './components/AnalyticsPage';
import type { CashierSettlementCreateInput, CashierSettlementRecord } from './types/finance';
import { CloudSyncPanel } from './components/CloudSyncPanel';
import { useBusinessAccess, canAccessBranch, canUsePage } from './lib/businessAccess';
import { firebaseApp, firebaseAuth, FIREBASE_BUSINESS_ID } from './lib/firebase';
import { signOut } from 'firebase/auth';
import { BranchManagementPage } from './components/BranchManagementPage';
import { ProfileManagementPage } from './components/ProfileManagementPage';
import { BarcodeCameraScanner } from './components/BarcodeCameraScanner';
import { CashierSalesQueueStatus } from './components/CashierSalesQueueStatus';
import { LoginPage } from './features/auth/LoginPage';
import { normalizeBarcode } from './lib/barcode';
import { submitCashierSale } from './lib/cashierSalesSync';
import { flushPendingCashierExpenses, submitCashierExpenseToCloud } from './lib/cashierExpenseSync';
import { voidCloudSaleWithAudit } from './lib/salesAudit';
import { exportLocalImages, importLocalImages, migrateDataUrlImage, useLocalImageSource } from './lib/localImages';
import { formatQuantity, hasLegacyFractionalQuantity, inferQuantityMode, isValidQuantity, quantityModeForProduct, quantityStep, type QuantityMode } from './lib/quantity';

type Page = 'profile' | 'branches' | 'dashboard' | 'pos' | 'inventory' | 'unitBarcodes' | 'receiving' | 'transfers' | 'shipments' | 'branchReceiving' | 'sales' | 'customers' | 'purchasing' | 'expiry' | 'cash' | 'activity' | 'expenses' | 'settlements' | 'finance' | 'analytics' | 'settings';
type ProductDraft = {
  name: string; sku: string; barcode: string; category: string; costPrice: string; retailPrice: string;
  wholesalePrice: string; stock: string; lowStockAt: string; unit: string; quantityMode: QuantityMode;
};

const emptyDraft: ProductDraft = {
  name: '', sku: '', barcode: '', category: 'အထွေထွေ', costPrice: '0', retailPrice: '0',
  wholesalePrice: '0', stock: '0', lowStockAt: '5', unit: 'ခု', quantityMode: 'whole',
};
const money = (value: number, currency = 'MMK') => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value || 0))} ${currency}`;
const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const today = () => dayKey(new Date());
const makeReceiptNo = () => `MM-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-5)}`;

async function copyAccessValue(value: string, label: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(value);
    window.alert(`${label} ကို ကူးယူပြီးပါပြီ။`);
  } catch {
    window.prompt(`${label} ကို ကိုယ်တိုင် Copy လုပ်ပါ။`, value);
  }
}

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const access = useBusinessAccess();
  const cashierMode = access.status === 'active' && access.role === 'cashier';
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('minimart-ui-theme-v1') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [toastActionPage, setToastActionPage] = useState<Page | null>(null);
  const [installPrompt, setInstallPrompt] = useState<(() => Promise<void>) | null>(null);
  const [showProductModal, setShowProductModal] = useState(false);
  const [cameraScannerTarget, setCameraScannerTarget] = useState<'product' | 'pos' | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyDraft);
  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('အားလုံး');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState('လက်လီဝယ်သူ');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'KPay' | 'Credit'>('Cash');
  const [kpayTransactionReference, setKpayTransactionReference] = useState('');
  const [discount, setDiscount] = useState('0');
  const [saleSearch, setSaleSearch] = useState('');
  const [lastSale, setLastSale] = useState<Sale | null>(null);
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
  const importRef = useRef<HTMLInputElement>(null);

  const allProducts = usePosStore((s) => s.products);
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
  const products = useMemo(() => allProducts.filter((record) => record.branchId === activeBranchId), [allProducts, activeBranchId]);
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
  const ownerPhotoSource = useLocalImageSource(ownerProfile?.photoUrl);
  const setActiveBranch = usePosStore((s) => s.setActiveBranch);
  const addProduct = usePosStore((s) => s.addProduct);
  const updateProduct = usePosStore((s) => s.updateProduct);
  const deleteProduct = usePosStore((s) => s.deleteProduct);
  const addCategory = usePosStore((s) => s.addCategory);
  const adjustStock = usePosStore((s) => s.adjustStock);
  const addSale = usePosStore((s) => s.addSale);
  const voidSale = usePosStore((s) => s.voidSale);
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
    document.documentElement.dataset.theme = themeMode;
    try { localStorage.setItem('minimart-ui-theme-v1', themeMode); } catch { /* Theme still works for this session. */ }
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = themeMode === 'dark' ? '#0b1220' : '#0f766e';
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
    if (cashierMode && !access.branchIds.includes(activeBranchId)) {
      const firstAllowed = branches.find((branch) => branch.status === 'active' && access.branchIds.includes(branch.id));
      if (firstAllowed) { setActiveBranch(firstAllowed.id); setPage('dashboard'); setCart([]); }
    }
  }, [cashierMode, access.branchIds, activeBranchId, branches, setActiveBranch]);

  useEffect(() => {
    if (cashierMode && !canUsePage(access.role, page, access.canReceiveStock)) setPage('pos');
  }, [cashierMode, access.role, access.canReceiveStock, page]);

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
    window.setTimeout(() => setToast(''), 2800);
  };

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
  const authorize = (action: string) => {
    if (cashierMode) { notify('ဒီလုပ်ဆောင်ချက်အတွက် Owner ခွင့်ပြုချက် လိုအပ်ပါတယ်။'); return false; }
    const pin = window.prompt(`${action}\nAdmin PIN ထည့်ပါ။`);
    if (pin === null) return false;
    if (pin !== settings.adminPin) { notify('Admin PIN မှားယွင်းနေပါတယ်။'); return false; }
    return true;
  };
  const handleVoidSale = async (sale: Sale) => {
    if (!authorize('Voucher ပယ်ဖျက်ရန်')) return;
    const reason = window.prompt('Voucher ပယ်ဖျက်ရသည့် အကြောင်းပြချက်ကို ဖြည့်ပါ။');
    if (!reason || reason.trim().length < 3) { notify('Void အကြောင်းပြချက် အနည်းဆုံး ၃ လုံး ဖြည့်ပါ။'); return; }
    if (!window.confirm(`Voucher ${sale.receiptNo} ကို Void လုပ်မလား။ Cloud Stock ကို တစ်ကြိမ်တည်း ပြန်ပေါင်းပါမယ်။ ဤလုပ်ဆောင်ချက်သည် ငွေပြန်အမ်းခြင်း မဟုတ်ပါ။`)) return;
    const actor = {
      uid: access.uid || firebaseAuth?.currentUser?.uid || '',
      email: access.email || firebaseAuth?.currentUser?.email || '',
      name: access.displayName || firebaseAuth?.currentUser?.displayName || access.email || 'Owner',
    };
    try {
      if (firebaseAuth && access.status === 'active' && access.role === 'owner') {
        const auditEvent = await voidCloudSaleWithAudit(sale, reason.trim(), actor);
        const applied = voidSale(sale.id, reason.trim(), actor, auditEvent.occurredAt);
        if (!applied) throw new Error('Cloud Void အောင်မြင်သော်လည်း Local Sale ကို ပြင်မရပါ။ Refresh လုပ်ပြီး အခြေအနေကို စစ်ပါ။');
        notify('Voucher ကို ပယ်ဖျက်ပြီး Stock ပြန်ပေါင်းထားပါတယ်။ Audit Log သိမ်းပြီးပါပြီ။');
        return;
      } else if (firebaseAuth) {
        throw new Error('Firebase Owner Business Access မရှိပါ။ Owner အကောင့်ဖြင့် ပြန်ဝင်ပါ။');
      }
      const applied = voidSale(sale.id, reason.trim(), actor);
      if (!applied) throw new Error('Cloud Void အောင်မြင်သော်လည်း ဒီ Device ရဲ့ Local Sale ကို ပြင်မရပါ။ Data ကို Refresh လုပ်ပြီး စစ်ဆေးပါ။');
      notify('Voucher ကို ပယ်ဖျက်ပြီး Stock ပြန်ပေါင်းထားပါတယ်။ Audit Log သိမ်းပြီးပါပြီ။');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Voucher Void မအောင်မြင်ပါ။');
    }
  };
  const switchBranch = (branchId: string) => {
    if (!canAccessBranch(access.role, access.branchIds, branchId)) { notify('ဒီဆိုင်ကို ဝင်ခွင့်မရှိပါ။ Owner ကို ဆက်သွယ်ပါ။'); return; }
    if (branchId === activeBranchId) return;
    if (!cashierMode && !authorize('ဆိုင်ခွဲပြောင်းရန်')) return;
    setActiveBranch(branchId);
    setCart([]); setDiscount('0'); setCashReceived(''); setShowPaymentModal(false); setLastSale(null); setCategoryFilter('အားလုံး');
    setPage('dashboard'); setMobileMenu(false);
    const target = branches.find((branch) => branch.id === branchId);
    notify(`${target?.name || 'ဆိုင်'} သို့ ပြောင်းပြီးပါပြီ။`);
  };
  const viewBranchInventory = (branchId: string) => {
    if (!canAccessBranch(access.role, access.branchIds, branchId)) { notify('ဒီဆိုင်ကို ဝင်ခွင့်မရှိပါ။ Owner ကို ဆက်သွယ်ပါ။'); return; }
    setActiveBranch(branchId);
    setCart([]); setDiscount('0'); setCashReceived(''); setShowPaymentModal(false); setLastSale(null); setCategoryFilter('အားလုံး');
    setPage('inventory'); setMobileMenu(false);
    const target = branches.find((branch) => branch.id === branchId);
    notify(`${target?.name || 'ဆိုင်'} Inventory ကို ဖွင့်ထားပါတယ်။`);
  };

  // Cashier history is scoped to the authenticated UID; legacy unattributed sales stay Owner-only.
  const visibleSales = useMemo(() => cashierMode ? sales.filter((sale) => sale.createdByUid === access.uid) : sales, [sales, cashierMode, access.uid]);
  // Different units (pieces, bottles, kg, litres) must not be added into one meaningless total.
  const stockedProductCount = products.filter((product) => product.stock > 0).length;
  const legacyFractionalStockCount = products.filter((product) => hasLegacyFractionalQuantity(product.stock, quantityModeForProduct(product))).length;
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const expiredBatchUnits = useMemo(() => {
    const totals = new Map<string, number>();
    stockBatches.forEach((batch) => { if (batch.expiryDate && batch.expiryDate < today() && batch.quantity > 0) totals.set(batch.productId, (totals.get(batch.productId) || 0) + batch.quantity); });
    return totals;
  }, [stockBatches]);
  const sellableStock = (product: Product) => Math.max(0, product.stock - (expiredBatchUnits.get(product.id) || 0));
  const lowStockProducts = products.filter((product) => sellableStock(product) <= product.lowStockAt);
  const filteredProducts = products.filter((product) => {
    const query = productSearch.trim().toLowerCase();
    const match = !query || product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query) || normalizeBarcode(product.barcode).toLowerCase().includes(normalizeBarcode(query));
    return match && (categoryFilter === 'အားလုံး' || product.category === categoryFilter);
  });
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discountValue = Math.max(0, Math.min(subtotal, Number(discount) || 0));
  const checkoutTotal = Math.max(0, subtotal - discountValue);
  const cartProfit = cart.reduce((sum, item) => sum + (item.unitPrice - item.costPrice) * item.quantity, 0) - discountValue;
  const filteredSales = visibleSales.filter((sale) => sale.receiptNo.toLowerCase().includes(saleSearch.toLowerCase()) || sale.customer.toLowerCase().includes(saleSearch.toLowerCase()));

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
    });
    setShowProductModal(true);
  };
  const saveProduct = (event: FormEvent) => {
    event.preventDefault();
    if (!productDraft.name.trim()) { notify('ပစ္စည်းအမည် ဖြည့်ပါ။'); return; }
    if (!categories.includes(productDraft.category)) { notify('လက်ရှိဆိုင်အတွက် Category ရွေးပါ သို့မဟုတ် အသစ်ထည့်ပါ။'); return; }
    const unit = productDraft.unit.trim() || 'ခု';
    const quantityMode = productDraft.quantityMode || inferQuantityMode(unit);
    const stock = Math.max(0, Number(productDraft.stock) || 0);
    const lowStockAt = Math.max(0, Number(productDraft.lowStockAt) || 0);
    const editingHasUnitBarcodes = !!editingProduct && stockUnitRegistries.some((registry) => registry.branchId === activeBranchId && registry.productId === editingProduct.id && registry.units.length > 0);
    const stockChanged = !editingProduct || Math.abs(stock - editingProduct.stock) > 1e-8;
    const modeChanged = !!editingProduct && quantityMode !== quantityModeForProduct(editingProduct);
    if (editingHasUnitBarcodes && (stockChanged || modeChanged)) { notify('ဒီပစ္စည်းမှာ တစ်ခုချင်း Barcode Tracking ရှိနေပါတယ်။ Stock နဲ့ အရေအတွက်တွက်ချက်ပုံကို ဒီနေရာမှာ မပြောင်းနိုင်ပါ။ Sticker Registration / Unit စာရင်းနဲ့သာ ပြင်ဆင်ပါ။'); return; }
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
      stock, lowStockAt, unit, quantityMode,
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

  const addToCart = (product: Product) => {
    const unitTracked = stockUnitRegistries.some((entry) => entry.branchId === activeBranchId && entry.productId === product.id && entry.units.length > 0);
    if (unitTracked) { notify('ဒီပစ္စည်းကို Sticker တစ်ခုချင်း Scan ဖတ်ပြီးမှ Cart ထဲထည့်နိုင်ပါတယ်။'); return; }
    if (!(product.retailPrice > 0)) { notify('ဒီပစ္စည်းရဲ့ လက်လီဈေး မသတ်မှတ်ရသေးပါ။ Inventory မှာ ဈေးထည့်ပါ။'); return; }
    if (sellableStock(product) <= 0) { notify('ရောင်းချနိုင်သော Stock မရှိပါ။ Expiry Date ကို စစ်ဆေးပါ။'); return; }
    setCart((current) => {
      const found = current.find((item) => item.productId === product.id);
      if (found) {
        const increment = quantityModeForProduct(product) === 'decimal' ? 0.1 : 1;
        if (found.quantity + increment > sellableStock(product) + 1e-8) { notify('သက်တမ်းမကုန်သေးသော လက်ကျန် Stock ထက် ပိုမရောင်းနိုင်ပါ။'); return current; }
        return current.map((item) => item.productId === product.id ? { ...item, quantity: Math.round((item.quantity + increment) * 1000) / 1000 } : item);
      }
      return [...current, {
        productId: product.id, name: product.name, sku: product.sku, quantity: 1,
        unitPrice: product.retailPrice, costPrice: product.costPrice, mode: 'retail', stockAtAdd: product.stock,
        unit: product.unit, quantityMode: quantityModeForProduct(product),
      }];
    });
  };
  const addScannedProductToCart = (rawCode: string) => {
    const code = normalizeBarcode(rawCode);
    if (!code) return;
    const unitMatch = stockUnitRegistries
      .filter((entry) => entry.branchId === activeBranchId)
      .map((registry) => ({ registry, unit: registry.units.find((entry) => normalizeBarcode(entry.barcode) === code) }))
      .find((entry) => !!entry.unit);
    if (unitMatch?.unit) {
      const { registry, unit } = unitMatch;
      if (unit.status !== 'in_stock') { notify(unit.status === 'sold' ? `ဒီ Barcode ကို ရောင်းပြီးပါပြီ: ${code}` : `ဒီ Barcode ကို လက်ရှိရောင်းချလို့မရပါ။ Status: ${unit.status}`); setProductSearch(''); return; }
      const product = products.find((entry) => entry.id === registry.productId && (entry.branchId || 'branch-main') === activeBranchId);
      if (!product) { notify('ဒီ Barcode ရဲ့ Product ကို ဒီဆိုင်မှာ မတွေ့ပါ။'); setProductSearch(''); return; }
      if (!(product.retailPrice > 0)) { notify('ဒီပစ္စည်းရဲ့ လက်လီဈေး မသတ်မှတ်ရသေးပါ။ Inventory မှာ ဈေးထည့်ပါ။'); setProductSearch(''); return; }
      setCart((current) => {
        const existing = current.find((item) => item.productId === product.id);
        const selection = { unitId: unit.id, barcode: unit.barcode, registryId: registry.id };
        if (current.some((item) => (item.stockUnitSelections || []).some((entry) => entry.unitId === unit.id))) {
          notify('ဒီ Barcode ကို Cart ထဲမှာ ထည့်ပြီးသားပါ။'); return current;
        }
        if (existing) return current.map((item) => item.productId === product.id ? {
          ...item, quantity: item.quantity + 1,
          stockUnitSelections: [...(item.stockUnitSelections || []), selection],
        } : item);
        return [...current, {
          productId: product.id, name: product.name, sku: product.sku, quantity: 1,
          unitPrice: product.retailPrice, costPrice: product.costPrice, mode: 'retail', stockAtAdd: product.stock,
          unit: product.unit, quantityMode: quantityModeForProduct(product), stockUnitSelections: [selection],
        }];
      });
      setProductSearch('');
      return;
    }
    const match = products.find((product) => normalizeBarcode(product.barcode) === code || normalizeBarcode(product.sku) === code);
    if (!match) { notify(`Barcode မတွေ့ပါ: ${code}`); setProductSearch(''); return; }
    const unitTracked = stockUnitRegistries.some((entry) => entry.branchId === activeBranchId && entry.productId === match.id && entry.units.length > 0);
    if (unitTracked) { notify('ဒီပစ္စည်းမှာ Unit Barcode Tracking ဖွင့်ထားပါတယ်။ ပစ္စည်းပေါ်က Sticker တစ်ခုချင်းစီကို Scan ဖတ်ပါ။'); setProductSearch(''); return; }
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
    const currentItem = cart.find((item) => item.productId === productId);
    if (quantity <= 0) { setCart((items) => items.filter((item) => item.productId !== productId)); return; }
    if (currentItem?.stockUnitSelections?.length) {
      if (quantity > currentItem.stockUnitSelections.length) { notify('ဒီပစ္စည်းကို အရေအတွက်တိုးချင်ရင် Barcode Sticker တစ်ခု ထပ် Scan ဖတ်ပါ။'); return; }
      if (!Number.isInteger(quantity)) { notify('Barcode တစ်ခုချင်းစီအတွက် အရေအတွက်ပြည့်ကိန်းသာ သတ်မှတ်နိုင်ပါတယ်။'); return; }
      setCart((items) => items.map((item) => item.productId === productId ? { ...item, quantity, stockUnitSelections: (item.stockUnitSelections || []).slice(0, quantity) } : item));
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
    holdItem(item);
    setCart((items) => items.filter((entry) => entry.productId !== item.productId));
    notify('မယူတော့သောပစ္စည်းစာရင်းထဲ သိမ်းပြီးပါပြီ။');
  };
  const restoreHeld = (productId: string) => {
    const held = restoreHeldItem(productId);
    if (!held) return;
    setCart((items) => {
      const existing = items.find((item) => item.productId === productId);
      if (existing) return items.map((item) => item.productId === productId ? { ...item, quantity: item.quantity + held.quantity, stockUnitSelections: [...(item.stockUnitSelections || []), ...(held.stockUnitSelections || [])] } : item);
      const { heldAt, ...rest } = held;
      void heldAt;
      return [...items, rest];
    });
    notify('ပစ္စည်းကို Cart ထဲ ပြန်ထည့်ပြီးပါပြီ။');
  };
  const validateCheckout = (): boolean => {
    if (cart.some((item) => !Number.isFinite(item.unitPrice) || item.unitPrice <= 0)) { notify('ဈေးနှုန်း မသတ်မှတ်ရသေးသော ပစ္စည်းရှိနေပါတယ်။ အရင်ဆုံး ဈေးဖြည့်ပါ။'); return false; }
    if (!cart.length) { notify('ရောင်းချမည့်ပစ္စည်း မရှိသေးပါ။'); return false; }
    const insufficient = cart.find((item) => {
      const product = productMap.get(item.productId);
      if (!product || sellableStock(product) < item.quantity) return true;
      const tracked = stockUnitRegistries.some((entry) => entry.branchId === activeBranchId && entry.productId === item.productId && entry.units.length > 0);
      if (!tracked) return false;
      const selections = item.stockUnitSelections || [];
      if (selections.length !== item.quantity) return true;
      return selections.some((selection) => {
        const registry = stockUnitRegistries.find((entry) => entry.id === selection.registryId && entry.branchId === activeBranchId);
        return registry?.units.find((unit) => unit.id === selection.unitId)?.status !== 'in_stock';
      });
    });
    if (insufficient) { notify(`${insufficient.name} Stock သို့မဟုတ် Barcode Unit မလုံလောက်ပါ။ Sticker ကို ပြန် Scan ဖတ်ပါ။`); return false; }
    if (paymentMethod === 'Credit' && (!customer.trim() || customer.trim() === 'လက်လီဝယ်သူ')) { notify('အကြွေးဝယ်သူအမည်ကို မှန်ကန်စွာ ဖြည့်ပါ။'); return false; }
    if (paymentMethod === 'KPay' && (!activeBranch?.settings.kpayAccountName?.trim() || !activeBranch.settings.kpayAccountNumber?.trim())) { notify('ဒီ Branch ရဲ့ KPay Account ကို Owner က အရင်သတ်မှတ်ပေးရပါမယ်။'); return false; }
    return true;
  };
  const startCheckout = () => {
    if (!validateCheckout()) return;
    // Preserve a previously entered cash amount when the cashier returns to
    // the cart to reduce quantities, but start blank for a new checkout.
    setShowPaymentModal(true);
  };
  const cashReceivedValue = Math.max(0, Math.floor(Number(cashReceived) || 0));
  const cashShortfall = paymentMethod === 'Cash' ? Math.max(0, Math.round(checkoutTotal - cashReceivedValue)) : 0;
  const cashChange = paymentMethod === 'Cash' ? Math.max(0, Math.round(cashReceivedValue - checkoutTotal)) : 0;
  const completeSale = () => {
    if (!validateCheckout()) return;
    if (paymentMethod === 'Cash' && cashReceivedValue < checkoutTotal) {
      notify(`ငွေ ${money(Math.ceil(checkoutTotal - cashReceivedValue), settings.currency)} လိုနေသေးပါတယ်။ Cart ကို ပြန်ပြင်နိုင်ပါတယ်။`);
      return;
    }
    if (paymentMethod === 'KPay' && !kpayTransactionReference.trim()) { notify('KPay ငွေလွှဲ Transaction ID ဖြည့်ပါ။'); return; }
    const sale: Sale = {
      id: crypto.randomUUID(), receiptNo: makeReceiptNo(), date: new Date().toISOString(),
      customer: customer.trim() || 'လက်လီဝယ်သူ', paymentMethod, items: cart.map((item) => ({ ...item })),
      subtotal, discount: discountValue, total: checkoutTotal, profit: cartProfit, status: 'completed',
      ...(paymentMethod === 'Cash' ? { cashReceivedAmount: cashReceivedValue, changeAmount: cashChange } : {}),
      ...(paymentMethod === 'KPay' ? { kpayTransactionReference: kpayTransactionReference.trim() } : {}),
      createdByUid: access.uid || firebaseAuth?.currentUser?.uid || '',
      createdByEmail: access.email || firebaseAuth?.currentUser?.email || '',
      createdByName: access.displayName || firebaseAuth?.currentUser?.displayName || access.email || 'Owner',
    };
    const savedSale = addSale(sale);
    if (!savedSale) { notify('Stock သို့မဟုတ် ပစ္စည်းအချက်အလက် ပြောင်းလဲသွားပါတယ်။ Cart ကို ပြန်စစ်ပါ။'); return; }
    setShowPaymentModal(false);
    setLastSale(savedSale);
    setCheckoutResultSale(savedSale);
    setAmountOnlyMode(false);
    setShowCheckoutResult(true);
    setPrintTestMode(false);
    setCart([]); setDiscount('0'); setCustomer('လက်လီဝယ်သူ'); setPaymentMethod('Cash'); setCashReceived(''); setKpayTransactionReference(''); setShowHeldItems(false);
    if (cashierMode && access.uid) {
      void submitCashierSale(savedSale, access.uid, activeBranchId).then((result) => {
        if (result === 'synced') notify('အရောင်းကို Cloud ထဲ သိမ်းပြီး Stock ကို တစ်ကြိမ်တည်း လျှော့ပြီးပါပြီ။');
        else if (result === 'queued') notify('အရောင်းကို ဒီ Device မှာ သိမ်းထားပါတယ်။ Internet/Cloud ချိတ်ဆက်မှု ပြန်ကောင်းရင် ပြန်ပို့ပါမယ်။');
        else if (result === 'rules-error') notify('အရောင်းကို ဒီ Device မှာ ထိန်းထားပါတယ်။ Firebase Firestore Rules က ခွင့်မပြုသေးပါ။ Owner ကို အသိပေးပါ။');
        else notify('အရောင်းကို Local မှာ သိမ်းထားပါတယ်။ Cloud Stock မကိုက်ညီမှုရှိလို့ Owner ကို စစ်ဆေးခိုင်းပါ။');
      }).catch((error: unknown) => {
        notify(error instanceof Error ? `Cloud Sync မအောင်မြင်ပါ: ${error.message}` : 'Cloud Sync မအောင်မြင်ပါ။ အရောင်းကို Local မှာ သိမ်းထားပါတယ်။');
      });
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
    const lines = [settings.storeName, `Voucher: ${sale.receiptNo}`, dateLabel(sale.date), `Customer: ${sale.customer}`, '------------------------', ...sale.items.map((item) => { const product = productMap.get(item.productId); const quantityMode = item.quantityMode || (product ? quantityModeForProduct(product) : 'whole'); const quantityText = `${formatQuantity(item.quantity, quantityMode)} ${item.unit || product?.unit || ''}`.trim(); return `${item.name}\n${quantityText} x ${money(item.unitPrice, settings.currency)} = ${money(item.unitPrice * item.quantity, settings.currency)}`; }), '------------------------', `Subtotal: ${money(sale.subtotal, settings.currency)}`, `Discount: ${money(sale.discount, settings.currency)}`, `Total: ${money(sale.total, settings.currency)}`, `Payment: ${sale.paymentMethod}`, ...(sale.paymentMethod === 'KPay' && sale.kpayTransactionReference ? [`KPay Transaction ID: ${sale.kpayTransactionReference}`] : []), `Paid: ${money(sale.paidAmount ?? (sale.paymentMethod === 'Cash' || sale.paymentMethod === 'KPay' ? sale.total : 0), settings.currency)}`, ...(sale.paymentMethod === 'Cash' ? [`Cash Received: ${money(sale.cashReceivedAmount ?? sale.total, settings.currency)}`, `Change: ${money(sale.changeAmount ?? 0, settings.currency)}`] : []), `Due: ${money(sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), settings.currency)}`, settings.receiptFooter];
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
      ['Voucher', 'Date', 'Customer', 'Payment', 'Items', 'Subtotal', 'Discount', 'Total', 'Paid', 'Cash Received', 'Change', 'Due', 'Status'],
      ...visibleSales.map((sale) => [sale.receiptNo, sale.date, sale.customer, sale.paymentMethod, sale.items.length, sale.subtotal, sale.discount, sale.total, sale.paidAmount ?? (sale.paymentMethod === 'Cash' || sale.paymentMethod === 'KPay' ? sale.total : 0), sale.cashReceivedAmount ?? (sale.paymentMethod === 'Cash' ? sale.total : 0), sale.changeAmount ?? 0, sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), sale.status]),
    ]
    : [
      ['Voucher', 'Date', 'Customer', 'Payment', 'Items', 'Subtotal', 'Discount', 'Total', 'Gross Profit', 'Paid', 'Cash Received', 'Change', 'Due', 'Status'],
      ...visibleSales.map((sale) => [sale.receiptNo, sale.date, sale.customer, sale.paymentMethod, sale.items.length, sale.subtotal, sale.discount, sale.total, sale.profit, sale.paidAmount ?? (sale.paymentMethod === 'Cash' || sale.paymentMethod === 'KPay' ? sale.total : 0), sale.cashReceivedAmount ?? (sale.paymentMethod === 'Cash' ? sale.total : 0), sale.changeAmount ?? 0, sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), sale.status]),
    ]);
  const exportExpensesCsv = () => downloadCsv(`minimart-expenses-${today()}.csv`, [
    ['Date', 'Branch', 'Cashier', 'Title', 'Category', 'Amount', 'Funding Source', 'Payment Method', 'Report Status', 'Note'],
    ...visibleExpenses.map((expense) => [expense.date, activeBranch?.name || activeBranchId, expense.createdByName || 'Legacy / Owner', expense.title, expense.category, expense.amount, expense.fundedBy || '', expense.paymentMethod || '', expense.reviewStatus || (expense.cloudSyncStatus === 'pending' ? 'cloud-pending' : expense.createdByRole === 'owner' ? 'owner-recorded' : 'submitted'), expense.note]),
  ]);

  const handleExpenseSubmit = async (draft: Omit<Expense, 'id' | 'branchId'>) => {
    const uid = access.uid || firebaseAuth?.currentUser?.uid || '';
    if (cashierMode && !uid) { notify('Cashier Firebase UID မရသေးပါ။ Account ကို ပြန်ဝင်ပြီး စမ်းပါ။'); return; }
    const actorName = access.displayName || firebaseAuth?.currentUser?.displayName || access.email || 'Owner';
    const now = new Date().toISOString();
    const saved = addExpense({
      ...draft,
      id: crypto.randomUUID(),
      createdByUid: uid || undefined,
      createdByEmail: access.email || firebaseAuth?.currentUser?.email || '',
      createdByName: actorName,
      createdByRole: cashierMode ? 'cashier' : 'owner',
      // New expenses are submitted reports, never approval-gated spending.
      approvalStatus: 'not-required',
      ...(cashierMode ? { reviewStatus: 'submitted' as const, submittedAt: now } : {}),
      updatedAt: now,
      updatedByUid: uid || undefined,
      ...(cashierMode ? { cloudSyncStatus: 'pending' as const } : {}),
    });
    if (cashierMode) {
      try {
        const syncResult = await submitCashierExpenseToCloud(saved, uid, activeBranchId);
        updateExpense(saved.id, {
          approvalStatus: 'not-required',
          reviewStatus: syncResult.reviewStatus,
          ...(syncResult.reviewedAt ? { reviewedAt: syncResult.reviewedAt } : {}),
          ...(syncResult.reviewedByUid ? { reviewedByUid: syncResult.reviewedByUid } : {}),
          ...(syncResult.reviewedByName ? { reviewedByName: syncResult.reviewedByName } : {}),
          cloudSyncStatus: 'synced', cloudSyncError: undefined,
        });
        notify('အသုံးစရိတ်ကို Owner ထံ တင်ပြပြီးပါပြီ။ Owner ကြည့်ရှုရန်သာဖြစ်ပြီး Approval စောင့်ရန် မလိုပါ။');
      } catch (error) {
        updateExpense(saved.id, { cloudSyncStatus: 'pending', cloudSyncError: error instanceof Error ? error.message : 'Cloud Sync မအောင်မြင်ပါ။' });
        notify('အသုံးစရိတ်ကို ဒီ Device မှာ သိမ်းထားပါတယ်။ Cloud ပြန်ချိတ်သည့်အခါ Owner ထံ အလိုအလျောက် တင်ပြပါမယ်။');
      }
      return;
    }
    notify('အသုံးစရိတ် မှတ်တမ်းသိမ်းပြီးပါပြီ။');
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
    notify(input.paymentMethod === 'kpay' ? 'KPay ငွေလွှဲမှတ်တမ်း သိမ်းပြီးပါပြီ။ Cloud Sync ပြီးလျှင် Cashier မြင်နိုင်ပါမယ်။' : 'Cash ငွေရှင်းမှတ်တမ်း သိမ်းပြီးပါပြီ။ Cloud Sync ပြီးလျှင် Cashier မြင်နိုင်ပါမယ်။');
  };

  const exportBackup = async () => {
    try {
      const state = usePosStore.getState();
      const localImages = await exportLocalImages([
        ...state.branches.flatMap((branch) => [branch.logoUrl, branch.bannerUrl]),
        state.ownerProfile?.photoUrl,
      ]);
      const data = { app: 'minimart-pos', schemaVersion: 18, exportedAt: new Date().toISOString(), branches: state.branches, activeBranchId: state.activeBranchId, categories: state.categories, products: state.products, sales: state.sales, expenses: state.expenses, cashierSettlements: state.cashierSettlements, branchFinanceLedgerEntries: state.branchFinanceLedgerEntries, cashierAdvanceReconciliations: state.cashierAdvanceReconciliations, branchFinanceReconciliations: state.branchFinanceReconciliations, heldItems: state.heldItems, customers: state.customers, suppliers: state.suppliers, customerPayments: state.customerPayments, purchases: state.purchases, supplierPayments: state.supplierPayments, purchaseReturns: state.purchaseReturns, stockBatches: state.stockBatches, stockReceipts: state.stockReceipts, stockTransfers: state.stockTransfers, stockShipments: state.stockShipments, stockUnitRegistries: state.stockUnitRegistries, cashShifts: state.cashShifts, cashMovements: state.cashMovements, activityLogs: state.activityLogs, ownerProfile: state.ownerProfile, settings: state.settings, localImages };
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
      if (!window.confirm('လက်ရှိ Data ကို Backup ထဲက Data နဲ့ အစားထိုး/ပြန်တင်ပါမည်။ ပုံဖိုင်များပါ Restore လုပ်ပါမည်။ ဆက်လုပ်မလား။')) return;
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
      importData({ branches: importedBranches as never[] | undefined, activeBranchId: typeof data.activeBranchId === 'string' ? data.activeBranchId : undefined, categories: Array.isArray(data.categories) ? data.categories as never[] : undefined, products: data.products as Product[], sales: importedSales, expenses: data.expenses as Expense[], cashierSettlements: Array.isArray(data.cashierSettlements) ? data.cashierSettlements as CashierSettlementRecord[] : [], branchFinanceLedgerEntries: Array.isArray(data.branchFinanceLedgerEntries) ? data.branchFinanceLedgerEntries as never[] : [], cashierAdvanceReconciliations: Array.isArray(data.cashierAdvanceReconciliations) ? data.cashierAdvanceReconciliations as never[] : [], branchFinanceReconciliations: Array.isArray(data.branchFinanceReconciliations) ? data.branchFinanceReconciliations as never[] : undefined, heldItems: Array.isArray(data.heldItems) ? data.heldItems as never[] : [], customers: importedCustomers, suppliers: Array.isArray(data.suppliers) ? data.suppliers as never[] : [], customerPayments: Array.isArray(data.customerPayments) ? data.customerPayments as never[] : [], purchases: Array.isArray(data.purchases) ? data.purchases as never[] : [], supplierPayments: Array.isArray(data.supplierPayments) ? data.supplierPayments as never[] : [], purchaseReturns: Array.isArray(data.purchaseReturns) ? data.purchaseReturns as never[] : [], stockBatches: Array.isArray(data.stockBatches) ? data.stockBatches as never[] : [], stockReceipts: Array.isArray(data.stockReceipts) ? data.stockReceipts as never[] : [], stockTransfers: Array.isArray(data.stockTransfers) ? data.stockTransfers as never[] : [], stockShipments: Array.isArray(data.stockShipments) ? data.stockShipments as never[] : [], stockUnitRegistries: Array.isArray(data.stockUnitRegistries) ? data.stockUnitRegistries as never[] : [], cashShifts: Array.isArray(data.cashShifts) ? data.cashShifts as never[] : [], cashMovements: Array.isArray(data.cashMovements) ? data.cashMovements as never[] : [], activityLogs: Array.isArray(data.activityLogs) ? data.activityLogs as never[] : [], ownerProfile: importedOwnerProfile as never, settings: data.settings as never });
      notify('Backup Restore အောင်မြင်ပါပြီ။');
    } catch { notify('Backup ဖိုင် မမှန်ကန်ပါ။ JSON Backup ကို ရွေးပါ။'); }
    finally { if (importRef.current) importRef.current.value = ''; }
  };

  const navItemsAll: { id: Page; label: string; icon: ReactNode }[] = [
    { id: 'branches', label: 'ဆိုင်ခွဲ / Category', icon: <Store size={18} /> },
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'pos', label: 'အရောင်း POS', icon: <ShoppingCart size={18} /> },
    { id: 'inventory', label: 'ပစ္စည်းစာရင်း', icon: <Boxes size={18} /> },
    { id: 'receiving', label: 'ကုန်ဝင်စာရင်း', icon: <PackagePlus size={18} /> },
    ...(activeBranches.length > 1 ? [{ id: 'shipments' as Page, label: 'ကုန်ပို့ / လက်ခံစီမံ', icon: <Send size={18} /> }] : []),
    ...(cashierMode && access.canReceiveStock ? [{ id: 'branchReceiving' as Page, label: 'ရောက်လာသောကုန် စစ်ဆေးရန်', icon: <PackageCheck size={18} /> }] : []),
    { id: 'sales', label: 'အရောင်းမှတ်တမ်း', icon: <Receipt size={18} /> },
    { id: 'customers', label: 'Customer / အကြွေး', icon: <Users size={18} /> },
    { id: 'purchasing', label: 'Supplier / ပေးချေမှု', icon: <Truck size={18} /> },
    { id: 'expiry', label: 'Expiry Tracking', icon: <CalendarClock size={18} /> },
    { id: 'cash', label: 'Cash Register / Shift', icon: <Wallet size={18} /> },
    { id: 'activity', label: 'Activity Log', icon: <ClipboardList size={18} /> },
    { id: 'expenses', label: cashierMode ? 'မိမိအသုံးစရိတ်' : 'အသုံးစရိတ်', icon: <Wallet size={18} /> },
    { id: 'settlements', label: cashierMode ? 'မိမိငွေလက်ခံမှတ်တမ်း' : 'Cashier ငွေရှင်း', icon: <CreditCard size={18} /> },
    ...(!cashierMode ? [{ id: 'finance' as Page, label: 'Cash & KPay စာရင်း', icon: <Wallet size={18} /> }] : []),
    { id: 'analytics', label: 'စာရင်းခွဲခြမ်းစိတ်ဖြာ', icon: <BarChart3 size={18} /> },
    { id: 'profile', label: 'ဆိုင် / Owner Profile', icon: <UserRound size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ];
  const navItems = navItemsAll.filter((item) => canUsePage(access.role, item.id, access.canReceiveStock));
  const pageTitle = navItems.find((item) => item.id === page)?.label || 'Dashboard';
  const navTo = (next: Page) => {
    if (!canUsePage(access.role, next, access.canReceiveStock)) { notify('ဒီစာမျက်နှာကို Owner သာ ဝင်ရောက်နိုင်ပါတယ်။'); return; }
    setPage(next); setMobileMenu(false);
  };

  // When Firebase is configured, unauthenticated visitors must land on the
  // standalone Login screen. Local-only mode remains available only when Auth
  // is not configured at all.
  if (firebaseAuth && access.status === 'local') {
    return <LoginPage />;
  }

  if (access.status === 'loading') {
    return <main className="access-gate"><section className="panel access-gate-card"><div className="panel-icon"><LockKeyhole size={22} /></div><h1>Access စစ်ဆေးနေပါတယ်</h1><p>Firebase Server သို့မဟုတ် ယခင်သိမ်းထားသော Offline Cache မှ Owner / Cashier Access ကို စစ်ဆေးနေပါတယ်။</p></section></main>;
  }

  if (access.status === 'unassigned' || access.status === 'disabled' || access.status === 'error') {
    const cashierMemberPath = `businesses/${FIREBASE_BUSINESS_ID}/members/${access.uid}`;
    return <main className="access-gate"><section className="panel access-gate-card"><div className="panel-icon"><LockKeyhole size={22} /></div><h1>{access.status === 'unassigned' ? 'Business Access မသတ်မှတ်ရသေးပါ' : 'Account Access မရနိုင်ပါ'}</h1><p>{access.message}</p><div className="access-uid"><small>Firebase UID</small><code>{access.uid}</code><small>Firebase Project</small><code>{firebaseApp?.options.projectId || "မချိတ်ဆက်ရသေးပါ"}</code><small>Business ID</small><code>{FIREBASE_BUSINESS_ID}</code></div>{access.status === 'unassigned' && <div className="cloud-help access-membership-help"><strong>Cashier Account ချိတ်ဆက်ရန်</strong><p>ဒီ Firebase Account ကို Cashier အဖြစ် အသုံးပြုမယ်ဆိုရင် Owner က Profile → ဝန်ထမ်းအကောင့် / Branch Permission ထဲမှာ Firebase Authentication UID အတိအကျကို ချိတ်ပေးရပါမယ်။ Member စာရင်းမှာ ပြထားတဲ့ Document UID နဲ့ အောက်က UID တူညီရပါမယ်။</p><strong>Cashier Member Path</strong><code>{cashierMemberPath}</code><div className="access-copy-actions"><button className="button button-outline" type="button" onClick={() => void copyAccessValue(access.uid, 'Firebase UID')}><Copy size={14}/> UID ကူးရန်</button><button className="button button-outline" type="button" onClick={() => void copyAccessValue(cashierMemberPath, 'Member Path')}><Copy size={14}/> Path ကူးရန်</button></div><small>Owner Account ဖြစ်ပါကလည်း ownerUid ကိုသာ အမှန်တကယ် Owner Firebase UID နဲ့ စစ်ဆေးပါ။ Cashier UID ကို ownerUid ထဲ မထည့်ပါနဲ့။</small></div>}{access.status === 'error' && <button className="button button-primary" type="button" onClick={() => window.location.reload()}>ပြန်စမ်းရန်</button>}{firebaseAuth && <button className="button button-outline" onClick={() => void signOut(firebaseAuth)}> <LogOut size={15}/> Sign Out</button>}</section></main>;
  }

  if (cashierMode && !canUsePage(access.role, page, access.canReceiveStock)) {
    return <main className="access-gate"><section className="panel access-gate-card"><h1>ဝင်ခွင့်စစ်ဆေးနေပါတယ်</h1><p>Cashier အတွက် ခွင့်ပြုထားတဲ့ စာမျက်နှာကို ဖွင့်နေပါတယ်။</p></section></main>;
  }

  if (cashierMode && !access.branchIds.includes(activeBranchId)) {
    return <main className="access-gate"><section className="panel access-gate-card"><h1>Branch Access စစ်ဆေးနေပါတယ်</h1><p>Owner က သတ်မှတ်ထားတဲ့ ဆိုင်ကို ရွေးချယ်နေပါတယ်။</p></section></main>;
  }

  return (
    <div className="app-shell" data-theme={themeMode}>
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="brand"><div className="brand-mark">{activeBranchLogoSource ? <img src={activeBranchLogoSource} alt="Shop logo" /> : <Store size={22} />}</div><div><strong>Mini<span>mart</span></strong><small>POS MANAGEMENT</small></div><button className="icon-btn mobile-close" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X size={19} /></button></div>
        <div className="store-chip"><span className="live-dot" /> <span>{activeBranch?.name || settings.storeName}</span></div>
        <nav className="nav-list" aria-label="Main navigation">
          <p className="nav-caption">WORKSPACE</p>
          {navItems.map((item) => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navTo(item.id)}>{item.icon}<span>{item.label}</span>{item.id === 'pos' && cart.length > 0 && <b className="nav-count">{cart.length}</b>}</button>)}
        </nav>
        <div className="sidebar-bottom"><div className="offline-card"><div className="offline-icon"><Activity size={17} /></div><div><strong>Local Cache</strong><small>Cloud Sync အခြေအနေကို သီးခြားစစ်ဆေးပါ</small></div><span className="live-dot" /></div><small className="version">MINIMART POS · v3.2.0 MULTI-BRANCH PREVIEW 6</small></div>
      </aside>
      {mobileMenu && <button className="sidebar-backdrop" onClick={() => setMobileMenu(false)} aria-label="Close navigation" />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-btn menu-toggle" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu size={21} /></button><div><div className="eyebrow">STORE MANAGEMENT / {page.toUpperCase()}</div><h1>{pageTitle}</h1></div></div>
          <div className="topbar-actions"><button className="theme-toggle" type="button" onClick={() => setThemeMode((current) => current === 'light' ? 'dark' : 'light')} aria-label={themeMode === 'light' ? 'Dark Mode ပြောင်းရန်' : 'Light Mode ပြောင်းရန်'} aria-pressed={themeMode === 'dark'} title={themeMode === 'light' ? 'Dark Mode' : 'Light Mode'}>{themeMode === 'light' ? <Moon size={17} /> : <Sun size={17} />}<span>{themeMode === 'light' ? 'Dark' : 'Light'}</span></button>{!cashierMode && activeBranches.length > 1 ? <label className="branch-switcher"><Store size={15} /><select aria-label="Active branch" value={activeBranchId} onChange={(event) => switchBranch(event.target.value)}>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : <div className="branch-single-pill"><Store size={14} /><span>{activeBranch?.name || 'Single Store'}</span><small>{cashierMode ? 'Assigned Branch' : 'Single Store'}</small></div>}<div className="connection-pill" title={access.status === 'active' ? 'Firebase Business Access အတည်ပြုပြီးပါပြီ။' : 'Firebase Business Account Login မဝင်ထားပါ။ ဆက်လက်အသုံးပြုရန် Login ဝင်ပါ။'}><span className="live-dot" /> {cashierMode ? 'Cashier · Branch Access' : access.status === 'active' ? 'Owner · Business Access' : 'Local mode'}</div>{firebaseAuth && access.status === 'active' && <button className="button button-outline" type="button" onClick={() => void signOut(firebaseAuth)}><LogOut size={14}/> Sign Out</button>}{installPrompt && <button className="button button-outline install-btn" onClick={() => void installPrompt()}><Smartphone size={16} /> Install App</button>}{!cashierMode && <button className="avatar avatar-button" type="button" onClick={() => navTo('profile')} title="Profile ဖွင့်ရန်" aria-label="Profile ဖွင့်ရန်">{ownerPhotoSource ? <img src={ownerPhotoSource} alt="Owner profile" /> : (typeof ownerProfile?.displayName === 'string' ? ownerProfile.displayName.trim().charAt(0) || 'M' : 'M')}</button>}</div>
        </header>

        <div className="content-area">
          {page === 'profile' && <ProfileManagementPage authorize={authorize} notify={notify} />}
          {page === 'branches' && <BranchManagementPage authorize={authorize} notify={notify} />}
          {page === 'dashboard' && <DashboardPage
            sales={cashierMode ? visibleSales : allSales}
            products={cashierMode ? products : allProducts}
            stockBatches={cashierMode ? stockBatches : allStockBatches}
            branches={activeBranches}
            activeBranchId={activeBranchId}
            isOwner={!cashierMode}
            bannerSource={activeBranchBannerSource}
            settings={settings}
            chartPeriod={chartPeriod} setChartPeriod={setChartPeriod} navTo={navTo}
          />}

          {page === 'pos' && <section className="pos-layout pos-layout-mobile-split">
            <div className="pos-products-panel">
              <div className="section-heading"><div><h2>ပစ္စည်းရွေးချယ်ရန်</h2><p>ရောင်းချမည့်ပစ္စည်းကို ရွေးပြီး Cart ထဲထည့်ပါ။</p></div><span className="subtle-count">ပစ္စည်း {filteredProducts.length} မျိုး</span></div>
              <div className="toolbar barcode-pos-toolbar"><div className="search-box"><Search size={17} /><input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addScannedProductToCart(productSearch); } }} placeholder="ပစ္စည်းအမည် / SKU / Barcode scan..." /><button className="barcode-inline-camera" type="button" title="Phone Camera ဖြင့် Barcode ဖတ်ရန်" onClick={() => setCameraScannerTarget('pos')}><Camera size={17} /></button></div><select className="select-control category-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option>အားလုံး</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></div>{cashierMode && access.uid && <CashierSalesQueueStatus uid={access.uid} branchId={activeBranchId} />}<small className="barcode-scan-hint">Barcode Sticker သုံးထားသော ပစ္စည်းဆို Sticker တစ်ခုချင်း Scan ဖတ်ပါ။ ပုံမှန် Product Barcode / SKU သုံးထားသော ပစ္စည်းဆို Scan တစ်ကြိမ်ဖြင့် Product ကို Cart ထဲထည့်ပါမယ်။</small>
              {products.length === 0 ? <EmptyState icon={<ShoppingBag size={25} />} title="ပစ္စည်း မရှိသေးပါ" text="အရင်ဆုံး Inventory ထဲမှာ ပစ္စည်းထည့်ပြီးမှ POS မှာ ရောင်းချနိုင်ပါမယ်။" action="ပစ္စည်းထည့်ရန်" onAction={() => navTo('inventory')} /> :
                filteredProducts.length === 0 ? <EmptyState icon={<Search size={25} />} title="မတွေ့ပါ" text="ရှာဖွေမှု စကားလုံး သို့မဟုတ် Category ကို ပြောင်းကြည့်ပါ။" /> :
                <div className="product-grid">{filteredProducts.map((product) => <button key={product.id} className={`product-tile ${sellableStock(product) <= 0 ? 'out-of-stock' : ''}`} onClick={() => addToCart(product)} disabled={sellableStock(product) <= 0}><div className="product-tile-icon"><ShoppingBag size={22} /></div><strong>{product.name}</strong><span className="product-sku">{product.sku}</span><div className="product-tile-bottom"><b>{product.retailPrice > 0 ? money(product.retailPrice, settings.currency) : 'ဈေးမသတ်မှတ်ရသေး'}</b><span className={sellableStock(product) <= product.lowStockAt ? 'stock-warning' : 'stock-ok'}>{formatQuantity(sellableStock(product), quantityModeForProduct(product))} {product.unit} ရောင်းနိုင်</span></div></button>)}</div>}
            </div>
            <aside className="cart-panel">
              <div className="cart-title"><div><h2><ShoppingCart size={19} /> Current Cart</h2><p>{cart.length} မျိုး</p></div><button className="text-button" onClick={() => { setCart([]); setDiscount('0'); setCashReceived(''); setShowPaymentModal(false); }}>Clear</button></div>
              <div className="cart-customer"><label>Customer</label><input list="pos-customer-options" value={customer} onChange={(e) => { setCustomer(e.target.value); setCashReceived(''); }} placeholder="ဝယ်သူအမည်" /><datalist id="pos-customer-options">{customers.map((entry) => <option key={entry.id} value={entry.name} />)}</datalist><div className="payment-switch"><button type="button" className={paymentMethod === 'Cash' ? 'selected' : ''} onClick={() => { setPaymentMethod('Cash'); setCashReceived(''); setKpayTransactionReference(''); }}><Wallet size={15} /> Cash</button><button type="button" className={paymentMethod === 'KPay' ? 'selected' : ''} disabled={!activeBranch?.settings.kpayAccountNumber || !activeBranch?.settings.kpayAccountName} title={!activeBranch?.settings.kpayAccountNumber ? 'Owner က Branch KPay Account သတ်မှတ်ရန်လိုသည်' : ''} onClick={() => { setPaymentMethod('KPay'); setCashReceived(''); }}><CreditCard size={15} /> KPay</button><button type="button" className={paymentMethod === 'Credit' ? 'selected' : ''} onClick={() => { setPaymentMethod('Credit'); setCashReceived(''); setKpayTransactionReference(''); }}><CreditCard size={15} /> Credit</button></div></div>
              <div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><ShoppingCart size={27} /><strong>Cart ထဲမှာ ဘာမှမရှိသေးပါ</strong><span>ဘယ်ဘက်က ပစ္စည်းတစ်ခုကို ရွေးပါ။</span></div> : cart.map((item) => <div className="cart-line" key={item.productId}><div className="cart-line-top"><div><strong>{item.name}</strong><small>{item.sku}{item.stockUnitSelections?.length ? ` · Sticker ${item.stockUnitSelections.length} ခု Scan ထား` : ''}</small></div><button className="icon-btn danger-icon" onClick={() => setAside(item)} title="Not buying list ထဲသိမ်း"><ArchiveRestore size={16} /></button></div><div className="price-mode"><button className={item.mode === 'retail' ? 'active' : ''} onClick={() => changePriceMode(item, 'retail')}>လက်လီ</button><button className={item.mode === 'wholesale' ? 'active' : ''} onClick={() => changePriceMode(item, 'wholesale')}>လက်ကား</button><span>{money(item.unitPrice, settings.currency)}</span></div><div className="cart-line-bottom"><div className="qty-control"><button onClick={() => { const product = productMap.get(item.productId); const step = product && quantityModeForProduct(product) === 'decimal' ? 0.1 : 1; changeCartQty(item.productId, Math.round((item.quantity - step) * 1000) / 1000); }}><Minus size={13} /></button><b>{formatQuantity(item.quantity, productMap.get(item.productId) ? quantityModeForProduct(productMap.get(item.productId)!) : 'whole')}</b><button onClick={() => { const product = productMap.get(item.productId); const step = product && quantityModeForProduct(product) === 'decimal' ? 0.1 : 1; changeCartQty(item.productId, Math.round((item.quantity + step) * 1000) / 1000); }}><Plus size={13} /></button></div><strong>{money(item.unitPrice * item.quantity, settings.currency)}</strong></div></div>)}</div>
              {heldItems.length > 0 && <div className={`held-section ${showHeldItems ? 'held-section-open' : ''}`}><button className="held-heading held-toggle" type="button" onClick={() => setShowHeldItems((current) => !current)} aria-expanded={showHeldItems}><span>မယူတော့သောပစ္စည်းစာရင်း</span><b>{heldItems.length} မျိုး</b><ChevronDown size={15} className={showHeldItems ? 'held-chevron-open' : ''} /></button>{showHeldItems && <div className="held-list">{heldItems.map((item) => <div className="held-row" key={item.productId}><span>{item.name} × {formatQuantity(item.quantity, productMap.get(item.productId) ? quantityModeForProduct(productMap.get(item.productId)!) : 'whole')}</span><button type="button" onClick={() => restoreHeld(item.productId)}>Cart ထဲပြန်ထည့်</button></div>)}</div>}</div>}
              <div className="cart-summary"><div><span>Subtotal</span><b>{money(subtotal, settings.currency)}</b></div><div className="discount-row"><label htmlFor="discount-input">Discount (MMK)</label><input id="discount-input" type="number" min="0" max={subtotal} value={discount} onChange={(e) => setDiscount(e.target.value)} /></div><div className="total-row"><span>Total</span><strong>{money(checkoutTotal, settings.currency)}</strong></div><div className="printer-tools"><label>Receipt စက္ကူ<select aria-label="Receipt paper width" value={paperWidth} onChange={(event) => setPaperWidth(event.target.value === '58' ? '58' : '80')}><option value="58">58 mm</option><option value="80">80 mm</option></select></label><button className="button button-outline printer-test-button" type="button" onClick={printTestReceipt}><Printer size={15} /> Test Print</button></div><button className="button button-primary checkout-button" type="button" onClick={startCheckout} disabled={!cart.length}><Check size={17} /> ငွေရှင်းမယ်</button><small className="cart-note">ငွေလက်ခံပမာဏကို အတည်ပြုပြီးမှ Sale သိမ်းပါမယ်။</small></div>
            </aside>
          </section>}

          {page === 'receiving' && <StockReceivingPage notify={notify} />}
          {page === 'unitBarcodes' && <StockUnitRegistrationPage notify={notify} />}
          {page === 'transfers' && <StockTransferPage authorize={authorize} notify={notify} onViewDestination={viewBranchInventory} />}
          {page === 'shipments' && <BranchShipmentManagementPage authorize={authorize} notify={notify} />}
          {page === 'branchReceiving' && <BranchStockReceivingPage notify={notify} />}
          {page === 'inventory' && <section className="page-stack"><div className="section-heading"><div><h2>Inventory Management</h2><p>ပစ္စည်း၊ ဈေးနှုန်းနှင့် လက်ကျန် Stock ကို စီမံပါ။</p></div><div className="heading-actions"><button className="button button-outline" onClick={exportProductsCsv}><Download size={15} /> CSV</button><button className="button button-outline" onClick={() => navTo('unitBarcodes')}><Barcode size={15} /> Sticker Scan ဖြင့် Stock ထည့်ရန်</button><button className="button button-primary" onClick={openNewProduct}><Plus size={17} /> ပစ္စည်းအသစ်</button></div></div><div className="mini-stats"><MiniStat icon={<Boxes size={17} />} label="ပစ္စည်းအမျိုးအစား" value={String(products.length)} /><MiniStat icon={<PackagePlus size={17} />} label="လက်ကျန်ရှိသော ပစ္စည်း" value={String(stockedProductCount)} /><MiniStat icon={<AlertTriangle size={17} />} label="Stock နည်းနေသောပစ္စည်း" value={String(lowStockProducts.length)} tone="warning" /></div><div className="panel">{legacyFractionalStockCount > 0 && <div className="backup-warning"><AlertTriangle size={16} /><span>အရေအတွက်ယူနစ်ဖြစ်သော်လည်း ဒသမလက်ကျန်ရှိသော Product {legacyFractionalStockCount} မျိုးရှိပါတယ်။ လက်တွေ့ရေတွက်ပြီး Stock ± ဖြင့် အမှန်တကယ်လက်ကျန်ကို ပြင်ပါ။ App က ဒသမကို အလိုအလျောက် Round မလုပ်ပါ။</span></div>}<div className="table-toolbar"><div className="search-box"><Search size={16} /><input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="ပစ္စည်း / SKU ရှာရန်..." /></div><span className="subtle-count">{filteredProducts.length} records</span></div><div className="table-wrap"><table><thead><tr><th>ပစ္စည်း</th><th>Category</th><th>Cost</th><th>လက်လီ</th><th>လက်ကား</th><th>ရောင်းနိုင် / စုစုပေါင်း</th><th>လုပ်ဆောင်ချက်</th></tr></thead><tbody>{filteredProducts.map((product) => <tr key={product.id}><td><div className="table-product"><span className="table-product-icon"><ShoppingBag size={17} /></span><span><strong>{product.name}</strong><small>SKU: {product.sku || '—'}{product.barcode ? ` · Barcode: ${product.barcode}` : ' · Barcode မထည့်ရသေး'}</small></span></div></td><td><span className="tag">{product.category}</span></td><td>{money(product.costPrice, settings.currency)}</td><td><b>{money(product.retailPrice, settings.currency)}</b></td><td>{money(product.wholesalePrice, settings.currency)}</td><td><span className={sellableStock(product) <= product.lowStockAt ? 'stock-warning' : 'stock-ok'}>{formatQuantity(sellableStock(product), quantityModeForProduct(product))} / {formatQuantity(product.stock, quantityModeForProduct(product))} {product.unit}{hasLegacyFractionalQuantity(product.stock, quantityModeForProduct(product)) ? <small className="stock-warning">ဒသမလက်ကျန် · ပြန်စစ်ရန်</small> : null}</span></td><td><div className="table-actions"><button className="small-action" onClick={() => openEditProduct(product)}>ပြင်ရန်</button><button className="small-action" disabled={stockUnitRegistries.some((registry) => registry.branchId === activeBranchId && registry.productId === product.id && registry.units.length > 0)} title={stockUnitRegistries.some((registry) => registry.branchId === activeBranchId && registry.productId === product.id && registry.units.length > 0) ? "Barcode Unit Tracking ပစ္စည်းကို Sticker Registration မှသာ Stock ပြင်ပါ" : "Stock ပြင်ရန်"} onClick={() => { const amountText = window.prompt(`Stock ဘယ်လောက် တိုး/လျှော့မလဲ။ ${quantityModeForProduct(product) === 'whole' ? 'နောက်ဆုံးလက်ကျန်က အရေအတွက်ပြည့်ကိန်း ဖြစ်ရပါမယ်။ ဒသမလက်ကျန်ကို မှန်ကန်အောင် ပြင်ရန် 0.012 လို correction amount ထည့်နိုင်ပါတယ်။' : 'ဒသမ ၃ နေရာအထိ ထည့်နိုင်ပါတယ်။'}`); if (amountText !== null) { const amount = Number(amountText); if (Number.isFinite(amount) && amount !== 0) { if (adjustStock(product.id, amount)) notify('Stock ပြင်ဆင်ပြီးပါပြီ။'); else notify('Stock ပြင်မရပါ။ ယူနစ်၊ လက်ကျန်နဲ့ အရေအတွက်ကို ပြန်စစ်ပါ။'); } } }}>Stock ±</button><button className="icon-btn danger-icon" title="Delete" disabled={stockUnitRegistries.some((registry) => registry.branchId === activeBranchId && registry.productId === product.id && registry.units.length > 0)} onClick={() => { if (authorize('ပစ္စည်းဖျက်ရန်') && window.confirm(`${product.name} ကို ဖျက်မလား။`)) { deleteProduct(product.id); setCart((items) => items.filter((item) => item.productId !== product.id)); notify('ပစ္စည်းဖျက်ပြီးပါပြီ။'); } }}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table>{filteredProducts.length === 0 && <EmptyState icon={<Boxes size={24} />} title="စာရင်းမရှိသေးပါ" text="ပစ္စည်းအသစ်ထည့်ပြီး စတင်အသုံးပြုပါ။" action="ပစ္စည်းထည့်ရန်" onAction={openNewProduct} />}</div></div></section>}

          {page === 'sales' && <section className="page-stack"><div className="section-heading"><div><h2>Sales History</h2><p>{cashierMode ? 'မိမိ UID ဖြင့် မှတ်တမ်းတင်ထားသော အရောင်းများကိုသာ ကြည့်ရှုနိုင်ပါတယ်။' : 'ပြီးခဲ့သော ရောင်းချမှုများကို ကြည့်ရှု၊ Voucher ပြန်ထုတ်နိုင်ပါတယ်။'}</p></div><div className="heading-actions"><button className="button button-outline" onClick={exportSalesCsv}><Download size={15} /> CSV</button><div className="sales-summary-chip"><TrendingUp size={17} /> {visibleSales.filter((sale) => sale.status === 'completed').length} completed sales</div></div></div><div className="panel"><div className="table-toolbar"><div className="search-box"><Search size={16} /><input value={saleSearch} onChange={(e) => setSaleSearch(e.target.value)} placeholder="Voucher No / Customer ရှာရန်..." /></div><span className="subtle-count">{filteredSales.length} records</span></div><div className="table-wrap"><table><thead><tr><th>Voucher</th><th>နေ့စွဲ</th><th>Customer</th><th>Items</th><th>Payment</th><th>Total</th><th>Due</th><th>Status / Action</th></tr></thead><tbody>{filteredSales.map((sale) => <tr key={sale.id}><td><strong className="mono">{sale.receiptNo}</strong></td><td>{dateLabel(sale.date)}</td><td>{sale.customer}</td><td>{sale.items.length} မျိုး</td><td><span className={`tag ${sale.paymentMethod === 'Credit' ? 'tag-warn' : ''}`}>{sale.paymentMethod}</span>{sale.paymentMethod === 'KPay' && sale.kpayTransactionReference && <small>TX: {sale.kpayTransactionReference}</small>}</td><td><b>{money(sale.total, settings.currency)}</b></td><td>{money(sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), settings.currency)}</td><td><div className="table-actions">{sale.status === 'voided' ? <span className="tag tag-danger">Voided</span> : <span className="tag tag-success">Completed</span>}<button className="icon-btn" title="Print" onClick={() => printReceipt(sale)}><Printer size={15} /></button><button className="icon-btn" title="Copy voucher" onClick={() => void copyReceipt(sale)}><FileJson size={15} /></button>{!cashierMode && sale.status === 'completed' && (sale.paymentMethod === 'Cash' || (sale.paidAmount ?? 0) === 0) && <button className="icon-btn danger-icon" title="Void sale (Owner only)" onClick={() => void handleVoidSale(sale)}><X size={15} /></button>}</div></td></tr>)}</tbody></table>{filteredSales.length === 0 && <EmptyState icon={<Receipt size={24} />} title="အရောင်းမှတ်တမ်း မရှိသေးပါ" text={cashierMode ? 'v2.9.0 မတိုင်မီ မှတ်တမ်းဟောင်းများတွင် Cashier UID မပါသည့်အတွက် မိမိစာရင်းအဖြစ် မပြပါ။ ဒီ Version မှ စတင်သော မိမိ၏ရောင်းချမှုများကို ဒီနေရာမှာ ကြည့်နိုင်ပါမယ်။' : 'POS မှာ Checkout လုပ်ပြီးနောက် မှတ်တမ်းတွေ ဒီနေရာမှာ ပေါ်လာပါမယ်။'} />}</div></div></section>}

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
            onSubmit={handleExpenseSubmit}
            onDelete={(expense) => { if (authorize('အသုံးစရိတ်ဖျက်ရန်') && window.confirm(`"${expense.title}" ကို ဖျက်မလား။`)) { deleteExpense(expense.id); notify('အသုံးစရိတ် ဖျက်ပြီးပါပြီ။'); } }}
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
            branchKpayAccountName={activeBranch?.settings.kpayAccountName || ''}
            branchKpayAccountNumber={activeBranch?.settings.kpayAccountNumber || ''}
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

          {page === 'settings' && <section className="page-stack"><div className="section-heading"><div><h2>Settings & Data</h2><p>ဆိုင်အချက်အလက်၊ Admin PIN နှင့် Backup ကို စီမံပါ။</p></div></div><div className="settings-grid"><div className="panel form-panel"><div className="panel-heading"><div className="panel-icon"><Settings size={18} /></div><div><h3>Store Preferences</h3><p>Receipt နဲ့ POS မှာ အသုံးပြုမည့် အချက်အလက်များ</p></div></div><label>ဆိုင်အမည်<input value={settings.storeName} onChange={(e) => updateSettings({ storeName: e.target.value })} /></label><label>ငွေကြေးအတိုကောက်<input value={settings.currency} onChange={(e) => updateSettings({ currency: e.target.value.toUpperCase() || 'MMK' })} /></label><label>Receipt အောက်ခြေစာသား<input value={settings.receiptFooter} onChange={(e) => updateSettings({ receiptFooter: e.target.value })} /></label><div className="printer-settings-card"><div><strong>Receipt Printer စမ်းသပ်ခြင်း</strong><small>ဒီ Device အတွက် စက္ကူအကျယ်ရွေးပြီး Test Print ထုတ်ကြည့်နိုင်ပါတယ်။</small></div><label>Paper Width<select value={paperWidth} onChange={(event) => setPaperWidth(event.target.value === '58' ? '58' : '80')}><option value="58">58 mm</option><option value="80">80 mm</option></select></label><button className="button button-outline" type="button" onClick={printTestReceipt}><Printer size={15} /> Test Print</button><p>Print ခလုတ်နှိပ်လျှင် Browser/System Print Dialog ပွင့်ပါမယ်။ Bluetooth Printer ကို ဖုန်း/ကွန်ပျူတာရဲ့ Print Service က ပြသမှ ရွေးထုတ်နိုင်ပါတယ်။ App ထဲမှာ Direct Bluetooth Pairing ကို ဒီ Version မှာ မထည့်ရသေးပါ။</p></div><label>Admin PIN အသစ်<input type="password" inputMode="numeric" value={settings.adminPin} onChange={(e) => updateSettings({ adminPin: e.target.value.replace(/\D/g, '').slice(0, 12) })} /><small className="field-hint">Default PIN: 1234။ စတင်အသုံးပြုပြီးသည်နှင့် ပြောင်းလဲပါ။</small></label></div><div className="panel form-panel"><div className="panel-heading"><div className="panel-icon"><FileJson size={18} /></div><div><h3>Backup & Restore</h3><p>Data ကို JSON ဖိုင်အဖြစ် သိမ်းပြီး ပြန်တင်နိုင်ပါတယ်။</p></div></div><div className="backup-card"><div><strong>Export Backup</strong><small>Products, Sales, Customer Credit, Payments, Suppliers, Purchases, Expiry Batches, Expenses, Cash Shifts နှင့် Activity Logs ပါဝင်မည်။</small></div><button className="button button-primary" onClick={exportBackup}><Download size={16} /> Export JSON</button></div><div className="backup-card"><div><strong>Import / Restore</strong><small>အရင် Export လုပ်ထားသော JSON ဖိုင်ကို ပြန်တင်ပါ။ လက်ရှိ Data ကို အစားထိုးပါမယ်။</small></div><button className="button button-outline" onClick={() => importRef.current?.click()}><ArrowDownToLine size={16} /> Choose File</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importBackup(e.target.files?.[0])} /></div><div className="csv-export-row"><strong>CSV Report Export</strong><div><button className="button button-outline" onClick={exportProductsCsv}>Products CSV</button><button className="button button-outline" onClick={exportSalesCsv}>Sales CSV</button><button className="button button-outline" onClick={exportExpensesCsv}>Expenses CSV</button></div></div><div className="backup-warning"><AlertTriangle size={17} /><span>Backup ဖိုင်ကို ဖုန်းထဲတင်မကဘဲ အခြားလုံခြုံသောနေရာတွင်လည်း သိမ်းထားပါ။ Browser Data ရှင်းလိုက်လျှင် Local Data ပျောက်နိုင်ပါတယ်။</span></div><div className="danger-zone"><div><strong>Reset Local Data</strong><small>Products, Sales, Credit Ledger, Supplier, Purchase, Expiry Batch, Expenses, Cash Shifts နှင့် Activity Logs အားလုံးကို ဒီ Device မှ ဖယ်ရှားပါမယ်။</small></div><button className="button button-danger" onClick={() => { if (authorize('Data အားလုံး Reset လုပ်ရန်') && window.confirm('ဒီ Browser ထဲရှိ POS Data အားလုံးကို အပြီးဖျက်မလား။ Backup မရှိလျှင် ပြန်မရနိုင်ပါ။')) { clearAllData(); setCart([]); notify('Local Data အားလုံး Reset လုပ်ပြီးပါပြီ။'); } }}><Trash2 size={16} /> Reset</button></div></div></div><CloudSyncPanel onOpenProfile={() => navTo('profile')} /><div className="panel security-note"><LockKeyhole size={19} /><div><strong>လုံခြုံရေးနှင့် သိမ်းဆည်းမှုအကြောင်း</strong><p>ဒီဗားရှင်းမှာ PIN ကို Browser Local Storage ထဲမှာသာ စစ်ဆေးပါတယ်။ Shared device သို့မဟုတ် အင်တာနက်ကနေ Admin Access ကို လုံခြုံစွာကာကွယ်ပေးနိုင်တဲ့ Server-side Authentication မဟုတ်ပါ။ Firebase Cloud Sync ကို Settings မှာ Firebase Config ထည့်ပြီး Owner Account Login လုပ်မှ အသုံးပြုနိုင်ပါတယ်။ ဒီ PIN သည် UI Guard သာဖြစ်ပြီး Server-side Admin Permission မဟုတ်ပါ။</p></div></div></section>}
        </div>
      </main>

      <nav className="mobile-bottom-nav" aria-label="အဓိက မီနူး">
        {!cashierMode && <button type="button" className={page === 'dashboard' ? 'active' : ''} onClick={() => navTo('dashboard')}><LayoutDashboard size={19} /><span>ပင်မ</span></button>}
        <button type="button" className={page === 'pos' ? 'active' : ''} onClick={() => navTo('pos')}><ShoppingCart size={19} /><span>အရောင်း</span>{cart.length > 0 && <b>{cart.length}</b>}</button>
        {!cashierMode && <button type="button" className={page === 'inventory' ? 'active' : ''} onClick={() => navTo('inventory')}><Boxes size={19} /><span>ပစ္စည်း</span></button>}
        {!cashierMode && <button type="button" className={page === 'profile' ? 'active' : ''} onClick={() => navTo('profile')}><UserRound size={19} /><span>Profile</span></button>}
        {cashierMode && <button type="button" className={page === 'sales' ? 'active' : ''} onClick={() => navTo('sales')}><Receipt size={19} /><span>မိမိအရောင်း</span></button>}
      </nav>

      {showPaymentModal && <div className="modal-backdrop payment-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPaymentModal(false); }}><section className="modal-card payment-confirm-card" role="dialog" aria-modal="true" aria-labelledby="payment-confirm-title"><div className="modal-header"><div><h2 id="payment-confirm-title">ငွေရှင်းအတည်ပြုရန်</h2><p>ပစ္စည်းစာရင်းနဲ့ Customer ပေးငွေကို နောက်ဆုံးစစ်ဆေးပါ။</p></div><button className="icon-btn" type="button" onClick={() => setShowPaymentModal(false)} aria-label="ပိတ်ရန်"><X size={19} /></button></div><div className="payment-confirm-total"><small>ကျသင့်ငွေ စုစုပေါင်း</small><strong>{money(checkoutTotal, settings.currency)}</strong><span>{cart.length} မျိုး ရွေးထားပါတယ်</span></div>{paymentMethod === 'Cash' ? <><label className="payment-cash-field">Customer ပေးငွေ ({settings.currency})<input type="number" min="0" step="1" inputMode="numeric" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder="Customer ပေးလိုက်တဲ့ငွေ ထည့်ပါ" /></label><button className="payment-exact-button" type="button" onClick={() => setCashReceived(String(Math.round(checkoutTotal)))}>ကျသင့်ငွေအတိအကျ ထည့်မယ်</button>{cashShortfall > 0 ? <div className="payment-shortfall"><strong>ငွေမလောက်သေးပါ</strong><span>{money(cashShortfall, settings.currency)} ထပ်လိုနေပါတယ်။ Sale မသိမ်းရသေးပါ၊ Stock လည်း မလျှော့ထားပါ။</span><button className="button button-outline" type="button" onClick={() => setShowPaymentModal(false)}>ပစ္စည်းလျှော့ / Cart ပြန်ပြင်မယ်</button></div> : <div className="payment-change"><span>ပြန်အမ်းရမည့်ငွေ</span><strong>{money(cashChange, settings.currency)}</strong></div>}</> : paymentMethod === 'KPay' ? <div className="payment-kpay-panel"><strong>Branch KPay Account</strong><div className="payment-kpay-account"><span>Account အမည်</span><b>{activeBranch?.settings.kpayAccountName}</b></div><div className="payment-kpay-account"><span>ဖုန်းနံပါတ် / Account</span><b>{activeBranch?.settings.kpayAccountNumber}</b></div>{activeBranch?.settings.kpayAccountLabel && <small>{activeBranch.settings.kpayAccountLabel}</small>}<button className="payment-exact-button" type="button" onClick={() => void copyAccessValue(activeBranch?.settings.kpayAccountNumber || '', 'Branch KPay Account')}>KPay Account နံပါတ် ကူးရန်</button><label className="payment-cash-field">KPay Transaction ID *<input required value={kpayTransactionReference} onChange={(event) => setKpayTransactionReference(event.target.value)} placeholder="KPay ငွေလွှဲပြီးနောက် Transaction ID ထည့်ပါ" maxLength={120}/></label><small className="field-hint">KPay App မှ ငွေလွှဲပြီး Transaction အောင်မြင်ကြောင်း စစ်ဆေးပြီးမှ Sale ကို အတည်ပြုပါ။</small></div> : <div className="payment-credit-note"><strong>Credit Sale</strong><span>{customer.trim()} အမည်ဖြင့် {money(checkoutTotal, settings.currency)} အကြွေးစာရင်းထဲ ထည့်သိမ်းပါမယ်။</span></div>}<div className="payment-confirm-actions"><button className="button button-outline" type="button" onClick={() => setShowPaymentModal(false)}>ပြန်စစ်မယ်</button><button className="button button-primary" type="button" onClick={completeSale} disabled={(paymentMethod === 'Cash' && cashShortfall > 0) || (paymentMethod === 'KPay' && !kpayTransactionReference.trim())}><Check size={16} /> Sale အတည်ပြုပြီး သိမ်းမယ်</button></div><small className="payment-confirm-footnote">အတည်ပြုမှသာ အရောင်းစာရင်းသိမ်းပြီး Stock လျှော့ပါမယ်။ KPay ငွေကို App က အလိုအလျောက် မလွှဲပါ။</small></section></div>}
      {showCheckoutResult && checkoutResultSale && <div className="modal-backdrop checkout-result-backdrop" role="presentation"><section className="modal-card checkout-result-card" role="dialog" aria-modal="true" aria-labelledby="checkout-result-title"><div className="checkout-result-icon"><Check size={24} /></div><div className="checkout-result-heading"><h2 id="checkout-result-title">{amountOnlyMode ? 'ကျသင့်ငွေ' : 'ငွေရှင်းအောင်မြင်ပါပြီ'}</h2><p>{amountOnlyMode ? 'Receipt မထုတ်ဘဲ ယူထားတဲ့ပစ္စည်းစာရင်းနဲ့ စုစုပေါင်းပမာဏကို ပြထားပါတယ်။' : 'အရောင်းစာရင်းကို သိမ်းဆည်းပြီးပါပြီ။ ယူထားတဲ့ပစ္စည်းတွေကို စစ်ပြီး Receipt ထုတ်နိုင်ပါတယ်။'}</p></div><div className="checkout-result-total"><small>စုစုပေါင်းကျသင့်ငွေ</small><strong>{money(checkoutResultSale.total, settings.currency)}</strong><span>Voucher: {checkoutResultSale.receiptNo}</span></div><div className="checkout-result-meta"><span>ပစ္စည်း {checkoutResultSale.items.length} မျိုး</span><span>{checkoutResultSale.paymentMethod === 'Credit' ? 'အကြွေး' : checkoutResultSale.paymentMethod === 'KPay' ? 'KPay' : 'ငွေသား'}</span></div><div className="checkout-result-items"><div className="checkout-result-items-heading"><strong>ယူထားတဲ့ပစ္စည်းများ</strong><small>{checkoutResultSale.items.length} မျိုး</small></div>{checkoutResultSale.items.map((item, index) => { const product = productMap.get(item.productId); const quantityMode = item.quantityMode || (product ? quantityModeForProduct(product) : 'whole'); const quantityText = `${formatQuantity(item.quantity, quantityMode)} ${item.unit || product?.unit || ''}`.trim(); return <div className="checkout-result-item" key={`${item.productId}-${index}`}><div className="checkout-result-item-info"><strong>{item.name}</strong><small>{quantityText} × {money(item.unitPrice, settings.currency)} · {item.mode === 'wholesale' ? 'လက်ကား' : 'လက်လီ'}</small></div><b>{money(item.unitPrice * item.quantity, settings.currency)}</b></div>; })}</div><div className="checkout-result-breakdown"><div><span>ပစ္စည်းဖိုး</span><b>{money(checkoutResultSale.subtotal, settings.currency)}</b></div>{checkoutResultSale.discount > 0 && <div><span>လျှော့ဈေး</span><b>−{money(checkoutResultSale.discount, settings.currency)}</b></div>}<div className="checkout-result-breakdown-total"><span>ကျသင့်ငွေ</span><b>{money(checkoutResultSale.total, settings.currency)}</b></div>{checkoutResultSale.paymentMethod === 'Cash' && <><div><span>လက်ခံရရှိငွေ</span><b>{money(checkoutResultSale.cashReceivedAmount ?? checkoutResultSale.total, settings.currency)}</b></div><div><span>ပြန်အမ်းငွေ</span><b>{money(checkoutResultSale.changeAmount ?? 0, settings.currency)}</b></div></>}</div>{amountOnlyMode ? <div className="checkout-result-actions"><button className="button button-primary" type="button" onClick={closeCheckoutResult}>ပြီးပါပြီ</button></div> : <div className="checkout-result-actions"><button className="button button-primary" type="button" onClick={() => { const sale = checkoutResultSale; setShowCheckoutResult(false); setCheckoutResultSale(null); setAmountOnlyMode(false); printReceipt(sale); }}><Printer size={17} /> Printer နဲ့ Receipt ထုတ်မယ်</button><button className="button button-outline" type="button" onClick={finishWithoutPrinting}>မထုတ်တော့ဘူး · ပစ္စည်းစာရင်းပဲကြည့်မယ်</button></div>}<small className="checkout-result-note">Printer မချိတ်ထားပါက Print Dialog ထဲမှာ Save as PDF သို့မဟုတ် ချိတ်ထားသော Printer ကို ရွေးနိုင်ပါတယ်။</small></section></div>}

      {showProductModal && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowProductModal(false); }}><form className="modal-card" onSubmit={saveProduct}><div className="modal-header"><div><h2>{editingProduct ? 'ပစ္စည်းပြင်ဆင်ရန်' : 'ပစ္စည်းအသစ်ထည့်ရန်'}</h2><p>အရင်းဈေး၊ လက်လီရောင်းဈေးနှင့် လက်ကားရောင်းဈေးကို ကိုယ်တိုင်ထည့်နိုင်ပါတယ်။</p></div><button className="icon-btn" type="button" onClick={() => setShowProductModal(false)}><X size={19} /></button></div><div className="form-grid"><label className="span-2">ပစ္စည်းအမည် *<input required value={productDraft.name} onChange={(e) => setProductDraft({ ...productDraft, name: e.target.value })} placeholder="ဥပမာ - Drinking Water" /></label><label>SKU / Product Code<input value={productDraft.sku} onChange={(e) => setProductDraft({ ...productDraft, sku: e.target.value })} placeholder="SKU အမှတ် (မဖြည့်လည်းရ)" /></label><label>Barcode (EAN / UPC)<div className="barcode-field-control"><input value={productDraft.barcode} onChange={(e) => setProductDraft({ ...productDraft, barcode: e.target.value })} placeholder="Bluetooth Scanner သို့မဟုတ် ကိုယ်တိုင်ထည့်ပါ" inputMode="text" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} /><button className="button button-outline barcode-camera-button" type="button" onClick={() => setCameraScannerTarget('product')} title="Camera ဖြင့် Barcode ဖတ်ရန်"><Camera size={15} /> Scan</button></div></label><label>Category<select value={productDraft.category} onChange={(e) => { if (e.target.value === '__add_category__') { const name = window.prompt('Category အသစ်အမည်'); if (name?.trim()) { if (addCategory(name.trim())) { setProductDraft((current) => ({ ...current, category: name.trim() })); notify('Category အသစ် ထည့်ပြီးပါပြီ။'); } else notify('Category အမည် ရှိပြီးသား သို့မဟုတ် မမှန်ကန်ပါ။'); } } else setProductDraft({ ...productDraft, category: e.target.value }); }}><option value="">Category ရွေးပါ</option>{categories.map((category) => <option key={category}>{category}</option>)}<option value="__add_category__">＋ Category အသစ်ထည့်ရန်</option></select></label><label>အရင်းဈေး (Cost Price)<input type="number" min="0" value={productDraft.costPrice} onChange={(e) => setProductDraft({ ...productDraft, costPrice: e.target.value })} /></label><label>လက်လီရောင်းဈေး (Retail Price)<input type="number" min="0" value={productDraft.retailPrice} onChange={(e) => setProductDraft({ ...productDraft, retailPrice: e.target.value })} /></label><label>လက်ကားရောင်းဈေး (Wholesale Price)<input type="number" min="0" value={productDraft.wholesalePrice} onChange={(e) => setProductDraft({ ...productDraft, wholesalePrice: e.target.value })} /></label><label>လက်ကျန် Stock<input type="number" min="0" step={quantityStep(productDraft.quantityMode)} disabled={!!editingProduct && stockUnitRegistries.some((registry) => registry.branchId === activeBranchId && registry.productId === editingProduct.id && registry.units.length > 0)} value={productDraft.stock} onChange={(e) => setProductDraft({ ...productDraft, stock: e.target.value })} /></label><label>Low Stock Alert<input type="number" min="0" step={quantityStep(productDraft.quantityMode)} value={productDraft.lowStockAt} onChange={(e) => setProductDraft({ ...productDraft, lowStockAt: e.target.value })} /></label><label>Unit<input value={productDraft.unit} onChange={(e) => setProductDraft({ ...productDraft, unit: e.target.value, quantityMode: inferQuantityMode(e.target.value) })} placeholder="ခု / ဘူး / ထုပ် / kg / L" /></label><label>အရေအတွက်တွက်ချက်ပုံ<select disabled={!!editingProduct && stockUnitRegistries.some((registry) => registry.branchId === activeBranchId && registry.productId === editingProduct.id && registry.units.length > 0)} value={productDraft.quantityMode} onChange={(e) => setProductDraft({ ...productDraft, quantityMode: e.target.value as QuantityMode })}><option value="whole">ပြည့်ကိန်းသာ (ခု / ဘူး / ထုပ်)</option><option value="decimal">ဒသမခွင့်ပြု (kg / L / m)</option></select></label></div><div className="modal-actions"><button className="button button-outline" type="button" onClick={() => setShowProductModal(false)}>ပယ်ဖျက်</button><button className="button button-primary" type="submit"><Check size={16} /> သိမ်းဆည်းမည်</button></div></form></div>}

      {(lastSale || printTestMode) && <div className="receipt-print-area"><div className={`receipt-paper receipt-paper-${paperWidth}`}>
        {printTestMode ? <><h2>{activeBranch?.name || settings.storeName}</h2><p className="receipt-test-title">*** PRINTER TEST ***</p><p>{new Date().toLocaleString()}</p><hr /><div className="receipt-item"><span>စမ်းသပ်ပစ္စည်း × 1</span><b>1,000 {settings.currency}</b></div><hr /><div className="receipt-total receipt-grand"><span>TEST TOTAL</span><b>1,000 {settings.currency}</b></div><p className="receipt-footer">မြန်မာစာ စမ်းသပ်ခြင်း · {settings.receiptFooter}</p></> : lastSale && <>{activeBranchLogoSource && <img className="receipt-shop-logo" src={activeBranchLogoSource} alt="Shop logo" />}<h2>{activeBranch?.name || settings.storeName}</h2>{activeBranch?.settings.receiptHeader && <p className="receipt-shop-extra">{activeBranch.settings.receiptHeader}</p>}{activeBranch?.address && <p>{activeBranch.address}</p>}{activeBranch?.phone && <p>ဖုန်း: {activeBranch.phone}</p>}<p>Voucher: {lastSale.receiptNo}</p><p>{dateLabel(lastSale.date)}</p><p>Customer: {lastSale.customer}</p><hr />{lastSale.items.map((item, index) => { const product = productMap.get(item.productId); const quantityMode = item.quantityMode || (product ? quantityModeForProduct(product) : 'whole'); const quantityText = `${formatQuantity(item.quantity, quantityMode)} ${item.unit || product?.unit || ''}`.trim(); return <div className="receipt-item receipt-item-detailed" key={`${item.productId}-${index}`}><div className="receipt-item-info"><strong>{item.name}</strong><small>{quantityText} × {money(item.unitPrice, settings.currency)} · {item.mode === 'wholesale' ? 'လက်ကား' : 'လက်လီ'}</small></div><b>{money(item.unitPrice * item.quantity, settings.currency)}</b></div>; })}<hr /><div className="receipt-total"><span>Subtotal</span><b>{money(lastSale.subtotal, settings.currency)}</b></div><div className="receipt-total"><span>Discount</span><b>{money(lastSale.discount, settings.currency)}</b></div><div className="receipt-total receipt-grand"><span>Total</span><b>{money(lastSale.total, settings.currency)}</b></div><p>Payment: {lastSale.paymentMethod}</p>{lastSale.paymentMethod === 'KPay' && lastSale.kpayTransactionReference && <p>KPay Transaction ID: {lastSale.kpayTransactionReference}</p>}<p>Paid: {money(lastSale.paidAmount ?? (lastSale.paymentMethod === 'Cash' || lastSale.paymentMethod === 'KPay' ? lastSale.total : 0), settings.currency)}</p>{lastSale.paymentMethod === 'Cash' && <><p>Cash Received: {money(lastSale.cashReceivedAmount ?? lastSale.total, settings.currency)}</p><p>Change: {money(lastSale.changeAmount ?? 0, settings.currency)}</p></>}<p>Due: {money(lastSale.dueAmount ?? (lastSale.paymentMethod === 'Credit' ? lastSale.total : 0), settings.currency)}</p><p className="receipt-footer">{settings.receiptFooter}</p></>}</div></div>}
      <BarcodeCameraScanner open={cameraScannerTarget !== null} onClose={() => setCameraScannerTarget(null)} onDetected={handleCameraBarcodeDetected} title={cameraScannerTarget === 'product' ? 'ပစ္စည်း Barcode ထည့်ရန်' : 'POS Barcode ဖတ်ရန်'} />
      {toast && (toastActionPage
        ? <button className="toast toast-action" type="button" onClick={() => { setPage(toastActionPage); setMobileMenu(false); setToast(''); setToastActionPage(null); }}><PackageCheck size={17} /> {toast}</button>
        : <div className="toast"><Check size={17} /> {toast}</div>)}
    </div>
  );
}

function MiniStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: 'warning' }) {
  return <div className="mini-stat"><div className={`mini-stat-icon ${tone === 'warning' ? 'warning' : ''}`}>{icon}</div><div><small>{label}</small><strong>{value}</strong></div></div>;
}
function EmptyState({ icon, title, text, action, onAction }: { icon: ReactNode; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{text}</p>{action && onAction && <button className="button button-outline" onClick={onAction}>{action}</button>}</div>;
}
function DashboardPage({
  sales, products, stockBatches, branches, activeBranchId, isOwner, settings, chartPeriod, setChartPeriod, navTo, bannerSource,
}: {
  sales: Sale[]; products: Product[]; stockBatches: StockBatch[]; branches: Branch[];
  activeBranchId: string; isOwner: boolean; bannerSource: string;
  settings: { currency: string; storeName: string };
  chartPeriod: '7' | '30' | '365'; setChartPeriod: (value: '7' | '30' | '365') => void; navTo: (page: Page) => void;
}) {
  // Dashboard scope is independent from the global branch switcher. The Owner can
  // inspect all branches here without changing the branch context of POS/Inventory.
  const [branchFilter, setBranchFilter] = useState(isOwner ? 'all' : activeBranchId);
  const selectedBranchId = isOwner ? branchFilter : activeBranchId;
  const scopedSales = useMemo(() => sales.filter((sale) =>
    sale.status === 'completed' && (selectedBranchId === 'all' || (sale.branchId || activeBranchId) === selectedBranchId)
  ), [sales, selectedBranchId, activeBranchId]);
  const scopedProducts = useMemo(() => products.filter((product) =>
    selectedBranchId === 'all' || (product.branchId || activeBranchId) === selectedBranchId
  ), [products, selectedBranchId, activeBranchId]);
  const scopedBatches = useMemo(() => stockBatches.filter((batch) =>
    selectedBranchId === 'all' || batch.branchId === selectedBranchId
  ), [stockBatches, selectedBranchId]);
  const expiredByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    scopedBatches.forEach((batch) => {
      if (batch.expiryDate && batch.expiryDate < today() && batch.quantity > 0) {
        const key = `${batch.branchId}::${batch.productId}`;
        totals.set(key, (totals.get(key) || 0) + batch.quantity);
      }
    });
    return totals;
  }, [scopedBatches]);
  const getSellableStock = (product: Product) => Math.max(0, product.stock - (expiredByProduct.get(`${product.branchId || activeBranchId}::${product.id}`) || 0));
  const todaySales = useMemo(() => scopedSales.filter((sale) => dayKey(new Date(sale.date)) === today()), [scopedSales]);
  const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.total, 0);
  const todayProfit = todaySales.reduce((sum, sale) => sum + sale.profit, 0);
  const stockedProductCount = scopedProducts.filter((product) => product.stock > 0).length;
  const lowStockProducts = scopedProducts.filter((product) => getSellableStock(product) <= product.lowStockAt);
  const productCountLabel = `${scopedProducts.length} items`;
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
          value: scopedSales.filter((sale) => {
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
        value: scopedSales.filter((sale) => dayKey(new Date(sale.date)) === key).reduce((sum, sale) => sum + sale.total, 0),
      };
    });
  }, [chartPeriod, scopedSales]);
  const trendMax = Math.max(1, ...trend.map((item) => item.value));
  const recentSales = [...scopedSales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const branchSummaries = useMemo(() => branches.map((branch) => {
    const branchSales = sales.filter((sale) => sale.status === 'completed' && (sale.branchId || activeBranchId) === branch.id);
    const branchTodaySales = branchSales.filter((sale) => dayKey(new Date(sale.date)) === today());
    const branchProducts = products.filter((product) => (product.branchId || activeBranchId) === branch.id);
    const branchExpired = new Map<string, number>();
    stockBatches.forEach((batch) => {
      if (batch.branchId === branch.id && batch.expiryDate && batch.expiryDate < today() && batch.quantity > 0) {
        branchExpired.set(batch.productId, (branchExpired.get(batch.productId) || 0) + batch.quantity);
      }
    });
    const lowStockCount = branchProducts.filter((product) => Math.max(0, product.stock - (branchExpired.get(product.id) || 0)) <= product.lowStockAt).length;
    return {
      ...branch,
      revenue: branchTodaySales.reduce((sum, sale) => sum + sale.total, 0),
      count: branchTodaySales.length,
      lowStockCount,
      stockedCount: branchProducts.filter((product) => product.stock > 0).length,
    };
  }), [branches, sales, products, stockBatches, activeBranchId]);
  const selectedBranchName = selectedBranchId === 'all'
    ? 'ဆိုင်အားလုံး' : branches.find((branch) => branch.id === selectedBranchId)?.name || settings.storeName;
  return <section className="page-stack">
    <div className={`welcome-banner${bannerSource && selectedBranchId === activeBranchId ? ' has-shop-banner' : ''}`}>
      {bannerSource && selectedBranchId === activeBranchId && <img className="welcome-banner-image" src={bannerSource} alt="Shop banner" />}
      <div className="welcome-banner-copy"><span className="welcome-kicker">GOOD BUSINESS STARTS HERE</span><h2>မင်္ဂလာပါ 👋</h2><p>{selectedBranchId === 'all' ? `${settings.storeName} · ဆိုင်ခွဲအားလုံး၏ လုပ်ငန်းအခြေအနေ` : `${selectedBranchName} ရဲ့ ယနေ့လုပ်ငန်းအခြေအနေ`}</p></div>
      <div className="welcome-decoration"><Store size={48} /></div>
    </div>
    {isOwner && <div className="dashboard-scope-bar">
      <div><strong>Dashboard ကြည့်ရှုမှု</strong><small>ဒီရွေးချယ်မှုက Dashboard ကိုသာ သက်ရောက်ပြီး POS / Inventory ရဲ့ Active Branch ကို မပြောင်းပါ။</small></div>
      <label><Store size={15} /><select aria-label="Dashboard branch filter" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">ဆိုင်အားလုံး (All Branches)</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
    </div>}
    {isOwner && selectedBranchId === 'all' && <div className="dashboard-branch-grid">
      {branchSummaries.map((branch) => <button type="button" className="dashboard-branch-card" key={branch.id} onClick={() => setBranchFilter(branch.id)}>
        <span className="dashboard-branch-card-title"><Store size={16} /> {branch.name}</span>
        <strong>{money(branch.revenue, settings.currency)}</strong>
        <span>{branch.count} transactions today</span>
        <small>{branch.stockedCount} stock ရှိသော Product · {branch.lowStockCount} Low Stock</small>
      </button>)}
    </div>}
    <div className="dashboard-stats">
      <div className="metric-card metric-primary"><div className="metric-head"><span>ယနေ့ ရောင်းအား</span><div><TrendingUp size={17} /></div></div><strong>{money(todayRevenue, settings.currency)}</strong><small>{todaySales.length} transactions today</small><div className="metric-foot"><ArrowUpRight size={14} /> Today’s sales revenue · {selectedBranchName}</div></div>
      <div className="metric-card"><div className="metric-head"><span>ယနေ့ ခန့်မှန်းအမြတ်</span><div><CircleDollarSign size={17} /></div></div><strong>{money(todayProfit, settings.currency)}</strong><small>Discount ပါဝင်ပြီး</small><div className="metric-foot">Gross profit estimate</div></div>
      <div className="metric-card"><div className="metric-head"><span>ပစ္စည်းအမျိုးအစား</span><div><Boxes size={17} /></div></div><strong>{productCountLabel}</strong><small>Stock ရှိသော Product {stockedProductCount} မျိုး</small><div className="metric-foot">Inventory overview</div></div>
      <div className="metric-card"><div className="metric-head"><span>Stock သတိပေးချက်</span><div className="metric-alert"><AlertTriangle size={17} /></div></div><strong>{lowStockProducts.length} items</strong><small>ပြန်လည်မှာယူရန် စစ်ဆေးပါ</small><button className="metric-link" onClick={() => navTo('inventory')}>{selectedBranchId === 'all' ? 'Active Branch Inventory ကြည့်ရန်' : 'Inventory ကြည့်ရန်'} <ArrowUpRight size={13} /></button></div>
    </div>
    <div className="dashboard-grid"><div className="panel chart-panel"><div className="panel-heading"><div><h3>Sales Overview</h3><p>{selectedBranchName} · နေ့စဉ် ရောင်းအား အခြေအနေ</p></div><div className="period-switch"><button className={chartPeriod === '7' ? 'active' : ''} onClick={() => setChartPeriod('7')}>7D</button><button className={chartPeriod === '30' ? 'active' : ''} onClick={() => setChartPeriod('30')}>30D</button><button className={chartPeriod === '365' ? 'active' : ''} onClick={() => setChartPeriod('365')}>12M</button></div></div><div className="bar-chart dashboard-chart">{trend.map((item) => <div className="bar-column" key={item.key}><div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(item.value ? 4 : 0, item.value / trendMax * 100)}%` }} title={money(item.value, settings.currency)} /></div><small>{item.label}</small></div>)}</div></div>
      <div className="panel low-stock-panel"><div className="panel-heading"><div><h3>Low Stock Alert</h3><p>လက်ကျန်နည်းနေသောပစ္စည်း</p></div><AlertTriangle className="warning-text" size={18} /></div>{lowStockProducts.length === 0 ? <EmptyState icon={<Check size={23} />} title="အားလုံး အဆင်ပြေပါတယ်" text="Stock နည်းနေသော ပစ္စည်းမရှိပါ။" /> : <div className="low-stock-list">{lowStockProducts.slice(0, 5).map((product) => <div className="low-stock-row" key={`${product.branchId}-${product.id}`}><div className="table-product-icon"><ShoppingBag size={16} /></div><div><strong>{product.name}</strong><small>{isOwner && selectedBranchId === 'all' ? branches.find((branch) => branch.id === product.branchId)?.name || '' : product.sku}</small></div><b className="stock-warning">{formatQuantity(getSellableStock(product), quantityModeForProduct(product))} {product.unit} ရောင်းနိုင်</b></div>)}</div>}<button className="panel-link" onClick={() => navTo('inventory')}>{selectedBranchId === 'all' ? 'Active Branch Inventory ကြည့်ရန်' : 'Inventory အားလုံးကြည့်ရန်'} <ArrowUpRight size={14} /></button></div></div>
    <div className="panel recent-panel"><div className="panel-heading"><div><h3>Recent Transactions</h3><p>နောက်ဆုံး အရောင်းမှတ်တမ်းများ · {selectedBranchName}</p></div><button className="text-button" onClick={() => navTo(selectedBranchId === 'all' ? 'analytics' : 'sales')}>{selectedBranchId === 'all' ? 'ဆိုင်အားလုံး Report ကြည့်ရန်' : 'အားလုံးကြည့်ရန်'} <ArrowUpRight size={14} /></button></div>{recentSales.length === 0 ? <EmptyState icon={<Receipt size={23} />} title="အရောင်းမှတ်တမ်း မရှိသေးပါ" text="POS မှာ ပထမဆုံး အရောင်းပြုလုပ်လိုက်ပါ။" action="POS သို့သွားရန်" onAction={() => navTo('pos')} /> : <div className="table-wrap"><table><thead><tr><th>Voucher</th><th>ဆိုင်ခွဲ</th><th>Customer</th><th>အချိန်</th><th>Payment</th><th>စုစုပေါင်း</th><th>Status</th></tr></thead><tbody>{recentSales.map((sale) => <tr key={sale.id}><td><strong className="mono">{sale.receiptNo}</strong></td><td>{branches.find((branch) => branch.id === (sale.branchId || activeBranchId))?.name || '—'}</td><td>{sale.customer}</td><td>{dateLabel(sale.date)}</td><td><span className={`tag ${sale.paymentMethod === 'Credit' ? 'tag-warn' : ''}`}>{sale.paymentMethod}</span>{sale.paymentMethod === 'KPay' && sale.kpayTransactionReference && <small>TX: {sale.kpayTransactionReference}</small>}</td><td><b>{money(sale.total, settings.currency)}</b></td><td><span className="tag tag-success">Completed</span></td></tr>)}</tbody></table></div>}</div>
  </section>;
}

export default App;
