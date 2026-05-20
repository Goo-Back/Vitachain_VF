# INF-02 — Set up Supabase project + base schema + profiles table

> **Epic:** E0 — Infrastructure & DevOps Foundation
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must
> **Status:** TODO
> **Depends on:** [INF-01](INF-01-provision-vps-docker-nginx.md)
> **Unblocks:** AUTH-01, AUTH-02, AUTH-04, INF-03, INF-07, FAR-01, FAR-07, NOT-07
> **Acceptance:** Auth working; a `public.profiles` row is created on every signup.

---

## 1. Purpose

Create the single Supabase project that backs every VitaChain module for the MVD and lock in the foundations that the rest of the team will build on:

- A working Supabase Auth instance with the JWT lifetime, secret strength, and email/password flow demanded by PRD §7.1 (AUTH-01, AUTH-03).
- A `public.profiles` table that mirrors `auth.users` 1-to-1, carries the user's `role`, locale, and `verification_status`, and is populated automatically by a database trigger on signup.
- The base Row-Level-Security stance — RLS on by default, owner-read/owner-update for `profiles`, service-key as the only escape hatch (AUTH-04, AUTH-05).
- The migration + seed layout that all subsequent stories will append to (`db/migrations/*.sql`, applied through the Supabase CLI).

Once this story is `DONE`, INF-03 can wire Next.js to Supabase Auth, INF-04 can hit the database from FastAPI through the service role, and every domain story can add its own tables on top of a known-good baseline.

---

## 2. Scope

### In scope
- Create the Supabase cloud project (free tier — PRD §11.1).
- Configure Auth: email/password, JWT 1h access / 7d refresh, 256-bit JWT secret (AUTH-03).
- Install the Supabase CLI locally; link it to the remote project; commit `supabase/config.toml`.
- Create the canonical `db/migrations/` folder under repo root with the first three migrations:
  1. `0001_extensions_and_enums.sql` — required extensions + role/verification enums.
  2. `0002_profiles.sql` — `public.profiles` table, indexes, RLS, owner-only policies.
  3. `0003_profile_on_signup.sql` — `handle_new_user()` trigger that mirrors `auth.users` → `public.profiles`.
- Apply migrations to the remote project via `supabase db push`.
- Provision a Supabase Storage bucket placeholder (`farmarket-photos`) so FAR-07 doesn't have to revisit Supabase setup.
- Capture all keys (`anon`, `service_role`, JWT secret, DB password) in Bitwarden, and emit a `.env.example` checked into the repo.
- Smoke test: sign a user up via the Supabase REST API, confirm a `profiles` row appears with the requested role.

### Out of scope (later stories)
- Role assignment UI / signup form → **AUTH-01 / AUTH-02** (this story only persists the role passed by the caller).
- Frontend Auth integration → **INF-03**.
- Backend service-role usage → **INF-04 / AUTH-05**.
- KYC document upload + admin verification flow → **AUTH-06**.
- Cross-table RLS audit → **AUTH-07**.
- Nightly `pg_dump` → **INF-07**.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [INF-01](INF-01-provision-vps-docker-nginx.md) `DONE` | VPS reachable; the FastAPI container will later need DB credentials. |
| Supabase account | Use the shared team Google account; record credentials in Bitwarden. |
| Bitwarden shared vault | Already created in INF-01; all keys for this story land here. |
| Local Supabase CLI | `npm i -g supabase` **or** `scoop install supabase` on Windows. |
| Repo write access | Migrations are committed to Git; CI in INF-05 will replay them. |

---

## 4. Target configuration

| Setting | Value | Source |
|---|---|---|
| Project region | `eu-central-1` (Frankfurt) | Closest free-tier region to Morocco (PRD §4.1). |
| Plan | Free | PRD §11.1 — 500 MB DB / 1 GB storage / 50K MAU. |
| Postgres major | 15 (Supabase default) | Compatible with `pgcrypto`, `pg_trgm`, `postgis` (needed for SEC-03 later). |
| JWT expiry — access | 3600 s (1 h) | AUTH-03. |
| JWT expiry — refresh | 604800 s (7 d) | AUTH-03. |
| JWT secret length | ≥ 32 bytes (256 bit) | AUTH-03 / PRD §8.3. |
| Email confirmations | **Disabled** for MVD | Demo accounts are pre-created; speeds rehearsal. Re-enable post-MVD. |
| Site URL | `http://vitachain.ma` (swap to `https://` after INF-06) | Used in confirmation/reset emails when re-enabled. |
| Storage bucket `farmarket-photos` | Public read, authenticated write | Used by FAR-07; created here so FAR-07 only adds RLS. |

