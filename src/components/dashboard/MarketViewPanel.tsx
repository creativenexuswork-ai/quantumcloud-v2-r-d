import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { useMarketData } from '@/hooks/useMarketData';
import { cn } from '@/lib/utils';

export function MarketViewPanel() {
  const { symbol, tick, ohlcData, isLoading } = useMarketData();

  const formatPrice = (price: number) => {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };

  const formatVolume = (vol: number) => {
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(2)}K`;
    return vol.toString();
  };

  const isPositive = tick ? tick.changePercent24h >= 0 : true;

  return (
    <div className="glass-panel p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Market Overview</h2>
        
        {tick && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Symbol:</span>
              <span className="font-mono font-medium text-foreground">{symbol}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Price:</span>
              <span className="font-mono font-medium text-foreground">
                ${formatPrice(tick.price)}
              </span>
            </div>
            <div className={cn(
              "flex items-center gap-1 font-mono font-medium",
              isPositive ? "text-success" : "text-destructive"
            )}>
              {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {isPositive ? '+' : ''}{tick.changePercent24h.toFixed(2)}%
            </div>
          </div>
        )}
      </div>

      {/* Chart Area */}
      <div className="flex-1 min-h-[300px] rounded-xl bg-muted/20 chart-grid relative overflow-hidden">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Activity className="h-8 w-8 text-muted-foreground animate-pulse" />
          </div>
        ) : (
          <div className="absolute inset-0 p-4">
            {/* Simple price line visualization */}
            <svg className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="priceGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity="0" />
                </linearGradient>
              </defs>
              
              {ohlcData.length > 0 && (() => {
                const prices = ohlcData.map(d => d.close);
                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                const range = maxPrice - minPrice || 1;
                
                const points = ohlcData.map((d, i) => {
                  const x = (i / (ohlcData.length - 1)) * 100;
                  const y = 100 - ((d.close - minPrice) / range) * 100;
                  return `${x},${y}`;
                }).join(' ');
                
                const areaPoints = `0,100 ${points} 100,100`;
                
                return (
                  <>
                    <polygon
                      points={areaPoints}
                      fill="url(#priceGradient)"
                    />
                    <polyline
                      points={points}
                      fill="none"
                      stroke="hsl(217 91% 60%)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                );
              })()}
            </svg>

            {/* Price labels */}
            {ohlcData.length > 0 && (
              <>
                <div className="absolute top-2 left-2 text-xs text-muted-foreground font-mono">
                  H: ${formatPrice(Math.max(...ohlcData.map(d => d.high)))}
                </div>
                <div className="absolute bottom-2 left-2 text-xs text-muted-foreground font-mono">
                  L: ${formatPrice(Math.min(...ohlcData.map(d => d.low)))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Chart placeholder text */}
        <div className="absolute bottom-4 right-4 text-xs text-muted-foreground/50">
          {/* Future: Connect to price_history table or external API */}
        </div>
      </div>

      {/* Bottom Stats */}
      {tick && (
        <div className="mt-4 grid grid-cols-4 gap-4">
          <div>
            <p className="metric-label">Last Price</p>
            <p className="font-mono text-lg font-semibold text-foreground">
              ${formatPrice(tick.price)}
            </p>
          </div>
          <div>
            <p className="metric-label">24h High</p>
            <p className="font-mono text-lg font-medium text-muted-foreground">
              ${formatPrice(tick.high24h)}
            </p>
          </div>
          <div>
            <p className="metric-label">24h Low</p>
            <p className="font-mono text-lg font-medium text-muted-foreground">
              ${formatPrice(tick.low24h)}
            </p>
          </div>
          <div>
            <p className="metric-label">Volume</p>
            <p className="font-mono text-lg font-medium text-muted-foreground">
              {formatVolume(tick.volume24h)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
