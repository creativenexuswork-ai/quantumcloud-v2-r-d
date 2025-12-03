import { Brain, TrendingUp, Target, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TradingMode } from '@/lib/state/sessionMachine';

interface AIEngineStripProps {
  selectedMode?: TradingMode;
  marketRegime?: string;
  aiActive?: boolean;
  targetPct?: string;
  confidencePct?: number;
}

const MODE_SUGGESTIONS: Record<string, TradingMode> = {
  'trending': 'trend',
  'ranging': 'scalper',
  'volatile': 'burst',
  'choppy': 'scalper',
};

export function AIEngineStrip({ 
  selectedMode = 'burst', 
  marketRegime = 'analysing',
  aiActive = true,
  targetPct,
  confidencePct,
}: AIEngineStripProps) {
  const regime = marketRegime.toLowerCase();
  const suggestedMode = MODE_SUGGESTIONS[regime] || 'burst';
  const suggestedTp = targetPct || (regime === 'trending' ? '+2.5%' : regime === 'volatile' ? '+1.2%' : '+1.8%');
  const confidence = confidencePct ?? 78;

  return (
    <div className="ai-strip-compact">
      <div className="flex items-center gap-1.5">
        <Brain className="h-3 w-3 text-primary" />
        <span className="text-[10px] font-semibold text-foreground">AI:</span>
        <span className={cn(
          "text-[10px] font-semibold",
          aiActive ? "text-success" : "text-destructive"
        )}>
          {aiActive ? 'Active' : 'Disabled'}
        </span>
      </div>
      
      <span className="ai-strip-sep">·</span>
      
      <div className="flex items-center gap-1">
        <TrendingUp className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">Regime:</span>
        <span className="text-[10px] text-foreground capitalize font-medium">
          {regime === 'analysing' ? 'Analysing...' : regime}
        </span>
      </div>
      
      <span className="ai-strip-sep">·</span>
      
      <div className="flex items-center gap-1">
        <Target className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-success font-mono font-medium">{suggestedTp}</span>
      </div>
      
      <span className="ai-strip-sep hidden sm:inline">·</span>
      
      <div className="hidden sm:flex items-center gap-1">
        <Gauge className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-foreground font-medium">{confidence}%</span>
      </div>
    </div>
  );
}
