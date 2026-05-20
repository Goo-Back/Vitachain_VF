#!/usr/bin/env python3
"""KAT-04 — seed N days of synthetic telemetry against a demo device.

Reads DEVICE_ID, DEVICE_API_KEY, and INGEST_URL from the environment (the
values printed by the KAT-02 pairing flow). Default is 7 d × 96 payloads/day
= 672 rows; set DAYS=30 for the BR-K4 30 d ceiling exercise (2 880 rows).

Idempotent — KAT-03's ``(device_id, recorded_at)`` unique index silently
dedups on a re-run, so running this twice doesn't double the dataset.

Example:
    DEVICE_ID=ESP-KAT-001 \\
    DEVICE_API_KEY=vk_xxxxxxxxxxxxxxxx \\
    INGEST_URL=https://staging.vitachain.ma/api/v1/katara/ingest \\
    DAYS=30 \\
    python scripts/seed_kat04_demo.py
"""
from __future__ import annotations

import math
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone

try:
    import requests
except ImportError:
    sys.stderr.write(
        "requests is required: pip install requests\n",
    )
    sys.exit(2)


def _env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.stderr.write(f"missing required env: {name}\n")
        sys.exit(2)
    return v


def main() -> int:
    url = _env("INGEST_URL")
    device = _env("DEVICE_ID")
    key = _env("DEVICE_API_KEY")
    days = int(os.environ.get("DAYS", "7"))
    cadence_min = int(os.environ.get("CADENCE_MIN", "15"))

    total = days * (24 * 60 // cadence_min)
    start = datetime.now(timezone.utc) - timedelta(days=days)

    print(
        f"seeding {total} rows ({days} d × {24 * 60 // cadence_min}/d) "
        f"-> {url} (device={device})",
    )

    ok = 0
    skipped = 0
    failed = 0
    t0 = time.monotonic()

    for i in range(total):
        ts = start + timedelta(minutes=cadence_min * i)
        # 24 h sinusoidal cycle (1 cycle per 96 samples at 15-min cadence)
        diurnal_period = 24 * 60 // cadence_min
        diurnal = math.sin(i * 2 * math.pi / diurnal_period)
        # gentle soil-drying trend across the window (~6 % moisture loss)
        drying = -i / total * 6
        body = {
            "soil_moisture": round(
                38 + diurnal * 4 + drying + random.uniform(-1, 1), 1,
            ),
            "soil_temperature": round(
                21 + diurnal * 3 + random.uniform(-0.4, 0.4), 1,
            ),
            "soil_pH": round(6.7 + random.uniform(-0.08, 0.08), 2),
            "soil_conductivity": round(
                1700 + diurnal * 80 + random.uniform(-30, 30), 0,
            ),
            "battery_level": max(40, 100 - i // 50),
            "recorded_at": ts.isoformat(),
        }
        try:
            r = requests.post(
                url,
                json=body,
                headers={
                    "X-Device-Id": device,
                    "X-Device-Api-Key": key,
                },
                timeout=5,
            )
        except requests.RequestException as exc:
            failed += 1
            sys.stderr.write(f"!! {ts.isoformat()} network error: {exc}\n")
            continue

        if r.status_code == 204:
            ok += 1
        elif r.status_code == 409:
            skipped += 1
        else:
            failed += 1
            sys.stderr.write(
                f"!! {ts.isoformat()} status={r.status_code} body={r.text[:200]}\n",
            )

        time.sleep(0.03)

    dt = time.monotonic() - t0
    print(
        f"done in {dt:.1f}s — ok={ok} skipped={skipped} failed={failed}",
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
