# Minimart Production Firebase Setup (မြန်မာ)

## Project အချက်အလက်
- Firebase Project ID: `minimart-production`
- Firestore Region: Singapore (`asia-southeast1`)
- Internal Business ID: `store-mini-main` (Project ID မဟုတ်ပါ။ Code compatibility အတွက် ယာယီထိန်းထားသည်)
- Owner Email: `tunk51122@gmail.com`
- Owner UID: `LjZX15uSeehtIbyL4SqO1HcyLyC2`
- Authentication: Email / Password (Project ထဲတွင် Owner နှင့် Cashier Account နှစ်ခု ကြိုတင်ဖန်တီးပြီး)
- Firestore: အသစ်၊ လက်ရှိအလွတ်ဖြစ်သည်။

## အရေးကြီးသော လုပ်ဆောင်စဉ်

**အခု Firestore Rules က `allow read, write: if false;` ဖြစ်နေပြီး Firestore Database အလွတ်ဖြစ်သည်။ App ချိတ်မီ Business Parent Document ကို Console မှာ အရင် seed လုပ်ပြီးမှ Rules ကို Publish လုပ်ပါ။**

### 1. Business Owner Document ကို ဖန်တီးရန်
Firebase Console → `minimart-production` → Firestore Database → Data → Start collection ကိုနှိပ်ပါ။

- Collection ID: `businesses`
- Document ID: `store-mini-main`

အောက်ပါ fields များထည့်ပါ။

| Field | Type | Value |
|---|---|---|
| `ownerUid` | string | `LjZX15uSeehtIbyL4SqO1HcyLyC2` |
| `active` | boolean | `true` |
| `name` | string | `Minimart Production` |
| `ownerName` | string | `Tun Kyi` |

အခြား field မလိုအပ်သေးပါ။ Owner UID ကို ပြန်စစ်ပြီးမှ Save လုပ်ပါ။ Cashier UID ကို `ownerUid` ထဲ လုံးဝမထည့်ပါနှင့်။

### 2. Firestore Security Rules Publish လုပ်ရန်
ဒီ ZIP ထဲက `firestore.rules` ဖိုင်ကို ဖွင့်ပြီး Firebase Console → Firestore → Rules ထဲက လက်ရှိ deny-all rule ကို **ဖိုင်တစ်ခုလုံးဖြင့် အစားထိုး** ပါ။ ပြီးလျှင် Publish လုပ်ပါ။

ဒီ Rules တွင်—
- `store-mini-main` Business အတွက် Owner UID ကို အထက်ပါ UID နဲ့ pin လုပ်ထားသည်။
- Owner သာ Cashier Member စာရင်းကို ဖန်တီး/ပြင်/ပိတ်နိုင်သည်။
- Cashier ကို `branchIds` တစ်ခုတည်းသာ ခွင့်ပြုသည်။
- Cashier Cloud မှ Stock-changing writes မလုပ်နိုင်ပါ။
- မသတ်မှတ်ထားသော Collection/Path များကို ပိတ်ထားသည်။

Owner Account ပြောင်းမည်ဆိုလျှင် Rules ထဲက pinned UID ကို အရင်ပြင်ပြီး စမ်းသပ်ရမည်။

### 3. App ချိတ်ဆက်ရန်
`src/lib/firebase.ts` ကို ဒီ Project Config နဲ့ ပြင်ပြီးသားဖြစ်သည်။ `databaseURL` ကို မထည့်ထားပါ၊ အကြောင်းမှာ ဒီ App က Cloud Firestore ကိုသာ အသုံးပြုနေပြီး ဒီ Project မှာ Realtime Database မတည်ဆောက်ရသေးသောကြောင့်ဖြစ်သည်။ Firestore Region သည် server-side setting ဖြစ်ပြီး `firebaseConfig` ထဲ ထည့်စရာမလိုပါ။

### 4. ပထမဆုံး Data Bootstrap — Laptop တစ်လုံးတည်းဖြင့် စတင်ပါ

1. Laptop/Phone နှစ်ခုလုံးရှိ POS JSON Backup ကို သီးခြားသိမ်းပါ။
2. လက်ရှိ Project အဟောင်း `store-mini` ကို မဖျက်ပါနှင့်၊ Config အဟောင်းကို backup လုပ်ထားပါ။
3. လက်ရှိ Data အပြည့်ဆုံးရှိသော Laptop/Browser Origin တစ်ခုကိုသာ ရွေးပါ။
4. အခြား Minimart Tab များ၊ အခြား Localhost Port များနှင့် Phone App ကို ယာယီပိတ်ပါ။
5. ဒီ ZIP ကို Laptop မှာသာ အရင် run လုပ်ပြီး Owner Account အသစ် (`tunk51122@gmail.com`) ဖြင့် Login ဝင်ပါ။
6. Access အောင်မြင်ပြီး Owner Auto Sync က Initial Safe Merge ပြီးကြောင်း ပြသမှသာ ဆက်လုပ်ပါ။
7. Firestore Data ထဲမှာ `businesses/store-mini-main/branches/...` နှင့် Product/Sales documents များရှိကြောင်း စစ်ပါ။

**အရေးကြီး:** New Project သည် Firestore အလွတ်ဖြစ်သော်လည်း Laptop ရဲ့ Local POS Data ရှိပါက Auto Bootstrap က Local-only records များကို Project အသစ်ထဲ Upload လုပ်နိုင်သည်။ ဒါကြောင့် Laptop တစ်လုံးတည်းကို ပထမဆုံး Source of Truth အဖြစ် အသုံးပြုပါ။ Cloud Bootstrap အောင်မြင်ကြောင်း မစစ်မီ Phone ကို Project အသစ် Config နဲ့ မချိတ်ပါနှင့်။

### 5. Cashier Account ချိတ်ရန်

- New Project → Authentication → Users မှ Cashier ရဲ့ **Project အသစ် UID အပြည့်အစုံ** ကိုယူပါ။
- Owner Login ဝင်ပြီး Cloud မှ Branch များ Upload ဖြစ်ပြီးနောက် Profile → ဝန်ထမ်းအကောင့် / Branch Permission → `ရှိပြီးသား Account ချိတ်ရန်` ကိုရွေးပါ။
- Cashier Email၊ Display Name၊ Branch တစ်ခုတည်းနှင့် New Project UID ကို ထည့်ပါ။
- Member Path သည် `businesses/store-mini-main/members/{NEW_CASHIER_UID}` ဖြစ်ရမည်။
- Project အဟောင်း `store-mini` မှ Cashier UID ကို မသုံးပါနှင့်။

## Security / API Key

Firebase Web API Key သည် Web Client Configuration ဖြစ်ပြီး Public JavaScript Bundle ထဲတွင် ပါနိုင်သည်။ Service Account JSON, Private Key, Admin SDK Credential, Password များကို မမျှဝေပါနှင့်။ Security ကို Firestore Rules နှင့် Authentication ဖြင့် ထိန်းပါ။ Hosting Domain များ သတ်မှတ်ပြီးနောက် Google Cloud API Key HTTP Referrer Restriction ကို ထည့်နိုင်သည်။

## Rollback

စမ်းသပ်မှု မအောင်မြင်ပါက App Config ကို အဟောင်း Project Config သို့ ပြန်ထားနိုင်ရန် မူလ `firebase.ts` ကို သီးခြား Backup ထားပါ။ Project အဟောင်းနဲ့ Data များကို မဖျက်ပါနှင့်။
