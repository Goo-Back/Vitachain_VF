"""KAT-03 — ESP32 telemetry ingestion endpoint.

Hot path. SLA: < 50 ms p50, < 150 ms p99. The handler does the bare minimum:

  * parse two headers + the JSON body
  * call ``public.m1_katara_ingest`` (one DB round-trip — verify + insert +
    device touch + NOTIFY are all bundled in the SQL function)
  * return 204 on success, 401 on bad credentials (constant error string)

Anything that does not fit in that loop (threshold checks, Brevo emails,
Sentry breadcrumbs on the happy path) is deferred to a NOTIFY-driven worker
or to the request log line. KAT-06's threshold worker subscribes via
``LISTEN katara_telemetry_inserted``.

Authentication is per-device, not per-user — the ESP32 sends
``X-Device-Id`` (the printed ``ESP-KAT-NNN`` string) + ``X-Device-Api-Key``
(the ``vk_…`` plaintext shown once at pairing time). Never a JWT.

AUTH-05 — the service-role client is intentional: the table is RLS-FORCEd
and only the service role can INSERT. The call site is added to the
allow-list in ``backend/tests/test_service_client_callsite_allowlist.py``.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import Response
from supabase import Client

from app.db import service_client
from app.modules.katara.schemas import TelemetryPayload

router = APIRouter(prefix="/katara/ingest", tags=["katara"])

log = logging.getLogger("katara.ingest")

# Header names — match the ESP32 firmware contract (hardware repo README).
# FastAPI maps the Python parameter ``x_device_id`` to the HTTP header
# ``X-Device-Id`` automatically (snake_case -> Title-Case-With-Dashes).

# Constant error string — must NOT disclose which of (device_id, api_key)
# was wrong. The bcrypt verify ran in both branches; leaking the distinction
# would let an attacker enumerate paired device IDs.
_INVALID_CREDS = "invalid_device_credentials"


def _ingest_db() -> Client:
    """Service-role Supabase client for the ingest endpoint.

    AUTH-05: this is the second legitimate service-role callsite after the
    admin shell. The table ``public.m1_katara_telemetry`` is FORCE-RLS with
    no INSERT policy, so only the service role can write — by design. The
    SQL function ``public.m1_katara_ingest`` is SECURITY DEFINER and granted
    EXECUTE to service_role only.
    """
    # JUSTIFICATION: KAT-03 trusted system write. The ingest endpoint
    # authenticates the device via a constant-time bcrypt verify of its
    # api_key inside the SQL function; there is no user JWT to forward.
    # The table is FORCE-RLS so the service role is the only legitimate
    # writer.
    return service_client()


@router.post(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="ESP32 telemetry ingestion (15-min cadence, < 50 ms SLA)",
)
async def ingest_telemetry(
    payload: TelemetryPayload,
    db: Annotated[Client, Depends(_ingest_db)],
    x_device_id: str | None = Header(default=None),
    x_device_api_key: str | None = Header(default=None),
) -> Response:
    if not x_device_id or not x_device_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_CREDS,
        )

    # Single DB call. verify + insert + device-row touch atomically.
    res = db.rpc(
        "m1_katara_ingest",
        {
            "p_device_id_str":     x_device_id,
            "p_api_key":           x_device_api_key,
            "p_soil_moisture":     payload.soil_moisture,
            "p_soil_temperature":  payload.soil_temperature,
            "p_soil_ph":           payload.soil_ph,
            "p_soil_conductivity": payload.soil_conductivity,
            "p_battery_level":     payload.battery_level,
            "p_recorded_at":       payload.recorded_at.isoformat(),
        },
    ).execute()

    telemetry_id = res.data
    if telemetry_id is None:
        # Constant-time path: the SQL function returns NULL when either the
        # device_id is unknown or the api_key does not match. Never disclose
        # which one was wrong.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_CREDS,
        )

    # 204 No Content — the ESP32 firmware only checks the status code. The
    # telemetry id rides on a header for log correlation / debugging.
    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
        headers={"X-Telemetry-Id": str(telemetry_id)},
    )
