# V3.3.0 Firebase Staging ပရောဂျက် — အကောင်အထည်ဖော်ပြီး အခြေအနေ

နေ့စွဲ: 2026-11-15
အခြေအနေ: **ပြီးစီး (ဒေတာ + Rules)။ Staging Worker မ deploy ရသေးပါ။
Real-Auth token စမ်းသပ်မှု ကန့်သတ်ချက် ရှိသည် (အပိုင်း ၇)။**

ဤစာရွက်စာတမ်းသည် Brief #7 ("Finish Existing Minimart Staging Setup — Do Not
Create Another Project") ၏ အမှန်တကယ် လုပ်ဆောင်ပြီးသော ရလဒ်ကို မှတ်တမ်းတင်သည်။
ပရောဂျက်အသစ်၊ Auth အကောင့်အသစ်၊ Firestore database အသစ် မဖန်တီးခဲ့ပါ။
Production ကို လုံးဝ မထိခဲ့ပါ။

## 1. တွေ့ရှိပြီး အတည်ပြုထားသော အခြေအနေ

| အချက် | ရလဒ် | အထောက်အထား |
| --- | --- | --- |
| `minimart-staging` | **ရှိပြီးသား** — Owner ဖန်တီးထားသည် | `firebase projects:list --json` (အမည် "Minimart Staging") |
| Plan | **Spark (Free)** — Billing မချိတ် | Project settings |
| Authentication | Email/Password enabled၊ အကောင့် **၂ ခု** | Identity Toolkit `accounts:lookup` (နှစ်ခုလုံး ပြန်ရသည်) |
| Firestore default database | **ရှိပြီးသား**၊ Native mode၊ `asia-southeast1` | `firestore databases describe --database="(default)"` |
| Database အသစ် | **မဖန်တီးပါ** — default DB ကို ပြန်သုံးသည် | — |
| အခြား region | **မတွေ့ပါ** — ထို့ကြောင့် STOP လိုအပ်ခြင်း မရှိ | ဒေတာ မထည့်မီ စစ်ပြီး |
| Staging ဒေတာ (မထည့်မီ) | **အလွတ်** — ဖျက်ရန် ဒေတာ မရှိ | REST list: collection အားလုံး မရှိ |
| Business | `store-staging-main` (ဖန်တီးပြီး) | `businesses/store-staging-main` |
| Branch | `branch-staging-main` (`status = active`) | `businesses/store-staging-main/branches/branch-staging-main` |
| Owner UID | `3tBhEr0UMLfMv7h6CktX5md3Oxm1` | Project IAM `roles/owner` + business `ownerUid` |
| Cashier UID | `lUjNJ6cR6CWcqDufCYsUctHfsQ83` | ဒုတိယ Auth user (အခြား user မရှိ) |
| Web App | `Minimart POS Staging Web` (ဖန်တီးပြီး) | Project settings → Your apps |
| Production | ပြောင်းလဲမှု **မရှိ** | Production Admin/Rules/Auth/Data ကို မ read-only ပြင်ဆင်မှုမှ မလုပ်ပါ |

Owner/Cashier email မြေပုံကို code မှ မခန့်မှန်းပါ။ UID နှစ်ခုကို IAM/Auth
စာရင်းမှ ရယူပြီး Owner အတည်ပြုချက်ကို နောက်ဆုံးအစီရင်ခံစာတွင် ပြန်တောင်းထားသည်။

## 2. Firestore ဒေတာ (ဖန်တီးပြီး)

Seed ကို **Owner ၏ authenticated token** (Owner role → Admin bypass) ဖြင့်
တစ်ကြိမ်သာ ရေးခဲ့သည်။ Service-account key မလိုပါ။ Probe write/delete ဖြင့်
လမ်းကြောင်း မှန်ကြောင်း အရင်စစ်ပြီးမှ ဒေတာ ထည့်သည်။ Production သို့
မည်သည့် request မှ မသွားပါ။

| Path | အကြောင်းအရာ |
| --- | --- |
| `businesses/store-staging-main` | `ownerUid = 3tBhEr0UMLfMv7h6CktX5md3Oxm1`, `active = true` |
| `businesses/store-staging-main/branches/branch-staging-main` | `scope = "branchRecord"`, `kind = "branches"`, `payload.status = "active"`, `payload.currency = "MMK"` |
| `businesses/store-staging-main/members/lUjNJ6cR6CWcqDufCYsUctHfsQ83` | Cashier: `role = "cashier"`, `status = "active"`, `branchIds = ["branch-staging-main"]`၊ သီးခြား `canReceiveStock` |
| `.../branches/branch-staging-main/products/stg-prod-01` … `stg-prod-20` | Stock/batch စမ်းသပ်ရန် ထုတ်ကုန် ၂၀ ခု၊ batch `stg-batch-01` … `stg-batch-20` |
| `.../branches/branch-staging-main/products/stg-prod-unit` | Unit-barcode product၊ batch `stg-batch-unit` |
| `.../branches/branch-staging-main/stockUnitRegistries/stg-reg-unit-1` | Units `stg-unit-001`, `stg-unit-002` (barcode `STG-UNIT-001/002`) |
| `.../branches/branch-staging-main/customers/stg-cust-credit` | Credit sale စမ်းသပ်ရန် customer |

