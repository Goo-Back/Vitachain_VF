"""KAT-08 — AI diagnostic worker package.

Long-running asyncio worker that picks up PENDING rows from
``m1_katara_diagnostics`` (created by KAT-07's POST handler), assembles the
composite agronomic payload (OpenWeatherMap forecast, Sentinel-2 NDVI,
7-day per-parcel sensor average), calls Gemini, and writes back COMPLETED or
FAILED through the service-role audit-guard contract.

Entry-point::

    python -m app.workers.katara_diagnostic

Package layout mirrors :mod:`app.workers.katara_threshold` (KAT-06):

* :mod:`.__main__`          — Sentry init, JSON logs, signal handlers.
* :mod:`.listener`          — LISTEN/NOTIFY on ``katara_diagnostic_requested``
                              + 60 s polling backstop.
* :mod:`.claimer`           — atomic PENDING → PROCESSING UPDATE.
* :mod:`.orchestrator`      — sequential gather + Gemini + terminal UPDATE.
* :mod:`.owm_client`        — BR-K3 OWM cache (3 h TTL, lat/lng-quantised).
* :mod:`.sentinel_client`   — BR-K7 Sentinel-2 NDVI cache (12 h TTL).
* :mod:`.telemetry_aggregator` — 7-day per-parcel SECURITY-DEFINER RPC.
* :mod:`.prompts`           — Jinja2 prompt templates + locale dispatch.
* :mod:`.gemini_client`     — google-generativeai wrapper with 429 retry.
* :mod:`.updater`           — terminal-state UPDATE helpers (PROCESSING-gated).
"""
