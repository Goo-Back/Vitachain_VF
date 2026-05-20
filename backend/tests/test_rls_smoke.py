"""AUTH-04 — live RLS smoke against staging Supabase.

Skipped automatically when staging credentials are not present in the env.
CI does not run this leg — the throw-away Postgres 17 service in CI has no
PostgREST / auth schema. The drill is the §6 staging cross-role test:

    SUPABASE_URL=https://qyyxgdfetzjqfpygikbz.supabase.co \\
    SUPABASE_DB_URL=postgresql://postgres:...@db.qyy....supabase.co:5432/postgres \\
    SUPABASE_ANON_KEY=eyJ...anon \\
    SUPABASE_SERVICE_ROLE_KEY=eyJ...service \\
    SUPABASE_JWT_SECRET=<dashboard secret> \\
    pytest tests/test_rls_smoke.py -v

The fixtures (see ``conftest.py``) seed a FARMER + RESTAURANT pair under the
service role, mint synthetic JWTs with :func:`tests.test_security._make_token`,
and tear down on exit.
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("SUPABASE_URL", "").startswith("https://")
    or os.getenv("SUPABASE_URL", "").startswith("https://example.")
    or not os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("SUPABASE_ANON_KEY") == "test-anon-key",
    reason="live RLS smoke requires staging Supabase credentials",
)


def _mint(sub: str, role: str) -> str:
    # Reuse the AUTH-03 synthetic-token helper so the secret resolution path
    # (settings.supabase_jwt_secret) is exercised end-to-end.
    from tests.test_security import _make_token

    return _make_token(sub=sub, role=role)


def test_farmer_sees_only_own_profile(staging_farmer_id, staging_restaurant_id):
    from app.db import user_scoped_client

    token = _mint(staging_farmer_id, "FARMER")
    rows = (
        user_scoped_client(token)
        .table("profiles")
        .select("id")
        .execute()
        .data
    )
    assert len(rows) == 1, f"expected exactly 1 row, got {len(rows)}"
    assert rows[0]["id"] == staging_farmer_id


def test_farmer_cannot_update_restaurant_row(
    staging_farmer_id, staging_restaurant_id
):
    from app.db import user_scoped_client

    token = _mint(staging_farmer_id, "FARMER")
    result = (
        user_scoped_client(token)
        .table("profiles")
        .update({"full_name": "hacked-by-farmer"})
        .eq("id", staging_restaurant_id)
        .execute()
    )
    # PostgREST returns an empty data array when RLS filters every row —
    # no exception, no rows touched.
    assert result.data == [], (
        "RLS leak: FARMER UPDATE on RESTAURANT row affected rows: "
        f"{result.data!r}"
    )