---

## 5. Step-by-Step Implementation

### 5.1 Create the project

1. Sign in to <https://app.supabase.com> with the shared team account.
2. **New project** → name `vitachain-prod`, region `eu-central-1`.
3. Set a strong DB password (32+ chars from Bitwarden generator). **Save to Bitwarden immediately** as `VitaChain — Supabase DB password`.
4. Wait for provisioning (~2 min). Note the project ref (e.g. `xyzabc123`) — it appears in every URL.

### 5.2 Record keys in Bitwarden

From **Project Settings → API**, copy and store as separate Bitwarden entries:

| Bitwarden entry | What it holds | Who may see it |
|---|---|---|
| `VitaChain — Supabase URL` | `https://<ref>.supabase.co` | Whole team (public). |
| `VitaChain — Supabase anon key` | The `anon` (public) JWT | Whole team — shipped to the frontend. |
| `VitaChain — Supabase service_role key` | The `service_role` JWT | **Backend only.** Never paste anywhere a frontend dev can touch. |
| `VitaChain — Supabase JWT secret` | From Settings → API → JWT Settings | Backend only; needed to verify JWTs in FastAPI. |
| `VitaChain — Supabase DB password` | Set in §5.1 | Backend only. |

### 5.3 Configure Auth

In **Authentication → Providers → Email**:
- Enable Email provider.
- **Confirm email:** OFF (re-enable post-MVD).
- **Secure email change:** ON.

In **Authentication → URL Configuration**:
- Site URL: `http://vitachain.ma`
- Redirect URLs: `http://vitachain.ma/auth/callback`, `http://localhost:3000/auth/callback`.

In **Settings → API → JWT Settings**:
- Confirm **JWT expiry** is `3600`. Save.
- The refresh-token lifetime (7 d) is the Supabase default; no action needed.
- Confirm the JWT secret is ≥ 32 bytes; if Supabase pre-generated a shorter one, click **Rotate** and store the new value.

### 5.4 Install and link the CLI

From the repo root on your laptop:

```bash
supabase --version           # sanity check
supabase login               # opens browser
supabase init                # creates ./supabase/
supabase link --project-ref <ref>
```

Commit the generated [supabase/config.toml](../../supabase/config.toml) — but **never** the `.branches/`, `.temp/`, or any file containing the access token. Add to `.gitignore`:

```
supabase/.branches/
supabase/.temp/
supabase/.env
```

### 5.5 Repo layout for migrations

Create:

```
db/
  migrations/
    0001_extensions_and_enums.sql
    0002_profiles.sql
    0003_profile_on_signup.sql
  seeds/
    .gitkeep
  README.md
```

[db/README.md](../../db/README.md) — one-pager explaining: "every schema change is a new numbered file; never edit a migration after it has been applied to the remote; use `supabase db push` to apply."

### 5.6 Migration 0001 — extensions & enums

[db/migrations/0001_extensions_and_enums.sql](../../db/migrations/0001_extensions_and_enums.sql):

```sql
-- 0001 — Extensions and enums shared across all modules.
-- Applied to: vitachain-prod (eu-central-1).

create extension if not exists "pgcrypto";   -- gen_random_uuid(), digest()
create extension if not exists "pg_trgm";    -- fuzzy search for FarMarket
create extension if not exists "citext";     -- case-insensitive email columns

-- User role — PRD §7.1 AUTH-02.
do $$ begin
  create type public.user_role as enum ('FARMER','RESTAURANT','CITIZEN','ADMIN');
exception when duplicate_object then null; end $$;

-- Professional verification state — PRD §7.1 AUTH-06.
do $$ begin
  create type public.verification_status as enum ('PENDING','VERIFIED','REJECTED');
exception when duplicate_object then null; end $$;

-- Supported UI locales — PRD §7.2. Stored on profile to drive Brevo template + Gemini prompt.
do $$ begin
  create type public.locale_code as enum ('fr','ar','en');
exception when duplicate_object then null; end $$;
```

