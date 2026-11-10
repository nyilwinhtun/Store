#!/usr/bin/env python3
"""Safely align v3.2.5 shipment receipt UI/types with current Firestore Rules.

Run from the root of the Store repository on a dedicated fix/v3.2.5-* branch.
All source changes are validated in memory first; original files are backed up
before any write. This patch removes the incomplete receiver auto-complete path
and keeps the existing receiver receipt -> Owner Review -> Owner approval flow.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd()
BACKUP = ROOT / ".v3.2.5-hotfix-backup"


def die(message: str) -> None:
    raise RuntimeError(message)


def read(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file():
        die(f"ဖိုင်မတွေ့ပါ: {relative}. Store Repository root မှာ run လုပ်ထားပါ။")
    return path.read_text(encoding="utf-8")


def sub_once(pattern: str, replacement: str, value: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, value, count=1, flags=flags)
    if count != 1:
        die(f"{label}: သက်ဆိုင်ရာ code block တစ်ခုတည်းကို မတွေ့ပါ (matches={count})။ မူရင်းဖိုင်များ မပြောင်းထားပါ။")
    return updated


def backup_and_write(changes: dict[str, str]) -> None:
    # Write every backup before modifying the first source file.
    for relative in changes:
        source = ROOT / relative
        if source.exists():
            backup = BACKUP / relative
            backup.parent.mkdir(parents=True, exist_ok=True)
            if not backup.exists():
                backup.write_bytes(source.read_bytes())
    # Stage all replacements first, then atomically replace each file.
    staged: list[tuple[Path, Path]] = []
    for relative, content in changes.items():
        target = ROOT / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(target.name + ".v325-hotfix-tmp")
        temp.write_text(content, encoding="utf-8", newline="")
        staged.append((temp, target))
    for temp, target in staged:
        temp.replace(target)


def main() -> int:
    package = json.loads(read("package.json"))
    if package.get("version") != "3.2.5":
        die(f"ဒီ Patch က v3.2.5 အတွက်ပါ။ လက်ရှိ version={package.get('version')!r}")

    try:
        branch = subprocess.check_output(["git", "branch", "--show-current"], text=True, cwd=ROOT).strip()
    except Exception as exc:
        die(f"Git branch ကို မစစ်နိုင်ပါ: {exc}")
    if branch == "main" or not branch.startswith("fix/v3.2.5-"):
        die(f"လုံခြုံရေးအတွက် dedicated fix branch လိုပါတယ်။ လက်ရှိ branch={branch!r}")

    receiving_path = "src/components/BranchStockReceivingPage.tsx"
    management_path = "src/components/BranchShipmentManagementPage.tsx"
    store_path = "src/store/usePosStore.ts"
    auto_path = "src/lib/branchShipmentAutoComplete.ts"

    receiving = read(receiving_path)
    management = read(management_path)
    store = read(store_path)
    auto_module = ROOT / auto_path
    if not auto_module.is_file():
        die(f"မပြီးသေးတဲ့ Auto Complete module မတွေ့ပါ: {auto_path}")

    # A) Remove the helper that allowed the receiver UI to attempt a Cloud
    #    stock commit, although current Firestore Rules only authorize receipt
    #    submission. The Owner remains the only actor who approves stock-in.
    helper_start = receiving.find("function normalizedKey(")
    card_start = receiving.find("function ShipmentReceiptCard(")
    if helper_start < 0 or card_start < 0 or card_start <= helper_start:
        die("BranchStockReceivingPage.tsx ရဲ့ Auto Complete helper boundary မကိုက်ပါ။")
    receiving = receiving[:helper_start] + receiving[card_start:]

    receiving, count = re.subn(
        r"^import\s*\{[^\n]*\}\s*from\s*['\"]\.\./lib/branchShipmentAutoComplete['\"];\s*\n",
        "", receiving, count=1, flags=re.MULTILINE,
    )
    if count != 1:
        die("BranchStockReceivingPage.tsx ရဲ့ Auto Complete import မတွေ့ပါ။")

    # Do a whitespace-tolerant import member removal without changing other imports.
    qline = re.search(r"^import \{([^\n]+)\} from ['\"]\.\./lib/quantity['\"];?$", receiving, re.MULTILINE)
    if not qline or "quantityModeForProduct" not in qline.group(1):
        die("quantity import ထဲက quantityModeForProduct ကို မတွေ့ပါ။")
    members = [part.strip() for part in qline.group(1).split(",") if part.strip() and part.strip() != "quantityModeForProduct"]
    new_qline = "import { " + ", ".join(members) + " } from '../lib/quantity';"
    receiving = receiving[:qline.start()] + new_qline + receiving[qline.end():]

    # Replace the whole receive handler by the supported receipt-only flow.
    receive_start = receiving.find("  const receive = async () => {")
    summary_start = receiving.find("  const receivedSummary = shipment.receivedItems || [];", receive_start)
    if receive_start < 0 or summary_start < 0:
        die("BranchStockReceivingPage.tsx ရဲ့ receive handler boundaries မတွေ့ပါ။")
    new_receive = '''  const receive = async () => {
    if (busy || shipment.status !== 'dispatched' || !access.canReceiveStock || !access.uid || access.branchIds.length !== 1 || access.branchIds[0] !== shipment.toBranchId) return;
    const receivedItems: BranchShipmentReceiptInput[] = [];
    for (const item of shipment.items) {
      const draft = rows[item.sourceProductId];
      const receivedQuantity = Number(draft?.received);
      const damagedQuantity = Number(draft?.damaged);
      const step = item.quantityMode || item.unit;
      if (!isValidQuantity(receivedQuantity, step, true) || !isValidQuantity(damagedQuantity, step, true)
        || damagedQuantity > receivedQuantity || receivedQuantity > item.quantity) {
        notify(`${item.productName} ရဲ့ လက်ခံ/ပျက်စီး အရေအတွက်ကို ပြန်စစ်ပါ။`);
        return;
      }
      receivedItems.push({ sourceProductId: item.sourceProductId, receivedQuantity, damagedQuantity, note: draft?.note || '' });
    }
    const exactMatch = receivedItems.length === shipment.items.length && shipment.items.every((item, index) =>
      receivedItems[index]?.sourceProductId === item.sourceProductId
      && Math.abs(receivedItems[index].receivedQuantity - item.quantity) <= 0.000001
      && receivedItems[index].damagedQuantity === 0);
    const confirmMessage = exactMatch
      ? `${shipment.shipmentNo} ကို ပို့ထားတဲ့အရေအတွက်အတိုင်း အပြည့်အဝ လက်ခံရရှိကြောင်း မှတ်တမ်းတင်မလား?\\n\\nလက်ခံမှုကို Owner Review သို့ ပို့ပါမယ်။ Owner အတည်ပြုပြီးမှ Destination Stock တိုးပါမယ်။`
      : `${shipment.shipmentNo} ကို လက်ခံမှုမှတ်တမ်းတင်မလား?\\n\\nအရေအတွက်ကွာခြားမှု သို့မဟုတ် ပျက်စီးမှုရှိတဲ့အတွက် Owner Review လိုအပ်ပါတယ်။ လက်ခံမှတ်တမ်းတင်တဲ့အဆင့်မှာ Destination Stock မတိုးသေးပါ။`;
    if (!window.confirm(confirmMessage)) return;

    setBusy(true);
    const user = firebaseAuth?.currentUser;
    const actorInfo = {
      uid: access.uid,
      email: user?.email || access.email,
      name: access.displayName || user?.displayName || user?.email || 'Stock Receiver',
    };

    try {
      await submitBranchShipmentReceipt({
        branchId: shipment.toBranchId,
        shipmentId: shipment.id,
        uid: access.uid,
        email: actorInfo.email,
        name: actorInfo.name,
        receivedItems,
        note,
      });
      const localApplied = confirmLocal({ shipmentId: shipment.id, receivedItems, actor: actorInfo, note });
      if (!localApplied) {
        notify('Cloud မှ လက်ခံမှုသိမ်းပြီးပါပြီ။ ဒီ Device ရဲ့ Local Copy ကို ပြန် Sync လုပ်ရန် Refresh လုပ်ပါ။');
        return;
      }
      notify(`${shipment.shipmentNo} ကို Owner Review အတွက် လက်ခံမှတ်တမ်းတင်ပြီးပါပြီ။ Owner အတည်ပြုပြီးမှ Stock ဝင်ပါမယ်။`);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
      notify(code === 'permission-denied'
        ? 'Stock Receiver Permission မရပါ။ Owner က Team Access နဲ့ Firestore Rules ကို စစ်ဆေးပေးပါ။'
        : error instanceof Error ? error.message : 'ပစ္စည်းလက်ခံမှု မအောင်မြင်ပါ။');
    } finally {
      setBusy(false);
    }
  };

'''
    receiving = receiving[:receive_start] + new_receive + receiving[summary_start:]

    # Remove UI-only references to unsupported Auto Complete state.
    receiving = sub_once(
        r"shipment\.status === 'approved' \? \(shipment\.completionMode === 'auto' \? '[^']*' : '[^']*'\) : 'ပယ်ဖျက်'",
        "shipment.status === 'approved' ? 'Owner အတည်ပြုပြီး' : 'ပယ်ဖျက်'",
        receiving, "Receiver approved status label"
    )
    receiving = sub_once(
        r"\{shipment\.completionMode === 'auto' \? `[^`]*` : `Owner က \$\{shipment\.approvedByName \|\| 'Owner'\} မှ အတည်ပြုပြီးပါပြီ။`\}",
        "{`Owner က ${shipment.approvedByName || 'Owner'} မှ အတည်ပြုပြီးပါပြီ။`}",
        receiving, "Receiver approved status note"
    )
    receiving = receiving.replace(
        "အရေအတွက်အပြည့်၊ ပျက်စီးမှုမရှိပါက လက်ခံပြီးတာနဲ့ Auto Complete လုပ်ပါမယ်။ ကွာခြားချက်ရှိမှ Owner Review ပို့ပါမယ်။",
        "လက်ခံရရှိသည့်အရေအတွက်ကို မှတ်တမ်းတင်ပါမယ်။ Owner က စစ်ဆေးအတည်ပြုပြီးမှ Destination Stock ထဲ ဝင်ပါမယ်။"
    )
    receiving = receiving.replace(
        "အရေအတွက်အပြည့်ရပြီး ပျက်စီးမှုမရှိပါက လက်ခံပြီးချင်း Cloud ထဲမှာ Stock တိုးပြီး Auto Complete ဖြစ်ပါမယ်။ ကွာခြားချက်ရှိမှ Owner Review ပို့ပါမယ်။",
        "လက်ခံရရှိမှုကို Cloud ထဲ မှတ်တမ်းတင်ပါမယ်။ Owner က စစ်ဆေးအတည်ပြုပြီးမှ Destination Stock တိုးပါမယ်။"
    )

    # B) Align management UI with Owner-only approval.
    management = sub_once(
        r"    approved: shipment\.completionMode === 'auto'\s*\? \{ label: '[^']*', className: 'tag-success' \}\s*: \{ label: '[^']*', className: 'tag-success' \},",
        "    approved: { label: 'Owner အတည်ပြုပြီး · Stock ဝင်ပြီး', className: 'tag-success' },",
        management, "Management approved status"
    )
    management = sub_once(
        r"\{shipment\.completionMode === 'auto' \? `[^`]*` : `[^`]*`\}",
        "{`Owner အတည်ပြုပြီး ${shipment.toBranchName} Branch Stock ထဲ ထည့်သွင်းပြီးပါပြီ။ Approved by ${shipment.approvedByName || 'Owner'}.`}",
        management, "Management approved note"
    )
    management = management.replace(
        "Destination Stock က Receiver လက်ခံမှု အပြည့်ဖြစ်မှ Auto Complete ဖြစ်မယ်။ ကွာခြားချက်ရှိမှ Owner Review လုပ်ပါမယ်။",
        "Destination Stock ကို Receiver လက်ခံမှတ်တမ်းတင်ပြီး Owner အတည်ပြုပြီးမှ ထည့်သွင်းပါမယ်။"
    )

    # C) Match the real barcode registration UI value with its shared model union.
    old_union = "export type StockUnitBarcodeSource = 'manufacturer_serial' | 'app_generated';"
    if old_union not in store:
        if "export type StockUnitBarcodeSource = 'manufacturer_serial' | 'app_generated' | 'purchased_sticker';" not in store:
            die("StockUnitBarcodeSource model ကို မတွေ့ပါ။")
    else:
        store = store.replace(old_union, "export type StockUnitBarcodeSource = 'manufacturer_serial' | 'app_generated' | 'purchased_sticker';", 1)

    # Ensure the touched UI files no longer depend on the incomplete Auto Complete model.
    for label, content in [(receiving_path, receiving), (management_path, management)]:
        for token in ("completionMode", "autoCompletionPlan", "autoCompletedByUid", "branchShipmentAutoComplete", "commitBranchShipmentAutoCompleteToCloud", "BranchShipmentAutoCompleteUnknownError"):
            if token in content:
                die(f"{label} ထဲမှာ {token} reference ကျန်နေသေးပါတယ်။ မူရင်းဖိုင်များ မပြောင်းထားပါ။")

    changes = {
        receiving_path: receiving,
        management_path: management,
        store_path: store,
    }
    backup_and_write(changes)
    module_backup = BACKUP / auto_path
    module_backup.parent.mkdir(parents=True, exist_ok=True)
    if not module_backup.exists():
        module_backup.write_bytes(auto_module.read_bytes())
    auto_module.unlink()

    release_doc = ROOT / "docs/releases/V3.2.5-HOTFIX2-SHIPMENT-QA-MY.md"
    release_doc.parent.mkdir(parents=True, exist_ok=True)
    release_doc.write_text(
        "# v3.2.5 Hotfix 2 — Shipment QA Alignment\n\n"
        "- Cashier က လက်ခံရရှိမှုကိုသာ မှတ်တမ်းတင်နိုင်ပြီး Destination Stock ကို Owner Approval ပြီးမှသာ တိုးစေသည်။\n"
        "- Firestore Rules ရဲ့ လက်ရှိ Receiver permission နဲ့ မကိုက်ညီသော Auto Complete UI/Cloud path ကို ဖယ်ရှားထားသည်။\n"
        "- Purchased barcode sticker အတွက် `purchased_sticker` ကို StockUnitBarcodeSource ထဲ ထည့်ထားသည်။\n"
        "- မူရင်းဖိုင်များကို `.v3.2.5-hotfix-backup/` ထဲမှာ သိမ်းထားသည်။\n\n"
        "စမ်းသပ်ရန်: `npm run typecheck`, `npm --prefix functions run build`, `npm run test:rules`, `npm run build`, `npm run qa`။\n",
        encoding="utf-8",
    )

    print("v3.2.5 shipment QA hotfix applied.")
    print("Backups: .v3.2.5-hotfix-backup/")
    print("Updated: BranchStockReceivingPage.tsx, BranchShipmentManagementPage.tsx, usePosStore.ts")
    print("Removed: src/lib/branchShipmentAutoComplete.ts (backup retained)")
    print("Added: docs/releases/V3.2.5-HOTFIX2-SHIPMENT-QA-MY.md")
    print("Next: npm run typecheck")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"PATCH NOT APPLIED: {exc}", file=sys.stderr)
        raise SystemExit(1)
