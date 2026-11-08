# Cashier Expense Reporting — Manual Test Plan (Preview 6)

## မစမ်းသပ်မီ

- JSON Backup ထုတ်ပါ။
- Preview 6 ကို Folder အသစ်တွင် ဖြည်ပါ။
- Owner Firebase Business Access နှင့် Cashier Branch Assignment ကို စစ်ပါ။
- Production Firestore Rules ကို အရင် Backup လုပ်ပြီး Expense Create Schema Patch ကို Owner UID / Business ID မပြောင်းဘဲ ထည့်ပါ။

## Test 1 — Approval မလိုဘဲ Expense တင်နိုင်ခြင်း

1. Owner Branch Settings တွင် Legacy Expense Limit ကို 0 ထားပါ။
2. Cashier ဖြင့် Login ဝင်ပါ။
3. 5,000 MMK Expense တင်ပါ။
4. 500,000 MMK Expense တင်ပါ။
5. အခြား Expense တစ်ခု ထပ်တင်ပါ။

Expected: တစ်ခုချင်းစီ Local မှာ သိမ်းပြီး Cloud ချိတ်ထားလျှင် `submitted` အဖြစ် Cloud တင်ပြနိုင်ရမည်။ Limit သို့မဟုတ် Owner Review ကြောင့် Submit မပိတ်ရ။

## Test 2 — Owner Report List

1. Owner Device မှ Expense Management ကို ဖွင့်ပါ။
2. Cashier တင်ထားသော Expense များကို Branch / Cashier အမည် / Amount အပါအဝင် ကြည့်ပါ။

Expected: Owner သည် တင်ပြထားသော စာရင်းအားလုံးကို တွေ့ရမည်။ Approve / Reject ခလုတ်မရှိရ။

## Test 3 — Owner Report Only

1. Owner က Expense Management ကို ဖွင့်ပါ။
2. Cashier မှ တင်ထားသော Expense များ ပေါ်ကြောင်း စစ်ပါ။
3. Owner မှ Approve / Reject လုပ်စရာမလိုကြောင်း စစ်ပါ။
4. Cashier က နောက် Expense အသစ်တစ်ခု ထပ်တင်ပါ။

Expected: Owner သည် တင်ပြချက်များကို ကြည့်နိုင်ရမည်။ Owner action မရှိလည်း Cashier သည် Expense အသစ်များ ဆက်တင်နိုင်ရမည်။

## Test 4 — Offline Queue

1. Cashier Device ကို Offline လုပ်ပြီး Expense တင်ပါ။
2. Local `Cloud Sync စောင့်နေ` ပြကြောင်း စစ်ပါ။
3. Internet ပြန်ဖွင့်ပါ။
4. Expense တစ်ကြိမ်သာ Cloud ထဲရောက်ကြောင်း စစ်ပါ။

Expected: Duplicate Document မဖြစ်ရ။ Sync ပြီးနောက် Report Status သည် `submitted` ဖြစ်ရမည်။

## Test 5 — Owner Report Visibility

1. Cashier မှ Expense တစ်ခုကို Cloud Sync အောင်မြင်စေပါ။
2. Owner Device တွင် Expense Management ကို ဖွင့်ပါ။

Expected: Owner ဘက်တွင် Expense ပေါ်ရမည်။ Approve / Reject လုပ်ရန် သို့မဟုတ် Cashier ထံ status အတည်ပြုချက်ပြန်ပို့ရန် မလိုအပ်ပါ။

## Test 6 — Privacy & Firestore Rules

- Cashier မိမိ Expense Create/Get/List: ခွင့်ပြု။
- Cashier အခြား UID Expense Get/List: ပယ်ချ။
- Cashier Expense Update/Delete: ပယ်ချ။
- Owner Expense List/Get: ခွင့်ပြု။ Owner Update action မလိုအပ်။

## Test 7 — Legacy Data Compatibility

- Preview 5 `pending` Expense: Owner List မှာ တင်ပြထားသော Record အဖြစ် ပြရမည်။
- Preview 5 `not-required` Expense: မပျောက်ရ။
- Preview 5 `approved` / `rejected` Expense: မပျောက်ရ၊ Report History အဖြစ် ဆက်ပြရမည်။
- Branch `cashierExpenseApprovalLimit` setting ဟောင်း: data အဖြစ် ကျန်ရှိရမည်၊ Version အသစ်က approval gate မလုပ်ရ။

## Test 8 — Analytics & Regression

- Expense submit ပြီးသည်နှင့် Analytics expense total ထဲပါရမည်။
- Owner/Cashier Login မပျက်ရ။
- POS Cash/Credit Sale မပျက်ရ။
- Branch Shipment / Receiving / Approval မပျက်ရ။
- Offline Sync / Backup / Restore မပျက်ရ။

## Test Status

Source-level checks may be run locally. Firebase Emulator / Production Firebase Live Test and Android + Owner Mac device test must pass before production release.
