-- =============================================================================
-- 0045 — M2 FarMarket: farmer public profile (discovery-side identity).
-- Story:  FAR-11 (restaurant sees the producer behind an offer)
--
-- The logistics-intermediary pivot (0040) anonymises the producer on the
-- ORDER side via v_farmer_incoming_items (BR-F5). This migration intentionally
-- reveals the producer on the DISCOVERY side: a restaurant browsing offers can
-- now see who is selling, their region, and (0046) their rating.
--
-- BR-F5 is therefore scoped to the order pipeline only. The producer still
-- never learns the buyer's identity — that path is untouched.
--
-- Why a view, not a profiles RLS widening:
--   profiles RLS is owner/admin only and farmarket/ is NOT in the AUTH-05
--   service-client allow-list. RLS cannot restrict columns, so a broad SELECT
--   policy on profiles would leak email/phone. Instead we expose ONLY safe
--   columns through a SECURITY DEFINER view (default view semantics — runs with
--   the view owner's privileges, NOT security_invoker), mirroring the
--   v_farmer_incoming_items boundary pattern from 0040.
-- =============================================================================

-- ── Profile columns (additive) ────────────────────────────────────────────────
-- full_name is kept (used across the app); these are new, nullable fields.
-- farmer_region reuses the m2_farmarket_region enum (single source of truth).

alter table public.profiles
    add column if not exists first_name    text,
    add column if not exists last_name     text,
    add column if not exists farmer_region public.m2_farmarket_region;

-- ── Public farmer profile view ────────────────────────────────────────────────
-- Whitelisted columns only. Filtered to VERIFIED FARMER rows so a restaurant
-- cannot enumerate citizens/admins or unverified accounts. Default (non
-- security_invoker) view → bypasses profiles RLS for these columns only.

drop view if exists public.v_farmarket_farmer_public;
create view public.v_farmarket_farmer_public as
select
    p.id,
    p.first_name,
    p.last_name,
    p.full_name,
    p.farmer_region,
    p.created_at as member_since
from public.profiles p
where p.role = 'FARMER'::public.user_role
  and p.verification_status = 'VERIFIED'::public.verification_status;

grant select on public.v_farmarket_farmer_public to authenticated;
