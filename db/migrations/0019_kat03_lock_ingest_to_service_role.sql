-- =============================================================================
-- 0019 — KAT-03 follow-up: lock m1_katara_ingest() to service_role only.
--
-- Supabase grants EXECUTE on every new public.* function to the default
-- roles (anon, authenticated, public, postgres). Migration 0018 already
-- `revoke all … from public` but anon and authenticated were not explicit
-- targets, so they retained EXECUTE on the SECURITY DEFINER wrapper. With
-- the postgres role having BYPASSRLS in Supabase, an authenticated caller
-- could in principle invoke the RPC and trip the bcrypt-verify timing
-- oracle on every paired device_id.
--
-- This migration narrows the grant: only service_role keeps EXECUTE. The
-- FastAPI ingest endpoint (backend/app/modules/katara/ingest.py) is the
-- single caller and uses the service-role client per AUTH-05.
-- =============================================================================

revoke execute on function public.m1_katara_ingest(
    text, text, real, real, real, real, smallint, timestamptz
) from public, anon, authenticated;

grant execute on function public.m1_katara_ingest(
    text, text, real, real, real, real, smallint, timestamptz
) to service_role;
