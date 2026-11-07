import { doc, runTransaction } from 'firebase/firestore';
import { FIREBASE_BUSINESS_ID, firestore } from './firebase';
import { recordFirestoreActivity } from './firestoreDiagnostics';
import type { BranchShipmentReceiptInput } from '../store/usePosStore';

type SubmitReceiptInput = {
  branchId: string;
  shipmentId: string;
  uid: string;
  email?: string;
  name?: string;
  receivedItems: BranchShipmentReceiptInput[];
  note?: string;
};

/**
 * Receiver-only acknowledgement. It never changes Product or Stock records.
 * Owner approval is the only step that adds destination stock.
 */
export async function submitBranchShipmentReceipt(input: SubmitReceiptInput): Promise<void> {
  if (!firestore) throw new Error('Firebase Firestore ကို မချိတ်ဆက်ထားပါ။');
  if (!input.uid || !input.branchId || !input.shipmentId) throw new Error('လက်ခံသူ UID / Branch / Shipment ID မပြည့်စုံပါ။');
  if (!Array.isArray(input.receivedItems) || input.receivedItems.length === 0) throw new Error('လက်ခံရရှိသော ပစ္စည်းစာရင်း မရှိပါ။');

  const shipmentRef = doc(firestore, 'businesses', FIREBASE_BUSINESS_ID, 'branches', input.branchId, 'stockShipments', input.shipmentId);
  const receivedAt = new Date().toISOString();
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(shipmentRef);
    if (!snapshot.exists()) throw new Error('ဒီကုန်ပို့စာရင်းကို Cloud မှ မတွေ့ပါ။');
    const current = snapshot.data();
    const payload = current.payload && typeof current.payload === 'object' ? current.payload as Record<string, unknown> : null;
    if (!payload || current.kind !== 'stockShipments' || current.branchId !== input.branchId) throw new Error('ကုန်ပို့စာရင်း၏ Branch သို့မဟုတ် Data ပုံစံ မကိုက်ညီပါ။');
    if (payload.status !== 'dispatched') throw new Error('ဒီကုန်ပို့စာရင်းကို လက်ခံပြီးသား သို့မဟုတ် ပိတ်သိမ်းပြီးသား ဖြစ်နေပါတယ်။');
    if (payload.toBranchId !== input.branchId || !Array.isArray(payload.items) || payload.items.length !== input.receivedItems.length) {
      throw new Error('ပို့ထားသော ပစ္စည်းစာရင်းနဲ့ လက်ခံစာရင်း အရေအတွက် မကိုက်ညီပါ။');
    }

    const sourceIds = new Set((payload.items as Array<Record<string, unknown>>).map((item) => String(item.sourceProductId || '')));
    const seen = new Set<string>();
    const normalized = input.receivedItems.map((entry) => {
      const sourceProductId = String(entry.sourceProductId || '');
      const receivedQuantity = Number(entry.receivedQuantity);
      const damagedQuantity = Number(entry.damagedQuantity);
      if (!sourceIds.has(sourceProductId) || seen.has(sourceProductId)) throw new Error('လက်ခံစာရင်းထဲတွင် မသက်ဆိုင်သော သို့မဟုတ် ထပ်နေသော ပစ္စည်းရှိပါတယ်။');
      if (!Number.isFinite(receivedQuantity) || !Number.isFinite(damagedQuantity) || receivedQuantity < 0 || damagedQuantity < 0 || damagedQuantity > receivedQuantity) {
        throw new Error('လက်ခံရရှိမှု သို့မဟုတ် ပျက်စီးမှု အရေအတွက် မမှန်ကန်ပါ။');
      }
      const shipped = (payload.items as Array<Record<string, unknown>>).find((item) => item.sourceProductId === sourceProductId);
      const max = Number(shipped?.quantity) || 0;
      if (receivedQuantity > max || damagedQuantity > max) throw new Error('လက်ခံရရှိသည့် အရေအတွက်သည် ပို့ထားသည့်အရေအတွက်ထက် မပိုရပါ။');
      seen.add(sourceProductId);
      return { sourceProductId, receivedQuantity, damagedQuantity, note: String(entry.note || '').trim() };
    });
    if (seen.size !== sourceIds.size) throw new Error('ပို့ထားသော ပစ္စည်းအားလုံးအတွက် လက်ခံစာရင်း ဖြည့်ပါ။');

    transaction.update(shipmentRef, {
      payload: {
        ...payload,
        status: 'received',
        receivedItems: normalized,
        receivedAt,
        receivedByUid: input.uid,
        receivedByEmail: input.email || '',
        receivedByName: input.name || input.email || 'Stock Receiver',
        receiverNote: String(input.note || '').trim(),
      },
      updatedAt: receivedAt,
      updatedBy: input.uid,
    });
  });
  recordFirestoreActivity(input.uid, 'read', 'stock-shipment-receipt-transaction', 1);
  recordFirestoreActivity(input.uid, 'write', 'stock-shipment-receipt', 1);
}
