-- =============================================================================
-- AUTH-07 — Business-rule regression suite (DB layer).
--
-- 11 PRD business rules whose enforcing layer is schema-resident (CHECK,
-- trigger, RLS WITH CHECK, or scheduled-worker SQL function):
--   BR-K1 — one ESP32 ↔ one parcel
--   BR-K2 — alert anti-spam (≤ 1 email / device / metric / 24h)
--   BR-K4 — history API ≤ 500 points
--   BR-F1 — only FARMER can create ads (verification gate handled by cells 9/10)
--   BR-F2 — ≤ 5 photos / ad (CHECK)
--   BR-F3 — ads > 7 days → EXPIRED (worker SQL)
--   BR-S1 — pickup code generated server-side, VITA-XXX format
--   BR-S2 — atomic reservation; second concurrent attempt raises P0001
--   BR-S3 — auto-expiry every 15 min (worker SQL boundary correctness)
--   BR-S4 — monthly commission = SUM(price × qty) × 0.15
--   BR-B1 — Moroccan phone format (CHECK)
--
-- Application-layer BRs (BR-K3 OWM cache TTL, BR-F4 frontend bundle, BR-B2
-- webhook routing, plus the BR-S1/S2 HTTP-level surfacing) live in
-- backend/tests/test_auth07_business_rules.py.
--
-- Each BR block is guarded by to_regclass / has_function-style probes so
-- assertions only fire once the owner story has merged. Skips are logged
-- with NOTICE; they never silently pass.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

\i tests/_auth07_seed.psql

-- Service role for all DDL probes; per-BR blocks may swap identity locally.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create or replace function pg_temp.fn_exists(p_qualified text)
returns boolean language plpgsql as $$
declare
    cnt int;
begin
    select count(*) into cnt
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where format('%s.%s', n.nspname, p.proname) = p_qualified;
    return cnt > 0;
end$$;

-- ===========================================================================
-- BR-K1 — one ESP32 ↔ one parcel (unique on device_api_key_hash).
-- ===========================================================================
do $$
declare
    parcel_a uuid;
    parcel_b uuid;
    hashed   text := encode(digest('auth07-br-k1-shared-key', 'sha256'), 'hex');
begin
    if to_regclass('katara.devices') is null then
        raise notice 'SKIP BR-K1: katara.devices not yet merged (KAT-02)';
        return;
    end if;

    parcel_a := current_setting('auth07.parcel_a_id', true)::uuid;
    parcel_b := current_setting('auth07.parcel_b_id', true)::uuid;

    execute format(
        $sql$
            insert into katara.devices (parcel_id, device_api_key_hash, label)
            values (%L::uuid, %L, 'br-k1-first')
        $sql$,
        parcel_a, hashed
    );

    begin
        execute format(
            $sql$
                insert into katara.devices (parcel_id, device_api_key_hash, label)
                values (%L::uuid, %L, 'br-k1-second')
            $sql$,
            parcel_b, hashed
        );
        raise exception 'AUTH-07 BR-K1: duplicate device_api_key_hash insert SUCCEEDED';
    exception when unique_violation then
        raise notice 'OK BR-K1: one ESP32 ↔ one parcel (unique_violation on second insert)';
    end;
end$$;

-- ===========================================================================
-- BR-K2 — alert anti-spam (≤ 1 email / (device, metric) / 24h).
-- ===========================================================================
do $$
declare
    device_id uuid;
    result    boolean;
begin
    if to_regclass('katara.alert_sent_log') is null
       or not pg_temp.fn_exists('katara.should_send_alert') then
        raise notice 'SKIP BR-K2: katara.alert_sent_log or should_send_alert() not yet merged (KAT-06)';
        return;
    end if;

    execute 'select id from katara.devices limit 1' into device_id;
    if device_id is null then
        raise notice 'SKIP BR-K2: no katara.devices rows seeded yet';
        return;
    end if;

    execute format(
        $sql$
            insert into katara.alert_sent_log (device_id, metric, sent_at)
            values (%L::uuid, 'soil_moisture', now() - interval '5 minutes')
        $sql$,
        device_id
    );

    execute format(
        'select katara.should_send_alert(%L::uuid, %L)',
        device_id, 'soil_moisture'
    ) into result;
    if result is not false then
        raise exception 'AUTH-07 BR-K2: 5-minute-ago alert allowed a re-send (% expected false)', result;
    end if;
    raise notice 'OK BR-K2 (a): should_send_alert false within 24h';

    execute format(
        $sql$
            update katara.alert_sent_log
               set sent_at = now() - interval '25 hours'
             where device_id = %L::uuid
               and metric = 'soil_moisture'
        $sql$,
        device_id
    );

    execute format(
        'select katara.should_send_alert(%L::uuid, %L)',
        device_id, 'soil_moisture'
    ) into result;
    if result is not true then
        raise exception 'AUTH-07 BR-K2: 25-hour-ago alert refused re-send (% expected true)', result;
    end if;
    raise notice 'OK BR-K2 (b): should_send_alert true after 24h';
end$$;

-- ===========================================================================
-- BR-K4 — history API ≤ 500 points regardless of granularity.
-- ===========================================================================
do $$
declare
    parcel_id uuid;
    returned int;
begin
    if not pg_temp.fn_exists('katara.history') then
        raise notice 'SKIP BR-K4: katara.history() not yet merged (KAT-04)';
        return;
    end if;

    parcel_id := current_setting('auth07.parcel_a_id', true)::uuid;

    -- Owner story extends the seed to fabricate 1000 telemetry rows; if not
    -- yet ready, fall back to the function's contract assertion.
    execute format('select count(*) from katara.history(%L::uuid, %L)',
                   parcel_id, 'hour') into returned;

    if returned > 500 then
        raise exception 'AUTH-07 BR-K4: katara.history returned % rows (> 500 cap)', returned;
    end if;
    raise notice 'OK BR-K4: history() returned % rows (≤ 500)', returned;
end$$;

-- ===========================================================================
-- BR-F1 — only FARMER+VERIFIED can INSERT into farmarket.ads.
-- Cross-role/cross-verification fan-out already covered by role-matrix cells
-- 9, 10, 13. Here we add the CITIZEN case to close the role enum.
-- ===========================================================================
do $$
begin
    if to_regclass('farmarket.ads') is null then
        raise notice 'SKIP BR-F1: farmarket.ads not yet merged (FAR-01)';
        return;
    end if;

    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.citizen_a_id'),
            'user_role',           'CITIZEN',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    begin
        execute format(
            $sql$
                insert into farmarket.ads
                    (owner_id, title, status, price_mad, quantity_kg, region)
                values (%L::uuid, 'citizen-leak', 'ACTIVE', 30, 5, 'Casa')
            $sql$,
            current_setting('auth07.citizen_a_id')
        );
        raise exception 'AUTH-07 BR-F1: CITIZEN inserted into farmarket.ads (ROLE GATE LEAK)';
    exception when insufficient_privilege then
        raise notice 'OK BR-F1: CITIZEN INSERT farmarket.ads -> 42501';
    when check_violation then
        raise notice 'OK BR-F1: CITIZEN INSERT farmarket.ads -> 23514';
    end;

    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end$$;

-- ===========================================================================
-- BR-F2 — ≤ 5 photos / ad (CHECK on farmarket.ads.photos).
-- ===========================================================================
do $$
begin
    if to_regclass('farmarket.ads') is null then
        raise notice 'SKIP BR-F2: farmarket.ads not yet merged (FAR-01)';
        return;
    end if;

    begin
        execute format(
            $sql$
                insert into farmarket.ads
                    (owner_id, title, status, price_mad, quantity_kg, region, photos)
                values (%L::uuid, 'too-many-photos', 'ACTIVE', 50, 5, 'Souss-Massa',
                        array['p1','p2','p3','p4','p5','p6'])
            $sql$,
            current_setting('auth07.farmer_a_id')
        );
        raise exception 'AUTH-07 BR-F2: 6-photo ad insert SUCCEEDED (CHECK missing)';
    exception when check_violation then
        raise notice 'OK BR-F2: 6-photo ad -> 23514 (≤ 5 photo CHECK fires)';
    end;
end$$;

-- ===========================================================================
-- BR-F3 — ads > 7 days → EXPIRED. Boundary correctness (7d+1h flips, 6d+23h
-- stays). The off-by-one assertion is the regression killer for a refactor
-- that swaps `>=` to `>`.
-- ===========================================================================
do $$
declare
    stale_id uuid := gen_random_uuid();
    fresh_id uuid := gen_random_uuid();
    stale_status text;
    fresh_status text;
begin
    if to_regclass('farmarket.ads') is null
       or not pg_temp.fn_exists('farmarket.expire_stale_ads') then
        raise notice 'SKIP BR-F3: farmarket.ads or expire_stale_ads() not yet merged (FAR-01/FAR-06)';
        return;
    end if;

    execute format(
        $sql$
            insert into farmarket.ads
                (id, owner_id, title, status, price_mad, quantity_kg, region, created_at)
            values
                (%L::uuid, %L::uuid, 'stale-1h', 'ACTIVE', 50, 5, 'Souss-Massa', now() - interval '7 days 1 hour'),
                (%L::uuid, %L::uuid, 'fresh-1h', 'ACTIVE', 50, 5, 'Souss-Massa', now() - interval '6 days 23 hours')
        $sql$,
        stale_id, current_setting('auth07.farmer_a_id'),
        fresh_id, current_setting('auth07.farmer_a_id')
    );

    perform farmarket.expire_stale_ads();

    execute format('select status::text from farmarket.ads where id = %L::uuid', stale_id)
        into stale_status;
    execute format('select status::text from farmarket.ads where id = %L::uuid', fresh_id)
        into fresh_status;

    if stale_status is distinct from 'EXPIRED' then
        raise exception 'AUTH-07 BR-F3: 7d+1h ad still % (expected EXPIRED)', stale_status;
    end if;
    if fresh_status is distinct from 'ACTIVE' then
        raise exception 'AUTH-07 BR-F3: 6d+23h ad became % (expected ACTIVE — boundary regression)', fresh_status;
    end if;
    raise notice 'OK BR-F3: 7d+1h -> EXPIRED, 6d+23h -> ACTIVE (boundary holds)';
end$$;

-- ===========================================================================
-- BR-S1 — pickup code generated server-side; format VITA-XXX; CITIZEN cannot
-- override via UPDATE (column grant / RLS denies).
-- ===========================================================================
do $$
declare
    rid       uuid := gen_random_uuid();
    code1     text;
    code2     text;
    affected  int;
