import { Loader2, Power, DollarSign, Pause, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SessionStatus, PendingAction } from '@/lib/state/sessionMachine';
import { toast } from '@/hooks/use-toast';

interface ControlBarProps {
  status: SessionStatus;
  openPositionsCount: number;
  showSpinner: boolean;
  pendingAction: PendingAction;
  onActivate: () => void;
  onTakeProfit: () => void;
  onHold: () => void;
  onCloseAll: () => void;
}

export function ControlBar({
  status,
  openPositionsCount,
  showSpinner,
  pendingAction,
  onActivate,
  onTakeProfit,
  onHold,
  onCloseAll,
}: ControlBarProps) {
  const isRunning = status === 'running';
  const isHolding = status === 'holding';
  const isIdle = status === 'idle' || status === 'stopped';
  const isActive = isRunning || isHolding;

  // Button enabled states - computed from status, NOT from polling
  const canActivate = (isIdle || isHolding) && !showSpinner;
  const canHold = isRunning && !showSpinner;
  const canTakeProfit = isActive && openPositionsCount > 0 && !showSpinner;
  const canCloseAll = isActive && !showSpinner;

  const handleTakeProfit = () => {
    if (isIdle) {
      toast({
        title: 'Engine Not Active',
        description: 'Activate the engine first.',
        variant: 'default',
      });
      return;
    }
    onTakeProfit();
  };

  const handleHold = () => {
    if (!isRunning) {
      toast({
        title: 'Engine Not Running',
        description: 'Hold is only available when running.',
        variant: 'default',
      });
      return;
    }
    onHold();
  };

  return (
    <div className="flex items-center justify-center gap-3 py-4">
      {/* ACTIVATE / RESUME */}
      <button
        onClick={onActivate}
        disabled={!canActivate}
        className={cn(
          "control-btn control-btn-primary",
          isRunning && "control-btn-active"
        )}
      >
        {pendingAction === 'activate' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Power className="h-4 w-4" />
        )}
        <span>{isHolding ? 'RESUME' : 'ACTIVATE'}</span>
      </button>

      {/* TAKE PROFIT - enabled when running or holding AND has positions */}
      <button
        onClick={handleTakeProfit}
        disabled={!canTakeProfit}
        className="control-btn control-btn-success control-btn-wide"
      >
        {pendingAction === 'takeProfit' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <DollarSign className="h-4 w-4" />
        )}
        <span>TAKE PROFIT</span>
      </button>

      {/* HOLD - only enabled when running */}
      <button
        onClick={handleHold}
        disabled={!canHold}
        className={cn(
          "control-btn control-btn-outline",
          isHolding && "control-btn-holding"
        )}
      >
        {pendingAction === 'hold' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Pause className="h-4 w-4" />
        )}
        <span>HOLD</span>
      </button>

      {/* CLOSE ALL - enabled when running or holding */}
      <button
        onClick={onCloseAll}
        disabled={!canCloseAll}
        className="control-btn control-btn-danger"
      >
        {pendingAction === 'closeAll' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <XCircle className="h-4 w-4" />
        )}
        <span>CLOSE ALL</span>
      </button>
    </div>
  );
}
