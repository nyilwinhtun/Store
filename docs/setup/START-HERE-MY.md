# စတင်အသုံးပြုရန် — Minimart POS v3.2.1 Shared Pricing

1. မူရင်း v3.1.5၊ v3.1.6 နှင့် v3.2.0 ဖိုင်များကို မဖျက်ပါနှင့်။
2. ZIP ကို Folder အသစ်တစ်ခုထဲ Extract လုပ်ပါ။
3. Production Data မဟုတ်သော Test Firebase Project သို့မဟုတ် Local Test Data ဖြင့်သာ စတင်ပါ။
4. Owner JSON Backup နှင့် Firestore Export ယူပါ။
5. `npm install` ပြီး `npm run typecheck` နှင့် `npm run build` စမ်းပါ။
6. `npm run dev` ဖြင့် App ကို ဖွင့်ပါ။ Owner Account ဖြင့် Login ဝင်ပါ။
7. Active Branch ၂ ခုအထက်ရှိလျှင် Sidebar မှ `မျှဝေဈေးနှုန်း` ကို ဖွင့်ပါ။
8. Branch ၂ ခုမှ တူညီသော Product တစ်မျိုးစီရွေးပြီး Price Group ဖန်တီးပါ။
9. Product စာရင်း၊ Stock၊ Cost Price နှင့် Batch များ Branch သီးခြားဖြစ်နေကြောင်း စစ်ပါ။
10. Group ဈေးနှုန်းပြောင်းပါ။ Linked Product များအားလုံး Update ဖြစ်ကြောင်း၊ Sale အဟောင်း၏ Unit Price မပြောင်းကြောင်း စစ်ပါ။
11. Stock Receipt နဲ့ Branch Shipment အတည်ပြုမှုက Shared Retail / Wholesale ဈေးကို မပြောင်းစေကြောင်း စမ်းပါ။
12. Product ကို Delete မလုပ်မီ Shared Price Group မှ Unlink လုပ်ရန် စမ်းပါ။
13. Cashier Login ဖြင့် Price Group Page မမြင်ရကြောင်းနှင့် Branch Product Mirror Price ကိုသာ အသုံးပြုကြောင်း စမ်းပါ။
14. `V3.2.1-TEST-PLAN-MY.md` နှင့် `V3.2.1-SHARED-PRICING-MY.md` ကို အပြည့်အစုံ လိုက်နာပါ။

Production Firestore Rules ကို Emulator Test မအောင်မြင်မီ Deploy မလုပ်ပါနှင့်။ ဒီ Build သည် Candidate ဖြစ်ပြီး Live Firebase ကို စမ်းသပ်ထားခြင်း မရှိပါ။
