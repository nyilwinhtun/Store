import { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, AlertTriangle, CheckCircle2, CircleHelp } from 'lucide-react';
import { AUTO_SYNC_STATUS_EVENT, autoSyncStatusKey, readAutoSyncStatus, type AutoSyncStatus } from '../lib/autoSyncStatus';

export function OwnerAutoSyncStatus({ userUid }: { userUid: string }) {
  const [status, setStatus] = useState<AutoSyncStatus>(() => readAutoSyncStatus(userUid));
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ uid?: string; status?: AutoSyncStatus }>).detail;
      if (detail?.uid === userUid && detail.status) setStatus(detail.status);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === autoSyncStatusKey(userUid)) setStatus(readAutoSyncStatus(userUid));
    };
    setStatus(readAutoSyncStatus(userUid));
    window.addEventListener(AUTO_SYNC_STATUS_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(AUTO_SYNC_STATUS_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [userUid]);

  const icon = status.state === 'synced' ? <CheckCircle2 size={16} />
    : status.state === 'offline' ? <CloudOff size={16} />
      : status.state === 'conflict' ? <AlertTriangle size={16} />
        : status.state === 'error' ? <CircleHelp size={16} />
          : status.state === 'idle' ? <Cloud size={16} /> : <RefreshCw size={16} className="spin-icon" />;
  const label = status.state === 'synced' ? 'Auto Sync Active'
    : status.state === 'offline' ? 'Offline · Pending Sync'
      : status.state === 'conflict' ? 'Sync Conflict'
        : status.state === 'error' ? 'Sync Error'
          : status.state === 'idle' ? 'Auto Sync Not Ready' : 'Connecting Cloud';
  return <div className={`auto-sync-status auto-sync-${status.state}`} role="status">
    <div className="auto-sync-status-title">{icon}<strong>{label}</strong></div>
    <small>{status.message}</small>
    {status.savedAt && <small>နောက်ဆုံး Auto Sync: {new Date(status.savedAt).toLocaleString()}</small>}
    {status.state === 'conflict' && <small>အကြံပြုချက်: Backup ထုတ်ပြီး Owner Device နှစ်ခုမှာ ပြင်ထားတဲ့ Record ကို စစ်ဆေးပါ။ ထို့နောက် Manual Sync လုပ်ပါ။</small>}
  </div>;
}
