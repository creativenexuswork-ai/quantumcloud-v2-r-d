import { create } from 'zustand';

// ============== Session State Types ==============
export type SessionStatus = 'idle' | 'running' | 'holding' | 'stopped' | 'error';
export type TradingMode = 'burst' | 'scalper' | 'trend';
export type AccountType = 'paper' | 'live';

// pendingAction is set ONLY during explicit user actions, NOT during polling
export type PendingAction = 'activate' | 'hold' | 'takeProfit' | 'closeAll' | null;

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
  // pendingAction: set only during user-initiated transitions (not polling)
  pendingAction: PendingAction;
}

export interface ButtonStates {
  canActivate: boolean;
  canHold: boolean;
  canTakeProfit: boolean;
  canCloseAll: boolean;
  canChangeMode: boolean;
  showSpinner: boolean;
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
    pendingAction: null,
  };
}

export function getButtonStates(session: SessionState): ButtonStates {
  const { status, hasPositions, pendingAction, halted, openCount } = session;
  
  // Spinner shows ONLY during the specific pending action (not blocking everything)
  const showSpinner = pendingAction !== null;
  
  // Buttons are individually disabled based on state + whether THEY are pending
  const isActivatePending = pendingAction === 'activate';
  const isHoldPending = pendingAction === 'hold';
  const isTakeProfitPending = pendingAction === 'takeProfit';
  const isCloseAllPending = pendingAction === 'closeAll';
  
  return {
    // ACTIVATE: when idle, stopped, OR holding (acts as Resume from holding)
    // Only disabled if THIS action is pending, or halted
    canActivate: (status === 'idle' || status === 'stopped' || status === 'holding') && !isActivatePending && !halted,
    
    // HOLD: only when running, only disabled if THIS action is pending
    canHold: status === 'running' && !isHoldPending,
    
    // TAKE PROFIT: when running or holding AND has positions
    // Only disabled if THIS action is pending
    canTakeProfit: (status === 'running' || status === 'holding') && !isTakeProfitPending && (hasPositions || openCount > 0),
    
    // CLOSE ALL: any active state (closes all, goes to idle)
    // Only disabled if THIS action is pending
    canCloseAll: (status === 'running' || status === 'holding') && !isCloseAllPending,
    
    // MODE CHANGE: only when idle or stopped
    canChangeMode: status === 'idle' || status === 'stopped',
    
    // Spinner shows ONLY during user-initiated actions
    showSpinner,
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
  | { type: 'SET_PENDING_ACTION'; pendingAction: PendingAction }
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
      // Close all positions, stay running (auto-resume from flat state)
      // User must explicitly press HOLD to pause - TP just banks profits
      return { 
        ...state, 
        hasPositions: false, 
        openCount: 0 
        // status stays the same - 'running' continues running
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
        // If halted, also set to idle and clear pending action
        status: action.halted ? 'idle' : state.status,
        pendingAction: action.halted ? null : state.pendingAction,
      };
    
    case 'SET_PENDING_ACTION':
      return { ...state, pendingAction: action.pendingAction };
    
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
