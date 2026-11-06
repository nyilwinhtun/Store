
> v2.8.5 React Runtime Fix: React/ReactDOM versions are now explicitly matched and Vite deduplicates React so Zustand hooks use the same runtime. See `V2.8.5-REACT-RUNTIME-FIX-MY.md` for update steps.

# Minimart POS v2.8.5 — PWA + Device Sync + Cashier Account Fix

ဒီ Version က v2.8.3 ရဲ့ Owner Device Auto Sync နဲ့ PWA ပြင်ဆင်ချက်များကို ဆက်ထိန်းပြီး Cashier Account ဖန်တီးခြင်း၊ ရှိပြီးသား Firebase Account ကို UID ဖြင့် ချိတ်ဆက်ခြင်းနှင့် Member Record ပြန်လည်ပြင်ဆင်နိုင်မှုကို ထပ်ဖြည့်ထားပါတယ်။

## Mac မှာ စတင်ရန်

1. လက်ရှိအသုံးပြုနေတဲ့ App မှာ Settings → Backup ကနေ JSON Backup ထုတ်ပါ။
2. ZIP ကို Folder အသစ်အဖြစ် ဖြည်ပါ။
3. VS Code မှာ Folder အသစ်ကို ဖွင့်ပါ။
4. Terminal မှာ အောက်ပါ Command တွေ လုပ်ပါ။

```bash
npm install
npm run typecheck
npm run build
npm run dev -- --host --port 5173 --strictPort
```

Browser မှာ `http://localhost:5173` ကို ဖွင့်ပါ။ LocalStorage / IndexedDB ကို မဖျက်ပါနဲ့။

## v2.7.5 မှာ ထည့်ထားပြီး ဆက်လက်ထိန်းထားသော ကုန်လွှဲ Feature များ

- ကုန်လွှဲတဲ့သူရဲ့ အမည်၊ Email၊ Firebase UID ကို Transfer History မှာ ပြသမယ်။
- Transfer အချိန်၊ Transfer No., မူလဆိုင်၊ လက်ခံဆိုင်၊ ပစ္စည်း၊ အရေအတွက်၊ Batch/Expiry, အရင်းဈေးနဲ့ Stock အရင်/နောက်ကို မှတ်တမ်းတင်မယ်။
- Submit ခလုတ်ကို ထပ်ခါနှိပ်မိရင် တူညီတဲ့ Request ID ကို အသုံးပြုပြီး Stock နှစ်ခါ မပြောင်းအောင် ကာကွယ်မယ်။
- Owner PIN အတည်ပြုပြီး Transfer ကို ပြန်လည်ပယ်ဖျက်နိုင်မယ်။ ပြန်လှန်ရတဲ့အကြောင်းပြချက် မဖြစ်မနေ ထည့်ရမယ်။
- Reversal လုပ်တဲ့အခါ လွှဲပို့ခဲ့တဲ့ Batch ကိုပဲ ပြန်ယူမယ်။ အဲဒီ Batch အပြည့် မကျန်တော့ရင် Reversal ပိတ်မယ်။
- ပြန်လှန်ပြီးသား Transfer ကို ထပ်မံ ပြန်လှန်လို့မရပါ။

## v2.7.5 ကုန်လွှဲ စမ်းသပ်မှု (Regression Test)

1. JSON Backup ထုတ်ပါ။
2. ဆိုင် (၁) မှ ဆိုင် (၂) သို့ 2 သို့မဟုတ် 3 ခု စမ်းလွှဲပါ။
3. Success ပြီးနောက် ဆိုင် (၁) Stock လျော့ပြီး ဆိုင် (၂) Stock တိုးကြောင်း စစ်ပါ။
4. Transfer History မှာ လွှဲသူအမည်၊ Transfer No., ရက်စွဲ၊ အခြေအနေကို စစ်ပါ။
5. Transfer ပြီးပြီးချင်း၊ Destination မှာ ထပ်မရောင်းသေးဘဲ Owner PIN ဖြင့် Reversal စမ်းပါ။ Source Stock ပြန်တိုးပြီး Destination Stock ပြန်လျော့ကြောင်း စစ်ပါ။
6. Reversed Transfer ကို ထပ်ပြန်လှန်ကြည့်ပါ။ ထပ်ခွင့်မပြုရပါ။
7. နောက်ထပ် စမ်းသပ်မှုအတွက် Destination မှာ အဲဒီ Batch ထဲက 1 ခု ရောင်းပြီး Reversal လုပ်ကြည့်ပါ။ လွှဲပို့ခဲ့တဲ့ Batch အပြည့် မကျန်တော့လို့ ပယ်ဖျက်မှုကို ပိတ်ရပါမယ်။
8. Owner Cloud Sync ကို Manual လုပ်ပြီး အခြား Device မှာ Download လုပ်ကာ History / Status တူမတူ စစ်ပါ။

## v2.8.0 Auto Sync စမ်းသပ်ရန်

