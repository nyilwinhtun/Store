# Gemini & Antigravity Handover Document — Minimart POS v3.3.0

**ရက်စွဲ:** 2026-11-23  
**Workflow Role Split:**
- **Gemini:** Technical Lead / Architecture Advisor
- **Antigravity:** Coding Agent
- **GitHub (`nyilwinhtun/Store`):** Canonical project source and handover location

> [!IMPORTANT]
> **Production Boundary:** ဤ handover သည် `feature/v3.3.0-release-hardening` branch ပေါ်ရှိ Staging နှင့် release-hardening လုပ်ငန်းများအတွက်သာ ဖြစ်သည်။ **`main` branch, Production Firebase (`minimart-production`), Production Rules, Auth, Business Data, Production Worker သို့မဟုတ် GitHub Pages Production ကို Owner ၏ သီးခြားခွင့်ပြုချက် မရှိဘဲ လုံးဝ မပြောင်းလဲရပါ။**

---

## 1. Project Purpose & Architecture

Minimart POS v3.3.0 သည် မြန်မာနိုင်ငံရှိ minimart ဆိုင်များအတွက် offline-capable Point-of-Sale (POS) web application (PWA) ဖြစ်ပြီး **Free-only policy** (Firebase Spark plan + Cloudflare Free plan) ဖြင့် တည်ဆောက်ထားသည်။

- **Frontend / PWA:** React 18, TypeScript, Vite, Tailwind CSS, Zustand (`src/store/usePosStore.ts`), Service Worker (`public/sw.js`)။ URL routing မသုံးဘဲ Zustand state ဖြင့် page navigation လုပ်သည်။
- **Database & Auth:** Firebase Authentication (Email/Password) နှင့် Cloud Firestore (`asia-southeast1`, Native mode)။ `firestore.rules` ဖြင့် Owner / Cashier role နှင့် branch isolation ကို server-side မှ တင်းကျပ်စွာ ကန့်သတ်ထားသည်။
- **Trusted Cashier Sale Path:**
  - Local Emulator / Blaze reference: Firebase Cloud Functions (`functions/src/cashierUnitSale.ts`, `functions/src/saleAdjustment.ts`)။ **Spark plan တွင် Cloud Functions deploy မရပါ (Blaze billing မဖွင့်ရ)။**
  - Free-only Staging/Production trusted path: Cloudflare Worker (`experiments/cloudflare-workers-spark-poc/`) မှ Firebase ID token verify လုပ်ပြီး Firestore REST API ဖြင့် atomic commit ပြုလုပ်သည်။
- **Offline Support:** Cashier offline sales များကို durable IndexedDB queue (`src/lib/cashierSalesSync.ts`) ဖြင့် သိမ်းဆည်းပြီး online ပြန်ဖြစ်ချိန်တွင် server-authoritative endpoint မှ idempotent commit လုပ်သည်။

---

## 2. Current Branch & Git State

| Item | Value |
| --- | --- |
| Repository | `https://github.com/nyilwinhtun/Store.git` |
| Target Branch | `feature/v3.3.0-release-hardening` |
| Base Commit (before this handover) | `dca284eb9046bd705b64b3dad3bf5d1640e5ea88` (`fix(sync): isolate auto-sync status by business`) |
| Previous Release Prep Commit | `ccd85a07226a5d4222d7df3b2d52e51ce3b5802d` (`chore(release): prepare minimart POS v3.3.0`) |
| `main` Branch | `90923dd5071bac8742adb0b6d6cb0024d7ba863d` (**Untouched**) |
| Node.js Requirement | `>=24.12.0` (`package.json` engines) |

---

## 3. Firebase Staging & Production Separation

Staging နှင့် Production ကို project, business ID, config, local cache အဆင့်တိုင်းတွင် သီးခြားခွဲထားသည်။

| Environment | Firebase Project | Business ID | Branch ID | Status |
| --- | --- | --- | --- | --- |
| **Staging** | `minimart-staging` (Spark) | `store-staging-main` | `branch-staging-main` | Seeded, Rules deployed (`16ab2435...`) |
| **Production** | `minimart-production` (Spark) | `store-mini-main` | Live branches | **Untouched** (live Rules snapshot: `69406119...`) |