### 5.7 Migration 0002 — profiles table

[db/migrations/0002_profiles.sql](../../db/migrations/0002_profiles.sql):

```sql
-- 0002 — Public profile mirror of auth.users (1:1).
-- Source of truth for role + verification_status used by every other module.

create table if not exists public.profiles (
    id                  uuid primary key references auth.users(id) on delete cascade,
    email               citext      not null unique,
    full_name           text,
    phone               text,                                         -- BR-B1 validated where it matters
    role                public.user_role            not null,
    verification_status public.verification_status  not null default 'PENDING',
    locale              public.locale_code          not null default 'fr',
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists profiles_role_idx                on public.profiles (role);
create index if not exists profiles_verification_status_idx on public.profiles (verification_status);

-- Keep updated_at honest.
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- RLS — PRD §7.1 AUTH-04. Default deny; explicit owner-only policies.
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
      -- Only the service role (FastAPI / Admin) may change role or verification_status.
      and role                = (select role                from public.profiles where id = auth.uid())
      and verification_status = (select verification_status from public.profiles where id = auth.uid())
  );

-- INSERT is reserved for the on-signup trigger (runs as security definer) and the service role.
-- DELETE cascades from auth.users; no policy needed.
```

### 5.8 Migration 0003 — auto-create profile on signup

[db/migrations/0003_profile_on_signup.sql](../../db/migrations/0003_profile_on_signup.sql):

```sql
-- 0003 — Mirror every new auth.users row into public.profiles.
-- The role is read from raw_user_meta_data.role (set by the frontend at signup, AUTH-02).
-- Defaults to CITIZEN if the caller omits it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    requested_role text := coalesce(new.raw_user_meta_data->>'role', 'CITIZEN');
    requested_locale text := coalesce(new.raw_user_meta_data->>'locale', 'fr');
begin
    -- Defensive: reject unknown role values rather than silently demoting.
    if requested_role not in ('FARMER','RESTAURANT','CITIZEN','ADMIN') then
        raise exception 'invalid role on signup: %', requested_role
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

> **Why `security definer`?** The trigger runs against `auth.users`, but inserts into `public.profiles`, which has RLS on. `security definer` lets it execute as the table owner, bypassing RLS for this one controlled path — exactly the pattern AUTH-05 requires for "service-only writes".

### 5.9 Storage bucket placeholder

In the Supabase dashboard → **Storage** → **New bucket**:
- Name: `farmarket-photos`
- Public bucket: **ON** (read-only; FAR-07 will tighten write policy).

Equivalent SQL (also acceptable; commit as [db/migrations/0004_storage_buckets.sql](../../db/migrations/0004_storage_buckets.sql) if you prefer code over clicks):

```sql
insert into storage.buckets (id, name, public)
values ('farmarket-photos', 'farmarket-photos', true)
on conflict (id) do nothing;
```

### 5.10 Apply migrations

From the repo root:

```bash
supabase db push      # applies all db/migrations/*.sql to the linked project
```

Verify in the dashboard → **Database → Tables** that `public.profiles` exists and **RLS is enabled** (green padlock).

### 5.11 `.env.example`

Commit [.env.example](../../.env.example) so INF-03 (Next.js) and INF-04 (FastAPI) know exactly which variables to read. Do **not** commit `.env`.

```ini
# Public (safe to ship to the frontend bundle)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Backend only — must NEVER reach the browser. Enforced by CI grep in INF-05.
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
SUPABASE_DB_PASSWORD=
```

### 5.12 Smoke test — signup creates a profile row

From your laptop, replacing `<URL>` and `<ANON_KEY>` with the values from §5.2:

```bash
# 1. Sign up a citizen.
curl -s -X POST "<URL>/auth/v1/signup" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{
    "email": "citizen.test@vitachain.ma",
    "password": "Test12345!",
    "data": { "role": "CITIZEN", "full_name": "Citizen Test", "locale": "fr" }
  }' | jq .

