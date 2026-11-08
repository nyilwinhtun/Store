# Preview 6 — Mac QA Checklist

## A. Project Install / Build

1. ZIP ကို Extract လုပ်ပါ။
2. VS Code တွင် Project Root ကိုဖွင့်ပါ။
3. Terminal တွင် အောက်ပါ Command များကို အစဉ်လိုက် run ပါ။

```bash
npm install
npm run release:check
npm run typecheck
npm run build
npm run dev
```

`npm install` ပြီးလျှင် `package-lock.json` အသစ်ဖြစ်လာမည်။ အဲဒီဖိုင်ကို Project ထဲတွင် ထည့်ထားပြီး Git ထဲ Commit လုပ်ပါ။ `npm ci` ကို lockfile ရှိပြီးမှ သုံးပါ။

## B. Login / Permission

- [ ] Incognito Window ဖြင့် Website ဖွင့်လျှင် Login Page ပထမဆုံးပေါ်သည်။
- [ ] Login Page တွင် Owner Sign Up / Register မရှိပါ။
- [ ] မှန်ကန်သော Owner Account ဝင်လျှင် Owner Workspace ပေါ်သည်။
- [ ] မှန်ကန်သော Cashier Account ဝင်လျှင် မိမိ Branch POS သာပေါ်သည်။
- [ ] မသတ်မှတ်ရသေးသော Firebase Account ဝင်လျှင် Workspace မဝင်နိုင်ဘဲ Access Gate ပေါ်သည်။
- [ ] Password Reset Email ပို့နိုင်သည်။
- [ ] Logout လုပ်လျှင် Login Page ပြန်ပေါ်သည်။
- [ ] Owner ဝင်ပြီး Logout လုပ်ကာ Cashier ဝင်လျှင် Owner Data မမြင်ရပါ။

## C. PWA / Mobile

- [ ] Desktop Chrome မှာ Layout မပျက်ပါ။
- [ ] Mobile Chrome / Safari မှာ Login Card အပြည့်မြင်ရသည်။
- [ ] Keyboard ဖွင့်သည့်အခါ Password နဲ့ Login Button ကို အသုံးပြုနိုင်သည်။
- [ ] Install လုပ်ထားသည့် PWA မှာ Preview 6 Cache အသစ်ကို ရယူသည်။
- [ ] Update ပြီးနောက် Service Worker ယခင် Cache ကို အစားထိုးသည်။

## D. Data Isolation — အရေးကြီး

Owner နဲ့ Cashier ကို Browser Profile တစ်ခုတည်းမှာ အလှည့်ကျသုံးခြင်းကို လက်တွေ့စမ်းပါ။ Login/Logout ပြီးနောက် IndexedDB cache နဲ့ localStorage ထဲက data scope မရောကြောင်း သက်သေပြနိုင်မှသာ Shared Device အဖြစ် ခွင့်ပြုပါ။ စစ်ဆေးမှုမပြီးမချင်း သီးခြား Chrome Profile သို့မဟုတ် သီးခြား Device သုံးပါ။

## E. Production မတင်ခင်

- [ ] Full build အောင်မြင်သည်။
- [ ] Firebase Emulator Rules Test အောင်မြင်သည်။
- [ ] Owner/Cashier Login Regression အောင်မြင်သည်။
- [ ] Branch 1 / Branch 2 Access Isolation အောင်မြင်သည်။
- [ ] Offline Sale + Cloud Sync + duplicate protection အောင်မြင်သည်။
- [ ] Stock / Barcode / Transfer / Finance reconciliation အောင်မြင်သည်။
- [ ] Backup နှင့် Rollback Plan စစ်ဆေးပြီးဖြစ်သည်။
