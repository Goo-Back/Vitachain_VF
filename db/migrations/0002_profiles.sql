-- =============================================================================
-- 0002 — public.profiles — 1:1 mirror of auth.users.
-- Story:  INF-02
-- Source of truth for role + verification_status. Every other table that
-- needs to gate by role joins or FKs to this one (never to auth.users).
-- =============================================================================

create table if not exists public.profiles (
    id                  uuid        primary key references auth.users(id) on delete cascade,
    email               citext      not null unique,
    full_name           text,
    phone               text,                                         -- BR-B1 format-validated where it is used
    role                public.user_role            not null,
    verification_status public.verification_status  not null default 'PENDING',
    locale              public.locale_code          not null default 'fr',
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists profiles_role_idx                on public.profiles (role);
create index if not exists profiles_verification_status_idx on public.profiles (verification_status);

-- ---------------------------------------------------------------------------
-- updated_at maintenance — shared helper, reused by every later table.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
    before update on public.profiles
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — PRD §7.1 AUTH-04. Default-deny posture; explicit owner-only policies.
-- INSERT is reserved for the on-signup trigger (security definer, migration
-- 0003) and the service role. DELETE cascades from auth.users.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
    on public.profiles for select
    using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles for update
    using (auth.uid() = id)
    with check (
        auth.uid() = id
        -- Self-service edits cannot change role or verification_status.
        -- Those flips require the service role (FastAPI / Admin in ADM-02).
        and role                = (select role                from public.profiles where id = auth.uid())
        and verification_status = (select verification_status from public.profiles where id = auth.uid())
    );

-- ADMIN read-all — admins must see every profile for the verification queue
-- (ADM-02) and lead overview (ADM-03). Service-role JWT bypasses RLS, but
-- when an admin user is logged in with a normal session this policy applies.
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin"
    on public.profiles for select
    using (
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.role = 'ADMIN'
        )
    );
