// Runtime Firebase target selection. Development defaults to the local Emulator
// Suite with a synthetic demo project so no local test can reach production data.
export const PRODUCTION_PROJECT_ID = 'minimart-production';
export const PRODUCTION_BUSINESS_ID = 'store-mini-main';
export const STAGING_PROJECT_ID = 'minimart-staging';
export const STAGING_BUSINESS_ID = 'store-staging-main';
export const EMULATOR_PROJECT_ID = 'demo-minimart-staging';
export const EMULATOR_AUTH_PORT = 9099;
export const EMULATOR_FIRESTORE_PORT = 8099;
export const EMULATOR_FUNCTIONS_PORT = 5001;

export type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

export type FirebaseRuntimeMode = 'production' | 'staging' | 'emulator';

export type FirebaseRuntimeEnv = {
  DEV?: boolean;
  PROD?: boolean;
  MODE?: string;
  VITE_FIREBASE_MODE?: string;
  VITE_ALLOW_PRODUCTION_IN_DEV?: string;
  VITE_EMULATOR_HOST?: string;
};

export type FirebaseEmulatorEndpoints = {
  host: string;
  authPort: number;
  firestorePort: number;
  functionsPort: number;
};

export type FirebaseRuntimeResolution = {
  mode: FirebaseRuntimeMode;
  config: FirebaseClientConfig;
  projectId: string;
  businessId: string;
  emulator: FirebaseEmulatorEndpoints | null;
  productionBuild: boolean;
  usingProductionInDevelopment: boolean;
};

// Dedicated Minimart Firebase project created for the new production workspace.
// The Web API key is public Firebase client configuration; access is protected
// by Authentication and the Firestore Security Rules shipped with this project.
export const productionFirebaseConfig: FirebaseClientConfig = {
  apiKey: 'AIzaSyBG2_GhdQ4XLbIVrqdgnaXhUHetVLLVV0Y',
  authDomain: 'minimart-production.firebaseapp.com',
  projectId: PRODUCTION_PROJECT_ID,
  storageBucket: 'minimart-production.firebasestorage.app',
  messagingSenderId: '1048943501819',
  appId: '1:1048943501819:web:134f8b10669493ab702b5e',
  measurementId: 'G-HDEZGPEKG1',
};

// A Staging build must not contain the Production client configuration at all.
// Vite replaces this flag statically, so the real object is tree-shaken from
// Staging bundles while Production/Emulator builds keep their existing behavior.
declare const __MINIMART_STAGING_BUILD__: boolean | undefined;
const productionRuntimeConfig: FirebaseClientConfig = typeof __MINIMART_STAGING_BUILD__ !== 'undefined' && __MINIMART_STAGING_BUILD__ === true
  ? {
      apiKey: 'staging-build-withheld',
      authDomain: 'staging-build-withheld.invalid',
      projectId: 'staging-build-withheld',
      storageBucket: 'staging-build-withheld.invalid',
      messagingSenderId: '0',
      appId: 'staging-build-withheld',
    }
  : productionFirebaseConfig;

// Staging is a separate Firebase project with synthetic test data. Its client
// identifiers are public configuration, never credentials, and must never be
// mixed with the Production project or business namespace.
export const stagingFirebaseConfig: FirebaseClientConfig = {
  apiKey: 'AIzaSyCEL-w92CsY89YzLy3S4Ol2Th-Q1o4ixgQ',
  authDomain: 'minimart-staging.firebaseapp.com',
  projectId: STAGING_PROJECT_ID,
  storageBucket: 'minimart-staging.firebasestorage.app',
  messagingSenderId: '197245103530',
  appId: '1:197245103530:web:81a6e8288cf97e9853cfd3',
};

// Synthetic identifiers only. The Auth and Firestore emulators ignore the API
// key and never contact Google services for this demo project.
export const emulatorFirebaseConfig: FirebaseClientConfig = {
  apiKey: 'demo-minimart-staging-local-only',
  authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
  projectId: EMULATOR_PROJECT_ID,
  storageBucket: `${EMULATOR_PROJECT_ID}.appspot.com`,
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:demo-minimart-staging',
};

const normalise = (value: string | undefined) => (value ?? '').trim().toLowerCase();

