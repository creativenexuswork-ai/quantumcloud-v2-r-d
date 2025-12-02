import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SUPPORTED_SYMBOLS } from '@/types/trading';
import { useTrading } from '@/context/TradingContext';

const regimes = ['trend', 'range', 'high_vol', 'low_vol'] as const;

const mockMarketData = SUPPORTED_SYMBOLS.map(s => ({
  ...s,
  price: s.type === 'crypto' ? (s.symbol === 'BTCUSDT' ? 67500 : 3850) :
         s.type === 'forex' ? (s.symbol === 'EURUSD' ? 1.0850 : 1.2750) :
         s.type === 'index' ? (s.symbol === 'NAS100' ? 18500 : 5200) : 2350,
  change: Math.random() * 4 - 2,
  spread: s.type === 'crypto' ? 0.01 : s.type === 'forex' ? 0.0001 : 0.5,
  regime: regimes[Math.floor(Math.random() * 4)],
}));

const typeColors: Record<string, string> = {
  crypto: 'bg-chart-1/20 text-chart-1',
  forex: 'bg-chart-2/20 text-chart-2',
  index: 'bg-chart-4/20 text-chart-4',
  metal: 'bg-chart-5/20 text-chart-5',
};

const regimeColors: Record<string, string> = {
  trend: 'bg-success/20 text-success',
  range: 'bg-warning/20 text-warning',
  high_vol: 'bg-destructive/20 text-destructive',
  low_vol: 'bg-muted text-muted-foreground',
};

export function MarketsTab() {
  const { setActiveSymbol, tradingState } = useTrading();

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle>Market Watchlist</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>24h Change</TableHead>
              <TableHead>Spread</TableHead>
              <TableHead>Regime</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockMarketData.map((market) => (
              <TableRow 
                key={market.symbol}
                className={tradingState.activeSymbol === market.symbol ? 'bg-primary/10' : ''}
              >
                <TableCell className="font-mono font-medium">{market.symbol}</TableCell>
                <TableCell>{market.name}</TableCell>
                <TableCell>
                  <Badge className={typeColors[market.type]}>
                    {market.type}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono">
                  {market.type === 'forex' 
                    ? market.price.toFixed(4) 
                    : `$${market.price.toLocaleString()}`
                  }
                </TableCell>
                <TableCell className={`font-mono ${
                  market.change >= 0 ? 'profit-text' : 'loss-text'
                }`}>
                  {market.change >= 0 ? '+' : ''}{market.change.toFixed(2)}%
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {market.spread}
                </TableCell>
                <TableCell>
                  <Badge className={regimeColors[market.regime]}>
                    {market.regime.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant={tradingState.activeSymbol === market.symbol ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveSymbol(market.symbol)}
                  >
                    {tradingState.activeSymbol === market.symbol ? 'Selected' : 'Select'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
