#!/usr/bin/env bash
# oversell_test.sh — Test 1 from the plan, and the most important test here.
#
# Fires N concurrent place_order() calls for a product with exactly 1 unit in
# stock. Exactly one must succeed; the rest must get a clean OUT_OF_STOCK.
# Any other outcome (2+ successes, or a deadlock/exception) is a real defect.
#
# Usage: ./oversell_test.sh [db] [concurrency]

set -uo pipefail

DB="${1:-hospet_test}"
N="${2:-10}"

# Pass "remote" as the database to run against the live Supabase project
# instead of a local database.
if [[ "$DB" == "remote" ]]; then
  PSQL=(./scripts/remote-psql.sh)
else
  PSQL=(psql -d "$DB")
fi
TEA='22222222-0000-0000-0000-000000000003'   # seeded with on_hand = 1
CUST='44444444-0000-0000-0000-000000000001'
ADDR='55555555-0000-0000-0000-000000000001'

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Derive the expectation from real stock rather than hardcoding it.
read -r STOCK <<<"$("${PSQL[@]}" -q -A -t \
  -c "select on_hand - reserved from inventory where product_id='$TEA';")"
EXPECT_OK=$(( STOCK < N ? STOCK : N ))

echo "Firing $N concurrent orders for a product with available=$STOCK ..."
echo "Expecting exactly $EXPECT_OK to succeed."

for i in $(seq 1 "$N"); do
  "${PSQL[@]}" -q -A -t -c \
    "select place_order('$CUST','$ADDR',
       '[{\"product_id\":\"$TEA\",\"qty\":1}]'::jsonb,'COD');" \
    > "$TMP/r$i.json" 2>"$TMP/e$i.txt" &
done
wait

ok=0; oos=0; other=0; err=0
for i in $(seq 1 "$N"); do
  if [[ -s "$TMP/e$i.txt" ]]; then
    err=$((err+1)); echo "  [$i] ERROR: $(head -1 "$TMP/e$i.txt")"
  elif grep -q '"ok" : true\|"ok": true\|"ok":true' "$TMP/r$i.json"; then
    ok=$((ok+1))
  elif grep -q 'OUT_OF_STOCK' "$TMP/r$i.json"; then
    oos=$((oos+1))
  else
    other=$((other+1)); echo "  [$i] UNEXPECTED: $(head -c 200 "$TMP/r$i.json")"
  fi
done

read -r on_hand reserved <<<"$("${PSQL[@]}" -q -A -t -F' ' \
  -c "select on_hand, reserved from inventory where product_id='$TEA';")"

echo
echo "  succeeded : $ok"
echo "  out_of_stock: $oos"
echo "  unexpected: $other"
echo "  errors    : $err"
echo "  inventory : on_hand=$on_hand reserved=$reserved"
echo

fail=0
[[ "$ok"  == "$EXPECT_OK" ]] || { echo "FAIL  expected $EXPECT_OK successes, got $ok"; fail=1; }
[[ "$oos" == $((N-EXPECT_OK)) ]] || { echo "FAIL  expected $((N-EXPECT_OK)) OUT_OF_STOCK, got $oos"; fail=1; }
[[ "$err" == 0 ]] || { echo "FAIL  $err connections errored (deadlock?)"; fail=1; }
[[ "$other" == 0 ]] || { echo "FAIL  $other unexpected responses"; fail=1; }
# Reservations must exactly equal what was sold. This is the real assertion:
# one unit reserved per successful order, and not a single unit oversold.
[[ "$reserved" == "$EXPECT_OK" ]] || {
  echo "FAIL  reserved should be $EXPECT_OK, got $reserved"; fail=1; }

if [[ "$fail" == 0 ]]; then
  echo "PASS  no oversell under $N-way concurrency (sold exactly $ok of $STOCK)"
fi
exit "$fail"
