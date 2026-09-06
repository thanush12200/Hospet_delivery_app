#!/usr/bin/env bash
# db-reset.sh — rebuild the local test database from scratch.
#
# Applies the auth shim, then EVERY migration in supabase/migrations in
# numeric order, then the seed, then the anon/authenticated grants that
# Supabase applies automatically. Earlier versions of this script stopped at
# 0003, which meant 0004-0010 were never exercised locally and any new
# migration would have been silently skipped by the test suite.
#
# Usage: ./scripts/db-reset.sh [dbname]     (default hospet_test)
# Needs a role that can create databases; e.g. PGUSER=<superuser>.

set -euo pipefail
cd "$(dirname "$0")/.."

DB="${1:-hospet_test}"
PSQL=(psql -q -v ON_ERROR_STOP=1 -d "$DB")

dropdb --if-exists "$DB"
createdb "$DB"

"${PSQL[@]}" -f supabase/tests/local_auth_shim.sql

for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f"
done

"${PSQL[@]}" -f supabase/seed.sql

# Supabase grants table privileges to anon/authenticated and relies on RLS as
# the real gate. Re-grant after migrations so tables created later are covered.
"${PSQL[@]}" -c "grant usage on schema public to anon, authenticated;
                 grant all on all tables in schema public to anon, authenticated;
                 grant all on all sequences in schema public to anon, authenticated;"

echo "db-reset: $DB rebuilt with $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') migrations"
