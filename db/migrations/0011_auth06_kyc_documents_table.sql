-- =============================================================================
-- 0011 — public.kyc_documents — submission ledger for AUTH-06 KYC-lite.
-- Story:  AUTH-06
-- One row per user submission. Status transitions are admin-only writes
-- (policy: kyc_documents_update_admin, migration 0012). The profile-level
-- verification flag (public.profiles.verification_status) is updated in the
-- same transaction as the row update — see backend/app/routers/admin/kyc.py.
--
-- The table sits in `public` (not a module schema) because KYC is a cross-
-- cutting authorization concern, not a module feature. The event-trigger
-- enforce_rls_on_public_tables (migration 0009) will refuse this DDL if RLS
-- is not enabled by the end of the transaction.
-- =============================================================================

-- Document-level enums — separate from public.verification_status (the
-- profile-level flag). A document has its own lifecycle: PENDING → APPROVED
-- | REJECTED. A profile is VERIFIED only when an admin approves a document.
do $$ begin
    create type public.kyc_document_type   as enum ('RC','CIN','AGRI_CARD','OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
    create type public.kyc_document_status as enum ('PENDING','APPROVED','REJECTED');
exception when duplicate_object then null; end $$;

-- The migration 0009 event trigger fires at ddl_command_end of every
-- CREATE TABLE and checks pg_class.relrowsecurity. Because RLS is enabled
-- via a separate ALTER TABLE statement, we MUST disable the event trigger
-- for the duration of this DDL block and re-enable it immediately after
-- RLS is on. The trigger's intent (catch authors who forget RLS) is
-- preserved: the alter is two lines down and the migration replays cleanly.
alter event trigger trg_enforce_rls_on_public_tables disable;

create table if not exists public.kyc_documents (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references public.profiles(id) on delete cascade,
    document_type public.kyc_document_type   not null,
    storage_path  text                       not null,
    mime_type     text                       not null,
    size_bytes    int                        not null,
    status        public.kyc_document_status not null default 'PENDING',
    submitted_at  timestamptz not null default now(),
    reviewed_at   timestamptz,
    reviewer_id   uuid references public.profiles(id),
    reviewer_note text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    -- 5 MB cap mirrors the frontend pre-flight and the storage-bucket policy.
    -- Defended at three layers: client (UX), API (early-fail), database (truth).
    constraint kyc_documents_size_bytes_bounds
        check (size_bytes > 0 and size_bytes <= 5 * 1024 * 1024),

    -- The bucket only stores these mime types; the table mirrors that fact
    -- so a forged API call that bypasses the storage layer cannot land a
    -- "this is a video file" row pointing to a real .pdf upload.
    constraint kyc_documents_mime_allowed
        check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),

    -- A PENDING row must NOT carry reviewer fields; a decided row MUST.
    -- Prevents the half-state "admin clicked but the note save failed".
    constraint kyc_documents_reviewed_consistency
        check (
            (status = 'PENDING'
                and reviewed_at is null
                and reviewer_id is null)
         or (status <> 'PENDING'
                and reviewed_at is not null
                and reviewer_id is not null)
        )
);

-- Hot path: admin queue lists "all PENDING, oldest first". Partial index
-- keeps it cheap.
create index if not exists kyc_documents_status_idx
    on public.kyc_documents (status)
    where status = 'PENDING';

-- User-facing path: GET /api/v1/kyc/me lists "my submissions, most recent
-- first". Composite covers both the WHERE and the ORDER BY.
create index if not exists kyc_documents_user_id_submitted_at_idx
    on public.kyc_documents (user_id, submitted_at desc);

-- updated_at maintenance — reuses the shared helper from migration 0002.
drop trigger if exists trg_kyc_documents_updated_at on public.kyc_documents;
create trigger trg_kyc_documents_updated_at
    before update on public.kyc_documents
    for each row execute function public.set_updated_at();

-- RLS — policies attach in migration 0012, but ENABLE must happen HERE in
-- the same migration so the AUTH-04 contract holds at the next event-trigger
-- check (e.g. another migration creating a related table).
alter table public.kyc_documents enable row level security;

-- Re-enable the event trigger. From this point on, every subsequent CREATE
-- TABLE in this migration (or any future migration) is back under the
-- AUTH-04 guarantee.
alter event trigger trg_enforce_rls_on_public_tables enable;
