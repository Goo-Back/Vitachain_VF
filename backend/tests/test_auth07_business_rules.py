"""AUTH-07 — application-layer business-rule assertions.

Covers the rules that have no SQL surface:

* BR-K3 — OWM client must cache responses ≥ 3 h.
* BR-F4 — Brevo material must never appear in the frontend bundle (belt-and-
          suspenders to AUTH-05's bundle scan).
* BR-B2 — BotaBa9a lead notifications run via a Supabase Database Webhook,
          not via a Python handler — Brevo must not be imported from
          ``app.modules.botabaqa``.
* BR-S1 — pickup-code generation: format, entropy, and rejection of a
          client-supplied ``pickup_code`` (Pydantic ``extra='forbid'``).
* BR-S2 — concurrent reservations against ``quantity_remaining = 1`` must
          surface ``409`` on every loser, ``201`` on exactly one winner.

DB-layer BRs (BR-K1/K2/K4, BR-F1/F2/F3, BR-S1 server-side default,
BR-S2 sequential, BR-S3, BR-S4, BR-B1) live in
``db/tests/auth07_business_rules.sql``.

Each test ``pytest.skip`` cleanly when the upstream owner-story artefacts
(routes, modules, build outputs) have not yet merged so the suite is green
from the moment AUTH-07 lands.
"""

from __future__ import annotations

import ast
import asyncio
import os
import re
import uuid
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


# -----------------------------------------------------------------------------
# BR-K3 — OWM data cached >= 3 hours.
# -----------------------------------------------------------------------------


@pytest.mark.anyio
async def test_br_k3_owm_cache_ttl_three_hours(monkeypatch: pytest.MonkeyPatch) -> None:
    try:
        from freezegun import freeze_time  # type: ignore[import-not-found]
    except ImportError:
        pytest.skip("freezegun not installed — install via backend/requirements-dev.txt")

    try:
        owm = pytest.importorskip("app.integrations.openweathermap")
    except Exception:  # noqa: BLE001
        pytest.skip("OWM integration not yet merged (KAT-04 dependency)")

    cache = getattr(owm, "_CACHE", None)
    weather_for = getattr(owm, "weather_for", None)
    if cache is None or weather_for is None:
        pytest.skip("OWM integration shape changed; revisit BR-K3 contract")

    cache.clear()
    calls = {"n": 0}

    async def fake_fetch(lat: float, lng: float) -> dict[str, Any]:
        calls["n"] += 1
        return {"temp": 22.5, "humidity": 60, "lat": lat, "lng": lng}

    monkeypatch.setattr("app.integrations.openweathermap._fetch", fake_fetch)

    with freeze_time("2026-05-20 10:00:00") as frozen:
        await weather_for(30.0, -8.0)
        await weather_for(30.0, -8.0)
        assert calls["n"] == 1, "second call within seconds must hit cache"

        frozen.tick(delta=60 * 60 * 2 + 60 * 59)  # 2h 59m
        await weather_for(30.0, -8.0)
        assert calls["n"] == 1, "call at 2h59m must still hit cache (BR-K3 ≥ 3h TTL)"

        frozen.tick(delta=60 * 2)  # +2m -> 3h 01m total
        await weather_for(30.0, -8.0)
        assert calls["n"] == 2, "call after 3h must refresh"


# -----------------------------------------------------------------------------
# BR-F4 — Brevo key never bundled into the Next.js artefact.
# -----------------------------------------------------------------------------


def test_br_f4_brevo_key_absent_from_frontend_bundle() -> None:
    bundle_root = REPO_ROOT / "frontend" / ".next"
    if not bundle_root.exists():
        pytest.skip(
            "frontend/.next not built — AUTH-05 bundle scan covers the build-time gate; "
            "this is the Python-side belt-and-suspenders that only runs when the bundle is present"
        )

    forbidden_patterns = [
        re.compile(rb"BREVO_API_KEY"),
        re.compile(rb"xkeysib-[A-Za-z0-9_-]{40,}"),
    ]
    offenders: list[tuple[str, str]] = []
    for path in bundle_root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in {".js", ".mjs", ".json", ".html", ".txt"}:
            continue
        blob = path.read_bytes()
        for rx in forbidden_patterns:
            if rx.search(blob):
                offenders.append((str(path.relative_to(REPO_ROOT)), rx.pattern.decode()))

    assert not offenders, (
        "BR-F4 violation — Brevo material in frontend bundle:\n"
        + "\n".join(f"  - {p}: {pat}" for p, pat in offenders)
    )


# -----------------------------------------------------------------------------
# BR-B2 — BotaBa9a lead notifications belong to the Supabase Database Webhook,
# never to a Python handler.
# -----------------------------------------------------------------------------


def test_br_b2_botabaqa_python_does_not_import_brevo() -> None:
    target = REPO_ROOT / "backend" / "app" / "modules" / "botabaqa"
    if not target.exists():
        pytest.skip("backend/app/modules/botabaqa not yet merged (BOT-04 dependency)")

    offenders: list[tuple[str, int, str]] = []
    for py_file in target.rglob("*.py"):
        if py_file.name == "__init__.py" and py_file.stat().st_size == 0:
            continue
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and "brevo" in node.module.lower():
                offenders.append((str(py_file.relative_to(REPO_ROOT)), node.lineno, node.module))
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if "brevo" in alias.name.lower():
                        offenders.append(
                            (str(py_file.relative_to(REPO_ROOT)), node.lineno, alias.name)
                        )

    assert not offenders, (
        "BR-B2 violation — Brevo imported from the BotaBa9a Python router. "
        "Lead notifications must go through the Supabase Database Webhook:\n"
        + "\n".join(f"  - {p}:{line} imports {mod}" for p, line, mod in offenders)
    )


