import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  onAuthStateChanged,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  AlertTriangle, BadgeCheck, Camera, CheckCircle2, Cloud, HardDrive, ImagePlus, LogOut, Save, ShieldCheck, Store, UserRound, Image as ImageIcon,
} from 'lucide-react';
import { firebaseAuth, firebaseConfigured } from '../lib/firebase';
import { migrateDataUrlImage, saveLocalImage, useLocalImageSource } from '../lib/localImages';
import { usePosStore } from '../store/usePosStore';
import { TeamAccessPanel } from './TeamAccessPanel';

type ShopDraft = {
  name: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  receiptHeader: string;
  receiptFooter: string;
  logoUrl: string;
  bannerUrl: string;
};

type OwnerDraft = { displayName: string; phone: string; photoUrl: string };
type UploadPhase = 'idle' | 'compressing' | 'saving' | 'local' | 'error';
type UploadState = { phase: UploadPhase; progress: number; message: string };

const emptyUploadState: UploadState = { phase: 'idle', progress: 0, message: '' };

const compressImage = async (file: File): Promise<Blob> => {
  if (!file.type.startsWith('image/')) throw new Error('ပုံဖိုင်သာ ရွေးချယ်နိုင်ပါတယ်။');
  if (file.size > 8 * 1024 * 1024) throw new Error('မူရင်းပုံဖိုင် 8 MB ထက် မကြီးရပါ။');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('ပုံဖိုင်ကို ဖတ်မရပါ။ JPG, PNG သို့မဟုတ် WebP ပုံကို ပြန်ရွေးပါ။'));
      element.src = objectUrl;
    });
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('ပုံပြင်ဆင်မှု မအောင်မြင်ပါ။ Browser ကို ပြန်ဖွင့်ကြည့်ပါ။');
    // Preserve transparent logo backgrounds when WebP is supported.
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.76, 0.68, 0.60, 0.52, 0.44]) {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('ပုံဖိုင်ကို ချုံ့မရပါ။')), 'image/webp', quality);
      });
      if (blob.size <= 450 * 1024) return blob;
    }
    throw new Error('ပုံဖိုင်ကို 450 KB အောက်အထိ ချုံ့မရပါ။ ပိုသေးတဲ့ပုံကို ရွေးပါ။');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const getErrorMessage = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Email သို့မဟုတ် Password မှားနေပါတယ်။',
    'auth/email-already-in-use': 'ဒီ Email နဲ့ Account ရှိပြီးသားပါ။ Login ဝင်ပါ။',
    'auth/weak-password': 'Password အနည်းဆုံး 6 လုံး ထည့်ပါ။',
    'auth/invalid-email': 'Email ပုံစံ မမှန်ကန်ပါ။',
    'auth/network-request-failed': 'Internet ချိတ်ဆက်မှုကို စစ်ဆေးပါ။',
      };
  return messages[code] || (error instanceof Error ? error.message : 'လုပ်ဆောင်မှု မအောင်မြင်ပါ။');
};


function UploadStatus({ state }: { state: UploadState }) {
  if (state.phase === 'idle' && !state.message) return null;
  const isWorking = state.phase === 'compressing' || state.phase === 'saving';
  const isLocal = state.phase === 'local';
  const isError = state.phase === 'error';
  return <div className={`profile-upload-status ${isError ? 'is-error' : isLocal ? 'is-local' : 'is-working'}`} role="status" aria-live="polite">
    <div className="profile-upload-status-line">
      {isLocal ? <CheckCircle2 size={14} /> : isWorking ? <HardDrive size={14} /> : <AlertTriangle size={14} />}
      <span>{state.message || (state.phase === 'compressing' ? 'ပုံကို ချုံ့နေပါတယ်…' : 'ဒီ Device ထဲ သိမ်းဆည်းနေပါတယ်…')}</span>
    </div>
    {state.phase === 'saving' && <div className="profile-upload-track is-indeterminate"><span /></div>}
  </div>;
}

