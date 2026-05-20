# AUTH-04 — Enable RLS on all sensitive tables (contract + enforcement)

> **Epic:** E1 — Authentication, Authorization & Roles (Cross-cutting)
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must *(PRD §7.1 AUTH-04, §8.3 — RLS is the database-layer authorization gate. Without it, a leaked service key, a misrouted backend handler, or a SQL injection that escapes a sanitiser silently exposes every farmer's parcels, every restaurateur's meals, and every citizen's pickup codes. RLS is the only authorization control that survives an entire compromised application tier.)*
> **Status:** TODO
> **Depends on:** [INF-02](INF-02-supabase-project-base-schema.md) (`DONE` — base schema and `public.profiles` exist; `is_admin()` helper from migration 0005 is the recursion-safe pattern AUTH-04 generalizes), [AUTH-02](AUTH-02-role-assignment-registration.md) (`IN_REVIEW` — the JWT now carries `user_role`, so RLS policies can do `(auth.jwt()->>'user_role') = 'FARMER'` directly without joining to `public.profiles` — single-claim fast path), [AUTH-03](AUTH-03-jwt-config-256bit-1h-7d.md) (`IN_REVIEW` — `get_current_user()` and the FastAPI surface are the call-site every RLS-gated backend route uses; AUTH-04 wires the postgrest-py `set_auth(token)` step so RLS actually fires on the Postgres side)
> **Unblocks:** [AUTH-05](#) (service-key isolation — AUTH-04 makes the user-JWT vs service-key boundary observable: any service-key call site that should have been user-JWT is a privilege escalation), [AUTH-06](#) (KYC — the verification gate is encoded as an RLS policy on `INSERT` for `farmarket.ads` and `secondserve.meals`, refusing rows when `verification_status <> 'VERIFIED'`), [AUTH-07](#) (per-role RLS test matrix — AUTH-04 ships the *policy patterns*; AUTH-07 ships the exhaustive test suite that probes every (role × table × verb) combination), every domain table story (KAT-01 parcels, KAT-02 devices, KAT-03 telemetry, FAR-01 ads, FAR-04 leads, SEC-01 meals, SEC-04 reservations, BOT-03 leads, ADM-* admin views) — each will add a new table; the AUTH-04 contract is the merge gate that forces each PR to enable RLS *and* attach at least one policy before CI goes green.
> **Acceptance (per [docs/spring-status.yml](../spring-status.yml) line 636):** *"Cross-role access denied; service key isolated to backend."* Extended DoD: (a) every existing table in the `public` schema has `row level security = enabled` (today: `public.profiles` only — AUTH-04 also locks in the *contract* for the 14 tables that future stories will add); (b) a pgTAP regression test asserts `pg_class.relrowsecurity = true` for every user-table in `public` and fails CI if a future migration ever lands a table without it; (c) the FastAPI backend's `db.py` module exposes a `user_scoped_client(token)` factory that calls postgrest-py `set_auth(token)` so the user's JWT flows to PostgREST and RLS fires; (d) a black-box integration test signs in as FARMER and as RESTAURANT, queries `public.profiles`, and asserts each user sees exactly one row (their own) — cross-row leakage returns a failing assertion; (e) the `is_admin()` helper from migration 0005 is generalized to a `public.has_role(role)` helper that downstream stories reuse; (f) `bash scripts/verify-rls-enabled.sh` exits 0; (g) the runbook documents the *only* three legitimate ways a query can bypass RLS (service-role JWT, `bypassrls` role, `SECURITY DEFINER` function) and names the audit point for each.

---

## 1. Purpose

RLS is the only authorization control in VitaChain that holds when *every other layer fails*. The FastAPI `require_role()` factory (AUTH-03) gates routes inside the Python process — but if a handler accidentally uses the service key instead of the user's JWT, the Python gate is irrelevant because the service key bypasses RLS. NGINX rate limits (AUTH-08) bound brute-force volume — but they cannot stop a logged-in FARMER from reading another farmer's parcel if no policy enforces ownership. RLS is the last line.

For an 8-week MVD with three developers and zero dedicated security review, the cost of a missed policy is asymmetric:

| Failure mode | Without AUTH-04 contract | With AUTH-04 contract |
|---|---|---|
| **New table merged without RLS** (e.g. `katara.parcels` in KAT-01) | `select * from katara.parcels` from any logged-in user returns every row. Silent. No CI failure. Discovered when a customer reports it. | pgTAP test `rls_enabled_on_every_public_table` fails on the first PR commit. CI red. Merge blocked. |
| **Handler accidentally uses service key instead of user JWT** | All rows visible. Cross-tenant leak — a FARMER browsing the marketplace sees every other farmer's ads, including hidden/expired ones. | The same query under the user-scoped client returns only rows the policy admits. Integration test §6 catches the regression on first run. |
| **Recursive policy on a role-gated table** (e.g. `where exists (select 1 from profiles where role='FARMER')`) | Infinite recursion (`42P17`) — the table becomes unqueryable. Outage. | The reusable `public.has_role()` helper (`SECURITY DEFINER`, `set search_path = public, pg_temp`) is the canonical pattern. Migration 0005 already proved it works for `is_admin()`; AUTH-04 generalizes it. |
| **JWT-claim policy on a stale claim** (e.g. role was downgraded but the token is still valid) | Old token, old privileges, up to 1 h (AUTH-03 jwt_expiry). | Acknowledged risk; documented; the `auth.refresh_tokens` flush procedure (AUTH-03 §9) is the operator action. The `has_role()` SECURITY DEFINER fallback (joins to `public.profiles`) is the policy variant for routes where 1-h staleness is unacceptable. |

AUTH-04 ships **three artefacts**, not one:

1. **The contract** — a one-page policy pattern catalog in `docs/runbook.md` that every future table-creating migration cites. Without a catalog, each developer invents their own pattern; with one, code review is mechanical.
2. **The enforcement** — a pgTAP regression test plus a Bash CI guard that *fails* if any future migration introduces a public table without RLS or without at least one policy. This is the structural defence: developers cannot forget, because CI will not let them.
3. **The plumbing** — a `user_scoped_client(token)` factory in the FastAPI backend (`backend/app/db.py`) that wires the caller's JWT into postgrest-py's `set_auth()` call. Without this, the backend silently runs every query as the anon role and RLS appears "broken" — when in fact the JWT was never delivered to the database.

> **What this story is not:** writing per-table policies for tables that do not yet exist (parcels, ads, meals, leads — those land in their owner stories), the exhaustive role × table × verb test matrix (AUTH-07), the verification-status RLS rule that gates FAR-01 / SEC-01 inserts (AUTH-06), service-key-in-frontend grep guard (AUTH-05), or storage RLS for `farmarket-photos` and `kyc-documents` buckets beyond their bootstrap (FAR-07 and AUTH-06 respectively). AUTH-04 *establishes the pattern* and *enforces it for everything that exists today*; downstream stories adopt the pattern when they add new tables.

---

## 2. Scope

### In scope

- **`db/migrations/0008_auth04_has_role_helper.sql`** — new migration. Generalizes `public.is_admin()` (migration 0005) to `public.has_role(check_role public.user_role)`. SECURITY DEFINER, STABLE, `set search_path = public, pg_temp`. Returns boolean. The canonical RLS-side role check that downstream stories use without re-implementing.

- **`db/migrations/0009_auth04_force_rls_contract.sql`** — new migration. Adds a deferred event trigger `enforce_rls_on_public_tables` that fires on `CREATE TABLE` in the `public` schema and refuses the DDL if `row level security` is not enabled by the end of the transaction. Belt-and-suspenders to the CI test in §5.5: structural defence at the database level, so even an out-of-band `psql` session cannot land an un-protected table.

- **`db/tests/auth04_rls_contract.sql`** — new pgTAP file. Three assertions:
  1. Every relation in `pg_class` with `relkind = 'r'` and `relnamespace = 'public'::regnamespace` has `relrowsecurity = true`.
  2. Every such relation has at least one row in `pg_policies`.
  3. `public.has_role()` exists, is `SECURITY DEFINER`, and rejects unknown role values (cast to enum naturally errors — assert the error surfaces).
  Wrapped in `begin … rollback`. Added to `db/Makefile` `test-auth04` target and folded into the `verify` chain alongside `test-auth01` / `test-auth02`.

- **`db/tests/auth04_cross_role_isolation.sql`** — new pgTAP file. Seeds two test users (FARMER + RESTAURANT) via the service role, then for each user calls `set local request.jwt.claims = '<their JWT body>'` and asserts a plain `select * from public.profiles` returns *exactly one row* — their own. Wrapped in `begin … rollback`. This is the **smoke test for the acceptance criterion** "cross-role access denied".

- **`backend/app/db.py`** — new module. Exposes:
  - `service_client()` — returns a postgrest-py client authenticated with `SUPABASE_SERVICE_KEY` (bypasses RLS). Reserved for admin operations and on-signup triggers; *every* call site needs an inline justification comment.
  - `user_scoped_client(token: str)` — returns a postgrest-py client authenticated with the caller's bearer JWT. RLS fires. This is the default for every domain endpoint.
  Both are thin wrappers; the heavy lifting is `supabase-py`'s already-imported `create_client` + a `postgrest.set_auth(token)` call.

- **`backend/tests/test_db_user_scoping.py`** — new pytest file. 6+ assertions:
  - `service_client()` returns a client (no auth header for the user; service key in `apikey`).
  - `user_scoped_client(token)` calls `set_auth(token)` exactly once with the passed-in string.
  - Mock the underlying postgrest client; assert the `Authorization: Bearer <token>` header is set.
  - Two synthetic JWTs for two different `sub`s produce two distinct authenticated clients (no shared session state — the factory must not cache).
  - Passing a malformed token still produces a client (postgrest-py does not validate at construction time; the Postgres-side decode is the authority) — the assertion documents this contract.
  - Calling `user_scoped_client("")` raises `ValueError("empty bearer token")` — fail-loud against a silent anon-fallback.

- **`backend/tests/test_rls_smoke.py`** — new pytest file. Hits the live Supabase project (`SUPABASE_URL` + `SUPABASE_SERVICE_KEY` + a second `SUPABASE_JWT_SECRET` for synthetic-token signing).
  Scenario A — admin-create two FARMER users and one RESTAURANT user, capture their JWTs (forge with the test secret, since the project secret matches at this point); for each user, call `user_scoped_client(jwt).table("profiles").select("*")` and assert `len(rows) == 1 and rows[0]["id"] == that user's id`.
  Scenario B — same setup, then the FARMER attempts `update("profiles").eq("id", restaurant_user_id).set({"full_name": "hacked"})` and asserts `204` with `data == []` (PostgREST update-as-restricted returns no rows when policy fails — *not* an error). Profile remains unchanged.
  Skipped automatically when `SUPABASE_URL` is unset; CI runs against the seeded staging project.

- **`scripts/verify-rls-enabled.sh`** — new Bash guard. Connects via `psql $SUPABASE_DB_URL` and runs:
  ```sql
  select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;
  ```
  Exits 0 if the result set is empty; prints offending table names and exits 1 otherwise. Wired into `.github/workflows/ci.yml` under the `db` job (after `verify-jwt-config.sh`) and into `.pre-commit-config.yaml` as a local hook on `db/migrations/**`.

- **`docs/runbook.md`** — new *"AUTH-04 — RLS contract"* section. Authoritative tables documenting:
  - Policy pattern catalog: **owner-only** (using `auth.uid() = owner_id`), **role-gated** (using `auth.jwt()->>'user_role' = 'FARMER'`), **role-gated-with-staleness-protection** (using `public.has_role('FARMER')`), **admin-read** (using `public.is_admin()`), **public-read** (using `true` — for catalog views like FAR-02 list).
  - The three RLS bypass paths (service-role JWT, `bypassrls` role, `SECURITY DEFINER` function) and the audit point for each.
  - Recursion avoidance: never `select` from the *same* table inside a policy on that table — always go through a `SECURITY DEFINER` helper.
  - When to use the JWT-claim variant vs. the `profiles`-join variant (1 h staleness vs. immediate revocation).
  - Triage flow: "I see no rows" / "I see all rows" / `42501 permission denied` / `42P17 infinite recursion`.

- **`docs/spring-status.yml`** — flip `AUTH-04.status: TODO → IN_REVIEW` once local DoD is green; `DONE` after the staging cross-role drill (§6). Update `summary.done` / `summary.in_review` / `summary.todo`. Append a hand-off line under `project.last_updated`.

### Out of scope (later stories / explicit deferrals)

- **Per-table policies for tables that don't yet exist** — KAT-01 (parcels), KAT-02 (devices), KAT-03 (telemetry), FAR-01 (ads), FAR-04 (leads), SEC-01 (meals), SEC-04 (reservations), BOT-03 (leads). Each owner story attaches policies following the AUTH-04 catalog. AUTH-04 does *not* preempt them.
- **Storage RLS policies** — `farmarket-photos` bucket policies are FAR-07; `kyc-documents` bucket policies are AUTH-06. AUTH-04 does not touch `storage.objects` policies.
- **Exhaustive role × table × verb test matrix** — that is AUTH-07. AUTH-04 ships *one* cross-role smoke per the acceptance line.
- **Verification-status gate on inserts** — that is AUTH-06.
- **Service-key boundary CI grep** — that is AUTH-05's `scripts/check-service-key-boundary.sh`. AUTH-04 *documents* the boundary; AUTH-05 *enforces it* against frontend bundles.
- **Audit logging for SECURITY DEFINER calls** — post-MVD. The MVD threat model treats SECURITY DEFINER helpers as trusted; their source is reviewed at migration merge time.
- **`pg_audit` / row-level audit trails** — post-MVD; Supabase Auth Logs cover signup/login events for the demo.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [INF-02](INF-02-supabase-project-base-schema.md) merged | `public.profiles` exists with RLS enabled (migration 0002). `is_admin()` helper exists (migration 0005). Storage buckets exist (migration 0004). |
| [AUTH-02](AUTH-02-role-assignment-registration.md) merged | The custom access token hook places `user_role` into the JWT, which is the claim AUTH-04 policy patterns can read via `auth.jwt()->>'user_role'`. |
| [AUTH-03](AUTH-03-jwt-config-256bit-1h-7d.md) merged | `get_current_user()` and `AuthUser` exist in `backend/app/core/security.py`; the integration test seam uses the same JWT mint path. The `SUPABASE_JWT_SECRET` env var is wired through `Settings`. |
| `psql` reachable from the developer machine | `SUPABASE_DB_URL` (direct :5432 connection, service-role) needed for `scripts/verify-rls-enabled.sh` local runs. |
| pgTAP installed in the linked project | Confirmed during INF-02 (`db/Makefile` `test-auth01` target already uses pgTAP). |
| `supabase-py` ≥ 2.0 in `backend/requirements.txt` | Already present via AUTH-01. `postgrest-py` is a transitive dep. |

---

## 4. Target configuration

| Setting / artefact | Target value | Where set |
|---|---|---|
| Every `public.*` table | `relrowsecurity = true` | Per-table `alter table … enable row level security` in each table-creating migration. Today: only `public.profiles` (migration 0002, line 46). |
| `public.has_role(check_role)` | Exists, `SECURITY DEFINER`, `STABLE`, `set search_path = public, pg_temp` | `db/migrations/0008_auth04_has_role_helper.sql` |
| Event trigger `enforce_rls_on_public_tables` | Fires on `CREATE TABLE` in `public`; rejects DDL if `relrowsecurity = false` at commit | `db/migrations/0009_auth04_force_rls_contract.sql` |
| Backend user-scoped DB client | `postgrest.set_auth(token)` called per-request, never reused across users | `backend/app/db.py::user_scoped_client()` |
| Backend service-role DB client | One module-level instance; every call site has a justification comment | `backend/app/db.py::service_client()` |
| CI guard | `bash scripts/verify-rls-enabled.sh` step in `.github/workflows/ci.yml` `db` job | `.github/workflows/ci.yml` |
| pgTAP regression | `make -C db test-auth04` green | `db/Makefile`, `db/tests/auth04_*.sql` |

---

## 5. Step-by-step implementation

### 5.1 `db/migrations/0008_auth04_has_role_helper.sql` — reusable role check

Create [db/migrations/0008_auth04_has_role_helper.sql](../../db/migrations/0008_auth04_has_role_helper.sql):

```sql
-- =============================================================================
-- 0008 — public.has_role(check_role) — canonical RLS-side role check.
-- Story:  AUTH-04
--
-- Generalizes public.is_admin() (migration 0005). Use this helper instead of
-- embedding `(auth.jwt()->>'user_role') = 'FARMER'` in policies when:
--   * The staleness window of the JWT (≤ 1 h, AUTH-03 jwt_expiry) is unacceptable
--     for the gated action — i.e. a role downgrade must take effect immediately.
--   * The policy needs to be robust against a missing `user_role` claim
--     (older tokens issued before AUTH-02's hook activation).
--
-- For high-frequency reads where the 1-h staleness is acceptable (catalogs,
-- listings), prefer the JWT-claim variant — it avoids the DB round trip.
-- =============================================================================

create or replace function public.has_role(check_role public.user_role)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
    select coalesce(
        (select role = check_role
           from public.profiles
          where id = auth.uid()),
        false
    );
$$;

grant execute on function public.has_role(public.user_role)
    to anon, authenticated, service_role;

-- Re-base public.is_admin() onto has_role() for a single source of truth.
-- Idempotent replay against existing databases.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
    select public.has_role('ADMIN'::public.user_role);
$$;
```

**Why `SECURITY DEFINER` + `set search_path`?** The function executes with the privileges of its owner (the migration runner — service-role on Supabase). That bypasses RLS for the inner `select`, which is the entire point: a policy on `public.profiles` cannot read `public.profiles` directly without recursing. The `set search_path = public, pg_temp` clause defends against search-path hijacking attacks (a malicious extension installing a `profiles` view in a shadow schema).

**Why re-base `is_admin()`?** Single source of truth. If the role lookup mechanism ever changes (e.g. cached in a materialized view), only `has_role()` needs editing.

### 5.2 `db/migrations/0009_auth04_force_rls_contract.sql` — event trigger guard

Create [db/migrations/0009_auth04_force_rls_contract.sql](../../db/migrations/0009_auth04_force_rls_contract.sql):

```sql
-- =============================================================================
-- 0009 — Event trigger: refuse `CREATE TABLE` in `public` without RLS enabled.
-- Story:  AUTH-04
--
-- The CI test in scripts/verify-rls-enabled.sh and pgTAP db/tests/auth04_*.sql
-- are the *first* line of defence. This event trigger is the *last*: it fires
-- in-database, regardless of who issued the DDL (psql session, migration, the
-- Dashboard SQL editor). If a future table lands without `enable row level
-- security`, the CREATE TABLE statement aborts.
--
-- The trigger checks at the end of the `ddl_command_end` event, after the
-- table object exists. The migration that creates the table should enable
-- RLS in the *same transaction* (the existing 0002 pattern) — the trigger
-- enforces that the enable happened before commit.
-- =============================================================================

create or replace function public.enforce_rls_on_public_tables()
returns event_trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    obj record;
    schema_name text;
    table_name  text;
begin
    for obj in
        select * from pg_event_trigger_ddl_commands()
         where command_tag = 'CREATE TABLE'
    loop
        -- object_identity looks like "public.parcels"
        if obj.object_identity like 'public.%' then
            schema_name := split_part(obj.object_identity, '.', 1);
            table_name  := split_part(obj.object_identity, '.', 2);

            -- Strip optional quoting.
            table_name := trim(both '"' from table_name);

            if not exists (
                select 1
                  from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = schema_name
                   and c.relname = table_name
                   and c.relrowsecurity = true
            ) then
                raise exception
                    'AUTH-04: table %.% was created without row level security. '
                    'Add `alter table %.% enable row level security;` in the same '
                    'migration. See docs/runbook.md §AUTH-04 RLS contract.',
                    schema_name, table_name, schema_name, table_name
                    using errcode = '42501';
            end if;
        end if;
    end loop;
end;
$$;

drop event trigger if exists trg_enforce_rls_on_public_tables;
create event trigger trg_enforce_rls_on_public_tables
    on ddl_command_end
    when tag in ('CREATE TABLE')
    execute function public.enforce_rls_on_public_tables();
```

**Why an event trigger and not just CI?** Three reasons. (1) CI runs on PRs against `main`; ad-hoc dashboard SQL edits or a developer typing `psql` against staging skip CI entirely. (2) The event trigger catches the failure at the *exact point of the mistake*, with a precise error message — far better DX than "the build failed on a job called `db`". (3) It is the structural answer to a process question — code review fails open under deadline pressure; the database fails closed.

**Caveat — partition tables / `like` clones.** The trigger checks `relrowsecurity` directly, which is the storage-level flag and is *not* inherited by partitions or `create table … (like other)`. Documented in the runbook as the one corner case a future story may need to revisit.

### 5.3 `db/tests/auth04_rls_contract.sql` — structural pgTAP

Create [db/tests/auth04_rls_contract.sql](../../db/tests/auth04_rls_contract.sql):

```sql
-- AUTH-04 — every public table has RLS enabled and at least one policy.
\set ON_ERROR_STOP on
begin;

select plan(3);

-- (1) All public tables have RLS enabled.
select is(
    (select count(*)::int
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not c.relrowsecurity),
    0,
    'Every public.* table has row level security enabled'
);

-- (2) Every public table has at least one policy. (RLS without policies = deny-all,
--     which is acceptable for an *unused* table but a smell for any table the
--     application reads/writes. Catch the smell early.)
select is(
    (select count(*)::int
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind  = 'r'
        and not exists (
            select 1 from pg_policies p
             where p.schemaname = n.nspname
               and p.tablename  = c.relname
        )),
    0,
    'Every public.* table has at least one RLS policy'
);

-- (3) has_role() helper exists, is SECURITY DEFINER, and has the expected signature.
select ok(
    exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'has_role'
           and p.prosecdef = true
    ),
    'public.has_role(user_role) exists and is SECURITY DEFINER'
);

select * from finish();
rollback;
```

### 5.4 `db/tests/auth04_cross_role_isolation.sql` — behavioural pgTAP

Create [db/tests/auth04_cross_role_isolation.sql](../../db/tests/auth04_cross_role_isolation.sql):

```sql
-- AUTH-04 — cross-role access is denied at the row level.
\set ON_ERROR_STOP on
begin;

select plan(4);

-- Seed two users in different roles. We are running as service_role here
-- (the migration tester); the auth.users insert + on-signup trigger fills profiles.
do $$
declare
    farmer_id     uuid := gen_random_uuid();
    restaurant_id uuid := gen_random_uuid();
begin
    insert into auth.users (id, email, raw_user_meta_data)
    values
        (farmer_id,     'auth04-farmer@test.local',     jsonb_build_object('role', 'FARMER')),
        (restaurant_id, 'auth04-restaurant@test.local', jsonb_build_object('role', 'RESTAURANT'));
    -- The 0003 trigger materializes public.profiles rows from these inserts.

    perform set_config('test.farmer_id',     farmer_id::text,     true);
    perform set_config('test.restaurant_id', restaurant_id::text, true);
end $$;

-- Switch the JWT identity to the FARMER. set_config simulates what Supabase Auth
-- does at request time: writes the claims into request.jwt.claims.
select set_config(
    'request.jwt.claims',
    jsonb_build_object(
        'sub',       current_setting('test.farmer_id'),
        'user_role', 'FARMER',
        'role',      'authenticated'
    )::text,
    true
);
set local role authenticated;

-- (1) FARMER sees exactly one row in public.profiles (their own).
select is(
    (select count(*)::int from public.profiles),
    1,
    'FARMER sees exactly one profile row under RLS'
);

-- (2) That row is the FARMER's own profile.
select is(
    (select id::text from public.profiles limit 1),
    current_setting('test.farmer_id'),
    'The visible row is the FARMER own profile'
);

-- (3) FARMER cannot update the RESTAURANT user's profile (zero rows affected).
with attempt as (
    update public.profiles
       set full_name = 'hacked-by-farmer'
     where id = current_setting('test.restaurant_id')::uuid
    returning 1
)
select is(
    (select count(*)::int from attempt),
    0,
    'FARMER UPDATE against another user row affects zero rows (RLS filter)'
);

-- (4) Switch to RESTAURANT identity. Same query, different row.
reset role;
select set_config(
    'request.jwt.claims',
    jsonb_build_object(
        'sub',       current_setting('test.restaurant_id'),
        'user_role', 'RESTAURANT',
        'role',      'authenticated'
    )::text,
    true
);
set local role authenticated;

select is(
    (select id::text from public.profiles limit 1),
    current_setting('test.restaurant_id'),
    'RESTAURANT sees only the RESTAURANT own profile'
);

select * from finish();
rollback;
```

Wire into [db/Makefile](../../db/Makefile):

```make
test-auth04:
	@psql "$$SUPABASE_DB_URL" \
	  -v ON_ERROR_STOP=1 \
	  -f tests/auth04_rls_contract.sql \
	  -f tests/auth04_cross_role_isolation.sql

verify: test-auth01 test-auth02 test-auth04
```

### 5.5 `scripts/verify-rls-enabled.sh` — CI / pre-commit guard

Create [scripts/verify-rls-enabled.sh](../../scripts/verify-rls-enabled.sh):

```bash
#!/usr/bin/env bash
# AUTH-04 — assert every public.* table has RLS enabled.
# Connects via SUPABASE_DB_URL (direct :5432 service-role connection).
set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
    echo "AUTH-04 SKIP: SUPABASE_DB_URL not set (local dev — db tests will catch this in CI)"
    exit 0
fi

OFFENDERS=$(psql "$SUPABASE_DB_URL" -At -c "
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
     order by c.relname;
")

if [ -z "$OFFENDERS" ]; then
    echo "AUTH-04 OK: every public.* table has RLS enabled"
    exit 0
fi

echo "AUTH-04 FAIL: the following public.* tables do NOT have row level security enabled:" >&2
echo "$OFFENDERS" | sed 's/^/  - /' >&2
echo "" >&2
echo "Add 'alter table public.<name> enable row level security;' in the migration" >&2
echo "that creates the table. See docs/runbook.md §AUTH-04 RLS contract." >&2
exit 1
```

Wire into [.github/workflows/ci.yml](../../.github/workflows/ci.yml) `db` job, after the AUTH-03 step:

```yaml
- name: AUTH-04 — RLS enabled on every public table
  env:
    SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
  run: bash scripts/verify-rls-enabled.sh
```

Wire into [.pre-commit-config.yaml](../../.pre-commit-config.yaml):

```yaml
- id: auth04-rls-enabled
  name: AUTH-04 RLS enabled on every public table
  entry: scripts/verify-rls-enabled.sh
  language: script
  files: '^db/migrations/.*\.sql$'
  pass_filenames: false
```

### 5.6 `backend/app/db.py` — user-scoped client factory

Create [backend/app/db.py](../../backend/app/db.py):

```python
"""Database client factories.

AUTH-04 — two and only two ways to reach Postgres from the backend:

  * service_client()         — service role. Bypasses RLS. Reserved for admin
                               operations (ADM-02 approve, AUTH-06 set
                               verification_status, on-signup triggers). EVERY
                               call site must carry an inline justification.

  * user_scoped_client(token) — the caller's JWT is forwarded to PostgREST via
                               postgrest.set_auth(); RLS evaluates as the
                               authenticated role with the user's claims. This
                               is the default for every domain endpoint.

If you find yourself reaching for service_client() from a user-facing endpoint
to "fix" a permission denied, the RLS policy is the bug, not the client choice.
See docs/runbook.md §AUTH-04 RLS contract.
"""

from __future__ import annotations

from supabase import Client, create_client

from .core.config import get_settings


def service_client() -> Client:
    """Service-role client. Bypasses RLS. Use sparingly; justify each call site."""
    settings = get_settings()
    return create_client(
        settings.supabase_url,
        settings.supabase_service_key.get_secret_value(),
    )


def user_scoped_client(bearer_token: str) -> Client:
    """User-JWT client. RLS fires. The default for domain endpoints."""
    if not bearer_token:
        raise ValueError("empty bearer token — refusing to fall back to anon role")

    settings = get_settings()
    # The `apikey` header still carries the anon key (Supabase requires it on
    # every PostgREST request). The user's JWT goes into the `Authorization`
    # header via postgrest.set_auth(), which is what RLS evaluates.
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(bearer_token)
    return client
```

> **Note** — this assumes `Settings.supabase_anon_key` exists. If it does not yet (INF-04 / AUTH-01 only wired the service key), add it in this story's `config.py` edit alongside the existing fields. The anon key is published / safe to bundle.

### 5.7 Convenience: a FastAPI dependency that returns the user-scoped client

Append to [backend/app/core/security.py](../../backend/app/core/security.py):

```python
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials
from supabase import Client

from ..db import user_scoped_client


async def get_db_for_user(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
) -> Client:
    """RLS-scoped client for the caller. Wires AUTH-03's bearer credential into
    AUTH-04's user_scoped_client() in one Depends() call.

    Usage:
        async def list_ads(db: Client = Depends(get_db_for_user)):
            return db.table("ads").select("*").execute().data
    """
    return user_scoped_client(creds.credentials)
```

This is the one-liner every downstream handler imports. The route still has access to `AuthUser` if it adds a second `Depends(get_current_user)` — both decode the same JWT, but the cost of a second decode is ~50 µs.

### 5.8 `backend/tests/test_db_user_scoping.py` and `test_rls_smoke.py`

[backend/tests/test_db_user_scoping.py](../../backend/tests/test_db_user_scoping.py) — pure unit, no network:

```python
from unittest.mock import MagicMock, patch

import pytest

from app.db import service_client, user_scoped_client


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "eyJ.anon")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "eyJ.service")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "x" * 64)
    import importlib, app.core.config as cfg
    importlib.reload(cfg)


def test_user_scoped_client_calls_set_auth():
    fake_client = MagicMock()
    with patch("app.db.create_client", return_value=fake_client) as creator:
        user_scoped_client("the-bearer-token")
    creator.assert_called_once()
    fake_client.postgrest.auth.assert_called_once_with("the-bearer-token")


def test_user_scoped_client_rejects_empty_token():
    with pytest.raises(ValueError, match="empty bearer token"):
        user_scoped_client("")


def test_two_users_get_independent_clients():
    with patch("app.db.create_client", side_effect=lambda *_: MagicMock()):
        a = user_scoped_client("token-a")
        b = user_scoped_client("token-b")
    assert a is not b


def test_service_client_does_not_call_set_auth():
    fake = MagicMock()
    with patch("app.db.create_client", return_value=fake):
        service_client()
    fake.postgrest.auth.assert_not_called()
```

[backend/tests/test_rls_smoke.py](../../backend/tests/test_rls_smoke.py) — live smoke, skipped without credentials:

```python
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_DB_URL"),
    reason="live RLS smoke requires staging credentials",
)


def test_farmer_sees_only_own_profile(staging_farmer_jwt, staging_farmer_id):
    from app.db import user_scoped_client

    rows = (user_scoped_client(staging_farmer_jwt)
            .table("profiles").select("id").execute().data)
    assert len(rows) == 1
    assert rows[0]["id"] == staging_farmer_id


def test_farmer_cannot_update_other_user(
    staging_farmer_jwt, staging_restaurant_id
):
    from app.db import user_scoped_client

    result = (user_scoped_client(staging_farmer_jwt)
              .table("profiles")
              .update({"full_name": "hacked"})
              .eq("id", staging_restaurant_id)
              .execute())
    # PostgREST returns an empty data list when RLS filters all rows.
    assert result.data == []
```

Fixtures `staging_farmer_jwt`, `staging_farmer_id`, `staging_restaurant_id` live in `backend/tests/conftest.py` — minted via `_make_token()` from `test_security.py` (AUTH-03) using the seeded staging users created during INF-02 §5.12. If those seeds don't exist yet, create them in the same PR as a `db/seeds/auth04_test_users.sql` file.

### 5.9 Runbook section

Append to [docs/runbook.md](../runbook.md):

````markdown
## AUTH-04 — RLS contract

### Policy pattern catalog

Every future migration that creates a table in `public` must enable RLS and attach at least one policy. Pick the pattern that matches the access shape; do not invent new ones without updating this catalog.

| Pattern | When to use | Template |
|---|---|---|
| **owner-only** | Caller can read/write exactly the rows they own (parcels, reservations, citizen-side bookings). | `using (auth.uid() = owner_id)` |
| **role-gated (JWT fast path)** | Catalog browse, listings, anywhere ≤ 1 h staleness on role downgrade is acceptable. | `using ((auth.jwt()->>'user_role') = 'FARMER')` |
| **role-gated (immediate revoke)** | Money-handling, admin override, sensitive flips. | `using (public.has_role('FARMER'))` |
| **admin-read** | Verification queues (ADM-02), lead overviews (ADM-03), commission reports. | `using (public.is_admin())` |
| **public-read** | Marketplace catalogs (FAR-02 ads list, SEC-02 meals map). | `for select using (true)` — combine with a `where status = 'ACTIVE'` guard if the table mixes draft/published rows. |

### The three legitimate RLS bypass paths

1. **`service_role` JWT** — the backend's `service_client()` (FastAPI). Audit point: every call to `app.db.service_client()` must carry an inline justification comment. AUTH-05 ships the boundary check.
2. **`bypassrls` superuser role** — used only by Supabase platform tooling. Never granted to application roles.
3. **`SECURITY DEFINER` function** — `public.has_role`, `public.is_admin`, the on-signup trigger from migration 0003. Audit point: code review of every new `SECURITY DEFINER` function in a migration.

### Triage flow

| Symptom | Likely cause | Action |
|---|---|---|
| "I see no rows" for a logged-in user | The endpoint calls `service_client()` and forgot to filter, *or* RLS is enabled but no policy matches. | `select * from pg_policies where tablename = '<table>';` — confirm policy presence and its `qual`. |
| "I see ALL rows" from a user-facing endpoint | The handler is using `service_client()` instead of `user_scoped_client(token)`. | Replace with `Depends(get_db_for_user)`; remove the `service_client()` import unless an admin path was intended. |
| `42501 — permission denied for table X` | RLS is enabled and no policy admits the operation. | Either add the policy or confirm the user *should* be denied. If the operation is admin-only, switch the endpoint to `service_client()` *and* add an admin role gate (`require_role("ADMIN")`). |
| `42P17 — infinite recursion detected in policy for relation X` | A policy on table X reads from table X without going through a SECURITY DEFINER helper. | Move the lookup into a `has_role`-style helper (template: migration 0005 `is_admin()` / migration 0008 `has_role()`). |
| `CREATE TABLE ... ERROR: AUTH-04: table ... was created without row level security` | The event trigger from migration 0009 fired. | Add `alter table <schema>.<name> enable row level security;` to the *same* migration, before the trigger fires at `ddl_command_end`. |

### Stale-role window

A user's role lives inside their JWT. If you flip `role` on `public.profiles` (e.g. an admin demotes a misbehaving FARMER), the user's *current* access token still claims `user_role = 'FARMER'` until it expires (≤ 1 h, AUTH-03 `jwt_expiry`).

- If immediate revocation is required: `delete from auth.refresh_tokens where user_id = <id>;` — the next refresh fails; the access token is unusable within ≤ 1 h.
- If a policy must enforce live role (no staleness): use the `public.has_role()` SECURITY DEFINER variant. Cost: one DB round-trip per policy evaluation.
- Most marketplace and listing endpoints tolerate ≤ 1 h staleness happily; use the JWT-claim variant there.
````

### 5.10 `docs/spring-status.yml` — hand-off line and status

Update the `summary` counters (`todo` -1, `in_review` +1) and `current_phase` if applicable. Set `AUTH-04.status: TODO → IN_REVIEW`. Append to `project.last_updated`:

```
# 2026-MM-DD — AUTH-04 LOCAL DONE: RLS contract codified (policy pattern
# catalog), enforcement landed (migration 0009 event trigger + scripts/
# verify-rls-enabled.sh CI guard + db/tests/auth04_*.sql pgTAP coverage),
# and the backend user-scoped client (backend/app/db.py::user_scoped_client)
# is the canonical path every downstream domain endpoint will Depends() on
# via get_db_for_user. is_admin() is re-based on has_role() for a single
# source of truth. Unblocks: AUTH-05 (boundary observable), AUTH-06
# (verification gate as an RLS policy), AUTH-07 (full role × table × verb
# matrix), every domain table story (KAT-01/02/03, FAR-01..05, SEC-01..08,
# BOT-03, ADM-01..03). DoD flips to DONE on: (a) staging cross-role drill —
# sign in as FARMER + RESTAURANT, dump public.profiles, confirm each sees
# 1 row; (b) `make -C db test-auth04` green on the linked project;
# (c) `bash scripts/verify-rls-enabled.sh` exits 0 with SUPABASE_DB_URL set
# to staging.
```

---

## 6. Verification

Run in order on a clean working tree:

```bash
# 1. Migrations land cleanly.
supabase db push --linked
# Expect: 0008_auth04_has_role_helper.sql, 0009_auth04_force_rls_contract.sql applied.

# 2. pgTAP structural + behavioural tests.
make -C db test-auth04
# Expect: 7 pgTAP `ok` lines + ROLLBACK from each file.

# 3. RLS coverage guard.
SUPABASE_DB_URL=<staging-direct-url> bash scripts/verify-rls-enabled.sh
# Expect: "AUTH-04 OK: every public.* table has RLS enabled"

# 4. Negative test for the event trigger.
psql "$SUPABASE_DB_URL" -c "
    begin;
    create table public.auth04_negative_test (id uuid primary key);
    -- Intentionally NOT enabling RLS.
    -- Expect: ERROR 42501 with the AUTH-04 message at COMMIT.
    rollback;
"
# Expect: the create succeeds inside the transaction but the event trigger
# raises at ddl_command_end of the CREATE. (Confirm the exact firing point;
# Postgres event triggers fire per-statement, so the failure is at CREATE,
# not at COMMIT.) The rollback cleans up either way.

# 5. Backend unit tests.
cd backend && pytest tests/test_db_user_scoping.py -v
# Expect: 4 assertions pass.

# 6. Backend live smoke (staging only).
SUPABASE_URL=https://qyyxgdfetzjqfpygikbz.supabase.co \
SUPABASE_DB_URL=<staging-direct-url> \
pytest tests/test_rls_smoke.py -v
# Expect: 2 assertions pass against the seeded staging users.

# 7. CI guard locally.
bash scripts/verify-rls-enabled.sh   # exits 0
bash scripts/verify-jwt-config.sh    # still 0 — AUTH-03 untouched

# 8. Full pytest suite — no regressions.
cd backend && pytest tests/
```

**Manual staging cross-role drill** (gates DoD):
1. Sign in via the Next.js frontend as the seeded `auth04-farmer@test.local`. Open DevTools → Application → Cookies → copy the `access_token`.
2. `curl -H "Authorization: Bearer $FARMER_TOKEN" -H "apikey: $ANON_KEY" "$SUPABASE_URL/rest/v1/profiles?select=id,email,role"` — expect exactly one row, the FARMER's.
3. Repeat with `auth04-restaurant@test.local`'s token — expect exactly one row, the RESTAURANT's.
4. From the FARMER token, attempt `PATCH /rest/v1/profiles?id=eq.<restaurant-id>` with `{"full_name": "hacked"}` — expect `204 No Content` with empty body (PostgREST signals "RLS filtered all rows" silently). Re-query as service role: confirm the RESTAURANT's `full_name` is unchanged.
5. Record outcomes in the runbook AUTH-04 drill log.

---

## 7. Risks & failure modes

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Event trigger from migration 0009 blocks a legitimate migration mid-flight** | Medium during early-phase table additions | Medium — the developer sees `42501 AUTH-04: ...` and fixes by adding `enable row level security` in the same file. | The error message names the exact remediation. CI catches it earlier in any case; the trigger is the backstop. |
| **Recursive policy (42P17) introduced by a downstream story** | Medium across the next 8 weeks (every table-creating story) | Medium — table becomes unqueryable until policy is fixed | Catalog forbids `select from same table`; `has_role()` / `is_admin()` SECURITY DEFINER helpers are the canonical pattern. Code review checklist on every migration PR. |
| **Stale `user_role` claim grants ≤ 1 h of phantom access after role downgrade** | Low — role downgrades are rare in MVD | Medium — depends on the downgrade reason | Documented; `delete from auth.refresh_tokens where user_id = …` closes the window. Policies on money-touching tables use the `has_role()` SECURITY DEFINER variant (no staleness). |
| **A handler uses `service_client()` for a user-facing read** | Medium — easy mistake | High — cross-tenant leak | AUTH-05 grep boundary catches it; the runbook triage flow names "I see ALL rows" as the symptom. The `# JUSTIFICATION:` comment-requirement above each `service_client()` call site makes accidental usage stand out in review. |
| **`postgrest.auth(token)` not idempotent across reuses** | Low | Medium — wrong identity attached to subsequent queries on a reused client | The factory returns a *new* client per call; nothing in `app/db.py` caches. Test `test_two_users_get_independent_clients` enforces it. |
| **Supabase free tier or staging restarts wipe seed users for `test_rls_smoke`** | Low | Low — the test skips when fixtures cannot be loaded | Conftest re-seeds idempotently from `db/seeds/auth04_test_users.sql`. |
| **Event trigger missed on `like` clones / partitions** | Very low for MVD (no partitioning planned) | Medium | Documented corner case in §5.2. Re-evaluate when partitioning is introduced. |
| **`bypassrls` accidentally granted to an app role** | Very low | Critical | Migration review; `pg_roles` audit in the runbook section. |

---

## 8. Definition of Done

- [ ] `db/migrations/0008_auth04_has_role_helper.sql` — `public.has_role(check_role)` exists; `public.is_admin()` rebased onto it.
- [ ] `db/migrations/0009_auth04_force_rls_contract.sql` — `enforce_rls_on_public_tables` event trigger active; negative test §6 step 4 fails the offending DDL with the expected error code (42501) and message.
- [ ] `db/tests/auth04_rls_contract.sql` — 3 pgTAP assertions green.
- [ ] `db/tests/auth04_cross_role_isolation.sql` — 4 pgTAP assertions green; both `is` checks confirm each role sees exactly its own profile.
- [ ] `db/Makefile` — `test-auth04` target wired into `verify`.
- [ ] `backend/app/db.py` — `service_client()` and `user_scoped_client(token)` exist; `user_scoped_client("")` raises `ValueError`.
- [ ] `backend/app/core/security.py` — `get_db_for_user` dependency added; existing `get_current_user` / `require_role` unchanged.
- [ ] `backend/app/core/config.py` — `supabase_anon_key: str` field present (no SecretStr — anon key is public).
- [ ] `backend/tests/test_db_user_scoping.py` — 4 assertions pass.
- [ ] `backend/tests/test_rls_smoke.py` — 2 assertions pass against staging; skipped cleanly when `SUPABASE_DB_URL` is unset.
- [ ] `scripts/verify-rls-enabled.sh` exits 0 against the staging DB.
- [ ] CI `db` job has the `verify-rls-enabled.sh` step; pre-commit hook is wired and fires on `db/migrations/**` edits.
- [ ] `docs/runbook.md` has the *"AUTH-04 — RLS contract"* section (policy catalog, three bypass paths, triage flow, stale-role window).
- [ ] Manual staging cross-role drill (§6 steps 1–5) recorded in the runbook drill log: FARMER sees 1 row, RESTAURANT sees 1 row, cross-row UPDATE attempt returns 204 with empty body and leaves the target row unchanged.
- [ ] `docs/spring-status.yml` — `AUTH-04.status: TODO → IN_REVIEW`; `summary` counters updated; hand-off line appended under `project.last_updated`.
- [ ] `ruff check backend/app/db.py` and `mypy backend/app/db.py` pass cleanly.

---

## 9. Hand-off notes

- **For AUTH-05 (service-key isolation):** AUTH-04 makes the user-JWT vs service-key call sites *syntactically distinct* in [backend/app/db.py](../../backend/app/db.py). AUTH-05's `scripts/check-service-key-boundary.sh` should grep for `service_client(` usage outside an allow-list of admin / on-signup / verification modules. Every other call site is a regression. The same script should grep the *frontend* bundle (`.next/static`) for `SUPABASE_SERVICE_KEY` / the actual key prefix — that is the must-never-leak check.

- **For AUTH-06 (KYC / verification_status gate):** The verification gate on `farmarket.ads` and `secondserve.meals` `INSERT` is implemented as an RLS policy on those tables: `with check (auth.uid() = owner_id and public.has_role('FARMER') and (select verification_status from public.profiles where id = auth.uid()) = 'VERIFIED')`. The `has_role()` helper this story ships is the building block; AUTH-06 only needs to add the `verification_status` clause. Optional: extend `has_role` to `has_role_and_verified()` if the pattern repeats more than twice.

- **For AUTH-07 (full role × table × verb test matrix):** The pattern in [db/tests/auth04_cross_role_isolation.sql](../../db/tests/auth04_cross_role_isolation.sql) — seed users, `set_config('request.jwt.claims', …)`, `set local role authenticated`, assert query results — is the *prototype* for AUTH-07's per-role test grid. AUTH-07 generalizes it across all role values from `db/migrations/0001_extensions_and_enums.sql` and all tables added by each module story. The `tests/test_security.py::_make_token` fixture (AUTH-03) is the canonical synthetic-JWT helper on the Python side.

- **For every domain table story (KAT-01 parcels, KAT-02 devices, KAT-03 telemetry, FAR-01 ads, FAR-04 leads, SEC-01 meals, SEC-04 reservations, BOT-03 leads, ADM-* admin views):** The migration that creates the table MUST (a) call `alter table public.<name> enable row level security;` in the same file, (b) attach at least one policy (pick from the catalog in [docs/runbook.md](../runbook.md) §AUTH-04), (c) be reviewed for recursion (no `select from <same table>` inside its own policies — go through a SECURITY DEFINER helper). The event trigger from migration 0009 is the structural backstop; do not rely on it as the only check.

- **For every domain handler story (KAT-03 ingest, FAR-01..05 ads, SEC-01..08 meals, BOT-04 admin lead view, ADM-01..03 admin shell):** Default to `Depends(get_db_for_user)` for the database client; reach for `service_client()` only with an inline `# JUSTIFICATION: <reason>` comment that names the admin / system-level reason the user JWT cannot be used. Code review will reject `service_client()` calls without that comment.

---

*AUTH-04 implementation guide — generated under BMAD methodology — references PRD §7.1, §8.3 and `docs/spring-status.yml` lines 632–637.*
