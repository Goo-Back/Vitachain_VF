"""AUTH-06 — admin KYC verification endpoints.

Two routes, mounted at ``/api/v1/admin/kyc``:

  * ``GET  /pending``              — FIFO queue of PENDING documents.
  * ``POST /{document_id}/decide`` — APPROVED | REJECTED + note.

These routes use :func:`service_client` because the verification *flip* on
``public.profiles`` is gated by the BEFORE-UPDATE trigger from migration 0005
(``public.enforce_profile_immutability``) which only admits the ``service_role``
JWT. The AUTH-05 AST allow-list pins this very path —
``backend/app/routers/admin/`` — as a permitted ``service_client()`` call
site.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.security import AuthUser, require_role
from app.db import service_client

router = APIRouter(prefix="/admin/kyc", tags=["admin", "kyc"])


class DecideBody(BaseModel):
    decision: Literal["APPROVED", "REJECTED"]
    note: str | None = Field(default=None, max_length=2000)


class DecideResponse(BaseModel):
    document_id: str
    decision: Literal["APPROVED", "REJECTED"]
    user_verified: bool


@router.get("/pending")
async def list_pending(
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
    page: Annotated[int, Query(ge=0)] = 0,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[dict]:
    # JUSTIFICATION: AUTH-06 admin queue — joining kyc_documents to
    # public.profiles requires the admin-read policy on profiles to be in
    # force; service_client() gives the queue a stable join shape without
    # depending on session-level RLS evaluation. routers/admin/ is the
    # AUTH-05 allow-listed prefix.
    client = service_client()

    bucket = client.storage.from_("kyc-documents")
    rows = (
        client.table("kyc_documents")
        .select(
            "id, user_id, document_type, storage_path, mime_type, size_bytes, "
            "status, submitted_at, reviewed_at, reviewer_note, "
            "profiles!kyc_documents_user_id_fkey(full_name, email)"
        )
        .eq("status", "PENDING")
        .order("submitted_at", desc=False)
        .range(page * page_size, page * page_size + page_size - 1)
        .execute()
        .data
    )

    # 5-minute signed-read URL per row — the admin queue UI (ADM-02) needs to
    # render a preview, not a download. URL is short-lived so the row doesn't
    # become a durable, shareable link.
    for r in rows:
        profile = r.pop("profiles", None) or {}
        r["user_email"] = profile.get("email") or ""
        r["user_name"] = profile.get("full_name")
        try:
            signed = bucket.create_signed_url(r["storage_path"], 300)
            r["preview_url"] = signed.get("signedURL") or signed.get("signed_url")
        except Exception:
            r["preview_url"] = None
    return rows


@router.post("/{document_id}/decide", response_model=DecideResponse)
async def decide(
    document_id: uuid.UUID,
    body: DecideBody,
    admin: Annotated[AuthUser, Depends(require_role("ADMIN"))],
) -> DecideResponse:
    # JUSTIFICATION: AUTH-06 verification flip — profiles.verification_status
    # is gated by the migration 0005 immutability trigger; only the
    # service_role JWT can write it. This is the SINGLE legitimate write
    # path for the column in the entire backend.
    client = service_client()

    # Read the target doc first — we need the user_id + a sanity check.
    doc_rows = (
        client.table("kyc_documents")
        .select("id, user_id, status")
        .eq("id", str(document_id))
        .limit(1)
        .execute()
        .data
    )
    if not doc_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="document_not_found",
        )
    doc = doc_rows[0]
    if doc["status"] != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="document_already_decided",
        )

    # All-or-nothing semantics — PostgREST does not expose explicit
    # transactions across requests. We update kyc_documents first (the small
    # write), then the conditional profiles flip, then the outbox row. The
    # profile flip is idempotent (setting VERIFIED twice is a no-op).
    client.table("kyc_documents").update(
        {
            "status": body.decision,
            "reviewed_at": "now()",
            "reviewer_id": str(admin.id),
            "reviewer_note": body.note,
        }
    ).eq("id", str(document_id)).execute()

    user_verified = False
    if body.decision == "APPROVED":
        client.table("profiles").update(
            {"verification_status": "VERIFIED"}
        ).eq("id", doc["user_id"]).execute()
        user_verified = True
        outbox_type = "kyc.approved"
    else:
        # REJECTED — leave profiles.verification_status at PENDING so the
        # user can re-submit. The kyc_documents row records the rejection.
        outbox_type = "kyc.rejected"

    locale_row = (
        client.table("profiles")
        .select("locale")
        .eq("id", doc["user_id"])
        .limit(1)
        .execute()
        .data
    )
    locale = locale_row[0]["locale"] if locale_row else "fr"

    client.table("notifications_outbox").insert(
        {
            "user_id": doc["user_id"],
            "type": outbox_type,
            "locale": locale,
            "context": {
                "document_id": str(document_id),
                "note": body.note,
            },
        }
    ).execute()

    return DecideResponse(
        document_id=str(document_id),
        decision=body.decision,
        user_verified=user_verified,
    )
