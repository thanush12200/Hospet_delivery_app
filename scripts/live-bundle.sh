#!/usr/bin/env bash
# live-bundle.sh — concatenate migrations into one paste for the Supabase SQL editor.
#   scripts/live-bundle.sh 0011 0020   # writes supabase/live/apply-0011-0020.sql
# Every migration is written to be rerunnable, so a bundle can be pasted twice.
set -euo pipefail
from="${1:?from}"; to="${2:?to}"
out="supabase/live/apply-${from}-${to}.sql"
[ "$from" = "$to" ] && out="supabase/live/apply-${from}.sql"
{
  echo "-- FAA: migrations ${from}-${to} in one paste for the Supabase SQL editor."
  echo "-- Safe to run more than once. Generated from supabase/migrations/ by scripts/live-bundle.sh."
  for f in supabase/migrations/*.sql; do
    n="$(basename "$f" | cut -c1-4)"
    [[ "$n" < "$from" || "$n" > "$to" ]] && continue
    echo; echo "-- ======================= $f ======================="
    cat "$f"
  done
} > "$out"
echo "wrote $out ($(wc -l < "$out") lines)"
