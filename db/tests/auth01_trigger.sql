-- =============================================================================
-- AUTH-01 — Exhaustive coverage for public.handle_new_user() trigger.
--
-- Service-role psql connection only (direct :5432, not the pooler) — direct
-- inserts into auth.users replay the path that auth.admin.create_user uses.
-- Wraps the whole run in a txn that ROLLBACKs at the end so the live project
-- ends in the same state it started.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- 4 roles × 3 locales = 12 positive cases.
do $$
declare
    role_v   public.user_role;
    locale_v public.locale_code;
    uid      uuid;
    p        public.profiles%rowtype;
begin
    foreach role_v in array array['FARMER','RESTAURANT','CITIZEN','ADMIN']::public.user_role[] loop
        foreach locale_v in array array['fr','ar','en']::public.locale_code[] loop
            uid := gen_random_uuid();

            insert into auth.users (
                id,
                instance_id,
                aud,
                role,
                email,
                raw_user_meta_data,
                encrypted_password,
                email_confirmed_at,
                created_at,
                updated_at
            )
            values (
                uid,
                '00000000-0000-0000-0000-000000000000',
                'authenticated',
                'authenticated',
                format('auth01-%s@test.local', uid),
                jsonb_build_object(
                    'full_name', 'T. User',
                    'role',      role_v::text,
                    'locale',    locale_v::text
                ),
                crypt('Abcdefg123', gen_salt('bf')),
                now(),
                now(),
                now()
            );

            select * into p from public.profiles where id = uid;
            if not found then
                raise exception 'profile row missing for role=% locale=%', role_v, locale_v;
            end if;
            if p.role <> role_v then
                raise exception 'profile.role mismatch: got % expected %', p.role, role_v;
            end if;
            if p.locale <> locale_v then
                raise exception 'profile.locale mismatch: got % expected %', p.locale, locale_v;
            end if;

            raise notice 'OK  positive  role=%-10s  locale=%', role_v, locale_v;

            -- Cleanup within the txn so the next loop iteration has a clean slate.
            delete from auth.users where id = uid;
        end loop;
    end loop;
end$$;

-- Negative — invalid role surfaces 22023 (invalid_parameter_value).
do $$
declare
    uid uuid := gen_random_uuid();
begin
    begin
        insert into auth.users (
            id, instance_id, aud, role,
            email, raw_user_meta_data, encrypted_password,
            email_confirmed_at, created_at, updated_at
        )
        values (
            uid,
            '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated',
            format('auth01-bad-role-%s@test.local', uid),
            jsonb_build_object('full_name','T', 'role','PRESIDENT', 'locale','fr'),
            crypt('Abcdefg123', gen_salt('bf')),
            now(), now(), now()
        );
        raise exception 'expected 22023 invalid_parameter_value, got success';
    exception when invalid_parameter_value then
        raise notice 'OK  negative  invalid role rejected (22023)';
    end;
end$$;

-- Negative — invalid locale surfaces 22023.
do $$
declare
    uid uuid := gen_random_uuid();
begin
    begin
        insert into auth.users (
            id, instance_id, aud, role,
            email, raw_user_meta_data, encrypted_password,
            email_confirmed_at, created_at, updated_at
        )
        values (
            uid,
            '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated',
            format('auth01-bad-locale-%s@test.local', uid),
            jsonb_build_object('full_name','T', 'role','CITIZEN', 'locale','tr'),
            crypt('Abcdefg123', gen_salt('bf')),
            now(), now(), now()
        );
        raise exception 'expected 22023 invalid_parameter_value, got success';
    exception when invalid_parameter_value then
        raise notice 'OK  negative  invalid locale rejected (22023)';
    end;
end$$;

rollback;
