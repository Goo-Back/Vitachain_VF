-- =============================================================================
-- AUTH-02 — JWT claim hook coverage.
-- Verifies public.custom_access_token_hook lifts profiles.role into
-- claims.user_role for every member of the user_role enum, and that a hook
-- fired for a user with no profile leaves the event unchanged.
--
-- Service-role psql connection only (direct :5432). Wrapped in a txn that
-- ROLLBACKs so the live project ends in the same state it started.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- The ADMIN branch needs to insert via the trigger with a service-role JWT
-- claim set (migration 0007 hardens handle_new_user against anon ADMIN).
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare
    role_v public.user_role;
    uid    uuid;
    event  jsonb;
    out_   jsonb;
begin
    foreach role_v in array array['FARMER','RESTAURANT','CITIZEN','ADMIN']::public.user_role[] loop
        uid := gen_random_uuid();

        insert into auth.users (
            id,
            instance_id,
            aud,
            role,
            email,
            raw_user_meta_data,
            encrypted_password,
            email_confirmed_at,
            created_at,
            updated_at
        ) values (
            uid,
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            format('auth02-%s@test.local', uid),
            jsonb_build_object('role', role_v::text, 'locale', 'fr', 'full_name', 'AUTH-02 Test'),
            crypt('Abcdefghi1', gen_salt('bf')),
            now(),
            now(),
            now()
        );

        event := jsonb_build_object(
            'user_id', uid::text,
            'claims',  jsonb_build_object('sub', uid::text)
        );
        out_ := public.custom_access_token_hook(event);

        if out_->'claims'->>'user_role' is distinct from role_v::text then
            raise exception 'claim mismatch for role=%: got %', role_v,
                out_->'claims'->>'user_role';
        end if;

        raise notice 'OK hook claim for %', role_v;
    end loop;
end$$;

-- Missing-profile path returns the event unchanged.
do $$
declare
    event jsonb := jsonb_build_object(
        'user_id', gen_random_uuid()::text,
        'claims',  jsonb_build_object('sub', 'dummy')
    );
    out_  jsonb;
begin
    out_ := public.custom_access_token_hook(event);
    if out_->'claims' ? 'user_role' then
        raise exception 'expected no user_role claim for missing profile, got %',
            out_->'claims'->>'user_role';
    end if;
    raise notice 'OK missing-profile path';
end$$;

rollback;
