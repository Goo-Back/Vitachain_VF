-- =============================================================================
-- 0016 — M1 Katara: farmer parcel registry.
-- Story:  KAT-01 (docs/stories/KAT-01-farmer-registers-parcel.md)
--
-- One parcel = one monitored field. Every subsequent KAT-* story attaches to
-- a parcel row:
--   * KAT-02 — m1_katara_devices.parcel_id FK
--   * KAT-03 — telemetry rows scoped by device → parcel
--   * KAT-04 — dashboard charts grouped per parcel
--   * KAT-05 — alert thresholds set per parcel/device/metric
--   * KAT-07 — AI diagnostic input snapshot
--
-- AUTH-06 gate: only a VERIFIED FARMER may INSERT — mirrored at three
-- layers (FastAPI _require_verified_farmer, this RLS WITH CHECK, and the
-- profiles row read inside the policy). The same defence-in-depth pattern
-- as kyc_documents (migration 0011/0012).
--
-- The migration 0009 event trigger refuses any new public.* table without
-- RLS enabled by ddl_command_end, so we disable it around the CREATE TABLE
-- and re-enable immediately after `alter table … enable row level security`
-- (same scaffolding as 0011 and 0015 — see their headers for rationale).
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

create table if not exists public.m1_katara_parcels (
    id              uuid            primary key default gen_random_uuid(),
    farmer_id       uuid            not null references public.profiles(id) on delete cascade,
    name            text            not null,
    -- Raw GeoJSON object (Feature, Polygon or MultiPolygon). Full structural
    -- validation lives in the FastAPI layer (app.modules.katara.schemas);
    -- the DB constraint below is a last-resort "must be an object with a
    -- type key" guard against bypass writes.
    geojson         jsonb           not null
                        constraint m1_katara_parcels_geojson_has_type
                            check (jsonb_typeof(geojson) = 'object' and geojson ? 'type'),
    crop_type       text            not null,
    surface_area_ha decimal(10, 4)  not null
                        constraint m1_katara_parcels_area_positive
                            check (surface_area_ha > 0),
    created_at      timestamptz     not null default now(),
    updated_at      timestamptz     not null default now()
);

-- Hot path: "all parcels owned by farmer X" — KAT-04 dashboard + KAT-14
-- multi-parcel listing both filter on farmer_id.
create index if not exists m1_katara_parcels_farmer_idx
    on public.m1_katara_parcels (farmer_id);

-- updated_at maintenance — reuses the shared helper from migration 0002.
drop trigger if exists trg_m1_katara_parcels_updated_at on public.m1_katara_parcels;
create trigger trg_m1_katara_parcels_updated_at
    before update on public.m1_katara_parcels
    for each row execute function public.set_updated_at();

-- RLS — must be enabled before the event trigger re-arms, per AUTH-04 contract.
alter table public.m1_katara_parcels enable row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

-- ── Policies ─────────────────────────────────────────────────────────────────

-- 1. Owner reads their own parcels.
drop policy if exists "katara_parcels_select_own" on public.m1_katara_parcels;
create policy "katara_parcels_select_own"
    on public.m1_katara_parcels for select to authenticated
    using (auth.uid() = farmer_id);

-- 2. Admin reads every parcel (monitoring / audit). Uses the SECURITY DEFINER
--    helper from migration 0005 — never reads public.profiles directly inside
--    a policy (recursion class of bug, see migration 0005 header).
drop policy if exists "katara_parcels_admin_select" on public.m1_katara_parcels;
create policy "katara_parcels_admin_select"
    on public.m1_katara_parcels for select to authenticated
    using (public.is_admin());

-- 3. Only a VERIFIED FARMER may create a parcel (AUTH-06 gate). The
--    verification_status sub-select reads the caller's own profiles row;
--    public.has_role() is the SECURITY DEFINER helper from migration 0008.
--    Mirrors the FastAPI _require_verified_farmer() guard in
--    backend/app/modules/katara/router.py.
drop policy if exists "katara_parcels_insert_verified_farmer" on public.m1_katara_parcels;
create policy "katara_parcels_insert_verified_farmer"
    on public.m1_katara_parcels for insert to authenticated
    with check (
        auth.uid() = farmer_id
        and public.has_role('FARMER'::public.user_role)
        and (
            select verification_status
              from public.profiles
             where id = auth.uid()
        ) = 'VERIFIED'
    );

-- 4. Owner may update their own parcels (name, crop type, surface, geojson).
--    Both USING and WITH CHECK pin to ownership so a farmer cannot reassign
--    a parcel to another farmer via UPDATE farmer_id.
drop policy if exists "katara_parcels_update_own" on public.m1_katara_parcels;
create policy "katara_parcels_update_own"
    on public.m1_katara_parcels for update to authenticated
    using       (auth.uid() = farmer_id)
    with check  (auth.uid() = farmer_id);

-- 5. Owner may delete their own parcels.
--    KAT-02 will add an app-level guard (and an FK ON DELETE RESTRICT on
--    m1_katara_devices.parcel_id) to block deletion when a device is linked.
--    Intentionally permissive during KAT-01 — no devices exist yet.
drop policy if exists "katara_parcels_delete_own" on public.m1_katara_parcels;
create policy "katara_parcels_delete_own"
    on public.m1_katara_parcels for delete to authenticated
    using (auth.uid() = farmer_id);
