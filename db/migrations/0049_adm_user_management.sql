-- =============================================================================
-- 0049 — ADM-04 admin user management: profiles.banned + immutability guard.
--
-- The admin console (ADM-04) needs to suspend accounts. We add a `banned` flag
-- to public.profiles for listing/filtering, and the ban is *enforced* at the
-- auth layer (the backend also sets a Supabase auth ban_duration, which revokes
-- sessions — see backend/app/routers/admin/users.py).
--
-- Like role/verification_status, `banned` must be admin-controlled: a normal
-- user must not be able to self-unban through the owner-update RLS policy
-- (profiles_update_own, migration 0005). We extend the existing
-- enforce_profile_immutability() BEFORE-UPDATE trigger to also lock `banned`
-- for non-service callers. The backend writes it via the service_role JWT,
-- which the trigger admits.
--
-- Append-only: 0005 is left untouched; this file is the last word on the
-- enforce_profile_immutability() definition. Idempotent — safe to replay.
-- =============================================================================

alter table public.profiles
    add column if not exists banned boolean not null default false;

create index if not exists profiles_banned_idx on public.profiles (banned);

-- Re-define the immutability guard: copy of migration 0005 + a `banned` guard.
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
    -- backend (FastAPI admin endpoints) uses the service key it can change
    -- role / verification_status / banned. For every other caller, those
    -- columns are immutable.
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
        if new.banned is distinct from old.banned then
            raise exception 'banned is admin-controlled (was %, attempted %)',
                old.banned, new.banned
                using errcode = '42501';
        end if;
    end if;

    return new;
end;
$$;

-- Trigger already exists from 0005 (trg_profiles_immutable_fields) and binds to
-- the function by name, so the re-defined body takes effect immediately. The
-- create-or-replace above is sufficient; no trigger re-creation needed.
