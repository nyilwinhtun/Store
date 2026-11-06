# v2.7.3 — Stock Quantity & Branch Transfer ပြင်ဆင်ချက်

ဒီ Update ကို v2.7.2 Business Cloud Sync Source ကို အခြေခံပြီး ပြင်ထားသည်။ Firebase Project (`store-mini`), Business ID (`store-mini-main`), Owner Login, LocalStorage key/schema, Cloud Sync structure နှင့် IndexedDB ပုံများကို မပြောင်းထားပါ။

## 1. Quantity စည်းမျဉ်း

- `ခု`, `လုံး`, `ဘူး`, `ထုပ်`, `ကဒ်`, `အိတ်`, `ဆွဲ` စသည့် အရေအတွက်ယူနစ်များကို ပုံမှန်အားဖြင့် **Whole Quantity** အဖြစ် သတ်မှတ်သည်။ 1, 2, 3 စသည်သာ ထည့်နိုင်သည်။
- `kg`, `g`, `လီတာ`, `ml`, `ပိဿာ`, `ကျပ်သား`, `m`, `cm`, `လက်မ` စသည့် အလေးချိန်/ထုထည်/အတိုင်းအတာယူနစ်များကို **Decimal Quantity** အဖြစ် သတ်မှတ်သည်။ ဒသမ ၃ နေရာအထိ လက်ခံသည်။
- Product အသစ်/ပြင်ဆင်ရာတွင် Quantity Mode ကို လက်ဖြင့်လည်း ရွေးနိုင်သည်။
- POS, Stock Receiving, Purchase, Stock Adjustment, Sale Return နှင့် Branch Transfer တို့တွင် Product ၏ Quantity Mode ကို အသုံးပြုသည်။
- အရင်က သိမ်းထားပြီးသား `9.988 ခု` ကဲ့သို့ ဒသမလက်ကျန်ကို အလိုအလျောက် `10` သို့ Round မလုပ်ပါ။ အရင်ဆုံး ဆိုင်တွင် တကယ်ရှိသည့်အရေအတွက်ကို ရေတွက်ပြီး Inventory → Stock ± မှတစ်ဆင့် Correction လုပ်ပါ။ ဥပမာ လက်တွေ့ 10 ခုရှိပါက `+0.012` ပြင်ဆင်ခြင်းဖြင့် 9.988 မှ 10 သို့ ပြောင်းနိုင်သည်။ Stock Correction သည် Activity Log ထဲ မှတ်တမ်းဝင်သည်။
- Dashboard/Inventory တွင် မတူညီသောယူနစ်များ (`ခု + kg + ဘူး`) ကို ပေါင်းထားသည့် အဓိပ္ပာယ်မရှိသော Total အစား လက်ကျန်ရှိသော Product အမျိုးအစားအရေအတွက်ကို ပြသည်။ ကုန်ရောက်/ကုန်လွှဲစာရင်းများတွင်လည်း ယူနစ်တူသည့်ပစ္စည်းများကိုသာ ပေါင်းပြသည်။

## 2. Branch Transfer လုပ်ပုံ

1. Inventory မှ ကုန်ရှိသည့် မူလဆိုင်ကို အရင်စစ်ပါ။
2. ဆိုင်အချင်းချင်း ကုန်လွှဲစာမျက်နှာတွင် `မူလဆိုင်`, `လက်ခံမည့်ဆိုင်`, `ပစ္စည်း` ကို သီးခြားရွေးပါ။ ယခင်လို Default/Main Branch တစ်ခုတည်းကို အတင်းမသတ်မှတ်တော့ပါ။
3. လွှဲမည့်ပမာဏကို Product Quantity Mode နဲ့ စစ်ဆေးသည်။ Expired Batch များကို လွှဲနိုင်သည့်ပမာဏထဲ မထည့်ပါ။ Batch မရှိသေးသော Legacy Stock ကိုသာ Untracked Opening Batch အဖြစ် Transfer အတွင်း ထည့်သွင်းပေးသည်။
4. လက်ခံဆိုင်တွင် အမည်/ယူနစ်တူ Product တစ်ခုသာရှိလျှင် အဲဒီ Product ၏ Stock ကို ပေါင်းသည်။ မရှိသေးလျှင် သီးခြား Product ID အသစ် ဖန်တီးသည်။ လက်ခံဆိုင်၏ Barcode နှင့် လက်လီ/လက်ကားဈေးကို မူလဆိုင်မှ အလိုအလျောက် မကူးပါ။
5. Transfer အောင်မြင်ပြီးသည်နှင့် လက်ခံဆိုင် Inventory ကို ဒီ Device ပေါ်မှာ အလိုအလျောက် ဖွင့်ပေးသည်။
6. Transfer History ကို လက်ရှိရွေးထားသည့် မူလဆိုင်/လက်ခံဆိုင်အလိုက် ကြည့်နိုင်သည်။

