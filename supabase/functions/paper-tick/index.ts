import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Default configs
const DEFAULT_RISK_CONFIG = {
  maxDailyLossPercent: 5,
  maxConcurrentRiskPercent: 10,
  maxOpenTrades: 20,
};

const DEFAULT_BURST_CONFIG = {
  size: 20,
  dailyProfitTargetPercent: 8,
  riskPerBurstPercent: 2,
};

const DEFAULT_MODE_CONFIG = {
  enabledModes: ['sniper', 'trend'],
  modeSettings: {},
};

const DEFAULT_MARKET_CONFIG = {
  selectedSymbols: ['BTCUSDT', 'ETHUSDT'],
  typeFilters: { crypto: true, forex: true, index: true, metal: true },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid auth' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    const body = await req.json().catch(() => ({}));
    const { action, burstRequested, globalClose, takeBurstProfit } = body;

    // Fetch latest prices
    const priceResponse = await fetch(`${supabaseUrl}/functions/v1/price-feed`, {
      headers: { Authorization: `Bearer ${supabaseKey}` },
    });
    const { ticks } = await priceResponse.json();

    // Load or create paper config
    let { data: config } = await supabase
      .from('paper_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!config) {
      const { data: newConfig, error: createError } = await supabase
        .from('paper_config')
        .insert({
          user_id: userId,
          risk_config: DEFAULT_RISK_CONFIG,
          burst_config: DEFAULT_BURST_CONFIG,
          mode_config: DEFAULT_MODE_CONFIG,
          market_config: DEFAULT_MARKET_CONFIG,
        })
        .select()
        .single();
      
      if (createError) throw createError;
      config = newConfig;
    }

    // Load open positions
    const { data: positions } = await supabase
      .from('paper_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('closed', false);

    // Load today's trades
    const today = new Date().toISOString().split('T')[0];
    const { data: todayTrades } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('session_date', today);

    // Get starting equity from daily stats or account
    const { data: dailyStats } = await supabase
      .from('paper_stats_daily')
      .select('equity_start')
      .eq('user_id', userId)
      .eq('trade_date', today)
      .maybeSingle();

    const { data: account } = await supabase
      .from('accounts')
      .select('equity')
      .eq('user_id', userId)
      .eq('type', 'paper')
      .maybeSingle();

    const startingEquity = dailyStats?.equity_start ?? account?.equity ?? 10000;

    // Transform data for engine
    const enginePositions = (positions || []).map((p: any) => ({
      id: p.id,
      userId: p.user_id,
      symbol: p.symbol,
      mode: p.mode,
      side: p.side,
      size: Number(p.size),
      entryPrice: Number(p.entry_price),
      sl: p.sl ? Number(p.sl) : undefined,
      tp: p.tp ? Number(p.tp) : undefined,
      openedAt: p.opened_at,
      unrealizedPnl: Number(p.unrealized_pnl || 0),
      batchId: p.batch_id,
    }));

    const engineTrades = (todayTrades || []).map((t: any) => ({
      id: t.id,
      userId: t.user_id,
      symbol: t.symbol,
      mode: t.mode,
      side: t.side,
      size: Number(t.size),
      entryPrice: Number(t.entry_price),
      exitPrice: Number(t.exit_price),
      sl: t.sl ? Number(t.sl) : undefined,
      tp: t.tp ? Number(t.tp) : undefined,
      openedAt: t.opened_at,
      closedAt: t.closed_at,
      realizedPnl: Number(t.realized_pnl),
      reason: t.reason,
      sessionDate: t.session_date,
      batchId: t.batch_id,
    }));

    // Handle special actions
    if (globalClose) {
      // Close all positions
      for (const pos of enginePositions) {
        const tick = ticks[pos.symbol];
        const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : pos.entryPrice;
        const priceDiff = pos.side === 'long' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
        const realizedPnl = priceDiff * pos.size;

        await supabase.from('paper_trades').insert({
          user_id: userId,
          symbol: pos.symbol,
          mode: pos.mode,
          side: pos.side,
          size: pos.size,
          entry_price: pos.entryPrice,
          exit_price: exitPrice,
          sl: pos.sl,
          tp: pos.tp,
          opened_at: pos.openedAt,
          realized_pnl: realizedPnl,
          reason: 'global_close',
          session_date: today,
          batch_id: pos.batchId,
        });
      }

      await supabase.from('paper_positions').delete().eq('user_id', userId);

      await supabase.from('system_logs').insert({
        user_id: userId,
        level: 'info',
        source: 'execution',
        message: `Global close: ${enginePositions.length} positions closed`,
      });
    }

    if (takeBurstProfit) {
      // Close burst positions only
      const burstPositions = enginePositions.filter((p: any) => p.mode === 'burst');
      for (const pos of burstPositions) {
        const tick = ticks[pos.symbol];
        const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : pos.entryPrice;
        const priceDiff = pos.side === 'long' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
        const realizedPnl = priceDiff * pos.size;

        await supabase.from('paper_trades').insert({
          user_id: userId,
          symbol: pos.symbol,
          mode: pos.mode,
          side: pos.side,
          size: pos.size,
          entry_price: pos.entryPrice,
          exit_price: exitPrice,
          sl: pos.sl,
          tp: pos.tp,
          opened_at: pos.openedAt,
          realized_pnl: realizedPnl,
          reason: 'take_burst_profit',
          session_date: today,
          batch_id: pos.batchId,
        });

        await supabase.from('paper_positions').delete().eq('id', pos.id);
      }

      await supabase.from('system_logs').insert({
        user_id: userId,
        level: 'info',
        source: 'mode:burst',
        message: `Take burst profit: ${burstPositions.length} positions closed`,
      });
    }

    // Update burst requested flag
    if (burstRequested !== undefined) {
      await supabase
        .from('paper_config')
        .update({ burst_requested: burstRequested })
        .eq('user_id', userId);
      config.burst_requested = burstRequested;
    }

    // Simplified engine run inline (to avoid Deno import issues)
    const riskConfig = config.risk_config || DEFAULT_RISK_CONFIG;
    const burstConfig = config.burst_config || DEFAULT_BURST_CONFIG;
    const modeConfig = config.mode_config || DEFAULT_MODE_CONFIG;
    const marketConfig = config.market_config || DEFAULT_MARKET_CONFIG;

    // Re-fetch positions after any closures
    const { data: currentPositions } = await supabase
      .from('paper_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('closed', false);

    const { data: currentTrades } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('session_date', today);

    // Mark to market
    const markedPositions = (currentPositions || []).map((pos: any) => {
      const tick = ticks[pos.symbol];
      if (!tick) return pos;
      const currentPrice = pos.side === 'long' ? tick.bid : tick.ask;
      const priceDiff = pos.side === 'long' 
        ? currentPrice - Number(pos.entry_price)
        : Number(pos.entry_price) - currentPrice;
      return { ...pos, unrealized_pnl: priceDiff * Number(pos.size) };
    });

    // Update unrealized PnL
    for (const pos of markedPositions) {
      await supabase
        .from('paper_positions')
        .update({ unrealized_pnl: pos.unrealized_pnl })
        .eq('id', pos.id);
    }

    // Check SL/TP exits
    for (const pos of markedPositions) {
      const tick = ticks[pos.symbol];
      if (!tick) continue;

      const currentPrice = pos.side === 'long' ? tick.bid : tick.ask;
      let closeReason: string | null = null;
      let exitPrice = currentPrice;

      if (pos.sl) {
        if (pos.side === 'long' && tick.bid <= Number(pos.sl)) {
          closeReason = 'sl_hit';
          exitPrice = Number(pos.sl);
        } else if (pos.side === 'short' && tick.ask >= Number(pos.sl)) {
          closeReason = 'sl_hit';
          exitPrice = Number(pos.sl);
        }
      }

      if (!closeReason && pos.tp) {
        if (pos.side === 'long' && tick.bid >= Number(pos.tp)) {
          closeReason = 'tp_hit';
          exitPrice = Number(pos.tp);
        } else if (pos.side === 'short' && tick.ask <= Number(pos.tp)) {
          closeReason = 'tp_hit';
          exitPrice = Number(pos.tp);
        }
      }

      if (closeReason) {
        const priceDiff = pos.side === 'long'
          ? exitPrice - Number(pos.entry_price)
          : Number(pos.entry_price) - exitPrice;
        const realizedPnl = priceDiff * Number(pos.size);

        await supabase.from('paper_trades').insert({
          user_id: userId,
          symbol: pos.symbol,
          mode: pos.mode,
          side: pos.side,
          size: pos.size,
          entry_price: pos.entry_price,
          exit_price: exitPrice,
          sl: pos.sl,
          tp: pos.tp,
          opened_at: pos.opened_at,
          realized_pnl: realizedPnl,
          reason: closeReason,
          session_date: today,
          batch_id: pos.batch_id,
        });

        await supabase.from('paper_positions').delete().eq('id', pos.id);

        await supabase.from('system_logs').insert({
          user_id: userId,
          level: realizedPnl >= 0 ? 'info' : 'warning',
          source: `mode:${pos.mode}`,
          message: `${pos.symbol} ${pos.side} closed: ${closeReason} | P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}`,
          meta: { pnl: realizedPnl },
        });
      }
    }

    // Calculate stats
    const { data: finalPositions } = await supabase
      .from('paper_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('closed', false);

    const { data: finalTrades } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('session_date', today);

    const realizedPnl = (finalTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const unrealizedPnl = (finalPositions || []).reduce((sum: number, p: any) => sum + Number(p.unrealized_pnl || 0), 0);
    const todayPnl = realizedPnl + unrealizedPnl;
    const todayPnlPercent = startingEquity > 0 ? (todayPnl / startingEquity) * 100 : 0;

    const closedCount = (finalTrades || []).length;
    const wins = (finalTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length;
    const winRate = closedCount > 0 ? (wins / closedCount) * 100 : 0;

    const burstTrades = (finalTrades || []).filter((t: any) => t.mode === 'burst');
    const burstPnl = burstTrades.reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const burstPnlPercent = startingEquity > 0 ? (burstPnl / startingEquity) * 100 : 0;

    const burstPositions = (finalPositions || []).filter((p: any) => p.mode === 'burst');
    const burstStatus = burstPositions.length > 0 
      ? 'running' 
      : burstPnlPercent >= burstConfig.dailyProfitTargetPercent ? 'locked' : 'idle';

    // Update daily stats
    await supabase.from('paper_stats_daily').upsert({
      user_id: userId,
      trade_date: today,
      equity_start: startingEquity,
      equity_end: startingEquity + todayPnl,
      pnl: todayPnl,
      win_rate: winRate,
      trades_count: closedCount,
    }, { onConflict: 'user_id,trade_date' });

    // Update account equity
    await supabase
      .from('accounts')
      .update({ equity: startingEquity + todayPnl })
      .eq('user_id', userId)
      .eq('type', 'paper');

    const stats = {
      equity: startingEquity + todayPnl,
      todayPnl,
      todayPnlPercent,
      winRate,
      avgRR: 1.5,
      tradesToday: closedCount,
      maxDrawdown: 0,
      openPositionsCount: (finalPositions || []).length,
      burstPnlToday: burstPnlPercent,
      burstsToday: new Set(burstTrades.map((t: any) => t.batch_id).filter(Boolean)).size,
      burstStatus,
    };

    return new Response(JSON.stringify({
      stats,
      positions: finalPositions,
      trades: finalTrades,
      ticks,
      halted: todayPnlPercent <= -riskConfig.maxDailyLossPercent,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Paper tick error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
