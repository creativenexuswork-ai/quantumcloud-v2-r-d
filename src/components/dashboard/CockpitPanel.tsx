import { Zap, Crosshair, TrendingUp, Brain, Loader2, Power, DollarSign, Pause, XCircle, Play, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  useSessionMachine, 
  useSessionButtons, 
  TradingMode,
  STATUS_LABELS,
  STATUS_COLORS 
} from '@/lib/state/sessionMachine';
import { useSessionActions } from '@/hooks/useSessionActions';

const MODES: { key: TradingMode; label: string; icon: typeof Zap }[] = [
  { key: 'burst', label: 'BURST', icon: Zap },
  { key: 'scalper', label: 'SCALPER', icon: Crosshair },
  { key: 'trend', label: 'TREND', icon: TrendingUp },
];

export function CockpitPanel() {
  const { 
    status, 
    mode, 
    pnlToday, 
    tradesToday, 
    openCount, 
    tickInFlight,
    lastError,
  } = useSessionMachine();
  
  const { canActivate, canTakeProfit, canHold, canCloseAll, canChangeMode, isHolding, isArming } = useSessionButtons();
  const { activateSession, toggleHold, takeProfit, closeAllPositions, changeMode } = useSessionActions();

  // Mock price data - in real app this would come from market data hook
  const priceChange = 1.2;
  const isPositiveChange = priceChange >= 0;

  return (
    <div className="bg-slate-900/80 rounded-2xl border border-slate-700/60 shadow-lg px-4 py-3 space-y-3">
      {/* Row 1: Symbol + Price + Change */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs tracking-wide text-slate-400 uppercase font-medium">BTC/USDT</span>
        <span className="text-lg font-semibold text-slate-50 font-mono">$48,229.50</span>
        <span className={cn(
          "text-sm font-semibold font-mono",
          isPositiveChange ? "text-emerald-400" : "text-red-400"
        )}>
          {isPositiveChange ? '+' : ''}{priceChange.toFixed(1)}%
        </span>
      </div>

      {/* Row 2: Mode Pills */}
      <div className="flex gap-2">
        {MODES.map(({ key, label, icon: Icon }) => {
          const isSelected = mode === key;
          const isLocked = !canChangeMode;
          return (
            <button
              key={key}
              onClick={() => changeMode(key)}
              disabled={isLocked && !isSelected}
              className={cn(
                "flex-1 min-w-0 rounded-full border px-3 py-2 flex items-center justify-center gap-1.5 transition-all",
                isSelected 
                  ? "bg-blue-600/80 border-blue-400/80 shadow-[0_0_16px_rgba(37,99,235,0.6)] text-slate-50" 
                  : "bg-slate-900/90 border-slate-700/70 text-slate-300 hover:bg-slate-800/80",
                (isLocked && !isSelected) && "opacity-50 cursor-not-allowed"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="text-sm font-semibold">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Row 3: AI Engine Strip */}
      <div className="flex items-center justify-between gap-2 text-xs text-slate-300 py-1">
        <div className="flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-slate-400">AI Engine</span>
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            status === 'running' ? "bg-emerald-500/20 text-emerald-300" :
            status === 'arming' ? "bg-amber-500/20 text-amber-300" :
            status === 'error' ? "bg-red-500/20 text-red-300" :
            "bg-slate-700/50 text-slate-400"
          )}>
            {status === 'running' ? 'Active' : status === 'arming' ? 'Arming' : status === 'error' ? 'Error' : 'Idle'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Regime:</span>
          <span className="text-slate-200 font-medium">Trending</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Target:</span>
          <span className="text-emerald-400 font-mono font-medium">+2.5%</span>
        </div>
      </div>

      {/* Row 4: 2x2 Control Button Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* ACTIVATE */}
        <button
          onClick={activateSession}
          disabled={!canActivate}
          className={cn(
            "h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all",
            canActivate 
              ? "bg-blue-600/90 hover:bg-blue-500 text-slate-50 shadow-lg shadow-blue-600/20" 
              : "bg-blue-600/40 text-slate-50/60 cursor-not-allowed"
          )}
        >
          {isArming || tickInFlight ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Power className="h-4 w-4" />
          )}
          <span>{isArming ? 'ARMING...' : 'ACTIVATE'}</span>
        </button>

        {/* TAKE PROFIT */}
        <button
          onClick={takeProfit}
          disabled={!canTakeProfit}
          className={cn(
            "h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all",
            canTakeProfit 
              ? "bg-emerald-600/90 hover:bg-emerald-500 text-slate-50 shadow-lg shadow-emerald-600/20" 
              : "bg-emerald-600/30 text-slate-50/50 cursor-not-allowed"
          )}
        >
          <DollarSign className="h-4 w-4" />
          <span>TAKE PROFIT</span>
        </button>

        {/* HOLD */}
        <button
          onClick={toggleHold}
          disabled={!canHold}
          className={cn(
            "h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all",
            !canHold 
              ? "bg-slate-800/50 text-slate-500 cursor-not-allowed" 
              : isHolding 
                ? "bg-amber-600/30 border border-amber-500/50 text-amber-300 hover:bg-amber-600/40" 
                : "bg-slate-800/90 hover:bg-slate-700 text-slate-100 border border-slate-700/50"
          )}
        >
          {isHolding ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          <span>{isHolding ? 'RESUME' : 'HOLD'}</span>
        </button>

        {/* CLOSE ALL */}
        <button
          onClick={closeAllPositions}
          disabled={!canCloseAll}
          className={cn(
            "h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all",
            canCloseAll 
              ? "bg-red-600/90 hover:bg-red-500 text-slate-50 shadow-lg shadow-red-600/20" 
              : "bg-red-600/30 text-slate-50/50 cursor-not-allowed"
          )}
        >
          <XCircle className="h-4 w-4" />
          <span>CLOSE ALL</span>
        </button>
      </div>

      {/* Row 5: Session Status Strip */}
      <div className="flex items-center justify-between text-[11px] text-slate-300 pt-2 border-t border-slate-800/80">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">Session:</span>
          <span className={cn(
            "font-bold uppercase",
            status === 'running' ? "text-emerald-400" :
            status === 'holding' ? "text-amber-300" :
            status === 'error' ? "text-red-400" :
            "text-slate-400"
          )}>
            {STATUS_LABELS[status]}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-500">P&L:</span>
          <span className={cn(
            "font-mono font-semibold",
            pnlToday >= 0 ? "text-emerald-400" : "text-red-400"
          )}>
            {pnlToday >= 0 ? '+' : ''}${pnlToday.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Trades:</span>
          <span className="text-slate-200 font-medium">{tradesToday}</span>
        </div>
        {openCount > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Open:</span>
            <span className="text-blue-400 font-semibold">{openCount}</span>
          </div>
        )}
      </div>

      {/* Error message if present */}
      {lastError && status === 'error' && (
        <div className="text-[10px] text-red-400 text-center px-2 truncate bg-red-500/10 rounded py-1">
          {lastError}
        </div>
      )}
    </div>
  );
}
