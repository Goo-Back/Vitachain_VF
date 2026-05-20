# INF-02 — Completion Checklist

> **Companion to:** [INF-02-supabase-project-base-schema.md](INF-02-supabase-project-base-schema.md)
> **You are here because:** all code/config artifacts are already on disk under [db/](../../db/) and [supabase/](../../supabase/); the only thing left is to create the live Supabase project, wire the local `.env`, apply migrations, and prove the system end-to-end.
> **Goal:** flip `INF-02.status` from `IN_PROGRESS` → `DONE` in [docs/spring-status.yml](../spring-status.yml).
> **Time budget:** ~60–75 minutes of focused work.

---

## Before you start — prerequisites

Check each of these once. If any is missing, fix it before opening the Supabase dashboard.

- [ ] You have access to the shared team Google account that owns the Supabase org.
- [ ] You have write access to the shared Bitwarden vault.
- [ ] Domain `vitachain.ma` resolves (smoke test from §5.10 of INF-01). If INF-01 isn't `DONE`, **stop and finish INF-01 first** — DNS is needed for the Auth Site URL.
- [ ] You have `psql` and `curl` installed locally:
  ```powershell
  psql --version    # any 14+ works; ship with PostgreSQL client tools
  curl --version
  ```
  Windows: `winget install PostgreSQL.PostgreSQL` (installs `psql`) or `choco install postgresql`. macOS: `brew install libpq && brew link --force libpq`. Linux: `apt install postgresql-client`.
- [ ] You can run `bash` scripts. On Windows use Git Bash, WSL, or `bash` from MSYS — the scripts under `db/scripts/` use POSIX bash, not PowerShell.

---

## Step 1 — Create the Supabase project (~10 min)

1. Go to <https://app.supabase.com>. Sign in with the shared team account.
2. Click **New project**. Fill in:
   - **Name:** `vitachain-prod`
   - **Organization:** the shared VitaChain org
   - **Region:** `eu-central-1` (Frankfurt) — PRD §4.1
   - **Database password:** click the generator, then **immediately copy it**. Save to Bitwarden as `VitaChain — Supabase DB password` before anything else.
   - **Plan:** Free
3. Click **Create new project**. Wait ~2 min for provisioning.
4. Once provisioned, the URL bar shows `app.supabase.com/project/<ref>` — record `<ref>` (e.g. `abcdefghijklmnop`). You will need it five times below.

✅ **Done when:** the dashboard lands on the Project home page for `vitachain-prod`.

---

## Step 2 — Record all secrets in Bitwarden (~10 min)

From the project dashboard, open **Settings → API**. Create these Bitwarden entries (one per row — do **not** stuff them all in a single note):

| Bitwarden entry name | Source in dashboard | Audience |
|---|---|---|
| `VitaChain — Supabase URL` | Settings → API → **Project URL** | Whole team (public) |
| `VitaChain — Supabase anon key` | Settings → API → **Project API keys → anon public** | Whole team (frontend bundle) |
| `VitaChain — Supabase service_role key` | Settings → API → **Project API keys → service_role** | **Backend only.** Never share with frontend devs. |
| `VitaChain — Supabase JWT secret` | Settings → API → **JWT Settings → JWT Secret** | Backend only (FastAPI verifies JWTs) |
| `VitaChain — Supabase DB password` | What you saved in Step 1 | Backend only |

