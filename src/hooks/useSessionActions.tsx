import { useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from './use-toast';
import { useSessionStore, TradingMode, getButtonStates } from '@/lib/state/sessionMachine';
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
  const { session: authSession } = useAuth();
  const queryClient = useQueryClient();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const tickInFlightRef = useRef(false);
  
  // Get state and dispatch from store
  const sessionState = useSessionStore();
  const { dispatch } = sessionState;
  const buttonStates = getButtonStates(sessionState);

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
    dispatch({ type: 'SET_TICK_IN_FLIGHT', tickInFlight: true });
    
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
      
      // Sync halted state
      if (data.halted !== undefined) {
        dispatch({ type: 'SET_HALTED', halted: data.halted });
      }
      
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      return data;
    } catch (error) {
      console.error('Tick error:', error);
      return null;
    } finally {
      tickInFlightRef.current = false;
      dispatch({ type: 'SET_TICK_IN_FLIGHT', tickInFlight: false });
    }
  }, [queryClient, dispatch]);

  // Start tick interval
  const startTickInterval = useCallback(() => {
    clearTickInterval();
    intervalRef.current = setInterval(async () => {
      const currentStatus = useSessionStore.getState().status;
      if (currentStatus !== 'running' && currentStatus !== 'holding') return;
      
      const result = await runTick();
      if (result?.halted) {
        toast({
          title: 'Trading Halted',
          description: 'Daily loss limit reached.',
          variant: 'destructive',
        });
        clearTickInterval();
        dispatch({ type: 'SET_HALTED', halted: true });
      }
    }, TICK_INTERVAL_MS);
  }, [runTick, clearTickInterval, dispatch]);

  // ACTIVATE - Start trading session
  const activate = useCallback(async () => {
    const state = useSessionStore.getState();
    
    if (state.halted) {
      toast({ title: 'Trading Halted', description: 'Daily loss limit reached', variant: 'destructive' });
      return;
    }
    
    if (state.status !== 'idle' && state.status !== 'stopped') {
      return;
    }
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        dispatch({ type: 'ERROR', error: 'Not authenticated' });
        return;
      }

      // Transition to running
      dispatch({ type: 'ACTIVATE' });

      // Update backend
      const backendMode = MODE_TO_BACKEND[state.mode];
      await supabase.from('paper_config').update({
        is_running: true,
        session_status: 'running',
        session_started_at: new Date().toISOString(),
        mode_config: {
          enabledModes: [backendMode],
          modeSettings: {},
        },
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id,
        level: 'info',
        source: 'execution',
        message: `SESSION: Started - ${state.mode.toUpperCase()} mode active`,
      });

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
        dispatch({ type: 'SET_HALTED', halted: true });
        return;
      }
      
      startTickInterval();
      toast({ title: 'Session Activated', description: `${state.mode.toUpperCase()} mode running` });
    } catch (error) {
      console.error('Activate error:', error);
      dispatch({ type: 'ERROR', error: 'Failed to start session' });
      toast({ title: 'Error', description: 'Failed to activate session', variant: 'destructive' });
    }
  }, [dispatch, runTick, startTickInterval]);

  // HOLD - Toggle between running and holding
  const holdToggle = useCallback(async () => {
    const state = useSessionStore.getState();
    
    if (state.status !== 'running' && state.status !== 'holding') {
      return;
    }
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const newStatus = state.status === 'running' ? 'holding' : 'running';
      
      await supabase.from('paper_config').update({
        session_status: newStatus,
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id,
        level: 'info',
        source: 'execution',
        message: newStatus === 'holding' 
          ? 'SESSION: Holding - no new trades; managing existing positions'
          : 'SESSION: Resumed - trading engine active',
      });

      dispatch({ type: 'HOLD' });
      
      toast({ 
        title: newStatus === 'holding' ? 'Session On Hold' : 'Session Resumed',
        description: newStatus === 'holding' ? 'Managing existing positions only' : 'Trading engine active'
      });
    } catch (error) {
      console.error('Hold toggle error:', error);
      toast({ title: 'Error', description: 'Failed to toggle hold', variant: 'destructive' });
    }
  }, [dispatch]);

  // TAKE PROFIT - Close all positions
  const takeProfit = useCallback(async () => {
    const state = useSessionStore.getState();
    
    if (!state.hasPositions) {
      toast({ title: 'No Positions', description: 'No open positions to close' });
      return;
    }
    
    if (state.status !== 'running' && state.status !== 'holding') {
      return;
    }
    
    try {
      dispatch({ type: 'SET_TICK_IN_FLIGHT', tickInFlight: true });
      
      const result = await runTick({ takeBurstProfit: true });
      
      if (result) {
        // Stop the session after taking profit
        clearTickInterval();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('paper_config').update({
            is_running: false,
            session_status: 'idle',
          } as any).eq('user_id', user.id);
          
          await supabase.from('system_logs').insert({
            user_id: user.id,
            level: 'info',
            source: 'execution',
            message: 'SESSION: Take Profit executed - all positions closed',
          });
        }
        
        dispatch({ type: 'CLOSE_ALL' });
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
        toast({ title: 'Profit Taken', description: 'All positions closed' });
      }
    } catch (error) {
      console.error('Take profit error:', error);
      toast({ title: 'Error', description: 'Failed to take profit', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_TICK_IN_FLIGHT', tickInFlight: false });
    }
  }, [dispatch, runTick, clearTickInterval, queryClient]);

  // CLOSE ALL - Emergency close and stop
  const closeAll = useCallback(async () => {
    const state = useSessionStore.getState();
    
    // Stop interval first
    clearTickInterval();
    
    try {
      dispatch({ type: 'SET_TICK_IN_FLIGHT', tickInFlight: true });
      
      if (state.hasPositions) {
        await runTick({ globalClose: true });
      }
      
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('paper_config').update({
          is_running: false,
          session_status: 'idle',
        } as any).eq('user_id', user.id);
        
        await supabase.from('system_logs').insert({
          user_id: user.id,
          level: 'warn',
          source: 'execution',
          message: 'SESSION: CLOSE ALL executed - session stopped',
        });
      }
      
      dispatch({ type: 'CLOSE_ALL' });
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      toast({ title: 'Session Stopped', description: state.hasPositions ? 'All positions closed' : undefined });
    } catch (error) {
      console.error('Close all error:', error);
      toast({ title: 'Error', description: 'Failed to close positions', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_TICK_IN_FLIGHT', tickInFlight: false });
    }
  }, [dispatch, runTick, clearTickInterval, queryClient]);

  // Reset session
  const resetSession = useCallback(() => {
    clearTickInterval();
    dispatch({ type: 'RESET' });
  }, [dispatch, clearTickInterval]);

  // Change trading mode
  const changeMode = useCallback(async (newMode: TradingMode) => {
    const state = useSessionStore.getState();
    
    if (state.status === 'running' || state.status === 'holding') {
      toast({ title: 'Mode Locked', description: 'Stop the engine before changing mode' });
      return;
    }
    
    dispatch({ type: 'SET_MODE', mode: newMode });
    
    // Persist to backend
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const backendMode = MODE_TO_BACKEND[newMode];
      await supabase.from('paper_config').update({
        mode_config: {
          enabledModes: [backendMode],
          modeSettings: {},
        },
      } as any).eq('user_id', user.id);
    }
  }, [dispatch]);

  // Initialize session state from backend on mount - NO AUTO-START
  useEffect(() => {
    if (!authSession?.user?.id) return;
    
    let mounted = true;

    async function initSession() {
      try {
        const { data: config } = await supabase
          .from('paper_config')
          .select('is_running, trading_halted_for_day, session_status')
          .eq('user_id', authSession!.user.id)
          .maybeSingle();

        if (!mounted) return;

        if (config) {
          // Set halted state
          dispatch({ type: 'SET_HALTED', halted: config.trading_halted_for_day || false });
          
          // IMPORTANT: Do NOT auto-start. Always start in idle.
          // The backend status is informational only - user must click ACTIVATE
          // to start trading.
          
          // If backend says running but we just loaded, we should NOT auto-run.
          // User must explicitly activate. Reset backend to idle.
          const backendStatus = (config as any).session_status;
          if (backendStatus === 'running' || backendStatus === 'holding') {
            // Reset backend to idle since we're not auto-starting
            await supabase.from('paper_config').update({
              is_running: false,
              session_status: 'idle',
            } as any).eq('user_id', authSession!.user.id);
          }
          
          // Always start fresh in idle
          dispatch({ type: 'RESET' });
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
  }, [authSession?.user?.id, dispatch, clearTickInterval]);

  return {
    // Session state
    session: sessionState,
    buttonStates,
    
    // Actions
    activate,
    holdToggle,
    takeProfit,
    closeAll,
    resetSession,
    changeMode,
  };
}
