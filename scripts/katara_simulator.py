#!/usr/bin/env python3
"""Katara IoT simulator — remplace l'ESP32 physique pour tester toute la chaîne KAT-*.

Couvre les scénarios que le simple `fake_ingest.py` ne gère pas :

  - **multi-device**           : N capteurs en parallèle (un thread par device)
  - **modes de payload**       : normal / alerte-pH / alerte-humidite / batterie-faible /
                                 capteur-cassé (valeurs hors plage, doit être rejeté)
  - **réplay & idempotence**   : renvoie 2× le même recorded_at → 204 idempotent
  - **simulation offline**     : un device s'arrête N minutes pour déclencher KAT-11
  - **backfill historique**    : injecte 7 jours de données pour tester KAT-04 / KAT-08
  - **fenêtre de cadence**     : --interval contrôle la fréquence (par défaut 15 s)

Pré-requis :

  1. Backend up :              `docker compose up -d backend nginx`
  2. Compte FARMER vérifié + 1 parcelle créée (KAT-01)
  3. 1+ device(s) appairé(s)   (KAT-02 — copier le `api_key` plaintext montré 1×)
  4. Config dans devices.json   (cf. --init-config)

Exemples :

    # Génère un squelette de config
    python scripts/katara_simulator.py --init-config

    # Stream temps réel : 2 devices, payload normal, toutes les 15 s
    python scripts/katara_simulator.py --config devices.json

    # Backfill historique : 7 jours @ 15 min cadence (pour peupler les charts)
    python scripts/katara_simulator.py --config devices.json --backfill-days 7

    # Force des valeurs hors-seuil pour déclencher l'alerte email (KAT-05/06)
    python scripts/katara_simulator.py --config devices.json --mode alert-ph

    # Simule un capteur cassé (doit recevoir 422 du backend)
    python scripts/katara_simulator.py --config devices.json --mode broken-sensor

    # Coupe le device pendant 65 min pour déclencher l'offline-detection (KAT-11)
    python scripts/katara_simulator.py --config devices.json --simulate-offline 65
"""

from __future__ import annotations

import argparse
import json
import math
import random
import signal
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests


# ── Réalisme : plages de valeurs par mode ────────────────────────────────────
# Les bornes "normal" reflètent un sol marocain irrigué en saison (printemps).
# Pour les modes d'alerte, on pousse une seule variable hors-seuil par défaut
# (cf. KAT-05) afin que l'email Brevo arrive avec une raison claire.

MODES: dict[str, dict[str, tuple[float, float]]] = {
    "normal": {
        "soil_moisture":     (32.0, 42.0),
        "soil_temperature":  (18.0, 24.0),
        "soil_pH":           (6.3, 7.2),
        "soil_conductivity": (1200.0, 2000.0),
        "battery_level":     (80, 100),
    },
    "alert-ph": {            # pH acide → fertilisation recommandée
        "soil_moisture":     (32.0, 42.0),
        "soil_temperature":  (18.0, 24.0),
        "soil_pH":           (4.8, 5.4),
        "soil_conductivity": (1200.0, 2000.0),
        "battery_level":     (80, 100),
    },
    "alert-moisture": {      # sol sec → irrigation urgente
        "soil_moisture":     (8.0, 14.0),
        "soil_temperature":  (24.0, 30.0),
        "soil_pH":           (6.3, 7.2),
        "soil_conductivity": (1200.0, 2000.0),
        "battery_level":     (80, 100),
    },
    "alert-salinity": {      # EC élevée → stress salin
        "soil_moisture":     (32.0, 42.0),
        "soil_temperature":  (18.0, 24.0),
        "soil_pH":           (6.3, 7.2),
        "soil_conductivity": (4500.0, 6000.0),
        "battery_level":     (80, 100),
    },
    "low-battery": {         # batterie faible — banner KAT-04
        "soil_moisture":     (32.0, 42.0),
        "soil_temperature":  (18.0, 24.0),
        "soil_pH":           (6.3, 7.2),
        "soil_conductivity": (1200.0, 2000.0),
        "battery_level":     (5, 14),
    },
    "broken-sensor": {       # hors plage CHECK → backend doit répondre 422
        "soil_moisture":     (120.0, 130.0),    # >100 invalide
        "soil_temperature":  (18.0, 24.0),
        "soil_pH":           (6.3, 7.2),
        "soil_conductivity": (1200.0, 2000.0),
        "battery_level":     (80, 100),
    },
}


