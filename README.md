# Minimart POS — v3.2.0 Preview 5

ဒီ Project သည် Minimart POS v3.2.0 အတွက် သီးခြား Preview Working Copy ဖြစ်သည်။ Production Release အဖြစ် မသတ်မှတ်ရသေးပါ။

## စတင်အသုံးပြုရန်

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

## Project Structure

- `src/features/auth/` — Website ဖွင့်ချိန် ပထမဆုံးပြသမည့် Standalone Login Screen
- `src/components/` — POS နှင့် Management UI Components
- `src/lib/` — Firebase, Sync, Business Access နှင့် shared services
- `src/store/` — Zustand POS Store
- `src/types/` — TypeScript data types
- `public/` — PWA manifest, icons နှင့် service worker
- `docs/current/` — လက်ရှိ v3.2.0 ဆိုင်ရာလမ်းညွှန်
- `docs/testing/` — စမ်းသပ်ရန် Checklist များ
- `docs/releases/` — ယခင် Release Notes
- `docs/archive/` — Version အဟောင်းများ၏ မှတ်တမ်း
- `docs/reference/` — Firebase, Stock, Cloud Sync နှင့် အခြား Technical Reference များ

## Login Behavior

- Firebase Auth ဖွင့်ထားပြီး User မဝင်ထားလျှင် Website Root (`/`) တွင် Login Screen ကို ပြမည်။
- Login အောင်မြင်လျှင် Firebase Business Access စစ်ဆေးပြီး Owner သို့မဟုတ် Cashier Workspace ကို အလိုအလျောက် ဖွင့်မည်။
- Sign Out လုပ်လျှင် Login Screen သို့ ပြန်ရောက်မည်။
- Login Form ကို Sidebar / Main Menu ထဲတွင် မထားပါ။
- Login Page မှ Owner Account အသစ်ဖန်တီးခြင်း / Sign Up ကို လုံးဝဖယ်ရှားထားသည်။ ရှိပြီးသား Owner/Cashier Account များသာ Login ဝင်နိုင်သည်။
- Owner Account ကို လိုအပ်ပါက ခွင့်ပြုထားသော Admin/Firebase Console provisioning နည်းလမ်းဖြင့်သာ စီမံရမည်။
- Owner သည် Team Access ထဲမှ Cashier Account ကိုသာ ဖန်တီးနိုင်ပြီး Login Page မှ Owner Sign Up မရှိပါ။
- Firebase Authentication API, Firebase Config နှင့် Business Access Resolution Logic များကို မူရင်းအတိုင်း ထိန်းသိမ်းထားရန် ရည်ရွယ်ထားသည်။

## Release Safety

ဒီ Preview ကို Production သို့ မတင်မီ Full TypeScript Build, Vite Build, Firebase Emulator Rules Test, Owner/Cashier Login Regression, Offline/Sync နှင့် Branch Workflow စမ်းသပ်မှုများ ပြီးစီးရမည်။

အသေးစိတ် Documentation Index ကို `docs/README.md` တွင် ကြည့်ပါ။
