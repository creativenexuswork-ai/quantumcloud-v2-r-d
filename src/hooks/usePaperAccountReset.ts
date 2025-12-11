/**
 * usePaperAccountReset.ts
 * 
 * Hook to reset the paper account to default state (10k balance).
 * Resets paper_config, paper_stats_daily, and closes all paper_positions.
 * After DB updates, forces UI to re-sync with fresh data.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import { useSessionStore } from '@/lib/state/sessionMachine';

export interface PaperAccountResetResult {
  success: boolean;
  error?: string;
}

export function usePaperAccountReset() {
  const [isResetting, setIsResetting] = useState(false);
  const queryClient = useQueryClient();
  
  // Get dispatch directly from store without selector to avoid hook ordering issues
  const store = useSessionStore();
  const dispatch = store.dispatch;

  const resetPaperAccount = useCallback(async (): Promise<PaperAccountResetResult> => {
    setIsResetting(true);
    
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { success: false, error: 'Not authenticated' };
      }

      console.log('[PaperAccountReset] Starting full account reset for user:', user.id);

      // 1. Reset paper_config
      const { error: configError } = await supabase
        .from('paper_config')
        .update({
          session_status: 'idle',
          is_running: false,
          burst_requested: false,
          session_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (configError) {
        console.error('[PaperAccountReset] Failed to reset paper_config:', configError);
        return { success: false, error: `Config reset failed: ${configError.message}` };
      }
      console.log('[PaperAccountReset] paper_config reset complete');

      // 2. Reset/upsert paper_stats_daily for today (ensures reset state detection works)
      const today = new Date().toISOString().split('T')[0];
      
      // First try to update existing row for today
      const { data: existingStats } = await supabase
        .from('paper_stats_daily')
        .select('id')
        .eq('user_id', user.id)
        .eq('trade_date', today)
        .maybeSingle();

      if (existingStats) {
        // Update existing row
        const { error: statsError } = await supabase
          .from('paper_stats_daily')
          .update({
            equity_start: 10000,
            equity_end: 10000,
            pnl: 0,
            max_drawdown: 0,
            trades_count: 0,
            win_rate: 0,
          })
          .eq('id', existingStats.id);

        if (statsError) {
          console.error('[PaperAccountReset] Failed to update paper_stats_daily:', statsError);
          return { success: false, error: `Stats reset failed: ${statsError.message}` };
        }
      } else {
        // Insert new row for today
        const { error: insertError } = await supabase
          .from('paper_stats_daily')
          .insert({
            user_id: user.id,
            trade_date: today,
            equity_start: 10000,
            equity_end: 10000,
            pnl: 0,
            max_drawdown: 0,
            trades_count: 0,
            win_rate: 0,
          });

        if (insertError) {
          console.error('[PaperAccountReset] Failed to insert paper_stats_daily:', insertError);
          return { success: false, error: `Stats insert failed: ${insertError.message}` };
        }
      }
      console.log('[PaperAccountReset] paper_stats_daily reset/created for today');

      // 3. Reset accounts table equity to 10k
      const { error: accountError } = await supabase
        .from('accounts')
        .update({ equity: 10000 })
        .eq('user_id', user.id)
        .eq('type', 'paper');

      if (accountError) {
        console.error('[PaperAccountReset] Failed to reset accounts equity:', accountError);
        // Non-fatal, continue
      }
      console.log('[PaperAccountReset] accounts equity reset to 10k');

      // 4. Close all open paper_positions
      const { error: positionsError } = await supabase
        .from('paper_positions')
        .update({ closed: true })
        .eq('user_id', user.id)
        .eq('closed', false);

      if (positionsError) {
        console.error('[PaperAccountReset] Failed to close paper_positions:', positionsError);
        return { success: false, error: `Positions close failed: ${positionsError.message}` };
      }
      console.log('[PaperAccountReset] paper_positions closed');

      // ============================================
      // FORCE UI REFRESH SEQUENCE
      // ============================================
      
      // 4. Invalidate and refetch paper stats (forces fresh data fetch)
      console.log('[PaperAccountReset] Forcing UI refresh...');
      await queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      await queryClient.invalidateQueries({ queryKey: ['paper-config'] });
      await queryClient.invalidateQueries({ queryKey: ['paper-positions'] });
      
      // Force immediate refetch to get fresh data
      await queryClient.refetchQueries({ queryKey: ['paper-stats'] });
      
      // 5. Reset UI session state via dispatcher
      // RESET: Clear all session state to initial values
      dispatch({ type: 'RESET' });
      
      // 6. Sync UI with fresh equity value (10k)
      dispatch({ 
        type: 'SYNC_PNL', 
        pnlToday: 0, 
        tradesToday: 0, 
        winRate: 0, 
        equity: 10000 
      });
      
      // 7. Clear any pending actions
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
      
      // 9. Sync positions (none open after reset)
      dispatch({ type: 'SYNC_POSITIONS', hasPositions: false, openCount: 0 });
      
      // 10. Sync status to idle
      dispatch({ type: 'SYNC_STATUS', status: 'idle' });

      console.log('[PaperAccountReset] Full account reset complete - UI refreshed');

      toast({
        title: 'Paper Account Reset',
        description: 'Balance reset to $10,000 – stats and guards cleared.',
      });

      return { success: true };
    } catch (error) {
      console.error('[PaperAccountReset] Unexpected error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      toast({
        title: 'Reset Failed',
        description: errorMessage,
        variant: 'destructive',
      });

      return { success: false, error: errorMessage };
    } finally {
      setIsResetting(false);
    }
  }, [queryClient, dispatch]);

  return {
    resetPaperAccount,
    isResetting,
  };
}
