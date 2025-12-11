/**
 * usePaperAccountReset.ts
 * 
 * Hook to reset the paper account to default state (10k balance).
 * Resets paper_config, paper_stats_daily, and closes all paper_positions.
 */

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';

export interface PaperAccountResetResult {
  success: boolean;
  error?: string;
}

export function usePaperAccountReset() {
  const [isResetting, setIsResetting] = useState(false);
  const queryClient = useQueryClient();

  const resetPaperAccount = async (): Promise<PaperAccountResetResult> => {
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
          trading_halted_for_day: false,
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

      // 2. Reset paper_stats_daily for this user
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
        .eq('user_id', user.id);

      if (statsError) {
        console.error('[PaperAccountReset] Failed to reset paper_stats_daily:', statsError);
        return { success: false, error: `Stats reset failed: ${statsError.message}` };
      }
      console.log('[PaperAccountReset] paper_stats_daily reset complete');

      // 3. Close all open paper_positions
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

      // 4. Invalidate all relevant queries to refresh UI
      await queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      await queryClient.invalidateQueries({ queryKey: ['paper-config'] });
      await queryClient.invalidateQueries({ queryKey: ['paper-positions'] });

      console.log('[PaperAccountReset] Full account reset complete');

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
  };

  return {
    resetPaperAccount,
    isResetting,
  };
}
