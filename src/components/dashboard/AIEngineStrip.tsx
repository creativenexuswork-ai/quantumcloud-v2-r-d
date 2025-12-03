import { Brain, TrendingUp, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TradingMode } from '@/hooks/useSessionState';

interface AIEngineStripProps {
  selectedMode: TradingMode;
  marketRegime?: string;
}

const MODE_SUGGESTIONS: Record<string, TradingMode> = {
  'trending': 'trend',
  'ranging': 'scalper',
  'volatile': 'burst',
  'choppy': 'scalper',
};

export function AIEngineStrip({ selectedMode, marketRegime = 'analysing' }: AIEngineStripProps) {
  const regime = marketRegime.toLowerCase();
  const suggestedMode = MODE_SUGGESTIONS[regime] || 'burst';
  const suggestedTp = regime === 'trending' ? '+2.5%' : regime === 'volatile' ? '+1.2%' : '+1.8%';

  return (
    <div className="ai-engine-strip">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium text-foreground">AI ENGINE</span>
        <span className={cn(
          "px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider",
          "bg-success/20 text-success"
        )}>
          ACTIVE
        </span>
      </div>
      
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" />
          <span>Regime:</span>
          <span className="text-foreground capitalize font-medium">
            {regime === 'analysing' ? 'Analysing...' : regime}
          </span>
        </div>
        
        <div className="flex items-center gap-1.5">
          <span>Suggested:</span>
          <span className={cn(
            "text-foreground capitalize font-medium",
            suggestedMode === selectedMode && "text-success"
          )}>
            {suggestedMode}
          </span>
        </div>
        
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" />
          <span>Target:</span>
          <span className="text-success font-mono font-medium">{suggestedTp}</span>
        </div>
      </div>
    </div>
  );
}