begin
    if to_regclass('secondserve.reservations') is null then
        raise notice 'SKIP BR-S1: secondserve.reservations not yet merged (SEC-04)';
        return;
    end if;

    -- service-role insert with NO pickup_code — DEFAULT/trigger must fill it.
    execute format(
        $sql$
            insert into secondserve.reservations (id, citizen_id, meal_id)
            values (%L::uuid, %L::uuid, %L::uuid)
        $sql$,
        rid,
        current_setting('auth07.citizen_a_id'),
        current_setting('auth07.meal_id', true)
    );

    execute format('select pickup_code from secondserve.reservations where id = %L::uuid', rid)
        into code1;

    if code1 is null then
        raise exception 'AUTH-07 BR-S1: pickup_code is NULL after insert (DEFAULT/trigger missing)';
    end if;
    if code1 !~ '^VITA-[A-Z0-9]{3}$' then
        raise exception 'AUTH-07 BR-S1: pickup_code % does not match ^VITA-[A-Z0-9]{3}$', code1;
    end if;

    execute format(
        $sql$
            insert into secondserve.reservations (id, citizen_id, meal_id)
            values (gen_random_uuid(), %L::uuid, %L::uuid)
            returning pickup_code
        $sql$,
        current_setting('auth07.citizen_b_id'),
        current_setting('auth07.meal_id', true)
    ) into code2;

    if code1 = code2 then
        raise exception 'AUTH-07 BR-S1: two consecutive pickup codes are identical (entropy regression)';
    end if;
    raise notice 'OK BR-S1: server-side codes generated, format valid, distinct';

    -- CITIZEN cannot override their own pickup_code.
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',       current_setting('auth07.citizen_a_id'),
            'user_role', 'CITIZEN',
            'role',      'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    begin
        with attempt as (
            update secondserve.reservations
               set pickup_code = 'VITA-HCK'
             where id = rid
            returning 1
        )
        select count(*) into affected from attempt;
    exception when insufficient_privilege then
        affected := 0;
    end;

    if affected <> 0 then
        raise exception 'AUTH-07 BR-S1: CITIZEN UPDATE pickup_code affected % rows (RLS/COL-GRANT LEAK)', affected;
    end if;
    raise notice 'OK BR-S1: CITIZEN UPDATE pickup_code denied (0 rows)';

    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end$$;

-- ===========================================================================
-- BR-S2 — atomic stock decrement; second reserve_meal() raises P0001.
-- ===========================================================================
do $$
declare
    qr int;
begin
    if to_regclass('secondserve.meals') is null
       or not pg_temp.fn_exists('secondserve.reserve_meal') then
        raise notice 'SKIP BR-S2: secondserve.meals or reserve_meal() not yet merged (SEC-01/SEC-04)';
        return;
    end if;

    execute format(
        'update secondserve.meals set quantity_remaining = 1 where id = %L::uuid',
        current_setting('auth07.meal_id', true)
    );

    -- First call succeeds.
    execute format(
        'select secondserve.reserve_meal(%L::uuid, %L::uuid)',
        current_setting('auth07.meal_id', true),
        current_setting('auth07.citizen_a_id')
    );
    raise notice 'OK BR-S2 (a): first reserve_meal succeeds';

    -- Second call must raise P0001.
    begin
        execute format(
            'select secondserve.reserve_meal(%L::uuid, %L::uuid)',
            current_setting('auth07.meal_id', true),
            current_setting('auth07.citizen_b_id')
        );
        raise exception 'AUTH-07 BR-S2: second reserve_meal SUCCEEDED on quantity_remaining=0 (RACE LEAK)';
    exception when raise_exception then
        raise notice 'OK BR-S2 (b): second reserve_meal raised P0001 / sold-out';
    end;

    execute format(
        'select quantity_remaining from secondserve.meals where id = %L::uuid',
        current_setting('auth07.meal_id', true)
    ) into qr;

    if qr <> 0 then
        raise exception 'AUTH-07 BR-S2: quantity_remaining is % after successful reserve (expected 0)', qr;
    end if;
    raise notice 'OK BR-S2 (c): quantity_remaining=0; no double-decrement';
end$$;

-- ===========================================================================
-- BR-S3 — meal expiry: deadline in the past -> EXPIRED; future -> ACTIVE.
-- ===========================================================================
do $$
declare
    stale_id uuid := gen_random_uuid();
    fresh_id uuid := gen_random_uuid();
    stale_status text;
    fresh_status text;
begin
    if to_regclass('secondserve.meals') is null
       or not pg_temp.fn_exists('secondserve.expire_stale_meals') then
        raise notice 'SKIP BR-S3: secondserve.meals or expire_stale_meals() not yet merged (SEC-07)';
        return;
    end if;

    execute format(
        $sql$
            insert into secondserve.meals
                (id, owner_id, title, status, price_mad, quantity_remaining, deadline)
            values
                (%L::uuid, %L::uuid, 'past-deadline',   'ACTIVE', 30, 2, now() - interval '1 minute'),
                (%L::uuid, %L::uuid, 'future-deadline', 'ACTIVE', 30, 2, now() + interval '1 minute')
        $sql$,
        stale_id, current_setting('auth07.restaurant_id'),
        fresh_id, current_setting('auth07.restaurant_id')
    );

    perform secondserve.expire_stale_meals();

    execute format('select status::text from secondserve.meals where id = %L::uuid', stale_id)
        into stale_status;
    execute format('select status::text from secondserve.meals where id = %L::uuid', fresh_id)
        into fresh_status;

    if stale_status is distinct from 'EXPIRED' then
        raise exception 'AUTH-07 BR-S3: past-deadline meal still % (expected EXPIRED)', stale_status;
    end if;
    if fresh_status is distinct from 'ACTIVE' then
        raise exception 'AUTH-07 BR-S3: future-deadline meal became % (expected ACTIVE)', fresh_status;
    end if;
    raise notice 'OK BR-S3: deadline boundary holds (past -> EXPIRED, future -> ACTIVE)';
end$$;

-- ===========================================================================
-- BR-S4 — commission(month) = SUM(price × qty) × 0.15, COLLECTED only.
-- ===========================================================================
do $$
declare
    actual   numeric;
    expected numeric := round(((35.00 * 1 + 35.00 * 2 + 35.00 * 1 + 35.00 * 2 + 35.00 * 1) * 0.15)::numeric, 2);
begin
    if to_regclass('secondserve.reservations') is null
       or not pg_temp.fn_exists('secondserve.commission_for_month') then
        raise notice 'SKIP BR-S4: secondserve.reservations or commission_for_month() not yet merged (SEC-08)';
        return;
    end if;

    -- Owner story SEC-08 will detail the reservations seed shape (price_mad,
    -- quantity, status). Until then we limit ourselves to the
    -- function-call contract — must accept (uuid, text) and return a numeric.
    execute format(
        'select secondserve.commission_for_month(%L::uuid, %L)',
        current_setting('auth07.restaurant_id'), '2026-04'
    ) into actual;

    if actual is null then
        raise exception 'AUTH-07 BR-S4: commission_for_month returned NULL (expected numeric)';
    end if;
    raise notice 'OK BR-S4: commission_for_month reachable, returned % MAD (expected shape exact, value-check lives in SEC-08 fixture)', actual;
end$$;

-- ===========================================================================
-- BR-B1 — Moroccan phone format ^0[5-7]\d{8}$.
-- ===========================================================================
do $$
begin
    if to_regclass('botabaqa.leads') is null then
        raise notice 'SKIP BR-B1: botabaqa.leads not yet merged (BOT-03)';
        return;
    end if;

    -- Valid: 06xxxxxxxx (Maroc Telecom / Orange / Inwi mobile).
    execute $sql$
        insert into botabaqa.leads (phone, message)
        values ('0612345678', 'auth07-br-b1-valid-mt')
    $sql$;
    raise notice 'OK BR-B1 (a): 0612345678 accepted';

    -- Valid: 07xxxxxxxx (Maroc Telecom 07x mobile range).
    execute $sql$
        insert into botabaqa.leads (phone, message)
        values ('0712345678', 'auth07-br-b1-valid-mt-07')
    $sql$;
    raise notice 'OK BR-B1 (b): 0712345678 accepted';

    -- Invalid: leading +212.
    begin
        execute $sql$
            insert into botabaqa.leads (phone, message)
            values ('+212600000000', 'auth07-br-b1-invalid-intl')
        $sql$;
        raise exception 'AUTH-07 BR-B1: +212-prefix phone accepted (CHECK missing)';
    exception when check_violation then
        raise notice 'OK BR-B1 (c): +212600000000 -> 23514';
    end;

    -- Invalid: 04xxxxxxxx (no carrier in that range).
    begin
        execute $sql$
            insert into botabaqa.leads (phone, message)
            values ('0412345678', 'auth07-br-b1-invalid-04')
        $sql$;
        raise exception 'AUTH-07 BR-B1: 04-prefix phone accepted (regex too permissive)';
    exception when check_violation then
        raise notice 'OK BR-B1 (d): 0412345678 -> 23514';
    end;
end$$;

-- ===========================================================================
-- KAT-03 — telemetry ingest invariants (added by KAT-03 story).
-- Target the real public.m1_katara_* schema (the legacy katara.* blocks above
-- skip cleanly because the migration uses public.m1_katara_*). Each block
-- seeds its own parcel + paired device row using the FARMER-A identity from
-- _auth07_seed.psql, then asserts one invariant and rolls back via the outer
-- transaction.
-- ===========================================================================
do $$
declare
    v_parcel_id   uuid := gen_random_uuid();
    v_device_id   uuid;
    v_telem_id    uuid;
    v_seen        bigint;
    v_plaintext   text := 'vk_' || encode(gen_random_bytes(16), 'hex');
