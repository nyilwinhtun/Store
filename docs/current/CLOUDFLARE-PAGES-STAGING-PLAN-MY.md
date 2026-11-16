# Cloudflare Pages Staging Plan — Minimart POS v3.3.0

Status: **PREPARED ONLY**. No Pages project was created, no build was uploaded,
no Worker was deployed, and the GitHub Pages Production workflow was not changed.

## 1. Target separation

| Item | Value |
| --- | --- |
| Source repo | `https://github.com/nyilwinhtun/Store.git` |
| Source branch | `feature/v3.3.0-release-hardening` |
| Pages project (planned) | `minimart-pos-staging` |
| Pages origin (planned) | `https://minimart-pos-staging.pages.dev` |
| Firebase project | `minimart-staging` |
| Firestore business | `store-staging-main` |
| Worker | `minimart-sales-staging` (not deployed) |
| Production | Untouched: `minimart-production` / `store-mini-main` / GitHub Pages v3.2.5 |

GitHub Pages remains one-site-per-repo. A separate Cloudflare Pages project is
required so Staging never replaces the live Production site.

## 2. Build configuration (Cloudflare Pages dashboard)

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Root directory | `/` (repository root) |
| Production branch | `feature/v3.3.0-release-hardening` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Preview deployments | Disabled for this Staging project |
| Node version | `NODE_VERSION=24` |

`package.json` requires Node `>=24.12.0`; `scripts/qa.mjs` also enforces major 24.
Pages must use Node 24, not its older default.

Local equivalent preflight:

```bash
cd /Users/user/Documents/GitHub/Store
PATH=/tmp/node24/bin:$PATH VITE_FIREBASE_MODE=staging npm run build
```

## 3. Environment variables (Pages → Settings → Environment variables)

Production (the Staging project's only deployment):

```
NODE_VERSION=24
VITE_FIREBASE_MODE=staging
VITE_WORKER_SALES_URL=https://minimart-sales-staging.<account-subdomain>.workers.dev
VITE_WORKER_SALES_ENABLED=false
```

Rules:

- `VITE_FIREBASE_MODE=staging` is mandatory. Without it the production build
  resolves to `production` (`firebaseRuntime.ts:115`).
- Never add production values (`minimart-production`, `store-mini-main`) to this
  project. `resolveFirebaseRuntime` fails closed if a Staging identifier contains
  the production project ID.
- `VITE_WORKER_SALES_ENABLED=false` for the first deployment. Flip to `true` only
  after the Staging Worker is deployed and real Firebase-auth tests pass.
- The Worker URL is a public endpoint, not a secret. No service-account JSON,
  API secret, or token belongs in Pages variables.
- `VITE_ALLOW_PRODUCTION_IN_DEV` must not be set.

## 4. SPA fallback

Not required for v3.3.0:

- The app uses Zustand page state, not URL routing (`navTo` in `src/App.tsx`).
- `public/manifest.webmanifest` uses `start_url: "./index.html"` and scope `"./"`.
- Vite `base: './'` means all assets resolve relative to the Pages root.

Only add a `_redirects` rule if URL-based routes are introduced later:

```
/*  /index.html  200
```

## 5. PWA / service-worker path verification

- `src/main.tsx:40` registers `${BASE_URL}sw.js`, which resolves to `/sw.js` at
  the Pages root; no `Service-Worker-Allowed` header is needed.
- `public/sw.js` precaches scope-relative URLs and falls back to cached
  `index.html` for navigations.
- Cache name is `minimart-pos-v330-release-hardening`; this build must ship a
  new cache name whenever app assets change.
- Recommended (not yet applied) `public/_headers` for the Staging host:

```
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
```

- After the first Pages build, verify:
  - `https://minimart-pos-staging.pages.dev/sw.js` returns HTTP 200 as JavaScript.
  - `https://minimart-pos-staging.pages.dev/manifest.webmanifest` returns 200.
  - DevTools → Application → Service Workers shows scope `/`.
  - Reload once online, then confirm the cached app still opens offline; this is
    only a hosting smoke test, not a substitute for real-device testing.

## 6. Exact CORS origin plan for the Worker

Current local config (`wrangler.staging.toml`, Git-ignored):

```
CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
```

Planned Staging addition (exact origin, no wildcard, no trailing slash):

```
CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,https://minimart-pos-staging.pages.dev"
```

- Add a custom domain later only as its exact `https://…` origin.
- Do **not** use `*`, `https://*.pages.dev`, or a preview-deployment wildcard.
- If Pages preview deployments stay enabled, each preview host would need its own
  exact entry; the recommended setting is previews disabled.
- After changing Worker CORS, redeploying the Worker is an Owner-gated action.

## 7. Firebase Staging prerequisites (Owner action, not performed)

1. Firebase Console → Authentication → Settings → Authorized domains: add
   `minimart-pos-staging.pages.dev`.
2. Confirm `minimart-staging` remains on **Spark**.
3. Confirm the Staging Firestore ruleset is the approved candidate; the current
   deployed rules still have to be re-verified against the local file hash before
   any release claim.
4. Do not add Production domains or identifiers to the Staging project.

## 8. Build-output isolation check (run before enabling Worker)

```bash
PATH=/tmp/node24/bin:$PATH VITE_FIREBASE_MODE=staging npm run build
grep -R "AIzaSyBG2_GhdQ4XLbIVrqdgnaXhUHetVLLVV0Y\|1:1048943501819\|minimart-production.firebaseapp.com\|G-HDEZGPEKG1" dist
grep -R "store-staging-main" dist/assets | head -3
```

Expected: no Production client-config matches; `store-staging-main` present.
`minimart-production` may still appear only as the fail-closed guard string in
`firebaseRuntime.ts`, never as the embedded client configuration.

## 9. Known limitation of the first deployment

With `VITE_WORKER_SALES_ENABLED=false`, online Cashier sales route to the
`completeCashierUnitSale` callable (`src/lib/cashierSalesSync.ts:165-174`).
Cloud Functions for Firebase requires the Blaze plan, which is prohibited, and
the callable is not deployed. Therefore the first Pages deployment can validate
Owner/inventory/staging hosting, but **online Cashier sale completion stays
non-functional** until the Staging Worker passes real-auth tests and the flag is
enabled. Local/offline sale save and queueing still apply.

## 10. Owner approval gates before any deploy

1. Approve creating the Cloudflare Pages project connected to the GitHub repo.
2. Add the Pages origin to Firebase Auth authorized domains.
3. Confirm the Staging Worker deployment and CORS origin change.
4. Approve flipping `VITE_WORKER_SALES_ENABLED=true` after tests.
5. Confirm the GitHub Pages Production workflow and live site remain unchanged.
