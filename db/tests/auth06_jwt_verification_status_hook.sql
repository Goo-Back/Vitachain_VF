-- =============================================================================
-- AUTH-06 — custom_access_token_hook lifts BOTH user_role and
-- verification_status onto the JWT in a single call.
--
-- The hook (migration 0014) reads profiles.role and profiles.verification_status
-- in one SELECT and returns the event with the claims merged. This test
-- exercises each (role, status) combination and asserts the claims round-trip.
--
-- Wrapped in begin ... rollback. Service-role psql.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- The handle_new_user trigger 22023s on raw_user_meta_data->>'role' missing;
-- and the immutability trigger refuses verification_status writes from
-- non-service-role JWTs. Service-role claim here lets us flip both columns.
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare
    uid    uuid;
    payload jsonb;
    result  jsonb;
    r       text;
    s       text;
begin
    foreach r in array array['FARMER','RESTAURANT','CITIZEN','ADMIN'] loop
        foreach s in array array['PENDING','VERIFIED','REJECTED'] loop
            uid := gen_random_uuid();

            insert into auth.users (
                id, instance_id, aud, role, email,
                raw_user_meta_data, encrypted_password,
                email_confirmed_at, created_at, updated_at
            ) values (
                uid, '00000000-0000-0000-0000-000000000000',
                'authenticated', 'authenticated',
                format('auth06_hook_%s@test.local', uid),
                jsonb_build_object('role', r, 'locale', 'fr',
                                   'full_name', 'hook test'),
                crypt('Abcdefg123', gen_salt('bf')),
                now(), now(), now()
            );

            -- Trigger already materialized public.profiles with role=r and
            -- verification_status='PENDING'. Flip to the target status.
            update public.profiles
               set verification_status = s::public.verification_status
             where id = uid;

            payload := jsonb_build_object(
                'user_id', uid::text,
                'claims',  jsonb_build_object('sub', uid::text)
            );

            result := public.custom_access_token_hook(payload);

            if (result->'claims'->>'user_role') is distinct from r then
                raise exception
                    'AUTH-06 hook FAIL — expected user_role=%, got %',
                    r, result->'claims'->>'user_role';
            end if;

            if (result->'claims'->>'verification_status') is distinct from s then
                raise exception
                    'AUTH-06 hook FAIL — expected verification_status=%, got %',
                    s, result->'claims'->>'verification_status';
            end if;
        end loop;
    end loop;
    raise notice 'OK custom_access_token_hook lifts both claims for every (role, status) combination';
end$$;

-- Negative: flipping the column re-runs the hook with the new value.
do $$
declare
    uid    uuid := gen_random_uuid();
    result jsonb;
begin
    insert into auth.users (
        id, instance_id, aud, role, email,
        raw_user_meta_data, encrypted_password,
        email_confirmed_at, created_at, updated_at
    ) values (
        uid, '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        format('auth06_hook_flip_%s@test.local', uid),
        jsonb_build_object('role', 'FARMER', 'locale', 'fr',
                           'full_name', 'flip test'),
        crypt('Abcdefg123', gen_salt('bf')),
        now(), now(), now()
    );

    result := public.custom_access_token_hook(
        jsonb_build_object('user_id', uid::text, 'claims', '{}'::jsonb)
    );
    if (result->'claims'->>'verification_status') <> 'PENDING' then
        raise exception 'AUTH-06 hook FAIL — initial claim mismatch';
    end if;

    -- Bump via service-role (bypasses the immutability trigger).
    update public.profiles set verification_status = 'VERIFIED' where id = uid;

    result := public.custom_access_token_hook(
        jsonb_build_object('user_id', uid::text, 'claims', '{}'::jsonb)
    );
    if (result->'claims'->>'verification_status') <> 'VERIFIED' then
        raise exception 'AUTH-06 hook FAIL — claim did not follow column flip';
    end if;
    raise notice 'OK hook re-reads profiles.verification_status on each call';
end$$;

rollback;
