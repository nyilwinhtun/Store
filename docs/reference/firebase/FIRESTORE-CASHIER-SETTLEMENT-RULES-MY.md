# Firestore Rules — Cashier Settlement Read Permission

ဒီ Preview ၏ `firestore.rules` အပြည့်အစုံမှာ အောက်ပါ Permission ကို ထည့်ထားပြီးဖြစ်သည်။ Production Rules ကို အစားထိုးမပေးပါနှင့်။ လက်ရှိ Rules ကို Backup ထုတ်ပြီး `match /businesses/{businessId}/branches/{branchId}/{collectionName}/{recordId}` အတွင်း ရှိပြီးသား `allow get` / `allow list` Expression များထဲသို့သာ ပေါင်းစပ်ပါ။

## Read Permission အတွက် ထပ်ထည့်ရမည့် Clause

`allow get` ထဲတွင် Owner ရဲ့ မူလခွင့်ပြုချက်နဲ့ Cashier own-record condition ကို ထားပါ။

```firestore
|| (collectionName == 'cashierSettlements'
    && resource.data.payload.cashierUid == request.auth.uid)
```

`allow list` ထဲတွင် Cashier Query Limit ကိုပါ ထည့်ပါ။

```firestore
|| (collectionName == 'cashierSettlements'
    && request.query.limit <= 100
    && resource.data.payload.cashierUid == request.auth.uid)
```

ဒီ Rule သည် လက်ရှိ `CashierAutoSync` ၏ Query — `where('payload.cashierUid', '==', uid)` နှင့် `limit(100)` — နှင့် ကိုက်ညီသည်။ Cashier သည် မိမိ UID အတွက် Settlement များကိုသာ ဖတ်နိုင်သည်။

## Write Permission

ဒီ Collection အတွက် Cashier Create / Update / Delete ခွင့်ကို မထည့်ပါနှင့်။ လက်ရှိ Generic Branch Record Rules တွင် `isOwner(businessId)` သာ create / update / delete လုပ်နိုင်သည်။ ငွေရှင်းမှတ်တမ်းကို Owner ကသာ ဖန်တီးရသည်။

## မဖြစ်မနေ ထိန်းသိမ်းရန်

- `isConfiguredOwner()` ထဲက Production Owner UID ကို မပြောင်းပါနှင့်။
- `businessId == 'store-mini-main'` ကို မပြောင်းပါနှင့်။
- မူလ `isBusinessOwner`, `isCashierForBranch`, Sales Audit, Stock Sale Reduction, Branch Shipment Receipt Rules များကို မဖျက်ပါနှင့်။
- အခြား Collection အတွက် Read / Write ခွင့် မကျယ်ပြန့်စေပါနှင့်။

## Publish မလုပ်မီ စမ်းသပ်ရန်

- Owner သည် Branch ၏ Settlement များကို List / Create လုပ်နိုင်ရမည်။
- Cashier A သည် မိမိ UID နဲ့ `limit(100)` Query ကို Read လုပ်နိုင်ရမည်။
- Cashier A သည် Cashier B ၏ Settlement ကို Get / List မလုပ်နိုင်ရ။
- Cashier သည် Settlement Create / Update / Delete မလုပ်နိုင်ရ။

Firebase Rules Emulator Test မပြီးမချင်း Production Rules ကို မ Publish လုပ်ပါနှင့်။
