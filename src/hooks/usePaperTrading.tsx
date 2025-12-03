import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from './use-toast';
import { useSession } from '@/lib/state/session';


const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const TICK_INTERVAL_MS = 4000;

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
}

export function usePaperStats() {
  const { session } = useAuth();

  return useQuery({
    queryKey: ['paper-stats'],
    queryFn: async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) throw new Error('Not authenticated');

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-stats`, {
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          'Content-Type': 'application/json',
        },
      });

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
      }>;
    },
    enabled: !!session,
    refetchInterval: 4000, // Poll every 4 seconds to match tick interval
    retry: 2,
    staleTime: 2000, // Consider data stale after 2 seconds
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options || {}),
      });

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
  const setRunning = (val: boolean) => setStatus(val ? 'running' : 'idle');
  const [halted, setHalted] = useState(false);
  const [tickInFlight, setTickInFlight] = useState(false);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRunningRef = useRef(false);
  const tickInFlightRef = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    tickInFlightRef.current = tickInFlight;
  }, [tickInFlight]);

  const runTickInternal = useCallback(async (): Promise<{ halted: boolean } | null> => {
    if (tickInFlightRef.current) return null;
    
    tickInFlightRef.current = true;
    setTickInFlight(true);
    
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) {
        return null;
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        console.error('Tick failed:', response.status);
        return null;
      }
      
      const data = await response.json();
      setHalted(data.halted || false);
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });

      return { halted: data.halted || false };
    } catch (error) {
      console.error('Tick error:', error);
      return null;
    } finally {
      tickInFlightRef.current = false;
      setTickInFlight(false);
    }
  }, [queryClient]);

  const stopSessionInternal = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRunning(false);
    isRunningRef.current = false;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('paper_config').update({ is_running: false } as any).eq('user_id', user.id);
      }
    } catch (e) {
      console.error('Failed to update is_running:', e);
    }
  }, [setRunning]);

  const startSession = useCallback(async () => {
    if (halted || isRunning) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('paper_config').update({ 
        is_running: true, 
        session_started_at: new Date().toISOString() 
      } as any).eq('user_id', user.id);

      await supabase.from('system_logs').insert({
        user_id: user.id, 
        level: 'info', 
        source: 'execution',
        message: 'Trading session started',
      });

      setRunning(true);
      isRunningRef.current = true;
      
      const result = await runTickInternal();
      
      if (result?.halted) {
        toast({
          title: 'Trading Halted',
          description: 'Daily loss limit reached.',
          variant: 'destructive',
        });
        await stopSessionInternal();
        return;
      }
      
      intervalRef.current = setInterval(async () => {
        if (!isRunningRef.current) return;
        
        const tickResult = await runTickInternal();
        if (tickResult?.halted) {
          toast({
            title: 'Trading Halted',
            description: 'Daily loss limit reached.',
            variant: 'destructive',
          });
          await stopSessionInternal();
        }
      }, TICK_INTERVAL_MS);
      
      toast({ title: 'Session Started', description: 'Trading engine running' });
    } catch (error) {
      console.error('Start session error:', error);
      toast({ title: 'Error', description: 'Failed to start session', variant: 'destructive' });
    }
  }, [halted, isRunning, runTickInternal, stopSessionInternal, setRunning]);

  const stopSession = useCallback(async () => {
    await stopSessionInternal();
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('system_logs').insert({
        user_id: user.id, 
        level: 'info', 
        source: 'execution',
        message: 'Trading session stopped',
      });
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      toast({ title: 'Session Stopped' });
    } catch (error) {
      console.error('Stop session error:', error);
    }
  }, [stopSessionInternal, queryClient]);

  const triggerBurst = useCallback(async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${currentSession.access_token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ burstRequested: true }),
      });
      
      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
    } catch (error) {
      console.error('Burst trigger error:', error);
      toast({ title: 'Error', description: 'Failed to trigger burst', variant: 'destructive' });
    }
  }, [queryClient]);

  const takeBurstProfit = useCallback(async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${currentSession.access_token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ takeBurstProfit: true }),
      });
      
      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
      
      toast({ title: 'Burst Profit Taken' });
    } catch (error) {
      console.error('Take burst profit error:', error);
      toast({ title: 'Error', description: 'Failed to take burst profit', variant: 'destructive' });
    }
  }, [queryClient]);

  const globalClose = useCallback(async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;
      
      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${currentSession.access_token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ globalClose: true }),
      });
      
      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      }
      
      toast({ title: 'Global Close', description: 'All positions closed' });
    } catch (error) {
      console.error('Global close error:', error);
      toast({ title: 'Error', description: 'Failed to close positions', variant: 'destructive' });
    }
  }, [queryClient]);

  useEffect(() => {
    let mounted = true;
    
    async function checkSessionState() {
      if (!session) return;
      
      try {
        const { data: config } = await supabase
          .from('paper_config')
          .select('is_running, trading_halted_for_day')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (!mounted) return;

        if (config) {
          setHalted(config.trading_halted_for_day || false);
          
          if ((config as any).is_running && !config.trading_halted_for_day) {
            setRunning(true);
            isRunningRef.current = true;
            
            const result = await runTickInternal();
            
            if (!mounted) return;
            
            if (result?.halted) {
              await stopSessionInternal();
              return;
            }
            
            intervalRef.current = setInterval(async () => {
              if (!isRunningRef.current) return;
              
              const tickResult = await runTickInternal();
              if (tickResult?.halted) {
                await stopSessionInternal();
              }
            }, TICK_INTERVAL_MS);
          }
        }
      } catch (error) {
        console.error('Check session state error:', error);
      }
    }
    
    checkSessionState();
    
    return () => {
      mounted = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [session?.user?.id, setRunning]);

  return {
    isActive: isRunning, 
    halted, 
    tickInFlight,
    startSession, 
    stopSession, 
    triggerBurst, 
    takeBurstProfit, 
    globalClose,
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
        .eq('is_active', true)
        .order('symbol');

      if (error) throw error;
      return data as Array<{
        id: string;
        symbol: string;
        name: string;
        type: string;
        is_active: boolean;
        spread_estimate: number | null;
      }>;
    },
    enabled: !!session,
  });
}
