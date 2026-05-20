# INF-05 — CI pipeline (GitHub Actions + pre-commit hooks)

> **Epic:** E0 — Infrastructure & DevOps Foundation
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must
> **Status:** TODO
> **Depends on:** [INF-03](INF-03-nextjs-scaffold-login-dashboard.md) (`DONE` — `frontend/` with eslint + tsc + next build), [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) (`DONE` — `backend/` with ruff + pytest + docker build)
> **Unblocks:** AUTH-05 (service-role isolation grep promoted to a blocking check), AUTH-07 (RLS audit suite will plug into the same workflow), every downstream story (lint+test gate prevents Week-2 rot)
> **Acceptance (PRD §12 / [docs/spring-status.yml:147](../spring-status.yml#L147)):** *"First PR triggers lint + unit tests."*

---

## 1. Purpose

Lock the quality gate that keeps the 8-week timeline honest: every push and every pull request must, in under 5 minutes, prove that the **frontend** still typechecks/lints/builds, the **backend** still passes ruff + pytest + `docker build`, the **db** migration scripts still apply on a throw-away Postgres, the **infra** YAML/Dockerfile/Bash is well-formed, and — the cross-cutting invariant from PRD §7.1 AUTH-05 — that the Supabase **service-role key never leaks into the frontend bundle** and that **no `NEXT_PUBLIC_*` ever leaks into backend Python**.

Pre-commit hooks run the cheap subset locally before the commit ever lands, so developers don't pay the GitHub Actions round-trip to learn they forgot to `ruff format`. CI re-runs everything and is the only authoritative gate.

This story is **infrastructure for confidence**, not feature work: it ships zero new product behavior. Its proof is that the next PR a contributor opens turns the green check into a contract.

---

## 2. Scope

### In scope

- A `.github/workflows/` directory with **four** workflows:
  - `ci.yml` — the umbrella, fan-out into the four jobs below via path filters so unaffected jobs short-circuit to skipped (≈ free).
  - `frontend.yml` — `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`, `docker build` (no push).
  - `backend.yml` — `pip install --require-hashes`, `ruff check`, `ruff format --check`, `pytest`, `docker build` (no push).
  - `db.yml` — spin a Postgres 17 service, replay every `db/migrations/*.sql` via `db/scripts/push.sh`, run `make -C db verify` against the ephemeral instance.
  - *(Single `ci.yml` orchestrator is fine; "four workflows" above is the conceptual unit. See §5.2 for the actual file layout — one `ci.yml` with four jobs.)*
- A **secret-leak** job that always runs (no path filter) and:
  - Greps `frontend/` and `nginx/` for `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, and the well-known Supabase JWT header prefix (`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`).
  - Greps `backend/` `*.py` for `NEXT_PUBLIC_` references.
  - Runs `gitleaks` (pinned action) across the whole tree on every PR; ignores `*.env.example`.
- A **pre-commit** configuration ([.pre-commit-config.yaml](../../.pre-commit-config.yaml)) that wires:
  - `ruff check` + `ruff format` for `backend/**/*.py` (uses the existing [backend/pyproject.toml](../../backend/pyproject.toml) config — no duplication).
  - `eslint --fix` + `tsc --noEmit` for `frontend/src/**/*.{ts,tsx}` (uses the existing `next lint` / `tsconfig.json`).
  - `shellcheck` on every `*.sh` under `infra/scripts/`, `db/scripts/`.
  - `hadolint` on every `Dockerfile`.
  - `yamllint` on `docker-compose.yml`, `.github/workflows/*.yml`, `docs/spring-status.yml`.
  - `nginx -t` in a throwaway `nginx:1.27-alpine` container on changed `nginx/conf.d/*.conf` (reuses the helper from [infra/Makefile](../../infra/Makefile)).
  - Standard hygiene: end-of-file-fixer, trailing-whitespace, check-merge-conflict, mixed-line-ending (CRLF → LF for `*.sh`/`*.yml`/`*.py`/`*.ts`/`*.tsx`/`*.sql`), `detect-private-key`, `check-added-large-files` (max 2 MB — matches PRD BR-F2 photo budget).
  - Local hook: `scripts/check-secrets-boundary.sh` — the AUTH-05 invariant, callable from both pre-commit and CI so the rule lives in **one** place.
- A `scripts/check-secrets-boundary.sh` helper at the repo root, invoked by pre-commit, CI, and (already) `infra/scripts/verify.sh`.
- A **branch protection** rule documented in [docs/runbook.md](../runbook.md) — not enforced by code (this story can't `gh api` the org settings on its own), but a copy-pasteable checklist for the repo admin: require status checks `ci / frontend`, `ci / backend`, `ci / db`, `ci / secret-leak` to pass before merge, and require linear history.
- A **CONTRIBUTING.md** snippet documenting `pre-commit install` as the one-time onboarding step.
- A `make ci-local` target at the repo root (new top-level `Makefile`) that runs the same set of checks a developer can run offline — same commands the GitHub job runs, just locally — so failures reproduce without push/wait/repeat.

### Out of scope (later stories)

- **Deployment** to the VPS on green main (continuous deployment) — deferred; INF-01 owns the `make -C infra deploy` script today, and demo cadence is too low (8 weeks total) to justify an auto-deploy pipeline. Reassess after demo.
- **Publishing** Docker images to a registry — same reason; the VPS builds from rsync'd source.
- **Test coverage** thresholds (`pytest --cov --cov-fail-under=N`) — `AUTH-07` lands the real test suite; setting a coverage floor on a 4-test skeleton would be cargo-culting.
- **Load tests** (`/ingest` at 100 req/s, 50 concurrent users) → **QG-04 / QG-05** under Phase 3.
- **CodeQL / Dependabot** — Dependabot config is one file, but the noise from a 1-month-old project drowns signal; defer to W6 once the surface stabilises.
- **i18n string-extraction lint** ("no hardcoded strings in `.tsx`") → **I18N-01**.
- **RLS regression suite** in CI → **AUTH-07**.
- **Container image signing / SBOM** — post-MVD.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| The repo is on GitHub | The env reports `Is a git repository: false` today. A repo admin must `git init`, create the GitHub remote, push `main`, and invite the three developers **before** this story can be verified. The implementation here is independent of that timing — files land on disk first, then prove themselves on the first PR. |
| [INF-03](INF-03-nextjs-scaffold-login-dashboard.md) `DONE` | Frontend has `npm run lint` / `npm run typecheck` / `npm run build` working — confirmed in INF-03 §6 local DoD. |
| [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) `DONE` | Backend has `ruff check` / `pytest` / `docker build` working — confirmed in INF-04 §6 local DoD. |
| Python 3.12 + `pip` on developer laptops | Same as INF-04 (pre-commit framework itself is Python). |
| Node ≥ 20 on developer laptops | Already required by `frontend/package.json` (`engines.node >= 20`). |
| Docker Desktop (or `docker` CLI) on developer laptops | Pre-commit `hadolint` and the optional local `make ci-local` reuse Docker if available; CI runs against the GitHub Actions Ubuntu image with Docker pre-installed. |

---

## 4. Target configuration

| Setting | Value | Source |
|---|---|---|
| CI host | GitHub Actions, `ubuntu-24.04` | Free for public repos; 2000 min/month for private — well within MVD (≈ 30 PRs × 5 min ≈ 150 min). |
| Concurrency | Cancel-in-progress per branch | Spending minutes re-running a stale commit's CI is pure waste on the budget. |
| Frontend Node version | `20.x` (matrix-pinned via `actions/setup-node`) | Matches `frontend/package.json` `engines.node`. |
| Backend Python version | `3.12.x` (matrix-pinned via `actions/setup-python`) | Matches `backend/Dockerfile` base image (`python:3.12-slim`). |
| Postgres for `db` job | `postgres:17` service container | Matches the live Supabase project (PG17, see [INF-02](INF-02-supabase-project-base-schema.md)). |
| Total wall-clock target | < 5 min on a clean cache, < 90 s with caches warm | Keeps PR review unblocked; the team is 3 devs sharing the queue. |
| Caching | `actions/cache` keyed on `requirements.lock.txt` + `package-lock.json` hashes | Pip+npm install dominates cold-start; cache restore is the single biggest win. |
| Pre-commit framework | `pre-commit ≥ 3.7` (Python) | Standard, well-maintained, language-agnostic. |
| Action pinning policy | Every `uses:` pinned to a full commit SHA, with a comment for the version tag | Supply-chain mitigation — a tag move is a silent re-deployment of someone else's code into our CI runner. |
| Permissions | Workflow-level `permissions: contents: read` only | Default-deny; only the secret-leak job *might* need `pull-requests: write` for a comment summary, and even that is post-MVD. |

---

## 5. Step-by-Step Implementation

### 5.1 The shared secret-boundary script

This is the single source of truth for the AUTH-05 invariant. The verify-on-VPS path already greps for it (INF-04 §5.16); pre-commit and CI now call the same script so the rule is defined once.

[scripts/check-secrets-boundary.sh](../../scripts/check-secrets-boundary.sh):

```bash
#!/usr/bin/env bash
# check-secrets-boundary.sh — enforces PRD §7.1 AUTH-05:
#   1. The Supabase service-role key + JWT secret never appear in any path the
#      browser can reach (frontend/, nginx/).
#   2. Frontend-only `NEXT_PUBLIC_*` env names never appear in backend Python.
#   3. No literal JWT-looking blobs (eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...) are
#      committed outside *.env.example.
#
# Exit 0 on clean; exit 1 on any violation, with a precise file:line list.
# Callable from pre-commit, GitHub Actions, and infra/scripts/verify.sh.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fails=0

note() { printf '  \033[1;31m✗\033[0m %s\n' "$1"; fails=$((fails+1)); }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }

# (1) service-role / JWT-secret names must not appear in frontend or nginx.
if grep -RIn -E 'SUPABASE_SERVICE_ROLE_KEY|SUPABASE_JWT_SECRET' \
       "$ROOT/frontend" "$ROOT/nginx" \
       --exclude-dir=node_modules --exclude-dir=.next \
       --exclude='*.env.example' 2>/dev/null | grep -v ':[[:space:]]*//\|:[[:space:]]*#'; then
    note "service-role / JWT-secret names found under frontend/ or nginx/"
else
    ok  "no service-role / JWT-secret names under frontend/ or nginx/"
fi

# (2) NEXT_PUBLIC_ must not appear in backend Python.
if grep -RIn 'NEXT_PUBLIC_' "$ROOT/backend" --include='*.py' 2>/dev/null; then
    note "NEXT_PUBLIC_ reference found in backend/*.py"
else
    ok  "no NEXT_PUBLIC_ references in backend/*.py"
fi

# (3) Literal Supabase-shaped JWT prefix anywhere outside *.env.example.
if grep -RIn 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' "$ROOT" \
       --exclude-dir=node_modules --exclude-dir=.next \
       --exclude-dir=.venv --exclude-dir=__pycache__ \
       --exclude-dir=.git --exclude='*.env.example' 2>/dev/null; then
    note "literal JWT prefix committed outside *.env.example"
else
    ok  "no committed JWT-looking blobs outside *.env.example"
fi

exit $(( fails > 0 ))
```

Make it executable and idempotent:

```bash
chmod +x scripts/check-secrets-boundary.sh
./scripts/check-secrets-boundary.sh   # should print 3 ✓ and exit 0
```

Then **shrink** the equivalent block in [infra/scripts/verify.sh](../../infra/scripts/verify.sh) (INF-04 §5.16) to a single `check "AUTH-05 boundary clean" bash "$SCRIPT_DIR/../../scripts/check-secrets-boundary.sh"` line, removing the duplicated greps. One rule, one place.

### 5.2 GitHub Actions workflow

[.github/workflows/ci.yml](../../.github/workflows/ci.yml):

```yaml
# VitaChain — CI (INF-05). One workflow, multiple jobs, path-filtered.
# Pin every action to a full commit SHA — tag moves are silent re-deploys.

name: ci

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # -------------------------------------------------------------------------
  # Path filter — every domain job gates on the matching subtree changing.
  # The secret-leak job intentionally has no filter (always runs).
  # -------------------------------------------------------------------------
  changes:
    runs-on: ubuntu-24.04
    outputs:
      frontend: ${{ steps.filter.outputs.frontend }}
      backend:  ${{ steps.filter.outputs.backend }}
      db:       ${{ steps.filter.outputs.db }}
      infra:    ${{ steps.filter.outputs.infra }}
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - id: filter
        uses: dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36 # v3.0.2
        with:
          filters: |
            frontend:
              - 'frontend/**'
              - '.github/workflows/ci.yml'
            backend:
              - 'backend/**'
              - '.github/workflows/ci.yml'
            db:
              - 'db/**'
              - 'supabase/**'
              - '.github/workflows/ci.yml'
            infra:
              - 'infra/**'
              - 'nginx/**'
              - '.github/workflows/ci.yml'

  # -------------------------------------------------------------------------
  # FRONTEND — npm ci → lint → typecheck → build → docker build (no push).
  # -------------------------------------------------------------------------
  frontend:
    needs: changes
    if: ${{ needs.changes.outputs.frontend == 'true' }}
    runs-on: ubuntu-24.04
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af # v4.1.0
        with:
          node-version: '20.x'
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci --no-audit --no-fund
      - run: npm run lint
      - run: npm run typecheck
      - name: build
        env:
          # Build-time placeholders so `next build` doesn't 500 on missing
          # NEXT_PUBLIC_* (real values only matter at runtime / on the VPS).
          NEXT_PUBLIC_SUPABASE_URL: https://ci.example.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-placeholder-anon
        run: npm run build
      - name: docker build (no push)
        run: docker build -t vitachain/frontend:ci .

  # -------------------------------------------------------------------------
  # BACKEND — pip install --require-hashes → ruff → ruff format --check
  #         → pytest → docker build (no push).
  # -------------------------------------------------------------------------
  backend:
    needs: changes
    if: ${{ needs.changes.outputs.backend == 'true' }}
    runs-on: ubuntu-24.04
    defaults: { run: { working-directory: backend } }
    env:
      # Tests load Settings(); these are placeholders — no live calls.
      SUPABASE_URL: https://ci.example.supabase.co
      SUPABASE_SERVICE_ROLE_KEY: ci-placeholder-service-role
      SUPABASE_JWT_SECRET: ci-placeholder-jwt-secret-min-32-bytes-XXX
      ENVIRONMENT: ci
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-python@0b93645e9fea7318ecaed2b359559ac225c90a2b # v5.3.0
        with:
          python-version: '3.12'
          cache: pip
          cache-dependency-path: backend/requirements.lock.txt
      - run: pip install --require-hashes -r requirements.lock.txt
      - run: pip install ruff
      - run: ruff check app tests
      - run: ruff format --check app tests
      - run: pytest
      - name: docker build (no push)
        run: docker build -t vitachain/backend:ci .

  # -------------------------------------------------------------------------
  # DB — replay every migration against a throw-away Postgres 17 service.
  # Catches "works on Supabase, not on a fresh DB" drift early. Mirrors the
  # `make -C db verify` invariants but runs without touching the live project.
  # -------------------------------------------------------------------------
  db:
    needs: changes
    if: ${{ needs.changes.outputs.db == 'true' }}
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: vita
          POSTGRES_PASSWORD: vita
          POSTGRES_DB: vita
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U vita"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      DB_URL: postgres://vita:vita@localhost:5432/vita
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - name: install psql client
        run: sudo apt-get update && sudo apt-get install -y postgresql-client
      - name: apply migrations
        run: make -C db push
      - name: verify
        run: make -C db verify
        # The 0005 RLS-recursion-fix migration must apply cleanly on top of
        # 0001..0004 — this is the regression gate AUTH-07 will lean on.

  # -------------------------------------------------------------------------
  # INFRA — yamllint, hadolint, shellcheck, nginx -t (in container).
  # -------------------------------------------------------------------------
  infra:
    needs: changes
    if: ${{ needs.changes.outputs.infra == 'true' }}
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - name: yamllint
        run: |
          pipx install yamllint
          yamllint -c .yamllint.yml \
            infra/docker-compose.yml infra/compose.smoke.yml \
            .github/workflows/ docs/spring-status.yml
      - name: hadolint
        uses: hadolint/hadolint-action@54c9adbab1582c2ef04b2016b760714a4bfde3cf # v3.1.0
        with:
          dockerfile: backend/Dockerfile
          recursive: true
      - name: shellcheck
        run: |
          sudo apt-get update && sudo apt-get install -y shellcheck
          shellcheck infra/scripts/*.sh db/scripts/*.sh scripts/*.sh
      - name: nginx -t
        run: |
          docker run --rm \
            -v "$PWD/nginx/conf.d:/etc/nginx/conf.d:ro" \
            -v "$PWD/infra/nginx/conf.d:/etc/nginx/extra-conf.d:ro" \
            nginx:1.27-alpine nginx -t

  # -------------------------------------------------------------------------
  # SECRET-LEAK — always runs, never skipped. The AUTH-05 invariant + gitleaks.
  # -------------------------------------------------------------------------
  secret-leak:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with: { fetch-depth: 0 }   # gitleaks needs history
      - name: AUTH-05 boundary
        run: bash scripts/check-secrets-boundary.sh
      - name: gitleaks
        uses: gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7 # v2.3.7
        env:
          GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}   # only needed for orgs
        with:
          config-path: .gitleaks.toml

  # -------------------------------------------------------------------------
  # Required-checks aggregate — branch protection points to THIS job, so we
  # can change the matrix above without re-clicking the GitHub UI each time.
  # -------------------------------------------------------------------------
  ci-required:
    if: always()
    needs: [changes, frontend, backend, db, infra, secret-leak]
    runs-on: ubuntu-24.04
    steps:
      - name: assert all required jobs succeeded or were skipped cleanly
        run: |
          set -e
          for j in frontend backend db infra secret-leak; do
            r=$(jq -r --arg j "$j" '.[$j].result' <<< '${{ toJson(needs) }}')
            if [ "$r" != "success" ] && [ "$r" != "skipped" ]; then
              echo "::error::job $j ended with result=$r"
              exit 1
            fi
          done
          echo "all required jobs OK"
```

> **Why one workflow file instead of four?** Path-filtered jobs in a single workflow share the `changes` output for free, render as one PR check section, and give us **one** branch-protection target (`ci-required`). Splitting into four files would multiply the boilerplate without buying anything.

### 5.3 yamllint + gitleaks configs

[.yamllint.yml](../../.yamllint.yml):

```yaml
# Modest rules — we're not policing line length, only catching genuine breakage.
extends: default
rules:
  line-length: disable
  truthy:
    allowed-values: ['true', 'false']
    check-keys: false
  comments:
    min-spaces-from-content: 1
  document-start: disable
  indentation:
    spaces: 2
    indent-sequences: consistent
```

[.gitleaks.toml](../../.gitleaks.toml):

```toml
# Inherit the upstream ruleset, then carve out our known-safe placeholders.
title = "VitaChain leak policy"

[extend]
useDefault = true

[[allowlist]]
description = "Documentation and templates may show shaped values."
paths = [
    '''.env\.example''',
    '''docs/.*\.md''',
    '''Documents/.*\.md''',
]

[[allowlist]]
description = "CI placeholder values used only inside the workflow."
regexes = [
    '''ci-placeholder-[a-z0-9-]+''',
    '''https://ci\.example\.supabase\.co''',
]
```

### 5.4 Pre-commit configuration

[.pre-commit-config.yaml](../../.pre-commit-config.yaml):

```yaml
# Pre-commit — runs the cheap subset of CI locally before the commit lands.
# Same tools as CI, same configs, same exit codes. Heavy jobs (next build,
# docker build, db replay) stay in CI; pre-commit is for "would have failed
# fast anyway" feedback.
#
# One-time setup:    pre-commit install && pre-commit install --hook-type pre-push
# Run against repo:  pre-commit run --all-files

minimum_pre_commit_version: '3.7.0'

default_install_hook_types: [pre-commit, pre-push]
default_stages: [pre-commit]

repos:
  # -- Standard hygiene -------------------------------------------------------
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v5.0.0
    hooks:
      - id: end-of-file-fixer
      - id: trailing-whitespace
      - id: mixed-line-ending
        args: ['--fix=lf']
        exclude: '\.bat$|\.ps1$'
      - id: check-merge-conflict
      - id: check-added-large-files
        args: ['--maxkb=2048']    # PRD BR-F2 — 2 MB per photo
      - id: detect-private-key
      - id: check-yaml
        args: ['--unsafe']         # allow GH Actions !!str tags
      - id: check-json
      - id: check-toml

  # -- Python (backend) -------------------------------------------------------
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.7.4
    hooks:
      - id: ruff
        args: ['--fix']
        files: '^backend/'
      - id: ruff-format
        files: '^backend/'

  # -- Shell ------------------------------------------------------------------
  - repo: https://github.com/koalaman/shellcheck-precommit
    rev: v0.10.0
    hooks:
      - id: shellcheck

  # -- Dockerfiles ------------------------------------------------------------
  - repo: https://github.com/hadolint/hadolint
    rev: v2.13.0-beta
    hooks:
      - id: hadolint-docker
        # Pinned to backend + frontend Dockerfiles; the smoke compose has none.

  # -- YAML -------------------------------------------------------------------
  - repo: https://github.com/adrienverge/yamllint
    rev: v1.35.1
    hooks:
      - id: yamllint
        args: ['-c', '.yamllint.yml']
        files: '\.(yml|yaml)$'

  # -- Local hooks (no upstream repo) ----------------------------------------
  - repo: local
    hooks:
      - id: auth-05-boundary
        name: AUTH-05 — service-role / JWT / NEXT_PUBLIC_ boundary
        entry: bash scripts/check-secrets-boundary.sh
        language: system
        pass_filenames: false
        always_run: true

      - id: frontend-lint
        name: frontend — eslint (changed files only)
        entry: bash -c 'cd frontend && npx eslint --max-warnings=0 "$@"' --
        language: system
        files: '^frontend/.*\.(ts|tsx)$'
        require_serial: true

      - id: frontend-typecheck
        # Heavier — runs on pre-push, not every commit.
        name: frontend — tsc --noEmit
        entry: bash -c 'cd frontend && npm run typecheck'
        language: system
        pass_filenames: false
        stages: [pre-push]
        files: '^frontend/'

      - id: backend-pytest
        # Heavier — runs on pre-push, not every commit.
        name: backend — pytest
        entry: bash -c 'cd backend && . .venv/Scripts/activate 2>/dev/null || . .venv/bin/activate; pytest -q'
        language: system
        pass_filenames: false
        stages: [pre-push]
        files: '^backend/'
```

> **Why split pre-commit vs pre-push?** ruff/shellcheck/eslint are sub-second; running them on every commit is free. `tsc --noEmit` and `pytest` are seconds to tens of seconds — paying that on every `git commit -m` makes contributors disable hooks. Pre-push gives the same gate at a saner frequency.

### 5.5 Top-level Makefile

[Makefile](../../Makefile) (new — repo root):

```makefile
# VitaChain — top-level entrypoints. The per-tree Makefiles (backend/, db/,
# infra/) remain the canonical command surfaces; these targets just fan out.

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

.PHONY: help ci-local hooks-install hooks-run hooks-update secrets-check

help:  ## Show this help
	@awk 'BEGIN{FS=":.*##"; printf "Targets:\n"} \
	      /^[a-zA-Z_-]+:.*##/{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

hooks-install:    ## One-time: install pre-commit + pre-push hooks
	pipx install pre-commit || pip install --user pre-commit
	pre-commit install
	pre-commit install --hook-type pre-push

hooks-run:        ## Run every pre-commit hook against the whole tree
	pre-commit run --all-files

hooks-update:     ## Bump pinned hook revs (review carefully)
	pre-commit autoupdate

secrets-check:    ## Run only the AUTH-05 boundary script
	bash scripts/check-secrets-boundary.sh

ci-local:         ## Run the same checks CI runs, in roughly the same order
	@echo "==> secret-leak"
	@bash scripts/check-secrets-boundary.sh
	@echo "==> backend"
	@$(MAKE) -C backend lint test
	@echo "==> frontend"
	@cd frontend && npm run lint && npm run typecheck && npm run build
	@echo "==> infra: shellcheck + nginx -t"
	@shellcheck infra/scripts/*.sh db/scripts/*.sh scripts/*.sh
	@$(MAKE) -C infra nginx-test
	@echo "all green"
```

### 5.6 CONTRIBUTING entry

[CONTRIBUTING.md](../../CONTRIBUTING.md) (new — repo root, minimal):

```markdown
# Contributing

## One-time setup

```bash
make hooks-install     # installs pre-commit + pre-push hooks
make -C backend install # python venv + deps
cd frontend && npm ci   # node deps
```

## The CI gate

Every PR runs `ci.yml` — five jobs (`frontend`, `backend`, `db`, `infra`,
`secret-leak`) gated by `ci-required`. Run them locally before pushing:

```bash
make ci-local
```

If `secret-leak` fails:

```bash
make secrets-check     # exact same script the CI runs
```

The AUTH-05 invariant — service-role/JWT secret never in the frontend,
`NEXT_PUBLIC_*` never in the backend — is enforced by [scripts/check-secrets-boundary.sh](scripts/check-secrets-boundary.sh)
and called from pre-commit, pre-push, CI, and `infra/scripts/verify.sh`.

## Branch protection

Required status check: `ci-required`. See [docs/runbook.md](docs/runbook.md)
for the GitHub UI walkthrough.
```

### 5.7 Runbook entry — branch protection

Append a new section to [docs/runbook.md](../runbook.md):

```markdown
## INF-05 — Branch protection (one-time, by repo admin)

Settings → Branches → Add rule for `main`:

- [x] Require a pull request before merging
- [x] Require status checks to pass before merging
  - [x] Require branches to be up to date before merging
  - [x] Required status checks:
    - `ci-required`        ← the only one to tick; aggregates the rest.
- [x] Require linear history
- [x] Do not allow bypassing the above settings (admins included)

After enabling, push a one-line README change on a branch and confirm the
PR shows `ci-required` as a required check that must turn green before merge.
```

### 5.8 Dotfiles polish

Append to the repo-root [.gitignore](../../.gitignore) (one extra block):

```
# pre-commit cache
.pre-commit-cache/

# CI-local artefacts
ci-local.log
```

---

## 6. Verification Checklist

### Local (developer laptop)

- [ ] `make hooks-install` runs once, succeeds, and writes `.git/hooks/pre-commit` + `.git/hooks/pre-push`.
- [ ] `make hooks-run` (≈ `pre-commit run --all-files`) completes with zero findings on `main`.
- [ ] `make secrets-check` prints three ✓ lines and exits 0.
- [ ] Introduce a deliberate violation — paste `SUPABASE_SERVICE_ROLE_KEY=...` into `frontend/src/lib/test.ts`, run `make secrets-check` → exits 1 with the file:line. Revert.
- [ ] `make ci-local` is green end-to-end on `main`.
- [ ] Try to commit a 3 MB file in `frontend/public/` — `check-added-large-files` blocks at 2048 KB. Drop the file.
- [ ] Try to commit a file with `print("debug")` in `backend/app/main.py` — ruff `T20` blocks (already configured in INF-04's pyproject). Revert.

### GitHub Actions — first PR

- [ ] Push the `inf-05/ci-pipeline` branch; open a PR against `main`.
- [ ] PR shows six checks: `ci / changes`, `ci / frontend`, `ci / backend`, `ci / db`, `ci / infra`, `ci / secret-leak`, plus the aggregate `ci / ci-required`.
- [ ] All six are green within 5 min on a cold cache.
- [ ] Re-run the same workflow without changes — wall-clock drops below 90 s (cache hits visible in each step's "post" log).
- [ ] Edit only `frontend/README.md` — only `frontend` and `secret-leak` run; `backend`, `db`, `infra` show as skipped (not failed). `ci-required` is still green.
- [ ] Edit only `backend/app/main.py` — only `backend` + `secret-leak` run.
- [ ] Edit a new file `db/migrations/9999_test.sql` containing `SELECT 1;` — `db` job runs `push.sh` against the postgres service container and verify, both succeed. Delete the test migration.

### Negative — the gate actually blocks

- [ ] On a branch, paste a Supabase-shaped JWT (`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx.yyyyy`) into `frontend/src/app/page.tsx`, push. CI's `secret-leak` job fails red; the PR cannot be merged once branch protection is on. Revert.
- [ ] On a branch, add an unused import to `backend/app/main.py`. `ruff` (F401) fires in CI. Revert.
- [ ] On a branch, break `frontend/src/app/page.tsx` syntax. `npm run typecheck` fires in CI. Revert.
- [ ] On a branch, add a malformed SQL line to `db/migrations/0006_test.sql`. `make -C db push` fails inside the CI postgres service. Delete.

### Branch protection — after the admin enables it

- [ ] On a branch, manually fail one of the jobs (e.g. push a ruff violation). The PR `Merge` button is disabled with "Required status check has failed".
- [ ] Fix the violation. The button re-enables once `ci-required` flips to green.

---

## 7. Deliverables

| Artifact | Location |
|---|---|
| CI workflow | [.github/workflows/ci.yml](../../.github/workflows/ci.yml) |
| yamllint config | [.yamllint.yml](../../.yamllint.yml) |
| gitleaks config | [.gitleaks.toml](../../.gitleaks.toml) |
| Pre-commit config | [.pre-commit-config.yaml](../../.pre-commit-config.yaml) |
| Shared boundary script | [scripts/check-secrets-boundary.sh](../../scripts/check-secrets-boundary.sh) |
| Top-level Makefile | [Makefile](../../Makefile) |
| Contributor onboarding | [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| `.gitignore` extension | [.gitignore](../../.gitignore) (`.pre-commit-cache/`, `ci-local.log`) |
| Runbook entry | "INF-05 — Branch protection" section in [docs/runbook.md](../runbook.md) |
| verify.sh slim-down | Replace the inlined AUTH-05 greps with one call to `scripts/check-secrets-boundary.sh` in [infra/scripts/verify.sh](../../infra/scripts/verify.sh) |
| `spring-status.yml` update | Flip `INF-05.status` → `DONE`; bump `summary.done`; decrement `summary.todo`; hand-off line under `project.last_updated` |

---

## 8. Risks & Mitigations

| Risk | Mitigation | Source |
|---|---|---|
| A green CI hides a regression because path filters skipped the affected job | `ci-required` aggregates `result` of every job and fails unless each is `success` **or** `skipped` — and a job is `skipped` only when its filter says zero files in that tree changed, which is exactly when there's nothing to regress | §5.2 `ci-required` step |
| GitHub Actions free minutes blown by an unbounded retry loop on a flaky test | Concurrency `cancel-in-progress: true` plus the cheap caches keep cold runs ≤ 5 min × ≈ 30 PRs/8 weeks ≈ 150 min — well under the 2000 min budget | §4 wall-clock target |
| `pip install --require-hashes` fails on a transitive dep mismatch between OSes | Lockfile is regenerated under Linux (CI matches dev `Dockerfile` base); developer laptops install via the same `backend/Makefile install` target so the venv hashes line up | INF-04 §5.13 |
| `pre-commit` autoupdate silently bumps a hook to a malicious release | `make hooks-update` is opt-in; every pinned `rev:` is reviewable in PR diff; CI re-runs the same versions because pre-commit caches by rev | §5.4 versions |
| Action supply-chain compromise via a moved tag (e.g. `actions/checkout@v4`) | Every `uses:` pinned to a 40-char SHA; comment carries the tag for readability | §4 pinning policy |
| Developer disables pre-commit ("too slow") | Heavy hooks (`tsc`, `pytest`) demoted to `pre-push` only; light hooks (ruff, eslint on changed files) stay on `pre-commit`. CI is the authoritative gate regardless | §5.4 split |
| `db` job leaks the live Supabase ref by misreading `db/.env` | The CI step exports `DB_URL` *before* `make -C db push` runs; `db/Makefile` reads `DB_URL` from env first; production `db/.env` is in `.gitignore` and never reaches the runner | §5.2 db job env |
| Branch protection not enabled because admin missed the runbook step | DoD §10 includes a one-line manual check; `ci-required` is also called out in CONTRIBUTING.md so the next developer notices | §10 + §5.6 |
| First PR's frontend `next build` fails on missing `NEXT_PUBLIC_*` (build-time eval of `process.env`) | CI exports placeholder values in `env:`; real values only matter at runtime on the VPS — INF-03 already separates build-time from runtime in `frontend/Dockerfile` | §5.2 frontend build step |
| `gitleaks-action` requires a license for org private repos | The license-protected feature is the dashboard; the CLI scan still runs without the license. If we go private later, set `GITLEAKS_LICENSE` in repo secrets | §5.2 secret-leak job |

---

## 9. Time Estimate

| Sub-task | Estimate |
|---|---|
| Shared `check-secrets-boundary.sh` + verify.sh slim-down | 30 min |
| `.github/workflows/ci.yml` — five jobs + aggregator | 90 min |
| `.yamllint.yml` + `.gitleaks.toml` | 20 min |
| `.pre-commit-config.yaml` with pre-commit/pre-push split | 45 min |
| Top-level `Makefile` (`hooks-*`, `ci-local`, `secrets-check`) | 20 min |
| `CONTRIBUTING.md` + runbook branch-protection entry | 20 min |
| First-PR smoke (open dummy PR, watch all jobs go green, exercise negative paths) | 60 min |
| Cache-warm second-run timing measurement | 15 min |
| `spring-status.yml` update + hand-off line | 10 min |
| **Total active work** | **~5 h** |

---

## 10. Definition of Done

1. **Acceptance criterion met:** opening a pull request against `main` triggers the `ci` workflow, every required job runs (or is cleanly skipped via path filter), `ci-required` reports green, and `secret-leak` ran. The PRD §12 wording — *"First PR triggers lint + unit tests"* — is satisfied **and** exceeded with the AUTH-05 boundary + db replay + infra lint.
2. Verification checklist (§6) fully ticked: local, CI happy-path, CI negative-path, and the post-branch-protection block.
3. Deliverables (§7) committed under `.github/`, `scripts/`, repo root, and `docs/`.
4. [docs/spring-status.yml](../spring-status.yml) updated: `INF-05.status: DONE`, `summary.done` incremented, `summary.todo` decremented, hand-off line added under `project.last_updated` in the same style as the INF-02/INF-03/INF-04 entries.
5. Branch-protection rule on `main` enabled by the repo admin (one-shot manual step from the runbook); a follow-up PR confirms `ci-required` is the required check.
6. Hand-off note posted to the team channel naming the unblocked stories: **AUTH-05** (the isolation invariant is now a merge-blocking check, not just a runtime probe), **AUTH-07** (RLS test suite will hang off the `backend` and `db` jobs without any workflow surgery), and the general "every downstream story" — from now on, no `Must` priority work merges without lint + tests passing.

---

## 11. Hand-off — (to be filled on completion)

### 11.1 What landed

*(Mirror INF-04 §11.1: list of new files under `.github/`, `scripts/`, root, `docs/`; summary of the `verify.sh` slim-down diff; the exact GitHub run URL for the first all-green PR.)*

### 11.2 Verification evidence

*(Paste: `make hooks-run` output on clean tree; `make ci-local` output on clean tree; screenshot/URL of the first PR's six green checks; the negative-test PRs that turned red on a planted JWT and a planted ruff violation, then green after revert; final wall-clock times for cold and warm caches.)*

### 11.3 What's *not* covered (and why that's fine for DoD)

- **Continuous deployment** on green main → out of scope; cadence is too low for the MVD. The `make -C infra deploy` script remains the manual deploy path.
- **Coverage thresholds** → AUTH-07 lands real tests; thresholds become meaningful then.
- **CodeQL / Dependabot** → Phase 3 (`INF-08` / `AUTH-07` window).
- **i18n hardcoded-string lint** → I18N-01.

### 11.4 Stories now unblocked

| Story | Why |
|---|---|
| **AUTH-05** | The service-role / JWT / `NEXT_PUBLIC_` boundary is now a merge-blocking check via `scripts/check-secrets-boundary.sh`, not just a runtime greps in `verify.sh`. |
| **AUTH-07** | The `backend` job already runs `pytest`; the upcoming RLS regression suite plugs in as `tests/test_rls_*.py` with no workflow change. The `db` job already replays migrations on a fresh PG17 — the same harness the RLS tests will use. |
| **Every downstream Must story (KAT-*, FAR-*, SEC-*, BOT-*, NOT-*, ADM-*)** | Each ships behind lint + tests + secret-leak gates. No Week-7 "where did this regression come from?" debugging. |
| **INF-08** | Sentry release tagging can later be wired into the `backend` job as one more step (`sentry-cli releases new $GIT_SHA && sentry-cli releases finalize $GIT_SHA`); the env is already there. |

### 11.5 Known follow-ups (not part of INF-05)

- Add **Dependabot** config (`.github/dependabot.yml`) once the dep surface settles (≈ W4). Pin auto-merge to `patch` only; require all CI checks to pass.
- Promote `gitleaks` to a `paid` license tier *only if* we switch the repo to private under a GitHub org plan (PRD doesn't require it).
- Once `AUTH-07` lands real RLS tests, raise `pytest` minimum coverage from "no floor" to `--cov-fail-under=70` for `backend/app/modules/`.
- Add a `release` workflow (manual `workflow_dispatch`) that tags a commit + builds + pushes images to GHCR — gated behind the demo decision in Phase 4.

### 11.6 Operator runbook (when the GitHub repo exists)

```bash
# On the repo admin's laptop, from repo root:
git init                                  # if not already
git remote add origin git@github.com:<org>/vitachain.git
git add -A && git commit -m "chore(inf-05): CI pipeline + pre-commit (INF-05)"
git push -u origin main

# Open the repo in GitHub → Settings → Branches → enable the rule
# documented in docs/runbook.md "INF-05 — Branch protection".

# Smoke (every contributor):
make hooks-install        # one-time
make ci-local             # before pushing
git push <branch>         # GitHub Actions takes it from here

# On red CI:
make secrets-check        # AUTH-05 alone
make -C backend lint test # backend alone
cd frontend && npm run lint && npm run typecheck && npm run build
```

When the first PR turns green with all six checks ticked, no further INF-05 work remains.
