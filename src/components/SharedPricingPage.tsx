import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, CircleDollarSign, Link2, Link2Off, Package, Plus, RefreshCw, Search, Store, Tags } from 'lucide-react';
import { usePosStore, type Branch, type Product, type SharedPriceProductRef } from '../store/usePosStore';
import { AUTO_SYNC_STATUS_EVENT, readAutoSyncStatus, type AutoSyncStatus } from '../lib/autoSyncStatus';

type Props = {
  branches: Branch[];
  products: Product[];
  actorUid: string;
  notify: (message: string) => void;
};

const money = (value: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))} MMK`;
const refKey = (branchId: string, productId: string) => `${branchId}::${productId}`;
function isSharedPriceCloudReady(uid: string): boolean {
  if (typeof navigator === 'undefined' || !navigator.onLine) return false;
  const status = readAutoSyncStatus(uid);
  return status.state === 'synced' && !/priceGroups/i.test(status.message);
}

export function SharedPricingPage({ branches, products, actorUid, notify }: Props) {
  const priceGroups = usePosStore((state) => state.priceGroups);
  const createSharedPriceGroup = usePosStore((state) => state.createSharedPriceGroup);
  const activeBranches = useMemo(() => branches.filter((branch) => branch.status === 'active'), [branches]);
  const branchNameById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch.status === 'archived' ? `${branch.name} (Archived)` : branch.name])), [branches]);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState('');
  const [cloudStatus, setCloudStatus] = useState<AutoSyncStatus>(() => readAutoSyncStatus(actorUid));
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; status?: AutoSyncStatus }>).detail;
      if (detail?.uid === actorUid && detail.status) setCloudStatus(detail.status);
    };
    setCloudStatus(readAutoSyncStatus(actorUid));
    window.addEventListener(AUTO_SYNC_STATUS_EVENT, refresh);
    return () => window.removeEventListener(AUTO_SYNC_STATUS_EVENT, refresh);
  }, [actorUid]);

  const ensureCloudReady = () => {
    if (!isSharedPriceCloudReady(actorUid)) {
      notify('Internet ချိတ်ဆက်ပြီး Shared Price Group အပါအဝင် Owner Cloud Auto Sync အားလုံး Synced ဖြစ်မှသာ ဈေးနှုန်းအုပ်စု ပြင်ဆင်နိုင်ပါတယ်။');
      return false;
    }
    return true;
  };

  const activeGroups = priceGroups.filter((group) => group.status === 'active');
  const eligibleProducts = useMemo(() => products
    .filter((product) => activeBranches.some((branch) => branch.id === product.branchId))
    .filter((product) => !product.priceGroupId), [products, activeBranches]);
  const candidates = useMemo(() => eligibleProducts
    .filter((product) => {
      const q = search.trim().toLocaleLowerCase();
      return !q || [product.name, product.sku, product.barcode || '', branchNameById.get(product.branchId || '') || ''].some((value) => value.toLocaleLowerCase().includes(q));
    })
    .sort((a, b) => (branchNameById.get(a.branchId || '') || '').localeCompare(branchNameById.get(b.branchId || '') || '') || a.name.localeCompare(b.name)),
  [eligibleProducts, search, branchNameById]);

  const selectedProducts = useMemo(() => selectedKeys
    .map((key) => eligibleProducts.find((product) => refKey(product.branchId || '', product.id) === key))
    .filter((product): product is Product => !!product), [selectedKeys, eligibleProducts]);
  const selectedBranchIds = new Set(selectedProducts.map((product) => product.branchId));
  const differingPrices = selectedProducts.some((product) =>
    product.retailPrice !== (selectedProducts[0]?.retailPrice ?? product.retailPrice)
    || product.wholesalePrice !== (selectedProducts[0]?.wholesalePrice ?? product.wholesalePrice));

  const startCreate = () => {
    setShowCreate((current) => !current);
    if (!showCreate) {
      setSelectedKeys([]);
      setGroupName('');
      setRetailPrice('');
      setWholesalePrice('');
      setSearch('');
    }
  };

  const toggleCandidate = (product: Product, checked: boolean) => {
    const key = refKey(product.branchId || '', product.id);
    if (!checked) {
      setSelectedKeys((current) => current.filter((item) => item !== key));
      return;
    }
    if (selectedKeys.some((item) => item.startsWith(`${product.branchId}::`))) {
      notify('ဈေးနှုန်းအုပ်စုတစ်ခုအတွင်း Branch တစ်ခုမှ Product တစ်မျိုးသာ ချိတ်နိုင်ပါတယ်။');
      return;
    }
    if (selectedKeys.length === 0) {
      setGroupName(product.name);
      setRetailPrice(String(product.retailPrice));
      setWholesalePrice(String(product.wholesalePrice));
    }
    setSelectedKeys((current) => current.includes(key) ? current : [...current, key]);
  };

  const handleCreate = () => {
    if (!ensureCloudReady()) return;
    const retail = Number(retailPrice);
    const wholesale = Number(wholesalePrice);
    if (selectedProducts.length < 2 || selectedBranchIds.size < 2) {
      notify('အနည်းဆုံး ဆိုင်ခွဲ ၂ ခုမှ Product တစ်မျိုးစီ ရွေးချယ်ပါ။');
      return;
    }
    if (!groupName.trim() || !Number.isFinite(retail) || retail <= 0 || !Number.isFinite(wholesale) || wholesale < 0) {
      notify('Group အမည်၊ လက်လီဈေးနဲ့ လက်ကားဈေးကို မှန်ကန်စွာ ဖြည့်ပါ။');
      return;
    }
    if (differingPrices && !window.confirm(`ရွေးထားသော Product ${selectedProducts.length} မျိုး၏ မူလဈေးနှုန်း မတူပါ။ သတ်မှတ်ထားသော Retail ${money(retail)} / Wholesale ${money(wholesale)} ကို ရွေးထားသည့် Branch Product အားလုံးတွင် အစားထိုးမည်။ ဆက်လုပ်မလား?`)) return;
    const refs: SharedPriceProductRef[] = selectedProducts.map((product) => ({ branchId: product.branchId || '', productId: product.id }));
    const id = createSharedPriceGroup({ name: groupName, retailPrice: retail, wholesalePrice: wholesale, products: refs, actorUid });
    if (!id) {
      notify('ဈေးနှုန်းအုပ်စု မဖန်တီးနိုင်ပါ။ Product ရွေးချယ်မှု၊ Branch နဲ့ ဈေးနှုန်းကို ပြန်စစ်ပါ။');
      return;
    }
    window.dispatchEvent(new Event('minimart-cloud-sync-requested'));
    notify(`${groupName} ကို ဆိုင်ခွဲ ${selectedBranchIds.size} ခုနှင့် ဈေးနှုန်းချိတ်ဆက်ပြီးပါပြီ။ Cloud Sync စတင်ပါမယ်။`);
    setShowCreate(false);
    setSelectedKeys([]);
    setGroupName('');
    setRetailPrice('');
    setWholesalePrice('');
  };

  return <section className="page-stack shared-pricing-page">
    <div className="section-heading">
      <div><h2>မျှဝေဈေးနှုန်း စီမံခန့်ခွဲမှု</h2><p>Product စာရင်းနဲ့ Stock ကို ဆိုင်အလိုက် သီးခြားထားပြီး Owner က ချိတ်ဆက်ထားတဲ့ Product တွေရဲ့ ရောင်းဈေးကိုသာ တစ်နေရာတည်းက ထိန်းချုပ်ပါ။</p></div>
      <div className="heading-actions"><button className="button button-primary" type="button" onClick={startCreate}><Plus size={16}/> ဈေးနှုန်းအုပ်စုအသစ်</button></div>
    </div>

    <div className="dashboard-stats shared-pricing-summary">
      <div className="metric-card"><div className="metric-head"><span>Active Price Groups</span><div><Tags size={17}/></div></div><strong>{activeGroups.length}</strong><small>Owner ချိတ်ဆက်ထားသော ဈေးနှုန်းအုပ်စု</small></div>
      <div className="metric-card"><div className="metric-head"><span>ချိတ်ဆက်ထားသော Product</span><div><Link2 size={17}/></div></div><strong>{products.filter((product) => !!product.priceGroupId).length}</strong><small>Branch Product Record များ</small></div>
      <div className="metric-card"><div className="metric-head"><span>သီးခြားဈေးနှုန်း</span><div><Package size={17}/></div></div><strong>{products.filter((product) => !product.priceGroupId).length}</strong><small>မချိတ်ဆက်ရသေးသော Product များ</small></div>
    </div>

    <div className="analytics-note"><AlertTriangle size={18}/><div><strong>အရေးကြီးသော စည်းမျဉ်း</strong><p>Product တူတယ်လို့ Owner က အတည်ပြုပြီး ချိတ်ဆက်မှသာ လက်လီ/လက်ကားဈေး တူညီပါမယ်။ Stock၊ Cost Price၊ Batch၊ Purchase နဲ့ Finance ကို Branch တစ်ခုချင်းစီမှာ သီးခြားထားပါတယ်။ ဈေးနှုန်းအုပ်စုအတွင်း Branch တစ်ခုမှ Product တစ်မျိုးသာ ချိတ်ဆက်နိုင်ပါတယ်။</p></div></div>
    <div className={`auto-sync-status auto-sync-${cloudStatus.state}`} role="status"><strong>ဈေးနှုန်း Cloud Sync: {cloudStatus.state === 'synced' && !/priceGroups/i.test(cloudStatus.message) ? 'ချိတ်ဆက်ပြီး' : cloudStatus.state === 'offline' ? 'Offline' : cloudStatus.state === 'conflict' ? 'Data Conflict' : cloudStatus.state === 'error' ? 'Sync Error' : cloudStatus.state === 'idle' ? 'မစတင်ရသေး' : /priceGroups/i.test(cloudStatus.message) ? 'Price Group Sync မရ' : 'ချိတ်ဆက်နေသည်'}</strong><small>{cloudStatus.message}</small><small>မျှဝေဈေးနှုန်း Create / Update / Attach / Unlink ကို Online ဖြစ်ပြီး Auto Sync Active ဖြစ်ချိန်မှသာ ခွင့်ပြုသည်။</small></div>

    {showCreate && <div className="panel shared-price-create-panel">
      <div className="panel-heading"><div><h3>ဈေးနှုန်းအုပ်စုအသစ် ဖန်တီးရန်</h3><p>အနည်းဆုံး ဆိုင်ခွဲ ၂ ခုမှ Product တစ်မျိုးစီကို Owner ကိုယ်တိုင် ရွေးချယ်ပါ။</p></div><button className="button button-outline" type="button" onClick={startCreate}>ပယ်ဖျက်</button></div>
      <div className="shared-price-form-grid">
        <label>ဈေးနှုန်းအုပ်စုအမည်<input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="ဥပမာ - Coca Cola 600ml"/></label>
        <label>လက်လီရောင်းဈေး (MMK)<input type="number" min="1" value={retailPrice} onChange={(event) => setRetailPrice(event.target.value)} placeholder="1500"/></label>
        <label>လက်ကားရောင်းဈေး (MMK)<input type="number" min="0" value={wholesalePrice} onChange={(event) => setWholesalePrice(event.target.value)} placeholder="1350"/></label>
      </div>
      <div className="table-toolbar"><div><strong>ချိတ်ဆက်မည့် Product ရွေးချယ်ရန်</strong><small className="subtle-count"> ရွေးထားသည် {selectedProducts.length} မျိုး · Branch {selectedBranchIds.size} ခု</small></div><div className="search-box"><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Product / SKU / ဆိုင်ရှာရန်..."/></div></div>
      {differingPrices && <div className="backup-warning"><AlertTriangle size={16}/><span>ရွေးထားတဲ့ Product တွေရဲ့ မူလဈေးနှုန်း မတူပါ။ အပေါ်မှာ သတ်မှတ်ထားတဲ့ ဈေးနှုန်းအသစ်ကို ရွေးထားတဲ့ Product အားလုံးမှာ သတ်မှတ်ပါမယ်။</span></div>}
      <div className="shared-price-candidate-list">
        {candidates.length === 0 ? <p className="empty-inline">ချိတ်ဆက်နိုင်တဲ့ သီးခြား Product မရှိပါ။</p> : candidates.map((product) => {
          const key = refKey(product.branchId || '', product.id);
          const checked = selectedKeys.includes(key);
          const branchAlreadySelected = selectedKeys.some((item) => item.startsWith(`${product.branchId}::`) && item !== key);
          return <label className={`shared-price-candidate ${checked ? 'selected' : ''}`} key={key}>
            <input type="checkbox" checked={checked} disabled={branchAlreadySelected} onChange={(event) => toggleCandidate(product, event.target.checked)}/>
            <span className="shared-price-candidate-main"><strong>{product.name}</strong><small>{branchNameById.get(product.branchId || '') || 'Branch မသတ်မှတ်ထား'} · SKU {product.sku || '—'} · Stock {product.stock} {product.unit}</small></span>
            <span className="shared-price-candidate-price"><b>{money(product.retailPrice)}</b><small>လက်ကား {money(product.wholesalePrice)}</small></span>
          </label>;
        })}
      </div>
      <div className="modal-actions"><button className="button button-outline" type="button" onClick={startCreate}>ပယ်ဖျက်</button><button className="button button-primary" type="button" disabled={selectedBranchIds.size < 2} onClick={handleCreate}><Check size={16}/> ရွေးထားသော Product များကို ဈေးချိတ်မည်</button></div>
    </div>}

    <div className="panel">
      <div className="panel-heading"><div><h3>လက်ရှိ မျှဝေဈေးနှုန်းအုပ်စုများ</h3><p>ဈေးပြောင်းလဲပါက ချိတ်ဆက်ထားသော Branch Product များအားလုံးကို Update လုပ်ပါမယ်။</p></div><span className="sales-summary-chip"><CircleDollarSign size={15}/> {activeGroups.length} groups</span></div>
      {activeGroups.length === 0 ? <div className="empty-state"><div className="empty-icon"><Tags size={24}/></div><strong>မျှဝေဈေးနှုန်းအုပ်စု မရှိသေးပါ</strong><p>တူညီတဲ့ Product ကို ဆိုင် ၂ ဆိုင် သို့မဟုတ် အများအပြားမှာ ရောင်းချတဲ့အခါ Owner က ဒီနေရာမှာ ချိတ်ဆက်နိုင်ပါတယ်။</p><button className="button button-primary" type="button" onClick={startCreate}>ပထမဆုံး ဈေးနှုန်းအုပ်စု ဖန်တီးရန်</button></div> : <div className="shared-price-group-list">{activeGroups.map((group) => <SharedPriceGroupCard key={group.id} group={group} products={products} branches={branches} actorUid={actorUid} notify={notify}/>)}</div>}
    </div>
  </section>;
}

function SharedPriceGroupCard({ group, products, branches, actorUid, notify }: {
  group: ReturnType<typeof usePosStore.getState>['priceGroups'][number];
  products: Product[];
  branches: Branch[];
  actorUid: string;
  notify: (message: string) => void;
}) {
  const updateSharedPriceGroup = usePosStore((state) => state.updateSharedPriceGroup);
  const attachProductsToSharedPriceGroup = usePosStore((state) => state.attachProductsToSharedPriceGroup);
  const unlinkProductFromSharedPriceGroup = usePosStore((state) => state.unlinkProductFromSharedPriceGroup);
  const [name, setName] = useState(group.name);
  const [retail, setRetail] = useState(String(group.retailPrice));
  const [wholesale, setWholesale] = useState(String(group.wholesalePrice));
  const [showAttach, setShowAttach] = useState(false);
  // Keep the edit form aligned with an Owner/Cloud update made on another device.
  useEffect(() => {
    setName(group.name);
    setRetail(String(group.retailPrice));
    setWholesale(String(group.wholesalePrice));
  }, [group.id, group.version, group.updatedAt, group.name, group.retailPrice, group.wholesalePrice]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const members = products.filter((product) => product.priceGroupId === group.id);
  // Product.branchId is optional in the legacy model. Only valid branch IDs
  // belong in this set; this keeps Map lookups and membership checks type-safe.
  const memberBranches = new Set(
    members
      .map((product) => product.branchId)
      .filter((branchId): branchId is string => typeof branchId === 'string' && branchId.length > 0),
  );
  const activeBranches = branches.filter((branch) => branch.status === 'active');
  const candidates = products.filter((product) =>
    !product.priceGroupId
    && typeof product.branchId === 'string'
    && product.branchId.length > 0
    && activeBranches.some((branch) => branch.id === product.branchId)
    && !memberBranches.has(product.branchId),
  );
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.status === 'archived' ? `${branch.name} (Archived)` : branch.name]));

  const savePrices = () => {
    if (!isSharedPriceCloudReady(actorUid)) {
      notify('မျှဝေဈေးနှုန်း ပြင်ဆင်ရန် Internet နှင့် Owner Cloud Auto Sync Active ဖြစ်နေရပါမယ်။');
      return;
    }
    const affectedBranches = [...memberBranches].map((branchId) => branchNames.get(branchId) || branchId).join('၊ ');
    if (!window.confirm(`ဒီဈေးနှုန်းပြောင်းလဲမှုသည် ${affectedBranches} ရှိ ${members.length} ခုသော Product များအားလုံးကို သက်ရောက်ပါမယ်။ ဆက်လက်ပြင်ဆင်မလား?`)) return;
    const priceChanged = Number(retail) !== group.retailPrice || Number(wholesale) !== group.wholesalePrice;
    const ok = updateSharedPriceGroup(group.id, { name, retailPrice: Number(retail), wholesalePrice: Number(wholesale), actorUid });
    if (!ok) { notify('ဈေးနှုန်း Update မအောင်မြင်ပါ။ ချိတ်ဆက်ထားသော Product အနည်းဆုံး ၂ ဆိုင်ရှိကြောင်း စစ်ပါ။'); return; }
    window.dispatchEvent(new Event('minimart-cloud-sync-requested'));
    notify(priceChanged ? `${name} ဈေးနှုန်း Version ${group.version + 1} ကို Update လုပ်ပြီးပါပြီ။` : `${name} အုပ်စုအမည်ကို ပြင်ဆင်ပြီးပါပြီ။`);
  };

  const attach = () => {
    if (!isSharedPriceCloudReady(actorUid)) {
      notify('Product ထပ်ချိတ်ရန် Internet နှင့် Owner Cloud Auto Sync Active ဖြစ်နေရပါမယ်။');
      return;
    }
    const refs = selectedKeys.map((key) => {
      const [branchId, ...rest] = key.split('::');
      return { branchId, productId: rest.join('::') };
    });
    if (!refs.length || !attachProductsToSharedPriceGroup(group.id, refs, actorUid)) { notify('Product ထပ်ချိတ်မရပါ။ Branch တစ်ခုမှာ Group ထဲရှိ Product တစ်မျိုးသာ ချိတ်နိုင်ပါတယ်။'); return; }
    window.dispatchEvent(new Event('minimart-cloud-sync-requested'));
    notify(`Product ${refs.length} မျိုးကို ${group.name} နဲ့ ချိတ်ပြီးပါပြီ။`);
    setSelectedKeys([]);
    setShowAttach(false);
  };

  const unlink = (product: Product) => {
    if (!isSharedPriceCloudReady(actorUid)) {
      notify('Product ချိတ်ဆက်မှုဖြုတ်ရန် Internet နှင့် Owner Cloud Auto Sync Active ဖြစ်နေရပါမယ်။');
      return;
    }
    const archiveWarning = members.length <= 2
      ? ' ဒီအုပ်စုမှာ Branch ၂ ခုသာရှိသောကြောင့် ကျန် Product ကိုလည်း သီးခြားပြောင်းပြီး Group ကို Archive လုပ်ပါမယ်။'
      : '';
    if (!window.confirm(`${branchNames.get(product.branchId || '') || 'ဒီဆိုင်'} မှ ${product.name} ကို ${group.name} ဈေးနှုန်းအုပ်စုမှ ဖြုတ်မလား? ဖြုတ်ပြီးနောက် လက်ရှိဈေးနှုန်းကို သီးခြားထိန်းသိမ်းပါမယ်။${archiveWarning}`)) return;
    if (!unlinkProductFromSharedPriceGroup(product.branchId || '', product.id, actorUid)) { notify('ချိတ်ဆက်မှု ဖြုတ်မရပါ။'); return; }
    window.dispatchEvent(new Event('minimart-cloud-sync-requested'));
    notify(`${product.name} ကို သီးခြားဈေးနှုန်းအဖြစ် ပြောင်းပြီးပါပြီ။`);
  };

  return <article className="shared-price-group-card">
    <div className="shared-price-group-header"><div><span className="tag tag-success">Shared · Version {group.version}</span><h4>{group.name}</h4><p>ချိတ်ဆက်ထားသော Branch {memberBranches.size} ခု · Product {members.length} မျိုး</p></div><div className="shared-price-group-icon"><Tags size={22}/></div></div>
    <div className="shared-price-edit-grid">
      <label>အုပ်စုအမည်<input value={name} onChange={(event) => setName(event.target.value)}/></label>
      <label>လက်လီဈေး (MMK)<input type="number" min="1" value={retail} onChange={(event) => setRetail(event.target.value)}/></label>
      <label>လက်ကားဈေး (MMK)<input type="number" min="0" value={wholesale} onChange={(event) => setWholesale(event.target.value)}/></label>
      <div className="shared-price-save"><button className="button button-primary" type="button" onClick={savePrices}><RefreshCw size={15}/> ဈေးနှုန်း Update</button></div>
    </div>
    <div className="shared-price-members"><strong>ချိတ်ဆက်ထားသော ဆိုင်ခွဲ Product များ</strong>{members.map((product) => <div className="shared-price-member" key={`${product.branchId}-${product.id}`}><span className="shared-price-member-icon"><Store size={16}/></span><span className="shared-price-member-name"><b>{product.name}</b><small>{branchNames.get(product.branchId || '') || 'Branch'} · SKU {product.sku || '—'} · Cost {money(product.costPrice)} · Stock {product.stock} {product.unit}</small></span><span className="shared-price-member-actions"><span className="tag">{money(product.retailPrice)}</span><button className="icon-btn danger-icon" title="ဈေးနှုန်းအုပ်စုမှ ဖြုတ်ရန်" type="button" onClick={() => unlink(product)}><Link2Off size={15}/></button></span></div>)}</div>
    <div className="shared-price-attach-actions"><button className="button button-outline" type="button" onClick={() => setShowAttach((current) => !current)}><Plus size={15}/>{showAttach ? 'ပိတ်ရန်' : 'Product ထပ်ချိတ်ရန်'} <ChevronDown size={14}/></button></div>
    {showAttach && <div className="shared-price-attach-panel"><p>ဒီ Group ထဲမှာ မပါသေးတဲ့ Branch တစ်ခုချင်းစီမှ Product ကို ရွေးပါ။ Branch တစ်ခုမှာ Product တစ်မျိုးသာ ချိတ်နိုင်ပါတယ်။</p>{candidates.length === 0 ? <p className="empty-inline">ထပ်ချိတ်နိုင်သော Product မရှိပါ။</p> : candidates.map((product) => {
      const key = refKey(product.branchId || '', product.id);
      const checked = selectedKeys.includes(key);
      const duplicateBranch = selectedKeys.some((selected) => selected.startsWith(`${product.branchId}::`) && selected !== key);
      return <label className="shared-price-candidate" key={key}><input type="checkbox" checked={checked} disabled={duplicateBranch} onChange={(event) => setSelectedKeys((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))}/><span className="shared-price-candidate-main"><strong>{product.name}</strong><small>{branchNames.get(product.branchId || '') || 'Branch'} · SKU {product.sku || '—'}</small></span><span className="shared-price-candidate-price"><b>{money(product.retailPrice)}</b><small>လက်ကား {money(product.wholesalePrice)}</small></span></label>;
    })}<div className="modal-actions"><button className="button button-outline" type="button" onClick={() => setShowAttach(false)}>ပယ်ဖျက်</button><button className="button button-primary" type="button" disabled={!selectedKeys.length} onClick={attach}><Link2 size={15}/> ရွေးထားသော Product ချိတ်ရန်</button></div></div>}
  </article>;
}
