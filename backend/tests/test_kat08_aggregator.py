"""KAT-08 — 7-day per-parcel aggregator + memory drift guard.

The aggregator wraps a single SECURITY DEFINER RPC. The tests below pin:

* The five corrected-payload columns (soil_moisture / soil_temperature /
  soil_pH / soil_conductivity / battery_level) are surfaced — a future
  memory drift back to the legacy air_humidity / air_temperature would
  fail :func:`test_avg_columns_mention_ph_and_ec_not_air`.
* ``sample_count = 0`` returns ``no_sensor_data=True`` (KAT-07 §10 hand-off).
* PostgREST string-numeric coercion to float.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest


class _Rpc:
    def __init__(self, rows):
        self.rows = rows
        self.calls: list[tuple[str, dict]] = []
    def __call__(self, name: str, params: dict):
        self.calls.append((name, params))
        return self
    def execute(self):
        return SimpleNamespace(data=self.rows)


class _FakeClient:
    def __init__(self, rows):
        self.rpc = _Rpc(rows)


def _patch(rows):
    fake = _FakeClient(rows)
    return fake, patch(
        "app.workers.katara_diagnostic.telemetry_aggregator.service_client",
        return_value=fake,
    )


def test_seven_day_average_happy_path() -> None:
    from app.workers.katara_diagnostic.telemetry_aggregator import fetch_7d_average

    rows = [{
        "sample_count":    10,
        "avg_moisture":    "52.300",
        "avg_temperature": "22.100",
        "avg_ph":          "6.800",
        "avg_ec":          "1234",
        "avg_battery":     "78",
    }]
    fake, p = _patch(rows)
    pid = uuid4()
    with p:
        out = fetch_7d_average(pid)

    assert out["no_sensor_data"] is False
    assert out["sample_count"] == 10
    assert abs(out["avg_moisture"]    - 52.3)  < 1e-3
    assert abs(out["avg_temperature"] - 22.1)  < 1e-3
    assert abs(out["avg_ph"]          -  6.8)  < 1e-3
    assert abs(out["avg_ec"]          - 1234)  < 1e-3
    assert abs(out["avg_battery"]     -   78)  < 1e-3
    name, params = fake.rpc.calls[0]
    assert name == "m1_katara_telemetry_7d_avg"
    assert params["p_parcel_id"] == str(pid)
    assert "p_since" in params


def test_seven_day_average_empty_parcel_returns_no_sensor_data() -> None:
    from app.workers.katara_diagnostic.telemetry_aggregator import fetch_7d_average

    _, p = _patch(rows=[{"sample_count": 0,
                         "avg_moisture": None, "avg_temperature": None,
                         "avg_ph": None, "avg_ec": None, "avg_battery": None}])
    with p:
        out = fetch_7d_average(uuid4())
    assert out == {"no_sensor_data": True}


def test_seven_day_average_no_rows_returns_no_sensor_data() -> None:
    """Defensive — if the RPC ever returns an empty list, treat as empty parcel."""
    from app.workers.katara_diagnostic.telemetry_aggregator import fetch_7d_average

    _, p = _patch(rows=[])
    with p:
        assert fetch_7d_average(uuid4()) == {"no_sensor_data": True}


def test_avg_columns_mention_ph_and_ec_not_air() -> None:
    """Memory-drift guard.

    The 0023 migration's RPC must surface ``avg_ph`` + ``avg_ec`` — the
    corrected payload columns (soil_pH, soil_conductivity) replaced the
    stale spec's ``air_humidity`` / ``air_temperature``. If a future PR
    flips back to the air-* columns this assertion fails loudly.
    """
    sql_path = (
        Path(__file__).resolve().parents[2]
        / "db" / "migrations"
        / "0023_kat08_diagnostic_notify_and_caches.sql"
    )
    sql = sql_path.read_text(encoding="utf-8")
    assert "avg_ph" in sql, "RPC must surface soil_pH average"
    assert "avg_ec" in sql, "RPC must surface soil_conductivity average"
    assert "avg(soil_ph)"           in sql.lower()
    assert "avg(soil_conductivity)" in sql.lower()
    # Negative — the stale columns must not have come back as SQL references.
    # Strip SQL comments first so the historical "do not regress to air_*"
    # rationale in -- prose lines doesn't fail the drift guard.
    sql_lower = sql.lower()
    code_only = "\n".join(
        line for line in sql_lower.splitlines() if not line.lstrip().startswith("--")
    )
    assert "air_humidity"    not in code_only, "stale air_humidity column has resurfaced"
    assert "air_temperature" not in code_only, "stale air_temperature column has resurfaced"
    assert "avg(air_"        not in code_only, "stale air_* AVG has resurfaced"


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
