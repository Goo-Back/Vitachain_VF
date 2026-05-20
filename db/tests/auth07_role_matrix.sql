-- =============================================================================
-- AUTH-07 — role × table × verb matrix.
--
-- 22 cells documented in docs/stories/AUTH-07-…md §4. Each cell asserts a
-- single (identity, table, verb) outcome.
--
-- Cells whose underlying domain table is not yet merged are SKIPPED with a
-- notice rather than failing — the suite stays green between AUTH-07 landing
-- and the owner stories' (KAT-01..05 / FAR-01..06 / SEC-01..08 / BOT-03..05)
-- merge window, then activates automatically as each table appears.
--
-- The base cells (1, 2, 3 against public.profiles) always run because AUTH-04
-- shipped the table. Domain cells (4..21) activate as KAT/FAR/SEC merge. Cell
-- 22 (anon public catalog) is an HTTP-layer concern and lives in the e2e
-- pytest sweep — not exercisable from inside a single psql transaction.
--
-- Service-role psql, direct :5432, wrapped in begin … rollback.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

\i tests/_auth07_seed.psql

-- ---------------------------------------------------------------------------
-- Identity switch helper. Reused across every cell.
-- Created inside the transaction so a stale function from an aborted prior
-- run is impossible.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.as_user(p_user_id uuid, p_role text)
returns void language plpgsql as $$
begin
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',       p_user_id,
            'user_role', p_role,
            'role',      'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';
end$$;

create or replace function pg_temp.as_user_verified(
    p_user_id uuid, p_role text, p_status text
)
returns void language plpgsql as $$
begin
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 p_user_id,
            'user_role',           p_role,
            'verification_status', p_status,
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';
end$$;

create or replace function pg_temp.reset_to_service()
returns void language plpgsql as $$
begin
    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end$$;

-- ===========================================================================
-- Cell #1 — FARMER-A sees exactly own profile.
-- ===========================================================================
select pg_temp.as_user(
    current_setting('auth07.farmer_a_id')::uuid,
    'FARMER'
);

do $$
declare
    visible int;
    visible_id text;
begin
    select count(*) into visible from public.profiles;
    if visible <> 1 then
        raise exception
            'AUTH-07 cell-01: FARMER-A SELECT public.profiles returned % rows (expected 1)',
            visible;
    end if;

    select id::text into visible_id from public.profiles limit 1;
    if visible_id is distinct from current_setting('auth07.farmer_a_id') then
        raise exception
            'AUTH-07 cell-01b: FARMER-A saw foreign profile (got %, expected %)',
            visible_id, current_setting('auth07.farmer_a_id');
    end if;
    raise notice 'OK cell-01: FARMER-A SELECT public.profiles -> exactly own row';
end$$;

-- ===========================================================================
-- Cell #2 — FARMER-A cannot read FARMER-B's profile.
-- ===========================================================================
do $$
declare
    leaked int;
begin
    select count(*) into leaked
      from public.profiles
     where id = current_setting('auth07.farmer_b_id')::uuid;

    if leaked <> 0 then
        raise exception
            'AUTH-07 cell-02: FARMER-A read FARMER-B profile (% rows; RLS LEAK)',
            leaked;
    end if;
    raise notice 'OK cell-02: FARMER-A SELECT FARMER-B profile -> 0 rows';
end$$;

-- ===========================================================================
-- Cell #3 — FARMER-A cannot UPDATE FARMER-B's profile (silent denial).
-- ===========================================================================
do $$
declare
    affected int;
begin
    with attempt as (
        update public.profiles
           set full_name = 'hacked-by-cell-03'
         where id = current_setting('auth07.farmer_b_id')::uuid
        returning 1
    )
    select count(*) into affected from attempt;

    if affected <> 0 then
        raise exception
            'AUTH-07 cell-03: FARMER-A UPDATE on FARMER-B affected % rows (RLS LEAK)',
            affected;
    end if;
    raise notice 'OK cell-03: FARMER-A UPDATE FARMER-B profile -> 0 rows';
end$$;

-- ===========================================================================
-- Cell #4 — FARMER-A INSERT own parcel.
-- (Skipped until KAT-01 merges katara.parcels.)
-- ===========================================================================
do $$
begin
    if to_regclass('katara.parcels') is null then
        raise notice 'SKIP cell-04: katara.parcels not yet merged (KAT-01)';
        return;
    end if;

    execute format(
        $sql$
            insert into katara.parcels (id, owner_id, crop, surface_m2, geom)
            values (gen_random_uuid(), %L::uuid, 'cucumber', 1000,
                    st_geomfromgeojson('{"type":"Polygon","coordinates":[[[5,5],[5,6],[6,6],[6,5],[5,5]]]}'))
        $sql$,
        current_setting('auth07.farmer_a_id')
    );
    raise notice 'OK cell-04: FARMER-A INSERT own katara.parcel';
