import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, getAuthSession } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from './use-toast';
import { useSession, SessionStatus } from '@/lib/state/session';
import { 
  resetSessionState, 
  handleSessionEnd as handleSessionEndRuntime,
  type SessionEndReason 
} from '@/lib/trading/resetSession';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * Handle 401 responses from Edge Functions - logs and notifies user without touching engine logic.
 */
function handle401Response(endpoint: string): never {
  console.warn(`QuantumCloud auth expired – 401 from ${endpoint}`);
  toast({
    title: 'Session Expired',
    description: 'Please log out and log back in to continue.',
    variant: 'destructive',
  });
  throw new Error('AUTH_EXPIRED');
}

export interface PaperStats {
  equity: number;
  todayPnl: number;
  todayPnlPercent: number;
  winRate: number;
  avgRR: number;
  tradesToday: number;
  maxDrawdown: number;
  openPositionsCount: number;
  burstPnlToday: number;
  burstsToday: number;
  burstStatus: 'idle' | 'running' | 'locked';
}

interface PaperPosition {
  id: string;
  user_id: string;
  symbol: string;
  mode: string;
  side: string;
  size: number;
  entry_price: number;
  sl?: number;
  tp?: number;
  opened_at: string;
  unrealized_pnl: number;
  batch_id?: string;
}

interface PaperTrade {
  id: string;
  user_id: string;
  symbol: string;
  mode: string;
  side: string;
  size: number;
  entry_price: number;
  exit_price: number;
  realized_pnl: number;
  reason?: string;
  opened_at: string;
  closed_at: string;
  session_date: string;
}

interface PaperConfig {
  risk_config: {
    maxDailyLossPercent: number;
    maxConcurrentRiskPercent: number;
  };
  burst_config: {
    size: number;
    dailyProfitTargetPercent: number;
  };
  mode_config: {
    enabledModes: string[];
    modeSettings: Record<string, unknown>;
  };
  market_config: {
    selectedSymbols: string[];
    typeFilters: Record<string, boolean>;
  };
  trading_halted_for_day: boolean;
  burst_requested: boolean;
  use_ai_reasoning: boolean;
  show_advanced_explanations: boolean;
  is_running?: boolean;
  session_status?: SessionStatus;
}