function resolveEmulatorHost(rawHost: string | undefined): string {
  const host = (rawHost ?? '').trim();
  if (!host) return 'localhost';
  if (host.includes('://') || /[/?#]/.test(host)) {
    throw new Error('VITE_EMULATOR_HOST must be a bare host name (for example 192.168.1.20), not a URL. Refusing to start.');
  }
  if (!/^[A-Za-z0-9.:[\]-]+$/.test(host)) {
    throw new Error(`VITE_EMULATOR_HOST "${host}" is not a valid host name. Refusing to start.`);
  }
  return host;
}

function assertEmulatorTargetIsSynthetic(config: FirebaseClientConfig, endpoints: FirebaseEmulatorEndpoints) {
  const identifiers = [config.projectId, config.authDomain, config.storageBucket, config.appId];
  if (identifiers.some((value) => value.toLowerCase().includes(PRODUCTION_PROJECT_ID))) {
    throw new Error('Refusing to start: the Emulator target resolved to a production Firebase identifier. Local testing must never read or write production data.');
  }
  if (config.projectId !== EMULATOR_PROJECT_ID) {
    throw new Error(`Refusing to start: Emulator mode must use the synthetic project "${EMULATOR_PROJECT_ID}".`);
  }
  if (endpoints.authPort !== EMULATOR_AUTH_PORT || endpoints.firestorePort !== EMULATOR_FIRESTORE_PORT || endpoints.functionsPort !== EMULATOR_FUNCTIONS_PORT) {
    throw new Error('Refusing to start: Emulator ports do not match the approved 9099/8099/5001 configuration.');
  }
}

export function resolveFirebaseRuntime(env: FirebaseRuntimeEnv = {}): FirebaseRuntimeResolution {
  const productionBuild = env.PROD === true;
  const requested = normalise(env.VITE_FIREBASE_MODE) || normalise(env.MODE);

  if (requested && requested !== 'production' && requested !== 'staging' && requested !== 'emulator' && requested !== 'development') {
    throw new Error(`Unknown Firebase runtime mode "${requested}". Refusing to start. Use "production", "staging" or "emulator".`);
  }
  if (requested === 'emulator' && productionBuild) {
    throw new Error('Refusing to start: Emulator mode is not allowed in a production build.');
  }

  const mode: FirebaseRuntimeMode = requested === 'production'
    ? 'production'
    : requested === 'staging'
      ? 'staging'
      : requested === 'emulator'
        ? 'emulator'
        : productionBuild ? 'production' : 'emulator';

  if (mode === 'production') {
    if (!productionBuild && normalise(env.VITE_ALLOW_PRODUCTION_IN_DEV) !== 'true') {
      throw new Error('Refusing to start: development mode resolved to the production Firebase project. Local development uses the Emulator Suite; set VITE_ALLOW_PRODUCTION_IN_DEV=true only with explicit Owner authorization.');
    }
    if (productionRuntimeConfig.projectId !== PRODUCTION_PROJECT_ID) {
      throw new Error('Refusing to start: the production Firebase configuration is not bound to minimart-production.');
    }
    return {
      mode,
      config: productionRuntimeConfig,
      projectId: PRODUCTION_PROJECT_ID,
      businessId: PRODUCTION_BUSINESS_ID,
      emulator: null,
      productionBuild,
      usingProductionInDevelopment: !productionBuild,
    };
  }

  if (mode === 'staging') {
    if (stagingFirebaseConfig.projectId !== STAGING_PROJECT_ID) {
      throw new Error('Refusing to start: the staging Firebase configuration is not bound to minimart-staging.');
    }
    const stagingIdentifiers = [
      stagingFirebaseConfig.projectId,
      stagingFirebaseConfig.authDomain,
      stagingFirebaseConfig.storageBucket,
      stagingFirebaseConfig.appId,
    ];
    if (stagingIdentifiers.some((value) => value.toLowerCase().includes(PRODUCTION_PROJECT_ID))) {
      throw new Error('Refusing to start: the Staging target resolved to a production Firebase identifier.');
    }
    return {
      mode,
      config: stagingFirebaseConfig,
      projectId: STAGING_PROJECT_ID,
      businessId: STAGING_BUSINESS_ID,
      emulator: null,
      productionBuild,
      usingProductionInDevelopment: false,
    };
  }

  const endpoints: FirebaseEmulatorEndpoints = {
    host: resolveEmulatorHost(env.VITE_EMULATOR_HOST),
    authPort: EMULATOR_AUTH_PORT,
    firestorePort: EMULATOR_FIRESTORE_PORT,
    functionsPort: EMULATOR_FUNCTIONS_PORT,
  };
  assertEmulatorTargetIsSynthetic(emulatorFirebaseConfig, endpoints);
  return {
    mode: 'emulator',
    config: emulatorFirebaseConfig,
    projectId: EMULATOR_PROJECT_ID,
    businessId: PRODUCTION_BUSINESS_ID,
    emulator: endpoints,
    productionBuild,
    usingProductionInDevelopment: false,
  };
}

const runtimeEnv = ((import.meta as ImportMeta & { env?: FirebaseRuntimeEnv }).env) ?? {};

export const firebaseRuntime = resolveFirebaseRuntime(runtimeEnv);