- **Staging Auth Accounts (`minimart-staging`):**
  - Owner UID: `3tBhEr0UMLfMv7h6CktX5md3Oxm1`
  - Cashier UID: `lUjNJ6cR6CWcqDufCYsUctHfsQ83`
- **Runtime Isolation Guards:**
  - `src/lib/firebaseRuntime.ts`: `VITE_FIREBASE_MODE=staging` တွင် `minimart-production` identifier ပါလာပါက fail-closed ငြင်းပယ်သည်။ Unknown mode ကိုလည်း ငြင်းပယ်သည်။
  - `src/store/usePosStore.ts` & `src/lib/syncManifestStorage.ts`: Persist key နှင့် sync manifest ကို project ID အလိုက် ခွဲထားသဖြင့် Staging/Production local data မရောပါ။
  - `src/components/RuntimeBadge.tsx`: Staging mode တွင် `STAGING · MINIMART-STAGING` badge ပြသသည်။

---

## 4. Cloudflare Pages Staging Setup

- **Planned Pages Project:** `minimart-pos-staging` (`https://minimart-pos-staging.pages.dev`)
- **Source Branch:** `feature/v3.3.0-release-hardening` (Preview deployments disabled)
- **Build Settings:** `npm run build` (`tsc --noEmit && vite build`), Output directory `dist`, `NODE_VERSION=24`
- **Required Env Vars (Both Production & Preview Scopes):**
  - `NODE_VERSION=24`
  - `VITE_FIREBASE_MODE=staging`
  - `VITE_WORKER_SALES_ENABLED=false` (`VITE_WORKER_SALES_URL` ကို Worker deploy မပြီးမချင်း မထည့်ရ)
- **Production GitHub Pages:** `.github/workflows/deploy.yml` သည် `main` branch မှ Production site ကိုသာ deploy လုပ်ပြီး **မပြောင်းလဲထားပါ**။
- **Current Status:** Build isolation (`dist/` ထဲတွင် Production config မပါကြောင်း) နှင့် local PWA/service-worker boot (`sw.js`, `manifest.webmanifest`) ကို local တွင် စစ်ပြီးဖြစ်သော်လည်း **Live Cloudflare Pages deployment နှင့် live Firebase login (`AccessBootstrap`) ကို မစမ်းသပ်ရသေးပါ (Pending Owner action)**။
  - Owner မှ `minimart-staging` Firebase Console → Authentication → Authorized domains တွင် `minimart-pos-staging.pages.dev` ကို ထည့်ပေးရန် လိုအပ်သည်။

---

## 5. Cloudflare Worker Status & Why It Is Not Deployed Yet

Staging Worker (`minimart-sales-staging`, config: `experiments/cloudflare-workers-spark-poc/wrangler.staging.toml` — Git-ignored) ကို **deploy မလုပ်ရသေးပါ**။

**Deploy မလုပ်ရသေးသည့် အကြောင်းရင်းများ:**
1. **Service-Account Key / Secret မရှိသေးခြင်း:** `minimart-staging-worker@minimart-staging.iam.gserviceaccount.com` ၏ JSON key ကို Owner မှ Google Cloud Console တွင် ဖန်တီးပြီး terminal မှတစ်ဆင့် `wrangler secret put FIRESTORE_SERVICE_ACCOUNT --config wrangler.staging.toml` ဖြင့် ထည့်ရန် လိုအပ်သည်။ (`wrangler secret put` သည် Worker version အသစ်တစ်ခု publish လုပ်သောကြောင့် deploy ခွင့်ပြုချက်မရှိဘဲ မလုပ်ရပါ။)
2. **Owner Deployment Authorization မရှိသေးခြင်း:** Staging Worker deploy လုပ်ရန် Owner ၏ သီးခြားခွင့်ပြုချက် လိုအပ်သည်။
3. **CORS Allowlist:** လက်ရှိ local `wrangler.staging.toml` တွင် localhost origins သာ ပါရှိပြီး Pages URL အတည်ပြုပြီးမှ `https://minimart-pos-staging.pages.dev` ကို ထည့်ပြီး redeploy လုပ်ရမည်။

