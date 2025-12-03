-- Add is_running field to paper_config for session state tracking
ALTER TABLE public.paper_config 
ADD COLUMN IF NOT EXISTS is_running boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS session_started_at timestamp with time zone;

-- Add unique constraint for paper_stats_daily if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'paper_stats_daily_user_date_unique'
  ) THEN
    ALTER TABLE public.paper_stats_daily 
    ADD CONSTRAINT paper_stats_daily_user_date_unique UNIQUE (user_id, trade_date);
  END IF;
END $$;

-- Seed default symbols if empty
INSERT INTO public.symbols (symbol, name, type, spread_estimate, is_active)
VALUES 
  ('BTCUSDT', 'Bitcoin', 'crypto', 0.0002, true),
  ('ETHUSDT', 'Ethereum', 'crypto', 0.0002, true),
  ('EURUSD', 'Euro/USD', 'forex', 0.0001, true),
  ('GBPUSD', 'Pound/USD', 'forex', 0.0001, true),
  ('NAS100', 'Nasdaq 100', 'index', 0.0003, true),
  ('SPX500', 'S&P 500', 'index', 0.0002, true),
  ('XAUUSD', 'Gold', 'metal', 0.0002, true),
  ('XAGUSD', 'Silver', 'metal', 0.0003, true)
ON CONFLICT (symbol) DO NOTHING;

-- Update handle_new_user function to create paper_config
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);
  
  -- Create default paper account
  INSERT INTO public.accounts (user_id, type, name, broker_name, base_currency, equity)
  VALUES (NEW.id, 'paper', 'Paper Account', 'paper', 'USDT', 10000);
  
  -- Create default mode configs
  INSERT INTO public.mode_configs (user_id, mode_key, risk_per_trade_pct, max_daily_loss_pct, max_daily_profit_pct, extra_config)
  VALUES 
    (NEW.id, 'sniper', 0.5, 3, 8, '{"timeframes": ["15m", "1h"], "min_confidence": 0.8}'),
    (NEW.id, 'quantum', 1.0, 5, 10, '{"adaptive": true}'),
    (NEW.id, 'burst', 0.1, 2, 8, '{"burst_size": 20, "intensity": "high"}'),
    (NEW.id, 'trend', 1.0, 5, 10, '{"ema_periods": [20, 50]}'),
    (NEW.id, 'swing', 2.0, 5, 15, '{"timeframes": ["4h", "1d"]}'),
    (NEW.id, 'news', 0.5, 3, 8, '{"filter_high_impact": true}'),
    (NEW.id, 'stealth', 0.5, 3, 6, '{"randomize_timing": true}'),
    (NEW.id, 'memory', 1.0, 5, 10, '{"lookback_trades": 100}');
  
  -- Create default user settings
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  -- Create default paper config
  INSERT INTO public.paper_config (user_id, is_running)
  VALUES (NEW.id, false);
  
  RETURN NEW;
END;
$function$;