✅ **Done when:** all five entries exist in the shared vault and you have personally opened each one to confirm the value is correct (paste errors are the #1 failure mode of this whole story).

---

## Step 3 — Configure Auth (~5 min)

### 3a. Email provider

**Authentication → Providers → Email**:
- ✅ Enable Email provider — **on**
- ✅ Confirm email — **off** (MVD only; re-enable post-launch)
- ✅ Secure email change — **on**

Click **Save**.

### 3b. URL configuration

**Authentication → URL Configuration**:
- **Site URL:** `http://vitachain.ma`  ← swap to `https://` after INF-06 lands
- **Redirect URLs** (add both):
  - `http://vitachain.ma/auth/callback`
  - `http://localhost:3000/auth/callback`

Click **Save**.

### 3c. JWT settings

**Settings → API → JWT Settings**:
- Confirm **JWT expiry** = `3600`. If not, set it and **Save**.
- Confirm the JWT secret is ≥ 32 chars. If Supabase pre-generated something shorter, click **Generate a new secret**, save the new value to Bitwarden, **redeploy any backend that uses it** (none yet at this stage, so safe to rotate).

✅ **Done when:** all three sub-sections saved; refreshing the page shows the values stuck.

---

## Step 4 — Wire `db/.env` (~5 min)

On your laptop, from the repo root:

```bash
cp db/.env.example db/.env
```

Open [db/.env](../../db/.env) and fill the five variables from Bitwarden:

```ini
DB_URL=postgresql://postgres:<DB_PASSWORD>@db.<ref>.supabase.co:5432/postgres
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...           # the anon key from Step 2
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # the service_role key from Step 2
```

**Sanity check** — confirm psql can connect before applying migrations:

```bash
psql "$(grep ^DB_URL db/.env | cut -d= -f2-)" -c "select version();"
```

You should see the Postgres version string. If you see `connection refused`, double-check the DB password and the `<ref>` portion of `DB_URL`.

> ⚠ **Confirm `db/.env` is git-ignored:**
> ```bash
> git check-ignore db/.env && echo "ignored ✓" || echo "NOT IGNORED — fix .gitignore before committing"
> ```

✅ **Done when:** `psql` returns a version string and `git check-ignore` confirms the file is ignored.

---

## Step 5 — Apply migrations (~5 min)

From the repo root:

```bash
make -C db push
```

Expected output (final lines):

```
  ▶ applying 0001_extensions_and_enums …
  ✓ 0001_extensions_and_enums
  ▶ applying 0002_profiles …
  ✓ 0002_profiles
  ▶ applying 0003_profile_on_signup …
  ✓ 0003_profile_on_signup
  ▶ applying 0004_storage_buckets …
  ✓ 0004_storage_buckets
----------------------------------------
Applied: 4   Skipped: 0
```

Re-run `make -C db push` once. Every line should now say `(already applied)` and the counter reads `Applied: 0   Skipped: 4`. This proves idempotency — important because CI will replay them on every PR.

**Verify in the dashboard:**
1. **Database → Tables → public** — `profiles` is listed.
2. Click `profiles` → look for the **🔒 RLS enabled** badge. If it's red/disabled, migration 0002 did not run; re-check `make push` output.
3. **Database → Triggers** — `on_auth_user_created` is present on `auth.users`.
4. **Storage → Buckets** — both `farmarket-photos` (public) and `kyc-documents` (private) exist.

✅ **Done when:** all four migrations applied, a second `push` is a no-op, and the dashboard shows the four artifacts above.

---

## Step 6 — Run the automated verification (~2 min)

```bash
make -C db verify
```

Expected: **13/13 ✓**, exit code 0. If any line shows ✗:

| Failing line | Likely cause | Fix |
|---|---|---|
| `pgcrypto extension installed` | Free tier blocked the install | Open SQL editor in dashboard, run `create extension "pgcrypto";` manually, then re-run verify. |
| `RLS enabled on public.profiles` | Migration 0002 didn't fully apply | `make -C db reset` (staging only!) or hand-run the `alter table … enable row level security` line. |
| `on_auth_user_created trigger exists` | Migration 0003 didn't apply | Re-run `make -C db push`; check for SQL errors in the output. |
| `farmarket-photos storage bucket exists` | Migration 0004 silently no-op'd | Run the bucket inserts from `db/migrations/0004_storage_buckets.sql` directly in the SQL editor. |

✅ **Done when:** the script ends with `Passed: 13   Failed: 0` and exit code 0 (`echo $?` → `0`).

---

## Step 7 — Run the signup smoke test (~5 min)

```bash
make -C db smoke
```

Expected output:

```
INF-02 signup smoke test against https://<ref>.supabase.co
----------------------------------------
  ✓ signup with role=CITIZEN returned 200
  ✓ trigger inserted profile (CITIZEN/PENDING/fr)
  ✓ signup with role=PIRATE rejected (HTTP 422 or 500)
  ✓ no orphan profile row for the rejected signup
----------------------------------------
Passed: 4   Failed: 0
```

This is the **acceptance criterion** for INF-02: signing up a user creates a `public.profiles` row via the trigger. If `Passed: 4`, the story is functionally done.

**If line 2 (`trigger inserted profile`) fails:**
- Open **Database → Functions** in the dashboard, click `handle_new_user`, check the source matches `db/migrations/0003_profile_on_signup.sql`.
- Open **Auth → Users**. If a row exists there for `smoke-<timestamp>@vitachain.test` but `profiles` is empty, the trigger ran but inserted into the wrong place or raised an exception. Check **Database → Logs** for the failed insert.

**If line 3 (`PIRATE rejected`) fails (i.e. signup succeeded):**
- The validation in `handle_new_user()` was never deployed. Re-run `make -C db push` — look for `0003` in the applied list.

✅ **Done when:** the script ends with `Passed: 4   Failed: 0` and exit code 0.

---

## Step 8 — Update spring-status.yml (~2 min)

Edit [docs/spring-status.yml](../spring-status.yml):

### 8a. Flip the story to DONE

Find INF-02 and change two things:

```diff
       - id: INF-02
         title: Set up Supabase project + base schema + profiles table
         priority: Must
-        status: IN_PROGRESS
+        status: DONE
         acceptance: "Auth working; profiles row created on signup"
         depends_on: [INF-01]
-        # Artifacts ready: db/migrations/{0001..0004}, db/Makefile + scripts, supabase/config.toml,
-        # .env.example, runbook entry. Flip to DONE once `make -C db verify` + `make -C db smoke`
-        # are both green against the live project.
+        # Completed YYYY-MM-DD by <your-name>. `make -C db verify` + `make -C db smoke` both green.
```

### 8b. Bump the rollup

```diff
 summary:
   total_epics: 8
   total_stories: 60
-  done: 0
-  in_progress: 2
+  done: 1
+  in_progress: 1
   blocked: 0
-  todo: 58
+  todo: 58       # unchanged — INF-02 moved from in_progress, not todo
```

### 8c. Add a dated changelog note

At the top of the file under the existing notes:

```diff
   last_updated: 2026-05-14
   # 2026-05-14 — INF-01 artifacts produced under infra/; awaiting VPS provisioning to flip to DONE.
   # 2026-05-14 — INF-02 artifacts produced under db/ + supabase/; awaiting Supabase project creation to flip to DONE.
+  # YYYY-MM-DD — INF-02 DONE: live project at <ref>, verify+smoke both green.
```

Also update `last_updated:` to today's date.

✅ **Done when:** `git diff docs/spring-status.yml` shows the three changes above.

---

## Step 9 — Commit & hand off (~5 min)

```bash
git add db/ supabase/ .env.example .gitignore docs/runbook.md docs/spring-status.yml docs/stories/INF-02-*.md
git status                                  # eyeball — nothing in db/.env should appear
git commit -m "INF-02: Supabase project provisioned; migrations applied; verify+smoke green"
git push
```

Then post in the team channel:

```
✅ INF-02 DONE
- Supabase project vitachain-prod live (eu-central-1)
- 4 migrations applied; RLS on profiles verified
- Signup trigger smoke-tested (positive + negative)

🟢 Unblocked: AUTH-01, AUTH-02, AUTH-04, INF-03, INF-04, INF-07
🔑 Keys in Bitwarden: 5 new entries prefixed "VitaChain — Supabase …"
📖 Recovery runbook: docs/runbook.md → "Supabase bootstrap & recovery"
```

✅ **Done when:** the commit is on the default branch, the team channel post is sent, and the next developer can pick up AUTH-01 or INF-03 without asking you for any keys.

---

## Final completion checklist

Copy this block into the PR description or your daily log and tick as you go:

```
[ ] Step 1 — Supabase project vitachain-prod created in eu-central-1
[ ] Step 2 — 5 Bitwarden entries created and verified
[ ] Step 3 — Email auth, URL config, JWT expiry all configured
[ ] Step 4 — db/.env filled; psql connects; file is git-ignored
[ ] Step 5 — make -C db push: 4 applied, re-run shows 4 skipped
[ ] Step 6 — make -C db verify: 13/13 ✓
[ ] Step 7 — make -C db smoke: 4/4 ✓
[ ] Step 8 — spring-status.yml: INF-02 → DONE, summary bumped, dated note added
[ ] Step 9 — Committed, pushed, hand-off message posted in team channel
```

---

## Quick troubleshooting reference

| You see this | What it means | Where to look |
|---|---|---|
| `psql: error: connection to server … failed: FATAL: password authentication failed` | Wrong DB password in `DB_URL` | Bitwarden → re-copy `VitaChain — Supabase DB password` |
| `psql: error: connection to server … : Connection refused` | Wrong `<ref>` in the host portion | URL bar of the Supabase project page |
| `push.sh` says "checksum mismatch" | Someone edited an applied migration | Revert the edit; add a new `00NN_*.sql` instead |
| Trigger doesn't fire on signup | `0003` didn't apply, or the function got dropped manually | `make -C db push`; check dashboard → Database → Functions |
| `verify.sh` says farmarket-photos missing | `0004` skipped because the bucket existed in a different state | Delete the bucket in the dashboard, re-run `make push` |
| Smoke test passes locally but fails in CI | CI has no `DB_URL` / `SUPABASE_*` env vars | INF-05 ticket — add GitHub Actions secrets |
| You accidentally committed `db/.env` | The file slipped past `.gitignore` | `git rm --cached db/.env && git commit`; **rotate every key in Bitwarden** before pushing |

---

## When NOT to follow this guide

Skip ahead to Step 4 (or call out a deviation in your PR) if:

- **You're restoring after a project deletion** — Steps 1–3 still apply but you also need to `pg_restore` from the most recent Backblaze dump after Step 5. See [docs/runbook.md](../runbook.md) → "Recovery sequence".
- **You're standing up a staging project** alongside production — use a different project name (`vitachain-staging`) and a separate set of Bitwarden entries (`VitaChain — Supabase staging URL`, etc). Never share keys between environments.
- **The free tier ran out** (500 MB DB, 50K MAU) — that's a different conversation. Don't silently upgrade the plan; raise it as a risk in the team channel first.
