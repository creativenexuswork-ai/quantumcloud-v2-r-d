import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= SUPPORTED PAIRS =============
const CRYPTO_PAIRS = ['BTCUSD', 'ETHUSD', 'XRPUSD', 'SOLUSD', 'ADAUSD', 'BNBUSD', 'AVAXUSD'];
const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'AUDUSD', 'USDCHF'];
const STOCK_SYMBOLS = ['TSLA', 'AAPL', 'NVDA', 'SPY', 'QQQ', 'META', 'MSFT'];

// ============= TIMEFRAME MAP =============
const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
};

// ============= TYPES =============
interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PriceTick {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  volatility: number;
  regime: string;
  timestamp: string;
  timeframe: string;
  source: string;
  marketOpen: boolean;
}

type MarketType = 'crypto' | 'forex' | 'stock';

// ============= MARKET TYPE DETECTION =============
function getMarketType(symbol: string): MarketType {
  if (CRYPTO_PAIRS.includes(symbol)) return 'crypto';
  if (FOREX_PAIRS.includes(symbol)) return 'forex';
  if (STOCK_SYMBOLS.includes(symbol)) return 'stock';
  // Default detection by pattern
  if (symbol.endsWith('USD') && symbol.length <= 7) return 'crypto';
  if (symbol.length === 6 && symbol.includes('USD')) return 'forex';
  return 'stock';
}

// ============= SPREAD SIMULATION =============
function applySpread(mid: number, marketType: MarketType, symbol: string): { bid: number; ask: number } {
  let spreadPercent: number;
  
  switch (marketType) {
    case 'forex':
      // 0.1 - 0.6 pips for forex (0.001% - 0.006%)
      spreadPercent = 0.00001 + Math.random() * 0.00005;
      break;
    case 'crypto':
      // 0.02% - 0.15% for crypto
      spreadPercent = 0.0002 + Math.random() * 0.0013;
      break;
    case 'stock':
      // 0.01% - 0.05% for stocks
      spreadPercent = 0.0001 + Math.random() * 0.0004;
      break;
    default:
      spreadPercent = 0.0002;
  }
  
  const halfSpread = mid * spreadPercent / 2;
  return {
    bid: mid - halfSpread,
    ask: mid + halfSpread,
  };
}

// ============= MARKET HOURS CHECK =============
function isMarketOpen(marketType: MarketType): boolean {
  if (marketType === 'crypto') return true; // Always open
  
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay();
  
  if (marketType === 'stock') {
    // US Stock Market: 9:30 AM - 4:00 PM ET (14:30 - 21:00 UTC)
    // Closed on weekends
    if (utcDay === 0 || utcDay === 6) return false;
    return utcHour >= 14 && utcHour < 21;
  }
  
  if (marketType === 'forex') {
    // Forex: Open 24/5 (closed Saturday-Sunday)
    // Actually opens Sunday 5 PM ET (22:00 UTC) to Friday 5 PM ET
    if (utcDay === 6) return false;
    if (utcDay === 0 && utcHour < 22) return false;
    if (utcDay === 5 && utcHour >= 22) return false;
    return true;
  }
  
  return true;
}

