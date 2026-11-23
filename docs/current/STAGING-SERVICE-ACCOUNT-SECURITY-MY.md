# V3.3.0 Staging Service Account လုံခြုံရေး — အကောင်အထည်ဖော်ပြီး အခြေအနေ

နေ့စွဲ: 2026-11-15
အခြေအနေ: **Service account နှင့် အနည်းဆုံး IAM role ဖန်တီးပြီး။
Key မ ဖန်တီးရသေးပါ (security classifier က ပိတ်ခဲ့သည်)။
Worker မ deploy ရသေးပါ။**

Service account သည် Firestore Security Rules ကို ကျော်ဖြတ်သောကြောင့်
၎င်းကို အထူးလုံခြုံရေး နယ်နိမိတ်အဖြစ် သတ်မှတ်ရသည်။ ဤစာရွက်စာတမ်းတွင်
ဖော်ပြထားသော key/secret မည်သည့်တန်ဖိုးမှ chat, Git, source, log,
documentation ထဲ မထည့်ပါ။

## 1. ဖန်တီးပြီး Service Account

| အရာ | တန်ဖိုး |
| --- | --- |
| Email | `minimart-staging-worker@minimart-staging.iam.gserviceaccount.com` |
| Display name | `Minimart Staging Worker` |
| Project | `minimart-staging` (သာ) |
| Key | **မရှိပါ** — key အသစ် မဖန်တီးရသေးပါ |
| Production binding | **မရှိပါ** — Production တွင် role မပေးခဲ့ပါ |

IAM policy ကို ပြန်ဖတ်ပြီး အောက်ပါ role နှစ်ခုသာ ရှိကြောင်း
အတည်ပြုထားသည်:

| Role | ဘာအတွက် | မပေးလျှင် |
| --- | --- | --- |
| `roles/datastore.user` | Firestore REST transaction read/write | Sale commit မလုပ်နိုင် |
| `roles/firebaseauth.viewer` | `validSince` ဖြင့် token revocation စစ်ဆေးရန် | `CHECK_TOKEN_REVOCATION=true` ဖြစ်နေလျှင် 503 |

`Owner`, `Editor`, `Firebase Admin`, `roles/datastore.owner`,
`roles/iam.serviceAccountTokenCreator` မပေးထားပါ။
`CHECK_TOKEN_REVOCATION` ကို ပိတ်လျှင် viewer role မလိုအပ်သော်လည်း
လုံခြုံရေးအတွက် Staging တွင် `true` ထားရှိသည်။

## 2. Worker ကုဒ် အမှန်တကယ် အသုံးပြုသော Google API များ

| API | ကုဒ် | လိုအပ်သော ခွင့်ပြုချက် |
| --- | --- | --- |
| OAuth token exchange | `src/firestore/credentials.js` (`TOKEN_URL`) | မလိုပါ (key ဖြင့် token ရယူသည်) |
| Firestore REST | `src/firestore/rest.js` | `roles/datastore.user` |
| Identity Toolkit `accounts:lookup` | `src/auth/verifyIdToken.js` | `roles/firebaseauth.viewer` |
| Firebase public JWKS | `src/auth/verifyIdToken.js` | မလိုပါ (public endpoint) |

Worker သည် Cloud Storage, Cloud Functions, Admin SDK အခြား API များကို
**အသုံးမပြုပါ**။

### 2.1 OAuth Scope နှင့် IAM Role နှစ်ခုလုံး လိုအပ်သည်

- Scope သည် access token က ဘယ် API ကို ခေါ်နိုင်သည်ကို သတ်မှတ်သည်။
  လက်ရှိကုဒ်တွင် `datastore` နှင့် `identitytoolkit` scope နှစ်ခု ပါပြီးသား
  ဖြစ်သည်။
- IAM role သည် အဆိုပါ API ခေါ်မှုကို အမှန်တကယ် ခွင့်ပြုသည်။ scope တစ်ခုတည်း
  ဖြင့် မလုံလောက်ပါ။
- Role များကို **Staging ပရောဂျက်တွင်သာ** ပေးထားသည်။

## 3. Key ဖန်တီးခြင်း — ပိတ်ခံရပြီး Owner လုပ်ဆောင်ရန်

