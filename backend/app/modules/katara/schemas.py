"""KAT-01 — Pydantic schemas for the parcel registry.

The GeoJSON validator (:func:`_validate_geojson`) accepts a bare geometry
(``Polygon`` / ``MultiPolygon``) or a wrapping ``Feature``. Anything else
(``Point``, ``LineString``, missing ``coordinates``, …) raises so the request
fails at the 422 boundary, never reaching the DB CHECK that only asserts the
top-level shape.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Accepted GeoJSON geometry types for a parcel polygon. Points, lines and
# collections are explicitly rejected — a parcel must be an area.
_POLYGON_TYPES = frozenset({"Polygon", "MultiPolygon"})


def _validate_geojson(value: dict[str, Any]) -> dict[str, Any]:
    """Accept a raw Polygon/MultiPolygon geometry or a Feature wrapping one.

    Raises :class:`ValueError` for anything else so the API responds 422 and
    the DB CHECK never has to defend against a structurally invalid payload.
    """
    geo_type = value.get("type")

    if geo_type in _POLYGON_TYPES:
        coords = value.get("coordinates")
        if not coords:
            raise ValueError(
                "GeoJSON geometry must have a non-empty 'coordinates' array"
            )
        return value

    if geo_type == "Feature":
        geom = value.get("geometry") or {}
        if geom.get("type") not in _POLYGON_TYPES:
            raise ValueError(
                "Feature.geometry.type must be Polygon or MultiPolygon, "
                f"got: {geom.get('type')!r}"
            )
        if not geom.get("coordinates"):
            raise ValueError(
                "GeoJSON Feature geometry must have a non-empty 'coordinates' array"
            )
        return value

    raise ValueError(
        "geojson.type must be 'Polygon', 'MultiPolygon' or 'Feature', "
        f"got: {geo_type!r}"
    )


class ParcelCreate(BaseModel):
    name: str
    geojson: dict[str, Any]
    crop_type: str
    surface_area_ha: Decimal

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v

    @field_validator("crop_type")
    @classmethod
    def _crop_type_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("crop_type must not be blank")
        return v

    @field_validator("surface_area_ha")
    @classmethod
    def _area_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("surface_area_ha must be positive")
        return v

    @field_validator("geojson")
    @classmethod
    def _valid_geojson(cls, v: dict[str, Any]) -> dict[str, Any]:
        return _validate_geojson(v)


class ParcelUpdate(BaseModel):
    name: str | None = None
    geojson: dict[str, Any] | None = None
    crop_type: str | None = None
    surface_area_ha: Decimal | None = None

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v

    @field_validator("crop_type")
    @classmethod
    def _crop_type_not_blank(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("crop_type must not be blank")
        return v

    @field_validator("surface_area_ha")
    @classmethod
    def _area_positive(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v <= 0:
            raise ValueError("surface_area_ha must be positive")
        return v

    @field_validator("geojson")
    @classmethod
    def _valid_geojson(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is None:
            return v
        return _validate_geojson(v)


class ParcelOut(BaseModel):
    id: UUID
    farmer_id: UUID
    name: str
    geojson: dict[str, Any]
    crop_type: str
    surface_area_ha: Decimal
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── KAT-02 — ESP32 device pairing ────────────────────────────────────────────
# The DB CHECK in migration 0017 enforces the same pattern; we mirror it at the
# Pydantic layer so malformed payloads die at the 422 boundary before reaching
# the bcrypt hash + insert path.
_DEVICE_ID_RE = re.compile(r"^ESP-KAT-\d{3}$")


class DevicePair(BaseModel):
    """Pairing request body. ``parcel_id`` is taken from the path, not the body."""

    device_id: str

    @field_validator("device_id")
    @classmethod
    def _device_id_format(cls, v: str) -> str:
        v = v.strip()
        if not _DEVICE_ID_RE.match(v):
            raise ValueError("device_id must match ESP-KAT-NNN")
        return v


class DevicePairResponse(BaseModel):
    """One-shot response with the plaintext key. Never returned again — the
    list / get endpoints return :class:`DeviceOut` which omits ``api_key``."""

    id: UUID
    device_id: str
    parcel_id: UUID
    farmer_id: UUID
    api_key: str  # plaintext — shown ONCE
    api_key_last4: str
    status: str
    last_seen: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None


class DeviceOut(BaseModel):
    """Safe device view — no plaintext key, only ``api_key_last4``."""

    id: UUID
    device_id: str
    parcel_id: UUID
    farmer_id: UUID
    api_key_last4: str
    status: str
    last_seen: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── KAT-12 — unlink response ─────────────────────────────────────────────────
# The unlink endpoint returns just enough for the frontend to flip its local
# state without a follow-up GET. Mirrors the .returning() column list of the
# single UPDATE statement in the handler.
from typing import Literal as _Literal  # noqa: E402  — kept near KAT-12 block


class UnlinkDeviceResponse(BaseModel):
    id: UUID
    device_id: str
    parcel_id: UUID
    status: _Literal["UNLINKED"]


# ── KAT-03 — ESP32 telemetry ingest ──────────────────────────────────────────
# Soil-focused payload (pH + conductivity) — supersedes the legacy
# air_humidity / air_temperature fields in the v1 spec. The DB CHECKs in
# migration 0018 enforce the same ranges; mirroring at the Pydantic layer
# kills malformed payloads at the 422 boundary before the bcrypt-verify
# round-trip ever fires.
class TelemetryPayload(BaseModel):
    """ESP32 -> backend payload, sent every 15 minutes (PRD §6.1 cadence).

    The device authenticates via two headers (``X-Device-Id`` +
    ``X-Device-Api-Key``), never a JWT — the body carries only the metrics.
    The ``soil_pH`` alias preserves the literal field name in the firmware's
    JSON while keeping the Python attribute snake_case.
    """

    soil_moisture: float = Field(..., ge=0, le=100)
    soil_temperature: float = Field(..., ge=-20, le=80)
    soil_ph: float = Field(..., ge=0, le=14, alias="soil_pH")
    soil_conductivity: float = Field(..., ge=0, le=20000)
    battery_level: int = Field(..., ge=0, le=100)
    recorded_at: datetime  # UTC; the device sends an ISO-8601 string

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("recorded_at")
    @classmethod
    def _reject_future_timestamp(cls, v: datetime) -> datetime:
        # 60 s tolerance covers GSM clock drift; anything beyond is rejected
        # as a likely replay or firmware-clock bug. The guard intentionally
        # lives here (not as a DB CHECK) so legitimate backfills can break it.
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        if (v - datetime.now(timezone.utc)).total_seconds() > 60:
            raise ValueError("recorded_at is more than 60 s in the future")
        return v


# ── KAT-04 — telemetry read models ───────────────────────────────────────────
# The dashboard reads via two endpoints — `/latest` (polled every 30 s by the
# 24h tile) and `/history` (one fetch per window-switch). BR-K4 caps history
# at 500 returned points; enforcement lives in the router's window->granularity
# table, never trusting the client to pick a bucket.

from typing import Literal  # noqa: E402  (kept near KAT-04 block for locality)


Window = Literal["24h", "7d", "30d"]
Granularity = Literal["15min", "1hour", "1day"]


DeviceStatusLiteral = Literal["PENDING", "ACTIVE", "OFFLINE", "UNLINKED"]


class LatestTelemetry(BaseModel):
    """Single most-recent row for a parcel.

    The polling tile reads this once every 30 s while the parcel page is
    visible. ``received_at - recorded_at`` is the network latency budget —
    surfaced to the dashboard so a farmer can spot a GSM-flaky device.

    KAT-13 added ``device_label`` (the human-readable ESP-KAT-NNN), the device
    ``device_status`` (so the UI can render the amber "Détaché" pill on a
    historical reading) and ``device_unlinked_at`` (a proxy for the unlink
    timestamp — populated from ``m1_katara_devices.updated_at`` only when the
    status is ``UNLINKED``; see KAT-13 §6.3 for the rationale).
    """

    device_id: UUID
    device_label: str | None = None       # ESP-KAT-NNN; KAT-13
    device_status: DeviceStatusLiteral | None = None  # KAT-13
    device_unlinked_at: datetime | None = None        # KAT-13 — only when UNLINKED
    soil_moisture: float
    soil_temperature: float
    soil_ph: float
    soil_conductivity: float
    battery_level: int
    recorded_at: datetime
    received_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HistoryBucket(BaseModel):
    bucket: datetime
    soil_moisture: float
    soil_temperature: float
    soil_ph: float
    soil_conductivity: float
    battery_level: float
    sample_count: int
    device_count: int


class HistoryResponse(BaseModel):
    """BR-K4 — ``len(buckets)`` is guaranteed ≤ 500.

    The contract is enforced by the window->granularity mapping in the router;
    we also assert the cap server-side as a regression tripwire so a SQL
    regression blows up the test rather than the dashboard.
    """

    window: Window
    granularity: Granularity
    point_count: int
    buckets: list[HistoryBucket]


# ── KAT-13 — historical telemetry provenance ────────────────────────────────
# Surfaces each device's contribution to a parcel's telemetry, including
# UNLINKED devices whose parcel_id is frozen by KAT-12. The frontend's
# <DeviceHistoryCard> renders this list above the chart so a farmer can
# attribute a historical batch to the physical ESP32 that produced it.


class DeviceHistoryEntry(BaseModel):
    """One device's contribution to a parcel's telemetry history."""

    device_uuid: UUID
    device_id: str                       # ESP-KAT-NNN (human-readable label)
    device_status: DeviceStatusLiteral
    api_key_last4: str | None = None
    first_recorded_at: datetime
    last_recorded_at: datetime
    sample_count: int
    is_currently_paired: bool
    # The unlink-time proxy — surfaced to the UI so the card can say
    # "Détaché il y a 3 jours". Only meaningful when device_status == 'UNLINKED'
    # (KAT-12's freeze trigger guarantees updated_at == unlink-time for an
    # UNLINKED row; see KAT-13 §6.3).
    device_updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DeviceHistoryResponse(BaseModel):
    devices: list[DeviceHistoryEntry]


# ── KAT-05 — alert threshold models ──────────────────────────────────────────
# The persistence half of the alert pipeline; KAT-06's worker reads
# m1_katara_thresholds on every NOTIFY katara_telemetry_inserted. Per-metric
# range mirrors the DB CHECK in migration 0021 so a malformed payload dies at
# the 422 boundary before a round-trip ever fires.

Metric = Literal[
    "soil_moisture",
    "soil_temperature",
    "soil_ph",
    "soil_conductivity",
    "battery_level",
]

_METRIC_RANGE: dict[Metric, tuple[float, float]] = {
    "soil_moisture":     (0.0, 100.0),
    "soil_temperature":  (-20.0, 80.0),
    "soil_ph":           (0.0, 14.0),
    "soil_conductivity": (0.0, 20000.0),
    "battery_level":     (0.0, 100.0),
}


class ThresholdRow(BaseModel):
    """One row in the bulk array.

    ``min_value`` / ``max_value`` are independently nullable but at least one
    must be set when ``enabled=True`` (matches the DB
    ``kat_threshold_at_least_one_bound`` CHECK). ``last_alert_at`` /
    ``last_alert_value`` are accepted on the wire and silently discarded by
    the audit-guard trigger — the worker (KAT-06) is the only legitimate
    writer of those columns.
    """

    metric: Metric
    min_value: float | None = None
    max_value: float | None = None
    enabled: bool = True
    # Read-only on the wire — populated by the server on responses.
    last_alert_at: datetime | None = None
    last_alert_value: float | None = None

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def _validate_bounds(self) -> "ThresholdRow":
        # Mirror the DB ``kat_threshold_at_least_one_bound`` CHECK: a row
        # with both bounds NULL is meaningless and would silently disable
        # the alert. Enforce regardless of ``enabled`` so the API and the
        # DB agree byte-for-byte.
        if self.min_value is None and self.max_value is None:
            raise ValueError("threshold_needs_min_or_max")
        if (
            self.min_value is not None
            and self.max_value is not None
            and self.min_value >= self.max_value
        ):
            raise ValueError("min_value_must_be_less_than_max_value")
        lo, hi = _METRIC_RANGE[self.metric]
        for label, v in (
            ("min_value", self.min_value),
            ("max_value", self.max_value),
        ):
            if v is not None and not (lo <= v <= hi):
                raise ValueError(
                    f"{label}_out_of_range_for_{self.metric}_must_be_{lo}_to_{hi}"
                )
        return self


class ThresholdsResponse(BaseModel):
    parcel_id: UUID
    rows: list[ThresholdRow]  # always length 5, one per metric


class ThresholdsUpdateRequest(BaseModel):
    """Bulk-upsert body. Exactly one row per metric — partial updates are
    intentionally not supported: the worker that wakes up between two partial
    saves would read an inconsistent state, and the form-based editor already
    saves the whole table atomically."""

    rows: list[ThresholdRow]

    @model_validator(mode="after")
    def _exactly_five_distinct_metrics(self) -> "ThresholdsUpdateRequest":
        seen = {r.metric for r in self.rows}
        if len(self.rows) != 5 or seen != set(_METRIC_RANGE):
            raise ValueError("request_must_contain_exactly_one_row_per_metric")
        return self


# ── KAT-07 — AI diagnostic request models ─────────────────────────────────────
# Persistence + request-surface only. KAT-08 worker transitions PENDING →
# PROCESSING → COMPLETED|FAILED via service_role; the audit-guard trigger in
# migration 0022 silently clamps any authenticated write to those columns.

DiagnosticStatus = Literal["PENDING", "PROCESSING", "COMPLETED", "FAILED"]


class DiagnosticOut(BaseModel):
    """Wire shape of a diagnostic row.

    ``error_detail`` is included so the admin view (RLS-allowed) can render it.
    The farmer frontend hides it and shows a generic French failure message
    instead — the field is engineer-facing.
    """

    id: UUID
    parcel_id: UUID
    farmer_id: UUID
    status: DiagnosticStatus
    result_text: str | None = None
    error_detail: str | None = None
    requested_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


# ── KAT-14 multi-parcel overview models ─────────────────────────────────────
# Wire-side shape of GET /api/v1/katara/farmers/me/overview. The endpoint is a
# thin aggregator over public.m1_katara_farmer_parcels_overview (migration
# 0028) — the per-parcel entry deliberately omits soil_temperature / soil_ph /
# soil_conductivity, which are detail-page concerns and would bloat a payload
# the farmer hits on every dashboard load.


class ParcelOverviewEntry(BaseModel):
    """One parcel's summary tile on the farmer-level overview."""

    parcel_id: UUID
    name: str
    crop_type: str
    surface_area_ha: Decimal
    device_active_count: int = Field(..., ge=0)
    device_offline_count: int = Field(..., ge=0)
    device_pending_count: int = Field(..., ge=0)
    device_unlinked_count: int = Field(..., ge=0)
    last_reading_at: datetime | None = None
    last_soil_moisture: float | None = None
    has_open_threshold_breach: bool

    model_config = ConfigDict(from_attributes=True)