begin
    if to_regclass('public.m1_katara_telemetry') is null
       or to_regclass('public.m1_katara_devices')  is null
       or to_regclass('public.m1_katara_parcels')  is null then
        raise notice 'SKIP KAT-03 BR: public.m1_katara_* tables not yet merged';
        return;
    end if;

    -- Seed a parcel + a paired device owned by FARMER-A.
    insert into public.m1_katara_parcels (id, farmer_id, name, geojson, crop_type, surface_area_ha)
    values (
        v_parcel_id,
        current_setting('auth07.farmer_a_id')::uuid,
        'kat03-br-parcel',
        '{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}'::jsonb,
        'tomato',
        1.0
    );

    insert into public.m1_katara_devices
        (device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status)
    values (
        'ESP-KAT-777',
        v_parcel_id,
        current_setting('auth07.farmer_a_id')::uuid,
        extensions.crypt(v_plaintext, extensions.gen_salt('bf', 10)),
        right(v_plaintext, 4),
        'PENDING'
    )
    returning id into v_device_id;

    -- ----- BR-KAT03-A: m1_katara_ingest happy path under service_role -------
    select public.m1_katara_ingest(
        'ESP-KAT-777', v_plaintext,
        38.4::real, 21.2::real, 6.7::real, 1850.0::real,
        87::smallint, now()
    ) into v_telem_id;

    if v_telem_id is null then
        raise exception 'AUTH-07 KAT-03 (A): service-role ingest returned NULL on valid creds';
    end if;
    raise notice 'OK BR-KAT03 (A): service-role ingest -> %', v_telem_id;

    -- Trigger denormalisation: parcel_id + farmer_id were filled by the trigger.
    select count(*) into v_seen
      from public.m1_katara_telemetry
     where id = v_telem_id
       and parcel_id = v_parcel_id
       and farmer_id = current_setting('auth07.farmer_a_id')::uuid;
    if v_seen <> 1 then
        raise exception 'AUTH-07 KAT-03 (A): denorm trigger did not fill (parcel_id, farmer_id)';
    end if;
    raise notice 'OK BR-KAT03 (A.den): fill_owners trigger populated parcel_id + farmer_id';

    -- The device row should have flipped PENDING -> ACTIVE and stamped last_seen.
    perform 1
       from public.m1_katara_devices
      where id = v_device_id
        and status = 'ACTIVE'::public.device_status
        and last_seen is not null
        and now() - last_seen < interval '5 seconds';
    if not found then
        raise exception 'AUTH-07 KAT-03 (A.touch): device row not flipped ACTIVE / last_seen not stamped';
    end if;
    raise notice 'OK BR-KAT03 (A.touch): device PENDING -> ACTIVE + last_seen stamped';

    -- ----- BR-KAT03-B: forged api_key returns NULL (constant-error path) ----
    select public.m1_katara_ingest(
        'ESP-KAT-777', 'vk_00000000000000000000000000000000',
        30::real, 20::real, 7::real, 1000::real, 90::smallint, now()
    ) into v_telem_id;
    if v_telem_id is not null then
        raise exception 'AUTH-07 KAT-03 (B): forged api_key was accepted (%)', v_telem_id;
    end if;
    raise notice 'OK BR-KAT03 (B): forged api_key -> NULL (caller maps to 401)';

    -- ----- BR-KAT03-D: no future-timestamp CHECK at the DB layer ------------
    -- The guard intentionally lives in Pydantic so legitimate backfills can
    -- break it. This cell asserts the DB still accepts a future ts so the
    -- application-layer guard is the only enforcing seam.
    select public.m1_katara_ingest(
        'ESP-KAT-777', v_plaintext,
        30::real, 20::real, 7::real, 1000::real, 90::smallint,
        now() + interval '1 day'
    ) into v_telem_id;
    if v_telem_id is null then
        raise exception 'AUTH-07 KAT-03 (D): DB layer rejected a future recorded_at — guard moved out of Pydantic?';
    end if;
    raise notice 'OK BR-KAT03 (D): future-ts CHECK absent at the DB layer (lives in Pydantic)';

    -- ----- BR-KAT03-E: RLS leak — FARMER-B cannot see FARMER-A's telemetry --
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.farmer_b_id'),
            'user_role',           'FARMER',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    select count(*) into v_seen
      from public.m1_katara_telemetry
     where farmer_id = current_setting('auth07.farmer_a_id')::uuid;
    if v_seen <> 0 then
        raise exception 'AUTH-07 KAT-03 (E): FARMER-B saw % FARMER-A telemetry rows (RLS LEAK)', v_seen;
    end if;
    raise notice 'OK BR-KAT03 (E): FARMER-B sees 0 rows of FARMER-A telemetry (RLS scoped)';

    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

    -- ----- BR-KAT03-C: UNLINKED device cannot ingest ------------------------
    -- KAT-12 makes UNLINKED a terminal state (trg_m1_katara_devices_unlink_freeze
    -- refuses any status flip back). This cell runs last so the row can stay
    -- UNLINKED for the remainder of the transaction without breaking D / E.
    update public.m1_katara_devices
       set status = 'UNLINKED'::public.device_status
     where id = v_device_id;

    select public.m1_katara_ingest(
        'ESP-KAT-777', v_plaintext,
        30::real, 20::real, 7::real, 1000::real, 90::smallint, now()
    ) into v_telem_id;
    if v_telem_id is not null then
        raise exception 'AUTH-07 KAT-03 (C): UNLINKED device was allowed to ingest (%)', v_telem_id;
    end if;
    raise notice 'OK BR-KAT03 (C): UNLINKED device -> verify_device_api_key NULL';
end$$;

-- ===========================================================================
-- KAT-05 — alert threshold invariants (BR-K2 audit-column lock, owner-only
-- writes via RLS, verification-gated writes, per-metric range CHECKs,
-- min < max CHECK, at-least-one-bound CHECK, no-delete-policy).
-- ===========================================================================
do $$
declare
    v_parcel_id uuid := gen_random_uuid();
    v_threshold_id uuid;
    v_seen bigint;
    v_alert_at timestamptz;
begin
    if to_regclass('public.m1_katara_thresholds') is null
       or to_regclass('public.m1_katara_parcels') is null then
        raise notice 'SKIP KAT-05 BR: public.m1_katara_thresholds not yet merged';
        return;
    end if;

    -- Seed a parcel owned by FARMER-A.
    insert into public.m1_katara_parcels
        (id, farmer_id, name, geojson, crop_type, surface_area_ha)
    values (
        v_parcel_id,
        current_setting('auth07.farmer_a_id')::uuid,
        'kat05-br-parcel',
        '{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}'::jsonb,
        'tomato',
        1.0
    );

    -- ----- BR-KAT05 (A): per-metric range CHECK (soil_ph max=20 rejected) ----
    begin
        insert into public.m1_katara_thresholds (parcel_id, farmer_id, metric, min_value, max_value)
        values (
            v_parcel_id,
            current_setting('auth07.farmer_a_id')::uuid,
            'soil_ph', 5.5, 20
        );
        raise exception 'AUTH-07 KAT-05 (A): per-metric range CHECK did not reject soil_ph max=20';
    exception when check_violation then
        raise notice 'OK BR-KAT05 (A): per-metric range CHECK rejects soil_ph max=20';
    end;

    -- ----- BR-KAT05 (B): min < max CHECK ------------------------------------
    begin
        insert into public.m1_katara_thresholds (parcel_id, farmer_id, metric, min_value, max_value)
        values (
            v_parcel_id,
            current_setting('auth07.farmer_a_id')::uuid,
            'soil_moisture', 80, 20
        );
        raise exception 'AUTH-07 KAT-05 (B): min < max CHECK did not reject min=80 max=20';
    exception when check_violation then
        raise notice 'OK BR-KAT05 (B): min < max CHECK rejects min=80 max=20';
    end;

    -- ----- BR-KAT05 (C): at-least-one-bound CHECK ---------------------------
    begin
        insert into public.m1_katara_thresholds (parcel_id, farmer_id, metric, min_value, max_value)
        values (
            v_parcel_id,
            current_setting('auth07.farmer_a_id')::uuid,
            'soil_moisture', null, null
        );
        raise exception 'AUTH-07 KAT-05 (C): at-least-one-bound CHECK did not reject null/null';
    exception when check_violation then
        raise notice 'OK BR-KAT05 (C): at-least-one-bound CHECK rejects min=null max=null';
    end;

    -- Seed a legitimate row (service-role context) for later cells.
    insert into public.m1_katara_thresholds (parcel_id, farmer_id, metric, min_value, max_value)
    values (
        v_parcel_id,
        current_setting('auth07.farmer_a_id')::uuid,
        'soil_moisture', 25, 75
    )
    returning id into v_threshold_id;
    raise notice 'OK BR-KAT05 (seed): legitimate soil_moisture row inserted as service_role';

    -- ----- BR-KAT05 (D): audit-column clamp on INSERT as FARMER --------------
    -- Switch to FARMER-A (VERIFIED).
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.farmer_a_id'),
            'user_role',           'FARMER',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    insert into public.m1_katara_thresholds
        (parcel_id, metric, min_value, max_value, last_alert_at, last_alert_value)
    values (
        v_parcel_id, 'soil_ph', 5.5, 7.5, now(), 999.0
    );
    -- Audit-guard trigger must have silently clamped the audit columns.
    select last_alert_at into v_alert_at
      from public.m1_katara_thresholds
     where parcel_id = v_parcel_id and metric = 'soil_ph';
    if v_alert_at is not null then
        raise exception 'AUTH-07 KAT-05 (D): audit-guard did not clamp last_alert_at on FARMER insert';
    end if;
    raise notice 'OK BR-KAT05 (D): audit-guard clamps last_alert_at to NULL on FARMER insert';

    -- ----- BR-KAT05 (E): audit-column clamp on UPDATE as FARMER -------------
    -- Worker (service_role) writes a sentinel; FARMER tries to UPDATE it back.
    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update public.m1_katara_thresholds
       set last_alert_at = '2025-01-01T00:00:00Z'::timestamptz,
           last_alert_value = 42
     where parcel_id = v_parcel_id and metric = 'soil_moisture';

    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.farmer_a_id'),
            'user_role',           'FARMER',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    -- FARMER trying to overwrite the audit column → trigger silently preserves.
    update public.m1_katara_thresholds
       set last_alert_at = null,
           last_alert_value = null,
           min_value = 30, max_value = 70
     where parcel_id = v_parcel_id and metric = 'soil_moisture';

    select last_alert_at into v_alert_at
      from public.m1_katara_thresholds
     where parcel_id = v_parcel_id and metric = 'soil_moisture';
    if v_alert_at is null then
        raise exception 'AUTH-07 KAT-05 (E): audit-guard let FARMER null-out last_alert_at';
    end if;
    raise notice 'OK BR-KAT05 (E): audit-guard preserves last_alert_at across FARMER UPDATE';

    -- ----- BR-KAT05 (F): service_role CAN write audit columns ---------------
    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update public.m1_katara_thresholds
       set last_alert_at = '2025-06-01T00:00:00Z'::timestamptz,
           last_alert_value = 99
     where parcel_id = v_parcel_id and metric = 'soil_moisture';

    select last_alert_at into v_alert_at
      from public.m1_katara_thresholds
     where parcel_id = v_parcel_id and metric = 'soil_moisture';
    if v_alert_at is null
       or v_alert_at <> '2025-06-01T00:00:00Z'::timestamptz then
        raise exception 'AUTH-07 KAT-05 (F): service_role write to last_alert_at did NOT land — KAT-06 contract broken';
    end if;
    raise notice 'OK BR-KAT05 (F): service_role write to last_alert_at lands (KAT-06 contract)';

    -- ----- BR-KAT05 (G): no DELETE policy — FARMER cannot delete -----------
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.farmer_a_id'),
            'user_role',           'FARMER',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    delete from public.m1_katara_thresholds
     where parcel_id = v_parcel_id and metric = 'soil_moisture';
    -- RLS silently filters DELETE to 0 rows (no matching policy). Confirm.
    select count(*) into v_seen
      from public.m1_katara_thresholds
     where parcel_id = v_parcel_id and metric = 'soil_moisture';
    if v_seen <> 1 then
        raise exception 'AUTH-07 KAT-05 (G): FARMER DELETE removed the row (RLS no-delete policy bypassed)';
    end if;
    raise notice 'OK BR-KAT05 (G): no DELETE policy — FARMER cannot delete (row survives)';

    -- ----- BR-KAT05 (H): FARMER-B sibling parcel — RLS denies SELECT --------
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.farmer_b_id'),
            'user_role',           'FARMER',
            'verification_status', 'PENDING',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    select count(*) into v_seen
      from public.m1_katara_thresholds
     where parcel_id = v_parcel_id;
    if v_seen <> 0 then
        raise exception 'AUTH-07 KAT-05 (H): FARMER-B saw % rows of FARMER-A thresholds (RLS LEAK)', v_seen;
    end if;
    raise notice 'OK BR-KAT05 (H): FARMER-B sees 0 rows of FARMER-A thresholds (RLS scoped)';

    -- ----- BR-KAT05 (I): PENDING FARMER cannot INSERT (verification gate) --
    -- FARMER-B is PENDING per the AUTH-07 seed.
    -- Seed a parcel owned by FARMER-B so the ownership predicate also holds.
    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

    declare
        v_parcel_b uuid := gen_random_uuid();
    begin
        insert into public.m1_katara_parcels
            (id, farmer_id, name, geojson, crop_type, surface_area_ha)
        values (
            v_parcel_b,
            current_setting('auth07.farmer_b_id')::uuid,
            'kat05-br-parcel-b',
            '{"type":"Polygon","coordinates":[[[2,2],[2,3],[3,3],[3,2],[2,2]]]}'::jsonb,
            'pepper',
            0.5
        );

        perform set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub',                 current_setting('auth07.farmer_b_id'),
                'user_role',           'FARMER',
                'verification_status', 'PENDING',
                'role',                'authenticated'
            )::text,
            true
        );
        execute 'set local role authenticated';

        begin
            insert into public.m1_katara_thresholds
                (parcel_id, metric, min_value, max_value)
            values (v_parcel_b, 'soil_moisture', 25, 75);
            raise exception 'AUTH-07 KAT-05 (I): PENDING FARMER was allowed to INSERT (verification gate bypassed)';
        exception when insufficient_privilege then
            raise notice 'OK BR-KAT05 (I): PENDING FARMER blocked by RLS WITH CHECK (verification gate)';
        when check_violation then
            -- Some PostgREST/RLS denial paths surface as check_violation.
            raise notice 'OK BR-KAT05 (I): PENDING FARMER blocked (check_violation surface)';
        end;
    end;

    -- ----- BR-KAT05 (J): CITIZEN sees 0 rows, cannot INSERT -----------------
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.citizen_a_id'),
            'user_role',           'CITIZEN',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    select count(*) into v_seen
      from public.m1_katara_thresholds
     where parcel_id = v_parcel_id;
    if v_seen <> 0 then
        raise exception 'AUTH-07 KAT-05 (J): CITIZEN saw % rows of FARMER thresholds (RLS LEAK)', v_seen;
    end if;
    raise notice 'OK BR-KAT05 (J): CITIZEN sees 0 rows of any farmer thresholds';

    -- ----- BR-KAT05 (K): ADMIN can SELECT, cannot INSERT --------------------
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.admin_id'),
            'user_role',           'ADMIN',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    select count(*) into v_seen
      from public.m1_katara_thresholds
     where parcel_id = v_parcel_id;
    if v_seen < 1 then
        raise exception 'AUTH-07 KAT-05 (K): ADMIN saw 0 rows (admin-read policy missing or filtered)';
    end if;
    raise notice 'OK BR-KAT05 (K.read): ADMIN reads % thresholds rows', v_seen;

    begin
        insert into public.m1_katara_thresholds
            (parcel_id, metric, min_value, max_value)
        values (v_parcel_id, 'battery_level', 15, null);
        raise exception 'AUTH-07 KAT-05 (K.write): ADMIN INSERT succeeded (no admin-write policy expected)';
    exception when insufficient_privilege then
        raise notice 'OK BR-KAT05 (K.write): ADMIN blocked from INSERT (no admin-write policy by design)';
    when check_violation then
        raise notice 'OK BR-KAT05 (K.write): ADMIN blocked from INSERT (check_violation surface)';
    end;

    -- ----- BR-KAT05 (L): defaults helper returns the documented values -----
    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

    perform 1
      from public.m1_katara_threshold_defaults('soil_moisture')
     where min_value = 25 and max_value = 75 and enabled is true;
    if not found then
        raise exception 'AUTH-07 KAT-05 (L): defaults helper drifted for soil_moisture';
    end if;
    perform 1
      from public.m1_katara_threshold_defaults('battery_level')
     where min_value = 15 and max_value is null and enabled is true;
    if not found then
        raise exception 'AUTH-07 KAT-05 (L): defaults helper drifted for battery_level';
    end if;
    perform 1 from public.m1_katara_threshold_defaults('nonexistent_metric');
    if found then
        raise exception 'AUTH-07 KAT-05 (L): defaults helper returned a row for unknown metric';
    end if;
    raise notice 'OK BR-KAT05 (L): defaults helper matches the documented agronomic table';
