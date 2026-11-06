import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

// Dedicated Minimart Firebase project created for the new production workspace.
// The Web API key is public Firebase client configuration; access is protected
// by Authentication and the Firestore Security Rules shipped with this project.
export const firebaseConfig = {
  apiKey: 'AIzaSyBG2_GhdQ4XLbIVrqdgnaXhUHetVLLVV0Y',
  authDomain: 'minimart-production.firebaseapp.com',
  projectId: 'minimart-production',
  storageBucket: 'minimart-production.firebasestorage.app',
  messagingSenderId: '1048943501819',
  appId: '1:1048943501819:web:134f8b10669493ab702b5e',
  measurementId: 'G-HDEZGPEKG1',
};

export const firebaseConfigured = true;

// Use a project-specific named app so an old [DEFAULT] app or HMR session
// connected to store-mini cannot be silently reused for minimart-production.
const appName = 'minimart-minimart-production';
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

// Retain the existing business namespace so the app's data paths stay stable.
// This is a Firestore business document ID, not the Firebase project ID.
export const FIREBASE_BUSINESS_ID = 'store-mini-main';
