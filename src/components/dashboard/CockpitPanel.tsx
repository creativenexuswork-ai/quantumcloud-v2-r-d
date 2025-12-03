import { Zap, Crosshair, TrendingUp, Brain, Loader2, Power, DollarSign, Pause, XCircle, Play } from 'lucide-react';
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

  return (
    <div className="cockpit-panel">
      {/* Row 1: Ticker Mini-Strip */}
      <div className="ticker-strip justify-center">
        <span className="ticker-symbol">BTC/USDT</span>
        <span className="ticker-sep">·</span>
        <span className="ticker-price">$48,229.50</span>
        <span className="ticker-sep">·</span>
        <span className="ticker-change positive">+1.2%</span>
        <span className="ticker-tf">(1m)</span>
      </div>

      {/* Row 2: Mode Selector */}
      <div className="mode-row">
        {MODES.map(({ key, label, icon: Icon }) => {
          const isSelected = mode === key;
          const isLocked = !canChangeMode;
          return (
            <button
              key={key}
              onClick={() => changeMode(key)}
              disabled={isLocked && !isSelected}
              className={cn("mode-pill", isSelected && "mode-pill-active")}
            >
              <Icon className="h-3 w-3" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Row 3: AI Engine Status Line */}
      <div className="ai-status-line justify-center">
        <Brain className="h-3 w-3 text-primary" />
        <span className="ai-label">AI:</span>
        <span className="ai-active">Active</span>
        <span className="ai-sep">·</span>
        <span>Regime:</span>
        <span className="ai-value">Trending</span>
        <span className="ai-sep">·</span>
        <span>Target:</span>
        <span className="ai-value text-success">+2.5%</span>
      </div>

      {/* Row 4: Control Grid - 2x2 */}
      <div className="control-grid">
        <button
          onClick={activateSession}
          disabled={!canActivate}
          className={cn(
            "ctrl-btn ctrl-btn-primary",
            status === 'running' && "ctrl-btn-active"
          )}
        >
          {isArming || tickInFlight ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Power className="h-3.5 w-3.5" />
          )}
          <span>{isArming ? 'ARMING...' : 'ACTIVATE'}</span>
        </button>

        <button
          onClick={takeProfit}
          disabled={!canTakeProfit}
          className="ctrl-btn ctrl-btn-success"
        >
          <DollarSign className="h-3.5 w-3.5" />
          <span>TAKE PROFIT</span>
        </button>

        <button
          onClick={toggleHold}
          disabled={!canHold}
          className={cn("ctrl-btn ctrl-btn-outline", isHolding && "ctrl-btn-holding")}
        >
          {isHolding ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          <span>{isHolding ? 'RESUME' : 'HOLD'}</span>
        </button>

        <button
          onClick={closeAllPositions}
          disabled={!canCloseAll}
          className="ctrl-btn ctrl-btn-danger"
        >
          <XCircle className="h-3.5 w-3.5" />
          <span>CLOSE ALL</span>
        </button>
      </div>

      {/* Row 5: Session Mini-Row */}
      <div className="session-row justify-center">
        <span className="session-label">Session:</span>
        <span className={cn("session-status", STATUS_COLORS[status])}>
          {STATUS_LABELS[status]}
        </span>
        <span className="session-sep">·</span>
        <span>P&L:</span>
        <span className={cn("session-pnl font-mono", pnlToday >= 0 ? "text-success" : "text-destructive")}>
          {pnlToday >= 0 ? '+' : ''}${pnlToday.toFixed(2)}
        </span>
        <span className="session-sep">·</span>
        <span>Trades:</span>
        <span className="session-trades">{tradesToday}</span>
        {openCount > 0 && (
          <>
            <span className="session-sep">·</span>
            <span>Open:</span>
            <span className="text-primary font-medium">{openCount}</span>
          </>
        )}
      </div>

      {/* Error message if present */}
      {lastError && status === 'error' && (
        <div className="text-[10px] text-destructive text-center mt-1 px-2 truncate">
          {lastError}
        </div>
      )}
    </div>
  );
}
