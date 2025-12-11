/**
 * resetSession.ts
 * 
 * Clean, safe reset of ONLY runtime session state.
 * No quant logic, sizing logic, or decision-making is changed.
 * This is a runtime memory wipe that restores the engine to a "fresh start" state.
 */

export interface SessionRuntimeState {
  openPositions: any[];
  closedPositions: any[];
  tradeHistory: any[];
  stats: {
    wins: number;
    losses: number;
    totalTrades: number;
    realisedPnl: number;
    maxDrawdown: number;
  };
  lastSignal: any | null;
  lastAction: any | null;
  lastModeSwitch: string | null;
  warmStart: boolean;
  sessionPhase: string;
  freezeGuard: boolean;
  ddLock: boolean;
  tpLock: boolean;
  cycleCount: number;
  symbolCache: Record<string, any>;
  isRunning: boolean;
}

export interface ResetSessionOptions {
  autoRestart?: boolean;
}

// Module-level runtime state
let runtimeState: SessionRuntimeState = getInitialSessionState();

// Active interval reference for tick loops
let activeTickInterval: NodeJS.Timeout | null = null;

/**
 * Get fresh initial session state
 */
export function getInitialSessionState(): SessionRuntimeState {
  return {
    openPositions: [],
    closedPositions: [],
    tradeHistory: [],
    stats: {
      wins: 0,
      losses: 0,
      totalTrades: 0,
      realisedPnl: 0,
      maxDrawdown: 0,
    },
    lastSignal: null,
    lastAction: null,
    lastModeSwitch: null,
    warmStart: true,
    sessionPhase: 'idle',
    freezeGuard: false,
    ddLock: false,
    tpLock: false,
    cycleCount: 0,
    symbolCache: {},
    isRunning: false,
  };
}

/**
 * Get current runtime state (read-only access)
 */
export function getSessionRuntimeState(): Readonly<SessionRuntimeState> {
  return { ...runtimeState };
}

/**
 * Set the active tick interval reference
 */
export function setActiveTickInterval(interval: NodeJS.Timeout | null): void {
  activeTickInterval = interval;
}

/**
 * Stop any active loop intervals
 */
export function stopActiveIntervals(): void {
  if (activeTickInterval) {
    clearInterval(activeTickInterval);
    activeTickInterval = null;
  }
}

/**
 * Reset session state - clears runtime-only variables
 * Does NOT modify: startingBalance, equity baseline, any core logic fields
 * 
 * @param currentState - Current runtime state (optional, uses module state if not provided)
 * @param options - Reset options
 * @returns Fresh session state
 */
export function resetSessionState(
  currentState?: Partial<SessionRuntimeState>,
  options?: ResetSessionOptions
): SessionRuntimeState {
  const autoRestart = options?.autoRestart === true;

  // Stop any active intervals first
  stopActiveIntervals();

  // Create fresh state
  const freshState: SessionRuntimeState = {
    // Clear runtime-only variables
    openPositions: [],
    closedPositions: [],
    tradeHistory: [],
    stats: {
      wins: 0,
      losses: 0,
      totalTrades: 0,
      realisedPnl: 0,
      maxDrawdown: 0,
    },
    lastSignal: null,
    lastAction: null,
    lastModeSwitch: null,
    warmStart: true, // Reset warm start for fresh cycle
    sessionPhase: autoRestart ? 'running' : 'idle',
    freezeGuard: false,
    ddLock: false,
    tpLock: false,
    cycleCount: 0,
    symbolCache: {},
    isRunning: autoRestart,
  };

  // Update module-level state
  runtimeState = freshState;

  return freshState;
}

/**
 * Update specific runtime state fields
 */
export function updateSessionRuntimeState(updates: Partial<SessionRuntimeState>): void {
  runtimeState = { ...runtimeState, ...updates };
}

/**
 * Session end reason types
 */
export type SessionEndReason = 
  | 'auto_tp'
  | 'manual_reset'
  | 'max_loss'
  | 'manual_stop'
  | 'risk_guard'
  | 'error';

/**
 * Handle session end event and reset appropriately
 * 
 * @param reason - Why the session is ending
 * @param wasRunning - Whether the bot was running before (for manual_reset)
 * @returns Fresh session state with appropriate isRunning flag
 */
export function handleSessionEnd(
  reason: SessionEndReason,
  wasRunning: boolean = false
): SessionRuntimeState {
  let autoRestart = false;

  switch (reason) {
    case 'auto_tp':
      // Auto-TP: restart automatically to continue trading
      autoRestart = true;
      break;

    case 'manual_reset':
      // Manual reset: preserve previous running state
      autoRestart = wasRunning;
      break;

    case 'max_loss':
      // Max loss: full stop, no restart
      autoRestart = false;
      break;

    case 'manual_stop':
      // Manual stop: stay stopped
      autoRestart = false;
      break;

    case 'risk_guard':
      // Risk guard triggered: stay stopped
      autoRestart = false;
      break;

    case 'error':
      // Error: stay stopped
      autoRestart = false;
      break;

    default:
      autoRestart = false;
  }

  return resetSessionState(undefined, { autoRestart });
}

/**
 * Check if warm start is active (first cycle should force-fire)
 */
export function isWarmStart(): boolean {
  return runtimeState.warmStart;
}

/**
 * Consume warm start flag (called after first trade attempt)
 */
export function consumeWarmStart(): void {
  runtimeState.warmStart = false;
}

/**
 * Reset warm start flag for new cycle
 */
export function resetWarmStartFlag(): void {
  runtimeState.warmStart = true;
}