// ============= FINNHUB API (PRIMARY) =============
async function fetchFromFinnhub(
  symbol: string, 
  marketType: MarketType, 
  timeframe: string
): Promise<OHLCV[] | null> {
  const apiKey = Deno.env.get('FINNHUB_API_KEY');
  if (!apiKey) {
    console.error('[FINNHUB] API key not configured');
    return null;
  }
  
  const resolution = TIMEFRAME_MAP[timeframe] || '1';
  const now = Math.floor(Date.now() / 1000);
  const from = now - (60 * 60 * 24); // Last 24 hours
  
  let endpoint: string;
  let finnhubSymbol = symbol;
  
  try {
    switch (marketType) {
      case 'crypto':
        // Finnhub crypto uses BINANCE: prefix
        finnhubSymbol = `BINANCE:${symbol.replace('USD', '')}USDT`;
        endpoint = `https://finnhub.io/api/v1/crypto/candle?symbol=${finnhubSymbol}&resolution=${resolution}&from=${from}&to=${now}&token=${apiKey}`;
        break;
      case 'forex':
        // Finnhub forex uses OANDA: prefix
        const fxSymbol = symbol.slice(0, 3) + '_' + symbol.slice(3);
        finnhubSymbol = `OANDA:${fxSymbol}`;
        endpoint = `https://finnhub.io/api/v1/forex/candle?symbol=${finnhubSymbol}&resolution=${resolution}&from=${from}&to=${now}&token=${apiKey}`;
        break;
      case 'stock':
        endpoint = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${now}&token=${apiKey}`;
        break;
    }
    
    console.log(`[FINNHUB] Fetching ${symbol} (${finnhubSymbol}) at ${timeframe}`);
    
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.error(`[FINNHUB] HTTP error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    // Finnhub returns {s: "ok", c: [], o: [], h: [], l: [], v: [], t: []}
    if (data.s !== 'ok' || !data.c || data.c.length === 0) {
      console.error(`[FINNHUB] No data for ${symbol}: ${JSON.stringify(data)}`);
      return null;
    }
    
    const candles: OHLCV[] = [];
    for (let i = 0; i < data.t.length; i++) {
      candles.push({
        time: data.t[i] * 1000,
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v[i] || 0,
      });
    }
    
    console.log(`[FINNHUB] Got ${candles.length} candles for ${symbol}`);
    return candles;
  } catch (error) {
    console.error(`[FINNHUB] Error fetching ${symbol}:`, error);
    return null;
  }
}

// ============= TWELVEDATA API (FAILOVER) =============
async function fetchFromTwelveData(
  symbol: string, 
  marketType: MarketType, 
  timeframe: string
): Promise<OHLCV[] | null> {
  const apiKey = Deno.env.get('TWELVEDATA_API_KEY');
  if (!apiKey) {
    console.error('[TWELVEDATA] API key not configured');
    return null;
  }
  
  // TwelveData interval format
  const intervalMap: Record<string, string> = {
    '1m': '1min',
    '5m': '5min',
    '15m': '15min',
    '1h': '1h',
    '4h': '4h',
    '1d': '1day',
  };
  const interval = intervalMap[timeframe] || '1min';
  
  let twelveSymbol = symbol;
  
  try {
    // TwelveData uses different symbol formats
    if (marketType === 'crypto') {
      // Convert BTCUSD -> BTC/USD
      twelveSymbol = symbol.slice(0, -3) + '/USD';
    } else if (marketType === 'forex') {
      // Convert EURUSD -> EUR/USD
      twelveSymbol = symbol.slice(0, 3) + '/' + symbol.slice(3);
    }
    // Stocks use ticker as-is
    
    const endpoint = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(twelveSymbol)}&interval=${interval}&outputsize=100&apikey=${apiKey}`;
    
    console.log(`[TWELVEDATA] Fetching ${symbol} (${twelveSymbol}) at ${timeframe}`);
    
    const response = await fetch(endpoint);
    if (!response.ok) {
      console.error(`[TWELVEDATA] HTTP error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.status === 'error' || !data.values || data.values.length === 0) {
      console.error(`[TWELVEDATA] No data for ${symbol}: ${JSON.stringify(data)}`);
      return null;
    }
    
    const candles: OHLCV[] = data.values.map((v: any) => ({
      time: new Date(v.datetime).getTime(),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume) || 0,
    })).reverse(); // TwelveData returns newest first
    
    console.log(`[TWELVEDATA] Got ${candles.length} candles for ${symbol}`);
    return candles;
  } catch (error) {
    console.error(`[TWELVEDATA] Error fetching ${symbol}:`, error);
    return null;
  }
}

// ============= UNIFIED DATA FETCH =============
async function fetchPriceData(
  symbol: string, 
  timeframe: string = '1m'
): Promise<{ candles: OHLCV[] | null; source: string; error?: string }> {
  const marketType = getMarketType(symbol);
  const marketOpen = isMarketOpen(marketType);
  
  if (!marketOpen) {
    console.log(`[PRICE_FEED] Market closed for ${symbol} (${marketType})`);
    return { 
      candles: null, 
      source: 'NO_DATA', 
      error: `Market closed for ${marketType}` 
    };
  }
  
  // Try Finnhub first (PRIMARY)
  console.log(`[PRICE_FEED] Trying Finnhub for ${symbol}...`);
  let candles = await fetchFromFinnhub(symbol, marketType, timeframe);
  
  if (candles && candles.length > 0) {
    return { candles, source: 'finnhub' };
  }
  
  // Failover to TwelveData
  console.log(`[PRICE_FEED] Finnhub failed, trying TwelveData for ${symbol}...`);
  candles = await fetchFromTwelveData(symbol, marketType, timeframe);
  
  if (candles && candles.length > 0) {
    return { candles, source: 'twelvedata' };
  }
  
  // NO simulation fallback - return error
  console.error(`[PRICE_FEED] Both providers failed for ${symbol}`);
  return { 
    candles: null, 
    source: 'NO_DATA', 
    error: 'Live feed temporarily unavailable' 
  };
}

