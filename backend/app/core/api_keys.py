"""KAT-02 — device API key helpers.

The plaintext key is shown to the farmer exactly once at pairing time. The
backend never persists the plaintext — only a bcrypt hash and the last four
characters (for UI display). KAT-03's < 50 ms ingest endpoint validates via
the SQL function ``public.verify_device_api_key`` which uses ``pgcrypto.crypt``
for constant-time comparison.

Key format: ``vk_`` + 32 hex chars (16 random bytes). 128 bits of entropy is
sufficient for a per-device secret that lives behind the ingest endpoint's
NGINX rate limit (AUTH-08).
"""

from __future__ import annotations

import secrets

import bcrypt

_PREFIX = "vk_"
_HEX_BYTES = 16  # → 32 hex chars
# Cost factor 10 keeps the bcrypt step under ~10 ms on the demo VPS, leaving
# headroom inside the < 50 ms KAT-03 ingest SLA. Do not raise without
# benchmarking the ingest p50 first.
_BCRYPT_COST = 10


def generate_device_api_key() -> str:
    """Return a fresh plaintext device API key (``vk_<32 hex>``)."""
    return _PREFIX + secrets.token_hex(_HEX_BYTES)


def hash_device_api_key(plaintext: str) -> str:
    """Return the bcrypt hash to persist in ``m1_katara_devices.api_key_hash``.

    Python's bcrypt emits ``$2b$`` but pgcrypto.crypt() only recognises ``$2a$``.
    The two variants use identical algorithms — only the prefix differs — so the
    substitution is safe and the stored hash remains verifiable by pgcrypto.
    """
    raw = bcrypt.hashpw(plaintext.encode("utf-8"), bcrypt.gensalt(rounds=_BCRYPT_COST))
    return raw.decode("utf-8").replace("$2b$", "$2a$", 1)


def last4(plaintext: str) -> str:
    """Last four chars — stored in ``api_key_last4`` for the UI."""
    return plaintext[-4:]
