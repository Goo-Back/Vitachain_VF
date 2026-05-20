#!/usr/bin/env python3
"""Diagnostic complet du backend VitaChain.

Sondes (lecture seule, ne modifie rien) :

  [A] uvicorn est-il joignable sur :8000 ?
  [B] Les 3 healthz répondent-ils ?
  [C] OpenAPI charge-t-il toutes les routes attendues (auth, kyc, katara) ?
  [D] Login Supabase + claims JWT
  [E] Vérification signature HS256 avec le secret du backend
  [F] Bucket Supabase Storage "kyc-documents" existe ?
  [G] /api/v1/kyc/me            (GET authentifié — sanity check)
  [H] /api/v1/kyc/upload-url    (POST authentifié — la route qui casse)

Usage :

    cd backend
    .\\.venv\\Scripts\\Activate.ps1
    python ..\\scripts\\diagnose_backend.py <email> <password>
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import httpx


# ── Helpers ──────────────────────────────────────────────────────────────────


def _b64url_decode(seg: str) -> bytes:
    padding = "=" * (-len(seg) % 4)
    return base64.urlsafe_b64decode(seg + padding)


def decode_unverified(token: str) -> tuple[dict, dict]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError(f"Pas un JWT compact ({len(parts)} segments)")
    return json.loads(_b64url_decode(parts[0])), json.loads(_b64url_decode(parts[1]))


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


def section(title: str) -> None:
    print(f"\n{'═' * 72}\n {title}\n{'═' * 72}")


def ok(msg: str) -> None:
    print(f"  ✅ {msg}")


def warn(msg: str) -> None:
    print(f"  ⚠  {msg}")


def fail(msg: str) -> None:
    print(f"  ❌ {msg}")


# ── Main ─────────────────────────────────────────────────────────────────────


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: python diagnose_backend.py <email> <password>", file=sys.stderr)
        return 2

    email, password = sys.argv[1], sys.argv[2]

    root = Path(__file__).resolve().parent.parent
    backend_env = load_env(root / "backend" / ".env")
    supabase_url   = backend_env.get("SUPABASE_URL", "")
    anon_key       = backend_env.get("SUPABASE_ANON_KEY", "")
    service_key    = backend_env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    jwt_secret     = backend_env.get("SUPABASE_JWT_SECRET", "")
    api            = "http://localhost:8000"

    issues: list[str] = []

    # ── [A] uvicorn joignable ─────────────────────────────────────────────
    section("[A] Uvicorn joignable sur :8000")
    try:
        r = httpx.get(api, timeout=3.0)
        ok(f"GET {api} → {r.status_code}")
    except httpx.HTTPError as exc:
        fail(f"Backend injoignable : {exc}")
        fail("→ Vérifie que uvicorn tourne. Stop ici, rien ne pourra passer.")
        return 1

    # ── [B] Healthz ───────────────────────────────────────────────────────
    section("[B] Healthchecks")
    for path in ("/api/v1/healthz", "/api/v1/katara/healthz"):
        try:
            r = httpx.get(f"{api}{path}", timeout=3.0)
            if r.status_code == 200:
                ok(f"GET {path} → 200 {r.text[:80]}")
            else:
                warn(f"GET {path} → {r.status_code} {r.text[:120]}")
        except httpx.HTTPError as exc:
            fail(f"GET {path} : {exc}")

    # ── [C] OpenAPI : routes attendues ───────────────────────────────────
    section("[C] Routes chargées (OpenAPI)")
    try:
        r = httpx.get(f"{api}/openapi.json", timeout=5.0)
        if r.status_code != 200:
            fail(f"openapi.json indisponible : {r.status_code}")
        else:
            spec = r.json()
            paths = set(spec.get("paths", {}).keys())
            expected = [
                "/api/v1/kyc/upload-url",
                "/api/v1/kyc/submit",
                "/api/v1/kyc/me",
                "/api/v1/katara/parcels",
                "/api/v1/katara/ingest",
            ]
            for p in expected:
                if p in paths:
                    ok(f"route présente : {p}")
                else:
                    fail(f"route MANQUANTE : {p}")
                    issues.append(f"Route {p} non chargée — vérifier app/main.py include_router()")
    except Exception as exc:
        fail(f"openapi : {exc}")

    # ── [D] Login + claims ───────────────────────────────────────────────
    section("[D] Login Supabase + claims JWT")
    try:
        r = httpx.post(
            f"{supabase_url}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": anon_key, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        fail(f"Login Supabase échoué : {exc}")
        return 1
    if r.status_code != 200:
        fail(f"Login refusé : {r.status_code} {r.text[:200]}")
        return 1
    session = r.json()
    token: str = session["access_token"]
    header, payload = decode_unverified(token)
    ok(f"Login OK. alg={header.get('alg')}, sub={payload.get('sub')}")
    ok(f"  user_role={payload.get('user_role')}  "
       f"verification_status={payload.get('verification_status')}")

    alg = header.get("alg")
    if alg != "HS256":
        fail(f"alg = {alg} (le backend attend HS256). Va dans Supabase Studio "
             f"→ Settings → JWT Keys → 'Rotate keys' pour promouvoir Legacy HS256.")
        issues.append(f"JWT signé en {alg} au lieu de HS256 — ROTATION REQUISE")

    # ── [E] Vérif signature ──────────────────────────────────────────────
    section("[E] Vérification signature côté backend")
    try:
        import jwt as pyjwt
    except ImportError:
        fail("PyJWT absent du venv")
        return 1
    try:
        pyjwt.decode(token, jwt_secret, algorithms=["HS256"], audience="authenticated")
        ok("Signature OK avec SUPABASE_JWT_SECRET du backend.")
    except pyjwt.InvalidSignatureError:
        fail("Signature INVALIDE — le secret backend/.env ne matche pas Supabase.")
        fail("→ Supabase Studio → Settings → JWT Keys → onglet 'Legacy JWT Secret' "
             "→ Reveal → copier dans backend/.env → RESTART uvicorn")
        issues.append("SUPABASE_JWT_SECRET désynchronisé")
    except pyjwt.InvalidAlgorithmError:
        fail(f"Algorithme {alg} non autorisé. Voir [D].")
    except Exception as exc:
        warn(f"Vérif partielle : {type(exc).__name__}: {exc}")

    # ── [F] Bucket Storage ───────────────────────────────────────────────
    section("[F] Bucket Supabase Storage 'kyc-documents'")
    try:
        r = httpx.get(
            f"{supabase_url}/storage/v1/bucket/kyc-documents",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            },
            timeout=5.0,
        )
        if r.status_code == 200:
            b = r.json()
            ok(f"Bucket existe : id={b.get('id')} public={b.get('public')} "
               f"created_at={b.get('created_at', '')[:19]}")
        elif r.status_code == 404:
            fail("Bucket 'kyc-documents' INTROUVABLE.")
            fail("→ Migration 0004 pas appliquée ? Re-lance db\\scripts\\push.sh")
            issues.append("Bucket kyc-documents manquant")
        else:
            warn(f"Réponse {r.status_code} : {r.text[:200]}")
    except httpx.HTTPError as exc:
        warn(f"Probe storage : {exc}")

    headers_auth = {"Authorization": f"Bearer {token}"}

    # ── [G] GET /kyc/me ──────────────────────────────────────────────────
    section("[G] GET /api/v1/kyc/me (sanity)")
    try:
        r = httpx.get(f"{api}/api/v1/kyc/me", headers=headers_auth, timeout=10.0)
        print(f"  → {r.status_code}")
        body = r.text[:500]
        print(f"  body: {body}")
        if r.status_code == 200:
            ok("Endpoint répond. Auth chain complète OK.")
        elif r.status_code == 401:
            fail("401 — JWT pas validé. Cf. [E].")
            issues.append("/kyc/me en 401")
        elif r.status_code == 403:
            warn(f"403 : {body} (probablement 'kyc_not_required' si CITIZEN)")
        elif r.status_code == 500:
            fail("500 sur /kyc/me — bug backend, voir uvicorn.log")
            issues.append("/kyc/me en 500")
    except httpx.HTTPError as exc:
        fail(f"GET /kyc/me : {exc}")

    # ── [H] POST /kyc/upload-url ─────────────────────────────────────────
    section("[H] POST /api/v1/kyc/upload-url (la route qui casse)")
    payload_body = {
        "document_type": "CIN",
        "mime_type": "application/pdf",
        "size_bytes": 12345,
    }
    print(f"  payload: {payload_body}")
    try:
        r = httpx.post(
            f"{api}/api/v1/kyc/upload-url",
            headers={**headers_auth, "Content-Type": "application/json"},
            json=payload_body,
            timeout=15.0,
        )
        print(f"  → {r.status_code}")
        print(f"  headers: {dict(r.headers)}")
        print(f"  body: {r.text[:800]}")
        if r.status_code == 200:
            ok("UPLOAD-URL OK. Le 500 du browser vient donc d'ailleurs (Next.js).")
        elif r.status_code == 500:
            fail("500 confirmé côté backend.")
            fail("→ Regarde uvicorn.log ou la console uvicorn pour la stack trace.")
            issues.append("/kyc/upload-url en 500 — trace requise")
        else:
            warn(f"Status inattendu : {r.status_code}")
    except httpx.HTTPError as exc:
        fail(f"POST /kyc/upload-url : {exc}")

    # ── Verdict ──────────────────────────────────────────────────────────
    section("VERDICT")
    if not issues:
        print("  Aucun problème détecté côté backend pour ce compte.")
        print("  Si le browser voit encore un 500 → c'est Next.js : regarde le")
        print("  terminal 'npm run dev'.")
    else:
        print("  Problèmes à corriger (dans cet ordre) :")
        for i, x in enumerate(issues, 1):
            print(f"    {i}. {x}")
    print()
    return 0 if not issues else 1


if __name__ == "__main__":
    sys.exit(main())
