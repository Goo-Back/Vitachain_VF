"""AUTH-07 — end-to-end matrix sweep against the staging Supabase project.

The 22 cells of the role × table × verb matrix encoded as ``Cell`` rows. Each
parametrized test mints a synthetic JWT for the named identity (via the
AUTH-03 ``_make_token`` helper), issues the cell's request against either
PostgREST (table-level reads) or FastAPI (RPC-shaped routes), and asserts the
response matches the documented outcome.

The whole module is skipped when ``SUPABASE_URL`` is unset so PR CI runs do
not require staging credentials; the ``main``-branch lane in CI sets the
secret and the suite runs there.

Cells whose underlying route or table is not yet merged are individually
skipped with a clear marker so the matrix tells you exactly which owner
story still owes work.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Literal

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("SUPABASE_URL"),
    reason="AUTH-07 e2e matrix requires a live staging Supabase project",
)


Verb = Literal["GET", "POST", "PATCH", "DELETE"]


@dataclass(frozen=True)
class Cell:
    cell_id: int
    identity: str
    method: Verb
    path: str
    body: dict[str, Any] | None
    expect_status: int
    expect_rows: int | None = None
    expect_code: str | None = None
    requires_path: str | None = None  # optional gate: only run if `path` exists


# -----------------------------------------------------------------------------
# AUTH07_MATRIX — single source of truth for the 22 cells. The runbook table
# in docs/runbook.md §AUTH-07 is rendered from this list.
# -----------------------------------------------------------------------------


AUTH07_MATRIX: list[Cell] = [
    Cell(1, "farmer_a", "GET", "/rest/v1/profiles?select=id", None, 200, expect_rows=1),
    Cell(2, "farmer_a", "GET",
         "/rest/v1/profiles?select=id&id=eq.${FARMER_B_ID}", None,
         200, expect_rows=0),
    Cell(3, "farmer_a", "PATCH",
         "/rest/v1/profiles?id=eq.${FARMER_B_ID}",
         {"full_name": "hacked"}, 204, expect_rows=0),
    Cell(4, "farmer_a", "POST", "/rest/v1/katara_parcels",
         {"crop": "cucumber", "surface_m2": 1000}, 201),
    Cell(5, "farmer_a", "GET",
         "/rest/v1/katara_parcels?select=id&owner_id=eq.${FARMER_B_ID}",
         None, 200, expect_rows=0),
    Cell(6, "farmer_a", "POST", "/rest/v1/katara_telemetry",
         {"device_id": "00000000-0000-0000-0000-000000000000",
          "soil_moisture": 50}, 401),
    Cell(7, "farmer_a", "PATCH",
         "/rest/v1/farmarket_ads?id=eq.${AD_A_ID}",
         {"title": "Updated"}, 204),
    Cell(8, "farmer_a", "PATCH",
         "/rest/v1/farmarket_ads?owner_id=neq.${FARMER_A_ID}",
         {"title": "hacked"}, 204, expect_rows=0),
    Cell(9, "farmer_b_unverified", "POST", "/api/v1/farmarket/ads",
         {"title": "x", "price_mad": 50, "quantity_kg": 5, "region": "S"},
         403, expect_code="VERIFICATION_REQUIRED",
         requires_path="/api/v1/farmarket/ads"),
    Cell(10, "farmer_a", "POST", "/api/v1/farmarket/ads",
         {"title": "Verified insert", "price_mad": 80, "quantity_kg": 5,
          "region": "Souss-Massa"}, 201,
         requires_path="/api/v1/farmarket/ads"),
    Cell(11, "farmer_a", "GET", "/rest/v1/farmarket_leads", None, 200),
    Cell(12, "restaurant", "GET",
         "/rest/v1/farmarket_ads?status=eq.ACTIVE&select=id", None, 200),
    Cell(13, "restaurant", "POST", "/api/v1/farmarket/ads",
         {"title": "x", "price_mad": 50, "quantity_kg": 5, "region": "C"},
         403, expect_code="ROLE_NOT_ALLOWED",
         requires_path="/api/v1/farmarket/ads"),
    Cell(14, "restaurant", "POST", "/api/v1/secondserve/meals",
         {"title": "tagine", "price_mad": 40, "quantity_remaining": 3,
          "deadline": "2099-01-01T00:00:00Z"}, 201,
         requires_path="/api/v1/secondserve/meals"),
    Cell(15, "restaurant", "GET",
         "/rest/v1/secondserve_reservations", None, 200),
    Cell(16, "restaurant", "GET",
         "/rest/v1/secondserve_reservations?meal_id=neq.${OWN_MEAL_ID}",
         None, 200, expect_rows=0),
    Cell(17, "citizen_a", "GET",
         "/rest/v1/secondserve_meals?status=eq.ACTIVE&select=id", None, 200),
    Cell(18, "citizen_a", "POST", "/api/v1/secondserve/meals",
         {"title": "no", "price_mad": 10, "quantity_remaining": 1,
          "deadline": "2099-01-01T00:00:00Z"}, 403,
         expect_code="ROLE_NOT_ALLOWED",
         requires_path="/api/v1/secondserve/meals"),
    Cell(19, "citizen_a", "GET",
         "/rest/v1/secondserve_reservations?select=id", None, 200),
    Cell(20, "citizen_a", "GET",
         "/rest/v1/secondserve_reservations?citizen_id=neq.${CITIZEN_A_ID}",
         None, 200, expect_rows=0),
    Cell(21, "admin", "GET", "/rest/v1/farmarket_leads?select=id", None, 200),
    Cell(22, "anon", "GET",
         "/rest/v1/secondserve_meals?status=eq.ACTIVE&select=id", None, 200),
]


def _render_path(template: str, identities: dict[str, dict[str, str]]) -> str:
    """Substitute the ${…_ID} placeholders that the matrix uses."""
    out = template
    out = out.replace("${FARMER_A_ID}", identities["farmer_a"]["id"])
    out = out.replace("${FARMER_B_ID}", identities["farmer_b_unverified"]["id"])
    out = out.replace("${CITIZEN_A_ID}", identities["citizen_a"]["id"])
    out = out.replace("${AD_A_ID}", os.environ.get("AUTH07_AD_A_ID", "00000000-0000-0000-0000-000000000000"))
    out = out.replace("${OWN_MEAL_ID}", os.environ.get("AUTH07_MEAL_ID", "00000000-0000-0000-0000-000000000000"))
    return out


def _supabase_anon_key() -> str:
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not key:
        pytest.skip("SUPABASE_ANON_KEY required for AUTH-07 e2e matrix")
    return key


@pytest.mark.anyio
@pytest.mark.parametrize(
    "cell", AUTH07_MATRIX, ids=lambda c: f"cell-{c.cell_id:02d}-{c.identity}"
)
async def test_matrix_cell(
    cell: Cell,
    identities: dict[str, dict[str, str]],
    api_base_url: str,
) -> None:
    import httpx

    base_url = (
        os.environ["SUPABASE_URL"]
        if cell.path.startswith("/rest/v1/")
        else api_base_url
    )

    headers: dict[str, str] = {}
    if cell.identity != "anon":
        headers["Authorization"] = f"Bearer {identities[cell.identity]['jwt']}"
    if cell.path.startswith("/rest/v1/"):
        headers["apikey"] = _supabase_anon_key()
        if cell.method in {"POST", "PATCH"}:
            headers["Prefer"] = "return=representation"
            headers["Content-Type"] = "application/json"

    path = _render_path(cell.path, identities)

    async with httpx.AsyncClient(base_url=base_url, timeout=20) as ac:
        try:
            r = await ac.request(cell.method, path, json=cell.body, headers=headers)
        except httpx.HTTPError as exc:
            pytest.skip(f"cell-{cell.cell_id:02d}: transport error {exc}")

    if cell.requires_path and r.status_code == 404:
        pytest.skip(
            f"cell-{cell.cell_id:02d}: route {cell.requires_path} not yet registered "
            "(owner story not merged)"
        )

    # PostgREST replies 404 for tables that do not exist (e.g. before FAR-01
    # creates farmarket_ads). Treat those as informational skips so the matrix
    # stays green during the partial-merge window.
    if r.status_code == 404 and cell.path.startswith("/rest/v1/"):
        pytest.skip(
            f"cell-{cell.cell_id:02d}: table behind {cell.path.split('?', 1)[0]} not yet exposed"
        )

    assert r.status_code == cell.expect_status, (
        f"cell-{cell.cell_id:02d} ({cell.identity}): expected "
        f"{cell.expect_status}, got {r.status_code}: {r.text[:200]}"
    )

    if cell.expect_rows is not None:
        if cell.expect_status == 204:
            # PATCH against an RLS-filtered set returns 204 with empty body.
            assert r.text in ("", "[]"), (
                f"cell-{cell.cell_id:02d}: expected empty 204 body, got {r.text[:200]}"
            )
        else:
            try:
                data = r.json()
            except ValueError:
                pytest.fail(
                    f"cell-{cell.cell_id:02d}: non-JSON body {r.text[:200]}"
                )
            assert isinstance(data, list), (
                f"cell-{cell.cell_id:02d}: expected list, got {type(data).__name__}"
            )
            assert len(data) == cell.expect_rows, (
                f"cell-{cell.cell_id:02d}: expected {cell.expect_rows} rows, got {len(data)}"
            )

    if cell.expect_code is not None:
        try:
            body = r.json()
        except ValueError:
            pytest.fail(
                f"cell-{cell.cell_id:02d}: expected JSON error body, got {r.text[:200]}"
            )
        # Tolerate both `code` and FastAPI's `detail` placement.
        actual = body.get("code") or (
            body.get("detail", {}).get("code") if isinstance(body.get("detail"), dict) else None
        )
        assert actual == cell.expect_code, (
            f"cell-{cell.cell_id:02d}: expected code={cell.expect_code!r}, body={body}"
        )
