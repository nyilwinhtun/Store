# ZYWELL ZM04 — Android Direct Bluetooth Print (နောက် Phase)

လက်ရှိ v2.9.4 သည် Vite + React PWA ဖြစ်ပြီး Native Android project / Capacitor bridge / ZYWELL SDK မပါသေးပါ။ ထို့ကြောင့် Android Direct Bluetooth ESC/POS printing ကို ဒီ Version မှာ အလုပ်လုပ်ကြောင်း မဆိုနိုင်ပါ။

## အကြံပြု Architecture

React POS → Capacitor Android App → ZYWELL Android SDK / ESC-POS → ZM04 Bluetooth.

Laptop / Mac မှာ လက်ရှိ `window.print()` Browser Print ကို ဆက်ထိန်းထားမယ်။ Android Native App မှာ Bluetooth Pair / Connect၊ Printer Status၊ Test Print၊ ESC/POS Receipt Print ကို ထည့်မယ်။ Android PWA ကို Browser Print fallback အဖြစ် ဆက်ထားမယ်။

## Hardware Integration မစတင်ခင် အတည်ပြုရန်

- Printer Model: ZM04 (အသုံးပြုသူပေးသော label ဓာတ်ပုံအရ)
- Interface: USB + BT
- Paper width: 79.5 ± 0.5 mm
- Print width: 72 mm (label ဓာတ်ပုံအရ)
- Printer Bluetooth profile: စက်နဲ့ ချိတ်စမ်းပြီး SPP / BLE / vendor-specific ကို အတည်ပြုရမယ်။
- Android OS version နဲ့ Bluetooth Pairing Name ကို စစ်ရမယ်။
- ZYWELL Official Android SDK version / sample app / permission requirements ကို SDK download ထဲက README နဲ့ စစ်ရမယ်။

## Test Checklist

- [ ] Android Bluetooth Settings မှ ZM04 Pair ဖြစ်သည်။
- [ ] Native bridge က paired printer ကို enumerate / connect လုပ်နိုင်သည်။
- [ ] Test Print (English) ထွက်သည်။
- [ ] မြန်မာ Unicode Receipt ကို image/raster path နဲ့ ထုတ်နိုင်သည်။
- [ ] Receipt 80mm paper မှာ 72mm print width ထဲ fit ဖြစ်သည်။
- [ ] Item name, quantity, unit, unit price, line total, discount, total မှန်သည်။
- [ ] Printer off / out of paper / disconnected ဖြစ်ရင် error ပြသည်။
- [ ] Reconnect လုပ်နိုင်သည်။
- [ ] Print ပြီး Sale ကို ထပ်မတင်ပါ။
- [ ] Browser Print on Laptop / Mac အရင်အတိုင်း လုပ်ဆောင်သည်။

## သတိပြုရန်

Bluetooth interface ပါသည်ဟု label ပေါ်တွင် ရေးထားခြင်းတစ်ခုတည်းဖြင့် SPP ဖြစ်သည်ဟု မဆုံးဖြတ်ပါနှင့်။ Native SDK ရဲ့ connection sample နဲ့ တကယ့် Android ဖုန်း/Printer ကို စမ်းပြီးမှ implementation ကို အတည်ပြုရပါမယ်။
