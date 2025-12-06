import { useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from './use-toast';
import { useSessionStore, TradingMode, getButtonStates } from '@/lib/state/sessionMachine';
import { useQueryClient } from '@tanstack/react-query';
import { useTradingState } from './useSessionState';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const TICK_INTERVAL_MS = 2000; // Trading tick interval - strategy execution
const PNL_REFRESH_MS = 300; // P&L refresh interval - fast UI updates

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
  const pnlRefreshRef = useRef<NodeJS.Timeout | null>(null);
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

  // Clear P&L refresh interval
  const clearPnlRefresh = useCallback(() => {
    if (pnlRefreshRef.current) {
      clearInterval(pnlRefreshRef.current);
      pnlRefreshRef.current = null;
    }
  }, []);

  // Clear auto TP check
  const clearAutoTpCheck = useCallback(() => {
    if (autoTpCheckRef.current) {
      clearInterval(autoTpCheckRef.current);
      autoTpCheckRef.current = null;
    }
  }, []);

  // Fast P&L refresh - just fetches stats, no trade execution
  const refreshPnl = useCallback(async () => {
    const pendingAction = useSessionStore.getState().pendingAction;
    if (pendingAction) return; // Skip during pending actions
    
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;

      const { data: stats } = await supabase.functions.invoke('paper-stats');
      if (stats?.stats) {
        dispatch({
          type: 'SYNC_PNL',
          pnlToday: stats.stats.todayPnl || 0,
          tradesToday: stats.stats.tradesToday || 0,
          winRate: stats.stats.winRate || 0,
          equity: stats.stats.equity || 10000,
        });
        dispatch({
          type: 'SYNC_POSITIONS',
          hasPositions: (stats.stats.openPositionsCount || 0) > 0,
          openCount: stats.stats.openPositionsCount || 0,
        });
      }
    } catch (error) {
      // Silent fail for P&L refresh - non-critical
    }
  }, [dispatch]);

  // Run a single tick - strategy execution only
  const runTick = useCallback(async (options?: { globalClose?: boolean; takeBurstProfit?: boolean; takeProfit?: boolean }) => {
    const isCloseAction = options?.globalClose || options?.takeProfit;
    
    // CRITICAL: Manual close actions (TP/CloseAll) ALWAYS execute - never block them
    // Regular ticks are blocked if another tick is in-flight
    if (!isCloseAction && tickInFlightRef.current) {
      return null;
    }
    
    const currentStatus = useSessionStore.getState().status;
    
    // Regular ticks only run when session is 'running'
    if (!isCloseAction && !options?.takeBurstProfit) {
      if (currentStatus !== 'running') {
        return null;
      }
    }
    
    // Only set in-flight for regular ticks (manual actions run regardless)
    if (!isCloseAction) {
      tickInFlightRef.current = true;
    }
    
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
      
      // Sync session status from backend
      if (data.sessionStatus) {
        dispatch({ type: 'SYNC_STATUS', status: data.sessionStatus });
      }
      
      // Sync positions and P&L immediately from response
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
      
      // Invalidate queries for any other listeners
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      return data;
    } catch (error) {
      console.error('Tick error:', error);
      return null;
    } finally {
      // Only reset in-flight flag for regular ticks (manual actions didn't set it)
      if (!options?.globalClose && !options?.takeProfit) {
        tickInFlightRef.current = false;
      }
    }
  }, [queryClient, dispatch]);

  // Start tick interval - only runs when session is RUNNING
  const startTickInterval = useCallback(() => {
    clearTickInterval();
    intervalRef.current = setInterval(async () => {
      const currentStatus = useSessionStore.getState().status;
      const pendingAction = useSessionStore.getState().pendingAction;
      
      // CRITICAL: Do NOT tick if any action is pending
      if (pendingAction) return;
      
      // Only tick if explicitly running
      if (currentStatus !== 'running') return;
      
      const result = await runTick();
      if (result?.halted) {
        toast({
          title: 'Trading Halted',
          description: 'Daily loss limit reached.',
          variant: 'destructive',
        });
        clearTickInterval();
        clearPnlRefresh();
        clearAutoTpCheck();
        dispatch({ type: 'SET_HALTED', halted: true });
      }
    }, TICK_INTERVAL_MS);
  }, [runTick, clearTickInterval, clearPnlRefresh, clearAutoTpCheck, dispatch]);

  // Start fast P&L refresh - runs independently from trading ticks
  const startPnlRefresh = useCallback(() => {
    clearPnlRefresh();
    pnlRefreshRef.current = setInterval(async () => {
      const currentStatus = useSessionStore.getState().status;
      const pendingAction = useSessionStore.getState().pendingAction;
      
      // Only refresh P&L during active sessions, skip during pending actions
      if (currentStatus !== 'running' && currentStatus !== 'holding') return;
      if (pendingAction) return;
      
      await refreshPnl();
    }, PNL_REFRESH_MS);
  }, [clearPnlRefresh, refreshPnl]);

  // Auto TP check - runs while engine is active (NO auto-resume batch opening)
  const startAutoTpCheck = useCallback(() => {
    clearAutoTpCheck();
    
    autoTpCheckRef.current = setInterval(async () => {
      const state = useSessionStore.getState();
      const { riskSettings: currentRiskSettings } = useTradingState.getState();
      
      // Only check auto TP when running and no pending action
      if (state.status !== 'running' || state.pendingAction) return;
      
      // Get current P&L data
      const { data: stats } = await supabase.functions.invoke('paper-stats');
      if (!stats?.stats) return;
      
      const todayPnlPercent = stats.stats.todayPnlPercent || 0;
      const tpTarget = currentRiskSettings.dailyProfitTarget;
      
      // Check if we hit the TP target
      if (todayPnlPercent >= tpTarget && stats.stats.openPositionsCount > 0) {
        console.log(`[AUTO-TP] Target hit: ${todayPnlPercent.toFixed(2)}% >= ${tpTarget}%. Closing positions.`);
        
        // Close all positions - NO auto-resume, just close
        dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'takeProfit' });
        await runTick({ takeProfit: true });
        dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
        
        // Log the auto TP event
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('system_logs').insert({
            user_id: user.id,
            level: 'info',
            source: 'execution',
            message: `AUTO-TP: Target ${tpTarget}% reached (${todayPnlPercent.toFixed(2)}%). Positions closed.`,
          });
        }
        
        toast({ 
          title: 'Auto Take Profit', 
          description: `Target ${tpTarget}% reached. Positions closed.` 
        });
        
        // DO NOT call runTick() again - no auto-resume batch opening
        // Engine will naturally open new positions on the next regular tick cycle
        
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
    }, TICK_INTERVAL_MS * 2);
  }, [runTick, queryClient, clearAutoTpCheck, dispatch]);

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
    
    // Set pending action for spinner
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'activate' });
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        dispatch({ type: 'ERROR', error: 'Not authenticated' });
        dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
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
        dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
        return;
      }
      
      startTickInterval();
      startPnlRefresh();
      startAutoTpCheck();
      
      toast({ 
        title: wasHolding ? 'Session Resumed' : 'Session Activated', 
        description: `${state.mode.toUpperCase()} mode running` 
      });
    } catch (error) {
      console.error('Activate error:', error);
      dispatch({ type: 'ERROR', error: 'Failed to start session' });
      toast({ title: 'Error', description: 'Failed to activate session', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
  }, [dispatch, runTick, startTickInterval, startPnlRefresh, startAutoTpCheck]);

  // HOLD - Stop opening new trades, but manage existing positions
  const holdToggle = useCallback(async () => {
    const state = useSessionStore.getState();
    
    // Only allow hold from running state
    if (state.status !== 'running') {
      return;
    }
    
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'hold' });
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
        return;
      }

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
    } finally {
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
  }, [dispatch, clearAutoTpCheck]);

  // ================================================================
  // TAKE PROFIT - Single atomic action with optimistic UI update
  // ================================================================
  const takeProfit = useCallback(async () => {
    const state = useSessionStore.getState();
    
    if (state.status !== 'running' && state.status !== 'holding') {
      return;
    }
    
    // Already processing? Don't allow another click
    if (state.pendingAction !== null) {
      return;
    }
    
    // STEP 1: Set pending action and OPTIMISTIC UI update
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'takeProfit' });
    dispatch({ type: 'SYNC_POSITIONS', hasPositions: false, openCount: 0 }); // Optimistic
    
    // STEP 2: Stop tick interval to prevent race conditions
    clearTickInterval();
    clearAutoTpCheck();
    tickInFlightRef.current = false;
    
    try {
      // STEP 3: Call backend ONCE (non-blocking pattern)
      const result = await runTick({ takeProfit: true });
      
      // STEP 4: Sync final stats from backend
      if (result?.stats) {
        dispatch({
          type: 'SYNC_PNL',
          pnlToday: result.stats.todayPnl || 0,
          tradesToday: result.stats.tradesToday || 0,
          winRate: result.stats.winRate || 0,
          equity: result.stats.equity || 10000,
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      toast({ 
        title: 'Profit Taken', 
        description: `${result?.closedCount || 0} positions closed.` 
      });
      
      // Resume tick interval if session continues
      const currentStatus = useSessionStore.getState().status;
      if (currentStatus === 'running') {
        startTickInterval();
        startAutoTpCheck();
      }
      
    } catch (error) {
      console.error('Take profit error:', error);
      toast({ title: 'Error', description: 'Failed to take profit', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
    
  }, [dispatch, runTick, queryClient, clearTickInterval, clearAutoTpCheck, startTickInterval, startAutoTpCheck]);

  // ================================================================
  // CLOSE ALL - Single atomic action with optimistic UI update
  // ================================================================
  const closeAll = useCallback(async () => {
    const state = useSessionStore.getState();
    
    // Already processing? Don't allow another click
    if (state.pendingAction !== null) {
      return;
    }
    
    // STEP 1: Set pending action and OPTIMISTIC UI update
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'closeAll' });
    dispatch({ type: 'SYNC_POSITIONS', hasPositions: false, openCount: 0 }); // Optimistic
    dispatch({ type: 'SYNC_STATUS', status: 'idle' }); // Optimistic
    
    // STEP 2: Stop ALL intervals
    clearTickInterval();
    clearPnlRefresh();
    clearAutoTpCheck();
    tickInFlightRef.current = false;
    
    try {
      // STEP 3: Update database FIRST to prevent tick race condition
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('paper_config').update({
          is_running: false,
          session_status: 'idle',
          burst_requested: false,
        } as any).eq('user_id', user.id);
      }
      
      // STEP 4: Call backend ONCE to close positions
      const result = await runTick({ globalClose: true });
      
      // STEP 5: Sync final stats from backend
      if (result?.stats) {
        dispatch({
          type: 'SYNC_PNL',
          pnlToday: result.stats.todayPnl || 0,
          tradesToday: result.stats.tradesToday || 0,
          winRate: result.stats.winRate || 0,
          equity: result.stats.equity || 10000,
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      toast({ 
        title: 'Session Closed', 
        description: `${result?.closedCount || 0} positions closed.` 
      });
      
    } catch (error) {
      console.error('Close all error:', error);
      toast({ title: 'Error', description: 'Failed to close positions', variant: 'destructive' });
    } finally {
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
    
  }, [dispatch, runTick, queryClient, clearTickInterval, clearPnlRefresh, clearAutoTpCheck]);

  // Change mode (only when idle or stopped)
  const changeMode = useCallback(async (newMode: TradingMode) => {
    const state = useSessionStore.getState();
    
    if (state.status !== 'idle' && state.status !== 'stopped') {
      toast({ 
        title: 'Cannot Change Mode', 
        description: 'Stop or close all positions first.',
        variant: 'destructive'
      });
      return;
    }
    
    dispatch({ type: 'SET_MODE', mode: newMode });
    
    // Persist to backend
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const backendMode = MODE_TO_BACKEND[newMode];
      const isBurstMode = newMode === 'burst';
      
      await supabase.from('paper_config').update({
        mode_config: {
          enabledModes: [backendMode],
          modeSettings: {},
        },
        // CRITICAL: Set burst_requested flag when burst mode is selected
        // This flag is required by the backend for burst mode to open trades
        burst_requested: isBurstMode,
      } as any).eq('user_id', user.id);
      
      console.log(`[MODE] Changed to ${newMode}, burst_requested=${isBurstMode}`);
    }
    
    toast({ title: 'Mode Changed', description: `Switched to ${newMode.toUpperCase()} mode` });
  }, [dispatch]);

  // Reset session (clear halted state, reset to idle)
  const resetSession = useCallback(async () => {
    clearTickInterval();
    clearPnlRefresh();
    clearAutoTpCheck();
    
    dispatch({ type: 'RESET' });
    
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('paper_config').update({
        is_running: false,
        session_status: 'idle',
        trading_halted_for_day: false,
        burst_requested: false,
      } as any).eq('user_id', user.id);
    }
    
    toast({ title: 'Session Reset', description: 'Ready to trade again' });
  }, [dispatch, clearTickInterval, clearPnlRefresh, clearAutoTpCheck]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTickInterval();
      clearPnlRefresh();
      clearAutoTpCheck();
    };
  }, [clearTickInterval, clearPnlRefresh, clearAutoTpCheck]);

  return {
    buttonStates,
    activate,
    holdToggle,
    takeProfit,
    closeAll,
    changeMode,
    resetSession,
    refreshPnl,
  };
}
