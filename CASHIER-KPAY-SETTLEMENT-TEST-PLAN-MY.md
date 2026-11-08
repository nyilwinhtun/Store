# v3.1.1 — Cashier KPay & Cash Settlement Test Plan

## စမ်းသပ်မှုမစမီ

1. Production Local Data ကို JSON Backup ထုတ်ပါ။
2. ZIP ကို Folder အသစ်တစ်ခုတွင် ဖြည်ပါ။ မူလ Production Folder ကို Overwrite မလုပ်ပါနှင့်။
3. Owner Firebase Login နှင့် Active Business Access မှန်ကန်ကြောင်း စစ်ပါ။
4. သက်ဆိုင်ရာ Branch အတွက် Active Cashier Member ရှိကြောင်း၊ `role: cashier`, `status: active`, `branchIds` ထဲတွင် အဲဒီ Branch တစ်ခုတည်း ပါကြောင်း စစ်ပါ။
5. Firestore Rules ကို Publish မလုပ်မီ မူလ Production Rules Backup လုပ်ပါ။ Rules Patch ကို စစ်ပြီးမှ Publish လုပ်ပါ။

## A. Owner Settlement UI

- [ ] Owner သည် Cashier ငွေရှင်း Menu ကို မြင်ရမည်။
- [ ] လက်ရှိ Branch အတွက် Active Cashier များသာ ရွေးချယ်စရာ ပေါ်ရမည်။
- [ ] Member List မဖတ်နိုင်ပါက တိကျသော Error ကို ပြရမည်။
- [ ] Cashier မရွေးထားလျှင် Save မဖြစ်ရ။
- [ ] Amount သည် positive integer ဖြစ်ရမည်။ 0, negative, decimal, NaN, unsafe integer များကို ပယ်ချရမည်။
- [ ] Confirmation Dialog က ငွေကို အမှန်တကယ် ပေးချေပြီးပြီလား မေးရမည်။
- [ ] Cancel လုပ်လျှင် Settlement မဖန်တီးရ။

## B. KPay Settlement

1. Owner သည် KPay App မှ Cashier ထံ အမှန်တကယ် ငွေလွှဲပါ။
2. Settlement Form တွင် Cashier, Purpose, Amount, Receiver Name, Receiver Account Number, Transaction ID ထည့်ပါ။
3. Sender Account fields ကို optional အဖြစ် စမ်းပါ။
4. Transaction ID မဖြည့်ဘဲ Submit လုပ်လျှင် ပယ်ချရမည်။
5. KPay Txn ID တူညီသော Paid Record ကို ထပ်တင်လျှင် UI က ပယ်ချရမည်။
6. UI bypass လုပ်သည့် duplicate attempt ကို Store validation ကလည်း ပယ်ချရမည်။
7. Owner Device နှစ်လုံးမှ Transaction ID တူညီသော KPay Record ကို တစ်ပြိုင်တည်းဖန်တီးပါက Deterministic Document ID ကြောင့် Duplicate Payout Record အဖြစ် နှစ်ခုမဖြစ်ဘဲ Sync Conflict / Duplicate Block ဖြစ်ရမည်။
7. သိမ်းပြီးနောက် Owner History, CSV Export ထဲတွင် အချက်အလက် မှန်ကန်ရမည်။
8. Cashier သည် Cloud Sync ပြီးနောက် မိမိ KPay Receipt / Txn ID ကိုသာ မြင်ရမည်။

## C. Cash Settlement & Cash Shift

1. သက်ဆိုင်ရာ Branch တွင် Open Cash Shift ဖွင့်ပါ။
2. Owner က Cash Advance သို့မဟုတ် Salary ကို Cash ဖြင့် ပေးချေပြီး မှတ်တမ်းတင်ပါ။
3. `cashMovements` တွင် `direction: out`, `sourceSettlementId` ပါသော Cash Out တစ်ခုတည်း ဖန်တီးရမည်။
4. Cash Shift ၏ Expected Cash တွင် Cash Out ပမာဏ တစ်ကြိမ်သာ နုတ်ရမည်။
5. Open Shift မရှိသည့်အခါ Settlement Record သည် သိမ်းနိုင်သော်လည်း CashMovement မဖန်တီးကြောင်း အသိပေးချက်ကို မှတ်သားပါ။

