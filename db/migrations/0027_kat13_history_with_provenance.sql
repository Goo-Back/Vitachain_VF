-- =============================================================================
-- 0027 — M1 Katara: KAT-13 historical telemetry surfacing.
-- Story:  KAT-13 (docs/stories/KAT-13-historical-telemetry-after-unlink.md)
--
-- Pure read-path migration — no table changes, no RLS policy changes, no data
-- migration. Three additive surfaces:
--
--   1) public.m1_katara_parcel_device_history  — per-(parcel, device) view of
--      every device that ever contributed telemetry to a parcel, UNLINKED
--      devices included. Their parcel_id is frozen by KAT-12's freeze trigger,
--      so the join is stable even after a device is re-paired elsewhere.
--
--   2) public.m1_katara_telemetry_history(uuid, interval, text, uuid)
--      — a 4-arg overload of the KAT-04 function adding an optional
--      p_device_id filter so the chart can slice the parcel's history by a
--      single device. Default NULL preserves the KAT-04 aggregate semantics
--      for back-compat (Postgres dispatches the longer signature; existing
--      3-arg callsites still resolve via the original 3-arg variant).
--
--   3) public.m1_katara_telemetry_latest replaced with a variant that does NOT
--      filter UNLINKED devices and now exposes device_label (text id),
--      device_status, and device_updated_at (the post-unlink proxy for
--      "unlinked_at" — KAT-12 §6 deliberately rejected a separate audit
--      column for MVD). The /latest endpoint now returns a meaningful tile
--      even on a parcel whose only device is UNLINKED, instead of an
--      unconditional 204 No Content. The previous-state ACTIVE/OFFLINE/PENDING
--      contract is unchanged — the new fields are additive.
--
-- All three inherit RLS from the underlying tables (m1_katara_telemetry +
-- m1_katara_devices) via `security invoker` / view-pass-through semantics.
-- AUTH-07 cells K-13a/K-13b/K-13c (db/tests/auth07_business_rules.sql) verify
-- the boundaries empirically.
-- =============================================================================

-- ── Per-device aggregate view ───────────────────────────────────────────────
-- One row per (parcel_id, device row) that has ever produced telemetry. The
-- (parcel_id, device_id) pair on a telemetry row is frozen at INSERT by KAT-03
-- and stays frozen across the device's unlink/relink lifecycle; the join
-- against m1_katara_devices resolves to the *original* device row even if the
-- physical ESP32 has since been re-paired on another parcel (the re-pair
-- inserts a NEW device row per KAT-12 §6, so a relocated device shows up under
-- the new parcel's aggregate as a separate record).
create or replace view public.m1_katara_parcel_device_history as
select
    t.parcel_id                                                            as parcel_id,
    d.id                                                                   as device_uuid,
    d.device_id                                                            as device_id,
    d.status::text                                                         as device_status,
    d.api_key_last4                                                        as api_key_last4,
    min(t.recorded_at)                                                     as first_recorded_at,
    max(t.recorded_at)                                                     as last_recorded_at,
    count(*)::int                                                          as sample_count,
    -- True when this device row is still the relevant one for *this* parcel:
    -- its current parcel_id matches AND it has not been unlinked. A relocated
    -- physical device whose new ACTIVE row lives under a different parcel
    -- shows up under the old parcel with is_currently_paired = false (the old
    -- row is UNLINKED and pinned to the old parcel by KAT-12's freeze).
    (d.parcel_id = t.parcel_id
        and d.status <> 'UNLINKED'::public.device_status)                  as is_currently_paired,
    -- Surface the unlink-time proxy. KAT-12's freeze trigger forbids any
    -- post-unlink mutation other than last_seen + updated_at, so for an
    -- UNLINKED row updated_at IS the unlink instant (KAT-13 §6.3).
    d.updated_at                                                           as device_updated_at
from public.m1_katara_telemetry t
join public.m1_katara_devices d on d.id = t.device_id
group by t.parcel_id, d.id, d.device_id, d.status, d.api_key_last4,
         d.parcel_id, d.updated_at;

comment on view public.m1_katara_parcel_device_history is
    'KAT-13: per-(parcel, device) aggregate of telemetry contributions. '
    'Includes UNLINKED devices whose parcel_id is frozen by KAT-12. '
    'is_currently_paired distinguishes "still active on this parcel" from '
    '"contributed history then moved/unlinked". RLS is inherited from '
    'm1_katara_telemetry + m1_katara_devices — no view-level policy.';

-- ── 4-arg overload of the KAT-04 history function ───────────────────────────
-- Adds an optional p_device_id filter for the chart's per-device slice view.
-- The 3-arg KAT-04 variant from migration 0020 is left in place: existing
-- callsites continue to dispatch to it; KAT-13's RPC callsite passes 4 args
-- and resolves to this overload.
create or replace function public.m1_katara_telemetry_history(
    p_parcel_id  uuid,
    p_window     interval,
    p_bucket     text,
    p_device_id  uuid default null              -- KAT-13: optional filter
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
          and  (p_device_id is null or device_id = p_device_id)
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

comment on function public.m1_katara_telemetry_history(uuid, interval, text, uuid) is
    'KAT-04 history function extended by KAT-13: optional p_device_id filter '
    'for per-device history slicing. NULL = aggregate across all devices '
    '(KAT-04 back-compat). security invoker so RLS filters cross-farmer rows.';

revoke all on function public.m1_katara_telemetry_history(uuid, interval, text, uuid) from public;
revoke all on function public.m1_katara_telemetry_history(uuid, interval, text, uuid) from anon;
grant  execute on function public.m1_katara_telemetry_history(uuid, interval, text, uuid) to authenticated;
grant  execute on function public.m1_katara_telemetry_history(uuid, interval, text, uuid) to service_role;

-- ── Extend the latest view: include UNLINKED + surface device label/status ──
-- KAT-04's variant filtered `where d.status <> 'UNLINKED'`, which made a
-- parcel whose only device had been unlinked return 0 rows on /latest — a
-- blank tile even when 3 months of data sat one click away on the chart.
-- KAT-13 removes that filter and APPENDS three new columns the handler needs:
--   * device_label       — the human-readable ESP-KAT-NNN text id
--   * device_status      — current status; UI renders the "Détaché" pill
--   * device_updated_at  — the unlink-time proxy per KAT-12 §6 + KAT-13 §6.3
--
-- Postgres CREATE OR REPLACE VIEW cannot reorder existing columns (the type
-- contract is positional), only append. We therefore preserve the KAT-04
-- column order (id, device_id, parcel_id, farmer_id, … recorded_at,
-- received_at — inherited from `select t.*`) and append the three new
-- columns at the end. The handler reads by name, so the order is irrelevant
-- at the wire layer.
create or replace view public.m1_katara_telemetry_latest as
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
    d.device_id    as device_label,         -- KAT-13: appended
    d.status::text as device_status,        -- KAT-13: appended
    d.updated_at   as device_updated_at     -- KAT-13: appended
from   public.m1_katara_devices d
cross join lateral (
    select tt.*
    from   public.m1_katara_telemetry tt
    where  tt.device_id = d.id
    order  by tt.recorded_at desc
    limit  1
) t;

comment on view public.m1_katara_telemetry_latest is
    'KAT-04 latest-per-device view, extended by KAT-13: includes UNLINKED '
    'devices (so a parcel whose only device was unlinked still renders a '
    'meaningful tile) and surfaces device_label / device_status / '
    'device_updated_at for the UI to render the appropriate pill.';
