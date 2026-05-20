-- =============================================================================
-- 0006 — AUTH-02 — Custom access-token hook: lifts profiles.role into the JWT.
-- Story:  AUTH-02 (docs/stories/AUTH-02-role-assignment-registration.md)
-- Why:    every downstream RLS policy needs a fast, recursion-free way to
--         read the caller's role. A SQL helper (is_admin() — migration 0005)
--         costs one indexed SELECT per evaluation; a JWT claim costs zero.
-- =============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
    uid           uuid;
    resolved_role text;
    new_claims    jsonb;
begin
    uid := (event->>'user_id')::uuid;

    -- Defensive: a hook fired for a user_id with no profile (shouldn't happen
    -- given migration 0003's trigger, but defence in depth) returns the event
    -- unchanged so the Auth service doesn't 500. A missing claim is a softer
    -- failure than a refused token.
    select role::text into resolved_role
      from public.profiles
     where id = uid;

    if resolved_role is null then
        return event;
    end if;

    new_claims := coalesce(event->'claims', '{}'::jsonb)
                  || jsonb_build_object('user_role', resolved_role);

    return jsonb_set(event, '{claims}', new_claims);
end;
$$;

-- Supabase Auth runs hooks under the supabase_auth_admin role.
-- The role exists on hosted Supabase projects; on a vanilla Postgres (CI)
-- it may not — create it idempotently so the migration replays on both.
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
        create role supabase_auth_admin nologin;
    end if;
end$$;

grant execute on function public.custom_access_token_hook(jsonb)
    to supabase_auth_admin;

-- Belt and braces — revoke from every other role.
revoke execute on function public.custom_access_token_hook(jsonb)
    from public;

do $$
begin
    if exists (select 1 from pg_roles where rolname = 'anon') then
        revoke execute on function public.custom_access_token_hook(jsonb) from anon;
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
        revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;
    end if;
end$$;
