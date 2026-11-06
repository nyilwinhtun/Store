# v2.7.3 — Cloud Sync Build Fix

## ပြင်ဆင်ချက်များ

1. `CloudSyncPanel.tsx` ရှိ `doc(firestore, ...pathFor(item))` TypeScript overload error ကို slash-delimited document path တစ်ခုအဖြစ် ပေးခြင်းဖြင့် ပြင်ဆင်ထားသည်။
2. Shared Customer/Supplier records အတွက် Firestore collection path ကို မှန်ကန်သော collection/document အဆင့်များဖြစ်စေရန် `shared/{kind}/records/{recordId}` အဖြစ် ပြင်ဆင်ထားသည်။ Read နှင့် Write လမ်းကြောင်းနှစ်ခုလုံး တူညီသည်။
3. POS Business ID, Firebase configuration, Owner Login flow, Local IndexedDB image storage နှင့် Local data schema ကို မပြောင်းထားပါ။

## Mac တွင် စမ်းသပ်ရန်

```bash
npm install
npm run typecheck
npm run build
```

Build အောင်မြင်ပြီးနောက် Dev Server ကို ပြန်စပါ။

```bash
npm run dev -- --host --port 5173 --strictPort
```

## သတိပြုရန်

Cloud Sync အတွက် `businesses/{businessId}/shared/{kind}/records/{recordId}` path ကို v2.7.3 မှစ၍ အသုံးပြုသည်။ Firebase Security Rules သည် ဒီ nested path ကို Owner UID အလိုက် ခွင့်ပြုထားရမည်။ လက်ရှိ Rules ကို မစစ်ဘဲ Publish/Replace မလုပ်ပါနှင့်။
