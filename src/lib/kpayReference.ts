export type KpayReferenceIssue = 'empty' | 'too-short' | 'invalid-format' | 'too-long' | 'no-digit';

export interface KpayReferenceCheck {
  ok: boolean;
  value: string;
  issue: KpayReferenceIssue | null;
  message: string;
}

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MIN_ALPHANUMERIC = 4;
const MAX_REFERENCE_LENGTH = 120;

export function normalizeKpayReference(raw: string | null | undefined): string {
  return (raw ?? '').trim();
}

export function checkKpayReference(raw: string | null | undefined): KpayReferenceCheck {
  const value = normalizeKpayReference(raw);
  if (!value) {
    return { ok: false, value, issue: 'empty', message: 'KPay ငွေလွှဲ Transaction ID ဖြည့်ပါ။' };
  }
  if (value.length > MAX_REFERENCE_LENGTH) {
    return { ok: false, value, issue: 'too-long', message: `Transaction ID သည် စာလုံး ${MAX_REFERENCE_LENGTH} လုံးထက် မကျော်ရပါ။` };
  }
  if (!REFERENCE_PATTERN.test(value)) {
    return { ok: false, value, issue: 'invalid-format', message: 'Transaction ID တွင် စာလုံး၊ ဂဏန်း နှင့် - _ . သာ ပါဝင်နိုင်ပါတယ်။' };
  }
  const alphanumeric = value.match(/[A-Za-z0-9]/g) ?? [];
  if (alphanumeric.length < MIN_ALPHANUMERIC) {
    return { ok: false, value, issue: 'too-short', message: `Transaction ID တွင် စာလုံး/ဂဏန်း အနည်းဆုံး ${MIN_ALPHANUMERIC} လုံး ပါရပါမယ်။` };
  }
  if (!/\d/.test(value)) {
    return { ok: false, value, issue: 'no-digit', message: 'Transaction ID တွင် အနည်းဆုံး ဂဏန်း ၁ လုံး ပါရပါမယ်။' };
  }
  return { ok: true, value, issue: null, message: '' };
}
