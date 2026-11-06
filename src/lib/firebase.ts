import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

// This app is intentionally pinned to the user's confirmed Firebase project.
// Do not let an old .env.local from another project silently redirect Auth/Firestore.
export const firebaseConfig = {
  apiKey: 'AIzaSyAxF46-Xzgo0FmVc7v-Zp8JNMQldZl_eQg',
  authDomain: 'store-mini.firebaseapp.com',
  databaseURL: 'https://store-mini-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'store-mini',
  storageBucket: 'store-mini.firebasestorage.app',
  messagingSenderId: '889663357607',
  appId: '1:889663357607:web:30530c32408e3d03bb1182',
  measurementId: 'G-E7EJRTDBQD',
};

export const firebaseConfigured = true;

// Reuse a Firebase app only when it is actually connected to store-mini.
// This avoids accidentally reusing a stale [DEFAULT] app initialized for
// another Firebase project during development/HMR or from another module.
const expectedApiKey = firebaseConfig.apiKey;
const isExpectedProject = (app: ReturnType<typeof getApps>[number]) =>
  app.options.projectId === firebaseConfig.projectId && app.options.apiKey === expectedApiKey;

const existingExpectedApp = getApps().find(isExpectedProject);
const hasDefaultApp = getApps().some((app) => app.name === '[DEFAULT]');
const minimartNamedApp = getApps().find((app) => app.name === 'minimart-store-mini' && isExpectedProject(app));

export const firebaseApp = existingExpectedApp
  || minimartNamedApp
  || (hasDefaultApp
    ? initializeApp(firebaseConfig, 'minimart-store-mini')
    : initializeApp(firebaseConfig));

export const firebaseAuth = getAuth(firebaseApp);
// Long-polling transport is more tolerant of restrictive networks and proxies.
// During Vite HMR the Firestore instance may already exist, so fall back to it.
export const firestore = (() => {
  try {
    return initializeFirestore(firebaseApp, {
      experimentalForceLongPolling: true,
      // Keep Firestore's own pending writes and cache in IndexedDB across reloads.
      // POS business data itself remains in the existing Zustand/localStorage store.
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(firebaseApp);
  }
})();

// The membership namespace is intentionally fixed for this Minimart business.
export const FIREBASE_BUSINESS_ID = 'store-mini-main';
