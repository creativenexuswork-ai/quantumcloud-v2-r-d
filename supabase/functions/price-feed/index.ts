import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simulated price data for paper trading (replace with real API later)
const BASE_PRICES: Record<string, number> = {
  BTCUSDT: 97500,
  ETHUSDT: 3650,
  EURUSD: 1.0550,
  GBPUSD: 1.2680,
  NAS100: 21200,
  SPX500: 6050,
  XAUUSD: 2650,
};

function generateTick(symbol: string, basePrice: number) {
  // Add realistic random movement
  const volatility = symbol.includes('BTC') || symbol.includes('ETH') ? 0.002 : 0.0005;
  const change = (Math.random() - 0.5) * 2 * volatility * basePrice;
  const mid = basePrice + change;
  
  // Calculate spread based on asset type
  const spreadPercent = symbol.includes('USD') && !symbol.includes('USDT') ? 0.0001 : 0.0002;
  const spread = mid * spreadPercent;
  
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
    bid: mid - spread / 2,
    ask: mid + spread / 2,
    mid,
    volatility: Math.random() * 0.3 + 0.3,
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

    // Get active symbols
    const { data: symbols, error: symbolsError } = await supabase
      .from('symbols')
      .select('symbol')
      .eq('is_active', true);

    if (symbolsError) throw symbolsError;

    const ticks: Record<string, any> = {};
    const ticksToInsert: any[] = [];

    for (const { symbol } of symbols || []) {
      const basePrice = BASE_PRICES[symbol] || 100;
      const tick = generateTick(symbol, basePrice);
      ticks[symbol] = tick;
      ticksToInsert.push(tick);
    }

    // Insert into price_history
    if (ticksToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('price_history')
        .insert(ticksToInsert);

      if (insertError) {
        console.error('Error inserting price history:', insertError);
      }
    }

    return new Response(JSON.stringify({ ticks, timestamp: new Date().toISOString() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Price feed error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
