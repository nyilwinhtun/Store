# Cloudflare Pages Staging Plan — Minimart POS v3.3.0

Status: **PREPARED ONLY (2026-11-16)**. No Pages project was created, no build was
uploaded, no Worker was deployed, and the GitHub Pages Production workflow was not
changed. The pages.dev hostname did not resolve during this check, which is
consistent with the project not existing yet; this is not proof that the name is
available.

## 1. Confirmed source of truth

| Item | Value |
| --- | --- |
| Repository | `https://github.com/nyilwinhtun/Store.git` |
| Branch | `feature/v3.3.0-release-hardening` |
| Commit | `ccd85a07226a5d4222d7df3b2d52e51ce3b5802d` |
| Pages project (planned) | `minimart-pos-staging` |
| Pages origin (expected) | `https://minimart-pos-staging.pages.dev` |
| Firebase project | `minimart-staging` (Spark) |
| Firestore business | `store-staging-main` |
| Production | Untouched: `minimart-production` / `store-mini-main` / GitHub Pages |

GitHub Pages remains one-site-per-repository. The Cloudflare Pages project is a
separate Staging host so it can never replace the live Production site.

## 2. Exact Pages build settings

| Setting | Value |
| --- | --- |
| Connect to Git | GitHub repository `nyilwinhtun/Store` |
| Framework preset | Vite |
| Root directory | `/` |
| Production branch | `feature/v3.3.0-release-hardening` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | `NODE_VERSION=24` |
| Preview deployments | **Disabled** for the first Staging deployment |

Do not choose `main` as the Pages production branch. Do not edit
`.github/workflows/deploy.yml`; that workflow deploys only the existing GitHub
Pages Production site from `main`.

`npm run build` already runs `tsc --noEmit && vite build`; Pages needs no extra
command. `package.json` requires Node `>=24.12.0`, so `NODE_VERSION=24` is
mandatory rather than optional.

## 3. Environment variables — both scopes

Cloudflare Pages has separate **Production** and **Preview** variable scopes.
Set the following identical values in **both** scopes. Do not create the project
with Production defaults only.

```
NODE_VERSION=24
VITE_FIREBASE_MODE=staging
VITE_WORKER_SALES_ENABLED=false
```

`VITE_WORKER_SALES_URL` is intentionally **omitted** for the first deployment
because no Staging Worker exists yet. Once the Worker is deployed, its exact
`https://<worker>.workers.dev` URL may be added; the gate must remain `false`
until real-auth and Worker tests pass.

Rules:

- `VITE_FIREBASE_MODE=staging` is mandatory. If it is missing, Vite sees a
  production build and embeds the Production Firebase client configuration.
- Never set `VITE_ALLOW_PRODUCTION_IN_DEV`.
- Never add `minimart-production`, `store-mini-main`, Firebase service-account
  JSON, private keys, ID tokens, Cloudflare API tokens, or Worker secrets to Pages
  variables.
- `VITE_WORKER_SALES_ENABLED=false` is required in both scopes. Setting a Worker
  URL alone never enables the Worker path.
- Preview deployments are disabled so each random preview hostname cannot bypass
  the exact-origin Auth/CORS allowlists. If previews are enabled later, set the
  same variables above and add the exact branch alias in sections 5 and 6.

After the project is created, confirm the dashboard shows the sanitized branch
alias (expected form
`feature-v3-3-0-release-hardening.minimart-pos-staging.pages.dev`). Treat the
dashboard value as authoritative; do not guess it for Auth or CORS entries.

## 4. GitHub integration

Use **Workers & Pages → Create → Pages → Connect to Git**, authorize the
Cloudflare GitHub App for `nyilwinhtun/Store`, and select the branch above. This
connects only the new Pages project. It does not modify the repository, `main`, or
the GitHub Pages workflow.

Expected result after the first build: a successful deployment at
`https://minimart-pos-staging.pages.dev`, and the existing GitHub Pages Production
URL remains unchanged.

## 5. Firebase Authentication — exact Owner action

In Firebase Console, open the **`minimart-staging`** project (display name
"Minimart Staging"):

