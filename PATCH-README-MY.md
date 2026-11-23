# Minimart POS v3.2.6 — Code Update 01 (Barcode Intake)

ဒီ ZIP သည် **Source Code Patch** ဖြစ်ပြီး Full Project ZIP မဟုတ်ပါ။

## ထည့်သွင်းနည်း (GitHub Desktop workflow)
1. GitHub Desktop တွင် `main` branch ကိုရွေးပြီး `Fetch origin` ပြီး `Pull origin` လုပ်ပါ။
2. `main` မှ branch အသစ် `feature/v3.2.6-pos-hardware-integration` ကို ဖန်တီးပါ။
3. ဒီ ZIP ကို Extract လုပ်ပါ။ Extract လုပ်ထားတဲ့ `Store/` folder အတွင်းက ဖိုင်တွေကို သင့်လက်ရှိ Project `Store/` folder အတွင်း တူညီတဲ့ path နေရာများသို့ copy လုပ်ပါ။
4. ဖိုင် ၆ ခုကိုသာ Replace / Add လုပ်ပါ။ အခြား Project ဖိုင်များကို အစားမထိုးပါနှင့်။
5. GitHub Desktop တွင် Changes စာရင်းကိုစစ်ပြီး Screenshot ပို့ပါ။ အဲဒီအချိန်မှာ Commit/Push မလုပ်သေးပါနှင့်။

## ဒီ Patch မှာ ပါဝင်တဲ့ ဖိုင်များ
- `Store/src/components/StockReceivingPage.tsx`
- `Store/src/components/StockUnitRegistrationPage.tsx`
- `Store/src/store/usePosStore.ts`
- `Store/docs/README.md`
- `Store/docs/releases/V3.2.6-CODE-UPDATE-01-BARCODE-INTAKE-MY.md`
- `Store/docs/test-plans/V3.2.6-BARCODE-INTAKE-TEST-PLAN-MY.md`

## ပြင်ဆင်ထားသောအရာ
- Stock Receiving မှာ Bluetooth / USB HID Scanner က Scan + Enter ပို့လျှင် Barcode သို့မဟုတ် SKU ကိုရှာပြီး Product အမည် / Unit ဖြည့်ပေးခြင်း။
- Camera Scan နဲ့ HID Scan ကို တူညီတဲ့ Product lookup logic သုံးစေခြင်း။
- SKU နဲ့ Barcode မတူတဲ့ Product ကို SKU ဖြင့် ရှာတဲ့အခါ မူရင်း Product Barcode ကို မဖျက်/မပြောင်းစေခြင်း။
- Unit Sticker Registry page မှာ ရှိပြီးသား Stock Unit တွေကို Barcode နဲ့ link လုပ်တာဖြစ်ပြီး Product Stock Qty မတိုးကြောင်း စာသားမှန်ကန်အောင်ပြင်ခြင်း။

## မပါဝင်သေးသောအရာ
- Unit Sticker Barcode ကို POS Sale နဲ့ Atomic Cloud Transaction ဖြင့် ချိတ်ဆက်ခြင်း။
- ZYWELL ZM04 Android Native Bluetooth Printer။
- Capacitor Android package / iOS, Windows, Mac native printer bridge။

## QA အခြေအနေ
ပြင်ထားသော TSX ဖိုင် ၃ ခုကို TypeScript transpile syntax validation ဖြင့် စစ်ပြီး အောင်မြင်ခဲ့သည်။ Full project `npm run qa` ကို မပြေးနိုင်သေးပါ — ZIP ထဲတွင် node_modules မပါဝင်ဘဲ environment Node.js 22.16 ဖြစ်ပြီး Project က Node.js >=24.12 ကိုလိုအပ်သည်။ GitHub Actions PR QA ဖြင့် အပြည့်အဝစစ်ဆေးရန်လိုသည်။

Firebase Production Rules, Functions, Authentication, API Config, Database နှင့် ရှိပြီးသား Data ကို မပြောင်းလဲထားပါ။
