# Minimart POS — v2.8.3

## v2.8.3 Auto Device Sync Repair
- Owner device with no local sync baseline now performs an automatic, non-destructive Cloud/Local merge after Owner access is verified.
- Cloud-only records are pulled; unique local records are uploaded; same-ID conflicting data stops for review instead of overwriting either side.
- Customer/Supplier permission-denied rules no longer block Product, Stock, Sales, and other branch-record synchronization. Customer/Supplier sync remains paused until the nested Firestore rules are published.
- Active branch selection remains device-local by design. Product, stock, sales, purchases, and expenses are branch-scoped; select the same branch on both devices to compare the same branch records.
- Firebase Authentication, project configuration, and existing POS business logic are retained.

# Previous Version Notes — v2.8.2 PWA Recovery

v2.7.4 တွင် အလုပ်လုပ်နေသော Source → Destination Stock Transfer ကို မပြောင်းဘဲ Transfer Management, audit trail, duplicate-submit protection နှင့် owner-authorized reversal တို့ကို ထပ်ဖြည့်ထားသည်။

## v2.7.5 — Stock Transfer Management
- Transfer တစ်ခုချင်းစီအတွက် Request ID ထည့်ပြီး ထပ်ခါ submit ဖြစ်ပါက အရင် Transfer Result ကိုပဲ ပြန်အသုံးပြုသည်။ တူညီသော Request ID ဖြင့် Stock ကို နှစ်ခါမပြောင်းပါ။
- Transfer လုပ်သူ၏ Firebase UID, Email, Display Name ကို Transfer Record တွင် သိမ်းသည်။ Local / Firebase မဝင်ထားသည့် အသုံးပြုမှုတွင် Local User အဖြစ် မှတ်တမ်းတင်သည်။
- Source / Destination Branch အမည် snapshot, transfer timestamp, Transfer No., quantity, batch allocations, expiry date, unit cost နှင့် before/after stock ကို ထိန်းသိမ်းသည်။
- Owner PIN ဖြင့် Transfer ကို Reversal လုပ်နိုင်သည်။ Reversal reason ကို မဖြစ်မနေ ဖြည့်ရမည်။
- Reversal သည် မူလ Transfer က ပေးပို့ခဲ့သည့် Destination Batch များကိုသာ နုတ်ပြီး မူလ Source Batch များထဲသို့ ပြန်ထည့်သည်။
- လွှဲပေးထားသော Batch အပြည့် မကျန်တော့ပါက (ရောင်းပြီး၊ Stock Adjust လုပ်ပြီး၊ ထပ်လွှဲပြီး စသည်) Reversal ကို ပိတ်ထားသည်။ အခြား Batch များမှ အစားထိုးနုတ်ခြင်း မလုပ်ပါ။
- Reversal ပြီးသည့် Transfer ကို ထပ်မံ Reversal မလုပ်နိုင်ပါ။
- အရင် Version Transfer Record တွင် before/after balance snapshot မပြည့်စုံပါက မှားယွင်းသော Stock ပြန်လှန်မှုကို ကာကွယ်ရန် Reversal Button မပေါ်ပါ။
- Source နဲ့ Destination နှစ်ဆိုင်လုံးအတွက် Reversal Activity Log ထည့်သည်။

## Preserved
- Firebase Project: `store-mini`
- Business ID: `store-mini-main`
- Existing Owner Login / Firebase Authentication
- Existing LocalStorage key and schema version
- IndexedDB local image storage (Logo / Banner / Owner Profile)
- Existing Business Cloud Sync record structure and local POS data model
- Existing Product, Sales, Stock, Branch, Customer and Supplier records

## Setup

```bash
npm install
npm run typecheck
npm run build
npm run dev -- --host --port 5173 --strictPort
```

## Important limitations
- v2.8.3 automatically bootstraps a new Owner device with a safe Cloud/Local merge. Existing Owner devices use real-time sync after their per-device baseline exists.
- Reversal is local-first. Do not reverse the same transfer on another device before synchronizing. Sync the latest state first to avoid conflicting local copies.
- Reversal is intentionally refused when the exact transferred batch quantity is no longer available at the destination.
- Firestore Security Rules are not automatically changed by this update. Review and publish rules safely before production use.


## v2.8.0 — Owner Real-time Cloud Sync

- Owner devices with an existing Sync Baseline start listening for remote changes automatically.
- Local changes are reconciled with Cloud changes; simultaneous edits to the same record stop automatic sync instead of overwriting either side.
- Existing local POS storage and manual Upload / Download / Sync Changes actions are preserved.
- Cashier auto sync and trusted server-side stock posting are not included yet.

See `V2.8.0-REALTIME-CLOUD-SYNC-MY.md` for setup, limitations, and test steps.

## v2.8.1 — PWA Launch Fix

- GitHub Pages project path အတွက် relative PWA path များကို သတ်မှတ်ထားသည်။
- Service Worker navigation fallback ပါဝင်သည်။

## v2.8.2 — PWA + Cloud Sync Reliability Fix (superseded by v2.8.3)

- PWA `start_url` ကို `./index.html` သတ်မှတ်ပြီး Service Worker ကို registration scope အောက်ရှိ URL များကိုသာ cache လုပ်စေသည်။
- Cache cleanup သည် Minimart အမည်တပ်ထားသော cache များကိုသာ ဖျက်သည်။ GitHub Pages origin တူညီသည့် အခြား project များ၏ cache ကို မထိပါ။
- Firestore Rules တွင် App သုံးနေသည့် `shared/{kind}/records/{id}` path ကို ခွင့်ပြုသည်။ ဒီ Rules ကို Firebase Console မှာ သီးခြား Publish လုပ်ရန် လိုသည်။
- First-time Cloud merge သည် Device တစ်ဖက်တည်းရှိ Records ကို မဖျက်ဘဲ ပေါင်းစည်းသည်။ ID တူ Data မတူသော Record ရှိလျှင် အစားမထိုးဘဲ Conflict ပြသည်။
- Initial Snapshot Upload ပြီးချိန် Cloud-only Records ကိုလည်း Device ထဲ ပြန်သွင်းကာ baseline နဲ့ Local Data တူညီစေသည်။
- v2.8.1 Sync Baseline ဟောင်းကို ဆက်မသုံးဘဲ Device တစ်လုံးချင်းစီမှာ v2.8.2 Baseline အသစ်တည်ဆောက်ပြီးမှ Auto Sync စတင်သည်။
- Offline ဖြစ်ပြီး Firebase Server ကို မရနိုင်ချိန်တွင် ဒီ Device မှာ ယခင်က cache လုပ်ထားသော Owner / Member document ရှိမှ POS access ကို ယာယီဖွင့်သည်။
- Firebase Project `store-mini`, Business ID `store-mini-main`, Auth flow, POS LocalStorage key/schema, Stock Transfer business logic ကို မပြောင်းထားပါ။
- Firestore nested rule ကို Console မှာ ထည့်/Publish လုပ်ရန် `FIRESTORE-SHARED-RULES-PATCH-MY.md` ကို ဖတ်ပါ။
- အသေးစိတ် `V2.8.2-RELIABILITY-FIX-MY.md` ကို ဖတ်ပါ။
