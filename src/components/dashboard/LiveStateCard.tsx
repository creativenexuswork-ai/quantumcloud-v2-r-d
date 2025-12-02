import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Square } from 'lucide-react';
import { useTrading } from '@/context/TradingContext';
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
  const { activeMode, activeSymbol, regime, status } = tradingState;

  const modeInfo = activeMode ? MODE_DEFINITIONS[activeMode as ModeKey] : null;

  const handleStart = () => {
    if (activeSymbol) {
      startMode('quantum', activeSymbol);
    }
  };

  const handleStop = () => {
    stopMode();
  };

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold">Live State & Mode</CardTitle>
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
            <span className="text-sm text-muted-foreground">Status</span>
            <span className={`text-sm font-medium ${
              status === 'scanning' ? 'text-primary animate-pulse' :
              status === 'in_trade' ? 'text-success' :
              status === 'error' ? 'text-destructive' :
              'text-muted-foreground'
            }`}>
              {status.replace('_', ' ').toUpperCase()}
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
            disabled={status !== 'idle'}
            className="flex-1 gap-2"
          >
            <Play className="h-4 w-4" />
            Start Mode
          </Button>
          <Button 
            onClick={handleStop}
            disabled={status === 'idle'}
            variant="destructive"
            className="flex-1 gap-2"
          >
            <Square className="h-4 w-4" />
            Stop Mode
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
