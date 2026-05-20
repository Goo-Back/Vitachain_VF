"""KAT-03 — Locust performance gate for /api/v1/katara/ingest.

Pass criteria (run for 60 s with 50 concurrent users, see §5.8 of the story):

  * median  <  50 ms
  * 99%     < 150 ms
  * 0 failures

Run:

  LOAD_TARGET=https://staging.vitachain.ma \
  DEVICE_ID=ESP-KAT-001 \
  DEVICE_API_KEY=vk_<paired-from-kat02> \
  locust -f load/kat03_ingest.py --headless -u 50 -r 10 -t 60s --csv=ingest

The exporter file `ingest_stats.csv` is the artefact the story DoD requires
when flipping KAT-03 from IN_REVIEW to DONE.
"""

from __future__ import annotations

import os
import random
from datetime import datetime, timezone

from locust import HttpUser, between, task


class IngestUser(HttpUser):
    # ~5-20 ingests per "user" per second is realistic background pressure
    # while we measure the SLA; the wait keeps the request rate from
    # collapsing to a synchronous loop.
    wait_time = between(0.05, 0.2)

    host = os.environ.get("LOAD_TARGET", "http://localhost:8000")

    @task
    def ingest(self) -> None:
        self.client.post(
            "/api/v1/katara/ingest",
            json={
                "soil_moisture":     round(random.uniform(28, 42), 1),
                "soil_temperature":  round(random.uniform(18, 24), 1),
                "soil_pH":           round(random.uniform(6.2, 7.4), 2),
                "soil_conductivity": round(random.uniform(1200, 2200), 0),
                "battery_level":     random.randint(70, 100),
                "recorded_at":       datetime.now(timezone.utc).isoformat(),
            },
            headers={
                "X-Device-Id":      os.environ["DEVICE_ID"],
                "X-Device-Api-Key": os.environ["DEVICE_API_KEY"],
            },
            name="POST /katara/ingest",
        )
