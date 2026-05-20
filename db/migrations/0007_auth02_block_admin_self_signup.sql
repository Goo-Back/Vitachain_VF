-- =============================================================================
-- 0007 — AUTH-02 — Reject role=ADMIN from non-service-role signups.
-- Story:  AUTH-02
-- Why:    migration 0003 accepts ADMIN in raw_user_meta_data because the
--         service-role seed path goes through the same trigger. AUTH-02
--         tightens that: ADMIN is only acceptable when the JWT role of
--         the caller is service_role.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    requested_role   text := coalesce(new.raw_user_meta_data->>'role',   'CITIZEN');
    requested_locale text := coalesce(new.raw_user_meta_data->>'locale', 'fr');
    jwt_role         text;
begin
    if requested_role not in ('FARMER','RESTAURANT','CITIZEN','ADMIN') then
        raise exception 'invalid role on signup: %', requested_role
            using errcode = '22023';
    end if;

    if requested_locale not in ('fr','ar','en') then
        raise exception 'invalid locale on signup: %', requested_locale
            using errcode = '22023';
    end if;

    if requested_role = 'ADMIN' then
        begin
            jwt_role := current_setting('request.jwt.claims', true)::json->>'role';
        exception when others then
            jwt_role := null;
        end;
        if jwt_role is distinct from 'service_role' then
            raise exception 'ADMIN role may only be assigned via the service role'
                using errcode = '42501';   -- insufficient_privilege
        end if;
    end if;

    insert into public.profiles (id, email, full_name, role, locale)
    values (
        new.id,
        new.email,
        new.raw_user_meta_data->>'full_name',
        requested_role::public.user_role,
        requested_locale::public.locale_code
    );

    return new;
end;
$$;
