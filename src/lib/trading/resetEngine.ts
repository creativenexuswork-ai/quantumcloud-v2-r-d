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
 * - Deletes all open paper positions
 * - Clears today's trades
 * - Resets daily stats to the new balance
 * - Updates paper_config session status
 * - Returns the engine to a clean, trade-ready state
 */
export async function resetEngine(opts?: ResetEngineOptions): Promise<ResetEngineResult> {
  const reason = opts?.reason ?? 'manual_reset';
  const keepRunning = opts?.keepRunning === true;

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
      .select('equity_start')
      .eq('user_id', userId)
      .eq('trade_date', today)
      .maybeSingle();

    // Determine the new equity value
    const newEquity = 
      typeof opts?.newPaperBalance === 'number' && opts.newPaperBalance > 0
        ? opts.newPaperBalance
        : currentStats?.equity_start ?? 10000;

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
    const { error: configError } = await supabase
      .from('paper_config')
      .update({
        is_running: keepRunning,
        session_status: newStatus,
        trading_halted_for_day: false, // Clear any halt flags
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
      message: `ENGINE RESET: reason=${reason}, newEquity=${newEquity}, keepRunning=${keepRunning}`,
      meta: { reason, newEquity, keepRunning },
    });

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
 * Routes all terminal reasons through resetEngine.
 */
export async function onSessionEnd(
  reason: RunEndReason,
  autoTpStopAfterHit: boolean = true
): Promise<ResetEngineResult> {
  if (reason === 'auto_tp') {
    if (autoTpStopAfterHit) {
      // Hit TP and stop trading → full reset, stay idle
      return resetEngine({
        reason,
        keepRunning: false,
      });
    } else {
      // Continuous mode → full reset, then new clean run
      return resetEngine({
        reason,
        keepRunning: true,
      });
    }
  } else if (reason === 'max_dd' || reason === 'risk_guard') {
    // Hard stop: full reset and stay idle
    return resetEngine({
      reason,
      keepRunning: false,
    });
  } else if (reason === 'manual_stop') {
    return resetEngine({
      reason,
      keepRunning: false,
    });
  } else {
    // Any other termination reason → safe full reset, idle
    return resetEngine({
      reason,
      keepRunning: false,
    });
  }
}
