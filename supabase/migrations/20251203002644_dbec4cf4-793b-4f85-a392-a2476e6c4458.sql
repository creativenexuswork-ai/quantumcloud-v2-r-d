-- Create symbols table for watchlist
CREATE TABLE public.symbols (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('crypto', 'forex', 'index', 'metal')),
  is_active boolean DEFAULT true,
  spread_estimate numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.symbols ENABLE ROW LEVEL SECURITY;

-- Everyone can read symbols
CREATE POLICY "Symbols are readable by all authenticated users"
ON public.symbols FOR SELECT TO authenticated
USING (true);

-- Seed default symbols
INSERT INTO public.symbols (symbol, name, type, spread_estimate) VALUES
  ('BTCUSDT', 'Bitcoin', 'crypto', 0.01),
  ('ETHUSDT', 'Ethereum', 'crypto', 0.01),
  ('EURUSD', 'EUR/USD', 'forex', 0.0001),
  ('GBPUSD', 'GBP/USD', 'forex', 0.0001),
  ('NAS100', 'Nasdaq 100', 'index', 0.5),
  ('SPX500', 'S&P 500', 'index', 0.5),
  ('XAUUSD', 'Gold', 'metal', 0.3);

-- Create price_history table
CREATE TABLE public.price_history (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  timestamp timestamp with time zone NOT NULL DEFAULT now(),
  bid numeric NOT NULL,
  ask numeric NOT NULL,
  mid numeric NOT NULL,
  timeframe text DEFAULT '1m',
  volatility numeric,
  regime text CHECK (regime IN ('trend', 'range', 'high_vol', 'low_vol'))
);

-- Indexes for price_history
CREATE INDEX idx_price_history_symbol ON public.price_history(symbol);
CREATE INDEX idx_price_history_timestamp ON public.price_history(timestamp DESC);
CREATE INDEX idx_price_history_symbol_ts ON public.price_history(symbol, timestamp DESC);

-- Enable RLS
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Price history readable by authenticated"
ON public.price_history FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Price history insertable by service role"
ON public.price_history FOR INSERT
WITH CHECK (true);

-- Create paper_positions table
CREATE TABLE public.paper_positions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  mode text NOT NULL,
  side text NOT NULL CHECK (side IN ('long', 'short')),
  size numeric NOT NULL,
  entry_price numeric NOT NULL,
  sl numeric,
  tp numeric,
  opened_at timestamp with time zone DEFAULT now(),
  unrealized_pnl numeric DEFAULT 0,
  closed boolean DEFAULT false,
  batch_id uuid
);

ALTER TABLE public.paper_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own paper positions"
ON public.paper_positions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own paper positions"
ON public.paper_positions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own paper positions"
ON public.paper_positions FOR UPDATE
USING (auth.uid() = user_id);

-- Create paper_trades table (closed trades)
CREATE TABLE public.paper_trades (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  mode text NOT NULL,
  side text NOT NULL CHECK (side IN ('long', 'short')),
  size numeric NOT NULL,
  entry_price numeric NOT NULL,
  exit_price numeric NOT NULL,
  sl numeric,
  tp numeric,
  opened_at timestamp with time zone NOT NULL,
  closed_at timestamp with time zone DEFAULT now(),
  realized_pnl numeric NOT NULL,
  reason text,
  session_date date DEFAULT CURRENT_DATE,
  batch_id uuid
);

ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own paper trades"
ON public.paper_trades FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own paper trades"
ON public.paper_trades FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Create paper_config table
CREATE TABLE public.paper_config (
  user_id uuid PRIMARY KEY,
  risk_config jsonb DEFAULT '{"maxDailyLossPercent": 5, "maxConcurrentRiskPercent": 10}'::jsonb,
  burst_config jsonb DEFAULT '{"size": 20, "dailyProfitTargetPercent": 8}'::jsonb,
  mode_config jsonb DEFAULT '{"enabledModes": ["sniper", "trend"], "modeSettings": {}}'::jsonb,
  market_config jsonb DEFAULT '{"selectedSymbols": ["BTCUSDT", "ETHUSDT"], "typeFilters": {"crypto": true, "forex": true, "index": true, "metal": true}}'::jsonb,
  trading_halted_for_day boolean DEFAULT false,
  burst_requested boolean DEFAULT false,
  use_ai_reasoning boolean DEFAULT true,
  show_advanced_explanations boolean DEFAULT false,
  broker_api_url text,
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.paper_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own paper config"
ON public.paper_config FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own paper config"
ON public.paper_config FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own paper config"
ON public.paper_config FOR UPDATE
USING (auth.uid() = user_id);

-- Create paper_stats_daily table
CREATE TABLE public.paper_stats_daily (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  trade_date date NOT NULL,
  equity_start numeric NOT NULL DEFAULT 10000,
  equity_end numeric NOT NULL DEFAULT 10000,
  pnl numeric DEFAULT 0,
  win_rate numeric DEFAULT 0,
  trades_count integer DEFAULT 0,
  max_drawdown numeric DEFAULT 0,
  UNIQUE (user_id, trade_date)
);

CREATE INDEX idx_paper_stats_user_date ON public.paper_stats_daily(user_id, trade_date DESC);

ALTER TABLE public.paper_stats_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own paper stats"
ON public.paper_stats_daily FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own paper stats"
ON public.paper_stats_daily FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own paper stats"
ON public.paper_stats_daily FOR UPDATE
USING (auth.uid() = user_id);