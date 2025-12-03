import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, Power, DollarSign, X } from 'lucide-react';
import { useTradingSession, usePaperStats } from '@/hooks/usePaperTrading';

export function BurstControlCard() {
  const { triggerBurst, takeBurstProfit, globalClose } = useTradingSession();
  const { data: paperData } = usePaperStats();
  
  const stats = paperData?.stats;
  const burstStatus = stats?.burstStatus || 'idle';
  const isLocked = burstStatus === 'locked';
  const isRunning = burstStatus === 'running';

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Burst Control
          </CardTitle>
          {isLocked && (
            <Badge className="bg-success/20 text-success">
              Target Reached
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="metric-label">Today P&L</p>
            <p className={`metric-value text-lg ${
              (stats?.burstPnlToday || 0) >= 0 ? 'profit-text' : 'loss-text'
            }`}>
              {(stats?.burstPnlToday || 0) >= 0 ? '+' : ''}{(stats?.burstPnlToday || 0).toFixed(2)}%
            </p>
          </div>
          <div className="text-center">
            <p className="metric-label">Bursts Today</p>
            <p className="metric-value text-lg">{stats?.burstsToday || 0}</p>
          </div>
          <div className="text-center">
            <p className="metric-label">Status</p>
            <p className={`text-sm font-medium ${
              isRunning ? 'text-success' :
              isLocked ? 'text-warning' : 'text-muted-foreground'
            }`}>
              {isRunning ? 'Running' : isLocked ? 'Locked' : 'Idle'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={triggerBurst}
            disabled={isLocked || isRunning}
            className="gap-2"
            size="sm"
          >
            <Zap className="h-4 w-4" />
            Start Burst
          </Button>
          <Button
            onClick={triggerBurst}
            disabled={isLocked || isRunning}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Power className="h-4 w-4" />
            Auto-Burst
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={takeBurstProfit}
            disabled={!isRunning}
            variant="secondary"
            size="sm"
            className="gap-2"
          >
            <DollarSign className="h-4 w-4" />
            Take Burst Profit
          </Button>
          <Button
            onClick={globalClose}
            variant="destructive"
            size="sm"
            className="gap-2"
          >
            <X className="h-4 w-4" />
            Global Close
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}