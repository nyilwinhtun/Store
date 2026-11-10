# GitHub Desktop — Minimart POS Quick Push (မြန်မာ)

## One-time setup

1. GitHub Desktop မှာ `Settings → Accounts` ကိုဖွင့်ပါ။ `nyilwinhtun/Store` ကို Push လုပ်ခွင့်ရှိတဲ့ GitHub account နဲ့ Sign in ဝင်ထားပါ။
2. `File → Add Local Repository` ကိုရွေးပြီး မူလ repository folder ကိုရွေးပါ။ ဥပမာ Mac မှာ `~/Documents/GitHub/Store` ဖြစ်သည်။
3. `Repository → Repository Settings → Remote` ထဲမှာ `origin` သည် `https://github.com/nyilwinhtun/Store.git` ဖြစ်ကြောင်း စစ်ပါ။
4. `Fetch origin` နှိပ်ပါ။ မူလ repository ကို `git init` အသစ်မလုပ်ပါနှင့်။

## Every update

1. `Fetch origin` → လိုအပ်လျှင် `Pull origin`.
2. `Current Branch` → `main` မှ feature branch အသစ်ဖန်တီးပါ။ ဥပမာ `feature/v3.2.6-barcode-receipt-android`.
3. Code ပြင်ပြီးနောက် `Changes` tab မှ ပြောင်းထားသောဖိုင်များကို စစ်ပါ။ `.env`, signing keys, `local.properties`, `node_modules`, `dist`, generated `android/app/build` များ မပါစေရ။
4. Summary ရေးပြီး `Commit to feature/...` နှိပ်ပါ။
5. `Push origin` / `Publish branch` နှိပ်ပါ။
6. GitHub မှ Pull Request ဖွင့်ပါ။ Actions QA အောင်မြင်မှ `main` သို့ Merge လုပ်ပါ။

## Common error quick checks

- `Authentication failed` / permission denied: GitHub Desktop Accounts ထဲက account နှင့် repository owner access ကို စစ်ပါ။
- `Not a git repository`: ZIP extract folder မဟုတ်ဘဲ `.git` ပါဝင်သော မူလ repository folder ကို Add Local Repository လုပ်ပါ။
- `Rejected / non-fast-forward`: `Fetch origin` ပြီး `Pull origin` လုပ်ကာ conflict စစ်ပါ။ Force push မလုပ်ပါနှင့်။
- Files အများကြီးပေါ်လာခြင်း: `.gitignore` နှင့် ဖွင့်ထားသော repository root ကို စစ်ပါ။ `node_modules`, `dist`, generated build files မတင်ပါနှင့်။
- Conflict ဖြစ်လျှင် မသိဘဲ `ours/theirs` အားလုံးကို မရွေးပါနှင့်။ လက်ရှိအလုပ်လုပ်နေသော Firebase/App code ကို မဖျက်ပါနှင့်။

## Safety

- မူလ `main` ကို တိုက်ရိုက် commit မလုပ်ပါနှင့်။
- `git init`, `git push --force`, `git reset --hard`, `git clean -fd` မလုပ်ပါနှင့်။
- Firebase Production Rules/Functions deployment သည် GitHub Push/Merge နဲ့ မတူပါ။ သီးခြား QA နှင့် အတည်ပြုချက် လိုအပ်သည်။
