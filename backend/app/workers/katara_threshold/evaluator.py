"""KAT-06 — BR-K2 threshold evaluation + Brevo dispatch.

Two layers:

* :func:`evaluate_decisions` — *pure function*. Takes a telemetry dict, the
  parcel's threshold rows, and a clock. Returns a list of :class:`AlertDecision`
  records describing every metric that should fire an email. No I/O.

* :func:`evaluate_and_send` — orchestration wrapper. Loads context from
  Postgres, calls the pure function, dispatches via the NOT-01 mailer, then
  advances the audit columns on Brevo 2xx.

BR-K2 (PRD §6.1.2): one email per ``(parcel_id, metric)`` per 24 h.
KAT-05 §10 hand-off: when ``updated_at > last_alert_at`` the suppression is
cleared — the farmer just edited the threshold and expects feedback.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

if TYPE_CHECKING:  # pragma: no cover — runtime import lives below, this is type-only
    import asyncpg

from app.workers import mailer
from app.workers.katara_threshold.templates import (
    LOCALISED_LABELS,
    LOCALISED_UNITS,
    TEMPLATE_IDS,
    resolve_locale,
)

log = logging.getLogger("katara_threshold.evaluator")

ANTI_SPAM_WINDOW = timedelta(hours=24)

# Telemetry-column lookup table. The keys are the metric strings persisted in
# m1_katara_thresholds.metric; the values are the columns on
# m1_katara_telemetry. A rename on either side fails the unit tests below.
METRIC_FIELD: dict[str, str] = {
    "soil_moisture":     "soil_moisture",
    "soil_temperature":  "soil_temperature",
    "soil_ph":           "soil_ph",
    "soil_conductivity": "soil_conductivity",
    "battery_level":     "battery_level",
}

CrossedBound = Literal["min", "max", "both"]


@dataclass(frozen=True)
class ThresholdRow:
    """The columns of ``m1_katara_thresholds`` the evaluator reads."""

    metric: str
    min_value: float | None
    max_value: float | None
    enabled: bool
    last_alert_at: datetime | None
    last_alert_value: float | None
    updated_at: datetime


@dataclass(frozen=True)
class AlertDecision:
    """Description of a single email the evaluator decided to send."""

    metric: str
    reading: float
    crossed_bound: CrossedBound
    threshold_min: float | None
    threshold_max: float | None


def _cross(value: float, lo: float | None, hi: float | None) -> CrossedBound | None:
    below = lo is not None and value < lo
    above = hi is not None and value > hi
    if below and above:
        # The kat_threshold_min_lt_max CHECK rules this out at the DB level
        # but we cover the branch in case a future migration loosens it.
        return "both"
    if below:
        return "min"
    if above:
        return "max"
    return None


def _is_suppressed(row: ThresholdRow, now: datetime) -> bool:
    if row.last_alert_at is None:
        return False
    if row.updated_at > row.last_alert_at:
        return False
    return (now - row.last_alert_at) < ANTI_SPAM_WINDOW


def evaluate_decisions(
    telemetry: dict[str, Any],
    thresholds: list[ThresholdRow],
    now: datetime,
) -> list[AlertDecision]:
    """Return one :class:`AlertDecision` per metric that should fire.

    Pure function — no DB, no network. Each branch maps to a row of the
    BR-K2 truth table.
    """
    decisions: list[AlertDecision] = []
    for row in thresholds:
        if not row.enabled:
            continue
        column = METRIC_FIELD.get(row.metric)
        if column is None:
            continue
        reading = telemetry.get(column)
        if reading is None:
            continue
        bound = _cross(float(reading), row.min_value, row.max_value)
        if bound is None:
            continue
        if _is_suppressed(row, now):
            continue
        decisions.append(
            AlertDecision(
                metric=row.metric,
                reading=float(reading),
                crossed_bound=bound,
                threshold_min=row.min_value,
                threshold_max=row.max_value,
            )
        )
    return decisions


async def _load_context(
    pool: "asyncpg.Pool", telemetry_id: UUID,
) -> tuple[dict[str, Any] | None, list[ThresholdRow], dict[str, Any] | None]:
    async with pool.acquire() as conn:
        tel = await conn.fetchrow(
            "select id, device_id, parcel_id, farmer_id, recorded_at, "
            "soil_moisture, soil_temperature, soil_ph, "
            "soil_conductivity, battery_level "
            "from public.m1_katara_telemetry where id = $1",
            telemetry_id,
        )
        if tel is None:
            return None, [], None

        thr_rows = await conn.fetch(
            "select metric, min_value, max_value, enabled, "
            "last_alert_at, last_alert_value, updated_at "
            "from public.m1_katara_thresholds "
            "where parcel_id = $1 and enabled = true",
            tel["parcel_id"],
        )

        profile = await conn.fetchrow(
            "select p.email, p.locale, p.full_name, pa.name as parcel_name "
            "from public.profiles p "
            "join public.m1_katara_parcels pa on pa.farmer_id = p.id "
            "where pa.id = $1 and p.id = $2",
            tel["parcel_id"], tel["farmer_id"],
        )

    thresholds = [
        ThresholdRow(
            metric=r["metric"],
            min_value=r["min_value"],
            max_value=r["max_value"],
            enabled=r["enabled"],
            last_alert_at=r["last_alert_at"],
            last_alert_value=r["last_alert_value"],
            updated_at=r["updated_at"],
        )
        for r in thr_rows
    ]
    return dict(tel), thresholds, dict(profile) if profile else None


async def _record_alert(
    pool: "asyncpg.Pool", parcel_id: UUID, metric: str, value: float,
) -> None:
    """Advance the BR-K2 audit columns. Service-role only — see AUTH-05."""
    # JUSTIFICATION: KAT-06 worker writes m1_katara_thresholds.last_alert_at
    # via the service-role DSN per the KAT-05 RLS contract — the audit-guard
    # trigger silently drops authenticated writes to these columns; this
    # worker is the only legitimate writer.
    async with pool.acquire() as conn:
        await conn.execute(
            "update public.m1_katara_thresholds "
            "set last_alert_at = now(), last_alert_value = $1 "
            "where parcel_id = $2 and metric = $3",
            value, parcel_id, metric,
        )


def _build_params(
    *,
    telemetry: dict[str, Any],
    profile: dict[str, Any],
    decision: AlertDecision,
    locale: str,
    dashboard_url: str,
) -> dict[str, Any]:
    return {
        "farmer_name":   profile.get("full_name") or "",
        "parcel_name":   profile.get("parcel_name") or "",
        "device_id":     str(telemetry["device_id"]),
        "metric_label":  LOCALISED_LABELS[locale][decision.metric],
        "metric_value":  decision.reading,
        "metric_unit":   LOCALISED_UNITS[decision.metric],
        "threshold_min": decision.threshold_min,
        "threshold_max": decision.threshold_max,
        "crossed_bound": decision.crossed_bound,
        "reading_at":    telemetry["recorded_at"].isoformat(),
        "dashboard_url": dashboard_url,
    }


async def evaluate_and_send(*, pool: "asyncpg.Pool", telemetry_id: UUID) -> None:
    """Top-level orchestration. Idempotent under BR-K2."""
    telemetry, thresholds, profile = await _load_context(pool, telemetry_id)
    if telemetry is None:
        log.info("telemetry_row_missing", extra={"telemetry_id": str(telemetry_id)})
        return
    if not thresholds or profile is None:
        return
    if not profile.get("email"):
        return

    now = datetime.now(timezone.utc)
    decisions = evaluate_decisions(telemetry, thresholds, now)
    if not decisions:
        return

    locale = resolve_locale(profile.get("locale"))
    template_id = TEMPLATE_IDS.get(locale, 0)
    if not template_id:
        log.warning(
            "brevo_template_id_unset",
            extra={"locale": locale, "telemetry_id": str(telemetry_id)},
        )
        return

    dashboard_base = os.getenv("FRONTEND_BASE_URL", "https://vitachain.ma").rstrip("/")
    dashboard_url = f"{dashboard_base}/dashboard/farmer/parcels/{telemetry['parcel_id']}"

    for decision in decisions:
        params = _build_params(
            telemetry=telemetry,
            profile=profile,
            decision=decision,
            locale=locale,
            dashboard_url=dashboard_url,
        )
        try:
            await mailer.send_template(
                to=profile["email"],
                template_id=template_id,
                params=params,
                locale=locale,
            )
        except Exception:
            # On any send failure: log + capture, DO NOT advance last_alert_at.
            # The next ingest (15 min cadence) re-evaluates and re-tries.
            log.exception(
                "brevo_send_failed",
                extra={
                    "telemetry_id": str(telemetry_id),
                    "metric": decision.metric,
                },
            )
            try:
                import sentry_sdk
                sentry_sdk.capture_exception()
            except Exception:
                pass
            continue

        await _record_alert(
            pool, telemetry["parcel_id"], decision.metric, decision.reading,
        )
        log.info(
            "alert_sent",
            extra={
                "telemetry_id": str(telemetry_id),
                "metric": decision.metric,
                "reading": decision.reading,
                "crossed": decision.crossed_bound,
                "to": profile["email"],
                "locale": locale,
            },
        )
