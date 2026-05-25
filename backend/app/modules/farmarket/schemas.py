"""FAR-01 — Pydantic schemas for the FarMarket ad registry.

Design notes
------------
* ``MOROCCO_REGIONS`` is the single source of truth for the region enum on the
  Python side.  It must stay identical to ``public.m2_farmarket_region`` in
  migration 0032.  A CI parity script (similar to check-role-enum-parity.sh)
  should be added post-MVD.

* ``_MAX_PHOTOS`` / ``_MAX_PHOTO_BYTES`` mirror the DB CHECK constraint and are
  the constants the router references for BR-F2 enforcement — one definition,
  two enforcement layers.

* ``AdOut.photo_urls`` is a computed field (not a DB column) populated by the
  router from ``photo_paths`` + the Supabase public storage base URL.  The
  frontend never constructs storage URLs itself (AUTH-05 pattern).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Constants (shared with the router for BR-F2 enforcement)
# ---------------------------------------------------------------------------

MAX_PHOTOS: int = 5
MAX_PHOTO_BYTES: int = 2 * 1024 * 1024  # 2 MB

# Mirror of public.m2_farmarket_region enum (migration 0032).
MOROCCO_REGIONS: list[str] = [
    "Tanger-Tétouan-Al Hoceïma",
    "Oriental",
    "Fès-Meknès",
    "Rabat-Salé-Kénitra",
    "Béni Mellal-Khénifra",
    "Casablanca-Settat",
    "Marrakech-Safi",
    "Drâa-Tafilalet",
    "Souss-Massa",
    "Guelmim-Oued Noun",
    "Laâyoune-Sakia El Hamra",
    "Dakhla-Oued Ed-Dahab",
]

AdStatusLiteral = Literal["ACTIVE", "EXPIRED", "DELETED"]

# ---------------------------------------------------------------------------
# Request / validation models
# ---------------------------------------------------------------------------


class AdCreate(BaseModel):
    """Validated payload for POST /farmarket/ads (text fields only).

    Photos are validated separately in the router because they arrive as
    UploadFile objects, not JSON — Pydantic cannot model them here.
    """

    title: str
    description: str
    product_type: str
    price_mad: Decimal
    quantity_kg: Decimal
    region: str

    @field_validator("title")
    @classmethod
    def title_length(cls, v: str) -> str:
        v = v.strip()
        if not (3 <= len(v) <= 100):
            raise ValueError("title must be between 3 and 100 characters")
        return v

    @field_validator("description")
    @classmethod
    def description_length(cls, v: str) -> str:
        v = v.strip()
        if not (10 <= len(v) <= 2000):
            raise ValueError("description must be between 10 and 2000 characters")
        return v

    @field_validator("product_type")
    @classmethod
    def product_type_length(cls, v: str) -> str:
        v = v.strip()
        if not (2 <= len(v) <= 80):
            raise ValueError("product_type must be between 2 and 80 characters")
        return v

    @field_validator("price_mad")
    @classmethod
    def price_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("price_mad must be positive")
        return v

    @field_validator("quantity_kg")
    @classmethod
    def quantity_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("quantity_kg must be positive")
        return v

    @field_validator("region")
    @classmethod
    def region_valid(cls, v: str) -> str:
        if v not in MOROCCO_REGIONS:
            raise ValueError(
                f"region must be one of the 12 Moroccan administrative regions"
            )
        return v


class AdUpdate(BaseModel):
    """Validated payload for PATCH /farmarket/ads/{ad_id}.

    All fields are optional — only provided fields are written to the DB.
    """

    title: str | None = None
    description: str | None = None
    product_type: str | None = None
    price_mad: Decimal | None = None
    quantity_kg: Decimal | None = None
    region: str | None = None

    @field_validator("title")
    @classmethod
    def title_length(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not (3 <= len(v) <= 100):
            raise ValueError("title must be between 3 and 100 characters")
        return v

    @field_validator("description")
    @classmethod
    def description_length(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not (10 <= len(v) <= 2000):
            raise ValueError("description must be between 10 and 2000 characters")
        return v

    @field_validator("product_type")
    @classmethod
    def product_type_length(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not (2 <= len(v) <= 80):
            raise ValueError("product_type must be between 2 and 80 characters")
        return v

    @field_validator("price_mad")
    @classmethod
    def price_positive(cls, v: Decimal | None) -> Decimal | None:
        if v is None:
            return v
        if v <= 0:
            raise ValueError("price_mad must be positive")
        return v

    @field_validator("quantity_kg")
    @classmethod
    def quantity_positive(cls, v: Decimal | None) -> Decimal | None:
        if v is None:
            return v
        if v <= 0:
            raise ValueError("quantity_kg must be positive")
        return v

    @field_validator("region")
    @classmethod
    def region_valid(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v not in MOROCCO_REGIONS:
            raise ValueError(
                "region must be one of the 12 Moroccan administrative regions"
            )
        return v

    def to_db_patch(self) -> dict:
        """Return only the fields that were explicitly provided (non-None)."""
        return {
            k: (str(v) if isinstance(v, Decimal) else v)
            for k, v in self.model_dump(exclude_none=True).items()
        }


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class AdOut(BaseModel):
    """Ad row returned to callers.  ``photo_urls`` is computed by the router."""

    id: UUID
    farmer_id: UUID
    title: str
    description: str
    product_type: str
    price_mad: Decimal
    quantity_kg: Decimal
    region: str
    photo_paths: list[str]
    photo_urls: list[str]
    status: AdStatusLiteral
    is_featured: bool
    expires_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# FAR-02 — Catalog browse
# ---------------------------------------------------------------------------

CATALOG_PAGE_SIZE_DEFAULT: int = 20
CATALOG_PAGE_SIZE_MAX: int = 50


class CatalogQuery(BaseModel):
    """Validated query params for GET /farmarket/catalog."""

    region: str | None = None
    product_type: str | None = None
    price_min: Decimal | None = None
    price_max: Decimal | None = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(
        default=CATALOG_PAGE_SIZE_DEFAULT,
        ge=1,
        le=CATALOG_PAGE_SIZE_MAX,
    )

    @field_validator("region")
    @classmethod
    def region_valid_if_present(cls, v: str | None) -> str | None:
        if v is not None and v not in MOROCCO_REGIONS:
            raise ValueError(
                "region must be one of the 12 Moroccan administrative regions"
            )
        return v

    @field_validator("price_min", "price_max")
    @classmethod
    def price_non_negative(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v < 0:
            raise ValueError("price filter must be non-negative")
        return v


class CatalogPage(BaseModel):
    """Paginated response envelope for GET /farmarket/catalog."""

    items: list[AdOut]
    total: int
    page: int
    page_size: int
    has_next: bool

# ---------------------------------------------------------------------------
# FAR-03 / FAR-04 / FAR-10 — Order placement, notification, tracking.
#
# The original lead-contact schemas (migration 0039) have been replaced by
# the anonymised order flow. A producer never receives buyer identifiers.
# ---------------------------------------------------------------------------

OrderStatusLiteral = Literal[
    "PENDING",
    "PARTIALLY_ACCEPTED",
    "ACCEPTED",
    "REJECTED",
    "IN_PROGRESS",
    "DELIVERED",
    "CANCELLED",
]

ItemStatusLiteral = Literal[
    "PENDING",
    "ACCEPTED",
    "REJECTED",
    "PICKED_UP",
    "IN_TRANSIT",
    "DELIVERED",
]

ORDER_MIN_ITEMS: int = 1
ORDER_MAX_ITEMS: int = 20
LOGISTICS_FEE_FLAT_MIN: Decimal = Decimal("50.00")
LOGISTICS_FEE_RATE: Decimal = Decimal("0.05")


def compute_logistics_fee(subtotal: Decimal) -> Decimal:
    """MVP logistics fee formula — max(50, 5% of subtotal), rounded to 2dp.

    The contract is locked here so the frontend cart preview and the backend
    placement endpoint never drift.
    """
    rate_based = (subtotal * LOGISTICS_FEE_RATE).quantize(Decimal("0.01"))
    return max(LOGISTICS_FEE_FLAT_MIN, rate_based)


class OrderItemCreate(BaseModel):
    """One line of the resto's cart."""

    ad_id: UUID
    quantity_kg: Decimal

    @field_validator("quantity_kg")
    @classmethod
    def quantity_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("quantity_kg must be positive")
        return v


