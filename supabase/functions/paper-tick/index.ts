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
  maxPerSymbolExposure: 30,
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

// ============== Trading Mode Logic (inline for edge function) ==============

type Side = 'long' | 'short';
type TradingMode = 'sniper' | 'burst' | 'trend' | 'swing' | 'memory' | 'stealth' | 'news' | 'hybrid';

interface PriceTick {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  timestamp: string;
  volatility?: number;
  regime?: string;
}

interface ProposedOrder {
  symbol: string;
  side: Side;
  size: number;
  entryPrice: number;
  sl?: number;
  tp?: number;
  mode: TradingMode;
  reason?: string;
  confidence?: number;
  batchId?: string;
}

interface EngineContext {
  selectedSymbols: string[];
  ticks: Record<string, PriceTick>;
  equity: number;
  winRate: number;
  recentTrades: any[];
  modeSettings: Record<string, any>;
  burstConfig: any;
  burstRequested: boolean;
}

function detectTrend(tick: PriceTick): 'up' | 'down' | 'neutral' {
  // More permissive trend detection - allow trading in most regimes
  if (tick.regime === 'low_vol') {
    return 'neutral'; // Only skip low volatility
  }
  // Use volatility to determine direction
  const vol = tick.volatility ?? 0.5;
  return vol > 0.5 ? 'up' : 'down';
}

function calculateSize(equity: number, riskPercent: number, price: number, slDistance: number): number {
  if (slDistance === 0) return 0;
  const riskAmount = equity * (riskPercent / 100);
  return Math.max(0.001, riskAmount / slDistance);
}

