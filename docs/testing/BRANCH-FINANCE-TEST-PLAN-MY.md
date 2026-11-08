# Branch Cash & KPay Ledger — Test Plan (Preview 8)

## A. Branch KPay Account

- [ ] Branch A KPay Account သတ်မှတ်ပြီး Cashier Device သို့ Branch Sync ဖြင့် ရောက်ရန်။
- [ ] Branch B ရဲ့ Account သည် Branch A နှင့် မရောရန်။
- [ ] Account Name သာ သို့မဟုတ် Number သာ ဖြည့်ထားလျှင် Save မလုပ်နိုင်ရန်။
- [ ] KPay Opening Balance > 0 ဖြစ်လျှင် Account Name/Number မပါဘဲ Save မလုပ်နိုင်ရန်။
- [ ] Ledger Start Date မှတ်တမ်းတင်ပြီး ရှေ့/နောက်နေ့ အရောင်းများ မှန်ကန်စွာ စစ်ရန်။

## B. POS KPay

- [ ] Branch KPay Account မသတ်မှတ်ရသေးလျှင် POS KPay option ပိတ်ရန်။
- [ ] KPay ရွေးလျှင် Branch Account Name/Number ပြရန်။
- [ ] Transaction ID မဖြည့်ဘဲ Checkout မလုပ်နိုင်ရန်။
- [ ] KPay Sale ကို Paid = Total, Due = 0 အဖြစ် သိမ်းရန်။
- [ ] Receipt/Sales History/CSV တွင် KPay နဲ့ Transaction ID ပြရန်။
- [ ] KPay Sale များ Cash Shift Expected Cash ထဲ မပါရန်။
- [ ] Cash Sale များ Cash Shift ထဲ ပုံမှန်အတိုင်း ပါရန်။
- [ ] Credit Sale ရဲ့ Initial Paid Amount ကို Cash Shift ထဲသာ မှန်ကန်စွာထည့်ရန်။
- [ ] တူညီသော KPay Reference ကို Local Branch Data အတွင်း အခြား KPay Transaction တစ်ခုမှာ ထပ်သုံးလျှင် ပယ်ချရန်။

## C. Cashier Settlement

- [ ] Owner သည် Active Cashier များကို Branch အလိုက်သာ ရွေးနိုင်ရန်။
- [ ] Cash Settlement ပြီးလျှင် Cashier History တွင် ပေါ်ရန်။
- [ ] KPay Settlement တွင် Cashier Personal Receiver Account နှင့် Transaction ID လိုအပ်ရန်။
- [ ] Owner Sender Branch KPay Account မှန်ကန်စွာ prefill ဖြစ်ရန်။
- [ ] Cash Settlement ရှိ Open Cash Shift တွင် Cash Out တစ်ကြိမ်သာ ဖြစ်ရန်။
- [ ] KPay Settlement ကို Cash Shift ထဲ မထည့်ရန်။
- [ ] Expense Reimbursement ကို မိမိ UID ရဲ့ cashier-personal Expense တစ်ကြိမ်သာ ချိတ်နိုင်ရန်။
- [ ] Reimbursed Expense ကို ထပ်မံပေးချေ၍ မရရန်။

## D. Cash Advance Reconciliation

Scenario: Cash Advance 100,000 (Cash) → Branch Cash Expense 60,000 ချိတ် → Cash 40,000 ပြန်အပ်။

- [ ] Advance Outstanding = 100,000 မှစရန်။
- [ ] Expense Applied 60,000 ပြီးနောက် Outstanding = 40,000 ဖြစ်ရန်။
- [ ] Branch Ledger တွင် Advance Out 100,000 တစ်ကြိမ်သာ ရှိရန်။
- [ ] Expense 60,000 ကို Ledger Outflow ထပ်မတိုးရန်။
- [ ] Cash Return 40,000 In ထည့်ပြီးနောက် Outstanding = 0 ဖြစ်ရန်။
- [ ] Net Cash Movement = -60,000 ဖြစ်ရန်။
- [ ] Advance ထက်ပို၍ Reconcile လုပ်မရရန်။
- [ ] Expense တစ်ခုကို Advance နှစ်ခုနှင့် ချိတ်မရရန်။
- [ ] KPay Return တွင် Transaction ID လိုအပ်ရန်။

## E. Branch Ledger

- [ ] Cash Sale → Cash In.
- [ ] KPay Sale → KPay In.
- [ ] Credit Initial Cash Deposit → Cash In.
- [ ] Customer Cash Collection → Cash In တစ်ကြိမ်သာ.
- [ ] Branch Cash/KPay Expense → သက်ဆိုင်ရာ Channel Out.
- [ ] Cashier Cash/KPay Settlement → သက်ဆိုင်ရာ Channel Out.
- [ ] Supplier Cash Payment → Cash Out တစ်ကြိမ်သာ.
- [ ] Cash Shift Manual Movement → Ledger ထဲ တစ်ကြိမ်သာ.
- [ ] Advance Expense Applied → Double Count မဖြစ်ရန်.
- [ ] Advance Cash/KPay Return → သက်ဆိုင်ရာ Channel In.
- [ ] Manual KPay Entry တွင် Transaction ID မဖြည့်ဘဲ သိမ်းမရရန်.
- [ ] CSV Export မှာ Filter အားလုံး ပါရန်.

## F. Offline / Cloud / Permissions

- [ ] Owner-only Branch Finance Page ဖြစ်ရန်။
- [ ] Cashier သည် Owner Ledger Data မပြင်နိုင်ရန်။
- [ ] Branch Finance Records Cloud Sync ပြီးနောက် Owner Device နှစ်ခု တူညီရန်။
- [ ] Cashier သည် မိမိ Settlement ကိုသာ မြင်ရန်။
- [ ] Offline Local Changes က Duplicate IDs မဖြစ်စေရန်။
- [ ] App ပြန်ဖွင့်ပြီးနောက် Data မပျောက်ရန်။
- [ ] Existing POS, Branch Shipment, Receiving, Owner Approval, Login နှင့် Expense Reporting မပျက်ရန်။

## G. Production Gate

- [ ] `npm install` အောင်မြင်ရန်။
- [ ] `npm run typecheck` အောင်မြင်ရန်။
- [ ] `npm run build` အောင်မြင်ရန်။
- [ ] Owner Mac + Cashier Android Real Firebase Test အောင်မြင်ရန်။
- [ ] Firebase Usage Diagnostics တွင် Read/Write များ အလွန်အကျွံမတက်ကြောင်း စစ်ရန်။
