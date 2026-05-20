-- =============================================================================
-- 0022 — M1 Katara: AI diagnostic request table (KAT-07).
-- Story: KAT-07 (docs/stories/KAT-07-ai-diagnostic-request.md)
--
-- Persistence + request-surface half of the AI diagnostic pipeline. One table
-- (m1_katara_diagnostics), two business-rule triggers (farmer_id auto-fill +
-- audit-guard that locks status / result_text / error_detail / started_at /
-- completed_at to service_role), four RLS policies (owner SELECT, admin SELECT,
-- verified-owner INSERT, no UPDATE for authenticated — all status transitions
-- belong to the KAT-08/09 worker via service_role).
--
-- BR-K5 (one in-flight diagnostic per parcel) and BR-K6 (max 3/parcel/24h) are
-- enforced server-side in the FastAPI handler — neither maps cleanly to a
-- single-row CHECK or partial UNIQUE without dragging in a deferred constraint.
-- The handler check is fast (two indexed reads) and the endpoint is
-- human-initiated, so the slight race window is accepted for MVD.
--
-- KAT-08 and KAT-09 add no schema — they only UPDATE status / result_text /
-- error_detail / started_at / completed_at via service_role on rows this
-- migration created. KAT-10 polls GET /diagnostics/latest, which reads this
-- table.
-- =============================================================================

-- AUTH-04 — trg_enforce_rls_on_public_tables event trigger refuses any new
-- public.* table without RLS by ddl_command_end. Same disable-create-enable
-- scaffolding as 0016 (KAT-01) and 0021 (KAT-05).
alter event trigger trg_enforce_rls_on_public_tables disable;

create table if not exists public.m1_katara_diagnostics (
    id              uuid        primary key default gen_random_uuid(),
    parcel_id       uuid        not null
        references public.m1_katara_parcels(id) on delete cascade,
    farmer_id       uuid        not null
        references public.profiles(id) on delete cascade,
    status          text        not null default 'PENDING',
    result_text     text,                  -- filled by KAT-09 worker (service_role)
    error_detail    text,                  -- filled on FAILED (service_role)
    requested_at    timestamptz not null default now(),
    started_at      timestamptz,           -- set by KAT-08 worker on pickup
    completed_at    timestamptz,           -- set by KAT-09 worker on completion/failure

    constraint kat_diagnostic_status_known check (
        status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')
    )
);

alter table public.m1_katara_diagnostics enable row level security;
alter table public.m1_katara_diagnostics force row level security;

alter event trigger trg_enforce_rls_on_public_tables enable;

-- GET /latest — one indexed DESC scan, LIMIT 1. Also satisfies the BR-K6
-- 24h count (same leading column), no extra index required.
create index if not exists kat_diagnostics_parcel_latest_idx
    on public.m1_katara_diagnostics (parcel_id, requested_at desc);

comment on table public.m1_katara_diagnostics is
    'KAT-07 — one row per AI diagnostic request. '
    'status / result_text / error_detail / started_at / completed_at are '
    'service-role-only via trigger clamp — KAT-08/09 worker is the sole '
    'legitimate writer of those columns.';

-- ─── Triggers ────────────────────────────────────────────────────────────────
-- fill-farmer-id runs BEFORE the audit-guard thanks to alphabetical ordering
-- (Postgres fires same-event triggers by name).

create or replace function public.m1_katara_diagnostics_fill_farmer_id()
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

drop trigger if exists m1_katara_diagnostics_fill_farmer_id
    on public.m1_katara_diagnostics;
create trigger m1_katara_diagnostics_fill_farmer_id
    before insert on public.m1_katara_diagnostics
    for each row execute function public.m1_katara_diagnostics_fill_farmer_id();

-- Audit-guard: only service_role may write status / result / error / timestamps.
-- authenticated writers (a buggy frontend, a confused test) are silently
-- clamped back to the safe initial values rather than raising — a partial save
-- of unrelated fields never fails because the status column was in the payload.
create or replace function public.m1_katara_diagnostics_audit_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_role text;
begin
    v_role := coalesce(
        current_setting('request.jwt.claim.role', true),
        current_setting('role', true)
    );

    if v_role = 'service_role' or current_user = 'service_role' then
        return new;
    end if;

    -- Non-service writers: clamp all audit columns.
    if tg_op = 'UPDATE' then
        new.status        := old.status;
        new.result_text   := old.result_text;
        new.error_detail  := old.error_detail;
        new.started_at    := old.started_at;
        new.completed_at  := old.completed_at;
        new.parcel_id     := old.parcel_id;
        new.farmer_id     := old.farmer_id;
        new.requested_at  := old.requested_at;
    elsif tg_op = 'INSERT' then
        new.status        := 'PENDING';
        new.result_text   := null;
        new.error_detail  := null;
        new.started_at    := null;
        new.completed_at  := null;
    end if;
    return new;
end;
$$;

drop trigger if exists m1_katara_diagnostics_audit_guard
    on public.m1_katara_diagnostics;
create trigger m1_katara_diagnostics_audit_guard
    before insert or update on public.m1_katara_diagnostics
    for each row execute function public.m1_katara_diagnostics_audit_guard();

-- ─── RLS policies ────────────────────────────────────────────────────────────

drop policy if exists "kat_diagnostics_select_own" on public.m1_katara_diagnostics;
create policy "kat_diagnostics_select_own"
    on public.m1_katara_diagnostics for select to authenticated
    using (auth.uid() = farmer_id);

drop policy if exists "kat_diagnostics_select_admin" on public.m1_katara_diagnostics;
create policy "kat_diagnostics_select_admin"
    on public.m1_katara_diagnostics for select to authenticated
    using (public.is_admin());

drop policy if exists "kat_diagnostics_insert_verified_own"
    on public.m1_katara_diagnostics;
create policy "kat_diagnostics_insert_verified_own"
    on public.m1_katara_diagnostics for insert to authenticated
    with check (
        auth.uid() = farmer_id
        and public.has_role('FARMER'::public.user_role)
        and (
            select verification_status
              from public.profiles
             where id = auth.uid()
        ) = 'VERIFIED'
    );

-- No UPDATE policy for authenticated — all status transitions go through
-- service_role (KAT-08/09 worker). The audit-guard trigger would clamp an
-- authenticated UPDATE anyway, but having no UPDATE policy means the RLS
-- engine rejects the attempt before the trigger fires.
-- No DELETE policy — diagnostic history is immutable (a FAILED row stays for
-- audit trail; the farmer re-requests via a new INSERT).
