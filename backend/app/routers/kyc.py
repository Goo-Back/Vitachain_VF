"""AUTH-06 — user-facing KYC endpoints.

Three routes, mounted at ``/api/v1/kyc``:

  * ``POST /upload-url`` — issue a signed upload URL for the bucket.
  * ``POST /submit``     — finalise a submission row.
  * ``GET  /me``         — list my submissions + signed-read URLs.

All three are gated on :func:`get_current_user` (any authenticated user can
reach them) plus an in-handler role check (CITIZEN gets 403
``kyc_not_required`` — citizens have no KYC obligation by PRD §4.3).

These handlers do NOT use :func:`service_client`. Every write here flows under
the user's JWT and the AUTH-06 RLS policies on ``public.kyc_documents``
enforce ownership. The verification *flip* on ``public.profiles`` is a
separate admin endpoint under ``backend/app/routers/admin/kyc.py``.
"""

from __future__ import annotations

import urllib.parse
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from supabase import Client

from app.core.config import get_settings
from app.core.security import AuthUser, get_current_user, get_db_for_user

router = APIRouter(prefix="/kyc", tags=["kyc"])

DocumentType = Literal["RC", "CIN", "AGRI_CARD", "OTHER"]
AllowedMime = Literal[
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
]
MAX_SIZE_BYTES = 5 * 1024 * 1024

_EXT_FOR_MIME: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
_MIME_FOR_EXT: dict[str, str] = {
    "pdf": "application/pdf",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}


class UploadUrlRequest(BaseModel):
    document_type: DocumentType
    mime_type: AllowedMime
    size_bytes: int = Field(gt=0, le=MAX_SIZE_BYTES)


class UploadUrlResponse(BaseModel):
    upload_url: str
    storage_path: str


class SubmitRequest(BaseModel):
    document_type: DocumentType
    storage_path: str

    @field_validator("storage_path")
    @classmethod
    def _path_shape(cls, v: str) -> str:
        # Defence-in-depth: the storage policy enforces the same rule, but
        # failing here returns 400 with a clear error instead of the bucket's
        # 403 later.
        parts = v.split("/")
        if len(parts) != 2 or not parts[1]:
            raise ValueError("storage_path must be '<user_id>/<filename>'")
        try:
            uuid.UUID(parts[0])
        except ValueError as exc:
            raise ValueError("storage_path[0] must be a UUID") from exc
        return v


class SubmitResponse(BaseModel):
    id: str
    status: str


def _ensure_pro(user: AuthUser) -> None:
    if user.role not in ("FARMER", "RESTAURANT"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="kyc_not_required",
        )


@router.post("/upload-url", response_model=UploadUrlResponse)
async def create_upload_url(
    body: UploadUrlRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> UploadUrlResponse:
    _ensure_pro(user)

    ext = _EXT_FOR_MIME[body.mime_type]
    object_id = uuid.uuid4()
    storage_path = f"{user.id}/{object_id}.{ext}"

    signed = db.storage.from_("kyc-documents").create_signed_upload_url(storage_path)
    # supabase-py v2 returns either {"signedUrl": ..., "path": ...} or
    # {"signed_url": ..., "path": ...} depending on the storage3 version.
    upload_url = signed.get("signedUrl") or signed.get("signed_url")
    if not upload_url:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="signed_upload_url_unavailable",
        )
    # storage3 v2 bug: _client.base_url is unset so create_signed_upload_url
    # returns a relative path (e.g. "object/upload/sign/..."). The browser
    # would resolve it against the Next.js origin instead of Supabase.
    # _base_url has a yarl double-slash issue, so rebuild from settings instead.
    if not upload_url.startswith("http"):
        supabase_url = str(get_settings().supabase_url).rstrip("/")
        base = f"{supabase_url}/storage/v1/"
        upload_url = urllib.parse.urljoin(base, upload_url)
    return UploadUrlResponse(upload_url=upload_url, storage_path=storage_path)


@router.post(
    "/submit",
    response_model=SubmitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit(
    body: SubmitRequest,
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> SubmitResponse:
    _ensure_pro(user)

    if not body.storage_path.startswith(f"{user.id}/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="storage_path_user_mismatch",
        )

    mime = _mime_from_ext(body.storage_path)
    if mime is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="unsupported_extension",
        )

    size_bytes = _size_from_storage(db, body.storage_path)

    # The PostgREST INSERT below runs under the user's JWT; the
    # kyc_documents_insert_own RLS policy is the ultimate gate. The body's
    # `status` is omitted — the column default is 'PENDING' and the policy's
    # WITH CHECK refuses anything else.
    inserted = (
        db.table("kyc_documents")
        .insert(
            {
                "user_id": str(user.id),
                "document_type": body.document_type,
                "storage_path": body.storage_path,
                "mime_type": mime,
                "size_bytes": size_bytes,
            }
        )
        .execute()
        .data[0]
    )

    # Enqueue the submission notification for NOT-01 to dispatch.
    # Non-fatal: a notification outage must not block the submission —
    # kyc_documents is the authoritative record.
    try:
        db.table("notifications_outbox").insert(
            {
                "user_id": str(user.id),
                "type": "kyc.submitted",
                "locale": _user_locale(db, user.id),
                "context": {"document_id": inserted["id"]},
            }
        ).execute()
    except Exception:
        pass

    return SubmitResponse(id=inserted["id"], status=inserted["status"])


@router.get("/me")
async def list_my_submissions(
    user: Annotated[AuthUser, Depends(get_current_user)],
    db: Annotated[Client, Depends(get_db_for_user)],
) -> list[dict]:
    _ensure_pro(user)

    rows = (
        db.table("kyc_documents")
        .select(
            "id, document_type, storage_path, status, "
            "submitted_at, reviewed_at, reviewer_note"
        )
        .eq("user_id", str(user.id))
        .order("submitted_at", desc=True)
        .execute()
        .data
    )

    bucket = db.storage.from_("kyc-documents")
    for r in rows:
        # 60-second signed-read URL per row; the user sees the preview but
        # the URL itself is not durable.
        try:
            signed = bucket.create_signed_url(r["storage_path"], 60)
        except Exception:
            r["preview_url"] = None
            continue
        r["preview_url"] = signed.get("signedURL") or signed.get("signed_url")
    return rows


# --- internal helpers --------------------------------------------------------


def _mime_from_ext(path: str) -> str | None:
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return _MIME_FOR_EXT.get(ext)


def _size_from_storage(db: Client, path: str) -> int:
    folder, name = path.rsplit("/", 1)
    try:
        info = db.storage.from_("kyc-documents").list(folder)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="upload_not_found",
        ) from exc
    for entry in info:
        if entry.get("name") == name:
            meta = entry.get("metadata") or {}
            size = meta.get("size")
            if size is None:
                break
            if int(size) > MAX_SIZE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="document_too_large",
                )
            return int(size)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="upload_not_found",
    )


def _user_locale(db: Client, user_id: uuid.UUID) -> str:
    rows = (
        db.table("profiles")
        .select("locale")
        .eq("id", str(user_id))
        .limit(1)
        .execute()
        .data
    )
    return rows[0]["locale"] if rows else "fr"
