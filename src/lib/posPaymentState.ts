import { isKpayEnabled, type KpayAccountSettings } from './kpayAccount';

export type PosPaymentMethod = 'Cash' | 'KPay' | 'Credit';
export type KpayUnavailableReason = 'not-configured' | 'disabled';

export type PaymentSelectionContext = {
  cartCount: number;
  kpaySettings: KpayAccountSettings;
};

/** Payment methods are only selectable once the cart has at least one line. */
export function isPaymentMethodSelectable(method: PosPaymentMethod, context: PaymentSelectionContext): boolean {
  if (context.cartCount < 1) return false;
  if (method === 'KPay') return isKpayEnabled(context.kpaySettings);
  return true;
}

/** Null when KPay is usable; otherwise the reason the POS must explain to the user. */
export function kpayUnavailableReason(settings: KpayAccountSettings): KpayUnavailableReason | null {
  if (isKpayEnabled(settings)) return null;
  const hasAccount = !!settings?.kpayAccountName?.trim() && !!settings.kpayAccountNumber?.trim();
  return hasAccount && settings?.kpayEnabled === false ? 'disabled' : 'not-configured';
}

export function describeKpayUnavailable(reason: KpayUnavailableReason): string {
  return reason === 'disabled'
    ? 'Owner က ဒီဆိုင်ခွဲ၏ KPay လက်ခံမှုကို ပိတ်ထားပါတယ်။'
    : 'ဒီဆိုင်ခွဲတွင် KPay Account အမည်နှင့် နံပါတ် မသတ်မှတ်ရသေးပါ။ Owner က Branch Finance တွင် ဖြည့်ရန် လိုပါတယ်။';
}
