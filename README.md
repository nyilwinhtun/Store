# Minimart POS v2.8.0 — Owner Real-time Cloud Sync + Stock Transfer Management

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
- Existing Business Cloud Sync structure (manual upload/download)
- Existing Product, Sales, Stock, Branch, Customer and Supplier records

## Setup

```bash
npm install
npm run typecheck
npm run build
npm run dev -- --host --port 5173 --strictPort
```

## Important limitations
- v2.7.5 was manual-sync only. v2.8.0 adds Owner-device real-time sync after a device has completed the initial Upload or Download baseline.
- Reversal is local-first. Do not reverse the same transfer on another device before synchronizing. Sync the latest state first to avoid conflicting local copies.
- Reversal is intentionally refused when the exact transferred batch quantity is no longer available at the destination.
- Firestore Security Rules are not automatically changed by this update. Review and publish rules safely before production use.


## v2.8.0 — Owner Real-time Cloud Sync

- Owner devices with an existing Sync Baseline start listening for remote changes automatically.
- Local changes are reconciled with Cloud changes; simultaneous edits to the same record stop automatic sync instead of overwriting either side.
- Existing local POS storage and manual Upload / Download / Sync Changes actions are preserved.
- Cashier auto sync and trusted server-side stock posting are not included yet.

See `V2.8.0-REALTIME-CLOUD-SYNC-MY.md` for setup, limitations, and test steps.
