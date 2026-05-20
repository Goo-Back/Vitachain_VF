-- =============================================================================
-- AUTH-06 — the verification-status gate is the LITERAL acceptance line:
--   "verification_status gate blocks unverified create-ad/publish-meal"
--
-- The downstream tables (farmarket.ads, secondserve.meals, katara.parcels)
-- do not yet exist. To prove the gate without coupling AUTH-06 to those
-- schemas, we mint a throwaway table _auth06_drill_ads with the same RLS
-- shape FAR-01 / SEC-01 will use, then exercise the pro/verified matrix.
--
-- Wrapped in begin ... rollback. Service-role psql.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- The AUTH-04 event trigger fires per CREATE TABLE in `public.*` and
-- requires RLS to already be on. Disable for the drill, re-enable after.
alter event trigger trg_enforce_rls_on_public_tables disable;

create table public._auth06_drill_ads (
    id        uuid primary key default gen_random_uuid(),
    seller_id uuid not null
);
alter table public._auth06_drill_ads enable row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

create policy "_auth06_drill_ads_insert_pro_verified"
    on public._auth06_drill_ads for insert to authenticated
    with check (
        (auth.jwt() ->> 'user_role')          in ('FARMER','RESTAURANT')
        and (auth.jwt() ->> 'verification_status') = 'VERIFIED'
        and seller_id = auth.uid()
    );

-- Seed a farmer profile (and auth.users row) for the test.
set local request.jwt.claims = '{"role":"service_role"}';
do $$
declare
    uid uuid := gen_random_uuid();
begin
    insert into auth.users (
        id, instance_id, aud, role, email,
        raw_user_meta_data, encrypted_password,
        email_confirmed_at, created_at, updated_at
    ) values (
        uid, '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        format('auth06_drill_%s@test.local', uid),
        jsonb_build_object('role', 'FARMER', 'locale', 'fr',
                           'full_name', 'drill'),
        crypt('Abcdefg123', gen_salt('bf')),
        now(), now(), now()
    );
    perform set_config('test.farmer_id', uid::text, true);
end$$;

set local role authenticated;

-- ---- (1) PENDING farmer is BLOCKED ------------------------------------------
select set_config(
    'request.jwt.claims',
    json_build_object(
        'sub', current_setting('test.farmer_id'),
        'role', 'authenticated',
        'user_role', 'FARMER',
        'verification_status', 'PENDING'
    )::text,
    true
);

do $$
declare
    affected int;
begin
    begin
        insert into public._auth06_drill_ads (seller_id)
        values (current_setting('test.farmer_id')::uuid);
        get diagnostics affected = row_count;
        if affected <> 0 then
            raise exception 'AUTH-06 GATE FAIL — PENDING farmer inserted % rows', affected;
        end if;
    exception when insufficient_privilege then
        affected := 0;
    end;
    raise notice 'OK (1) PENDING farmer blocked from publish';
end$$;

-- ---- (2) VERIFIED farmer SUCCEEDS -------------------------------------------
select set_config(
    'request.jwt.claims',
    json_build_object(
        'sub', current_setting('test.farmer_id'),
        'role', 'authenticated',
        'user_role', 'FARMER',
        'verification_status', 'VERIFIED'
    )::text,
    true
);

do $$
declare
    affected int;
begin
    insert into public._auth06_drill_ads (seller_id)
    values (current_setting('test.farmer_id')::uuid);
    get diagnostics affected = row_count;
    if affected <> 1 then
        raise exception 'AUTH-06 GATE FAIL — VERIFIED farmer affected % rows; expected 1', affected;
    end if;
    raise notice 'OK (2) VERIFIED farmer publishes';
end$$;

-- ---- (3) VERIFIED citizen is BLOCKED (role gate) ----------------------------
select set_config(
    'request.jwt.claims',
    json_build_object(
        'sub', current_setting('test.farmer_id'),
        'role', 'authenticated',
        'user_role', 'CITIZEN',
        'verification_status', 'VERIFIED'
    )::text,
    true
);

do $$
declare
    affected int;
begin
    begin
        insert into public._auth06_drill_ads (seller_id)
        values (current_setting('test.farmer_id')::uuid);
        get diagnostics affected = row_count;
        if affected <> 0 then
            raise exception 'AUTH-06 GATE FAIL — VERIFIED citizen inserted % rows', affected;
        end if;
    exception when insufficient_privilege then
        affected := 0;
    end;
    raise notice 'OK (3) VERIFIED citizen blocked (role gate)';
end$$;

reset role;

rollback;
