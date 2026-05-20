-- =============================================================================
-- 0031 — M1 Katara: Fix RLS bypass on KAT-13 views (same root cause as 0030).
--
-- Root cause: m1_katara_telemetry_latest and m1_katara_parcel_device_history
-- (created in migration 0027) omitted WITH (security_invoker = true), causing
-- them to execute as the postgres role (BYPASSRLS). A farmer who knew another
-- farmer's parcel UUID could call:
--   GET /api/v1/katara/parcels/{foreign_parcel_id}/telemetry/latest
--   GET /api/v1/katara/parcels/{foreign_parcel_id}/devices-history
-- and receive data despite the RLS policies on m1_katara_telemetry and
-- m1_katara_devices. The telemetry endpoint added a parcel-existence check but
-- only AFTER the view query, so if the view returned rows (postgres bypasses RLS)
-- the handler returned them without checking ownership first.
--
-- Fix: recreate both views with security_invoker = true. SQL bodies are
-- identical to migration 0027 — only the view option is added.
-- =============================================================================

-- ── m1_katara_telemetry_latest ───────────────────────────────────────────────
create or replace view public.m1_katara_telemetry_latest
  with (security_invoker = true)
as
select
    t.id,
    t.device_id,
    t.parcel_id,
    t.farmer_id,
    t.soil_moisture,
    t.soil_temperature,
    t.soil_ph,
    t.soil_conductivity,
    t.battery_level,
    t.recorded_at,
    t.received_at,
    d.device_id    as device_label,
    d.status::text as device_status,
    d.updated_at   as device_updated_at
from   public.m1_katara_devices d
cross join lateral (
    select tt.*
    from   public.m1_katara_telemetry tt
    where  tt.device_id = d.id
    order  by tt.recorded_at desc
    limit  1
) t;

comment on view public.m1_katara_telemetry_latest is
    'KAT-04/13 latest-per-device view (fixed 0031): security_invoker=true so '
    'RLS on m1_katara_devices (farmer_id = auth.uid()) and m1_katara_telemetry '
    'fires correctly. Cross-farmer reads are blocked at the view layer.';

-- ── m1_katara_parcel_device_history ─────────────────────────────────────────
create or replace view public.m1_katara_parcel_device_history
  with (security_invoker = true)
as
select
    t.parcel_id                                                            as parcel_id,
    d.id                                                                   as device_uuid,
    d.device_id                                                            as device_id,
    d.status::text                                                         as device_status,
    d.api_key_last4                                                        as api_key_last4,
    min(t.recorded_at)                                                     as first_recorded_at,
    max(t.recorded_at)                                                     as last_recorded_at,
    count(*)::int                                                          as sample_count,
    (d.parcel_id = t.parcel_id
        and d.status <> 'UNLINKED'::public.device_status)                  as is_currently_paired,
    d.updated_at                                                           as device_updated_at
from public.m1_katara_telemetry t
join public.m1_katara_devices d on d.id = t.device_id
group by t.parcel_id, d.id, d.device_id, d.status, d.api_key_last4,
         d.parcel_id, d.updated_at;

comment on view public.m1_katara_parcel_device_history is
    'KAT-13 per-(parcel, device) telemetry aggregate (fixed 0031): '
    'security_invoker=true so RLS on m1_katara_telemetry + m1_katara_devices '
    'fires correctly. Includes UNLINKED devices (parcel_id frozen by KAT-12).';
