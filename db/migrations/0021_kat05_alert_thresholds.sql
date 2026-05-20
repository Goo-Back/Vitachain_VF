-- =============================================================================
-- 0021 — M1 Katara: configurable alert thresholds per metric (KAT-05).
-- Story:  KAT-05 (docs/stories/KAT-05-alert-thresholds.md)
--
-- One table (m1_katara_thresholds), one IMMUTABLE defaults helper function,
-- one RLS policy quartet (owner read, admin read, owner-verified insert,
-- owner-verified update), and two triggers (farmer_id auto-fill on insert +
-- audit-column guard that silently clamps last_alert_at/last_alert_value for
-- every role except service_role).
--
-- The persistence half of the alert pipeline. KAT-06 reads this on every
-- NOTIFY katara_telemetry_inserted, compares against the telemetry row, and
-- — if a bound is breached and the BR-K2 24h suppression has elapsed —
-- sends an email AND writes back last_alert_at / last_alert_value. Only
-- service_role may write those audit columns; the trigger below enforces it
-- by silently clamping non-service writes (we'd rather drop the field than
-- block a legitimate threshold change behind a frontend bug).
--
-- Note on numbering: the story §5.1 names this file 0020 but slot 0020 was
-- already taken by KAT-04's telemetry history aggregator. Moving to 0021.
-- =============================================================================

-- ─── Table ──────────────────────────────────────────────────────────────────
-- AUTH-04 — the trg_enforce_rls_on_public_tables event trigger refuses any
-- new public.* table without RLS enabled by ddl_command_end. Same scaffolding
-- as migration 0016 (KAT-01 parcels): disable around CREATE TABLE, enable
-- RLS, re-arm the trigger.
alter event trigger trg_enforce_rls_on_public_tables disable;

create table if not exists public.m1_katara_thresholds (
    id            uuid primary key default gen_random_uuid(),
    parcel_id     uuid not null references public.m1_katara_parcels(id) on delete cascade,
    farmer_id     uuid not null references public.profiles(id) on delete cascade,
    metric        text not null,
    min_value     real,
    max_value     real,
    enabled       boolean not null default true,
    last_alert_at    timestamptz,        -- BR-K2 — KAT-06 worker writes
    last_alert_value real,               -- BR-K2 — KAT-06 worker writes
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint kat_threshold_metric_known check (metric in (
        'soil_moisture', 'soil_temperature', 'soil_ph',
        'soil_conductivity', 'battery_level'
    )),
    constraint kat_threshold_one_per_metric unique (parcel_id, metric),
    constraint kat_threshold_at_least_one_bound check (
        min_value is not null or max_value is not null
    ),
    constraint kat_threshold_min_lt_max check (
        min_value is null or max_value is null or min_value < max_value
    ),
    constraint kat_threshold_per_metric_range check (
        case metric
            when 'soil_moisture'     then (min_value is null or (min_value between 0 and 100))
                                       and (max_value is null or (max_value between 0 and 100))
            when 'soil_temperature'  then (min_value is null or (min_value between -20 and 80))
                                       and (max_value is null or (max_value between -20 and 80))
            when 'soil_ph'           then (min_value is null or (min_value between 0 and 14))
                                       and (max_value is null or (max_value between 0 and 14))
            when 'soil_conductivity' then (min_value is null or (min_value between 0 and 20000))
                                       and (max_value is null or (max_value between 0 and 20000))
            when 'battery_level'     then (min_value is null or (min_value between 0 and 100))
                                       and (max_value is null or (max_value between 0 and 100))
            else false
        end
    )
);

-- RLS — must be enabled before the event trigger re-arms, per AUTH-04 contract.
alter table public.m1_katara_thresholds enable row level security;
alter table public.m1_katara_thresholds force row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

create index if not exists kat_thresholds_parcel_metric_idx
    on public.m1_katara_thresholds (parcel_id, metric);

comment on table public.m1_katara_thresholds is
    'KAT-05 — per-parcel alert thresholds. Owner-writable (when VERIFIED); '
    'last_alert_at / last_alert_value are service-role-only via trigger '
    'clamp — KAT-06 worker is the sole legitimate writer.';

-- ─── Defaults helper ────────────────────────────────────────────────────────
-- Single source of truth for "the agronomic defaults we fall back to when a
-- parcel has no row yet for a given metric". The API hydration path calls
-- this once per missing metric; the function is IMMUTABLE so Postgres caches
-- the value across statements within a transaction.
create or replace function public.m1_katara_threshold_defaults(p_metric text)
returns table (min_value real, max_value real, enabled boolean)
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
    select t.min_value, t.max_value, t.enabled
      from (values
        ('soil_moisture',     25::real, 75::real,   true),
        ('soil_temperature',  5::real,  35::real,   true),
        ('soil_ph',           5.5::real, 7.5::real, true),
        ('soil_conductivity', 400::real, 3000::real, true),
        ('battery_level',     15::real, null::real, true)
      ) as t(metric, min_value, max_value, enabled)
     where t.metric = p_metric;
