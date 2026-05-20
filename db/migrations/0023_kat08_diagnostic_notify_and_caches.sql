-- =============================================================================
-- 0023 — M1 Katara: KAT-08 diagnostic NOTIFY + OWM/NDVI caches + 7d aggregate.
-- Story: KAT-08 (docs/stories/KAT-08-diagnostic-owm-sentinel-gemini-worker.md)
--
-- Pure addition on top of KAT-07's schema. Four additions:
--   1. AFTER INSERT trigger on m1_katara_diagnostics emitting NOTIFY
--      katara_diagnostic_requested with the new row id as payload (mirrors
--      KAT-03's katara_telemetry_inserted shape so the KAT-08 worker layout
--      mechanically follows the katara_threshold one).
--   2. m1_katara_owm_cache — service-role-only, BR-K3 3h TTL. Key is the
--      lat/lng quantised to 0.01° (~1.1 km grid) so neighbouring parcels in
--      the same village share a row. No RLS policies — system-internal.
--   3. m1_katara_ndvi_cache — one row per parcel, BR-K7 12h TTL. Owner-read
--      RLS via parcel join (lets a future "show last NDVI on the parcel card"
--      read it without service_role); service_role-only writes.
--   4. SECURITY DEFINER RPC m1_katara_telemetry_7d_avg(parcel_id, since) —
--      the worker calls it via supabase-py rpc(); SD lets it cross the
--      m1_katara_telemetry FORCE-RLS gate scoped to the input parcel.
--      EXECUTE granted to service_role only.
--
-- KAT-09 will add a SEPARATE AFTER UPDATE trigger on m1_katara_diagnostics
-- emitting katara_diagnostic_completed when old.status<>'COMPLETED' and
-- new.status='COMPLETED'. That's KAT-09's schema concern, not KAT-08's, so
-- the AUTH-07 matrix entry for that trigger stays cleanly under KAT-09.
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ─── (1) NOTIFY trigger ──────────────────────────────────────────────────────

create or replace function public.m1_katara_diagnostics_notify_requested()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform pg_notify(
        'katara_diagnostic_requested',
        new.id::text
    );
    return new;
end;
$$;

-- Trigger runs AFTER the KAT-07 audit-guard + fill-farmer-id BEFORE triggers
-- so the payload references a row whose status is already clamped to PENDING.
drop trigger if exists m1_katara_diagnostics_notify_requested
    on public.m1_katara_diagnostics;
create trigger m1_katara_diagnostics_notify_requested
    after insert on public.m1_katara_diagnostics
    for each row execute function public.m1_katara_diagnostics_notify_requested();

-- ─── (2) OWM cache ───────────────────────────────────────────────────────────

create table if not exists public.m1_katara_owm_cache (
    lat_q       numeric(5,2) not null,
    lng_q       numeric(6,2) not null,
    data        jsonb        not null,
    fetched_at  timestamptz  not null default now(),
    primary key (lat_q, lng_q)
);

alter table public.m1_katara_owm_cache enable row level security;
alter table public.m1_katara_owm_cache force row level security;
-- Intentionally no policies — system-internal cache, only service_role writes
-- and reads. authenticated SELECT returns 0 rows by RLS default. Verified by
-- pgTAP cell D-12.

comment on table public.m1_katara_owm_cache is
    'KAT-08 — OpenWeatherMap forecast cache keyed on quantised lat/lng (0.01° grid). '
    'BR-K3 — 3h TTL on fetched_at. System-internal — no authenticated access.';

-- ─── (3) NDVI cache ──────────────────────────────────────────────────────────

create table if not exists public.m1_katara_ndvi_cache (
    parcel_id         uuid       primary key
        references public.m1_katara_parcels(id) on delete cascade,
    mean_ndvi         numeric(4,3) not null,
    acquisition_date  date       not null,
    fetched_at        timestamptz not null default now()
);

alter table public.m1_katara_ndvi_cache enable row level security;
alter table public.m1_katara_ndvi_cache force row level security;

comment on table public.m1_katara_ndvi_cache is
    'KAT-08 — Sentinel-2 NDVI cache per parcel. BR-K7 — 12h TTL. Owner-read RLS '
    'via parcel join (no INSERT/UPDATE/DELETE policy — service_role only).';

alter event trigger trg_enforce_rls_on_public_tables enable;

drop policy if exists "kat_ndvi_select_owner" on public.m1_katara_ndvi_cache;
create policy "kat_ndvi_select_owner"
    on public.m1_katara_ndvi_cache for select to authenticated
    using (
        exists (
            select 1
              from public.m1_katara_parcels p
             where p.id = m1_katara_ndvi_cache.parcel_id
               and p.farmer_id = auth.uid()
        )
    );

-- No INSERT / UPDATE / DELETE policy for authenticated — service_role only.
-- D-13 verifies the owner-read positive + sibling-farmer negative.

-- ─── (4) 7-day per-parcel telemetry aggregate ───────────────────────────────

-- SECURITY DEFINER so the worker can call it via supabase-py rpc() under the
-- service-role JWT — the function runs as the migration owner (postgres),
-- bypassing m1_katara_telemetry's FORCE-RLS, but only for the input parcel.
-- Returns all five metrics from the corrected payload (BR-KAT03 — soil_pH +
-- soil_conductivity replaced the legacy air_humidity / air_temperature; see
-- memory/project_katara_iot_payload.md). A future memory drift back to the
-- air-* columns would fail pgTAP D-14 (introduced in this story).
create or replace function public.m1_katara_telemetry_7d_avg(
    p_parcel_id uuid,
    p_since     timestamptz
) returns table (
    sample_count    bigint,
    avg_moisture    numeric,
    avg_temperature numeric,
    avg_ph          numeric,
    avg_ec          numeric,
    avg_battery     numeric
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
    select
        count(*)::bigint                 as sample_count,
        avg(soil_moisture)::numeric      as avg_moisture,
        avg(soil_temperature)::numeric   as avg_temperature,
        avg(soil_ph)::numeric            as avg_ph,
        avg(soil_conductivity)::numeric  as avg_ec,
        avg(battery_level)::numeric      as avg_battery
      from public.m1_katara_telemetry
     where parcel_id   = p_parcel_id
       and recorded_at >= p_since;
$$;

revoke all on function public.m1_katara_telemetry_7d_avg(uuid, timestamptz) from public;
grant  execute on function public.m1_katara_telemetry_7d_avg(uuid, timestamptz)
    to service_role;

comment on function public.m1_katara_telemetry_7d_avg(uuid, timestamptz) is
    'KAT-08 — 7-day per-parcel sensor aggregate. SECURITY DEFINER + service_role-only '
    'EXECUTE. Surfaces the five corrected-payload metrics: soil_moisture, '
    'soil_temperature, soil_pH, soil_conductivity, battery_level.';
