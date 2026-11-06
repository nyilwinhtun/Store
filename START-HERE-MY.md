# Minimart POS v2.9.3 — Barcode Upgrade

ဒီ Version မှာ v2.9.2 Checkout Item Details ကို ဆက်ထိန်းပြီး Product Barcode, Bluetooth HID keyboard scanning, POS barcode lookup, ကုန်ရောက် Barcode နှင့် Phone Camera Scan ထည့်သွင်းထားသည်။

## စတင်အသုံးပြုရန်

1. Owner Device တစ်ခုချင်းစီတွင် JSON Backup ထုတ်ပါ။ LocalStorage/IndexedDB မရှင်းပါနှင့်။
2. ZIP ကို Folder အသစ်အဖြစ် ဖြည်ပြီး VS Code မှာ ဖွင့်ပါ။ မိမိ `.env` ဖိုင်ကို လုံခြုံစွာ ပြန်ထည့်ပါ။
3. `npm install` လုပ်ပါ။
4. `npm run typecheck` နှင့် `npm run build` နှစ်ခုလုံး အောင်မြင်ကြောင်း စစ်ပါ။
5. `npm run dev -- --host --port 5173 --strictPort` ဖြင့် စမ်းပါ။
6. Product Form, Stock Receiving, POS တို့မှာ Barcode Scanner/Camera Scan ကို စမ်းပါ။
7. HTTPS Deployment မှာ Phone Camera Permission Allow လုပ်ပါ။

အသေးစိတ်: `V2.9.3-BARCODE-AND-CAMERA-SCAN-MY.md`
