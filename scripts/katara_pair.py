#!/usr/bin/env python3
"""katara_pair.py — pair or re-key every device in devices.json automatically.

Eliminates the manual "copy key from UI" step that KAT-02 requires.
Run once before the simulator, or whenever a key is lost or stale.
Rewrites devices.json in-place with the fresh plaintext key(s).

Prerequisite — each device entry in devices.json must have a "parcel_id":
    "parcel_id": "<uuid visible in the parcel-page URL>"

Usage:
    VITACHAIN_TOKEN=eyJ... python scripts/katara_pair.py
    python scripts/katara_pair.py --config devices.json --token eyJ...

Getting your JWT (~1 h TTL):
    Browser DevTools → Application → Local Storage
    → supabase.auth.token → access_token
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("ERR: pip install requests")


def _hdrs(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _pair_or_rotate(base: str, token: str, parcel_id: str, device_id: str) -> str:
    """Pair the device if new, rotate its key if already paired.

    Returns the plaintext api_key to store in devices.json.
    """
    pair_url = f"{base}/api/v1/katara/parcels/{parcel_id}/devices"

    r = requests.post(
        pair_url,
        json={"device_id": device_id},
        headers=_hdrs(token),
        timeout=10,
    )

    if r.status_code == 201:
        key: str = r.json()["api_key"]
        print(f"  [{device_id}] paired — key …{key[-4:]}")
        return key

    if r.status_code == 409:
        # Already paired — list devices on this parcel to find the row UUID,
        # then call rotate-key so we get a fresh plaintext back.
        list_r = requests.get(pair_url, headers=_hdrs(token), timeout=10)
        list_r.raise_for_status()
        rows: list[dict] = list_r.json()
        row = next((d for d in rows if d["device_id"] == device_id), None)
        if row is None:
            sys.exit(
                f"ERR [{device_id}]: server returned 409 but the device is not "
                f"listed under parcel {parcel_id}.\n"
                "Check that parcel_id in devices.json matches the parcel this "
                "device was paired to."
            )
        old_last4: str = row["api_key_last4"]
        rotate_url = f"{pair_url}/{row['id']}/rotate-key"
        rot = requests.post(rotate_url, headers=_hdrs(token), timeout=10)
        rot.raise_for_status()
        key = rot.json()["api_key"]
        print(f"  [{device_id}] key rotated (was …{old_last4}, now …{key[-4:]})")
        return key

    # Any other status is unexpected — surface the full body for debugging.
    sys.exit(
        f"ERR [{device_id}]: POST {pair_url} → {r.status_code}\n{r.text[:400]}"
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawTextHelpFormatter,
    )
    p.add_argument("--config", default="devices.json", help="path to devices.json")
    p.add_argument(
        "--token",
        default=os.environ.get("VITACHAIN_TOKEN", ""),
        help="farmer JWT (or set VITACHAIN_TOKEN env var)",
    )
    args = p.parse_args()

    if not args.token:
        sys.exit(
            "ERR: no JWT found.\n"
            "Pass --token eyJ... or set the VITACHAIN_TOKEN environment variable.\n\n"
            "How to get your token:\n"
            "  Browser DevTools → Application → Local Storage\n"
            "  → supabase.auth.token → access_token"
        )

    cfg_path = Path(args.config)
    if not cfg_path.exists():
        sys.exit(f"ERR: {cfg_path} not found — run --init-config on the simulator first")

    cfg: dict = json.loads(cfg_path.read_text())
    base: str = cfg.get("base_url", "http://localhost:8000").rstrip("/")

    updated = 0
    skipped = 0
    for dev in cfg["devices"]:
        device_id: str = dev["device_id"]
        parcel_id: str = dev.get("parcel_id", "")

        if not parcel_id or parcel_id == "REMPLACE_MOI":
            print(
                f"[{device_id}] SKIP — add a real \"parcel_id\" UUID "
                f"to this entry in {cfg_path.name}"
            )
            skipped += 1
            continue

        print(f"[{device_id}] syncing (parcel {parcel_id[:8]}…)")
        dev["api_key"] = _pair_or_rotate(base, args.token, parcel_id, device_id)
        updated += 1

    if updated:
        cfg_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
        print(f"\n{cfg_path} updated ({updated} key(s) written).")
        print("Run the simulator now:")
        print(f"  python scripts/katara_simulator.py --config {cfg_path}")
    else:
        if skipped:
            print(f"\nNothing updated — fill in the parcel_id field(s) first.")
        else:
            print("\nNothing to do.")


if __name__ == "__main__":
    main()
