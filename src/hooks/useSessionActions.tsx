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

  // Run a single tick - NO LONGER touches pendingAction (that's for user actions only)
  const runTick = useCallback(async (options?: { globalClose?: boolean; takeBurstProfit?: boolean; takeProfit?: boolean }) => {
    if (tickInFlightRef.current) return null;
    
    // CRITICAL: Before running tick, check if session is still running
    // Skip regular ticks if session is idle/stopped (but allow globalClose/takeProfit through)
    const currentStatus = useSessionStore.getState().status;
    const isCloseAction = options?.globalClose || options?.takeProfit;
    
    if (!isCloseAction && !options?.takeBurstProfit) {
      if (currentStatus !== 'running' && currentStatus !== 'holding') {
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
      
      // Sync session status from backend (important for Close All)
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
      
      // CRITICAL: Do NOT tick if any action is pending (user clicked a button)
      if (pendingAction) {
        console.log(`[Tick Interval] Skipping - pending action: ${pendingAction}`);
        return;
      }
      
      // Only tick if explicitly running - NOT holding, idle, or stopped
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
      
      // Only refresh P&L during active sessions (running or holding)
      if (currentStatus !== 'running' && currentStatus !== 'holding') return;
      // Skip during pending actions to avoid flicker
      if (pendingAction) return;
      
      await refreshPnl();
    }, PNL_REFRESH_MS);
  }, [clearPnlRefresh, refreshPnl]);

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
      // Always clear pending action when done
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

  // Immediate stats refresh helper
  const refreshStats = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
  }, [queryClient]);

  // TAKE PROFIT - Close all positions INSTANTLY, session continues unchanged
  const takeProfit = useCallback(async () => {
    const state = useSessionStore.getState();
    
    if (state.status !== 'running' && state.status !== 'holding') {
      return;
    }
    
    // Set pending immediately to disable buttons
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'takeProfit' });
    
    // Optimistic update - show positions closed (status stays the same)
    dispatch({ type: 'SYNC_POSITIONS', hasPositions: false, openCount: 0 });
    dispatch({ type: 'TAKE_PROFIT' }); // Clears positions, status unchanged
    
    try {
      // Close all positions via backend - returns immediately with stats
      // CRITICAL: takeProfit flag makes backend close positions and return early
      // NO new trades are opened on this tick
      const result = await runTick({ takeProfit: true });
      
      // Sync stats from result IMMEDIATELY - this is the authoritative data
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
      
      // Force immediate query refresh for any other listeners
      await queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      toast({ 
        title: 'Profit Taken', 
        description: 'Positions closed. Trading continues.' 
      });
    } catch (error) {
      console.error('Take profit error:', error);
      toast({ title: 'Error', description: 'Failed to take profit', variant: 'destructive' });
    } finally {
      // Clear pending action - buttons become active again
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
  }, [dispatch, runTick, queryClient]);

  // CLOSE ALL - Emergency close and full stop (FAST, NO NEW TRADES EVER)
  const closeAll = useCallback(async () => {
    // IMMEDIATELY stop ALL intervals FIRST - this is critical
    clearTickInterval();
    clearPnlRefresh();
    clearAutoTpCheck();
    
    dispatch({ type: 'SET_PENDING_ACTION', pendingAction: 'closeAll' });
    
    // Optimistic update - immediately show positions closed and status idle
    dispatch({ type: 'CLOSE_ALL' });
    dispatch({ type: 'SYNC_POSITIONS', hasPositions: false, openCount: 0 });
    dispatch({ type: 'SYNC_STATUS', status: 'idle' });
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // CRITICAL: Update database to idle FIRST, BEFORE calling runTick
      // This prevents any race condition where a tick sees 'running' status
      if (user) {
        await supabase.from('paper_config').update({
          is_running: false,
          session_status: 'idle',
          burst_requested: false,
        } as any).eq('user_id', user.id);
      }
      
      // Now call backend global close to actually close positions
      // The backend returns early after closing - NO mode execution happens
      const result = await runTick({ globalClose: true });
      
      // Sync stats from result IMMEDIATELY - this is the authoritative data
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
      // Clear pending action - buttons become active again
      dispatch({ type: 'SET_PENDING_ACTION', pendingAction: null });
    }
  }, [dispatch, runTick, clearTickInterval, clearPnlRefresh, clearAutoTpCheck, queryClient]);

  // Reset session
  const resetSession = useCallback(() => {
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
