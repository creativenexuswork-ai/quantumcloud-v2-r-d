-- Phase A: Add daily_loss_limit_pct column to paper_config
-- This will be the ONLY source of truth for daily loss alert value
-- The trading_halted_for_day column is left unchanged but will be unused

ALTER TABLE public.paper_config 
ADD COLUMN IF NOT EXISTS daily_loss_limit_pct numeric DEFAULT 5;