import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, Power, DollarSign, X } from 'lucide-react';
import { useActiveAccount } from '@/hooks/useAccounts';
import { useTodayBurstStats, useCreateBurstBatch, useCloseBurstBatch } from '@/hooks/useBurstBatches';
import { useUserSettings } from '@/hooks/useUserSettings';
import { toast } from '@/hooks/use-toast';

export function BurstControlCard() {
  const { data: activeAccount } = useActiveAccount();
  const { data: burstStats } = useTodayBurstStats(activeAccount?.id);
  const { data: settings } = useUserSettings();
  const createBurst = useCreateBurstBatch();
  const closeBurst = useCloseBurstBatch();

  const dailyTarget = settings?.burst_daily_target_pct || 8;
  const isLocked = (burstStats?.totalPnl || 0) >= dailyTarget;

  const handleStartBurst = async () => {
    if (!activeAccount) return;
    
    try {
      await createBurst.mutateAsync({
        account_id: activeAccount.id,
        symbol: 'BTCUSDT',
        status: 'active',
        burst_size: settings?.burst_size || 20,
        total_risk_pct: 2,
      });
      toast({
        title: 'Burst Started',
        description: 'Single burst batch initiated.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to start burst.',
        variant: 'destructive',
      });
    }
  };

  const handleTakeBurstProfit = async () => {
    if (!burstStats?.activeBurst) return;

    try {
      await closeBurst.mutateAsync({
        batchId: burstStats.activeBurst.id,
        resultPct: 0.5, // Would be calculated from actual trades
        reasonClosed: 'manual_take_burst_profit',
      });
      toast({
        title: 'Burst Closed',
        description: 'Burst profit taken successfully.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to close burst.',
        variant: 'destructive',
      });
    }
  };

  const handleGlobalClose = () => {
    toast({
      title: 'Global Close',
      description: 'All positions would be closed. (Simulation)',
    });
  };

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
              +{dailyTarget}% Reached
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="metric-label">Today P&L</p>
            <p className={`metric-value text-lg ${
              (burstStats?.totalPnl || 0) >= 0 ? 'profit-text' : 'loss-text'
            }`}>
              {(burstStats?.totalPnl || 0) >= 0 ? '+' : ''}{(burstStats?.totalPnl || 0).toFixed(2)}%
            </p>
          </div>
          <div className="text-center">
            <p className="metric-label">Bursts Today</p>
            <p className="metric-value text-lg">{burstStats?.burstsToday || 0}</p>
          </div>
          <div className="text-center">
            <p className="metric-label">Status</p>
            <p className={`text-sm font-medium ${
              burstStats?.hasActiveBurst ? 'text-success' :
              isLocked ? 'text-warning' : 'text-muted-foreground'
            }`}>
              {burstStats?.hasActiveBurst ? 'Running' : isLocked ? 'Locked' : 'Idle'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={handleStartBurst}
            disabled={isLocked || burstStats?.hasActiveBurst}
            className="gap-2"
            size="sm"
          >
            <Zap className="h-4 w-4" />
            Start Burst
          </Button>
          <Button
            onClick={handleStartBurst}
            disabled={isLocked || burstStats?.hasActiveBurst}
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
            onClick={handleTakeBurstProfit}
            disabled={!burstStats?.hasActiveBurst}
            variant="secondary"
            size="sm"
            className="gap-2"
          >
            <DollarSign className="h-4 w-4" />
            Take Burst Profit
          </Button>
          <Button
            onClick={handleGlobalClose}
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
