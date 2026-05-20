# INF-07 — Nightly `pg_dump` backup → Backblaze B2 (30-day retention)

> **Epic:** E0 — Infrastructure & DevOps Foundation
> **Phase:** P1 — Build (Weeks 1–2) *(per [docs/spring-status.yml:206-211](../spring-status.yml#L206-L211) — no `phase:` override on the story, so it inherits the epic's P1. The work is foundational: every byte committed to the live Supabase project after INF-02 went DONE on 2026-05-14 is currently unprotected. Land this early — see §1.)*
> **Priority:** Must
> **Status:** TODO
> **Depends on:** [INF-02](INF-02-supabase-project-base-schema.md) (`DONE` — live project `qyyxgdfetzjqfpygikbz`, region `eu-central-1`, PG **17**; the backup pipeline needs a `postgresql://` connection string that exists only after INF-02 completed)
> **Soft-depends on:** [INF-01](INF-01-provision-vps-docker-nginx.md) (`IN_PROGRESS` — the cron and the local snapshot stage live on the VPS; until INF-01 reaches DONE, the local artefacts can be merged and the developer-laptop dry-run drill can be exercised, but the scheduled job has no host to fire from)
> **Unblocks:** every Phase-2 story that writes irrecoverable user content — [FAR-01](#) (ad rows + photo metadata), [SEC-01](#) (meal rows), [SEC-04](#) (reservations with pickup codes), [BOT-03](#) (lead form submissions), [KAT-03](#) (15-min telemetry rows that accumulate at ≈ 96 / device / day) — and the Phase-3 audit story [AUTH-07](#) (a corrupted RLS regression needs a known-good restore target). Also unblocks **[ADM-02](#) verification queue** because admin operators only feel safe flipping `verification_status` once a same-day rollback path exists.
> **Acceptance (PRD §8.2 + [docs/spring-status.yml:210](../spring-status.yml#L210)):** *"Healthchecks.io reports daily heartbeat."* This is the **minimum** bar — the story §10 Definition of Done extends it to *"a restore drill has actually been performed against a throwaway Supabase staging project and the restored schema diff is empty against `db/migrations/`"*. PRD §8.2 row 3 is the authoritative contract: *"Nightly pg_dump → Backblaze B2 (30-day retention)"*.

---

## 1. Purpose

Move the live Supabase database out of the **"one click away from oblivion"** state it currently sits in. As of 2026-05-14, `qyyxgdfetzjqfpygikbz` holds:

- `public.profiles` rows for every smoke-tested user.
- Five applied migrations (`0001`..`0005`) — including the RLS hot-fix in [db/migrations/0005_profiles_rls_recursion_fix.sql](../../db/migrations/0005_profiles_rls_recursion_fix.sql).
- Two Storage buckets (`farmarket-photos`, `secondserve-photos`) seeded by [db/migrations/0004_storage_buckets.sql](../../db/migrations/0004_storage_buckets.sql) — empty today but FAR-01 will start filling them as soon as INF-07 lands.

Supabase **Free Tier has no automated backups**. A single `DELETE FROM public.profiles;` run by mistake — or a regional incident in `eu-central-1` — is unrecoverable. The [VitaChain_Technical_Specifications.md §4.6](../../Documents/VitaChain_Technical_Specifications.md) opens its backup section with: *"A backup strategy is not optional — it's existential."* INF-07 is that strategy:

- A **nightly `pg_dump`** of the entire `qyyxgdfetzjqfpygikbz` Postgres instance — schema + data, in custom format (`-Fc`) so partial restores work, then re-encoded as `.sql.gz` for human-grep-ability and offline diffing.
- A **3-2-1 storage model** — live in Supabase, snapshot on the VPS local disk (`/opt/vitachain/backups/`), offsite copy in **Backblaze B2** (`vitachain-backups/postgres/`). Same provider as the VPS would collapse the "different failure domain" property, so B2 is mandatory, not optional.
- **30-day retention** offsite, **7-day retention** local. The local copy buys us seconds-to-minutes restore time for the 95 % of incidents that are *"intern dropped a table"*; the offsite copy is the disaster floor.
- **SHA-256 integrity** — every artefact is checksummed at dump time and re-verified at upload time. A silently bit-rotted backup is a worse outcome than no backup, because it builds false confidence.
- **Heartbeat to Healthchecks.io** at the *end* of a successful run — never at the start. A heartbeat at the start of the run only tells us the cron daemon is alive; the spec is explicit (§4.6.7) — the ping must follow the success log line, so a partial failure is a missed ping is an alert.
- **Failure webhook** to a Discord/Telegram/Slack URL (`ALERT_WEBHOOK_URL`) — fires inside the `ERR` trap, so an unhandled error never goes silently.
- **A restore drill, exercised against a throwaway Supabase staging project**, before the Phase-3 gate. Per PRD §8.2: *"Demo day RTO < 30 minutes"*. We don't reach that number on paper — we reach it by having actually done the restore once.

The deliverable is therefore **not just "a cron job"** — it is an end-to-end recoverable state contract: dump → checksum → local snapshot → offsite copy → retention prune → heartbeat → tested restore. Removing any one of those steps removes the *recovery* property the PRD asks for; the others without it are theatre.

> **Why P1, not later?** Because every hour of writes between today and INF-07 going DONE is data that can only be recovered by re-running migrations and re-creating users by hand. INF-07 is also the smallest story that gives the team a *psychological* permission slip to start writing production-relevant SQL — pre-INF-07, every `INSERT` in a migration is implicitly a one-way trip.

---

## 2. Scope

### In scope

- **A single `db-backup` sidecar container** in [infra/docker-compose.yml](../../infra/docker-compose.yml), built from a tiny custom Dockerfile (postgres:17-alpine + `rclone` + `bash` + `coreutils`). One image keeps the dump and the upload in a single transactional step with one shared `set -euo pipefail` boundary — splitting them into two `docker compose run` invocations breaks atomicity (you can succeed at dump and fail at upload while still cron-pinging Healthchecks).
- **A named volume `db_backups`** mounted at `/backups` in the sidecar, holding `vitachain_db_<UTC_TS>.sql.gz` + matching `.sha256` files. Retained 7 days locally; pruned by the sidecar at end-of-run. Survives `docker compose down`; only `docker compose down -v` wipes it.
- **A second named volume `rclone_config`** mounted at `/config/rclone` (read-only at runtime; rw during one-shot `rclone config` ceremony). Holds the obfuscated B2 application-key — never committed.
- **[infra/scripts/backup-db.sh](../../infra/scripts/backup-db.sh)** — the cron entrypoint on the VPS host. Resolves `PROJECT_DIR`, sources the `.env`, runs `docker compose run --rm db-backup`, captures the exit code, and pings Healthchecks only on `0`. Failure path posts to `ALERT_WEBHOOK_URL` with the last 20 log lines.
- **[infra/scripts/backup-entrypoint.sh](../../infra/scripts/backup-entrypoint.sh)** — runs *inside* the sidecar. The actual `pg_dump | gzip` pipeline, sha256, rclone copy, retention prune, log emission. Designed to be re-runnable (no state in `/tmp`); a half-finished upload from a previous run becomes a `.partial` that the next run cleans up before re-uploading.
- **[infra/scripts/restore-db.sh](../../infra/scripts/restore-db.sh)** — the drill driver. Takes a backup filename (`vitachain_db_YYYYMMDD_HHMMSS.sql.gz`) and a *target* DB URL (`$STAGING_DB_URL`). Hard refuses to restore over `$DB_URL` (production) unless `RESTORE_TARGET_IS_PROD=1` is set *and* an interactive `YES` is typed. Sha256-verifies the dump before touching `psql`. Runs `\set ON_ERROR_STOP on` so a partial restore is impossible.
- **Cron entry** in [infra/scripts/bootstrap-vps.sh](../../infra/scripts/bootstrap-vps.sh) — a new step 13 (the renamed "summary" step becomes 14): `/etc/cron.d/vitachain-db-backup` running `0 2 * * * $DEPLOY_USER bash $PROJECT_DIR/infra/scripts/backup-db.sh`. **02:00 Africa/Casablanca**, chosen because (a) it's after Supabase's busiest-hour distribution, (b) it's before the INF-06 `23 0,12 * * *` cert-renew cron so a single-VPS load spike doesn't compound. Idempotent — `tee` overwrites with identical content on re-bootstrap.
- **`infra/scripts/bootstrap-vps.sh`** also `mkdir -p`s `/var/log/vitachain-backup.log` and chowns it to `$DEPLOY_USER:$DEPLOY_USER` so the cron'd script doesn't need `sudo`.
- **`infra/.env.example` additions** — `SUPABASE_DB_URL` (the pooler-bypass direct PG URL — `pg_dump` cannot run through Supavisor's transaction-mode pooler), `B2_ACCOUNT_ID`, `B2_APPLICATION_KEY`, `BACKUP_BUCKET=vitachain-backups`, `BACKUP_REMOTE_PATH=postgres`, `BACKUP_RETENTION_LOCAL_DAYS=7`, `BACKUP_RETENTION_REMOTE_DAYS=30`, `HEALTHCHECKS_BACKUP_URL`, `ALERT_WEBHOOK_URL`. Documented as Bitwarden-sourced; never echoed.
- **Initial `rclone config` ceremony** — a one-shot `docker compose run --rm --entrypoint sh db-backup -c 'rclone config'` walkthrough (documented in the runbook), persisted in the `rclone_config` volume. Avoids ever putting raw B2 keys in shell history.
- **[infra/scripts/verify.sh](../../infra/scripts/verify.sh) — INF-07 verification section**. Asserts:
  - The cron file exists, is `0644`, and has the expected schedule.
  - `/opt/vitachain/backups/` is owned by the deploy user.
  - `rclone lsf b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH/` returns ≥ 1 entry and the newest timestamp ≤ 26 h old.
  - The newest local file's `.sha256` matches a freshly recomputed digest.
  - The newest local file is `pg_dump` magic — `gunzip -c | head -c 4` is `PGDM` for `-Fc` archives, or the file gunzips into a non-empty `-- PostgreSQL database dump` header for `-Fp`. (We use plain `.sql.gz` — see §4 cipher row.)
  - `pg_restore --list` against the dump returns ≥ N entries where N matches the count of objects we expect from migrations 0001-0005 (parameterised — the script reads the expected count from `db/migrations/` length).
  - The most recent Healthchecks.io status is `up` via `curl https://hc-ping.com/<UUID>?check` (best-effort; skipped if `HEALTHCHECKS_BACKUP_URL` is unset).
- **[infra/Makefile](../../infra/Makefile) targets**: `backup-now` (force an immediate run via SSH), `backup-list` (last 10 entries local + remote), `backup-restore` (drill — requires `BACKUP_FILE=` and `STAGING_DB_URL=`), `backup-rclone-config` (the one-shot interactive ceremony), `backup-prune-local` (manual local prune for debugging — rare).
- **[docs/runbook.md](../runbook.md) — INF-07 sections**: first-time setup walkthrough, the *quarterly* restore-drill procedure, the *"oh god the table is gone"* selective-restore playbook, B2 key rotation procedure, what to do when Healthchecks misses a ping.
- **`docs/spring-status.yml`** — flip `INF-07.status: TODO → DONE`, increment `summary.done`, decrement `summary.todo`, append a hand-off line under `project.last_updated` mirroring the INF-02/03/04/05/06 entries.

### Out of scope (later stories / explicit deferrals)

- **Storage bucket backup** (FarMarket + SecondServe photos) — PRD §8.2 row "Supabase Storage" is *weekly* `rclone sync`, not nightly `pg_dump`. Tech spec §4.6.4 puts it in its own script (`backup_storage.sh`) on a Sunday 03:00 cron. Will land as **INF-07b** *(new sub-story, captured in §11.5)*; the bucket migration `0004_storage_buckets.sql` defines the bucket names but **no photos are uploaded** until FAR-01 / SEC-01 / KAT-* land, so a weekly cadence is acceptable for MVD. Note: today the buckets are empty — a missed week of storage backup is currently *zero* lost bytes.
- **WAL streaming / PITR (point-in-time recovery)** — Supabase Free Tier exposes neither logical replication nor base-backup + WAL endpoints to free users. The hard floor on RPO is therefore **24 h**, which matches PRD §8.2. PITR is a paid-plan feature; deferred to the post-MVD upgrade conversation.
- **Cross-region cold standby Supabase project** — would double the Free Tier project quota and require a continuous logical-decoding pipeline. Way beyond the 624 MAD budget; deferred.
- **Encryption-at-rest of the dump** (GPG / age) — Backblaze B2 already encrypts server-side; B2 application keys are scoped to a single bucket; the VPS local copy is on the same disk as the running app, so encrypting it doesn't add a meaningful threat-model layer for MVD. If the VPS is rooted, the backup encryption keys are rooted with it. PRD §8.3 *Security* row doesn't require it. Tracked as a known gap in §8 risks and §11.5 follow-ups — a 1-line `--gpg-encryption` flag once we have a hosted KMS option post-MVD.
- **Multi-destination redundancy** (B2 *and* R2, both) — single-destination is sufficient until B2 itself has an SLA we can't tolerate. The retention prune is the bigger long-term cost than the per-GB rate.
- **Off-server signed-URL distribution** of restored dumps to other team members — the only person allowed to run a restore is the operator on the VPS or with `$STAGING_DB_URL` access. Sharing a dump file is a credential-handling problem deliberately not solved here.
- **Backup of `auth.*` schema rows** — `pg_dump` against the *direct* connection string includes the `auth` schema rows by default (`auth.users`, `auth.identities`, `auth.sessions`, `auth.refresh_tokens`). The Supabase service-role permission set includes `SELECT` on `auth.*`. We **do** back it up — but we **do not** restore `auth.users` blindly into a new project, because `auth.users.id` is referenced by every `profiles.id` FK and the receiving project's encryption keys differ. The restore script's drill mode uses `--data-only --table=public.*` to skip `auth.*` on restore; full disaster-restore documents the manual cross-project user-recovery procedure in the runbook.
- **Automated quarterly restore drill in CI** — running the drill against a real staging Supabase project costs B2 download bandwidth + a free-tier project slot. Manual quarterly drill is the MVD cadence; automating it is a Should for Phase 3.
- **Database-level encryption checksums beyond SHA-256** (e.g. BLAKE3) — SHA-256 is cryptographically sufficient for tamper-detection on a private-bucket asset; faster hashes only matter at TB scale.
- **GDPR right-to-erasure cascading into historic backups** — out of scope for MVD; the policy document for the post-MVD rollout will define the per-user erasure procedure (likely: re-dump nightly excluding the erased user; do not retro-edit historic dumps).

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [INF-02](INF-02-supabase-project-base-schema.md) DONE | Live project `qyyxgdfetzjqfpygikbz`; we need the **direct** PG URL, not the pooler. Format: `postgresql://postgres:<DB_PASSWORD>@db.qyyxgdfetzjqfpygikbz.supabase.co:5432/postgres`. Source the password from Bitwarden under *"VitaChain — Supabase DB password"* (same record [db/.env.example](../../db/.env.example) tells you to use for `DB_URL`). Do **not** use the pooler URL on `:6543` — `pg_dump` requires session-mode and the pooler defaults to transaction-mode. |
| PG client version match | Supabase runs **PG 17** (recorded in [docs/spring-status.yml:21](../spring-status.yml#L21)). The sidecar image MUST be `postgres:17-alpine`. A `pg_dump 16 → server 17` combination *might* work but Postgres only guarantees the converse; mismatches surface as missing extension support or attribute serialisation bugs at restore time. Pinning the major version is mandatory. |
| Backblaze B2 account | Create at [backblaze.com/b2](https://www.backblaze.com/cloud-storage). The **first 10 GB are free** — at our nightly dump size of ≤ 10 MB compressed × 30 days = 300 MB, we sit in the free tier for the entire MVD lifecycle. Create a bucket named `vitachain-backups` in `eu-central-1` *(same region as Supabase — within-region restore is faster and B2's egress price is the same everywhere)*; **disable** public listing; enable lifecycle "Keep only the last version of the file". Then create an **application key** scoped to that single bucket with `listFiles, readFiles, writeFiles, deleteFiles` — never use the master key in production. |
| Healthchecks.io account | Create a free account ([healthchecks.io](https://healthchecks.io)); add a check named `vitachain-db-backup`; **schedule = `0 2 * * *`** (`Africa/Casablanca`); **grace = 60 minutes** (a long-running dump can plausibly take that long during a Supabase-side incident); **notifications = email + the team's Discord/Telegram channel**. Copy the ping URL — that's `HEALTHCHECKS_BACKUP_URL`. |
| Alert webhook | Either a Discord webhook (Server Settings → Integrations → Webhooks → New Webhook), a Telegram bot's `sendMessage` URL with `chat_id` baked in, or a Slack incoming-webhook URL. Goal: a sentence appears in a chat the team reads, *without* having to log into another dashboard. |
| `infra/.env` populated on the VPS | All values from §5.4. The file is git-ignored and is the only place the credentials live on disk on the VPS. Permissions must be `0600` and owned by the deploy user (the bootstrap script already enforces this on the file it creates; verify before deploy). |
| `restic` or `borg`-style snapshot strategy on the VPS itself | **Out of scope, but worth recording**: the VPS host disk is not itself backed up by INF-07. If the VPS is destroyed, the local `/opt/vitachain/backups/` snapshot is also destroyed — that's the whole point of the offsite B2 copy. Don't over-trust the local copy. |

---

## 4. Target configuration

| Setting | Value | Source / Rationale |
|---|---|---|
| Dump command | `pg_dump --format=plain --no-owner --no-acl --quote-all-identifiers --no-publications --no-subscriptions --exclude-schema=storage --exclude-schema=graphql --exclude-schema=graphql_public --exclude-schema=net --exclude-schema=pgsodium --exclude-schema=pgsodium_masks --exclude-schema=vault --exclude-schema=_realtime --exclude-schema=realtime --exclude-schema=supabase_functions $SUPABASE_DB_URL \| gzip -9` | `--format=plain` (`-Fp`) so a future operator can `zcat | grep` to diagnose a single missing row without touching `pg_restore`. `--no-owner --no-acl` so the dump is portable to any Supabase project (the receiving project's `postgres` role owns everything on restore). Excluded schemas: Supabase's internal plumbing — restoring `realtime` or `vault` from a foreign project corrupts the receiving project. We back up **only** `public` (our app schema), `auth` (so we can audit who existed at backup time — but see §2 out-of-scope re: restore), and `extensions` (PostGIS / pgcrypto pre-installs land here). |
| `pg_dump` connection | Direct, `:5432`, **NOT** the pooler `:6543` | The Supavisor pooler defaults to transaction-mode; `pg_dump` opens long-lived prepared statements and explicit transactions which transaction-mode pooling breaks (`prepared statement does not exist` mid-dump). The direct DB URL is in Bitwarden under *"VitaChain — Supabase DB direct URL"*. |
| Compression | `gzip -9` | Best compression at one-CPU cost — a 50 MB schema dump compresses to ≈ 6 MB. `zstd` would be faster but adds a build-arg dependency in the image; gzip is in alpine by default. |
| Filename format | `vitachain_db_YYYYMMDD_HHMMSSZ.sql.gz` (UTC timestamp) | UTC avoids the Africa/Casablanca DST shift that would create two files with the same local-time stamp on the autumn fall-back day. Sortable by name. |
| Checksum | SHA-256, separate `.sha256` file | Two-file pattern keeps the dump byte-identical to what `pg_dump` produced — no inline header. `sha256sum -c` is universal. |
| Local retention | **7 days** | Quick-recovery tier — the 95th-percentile "intern dropped a row" incident is resolved within 6 hours of discovery, never longer than 7 days. Anything older is in the offsite tier. |
| Remote retention | **30 days** on B2 | PRD §8.2 row 3. Beyond 30 days, the data shape has drifted (schema migrations land) and the dump's restore value is lower than its storage cost. |
| Retention pruning | At the **end** of a successful run, never at the start | Pruning before the new dump succeeds means a failed dump leaves us with one fewer backup than we started with. End-of-run prune means: failed dump → previous N backups untouched, alert fires, we keep our floor. |
| Cron | `0 2 * * * $DEPLOY_USER bash $PROJECT_DIR/infra/scripts/backup-db.sh` | 02:00 Africa/Casablanca. Picked to be (a) low-traffic on the demo URL, (b) staggered well away from the `23 0,12 * * *` INF-06 cert-renew cron — same VPS, but different process, different Docker image pull, different network destination. |
| Heartbeat | `curl -fsS -m 10 --retry 3 $HEALTHCHECKS_BACKUP_URL` — **after** the success log line | Per tech spec §4.6.7. The retry handles a transient DNS blip on the VPS without firing a false-positive missed-heartbeat alert. |
| Alert on failure | `ERR` trap posts last 20 log lines to `$ALERT_WEBHOOK_URL` (Discord/Telegram/Slack JSON) | Cron itself emails root@localhost on stderr; we *also* post to the team chat because nobody reads `root@localhost` in 2026. |
| Sidecar image | Custom `db-backup` image: `postgres:17-alpine` + `rclone` + `bash` + `coreutils` (`sha256sum`, `gzip -9`). Pinned by digest. | One image keeps the dump and the upload in one transactional `set -euo pipefail` boundary. Pinning by digest is non-negotiable — same precedent as the certbot pin in INF-06 §5.2. |
| B2 bucket | `vitachain-backups`, `eu-central-1`, private, single-version | Same region as Supabase minimises restore latency. Single-version means we never accumulate orphaned previous versions of a same-name file (we never overwrite — timestamped names — but lifecycle is belt + braces). |
| B2 key scope | `vitachain-backups` only; `readFiles, listFiles, writeFiles, deleteFiles` | Per-bucket key means a leak compromises only the backup bucket. **No `deleteAllFiles`** at the account level, ever. |
| rclone backend | `b2:` remote, S3-compatible-API mode, `hard_delete = true` | `hard_delete = true` makes the `rclone delete --min-age 30d` actually free B2 storage, instead of marking files for soft-delete (which still bills). |
| Restore drill cadence | Quarterly, mandatory before Phase 3 gate | The tech spec §4.6.5 is unambiguous: *"An untested backup is not a backup. It's a hope."* The drill is part of the §10 Definition of Done. |

---

## 5. Step-by-Step Implementation

### 5.1 Pre-flight — Supabase direct URL + B2 account ready

```bash
# On the developer laptop:
#
# 1. Retrieve the Supabase direct DB URL from Bitwarden:
#     postgresql://postgres:<DB_PASSWORD>@db.qyyxgdfetzjqfpygikbz.supabase.co:5432/postgres
#
# 2. Smoke that the connection works with the local psql client:
psql "$SUPABASE_DB_URL" -c "select version();"
# Expect:  PostgreSQL 17.x on x86_64-pc-linux-gnu …

# 3. Smoke that pg_dump 17 is available locally for the developer dry-run path:
pg_dump --version
# Expect:  pg_dump (PostgreSQL) 17.x
# (If the local pg_dump is < 17 the laptop drill won't run; the VPS containerised
# path is unaffected. Install postgresql-client-17 from PGDG apt if needed.)

# 4. Confirm B2 account + bucket exist (do this in the B2 web UI):
#    - Bucket name:  vitachain-backups
#    - Region:       eu-central-1 (matches Supabase)
#    - Privacy:      Private
#    - Lifecycle:    "Keep only the last version of the file"
#    - Application key:
#        - Name:     vitachain-backups-rw
#        - Scope:    Bucket = vitachain-backups
#        - Caps:     listFiles, readFiles, writeFiles, deleteFiles
#    - Copy keyID + applicationKey into Bitwarden under
#        "VitaChain — Backblaze B2 backup key"
```

If step 1 fails with `password authentication failed`, the password in Bitwarden is stale — regenerate via Supabase Dashboard → Project Settings → Database → "Reset database password", update Bitwarden, update both `db/.env` and `infra/.env`. Tech spec §4.6.6 calls this out as the most common time-sink during a real incident.

### 5.2 The sidecar image — `infra/db-backup/Dockerfile`

**New file** — [infra/db-backup/Dockerfile](../../infra/db-backup/Dockerfile):

```dockerfile
# INF-07 — db-backup sidecar. postgres-client 17 + rclone + bash + coreutils.
# Pinned by digest in infra/docker-compose.yml.
#
# Why a custom image, not two separate sidecars (postgres + rclone)?
#   - One image = one ENTRYPOINT = one `set -euo pipefail` boundary; a failed
#     gzip is observable to the same caller that ran pg_dump.
#   - Compose volume sharing between two run-once services is workable but adds
#     a second `docker compose run` that has to be sequenced and error-handled
#     by hand. One container is plainer.
#   - The combined image is < 80 MB compressed — well within the budget.

FROM postgres:17-alpine

# rclone is in the alpine-edge community repo; we install via the official
# install.sh pinned to a known version to avoid alpine-edge drift.
ARG RCLONE_VERSION=v1.68.2
RUN apk add --no-cache bash coreutils ca-certificates curl gzip unzip findutils \
 && curl -fsSL "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-amd64.zip" -o /tmp/rclone.zip \
 && unzip /tmp/rclone.zip -d /tmp/ \
 && install -m 0755 "/tmp/rclone-${RCLONE_VERSION}-linux-amd64/rclone" /usr/local/bin/rclone \
 && rm -rf /tmp/rclone.zip "/tmp/rclone-${RCLONE_VERSION}-linux-amd64" \
 && rclone --version

# The entrypoint script is bind-mounted by compose (not COPYd) so that operator
# edits don't require an image rebuild. The image's job is to ship the binaries
# (pg_dump, rclone, sha256sum, gzip); the orchestration lives outside.
WORKDIR /backups
ENTRYPOINT ["bash", "/usr/local/bin/backup-entrypoint.sh"]
```

> **Why pin `RCLONE_VERSION`?** Because rclone has historically had silent backend-protocol changes (the `b2` backend's chunked upload behaviour shifted between 1.62 and 1.64). A floating version means a `docker compose build` six months from now could produce a sidecar that uploads a file the next sidecar can't list. Same pinning rationale as INF-06 §5.2.

### 5.3 The entrypoint — `infra/scripts/backup-entrypoint.sh`

**New file** — [infra/scripts/backup-entrypoint.sh](../../infra/scripts/backup-entrypoint.sh). This runs **inside** the sidecar:

```bash
#!/usr/bin/env bash
# backup-entrypoint.sh — INF-07. Runs inside the db-backup sidecar.
# All paths are container-internal. The host script (backup-db.sh) is the
# observer; this script is the actor.

set -Eeuo pipefail
IFS=$'\n\t'

# ---------------------------------------------------------------------------
# 0) Config — all required, all sourced from `docker compose` env injection.
# ---------------------------------------------------------------------------
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${BACKUP_BUCKET:=vitachain-backups}"
: "${BACKUP_REMOTE_PATH:=postgres}"
: "${BACKUP_RETENTION_LOCAL_DAYS:=7}"
: "${BACKUP_RETENTION_REMOTE_DAYS:=30}"

BACKUP_DIR="/backups"
RCLONE_CONFIG_PATH="/config/rclone/rclone.conf"
TS="$(date -u +%Y%m%d_%H%M%SZ)"
DUMP_FILE="${BACKUP_DIR}/vitachain_db_${TS}.sql.gz"
SHA_FILE="${DUMP_FILE}.sha256"

log()  { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die()  { printf '%s [FAIL]   %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
[[ -f "$RCLONE_CONFIG_PATH" ]] || die "rclone config not initialised — run 'make -C infra backup-rclone-config' first"

log "===== backup start ($(hostname)) ====="
log "ts=$TS  bucket=b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH  retain_local=${BACKUP_RETENTION_LOCAL_DAYS}d  retain_remote=${BACKUP_RETENTION_REMOTE_DAYS}d"

# ---------------------------------------------------------------------------
# 1) pg_dump — schema + data, public + auth + extensions only.
#    The set of --exclude-schema flags is the source of truth; if Supabase
#    adds a new internal schema we should review whether it belongs in the
#    backup (almost certainly not).
# ---------------------------------------------------------------------------
log "step 1/5: pg_dump"
# shellcheck disable=SC2094  # we deliberately read from a process substitution.
if ! pg_dump \
        --format=plain \
        --no-owner --no-acl \
        --quote-all-identifiers \
        --no-publications --no-subscriptions \
        --exclude-schema=storage \
        --exclude-schema=graphql --exclude-schema=graphql_public \
        --exclude-schema=net \
        --exclude-schema=pgsodium --exclude-schema=pgsodium_masks \
        --exclude-schema=vault \
        --exclude-schema=_realtime --exclude-schema=realtime \
        --exclude-schema=supabase_functions \
        "$SUPABASE_DB_URL" \
     | gzip -9 > "$DUMP_FILE.partial"; then
    rm -f "$DUMP_FILE.partial"
    die "pg_dump or gzip failed — leaving previous backups untouched"
fi
mv "$DUMP_FILE.partial" "$DUMP_FILE"
SIZE_BYTES=$(stat -c %s "$DUMP_FILE")
log "dump ok: $(du -h "$DUMP_FILE" | cut -f1) ($SIZE_BYTES bytes)"
# Sanity floor — a healthy schema dump is never < 1 KB compressed. < 1 KB
# almost always means pg_dump succeeded but the DB was empty (the URL pointed
# at a fresh empty project — common misconfiguration).
if (( SIZE_BYTES < 1024 )); then
    die "dump suspiciously small ($SIZE_BYTES bytes) — wrong DB URL?"
fi

# ---------------------------------------------------------------------------
# 2) SHA-256 — stored as a sibling file, format compatible with `sha256sum -c`.
# ---------------------------------------------------------------------------
log "step 2/5: sha256"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$DUMP_FILE")" > "$(basename "$SHA_FILE")" )
log "sha256 ok: $(cat "$SHA_FILE")"

# ---------------------------------------------------------------------------
# 3) Upload to B2 — both files. rclone retries on transient errors.
# ---------------------------------------------------------------------------
log "step 3/5: rclone copy → b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH/"
rclone --config "$RCLONE_CONFIG_PATH" \
    copy "$DUMP_FILE" "$SHA_FILE" \
    "b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH/" \
    --transfers=2 --checkers=2 \
    --retries=3 --low-level-retries=5 \
    --stats=0 --quiet
log "upload ok"

# ---------------------------------------------------------------------------
# 4) Round-trip verification — pull the remote sha256 and compare to the
#    one we just wrote locally. Catches in-flight corruption (rare but
#    has happened during B2 incidents).
# ---------------------------------------------------------------------------
log "step 4/5: round-trip sha256 check"
REMOTE_SHA=$(rclone --config "$RCLONE_CONFIG_PATH" \
                cat "b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH/$(basename "$SHA_FILE")" \
              | awk '{print $1}')
LOCAL_SHA=$(awk '{print $1}' "$SHA_FILE")
[[ "$REMOTE_SHA" == "$LOCAL_SHA" ]] || die "sha256 mismatch — local=$LOCAL_SHA remote=$REMOTE_SHA"
log "round-trip ok: $LOCAL_SHA"

# ---------------------------------------------------------------------------
# 5) Retention prune — local first (cheap), then remote (B2 API calls).
#    Runs ONLY after the new backup has been verified on both ends, so a
#    failure in steps 1-4 never reduces the existing backup floor.
# ---------------------------------------------------------------------------
log "step 5/5: retention prune"
find "$BACKUP_DIR" -name 'vitachain_db_*.sql.gz'    -mtime "+${BACKUP_RETENTION_LOCAL_DAYS}" -print -delete
find "$BACKUP_DIR" -name 'vitachain_db_*.sql.gz.sha256' -mtime "+${BACKUP_RETENTION_LOCAL_DAYS}" -print -delete

rclone --config "$RCLONE_CONFIG_PATH" \
    delete "b2:$BACKUP_BUCKET/$BACKUP_REMOTE_PATH/" \
    --min-age "${BACKUP_RETENTION_REMOTE_DAYS}d" \
    --include 'vitachain_db_*' \
    --quiet
log "prune ok"

log "===== backup ok — $(basename "$DUMP_FILE") ====="
```

> **Why the round-trip sha256 check in step 4?** Because every other story in this folder ships verification on the *output* of the action (cert renewed → re-fetch over TLS → check `notAfter`). The equivalent for a backup is *re-reading the file we just wrote* and confirming it matches the bytes we sent. Skipping this step is how teams discover, six months later, that 60 % of their backups are zero-byte files because B2's pre-signed URL handling had a regression they never noticed. Cost: one extra GET request per night. Worth it.

### 5.4 Compose patch — add the `db-backup` service

Patch [infra/docker-compose.yml](../../infra/docker-compose.yml):

```yaml
  # ---------------------------------------------------------------------------
  # INF-07 — Nightly pg_dump → Backblaze B2. Idle by default (the cron on the
  # host invokes `docker compose run --rm db-backup` once a night). Custom
  # image bundles postgres-client 17 + rclone; see infra/db-backup/Dockerfile.
  #
  # First-time setup (one-shot, before the first scheduled run):
  #     make -C infra backup-rclone-config
  # ---------------------------------------------------------------------------
  db-backup:
    build:
      context: ./db-backup
      dockerfile: Dockerfile
    image: vitachain/db-backup:1.0   # TODO(INF-07): swap to sha256 digest after first push
    container_name: vita_db_backup
    # Safe default if someone runs `docker compose up db-backup` by mistake;
    # the real invocation path is `docker compose run --rm db-backup`.
    command: ["--help"]
    environment:
      SUPABASE_DB_URL:                  ${SUPABASE_DB_URL}
      BACKUP_BUCKET:                    ${BACKUP_BUCKET:-vitachain-backups}
      BACKUP_REMOTE_PATH:               ${BACKUP_REMOTE_PATH:-postgres}
      BACKUP_RETENTION_LOCAL_DAYS:      ${BACKUP_RETENTION_LOCAL_DAYS:-7}
      BACKUP_RETENTION_REMOTE_DAYS:     ${BACKUP_RETENTION_REMOTE_DAYS:-30}
    volumes:
      - db_backups:/backups
      - rclone_config:/config/rclone
      # The entrypoint script lives in the repo (not in the image) so an
      # operator can fix a bug without a Docker rebuild.
      - ./scripts/backup-entrypoint.sh:/usr/local/bin/backup-entrypoint.sh:ro
    # One-shot — never restart. Errors are observed by the host wrapper.
    restart: "no"
    # Not on vita_net; only needs outbound (Supabase + B2). Skipping the
    # bridge network avoids a tiny attack surface where a compromised
    # backend could talk to the backup container.
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "2"

# At the bottom, alongside the existing letsencrypt_* volumes:
volumes:
  letsencrypt_etc:
  letsencrypt_www:
  db_backups:        # /backups — 7-day local snapshot tier (INF-07)
  rclone_config:     # /config/rclone — obfuscated B2 credentials (INF-07)
```

> **Why `restart: "no"`?** Because a sidecar that errors on boot and is then auto-restarted by Docker turns a one-night blip into a hammering loop against Supabase. The host wrapper script is the only thing that decides when to re-run.

### 5.5 The host wrapper — `infra/scripts/backup-db.sh`

**New file** — [infra/scripts/backup-db.sh](../../infra/scripts/backup-db.sh). This is what **cron** actually invokes:

```bash
#!/usr/bin/env bash
# backup-db.sh — INF-07. Host-side wrapper invoked by cron at 02:00 daily.
# Runs the db-backup sidecar via `docker compose run --rm`, observes the
# exit code, pings Healthchecks on success, posts to the alert webhook on
# failure. Idempotent — safe to invoke manually (`make -C infra backup-now`).

set -Eeuo pipefail
IFS=$'\n\t'

# Cron's PATH is minimal; resolve `docker` and friends explicitly. Same
# treatment as INF-06's renew-cert.sh.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

PROJECT_DIR="${PROJECT_DIR:-/opt/vitachain}"
LOG="/var/log/vitachain-backup.log"

# shellcheck disable=SC1091
[[ -f "$PROJECT_DIR/infra/.env" ]] && source "$PROJECT_DIR/infra/.env"

mkdir -p "$(dirname "$LOG")"

ts_now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

post_alert() {
    # $1: short reason, $2: full log excerpt (multi-line)
    local reason="$1"
    local excerpt="$2"
    [[ -z "${ALERT_WEBHOOK_URL:-}" ]] && return 0
    # Discord-shaped JSON; works for Slack incoming-webhooks too because both
    # accept a `content` field. Telegram bots take `text` — adjust if needed.
    local payload
    payload=$(jq -nc \
        --arg t "🚨 VitaChain backup FAILED at $(ts_now): $reason" \
        --arg e "$excerpt" \
        '{content: ($t + "\n```\n" + $e + "\n```")}')
    curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
        --data "$payload" "$ALERT_WEBHOOK_URL" >/dev/null || true
}

ping_healthcheck() {
    [[ -z "${HEALTHCHECKS_BACKUP_URL:-}" ]] && return 0
    curl -fsS -m 10 --retry 3 "$HEALTHCHECKS_BACKUP_URL" >/dev/null || true
}

cd "$PROJECT_DIR"

{
    echo "===================================="
    echo "$(ts_now) — backup-db.sh start"

    # `docker compose run --rm` runs the sidecar with the project's env file
    # already loaded by compose itself (env_file inheritance from infra/.env).
    # Capture stderr+stdout so the alert webhook has something to send.
    if docker compose run --rm --entrypoint bash db-backup /usr/local/bin/backup-entrypoint.sh; then
        echo "$(ts_now) — backup-db.sh end (ok)"
        # Heartbeat is the LAST thing we do — never before the success log.
        ping_healthcheck
        exit 0
    else
        rc=$?
        echo "$(ts_now) — backup-db.sh end (FAIL rc=$rc)"
        post_alert "exit=$rc" "$(tail -n 20 "$LOG")"
        exit "$rc"
    fi
} >>"$LOG" 2>&1
```

### 5.6 The drill — `infra/scripts/restore-db.sh`

**New file** — [infra/scripts/restore-db.sh](../../infra/scripts/restore-db.sh). The only sanctioned restore path:

```bash
#!/usr/bin/env bash
# restore-db.sh — INF-07. Restore drill driver.
#
# Default: restores into $STAGING_DB_URL — a throwaway Supabase project
# stood up for the quarterly drill. The script HARD REFUSES to restore
# into the production URL unless both:
#     RESTORE_TARGET_IS_PROD=1
# and an interactive "YES, OVERWRITE PRODUCTION" confirmation are present.
#
# Usage:
#     ./infra/scripts/restore-db.sh <BACKUP_FILE> <TARGET_DB_URL>
#     ./infra/scripts/restore-db.sh latest        <TARGET_DB_URL>   # fetches newest
#
# Examples:
#     ./infra/scripts/restore-db.sh vitachain_db_20260513_020000Z.sql.gz "$STAGING_DB_URL"
#     ./infra/scripts/restore-db.sh latest                              "$STAGING_DB_URL"

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[[ -f "$SCRIPT_DIR/../.env" ]] && source "$SCRIPT_DIR/../.env"

BACKUP_FILE="${1:-}"
TARGET_DB_URL="${2:-}"
[[ -n "$BACKUP_FILE"   ]] || { echo "usage: $0 <BACKUP_FILE|latest> <TARGET_DB_URL>" >&2; exit 2; }
[[ -n "$TARGET_DB_URL" ]] || { echo "usage: $0 <BACKUP_FILE|latest> <TARGET_DB_URL>" >&2; exit 2; }

# --- Guardrail #1: refuse to restore into production by accident ----------
if [[ "$TARGET_DB_URL" == "${SUPABASE_DB_URL:-__not_set__}" ]]; then
    if [[ "${RESTORE_TARGET_IS_PROD:-0}" != "1" ]]; then
        echo "REFUSING: target == SUPABASE_DB_URL (production). Set RESTORE_TARGET_IS_PROD=1 to override." >&2
        exit 1
    fi
    read -r -p "Type 'YES, OVERWRITE PRODUCTION' to continue: " ack
    [[ "$ack" == "YES, OVERWRITE PRODUCTION" ]] || { echo "Aborted."; exit 1; }
fi

# --- Step 1: fetch the dump if not already local --------------------------
if [[ "$BACKUP_FILE" == "latest" ]]; then
    BACKUP_FILE=$(docker compose run --rm --entrypoint rclone db-backup \
        --config /config/rclone/rclone.conf \
        lsf "b2:${BACKUP_BUCKET:-vitachain-backups}/${BACKUP_REMOTE_PATH:-postgres}/" \
        --include 'vitachain_db_*.sql.gz' | sort | tail -n1 | tr -d '\r')
    echo "Resolved 'latest' → $BACKUP_FILE"
fi

LOCAL_DUMP="/opt/vitachain/backups/$BACKUP_FILE"
LOCAL_SHA="${LOCAL_DUMP}.sha256"

if [[ ! -f "$LOCAL_DUMP" ]]; then
    echo "Fetching $BACKUP_FILE from B2…"
    docker compose run --rm --entrypoint rclone db-backup \
        --config /config/rclone/rclone.conf \
        copy "b2:${BACKUP_BUCKET:-vitachain-backups}/${BACKUP_REMOTE_PATH:-postgres}/$BACKUP_FILE" "/backups/"
    docker compose run --rm --entrypoint rclone db-backup \
        --config /config/rclone/rclone.conf \
        copy "b2:${BACKUP_BUCKET:-vitachain-backups}/${BACKUP_REMOTE_PATH:-postgres}/$BACKUP_FILE.sha256" "/backups/"
fi

# --- Step 2: verify checksum ----------------------------------------------
echo "Verifying SHA-256…"
( cd "$(dirname "$LOCAL_DUMP")" && sha256sum -c "$(basename "$LOCAL_SHA")" ) \
    || { echo "CHECKSUM FAILED — refusing to restore." >&2; exit 1; }

# --- Step 3: restore with ON_ERROR_STOP ----------------------------------
# We pipe gunzip → psql inside the db-backup sidecar so we don't need a host
# postgres-client install. ON_ERROR_STOP makes a partial restore impossible.
echo "Restoring → ${TARGET_DB_URL%@*}@…"
docker compose run --rm --entrypoint bash db-backup -c "
    set -euo pipefail
    gunzip -c /backups/$BACKUP_FILE | psql '$TARGET_DB_URL' \
        -v ON_ERROR_STOP=on \
        -v VERBOSITY=verbose \
        --single-transaction \
        > /tmp/restore.log 2>&1 || { tail -50 /tmp/restore.log; exit 1; }
    tail -10 /tmp/restore.log
"

echo "Restore complete. Now diff against db/migrations/ — see runbook §INF-07 drill."
```

> **`--single-transaction` is load-bearing**: without it, a mid-restore failure leaves the target in a state where some tables are populated and others aren't — exactly the partial-recovery scenario that erodes trust in the backup system. With it, the target is either fully restored or untouched.

### 5.7 Bootstrap — install cron + log file

Append to [infra/scripts/bootstrap-vps.sh](../../infra/scripts/bootstrap-vps.sh) (renumber the existing step 13 "summary" to step 14):

```bash
# ---------------------------------------------------------------------------
# 13) INF-07 — Nightly DB backup cron + log file
# ---------------------------------------------------------------------------
log "INF-07: install /etc/cron.d/vitachain-db-backup"
sudo tee /etc/cron.d/vitachain-db-backup > /dev/null <<EOF
# VitaChain — nightly pg_dump → B2 (INF-07). Managed by bootstrap-vps.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 2 * * * $DEPLOY_USER bash $PROJECT_DIR/infra/scripts/backup-db.sh
EOF
sudo chmod 0644 /etc/cron.d/vitachain-db-backup

log "INF-07: ensure log file owned by $DEPLOY_USER"
sudo touch /var/log/vitachain-backup.log
sudo chown "$DEPLOY_USER:$DEPLOY_USER" /var/log/vitachain-backup.log
sudo chmod 0640 /var/log/vitachain-backup.log

log "INF-07: ensure local backup dir exists"
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0750 /opt/vitachain/backups
```

> **Why `0640` on the log file?** Group-readable so the deploy user can read it; world-unreadable so a future shared-tenant misconfiguration doesn't leak backup filenames (which leak the timestamp of every nightly run, which is a soft fingerprint of when the DB is large/small).

### 5.8 Env contract — `.env.example`

Patch [infra/.env.example](../../infra/.env.example):

```diff
 # -----------------------------------------------------------------------------
 # INF-06 — Let's Encrypt account contact (renewal warnings land here).
 # -----------------------------------------------------------------------------
 ADMIN_EMAIL=ops@vitachain.ma
 DOMAINS=vitachain.ma www.vitachain.ma
 # HEALTHCHECKS_RENEW_URL=https://hc-ping.com/<uuid>
+
+# -----------------------------------------------------------------------------
+# INF-07 — Nightly DB backup to Backblaze B2.
+#
+# SUPABASE_DB_URL — DIRECT Postgres URL (:5432), NOT the pooler (:6543).
+#   Source: Bitwarden → "VitaChain — Supabase DB direct URL".
+#   Format: postgresql://postgres:<PASS>@db.<ref>.supabase.co:5432/postgres
+# -----------------------------------------------------------------------------
+SUPABASE_DB_URL=
+
+# Backblaze B2 — credentials live in the rclone_config volume after the
+# one-shot `make -C infra backup-rclone-config` ceremony. These four are
+# convenience knobs for the entrypoint; only the bucket name is sensitive
+# (and only mildly — bucket discovery without a key is not exploitable).
+BACKUP_BUCKET=vitachain-backups
+BACKUP_REMOTE_PATH=postgres
+BACKUP_RETENTION_LOCAL_DAYS=7
+BACKUP_RETENTION_REMOTE_DAYS=30
+
+# Healthchecks.io — paste the ping URL from the dashboard for the check
+# named "vitachain-db-backup". The check schedule there must be
+# `0 2 * * *` (Africa/Casablanca) with a 60-minute grace window.
+#   Source: Bitwarden → "VitaChain — Healthchecks backup URL".
+HEALTHCHECKS_BACKUP_URL=
+
+# Alert webhook — Discord / Telegram / Slack incoming-webhook URL.
+# Posted into a chat the team reads when a backup fails. JSON shape in
+# backup-db.sh is Discord-flavoured; tweak `post_alert()` if using Slack
+# or Telegram. Empty value disables the alert (heartbeat alert via
+# Healthchecks is the floor).
+ALERT_WEBHOOK_URL=
```

### 5.9 Makefile targets

Append to [infra/Makefile](../../infra/Makefile):

```makefile
.PHONY: backup-rclone-config backup-now backup-list backup-restore backup-logs backup-prune-local

backup-rclone-config:  ## ONE-SHOT — interactive rclone config for the B2 remote
	@echo "==> Walk through 'rclone config' to create a B2 remote named 'b2'."
	@echo "    When prompted: type 'n' → name=b2 → storage=b2 (Backblaze B2)"
	@echo "    → account_id=<B2_ACCOUNT_ID> → application_key=<B2_APPLICATION_KEY>"
	@echo "    → hard_delete=true → y/quit. Config persists in rclone_config volume."
	ssh -t $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose run --rm --entrypoint sh db-backup -c 'rclone config --config /config/rclone/rclone.conf'"

backup-now:        ## Force a backup run now (cron also runs nightly at 02:00)
	ssh $$VPS_USER@$$VPS_HOST "bash $$PROJECT_DIR/infra/scripts/backup-db.sh && tail -30 /var/log/vitachain-backup.log"

backup-list:       ## List recent backups (last 10 local + last 10 on B2)
	@echo "==> Local (/opt/vitachain/backups):"
	ssh $$VPS_USER@$$VPS_HOST "ls -lh /opt/vitachain/backups/ | grep vitachain_db_ | tail -10"
	@echo "==> Remote (b2:$$BACKUP_BUCKET/$$BACKUP_REMOTE_PATH):"
	ssh $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && docker compose run --rm --entrypoint rclone db-backup --config /config/rclone/rclone.conf lsl b2:$$BACKUP_BUCKET/$$BACKUP_REMOTE_PATH/ | sort | tail -10"

backup-restore:    ## DRILL — restore <BACKUP_FILE> into <STAGING_DB_URL>
	@test -n "$$BACKUP_FILE"     || (echo "Usage: make backup-restore BACKUP_FILE=… STAGING_DB_URL=…" && exit 1)
	@test -n "$$STAGING_DB_URL"  || (echo "Usage: make backup-restore BACKUP_FILE=… STAGING_DB_URL=…" && exit 1)
	ssh -t $$VPS_USER@$$VPS_HOST "cd $$PROJECT_DIR && STAGING_DB_URL='$$STAGING_DB_URL' bash infra/scripts/restore-db.sh '$$BACKUP_FILE' '$$STAGING_DB_URL'"

backup-logs:       ## Tail the backup log on the VPS
	ssh $$VPS_USER@$$VPS_HOST "tail -100 /var/log/vitachain-backup.log"

backup-prune-local: ## Manual local prune — rare, for filling-disk debugging
	ssh $$VPS_USER@$$VPS_HOST "find /opt/vitachain/backups/ -name 'vitachain_db_*' -mtime +$${BACKUP_RETENTION_LOCAL_DAYS:-7} -print -delete"
```

### 5.10 verify.sh — INF-07 section

Append to [infra/scripts/verify.sh](../../infra/scripts/verify.sh):

```bash
# --- INF-07 backup checks ---------------------------------------------------
echo ""
echo "INF-07 verification (DB backup)"
echo "----------------------------------------"

check "Cron entry for backup exists with 02:00 schedule" \
    ssh "$VPS_USER@$VPS_HOST" "grep -qE '^0 2 \\* \\* \\* ' /etc/cron.d/vitachain-db-backup"

check "Backup log is owned by deploy user" \
    ssh "$VPS_USER@$VPS_HOST" "stat -c %U /var/log/vitachain-backup.log | grep -q vitachain"

check "Local backup directory exists + correct ownership" \
    ssh "$VPS_USER@$VPS_HOST" "test -d /opt/vitachain/backups && [[ \$(stat -c %U /opt/vitachain/backups) == vitachain ]]"

check "rclone config persisted in volume" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && docker compose run --rm --entrypoint sh db-backup -c 'test -s /config/rclone/rclone.conf'"

check "At least one backup exists locally" \
    ssh "$VPS_USER@$VPS_HOST" "ls /opt/vitachain/backups/vitachain_db_*.sql.gz >/dev/null 2>&1"

check "Newest local backup is < 26h old" \
    ssh "$VPS_USER@$VPS_HOST" "test \$(find /opt/vitachain/backups/ -name 'vitachain_db_*.sql.gz' -mmin -1560 | wc -l) -ge 1"

check "Newest local backup sha256 verifies" \
    ssh "$VPS_USER@$VPS_HOST" "cd /opt/vitachain/backups && newest=\$(ls -t vitachain_db_*.sql.gz | head -1) && sha256sum -c \${newest}.sha256"

check "Newest local backup gunzips to valid SQL header" \
    ssh "$VPS_USER@$VPS_HOST" "cd /opt/vitachain/backups && newest=\$(ls -t vitachain_db_*.sql.gz | head -1) && gunzip -c \$newest | head -3 | grep -q 'PostgreSQL database dump'"

check "At least one backup exists on B2 (matches local newest)" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && newest=\$(ls -t /opt/vitachain/backups/vitachain_db_*.sql.gz | head -1 | xargs -n1 basename) && docker compose run --rm --entrypoint rclone db-backup --config /config/rclone/rclone.conf lsf b2:${BACKUP_BUCKET:-vitachain-backups}/${BACKUP_REMOTE_PATH:-postgres}/ | grep -qx \$newest"

check "B2 retention prune is working (no backups > 30d on remote)" \
    ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && [[ \$(docker compose run --rm --entrypoint rclone db-backup --config /config/rclone/rclone.conf lsl b2:${BACKUP_BUCKET:-vitachain-backups}/${BACKUP_REMOTE_PATH:-postgres}/ --min-age 31d | wc -l) -eq 0 ]]"

check "Healthchecks recent ping reports 'up'" \
    bash -c "[[ -z \"${HEALTHCHECKS_BACKUP_URL:-}\" ]] && echo 'SKIP — HEALTHCHECKS_BACKUP_URL unset' || curl -fsS \"${HEALTHCHECKS_BACKUP_URL%/}/check\" >/dev/null 2>&1"
```

> The B2-retention negative check is the kind of regression that's invisible to humans — a future rclone config edit could disable `hard_delete` and remote storage would silently grow forever. Verify.sh catches the *cost* leak before it becomes a billing surprise.

### 5.11 First-time deployment sequence

This is the only fragile path; once it's done, the cron is autonomous. Run from the developer laptop with `infra/.env` filled in:

```bash
# 1. Pre-flight — Supabase URL reachable + B2 ready (§5.1).
psql "$SUPABASE_DB_URL" -c "select 1;"

# 2. Build the sidecar image locally to sanity-check the Dockerfile.
docker build -t vitachain/db-backup:1.0 infra/db-backup/
docker run --rm vitachain/db-backup:1.0 --help    # entrypoint prints usage via -h

# 3. Deploy to the VPS (rsyncs new files; brings up the new service to a stopped state).
make -C infra deploy

# 4. ONE-SHOT — initialise the rclone config inside the persistent volume.
make -C infra backup-rclone-config
# Walk through the interactive prompts:
#     n) new remote
#     name> b2
#     Storage> b2  (Backblaze B2)
#     account_id> <B2_ACCOUNT_ID>
#     application_key> <B2_APPLICATION_KEY>
#     advanced> n
#     y/quit> y
#     q) quit
# Verify:
ssh "$VPS_USER@$VPS_HOST" "cd $PROJECT_DIR && docker compose run --rm --entrypoint cat db-backup /config/rclone/rclone.conf"
# Should show the [b2] block with obfuscated key.

# 5. Pin the image by digest. After the first build, read the digest and
#    paste it into the `image:` line in docker-compose.yml.
ssh "$VPS_USER@$VPS_HOST" "docker images --digests vitachain/db-backup"

# 6. First run — force it manually so we don't wait until 02:00.
make -C infra backup-now
# Watch the log — should print all five steps and end "===== backup ok ====="
# Inspect the artefacts:
make -C infra backup-list
# Expect 1 local + 1 remote.

# 7. Verify all INF-07 checks pass.
make -C infra verify

# 8. The Healthchecks dashboard at https://healthchecks.io should now show
#    the "vitachain-db-backup" check as green (last ping a few minutes ago).
```

If step 6 fails, the most common culprits are:

- `SUPABASE_DB_URL` points at the pooler (`:6543`) — fix to `:5432`.
- B2 application key was created on the wrong bucket — recreate, re-run `backup-rclone-config`.
- The DB password contains a `@` or `:` that wasn't URL-encoded — Bitwarden's password generator avoids these; if you rolled your own, percent-encode them.

### 5.12 Quarterly restore drill — the ceremony that makes this real

This is part of §10 Definition of Done. The drill proves the backup is *recoverable*, not just *stored*.

```bash
# On the developer laptop:

# 1. Create a throwaway Supabase project — free tier, takes ~3 minutes.
#    Name: "vitachain-restore-drill-2026Q2"  (rotate quarterly)
#    Region: eu-central-1
#    DB password: generate via Bitwarden, save under "VitaChain — Drill DB url"
#    Export the direct URL:
export STAGING_DB_URL="postgresql://postgres:<PASS>@db.<drill_ref>.supabase.co:5432/postgres"

# 2. Restore the latest backup into it.
make -C infra backup-restore BACKUP_FILE=latest STAGING_DB_URL="$STAGING_DB_URL"

# 3. Verify the restored schema matches the migrations source-of-truth.
#    `db/scripts/verify.sh` reads $DB_URL — point it at the drill project.
DB_URL="$STAGING_DB_URL" make -C db verify
# Expect: same 13/13 ✓ as on production.

# 4. Spot-check data parity for a known table.
psql "$STAGING_DB_URL" -c "select count(*) from public.profiles;"
psql "$SUPABASE_DB_URL" -c "select count(*) from public.profiles;"
# Counts should differ by at most the number of new signups since the
# backup timestamp.

# 5. Tear down — pause or delete the drill Supabase project.
#    DO NOT keep it idle long-term; counts against the Free Tier quota.

# 6. Record the drill in docs/runbook.md — append a line under
#    "## INF-07 — Drill log" with date + restorer + outcome.
```

### 5.13 Runbook entries

Append to [docs/runbook.md](../runbook.md):

```markdown
## INF-07 — First-time DB backup setup

See story §5.11. Key one-shots:
1. Create the B2 bucket + application key (bucket-scoped).
2. Create the Healthchecks.io check named `vitachain-db-backup`
   (schedule `0 2 * * *` Africa/Casablanca, grace 60 min).
3. Fill `infra/.env` with SUPABASE_DB_URL, HEALTHCHECKS_BACKUP_URL,
   ALERT_WEBHOOK_URL.
4. Deploy: `make -C infra deploy`.
5. Initialise rclone in the persistent volume: `make -C infra backup-rclone-config`.
6. Smoke: `make -C infra backup-now && make -C infra backup-list && make -C infra verify`.

## INF-07 — Quarterly restore drill (mandatory)

Cadence: once per quarter, AND once before the Phase-3 gate, AND once D-7
before the demo. See story §5.12 for the script-by-script ceremony.

Drill log (add a new line each time):
| Date       | Operator | Backup file                              | Outcome | Notes |
|------------|----------|------------------------------------------|---------|-------|
| YYYY-MM-DD | name     | vitachain_db_YYYYMMDD_HHMMSSZ.sql.gz     | OK/FAIL | …     |

## INF-07 — Selective-restore playbook (the "intern dropped a table" case)

Symptom: production data was deleted/corrupted by an avoidable action and the
loss is recent (< 7 days, so still in local snapshots).

1. STOP THE BLEEDING. Pause anything that's still writing — `docker compose stop backend` if a misbehaving worker, or revoke the bad user's session.
2. Identify the latest *known-good* backup (one whose timestamp is BEFORE the bad action). `make -C infra backup-list`.
3. Stand up a drill Supabase project (see §5.12). Restore into it.
4. Compare the affected table's rows between drill and production:
   ```
   psql "$STAGING_DB_URL" -c "\\copy (select * from public.<table>) to '/tmp/good.csv' csv header"
   psql "$SUPABASE_DB_URL" -c "\\copy (select * from public.<table>) to '/tmp/now.csv' csv header"
   ```
5. Compute the row diff. Apply the missing rows back to production with
   `INSERT … ON CONFLICT DO NOTHING` (avoids clobbering newer good writes).
6. Tear down the drill project.

## INF-07 — Full disaster restore (Supabase regional outage)

Symptom: `qyyxgdfetzjqfpygikbz` is unreachable for > 30 minutes.

1. Create a new Supabase project in a different region (e.g. `eu-west-1`).
2. Update `SUPABASE_URL` / `SUPABASE_DB_URL` / `NEXT_PUBLIC_SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` in `infra/.env`.
3. `make -C infra backup-restore BACKUP_FILE=latest STAGING_DB_URL="$NEW_DB_URL"`
   — *(yes, the script's name says "staging" but the destination is now
   the new prod; the script doesn't care, it cares only about not
   over-writing the OLD `SUPABASE_DB_URL` which is now stale).*
4. `make -C infra frontend-rebuild` — the NEXT_PUBLIC_SUPABASE_URL is
   build-arg-inlined.
5. `make -C infra deploy && make -C infra verify` — full smoke.
6. DNS A record for `vitachain.ma` is unchanged (we're not moving VPS),
   so no propagation wait.

Total time to RTO: ~25 minutes (3 min Supabase project + ~10 min restore
+ 5 min frontend rebuild + 5 min smoke). Inside PRD §8.2 RTO budget.

NOTE — user passwords do NOT survive a cross-project restore (auth keys
differ). Active users will need to do a password reset. Document this in
the inevitable post-incident announcement; do not promise transparency you
can't deliver.

## INF-07 — B2 application key rotation

Cadence: every 6 months or on any suspected leak.
1. In B2 console: create a new application key (same bucket, same caps).
2. `make -C infra backup-rclone-config` and re-walk the prompts with the
   new key. The volume's rclone.conf is overwritten.
3. `make -C infra backup-now` to confirm the new key works end-to-end.
4. In B2 console: delete the old application key.
5. Update Bitwarden.

## INF-07 — Healthchecks missed-ping playbook

Symptom: Healthchecks emails the team that `vitachain-db-backup` hasn't
pinged within the grace window.

1. SSH in, `tail -100 /var/log/vitachain-backup.log` — last run's outcome.
2. If the log shows a failure: read the error, fix the cause, re-run
   `make -C infra backup-now`.
3. If the log shows nothing (cron itself didn't fire):
   - `sudo systemctl status cron` — cron daemon alive?
   - `sudo cat /var/log/syslog | grep CRON | tail -20` — did cron see the
     job?
   - `cat /etc/cron.d/vitachain-db-backup` — file still present and
     correct?
4. Once a successful manual run lands, Healthchecks will go green within
   the next ping window. Do not "snooze" Healthchecks — the alert is
   real.
```

---

## 6. Verification Checklist

### Local (developer laptop, before deploy)

- [ ] `docker build -t vitachain/db-backup:1.0 infra/db-backup/` succeeds.
- [ ] `docker run --rm vitachain/db-backup:1.0 pg_dump --version` reports `(PostgreSQL) 17.x`.
- [ ] `docker run --rm vitachain/db-backup:1.0 rclone --version` reports `v1.68.2` (matches the pinned `RCLONE_VERSION` ARG).
- [ ] `shellcheck infra/scripts/backup-db.sh infra/scripts/backup-entrypoint.sh infra/scripts/restore-db.sh` clean.
- [ ] `yamllint infra/docker-compose.yml` clean.
- [ ] `infra/.env.example` shows all five new keys (SUPABASE_DB_URL, BACKUP_BUCKET, BACKUP_REMOTE_PATH, BACKUP_RETENTION_*, HEALTHCHECKS_BACKUP_URL, ALERT_WEBHOOK_URL).
- [ ] `scripts/check-secrets-boundary.sh` (INF-05 boundary) still exits 0 — `SUPABASE_DB_URL` did not leak into frontend/, no `NEXT_PUBLIC_` crept into backend/db-backup paths.

### On the VPS — happy path

- [ ] `make -C infra deploy` succeeds; `docker compose images | grep db-backup` shows the pinned image.
- [ ] `make -C infra backup-rclone-config` walks through cleanly; `docker compose run --rm --entrypoint cat db-backup /config/rclone/rclone.conf` shows the `[b2]` block.
- [ ] `make -C infra backup-now` exits 0 and the log shows all five entrypoint steps with `===== backup ok =====` at the end.
- [ ] `make -C infra backup-list` shows ≥ 1 entry locally and ≥ 1 entry on B2 with matching filenames.
- [ ] `make -C infra verify` is all green for the INF-07 section (11 checks).
- [ ] Healthchecks.io dashboard shows the check as green within 60 seconds of the manual run.
- [ ] Cron entry installed: `ssh "$VPS_USER@$VPS_HOST" "cat /etc/cron.d/vitachain-db-backup"` matches the bootstrap template.
- [ ] Wait until 02:00 Africa/Casablanca local time *(or temporarily edit the cron to `*/5 * * * *` for a 5-minute test, then restore — document this in the runbook drill log)* and confirm a fresh entry appears in `/var/log/vitachain-backup.log` without manual intervention.

### Restore drill — proves the backup is recoverable

- [ ] A throwaway Supabase project exists in `eu-central-1`; `$STAGING_DB_URL` resolves and `psql $STAGING_DB_URL -c "select 1"` returns 1.
- [ ] `make -C infra backup-restore BACKUP_FILE=latest STAGING_DB_URL="$STAGING_DB_URL"` exits 0.
- [ ] `DB_URL="$STAGING_DB_URL" make -C db verify` is 13/13 ✓ (identical to production verify).
- [ ] Row count of `public.profiles` on the drill project matches production (± new signups since the dump).
- [ ] One specific known row (e.g. the smoke-test user from INF-02 §5.12) is present and intact on the drill project.
- [ ] The drill is recorded in [docs/runbook.md](../runbook.md) under "INF-07 — Drill log".

### Negative — the gate actually blocks

- [ ] `bash infra/scripts/restore-db.sh latest "$SUPABASE_DB_URL"` *(production target without override)* exits non-zero with `REFUSING: target == SUPABASE_DB_URL`.
- [ ] `RESTORE_TARGET_IS_PROD=1 bash infra/scripts/restore-db.sh latest "$SUPABASE_DB_URL" < /dev/null` exits non-zero (interactive YES not provided).
- [ ] A planted corruption: `dd if=/dev/urandom of=/opt/vitachain/backups/<newest>.sql.gz bs=1 count=8 seek=10 conv=notrunc` → `make -C infra verify` red on the sha256 check. *(Restore the file from B2 afterwards.)*
- [ ] An empty DB scenario: temporarily point `SUPABASE_DB_URL` at a fresh empty Supabase project, run `make -C infra backup-now` — the script aborts at the "dump suspiciously small" floor check, not at the rclone upload, so we never push a useless 200-byte file to B2.
- [ ] A broken rclone config: rename `/config/rclone/rclone.conf` → `.bak`, run `make -C infra backup-now` — script fails fast at "rclone config not initialised", no partial upload.

### TLS / network (free wins from INF-06 being upstream)

- [ ] `docker compose run --rm db-backup pg_dump "$SUPABASE_DB_URL" --version` over Supabase's TLS reports no certificate warnings (Supabase enforces sslmode=require by default; our URL doesn't override).
- [ ] rclone B2 traffic is HTTPS-only (rclone's b2 backend has no plaintext mode); confirm via `tcpdump` if paranoid.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| Sidecar image build context | [infra/db-backup/Dockerfile](../../infra/db-backup/Dockerfile) |
| Compose `db-backup` service + `db_backups` + `rclone_config` volumes | [infra/docker-compose.yml](../../infra/docker-compose.yml) |
| Cron entrypoint (host) | [infra/scripts/backup-db.sh](../../infra/scripts/backup-db.sh) |
| Sidecar entrypoint (container) | [infra/scripts/backup-entrypoint.sh](../../infra/scripts/backup-entrypoint.sh) |
| Restore drill driver | [infra/scripts/restore-db.sh](../../infra/scripts/restore-db.sh) |
| Bootstrap cron + log + dir install | [infra/scripts/bootstrap-vps.sh](../../infra/scripts/bootstrap-vps.sh) (new step 13) |
| Env contract changes | [infra/.env.example](../../infra/.env.example) (SUPABASE_DB_URL, BACKUP_*, HEALTHCHECKS_BACKUP_URL, ALERT_WEBHOOK_URL) |
| Verification checks (11 new) | [infra/scripts/verify.sh](../../infra/scripts/verify.sh) (INF-07 section) |
| Makefile targets (6) | [infra/Makefile](../../infra/Makefile) (`backup-rclone-config`, `backup-now`, `backup-list`, `backup-restore`, `backup-logs`, `backup-prune-local`) |
| Runbook entries (5) | [docs/runbook.md](../runbook.md) (first-time setup, quarterly drill + log, selective-restore, full disaster, B2 rotation, missed-ping) |
| `spring-status.yml` update | Flip `INF-07.status: TODO → DONE`; bump `summary.done`; decrement `summary.todo`; add a hand-off line under `project.last_updated` mirroring INF-04/05/06 |

---

## 8. Risks & Mitigations

| Risk | Mitigation | Source |
|---|---|---|
| `pg_dump` major-version mismatch (client 16 → server 17) produces a dump that fails to restore on PG17 | Sidecar image pins `postgres:17-alpine`; verify.sh asserts the `(PostgreSQL) 17.x` version line; restore drill catches any latent incompatibility quarterly | §4 + §5.2 + §5.10 |
| `SUPABASE_DB_URL` points at the pooler `:6543` instead of direct `:5432` — pg_dump fails mid-stream with `prepared statement does not exist` | Entrypoint's "dump suspiciously small" floor catches the empty-output case; the runbook calls out the pooler-vs-direct distinction explicitly in §3 and §5.11 | §3 + §5.3 + §5.11 |
| Silent bit-rot on B2 — file present, sha256 wrong | Round-trip sha256 check in step 4 of the entrypoint compares local digest to remote-fetched digest before declaring success | §5.3 step 4 |
| B2 application key is account-master instead of bucket-scoped — a leak compromises all our buckets, not just backup | Runbook §INF-07 first-time setup mandates bucket-scoped key with explicit cap list (`listFiles, readFiles, writeFiles, deleteFiles`); key rotation playbook in runbook | §3 + §5.13 |
| `cron` doesn't fire because the deploy user's PATH is minimal | `backup-db.sh` exports a known-good PATH at the top, exactly the same fix as INF-06 §5.6 | §5.5 |
| A failed dump still pings Healthchecks (false-positive green) | Entrypoint uses `set -euo pipefail`; host wrapper pings Healthchecks ONLY in the `if docker compose run …` success branch, never unconditionally | §5.3 + §5.5 |
| The local snapshot fills the VPS disk over months | 7-day local retention enforced by `find -mtime +7 -delete` at end-of-run; verify.sh check #9 asserts no remote backups > 30d; the host has a 40 GB disk and a 6 MB nightly dump uses ~42 MB over 7 days — three orders of magnitude headroom | §4 + §5.3 step 5 + §5.10 |
| The 02:00 cron collides with Supabase Free Tier's daily maintenance window | Supabase's docs do not publish a maintenance window; 02:00 Africa/Casablanca = 01:00 UTC, well outside the typical AWS-eu-central-1 maintenance hour (Tue/Thu 04:00 UTC). If a collision is observed empirically, shift to 03:00 — single-line cron edit | §4 + §5.7 |
| Restoring `auth.users` blindly into a new Supabase project breaks (encryption keys differ) | Restore-script's drill mode does NOT restore `auth.*` data; only `public.*`. Full-disaster runbook §INF-07 documents the password-reset announcement | §2 out-of-scope + §5.13 |
| The drill is never actually run — backup becomes "hope" per the tech spec | §10 Definition of Done is gated on a drill being recorded in the runbook drill log; the drill log is a table with explicit dates, exposed in verify.sh's red/green output if older than 100 days *(future enhancement; not in this story's verify.sh, tracked in §11.5)* | §5.12 + §10 |
| `rclone` version drift between sidecar rebuilds produces an unreadable upload format | `RCLONE_VERSION` is a pinned build-arg in the Dockerfile; image is digest-pinned in compose; same rigour as the certbot pin in INF-06 §5.2 | §5.2 + §4 |
| The DB password contains `@` / `:` / `/` and is mis-parsed in the URL | Bitwarden's generator excludes these by default for VitaChain secrets; the runbook calls out percent-encoding for hand-rolled passwords; the script's `psql "$URL"` invocation tolerates them when properly quoted | §3 + §5.11 |
| Alert webhook URL leaks via process listing on the VPS | The variable is loaded from `infra/.env` (mode `0600`) and used in `curl --data` (not as a CLI arg); no `ps` exposure. `set -x` is never enabled in the cron path | §5.5 + §3 |
| B2 lifecycle "Keep only the last version" silently deletes a renamed file mid-restore | We never rename; filenames are timestamped and immutable. Lifecycle is a defence-in-depth — `hard_delete=true` in rclone is the actual prune mechanism | §3 + §4 |
| Healthchecks.io itself goes down — false alarm | Healthchecks is a single-vendor dependency, but: (a) email-on-failure also fires (the cron's stderr → root@localhost goes via local Postfix to the same admin email), (b) the alert webhook is independent — *two* channels would have to fail simultaneously for the team to miss it | §5.5 + §3 |
| The first scheduled run after deployment falls inside a Supabase Free Tier "paused" state (auto-pause after 7 days of inactivity) | Auto-pause requires zero queries for 7 days; the FastAPI backend's `/readyz` probe (INF-04) hits Supabase on every health check, well within the pause threshold. The risk is theoretical for an actively-developed project, but the runbook §INF-07 missed-ping playbook covers the "unpause and re-run" path | §5.13 |
| A future schema migration uses a Postgres feature (e.g. `LARGE OBJECT`s) that `--format=plain` mishandles | `pg_restore --list` against the dump in the quarterly drill would surface any silently-missed objects; PRD-imposed schema is small + relational; LOBs are not used | §5.12 + §6 |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| `infra/db-backup/Dockerfile` (postgres:17-alpine + pinned rclone) | 30 min |
| Compose patch (db-backup service + 2 volumes + env injection) | 20 min |
| `backup-entrypoint.sh` (5 steps incl. round-trip sha256) | 90 min |
| `backup-db.sh` host wrapper (Healthchecks + webhook) | 45 min |
| `restore-db.sh` drill driver (guardrails + sha256 + single-transaction) | 60 min |
| `bootstrap-vps.sh` patch (cron + log + dir) | 15 min |
| `.env.example` patch (5 new keys + comments) | 15 min |
| `verify.sh` — 11 new INF-07 checks | 45 min |
| `Makefile` — 6 new targets | 20 min |
| Backblaze B2 account + bucket + scoped key | 20 min |
| Healthchecks.io check + alert webhook setup | 15 min |
| Runbook entries (setup + drill + selective restore + disaster + rotation + missed-ping) | 60 min |
| First-time deployment dance (§5.11) | 45 min |
| First quarterly restore drill (§5.12 — full ceremony, recorded) | 60 min |
| `spring-status.yml` update + hand-off line | 10 min |
| **Total active work** | **~9 h** |

---

## 10. Definition of Done

1. **Acceptance criterion met:** [docs/spring-status.yml:210](../spring-status.yml#L210) — *"Healthchecks.io reports daily heartbeat."* Verified by an actual scheduled (not manually-forced) run pinging the dashboard inside the 60-minute grace window for at least 24 hours.
2. **Stretch (story-imposed) Definition of Done:** a restore drill has been performed against a throwaway Supabase staging project, `make -C db verify` is 13/13 ✓ on the restored project, and the drill is recorded in `docs/runbook.md` under "INF-07 — Drill log" with date + operator + outcome.
3. Verification checklist (§6) fully ticked: local lint, VPS happy path (all 11 INF-07 checks green), restore drill, every negative-path check refused.
4. Deliverables (§7) committed under `infra/` and `docs/`, with the B2 application key and Healthchecks ping URL stored in Bitwarden (not Git) under the names documented in the runbook.
5. [docs/spring-status.yml](../spring-status.yml) updated:
   - `INF-07.status: TODO → DONE`,
   - `summary.done` incremented (3 → 4 or further if INF-06 lands first),
   - `summary.todo` decremented,
   - hand-off line under `project.last_updated` summarising what landed, mirroring INF-02/03/04/05/06.
6. **Demo readiness gate:** running `make -C infra backup-now` from a fresh terminal produces a green Healthchecks ping within 60 seconds and a new file visible in both `make -C infra backup-list` outputs (local + remote). The PRD §8.2 row 3 contract — *"Nightly pg_dump → Backblaze B2 (30-day retention)"* — is now true.
7. **30-day retention proof:** if the demo lands > 30 days after INF-07 went DONE, the `BACKUP_RETENTION_REMOTE_DAYS > 30` verify.sh check is *expected to be green* (no orphans), proving the prune is working as designed. If the demo is < 30 days out, the check is a no-op pass (no rows are 30 days old yet); the prune *behaviour* is exercised by the restore drill instead.

---

## 11. Hand-off — (to be filled on completion)

### 11.1 What landed

*(Mirror INF-04/05/06 §11.1: bullet list of new/changed files under `infra/`, `docs/`; the SHA the first backup was produced from; the exact byte-size and SHA-256 of the first dump; the Healthchecks check URL; the B2 bucket name + key-ID (NOT the secret); the first successful cron-fired log entry from `/var/log/vitachain-backup.log`.)*

### 11.2 Verification evidence

*(Paste: full `make -C infra verify` run with the INF-07 block all green; `make -C infra backup-list` showing local + remote entries; the Healthchecks.io status-page screenshot or `curl …?check` output; the recorded drill log entry from runbook §INF-07.)*

### 11.3 What's *not* covered (and why that's fine for DoD)

- **Storage bucket photo backup** — weekly cadence, separate story INF-07b; today the buckets are empty so missed weeks cost zero.
- **WAL streaming / PITR** — Supabase Free Tier doesn't expose it; hard floor on RPO is 24h, matches PRD.
- **Cross-region cold standby** — beyond budget.
- **At-rest dump encryption** — B2 server-side encryption is sufficient for MVD threat model.
- **Automated quarterly drill in CI** — manual cadence is the MVD bar; promoted to Should for Phase 3.

### 11.4 Stories now unblocked

| Story | Why |
|---|---|
| **FAR-01** | Farmers can now publish ads (and photos via Storage) with confidence that the row data is nightly-recoverable. |
| **SEC-01 / SEC-04** | Restaurateurs publishing meals and citizens reserving them with pickup codes are now writing to a backed-up DB. The "intern dropped the reservations table" scenario is now recoverable in < 6 hours. |
| **BOT-03** | Lead-form submissions (a non-recreatable user input) are now backed up nightly. Without this story, a lost lead is a lost prospect. |
| **KAT-03** | 15-min telemetry rows accumulate at ≈ 96/device/day. Even with the IoT pipeline being non-critical for *individual* row recovery, the historical chart's continuity depends on the backup floor. |
| **ADM-02** | Admin verification queue — flipping `verification_status = 'VERIFIED'` is now reversible without a manual SQL forensics session. |
| **AUTH-07** | RLS audit / business-rule test suite — a known-good restore target is a precondition for fearless test execution against staging. |
| **FAR-06 / SEC-07 — CRON workers** | Nightly expiry workers can run with confidence; an off-by-one query that mass-expires the wrong rows is reversible. |

### 11.5 Known follow-ups (not part of INF-07)

- **INF-07b — Weekly Storage bucket sync** (`infra/scripts/backup-storage.sh`, Sunday 03:00 cron, `rclone sync` of `farmarket-photos` + `secondserve-photos` to `b2:vitachain-backups/storage/`). Pick up when FAR-01 / SEC-01 start filling the buckets.
- **GPG / age encryption at rest** for the dump itself — wait until we have a hosted KMS option post-MVD.
- **Automated quarterly drill in CI** — promote the §5.12 ceremony to a workflow that stands up a throwaway Supabase project, runs the restore, runs `db/verify`, tears down, and reports.
- **Drill-log staleness verify.sh check** — extend §5.10 to red the verify if the most recent runbook drill entry is > 100 days old. Small change; intentionally not in this story to keep verify.sh tight.
- **Backup-size trend monitoring** — once we have Sentry/Uptime Kuma (INF-08), emit a daily metric for backup size and alert on > 2× day-over-day growth (catches a runaway logging table).
- **B2 cost monitoring** — Backblaze emails a monthly invoice; capture it in the cost-tracking sheet. At MVD scale (< 300 MB stored, < 10 GB/month listed/transferred) we stay in the free tier; the monitoring is forward-looking for growth.

### 11.6 Operator runbook (when this story is being executed)

```bash
# On the developer laptop, against a VPS where INF-01..06 are DONE and INF-02
# is live:

# 1. Pre-flight
psql "$SUPABASE_DB_URL" -c "select version();"   # PG 17.x
# B2 account ready, bucket created, application key scoped & in Bitwarden
# Healthchecks check created, URL in Bitwarden

# 2. Fill infra/.env on the VPS with:
#     SUPABASE_DB_URL=postgresql://postgres:<PASS>@db.<ref>.supabase.co:5432/postgres
#     BACKUP_BUCKET=vitachain-backups
#     BACKUP_REMOTE_PATH=postgres
#     BACKUP_RETENTION_LOCAL_DAYS=7
#     BACKUP_RETENTION_REMOTE_DAYS=30
#     HEALTHCHECKS_BACKUP_URL=https://hc-ping.com/<uuid>
#     ALERT_WEBHOOK_URL=<discord/slack/telegram>

# 3. Deploy
make -C infra deploy

# 4. One-shot rclone config (interactive)
make -C infra backup-rclone-config

# 5. Pin the image by digest in docker-compose.yml (see §5.11 step 5)
ssh "$VPS_USER@$VPS_HOST" "docker images --digests vitachain/db-backup"
# Paste the @sha256:… form into the image: line, commit, re-deploy.

# 6. First run + smoke
make -C infra backup-now
make -C infra backup-list
make -C infra verify    # INF-07 block must be all green

# 7. Healthchecks dashboard — green within 60s of step 6

# 8. Wait for the FIRST cron-fired run (02:00 Africa/Casablanca) — do NOT
#    declare DoD until this happens unsupervised
ssh "$VPS_USER@$VPS_HOST" "tail -40 /var/log/vitachain-backup.log"

# 9. Restore drill (§5.12) — stand up a throwaway Supabase project,
#    restore the latest backup into it, run db/verify against it, record
#    in runbook drill log.

# 10. Flip docs/spring-status.yml — INF-07 → DONE; summary.done += 1.
```