export function ProfileManagementPage({ authorize, notify }: { authorize: (action: string) => boolean; notify: (message: string) => void }) {
  const branches = usePosStore((state) => state.branches);
  const activeBranchId = usePosStore((state) => state.activeBranchId);
  const branch = branches.find((item) => item.id === activeBranchId);
  const updateBranch = usePosStore((state) => state.updateBranch);
  const ownerProfile = usePosStore((state) => state.ownerProfile);
  const updateOwnerProfile = usePosStore((state) => state.updateOwnerProfile);
  const [shopDraft, setShopDraft] = useState<ShopDraft>({ name: '', ownerName: '', phone: '', email: '', address: '', currency: 'MMK', receiptHeader: '', receiptFooter: '', logoUrl: '', bannerUrl: '' });
  const [ownerDraft, setOwnerDraft] = useState<OwnerDraft>({ displayName: '', phone: '', photoUrl: '' });
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [shopUpload, setShopUpload] = useState<UploadState>(emptyUploadState);
  const [ownerUpload, setOwnerUpload] = useState<UploadState>(emptyUploadState);
  const [bannerUpload, setBannerUpload] = useState<UploadState>(emptyUploadState);
  const [shopPreview, setShopPreview] = useState('');
  const [ownerPreview, setOwnerPreview] = useState('');
  const [bannerPreview, setBannerPreview] = useState('');
  const shopUploadToken = useRef(0);
  const ownerUploadToken = useRef(0);
  const bannerUploadToken = useRef(0);
  const shopLogoInput = useRef<HTMLInputElement>(null);
  const ownerPhotoInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const isShopUploading = shopUpload.phase === 'compressing' || shopUpload.phase === 'saving';
  const isOwnerUploading = ownerUpload.phase === 'compressing' || ownerUpload.phase === 'saving';
  const isBannerUploading = bannerUpload.phase === 'compressing' || bannerUpload.phase === 'saving';
  const storedShopLogoSource = useLocalImageSource(shopDraft.logoUrl);
  const storedBannerSource = useLocalImageSource(shopDraft.bannerUrl);
  const storedOwnerPhotoSource = useLocalImageSource(ownerDraft.photoUrl);

  useEffect(() => {
    if (!firebaseAuth) return;
    return onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      if (nextUser?.displayName) {
        setOwnerDraft((current) => ({ ...current, displayName: current.displayName || nextUser.displayName || '' }));
      }
    });
  }, []);

  useEffect(() => () => {
    if (shopPreview.startsWith('blob:')) URL.revokeObjectURL(shopPreview);
    if (ownerPreview.startsWith('blob:')) URL.revokeObjectURL(ownerPreview);
    if (bannerPreview.startsWith('blob:')) URL.revokeObjectURL(bannerPreview);
  }, [shopPreview, ownerPreview, bannerPreview]);

  useEffect(() => {
    if (!branch) return;
    setShopDraft({
      name: branch.name || branch.settings.storeName || '', ownerName: branch.ownerName || '', phone: branch.phone || '', email: branch.email || '',
      address: branch.address || '', currency: branch.settings.currency || 'MMK', receiptHeader: branch.settings.receiptHeader || '',
      receiptFooter: branch.settings.receiptFooter || '', logoUrl: branch.logoUrl || '', bannerUrl: branch.bannerUrl || '',
    });
    setShopPreview('');
    setBannerPreview('');
    setShopUpload(branch.logoUrl ? { phase: 'local', progress: 100, message: 'Logo ကို ဒီ Device ရဲ့ IndexedDB ထဲမှာ သိမ်းထားပါတယ်။' } : emptyUploadState);
    setBannerUpload(branch.bannerUrl ? { phase: 'local', progress: 100, message: 'Banner ကို ဒီ Device ရဲ့ IndexedDB ထဲမှာ သိမ်းထားပါတယ်။' } : emptyUploadState);
  }, [branch]);

  useEffect(() => {
    const nextOwner = {
      displayName: typeof ownerProfile?.displayName === 'string' ? ownerProfile.displayName : '',
      phone: typeof ownerProfile?.phone === 'string' ? ownerProfile.phone : '',
      photoUrl: typeof ownerProfile?.photoUrl === 'string' ? ownerProfile.photoUrl : '',
    };
    setOwnerDraft(nextOwner);
    setOwnerPreview('');
    setOwnerUpload(nextOwner.photoUrl ? { phase: 'local', progress: 100, message: 'Profile ဓာတ်ပုံကို ဒီ Device ရဲ့ IndexedDB ထဲမှာ သိမ်းထားပါတယ်။' } : emptyUploadState);
  }, [ownerProfile]);

  // One-time migration for images saved as large data URLs by earlier versions.
  useEffect(() => {
    const legacy = branch?.logoUrl || '';
    if (!branch || !legacy.startsWith('data:image/')) return;
    const branchId = branch.id;
    void migrateDataUrlImage(legacy, `migrated-${branchId}-logo`).then((reference) => {
      const current = usePosStore.getState().branches.find((item) => item.id === branchId);
      if (current?.logoUrl === legacy) updateBranch(branchId, { logoUrl: reference });
    }).catch((reason: unknown) => setError(getErrorMessage(reason)));
  }, [branch?.id, branch?.logoUrl, updateBranch]);

  useEffect(() => {
    const legacy = branch?.bannerUrl || '';
    if (!branch || !legacy.startsWith('data:image/')) return;
    const branchId = branch.id;
    void migrateDataUrlImage(legacy, `migrated-${branchId}-banner`).then((reference) => {
      const current = usePosStore.getState().branches.find((item) => item.id === branchId);
      if (current?.bannerUrl === legacy) updateBranch(branchId, { bannerUrl: reference });
    }).catch((reason: unknown) => setError(getErrorMessage(reason)));
  }, [branch?.id, branch?.bannerUrl, updateBranch]);

  useEffect(() => {
    const legacy = ownerProfile?.photoUrl || '';
    if (!legacy.startsWith('data:image/')) return;
    void migrateDataUrlImage(legacy, 'migrated-owner-profile-photo').then((reference) => {
      const current = usePosStore.getState().ownerProfile;
      if (current.photoUrl === legacy) updateOwnerProfile({ photoUrl: reference });
    }).catch((reason: unknown) => setError(getErrorMessage(reason)));
  }, [ownerProfile?.photoUrl, updateOwnerProfile]);

  const startShopUpload = async (file: File) => {
    const token = ++shopUploadToken.current;
    setError('');
    setShopPreview((previous) => { if (previous.startsWith('blob:')) URL.revokeObjectURL(previous); return URL.createObjectURL(file); });
    setShopUpload({ phase: 'compressing', progress: 0, message: 'Logo ကို ချုံ့နေပါတယ်…' });
    try {
      const blob = await compressImage(file);
      if (token !== shopUploadToken.current) return;
      setShopUpload({ phase: 'saving', progress: 35, message: 'Logo ကို ဒီ Device ထဲ သိမ်းနေပါတယ်…' });
      const reference = await saveLocalImage(`branch-${activeBranchId}-logo-${Date.now()}`, blob);
      if (token !== shopUploadToken.current) return;
      setShopDraft((current) => ({ ...current, logoUrl: reference }));
      setShopUpload({ phase: 'local', progress: 100, message: `Logo သိမ်းဆည်းပြီးပါပြီ။ (${Math.max(1, Math.round(blob.size / 1024))} KB) Shop Profile ကို Save လုပ်ပါ။` });
      notify('Shop Logo ကို ဒီ Device ထဲ သိမ်းပြီးပါပြီ။ Shop Profile ကို Save လုပ်ပါ။');
      setShopPreview((previous) => { if (previous.startsWith('blob:')) URL.revokeObjectURL(previous); return ''; });
    } catch (reason) {
      if (token !== shopUploadToken.current) return;
      setShopUpload({ phase: 'error', progress: 0, message: getErrorMessage(reason) });
      setError(getErrorMessage(reason));
    }
  };

  const startBannerUpload = async (file: File) => {
    const token = ++bannerUploadToken.current;
    setError('');
    setBannerPreview((previous) => { if (previous.startsWith('blob:')) URL.revokeObjectURL(previous); return URL.createObjectURL(file); });
    setBannerUpload({ phase: 'compressing', progress: 0, message: 'Banner ကို ချုံ့နေပါတယ်…' });
    try {
      const blob = await compressImage(file);
      if (token !== bannerUploadToken.current) return;
      setBannerUpload({ phase: 'saving', progress: 35, message: 'Banner ကို ဒီ Device ထဲ သိမ်းနေပါတယ်…' });
      const reference = await saveLocalImage(`branch-${activeBranchId}-banner-${Date.now()}`, blob);
      if (token !== bannerUploadToken.current) return;
      setShopDraft((current) => ({ ...current, bannerUrl: reference }));
      setBannerUpload({ phase: 'local', progress: 100, message: `Banner သိမ်းဆည်းပြီးပါပြီ။ (${Math.max(1, Math.round(blob.size / 1024))} KB) Shop Profile ကို Save လုပ်ပါ။` });
      notify('Shop Banner ကို ဒီ Device ထဲ သိမ်းပြီးပါပြီ။ Shop Profile ကို Save လုပ်ပါ။');
      setBannerPreview((previous) => { if (previous.startsWith('blob:')) URL.revokeObjectURL(previous); return ''; });
    } catch (reason) {
      if (token !== bannerUploadToken.current) return;
      setBannerUpload({ phase: 'error', progress: 0, message: getErrorMessage(reason) });
      setError(getErrorMessage(reason));
    }
  };

  const startOwnerUpload = async (file: File) => {
    const token = ++ownerUploadToken.current;
    setError('');
    setOwnerPreview((previous) => { if (previous.startsWith('blob:')) URL.revokeObjectURL(previous); return URL.createObjectURL(file); });
    setOwnerUpload({ phase: 'compressing', progress: 0, message: 'Profile ဓာတ်ပုံကို ချုံ့နေပါတယ်…' });
    try {
      const blob = await compressImage(file);
      if (token !== ownerUploadToken.current) return;
      setOwnerUpload({ phase: 'saving', progress: 35, message: 'Profile ဓာတ်ပုံကို ဒီ Device ထဲ သိမ်းနေပါတယ်…' });
      const reference = await saveLocalImage(`owner-profile-photo-${Date.now()}`, blob);
      if (token !== ownerUploadToken.current) return;
      setOwnerDraft((current) => ({ ...current, photoUrl: reference }));
      setOwnerUpload({ phase: 'local', progress: 100, message: `Profile ဓာတ်ပုံ သိမ်းဆည်းပြီးပါပြီ။ (${Math.max(1, Math.round(blob.size / 1024))} KB) Owner Profile ကို Save လုပ်ပါ။` });
      notify('Owner Profile ဓာတ်ပုံကို ဒီ Device ထဲ သိမ်းပြီးပါပြီ။ Profile ကို Save လုပ်ပါ။');
      setOwnerPreview((previous) => { if (previous.startsWith('blob:')) URL.revokeObjectURL(previous); return ''; });
    } catch (reason) {
      if (token !== ownerUploadToken.current) return;
      setOwnerUpload({ phase: 'error', progress: 0, message: getErrorMessage(reason) });
      setError(getErrorMessage(reason));
    }
  };

  const chooseShopLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void startShopUpload(file);
    event.target.value = '';
  };

  const chooseOwnerPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void startOwnerUpload(file);
    event.target.value = '';
  };

  const chooseBanner = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void startBannerUpload(file);
    event.target.value = '';
  };

  const saveShopProfile = (event: FormEvent) => {
    event.preventDefault();
    if (!branch || !authorize('Shop Profile ပြင်ဆင်ရန်')) return;
    if (isShopUploading || isBannerUploading) { notify('ပုံသိမ်းဆည်းနေဆဲဖြစ်လို့ ပြီးမှ သိမ်းပါ။'); return; }
    if (!shopDraft.name.trim()) { notify('ဆိုင်အမည် ဖြည့်ပါ။'); return; }
    if (branches.some((item) => item.id !== activeBranchId && item.status === 'active' && item.name.trim().toLocaleLowerCase() === shopDraft.name.trim().toLocaleLowerCase())) { notify('ဒီအမည်နဲ့ Active ဆိုင် ရှိပြီးသားပါ။'); return; }
    updateBranch(activeBranchId, {
      name: shopDraft.name.trim(), ownerName: shopDraft.ownerName.trim(), phone: shopDraft.phone.trim(),
      email: shopDraft.email.trim(), address: shopDraft.address.trim(), logoUrl: shopDraft.logoUrl, bannerUrl: shopDraft.bannerUrl,
      settings: { storeName: shopDraft.name.trim(), currency: shopDraft.currency.trim().toUpperCase() || 'MMK', receiptHeader: shopDraft.receiptHeader.trim(), receiptFooter: shopDraft.receiptFooter.trim() },
    });
    notify('ဆိုင် Profile ကို သိမ်းဆည်းပြီးပါပြီ။');
  };

  const saveOwnerProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!authorize('Owner Profile ပြင်ဆင်ရန်')) return;
    if (isOwnerUploading) { notify('Profile ဓာတ်ပုံ တင်နေဆဲဖြစ်လို့ ပြီးမှ သိမ်းပါ။'); return; }
    if (!ownerDraft.displayName.trim()) { notify('Owner အမည် ဖြည့်ပါ။'); return; }
    setBusy(true); setError('');
    try {
      if (user && firebaseAuth) {
        const remotePhoto = ownerDraft.photoUrl.startsWith('https://') ? ownerDraft.photoUrl : user.photoURL;
        await updateProfile(firebaseAuth.currentUser || user, { displayName: ownerDraft.displayName.trim(), photoURL: remotePhoto || null });
      }
      updateOwnerProfile({ displayName: ownerDraft.displayName.trim(), phone: ownerDraft.phone.trim(), photoUrl: ownerDraft.photoUrl });
      notify('Owner Profile ကို သိမ်းဆည်းပြီးပါပြီ။');
    } catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  const signOutAccount = async () => {
    if (!firebaseAuth) return;
    if (!window.confirm('ဒီလုပ်ဆောင်ချက်သည် လက်ရှိ Minimart App တစ်ခုလုံး၏ Firebase Account ကို Sign Out လုပ်ပါမည်။ ပြီးနောက် Website ရဲ့ ပထမစာမျက်နှာရှိ Login နေရာသို့ ပြန်ရောက်ပါမယ်။ ဆက်လုပ်မလား။')) return;
    setBusy(true); setError(''); setStatus('');
    try { await signOut(firebaseAuth); setStatus('App Firebase Account မှ Sign Out လုပ်ပြီးပါပြီ။'); }
    catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  };

  if (!branch) return <div className="panel">လက်ရှိဆိုင်အချက်အလက် မတွေ့ပါ။</div>;

  const shopPreviewSource = shopPreview || storedShopLogoSource;
  const bannerPreviewSource = bannerPreview || storedBannerSource;
  const ownerPreviewSource = ownerPreview || storedOwnerPhotoSource;

  return <section className="page-stack profile-page">
    <div className="section-heading">
      <div><h2>Profile Management</h2><p>ဆိုင်အချက်အလက်၊ Receipt Profile နဲ့ Owner Account ကို စီမံပါ။</p></div>
      <span className="sales-summary-chip"><ShieldCheck size={15} /> {branch.name}</span>
    </div>

    <div className="profile-grid">
      <form className="panel form-panel profile-panel" onSubmit={saveShopProfile}>
        <div className="panel-heading"><div className="panel-icon"><Store size={18} /></div><div><h3>Shop Profile</h3><p>လက်ရှိရွေးထားတဲ့ ဆိုင်အတွက်သာ သိမ်းဆည်းပါမယ်။</p></div></div>
        <div className="profile-image-row">
          <div className="shop-logo-preview">{shopPreviewSource ? <img src={shopPreviewSource} alt="Shop logo preview" /> : <Store size={28} />}</div>
          <div className="profile-image-actions"><strong>ဆိုင် Logo</strong><small>JPG / PNG / WebP · 8 MB အောက်။ ရွေးပြီးတာနဲ့ Preview ချက်ချင်းပြပါမယ်။ ဒီ Device ထဲမှာ အခမဲ့သိမ်းပါမယ်။</small><button className="button button-outline" type="button" disabled={busy || isShopUploading} onClick={() => shopLogoInput.current?.click()}><ImagePlus size={15} /> Logo ရွေးရန်</button><input ref={shopLogoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={chooseShopLogo} /></div>
        </div>
        <UploadStatus state={shopUpload} />
        <div className="profile-image-row profile-banner-row"><div className="profile-banner-preview">{bannerPreviewSource ? <img src={bannerPreviewSource} alt="Shop banner preview" /> : <ImageIcon size={24} />}</div><div className="profile-image-actions"><strong>ဆိုင် Banner</strong><small>JPG / PNG / WebP · 8 MB အောက်။ ဒီ Device ထဲမှာ အခမဲ့သိမ်းပါမယ်။</small><button className="button button-outline" type="button" disabled={busy || isBannerUploading} onClick={() => bannerInput.current?.click()}><ImagePlus size={15} /> Banner ရွေးရန်</button><input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={chooseBanner} /></div></div>
        <UploadStatus state={bannerUpload} />
        <label>ဆိုင်အမည် *<input required value={shopDraft.name} onChange={(event) => setShopDraft({ ...shopDraft, name: event.target.value })} placeholder="ဥပမာ - မြို့မ Minimart" /></label>
        <label>ပိုင်ရှင်အမည်<input value={shopDraft.ownerName} onChange={(event) => setShopDraft({ ...shopDraft, ownerName: event.target.value })} placeholder="ဆိုင်ပိုင်ရှင်အမည်" /></label>
        <div className="form-grid">
          <label>ဖုန်းနံပါတ်<input value={shopDraft.phone} onChange={(event) => setShopDraft({ ...shopDraft, phone: event.target.value })} placeholder="09..." /></label>
          <label>Email<input type="email" value={shopDraft.email} onChange={(event) => setShopDraft({ ...shopDraft, email: event.target.value })} placeholder="shop@example.com" /></label>
          <label>ငွေကြေးအတိုကောက်<input value={shopDraft.currency} onChange={(event) => setShopDraft({ ...shopDraft, currency: event.target.value })} placeholder="MMK" /></label>
          <label>Receipt Header<input value={shopDraft.receiptHeader} onChange={(event) => setShopDraft({ ...shopDraft, receiptHeader: event.target.value })} placeholder="မင်္ဂလာပါ / ဆိုင်ကြော်ငြာစာသား" /></label>
          <label className="span-2">ဆိုင်လိပ်စာ<textarea rows={2} value={shopDraft.address} onChange={(event) => setShopDraft({ ...shopDraft, address: event.target.value })} placeholder="မြို့နယ်၊ ရပ်ကွက်၊ လမ်း..." /></label>
          <label className="span-2">Receipt အောက်ခြေစာသား<textarea rows={2} value={shopDraft.receiptFooter} onChange={(event) => setShopDraft({ ...shopDraft, receiptFooter: event.target.value })} placeholder="ကျေးဇူးတင်ပါတယ်။" /></label>
        </div>
        <div className="profile-form-actions"><button className="button button-primary" type="submit" disabled={busy || isShopUploading || isBannerUploading}><Save size={15} /> Shop Profile သိမ်းမယ်</button></div>
      </form>

      <div className="page-stack profile-side-column">
        <form className="panel form-panel profile-panel" onSubmit={saveOwnerProfile}>
          <div className="panel-heading"><div className="panel-icon"><UserRound size={18} /></div><div><h3>Owner Profile</h3><p>ပိုင်ရှင်အမည်နဲ့ Profile ဓာတ်ပုံ။</p></div></div>
          <div className="profile-image-row">
            <div className="owner-avatar-preview">{ownerPreviewSource ? <img src={ownerPreviewSource} alt="Owner profile preview" /> : <UserRound size={28} />}</div>
            <div className="profile-image-actions"><strong>Profile ဓာတ်ပုံ</strong><small>JPG / PNG / WebP · 8 MB အောက်။ ရွေးပြီးတာနဲ့ Preview ချက်ချင်းပြပါမယ်။ ဒီ Device ထဲမှာ အခမဲ့သိမ်းပါမယ်။</small><button className="button button-outline" type="button" disabled={busy || isOwnerUploading} onClick={() => ownerPhotoInput.current?.click()}><Camera size={15} /> ဓာတ်ပုံရွေးရန်</button><input ref={ownerPhotoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={chooseOwnerPhoto} /></div>
          </div>
          <UploadStatus state={ownerUpload} />
          <label>ပိုင်ရှင်အမည် *<input required value={ownerDraft.displayName} onChange={(event) => setOwnerDraft({ ...ownerDraft, displayName: event.target.value })} placeholder="Owner အမည်" /></label>
          <label>ဆက်သွယ်ရန် ဖုန်း<input value={ownerDraft.phone} onChange={(event) => setOwnerDraft({ ...ownerDraft, phone: event.target.value })} placeholder="09..." /></label>
          <div className="profile-form-actions"><button className="button button-primary" type="submit" disabled={busy || isOwnerUploading}><Save size={15} /> Owner Profile သိမ်းမယ်</button></div>
        </form>

        <div className="panel form-panel profile-panel">
          <div className="panel-heading"><div className="panel-icon"><Cloud size={18} /></div><div><h3>Firebase Business Account</h3><p>Owner နဲ့ Cashier နှစ်မျိုးလုံးအတွက် တူညီတဲ့ Login နေရာ။</p></div></div>
          {!firebaseConfigured || !firebaseAuth ? <div className="cloud-error">Firebase Configuration မပြည့်စုံသေးပါ။</div> : user ? <>
            <div className="profile-account-status"><BadgeCheck size={19} /><div><strong>Account ချိတ်ဆက်ထားသည်</strong><small>{user.email || user.uid}</small></div></div>
            <div className="profile-account-meta"><span>Display Name</span><strong>{user.displayName || 'မသတ်မှတ်ရသေး'}</strong><span>UID</span><code>{user.uid}</code></div>
            <button className="button button-outline" type="button" onClick={() => void signOutAccount()} disabled={busy}><LogOut size={15} /> App Account Sign Out</button>
          </> : <div className="cloud-help">Login ဝင်ရန် Website ရဲ့ ပထမစာမျက်နှာရှိ Sign In ကို အသုံးပြုပါ။ Public Account Registration ကို ပိတ်ထားပါတယ်။<br /><br />Logo၊ Banner နဲ့ Profile ဓာတ်ပုံတွေကို Firebase Storage မသုံးဘဲ ဒီ Device ရဲ့ IndexedDB ထဲမှာ အခမဲ့သိမ်းထားပါတယ်။ Device တခြားတစ်ခုသို့ ပြောင်းသုံးမယ်ဆို JSON Backup ကို ပုံတွေနဲ့အတူ Restore လုပ်ပါ။</div>}
          <div className="cloud-help">ဝင်ခွင့်ရှိသူများမှာ Owner နဲ့ Owner က သတ်မှတ်ထားသော Active Cashier များသာ ဖြစ်ပါတယ်။</div>
        </div>
      </div>
    </div>
    <TeamAccessPanel />
    {(status || error) && <div className={error ? 'cloud-error' : 'cloud-help'}>{error || status}</div>}
    <div className="panel security-note"><ShieldCheck size={18} /><div><strong>Data သိမ်းဆည်းမှု</strong><p>Shop Profile ကို ဆိုင်ခွဲတစ်ခုချင်းစီရဲ့ Branch Data ထဲမှာ သိမ်းထားပါတယ်။ Logo၊ Banner နဲ့ Owner Profile ပုံတွေကို IndexedDB Local Storage ထဲမှာ သိမ်းထားပြီး JSON Backup ထဲမှာပါ ထည့်ပေးပါတယ်။ Firebase Storage Billing မလိုပါ။ ပုံဖိုင်တွေက ဒီ Device မှာသာရှိတဲ့အတွက် Device အသစ်သို့ ပြောင်းရာမှာ JSON Backup/Restore လုပ်ပါ။</p></div></div>
  </section>;
}
