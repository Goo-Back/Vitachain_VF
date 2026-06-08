"""Apply SecondServe SQL migrations against the shared Supabase Postgres.

Reads DATABASE_URL from the VitaChain backend/.env (service-role DIRECT/session
pooler). Applies every secondserve/db/migrations/*.sql in numeric order, each
file in its own transaction. Idempotent files = safe to re-run.

Usage:  python secondserve/db/apply.py
"""
import asyncio
import glob
import os
import re
import sys

import asyncpg

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS_DIR = os.path.join(HERE, "migrations")


def load_database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env_path = os.path.join(HERE, "..", "..", "backend", ".env")
    with open(env_path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip()
    raise SystemExit("DATABASE_URL not found in env or backend/.env")


async def main() -> None:
    dsn = load_database_url()
    files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    if not files:
        raise SystemExit(f"no .sql files in {MIGRATIONS_DIR}")

    conn = await asyncpg.connect(dsn=dsn)
    try:
        for path in files:
            name = os.path.basename(path)
            with open(path, "r", encoding="utf-8") as fh:
                sql = fh.read()
            print(f">> applying {name} ...", flush=True)
            async with conn.transaction():
                await conn.execute(sql)
            print(f"  OK {name}", flush=True)
    finally:
        await conn.close()
    print("All migrations applied.")


if __name__ == "__main__":
    asyncio.run(main())