> [!WARNING]
> `experiments/cloudflare-workers-spark-poc/wrangler.toml` သည် default အနေဖြင့် `minimart-production` (`workers_dev = false`) ကို ညွှန်ထားသည်။ Staging command တိုင်းတွင် `--config wrangler.staging.toml` ကို မဖြစ်မနေ ထည့်သုံးရမည်။

---

## 6. Completed Features & Fixes (v3.3.0)

1. **Void Sale Batch Coverage Fix (`src/store/usePosStore.ts`):** `batchAllocations` မပါသော legacy/v1 sale များကို void လုပ်သည့်အခါ product stock သာမက stock batch coverage ကိုပါ ပြန်ဖြည့်ပေးသည်။
2. **Receipt Number Hardening (`src/lib/receiptNumber.ts`):** Myanmar local date (`Asia/Yangon` midnight boundary မှန်ကန်စေရန်) နှင့် UUID-based 12-char suffix (`MM-YYYYMMDD-XXXXXXXXXXXX`) ပြောင်းလဲပြီး collision ကာကွယ်ထားသည်။
3. **Cashier Unit Barcode Sale & Sale Adjustments:**
   - Cashier သည် `stockUnitRegistries` ကို branch-scoped read-only ရရှိပြီး write path ကို server-authoritative transaction ဖြင့်သာ လုပ်ဆောင်သည် (`functions/src/cashierUnitSale.ts`, `functions/src/saleAdjustment.ts`, `src/lib/cashierUnitSaleSync.ts`, `src/lib/saleAdjustments.ts`, `src/components/SaleReturnDialog.tsx`)။
   - Server မရောက်ရှိလျှင် fail-closed ဖြင့် Owner Review သို့ ပို့သည်။
4. **Cloudflare Workers Spark POC (`experiments/cloudflare-workers-spark-poc/`):**
   - Free-plan compatible trusted sale/void/return/allowance worker။
   - 72-hour authorization lease, 24-hour offline allowance (`expired-hold`), fingerprint idempotency, KPay reference reuse protection, Credit customer handling, duplicate unit & concurrency checks များ ပါဝင်သည်။
5. **Auto-Sync Status Isolation (`src/lib/autoSyncStatus.ts`):** Commit `dca284e` ဖြင့် auto-sync status ကို business ID အလိုက် ခွဲထားသည်။
6. **Free REST Backup/Restore Tool (`scripts/firestore-export.mjs`, `scripts/firestore-restore.mjs`):** Production export ကို `--allow-production` guard ဖြင့် ကာကွယ်ထားပြီး emulator round-trip စစ်ပြီး။
7. **Staging Mode & Preflight Tooling (`src/lib/firebaseRuntime.ts`, `scripts/verify-staging-config.mjs`, `scripts/security-preflight.mjs`):** Staging config နှင့် security invariants များကို automated check လုပ်နိုင်သည်။

---

## 7. Verification Status: Local vs. Live

### A. Local / Emulator Verified (PASS)
- **Handover session တွင် ထပ်မံအတည်ပြုပြီး:**
  - `npm run check:security`: **26/26 PASS**
  - `npm run check:staging`: **PASS (0 warnings)**
- **Repo မှတ်တမ်း (`V3.3.0-RELEASE-CHECKLIST-MY.md`, `CLOUDFLARE-PAGES-STAGING-PLAN-MY.md`, `CLOUDFLARE-WORKER-STAGING-SETUP-MY.md`) အရ Local/Emulator တွင် အောင်မြင်ထားသော suites များ (Node 24 + Firebase Emulators):**
  - Security & Rules: `test:rules` (30/30), `test:unit-sale-server` (25/25), `test:sale-adjustments-server` (11/11)
  - Worker POC: `experiments/cloudflare-workers-spark-poc` suite (**70/70**), local `workerd` benchmark (peak local CPU `6.5 ms/req` < `10 ms` limit, max `7` Firestore requests < `50` subrequest limit — local measurement only, not Cloudflare production metering)
  - App & Sync suites: `test:sync` (16/16), `test:autosync` (`dca284e`), `test:cash` (29/29), `test:qr` (4/4), `test:cursor` (6/6), `test:overview` (3/3), `test:runtime` (10/10), `test:statement` (10/10), `test:checkout` (21/21), `test:store` (8/8), `test:units` (16/16), `test:transfer`, `test:offline` (7/7), `test:worker-client` (9/9), `test:backup` (2/2)
  - Staging build isolation (`VITE_FIREBASE_MODE=staging VITE_WORKER_SALES_ENABLED=false npm run build`): PASS (`dist/` ထဲတွင် Production client config မပါ)