ဤ session တွင် service-account key တစ်ခု ဖန်တီးရန် ကြိုးစားမှုကို
Auto-mode security classifier က **ပိတ်ခဲ့သည်** ("Secret-Store Writes")။
ထို့ကြောင့် key မရှိပါ၊ ထပ်မကြိုးစားပါ။ Chat မှ key တောင်းခြင်း မလုပ်ပါ။

**2026-11-15 ပြန်စစ်ချက်:** `~/Downloads/minimart-staging-ee44bb00a5ff.json`
သည် `firebase-adminsdk-fbsvc@minimart-staging.iam.gserviceaccount.com` ၏ key
ဖြစ်သည် (project `minimart-staging`)။ ၎င်းသည် **Worker SA မဟုတ်ပါ**။
ထို့ကြောင့် Cloudflare အတွက် **မသုံးပါ**။ ထို SA တွင်
`firebaseauth.admin` နှင့် `serviceAccountTokenCreator` ပါသဖြင့်
လိုအပ်သည်ထက် အာဏာ ပိုများသည်။ Key ကို ဖျက်ခြင်း/revoke လုပ်ခြင်း
မလုပ်ရသေးပါ — လုပ်ရန် ဆုံးဖြတ်ချက်ကို Owner ထံ ချန်ထားသည်။
Worker SA ၏ key တစ်ခုသာ လိုအပ်နေသည်။

Owner ကိုယ်တိုင် (Console သို့မဟုတ် ကိုယ်ပိုင် authenticated terminal):

1. https://console.cloud.google.com/iam-admin/serviceaccounts?project=minimart-staging
   → `minimart-staging-worker` → **Keys → Add key → Create new key → JSON**။
2. ရလာသော JSON တွင် `"project_id": "minimart-staging"` ဖြစ်ကြောင်း စစ်ပါ။
   `minimart-production` ဖြစ်နေလျှင် **ချက်ချင်း ရပ်ပါ**။
3. ဖိုင်ကို `$HOME/Downloads/minimart-staging-service-account.json` အဖြစ်
   သိမ်းပါ။
4. Key ကို chat, Git, source, fixture, `.env`, `.dev.vars`, screenshot,
   email ထဲ မထည့်ပါ။

> Spark plan တွင် service account key ရယူနိုင်သည်။ Billing မလိုပါ။
> Console က မခွင့်ပြုလျှင် Billing မဖွင့်ဘဲ ရပ်ပြီး အစီရင်ခံပါ။

## 4. Cloudflare Secret အဖြစ် ထည့်ခြင်း

**အရေးကြီး:** `wrangler secret put` သည် **Worker version အသစ်တစ်ခု
publish လုပ်သည်**။ ထို့ကြောင့် secret တင်ခြင်းသည် deploy နှင့် အတူတူ
ဖြစ်နိုင်သည်။ Owner deploy ခွင့်ပြုချက် မရှိသေးလျှင် secret ကို
မတင်ပါနှင့်။ ဤအကြိမ်တွင် မတင်ခဲ့ပါ။

`wrangler.staging.toml` ကို `--config` ဖြင့် အတိအကျ ညွှန်ရမည်။
မဟုတ်လျှင် default `wrangler.toml` (Production Worker အမည်) သို့ secret
တင်မိမည်။

```bash
cd /Users/user/Documents/GitHub/Store/experiments/cloudflare-workers-spark-poc

npx wrangler login
npx wrangler secret put FIRESTORE_SERVICE_ACCOUNT \
  --config wrangler.staging.toml \
  < "$HOME/Downloads/minimart-staging-service-account.json"
```

စစ်ဆေးရန် (တန်ဖိုးကို မပြပါ၊ အမည်သာ):

```bash
npx wrangler secret list --config wrangler.staging.toml
```

မျှော်လင့်ရလဒ်: `FIRESTORE_SERVICE_ACCOUNT` အမည် ပေါ်ခြင်း။
တန်ဖိုးကို ဘယ်တော့မှ ပြန်မပြပါ။

### 4.1 Key ဖိုင် ရှင်းလင်းခြင်း

```bash
rm -P "$HOME/Downloads/minimart-staging-service-account.json"
ls "$HOME/Downloads/minimart-staging-service-account.json"
```

မျှော်လင့်ရလဒ်: `No such file or directory`။

