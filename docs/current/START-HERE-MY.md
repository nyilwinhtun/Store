# စတင်အသုံးပြုရန် — Minimart POS v3.1.4 Preview 10

## ဒီ Update မှာ ဘာအသစ်ပါလဲ

`Reports & Analytics` စာမျက်နှာကို အဆင့်မြှင့်ထားပါတယ်။ Owner က ရက်စွဲအလိုက်၊ Branch အလိုက် Sales, Gross Profit, Expense, Estimated Net Profit, Payment Collection, Top Products, Category, Branch Performance, Cashier Performance နှင့် Settlement Summary ကြည့်နိုင်ပါတယ်။ Report CSV ကိုလည်း Export လုပ်နိုင်ပါတယ်။

## Mac မှာ စမ်းသပ်ရန်

1. မူလ Project ကို Backup ထုတ်ပါ။
2. ဒီ ZIP ကို Folder အသစ်တစ်ခုထဲ Extract လုပ်ပါ။
3. Terminal မှာ Project Folder ထဲဝင်ပါ။
4. အောက်ပါ Command များကို အစဉ်လိုက်လုပ်ပါ။

```bash
npm install
npm run typecheck
npm run build
npm run dev -- --host --port 5173
```

5. Owner Account နဲ့ Login ဝင်ပါ။
6. `စာရင်းခွဲခြမ်းစိတ်ဖြာ` ကို ဖွင့်ပါ။
7. Date Filter / Branch Filter ရွေးပြီး Report ကို စစ်ပါ။
8. `Report CSV` ဖြင့် Export လုပ်ပါ။

## စမ်းသပ်ရမည့် အရေးကြီးချက်များ

- Gross Profit သည် Completed Sales မှာ သိမ်းထားသော Profit ကိုသာ စုစည်းသည်။
- Estimated Net Profit သည် Gross Profit − Reported Expenses ဖြစ်ပြီး အပြည့်အစုံ စာရင်းကိုင် Net Profit မဟုတ်ပါ။
- KPay/Cash Sale Type Chart သည် Voucher အမျိုးအစားကို ပြပြီး လက်ရှိ Wallet Balance မဟုတ်ပါ။
- Cashier Settlement ကို Expense ထဲ ထပ်မနုတ်ပါ။
- Cashier သည် လက်ရှိ Permission အတိုင်း Analytics ကို ဝင်ခွင့်မရှိပါ။

စမ်းသပ်မှု အသေးစိတ်ကို `REPORTS-ANALYTICS-TEST-PLAN-MY.md` တွင် ကြည့်ပါ။

## သတိပြုရန်

ဤ Preview ကို Production အစားထိုးရန် မဟုတ်သေးပါ။ မူလ Project / Firebase Production Data ကို မပြောင်းဘဲ Folder အသစ်တွင် စမ်းသပ်ပါ။ ဒီပတ်ဝန်းကျင်တွင် Dependency Installation Timeout ဖြစ်သဖြင့် Full Build နှင့် Firebase Live Device Test ကို မအတည်ပြုနိုင်သေးပါ။
