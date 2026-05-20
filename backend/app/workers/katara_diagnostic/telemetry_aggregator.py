"""KAT-08 — 7-day per-parcel sensor aggregate.

Single SECURITY DEFINER RPC call (``m1_katara_telemetry_7d_avg`` from
migration 0023) returning the AVG of all five corrected-payload metrics:
``soil_moisture / soil_temperature / soil_pH / soil_conductivity / battery_level``.

The corrected payload is the standing project memory (see
``memory/project_katara_iot_payload.md``): the legacy spec text mentioning
``air_humidity`` / ``air_temperature`` is stale; the code is the source of
truth. The RPC's ``RETURNS TABLE`` columns guard against memory drift —
removing ``avg_ph`` / ``avg_ec`` fails pgTAP D-14.

When the parcel has zero readings in the window, returns
``{"no_sensor_data": True}`` so the orchestrator can thread the
"aucune donnée capteur" branch into the Gemini prompt instead of failing
the whole diagnostic (per KAT-07 §10 hand-off note).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

# JUSTIFICATION: the RPC is service_role-only EXECUTE. Calling it through the
# user JWT would 401 at PostgREST. AUTH-05 allow-list entry: workers/.
from app.db import service_client

log = logging.getLogger("katara_diagnostic.aggregator")

_LOOKBACK = timedelta(days=7)


def fetch_7d_average(parcel_id: UUID) -> dict[str, Any]:
    """Return a dict with the five averages + ``sample_count``, or
    ``{"no_sensor_data": True}`` when the parcel has zero readings."""
    db = service_client()
    since = (datetime.now(timezone.utc) - _LOOKBACK).isoformat()
    res = db.rpc(
        "m1_katara_telemetry_7d_avg",
        {"p_parcel_id": str(parcel_id), "p_since": since},
    ).execute()
    rows = res.data or []
    if not rows:
        return {"no_sensor_data": True}

    row = rows[0]
    sample_count = row.get("sample_count") or 0
    if sample_count == 0:
        return {"no_sensor_data": True}

    return {
        "no_sensor_data":  False,
        "sample_count":    sample_count,
        "avg_moisture":    _to_float(row.get("avg_moisture")),
        "avg_temperature": _to_float(row.get("avg_temperature")),
        "avg_ph":          _to_float(row.get("avg_ph")),
        "avg_ec":          _to_float(row.get("avg_ec")),
        "avg_battery":     _to_float(row.get("avg_battery")),
    }


def _to_float(value: Any) -> float | None:
    """PostgREST returns numerics as strings to preserve precision; we want floats
    for f-string / Jinja rendering. ``None`` propagates (empty window column)."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
