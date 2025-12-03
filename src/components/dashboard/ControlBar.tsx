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
  const isActive = isRunning || isHolding;

  const handleTakeProfit = () => {
    if (openPositionsCount === 0) {
      toast({
        title: 'No Open Positions',
        description: 'There are no positions to close.',
        variant: 'default',
      });
      return;
    }
    onTakeProfit();
  };

  const handleHold = () => {
    if (status === 'idle' || status === 'stopped') {
      toast({
        title: 'Engine Not Active',
        description: 'Activate the engine first.',
        variant: 'default',
      });
      return;
    }
    onHold();
  };

  return (
    <div className="flex items-center justify-center gap-3 py-4">
      {/* ACTIVATE */}
      <button
        onClick={onActivate}
        disabled={tickInFlight}
        className={cn(
          "control-btn control-btn-primary",
          isActive && "control-btn-active"
        )}
      >
        {tickInFlight ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Power className="h-4 w-4" />
        )}
        <span>ACTIVATE</span>
      </button>

      {/* TAKE PROFIT - slightly wider */}
      <button
        onClick={handleTakeProfit}
        disabled={tickInFlight}
        className="control-btn control-btn-success control-btn-wide"
      >
        <DollarSign className="h-4 w-4" />
        <span>TAKE PROFIT</span>
      </button>

      {/* HOLD */}
      <button
        onClick={handleHold}
        disabled={tickInFlight}
        className={cn(
          "control-btn control-btn-outline",
          isHolding && "control-btn-holding"
        )}
      >
        <Pause className="h-4 w-4" />
        <span>{isHolding ? 'RESUME' : 'HOLD'}</span>
      </button>

      {/* CLOSE ALL */}
      <button
        onClick={onCloseAll}
        disabled={tickInFlight}
        className="control-btn control-btn-danger"
      >
        <XCircle className="h-4 w-4" />
        <span>CLOSE ALL</span>
      </button>
    </div>
  );
}