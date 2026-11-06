import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, deleteUser, getAuth, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { collection, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { BadgeCheck, KeyRound, LoaderCircle, LockKeyhole, Plus, RefreshCw, ShieldCheck, Store, UserRound, UserX } from 'lucide-react';
import { FIREBASE_BUSINESS_ID, firebaseApp, firebaseAuth, firebaseConfig, firestore } from '../lib/firebase';
import { useBusinessAccess } from '../lib/businessAccess';
import { usePosStore, type Branch } from '../store/usePosStore';

type MemberRecord = {
  uid: string;
  email: string;
  displayName: string;
  role: 'owner' | 'cashier';
  branchIds: string[];
  status: 'active' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
};

function messageFor(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'ဒီ Email နဲ့ Firebase Account ရှိပြီးသားပါ။ အဲဒီ UID ကို Firebase Console မှာ Member အဖြစ် သတ်မှတ်ပါ။',
    'auth/invalid-email': 'Email ပုံစံ မမှန်ကန်ပါ။',
    'auth/weak-password': 'Password အနည်းဆုံး 6 လုံး ရှိရပါမယ်။',
    'permission-denied': 'Firestore Rules က ခွင့်မပြုပါ။ Owner Membership နဲ့ Rules ကို စစ်ပါ။',
    'auth/network-request-failed': 'Internet ချိတ်ဆက်မှု မရပါ။',
  };
  return messages[code] || (error instanceof Error ? error.message : 'လုပ်ဆောင်မှု မအောင်မြင်ပါ။');
}

