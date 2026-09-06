#!/usr/bin/env bash
# db-test.sh — reset the local database and run every SQL suite.
# Exit code is non-zero if any suite prints a FAIL line.

set -uo pipefail
cd "$(dirname "$0")/.."

DB="${1:-hospet_test}"
./scripts/db-reset.sh "$DB" || exit 1

fail=0
run_sql() {
  local out
  out=$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1) || { echo "$out"; echo "ERROR  $1 aborted"; fail=1; return; }
  echo "$out" | grep -E "PASS|FAIL|WARNING|ERROR"
  if echo "$out" | grep -qE "FAIL|ERROR"; then fail=1; fi
}

echo "== lifecycle_test.sql";  run_sql supabase/tests/lifecycle_test.sql
echo "== rls_test.sql";        run_sql supabase/tests/rls_test.sql
echo "== oversell_test.sh";    ./supabase/tests/oversell_test.sh "$DB" 10 || fail=1

if [[ "$fail" == 0 ]]; then echo "ALL SQL SUITES PASS"; else echo "SQL SUITES FAILED"; fi
exit "$fail"
