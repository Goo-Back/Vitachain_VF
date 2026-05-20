-- =============================================================================
-- 0004 — Storage buckets bootstrap.
-- Story:  INF-02 (FAR-07 will add the write/delete policies on this bucket).
-- =============================================================================

-- farmarket-photos — public read, signed-url writes from the backend.
-- Public flag lets the catalog (FAR-02) render images without an auth round
-- trip; write policy is intentionally NOT created here — FAR-07 owns that.
insert into storage.buckets (id, name, public)
values ('farmarket-photos', 'farmarket-photos', true)
on conflict (id) do nothing;

-- kyc-documents — private bucket for AUTH-06 KYC-lite uploads.
-- Created now (cheap) so AUTH-06 doesn't need a fresh migration just for
-- the bucket. All access policies (owner-write, admin-read) land in AUTH-06.
insert into storage.buckets (id, name, public)
values ('kyc-documents', 'kyc-documents', false)
on conflict (id) do nothing;
