-- =============================================================================
-- 0017 — M1 Katara: ESP32 device registry.
-- Story:  KAT-02 (docs/stories/KAT-02-esp32-device-pairing.md)
--
-- Each row = one physical ESP32 paired to one parcel. The api_key is generated
-- server-side (vk_<32 hex>), hashed with bcrypt before insert, and the plaintext
-- is shown to the farmer exactly once at pairing time. KAT-03's < 50 ms ingest
-- endpoint validates incoming payloads via public.verify_device_api_key(), the
-- SECURITY DEFINER helper at the bottom of this file (constant-time compare via
-- pgcrypto.crypt — same primitive as AUTH-03's password verifier).
--
-- BR-K1 ("1 ESP32 ↔ 1 parcel at a time", PRD §6.1.2) is enforced by a partial
-- unique index filtered to non-UNLINKED rows so KAT-12 can soft-detach and the
-- farmer can pair a fresh device without first DELETEing the old row.
--
-- The migration 0009 event trigger refuses any new public.* table without
-- RLS enabled by ddl_command_end, so we disable it around the CREATE TABLE
-- and re-enable immediately after `alter table … enable row level security`
-- (same scaffolding as 0011 / 0015 / 0016).
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ── Enum ─────────────────────────────────────────────────────────────────────
do $$
begin
    if not exists (select 1 from pg_type where typname = 'device_status') then
        create type public.device_status as enum (
            'PENDING',     -- paired, no telemetry yet
            'ACTIVE',      -- telemetry within the last hour (set by KAT-03)
            'OFFLINE',     -- > 1h since last telemetry (set by KAT-11 worker)
            'UNLINKED'     -- soft-detached (KAT-12); kept for history (KAT-13)
        );
    end if;
end$$;

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.m1_katara_devices (
    id              uuid                primary key default gen_random_uuid(),
    device_id       text                not null
                        constraint m1_katara_devices_device_id_format
                            check (device_id ~ '^ESP-KAT-\d{3}$'),
    parcel_id       uuid                not null
                        references public.m1_katara_parcels(id) on delete restrict,
    -- Denormalised from parcels.farmer_id so the hot ingest path (KAT-03) can
    -- do RLS-free direct inserts via the service role without a join. Kept in
    -- sync by trg_m1_katara_devices_sync_farmer below.
    farmer_id       uuid                not null
                        references public.profiles(id) on delete cascade,
    api_key_hash    text                not null,
    api_key_last4   text                not null
                        constraint m1_katara_devices_last4_len
                            check (length(api_key_last4) = 4),
    status          public.device_status not null default 'PENDING',
    last_seen       timestamptz,
    created_at      timestamptz         not null default now(),
    updated_at      timestamptz         not null default now()
);

-- BR-K1: one active device per parcel. The partial filter is required because
-- KAT-12 will soft-detach via status='UNLINKED' rather than DELETE — a hard
-- unique on parcel_id would block legitimate re-pairing post-unlink.
create unique index if not exists m1_katara_devices_one_active_per_parcel
    on public.m1_katara_devices (parcel_id)
    where status <> 'UNLINKED';

-- Same logic for device_id: an unlinked physical device can be re-paired,
-- which creates a NEW row, but only one non-UNLINKED row per device_id is
-- allowed at any time.
create unique index if not exists m1_katara_devices_one_active_per_device_id
    on public.m1_katara_devices (device_id)
    where status <> 'UNLINKED';

-- Lookup by owner for the dashboard.
create index if not exists m1_katara_devices_farmer_idx
    on public.m1_katara_devices (farmer_id);

-- updated_at maintenance — reuses set_updated_at() from migration 0002.
drop trigger if exists trg_m1_katara_devices_updated_at on public.m1_katara_devices;
create trigger trg_m1_katara_devices_updated_at
    before update on public.m1_katara_devices
    for each row execute function public.set_updated_at();

-- Keep farmer_id consistent with the linked parcel. Runs on INSERT only —
-- UPDATE of parcel_id is handled in KAT-12's relink flow.
create or replace function public.m1_katara_devices_sync_farmer()
returns trigger
language plpgsql
as $$
declare
    v_farmer uuid;
begin
    select farmer_id into v_farmer
    from   public.m1_katara_parcels
    where  id = new.parcel_id;

    if v_farmer is null then
        raise exception 'parcel % does not exist or is not visible', new.parcel_id;
    end if;
    new.farmer_id := v_farmer;
    return new;
end$$;

drop trigger if exists trg_m1_katara_devices_sync_farmer on public.m1_katara_devices;
create trigger trg_m1_katara_devices_sync_farmer
    before insert on public.m1_katara_devices
    for each row execute function public.m1_katara_devices_sync_farmer();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.m1_katara_devices enable row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

drop policy if exists "katara_devices_select_own" on public.m1_katara_devices;
create policy "katara_devices_select_own"
    on public.m1_katara_devices for select to authenticated
    using (auth.uid() = farmer_id);

drop policy if exists "katara_devices_admin_select" on public.m1_katara_devices;
create policy "katara_devices_admin_select"
    on public.m1_katara_devices for select to authenticated
    using (public.is_admin());

-- INSERT: must be a VERIFIED FARMER pairing on a parcel they own.
-- Mirrors the FastAPI _require_verified_farmer + ownership check
-- (defence-in-depth, AUTH-04 pattern).
drop policy if exists "katara_devices_insert_verified_farmer_owns_parcel"
    on public.m1_katara_devices;
create policy "katara_devices_insert_verified_farmer_owns_parcel"
    on public.m1_katara_devices for insert to authenticated
    with check (
        auth.uid() = farmer_id
        and public.has_role('FARMER'::public.user_role)
        and (
            select verification_status
              from public.profiles
             where id = auth.uid()
        ) = 'VERIFIED'
        and exists (
            select 1
              from public.m1_katara_parcels p
             where p.id        = parcel_id
               and p.farmer_id = auth.uid()
        )
    );

drop policy if exists "katara_devices_update_own" on public.m1_katara_devices;
create policy "katara_devices_update_own"
    on public.m1_katara_devices for update to authenticated
    using       (auth.uid() = farmer_id)
    with check  (auth.uid() = farmer_id);

drop policy if exists "katara_devices_delete_own" on public.m1_katara_devices;
create policy "katara_devices_delete_own"
    on public.m1_katara_devices for delete to authenticated
    using (auth.uid() = farmer_id);

-- ── KAT-03 hand-off: constant-time api_key verifier ──────────────────────────
-- crypt(plaintext, stored_hash) recomputes bcrypt with the same salt+cost from
-- the stored hash and returns a value byte-equal to stored_hash on a match. The
-- comparison itself is performed in pgcrypto's C code which is constant-time
-- with respect to the byte values (only the cost factor leaks). This is the
-- same primitive used by AUTH-03's password verifier — see runbook §AUTH-03.
--
-- Supabase installs pgcrypto in the `extensions` schema (not `public`), so we
-- schema-qualify `extensions.crypt(...)` rather than adding `extensions` to
-- the SECURITY DEFINER function's search_path. Locking the search_path to
-- public, pg_temp prevents a malicious schema-prefix injection from rerouting
-- the call to an attacker-controlled `crypt`.
create or replace function public.verify_device_api_key(
    p_device_id text,
    p_api_key   text
)
returns table (
    device_row_id uuid,
    parcel_id     uuid,
    farmer_id     uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select d.id, d.parcel_id, d.farmer_id
      from public.m1_katara_devices d
     where d.device_id     = p_device_id
       and d.status       <> 'UNLINKED'
       and d.api_key_hash  = extensions.crypt(p_api_key, d.api_key_hash)
     limit 1;
$$;

revoke all on function public.verify_device_api_key(text, text) from public;
grant execute on function public.verify_device_api_key(text, text) to service_role;
