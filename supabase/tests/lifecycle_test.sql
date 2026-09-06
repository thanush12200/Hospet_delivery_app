-- lifecycle_test.sql — correctness tests 2-5 from the plan.
-- Run against a freshly seeded hospet_test. Any FAIL line means a real defect.

\set QUIET on
\pset format unaligned
\pset tuples_only on

\set CUST  '''44444444-0000-0000-0000-000000000001'''
\set ADDR  '''55555555-0000-0000-0000-000000000001'''
\set RICE  '''22222222-0000-0000-0000-000000000001'''
\set DAL   '''22222222-0000-0000-0000-000000000002'''
\set RIDER '''66666666-0000-0000-0000-000000000001'''

create or replace function assert_eq(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is not distinct from want then
    raise notice 'PASS  %  (= %)', label, want;
  else
    raise warning 'FAIL  %  got=%  want=%', label, got, want;
  end if;
end $$;

-- ============================================================ TEST 2
-- Price tamper: client sends a total that does not match the server's.
do $$
declare r jsonb;
begin
  r := place_order(
        '44444444-0000-0000-0000-000000000001',
        '55555555-0000-0000-0000-000000000001',
        '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
        'COD', 100);   -- real total is 35000 + 2000 fee
  perform assert_eq('T2 price tamper rejected', r->>'error', 'PRICE_MISMATCH');
  perform assert_eq('T2 no order created', (select count(*) from orders)::int, 0);
end $$;

-- ============================================================ TEST 2b
-- Below-minimum-order rejection (min is 10000, tea is 14000 so use nothing cheap;
-- instead prove the happy path computes fee correctly).
do $$
declare r jsonb; v_order uuid;
begin
  r := place_order(
        '44444444-0000-0000-0000-000000000001',
        '55555555-0000-0000-0000-000000000001',
        '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1},
          {"product_id":"22222222-0000-0000-0000-000000000002","qty":2}]'::jsonb,
        'COD');
  perform assert_eq('T2b order placed', r->>'ok', 'true');
  -- 35000 + (16500*2) = 68000 subtotal, + 2000 fee = 70000
  perform assert_eq('T2b server total', (r->>'total_paise')::int, 70000);
  perform assert_eq('T2b rice reserved',
    (select reserved from inventory where product_id = '22222222-0000-0000-0000-000000000001'), 1);
  perform assert_eq('T2b dal reserved',
    (select reserved from inventory where product_id = '22222222-0000-0000-0000-000000000002'), 2);
  perform assert_eq('T2b on_hand untouched (reserve only)',
    (select on_hand from inventory where product_id = '22222222-0000-0000-0000-000000000001'), 10);
end $$;

-- ============================================================ TEST 3
-- Illegal transition must be refused; legal ones must work in order.
do $$
declare v_order uuid; r jsonb;
begin
  select id into v_order from orders order by placed_at desc limit 1;

  r := transition_order(v_order, 'DELIVERED', 'ADMIN');
  perform assert_eq('T3 PLACED->DELIVERED refused', r->>'error', 'ILLEGAL_TRANSITION');

  perform assert_eq('T3 status unchanged after refusal',
    (select status::text from orders where id = v_order), 'PLACED');

  r := transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform assert_eq('T3 ->CONFIRMED', r->>'ok', 'true');
  r := transition_order(v_order, 'PICKING', 'ADMIN');
  perform assert_eq('T3 ->PICKING', r->>'ok', 'true');
  r := transition_order(v_order, 'PACKED', 'ADMIN');
  perform assert_eq('T3 ->PACKED', r->>'ok', 'true');

  -- After PACKED the reservation is released and on_hand has dropped.
  perform assert_eq('T3 rice reserved released',
    (select reserved from inventory where product_id = '22222222-0000-0000-0000-000000000001'), 0);
  perform assert_eq('T3 rice on_hand decremented',
    (select on_hand  from inventory where product_id = '22222222-0000-0000-0000-000000000001'), 9);
  perform assert_eq('T3 dal on_hand decremented',
    (select on_hand  from inventory where product_id = '22222222-0000-0000-0000-000000000002'), 8);

  r := transition_order(v_order, 'OUT_FOR_DELIVERY', 'ADMIN', null, null, null,
                        '66666666-0000-0000-0000-000000000001');
  perform assert_eq('T3 ->OUT_FOR_DELIVERY', r->>'ok', 'true');

  r := transition_order(v_order, 'DELIVERED', 'RIDER',
                        '66666666-0000-0000-0000-000000000001', null, null,
                        '66666666-0000-0000-0000-000000000001');
  perform assert_eq('T3 ->DELIVERED', r->>'ok', 'true');

  -- Full audit trail: PLACED, CONFIRMED, PICKING, PACKED, OUT, DELIVERED = 6
  perform assert_eq('T3 six events recorded',
    (select count(*) from order_events where order_id = v_order)::int, 6);

  -- Terminal.
  r := transition_order(v_order, 'CANCELLED', 'ADMIN');
  perform assert_eq('T3 DELIVERED is terminal', r->>'error', 'ILLEGAL_TRANSITION');
end $$;

