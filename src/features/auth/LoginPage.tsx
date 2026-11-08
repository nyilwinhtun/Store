import { useState, type FormEvent } from 'react';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Store } from 'lucide-react';
import { firebaseAuth, firebaseConfigured } from '../../lib/firebase';

function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Email သို့မဟုတ် Password မှားနေပါတယ်။',
    'auth/invalid-email': 'Email ပုံစံ မမှန်ကန်ပါ။',
    'auth/user-disabled': 'ဒီ Account ကို ပိတ်ထားပါတယ်။ Owner ကို ဆက်သွယ်ပါ။',
    'auth/too-many-requests': 'Login ကြိုးစားမှု များနေပါတယ်။ ခဏနားပြီး ပြန်ကြိုးစားပါ။',
    'auth/network-request-failed': 'Internet ချိတ်ဆက်မှုကို စစ်ဆေးပါ။',
    'auth/operation-not-allowed': 'Firebase Console မှ Email/Password Authentication ကို ဖွင့်ထားကြောင်း စစ်ပါ။',
  };
  return messages[code] || (error instanceof Error ? error.message : 'Login မအောင်မြင်ပါ။ ပြန်စမ်းကြည့်ပါ။');
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firebaseAuth || !firebaseConfigured) {
      setError('Firebase Authentication ကို မချိတ်ဆက်နိုင်ပါ။ Configuration ကို စစ်ဆေးပါ။');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      setMessage('Login အောင်မြင်ပါပြီ။ သင့် Account Access ကို စစ်ဆေးနေပါတယ်။');
      setPassword('');
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!firebaseAuth || !email.trim()) {
      setError('Password Reset လုပ်ရန် Email Address အရင်ဖြည့်ပါ။');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      setMessage('Password ပြန်သတ်မှတ်ရန် Email ပို့ပြီးပါပြီ။ Inbox ကို စစ်ပါ။');
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-screen">
      <div className="login-layout">
        <section className="login-intro" aria-label="Minimart POS introduction">
          <div className="login-brand">
            <span className="login-brand-mark"><Store size={25} /></span>
            <span><strong>Mini<span>mart</span></strong><small>POS MANAGEMENT</small></span>
          </div>
          <div className="login-intro-copy">
            <span className="login-overline">SMART STORE MANAGEMENT</span>
            <h1>ဆိုင်လုပ်ငန်းကို<br />တစ်နေရာတည်းမှာ<br /><em>စီမံခန့်ခွဲပါ။</em></h1>
            <p>အရောင်း၊ ပစ္စည်းစာရင်း၊ ငွေစာရင်းနဲ့ ဆိုင်ခွဲများကို လုံခြုံစွာ စီမံနိုင်မယ့် Minimart POS စနစ်။</p>
          </div>
          <div className="login-intro-footer">
            <ShieldCheck size={17} />
            <span>Owner နှင့် ခွင့်ပြုထားသော ဝန်ထမ်းများအတွက်သာ</span>
          </div>
          <div className="login-decoration login-decoration-one" />
          <div className="login-decoration login-decoration-two" />
        </section>

        <section className="login-card" aria-labelledby="login-heading">
          <div className="login-card-heading">
            <span className="login-card-icon"><LockKeyhole size={21} /></span>
            <div>
              <span className="login-overline">SECURE ACCESS</span>
              <h2 id="login-heading">ပြန်လည်ကြိုဆိုပါတယ်</h2>
              <p>ရှိပြီးသား Account ဖြင့် ဝင်ရောက်ပါ။</p>
            </div>
          </div>

          {!firebaseConfigured || !firebaseAuth ? (
            <div className="login-alert is-error" role="alert">Firebase Configuration မပြည့်စုံသေးပါ။ Developer ကို ဆက်သွယ်ပါ။</div>
          ) : (
            <form className="login-form" onSubmit={(event) => void submit(event)}>
              <label className="login-field">
                <span>Email Address</span>
                <span className="login-input-wrap"><Mail size={17} /><input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></span>
              </label>
              <label className="login-field">
                <span>Password</span>
                <span className="login-input-wrap"><LockKeyhole size={17} /><input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password ထည့်ပါ" /><button className="login-password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Password ဖျောက်ရန်' : 'Password ပြရန်'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
              </label>
              <div className="login-form-extra">
                <span>သင့် Account ကို လုံခြုံစွာ အသုံးပြုပါ။</span>
                <button type="button" onClick={() => void resetPassword()} disabled={busy}>Password မေ့သွားပါသလား?</button>
              </div>
              <button className="login-submit" type="submit" disabled={busy}>
                <span>{busy ? 'စစ်ဆေးနေပါတယ်…' : 'Login ဝင်မယ်'}</span>
                <ArrowRight size={18} />
              </button>
            </form>
          )}

          {error && <div className="login-alert is-error" role="alert">{error}</div>}
          {message && <div className="login-alert is-success" role="status">{message}</div>}

          {firebaseConfigured && firebaseAuth && <div className="login-bottom-links">
            <p>Account အသစ်ဖန်တီးခြင်းကို Login စာမျက်နှာမှ ပိတ်ထားပါတယ်။ ဝင်ရောက်ခွင့်ရှိပြီးသား Owner သို့မဟုတ် Cashier Account ကိုသာ အသုံးပြုပါ။</p>
          </div>}
          <div className="login-card-footer">MINIMART POS <span>•</span> MULTI-BRANCH WORKSPACE</div>
        </section>
      </div>
    </main>
  );
}
