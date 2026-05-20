"""Backend configuration.

Loaded from environment variables; in dev, ``backend/.env`` is auto-loaded.
Anything with the ``NEXT`` + ``_PUBLIC_`` (frontend-bundle) prefix belongs to
INF-03 and MUST NOT be read here (AUTH-05 isolation).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- runtime --------------------------------------------------------------
    environment: Literal["dev", "ci", "prod"] = "dev"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    service_name: str = "backend"
    git_sha: str = Field(default="unknown", alias="GIT_SHA")

    # --- Supabase (service-role, backend-only — AUTH-05) ----------------------
    supabase_url: AnyHttpUrl
    supabase_service_role_key: SecretStr
    supabase_jwt_secret: SecretStr
    supabase_jwt_audience: str = "authenticated"
    supabase_jwt_algorithm: Literal["HS256"] = "HS256"

    # AUTH-04 — anon key is published / safe to bundle. The backend needs it so
    # `user_scoped_client(token)` can mint a PostgREST request with the user's
    # JWT in `Authorization` AND the anon key in `apikey` (Supabase rejects
    # PostgREST requests that lack an apikey header). NOT a SecretStr — this
    # value is identical to the value the frontend ships in its bundle.
    supabase_anon_key: str = ""

    # --- HTTP -----------------------------------------------------------------
    # Accept a comma-separated string from env (Docker-friendly) or a real list.
    # `NoDecode` stops pydantic-settings from trying to JSON-parse the env value
    # before our validator runs — the validator owns the parsing.
    cors_allow_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://vitachain.ma"]
    )
    readyz_timeout_s: float = 2.0

    # --- observability (INF-08) ----------------------------------------------
    # All optional so dev still boots without Sentry env vars. The SDK is also
    # no-op'd in dev/ci by init_observability(); the DSN being unset is a
    # secondary guard.
    sentry_dsn: SecretStr | None = None
    sentry_environment: str = "prod"
    sentry_traces_sample_rate: float = 0.1

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def _split_csv(cls, v):
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
