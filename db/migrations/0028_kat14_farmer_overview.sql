-- =============================================================================
-- 0028 — M1 Katara: KAT-14 farmer-level multi-parcel overview view.
-- Story:  KAT-14 (docs/stories/KAT-14-multi-parcel-support.md)
--
-- One change, pure read-path:
--   A view m1_katara_farmer_parcels_overview surfacing the per-parcel summary
--   (latest reading, device-status mix, threshold breach flag) for the
--   farm-level dashboard. Inherits RLS from the four base tables it joins;
--   no new policy.
--
-- No table changes. No data migration.
--
-- RLS composition (KAT-14 §4.1):
--   m1_katara_parcels    → katara_parcels_select_own    → auth.uid() = farmer_id
--   m1_katara_devices    → katara_devices_select_own    → auth.uid() = farmer_id
--   m1_katara_telemetry  → katara_telemetry_select_own  → auth.uid() = farmer_id
--   m1_katara_thresholds → katara_thresholds_select_own → auth.uid() = farmer_id
-- The view inherits the natural conjunction of the four predicates via
-- view-pass-through semantics — AUTH-07 cell K-14a verifies empirically.
-- =============================================================================

create or replace view public.m1_katara_farmer_parcels_overview as
with latest_per_parcel as (
    -- Most-recent telemetry row per parcel, irrespective of which device
    -- produced it. Uses the (parcel_id, recorded_at desc) index from KAT-03.
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
    -- Per-parcel device status counts. UNLINKED rows count toward the
    -- "unlinked" tally — their parcel_id is frozen by KAT-12's trigger so
    -- they remain attributable to the parcel they were paired to.
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
    -- Per-parcel breach flag: TRUE iff the most recent telemetry row violates
    -- any threshold configured on the parcel. Latest reading only — historical
    -- breaches are a chart concern; the overview answers "what needs me now?".
    -- The bool_or aggregates over the threshold rows (≤ 5, one per metric);
    -- only enabled rows participate (mirrors the KAT-06 evaluator semantic).
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
    'KAT-14: per-parcel summary for the farm-level dashboard. RLS is inherited '
    'from m1_katara_parcels, m1_katara_devices, m1_katara_telemetry, '
    'm1_katara_thresholds via view-pass-through semantics. Each base table''s '
    'auth.uid() = farmer_id predicate composes to the natural conjunction.';
