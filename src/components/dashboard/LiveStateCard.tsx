import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Square } from 'lucide-react';
import { useTrading } from '@/context/TradingContext';
import { useTradingSession, usePaperStats } from '@/hooks/usePaperTrading';
import { MODE_DEFINITIONS, ModeKey } from '@/hooks/useModeConfigs';

const regimeColors: Record<string, string> = {
  trend: 'bg-success/20 text-success',
  range: 'bg-warning/20 text-warning',
  high_vol: 'bg-destructive/20 text-destructive',
  low_vol: 'bg-muted text-muted-foreground',
  news_risk: 'bg-primary/20 text-primary',
};

export function LiveStateCard() {
  const { tradingState, startMode, stopMode } = useTrading();
  const { isActive, startSession, stopSession, halted, positions } = useTradingSession();
  const { data: paperData } = usePaperStats();
  
  const { activeMode, activeSymbol, regime, status } = tradingState;
  const modeInfo = activeMode ? MODE_DEFINITIONS[activeMode as ModeKey] : null;
  const openPositions = paperData?.stats?.openPositionsCount || positions.length;

  const handleStart = () => {
    if (halted) return;
    startSession();
    if (activeSymbol) {
      startMode('quantum', activeSymbol);
    }
  };

  const handleStop = () => {
    stopSession();
    stopMode();
  };

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Live State & Mode</CardTitle>
          {halted && (
            <Badge variant="destructive">Trading Halted</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {modeInfo && (
              <>
                <span className="text-2xl">{modeInfo.icon}</span>
                <div>
                  <p className="font-medium">{modeInfo.name}</p>
                  <Badge variant="outline" className={`text-xs ${
                    modeInfo.risk === 'Safe' ? 'border-success text-success' :
                    modeInfo.risk === 'Aggressive' ? 'border-destructive text-destructive' :
                    'border-warning text-warning'
                  }`}>
                    {modeInfo.risk}
                  </Badge>
                </div>
              </>
            )}
            {!modeInfo && (
              <p className="text-muted-foreground">No mode active</p>
            )}
          </div>
          {isActive && (
            <Badge className="bg-success/20 text-success animate-pulse">
              Session Active
            </Badge>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Symbol</span>
            <span className="font-mono font-medium">{activeSymbol || 'BTCUSDT'}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Market Regime</span>
            {regime ? (
              <Badge className={regimeColors[regime]}>
                {regime.replace('_', ' ').toUpperCase()}
              </Badge>
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Open Positions</span>
            <span className="font-medium">{openPositions}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Status</span>
            <span className={`text-sm font-medium ${
              isActive ? 'text-success animate-pulse' :
              halted ? 'text-destructive' :
              status === 'error' ? 'text-destructive' :
              'text-muted-foreground'
            }`}>
              {halted ? 'HALTED' : isActive ? 'RUNNING' : status.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        </div>

        {activeMode && (
          <p className="text-xs text-muted-foreground">
            {modeInfo?.name} scanning {activeSymbol} on 5m / 15m
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <Button 
            onClick={handleStart}
            disabled={isActive || halted}
            className="flex-1 gap-2"
          >
            <Play className="h-4 w-4" />
            Start Session
          </Button>
          <Button 
            onClick={handleStop}
            disabled={!isActive}
            variant="destructive"
            className="flex-1 gap-2"
          >
            <Square className="h-4 w-4" />
            Stop Session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}