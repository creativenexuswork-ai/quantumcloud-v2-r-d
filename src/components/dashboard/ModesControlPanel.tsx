import { Play, Pause, Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useFullSessionState, MODE_INFO, TradingMode } from '@/hooks/useSessionState';
import { useTradingSession } from '@/hooks/usePaperTrading';
import { cn } from '@/lib/utils';

const MODES: TradingMode[] = ['burst', 'scalper', 'trend', 'swing', 'memory', 'sniper', 'risk-off', 'ai-assist'];

export function ModesControlPanel() {
  const {
    selectedMode,
    setSelectedMode,
    riskSettings,
    updateRiskSettings,
    modeConfig,
    updateModeConfig,
    todayPnl,
    tradesToday,
    status,
  } = useFullSessionState();

  const { startSession, stopSession, globalClose, tickInFlight } = useTradingSession();

  const modeInfo = MODE_INFO[selectedMode];

  return (
    <div className="glass-panel p-6 space-y-6">
      {/* Mode Selector */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Select Mode</h3>
        <div className="flex flex-wrap gap-2">
          {MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => setSelectedMode(mode)}
              className={cn(
                "capitalize",
                selectedMode === mode ? 'pill-active' : 'pill-inactive'
              )}
            >
              {mode.replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Mode Summary */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground">{modeInfo.name}</h3>
        <p className="text-sm text-muted-foreground">{modeInfo.description}</p>
      </div>

      {/* Mode-Specific Controls */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-muted-foreground">Mode Controls</h4>
        
        {(selectedMode === 'burst' || selectedMode === 'scalper') && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Trades per Run</Label>
              <Input
                type="number"
                value={modeConfig.burstTradesPerRun}
                onChange={(e) => updateModeConfig({ burstTradesPerRun: parseInt(e.target.value) || 20 })}
                className="bg-muted/30 border-border/50"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Max Concurrent</Label>
              <Input
                type="number"
                value={modeConfig.maxConcurrentPositions}
                onChange={(e) => updateModeConfig({ maxConcurrentPositions: parseInt(e.target.value) || 5 })}
                className="bg-muted/30 border-border/50"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Duration</Label>
              <Select 
                value={modeConfig.burstDuration} 
                onValueChange={(v: 'short' | 'medium' | 'long') => updateModeConfig({ burstDuration: v })}
              >
                <SelectTrigger className="bg-muted/30 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">Short</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="long">Long</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">TP Style</Label>
              <Select 
                value={modeConfig.burstTpStyle} 
                onValueChange={(v: 'fast' | 'scaled') => updateModeConfig({ burstTpStyle: v })}
              >
                <SelectTrigger className="bg-muted/30 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">Fast TP</SelectItem>
                  <SelectItem value="scaled">Scaled TP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {(selectedMode === 'trend' || selectedMode === 'swing') && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Timeframe</Label>
              <Select 
                value={modeConfig.trendTimeframe} 
                onValueChange={(v: 'intraday' | 'daily' | 'weekly') => updateModeConfig({ trendTimeframe: v })}
              >
                <SelectTrigger className="bg-muted/30 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="intraday">Intraday</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Signal Sensitivity</Label>
              <Select 
                value={modeConfig.signalSensitivity} 
                onValueChange={(v: 'low' | 'medium' | 'high') => updateModeConfig({ signalSensitivity: v })}
              >
                <SelectTrigger className="bg-muted/30 border-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label className="text-xs text-muted-foreground">Max Positions</Label>
              <Input
                type="number"
                value={modeConfig.maxConcurrentPositions}
                onChange={(e) => updateModeConfig({ maxConcurrentPositions: parseInt(e.target.value) || 5 })}
                className="bg-muted/30 border-border/50"
              />
            </div>
          </div>
        )}

        {(selectedMode === 'memory' || selectedMode === 'ai-assist') && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Lookback Window</Label>
              <Input
                type="number"
                value={modeConfig.lookbackWindow}
                onChange={(e) => updateModeConfig({ lookbackWindow: parseInt(e.target.value) || 50 })}
                className="bg-muted/30 border-border/50"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Confidence: {(modeConfig.confidenceThreshold * 100).toFixed(0)}%</Label>
              <Slider
                value={[modeConfig.confidenceThreshold * 100]}
                onValueChange={([v]) => updateModeConfig({ confidenceThreshold: v / 100 })}
                min={30}
                max={95}
                step={5}
                className="py-2"
              />
            </div>
          </div>
        )}

        {(selectedMode === 'sniper' || selectedMode === 'risk-off') && (
          <div className="p-4 rounded-lg bg-muted/20 border border-border/30">
            <p className="text-sm text-muted-foreground">
              {selectedMode === 'sniper' 
                ? 'Sniper mode uses default high-confidence settings. Waits for optimal entry conditions.'
                : 'Risk-Off mode reduces all position sizes and widens stops. Use during uncertain markets.'}
            </p>
          </div>
        )}
      </div>

      {/* Core Controls */}
      <div className="space-y-4 pt-4 border-t border-border/30">
        <div className="flex gap-2">
          <Button
            onClick={startSession}
            disabled={status === 'running' || tickInFlight}
            className="flex-1 btn-glow gap-2"
          >
            {tickInFlight ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {status === 'running' ? 'Running...' : 'Start Session'}
          </Button>
          <Button
            variant="outline"
            onClick={stopSession}
            disabled={status !== 'running'}
            className="gap-2"
          >
            <Pause className="h-4 w-4" />
            Pause
          </Button>
          <Button
            variant="destructive"
            onClick={globalClose}
            className="gap-2"
          >
            <Square className="h-4 w-4" />
            Stop
          </Button>
        </div>

        {/* Session Status */}
        <div className="grid grid-cols-3 gap-4 p-3 rounded-lg bg-muted/20">
          <div>
            <p className="text-xs text-muted-foreground">Session</p>
            <p className="font-medium text-foreground capitalize">{status}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Today's P&L</p>
            <p className={cn(
              "font-mono font-medium",
              todayPnl >= 0 ? "profit-text" : "loss-text"
            )}>
              {todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Trades</p>
            <p className="font-medium text-foreground">{tradesToday}</p>
          </div>
        </div>
      </div>

      {/* Risk HUD */}
      <div className="space-y-4 pt-4 border-t border-border/30">
        <h4 className="text-sm font-medium text-muted-foreground">Risk HUD</h4>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Max Daily Drawdown: {riskSettings.maxDailyDrawdown}%</Label>
            <Slider
              value={[riskSettings.maxDailyDrawdown]}
              onValueChange={([v]) => updateRiskSettings({ maxDailyDrawdown: v })}
              min={1}
              max={10}
              step={0.5}
              className="py-2"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Per-Trade Risk: {riskSettings.maxPerTradeRisk}%</Label>
            <Slider
              value={[riskSettings.maxPerTradeRisk]}
              onValueChange={([v]) => updateRiskSettings({ maxPerTradeRisk: v })}
              min={0.25}
              max={3}
              step={0.25}
              className="py-2"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Position Sizing</Label>
            <Select 
              value={riskSettings.positionSizingMode} 
              onValueChange={(v: 'fixed' | 'percent' | 'volatility') => updateRiskSettings({ positionSizingMode: v })}
            >
              <SelectTrigger className="bg-muted/30 border-border/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed Size</SelectItem>
                <SelectItem value="percent">% of Equity</SelectItem>
                <SelectItem value="volatility">Volatility Adjusted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Daily Target: {riskSettings.dailyProfitTarget}%</Label>
            <Slider
              value={[riskSettings.dailyProfitTarget]}
              onValueChange={([v]) => updateRiskSettings({ dailyProfitTarget: v })}
              min={2}
              max={20}
              step={1}
              className="py-2"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
