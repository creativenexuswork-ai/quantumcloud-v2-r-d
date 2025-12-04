import { useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from './use-toast';
import { useSessionStore, TradingMode, getButtonStates } from '@/lib/state/sessionMachine';
import { useQueryClient } from '@tanstack/react-query';
import { useTradingState } from './useSessionState';

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
  const autoTpCheckRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get state and dispatch from store
  const sessionState = useSessionStore();
  const { dispatch } = sessionState;
  const buttonStates = getButtonStates(sessionState);
  
  // Get risk settings for auto TP
  const { riskSettings } = useTradingState();

  // Clear tick interval
  const clearTickInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Clear auto TP check
  const clearAutoTpCheck = useCallback(() => {
    if (autoTpCheckRef.current) {
      clearInterval(autoTpCheckRef.current);
      autoTpCheckRef.current = null;
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
      
      // Sync positions count
      if (data.stats) {
        dispatch({ 
          type: 'SYNC_POSITIONS', 
          hasPositions: (data.stats.openPositionsCount || 0) > 0,
          openCount: data.stats.openPositionsCount || 0
        });
        dispatch({
          type: 'SYNC_PNL',
          pnlToday: data.stats.todayPnl || 0,
          tradesToday: data.stats.tradesToday || 0,
          winRate: data.stats.winRate || 0,
          equity: data.stats.equity || 10000,
        });
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
        clearAutoTpCheck();
        dispatch({ type: 'SET_HALTED', halted: true });
      }
    }, TICK_INTERVAL_MS);
  }, [runTick, clearTickInterval, clearAutoTpCheck, dispatch]);

  // Auto TP check - runs while engine is active
  const startAutoTpCheck = useCallback(() => {
    clearAutoTpCheck();
    
    autoTpCheckRef.current = setInterval(async () => {
      const state = useSessionStore.getState();
      const { riskSettings: currentRiskSettings } = useTradingState.getState();
      
      // Only check auto TP when running
      if (state.status !== 'running') return;
      
      // Get current P&L data
      const { data: stats } = await supabase.functions.invoke('paper-stats');
      if (!stats?.stats) return;
      
      const equity = stats.stats.equity || 10000;
      const todayPnlPercent = stats.stats.todayPnlPercent || 0;
      const tpTarget = currentRiskSettings.dailyProfitTarget;
      
      // Check if we hit the TP target
      if (todayPnlPercent >= tpTarget && stats.stats.openPositionsCount > 0) {
        console.log(`[AUTO-TP] Target hit: ${todayPnlPercent.toFixed(2)}% >= ${tpTarget}%. Closing and restarting cycle.`);
        
        // Close all positions
        await runTick({ globalClose: true });
        
        // Log the auto TP event
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('system_logs').insert({
            user_id: user.id,
            level: 'info',
            source: 'execution',
            message: `AUTO-TP: Target ${tpTarget}% reached (${todayPnlPercent.toFixed(2)}%). Positions closed, restarting cycle.`,
          });
        }
        
        toast({ 
          title: 'Auto Take Profit', 
          description: `Target ${tpTarget}% reached. Cycle restarting.` 
        });
        
        // Immediately start a new cycle (state stays "running")
        await runTick();
        
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
    }, TICK_INTERVAL_MS * 2); // Check every 8 seconds
  }, [runTick, queryClient, clearAutoTpCheck]);

  // ACTIVATE - Start trading session OR Resume from holding
  const activate = useCallback(async () => {
    const state = useSessionStore.getState();
    
    if (state.halted) {
      toast({ title: 'Trading Halted', description: 'Daily loss limit reached', variant: 'destructive' });
      return;
    }
    
    // Can activate from idle, stopped, or holding
    if (state.status !== 'idle' && state.status !== 'stopped' && state.status !== 'holding') {
      return;
    }
    
    const wasHolding = state.status === 'holding';
    
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
        session_started_at: wasHolding ? undefined : new Date().toISOString(),
        mode_config: {
          enabledModes: [backendMode],
          modeSettings: {},
        },
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id,
        level: 'info',
        source: 'execution',
        message: wasHolding 
          ? `SESSION: Resumed - ${state.mode.toUpperCase()} mode active`
          : `SESSION: Started - ${state.mode.toUpperCase()} mode active`,
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
      startAutoTpCheck();
      
      toast({ 
        title: wasHolding ? 'Session Resumed' : 'Session Activated', 
        description: `${state.mode.toUpperCase()} mode running` 
      });
    } catch (error) {
      console.error('Activate error:', error);
      dispatch({ type: 'ERROR', error: 'Failed to start session' });
      toast({ title: 'Error', description: 'Failed to activate session', variant: 'destructive' });
    }
  }, [dispatch, runTick, startTickInterval, startAutoTpCheck]);

  // HOLD - Stop opening new trades, but manage existing positions
  const holdToggle = useCallback(async () => {
    const state = useSessionStore.getState();
    
    // Only allow hold from running state
    if (state.status !== 'running') {
      return;
    }
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('paper_config').update({
        session_status: 'holding',
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id,
        level: 'info',
        source: 'execution',
        message: 'SESSION: Holding - no new trades; managing existing positions',
      });

      dispatch({ type: 'HOLD' });
      
      // Keep tick interval running for position management, but stop auto TP cycling
      clearAutoTpCheck();
      
      toast({ 
        title: 'Session On Hold',
        description: 'Managing existing positions only. Click ACTIVATE to resume.'
      });
    } catch (error) {
      console.error('Hold error:', error);
      toast({ title: 'Error', description: 'Failed to hold session', variant: 'destructive' });
    }
  }, [dispatch, clearAutoTpCheck]);

  // TAKE PROFIT - Close all positions, go to holding
  const takeProfit = useCallback(async () => {
    const state = useSessionStore.getState();
    
    if (state.status !== 'running' && state.status !== 'holding') {
      return;
    }
    
    try {
      dispatch({ type: 'SET_TICK_IN_FLIGHT', tickInFlight: true });
      
      // Close all positions
      await runTick({ globalClose: true });
      
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Go to holding state (not idle)
        await supabase.from('paper_config').update({
          session_status: 'holding',
        } as any).eq('user_id', user.id);
        
        await supabase.from('system_logs').insert({
          user_id: user.id,
          level: 'info',
          source: 'execution',
          message: 'SESSION: Take Profit - all positions closed. Engine on hold.',
        });
      }
      
      // Transition to holding (positions closed but session still "alive")
      dispatch({ type: 'TAKE_PROFIT' });
      clearAutoTpCheck();
      
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      toast({ title: 'Profit Taken', description: 'All positions closed. Click ACTIVATE to resume trading.' });
    } catch (error) {
      console.error('Take profit error:', error);
      toast({ title: 'Error', description: 'Failed to take profit', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_TICK_IN_FLIGHT', tickInFlight: false });
    }
  }, [dispatch, runTick, clearAutoTpCheck, queryClient]);

  // CLOSE ALL - Emergency close and full stop
  const closeAll = useCallback(async () => {
    // Stop intervals first
    clearTickInterval();
    clearAutoTpCheck();
    
    try {
      dispatch({ type: 'SET_TICK_IN_FLIGHT', tickInFlight: true });
      
      const state = useSessionStore.getState();
      
      // Close all positions if any
      if (state.hasPositions || state.openCount > 0) {
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
          message: 'SESSION: CLOSE ALL - session stopped completely',
        });
      }
      
      dispatch({ type: 'CLOSE_ALL' });
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      toast({ title: 'Session Stopped', description: 'All positions closed. Engine idle.' });
    } catch (error) {
      console.error('Close all error:', error);
      toast({ title: 'Error', description: 'Failed to close positions', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_TICK_IN_FLIGHT', tickInFlight: false });
    }
  }, [dispatch, runTick, clearTickInterval, clearAutoTpCheck, queryClient]);

  // Reset session
  const resetSession = useCallback(() => {
    clearTickInterval();
    clearAutoTpCheck();
    dispatch({ type: 'RESET' });
  }, [dispatch, clearTickInterval, clearAutoTpCheck]);

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
          // Reset backend to idle since we're not auto-starting
          const backendStatus = (config as any).session_status;
          if (backendStatus === 'running' || backendStatus === 'holding') {
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
      clearAutoTpCheck();
    };
  }, [authSession?.user?.id, dispatch, clearTickInterval, clearAutoTpCheck]);

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