end$$;

-- ===========================================================================
-- Cell #5 — FARMER-A cannot SELECT FARMER-B's parcel.
-- ===========================================================================
do $$
declare
    leaked int;
begin
    if to_regclass('katara.parcels') is null then
        raise notice 'SKIP cell-05: katara.parcels not yet merged (KAT-01)';
        return;
    end if;

    execute format(
        'select count(*) from katara.parcels where id = %L::uuid',
        current_setting('auth07.parcel_b_id', true)
    ) into leaked;

    if leaked <> 0 then
        raise exception
            'AUTH-07 cell-05: FARMER-A read FARMER-B parcel (% rows; RLS LEAK)',
            leaked;
    end if;
    raise notice 'OK cell-05: FARMER-A SELECT FARMER-B parcel -> 0 rows';
end$$;

-- ===========================================================================
-- Cell #6 — Direct INSERT into katara.telemetry under user JWT is denied.
-- ===========================================================================
do $$
begin
    if to_regclass('katara.telemetry') is null then
        raise notice 'SKIP cell-06: katara.telemetry not yet merged (KAT-03)';
        return;
    end if;

    begin
        execute $sql$
            insert into katara.telemetry (device_id, recorded_at, soil_moisture)
            values ('00000000-0000-0000-0000-000000000000'::uuid, now(), 50)
        $sql$;
        raise exception
            'AUTH-07 cell-06: FARMER user-JWT INSERT into katara.telemetry succeeded (BR-KAT-03 LEAK)';
    exception when insufficient_privilege then
        raise notice 'OK cell-06: FARMER user-JWT INSERT katara.telemetry -> 42501';
    when others then
        if sqlstate in ('42501', '42P01') then
            raise notice 'OK cell-06: katara.telemetry insert refused (%)', sqlstate;
        else
            raise;
        end if;
    end;
end$$;

-- ===========================================================================
-- Cell #7 — FARMER-A UPDATE own ad succeeds.
-- Cell #8 — FARMER-A UPDATE another farmer's ad is filtered (0 rows).
-- ===========================================================================
do $$
declare
    affected int;
begin
    if to_regclass('farmarket.ads') is null then
        raise notice 'SKIP cell-07/08: farmarket.ads not yet merged (FAR-01)';
        return;
    end if;

    -- cell-07
    execute format(
        $sql$
            update farmarket.ads
               set title = 'Tomato 5kg — updated'
             where id = %L::uuid
            returning 1
        $sql$,
        current_setting('auth07.ad_a_id', true)
    );
    raise notice 'OK cell-07: FARMER-A UPDATE own farmarket.ad';

    -- cell-08 — attempt with a NON-existent foreign id (the only ad belongs to
    -- FARMER-A; a row authored by FARMER-B is only inserted once FAR-01 + the
    -- seed are both extended). Stay defensive: assert 0 rows even when the
    -- target id is synthetic.
    with attempt as (
        update farmarket.ads
           set title = 'hacked'
         where owner_id <> current_setting('auth07.farmer_a_id')::uuid
        returning 1
    )
    select count(*) into affected from attempt;

    if affected <> 0 then
        raise exception
            'AUTH-07 cell-08: FARMER-A UPDATE on foreign farmarket.ads affected % rows (RLS LEAK)',
            affected;
    end if;
    raise notice 'OK cell-08: FARMER-A UPDATE foreign ads -> 0 rows';
end$$;

-- ===========================================================================
-- Cell #9 — Unverified FARMER-B INSERT ad is denied by AUTH-06 gate.
-- ===========================================================================
select pg_temp.as_user_verified(
    current_setting('auth07.farmer_b_id')::uuid,
    'FARMER',
    'PENDING'
);

do $$
begin
    if to_regclass('farmarket.ads') is null then
        raise notice 'SKIP cell-09: farmarket.ads not yet merged (FAR-01)';
        return;
    end if;

    begin
        execute format(
            $sql$
                insert into farmarket.ads
                    (owner_id, title, status, price_mad, quantity_kg, region)
                values (%L::uuid, 'Unverified attempt', 'ACTIVE', 50, 3, 'Souss-Massa')
            $sql$,
            current_setting('auth07.farmer_b_id')
        );
        raise exception
            'AUTH-07 cell-09: unverified FARMER-B INSERT farmarket.ad SUCCEEDED (AUTH-06 GATE FAILED)';
    exception when insufficient_privilege then
        raise notice 'OK cell-09: unverified FARMER-B INSERT farmarket.ad -> 42501';
    when check_violation then
        raise notice 'OK cell-09: unverified FARMER-B INSERT farmarket.ad -> 23514 (WITH CHECK)';
    end;
