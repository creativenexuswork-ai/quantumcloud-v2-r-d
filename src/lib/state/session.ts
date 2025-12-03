import { create } from 'zustand';

export type AccountType = 'paper' | 'live';

interface SessionState {
  accountType: AccountType;
  isRunning: boolean;
  selectedSymbol: string | null;
  
  setAccountType: (type: AccountType) => void;
  setRunning: (val: boolean) => void;
  setSymbol: (sym: string | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  accountType: 'paper',
  isRunning: false,
  selectedSymbol: null,

  setAccountType: (type) => set({ accountType: type, isRunning: false }),
  setRunning: (val) => set({ isRunning: val }),
  setSymbol: (sym) => set({ selectedSymbol: sym }),
}));
