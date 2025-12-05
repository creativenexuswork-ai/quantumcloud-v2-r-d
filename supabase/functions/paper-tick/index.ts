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
type SessionStatus = 'idle' | 'running' | 'holding' | 'stopped';

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
  if (tick.regime === 'low_vol') {
    return 'neutral';
  }
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
  
  for (const symbol of ctx.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) continue;
    if (tick.regime === 'low_vol') continue;
    
    const trend = detectTrend(tick);
    const side: Side = trend !== 'neutral' ? (trend === 'up' ? 'long' : 'short') : (Math.random() > 0.5 ? 'long' : 'short');
    const slDistance = tick.mid * 0.015;
    const tpDistance = tick.mid * 0.03;
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
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
  
  return orders.slice(0, 2);
}

function runBurstMode(ctx: EngineContext): ProposedOrder[] {
  if (!ctx.burstRequested) return [];
  
  const orders: ProposedOrder[] = [];
  const burstSize = ctx.burstConfig?.size ?? 20;
  const totalRisk = ctx.burstConfig?.riskPerBurstPercent ?? 2;
  const riskPerTrade = totalRisk / burstSize;
  
  let bestSymbol: string | null = null;
  let bestScore = 0;
  
  for (const symbol of ctx.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) continue;
    const score = (tick.volatility ?? 0.5) * (tick.regime === 'trend' ? 1.5 : tick.regime === 'high_vol' ? 1.3 : 1);
    if (score > bestScore) { bestScore = score; bestSymbol = symbol; }
  }
  
  if (!bestSymbol && ctx.selectedSymbols.length > 0) {
    bestSymbol = ctx.selectedSymbols[0];
  }
  
  if (!bestSymbol) return [];
  
  const tick = ctx.ticks[bestSymbol];
  if (!tick) return [];
  
  const trend = detectTrend(tick);
  const side: Side = trend === 'down' ? 'short' : 'long';
  const batchId = generateBatchId();
  
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
  
  return orders;
}

