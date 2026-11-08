import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Building2, CalendarClock, CheckCircle2, ClipboardList, Contact, CreditCard, PackagePlus, Plus, Truck, Users, Wallet } from 'lucide-react';
import { usePosStore } from '../store/usePosStore';
import { formatQuantity, isValidQuantity, quantityModeForProduct, quantityStep } from '../lib/quantity';

const money = (value: number, currency = 'MMK') => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value || 0))} ${currency}`;
const dateLabel = (value: string) => value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const daysUntil = (value: string) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(`${value}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
};

export function CustomerCreditPage() {
  const customers = usePosStore((state) => state.customers);
  const branches = usePosStore((state) => state.branches);
  const allSales = usePosStore((state) => state.sales);
  const allPayments = usePosStore((state) => state.customerPayments);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const activeBranch = branches.find((branch) => branch.id === activeBranchId);
  const sales = useMemo(() => allSales.filter((sale) => sale.branchId === activeBranchId), [allSales, activeBranchId]);
  const payments = useMemo(() => allPayments.filter((payment) => payment.branchId === activeBranchId), [allPayments, activeBranchId]);
  const settings = usePosStore((state) => state.settings);
  const addCustomer = usePosStore((state) => state.addCustomer);
  const updateCustomer = usePosStore((state) => state.updateCustomer);
  const addCustomerPayment = usePosStore((state) => state.addCustomerPayment);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [saleId, setSaleId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Transfer'>('Cash');
  const [query, setQuery] = useState('');

  const openInvoices = useMemo(() => sales.filter((sale) => sale.status === 'completed' && sale.paymentMethod === 'Credit' && (sale.dueAmount ?? Math.max(0, sale.total - (sale.paidAmount ?? 0))) > 0), [sales]);
  const selectedSale = openInvoices.find((sale) => sale.id === saleId);
  const currentBranchDue = openInvoices.reduce((sum, sale) => sum + (sale.dueAmount ?? Math.max(0, sale.total - (sale.paidAmount ?? 0))), 0);
  const allBranchesDue = allSales.filter((sale) => sale.status === 'completed' && sale.paymentMethod === 'Credit').reduce((sum, sale) => sum + Math.max(0, sale.dueAmount ?? (sale.total - (sale.paidAmount ?? 0))), 0);
  const filteredCustomers = customers.filter((customer) => `${customer.name} ${customer.phone} ${customer.address}`.toLowerCase().includes(query.toLowerCase()));
  const branchLedger = branches.map((branch) => {
    const branchSales = allSales.filter((sale) => sale.branchId === branch.id && sale.status === 'completed');
    const creditSales = branchSales.filter((sale) => sale.paymentMethod === 'Credit');
    const due = creditSales.reduce((sum, sale) => sum + Math.max(0, sale.dueAmount ?? (sale.total - (sale.paidAmount ?? 0))), 0);
    const received = allPayments.filter((payment) => payment.branchId === branch.id).reduce((sum, payment) => sum + payment.amount, 0);
    return { branch, invoiceCount: creditSales.length, salesTotal: creditSales.reduce((sum, sale) => sum + sale.total, 0), due, received };
  });

  const editCustomer = (customer: (typeof customers)[number]) => {
    const nextName = window.prompt('Customer အမည်', customer.name);
    if (nextName === null || !nextName.trim()) return;
    const nextPhone = window.prompt('ဖုန်းနံပါတ်', customer.phone); if (nextPhone === null) return;
    const nextAddress = window.prompt('လိပ်စာ', customer.address); if (nextAddress === null) return;
    const nextNote = window.prompt('မှတ်ချက်', customer.note); if (nextNote === null) return;
    if (!updateCustomer(customer.id, { name: nextName.trim(), phone: nextPhone.trim(), address: nextAddress.trim(), note: nextNote.trim() })) {
      window.alert('ဒီဖုန်းနံပါတ် သို့မဟုတ် Customer အချက်အလက်နဲ့ တူညီတဲ့ Shared Customer ရှိပြီးသားပါ။ ရှိပြီးသား Customer ကို ပြင်ဆင်အသုံးပြုပါ။');
    }
  };

  const addCustomerSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const createdId = addCustomer({ name: name.trim(), phone: phone.trim(), address: address.trim(), note: note.trim() });
    if (!createdId) {
      window.alert('ဒီဖုန်းနံပါတ် သို့မဟုတ် အမည်/လိပ်စာနဲ့ တူညီတဲ့ Customer ရှိပြီးသားပါ။ Customer စာရင်းထဲက ရှိပြီးသား Profile ကို ရွေးအသုံးပြုပါ။');
      return;
    }
    setName(''); setPhone(''); setAddress(''); setNote('');
  };
  const receivePaymentSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!selectedSale || !(value > 0)) return;
    const customerId = selectedSale.customerId;
    if (!customerId) return;
    const due = Math.max(0, selectedSale.dueAmount ?? (selectedSale.total - (selectedSale.paidAmount ?? 0)));
    if (value > due) { window.alert('လက်ခံငွေသည် ဒီဆိုင် Invoice ရဲ့ ကျန်အကြွေးထက် မပိုရပါ။'); return; }
    const saved = addCustomerPayment({ customerId, saleId: selectedSale.id, amount: value, date: new Date().toISOString(), note: paymentNote.trim(), paymentMethod });
    if (!saved) { window.alert('အကြွေးပြန်ဆပ်ငွေ မသိမ်းနိုင်ပါ။ Invoice နှင့် ကျန်ငွေကို ပြန်စစ်ပါ။'); return; }
    setAmount(''); setPaymentNote(''); setPaymentMethod('Cash'); setSaleId('');
  };

  return <section className="page-stack">
    <div className="section-heading"><div><h2>Shared Customer & Credit Ledger</h2><p>Customer Profile ကို ဆိုင်အားလုံး မျှဝေပြီး အကြွေးနှင့် ငွေလက်ခံမှုကို ဆိုင်အလိုက် သီးခြားမှတ်တမ်းတင်ပါမယ်။</p></div><div className="sales-summary-chip"><Wallet size={16} /> လက်ရှိဆိုင် {money(currentBranchDue, settings.currency)}</div></div>
    <div className="mini-stats">
      <div className="mini-stat"><div className="mini-stat-icon"><Users size={17} /></div><div><small>Shared Customer စုစုပေါင်း</small><strong>{customers.length}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon"><CreditCard size={17} /></div><div><small>လက်ရှိဆိုင် မဆပ်ရသေးသော Invoice</small><strong>{openInvoices.length}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon warning"><Wallet size={17} /></div><div><small>ဆိုင်အားလုံး အကြွေးစုစုပေါင်း</small><strong>{money(allBranchesDue, settings.currency)}</strong></div></div>
    </div>
    <div className="business-grid">
      <form className="panel form-panel" onSubmit={addCustomerSubmit}>
        <div className="panel-heading"><div className="panel-icon"><Contact size={18} /></div><div><h3>Shared Customer အသစ်ထည့်ရန်</h3><p>ဒီ Profile ကို ဆိုင်အားလုံးက ရှာဖွေရွေးချယ်နိုင်ပါတယ်။</p></div></div>
        <label>အမည် *<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer အမည်" /></label>
        <label>ဖုန်းနံပါတ်<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="မဖြစ်မနေ မဟုတ်ပါ" /></label>
        <label>လိပ်စာ<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="မြို့နယ် / လိပ်စာ" /></label>
        <label>မှတ်ချက်<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="မှတ်ချက်" /></label>
        <button className="button button-primary" type="submit"><Plus size={15} /> Customer သိမ်းဆည်းရန်</button>
        <small className="field-hint">ဖုန်းနံပါတ်တူသော Customer အသစ် ထပ်မဖန်တီးနိုင်ပါ။</small>
      </form>
      <form className="panel form-panel" onSubmit={receivePaymentSubmit}>
        <div className="panel-heading"><div className="panel-icon"><Wallet size={18} /></div><div><h3>အကြွေးပြန်ဆပ်ငွေ လက်ခံရန်</h3><p>{activeBranch?.name || 'လက်ရှိဆိုင်'} ရဲ့ Invoice ကိုသာ ငွေလက်ခံနိုင်ပါတယ်။</p></div></div>
        <label>မဆပ်ရသေးသော Invoice *<select required value={saleId} onChange={(event) => { setSaleId(event.target.value); setAmount(''); }}><option value="">Invoice ရွေးပါ</option>{openInvoices.map((sale) => <option key={sale.id} value={sale.id}>{sale.customer} · {sale.receiptNo} · {money(sale.dueAmount ?? sale.total, settings.currency)}</option>)}</select></label>
        {selectedSale && <div className="ledger-balance"><span>ဒီဆိုင် Invoice ကျန်ငွေ</span><strong>{money(selectedSale.dueAmount ?? selectedSale.total, settings.currency)}</strong></div>}
        <label>လက်ခံငွေ ပမာဏ *<input required type="number" min="1" max={selectedSale?.dueAmount ?? selectedSale?.total ?? undefined} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
        <label>ငွေလက်ခံနည်း<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'Cash' | 'Transfer')}><option value="Cash">Cash</option><option value="Transfer">Bank / Mobile Transfer</option></select></label>
        <label>မှတ်ချက်<input value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="ငွေလက်ခံမှတ်ချက်" /></label>
        <button className="button button-primary" type="submit" disabled={!selectedSale || !(Number(amount) > 0)}><CheckCircle2 size={15} /> ငွေလက်ခံမှု သိမ်းရန်</button>
        <small className="field-hint">အကြွေးပြန်ဆပ်ငွေကို ရွေးထားသော Branch ရဲ့ Cash Shift ထဲမှာသာ မှတ်တမ်းတင်ပါမယ်။</small>
      </form>
    </div>
    <div className="panel">
      <div className="panel-heading"><div><h3>Customer စာရင်း — Shared Directory</h3><p>Profile တစ်ခုတည်းကို ဆိုင်အားလုံး အသုံးပြုနိုင်ပြီး အကြွေးကို သီးခြားတွက်ထားပါတယ်။</p></div><input className="inline-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="အမည် / ဖုန်း ရှာရန်" /></div>
      {filteredCustomers.length === 0 ? <div className="empty-state"><div className="empty-icon"><Users size={23} /></div><strong>Customer မရှိသေးပါ</strong><p>Customer အသစ်ထည့်ခြင်း သို့မဟုတ် Credit Sale လုပ်ပြီးနောက် ဒီနေရာမှာ ပြပါမယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>ဖုန်း</th><th>လက်ရှိဆိုင် Invoice</th><th>လက်ရှိဆိုင် အကြွေး</th><th>ဆိုင်အားလုံး အကြွေး</th><th>လုပ်ဆောင်ချက်</th></tr></thead><tbody>{filteredCustomers.map((customer) => {
        const currentCustomerSales = sales.filter((sale) => sale.customerId === customer.id && sale.status === 'completed');
        const allCustomerSales = allSales.filter((sale) => sale.customerId === customer.id && sale.status === 'completed');
        const currentDue = currentCustomerSales.reduce((sum, sale) => sum + Math.max(0, sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total - (sale.paidAmount ?? 0) : 0)), 0);
        const allDue = allCustomerSales.reduce((sum, sale) => sum + Math.max(0, sale.dueAmount ?? (sale.paymentMethod === 'Credit' ? sale.total - (sale.paidAmount ?? 0) : 0)), 0);
        return <tr key={customer.id}><td><div className="table-product"><div className="table-product-icon"><Users size={15} /></div><div><strong>{customer.name}</strong><small>{customer.address || customer.note || '—'}</small></div></div></td><td>{customer.phone || '—'}</td><td>{currentCustomerSales.filter((sale) => sale.paymentMethod === 'Credit').length}</td><td><b className={currentDue > 0 ? 'stock-warning' : 'stock-ok'}>{money(currentDue, settings.currency)}</b></td><td><b className={allDue > 0 ? 'stock-warning' : 'stock-ok'}>{money(allDue, settings.currency)}</b></td><td><button className="small-action" onClick={() => editCustomer(customer)}>ပြင်ရန်</button></td></tr>;
      })}</tbody></table></div>}
    </div>
    <div className="panel"><div className="panel-heading"><div><h3>ဆိုင်အလိုက် Customer Ledger အကျဉ်းချုပ်</h3><p>Customer Profile တူညီသော်လည်း Invoice နှင့် ငွေလက်ခံမှုကို Branch တစ်ခုချင်းစီ ခွဲထားပါတယ်။</p></div><span className="subtle-count">{branches.length} branches</span></div>
      <div className="table-wrap"><table><thead><tr><th>ဆိုင်</th><th>Credit Invoice</th><th>Credit ရောင်းချတန်ဖိုး</th><th>ပြန်ဆပ်လက်ခံပြီး</th><th>အကြွေးကျန်</th></tr></thead><tbody>{branchLedger.map((row) => <tr key={row.branch.id}><td><b>{row.branch.name}</b>{row.branch.id === activeBranchId && <small>လက်ရှိဆိုင်</small>}{row.branch.status === 'archived' && <small>Archive</small>}</td><td>{row.invoiceCount}</td><td>{money(row.salesTotal, settings.currency)}</td><td>{money(row.received, settings.currency)}</td><td><b className={row.due > 0 ? 'stock-warning' : 'stock-ok'}>{money(row.due, settings.currency)}</b></td></tr>)}</tbody></table></div>
    </div>
    <div className="panel">
      <div className="panel-heading"><div><h3>လက်ရှိဆိုင်၏ ငွေလက်ခံမှတ်တမ်း</h3><p>{activeBranch?.name || 'လက်ရှိဆိုင်'} အတွက်သာ ပြသထားပါတယ်။</p></div><span className="subtle-count">{payments.length} payments</span></div>
      {payments.length === 0 ? <div className="empty-state"><div className="empty-icon"><ClipboardList size={23} /></div><strong>ငွေလက်ခံမှတ်တမ်း မရှိသေးပါ</strong><p>အပေါ်က Form မှာ အကြွေးပြန်ဆပ်ငွေကို မှတ်တမ်းတင်နိုင်ပါတယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>ရက်စွဲ</th><th>Customer</th><th>Voucher</th><th>ပမာဏ</th><th>ငွေလက်ခံနည်း</th><th>မှတ်ချက်</th></tr></thead><tbody>{payments.slice(0, 30).map((payment) => <tr key={payment.id}><td>{dateLabel(payment.date)}</td><td>{customers.find((customer) => customer.id === payment.customerId)?.name || 'Customer'}</td><td>{sales.find((sale) => sale.id === payment.saleId)?.receiptNo || '—'}</td><td><b className="stock-ok">{money(payment.amount, settings.currency)}</b></td><td>{payment.paymentMethod || 'Cash (Legacy)'}</td><td>{payment.note || '—'}</td></tr>)}</tbody></table></div>}
    </div>
  </section>;
}

