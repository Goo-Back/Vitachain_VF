# VitaChain — Operations Runbook

Living document. Each entry links to the story that introduced the procedure.

---

## VPS bootstrap (INF-01)

> Origin: [stories/INF-01-provision-vps-docker-nginx.md](stories/INF-01-provision-vps-docker-nginx.md)
> Artifacts: [infra/](../infra/)

**When to run:** initial provisioning of a new VPS, or restoring from snapshot onto a fresh host (PRD §13 R1, < 30 min RTO).

### Recovery sequence

1. Provision a new Ubuntu 24.04 VPS at the same provider; paste `id_ed25519.pub` during creation.
2. Add the new IP to `infra/.env` as `VPS_HOST` (still IP-form, not DNS).
3. `make -C infra bootstrap` — installs Docker, hardens SSH, sets up UFW.
4. `make -C infra deploy` — rsyncs the compose stack and brings NGINX up.
5. `make -C infra verify` — confirms all 8 acceptance checks pass.
6. Repoint DNS A records (`@`, `www`, `api`, `status`) at the new IP. TTL is 300 s.
7. Switch `infra/.env` `VPS_HOST` back to `vitachain.ma` once propagation settles.

### Emergency contacts

| Role | Where |
|---|---|
| Provider console | Bitwarden → `VitaChain — VPS provider` |
| Registrar | Bitwarden → `VitaChain — registrar` |
| Team channel | (set during INF-08) |

### Daily ops

```bash
make -C infra preflight   # workstation sanity (run before bootstrap/deploy)
make -C infra ps          # container status on the VPS
make -C infra logs        # tail nginx logs on the VPS
make -C infra verify      # full health check (8 INF-01 + 7 INF-03 checks)
make -C infra nginx-test  # local syntax check on nginx/conf.d/* (no VPS)
```

### Rollback a bad deploy

The compose stack is stateless at the NGINX layer (configs are git-tracked, the
HTML placeholder is regenerated from `infra/nginx/html/`). Frontend and backend
images are tagged `:latest` — to roll back a regression:

```bash
# 1) Revert the offending commit locally
git revert <SHA>          # or: git reset --hard <last-good-SHA>

# 2) Redeploy — rsync overwrites, compose rebuilds
make -C infra deploy

# 3) Confirm
make -C infra verify
```

If a deploy left NGINX broken, `deploy.sh` already runs `nginx -t` in a
throwaway container **before** swapping configs, so the live vhost stays
unchanged on syntax errors. If a runtime failure slips through:

```bash
ssh vitachain@vitachain.ma 'cd /opt/vitachain && \
    docker compose logs --tail=200 nginx && \
    docker compose restart nginx'
```

For a full host failure, follow **Recovery sequence** above (snapshot →
fresh VPS → bootstrap → DNS swing). RTO target: < 30 min (PRD §8.2).

### Snapshot policy

VPS provider snapshots are the disaster-recovery floor; Supabase + Backblaze
B2 (INF-07) own the data side. Configure at the provider control panel:

| Item | Cadence | Retention | Owner |
|---|---|---|---|
| Full VPS snapshot | Weekly (Sunday 03:00 UTC) | 4 snapshots | Provider scheduler |
| Manual pre-demo snapshot | On D-1 of every demo | Hold until D+1 | Operator |
| Postgres `pg_dump` | Nightly | 30 days | INF-07 → Backblaze B2 |

Record the snapshot ID in Bitwarden (`VitaChain — VPS provider` note) before
any destructive operation (compose `down -v`, package mass-upgrade, etc.).

### Adding a new NGINX vhost (cheat-sheet for INF-03/04/06/08 follow-ups)

1. Drop the new config in `infra/nginx/conf.d/<name>.conf`. Reuse the
   existing `proxy_set_header` trio + `X-Request-Id` line from
   [default.conf](../infra/nginx/conf.d/default.conf).
2. `make -C infra nginx-test` locally — catches syntax errors before push.
3. `make -C infra deploy` — `deploy.sh` re-validates `nginx -t` in a
   throwaway container on the VPS, then `up -d` only if the test passed.
4. Add a `check ...` line to [verify.sh](../infra/scripts/verify.sh) so the
   new route shows up in the per-deploy health tally.

### Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `deploy.sh` halts at "nginx -t" | Bad directive in `conf.d/*.conf` | Run `make -C infra nginx-test` locally to see the line; fix and redeploy. The live vhost is unchanged. |
| `verify.sh` fails on `vita_nginx is Up (healthy)` | NGINX container restart loop | `ssh vitachain@... 'cd /opt/vitachain && docker compose logs --tail=100 nginx'`; usually a typo in a `proxy_pass` upstream that doesn't resolve. |
| `verify.sh` fails on the DNS check | A-record not yet propagated, or VPS_HOST still an IP | `dig +short vitachain.ma` — if empty, wait; if you're still on IP-form `VPS_HOST`, the check is skipped automatically. |
| `bootstrap-vps.sh` re-run wipes UFW custom rules | (Fixed) UFW is now idempotent — only adds missing rules. | If you saw this on an older run, re-add the rule with `ufw allow <port>/tcp`. |
| `curl http://vitachain.ma` → 502 | Upstream container (frontend or backend) is down | `make -C infra ps`; if a service is `Exit`, check `docker compose logs <service>`. NGINX serves `/50x.html` from `infra/nginx/html/` in the meantime. |
| SSH locked out after bootstrap | Hardening applied before the deploy user had a key (script guards against this, but a manual edit could re-introduce it) | Recover via the provider's web console; restore `/etc/ssh/sshd_config` from the `.bak.YYYYMMDD` file the bootstrap left behind. |

---

## Backend rollout & rollback (INF-04)

> Origin: [stories/INF-04-fastapi-backend-scaffold-healthcheck.md](stories/INF-04-fastapi-backend-scaffold-healthcheck.md)
> Artifacts: [backend/](../backend/), service `backend` in [infra/docker-compose.yml](../infra/docker-compose.yml), `/api/v1/` location in [infra/nginx/conf.d/default.conf](../infra/nginx/conf.d/default.conf).

**When to run:** every backend change after the initial provisioning.

### Daily ops

```bash
cd backend
make install                  # one-off — creates .venv (Git-Bash / WSL)
make lock                     # regenerate requirements.lock.txt from .in
make test                     # pytest (8 tests, ~0.1 s)
make dev                      # uvicorn --reload on :8000
make docker-build             # build vitachain/backend:dev
make docker-run               # run locally on :8000 with backend/.env
make smoke                    # curl all four health endpoints
```

### Deploy

The backend is rsynced and rebuilt as part of the standard
`make -C infra deploy`. The deploy script's pre-flight `nginx -t` will catch
broken vhost edits before any swap. Post-deploy, `make -C infra verify`
runs the 8 INF-04 checks against the live host.

### Local end-to-end smoke (no VPS)

The infra compose file uses sibling paths (`./backend`, `./frontend`) that
match the VPS layout after `deploy.sh` rsyncs. To bring it up locally from
the repo root:

```bash
# Backend-only stack on port 8088 (avoids Windows port-80 conflicts):
docker compose -f infra/docker-compose.yml -f infra/compose.smoke.yml \
    --env-file infra/.env \
    --project-directory . -p vita_smoke up -d --build backend nginx

curl http://localhost:8088/api/v1/healthz       # → {"status":"ok",...}
curl http://localhost:8088/api/v1/readyz        # → {"status":"ready"|"degraded",...}
curl http://localhost:8088/api/v1/katara/healthz  # per-module liveness

docker compose -f infra/docker-compose.yml -f infra/compose.smoke.yml \
    -p vita_smoke down
```

[infra/compose.smoke.yml](../infra/compose.smoke.yml) overrides only the host
port and drops the frontend dep so you don't need real Supabase build args
locally. It is NEVER referenced from the VPS deploy.

### Rotate Supabase keys

```bash
# 1) Generate / rotate at Supabase (Settings → API → Reset).
# 2) Update Bitwarden entries: `VitaChain — Supabase service_role key`,
#    `VitaChain — Supabase JWT secret`.
# 3) Update infra/.env on the workstation with the new values.
# 4) Redeploy (env is read at container start; no rebuild needed):
make -C infra deploy
make -C infra verify
# Or, surgically:
make -C infra backend-rebuild
```

### Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Container exits with `pydantic ValidationError: supabase_url Input should be a valid URL, input is empty` | `SUPABASE_URL` missing from the env passed to compose | Check `infra/.env`; ensure `make deploy` was run with the latest secrets from Bitwarden. |
| `pydantic_settings.exceptions.SettingsError: error parsing value for field "cors_allow_origins"` | Future regression of the JSON-decode bug | `Settings.cors_allow_origins` must keep its `Annotated[..., NoDecode]` shape — see [tests/test_health.py](../backend/tests/test_health.py) `test_cors_origins_parses_csv_env`. |
| `/api/v1/readyz` returns 503 with `supabase_*: error:ConnectError` | Network/DNS issue between VPS and Supabase, or wrong `SUPABASE_URL` | `docker exec vita_backend curl -fsS $SUPABASE_URL/rest/v1/`; check DNS + outbound firewall. |
| `/api/v1/readyz` returns 503 with `supabase_*: http_401` | Bad `SUPABASE_SERVICE_ROLE_KEY` | Reload key from Bitwarden; redeploy. |
| `curl /api/v1/healthz` returns 502 from NGINX | Backend container down or restart-looping | `make -C infra backend-logs`; usually a config validation error in `app/core/config.py`. |
| AUTH-05 grep fails in verify.sh | A docstring or comment in `backend/` contains the literal `NEXT_PUBLIC_` | Reword to break the literal match (e.g. backticks + concatenation). |

---

## Supabase bootstrap & recovery (INF-02)

> Origin: [stories/INF-02-supabase-project-base-schema.md](stories/INF-02-supabase-project-base-schema.md)
> Artifacts: [db/](../db/), [supabase/config.toml](../supabase/config.toml)

**When to run:** initial provisioning of the Supabase project, or restoring schema onto a freshly-recreated project (PRD §13 R1).

### First-time provisioning

1. Sign in at app.supabase.com with the shared team Google account. **New project** → name `vitachain-prod`, region `eu-central-1`.
2. Save the DB password to Bitwarden (`VitaChain — Supabase DB password`).
3. Copy from **Settings → API** into Bitwarden: URL, `anon` key, `service_role` key, JWT secret.
4. **Authentication → Providers → Email:** enable, confirmations OFF, secure email change ON. **URL Configuration:** Site URL `http://vitachain.ma` + the two callback URLs.
5. Copy keys into `db/.env` (template in `db/.env.example`).
6. `make -C db push` — applies every migration in numeric order, bookkept in `public._migrations`.
7. `make -C db verify` — runs 13 automated checks against schema, RLS, triggers, buckets.
8. `make -C db smoke` — positive + negative signup against the live REST API.

### Recovery sequence (project destroyed / region migration)

1. Create the replacement project (same region if possible).
2. Update Bitwarden entries with the new keys; refresh `db/.env`.
3. `make -C db push` — every migration is idempotent and replays cleanly on an empty database.
4. Restore data: `pg_restore` the most recent dump from Backblaze B2 (INF-07 owns the dump tooling).
5. `make -C db verify` then `make -C db smoke` — same exit-zero gate as initial provisioning.
6. Rotate the `anon` and `service_role` keys exposed during the incident; redeploy frontend + FastAPI with the new keys.

### Daily ops

```bash
make -C db list      # which migrations have been applied
make -C db psql      # interactive psql against the project
make -C db verify    # 30-second schema/RLS sanity sweep
```

### Adding a new migration

1. Pick the next free number: `ls db/migrations | tail -1` → +1.
2. Create `db/migrations/00NN_<short_name>.sql`. Make it idempotent. Enable RLS on every new table in the same file.
3. `make -C db push` locally first (against a staging project if you have one).
4. Commit. CI in INF-05 will replay against a disposable Postgres in PRs.
5. Never edit `00NN_*.sql` after it has been applied. `push.sh` enforces this with a checksum guard.

### Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `make push` says "checksum mismatch" | Someone edited a migration after it was applied | Revert the edit; add a new migration with the change instead. |
| Smoke test: signup 200 but no profile row | Trigger `on_auth_user_created` missing or failing | Re-run `make push`; check Supabase logs for `handle_new_user` exceptions. |
| Smoke test: profile row exists but wrong role | Frontend not sending `data.role` in signup payload | Fix the AUTH-02 client code; the trigger defaults to `CITIZEN` when omitted. |
| `verify`: RLS off on `public.profiles` | Migration 0002 not applied, or someone toggled it in the dashboard | `make -C db push`; never toggle RLS in the UI — change it in a migration. |

---

## CI pipeline (INF-05)

> Origin: [stories/INF-05-ci-pipeline-github-actions-pre-commit.md](stories/INF-05-ci-pipeline-github-actions-pre-commit.md)
> Artifacts: [.github/workflows/ci.yml](../.github/workflows/ci.yml), [.pre-commit-config.yaml](../.pre-commit-config.yaml), [scripts/check-secrets-boundary.sh](../scripts/check-secrets-boundary.sh), top-level [Makefile](../Makefile)

**When to run:** every push to a feature branch; every PR to `main`. The
workflow is gated behind a single aggregate check — `ci-required` — so
branch protection never needs to be re-clicked when the matrix changes.

### Branch protection — one-time setup (repo admin)

GitHub → Settings → Branches → Add rule for `main`:

- [x] Require a pull request before merging
- [x] Require status checks to pass before merging
  - [x] Require branches to be up to date before merging
  - [x] Required status checks: **`ci-required`** ← the only one to tick;
    it aggregates `frontend`, `backend`, `db`, `infra`, `secret-leak`.
- [x] Require linear history
- [x] Do not allow bypassing the above settings (admins included)

After enabling, push a one-line README change on a branch and confirm the
PR shows `ci-required` as a required check that must turn green before merge.

### Daily ops

```bash
make hooks-install   # one-time per laptop
make hooks-run       # run every pre-commit hook against the whole tree
make ci-local        # run the same checks CI runs (secrets + backend + frontend + infra)
make secrets-check   # the AUTH-05 boundary in isolation
```

### Reading a red PR

| CI job red | Run locally to reproduce | Common cause |
|---|---|---|
| `frontend` | `cd frontend && npm run lint && npm run typecheck && npm run build` | new `any` snuck in, missing `NEXT_PUBLIC_*` placeholder in CI env, eslint v9 flat-config drift. |
| `backend` | `make -C backend lint test` | ruff `F401` (unused import), `T20` (stray `print()`), ruff-format diff, pytest fixture name mismatch. |
| `db` | `pg_ctl` / Docker postgres locally + `DB_URL=... make -C db push verify` | non-idempotent migration; ALTER on a missing column; RLS policy referencing a column dropped later. |
| `infra` | `make -C infra nginx-test`, `shellcheck infra/scripts/*.sh` | trailing whitespace in YAML, `proxy_pass` upstream typo, `hadolint` DL3008 on a new apt-install. |
| `secret-leak` | `make secrets-check` | a real leak; or a doc reference that needs `.gitleaks.toml` allowlisting. |

### Bumping pinned hooks / actions

Every `uses:` in `ci.yml` is pinned to a 40-char SHA; every `rev:` in
`.pre-commit-config.yaml` is a fixed tag. Bump cadence: monthly, by hand.

```bash
make hooks-update          # bumps every `rev:` in .pre-commit-config.yaml
# Review the diff. If green, commit. If hook X exploded, revert just rev X.
```

Action SHAs are bumped by editing `ci.yml` directly — copy the new SHA from
`https://github.com/<owner>/<repo>/releases` and update the trailing
`# v<tag>` comment. Never use `@vN` floating tags in production.

### Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `ci-required` red while every other job is green | A job ended in `cancelled` (e.g. concurrency cancel after a force-push) | Re-run the workflow from the PR's Checks tab. |
| `pip install --require-hashes` fails on a transitive dep | `requirements.lock.txt` regenerated on macOS, then pushed; CI runs Linux | Regenerate the lockfile in the `python:3.12-slim` Docker image (or under WSL/Linux) and commit it. |
| `frontend` job green locally, red in CI on `next build` | Missing build-time `NEXT_PUBLIC_*` | The CI workflow exports placeholders in `env:` — confirm `ci.yml` still does. Real values are runtime-only. |
| `db` job hangs on first run | `services.postgres` health check not yet green | Bump `--health-retries` in `ci.yml`; the default 10 × 5 s = 50 s should be enough on the GitHub runners. |
| `gitleaks` reports a "leak" inside `docs/stories/INF-0*.md` | The story spec quotes the rule itself | Append the path to [.gitleaks.toml](../.gitleaks.toml) `[[allowlist]]` paths; commit. |
| Pre-commit refuses to run after a Python upgrade | `pre-commit` itself moved venv | `pre-commit clean && pre-commit install --install-hooks` |

---

## HTTPS — first-time issuance (INF-06)

> Origin: [stories/INF-06-https-letsencrypt-certbot.md](stories/INF-06-https-letsencrypt-certbot.md)
> Artifacts: [infra/scripts/issue-cert.sh](../infra/scripts/issue-cert.sh), [infra/scripts/renew-cert.sh](../infra/scripts/renew-cert.sh), [infra/nginx/conf.d/tls.conf](../infra/nginx/conf.d/tls.conf)

**When to run:** once per VPS, after INF-01 is DONE and DNS A records resolve.

### The chicken-and-egg dance

NGINX won't start with `ssl_certificate` paths pointing at files that don't exist; Certbot needs NGINX on `:80` to validate http-01. Resolution — a two-step deploy.

```bash
# 0) Pre-flight
dig +short vitachain.ma www.vitachain.ma          # both → VPS IP
ssh $VPS_USER@$VPS_HOST "sudo ufw status | grep -E '80/tcp|443/tcp'"

# 1) Temporarily disable the :443 server block in default.conf.
#    The fastest way: comment out the entire block from `server {` (the one
#    that contains `listen 443 ssl;`) down to its matching `}`. Save.

# 2) Deploy + smoke the :80-only stack
make -C infra deploy
make -C infra verify       # INF-01/03/04 pass; INF-06 block reports skip/fail

# 3) Issue against STAGING first (default — no rate-limit risk)
make -C infra issue-cert
# Expected output: "Successfully received certificate." Cert lands under
# /var/lib/docker/volumes/vitachain_letsencrypt_etc/_data/live/vitachain.ma/

# 4) Promote to PRODUCTION
make -C infra cert-delete PRIMARY=vitachain.ma     # remove the staging cert
make -C infra issue-cert-prod                      # type YES when prompted

# 5) Verify the new cert
make -C infra cert-info
# Issuer must be "C = US, O = Let's Encrypt, CN = R10" (or similar — NOT
# "(STAGING) Pretend Pear X1").

# 6) Re-enable the :443 server block (uncomment from step 1), commit, deploy
make -C infra deploy
make -C infra verify       # INF-06 block now all green

# 7) Frontend rebuild — NEXT_PUBLIC_SITE_URL is INLINED at build time
make -C infra frontend-rebuild

# 8) Supabase Dashboard manual update — qyyxgdfetzjqfpygikbz
#    Authentication → URL Configuration:
#      Site URL          = https://vitachain.ma
#      Redirect URLs    += https://vitachain.ma/**, https://www.vitachain.ma/**
#                       -= every http:// entry
#    Save. Test the magic-link flow — the email link must open https://.

# 9) Final smoke
curl -sI https://vitachain.ma/ | grep -i strict-transport-security
# Then a fresh-incognito register → magic link → /dashboard. All https://.
```

Total wall-clock ≈ 20 minutes on a quiet VPS.

### Renewal — incident playbook

**Symptom:** `make -C infra cert-info` shows `VALID: <N>` with `N < 25`, or the Healthchecks.io ping is missing for > 36 hours.

1. SSH in: `ssh $VPS_USER@$VPS_HOST`.
2. Read the log: `tail -100 /var/log/vitachain-renew.log`.
3. Force a renewal manually: `make -C infra renew-cert`.
4. **Rate-limited?** Let's Encrypt: 5 failures/hour/account. *Back off.* Do NOT retry-loop. Wait ≥ 1 hour. Production duplicate-cert limits cycle weekly.
5. **"no challenge URL reachable"?** UFW changed, the `:80` listener changed, or DNS moved. Sanity check:
   ```bash
   curl -I http://$VPS_HOST/.well-known/acme-challenge/probe
   # Expect 404 (file not present) — NOT 301-to-https.
   ```
   If you see a 301, the `:80` server block is missing the `location ^~ /.well-known/acme-challenge/` rule above `location /`. Check `infra/nginx/conf.d/default.conf`.
6. **Within 7 days of expiry?** Force a fresh issuance outside the renewal cadence:
   ```bash
   ssh $VPS_USER@$VPS_HOST "cd $PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot renew --force-renewal"
   ```

### HSTS preload submission (post-demo, ≥ 30 days of stable HTTPS)

