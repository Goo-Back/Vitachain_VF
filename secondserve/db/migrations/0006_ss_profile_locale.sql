-- =============================================================================
-- 0006 — SecondServe per-account locale preference.
--
-- Product rule (mirrors VitaChain's profiles.locale, migration history in
-- backend/db): the language chosen at signup becomes the account's language
-- everywhere, on any device — not just a per-browser localStorage value.
-- localStorage stays as the fallback for anonymous/pre-signup visitors.
-- =============================================================================

alter table public.ss_profiles
    add column if not exists locale text not null default 'fr'
        constraint ss_profiles_locale_check check (locale in ('fr', 'en', 'ar'));

-- Extend the signup trigger to persist the locale chosen on the signup form
-- (passed through auth raw_user_meta_data as ss_locale, same mechanism as
-- ss_name/ss_city/ss_commerce_type in 0001/0004).
create or replace function public.handle_new_ss_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    md      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    ss_role text  := md->>'ss_role';
    ss_locale text := md->>'ss_locale';
begin
    if md->>'ss_app' is distinct from 'secondserve' then
        return new;   -- not a SecondServe signup; leave to VitaChain's trigger
    end if;

    if ss_role not in ('consumer','restaurant') then
        ss_role := 'consumer';
    end if;

    if ss_locale not in ('fr', 'en', 'ar') then
        ss_locale := 'fr';
    end if;

    insert into public.ss_profiles (
        id, role, email, name, city,
        approved, banned,
        commerce_type, address, phone, lat, lng, map_link,
        locale
    )
    values (
        new.id,
        ss_role,
        new.email,
        coalesce(md->>'ss_name', split_part(new.email, '@', 1)),
        coalesce(md->>'ss_city', 'Casablanca'),
        ss_role = 'consumer',            -- consumers auto-approved
        false,
        nullif(md->>'ss_commerce_type', ''),
        nullif(md->>'ss_address', ''),
        nullif(md->>'ss_phone', ''),
        (md->>'ss_lat')::double precision,
        (md->>'ss_lng')::double precision,
        nullif(md->>'ss_map_link', ''),
        ss_locale
    )
    on conflict (id) do nothing;

    -- Self-heal: remove the junk VitaChain profile that an unpatched
    -- handle_new_user() may have inserted for this SecondServe signup. Safe
    -- because the row belongs to a just-created auth user that signed up
    -- through SecondServe; it can only be the junk CITIZEN row. No-op once
    -- VitaChain migration 0048 is applied.
    delete from public.profiles where id = new.id;

    -- Immediate-login UX: confirm the email now so signInWithPassword works
    -- without the project-wide "confirm email" flow.
    update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now())
     where id = new.id;

    return new;
end;
$$;

revoke all on function public.handle_new_ss_user() from public, anon, authenticated;

-- No new RLS policy needed: ss_profiles_update (0001) already lets the owner
-- update their own row (auth.uid() = id), and ss_guard_profile_update() only
-- blocks role/approved/banned for non-admins — locale is free to self-update.
