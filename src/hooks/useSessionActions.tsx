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
  // CRITICAL: Track manual action in progress to block ALL ticks
  const manualActionInProgressRef = useRef(false);
  
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
    // CRITICAL: Block P&L refresh during manual actions to prevent flicker
    if (manualActionInProgressRef.current) {
      return;
    }
    
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
    // CRITICAL: Never run tick if manual action is in progress
    if (manualActionInProgressRef.current && !options?.globalClose && !options?.takeProfit) {
      console.log(`[runTick] Blocked - manual action in progress`);
      return null;
    }
    
    if (tickInFlightRef.current) return null;
    
    const currentStatus = useSessionStore.getState().status;
    const isCloseAction = options?.globalClose || options?.takeProfit;
    
    // Regular ticks only run when session is 'running'
    if (!isCloseAction && !options?.takeBurstProfit) {
      if (currentStatus !== 'running') {
        console.log(`[runTick] Skipping tick - session status is ${currentStatus}`);
        return null;
      }
    }
    
    tickInFlightRef.current = true;
    
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
      tickInFlightRef.current = false;
    }
  }, [queryClient, dispatch]);

  // Start tick interval - only runs when session is RUNNING
  const startTickInterval = useCallback(() => {
    clearTickInterval();
    intervalRef.current = setInterval(async () => {
      const currentStatus = useSessionStore.getState().status;
      const pendingAction = useSessionStore.getState().pendingAction;
      
      // CRITICAL: Do NOT tick if any action is pending OR manual action in progress
      if (pendingAction || manualActionInProgressRef.current) {
        console.log(`[Tick Interval] Skipping - pending: ${pendingAction}, manual: ${manualActionInProgressRef.current}`);
        return;
      }
      
      // Only tick if explicitly running
      if (currentStatus !== 'running') {
        console.log(`[Tick Interval] Skipping - status is ${currentStatus}`);
        return;
      }
      
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
      
      // Only refresh P&L during active sessions
      if (currentStatus !== 'running' && currentStatus !== 'holding') return;
      // Skip during pending actions or manual actions
      if (pendingAction || manualActionInProgressRef.current) return;
      
      await refreshPnl();
    }, PNL_REFRESH_MS);
  }, [clearPnlRefresh, refreshPnl]);

  // Auto TP check - runs while engine is active
  const startAutoTpCheck = useCallback(() => {
    clearAutoTpCheck();
    
    autoTpCheckRef.current = setInterval(async () => {
      const state = useSessionStore.getState();
      const { riskSettings: currentRiskSettings } = useTradingState.getState();
      
      // Only check auto TP when running and no manual action in progress
      if (state.status !== 'running' || manualActionInProgressRef.current) return;
      
      // Get current P&L data
      const { data: stats } = await supabase.functions.invoke('paper-stats');
      if (!stats?.stats) return;
      
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
    }, TICK_INTERVAL_MS * 2);
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
    
    // Set pending action for spinner
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'activate' });
    
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
    } finally {
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
  }, [dispatch, clearAutoTpCheck]);

  // ================================================================
  // TAKE PROFIT - INSTANT, ATOMIC close all positions
  // Session continues unchanged (running stays running, holding stays holding)
  // ================================================================
  const takeProfit = useCallback(async () => {
    const state = useSessionStore.getState();
    
    if (state.status !== 'running' && state.status !== 'holding') {
      return;
    }
    
    // CRITICAL: Set manual action flag FIRST to block ALL other operations
    manualActionInProgressRef.current = true;
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'takeProfit' });
    
    // Optimistic update - positions cleared (status unchanged)
    dispatch({ type: 'TAKE_PROFIT' });
    dispatch({ type: 'SYNC_POSITIONS', hasPositions: false, openCount: 0 });
    
    try {
      // Send takeProfit flag - backend closes all and returns immediately
      // NO mode execution happens on this tick
      const result = await runTick({ takeProfit: true });
      
      // Sync stats from response - this is authoritative
      if (result?.stats) {
        dispatch({
          type: 'SYNC_PNL',
          pnlToday: result.stats.todayPnl || 0,
          tradesToday: result.stats.tradesToday || 0,
          winRate: result.stats.winRate || 0,
          equity: result.stats.equity || 10000,
        });
        dispatch({
          type: 'SYNC_POSITIONS',
          hasPositions: (result.stats.openPositionsCount || 0) > 0,
          openCount: result.stats.openPositionsCount || 0,
        });
      }
      
      // Force immediate query refresh
      await queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      toast({ 
        title: 'Profit Taken', 
        description: `Positions closed. Trading continues.` 
      });
    } catch (error) {
      console.error('Take profit error:', error);
      toast({ title: 'Error', description: 'Failed to take profit', variant: 'destructive' });
    } finally {
      // CRITICAL: Clear manual action flag LAST
      manualActionInProgressRef.current = false;
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
  }, [dispatch, runTick, queryClient]);

  // ================================================================
  // CLOSE ALL - INSTANT, ATOMIC close and full stop
  // Session goes to idle, all intervals stopped
  // ================================================================
  const closeAll = useCallback(async () => {
    // CRITICAL: Set manual action flag and stop ALL intervals FIRST
    manualActionInProgressRef.current = true;
    clearTickInterval();
    clearPnlRefresh();
    clearAutoTpCheck();
    
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'closeAll' });
    
    // Optimistic update - positions cleared, status idle
    dispatch({ type: 'CLOSE_ALL' });
    dispatch({ type: 'SYNC_POSITIONS', hasPositions: false, openCount: 0 });
    dispatch({ type: 'SYNC_STATUS', status: 'idle' });
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // CRITICAL: Update database to idle FIRST, BEFORE calling runTick
      // This prevents ANY race condition where a tick sees 'running' status
      if (user) {
        await supabase.from('paper_config').update({
          is_running: false,
          session_status: 'idle',
          burst_requested: false,
        } as any).eq('user_id', user.id);
      }
      
      // Now call backend to close positions
      // Backend returns immediately after closing - NO mode execution
      const result = await runTick({ globalClose: true });
      
      // Sync stats from response - this is authoritative
      if (result?.stats) {
        dispatch({
          type: 'SYNC_PNL',
          pnlToday: result.stats.todayPnl || 0,
          tradesToday: result.stats.tradesToday || 0,
          winRate: result.stats.winRate || 0,
          equity: result.stats.equity || 10000,
        });
        dispatch({
          type: 'SYNC_POSITIONS',
          hasPositions: (result.stats.openPositionsCount || 0) > 0,
          openCount: result.stats.openPositionsCount || 0,
        });
      }
      
      // Force immediate query refresh
      await queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      toast({ title: 'Session Stopped', description: 'All positions closed. Engine idle.' });
    } catch (error) {
      console.error('Close all error:', error);
      toast({ title: 'Error', description: 'Failed to close positions', variant: 'destructive' });
    } finally {
      // CRITICAL: Clear manual action flag LAST
      manualActionInProgressRef.current = false;
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
  }, [dispatch, runTick, clearTickInterval, clearPnlRefresh, clearAutoTpCheck, queryClient]);

  // Reset session
  const resetSession = useCallback(() => {
    manualActionInProgressRef.current = false;
    clearTickInterval();
    clearPnlRefresh();
    clearAutoTpCheck();
    dispatch({ type: 'RESET' });
  }, [dispatch, clearTickInterval, clearPnlRefresh, clearAutoTpCheck]);

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
      manualActionInProgressRef.current = false;
      clearTickInterval();
      clearPnlRefresh();
      clearAutoTpCheck();
    };
  }, [authSession?.user?.id, dispatch, clearTickInterval, clearPnlRefresh, clearAutoTpCheck]);

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
