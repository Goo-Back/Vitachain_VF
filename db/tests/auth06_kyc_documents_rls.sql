-- =============================================================================
-- AUTH-06 — RLS contract on public.kyc_documents.
-- Asserts:
--   (1) owner-only SELECT (user A cannot see user B's docs)
--   (2) owner-only INSERT (user A cannot insert a row whose user_id is B's)
--   (3) WITH CHECK rejects non-PENDING self-INSERT (no self-approval)
--   (4) owner has no UPDATE on their own row (re-submission = new row)
--   (5) admin UPDATE succeeds with all consistency-check columns set
--   (6) admin SELECT sees every row regardless of owner
--
-- Wrapped in begin ... rollback so the live project ends unchanged. Run
-- as service-role psql (direct :5432).
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- ---- Seed ------------------------------------------------------------------
-- Seed users via auth.users with raw_user_meta_data carrying the right role:
-- the handle_new_user trigger (migration 0003) materializes public.profiles
-- automatically. We then service-role-update verification_status (bypasses
-- the immutability trigger because the test session is the postgres role).

-- Required so the handle_new_user trigger does not 22023 on the seed.
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare
    a_id  uuid := gen_random_uuid();
    b_id  uuid := gen_random_uuid();
    ad_id uuid := gen_random_uuid();
begin
    insert into auth.users (
        id, instance_id, aud, role, email,
        raw_user_meta_data, encrypted_password,
        email_confirmed_at, created_at, updated_at
    ) values
    (a_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     format('auth06_a_%s@test.local', a_id),
     jsonb_build_object('role','FARMER','locale','fr','full_name','A'),
     crypt('Abcdefg123', gen_salt('bf')), now(), now(), now()),
    (b_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     format('auth06_b_%s@test.local', b_id),
     jsonb_build_object('role','FARMER','locale','fr','full_name','B'),
     crypt('Abcdefg123', gen_salt('bf')), now(), now(), now()),
    (ad_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     format('auth06_admin_%s@test.local', ad_id),
     jsonb_build_object('role','ADMIN','locale','fr','full_name','Admin'),
     crypt('Abcdefg123', gen_salt('bf')), now(), now(), now());

    -- Admin is VERIFIED by convention. The immutability trigger only refuses
    -- non-service-role JWTs; the surrounding txn currently carries
    -- request.jwt.claims.role=service_role so this update is admitted.
    update public.profiles set verification_status = 'VERIFIED' where id = ad_id;

    -- Pre-insert a doc for A under service-role (bypasses RLS) so we can
    -- later attempt cross-user reads and updates from other sessions.
    insert into public.kyc_documents (user_id, document_type, storage_path, mime_type, size_bytes)
    values (a_id, 'CIN', a_id || '/seed.pdf', 'application/pdf', 1024);

    perform set_config('test.a_id',  a_id::text,  true);
    perform set_config('test.b_id',  b_id::text,  true);
    perform set_config('test.ad_id', ad_id::text, true);
end$$;

-- ---- (1) Owner-only SELECT --------------------------------------------------
-- Set JWT claims to user B; B must not see A's row.
set local role authenticated;
select set_config(
    'request.jwt.claims',
    json_build_object('sub', current_setting('test.b_id'), 'role', 'authenticated')::text,
    true
);

do $$
declare
    visible int;
begin
    select count(*) into visible
      from public.kyc_documents
     where user_id = current_setting('test.a_id')::uuid;
    if visible <> 0 then
        raise exception 'AUTH-06 (1) FAIL — B saw % of A''s rows; expected 0', visible;
    end if;
    raise notice 'OK (1) owner-only SELECT';
end$$;

-- ---- (2) Owner-only INSERT --------------------------------------------------
-- B attempts to insert a row whose user_id is A's. Must fail with 42501.
do $$
begin
    begin
        insert into public.kyc_documents
            (user_id, document_type, storage_path, mime_type, size_bytes)
        values (current_setting('test.a_id')::uuid, 'CIN',
                current_setting('test.a_id') || '/impersonation.pdf',
                'application/pdf', 1024);
        raise exception 'AUTH-06 (2) FAIL — B inserted a row for A';
    exception when insufficient_privilege then
        raise notice 'OK (2) owner-only INSERT';
    end;
end$$;

-- ---- (3) Self-approval blocked by WITH CHECK --------------------------------
-- B attempts to insert their OWN row with status='APPROVED'. Must fail.
do $$
begin
    begin
        insert into public.kyc_documents
            (user_id, document_type, storage_path, mime_type, size_bytes, status,
             reviewed_at, reviewer_id)
        values (current_setting('test.b_id')::uuid, 'CIN',
                current_setting('test.b_id') || '/self.pdf',
                'application/pdf', 1024, 'APPROVED', now(),
                current_setting('test.b_id')::uuid);
        raise exception 'AUTH-06 (3) FAIL — B self-approved';
    exception when insufficient_privilege or check_violation then
        raise notice 'OK (3) self-approval blocked';
    end;
end$$;

-- ---- (4) Owner cannot UPDATE their own row ----------------------------------
-- Switch to user A (the row owner).
select set_config(
    'request.jwt.claims',
    json_build_object('sub', current_setting('test.a_id'), 'role', 'authenticated')::text,
    true
);

do $$
declare
    affected int;
begin
    update public.kyc_documents
       set reviewer_note = 'self-edit attempt'
     where user_id = current_setting('test.a_id')::uuid;
    get diagnostics affected = row_count;
    if affected <> 0 then
        raise exception 'AUTH-06 (4) FAIL — owner UPDATE affected % rows', affected;
    end if;
    raise notice 'OK (4) owner has no UPDATE';
end$$;

-- ---- (5) Admin UPDATE succeeds ---------------------------------------------
-- Switch to admin user.
select set_config(
    'request.jwt.claims',
    json_build_object('sub', current_setting('test.ad_id'), 'role', 'authenticated')::text,
    true
);

do $$
declare
    affected int;
begin
    update public.kyc_documents
       set status        = 'APPROVED',
           reviewed_at   = now(),
           reviewer_id   = current_setting('test.ad_id')::uuid,
           reviewer_note = 'approved by auth06 test'
     where user_id = current_setting('test.a_id')::uuid;
    get diagnostics affected = row_count;
    if affected <> 1 then
        raise exception 'AUTH-06 (5) FAIL — admin UPDATE affected % rows; expected 1', affected;
    end if;
    raise notice 'OK (5) admin UPDATE succeeded';
end$$;

-- ---- (6) Admin SELECT sees every row ---------------------------------------
do $$
declare
    visible int;
begin
    select count(*) into visible
      from public.kyc_documents
     where user_id in (current_setting('test.a_id')::uuid,
                       current_setting('test.b_id')::uuid);
    if visible < 1 then
        raise exception 'AUTH-06 (6) FAIL — admin saw % rows; expected at least 1', visible;
    end if;
    raise notice 'OK (6) admin SELECT reads cross-user';
end$$;

reset role;

rollback;
