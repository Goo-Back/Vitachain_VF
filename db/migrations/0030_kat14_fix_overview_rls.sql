-- =============================================================================
-- 0030 — M1 Katara: Fix RLS bypass on m1_katara_farmer_parcels_overview.
--
-- Root cause: the view created in 0028 omitted WITH (security_invoker = true).
-- PostgreSQL views default to security-definer semantics — they execute as the
-- view owner (postgres), which holds BYPASSRLS. This caused the RLS predicates
-- on all four base tables (farmer_id = auth.uid()) to be skipped entirely,
-- leaking every farmer's parcels to any authenticated caller.
--
-- Fix: recreate the view with security_invoker = true so it executes as the
-- calling role (authenticated). The four base-table RLS policies then fire as
-- designed and restrict rows to auth.uid() = farmer_id.
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
    select
        l.parcel_id,
        bool_or(
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
        ) as has_open_breach
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
    coalesce(b.has_open_breach, false)            as has_open_threshold_breach
from public.m1_katara_parcels p
left join device_mix       d on d.parcel_id = p.id
left join latest_per_parcel l on l.parcel_id = p.id
left join breach_check     b on b.parcel_id = p.id;

comment on view public.m1_katara_farmer_parcels_overview is
    'KAT-14 (fixed 0030): per-parcel summary for the farm-level dashboard. '
    'security_invoker=true ensures the view executes as the authenticated role '
    'so RLS on m1_katara_parcels, m1_katara_devices, m1_katara_telemetry, '
    'm1_katara_thresholds fires correctly (auth.uid() = farmer_id on each).';