function generateBatchId(): string {
  return `burst_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function runSniperMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const riskPct = ctx.modeSettings?.sniper?.riskPerTrade ?? 0.5;
  
  console.log(`[SNIPER] symbols=${ctx.selectedSymbols.length}, equity=${ctx.equity}`);
  
  for (const symbol of ctx.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) {
      console.log(`[SNIPER] No tick for ${symbol}`);
      continue;
    }
    
    // Skip only low_vol regime
    if (tick.regime === 'low_vol') {
      console.log(`[SNIPER] Skipping ${symbol} - low_vol regime`);
      continue;
    }
    
    const trend = detectTrend(tick);
    const side: Side = trend !== 'neutral' ? (trend === 'up' ? 'long' : 'short') : (Math.random() > 0.5 ? 'long' : 'short');
    const slDistance = tick.mid * 0.015;
    const tpDistance = tick.mid * 0.03;
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
    console.log(`[SNIPER] ${symbol}: regime=${tick.regime}, trend=${trend}, side=${side}, size=${size}`);
    
    orders.push({
      symbol, side, size,
      entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'sniper',
      reason: `Sniper entry on ${tick.regime} regime`,
      confidence: 0.75
    });
  }
  
  console.log(`[SNIPER] Generated ${orders.length} orders`);
  return orders.slice(0, 2);
}

function runBurstMode(ctx: EngineContext): ProposedOrder[] {
  console.log(`[BURST] burstRequested=${ctx.burstRequested}, symbols=${ctx.selectedSymbols.length}`);
  
  if (!ctx.burstRequested) {
    console.log('[BURST] Skipping - burst not requested');
    return [];
  }
  
  const orders: ProposedOrder[] = [];
  const burstSize = ctx.burstConfig?.size ?? 20;
  const totalRisk = ctx.burstConfig?.riskPerBurstPercent ?? 2;
  const riskPerTrade = totalRisk / burstSize;
  
  console.log(`[BURST] Config: size=${burstSize}, totalRisk=${totalRisk}, riskPerTrade=${riskPerTrade}`);
  
  // Pick the best symbol for burst - accept any regime
  let bestSymbol: string | null = null;
  let bestScore = 0;
  
  for (const symbol of ctx.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) {
      console.log(`[BURST] No tick for ${symbol}`);
      continue;
    }
    // Accept all regimes for burst
    const score = (tick.volatility ?? 0.5) * (tick.regime === 'trend' ? 1.5 : tick.regime === 'high_vol' ? 1.3 : 1);
    console.log(`[BURST] ${symbol}: regime=${tick.regime}, vol=${tick.volatility}, score=${score}`);
    if (score > bestScore) { bestScore = score; bestSymbol = symbol; }
  }
  
  // Fallback to first symbol if none found
  if (!bestSymbol && ctx.selectedSymbols.length > 0) {
    bestSymbol = ctx.selectedSymbols[0];
    console.log(`[BURST] Using fallback symbol: ${bestSymbol}`);
  }
  
  if (!bestSymbol) {
    console.log('[BURST] No symbol available');
    return [];
  }
  
  const tick = ctx.ticks[bestSymbol];
  if (!tick) {
    console.log(`[BURST] No tick data for ${bestSymbol}`);
    return [];
  }
  
  const trend = detectTrend(tick);
  const side: Side = trend === 'down' ? 'short' : 'long';
  const batchId = generateBatchId();
  
  console.log(`[BURST] Creating ${burstSize} positions on ${bestSymbol} (${side}), mid=${tick.mid}`);
  
  for (let i = 0; i < burstSize; i++) {
    const slDistance = tick.mid * 0.005;
    const tpDistance = tick.mid * 0.01;
    const size = calculateSize(ctx.equity, riskPerTrade, tick.mid, slDistance);
    const priceOffset = (Math.random() - 0.5) * tick.mid * 0.0002;
    
    orders.push({
      symbol: bestSymbol, side, size,
      entryPrice: tick.mid + priceOffset,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'burst',
      reason: `Burst trade ${i + 1}/${burstSize}`,
      confidence: 0.6,
      batchId
    });
  }
  
  console.log(`[BURST] Generated ${orders.length} orders`);
  return orders;
}

function runTrendMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const riskPct = ctx.modeSettings?.trend?.riskPerTrade ?? 1;
  
  console.log(`[TREND] symbols=${ctx.selectedSymbols.length}, equity=${ctx.equity}`);
  
  for (const symbol of ctx.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) {
      console.log(`[TREND] No tick for ${symbol}`);
      continue;
    }
    
    // Skip only low_vol regime
    if (tick.regime === 'low_vol') {
      console.log(`[TREND] Skipping ${symbol} - low_vol regime`);
      continue;
    }
    
    const trend = detectTrend(tick);
    const side: Side = trend !== 'neutral' ? (trend === 'up' ? 'long' : 'short') : (Math.random() > 0.5 ? 'long' : 'short');
    const slDistance = tick.mid * 0.01;
    const tpDistance = tick.mid * 0.02;
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
    console.log(`[TREND] ${symbol}: regime=${tick.regime}, trend=${trend}, side=${side}, size=${size}`);
    
    orders.push({
      symbol, side, size, entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'trend', reason: `Trend entry on ${tick.regime}`, confidence: 0.7
    });
  }
  console.log(`[TREND] Generated ${orders.length} orders`);
  return orders.slice(0, 3);
}

function runSwingMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const riskPct = ctx.modeSettings?.swing?.riskPerTrade ?? 2;
  
  for (const symbol of ctx.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick || tick.regime === 'high_vol') continue;
    
    const trend = detectTrend(tick);
    if (trend === 'neutral') continue;
    
    const side: Side = trend === 'up' ? 'long' : 'short';
    const slDistance = tick.mid * 0.025;
    const tpDistance = tick.mid * 0.05;
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
    orders.push({
      symbol, side, size, entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'swing', reason: `Swing on ${trend} bias`, confidence: 0.65
    });
  }
  return orders.slice(0, 2);
}

function runMemoryMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const riskMultiplier = ctx.winRate > 60 ? 1.2 : ctx.winRate < 40 ? 0.5 : 1;
  const riskPct = 1 * riskMultiplier;
  
  const successfulSymbols = new Set(ctx.recentTrades.filter(t => t.realized_pnl > 0).map(t => t.symbol));
  
  for (const symbol of ctx.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) continue;
    
    const trend = detectTrend(tick);
    if (trend === 'neutral') continue;
    
    const side: Side = trend === 'up' ? 'long' : 'short';
    const slDistance = tick.mid * 0.012;
    const tpDistance = tick.mid * 0.018;
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    const symbolBonus = successfulSymbols.has(symbol) ? 0.1 : 0;
    
    orders.push({
      symbol, side, size, entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'memory', reason: `Adaptive (win rate: ${ctx.winRate.toFixed(0)}%)`, confidence: 0.6 + symbolBonus
    });
  }
  return orders.slice(0, 3);
}

function runStealthMode(ctx: EngineContext): ProposedOrder[] {
  if (Math.random() > 0.3) return [];
  
  const orders: ProposedOrder[] = [];
  const riskPct = ctx.modeSettings?.stealth?.riskPerTrade ?? 0.5;
  const symbols = [...ctx.selectedSymbols].sort(() => Math.random() - 0.5);
  
  for (const symbol of symbols.slice(0, 2)) {
    const tick = ctx.ticks[symbol];
    if (!tick) continue;
    
    const trend = detectTrend(tick);
    if (trend === 'neutral') continue;
    
    const side: Side = trend === 'up' ? 'long' : 'short';
    const slVariance = 1 + (Math.random() - 0.5) * 0.2;
    const slDistance = tick.mid * 0.01 * slVariance;
    const tpDistance = tick.mid * 0.015 * slVariance;
    const rawSize = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    const size = Math.round(rawSize * 100) / 100;
    
    orders.push({
      symbol, side, size, entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'stealth', reason: 'Stealth entry', confidence: 0.55
    });
  }
  return orders.slice(0, 1);
}

function runNewsMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const riskPct = ctx.modeSettings?.news?.riskPerTrade ?? 0.5;
  
  for (const symbol of ctx.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick || tick.regime === 'high_vol') continue;
    if (tick.volatility && tick.volatility > 0.6) continue;
    
    const trend = detectTrend(tick);
    if (trend === 'neutral') continue;
    
    const side: Side = trend === 'up' ? 'long' : 'short';
    const slDistance = tick.mid * 0.008;
    const tpDistance = tick.mid * 0.016;
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
    orders.push({
      symbol, side, size, entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'news', reason: 'Low news-risk environment', confidence: 0.7
    });
  }
  return orders.slice(0, 2);
}

function runHybridMode(ctx: EngineContext): ProposedOrder[] {
  const sniperOrders = runSniperMode(ctx);
  const trendOrders = runTrendMode(ctx);
  const swingOrders = runSwingMode(ctx);
  
  const ordersBySymbol = new Map<string, ProposedOrder>();
  for (const order of [...swingOrders, ...trendOrders, ...sniperOrders]) {
    ordersBySymbol.set(order.symbol, { ...order, mode: 'hybrid', reason: `Hybrid: ${order.reason}` });
  }
  return Array.from(ordersBySymbol.values()).slice(0, 3);
}

const MODE_RUNNERS: Record<TradingMode, (ctx: EngineContext) => ProposedOrder[]> = {
  sniper: runSniperMode, burst: runBurstMode, trend: runTrendMode, swing: runSwingMode,
  memory: runMemoryMode, stealth: runStealthMode, news: runNewsMode, hybrid: runHybridMode,
};

// ============== Main Handler ==============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid auth' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    const body = await req.json().catch(() => ({}));
    const { burstRequested, globalClose, takeBurstProfit } = body;

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

    const riskConfig = config.risk_config || DEFAULT_RISK_CONFIG;
    const burstConfig = config.burst_config || DEFAULT_BURST_CONFIG;
    const modeConfig = config.mode_config || DEFAULT_MODE_CONFIG;
    const marketConfig = config.market_config || DEFAULT_MARKET_CONFIG;
    const today = new Date().toISOString().split('T')[0];

    // Get starting equity
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

    // Load positions and trades
    const { data: positions } = await supabase
      .from('paper_positions')
      .select('*')
      .eq('user_id', userId)
      .eq('closed', false);

    const { data: todayTrades } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('session_date', today);

    // Calculate current stats
    const realizedPnl = (todayTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const unrealizedPnl = (positions || []).reduce((sum: number, p: any) => sum + Number(p.unrealized_pnl || 0), 0);
    const currentPnl = realizedPnl + unrealizedPnl;
    const currentPnlPercent = startingEquity > 0 ? (currentPnl / startingEquity) * 100 : 0;
    const closedCount = (todayTrades || []).length;
    const wins = (todayTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length;
    const winRate = closedCount > 0 ? (wins / closedCount) * 100 : 50;

    // Check if daily loss limit is hit - HALT TRADING
    const isHalted = currentPnlPercent <= -riskConfig.maxDailyLossPercent;
    
    if (isHalted && !config.trading_halted_for_day) {
      // Log halt event and close all positions
      await supabase.from('system_logs').insert({
        user_id: userId,
        level: 'error',
        source: 'risk',
        message: `Trading HALTED: Daily loss limit of ${riskConfig.maxDailyLossPercent}% reached (current: ${currentPnlPercent.toFixed(2)}%)`,
        meta: { currentPnlPercent, limit: riskConfig.maxDailyLossPercent },
      });

      // Close all positions on halt
      for (const pos of (positions || [])) {
        const tick = ticks[pos.symbol];
        const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
        const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
        const pnl = priceDiff * Number(pos.size);

        await supabase.from('paper_trades').insert({
          user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
          size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
          sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
          realized_pnl: pnl, reason: 'risk_halt', session_date: today, batch_id: pos.batch_id,
        });
        await supabase.from('paper_positions').delete().eq('id', pos.id);
      }

      await supabase.from('paper_config').update({ trading_halted_for_day: true }).eq('user_id', userId);
    }

    // Handle global close
    if (globalClose) {
      const { data: allPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('closed', false);
      for (const pos of (allPositions || [])) {
        const tick = ticks[pos.symbol];
        const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
        const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
        const pnl = priceDiff * Number(pos.size);

        await supabase.from('paper_trades').insert({
          user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
          size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
          sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
          realized_pnl: pnl, reason: 'global_close', session_date: today, batch_id: pos.batch_id,
        });
      }
      await supabase.from('paper_positions').delete().eq('user_id', userId);
      await supabase.from('system_logs').insert({
        user_id: userId, level: 'info', source: 'execution',
        message: `Global close: ${(allPositions || []).length} positions closed`,
      });
    }

    // Handle take burst profit
    if (takeBurstProfit) {
      const { data: burstPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('mode', 'burst');
      for (const pos of (burstPositions || [])) {
        const tick = ticks[pos.symbol];
        const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
        const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
        const pnl = priceDiff * Number(pos.size);

        await supabase.from('paper_trades').insert({
          user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
          size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
          sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
          realized_pnl: pnl, reason: 'take_burst_profit', session_date: today, batch_id: pos.batch_id,
        });
        await supabase.from('paper_positions').delete().eq('id', pos.id);
      }
      await supabase.from('system_logs').insert({
        user_id: userId, level: 'info', source: 'burst',
        message: `Take burst profit: ${(burstPositions || []).length} burst positions closed`,
      });
    }

    // Update burst requested flag
    if (burstRequested !== undefined) {
      await supabase.from('paper_config').update({ burst_requested: burstRequested }).eq('user_id', userId);
      config.burst_requested = burstRequested;
      if (burstRequested) {
        await supabase.from('system_logs').insert({
          user_id: userId, level: 'info', source: 'burst',
          message: `Burst mode activated - preparing ${burstConfig.size} micro-positions`,
        });
      }
    }

    // Re-fetch positions after closures
    const { data: currentPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('closed', false);

    // Mark positions to market and check SL/TP
    for (const pos of (currentPositions || [])) {
      const tick = ticks[pos.symbol];
      if (!tick) continue;

      const currentPrice = pos.side === 'long' ? tick.bid : tick.ask;
      const priceDiff = pos.side === 'long' ? currentPrice - Number(pos.entry_price) : Number(pos.entry_price) - currentPrice;
      const unrealizedPnl = priceDiff * Number(pos.size);

      await supabase.from('paper_positions').update({ unrealized_pnl: unrealizedPnl }).eq('id', pos.id);

      // Check SL/TP exits
      let closeReason: string | null = null;
      let exitPrice = currentPrice;

      if (pos.sl) {
        if (pos.side === 'long' && tick.bid <= Number(pos.sl)) { closeReason = 'sl_hit'; exitPrice = Number(pos.sl); }
        else if (pos.side === 'short' && tick.ask >= Number(pos.sl)) { closeReason = 'sl_hit'; exitPrice = Number(pos.sl); }
      }
      if (!closeReason && pos.tp) {
        if (pos.side === 'long' && tick.bid >= Number(pos.tp)) { closeReason = 'tp_hit'; exitPrice = Number(pos.tp); }
        else if (pos.side === 'short' && tick.ask <= Number(pos.tp)) { closeReason = 'tp_hit'; exitPrice = Number(pos.tp); }
      }

      if (closeReason) {
        const finalPriceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
        const realizedPnl = finalPriceDiff * Number(pos.size);

        await supabase.from('paper_trades').insert({
          user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
          size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
          sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
          realized_pnl: realizedPnl, reason: closeReason, session_date: today, batch_id: pos.batch_id,
        });
        await supabase.from('paper_positions').delete().eq('id', pos.id);

        await supabase.from('system_logs').insert({
          user_id: userId,
          level: realizedPnl >= 0 ? 'info' : 'warn',
          source: `execution`,
          message: `${pos.symbol} ${pos.side.toUpperCase()} closed: ${closeReason} | P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}`,
          meta: { pnl: realizedPnl, mode: pos.mode },
        });
      }
    }

    // ===== RUN TRADING MODES (only if not halted) =====
    const { data: finalPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('closed', false);
    const { data: finalTrades } = await supabase.from('paper_trades').select('*').eq('user_id', userId).eq('session_date', today);
    
    // Recalculate stats
    const finalRealizedPnl = (finalTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const finalUnrealizedPnl = (finalPositions || []).reduce((sum: number, p: any) => sum + Number(p.unrealized_pnl || 0), 0);
    const finalTodayPnl = finalRealizedPnl + finalUnrealizedPnl;
    const finalTodayPnlPercent = startingEquity > 0 ? (finalTodayPnl / startingEquity) * 100 : 0;
    const finalClosedCount = (finalTrades || []).length;
    const finalWins = (finalTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length;
    const finalWinRate = finalClosedCount > 0 ? (finalWins / finalClosedCount) * 100 : 50;

    // Check if should run modes
    const shouldRunModes = !isHalted && !config.trading_halted_for_day && !globalClose && !takeBurstProfit;
    
    console.log(`[ENGINE] shouldRunModes=${shouldRunModes}, enabledModes=${JSON.stringify(modeConfig.enabledModes)}, burstRequested=${config.burst_requested}`);
    
    if (shouldRunModes) {
      // Calculate current ACTUAL risk exposure based on stop-loss distance, not full notional
      // For paper trading, use actual risk (SL distance * size) not notional position value
      const currentRiskExposure = (finalPositions || []).reduce((sum: number, p: any) => {
        const entryPrice = Number(p.entry_price);
        const sl = p.sl ? Number(p.sl) : entryPrice * 0.99; // Default 1% SL if none
        const slDistance = Math.abs(entryPrice - sl);
        const actualRisk = slDistance * Number(p.size);
        return sum + (actualRisk / startingEquity) * 100;
      }, 0);
      
      // For paper trading, use a much higher risk capacity (50%) to allow learning
      const paperRiskCapacity = 50; // 50% max concurrent risk for paper
      const remainingRiskCapacity = paperRiskCapacity - currentRiskExposure;
      const availableSlots = (riskConfig.maxOpenTrades || 20) - (finalPositions || []).length;
      
      console.log(`[ENGINE] currentRisk=${currentRiskExposure.toFixed(2)}% (actual SL risk), remainingCapacity=${remainingRiskCapacity.toFixed(2)}%, availableSlots=${availableSlots}`);

      if (remainingRiskCapacity > 0 && availableSlots > 0) {
        // Build engine context
        const ctx: EngineContext = {
          selectedSymbols: marketConfig.selectedSymbols || [],
          ticks,
          equity: startingEquity + finalTodayPnl,
          winRate: finalWinRate,
          recentTrades: finalTrades || [],
          modeSettings: modeConfig.modeSettings || {},
          burstConfig,
          burstRequested: config.burst_requested,
        };
        
        console.log(`[ENGINE] Context: symbols=${ctx.selectedSymbols.join(',')}, equity=${ctx.equity}, burstRequested=${ctx.burstRequested}`);
        console.log(`[ENGINE] Ticks available: ${Object.keys(ticks).join(',')}`);

        // Check burst lock status
        const burstTrades = (finalTrades || []).filter((t: any) => t.mode === 'burst');
        const burstPnl = burstTrades.reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
        const burstPnlPercent = startingEquity > 0 ? (burstPnl / startingEquity) * 100 : 0;
        const burstLocked = burstPnlPercent >= burstConfig.dailyProfitTargetPercent;

        // Determine which modes to run
        // Always include burst if burst is requested, even if not in enabledModes
        const modesToRun = new Set<TradingMode>(modeConfig.enabledModes as TradingMode[] || []);
        if (config.burst_requested && !burstLocked) {
          modesToRun.add('burst');
        }
        
        console.log(`[ENGINE] Modes to run: ${Array.from(modesToRun).join(',')}, burstLocked=${burstLocked}`);

        // Run enabled modes
        const allProposedOrders: ProposedOrder[] = [];
        
        for (const mode of modesToRun) {
          // Skip burst if locked
          if (mode === 'burst' && burstLocked) {
            console.log(`[ENGINE] Burst mode locked (pnl=${burstPnlPercent.toFixed(2)}%)`);
            if (config.burst_requested) {
              await supabase.from('system_logs').insert({
                user_id: userId, level: 'info', source: 'burst',
                message: `Burst mode locked: Daily profit target of ${burstConfig.dailyProfitTargetPercent}% reached`,
              });
            }
            continue;
          }

          const runner = MODE_RUNNERS[mode];
          if (!runner) {
            console.log(`[ENGINE] No runner for mode: ${mode}`);
            continue;
          }

          try {
            console.log(`[ENGINE] Running mode: ${mode}`);
            const orders = runner(ctx);
            console.log(`[ENGINE] Mode ${mode} generated ${orders.length} orders`);
            allProposedOrders.push(...orders);
          } catch (err) {
            console.error(`[ENGINE] Mode ${mode} error:`, err);
          }
        }
        
        console.log(`[ENGINE] Total proposed orders: ${allProposedOrders.length}`);

        // Apply risk guardrails and open positions
        // FIXED: Use ACTUAL RISK (stop-loss risk), not full position notional value
        let usedRiskCount = 0; // Count of trades used for risk tracking
        let openedCount = 0;
        const openedByMode: Record<string, number> = {};
        const blockedReasons: string[] = [];
        
        // For paper trading, use permissive risk limits
        // Each trade uses its configured risk % (e.g., 0.1% for burst), not position notional
        const maxTradesThisTick = Math.min(availableSlots, 25); // Allow up to 25 trades per tick
        
        console.log(`[RISK] Starting risk check: maxTradesThisTick=${maxTradesThisTick}, remainingCapacity=${remainingRiskCapacity.toFixed(2)}%`);

        for (const order of allProposedOrders) {
          // Check if we've hit the slot limit
          if (openedCount >= maxTradesThisTick) {
            console.log(`[RISK] BLOCKED ${order.symbol}: slots_exhausted (opened=${openedCount}, max=${maxTradesThisTick})`);
            blockedReasons.push(`slots_exhausted`);
            break;
          }
          
          // Calculate ACTUAL risk based on stop-loss distance, not full notional
          // If no SL, assume a default risk of 1% of entry
          const slDistance = order.sl 
            ? Math.abs(order.entryPrice - order.sl) 
            : order.entryPrice * 0.01;
          const actualRiskAmount = order.size * slDistance;
          const actualRiskPercent = (actualRiskAmount / startingEquity) * 100;
          
          // For paper trading, be very permissive: allow up to 5% risk per individual trade
          const maxRiskPerTrade = 5; // 5% max per single trade
          if (actualRiskPercent > maxRiskPerTrade) {
            console.log(`[RISK] BLOCKED ${order.symbol}: perTradeRisk=${actualRiskPercent.toFixed(2)}% > max=${maxRiskPerTrade}%`);
            blockedReasons.push(`per_trade_risk:${order.symbol}:${actualRiskPercent.toFixed(1)}%`);
            continue;
          }

          // Check per-symbol limit - allow multiple positions per symbol for burst mode
          const currentSymbolPositions = (finalPositions || []).filter((p: any) => p.symbol === order.symbol).length + 
            openedCount; // Include positions opened this tick
          const maxPerSymbol = order.mode === 'burst' ? 50 : 10; // Burst can have many more
          
          if (currentSymbolPositions >= maxPerSymbol) {
            console.log(`[RISK] BLOCKED ${order.symbol}: symbol_limit (current=${currentSymbolPositions}, max=${maxPerSymbol})`);
            blockedReasons.push(`symbol_limit:${order.symbol}`);
            continue;
          }

          // Open position - all checks passed
          console.log(`[ENGINE] Opening: ${order.symbol} ${order.side} size=${order.size.toFixed(6)} @ ${order.entryPrice.toFixed(2)} risk=${actualRiskPercent.toFixed(3)}%`);
          
          const { error: insertError } = await supabase.from('paper_positions').insert({
            user_id: userId,
            symbol: order.symbol,
            mode: order.mode,
            side: order.side,
            size: order.size,
            entry_price: order.entryPrice,
            sl: order.sl,
            tp: order.tp,
            batch_id: order.batchId,
            unrealized_pnl: 0,
          });
          
          if (insertError) {
            console.error(`[ENGINE] Failed to insert position:`, insertError);
            blockedReasons.push(`db_error:${order.symbol}`);
            continue;
          }

          usedRiskCount++;
          openedCount++;
          openedByMode[order.mode] = (openedByMode[order.mode] || 0) + 1;
        }
        
        console.log(`[ENGINE] Result: opened=${openedCount}/${allProposedOrders.length}, blocked=${blockedReasons.length}`);

        // Log opened positions by mode
        for (const [mode, count] of Object.entries(openedByMode)) {
          await supabase.from('system_logs').insert({
            user_id: userId,
            level: 'info',
            source: mode === 'burst' ? 'burst' : 'execution',
            message: `[${mode.toUpperCase()}] Opened ${count} position(s)`,
            meta: { count, mode },
          });
        }
        
        // Log blocked reasons with detail
        if (blockedReasons.length > 0) {
          const reasonCounts: Record<string, number> = {};
          for (const r of blockedReasons) {
            const key = r.split(':')[0];
            reasonCounts[key] = (reasonCounts[key] || 0) + 1;
          }
          
          await supabase.from('system_logs').insert({
            user_id: userId,
            level: openedCount > 0 ? 'info' : 'warn',
            source: 'risk',
            message: openedCount > 0 
              ? `${openedCount} opened, ${blockedReasons.length} blocked (${Object.entries(reasonCounts).map(([k,v]) => `${k}:${v}`).join(', ')})`
              : `All ${allProposedOrders.length} orders blocked: ${Object.entries(reasonCounts).map(([k,v]) => `${k}:${v}`).join(', ')}`,
            meta: { proposed: allProposedOrders.length, opened: openedCount, reasons: blockedReasons.slice(0, 20) },
          });
        }

        // Reset burst flag after burst executes
        if (config.burst_requested && openedByMode['burst']) {
          await supabase.from('paper_config').update({ burst_requested: false }).eq('user_id', userId);
        }
      } else {
        console.log(`[ENGINE] Cannot open positions: remainingCapacity=${remainingRiskCapacity.toFixed(2)}%, availableSlots=${availableSlots}`);
        if (remainingRiskCapacity <= 0) {
          await supabase.from('system_logs').insert({
            user_id: userId, level: 'warn', source: 'risk',
            message: `Max concurrent risk reached (${currentRiskExposure.toFixed(1)}%) - no new positions`,
          });
        }
      }
    } else {
      console.log(`[ENGINE] Not running modes: isHalted=${isHalted}, tradingHalted=${config.trading_halted_for_day}, globalClose=${globalClose}, takeBurstProfit=${takeBurstProfit}`);
    }

    // Final stats calculation
    const { data: endPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('closed', false);
    const { data: endTrades } = await supabase.from('paper_trades').select('*').eq('user_id', userId).eq('session_date', today);

    const endRealizedPnl = (endTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const endUnrealizedPnl = (endPositions || []).reduce((sum: number, p: any) => sum + Number(p.unrealized_pnl || 0), 0);
    const endTodayPnl = endRealizedPnl + endUnrealizedPnl;
    const endTodayPnlPercent = startingEquity > 0 ? (endTodayPnl / startingEquity) * 100 : 0;
    const endClosedCount = (endTrades || []).length;
    const endWins = (endTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length;
    const endWinRate = endClosedCount > 0 ? (endWins / endClosedCount) * 100 : 0;

    // Calculate avg R:R
    const profitTrades = (endTrades || []).filter((t: any) => Number(t.realized_pnl) > 0);
    const lossTrades = (endTrades || []).filter((t: any) => Number(t.realized_pnl) < 0);
    const avgWin = profitTrades.length > 0 ? profitTrades.reduce((s: number, t: any) => s + Number(t.realized_pnl), 0) / profitTrades.length : 0;
    const avgLoss = lossTrades.length > 0 ? Math.abs(lossTrades.reduce((s: number, t: any) => s + Number(t.realized_pnl), 0) / lossTrades.length) : 1;
    const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;

    // Burst stats
    const burstTrades = (endTrades || []).filter((t: any) => t.mode === 'burst');
    const burstPnl = burstTrades.reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
    const burstPnlPercent = startingEquity > 0 ? (burstPnl / startingEquity) * 100 : 0;
    const burstPositions = (endPositions || []).filter((p: any) => p.mode === 'burst');
    const burstStatus = burstPositions.length > 0 ? 'running' : burstPnlPercent >= burstConfig.dailyProfitTargetPercent ? 'locked' : 'idle';

    // Update daily stats
    await supabase.from('paper_stats_daily').upsert({
      user_id: userId, trade_date: today,
      equity_start: startingEquity, equity_end: startingEquity + endTodayPnl,
      pnl: endTodayPnl, win_rate: endWinRate, trades_count: endClosedCount,
    }, { onConflict: 'user_id,trade_date' });

    // Update account equity
    await supabase.from('accounts').update({ equity: startingEquity + endTodayPnl }).eq('user_id', userId).eq('type', 'paper');

    const stats = {
      equity: startingEquity + endTodayPnl,
      todayPnl: endTodayPnl,
      todayPnlPercent: endTodayPnlPercent,
      winRate: endWinRate,
      avgRR: avgRR,
      tradesToday: endClosedCount,
      maxDrawdown: 0,
      openPositionsCount: (endPositions || []).length,
      burstPnlToday: burstPnlPercent,
      burstsToday: new Set(burstTrades.map((t: any) => t.batch_id).filter(Boolean)).size,
      burstStatus,
    };

    return new Response(JSON.stringify({
      stats,
      positions: endPositions,
      trades: endTrades,
      ticks,
      halted: isHalted || config.trading_halted_for_day,
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