export function SupplierPurchasePage() {
  const allProducts = usePosStore((state) => state.products);
  const suppliers = usePosStore((state) => state.suppliers);
  const allPurchases = usePosStore((state) => state.purchases);
  const allSupplierPayments = usePosStore((state) => state.supplierPayments);
  const allPurchaseReturns = usePosStore((state) => state.purchaseReturns);
  const allStockBatches = usePosStore((state) => state.stockBatches);
  const stockUnitRegistries = usePosStore((state) => state.stockUnitRegistries);
  const branches = usePosStore((state) => state.branches);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const activeBranch = branches.find((branch) => branch.id === activeBranchId);
  const products = useMemo(() => allProducts.filter((entry) => entry.branchId === activeBranchId), [allProducts, activeBranchId]);
  const purchases = useMemo(() => allPurchases.filter((entry) => entry.branchId === activeBranchId), [allPurchases, activeBranchId]);
  const supplierPayments = useMemo(() => allSupplierPayments.filter((entry) => entry.branchId === activeBranchId), [allSupplierPayments, activeBranchId]);
  const purchaseReturns = useMemo(() => allPurchaseReturns.filter((entry) => entry.branchId === activeBranchId), [allPurchaseReturns, activeBranchId]);
  const stockBatches = useMemo(() => allStockBatches.filter((entry) => entry.branchId === activeBranchId), [allStockBatches, activeBranchId]);
  const settings = usePosStore((state) => state.settings);
  const addSupplier = usePosStore((state) => state.addSupplier);
  const updateSupplier = usePosStore((state) => state.updateSupplier);
  const addPurchase = usePosStore((state) => state.addPurchase);
  const addSupplierPayment = usePosStore((state) => state.addSupplierPayment);
  const addPurchaseReturn = usePosStore((state) => state.addPurchaseReturn);
  const [supplierName, setSupplierName] = useState('');
  const [supplierPhone, setSupplierPhone] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [supplierNote, setSupplierNote] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [purchaseNote, setPurchaseNote] = useState('');
  const [initialPaidAmount, setInitialPaidAmount] = useState('0');
  const [initialPaymentMethod, setInitialPaymentMethod] = useState<'Cash' | 'Transfer'>('Cash');
  const [paymentPurchaseId, setPaymentPurchaseId] = useState('');
  const [supplierPaymentAmount, setSupplierPaymentAmount] = useState('');
  const [supplierPaymentMethod, setSupplierPaymentMethod] = useState<'Cash' | 'Transfer'>('Cash');
  const [supplierPaymentNote, setSupplierPaymentNote] = useState('');
  const [returnPurchaseId, setReturnPurchaseId] = useState('');
  const [returnQuantity, setReturnQuantity] = useState('1');
  const [returnNote, setReturnNote] = useState('');

  const getPurchasePaid = (purchaseId: string) => supplierPayments.filter((payment) => payment.purchaseId === purchaseId).reduce((sum, payment) => sum + payment.amount, 0);
  const getPurchaseReturned = (purchaseId: string) => purchaseReturns.filter((entry) => entry.purchaseId === purchaseId).reduce((sum, entry) => sum + entry.total, 0);
  const getPurchaseDue = (purchase: (typeof purchases)[number]) => purchase.paymentTracking === 'tracked'
    ? purchase.total - getPurchasePaid(purchase.id) - getPurchaseReturned(purchase.id)
    : null;
  const trackedPurchases = purchases.filter((purchase) => purchase.paymentTracking === 'tracked');
  const outstandingInvoices = trackedPurchases.filter((purchase) => (getPurchaseDue(purchase) ?? 0) > 0);
  const returnablePurchases = purchases.filter((purchase) => (stockBatches.find((batch) => batch.purchaseId === purchase.id)?.quantity ?? 0) > 0);
  const selectedPurchaseProduct = products.find((product) => product.id === productId);
  const selectedPaymentPurchase = outstandingInvoices.find((purchase) => purchase.id === paymentPurchaseId);
  const selectedReturnPurchase = returnablePurchases.find((purchase) => purchase.id === returnPurchaseId);
  const selectedReturnProduct = selectedReturnPurchase ? products.find((product) => product.id === selectedReturnPurchase.productId) : undefined;
  const selectedReturnBatch = selectedReturnPurchase ? stockBatches.find((batch) => batch.purchaseId === selectedReturnPurchase.id) : undefined;
  const purchaseTotal = purchases.reduce((sum, purchase) => sum + purchase.total, 0);
  const outstandingTotal = trackedPurchases.reduce((sum, purchase) => sum + Math.max(0, getPurchaseDue(purchase) ?? 0), 0);
  const supplierCreditTotal = trackedPurchases.reduce((sum, purchase) => sum + Math.max(0, -(getPurchaseDue(purchase) ?? 0)), 0);
  const getGlobalPaid = (purchaseId: string) => allSupplierPayments.filter((payment) => payment.purchaseId === purchaseId).reduce((sum, payment) => sum + payment.amount, 0);
  const getGlobalReturned = (purchaseId: string) => allPurchaseReturns.filter((entry) => entry.purchaseId === purchaseId).reduce((sum, entry) => sum + entry.total, 0);
  const globalTrackedPurchases = allPurchases.filter((purchase) => purchase.paymentTracking === 'tracked');
  const globalOutstanding = globalTrackedPurchases.reduce((sum, purchase) => sum + Math.max(0, purchase.total - getGlobalPaid(purchase.id) - getGlobalReturned(purchase.id)), 0);
  const branchLedger = branches.map((branch) => {
    const rows = allPurchases.filter((purchase) => purchase.branchId === branch.id && purchase.paymentTracking === 'tracked');
    const total = rows.reduce((sum, purchase) => sum + purchase.total, 0);
    const paid = rows.reduce((sum, purchase) => sum + getGlobalPaid(purchase.id), 0);
    const returned = rows.reduce((sum, purchase) => sum + getGlobalReturned(purchase.id), 0);
    return { branch, purchaseCount: rows.length, total, paid, returned, due: total - paid - returned };
  });

  const editSupplier = (supplier: (typeof suppliers)[number]) => {
    const nextName = window.prompt('Supplier အမည်', supplier.name);
    if (nextName === null || !nextName.trim()) return;
    const nextPhone = window.prompt('ဖုန်းနံပါတ်', supplier.phone); if (nextPhone === null) return;
    const nextAddress = window.prompt('လိပ်စာ', supplier.address); if (nextAddress === null) return;
    const nextNote = window.prompt('မှတ်ချက်', supplier.note); if (nextNote === null) return;
    if (!updateSupplier(supplier.id, { name: nextName.trim(), phone: nextPhone.trim(), address: nextAddress.trim(), note: nextNote.trim() })) window.alert('ဒီဖုန်းနံပါတ် သို့မဟုတ် Supplier အချက်အလက်နဲ့ တူညီတဲ့ Shared Supplier ရှိပြီးသားပါ။');
  };
  const addSupplierSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!supplierName.trim()) return;
    const createdId = addSupplier({ name: supplierName.trim(), phone: supplierPhone.trim(), address: supplierAddress.trim(), note: supplierNote.trim() });
    if (!createdId) { window.alert('ဒီဖုန်းနံပါတ် သို့မဟုတ် အမည်/လိပ်စာနဲ့ တူညီတဲ့ Supplier ရှိပြီးသားပါ။ ရှိပြီးသား Shared Supplier ကို ရွေးအသုံးပြုပါ။'); return; }
    setSupplierName(''); setSupplierPhone(''); setSupplierAddress(''); setSupplierNote('');
  };
  const addPurchaseSubmit = (event: FormEvent) => {
    event.preventDefault();
    const qty = Number(quantity); const cost = Number(unitCost);
    const paid = Number(initialPaidAmount);
    const product = products.find((entry) => entry.id === productId);
    const total = qty * cost;
    if (!product || !isValidQuantity(qty, quantityModeForProduct(product)) || !(cost >= 0) || !Number.isFinite(paid) || paid < 0 || paid > total) { window.alert('အရေအတွက်ကို ပစ္စည်းယူနစ်အလိုက် မှန်ကန်စွာ ထည့်ပါ။'); return; }
    if (stockUnitRegistries.some((registry) => registry.branchId === activeBranchId && registry.productId === product.id && registry.units.length > 0)) { window.alert('ဒီ Product မှာ Barcode Sticker တစ်ခုချင်းစီ စာရင်းသွင်းထားပြီးပါပြီ။ Quantity နဲ့ Purchase ထပ်မထည့်နိုင်ပါ။ Stock Receiving ထဲက ပုံမှန် Quantity လက်ခံမှုအစား Sticker Scan Registration ကို အသုံးပြုပါ။'); return; }
    const supplier = suppliers.find((entry) => entry.id === supplierId);
    addPurchase({ supplierId, supplierName: supplier?.name || 'အထွေထွေ Supplier', productId, productName: product.name, quantity: qty, unitCost: cost, expiryDate, note: purchaseNote.trim(), initialPaidAmount: paid, paymentMethod: initialPaymentMethod });
    setQuantity('1'); setUnitCost(''); setExpiryDate(''); setPurchaseNote(''); setInitialPaidAmount('0');
  };
  const supplierPaymentSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(supplierPaymentAmount);
    if (!selectedPaymentPurchase || !(value > 0)) return;
    const saved = addSupplierPayment({ supplierId: selectedPaymentPurchase.supplierId, purchaseId: selectedPaymentPurchase.id, amount: value, date: new Date().toISOString(), paymentMethod: supplierPaymentMethod, note: supplierPaymentNote.trim() });
    if (!saved) { window.alert('ပေးချေငွေ မသိမ်းနိုင်ပါ။ Invoice ကျန်ငွေနှင့် လက်ရှိဆိုင်ကို ပြန်စစ်ပါ။'); return; }
    setSupplierPaymentAmount(''); setSupplierPaymentNote(''); setSupplierPaymentMethod('Cash');
  };
  const purchaseReturnSubmit = (event: FormEvent) => {
    event.preventDefault();
    const qty = Number(returnQuantity);
    const returnProduct = selectedReturnPurchase ? products.find((product) => product.id === selectedReturnPurchase.productId) : undefined;
    if (!selectedReturnPurchase || !selectedReturnBatch || !returnProduct || !isValidQuantity(qty, quantityModeForProduct(returnProduct)) || qty > selectedReturnBatch.quantity) return;
    if (stockUnitRegistries.some((registry) => registry.branchId === activeBranchId && registry.productId === returnProduct.id && registry.units.some((unit) => unit.status === 'in_stock' || unit.status === 'reserved'))) { window.alert('ဒီ Product မှာ Unit Barcode Tracking အသုံးပြုနေပါတယ်။ Barcode တစ်ခုချင်း Supplier Return မလုပ်နိုင်သေးတဲ့အတွက် စာရင်းမပြောင်းလဲထားပါ။'); return; }
    if (!window.confirm(`${selectedReturnPurchase.productName} ${qty} ခုကို Supplier သို့ ပြန်ပို့မလား။ Stock လျှော့ပြီး Supplier လက်ကျန်ကို ပြန်တွက်ပါမယ်။`)) return;
    addPurchaseReturn(selectedReturnPurchase.id, qty, returnNote);
    setReturnQuantity('1'); setReturnNote('');
  };

  return <section className="page-stack">
    <div className="section-heading"><div><h2>Shared Supplier & Branch Ledger</h2><p>Supplier Profile ကို ဆိုင်အားလုံး မျှဝေပြီး Purchase၊ ပေးချေမှုနှင့် ပြန်ပို့မှုကို ဆိုင်အလိုက် ခွဲထားပါတယ်။</p></div><div className="sales-summary-chip"><Truck size={16} /> {activeBranch?.name || 'လက်ရှိဆိုင်'} {money(purchaseTotal, settings.currency)}</div></div>
    <div className="mini-stats">
      <div className="mini-stat"><div className="mini-stat-icon"><Truck size={17} /></div><div><small>Supplier စုစုပေါင်း</small><strong>{suppliers.length}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon"><PackagePlus size={17} /></div><div><small>Purchase မှတ်တမ်း</small><strong>{purchases.length}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon warning"><Wallet size={17} /></div><div><small>လက်ရှိဆိုင် ပေးရန်ကျန်</small><strong>{money(outstandingTotal, settings.currency)}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon warning"><Building2 size={17} /></div><div><small>ဆိုင်အားလုံး ပေးရန်ကျန်</small><strong>{money(globalOutstanding, settings.currency)}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon"><CheckCircle2 size={17} /></div><div><small>Supplier Credit</small><strong>{money(supplierCreditTotal, settings.currency)}</strong></div></div>
    </div>
    <div className="business-grid">
      <form className="panel form-panel" onSubmit={addSupplierSubmit}>
        <div className="panel-heading"><div className="panel-icon"><Truck size={18} /></div><div><h3>Shared Supplier အသစ်ထည့်ရန်</h3><p>ဒီ Supplier Profile ကို ဆိုင်အားလုံးက အသုံးပြုနိုင်ပါတယ်။</p></div></div>
        <label>Supplier အမည် *<input required value={supplierName} onChange={(event) => setSupplierName(event.target.value)} /></label>
        <label>ဖုန်း<input value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} /></label>
        <label>လိပ်စာ<input value={supplierAddress} onChange={(event) => setSupplierAddress(event.target.value)} /></label>
        <label>မှတ်ချက်<textarea rows={2} value={supplierNote} onChange={(event) => setSupplierNote(event.target.value)} /></label>
        <button className="button button-primary" type="submit"><Plus size={15} /> Supplier သိမ်းဆည်းရန်</button><small className="field-hint">ဖုန်းနံပါတ်တူသော Supplier Profile ထပ်မဖန်တီးနိုင်ပါ။</small>
      </form>
      <form className="panel form-panel" onSubmit={addPurchaseSubmit}>
        <div className="panel-heading"><div className="panel-icon"><PackagePlus size={18} /></div><div><h3>Supplier Invoice ဖြင့် ကုန်ဝယ်ရန်</h3><p>Supplier Invoice၊ ပေးချေငွေနှင့် ပေးရန်ကျန်စာရင်းကို ချိတ်ဆက်မှတ်တမ်းတင်ရန်။ ပုံမှန်ကုန်ရောက်စာရင်းအတွက် “ကုန်ဝင်စာရင်း” Menu ကို သုံးပါ။</p></div></div>
        <label>Supplier<select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">အထွေထွေ Supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label>ပစ္စည်း *<select required value={productId} onChange={(event) => { const next = products.find((product) => product.id === event.target.value); setProductId(event.target.value); if (next) setUnitCost(String(next.costPrice)); }}><option value="">ပစ္စည်းရွေးပါ</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · လက်ကျန် {formatQuantity(product.stock, quantityModeForProduct(product))} {product.unit}</option>)}</select></label>
        <div className="form-grid"><label>အရေအတွက် *<input required type="number" min={selectedPurchaseProduct ? quantityStep(quantityModeForProduct(selectedPurchaseProduct)) : '1'} step={selectedPurchaseProduct ? quantityStep(quantityModeForProduct(selectedPurchaseProduct)) : '1'} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>တစ်ခုဈေးနှုန်း *<input required type="number" min="0" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} /></label></div>
        <label>သက်တမ်းကုန်ရက် (Expiry Date)<input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
        <div className="form-grid"><label>ယခု ပေးချေငွေ<input required type="number" min="0" max={(Number(quantity) || 0) * (Number(unitCost) || 0)} value={initialPaidAmount} onChange={(event) => setInitialPaidAmount(event.target.value)} /></label><label>ငွေပေးချေနည်း<select value={initialPaymentMethod} onChange={(event) => setInitialPaymentMethod(event.target.value as 'Cash' | 'Transfer')}><option value="Cash">Cash</option><option value="Transfer">Bank / Mobile Transfer</option></select></label></div>
        <label>မှတ်ချက်<input value={purchaseNote} onChange={(event) => setPurchaseNote(event.target.value)} placeholder="Invoice No / အခြားမှတ်ချက်" /></label>
        <div className="ledger-balance"><span>ကုန်ဝယ်တန်ဖိုး · ပေးရန်ကျန်</span><strong>{money((Number(quantity) || 0) * (Number(unitCost) || 0), settings.currency)} · {money(Math.max(0, (Number(quantity) || 0) * (Number(unitCost) || 0) - (Number(initialPaidAmount) || 0)), settings.currency)}</strong></div>
        <button className="button button-primary" type="submit" disabled={!products.length}><Plus size={15} /> Purchase Invoice သိမ်းရန်</button>
        {!products.length && <small className="field-hint">အရင်ဆုံး Inventory ထဲမှာ ပစ္စည်းထည့်ပါ။</small>}
      </form>
    </div>
    <div className="business-grid">
      <form className="panel form-panel" onSubmit={supplierPaymentSubmit}>
        <div className="panel-heading"><div className="panel-icon"><Wallet size={18} /></div><div><h3>Supplier ကို ငွေထပ်ပေးရန်</h3><p>မဆပ်ရသေးသော Purchase Invoice တစ်ခုကို ရွေးပါ။</p></div></div>
        <label>မပေးရသေးသော Invoice *<select required value={paymentPurchaseId} onChange={(event) => { setPaymentPurchaseId(event.target.value); setSupplierPaymentAmount(''); }}><option value="">Invoice ရွေးပါ</option>{outstandingInvoices.map((purchase) => <option key={purchase.id} value={purchase.id}>{purchase.supplierName} · {purchase.receiptNo} · {money(getPurchaseDue(purchase) || 0, settings.currency)}</option>)}</select></label>
        {selectedPaymentPurchase && <div className="ledger-balance"><span>လက်ကျန်ပေးရန်</span><strong>{money(getPurchaseDue(selectedPaymentPurchase) || 0, settings.currency)}</strong></div>}
        <label>ပေးချေငွေ *<input required type="number" min="1" max={selectedPaymentPurchase ? Math.max(0, getPurchaseDue(selectedPaymentPurchase) || 0) : undefined} value={supplierPaymentAmount} onChange={(event) => setSupplierPaymentAmount(event.target.value)} /></label>
        <label>ငွေပေးချေနည်း<select value={supplierPaymentMethod} onChange={(event) => setSupplierPaymentMethod(event.target.value as 'Cash' | 'Transfer')}><option value="Cash">Cash</option><option value="Transfer">Bank / Mobile Transfer</option></select></label>
        <label>မှတ်ချက်<input value={supplierPaymentNote} onChange={(event) => setSupplierPaymentNote(event.target.value)} /></label>
        <button className="button button-primary" type="submit" disabled={!selectedPaymentPurchase || !(Number(supplierPaymentAmount) > 0)}><Wallet size={15} /> ပေးချေမှု သိမ်းရန်</button>
        <small className="field-hint">Cash Shift ဖွင့်ထားပြီး Cash ပေးချေလျှင် Cash Out ထဲပါဝင်ပါမယ်။ Supplier Credit ကို အခြား Invoice သို့ အလိုအလျောက် အသုံးချခြင်း မပါသေးပါ။</small>
      </form>
      <form className="panel form-panel" onSubmit={purchaseReturnSubmit}>
        <div className="panel-heading"><div className="panel-icon"><AlertTriangle size={18} /></div><div><h3>Supplier သို့ ကုန်ပြန်ပို့ရန်</h3><p>မရောင်းရသေးဘဲ Batch ထဲရှိနေသော Stock ကိုသာ ပြန်ပို့နိုင်ပါတယ်။</p></div></div>
        <label>Purchase Invoice *<select required value={returnPurchaseId} onChange={(event) => { setReturnPurchaseId(event.target.value); setReturnQuantity('1'); }}><option value="">Invoice ရွေးပါ</option>{returnablePurchases.map((purchase) => { const available = stockBatches.find((batch) => batch.purchaseId === purchase.id)?.quantity || 0; return <option key={purchase.id} value={purchase.id}>{purchase.supplierName} · {purchase.productName} · ပြန်ပို့နိုင် {available}</option>; })}</select></label>
        {selectedReturnPurchase && <div className="ledger-balance"><span>ပြန်ပို့နိုင်သော လက်ကျန်</span><strong>{formatQuantity(selectedReturnBatch?.quantity || 0, selectedReturnProduct ? quantityModeForProduct(selectedReturnProduct) : 'whole')} {selectedReturnProduct?.unit || ''} · {money(selectedReturnPurchase.unitCost, settings.currency)} / unit</strong></div>}
        <label>ပြန်ပို့မည့် အရေအတွက် *<input required type="number" min={selectedReturnProduct ? quantityStep(quantityModeForProduct(selectedReturnProduct)) : '1'} max={selectedReturnBatch?.quantity || 1} step={selectedReturnProduct ? quantityStep(quantityModeForProduct(selectedReturnProduct)) : '1'} value={returnQuantity} onChange={(event) => setReturnQuantity(event.target.value)} /></label>
        <label>အကြောင်းရင်း / မှတ်ချက်<input value={returnNote} onChange={(event) => setReturnNote(event.target.value)} placeholder="ပျက်စီး / မှားယွင်း / အခြား" /></label>
        <div className="ledger-balance"><span>Supplier Credit ပြန်ရမည့်တန်ဖိုး</span><strong>{money((Number(returnQuantity) || 0) * (selectedReturnPurchase?.unitCost || 0), settings.currency)}</strong></div>
        <button className="button button-outline" type="submit" disabled={!selectedReturnPurchase || !selectedReturnBatch || !(Number(returnQuantity) > 0) || Number(returnQuantity) > selectedReturnBatch.quantity}><Truck size={15} /> ကုန်ပြန်ပို့မှု သိမ်းရန်</button>
      </form>
    </div>
    <div className="panel"><div className="panel-heading"><div><h3>Supplier လက်ကျန်စာရင်း</h3><p>အထက်က Purchase / Payment / Return စာရင်းက လက်ရှိဆိုင်ကိုသာ ပြသပြီး၊ အောက်ပါ Summary မှာ Branch အားလုံးကို ကြည့်နိုင်ပါတယ်။</p></div><span className="subtle-count">{suppliers.length} shared suppliers</span></div>
      {suppliers.length === 0 ? <div className="empty-state"><div className="empty-icon"><Truck size={23} /></div><strong>Supplier မရှိသေးပါ</strong><p>Supplier အသစ်ထည့်ပြီး စတင်အသုံးပြုပါ။</p></div> : <div className="table-wrap"><table><thead><tr><th>Shared Supplier</th><th>လက်ရှိဆိုင် Purchase</th><th>လက်ရှိဆိုင် ပေးပြီး</th><th>လက်ရှိဆိုင် ပြန်ပို့</th><th>လက်ရှိဆိုင် လက်ကျန်</th><th>ဆိုင်အားလုံး လက်ကျန်</th><th>လုပ်ဆောင်ချက်</th></tr></thead><tbody>{suppliers.map((supplier) => {
        const rows = trackedPurchases.filter((purchase) => purchase.supplierId === supplier.id);
        const total = rows.reduce((sum, purchase) => sum + purchase.total, 0);
        const paid = rows.reduce((sum, purchase) => sum + getPurchasePaid(purchase.id), 0);
        const returned = rows.reduce((sum, purchase) => sum + getPurchaseReturned(purchase.id), 0);
        const balance = total - paid - returned;
        const globalRows = globalTrackedPurchases.filter((purchase) => purchase.supplierId === supplier.id);
        const globalBalance = globalRows.reduce((sum, purchase) => sum + purchase.total - getGlobalPaid(purchase.id) - getGlobalReturned(purchase.id), 0);
        return <tr key={supplier.id}><td><b>{supplier.name}</b><small>{supplier.phone || ''}</small></td><td>{money(total, settings.currency)}</td><td>{money(paid, settings.currency)}</td><td>{money(returned, settings.currency)}</td><td><b className={balance > 0 ? 'stock-warning' : balance < 0 ? 'stock-ok' : ''}>{balance > 0 ? `ပေးရန် ${money(balance, settings.currency)}` : balance < 0 ? `Credit ${money(Math.abs(balance), settings.currency)}` : money(0, settings.currency)}</b></td><td><b className={globalBalance > 0 ? 'stock-warning' : globalBalance < 0 ? 'stock-ok' : ''}>{globalBalance > 0 ? `ပေးရန် ${money(globalBalance, settings.currency)}` : globalBalance < 0 ? `Credit ${money(Math.abs(globalBalance), settings.currency)}` : money(0, settings.currency)}</b></td><td><button className="small-action" onClick={() => editSupplier(supplier)}>ပြင်ရန်</button></td></tr>;
      })}</tbody></table></div>}
    </div>
    <div className="panel"><div className="panel-heading"><div><h3>ဆိုင်အလိုက် Supplier Ledger အကျဉ်းချုပ်</h3><p>Shared Supplier တူညီသော်လည်း ငွေပေးရန်ကျန်ကို Branch တစ်ခုချင်းစီ သီးခြားသိမ်းထားပါတယ်။</p></div><span className="subtle-count">{branches.length} branches</span></div>
      <div className="table-wrap"><table><thead><tr><th>ဆိုင်</th><th>Tracked Purchase</th><th>Purchase Total</th><th>ပေးချေပြီး</th><th>ပြန်ပို့တန်ဖိုး</th><th>ပေးရန်ကျန် / Credit</th></tr></thead><tbody>{branchLedger.map((row) => <tr key={row.branch.id}><td><b>{row.branch.name}</b>{row.branch.id === activeBranchId && <small>လက်ရှိဆိုင်</small>}{row.branch.status === 'archived' && <small>Archive</small>}</td><td>{row.purchaseCount}</td><td>{money(row.total, settings.currency)}</td><td>{money(row.paid, settings.currency)}</td><td>{money(row.returned, settings.currency)}</td><td><b className={row.due > 0 ? 'stock-warning' : row.due < 0 ? 'stock-ok' : ''}>{row.due > 0 ? `ပေးရန် ${money(row.due, settings.currency)}` : row.due < 0 ? `Credit ${money(Math.abs(row.due), settings.currency)}` : money(0, settings.currency)}</b></td></tr>)}</tbody></table></div>
    </div>
    <div className="panel"><div className="panel-heading"><div><h3>Purchase History</h3><p>ကုန်ဝယ် Invoice၊ ပေးချေပြီးငွေနှင့် ကျန်ငွေ</p></div><span className="subtle-count">{purchases.length} records</span></div>{purchases.length === 0 ? <div className="empty-state"><div className="empty-icon"><ClipboardList size={23} /></div><strong>ကုန်ဝယ်မှတ်တမ်း မရှိသေးပါ</strong><p>ကုန်ဝယ်လက်ခံမှု မှတ်တမ်းတင်ပြီးနောက် ဒီမှာ ပြပါမယ်။</p></div> : <div className="table-wrap"><table><thead><tr><th>နေ့စွဲ</th><th>Purchase No.</th><th>Supplier</th><th>ပစ္စည်း</th><th>Qty</th><th>Total</th><th>ပေးချေပြီး</th><th>လက်ကျန်</th><th>Expiry</th></tr></thead><tbody>{purchases.map((purchase) => {
        const due = getPurchaseDue(purchase);
        return <tr key={purchase.id}><td>{dateLabel(purchase.date)}</td><td><b className="mono">{purchase.receiptNo}</b></td><td>{purchase.supplierName}</td><td>{purchase.productName}</td><td>{purchase.quantity}</td><td><b>{money(purchase.total, settings.currency)}</b></td><td>{purchase.paymentTracking === 'tracked' ? money(getPurchasePaid(purchase.id), settings.currency) : 'မမှတ်တမ်းတင်ထား'}</td><td>{due === null ? <span className="tag">Legacy</span> : <b className={due > 0 ? 'stock-warning' : due < 0 ? 'stock-ok' : ''}>{due > 0 ? money(due, settings.currency) : due < 0 ? `Credit ${money(Math.abs(due), settings.currency)}` : money(0, settings.currency)}</b>}</td><td>{dateLabel(purchase.expiryDate)}</td></tr>;
      })}</tbody></table></div>}</div>
    <div className="panel"><div className="panel-heading"><div><h3>Supplier ငွေပေးချေမှုမှတ်တမ်း</h3><p>ကုန်ဝယ်စဉ်ပေးချေမှုနှင့် နောက်မှပေးချေမှုအားလုံး</p></div><span className="subtle-count">{supplierPayments.length} payments</span></div>{supplierPayments.length === 0 ? <div className="empty-state"><div className="empty-icon"><Wallet size={23} /></div><strong>ငွေပေးချေမှု မရှိသေးပါ</strong><p>ကုန်ဝယ်စာရင်းမှာ ပေးချေငွေထည့်ခြင်း သို့မဟုတ် နောက်မှ ပေးချေခြင်းမှ စတင်ပါ။</p></div> : <div className="table-wrap"><table><thead><tr><th>နေ့စွဲ</th><th>Supplier</th><th>Invoice</th><th>ပမာဏ</th><th>နည်းလမ်း</th><th>မှတ်ချက်</th></tr></thead><tbody>{supplierPayments.slice(0, 50).map((payment) => <tr key={payment.id}><td>{dateLabel(payment.date)}</td><td>{suppliers.find((supplier) => supplier.id === payment.supplierId)?.name || 'Supplier'}</td><td>{purchases.find((purchase) => purchase.id === payment.purchaseId)?.receiptNo || '—'}</td><td><b>{money(payment.amount, settings.currency)}</b></td><td>{payment.paymentMethod}</td><td>{payment.note || '—'}</td></tr>)}</tbody></table></div>}</div>
    <div className="panel"><div className="panel-heading"><div><h3>Supplier သို့ ပြန်ပို့မှုမှတ်တမ်း</h3><p>ပြန်ပို့ခဲ့သည့် ပစ္စည်းနှင့် Supplier Credit</p></div><span className="subtle-count">{purchaseReturns.length} returns</span></div>{purchaseReturns.length === 0 ? <div className="empty-state"><div className="empty-icon"><Truck size={23} /></div><strong>ပြန်ပို့မှု မရှိသေးပါ</strong><p>အပေါ်က Supplier သို့ ကုန်ပြန်ပို့ Form ကို အသုံးပြုပါ။</p></div> : <div className="table-wrap"><table><thead><tr><th>နေ့စွဲ</th><th>Supplier</th><th>Invoice</th><th>ပစ္စည်း</th><th>အရေအတွက်</th><th>Credit တန်ဖိုး</th><th>မှတ်ချက်</th></tr></thead><tbody>{purchaseReturns.map((entry) => <tr key={entry.id}><td>{dateLabel(entry.date)}</td><td>{suppliers.find((supplier) => supplier.id === entry.supplierId)?.name || 'Supplier'}</td><td>{purchases.find((purchase) => purchase.id === entry.purchaseId)?.receiptNo || '—'}</td><td>{entry.productName}</td><td>{entry.quantity}</td><td><b>{money(entry.total, settings.currency)}</b></td><td>{entry.note || '—'}</td></tr>)}</tbody></table></div>}</div>
    <div className="panel expiry-notice"><AlertTriangle size={18} /><div><strong>Legacy Purchase သတိပြုရန်</strong><p>ယခင် Version များတွင် Supplier ပေးချေမှုကို မမှတ်တမ်းတင်ခဲ့သော Purchase များကို အဟောင်းစာရင်းအဖြစ်သာ ပြထားပါတယ်။ အဲဒီ Purchase တွေကို အလိုအလျောက် Paid သို့မဟုတ် Credit လို့ မခန့်မှန်းထားပါ။ Supplier လက်ကျန်အသစ်ကို ဒီ Version မှ စတင်တိကျစွာ မှတ်တမ်းတင်နိုင်ပါတယ်။</p></div></div>
  </section>;
}

