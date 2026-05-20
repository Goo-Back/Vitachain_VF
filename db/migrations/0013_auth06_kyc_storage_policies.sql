-- =============================================================================
-- 0013 — RLS policies on storage.objects for the kyc-documents bucket.
-- Story:  AUTH-06
-- Bucket was created in migration 0004 with public=false. AUTH-06 attaches
-- the policies that actually make the bucket usable.
--
-- Path convention: '<user_id>/<uuid4>.<ext>'. The first folder MUST equal
-- the caller's auth.uid(). Mirrored at three layers:
--   (1) frontend signed-URL flow uploads to the server-built path
--   (2) backend /kyc/upload-url builds it and signs it
--   (3) storage.objects INSERT policy here is the final gate
-- =============================================================================

-- 1. Owner-only INSERT. The folder check is what makes the bucket safe:
--    even if a forged path comes in, `(storage.foldername(name))[1]` cannot
--    be coerced to a different user's id from a non-admin JWT.
drop policy if exists "kyc_documents_storage_insert_own" on storage.objects;
create policy "kyc_documents_storage_insert_own"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'kyc-documents'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- 2. Owner-or-admin SELECT. The signed-read URL the API generates is short-
--    lived (60s for the preview); this policy is the ACL behind those URLs.
drop policy if exists "kyc_documents_storage_select_own_or_admin" on storage.objects;
create policy "kyc_documents_storage_select_own_or_admin"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'kyc-documents'
        and (
            (storage.foldername(name))[1] = auth.uid()::text
            or public.is_admin()
        )
    );

-- 3. Admin-only DELETE — REJECTED purges + GDPR erasure run via the admin
--    UI (ADM-02) or service-role worker. Users cannot delete their own
--    submissions: the audit trail must survive even a re-submission.
drop policy if exists "kyc_documents_storage_delete_admin" on storage.objects;
create policy "kyc_documents_storage_delete_admin"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'kyc-documents'
        and public.is_admin()
    );

-- No UPDATE policy — objects are immutable once written. Re-submission
-- creates a new file under a new uuid. This also means the storage path
-- column on kyc_documents is effectively WORM (write-once, read-many).