- `rm -P` သည် အကောင်းဆုံး ကြိုးစားမှုသာ ဖြစ်သည်။ SSD/APFS တွင်
  physical block များ ကျန်နိုင်သည်။ Disk ကို FileVault ဖြင့် encrypt
  ထားရမည်။
- Downloads သည် iCloud Drive ထဲ မရှိကြောင်း စစ်ပါ။
- Key ဖိုင်ကို Trash ထဲ မပို့ပါနှင့်။ မလိုအပ်လျှင် အခြား copy မထားပါ။

## 5. ပရောဂျက် ချိတ်ဆက်မှု အတည်ပြုခြင်း

ကုဒ်တွင် ကာကွယ်မှု ၂ ခု ရှိသည်:

1. `ENVIRONMENT=staging` ဖြစ်လျှင် `minimart-production` project သို့မဟုတ်
   `store-mini-main` business ကို ငြင်းပယ်သည် (`src/index.js`:
   `resolveWorkerTarget`)။
2. Service account JSON ၏ `project_id` သည် `FIREBASE_PROJECT_ID` နှင့်
   မကိုက်ညီလျှင် ငြင်းပယ်သည် (`src/firestore/credentials.js`)။

ဤကာကွယ်မှုများသည် local test ဖြင့် အတည်ပြုထားသည်။ Key ရပြီး secret
တင်ပြီးနောက် အောက်ပါအတိုင်း စစ်ရမည်:

1. Staging key ဖြင့် access token ရယူပြီး `minimart-staging` Firestore ကို
   ဖတ်နိုင်ခြင်း။
2. တူညီသော token ဖြင့် `minimart-production` Firestore ကို ဖတ်ကြည့်လျှင်
   **403** ရခြင်း။ 403 မဟုတ်ဘဲ ဖတ်နိုင်လျှင် IAM ကို ချက်ချင်း ရပ်ပြီး
   production role ကို ဖယ်ရှားပါ။
3. `npx wrangler tail --config wrangler.staging.toml` တွင် secret/key မပေါ်ခြင်း။

## 6. Rotation နှင့် ဖျက်ခြင်း

- Key အသစ် ဖန်တီး → secret အသစ် upload → Staging Worker စမ်းသပ် →
  Google Cloud Console တွင် key အဟောင်း ဖျက်။
- Key ပေါက်ကြားသည်ဟု သံသယရှိလျှင် အဟောင်းကို ချက်ချင်း ဖျက်ပြီး
  အသစ်တစ်ခု ထုတ်ပါ။ ထို့နောက် Cloudflare secret ကို အစားထိုးပါ။
- Staging Worker ကို ရပ်လျှင်
  `npx wrangler secret delete FIRESTORE_SERVICE_ACCOUNT --config wrangler.staging.toml`
  ဖြင့် secret ကို ဖယ်ရှားနိုင်သည်။ ၎င်းသည်လည်း version အသစ် ဖြစ်နိုင်သည်။
- Key ID/private key ကို documentation ထဲ မှတ်တမ်းမတင်ပါ။

## 7. ကန့်သတ်ချက်များ

1. Service account သည် Firestore Rules ကို ကျော်ဖြတ်သည်။ Worker ကုဒ်ထဲရှိ
   role/branch/membership/device/lease စစ်ဆေးမှုများသာ ကာကွယ်မှု ဖြစ်သည်။
2. IAM role များသည် project တစ်ခုလုံးအတွက် ဖြစ်သည်။ Staging key ဖြင့်
   Staging ၏ ဒေတာအားလုံးကို ရေးနိုင်သည်။ ထို့ကြောင့် Staging ဒေတာတွင်
   လူအစစ်၏ ဒေတာ မထည့်ပါနှင့်။
3. Cloudflare account သို့မဟုတ် Worker secret ပေါက်ကြားလျှင် key ကို
   ချက်ချင်း rotate လုပ်ရမည်။
4. Revocation စစ်ဆေးမှုသည် Identity Toolkit ကို ခေါ်သည်။ ၎င်း API မရနိုင်လျှင်
   Worker သည် 503 ဖြင့် fail-closed ဖြစ်သည်။
5. Key မရှိသေးသဖြင့် **live token verification နှင့် deployed Worker
   စမ်းသပ်မှု မရှိပါ**။ ဤအချက်ကို pass ဟု မသတ်မှတ်ပါ။
