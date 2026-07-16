-- ============================================================================
-- Security Fixes: Function search_path, RLS policies, and explicit denies
-- ============================================================================

-- 1. Fix mutable search_path in increment_rate_limit function
CREATE OR REPLACE FUNCTION public.increment_rate_limit(p_source text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- Immutable search_path prevents search_path attacks
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.api_rate_limits
  SET
    request_count = CASE WHEN now() - window_start > interval '1 second' THEN 1 ELSE request_count + 1 END,
    window_start  = CASE WHEN now() - window_start > interval '1 second' THEN now() ELSE window_start END
  WHERE source = p_source
  RETURNING request_count INTO v_count;

  IF v_count IS NULL THEN
    INSERT INTO public.api_rate_limits (source, window_start, request_count)
    VALUES (p_source, now(), 1)
    ON CONFLICT (source) DO UPDATE SET request_count = 1, window_start = now()
    RETURNING request_count INTO v_count;
  END IF;

  RETURN v_count;
END;
$function$;

-- 2. Fix system_config RLS policies
-- Drop existing overly-permissive policies
DROP POLICY IF EXISTS sc_select ON public.system_config;
DROP POLICY IF EXISTS sc_insert ON public.system_config;
DROP POLICY IF EXISTS sc_update ON public.system_config;
DROP POLICY IF EXISTS sc_delete ON public.system_config;

-- Create proper policies
-- Frontend can read config (read-only for no-auth app)
CREATE POLICY "sc_select" ON public.system_config
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE from anon/authenticated - only service_role can modify
-- Explicitly deny by not creating policies for INSERT/UPDATE/DELETE

-- 3. Create explicit deny policies for sensitive tables
-- These tables should ONLY be accessible via service_role (Edge Functions)
-- Having explicit policies makes the security model clear

-- oauth_credentials: stores Client ID/Secret - NEVER accessible from frontend
CREATE POLICY "oc_no_access" ON public.oauth_credentials
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- oauth_tokens: stores access/refresh tokens - NEVER accessible from frontend
CREATE POLICY "ot_no_access" ON public.oauth_tokens
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- api_rate_limits: internal rate limiting - NEVER accessible from frontend
CREATE POLICY "arl_no_access" ON public.api_rate_limits
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- retry_queue: internal retry mechanism - NEVER accessible from frontend  
CREATE POLICY "rq_no_access" ON public.retry_queue
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