export function ExpiryTrackingPage() {
  const allBatches = usePosStore((state) => state.stockBatches);
  const allProducts = usePosStore((state) => state.products);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const batches = useMemo(() => allBatches.filter((batch) => batch.branchId === activeBranchId), [allBatches, activeBranchId]);
  const products = useMemo(() => allProducts.filter((product) => product.branchId === activeBranchId), [allProducts, activeBranchId]);
  const settings = usePosStore((state) => state.settings);
  const activeBatches = batches.filter((batch) => batch.quantity > 0 && batch.expiryDate).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const expired = activeBatches.filter((batch) => daysUntil(batch.expiryDate) < 0);
  const dueSoon = activeBatches.filter((batch) => daysUntil(batch.expiryDate) >= 0 && daysUntil(batch.expiryDate) <= 30);
  const totalTracked = activeBatches.reduce((sum, batch) => sum + batch.quantity, 0);

  return <section className="page-stack">
    <div className="section-heading"><div><h2>Expiry Date & Stock Tracking</h2><p>Purchase တစ်ကြိမ်ချင်းစီ၏ သက်တမ်းကုန်ရက်ကို စောင့်ကြည့်ပါ။</p></div><div className="sales-summary-chip"><CalendarClock size={16} /> Tracked {totalTracked.toLocaleString()} units</div></div>
    <div className="mini-stats">
      <div className="mini-stat"><div className="mini-stat-icon warning"><AlertTriangle size={17} /></div><div><small>သက်တမ်းကုန်ပြီး</small><strong>{expired.reduce((sum, batch) => sum + batch.quantity, 0)} units</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon"><CalendarClock size={17} /></div><div><small>ရက် ၃၀ အတွင်း ကုန်မည့်</small><strong>{dueSoon.reduce((sum, batch) => sum + batch.quantity, 0)} units</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon"><PackagePlus size={17} /></div><div><small>Expiry ထည့်ထားသော Batch</small><strong>{activeBatches.length}</strong></div></div>
    </div>
    <div className="panel expiry-notice"><AlertTriangle size={18} /><div><strong>အရေးကြီးသော မှတ်ချက်</strong><p>Expiry စာရင်းသည် Purchase မှတ်တမ်းတွင် Expiry Date ထည့်ထားသော Batch များကို အခြေခံထားပါတယ်။ အရင်က လက်ဖြင့်ထည့်ထားသော Opening Stock တွင် Expiry Date မရှိနိုင်ပါ။ Expired ပစ္စည်းတွေကို ရောင်းချမီ ကိုယ်တိုင်စစ်ဆေးပြီး Stock Adjustment လုပ်ပါ။</p></div></div>
    <div className="panel"><div className="panel-heading"><div><h3>Expiry Alert List</h3><p>သက်တမ်းကုန်ရက်အလိုက် အစဉ်လိုက်</p></div><span className="subtle-count">{activeBatches.length} batches</span></div>{activeBatches.length === 0 ? <div className="empty-state"><div className="empty-icon"><CalendarClock size={23} /></div><strong>Expiry Batch မရှိသေးပါ</strong><p>Supplier & Purchase မှာ ကုန်ဝယ်လက်ခံတဲ့အခါ Expiry Date ဖြည့်ပါ။</p></div> : <div className="table-wrap"><table><thead><tr><th>ပစ္စည်း</th><th>SKU</th><th>လက်ကျန် Batch Qty</th><th>Expiry Date</th><th>ကျန်ရက်</th><th>အခြေအနေ</th></tr></thead><tbody>{activeBatches.map((batch) => {
      const days = daysUntil(batch.expiryDate);
      const product = products.find((entry) => entry.id === batch.productId);
      const status = days < 0 ? 'သက်တမ်းကုန်ပြီး' : days <= 7 ? '၇ ရက်အတွင်း' : days <= 30 ? '၃၀ ရက်အတွင်း' : 'အဆင်ပြေ';
      return <tr key={batch.id}><td><b>{product?.name || 'ဖျက်ထားသောပစ္စည်း'}</b></td><td>{product?.sku || '—'}</td><td>{batch.quantity} {product?.unit || ''}</td><td>{dateLabel(batch.expiryDate)}</td><td>{days < 0 ? `${Math.abs(days)} ရက်ကျော်` : `${days} ရက်`}</td><td><span className={`tag ${days < 0 ? 'tag-danger' : days <= 30 ? 'tag-warn' : 'tag-success'}`}>{status}</span></td></tr>;
    })}</tbody></table></div>}</div>
    <div className="panel"><div className="panel-heading"><div><h3>Expiry Batch တန်ဖိုး</h3><p>ကုန်ဝယ် Cost Price အပေါ် အခြေခံသော ခန့်မှန်းတန်ဖိုး</p></div></div><div className="ledger-balance"><span>Expiry Date ပါဝင်သော Batch များ၏ ကျန်တန်ဖိုး</span><strong>{money(activeBatches.reduce((sum, batch) => sum + batch.quantity * batch.unitCost, 0), settings.currency)}</strong></div></div>
  </section>;
}
