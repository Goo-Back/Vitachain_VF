-- =============================================================================
-- 0003 — Mirror every new auth.users row into public.profiles.
-- Story:  INF-02
-- Why a trigger? Supabase Auth owns auth.users, so we can't FK to it from the
-- frontend during signup. A SECURITY DEFINER trigger is the canonical way to
-- materialize the public-side row atomically with the auth-side insert.
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

-- Lock down: only the function owner can EXECUTE; the trigger fires under
-- the table owner's rights, so direct callers don't need EXECUTE.
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
