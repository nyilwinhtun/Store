import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { AccessBootstrap } from './components/AccessBootstrap';
import { OwnerAutoSyncProvider } from './components/OwnerAutoSync';

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Minimart POS render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f4f8f6', color: '#172b2a', fontFamily: 'Inter, Pyidaungsu, sans-serif' }}>
          <section style={{ maxWidth: 440, width: '100%', padding: 28, borderRadius: 18, background: '#ffffff', border: '1px solid #e2e8f0', textAlign: 'center', boxShadow: '0 12px 36px rgba(26,54,63,.08)' }}>
            <h1 style={{ margin: '0 0 10px', fontSize: 20 }}>App ကို ဖွင့်ရာတွင် အမှားဖြစ်နေပါသည်</h1>
            <p style={{ margin: '0 0 20px', color: '#64748b', lineHeight: 1.7, fontSize: 14 }}>သင့်ရဲ့ ရောင်းအားနဲ့ ပစ္စည်းစာရင်းတွေကို မဖျက်ပါနှင့်။ စာမျက်နှာကို ပြန်ဖွင့်ကြည့်ပါ။ အမှားဆက်ဖြစ်ပါက Developer Console မှ Error ကို စစ်ဆေးပါ။</p>
            <button type="button" onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, padding: '11px 18px', background: '#0f766e', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>ပြန်ဖွင့်မယ်</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error: unknown) => {
      console.error('Service worker registration failed:', error);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    {/* These two providers own Firebase side effects. Keep them outside React
        StrictMode so development-only effect replay cannot open duplicate
        Firestore listeners during local testing. The visible app stays strict. */}
    <AccessBootstrap />
    <OwnerAutoSyncProvider />
    <StrictMode>
      <App />
    </StrictMode>
  </AppErrorBoundary>,
);
