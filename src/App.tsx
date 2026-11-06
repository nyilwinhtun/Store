import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, AlertTriangle, ArchiveRestore, ArrowDownToLine, ArrowLeftRight, ArrowUpRight, BarChart3,
  Boxes, Check, CircleDollarSign, ClipboardList, CreditCard, Coins, Download,
  FileJson, LayoutDashboard, LockKeyhole, Menu, Minus, PackagePlus,
  Plus, Printer, Receipt, Search, Settings, ShoppingBag, ShoppingCart,
  Smartphone, Store, Trash2, TrendingUp, Truck, Wallet, X, Users, CalendarClock, UserRound, Sun, Moon, LogOut,
} from 'lucide-react';
import {
  usePosStore, type CartItem, type Expense, type PriceMode, type Product, type Sale,
} from './store/usePosStore';
import { CustomerCreditPage, ExpiryTrackingPage, SupplierPurchasePage } from './components/BusinessPages';
import { StockReceivingPage } from './components/StockReceivingPage';
import { StockTransferPage } from './components/StockTransferPage';
import { ActivityLogPage, CashManagementPage } from './components/OperationsPages';
import { CloudSyncPanel } from './components/CloudSyncPanel';
import { useBusinessAccess, canAccessBranch, canUsePage } from './lib/businessAccess';
import { firebaseApp, firebaseAuth, FIREBASE_BUSINESS_ID } from './lib/firebase';
import { signOut } from 'firebase/auth';
import { BranchManagementPage } from './components/BranchManagementPage';
import { ProfileManagementPage } from './components/ProfileManagementPage';
import { exportLocalImages, importLocalImages, migrateDataUrlImage, useLocalImageSource } from './lib/localImages';
import { formatQuantity, hasLegacyFractionalQuantity, inferQuantityMode, isValidQuantity, quantityModeForProduct, quantityStep, type QuantityMode } from './lib/quantity';

type Page = 'profile' | 'branches' | 'dashboard' | 'pos' | 'inventory' | 'receiving' | 'transfers' | 'sales' | 'customers' | 'purchasing' | 'expiry' | 'cash' | 'activity' | 'expenses' | 'analytics' | 'settings';
type ProductDraft = {
  name: string; sku: string; category: string; costPrice: string; retailPrice: string;
  wholesalePrice: string; stock: string; lowStockAt: string; unit: string; quantityMode: QuantityMode;
};

