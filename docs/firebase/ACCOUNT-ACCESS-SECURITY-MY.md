# Account Access Security — v3.2.2

## သတ်မှတ်ထားသော စည်းမျဉ်း

- Website ရဲ့ ပထမစာမျက်နှာမှာ Login သာ ပြမည်။
- App UI မှ Public Sign Up နှင့် Account အသစ်ဖန်တီးခြင်းကို ဖယ်ရှားထားသည်။
- Role အဖြစ် `owner` သို့မဟုတ် `cashier` သာ အသုံးပြုနိုင်သည်။
- Owner သည် `businesses/store-mini-main.ownerUid` နှင့် UID ကိုက်ညီရမည်။ `members/{uid}` ထဲတွင် `role: owner` ရှိရုံဖြင့် Owner ခွင့်မရပါ။
- Cashier သည် `members/{uid}` တွင် `role: cashier`, `status: active`, `uid` ကိုက်ညီပြီး Active Branch တစ်ခုတည်း သတ်မှတ်ထားရမည်။ Email သည် Firebase Auth Email နှင့်လည်း ကိုက်ညီရမည်။
- Cashier အသစ်ကို App ထဲမှ Firebase Auth Account အဖြစ် ဖန်တီးခွင့် မရှိပါ။ Firebase Console ရှိ Project Admin က ကြိုတင်ဖန်တီးပြီး Owner က UID ဖြင့် Business Member အဖြစ် ချိတ်ဆက်ရမည်။ Firebase Console/Admin SDK က privileged admin action ဖြစ်သောကြောင့် `beforeUserCreated` ကို မခေါ်နိုင်သည့်အတွက် `beforeUserSignedIn` က Member မရှိသူကို အဝင်မခံရပါ။

## Firebase Auth Server-Side Blocking ကို အသက်သွင်းရန်

`functions/src/index.ts` တွင် Function နှစ်ခု ပါဝင်သည်။

1. `blockPublicAccountRegistration` — Client/Public Account Creation ကို ငြင်းပယ်သည်။
2. `allowOnlyOwnerAndActiveCashiers` — Sign In မပြီးမီ Business Owner သို့မဟုတ် Active Cashier ဖြစ်ကြောင်း Server မှ စစ်ဆေးသည်။

**အရေးကြီး:** Blocking Functions သုံးရန် Firebase Project ကို Firebase Authentication with Identity Platform သို့ Upgrade လုပ်ထားရမည်။ ဒီအဆင့်မလုပ်ရသေးလျှင် UI Sign Up ကို ဖယ်ရှားထားသော်လည်း Firebase Auth REST/SDK endpoint ကို တခြား Client က ခေါ်၍ Auth User အလွတ်ဖန်တီးနိုင်ခြေ ကျန်နေမည်။ Blocking Function အသက်ဝင်ပြီးနောက် Public/client-side create ကို ပိတ်မည်။ Firebase Console/Admin SDK မှ Project Admin က provision လုပ်ခြင်းသည် privileged admin action ဖြစ်ပြီး Blocking Function ကို မခေါ်နိုင်သဖြင့် `beforeUserSignedIn` က Member မရှိသူကို ပယ်ချရမည်။

### Deploy လုပ်ရန်

1. Firebase Console မှ `minimart-production` Project ကိုဖွင့်ပါ။
2. Authentication → Upgrade to Firebase Authentication with Identity Platform ကို လုပ်ဆောင်ပါ။ လက်ရှိ Firebase plan၊ Billing account နှင့် Cloud Functions prerequisites ကို Console မှ အတည်ပြုပါ။ Cloud Functions deployment သည် Blaze / pay-as-you-go billing plan လိုအပ်နိုင်ပြီး Usage Budget Alert ထည့်ထားပါ။
3. Node.js 22 နှင့် Firebase CLI ကို အသုံးပြုပါ။ Project တွင် `firebase.json` က Functions runtime ကို `nodejs22` ဟု သတ်မှတ်ထားသည်။
4. အောက်ပါအတိုင်း Functions ကို Build လုပ်ပါ။