class OrderCreate(BaseModel):
    """Payload for POST /farmarket/orders."""

    delivery_region: str
    delivery_notes: str | None = None
    items: list[OrderItemCreate]

    @field_validator("delivery_region")
    @classmethod
    def region_valid(cls, v: str) -> str:
        if v not in MOROCCO_REGIONS:
            raise ValueError(
                "delivery_region must be one of the 12 Moroccan administrative regions"
            )
        return v

    @field_validator("delivery_notes")
    @classmethod
    def notes_length(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if len(v) == 0:
            return None
        if len(v) > 500:
            raise ValueError("delivery_notes must be ≤ 500 characters")
        return v

    @field_validator("items")
    @classmethod
    def items_count_and_uniqueness(
        cls, v: list[OrderItemCreate]
    ) -> list[OrderItemCreate]:
        if not (ORDER_MIN_ITEMS <= len(v) <= ORDER_MAX_ITEMS):
            raise ValueError(
                f"order must contain between {ORDER_MIN_ITEMS} and "
                f"{ORDER_MAX_ITEMS} items"
            )
        ad_ids = [item.ad_id for item in v]
        if len(set(ad_ids)) != len(ad_ids):
            raise ValueError("items must contain distinct ad_ids")
        return v


class OrderItemOut(BaseModel):
    """One persisted line returned from the API.

    NOTE: this is the resto/admin view. The producer side reads
    ``v_farmer_incoming_items`` which projects ``resto_handle`` in place of
    any restaurant identifier — see :class:`FarmerIncomingItemOut`.
    """

    id: UUID
    order_id: UUID
    ad_id: UUID
    farmer_id: UUID
    quantity_kg: Decimal
    unit_price_mad: Decimal
    line_total_mad: Decimal
    status: ItemStatusLiteral
    producer_note: str | None
    created_at: datetime
    updated_at: datetime


class OrderOut(BaseModel):
    """Order header returned to RESTAURANT / ADMIN callers."""

    id: UUID
    restaurant_id: UUID
    status: OrderStatusLiteral
    delivery_region: str
    delivery_notes: str | None
    subtotal_mad: Decimal
    logistics_fee_mad: Decimal
    total_mad: Decimal
    payment_status: str
    items: list[OrderItemOut]
    created_at: datetime
    updated_at: datetime


class FarmerIncomingItemOut(BaseModel):
    """Anonymised producer-side projection (matches v_farmer_incoming_items).

    BR-F5: contains ``resto_handle`` (sha256-derived) and the coarse
    ``delivery_region`` — no field can resolve to the restaurant's identity.
    """

    id: UUID
    order_id: UUID
    resto_handle: str
    ad_id: UUID
    quantity_kg: Decimal
    unit_price_mad: Decimal
    line_total_mad: Decimal
    status: ItemStatusLiteral
    producer_note: str | None
    delivery_region: str
    created_at: datetime
    updated_at: datetime


class OrderItemStatusUpdate(BaseModel):
    """Payload for PATCH /farmarket/orders/items/{item_id}/status (FARMER)."""

    new_status: ItemStatusLiteral
    producer_note: str | None = None

    @field_validator("producer_note")
    @classmethod
    def note_length(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if len(v) == 0:
            return None
        if len(v) > 500:
            raise ValueError("producer_note must be ≤ 500 characters")
        return v
