-- =============================================================================
-- 0015 — notifications_outbox + notification_type enum (KYC values).
-- Story:  AUTH-06 (NOT-01 will extend table semantics and own the dispatcher)
--
-- AUTH-06 enqueues three notification types on KYC state transitions:
--   * kyc.submitted — emitted by the user-facing /kyc/submit handler.
--   * kyc.approved  — emitted by the admin /admin/kyc/{id}/decide handler.
--   * kyc.rejected  — emitted by the same admin handler.
--
-- The migration is idempotent on every artifact so the order between this
-- file and a future NOT-01 migration that also creates the enum/table does
-- not matter:
--   * enum  → ADD VALUE IF NOT EXISTS for each KYC literal.
--   * table → CREATE TABLE IF NOT EXISTS with the minimal shape AUTH-06
--             needs (NOT-01 may ALTER it later to add dispatcher columns).
-- =============================================================================

do $$ begin
    create type public.notification_type as enum (
        'kyc.submitted', 'kyc.approved', 'kyc.rejected'
    );
exception when duplicate_object then null; end $$;

alter type public.notification_type add value if not exists 'kyc.submitted';
alter type public.notification_type add value if not exists 'kyc.approved';
alter type public.notification_type add value if not exists 'kyc.rejected';

-- See migration 0011 header for the rationale on disabling the AUTH-04
-- event trigger while a new public.* table is being created and brought
-- under RLS in the same migration.
alter event trigger trg_enforce_rls_on_public_tables disable;

create table if not exists public.notifications_outbox (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.profiles(id) on delete cascade,
    type        public.notification_type not null,
    locale      public.locale_code       not null default 'fr',
    context     jsonb                    not null default '{}'::jsonb,
    -- Dispatch bookkeeping — NOT-01 will read/write these.
    dispatched_at timestamptz,
    attempts      int         not null default 0,
    last_error    text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists notifications_outbox_pending_idx
    on public.notifications_outbox (created_at)
    where dispatched_at is null;

create index if not exists notifications_outbox_user_id_idx
    on public.notifications_outbox (user_id, created_at desc);

drop trigger if exists trg_notifications_outbox_updated_at on public.notifications_outbox;
create trigger trg_notifications_outbox_updated_at
    before update on public.notifications_outbox
    for each row execute function public.set_updated_at();

-- RLS — the event trigger from 0009 will refuse the table without it.
-- The outbox is system-internal: users do NOT read it, admins MAY read it
-- (audit trail), and the dispatcher (NOT-01) reads/writes under service_role
-- which bypasses RLS.
alter table public.notifications_outbox enable row level security;

-- Re-enable the event trigger — see migration 0011 for rationale.
alter event trigger trg_enforce_rls_on_public_tables enable;

drop policy if exists "notifications_outbox_select_admin" on public.notifications_outbox;
create policy "notifications_outbox_select_admin"
    on public.notifications_outbox for select to authenticated
    using (public.is_admin());

-- Users enqueue their own notifications (e.g. /kyc/submit writes kyc.submitted
-- under the user's JWT). The WITH CHECK pins user_id to the caller so a
-- user cannot impersonate someone else's notification stream.
drop policy if exists "notifications_outbox_insert_own" on public.notifications_outbox;
create policy "notifications_outbox_insert_own"
    on public.notifications_outbox for insert to authenticated
    with check (auth.uid() = user_id);