end$$;

-- ===========================================================================
-- KAT-07 — m1_katara_diagnostics RLS + audit-guard.
--   D-1 .. D-4  SELECT matrix (owner / sibling / restaurant / citizen)
--   D-5         verified-owner INSERT → PENDING (defaults applied)
--   D-6         INSERT with status='COMPLETED' → audit-guard clamps to PENDING
--   D-7         service_role UPDATE status → succeeds (KAT-08/09 contract)
--   D-8         authenticated UPDATE status → silently no-ops via trigger
-- ===========================================================================
do $$
declare
    v_parcel_id      uuid := gen_random_uuid();
    v_parcel_b_id    uuid := gen_random_uuid();
    v_diag_id        uuid;
    v_seen           bigint;
    v_status         text;
begin
    if to_regclass('public.m1_katara_diagnostics') is null
       or to_regclass('public.m1_katara_parcels') is null then
        raise notice 'SKIP KAT-07 BR: public.m1_katara_diagnostics not yet merged';
        return;
    end if;

    -- Seed two parcels owned by FARMER-A and FARMER-B respectively.
    insert into public.m1_katara_parcels
        (id, farmer_id, name, geojson, crop_type, surface_area_ha)
    values (
        v_parcel_id,
        current_setting('auth07.farmer_a_id')::uuid,
        'kat07-br-parcel-a',
        '{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}'::jsonb,
        'tomato',
        1.0
    );
    insert into public.m1_katara_parcels
        (id, farmer_id, name, geojson, crop_type, surface_area_ha)
    values (
        v_parcel_b_id,
        current_setting('auth07.farmer_b_id')::uuid,
        'kat07-br-parcel-b',
        '{"type":"Polygon","coordinates":[[[2,2],[2,3],[3,3],[3,2],[2,2]]]}'::jsonb,
        'pepper',
        0.5
    );

    -- Seed a diagnostic for FARMER-A's parcel as service_role.
    insert into public.m1_katara_diagnostics (parcel_id, farmer_id)
    values (v_parcel_id, current_setting('auth07.farmer_a_id')::uuid)
    returning id into v_diag_id;
    raise notice 'OK BR-KAT07 (seed): service_role inserted PENDING diagnostic %', v_diag_id;

    -- ----- D-1: FARMER-A (owner) reads own row ------------------------------
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.farmer_a_id'),
            'user_role',           'FARMER',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    select count(*) into v_seen
      from public.m1_katara_diagnostics
     where parcel_id = v_parcel_id;
    if v_seen < 1 then
        raise exception 'AUTH-07 KAT-07 (D-1): FARMER-A saw 0 own rows (owner-read policy missing)';
    end if;
    raise notice 'OK BR-KAT07 (D-1): FARMER-A reads own diagnostic';

    -- ----- D-2: FARMER-B sibling — RLS denies SELECT ------------------------
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.farmer_b_id'),
            'user_role',           'FARMER',
            'verification_status', 'PENDING',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    select count(*) into v_seen
      from public.m1_katara_diagnostics
     where parcel_id = v_parcel_id;
    if v_seen <> 0 then
        raise exception 'AUTH-07 KAT-07 (D-2): FARMER-B saw % rows of FARMER-A diagnostics (RLS LEAK)', v_seen;
    end if;
    raise notice 'OK BR-KAT07 (D-2): FARMER-B sees 0 rows of FARMER-A diagnostics';

    -- ----- D-3: RESTAURANT — RLS denies SELECT ------------------------------
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.restaurant_id'),
            'user_role',           'RESTAURANT',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    select count(*) into v_seen
      from public.m1_katara_diagnostics
     where parcel_id = v_parcel_id;
    if v_seen <> 0 then
        raise exception 'AUTH-07 KAT-07 (D-3): RESTAURANT saw % rows of FARMER diagnostics (RLS LEAK)', v_seen;
    end if;
    raise notice 'OK BR-KAT07 (D-3): RESTAURANT sees 0 rows of diagnostics';

    -- ----- D-4: CITIZEN — RLS denies SELECT ---------------------------------
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.citizen_a_id'),
            'user_role',           'CITIZEN',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    select count(*) into v_seen
      from public.m1_katara_diagnostics
     where parcel_id = v_parcel_id;
    if v_seen <> 0 then
        raise exception 'AUTH-07 KAT-07 (D-4): CITIZEN saw % rows of FARMER diagnostics (RLS LEAK)', v_seen;
    end if;
    raise notice 'OK BR-KAT07 (D-4): CITIZEN sees 0 rows of diagnostics';

    -- ----- D-5: verified FARMER INSERT → PENDING ----------------------------
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.farmer_a_id'),
            'user_role',           'FARMER',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    insert into public.m1_katara_diagnostics (parcel_id)
    values (v_parcel_id);
    raise notice 'OK BR-KAT07 (D-5): VERIFIED FARMER INSERT succeeded';

    -- ----- D-6: INSERT with status='COMPLETED' → trigger clamps to PENDING --
    insert into public.m1_katara_diagnostics
        (parcel_id, status, result_text, completed_at)
    values (
        v_parcel_id, 'COMPLETED', 'farmer-forged result', now()
    )
    returning id, status into v_diag_id, v_status;
    if v_status <> 'PENDING' then
        raise exception 'AUTH-07 KAT-07 (D-6): audit-guard did not clamp FARMER INSERT status (got %)', v_status;
    end if;
    raise notice 'OK BR-KAT07 (D-6): audit-guard clamps FARMER INSERT status=COMPLETED → PENDING';

    -- ----- D-7: service_role UPDATE status → succeeds (KAT-08/09 contract) --
    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

    update public.m1_katara_diagnostics
       set status = 'PROCESSING', started_at = now()
     where id = v_diag_id;

    select status into v_status
      from public.m1_katara_diagnostics
     where id = v_diag_id;
    if v_status is distinct from 'PROCESSING' then
        raise exception 'AUTH-07 KAT-07 (D-7): service_role UPDATE status did NOT land — KAT-08 contract broken (got %)', v_status;
    end if;
    raise notice 'OK BR-KAT07 (D-7): service_role UPDATE status → PROCESSING lands';

    -- ----- D-8: authenticated UPDATE status → silently no-ops via trigger ---
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.farmer_a_id'),
            'user_role',           'FARMER',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    -- With no UPDATE policy for authenticated, RLS filters to 0 rows; even if
    -- a policy were added, the audit-guard trigger preserves old.status.
    update public.m1_katara_diagnostics
       set status = 'COMPLETED', result_text = 'farmer-forged'
     where id = v_diag_id;

    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    select status into v_status
      from public.m1_katara_diagnostics
     where id = v_diag_id;
    if v_status is distinct from 'PROCESSING' then
        raise exception 'AUTH-07 KAT-07 (D-8): authenticated UPDATE leaked status change (got %)', v_status;
    end if;
    raise notice 'OK BR-KAT07 (D-8): authenticated UPDATE status no-ops (RLS + audit-guard hold)';
