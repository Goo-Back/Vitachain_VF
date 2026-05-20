-- =============================================================================
-- 0014 — Extend custom_access_token_hook with verification_status claim.
-- Story:  AUTH-06
-- The hook from migration 0006 (AUTH-02) lifted profiles.role into
-- claims.user_role. AUTH-06 lifts a SECOND claim, claims.verification_status,
-- from the SAME profiles row in the SAME SELECT. One round trip, two claims.
--
-- CREATE OR REPLACE — same function name, same Dashboard binding URI
-- (pg-functions://postgres/public/custom_access_token_hook), no operator
-- action required on the Supabase Dashboard.
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_user_id uuid := (event->>'user_id')::uuid;
    v_role    public.user_role;
    v_status  public.verification_status;
    v_claims  jsonb := coalesce(event->'claims', '{}'::jsonb);
begin
    -- Single SELECT for both claims. Indexed by primary key on profiles.id.
    select role, verification_status
      into v_role, v_status
      from public.profiles
     where id = v_user_id;

    -- Defensive: a brand-new auth.users row may not yet have a profile
    -- (the handle_new_user trigger runs in the same transaction, but a
    -- pathological order would surface this). Skip-on-null per claim — do
    -- not return an event that pollutes claims with the literal "null".
    if v_role is not null then
        v_claims := v_claims || jsonb_build_object('user_role', v_role::text);
    end if;
    if v_status is not null then
        v_claims := v_claims || jsonb_build_object('verification_status', v_status::text);
    end if;

    return jsonb_set(event, '{claims}', v_claims, true);
end;
$$;

-- GRANT is idempotent; re-stating it makes this migration self-contained.
grant execute on function public.custom_access_token_hook(jsonb)
    to supabase_auth_admin;

-- Belt and braces — revoke from every other role (mirrors 0006).
revoke execute on function public.custom_access_token_hook(jsonb) from public;
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke execute on function public.custom_access_token_hook(jsonb) from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;
    end if;
end$$;

-- Regression-spotter view. A Supabase Studio query can sanity-check that
-- the (role, verification_status) cross-product on profiles is what AUTH-06
-- expects — e.g. no CITIZEN profiles should ever be 'VERIFIED' (citizens
-- have no KYC obligation). Surface anomalies for ADM-02 follow-up.
create or replace view public.v_auth06_status_distribution as
    select role,
           verification_status,
           count(*) as n
      from public.profiles
     group by role, verification_status
     order by role, verification_status;
