import { useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from './use-toast';
import { useSessionMachine, TradingMode } from '@/lib/state/sessionMachine';
import { useQueryClient } from '@tanstack/react-query';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const TICK_INTERVAL_MS = 4000;

// Map UI mode to backend mode
const MODE_TO_BACKEND: Record<TradingMode, string> = {
  burst: 'burst',
  scalper: 'sniper',
  trend: 'trend',
};

export function useSessionActions() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const tickInFlightRef = useRef(false);
  
  const {
    status,
    mode,
    arm,
    start,
    hold,
    resume,
    stop,
    closeAll,
    fail,
    setStatus,
    setHalted,
    setTickInFlight,
    syncFromBackend,
  } = useSessionMachine();

  // Clear tick interval
  const clearTickInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Run a single tick
  const runTick = useCallback(async (options?: { globalClose?: boolean; takeBurstProfit?: boolean }) => {
    if (tickInFlightRef.current) return null;
    
    tickInFlightRef.current = true;
    setTickInFlight(true);
    
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return null;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options || {}),
      });

      if (!response.ok) {
        console.error('Tick failed:', response.status);
        return null;
      }
      
      const data = await response.json();
      
      // Sync state from backend
      syncFromBackend({
        sessionStatus: data.sessionStatus,
        halted: data.halted,
      });
      
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      return data;
    } catch (error) {
      console.error('Tick error:', error);
      return null;
    } finally {
      tickInFlightRef.current = false;
      setTickInFlight(false);
    }
  }, [queryClient, setTickInFlight, syncFromBackend]);

  // Start tick interval
  const startTickInterval = useCallback(() => {
    clearTickInterval();
    intervalRef.current = setInterval(async () => {
      const currentStatus = useSessionMachine.getState().status;
      if (currentStatus !== 'running' && currentStatus !== 'holding') return;
      
      const result = await runTick();
      if (result?.halted) {
        toast({
          title: 'Trading Halted',
          description: 'Daily loss limit reached.',
          variant: 'destructive',
        });
        clearTickInterval();
        setStatus('idle');
        setHalted(true);
      }
    }, TICK_INTERVAL_MS);
  }, [runTick, clearTickInterval, setStatus, setHalted]);

  // ACTIVATE - Start trading session
  const activateSession = useCallback(async () => {
    const { status: currentStatus, halted, mode: currentMode } = useSessionMachine.getState();
    
    if (halted) {
      toast({ title: 'Trading Halted', description: 'Daily loss limit reached', variant: 'destructive' });
      return;
    }
    
    if (currentStatus !== 'idle' && currentStatus !== 'stopped' && currentStatus !== 'error') {
      return;
    }
    
    try {
      // Arm the session
      arm(currentMode);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        fail('Not authenticated');
        return;
      }

      // Update backend with enabled modes
      const backendMode = MODE_TO_BACKEND[currentMode];
      await supabase.from('paper_config').update({
        is_running: true,
        session_status: 'running',
        session_started_at: new Date().toISOString(),
        mode_config: {
          enabledModes: [backendMode, 'trend', 'burst', 'news', 'memory'],
          modeSettings: {},
        },
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id,
        level: 'info',
        source: 'execution',
        message: `SESSION: Started - ${currentMode.toUpperCase()} mode active`,
      });

      // Transition to running
      start();
      
      // Run immediate tick
      const result = await runTick();
      
      if (result?.halted) {
        toast({
          title: 'Trading Halted',
          description: 'Daily loss limit reached.',
          variant: 'destructive',
        });
        await supabase.from('paper_config').update({
          is_running: false,
          session_status: 'idle',
        } as any).eq('user_id', user.id);
        setStatus('idle');
        setHalted(true);
        return;
      }
      
      startTickInterval();
      toast({ title: 'Session Activated', description: `${currentMode.toUpperCase()} mode running` });
    } catch (error) {
      console.error('Activate error:', error);
      fail('Failed to start session');
      toast({ title: 'Error', description: 'Failed to activate session', variant: 'destructive' });
    }
  }, [arm, start, fail, runTick, startTickInterval, setStatus, setHalted]);

  // HOLD - Toggle between running and holding
  const toggleHold = useCallback(async () => {
    const { status: currentStatus } = useSessionMachine.getState();
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (currentStatus === 'running') {
        await supabase.from('paper_config').update({
          session_status: 'holding',
        } as any).eq('user_id', user.id);

        await supabase.from('system_logs').insert({
          user_id: user.id,
          level: 'info',
          source: 'execution',
          message: 'SESSION: Holding - no new trades; managing existing positions',
        });

        hold();
        toast({ title: 'Session On Hold', description: 'Managing existing positions only' });
      } else if (currentStatus === 'holding') {
        await supabase.from('paper_config').update({
          session_status: 'running',
        } as any).eq('user_id', user.id);

        await supabase.from('system_logs').insert({
          user_id: user.id,
          level: 'info',
          source: 'execution',
          message: 'SESSION: Resumed - trading engine active',
        });

        resume();
        toast({ title: 'Session Resumed', description: 'Trading engine active' });
      }
    } catch (error) {
      console.error('Hold toggle error:', error);
      toast({ title: 'Error', description: 'Failed to toggle hold', variant: 'destructive' });
    }
  }, [hold, resume]);

  // TAKE PROFIT - Close all positions, stay in running state or go to stopped
  const takeProfit = useCallback(async () => {
    const { hasPositions, status: currentStatus } = useSessionMachine.getState();
    
    if (!hasPositions) {
      toast({ title: 'No Positions', description: 'No open positions to close' });
      return;
    }
    
    if (currentStatus !== 'running' && currentStatus !== 'holding') {
      return;
    }
    
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;
      
      setTickInFlight(true);
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ takeBurstProfit: true }),
      });
      
      if (response.ok) {
        // Stop the session after taking profit
        clearTickInterval();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('paper_config').update({
            is_running: false,
            session_status: 'stopped',
          } as any).eq('user_id', user.id);
          
          await supabase.from('system_logs').insert({
            user_id: user.id,
            level: 'info',
            source: 'execution',
            message: 'SESSION: Take Profit executed - all positions closed',
          });
        }
        
        stop();
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
        toast({ title: 'Profit Taken', description: 'All positions closed' });
      }
    } catch (error) {
      console.error('Take profit error:', error);
      toast({ title: 'Error', description: 'Failed to take profit', variant: 'destructive' });
    } finally {
      setTickInFlight(false);
    }
  }, [clearTickInterval, stop, queryClient, setTickInFlight]);

  // CLOSE ALL - Emergency close and stop
  const closeAllPositions = useCallback(async () => {
    const { hasPositions } = useSessionMachine.getState();
    
    if (!hasPositions) {
      // Still stop the session even if no positions
      clearTickInterval();
      
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('paper_config').update({
          is_running: false,
          session_status: 'stopped',
        } as any).eq('user_id', user.id);
      }
      
      closeAll();
      toast({ title: 'Session Stopped' });
      return;
    }
    
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;
      
      setTickInFlight(true);
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ globalClose: true }),
      });
      
      if (response.ok) {
        clearTickInterval();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('paper_config').update({
            is_running: false,
            session_status: 'stopped',
          } as any).eq('user_id', user.id);
          
          await supabase.from('system_logs').insert({
            user_id: user.id,
            level: 'warn',
            source: 'execution',
            message: 'SESSION: CLOSE ALL executed - emergency stop',
          });
        }
        
        closeAll();
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
        toast({ title: 'Positions Closed', description: 'All positions closed, session stopped' });
      }
    } catch (error) {
      console.error('Close all error:', error);
      toast({ title: 'Error', description: 'Failed to close positions', variant: 'destructive' });
    } finally {
      setTickInFlight(false);
    }
  }, [clearTickInterval, closeAll, queryClient, setTickInFlight]);

  // Change trading mode
  const changeMode = useCallback((newMode: TradingMode) => {
    const { status: currentStatus } = useSessionMachine.getState();
    
    if (currentStatus === 'running' || currentStatus === 'holding') {
      toast({ title: 'Mode Locked', description: 'Stop the engine before changing mode' });
      return;
    }
    
    useSessionMachine.getState().setMode(newMode);
    
    // Persist to backend
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const backendMode = MODE_TO_BACKEND[newMode];
        await supabase.from('paper_config').update({
          mode_config: {
            enabledModes: [backendMode, 'trend', 'burst', 'news', 'memory'],
            modeSettings: {},
          },
        } as any).eq('user_id', user.id);
      }
    })();
  }, []);

  // Initialize session state from backend on mount
  useEffect(() => {
    if (!session?.user?.id) return;
    
    let mounted = true;

    async function initSession() {
      try {
        const { data: config } = await supabase
          .from('paper_config')
          .select('is_running, trading_halted_for_day, session_status')
          .eq('user_id', session!.user.id)
          .maybeSingle();

        if (!mounted) return;

        if (config) {
          setHalted(config.trading_halted_for_day || false);
          
          const backendStatus = (config as any).session_status || 'idle';
          syncFromBackend({ sessionStatus: backendStatus });
          
          // Restart tick interval if session was running
          if ((backendStatus === 'running' || backendStatus === 'holding') && !config.trading_halted_for_day) {
            const result = await runTick();
            
            if (!mounted) return;
            
            if (result?.halted) {
              await supabase.from('paper_config').update({
                is_running: false,
                session_status: 'idle',
              } as any).eq('user_id', session!.user.id);
              setStatus('idle');
              return;
            }
            
            startTickInterval();
          }
        }
      } catch (error) {
        console.error('Init session error:', error);
      }
    }

    initSession();

    return () => {
      mounted = false;
      clearTickInterval();
    };
  }, [session?.user?.id, runTick, startTickInterval, clearTickInterval, setStatus, setHalted, syncFromBackend]);

  return {
    activateSession,
    toggleHold,
    takeProfit,
    closeAllPositions,
    changeMode,
  };
}
