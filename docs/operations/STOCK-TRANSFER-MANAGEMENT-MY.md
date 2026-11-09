# v2.7.5 — Stock Transfer Management Test Guide

## 1. Transfer History

History Table တွင် အောက်ပါတို့ ပါဝင်သည်။
- Transfer Date / Transfer No.
- Source Branch / Destination Branch
- Product / Quantity / Unit
- Source နှင့် Destination Stock Before → After
- Initiated By (Name / Email)
- Status: Completed / Reversed
- Reversal Note နှင့် ပြန်လှန်သူ

## 2. Duplicate Submit Protection

Transfer Form က တစ်ကြိမ်စီ Request ID တစ်ခု သုံးသည်။ Submit ခလုတ်ကို နှစ်ခါနှိပ်မိလျှင် UI Lock က တစ်ပြိုင်နက် Submit မဖြစ်စေပါ။ အလားတူ Request ID ကို Store က ပြန်တွေ့လျှင် အရင် Transfer ကိုသာ ပြန်ပေးပြီး Stock ထပ်မပြောင်းပါ။

## 3. Owner Reversal

Reversal ကို Owner PIN ဖြင့်သာ UI မှ လုပ်နိုင်သည်။ Reversal Reason ကို မဖြစ်မနေ ဖြည့်ရမည်။

အောင်မြင်သော Reversal တွင်—
- Source Product Stock ကို မူလပမာဏအတိုင်း ပြန်တိုးသည်။
- Destination Product Stock ကို လွှဲပေးခဲ့သည့် ပမာဏအတိုင်း ပြန်လျှော့သည်။
- Destination ထဲက မူလ Transfer က ဖန်တီးထားသော Batch ID များကိုသာ လျှော့သည်။
- Source ထဲက မူလ Batch ID များထဲကို Quantity, Cost, Expiry ကို ထိန်းသိမ်းပြီး ပြန်ထည့်သည်။
- Transfer Status ကို `reversed` ပြောင်းပြီး Reversed At / By / Reason သိမ်းသည်။
- Source နှင့် Destination နှစ်ဆိုင်လုံး Activity Log ရေးသည်။

## 4. Reversal Refusal Rules

အောက်ပါအခြေအနေများမှာ Reversal မလုပ်ပါ။
- Transfer မတွေ့ပါ။
- Transfer ကို ပြန်လှန်ပြီးသားဖြစ်သည်။
- Transfer မှတ်တမ်းမှာ Stock Before/After Snapshot သို့ Batch Allocation မပြည့်စုံပါ။
- Source သို့မဟုတ် Destination Product မရှိတော့ပါ။
- Destination Stock မလုံလောက်ပါ။
- မူလ Transfer က ပို့ထားသော Destination Batch မတွေ့တော့ပါ။
- အဲဒီ Batch ထဲက Quantity တစ်စိတ်တစ်ပိုင်း ရောင်းပြီး/ပြင်ပြီး/ထပ်လွှဲပြီး ဖြစ်နေသည်။
- Batch စာရင်းနှင့် Product Stock ကိုက်ညီမှု မရှိပါ။

ဒီကန့်သတ်ချက်က လွှဲပို့ထားတဲ့ ပစ္စည်းမကျန်တော့တဲ့အခါ အခြားကုန်ကို မှားယွင်းနုတ်မိခြင်းမှ ကာကွယ်ရန် ဖြစ်သည်။

## 5. Cloud Sync

Cloud Sync သည် Manual အတိုင်း ဆက်လက်လုပ်ဆောင်သည်။ Transfer/Reversal ပြီးနောက် Owner က Sync Changes လုပ်ပါ။ နောက် Device က Cloud Download သို့မဟုတ် Sync Changes လုပ်ပြီး Transfer History နဲ့ Branch Stock ကို စစ်ပါ။ တခြား Device မှာ Sync မလုပ်ရသေးတဲ့ လက်ကျန်အပြောင်းအလဲရှိနေချိန် Reversal မလုပ်ပါနှင့်။

## 6. Legacy Transfer Records

v2.7.4 မတိုင်မီ Transfer Records အချို့မှာ Balance Snapshot မရှိနိုင်ပါ။ အဲဒီ records များကို History မှာ ဖော်ပြပေမဲ့ Reversal Button မပေးပါ။ အဲဒီမှတ်တမ်းအတွက် လက်ရှိ Stock ကို ကိုယ်တိုင်စစ်ပြီးမှ Stock Adjustment သို့မဟုတ် အခြားပြင်ဆင်မှု လုပ်သင့်သည်။