```bash
npm --prefix functions install
npm --prefix functions run build
firebase login
```

5. Test Project / Emulator မှာ Rules နှင့် Auth flow ကို စမ်းသပ်ပြီး အတည်ပြုမှသာ အောက်ပါ Deployment ကို သီးခြားလုပ်ပါ။ ဒီ command များသည် Production Rules / Functions ကို ပြောင်းလဲမည်ဖြစ်သောကြောင့် မူရင်း Rules Backup ယူထားပါ။

```bash
firebase deploy --only firestore:rules --project minimart-production
firebase deploy --only functions --project minimart-production
```

6. Firebase Console → Authentication → Settings တွင် Blocking Functions နှစ်ခု Register / Active ဖြစ်နေကြောင်း စစ်ပါ။
7. လက်ရှိ Owner Account ဖြင့် Login ဝင်နိုင်ကြောင်း စမ်းပါ။
8. Active Cashier တစ်ယောက်ဖြင့် Login ဝင်ပါ။
9. Member မရှိသော Test Account၊ Disabled Cashier၊ Archived Branch သို့မဟုတ် Branch မသတ်မှတ်ထားသော Cashier တို့ကို Sign In မရကြောင်း စမ်းပါ။
10. Test ပြီးမှသာ Production အသုံးပြုမှုကို အတည်ပြုပါ။

### Cashier Account အသစ်ထည့်ရန် လုပ်ငန်းစဉ်

1. Firebase Console → Authentication → Users → Add User မှ Admin က Account ဖန်တီးပါ။
2. User UID နှင့် Email ကို ကူးယူပါ။
3. Owner အဖြစ် App Login ဝင်ပါ။
4. Profile → ဝန်ထမ်းအကောင့် / Branch Permission သို့သွားပါ။
5. အမည်၊ Email၊ UID နဲ့ တာဝန်ကျ Branch တစ်ခုကို ထည့်ပြီး ရှိပြီးသား Account ကို ချိတ်ပါ။
6. Member စာရင်းမှ UID / Role / Branch ကို Verify လုပ်ပါ။
7. ထို့နောက်မှ Cashier က Login ဝင်နိုင်မည်။

## ထိန်းသိမ်းထားသော အရာများ

- လက်ရှိ Firebase Project Configuration နှင့် Firebase Auth Sign-In Logic မပြောင်းထားပါ။
- ရှိပြီးသား Owner / Cashier Auth User များကို မဖျက်၊ Password မပြောင်းပါ။
- Firestore Business Data၊ Product၊ Sales၊ Stock၊ Branch၊ Price Group များကို Migration မလုပ်ပါ။
- Firestore Rules တွင် အခြား role အမည်များကို Active Member အဖြစ် လက်ခံမထားတော့ပါ။

## Deployment သတိပြုရန်

ဒီ Source Package ထုတ်ခြင်းက Cloud Function ကို အလိုအလျောက် Deploy မလုပ်ပါ။ Firebase Console မှ Identity Platform Upgrade၊ Functions Deploy နှင့် Blocking Triggers Register/Enable ပြီးမှ Server-Side Auth Guard အပြည့်အဝ အသက်ဝင်မည်။ `beforeUserSignedIn` သည် Server Firestore ဖတ်ရန်လိုသဖြင့် Firestore region/Function latency ကို စမ်းသပ်ပါ။ Blocking Function သည် 7 seconds အတွင်း ပြန်ဖြေရမည်။ Function များကို Deploy လုပ်ပြီးနောက် ဖျက်မည်ဆိုရင် Identity Platform Blocking Trigger ကိုလည်း Console မှ Unregister လုပ်ရမည်။ မလုပ်ပါက Authentication လုပ်ငန်းစဉ် ပိတ်ဆို့နိုင်သည်။
