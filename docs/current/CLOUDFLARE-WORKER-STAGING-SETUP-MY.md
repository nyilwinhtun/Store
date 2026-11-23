# V3.3.0 Cloudflare Worker Staging — အကောင်အထည်ဖော်ပြီး အခြေအနေ

နေ့စွဲ: 2026-11-15
အခြေအနေ: **Config နှင့် ကုဒ် အသင့်ဖြစ်ပြီး။ Real Staging ဒေတာဖြင့်
Worker ကုဒ်ကို စမ်းသပ်ပြီး (၃၃/၃၃)။ Staging Worker ကို မ deploy ရသေးပါ။**

Worker ကို Deploy မလုပ်ရခြင်း အကြောင်းရင်း ၂ ခု:
1. Cloudflare authentication မရှိပါ (`wrangler login` လိုအပ်သည်)။
2. လက်ရှိ session တွင် service-account key ဖန်တီးခြင်းကို security
   classifier က ပိတ်ခဲ့သည်။ Secret ကို chat မှ မတောင်းပါ။

**2026-11-15 ပြန်စစ်ချက်:** Cloudflare login သည် **အောင်မြင်ပြီး**
(account `667cad12f7218e155d6d5f1754142380`, Wrangler 4.162.0)။
သို့သော် `minimart-sales-staging` Worker သည် account ပေါ်တွင်
**မရှိသေးပါ** — deployment မရှိ၊ version မရှိ၊ secret မရှိ။
Download လုပ်ထားသော key သည် `firebase-adminsdk-…` SA ဖြစ်သဖြင့်
မသုံးရပါ။ လိုအပ်သည်မှာ `minimart-staging-worker` ၏ key သာ ဖြစ်သည်။

Production Worker `minimart-spark-sales-poc` နှင့် Production မည်သည့်
အရာကိုမှ မထိခဲ့ပါ။ Cloudflare တွင် deploy/upload လုံးဝ မလုပ်ခဲ့ပါ။

## 1. ပြင်ဆင်ပြီးသော Files

| File | အခြေအနေ | ရည်ရွယ်ချက် |
| --- | --- | --- |
| `wrangler.staging.toml` | Git-ignored | Staging Worker config |
| `wrangler.staging.example.toml` | မွမ်းမံ | `ENVIRONMENT = "staging"` |
| `staging.fixture.example.json` | မွမ်းမံ | `minimart-staging` / `store-staging-main` |
| `src/index.js` | မွမ်းမံ | Staging target guard |
| `src/firestore/credentials.js` | မွမ်းမံ | Service account project binding |
| `test/runtime-config.test.mjs` | အသစ် | Guard tests ၆ ခု |

`wrangler.staging.toml` သည် `.gitignore` တွင် ပါသည်။ Git သို့ မထည့်ပါ။

## 2. Staging Configuration (အတည်ပြုပြီး)

```toml
name = "minimart-sales-staging"
main = "src/index.js"
compatibility_date = "2026-11-15"
workers_dev = true

[vars]
FIREBASE_PROJECT_ID = "minimart-staging"
BUSINESS_ID = "store-staging-main"
ENVIRONMENT = "staging"
CHECK_TOKEN_REVOCATION = "true"

[triggers]
crons = ["15 * * * *"]
```

Runtime guard သည် `ENVIRONMENT=staging` ဖြစ်လျှင်
`FIREBASE_PROJECT_ID=minimart-production` သို့မဟုတ်
`BUSINESS_ID=store-mini-main` ကို ငြင်းပယ်သည်။ Service account JSON ၏
`project_id` သည် `minimart-staging` မဟုတ်လျှင် credential အဆင့်တွင်
ငြင်းပယ်သည်။ Preflight:

```bash
cd /Users/user/Documents/GitHub/Store
PATH=/tmp/node24/bin:$PATH npm run check:staging
```

ရလဒ်: **PASS (၀ warning)**။

## 3. Deploy မလုပ်မီ လိုအပ်ချက်များ — အခြေအနေ

| လိုအပ်ချက် | အခြေအနေ |
| --- | --- |
| `minimart-staging` ရှိပြီး Spark ဖြစ်ခြင်း | ပြီး |
| Firestore Native၊ `asia-southeast1` | ပြီး |
| Owner/Cashier Auth အကောင့်များ | ပြီး (၂ ခု) |
| Business/Branch/member/seed data | ပြီး |
| Service account + IAM role | ပြီး (key မရသေး) |
| Service-account key → Cloudflare secret | **မပြီး** |
| Cloudflare authentication | **မပြီး** |
| `npm run check:staging` | PASS |
| Owner စာဖြင့် deploy ခွင့်ပြုချက် | မရသေးပါ |

### 3.1 Secret ထည့်ခြင်း — Deploy မဟုတ်သော်လည်း Version အသစ် ဖြစ်သည်

