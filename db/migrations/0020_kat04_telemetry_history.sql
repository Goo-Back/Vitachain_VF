-- =============================================================================
-- 0020 — M1 Katara: telemetry history aggregator (KAT-04).
-- Story:  KAT-04 (docs/stories/KAT-04-dashboard-realtime-historical-charts.md)
--
-- One read-only SQL function, no new tables, no new policies. Reads through
-- KAT-03's RLS (katara_telemetry_select_own / katara_telemetry_admin_select)
-- via `security invoker`. The bucket size is a parameter so the FastAPI layer
-- can enforce BR-K4 (≤ 500 returned points) by picking the right granularity
-- per window:
--   24h  -> '15min' (raw, 96 points max)
--   7d   -> '1hour' (168 points max)
--   30d  -> '1day'  (30 points max)
--
-- Note on numbering: the story §5.1 names this file 0019_kat04_telemetry_history.sql
-- but slot 0019 was already taken by the KAT-03 follow-up that locked
-- m1_katara_ingest() to service_role only. This migration moves to 0020.
-- =============================================================================

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
security invoker            -- inherits RLS; cross-farmer callers see 0 rows
set search_path = public, pg_temp
as $$
    with windowed as (
        select *
        from   public.m1_katara_telemetry
        where  parcel_id   = p_parcel_id
          and  recorded_at >= now() - p_window
    )
    select
        date_trunc(p_bucket, recorded_at)                 as bucket,
        avg(soil_moisture)::real                          as soil_moisture,
        avg(soil_temperature)::real                       as soil_temperature,
        avg(soil_ph)::real                                as soil_ph,
        avg(soil_conductivity)::real                      as soil_conductivity,
        avg(battery_level)::real                          as battery_level,
        count(*)::int                                     as sample_count,
        count(distinct device_id)::int                    as device_count
    from   windowed
    group  by 1
    order  by 1 asc;
$$;

-- Lock down execution to authenticated callers (the read endpoint runs under
-- the caller's JWT via get_db_for_user). service_role keeps EXECUTE for
-- background tasks / admin shells; anon must not be able to probe.
revoke all on function public.m1_katara_telemetry_history(uuid, interval, text) from public;
revoke all on function public.m1_katara_telemetry_history(uuid, interval, text) from anon;
grant  execute on function public.m1_katara_telemetry_history(uuid, interval, text) to authenticated;
grant  execute on function public.m1_katara_telemetry_history(uuid, interval, text) to service_role;