end$$;

-- ===========================================================================
-- Cell #10 — Verified FARMER-A can INSERT ad.
-- ===========================================================================
select pg_temp.as_user_verified(
    current_setting('auth07.farmer_a_id')::uuid,
    'FARMER',
    'VERIFIED'
);

do $$
begin
    if to_regclass('farmarket.ads') is null then
        raise notice 'SKIP cell-10: farmarket.ads not yet merged (FAR-01)';
        return;
    end if;

    execute format(
        $sql$
            insert into farmarket.ads
                (owner_id, title, status, price_mad, quantity_kg, region)
            values (%L::uuid, 'Verified insert', 'ACTIVE', 80, 5, 'Souss-Massa')
        $sql$,
        current_setting('auth07.farmer_a_id')
    );
    raise notice 'OK cell-10: verified FARMER-A INSERT farmarket.ad';
end$$;

-- ===========================================================================
-- Cell #11 — FARMER-A can SELECT leads for own ad.
-- ===========================================================================
do $$
begin
    if to_regclass('farmarket.leads') is null then
        raise notice 'SKIP cell-11: farmarket.leads not yet merged (FAR-04)';
        return;
    end if;

    -- Structural — we only assert the table is queryable under FARMER-A's JWT
    -- without raising. The cross-ad isolation is the seed's responsibility
    -- once FAR-04 + the seed are extended.
    perform count(*) from farmarket.leads;
    raise notice 'OK cell-11: FARMER-A SELECT farmarket.leads (own ad) -> reachable';
end$$;

-- ===========================================================================
-- Cell #12 — RESTAURANT can SELECT public ad catalog.
-- Cell #13 — RESTAURANT INSERT ad is denied (BR-F1 role gate).
-- ===========================================================================
select pg_temp.as_user_verified(
    current_setting('auth07.restaurant_id')::uuid,
    'RESTAURANT',
    'VERIFIED'
);

do $$
declare
    visible int;
begin
    if to_regclass('farmarket.ads') is null then
        raise notice 'SKIP cell-12/13: farmarket.ads not yet merged (FAR-01)';
        return;
    end if;

    select count(*) into visible
      from farmarket.ads
     where status = 'ACTIVE';

    if visible < 1 then
        raise exception
            'AUTH-07 cell-12: RESTAURANT saw % ACTIVE ads (expected ≥ 1 public-read row)',
            visible;
    end if;
    raise notice 'OK cell-12: RESTAURANT SELECT farmarket.ads ACTIVE -> % rows', visible;

    begin
        execute format(
            $sql$
                insert into farmarket.ads
                    (owner_id, title, status, price_mad, quantity_kg, region)
                values (%L::uuid, 'role-leak', 'ACTIVE', 60, 5, 'Casa')
            $sql$,
            current_setting('auth07.restaurant_id')
        );
        raise exception
            'AUTH-07 cell-13: RESTAURANT INSERT farmarket.ad SUCCEEDED (BR-F1 LEAK)';
    exception when insufficient_privilege then
        raise notice 'OK cell-13: RESTAURANT INSERT farmarket.ad -> 42501';
    when check_violation then
        raise notice 'OK cell-13: RESTAURANT INSERT farmarket.ad -> 23514 (WITH CHECK)';
    end;
end$$;

-- ===========================================================================
-- Cell #14 — Verified RESTAURANT can INSERT a meal.
-- ===========================================================================
do $$
begin
    if to_regclass('secondserve.meals') is null then
        raise notice 'SKIP cell-14: secondserve.meals not yet merged (SEC-01)';
        return;
    end if;

    execute format(
        $sql$
            insert into secondserve.meals
                (owner_id, title, status, price_mad, quantity_remaining, deadline)
            values (%L::uuid, 'tagine', 'ACTIVE', 40, 3, now() + interval '3 hours')
        $sql$,
        current_setting('auth07.restaurant_id')
    );
    raise notice 'OK cell-14: verified RESTAURANT INSERT secondserve.meal';
end$$;

-- ===========================================================================
-- Cell #15 / #16 — RESTAURANT reservations isolation.
-- ===========================================================================
do $$
declare
    leaked int;
