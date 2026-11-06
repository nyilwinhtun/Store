import { create } from 'zustand';
import { firebaseAuth } from './firebase';

export type BusinessRole = 'owner' | 'cashier';
export type BusinessAccessStatus = 'local' | 'loading' | 'unassigned' | 'active' | 'disabled' | 'error';

export type BusinessAccessState = {
  status: BusinessAccessStatus;
  uid: string;
  email: string;
  displayName: string;
  role: BusinessRole | null;
  branchIds: string[];
  message: string;
  setAccess: (value: Partial<Omit<BusinessAccessState, 'setAccess' | 'resetAccess'>>) => void;
  resetAccess: () => void;
};

const localAccess = {
  status: 'local' as BusinessAccessStatus,
  uid: '',
  email: '',
  displayName: '',
  role: null as BusinessRole | null,
  branchIds: [] as string[],
  message: '',
};

// When Firebase is configured, block the first render until the persisted Auth
// session and its Business membership have been resolved.
const initialAccess = firebaseAuth
  ? { ...localAccess, status: 'loading' as BusinessAccessStatus, message: 'Firebase Session ကို စစ်ဆေးနေပါတယ်။' }
  : localAccess;

export const useBusinessAccess = create<BusinessAccessState>((set) => ({
  ...initialAccess,
  setAccess: (value) => set((state) => ({ ...state, ...value })),
  resetAccess: () => set(localAccess),
}));

export function canUsePage(role: BusinessRole | null, page: string): boolean {
  if (role !== 'cashier') return true;
  return ['dashboard', 'pos', 'sales', 'cash'].includes(page);
}

export function canAccessBranch(role: BusinessRole | null, branchIds: string[], branchId: string): boolean {
  return role !== 'cashier' || branchIds.includes(branchId);
}
