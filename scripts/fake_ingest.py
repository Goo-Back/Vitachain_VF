#!/usr/bin/env python3
"""KAT-03 — demo-day fallback ESP32 telemetry generator.

Used only if the physical ESP32 fails in the field during the Day-1 rehearsal.
Pushes a plausible soil payload every 15 seconds (not minutes — so the demo
dashboard updates in real time).

Usage:

    INGEST_URL="https://vitachain.ma/api/v1/katara/ingest" \\
    DEVICE_ID="ESP-KAT-001" \\
    DEVICE_API_KEY="vk_<paired-from-kat02>" \\
    python scripts/fake_ingest.py

The plaintext api_key is the value shown ONCE at pairing (KAT-02). If you no
longer have it, run the rotate-key flow on the parcel detail page first.
"""

from __future__ import annotations

import os
import random
import time
from datetime import datetime, timezone

import requests

URL    = os.environ["INGEST_URL"]
DEVICE = os.environ["DEVICE_ID"]
KEY    = os.environ["DEVICE_API_KEY"]


def _payload() -> dict[str, object]:
    return {
        "soil_moisture":     round(random.uniform(28, 42), 1),
        "soil_temperature":  round(random.uniform(18, 24), 1),
        "soil_pH":           round(random.uniform(6.2, 7.4), 2),
        "soil_conductivity": round(random.uniform(1200, 2200), 0),
        "battery_level":     random.randint(70, 100),
        "recorded_at":       datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    while True:
        r = requests.post(
            URL,
            json=_payload(),
            headers={"X-Device-Id": DEVICE, "X-Device-Api-Key": KEY},
            timeout=5,
        )
        print(
            datetime.now(timezone.utc).isoformat(),
            r.status_code,
            r.headers.get("X-Telemetry-Id", ""),
        )
        time.sleep(15)


if __name__ == "__main__":
    main()
