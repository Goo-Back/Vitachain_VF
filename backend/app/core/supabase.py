"""Service-role Supabase client. **Backend-only** (AUTH-05).

Bypasses RLS. Use only in routers that need server-side writes (KAT-03 ingest,
SEC-04 reservation, NOT-* email triggers, ADM-* admin actions). Routes that
read on behalf of an end user must use the caller's JWT instead (AUTH-04).
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache(maxsize=1)
def get_supabase_admin() -> Client:
    s = get_settings()
    return create_client(
        str(s.supabase_url),
        s.supabase_service_role_key.get_secret_value(),
    )