// ============= GENERATE TICK FROM CANDLES =============
function generateTickFromCandles(
  symbol: string, 
  candles: OHLCV[], 
  source: string,
  timeframe: string
): PriceTick {
  const marketType = getMarketType(symbol);
  const latestCandle = candles[candles.length - 1];
  const mid = latestCandle.close;
  
  // Apply realistic spread
  const { bid, ask } = applySpread(mid, marketType, symbol);
  
  // Calculate volatility from recent candles
  const recentCandles = candles.slice(-20);
  const returns = recentCandles.slice(1).map((c, i) => 
    Math.abs((c.close - recentCandles[i].close) / recentCandles[i].close)
  );
  const avgVolatility = returns.length > 0 
    ? returns.reduce((a, b) => a + b, 0) / returns.length * 100 
    : 0.5;
  
  // Determine regime
  const sma5 = recentCandles.slice(-5).reduce((a, c) => a + c.close, 0) / 5;
  const sma20 = recentCandles.reduce((a, c) => a + c.close, 0) / recentCandles.length;
  let regime = 'range';
  if (sma5 > sma20 * 1.002) regime = 'trend';
  else if (sma5 < sma20 * 0.998) regime = 'trend';
  if (avgVolatility > 1.5) regime = 'high_vol';
  if (avgVolatility < 0.2) regime = 'low_vol';
  
  return {
    symbol,
    bid,
    ask,
    mid,
    volatility: Math.min(10, Math.max(0.1, avgVolatility)),
    regime,
    timestamp: new Date().toISOString(),
    timeframe,
    source,
    marketOpen: isMarketOpen(marketType),
  };
}

// ============= MAIN HANDLER =============
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body for symbols and timeframe
    let requestedSymbols: string[] = [];
    let timeframe = '1m';
    
    try {
      const body = await req.json();
      requestedSymbols = body.symbols || [];
      timeframe = body.timeframe || '1m';
    } catch {
      // No body or invalid JSON - use defaults
    }

    // Get active symbols from database if not specified
    if (requestedSymbols.length === 0) {
      const { data: dbSymbols } = await supabase
        .from('symbols')
        .select('symbol')
        .eq('is_active', true);
      
      requestedSymbols = dbSymbols?.map(s => s.symbol) || [...CRYPTO_PAIRS, ...FOREX_PAIRS.slice(0, 3)];
    }
    
    console.log(`[PRICE_FEED] Fetching ${requestedSymbols.length} symbols at ${timeframe}`);
    
    const ticks: Record<string, PriceTick> = {};
    const errors: Record<string, string> = {};
    const ticksToInsert: any[] = [];
    let hasAnyData = false;

    // Fetch each symbol (could be parallelized, but respecting rate limits)
    for (const symbol of requestedSymbols) {
      const { candles, source, error } = await fetchPriceData(symbol, timeframe);
      
      if (candles && candles.length > 0) {
        const tick = generateTickFromCandles(symbol, candles, source, timeframe);
        ticks[symbol] = tick;
        ticksToInsert.push({
          symbol: tick.symbol,
          bid: tick.bid,
          ask: tick.ask,
          mid: tick.mid,
          volatility: tick.volatility,
          regime: tick.regime,
          timestamp: tick.timestamp,
          timeframe: tick.timeframe,
        });
        hasAnyData = true;
      } else {
        errors[symbol] = error || 'No data available';
      }
    }

    // Insert into price_history (non-blocking)
    if (ticksToInsert.length > 0) {
      supabase
        .from('price_history')
        .insert(ticksToInsert)
        .then(({ error }) => {
          if (error) console.error('[PRICE_FEED] Error inserting price history:', error);
        });
    }

    // If no data at all, return error status
    if (!hasAnyData) {
      return new Response(JSON.stringify({ 
        ticks: {}, 
        timestamp: new Date().toISOString(),
        source: 'NO_DATA',
        error: 'Live feed temporarily unavailable',
        errors,
        shouldPauseTrading: true,
      }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ 
      ticks, 
      timestamp: new Date().toISOString(),
      source: Object.values(ticks)[0]?.source || 'mixed',
      errors: Object.keys(errors).length > 0 ? errors : undefined,
      shouldPauseTrading: false,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[PRICE_FEED] Critical error:', error);
    
    // NO fallback to simulation - return error
    return new Response(JSON.stringify({ 
      ticks: {}, 
      timestamp: new Date().toISOString(),
      source: 'NO_DATA',
      error: error instanceof Error ? error.message : 'Live feed temporarily unavailable',
      shouldPauseTrading: true,
    }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