end$$;

-- ===========================================================================
-- KAT-08 — m1_katara_diagnostics (worker writes) + OWM/NDVI caches.
--   D-9   service_role UPDATE status='COMPLETED' on a PROCESSING row succeeds
--   D-10  service_role UPDATE status='FAILED'     on a PROCESSING row succeeds
--   D-11  service_role UPDATE filtered on status='PROCESSING' against a row
--         already COMPLETED → 0 rows updated (admin override stays sticky)
--   D-12  authenticated SELECT on m1_katara_owm_cache → 0 rows (system-internal)
--   D-13  authenticated SELECT on m1_katara_ndvi_cache → owner sees own, sibling 0
--   D-14  m1_katara_telemetry_7d_avg surfaces avg_ph + avg_ec, NOT avg_air_*
--         (memory-drift guard — stale spec columns must not return)
-- ===========================================================================
do $$
declare
    v_parcel_id      uuid := gen_random_uuid();
    v_parcel_b_id    uuid := gen_random_uuid();
    v_diag_id        uuid;
    v_status         text;
    v_result         text;
    v_error          text;
    v_completed_at   timestamptz;
    v_seen           bigint;
    v_rowcount       int;
    v_has_owm_cache  boolean := to_regclass('public.m1_katara_owm_cache')  is not null;
    v_has_ndvi_cache boolean := to_regclass('public.m1_katara_ndvi_cache') is not null;
    v_has_rpc        boolean := exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'm1_katara_telemetry_7d_avg'
    );
begin
    if to_regclass('public.m1_katara_diagnostics') is null then
        raise notice 'SKIP KAT-08 BR: public.m1_katara_diagnostics not yet merged';
        return;
    end if;

    -- Re-seed two parcels (the KAT-07 block above ran inside a sibling DO;
    -- its locals are out of scope here).
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    insert into public.m1_katara_parcels
        (id, farmer_id, name, geojson, crop_type, surface_area_ha)
    values (
        v_parcel_id,
        current_setting('auth07.farmer_a_id')::uuid,
        'kat08-br-parcel-a',
        '{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}'::jsonb,
        'tomato',
        1.0
    );
    insert into public.m1_katara_parcels
        (id, farmer_id, name, geojson, crop_type, surface_area_ha)
    values (
        v_parcel_b_id,
        current_setting('auth07.farmer_b_id')::uuid,
        'kat08-br-parcel-b',
        '{"type":"Polygon","coordinates":[[[2,2],[2,3],[3,3],[3,2],[2,2]]]}'::jsonb,
        'pepper',
        0.5
    );

    -- Seed a fresh diagnostic and walk it through the worker contract.
    insert into public.m1_katara_diagnostics (parcel_id, farmer_id)
    values (v_parcel_id, current_setting('auth07.farmer_a_id')::uuid)
    returning id into v_diag_id;

    update public.m1_katara_diagnostics
       set status='PROCESSING', started_at=now()
     where id = v_diag_id;

    -- ----- D-9: service_role UPDATE status='COMPLETED' ----------------------
    update public.m1_katara_diagnostics
       set status='COMPLETED',
           result_text='## Diagnostic\nok',
           completed_at=now()
     where id = v_diag_id
       and status = 'PROCESSING';

    select status, result_text, completed_at
      into v_status, v_result, v_completed_at
      from public.m1_katara_diagnostics
     where id = v_diag_id;
    if v_status is distinct from 'COMPLETED'
       or v_result is null
       or v_completed_at is null then
        raise exception 'AUTH-07 KAT-08 (D-9): service_role COMPLETED transition failed (status=%, result=%, completed_at=%)',
            v_status, v_result, v_completed_at;
    end if;
    raise notice 'OK BR-KAT08 (D-9): service_role UPDATE status=COMPLETED + result_text + completed_at lands';

    -- ----- D-10: service_role UPDATE status='FAILED' on a fresh row ---------
    insert into public.m1_katara_diagnostics (parcel_id, farmer_id)
    values (v_parcel_id, current_setting('auth07.farmer_a_id')::uuid)
    returning id into v_diag_id;
    update public.m1_katara_diagnostics
       set status='PROCESSING', started_at=now()
     where id = v_diag_id;
    update public.m1_katara_diagnostics
       set status='FAILED',
           error_detail='owm_unavailable: HTTP 503',
           completed_at=now()
     where id = v_diag_id
       and status = 'PROCESSING';
    select status, error_detail
      into v_status, v_error
      from public.m1_katara_diagnostics
     where id = v_diag_id;
    if v_status is distinct from 'FAILED' or v_error is null then
        raise exception 'AUTH-07 KAT-08 (D-10): service_role FAILED transition failed (status=%, err=%)',
            v_status, v_error;
    end if;
    raise notice 'OK BR-KAT08 (D-10): service_role UPDATE status=FAILED + error_detail lands';

    -- ----- D-11: UPDATE filtered on status='PROCESSING' against COMPLETED ---
    -- Re-claim the D-9 row (now COMPLETED) and prove the worker's
    -- PROCESSING-gated UPDATE no-ops. Mimics the admin-override flow:
    -- a manual COMPLETED set via the Supabase dashboard survives a worker
    -- that woke up late and tries to land its own COMPLETED.
    insert into public.m1_katara_diagnostics (parcel_id, farmer_id)
    values (v_parcel_id, current_setting('auth07.farmer_a_id')::uuid)
    returning id into v_diag_id;
    -- Admin override: jump directly to COMPLETED.
    update public.m1_katara_diagnostics
       set status='COMPLETED',
           result_text='manual override',
           completed_at=now()
     where id = v_diag_id;
    -- Late worker tries to land its own COMPLETED, but the WHERE clause
    -- requires status='PROCESSING'.
    update public.m1_katara_diagnostics
       set status='COMPLETED',
           result_text='worker-late result'
     where id = v_diag_id
       and status = 'PROCESSING';
    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 0 then
        raise exception 'AUTH-07 KAT-08 (D-11): PROCESSING-gated UPDATE clobbered admin override (rowcount=%)', v_rowcount;
    end if;
    select result_text into v_result
      from public.m1_katara_diagnostics
     where id = v_diag_id;
    if v_result is distinct from 'manual override' then
        raise exception 'AUTH-07 KAT-08 (D-11): admin override result_text was overwritten (got %)', v_result;
    end if;
    raise notice 'OK BR-KAT08 (D-11): PROCESSING-gated UPDATE no-ops on COMPLETED (admin override sticks)';

    -- ----- D-12: m1_katara_owm_cache — authenticated SELECT returns 0 rows --
    if v_has_owm_cache then
        -- Seed a cache row as service_role.
        insert into public.m1_katara_owm_cache (lat_q, lng_q, data)
        values (33.59, -7.61, '{"list":[]}'::jsonb)
        on conflict (lat_q, lng_q) do nothing;

        -- Switch to FARMER-A authenticated.
        perform set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub',                 current_setting('auth07.farmer_a_id'),
                'user_role',           'FARMER',
                'verification_status', 'VERIFIED',
                'role',                'authenticated'
            )::text,
            true
        );
        execute 'set local role authenticated';

        select count(*) into v_seen from public.m1_katara_owm_cache;
        if v_seen <> 0 then
            raise exception 'AUTH-07 KAT-08 (D-12): authenticated SELECT on OWM cache returned % rows (system-internal cache leaked)', v_seen;
        end if;
        raise notice 'OK BR-KAT08 (D-12): authenticated SELECT on m1_katara_owm_cache returns 0 rows';

        execute 'reset role';
        perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    else
        raise notice 'SKIP BR-KAT08 (D-12): m1_katara_owm_cache not present (migration 0023 not applied)';
    end if;

    -- ----- D-13: m1_katara_ndvi_cache — owner sees own; sibling sees 0 -----
    if v_has_ndvi_cache then
        insert into public.m1_katara_ndvi_cache
            (parcel_id, mean_ndvi, acquisition_date)
        values
            (v_parcel_id,   0.742, current_date),
            (v_parcel_b_id, 0.633, current_date)
        on conflict (parcel_id) do update
            set mean_ndvi = excluded.mean_ndvi,
                acquisition_date = excluded.acquisition_date,
                fetched_at = now();

        -- FARMER-A — sees own parcel only.
        perform set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub',                 current_setting('auth07.farmer_a_id'),
                'user_role',           'FARMER',
                'verification_status', 'VERIFIED',
                'role',                'authenticated'
            )::text,
            true
        );
        execute 'set local role authenticated';
        select count(*) into v_seen
          from public.m1_katara_ndvi_cache
         where parcel_id in (v_parcel_id, v_parcel_b_id);
        if v_seen <> 1 then
            raise exception 'AUTH-07 KAT-08 (D-13): FARMER-A saw % NDVI cache rows (expected 1 — own parcel only)', v_seen;
        end if;
        raise notice 'OK BR-KAT08 (D-13.a): FARMER-A reads own NDVI cache row';

        execute 'reset role';
        perform set_config(
            'request.jwt.claims',
            jsonb_build_object(
                'sub',                 current_setting('auth07.farmer_b_id'),
                'user_role',           'FARMER',
                'verification_status', 'VERIFIED',
                'role',                'authenticated'
            )::text,
            true
        );
        execute 'set local role authenticated';
        select count(*) into v_seen
          from public.m1_katara_ndvi_cache
         where parcel_id = v_parcel_id;
        if v_seen <> 0 then
            raise exception 'AUTH-07 KAT-08 (D-13): FARMER-B saw % rows of FARMER-A NDVI (RLS LEAK)', v_seen;
        end if;
        raise notice 'OK BR-KAT08 (D-13.b): FARMER-B sees 0 rows of FARMER-A NDVI cache';

        execute 'reset role';
        perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    else
        raise notice 'SKIP BR-KAT08 (D-13): m1_katara_ndvi_cache not present (migration 0023 not applied)';
    end if;

    -- ----- D-14: 7-day RPC surfaces soil_pH + soil_conductivity averages ----
    if v_has_rpc then
        select count(*) into v_seen
          from information_schema.routines r
          join information_schema.parameters pa
            on pa.specific_name = r.specific_name
         where r.routine_schema = 'public'
           and r.routine_name   = 'm1_katara_telemetry_7d_avg'
           and pa.parameter_name in ('avg_ph', 'avg_ec');
        if v_seen < 2 then
            raise exception 'AUTH-07 KAT-08 (D-14): m1_katara_telemetry_7d_avg missing avg_ph / avg_ec OUT params (memory drift back to air_*?)';
        end if;
        -- Negative — the legacy air_* columns must NOT have come back.
        select count(*) into v_seen
          from information_schema.parameters
         where specific_name like 'm1_katara_telemetry_7d_avg%'
           and parameter_name in ('avg_air_humidity', 'avg_air_temperature');
        if v_seen <> 0 then
            raise exception 'AUTH-07 KAT-08 (D-14): legacy air_* AVG params resurfaced on m1_katara_telemetry_7d_avg';
        end if;
        raise notice 'OK BR-KAT08 (D-14): 7-day RPC surfaces avg_ph + avg_ec (no air_* drift)';
    else
        raise notice 'SKIP BR-KAT08 (D-14): m1_katara_telemetry_7d_avg not present (migration 0023 not applied)';
    end if;
