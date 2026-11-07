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
  canReceiveStock: boolean;
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
  canReceiveStock: false,
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

export function canUsePage(role: BusinessRole | null, page: string, canReceiveStock = false): boolean {
  if (role !== 'cashier') return true;
  // Limited Cashier: POS and own sales history. A separately assigned receiver
  // can also access the receiving-only workflow for their one assigned branch.
  return ['pos', 'sales'].includes(page) || (page === 'branchReceiving' && canReceiveStock);
}

export function canAccessBranch(role: BusinessRole | null, branchIds: string[], branchId: string): boolean {
  return role !== 'cashier' || (branchIds.length === 1 && branchIds[0] === branchId);
}
