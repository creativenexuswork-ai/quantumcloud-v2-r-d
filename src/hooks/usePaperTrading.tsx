import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from './use-toast';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

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

      if (!response.ok) throw new Error('Failed to fetch stats');
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
      }>;
    },
    enabled: !!session,
    refetchInterval: 30000, // Refresh every 30s when not actively trading
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
  const [isActive, setIsActive] = useState(false);
  const [stats, setStats] = useState<PaperStats | null>(null);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [halted, setHalted] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const queryClient = useQueryClient();

  const tick = useCallback(async () => {
    if (!session) return;

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession?.access_token) return;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) return;
      const data = await response.json();

      setStats(data.stats);
      setPositions(data.positions || []);
      setHalted(data.halted || false);

      if (data.halted) {
        toast({
          title: 'Trading Halted',
          description: 'Daily loss limit reached. Trading paused for the day.',
          variant: 'destructive',
        });
        setIsActive(false);
      }
    } catch (error) {
      console.error('Tick error:', error);
    }
  }, [session]);

  const startSession = useCallback(() => {
    if (halted) {
      toast({
        title: 'Cannot Start',
        description: 'Trading is halted for the day due to risk limits.',
        variant: 'destructive',
      });
      return;
    }
    setIsActive(true);
    tick(); // Initial tick
    intervalRef.current = setInterval(tick, 5000); // Tick every 5s
  }, [tick, halted]);

  const stopSession = useCallback(() => {
    setIsActive(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const triggerBurst = useCallback(async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession?.access_token) return;

    await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ burstRequested: true }),
    });

    toast({ title: 'Burst Triggered', description: 'Burst mode activated' });
    queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
  }, [queryClient]);

  const takeBurstProfit = useCallback(async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession?.access_token) return;

    await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ takeBurstProfit: true }),
    });

    toast({ title: 'Burst Profit Taken', description: 'All burst positions closed' });
    queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
  }, [queryClient]);

  const globalClose = useCallback(async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession?.access_token) return;

    await fetch(`${SUPABASE_URL}/functions/v1/paper-tick`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${currentSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ globalClose: true }),
    });

    toast({ title: 'Global Close', description: 'All positions closed' });
    queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
  }, [queryClient]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    isActive,
    stats,
    positions,
    halted,
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

      const { error } = await supabase
        .from('paper_config')
        .update({
          ...updates as any,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      toast({ title: 'Config Updated', description: 'Settings saved' });
    },
  });

  return { updateConfig };
}

export function useSymbols() {
  return useQuery({
    queryKey: ['symbols'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('symbols')
        .select('*')
        .order('symbol');

      if (error) throw error;
      return data;
    },
  });
}

export function useSystemLogs() {
  const { session } = useAuth();

  return useQuery({
    queryKey: ['system-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return data;
    },
    enabled: !!session,
    refetchInterval: 10000,
  });
}