### B. Partial Live Staging Verification (Real Firestore, Mocked Auth)
- `minimart-staging` Firestore (`store-staging-main`) သို့ Worker code (`src/app.js`) မှ တိုက်ရိုက် run ခဲ့ရာ **33/33 PASS** (`run=20261115144617`)။
- **ကန့်သတ်ချက်:** ဤ run တွင် ID token ကို locally RS256 sign လုပ်ပြီး JWKS fetch ကို inject လုပ်ထားခြင်းဖြစ်သည်။ **Google မှ ထုတ်ပေးသော real Firebase ID token verification ကို မစမ်းသပ်ရသေးပါ။**

### C. Unverified / Pending Live Tests
- Deployed Staging Worker URL ပေါ်တွင် real Firebase ID token (Google JWKS + token revocation) စမ်းသပ်မှု (**NOT VERIFIED**)
- Live Cloudflare Pages deployment နှင့် browser မှ real Owner/Cashier Firebase Auth login (`AccessBootstrap`) (**NOT VERIFIED**)
- Physical hardware & mobile QA: ZYWELL ZM04 80mm thermal printer, Bluetooth/USB HID barcode scanner, Android / iPhone real devices (**NOT VERIFIED**)
- Real KPay transfer verification (**NOT VERIFIED**)
- Real Production backup export & Staging restore rehearsal (**NOT VERIFIED — Release Blocker**)

---

## 8. Current Verified Staging Status

- **Done:** `minimart-staging` Firebase project (Spark), Firestore DB (`asia-southeast1`), Auth accounts (2), seed data (`store-staging-main`), Staging Firestore Rules (`16ab2435...`), client `staging` mode, `wrangler.staging.toml` (local Git-ignored).
- **Pending:** Staging Worker secret & deploy, Cloudflare Pages project live check & Firebase Authorized domain entry, Worker CORS update, real-token live Worker QA, `VITE_WORKER_SALES_ENABLED=true` enablement.
- **Limitation:** `VITE_WORKER_SALES_ENABLED=false` ဖြစ်နေသရွေ့ Staging Pages app တွင် online Cashier sale completion သည် deploy မလုပ်ထားသော `completeCashierUnitSale` callable သို့ သွားမည်ဖြစ်၍ fail-closed (Owner Review) ဖြစ်နေမည်။

---

## 9. Remaining QA & Release Tasks

1. **Owner:** `minimart-staging-worker` service account key ဖန်တီးပြီး `wrangler secret put FIRESTORE_SERVICE_ACCOUNT --config wrangler.staging.toml` ဖြင့် upload လုပ်ရန်။
2. **Owner:** Staging Cloudflare Pages (`minimart-pos-staging`) ချိတ်ဆက်ပြီး `minimart-staging` Firebase Auth Authorized domains တွင် hostname ထည့်ရန်။
3. **Owner:** Staging Worker deploy ခွင့်ပြုပြီး CORS allowlist တွင် Pages URL ထည့်ရန်။
4. **QA (Staging Live):** Real Firebase ID token ဖြင့် deployed Staging Worker matrix (Cash/KPay/Credit/Unit/Return/Void/Offline lease & allowance) စမ်းသပ်ရန်။
5. **QA (Physical Devices):** ZYWELL ZM04 80mm printer, scanner, Android, iPhone နှင့် real KPay transfer စမ်းသပ်ရန်။
6. **Production Release Gate (Separate Owner Approval Required):**
   - Authorized Production Firestore backup export + Staging restore rehearsal
   - Production `firestore.rules` candidate (`16ab2435...`) deploy (Worker live ဖြစ်ပြီးမှသာ)
   - Production Worker setup & `VITE_WORKER_SALES_ENABLED=true`
   - `main` branch merge & GitHub Pages release

---

## 10. Business Rules, Security & Offline Requirements

