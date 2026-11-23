import { firebaseRuntime } from '../lib/firebaseRuntime';

/**
 * Always-visible runtime target indicator. Emulator mode also guarantees that
 * no production identifier can be selected (see firebaseRuntime.ts).
 */
export function RuntimeBadge({ inline = false }: { inline?: boolean }) {
  const layoutClass = inline ? 'runtime-badge runtime-badge-inline' : 'runtime-badge';
  if (firebaseRuntime.mode === 'emulator') {
    return (
      <div
        className={`${layoutClass} runtime-badge-emulator`}
        role="status"
        title={`Local Firebase Emulator · ${firebaseRuntime.emulator?.host}:${firebaseRuntime.emulator?.firestorePort} · no production data`}
      >
        <span className="runtime-badge-dot" aria-hidden="true" />
        EMULATOR · {firebaseRuntime.projectId}
      </div>
    );
  }
  if (firebaseRuntime.mode === 'staging') {
    return (
      <div
        className={`${layoutClass} runtime-badge-staging`}
        role="status"
        data-firebase-project={firebaseRuntime.projectId}
        title={`STAGING DATA · Firebase project ${firebaseRuntime.projectId} · business ${firebaseRuntime.businessId}`}
      >
        <span className="runtime-badge-dot" aria-hidden="true" />
        STAGING · {firebaseRuntime.projectId.toUpperCase()}
      </div>
    );
  }
  if (firebaseRuntime.mode === 'production') {
    return (
      <div
        className={`${layoutClass} runtime-badge-production`}
        role="alert"
        data-firebase-project={firebaseRuntime.projectId}
        title={`PRODUCTION DATA · Firebase project ${firebaseRuntime.projectId}${firebaseRuntime.usingProductionInDevelopment ? ' · development build with explicit Owner opt-in' : ''}`}
      >
        <span className="runtime-badge-dot" aria-hidden="true" />
        PRODUCTION · {firebaseRuntime.projectId.toUpperCase()}
      </div>
    );
  }
  return null;
}
