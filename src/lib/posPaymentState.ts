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

/** Strip IEEE-754 binary noise from decimal-quantity line totals without altering real fractions. */
export function cleanCurrencyAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

/** Whole-kyat cash required to cover checkoutTotal without failing strict server `< total` checks. */
export function requiredCashForTotal(checkoutTotal: number): number {
  const clean = cleanCurrencyAmount(checkoutTotal);
  if (clean <= 0) return 0;
  return Math.max(0, Math.ceil(clean - 1e-6));
}

export function computeCashPaymentState(
  paymentMethod: PosPaymentMethod,
  checkoutTotal: number,
  cashReceivedInput: string,
): {
  cashReceivedValue: number;
  requiredCash: number;
  cashShortfall: number;
  cashChange: number;
} {
  const cashReceivedValue = Math.max(0, Math.floor(Number(cashReceivedInput) || 0));
  const requiredCash = requiredCashForTotal(checkoutTotal);
  if (paymentMethod !== 'Cash') {
    return { cashReceivedValue, requiredCash, cashShortfall: 0, cashChange: 0 };
  }
  const cashShortfall = Math.max(0, requiredCash - cashReceivedValue);
  const cashChange = Math.max(0, Math.round(cashReceivedValue - cleanCurrencyAmount(checkoutTotal)));
  return { cashReceivedValue, requiredCash, cashShortfall, cashChange };
}
