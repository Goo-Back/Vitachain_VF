-- =============================================================================
-- 0018 — M1 Katara: append-only telemetry stream.
-- Story:  KAT-03 (docs/stories/KAT-03-esp32-telemetry-ingestion.md)
--
-- Soil-focused payload (soil_ph + soil_conductivity) — supersedes the legacy
-- air_humidity / air_temperature columns documented in the v1 spec. See the
-- KAT-03 story §⚠ Pre-flight for the rationale.
--
-- The ingest endpoint (backend/app/modules/katara/ingest.py) writes via the
-- service role; RLS forbids every other actor from inserting. Reads are
-- scoped to the row's owning farmer (or admin). The table is append-only —
-- no UPDATE / DELETE policy by design; KAT-13 leans on that invariant.
--
-- One DB round-trip per request: public.m1_katara_ingest() composes
--   1) constant-time api_key verify  (public.verify_device_api_key, KAT-02)
--   2) telemetry insert              (trigger fills parcel_id / farmer_id)
--   3) device row touch              (status PENDING/OFFLINE -> ACTIVE, last_seen)
--   4) NOTIFY for KAT-06's threshold worker
--
-- The migration 0009 event trigger refuses any new public.* table without
-- RLS enabled by ddl_command_end, so we disable it around the CREATE TABLE
-- and re-enable immediately after `alter table … enable row level security`.
-- =============================================================================

alter event trigger trg_enforce_rls_on_public_tables disable;

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.m1_katara_telemetry (
    id                  uuid        primary key default gen_random_uuid(),
    device_id           uuid        not null
                            references public.m1_katara_devices(id) on delete restrict,
    parcel_id           uuid        not null
                            references public.m1_katara_parcels(id) on delete restrict,
    farmer_id           uuid        not null
                            references public.profiles(id) on delete cascade,
    soil_moisture       real        not null
                            constraint m1_katara_telemetry_moisture_pct
                                check (soil_moisture between 0 and 100),
    soil_temperature    real        not null
                            constraint m1_katara_telemetry_temp_celsius
                                check (soil_temperature between -20 and 80),
    soil_ph             real        not null
                            constraint m1_katara_telemetry_ph_range
                                check (soil_ph between 0 and 14),
    soil_conductivity   real        not null
                            constraint m1_katara_telemetry_ec_range
                                check (soil_conductivity between 0 and 20000),
    battery_level       smallint    not null
                            constraint m1_katara_telemetry_battery_pct
                                check (battery_level between 0 and 100),
    -- Device-supplied UTC timestamp. Future-ts rejection lives in Pydantic so
    -- legitimate backfills can break the rule when needed; no DB CHECK here.
    recorded_at         timestamptz not null,
    received_at         timestamptz not null default now()
);

-- Hot read path: "last N rows for one device" — covering index.
create index if not exists m1_katara_telemetry_device_recorded_at_idx
    on public.m1_katara_telemetry (device_id, recorded_at desc);

-- KAT-08's 7-day average: "all rows for one parcel in a window".
create index if not exists m1_katara_telemetry_parcel_recorded_at_idx
    on public.m1_katara_telemetry (parcel_id, recorded_at desc);

-- Dedup: refuse a second insert for the same (device, recorded_at). At the
-- 15-min cadence natural collisions are impossible, so a hit is either a
-- replay or a firmware-clock echo. We silently 204 on conflict (see the
-- m1_katara_ingest() function) rather than 409 so the field device does not
-- retry-loop.
create unique index if not exists m1_katara_telemetry_device_recorded_at_uniq
    on public.m1_katara_telemetry (device_id, recorded_at);

-- ── Denormalisation trigger ──────────────────────────────────────────────────
-- parcel_id and farmer_id are filled from the device row so the ingest path
-- passes only device_id + the metrics. One DB round-trip instead of two.
create or replace function public.m1_katara_telemetry_fill_owners()
returns trigger
language plpgsql
as $$
begin
    select d.parcel_id, d.farmer_id
      into new.parcel_id, new.farmer_id
    from   public.m1_katara_devices d
    where  d.id = new.device_id
      and  d.status <> 'UNLINKED';

    if new.farmer_id is null then
        raise exception 'm1_katara_telemetry: device % not found or unlinked', new.device_id
            using errcode = 'P0001';
    end if;
    return new;
end$$;

drop trigger if exists trg_m1_katara_telemetry_fill_owners on public.m1_katara_telemetry;
create trigger trg_m1_katara_telemetry_fill_owners
    before insert on public.m1_katara_telemetry
    for each row execute function public.m1_katara_telemetry_fill_owners();

-- ── NOTIFY trigger for KAT-06's threshold worker ─────────────────────────────
create or replace function public.m1_katara_telemetry_notify()
returns trigger
language plpgsql
as $$
begin
    perform pg_notify(
        'katara_telemetry_inserted',
        new.device_id::text || '|' || new.id::text
    );
    return new;
end$$;