# 2. Confirm the profile row exists. Use the Table editor in the dashboard, or:
#    Database → SQL → run:  select id, email, role, verification_status from public.profiles;
```

Expect: one row in `public.profiles` with `role='CITIZEN'`, `verification_status='PENDING'`, `locale='fr'`. If `verification_status` is anything else, migration 0002 didn't apply — re-run `supabase db push`.

Repeat once with `"role": "FARMER"` to confirm enum acceptance, and once with `"role": "PIRATE"` to confirm the trigger rejects unknown roles (HTTP 500 from the signup call, no row written).

---

## 6. Verification Checklist

- [ ] Supabase project `vitachain-prod` exists in `eu-central-1`, free plan.
- [ ] All five Bitwarden entries from §5.2 created and shared with the team.
- [ ] `supabase/config.toml` committed; `supabase/.temp/` and `.env` git-ignored.
- [ ] `db/migrations/0001…0003` (and optional `0004`) committed and applied.
- [ ] `public.profiles` visible in dashboard with RLS **enabled** and the two policies from §5.7 listed.
- [ ] `on_auth_user_created` trigger visible under `auth.users` triggers.
- [ ] `farmarket-photos` Storage bucket exists.
- [ ] Smoke test §5.12 passes: signup → row in `public.profiles` with correct `role`, `verification_status='PENDING'`, `locale`.
- [ ] Negative smoke test: signup with `role='PIRATE'` fails; no orphan row in `public.profiles`.
- [ ] `.env.example` committed; no real secrets in the repo (`git grep -E 'eyJ|service_role' -- .`).

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| Supabase CLI config | [supabase/config.toml](../../supabase/config.toml) |
| Migrations | [db/migrations/0001_extensions_and_enums.sql](../../db/migrations/0001_extensions_and_enums.sql), [0002_profiles.sql](../../db/migrations/0002_profiles.sql), [0003_profile_on_signup.sql](../../db/migrations/0003_profile_on_signup.sql) |
| Migrations README | [db/README.md](../../db/README.md) |
| Env template | [.env.example](../../.env.example) |
| Bitwarden entries | 5 entries listed in §5.2 |
| Runbook entry | Append "Supabase bootstrap & recovery" section to [docs/runbook.md](../runbook.md) |
| `spring-status.yml` update | Flip `INF-02.status` → `DONE`; bump `summary.done`; decrement `summary.todo` |

---

## 8. Risks & Mitigations

| Risk | Mitigation | Source |
|---|---|---|
| Service-role key leaks to the frontend bundle | CI grep in INF-05 fails the build if `SUPABASE_SERVICE_ROLE_KEY` appears in any `next build` output | PRD §7.1 AUTH-05 |
| Migration applied straight to dashboard (drift) | All schema changes go through `db/migrations/*.sql`; never edit applied files — add a new one | PRD §13 R3 (scope creep proxy) |
| Free-tier 500 MB DB exhausted by IoT telemetry | KAT-04 BR-K4 forces aggregation; telemetry rolled up daily; reviewed in INF-07 retention policy | PRD §11.1 |
| Email confirmation off in production after MVD | Re-enable in post-MVD checklist; tracked in runbook | PRD §11.1 |
| RLS holes via missing policies on new tables | AUTH-04 enables RLS by default in this story's pattern; AUTH-07 audits before P3 gate | PRD §13 R6 |
| Trigger fires inside a transaction → bad insert kills signup | Trigger validates inputs early and uses `security definer`; tested in §5.12 negative case | — |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Create project + record keys | 20 min |
| Auth + URL configuration | 15 min |
| CLI install + link + repo layout | 20 min |
| Write + apply migrations 0001–0003 | 60 min |
| Storage bucket + `.env.example` | 15 min |
| Smoke tests (positive + negative) | 20 min |
| Runbook + spring-status updates | 15 min |
| **Total active work** | **~2.5–3 h** |

---

## 10. Definition of Done

1. Acceptance criterion met: signing a user up via the Supabase Auth REST endpoint produces exactly one matching row in `public.profiles`, with the correct `role`, `verification_status='PENDING'`, and `locale`.
2. Verification checklist (§6) fully ticked.
3. Deliverables (§7) committed to the repo or stored in Bitwarden as specified.
4. [docs/spring-status.yml](../spring-status.yml) updated and committed: `INF-02.status: DONE`, `summary.done` incremented.
5. Hand-off note posted to the team channel naming the unblocked stories: **AUTH-01** (registration), **AUTH-04** (RLS rollout to other tables), **INF-03** (Next.js scaffold), **INF-04** (FastAPI scaffold), **INF-07** (backups can now target a real DB).
