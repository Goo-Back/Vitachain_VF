-- =============================================================================
-- 0029 — KAT-04 fix: replace invalid date_trunc(p_bucket, …) calls.
--
-- Root cause: migrations 0020 and 0027 called date_trunc(p_bucket, recorded_at)
-- with p_bucket ∈ {'15min', '1hour', '1day'}. PostgreSQL's date_trunc only
-- accepts canonical field names ('minute', 'hour', 'day', …). The non-standard
-- strings cause an error; supabase-py's execute() surfaces this as data=None,
-- so the FastAPI handler returns {"buckets": [], "point_count": 0} for every
-- window — historique always empty.
--
-- Fix: use a CASE on p_bucket to dispatch to the correct expression:
--   '15min' → epoch-floor trick (no native 15-min date_trunc in vanilla PG)
--   '1hour' → date_trunc('hour', …)
--   '1day'  → date_trunc('day', …)
--
-- Both the 3-arg (KAT-04) and 4-arg (KAT-13) overloads are fixed here with
-- CREATE OR REPLACE — the function signatures and GRANT/REVOKE lists are
-- unchanged.
-- =============================================================================

-- ── 3-arg overload (originally migration 0020) ──────────────────────────────
create or replace function public.m1_katara_telemetry_history(
    p_parcel_id  uuid,
    p_window     interval,
    p_bucket     text          -- '15min' | '1hour' | '1day'
)
returns table (
    bucket            timestamptz,
    soil_moisture     real,
    soil_temperature  real,
    soil_ph           real,
    soil_conductivity real,
    battery_level     real,
    sample_count      integer,
    device_count      integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    with windowed as (
        select *
        from   public.m1_katara_telemetry
        where  parcel_id   = p_parcel_id
          and  recorded_at >= now() - p_window
    )
    select
        case p_bucket
            when '15min' then
                -- No native 15-min date_trunc in PostgreSQL: floor epoch to the
                -- nearest 900-second (15-min) boundary and convert back.
                to_timestamp(
                    floor(extract(epoch from recorded_at) / 900) * 900
                )
            when '1hour' then date_trunc('hour', recorded_at)
            when '1day'  then date_trunc('day',  recorded_at)
            else              date_trunc('day',  recorded_at)   -- safe fallback
        end                                                   as bucket,
        avg(soil_moisture)::real                              as soil_moisture,
        avg(soil_temperature)::real                           as soil_temperature,
        avg(soil_ph)::real                                    as soil_ph,
        avg(soil_conductivity)::real                          as soil_conductivity,
        avg(battery_level)::real                              as battery_level,
        count(*)::int                                         as sample_count,
        count(distinct device_id)::int                        as device_count
    from   windowed
    group  by 1
    order  by 1 asc;
$$;

-- ── 4-arg overload (originally migration 0027, KAT-13 device filter) ─────────
create or replace function public.m1_katara_telemetry_history(
    p_parcel_id  uuid,
    p_window     interval,
    p_bucket     text,
    p_device_id  uuid default null
)
returns table (
    bucket            timestamptz,
    soil_moisture     real,
    soil_temperature  real,
    soil_ph           real,
    soil_conductivity real,
    battery_level     real,
    sample_count      integer,
    device_count      integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    with windowed as (
        select *
        from   public.m1_katara_telemetry
        where  parcel_id   = p_parcel_id
          and  recorded_at >= now() - p_window
          and  (p_device_id is null or device_id = p_device_id)
    )
    select
        case p_bucket
            when '15min' then
                to_timestamp(
                    floor(extract(epoch from recorded_at) / 900) * 900
                )
            when '1hour' then date_trunc('hour', recorded_at)
            when '1day'  then date_trunc('day',  recorded_at)
            else              date_trunc('day',  recorded_at)
        end                                                   as bucket,
        avg(soil_moisture)::real                              as soil_moisture,
        avg(soil_temperature)::real                           as soil_temperature,
        avg(soil_ph)::real                                    as soil_ph,
        avg(soil_conductivity)::real                          as soil_conductivity,
        avg(battery_level)::real                              as battery_level,
        count(*)::int                                         as sample_count,
        count(distinct device_id)::int                        as device_count
    from   windowed
    group  by 1
    order  by 1 asc;
$$;

-- GRANTs are unchanged from the originals — restate to be idempotent.
revoke all on function public.m1_katara_telemetry_history(uuid, interval, text)      from public, anon;
revoke all on function public.m1_katara_telemetry_history(uuid, interval, text, uuid) from public, anon;

grant execute on function public.m1_katara_telemetry_history(uuid, interval, text)
    to authenticated, service_role;
grant execute on function public.m1_katara_telemetry_history(uuid, interval, text, uuid)
    to authenticated, service_role;