const emptyDraft: ProductDraft = {
  name: '', sku: '', category: 'အထွေထွေ', costPrice: '0', retailPrice: '0',
  wholesalePrice: '0', stock: '0', lowStockAt: '5', unit: 'ခု', quantityMode: 'whole',
};
const money = (value: number, currency = 'MMK') => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value || 0))} ${currency}`;
const dateLabel = (value: string) => new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const today = () => dayKey(new Date());
const makeReceiptNo = () => `MM-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-5)}`;

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
  const [installPrompt, setInstallPrompt] = useState<(() => Promise<void>) | null>(null);
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyDraft);
  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('အားလုံး');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState('လက်လီဝယ်သူ');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Credit'>('Cash');
  const [discount, setDiscount] = useState('0');
  const [saleSearch, setSaleSearch] = useState('');
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('ဆိုင်အသုံးစရိတ်');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [chartPeriod, setChartPeriod] = useState<'7' | '30' | '365'>('7');
  const importRef = useRef<HTMLInputElement>(null);

  const allProducts = usePosStore((s) => s.products);
  const allSales = usePosStore((s) => s.sales);
  const allExpenses = usePosStore((s) => s.expenses);
  const allHeldItems = usePosStore((s) => s.heldItems);
  const customers = usePosStore((s) => s.customers);
  const allStockBatches = usePosStore((s) => s.stockBatches);
  const allCategories = usePosStore((s) => s.categories);
  const branches = usePosStore((s) => s.branches);
  const activeBranchId = usePosStore((s) => s.activeBranchId);
  const activeBranch = branches.find((branch) => branch.id === activeBranchId);
  const activeBranches = branches.filter((branch) => branch.status === 'active' && canAccessBranch(access.role, access.branchIds, branch.id));
  const products = useMemo(() => allProducts.filter((record) => record.branchId === activeBranchId), [allProducts, activeBranchId]);
  const sales = useMemo(() => allSales.filter((record) => record.branchId === activeBranchId), [allSales, activeBranchId]);
  const expenses = useMemo(() => allExpenses.filter((record) => record.branchId === activeBranchId), [allExpenses, activeBranchId]);
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
  const deleteExpense = usePosStore((s) => s.deleteExpense);
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
    if (cashierMode && !access.branchIds.includes(activeBranchId)) {
      const firstAllowed = branches.find((branch) => branch.status === 'active' && access.branchIds.includes(branch.id));
      if (firstAllowed) { setActiveBranch(firstAllowed.id); setPage('dashboard'); setCart([]); }
    }
  }, [cashierMode, access.branchIds, activeBranchId, branches, setActiveBranch]);

  useEffect(() => {
    if (cashierMode && !canUsePage(access.role, page)) setPage('dashboard');
  }, [cashierMode, access.role, page]);

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
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  };
  const authorize = (action: string) => {
    if (cashierMode) { notify('ဒီလုပ်ဆောင်ချက်အတွက် Owner ခွင့်ပြုချက် လိုအပ်ပါတယ်။'); return false; }
    const pin = window.prompt(`${action}\nAdmin PIN ထည့်ပါ။`);
    if (pin === null) return false;
    if (pin !== settings.adminPin) { notify('Admin PIN မှားယွင်းနေပါတယ်။'); return false; }
    return true;
  };
  const switchBranch = (branchId: string) => {
    if (!canAccessBranch(access.role, access.branchIds, branchId)) { notify('ဒီဆိုင်ကို ဝင်ခွင့်မရှိပါ။ Owner ကို ဆက်သွယ်ပါ။'); return; }
    if (branchId === activeBranchId) return;
    if (!cashierMode && !authorize('ဆိုင်ခွဲပြောင်းရန်')) return;
    setActiveBranch(branchId);
    setCart([]); setDiscount('0'); setLastSale(null); setCategoryFilter('အားလုံး');
    setPage('dashboard'); setMobileMenu(false);
    const target = branches.find((branch) => branch.id === branchId);
    notify(`${target?.name || 'ဆိုင်'} သို့ ပြောင်းပြီးပါပြီ။`);
  };
  const viewBranchInventory = (branchId: string) => {
    if (!canAccessBranch(access.role, access.branchIds, branchId)) { notify('ဒီဆိုင်ကို ဝင်ခွင့်မရှိပါ။ Owner ကို ဆက်သွယ်ပါ။'); return; }
    setActiveBranch(branchId);
    setCart([]); setDiscount('0'); setLastSale(null); setCategoryFilter('အားလုံး');
    setPage('inventory'); setMobileMenu(false);
    const target = branches.find((branch) => branch.id === branchId);
    notify(`${target?.name || 'ဆိုင်'} Inventory ကို ဖွင့်ထားပါတယ်။`);
  };

  const validSales = useMemo(() => sales.filter((sale) => sale.status === 'completed'), [sales]);
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
  const sellableStock = (product: Product) => Math.max(0, product.stock - (expiredBatchUnits.get(product.id) || 0));
  const lowStockProducts = products.filter((product) => sellableStock(product) <= product.lowStockAt);
  const filteredProducts = products.filter((product) => {
    const query = productSearch.trim().toLowerCase();
    const match = !query || product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query);
    return match && (categoryFilter === 'အားလုံး' || product.category === categoryFilter);
  });
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discountValue = Math.max(0, Math.min(subtotal, Number(discount) || 0));
  const checkoutTotal = Math.max(0, subtotal - discountValue);
  const cartProfit = cart.reduce((sum, item) => sum + (item.unitPrice - item.costPrice) * item.quantity, 0) - discountValue;
  const filteredSales = sales.filter((sale) => sale.receiptNo.toLowerCase().includes(saleSearch.toLowerCase()) || sale.customer.toLowerCase().includes(saleSearch.toLowerCase()));

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
  const categoryStats = useMemo(() => {
    const values = new Map<string, number>();
    validSales.forEach((sale) => sale.items.forEach((item) => {
      const category = productMap.get(item.productId)?.category || 'ဖျက်ထားသောပစ္စည်း';
      values.set(category, (values.get(category) || 0) + item.quantity * item.unitPrice);
    }));
    return [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [validSales, productMap]);
  const categoryTotal = categoryStats.reduce((sum, [, value]) => sum + value, 0);

  const openNewProduct = () => {
    setEditingProduct(null);
    setProductDraft(emptyDraft);
    setShowProductModal(true);
  };
  const openEditProduct = (product: Product) => {
    setEditingProduct(product);
    setProductDraft({
      name: product.name, sku: product.sku, category: product.category,
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
    const stockChanged = !editingProduct || Math.abs(stock - editingProduct.stock) > 1e-8;
    const modeChanged = !!editingProduct && quantityMode !== quantityModeForProduct(editingProduct);
    if ((stockChanged || modeChanged) && !isValidQuantity(stock, quantityMode, true)) {
      notify(quantityMode === 'whole' ? 'ဒီပစ္စည်းကို အရေအတွက်ပြည့်ကိန်းသာ ထည့်နိုင်ပါတယ်။ လက်ရှိလက်ကျန် ဒသမရှိပါက တကယ်ရေတွက်ပြီး Stock ကို ပြင်ပါ။' : 'ဒသမအရေအတွက်ကို အများဆုံး ၃ နေရာအထိ ထည့်နိုင်ပါတယ်။');
      return;
    }
    if (!isValidQuantity(lowStockAt, quantityMode, true)) { notify('Low Stock Alert ကို သတ်မှတ်ထားသော ယူနစ်ပုံစံနဲ့ ကိုက်ညီအောင် ထည့်ပါ။'); return; }
    const payload = {
      name: productDraft.name.trim(), sku: productDraft.sku.trim() || `SKU-${Date.now().toString().slice(-6)}`,
      category: productDraft.category, costPrice: Math.max(0, Number(productDraft.costPrice) || 0),
      retailPrice: Math.max(0, Number(productDraft.retailPrice) || 0),
      wholesalePrice: Math.max(0, Number(productDraft.wholesalePrice) || 0),
      stock, lowStockAt, unit, quantityMode,
    };
    const duplicateSku = products.some((product) => product.id !== editingProduct?.id && product.sku.trim().toLocaleLowerCase() === payload.sku.toLocaleLowerCase());
    if (duplicateSku) { notify('ဒီဆိုင်မှာ SKU / Barcode တူညီပြီးသားရှိပါတယ်။'); return; }
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
      }];
    });
  };
  const changeCartQty = (productId: string, quantity: number) => {
    const product = productMap.get(productId);
    if (quantity <= 0) { setCart((items) => items.filter((item) => item.productId !== productId)); return; }
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
      if (existing) return items.map((item) => item.productId === productId ? { ...item, quantity: item.quantity + held.quantity } : item);
      const { heldAt, ...rest } = held;
      void heldAt;
      return [...items, rest];
    });
    notify('ပစ္စည်းကို Cart ထဲ ပြန်ထည့်ပြီးပါပြီ။');
  };
  const completeSale = () => {
    if (cart.some((item) => !Number.isFinite(item.unitPrice) || item.unitPrice <= 0)) { notify('ဈေးနှုန်း မသတ်မှတ်ရသေးသော ပစ္စည်းရှိနေပါတယ်။ အရင်ဆုံး ဈေးဖြည့်ပါ။'); return; }
    if (!cart.length) { notify('ရောင်းချမည့်ပစ္စည်း မရှိသေးပါ။'); return; }
    const insufficient = cart.find((item) => { const product = productMap.get(item.productId); return !product || sellableStock(product) < item.quantity; });
    if (insufficient) { notify(`${insufficient.name} Stock မလုံလောက်ပါ။`); return; }
    if (paymentMethod === 'Credit' && (!customer.trim() || customer.trim() === 'လက်လီဝယ်သူ')) { notify('အကြွေးဝယ်သူအမည်ကို မှန်ကန်စွာ ဖြည့်ပါ။'); return; }
    const sale: Sale = {
      id: crypto.randomUUID(), receiptNo: makeReceiptNo(), date: new Date().toISOString(),
      customer: customer.trim() || 'လက်လီဝယ်သူ', paymentMethod, items: cart.map((item) => ({ ...item })),
      subtotal, discount: discountValue, total: checkoutTotal, profit: cartProfit, status: 'completed',
    };
    addSale(sale);
    setLastSale(sale);
    setCart([]); setDiscount('0'); setCustomer('လက်လီဝယ်သူ'); setPaymentMethod('Cash');
    notify('ရောင်းချမှု အောင်မြင်ပါပြီ။');
  };
  const printReceipt = (sale: Sale) => {
    setLastSale(sale);
    window.setTimeout(() => window.print(), 150);
  };
  const copyReceipt = async (sale: Sale) => {
    const lines = [settings.storeName, `Voucher: ${sale.receiptNo}`, dateLabel(sale.date), `Customer: ${sale.customer}`, '------------------------', ...sale.items.map((item) => `${item.name} x${item.quantity}  ${money(item.unitPrice * item.quantity, settings.currency)}`), '------------------------', `Total: ${money(sale.total, settings.currency)}`, `Payment: ${sale.paymentMethod}`, `Paid: ${money(sale.paidAmount ?? (sale.paymentMethod === 'Cash' ? sale.total : 0), settings.currency)}`, `Due: ${money(sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), settings.currency)}`, settings.receiptFooter];
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
    ['SKU', 'Product', 'Category', 'Cost Price', 'Retail Price', 'Wholesale Price', 'Stock', 'Unit', 'Low Stock At'],
    ...products.map((product) => [product.sku, product.name, product.category, product.costPrice, product.retailPrice, product.wholesalePrice, product.stock, product.unit, product.lowStockAt]),
  ]);
  const exportSalesCsv = () => downloadCsv(`minimart-sales-${today()}.csv`, [
    ['Voucher', 'Date', 'Customer', 'Payment', 'Items', 'Subtotal', 'Discount', 'Total', 'Gross Profit', 'Paid', 'Due', 'Status'],
    ...sales.map((sale) => [sale.receiptNo, sale.date, sale.customer, sale.paymentMethod, sale.items.length, sale.subtotal, sale.discount, sale.total, sale.profit, sale.paidAmount ?? (sale.paymentMethod === 'Cash' ? sale.total : 0), sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), sale.status]),
  ]);
  const exportExpensesCsv = () => downloadCsv(`minimart-expenses-${today()}.csv`, [
    ['Date', 'Title', 'Category', 'Amount', 'Note'],
    ...expenses.map((expense) => [expense.date, expense.title, expense.category, expense.amount, expense.note]),
  ]);

  const addExpenseSubmit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(expenseAmount);
    if (!expenseTitle.trim() || !(amount > 0)) { notify('အသုံးစရိတ်အမည်နှင့် ပမာဏ မှန်ကန်စွာ ဖြည့်ပါ။'); return; }
    addExpense({ title: expenseTitle.trim(), category: expenseCategory, amount, date: new Date().toISOString(), note: expenseNote.trim() });
    setExpenseTitle(''); setExpenseAmount(''); setExpenseNote('');
    notify('အသုံးစရိတ် မှတ်တမ်းသိမ်းပြီးပါပြီ။');
  };
  const exportBackup = async () => {
    try {
      const state = usePosStore.getState();
      const localImages = await exportLocalImages([
        ...state.branches.flatMap((branch) => [branch.logoUrl, branch.bannerUrl]),
        state.ownerProfile?.photoUrl,
      ]);
      const data = { app: 'minimart-pos', schemaVersion: 11, exportedAt: new Date().toISOString(), branches: state.branches, activeBranchId: state.activeBranchId, categories: state.categories, products: state.products, sales: state.sales, expenses: state.expenses, heldItems: state.heldItems, customers: state.customers, suppliers: state.suppliers, customerPayments: state.customerPayments, purchases: state.purchases, supplierPayments: state.supplierPayments, purchaseReturns: state.purchaseReturns, stockBatches: state.stockBatches, stockReceipts: state.stockReceipts, stockTransfers: state.stockTransfers, cashShifts: state.cashShifts, cashMovements: state.cashMovements, activityLogs: state.activityLogs, ownerProfile: state.ownerProfile, settings: state.settings, localImages };
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
      importData({ branches: importedBranches as never[] | undefined, activeBranchId: typeof data.activeBranchId === 'string' ? data.activeBranchId : undefined, categories: Array.isArray(data.categories) ? data.categories as never[] : undefined, products: data.products as Product[], sales: importedSales, expenses: data.expenses as Expense[], heldItems: Array.isArray(data.heldItems) ? data.heldItems as never[] : [], customers: importedCustomers, suppliers: Array.isArray(data.suppliers) ? data.suppliers as never[] : [], customerPayments: Array.isArray(data.customerPayments) ? data.customerPayments as never[] : [], purchases: Array.isArray(data.purchases) ? data.purchases as never[] : [], supplierPayments: Array.isArray(data.supplierPayments) ? data.supplierPayments as never[] : [], purchaseReturns: Array.isArray(data.purchaseReturns) ? data.purchaseReturns as never[] : [], stockBatches: Array.isArray(data.stockBatches) ? data.stockBatches as never[] : [], stockReceipts: Array.isArray(data.stockReceipts) ? data.stockReceipts as never[] : [], stockTransfers: Array.isArray(data.stockTransfers) ? data.stockTransfers as never[] : [], cashShifts: Array.isArray(data.cashShifts) ? data.cashShifts as never[] : [], cashMovements: Array.isArray(data.cashMovements) ? data.cashMovements as never[] : [], activityLogs: Array.isArray(data.activityLogs) ? data.activityLogs as never[] : [], ownerProfile: importedOwnerProfile as never, settings: data.settings as never });
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
    ...(activeBranches.length > 1 ? [{ id: 'transfers' as Page, label: 'ဆိုင်အချင်းချင်း ကုန်လွှဲ', icon: <ArrowLeftRight size={18} /> }] : []),
    { id: 'sales', label: 'အရောင်းမှတ်တမ်း', icon: <Receipt size={18} /> },
    { id: 'customers', label: 'Customer / အကြွေး', icon: <Users size={18} /> },
    { id: 'purchasing', label: 'Supplier / ပေးချေမှု', icon: <Truck size={18} /> },
    { id: 'expiry', label: 'Expiry Tracking', icon: <CalendarClock size={18} /> },
    { id: 'cash', label: 'Cash Register / Shift', icon: <Wallet size={18} /> },
    { id: 'activity', label: 'Activity Log', icon: <ClipboardList size={18} /> },
    { id: 'expenses', label: 'အသုံးစရိတ်', icon: <Wallet size={18} /> },
    { id: 'analytics', label: 'စာရင်းခွဲခြမ်းစိတ်ဖြာ', icon: <BarChart3 size={18} /> },
    { id: 'profile', label: 'ဆိုင် / Owner Profile', icon: <UserRound size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ];
  const navItems = navItemsAll.filter((item) => canUsePage(access.role, item.id));
  const pageTitle = navItems.find((item) => item.id === page)?.label || 'Dashboard';
  const navTo = (next: Page) => {
    if (!canUsePage(access.role, next)) { notify('ဒီစာမျက်နှာကို Owner သာ ဝင်ရောက်နိုင်ပါတယ်။'); return; }
    setPage(next); setMobileMenu(false);
  };

  if (access.status === 'loading') {
    return <main className="access-gate"><section className="panel access-gate-card"><div className="panel-icon"><LockKeyhole size={22} /></div><h1>Access စစ်ဆေးနေပါတယ်</h1><p>Firebase Server ကို One-time Read နဲ့ Owner UID / Cashier Membership စစ်ဆေးနေပါတယ်။</p></section></main>;
  }

  if (access.status === 'unassigned' || access.status === 'disabled' || access.status === 'error') {
    return <main className="access-gate"><section className="panel access-gate-card"><div className="panel-icon"><LockKeyhole size={22} /></div><h1>{access.status === 'unassigned' ? 'Business Access မသတ်မှတ်ရသေးပါ' : 'Account Access မရနိုင်ပါ'}</h1><p>{access.message}</p><div className="access-uid"><small>Firebase UID</small><code>{access.uid}</code><small>Firebase Project</small><code>{firebaseApp?.options.projectId || "မချိတ်ဆက်ရသေးပါ"}</code><small>Business ID</small><code>{FIREBASE_BUSINESS_ID}</code></div>{access.status === 'unassigned' && <div className="cloud-help"><strong>Owner Account ပထမဆုံး Setup လုပ်ရန်</strong><br />Owner အတွက် ရှိပြီးသား Business Document မှာ <code>ownerUid</code> Field ကို လက်ရှိ Firebase UID နဲ့ တူအောင် ထည့်ပါ။<br /><code>businesses/{FIREBASE_BUSINESS_ID}</code><br /><br />Document Fields ဥပမာ:<br /><code>ownerUid: "{access.uid}"</code><br /><code>active: true</code><br /><code>name: "My Minimart"</code><br /><br />Cashier အတွက်သာ အောက်ပါ Member Path ကို အသုံးပြုပါ။<br /><code>businesses/{FIREBASE_BUSINESS_ID}/members/{access.uid}</code><br /><br />Owner UID ကို Business Document မှ တိုက်ရိုက်စစ်ဆေးပြီး ဝင်ခွင့်ပေးပါမယ်။ ဒီစာမျက်နှာကို Refresh လုပ်ပါ။</div>}{access.status === 'error' && <button className="button button-primary" type="button" onClick={() => window.location.reload()}>ပြန်စမ်းရန်</button>}{firebaseAuth && <button className="button button-outline" onClick={() => void signOut(firebaseAuth)}> <LogOut size={15}/> Sign Out</button>}</section></main>;
  }

  if (cashierMode && !canUsePage(access.role, page)) {
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
        <div className="sidebar-bottom"><div className="offline-card"><div className="offline-icon"><Activity size={17} /></div><div><strong>Offline Ready</strong><small>Local data storage active</small></div><span className="live-dot" /></div><small className="version">MINIMART POS · v2.8.1</small></div>
      </aside>
      {mobileMenu && <button className="sidebar-backdrop" onClick={() => setMobileMenu(false)} aria-label="Close navigation" />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-btn menu-toggle" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu size={21} /></button><div><div className="eyebrow">STORE MANAGEMENT / {page.toUpperCase()}</div><h1>{pageTitle}</h1></div></div>
          <div className="topbar-actions"><button className="theme-toggle" type="button" onClick={() => setThemeMode((current) => current === 'light' ? 'dark' : 'light')} aria-label={themeMode === 'light' ? 'Dark Mode ပြောင်းရန်' : 'Light Mode ပြောင်းရန်'} aria-pressed={themeMode === 'dark'} title={themeMode === 'light' ? 'Dark Mode' : 'Light Mode'}>{themeMode === 'light' ? <Moon size={17} /> : <Sun size={17} />}<span>{themeMode === 'light' ? 'Dark' : 'Light'}</span></button>{activeBranches.length > 1 ? <label className="branch-switcher"><Store size={15} /><select aria-label="Active branch" value={activeBranchId} onChange={(event) => switchBranch(event.target.value)}>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : <div className="branch-single-pill"><Store size={14} /><span>{activeBranch?.name || 'Single Store'}</span><small>Single Store</small></div>}<div className="connection-pill"><span className="live-dot" /> {cashierMode ? 'Cashier · Branch Access' : access.status === 'active' ? 'Owner · Business Access' : 'Local mode'}</div>{cashierMode && firebaseAuth && <button className="button button-outline" type="button" onClick={() => void signOut(firebaseAuth)}><LogOut size={14}/> Sign Out</button>}{installPrompt && <button className="button button-outline install-btn" onClick={() => void installPrompt()}><Smartphone size={16} /> Install App</button>}{!cashierMode && <button className="avatar avatar-button" type="button" onClick={() => navTo('profile')} title="Profile ဖွင့်ရန်" aria-label="Profile ဖွင့်ရန်">{ownerPhotoSource ? <img src={ownerPhotoSource} alt="Owner profile" /> : (typeof ownerProfile?.displayName === 'string' ? ownerProfile.displayName.trim().charAt(0) || 'M' : 'M')}</button>}</div>
        </header>

        <div className="content-area">
          {page === 'profile' && <ProfileManagementPage authorize={authorize} notify={notify} />}
          {page === 'branches' && <BranchManagementPage authorize={authorize} notify={notify} />}
          {page === 'dashboard' && <DashboardPage
            todayRevenue={todayRevenue} todayProfit={todayProfit} todayCount={todaySales.length}
            bannerSource={activeBranchBannerSource}
            productCount={products.length} totalStockUnits={stockedProductCount} lowStockProducts={lowStockProducts} sellableStock={sellableStock}
            sales={validSales} settings={settings} trend={trend} trendMax={trendMax}
            chartPeriod={chartPeriod} setChartPeriod={setChartPeriod} navTo={navTo}
          />}

          {page === 'pos' && <section className="pos-layout">
            <div className="pos-products-panel">
              <div className="section-heading"><div><h2>ပစ္စည်းရွေးချယ်ရန်</h2><p>ရောင်းချမည့်ပစ္စည်းကို ရွေးပြီး Cart ထဲထည့်ပါ။</p></div><span className="subtle-count">{filteredProducts.length} items</span></div>
              <div className="toolbar"><div className="search-box"><Search size={17} /><input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { const code = productSearch.trim().toLowerCase(); const match = products.find((product) => product.sku.toLowerCase() === code || product.name.toLowerCase() === code); if (match) { addToCart(match); setProductSearch(''); } else notify('Barcode / SKU မတွေ့ပါ။'); } }} placeholder="ပစ္စည်းအမည် / SKU / Barcode scan..." /></div><select className="select-control category-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option>အားလုံး</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></div>
              {products.length === 0 ? <EmptyState icon={<ShoppingBag size={25} />} title="ပစ္စည်း မရှိသေးပါ" text="အရင်ဆုံး Inventory ထဲမှာ ပစ္စည်းထည့်ပြီးမှ POS မှာ ရောင်းချနိုင်ပါမယ်။" action="ပစ္စည်းထည့်ရန်" onAction={() => navTo('inventory')} /> :
                filteredProducts.length === 0 ? <EmptyState icon={<Search size={25} />} title="မတွေ့ပါ" text="ရှာဖွေမှု စကားလုံး သို့မဟုတ် Category ကို ပြောင်းကြည့်ပါ။" /> :
                <div className="product-grid">{filteredProducts.map((product) => <button key={product.id} className={`product-tile ${sellableStock(product) <= 0 ? 'out-of-stock' : ''}`} onClick={() => addToCart(product)} disabled={sellableStock(product) <= 0}><div className="product-tile-icon"><ShoppingBag size={22} /></div><strong>{product.name}</strong><span className="product-sku">{product.sku}</span><div className="product-tile-bottom"><b>{product.retailPrice > 0 ? money(product.retailPrice, settings.currency) : 'ဈေးမသတ်မှတ်ရသေး'}</b><span className={sellableStock(product) <= product.lowStockAt ? 'stock-warning' : 'stock-ok'}>{formatQuantity(sellableStock(product), quantityModeForProduct(product))} {product.unit} ရောင်းနိုင်</span></div></button>)}</div>}
            </div>
            <aside className="cart-panel">
              <div className="cart-title"><div><h2><ShoppingCart size={19} /> Current Cart</h2><p>{cart.length} items</p></div><button className="text-button" onClick={() => { setCart([]); setDiscount('0'); }}>Clear</button></div>
              <div className="cart-customer"><label>Customer</label><input list="pos-customer-options" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="ဝယ်သူအမည်" /><datalist id="pos-customer-options">{customers.map((entry) => <option key={entry.id} value={entry.name} />)}</datalist><div className="payment-switch"><button className={paymentMethod === 'Cash' ? 'selected' : ''} onClick={() => setPaymentMethod('Cash')}><Wallet size={15} /> Cash</button><button className={paymentMethod === 'Credit' ? 'selected' : ''} onClick={() => setPaymentMethod('Credit')}><CreditCard size={15} /> Credit</button></div></div>
              <div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><ShoppingCart size={27} /><strong>Cart ထဲမှာ ဘာမှမရှိသေးပါ</strong><span>ဘယ်ဘက်က ပစ္စည်းတစ်ခုကို ရွေးပါ။</span></div> : cart.map((item) => <div className="cart-line" key={item.productId}><div className="cart-line-top"><div><strong>{item.name}</strong><small>{item.sku}</small></div><button className="icon-btn danger-icon" onClick={() => setAside(item)} title="Not buying list ထဲသိမ်း"><ArchiveRestore size={16} /></button></div><div className="price-mode"><button className={item.mode === 'retail' ? 'active' : ''} onClick={() => changePriceMode(item, 'retail')}>လက်လီ</button><button className={item.mode === 'wholesale' ? 'active' : ''} onClick={() => changePriceMode(item, 'wholesale')}>လက်ကား</button><span>{money(item.unitPrice, settings.currency)}</span></div><div className="cart-line-bottom"><div className="qty-control"><button onClick={() => { const product = productMap.get(item.productId); const step = product && quantityModeForProduct(product) === 'decimal' ? 0.1 : 1; changeCartQty(item.productId, Math.round((item.quantity - step) * 1000) / 1000); }}><Minus size={13} /></button><b>{formatQuantity(item.quantity, productMap.get(item.productId) ? quantityModeForProduct(productMap.get(item.productId)!) : 'whole')}</b><button onClick={() => { const product = productMap.get(item.productId); const step = product && quantityModeForProduct(product) === 'decimal' ? 0.1 : 1; changeCartQty(item.productId, Math.round((item.quantity + step) * 1000) / 1000); }}><Plus size={13} /></button></div><strong>{money(item.unitPrice * item.quantity, settings.currency)}</strong></div></div>)}</div>
              {heldItems.length > 0 && <div className="held-section"><div className="held-heading"><span>မယူတော့သောပစ္စည်း</span><b>{heldItems.length}</b></div>{heldItems.map((item) => <div className="held-row" key={item.productId}><span>{item.name} × {formatQuantity(item.quantity, productMap.get(item.productId) ? quantityModeForProduct(productMap.get(item.productId)!) : 'whole')}</span><button onClick={() => restoreHeld(item.productId)}>ပြန်ထည့်</button></div>)}</div>}
              <div className="cart-summary"><div><span>Subtotal</span><b>{money(subtotal, settings.currency)}</b></div><div className="discount-row"><label htmlFor="discount-input">Discount (MMK)</label><input id="discount-input" type="number" min="0" max={subtotal} value={discount} onChange={(e) => setDiscount(e.target.value)} /></div><div className="total-row"><span>Total</span><strong>{money(checkoutTotal, settings.currency)}</strong></div><button className="button button-primary checkout-button" onClick={completeSale} disabled={!cart.length}><Check size={17} /> Checkout & Save Sale</button><small className="cart-note">Checkout လုပ်သည့်အခါ Stock ကို အလိုအလျောက် လျှော့ပါမည်။</small></div>
            </aside>
          </section>}

          {page === 'receiving' && <StockReceivingPage notify={notify} />}
          {page === 'transfers' && <StockTransferPage authorize={authorize} notify={notify} onViewDestination={viewBranchInventory} />}
          {page === 'inventory' && <section className="page-stack"><div className="section-heading"><div><h2>Inventory Management</h2><p>ပစ္စည်း၊ ဈေးနှုန်းနှင့် လက်ကျန် Stock ကို စီမံပါ။</p></div><div className="heading-actions"><button className="button button-outline" onClick={exportProductsCsv}><Download size={15} /> CSV</button><button className="button button-primary" onClick={openNewProduct}><Plus size={17} /> ပစ္စည်းအသစ်</button></div></div><div className="mini-stats"><MiniStat icon={<Boxes size={17} />} label="ပစ္စည်းအမျိုးအစား" value={String(products.length)} /><MiniStat icon={<PackagePlus size={17} />} label="လက်ကျန်ရှိသော ပစ္စည်း" value={String(stockedProductCount)} /><MiniStat icon={<AlertTriangle size={17} />} label="Stock နည်းနေသောပစ္စည်း" value={String(lowStockProducts.length)} tone="warning" /></div><div className="panel">{legacyFractionalStockCount > 0 && <div className="backup-warning"><AlertTriangle size={16} /><span>အရေအတွက်ယူနစ်ဖြစ်သော်လည်း ဒသမလက်ကျန်ရှိသော Product {legacyFractionalStockCount} မျိုးရှိပါတယ်။ လက်တွေ့ရေတွက်ပြီး Stock ± ဖြင့် အမှန်တကယ်လက်ကျန်ကို ပြင်ပါ။ App က ဒသမကို အလိုအလျောက် Round မလုပ်ပါ။</span></div>}<div className="table-toolbar"><div className="search-box"><Search size={16} /><input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="ပစ္စည်း / SKU ရှာရန်..." /></div><span className="subtle-count">{filteredProducts.length} records</span></div><div className="table-wrap"><table><thead><tr><th>ပစ္စည်း</th><th>Category</th><th>Cost</th><th>လက်လီ</th><th>လက်ကား</th><th>ရောင်းနိုင် / စုစုပေါင်း</th><th>လုပ်ဆောင်ချက်</th></tr></thead><tbody>{filteredProducts.map((product) => <tr key={product.id}><td><div className="table-product"><span className="table-product-icon"><ShoppingBag size={17} /></span><span><strong>{product.name}</strong><small>{product.sku || 'Barcode မထည့်ရသေး'}</small></span></div></td><td><span className="tag">{product.category}</span></td><td>{money(product.costPrice, settings.currency)}</td><td><b>{money(product.retailPrice, settings.currency)}</b></td><td>{money(product.wholesalePrice, settings.currency)}</td><td><span className={sellableStock(product) <= product.lowStockAt ? 'stock-warning' : 'stock-ok'}>{formatQuantity(sellableStock(product), quantityModeForProduct(product))} / {formatQuantity(product.stock, quantityModeForProduct(product))} {product.unit}{hasLegacyFractionalQuantity(product.stock, quantityModeForProduct(product)) ? <small className="stock-warning">ဒသမလက်ကျန် · ပြန်စစ်ရန်</small> : null}</span></td><td><div className="table-actions"><button className="small-action" onClick={() => openEditProduct(product)}>ပြင်ရန်</button><button className="small-action" onClick={() => { const amountText = window.prompt(`Stock ဘယ်လောက် တိုး/လျှော့မလဲ။ ${quantityModeForProduct(product) === 'whole' ? 'နောက်ဆုံးလက်ကျန်က အရေအတွက်ပြည့်ကိန်း ဖြစ်ရပါမယ်။ ဒသမလက်ကျန်ကို မှန်ကန်အောင် ပြင်ရန် 0.012 လို correction amount ထည့်နိုင်ပါတယ်။' : 'ဒသမ ၃ နေရာအထိ ထည့်နိုင်ပါတယ်။'}`); if (amountText !== null) { const amount = Number(amountText); if (Number.isFinite(amount) && amount !== 0) { if (adjustStock(product.id, amount)) notify('Stock ပြင်ဆင်ပြီးပါပြီ။'); else notify('Stock ပြင်မရပါ။ ယူနစ်၊ လက်ကျန်နဲ့ အရေအတွက်ကို ပြန်စစ်ပါ။'); } } }}>Stock ±</button><button className="icon-btn danger-icon" title="Delete" onClick={() => { if (authorize('ပစ္စည်းဖျက်ရန်') && window.confirm(`${product.name} ကို ဖျက်မလား။`)) { deleteProduct(product.id); setCart((items) => items.filter((item) => item.productId !== product.id)); notify('ပစ္စည်းဖျက်ပြီးပါပြီ။'); } }}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table>{filteredProducts.length === 0 && <EmptyState icon={<Boxes size={24} />} title="စာရင်းမရှိသေးပါ" text="ပစ္စည်းအသစ်ထည့်ပြီး စတင်အသုံးပြုပါ။" action="ပစ္စည်းထည့်ရန်" onAction={openNewProduct} />}</div></div></section>}

          {page === 'sales' && <section className="page-stack"><div className="section-heading"><div><h2>Sales History</h2><p>ပြီးခဲ့သော ရောင်းချမှုများကို ကြည့်ရှု၊ Voucher ပြန်ထုတ်နိုင်ပါတယ်။</p></div><div className="heading-actions"><button className="button button-outline" onClick={exportSalesCsv}><Download size={15} /> CSV</button><div className="sales-summary-chip"><TrendingUp size={17} /> {validSales.length} completed sales</div></div></div><div className="panel"><div className="table-toolbar"><div className="search-box"><Search size={16} /><input value={saleSearch} onChange={(e) => setSaleSearch(e.target.value)} placeholder="Voucher No / Customer ရှာရန်..." /></div><span className="subtle-count">{filteredSales.length} records</span></div><div className="table-wrap"><table><thead><tr><th>Voucher</th><th>နေ့စွဲ</th><th>Customer</th><th>Items</th><th>Payment</th><th>Total</th><th>Due</th><th>Status / Action</th></tr></thead><tbody>{filteredSales.map((sale) => <tr key={sale.id}><td><strong className="mono">{sale.receiptNo}</strong></td><td>{dateLabel(sale.date)}</td><td>{sale.customer}</td><td>{sale.items.length} မျိုး</td><td><span className={`tag ${sale.paymentMethod === 'Credit' ? 'tag-warn' : ''}`}>{sale.paymentMethod}</span></td><td><b>{money(sale.total, settings.currency)}</b></td><td>{money(sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total : 0), settings.currency)}</td><td><div className="table-actions">{sale.status === 'voided' ? <span className="tag tag-danger">Voided</span> : <span className="tag tag-success">Completed</span>}<button className="icon-btn" title="Print" onClick={() => printReceipt(sale)}><Printer size={15} /></button><button className="icon-btn" title="Copy voucher" onClick={() => void copyReceipt(sale)}><FileJson size={15} /></button>{sale.status === 'completed' && (sale.paymentMethod === 'Cash' || (sale.paidAmount ?? 0) === 0) && <button className="icon-btn danger-icon" title="Void sale" onClick={() => { if (authorize('Voucher ပယ်ဖျက်ရန်') && window.confirm('ဒီ Sale ကို Void လုပ်မလား။ Stock ပြန်ပေါင်းပါမယ်။')) { voidSale(sale.id); notify('Sale Void လုပ်ပြီး Stock ပြန်ပေါင်းပြီးပါပြီ။'); } }}><X size={15} /></button>}</div></td></tr>)}</tbody></table>{filteredSales.length === 0 && <EmptyState icon={<Receipt size={24} />} title="အရောင်းမှတ်တမ်း မရှိသေးပါ" text="POS မှာ Checkout လုပ်ပြီးနောက် မှတ်တမ်းတွေ ဒီနေရာမှာ ပေါ်လာပါမယ်။" />}</div></div></section>}

          {page === 'customers' && <CustomerCreditPage />}

          {page === 'purchasing' && <SupplierPurchasePage />}

          {page === 'expiry' && <ExpiryTrackingPage />}

          {page === 'cash' && <CashManagementPage />}

          {page === 'activity' && <ActivityLogPage />}

          {page === 'expenses' && <section className="page-stack"><div className="section-heading"><div><h2>Expense Management</h2><p>ဆိုင်အသုံးစရိတ်များကို နေ့စွဲနှင့် အမျိုးအစားအလိုက် သိမ်းဆည်းပါ။</p></div><div className="heading-actions"><button className="button button-outline" onClick={exportExpensesCsv}><Download size={15} /> CSV</button><div className="sales-summary-chip"><Wallet size={17} /> {money(expenses.reduce((sum, item) => sum + item.amount, 0), settings.currency)} total</div></div></div><div className="two-column-layout"><form className="panel form-panel" onSubmit={addExpenseSubmit}><div className="panel-heading"><div className="panel-icon"><CircleDollarSign size={18} /></div><div><h3>အသုံးစရိတ်အသစ်</h3><p>ဖြည့်ပြီး မှတ်တမ်းတင်ပါ။</p></div></div><label>အသုံးစရိတ်အမည်<input value={expenseTitle} onChange={(e) => setExpenseTitle(e.target.value)} placeholder="ဥပမာ - မီးဖိုး၊ သယ်ယူစရိတ်" /></label><label>အမျိုးအစား<select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)}><option>ဆိုင်အသုံးစရိတ်</option><option>သယ်ယူပို့ဆောင်ရေး</option><option>လစာ</option><option>မီး/ရေ</option><option>ပြုပြင်ထိန်းသိမ်းရေး</option><option>အခြား</option></select></label><label>ပမာဏ (MMK)<input type="number" min="1" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} placeholder="0" /></label><label>မှတ်ချက် (မဖြစ်မနေမဟုတ်)<textarea value={expenseNote} onChange={(e) => setExpenseNote(e.target.value)} rows={3} placeholder="အသေးစိတ်..." /></label><button className="button button-primary" type="submit"><Plus size={16} /> သိမ်းဆည်းရန်</button></form><div className="panel"><div className="panel-heading"><div className="panel-icon"><ClipboardList size={18} /></div><div><h3>Expense Records</h3><p>နောက်ဆုံး မှတ်တမ်းများ</p></div></div>{expenses.length === 0 ? <EmptyState icon={<Wallet size={24} />} title="အသုံးစရိတ် မရှိသေးပါ" text="အသုံးစရိတ်ကို ဘယ်ဘက် Form မှာ ထည့်နိုင်ပါတယ်။" /> : <div className="expense-list">{expenses.map((expense) => <div className="expense-row" key={expense.id}><div className="expense-badge"><Truck size={17} /></div><div className="expense-details"><strong>{expense.title}</strong><small>{expense.category} · {dateLabel(expense.date)}</small>{expense.note && <small>{expense.note}</small>}</div><div className="expense-amount">-{money(expense.amount, settings.currency)}<button className="icon-btn danger-icon" onClick={() => { if (authorize('အသုံးစရိတ်ဖျက်ရန်') && window.confirm('ဒီအသုံးစရိတ်ကို ဖျက်မလား။')) { deleteExpense(expense.id); notify('အသုံးစရိတ် ဖျက်ပြီးပါပြီ။'); } }}><Trash2 size={15} /></button></div></div>)}</div>}</div></div></section>}

          {page === 'analytics' && <section className="page-stack"><div className="section-heading"><div><h2>Business Analytics</h2><p>ရောင်းအား၊ အမြတ်နှင့် အမျိုးအစားအလိုက် အချက်အလက်များ။</p></div><div className="period-switch"><button className={chartPeriod === '7' ? 'active' : ''} onClick={() => setChartPeriod('7')}>7 Days</button><button className={chartPeriod === '30' ? 'active' : ''} onClick={() => setChartPeriod('30')}>30 Days</button><button className={chartPeriod === '365' ? 'active' : ''} onClick={() => setChartPeriod('365')}>12 Months</button></div></div><div className="mini-stats analytics-stats"><MiniStat icon={<TrendingUp size={17} />} label="စုစုပေါင်း အရောင်း" value={money(validSales.reduce((sum, sale) => sum + sale.total, 0), settings.currency)} /><MiniStat icon={<CircleDollarSign size={17} />} label="Gross Profit" value={money(validSales.reduce((sum, sale) => sum + sale.profit, 0), settings.currency)} /><MiniStat icon={<Wallet size={17} />} label="အသုံးစရိတ်" value={money(expenses.reduce((sum, item) => sum + item.amount, 0), settings.currency)} /><MiniStat icon={<Coins size={17} />} label="ခန့်မှန်း Net Profit" value={money(validSales.reduce((sum, sale) => sum + sale.profit, 0) - expenses.reduce((sum, item) => sum + item.amount, 0), settings.currency)} /></div><div className="analytics-grid"><div className="panel chart-panel"><div className="panel-heading"><div><h3>Sales Trend</h3><p>နေ့စဉ် ရောင်းအား</p></div><span className="chart-legend"><i /> Revenue</span></div><div className="bar-chart">{trend.map((item) => <div className="bar-column" key={item.key}><div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(item.value ? 4 : 0, item.value / trendMax * 100)}%` }} title={money(item.value, settings.currency)} /></div><small>{item.label}</small></div>)}</div></div><div className="panel chart-panel"><div className="panel-heading"><div><h3>Category Revenue</h3><p>အမျိုးအစားအလိုက် ဝင်ငွေ</p></div><span className="subtle-count">{categoryStats.length} categories</span></div>{categoryStats.length === 0 ? <EmptyState icon={<BarChart3 size={23} />} title="Data မရှိသေးပါ" text="အရောင်းမှတ်တမ်း ရှိလာသည့်အခါ Chart ပြပါမယ်။" /> : <div className="category-bars">{categoryStats.map(([name, value], index) => <div className="category-bar-row" key={name}><div><span>{name}</span><b>{money(value, settings.currency)}</b></div><div className="category-track"><div style={{ width: `${categoryTotal ? value / categoryTotal * 100 : 0}%` }} className={`category-fill fill-${index % 5}`} /></div></div>)}</div>}</div></div><div className="panel analytics-note"><Activity size={18} /><div><strong>အချက်အလက်မှတ်ချက်</strong><p>Gross Profit ကို ရောင်းဈေး − သိမ်းထားသော ကုန်ကျစရိတ်ဖြင့်တွက်ပြီး Discount ကို နုတ်ထားပါတယ်။ ခန့်မှန်း Net Profit = Gross Profit − မှတ်တမ်းတင်ထားသော အသုံးစရိတ် ဖြစ်ပါတယ်။ အခွန်၊ ပစ္စည်းပျက်စီးဆုံးရှုံးမှုနှင့် မမှတ်တမ်းတင်ရသေးသော ကုန်ကျစရိတ်များ မပါဝင်နိုင်ပါ။</p></div></div></section>}

          {page === 'settings' && <section className="page-stack"><div className="section-heading"><div><h2>Settings & Data</h2><p>ဆိုင်အချက်အလက်၊ Admin PIN နှင့် Backup ကို စီမံပါ။</p></div></div><div className="settings-grid"><div className="panel form-panel"><div className="panel-heading"><div className="panel-icon"><Settings size={18} /></div><div><h3>Store Preferences</h3><p>Receipt နဲ့ POS မှာ အသုံးပြုမည့် အချက်အလက်များ</p></div></div><label>ဆိုင်အမည်<input value={settings.storeName} onChange={(e) => updateSettings({ storeName: e.target.value })} /></label><label>ငွေကြေးအတိုကောက်<input value={settings.currency} onChange={(e) => updateSettings({ currency: e.target.value.toUpperCase() || 'MMK' })} /></label><label>Receipt အောက်ခြေစာသား<input value={settings.receiptFooter} onChange={(e) => updateSettings({ receiptFooter: e.target.value })} /></label><label>Admin PIN အသစ်<input type="password" inputMode="numeric" value={settings.adminPin} onChange={(e) => updateSettings({ adminPin: e.target.value.replace(/\D/g, '').slice(0, 12) })} /><small className="field-hint">Default PIN: 1234။ စတင်အသုံးပြုပြီးသည်နှင့် ပြောင်းလဲပါ။</small></label></div><div className="panel form-panel"><div className="panel-heading"><div className="panel-icon"><FileJson size={18} /></div><div><h3>Backup & Restore</h3><p>Data ကို JSON ဖိုင်အဖြစ် သိမ်းပြီး ပြန်တင်နိုင်ပါတယ်။</p></div></div><div className="backup-card"><div><strong>Export Backup</strong><small>Products, Sales, Customer Credit, Payments, Suppliers, Purchases, Expiry Batches, Expenses, Cash Shifts နှင့် Activity Logs ပါဝင်မည်။</small></div><button className="button button-primary" onClick={exportBackup}><Download size={16} /> Export JSON</button></div><div className="backup-card"><div><strong>Import / Restore</strong><small>အရင် Export လုပ်ထားသော JSON ဖိုင်ကို ပြန်တင်ပါ။ လက်ရှိ Data ကို အစားထိုးပါမယ်။</small></div><button className="button button-outline" onClick={() => importRef.current?.click()}><ArrowDownToLine size={16} /> Choose File</button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importBackup(e.target.files?.[0])} /></div><div className="csv-export-row"><strong>CSV Report Export</strong><div><button className="button button-outline" onClick={exportProductsCsv}>Products CSV</button><button className="button button-outline" onClick={exportSalesCsv}>Sales CSV</button><button className="button button-outline" onClick={exportExpensesCsv}>Expenses CSV</button></div></div><div className="backup-warning"><AlertTriangle size={17} /><span>Backup ဖိုင်ကို ဖုန်းထဲတင်မကဘဲ အခြားလုံခြုံသောနေရာတွင်လည်း သိမ်းထားပါ။ Browser Data ရှင်းလိုက်လျှင် Local Data ပျောက်နိုင်ပါတယ်။</span></div><div className="danger-zone"><div><strong>Reset Local Data</strong><small>Products, Sales, Credit Ledger, Supplier, Purchase, Expiry Batch, Expenses, Cash Shifts နှင့် Activity Logs အားလုံးကို ဒီ Device မှ ဖယ်ရှားပါမယ်။</small></div><button className="button button-danger" onClick={() => { if (authorize('Data အားလုံး Reset လုပ်ရန်') && window.confirm('ဒီ Browser ထဲရှိ POS Data အားလုံးကို အပြီးဖျက်မလား။ Backup မရှိလျှင် ပြန်မရနိုင်ပါ။')) { clearAllData(); setCart([]); notify('Local Data အားလုံး Reset လုပ်ပြီးပါပြီ။'); } }}><Trash2 size={16} /> Reset</button></div></div></div><CloudSyncPanel /><div className="panel security-note"><LockKeyhole size={19} /><div><strong>လုံခြုံရေးနှင့် သိမ်းဆည်းမှုအကြောင်း</strong><p>ဒီဗားရှင်းမှာ PIN ကို Browser Local Storage ထဲမှာသာ စစ်ဆေးပါတယ်။ Shared device သို့မဟုတ် အင်တာနက်ကနေ Admin Access ကို လုံခြုံစွာကာကွယ်ပေးနိုင်တဲ့ Server-side Authentication မဟုတ်ပါ။ Firebase Cloud Sync ကို Settings မှာ Firebase Config ထည့်ပြီး Owner Account Login လုပ်မှ အသုံးပြုနိုင်ပါတယ်။ ဒီ PIN သည် UI Guard သာဖြစ်ပြီး Server-side Admin Permission မဟုတ်ပါ။</p></div></div></section>}
        </div>
      </main>

      <nav className="mobile-bottom-nav" aria-label="အဓိက မီနူး">
        <button type="button" className={page === 'dashboard' ? 'active' : ''} onClick={() => navTo('dashboard')}><LayoutDashboard size={19} /><span>ပင်မ</span></button>
        <button type="button" className={page === 'pos' ? 'active' : ''} onClick={() => navTo('pos')}><ShoppingCart size={19} /><span>အရောင်း</span>{cart.length > 0 && <b>{cart.length}</b>}</button>
        <button type="button" className={page === 'inventory' ? 'active' : ''} onClick={() => navTo('inventory')}><Boxes size={19} /><span>ပစ္စည်း</span></button>
        <button type="button" className={page === 'profile' ? 'active' : ''} onClick={() => navTo('profile')}><UserRound size={19} /><span>Profile</span></button>
      </nav>

      {showProductModal && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowProductModal(false); }}><form className="modal-card" onSubmit={saveProduct}><div className="modal-header"><div><h2>{editingProduct ? 'ပစ္စည်းပြင်ဆင်ရန်' : 'ပစ္စည်းအသစ်ထည့်ရန်'}</h2><p>အရင်းဈေး၊ လက်လီရောင်းဈေးနှင့် လက်ကားရောင်းဈေးကို ကိုယ်တိုင်ထည့်နိုင်ပါတယ်။</p></div><button className="icon-btn" type="button" onClick={() => setShowProductModal(false)}><X size={19} /></button></div><div className="form-grid"><label className="span-2">ပစ္စည်းအမည် *<input required value={productDraft.name} onChange={(e) => setProductDraft({ ...productDraft, name: e.target.value })} placeholder="ဥပမာ - Drinking Water" /></label><label>SKU / Barcode<input value={productDraft.sku} onChange={(e) => setProductDraft({ ...productDraft, sku: e.target.value })} placeholder="မဖြည့်လည်းရပါတယ်" /></label><label>Category<select value={productDraft.category} onChange={(e) => { if (e.target.value === '__add_category__') { const name = window.prompt('Category အသစ်အမည်'); if (name?.trim()) { if (addCategory(name.trim())) { setProductDraft((current) => ({ ...current, category: name.trim() })); notify('Category အသစ် ထည့်ပြီးပါပြီ။'); } else notify('Category အမည် ရှိပြီးသား သို့မဟုတ် မမှန်ကန်ပါ။'); } } else setProductDraft({ ...productDraft, category: e.target.value }); }}><option value="">Category ရွေးပါ</option>{categories.map((category) => <option key={category}>{category}</option>)}<option value="__add_category__">＋ Category အသစ်ထည့်ရန်</option></select></label><label>အရင်းဈေး (Cost Price)<input type="number" min="0" value={productDraft.costPrice} onChange={(e) => setProductDraft({ ...productDraft, costPrice: e.target.value })} /></label><label>လက်လီရောင်းဈေး (Retail Price)<input type="number" min="0" value={productDraft.retailPrice} onChange={(e) => setProductDraft({ ...productDraft, retailPrice: e.target.value })} /></label><label>လက်ကားရောင်းဈေး (Wholesale Price)<input type="number" min="0" value={productDraft.wholesalePrice} onChange={(e) => setProductDraft({ ...productDraft, wholesalePrice: e.target.value })} /></label><label>လက်ကျန် Stock<input type="number" min="0" step={quantityStep(productDraft.quantityMode)} value={productDraft.stock} onChange={(e) => setProductDraft({ ...productDraft, stock: e.target.value })} /></label><label>Low Stock Alert<input type="number" min="0" step={quantityStep(productDraft.quantityMode)} value={productDraft.lowStockAt} onChange={(e) => setProductDraft({ ...productDraft, lowStockAt: e.target.value })} /></label><label>Unit<input value={productDraft.unit} onChange={(e) => setProductDraft({ ...productDraft, unit: e.target.value, quantityMode: inferQuantityMode(e.target.value) })} placeholder="ခု / ဘူး / ထုပ် / kg / L" /></label><label>အရေအတွက်တွက်ချက်ပုံ<select value={productDraft.quantityMode} onChange={(e) => setProductDraft({ ...productDraft, quantityMode: e.target.value as QuantityMode })}><option value="whole">ပြည့်ကိန်းသာ (ခု / ဘူး / ထုပ်)</option><option value="decimal">ဒသမခွင့်ပြု (kg / L / m)</option></select></label></div><div className="modal-actions"><button className="button button-outline" type="button" onClick={() => setShowProductModal(false)}>ပယ်ဖျက်</button><button className="button button-primary" type="submit"><Check size={16} /> သိမ်းဆည်းမည်</button></div></form></div>}

      {lastSale && <div className="receipt-print-area"><div className="receipt-paper">{activeBranchLogoSource && <img className="receipt-shop-logo" src={activeBranchLogoSource} alt="Shop logo" />}<h2>{activeBranch?.name || settings.storeName}</h2>{activeBranch?.settings.receiptHeader && <p className="receipt-shop-extra">{activeBranch.settings.receiptHeader}</p>}{activeBranch?.address && <p>{activeBranch.address}</p>}{activeBranch?.phone && <p>ဖုန်း: {activeBranch.phone}</p>}<p>Voucher: {lastSale.receiptNo}</p><p>{dateLabel(lastSale.date)}</p><p>Customer: {lastSale.customer}</p><hr />{lastSale.items.map((item) => <div className="receipt-item" key={item.productId}><span>{item.name} × {formatQuantity(item.quantity, productMap.get(item.productId) ? quantityModeForProduct(productMap.get(item.productId)!) : 'whole')}</span><b>{money(item.unitPrice * item.quantity, settings.currency)}</b></div>)}<hr /><div className="receipt-total"><span>Subtotal</span><b>{money(lastSale.subtotal, settings.currency)}</b></div><div className="receipt-total"><span>Discount</span><b>{money(lastSale.discount, settings.currency)}</b></div><div className="receipt-total receipt-grand"><span>Total</span><b>{money(lastSale.total, settings.currency)}</b></div><p>Payment: {lastSale.paymentMethod}</p><p>Paid: {money(lastSale.paidAmount ?? (lastSale.paymentMethod === 'Cash' ? lastSale.total : 0), settings.currency)}</p><p>Due: {money(lastSale.dueAmount ?? (lastSale.paymentMethod === 'Credit' ? lastSale.total : 0), settings.currency)}</p><p className="receipt-footer">{settings.receiptFooter}</p></div></div>}
      {toast && <div className="toast"><Check size={17} /> {toast}</div>}
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
  const productCountLabel = `${productCount} items`;
  return <section className="page-stack"><div className={`welcome-banner${bannerSource ? ' has-shop-banner' : ''}`}>{bannerSource && <img className="welcome-banner-image" src={bannerSource} alt="Shop banner" />}<div className="welcome-banner-copy"><span className="welcome-kicker">GOOD BUSINESS STARTS HERE</span><h2>မင်္ဂလာပါ 👋</h2><p>{settings.storeName} ရဲ့ ယနေ့လုပ်ငန်းအခြေအနေကို ကြည့်ရှုနိုင်ပါတယ်။</p></div><div className="welcome-decoration"><Store size={48} /></div></div><div className="dashboard-stats"><div className="metric-card metric-primary"><div className="metric-head"><span>ယနေ့ ရောင်းအား</span><div><TrendingUp size={17} /></div></div><strong>{money(todayRevenue, settings.currency)}</strong><small>{todayCount} transactions today</small><div className="metric-foot"><ArrowUpRight size={14} /> Today’s sales revenue</div></div><div className="metric-card"><div className="metric-head"><span>ယနေ့ ခန့်မှန်းအမြတ်</span><div><CircleDollarSign size={17} /></div></div><strong>{money(todayProfit, settings.currency)}</strong><small>Discount ပါဝင်ပြီး</small><div className="metric-foot">Gross profit estimate</div></div><div className="metric-card"><div className="metric-head"><span>ပစ္စည်းအမျိုးအစား</span><div><Boxes size={17} /></div></div><strong>{productCountLabel}</strong><small>လက်ကျန်ရှိသော Product {totalStockUnits} မျိုး</small><div className="metric-foot">Inventory overview</div></div><div className="metric-card"><div className="metric-head"><span>Stock သတိပေးချက်</span><div className="metric-alert"><AlertTriangle size={17} /></div></div><strong>{lowStockProducts.length} items</strong><small>ပြန်လည်မှာယူရန် စစ်ဆေးပါ</small><button className="metric-link" onClick={() => navTo('inventory')}>Inventory ကြည့်ရန် <ArrowUpRight size={13} /></button></div></div><div className="dashboard-grid"><div className="panel chart-panel"><div className="panel-heading"><div><h3>Sales Overview</h3><p>နေ့စဉ် ရောင်းအား အခြေအနေ</p></div><div className="period-switch"><button className={chartPeriod === '7' ? 'active' : ''} onClick={() => setChartPeriod('7')}>7D</button><button className={chartPeriod === '30' ? 'active' : ''} onClick={() => setChartPeriod('30')}>30D</button><button className={chartPeriod === '365' ? 'active' : ''} onClick={() => setChartPeriod('365')}>12M</button></div></div><div className="bar-chart dashboard-chart">{trend.map((item) => <div className="bar-column" key={item.key}><div className="bar-track"><div className="bar-fill" style={{ height: `${Math.max(item.value ? 4 : 0, item.value / trendMax * 100)}%` }} title={money(item.value, settings.currency)} /></div><small>{item.label}</small></div>)}</div></div><div className="panel low-stock-panel"><div className="panel-heading"><div><h3>Low Stock Alert</h3><p>လက်ကျန်နည်းနေသောပစ္စည်း</p></div><AlertTriangle className="warning-text" size={18} /></div>{lowStockProducts.length === 0 ? <EmptyState icon={<Check size={23} />} title="အားလုံး အဆင်ပြေပါတယ်" text="Stock နည်းနေသော ပစ္စည်းမရှိပါ။" /> : <div className="low-stock-list">{lowStockProducts.slice(0, 5).map((product) => <div className="low-stock-row" key={product.id}><div className="table-product-icon"><ShoppingBag size={16} /></div><div><strong>{product.name}</strong><small>{product.sku}</small></div><b className="stock-warning">{formatQuantity(sellableStock(product), quantityModeForProduct(product))} {product.unit} ရောင်းနိုင်</b></div>)}</div>}<button className="panel-link" onClick={() => navTo('inventory')}>Inventory အားလုံးကြည့်ရန် <ArrowUpRight size={14} /></button></div></div><div className="panel recent-panel"><div className="panel-heading"><div><h3>Recent Transactions</h3><p>နောက်ဆုံး အရောင်းမှတ်တမ်းများ</p></div><button className="text-button" onClick={() => navTo('sales')}>အားလုံးကြည့်ရန် <ArrowUpRight size={14} /></button></div>{recentSales.length === 0 ? <EmptyState icon={<Receipt size={23} />} title="အရောင်းမှတ်တမ်း မရှိသေးပါ" text="POS မှာ ပထမဆုံး အရောင်းပြုလုပ်လိုက်ပါ။" action="POS သို့သွားရန်" onAction={() => navTo('pos')} /> : <div className="table-wrap"><table><thead><tr><th>Voucher</th><th>Customer</th><th>အချိန်</th><th>Payment</th><th>စုစုပေါင်း</th><th>Status</th></tr></thead><tbody>{recentSales.map((sale) => <tr key={sale.id}><td><strong className="mono">{sale.receiptNo}</strong></td><td>{sale.customer}</td><td>{dateLabel(sale.date)}</td><td><span className={`tag ${sale.paymentMethod === 'Credit' ? 'tag-warn' : ''}`}>{sale.paymentMethod}</span></td><td><b>{money(sale.total, settings.currency)}</b></td><td><span className="tag tag-success">Completed</span></td></tr>)}</tbody></table></div>}</div></section>;
}

export default App;
