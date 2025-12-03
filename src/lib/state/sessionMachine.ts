import { create } from 'zustand';

// ============== Session State Types ==============
export type SessionStatus = 'idle' | 'arming' | 'running' | 'holding' | 'stopped' | 'error';
export type TradingMode = 'burst' | 'scalper' | 'trend';
export type AccountType = 'paper' | 'live';

export interface SessionState {
  // Core state
  status: SessionStatus;
  mode: TradingMode;
  accountType: AccountType;
  
  // Position state
  hasPositions: boolean;
  openCount: number;
  
  // P&L
  pnlToday: number;
  pnlOverall: number;
  equity: number;
  tradesToday: number;
  winRate: number;
  
  // Error/Risk state
  lastError?: string;
  riskViolated: boolean;
  halted: boolean;
  
  // Tick state
  tickInFlight: boolean;
}

export interface SessionActions {
  // State transitions
  arm: (mode: TradingMode) => void;
  start: () => void;
  hold: () => void;
  resume: () => void;
  stop: () => void;
  closeAll: () => void;
  fail: (message: string) => void;
  reset: () => void;
  
  // State updates
  setStatus: (status: SessionStatus) => void;
  setMode: (mode: TradingMode) => void;
  setAccountType: (type: AccountType) => void;
  setRiskViolated: (flag: boolean, message?: string) => void;
  setPositionsSummary: (data: { hasPositions: boolean; openCount: number }) => void;
  setPnL: (data: { pnlToday: number; pnlOverall?: number; equity?: number; tradesToday?: number; winRate?: number }) => void;
  setHalted: (halted: boolean) => void;
  setTickInFlight: (inFlight: boolean) => void;
  
  // Sync from backend
  syncFromBackend: (data: {
    sessionStatus?: SessionStatus;
    hasPositions?: boolean;
    openCount?: number;
    pnlToday?: number;
    equity?: number;
    tradesToday?: number;
    winRate?: number;
    halted?: boolean;
  }) => void;
}

const initialState: SessionState = {
  status: 'idle',
  mode: 'burst',
  accountType: 'paper',
  hasPositions: false,
  openCount: 0,
  pnlToday: 0,
  pnlOverall: 0,
  equity: 10000,
  tradesToday: 0,
  winRate: 0,
  lastError: undefined,
  riskViolated: false,
  halted: false,
  tickInFlight: false,
};

export const useSessionMachine = create<SessionState & SessionActions>((set, get) => ({
  ...initialState,
  
  // State transitions
  arm: (mode) => {
    const { status } = get();
    if (status !== 'idle' && status !== 'stopped' && status !== 'error') return;
    set({ status: 'arming', mode, lastError: undefined, riskViolated: false });
  },
  
  start: () => {
    const { status } = get();
    if (status !== 'arming') return;
    set({ status: 'running' });
  },
  
  hold: () => {
    const { status } = get();
    if (status !== 'running') return;
    set({ status: 'holding' });
  },
  
  resume: () => {
    const { status } = get();
    if (status !== 'holding') return;
    set({ status: 'running' });
  },
  
  stop: () => {
    set({ status: 'stopped' });
  },
  
  closeAll: () => {
    set({ status: 'stopped', hasPositions: false, openCount: 0 });
  },
  
  fail: (message) => {
    set({ status: 'error', lastError: message });
  },
  
  reset: () => {
    set({ ...initialState, mode: get().mode, accountType: get().accountType });
  },
  
  // State updates
  setStatus: (status) => set({ status }),
  setMode: (mode) => set({ mode }),
  setAccountType: (type) => set({ accountType: type, status: 'idle', hasPositions: false, openCount: 0 }),
  
  setRiskViolated: (flag, message) => {
    set({ riskViolated: flag, lastError: message });
    if (flag) {
      set({ status: 'error' });
    }
  },
  
  setPositionsSummary: ({ hasPositions, openCount }) => {
    set({ hasPositions, openCount });
  },
  
  setPnL: ({ pnlToday, pnlOverall, equity, tradesToday, winRate }) => {
    set((state) => ({
      pnlToday: pnlToday ?? state.pnlToday,
      pnlOverall: pnlOverall ?? state.pnlOverall,
      equity: equity ?? state.equity,
      tradesToday: tradesToday ?? state.tradesToday,
      winRate: winRate ?? state.winRate,
    }));
  },
  
  setHalted: (halted) => {
    set({ halted });
    if (halted) {
      set({ status: 'idle', riskViolated: true, lastError: 'Daily loss limit reached' });
    }
  },
  
  setTickInFlight: (tickInFlight) => set({ tickInFlight }),
  
  // Sync from backend data
  syncFromBackend: (data) => {
    const updates: Partial<SessionState> = {};
    
    if (data.sessionStatus !== undefined) {
      // Map backend status to our status (backend uses 'idle'|'running'|'holding'|'stopped')
      const statusMap: Record<string, SessionStatus> = {
        'idle': 'idle',
        'running': 'running',
        'holding': 'holding',
        'stopped': 'stopped',
      };
      updates.status = statusMap[data.sessionStatus] || 'idle';
    }
    
    if (data.hasPositions !== undefined) updates.hasPositions = data.hasPositions;
    if (data.openCount !== undefined) updates.openCount = data.openCount;
    if (data.pnlToday !== undefined) updates.pnlToday = data.pnlToday;
    if (data.equity !== undefined) updates.equity = data.equity;
    if (data.tradesToday !== undefined) updates.tradesToday = data.tradesToday;
    if (data.winRate !== undefined) updates.winRate = data.winRate;
    if (data.halted !== undefined) {
      updates.halted = data.halted;
      if (data.halted) {
        updates.riskViolated = true;
        updates.lastError = 'Daily loss limit reached';
      }
    }
    
    set(updates);
  },
}));

// Helper hook for button enabled states
export function useSessionButtons() {
  const { status, hasPositions, tickInFlight, halted } = useSessionMachine();
  
  const canActivate = (status === 'idle' || status === 'stopped' || status === 'error') && !tickInFlight && !halted;
  const canTakeProfit = hasPositions && (status === 'running' || status === 'holding') && !tickInFlight;
  const canHold = (status === 'running' || status === 'holding') && !tickInFlight;
  const canCloseAll = hasPositions && !tickInFlight;
  const canChangeMode = status === 'idle' || status === 'stopped' || status === 'error';
  
  return {
    canActivate,
    canTakeProfit,
    canHold,
    canCloseAll,
    canChangeMode,
    isHolding: status === 'holding',
    isRunning: status === 'running',
    isArming: status === 'arming',
  };
}

// Status display helpers
export const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: 'IDLE',
  arming: 'ARMING',
  running: 'RUNNING',
  holding: 'HOLDING',
  stopped: 'STOPPED',
  error: 'ERROR',
};

export const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: 'text-muted-foreground',
  arming: 'text-warning',
  running: 'text-success',
  holding: 'text-warning',
  stopped: 'text-muted-foreground',
  error: 'text-destructive',
};
