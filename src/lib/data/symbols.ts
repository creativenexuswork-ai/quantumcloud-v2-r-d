// ============= TOP 10 CRYPTO MAJORS (FINNHUB SUPPORTED) =============
// This is the ONLY source of truth for tradeable symbols.
// DO NOT read from Supabase. DO NOT add forex/stocks.

export const TOP10_CRYPTO_FINNHUB = [
  "BINANCE:BTCUSDT",
  "BINANCE:ETHUSDT",
  "BINANCE:BNBUSDT",
  "BINANCE:SOLUSDT",
  "BINANCE:XRPUSDT",
  "BINANCE:ADAUSDT",
  "BINANCE:DOGEUSDT",
  "BINANCE:AVAXUSDT",
  "BINANCE:DOTUSDT",
  "BINANCE:MATICUSDT"
] as const;

// Display format for UI (matches what bot expects)
export const TOP10_CRYPTO_DISPLAY = [
  "BTC/USD",
  "ETH/USD",
  "BNB/USD",
  "SOL/USD",
  "XRP/USD",
  "ADA/USD",
  "DOGE/USD",
  "AVAX/USD",
  "DOT/USD",
  "MATIC/USD"
] as const;

// Symbol metadata for the trading engine
export interface CryptoSymbol {
  symbol: string;
  finnhubSymbol: string;
  type: 'crypto';
  is_active: true;
}

// Get all active symbols - HARDCODED, never reads from DB
export function getActiveSymbols(): CryptoSymbol[] {
  return TOP10_CRYPTO_DISPLAY.map((symbol, i) => ({
    symbol,
    finnhubSymbol: TOP10_CRYPTO_FINNHUB[i],
    type: 'crypto' as const,
    is_active: true as const,
  }));
}

// Validate a symbol is in our allowed list
export function isValidSymbol(symbol: string): boolean {
  const normalized = symbol.replace('/', '').toUpperCase();
  return TOP10_CRYPTO_DISPLAY.some(s => 
    s.replace('/', '').toUpperCase() === normalized
  );
}

// Convert display symbol to Finnhub format
export function toFinnhubSymbol(displaySymbol: string): string | null {
  const index = TOP10_CRYPTO_DISPLAY.findIndex(s => s === displaySymbol);
  return index >= 0 ? TOP10_CRYPTO_FINNHUB[index] : null;
}

// Convert Finnhub symbol to display format
export function toDisplaySymbol(finnhubSymbol: string): string | null {
  const index = TOP10_CRYPTO_FINNHUB.findIndex(s => s === finnhubSymbol);
  return index >= 0 ? TOP10_CRYPTO_DISPLAY[index] : null;
}
