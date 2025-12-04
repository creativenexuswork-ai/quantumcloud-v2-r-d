import { Loader2, Power, DollarSign, Pause, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SessionStatus } from '@/lib/state/sessionMachine';
import { toast } from '@/hooks/use-toast';

interface ControlBarProps {
  status: SessionStatus;
  openPositionsCount: number;
  tickInFlight: boolean;
  onActivate: () => void;
  onTakeProfit: () => void;
  onHold: () => void;
  onCloseAll: () => void;
}

export function ControlBar({
  status,
  openPositionsCount,
  tickInFlight,
  onActivate,
  onTakeProfit,
  onHold,
  onCloseAll,
}: ControlBarProps) {
  const isRunning = status === 'running';
  const isHolding = status === 'holding';
  const isIdle = status === 'idle' || status === 'stopped';
  const isActive = isRunning || isHolding;

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
        disabled={tickInFlight || isRunning}
        className={cn(
          "control-btn control-btn-primary",
          isRunning && "control-btn-active"
        )}
      >
        {tickInFlight ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Power className="h-4 w-4" />
        )}
        <span>{isHolding ? 'RESUME' : 'ACTIVATE'}</span>
      </button>

      {/* TAKE PROFIT - enabled when running or holding */}
      <button
        onClick={handleTakeProfit}
        disabled={tickInFlight || isIdle}
        className="control-btn control-btn-success control-btn-wide"
      >
        <DollarSign className="h-4 w-4" />
        <span>TAKE PROFIT</span>
      </button>

      {/* HOLD - only enabled when running */}
      <button
        onClick={handleHold}
        disabled={tickInFlight || !isRunning}
        className={cn(
          "control-btn control-btn-outline",
          isHolding && "control-btn-holding"
        )}
      >
        <Pause className="h-4 w-4" />
        <span>HOLD</span>
      </button>

      {/* CLOSE ALL - enabled when running or holding */}
      <button
        onClick={onCloseAll}
        disabled={tickInFlight || isIdle}
        className="control-btn control-btn-danger"
      >
        <XCircle className="h-4 w-4" />
        <span>CLOSE ALL</span>
      </button>
    </div>
  );
}