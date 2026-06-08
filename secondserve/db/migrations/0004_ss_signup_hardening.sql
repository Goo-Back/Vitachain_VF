-- =============================================================================
-- 0004 — SecondServe signup hardening (cross-app coherence with VitaChain).
--
-- Two problems this migration closes, both rooted in the shared auth.users pool:
--
--   1. DEPLOY-ORDER COUPLING. VitaChain's handle_new_user() used to also insert
--      a junk CITIZEN row into public.profiles for every SecondServe signup. The
--      guard that stops that lives in VitaChain migration 0048 — a *separate*
--      migration chain applied by a *different* script (db push vs apply.py).
--      If SecondServe's migrations are applied but VitaChain 0048 is not, the
--      junk row comes back. We make the SecondServe chain self-sufficient:
--      handle_new_ss_user() now deletes any public.profiles row for the brand-new
--      auth user it is materialising. A SecondServe signup is always a fresh
--      auth.users insert, so any profiles row for that id can only be the junk
--      one — safe to remove. (No-op when 0048 is applied: there is no row.)
--      Trigger order makes this reliable: on_auth_user_created (handle_new_user)
--      sorts before on_auth_user_created_ss, so the junk row already exists by
--      the time we run.
--
--   2. FARMER ACCOUNTS MUST NOT LEAK INTO SECONDSERVE. Product rule: citizen and
--      restaurant identities are shared across the two apps, but a VitaChain
--      FARMER may not hold a SecondServe profile. The client enforces this
--      (lib/supabase.ts ensureSsProfile), and this migration adds the matching
--      DB-level guard on the ss_profiles INSERT policy so a hand-crafted client
--      cannot bypass it. (The security-definer signup trigger is unaffected —
--      native SecondServe signups are never farmers.)
-- =============================================================================

-- ── 1. Self-healing signup trigger (0003 body + junk-row cleanup) ─────────────
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

-- ── 2. Block farmer accounts from client-side ss_profiles provisioning ────────
-- Mirrors 0001's policy, plus: the caller must not be a VitaChain FARMER. The
-- subquery reads the caller's own profiles row, which profiles_select_own
-- (VitaChain mig 0002/0005) permits for auth.uid() = id.
drop policy if exists ss_profiles_insert on public.ss_profiles;
create policy ss_profiles_insert on public.ss_profiles for insert
    with check (
        auth.uid() = id
        and role in ('consumer','restaurant')
        and banned = false
        and (
            (role = 'consumer'   and approved = true)
            or (role = 'restaurant' and approved = false)
        )
        and not exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'FARMER'
        )
    );
