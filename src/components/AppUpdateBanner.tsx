import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/** Non-blocking prompt shown after the service worker installs a new build.
 * Reloading is always explicit so an in-progress cart is never discarded. */
export function AppUpdateBanner() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onReady = () => { setReady(true); setDismissed(false); };
    window.addEventListener('minimart-app-update-ready', onReady);
    return () => window.removeEventListener('minimart-app-update-ready', onReady);
  }, []);

  if (!ready || dismissed) return null;

  return (
    <div className="app-update-banner" role="status">
      <RefreshCw size={17} />
      <span>App Version အသစ် ရရှိပါပြီ။ လက်ရှိ ငွေရှင်းမှု ပြီးမှ Update လုပ်ပါ။</span>
      <div className="app-update-actions">
        <button type="button" className="button button-primary" onClick={() => window.location.reload()}>Update လုပ်မယ်</button>
        <button type="button" className="button button-outline" onClick={() => setDismissed(true)}>နောက်မှ</button>
      </div>
    </div>
  );
}