### Transfer မလုပ်နိုင်သည့်အခါ

- Stock Batch အားလုံးပေါင်းတန်ဖိုးက Product Stock ထက် ပိုနေပါက Batch Data မကိုက်ညီသည့်အတွက် Transfer ကို ရပ်ပြီး အကြောင်းပြချက်ပြသည်။ Batch မှတ်တမ်းကို အလိုအလျောက် မဖျက်/မပြင်ပါ။
- Source Product အားလုံး/တစ်စိတ်တစ်ပိုင်း Expired ဖြစ်နေပါက သက်တမ်းမကုန်သေးသောပမာဏထက် ပိုမလွှဲနိုင်ပါ။
- Destination Product ၏ Quantity Mode မတူနေပါက အရင် Mode ကို ညှိပြီးမှ လွှဲရမည်။

## 3. Update လုပ်ရန်

1. လက်ရှိ v2.7.2 မှ JSON Backup အရင်ထုတ်ပါ။
2. ZIP အသစ်ကို Folder အသစ်အဖြစ် ဖြည်ပြီး VS Code မှာ ဖွင့်ပါ။
3. Terminal မှာ run ပါ။

```bash
npm install
npm run typecheck
npm run build
npm run dev -- --host --port 5173 --strictPort
```

4. `http://localhost:5173` ကို ဖွင့်ပါ။ Port တစ်ခုတည်းကို ဆက်သုံးပါ။
5. LocalStorage / IndexedDB / Firebase Data ကို မဖျက်ပါနှင့်။

## 4. စမ်းသပ်ရန် Checklist

- [ ] `ခု` Product အသစ်ကို 1.5 ထည့်လျှင် Save မလုပ်နိုင်ရ။
- [ ] `kg` Product အသစ်ကို 1.5 ထည့်လျှင် Save လုပ်နိုင်ရ။
- [ ] Integer Stock ကို `10` အဖြစ် ဒသမမပါဘဲ ပြရ။
- [ ] ရှိပြီးသား fractional whole-unit Stock ကို Warning ပြပြီး အလိုအလျောက် Round မလုပ်ရ။
- [ ] Stock ± Correction ဖြင့် လက်တွေ့ရေတွက်ချက်နှင့် တူအောင် ပြင်နိုင်ရ။
- [ ] Branch 1 မှ Branch 2 သို့ ကုန်လွှဲပြီးနောက် App က Branch 2 Inventory ကို တန်းဖွင့်ပေးရ။
- [ ] Branch 2 Product list တွင် လွှဲထားသော Product နှင့် Stock ပေါ်ရ။
- [ ] Source Branch Stock လျော့ပြီး Destination Branch Stock တိုးရ။
- [ ] Transfer History ကို Branch နှစ်ဖက်စလုံးတွင် မြင်ရ။
- [ ] Cloud Sync Manual Upload/Download ကို မပြောင်းဘဲ ဆက်အလုပ်လုပ်ရ။

## 5. ကန့်သတ်ချက်

- Real-time Auto Sync / Cashier Background Sync သည် ဒီ Update ၏ scope မဟုတ်ပါ။ Cloud Sync သည် v2.7.2 ကဲ့သို့ Manual Owner Sync အတိုင်း ဆက်လက်လုပ်ဆောင်သည်။
- Full TypeScript Build ကို ဒီ build environment မှာ Dependencies မရရှိသဖြင့် မအတည်ပြုနိုင်ခဲ့ပါ။ Source syntax နဲ့ Quantity Helper စမ်းသပ်မှုများကို စစ်ဆေးထားသည်။ User ၏ Mac မှာ `npm run typecheck` နှင့် `npm run build` ကို အရင်အတည်ပြုပါ။
