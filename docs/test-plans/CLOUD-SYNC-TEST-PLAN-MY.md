# v2.8.2 Cloud Sync စမ်းသပ်ရန် Checklist

## စမ်းသပ်မီ
- Main Device နှင့် Test Device နှစ်ခုစလုံးမှာ v2.8.2 တင်ပါ။
- Device တစ်ခုချင်းစီမှာ JSON Backup ထုတ်ပါ။
- Business ID `store-mini-main` နှင့် Owner UID မှန်ကြောင်း စစ်ပါ။
- လက်ရှိ Firestore Rules ကို Backup ယူထားပါ။ `allow read, write: if true` ရှိနေဆဲဆိုရင် Live Production Data ကို မသုံးခင် Rules လုံခြုံရေးကို အရင်ပြင်ဆင်ပါ။

## Test 1 — ပထမ Cloud Snapshot
1. Main Device မှာ Owner Login ဝင်ပါ။
2. Settings → Business Cloud Sync → `Upload Initial Snapshot` နှိပ်ပါ။
3. Firestore မှာ `businesses/store-mini-main/branches/{branchId}` နှင့် အောက်က branch-specific collections ကို စစ်ပါ။
4. Shared Customer / Supplier ကို `shared/customers/records`, `shared/suppliers/records` မှာ စစ်ပါ။
5. `meta/settings` မှာ Settings / Owner Profile ရှိပြီး `adminPin` မပါကြောင်း စစ်ပါ။

## Test 2 — Device အသစ်သို့ Safe Merge
1. Test Device မှာ အရင် JSON Backup ထုတ်ပါ။
2. Owner Account ဖြင့် Login ဝင်ပါ။
3. `Cloud နှင့် ပေါင်းစည်းရန်` ကို နှိပ်ပါ။
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
5. Backup ထုတ်ပြီး Conflict Record ID ကို စစ်ဆေးပါ။ လိုအပ်ပါက မှန်ကန်သော Record ကို Owner က ကိုယ်တိုင်ရွေးချယ်ပြီး ပြင်ဆင်ပါ။

## လက်ရှိကန့်သတ်ချက်များ
- Cashier Auto Sync ကို မဖွင့်သေးပါ။ Owner Device များသာ Automatic Sync လုပ်သည်။
- Offline Sale သည် LocalStorage ထဲမှာ အရင်သိမ်းနိုင်သော်လည်း Cashier Device များအတွက် သီးခြား Server-side outbox/stock posting မပါသေးပါ။
- Logo / Banner / Owner Photo ပုံဖိုင်များကို Device များအကြား Cloud မှ အလိုအလျောက် မရွှေ့ပါ။
- Same-record conflict ကို system က အလိုအလျောက် မရွေးပေးပါ။ Data မအစားထိုးဘဲ ရပ်ပေးသည်။

## v2.8.2 Additions

- Firestore nested shared records rules must permit `shared/{kind}/records/{id}`.
- New-device setup must merge Cloud-only and local-only records; same-ID payload conflicts must stop.
- Verify that a cloud-only record remains present locally after `Upload Initial Snapshot` and does not become a delete tombstone.

## v2.8.3 အတွက် ထပ်မံစမ်းသပ်ရန်

1. Owner Account နဲ့ Laptop မှာ Login ဝင်ပြီး Settings → Cloud Sync မှ Auto Sync Status ကို စစ်ပါ။ Device မှာ Baseline မရှိလျှင် Cloud/Local Safe Merge ကို အလိုအလျောက် စတင်ရပါမယ်။
2. Phone မှာ Owner Account တူတူ Login ဝင်ပါ။ Baseline မရှိလျှင် Phone ကလည်း အလိုအလျောက် Safe Merge လုပ်ပြီး Realtime Listener ချိတ်ဆက်ရပါမယ်။
3. Device နှစ်ခုလုံးတွင် Branch Selector မှ Branch အမည်တူကို ရွေးပါ။ Laptop မှ Product အသစ်တစ်ခု ထည့်ပြီး Phone တွင် ပေါ်လာသလား စစ်ပါ။ Phone မှ Product အသစ်တစ်ခု ထည့်ပြီး Laptop တွင် ပြန်ပေါ်သလား စစ်ပါ။
4. Branch မတူစေရန် ရွေးပြီး စမ်းသပ်ပါ။ Product / Stock သည် မိမိ Branch အလိုက်သာ ပြသရပါမယ်။
5. Firestore Shared Rules မထည့်ရသေးလျှင် Customer/Supplier Sync သာ ပိတ်ထားပြီး Product/Stock/Sales Auto Sync ဆက်အလုပ်လုပ်ရပါမယ်။ `FIRESTORE-SHARED-RULES-PATCH-MY.md` ကို Firebase Console မှာ လက်ရှိ Production Rules နဲ့ ပေါင်းစည်း Publish လုပ်ပြီး App ကို ပြန်ဖွင့်ပါ။
6. ID တူပြီး Payload မတူသော Record ကို တွေ့ပါက Conflict ပြပြီး မည်သည့်ဘက် Data ကိုမှ Auto overwrite မလုပ်ရပါ။

**မှတ်ချက်:** Cashier Account အတွက် Auto Sync မဖွင့်သေးပါ။ ဤစမ်းသပ်မှုသည် Owner Account နှင့် Owner Devices အတွက်သာ ဖြစ်သည်။