class FarmKpiRollup(BaseModel):
    """Farm-wide rollup tiles at the top of the overview."""

    parcel_count: int = Field(..., ge=0)
    total_surface_ha: Decimal
    device_active_count: int = Field(..., ge=0)
    device_offline_count: int = Field(..., ge=0)
    device_pending_count: int = Field(..., ge=0)
    device_unlinked_count: int = Field(..., ge=0)
    parcels_with_open_breach: int = Field(..., ge=0)


class FarmerOverviewResponse(BaseModel):
    kpi: FarmKpiRollup
    parcels: list[ParcelOverviewEntry]


# ── External-API proxies (Weather + NDVI) ────────────────────────────────────
# These power /katara/parcels/{id}/weather and /katara/parcels/{id}/ndvi —
# backend-only server-side proxies over OpenWeatherMap and Sentinel Hub so the
# frontend never holds those API keys (AUTH-05). Backend reuses the cached
# workers/katara_diagnostic.{owm_client,sentinel_client}.

# Glyph kinds rendered by the dashboard — backend maps OWM's icon codes to
# this small set so the frontend doesn't need to know upstream specifics.
WeatherIconKind = Literal["sun", "cloud", "rain", "snow", "storm", "fog"]


class WeatherHourly(BaseModel):
    """One 3-hour forecast slot (8 of these span the next 24 h)."""

    iso: datetime
    temp_c: float
    icon_kind: WeatherIconKind
    pop_pct: int = Field(..., ge=0, le=100)


