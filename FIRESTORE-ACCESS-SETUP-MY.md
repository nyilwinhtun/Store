# Firebase Owner / Cashier Access & Cloud Sync — v2.8.2

## Project
- Firebase Project: `store-mini`
- Business ID: `store-mini-main`
- Owner Access: `businesses/store-mini-main.ownerUid`
- Cashier Membership: `businesses/store-mini-main/members/{uid}`

## Cloud Sync Path

```text
businesses/{businessId}/
  branches/{branchId}
  branches/{branchId}/{recordCollection}/{recordId}
  shared/customers/records/{customerId}
  shared/suppliers/records/{supplierId}
  meta/settings
```

Branch-specific collections: `categories`, `products`, `sales`, `expenses`, `heldItems`, `customerPayments`, `purchases`, `supplierPayments`, `purchaseReturns`, `stockBatches`, `stockReceipts`, `stockTransfers`, `cashShifts`, `cashMovements`, `activityLogs`.

`stockTransfers` ကို Source Branch ထဲမှာ သိမ်းထားပြီး destination Branch ID ကို payload ထဲမှာ ပါရှိစေပါတယ်။

## Rules

ZIP ထဲက `firestore.rules` သည် Owner `ownerUid` verification၊ Cashier Active Membership / Branch assignment၊ Branch collection access၊ Shared customer/supplier access နှင့် Owner-only business meta write ကို သတ်မှတ်ထားပါတယ်။ v2.8.2 တွင် App က အသုံးပြုနေသော `shared/{kind}/records/{recordId}` nested path အတွက် သီးခြား Rule ပါဝင်သည်။ အရင် Rules တွင် ဒီ path မပါလျှင် Shared Listener များ `permission-denied` ဖြစ်ပြီး Owner Auto Sync တစ်ခုလုံး မစနိုင်ပါ။

**လက်ရှိ Console Rules ကို Backup မလုပ်ဘဲ အစားမထိုးပါနှင့်။** သင့် Project မှာ `sales`, `store_settings`, `stores` Root Collections အဟောင်းတွေ ရှိနေပါတယ်။ ဤ Rules ဖိုင်က Legacy Root Collections ကို မဖွင့်ထားပါ။ အဟောင်း App/Workflow က အသုံးပြုနေသေးပါက လိုအပ်တဲ့ Legacy Access ကို ထိန်းသိမ်းထားတဲ့ Rules ကို စမ်းသပ်ပြီးမှ Publish လုပ်ပါ။

လက်ရှိ Console Rules မှာ `allow read, write: if true` ကို Publish လုပ်ထားဆဲဆိုလျှင် အများပြည်သူ Read/Write အန္တရာယ်ရှိပါတယ်။ Production မသုံးမီ လုံခြုံတဲ့ Rules သို့ ပြောင်းရပါမယ်။ Legacy Flow မပျက်စေရန် အရင်ညှိပြီးမှ Publish လုပ်ပါ။

## No Firebase Storage

Logo / Banner / Owner Photo များသည် Local IndexedDB ထဲမှာပဲ ရှိသည်။ Firestore Sync သည် ပုံဖိုင်အစစ်ကို Cloud သို့ မပို့ပါ။ Device များအကြား ပုံရွှေ့ရန် JSON Backup / Restore ကို အသုံးပြုပါ။

## Sync Flow

1. Main Owner Device: JSON Backup → `Upload Initial Snapshot`.
2. New Device: JSON Backup → `Cloud နှင့် ပေါင်းစည်းရန်`.
3. Baseline ရှိသော Device များ: `Sync Changes`.
4. တူညီသော Record ကို နှစ်ဖက်ပြင်ထားလျှင် Conflict ပြပြီး Sync ရပ်မည်။

ဒီ Version သည် Manual Owner Sync ဖြစ်ပြီး Real-time Auto Sync / Cashier Offline Outbox မပါသေးပါ။
