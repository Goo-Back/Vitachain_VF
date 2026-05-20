-- =============================================================================
-- 0012 — RLS policies for public.kyc_documents.
-- Story:  AUTH-06
-- Catalog patterns: owner-only (read, write at status=PENDING), admin-read,
-- admin-write. No DELETE policy — default-deny applies; the 30-day purge
-- worker runs as service-role and bypasses RLS.
-- =============================================================================

-- 1. Owner reads their own submissions.
drop policy if exists "kyc_documents_select_own" on public.kyc_documents;
create policy "kyc_documents_select_own"
    on public.kyc_documents for select to authenticated
    using (auth.uid() = user_id);

-- 2. Owner inserts a new submission. WITH CHECK pins the row to:
--    (a) the caller's own user_id (anti-impersonation),
--    (b) PENDING status (you cannot self-approve — admins decide),
--    (c) no reviewer fields (the consistency check would also catch this,
--        but the policy makes the intent explicit).
drop policy if exists "kyc_documents_insert_own" on public.kyc_documents;
create policy "kyc_documents_insert_own"
    on public.kyc_documents for insert to authenticated
    with check (
        auth.uid() = user_id
        and status = 'PENDING'
        and reviewed_at is null
        and reviewer_id  is null
        and reviewer_note is null
    );

-- 3. Admin reads every submission for the verification queue.
--    Uses the SECURITY DEFINER helper from migration 0005 — never reads
--    public.profiles directly inside a policy (recursion class of bug,
--    see migration 0005 header).
drop policy if exists "kyc_documents_select_admin" on public.kyc_documents;
create policy "kyc_documents_select_admin"
    on public.kyc_documents for select to authenticated
    using (public.is_admin());

-- 4. Admin updates reviewer fields. The verification flip on
--    public.profiles is a separate write performed by the admin endpoint
--    under service_role (migration 0005 trigger gates that column); this
--    policy only governs the kyc_documents row itself.
drop policy if exists "kyc_documents_update_admin" on public.kyc_documents;
create policy "kyc_documents_update_admin"
    on public.kyc_documents for update to authenticated
    using       (public.is_admin())
    with check  (public.is_admin());

-- No UPDATE policy for owner: re-submission is a NEW row, preserving the
-- audit trail. No DELETE policy: the purge worker is service-role-only.
