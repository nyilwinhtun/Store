# Minimart POS v2.7.3 — App Branding Fix

## ပြင်ဆင်ချက်များ
- Browser Tab Title ကို `Minimart POS` သတ်မှတ်ထားသည်။
- PWA Install Name ကို `Minimart` သတ်မှတ်ထားသည်။
- Apple Home Screen App Name ကို `Minimart` သတ်မှတ်ထားသည်။
- App Footer Version ကို `v2.7.3` ပြောင်းထားသည်။
- Service Worker Cache Name အသစ်သုံးပြီး အဟောင်း App Shell/Manifest Cache ကို အစားထိုးစေသည်။
- Firebase Login, Business Cloud Sync, Branch Data, Shop Profile နှင့် IndexedDB Image Storage Logic မပြောင်းထားပါ။

## Mac မှာ စမ်းသပ်ရန်
1. JSON Backup တစ်ခု ထုတ်ထားပါ။
2. ZIP အသစ်ကို Folder အသစ်အဖြစ် ဖြည်ပြီး VS Code မှာ အဲဒီ Folder ကိုဖွင့်ပါ။
3. အရင် Vite Terminal ကို `Control + C` ဖြင့် ရပ်ပါ။
4. `npm install` ပြီး `npm run typecheck` နှင့် `npm run build` ကို စမ်းပါ။
5. `npm run dev -- --host --port 5173 --strictPort` ကို run လုပ်ပါ။
6. `http://localhost:5173` ကို ဖွင့်ပါ။ Browser Tab မှာ `Minimart POS` ပေါ်ရပါမယ်။

မှတ်ချက် - တူညီတဲ့ Port ကို အခြား Vite Project တစ်ခုက သုံးနေပါက Server အဟောင်းကို အရင်ပိတ်ပါ။ Browser Cache/Service Worker အဟောင်းက Title ကို ဆက်ပြနေရင် DevTools → Application → Service Workers မှာ localhost registration ကို Unregister လုပ်ပြီး Hard Reload လုပ်ပါ။ `Clear site data` မလုပ်ပါနှင့်။
