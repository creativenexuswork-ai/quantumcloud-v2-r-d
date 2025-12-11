-- R&D / PAPER ENVIRONMENT ONLY
-- Fix price_history INSERT policy to actually restrict to service_role

DROP POLICY IF EXISTS "Price history insertable by service role" ON public.price_history;

CREATE POLICY "Price history insertable by service role"
ON public.price_history
AS RESTRICTIVE
FOR INSERT
TO service_role
WITH CHECK (true);