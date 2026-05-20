#!/usr/bin/env python3
"""Diagnostic JWT — login Supabase, décode le JWT côté client, et reproduit
la requête `/api/v1/kyc/upload-url` pour expliquer le 401 invalid_token.

Lecture seule : ne modifie rien en DB.

Usage :

    cd backend
    .\\.venv\\Scripts\\Activate.ps1
    python ..\\scripts\\diagnose_jwt.py farmer1@test.local <password>

Le script :
  1) Se connecte via le SDK Supabase (mêmes credentials que le frontend).
  2) Décode le JWT sans le vérifier — on veut juste voir alg/iss/aud/claims.
  3) Tente de le vérifier avec le SUPABASE_JWT_SECRET du backend pour
     confirmer si le secret matche (cause #1 de 401 invalid_token).
  4) Appelle réellement /api/v1/kyc/upload-url avec ce JWT pour reproduire
     l'erreur exacte que voit le navigateur.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

import httpx


def _b64url_decode(seg: str) -> bytes:
    # JWT base64url : pas de padding → on en ajoute
    padding = "=" * (-len(seg) % 4)
    return base64.urlsafe_b64decode(seg + padding)


def decode_unverified(token: str) -> tuple[dict, dict]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError(
            f"Pas un JWT compact (3 segments attendus, {len(parts)} reçus) : "
            f"{token[:40]}..."
        )
    header = json.loads(_b64url_decode(parts[0]))
    payload = json.loads(_b64url_decode(parts[1]))
    return header, payload


def load_env(env_path: Path) -> dict[str, str]:
    """Mini-parser de .env, sans dépendance."""
    env: dict[str, str] = {}
    if not env_path.exists():
        return env
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: python diagnose_jwt.py <email> <password>", file=sys.stderr)
        return 2

    email, password = sys.argv[1], sys.argv[2]

    root = Path(__file__).resolve().parent.parent
    backend_env = load_env(root / "backend" / ".env")
    frontend_env = load_env(root / "frontend" / ".env.local")

    supabase_url       = backend_env.get("SUPABASE_URL", "")
    anon_key           = backend_env.get("SUPABASE_ANON_KEY", "")
    jwt_secret         = backend_env.get("SUPABASE_JWT_SECRET", "")
    audience           = "authenticated"   # défaut du backend
    frontend_url       = frontend_env.get("NEXT_PUBLIC_SUPABASE_URL", "")
    backend_api_base   = "http://localhost:8000"

    print("─" * 70)
    print(f"backend  SUPABASE_URL                 = {supabase_url}")
    print(f"frontend NEXT_PUBLIC_SUPABASE_URL     = {frontend_url}")
    if supabase_url and frontend_url and supabase_url != frontend_url:
        print("🚨 Backend et frontend pointent sur DEUX projets Supabase différents.")
    print(f"backend  SUPABASE_JWT_SECRET (premier/dernier 6) "
          f"= {jwt_secret[:6]}…{jwt_secret[-6:]} ({len(jwt_secret)} chars)")
    print("─" * 70)

    # ── 1) Login via REST auth (pas de dépendance à supabase-py) ──────────
    print(f"\n[1/4] Login {email} via {supabase_url}/auth/v1/token ...")
    r = httpx.post(
        f"{supabase_url}/auth/v1/token",
        params={"grant_type": "password"},
        headers={
            "apikey": anon_key,
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password},
        timeout=10.0,
    )
    if r.status_code != 200:
        print(f"❌ Login échoué : {r.status_code} {r.text[:300]}")
        return 1
    session = r.json()
    token = session["access_token"]
    print(f"✅ Login OK. access_token ({len(token)} chars) : "
          f"{token[:32]}...{token[-16:]}")

    # ── 2) Décodage sans vérification ─────────────────────────────────────
    print("\n[2/4] Décodage du JWT (sans vérif)...")
    try:
        header, payload = decode_unverified(token)
    except ValueError as exc:
        print(f"❌ {exc}")
        return 1
    print("  Header :")
    for k, v in header.items():
        print(f"    {k:15} = {v}")
    print("  Payload (extrait) :")
    for k in ("iss", "aud", "exp", "sub", "email", "role",
              "user_role", "verification_status"):
        if k in payload:
            print(f"    {k:20} = {payload[k]}")

    alg = header.get("alg")
    iss = payload.get("iss")
    aud = payload.get("aud")

    issues = []
    if alg != "HS256":
        issues.append(
            f"🚨 alg = {alg} (le backend attend HS256). Supabase a probablement "
            f"basculé sur les signing keys asymétriques (ES256/RS256). "
            f"Solution : Supabase Studio → Settings → API → JWT Settings → "
            f"désactive 'Use new asymmetric JWT signing keys' ou migre le "
            f"backend vers JWKS."
        )
    if aud != audience:
        issues.append(
            f"🚨 aud = {aud!r} (le backend attend {audience!r})."
        )
    expected_iss = f"{supabase_url}/auth/v1"
    if iss and iss != expected_iss:
        issues.append(
            f"🚨 iss = {iss} (attendu : {expected_iss}). Le frontend et le "
            f"backend pointent sur deux projets différents."
        )

    # ── 3) Vérif crypto avec le secret du backend ─────────────────────────
    print("\n[3/4] Vérification de la signature avec SUPABASE_JWT_SECRET du backend...")
    try:
        import jwt as pyjwt   # PyJWT (déjà installé dans backend/.venv)
    except ImportError:
        print("⚠ PyJWT non installé — lance ce script depuis backend/.venv")
        return 1
    if not jwt_secret:
        print("❌ SUPABASE_JWT_SECRET absent de backend/.env")
        return 1
    try:
        pyjwt.decode(token, jwt_secret, algorithms=["HS256"], audience=audience)
        print("✅ Signature OK. Le secret du backend matche le projet.")
    except pyjwt.ExpiredSignatureError:
        print("⚠ Token expiré (mais signature OK).")
    except pyjwt.InvalidSignatureError:
        issues.append(
            "🚨 Signature INVALIDE — le SUPABASE_JWT_SECRET dans backend/.env "
            "ne correspond pas au secret du projet Supabase. Va dans "
            "Supabase Studio → Settings → API → JWT Secret, copie la valeur, "
            "remplace dans backend/.env, et REDÉMARRE uvicorn (Pydantic "
            "Settings ne relit pas le fichier à chaud)."
        )
        print("❌ Signature INVALIDE.")
    except pyjwt.InvalidAudienceError:
        issues.append(f"🚨 Audience invalide côté backend (aud JWT = {aud}).")
        print("❌ Audience invalide.")
    except Exception as exc:  # noqa: BLE001
        print(f"❌ Échec de vérification : {type(exc).__name__}: {exc}")

    # ── 4) Reproduction de la requête KYC ─────────────────────────────────
    print(f"\n[4/4] Reproduction : POST {backend_api_base}/api/v1/kyc/upload-url ...")
    try:
        kr = httpx.post(
            f"{backend_api_base}/api/v1/kyc/upload-url",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "document_type": "CIN",
                "mime_type": "application/pdf",
                "size_bytes": 12345,
            },
            timeout=10.0,
        )
        print(f"  → {kr.status_code} {kr.text[:300]}")
        if kr.status_code == 200:
            print("  ✅ Le backend valide le JWT. Le problème vient d'ailleurs.")
        elif kr.status_code == 401:
            print("  ❌ Reproduction réussie : 401 invalid_token confirmé.")
    except httpx.HTTPError as exc:
        print(f"  ⚠ Backend injoignable sur {backend_api_base} : {exc}")
        print("    → Vérifie que uvicorn tourne sur le port 8000.")

    # ── Verdict ───────────────────────────────────────────────────────────
    print("\n" + "─" * 70)
    if issues:
        print("VERDICT — problèmes détectés :\n")
        for issue in issues:
            print(f"  • {issue}\n")
    else:
        print("VERDICT — aucun problème JWT détecté. Si tu as quand même eu un")
        print("401, le backend tournait peut-être avec un ancien .env. Ctrl+C")
        print("sur uvicorn et relance-le.")
    print("─" * 70)
    return 0 if not issues else 1


if __name__ == "__main__":
    sys.exit(main())