function runTrendMode(ctx: EngineContext): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const riskPct = ctx.modeSettings?.trend?.riskPerTrade ?? 1;
  
  for (const symbol of ctx.selectedSymbols) {
    const tick = ctx.ticks[symbol];
    if (!tick) continue;
    if (tick.regime === 'low_vol') continue;
    
    const trend = detectTrend(tick);
    const side: Side = trend !== 'neutral' ? (trend === 'up' ? 'long' : 'short') : (Math.random() > 0.5 ? 'long' : 'short');
    const slDistance = tick.mid * 0.01;
    const tpDistance = tick.mid * 0.02;
    const size = calculateSize(ctx.equity, riskPct, tick.mid, slDistance);
    
    orders.push({
      symbol, side, size, entryPrice: tick.mid,
      sl: side === 'long' ? tick.mid - slDistance : tick.mid + slDistance,
      tp: side === 'long' ? tick.mid + tpDistance : tick.mid - tpDistance,
      mode: 'trend', reason: `Trend entry on ${tick.regime}`, confidence: 0.7
    });
  }
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
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

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
    const { burstRequested, globalClose, takeBurstProfit, takeProfit } = body;

    // ================================================================
    // CRITICAL: MANUAL ACTION GUARD - Check FIRST, return EARLY
    // If this is a manual action (takeProfit or globalClose), we:
    // 1. Close all positions
    // 2. Return immediately
    // 3. NEVER run mode logic
    // ================================================================
    const isManualAction = takeProfit === true || globalClose === true;
    
    if (isManualAction) {
      console.log(`[MANUAL_ACTION] Detected: takeProfit=${takeProfit}, globalClose=${globalClose}`);
    }

    // Fetch latest prices (needed for closing positions at current price)
    const priceResponse = await fetch(`${supabaseUrl}/functions/v1/price-feed`, {
      headers: { Authorization: `Bearer ${supabaseKey}` },
    });
    const { ticks } = await priceResponse.json();

    // Get today's date for trade records
    const today = new Date().toISOString().split('T')[0];

    // ================================================================
    // TAKE PROFIT HANDLER - Atomic close, returns IMMEDIATELY
    // HARD DELETE all positions - no leftovers
    // ================================================================
    if (takeProfit === true) {
      console.log(`[TAKE_PROFIT] ATOMIC CLOSE starting for user ${userId}`);
      
      // HARD FETCH all positions for this user (no closed filter - get everything)
      const { data: allPositions } = await supabase
        .from('paper_positions')
        .select('*')
        .eq('user_id', userId);
      
      const closedCount = (allPositions || []).length;
      let closePnl = 0;
      
      // Fetch existing trades for stats
      const { data: existingTrades } = await supabase
        .from('paper_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('session_date', today);
      
      const existingRealizedPnl = (existingTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
      
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
      
      // Get current session status to preserve it
      const { data: config } = await supabase
        .from('paper_config')
        .select('session_status')
        .eq('user_id', userId)
        .maybeSingle();
      
      const currentSessionStatus = config?.session_status || 'running';
      
      if (closedCount > 0) {
        // Build trade records for each position
        const tradeRecords = (allPositions || []).map(pos => {
          const tick = ticks[pos.symbol];
          const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
          const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
          const pnl = priceDiff * Number(pos.size);
          closePnl += pnl;
          
          return {
            user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
            size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
            sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
            realized_pnl: pnl, reason: 'take_profit', session_date: today, batch_id: pos.batch_id,
          };
        });
        
        // CRITICAL: HARD DELETE all positions for user - no filter by closed
        await Promise.all([
          supabase.from('paper_trades').insert(tradeRecords),
          supabase.from('paper_positions').delete().eq('user_id', userId),
          supabase.from('system_logs').insert({
            user_id: userId, level: 'info', source: 'execution',
            message: `TAKE PROFIT: ${closedCount} positions closed (hard delete). Session continues (${currentSessionStatus}).`,
          }),
        ]);
      } else {
        await supabase.from('system_logs').insert({
          user_id: userId, level: 'info', source: 'execution',
          message: `TAKE PROFIT: No positions found.`,
        });
      }
      
      // Calculate final stats
      const totalRealizedPnl = existingRealizedPnl + closePnl;
      const finalTradesToday = (existingTrades?.length || 0) + closedCount;
      const wins = (existingTrades || []).filter((t: any) => Number(t.realized_pnl) > 0).length + (closePnl > 0 ? 1 : 0);
      
      console.log(`[TAKE_PROFIT] COMPLETE: closed=${closedCount}, pnl=${closePnl.toFixed(2)}, status=${currentSessionStatus}`);
      
      // CRITICAL: Return IMMEDIATELY - absolutely NO mode execution after this
      return new Response(JSON.stringify({ 
        success: true, 
        action: 'takeProfit',
        closedCount,
        sessionStatus: currentSessionStatus,
        stats: {
          todayPnl: totalRealizedPnl,
          tradesToday: finalTradesToday,
          openPositionsCount: 0,
          equity: startingEquity + totalRealizedPnl,
          winRate: finalTradesToday > 0 ? (wins / finalTradesToday) * 100 : 50,
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ================================================================
    // GLOBAL CLOSE HANDLER - Atomic close + STOP, returns IMMEDIATELY
    // HARD DELETE all positions - no leftovers
    // ================================================================
    if (globalClose === true) {
      console.log(`[GLOBAL_CLOSE] ATOMIC CLOSE + STOP starting for user ${userId}`);
      
      // HARD FETCH all positions for this user (no closed filter - get everything)
      const { data: allPositions } = await supabase
        .from('paper_positions')
        .select('*')
        .eq('user_id', userId);
      
      const closedCount = (allPositions || []).length;
      let closePnl = 0;
      
      // Fetch existing trades for stats
      const { data: existingTrades } = await supabase
        .from('paper_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('session_date', today);
      
      const existingRealizedPnl = (existingTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
      
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
      
      if (closedCount > 0) {
        // Build trade records for each position
        const tradeRecords = (allPositions || []).map(pos => {
          const tick = ticks[pos.symbol];
          const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
          const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
          const pnl = priceDiff * Number(pos.size);
          closePnl += pnl;
          
          return {
            user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
            size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
            sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
            realized_pnl: pnl, reason: 'global_close', session_date: today, batch_id: pos.batch_id,
          };
        });
        
        // CRITICAL: HARD DELETE all positions + set session idle
        await Promise.all([
          supabase.from('paper_trades').insert(tradeRecords),
          supabase.from('paper_positions').delete().eq('user_id', userId),
          supabase.from('paper_config').update({ 
            session_status: 'idle',
            is_running: false,
            burst_requested: false
          }).eq('user_id', userId),
          supabase.from('system_logs').insert({
            user_id: userId, level: 'info', source: 'execution',
            message: `CLOSE ALL: ${closedCount} positions closed (hard delete). Session stopped.`,
          }),
        ]);
      } else {
        // No positions found, just update config to idle
        await Promise.all([
          supabase.from('paper_config').update({ 
            session_status: 'idle',
            is_running: false,
            burst_requested: false
          }).eq('user_id', userId),
          supabase.from('system_logs').insert({
            user_id: userId, level: 'info', source: 'execution',
            message: `CLOSE ALL: No positions found. Session stopped.`,
          }),
        ]);
      }
      
      // Calculate final stats
      const totalRealizedPnl = existingRealizedPnl + closePnl;
      const finalTradesToday = (existingTrades?.length || 0) + closedCount;
      
      console.log(`[GLOBAL_CLOSE] COMPLETE: closed=${closedCount}, pnl=${closePnl.toFixed(2)}, status=idle`);
      
      // CRITICAL: Return IMMEDIATELY - absolutely NO mode execution after this
      return new Response(JSON.stringify({ 
        success: true, 
        action: 'globalClose',
        closedCount,
        sessionStatus: 'idle',
        stats: {
          todayPnl: totalRealizedPnl,
          tradesToday: finalTradesToday,
          openPositionsCount: 0,
          equity: startingEquity + totalRealizedPnl,
          winRate: 50,
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ================================================================
    // REGULAR TICK - Only runs if NOT a manual action
    // ================================================================
    
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
          session_status: 'idle',
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
    const sessionStatus: SessionStatus = config.session_status || 'idle';

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
      await supabase.from('system_logs').insert({
        user_id: userId,
        level: 'error',
        source: 'risk',
        message: `RISK: Trading HALTED - Daily loss limit of ${riskConfig.maxDailyLossPercent}% reached (current: ${currentPnlPercent.toFixed(2)}%)`,
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

      await supabase.from('paper_config').update({ 
        trading_halted_for_day: true, 
        session_status: 'idle',
        is_running: false 
      }).eq('user_id', userId);
    }

    // Handle take burst profit
    if (takeBurstProfit) {
      const { data: burstPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('mode', 'burst');
      const burstCount = (burstPositions || []).length;
      
      if (burstCount > 0) {
        const burstIds = (burstPositions || []).map(p => p.id);
        const tradeRecords = (burstPositions || []).map(pos => {
          const tick = ticks[pos.symbol];
          const exitPrice = tick ? (pos.side === 'long' ? tick.bid : tick.ask) : Number(pos.entry_price);
          const priceDiff = pos.side === 'long' ? exitPrice - Number(pos.entry_price) : Number(pos.entry_price) - exitPrice;
          const pnl = priceDiff * Number(pos.size);
          
          return {
            user_id: userId, symbol: pos.symbol, mode: pos.mode, side: pos.side,
            size: pos.size, entry_price: pos.entry_price, exit_price: exitPrice,
            sl: pos.sl, tp: pos.tp, opened_at: pos.opened_at,
            realized_pnl: pnl, reason: 'take_burst_profit', session_date: today, batch_id: pos.batch_id,
          };
        });
        
        await Promise.all([
          supabase.from('paper_trades').insert(tradeRecords),
          supabase.from('paper_positions').delete().in('id', burstIds),
          supabase.from('system_logs').insert({
            user_id: userId, level: 'info', source: 'burst',
            message: `BURST: Take profit - ${burstCount} burst positions closed`,
          }),
        ]);
      }
    }

    // Update burst requested flag
    if (burstRequested !== undefined) {
      await supabase.from('paper_config').update({ burst_requested: burstRequested }).eq('user_id', userId);
      config.burst_requested = burstRequested;
      if (burstRequested) {
        await supabase.from('system_logs').insert({
          user_id: userId, level: 'info', source: 'burst',
          message: `BURST: Mode activated - preparing ${burstConfig.size} micro-positions`,
        });
      }
    }

    // Re-fetch positions after closures
    const { data: currentPositions } = await supabase.from('paper_positions').select('*').eq('user_id', userId).eq('closed', false);

    // Mark positions to market and check SL/TP (always do this, even when holding)
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
          source: 'execution',
          message: `EXECUTION: ${pos.symbol} ${pos.side.toUpperCase()} closed - ${closeReason} | P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}`,
          meta: { pnl: realizedPnl, mode: pos.mode },
        });
      }
    }

    // ===== RUN TRADING MODES (only if running, not paused, not halted) =====
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

    // CRITICAL: Re-fetch session status right before deciding to open new trades
    const { data: freshConfig } = await supabase.from('paper_config').select('session_status, is_running').eq('user_id', userId).maybeSingle();
    const freshSessionStatus: SessionStatus = freshConfig?.session_status || 'idle';
    const freshIsRunning = freshConfig?.is_running ?? false;
    
    // Determine if we should run modes (ONLY when status is explicitly 'running' AND is_running is true)
    const shouldRunModes = freshSessionStatus === 'running' && freshIsRunning && !isHalted && !config.trading_halted_for_day;
    
    console.log(`[ENGINE] sessionStatus=${freshSessionStatus}, is_running=${freshIsRunning}, shouldRunModes=${shouldRunModes}, enabledModes=${JSON.stringify(modeConfig.enabledModes)}`);
    
    if (shouldRunModes) {
      // Calculate current ACTUAL risk exposure based on stop-loss distance
      const currentRiskExposure = (finalPositions || []).reduce((sum: number, p: any) => {
        const entryPrice = Number(p.entry_price);
        const sl = p.sl ? Number(p.sl) : entryPrice * 0.99;
        const slDistance = Math.abs(entryPrice - sl);
        const actualRisk = slDistance * Number(p.size);
        return sum + (actualRisk / startingEquity) * 100;
      }, 0);
      
      const paperRiskCapacity = 50;
      const remainingRiskCapacity = paperRiskCapacity - currentRiskExposure;
      const availableSlots = (riskConfig.maxOpenTrades || 20) - (finalPositions || []).length;
      
      console.log(`[ENGINE] currentRisk=${currentRiskExposure.toFixed(2)}%, remainingCapacity=${remainingRiskCapacity.toFixed(2)}%, availableSlots=${availableSlots}`);

      if (remainingRiskCapacity > 0 && availableSlots > 0) {
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

        // Check burst lock status
        const burstTrades = (finalTrades || []).filter((t: any) => t.mode === 'burst');
        const burstPnl = burstTrades.reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);
        const burstPnlPercent = startingEquity > 0 ? (burstPnl / startingEquity) * 100 : 0;
        const burstLocked = burstPnlPercent >= burstConfig.dailyProfitTargetPercent;

        const modesToRun = new Set<TradingMode>(modeConfig.enabledModes as TradingMode[] || []);
        if (config.burst_requested && !burstLocked) {
          modesToRun.add('burst');
        }

        // Run enabled modes
        const allProposedOrders: ProposedOrder[] = [];
        
        for (const mode of modesToRun) {
          if (mode === 'burst' && burstLocked) {
            if (config.burst_requested) {
              await supabase.from('system_logs').insert({
                user_id: userId, level: 'info', source: 'burst',
                message: `BURST: Mode locked - Daily profit target of ${burstConfig.dailyProfitTargetPercent}% reached`,
              });
            }
            continue;
          }

          const runner = MODE_RUNNERS[mode];
          if (!runner) continue;

          try {
            const orders = runner(ctx);
            allProposedOrders.push(...orders);
          } catch (err) {
            console.error(`[ENGINE] Mode ${mode} error:`, err);
          }
        }

        // Apply risk guardrails and open positions
        let openedCount = 0;
        let riskBlockedCount = 0;
        let dbErrorCount = 0;
        const openedByMode: Record<string, number> = {};
        const riskBlockReasons: string[] = [];
        const dbErrors: string[] = [];
        
        const maxTradesThisTick = Math.min(availableSlots, 25);

        for (const order of allProposedOrders) {
          if (openedCount >= maxTradesThisTick) {
            riskBlockedCount++;
            riskBlockReasons.push(`slots_exhausted`);
            break;
          }
          
          const slDistance = order.sl 
            ? Math.abs(order.entryPrice - order.sl) 
            : order.entryPrice * 0.01;
          const actualRiskAmount = order.size * slDistance;
          const actualRiskPercent = (actualRiskAmount / startingEquity) * 100;
          
          const maxRiskPerTrade = 5;
          if (actualRiskPercent > maxRiskPerTrade) {
            riskBlockedCount++;
            riskBlockReasons.push(`per_trade_risk:${actualRiskPercent.toFixed(1)}%`);
            continue;
          }

          const currentSymbolPositions = (finalPositions || []).filter((p: any) => p.symbol === order.symbol).length + openedCount;
          const maxPerSymbol = order.mode === 'burst' ? 50 : 10;
          
          if (currentSymbolPositions >= maxPerSymbol) {
            riskBlockedCount++;
            riskBlockReasons.push(`symbol_limit:${order.symbol}`);
            continue;
          }

          // Attempt to insert position
          const insertPayload = {
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
          };
          
          const { error: insertError } = await supabase.from('paper_positions').insert(insertPayload);
          
          if (insertError) {
            console.error(`[ENGINE] Insert error for ${order.symbol}:`, JSON.stringify(insertError));
            dbErrorCount++;
            dbErrors.push(`${order.symbol}:${insertError.code || 'unknown'}`);
            continue;
          }

          openedCount++;
          openedByMode[order.mode] = (openedByMode[order.mode] || 0) + 1;
        }

        // Log opened positions by mode
        for (const [mode, count] of Object.entries(openedByMode)) {
          await supabase.from('system_logs').insert({
            user_id: userId,
            level: 'info',
            source: mode === 'burst' ? 'burst' : 'execution',
            message: `${mode.toUpperCase()}: Opened ${count} position(s)`,
            meta: { count, mode },
          });
        }
        
        // Log risk-blocked orders
        if (riskBlockedCount > 0) {
          const uniqueReasons = [...new Set(riskBlockReasons)].slice(0, 3).join(', ');
          await supabase.from('system_logs').insert({
            user_id: userId, level: 'warn', source: 'risk',
            message: `RISK: ${riskBlockedCount} order(s) blocked (${uniqueReasons})`,
            meta: { blocked: riskBlockedCount, reasons: riskBlockReasons },
          });
        }
        
        // Log DB errors separately
        if (dbErrorCount > 0) {
          const uniqueErrors = [...new Set(dbErrors)].slice(0, 3).join(', ');
          await supabase.from('system_logs').insert({
            user_id: userId, level: 'error', source: 'execution',
            message: `ERROR: ${dbErrorCount} order(s) failed to insert (${uniqueErrors})`,
            meta: { errors: dbErrors },
          });
        }
      }
    }

    // Final position count
    const { data: veryFinalPositions } = await supabase.from('paper_positions').select('id').eq('user_id', userId).eq('closed', false);
    const { data: veryFinalTrades } = await supabase.from('paper_trades').select('realized_pnl').eq('user_id', userId).eq('session_date', today);
    
    const veryFinalRealizedPnl = (veryFinalTrades || []).reduce((sum: number, t: any) => sum + Number(t.realized_pnl), 0);

    return new Response(JSON.stringify({ 
      success: true, 
      sessionStatus: freshSessionStatus,
      halted: isHalted,
      stats: {
        todayPnl: finalTodayPnl,
        todayPnlPercent: finalTodayPnlPercent,
        tradesToday: finalClosedCount,
        openPositionsCount: (veryFinalPositions || []).length,
        equity: startingEquity + veryFinalRealizedPnl,
        winRate: finalWinRate,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Paper tick error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
