#!/usr/bin/env python3
"""Reproduit /kyc/upload-url SANS passer par uvicorn pour capturer l'exception.

On reproduit la séquence exacte du handler create_upload_url() :
  1) Login Supabase pour obtenir un access_token user
  2) Construit un Client supabase-py avec ce JWT
  3) Appelle storage.from_("kyc-documents").create_signed_upload_url(...)

Toute exception est imprimée avec sa stack complète — c'est ce qu'uvicorn
n'arrive pas à montrer dans ta console PowerShell.

Usage :
    cd backend
    .\\.venv\\Scripts\\Activate.ps1
    python ..\\scripts\\repro_upload_url.py <email> <password>
"""

from __future__ import annotations

import sys
import traceback
import uuid
from pathlib import Path

import httpx
from supabase import Client, create_client


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: python repro_upload_url.py <email> <password>", file=sys.stderr)
        return 2

    email, password = sys.argv[1], sys.argv[2]
    root = Path(__file__).resolve().parent.parent
    env = load_env(root / "backend" / ".env")
    supabase_url = env["SUPABASE_URL"]
    anon_key     = env["SUPABASE_ANON_KEY"]
    service_key  = env["SUPABASE_SERVICE_ROLE_KEY"]

    # ── 1) Login ──────────────────────────────────────────────────────────
    print("[1] Login...")
    r = httpx.post(
        f"{supabase_url}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": anon_key, "Content-Type": "application/json"},
        json={"email": email, "password": password},
        timeout=10.0,
    )
    if r.status_code != 200:
        print(f"  ❌ login {r.status_code}: {r.text[:300]}")
        return 1
    sess = r.json()
    user_id = sess["user"]["id"]
    user_token = sess["access_token"]
    print(f"  ✅ user_id = {user_id}")

    storage_path = f"{user_id}/{uuid.uuid4()}.pdf"
    print(f"  path à signer : {storage_path}")

    # ── 2a) Tentative avec JWT user (ce que fait le handler) ──────────────
    print("\n[2a] create_signed_upload_url avec JWT user (= comportement handler)...")
    try:
        client_user: Client = create_client(supabase_url, anon_key)
        client_user.postgrest.auth(user_token)
        # supabase-py v2 : auth() existe sur postgrest, mais storage utilise
        # son propre wrapper. On force le header.
        client_user.storage._client.headers["Authorization"] = f"Bearer {user_token}"
        signed = client_user.storage.from_("kyc-documents").create_signed_upload_url(
            storage_path
        )
        print(f"  ✅ retour : {signed}")
    except Exception:
        print("  ❌ EXCEPTION (c'est probablement ELLE qui cause ton 500) :")
        print("─" * 72)
        traceback.print_exc()
        print("─" * 72)

    # ── 2b) Tentative avec service_role (debug) ───────────────────────────
    print("\n[2b] create_signed_upload_url avec service_role (debug)...")
    try:
        client_admin: Client = create_client(supabase_url, service_key)
        signed = client_admin.storage.from_("kyc-documents").create_signed_upload_url(
            storage_path
        )
        print(f"  ✅ retour : {signed}")
        print(f"  → Le bucket et la lib MARCHENT. Le bug est dans le path 2a "
              f"(permissions du JWT user).")
    except Exception:
        print("  ❌ EXCEPTION même en service_role :")
        print("─" * 72)
        traceback.print_exc()
        print("─" * 72)

    # ── 3) Test REST direct (sans la lib storage3) ────────────────────────
    print("\n[3] Appel REST direct /storage/v1/object/upload/sign/...")
    try:
        rr = httpx.post(
            f"{supabase_url}/storage/v1/object/upload/sign/kyc-documents/{storage_path}",
            headers={
                "apikey": anon_key,
                "Authorization": f"Bearer {user_token}",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        )
        print(f"  → {rr.status_code}")
        print(f"  body: {rr.text[:500]}")
    except Exception:
        traceback.print_exc()

    return 0


if __name__ == "__main__":
    sys.exit(main())
