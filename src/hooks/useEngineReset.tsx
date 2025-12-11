/**
 * useEngineReset.ts
 * 
 * Hook to perform full engine-layer resets from UI
 */

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { performFullEngineReset, type FullEngineResetResult } from '@/lib/trading/engineReset';
import { useSession } from '@/lib/state/session';

export interface UseEngineResetResult {
  resetEngine: () => Promise<FullEngineResetResult>;
  isResetting: boolean;
}

export function useEngineReset(): UseEngineResetResult {
  const [isResetting, setIsResetting] = useState(false);
  const queryClient = useQueryClient();
  const { setStatus } = useSession();

  const resetEngine = useCallback(async (): Promise<FullEngineResetResult> => {
    setIsResetting(true);

    try {
      // 1. Perform in-memory engine reset
      const result = performFullEngineReset({
        clearTicks: true,
        clearThermostat: true,
        clearEngine: true,
        resetSession: true,
        resetMachine: true,
        reconnectFeed: true,
      });

      // 2. Update database to idle state
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('paper_config').update({
          is_running: false,
          session_status: 'idle',
          burst_requested: false,
        } as any).eq('user_id', user.id);

        await supabase.from('system_logs').insert({
          user_id: user.id,
          level: 'info',
          source: 'execution',
          message: 'ENGINE RESET: Full engine-layer reset performed',
          meta: { cleared: result.cleared, errors: result.errors },
        });
      }

      // 3. Force UI to idle
      setStatus('idle');

      // 4. Invalidate all queries to force fresh data
      await queryClient.invalidateQueries({ queryKey: ['paper-stats'] });

      // 5. Notify user
      if (result.success) {
        toast({
          title: 'Engine Reset Complete',
          description: `Cleared: ${result.cleared.join(', ')}`,
        });
      } else {
        toast({
          title: 'Engine Reset (with warnings)',
          description: `Errors: ${result.errors.join(', ')}`,
          variant: 'destructive',
        });
      }

      return result;
    } catch (error) {
      console.error('[useEngineReset] Reset failed:', error);
      toast({
        title: 'Reset Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });

      return {
        success: false,
        cleared: [],
        errors: [String(error)],
      };
    } finally {
      setIsResetting(false);
    }
  }, [queryClient, setStatus]);

  return {
    resetEngine,
    isResetting,
  };
}
