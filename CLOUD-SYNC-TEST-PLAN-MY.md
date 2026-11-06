# v2.7.3 Cloud Sync စမ်းသပ်ရန် Checklist

## စမ်းသပ်မီ
- Main Device နှင့် Test Device နှစ်ခုစလုံးမှာ v2.7.3 တင်ပါ။
- Device တစ်ခုချင်းစီမှာ JSON Backup ထုတ်ပါ။
- Business ID `store-mini-main` နှင့် Owner UID မှန်ကြောင်း စစ်ပါ။
- လက်ရှိ Firestore Rules ကို Backup ယူထားပါ။ `allow read, write: if true` ရှိနေဆဲဆိုရင် Live Production Data ကို မသုံးခင် Rules လုံခြုံရေးကို အရင်ပြင်ဆင်ပါ။

## Test 1 — ပထမ Cloud Snapshot
1. Main Device မှာ Owner Login ဝင်ပါ။
2. Settings → Business Cloud Sync → `Upload Initial Snapshot` နှိပ်ပါ။
3. Firestore မှာ `businesses/store-mini-main/branches/{branchId}` နှင့် အောက်က branch-specific collections ကို စစ်ပါ။
4. Shared Customer / Supplier ကို `shared/customers`, `shared/suppliers` မှာ စစ်ပါ။
5. `meta/settings` မှာ Settings / Owner Profile ရှိပြီး `adminPin` မပါကြောင်း စစ်ပါ။

## Test 2 — Device အသစ်သို့ Download
1. Test Device မှာ အရင် JSON Backup ထုတ်ပါ။
2. Owner Account ဖြင့် Login ဝင်ပါ။
3. `Download Cloud → ဒီ Device` ကို နှိပ်ပါ။
4. Branch, Product, Category, Stock, Sales, Customer, Supplier, Payment, Cash Shift နှင့် Reports အချက်အလက်များ ပြန်ရောက်မရောက် စစ်ပါ။
5. Local Logo / Banner / Owner Photo သည် ဒီ Device ရဲ့ IndexedDB ထဲမှာသာ ရှိပြီး Cloud မှ အခြား Device သို့ အလိုအလျောက် မရောက်ကြောင်း မှတ်သားပါ။

## Test 3 — One-side change
1. Test Device မှာ စမ်းသပ် Product တစ်ခု ထည့်ပါ သို့မဟုတ် စမ်းသပ် Sale တစ်ခု ပြုလုပ်ပါ။
2. `Sync Changes` နှိပ်ပါ။
3. Main Device မှာ `Sync Changes` နှိပ်ပါ။
4. Record အသစ် ရောက်လာမရောက်လာနှင့် Stock / Sale totals ကို စစ်ပါ။

## Test 4 — Same-record conflict
1. Device နှစ်ခုလုံးကို တူညီသော Cloud Baseline ရရှိထားစေပါ။
2. Device A နဲ့ Device B နှစ်ဖက်လုံးက Product တစ်ခုတည်းရဲ့ ဈေးနှုန်းကို သီးခြားပြောင်းပါ။
3. Device A မှာ `Sync Changes` အရင်လုပ်ပါ။
4. Device B မှာ `Sync Changes` လုပ်ပါ။ Conflict ပြပြီး Data တစ်ဖက်ကို မျက်စိမှိတ် မအစားထိုးကြောင်း စစ်ပါ။
5. Backup ထုတ်ပြီး သင်လိုချင်တဲ့ Cloud Version ကို Download လုပ်ပါ။ နောက်မှ လိုအပ်တဲ့ ပြင်ဆင်ချက်ကို ပြန်ထည့်ပါ။

## လက်ရှိ Version မှာ မပါသေးသော စမ်းသပ်မှုများ
- Cashier Login မှ နောက်ကွယ် Auto Sync
- Offline sales outbox နှင့် auto retry
- Real-time listener / live updates
- Local image cloud transfer
- Automatic conflict merge

ဤအရာများကို နောက် Phase တွင် သီးခြားတည်ဆောက်ရပါမယ်။
