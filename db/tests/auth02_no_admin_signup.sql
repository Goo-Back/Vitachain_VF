-- =============================================================================
-- AUTH-02 — ADMIN self-signup is rejected (42501); service-role seed allowed.
-- Pins the contract from migration 0007.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- Negative — anon-context ADMIN signup must fail with insufficient_privilege.
do $$
declare
    uid uuid := gen_random_uuid();
begin
    perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    begin
        insert into auth.users (
            id, instance_id, aud, role, email, raw_user_meta_data,
            encrypted_password, email_confirmed_at, created_at, updated_at
        ) values (
            uid,
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            format('no-admin-%s@test.local', uid),
            jsonb_build_object('role','ADMIN','locale','fr','full_name','Should Fail'),
            crypt('Abcdefghi1', gen_salt('bf')),
            now(), now(), now()
        );
        raise exception 'expected 42501, got success';
    exception when insufficient_privilege then
        raise notice 'OK anon ADMIN signup rejected (42501)';
    end;
end$$;

-- Positive — service-role ADMIN seed must succeed and materialize the profile.
do $$
declare
    uid uuid := gen_random_uuid();
begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    insert into auth.users (
        id, instance_id, aud, role, email, raw_user_meta_data,
        encrypted_password, email_confirmed_at, created_at, updated_at
    ) values (
        uid,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        format('admin-seed-%s@test.local', uid),
        jsonb_build_object('role','ADMIN','locale','fr','full_name','Admin Seed'),
        crypt('Abcdefghi1', gen_salt('bf')),
        now(), now(), now()
    );

    if not exists (
        select 1 from public.profiles where id = uid and role = 'ADMIN'
    ) then
        raise exception 'service-role ADMIN seed did not produce profile row';
    end if;
    raise notice 'OK service-role ADMIN seed';
end$$;

rollback;