ဤဒေတာသည် **Staging စမ်းသပ်ဒေတာသာ** ဖြစ်သည်။ လူအစစ်၏ ဒေတာ၊
Production ဒေတာ မပါပါ။ Business ID နှင့် branch သည် Production
(`store-mini-main`) နှင့် လုံးဝ ကွဲပြားသည်။

## 3. Staging Rules — Backup နှင့် Deploy

1. မပြောင်းမီ live Staging Rules ကို သိမ်းခဲ့သည်:
   `docs/reference/firestore/staging-rules-backup-2026-11-15.rules`
   (163 bytes၊ SHA-256 `ecf30f940747dcc3c5ba4993093e9a11ac9fc5df7e14b2a1512d2446923d84eb`)။
   မူလ content သည် collection အားလုံးကို ငြင်းပယ်သော all-deny Rules ဖြစ်သည်။
2. Candidate `firestore.rules` (Production candidate နှင့် တူညီသော
   SHA-256 `16ab24353629a796541e05dd7a428f33d178726619c0f2f0d81f82dd6d75d1b3`)
   ဖြင့် compatibility နှင့် Rules test ၃၀/၃၀ PASS ဖြစ်ပြီးမှ deploy လုပ်သည်။
3. Deploy ကို `minimart-staging` တစ်ခုတည်းသို့သာ လုပ်ခဲ့သည်:
   `firebase deploy --only firestore:rules --project minimart-staging`
4. ရလဒ် ruleset: `projects/minimart-staging/rulesets/67c9ab66-a629-4c32-8e73-4a0adab91fc3`။
   ပြန်ဖတ်ပြီး SHA-256 `16ab2435…` ကိုက်ညီကြောင်း အတည်ပြုသည်။
5. Production Rules ကို **မ deploy ပါ**။ Live Production Rules သည်
   candidate နှင့် မတူသေးပါ။

## 4. Web App Staging mode (သီးခြား Isolation)

Staging Web App registration ၏ public config ကို frontend တွင် **mode တစ်ခု**
အဖြစ် ထည့်ထားသည်။ Production key ကို ထပ်မံ မထည့်ပါ။

| File | ပြောင်းလဲမှု |
| --- | --- |
| `src/lib/firebaseRuntime.ts` | `STAGING_PROJECT_ID = "minimart-staging"`, `STAGING_BUSINESS_ID = "store-staging-main"`, `stagingFirebaseConfig`၊ `mode = "staging"` |
| `src/lib/firebase.ts` | `FIREBASE_BUSINESS_ID` ကို runtime မှ ယူသည် (hardcode မဟုတ်) |
| `src/store/usePosStore.ts` | Persist key တွင် mode မဟုတ်လျှင် project ID ထည့် → Staging/Production cache မရော |
| `src/lib/syncManifestStorage.ts` | Sync manifest ကို project အလိုက် ခွဲထား |
| `src/components/OwnerAutoSync.tsx` | Local-only template push ကို emulator တွင်သာ (Production/Staging အတူတူ) |
| `src/components/RuntimeBadge.tsx` | `STAGING · MINIMART-STAGING` badge |
| `src/vite-env.d.ts` | `VITE_FIREBASE_MODE` တွင် `staging` ပါဝင် |

ကာကွယ်မှုများ:

- `mode = "production"` တွင် `minimart-production` သာ။
- `mode = "staging"` တွင် `minimart-staging` / `store-staging-main` သာ
  ဖြစ်ရမည်။ Config ထဲတွင် `minimart-production` ပါလျှင် resolution က
  ငြင်းပယ်သည်။
- `mode = "emulator"` သည် production identifier ကို ငြင်းပယ်သည်။
- Unknown mode (`sandbox` စသည်) fail-closed။
- Production build တွင် `staging` ကို ခွင့်ပြုသည် (isolated project)၊
  `emulator` ကို ငြင်းပယ်သည်။

Staging build လုပ်ရန် (ခွင့်ပြုချက်ရှိလျှင်):

```bash
cd /Users/user/Documents/GitHub/Store
PATH=/tmp/node24/bin:$PATH VITE_FIREBASE_MODE=staging npm run build
```

ဤအကြိမ်တွင် Staging build ကို host/deploy မလုပ်ပါ။ Local runtime tests
(၁၀/၁၀) ဖြင့် mode resolution ကို အတည်ပြုထားသည်။

## 5. Production နှင့် မရောစေရန် ကာကွယ်မှုများ

