#!/usr/bin/env bash
# AUTH-04 — assert every public.* table has RLS enabled.
#
# Connects via $DB_URL (the convention used by db/scripts/*.sh and the db
# Makefile) or $SUPABASE_DB_URL — whichever is set. Both forms expect a
# direct :5432 service-role connection string.
#
# Exit codes:
#   0 — every public.* table has row level security enabled
#   0 — connection string is unset (local dev — CI/pre-commit catches it elsewhere)
#   1 — one or more public.* tables are missing RLS
#   2 — psql command failed (connection / permissions)
set -euo pipefail

DB="${DB_URL:-${SUPABASE_DB_URL:-}}"

if [[ -z "$DB" ]]; then
    echo "AUTH-04 SKIP: neither DB_URL nor SUPABASE_DB_URL is set (local dev — CI will catch it)"
    exit 0
fi

OFFENDERS=$(psql "$DB" -At -v ON_ERROR_STOP=1 -c "
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
     order by c.relname;
") || { echo "AUTH-04 ERROR: psql failed against \$DB_URL" >&2; exit 2; }

if [[ -z "$OFFENDERS" ]]; then
    echo "AUTH-04 OK: every public.* table has RLS enabled"
    exit 0
fi

echo "AUTH-04 FAIL: the following public.* tables do NOT have row level security enabled:" >&2
echo "$OFFENDERS" | sed 's/^/  - /' >&2
echo "" >&2
echo "Add 'alter table public.<name> enable row level security;' in the migration" >&2
echo "that creates the table. See docs/runbook.md §AUTH-04 RLS contract." >&2
exit 1
