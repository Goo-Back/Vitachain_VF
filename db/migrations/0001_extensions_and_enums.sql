-- =============================================================================
-- 0001 — Extensions and enums shared across all VitaChain modules.
-- Story:  INF-02 (docs/stories/INF-02-supabase-project-base-schema.md)
-- Idempotent: safe to re-run.
-- =============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid(), digest()
create extension if not exists "pg_trgm";    -- fuzzy search (FarMarket FAR-02)
create extension if not exists "citext";     -- case-insensitive email columns

-- ---------------------------------------------------------------------------
-- user_role — PRD §7.1 AUTH-02.
-- Drives every RLS policy ("only FARMER can do X"), so it must exist before
-- any module-specific migration references it.
-- ---------------------------------------------------------------------------
do $$ begin
    create type public.user_role as enum ('FARMER','RESTAURANT','CITIZEN','ADMIN');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- verification_status — PRD §7.1 AUTH-06.
-- Gate for "professional" actions (create ad, publish meal). Default is
-- PENDING for every new professional; admin flips to VERIFIED in ADM-02.
-- ---------------------------------------------------------------------------
do $$ begin
    create type public.verification_status as enum ('PENDING','VERIFIED','REJECTED');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- locale_code — PRD §7.2.
-- Stored on profile to drive Brevo template selection (NOT-02..NOT-06) and
-- Gemini prompt localization (I18N-06). MVD ships fr/ar/en only.
-- ---------------------------------------------------------------------------
do $$ begin
    create type public.locale_code as enum ('fr','ar','en');
exception when duplicate_object then null; end $$;
