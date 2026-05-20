-- =============================================================================
-- 0024 — M1 Katara: KAT-09 diagnostic COMPLETED notification trigger.
-- Story: KAT-09 (docs/stories/KAT-09-async-diagnostic-brevo-email-on-completion.md)
--
-- Pure addition on top of KAT-08's schema (migration 0023). Two changes:
--
--   1. notified_at TIMESTAMPTZ column on m1_katara_diagnostics — idempotency
--      anchor for the KAT-09 email worker. NULL = email not yet dispatched;
--      non-null timestamp = Brevo 2xx already received. The backstop scan
--      filters on `notified_at IS NULL` so a worker restart between Brevo's
--      2xx and the audit write retries the row (at-most-once in steady
--      state, at-least-once across the crash window — same trade-off KAT-06
--      accepts for last_alert_at).
--
--   2. AFTER UPDATE trigger m1_katara_diagnostics_notify_completed emitting
--      NOTIFY 'katara_diagnostic_completed' with new.id::text payload, gated
--      so it fires once and only once on the first PROCESSING → COMPLETED
--      transition (and never on FAILED, never on admin edits of an already-
--      COMPLETED row). Mirrors the KAT-08 notify_requested trigger shape so
--      the AUTH-07 D-15 cell uses the same probe pattern.
--
-- No RLS change: notified_at inherits the table's existing owner-SELECT +
-- admin-SELECT + no-authenticated-UPDATE policy set. The audit-guard trigger
-- planted in KAT-07's migration 0022 already silently clamps non-service
-- writers to OLD values, so a forged farmer UPDATE that tries to set
-- notified_at is a no-op without any new policy.
-- =============================================================================

-- ─── (1) notified_at column ─────────────────────────────────────────────────

alter table public.m1_katara_diagnostics
    add column if not exists notified_at timestamptz;

comment on column public.m1_katara_diagnostics.notified_at is
    'KAT-09 — Timestamp of Brevo email dispatch. NULL = email not yet sent. '
    'Worker writes this after Brevo 2xx; the NULL guard prevents double-send '
    'on listener restart.';

-- ─── (2) NOTIFY trigger on COMPLETED transition ─────────────────────────────

create or replace function public.m1_katara_diagnostics_notify_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform pg_notify(
        'katara_diagnostic_completed',
        new.id::text
    );
    return new;
end;
$$;

comment on function public.m1_katara_diagnostics_notify_completed() is
    'KAT-09 — fires NOTIFY ''katara_diagnostic_completed'' once on the first '
    'PROCESSING → COMPLETED transition. The KAT-09 email worker LISTENs on '
    'that channel.';

drop trigger if exists m1_katara_diagnostics_notify_completed
    on public.m1_katara_diagnostics;
create trigger m1_katara_diagnostics_notify_completed
    after update on public.m1_katara_diagnostics
    for each row
    when (old.status is distinct from 'COMPLETED' and new.status = 'COMPLETED')
    execute function public.m1_katara_diagnostics_notify_completed();