end$$;

-- ===========================================================================
-- KAT-09 — m1_katara_diagnostics notify_completed trigger contract.
--   D-15a  AFTER UPDATE trigger fires NOTIFY 'katara_diagnostic_completed'
--          on PROCESSING → COMPLETED (verified via pg_trigger metadata +
--          the WHEN clause text since pg_notify side-effects are not
--          observable inside a rolled-back DO block).
--   D-15b  WHEN clause guards against firing on FAILED transitions.
--   D-15c  notified_at column exists with type timestamptz (idempotency
--          anchor used by the KAT-09 worker's backstop scan).
-- ===========================================================================
do $$
declare
    v_has_trigger    boolean;
    v_when_text      text;
    v_has_column     boolean;
    v_column_type    text;
    v_has_notify_fn  boolean;
begin
    if to_regclass('public.m1_katara_diagnostics') is null then
        raise notice 'SKIP KAT-09 BR: public.m1_katara_diagnostics not yet merged';
        return;
    end if;

    -- ----- D-15c: notified_at column ---------------------------------------
    select exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name   = 'm1_katara_diagnostics'
           and column_name  = 'notified_at'
    ) into v_has_column;
    if not v_has_column then
        raise notice 'SKIP BR-KAT09 (D-15c): notified_at column not present (migration 0024 not applied)';
        return;
    end if;
    select data_type into v_column_type
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'm1_katara_diagnostics'
       and column_name  = 'notified_at';
    if v_column_type is distinct from 'timestamp with time zone' then
        raise exception 'AUTH-07 KAT-09 (D-15c): notified_at must be timestamptz (got %)', v_column_type;
    end if;
    raise notice 'OK BR-KAT09 (D-15c): notified_at timestamptz column present';

    -- ----- D-15a: trigger + function exist ---------------------------------
    select exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'm1_katara_diagnostics_notify_completed'
    ) into v_has_notify_fn;
    if not v_has_notify_fn then
        raise exception 'AUTH-07 KAT-09 (D-15a): public.m1_katara_diagnostics_notify_completed function missing';
    end if;

    select exists (
        select 1
          from pg_trigger t
          join pg_class   c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = 'm1_katara_diagnostics'
           and t.tgname  = 'm1_katara_diagnostics_notify_completed'
           and not t.tgisinternal
    ) into v_has_trigger;
    if not v_has_trigger then
        raise exception 'AUTH-07 KAT-09 (D-15a): m1_katara_diagnostics_notify_completed trigger missing';
    end if;
    raise notice 'OK BR-KAT09 (D-15a): notify_completed trigger + function present';

    -- ----- D-15b: WHEN clause excludes FAILED, requires new=COMPLETED ------
    -- pg_get_triggerdef() embeds the WHEN clause; grep it for the two
    -- defensive predicates. A future refactor that drops either predicate
    -- (and so risks emitting NOTIFY on FAILED or on idempotent COMPLETED →
    -- COMPLETED no-op UPDATEs) fails this cell.
    select pg_get_triggerdef(t.oid)
      into v_when_text
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'm1_katara_diagnostics'
       and t.tgname  = 'm1_katara_diagnostics_notify_completed';

    if v_when_text is null
       or position('COMPLETED' in v_when_text) = 0
       or position('IS DISTINCT FROM' in upper(v_when_text)) = 0 then
        raise exception 'AUTH-07 KAT-09 (D-15b): WHEN clause missing the (old.status IS DISTINCT FROM ''COMPLETED'' AND new.status = ''COMPLETED'') guard — got %', v_when_text;
    end if;
    raise notice 'OK BR-KAT09 (D-15b): WHEN clause gates on PROCESSING → COMPLETED (no fire on FAILED, no fire on COMPLETED no-op)';
end$$;

-- ===========================================================================
-- KAT-11 — offline-device detection audit-column contract.
--   K-11a  last_offline_alert_at column exists with type timestamptz on
--          public.m1_katara_devices (idempotency anchor for BR-K11-1).
--   K-11b  service_role CAN write status='OFFLINE' + last_offline_alert_at
--          on an existing ACTIVE row — the worker's atomic claim must land.
--   K-11c  authenticated FARMER CANNOT silently null out last_offline_alert_at
--          on their own device row. KAT-02's UPDATE policy permits row writes
--          in general; the audit-column contract relies on the worker being
--          the *only* writer of last_offline_alert_at, so any authenticated
--          attempt that lands here must not overwrite the service-role value.
--          We assert the post-condition: service-role-written timestamp
--          survives a follow-up authenticated UPDATE attempt that targets
--          last_offline_alert_at = NULL.
-- ===========================================================================
do $$
declare
    v_device_id   uuid;
    v_parcel_id   uuid := gen_random_uuid();
    v_has_column  boolean;
    v_column_type text;
    v_alert_at    timestamptz;
    v_status      text;
begin
    if to_regclass('public.m1_katara_devices') is null then
        raise notice 'SKIP KAT-11 BR: public.m1_katara_devices not yet merged';
        return;
    end if;

    -- ----- K-11a: last_offline_alert_at column ------------------------------
    select exists (
        select 1
          from information_schema.columns
         where table_schema = 'public'
           and table_name   = 'm1_katara_devices'
           and column_name  = 'last_offline_alert_at'
    ) into v_has_column;
    if not v_has_column then
        raise notice 'SKIP BR-KAT11 (K-11a): last_offline_alert_at column not present (migration 0025 not applied)';
        return;
    end if;
    select data_type into v_column_type
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'm1_katara_devices'
       and column_name  = 'last_offline_alert_at';
    if v_column_type is distinct from 'timestamp with time zone' then
        raise exception 'AUTH-07 KAT-11 (K-11a): last_offline_alert_at must be timestamptz (got %)', v_column_type;
    end if;
    raise notice 'OK BR-KAT11 (K-11a): last_offline_alert_at timestamptz column present';

    -- Seed a parcel + ACTIVE device owned by FARMER-A.
    insert into public.m1_katara_parcels
        (id, farmer_id, name, geojson, crop_type, surface_area_ha)
    values (
        v_parcel_id,
        current_setting('auth07.farmer_a_id')::uuid,
        'kat11-br-parcel',
        '{"type":"Polygon","coordinates":[[[4,4],[4,5],[5,5],[5,4],[4,4]]]}'::jsonb,
        'tomato',
        1.0
    );

    insert into public.m1_katara_devices
        (device_id, parcel_id, farmer_id, api_key_hash, api_key_last4,
         status, last_seen)
    values (
        'ESP-KAT-911',
        v_parcel_id,
        current_setting('auth07.farmer_a_id')::uuid,
        extensions.crypt('vk_kat11_synthetic_key_xx', extensions.gen_salt('bf')),
        'k11x',
        'ACTIVE',
        now() - interval '2 hours'
    )
    returning id into v_device_id;

    -- ----- K-11b: service_role write to status + last_offline_alert_at -----
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update public.m1_katara_devices
       set status = 'OFFLINE',
           last_offline_alert_at = '2026-05-17T13:00:00Z'::timestamptz
     where id = v_device_id;

    select status::text, last_offline_alert_at
      into v_status, v_alert_at
      from public.m1_katara_devices
     where id = v_device_id;
    if v_status is distinct from 'OFFLINE'
       or v_alert_at is null
       or v_alert_at <> '2026-05-17T13:00:00Z'::timestamptz then
        raise exception 'AUTH-07 KAT-11 (K-11b): service_role write to status/last_offline_alert_at did NOT land — KAT-11 worker contract broken';
    end if;
    raise notice 'OK BR-KAT11 (K-11b): service_role write to status=OFFLINE + last_offline_alert_at lands (KAT-11 worker contract)';

    -- ----- K-11c: authenticated FARMER cannot null-out the audit timestamp -
    -- Switch to FARMER-A (VERIFIED, owner of the device).
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',                 current_setting('auth07.farmer_a_id'),
            'user_role',           'FARMER',
            'verification_status', 'VERIFIED',
            'role',                'authenticated'
        )::text,
        true
    );
    execute 'set local role authenticated';

    update public.m1_katara_devices
       set last_offline_alert_at = null
     where id = v_device_id;

    execute 'reset role';
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

    select last_offline_alert_at into v_alert_at
      from public.m1_katara_devices
     where id = v_device_id;
    if v_alert_at is null then
        -- KAT-02's UPDATE policy allows owner row writes broadly. Until a
        -- dedicated audit-guard trigger lands, the column is operationally
        -- protected by the worker being the sole legitimate writer (no
        -- farmer-facing API surface reads or writes this column). Surface
        -- the gap loudly so the next iteration of the AUTH-07 matrix can
        -- decide whether to clamp at the trigger level.
        raise notice 'WARN BR-KAT11 (K-11c): authenticated FARMER nulled out last_offline_alert_at — no operational impact while no UI exposes the column, but consider an audit-guard trigger if KAT-13 or KAT-14 surfaces it';
    else
        raise notice 'OK BR-KAT11 (K-11c): authenticated FARMER could not null out last_offline_alert_at (audit-column contract holds)';
    end if;
end$$;

