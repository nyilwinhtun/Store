# v3.1.4 Reports & Analytics — Test Plan

## A. Build / Static Checks

- [ ] `npm install` အောင်မြင်ခြင်း။
- [ ] `npm run typecheck` Error မရှိခြင်း။
- [ ] `npm run build` အောင်မြင်ခြင်း။
- [ ] Browser Console တွင် Runtime Error မရှိခြင်း။
- [ ] Mobile Width 360px / 390px / Desktop တွင် Layout မပျက်ခြင်း။

## B. Date Filter

- [ ] Today ရွေးလျှင် ယနေ့ရက်စွဲ Data သာပါခြင်း။
- [ ] 7 Days / 30 Days ရွေးလျှင် လက်ရှိနေ့အပါအဝင် သက်ဆိုင်ရာရက်အပိုင်းအခြားမှ Data ပါခြင်း။
- [ ] This Month / This Year မှန်ကန်ခြင်း။
- [ ] Custom Start/End Date ရွေးနိုင်ခြင်း။
- [ ] End Date သည် Start Date ထက်စောပါက Error ပြခြင်း၊ မမှန်သော Range ကို Export မလုပ်ခြင်း။

## C. Sales & Profit

Test Data:

- Completed Cash Sale: Total 100,000, Profit 20,000
- Completed KPay Sale: Total 50,000, Profit 10,000
- Completed Credit Sale: Total 30,000, Profit 6,000
- Voided Sale: Total 99,000, Profit 20,000 (မတွက်ရ)

Expected:

- Revenue = 180,000
- Gross Profit = 36,000
- Completed Sales Count = 3
- Average Order = 60,000
- Payment Type Mix: Cash 100,000 / KPay 50,000 / Credit 30,000

## D. Expense & Estimated Net

- [ ] Expense 5,000 + 3,000 ရှိလျှင် Reported Expense = 8,000 ဖြစ်ခြင်း။
- [ ] Legacy Pending/Approved status ဘယ်လိုဖြစ်စေ Expense Reporting Policy အတိုင်း အသုံးစရိတ်အားလုံး ပါဝင်ခြင်း။
- [ ] Estimated Net Profit = Gross Profit − Expense ဖြစ်ခြင်း။
- [ ] Cash Advance Settlement ကို Expense Total ထဲ ထပ်မပေါင်းခြင်း။
- [ ] Expense Category Breakdown ပေါ်ခြင်း။

## E. Cash / KPay Collection

- [ ] Cash Sale Paid Amount ကို Cash Collection ထဲ ထည့်ခြင်း။
- [ ] KPay Sale Paid Amount ကို KPay/Transfer Collection ထဲ ထည့်ခြင်း။
- [ ] Credit Sale ရဲ့ Initial Paid Amount ကို Cash Collection ထဲထည့်ခြင်း။
- [ ] Customer Credit Payment Cash ကို Cash Collection ထဲထည့်ခြင်း။
- [ ] Customer Credit Payment Transfer ကို KPay/Transfer Collection ထဲထည့်ခြင်း။
- [ ] Payment Mix ကို Account Balance အဖြစ် မဖော်ပြခြင်း။

## F. Product / Category Performance

- [ ] Product Quantity တူညီသော Unit အလိုက် စုစည်းခြင်း။
- [ ] Revenue တွက်ရာတွင် Sale Discount ကို line revenue အချိုးအစားအလိုက် ခွဲနုတ်ခြင်း။
- [ ] Category Revenue တွင် Discount ထည့်သွင်းတွက်ချက်ခြင်း။
- [ ] ဖျက်ထားသော Product များ၏ Sale Item ကို “အမျိုးအစား မသတ်မှတ်ထား” အဖြစ် ပြသခြင်း။

## G. Branch / Cashier Performance

- [ ] Owner က All Branches ရွေးနိုင်ခြင်း။
- [ ] Owner က Branch တစ်ခုချင်း ရွေးနိုင်ခြင်း။
- [ ] Branch Table ရဲ့ Sales/Expense အားလုံးကို မှန်ကန်စွာ စုစည်းခြင်း။
- [ ] Cashier Performance ကို UID အလိုက် ခွဲခြားခြင်း။
- [ ] Legacy UID မရှိသော Records ကို Owner/Legacy အဖြစ် ခွဲပြခြင်း။
- [ ] Cashier Account ဖြင့် Login ဝင်ရာ Analytics Menu/Route ပိတ်ထားခြင်း။

## H. Settlement / Cash Shift

- [ ] Paid Settlement များသာ Summary ထဲပါခြင်း။
- [ ] Voided Settlement များကို မတွက်ခြင်း။
- [ ] Cash/KPay ပေးချေမှုကို သီးခြားစုစည်းခြင်း။
- [ ] Reimbursement / Advance / Salary / Other Purpose Breakdown မှန်ကန်ခြင်း။
- [ ] ပိတ်ပြီးသား Cash Shift Variance သာ စုစည်းခြင်း။

## I. CSV Export

- [ ] UTF-8 BOM ပါဝင်ပြီး မြန်မာစာမပျက်ခြင်း။
- [ ] Date Range / Branch Scope မှန်ကန်ခြင်း။
- [ ] Summary / Branch / Cashier / Product / Expense Data ပါဝင်ခြင်း။
- [ ] Excel ဖြင့် ဖွင့်နိုင်ခြင်း။

## J. Regression / Data Safety

- [ ] Firebase Login မပျက်ခြင်း။
- [ ] POS Checkout မပျက်ခြင်း။
- [ ] Branch Shipment / Receiving / Approval မပျက်ခြင်း။
- [ ] Cashier Expense Reporting Owner Approval မလိုသည့်မူဝါဒ မပျက်ခြင်း။
- [ ] Cash/KPay Ledger နှင့် Cash Shift Data မပြောင်းလဲခြင်း။
- [ ] Report ဖွင့်ခြင်းကြောင့် Firestore Read အသစ် မတိုးခြင်း (Store Auto Sync သီးခြားဖြစ်သည်)။
- [ ] Backup / Restore Data မပျက်ခြင်း။
