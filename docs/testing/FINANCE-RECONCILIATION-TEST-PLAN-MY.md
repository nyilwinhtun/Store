# v3.1.3 — Finance Audit & Cash Reconciliation Test Plan

## A. Branch Daily Reconciliation

- [ ] Owner က Branch A ကိုရွေးလျှင် Branch A Ledger သာ တွက်ပြရန်။
- [ ] Branch B ကိုရွေးလျှင် Branch A ရဲ့ Cash/KPay Records မပါရန်။
- [ ] Ledger Start Date မတိုင်မီ ရက်ကို မရွေးနိုင်ရန်။
- [ ] အနာဂတ်ရက်ကို မရွေးနိုင်ရန်။
- [ ] Cash Expected = Opening Cash + Cash In − Cash Out ဖြစ်ရန်။
- [ ] KPay Expected = Opening KPay + KPay In − KPay Out ဖြစ်ရန်။
- [ ] Local timezone ရဲ့ ည 12 နာရီအနီး Transaction များကို မှန်ကန်သော Business Date တွင် တွက်ရန်။
- [ ] Actual Cash / KPay ဖြည့်လျှင် Variance = Actual − Expected ဖြစ်ရန်။
- [ ] Variance မရှိပါက Note မဖြည့်လည်း သိမ်းနိုင်ရန်။
- [ ] Variance ရှိပါက Note မဖြည့်ဘဲ သိမ်းမရရန်။
- [ ] KPay Account မရှိသော Branch တွင် KPay Actual မလိုအပ်ဘဲ Cash Snapshot သာ သိမ်းနိုင်ရန်။
- [ ] Snapshot သိမ်းခြင်းကြောင့် Ledger Balance မပြောင်းရန်။

## B. Reconciliation Audit & Permission

- [ ] Owner က Snapshot Create လုပ်နိုင်ရန်။
- [ ] Owner က Snapshot List ကို ဖတ်နိုင်ရန်။
- [ ] Cashier က `branchFinanceReconciliations` ကို ဖတ်မရရန်။
- [ ] Owner ကလည်း ရှိပြီးသား Snapshot ကို Update မလုပ်နိုင်ရန်။
- [ ] Owner ကလည်း ရှိပြီးသား Snapshot ကို Delete မလုပ်နိုင်ရန်။
- [ ] တူညီသောနေ့တွင် ဒုတိယ Snapshot ထပ်သိမ်းလျှင် ပထမ Record မပြောင်းဘဲ အသစ်တိုးရန်။
- [ ] Audit CSV တွင် Date, Channel, Expected, Actual, Variance, In, Out, Created By, Created At ပါရန်။

## C. Cash Shift Audit

- [ ] Shift ဖွင့်သော Owner/Cashier UID နှင့် အမည်ကို သိမ်းရန်။
- [ ] Shift ပိတ်သော Owner/Cashier UID နှင့် အမည်ကို သိမ်းရန်။
- [ ] Shift History ဇယားတွင် Opened By / Closed By Column နှစ်ခု မှန်ကန်ရန်။
- [ ] Shift Closing Expected Cash ကို Actual Counted Cash နှင့် နှိုင်းယှဉ်ရန်။
- [ ] Variance = Counted Cash − Expected Cash ဖြစ်ရန်။
- [ ] Shift CSV တွင် Opened By / Closed By / Variance ပါရန်။
- [ ] Manual Cash In/Out တွင် Actor Name/UID ပေါ်ရန်။
- [ ] Owner က Manual Cash Out ထည့်လျှင် Open Shift Expected Cash လျော့ရန်။
- [ ] KPay Sale ကို Physical Cash Shift ထဲ မပေါင်းရန်။

## D. Cash Advance Double-count Protection

Scenario: Cash Advance 100,000 (Cash) ပေး၊ Advance ထဲမှ Branch Expense 60,000 သုံး၊ ကျန် 40,000 ကို Cash ပြန်အပ်။

- [ ] Cash Advance Payout ကို Shift Cash Out 100,000 တစ်ကြိမ်သာ ထည့်ရန်။
- [ ] Expense 60,000 ကို Advance နဲ့ Reconcile လုပ်ပြီးနောက် Branch Cash Expense အဖြစ် ထပ်မနုတ်ရန်။
- [ ] Cash 40,000 ပြန်အပ်ပြီး Open Shift ရှိလျှင် Shift Cash In 40,000 တစ်ကြိမ် ထည့်ရန်။
- [ ] Branch Ledger တွင် Advance Out 100,000 နှင့် Return In 40,000 သာ ထည့်တွက်ရန်။
- [ ] Expense 60,000 ကို Branch Ledger Outflow ထပ်မတိုးရန်။
- [ ] Net Cash Movement = -60,000 ဖြစ်ရန်။
- [ ] `cashMovements` နှင့် `cashierAdvanceReconciliations` Cloud Sync နှစ်ခုစလုံး အလုပ်လုပ်ရန်။
- [ ] Open Shift မရှိလျှင် Cash Return ကို Branch Ledger တွင်သာ ထည့်ပြီး နောက် Shift ကို နောက်မှဖွင့်သည့် Opening Cash ထဲ ပြန်ထည့်တွက်ရန်။

## E. Finance Ledger Actor & Sync

- [ ] Manual Branch Finance Entry တွင် Created By Name/UID Cloud ထဲရောက်ရန်။
- [ ] Cashier Settlement Movement တွင် Paid By Name/UID ပါရန်။
- [ ] Cash Advance Return မှတ်တမ်းတွင် Created By Name/UID ပါရန်။
- [ ] `branchFinanceLedgerEntries` ပြောင်းလဲလျှင် Owner Auto Sync ချက်ချင်းစတင်ရန်။
- [ ] `cashierAdvanceReconciliations` ပြောင်းလဲလျှင် Owner Auto Sync ချက်ချင်းစတင်ရန်။
- [ ] `branchFinanceReconciliations` ပြောင်းလဲလျှင် Owner Auto Sync ချက်ချင်းစတင်ရန်။
- [ ] Firebase ပေါ်သို့ တူညီသော Record ကို ထပ်တလဲလဲ မရေးရန်။
- [ ] Offline ပြောင်းလဲမှုများ Local Persistence ထဲ မပျောက်ရန်၊ ပြန်ချိတ်လျှင် Sync ဖြစ်ရန်။

## F. Regression

- [ ] Owner Login / Cashier Login မပျက်ရန်။
- [ ] Cashier Expense Reporting သည် Owner Approval မလိုဘဲ တင်နိုင်ရန်။
- [ ] Cashier KPay Settlement နှင့် Payment History မပျက်ရန်။
- [ ] Branch KPay Account Settings / POS KPay Checkout မပျက်ရန်။
- [ ] Cash Shift Open / Close / Cash In / Cash Out မပျက်ရန်။
- [ ] Branch Shipment, Cashier Receiving, Owner Approval မပျက်ရန်။
- [ ] POS Cash / KPay / Credit Sale မပျက်ရန်။
- [ ] Backup / Restore တွင် Finance Reconciliation Records ပါရန်။

## G. Release Gate

- [ ] `npm install` အောင်မြင်ရန်။
- [ ] `npm run typecheck` အောင်မြင်ရန်။
- [ ] `npm run build` အောင်မြင်ရန်။
- [ ] Firestore Rules ကို Test Project/Emulator တွင် စမ်းသပ်ရန်။
- [ ] Owner Mac + Cashier Android Real Firebase Test အောင်မြင်ရန်။
- [ ] Production Data Backup ရှိရန်။