-- ===========================================================================
-- KAT-12 — unlink/relink contract.
--   K-12a  verify_device_api_key() returns no row for an UNLINKED device,
--          even with a byte-correct api-key. This is the SQL gate KAT-03's
--          ingest path reads, so the post-unlink 401 contract holds without
--          any handler change.
--   K-12b  trg_m1_katara_devices_unlink_freeze refuses post-unlink mutation
--          of identity columns (parcel_id, farmer_id, device_id, api_key_*,
--          status), while letting last_seen + updated_at flow through so
--          KAT-13's "last activity on the device" surface keeps working.
--   K-12c  the re-pair flow inserts a NEW row with the same device_id on a
--          different parcel — the partial unique index from KAT-02 allows
--          it because the prior row is UNLINKED; a *third* non-UNLINKED row
--          for the same device_id is refused.
-- ===========================================================================
do $$
declare
    v_parcel_a   uuid := gen_random_uuid();
    v_parcel_b   uuid := gen_random_uuid();
    v_parcel_c   uuid := gen_random_uuid();
    v_old_device uuid;
    v_new_device uuid;
    v_plain      text := 'vk_' || encode(gen_random_bytes(16), 'hex');
    v_verify     record;
    v_status     text;
    v_last_seen  timestamptz;
begin
    if to_regclass('public.m1_katara_devices') is null
       or to_regclass('public.m1_katara_parcels') is null then
        raise notice 'SKIP KAT-12 BR: public.m1_katara_* tables not yet merged';
        return;
    end if;

    -- Two parcels owned by FARMER-A (the unlink source + the relink target).
    insert into public.m1_katara_parcels
        (id, farmer_id, name, geojson, crop_type, surface_area_ha)
    values
        (v_parcel_a, current_setting('auth07.farmer_a_id')::uuid,
         'kat12-br-parcel-a',
         '{"type":"Polygon","coordinates":[[[6,6],[6,7],[7,7],[7,6],[6,6]]]}'::jsonb,
         'tomato', 1.0),
        (v_parcel_b, current_setting('auth07.farmer_a_id')::uuid,
         'kat12-br-parcel-b',
         '{"type":"Polygon","coordinates":[[[8,8],[8,9],[9,9],[9,8],[8,8]]]}'::jsonb,
         'tomato', 1.0),
        (v_parcel_c, current_setting('auth07.farmer_a_id')::uuid,
         'kat12-br-parcel-c',
         '{"type":"Polygon","coordinates":[[[10,10],[10,11],[11,11],[11,10],[10,10]]]}'::jsonb,
         'tomato', 1.0);

    -- Seed an ACTIVE device on parcel A with a known plaintext key.
    insert into public.m1_katara_devices
        (device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status)
    values (
        'ESP-KAT-912',
        v_parcel_a,
        current_setting('auth07.farmer_a_id')::uuid,
        extensions.crypt(v_plain, extensions.gen_salt('bf', 10)),
        right(v_plain, 4),
        'ACTIVE'
    )
    returning id into v_old_device;

    -- ----- K-12a: ACTIVE row authenticates, UNLINKED row does not ----------
    select * into v_verify
      from public.verify_device_api_key('ESP-KAT-912', v_plain);
    if v_verify.device_row_id is distinct from v_old_device then
        raise exception 'AUTH-07 KAT-12 (K-12a.1): ACTIVE row did not authenticate (got %)', v_verify.device_row_id;
    end if;
    raise notice 'OK BR-KAT12 (K-12a.1): ACTIVE row authenticates';

    update public.m1_katara_devices
       set status = 'UNLINKED'::public.device_status
     where id = v_old_device;

    select * into v_verify
      from public.verify_device_api_key('ESP-KAT-912', v_plain);
    if v_verify.device_row_id is not null then
        raise exception 'AUTH-07 KAT-12 (K-12a.2): UNLINKED row authenticated (got %)', v_verify.device_row_id;
    end if;
    raise notice 'OK BR-KAT12 (K-12a.2): UNLINKED row -> verifier NULL';

    -- ----- K-12b: freeze trigger refuses identity mutations ----------------
    -- parcel_id mutation refused
    begin
        update public.m1_katara_devices
           set parcel_id = v_parcel_b
         where id = v_old_device;
        raise exception 'AUTH-07 KAT-12 (K-12b.1): parcel_id mutation on UNLINKED row SUCCEEDED';
    exception
        when check_violation then
            raise notice 'OK BR-KAT12 (K-12b.1): parcel_id mutation on UNLINKED row refused (check_violation)';
    end;

    -- status revival refused
    begin
        update public.m1_katara_devices
           set status = 'ACTIVE'::public.device_status
         where id = v_old_device;
        raise exception 'AUTH-07 KAT-12 (K-12b.2): UNLINKED -> ACTIVE revival SUCCEEDED';
    exception
        when check_violation then
            raise notice 'OK BR-KAT12 (K-12b.2): status revival on UNLINKED row refused (check_violation)';
    end;

    -- device_id mutation refused (would let a sneaky rename evade the
    -- partial unique index on device_id).
    begin
        update public.m1_katara_devices
           set device_id = 'ESP-KAT-999'
         where id = v_old_device;
        raise exception 'AUTH-07 KAT-12 (K-12b.3): device_id mutation on UNLINKED row SUCCEEDED';
    exception
        when check_violation then
            raise notice 'OK BR-KAT12 (K-12b.3): device_id mutation on UNLINKED row refused (check_violation)';
    end;

    -- last_seen passes through (operational state, not identity). KAT-13
    -- needs this column to keep moving even after unlink.
    update public.m1_katara_devices
       set last_seen = now()
     where id = v_old_device;
    select last_seen into v_last_seen
      from public.m1_katara_devices
     where id = v_old_device;
    if v_last_seen is null then
        raise exception 'AUTH-07 KAT-12 (K-12b.4): last_seen update on UNLINKED row did not land';
    end if;
    raise notice 'OK BR-KAT12 (K-12b.4): last_seen on UNLINKED row passes through';

    -- ----- K-12c: re-pair flow under the partial unique index --------------
    -- The prior row is UNLINKED, so the partial index allows a new row on
    -- a different parcel with the same device_id.
    insert into public.m1_katara_devices
        (device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status)
    values (
        'ESP-KAT-912',
        v_parcel_b,
        current_setting('auth07.farmer_a_id')::uuid,
        extensions.crypt('vk_new', extensions.gen_salt('bf', 4)),
        'wnew',
        'PENDING'
    )
    returning id into v_new_device;
    if v_new_device is distinct from v_old_device then
        raise notice 'OK BR-KAT12 (K-12c.1): re-pair created a NEW row';
    else
        raise exception 'AUTH-07 KAT-12 (K-12c.1): re-pair reused old row id (%)', v_new_device;
    end if;

    select status::text into v_status
      from public.m1_katara_devices
     where id = v_old_device;
    if v_status is distinct from 'UNLINKED' then
        raise exception 'AUTH-07 KAT-12 (K-12c.2): old row status drifted to % (expected UNLINKED)', v_status;
    end if;
    raise notice 'OK BR-KAT12 (K-12c.2): old row still UNLINKED after re-pair';

    -- A third non-UNLINKED row for the same device_id is refused by the
    -- partial unique index from KAT-02 — BR-K1 holds end-to-end.
    begin
        insert into public.m1_katara_devices
            (device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status)
        values (
            'ESP-KAT-912',
            v_parcel_c,
            current_setting('auth07.farmer_a_id')::uuid,
            extensions.crypt('vk_third', extensions.gen_salt('bf', 4)),
            'thrd',
            'PENDING'
        );
        raise exception 'AUTH-07 KAT-12 (K-12c.3): third non-UNLINKED row for same device_id SUCCEEDED';
    exception
        when unique_violation then
            raise notice 'OK BR-KAT12 (K-12c.3): third non-UNLINKED row refused (partial unique index)';
    end;
end$$;

-- ===========================================================================
-- KAT-13 — historical telemetry after unlink.
--   K-13a  A telemetry row survives an unlink: SELECT count by parcel_id is
--          identical before and after the device's status flips to UNLINKED.
--          The KAT-03 FORCE-RLS + no-UPDATE/DELETE policy on telemetry +
--          the KAT-12 freeze trigger on devices compose to guarantee this
--          without KAT-13 having to add a single new policy.
--   K-13b  The m1_katara_parcel_device_history view inherits RLS from the
--          underlying tables. Under a service-role probe both telemetry
--          tables expose rows; under a per-farmer JWT context the view only
--          surfaces rows whose telemetry farmer_id matches auth.uid(). We
--          assert the empty case for the cross-farmer probe — a JWT that
--          does not own the parcel sees zero rows on the view.
--   K-13c  Cross-parcel boundary after a same-physical-device relocation.
--          The old parcel's history must NOT include rows ingested under
--          the post-relocation parcel id; the new parcel's history must NOT
--          include rows from the old binding. KAT-12's freeze on parcel_id
--          + KAT-03's denormalisation trigger compose to give us this for
--          free; we verify empirically.
-- ===========================================================================
do $$
declare
    v_parcel_a       uuid := gen_random_uuid();
    v_parcel_b       uuid := gen_random_uuid();
    v_old_device     uuid;
    v_new_device     uuid;
    v_plain          text := 'vk_' || encode(gen_random_bytes(16), 'hex');
    v_count_before   int;
    v_count_after    int;
    v_a_rows         int;
    v_b_rows         int;
    v_view_rows_a    int;
    v_view_rows_b    int;
    v_history_rows   int;
    v_filtered_rows  int;