$$;

revoke all on function public.m1_katara_threshold_defaults(text) from public;
grant execute on function public.m1_katara_threshold_defaults(text) to authenticated;
grant execute on function public.m1_katara_threshold_defaults(text) to service_role;

-- ─── Triggers ───────────────────────────────────────────────────────────────
-- The fill-farmer-id trigger runs BEFORE the audit-guard trigger thanks to
-- alphabetical name ordering (Postgres fires same-event triggers by name).

create or replace function public.m1_katara_thresholds_fill_farmer_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.farmer_id is null then
        select farmer_id into new.farmer_id
          from public.m1_katara_parcels
         where id = new.parcel_id;
    end if;
    return new;
end;
$$;

drop trigger if exists m1_katara_thresholds_fill_farmer_id
    on public.m1_katara_thresholds;
create trigger m1_katara_thresholds_fill_farmer_id
    before insert on public.m1_katara_thresholds
    for each row execute function public.m1_katara_thresholds_fill_farmer_id();

create or replace function public.m1_katara_thresholds_audit_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_role text;
begin
    -- service_role bypasses RLS entirely; the trigger still runs for it. Let
    -- the worker (KAT-06) write last_alert_at / last_alert_value freely.
    v_role := coalesce(current_setting('request.jwt.claim.role', true),
                       current_setting('role', true));
    if v_role = 'service_role' or current_user = 'service_role' then
        if tg_op = 'UPDATE' then
            new.updated_at := now();
        end if;
        return new;
    end if;

    if tg_op = 'INSERT' then
        new.last_alert_at    := null;
        new.last_alert_value := null;
        return new;
    elsif tg_op = 'UPDATE' then
        -- Preserve the audit columns + identity fields. A buggy frontend
        -- that sends last_alert_at in the PUT body silently has the field
        -- dropped rather than the whole save failing.
        new.last_alert_at    := old.last_alert_at;
        new.last_alert_value := old.last_alert_value;
        new.created_at       := old.created_at;
        new.updated_at       := now();
        new.farmer_id        := old.farmer_id;
        new.parcel_id        := old.parcel_id;
        new.metric           := old.metric;
        return new;
    end if;
    return new;
end;
$$;

drop trigger if exists m1_katara_thresholds_audit_guard
    on public.m1_katara_thresholds;
create trigger m1_katara_thresholds_audit_guard
    before insert or update on public.m1_katara_thresholds
    for each row execute function public.m1_katara_thresholds_audit_guard();

-- ─── RLS policies ───────────────────────────────────────────────────────────
-- (force_rls + enable_rls were turned on right after CREATE TABLE above to
-- satisfy the AUTH-04 event trigger.)

-- 1) Owner reads own rows.
drop policy if exists "kat_thresholds_select_own" on public.m1_katara_thresholds;
create policy "kat_thresholds_select_own"
    on public.m1_katara_thresholds for select to authenticated
    using (auth.uid() = farmer_id);

-- 2) Admin reads all rows (matches the AUTH-07 admin-read pattern).
drop policy if exists "kat_thresholds_select_admin" on public.m1_katara_thresholds;
create policy "kat_thresholds_select_admin"
    on public.m1_katara_thresholds for select to authenticated
    using (public.is_admin());

-- 3) Only a VERIFIED owner FARMER may insert a row for their own parcel.
--    Mirrors the verification gate used on m1_katara_parcels (migration 0016).
drop policy if exists "kat_thresholds_insert_verified_own"
    on public.m1_katara_thresholds;
create policy "kat_thresholds_insert_verified_own"
    on public.m1_katara_thresholds for insert to authenticated
    with check (
        auth.uid() = farmer_id
        and public.has_role('FARMER'::public.user_role)
        and (
            select verification_status
              from public.profiles
             where id = auth.uid()
        ) = 'VERIFIED'
    );

-- 4) Owner UPDATE — verified gate, pinned to ownership on both sides.
drop policy if exists "kat_thresholds_update_verified_own"
    on public.m1_katara_thresholds;
create policy "kat_thresholds_update_verified_own"
    on public.m1_katara_thresholds for update to authenticated
    using       (auth.uid() = farmer_id)
    with check (
        auth.uid() = farmer_id
        and public.has_role('FARMER'::public.user_role)
        and (
            select verification_status
              from public.profiles
             where id = auth.uid()
        ) = 'VERIFIED'
    );

-- No DELETE policy by design — a farmer "turns off" a metric via enabled=false
-- so the audit trail is preserved. The service role can DELETE if ever needed.
