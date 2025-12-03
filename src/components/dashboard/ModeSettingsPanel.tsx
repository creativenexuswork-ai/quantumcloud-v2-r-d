import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useFullSessionState } from '@/hooks/useSessionState';
import { cn } from '@/lib/utils';

export function ModeSettingsPanel() {
  const {
    selectedMode,
    riskSettings,
    updateRiskSettings,
    modeConfig,
    updateModeConfig,
  } = useFullSessionState();

  const showBurstScalperControls = selectedMode === 'burst' || selectedMode === 'scalper';
  const showTrendControls = selectedMode === 'trend';

  return (
    <div className="glass-panel p-4 space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Mode Settings
      </h3>

      {/* Mode-Specific Controls */}
      {showBurstScalperControls && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Trades/Run</Label>
            <Input
              type="number"
              value={modeConfig.burstTradesPerRun}
              onChange={(e) => updateModeConfig({ burstTradesPerRun: parseInt(e.target.value) || 20 })}
              className="h-8 bg-muted/30 border-border/50 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Max Concurrent</Label>
            <Input
              type="number"
              value={modeConfig.maxConcurrentPositions}
              onChange={(e) => updateModeConfig({ maxConcurrentPositions: parseInt(e.target.value) || 5 })}
              className="h-8 bg-muted/30 border-border/50 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Duration</Label>
            <Select 
              value={modeConfig.burstDuration} 
              onValueChange={(v: 'short' | 'medium' | 'long') => updateModeConfig({ burstDuration: v })}
            >
              <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="short">Short</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="long">Long</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">TP Style</Label>
            <Select 
              value={modeConfig.burstTpStyle} 
              onValueChange={(v: 'fast' | 'scaled') => updateModeConfig({ burstTpStyle: v })}
            >
              <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
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

      {showTrendControls && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Timeframe</Label>
            <Select 
              value={modeConfig.trendTimeframe} 
              onValueChange={(v: 'intraday' | 'daily' | 'weekly') => updateModeConfig({ trendTimeframe: v })}
            >
              <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="intraday">Intraday</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Sensitivity</Label>
            <Select 
              value={modeConfig.signalSensitivity} 
              onValueChange={(v: 'low' | 'medium' | 'high') => updateModeConfig({ signalSensitivity: v })}
            >
              <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Risk Controls */}
      <div className="space-y-3 pt-3 border-t border-border/30">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Risk Controls</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground uppercase">Max DD: {riskSettings.maxDailyDrawdown}%</Label>
            <Slider
              value={[riskSettings.maxDailyDrawdown]}
              onValueChange={([v]) => updateRiskSettings({ maxDailyDrawdown: v })}
              min={1}
              max={10}
              step={0.5}
              className="py-1"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground uppercase">Per-Trade: {riskSettings.maxPerTradeRisk}%</Label>
            <Slider
              value={[riskSettings.maxPerTradeRisk]}
              onValueChange={([v]) => updateRiskSettings({ maxPerTradeRisk: v })}
              min={0.25}
              max={3}
              step={0.25}
              className="py-1"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Position Sizing</Label>
            <Select 
              value={riskSettings.positionSizingMode} 
              onValueChange={(v: 'fixed' | 'percent' | 'volatility') => updateRiskSettings({ positionSizingMode: v })}
            >
              <SelectTrigger className="h-8 bg-muted/30 border-border/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed Size</SelectItem>
                <SelectItem value="percent">% of Equity</SelectItem>
                <SelectItem value="volatility">Vol Adjusted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground uppercase">Target: {riskSettings.dailyProfitTarget}%</Label>
            <Slider
              value={[riskSettings.dailyProfitTarget]}
              onValueChange={([v]) => updateRiskSettings({ dailyProfitTarget: v })}
              min={2}
              max={20}
              step={1}
              className="py-1"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
