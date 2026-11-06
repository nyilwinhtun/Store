# Firebase Console မှာ Shared Customer / Supplier Rules ပြင်ရန်

## အရေးကြီး

ဒီပြင်ဆင်ချက်ကို GitHub Pages Deploy က Firebase သို့ အလိုအလျောက် မတင်ပေးပါ။ Firebase Console မှာ သီးခြား Publish လုပ်ရပါမယ်။ လက်ရှိ Production Rules ကို အရင် Copy/Backup ယူထားပါ။ `firestore.rules` ဖိုင်တစ်ခုလုံးကို မျက်စိမှိတ် Replace မလုပ်ပါနှင့်။ သင့် Project မှာ Legacy Collection Rules ရှိနေပါက ပျက်သွားနိုင်ပါတယ်။

## ဘယ်နေရာမှာ ထည့်ရမလဲ

Firebase Console → `store-mini` Project → Firestore Database → Rules ကို ဖွင့်ပါ။ လက်ရှိ Rules ထဲက `match /businesses/{businessId}` block ကို ရှာပါ။ အဲဒီ block အတွင်းမှာ၊ `match /meta/{metaId}` မတိုင်ခင် သို့မဟုတ် အနီးတွင် အောက်ပါ nested rule ကို ထည့်ပါ။

```javascript
// Current Minimart app path:
// businesses/{businessId}/shared/{kind}/records/{recordId}
match /shared/{collectionName}/records/{recordId} {
  allow read: if isOwner(businessId) || isActiveMember(businessId);
  allow create, update: if isOwner(businessId)
    || (isActiveMember(businessId)
      && get(memberPath(businessId, request.auth.uid)).data.role == 'cashier'
      && collectionName == 'customers');
  allow delete: if isOwner(businessId);
}
```

ဒီ snippet သည် ZIP ထဲရှိ `isOwner`, `isActiveMember`, `memberPath` helper functions ကို အသုံးပြုထားသည်။ သင့် Console Rules မှာ အဲဒီ helper functions မတူပါက မူရင်း Owner / Member authorization logic ကို မပြောင်းဘဲ ကိုက်ညီအောင် ပြင်ပါ။

## Publish မလုပ်မီ စစ်ရန်

- `store-mini` Project မှန်ကြောင်း စစ်ပါ။
- `businesses/{businessId}` ရှိပြီးသား Owner rules ကို မဖျက်ပါနှင့်။
- `branches/{branchId}/{collectionName}/{recordId}` Rules ကို မဖျက်ပါနှင့်။
- Legacy `posAccounts`, `stores`, `sales`, `store_settings` Collection rules အသုံးပြုနေသေးလျှင် ဆက်ထိန်းပါ။
- `allow read, write: if true` ကို production မှာ မထားပါနှင့်။

## Publish ပြီး စမ်းရန်

1. Rules tab မှ Publish အောင်မြင်ကြောင်း စစ်ပါ။
2. Minimart v2.8.2 မှ Owner Account ဖြင့် ဝင်ပါ။
3. Business Cloud Sync မှ `Upload Initial Snapshot` သို့မဟုတ် `Cloud နှင့် ပေါင်းစည်းရန်` လုပ်ပါ။
4. Customer / Supplier Listener error မရှိကြောင်းနှင့် Auto Sync Status `Synced` ဖြစ်ကြောင်း စစ်ပါ။
5. Firebase Console → Firestore Data မှ `businesses/store-mini-main/shared/customers/records` နဲ့ `.../suppliers/records` အောက်တွင် Record များ ရှိကြောင်း စစ်ပါ။