drop trigger if exists trg_m1_katara_telemetry_notify on public.m1_katara_telemetry;
create trigger trg_m1_katara_telemetry_notify
    after insert on public.m1_katara_telemetry
    for each row execute function public.m1_katara_telemetry_notify();

-- ── Device status + last_seen sync ───────────────────────────────────────────
-- Flips PENDING/OFFLINE -> ACTIVE and stamps last_seen on every ingest.
create or replace function public.m1_katara_devices_touch_after_ingest(p_device_id uuid)
returns void
language sql
as $$
    update public.m1_katara_devices
       set status    = case
                         when status in ('PENDING'::public.device_status,
                                         'OFFLINE'::public.device_status)
                           then 'ACTIVE'::public.device_status
                         else status
                       end,
           last_seen = now()
     where id = p_device_id
       and status <> 'UNLINKED'::public.device_status;
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.m1_katara_telemetry enable row level security;
-- FORCE — the migrations role cannot bypass either; only service_role does.
-- Without this, the postgres superuser used by `supabase db push` could
-- still write through the RLS gate, muddying the AUTH-07 audit.
alter table public.m1_katara_telemetry force row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

drop policy if exists "katara_telemetry_select_own" on public.m1_katara_telemetry;
create policy "katara_telemetry_select_own"
    on public.m1_katara_telemetry for select to authenticated
    using (auth.uid() = farmer_id);

drop policy if exists "katara_telemetry_admin_select" on public.m1_katara_telemetry;
create policy "katara_telemetry_admin_select"
    on public.m1_katara_telemetry for select to authenticated
    using (public.is_admin());

-- No INSERT / UPDATE / DELETE policy by design — service role only writes,
-- nothing updates or deletes (append-only).

-- ── Latest-per-device view ───────────────────────────────────────────────────
-- KAT-04's live dashboard tile reads this to dodge the
-- "SELECT … ORDER BY recorded_at DESC LIMIT 1" full-scan trap on cold rows.
-- View inherits the underlying RLS — no separate policies needed.
create or replace view public.m1_katara_telemetry_latest as
select t.*
from   public.m1_katara_devices d
cross join lateral (
    select tt.*
    from   public.m1_katara_telemetry tt
    where  tt.device_id = d.id
    order  by tt.recorded_at desc
    limit  1
) t
where  d.status <> 'UNLINKED';

-- ── One-shot ingest wrapper used by the FastAPI endpoint ─────────────────────
-- Single function call -> one DB round trip:
--   1) verify api_key (calls KAT-02's verify_device_api_key())
--   2) insert telemetry (trigger fills parcel_id/farmer_id)
--   3) touch the device row (status + last_seen)
-- Returns the inserted (or pre-existing) row id, or NULL on bad credentials
-- so the FastAPI handler can answer 401 without leaking which of
-- (device_id, api_key) was wrong — same constant-error contract as AUTH-03's
-- password verify.
--
-- SECURITY DEFINER with a locked search_path. Owner is the migration role,
-- which is the only principal with INSERT on m1_katara_telemetry under the
-- FORCE-RLS regime — execution by service_role rides on the definer's
-- privileges.
create or replace function public.m1_katara_ingest(
    p_device_id_str     text,
    p_api_key           text,
    p_soil_moisture     real,
    p_soil_temperature  real,
    p_soil_ph           real,
    p_soil_conductivity real,
    p_battery_level     smallint,
    p_recorded_at       timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_device_row_id uuid;
    v_telemetry_id  uuid;
begin
    -- 1) constant-time api_key verify (pgcrypto.crypt inside the helper)
    select device_row_id
      into v_device_row_id
      from public.verify_device_api_key(p_device_id_str, p_api_key);

    if v_device_row_id is null then
        return null;  -- caller returns 401
    end if;

    -- 2) insert telemetry; ON CONFLICT(device_id, recorded_at) -> no-op update
    --    so RETURNING fires and the caller gets the pre-existing row id back.
    insert into public.m1_katara_telemetry as t (
        device_id, parcel_id, farmer_id,
        soil_moisture, soil_temperature, soil_ph, soil_conductivity,
        battery_level, recorded_at
    )
    values (
        v_device_row_id,
        '00000000-0000-0000-0000-000000000000'::uuid,  -- placeholder; trigger overwrites
        '00000000-0000-0000-0000-000000000000'::uuid,  -- placeholder; trigger overwrites
        p_soil_moisture, p_soil_temperature, p_soil_ph, p_soil_conductivity,
        p_battery_level, p_recorded_at
    )
    on conflict (device_id, recorded_at) do update
        set recorded_at = excluded.recorded_at  -- no-op write so RETURNING fires
    returning t.id into v_telemetry_id;

    -- 3) touch device row (last_seen + status PENDING/OFFLINE -> ACTIVE)
    perform public.m1_katara_devices_touch_after_ingest(v_device_row_id);

    return v_telemetry_id;
end$$;

revoke all on function public.m1_katara_ingest(
    text, text, real, real, real, real, smallint, timestamptz
) from public;
grant execute on function public.m1_katara_ingest(
    text, text, real, real, real, real, smallint, timestamptz
) to service_role;
