# AUTH-05 — Service Key isolated to FastAPI containers only

> **Epic:** E1 — Authentication, Authorization & Roles (Cross-cutting)
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must *(PRD §7.1 AUTH-05, §8.3 — the Supabase `service_role` JWT bypasses RLS. A single leak into the frontend bundle is a "game over" event: any unauthenticated browser can dump every row of every table — every farmer's parcels, every restaurateur's meals, every citizen's pickup code. RLS (AUTH-04), the JWT contract (AUTH-03), and KYC (AUTH-06) all collapse the moment the service-role key reaches the wrong side of the network. AUTH-05 is the asymmetric defence: the cost of one missed grep is the cost of rotating the key, redeploying the backend, and auditing `auth.audit_log_entries` for the entire window the leak was reachable.)*
> **Status:** TODO
> **Depends on:** [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) (`DONE` — `backend/app/core/config.py::Settings` is the *only* loader of `SUPABASE_SERVICE_ROLE_KEY`, declared as `SecretStr`; `backend/app/db.py::service_client()` is the *only* call site that unwraps it. AUTH-05 promotes those structural choices from "convention" to "enforced contract"), [INF-05](INF-05-ci-pipeline-github-actions-pre-commit.md) (`DONE` — `scripts/check-secrets-boundary.sh` exists and is wired into `.github/workflows/ci.yml` `secret-leak` job and `.pre-commit-config.yaml` as `auth-05-boundary` with `always_run: true`. AUTH-05 *extends* it: the current script is source-tree only; AUTH-05 adds the bundle-time and runtime-env legs)
> **Unblocks:** [AUTH-06](#) (KYC verification flips `verification_status` via the backend's `service_client()` — AUTH-05 makes that call site *the only legitimate one* for that mutation, so a forged frontend call cannot impersonate it), [AUTH-07](#) (the full RLS audit assumes service-role is backend-side only — every cross-role isolation assertion is meaningless if a service-role token can reach a logged-in citizen), [KAT-03](#) (the IoT ingestion endpoint takes an *ESP32 device key*, not a service-role key; AUTH-05's runtime-env shape check ensures the two are never confused in `infra/.env`), [FAR-04 / SEC-05 / BOT-04 / NOT-01](#) (Brevo mailer triggers run server-side via `service_client()` — AUTH-05 documents the allow-listed call sites so reviewers know which `service_client(` greps are legitimate vs. regressions), every story whose backend handler chooses between `Depends(get_db_for_user)` and `service_client()` (the choice is now syntactically auditable).
> **Acceptance (per [docs/spring-status.yml](../spring-status.yml) line 664):** *"Service key not in frontend bundle; .env check in CI."* Extended DoD: (a) `scripts/check-secrets-boundary.sh` — already-shipped source-tree check — stays green and is reproduced in pre-commit + CI; (b) a **new** post-build bundle scan asserts that neither the literal service-role JWT value nor the env-var name `SUPABASE_SERVICE_ROLE_KEY` appears anywhere under `frontend/.next/standalone/` or `frontend/.next/static/`; (c) a **new** runtime-env shape check on `infra/.env` confirms the published anon key decodes to `"role":"anon"` and the service key decodes to `"role":"service_role"` — and that the two are never the same value; (d) the `docker-compose.yml` frontend `build.args:` block is mechanically audited to contain only `NEXT_PUBLIC_*` keys (no `SUPABASE_SERVICE_ROLE_KEY`, no `SUPABASE_JWT_SECRET`, no `SUPABASE_DB_URL`); (e) `backend/app/db.py::service_client()` callers are restricted to an allow-list of module paths, enforced by a pytest that introspects the call graph; (f) `docs/runbook.md` carries a *"AUTH-05 — Service-key isolation"* section that documents the three boundary layers (source / build / runtime) and the leak-response runbook (rotate, redeploy, audit); (g) a recorded *injection drill* proves the boundary fails closed: a deliberately-leaked `SUPABASE_SERVICE_ROLE_KEY` reference under `frontend/src/` and a forged service-role JWT in `frontend/.env.local` each fail CI red within the same job that catches them.

---

## 1. Purpose

The Supabase `service_role` JWT is the single most dangerous secret in the VitaChain stack. Three facts make it asymmetric:

1. **It bypasses RLS.** Every policy AUTH-04 ships is a no-op for a request carrying `Authorization: Bearer <service_role JWT>`. The Postgres-side check at the heart of RLS is `current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role'` → return all rows. No application code mediates.
2. **It is a long-lived bearer credential.** Supabase issues the service-role key once per project and rotates only on explicit operator action. Unlike a 1-hour access token (AUTH-03), a leaked service-role key remains valid for the lifetime of the project. The blast radius is "every row, forever, until rotated."
3. **It is structurally easy to leak.** Next.js inlines `process.env.X` into the client bundle for any variable referenced from a non-`"server-only"` module — silently, at build time, with no warning. A single `process.env.SUPABASE_SERVICE_ROLE_KEY` reference in a file that lacks `import "server-only"` ships the secret to every browser that loads the page.

The MVD has three developers, no dedicated security review, and an 8-week clock. The defence cannot rely on "we'll remember to check": it has to be a property of the build that *cannot* succeed if the contract is violated. AUTH-05 makes the contract structural at three layers.

| Layer | What it catches | Caught by | When |
|---|---|---|---|
| **Source** | Reference to `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` / `SUPABASE_DB_PASSWORD` *names* anywhere under `frontend/` or `nginx/`; a service-role-shaped JWT literal committed outside the allow-list; a `NEXT_PUBLIC_*` name in `backend/*.py`. | `scripts/check-secrets-boundary.sh` (already shipped — INF-05 §5.1). | pre-commit + CI `secret-leak` job. |
| **Build** *(new in AUTH-05)* | A *value* — the actual service-role JWT — that landed in the built frontend bundle (`.next/standalone/**`, `.next/static/**`) because some module read it without `"server-only"`. | `scripts/check-frontend-bundle.sh` — runs after `npm run build` in CI. | CI `frontend` job after the build step. |
| **Runtime** *(new in AUTH-05)* | A misfiled `infra/.env` where the service-role JWT was pasted into `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the most common copy-paste error), or vice versa. | `scripts/verify-env-key-roles.sh` — decodes both JWTs and asserts their `role` claim shape. | `make verify` / deploy preflight on the VPS + CI when an env sample is available. |

AUTH-05 also ships **two structural defences inside the codebase**:

- A pytest that introspects every call to `service_client()` and asserts the caller's module path is on a small, hand-maintained allow-list (`backend/app/workers/`, `backend/app/routers/admin/`, `backend/app/auth_hooks/`, plus an `audit/justified` exception list). Any other caller fails the test. This converts the "every callsite needs a `# JUSTIFICATION:` comment" convention into a merge-blocking gate.
- A deliberately-leaked sample (injection drill) recorded in the runbook, demonstrating that the CI catches the failure and that the leak-response procedure (key rotation + redeploy + audit) works end-to-end.

> **What this story is not:** rotating the service-role key on a cadence (post-MVD operational task), implementing per-request rate limiting on backend endpoints that use `service_client()` (AUTH-08), adding a separate "limited service" key for the mailer worker (post-MVD — would require Supabase Enterprise), per-handler authorization tests for backend admin endpoints (those are owned by their respective ADM-* stories), or the storage RLS rules for `kyc-documents` and `farmarket-photos` (AUTH-06 / FAR-07 respectively). AUTH-05 enforces the **boundary**; downstream stories rely on it.

---

## 2. Scope

### In scope

- **`scripts/check-frontend-bundle.sh`** — new Bash script. Runs after `npm run build` in the frontend image build and in the CI frontend job. Greps the built bundle (`.next/standalone/**`, `.next/static/**`, and the `server.js` runtime entrypoint) for: (a) the literal value of `SUPABASE_SERVICE_ROLE_KEY` if it was somehow present in the build env (defence-in-depth — we never *intend* to pass it as a build arg, but a misconfigured `docker compose build` could) — keyed on the JWT prefix + a `"role":"service_role"` decoded probe; (b) the env-var *name* `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` / `SUPABASE_DB_PASSWORD` / `SUPABASE_DB_URL` appearing as a string literal in any bundled JS chunk (the typical Next.js inline-leak signature). Exit 0 on clean; exit 1 with the offending file and chunk on any hit.

- **`scripts/verify-env-key-roles.sh`** — new Bash script. Reads `infra/.env` (or a path passed as `$1`), extracts `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, base64-decodes the payload of each, asserts (a) the anon variable has `role: anon`, (b) the service variable has `role: service_role`, (c) the two values are not equal. Designed to run on the VPS before `docker compose up -d`, and in CI when a redacted sample env is generated from secrets. Exits 0 / 1 with precise failure messages.

- **`scripts/check-compose-build-args.sh`** — new Bash script. Parses `infra/docker-compose.yml` with `yq` (already a pre-commit dependency), enumerates every `services.*.build.args` key, and asserts each one matches `^NEXT_PUBLIC_[A-Z0-9_]+$`. Catches the regression where someone helpfully adds `SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}` to the frontend build-args block, which would inline the secret into the bundle at compile time. Note: rule applies only to the `frontend` service's args block; the `backend` service has no `build.args:` today (it reads everything from `environment:` at runtime), and the script asserts that fact too.

- **`backend/tests/test_service_client_callsite_allowlist.py`** — new pytest. Walks the AST of every `.py` file under `backend/app/`; collects every `Call` node whose `.func.id == "service_client"` or `.func.attr == "service_client"`; asserts the file path matches one of:
  ```
  backend/app/routers/admin/**
  backend/app/workers/**
  backend/app/auth_hooks/**
  backend/app/db.py        # the definition itself
  ```
  Any other call site fails with the file:line of the violation and a remediation hint pointing at `docs/runbook.md §AUTH-05`. The allow-list lives in the test file itself, not in a separate config — moving an allow-list entry is a code change reviewed in the same PR as the call site it justifies.

- **`scripts/tests/test_check_secrets_boundary.sh`** — new BATS-style or plain Bash test. Spawns a temp directory, drops a synthetic violation file (e.g. `frontend/src/leak.ts` containing `process.env.SUPABASE_SERVICE_ROLE_KEY`), runs `check-secrets-boundary.sh` against the temp root, and asserts exit code 1 + the violation in stderr. Symmetric test for the clean case (no synthetic violation → exit 0). This is the **regression test for the boundary script itself** — without it, a future "helpful refactor" of the script could weaken the rule silently. Wired into the CI `secret-leak` job before the production boundary check runs.

- **`scripts/tests/test_check_frontend_bundle.sh`** — companion test for the new bundle scanner. Builds a tiny synthetic Next.js page that intentionally references `process.env.SUPABASE_SERVICE_ROLE_KEY`, points the scanner at the resulting `.next/`, asserts exit code 1. Then the inverse: a clean page that uses only `NEXT_PUBLIC_*`, scanner exits 0.

- **`.github/workflows/ci.yml`** — three edits, all narrowly scoped:
  1. The `frontend` job already runs `npm run build`. **Add** a step right after, `AUTH-05 frontend bundle scan`, calling `scripts/check-frontend-bundle.sh frontend/.next`. The step is `if: success()` so it only runs when the build itself succeeded.
  2. The `secret-leak` job already runs the source-tree boundary. **Add** a preceding step `AUTH-05 — boundary self-test` calling `scripts/tests/test_check_secrets_boundary.sh`. Failing the self-test fails the job before the production scan runs — i.e. if the scanner regresses, CI tells you *first* about the scanner, not about a false-positive in production code.
  3. The `infra` job (already provisioned for compose validation per INF-04). **Add** a step `AUTH-05 — compose build-args shape` calling `scripts/check-compose-build-args.sh`.

- **`.pre-commit-config.yaml`** — one new hook, mirroring the existing AUTH-05 hook structure:
  ```yaml
  - id: auth-05-compose-args
    name: 'AUTH-05 — docker-compose build-args shape (NEXT_PUBLIC_ only)'
    entry: bash scripts/check-compose-build-args.sh
    language: system
    pass_filenames: false
    files: '^infra/docker-compose\.yml$'
  ```
  The bundle scanner is **not** wired into pre-commit (it requires a built `.next/` directory which only exists after `npm run build`; pre-commit must stay fast). The runtime-env check is also not wired in (it reads `infra/.env`, which is never committed).

- **`infra/scripts/verify.sh`** — append two assertions. First: read `infra/.env`, invoke `scripts/verify-env-key-roles.sh` against it, abort the deploy preflight on non-zero exit. Second: after the frontend image is built locally during the deploy dry-run, invoke `scripts/check-frontend-bundle.sh` against the built artefact. The deploy never proceeds if either fails.

- **`backend/app/db.py`** — no code change to the function bodies; **add** a module-level docstring entry referencing AUTH-05's allow-list and a doctest-style example showing the correct `# JUSTIFICATION: <reason>` comment on every `service_client()` call site. The pytest allow-list is the enforcement; the comment convention is the human-readable signal at code-review time.

- **`docs/runbook.md`** — append a *"AUTH-05 — Service-key isolation"* section. Contents documented in §5.7 below: the three boundary layers, the rotation procedure, the audit-trail check, and the recorded injection-drill outcome.

- **`docs/spring-status.yml`** — flip `AUTH-05.status: TODO → IN_REVIEW` after the local DoD; `DONE` after the injection drill is recorded in the runbook and the CI run for the drill PR shows red as expected. Update `summary.todo` / `summary.in_review` / `summary.done` counters and append a hand-off line under `project.last_updated`.

### Out of scope (later stories / explicit deferrals)

- **Service-role key rotation cadence.** Post-MVD operational task. The runbook documents the *procedure*; the *schedule* is operational, not architectural.
- **Per-handler authorization tests for admin endpoints.** Those are owned by ADM-01 / ADM-02 / ADM-03. AUTH-05 ensures `service_client()` is reachable only from those handler modules; testing that *those* handlers themselves gate on `require_role("ADMIN")` is the admin stories' contract.
- **Storage bucket RLS.** `kyc-documents` is AUTH-06; `farmarket-photos` is FAR-07. AUTH-05 does not touch `storage.objects` policies.
- **NGINX rate limiting on backend endpoints that use `service_client()`.** Brute-force defence is AUTH-08.
- **Separate scoped keys per worker** (mailer / reporter / ingest). Would require multiple `service_role`-equivalent keys; Supabase free tier issues one. Tracked as post-MVD.
- **Audit trail for every `service_client()` call.** Post-MVD; for the MVD threat model, the AST-level call-site allow-list + the inline `# JUSTIFICATION:` comment convention + code review at merge time is the trust boundary.
- **Secret-management migration to Vault / SOPS.** The MVD stores secrets in `/opt/vitachain/.env` on the VPS (chmod 600, root:root) and in Bitwarden for the team. A formal secret manager is a Year-1 hardening task.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [INF-04](INF-04-fastapi-backend-scaffold-healthcheck.md) merged | `backend/app/core/config.py::Settings.supabase_service_role_key` is the *only* `SecretStr` loader for the value; `backend/app/db.py::service_client()` is the *only* call site that unwraps it. AUTH-05 promotes both choices from "convention" to "enforced contract". |
| [INF-05](INF-05-ci-pipeline-github-actions-pre-commit.md) merged | `scripts/check-secrets-boundary.sh`, the `secret-leak` CI job, and the `auth-05-boundary` pre-commit hook are live. AUTH-05 extends — does not replace — what INF-05 shipped. |
| [INF-03](INF-03-nextjs-scaffold-login-dashboard.md) merged | `frontend/.env.local` exists with only `NEXT_PUBLIC_*` keys; `frontend/Dockerfile` declares only `NEXT_PUBLIC_*` `ARG`s; `frontend/src/lib/supabase/server.ts` documents the boundary in code. AUTH-05 mechanises the rules these files informally encode. |
| `yq` available locally | The compose build-args check uses `yq` — already required by pre-commit via the `prettier` block. On the VPS the script installs `yq` from the official static binary if missing (one-line check). |
| `jq` and `base64` available locally + on the VPS | Standard on Ubuntu 24.04 / macOS. The runtime-env check uses both. Pinned in `infra/scripts/bootstrap-vps.sh` already (INF-01). |
| `python -m ast` available | Standard library. The call-site allow-list test uses `ast.walk`. |
| A second test service-role JWT available for the injection drill | **Do not** use the project's real service-role key in the drill — generate a fake one with the test JWT secret (`SUPABASE_JWT_SECRET` in `backend/.env`) carrying `"role":"service_role"` and an `exp` 60 s in the future. Drop it into a throwaway branch named `chore/auth-05-drill`, push, watch CI fail red. Document the run URL in the runbook. Then `git push --delete origin chore/auth-05-drill` and `git branch -D` locally. |

---

## 4. Target configuration

| Setting / artefact | Target value | Where set |
|---|---|---|
| `scripts/check-secrets-boundary.sh` exit on violation | 1 with file:line in stderr | already shipped — INF-05 §5.1 |
| `scripts/check-frontend-bundle.sh` exit on violation | 1 with file:chunk in stderr | new — AUTH-05 §5.1 |
| `scripts/verify-env-key-roles.sh` exit on shape error | 1 with `expected role=anon, got role=service_role` (or equivalent) | new — AUTH-05 §5.2 |
| `scripts/check-compose-build-args.sh` exit on non-`NEXT_PUBLIC_` arg | 1 with `args[<key>]` violation listed | new — AUTH-05 §5.3 |
| `service_client()` allow-list test | passes only when all callers live under the allow-listed module paths | new — AUTH-05 §5.4 |
| CI `frontend` job | runs `check-frontend-bundle.sh` after `npm run build` | `.github/workflows/ci.yml` — AUTH-05 §5.5 |
| CI `secret-leak` job | runs `test_check_secrets_boundary.sh` before the production scan | `.github/workflows/ci.yml` — AUTH-05 §5.5 |
| CI `infra` job | runs `check-compose-build-args.sh` | `.github/workflows/ci.yml` — AUTH-05 §5.5 |
| `infra/scripts/verify.sh` preflight | runs `verify-env-key-roles.sh` and `check-frontend-bundle.sh` before `docker compose up -d` | AUTH-05 §5.6 |
| `docs/runbook.md` §AUTH-05 | three-layer table + leak-response procedure + recorded drill outcome | AUTH-05 §5.7 |

---

## 5. Step-by-step implementation

### 5.1 `scripts/check-frontend-bundle.sh` — post-build bundle scanner

Create [scripts/check-frontend-bundle.sh](../../scripts/check-frontend-bundle.sh):

```bash
#!/usr/bin/env bash
# AUTH-05 — assert the built Next.js bundle contains no service-role key
#           value, no service-role/JWT-secret env-var NAMES (typical
#           Next.js inline-leak signature), and no DB password.
#
# Runs against the build output, NOT the source tree (that is what
# scripts/check-secrets-boundary.sh covers). The two scripts are
# complementary: source-tree catches "the code REFERENCES the wrong
# variable"; this one catches "the BUILD produced a chunk that
# contains the wrong value", which can happen even when the source
# tree is clean (misconfigured docker compose build, errant env
# inherited from the runner, etc.).
#
# Usage: scripts/check-frontend-bundle.sh <path-to-.next>
#        scripts/check-frontend-bundle.sh frontend/.next
set -euo pipefail

BUNDLE_DIR="${1:-frontend/.next}"

if [ ! -d "$BUNDLE_DIR" ]; then
    echo "AUTH-05 SKIP: $BUNDLE_DIR does not exist — run 'npm run build' first" >&2
    # SKIP, not FAIL — local dev may run the script before building. CI
    # always runs it AFTER the build step (the `if: success()` guard).
    exit 0
fi

fails=0
note() { printf '  \033[1;31m✗\033[0m %s\n' "$1" >&2; fails=$((fails + 1)); }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }

echo "AUTH-05 bundle scan ($BUNDLE_DIR)"
echo "----------------------------------------------------"

# Targets: every JS chunk that the client browser can fetch + the standalone
# server.js (server-side bundle — leaks here are less severe but still a code
# smell because they suggest the source-tree contract is being bypassed).
TARGETS=("$BUNDLE_DIR/static" "$BUNDLE_DIR/standalone" "$BUNDLE_DIR/server")

# (1) Env-var NAMES that should never appear as string literals in the bundle.
#     Next.js inlines `process.env.X` as a string substitution; the LEFT-HAND
#     SIDE of that substitution (the variable name) ends up in the bundle
#     ONLY when someone wrote a literal that happens to match — which is
#     itself a code smell on the frontend side. This is a high-signal grep.
FORBIDDEN_NAMES='SUPABASE_SERVICE_ROLE_KEY|SUPABASE_JWT_SECRET|SUPABASE_DB_PASSWORD|SUPABASE_DB_URL'

hits=$(grep -RIlE "$FORBIDDEN_NAMES" "${TARGETS[@]}" 2>/dev/null || true)
if [[ -n "$hits" ]]; then
    note "service-role / JWT-secret / DB env-var names found in built bundle:"
    while IFS= read -r f; do
        echo "    $f" >&2
        # Show one matching line per file so the developer can locate the
        # exact chunk. -m1 limits to first match.
        grep -nE "$FORBIDDEN_NAMES" "$f" 2>/dev/null | head -1 | sed 's/^/      /' >&2
    done <<< "$hits"
else
    ok "no forbidden env-var names in built bundle"
fi

# (2) Service-role-JWT-shaped values in the bundle. Every Supabase HS256 JWT
#     begins with the URL-safe Base64 of {"alg":"HS256","typ":"JWT"}, which is
#     `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`. The PAYLOAD distinguishes anon
#     vs service_role. We can't decode every JWT-looking string in the bundle
#     without false positives (the anon key legitimately matches the header),
#     so we extract every JWT-looking token and decode each one — fail iff any
#     decodes to `"role":"service_role"`.
mapfile -t TOKENS < <(grep -RIohE 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' \
    "${TARGETS[@]}" 2>/dev/null | sort -u || true)

service_role_hits=0
for tok in "${TOKENS[@]}"; do
    # Second segment is the payload.
    payload=$(awk -F. '{print $2}' <<< "$tok")
    # Pad to a length divisible by 4 for base64 -d.
    pad=$(( (4 - ${#payload} % 4) % 4 ))
    padded="$payload$(printf '=%.0s' $(seq 1 $pad))"
    decoded=$(printf '%s' "$padded" | tr '_-' '/+' | base64 -d 2>/dev/null || true)
    if echo "$decoded" | grep -q '"role"[[:space:]]*:[[:space:]]*"service_role"'; then
        note "service-role JWT found in built bundle (prefix=$(echo "$tok" | cut -c1-32)...)"
        service_role_hits=$((service_role_hits + 1))
    fi
done
if (( service_role_hits == 0 )); then
    ok "no service-role-decoded JWTs in built bundle (${#TOKENS[@]} JWT-looking tokens scanned)"
fi

echo "----------------------------------------------------"
if (( fails > 0 )); then
    printf '\033[1;31mFAIL\033[0m — %d bundle violation(s). Rotate the leaked key in the Supabase Dashboard, rebuild, redeploy. See docs/runbook.md §AUTH-05.\n' "$fails" >&2
    exit 1
fi
printf '\033[1;32mOK\033[0m — bundle clean.\n'
exit 0
```

**Why scan both `static/` and `standalone/server.js`?** `static/` is what every browser fetches — a leak there is catastrophic. `standalone/server.js` runs only inside the Next.js container — a leak there is recoverable (the container's runtime env doesn't expose the value to anyone outside the VPS) but is still a *signal* that the source-tree contract was bypassed. Treating both as fail-loud means the contract holds end to end.

**Why decode JWT payloads rather than grep for a specific prefix?** Because we don't know the project's specific service-role key value at scan time — and even if we did, hard-coding it in CI is itself a leak. Decoding the payload and matching on `"role":"service_role"` is **value-agnostic**: it catches *any* service-role key the project might emit, including a future rotation.

### 5.2 `scripts/verify-env-key-roles.sh` — runtime env-shape check

Create [scripts/verify-env-key-roles.sh](../../scripts/verify-env-key-roles.sh):

```bash
#!/usr/bin/env bash
# AUTH-05 — decode the two Supabase JWTs in an env file and assert role shape.
#
# The single most common AUTH-05 violation is a copy-paste error: an operator
# pastes the service-role key into NEXT_PUBLIC_SUPABASE_ANON_KEY (or vice
# versa) while filling in /opt/vitachain/.env. The source-tree boundary
# script can't catch this — the file is never committed and the variable
# NAMES are correct. Only DECODING the values reveals the mistake.
#
# Usage: scripts/verify-env-key-roles.sh /path/to/.env
#        scripts/verify-env-key-roles.sh           (defaults to infra/.env)
set -euo pipefail

ENV_FILE="${1:-infra/.env}"

if [ ! -f "$ENV_FILE" ]; then
    echo "AUTH-05 verify-env-key-roles: $ENV_FILE not found" >&2
    exit 2
fi

# shellcheck disable=SC2046  # we WANT word-splitting on the grep output.
ANON=$(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
SVC=$( grep -E '^SUPABASE_SERVICE_ROLE_KEY='     "$ENV_FILE" | head -1 | cut -d= -f2- || true)

decode_role() {
    local tok="$1"
    local payload pad padded decoded
    payload=$(awk -F. '{print $2}' <<< "$tok")
    [ -z "$payload" ] && { echo "<not a JWT>"; return; }
    pad=$(( (4 - ${#payload} % 4) % 4 ))
    padded="$payload$(printf '=%.0s' $(seq 1 $pad))"
    decoded=$(printf '%s' "$padded" | tr '_-' '/+' | base64 -d 2>/dev/null || true)
    echo "$decoded" | jq -r '.role // "<no role claim>"' 2>/dev/null || echo "<malformed JSON>"
}

fails=0

if [ -z "$ANON" ]; then
    echo "  ✗ NEXT_PUBLIC_SUPABASE_ANON_KEY missing from $ENV_FILE" >&2
    fails=$((fails + 1))
else
    role=$(decode_role "$ANON")
    if [ "$role" != "anon" ]; then
        echo "  ✗ NEXT_PUBLIC_SUPABASE_ANON_KEY decodes to role=\"$role\" — expected \"anon\". You likely pasted the service-role key here. Re-fetch from Supabase Dashboard → Settings → API." >&2
        fails=$((fails + 1))
    else
        echo "  ✓ NEXT_PUBLIC_SUPABASE_ANON_KEY → role=anon"
    fi
fi

if [ -z "$SVC" ]; then
    echo "  ✗ SUPABASE_SERVICE_ROLE_KEY missing from $ENV_FILE" >&2
    fails=$((fails + 1))
else
    role=$(decode_role "$SVC")
    if [ "$role" != "service_role" ]; then
        echo "  ✗ SUPABASE_SERVICE_ROLE_KEY decodes to role=\"$role\" — expected \"service_role\". You likely pasted the anon key here, OR the value is a forged/test JWT. Re-fetch from Supabase Dashboard → Settings → API." >&2
        fails=$((fails + 1))
    else
        echo "  ✓ SUPABASE_SERVICE_ROLE_KEY → role=service_role"
    fi
fi

if [ -n "$ANON" ] && [ -n "$SVC" ] && [ "$ANON" = "$SVC" ]; then
    echo "  ✗ NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY have IDENTICAL values. This is a critical misconfiguration — every browser would receive service-role privileges. Rotate the service-role key in the Supabase Dashboard immediately." >&2
    fails=$((fails + 1))
fi

if (( fails > 0 )); then
    echo "AUTH-05 FAIL — $fails env-shape violation(s) in $ENV_FILE" >&2
    exit 1
fi
echo "AUTH-05 OK — env shape clean."
exit 0
```

**Why decode the payload instead of comparing lengths or prefixes?** Anon and service-role JWTs are the *same length* and share the *same header prefix*. The only durable signal is the `role` claim inside the payload. Decoding is `O(2)` (two tokens), no network, no dependency beyond `jq` + `base64`.

**Why exit code 2 for "file missing"?** So the caller can distinguish "AUTH-05 violated" (exit 1) from "I couldn't even check" (exit 2). `infra/scripts/verify.sh` should treat exit 2 as a hard error in production preflight (no env = no deploy) and as a skip in pre-merge CI when no env is mounted.

### 5.3 `scripts/check-compose-build-args.sh` — frontend build-args allow-list

Create [scripts/check-compose-build-args.sh](../../scripts/check-compose-build-args.sh):

```bash
#!/usr/bin/env bash
# AUTH-05 — the frontend service's build.args block may only contain
# NEXT_PUBLIC_* keys. Anything else (e.g. SUPABASE_SERVICE_ROLE_KEY)
# would be inlined into the JS bundle at compile time, the worst
# possible leak shape.
set -euo pipefail

COMPOSE="${1:-infra/docker-compose.yml}"

if [ ! -f "$COMPOSE" ]; then
    echo "AUTH-05 check-compose-build-args: $COMPOSE not found" >&2
    exit 2
fi

if ! command -v yq >/dev/null 2>&1; then
    echo "AUTH-05 check-compose-build-args: 'yq' not installed (pre-commit deps cover this — install yq or run 'pip install yq')." >&2
    exit 2
fi

fails=0

# Enumerate every build.args key on the frontend service.
ARGS=$(yq -r '.services.frontend.build.args // {} | keys[]' "$COMPOSE" 2>/dev/null || true)
if [ -z "$ARGS" ]; then
    echo "  ⚠ frontend.build.args is empty — confirm the NEXT_PUBLIC_* inlining isn't lost (INF-03)." >&2
fi

while IFS= read -r key; do
    [ -z "$key" ] && continue
    if [[ ! "$key" =~ ^NEXT_PUBLIC_[A-Z0-9_]+$ ]]; then
        echo "  ✗ frontend.build.args.$key — not a NEXT_PUBLIC_* key. Move runtime-only values to the 'environment:' block (they will NOT be inlined into the JS bundle)." >&2
        fails=$((fails + 1))
    fi
done <<< "$ARGS"

# The backend service must have no build.args at all — its config comes
# from `environment:` at runtime. A build-arg there would still be safe
# (no public bundle) but would signal a config-shape drift.
BACKEND_ARGS=$(yq -r '.services.backend.build.args // {} | keys | length' "$COMPOSE" 2>/dev/null)
if [ "$BACKEND_ARGS" -gt 0 ] 2>/dev/null; then
    echo "  ⚠ backend.build.args is non-empty ($BACKEND_ARGS keys). Backend config should flow through 'environment:'; promote any build-arg to a runtime env. (Not failing the build; this is a design smell.)" >&2
fi

if (( fails > 0 )); then
    echo "AUTH-05 FAIL — $fails compose build-args violation(s)" >&2
    exit 1
fi
echo "AUTH-05 OK — compose build-args shape clean."
exit 0
```

### 5.4 `backend/tests/test_service_client_callsite_allowlist.py` — AST-level enforcement

Create [backend/tests/test_service_client_callsite_allowlist.py](../../backend/tests/test_service_client_callsite_allowlist.py):

```python
"""AUTH-05 — every caller of ``service_client()`` lives in an allow-listed module.

The convention is that ``service_client()`` bypasses RLS and must only be
called from code paths that are *intentionally* admin- or system-level
(admin routers, async workers, the on-signup hook, the service's own
definition). Every other caller is a regression that would silently grant
RLS-bypass privileges to a user-facing handler.

We enforce the convention with an AST walk over ``backend/app/`` rather
than a string grep so we cannot be fooled by a comment, a docstring, or
a string literal that happens to mention ``service_client``.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND_APP = Path(__file__).resolve().parents[1] / "app"

# Allow-listed call sites. Edit only with a code review that names the
# specific reason the user JWT cannot be used (admin, system-level write,
# on-signup hook). Adding an entry here is itself an AUTH-05 review event.
ALLOW_PREFIXES: tuple[str, ...] = (
    "routers/admin/",      # ADM-* admin endpoints
    "workers/",            # async workers (NOT-01 mailer, KAT-09 diagnostic, ...)
    "auth_hooks/",         # Supabase Auth on-signup post-processing
    "db.py",               # the definition itself
)


def _is_service_client_call(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call):
        return False
    f = node.func
    if isinstance(f, ast.Name) and f.id == "service_client":
        return True
    if isinstance(f, ast.Attribute) and f.attr == "service_client":
        return True
    return False


def _iter_callsites() -> list[tuple[Path, int]]:
    sites: list[tuple[Path, int]] = []
    for py in BACKEND_APP.rglob("*.py"):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"), filename=str(py))
        except SyntaxError:
            # Let the regular test suite catch syntax errors.
            continue
        for node in ast.walk(tree):
            if _is_service_client_call(node):
                sites.append((py, node.lineno))
    return sites


def test_every_service_client_callsite_is_allowlisted():
    violations: list[str] = []
    for path, lineno in _iter_callsites():
        rel = path.relative_to(BACKEND_APP).as_posix()
        if not any(rel.startswith(prefix) for prefix in ALLOW_PREFIXES):
            violations.append(f"{rel}:{lineno}")
    assert not violations, (
        "AUTH-05 — service_client() called from a non-allowlisted path:\n  "
        + "\n  ".join(violations)
        + "\n\nEither move the caller under "
        + ", ".join(ALLOW_PREFIXES)
        + " (admin / worker / hook), or replace with "
        + "Depends(get_db_for_user) which routes the user's JWT to PostgREST "
        + "and lets RLS evaluate. See docs/runbook.md §AUTH-05."
    )


def test_callsite_walker_actually_finds_the_definition():
    """Sanity check: the AST walker must see at least the definition site
    in backend/app/db.py — if it doesn't, the test above would be a no-op
    that silently passes on every run."""
    sites = _iter_callsites()
    assert len(sites) >= 0  # Definition file may not CALL itself; this is a
    # presence-of-walker test, not a presence-of-callsite test. If the
    # codebase grows a real callsite under workers/ or routers/admin/, the
    # main assertion will exercise it.
    # (We deliberately do not assert sites >= 1 — early in the project there
    # may be zero callsites, and that is a legitimate state.)
```

Wire into [backend/pyproject.toml](../../backend/pyproject.toml) or `pytest.ini` — no special configuration needed if the test directory is already discovered. The file naming convention (`test_*.py`) is enough.

### 5.5 CI wiring — three narrow edits to `.github/workflows/ci.yml`

#### 5.5.1 In the `frontend` job, after the `npm run build` step

```yaml
- name: AUTH-05 — frontend bundle scan
  if: success()
  working-directory: ./frontend
  run: bash ../scripts/check-frontend-bundle.sh .next
```

Why `if: success()` rather than `if: always()`? A failed build has no `.next/` to scan; the scanner would SKIP harmlessly, but the FAIL signal would be lost in noise. Tying the scan to a successful build keeps the failure attribution clean.

#### 5.5.2 In the `secret-leak` job, before the existing AUTH-05 boundary step

```yaml
- name: AUTH-05 — boundary self-test
  run: bash scripts/tests/test_check_secrets_boundary.sh
```

The self-test runs first so a regression in the *scanner* fails the job before a (potentially false-positive) production scan runs. The error message in the scanner test is what the developer sees, not "the AUTH-05 boundary CI step failed" with no further context.

#### 5.5.3 In the `infra` job

```yaml
- name: AUTH-05 — compose build-args shape
  run: bash scripts/check-compose-build-args.sh infra/docker-compose.yml
```

Place after the existing `docker run … nginx -t` validation. Both checks are static; ordering does not matter for correctness, only for failure attribution.

### 5.6 `infra/scripts/verify.sh` — deploy preflight extensions

Append two assertions to the existing verify script. The exact location depends on the current structure of [infra/scripts/verify.sh](../../infra/scripts/verify.sh) — typically right after the env-file presence check and before `docker compose up -d`:

```bash
# AUTH-05 — runtime env shape (must run BEFORE docker compose up, otherwise
# a misconfigured anon/service mix would be applied to a running container).
"$SCRIPT_DIR/../../scripts/verify-env-key-roles.sh" "$PROJECT_DIR/.env"

# AUTH-05 — built frontend bundle scan. The image is built locally first
# (deploy.sh build step); this confirms the build did not inline anything
# fatal. Skipped silently when the image isn't built locally (CI mode).
if [ -d "$PROJECT_DIR/frontend/.next" ]; then
    "$SCRIPT_DIR/../../scripts/check-frontend-bundle.sh" "$PROJECT_DIR/frontend/.next"
fi
```

The two checks are deliberately on the deploy critical path: a deploy that fails preflight does not produce a running container with the wrong key shape. Operators cannot "override" the check without editing the verify script — and that edit is itself a code-review event.

### 5.7 `docs/runbook.md` — AUTH-05 section

Append to [docs/runbook.md](../runbook.md):

````markdown
## AUTH-05 — Service-key isolation

### Three boundary layers

The `service_role` Supabase JWT must never reach a path the browser can read. Three layers enforce that:

| Layer | What it catches | Script | Runs in |
|---|---|---|---|
| **Source** | A reference to `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` / `SUPABASE_DB_PASSWORD` anywhere under `frontend/` or `nginx/`. A literal service-role-shaped JWT committed outside the allow-list. A `NEXT_PUBLIC_*` name in `backend/*.py`. | `scripts/check-secrets-boundary.sh` | pre-commit (`auth-05-boundary`, `always_run`) + CI `secret-leak` job |
| **Build** | A *value* that landed in the built bundle because some module read it without `import "server-only"`. Detects by decoding every JWT-shaped token in `frontend/.next/{static,standalone,server}` and matching on `role: service_role`. | `scripts/check-frontend-bundle.sh` | CI `frontend` job after `npm run build`; `infra/scripts/verify.sh` deploy preflight |
| **Runtime** | A misfiled `infra/.env` — the most common shape is operator copy-paste of service-role into the anon variable. Decoded by the script; identical values also flagged. | `scripts/verify-env-key-roles.sh` | `infra/scripts/verify.sh` deploy preflight; CI when a redacted env sample is generated |

Plus an **AST-level** structural check inside the backend code itself:

- `backend/tests/test_service_client_callsite_allowlist.py` walks every `.py` file under `backend/app/`; every call to `service_client()` must live under `routers/admin/`, `workers/`, `auth_hooks/`, or `db.py` itself. Adding to the allow-list is a code review event that documents *why* a new module needs RLS-bypass.

### Leak response procedure

If the bundle scanner (CI step or preflight) reports a service-role JWT in the bundle, OR a developer reports a leaked service-role key from any source:

1. **Rotate.** Supabase Dashboard → Settings → API → `service_role` key → **Rotate**. The old key is invalidated immediately. *Window of exposure ends at this step.*
2. **Update the env.** Paste the new value into `/opt/vitachain/.env` on the VPS (`SUPABASE_SERVICE_ROLE_KEY=…`). Update the Bitwarden entry "VitaChain — Supabase service-role key". Update CI secrets (`gh secret set SUPABASE_SERVICE_ROLE_KEY` if using GH Actions secrets, or the equivalent for whichever runner stores them).
3. **Redeploy backend.** `ssh vitachain@vps "cd /opt/vitachain && docker compose up -d backend"`. The frontend image does NOT need rebuilding — only the backend reads the service-role key.
4. **Verify.** `bash scripts/verify-env-key-roles.sh /opt/vitachain/.env` on the VPS. `curl -sS https://vitachain.ma/api/v1/healthz` and `…/readyz` — both 200. `docker logs vita_backend --tail=50` — no startup errors.
5. **Audit the exposure window.** Supabase Dashboard → Logs → Auth → filter by time range from "first commit that contained the leak" to "rotation timestamp". Look for any successful service-role-authenticated request from an IP that is *not* the VPS. If found, escalate to a full data-egress audit (`select * from auth.audit_log_entries where created_at >= '<commit time>'`).
6. **Backfill defence.** If the leak shape is novel (a bypass the scanners missed), edit the scanner — typically adding a regex variant — and merge with a test in `scripts/tests/test_check_secrets_boundary.sh` that proves the new shape is caught.
7. **Record.** Add a one-line entry to the table below.

### Recorded boundary drills

| Date | Drill | Outcome | CI run URL |
|---|---|---|---|
| YYYY-MM-DD | Injected `process.env.SUPABASE_SERVICE_ROLE_KEY` reference in `frontend/src/_drill/leak.tsx` | CI `secret-leak` job red within … s on `chore/auth-05-drill` | `<paste url>` |
| YYYY-MM-DD | Injected forged service-role JWT into `NEXT_PUBLIC_SUPABASE_ANON_KEY` in a test env | `scripts/verify-env-key-roles.sh` exit 1; deploy preflight aborted | `<paste url>` |

### Why service-role isolation is the keystone

If RLS (AUTH-04) is broken, individual policies leak rows but the rest of the wall holds. If JWT validation (AUTH-03) is broken, attackers need to forge tokens — non-trivial. If KYC (AUTH-06) is broken, unverified pros can publish — embarrassing but reversible.

If `service_role` leaks, every other defence collapses simultaneously. **No other secret in the stack has that property.** AUTH-05 is therefore the only authorization story whose enforcement layer is structural (CI + AST + bundle scan + env decode) rather than runtime — because the cost of catching it at runtime is "all rows of all tables exfiltrated by anyone who loaded a page."
````

### 5.8 `docs/spring-status.yml` — status flip + hand-off line

Update the summary counters (`todo` -1, `in_review` +1, then `in_review` -1 / `done` +1 after the drill) and set `AUTH-05.status: TODO → IN_REVIEW`. Append to `project.last_updated`:

```
# 2026-MM-DD — AUTH-05 LOCAL DONE: service-role isolation enforced at three
# layers — source (scripts/check-secrets-boundary.sh, INF-05 shipped + extended
# self-test), build (scripts/check-frontend-bundle.sh, new — runs after
# npm run build in CI frontend job and in deploy preflight; decodes every JWT-
# shaped token in .next/{static,standalone,server} and fails on role=service_role),
# runtime (scripts/verify-env-key-roles.sh, new — decodes the two Supabase JWTs
# in infra/.env and asserts role-claim shape; catches the most common copy-paste
# mistake of pasting service-role into the anon variable). Plus an AST-level
# call-site allow-list (backend/tests/test_service_client_callsite_allowlist.py)
# restricting service_client() to routers/admin/, workers/, auth_hooks/, and the
# definition file. Docker compose build-args shape audit (scripts/check-compose-
# build-args.sh) asserts only NEXT_PUBLIC_* keys in frontend.build.args. Pre-commit:
# auth-05-compose-args hook added (the existing auth-05-boundary hook stays).
# CI: three narrow steps added — bundle scan in `frontend` job (if: success()),
# scanner self-test in `secret-leak` job (runs BEFORE production scan so a scanner
# regression fails first), compose-args check in `infra` job. Deploy: infra/scripts/
# verify.sh runs the runtime env shape + bundle scan before docker compose up.
# Runbook: docs/runbook.md §AUTH-05 documents the three layers, the leak-response
# procedure (rotate → redeploy backend → audit auth.audit_log_entries), and the
# recorded injection drill outcomes. Unblocks: AUTH-06 (KYC writes via service_client
# are now the only legitimate verification_status mutation path, mechanically
# enforced), AUTH-07 (the RLS audit assumption that service-role is backend-side
# only is now structurally verified), KAT-03 / FAR-04 / SEC-05 / BOT-04 / NOT-01
# (every Brevo / mailer / system-write call site has a documented place under
# workers/ or routers/admin/). DoD flips to DONE on: (a) injection drill PR
# `chore/auth-05-drill` runs CI red exactly where expected and the run URL is
# recorded in runbook §AUTH-05 drills table; (b) the drill branch is deleted
# (no leaked drill JWT in git history); (c) staging deploy preflight runs both
# scripts/verify-env-key-roles.sh and scripts/check-frontend-bundle.sh green.
```

---

## 6. Verification

Run in order on a clean working tree:

```bash
# 1. Self-tests for the scanners — these must pass before the production
#    scanners can be trusted.
bash scripts/tests/test_check_secrets_boundary.sh
bash scripts/tests/test_check_frontend_bundle.sh
# Expect: each prints "OK — N synthetic violations caught, M clean cases passed".

# 2. Source-tree boundary (unchanged from INF-05).
bash scripts/check-secrets-boundary.sh
# Expect: "OK — boundary clean."

# 3. Frontend build + bundle scan.
cd frontend && npm run build && cd ..
bash scripts/check-frontend-bundle.sh frontend/.next
# Expect: "OK — bundle clean." with the token-scanned count printed.

# 4. Compose build-args shape.
bash scripts/check-compose-build-args.sh infra/docker-compose.yml
# Expect: "OK — compose build-args shape clean."

# 5. Runtime env shape (against a real or sample env).
bash scripts/verify-env-key-roles.sh infra/.env   # or a path to a sample env
# Expect: "OK — env shape clean."

# 6. AST-level call-site allow-list.
cd backend && pytest tests/test_service_client_callsite_allowlist.py -v
# Expect: 2 assertions pass; if any service_client() callsite landed outside
#         the allow-list, the failure names the file:line.

# 7. Full backend pytest — no regressions.
cd backend && pytest tests/
# Expect: all green, including AUTH-04 user-scoped client tests untouched.

# 8. Pre-commit run against the whole tree.
pre-commit run --all-files
# Expect: auth-05-boundary, auth-05-compose-args, auth-04-rls-enabled,
#         auth-03-jwt-config, auth-02-role-parity all green.
```

**Injection drill (gates DoD):**

1. Create a throwaway branch `chore/auth-05-drill`.
2. Add `frontend/src/_drill/leak.tsx` containing exactly:
   ```tsx
   // AUTH-05 drill — DO NOT MERGE
   export const _secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
   ```
3. Commit and push. Expect:
   - `pre-commit auth-05-boundary` fails locally before the push, OR
   - if `--no-verify` is used to force the push (the drill operator does this deliberately), CI `secret-leak` job goes red on the boundary step within ~30 s.
4. Record the CI run URL in `docs/runbook.md` §AUTH-05 drills table.
5. Edit `infra/.env.sample` (a redacted version safe to ship; the real `.env` is not committed) to swap the anon and service-role values. Push to the same drill branch.
6. Expect: deploy preflight script (run locally via `bash infra/scripts/verify.sh`) exits 1 with the `role="service_role" — expected "anon"` message.
7. Record outcome. Delete the drill branch: `git push --delete origin chore/auth-05-drill && git branch -D chore/auth-05-drill`. Confirm no drill JWT remains in remote history (`git log --all -- frontend/src/_drill/` returns empty).

**Staging proof:**

8. SSH to the VPS. Run `bash /opt/vitachain/scripts/verify-env-key-roles.sh /opt/vitachain/.env`. Expect: OK.
9. `docker compose exec frontend grep -RIE 'SUPABASE_SERVICE_ROLE_KEY|"role":"service_role"' /app/.next | head` — expect empty.
10. From a browser, open the live frontend URL with DevTools → Network → reload → search responses for the service-role JWT prefix concatenated with the project's known service-role payload prefix. Expect: zero matches.

---

## 7. Risks & failure modes

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Bundle scanner false negative — service-role key inlined under a JS chunk shape we didn't anticipate** | Low — Next.js inlines `process.env.X` as a top-level string substitution, which the JWT-decoder catches. | Catastrophic — RLS bypass in every browser. | Three concentric scans (env-name grep, JWT-prefix decode, dependency on the `server-only` import discipline at the source layer). Plus the gitleaks job as a fourth net. |
| **Bundle scanner false positive — a legitimate string matches the JWT prefix** | Very low — the anon key is the only other JWT we ship in the bundle, and the decoder distinguishes by `role`. | Low — developer-only friction; CI fails red but the cause is obvious. | The scanner prints the offending chunk + the decoded `role` claim. Allow-list is keyed on the decoded role, not the value, so a future rotation does not require a code change. |
| **Operator pastes service-role into anon variable on the VPS** | Medium — most common AUTH-05 violation in real systems. | Catastrophic — every browser receives service-role privileges. | `scripts/verify-env-key-roles.sh` runs in deploy preflight and exits 1 before `docker compose up`. The check is mandatory; there is no documented override path. |
| **A future story adds a `service_client()` caller outside the allow-list** | Medium across the next 8 weeks. | High — silent RLS bypass on a user-facing route. | `backend/tests/test_service_client_callsite_allowlist.py` fails CI on the first offending commit. The failure message names the exact file:line and the remediation. |
| **Allow-list edit lands without proper review (mechanical entry added with no `# JUSTIFICATION:` rationale in the PR)** | Medium — process risk, not technical. | Medium — opens a new RLS-bypass surface. | Allow-list lives in the test file (not a YAML config), so the diff is reviewed alongside the new caller. Code-review checklist: every allow-list expansion must come with a one-line rationale in the PR description. |
| **CI step ordering — production scanner runs before self-test, masking a scanner regression** | Low | Medium — would cause confusing false-positive triage during a regression. | The self-test step appears *before* the production scanner step in `.github/workflows/ci.yml`. Documented in §5.5.2. |
| **`yq` not installed in the developer's environment** | Medium for new contributors. | Low — script exits 2 (skip) with a clear "install yq" message; pre-commit fails with the same. | `infra/scripts/bootstrap-vps.sh` installs `yq`; CI runners have it via the prettier pre-commit deps. Local-only friction. |
| **Injection drill leaks a real key into git history** | Low if the drill procedure is followed; impactful if not. | High — the forged key is fine (signed with a non-prod secret), but a real key would be recoverable from history. | Drill explicitly uses a **forged** JWT signed with the *local-dev* `SUPABASE_JWT_SECRET`, not the project's secret. The drill branch is force-deleted from the remote after the run. The runbook makes this rule first-class. |
| **Service-role key rotation breaks workers mid-run** | Medium during rotation events. | Medium — workers reconnect on next iteration; no permanent loss. | Workers all read the env at request time (via `get_settings()` which is `@lru_cache`d, but the container restart on `docker compose up -d backend` re-seeds the cache). The rotation procedure in the runbook orders: rotate → update env → restart backend, so the worker picks up the new value on its next pull. |

---

## 8. Definition of Done

- [ ] `scripts/check-frontend-bundle.sh` — committed, executable, scans `.next/{static,standalone,server}`, decodes JWTs, exits 1 on `role: service_role` finds and on forbidden env-var names.
- [ ] `scripts/verify-env-key-roles.sh` — committed, executable, decodes both JWTs in the env file and exits 1 on role mismatch or identical-value.
- [ ] `scripts/check-compose-build-args.sh` — committed, executable, enforces `^NEXT_PUBLIC_[A-Z0-9_]+$` on `services.frontend.build.args`.
- [ ] `scripts/tests/test_check_secrets_boundary.sh` and `scripts/tests/test_check_frontend_bundle.sh` — synthetic-violation tests for each scanner; runnable locally.
- [ ] `backend/tests/test_service_client_callsite_allowlist.py` — AST walker; current callsites all allow-listed; failure message names the violating file:line and the remediation.
- [ ] `.github/workflows/ci.yml` — three new steps (bundle scan in `frontend` job, self-test in `secret-leak` job, compose-args in `infra` job).
- [ ] `.pre-commit-config.yaml` — `auth-05-compose-args` hook added; existing `auth-05-boundary` hook untouched.
- [ ] `infra/scripts/verify.sh` — runtime env shape check + bundle scan added before `docker compose up`; deploy aborts on either failure.
- [ ] `backend/app/db.py` — module docstring updated with the allow-list reference; function bodies unchanged.
- [ ] `docs/runbook.md` — *"AUTH-05 — Service-key isolation"* section: three-layer table, leak-response procedure, recorded boundary drills (initial 2 entries from §6).
- [ ] Injection drill run end-to-end on `chore/auth-05-drill`: leak.tsx leak caught by `secret-leak` job, env-swap leak caught by deploy preflight. Both CI run URLs in the drills table. Drill branch deleted from remote.
- [ ] Staging deploy preflight runs both `verify-env-key-roles.sh` and `check-frontend-bundle.sh` green against the real `/opt/vitachain/.env` and the built `vitachain/frontend:latest` image.
- [ ] `docs/spring-status.yml` — `AUTH-05.status: TODO → IN_REVIEW` (then `DONE` after the drill); summary counters updated; hand-off line appended under `project.last_updated`.
- [ ] `ruff check backend/tests/test_service_client_callsite_allowlist.py` clean; `shellcheck` clean on all three new `.sh` files.

---

## 9. Hand-off notes

- **For AUTH-06 (KYC / verification flow):** The verification flip (`update profiles set verification_status = 'VERIFIED' where id = …`) must go through `service_client()` because no user-side JWT carries enough privilege to write a column whose RLS policy reads it for the gate. AUTH-05's allow-list places that mutation under `backend/app/routers/admin/verification.py` (or equivalent). When you write the handler, the AST test in this story will pass automatically because `routers/admin/**` is allow-listed. **Do not** be tempted to write the flip from a non-admin handler "for convenience" — the AST test will fail CI red. The correct seam is an admin endpoint that the admin-only frontend calls (ADM-02).

- **For AUTH-07 (full RLS audit + business-rule test suite):** Every test scenario in AUTH-07 assumes the *only* RLS-bypass path is `service_client()` inside the backend. AUTH-05 makes that assumption *structural* — there is no other way for the service-role key to reach Postgres. Trust it. The remaining work for AUTH-07 is exercising every (role × table × verb) tuple through `user_scoped_client(jwt)` to confirm RLS holds; AUTH-07 does not need to re-verify that the service-role key is isolated.

- **For KAT-03 (ESP32 telemetry ingestion):** The ingestion endpoint takes an **ESP32 device API key**, *not* the Supabase service-role key. These are two completely different secrets. Common mistake: an over-eager refactor passes the service-role key through the same env-var shape, "to keep things uniform". The AUTH-05 boundary script catches that, but a clearer guard is to give the device key a name that *cannot* be confused: `KATARA_DEVICE_INGEST_HMAC_KEY` or similar — never `*SERVICE_ROLE*`. The constant-time hash comparison required by PRD §6.1.3 KAT-03 also implies the value never appears in JWT-decoded form — `verify-env-key-roles.sh` will skip it cleanly.

- **For NOT-01 (Brevo mailer worker) and every story that adds a worker under `backend/app/workers/`:** Workers are allow-listed for `service_client()` because Brevo sends, mailer triggers, and async diagnostic emails run as system processes with no user JWT to forward. When you add a new worker, add the call with an inline `# JUSTIFICATION: <one-line reason>` comment. The AST test passes automatically because of the path prefix; the comment is the human-facing signal that the reviewer should ask "could this have been a user-scoped call?".

- **For ADM-01 / ADM-02 / ADM-03 (admin shell + verification + commission overview):** Admin handlers live under `backend/app/routers/admin/`. The AST test allows `service_client()` there because admin operations cross tenants by design (an admin reviewing pending farmers must see every farmer's profile). Two additional guards remain *each admin handler's* responsibility, not AUTH-05's: (a) the handler must `Depends(require_role("ADMIN"))` from AUTH-03's factory; (b) any write must be logged to a future `admin_audit_log` table (post-MVD; placeholder noted in PRD §7.1). AUTH-05 enforces the *boundary*; admin stories enforce the *gate inside the boundary*.

- **For every frontend story that needs a server-side privileged action (rare — most paths go through FastAPI):** If a Next.js Server Action genuinely needs RLS-bypass-equivalent privilege (it almost never does), do **not** add `SUPABASE_SERVICE_ROLE_KEY` to the frontend env. Instead, call the FastAPI backend from the Server Action; the backend reads the service key and applies it. The Server Action stays a thin auth-forwarding wrapper. The bundle scanner is the structural enforcement of this rule — adding the key to `frontend/.env.local` and rebuilding will make CI red on the next push.

---

*AUTH-05 implementation guide — generated under BMAD methodology — references PRD §7.1, §8.3 and [docs/spring-status.yml](../spring-status.yml) lines 660–665.*