1. Owner Device A မှာ Settings → Backup မှ JSON Backup ထုတ်ထားပါ။
2. Device A မှာ Settings → Business Cloud Sync → Upload Initial Snapshot ကို တစ်ကြိမ်လုပ်ပါ။
3. Device B ကို Owner Account ဖြင့် Login ဝင်ပြီး Cloud နှင့် ပေါင်းစည်းရန် ကို တစ်ကြိမ်လုပ်ပါ။
4. Device နှစ်ခုလုံးမှာ Baseline ရှိလာပြီးနောက် Device A မှ Product / Category အမည်တစ်ခု ပြောင်းပါ။ Device B မှာ အလိုအလျောက် ပြောင်းလာခြင်းကို စစ်ပါ။
5. Device B မှာ အခြား Record တစ်ခု ပြောင်းပြီး Device A မှာ ပြန်ပေါ်လာခြင်းကို စစ်ပါ။
6. Internet ပိတ်ထားစဉ် Local POS အလုပ်လုပ်သေးကြောင်း၊ Online ပြန်ဖြစ်ချိန် Sync ပြန်လုပ်ကြောင်း စစ်ပါ။
7. တူညီသော Record ကို Device နှစ်ခုမှ တစ်ပြိုင်နက် မတူညီသောတန်ဖိုးဖြင့် ပြင်၍ Conflict protection ကို စမ်းပါ။

## သတိပြုရန်

- Owner Auto Sync စတင်ရန် Device တစ်ခုချင်းစီမှာ Initial Upload သို့မဟုတ် Download ပြီး Sync Baseline ရှိရပါမယ်။
- Reversal မလုပ်ခင် တခြား Device မှာ Sync မလုပ်ထားတဲ့ အပြောင်းအလဲရှိရင် အရင် Sync လုပ်ပြီး နောက်ဆုံး Stock ကို စစ်ပါ။
- အရင် Version မှာ Stock Before/After Snapshot မပါသော Transfer Record တွေကို Reversal ခွင့်မပေးပါ။ မှားယွင်းသော Stock ပြောင်းလဲမှုကို ကာကွယ်ရန်ဖြစ်သည်။
- npm Registry ချိတ်ဆက်မှုမရပါက `npm install` မပြီးနိုင်ပါ။ Full Build ကို ကိုယ့် Mac ပေါ်မှာ အောင်မြင်ကြောင်း စစ်ပြီးမှ ဆိုင်တွင် အသုံးပြုပါ။


- Cashier Auto Sync နဲ့ Cashier Device Management ကို ဒီ Phase မှာ မထည့်သေးပါ။ Sales တစ်ခုက Product Stock နဲ့ Stock Batch ကိုပါ ပြောင်းလဲတာကြောင့် နောက် Phase မှာ Server-side trusted posting စနစ်လိုအပ်ပါတယ်။
- Conflict ဖြစ်ရင် Auto Sync က overwrite မလုပ်ပါ။ JSON Backup ထုတ်ပြီး Record ကို စစ်ဆေးပါ။
- Firestore IndexedDB Cache သည် Sign Out လုပ်ရုံဖြင့် မရှင်းပါ။ ကိုယ်ပိုင်/ယုံကြည်စိတ်ချရသော Device များတွင်သာ အသုံးပြုပါ။
- အသေးစိတ် setup / limitation / test plan ကို `V2.8.0-REALTIME-CLOUD-SYNC-MY.md` တွင် ဖတ်ပါ။


## v2.8.2 — ဖုန်း App 404 နှင့် Device Data Sync Reliability

1. GitHub မှာ Source update လုပ်ပြီး `Deploy to GitHub Pages` workflow အောင်မြင်ကြောင်း စစ်ပါ။
2. Firebase Console → Firestore Database → Rules မှာ ZIP ထဲက updated `firestore.rules` ကို လက်ရှိ Production Rules နဲ့ နှိုင်းယှဉ်ပြီး မိမိ Project အတွက် သက်ဆိုင်သော Rules ကို Publish လုပ်ပါ။ ဒီအဆင့်ဟာ GitHub Deploy နဲ့ သီးခြားဖြစ်သည်။
3. Laptop မှာ JSON Backup ထုတ်ပြီး Business Cloud Sync → `Upload Initial Snapshot` ကို တစ်ကြိမ်လုပ်ပါ။
4. Phone မှာ JSON Backup ထုတ်ပြီး Owner Account အတူတူဝင်ပါ။ `Cloud နှင့် ပေါင်းစည်းရန်` ကို နှိပ်ပါ။ Cloud-only နဲ့ Phone-only Records ကို ထိန်းသိမ်းပေါင်းစည်းပြီး ID တူ Data မတူလျှင် ရပ်ပေးပါမယ်။
5. Device နှစ်ခုလုံးမှာ v2.8.2 Baseline အသစ်တည်ဆောက်ပြီး Auto Sync Status = Synced ဖြစ်ကြောင်း စစ်ပါ။
6. PWA အဟောင်း Shortcut က 404 ဆက်ပြရင် Shortcut ကို Uninstall လုပ်ပြီး `https://nyilwinhtun.github.io/Store/` Website ကို Browser မှ ပြန်ဖွင့်ကာ Add to Home Screen / Install လုပ်ပါ။