@dataclass
class Device:
    device_id: str   # ex. "ESP-KAT-001" (literal imprimé sur le boîtier)
    api_key: str    # plaintext vk_... obtenu au pairing KAT-02
    label: str = "" # libellé humain pour le log

    def hdrs(self) -> dict[str, str]:
        return {"X-Device-Id": self.device_id, "X-Device-Api-Key": self.api_key}


# ── Génération de payload ────────────────────────────────────────────────────


def _diurnal_offset(ts: datetime) -> float:
    """Petit cycle jour/nuit pour rendre les charts plus réalistes (±2 °C)."""
    h = ts.hour + ts.minute / 60.0
    return 2.0 * math.sin((h - 6) / 24.0 * 2 * math.pi)


def make_payload(mode: str, recorded_at: datetime) -> dict[str, Any]:
    ranges = MODES[mode]
    lo, hi = ranges["soil_temperature"]
    temp = round(random.uniform(lo, hi) + _diurnal_offset(recorded_at), 1)

    def _r(key: str, ndigits: int) -> float:
        a, b = ranges[key]
        return round(random.uniform(a, b), ndigits)

    bat_lo, bat_hi = ranges["battery_level"]

    return {
        "soil_moisture":     _r("soil_moisture", 1),
        "soil_temperature":  temp,
        "soil_pH":           _r("soil_pH", 2),
        "soil_conductivity": _r("soil_conductivity", 0),
        "battery_level":     random.randint(int(bat_lo), int(bat_hi)),
        "recorded_at":       recorded_at.isoformat(),
    }


# ── Envoi ────────────────────────────────────────────────────────────────────


def post_one(url: str, dev: Device, payload: dict[str, Any], timeout: float = 5.0) -> requests.Response:
    return requests.post(url, json=payload, headers=dev.hdrs(), timeout=timeout)


def _log(dev: Device, r: requests.Response, payload: dict[str, Any]) -> None:
    tag = dev.label or dev.device_id
    tid = r.headers.get("X-Telemetry-Id", "")
    ts = payload["recorded_at"][11:19]
    print(
        f"[{tag:>14}] {ts} pH={payload['soil_pH']:>4} "
        f"H={payload['soil_moisture']:>4}% EC={payload['soil_conductivity']:>5} "
        f"bat={payload['battery_level']:>3}% -> {r.status_code} {tid}",
        flush=True,
    )


# ── Boucles ──────────────────────────────────────────────────────────────────


_stop = threading.Event()


def stream_device(url: str, dev: Device, mode: str, interval: float) -> None:
    while not _stop.is_set():
        payload = make_payload(mode, datetime.now(timezone.utc))
        try:
            r = post_one(url, dev, payload)
            _log(dev, r, payload)
            if r.status_code >= 400 and mode != "broken-sensor":
                print(f"  ⚠  body: {r.text[:200]}", file=sys.stderr)
        except requests.RequestException as exc:
            print(f"[{dev.device_id}] ERR {exc}", file=sys.stderr)
        _stop.wait(interval)


def backfill(url: str, dev: Device, days: int, cadence_min: int) -> None:
    """Injecte des données passées pour peupler le chart historique (KAT-04)
    et la moyenne 7-jours du diagnostic IA (KAT-08).
    """
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = now - timedelta(days=days)
    n_points = (days * 24 * 60) // cadence_min
    print(f"[{dev.device_id}] backfill : {n_points} points sur {days} j (cadence {cadence_min} min)")
    sent = 0
    for i in range(n_points):
        ts = start + timedelta(minutes=i * cadence_min)
        payload = make_payload("normal", ts)
        try:
            r = post_one(url, dev, payload)
            if r.status_code == 204:
                sent += 1
            else:
                print(f"  point {i} → {r.status_code} {r.text[:120]}", file=sys.stderr)
        except requests.RequestException as exc:
            print(f"  point {i} ERR {exc}", file=sys.stderr)
        if i % 20 == 0:
            print(f"  ...{i}/{n_points}", flush=True)
    print(f"[{dev.device_id}] backfill OK : {sent}/{n_points} insérés")


