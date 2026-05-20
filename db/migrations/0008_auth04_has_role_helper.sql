-- =============================================================================
-- 0008 — public.has_role(check_role) — canonical RLS-side role check.
-- Story:  AUTH-04 (docs/stories/AUTH-04-enable-rls-on-sensitive-tables.md)
--
-- Generalizes public.is_admin() (migration 0005) into a reusable helper so
-- every future module migration (KAT-01 parcels, FAR-01 ads, SEC-01 meals,
-- BOT-03 leads, ADM-*) can express "the caller is currently <ROLE>" in an
-- RLS policy without re-implementing the same SECURITY DEFINER scaffolding.
--
-- Use this helper instead of embedding `(auth.jwt()->>'user_role') = 'FARMER'`
-- directly when:
--   * The staleness window of the JWT (≤ 1 h, AUTH-03 jwt_expiry) is unacceptable
--     for the gated action — i.e. a role downgrade must take effect immediately.
--   * The policy needs to be robust against a missing user_role claim (older
--     tokens issued before AUTH-02's hook activation).
--
-- For high-frequency reads where 1-h staleness is acceptable (catalogs,
-- listings), prefer the JWT-claim variant — it skips the DB round trip.
-- See docs/runbook.md §AUTH-04 RLS contract for the pattern catalog.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace function public.has_role(check_role public.user_role)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
    select coalesce(
        (select role = check_role
           from public.profiles
          where id = auth.uid()),
        false
    );
$$;

grant execute on function public.has_role(public.user_role)
    to anon, authenticated, service_role;

-- Re-base public.is_admin() onto has_role() for a single source of truth.
-- If the role lookup ever changes (cached in a materialized view, joined to
-- a separate role_assignments table, etc.) only has_role() needs editing.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
    select public.has_role('ADMIN'::public.user_role);
$$;

grant execute on function public.is_admin() to anon, authenticated, service_role;