class WeatherDaily(BaseModel):
    """One aggregated calendar-day forecast (UTC bucketing)."""

    iso: datetime
    temp_min_c: float
    temp_max_c: float
    icon_kind: WeatherIconKind
    pop_pct: int = Field(..., ge=0, le=100)
    rain_mm: float = Field(..., ge=0)


class WeatherCurrent(BaseModel):
    """Snapshot of current conditions at the parcel's centroid."""

    city_label: str
    temp_c: float
    feels_like_c: float
    description: str
    icon_kind: WeatherIconKind
    humidity_pct: int = Field(..., ge=0, le=100)
    wind_kmh: float = Field(..., ge=0)
    wind_dir: str  # 8-point compass, e.g. "NE"
    rain_mm_3h: float = Field(..., ge=0)
    temp_min_c: float
    temp_max_c: float


class WeatherResponse(BaseModel):
    """Forecast bundle for a single parcel, computed at its centroid."""

    parcel_id: UUID
    current: WeatherCurrent
    hourly: list[WeatherHourly]
    daily: list[WeatherDaily]
    fetched_at: datetime


class NdviResponse(BaseModel):
    """Latest cloud-free NDVI summary for a parcel.

    ``image_data_url`` is a base64-encoded PNG (data: URL ready to render).
    It is optional: a fully-clouded fortnight returns ``image_data_url=None``
    but the mean is still computed from the masked TIFF — the dashboard
    surfaces both states distinctly.
    """

    parcel_id: UUID
    mean_ndvi: float
    acquisition_date: date
    image_data_url: str | None = None
