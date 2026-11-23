export type KpayAccountSettings = {
  kpayEnabled?: boolean;
  kpayAccountName?: string;
  kpayAccountNumber?: string;
} | null | undefined;

// Legacy branches have no kpayEnabled flag; an account that has both a name and
// a number stays selectable at checkout until the Owner explicitly disables it.
export function isKpayEnabled(settings: KpayAccountSettings): boolean {
  if (!settings?.kpayAccountName?.trim() || !settings.kpayAccountNumber?.trim()) return false;
  return settings.kpayEnabled !== false;
}