- **Free-only Policy:** Firebase Spark + Cloudflare Free plan သာ သုံးရမည်။ Blaze/paid billing မဖွင့်ရ။
- **Fail-Closed Cashier Checkout:** Server/Worker မရနိုင်လျှင် သို့မဟုတ် validation ငြင်းပယ်ခံရလျှင် sale ကို local-only အဖြစ် ပြီးစီးကြောင်း မပြရ; Owner Review queue တွင်သာ ထားရမည်။
- **Atomic Integrity:** Sale + Product stock + Batch stock + Unit registry (`sold`/`in_stock`) + Audit record ကို transaction တစ်ခုတည်းဖြင့် commit လုပ်ရမည်။
- **Lease & Offline Allowance:** Server-issued 72h authorization lease နှင့် 24h offline allowance; `expired-hold` ဖြစ်လျှင် stock ကို auto-release မလုပ်ရ (Owner reconcile လုပ်ရမည်)။
- **Idempotency & Anti-Tamper:** Sale ID + payload fingerprint idempotency, KPay reference reuse prevention, duplicate unit barcode rejection, client-supplied price/cost/UID/role ကို server မှ မယုံဘဲ verify လုပ်ခြင်း။
- **No Destructive Queue Cleanup:** Pending sale, payment, stock-handover records များကို auto-delete မလုပ်ရ။

---

## 11. Files & Configurations Not to Change Casually

- **Security Rules & Indexes:** `firestore.rules`, `firestore.indexes.json`
- **Runtime & Firebase Config:** `src/lib/firebaseRuntime.ts`, `src/lib/firebase.ts`
- **Sync, Offline Queue & Worker Client:** `src/lib/cashierSalesSync.ts`, `src/lib/syncSafety.ts`, `src/lib/workerSaleClient.ts`, `src/lib/autoSyncStatus.ts`, `src/store/usePosStore.ts`
- **Server-Authoritative Logic:** `functions/src/cashierUnitSale.ts`, `functions/src/saleAdjustment.ts`, `experiments/cloudflare-workers-spark-poc/src/`
- **Security & Preflight Scripts:** `scripts/security-preflight.mjs`, `scripts/verify-staging-config.mjs`
- **Production CI/CD:** `.github/workflows/deploy.yml`
- **Git-Ignored Local Secrets/Configs:** `experiments/cloudflare-workers-spark-poc/wrangler.staging.toml`, `**/.dev.vars`, `**/.wrangler/`

---

## 12. Guidance for Gemini & Antigravity (Preventing Redundant Work)

- **Redundant Audit မလုပ်ရ:** v3.2.6 နှင့် v3.3.0 codebase audit, architecture review, security rules hardening, နှင့် unit/emulator tests များကို `ccd85a0` နှင့် `dca284e` တွင် အပြည့်အစုံ လုပ်ဆောင်ပြီးဖြစ်သည်။
- **Existing Docs ကို အရင်ဖတ်ရန်:** ပြောင်းလဲမှုတစ်ခုခု မစတင်မီ `docs/current/V3.3.0-RELEASE-CHECKLIST-MY.md`, `CLOUDFLARE-WORKER-STAGING-SETUP-MY.md`, `CLOUDFLARE-PAGES-STAGING-PLAN-MY.md`, နှင့် `FIREBASE-STAGING-SETUP-MY.md` တို့ကို ကိုးကားပါ။
- **Verification Gate:** Code ပြောင်းလဲမှုတိုင်းအတွက် `npm run qa` (Node `>=24.12.0` ဖြင့်) သို့မဟုတ် သက်ဆိုင်ရာ targeted test + `check:security` + `check:staging` ကို run ပါ။
- **Focus Next Work:** Remaining live Staging auth/Worker/Pages verification နှင့် physical device QA blockers များကိုသာ ဦးစားပေး ဖြေရှင်းပါ။

---

## 13. Production Approval Rule

**`main` branch merge, `minimart-production` Firebase Rules/Auth/Data/Functions, Production Cloudflare Worker, သို့မဟုတ် GitHub Pages Production deployment တို့နှင့် သက်ဆိုင်သည့် မည်သည့်လုပ်ဆောင်ချက်မဆို Owner ၏ တိကျပြတ်သားသော သီးခြားခွင့်ပြုချက် (separate explicit approval) ရရှိမှသာ လုပ်ဆောင်ရမည်။**
