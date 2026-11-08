# Minimart POS — v3.1.1 Cashier KPay & Cash Settlement (Preview 7)

ဒီ Preview မှာ Owner သည် Cashier တစ်ယောက်ချင်းစီထံ Cash / KPay ဖြင့် အမှန်တကယ် ပေးချေပြီးနောက် Settlement မှတ်တမ်းတင်နိုင်သည်။ Cashier သည် မိမိ UID နှင့်ကိုက်ညီသော ငွေလက်ခံ History ကိုသာ ကြည့်နိုင်သည်။

## ပါဝင်သောအချက်များ

- Cashier တစ်ယောက်ချင်းစီကို Owner က Cash / KPay ဖြင့် ငွေရှင်းပေးနိုင်သည်။
- ငွေရှင်းအမျိုးအစား: Expense Reimbursement, Cash Advance, Salary, Other Payment။
- KPay Record အတွက် Cashier လက်ခံသူအမည်၊ Account Number နှင့် Transaction ID လိုအပ်သည်။ Duplicate KPay Transaction ID ကို UI / Store Validation နှင့် Deterministic Settlement ID ဖြင့် ကာကွယ်ထားသည်။
- Owner သည် သက်ဆိုင်ရာ Branch ၏ Active Cashier Member ကို ရွေးနိုင်သည်။
- Cashier သည် မိမိ Settlement History ကိုသာ ကြည့်နိုင်သည်။
- Expense Reimbursement သည် ကိုယ်ပိုင်ငွေဖြင့် တင်ပြထားသော Expense တစ်ခုကို တစ်ကြိမ်သာ အပြည့်ပြန်အမ်းနိုင်ပြီး Settlement နှင့် Expense ကို ချိတ်ဆက်သည်။
- Cash Payment အတွက် Open Cash Shift ရှိပါက Cash Out Movement ဖန်တီးသည်။
- Owner Auto Sync / Cashier own-settlement listener / Backup & Restore ထဲတွင် Settlement Data ပါဝင်သည်။
- CSV Export နှင့် Cashier monthly Cash/KPay summary ပါဝင်သည်。

## KPay အသုံးပြုမှု

ဒီ App မှ KPay ကို တိုက်ရိုက်မလွှဲပါ။ Owner သည် KPay App မှ အရင်လွှဲပြီးမှ Transaction ID ဖြည့်ကာ ငွေရှင်းပြီး မှတ်တမ်းတင်ရသည်။ Cashier ရဲ့ လက်ခံ Account နဲ့ ငွေလွှဲအချက်အလက်တွေကို မှတ်တမ်းအဖြစ် သိမ်းသည်။

## ဒီ Preview တွင် မပါသေးသောအရာများ

- Branch KPay Master Account Setup / Balance Ledger။
- KPay API Direct Transfer။
- Cashier Member Profile မှ KPay Account Auto-fill။
- Receipt Photo Upload။
- Partial Expense Reimbursement။
- Cash Advance Reconciliation / Outstanding Advance။
- Settlement Void / Reversal UI။
- Salary / Cash Advance / Other Payment များကို Profit Analytics Expense Total နှင့် အလိုအလျောက် ချိတ်ဆက်ခြင်း။

## မပြောင်းလဲထားသော မူလအပိုင်းများ

Firebase Authentication / Owner Login / Cashier Login, POS Checkout, Product, Sales, Stock, Stock Transfer, Branch Shipment / Receiving Workflow နှင့် Preview 6 ၏ Owner-Review-only Expense Reporting Mode ကို ဆက်ထိန်းထားသည်။

## Setup

1. Production Data ကို JSON Backup ထုတ်ပါ။
2. ZIP ကို Folder အသစ်တွင် ဖြည်ပါ။ Production Folder ကို overwrite မလုပ်ပါနှင့်။
3. မူလ `.env` ကို လိုအပ်ပါက လုံခြုံစွာ ကူးထည့်ပြီး Firebase Project / Business ID / Owner UID မပြောင်းပါနှင့်။
4. `npm install`
5. `npm run typecheck`
6. `npm run build`
7. Build အောင်မြင်မှ `npm run dev -- --host --port 5173 --strictPort`
8. `CASHIER-KPAY-SETTLEMENT-TEST-PLAN-MY.md` အတိုင်း Owner Mac + Cashier Phone နှစ်လုံးဖြင့် စမ်းသပ်ပါ။

## Test Status

- TypeScript / TSX 38 ဖိုင်ကို syntax-only transpilation ဖြင့် parse လုပ်ရာ Syntax Error မတွေ့ပါ (ambient declaration file တစ်ခုကို transpile output မထုတ်သဖြင့် သီးခြားထားသည်)။
- `node_modules` မရှိသဖြင့် Full Typecheck ကို အတည်မပြုနိုင်ပါ။ `npm install` သည် ဒီပတ်ဝန်းကျင်တွင် timeout ဖြစ်သည်။
- Firestore Rules Emulator Test နှင့် Live Two-Device Test မပြီးသေးပါ။
- Preview အဖြစ်သာ စမ်းသပ်ပါ။ Production Release ဟု မယူဆပါနှင့်။

အသေးစိတ်: `V3.1.1-CASHIER-KPAY-SETTLEMENT-MY.md`  
စမ်းသပ်ရန်: `CASHIER-KPAY-SETTLEMENT-TEST-PLAN-MY.md`
