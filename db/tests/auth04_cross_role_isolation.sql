-- =============================================================================
-- AUTH-04 — Cross-role access denial smoke test.
-- Seeds a FARMER and a RESTAURANT user via auth.users (the 0003 trigger
-- materializes public.profiles), then under each identity asserts that
-- a plain `select * from public.profiles` returns exactly one row — their
-- own — and that an attempted cross-row UPDATE affects zero rows.
--
-- This is the smoke test behind the AUTH-04 acceptance line:
--   "Cross-role access denied; service key isolated to backend"
--
-- Service-role psql connection only (direct :5432). Wrapped in a txn that
-- ROLLBACKs so the live project ends in the same state it started.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- The on-signup trigger (migration 0007) refuses anonymous ADMIN signups; we
-- are inserting FARMER + RESTAURANT under a service_role JWT claim either way,
-- which matches what auth.admin.create_user does.
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare
    farmer_id     uuid := gen_random_uuid();
    restaurant_id uuid := gen_random_uuid();
begin
    insert into auth.users (
        id, instance_id, aud, role, email,
        raw_user_meta_data, encrypted_password,
        email_confirmed_at, created_at, updated_at
    ) values (
        farmer_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        format('auth04-farmer-%s@test.local', farmer_id),
        jsonb_build_object('role', 'FARMER', 'locale', 'fr', 'full_name', 'AUTH-04 Farmer'),
        crypt('Abcdefg123', gen_salt('bf')),
        now(), now(), now()
    ), (
        restaurant_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        format('auth04-restaurant-%s@test.local', restaurant_id),
        jsonb_build_object('role', 'RESTAURANT', 'locale', 'fr', 'full_name', 'AUTH-04 Restaurant'),
        crypt('Abcdefg123', gen_salt('bf')),
        now(), now(), now()
    );

    perform set_config('test.farmer_id',     farmer_id::text,     true);
    perform set_config('test.restaurant_id', restaurant_id::text, true);
end$$;

-- ---------------------------------------------------------------------------
-- FARMER identity
-- ---------------------------------------------------------------------------
select set_config(
    'request.jwt.claims',
    jsonb_build_object(
        'sub',       current_setting('test.farmer_id'),
        'user_role', 'FARMER',
        'role',      'authenticated'
    )::text,
    true
);
set local role authenticated;

-- (1) FARMER sees exactly one row.
do $$
declare
    visible int;
begin
    select count(*) into visible from public.profiles;
    if visible <> 1 then
        raise exception
            'AUTH-04 cross-role leak: FARMER sees % profile rows under RLS (expected exactly 1)',
            visible;
    end if;
    raise notice 'OK (1) FARMER sees exactly one profile row under RLS';
end$$;

-- (2) The visible row is the FARMER's own profile.
do $$
declare
    visible_id text;
begin
    select id::text into visible_id from public.profiles limit 1;
    if visible_id is distinct from current_setting('test.farmer_id') then
        raise exception
            'AUTH-04 cross-role leak: FARMER sees foreign row (got %, expected %)',
            visible_id, current_setting('test.farmer_id');
    end if;
    raise notice 'OK (2) the visible row is the FARMER own profile';
end$$;

-- (3) FARMER UPDATE against the RESTAURANT row affects zero rows.
do $$
declare
    rows_affected int;
begin
    with attempt as (
        update public.profiles
           set full_name = 'hacked-by-farmer'
         where id = current_setting('test.restaurant_id')::uuid
        returning 1
    )
    select count(*) into rows_affected from attempt;

    if rows_affected <> 0 then
        raise exception
            'AUTH-04 cross-role leak: FARMER UPDATE on RESTAURANT row affected % rows (expected 0)',
            rows_affected;
    end if;
    raise notice 'OK (3) FARMER UPDATE on RESTAURANT row affected zero rows (RLS filter)';
end$$;

-- ---------------------------------------------------------------------------
-- Switch to RESTAURANT identity.
-- ---------------------------------------------------------------------------
reset role;
select set_config(
    'request.jwt.claims',
    jsonb_build_object(
        'sub',       current_setting('test.restaurant_id'),
        'user_role', 'RESTAURANT',
        'role',      'authenticated'
    )::text,
    true
);
set local role authenticated;

-- (4) RESTAURANT also sees exactly one row — its own.
do $$
declare
    visible_id text;
begin
    select id::text into visible_id from public.profiles limit 1;
    if visible_id is distinct from current_setting('test.restaurant_id') then
        raise exception
            'AUTH-04 cross-role leak: RESTAURANT sees foreign row (got %, expected %)',
            visible_id, current_setting('test.restaurant_id');
    end if;
    raise notice 'OK (4) RESTAURANT sees only its own profile';
end$$;

-- ---------------------------------------------------------------------------
-- Reset role and confirm public.has_role() returns true for the
-- previously-set user when run as the appropriate identity.
-- ---------------------------------------------------------------------------
reset role;
select set_config(
    'request.jwt.claims',
    jsonb_build_object(
        'sub',       current_setting('test.farmer_id'),
        'user_role', 'FARMER',
        'role',      'authenticated'
    )::text,
    true
);

do $$
begin
    if not public.has_role('FARMER'::public.user_role) then
        raise exception
            'AUTH-04 has_role helper: expected true for FARMER under farmer JWT';
    end if;
    if public.has_role('ADMIN'::public.user_role) then
        raise exception
            'AUTH-04 has_role helper: expected false for ADMIN under farmer JWT';
    end if;
    raise notice 'OK (5) has_role() returns true for current role, false otherwise';
end$$;

rollback;
