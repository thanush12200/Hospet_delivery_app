#!/usr/bin/env bash
# remote-psql.sh — connect to the live Supabase database.
#
# Supabase's direct host (db.<ref>.supabase.co) is IPv6-only. On an IPv4-only
# network it will not resolve at all, so we go through the Supavisor pooler,
# which is dual-stack. Session mode (5432) is required for DDL; transaction
# mode (6543) does not support everything migrations need.
#
# Reads the password from .pgpass_raw (gitignored) and passes it via
# PGPASSWORD, which avoids URL percent-encoding entirely.
#
# Usage: ./scripts/remote-psql.sh -f supabase/migrations/0001_schema.sql
#        ./scripts/remote-psql.sh -c "select count(*) from products;"

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF="troouqapzkufohftxvne"
HOST="aws-0-ap-south-1.pooler.supabase.com"
PORT=5432

if [[ ! -f .pgpass_raw ]]; then
  echo "Missing .pgpass_raw — write your Supabase database password into it." >&2
  exit 1
fi

PGPASSWORD="$(cat .pgpass_raw)" exec psql \
  -h "$HOST" -p "$PORT" -U "postgres.${PROJECT_REF}" -d postgres "$@"
