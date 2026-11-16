import { getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { firebaseRuntime } from './firebaseRuntime';

export const firebaseConfig = firebaseRuntime.config;
export const firebaseConfigured = true;
export const isFirebaseEmulator = firebaseRuntime.mode === 'emulator';

// Use a project-specific named app so an old [DEFAULT] app or HMR session
// connected to another project cannot be silently reused. The derived name is
// still "minimart-minimart-production" for the production project.
const appName = `minimart-${firebaseConfig.projectId}`;
const isExpectedProject = (app: ReturnType<typeof getApps>[number]) =>
  app.options.projectId === firebaseConfig.projectId && app.options.apiKey === firebaseConfig.apiKey;

const existingExpectedApp = getApps().find(isExpectedProject);
export const firebaseApp = existingExpectedApp || initializeApp(firebaseConfig, appName);
export const firebaseAuth = getAuth(firebaseApp);

// Firestore database is provisioned in asia-southeast1 (Singapore) in Firebase.
// No Realtime Database URL is configured because this application uses Firestore.
export const firestore = (() => {
  try {
    return initializeFirestore(firebaseApp, {
      experimentalForceLongPolling: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(firebaseApp);
  }
})();

// Emulator binding runs before any app code can issue an auth or Firestore call.
// The global marker keeps Vite HMR reloads from re-connecting the same SDK
// instance (Firebase throws when an emulator is connected twice).
const EMULATOR_BINDING_KEY = `__minimartEmulatorBound:${firebaseConfig.projectId}`;
const runtimeGlobal = globalThis as typeof globalThis & Record<string, unknown>;
if (isFirebaseEmulator && runtimeGlobal[EMULATOR_BINDING_KEY] !== true) {
  const endpoints = firebaseRuntime.emulator;
  if (!endpoints) throw new Error('Emulator runtime configuration is missing its endpoints. Refusing to start.');
  connectAuthEmulator(firebaseAuth, `http://${endpoints.host}:${endpoints.authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, endpoints.host, endpoints.firestorePort);
  runtimeGlobal[EMULATOR_BINDING_KEY] = true;
}

// Retain the existing business namespace so the app's data paths stay stable.
// This is a Firestore business document ID, not the Firebase project ID.
export const FIREBASE_BUSINESS_ID = firebaseRuntime.businessId;
