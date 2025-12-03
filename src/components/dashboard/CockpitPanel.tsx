import { Zap, Crosshair, TrendingUp, Brain, Loader2, Power, DollarSign, Pause, XCircle, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TradingMode, useFullSessionState } from '@/hooks/useSessionState';
import { useTradingSession, usePaperStats } from '@/hooks/usePaperTrading';
import { toast } from '@/hooks/use-toast';

const MODES: { key: TradingMode; label: string; icon: typeof Zap }[] = [
  { key: 'burst', label: 'BURST', icon: Zap },
  { key: 'scalper', label: 'SCALPER', icon: Crosshair },
  { key: 'trend', label: 'TREND', icon: TrendingUp },
];

export function CockpitPanel() {
  const {
    selectedMode,
    setSelectedMode,
    todayPnl,
    tradesToday,
    status,
  } = useFullSessionState();

  const { 
    startSession, 
    stopSession, 
    holdSession, 
    resumeSession,
    globalClose, 
    takeBurstProfit,
    tickInFlight 
  } = useTradingSession();
  
  const { data: paperData } = usePaperStats();
  const openPositionsCount = paperData?.stats?.openPositionsCount || 0;

  // Session state - single source of truth from useSession store
  const isIdle = status === 'idle';
  const isRunning = status === 'running';
  const isHolding = status === 'holding';
  const isStopped = status === 'stopped';
  const hasPositions = openPositionsCount > 0;

  // Mode change handler
  const handleModeChange = (mode: TradingMode) => {
    if (isRunning || isHolding) {
      toast({ title: 'Mode Locked', description: 'Stop the engine before changing mode.' });
      return;
    }
    setSelectedMode(mode);
  };

  // ACTIVATE: Enabled only when idle or stopped
  const handleActivate = () => {
    if (isRunning || isHolding) return; // Silently ignore - button should be disabled
    startSession();
  };

  // TAKE PROFIT: Close all + stop session
  const handleTakeProfit = () => {
    if (!hasPositions || (!isRunning && !isHolding)) return;
    takeBurstProfit();
    stopSession();
  };

  // HOLD: Toggle running <-> holding
  const handleHold = () => {
    if (isIdle || isStopped) return;
    if (isRunning) holdSession();
    else if (isHolding) resumeSession();
  };

  // CLOSE ALL: Emergency close all positions
  const handleCloseAll = () => {
    if (!hasPositions) return;
    globalClose();
  };

  // Strict button enabled states
  const activateEnabled = (isIdle || isStopped) && !tickInFlight;
  const takeProfitEnabled = hasPositions && (isRunning || isHolding) && !tickInFlight;
  const holdEnabled = (isRunning || isHolding) && !tickInFlight;
  const closeAllEnabled = hasPositions && !tickInFlight;

  const getStatusLabel = () => {
    if (isStopped) return 'STOPPED';
    if (isHolding) return 'HOLDING';
    if (isRunning) return 'RUNNING';
    return 'IDLE';
  };

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
          const isSelected = selectedMode === key;
          const isLocked = isRunning || isHolding;
          return (
            <button
              key={key}
              onClick={() => handleModeChange(key)}
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
          onClick={handleActivate}
          disabled={!activateEnabled}
          className={cn("ctrl-btn ctrl-btn-primary", isRunning && "ctrl-btn-active")}
        >
          {tickInFlight ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
          <span>ACTIVATE</span>
        </button>

        <button
          onClick={handleTakeProfit}
          disabled={!takeProfitEnabled}
          className="ctrl-btn ctrl-btn-success"
        >
          <DollarSign className="h-3.5 w-3.5" />
          <span>TAKE PROFIT</span>
        </button>

        <button
          onClick={handleHold}
          disabled={!holdEnabled}
          className={cn("ctrl-btn ctrl-btn-outline", isHolding && "ctrl-btn-holding")}
        >
          {isHolding ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          <span>{isHolding ? 'RESUME' : 'HOLD'}</span>
        </button>

        <button
          onClick={handleCloseAll}
          disabled={!closeAllEnabled}
          className="ctrl-btn ctrl-btn-danger"
        >
          <XCircle className="h-3.5 w-3.5" />
          <span>CLOSE ALL</span>
        </button>
      </div>

      {/* Row 5: Session Mini-Row */}
      <div className="session-row justify-center">
        <span className="session-label">Session:</span>
        <span className={cn(
          "session-status",
          isRunning && "text-success",
          isHolding && "text-warning",
          (isStopped || isIdle) && "text-muted-foreground"
        )}>
          {getStatusLabel()}
        </span>
        <span className="session-sep">·</span>
        <span>P&L:</span>
        <span className={cn("session-pnl font-mono", todayPnl >= 0 ? "text-success" : "text-destructive")}>
          {todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(2)}
        </span>
        <span className="session-sep">·</span>
        <span>Trades:</span>
        <span className="session-trades">{tradesToday}</span>
        {hasPositions && (
          <>
            <span className="session-sep">·</span>
            <span>Open:</span>
            <span className="text-primary font-medium">{openPositionsCount}</span>
          </>
        )}
      </div>
    </div>
  );
}