1. Authentication → Settings → Authorized domains → **Add domain**.
2. Enter exactly: `minimart-pos-staging.pages.dev` (no `https://`, no path).
3. Save and confirm the entry appears.

If the branch-alias preview host is used, add its exact hostname as a separate
entry after reading it from the Pages dashboard. Do not add a wildcard such as
`*.pages.dev`. Do not add either domain to `minimart-production`.

Expected result: email/password sign-in on the Pages host no longer returns
`auth/unauthorized-domain`. Password-reset links also use the authorized host.

## 6. Worker CORS — prepared, not applied

Current local `wrangler.staging.toml` (Git-ignored) contains localhost only.
After the Pages hostname is confirmed, the exact value must become:

```
CORS_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,https://minimart-pos-staging.pages.dev"
```

If the exact branch-alias preview host is also used, append it as another exact
`https://…` origin. Never use `*`, `https://*.pages.dev`, a per-commit wildcard,
trailing slashes, or paths.

Changing CORS requires a Worker redeploy, which is not authorized in this task.
The Worker remains undeployed and `VITE_WORKER_SALES_ENABLED=false`.

## 7. SPA routing and PWA verification

The v3.3.0 app uses Zustand page state, not URL routing, so no `_redirects` file
is required. Both `/` and `/index.html` were verified to boot the same login
screen. If URL-based routes are introduced later, add:

```
/*  /index.html  200
```

PWA behavior verified from the staging build:

- `index.html`, `manifest.webmanifest`, icons and all asset links use `./`
  relative paths.
- `sw.js` registers at the host root; local verification showed scope
  `http://localhost:4173/`.
- Cache name is `minimart-pos-v330-release-hardening`.
- The cache held `index.html`, the manifest, three icons, the CSS entry, the app
  entry and all static vendor chunks; lazy route chunks cache on first use.
- `precache-manifest.json` contains only relative paths; no Production or
  absolute deployment-root paths are embedded.

After the real Pages deployment, verify:
`/sw.js` and `/manifest.webmanifest` return 200, DevTools shows scope `/`, one
online reload caches the shell, and the installed app reopens offline. This is a
hosting smoke test, not physical-device certification.

## 8. Build-output isolation evidence (2026-11-16)

Command:

```bash
PATH=/tmp/node24/bin:$PATH VITE_FIREBASE_MODE=staging VITE_WORKER_SALES_ENABLED=false npm run build
```

| Check | Result |
| --- | --- |
| Node | `v24.12.0` |
| TypeScript + Vite build | PASS |
| Production API key / sender ID / authDomain / measurement ID in `dist` | **none** |
| `minimart-staging.firebaseapp.com` in entry bundle | present |
| `store-staging-main` in entry bundle | present |
| `minimart-production` occurrences | guard/error strings only, never embedded client config |
| Worker gate literal in bundle | `flag:"false"` |
| Worker endpoint / `workers.dev` URL in bundle | none |
| Browser boot at `/` and `/index.html` | login screen, `STAGING · MINIMART-STAGING`, no console errors |
| Service worker and cache | active, scope `/`, cache populated (see section 7) |
| `npm run check:staging` | PASS, 0 warnings |
| `npm run test:runtime` | 10/10 PASS |
| `npm run test:worker-client` | 9/9 PASS |

No real Pages deployment, live Firebase login, or Worker CORS request was tested.

## 9. Known limitation of the first deployment

With the Worker gate off, online Cashier sales would route to the
`completeCashierUnitSale` callable, which requires Blaze and is not deployed.
The first Pages deployment can validate Owner login, Staging data, inventory and
hosting, but **online Cashier sale completion remains non-functional** until the
Staging Worker is deployed and passes real-auth tests. Local/offline sale saving
and queueing still apply.

## 10. Owner gates before any deploy

1. Create/connect the `minimart-pos-staging` Pages project with section 2 settings
   and section 3 variables in both scopes.
2. Add the exact Pages hostname to `minimart-staging` Authentication authorized
   domains.
3. Confirm the first build output has no Production client identifiers.
4. Separately approve Staging Worker deployment, Worker secret upload, and CORS
   update.
5. Only after tests, approve `VITE_WORKER_SALES_ENABLED=true`.
6. Confirm GitHub Pages Production and `main` remain untouched.
