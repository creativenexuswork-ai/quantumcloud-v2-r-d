import { create } from 'zustand';

// ============== Session State Types ==============
export type SessionStatus = 'idle' | 'running' | 'holding' | 'stopped' | 'error';
export type TradingMode = 'burst' | 'scalper' | 'trend';
export type AccountType = 'paper' | 'live';

export interface SessionState {
  status: SessionStatus;
  mode: TradingMode;
  accountType: AccountType;
  hasPositions: boolean;
  openCount: number;
  pnlToday: number;
  tradesToday: number;
  winRate: number;
  equity: number;
  lastError: string | null;
  halted: boolean;
  tickInFlight: boolean;
}

export interface ButtonStates {
  canActivate: boolean;
  canHold: boolean;
  canTakeProfit: boolean;
  canCloseAll: boolean;
  canChangeMode: boolean;
}

// ============== Pure Helper Functions ==============

export function getInitialSessionState(): SessionState {
  return {
    status: 'idle',
    mode: 'burst',
    accountType: 'paper',
    hasPositions: false,
    openCount: 0,
    pnlToday: 0,
    tradesToday: 0,
    winRate: 0,
    equity: 10000,
    lastError: null,
    halted: false,
    tickInFlight: false,
  };
}

export function getButtonStates(session: SessionState): ButtonStates {
  const { status, hasPositions, tickInFlight, halted } = session;
  
  return {
    // ACTIVATE: when idle, stopped, OR holding (acts as Resume from holding)
    canActivate: (status === 'idle' || status === 'stopped' || status === 'holding') && !tickInFlight && !halted,
    
    // HOLD: only when running
    canHold: status === 'running' && !tickInFlight,
    
    // TAKE PROFIT: when running or holding (closes all, goes to holding)
    canTakeProfit: (status === 'running' || status === 'holding') && !tickInFlight,
    
    // CLOSE ALL: any active state (closes all, goes to idle)
    canCloseAll: (status === 'running' || status === 'holding') && !tickInFlight,
    
    // MODE CHANGE: only when idle or stopped
    canChangeMode: status === 'idle' || status === 'stopped',
  };
}

export type SessionAction = 
  | { type: 'ACTIVATE' }
  | { type: 'HOLD' }
  | { type: 'TAKE_PROFIT' }
  | { type: 'CLOSE_ALL' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' }
  | { type: 'SET_MODE'; mode: TradingMode }
  | { type: 'SYNC_POSITIONS'; hasPositions: boolean; openCount: number }
  | { type: 'SYNC_PNL'; pnlToday: number; tradesToday: number; winRate: number; equity: number }
  | { type: 'SET_HALTED'; halted: boolean }
  | { type: 'SET_TICK_IN_FLIGHT'; tickInFlight: boolean }
  | { type: 'SYNC_STATUS'; status: SessionStatus };

export function transitionSession(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'ACTIVATE':
      // Can activate from idle, stopped, OR holding (Resume)
      if (state.status !== 'idle' && state.status !== 'stopped' && state.status !== 'holding') {
        return state;
      }
      return { ...state, status: 'running', lastError: null };
    
    case 'HOLD':
      // Only from running → holding (not a toggle)
      if (state.status === 'running') {
        return { ...state, status: 'holding' };
      }
      return state;
    
    case 'TAKE_PROFIT':
      // Close all positions, go to holding (not idle)
      return { 
        ...state, 
        status: 'holding', 
        hasPositions: false, 
        openCount: 0 
      };
    
    case 'CLOSE_ALL':
      // Close all and go to idle (full kill switch)
      return { 
        ...state, 
        status: 'idle', 
        hasPositions: false, 
        openCount: 0 
      };
    
    case 'ERROR':
      return { 
        ...state, 
        status: 'error', 
        lastError: action.error 
      };
    
    case 'RESET':
      return getInitialSessionState();
    
    case 'SET_MODE':
      // Only allow mode change when idle or stopped
      if (state.status !== 'idle' && state.status !== 'stopped') {
        return state;
      }
      return { ...state, mode: action.mode };
    
    case 'SYNC_POSITIONS':
      return { 
        ...state, 
        hasPositions: action.hasPositions, 
        openCount: action.openCount 
      };
    
    case 'SYNC_PNL':
      return { 
        ...state, 
        pnlToday: action.pnlToday,
        tradesToday: action.tradesToday,
        winRate: action.winRate,
        equity: action.equity,
      };
    
    case 'SET_HALTED':
      return { 
        ...state, 
        halted: action.halted,
        // If halted, also set to idle
        status: action.halted ? 'idle' : state.status,
      };
    
    case 'SET_TICK_IN_FLIGHT':
      return { ...state, tickInFlight: action.tickInFlight };
    
    case 'SYNC_STATUS':
      // Only sync if it's a valid backend status
      const validStatuses: SessionStatus[] = ['idle', 'running', 'holding', 'stopped', 'error'];
      if (!validStatuses.includes(action.status)) {
        return state;
      }
      return { ...state, status: action.status };
    
    default:
      return state;
  }
}

// ============== Zustand Store ==============
interface SessionStore extends SessionState {
  dispatch: (action: SessionAction) => void;
  getButtonStates: () => ButtonStates;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...getInitialSessionState(),
  
  dispatch: (action: SessionAction) => {
    set((state) => transitionSession(state, action));
  },
  
  getButtonStates: () => {
    const state = get();
    return getButtonStates(state);
  },
}));

// ============== Status Display Helpers ==============
export const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: 'IDLE',
  running: 'RUNNING',
  holding: 'HOLDING',
  stopped: 'STOPPED',
  error: 'ERROR',
};

export const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: 'text-slate-400',
  running: 'text-emerald-400',
  holding: 'text-amber-300',
  stopped: 'text-slate-400',
  error: 'text-red-400',
};
