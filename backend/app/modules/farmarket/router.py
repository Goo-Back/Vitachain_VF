"""M2 FarMarket router — FAR-01: ad creation + listing.

Auth contract
-------------
* POST /ads  — VERIFIED FARMER only (``require_verified("FARMER")``)
* GET  /ads  — VERIFIED FARMER only (returns their own ads, all statuses)

Storage (BR-F2 / FAR-07)
-------------------------
Photos are uploaded to the ``farmarket-photos`` Supabase Storage bucket using
the caller's user-scoped client (``db`` from ``get_db_for_user``).  The user
JWT is forwarded to the Storage REST API via
``client.storage._headers["Authorization"]``, so the storage RLS INSERT policy
(migration 0033) fires and enforces:
  * only VERIFIED FARMER
  * path prefix = caller's UUID  →  cross-farmer overwrites are structurally
    impossible
No ``service_client()`` is needed (AUTH-05 compliant; farmarket/ is not in the
allow-list).

Atomicity note (FAR-01 §5.4)
-----------------------------
Photos are uploaded before the DB insert.  If the insert fails the cleanup
block removes orphaned objects (best-effort).  Full two-phase commit is deferred
to post-MVD; a nightly CRON will scan for orphans.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import ORJSONResponse, Response
from supabase import Client

from app.core.config import get_settings
from app.core.security import AuthUser, get_current_user, get_db_for_user, require_verified
from app.modules.farmarket.schemas import (
    CATALOG_PAGE_SIZE_DEFAULT,
    MAX_PHOTO_BYTES,
    MAX_PHOTOS,
    MOROCCO_REGIONS,
    AdCreate,
    AdOut,
    AdUpdate,
    CatalogPage,
    CatalogQuery,
)

router = APIRouter(prefix="/farmarket", tags=["farmarket"])

_ADS_TABLE = "m2_farmarket_ads"
_BUCKET = "farmarket-photos"

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _storage_public_url(path: str) -> str:
    """Build the public CDN URL for a farmarket-photos storage path."""
    base = str(get_settings().supabase_url).rstrip("/")
    return f"{base}/storage/v1/object/public/{_BUCKET}/{path}"


def _row_to_ad_out(row: dict) -> AdOut:
    paths: list[str] = row.get("photo_paths") or []
    return AdOut(
        id=row["id"],
        farmer_id=row["farmer_id"],
        title=row["title"],
        description=row["description"],
        product_type=row["product_type"],
        price_mad=Decimal(str(row["price_mad"])),
        quantity_kg=Decimal(str(row["quantity_kg"])),
        region=row["region"],
        photo_paths=paths,
        photo_urls=[_storage_public_url(p) for p in paths],
        status=row["status"],
        is_featured=row["is_featured"],
        expires_at=row["expires_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/healthz", response_class=ORJSONResponse)
async def farmarket_healthz() -> dict[str, str]:
    return {"module": "farmarket", "status": "ok"}


@router.get(
    "/ads",
    response_model=list[AdOut],
    response_class=ORJSONResponse,
)
async def list_my_ads(
    user: Annotated[AuthUser, Depends(require_verified("FARMER"))],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> list[AdOut]:
    """GET /api/v1/farmarket/ads — farmer's own ads (all statuses).

    RLS ``farmarket_ads_select_own`` limits rows to ``farmer_id = auth.uid()``.
    """
    result = (
        db.table(_ADS_TABLE)
        .select("*")
        .eq("farmer_id", str(user.id))
        .order("created_at", desc=True)
        .execute()
    )
    return [_row_to_ad_out(r) for r in (result.data or [])]


@router.post(
    "/ads",
    status_code=status.HTTP_201_CREATED,
    response_model=AdOut,
    response_class=ORJSONResponse,
)
async def create_ad(
    # ── Text fields (multipart/form-data) ─────────────────────────────────
    title: Annotated[str, Form()],
    description: Annotated[str, Form()],
    product_type: Annotated[str, Form()],
    price_mad: Annotated[Decimal, Form()],
    quantity_kg: Annotated[Decimal, Form()],
    region: Annotated[str, Form()],
    # ── Photo files — optional, max 5 (BR-F2) ─────────────────────────────
    photos: Annotated[list[UploadFile], File()] = [],
    # ── Auth + DB (user-scoped — RLS fires) ───────────────────────────────
    user: Annotated[AuthUser, Depends(require_verified("FARMER"))] = None,
    db: Annotated[Client, Depends(get_db_for_user)] = None,
) -> AdOut:
    """POST /api/v1/farmarket/ads — create a new marketplace ad.

    Accepts multipart/form-data with text fields and up to 5 image files.
    Photos are uploaded to Supabase Storage; only storage paths are stored in
    the DB (FAR-07 constraint).

    Enforces:
    * BR-F1 — VERIFIED FARMER only (``require_verified("FARMER")``)
    * BR-F2 — ≤5 photos, each ≤2 MB, must be an image MIME type
    """
    # 1. Validate text fields via Pydantic (raises 422 on violation).
    payload = AdCreate(
        title=title,
        description=description,
        product_type=product_type,
        price_mad=price_mad,
        quantity_kg=quantity_kg,
        region=region,
    )

    # 2. BR-F2: photo count limit (quick check before reading bytes).
    real_photos = [p for p in photos if p.filename]
    if len(real_photos) > MAX_PHOTOS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"too_many_photos: maximum {MAX_PHOTOS} photos allowed",
        )

    # 3. Pre-read + validate all files before touching Storage.
    #    This way a size violation never leaves orphaned objects.
    photo_data: list[tuple[str, bytes, str]] = []
    for upload in real_photos:
        content = await upload.read()
        if len(content) > MAX_PHOTO_BYTES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"photo_too_large: {upload.filename!r} exceeds 2 MB",
            )
        ct = upload.content_type or "image/jpeg"
        if not ct.startswith("image/"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"invalid_photo_type: {upload.filename!r} must be an image",
            )
        # Sanitise filename: spaces → underscores; keep extension.
        safe_name = (upload.filename or "photo").replace(" ", "_")
        photo_data.append((safe_name, content, ct))

    # 4. Generate the ad UUID before upload so paths embed it.
    ad_id = uuid.uuid4()

    # 5. Upload photos to Storage using the user-scoped client.
    #    ``db.storage._headers["Authorization"]`` carries the user's JWT, so
    #    the migration 0033 INSERT policy fires (VERIFIED FARMER + own prefix).
    photo_paths: list[str] = []
    for safe_name, content, content_type in photo_data:
        storage_path = f"{user.id}/{ad_id}/{safe_name}"
        db.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={"content-type": content_type, "upsert": "false"},
        )
        photo_paths.append(storage_path)

    # 6. Insert the ad row (user-scoped client → RLS INSERT policy fires).
    insert_result = (
        db.table(_ADS_TABLE)
        .insert(
            {
                "id": str(ad_id),
                "farmer_id": str(user.id),
                "title": payload.title,
                "description": payload.description,
                "product_type": payload.product_type,
                # Decimal → str so PostgREST stores the exact value.
                "price_mad": str(payload.price_mad),
                "quantity_kg": str(payload.quantity_kg),
                "region": payload.region,
                "photo_paths": photo_paths,
                "status": "ACTIVE",
            }
        )
        .execute()
    )

    if not insert_result.data:
        # Best-effort orphan cleanup — remove already-uploaded photos.
        for path in photo_paths:
            try:
                db.storage.from_(_BUCKET).remove([path])
            except Exception:  # noqa: BLE001
                pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ad_insert_failed",
        )

    return _row_to_ad_out(insert_result.data[0])


@router.patch(
    "/ads/{ad_id}",
    response_model=AdOut,
    response_class=ORJSONResponse,
)
async def update_ad(
    ad_id: uuid.UUID,
    title: Annotated[str | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
    product_type: Annotated[str | None, Form()] = None,
    price_mad: Annotated[Decimal | None, Form()] = None,
    quantity_kg: Annotated[Decimal | None, Form()] = None,
    region: Annotated[str | None, Form()] = None,
    photos: Annotated[list[UploadFile], File()] = [],
    user: Annotated[AuthUser, Depends(require_verified("FARMER"))] = None,
    db: Annotated[Client, Depends(get_db_for_user)] = None,
) -> AdOut:
    """PATCH /api/v1/farmarket/ads/{ad_id} — edit text fields and/or replace photos.

    Only ACTIVE ads can be edited (EXPIRED → 409). Owner-only (FastAPI + RLS).
    Photo semantics: if any new photo is provided, ALL existing photos are replaced.
    """
    payload = AdUpdate(
        title=title,
        description=description,
        product_type=product_type,
        price_mad=price_mad,
        quantity_kg=quantity_kg,
        region=region,
    )

    existing = (
        db.table(_ADS_TABLE)
        .select("id, farmer_id, status, photo_paths")
        .eq("id", str(ad_id))
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ad_not_found")
    row = existing.data
    if str(row["farmer_id"]) != str(user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_ad_owner")
    if row["status"] != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ad_not_editable: only ACTIVE ads can be edited",
        )

    patch = payload.to_db_patch()

    real_photos = [p for p in photos if p.filename]
    if real_photos:
        if len(real_photos) > MAX_PHOTOS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"too_many_photos: maximum {MAX_PHOTOS} photos allowed",
            )

        photo_data: list[tuple[str, bytes, str]] = []
        for upload in real_photos:
            content = await upload.read()
            if len(content) > MAX_PHOTO_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"photo_too_large: {upload.filename!r} exceeds 2 MB",
                )
            ct = upload.content_type or "image/jpeg"
            if not ct.startswith("image/"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"invalid_photo_type: {upload.filename!r} must be an image",
                )
            safe_name = (upload.filename or "photo").replace(" ", "_")
            photo_data.append((safe_name, content, ct))

        old_paths: list[str] = row.get("photo_paths") or []
        if old_paths:
            try:
                db.storage.from_(_BUCKET).remove(old_paths)
            except Exception:  # noqa: BLE001
                pass

        new_photo_paths: list[str] = []
        for safe_name, content, content_type in photo_data:
            storage_path = f"{user.id}/{ad_id}/{safe_name}"
            db.storage.from_(_BUCKET).upload(
                path=storage_path,
                file=content,
                file_options={"content-type": content_type, "upsert": "true"},
            )
            new_photo_paths.append(storage_path)

        patch["photo_paths"] = new_photo_paths

    if not patch:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="no_fields_to_update: provide at least one field or one photo",
        )

    update_result = (
        db.table(_ADS_TABLE)
        .update(patch)
        .eq("id", str(ad_id))
        .execute()
    )
    if not update_result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ad_update_failed",
        )

    return _row_to_ad_out(update_result.data[0])


@router.delete(
    "/ads/{ad_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
async def delete_ad(
    ad_id: uuid.UUID,
    user: Annotated[AuthUser, Depends(require_verified("FARMER"))],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> None:
    """DELETE /api/v1/farmarket/ads/{ad_id} — soft-delete (status → DELETED).

    Preserves the row and FK-referenced leads for admin audit.
    Storage photos are removed best-effort after the DB update.
    """
    existing = (
        db.table(_ADS_TABLE)
        .select("id, farmer_id, status, photo_paths")
        .eq("id", str(ad_id))
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ad_not_found")
    row = existing.data
    if str(row["farmer_id"]) != str(user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="not_ad_owner")
    if row["status"] == "DELETED":
        return  # idempotent

    update_result = (
        db.table(_ADS_TABLE)
        .update({"status": "DELETED"})
        .eq("id", str(ad_id))
        .execute()
    )
    if not update_result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ad_delete_failed",
        )

    photo_paths: list[str] = row.get("photo_paths") or []
    if photo_paths:
        try:
            db.storage.from_(_BUCKET).remove(photo_paths)
        except Exception:  # noqa: BLE001
            pass


@router.get(
    "/catalog",
    response_model=CatalogPage,
    response_class=ORJSONResponse,
)
async def browse_catalog(
    region: str | None = None,
    product_type: str | None = None,
    price_min: Decimal | None = None,
    price_max: Decimal | None = None,
    page: int = 1,
    page_size: int = CATALOG_PAGE_SIZE_DEFAULT,
    user: Annotated[AuthUser, Depends(get_current_user)] = None,
    db: Annotated[Client, Depends(get_db_for_user)] = None,
) -> CatalogPage:
    """GET /api/v1/farmarket/catalog

    Filterable, paginated catalog of ACTIVE ads — readable by any
    authenticated user (RESTAURANT, FARMER, CITIZEN).

    RLS ``farmarket_ads_select_active`` enforces ``status = 'ACTIVE'`` at the
    DB layer; this handler adds optional filter predicates on top.

    Sort: featured first (FAR-09 placeholder), then newest first.

    Security note: `product_type` is passed to PostgREST via `.ilike()` as
    a parameterised filter — not string interpolation — so the % wildcards
    are safe against SQL injection.
    """
    params = CatalogQuery(
        region=region,
        product_type=product_type,
        price_min=price_min,
        price_max=price_max,
        page=page,
        page_size=page_size,
    )

    offset = (params.page - 1) * params.page_size

    query = (
        db.table(_ADS_TABLE)
        .select("*", count="exact")
        .eq("status", "ACTIVE")
        .order("is_featured", desc=True)
        .order("created_at", desc=True)
        .range(offset, offset + params.page_size - 1)
    )

    if params.region is not None:
        query = query.eq("region", params.region)
    if params.product_type is not None:
        query = query.ilike("product_type", f"%{params.product_type}%")
    if params.price_min is not None:
        query = query.gte("price_mad", str(params.price_min))
    if params.price_max is not None:
        query = query.lte("price_mad", str(params.price_max))

    result = query.execute()
    total: int = result.count or 0
    items = [_row_to_ad_out(r) for r in (result.data or [])]

    return CatalogPage(
        items=items,
        total=total,
        page=params.page,
        page_size=params.page_size,
        has_next=(offset + params.page_size) < total,
    )
