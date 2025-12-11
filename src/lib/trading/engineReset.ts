/**
 * engineReset.ts
 * 
 * Full engine-layer reset utility.
 * Clears ALL runtime state without touching database.
 */

import { getInitialThermostatState } from './thermostat';
import { resetSessionState, resetWarmStartFlag } from './resetSession';

// ============== Module State References ==============
// These are imported so we can reset them

/**
 * Clear tick history cache from environment.ts
 * This module stores: priceHistory: Record<string, PriceTick[]>
 */
export function clearTickHistory(): void {
  // We need to expose a reset function from environment.ts
  // For now, we'll re-import and clear
  try {
    // @ts-ignore - accessing module internals
    const envModule = require('./environment');
    if (envModule._clearPriceHistory) {
      envModule._clearPriceHistory();
    }
  } catch {
    console.warn('[engineReset] Could not clear tick history');
  }
}

/**
 * Clear thermostat state from thermostat.ts
 * This module stores: previousState: ThermostatState | null
 */
export function clearThermostatState(): void {
  try {
    // @ts-ignore - accessing module internals
    const thermoModule = require('./thermostat');
    if (thermoModule._resetThermostatState) {
      thermoModule._resetThermostatState();
    }
  } catch {
    console.warn('[engineReset] Could not clear thermostat state');
  }
}

/**
 * Clear adaptive mode memory from engine.ts
 * This module stores: thermostatState, lastAdaptiveMode
 */
export function clearEngineMemory(): void {
  try {
    // @ts-ignore - accessing module internals
    const engineModule = require('./engine');
    if (engineModule._resetEngineMemory) {
      engineModule._resetEngineMemory();
    }
  } catch {
    console.warn('[engineReset] Could not clear engine memory');
  }
}

/**
 * Reset session machine state (Zustand store)
 */
export function resetSessionMachine(): void {
  try {
    const { useSessionStore } = require('@/lib/state/sessionMachine');
    const dispatch = useSessionStore.getState().dispatch;
    dispatch({ type: 'RESET' });
  } catch (e) {
    console.warn('[engineReset] Could not reset session machine:', e);
  }
}

/**
 * Reset session context (separate from machine)
 */
export function resetSessionContext(): void {
  try {
    const { useSession } = require('@/lib/state/session');
    const setStatus = useSession.getState().setStatus;
    setStatus('idle');
  } catch (e) {
    console.warn('[engineReset] Could not reset session context:', e);
  }
}

export interface FullEngineResetOptions {
  clearTicks?: boolean;
  clearThermostat?: boolean;
  clearEngine?: boolean;
  resetSession?: boolean;
  resetMachine?: boolean;
  reconnectFeed?: boolean;
}

export interface FullEngineResetResult {
  success: boolean;
  cleared: string[];
  errors: string[];
}

/**
 * Perform a full engine-layer reset
 * 
 * This clears:
 * 1. Tick history cache (price velocity trackers)
 * 2. Thermostat previous state
 * 3. Engine memory (adaptive mode, thermostat state)
 * 4. Session runtime state (positions, trades, stats, guards)
 * 5. Session machine state (Zustand)
 * 
 * Does NOT touch database - this is purely in-memory reset.
 */
export function performFullEngineReset(
  options: FullEngineResetOptions = {}
): FullEngineResetResult {
  const opts = {
    clearTicks: true,
    clearThermostat: true,
    clearEngine: true,
    resetSession: true,
    resetMachine: true,
    reconnectFeed: true,
    ...options,
  };

  const cleared: string[] = [];
  const errors: string[] = [];

  // 1. Clear tick history
  if (opts.clearTicks) {
    try {
      clearTickHistory();
      cleared.push('tickHistory');
    } catch (e) {
      errors.push(`tickHistory: ${e}`);
    }
  }

  // 2. Clear thermostat state
  if (opts.clearThermostat) {
    try {
      clearThermostatState();
      cleared.push('thermostatState');
    } catch (e) {
      errors.push(`thermostatState: ${e}`);
    }
  }

  // 3. Clear engine memory
  if (opts.clearEngine) {
    try {
      clearEngineMemory();
      cleared.push('engineMemory');
    } catch (e) {
      errors.push(`engineMemory: ${e}`);
    }
  }

  // 4. Reset session runtime state
  if (opts.resetSession) {
    try {
      resetSessionState();
      resetWarmStartFlag();
      cleared.push('sessionRuntime');
    } catch (e) {
      errors.push(`sessionRuntime: ${e}`);
    }
  }

  // 5. Reset session machine (Zustand)
  if (opts.resetMachine) {
    try {
      resetSessionMachine();
      resetSessionContext();
      cleared.push('sessionMachine');
    } catch (e) {
      errors.push(`sessionMachine: ${e}`);
    }
  }

  console.log('[engineReset] Full engine reset completed:', {
    cleared,
    errors,
  });

  return {
    success: errors.length === 0,
    cleared,
    errors,
  };
}

/**
 * Quick reset - just session state, keep caches
 */
export function performQuickReset(): FullEngineResetResult {
  return performFullEngineReset({
    clearTicks: false,
    clearThermostat: false,
    clearEngine: false,
    resetSession: true,
    resetMachine: true,
    reconnectFeed: false,
  });
}
