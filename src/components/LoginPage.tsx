import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, LogIn, ShieldCheck, Store } from 'lucide-react';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { firebaseAuth, firebaseConfigured } from '../lib/firebase';

type LoginPageProps = { configurationError?: string };

type LoginPhase = 'idle' | 'authenticating' | 'checking' | 'error';

const INVALID_CREDENTIAL_MESSAGE = 'Email သို့မဟုတ် Password မှားနေပါတယ်။ ပြန်စစ်ပြီး ကြိုးစားပါ။';

function authMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  const messages: Record<string, string> = {
    'auth/invalid-credential': INVALID_CREDENTIAL_MESSAGE,
    // Never reveal whether the email or the password was wrong.
    'auth/user-not-found': INVALID_CREDENTIAL_MESSAGE,
    'auth/wrong-password': INVALID_CREDENTIAL_MESSAGE,
    'auth/user-disabled': 'ဒီ Account ကို ပိတ်ထားပါတယ်။ Owner ကို ဆက်သွယ်ပါ။',
    'auth/invalid-email': 'Email ပုံစံ မမှန်ပါ။',
    'auth/missing-email': 'Email ကို အရင် ဖြည့်ပါ။',
    'auth/missing-password': 'Password ကို အရင် ဖြည့်ပါ။',
    'auth/too-many-requests': 'Login ကြိုးစားမှု များလွန်းနေပါတယ်။ ခဏနားပြီး ပြန်စမ်းပါ။',
    'auth/network-request-failed': 'Internet ချိတ်ဆက်မှုကို စစ်ဆေးပါ။',
    'auth/timeout': 'Server တုံ့ပြန်မှု ကြန့်ကြာနေပါတယ်။ Internet ကို စစ်ပြီး ပြန်စမ်းပါ။',
    'auth/quota-exceeded': 'ဒီနေ့အတွက် ခွင့်ပြုထားသော ကြိုးစားမှု ပမာဏ ပြည့်နေပါတယ်။ ခဏနားပြီး ပြန်စမ်းပါ။',
    'auth/unauthorized-domain': 'ဒီ Website Domain ကို Firebase Authentication Authorized Domains ထဲ ထည့်ပေးပါ။',
    'auth/operation-not-allowed': 'Firebase Console မှ Email/Password Sign-in ကို ဖွင့်ထားရန် လိုအပ်ပါတယ်။',
    'auth/admin-restricted-operation': 'အကောင့်အသစ်ဖွင့်ခြင်းကို ပိတ်ထားပါတယ်။ လုပ်ငန်းပိုင်ရှင်ထံမှ အကောင့်ရယူပါ။',
    'auth/requires-recent-login': 'လုံခြုံရေးအတွက် ပြန်လည် Sign In ဝင်ပြီးမှ ဒီလုပ်ဆောင်ချက်ကို ပြန်စမ်းပါ။',
    'auth/internal-error': 'Server က Owner / Active Cashier ခွင့်ပြုချက်ကို အတည်မပြုနိုင်ပါ သို့မဟုတ် Account ဝင်ခွင့်မရှိပါ။ Identity Platform Blocking Functions Deploy အခြေအနေကို စစ်ဆေးပါ။',
  };
  if (code.startsWith('auth/api-key-not-valid') || code === 'auth/invalid-api-key') {
    return 'Firebase API Key မမှန်ပါ။ Developer ကို ဆက်သွယ်ပါ။';
  }
  return messages[code] || (error instanceof Error ? error.message : 'Login မအောင်မြင်ပါ။ ထပ်မံကြိုးစားပါ။');
}

