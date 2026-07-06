-- =============================================================================
-- 0053 — M1 Katara: real open-alert count on the farmer overview view.
--
-- Problem: m1_katara_farmer_parcels_overview (0028, security-invoker fix in
-- 0030) only exposes has_open_threshold_breach, a boolean. The farmer
-- dashboard KPI strip needs "how many alerts need my attention", not just
-- "is there a problem" — a farmer with 1 breached metric and a farmer with
-- 4 breached metrics both render identically today.
--
-- Fix: replace the bool_or in breach_check with a per-metric count. Keep
-- has_open_threshold_breach (derived from the count) so existing consumers
-- (ParcelCard.tsx's tone()) keep working unchanged; add open_alert_count.
--
-- Scope note: battery_level is a valid m1_katara_thresholds metric but was
-- never part of breach_check in 0028/0030 — that scope is preserved here
-- unchanged (not silently expanding threshold semantics as a side effect of
-- this migration). Only soil_moisture / soil_temperature / soil_ph /
-- soil_conductivity count toward open_alert_count (max 4).
--
-- Postgres requires CREATE OR REPLACE VIEW to restate the full view body
-- (no ALTER for CTEs) — same constraint noted in 0030's header.
-- =============================================================================

create or replace view public.m1_katara_farmer_parcels_overview
  with (security_invoker = true)
as
with latest_per_parcel as (
    select distinct on (parcel_id)
        parcel_id,
        recorded_at        as last_reading_at,
        soil_moisture      as last_soil_moisture,
        soil_temperature   as last_soil_temperature,
        soil_ph            as last_soil_ph,
        soil_conductivity  as last_soil_conductivity,
        device_id          as last_reading_device_uuid
    from public.m1_katara_telemetry
    order by parcel_id, recorded_at desc
),
device_mix as (
    select
        parcel_id,
        count(*) filter (where status = 'ACTIVE')   as device_active_count,
        count(*) filter (where status = 'OFFLINE')  as device_offline_count,
        count(*) filter (where status = 'PENDING')  as device_pending_count,
        count(*) filter (where status = 'UNLINKED') as device_unlinked_count
    from public.m1_katara_devices
    group by parcel_id
),
breach_check as (
    -- Per-parcel breach count: how many of the ≤4 in-scope metrics violate
    -- their enabled threshold on the most recent telemetry row. Latest
    -- reading only — historical breaches are a chart concern (KAT-14 §—
    -- unchanged from 0028); the overview answers "what needs me now?".
    select
        l.parcel_id,
        count(*) filter (where
                (t.metric = 'soil_moisture'
                    and ( (t.min_value is not null and l.last_soil_moisture < t.min_value)
                       or (t.max_value is not null and l.last_soil_moisture > t.max_value) ))
            or  (t.metric = 'soil_temperature'
                    and ( (t.min_value is not null and l.last_soil_temperature < t.min_value)
                       or (t.max_value is not null and l.last_soil_temperature > t.max_value) ))
            or  (t.metric = 'soil_ph'
                    and ( (t.min_value is not null and l.last_soil_ph < t.min_value)
                       or (t.max_value is not null and l.last_soil_ph > t.max_value) ))
            or  (t.metric = 'soil_conductivity'
                    and ( (t.min_value is not null and l.last_soil_conductivity < t.min_value)
                       or (t.max_value is not null and l.last_soil_conductivity > t.max_value) ))
        ) as open_alert_count
    from latest_per_parcel l
    join public.m1_katara_thresholds t on t.parcel_id = l.parcel_id
    where t.enabled is true
    group by l.parcel_id
)
select
    p.id                                          as parcel_id,
    p.farmer_id,
    p.name,
    p.crop_type,
    p.surface_area_ha,
    p.created_at                                  as parcel_created_at,
    coalesce(d.device_active_count,   0)::int     as device_active_count,
    coalesce(d.device_offline_count,  0)::int     as device_offline_count,
    coalesce(d.device_pending_count,  0)::int     as device_pending_count,
    coalesce(d.device_unlinked_count, 0)::int     as device_unlinked_count,
    l.last_reading_at,
    l.last_soil_moisture,
    l.last_soil_temperature,
    l.last_soil_ph,
    l.last_soil_conductivity,
    coalesce(b.open_alert_count, 0) > 0           as has_open_threshold_breach,
    coalesce(b.open_alert_count, 0)::int          as open_alert_count
from public.m1_katara_parcels p
left join device_mix       d on d.parcel_id = p.id
left join latest_per_parcel l on l.parcel_id = p.id
left join breach_check     b on b.parcel_id = p.id;

comment on view public.m1_katara_farmer_parcels_overview is
    'KAT-14 (0053: real alert count): per-parcel summary for the farm-level '
    'dashboard. security_invoker=true ensures the view executes as the '
    'authenticated role so RLS on m1_katara_parcels, m1_katara_devices, '
    'm1_katara_telemetry, m1_katara_thresholds fires correctly. '
    'open_alert_count is the number of in-scope metrics (soil_moisture/'
    'soil_temperature/soil_ph/soil_conductivity — battery_level excluded, '
    'unchanged from 0028) currently breaching an enabled threshold; '
    'has_open_threshold_breach = open_alert_count > 0.';