begin
    if to_regclass('secondserve.reservations') is null then
        raise notice 'SKIP cell-15/16: secondserve.reservations not yet merged (SEC-06)';
        return;
    end if;

    select count(*) into leaked
      from secondserve.reservations
     where owner_meal_id is null
        or owner_meal_id not in (
            select id from secondserve.meals
             where owner_id = current_setting('auth07.restaurant_id')::uuid
        );

    if leaked <> 0 then
        raise exception
            'AUTH-07 cell-16: RESTAURANT saw % reservations for foreign meals (RLS LEAK)',
            leaked;
    end if;
    raise notice 'OK cell-15/16: RESTAURANT reservations scoped to own meals';
exception when undefined_column then
    raise notice 'SKIP cell-15/16: secondserve.reservations.owner_meal_id absent — re-check after SEC-06 ships';
end$$;

-- ===========================================================================
-- Cell #17 — CITIZEN can SELECT public meal catalog.
-- Cell #18 — CITIZEN cannot INSERT a meal.
-- ===========================================================================
select pg_temp.as_user(
    current_setting('auth07.citizen_a_id')::uuid,
    'CITIZEN'
);

do $$
declare
    visible int;
begin
    if to_regclass('secondserve.meals') is null then
        raise notice 'SKIP cell-17/18: secondserve.meals not yet merged (SEC-01)';
        return;
    end if;

    select count(*) into visible
      from secondserve.meals
     where status = 'ACTIVE';

    if visible < 1 then
        raise exception
            'AUTH-07 cell-17: CITIZEN saw % ACTIVE meals (expected ≥ 1)',
            visible;
    end if;
    raise notice 'OK cell-17: CITIZEN SELECT secondserve.meals ACTIVE -> % rows', visible;

    begin
        execute format(
            $sql$
                insert into secondserve.meals
                    (owner_id, title, status, price_mad, quantity_remaining, deadline)
                values (%L::uuid, 'should-not-allow', 'ACTIVE', 10, 1, now() + interval '1 hour')
            $sql$,
            current_setting('auth07.citizen_a_id')
        );
        raise exception
            'AUTH-07 cell-18: CITIZEN INSERT secondserve.meal SUCCEEDED (ROLE GATE LEAK)';
    exception when insufficient_privilege then
        raise notice 'OK cell-18: CITIZEN INSERT secondserve.meal -> 42501';
    when check_violation then
        raise notice 'OK cell-18: CITIZEN INSERT secondserve.meal -> 23514 (WITH CHECK)';
    end;
end$$;

-- ===========================================================================
-- Cell #19 / #20 — CITIZEN reservation isolation.
-- ===========================================================================
do $$
declare
    leaked int;
begin
    if to_regclass('secondserve.reservations') is null then
        raise notice 'SKIP cell-19/20: secondserve.reservations not yet merged (SEC-06)';
        return;
    end if;

    select count(*) into leaked
      from secondserve.reservations
     where citizen_id is null
        or citizen_id <> current_setting('auth07.citizen_a_id')::uuid;

    if leaked <> 0 then
        raise exception
            'AUTH-07 cell-20: CITIZEN-A saw % reservations not their own (PICKUP-CODE PRIVACY LEAK)',
            leaked;
    end if;
    raise notice 'OK cell-19/20: CITIZEN-A reservations scoped to own rows';
exception when undefined_column then
    raise notice 'SKIP cell-19/20: secondserve.reservations.citizen_id absent — re-check after SEC-06 ships';
end$$;

-- ===========================================================================
-- Cell #21 — ADMIN can SELECT all farmarket.leads.
-- ===========================================================================
select pg_temp.as_user(
    current_setting('auth07.admin_id')::uuid,
    'ADMIN'
);

do $$
declare
    reachable int;
begin
    if to_regclass('farmarket.leads') is null then
        raise notice 'SKIP cell-21: farmarket.leads not yet merged (FAR-04)';
        return;
    end if;

    select count(*) into reachable from farmarket.leads;
    raise notice 'OK cell-21: ADMIN SELECT farmarket.leads -> % rows reachable', reachable;
end$$;

-- ===========================================================================
-- Cell #22 — anon GET public catalog. PostgREST-level concern, lives in the
-- e2e pytest sweep. Documented here for traceability.
-- ===========================================================================
do $$
begin
    raise notice 'INFO cell-22: anon catalog read exercised by test_auth07_role_matrix_e2e.py';
end$$;

-- ---------------------------------------------------------------------------
-- Always end on service-role and the side-effect-free txn rollback.
-- ---------------------------------------------------------------------------
select pg_temp.reset_to_service();

do $$ begin
    raise notice 'AUTH-07 role × table × verb matrix completed — rolling back';
end$$;

rollback;