**သတိ:** Browser Site Data, LocalStorage, IndexedDB ကို မရှင်းပါနှင့်။ Rules Publish မလုပ်မီ Production Rules ကို Backup လုပ်ပြီး လက်ရှိ Legacy data paths ကို မပျက်စီးစေရန် စစ်ဆေးပါ။ Rules ထည့်ရန် `FIRESTORE-SHARED-RULES-PATCH-MY.md` နှင့် အသေးစိတ်ကို `V2.8.2-RELIABILITY-FIX-MY.md` တွင် ဖတ်ပါ။


## v2.8.3 — Device အလိုအလျောက် Sync ပြင်ဆင်ချက်

- Owner Account ဖြင့် Device အသစ် Login ဝင်လျှင် Sync Baseline မရှိသေးတာကြောင့် ရပ်မနေတော့ဘဲ Cloud/Local Data ကို Safe Merge လုပ်ပြီး Baseline အလိုအလျောက် တည်ဆောက်မည်။
- Cloud-only Data ကို Device ထဲယူမည်။ Device-only Data ကို Cloud သို့ ထိန်းသိမ်းတင်မည်။ ID တူပြီး Data မတူလျှင် အလိုအလျောက် အစားမထိုးဘဲ Conflict ပြမည်။
- Customer/Supplier Firestore Rules မပြည့်စုံလျှင် Shared Data ကို ခေတ္တကျော်ပြီး Product/Stock/Sales စသည့် Branch Data Sync ကို ဆက်လုပ်မည်။ Customer/Supplier Sync အပြည့်ရရန် `FIRESTORE-SHARED-RULES-PATCH-MY.md` ကို Firebase Console တွင် Publish လုပ်ရန် လိုသည်။
- **Branch သတိပြုရန်:** Device တစ်ခုချင်းစီ၏ Active Branch ကို သီးခြားရွေးထားသည်။ Laptop သည် Branch A၊ Phone သည် Branch B ဖြစ်လျှင် Branch A ၏ Product ကို Phone ၏ Branch B စာရင်းထဲတွင် မပြပါ။ နှိုင်းယှဉ်စမ်းသပ်ရာတွင် Device နှစ်ခုလုံး၌ Branch တူအောင် ရွေးပါ။ Branch မတူဘဲ သီးခြားအသုံးပြုခြင်းသည် Multi-Branch POS ၏ ရည်ရွယ်ထားသောလုပ်ဆောင်ပုံဖြစ်သည်။
- Cashier Auto Sync ကို ဤဗားရှင်းတွင် မဖွင့်သေးပါ။ Owner Account အတွက်သာ Auto Sync ဖြစ်သည်။


## v2.8.5 — Cashier Account Fix

1. Profile → **ဝန်ထမ်းအကောင့် / Branch Permission** သို့ ဝင်ပါ။
2. Account အသစ်အတွက် **Account အသစ်ဖန်တီးရန်** ကိုရွေးပြီး အမည်၊ Email၊ Password နှင့် Branch များ ဖြည့်ပါ။
3. Firebase Authentication ထဲတွင် Email ရှိပြီးသားဆိုလျှင် ထပ်ဖန်တီးမည့်အစား **ရှိပြီးသား Account ချိတ်ရန်** ကိုရွေးပါ။
4. Firebase Console → Authentication → Users မှ အဲဒီ Account ၏ UID အတိအကျကို ကူးပြီး App ထဲထည့်ပါ။ အမည်၊ Email နှင့် Branch များကို ပြည့်စုံစွာ ဖြည့်ပြီး ချိတ်ပါ။
5. Member စာရင်းထဲ Account ပေါ်လာပြီးနောက် Password မသိပါက Password Reset ခလုတ်ဖြင့် Email ပို့နိုင်ပါတယ်။
6. Firestore Rules ထဲတွင် Owner သည် `businesses/{businessId}/members/{uid}` ကို Create လုပ်ခွင့်ရှိကြောင်း စစ်ဆေးပါ။ Rules ပြင်ပြီးပါက Firebase Console မှ Publish လုပ်ပါ။

**အရေးကြီး:** Auth Account ဖန်တီးပြီး Firestore Member Record မသိမ်းနိုင်ခဲ့ပါက Error ထဲမှာ UID ပြပါမယ်။ Account အသစ်ထပ်မဖန်တီးဘဲ “ရှိပြီးသား Account ချိတ်ရန်” မှာ အဲဒီ UID ကို အသုံးပြုပါ။ ဒီ update က Cashier Auto Sync သို့မဟုတ် Server-side POS Sale Posting ကို မထည့်ထားသေးပါ။
