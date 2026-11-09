import { useState, type FormEvent } from 'react';
import { LockKeyhole, LogIn, ShieldCheck, Store, Eye, EyeOff, KeyRound } from 'lucide-react';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { firebaseAuth, firebaseConfigured } from '../lib/firebase';

type LoginPageProps = { configurationError?: string };

function authMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Email သို့မဟုတ် Password မှားနေပါတယ်။ ပြန်စစ်ပြီး ကြိုးစားပါ။',
    'auth/user-disabled': 'ဒီ Account ကို ပိတ်ထားပါတယ်။ Owner ကို ဆက်သွယ်ပါ။',
    'auth/user-not-found': 'ဒီ Account မရှိပါ။ Owner က ခွင့်ပြုထားတဲ့ Account ကိုသာ အသုံးပြုပါ။',
    'auth/wrong-password': 'Password မှားနေပါတယ်။',
    'auth/invalid-email': 'Email ပုံစံ မမှန်ပါ။',
    'auth/too-many-requests': 'Login ကြိုးစားမှု များလွန်းနေပါတယ်။ ခဏနားပြီး ပြန်စမ်းပါ။',
    'auth/network-request-failed': 'Internet ချိတ်ဆက်မှုကို စစ်ဆေးပါ။',
    'auth/unauthorized-domain': 'ဒီ Website Domain ကို Firebase Authentication Authorized Domains ထဲ ထည့်ပေးပါ။',
    'auth/operation-not-allowed': 'Firebase Console မှ Email/Password Sign-in ကို ဖွင့်ထားရန် လိုအပ်ပါတယ်။',
    'auth/admin-restricted-operation': 'အကောင့်အသစ်ဖွင့်ခြင်းကို ပိတ်ထားပါတယ်။ လုပ်ငန်းပိုင်ရှင်ထံမှ အကောင့်ရယူပါ။',
    'auth/internal-error': 'Server က Owner / Active Cashier ခွင့်ပြုချက်ကို အတည်မပြုနိုင်ပါ သို့မဟုတ် Account ဝင်ခွင့်မရှိပါ။ Identity Platform Blocking Functions Deploy အခြေအနေကို စစ်ဆေးပါ။',
  };
  return messages[code] || (error instanceof Error ? error.message : 'Login မအောင်မြင်ပါ။ ထပ်မံကြိုးစားပါ။');
}

export function LoginPage({ configurationError }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firebaseConfigured || !firebaseAuth) {
      setError('Firebase Authentication Configuration မရရှိပါ။ Developer ကို ဆက်သွယ်ပါ။');
      return;
    }
    if (!email.trim() || !password) {
      setError('Email နဲ့ Password နှစ်ခုလုံး ဖြည့်ပါ။');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      setMessage('Login အောင်မြင်ပါပြီ။ Owner / Cashier ခွင့်ပြုချက်ကို စစ်ဆေးနေပါတယ်…');
      setPassword('');
    } catch (reason) {
      setError(authMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!firebaseAuth || !email.trim()) {
      setError('Password ပြန်သတ်မှတ်ရန် Email ကို အရင်ဖြည့်ပါ။');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      setMessage('Password ပြန်သတ်မှတ်ရန် Email ပို့ပြီးပါပြီ။ Inbox ကို စစ်ဆေးပါ။');
    } catch (reason) {
      setError(authMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="public-login-screen">
      <section className="public-login-layout">
        <div className="public-login-brand-panel">
          <div className="public-login-brand-mark"><Store size={28} /></div>
          <p className="public-login-eyebrow">RETAIL MANAGEMENT</p>
          <h1>Minimart POS</h1>
          <p className="public-login-brand-copy">အရောင်း၊ ကုန်ပစ္စည်း၊ ဆိုင်ခွဲနှင့် ငွေစာရင်းများကို တစ်နေရာတည်းမှ စီမံခန့်ခွဲပါ။</p>
          <div className="public-login-security-note"><ShieldCheck size={18} /><span>ခွင့်ပြုထားသော Owner နှင့် Cashier များသာ ဝင်ရောက်နိုင်သည်။</span></div>
        </div>

        <div className="public-login-card">
          <div className="public-login-card-heading">
            <div className="public-login-icon"><LockKeyhole size={20} /></div>
            <div><p>WELCOME BACK</p><h2>အကောင့်ဝင်ရန်</h2><span>လုပ်ငန်းအကောင့်ဖြင့် Sign In ဝင်ပါ။</span></div>
          </div>
          {configurationError && <div className="public-login-alert is-error" role="alert">{configurationError}</div>}
          <form className="public-login-form" onSubmit={(event) => void submit(event)}>
            <label>Email Address
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="name@example.com" required disabled={busy || !!configurationError} />
            </label>
            <label>Password
              <span className="public-login-password-wrap">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="သင့် Password" required disabled={busy || !!configurationError} />
                <button type="button" className="public-login-eye" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Password ဖျောက်ရန်' : 'Password ပြရန်'} disabled={busy}><span>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</span></button>
              </span>
            </label>
            <button className="public-login-submit" type="submit" disabled={busy || !!configurationError}>
              <LogIn size={17} /> {busy ? 'စစ်ဆေးနေပါတယ်…' : 'Sign In ဝင်မယ်'}
            </button>
          </form>
          <button type="button" className="public-login-reset" onClick={() => void resetPassword()} disabled={busy || !!configurationError}><KeyRound size={14} /> Password မေ့သွားပါသလား?</button>
          {error && <div className="public-login-alert is-error" role="alert">{error}</div>}
          {message && <div className="public-login-alert is-success" role="status">{message}</div>}
          <div className="public-login-no-signup"><LockKeyhole size={14} /><span>Public Account Registration ပိတ်ထားသည်။ Account လိုအပ်ပါက လုပ်ငန်းပိုင်ရှင်ထံ ဆက်သွယ်ပါ။</span></div>
          <div className="public-login-footer">© {new Date().getFullYear()} Minimart POS · Authorized Access Only</div>
        </div>
      </section>
    </main>
  );
}
