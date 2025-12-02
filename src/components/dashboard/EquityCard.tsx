import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useActiveAccount } from '@/hooks/useAccounts';
import { useEquitySnapshots } from '@/hooks/useEquitySnapshots';
import { useTradeStats } from '@/hooks/useTrades';

export function EquityCard() {
  const [range, setRange] = useState<'7d' | '30d'>('7d');
  const { data: activeAccount } = useActiveAccount();
  const { data: snapshots } = useEquitySnapshots(activeAccount?.id, range === '7d' ? 7 : 30);
  const stats = useTradeStats(activeAccount?.id);

  const chartData = snapshots?.map(s => ({
    date: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    equity: s.equity,
  })) || [];

  // Add current equity if no snapshots
  if (chartData.length === 0 && activeAccount) {
    chartData.push({
      date: 'Now',
      equity: activeAccount.equity || 10000,
    });
  }

  return (
    <Card className="glass-card col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold">Equity & Performance</CardTitle>
        <Tabs value={range} onValueChange={(v) => setRange(v as '7d' | '30d')}>
          <TabsList className="h-8">
            <TabsTrigger value="7d" className="text-xs px-3">7D</TabsTrigger>
            <TabsTrigger value="30d" className="text-xs px-3">30D</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div className="h-48 mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="date" 
                axisLine={false} 
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: 'hsl(var(--card-foreground))' }}
                formatter={(value: number) => [`$${value.toLocaleString()}`, 'Equity']}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#equityGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="metric-label">Today</p>
            <p className={`metric-value text-lg ${stats.todayPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
              {stats.todayPnl >= 0 ? '+' : ''}{stats.todayPnl.toFixed(2)}%
            </p>
          </div>
          <div>
            <p className="metric-label">Win Rate</p>
            <p className="metric-value text-lg">{stats.winRate.toFixed(1)}%</p>
          </div>
          <div>
            <p className="metric-label">Avg R:R</p>
            <p className="metric-value text-lg">1.5</p>
          </div>
          <div>
            <p className="metric-label">Trades Today</p>
            <p className="metric-value text-lg">{stats.todayTrades}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
