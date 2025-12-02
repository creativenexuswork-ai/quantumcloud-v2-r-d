import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useActiveAccount } from '@/hooks/useAccounts';
import { useTrades } from '@/hooks/useTrades';
import { MODE_DEFINITIONS, ModeKey } from '@/hooks/useModeConfigs';

export function TradesTab() {
  const { data: activeAccount } = useActiveAccount();
  const { data: trades, isLoading } = useTrades(activeAccount?.id);
  const [modeFilter, setModeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredTrades = trades?.filter(trade => {
    if (modeFilter !== 'all' && trade.mode_key !== modeFilter) return false;
    if (statusFilter !== 'all' && trade.status !== statusFilter) return false;
    return true;
  });

  return (
    <Card className="glass-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Trade History</CardTitle>
        <div className="flex gap-2">
          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modes</SelectItem>
              {Object.keys(MODE_DEFINITIONS).map(key => (
                <SelectItem key={key} value={key}>
                  {MODE_DEFINITIONS[key as ModeKey].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading trades...</div>
        ) : filteredTrades?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No trades yet</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>P&L</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTrades?.map((trade) => (
                <TableRow key={trade.id}>
                  <TableCell className="font-mono text-xs">
                    {new Date(trade.opened_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium">{trade.symbol}</TableCell>
                  <TableCell>
                    <Badge variant={trade.side === 'long' ? 'default' : 'destructive'}>
                      {trade.side.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{trade.size}</TableCell>
                  <TableCell className="font-mono">${trade.entry_price}</TableCell>
                  <TableCell className="font-mono">
                    {trade.exit_price ? `$${trade.exit_price}` : '—'}
                  </TableCell>
                  <TableCell className={`font-mono ${
                    trade.pnl && trade.pnl > 0 ? 'profit-text' : 
                    trade.pnl && trade.pnl < 0 ? 'loss-text' : ''
                  }`}>
                    {trade.pnl ? `${trade.pnl > 0 ? '+' : ''}$${trade.pnl.toFixed(2)}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {MODE_DEFINITIONS[trade.mode_key as ModeKey]?.icon} {trade.mode_key}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      trade.status === 'open' ? 'default' :
                      trade.status === 'closed' ? 'secondary' : 'destructive'
                    }>
                      {trade.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
