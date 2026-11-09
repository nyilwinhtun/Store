import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, ArchiveRestore, CheckCircle2, Plus, Store, Tag, Pencil, ShieldCheck } from 'lucide-react';
import { DEFAULT_CASHIER_EXPENSE_APPROVAL_LIMIT, usePosStore } from '../store/usePosStore';

export function BranchManagementPage({ authorize, notify, onOpenBranch }: { authorize: (action: string) => boolean; notify: (message: string) => void; onOpenBranch: (branchId: string) => void }) {
  const branches = usePosStore((state) => state.branches);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const allCategories = usePosStore((state) => state.categories);
  const allProducts = usePosStore((state) => state.products);
  const categories = useMemo(() => allCategories.filter((category) => category.branchId === activeBranchId), [allCategories, activeBranchId]);
  const products = useMemo(() => allProducts.filter((product) => product.branchId === activeBranchId), [allProducts, activeBranchId]);
  const addBranch = usePosStore((state) => state.addBranch);
  const updateBranch = usePosStore((state) => state.updateBranch);
  const archiveBranch = usePosStore((state) => state.archiveBranch);
  const restoreBranch = usePosStore((state) => state.restoreBranch);
  const addCategory = usePosStore((state) => state.addCategory);
  const updateCategory = usePosStore((state) => state.updateCategory);
  const archiveCategory = usePosStore((state) => state.archiveCategory);
  const restoreCategory = usePosStore((state) => state.restoreCategory);
  const activeBranches = branches.filter((branch) => branch.status === 'active');
  const currentBranch = branches.find((branch) => branch.id === activeBranchId);
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [expenseApprovalLimit, setExpenseApprovalLimit] = useState(String(currentBranch?.settings.cashierExpenseApprovalLimit ?? DEFAULT_CASHIER_EXPENSE_APPROVAL_LIMIT));

  useEffect(() => {
    setExpenseApprovalLimit(String(currentBranch?.settings.cashierExpenseApprovalLimit ?? DEFAULT_CASHIER_EXPENSE_APPROVAL_LIMIT));
  }, [currentBranch?.id, currentBranch?.settings.cashierExpenseApprovalLimit]);

  const categoryUsage = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach((product) => counts.set(product.category, (counts.get(product.category) || 0) + 1));
    return counts;
  }, [products]);

  const submitBranch = (event: FormEvent) => {
    event.preventDefault();
    if (!authorize('ဆိုင်ခွဲအသစ် ဖန်တီးရန်')) return;
    if (activeBranches.some((branch) => branch.name.trim().toLocaleLowerCase() === branchName.trim().toLocaleLowerCase())) {
      notify('ဒီဆိုင်အမည် ရှိပြီးသားဖြစ်ပါတယ်။');
      return;
    }
    const id = addBranch({ name: branchName, address: branchAddress, phone: branchPhone });
    if (!id) { notify('ဆိုင်ခွဲအသစ် ဖန်တီးမရပါ။ အမည်ကို စစ်ဆေးပါ။'); return; }
    setBranchName(''); setBranchAddress(''); setBranchPhone('');
    notify('ဆိုင်ခွဲအသစ် ဖန်တီးပြီးပါပြီ။ ဆိုင်အသစ်မှာ Product / Category သီးခြားစတင်နိုင်ပါပြီ။');
  };

  const renameBranch = (id: string, name: string) => {
    if (!authorize('ဆိုင်အမည် ပြင်ဆင်ရန်')) return;
    const next = window.prompt('ဆိုင်အမည်အသစ်', name);
    if (next === null || !next.trim()) return;
    if (branches.some((branch) => branch.id !== id && branch.status === 'active' && branch.name.trim().toLocaleLowerCase() === next.trim().toLocaleLowerCase())) { notify('ဒီအမည်နဲ့ Active ဆိုင်တစ်ဆိုင် ရှိပြီးသားပါ။'); return; }
    updateBranch(id, { name: next.trim() });
    notify('ဆိုင်အချက်အလက် ပြင်ဆင်ပြီးပါပြီ။')
  };

  const archive = (id: string, name: string) => {
    if (!authorize('ဆိုင်ခွဲ Archive လုပ်ရန်')) return;
    if (!window.confirm(`${name} ကို Archive လုပ်မလား။ အရင်စာရင်းတွေကို မဖျက်ဘဲ သိမ်းထားပါမယ်။`)) return;
    if (!archiveBranch(id)) { notify('ဒီဆိုင်ကို Archive မလုပ်နိုင်ပါ။ Default ဆိုင်၊ လက်ရှိရွေးထားသောဆိုင် သို့မဟုတ် နောက်ဆုံး Active ဆိုင် ဖြစ်နိုင်ပါတယ်။'); return; }
    notify('ဆိုင်ခွဲကို Archive လုပ်ပြီးပါပြီ။ မူလစာရင်းများ မဖျက်ထားပါ။');
  };

  const restore = (id: string, name: string) => {
    if (!authorize('ဆိုင်ခွဲ ပြန်ဖွင့်ရန်')) return;
    if (!window.confirm(`${name} ကို ပြန်ဖွင့်မလား။ မူလ Data တွေကို ဆက်လက်အသုံးပြုနိုင်ပါမယ်။`)) return;
    if (!restoreBranch(id)) { notify('ဒီဆိုင်ခွဲကို ပြန်ဖွင့်မရပါ။ အမည်တူ Active ဆိုင်ရှိမရှိ စစ်ပါ။'); return; }
    notify('ဆိုင်ခွဲကို ပြန်ဖွင့်ပြီးပါပြီ။');
  };

  const submitCategory = (event: FormEvent) => {
    event.preventDefault();
    if (!authorize('Category အသစ် ထည့်ရန်')) return;
    if (!addCategory(categoryName)) { notify('Category အမည် အလွတ်ဖြစ်နေခြင်း သို့မဟုတ် ရှိပြီးသားဖြစ်နေခြင်းကြောင့် မထည့်နိုင်ပါ။'); return; }
    setCategoryName(''); notify('Category အသစ် ထည့်ပြီးပါပြီ။');
  };

  const editCategory = (id: string, name: string) => {
    if (!authorize('Category ပြင်ဆင်ရန်')) return;
    const next = window.prompt('Category အမည်အသစ်', name);
    if (next === null || !next.trim()) return;
    if (categories.some((category) => category.id !== id && category.isActive && category.name.trim().toLocaleLowerCase() === next.trim().toLocaleLowerCase())) { notify('ဒီ Category အမည် ရှိပြီးသားပါ။'); return; }
    updateCategory(id, next.trim()); notify('Category ပြင်ဆင်ပြီးပါပြီ။');
  };

  const disableCategory = (id: string, name: string) => {
    if (!authorize('Category ပိတ်ရန်')) return;
    if (!window.confirm(`${name} ကို အသုံးမပြုတော့ရန် ပိတ်မလား။`)) return;
    const before = categories.find((category) => category.id === id);
    archiveCategory(id);
    const after = usePosStore.getState().categories.find((category) => category.id === id);
    if (before?.isActive && after?.isActive) notify('ဒီ Category ကို Product တွေမှာ အသုံးပြုနေသေးလို့ ပိတ်လို့မရပါ။ Product တွေကို အခြား Category သို့ အရင်ပြောင်းပါ။');
    else notify('Category ကို ပိတ်ထားပါပြီ။ အဟောင်း Product မှတ်တမ်းတွေ မပြောင်းပါ။');
  };

  const enableCategory = (id: string, name: string) => {
    if (!authorize('Category ပြန်ဖွင့်ရန်')) return;
    if (!restoreCategory(id)) { notify('Category ပြန်ဖွင့်မရပါ။ အမည်တူ အသုံးပြုနေသော Category ရှိမရှိ စစ်ပါ။'); return; }
    notify(`${name} Category ကို ပြန်ဖွင့်ပြီးပါပြီ။`);
  };

  return <section className="page-stack">
    <div className="section-heading">
      <div><h2>ဆိုင်ခွဲနှင့် Category စီမံခန့်ခွဲမှု</h2><p>ဆိုင်တစ်ဆိုင်ချင်းစီ၏ Product နှင့် Category ကို သီးခြားထားပါ။</p></div>
      <div className="sales-summary-chip"><ShieldCheck size={16} /> Owner Control</div>
    </div>

    <div className="mini-stats">
      <div className="mini-stat"><div className="mini-stat-icon"><Store size={17} /></div><div><small>Active ဆိုင်</small><strong>{activeBranches.length}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon"><Tag size={17} /></div><div><small>လက်ရှိဆိုင် Category</small><strong>{categories.filter((category) => category.isActive).length}</strong></div></div>
      <div className="mini-stat"><div className="mini-stat-icon"><CheckCircle2 size={17} /></div><div><small>လက်ရှိဆိုင် Product</small><strong>{products.length}</strong></div></div>
    </div>

    <div className="business-grid">
      <form className="panel form-panel" onSubmit={submitBranch}>
        <div className="panel-heading"><div className="panel-icon"><Plus size={18} /></div><div><h3>ဆိုင်ခွဲအသစ် ဖန်တီးရန်</h3><p>ဆိုင်အသစ်ရဲ့ Product / Category က သီးခြားဖြစ်ပါမယ်။</p></div></div>
        <label>ဆိုင်အမည် *<input required value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="ဥပမာ - မြို့မဆိုင်" /></label>
        <label>လိပ်စာ<input value={branchAddress} onChange={(event) => setBranchAddress(event.target.value)} placeholder="မြို့နယ် / ရပ်ကွက်" /></label>
        <label>ဖုန်းနံပါတ်<input value={branchPhone} onChange={(event) => setBranchPhone(event.target.value)} placeholder="မဖြစ်မနေ မဟုတ်ပါ" /></label>
        <button className="button button-primary" type="submit"><Plus size={15} /> ဆိုင်အသစ် သိမ်းဆည်းရန်</button>
        <small className="field-hint">ဆိုင်အသစ်ဖန်တီးပါက Default Category များကို သီးခြား Category Record အဖြစ် ဖန်တီးပေးပါမယ်။ Product နဲ့ Stock အဟောင်းတွေကို အလိုအလျောက် မကူးပါ။</small>
      </form>

      <div className="panel form-panel">
        <div className="panel-heading"><div className="panel-icon"><Store size={18} /></div><div><h3>ဆိုင်စာရင်း</h3><p>လက်ရှိအသုံးပြုနေသောဆိုင်နှင့် သိမ်းဆည်းထားသော ဆိုင်များ</p></div></div>
        <div className="branch-list">
          {branches.map((branch) => <div className={`branch-list-item ${branch.id === activeBranchId ? 'branch-current' : ''}`} key={branch.id}>
            <div className="branch-list-icon"><Store size={18} /></div>
            <div className="branch-list-info"><strong>{branch.name}</strong><small>{branch.code} · {branch.address || 'လိပ်စာ မဖြည့်ရသေး'}</small><div className="branch-list-tags">{branch.isDefault && <span className="tag">Default</span>}<span className={`tag ${branch.status === 'active' ? 'tag-success' : 'tag-warn'}`}>{branch.status === 'active' ? 'Active' : 'Archived'}</span>{branch.id === activeBranchId && <span className="tag tag-success">လက်ရှိ</span>}</div></div>
            <div className="branch-list-actions">{branch.status === 'active' && <button className="small-action branch-open-action" type="button" onClick={() => onOpenBranch(branch.id)} title="ဒီဆိုင် Dashboard ဖွင့်ရန်">ဖွင့်ရန်</button>}{branch.status === 'active' && <button className="small-action" type="button" onClick={() => renameBranch(branch.id, branch.name)} title="ဆိုင်အမည်ပြင်ရန်"><Pencil size={14} /></button>}{!branch.isDefault && branch.status === 'active' && branch.id !== activeBranchId && <button className="small-action danger-action" type="button" onClick={() => archive(branch.id, branch.name)} title="Archive"><Archive size={14} /></button>}{branch.status === 'archived' && <button className="small-action" type="button" onClick={() => restore(branch.id, branch.name)} title="ပြန်ဖွင့်ရန်"><ArchiveRestore size={14} /></button>}</div>
          </div>)}
        </div>
        {activeBranches.length === 1 && <div className="backup-warning"><Store size={17} /><span>လက်ရှိ Single-Store Mode ဖြစ်ပါတယ်။ ဆိုင်ခွဲထပ်ဖန်တီးမှ Branch Selector မှာ ရွေးချယ်စရာ ပေါ်လာပါမယ်။</span></div>}
        {currentBranch && <div className="ledger-balance"><span>လက်ရှိဆိုင်</span><strong>{currentBranch.name}</strong></div>}
      </div>
    </div>

    {currentBranch && <form className="panel form-panel" onSubmit={(event) => {
      event.preventDefault();
      if (!authorize('Cashier Expense Approval Limit ပြင်ဆင်ရန်')) return;
      const value = Number(expenseApprovalLimit);
      if (!Number.isSafeInteger(value) || value < 0) { notify('Approval Limit ကို 0 သို့မဟုတ် အပေါင်း ပြည့်ကိန်းဖြင့် ထည့်ပါ။'); return; }
      updateBranch(activeBranchId, { settings: { cashierExpenseApprovalLimit: value } });
      notify(`Cashier Expense Approval Limit ကို ${value.toLocaleString('en-US')} MMK အဖြစ် သိမ်းပြီးပါပြီ။`);
    }}>
      <div className="panel-heading"><div className="panel-icon"><ShieldCheck size={18} /></div><div><h3>Cashier အသုံးစရိတ် Approval သတ်မှတ်ချက်</h3><p>{currentBranch.name} အတွက် တစ်ကြိမ်စာ အသုံးစရိတ် Limit သတ်မှတ်ပါ။</p></div></div>
      <label>Owner Approval မလိုဘဲ Cashier ကိုယ်တိုင် မှတ်တမ်းတင်နိုင်သည့် အများဆုံးပမာဏ (MMK)
        <input type="number" min="0" step="1" inputMode="numeric" required value={expenseApprovalLimit} onChange={(event) => setExpenseApprovalLimit(event.target.value)} />
      </label>
      <small className="field-hint">Limit ထက် မကျော်သော အသုံးစရိတ်ကို Cashier က မှတ်တမ်းတင်နိုင်ပါတယ်။ Limit ကျော်လျှင် Owner ခွင့်ပြုချက် မရမချင်း ဆိုင်ငွေ (Cash / KPay) ကို မသုံးရပါ။ 0 ထားလျှင် အသုံးစရိတ်အားလုံး Owner Approval လိုအပ်ပါမယ်။ Default သတ်မှတ်ချက်မှာ 50,000 MMK ဖြစ်ပါတယ်။</small>
      <button className="button button-primary" type="submit">Approval Limit သိမ်းဆည်းရန်</button>
    </form>}

    <div className="panel form-panel">
      <div className="panel-heading"><div className="panel-icon"><Tag size={18} /></div><div><h3>လက်ရှိဆိုင်၏ Category များ</h3><p>Category တစ်ခုကို ဆိုင်တစ်ဆိုင်အတွင်းသာ အသုံးပြုပါမယ်။</p></div></div>
      <form className="branch-category-form" onSubmit={submitCategory}>
        <label className="branch-category-input">Category အသစ်<input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="ဥပမာ - အချိုရည်" /></label>
        <button className="button button-primary" type="submit" disabled={!categoryName.trim()}><Plus size={15} /> Category ထည့်ရန်</button>
      </form>
      {categories.length === 0 ? <div className="empty-state"><Tag size={22} /><strong>Category မရှိသေးပါ</strong><p>အပေါ်က Form မှာ Category အသစ်ထည့်ပါ။</p></div> : <div className="category-management-list">{categories.map((category) => <div className={`category-management-item ${!category.isActive ? 'category-disabled' : ''}`} key={category.id}><span className="category-color-dot" style={{ background: category.color }} /><div className="category-management-info"><strong>{category.name}</strong><small>{categoryUsage.get(category.name) || 0} products · {category.isActive ? 'အသုံးပြုနိုင်သည်' : 'ပိတ်ထားသည်'}</small></div><div className="branch-list-actions">{category.isActive ? <><button className="small-action" type="button" onClick={() => editCategory(category.id, category.name)} title="ပြင်ရန်"><Pencil size={14} /></button><button className="small-action danger-action" type="button" onClick={() => disableCategory(category.id, category.name)} title="ပိတ်ရန်"><Archive size={14} /></button></> : <button className="small-action" type="button" onClick={() => enableCategory(category.id, category.name)} title="ပြန်ဖွင့်ရန်"><ArchiveRestore size={14} /></button>}</div></div>)}</div>}
    </div>

    <div className="panel security-note"><ShieldCheck size={18} /><div><strong>Phase 1 Security မှတ်ချက်</strong><p>ဒီအဆင့်မှာ Owner PIN ဖြင့် UI ထိန်းချုပ်မှုသာ ပါဝင်ပါတယ်။ Branch တစ်ခုချင်းစီအတွက် Firebase Membership နဲ့ Server-side Firestore Security Rules ကို Phase 5 မှာ အတည်ပြုပြီးမှ ဝန်ထမ်းအကောင့်အသုံးပြုမှုအတွက် လုံခြုံရေးအာမခံနိုင်ပါမယ်။</p></div></div>
  </section>;
}
