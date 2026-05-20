# Contributing to VitaChain

Welcome. Read [Documents/VitaChain_PRD.md](Documents/VitaChain_PRD.md) for the product
contract and [docs/spring-status.yml](docs/spring-status.yml) for the live sprint
board. This file is the one-pager for running the toolchain locally.

---

## One-time setup

```bash
# 1) Hooks — runs the cheap CI subset on every commit / pre-push.
make hooks-install

# 2) Backend — Python 3.12 venv + pinned deps.
make -C backend install

# 3) Frontend — Node 20 + pinned deps.
cd frontend && npm ci && cd -

# 4) DB env (Bitwarden: VitaChain — Supabase keys).
cp db/.env.example         db/.env         && $EDITOR db/.env
cp backend/.env.example    backend/.env    && $EDITOR backend/.env
cp frontend/.env.example   frontend/.env.local && $EDITOR frontend/.env.local
cp infra/.env.example      infra/.env      && $EDITOR infra/.env
```

---

## The CI gate

Every PR to `main` runs [.github/workflows/ci.yml](.github/workflows/ci.yml) — five jobs
gated by a single aggregate check `ci-required`:

| Job | What it runs | Trigger |
|---|---|---|
| `frontend`   | `npm ci` → `lint` → `typecheck` → `build` → `docker build` | `frontend/**` changed |
| `backend`    | `pip install --require-hashes` → `ruff check` → `ruff format --check` → `pytest` → `docker build` | `backend/**` changed |
| `db`         | spins `postgres:17` service, replays every `db/migrations/*.sql`, runs `make -C db verify` | `db/**` or `supabase/**` changed |
| `infra`      | `yamllint` + `hadolint` + `shellcheck` + `nginx -t` (in container) | `infra/**` or `nginx/**` changed |
| `secret-leak`| `scripts/check-secrets-boundary.sh` + `gitleaks` | always (no filter) |

Run the same checks locally before pushing:

```bash
make ci-local
```

If a single piece fails, run only that piece:

```bash
make secrets-check                        # AUTH-05 boundary alone
make -C backend lint test                 # backend alone
cd frontend && npm run lint && npm run typecheck && npm run build
make -C infra nginx-test                  # nginx vhost syntax alone
```

---

## The AUTH-05 invariant

PRD §7.1 AUTH-05 — the Supabase **service-role key** and **JWT secret** never
leak to the browser; the frontend's `NEXT_PUBLIC_*` env names never leak into
backend Python. This is enforced **once**, by [scripts/check-secrets-boundary.sh](scripts/check-secrets-boundary.sh),
called from four places:

- the **pre-commit hook** (every commit),
- the **pre-push hook** (every push),
- the `secret-leak` **CI job** (every PR + every push to `main`),
- [infra/scripts/verify.sh](infra/scripts/verify.sh) (every VPS deploy).

If you see the boundary fail, do not "fix" it by editing the script — fix the
leak, or, if it is a legitimate documentation reference, allowlist the path
in [.gitleaks.toml](.gitleaks.toml).

---

## Branch protection

Required status check on `main`: `ci-required`. See the runbook entry
[docs/runbook.md → INF-05 — Branch protection](docs/runbook.md) for the
admin walkthrough.

---

## Pre-commit vs pre-push

Sub-second tools (ruff, eslint, shellcheck, hadolint, yamllint, hygiene) run
on every `git commit`. Heavy tools (`tsc --noEmit`, `pytest`) run on `git
push` instead — they would be too slow on every commit, and contributors
would disable them. CI is the authoritative gate either way.

Skip a hook deliberately (CI will still catch it):

```bash
git commit -m '...' --no-verify        # skip pre-commit
git push --no-verify                   # skip pre-push
```

---

## Story-driven workflow

Work is broken down in [docs/stories/](docs/stories/). Each story has its
own implementation guide with §6 Verification Checklist and §10 Definition
of Done. PR titles reference the story id: `feat(KAT-03): IoT ingestion endpoint`.

---

## Help

| Question | Where |
|---|---|
| Sprint status | [docs/spring-status.yml](docs/spring-status.yml) |
| Operations / rotation / rollback | [docs/runbook.md](docs/runbook.md) |
| Product / module scope | [Documents/VitaChain_PRD.md](Documents/VitaChain_PRD.md) |
| Per-story implementation guides | [docs/stories/](docs/stories/) |
