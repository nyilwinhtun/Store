# Firestore Rules — Finance Reconciliation (v3.1.3)

`branchFinanceReconciliations` သည် Owner-only၊ append-only Audit Snapshot Collection ဖြစ်သည်။

## လိုအပ်သော Access

- Owner: Create / Get / List ခွင့်ရှိသည်။
- Cashier: Get / List / Create / Update / Delete ခွင့်မရှိပါ။
- Owner အပါအဝင် မည်သူမျှ ရှိပြီးသား Snapshot ကို Update/Delete မလုပ်နိုင်ပါ။

လက်ရှိ `firestore.rules` ၏ Branch Collection Rule တွင် အောက်ပါကန့်သတ်ချက် ပါဝင်ရမည်။

```firestore-rules
allow create: if (isOwner(businessId) && collectionName != 'auditEvents')
  || (collectionName == 'sales' && validCashierSaleCreate(businessId, branchId, recordId))
  || (collectionName == 'expenses' && validCashierExpenseCreate(businessId, branchId, recordId))
  || (collectionName == 'auditEvents' && (validCashierSaleAuditCreate(businessId, branchId, recordId)
    || validOwnerVoidAuditCreate(businessId, branchId, recordId)));

allow update: if (isOwner(businessId)
  && collectionName != 'auditEvents'
  && collectionName != 'branchFinanceReconciliations')
  || (collectionName == 'stockShipments' && validStockShipmentReceiptUpdate(businessId, branchId))
  || (collectionName == 'products' && linkedProductStockReduction(businessId, branchId, recordId))
  || (collectionName == 'stockBatches' && linkedBatchStockReduction(businessId, branchId, recordId));

allow delete: if isOwner(businessId)
  && collectionName != 'auditEvents'
  && collectionName != 'branchFinanceReconciliations';
```

Default `allow get/list` မှာ `isOwner(businessId)` သာ `branchFinanceReconciliations` ကို ခွင့်ပြုရမည်။ Cashier allow-list ထဲသို့ ဒီ Collection ကို မထည့်ပါနှင့်။

## သတိပြုရန်

1. Production Rules တစ်ခုလုံးကို ဒီ Snippet နဲ့ အစားမထိုးပါနှင့်။ မူလ Rules ကို Backup ထုတ်ပါ။
2. Existing Owner UID, Business ID, Cashier Membership, Shipment, POS Sale, Expense Rules ကို မပြောင်းပါနှင့်။
3. Test Project သို့မဟုတ် Emulator တွင် Owner Create/Read အောင်မြင်ပြီး Owner Update/Delete နှင့် Cashier Read/Create ပယ်ချကြောင်း စမ်းသပ်ပြီးမှ Publish လုပ်ပါ။
4. Rules သည် Client UI ထက် အရေးကြီးသည်။ Button မပြသခြင်းတစ်ခုတည်းကို Security အဖြစ် မယူဆပါနှင့်။
