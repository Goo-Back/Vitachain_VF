-- =============================================================================
-- 0010 — Bring public._migrations under the AUTH-04 RLS contract.
-- Story:  AUTH-04 (caught by db/tests/auth04_rls_contract.sql on first run)
--
-- public._migrations is created by db/scripts/push.sh's preamble, not by a
-- migration, so it slipped past the migration 0009 event trigger. The AUTH-04
-- contract is "every public.* relation has RLS enabled + at least one policy".
-- _migrations is service-role-only bookkeeping; non-admin sessions have no
-- legitimate read or write on it.
--
-- Policy posture:
--   * RLS enabled
--   * One ADMIN-read policy (service-role JWT bypasses RLS so push.sh continues
--     to work; this policy is just for the case where an admin user logs in
--     via a normal session).
--   * No INSERT/UPDATE/DELETE policy → only service-role can write to it.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table if exists public._migrations enable row level security;

drop policy if exists "_migrations_select_admin" on public._migrations;
create policy "_migrations_select_admin"
    on public._migrations for select
    using (public.is_admin());
