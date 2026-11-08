# စတင်ရန် — Minimart POS v3.1.1 Cashier KPay & Cash Settlement (Preview 7)

ဒီ Preview မှာ Owner က Cashier တစ်ယောက်ချင်းစီကို Cash သို့မဟုတ် KPay နဲ့ အမှန်တကယ် ပေးချေပြီး မှတ်တမ်းတင်နိုင်သည်။ Cashier သည် မိမိရရှိငွေ History ကိုသာ ကြည့်နိုင်သည်။

## အသုံးပြုပုံ

### Owner

1. Owner Firebase Account ဖြင့် Login ဝင်ပါ။ Active Branch ကို စစ်ပါ။
2. `Cashier ငွေရှင်း` Menu ကို ဖွင့်ပါ။
3. လက်ရှိ Branch အတွက် Active Cashier ကို ရွေးပါ။
4. Expense Reimbursement / Cash Advance / Salary / Other ထဲမှ ရွေးပါ။
5. Cash သို့မဟုတ် KPay ကို ရွေးပါ။
6. KPay ဖြစ်လျှင် Cashier လက်ခံသူအမည်၊ Account Number နှင့် Transaction ID ကို ဖြည့်ပါ။
7. KPay App သို့မဟုတ် Cash ဖြင့် ငွေကို အမှန်တကယ် ပေးချေပြီးမှ Confirmation ကို အတည်ပြုပါ။ App မှ KPay ကို တိုက်ရိုက် မလွှဲပါ။

### Cashier

1. Firebase မှ မိမိ Cashier Account ဖြင့် Login ဝင်ပါ။
2. `မိမိငွေလက်ခံမှတ်တမ်း` Menu ကို ဖွင့်ပါ။
3. Owner မှတ်တမ်းတင်ပြီး Cloud Sync ဖြစ်သော Cash / KPay ငွေလက်ခံမှုများကို ကြည့်ပါ။
4. အခြား Cashier များ၏ ငွေစာရင်းကို မမြင်နိုင်ပါ။

## Expense Reimbursement သတိပြုရန်

- Cashier ကိုယ်ပိုင်ငွေ `cashier-personal` ဖြင့် တင်ပြထားသော Expense ကိုသာ ပြန်အမ်းနိုင်သည်။
- ဒီ Preview တွင် Expense တစ်ခုလုံးကိုသာ ပြန်အမ်းနိုင်ပြီး တစ်ကြိမ်သာ ချိတ်ဆက်နိုင်သည်။
- Expense ကို Analytics တွင် တစ်ကြိမ်သာတွက်သည်။ Reimbursement ကို Expense ထပ်မတွက်ဘဲ Settlement အဖြစ် သီးခြားသိမ်းသည်။

## မပါသေးသောအရာများ

KPay API Direct Transfer, Branch KPay Master Account / Balance Ledger, KPay Slip Photo Upload, Partial Reimbursement, Cash Advance Reconciliation နှင့် Settlement Void/Reversal UI မပါသေးပါ။

## Local Setup

1. လက်ရှိ Production Data ကို JSON Backup ထုတ်ပါ။
2. ZIP ကို Folder အသစ်တွင် ဖြည်ပါ။ Production Folder ကို Overwrite မလုပ်ပါနှင့်။
3. လိုအပ်ပါက `.env` ကို မူရင်း Project မှ လုံခြုံစွာ ကူးထည့်ပါ။ Firebase Project / Business ID / Owner UID / API Config မပြောင်းပါနှင့်။
4. Terminal မှာ `npm install` လုပ်ပါ။
5. `npm run typecheck` နှင့် `npm run build` လုပ်ပါ။
6. Build အောင်မြင်ပါက `npm run dev -- --host --port 5173 --strictPort` ဖြင့် စမ်းသပ်ပါ။
7. `CASHIER-KPAY-SETTLEMENT-TEST-PLAN-MY.md` အတိုင်း Owner Mac နှင့် Cashier Phone နှစ်လုံးဖြင့် စမ်းသပ်ပါ။

## Firestore Rules

ဒီ ZIP ထဲရှိ `firestore.rules` တွင် `cashierSettlements` အတွက် Owner ရဲ့ Branch collection access နဲ့ Cashier ကို မိမိ UID အတွက် Read-only Query ခွင့်ပြုထားသည်။ Production Rules ကို Publish မလုပ်မီ Backup လုပ်ပြီး Owner UID / Business ID / မူလ POS / Stock / Shipment Rules များကို မပြောင်းဘဲ Settlement-specific Rules ကိုသာ စစ်ဆေးပေါင်းထည့်ပါ။ Firestore Rules Emulator Test မပြီးမချင်း Production တွင် မတင်ပါနှင့်။

## စစ်ဆေးမှုအခြေအနေ

- TypeScript / TSX ဖိုင် 38 ခုကို Syntax-only transpile လုပ်ရာ Syntax Error မတွေ့ပါ (Declaration File တစ်ခုကို transpile output မထုတ်သဖြင့် သီးခြားထားသည်)။
- ဒီ runtime တွင် `node_modules` မရှိသဖြင့် Full `tsc --noEmit` သည် dependency မတွေ့သော Error များဖြင့် မအောင်မြင်ပါ။ `npm install --ignore-scripts --no-audit --no-fund --prefer-offline` သည်လည်း timeout ဖြစ်သည်။
- Firestore Rules Emulator / Firebase Live Sync / Owner-Cashier Two-Device Test မပြီးသေးပါ။
- ဒီ ZIP သည် Preview ဖြစ်ပြီး Production Release ဟု မယူဆပါနှင့်။
