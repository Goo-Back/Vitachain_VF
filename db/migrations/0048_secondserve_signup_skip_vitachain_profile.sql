-- =============================================================================
-- 0048 — handle_new_user(): skip VitaChain profile creation for SecondServe.
--
-- SecondServe shares this Supabase project's auth.users pool. Its signups are
-- tagged raw_user_meta_data->>'ss_app' = 'secondserve' and are materialised
-- into public.ss_profiles by the separate handle_new_ss_user() trigger
-- (secondserve/db/migrations/0001). Before this migration, handle_new_user()
-- ALSO ran for those signups and inserted a junk CITIZEN row into
-- public.profiles. This guard stops that.
--
-- VitaChain's own signups (AUTH-02) never set ss_app, so the guard is a no-op
-- for them — behaviour is byte-for-byte identical to migration 0003 otherwise.
-- Append-only: 0003 is left untouched (push.sh checksums it); this file is the
-- last word on the function definition.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    requested_role   text := coalesce(new.raw_user_meta_data->>'role',   'CITIZEN');
    requested_locale text := coalesce(new.raw_user_meta_data->>'locale', 'fr');
begin
    -- SecondServe accounts belong in ss_profiles only; never create a VitaChain
    -- profile for them. (handle_new_ss_user owns their row.)
    if coalesce(new.raw_user_meta_data->>'ss_app', '') = 'secondserve' then
        return new;
    end if;

    -- Defensive validation — reject unknown roles rather than silently
    -- demoting. Frontend (AUTH-02) sends one of FARMER/RESTAURANT/CITIZEN;
    -- ADMIN is created out-of-band via the service role.
    if requested_role not in ('FARMER','RESTAURANT','CITIZEN','ADMIN') then
        raise exception 'invalid role on signup: %', requested_role
            using errcode = '22023';   -- invalid_parameter_value
    end if;

    if requested_locale not in ('fr','ar','en') then
        raise exception 'invalid locale on signup: %', requested_locale
            using errcode = '22023';
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

revoke all on function public.handle_new_user() from public, anon, authenticated;