export function TeamAccessPanel() {
  const access = useBusinessAccess();
  const branches = usePosStore((state) => state.branches);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const activeBranches = useMemo(() => branches.filter((branch) => branch.status === 'active'), [branches]);
  const loadMembers = useCallback(async () => {
    if (!firestore || access.status !== 'active' || access.role !== 'owner') return;
    const snapshot = await getDocs(collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members'));
    const rows = snapshot.docs.map((entry) => ({ uid: entry.id, ...entry.data() } as MemberRecord));
    rows.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.email.localeCompare(b.email)));
    setMembers(rows);
  }, [access.role, access.status]);

  useEffect(() => { void loadMembers().catch((reason: unknown) => setError(messageFor(reason))); }, [loadMembers]);
  useEffect(() => {
    if (branchIds.length === 0 && activeBranches.length > 0) setBranchIds([activeBranches[0].id]);
  }, [activeBranches, branchIds.length]);

  if (access.status !== 'active' || access.role !== 'owner') return null;

  const toggleBranch = (id: string) => setBranchIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  const createCashier = async (event: FormEvent) => {
    event.preventDefault();
    if (!firebaseApp || !firebaseAuth || !firestore) { setError('Firebase Configuration မပြည့်စုံပါ။'); return; }
    if (!email.trim() || !displayName.trim() || password.length < 6 || branchIds.length === 0) {
      setError('အမည်၊ Email၊ Password (အနည်းဆုံး 6 လုံး) နဲ့ ဆိုင်တစ်ဆိုင် အနည်းဆုံး ရွေးပါ။');
      return;
    }

    setBusy(true); setError(''); setMessage('');
    const secondaryName = `cashier-provision-${crypto.randomUUID()}`;
    let secondaryApp: ReturnType<typeof initializeApp> | null = null;
    try {
      secondaryApp = initializeApp(firebaseConfig, secondaryName);
      const secondaryAuth = getAuth(secondaryApp);
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password);
      const now = new Date().toISOString();
      try {
        await setDoc(doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members', credential.user.uid), {
          uid: credential.user.uid,
          email: email.trim().toLowerCase(),
          displayName: displayName.trim(),
          role: 'cashier',
          branchIds,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          createdBy: access.uid,
        });
      } catch (writeError) {
        // Avoid leaving an orphan Auth account when Firestore membership creation fails.
        try { await deleteUser(credential.user); } catch { /* Owner can reconcile from Firebase Console if recent-login deletion is rejected. */ }
        throw writeError;
      }
      await signOut(secondaryAuth);
      setMessage(`Cashier Account ဖန်တီးပြီးပါပြီ။ UID: ${credential.user.uid} · Password ကို လုံခြုံစွာ ပေးပို့ပြီး ပထမဆုံး Login ပြီးနောက် Reset လုပ်ခိုင်းပါ။`);
      setEmail(''); setDisplayName(''); setPassword('');
      await loadMembers();
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      if (secondaryApp) {
        try { await deleteApp(secondaryApp); } catch { /* Secondary app cleanup is best-effort. */ }
      }
      setBusy(false);
    }
  };

  const setMemberStatus = async (member: MemberRecord, status: 'active' | 'disabled') => {
    if (!firestore || member.role !== 'cashier') return;
    setBusy(true); setError(''); setMessage('');
    try {
      await updateDoc(doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members', member.uid), { status, updatedAt: new Date().toISOString() });
      setMessage(`${member.displayName || member.email} ကို ${status === 'active' ? 'ပြန်ဖွင့်' : 'ပိတ်'} ပြီးပါပြီ။`);
      await loadMembers();
    } catch (reason) { setError(messageFor(reason)); }
    finally { setBusy(false); }
  };

  const resendReset = async (member: MemberRecord) => {
    if (!firebaseAuth || !member.email) return;
    setBusy(true); setError(''); setMessage('');
    try { await sendPasswordResetEmail(firebaseAuth, member.email); setMessage(`${member.email} သို့ Password Reset Email ပို့ပြီးပါပြီ။`); }
    catch (reason) { setError(messageFor(reason)); }
    finally { setBusy(false); }
  };

  return <section className="panel form-panel team-access-panel">
    <div className="panel-heading"><div className="panel-icon"><ShieldCheck size={18} /></div><div><h3>ဝန်ထမ်းအကောင့် / Branch Permission</h3><p>Owner က Cashier Account ဖန်တီးပြီး တာဝန်ယူမည့်ဆိုင်ကို သတ်မှတ်နိုင်ပါတယ်။</p></div><span className="tag tag-success">Owner Only</span></div>
    <div className="cloud-help"><strong>Business ID: {FIREBASE_BUSINESS_ID}</strong><br />ဒီအပိုင်းမှာ Cashier Login Account နဲ့ Branch Membership ကို စီမံပါတယ်။ လက်ရှိ Cloud Sync ဟာ Account တစ်ခုချင်းစီအလိုက်ဖြစ်နေဆဲဖြစ်ပြီး Shared Business Real-time Sync ကို နောက် Phase မှာ ချိတ်ဆက်ပါမယ်။</div>

    <form className="form-panel team-create-form" onSubmit={(event) => void createCashier(event)}>
      <div className="panel-heading"><div className="panel-icon"><UserRound size={18} /></div><div><h4>Cashier အသစ် ဖန်တီးရန်</h4><p>တခြား Firebase Account နဲ့ ပဋိပက္ခမဖြစ်အောင် Secondary Auth App သုံးထားပါတယ်။</p></div></div>
      <div className="form-grid">
        <label>ဝန်ထမ်းအမည် *<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Cashier အမည်" /></label>
        <label>Email *<input required type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="cashier@example.com" /></label>
        <label>Password *<input required type="password" minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="အနည်းဆုံး 6 လုံး" /></label>
      </div>
      <div className="team-branch-picker"><strong>တာဝန်ယူမည့် ဆိုင်များ *</strong><div className="team-branch-options">{activeBranches.map((branch: Branch) => <label key={branch.id}><input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => toggleBranch(branch.id)} /><Store size={14} /> {branch.name}</label>)}</div></div>
      <button className="button button-primary" type="submit" disabled={busy || !email.trim() || !displayName.trim() || password.length < 6 || branchIds.length === 0}>{busy ? <LoaderCircle className="spin-icon" size={15} /> : <Plus size={15} />} Cashier Account ဖန်တီးရန်</button>
    </form>

    <div className="panel-heading team-list-heading"><div><h4>Member စာရင်း</h4><p>{members.length} accounts</p></div><button className="button button-outline" type="button" onClick={() => void loadMembers()} disabled={busy}><RefreshCw size={14} /> ပြန်စစ်ရန်</button></div>
    {members.length === 0 ? <div className="empty-state"><UserRound size={22} /><strong>Member မရှိသေးပါ</strong><p>Owner Account ကို Firestore မှာ အရင်အတည်ပြုပြီး Cashier အသစ် ဖန်တီးနိုင်ပါတယ်။</p></div> : <div className="team-member-list">{members.map((member) => <div className="team-member-row" key={member.uid}>
      <div className="team-member-avatar">{member.role === 'owner' ? <BadgeCheck size={18} /> : <UserRound size={18} />}</div>
      <div className="team-member-main"><strong>{member.displayName || member.email || member.uid}</strong><small>{member.email} · {member.role === 'owner' ? 'Owner' : 'Cashier'}</small><small>{member.role === 'owner' ? 'ဆိုင်အားလုံး' : member.branchIds.map((id) => branches.find((branch) => branch.id === id)?.name || id).join('၊ ')}</small></div>
      <span className={`tag ${member.status === 'active' ? 'tag-success' : 'tag-warn'}`}>{member.status === 'active' ? 'Active' : 'Disabled'}</span>
      {member.role === 'cashier' && <div className="team-member-actions"><button className="small-action" type="button" onClick={() => void resendReset(member)} disabled={busy} title="Password Reset Email ပို့ရန်"><KeyRound size={14} /></button><button className="small-action" type="button" onClick={() => void setMemberStatus(member, member.status === 'active' ? 'disabled' : 'active')} disabled={busy} title={member.status === 'active' ? 'ပိတ်ရန်' : 'ပြန်ဖွင့်ရန်'}>{member.status === 'active' ? <UserX size={14} /> : <BadgeCheck size={14} />}</button></div>}
    </div>)}</div>}
    {message && <div className="cloud-help">{message}</div>}
    {error && <div className="cloud-error">{error}</div>}
    <div className="backup-warning"><LockKeyhole size={17} /><span>Cashier ကို သတ်မှတ်ထားသော Branch များအတွင်းသာ App UI အသုံးပြုခွင့်ပေးထားပါတယ်။ တကယ့် Cloud Data လုံခြုံရေးအတွက် Firestore Rules ကို Publish လုပ်ရပါမယ်။ Owner Device နဲ့ Cashier Device ကို သီးခြား Browser Profile / Device အသုံးပြုပါ။</span></div>
  </section>;
}
