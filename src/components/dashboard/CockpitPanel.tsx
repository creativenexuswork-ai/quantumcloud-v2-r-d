import { Zap, Crosshair, TrendingUp, Brain, Target, Loader2, Power, DollarSign, Pause, XCircle, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TradingMode, useFullSessionState } from '@/hooks/useSessionState';
import { useTradingSession, usePaperStats } from '@/hooks/usePaperTrading';
import { SessionStatus } from '@/lib/state/session';
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

  // Session state helpers
  const isIdle = status === 'idle';
  const isRunning = status === 'running';
  const isHolding = status === 'holding';
  const isStopped = status === 'stopped';
  const isActive = isRunning || isHolding;
  const hasPositions = openPositionsCount > 0;

  // Mode change handler
  const handleModeChange = (mode: TradingMode) => {
    if (isActive) {
      toast({
        title: 'Mode Locked',
        description: 'Stop or hold the engine before changing mode.',
      });
      return;
    }
    setSelectedMode(mode);
  };

  // Control handlers with proper state machine
  const handleActivate = () => {
    if (isRunning || isHolding) {
      toast({ title: 'Already Active', description: 'Engine is already running.' });
      return;
    }
    startSession();
  };

  const handleTakeProfit = () => {
    if (!hasPositions) {
      toast({ title: 'No Positions', description: 'No open positions to close.' });
      return;
    }
    if (!isActive) {
      toast({ title: 'Engine Inactive', description: 'Engine must be running or holding.' });
      return;
    }
    takeBurstProfit();
    stopSession();
  };

  const handleHold = () => {
    if (!isActive) {
      toast({ title: 'Engine Inactive', description: 'Activate the engine first.' });
      return;
    }
    if (isRunning) {
      holdSession();
    } else if (isHolding) {
      resumeSession();
    }
  };

  const handleCloseAll = () => {
    if (!hasPositions) {
      toast({ title: 'No Positions', description: 'No open positions to close.' });
      return;
    }
    globalClose();
  };

  // Button enabled states
  const activateEnabled = (isIdle || isStopped) && !tickInFlight;
  const takeProfitEnabled = hasPositions && isActive && !tickInFlight;
  const holdEnabled = isActive && !tickInFlight;
  const closeAllEnabled = hasPositions && !tickInFlight;

  // Status display
  const getStatusLabel = () => {
    if (isStopped) return 'STOPPED';
    return status.toUpperCase();
  };

  return (
    <div className="cockpit-panel">
      {/* Row 1: Ticker Mini-Strip */}
      <div className="ticker-strip">
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
          return (
            <button
              key={key}
              onClick={() => handleModeChange(key)}
              disabled={isActive}
              className={cn(
                "mode-pill",
                isSelected && "mode-pill-active",
                isActive && !isSelected && "opacity-50 cursor-not-allowed"
              )}
            >
              <Icon className="h-3 w-3" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Row 3: AI Engine Status Line */}
      <div className="ai-status-line">
        <Brain className="h-3 w-3 text-primary" />
        <span className="ai-label">AI Engine:</span>
        <span className="ai-active">Active</span>
        <span className="ai-sep">·</span>
        <span>Regime:</span>
        <span className="ai-value">Trending</span>
        <span className="ai-sep">·</span>
        <span>Target:</span>
        <span className="ai-value text-success">+2.5%</span>
        <span className="ai-sep">·</span>
        <span>Conf:</span>
        <span className="ai-value">78%</span>
      </div>

      {/* Row 4: Control Grid */}
      <div className="control-grid">
        <button
          onClick={handleActivate}
          disabled={!activateEnabled}
          className={cn(
            "ctrl-btn ctrl-btn-primary",
            isRunning && "ctrl-btn-active"
          )}
        >
          {tickInFlight ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Power className="h-4 w-4" />
          )}
          <span>ACTIVATE</span>
        </button>

        <button
          onClick={handleTakeProfit}
          disabled={!takeProfitEnabled}
          className="ctrl-btn ctrl-btn-success"
        >
          <DollarSign className="h-4 w-4" />
          <span>TAKE PROFIT</span>
        </button>

        <button
          onClick={handleHold}
          disabled={!holdEnabled}
          className={cn(
            "ctrl-btn ctrl-btn-outline",
            isHolding && "ctrl-btn-holding"
          )}
        >
          {isHolding ? (
            <Play className="h-4 w-4" />
          ) : (
            <Pause className="h-4 w-4" />
          )}
          <span>{isHolding ? 'RESUME' : 'HOLD'}</span>
        </button>

        <button
          onClick={handleCloseAll}
          disabled={!closeAllEnabled}
          className="ctrl-btn ctrl-btn-danger"
        >
          <XCircle className="h-4 w-4" />
          <span>CLOSE ALL</span>
        </button>
      </div>

      {/* Row 5: Session Mini-Row */}
      <div className="session-row">
        <span className="session-label">Session:</span>
        <span className={cn(
          "session-status",
          isRunning && "text-success",
          isHolding && "text-warning",
          isStopped && "text-muted-foreground"
        )}>
          {getStatusLabel()}
        </span>
        <span className="session-sep">·</span>
        <span>P&L:</span>
        <span className={cn(
          "session-pnl font-mono",
          todayPnl >= 0 ? "text-success" : "text-destructive"
        )}>
          {todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(2)}
        </span>
        <span className="session-sep">·</span>
        <span>Trades:</span>
        <span className="session-trades">{tradesToday}</span>
        {hasPositions && (
          <>
            <span className="session-sep">·</span>
            <span>Open:</span>
            <span className="session-open text-primary">{openPositionsCount}</span>
          </>
        )}
      </div>
    </div>
  );
}
