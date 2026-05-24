-- =============================================================================
-- 0033 — M2 FarMarket: Storage RLS policies for the farmarket-photos bucket.
-- Story:  FAR-01 (docs/stories/FAR-01-farmer-creates-ad.md)
--         Closes FAR-07's write-path concern.
--
-- The bucket was created (public = true) in migration 0004.  This migration
-- adds the write policies so only a VERIFIED FARMER can upload to their own
-- prefix, and only the owner can delete their photos.
--
-- Path convention enforced by the INSERT policy:
--   (storage.foldername(name))[1] = auth.uid()::text
--   stored as  farmarket-photos/{farmer_id}/{ad_id}/{filename}
--   ensures farmer A cannot overwrite farmer B's photos.
--
-- The FastAPI layer (backend/app/modules/farmarket/router.py) uploads via the
-- user-scoped client (bearer JWT forwarded via Authorization header), so this
-- RLS fires on every upload — no service-role bypass needed or allowed for the
-- insert path (AUTH-05 boundary).
-- =============================================================================

-- INSERT: verified FARMER may upload to their own folder prefix.
drop policy if exists "farmarket_photos_insert_verified_farmer" on storage.objects;
create policy "farmarket_photos_insert_verified_farmer"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'farmarket-photos'
        and auth.uid() is not null
        and public.has_role('FARMER'::public.user_role)
        and (
            select verification_status
              from public.profiles
             where id = auth.uid()
        ) = 'VERIFIED'
        -- First path segment must be the uploader's own UUID.
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- DELETE: owner may remove only their own photos.
drop policy if exists "farmarket_photos_delete_own" on storage.objects;
create policy "farmarket_photos_delete_own"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'farmarket-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- UPDATE: not granted — a photo edit is a delete + re-upload.
-- SELECT: not needed — bucket is public = true (migration 0004), so the
--         PostgREST public URL works without an auth round-trip.
