-- =============================================================================
-- 0003 — Auto-confirm SecondServe signups (immediate login, Firebase-like UX).
--
-- The shared project has "Confirm email" ENABLED (VitaChain relies on it), so a
-- normal signUp returns no session and the user can't log in until they click
-- an email link. SecondServe's original Firebase flow logged users in straight
-- away. To preserve that WITHOUT flipping the project-wide setting, we mark the
-- SecondServe user's email as confirmed inside handle_new_ss_user(). The client
-- then performs an immediate signInWithPassword to obtain the session.
--
-- The function owner is `postgres`, which has UPDATE on auth.users, so the
-- SECURITY DEFINER trigger may set email_confirmed_at. Only ss_app signups are
-- affected; VitaChain confirmation behaviour is unchanged.
-- =============================================================================

create or replace function public.handle_new_ss_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    md      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    ss_role text  := md->>'ss_role';
begin
    if md->>'ss_app' is distinct from 'secondserve' then
        return new;   -- not a SecondServe signup; leave to VitaChain's trigger
    end if;

    if ss_role not in ('consumer','restaurant') then
        ss_role := 'consumer';
    end if;

    insert into public.ss_profiles (
        id, role, email, name, city,
        approved, banned,
        commerce_type, address, phone, lat, lng, map_link
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
        nullif(md->>'ss_map_link', '')
    )
    on conflict (id) do nothing;

    -- Immediate-login UX: confirm the email now so signInWithPassword works
    -- without the project-wide "confirm email" flow.
    update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now())
     where id = new.id;

    return new;
end;
$$;

revoke all on function public.handle_new_ss_user() from public, anon, authenticated;
