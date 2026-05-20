"""AUTH-05 — every caller of ``service_client()`` lives in an allow-listed module.

The convention is that ``service_client()`` bypasses RLS and must only be
called from code paths that are *intentionally* admin- or system-level
(admin routers, async workers, the on-signup hook, the service's own
definition). Every other caller is a regression that would silently grant
RLS-bypass privileges to a user-facing handler.

We enforce the convention with an AST walk over ``backend/app/`` rather
than a string grep so we cannot be fooled by a comment, a docstring, or
a string literal that happens to mention ``service_client``.
"""
from __future__ import annotations

import ast
from pathlib import Path

BACKEND_APP = Path(__file__).resolve().parents[1] / "app"

# Allow-listed call sites. Edit only with a code review that names the
# specific reason the user JWT cannot be used (admin, system-level write,
# on-signup hook). Adding an entry here is itself an AUTH-05 review event.
ALLOW_PREFIXES: tuple[str, ...] = (
    "routers/admin/",                # ADM-* admin endpoints
    "workers/",                       # async workers (NOT-01 mailer, KAT-09 diagnostic, ...)
    # KAT-06 — explicit child path under workers/. Redundant with the parent
    # prefix above but documented here so `git blame` carries the story id;
    # the worker writes m1_katara_thresholds.last_alert_at via service-role
    # per the KAT-05 RLS contract — only this module legitimately writes
    # the audit columns.
    "workers/katara_threshold/",
    # KAT-08 — diagnostic worker. Same redundant-with-`workers/`-on-purpose
    # pattern. The worker is the sole legitimate writer of
    # m1_katara_diagnostics.status / result_text / error_detail / started_at /
    # completed_at and of the m1_katara_owm_cache / m1_katara_ndvi_cache
    # write paths (both system-internal, no authenticated INSERT policy).
    "workers/katara_diagnostic/",
    # KAT-09 — diagnostic completion email worker. Reads
    # m1_katara_diagnostics + profiles + m1_katara_parcels for the Brevo
    # payload (all owner-readable under RLS, but the worker has no user JWT —
    # it reacts to a system NOTIFY), and writes m1_katara_diagnostics.notified_at
    # via service_role (the KAT-07 audit-guard trigger clamps non-service
    # writers to OLD values on every column, so the service role is the only
    # legitimate writer of the idempotency anchor).
    "workers/katara_diagnostic_email/",
    # KAT-11 — offline-device detection worker. The default implementation
    # talks to Postgres directly via asyncpg using DATABASE_URL (already
    # service-role-scoped at the connection level), so this entry is a
    # docstring-style marker rather than a live allow-list user. If a future
    # refactor routes any UPDATE through the Supabase service_client() the
    # prefix already covers it; the inline `# JUSTIFICATION:` comment must
    # then be added at the callsite. The worker is the sole legitimate
    # writer of m1_katara_devices.status='OFFLINE' + last_offline_alert_at.
    "workers/katara_offline/",
    "auth_hooks/",                    # Supabase Auth on-signup post-processing
    "db.py",                          # the definition itself
    # KAT-03 — telemetry ingest. The endpoint authenticates a device (not a
    # user) via a constant-time bcrypt verify inside public.m1_katara_ingest;
    # the table is FORCE-RLS with no INSERT policy, so the service role is
    # the only legitimate writer. Justification is inline at the callsite.
    "modules/katara/ingest.py",
)


def _is_service_client_call(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call):
        return False
    f = node.func
    if isinstance(f, ast.Name) and f.id == "service_client":
        return True
    if isinstance(f, ast.Attribute) and f.attr == "service_client":
        return True
    return False


def _iter_callsites() -> list[tuple[Path, int]]:
    sites: list[tuple[Path, int]] = []
    for py in BACKEND_APP.rglob("*.py"):
        try:
            tree = ast.parse(py.read_text(encoding="utf-8"), filename=str(py))
        except SyntaxError:
            # Let the regular test suite catch syntax errors.
            continue
        for node in ast.walk(tree):
            if _is_service_client_call(node):
                sites.append((py, node.lineno))
    return sites


def test_every_service_client_callsite_is_allowlisted() -> None:
    violations: list[str] = []
    for path, lineno in _iter_callsites():
        rel = path.relative_to(BACKEND_APP).as_posix()
        if not any(rel.startswith(prefix) for prefix in ALLOW_PREFIXES):
            violations.append(f"{rel}:{lineno}")
    assert not violations, (
        "AUTH-05 — service_client() called from a non-allowlisted path:\n  "
        + "\n  ".join(violations)
        + "\n\nEither move the caller under "
        + ", ".join(ALLOW_PREFIXES)
        + " (admin / worker / hook), or replace with "
        + "Depends(get_db_for_user) which routes the user's JWT to PostgREST "
        + "and lets RLS evaluate. See docs/runbook.md §AUTH-05."
    )


def test_callsite_walker_actually_walks_backend_app() -> None:
    """Sanity check: the walker must be able to parse the backend app tree.

    Without this, a future refactor that breaks the path resolution would
    silently turn the main assertion into a no-op (zero callsites => pass).
    """
    assert BACKEND_APP.is_dir(), f"backend/app/ not at {BACKEND_APP}"
    files = list(BACKEND_APP.rglob("*.py"))
    assert files, "no .py files discovered under backend/app/ — walker is broken"