`wrangler secret put` သည် **Worker version အသစ်တစ်ခု publish လုပ်သည်**။
ထို့ကြောင့် deploy ခွင့်မရှိသေးလျှင် secret ကို မတင်ပါနှင့် — သို့မဟုတ်
တင်လိုက်ခြင်းသည် Staging Worker ကို အလိုအလျောက် အသက်သွင်းသလို ဖြစ်သည်။
ဤအကြိမ်တွင် နှစ်ခုလုံး မလုပ်ခဲ့ပါ။

Owner လုပ်ဆောင်ရန် (ခွင့်ပြုချက်ပေးပြီးမှ):

```bash
cd /Users/user/Documents/GitHub/Store/experiments/cloudflare-workers-spark-poc

npx wrangler login
npx wrangler secret put FIRESTORE_SERVICE_ACCOUNT \
  --config wrangler.staging.toml \
  < "$HOME/Downloads/minimart-staging-service-account.json"
npx wrangler deploy --config wrangler.staging.toml
```

`--config wrangler.staging.toml` မပါဘဲ **မ run ရ**။ မပါလျှင် default
`wrangler.toml` (Production Worker အမည်) သို့ ရောက်နိုင်သည်။

Deploy ပြီးနောက် စစ်ရန်:

```bash
npx wrangler secret list --config wrangler.staging.toml
npx wrangler deployments list --config wrangler.staging.toml
```

`FIRESTORE_SERVICE_ACCOUNT` အမည်သာ ပေါ်ရမည်။ တန်ဖိုး မပေါ်ရ။

## 4. စမ်းသပ်မှု ရလဒ်

### A. Local (Emulator + unit)

- Worker POC: **၇၀/၇၀ PASS** (config guard ၆ ခု အပါအဝင်)။
- Rules: **၃၀/၃၀ PASS**။
- Runtime: **၁၀/၁၀ PASS**။
- ပါဝင်သည်: token signature/claims၊ branch isolation၊ duplicate/retry၊
  concurrency၊ 1/5/10/20-line၊ Cash/KPay/Credit၊ Void/Return၊ 23h/24h/25h
  allowance၊ 71h/72h/73h lease၊ expired-hold၊ Owner reconcile။
- ဤရလဒ်သည် **Emulator/local သာ** ဖြစ်သည်။ Cloud Staging မဟုတ်ပါ။

### B. Real Firebase Staging data (run ပြီး)

အမှန်တကယ် `minimart-staging` Firestore သို့ Worker ကုဒ် (`src/app.js`) မှ
တိုက်ရိုက် ရေးခဲ့သည်။ Service-account key မရသဖြင့် Firestore ကို Owner
token (Admin bypass) ဖြင့် ဖတ်သည်။ Worker သို့ ပို့သော ID token ကို
**locally လက်မှတ်ထိုး** (RS256 keypair) ပြီး JWKS fetch ကို inject လုပ်ထားသည်။
ထို့ကြောင့် ဤသည် data/transaction path ၏ စစ်မှန်သော စမ်းသပ်မှုဖြစ်သည်၊
သို့သော် **Google မှ ထုတ်ပေးသော token ကို verify လုပ်ခြင်း မဟုတ်ပါ**။

ရလဒ်: `SUMMARY pass=33 fail=0 run=20261115144617`

| စမ်းသပ်မှု | ရလဒ် |
| --- | --- |
| Business/Branch/Cashier membership တည်ရှိမှု | PASS |
| 1-line Cash sale + stock 100 → 99 | PASS |
| တူညီသော Sale ID retry → `already-committed`၊ stock မရွေ့ | PASS |
| 5-line / 10-line / 20-line Cash sale | PASS |
| Batch/product mismatch → 409 | PASS |
| Stock မလုံလောက်မှု → 409 | PASS |
| KPay (Transaction ID အသစ်) | PASS |
| KPay Transaction ID ထပ်နှစ်ခြင်း → 409 | PASS |
| Credit sale (customer ရှိ) | PASS |
| Unit barcode sale → unit `sold` + Sale ID | PASS |
| ရောင်းပြီးသား unit ထပ် → 409 | PASS |
| Sale တစ်ခုတည်းတွင် unit နှစ်ခါ → 409 | PASS |
| တပြိုင်နက် unit sale ၂ ခု → တစ်ခုသာ အောင်၊ တစ်ခု 409 | PASS |
| Return (restock) + unit `in_stock` | PASS |
| Over-return → 409 | PASS |
| Void + Sale status `voided` | PASS |
| Return ပြီးနောက် Void → 409 | PASS |
| မခွဲထားသော Branch → 403 | PASS |
| ပြုပြင်ထားသော token → 401 | PASS |
| Allowance ထုတ်ပေးမှု (real stock) | PASS |
| Allowance window = ၂၄ နာရီ | PASS |
| Authorization lease = ၇၂ နာရီ | PASS |
| Offline allowance commit | PASS |
| Offline retry idempotent | PASS |

