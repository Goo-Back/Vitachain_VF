"""Shared test fixtures.

We set fake Supabase env vars BEFORE importing the app so ``get_settings()``
caches harmless dummies. Tests that need the real Supabase reach for the
``integration`` marker (registered in pyproject.toml) and read env directly.
"""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault(
    "SUPABASE_JWT_SECRET",
    "test-jwt-secret-must-be-at-least-thirty-two-bytes",
)

# Imported AFTER env is seeded so get_settings() reads our test values.
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import create_app


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    """Reset the lru_cache between tests so env overrides take effect."""
    get_settings.cache_clear()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client():
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# -- AUTH-07 -------------------------------------------------------------------
# Live-staging fixtures. Skipped cleanly when SUPABASE_URL is unset so the local
# pytest run never reaches for the network. The synthetic JWTs reuse the
# AUTH-03 `_make_token` helper from test_security.py.


@pytest.fixture
def api_base_url() -> str:
    return os.environ.get("API_BASE_URL", "http://localhost:8000")


@pytest.fixture
def identities() -> dict[str, dict[str, str]]:
    """Five identities + the unverified-FARMER probe = six entries.

    Each entry: {"id": <uuid>, "jwt": <synthetic token>, "role": <enum>}.
    The ids match the auth07-*@test.local seeded users by convention; for pure
    JWT-validation tests the id only needs to be a stable UUID.
    """
    import uuid as _uuid

    from tests.test_security import _make_token

    def _row(role: str | None, *, status: str = "VERIFIED") -> dict[str, str]:
        sub = str(_uuid.uuid4())
        extra = {"verification_status": status} if role in {"FARMER", "RESTAURANT"} else None
        return {
            "id": sub,
            "role": role or "",
            "jwt": _make_token(sub=sub, role=role, extra=extra),
        }

    return {
        "farmer_a": _row("FARMER"),
        "farmer_b_unverified": _row("FARMER", status="PENDING"),
        "restaurant": _row("RESTAURANT"),
        "citizen_a": _row("CITIZEN"),
        "admin": _row("ADMIN"),
    }


@pytest.fixture
def staging_citizen_jwt(identities: dict[str, dict[str, str]]) -> str:
    return identities["citizen_a"]["jwt"]


@pytest.fixture
def staging_citizen_jwts(identities: dict[str, dict[str, str]]) -> list[str]:
    """20 synthetic citizen JWTs for the BR-S2 concurrency race.

    Each carries a distinct `sub` so per-user idempotency keys do not collapse
    the requests into a single accepted row before the race even runs.
    """
    import uuid as _uuid

    from tests.test_security import _make_token

    return [
        _make_token(sub=str(_uuid.uuid4()), role="CITIZEN")
        for _ in range(20)
    ]


@pytest.fixture
async def staging_meal_factory():
    """Returns an async callable that mints fresh meals via the service-role
    Supabase client. Skipped when SUPABASE_URL is unset.

    The owner story SEC-01 will define the meal table shape; this factory is
    deliberately defensive so BR-S1 / BR-S2 pytest legs become callable the
    moment SEC-01 merges without a conftest edit.
    """
    if not os.environ.get("SUPABASE_URL"):
        pytest.skip("staging_meal_factory requires SUPABASE_URL")

    try:
        from app.core.supabase import get_supabase_admin as service_client
    except ImportError:
        pytest.skip("service_client not importable in this test environment")

    created: list[str] = []

    async def _create(*, quantity_remaining: int = 1) -> str:
        client = service_client()
        owner_id = os.environ.get("AUTH07_RESTAURANT_ID")
        if not owner_id:
            pytest.skip("AUTH07_RESTAURANT_ID env var required for meal_factory")
        payload = {
            "owner_id": owner_id,
            "title": "AUTH-07 fixture meal",
            "status": "ACTIVE",
            "price_mad": 35.00,
            "quantity_remaining": quantity_remaining,
            "deadline": "2099-01-01T00:00:00Z",
        }
        try:
            response = client.schema("secondserve").table("meals").insert(payload).execute()
        except Exception as exc:  # noqa: BLE001 — surface defensively
            pytest.skip(f"secondserve.meals not reachable: {exc}")
        row_id: str = response.data[0]["id"]
        created.append(row_id)
        return row_id

    yield _create

    # Best-effort cleanup. Failures here are not test failures.
    try:
        from app.core.supabase import get_supabase_admin as service_client

        client = service_client()
        for mid in created:
            try:
                client.schema("secondserve").table("meals").delete().eq("id", mid).execute()
            except Exception:  # noqa: BLE001
                pass
    except Exception:  # noqa: BLE001
        pass
