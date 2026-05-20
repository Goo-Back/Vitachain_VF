"""KAT-09 — diagnostic completion email worker package.

LISTENs on the `katara_diagnostic_completed` Postgres channel emitted by the
KAT-09 AFTER UPDATE trigger (migration 0024) on the first PROCESSING →
COMPLETED transition of an `m1_katara_diagnostics` row, and dispatches a
locale-appropriate Brevo template to the parcel's owning farmer.

Package layout mirrors `app.workers.katara_threshold` and
`app.workers.katara_diagnostic`:

    __init__.py    — this marker
    __main__.py    — entrypoint: Sentry init, JSON log format, signals
    listener.py    — LISTEN/NOTIFY + 30-minute backstop poll
    sender.py      — fetch + Markdown→HTML + Brevo dispatch + notified_at write
"""