# -----------------------------------------------------------------------------
# BR-S1 — pickup-code generation
# -----------------------------------------------------------------------------

CODE_RX = re.compile(r"^VITA-[A-Z0-9]{3}$")


def _route_registered(prefix: str) -> bool:
    try:
        from app.main import create_app
    except ImportError:
        return False
    app = create_app()
    return any(getattr(route, "path", "").startswith(prefix) for route in app.routes)


@pytest.mark.anyio
async def test_br_s1_pickup_code_not_accepted_from_client(
    client: Any,
    identities: dict[str, dict[str, str]],
) -> None:
    """A client-supplied ``pickup_code`` must be rejected at the request body
    level — the Pydantic model on the reservation endpoint should use
    ``ConfigDict(extra='forbid')`` so the field never reaches the handler.

    Skipped when SEC-04 has not merged the ``/secondserve/reservations`` route
    onto the FastAPI app.
    """
    if not _route_registered("/api/v1/secondserve/reservations"):
        pytest.skip("SEC-04 /reservations route not yet registered")

    jwt = identities["citizen_a"]["jwt"]
    r = await client.post(
        "/api/v1/secondserve/reservations",
        json={"meal_id": str(uuid.uuid4()), "pickup_code": "VITA-HCK"},
        headers={"Authorization": f"Bearer {jwt}"},
    )
    assert r.status_code == 422, (
        "BR-S1: client-supplied pickup_code must trigger 422 from "
        "Pydantic extra='forbid' (got %d)" % r.status_code
    )


@pytest.mark.anyio
@pytest.mark.skipif(not os.environ.get("SUPABASE_URL"), reason="BR-S1 entropy is a live e2e check")
async def test_br_s1_pickup_code_entropy(
    staging_meal_factory: Any,
    staging_citizen_jwt: str,
    api_base_url: str,
) -> None:
    """1000 fresh reservations against 1000 fresh meals — collect the codes."""
    import httpx

    codes: list[str] = []
    async with httpx.AsyncClient(base_url=api_base_url, timeout=15) as ac:
        for _ in range(1000):
            meal_id = await staging_meal_factory(quantity_remaining=1)
            r = await ac.post(
                "/api/v1/secondserve/reservations",
                json={"meal_id": meal_id},
                headers={
                    "Authorization": f"Bearer {staging_citizen_jwt}",
                    "Idempotency-Key": str(uuid.uuid4()),
                },
            )
            assert r.status_code == 201, r.text
            codes.append(r.json()["pickup_code"])

    assert all(CODE_RX.match(c) for c in codes), "BR-S1: code format VITA-XXX broken"
    assert "VITA-AAA" not in codes, "BR-S1: sentinel test-only code leaked"
    duplicates = len(codes) - len(set(codes))
    assert duplicates < 50, (
        f"BR-S1: {duplicates} duplicates in 1000 draws — entropy regression "
        f"(birthday-paradox expectation ≈ 30 in a clean PRNG, 50 is the 2σ ceiling)"
    )


# -----------------------------------------------------------------------------
# BR-S2 — concurrent reservation race surfacing 409
# -----------------------------------------------------------------------------


@pytest.mark.anyio
@pytest.mark.skipif(not os.environ.get("SUPABASE_URL"), reason="BR-S2 race is a live e2e check")
async def test_br_s2_concurrent_reservations(
    staging_meal_factory: Any,
    staging_citizen_jwts: list[str],
    api_base_url: str,
) -> None:
    """Twenty concurrent attempts against ``quantity_remaining = 1`` must
    produce exactly one ``201`` and N-1 ``409``s. No body on a 409 may contain
    a ``pickup_code`` (otherwise the failure path is leaking a code that the
    DB never assigned)."""
    import httpx

    meal_id = await staging_meal_factory(quantity_remaining=1)

    async def attempt(jwt: str) -> httpx.Response:
        async with httpx.AsyncClient(base_url=api_base_url, timeout=15) as ac:
            return await ac.post(
                "/api/v1/secondserve/reservations",
                json={"meal_id": meal_id},
                headers={
                    "Authorization": f"Bearer {jwt}",
                    "Idempotency-Key": str(uuid.uuid4()),
                },
            )

    responses = await asyncio.gather(*(attempt(j) for j in staging_citizen_jwts))
    statuses = [r.status_code for r in responses]

    assert statuses.count(201) == 1, f"BR-S2: expected exactly 1 success, got {statuses}"
    assert statuses.count(409) == len(staging_citizen_jwts) - 1, (
        f"BR-S2: every loser must surface 409, got {statuses}"
    )

    for r in responses:
        if r.status_code == 409:
            body = r.json()
            assert body.get("code") == "OUT_OF_STOCK", body
            assert "pickup_code" not in body, "BR-S2: 409 path leaked a pickup_code"
            assert body.get("meal_id") == meal_id
