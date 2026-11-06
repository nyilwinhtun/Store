import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocFromServer, getDocs, runTransaction, updateDoc } from 'firebase/firestore';
import { BadgeCheck, Copy, KeyRound, LoaderCircle, LockKeyhole, Plus, RefreshCw, ShieldCheck, Store, Trash2, UserRound, UserX } from 'lucide-react';
import { FIREBASE_BUSINESS_ID, firebaseApp, firebaseAuth, firebaseConfig, firestore } from '../lib/firebase';
import { useBusinessAccess } from '../lib/businessAccess';
import { usePosStore, type Branch } from '../store/usePosStore';
import { recordFirestoreActivity } from '../lib/firestoreDiagnostics';

type ProvisionMode = 'create' | 'link';

type MemberRecord = {
  /** Canonical Firestore document ID; this must match Firebase Auth UID. */
  uid: string;
  /** UID stored inside the document, retained to detect legacy/mismatched records. */
  storedUid?: string;
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
    'auth/email-already-in-use': 'ဒီ Email နဲ့ Firebase Authentication Account ရှိပြီးသားပါ။ “ရှိပြီးသား Account ချိတ်ရန်” ကိုရွေးပြီး Firebase Console မှ UID ကိုထည့်ပါ။',
    'auth/invalid-email': 'Email ပုံစံ မမှန်ကန်ပါ။',
    'auth/weak-password': 'Password အနည်းဆုံး 6 လုံး ရှိရပါမယ်။',
    'permission-denied': 'Firestore Rules က ခွင့်မပြုပါ။ Owner Membership နဲ့ Rules ကို စစ်ပါ။',
    'auth/network-request-failed': 'Internet ချိတ်ဆက်မှု မရပါ။',
    'auth/operation-not-allowed': 'Firebase Authentication မှ Email/Password Sign-in ကို Enable လုပ်ထားပါ။',
    'auth/unauthorized-domain': 'ဒီ Website Domain ကို Firebase Authentication → Settings → Authorized domains မှာ ထည့်ပေးပါ။',
    'auth/too-many-requests': 'ကြိုးစားမှု များလွန်းနေပါတယ်။ ခဏနားပြီး ပြန်စမ်းပါ။',
    'member/already-exists': 'ဒီ UID အတွက် Business Member ရှိပြီးသားပါ။ Member စာရင်းကို ပြန်စစ်ပါ။',
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
  const [provisionMode, setProvisionMode] = useState<ProvisionMode>('create');
  const [existingUid, setExistingUid] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const activeBranches = useMemo(() => branches.filter((branch) => branch.status === 'active'), [branches]);
  const loadMembers = useCallback(async () => {
    if (!firestore || access.status !== 'active' || access.role !== 'owner') return;
    const snapshot = await getDocs(collection(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members'));
    if (!snapshot.metadata.fromCache) recordFirestoreActivity(access.uid, 'read', 'team-members-list', snapshot.size);
    const rows = snapshot.docs.map((entry) => {
      const data = entry.data();
      // Firestore document ID is the authoritative Auth UID. Do not let a stale
      // `uid` field inside the document overwrite it in the UI.
      return { ...data, uid: entry.id, storedUid: typeof data.uid === 'string' ? data.uid : '' } as MemberRecord;
    });
    rows.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.email.localeCompare(b.email)));
    setMembers(rows);
  }, [access.role, access.status]);

  useEffect(() => { void loadMembers().catch((reason: unknown) => setError(messageFor(reason))); }, [loadMembers]);

  const copyValue = async (value: string, label: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API မရရှိပါ။');
      await navigator.clipboard.writeText(value);
      setMessage(`${label} ကို ကူးယူပြီးပါပြီ။`);
      setError('');
    } catch {
      window.prompt(`${label} ကို ကိုယ်တိုင် Copy လုပ်ပါ။`, value);
    }
  };

  const verifyMember = async (member: MemberRecord) => {
    if (!firestore) return;
    setBusy(true); setError(''); setMessage('');
    const memberPath = `businesses/${FIREBASE_BUSINESS_ID}/members/${member.uid}`;
    try {
      const snapshot = await getDocFromServer(doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members', member.uid));
      recordFirestoreActivity(access.uid, 'read', 'team-member-verify', 1);
      if (!snapshot.exists()) {
        setError(`Member Document မတွေ့ပါ: ${memberPath}`);
        return;
      }
      const data = snapshot.data();
      const issues: string[] = [];
      if (data.uid !== member.uid) issues.push('Document ID နဲ့ uid Field မတူပါ');
      if (String(data.email || '').trim().toLowerCase() !== member.email.trim().toLowerCase()) issues.push('Email မကိုက်ညီပါ');
      if (data.role !== 'cashier') issues.push('Role သည် cashier မဟုတ်ပါ');
      if (data.status !== 'active') issues.push('Status သည် active မဟုတ်ပါ');
      if (!Array.isArray(data.branchIds) || data.branchIds.length !== 1 || typeof data.branchIds[0] !== 'string') issues.push('Branch တစ်ခုတည်း မသတ်မှတ်ထားပါ');
      if (issues.length) {
        setError(`Membership စစ်ဆေးရာတွင် မကိုက်ညီမှုရှိပါတယ်: ${issues.join('၊ ')}။ Path: ${memberPath}`);
        return;
      }
      setMessage(`Membership မှန်ကန်ကြောင်း Server မှ အတည်ပြုပြီးပါပြီ။ Cashier Login UID နဲ့ ဒီ Document ID ကို တိုက်စစ်ပါ: ${memberPath}`);
    } catch (reason) {
      setError(`Membership ကို Server မှ မစစ်နိုင်ပါ: ${messageFor(reason)} · ${memberPath}`);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (branchIds.length === 0 && activeBranches.length > 0) setBranchIds([activeBranches[0].id]);
  }, [activeBranches, branchIds.length]);

  if (access.status !== 'active' || access.role !== 'owner') return null;

  const validateMemberForm = () => {
    if (!firebaseApp || !firebaseAuth || !firestore) {
      setError('Firebase Configuration မပြည့်စုံပါ။');
      return false;
    }
    if (!email.trim() || !displayName.trim() || branchIds.length !== 1) {
      setError('အမည်၊ Email နဲ့ တာဝန်ယူမည့် ဆိုင်ခွဲ တစ်ခုတည်းကို ရွေးပါ။');
      return false;
    }
    if (provisionMode === 'create' && password.length < 6) {
      setError('Password အနည်းဆုံး 6 လုံး ရှိရပါမယ်။');
      return false;
    }
    if (provisionMode === 'link' && !existingUid.trim()) {
      setError('Firebase Authentication မှ Cashier UID ကို ထည့်ပါ။');
      return false;
    }
    return true;
  };

  const saveCashierMembership = async (uid: string) => {
    if (!firestore) throw new Error('Firebase Configuration မပြည့်စုံပါ။');
    const memberRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members', uid.trim());
    const now = new Date().toISOString();
    const memberData = {
      uid: uid.trim(),
      email: email.trim().toLowerCase(),
      displayName: displayName.trim(),
      role: 'cashier' as const,
      branchIds,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
      createdBy: access.uid,
    };

    await runTransaction(firestore, async (transaction) => {
      const existing = await transaction.get(memberRef);
      if (existing.exists()) {
        const current = existing.data();
        if (current.role === 'owner') {
          throw new Error('ဒီ UID သည် Owner Account ဖြစ်နေသောကြောင့် Cashier အဖြစ် ပြောင်းလို့မရပါ။');
        }
        const alreadyExists = new Error('ဒီ UID အတွက် Business Member ရှိပြီးသားပါ။ Member စာရင်းကို ပြန်စစ်ပါ။');
        (alreadyExists as Error & { code?: string }).code = 'member/already-exists';
        throw alreadyExists;
      }
      transaction.set(memberRef, memberData);
    });
    recordFirestoreActivity(access.uid, 'read', 'team-member-create-transaction', 1);
    recordFirestoreActivity(access.uid, 'write', 'team-member-create', 1);

    // Read the exact document back from the server. This catches a successful
    // Auth creation with a missing/wrongly keyed Business membership before
    // telling the Owner that the Cashier is ready to sign in.
    const savedMember = await getDocFromServer(memberRef);
    recordFirestoreActivity(access.uid, 'read', 'team-member-verify-after-save', 1);
    if (!savedMember.exists()) {
      throw new Error(`Firestore Member Record ပြန်စစ်ရာတွင် မတွေ့ပါ: businesses/${FIREBASE_BUSINESS_ID}/members/${uid.trim()}`);
    }
    const savedData = savedMember.data();
    if (savedData.uid !== uid.trim() || savedData.role !== 'cashier' || savedData.status !== 'active'
      || !Array.isArray(savedData.branchIds) || savedData.branchIds.length !== 1
      || String(savedData.email || '').trim().toLowerCase() !== email.trim().toLowerCase()) {
      throw new Error(`Firestore Member Record ရှိသော်လည်း UID / Email / Role / Branch အချက်အလက် မကိုက်ညီပါ။ Member Path: businesses/${FIREBASE_BUSINESS_ID}/members/${uid.trim()}`);
    }
  };

  const createCashier = async (event: FormEvent) => {
    event.preventDefault();
    if (provisionMode !== 'create' || !validateMemberForm()) return;

    setBusy(true); setError(''); setMessage('');
    const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const secondaryName = `cashier-provision-${randomId}`;
    let secondaryApp: ReturnType<typeof initializeApp> | null = null;
    let secondaryAuth: ReturnType<typeof getAuth> | null = null;
    let createdUid = '';
    let authAccountCreated = false;
    try {
      secondaryApp = initializeApp(firebaseConfig, secondaryName);
      secondaryAuth = getAuth(secondaryApp);
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password);
      createdUid = credential.user.uid;
      authAccountCreated = true;

      try {
        await saveCashierMembership(createdUid);
      } catch (writeError) {
        const code = typeof writeError === 'object' && writeError && 'code' in writeError
          ? String((writeError as { code: unknown }).code) : '';
        throw new Error(
          `Firebase Authentication မှာ Account ဖန်တီးပြီးပါပြီ (UID: ${createdUid})။ သို့သော် Firestore Member Record မသိမ်းနိုင်ပါ${code ? ` (${code})` : ''}။ Firestore Rules မှ Owner ကို businesses/${FIREBASE_BUSINESS_ID}/members ကို Create လုပ်ခွင့်ပေးထားသလား စစ်ပါ။ Account ကို ထပ်မဖန်တီးပါနဲ့။ “ရှိပြီးသား Account ချိတ်ရန်” ကိုသုံးပြီး ဒီ UID ကို Member အဖြစ် ချိတ်နိုင်ပါတယ်။`,
        );
      }

      setMessage(`Cashier Account ဖန်တီးပြီး Branch ချိတ်ဆက်ပြီးပါပြီ။ UID: ${createdUid} · Cashier ကို ဒီ Email နဲ့ Login ဝင်ခိုင်းပါ။`);
      setEmail(''); setDisplayName(''); setPassword(''); setExistingUid('');
      try { await loadMembers(); } catch (refreshError) { setError(`Account ဖန်တီးပြီးပါပြီ။ Member စာရင်းကိုသာ ပြန်မဖတ်နိုင်သေးပါ: ${messageFor(refreshError)}`); }
    } catch (reason) {
      // If Auth creation succeeded but the membership write failed, preserve the UID
      // and give the Owner a recovery route instead of silently hiding an orphan account.
      if (authAccountCreated && createdUid && reason instanceof Error && reason.message.includes('Firestore Member Record')) {
        setError(reason.message);
        setExistingUid(createdUid);
        setPassword('');
        setProvisionMode('link');
      } else {
        setError(messageFor(reason));
      }
    } finally {
      if (secondaryAuth) {
        try { await signOut(secondaryAuth); } catch { /* Secondary Auth cleanup is best-effort. */ }
      }
      if (secondaryApp) {
        try { await deleteApp(secondaryApp); } catch { /* Secondary app cleanup is best-effort. */ }
      }
      setBusy(false);
    }
  };

  const linkExistingCashier = async (event: FormEvent) => {
    event.preventDefault();
    if (provisionMode !== 'link' || !validateMemberForm()) return;

    setBusy(true); setError(''); setMessage('');
    try {
      await saveCashierMembership(existingUid.trim());
      setMessage(`ရှိပြီးသား Firebase Account ကို Cashier အဖြစ် ချိတ်ဆက်ပြီးပါပြီ။ UID: ${existingUid.trim()} · Member စာရင်းမှ Password Reset Email ပို့နိုင်ပါတယ်။`);
      setEmail(''); setDisplayName(''); setExistingUid('');
      try { await loadMembers(); } catch (refreshError) { setError(`Cashier ချိတ်ဆက်ပြီးပါပြီ။ Member စာရင်းကိုသာ ပြန်မဖတ်နိုင်သေးပါ: ${messageFor(refreshError)}`); }
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  };

  const setMemberStatus = async (member: MemberRecord, status: 'active' | 'disabled') => {
    if (!firestore || member.role !== 'cashier') return;
    if (status === 'active' && member.branchIds?.length !== 1) {
      setError('Cashier ကို ပြန်ဖွင့်မီ တာဝန်ယူမည့် Branch တစ်ခုတည်းကို အရင်ရွေးပေးပါ။');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      await updateDoc(doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members', member.uid), { status, updatedAt: new Date().toISOString() });
      recordFirestoreActivity(access.uid, 'write', 'team-member-status-update', 1);
      setMessage(`${member.displayName || member.email} ကို ${status === 'active' ? 'ပြန်ဖွင့်' : 'ပိတ်'} ပြီးပါပြီ။`);
      await loadMembers();
    } catch (reason) { setError(messageFor(reason)); }
    finally { setBusy(false); }
  };

  const reassignMemberBranch = async (member: MemberRecord, branchId: string) => {
    if (!firestore || member.role !== 'cashier' || !branchId || !activeBranches.some((branch) => branch.id === branchId)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await updateDoc(doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members', member.uid), {
        branchIds: [branchId], updatedAt: new Date().toISOString(),
      });
      recordFirestoreActivity(access.uid, 'write', 'team-member-branch-update', 1);
      setMembers((current) => current.map((entry) => entry.uid === member.uid ? { ...entry, branchIds: [branchId], updatedAt: new Date().toISOString() } : entry));
      const branchName = activeBranches.find((branch) => branch.id === branchId)?.name || branchId;
      setMessage(`${member.displayName || member.email} ကို ${branchName} ဆိုင်ခွဲတစ်ခုတည်းအတွက် သတ်မှတ်ပြီးပါပြီ။ Cashier ကို ပြန် Login ဝင်ခိုင်းပါ။`);
    } catch (reason) { setError(messageFor(reason)); }
    finally { setBusy(false); }
  };

  const removeInvalidPlaceholderMember = async (member: MemberRecord) => {
    // Only the known six-zero placeholder can be removed from this UI. Require
    // a separate, valid active Cashier document with the same email first.
    if (!firestore || access.role !== 'owner' || access.status !== 'active' || member.uid !== '000000' || member.role !== 'cashier') return;
    const validReplacement = members.find((candidate) => candidate.uid !== '000000'
      && candidate.role === 'cashier' && candidate.status === 'active'
      && candidate.uid.length >= 20
      && candidate.branchIds?.length === 1
      && candidate.email.trim().toLowerCase() === member.email.trim().toLowerCase());
    if (!validReplacement) {
      setError('ဒီ 000000 Record ကို မဖျက်နိုင်သေးပါ။ အရင်ဆုံး အဲဒီ Email နဲ့ မှန်ကန်တဲ့ Firebase UID Document တစ်ခု Active ဖြစ်နေကြောင်း Member စာရင်းမှာ အတည်ပြုပါ။');
      return;
    }
    const path = `businesses/${FIREBASE_BUSINESS_ID}/members/000000`;
    if (!window.confirm(`မှားနေသော Member Document တစ်ခုတည်းကို ဖယ်ရှားမလား?\n\nဖျက်မည့် Path: ${path}\nထိန်းသိမ်းမည့် UID: ${validReplacement.uid}\n\nFirebase Authentication Account ကို မဖျက်ပါ။`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const placeholderRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members', '000000');
      const latest = await getDocFromServer(placeholderRef);
      recordFirestoreActivity(access.uid, 'read', 'team-placeholder-delete-verify', 1);
      if (!latest.exists()) {
        setMessage('000000 Member Document မရှိတော့ပါ။ Member စာရင်းကို ပြန်ဖတ်ပါ။');
        await loadMembers();
        return;
      }
      const latestData = latest.data();
      if (latestData.role !== 'cashier' || String(latestData.email || '').trim().toLowerCase() !== member.email.trim().toLowerCase()) {
        throw new Error('Server မှ ပြန်စစ်ရာတွင် 000000 Document သည် ဒီ Cashier ရဲ့ မှားနေသော Record မဟုတ်ပါ။ မဖျက်ပါ။');
      }
      const replacementRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'members', validReplacement.uid);
      const replacement = await getDocFromServer(replacementRef);
      recordFirestoreActivity(access.uid, 'read', 'team-valid-member-before-cleanup', 1);
      if (!replacement.exists() || replacement.data().role !== 'cashier' || replacement.data().status !== 'active'
        || !Array.isArray(replacement.data().branchIds) || replacement.data().branchIds.length !== 1
        || String(replacement.data().email || '').trim().toLowerCase() !== member.email.trim().toLowerCase()) {
        throw new Error('မှန်ကန်သော Cashier Member Document ကို Server မှ အတည်မပြုနိုင်ပါ။ အဟောင်း Record ကို မဖျက်ပါ။');
      }
      await deleteDoc(placeholderRef);
      recordFirestoreActivity(access.uid, 'delete', 'team-invalid-placeholder-member', 1);
      setMessage('000000 Member Document ကိုသာ ဖယ်ရှားပြီးပါပြီ။ Firebase Authentication Account နဲ့ မှန်ကန်တဲ့ Cashier Member ကို မထိခိုက်ပါ။');
      await loadMembers();
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  };

  const resendReset = async (member: MemberRecord) => {
    if (!firebaseAuth || !member.email) return;
    setBusy(true); setError(''); setMessage('');
    try { await sendPasswordResetEmail(firebaseAuth, member.email); setMessage(`${member.email} သို့ Password Reset Email ပို့ပြီးပါပြီ။`); }
    catch (reason) { setError(messageFor(reason)); }
    finally { setBusy(false); }
  };

  return <section className="panel form-panel team-access-panel">
    <div className="panel-heading"><div className="panel-icon"><ShieldCheck size={18} /></div><div><h3>ဝန်ထမ်းအကောင့် / Branch Permission</h3><p>Owner က Cashier Account ဖန်တီးပြီး တာဝန်ယူမည့် ဆိုင်ခွဲတစ်ခုတည်းကို သတ်မှတ်နိုင်ပါတယ်။</p></div><span className="tag tag-success">Owner Only</span></div>
    <div className="cloud-help"><strong>Business ID: {FIREBASE_BUSINESS_ID}</strong><br />ဒီအပိုင်းမှာ Cashier Login Account နဲ့ Branch Membership ကို စီမံပါတယ်။ Account ဖန်တီးပြီးနောက် Member စာရင်းမှာ UID၊ Email နဲ့ Branch ခွင့်ပြုချက်ကို စစ်ဆေးနိုင်ပါတယ်။</div>

    <div className="form-panel team-create-form">
      <div className="panel-heading"><div className="panel-icon"><UserRound size={18} /></div><div><h4>Cashier Account စီမံရန်</h4><p>Account အသစ်ဖန်တီးနိုင်သလို Firebase Authentication မှာ ရှိပြီးသား Account ကိုလည်း UID နဲ့ ချိတ်နိုင်ပါတယ်။</p></div></div>
      <div className="team-branch-options" role="group" aria-label="Cashier Account နည်းလမ်းရွေးရန်">
        <button className={`button ${provisionMode === 'create' ? 'button-primary' : 'button-outline'}`} type="button" onClick={() => { setProvisionMode('create'); setError(''); setMessage(''); }} disabled={busy}>Account အသစ်ဖန်တီးရန်</button>
        <button className={`button ${provisionMode === 'link' ? 'button-primary' : 'button-outline'}`} type="button" onClick={() => { setProvisionMode('link'); setPassword(''); setError(''); setMessage(''); }} disabled={busy}>ရှိပြီးသား Account ချိတ်ရန်</button>
      </div>
      <form onSubmit={(event) => void (provisionMode === 'create' ? createCashier(event) : linkExistingCashier(event))}>
        <div className="form-grid">
          <label>ဝန်ထမ်းအမည် *<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Cashier အမည်" /></label>
          <label>Email *<input required type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="cashier@example.com" /></label>
          {provisionMode === 'create'
            ? <label>Password *<input required type="password" minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="အနည်းဆုံး 6 လုံး" /></label>
            : <label>Firebase Authentication UID *<input required autoComplete="off" value={existingUid} onChange={(event) => setExistingUid(event.target.value.trim())} placeholder="Firebase Console မှ UID ထည့်ပါ" /></label>}
        </div>
        {provisionMode === 'link' && <div className="cloud-help">ဒီနည်းလမ်းကို Firebase Authentication ထဲမှာ Account ရှိပြီးသားဖြစ်တဲ့အခါ သုံးပါ။ Firebase Console → Authentication → Users မှာ အဲဒီ Email ရဲ့ UID အတိအကျကို ကူးထည့်ပါ။ Password ကို ဒီနေရာမှာ မလိုပါ။ UID မမှန်ရင် Cashier Login ဝင်လို့မရပါ။</div>}
        <div className="team-branch-picker"><strong>တာဝန်ယူမည့် ဆိုင်ခွဲ (တစ်ခုတည်း) *</strong><label className="team-single-branch-select"><Store size={14} /><select required value={branchIds[0] || ''} onChange={(event) => setBranchIds(event.target.value ? [event.target.value] : [])}><option value="">ဆိုင်ခွဲ ရွေးပါ</option>{activeBranches.map((branch: Branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label></div>
        <button className="button button-primary" type="submit" disabled={busy || !email.trim() || !displayName.trim() || branchIds.length !== 1 || (provisionMode === 'create' ? password.length < 6 : !existingUid.trim())}>{busy ? <LoaderCircle className="spin-icon" size={15} /> : provisionMode === 'create' ? <Plus size={15} /> : <ShieldCheck size={15} />} {provisionMode === 'create' ? 'Cashier Account ဖန်တီးရန်' : 'ရှိပြီးသား Account ကို Cashier အဖြစ် ချိတ်ရန်'}</button>
      </form>
    </div>

    <div className="panel-heading team-list-heading"><div><h4>Member စာရင်း</h4><p>{members.length} accounts</p></div><button className="button button-outline" type="button" onClick={() => void loadMembers()} disabled={busy}><RefreshCw size={14} /> ပြန်စစ်ရန်</button></div>
    {members.length === 0 ? <div className="empty-state"><UserRound size={22} /><strong>Member မရှိသေးပါ</strong><p>Owner Account ကို Firestore မှာ အရင်အတည်ပြုပြီး Cashier အသစ် ဖန်တီးနိုင်ပါတယ်။</p></div> : <div className="team-member-list">{members.map((member) => <div className="team-member-row" key={member.uid}>
      <div className="team-member-avatar">{member.role === 'owner' ? <BadgeCheck size={18} /> : <UserRound size={18} />}</div>
      <div className="team-member-main"><strong>{member.displayName || member.email || member.uid}</strong><small>{member.email} · {member.role === 'owner' ? 'Owner' : 'Limited Cashier'}</small><small className="team-member-uid">Firestore Document UID: <code>{member.uid}</code><button className="team-copy-uid" type="button" onClick={() => void copyValue(member.uid, 'Firebase UID')} title="UID ကူးရန်"><Copy size={12} /> UID ကူးရန်</button></small>{member.storedUid && member.storedUid !== member.uid && <small className="team-member-branch-warning">သတိပြုရန်: Document ID နှင့် Document ထဲက uid Field မတူပါ။ Cashier Login UID ကို Document ID နဲ့ တိုက်စစ်ပါ။</small>}{member.role === 'owner' ? <small>ဆိုင်အားလုံး</small> : <label className="team-member-branch-assignment">တာဝန်ယူမည့် ဆိုင်ခွဲ <select value={member.branchIds?.length === 1 ? member.branchIds[0] : ''} onChange={(event) => void reassignMemberBranch(member, event.target.value)} disabled={busy}><option value="">ဆိုင်ခွဲတစ်ခု ရွေးချယ်ပါ</option>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}{member.role === 'cashier' && member.branchIds?.length !== 1 && <small className="team-member-branch-warning">Branch တစ်ခုတည်း သတ်မှတ်ရန် လိုအပ်ပါသည်။</small>}</div>
      <span className={`tag ${member.status === 'active' ? 'tag-success' : 'tag-warn'}`}>{member.status === 'active' ? 'Active' : 'Disabled'}</span>
      {member.role === 'cashier' && <div className="team-member-actions"><button className="small-action" type="button" onClick={() => void verifyMember(member)} disabled={busy} title="Firestore Member Path ကို Server မှ စစ်ရန်"><ShieldCheck size={14} /></button><button className="small-action" type="button" onClick={() => void copyValue(`businesses/${FIREBASE_BUSINESS_ID}/members/${member.uid}`, 'Member Path')} disabled={busy} title="Member Path ကူးရန်"><Copy size={14} /></button><button className="small-action" type="button" onClick={() => void resendReset(member)} disabled={busy} title="Password Reset Email ပို့ရန်"><KeyRound size={14} /></button><button className="small-action" type="button" onClick={() => void setMemberStatus(member, member.status === 'active' ? 'disabled' : 'active')} disabled={busy} title={member.status === 'active' ? 'ပိတ်ရန်' : 'ပြန်ဖွင့်ရန်'}>{member.status === 'active' ? <UserX size={14} /> : <BadgeCheck size={14} />}</button>{member.uid === '000000' && <button className="small-action small-action-danger" type="button" onClick={() => void removeInvalidPlaceholderMember(member)} disabled={busy} title="မှန်ကန်သော UID Member အစားထိုးရှိကြောင်း စစ်ပြီး 000000 Record ဖယ်ရှားရန်"><Trash2 size={14} /></button>}</div>}
    </div>)}</div>}
    {message && <div className="cloud-help">{message}</div>}
    {error && <div className="cloud-error">{error}</div>}
    <div className="backup-warning"><LockKeyhole size={17} /><span>Limited Cashier သည် သတ်မှတ်ထားသော Branch တစ်ခုတည်းမှာ POS နှင့် မိမိ၏ Sales History ကိုသာ အသုံးပြုနိုင်ပါတယ်။ Branch ပြောင်းလဲမှုကို Owner က ဒီနေရာမှာ ပြင်ဆင်နိုင်ပါတယ်။ Owner Device နဲ့ Cashier Device ကို သီးခြား Browser Profile / Device အသုံးပြုပါ။</span></div>
  </section>;
}