## D. Expense Reimbursement

1. Cashier သည် မိမိကိုယ်ပိုင်ငွေ `cashier-personal` ဖြင့် အသုံးစရိတ်တင်ပြပါ။
2. Owner သည် Settlement Form မှ သက်ဆိုင်ရာ Expense ကို ရွေးပါ။
3. Expense ပမာဏအပြည့်ကိုသာ ပြန်အမ်းခွင့်ပြုရမည်။
4. Owner က Cash / KPay ဖြင့် အမှန်တကယ် ပြန်အမ်းပြီး မှတ်တမ်းတင်ပါ။
5. Expense တွင် `reimbursedBySettlementId` ချိတ်ဆက်ရမည်။ Expense တစ်ခုကို ထပ်မံပြန်အမ်းရန် မရရ။
6. Expense ကို Analytics တွင် တစ်ကြိမ်သာတွက်ပါ။ Settlement ကို Expense အသစ်အဖြစ် ထပ်မတွက်ပါနှင့်။
7. `branch-cash` / `branch-kpay` ဖြင့် ကုန်ကျစရိတ်ကို ကိုယ်ပိုင်ငွေပြန်အမ်းစာရင်းထဲ မပြရ။

## E. Cashier Permission & Privacy

- [ ] Cashier A သည် မိမိ UID အတွက် `cashierSettlements` Query ကိုသာ ရယူနိုင်ရမည်။
- [ ] Cashier A သည် Cashier B ရဲ့ Settlement ကို Get / List မလုပ်နိုင်ရ။
- [ ] Cashier သည် Settlement Create / Update / Delete မလုပ်နိုင်ရ။
- [ ] Owner သည် Branch Settlement အားလုံးကို ကြည့်နိုင်ရ။
- [ ] Cashier Member UID မတူပါက အခြားဝန်ထမ်းစာရင်းကို လက်ခံသူအဖြစ် မရွေးနိုင်ရ။

## F. Two-Device Cloud Sync

- [ ] Owner Mac တွင် Settlement အသစ်တင်ပါ။
- [ ] Owner Auto Sync သည် `cashierSettlements` ကို Cloud သို့တင်ရမည်။
- [ ] Cashier Phone သည် မိမိ UID အတွက် Settlement Listener မှ Record ရယူရမည်။
- [ ] Cashier A သည် Cashier B ရဲ့ Record ကို မမြင်ရ။
- [ ] Internet ဖြုတ်ထားလျှင် Owner Local Record မပျောက်ရ။ Online ပြန်ရသည့်အခါ Cloud Sync ဖြစ်ရမည်။
- [ ] Owner နှစ်လုံးတွင် ပြိုင်တူ data ပြင်ဆင်လျှင် Auto Sync Conflict handling ကို စစ်ပါ။

## G. Regression Tests

- [ ] Owner / Cashier Login
- [ ] POS Checkout Cash / Credit
- [ ] Product / Stock Update
- [ ] Stock Transfer
- [ ] Branch Shipment → Cashier Receiving → Owner Approval
- [ ] Expense Reporting Mode (Owner Approval မလို)
- [ ] Cash Shift Open / Close
- [ ] Existing Backup / Restore

## Known Limitations

- App သည် KPay ကို တိုက်ရိုက်မလွှဲပါ။ Owner သည် KPay မှ အရင်လွှဲပြီးမှ Transaction ID ဖြင့် မှတ်တမ်းတင်ရသည်။
- ဒီ Preview တွင် Branch KPay Master Account / Balance Ledger မပါပါ။
- ဒီ Preview တွင် Cash Advance ပြန်လည်ရှင်းတမ်း၊ Partial Reimbursement, Receipt Image Upload နှင့် Settlement Void/Reversal UI မပါပါ။
- Firebase Rules Emulator Test နှင့် Live Two-Device Test မပြီးမချင်း Production တွင် မသုံးပါနှင့်။
