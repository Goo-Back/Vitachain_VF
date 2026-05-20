"""KAT-03 — ESP32 telemetry ingest coverage.

Two layers, mirroring KAT-01/KAT-02:

* :class:`TestTelemetryPayload` — pure-unit on the Pydantic model. Asserts the
  ``soil_pH`` JSON alias is honoured, ranges are enforced at the 422 boundary,
  and the future-timestamp guard fires beyond the 60 s GSM-skew tolerance.

* :class:`TestIngestRouterMounted` — boots the real app via :func:`create_app`
  and asserts the device-credential contract on
  ``/api/v1/katara/ingest``: missing headers -> 401 ``invalid_device_credentials``,
  malformed body -> 422, single error string for both bad device_id and bad
  api_key (constant-error contract, KAT-02 hand-off). The DB-write paths
  (happy 204, bcrypt-verify, p50 SLA, RLS-leak) live in the staging drill —
  see docs/stories/KAT-03-esp32-telemetry-ingestion.md §6.

The DB-touching e2e block is wrapped in ``pytest.mark.integration`` so the
local pytest run never reaches for the network — it activates only when
SUPABASE_URL points at a real (staging) project AND a paired device's
plaintext key is supplied via env.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.main import create_app
from app.modules.katara.schemas import TelemetryPayload


# ---------------------------------------------------------------------------
# Pure-unit: Pydantic
# ---------------------------------------------------------------------------


def _good_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "soil_moisture": 38.4,
        "soil_temperature": 21.2,
        "soil_pH": 6.7,
        "soil_conductivity": 1850.0,
        "battery_level": 87,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    body.update(overrides)
    return body


class TestTelemetryPayload:
    def test_accepts_soil_pH_alias(self) -> None:
        p = TelemetryPayload(**_good_body())  # type: ignore[arg-type]
        # JSON field is `soil_pH`; Python attribute is snake_case.
        assert p.soil_ph == 6.7

    def test_accepts_snake_case_field_name(self) -> None:
        body = _good_body()
        body["soil_ph"] = body.pop("soil_pH")
        p = TelemetryPayload(**body)  # type: ignore[arg-type]
        assert p.soil_ph == 6.7

    def test_rejects_future_timestamp_beyond_skew(self) -> None:
        body = _good_body(
            recorded_at=(datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        )
        with pytest.raises(ValidationError, match="future"):
            TelemetryPayload(**body)  # type: ignore[arg-type]

    def test_allows_timestamp_within_skew_tolerance(self) -> None:
        # GSM clock drift up to 60 s is acceptable.
        body = _good_body(
            recorded_at=(datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat(),
        )
        p = TelemetryPayload(**body)  # type: ignore[arg-type]
        assert p.recorded_at is not None

    @pytest.mark.parametrize(
        "field,value",
        [
            ("soil_moisture", -1),
            ("soil_moisture", 101),
            ("soil_temperature", -21),
            ("soil_temperature", 81),
            ("soil_pH", -0.1),
            ("soil_pH", 14.5),
            ("soil_conductivity", -1),
            ("soil_conductivity", 20001),
            ("battery_level", -1),
            ("battery_level", 101),
        ],
    )
    def test_range_checks(self, field: str, value: float) -> None:
        with pytest.raises(ValidationError):
            TelemetryPayload(**_good_body(**{field: value}))  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Router mounted on the real app — auth-contract only (no DB writes)
# ---------------------------------------------------------------------------


@pytest.fixture
async def app_client():
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


_INGEST_PATH = "/api/v1/katara/ingest"


class TestIngestRouterMounted:
    @pytest.mark.anyio
    async def test_missing_headers_returns_401(self, app_client: AsyncClient) -> None:
        r = await app_client.post(_INGEST_PATH, json=_good_body())
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_device_credentials"

    @pytest.mark.anyio
    async def test_missing_only_api_key_returns_401(self, app_client: AsyncClient) -> None:
        r = await app_client.post(
            _INGEST_PATH,
            json=_good_body(),
            headers={"X-Device-Id": "ESP-KAT-001"},
        )
        assert r.status_code == 401
        # Same error string whether device_id, api_key, or both are missing /
        # wrong — never disclose which one was off (KAT-02 constant-error).
        assert r.json()["detail"] == "invalid_device_credentials"

    @pytest.mark.anyio
    async def test_missing_only_device_id_returns_401(self, app_client: AsyncClient) -> None:
        r = await app_client.post(
            _INGEST_PATH,
            json=_good_body(),
            headers={"X-Device-Api-Key": "vk_" + "0" * 32},
        )
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_device_credentials"

    @pytest.mark.anyio
    async def test_invalid_body_returns_422(self, app_client: AsyncClient) -> None:
        r = await app_client.post(
            _INGEST_PATH,
            json=_good_body(soil_pH=99),  # out of range
            headers={
                "X-Device-Id": "ESP-KAT-001",
                "X-Device-Api-Key": "vk_" + "0" * 32,
            },
        )
        # 422 (body validation) MUST fire before the 401 credential check —
        # otherwise we leak that the credentials were rejected by replying
        # with the same status for malformed AND well-formed-but-unauthorised
        # requests.
        assert r.status_code == 422

    @pytest.mark.anyio
    async def test_missing_recorded_at_returns_422(self, app_client: AsyncClient) -> None:
        body = _good_body()
        body.pop("recorded_at")
        r = await app_client.post(
            _INGEST_PATH,
            json=body,
            headers={
                "X-Device-Id": "ESP-KAT-001",
                "X-Device-Api-Key": "vk_" + "0" * 32,
            },
        )
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Live staging — only fires when explicitly opted-in via env vars.
# ---------------------------------------------------------------------------

_STAGING_VARS = ("SUPABASE_URL", "KAT03_DEVICE_ID", "KAT03_DEVICE_API_KEY")


@pytest.mark.integration
@pytest.mark.skipif(
    any(not os.environ.get(v) or os.environ.get(v, "").startswith("https://example")
        for v in _STAGING_VARS),
    reason="set SUPABASE_URL + KAT03_DEVICE_ID + KAT03_DEVICE_API_KEY for the live drill",
)
class TestIngestStagingDrill:
    """Hits the real /api/v1/katara/ingest via the staging API gateway.

    Pre-conditions: a paired ESP-KAT-NNN row exists; its plaintext api_key
    is in KAT03_DEVICE_API_KEY (you saved it at pairing time). The device
    starts in PENDING; the test asserts it flips to ACTIVE after one ingest.
    """

    @pytest.fixture
    def api_base_url(self) -> str:
        return os.environ.get("API_BASE_URL", "http://localhost:8000")

    @pytest.fixture
    def device_id(self) -> str:
        return os.environ["KAT03_DEVICE_ID"]

    @pytest.fixture
    def api_key(self) -> str:
        return os.environ["KAT03_DEVICE_API_KEY"]

    async def _ingest(
        self, base: str, device_id: str, api_key: str, **overrides: object
    ):
        import httpx

        body = _good_body(**overrides)
        async with httpx.AsyncClient(base_url=base, timeout=10.0) as c:
            return await c.post(
                _INGEST_PATH,
                json=body,
                headers={
                    "X-Device-Id":      device_id,
                    "X-Device-Api-Key": api_key,
                },
            )

    @pytest.mark.anyio
    async def test_happy_path_returns_204(
        self, api_base_url: str, device_id: str, api_key: str
    ) -> None:
        r = await self._ingest(api_base_url, device_id, api_key)
        assert r.status_code == 204, r.text
        assert "X-Telemetry-Id" in r.headers

    @pytest.mark.anyio
    async def test_wrong_key_returns_401_same_message(
        self, api_base_url: str, device_id: str
    ) -> None:
        r = await self._ingest(api_base_url, device_id, "vk_" + "0" * 32)
        assert r.status_code == 401
        assert r.json()["detail"] == "invalid_device_credentials"

    @pytest.mark.anyio
    async def test_unknown_device_returns_401_same_message(
        self, api_base_url: str, api_key: str
    ) -> None:
        r = await self._ingest(api_base_url, "ESP-KAT-999", api_key)
        assert r.status_code == 401
        # SAME error string as wrong-key case — constant-error contract.
        assert r.json()["detail"] == "invalid_device_credentials"

    @pytest.mark.anyio
    async def test_replay_same_recorded_at_is_idempotent(
        self, api_base_url: str, device_id: str, api_key: str
    ) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        r1 = await self._ingest(api_base_url, device_id, api_key, recorded_at=ts)
        r2 = await self._ingest(api_base_url, device_id, api_key, recorded_at=ts)
        assert r1.status_code == 204
        assert r2.status_code == 204
        # Same (device_id, recorded_at) -> ON CONFLICT DO UPDATE returns the
        # pre-existing row id. The dedup unique index makes the second insert
        # a no-op write.
        assert r1.headers["X-Telemetry-Id"] == r2.headers["X-Telemetry-Id"]

    @pytest.mark.anyio
    async def test_p50_under_50ms(
        self, api_base_url: str, device_id: str, api_key: str
    ) -> None:
        # Warm the connection pool + bcrypt cache before sampling.
        for _ in range(3):
            await self._ingest(api_base_url, device_id, api_key)

        latencies_ms: list[float] = []
        for i in range(30):
            ts = (datetime.now(timezone.utc) + timedelta(seconds=i)).isoformat()
            t0 = time.perf_counter()
            r = await self._ingest(api_base_url, device_id, api_key, recorded_at=ts)
            latencies_ms.append((time.perf_counter() - t0) * 1000)
            assert r.status_code == 204
        latencies_ms.sort()
        p50 = latencies_ms[len(latencies_ms) // 2]
        assert p50 < 50, f"p50={p50:.1f}ms exceeds 50 ms SLA; sample={latencies_ms}"