export function LoginPage({ configurationError }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState<LoginPhase>('idle');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const resetEmailRef = useRef<HTMLInputElement>(null);

  const busy = phase === 'authenticating' || phase === 'checking' || resetBusy;
  const fieldsDisabled = busy || !!configurationError;

  // Autofocus is a desktop convenience only; on phones it would pop the
  // keyboard over the compact layout before the user sees the form.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine) and (min-width: 900px)').matches) emailRef.current?.focus();
  }, []);

  useEffect(() => {
    const dialog = resetDialogRef.current;
    if (!dialog) return;
    if (resetOpen && !dialog.open) {
      dialog.showModal();
      resetEmailRef.current?.focus();
    } else if (!resetOpen && dialog.open) {
      dialog.close();
    }
  }, [resetOpen]);

  const closeReset = () => {
    if (resetBusy) return;
    setResetOpen(false);
    setResetFeedback(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firebaseConfigured || !firebaseAuth) {
      setError('Firebase Authentication Configuration မရရှိပါ။ Developer ကို ဆက်သွယ်ပါ။');
      setPhase('error');
      return;
    }
    if (!email.trim() || !password) {
      setError('Email နဲ့ Password နှစ်ခုလုံး ဖြည့်ပါ။');
      setPhase('error');
      return;
    }
    setPhase('authenticating');
    setError('');
    setMessage('');
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      setPassword('');
      setPhase('checking');
      setMessage('Login အောင်မြင်ပါပြီ။ Owner / Cashier ခွင့်ပြုချက်ကို စစ်ဆေးနေပါတယ်…');
    } catch (reason) {
      setError(authMessage(reason));
      setPhase('error');
    }
  };

  const openReset = () => {
    setResetEmail(email.trim());
    setResetFeedback(null);
    setResetOpen(true);
  };

  const sendReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firebaseAuth) {
      setResetFeedback({ tone: 'error', text: 'Firebase Authentication Configuration မရရှိပါ။' });
      return;
    }
    if (!resetEmail.trim()) {
      setResetFeedback({ tone: 'error', text: 'Password ပြန်သတ်မှတ်ရန် Email ကို ဖြည့်ပါ။' });
      return;
    }
    setResetBusy(true);
    setResetFeedback(null);
    try {
      await sendPasswordResetEmail(firebaseAuth, resetEmail.trim());
      setResetFeedback({ tone: 'success', text: 'Password ပြန်သတ်မှတ်ရန် Email ပို့ပြီးပါပြီ။ Inbox နှင့် Spam Folder ကို စစ်ဆေးပါ။' });
    } catch (reason) {
      setResetFeedback({ tone: 'error', text: authMessage(reason) });
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <main className="public-login-screen">
      <section className="public-login-layout">
        <div className="public-login-brand-panel">
          <div className="public-login-brand-mark"><Store size={28} /></div>
          <h1>Minimart POS</h1>
          <p className="public-login-brand-copy">အရောင်း၊ ပစ္စည်းစာရင်းနှင့် ဆိုင်ခွဲငွေစာရင်းများကို တစ်နေရာတည်းမှ စီမံခန့်ခွဲပါ။</p>
          <div className="public-login-security-note"><ShieldCheck size={18} /><span>ခွင့်ပြုထားသော Owner နှင့် Cashier များသာ ဝင်ရောက်နိုင်သည်။</span></div>
        </div>

        <div className="public-login-card">
          <div className="public-login-card-heading">
            <div className="public-login-icon"><LockKeyhole size={20} /></div>
            <div><h2>အကောင့်ဝင်ရန်</h2><span>လုပ်ငန်းအကောင့်ဖြင့် ဝင်ရောက်ပါ။</span></div>
          </div>
          {configurationError && <div className="public-login-alert is-error" role="alert">{configurationError}</div>}
          <form className="public-login-form" onSubmit={(event) => void submit(event)} aria-busy={phase === 'authenticating'}>
            <label>Email Address
              <input ref={emailRef} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="name@example.com" required disabled={fieldsDisabled} aria-describedby={error ? 'login-auth-error' : undefined} />
            </label>
            <label>Password
              <span className="public-login-password-wrap">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="သင့် Password" required disabled={fieldsDisabled} aria-describedby={error ? 'login-auth-error' : undefined} />
                <button type="button" className="public-login-eye" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Password ဖျောက်ရန်' : 'Password ပြရန်'} disabled={busy}><span>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</span></button>
              </span>
            </label>
            {error && <div id="login-auth-error" className="public-login-alert is-error" role="alert">{error}</div>}
            <button className="public-login-submit" type="submit" disabled={fieldsDisabled} aria-busy={phase === 'authenticating'}>
              {phase === 'authenticating'
                ? <><span className="public-login-spinner" aria-hidden="true" /> စစ်ဆေးနေပါတယ်…</>
                : phase === 'checking'
                  ? <><CheckCircle2 size={17} /> ခွင့်ပြုချက် စစ်ဆေးနေပါတယ်…</>
                  : <><LogIn size={17} /> ဝင်မယ်</>}
            </button>
          </form>
          <button type="button" className="public-login-reset" onClick={openReset} disabled={fieldsDisabled}><KeyRound size={14} /> Password မေ့သွားပါသလား?</button>
          {message && <div className="public-login-alert is-success" role="status" aria-live="polite"><CheckCircle2 size={15} /><span>{message}</span></div>}
          <div className="public-login-no-signup"><LockKeyhole size={14} /><span>အကောင့်အသစ်လိုအပ်ပါက လုပ်ငန်းပိုင်ရှင်ထံ ဆက်သွယ်ပါ။</span></div>
        </div>
      </section>

      <dialog
        ref={resetDialogRef}
        className="public-login-dialog"
        aria-labelledby="login-reset-title"
        aria-describedby="login-reset-copy"
        onCancel={(event) => { if (resetBusy) event.preventDefault(); else closeReset(); }}
        onClick={(event) => { if (event.target === resetDialogRef.current && !resetBusy) closeReset(); }}
      >
        <div className="public-login-dialog-heading">
          <div className="public-login-icon"><KeyRound size={19} /></div>
          <div><h2 id="login-reset-title">Password ပြန်သတ်မှတ်ရန်</h2><p id="login-reset-copy">Firebase က ဒီ Email သို့ ပြန်သတ်မှတ်ရန် Link ပို့ပါမယ်။</p></div>
        </div>
        <form className="public-login-dialog-form" onSubmit={(event) => void sendReset(event)} aria-busy={resetBusy}>
          <label>Email Address
            <input ref={resetEmailRef} type="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} autoComplete="username" placeholder="name@example.com" required disabled={resetBusy} />
          </label>
          {resetFeedback && (
            <div className={`public-login-alert is-${resetFeedback.tone === 'success' ? 'success' : 'error'}`} role={resetFeedback.tone === 'success' ? 'status' : 'alert'} aria-live="polite">
              {resetFeedback.tone === 'success' && <CheckCircle2 size={15} />}<span>{resetFeedback.text}</span>
            </div>
          )}
          <div className="public-login-dialog-actions">
            <button type="button" className="public-login-dialog-cancel" onClick={closeReset} disabled={resetBusy}>မလုပ်တော့ပါ</button>
            <button type="submit" className="public-login-submit" disabled={resetBusy}>
              {resetBusy ? <><span className="public-login-spinner" aria-hidden="true" /> ပို့နေပါတယ်…</> : <><KeyRound size={15} /> Reset Email ပို့မယ်</>}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