export function usePaperStats() {
  const { session } = useAuth();

  return useQuery({
    queryKey: ['paper-stats'],
    queryFn: async () => {
      const session = await getAuthSession();

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-stats`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401) {
        handle401Response('paper-stats');
      }

      if (!response.ok) {
        console.error('Paper stats fetch failed:', response.status, response.statusText);
        throw new Error('Failed to fetch stats');
      }
      return response.json() as Promise<{
        stats: PaperStats;
        positions: PaperPosition[];
        trades: PaperTrade[];
        historicalStats: Array<{
          trade_date: string;
          equity_end: number;
          pnl: number;
          win_rate: number;
        }>;
        symbols: Array<{
          id: string;
          symbol: string;
          name: string;
          type: string;
          is_active: boolean;
        }>;
        logs: Array<{
          id: string;
          level: string;
          source: string;
          message: string;
          created_at: string;
        }>;
        config: PaperConfig;
        halted: boolean;
        sessionStatus: SessionStatus;
      }>;
    },
    enabled: !!session,
    // UNIFIED TIMING: Polling disabled here - useSessionActions.tsx owns all timing
    refetchInterval: false,
    retry: 2,
    staleTime: Infinity,
  });
}

export function usePaperTick() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options?: {
      burstRequested?: boolean;
      globalClose?: boolean;
      takeBurstProfit?: boolean;
    }) => {
      const session = await getAuthSession();

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options || {}),
      });

      if (response.status === 401) {
        handle401Response('paper-tick');
      }

      if (!response.ok) throw new Error('Failed to run tick');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
    },
  });
}

export function useTradingSession() {
  const { session } = useAuth();
  const { status, setStatus } = useSession();
  const isRunning = status === 'running';
  const isHolding = status === 'holding';
  const [halted, setHalted] = useState(false);
  const [tickInFlight, setTickInFlight] = useState(false);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const statusRef = useRef<SessionStatus>('idle');
  const tickInFlightRef = useRef(false);
  const queryClient = useQueryClient();

  // Sync status ref with state
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    tickInFlightRef.current = tickInFlight;
  }, [tickInFlight]);

  const runTickInternal = useCallback(async (): Promise<{ halted: boolean; sessionStatus: SessionStatus } | null> => {
    if (tickInFlightRef.current) return null;
    
    tickInFlightRef.current = true;
    setTickInFlight(true);
    
    try {
      const session = await getAuthSession();

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (response.status === 401) {
        console.warn('QuantumCloud auth expired – 401 from paper-tick (tick loop)');
        // Don't show toast here to avoid spam during tick loop, just return null
        return null;
      }

      if (!response.ok) {
        console.error('Tick failed:', response.status);
        return null;
      }
      
      const data = await response.json();
      setHalted(data.halted || false);
      
      // Sync status from backend
      if (data.sessionStatus && data.sessionStatus !== statusRef.current) {
        setStatus(data.sessionStatus);
      }
      
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });

      return { halted: data.halted || false, sessionStatus: data.sessionStatus || 'running' };
    } catch (error) {
      // Don't log AUTH errors as they're handled above
      if (error instanceof Error && !error.message.startsWith('AUTH_')) {
        console.error('Tick error:', error);
      }
      return null;
    } finally {
      tickInFlightRef.current = false;
      setTickInFlight(false);
    }
  }, [queryClient, setStatus]);

  const clearTickInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTickInterval = useCallback(() => {
    clearTickInterval();
    intervalRef.current = setInterval(async () => {
      // Only tick if running or holding (holding still needs to manage positions)
      if (statusRef.current !== 'running' && statusRef.current !== 'holding') return;
      
      const tickResult = await runTickInternal();
      if (tickResult?.halted) {
        toast({
          title: 'Trading Halted',
          description: 'Daily loss limit reached.',
          variant: 'destructive',
        });
        clearTickInterval();
        setStatus('idle');
      }
    }, 2000);
  }, [runTickInternal, clearTickInterval, setStatus]);

  // Start session - begin trading
  const startSession = useCallback(async () => {
    if (halted || status === 'running') return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update database with running status
      await supabase.from('paper_config').update({ 
        is_running: true, 
        session_status: 'running',
        session_started_at: new Date().toISOString() 
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id, 
        level: 'info', 
        source: 'execution',
        message: 'SESSION: Started - trading engine active',
      });

      setStatus('running');
      
      // Run immediate tick
      const result = await runTickInternal();
      
      if (result?.halted) {
        toast({
          title: 'Trading Halted',
          description: 'Daily loss limit reached.',
          variant: 'destructive',
        });
        await supabase.from('paper_config').update({ 
          is_running: false, 
          session_status: 'idle' 
        } as any).eq('user_id', user.id);
        setStatus('idle');
        return;
      }
      
      startTickInterval();
      toast({ title: 'Session Started', description: 'Trading engine running' });
    } catch (error) {
      console.error('Start session error:', error);
      toast({ title: 'Error', description: 'Failed to start session', variant: 'destructive' });
    }
  }, [halted, status, runTickInternal, startTickInterval, setStatus]);

  // Hold session - stop new trades but manage existing positions
  const holdSession = useCallback(async () => {
    if (status !== 'running') return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update database with holding status - is_running stays true for position management
      await supabase.from('paper_config').update({ 
        session_status: 'holding'
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id, 
        level: 'info', 
        source: 'execution',
        message: 'SESSION: Holding - no new trades; managing existing positions only',
      });

      setStatus('holding');
      // Keep the interval running for position management
      toast({ title: 'Session On Hold', description: 'Managing existing positions only' });
    } catch (error) {
      console.error('Hold session error:', error);
      toast({ title: 'Error', description: 'Failed to hold session', variant: 'destructive' });
    }
  }, [status, setStatus]);

  // Resume session - continue trading from holding state
  const resumeSession = useCallback(async () => {
    if (status !== 'holding') return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Update database with running status
      await supabase.from('paper_config').update({ 
        session_status: 'running'
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id, 
        level: 'info', 
        source: 'execution',
        message: 'SESSION: Resumed - trading engine active',
      });

      setStatus('running');
      toast({ title: 'Session Resumed', description: 'Trading engine active' });
    } catch (error) {
      console.error('Resume session error:', error);
      toast({ title: 'Error', description: 'Failed to resume session', variant: 'destructive' });
    }
  }, [status, setStatus]);

  // Stop session - stop engine completely (no global close)
  const stopSession = useCallback(async () => {
    clearTickInterval();
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('paper_config').update({ 
        is_running: false, 
        session_status: 'idle' 
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id, 
        level: 'info', 
        source: 'execution',
        message: 'SESSION: Stopped - engine idle',
      });

      setStatus('idle');
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      toast({ title: 'Session Stopped' });
    } catch (error) {
      console.error('Stop session error:', error);
    }
  }, [clearTickInterval, queryClient, setStatus]);

  // Dispatch session end - resets runtime state and optionally restarts
  // CRITICAL: autoRestart is the INVERSE of autoTpStopAfterHit
  // - autoRestart = true  → continuous mode (keep running after TP)
  // - autoRestart = false → stop after TP (go idle)
  const dispatchSessionEnd = useCallback(async (reason: SessionEndReason, autoRestart: boolean = false) => {
    console.log(`[dispatchSessionEnd] reason=${reason}, autoRestart=${autoRestart}`);
    
    // Reset runtime state first (in-memory state)
    handleSessionEndRuntime(reason, status === 'running');
    
    // Then handle database-level reset
    const { onSessionEnd } = await import('@/lib/trading/resetEngine');
    
    clearTickInterval();
    
    // CRITICAL: Map autoRestart to autoTpStopAfterHit correctly
    // autoRestart = true  means stopAfterHit = false (continuous)
    // autoRestart = false means stopAfterHit = true (stop after TP)
    const stopAfterHit = !autoRestart;
    
    console.log(`[dispatchSessionEnd] Calling onSessionEnd with stopAfterHit=${stopAfterHit}`);
    const result = await onSessionEnd(
      reason as 'auto_tp' | 'max_dd' | 'risk_guard' | 'manual_stop',
      stopAfterHit
    );
    
    if (result.success) {
      // Set UI status based on whether we're restarting
      const newStatus = autoRestart ? 'running' : 'idle';
      setStatus(newStatus);
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      // Restart tick interval if auto-restarting (continuous mode)
      if (autoRestart) {
        console.log('[dispatchSessionEnd] Auto-restarting tick interval for continuous mode');
        startTickInterval();
      }
    }
    
    return result;
  }, [clearTickInterval, setStatus, queryClient, status, startTickInterval]);

  // Trigger burst mode
  const triggerBurst = useCallback(async () => {
    try {
      const session = await getAuthSession();
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${session.access_token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ burstRequested: true }),
      });
      
      if (response.status === 401) {
        handle401Response('paper-tick');
      }
      
      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
    } catch (error) {
      console.error('Burst trigger error:', error);
      toast({ title: 'Error', description: 'Failed to trigger burst', variant: 'destructive' });
    }
  }, [queryClient]);

  // Take burst profit - closes positions and triggers SESSION_END
  // Reads autoTpStopAfterHit from database config to determine behavior:
  // - stopAfterHit = true  → close positions, reset, stay idle
  // - stopAfterHit = false → close positions, reset, auto-restart (continuous)
  const takeBurstProfit = useCallback(async () => {
    console.log('[takeBurstProfit] Starting burst profit take');
    
    try {
      const session = await getAuthSession();
      
      // Fetch the autoTpStopAfterHit setting from paper_config.burst_config
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('[takeBurstProfit] No user found');
        return;
      }
      
      const { data: config } = await supabase
        .from('paper_config')
        .select('burst_config')
        .eq('user_id', user.id)
        .single();
      
      // Read the stopAfterHit setting from burst_config
      // Default to true (stop after TP) if setting not found
      const burstConfig = config?.burst_config as { autoTpStopAfterHit?: boolean } | null;
      const stopAfterHit = burstConfig?.autoTpStopAfterHit ?? true;
      
      console.log(`[takeBurstProfit] Config: stopAfterHit=${stopAfterHit} (continuous=${!stopAfterHit})`);
      
      // Call edge function to close burst positions
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${session.access_token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ takeBurstProfit: true }),
      });
      
      if (response.status === 401) {
        handle401Response('paper-tick');
      }
      
      if (response.ok) {
        // Dispatch SESSION_END with the correct autoRestart flag
        // autoRestart = true when stopAfterHit = false (continuous mode)
        // autoRestart = false when stopAfterHit = true (stop after TP)
        const autoRestart = !stopAfterHit;
        console.log(`[takeBurstProfit] Dispatching session end: autoRestart=${autoRestart}`);
        await dispatchSessionEnd('auto_tp', autoRestart);
        
        const message = stopAfterHit 
          ? 'Burst profit taken - session stopped'
          : 'Burst profit taken - restarting with fresh baseline';
        toast({ title: 'Burst Profit Taken', description: message });
      }
    } catch (error) {
      console.error('Take burst profit error:', error);
      toast({ title: 'Error', description: 'Failed to take burst profit', variant: 'destructive' });
    }
  }, [dispatchSessionEnd]);

  // Global close - close all positions and stop session using centralized reset
  const globalClose = useCallback(async () => {
    try {
      const session = await getAuthSession();
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${session.access_token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ globalClose: true }),
      });
      
      if (response.status === 401) {
        handle401Response('paper-tick');
      }
      
      if (response.ok) {
        // Stop the session after global close
        clearTickInterval();
        
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('paper_config').update({ 
            is_running: false, 
            session_status: 'idle' 
          } as any).eq('user_id', user.id);
        }
        
        setStatus('idle');
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
      
      toast({ title: 'Global Close', description: 'All positions closed, session stopped' });
    } catch (error) {
      console.error('Global close error:', error);
      toast({ title: 'Error', description: 'Failed to close positions', variant: 'destructive' });
    }
  }, [queryClient, clearTickInterval, setStatus]);

  // Handle session end events (Auto-TP, max-loss, etc.) using centralized reset
  const handleSessionEnd = useCallback(async (reason: 'auto_tp' | 'max_dd' | 'risk_guard' | 'manual_stop', autoTpStopAfterHit: boolean = true) => {
    const { onSessionEnd } = await import('@/lib/trading/resetEngine');
    
    clearTickInterval();
    
    const result = await onSessionEnd(reason, autoTpStopAfterHit);
    
    if (result.success) {
      setStatus(result.reason === 'auto_tp' && !autoTpStopAfterHit ? 'running' : 'idle');
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      
      const messages: Record<string, string> = {
        auto_tp: autoTpStopAfterHit ? 'Auto Take Profit hit - session stopped' : 'Auto Take Profit hit - restarting with fresh baseline',
        max_dd: 'Max daily drawdown hit - session stopped',
        risk_guard: 'Risk guard triggered - session stopped',
        manual_stop: 'Session stopped manually',
      };
      
      toast({ 
        title: 'Session Ended', 
        description: messages[reason] || 'Session ended',
        variant: reason === 'auto_tp' && !autoTpStopAfterHit ? 'default' : 'destructive'
      });
    }
  }, [clearTickInterval, setStatus, queryClient]);

  // Initialize session state on mount
  useEffect(() => {
    let mounted = true;
    
    async function checkSessionState() {
      if (!session) return;
      
      try {
        const { data: config } = await supabase
          .from('paper_config')
          .select('is_running, trading_halted_for_day, session_status')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (!mounted) return;

        if (config) {
          const effectiveHalted = config.trading_halted_for_day || false;
          setHalted(effectiveHalted);
          
          // Restore session status from backend
          const backendStatus = (config as any).session_status as SessionStatus || 'idle';
          setStatus(backendStatus);
          
          // Start tick if running or holding and not halted
          const shouldStartTick = !effectiveHalted && (backendStatus === 'running' || backendStatus === 'holding');
          
          if (shouldStartTick) {
            const result = await runTickInternal();
            
            if (!mounted) return;
            
            if (result?.halted) {
              await supabase.from('paper_config').update({ 
                is_running: false, 
                session_status: 'idle' 
              } as any).eq('user_id', session.user.id);
              setStatus('idle');
              return;
            }
            
            startTickInterval();
          }
        }
      } catch (error) {
        console.error('Check session state error:', error);
      }
    }
    
    checkSessionState();
    
    return () => {
      mounted = false;
      clearTickInterval();
    };
  }, [session?.user?.id, setStatus, runTickInternal, startTickInterval, clearTickInterval]);

  return {
    isActive: isRunning, 
    isHolding,
    halted, 
    tickInFlight,
    startSession, 
    holdSession,
    resumeSession,
    stopSession, 
    triggerBurst, 
    takeBurstProfit, 
    globalClose,
    handleSessionEnd,
    dispatchSessionEnd,
  };
}

export function usePaperConfig() {
  const queryClient = useQueryClient();

  const updateConfig = useMutation({
    mutationFn: async (updates: Partial<{
      risk_config: Record<string, unknown>;
      burst_config: Record<string, unknown>;
      mode_config: Record<string, unknown>;
      market_config: Record<string, unknown>;
      use_ai_reasoning: boolean;
      show_advanced_explanations: boolean;
    }>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('paper_config').update({
        ...updates,
        updated_at: new Date().toISOString(),
      } as any).eq('user_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      toast({ title: 'Settings saved' });
    },
    onError: (error) => {
      console.error('Config update error:', error);
      toast({ title: 'Error', description: 'Failed to save settings', variant: 'destructive' });
    },
  });

  return { updateConfig };
}

export function useSymbols() {
  const { session } = useAuth();

  return useQuery({
    queryKey: ['symbols'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('symbols')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });
}
