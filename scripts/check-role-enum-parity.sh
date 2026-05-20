#!/usr/bin/env bash
# AUTH-02 — fail CI if frontend ALL_ROLES drifts from the DB enum literal.
# Greps the TS source-of-truth and the Postgres enum definition for the four
# role tokens, sorts each, and compares.
set -euo pipefail

ts_roles=$(grep -oE '"(FARMER|RESTAURANT|CITIZEN|ADMIN)"' \
    frontend/src/lib/auth/roles.ts \
  | tr -d '"' | sort -u | paste -sd, -)

sql_roles=$(grep -oE "'(FARMER|RESTAURANT|CITIZEN|ADMIN)'" \
    db/migrations/0001_extensions_and_enums.sql \
  | tr -d "'" | sort -u | paste -sd, -)

if [ "$ts_roles" != "$sql_roles" ]; then
    echo "AUTH-02 parity FAILED:" >&2
    echo "  TS roles:  $ts_roles" >&2
    echo "  SQL roles: $sql_roles" >&2
    exit 1
fi
echo "AUTH-02 parity OK ($ts_roles)"
