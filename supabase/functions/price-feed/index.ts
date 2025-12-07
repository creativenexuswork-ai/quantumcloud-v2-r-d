import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Fallback prices if API fails
const FALLBACK_PRICES: Record<string, number> = {
  BTCUSDT: 97500,
  ETHUSDT: 3650,
  BNBUSDT: 640,
  SOLUSDT: 200,
  XRPUSDT: 2.20,
  DOGEUSDT: 0.40,
  ADAUSDT: 1.05,
  DOTUSDT: 7.50,
  AVAXUSDT: 50,
  MATICUSDT: 0.55,
  // Forex fallbacks (simulated)
  EURUSD: 1.0550,
  GBPUSD: 1.2680,
  USDJPY: 150.50,
  // Indices fallbacks (simulated)
  NAS100: 21200,
  SPX500: 6050,
  // Metals fallbacks (simulated)
  XAUUSD: 2650,
  XAGUSD: 31.50,
};

// Symbols that can be fetched from Binance
const BINANCE_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'DOTUSDT', 'AVAXUSDT', 'MATICUSDT'
];

interface BinanceTickerResponse {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
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
}

// Fetch real prices from Binance public API
async function fetchBinancePrices(): Promise<Record<string, { bid: number; ask: number }>> {
  const prices: Record<string, { bid: number; ask: number }> = {};
  
  try {
    // Fetch all tickers in one request
    const response = await fetch('https://api.binance.com/api/v3/ticker/bookTicker', {
      headers: { 'Accept': 'application/json' },
    });
    
    if (!response.ok) {
      console.error('[PRICE_FEED] Binance API error:', response.status);
      return prices;
    }
    
    const tickers: BinanceTickerResponse[] = await response.json();
    
    for (const ticker of tickers) {
      if (BINANCE_SYMBOLS.includes(ticker.symbol)) {
        prices[ticker.symbol] = {
          bid: parseFloat(ticker.bidPrice),
          ask: parseFloat(ticker.askPrice),
        };
      }
    }
    
    console.log(`[PRICE_FEED] Fetched ${Object.keys(prices).length} prices from Binance`);
  } catch (error) {
    console.error('[PRICE_FEED] Failed to fetch Binance prices:', error);
  }
  
  return prices;
}

// Generate tick with real or fallback data
function generateTick(symbol: string, realPrice?: { bid: number; ask: number }): PriceTick {
  let bid: number;
  let ask: number;
  let mid: number;
  
  if (realPrice && realPrice.bid > 0 && realPrice.ask > 0) {
    // Use real prices from exchange
    bid = realPrice.bid;
    ask = realPrice.ask;
    mid = (bid + ask) / 2;
  } else {
    // Fallback to simulated prices
    const basePrice = FALLBACK_PRICES[symbol] || 100;
    const volatility = symbol.includes('BTC') || symbol.includes('ETH') ? 0.002 : 0.0005;
    const change = (Math.random() - 0.5) * 2 * volatility * basePrice;
    mid = basePrice + change;
    
    const spreadPercent = symbol.includes('USD') && !symbol.includes('USDT') ? 0.0001 : 0.0002;
    const spread = mid * spreadPercent;
    bid = mid - spread / 2;
    ask = mid + spread / 2;
  }
  
  // Calculate volatility estimate from spread
  const spread = ask - bid;
  const volatility = Math.min(1, Math.max(0.1, (spread / mid) * 100));
  
  // Determine regime based on volatility
  const regimes = ['trend', 'range', 'high_vol', 'low_vol'] as const;
  const regimeWeights = [0.4, 0.3, 0.15, 0.15];
  const rand = Math.random();
  let cumWeight = 0;
  let regime = 'range';
  for (let i = 0; i < regimes.length; i++) {
    cumWeight += regimeWeights[i];
    if (rand < cumWeight) {
      regime = regimes[i];
      break;
    }
  }
  
  return {
    symbol,
    bid,
    ask,
    mid,
    volatility,
    regime,
    timestamp: new Date().toISOString(),
    timeframe: '1m',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get active symbols from database
    const { data: dbSymbols, error: symbolsError } = await supabase
      .from('symbols')
      .select('symbol')
      .eq('is_active', true);

    if (symbolsError) {
      console.error('[PRICE_FEED] Error fetching symbols:', symbolsError);
    }

    const symbolList = dbSymbols?.map(s => s.symbol) || Object.keys(FALLBACK_PRICES);
    
    // Fetch real prices from Binance
    const binancePrices = await fetchBinancePrices();
    
    const ticks: Record<string, PriceTick> = {};
    const ticksToInsert: PriceTick[] = [];

    for (const symbol of symbolList) {
      const realPrice = binancePrices[symbol];
      const tick = generateTick(symbol, realPrice);
      ticks[symbol] = tick;
      ticksToInsert.push(tick);
    }

    // Insert into price_history (non-blocking, errors don't fail the request)
    if (ticksToInsert.length > 0) {
      supabase
        .from('price_history')
        .insert(ticksToInsert)
        .then(({ error }) => {
          if (error) console.error('[PRICE_FEED] Error inserting price history:', error);
        });
    }

    return new Response(JSON.stringify({ 
      ticks, 
      timestamp: new Date().toISOString(),
      source: Object.keys(binancePrices).length > 0 ? 'binance' : 'fallback',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('[PRICE_FEED] Error:', error);
    
    // Graceful fallback - return simulated prices
    const fallbackTicks: Record<string, PriceTick> = {};
    for (const [symbol, basePrice] of Object.entries(FALLBACK_PRICES)) {
      fallbackTicks[symbol] = generateTick(symbol);
    }
    
    return new Response(JSON.stringify({ 
      ticks: fallbackTicks, 
      timestamp: new Date().toISOString(),
      source: 'fallback',
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
