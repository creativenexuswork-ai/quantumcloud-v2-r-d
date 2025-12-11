import { useState } from 'react';
import { TrendingUp, TrendingDown, Target, Percent, RotateCcw } from 'lucide-react';
import { useFullSessionState } from '@/hooks/useSessionState';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/use-toast';
import { resetEngine } from '@/lib/trading/resetEngine';
import { handleSessionEnd as handleSessionEndRuntime } from '@/lib/trading/resetSession';
import { usePaperAccountReset } from '@/hooks/usePaperAccountReset';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function PerformancePanel() {
  const { equity, todayPnl, todayPnlPercent, tradesToday, winRate, status, setStatus } = useFullSessionState();
  const queryClient = useQueryClient();
  const [startingBalanceInput, setStartingBalanceInput] = useState<number>(10000);
  const [isResetting, setIsResetting] = useState(false);
  const { resetPaperAccount, isResetting: isAccountResetting } = usePaperAccountReset();

  const botRunning = status === 'running' || status === 'holding';
  const anyResetInProgress = isResetting || isAccountResetting;
  const avgRR = 1.5; // Placeholder - would come from stats

  const handleSetBalance = async () => {
    if (botRunning || anyResetInProgress) return;

    const v = Number(startingBalanceInput);
    if (!v || v <= 0 || Number.isNaN(v)) {
      toast({ title: 'Invalid Amount', description: 'Enter a valid positive number.', variant: 'destructive' });
      return;
    }

    setIsResetting(true);
    try {
      // Reset runtime state first
      handleSessionEndRuntime('manual_reset', false);
      
      // Then reset database state with new balance
      const result = await resetEngine({
        reason: 'set_balance',
        keepRunning: false,
        newPaperBalance: v,
      });

      if (result.success) {
        setStatus('idle');
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
        toast({ title: 'Balance Reset', description: `Starting balance set to $${v.toLocaleString()} and engine reset.` });
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to reset balance', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Set balance error:', error);
      toast({ title: 'Error', description: 'Failed to set balance', variant: 'destructive' });
    } finally {
      setIsResetting(false);
    }
  };

  const handleResetOnly = async () => {
    if (botRunning || anyResetInProgress) return;

    setIsResetting(true);
    try {
      // Reset runtime state first
      handleSessionEndRuntime('manual_reset', false);
      
      // Then reset database state
      const result = await resetEngine({
        reason: 'manual_reset',
        keepRunning: false,
      });

      if (result.success) {
        setStatus('idle');
        queryClient.invalidateQueries({ queryKey: ['paper-stats'] });
        toast({ title: 'Engine Reset', description: 'Positions, stats and guards cleared.' });
      } else {
        toast({ title: 'Error', description: result.error || 'Failed to reset', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Reset error:', error);
      toast({ title: 'Error', description: 'Failed to reset engine', variant: 'destructive' });
    } finally {
      setIsResetting(false);
    }
  };

  const handleFullAccountReset = async () => {
    if (botRunning || anyResetInProgress) return;

    // Also reset runtime state
    handleSessionEndRuntime('manual_reset', false);
    setStatus('idle');
    
    const result = await resetPaperAccount();
    if (result.success) {
      // State is already updated by the hook
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
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="number"
          className="flex-1 min-w-[100px] bg-muted/20 border border-border/40 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-40"
          placeholder="10000"
          value={startingBalanceInput}
          onChange={(e) => setStartingBalanceInput(Number(e.target.value))}
          disabled={botRunning || anyResetInProgress}
        />
        <button
          className="bg-gradient-to-r from-primary to-accent px-4 py-2.5 rounded-[10px] text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          onClick={handleSetBalance}
          disabled={botRunning || anyResetInProgress}
        >
          {isResetting ? 'Resetting...' : 'Set Balance'}
        </button>
        <button
          className="bg-foreground/5 border border-foreground/10 px-3.5 py-2.5 rounded-[10px] text-[0.85rem] font-medium text-foreground/85 backdrop-blur-sm transition-all hover:bg-foreground/10 disabled:opacity-35 disabled:cursor-not-allowed whitespace-nowrap"
          onClick={handleResetOnly}
          disabled={botRunning || anyResetInProgress}
        >
          Reset
        </button>
      </div>
      
      {/* Full Account Reset Button */}
      <div className="mt-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="w-full flex items-center justify-center gap-2 bg-destructive/10 border border-destructive/30 px-4 py-2.5 rounded-[10px] text-sm font-medium text-destructive transition-all hover:bg-destructive/20 disabled:opacity-35 disabled:cursor-not-allowed"
                onClick={handleFullAccountReset}
                disabled={botRunning || anyResetInProgress}
              >
                <RotateCcw className={cn("h-4 w-4", isAccountResetting && "animate-spin")} />
                <span>{isAccountResetting ? 'Resetting Account...' : 'Reset Paper Account (10k)'}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[250px]">
              <p>Reset paper balance and stats back to $10,000. Closes all open paper positions and clears halt flags.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
