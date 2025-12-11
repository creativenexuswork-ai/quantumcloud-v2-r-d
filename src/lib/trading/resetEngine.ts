import { supabase } from '@/integrations/supabase/client';

// ============== Run End Reason Types ==============
export type RunEndReason =
  | 'auto_tp'
  | 'max_dd'
  | 'risk_guard'
  | 'manual_stop'
  | 'error'
  | 'manual_reset'
  | 'set_balance';

export interface ResetEngineOptions {
  reason?: RunEndReason;
  keepRunning?: boolean;        // For continuous mode after TP
  newPaperBalance?: number;     // Only used when explicitly setting paper balance
}

export interface ResetEngineResult {
  success: boolean;
  error?: string;
  newEquity?: number;
  reason: RunEndReason;
}

/**
 * Centralized reset function that clears all engine state.
 * 
 * This function:
 * - Deletes all open paper positions (closes all trades)
 * - Clears today's trades history
 * - Resets daily stats to the new balance
 * - Updates paper_config session status
 * - Clears per-run counters and guards
 * - Returns the engine to a clean, trade-ready state
 * 
 * CRITICAL: This function performs a FULL state reset before any restart logic.
 * Both "Stop after TP" and "Continuous" modes get a full reset - the only difference
 * is whether keepRunning is true (continuous) or false (stop after TP).
 */
export async function resetEngine(opts?: ResetEngineOptions): Promise<ResetEngineResult> {
  const reason = opts?.reason ?? 'manual_reset';
  const keepRunning = opts?.keepRunning === true;

  console.log(`[resetEngine] Starting reset: reason=${reason}, keepRunning=${keepRunning}`);

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated', reason };
    }

    const userId = user.id;
    const today = new Date().toISOString().split('T')[0];

    // 1) Get current paper_stats to determine starting balance
    const { data: currentStats } = await supabase
      .from('paper_stats_daily')
      .select('equity_start, equity_end')
      .eq('user_id', userId)
      .eq('trade_date', today)
      .maybeSingle();

    // Determine the new equity value:
    // - If explicit newPaperBalance provided, use it
    // - For continuous mode after TP, use current equity_end as new baseline
    // - Otherwise use equity_start (original starting balance)
    let newEquity: number;
    if (typeof opts?.newPaperBalance === 'number' && opts.newPaperBalance > 0) {
      newEquity = opts.newPaperBalance;
    } else if (keepRunning && currentStats?.equity_end) {
      // Continuous mode: use current equity as new baseline
      newEquity = currentStats.equity_end;
    } else {
      newEquity = currentStats?.equity_start ?? 10000;
    }

    // 2) Delete all open paper positions (closes all trades)
    const { error: posError } = await supabase
      .from('paper_positions')
      .delete()
      .eq('user_id', userId);

    if (posError) {
      console.error('resetEngine: Failed to delete positions', posError);
    }

    // 3) Delete today's paper trades (clear history for fresh start)
    const { error: tradesError } = await supabase
      .from('paper_trades')
      .delete()
      .eq('user_id', userId)
      .eq('session_date', today);

    if (tradesError) {
      console.error('resetEngine: Failed to delete trades', tradesError);
    }

    // 4) Reset paper_stats_daily for today
    const { error: statsError } = await supabase
      .from('paper_stats_daily')
      .upsert({
        user_id: userId,
        trade_date: today,
        equity_start: newEquity,
        equity_end: newEquity,
        pnl: 0,
        win_rate: 0,
        trades_count: 0,
        max_drawdown: 0,
      }, { onConflict: 'user_id,trade_date' });

    if (statsError) {
      console.error('resetEngine: Failed to reset stats', statsError);
    }

    // 5) Update session status in paper_config
    // CRITICAL: Only go to 'idle' if NOT keeping running (stopAfterTP = true or manual reset)
    // If keepRunning = true (continuous mode), stay 'running'
    const newStatus = keepRunning ? 'running' : 'idle';
    const newSessionStartedAt = keepRunning ? new Date().toISOString() : null;
    
    const { error: configError } = await supabase
      .from('paper_config')
      .update({
        is_running: keepRunning,
        session_status: newStatus,
        session_started_at: newSessionStartedAt,
        burst_requested: false,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('user_id', userId);

    if (configError) {
      console.error('resetEngine: Failed to update config', configError);
    }

    // 6) Log the reset action
    await supabase.from('system_logs').insert({
      user_id: userId,
      level: 'info',
      source: 'execution',
      message: `ENGINE RESET: reason=${reason}, newEquity=${newEquity.toFixed(2)}, keepRunning=${keepRunning}, newStatus=${newStatus}`,
      meta: { reason, newEquity, keepRunning, newStatus },
    });

    console.log(`[resetEngine] Reset complete: newEquity=${newEquity.toFixed(2)}, status=${newStatus}`);

    return {
      success: true,
      newEquity,
      reason,
    };
  } catch (error) {
    console.error('resetEngine: Uncaught error', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      reason,
    };
  }
}

/**
 * Handler for session end events (Auto-TP, max-loss, manual stop).
 * Routes all terminal reasons through resetEngine with proper flag mapping.
 * 
 * CRITICAL CONTRACT:
 * - "Stop after TP" mode: autoTpStopAfterHit = true → full reset, stay idle
 * - "Continuous" mode: autoTpStopAfterHit = false → full reset, auto-restart with clean state
 * - Other reasons (max_dd, risk_guard, manual_stop): always full reset and idle
 */
export async function onSessionEnd(
  reason: RunEndReason,
  autoTpStopAfterHit: boolean = true
): Promise<ResetEngineResult> {
  console.log(`[onSessionEnd] Handling session end: reason=${reason}, autoTpStopAfterHit=${autoTpStopAfterHit}`);
  
  if (reason === 'auto_tp') {
    if (autoTpStopAfterHit) {
      // "Stop after TP" mode: full reset, stay idle until user starts again
      console.log('[onSessionEnd] Stop after TP: resetting to idle');
      return resetEngine({
        reason,
        keepRunning: false,
      });
    } else {
      // "Continuous" mode: full reset, then immediately start a new clean run
      console.log('[onSessionEnd] Continuous mode: resetting then auto-restarting');
      return resetEngine({
        reason,
        keepRunning: true,
      });
    }
  } else if (reason === 'max_dd' || reason === 'risk_guard') {
    // Hard stop: full reset and stay idle - user must manually restart
    console.log(`[onSessionEnd] Hard stop (${reason}): resetting to idle`);
    return resetEngine({
      reason,
      keepRunning: false,
    });
  } else if (reason === 'manual_stop') {
    console.log('[onSessionEnd] Manual stop: resetting to idle');
    return resetEngine({
      reason,
      keepRunning: false,
    });
  } else {
    // Any other termination reason → safe full reset, idle
    console.log(`[onSessionEnd] Other reason (${reason}): resetting to idle`);
    return resetEngine({
      reason,
      keepRunning: false,
    });
  }
}
