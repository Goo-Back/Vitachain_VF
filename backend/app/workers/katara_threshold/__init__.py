"""KAT-06 — threshold-crossing email alerts.

Long-running asyncio worker. Subscribes to the Postgres ``NOTIFY
katara_telemetry_inserted`` channel emitted by KAT-03's ingest trigger,
evaluates BR-K2 anti-spam against ``m1_katara_thresholds``, and dispatches a
locale-appropriate Brevo email when a reading crosses a configured bound.

Entry-point:
    python -m app.workers.katara_threshold
"""