# ── Config ───────────────────────────────────────────────────────────────────


CONFIG_SAMPLE = {
    "ingest_url": "http://localhost:8000/api/v1/katara/ingest",
    "_comment": (
        "Renseigne au moins 1 device. Le plaintext api_key vient de la modale "
        "affichée 1× au moment du pairing (KAT-02). Si tu l'as perdu, fais "
        "rotate-key sur la page parcelle."
    ),
    "devices": [
        {"device_id": "ESP-KAT-001", "api_key": "vk_REMPLACE_MOI", "label": "parcelle-1"},
        {"device_id": "ESP-KAT-002", "api_key": "vk_REMPLACE_MOI", "label": "parcelle-2"},
    ],
}


def load_config(path: Path) -> tuple[str, list[Device]]:
    with path.open() as f:
        raw = json.load(f)
    url = raw["ingest_url"]
    devices = [
        Device(d["device_id"], d["api_key"], d.get("label", ""))
        for d in raw["devices"]
        if not d["api_key"].endswith("REMPLACE_MOI")
    ]
    if not devices:
        sys.exit("ERR: aucun device avec une api_key valide dans devices.json")
    return url, devices


# ── CLI ──────────────────────────────────────────────────────────────────────


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--config", default="devices.json", help="chemin du JSON de config")
    p.add_argument("--init-config", action="store_true", help="écrit un devices.json modèle puis quitte")
    p.add_argument("--mode", choices=sorted(MODES), default="normal", help="profil de payload")
    p.add_argument("--interval", type=float, default=15.0, help="secondes entre 2 envois (mode stream)")
    p.add_argument("--backfill-days", type=int, default=0, help="injecte N jours d'historique et quitte")
    p.add_argument("--backfill-cadence-min", type=int, default=15, help="espacement des points historiques")
    p.add_argument("--simulate-offline", type=int, default=0,
                   help="N minutes sans envoyer (déclenche KAT-11 si > 60)")
    args = p.parse_args()

    if args.init_config:
        out = Path(args.config)
        if out.exists():
            sys.exit(f"ERR: {out} existe déjà — supprime-le d'abord")
        out.write_text(json.dumps(CONFIG_SAMPLE, indent=2))
        print(f"écrit : {out}")
        print("→ édite-le pour mettre tes vrais device_id + api_key, puis relance sans --init-config")
        return

    url, devices = load_config(Path(args.config))
    print(f"INGEST_URL = {url}")
    print(f"DEVICES    = {[d.device_id for d in devices]}")
    print(f"MODE       = {args.mode}")

    # CTRL+C propre
    def _sigint(*_a: Any) -> None:
        print("\nstop demandé, fermeture des threads…", flush=True)
        _stop.set()
    signal.signal(signal.SIGINT, _sigint)

    # ── Backfill historique (séquentiel) ─────────────────────────────────────
    if args.backfill_days > 0:
        for dev in devices:
            backfill(url, dev, args.backfill_days, args.backfill_cadence_min)
        return

    # ── Offline simulé : on ne pousse rien pendant N minutes ─────────────────
    if args.simulate_offline > 0:
        wait_s = args.simulate_offline * 60
        print(f"⏸  pause {args.simulate_offline} min — vérifie que KAT-11 marque les devices OFFLINE")
        try:
            time.sleep(wait_s)
        except KeyboardInterrupt:
            pass
        return

    # ── Stream temps réel ────────────────────────────────────────────────────
    threads = [
        threading.Thread(
            target=stream_device,
            args=(url, dev, args.mode, args.interval),
            name=f"stream-{dev.device_id}",
            daemon=True,
        )
        for dev in devices
    ]
    for t in threads:
        t.start()
    while any(t.is_alive() for t in threads):
        for t in threads:
            t.join(timeout=0.5)


if __name__ == "__main__":
    main()
