-- =============================================================================
-- 0054 — Extend custom_access_token_hook with a locale claim.
-- Story:  i18n frontend rollout (next-intl / [locale] routing).
--
-- The middleware needs the account's language preference (profiles.locale,
-- chosen at signup — see db/migrations/0003_profile_on_signup.sql) to
-- redirect a freshly-authenticated user to their own /fr, /en or /ar segment,
-- without an extra DB round trip on every request. Same pattern as AUTH-06
-- (migration 0014): one SELECT, one more claim.
--
-- CREATE OR REPLACE — same function name, same Dashboard binding URI, no
-- operator action required.
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
    v_locale  public.locale_code;
    v_claims  jsonb := coalesce(event->'claims', '{}'::jsonb);
begin
    -- Single SELECT for all three claims. Indexed by primary key on profiles.id.
    select role, verification_status, locale
      into v_role, v_status, v_locale
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
    if v_locale is not null then
        v_claims := v_claims || jsonb_build_object('locale', v_locale::text);
    end if;

    return jsonb_set(event, '{claims}', v_claims, true);
end;
$$;

-- GRANT is idempotent; re-stating it makes this migration self-contained.
grant execute on function public.custom_access_token_hook(jsonb)
    to supabase_auth_admin;

-- Belt and braces — revoke from every other role (mirrors 0014).
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
