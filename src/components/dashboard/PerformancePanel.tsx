import { useState } from 'react';
import { TrendingUp, TrendingDown, Target, Percent } from 'lucide-react';
import { useFullSessionState } from '@/hooks/useSessionState';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';

export function PerformancePanel() {
  const { equity, todayPnl, todayPnlPercent, tradesToday, winRate, status, setStatus } = useFullSessionState();
  const queryClient = useQueryClient();
  const [startingBalanceInput, setStartingBalanceInput] = useState<number>(10000);
  const [isResetting, setIsResetting] = useState(false);

  const botRunning = status === 'running' || status === 'holding';
  const avgRR = 1.5; // Placeholder - would come from stats

  const handleSetBalance = async () => {
    if (botRunning || isResetting) return;

    const v = Number(startingBalanceInput);
    if (!v || v <= 0 || Number.isNaN(v)) {
      toast({ title: 'Invalid Amount', description: 'Enter a valid positive number.', variant: 'destructive' });
      return;
    }

    setIsResetting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Close all open positions
      await supabase.from('paper_positions').delete().eq('user_id', user.id);

      // Clear today's trades
      const today = new Date().toISOString().split('T')[0];
      await supabase.from('paper_trades').delete().eq('user_id', user.id).eq('session_date', today);

      // Reset paper_stats_daily for today
      await supabase.from('paper_stats_daily').upsert({
        user_id: user.id,
        trade_date: today,
        equity_start: v,
        equity_end: v,
        pnl: 0,
        win_rate: 0,
        trades_count: 0,
        max_drawdown: 0,
      }, { onConflict: 'user_id,trade_date' });

      // Set session to idle
      await supabase.from('paper_config').update({
        is_running: false,
        session_status: 'idle',
      } as any).eq('user_id', user.id);

      setStatus('idle');
      queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
      toast({ title: 'Balance Reset', description: `Balance set to $${v.toLocaleString()}` });
    } catch (error) {
      console.error('Reset balance error:', error);
      toast({ title: 'Error', description: 'Failed to reset balance', variant: 'destructive' });
    } finally {
      setIsResetting(false);
    }
  };

  // Generate dummy sparkline data
  const sparklineData = Array.from({ length: 20 }, (_, i) => {
    const base = todayPnl * (i / 20);
    const noise = (Math.random() - 0.5) * Math.abs(todayPnl) * 0.3;
    return base + noise;
  });

  const minVal = Math.min(...sparklineData, 0);
  const maxVal = Math.max(...sparklineData, 1);
  const range = maxVal - minVal || 1;

  const sparklinePoints = sparklineData.map((val, i) => {
    const x = (i / (sparklineData.length - 1)) * 100;
    const y = 100 - ((val - minVal) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  const isPositive = todayPnl >= 0;

  return (
    <div className="glass-panel p-4">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-3">Performance</h3>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            {isPositive ? (
              <TrendingUp className="h-4 w-4 text-success" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
            <span className="text-xs uppercase tracking-wider">Today's P&L</span>
          </div>
          <p className={cn(
            "font-mono text-xl font-bold",
            isPositive ? "profit-text" : "loss-text"
          )}>
            {isPositive ? '+' : ''}${todayPnl.toFixed(2)}
          </p>
          <p className={cn(
            "text-xs font-mono",
            isPositive ? "profit-text" : "loss-text"
          )}>
            {isPositive ? '+' : ''}{todayPnlPercent.toFixed(2)}%
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Target className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider">Trades</span>
          </div>
          <p className="font-mono text-xl font-bold text-foreground">{tradesToday}</p>
          <p className="text-xs text-muted-foreground">Today</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Percent className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider">Win Rate</span>
          </div>
          <p className={cn(
            "font-mono text-xl font-bold",
            winRate >= 50 ? "profit-text" : "text-foreground"
          )}>
            {winRate.toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground">Overall</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider">Avg R:R</span>
          </div>
          <p className="font-mono text-xl font-bold text-foreground">{avgRR.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">R:R</p>
        </div>
      </div>

      {/* Set Balance Control Row */}
      <hr className="border-0 border-t border-border/30 my-3" />
      <div className="flex items-center gap-3">
        <input
          type="number"
          className="flex-1 bg-muted/20 border border-border/40 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-40"
          placeholder="10000"
          value={startingBalanceInput}
          onChange={(e) => setStartingBalanceInput(Number(e.target.value))}
          disabled={botRunning || isResetting}
        />
        <button
          className="bg-gradient-to-r from-primary to-accent px-4 py-2 rounded-lg text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={handleSetBalance}
          disabled={botRunning || isResetting}
        >
          {isResetting ? 'Resetting...' : 'Set Balance'}
        </button>
      </div>
      <hr className="border-0 border-t border-border/30 my-3" />

      {/* P&L Sparkline */}
      <div className="h-16 rounded-lg bg-muted/20 p-2 relative overflow-hidden">
        <svg className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="pnlGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop 
                offset="0%" 
                stopColor={isPositive ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"} 
                stopOpacity="0.3" 
              />
              <stop 
                offset="100%" 
                stopColor={isPositive ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"} 
                stopOpacity="0" 
              />
            </linearGradient>
          </defs>
          
          {/* Zero line */}
          <line
            x1="0"
            y1={100 - ((0 - minVal) / range) * 100 + '%'}
            x2="100%"
            y2={100 - ((0 - minVal) / range) * 100 + '%'}
            stroke="hsl(220 30% 25%)"
            strokeWidth="1"
            strokeDasharray="4"
          />
          
          {/* Area fill */}
          <polygon
            points={`0,100 ${sparklinePoints} 100,100`}
            fill="url(#pnlGradient)"
          />
          
          {/* Line */}
          <polyline
            points={sparklinePoints}
            fill="none"
            stroke={isPositive ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Labels */}
        <div className="absolute top-1 left-2 text-xs text-muted-foreground font-mono">
          P&L over time
        </div>
        <div className="absolute bottom-1 right-2 text-xs font-mono text-foreground">
          ${todayPnl.toFixed(2)}
        </div>
      </div>

      {/* Equity display */}
      <div className="mt-3 p-2.5 rounded-lg bg-muted/20 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Equity</span>
        <span className="font-mono text-sm font-semibold text-foreground">
          ${equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  );
}