Submit at [hstspreload.org](https://hstspreload.org/?domain=vitachain.ma) once the site has been HTTPS-only for ≥ 30 days.

**Pre-flight checklist (the site enforces these):**
- Apex serves a valid cert and 200 over HTTPS.
- `:80 → :443` redirects to the same host on the first hop.
- HSTS header on the apex: `max-age ≥ 31536000`, `includeSubDomains`, `preload`.
- All redirects from `http://www → https://www` (no cross-host first hop).

> **NOTE — preload is a one-way trip.** Removing the domain from the list takes weeks and is operator-initiated. Do not preload before the demo unless we're confident in our `:443` uptime. The header can stay set in the meantime — only the *submission* is irreversible.

### Adding a subdomain (post-MVD)

```bash
# 1) DNS A record: <newsub>.vitachain.ma → VPS IP
# 2) Add to infra/.env DOMAINS:
#      DOMAINS=vitachain.ma www.vitachain.ma admin.vitachain.ma
# 3) Re-issue (idempotent — existing SAN entries preserved by --expand):
ssh $VPS_USER@$VPS_HOST "cd $PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot certonly --webroot --webroot-path=/var/www/certbot --expand --cert-name vitachain.ma -d vitachain.ma -d www.vitachain.ma -d admin.vitachain.ma"
# 4) Reload nginx, redeploy:
make -C infra deploy
make -C infra verify
```

### Rotating the ACME account

Rare — typically only after `ADMIN_EMAIL` ownership changes. Replace the account on the existing cert without re-issuing:

```bash
ssh $VPS_USER@$VPS_HOST "cd $PROJECT_DIR && docker compose run --rm --entrypoint certbot certbot update_account --email <new-email>"
```

---

## Nightly DB backup — first-time setup (INF-07)

> Origin: [stories/INF-07-nightly-pgdump-backup-b2.md](stories/INF-07-nightly-pgdump-backup-b2.md)
> Artifacts: [infra/db-backup/Dockerfile](../infra/db-backup/Dockerfile), [infra/scripts/backup-entrypoint.sh](../infra/scripts/backup-entrypoint.sh), [infra/scripts/backup-db.sh](../infra/scripts/backup-db.sh), [infra/scripts/restore-db.sh](../infra/scripts/restore-db.sh), `db-backup` service in [infra/docker-compose.yml](../infra/docker-compose.yml), cron in [infra/scripts/bootstrap-vps.sh](../infra/scripts/bootstrap-vps.sh).

**When to run:** once, after INF-01 is DONE and INF-02 is live. Re-runs are
safe but redundant.

### One-shots

1. Create the **B2 bucket** + **application key** (bucket-scoped:
   `listFiles, readFiles, writeFiles, deleteFiles` only — *never* the master
   key). Store both in Bitwarden under *"VitaChain — Backblaze B2 backup key"*.
2. Create the **Healthchecks.io** check named `vitachain-db-backup` —
   schedule `0 2 * * *` Africa/Casablanca, grace 60 min, notifications to
   email + the team Discord/Telegram. Copy the ping URL to Bitwarden
   under *"VitaChain — Healthchecks backup URL"*.
3. Fill `infra/.env` on the workstation with:
   - `SUPABASE_DB_URL` (DIRECT URL on `:5432`, NOT the pooler on `:6543`),
   - `BACKUP_BUCKET`, `BACKUP_REMOTE_PATH`, `BACKUP_RETENTION_*`,
   - `HEALTHCHECKS_BACKUP_URL`,
   - `ALERT_WEBHOOK_URL` (Discord/Telegram/Slack incoming-webhook).
4. `make -C infra deploy` — rsync, build the new `db-backup` image, bring
   the stack up. The sidecar stays idle until cron fires.
5. `make -C infra backup-rclone-config` — walk the interactive prompts:
   `n` → name=`b2` → storage=`b2` (Backblaze B2) → `account_id` →
   `application_key` → `hard_delete = true` → quit. Verify:
   ```bash
   ssh $VPS_USER@$VPS_HOST "cd $PROJECT_DIR && docker compose -f infra/docker-compose.yml run --rm --entrypoint cat db-backup /config/rclone/rclone.conf"
   ```
6. **Pin the image by digest.** After the first build:
   ```bash
   ssh $VPS_USER@$VPS_HOST "docker images --digests vitachain/db-backup"
   ```
   Paste the `@sha256:…` form into the `image:` line in
   `infra/docker-compose.yml`, commit, redeploy.
7. Smoke:
   ```bash
   make -C infra backup-now
   make -C infra backup-list   # 1 local + 1 remote
   make -C infra verify        # INF-07 block green
   ```
   The Healthchecks dashboard turns green within 60 s.
8. Wait for the FIRST cron-fired run (next 02:00 Africa/Casablanca). Do
   **not** declare DoD until that scheduled run lands unsupervised.

### Quarterly restore drill — mandatory before any phase gate

The drill proves the backup is *recoverable*, not just *stored*. Per the
tech spec: *"An untested backup is not a backup. It's a hope."*

```bash
# 1. Stand up a throwaway Supabase project (free tier, ~3 min):
#       name:   vitachain-restore-drill-<YYYY>Q<N>
#       region: eu-central-1  (matches prod)
#       DB password: Bitwarden -> "VitaChain — Drill DB url"
export STAGING_DB_URL="postgresql://postgres:<PASS>@db.<drill_ref>.supabase.co:5432/postgres"

# 2. Restore the latest backup into it
make -C infra backup-restore BACKUP_FILE=latest STAGING_DB_URL="$STAGING_DB_URL"

# 3. Verify the restored schema vs. db/migrations source-of-truth
DB_URL="$STAGING_DB_URL" make -C db verify
# Expect: 13/13 ✓ identical to production verify.

# 4. Spot-check data parity
psql "$STAGING_DB_URL"   -c "select count(*) from public.profiles;"
psql "$SUPABASE_DB_URL"  -c "select count(*) from public.profiles;"
# Counts differ by AT MOST the signups since the dump timestamp.

# 5. Pause/delete the drill Supabase project (counts against Free Tier).

# 6. Record the drill below.
```

#### Drill log (append a new row each time)

| Date       | Operator | Backup file                                | Outcome | Notes |
|------------|----------|--------------------------------------------|---------|-------|
| YYYY-MM-DD | name     | vitachain_db_YYYYMMDD_HHMMSSZ.sql.gz       | OK/FAIL | …     |

### Selective restore — "the intern dropped a table"

Symptom: production data was deleted/corrupted by an avoidable action and the
loss is recent (< 7 days, so still in local snapshots).

1. **Stop the bleeding.** Pause anything still writing — `docker compose stop backend` if a misbehaving worker, or revoke the bad session.
2. Identify the latest *known-good* backup (timestamp BEFORE the bad
   action): `make -C infra backup-list`.
3. Stand up a drill Supabase project (see §Quarterly drill). Restore into it.
4. Diff the affected table between drill and production:
   ```bash
   psql "$STAGING_DB_URL"  -c "\\copy (select * from public.<table>) to '/tmp/good.csv' csv header"
   psql "$SUPABASE_DB_URL" -c "\\copy (select * from public.<table>) to '/tmp/now.csv' csv header"
   ```
5. Apply missing rows back with `INSERT … ON CONFLICT DO NOTHING` (avoids
   clobbering newer good writes).
6. Tear down the drill project.

### Full disaster restore — Supabase regional outage

Symptom: the live project is unreachable for > 30 minutes.

1. Create a new Supabase project in a different region (e.g. `eu-west-1`).
2. Update `SUPABASE_URL` / `SUPABASE_DB_URL` / `NEXT_PUBLIC_SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` in `infra/.env`.
3. `make -C infra backup-restore BACKUP_FILE=latest STAGING_DB_URL="$NEW_DB_URL"`
   (the variable name says "staging" but the destination is now the new
   prod — the script doesn't care, it cares only about not over-writing
   the OLD `SUPABASE_DB_URL` which is now stale).
4. `make -C infra frontend-rebuild` (NEXT_PUBLIC_SUPABASE_URL is build-arg
   inlined).
5. `make -C infra deploy && make -C infra verify` — full smoke.
6. DNS A record for `vitachain.ma` is unchanged (we're not moving VPS),
   so no propagation wait.

Total RTO: ~25 minutes. Inside PRD §8.2.

> **NOTE — user passwords do NOT survive a cross-project restore** (auth
> encryption keys differ). Active users must do a password reset.
> Document this in the post-incident announcement; do not promise
> transparency you can't deliver.

### B2 application-key rotation

Cadence: every 6 months or on any suspected leak.

1. B2 console: create a new application key (same bucket, same caps).
2. `make -C infra backup-rclone-config` — re-walk the prompts with the
   new key. The volume's `rclone.conf` is overwritten.
3. `make -C infra backup-now` — confirm the new key works end-to-end.
4. B2 console: delete the old application key.
5. Update Bitwarden.

### Healthchecks missed-ping playbook

Symptom: Healthchecks emails the team that `vitachain-db-backup` hasn't
pinged within the grace window.

1. SSH in: `tail -100 /var/log/vitachain-backup.log` — last run's outcome.
2. If the log shows a failure: read the error, fix the cause, re-run
   `make -C infra backup-now`.
3. If the log shows nothing (cron itself didn't fire):
   - `sudo systemctl status cron` — cron daemon alive?
   - `sudo grep CRON /var/log/syslog | tail -20` — did cron see the job?
   - `cat /etc/cron.d/vitachain-db-backup` — file present + correct?
4. Once a successful manual run lands, Healthchecks turns green within
   the next ping window. **Do not "snooze" Healthchecks** — the alert is
   real.

### Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `pg_dump` exits with `prepared statement does not exist` mid-dump | `SUPABASE_DB_URL` points at the pooler (`:6543`) | Switch to the DIRECT URL on `:5432` (Bitwarden → "Supabase DB direct URL"). |
| Entrypoint aborts at "dump suspiciously small ($N bytes)" | URL points at an empty Supabase project | Verify the project ref + DB password; re-run. |
| `rclone config not initialised` at step 0 | First-time deploy without §5 step 5 | `make -C infra backup-rclone-config` and re-walk the prompts. |
| Round-trip SHA mismatch in step 4 | B2 in-flight corruption (rare) | Re-run `make -C infra backup-now`. If it persists, escalate to B2 support — *don't* prune the local copy yet (it's the only intact copy). |
| Verify "B2 retention prune is working" red | `hard_delete = true` got dropped from rclone config | Re-run `make -C infra backup-rclone-config`, set `hard_delete = true` again. |
| DB password contains `@` / `:` / `/` and URL is mis-parsed | Hand-rolled password from outside Bitwarden | Percent-encode the special characters in `SUPABASE_DB_URL`. |


---

## Observability — first-time setup (INF-08)

> Origin: [stories/INF-08-sentry-uptime-kuma-observability.md](stories/INF-08-sentry-uptime-kuma-observability.md)
> Artifacts: [backend/app/core/observability.py](../backend/app/core/observability.py), [frontend/sentry.*.config.ts](../frontend/), [infra/docker-compose.yml](../infra/docker-compose.yml), [infra/nginx/conf.d/default.conf](../infra/nginx/conf.d/default.conf)

**When to run:** once per environment (staging, then prod) during the Phase-3 hardening sprint. Re-walked from scratch only on a fresh VPS or after a `down -v` wipe.

### Prerequisites

1. Sentry SaaS account — sign up with the **team Google account** (`yasseralgoside@gmail.com`), create one project named `vitachain-prod`, platform = *Python / FastAPI*.
2. In *Project Settings → Client Keys (DSN)*, create a second key named `frontend` so backend + frontend can be split for AUTH-05 boundary checks.
3. In *User Settings → Auth Tokens*, create a token with scopes `project:releases` + `project:read`. CI-only — never paste on the VPS.
4. Save all three values in Bitwarden:
   - `VitaChain — Sentry DSN (backend)`
   - `VitaChain — Sentry DSN (frontend)`
   - `VitaChain — Sentry CI auth token`
5. Brevo Dashboard → *SMTP & API → API Keys* → generate a read-only key scoped to **"Get account info" only**. Save as `VitaChain — Brevo readonly probe key`.

### Step-by-step deployment

```bash
# 1. Generate the NGINX basic-auth hash for the /uptime/ admin gate.
make -C infra observability-htpasswd USER=admin PASS="$(openssl rand -base64 24)"
# -> prints `admin:$2y$05$...`. Save the plain password in Bitwarden as
#   "VitaChain - Uptime Kuma admin"; paste the hash portion (after the colon)
#   into infra/.env as UPTIME_KUMA_ADMIN_PASSWORD_HASH.

# 2. Fill the INF-08 keys in infra/.env (see infra/.env.example).

# 3. Deploy.
make -C infra deploy

# 4. Seed the NGINX htpasswd file inside the named volume.
make -C infra observability-seed-htpasswd

# 5. Walk Kuma's first-user setup at https://vitachain.ma/uptime/ - the
#    htpasswd creds unlock the path; Kuma's own admin user is created on
#    first visit (save THOSE creds in Bitwarden as "VitaChain - Uptime Kuma admin").

# 6. Add the 5 monitors (table below).
# 7. Add the 2 notification channels and attach to all 5 monitors.
# 8. Verify.
make -C infra verify
```

### Five-monitor table (paste into Kuma)

| Name | Type | URL / Target | Interval | Expected |
|---|---|---|---|---|
| Site root | HTTP(s) | `https://vitachain.ma` | 60s | 200 |
| Backend healthz | HTTP(s) keyword | `https://vitachain.ma/api/v1/healthz` | 60s | 200 + body contains `"status":"ok"` |
| Backend readyz | HTTP(s) | `https://vitachain.ma/api/v1/readyz` | 60s | 200 (degraded Supabase trips this) |
| Brevo upstream | HTTP(s) w/ header | `https://api.brevo.com/v3/account` (header `api-key: $UPTIME_KUMA_BREVO_API_KEY`) | 5m | 200 |
| Supabase upstream | HTTP(s) w/ header | `https://qyyxgdfetzjqfpygikbz.supabase.co/rest/v1/` (header `apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY`) | 60s | 200 |

Notification rule for every monitor: **Notify when down** + **Notify when back up**, retry threshold = **2** (~2 min until alert).

### Notification channels

- **Discord:** *Server Settings -> Integrations -> Webhooks -> New Webhook* — copy URL into Kuma's `Settings -> Notifications` as a new Discord entry. Re-use the URL from `ALERT_WEBHOOK_URL` (INF-07) but make it a *separate* Kuma notification entry so the two channels can be toggled independently.
- **Telegram (optional):** [@BotFather](https://t.me/BotFather) -> `/newbot` -> save the token. Send any message to the bot from the team chat, then GET `https://api.telegram.org/bot<TOKEN>/getUpdates` to harvest the chat ID. Paste both into Kuma's Telegram notification entry.

### Planted-event drill (proves Sentry is wired end-to-end)

```bash
# Backend - refuses against the prod hostname.
VPS_HOST=staging.vitachain.ma make -C infra sentry-test-backend
# -> 500. Open Sentry -> Issues. Within 60s, "RuntimeError: INF-08 planted test"
#   appears with environment=staging, release=<git_sha>, request_id tag.

# Frontend - open the staging URL in a browser.
VPS_HOST=staging.vitachain.ma make -C infra sentry-test-frontend
# -> prints `https://staging.vitachain.ma/__sentry-test`. Click "Throw".
#   Same Issues page; stack frames should be deobfuscated (proves the CI
#   source-map upload worked).

# Negative check - prod must NOT register the event.
curl -fsS -o /dev/null -w '%{http_code}\n' https://vitachain.ma/api/v1/_sentry_test
# -> 404. No Sentry event.
```

### Forced-down drill (proves chat alerts fire)

```bash
ssh $VPS_USER@$VPS_HOST "cd $PROJECT_DIR && docker compose stop backend"
# Wait 2 polling cycles (~2 min). Discord/Telegram should show a DOWN message
# for "Backend healthz" + "Backend readyz".
ssh $VPS_USER@$VPS_HOST "cd $PROJECT_DIR && docker compose start backend"
# Within 1 cycle, recovery messages arrive on the same channel(s).
```

---

## Observability — "an alert is firing" playbook (INF-08)

1. **Open the linked Sentry issue OR Kuma monitor page.** Both link out from the chat message.
2. **Triage on the VPS** — find the request log line that matches the Sentry event's `request_id`:
   ```bash
   ssh $VPS_USER@$VPS_HOST "cd $PROJECT_DIR && docker logs vita_backend --since 5m | grep <request_id>"
   ```
3. **If real:** assign the Sentry issue, open a fix branch, ship through CI. If the regression is wide, `make -C infra rollback` (INF-01) and triage offline.
4. **If false positive:** see the noise-tuning playbook below.

### Reading the Sentry event

- `environment` tag — confirm it's `prod` (not a staging leak).
- `release` tag — links to a specific deploy SHA; click through to the GitHub commit.
- `request_id` tag — the join key with backend logs.
- **PII check:** the headers panel should show `Authorization: [scrubbed]`, NOT the bearer token. If the bearer is visible, `_scrub` is broken — open an INF-08 bug.

---

## Observability — "alert is too noisy" tuning (INF-08)

- **Per-monitor:** bump *Retries* on the Kuma monitor from 2 to 3 (alert fires after ~3 min instead of ~2).
- **Maintenance window:** Kuma -> `Settings -> Maintenance` -> schedule (used during demo rehearsal, planned restarts).
- **Sentry-side ignore:** open the noisy issue -> *Ignore* -> *Until it happens again N times*. Keeps the issue in the project but stops paging.
- **Trace budget pressure:** lower `SENTRY_TRACES_SAMPLE_RATE` from `0.1` to `0.05` in `infra/.env`; `docker compose up -d backend` picks it up on next start.

---

## Observability — Sentry monthly quota exceeded (INF-08)

The free Developer plan caps at **5,000 errors + 10,000 performance events per month**. Past the cap, Sentry silently drops events — the dashboard shows a quota banner but the on-call will not be paged.

**Mitigation (in-month):**
1. Set `SENTRY_TRACES_SAMPLE_RATE=0.0` in `infra/.env`, `docker compose up -d backend`. Stops performance ingest entirely; errors still flow.
2. In Sentry *Project Settings -> Inbound Rate Limits*, drop the per-DSN cap to 30 events/min until rollover.

**Decision (next month):** if breach recurs, evaluate the $26/month *Team* plan (50K events) — tracked as a post-MVD decision in the plan doc.

---

## Observability — Kuma config recovery (INF-08)

The `uptime_kuma_data` named volume holds Kuma's SQLite DB (monitors, notifications, incident history). Incidents are non-recoverable; monitors + notification config are.

- **Nightly export** (recommended cron addition, mirrors INF-07 pattern):
  ```
  30 2 * * * vitachain cd /opt/vitachain && make -C infra uptime-export >> /var/log/vitachain-uptime-export.log 2>&1
  ```
- **Manual export:** `make -C infra uptime-export` — lands a timestamped JSON in `infra/backups/`.
- **Restore:** `make -C infra uptime-import` — interactive YES confirm before POSTing the newest export back into Kuma.

If the volume is lost entirely:
1. `docker compose up -d uptime_kuma` (recreates an empty volume).
2. Walk the first-user setup at `/uptime/` again.
3. `make -C infra uptime-import` to re-seed the 5 monitors + 2 channels.

---

## AUTH-01 — signup operational notes

### Authoritative state of the signup policy

| Setting | Value | Source |
|---|---|---|
| Email provider enabled | ON | Dashboard → Authentication → Providers → Email |
| Confirm email (MVD) | **OFF** | Dashboard same screen; mirrored in `supabase/config.toml [auth.email]` |
| Password min length | **10** | Dashboard → Auth → Policies → Password |
| Password classes | lower + upper + digit (no special) | same |
| HaveIBeenPwned check | ON | same |
| Sign-ups / hour / IP | **4** | Dashboard → Auth → Rate Limits |

`supabase/config.toml` is the canonical proof of the above. `supabase db push --linked --dry-run` from a clean checkout must report no diff — that is the drift canary.

### Triage — "a user reports they cannot register"

1. Read the redirect URL in the user's browser: `/register?error=<key>`.
   - `email_taken` → already a row in Supabase Dashboard → Auth → Users. Ask them to log in instead, or open a password-reset flow (post-MVD).
   - `weak_password` → password failed the §4 floor or the HIBP breached-password check. Ask for a fresh 10+ char password with mixed case + a digit.
   - `rate_limited` → too many signups from their IP in the last hour. Wait 60 min, or temporarily raise the limit in Dashboard if a known load test is in flight.
   - `network` → Supabase reachability from the Server Action. Check `/readyz` on the FastAPI side and the Supabase project's status page.
   - `unknown` → look in Sentry for an Issue tagged `story=AUTH-01` with the `auth_error_code` tag; that tells you which Supabase response code was unrecognised by `mapAuthError`. Add the new code to `frontend/src/lib/auth/errors.ts` and ship a patch.
2. Check **Authentication → Logs** in the Supabase Dashboard for the matching request. Filter by their email (NOT the breadcrumb hash — Supabase Auth indexes by raw email).
3. If everything looks right server-side but the user still sees the banner, ask them to clear `vitachain.ma` cookies and retry — a stale `sb-*-auth-token` can confuse `@supabase/ssr` middleware.

### Force-resend confirmation to a stuck user (post-MVD only)

Only relevant when `enable_confirmations = true` (see §"Post-MVD switch-back" below). The recipe:

```ts
import { createClient } from "@supabase/supabase-js";
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await admin.auth.admin.generateLink({
  type: "signup",
  email: "stuck.user@example.com",
});
console.log(data?.properties?.action_link);
```

Run from a one-shot Node REPL on the VPS (`docker compose run --rm backend python …` — the service-role key is only available there per AUTH-05). NEVER paste the resulting `action_link` into Slack or any external system; deliver to the user out-of-band.

### Post-MVD switch-back — flip `enable_confirmations` ON

1. Dashboard → **Authentication → Providers → Email** → toggle *Confirm email* ON.
2. Mirror in `supabase/config.toml`: `enable_confirmations = true`. Commit + push.
3. In `frontend/src/app/register/actions.ts`, change the success branch from `redirect("/dashboard")` to `redirect("/register/check-email")`. Create that page with localized "Vérifiez votre boîte mail" copy (FR/AR/EN once I18N-02 lands).
4. Configure SMTP — **Project Settings → Auth → SMTP Settings** — point to Brevo (`smtp-relay.brevo.com:587`, team SMTP user from Bitwarden). Until then, Supabase uses its low-throughput shared mail server and signups silently fail past ~3/hour.
5. Customize **Authentication → Email Templates → Confirm signup** with FR/AR/EN copy. The redirect URL is `https://vitachain.ma/auth/callback?next=/dashboard` (route exists from INF-03).
6. Test from staging: register a fresh email, confirm Brevo's log shows delivery, click the link, expect `/dashboard`.
7. Update `docs/spring-status.yml` hand-off log.

### Sentry expectations

Every signup attempt — success or failure — emits one `category=auth`, `message=signup_attempt` breadcrumb with `data.email_hash = sha256(lowercase(email))`. Never the raw email; never the password.

Any signup failure whose Supabase code is not in the `mapAuthError` switch fires `Sentry.captureException` with `tags.story = "AUTH-01"` and `tags.auth_error_code = <code>`. Triage that Issue by adding the code to `frontend/src/lib/auth/errors.ts` — that is the canary path for new Supabase Auth releases.

---

## AUTH-02 — role assignment operational notes

### Authoritative state of the role contract

| Setting | Value | Source |
|---|---|---|
| Self-signup role set | `{FARMER, RESTAURANT, CITIZEN}` | `frontend/src/lib/auth/roles.ts` → `SELF_SIGNUP_ROLES` (parity-checked vs. the DB enum in CI) |
| DB enum `public.user_role` | `{FARMER, RESTAURANT, CITIZEN, ADMIN}` | `db/migrations/0001_extensions_and_enums.sql` |
| Trigger acceptance of ADMIN | Only when JWT role is `service_role` | `db/migrations/0007_auth02_block_admin_self_signup.sql` |
| JWT claim shape | `claims.user_role = profiles.role` | `db/migrations/0006_auth02_jwt_role_hook.sql` |
| Hook runner role | `supabase_auth_admin` | Supabase Auth convention; `GRANT EXECUTE` in 0006 |
| Default role on form | `CITIZEN` | `frontend/src/app/register/page.tsx` |
| Dashboard hook slot | **Enabled** | Authentication → Hooks → Custom Access Token → URI `pg-functions://postgres/public/custom_access_token_hook` |

The Dashboard hook slot is the runtime activator. `supabase/config.toml` mirrors it for replay but does not auto-flip the runtime hook — flipping the slot in the Dashboard is part of the AUTH-02 ship checklist (and the canary if the claim ever stops appearing).

### Seed an ADMIN user (one-off)

ADMIN accounts are never created from the public form. Use the Dashboard with a service-role context:

1. Sign in to the Supabase Dashboard → **SQL Editor** with the team Google account.
2. Run, replacing the email and pasting a strong random password from Bitwarden's *VitaChain — ADMIN seed* secure note:

   ```sql
   set local request.jwt.claims = '{"role":"service_role"}';
   insert into auth.users (id, email, raw_user_meta_data,
                           encrypted_password, email_confirmed_at)
   values (gen_random_uuid(),
           'ops-admin@vitachain.ma',
           '{"role":"ADMIN","locale":"fr","full_name":"Ops Admin"}',
           crypt('REDACTED-FROM-BITWARDEN', gen_salt('bf')),
           now());
   ```

3. Confirm `public.profiles` has the matching row with `role = 'ADMIN'`.
4. Hand the credentials to the operator over Bitwarden (never Slack / email).

The `set local request.jwt.claims` line is load-bearing — migration 0007 raises `42501` if it's missing. The Dashboard SQL Editor connects as the database owner; the trigger inspects the JWT claim, not the connection role.

### Verify the JWT hook is active

1. Log in any user from staging.
2. In browser devtools → Application → Cookies, copy the access-token portion of `sb-<ref>-auth-token`.
3. Paste into [jwt.io](https://jwt.io/). The decoded payload **must** contain `"user_role": "<their role>"`.
4. If `user_role` is missing:
   - Dashboard hook slot is OFF → flip it ON (Authentication → Hooks → Custom Access Token).
   - Slot is ON but the function is missing → re-run `make -C db push` (replays 0006).
   - The user's JWT predates rollout → force a re-login (next section).

### Force-refresh sessions after a role change

Stale JWTs after rollout are the expected high-likelihood failure mode — every existing session predates the hook and lacks `user_role`. Two paths:

- **Single user:** delete their refresh tokens; their next page load fails the refresh and logs them out cleanly.

  ```sql
  delete from auth.refresh_tokens
   where user_id = (select id from auth.users where email = 'user@x.co');
  ```

- **Global rollout (one-shot at deploy):** the FastAPI service-role client can call `supabase.auth.admin.signOut({ scope: 'global' })`. Run from `docker compose run --rm backend python …` on the VPS; the service-role key is only present there (AUTH-05).

### Triage — "I cannot publish an ad / reserve a meal / reach the admin shell"

1. Decode the user's JWT at jwt.io (Studio → Auth → Users → copy the access token).
2. **`user_role` absent** → JWT predates AUTH-02 → force re-login (above). Almost every report at first rollout lands here.
3. **`user_role` wrong** → check `public.profiles.role` in Studio; if it disagrees, an admin / service-role write is the only fix — the `enforce_profile_immutability` trigger from migration 0005 blocks self-edits.
4. **`user_role` correct, action still fails** → not AUTH-02. Route to AUTH-06 (verification_status PENDING blocks pro actions) or AUTH-04 (RLS policy).

### Revoke / downgrade a role in an incident

Single-step: the service role bypasses RLS and the immutability trigger detects `service_role` JWT and lets the write through.

```sql
-- In the Dashboard SQL Editor (service-role context implicit):
update public.profiles set role = 'CITIZEN' where id = '<uuid>';
delete from auth.refresh_tokens where user_id = '<uuid>';   -- force re-login
```

The next access token they receive carries `user_role = 'CITIZEN'` — every downstream RLS policy keys on the claim, so the demotion is effective on the very next request.

### Sentry expectations

A hand-crafted POST with `role=ADMIN` (bypassing the form's zod) fires `Sentry.captureMessage` with `level=warning`, `tags.story = "AUTH-02"`, `tags.attack = "admin_escalation"`. One Issue per attack attempt — useful for spotting probing. Migration 0007 also closes the DB-side path (the trigger raises `42501` rather than silently inserting), so the Sentry tag is the *deterministic* signal; the trigger is defence in depth.

### Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| All logins return "missing user_role" | Dashboard hook slot is OFF | Flip ON in Authentication → Hooks |
| Hook slot ON, claim still missing | Function dropped during a migration replay; or `GRANT EXECUTE supabase_auth_admin` missing | Re-run `make -C db push`; replays 0006 idempotently |
| Auth service returns 500 on token issuance | Hook function raises | Hot-revert: in Dashboard → Hooks → toggle OFF; investigate the function; ship a fix migration |
| `42501` on a service-role ADMIN seed | `set local request.jwt.claims` line omitted | Prepend the `set local` statement to the same transaction as the `insert` |
| New role added to TS but not SQL (or vice versa) | Drift | `scripts/check-role-enum-parity.sh` (pre-commit + CI) — fix the side that lags |

## AUTH-03 — JWT configuration operational notes

### Authoritative state of the JWT contract

| Setting | Value | Source |
|---|---|---|
| Access token lifetime | 3600 s (1 h) | `supabase/config.toml` `[auth].jwt_expiry` **and** Dashboard mirror |
| Refresh token lifetime | 604 800 s (7 days) | Dashboard only — Authentication → Configuration (no `config.toml` key on hosted Supabase) |
| Refresh token rotation | Enabled | `supabase/config.toml` `[auth].enable_refresh_token_rotation = true` **and** Dashboard mirror |
| Reuse grace window | 10 s | `supabase/config.toml` `[auth].refresh_token_reuse_interval = 10` |
| JWT signing algorithm | HS256 | Supabase default — immutable on free tier |
| JWT secret strength | ≥ 64 hex chars (≥ 32 bytes / 256 bits) | Dashboard → Settings → API → JWT Secret; checked by `scripts/verify-jwt-config.sh` when `SUPABASE_JWT_SECRET` is in the env |
| Backend JWT decode | PyJWT HS256, `audience="authenticated"`, `verify_exp=True` | [backend/app/core/security.py](../backend/app/core/security.py) |
| FastAPI gate | `get_current_user` → `AuthUser`; `require_role(*allowed)` for role gates | same |

The Dashboard is the runtime authority; `config.toml` is the source-controlled intent record. `scripts/verify-jwt-config.sh` (CI `db` job + pre-commit local hook) catches drift in the *file*. The §"Manual staging verification" drill below catches drift in the *live service*.

### JWT secret rotation procedure

> **Trigger:** suspected key compromise, quarterly rotation policy, or security audit finding.

1. **Generate a new 256-bit secret** on a developer machine:

   ```bash
   openssl rand -hex 32   # → 64 hex characters
   ```

2. **Update Bitwarden** — duplicate the current `VitaChain — Supabase JWT secret` entry as `VitaChain — Supabase JWT secret — ROTATED <today>` (keeps a copy of the *old* value for incident response). Replace the primary entry's value with the new secret and today's date.

3. **Apply to Dashboard** → Settings → API → JWT Secret → paste the new value (or click *Generate a new secret* if paste is disabled). Note the exact time — existing access tokens signed with the old key remain valid for ≤ 1 h post-rotation; that is the **risk window**.

4. **Force global session invalidation** to close the risk window immediately:

   ```sql
   -- Dashboard SQL Editor (service-role context implicit):
   delete from auth.refresh_tokens;
   ```

   All users see a re-login prompt on their next page load or when their current access token expires (whichever comes first). For MVD this is acceptable; schedule during off-peak hours if possible.

5. **Update the VPS `.env`** (and any developer `.env.local`):

   ```bash
   # On the VPS via ssh:
   sed -i 's/^SUPABASE_JWT_SECRET=.*/SUPABASE_JWT_SECRET=<NEW>/' /opt/vitachain/infra/.env
   make -C /opt/vitachain/infra deploy
   ```

6. **Verify** end-to-end:

   ```bash
   bash scripts/verify-jwt-config.sh        # OK on all three TOML keys
   # then: sign in a test user, decode the JWT at jwt.io, confirm signature verifies.
   ```

7. **Archive** the `ROTATED-<date>-` Bitwarden entry once the team has verified that no service is still trying to decode with the old key.

### Forced session invalidation

**Single user** (locked-out / suspicious login detected):

```sql
delete from auth.refresh_tokens
 where user_id = (select id from auth.users where email = 'suspect@example.com');
```

The next access-token refresh returns `401`; the frontend redirects to login.

**All sessions** (post-rotation or global incident):

```sql
delete from auth.refresh_tokens;
```

### Refresh token reuse-interval tuning

Default `refresh_token_reuse_interval = 10` seconds. If the Supabase Auth Logs show `refresh_token_reuse_detected` events for **legitimate** users (not bots), raise to `30` and re-push:

```toml
refresh_token_reuse_interval = 30
```

Update `scripts/verify-jwt-config.sh`'s expected value to match (otherwise CI will fail) and bump the `test_refresh_token_reuse_interval_is_10` assertion in `tests/test_security.py`. Keep `10` if the events trace only to bot traffic.

### Triage — 401 spike after deployment

1. Sentry fires on a `401_unauthorized` rate alert (INF-08).
2. Pattern in **Supabase Dashboard → Authentication → Logs**:
   - Predominant `expired_token` → tokens issued before the deploy hit their 1 h cliff; self-resolves within 1 h. No action unless the spike persists past the hour.
   - Predominant `invalid_token` → `SUPABASE_JWT_SECRET` on the backend `.env` does not match the Dashboard value. Roll the backend container back to the last known-good image; fix `.env` from Bitwarden; redeploy.
3. Backend container logs show `pydantic_core.ValidationError: supabase_jwt_secret field required` → env var missing entirely → the backend returns `500` for every route (not `401`). Source the Bitwarden value into `infra/.env`, then `make -C infra deploy`.

### Manual staging JWT decode drill

Run after any auth-config change or quarterly:

1. Register a new FARMER on staging (`/register`).
2. Devtools → Application → Cookies → copy the `access_token` portion of `sb-<ref>-auth-token`.
3. Paste at [jwt.io](https://jwt.io). Decode and assert:
   - `exp − iat == 3600` (1 h access token).
   - `user_role` claim present (AUTH-02 hook is on).
   - `sub` is a UUID and `aud == "authenticated"`.
4. Healthy-path backend call (staging):

   ```bash
   TOKEN=<paste access_token from step 2>
   curl -s -H "Authorization: Bearer $TOKEN" \
     https://staging.vitachain.ma/api/v1/healthz
   # → 200 OK
   ```

5. Force a silent refresh (reload the staging page) and confirm a new `token_refreshed` event in Dashboard → Authentication → Logs. The old refresh token should be invalidated by rotation.

### PyJWT upgrade checklist

Before bumping the `PyJWT[crypto]>=2.9,<3.0` pin in `backend/requirements.in`:

1. Read the PyJWT changelog for breaking changes to `jwt.decode()`, the `InvalidTokenError` exception hierarchy, or the `audience` / `algorithms` keyword arguments.
2. Run `pytest tests/test_security.py -v` against the new version in an isolated `venv`.
3. Run `pip-audit` against the new lock file before committing.

### Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `bash scripts/verify-jwt-config.sh` fails on `jwt_expiry` | `supabase/config.toml` was edited and the value drifted | Restore to `3600`; re-run the script |
| Backend boot fails with `supabase_jwt_secret field required` | Env var missing | Source the value from Bitwarden into `infra/.env`; redeploy |
| Every request returns `401 invalid_token` | Backend secret ≠ Dashboard secret (rotation half-applied) | Re-paste the current Dashboard secret into `infra/.env`; redeploy |
| Every request returns `401 token_expired` exactly 1 h after login | Working as intended — refresh is silently failing on the frontend | Check browser devtools for a failing `/auth/v1/token?grant_type=refresh_token` call (CORS, NGINX rule, network) |
| Multi-tab users randomly logged out | `refresh_token_reuse_interval` too short for the traffic pattern | Raise to `30` in `config.toml` + tests + verify script (§reuse-interval tuning above) |

---

## AUTH-04 — RLS contract

> Origin: [stories/AUTH-04-enable-rls-on-sensitive-tables.md](stories/AUTH-04-enable-rls-on-sensitive-tables.md)
> Artifacts: [db/migrations/0008_auth04_has_role_helper.sql](../db/migrations/0008_auth04_has_role_helper.sql), [db/migrations/0009_auth04_force_rls_contract.sql](../db/migrations/0009_auth04_force_rls_contract.sql), [db/tests/auth04_rls_contract.sql](../db/tests/auth04_rls_contract.sql), [db/tests/auth04_cross_role_isolation.sql](../db/tests/auth04_cross_role_isolation.sql), [scripts/verify-rls-enabled.sh](../scripts/verify-rls-enabled.sh), [backend/app/db.py](../backend/app/db.py)

Row Level Security is the **last line of authorization** in VitaChain. The FastAPI `require_role()` gate (AUTH-03) holds only inside the Python process; a leaked service key, a misrouted handler, or a SQL injection that escapes a sanitiser bypasses it instantly. RLS holds when every other layer fails.

Every future migration that adds a table to schema `public` must:

1. Call `alter table public.<name> enable row level security;` in the same file.
2. Attach at least one policy chosen from the catalog below.
3. Pass code review for recursion — never `select` from the *same* table inside a policy on that table; go through a `SECURITY DEFINER` helper.

The event trigger from migration 0009 is the structural backstop: a `CREATE TABLE` in `public` without RLS aborts the statement with `42501 AUTH-04: ...`.

### Policy pattern catalog

| Pattern | When to use | Template |
|---|---|---|
| **owner-only** | Caller can read/write exactly the rows they own (parcels, reservations, citizen-side bookings). | `using (auth.uid() = owner_id)` |
| **role-gated (JWT fast path)** | Catalog browse, listings — anywhere ≤ 1 h staleness on role downgrade is acceptable. | `using ((auth.jwt()->>'user_role') = 'FARMER')` |
| **role-gated (immediate revoke)** | Money-handling, admin override, sensitive flips. | `using (public.has_role('FARMER'::public.user_role))` |
| **admin-read** | Verification queues (ADM-02), lead overviews (ADM-03), commission reports. | `using (public.is_admin())` |
| **public-read** | Marketplace catalogs (FAR-02 ads list, SEC-02 meals map). | `for select using (true)` — combine with `where status = 'ACTIVE'` if the table mixes draft/published rows. |
| **verification-gated insert** (AUTH-06) | INSERT into `farmarket.ads` / `secondserve.meals`. | `with check (auth.uid() = owner_id and public.has_role('FARMER'::public.user_role) and (select verification_status from public.profiles where id = auth.uid()) = 'VERIFIED')` |

### The three legitimate RLS bypass paths

1. **`service_role` JWT** — the backend's `app.db.service_client()`. Audit point: every call to `service_client()` carries an inline `# JUSTIFICATION:` comment naming why a user JWT cannot be used. AUTH-05 enforces the frontend-side boundary (the service key must never appear in `.next/static/**`).
2. **`bypassrls` superuser role** — used only by Supabase platform tooling. Never granted to application roles.
3. **`SECURITY DEFINER` function** — `public.has_role`, `public.is_admin`, `public.handle_new_user`, `public.custom_access_token_hook`, `public.enforce_profile_immutability`, `public.enforce_rls_on_public_tables`. Audit point: code review of every new `SECURITY DEFINER` function; each must `set search_path = public, pg_temp` to defend against search-path hijacking.

### Stale-role window

A user's role lives inside their JWT. If you flip `role` on `public.profiles` (an admin demotes a misbehaving FARMER), the user's *current* access token still claims the old role until it expires (≤ 1 h, AUTH-03 `jwt_expiry`).

- For immediate revocation: `delete from auth.refresh_tokens where user_id = '<id>';` — the next refresh fails; the access token is unusable within ≤ 1 h.
- For policies that must enforce live role (no staleness): use `public.has_role(<role>)`. Cost: one DB round-trip per policy evaluation.
- Most marketplace and listing endpoints tolerate ≤ 1 h staleness happily — use the JWT-claim variant there.

### Backend client-choice rules

The backend has **two and only two** ways to reach Postgres (see [backend/app/db.py](../backend/app/db.py)):

| Factory | Bypasses RLS? | When to use |
|---|---|---|
| `service_client()` | Yes | Admin actions (ADM-02 approve, AUTH-06 set `verification_status`), trusted system writes (KAT-03 telemetry, NOT-* mailer triggers), on-signup post-processing. Each call site carries `# JUSTIFICATION:`. |
| `user_scoped_client(token)` | No — RLS fires as `authenticated` with the caller's claims | The default for every domain-facing endpoint. Wire it through `Depends(get_db_for_user)` from `app.core.security`. |

The factory does **not** cache: every call returns a fresh client. Re-binding `postgrest.auth(token)` on a cached client would silently leak identity across requests.

### Cross-role drill (gates DoD)

Run on the linked Supabase project (`qyyxgdfetzjqfpygikbz`):

1. Sign in via the Next.js frontend as the seeded `auth04-farmer@test.local`. Open DevTools → Application → Cookies → copy `access_token` to `$FARMER_TOKEN`.
2. `curl -H "Authorization: Bearer $FARMER_TOKEN" -H "apikey: $ANON_KEY" "$SUPABASE_URL/rest/v1/profiles?select=id,email,role"` — expect exactly one row, the FARMER's.
3. Repeat with `auth04-restaurant@test.local`'s token — expect exactly one row, the RESTAURANT's.
4. From the FARMER token attempt `PATCH /rest/v1/profiles?id=eq.<restaurant-id>` with body `{"full_name": "hacked"}`. Expect `204 No Content` (PostgREST signals "RLS filtered all rows" silently). Re-query as service-role and confirm the RESTAURANT's `full_name` is unchanged.
5. Record outcomes in the AUTH-04 drill log below.

### Triage flow

| Symptom | Likely cause | Action |
|---|---|---|
| "I see no rows" for a logged-in user | RLS is enabled but no policy matches, or the endpoint calls `service_client()` and forgot to filter. | `select * from pg_policies where tablename = '<table>';` — confirm policy presence and its `qual`. |
| "I see ALL rows" from a user-facing endpoint | The handler is using `service_client()` instead of `user_scoped_client(token)`. | Replace with `Depends(get_db_for_user)`; remove the `service_client()` import unless an admin path was intended. |
| `42501 permission denied for table X` | RLS is enabled and no policy admits the operation. | Either add the policy or confirm the user *should* be denied. If the operation is admin-only, switch to `service_client()` *and* add `Depends(require_role("ADMIN"))`. |
| `42P17 infinite recursion detected in policy for relation X` | A policy on X reads from X without going through a `SECURITY DEFINER` helper. | Move the lookup into a `has_role`-style helper (template: migration 0008 `has_role()`). |
| `CREATE TABLE ... ERROR: AUTH-04: table ... was created without row level security` | The event trigger from migration 0009 fired. | Add `alter table <schema>.<name> enable row level security;` to the *same* migration, before the trigger fires at `ddl_command_end`. |
| `bash scripts/verify-rls-enabled.sh` exits 1 with offender list | A table was created without RLS (CI / pre-commit caught it before merge). | Add the `enable row level security` line; re-run the script. |

### Corner cases documented for future stories

- **Partition tables / `like` clones.** The event trigger checks `pg_class.relrowsecurity`, which is the storage-level flag and is **not** inherited by partitions or `create table … (like other)`. If partitioning is introduced (no MVD plans), the trigger needs updating to walk children.
- **JWT-claim staleness on role downgrade.** Acknowledged ≤ 1 h window. Mitigation: `delete from auth.refresh_tokens where user_id = <id>` for immediate revocation; `has_role()` SECURITY DEFINER variant for policies that cannot tolerate any staleness.

### AUTH-04 drill log

| Date | Operator | Project | FARMER row count | RESTAURANT row count | Cross-row PATCH result | Notes |
|---|---|---|---|---|---|---|
| _record on DoD flip_ | | qyyxgdfetzjqfpygikbz | | | | |

## AUTH-05 — Service-key isolation

> Origin: [stories/AUTH-05-service-key-isolated-to-fastapi.md](stories/AUTH-05-service-key-isolated-to-fastapi.md)

The Supabase `service_role` JWT bypasses RLS. A single leak into a browser-reachable surface is "game over" — every row of every table, exfiltrated by any unauthenticated client, until the key is rotated. AUTH-05 makes the boundary **structural at three layers** plus an AST-level callsite gate inside the backend itself, so the contract is a property of the build (not a property of developer memory).

### Three boundary layers

| Layer | What it catches | Script | Runs in |
|---|---|---|---|
| **Source** | A reference to `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` / `SUPABASE_DB_PASSWORD` anywhere under `frontend/` or `nginx/`. A literal service-role-shaped JWT committed outside the allow-list. A `NEXT_PUBLIC_*` name in `backend/*.py`. | `scripts/check-secrets-boundary.sh` | pre-commit (`auth-05-boundary`, `always_run`) + CI `secret-leak` job |
| **Build** | A *value* that landed in the built bundle because some module read it without `import "server-only"`. Detects by decoding every JWT-shaped token in `frontend/.next/{static,standalone,server}` and matching on `role: service_role`. Also flags forbidden env-var names appearing as string literals. | `scripts/check-frontend-bundle.sh` | CI `frontend` job after `npm run build` (`if: success()`); `infra/scripts/verify.sh` deploy preflight |
| **Runtime** | A misfiled `infra/.env` — most common shape is operator copy-paste of service-role into the anon variable. Decoded by the script; identical values also flagged. | `scripts/verify-env-key-roles.sh` | `infra/scripts/verify.sh` deploy preflight (skipped silently when `infra/.env` absent) |

Plus a **structural backend check** that runs in the regular pytest suite:

- `backend/tests/test_service_client_callsite_allowlist.py` walks the AST of every `.py` file under `backend/app/`. Every call to `service_client()` must live under `routers/admin/`, `workers/`, `auth_hooks/`, or `db.py` itself. Adding to `ALLOW_PREFIXES` is a code-review event that documents *why* a new module needs RLS-bypass. The convention is paired with an inline `# JUSTIFICATION: <reason>` comment on every callsite for human readability at review time.

And a **compose-shape check** that enforces the build-arg surface area:

- `scripts/check-compose-build-args.sh` — asserts `services.frontend.build.args` contains only `^NEXT_PUBLIC_[A-Z0-9_]+$` keys. Catches the regression where someone helpfully adds `SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}` to the frontend build-args block, which would inline the secret into the bundle at compile time. Wired into pre-commit (`auth-05-compose-args`, file-gated on `infra/docker-compose.yml`) and the CI `infra` job.

### Allow-listed `service_client()` callsites

The AST gate (`backend/tests/test_service_client_callsite_allowlist.py`) permits calls only from these prefixes (paths relative to `backend/app/`):

| Prefix | Why allow-listed |
|---|---|
| `routers/admin/` | ADM-* admin endpoints (cross-tenant by design — admins see every farmer's profile). Each handler is independently responsible for `Depends(require_role("ADMIN"))`. |
| `workers/` | Async workers (NOT-01 Brevo mailer, KAT-09 diagnostic, …) run as system processes with no user JWT to forward. |
| `auth_hooks/` | Supabase Auth on-signup post-processing — runs before the user has a session. |
| `db.py` | The definition itself. |

Every other caller is a regression. The failing test message names the violating `file:line` and points the contributor at this section.

### Leak response procedure

If the bundle scanner (CI step or preflight) reports a service-role JWT in the bundle, OR a developer reports a leaked service-role key from any source:

1. **Rotate.** Supabase Dashboard → Settings → API → `service_role` key → **Rotate**. The old key is invalidated immediately. *Window of exposure ends at this step.*
2. **Update the env.** Paste the new value into `/opt/vitachain/.env` on the VPS (`SUPABASE_SERVICE_ROLE_KEY=…`). Update the Bitwarden entry "VitaChain — Supabase service-role key". Update CI secrets (`gh secret set SUPABASE_SERVICE_ROLE_KEY` if using GH Actions secrets, or the equivalent for whichever runner stores them).
3. **Redeploy backend.** `ssh vitachain@vps "cd /opt/vitachain && docker compose up -d backend"`. The frontend image does NOT need rebuilding — only the backend reads the service-role key.
4. **Verify.** `bash scripts/verify-env-key-roles.sh /opt/vitachain/.env` on the VPS. `curl -sS https://vitachain.ma/api/v1/healthz` and `…/readyz` — both 200. `docker logs vita_backend --tail=50` — no startup errors.
5. **Audit the exposure window.** Supabase Dashboard → Logs → Auth → filter by time range from "first commit that contained the leak" to "rotation timestamp". Look for any successful service-role-authenticated request from an IP that is *not* the VPS. If found, escalate to a full data-egress audit (`select * from auth.audit_log_entries where created_at >= '<commit time>'`).
6. **Backfill defence.** If the leak shape is novel (a bypass the scanners missed), edit the scanner — typically adding a regex variant — and merge with a test in `scripts/tests/test_check_secrets_boundary.sh` (or `test_check_frontend_bundle.sh`) that proves the new shape is caught.
7. **Record.** Add a one-line entry to the table below.

### Common failure modes

| Symptom | Cause | Resolution |
|---|---|---|
| `AUTH-05 SKIP: frontend/.next does not exist — run 'npm run build' first` | Scanner ran before the build, or against a fresh checkout. | In CI the `if: success()` guard tied to the build step ensures the build ran first. Locally: `cd frontend && npm run build && cd ..`, then re-run the scanner. |
| `AUTH-05 FAIL — service-role JWT found in built bundle (prefix=eyJ...)` | A frontend module read `process.env.SUPABASE_SERVICE_ROLE_KEY` without `import "server-only"`, OR `docker compose build` inherited an errant env. | Follow the leak response procedure above. Then `grep -RnE 'SUPABASE_SERVICE_ROLE_KEY' frontend/src` to find the offending source and either move it server-side under `import "server-only"` or remove it. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY decodes to role="service_role"` | Operator pasted the service-role key into the anon variable on the VPS. **The browser would now have RLS-bypass.** | Rotate the service-role key (the anon variable is publicly readable, so it must be considered compromised); fix `infra/.env`; redeploy. |
| `frontend.build.args.SUPABASE_SERVICE_ROLE_KEY — not a NEXT_PUBLIC_* key` | Someone added the service-role key as a build-arg "to keep things uniform". | Remove the build-arg. Pass the value via `environment:` to the **backend** service only. Service-role never belongs in the frontend image at all. |
| `service_client() called from a non-allowlisted path: modules/foo/router.py:42` | A user-facing handler reached for `service_client()` to "fix" a `permission denied`. | The RLS policy is the bug, not the client choice. Replace with `Depends(get_db_for_user)` and fix the policy under AUTH-04. If the operation genuinely needs admin privilege, move the handler under `routers/admin/` with `Depends(require_role("ADMIN"))`. |
| `'yq' not installed` | The compose-args check needs `yq`. | `pip install yq` (Python wrapper around `jq`, what `apt-get install -y yq` ships on Ubuntu 24.04 — both work). |

### Recorded boundary drills

| Date | Drill | Outcome | CI run URL |
|---|---|---|---|
| _record on DoD flip_ | Injected `process.env.SUPABASE_SERVICE_ROLE_KEY` reference in `frontend/src/_drill/leak.tsx` on `chore/auth-05-drill` | _CI `secret-leak` job red within … s_ | _paste url_ |
| _record on DoD flip_ | Swapped anon ↔ service-role values in a redacted `infra/.env.sample` | _`scripts/verify-env-key-roles.sh` exit 1; deploy preflight aborted_ | _paste url_ |

### Why service-role isolation is the keystone

If RLS (AUTH-04) is broken, individual policies leak rows but the rest of the wall holds. If JWT validation (AUTH-03) is broken, attackers need to forge tokens — non-trivial. If KYC (AUTH-06) is broken, unverified pros can publish — embarrassing but reversible.

If `service_role` leaks, every other defence collapses simultaneously. **No other secret in the stack has that property.** AUTH-05 is therefore the only authorization story whose enforcement layer is structural (CI + AST + bundle scan + env decode) rather than runtime — because the cost of catching it at runtime is "all rows of all tables exfiltrated by anyone who loaded a page."

---

## AUTH-07 — Authorization & business-rule regression matrix

AUTH-07 is the *merge gate* for demo day: every (role, table, verb) cell and every PRD business rule (BR-K1 … BR-S4) has a known-correct outcome asserted by a test that runs on every PR. A green AUTH-07 on the demo commit is the contract; a red one is the cue to fall back to "Smoke & Mirrors" (PRD §13 R3, R5).

### Local pre-flight

```bash
# Pure-local: pgTAP + application-layer BR pytest, no network leg.
bash scripts/verify-rls-matrix.sh

# Full sweep including the 22-cell e2e against staging.
SUPABASE_URL=https://qyyxgdfetzjqfpygikbz.supabase.co \
SUPABASE_ANON_KEY=$ANON \
SUPABASE_JWT_SECRET=$SECRET \
API_BASE_URL=https://staging-api.vitachain.ma \
  bash scripts/verify-rls-matrix.sh
```

Top-level `make auth07` wraps the same script. The pgTAP leg is folded into `make -C db verify`, so every full DB verification (run by CI's `db` job) exercises the AUTH-07 matrix too.

### Role × table × verb matrix (22 cells)

The single source of truth is `AUTH07_MATRIX` in [backend/tests/test_auth07_role_matrix_e2e.py](../backend/tests/test_auth07_role_matrix_e2e.py); the pgTAP file [db/tests/auth07_role_matrix.sql](../db/tests/auth07_role_matrix.sql) is the structural mirror that runs without network.

Legend: ✅ expected to succeed / return data; ⊘ expected denial (RLS filter → empty result for read, `42501` / `204` empty for write); ⛔ anon path is `401` at the API layer before RLS runs.

| #  | Identity              | Table / Endpoint                                         | Verb   | Outcome             | Source           |
|----|-----------------------|----------------------------------------------------------|--------|---------------------|------------------|
| 1  | FARMER-A              | `public.profiles`                                        | SELECT | ✅ 1 row (own)      | AUTH-04          |
| 2  | FARMER-A              | `public.profiles` (other)                                | SELECT | ⊘ 0 rows            | AUTH-04          |
| 3  | FARMER-A              | `public.profiles` (other)                                | UPDATE | ⊘ 204 empty         | AUTH-04          |
| 4  | FARMER-A              | `katara.parcels` (own)                                   | INSERT | ✅                  | KAT-01           |
| 5  | FARMER-A              | `katara.parcels` (other)                                 | SELECT | ⊘ 0 rows            | KAT-01           |
| 6  | FARMER-A              | `katara.telemetry` via user JWT                          | INSERT | ⊘ 42501             | KAT-03           |
| 7  | FARMER-A              | `farmarket.ads` (own)                                    | UPDATE | ✅                  | FAR-05           |
| 8  | FARMER-A              | `farmarket.ads` (other)                                  | UPDATE | ⊘ 0 rows            | FAR-05           |
| 9  | FARMER-B *unverified* | `farmarket.ads`                                          | INSERT | ⊘ 42501 (AUTH-06)   | AUTH-06          |
| 10 | FARMER-A *verified*   | `farmarket.ads`                                          | INSERT | ✅                  | AUTH-06          |
| 11 | FARMER-A              | `farmarket.leads` (own ad)                               | SELECT | ✅                  | FAR-04           |
| 12 | RESTAURANT            | `farmarket.ads` ACTIVE                                   | SELECT | ✅                  | FAR-02           |
| 13 | RESTAURANT            | `farmarket.ads`                                          | INSERT | ⊘ 42501 (BR-F1)     | BR-F1            |
| 14 | RESTAURANT *verified* | `secondserve.meals`                                      | INSERT | ✅                  | SEC-01           |
| 15 | RESTAURANT            | `secondserve.reservations` (own meal)                    | SELECT | ✅                  | SEC-06           |
| 16 | RESTAURANT            | `secondserve.reservations` (other restaurateur's meal)   | SELECT | ⊘ 0 rows            | SEC-06           |
| 17 | CITIZEN               | `secondserve.meals` ACTIVE                               | SELECT | ✅                  | SEC-02           |
| 18 | CITIZEN               | `secondserve.meals`                                      | INSERT | ⊘ 42501             | SEC-01 role gate |
| 19 | CITIZEN-A             | `secondserve.reservations` (own)                         | SELECT | ✅                  | SEC-09           |
| 20 | CITIZEN-A             | `secondserve.reservations` (other)                       | SELECT | ⊘ 0 rows            | SEC-09 privacy   |
| 21 | ADMIN                 | `farmarket.leads`                                        | SELECT | ✅ (all rows)       | ADM-*            |
| 22 | anon                  | `secondserve.meals` ACTIVE (public catalog)              | SELECT | ✅                  | SEC-02           |

### Business-rule coverage matrix (16 rules → 16 tests)

| BR    | Description                                          | Enforcing layer                                            | Test file                                                                 |
|-------|------------------------------------------------------|------------------------------------------------------------|---------------------------------------------------------------------------|
| BR-K1 | one ESP32 ↔ one parcel                               | UNIQUE on `katara.devices.device_api_key_hash`             | `db/tests/auth07_business_rules.sql`                                      |
| BR-K2 | alert anti-spam ≤ 1 email / device / metric / 24h    | `katara.should_send_alert()` SQL function                  | `db/tests/auth07_business_rules.sql`                                      |
| BR-K3 | OWM data cached ≥ 3 hours                            | `app.integrations.openweathermap._CACHE`                   | `backend/tests/test_auth07_business_rules.py` (uses `freezegun`)          |
| BR-K4 | history API ≤ 500 points                             | `katara.history()` aggregation                             | `db/tests/auth07_business_rules.sql`                                      |
| BR-F1 | only verified FARMER creates ads                     | RLS WITH CHECK on `farmarket.ads.INSERT`                   | `auth07_role_matrix.sql` cells 9/10/13 + `auth07_business_rules.sql`      |
| BR-F2 | ≤ 5 photos / ad                                      | CHECK constraint on `farmarket.ads.photos`                 | `db/tests/auth07_business_rules.sql`                                      |
| BR-F3 | ad > 7 days → EXPIRED                                | `farmarket.expire_stale_ads()` worker SQL                  | `db/tests/auth07_business_rules.sql` (7d+1h / 6d+23h boundary)            |
| BR-F4 | Brevo key only on backend                            | AUTH-05 source/build/runtime guards                        | `backend/tests/test_auth07_business_rules.py` (bundle scan)               |
| BR-B1 | Moroccan phone format `^0[5-7]\d{8}$`                | CHECK on `botabaqa.leads.phone`                            | `db/tests/auth07_business_rules.sql`                                      |
| BR-B2 | Webhook → Brevo (no Python in BotaBa9a path)         | Supabase Database Webhook                                  | `backend/tests/test_auth07_business_rules.py` (AST scan)                  |
| BR-S1 | pickup code generated server-side                    | Pydantic `extra='forbid'` + DB DEFAULT/trigger             | `auth07_business_rules.sql` + `test_auth07_business_rules.py`             |
| BR-S2 | atomic reservation; 0 stock → 409                    | `secondserve.reserve_meal()` (`for update`) + 409 mapping  | `auth07_business_rules.sql` + `test_auth07_business_rules.py` (race)      |
| BR-S3 | meal deadline auto-expiry (worker)                   | `secondserve.expire_stale_meals()` SQL                     | `db/tests/auth07_business_rules.sql` (past / future deadline)             |
| BR-S4 | monthly commission = SUM(price × qty) × 0.15         | `secondserve.commission_for_month()`                       | `db/tests/auth07_business_rules.sql` (exact DECIMAL)                      |

> **Note** — every BR block in the pgTAP and pytest files probes for the owner story's artefact (`to_regclass()`, `pg_temp.fn_exists`, route presence) and SKIPs with a `NOTICE` until the upstream merges. The suite is therefore green from the moment AUTH-07 lands, then activates per BR as KAT-01..05 / FAR-01..06 / SEC-01..08 / BOT-03..05 merge.

### Triage flow

| Symptom                                              | Likely cause                                                                       | Action                                                                                                                                  |
|------------------------------------------------------|------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| pgTAP cell-NN turned red                             | A migration changed a policy without updating the matrix                           | `git log -p -- db/migrations/` since last green run; diff the policy on the relevant table; update the matrix or fix the policy.        |
| pgTAP BR-K1..S4 turned red                           | A schema CHECK or trigger was dropped/loosened                                     | `\d+ <schema>.<table>` on staging; compare to migration history. Restore the constraint.                                                |
| e2e cell-NN red but pgTAP green                      | Handler regression — wrong `Depends()`, missing `require_role`, smuggled service_client | Grep the offending route for `service_client(` and `Depends(get_db_for_user)`. The policy is fine, the handler is wrong.            |
| BR-S1 entropy red                                    | `secrets.token_hex` was replaced by `random.choices`, or the alphabet was truncated | `git log --grep="VITA-" -p`; restore `secrets.choice(string.ascii_uppercase + string.digits)`.                                          |
| BR-S2 sees 2× 201                                    | `select … for update` removed from `reserve_meal()`, or isolation downgraded       | `\sf secondserve.reserve_meal`; `for update of <row>` must be present. Inspect `pg_locks where not granted` during the failing run.     |
| BR-F3 6d+23h ad flipped EXPIRED                      | The `>=` in the expire predicate became `>`                                        | `\sf farmarket.expire_stale_ads`; restore `created_at <= now() - interval '7 days'`.                                                    |
| Many cells SKIP                                      | An owner story's migration hasn't merged yet                                       | Expected during the partial-merge window. Confirm `to_regclass()` returns NULL for the schema; verify the owner-story PR is on track.    |

### Demo-day pre-flight

1. Run `scripts/verify-rls-matrix.sh` locally against staging — **green**.
2. Trigger a `main` CI run on the demo commit — record the run URL.
3. Screenshot the CI green badge and paste under the *AUTH-07 Demo runs* table below.
4. Re-run `make -C db test-auth07` on the linked project ≤ 10 minutes before the demo (the auto-expiry worker may have moved data around).
5. If any cell or BR is red within 30 minutes of the demo, **do not attempt a hot fix** — switch to "Smoke & Mirrors" per PRD §13 R3 / R5.

### AUTH-07 Demo runs

| Date | Trigger | Outcome | CI run URL |
|---|---|---|---|
| _record on DoD flip_ | local `scripts/verify-rls-matrix.sh` against staging | _e.g. "22 cells + 11 BR pgTAP + 5 BR pytest green in 87 s"_ | _paste url_ |
| _record on DoD flip_ | `main`-branch CI on demo commit                       | _e.g. "db job green, backend job green, e2e leg green"_ | _paste url_ |

---

## AUTH-08 — Rate limits & abuse playbook

> Origin: [stories/AUTH-08-nginx-rate-limiting-public-endpoints.md](stories/AUTH-08-nginx-rate-limiting-public-endpoints.md)
> Artifacts: [infra/nginx/templates/00-rate-limits.conf.template](../infra/nginx/templates/00-rate-limits.conf.template), [infra/nginx/conf.d/default.conf](../infra/nginx/conf.d/default.conf), [infra/scripts/bench-rate-limits.sh](../infra/scripts/bench-rate-limits.sh)

**When to consult:** a legitimate user reports a 429; a flood is in progress; Brevo says we tripped its quota; a new endpoint is being added and needs a bucket assignment.

### Bucket table

| Bucket          | Rate          | Burst (nodelay) | Key                       | Protects                                                                  |
|-----------------|---------------|-----------------|---------------------------|---------------------------------------------------------------------------|
| `auth_grant`    | 5 req/min/IP  | 10              | `$binary_remote_addr`     | `POST /api/v1/auth/token` (password grant + refresh exchange)             |
| `auth_register` | 3 req/min/IP  | 5               | `$binary_remote_addr`     | `POST /api/v1/auth/register`                                              |
| `auth_upload`   | 2 req/min/IP  | 3               | `$binary_remote_addr`     | `POST /api/v1/auth/kyc/*` (AUTH-06 doc upload, ≤ 5 MB body)               |
| `public_write`  | 6 req/min/IP  | 12              | `$limit_key` (whitelisted)| BotaBa9a leads, FarMarket contact, `/uptime/` admin — Brevo-trigger paths |
| `public_read`   | 60 req/min/IP | 120             | `$limit_key`              | Catalog reads, frontend SSR, `/api/v1/` catch-all                         |
| `mutate_strict` | 10 req/min/IP | 5               | `$limit_key`              | SEC-04 reservations, SecondServe/FarMarket writes, `/api/v1/admin/*`      |
| `iot_ingest`    | 4 req/min/key | 20              | `$http_x_device_api_key`  | KAT-03 `/api/v1/katara/ingest` — keyed on device key, NOT IP              |

Connection caps: `limit_conn perip 50` + `limit_conn perserver 5000` at `:443 server { }` scope (slowloris + per-vhost backstop).

### Whitelist table

| Entry                          | Source                          | Purpose                                                | Expiry        |
|--------------------------------|---------------------------------|--------------------------------------------------------|---------------|
| `${VPS_PUBLIC_IP}`             | infra/.env at deploy time       | Uptime Kuma probes, Next.js SSR egress, cron jobs      | permanent     |
| `52.21.110.144/29`             | healthchecks.io docs            | Healthchecks.io egress range                           | re-verify quarterly |
| `${RATELIMIT_WHITELIST_IPS}`   | infra/.env at deploy time (CSV) | Demo-day field laptops, on-call workstations           | per-event     |

The `auth_*` and `iot_ingest` buckets deliberately **do not** consult the whitelist — operator brute force is still brute force.

### Triage flow

#### 1) "A legitimate user is being 429'd"

1. Get the user's public IP (`curl ifconfig.me` from their browser console).
2. `make -C infra rate-limit-tail` and ask the user to retry.
3. Confirm the log line: `limiting requests, excess: 0.xxx by zone "<bucket>", client: <ip>, server: vitachain.ma, request: "<method> <path>"`.
4. Decision tree:
   - **Bucket too tight** (real human usage exceeds the cap): edit the rate in [infra/nginx/templates/00-rate-limits.conf.template](../infra/nginx/templates/00-rate-limits.conf.template), bump by 1.5–2×, commit, `make -C infra deploy`, watch the tail for 5 minutes, then `make -C infra bench-rate-limits` regression check.
   - **Legitimate ops/monitor IP** (shouldn't be capped at all): add the IP to `RATELIMIT_WHITELIST_IPS` in [infra/.env](../infra/.env), `make -C infra deploy`. Verify with one curl that the 429 no longer fires.
   - **Genuine spike** (real surge of organic traffic, e.g. a press mention): leave the bucket alone, the user's request refills in `60/rate` seconds. Note in the incident log for post-event capacity review.

#### 2) "A flood is in progress and the bucket is too loose"

1. `make -C infra rate-limit-tail | head -100` — confirm which zone is firing and at what rate.
2. Identify the offending IP: `ssh $VPS_USER@$VPS_HOST 'docker exec vita_nginx tail -1000 /var/log/nginx/access.log | awk "{print \$1}" | sort | uniq -c | sort -rn | head'`.
3. Two-track response:
   - **Tighten the bucket** (long-term fix): edit `rate=Xr/m` for the affected zone in `00-rate-limits.conf.template`, halve it, deploy, watch.
   - **Temporary IP block** (immediate stop): `ssh root@$VPS_HOST 'ufw deny from <ip>'`. Document in incident log; revisit within 24 h.
4. Sentry breadcrumb should show the `429 → /429.html` events. If not, suspect the entrypoint envsubst failed to render — check `docker logs vita_nginx` for envsubst output and confirm `/etc/nginx/conf.d/00-rate-limits.conf` exists in the container.

#### 3) "Brevo says we tripped their quota"

1. Open Brevo dashboard → Statistics → identify the offending campaign (FarMarket contact-the-seller, BotaBa9a lead intake, or SecondServe pickup-code notifications).
2. Map back to the endpoint: contact → `/api/v1/farmarket/ads/<id>/contact`; lead → `/api/v1/botabaqa/leads`; pickup-code → `/api/v1/secondserve/reservations` indirect via webhook.
3. The bucket for both Brevo-trigger paths is `public_write`. Tighten its rate (default `6r/m`, halve to `3r/m`), redeploy, monitor.
4. Open a follow-up ticket: introduce a per-day-per-IP application-layer counter in FastAPI so the bucket can stay generous for first-contact users.

### Post-incident bucket tightening — exact sequence

```bash
# 1. Edit the template (local repo)
$EDITOR infra/nginx/templates/00-rate-limits.conf.template
#    → change `rate=6r/m` to `rate=3r/m` on the offending zone.

# 2. Lint locally
make -C infra nginx-test
#    → must end with "nginx: configuration file /etc/nginx/nginx.conf test is successful".

# 3. Commit, push, deploy
git add infra/nginx/templates/00-rate-limits.conf.template
git commit -m "AUTH-08: tighten public_write from 6r/m to 3r/m (Brevo quota event YYYY-MM-DD)"
make -C infra deploy

# 4. Watch the live error log for 5 minutes
make -C infra rate-limit-tail

# 5. Regression bench (from a non-whitelisted IP)
make -C infra bench-rate-limits

# 6. Record the change in the drill log below.
```

### Regression test cookbook — adding a new bucket for a new public endpoint

1. Pick the closest existing bucket from the table above. If none fits, declare a new `limit_req_zone` in `00-rate-limits.conf.template`.
2. In [infra/nginx/conf.d/default.conf](../infra/nginx/conf.d/default.conf), add a `location` block ahead of the `/api/v1/` catch-all:
   ```nginx
   location = /api/v1/your-new-endpoint {
       limit_req zone=<bucket> burst=<burst> nodelay;
       include /etc/nginx/snippets/limit-headers.conf;
       include /etc/nginx/snippets/proxy-backend.conf;
   }
   ```
3. Add a `scenario` line to [infra/scripts/bench-rate-limits.sh](../infra/scripts/bench-rate-limits.sh) mirroring the existing patterns.
4. `make -C infra nginx-test && make -C infra deploy && make -C infra bench-rate-limits`.

### Rollback procedure

If a rate-limit change breaks production (legitimate users 429'd at scale), apply in this priority:

1. **Bucket tweak via re-deploy** (preferred, ~3 min): edit the rate, `make -C infra deploy`. Reaches DOM in ≤ 60 s after `up -d --remove-orphans` recycles the nginx container.
2. **Live `sed` + reload** (emergency, < 60 s): `ssh $VPS_USER@$VPS_HOST 'docker exec vita_nginx sed -i "s|limit_req zone=<bucket>|# limit_req zone=<bucket>|g" /etc/nginx/conf.d/default.conf && docker exec vita_nginx nginx -s reload'`. Document, follow up with a PR within 24 h.
3. **Nuclear — disable AUTH-08 entirely** (only if a config bug is taking down the site): `ssh $VPS_USER@$VPS_HOST 'docker exec vita_nginx mv /etc/nginx/conf.d/00-rate-limits.conf /etc/nginx/conf.d/00-rate-limits.conf.disabled && docker exec vita_nginx nginx -s reload'`. Re-enable within the hour.

### Staging drill — DoD trigger

1. Merge the AUTH-08 PR to `main`; `make -C infra deploy` lands the new config on staging VPS.
2. From a **non-whitelisted IP** (phone hotspot, NOT the office WiFi that exits the VPS's own IP range), run `make -C infra bench-rate-limits`. All 8 scenarios must `PASS`.
3. `make -C infra verify` — the 14-check AUTH-08 block must be green.
4. Open `https://vitachain.ma/429.html` in a browser; confirm the FR/AR/EN locale switch via `navigator.language`.
5. Record the drill in the table below: date, operator, IP used, bench-rate-limits output, screenshot of the 429 page.
6. Flip `AUTH-08.status: IN_REVIEW → DONE` in [docs/spring-status.yml](spring-status.yml).

### AUTH-08 drill log

| Date | Operator | Source IP | Result                                      | Commit SHA |
|------|----------|-----------|---------------------------------------------|------------|
| _record on DoD flip_ | _name_   | _hotspot IP_ | _e.g. "8/8 scenarios PASS, 14/14 verify checks green"_ | _SHA_ |