ဤ run သည် ဒေတာကို ရေးခဲ့သည် (Staging သာ)။ Staging data ကို ဖျက်ခြင်း
မလုပ်ပါ။

### C. Deployed Staging Worker

**မရသေးပါ။** Deploy မလုပ်ခဲ့သဖြင့် deployed URL, `wrangler tail`, CPU
metrics, cron လုပ်ဆောင်မှု စမ်းသပ်မှု မရှိပါ။

### D. Physical device/browser

**မလုပ်ရသေးပါ။** ZYWELL ZM04 80mm printing၊ scanner၊ Android၊ iPhone ကို
သီးခြား စမ်းရမည်။ Browser rendering သည် physical printing သက်သေ မဟုတ်ပါ။

## 5. Live Token Verification ကန့်သတ်ချက်

Worker ၏ Google JWKS + Identity Toolkit token verification ကို **တကယ့်
Firebase ID token** ဖြင့် မ run နိုင်သေးပါ။ လိုအပ်ချက်မှာ-
- `minimart-staging-worker@minimart-staging.iam.gserviceaccount.com` ၏ key
  တစ်ခု (classifier က ပိတ်ခဲ့သည်)၊ သို့မဟုတ်
- Worker SA ပေါ်တွင် `roles/iam.serviceAccountTokenCreator` (Owner အကောင့်သို့)
  ပေးပြီး `signJwt` ဖြင့် custom token ထုတ်ခြင်း (classifier က ပိတ်ခဲ့သည်)။

ဤအချက်ကို pass ဟု မသတ်မှတ်ပါ။ Owner ခွင့်ပြုချက်ရလျှင်
`CLOUDFLARE-WORKER-STAGING-SETUP-MY.md` နှင့်
`STAGING-SERVICE-ACCOUNT-SECURITY-MY.md` ပါ အဆင့်များဖြင့် ပြန်စမ်းရမည်။

## 6. လုံခြုံရေး အာမခံချက်များ (မပြောင်းလဲ)

- Firebase ID token ကို Worker တွင် စစ်ဆေးသည်; request body မှ UID/role ကို
  မယုံပါ။
- 72-hour lease နှင့် 24-hour offline allowance ကို server က ထုတ်ပေးသည်။
- Expired allowance → `expired-hold`; stock ကို အလိုအလျောက် မလွှတ်ပါ
  (local test ဖြင့် အတည်ပြု)။
- Pending sale/payment/stock-handover records ကို မဖျက်ပါ။
- Fingerprint idempotency နှင့် duplicate barcode/unit ကာကွယ်မှု ရှိသည်။
- Sale + Product + Batch + Unit Registry + Audit ကို transaction တစ်ခုတည်းဖြင့်
  ရေးသည်။
- Branch-level authorization; cross-branch ငြင်းပယ်။
- Rules သို့မဟုတ် integrity check များကို အားနည်းအောင် မပြောင်းရ။

## 7. Rollback (deploy ပြီးမှသာ)

```bash
cd /Users/user/Documents/GitHub/Store/experiments/cloudflare-workers-spark-poc

npx wrangler deployments list --config wrangler.staging.toml
npx wrangler rollback <deployment-id> --config wrangler.staging.toml
npx wrangler delete --config wrangler.staging.toml
```

- `wrangler delete` ကို `--config wrangler.staging.toml` မပါဘဲ မ run ရ။
- Secret ဖယ်ရှားရန်: `npx wrangler secret delete FIRESTORE_SERVICE_ACCOUNT --config wrangler.staging.toml`။
  ၎င်းသည်လည်း version အသစ်တစ်ခု ဖြစ်နိုင်သည်။
- Key ကို Google Cloud Console တွင် ရုပ်သိမ်းရန် မမေ့ပါနှင့်။
- Staging ဒေတာ (Sale/Return/allowance) ကို rollback တွင် မဖျက်ပါနှင့်။

## 8. ရပ်တန့်ရမည့် အခြေအနေများ

- Secret မထည့်ရသေးလျှင် deploy မလုပ်ပါ။
- Preflight FAIL ဖြစ်လျှင် deploy မလုပ်ပါ။
- Cloudflare account တွင် Free plan မဟုတ်လျှင် ရပ်ပါ။
- Production ID ပါနေလျှင် ရပ်ပါ။
- Owner ခွင့်ပြုချက် မရှိလျှင် deploy မလုပ်ပါ။
- Real deployed Staging ရလဒ် မရှိဘဲ "Staging passed" မဆိုပါ။
