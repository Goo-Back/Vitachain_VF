# VitaChain — Database

> Schema, migrations and verification scripts for the single Supabase project that backs every module.
> Owning story: [INF-02](../docs/stories/INF-02-supabase-project-base-schema.md).

---

## Layout

```
db/
├── migrations/        # numbered, append-only SQL files — source of truth
│   ├── 0001_extensions_and_enums.sql
│   ├── 0002_profiles.sql
│   ├── 0003_profile_on_signup.sql
│   └── 0004_storage_buckets.sql
├── seeds/             # optional demo data (gitkeep'd; populated by INF-03 fixtures)
├── scripts/
│   ├── push.sh        # apply every migration in order via psql
│   ├── verify.sh      # automated checks from INF-02 §6
│   └── smoke-signup.sh# positive + negative signup smoke test (INF-02 §5.12)
├── .env.example       # template; copy to db/.env (git-ignored) and fill from Bitwarden
└── Makefile           # `make -C db <target>` entrypoint
```

---

## Golden rules

1. **Every schema change is a new file.** Never edit a migration that has been applied to the remote Supabase project — add a new one. Numbered prefix is monotonically increasing (next free number wins).
2. **Migrations are idempotent.** `create … if not exists`, `do $$ … exception when duplicate_object then null; end $$`, `drop policy if exists` then `create policy`. Reapplying must be a no-op.
3. **RLS on by default.** Any table that holds user-attributable data must `alter table … enable row level security` in the same migration that creates it, with at least one explicit policy. CI in INF-05 will fail the build if a table has RLS off.
4. **Service-role JWT is backend-only.** Never reference `SUPABASE_SERVICE_ROLE_KEY` in `frontend/` code. PRD §7.1 AUTH-05.

---

## First-time setup

1. Provision the Supabase project per [INF-02 §5.1–5.3](../docs/stories/INF-02-supabase-project-base-schema.md).
2. Pull keys from Bitwarden into `db/.env` (template in `.env.example`).
3. `make -C db push` — applies every migration in numeric order.
4. `make -C db verify` — runs the INF-02 §6 verification checklist.
5. `make -C db smoke` — signs up a throwaway citizen and confirms the profile row.

---

## Day-to-day

| You want to … | Run |
|---|---|
| Add a new column / table | Create the next `00NN_<short>.sql` under `migrations/`; `make push`; commit. |
| Apply pending migrations to remote | `make -C db push` |
| Re-run the smoke test | `make -C db smoke` |
| Inspect what's in `profiles` | `make -C db psql` then `select id, role, verification_status from public.profiles;` |
| Wipe + reapply on a fresh staging DB | `make -C db reset` (refuses if `DB_URL` points at the production project) |

---

## CI integration (INF-05)

GitHub Actions will:
1. Spin up a disposable `postgres:15` container.
2. Apply every `db/migrations/*.sql` in order.
3. Run a smoke test that signs up one user per role and asserts the trigger created the profile.
4. Grep the Next.js build output for `SUPABASE_SERVICE_ROLE_KEY` — fail if present (AUTH-05).

---

## Why not `supabase db push` directly?

The Supabase CLI expects migrations under `supabase/migrations/` with timestamped filenames (`YYYYMMDDHHMMSS_name.sql`). Our `db/migrations/` layout uses short ordinal prefixes that are easier to read in PRs and reason about in dependency comments. `make push` calls `psql` directly with the remote connection string, which:

- works without the Supabase CLI installed,
- runs in CI with just a Postgres client,
- handles ordering deterministically by `LC_ALL=C` sort.

Teams that prefer the Supabase CLI can run `supabase db push` against a parallel `supabase/migrations/` symlink tree — both work, but `make push` is the authoritative path.