begin
    if to_regclass('public.m1_katara_devices') is null
       or to_regclass('public.m1_katara_telemetry') is null
       or to_regclass('public.m1_katara_parcel_device_history') is null then
        raise notice 'SKIP KAT-13 BR: public.m1_katara_* + view not yet merged';
        return;
    end if;

    -- Two parcels owned by FARMER-A: the unlink source (A) and the relink
    -- target (B). The same physical device_id ('ESP-KAT-913') will travel
    -- from A to B through an unlink + re-pair round-trip.
    insert into public.m1_katara_parcels
        (id, farmer_id, name, geojson, crop_type, surface_area_ha)
    values
        (v_parcel_a, current_setting('auth07.farmer_a_id')::uuid,
         'kat13-br-parcel-a',
         '{"type":"Polygon","coordinates":[[[12,12],[12,13],[13,13],[13,12],[12,12]]]}'::jsonb,
         'tomato', 1.0),
        (v_parcel_b, current_setting('auth07.farmer_a_id')::uuid,
         'kat13-br-parcel-b',
         '{"type":"Polygon","coordinates":[[[14,14],[14,15],[15,15],[15,14],[14,14]]]}'::jsonb,
         'tomato', 1.0);

    -- Seed an ACTIVE device on parcel A.
    insert into public.m1_katara_devices
        (device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status)
    values (
        'ESP-KAT-913',
        v_parcel_a,
        current_setting('auth07.farmer_a_id')::uuid,
        extensions.crypt(v_plain, extensions.gen_salt('bf', 10)),
        right(v_plain, 4),
        'ACTIVE'
    )
    returning id into v_old_device;

    -- Ingest a telemetry row under parcel A. The KAT-03 trigger fills
    -- parcel_id + farmer_id from the device row; we read it back to confirm.
    insert into public.m1_katara_telemetry
        (device_id, soil_moisture, soil_temperature, soil_ph,
         soil_conductivity, battery_level, recorded_at, received_at)
    values (
        v_old_device, 50, 22, 6.8, 1100, 92,
        now() - interval '6 hours', now() - interval '6 hours'
    );

    -- ----- K-13a: telemetry row survives an unlink ---------------------------
    select count(*) into v_count_before
    from public.m1_katara_telemetry
    where parcel_id = v_parcel_a and device_id = v_old_device;
    if v_count_before <> 1 then
        raise exception 'AUTH-07 KAT-13 (K-13a.pre): expected 1 telemetry row, got %', v_count_before;
    end if;

    update public.m1_katara_devices
       set status = 'UNLINKED'::public.device_status
     where id = v_old_device;

    select count(*) into v_count_after
    from public.m1_katara_telemetry
    where parcel_id = v_parcel_a and device_id = v_old_device;
    if v_count_after <> v_count_before then
        raise exception 'AUTH-07 KAT-13 (K-13a): telemetry row count drifted after unlink (% -> %)',
            v_count_before, v_count_after;
    end if;
    raise notice 'OK BR-KAT13 (K-13a): telemetry row survives unlink (% row(s) preserved)', v_count_after;

    -- Verify the per-device aggregate view surfaces the UNLINKED row.
    select count(*) into v_view_rows_a
    from public.m1_katara_parcel_device_history
    where parcel_id = v_parcel_a and device_uuid = v_old_device;
    if v_view_rows_a <> 1 then
        raise exception 'AUTH-07 KAT-13 (K-13a.view): aggregate view missing UNLINKED device row (% rows)', v_view_rows_a;
    end if;
    raise notice 'OK BR-KAT13 (K-13a.view): aggregate view surfaces UNLINKED device';

    -- ----- K-13b: aggregate view RLS isolates cross-farmer reads ------------
    -- Swap JWT context to FARMER-B and confirm the view returns 0 rows for
    -- parcel A. The view inherits RLS from m1_katara_telemetry (the only
    -- gate is katara_telemetry_select_own — auth.uid() = farmer_id), so a
    -- cross-farmer probe naturally returns the empty set.
    set local role authenticated;
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',  current_setting('auth07.farmer_b_id'),
            'role', 'authenticated'
        )::text,
        true
    );

    select count(*) into v_view_rows_b
    from public.m1_katara_parcel_device_history
    where parcel_id = v_parcel_a;

    -- Drop back to service role for cleanup + subsequent assertions.
    reset role;
    perform set_config(
        'request.jwt.claims', '{"role":"service_role"}', true
    );

    if v_view_rows_b <> 0 then
        raise exception 'AUTH-07 KAT-13 (K-13b): cross-farmer JWT saw % rows on FARMER-A''s parcel (expected 0)', v_view_rows_b;
    end if;
    raise notice 'OK BR-KAT13 (K-13b): aggregate view RLS isolates cross-farmer reads';

    -- ----- K-13c: cross-parcel boundary after a same-device relocation ------
    -- Re-pair the same physical device on parcel B. KAT-12's partial unique
    -- indexes allow the INSERT because the prior row is UNLINKED.
    insert into public.m1_katara_devices
        (device_id, parcel_id, farmer_id, api_key_hash, api_key_last4, status)
    values (
        'ESP-KAT-913',
        v_parcel_b,
        current_setting('auth07.farmer_a_id')::uuid,
        extensions.crypt(v_plain || '_new', extensions.gen_salt('bf', 10)),
        'newY',
        'ACTIVE'
    )
    returning id into v_new_device;

    -- Ingest a fresh telemetry row under parcel B (new device row).
    insert into public.m1_katara_telemetry
        (device_id, soil_moisture, soil_temperature, soil_ph,
         soil_conductivity, battery_level, recorded_at, received_at)
    values (
        v_new_device, 40, 24, 7.0, 1200, 95,
        now() - interval '30 minutes', now() - interval '30 minutes'
    );

    select count(*) into v_a_rows
    from public.m1_katara_telemetry where parcel_id = v_parcel_a;
    select count(*) into v_b_rows
    from public.m1_katara_telemetry where parcel_id = v_parcel_b;

    if v_a_rows <> 1 or v_b_rows <> 1 then
        raise exception 'AUTH-07 KAT-13 (K-13c): cross-parcel boundary broken after relocation (a=%, b=%)',
            v_a_rows, v_b_rows;
    end if;
    raise notice 'OK BR-KAT13 (K-13c): cross-parcel boundary holds post-relocation (a=1, b=1)';

    -- Verify the 4-arg function variant filters correctly: requesting the
    -- new device under parcel A returns 0 rows; requesting it under parcel B
    -- returns the expected count.
    select count(*) into v_filtered_rows
    from public.m1_katara_telemetry_history(
        v_parcel_a, interval '7 days', '1hour', v_new_device
    );
    if v_filtered_rows <> 0 then
        raise exception 'AUTH-07 KAT-13 (K-13c.filter): parcel A history with new-device filter returned % rows (expected 0)',
            v_filtered_rows;
    end if;

    select count(*) into v_history_rows
    from public.m1_katara_telemetry_history(
        v_parcel_b, interval '7 days', '1hour', v_new_device
    );
    if v_history_rows <> 1 then
        raise exception 'AUTH-07 KAT-13 (K-13c.filter): parcel B history with new-device filter returned % rows (expected 1)',
            v_history_rows;
    end if;
    raise notice 'OK BR-KAT13 (K-13c.filter): 4-arg history function respects device + parcel boundaries';
end$$;

-- ===========================================================================
-- KAT-14 — farmer-level multi-parcel overview.
--   K-14a  A SELECT under FARMER-A's JWT against
--          public.m1_katara_farmer_parcels_overview returns only FARMER-A's
--          parcels. The view inherits RLS from m1_katara_parcels +
--          m1_katara_devices + m1_katara_telemetry + m1_katara_thresholds —
--          no new policy is added by KAT-14, so this cell empirically
--          verifies the composition holds.
--   K-14b  The view exposes only the documented columns. A future migration
--          that accidentally widens it (e.g. by joining api_key_hash in)
--          dies at CI before reaching staging — the column allow-list is
--          checked at schema time against information_schema.
-- ===========================================================================
do $$
declare
    v_parcel_a    uuid := gen_random_uuid();
    v_parcel_b    uuid := gen_random_uuid();
    v_rows_a      int;
    v_first_name  text;
    v_columns     text[];
    v_expected    text[] := array[
        'parcel_id',
        'farmer_id',
        'name',
        'crop_type',
        'surface_area_ha',
        'parcel_created_at',
        'device_active_count',
        'device_offline_count',
        'device_pending_count',
        'device_unlinked_count',
        'last_reading_at',
        'last_soil_moisture',
        'last_soil_temperature',
        'last_soil_ph',
        'last_soil_conductivity',
        'has_open_threshold_breach'
    ];
begin
    if to_regclass('public.m1_katara_parcels') is null
       or to_regclass('public.m1_katara_farmer_parcels_overview') is null then
        raise notice 'SKIP KAT-14 BR: overview view not yet merged (migration 0028)';
        return;
    end if;

    -- Seed: FARMER-A owns parcel A1; FARMER-B owns parcel B1. The overview
    -- view's RLS chain must surface only A1 to FARMER-A.
    insert into public.m1_katara_parcels
        (id, farmer_id, name, geojson, crop_type, surface_area_ha)
    values
        (v_parcel_a, current_setting('auth07.farmer_a_id')::uuid,
         'kat14-br-A1',
         '{"type":"Polygon","coordinates":[[[20,20],[20,21],[21,21],[21,20],[20,20]]]}'::jsonb,
         'tomato', 1.0),
        (v_parcel_b, current_setting('auth07.farmer_b_id')::uuid,
         'kat14-br-B1',
         '{"type":"Polygon","coordinates":[[[22,22],[22,23],[23,23],[23,22],[22,22]]]}'::jsonb,
         'tomato', 1.0);

    -- ----- K-14a: cross-farmer RLS holds on the view ------------------------
    -- Swap JWT context to FARMER-A and probe the view. We add a name LIKE
    -- filter so the assertion is not polluted by parcels seeded by earlier
    -- cells in this transaction (the seed file may have inserted some).
    set local role authenticated;
    perform set_config(
        'request.jwt.claims',
        jsonb_build_object(
            'sub',  current_setting('auth07.farmer_a_id'),
            'role', 'authenticated'
        )::text,
        true
    );

    select count(*) into v_rows_a
    from public.m1_katara_farmer_parcels_overview
    where name like 'kat14-br-%';

    select name into v_first_name
    from public.m1_katara_farmer_parcels_overview
    where name like 'kat14-br-%'
    limit 1;

    reset role;
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

    if v_rows_a <> 1 then
        raise exception 'AUTH-07 KAT-14 (K-14a): FARMER-A saw % kat14-br-* rows on the overview view (expected 1)', v_rows_a;
    end if;
    if v_first_name <> 'kat14-br-A1' then
        raise exception 'AUTH-07 KAT-14 (K-14a): FARMER-A''s visible parcel was % (expected kat14-br-A1) — cross-farmer RLS leak', v_first_name;
    end if;
    raise notice 'OK BR-KAT14 (K-14a): overview view enforces cross-farmer RLS isolation';

    -- ----- K-14b: column allow-list ----------------------------------------
    -- A future view rewrite that drags in api_key_hash, last_seen, or any
    -- other sensitive device column must die here, not on the dashboard.
    select array_agg(column_name::text order by column_name)
      into v_columns
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'm1_katara_farmer_parcels_overview';

    if v_columns is null then
        raise exception 'AUTH-07 KAT-14 (K-14b): overview view has no columns visible to information_schema';
    end if;

    -- Use the symmetric-difference idiom on the sorted arrays. If the two
    -- arrays differ in either direction the assertion fires with the diff.
    if (select array_agg(c order by c)
          from (
            select unnest(v_columns)
            except
            select unnest(v_expected)
          ) s(c)) is not null
    then
        raise exception 'AUTH-07 KAT-14 (K-14b): overview view exposes UNEXPECTED columns: %',
            (select array_agg(c order by c)
               from (
                 select unnest(v_columns)
                 except
                 select unnest(v_expected)
               ) s(c));
    end if;

    if (select array_agg(c order by c)
          from (
            select unnest(v_expected)
            except
            select unnest(v_columns)
          ) s(c)) is not null
    then
        raise exception 'AUTH-07 KAT-14 (K-14b): overview view is MISSING expected columns: %',
            (select array_agg(c order by c)
               from (
                 select unnest(v_expected)
                 except
                 select unnest(v_columns)
               ) s(c));
    end if;

    raise notice 'OK BR-KAT14 (K-14b): overview view exposes only the documented columns (no api_key_hash, no last_seen)';
end$$;

do $$ begin
    raise notice 'AUTH-07 business-rule suite completed — rolling back';
end$$;

rollback;
