"""KAT-06 — BR-K2 evaluator unit tests.

Pure-function tests — no DB, no network. Each scenario is one row of the
BR-K2 truth table from KAT-06 §4.3 / KAT-05 §10 hand-off.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.workers.katara_threshold.evaluator import (
    METRIC_FIELD,
    ThresholdRow,
    evaluate_decisions,
)

NOW = datetime(2026, 5, 17, 14, 0, tzinfo=timezone.utc)


def _row(
    metric: str = "soil_moisture",
    *,
    min_v: float | None = 25.0,
    max_v: float | None = 75.0,
    enabled: bool = True,
    last_alert_at: datetime | None = None,
    last_alert_value: float | None = None,
    updated_at: datetime | None = None,
) -> ThresholdRow:
    return ThresholdRow(
        metric=metric,
        min_value=min_v,
        max_value=max_v,
        enabled=enabled,
        last_alert_at=last_alert_at,
        last_alert_value=last_alert_value,
        updated_at=updated_at or (NOW - timedelta(days=7)),
    )


def _tel(**overrides: float) -> dict[str, float]:
    base: dict[str, float] = {
        "soil_moisture":     50.0,
        "soil_temperature":  20.0,
        "soil_ph":           6.5,
        "soil_conductivity": 1500.0,
        "battery_level":     80.0,
    }
    base.update(overrides)
    return base


def test_no_thresholds_no_alert() -> None:
    assert evaluate_decisions(_tel(), [], NOW) == []


def test_disabled_threshold_no_alert() -> None:
    decisions = evaluate_decisions(
        _tel(soil_moisture=10.0), [_row(enabled=False)], NOW,
    )
    assert decisions == []


def test_in_range_no_alert() -> None:
    decisions = evaluate_decisions(_tel(soil_moisture=50.0), [_row()], NOW)
    assert decisions == []


def test_first_crossing_min_alerts() -> None:
    decisions = evaluate_decisions(_tel(soil_moisture=22.0), [_row()], NOW)
    assert len(decisions) == 1
    assert decisions[0].crossed_bound == "min"
    assert decisions[0].reading == 22.0
    assert decisions[0].metric == "soil_moisture"


def test_first_crossing_max_alerts() -> None:
    decisions = evaluate_decisions(_tel(soil_moisture=80.0), [_row()], NOW)
    assert len(decisions) == 1
    assert decisions[0].crossed_bound == "max"


def test_second_crossing_within_24h_suppressed() -> None:
    just_alerted = _row(
        last_alert_at=NOW - timedelta(hours=12),
        last_alert_value=22.0,
    )
    decisions = evaluate_decisions(
        _tel(soil_moisture=20.0), [just_alerted], NOW,
    )
    assert decisions == []


def test_second_crossing_after_24h_alerts() -> None:
    long_ago = _row(
        last_alert_at=NOW - timedelta(hours=24, seconds=1),
        last_alert_value=22.0,
    )
    decisions = evaluate_decisions(
        _tel(soil_moisture=20.0), [long_ago], NOW,
    )
    assert len(decisions) == 1


def test_threshold_edit_clears_suppression() -> None:
    """KAT-05 §10 hand-off rule: an edit after the last alert re-enables firing."""
    edited_since = _row(
        last_alert_at=NOW - timedelta(hours=2),
        last_alert_value=22.0,
        updated_at=NOW - timedelta(hours=1),
    )
    decisions = evaluate_decisions(
        _tel(soil_moisture=20.0), [edited_since], NOW,
    )
    assert len(decisions) == 1


def test_one_sided_min_only_crossing() -> None:
    moisture_min_only = _row(min_v=15.0, max_v=None)
    assert evaluate_decisions(
        _tel(soil_moisture=10.0), [moisture_min_only], NOW,
    )[0].crossed_bound == "min"
    assert evaluate_decisions(
        _tel(soil_moisture=99.0), [moisture_min_only], NOW,
    ) == []


def test_multiple_metrics_independent_dedup() -> None:
    """Two metrics on the same parcel — one suppressed, one fires."""
    rows = [
        _row(metric="soil_moisture", min_v=25, max_v=75),
        _row(
            metric="soil_temperature", min_v=5, max_v=35,
            last_alert_at=NOW - timedelta(hours=1),
            last_alert_value=40.0,
        ),
    ]
    decisions = evaluate_decisions(
        _tel(soil_moisture=10.0, soil_temperature=40.0),
        rows,
        NOW,
    )
    assert {d.metric for d in decisions} == {"soil_moisture"}


def test_metric_field_table_is_total() -> None:
    """A future rename of a metric must move three places in lockstep; this
    catches the dict half. The DB CHECK + LOCALISED_LABELS are the other two."""
    assert set(METRIC_FIELD) == {
        "soil_moisture",
        "soil_temperature",
        "soil_ph",
        "soil_conductivity",
        "battery_level",
    }