-- ============================================================ TEST 5
-- COD reconciliation: cash expected must equal the delivered total.
do $$
declare r jsonb;
begin
  perform assert_eq('T5 cash expected matches order total',
    (select cash_expected_paise from rider_settlements
      where rider_id = '66666666-0000-0000-0000-000000000001'
        and settlement_date = current_date), 70000);

  perform assert_eq('T5 payment marked PAID',
    (select status::text from payments order by created_at desc limit 1), 'PAID');

  -- Rider deposits ₹100 short.
  r := settle_rider_cash('66666666-0000-0000-0000-000000000001', current_date, 60000, 'short');
  perform assert_eq('T5 shortfall surfaced', (r->>'difference_paise')::int, -10000);
  perform assert_eq('T5 marked SHORT',
    (select status::text from rider_settlements
      where rider_id = '66666666-0000-0000-0000-000000000001'
        and settlement_date = current_date), 'SHORT');
end $$;

-- ============================================================ TEST 4
-- Cancel before pick releases the reservation and leaves on_hand alone.
do $$
declare r jsonb; v_order uuid; v_hand_before int;
begin
  select on_hand into v_hand_before from inventory
   where product_id = '22222222-0000-0000-0000-000000000001';

  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":3}]'::jsonb,
                   'COD');
  v_order := (r->>'order_id')::uuid;
  perform assert_eq('T4 reserved while PLACED',
    (select reserved from inventory where product_id = '22222222-0000-0000-0000-000000000001'), 3);

  r := transition_order(v_order, 'CANCELLED', 'CUSTOMER');
  perform assert_eq('T4 cancel ok', r->>'ok', 'true');
  perform assert_eq('T4 reservation released',
    (select reserved from inventory where product_id = '22222222-0000-0000-0000-000000000001'), 0);
  perform assert_eq('T4 on_hand untouched by cancel',
    (select on_hand from inventory where product_id = '22222222-0000-0000-0000-000000000001'),
    v_hand_before);
end $$;

-- ============================================================ TEST 4b
-- Cancel AFTER packing must put the goods back on the shelf.
do $$
declare r jsonb; v_order uuid; v_hand_before int;
begin
  select on_hand into v_hand_before from inventory
   where product_id = '22222222-0000-0000-0000-000000000002';

  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb,
                   'COD');
  v_order := (r->>'order_id')::uuid;
  perform transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_order, 'PICKING',   'ADMIN');
  perform transition_order(v_order, 'PACKED',    'ADMIN');

  perform assert_eq('T4b on_hand dropped at PACKED',
    (select on_hand from inventory where product_id = '22222222-0000-0000-0000-000000000002'),
    v_hand_before - 1);

  perform transition_order(v_order, 'CANCELLED', 'ADMIN');
  perform assert_eq('T4b restocked on cancel-after-pack',
    (select on_hand from inventory where product_id = '22222222-0000-0000-0000-000000000002'),
    v_hand_before);
end $$;

-- ============================================================ TEST 3b
-- Short pick: customer is charged only for what was actually sent.
do $$
declare r jsonb; v_order uuid;
begin
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":4}]'::jsonb,
                   'COD');
  v_order := (r->>'order_id')::uuid;
  perform assert_eq('T3b total before short pick', (r->>'total_paise')::int, 4*16500 + 2000);

  perform transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_order, 'PICKING',   'ADMIN');
  r := transition_order(v_order, 'PACKED', 'ADMIN', null, null,
        '[{"product_id":"22222222-0000-0000-0000-000000000002","fulfilled_qty":2}]'::jsonb);

  perform assert_eq('T3b total recomputed after short pick',
    (select total_paise from orders where id = v_order), 2*16500 + 2000);
  perform assert_eq('T3b payment amount follows',
    (select amount_paise from payments where order_id = v_order), 2*16500 + 2000);
end $$;

-- ============================================================ TEST 1c
-- Direct status UPDATE must be impossible outside transition_order().
do $$
declare v_order uuid; r jsonb;
begin
  -- Place a fresh order so we are guaranteed a genuine status CHANGE to attempt.
  -- (A no-op update, e.g. DELIVERED -> DELIVERED, is legitimately allowed by the
  --  guard, since nothing actually moves.)
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                   'COD');
  v_order := (r->>'order_id')::uuid;

  begin
    update orders set status = 'DELIVERED' where id = v_order;   -- PLACED -> DELIVERED
    raise warning 'FAIL  T1c direct status UPDATE was allowed';
  exception when others then
    raise notice 'PASS  T1c direct status UPDATE blocked';
  end;

  perform assert_eq('T1c status survived the attempt',
    (select status::text from orders where id = v_order), 'PLACED');

  -- A no-op update on the same row must NOT be blocked.
  begin
    update orders set note = 'touched' where id = v_order;
    raise notice 'PASS  T1c non-status update still permitted';
  exception when others then
    raise warning 'FAIL  T1c non-status update was wrongly blocked';
  end;
end $$;

-- ============================================================ TEST 1d
-- order_events is append-only.
do $$
begin
  begin
    update order_events set note = 'tampered' where id = (select min(id) from order_events);
    raise warning 'FAIL  T1d order_events was mutable';
  exception when others then
    raise notice 'PASS  T1d order_events append-only enforced';
  end;
end $$;
