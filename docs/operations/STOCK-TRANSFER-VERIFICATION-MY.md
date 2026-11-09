# Minimart POS v2.7.5 — Branch Stock Transfer Verification Fix

ဒီ Update သည် v2.7.3 Stock Precision / Branch Transfer Source ကို အခြေခံထားသည်။ Firebase Project (`store-mini`), Business ID (`store-mini-main`), Owner Login, LocalStorage key/schema, IndexedDB local images နှင့် လက်ရှိ Cloud Sync collection structure ကို မပြောင်းထားပါ။

## v2.7.5 တွင် ပြင်ဆင်ထားသည်

1. Transfer မလုပ်မီ Source Product, Destination Product, Unit Mode နှင့် Stock Batch များကို working-copy ပေါ်တွင် စစ်ဆေးသည်။ စစ်ဆေးမှုမပြီးမချင်း Zustand Store ကို မပြောင်းပါ။
2. Batch များမှ အမှန်တကယ် လွှဲပေးနိုင်သော ပမာဏကို ခွဲဝေသတ်မှတ်ပြီး allocation စုစုပေါင်းသည် လွှဲမည့် Quantity နှင့် ကိုက်ညီရမည်။
3. Source Product Stock ကို `အရင် Stock - လွှဲပမာဏ`၊ Destination Product Stock ကို `အရင် Stock + လွှဲပမာဏ` အဖြစ် တွက်ချက်သည်။
4. Source Batch လက်ကျန်၊ Destination Batch တိုးလာမှုနှင့် Product Stock နှစ်ဖက်လုံးကို commit မလုပ်မီ အတည်ပြုသည်။
5. Commit မတိုင်မီ Store Data ပြောင်းသွားပါက Transfer ကို abort လုပ်ပြီး မူလ State ကို ထိန်းထားသည်။
6. Source Stock, Destination Stock, Batch နှင့် Transfer History ကို Zustand State Commit တစ်ခုတည်းအဖြစ် သိမ်းသည်။
7. Success ပြရန် Transfer record ရှိရုံနှင့် မလုံလောက်တော့ပါ။ Source Stock လျော့တန်ဖိုးနှင့် Destination Stock တိုးတန်ဖိုး အမှန်တကယ် ကိုက်ညီကြောင်း ပြန်စစ်သည်။
8. Success panel နှင့် Notification တွင် ဆိုင်နှစ်ဆိုင်၏ Stock `အရင် → ပြီးနောက်` ကို ပြသသည်။
9. Transfer line ထဲတွင် `sourceStockBefore/After` နှင့် `destinationStockBefore/After` ကို audit အတွက် ထည့်သိမ်းသည်။ အရင် Transfer Record များကို ဖတ်နိုင်ရန် fields အသစ်များကို optional အဖြစ်ထားသည်။

## လက်တွေ့စမ်းသပ်ရန်

1. JSON Backup အရင်ထုတ်ပါ။
2. ဆိုင် (၁) ရဲ့ Product တစ်ခုကို ရွေးပြီး လက်ရှိစုစုပေါင်း Stock ကို မှတ်ထားပါ။
3. ဆိုင် (၂) မှာ အဲဒီ Product ရှိပြီးသားဆိုရင် လက်ရှိ Stock ကို မှတ်ထားပါ။ မရှိသေးရင် လက်ခံဆိုင် Product အသစ်ဖန်တီးမည်။
4. စမ်းသပ်ရန် 2 သို့မဟုတ် 3 ခုသာ လွှဲပါ။
5. Success Message ထဲမှာ Source Stock လျော့သွားသောတန်ဖိုးနှင့် Destination Stock တိုးလာသောတန်ဖိုးကို ကြည့်ပါ။
6. Inventory မှာ ဆိုင် (၁) နှင့် ဆိုင် (၂) ကို တစ်ဆိုင်ချင်းပြောင်းပြီး Product ၏ `ရောင်းနိုင် / စုစုပေါင်း` ကို ပြန်စစ်ပါ။
7. Source မလျော့၊ Destination မတိုးပါက နောက်ထပ် မလွှဲပါနှင့်။ Error message နှင့် Console screenshot ကို သိမ်းထားပါ။

## ဥပမာ

- Source ဆိုင် အရင် Stock: 20 ခု
- လွှဲပမာဏ: 3 ခု
- Destination ဆိုင် အရင် Stock: 4 ခု
- မျှော်လင့်ထားသောရလဒ်: Source `20 → 17`, Destination `4 → 7`

ပစ္စည်း၏ Expiry ကြောင့် ရောင်းနိုင်သော Stock သည် စုစုပေါင်း Stock ထက်နည်းနိုင်သည်။ Inventory မှာ `ရောင်းနိုင် / စုစုပေါင်း` နှစ်ခုလုံးကို ကြည့်ပါ။

## အရေးကြီးသော ကန့်သတ်ချက်

- v2.7.3 နှင့် အရင် Version များတွင် Success ဟု ပြထားသော်လည်း Stock မပြောင်းခဲ့သော Transfer History များကို v2.7.5 က အလိုအလျောက် ပြန်လည်ပြင်ဆင်ခြင်း မလုပ်ပါ။ အဲဒီမှတ်တမ်းများကို Source/Destination Stock နှင့် တိုက်စစ်ပြီးမှ Stock Adjustment လုပ်ပါ။
- လက်ရှိပစ္စည်းစာရင်းများကို အလိုအလျောက် Round, Reset သို့မဟုတ် Delete မလုပ်ပါ။
- Cloud Sync သည် v2.7.x ကဲ့သို့ Owner Manual Sync အတိုင်း ဆက်လက်လုပ်ဆောင်သည်။ Real-time Auto Sync / Cashier background sync မပါသေးပါ။
- Firestore Security Rules ကို ဒီ Update က အစားမထိုးပါ။ Production အသုံးမပြုမီ Owner/Cashier အလိုက် လုံခြုံရေး Rules ကို သီးခြားစစ်ဆေးရန် လိုအပ်သည်။

## Mac မှာ စမ်းသပ်ရန်

```bash
npm install
npm run typecheck
npm run build
npm run dev -- --host --port 5173 --strictPort
```

ဒီ Source Package တွင် `node_modules` မပါဝင်ပါ။ Full TypeScript Build ကို အသုံးပြုမည့် Mac ပေါ်မှာ အတည်ပြုပါ။