| ကာကွယ်မှု | အခြေအနေ |
| --- | --- |
| Web App တွင် `staging` mode ရှိပြီး project/business ခွဲထား | ရှိပြီး + test |
| Production identifier ပါလျှင် Staging resolution ငြင်းပယ် | ရှိပြီး + test |
| Staging Worker config သည် `minimart-staging` / `store-staging-main` သာ | ရှိပြီး (`wrangler.staging.toml`, Git-ignored) |
| `ENVIRONMENT=staging` ဖြင့် Production project/business ငြင်းပယ် | ရှိပြီး (`src/index.js`) |
| Service account ၏ `project_id` မကိုက်ညီလျှင် ငြင်းပယ် | ရှိပြီး (`src/firestore/credentials.js`) |
| Preflight `npm run check:staging` | PASS (၀ warning) |
| Production Worker/Web/Rules/Auth/Data | မထိပါ |

## 6. အတည်ပြုထားသော ရလဒ်များ

| စမ်းသပ်မှု | ရလဒ် | အမျိုးအစား |
| --- | --- | --- |
| Rules test | ၃၀/၃၀ PASS | Local emulator |
| Worker POC suite | ၇၀/၇၀ PASS | Local |
| Runtime (Firebase mode) | ၁၀/၁၀ PASS | Local |
| Real Staging data run (Worker code) | ၃၃/၃၃ PASS (`run=20261115144617`) | **Real `minimart-staging` Firestore**၊ token ကို locally လက်မှတ်ထိုး + JWKS inject |
| Staging preflight | PASS | Local/CLI |
| Live Firebase ID token verification | **မ run နိုင်ပါ** | ကန့်သတ်ချက် (အပိုင်း ၇) |

Real Staging run တွင် ပါဝင်သည်: 1/5/10/20-line sale၊ duplicate sale၊
batch/product mismatch၊ stock မလုံလောက်မှု၊ Cash/KPay/Credit၊ unit barcode
တစ်ခုတည်း၊ duplicate unit၊ concurrency၊ Return/Void replay၊ over-return၊
72h lease/24h allowance window၊ expired-hold။ အသေးစိတ်ကို
`CLOUDFLARE-WORKER-STAGING-SETUP-MY.md` အပိုင်း ၄ တွင် ဖတ်ပါ။

## 7. ကန့်သတ်ချက်နှင့် Owner လုပ်ဆောင်ရန်

1. **Live Firebase ID token စမ်းသပ်မှု မရသေးပါ။** Worker သည် Google JWKS
   နှင့် Identity Toolkit ကို ခေါ်ရမည်။ လက်ရှိ session တွင် service-account
   key ဖန်တီးခြင်းကို security classifier က ပိတ်ခဲ့ပြီး၊ `signJwt` အတွက်
   `roles/iam.serviceAccountTokenCreator` ပေးခြင်းကိုလည်း ပိတ်ခဲ့သည်။
   ထို့ကြောင့် data path ကို locally လက်မှတ်ထိုးထားသော token ဖြင့်
   စမ်းသပ်ထားသည်။ ဤအချက်ကို "pass" ဟု မသတ်မှတ်ပါ။
   - Owner လုပ်ဆောင်ရန် (တစ်ခုကို ရွေးပါ): temporary SA key တစ်ခု
     ဖန်တီးခွင့်ပြုခြင်း၊ သို့မဟုတ် `minimart-staging-worker` တွင်
     `roles/iam.serviceAccountTokenCreator` ကို Owner အကောင့်သို့ ပေးခြင်း။
2. Owner/Cashier email မြေပုံကို အတည်ပြုပါ —
   `3tBhEr0UMLfMv7h6CktX5md3Oxm1` = Owner၊
   `lUjNJ6cR6CWcqDufCYsUctHfsQ83` = Cashier။
3. Owner ကိုယ်တိုင် Staging Web App တွင် login ဝင်ပြီး AccessBootstrap
   အလုပ်လုပ်ကြောင်း စမ်းရန် (ဤ session တွင် browser login မလုပ်ခဲ့ပါ)။
4. Worker deploy နှင့် credential အတွက်
   `CLOUDFLARE-WORKER-STAGING-SETUP-MY.md` နှင့်
   `STAGING-SERVICE-ACCOUNT-SECURITY-MY.md` ကို ဖတ်ပါ။

## 8. ဤအကြိမ်တွင် မလုပ်ခဲ့သော အရာများ

- ပရောဂျက်/Auth user/Firestore database အသစ် ဖန်တီးခြင်း — မလုပ်ပါ။
- Blaze/Billing ဖွင့်ခြင်း — မလုပ်ပါ။
- Production Rules/Data/Auth/Functions/Worker ပြောင်းခြင်း — မလုပ်ပါ။
- Staging Worker deploy သို့မဟုတ် checkout integration — မလုပ်ပါ
  (Cloudflare auth မရှိ၊ credential မရှိ)။
- Physical device/printer/scanner စမ်းသပ်မှု — မလုပ်ပါ။
- Git commit/push/merge/publish — မလုပ်ပါ။
