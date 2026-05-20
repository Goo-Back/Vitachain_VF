-- =============================================================================
-- 0005 — Fix infinite-recursion in profiles RLS (PG error 42P17).
-- Story:  INF-03 (discovered while smoking the auth journey)
-- Origin: INF-02 / migration 0002.
--
-- 0002 declared two policies that re-query public.profiles inside their own
-- expressions, which retriggers RLS on the same table and recurses:
--   1. profiles_update_own  WITH CHECK   — subqueries select role / verification_status
--   2. profiles_select_admin  USING      — exists(select 1 from profiles ...)
--
-- The bug wasn't caught by INF-02 §5.12 smoke because that test signed up
-- via the admin/service-role REST path, which bypasses RLS. INF-03 reads
-- public.profiles from the dashboard with the user's anon-tier JWT, which
-- evaluates the policies and triggers 42P17.
--
-- Fix:
--   • Replace the subquery-based WITH CHECK with a BEFORE UPDATE trigger that
--     compares OLD vs NEW directly. The trigger runs outside RLS, so no recursion.
--   • Replace the admin-read policy with a SECURITY DEFINER helper.
--
-- Both are idempotent — replays cleanly on already-fixed databases.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper — is the JWT's caller an ADMIN?
-- SECURITY DEFINER bypasses RLS for the inner SELECT, so calling this from
-- inside a policy on public.profiles does NOT recurse.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
    select coalesce(
        (select role = 'ADMIN'::public.user_role
           from public.profiles
          where id = auth.uid()),
        false
    );
$$;

-- Grant execute to the authenticated and anon roles so policies that reference
-- the function can resolve it. SECURITY DEFINER caps actual privileges.
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE guard — owner cannot self-promote role or verification_status.
-- Service role (FastAPI / admin actions) bypasses RLS so this trigger lets it
-- through; the check below detects the JWT role and short-circuits accordingly.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_profile_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    jwt_role text;
begin
    -- 'service_role' is the JWT role set by the Supabase service key. When the
    -- backend (INF-04 FastAPI) uses the service key, it can change role and
    -- verification_status (e.g. ADM-02 approve flow). For every other caller,
    -- those columns are immutable.
    begin
        jwt_role := current_setting('request.jwt.claims', true)::json->>'role';
    exception when others then
        jwt_role := null;
    end;

    if jwt_role is distinct from 'service_role' then
        if new.role is distinct from old.role then
            raise exception 'role is immutable for non-service callers (was %, attempted %)',
                old.role, new.role
                using errcode = '42501';
        end if;
        if new.verification_status is distinct from old.verification_status then
            raise exception 'verification_status is immutable for non-service callers (was %, attempted %)',
                old.verification_status, new.verification_status
                using errcode = '42501';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_profiles_immutable_fields on public.profiles;
create trigger trg_profiles_immutable_fields
    before update on public.profiles
    for each row execute function public.enforce_profile_immutability();

-- ---------------------------------------------------------------------------
-- Replace the two recursive policies with non-recursive equivalents.
-- ---------------------------------------------------------------------------

-- 1. update_own: drop the recursive WITH CHECK subqueries; the BEFORE UPDATE
--    trigger above now enforces role + verification_status immutability.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles for update
    using       (auth.uid() = id)
    with check  (auth.uid() = id);

-- 2. select_admin: rewrite using the SECURITY DEFINER helper.
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
    on public.profiles for select
    using (public.is_admin());

-- update_admin — admins also need to flip verification_status in ADM-02.
-- Service-role already bypasses RLS, so this is only useful when an admin USER
-- is logged in with a normal session (rare in MVD; future-proofing).
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
    on public.profiles for update
    using       (public.is_admin())
    with check  (public.is_admin());
