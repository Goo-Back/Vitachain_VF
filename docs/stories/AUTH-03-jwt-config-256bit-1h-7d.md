# AUTH-03 — JWT config: 256-bit secret · 1h access · 7d refresh

> **Epic:** E1 — Authentication, Authorization & Roles (Cross-cutting)
> **Phase:** P1 — Build (Weeks 1–2)
> **Priority:** Must *(PRD §7.1 and §8.3 — all authenticated traffic relies on correctly-scoped tokens; a missing JWT expiry setting silently makes every access token immortal, bypassing the 1-hour forced-re-auth that bounds the stolen-token damage window. This story also ships `get_current_user()` — the FastAPI dependency every downstream endpoint imports to gate its routes.)*
> **Status:** TODO
> **Depends on:** [AUTH-01](AUTH-01-email-password-registration.md) (`IN_REVIEW` — `auth.users` rows and working signup pipeline established), [AUTH-02](AUTH-02-role-assignment-registration.md) (`IN_REVIEW` — `user_role` claim placed in the JWT by the custom access token hook; AUTH-03 governs *how long* those tokens live and *how strong* the secret that signs them is)
> **Unblocks:** [AUTH-04](#) (RLS enable — the `get_current_user()` FastAPI dependency this story ships is the building block every RLS-gated endpoint uses; without it every module story must implement JWT validation ad-hoc), [AUTH-05](#) (service key isolation — the security module cleanly separates the user-JWT path from the service-key path), [AUTH-08](#) (NGINX rate-limiting — `limit_req_zone` targets `/auth/v1/token` and `/register`; AUTH-03 sets the access token lifetime those limits must be calibrated against), every domain story that protects a backend route with `get_current_user()` (KAT-03 ingest, FAR-01 ad creation, SEC-01 meal publishing, ADM-01 admin shell, …)
> **Acceptance (per [docs/spring-status.yml](../spring-status.yml) line 547–549):** *"Token expirations enforced; rotation works."* Extended DoD: (a) `supabase/config.toml` carries explicit `jwt_expiry = 3600` and token-rotation fields; (b) the Supabase Dashboard is aligned — 1h access expiry, 7d refresh expiry, rotation enabled; (c) the FastAPI backend has a `get_current_user()` dependency that rejects expired tokens with `401 Unauthorized` and wrong-role tokens with `403 Forbidden`; (d) a valid access token is accepted at T=0; the same token with a backdated `exp` returns `401 token_expired`; (e) `bash scripts/verify-jwt-config.sh` exits 0; (f) the project JWT secret is ≥ 64 hex characters (≥ 32 bytes / 256 bits).

---

## 1. Purpose

PRD §7.1 mandates three concrete JWT properties: a 256-bit signing secret, a 1-hour access token lifetime, and a 7-day refresh token lifetime. These are not optional hardening measures — they are the minimum viable threat model for an 8-week demo with real user data:

| Attack class | Without AUTH-03 | With AUTH-03 |
|---|---|---|
| **Stolen access token** (XSS, leaked log, MITM) | Token valid indefinitely; attacker has permanent impersonation for that role. | Token expires in ≤ 1 h; damage window is bounded even if the secret is never rotated. |
| **Stolen refresh token** (CSRF on `/auth/v1/token?grant_type=refresh_token`) | Attacker silently refreshes forever; legitimate user is unaware. | Refresh token rotation: using the stolen token invalidates it on first use by the attacker *or* first use by the real user — whichever fires first. Supabase logs a `refresh_token_reuse_detected` event that Sentry (INF-08) can alert on. |
| **Offline HS256 brute-force** (captured token, GPU cluster) | A key shorter than 128 bits can be cracked in hours with off-the-shelf tooling. | 256-bit (32-byte) random secret makes offline brute-force computationally infeasible under current hardware constraints. |

Beyond security hardening, AUTH-03 delivers the **`backend/app/core/security.py` module** — a single, tested `get_current_user()` FastAPI dependency. Without it, every one of the 14 module endpoints (KAT-03, FAR-01–05, SEC-01–08, ADM-01–02…) must implement JWT decoding, expiry checking, and role parsing independently. That is N copies of security-critical code, each requiring its own review. Centralizing here removes that risk and ensures every endpoint gets the same `AuthUser` dataclass — IDE autocomplete included.

The third deliverable is the explicit, version-controlled `config.toml` declaration of the token lifetimes. Supabase's default `jwt_expiry` is already 3600 s — but "correct by default" is not the same as "explicitly enforced in source control". Any operator who runs `supabase db push --linked` on a new project gets the default silently; any future config refactor that wipes the `[auth]` block gets it silently too. AUTH-03 makes the intention auditable and adds a CI guard that fails if the values drift.

> **What this story is not:** enabling RLS policies (AUTH-04), isolating the service key in CI (AUTH-05), writing per-role route decorators beyond the `require_role()` factory (those are per-module stories), implementing token blacklisting (Supabase handles revocation via `delete from auth.refresh_tokens` — see §9), adding PKCE or OAuth2 (post-MVD), or upgrading from HS256 to RS256 (post-MVD). The `get_current_user()` dependency is intentionally minimal: JWT signature + expiry + `sub` presence. Role-based access control is AUTH-04.

---

## 2. Scope

### In scope

- **`supabase/config.toml`** — append three JWT-specific fields to the existing `[auth]` block (AUTH-01 already opened that block; AUTH-03 appends without touching AUTH-01's rate-limit and password-policy lines):

  ```toml
  jwt_expiry = 3600                      # 1h access token — PRD §7.1
  enable_refresh_token_rotation = true   # single-use refresh tokens
  refresh_token_reuse_interval = 10      # 10s grace for concurrent-tab refresh
  ```

- **Dashboard (manual, one-off, gates DoD)** — verify and set:
  1. Authentication → Configuration → JWT Expiry: `3600`
  2. Authentication → Configuration → Refresh Token Expiry: `604800` (7 days)
  3. Authentication → Configuration → Refresh Token Rotation: **Enabled**
  4. Settings → API → JWT Secret → assert ≥ 64 hex characters (32 bytes); copy and store in Bitwarden.

- **`backend/app/core/security.py`** — new module. Exposes:
  - `AuthUser(id: UUID, role: str, email: str)` — frozen dataclass; callers get IDE autocomplete, not raw `dict`.
  - `get_current_user()` — FastAPI dependency. Extracts `Authorization: Bearer <token>`, decodes the JWT via `python-jose` using `SUPABASE_JWT_SECRET`, raises `HTTP 401` on expiry / invalid signature / missing `sub`. Returns `AuthUser`.
  - `require_role(role: str)` — factory that returns a FastAPI dependency enforcing a specific role. Used from KAT-03 onwards to gate endpoints without repeating the check in each handler body.

- **`backend/app/core/config.py`** — add `supabase_jwt_secret: SecretStr` field (required, no default; the app raises `ValidationError` at startup if the env var is absent — which is intentional: a backend that cannot validate user tokens should not start).

- **`backend/requirements.in`** — add `python-jose[cryptography]>=3.3,<4.0`. The `[cryptography]` extra is required for HS256 decode in newer library versions; `cryptography` itself is already in the tree via `supabase-py` so no new native build dependency is introduced.

- **`backend/tests/test_security.py`** — new pytest file, 12+ assertions covering: valid token → `AuthUser` returned; expired token → `401 token_expired`; wrong secret → `401 invalid_token`; missing `sub` → `401 missing_sub`; no `Authorization` header → `403`; malformed bearer → `401`; correct role → passes `require_role()`; wrong role → `403`; expired token with correct role → `401` (expiry checked before role); config.toml `jwt_expiry` constant assertion; `enable_refresh_token_rotation` constant assertion.

- **`infra/.env.example`** — add the `SUPABASE_JWT_SECRET=` placeholder with a comment that distinguishes it from the service key (validation vs. bypass).

- **`scripts/verify-jwt-config.sh`** — new Bash guard. Greps `supabase/config.toml` for the three required JWT fields and asserts their exact values. When `SUPABASE_JWT_SECRET` is set, also checks the length is ≥ 64. Exits 0 on full pass. Wired into `.github/workflows/ci.yml` under the `db` job (file-filtered to `supabase/config.toml` and `backend/app/core/security.py`) and into `.pre-commit-config.yaml` as a local hook on the same file set.

- **`docs/runbook.md`** — new *"AUTH-03 — JWT configuration operational notes"* section: JWT secret rotation procedure, forced session invalidation (single user + global), Dashboard alignment re-check, refresh token reuse interval tuning, 401-spike triage flow, `python-jose` upgrade checklist.

- **`docs/spring-status.yml`** — flip `AUTH-03.status: TODO → IN_REVIEW` once local DoD is green; `DONE` after Dashboard verification + staging JWT decode drill (§6). Update `summary` counters. Append hand-off line under `project.last_updated`.

### Out of scope (later stories / explicit deferrals)

- **Token blacklisting / server-side revocation list** — Supabase handles revocation by deleting rows from `auth.refresh_tokens`; a Redis-backed blacklist is post-MVD.
- **PKCE / OAuth2 authorization code flow** — MVD is email/password only.
- **Per-role token scopes** (`scope: "farmer:read"` etc.) — PRD §7.1 uses a single `user_role` claim; scoped OAuth is post-MVD.
- **RS256 / asymmetric JWT signing** — Supabase free tier uses HS256 with a shared secret; RS256 upgrade is post-scale.
- **RLS policies** — `get_current_user()` validates the JWT; it does not enable RLS. That is AUTH-04.
- **NGINX rate-limiting on `/auth/v1/token`** — that is AUTH-08. The `# AUTH-08 — RATE LIMITS HERE` insertion point already exists in the INF-06 NGINX config.
- **`verification_status` JWT claim** — that is AUTH-06's extension to the custom access token hook from AUTH-02.

---

## 3. Prerequisites

| Item | Notes |
|---|---|
| [AUTH-01](AUTH-01-email-password-registration.md) merged | A real `auth.users` row and working signup pipeline are needed for the manual JWT decode drill in §6. |
| [AUTH-02](AUTH-02-role-assignment-registration.md) merged | The `user_role` claim must be present in the JWT before §6's decode drill can confirm the full claim set (`sub` + `user_role` + `exp` - `iat` == 3600). |
| `python-jose[cryptography]` installable | Confirmed available on PyPI; no native deps beyond `cryptography`, which is already in the tree via `supabase-py` in [backend/requirements.in](../../backend/requirements.in). |
| Supabase Dashboard access (`qyyxgdfetzjqfpygikbz`) | Manual steps in §5.2 require the team Google-account sign-in. The JWT secret is under **Settings → API**, not the Authentication section. |
| Bitwarden access | The `SUPABASE_JWT_SECRET` entry is created as part of §5.2 step D (copy secret from Dashboard). If the entry already exists from a prior INF-02 setup, update its value and timestamp. |
| Local `SUPABASE_JWT_SECRET` in `backend/.env.local` | Needed for `pytest tests/test_security.py` against the live project. The tests also run with a synthetic secret (`openssl rand -hex 32`) — see §5.6. |

---

## 4. Target configuration

| Setting | Target value | Where set |
|---|---|---|
| Access token lifetime | 3600 s (1 h) | `supabase/config.toml` `[auth].jwt_expiry` **and** Dashboard mirror |
| Refresh token lifetime | 604 800 s (7 days) | Dashboard only — Authentication → Configuration (no `config.toml` key on hosted Supabase) |
| Refresh token rotation | Enabled | `supabase/config.toml` `[auth].enable_refresh_token_rotation = true` **and** Dashboard mirror |
| Reuse grace window | 10 s | `supabase/config.toml` `[auth].refresh_token_reuse_interval = 10` |
| JWT signing algorithm | HS256 | Supabase default — immutable on free tier |
| JWT secret strength | ≥ 64 hex chars (≥ 32 bytes / 256 bits) | Dashboard → Settings → API → JWT Secret; verified by `scripts/verify-jwt-config.sh` when `SUPABASE_JWT_SECRET` is in the environment |
| Backend JWT validation | `python-jose` HS256 decode, `verify_exp=True` (default) | `backend/app/core/security.py` |
| `audience` verification | Disabled (`verify_aud: False`) | Supabase omits `aud` in some auth flows; signature + `sub` + expiry are the security primitives |

---

## 5. Step-by-step implementation

### 5.1 `supabase/config.toml` — explicit JWT lifetimes

Edit [supabase/config.toml](../../supabase/config.toml). The `[auth]` block already exists from AUTH-01. Append the three lines below the last AUTH-01 entry, preserving the existing rate-limit and password-policy lines intact:

```toml
[auth]
# --- existing AUTH-01 settings (do not touch) ---
# enable_signup, enable_confirmations, mailer_otp_exp, site_url …
# [auth.email], [auth.email.password], [auth.rate_limit] blocks …

# AUTH-03 — explicit token lifetimes (PRD §7.1)
jwt_expiry = 3600                      # 1h access token
enable_refresh_token_rotation = true   # single-use refresh tokens — see §1
refresh_token_reuse_interval = 10      # 10s grace for concurrent-tab refresh
```

**Why `refresh_token_reuse_interval = 10`?** A multi-tab browser may fire simultaneous requests that each attempt a silent access-token refresh. Without the grace window, the second concurrent call (arriving milliseconds after the first) gets a `refresh_token_reuse_detected` error and logs the user out. The Supabase-recommended value for web clients is 10 s; it is narrow enough to catch genuine replay attacks but wide enough to survive normal browser behaviour. Increase to 30 s if legitimate multi-tab usage generates spurious logouts post-deploy (§9).

Confirm the change lands without a schema diff:

```bash
supabase db push --linked --dry-run
# Expected output: "No schema changes found"
# (Auth config changes are applied by the hosted Auth service, not schema migrations;
#  --dry-run here confirms no unrelated migration is pending.)
```

The Dashboard steps in §5.2 are the runtime activators for the refresh token lifetime (7d) and rotation — `config.toml` mirrors the intent for source-controlled reproducibility.

### 5.2 Dashboard — alignment steps (manual, gates DoD)

Record each step's outcome in the [docs/runbook.md](../runbook.md) AUTH-03 drill log table.

**A. Verify JWT expiry**
Dashboard → Authentication → Configuration → JWT Expiry.
Assert `3600`. If different, set it and **Save**.

**B. Set refresh token expiry**
Dashboard → Authentication → Configuration → Refresh Token Expiry.
Set `604800` (7 days). **Save**.

**C. Enable refresh token rotation**
Dashboard → Authentication → Configuration → Refresh Token Rotation.
Toggle to **Enabled**. **Save**.

**D. Verify JWT secret strength and store in Bitwarden**
1. Dashboard → Settings → API → JWT Secret → **Reveal**.
2. Count characters. A Supabase-generated secret is 64 hex characters (32 bytes / 256 bits). If shorter, rotate before proceeding (§9 rotation procedure).
3. Copy the full value.
4. In Bitwarden shared vault: create or update entry **`VitaChain — Supabase JWT secret`** with the copied value and today's date in the note field.

**E. Propagate to backend `.env`**
Add `SUPABASE_JWT_SECRET=<value>` to:
- `infra/.env` on the VPS (same convention as `SUPABASE_SERVICE_KEY` — sourced from Bitwarden at deploy time)
- `backend/.env.local` on every developer machine (for `pytest` to hit the live project; the synthetic-secret path in §5.6 also works locally without it)

### 5.3 `backend/app/core/config.py` — add JWT secret field

Edit [backend/app/core/config.py](../../backend/app/core/config.py). Add one field to the `Settings` class:

```python
from pydantic import Field, SecretStr

class Settings(BaseSettings):
    # ... existing fields (supabase_url, supabase_service_key, cors_allow_origins, …) ...

    # AUTH-03 — JWT validation. Sourced from Dashboard → Settings → API → JWT Secret.
    # SecretStr: repr() and structlog serialisers never emit the raw value.
    supabase_jwt_secret: SecretStr = Field(
        ...,
        description="Supabase project JWT secret (HS256, 256-bit minimum). "
                    "Bitwarden: 'VitaChain — Supabase JWT secret'.",
    )
```

`Field(...)` makes this required — the app raises `ValidationError` at startup if the env var is absent. That is the desired behaviour: a backend that cannot validate user tokens must not start silently.

### 5.4 `backend/app/core/security.py` — `get_current_user()` dependency

Create [backend/app/core/security.py](../../backend/app/core/security.py):

```python
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt

from .config import get_settings

_bearer = HTTPBearer()


@dataclass(frozen=True, slots=True)
class AuthUser:
    id: uuid.UUID
    role: str    # public.user_role value — placed in the JWT by AUTH-02's hook
    email: str


def _decode_jwt(token: str) -> dict:
    secret = get_settings().supabase_jwt_secret.get_secret_value()
    try:
        return jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"verify_aud": False},  # Supabase omits `aud` in some auth flows
        )
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token_expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
) -> AuthUser:
    payload = _decode_jwt(creds.credentials)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing_sub",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        uid = uuid.UUID(sub)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_sub",
        )
    return AuthUser(
        id=uid,
        role=payload.get("user_role", ""),    # AUTH-02 custom claim
        email=payload.get("email", ""),
    )


def require_role(required_role: str):
    """Factory returning a FastAPI dependency that enforces a specific role.

    Usage:
        @router.post("/ads", dependencies=[Depends(require_role("FARMER"))])
        async def create_ad(user: AuthUser = Depends(get_current_user)): …
    """
    async def _check(
        user: Annotated[AuthUser, Depends(get_current_user)],
    ) -> AuthUser:
        if user.role != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"role_{required_role.lower()}_required",
            )
        return user

    return _check
```

**Why `"verify_aud": False`?** Supabase sets `aud = "authenticated"` on email/password logins but may omit or vary it on magic-link, OAuth, or admin-created sessions. Disabling audience verification avoids a spurious `401` for those flows. The security primitive is the HMAC-SHA256 signature over the 256-bit secret; `aud` is advisory metadata in this context. If a second Supabase project (e.g. staging vs. prod) is ever added, re-enable `aud` verification to prevent cross-environment token acceptance.

### 5.5 `backend/requirements.in` — add `python-jose`

Edit [backend/requirements.in](../../backend/requirements.in):

```text
# AUTH-03 — JWT decoding / verification
python-jose[cryptography]>=3.3,<4.0
```

Regenerate the lock file:

```bash
cd backend
pip-compile requirements.in -o requirements.txt
```

Confirm `python-jose` and `ecdsa` (a transitive dep) appear in `requirements.txt`. The `cryptography` package itself is already present via `supabase-py` — the compile step aligns their versions automatically.

### 5.6 `backend/tests/test_security.py` — JWT validation test suite

Create [backend/tests/test_security.py](../../backend/tests/test_security.py):

```python
from __future__ import annotations

import time
import uuid

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwt

from app.core.security import AuthUser, get_current_user, require_role

# Synthetic 256-bit secret — never touches Bitwarden or the network.
_SECRET = "test-secret-that-is-exactly-forty-chars!!!"  # 42 chars = 336-bit
_ALG = "HS256"
_UID = str(uuid.uuid4())


def _make_token(
    sub: str = _UID,
    role: str = "FARMER",
    email: str = "farmer@test.local",
    exp_offset: int = 3600,
    secret: str = _SECRET,
) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": sub, "user_role": role, "email": email,
         "iat": now, "exp": now + exp_offset},
        secret,
        algorithm=_ALG,
    )


@pytest.fixture()
def app(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", _SECRET)
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "eyJ.fake.service-key")
    # Re-import settings so monkeypatched env vars take effect.
    import importlib
    import app.core.config as cfg_mod
    importlib.reload(cfg_mod)

    _app = FastAPI()

    @_app.get("/me")
    async def me(user: AuthUser = Depends(get_current_user)):
        return {"id": str(user.id), "role": user.role, "email": user.email}

    @_app.get("/farmer-only")
    async def farmer_only(user: AuthUser = Depends(require_role("FARMER"))):
        return {"ok": True}

    yield _app

    importlib.reload(cfg_mod)


@pytest.fixture()
def client(app):
    return TestClient(app, raise_server_exceptions=False)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestGetCurrentUser:
    def test_valid_token_returns_auth_user(self, client):
        resp = client.get("/me", headers=_auth(_make_token()))
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == _UID
        assert body["role"] == "FARMER"

    def test_expired_token_returns_401(self, client):
        resp = client.get("/me", headers=_auth(_make_token(exp_offset=-1)))
        assert resp.status_code == 401
        assert resp.json()["detail"] == "token_expired"

    def test_wrong_secret_returns_401(self, client):
        resp = client.get("/me", headers=_auth(_make_token(secret="wrong-secret-here")))
        assert resp.status_code == 401
        assert resp.json()["detail"] == "invalid_token"

    def test_missing_sub_returns_401(self, client):
        token = jwt.encode(
            {"user_role": "FARMER", "exp": int(time.time()) + 3600},
            _SECRET, algorithm=_ALG,
        )
        resp = client.get("/me", headers=_auth(token))
        assert resp.status_code == 401
        assert resp.json()["detail"] == "missing_sub"

    def test_no_auth_header_returns_403(self, client):
        # FastAPI HTTPBearer returns 403 when the header is absent.
        assert client.get("/me").status_code == 403

    def test_malformed_bearer_returns_401(self, client):
        resp = client.get("/me", headers=_auth("not.a.valid.jwt"))
        assert resp.status_code == 401


class TestRequireRole:
    def test_correct_role_passes(self, client):
        resp = client.get("/farmer-only", headers=_auth(_make_token(role="FARMER")))
        assert resp.status_code == 200

    def test_wrong_role_returns_403(self, client):
        resp = client.get("/farmer-only", headers=_auth(_make_token(role="RESTAURANT")))
        assert resp.status_code == 403
        assert "farmer" in resp.json()["detail"]

    def test_admin_blocked_by_farmer_gate(self, client):
        resp = client.get("/farmer-only", headers=_auth(_make_token(role="ADMIN")))
        assert resp.status_code == 403

    def test_expired_token_returns_401_not_403(self, client):
        # Expiry must be checked before role — wrong order of checks produces 403 here.
        resp = client.get("/farmer-only", headers=_auth(_make_token(role="FARMER", exp_offset=-1)))
        assert resp.status_code == 401


class TestJwtConfigConstants:
    """Assert that supabase/config.toml carries the exact PRD §7.1 values."""

    def _read_toml(self) -> str:
        import pathlib
        return pathlib.Path("supabase/config.toml").read_text()

    def test_access_token_expiry_is_3600(self):
        assert "jwt_expiry = 3600" in self._read_toml(), \
            "jwt_expiry must be 3600 s (PRD §7.1)"

    def test_refresh_token_rotation_enabled(self):
        assert "enable_refresh_token_rotation = true" in self._read_toml()

    def test_reuse_interval_present(self):
        assert "refresh_token_reuse_interval = 10" in self._read_toml()
```

### 5.7 `infra/.env.example` — JWT secret placeholder

Edit [infra/.env.example](../../infra/.env.example) — add after the `SUPABASE_SERVICE_KEY` block:

```dotenv
# AUTH-03 — JWT validation (backend only)
# Source: Dashboard → Settings → API → JWT Secret
# Bitwarden: "VitaChain — Supabase JWT secret"
# IMPORTANT: this is the *signing* secret used to VALIDATE tokens.
#            It is NOT the service key and does NOT bypass RLS.
#            Must be ≥ 64 hex characters (256 bits). Never commit a real value.
SUPABASE_JWT_SECRET=
```

### 5.8 `scripts/verify-jwt-config.sh` — CI guard

Create [scripts/verify-jwt-config.sh](../../scripts/verify-jwt-config.sh):

```bash
#!/usr/bin/env bash
# AUTH-03 — assert supabase/config.toml JWT settings match PRD §7.1.
# Optional: when SUPABASE_JWT_SECRET is set, also checks its length.
set -euo pipefail

TOML="supabase/config.toml"
FAIL=0

check_field() {
    local key="$1" expected="$2"
    # Match `key = value` at line start; strip inline comments and whitespace.
    local actual
    actual=$(grep -P "^\s*${key}\s*=" "$TOML" \
             | head -1 \
             | sed 's/.*=\s*//' \
             | sed 's/\s*#.*//' \
             | tr -d ' "' \
             || echo "MISSING")
    if [ "$actual" = "$expected" ]; then
        echo "AUTH-03 OK  : $key = $actual"
    else
        echo "AUTH-03 FAIL: $key — expected '$expected', got '$actual'" >&2
        FAIL=1
    fi
}

check_field "jwt_expiry"                    "3600"
check_field "enable_refresh_token_rotation" "true"
check_field "refresh_token_reuse_interval"  "10"

# JWT secret length guard (CI may not have the real secret — skip when unset).
if [ -n "${SUPABASE_JWT_SECRET:-}" ]; then
    len=${#SUPABASE_JWT_SECRET}
    if [ "$len" -ge 64 ]; then
        echo "AUTH-03 OK  : SUPABASE_JWT_SECRET length = $len (≥ 64)"
    else
        echo "AUTH-03 FAIL: SUPABASE_JWT_SECRET is $len chars (need ≥ 64 for 256-bit)" >&2
        FAIL=1
    fi
fi

exit "$FAIL"
```

Wire into [.github/workflows/ci.yml](../../.github/workflows/ci.yml) — add to the `db` job, after the AUTH-02 role-parity step:

```yaml
- name: AUTH-03 — JWT config guard
  run: bash scripts/verify-jwt-config.sh
```

Wire into [.pre-commit-config.yaml](../../.pre-commit-config.yaml) — new local hook:

```yaml
- id: auth03-jwt-config
  name: AUTH-03 JWT config guard
  entry: scripts/verify-jwt-config.sh
  language: script
  files: '^supabase/config\.toml$'
  pass_filenames: false
```

---

## 6. Verification

Run in order on a clean working tree:

```bash
# 1. TOML change is accepted without a schema diff
supabase db push --linked --dry-run
# Expected: "No schema changes found"

# 2. Backend pip-compile
cd backend
pip-compile requirements.in -o requirements.txt
# python-jose must appear in the output

# 3. Backend tests
pytest tests/test_security.py -v
# MUST pass — 12+ assertions.
# All 3 TestJwtConfigConstants tests require supabase/config.toml to be updated first.

pytest tests/
# Full suite must stay green (no regressions in INF-04/INF-08 test files).

# 4. CI guard locally
cd ..
bash scripts/verify-jwt-config.sh
# MUST print 3× OK (4× OK if SUPABASE_JWT_SECRET is set in the environment)

# 5. Dashboard alignment §5.2 steps A–E
#    Complete each step; record outcome in runbook §AUTH-03 drill log.

# 6. Manual staging verification
#    (a) Register a new FARMER user via /register (staging).
#    (b) Log in. In browser devtools → Application → Cookies:
#        copy the `access_token` value from `sb-<ref>-auth-token`.
#        Paste at jwt.io. Decode and assert:
#          "exp" − "iat" == 3600   (1h access token)
#          "user_role" present     (AUTH-02 claim)
#          "sub" is a UUID
#
#    (c) Backend JWT validation — healthy path:
#        TOKEN=<paste access_token from step b>
#        curl -s -H "Authorization: Bearer $TOKEN" \
#          https://staging.vitachain.ma/api/v1/healthz
#        # → 200 OK
#
#    (d) Backend JWT validation — expired path:
#        # Construct an expired token with the real secret for a true E2E check,
#        # OR use the pytest test_expired_token_returns_401 which exercises the
#        # same code path with a synthetic secret. The pytest path is sufficient
#        # for the DoD gate; a live-expiry wait of 1h is optional.
#
#    (e) Refresh token rotation confirmation:
#        In Supabase Dashboard → Authentication → Logs, filter by event
#        "token_refreshed". Perform a page reload on staging (forces silent
#        refresh). Confirm a new event appears. Then check that the old
#        refresh token cannot be used again:
#          - In dashboard → Auth → Users → <test user> → Sessions,
#            confirm only one active session exists after the refresh.
#
#    (f) Typecheck and lint
#        cd backend && ruff check . && mypy app/core/security.py
#        # ruff: All checks passed
#        # mypy: Success: no issues found
```

---

## 7. Risks & failure modes

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Rotation enabled on live project causes multi-tab logout storms** | Medium | Medium — users with > 1 open tab hit `refresh_token_reuse_detected` errors; they get logged out unexpectedly | `refresh_token_reuse_interval = 10` covers the concurrent-refresh window. Monitor Supabase Auth Logs for the event after first prod deploy; if frequency is high for legitimate users, increase to `30` and re-push (§9 tuning). |
| **`supabase db push` silently ignores `[auth]` auth config blocks** | Medium | Medium — TOML changes in source control but the hosted Auth service's JWT expiry stays at its previous value | The §6 Dashboard alignment steps A–C are the authoritative runtime gates. `config.toml` is the intent record; the Dashboard is the truth. The `scripts/verify-jwt-config.sh` guard verifies the *file*, not the live service — the §6 decode drill verifies the live service. |
| **`SUPABASE_JWT_SECRET` leaked through logs or Sentry breadcrumbs** | Low | Critical | `SecretStr` in `config.py` prevents `repr()` / `structlog` leaks. The INF-08 `before_send` Sentry scrubber (see `backend/app/core/observability.py`) strips `Authorization` headers and any key containing `secret`. |
| **`python-jose` unpatched CVE** | Low (monitored) | High | Pin `<4.0`; `pip-audit` in the CI `backend` job catches new advisories. `cryptography` sub-dep is shared with `supabase-py` — their versions are aligned by `pip-compile`. |
| **JWT secret rotated without invalidating existing tokens** | Low — deliberate operator action | High — old tokens remain valid for ≤ 1 h after the Dashboard secret swap | Rotation procedure (§9) includes `DELETE FROM auth.refresh_tokens` *after* the secret swap; the 1-hour window is acknowledged and bounded. |
| **`verify_aud: False` enables cross-environment token acceptance** | Very low for MVD (single Supabase project) | Medium post-MVD | Add `audience="authenticated"` to `jwt.decode()` once a second project (staging-vs-prod split) is created; it is a one-line change. |
| **`require_role()` dependency omitted on a new route** | Medium | Medium — route accidentally opens to all roles | AUTH-07 RLS audit suite sweeps every registered route. ADM-01 and each module story will explicitly add the dependency; a missing one surfaces as a failing RLS test in AUTH-07. |
| **`Settings.supabase_jwt_secret` missing from `.env` → startup `ValidationError`** | Low — deploy runbook covers it | High — service will not start | The `Field(...)` constraint is intentional; the error message from Pydantic is explicit. The VPS deploy step (`make -C infra deploy`) sources `.env` before starting containers. `infra/scripts/preflight.sh` (INF-01) checks for non-empty required vars. |

---

## 8. Definition of Done

- [ ] `supabase/config.toml` `[auth]` block contains `jwt_expiry = 3600`, `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`.
- [ ] Dashboard §5.2 steps A–E completed and recorded in runbook AUTH-03 drill log: JWT expiry 3600 s, refresh expiry 604 800 s, rotation enabled, secret ≥ 64 hex chars, Bitwarden entry created/updated.
- [ ] `backend/app/core/security.py` exists with `AuthUser` dataclass, `get_current_user()` dependency, and `require_role()` factory.
- [ ] `backend/app/core/config.py` has `supabase_jwt_secret: SecretStr` field (required, no default).
- [ ] `backend/requirements.in` includes `python-jose[cryptography]>=3.3,<4.0`; lock file regenerated and `python-jose` appears in `requirements.txt`.
- [ ] `pytest tests/test_security.py` passes 12+ assertions (valid, expired, wrong-secret, missing-sub, no-header, malformed, correct-role, wrong-role, admin-vs-farmer-gate, expiry-before-role, 3× config constants).
- [ ] `pytest tests/` (full suite) stays green — no regressions in INF-04 / INF-08 test files.
- [ ] `infra/.env.example` has the `SUPABASE_JWT_SECRET=` placeholder with the distinguishing comment (validation key, not bypass key).
- [ ] `bash scripts/verify-jwt-config.sh` exits 0 (≥ 3× OK).
- [ ] CI `db` job has the `verify-jwt-config.sh` step; pre-commit hook is wired.
- [ ] Manual staging verification §6: (a) JWT decoded at jwt.io shows `exp − iat == 3600` and `user_role` present; (b) backend returns `401 token_expired` for an expired token; (c) refresh token rotation event visible in Supabase Auth Logs.
- [ ] `ruff check backend/app/core/security.py` and `mypy backend/app/core/security.py` both pass cleanly.
- [ ] `docs/runbook.md` has *"AUTH-03 — JWT configuration operational notes"* section (secret rotation, forced-logout, reuse-interval tuning, 401-spike triage, `python-jose` upgrade checklist).
- [ ] `docs/spring-status.yml` flipped `AUTH-03.status: TODO → IN_REVIEW` (local DoD green); `DONE` after §6 staging verification. `summary` counters updated. Hand-off line appended under `project.last_updated`.

---

## 9. Operational notes (runbook excerpt)

These go into [docs/runbook.md](../runbook.md) under *"AUTH-03 — JWT configuration operational notes"*.

### JWT secret rotation procedure

> **Trigger:** Suspected key compromise, quarterly rotation policy, or security audit finding.

1. **Generate a new 256-bit secret** on a developer machine:
   ```bash
   openssl rand -hex 32   # → 64 hex characters
   ```
2. **Update Bitwarden** — create entry `VitaChain — Supabase JWT secret — ROTATED <date>` with the *current* value. Update the primary `VitaChain — Supabase JWT secret` entry with the new value. Do not delete the old entry until step 6.
3. **Apply to Dashboard** — Settings → API → JWT Secret → paste the new 64-character value (if the Dashboard supports paste) or click **Generate a new secret** if paste is not supported. Note the exact time. Existing access tokens signed with the old key remain valid for ≤ 1 h post-rotation — this is the **risk window**.
4. **Force global session invalidation** to close the risk window immediately:
   ```sql
   -- psql with SUPABASE_DB_URL (DIRECT :5432, service-role connection)
   delete from auth.refresh_tokens;
   ```
   All users will see a re-login prompt on their next page load or when their access token expires (whichever is sooner). For MVD, this is acceptable; schedule during off-peak hours.
5. **Update VPS `.env`:**
   ```bash
   # On the VPS via ssh:
   sed -i 's/^SUPABASE_JWT_SECRET=.*/SUPABASE_JWT_SECRET=<NEW>/' /opt/vitachain/infra/.env
   # Restart the backend container to pick up the new env var:
   make -C /opt/vitachain/infra deploy
   ```
6. **Verify:**
   ```bash
   bash scripts/verify-jwt-config.sh
   # Sign in a test user; decode the JWT at jwt.io; confirm it verifies.
   ```
7. **Archive the old Bitwarden entry** — prepend `ROTATED-<date>-` to its name.

### Forced session invalidation

**Single user (locked-out / suspicious login detected):**
```sql
delete from auth.refresh_tokens
 where user_id = (select id from auth.users where email = 'suspect@example.com');
```
The next access-token refresh returns `401`; the client redirects to login.

**All sessions (post-rotation or global incident):**
```sql
delete from auth.refresh_tokens;
```

### Refresh token reuse interval tuning

Default is `10` seconds. If Supabase Auth Logs show `refresh_token_reuse_detected` events for **legitimate** users (not bots), increase to `30`:
```toml
refresh_token_reuse_interval = 30
```
Then `supabase db push --linked` and update `scripts/verify-jwt-config.sh`'s expected value accordingly. If the events only appear for bot traffic, leave at `10`.

### Triage: 401 spike after deployment

1. Sentry fires on `401_unauthorized` spike (if the rate alert from INF-08 is configured).
2. Check the Supabase Auth Logs pattern:
   - Predominant `expired_token` events → likely a deploy that invalidated sessions (expected); self-resolves within 1h as users re-authenticate. No action unless the spike persists.
   - Predominant `invalid_token` events → `SUPABASE_JWT_SECRET` in the backend `.env` does not match the Dashboard value. Roll back the backend container to the last known-good image; update `.env`; redeploy.
3. Check backend container logs for a `pydantic_core.ValidationError: supabase_jwt_secret field required` message → env var missing entirely → the backend is returning `500` for all routes (not `401`); source the Bitwarden value and restart.

### `python-jose` upgrade checklist

Before bumping the `<4.0` pin in `requirements.in`:
1. Read the `python-jose` changelog for any breaking change to `jwt.decode()` or the `JWTError` / `ExpiredSignatureError` exception hierarchy.
2. Run `pytest tests/test_security.py -v` against the new version in an isolated `venv`.
3. Confirm that `options={"verify_aud": False}` still silences the audience check (this is a library-specific option, not an RFC primitive; it could be renamed in a major version).
4. Check `pip-audit` for CVEs in the new version before committing the lock-file update.

---

## 10. Hand-off notes

- **For AUTH-04 (RLS enable on all sensitive tables):** Every new backend route imports `get_current_user` from `backend/app/core/security.py`. Attach it as a route dependency, or as a router-level dependency on the module sub-router. Pass `user.id` (as `auth.uid()`) and the raw JWT credentials to the `postgrest-py` client's `.set_auth(token)` call so Supabase's own RLS policies fire on the Postgres side. The `require_role()` factory is the FastAPI-layer gate; RLS is the DB-layer gate — both must hold for defence in depth.

- **For AUTH-05 (service key isolation):** `backend/app/core/security.py` makes the split explicit: user-facing endpoints consume `get_current_user()` (their scoped JWT, bounded by RLS); admin/system endpoints use `settings.supabase_service_key` (bypasses RLS — treat as root). The two paths must never be mixed in the same endpoint. The AUTH-05 CI boundary check will grep for any `SUPABASE_SERVICE_KEY` reference outside the allowed set.

- **For AUTH-06 (KYC / `verification_status` claim):** AUTH-06 will extend the `custom_access_token_hook` from AUTH-02 with a second claim. Extend `AuthUser` in parallel: add `verification_status: str` and read `payload.get("verification_status", "PENDING")`. The `require_role()` pattern can be repeated as `require_verified()` using the same factory shape.

- **For AUTH-07 (RLS audit suite):** The `require_role()` dependency is the FastAPI-layer gating mechanism; AUTH-07's test matrix should call each protected endpoint with synthetic JWTs (model: `_make_token()` in `tests/test_security.py`) for every role, assert the correct `200` vs `403`, and also probe the DB-layer RLS independently via `psql`. The `_make_token()` helper is the canonical fixture for those synthetic tokens.

- **For KAT-03 / FAR-01 / SEC-01 (first module endpoints):** Add `user: AuthUser = Depends(get_current_user)` to the handler signature for any authenticated route. For role-gated routes: `user: AuthUser = Depends(require_role("FARMER"))`. The `user.id` field is the caller identity for Supabase RLS; the `user.role` field is the fast pre-DB gate. The combination of both is the double-gating pattern recommended by PRD §8.3.

---

*AUTH-03 implementation guide — generated under BMAD methodology — references PRD §7.1, §8.3 and `docs/spring-status.yml` lines 547–549.*
