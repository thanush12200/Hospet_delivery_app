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
        and settlement_date = business_date()), 70000);

  perform assert_eq('T5 payment marked PAID',
    (select status::text from payments order by created_at desc limit 1), 'PAID');

  -- Rider deposits ₹100 short.
  r := settle_rider_cash('66666666-0000-0000-0000-000000000001', business_date(), 60000, 'short');
  perform assert_eq('T5 shortfall surfaced', (r->>'difference_paise')::int, -10000);
  perform assert_eq('T5 marked SHORT',
    (select status::text from rider_settlements
      where rider_id = '66666666-0000-0000-0000-000000000001'
        and settlement_date = business_date()), 'SHORT');
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

-- ================================================================
-- Authorisation (0011). These impersonate a signed-in user the same way
-- rls_test.sql does: set the JWT sub claim for this transaction and switch
-- to the authenticated role. Seeded identities:
--   customer A  auth 7777…01   customer B  auth 7777…02
--   rider       auth 7777…11   owner       auth 7777…21
-- ================================================================

create or replace function as_user(p_uid text, p_phone text default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, true);
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', p_uid) || coalesce(jsonb_build_object('phone', p_phone), '{}'))::text, true);
  execute 'set local role authenticated';
end $$;

-- Back to the service context: reset role AND clear the claim, otherwise
-- auth.uid() keeps returning the last impersonated user for the rest of the
-- transaction.
create or replace function as_service() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ============================================================ TEST 6
-- place_order: only the customer themself, or staff, may order for a customer.
do $$
declare r jsonb;
begin
  perform as_user('77777777-0000-0000-0000-000000000002');           -- customer B
  r := place_order('44444444-0000-0000-0000-000000000001',           -- as A
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                   'COD');
  perform as_service();
  perform assert_eq('T6 customer cannot order as another customer', r->>'error', 'NOT_AUTHORIZED');

  perform as_user('77777777-0000-0000-0000-000000000002');
  r := place_order('44444444-0000-0000-0000-000000000002',           -- as themself
                   '55555555-0000-0000-0000-000000000002',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                   'COD');
  perform as_service();
  perform assert_eq('T6 customer orders for themself', r->>'ok', 'true');
  perform assert_eq('T6 customer order audited as CUSTOMER',
    (select actor_type::text from order_events where order_id = (r->>'order_id')::uuid), 'CUSTOMER');

  perform as_user('77777777-0000-0000-0000-000000000021');           -- owner
  r := place_order('44444444-0000-0000-0000-000000000001',           -- WhatsApp order for A
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                   'COD');
  perform as_service();
  perform assert_eq('T6 staff may order for any customer', r->>'ok', 'true');
  perform assert_eq('T6 staff order audited as ADMIN',
    (select actor_type::text from order_events where order_id = (r->>'order_id')::uuid), 'ADMIN');
  perform assert_eq('T6 staff order actor is the admin row',
    (select actor_id from order_events where order_id = (r->>'order_id')::uuid),
    '88888888-0000-0000-0000-000000000001'::uuid);

  -- Clean up so later stock assertions are not disturbed.
  perform transition_order((r->>'order_id')::uuid, 'CANCELLED', 'ADMIN');
end $$;

-- ============================================================ TEST 7
-- transition_order as a rider: only their own assigned order, only pickup
-- and delivery; assignment at PACKED via assign_rider().
do $$
declare r jsonb; v_order uuid; v_events int; v_cash_before int;
begin
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb,
                   'COD');
  v_order := (r->>'order_id')::uuid;
  perform transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_order, 'PICKING',   'ADMIN');
  perform transition_order(v_order, 'PACKED',    'ADMIN');

  perform as_user('77777777-0000-0000-0000-000000000011');           -- rider, unassigned
  r := transition_order(v_order, 'OUT_FOR_DELIVERY', 'RIDER');
  perform as_service();
  perform assert_eq('T7 unassigned rider refused', r->>'error', 'NOT_AUTHORIZED');

  perform as_user('77777777-0000-0000-0000-000000000002');           -- customer B as "ADMIN"
  r := transition_order(v_order, 'OUT_FOR_DELIVERY', 'ADMIN', null, null, null,
                        '66666666-0000-0000-0000-000000000001');
  perform as_service();
  perform assert_eq('T7 customer claiming ADMIN refused', r->>'error', 'NOT_AUTHORIZED');

  perform as_user('77777777-0000-0000-0000-000000000002');           -- customer B as "RIDER"
  r := transition_order(v_order, 'OUT_FOR_DELIVERY', 'RIDER');
  perform as_service();
  perform assert_eq('T7 customer claiming RIDER refused', r->>'error', 'NOT_AUTHORIZED');

  select count(*) into v_events from order_events where order_id = v_order;
  perform as_user('77777777-0000-0000-0000-000000000021');           -- owner assigns
  r := assign_rider(v_order, '66666666-0000-0000-0000-000000000001');
  perform as_service();
  perform assert_eq('T7 assign_rider ok', r->>'ok', 'true');
  perform assert_eq('T7 assign_rider audited',
    (select count(*) from order_events where order_id = v_order)::int, v_events + 1);
  perform assert_eq('T7 order carries the rider',
    (select rider_id from orders where id = v_order), '66666666-0000-0000-0000-000000000001'::uuid);

  perform as_user('77777777-0000-0000-0000-000000000002');           -- customer cannot assign
  r := assign_rider(v_order, '66666666-0000-0000-0000-000000000001');
  perform as_service();
  perform assert_eq('T7 customer cannot assign a rider', r->>'error', 'NOT_AUTHORIZED');

  perform as_user('77777777-0000-0000-0000-000000000011');           -- assigned rider
  r := transition_order(v_order, 'CANCELLED', 'RIDER');
  perform as_service();
  perform assert_eq('T7 rider cannot cancel', r->>'error', 'NOT_AUTHORIZED');

  perform as_user('77777777-0000-0000-0000-000000000011');
  r := transition_order(v_order, 'OUT_FOR_DELIVERY', 'RIDER');              -- Picked up
  perform as_service();
  perform assert_eq('T7 assigned rider picks up', r->>'ok', 'true');

  select coalesce(cash_expected_paise, 0) into v_cash_before from rider_settlements
   where rider_id = '66666666-0000-0000-0000-000000000001' and settlement_date = business_date();

  perform as_user('77777777-0000-0000-0000-000000000011');
  r := transition_order(v_order, 'DELIVERED', 'RIDER',
                        '00000000-0000-0000-0000-000000000000');            -- bogus actor id ignored
  perform as_service();
  perform assert_eq('T7 assigned rider delivers', r->>'ok', 'true');
  perform assert_eq('T7 event actor is the real rider',
    (select actor_id from order_events where order_id = v_order and to_status = 'DELIVERED'),
    '66666666-0000-0000-0000-000000000001'::uuid);
  perform assert_eq('T7 cash booked to the rider',
    (select cash_expected_paise from rider_settlements
      where rider_id = '66666666-0000-0000-0000-000000000001' and settlement_date = business_date()),
    v_cash_before + (select total_paise from orders where id = v_order));
  perform assert_eq('T7 payment collected by the rider',
    (select collected_by_rider_id from payments where order_id = v_order),
    '66666666-0000-0000-0000-000000000001'::uuid);
end $$;

-- ============================================================ TEST 8
-- The office marking a dispatched COD order delivered must book the cash
-- against the order's rider, not crash on a null rider (the old behaviour).
do $$
declare r jsonb; v_order uuid;
begin
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb,
                   'COD');
  v_order := (r->>'order_id')::uuid;
  perform transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_order, 'PICKING',   'ADMIN');
  perform transition_order(v_order, 'PACKED',    'ADMIN');

  r := transition_order(v_order, 'OUT_FOR_DELIVERY', 'ADMIN');
  perform assert_eq('T8 dispatch without a rider refused', r->>'error', 'NO_RIDER');

  r := transition_order(v_order, 'OUT_FOR_DELIVERY', 'ADMIN', null, null, null,
                        '00000000-0000-0000-0000-000000000000');
  perform assert_eq('T8 unknown rider refused', r->>'error', 'INVALID_RIDER');

  perform transition_order(v_order, 'OUT_FOR_DELIVERY', 'ADMIN', null, null, null,
                           '66666666-0000-0000-0000-000000000001');

  perform as_user('77777777-0000-0000-0000-000000000021');           -- owner, no rider param
  r := transition_order(v_order, 'DELIVERED', 'ADMIN');
  perform as_service();
  perform assert_eq('T8 admin delivered with rider on the order', r->>'ok', 'true');
  perform assert_eq('T8 cash collected by the order rider, not the admin',
    (select collected_by_rider_id from payments where order_id = v_order),
    '66666666-0000-0000-0000-000000000001'::uuid);
end $$;

-- ============================================================ TEST 9
-- Customer cancellation: own order, early statuses, inside the window.
do $$
declare r jsonb; v_order uuid; v_reserved_before int;
begin
  select reserved into v_reserved_before from inventory
   where product_id = '22222222-0000-0000-0000-000000000001';

  perform as_user('77777777-0000-0000-0000-000000000001');           -- customer A
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                   'COD');
  perform as_service();
  v_order := (r->>'order_id')::uuid;

  perform as_user('77777777-0000-0000-0000-000000000002');           -- customer B
  r := transition_order(v_order, 'CANCELLED', 'CUSTOMER');
  perform as_service();
  perform assert_eq('T9 other customer cannot cancel', r->>'error', 'NOT_AUTHORIZED');

  perform as_user('77777777-0000-0000-0000-000000000001');
  r := transition_order(v_order, 'CONFIRMED', 'CUSTOMER');
  perform as_service();
  perform assert_eq('T9 customer cannot advance', r->>'error', 'NOT_AUTHORIZED');

  perform as_user('77777777-0000-0000-0000-000000000001');
  r := transition_order(v_order, 'CANCELLED', 'CUSTOMER', null, 'changed my mind');
  perform as_service();
  perform assert_eq('T9 own cancel inside window ok', r->>'ok', 'true');
  perform assert_eq('T9 reservation released',
    (select reserved from inventory where product_id = '22222222-0000-0000-0000-000000000001'),
    v_reserved_before);

  -- Too late: backdate a fresh order past the window.
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                   'COD');
  v_order := (r->>'order_id')::uuid;
  update orders set placed_at = now() - interval '30 minutes' where id = v_order;

  perform as_user('77777777-0000-0000-0000-000000000001');
  r := transition_order(v_order, 'CANCELLED', 'CUSTOMER');
  perform as_service();
  perform assert_eq('T9 cancel after window refused', r->>'error', 'CANCEL_WINDOW_CLOSED');

  -- Once picking has started the customer cannot cancel at all.
  perform transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_order, 'PICKING',   'ADMIN');
  perform as_user('77777777-0000-0000-0000-000000000001');
  r := transition_order(v_order, 'CANCELLED', 'CUSTOMER');
  perform as_service();
  perform assert_eq('T9 cancel at PICKING refused', r->>'error', 'NOT_AUTHORIZED');
  perform transition_order(v_order, 'CANCELLED', 'ADMIN');              -- tidy up
end $$;

-- ============================================================ TEST 10
-- Free-delivery threshold and store-closed gate.
do $$
declare r jsonb;
begin
  update zones set free_delivery_above_paise = 30000
   where id = '33333333-0000-0000-0000-000000000001';

  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                   'COD');                                              -- 35000 >= 30000
  perform assert_eq('T10 fee waived above threshold',
    (select delivery_fee_paise from orders where id = (r->>'order_id')::uuid), 0);
  perform assert_eq('T10 total excludes the fee', (r->>'total_paise')::int, 35000);
  perform transition_order((r->>'order_id')::uuid, 'CANCELLED', 'ADMIN');

  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb,
                   'COD');                                              -- 16500 < 30000
  perform assert_eq('T10 fee charged below threshold',
    (select delivery_fee_paise from orders where id = (r->>'order_id')::uuid), 2000);
  perform transition_order((r->>'order_id')::uuid, 'CANCELLED', 'ADMIN');

  update zones set free_delivery_above_paise = null
   where id = '33333333-0000-0000-0000-000000000001';

  update store_config set is_open = false, closed_message = 'Back at 7am';
  perform as_user('77777777-0000-0000-0000-000000000001');
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                   'COD');
  perform as_service();
  perform assert_eq('T10 customer blocked while closed', r->>'error', 'STORE_CLOSED');
  perform assert_eq('T10 closed message returned', r->>'message', 'Back at 7am');

  perform as_user('77777777-0000-0000-0000-000000000021');
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                   'COD');
  perform as_service();
  perform assert_eq('T10 staff may still order while closed', r->>'ok', 'true');
  perform transition_order((r->>'order_id')::uuid, 'CANCELLED', 'ADMIN');
  update store_config set is_open = true, closed_message = null;
end $$;

-- ============================================================ TEST 11
-- settle_rider_cash is staff only.
do $$
declare r jsonb;
begin
  perform as_user('77777777-0000-0000-0000-000000000011');           -- the rider themself
  r := settle_rider_cash('66666666-0000-0000-0000-000000000001', business_date(), 0, 'nope');
  perform as_service();
  perform assert_eq('T11 rider cannot settle their own cash', r->>'error', 'NOT_AUTHORIZED');

  perform as_user('77777777-0000-0000-0000-000000000021');
  r := settle_rider_cash('66666666-0000-0000-0000-000000000001', business_date(), 0, 'eod');
  perform as_service();
  perform assert_eq('T11 staff settles', r->>'ok', 'true');
end $$;

-- ============================================================ TEST 12
-- Address book and profile (0012): exactly one live default, soft delete
-- promotes, direct row writes closed, linking uses the JWT phone.
do $$
declare r jsonb; v_a uuid; v_b uuid; n int; v_new uuid;
begin
  perform as_user('77777777-0000-0000-0000-000000000002');           -- customer B (has 1 address)
  r := upsert_my_address(null, '33333333-0000-0000-0000-000000000001',
                         'Flat 3, Gandhi Nagar', 'Behind the school', 'WORK', false, 15.27, 76.39);
  v_a := (r->>'id')::uuid;
  perform assert_eq('T12 second address added', r->>'ok', 'true');
  perform assert_eq('T12 existing default untouched',
    (select id from addresses where customer_id = '44444444-0000-0000-0000-000000000002'
       and is_default and deleted_at is null), '55555555-0000-0000-0000-000000000002'::uuid);

  r := upsert_my_address(null, '33333333-0000-0000-0000-000000000001',
                         'Room 12, PG hostel', null, 'OTHER', true, null, null);
  v_b := (r->>'id')::uuid;
  perform assert_eq('T12 third address becomes default', 
    (select is_default from addresses where id = v_b), true);
  select count(*) into n from addresses
   where customer_id = '44444444-0000-0000-0000-000000000002' and is_default and deleted_at is null;
  perform assert_eq('T12 exactly one live default', n, 1);

  r := upsert_my_address(v_a, '33333333-0000-0000-0000-000000000001',
                         'Flat 3, Gandhi Nagar (edited)', null, 'HOME', false, null, null);
  perform assert_eq('T12 edit keeps ownership', r->>'ok', 'true');
  perform assert_eq('T12 edit applied',
    (select label from addresses where id = v_a), 'HOME');

  r := set_default_address(v_a);
  perform assert_eq('T12 set_default ok', r->>'ok', 'true');
  perform assert_eq('T12 previous default cleared',
    (select is_default from addresses where id = v_b), false);

  r := delete_my_address(v_a);                                         -- delete the default
  perform assert_eq('T12 soft delete ok', r->>'ok', 'true');
  perform assert_eq('T12 row kept for order history',
    (select deleted_at is not null from addresses where id = v_a), true);
  select count(*) into n from addresses
   where customer_id = '44444444-0000-0000-0000-000000000002' and is_default and deleted_at is null;
  perform assert_eq('T12 a default was promoted', n, 1);

  r := upsert_my_address(v_a, '33333333-0000-0000-0000-000000000001', 'zombie', null, 'HOME', false, null, null);
  perform assert_eq('T12 deleted address cannot be edited', r->>'error', 'NO_SUCH_ADDRESS');

  r := upsert_my_address(null, '00000000-0000-0000-0000-000000000000', 'nowhere', null, 'HOME', false, null, null);
  perform assert_eq('T12 unknown zone refused', r->>'error', 'INVALID_ZONE');

  -- Direct writes are closed; the unique index is the backstop anyway.
  update addresses set is_default = true where id = v_b;
  get diagnostics n = row_count;
  perform assert_eq('T12 direct address update blocked by RLS', n, 0);

  r := update_my_profile('  Bhavana  ');
  perform assert_eq('T12 profile name saved', r->>'name', 'Bhavana');
  perform assert_eq('T12 profile name persisted',
    (select name from customers where id = '44444444-0000-0000-0000-000000000002'), 'Bhavana');
  r := update_my_profile('   ');
  perform assert_eq('T12 blank name refused', r->>'error', 'INVALID_NAME');
  perform as_service();

  -- Another customer cannot touch B's addresses.
  perform as_user('77777777-0000-0000-0000-000000000001');
  r := set_default_address(v_b);
  perform assert_eq('T12 other customer cannot set default', r->>'error', 'NO_SUCH_ADDRESS');
  r := delete_my_address(v_b);
  perform assert_eq('T12 other customer cannot delete', r->>'error', 'NO_SUCH_ADDRESS');
  perform as_service();

  -- Linking: a brand-new phone user gets a customer row from the JWT phone,
  -- whatever number the client sends.
  perform as_user('77777777-0000-0000-0000-000000000099', '919900000099');
  v_new := link_current_user_to_customer('+919900000001', 'Newcomer');   -- claims A's number
  perform as_service();
  perform assert_eq('T12 link uses the JWT phone',
    (select phone from customers where id = v_new), '+919900000099');
  perform assert_eq('T12 A still owns their own row',
    (select auth_uid from customers where id = '44444444-0000-0000-0000-000000000001'),
    '77777777-0000-0000-0000-000000000001'::uuid);

  -- A phone session with no phone claim and no admin rights cannot link.
  perform as_user('77777777-0000-0000-0000-000000000098');
  begin
    perform link_current_user_to_customer('+919900000003');
    raise warning 'FAIL  T12 link without a verified phone was allowed';
  exception when insufficient_privilege then
    raise notice 'PASS  T12 link without a verified phone refused';
  end;
  perform as_service();
end $$;

-- ============================================================ TEST 13
-- Tracking helpers (0014): the rider is visible only to the owner and only
-- while out for delivery; cancel_my_order goes through the same rules.
do $$
declare r jsonb; v_order uuid;
begin
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb,
                   'COD');
  v_order := (r->>'order_id')::uuid;
  perform transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_order, 'PICKING',   'ADMIN');
  perform transition_order(v_order, 'PACKED',    'ADMIN');
  perform assign_rider(v_order, '66666666-0000-0000-0000-000000000001');

  perform as_user('77777777-0000-0000-0000-000000000001');
  r := my_order_rider(v_order);
  perform as_service();
  perform assert_eq('T13 no rider shown before dispatch', r, null::jsonb);

  perform transition_order(v_order, 'OUT_FOR_DELIVERY', 'ADMIN');

  perform as_user('77777777-0000-0000-0000-000000000001');
  r := my_order_rider(v_order);
  perform as_service();
  perform assert_eq('T13 owner sees the rider while out', r->>'name', 'Test Rider');

  perform as_user('77777777-0000-0000-0000-000000000002');
  r := my_order_rider(v_order);
  perform as_service();
  perform assert_eq('T13 other customer sees nothing', r, null::jsonb);

  perform as_user('77777777-0000-0000-0000-000000000001');
  r := cancel_my_order(v_order, 'too late now');
  perform as_service();
  perform assert_eq('T13 cannot cancel once out', r->>'error', 'NOT_AUTHORIZED');

  perform transition_order(v_order, 'DELIVERED', 'RIDER', '66666666-0000-0000-0000-000000000001');
  perform as_user('77777777-0000-0000-0000-000000000001');
  r := my_order_rider(v_order);
  perform as_service();
  perform assert_eq('T13 rider hidden after delivery', r, null::jsonb);

  -- A fresh order cancels through the wrapper, with the reason on the event.
  perform as_user('77777777-0000-0000-0000-000000000001');
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb,
                   'COD');
  v_order := (r->>'order_id')::uuid;
  r := cancel_my_order(v_order, '  ordered by mistake  ');
  perform as_service();
  perform assert_eq('T13 cancel_my_order ok', r->>'ok', 'true');
  perform assert_eq('T13 reason recorded',
    (select note from order_events where order_id = v_order and to_status = 'CANCELLED'), 'ordered by mistake');
  perform assert_eq('T13 recorded as the customer',
    (select actor_type::text from order_events where order_id = v_order and to_status = 'CANCELLED'), 'CUSTOMER');
end $$;

-- ============================================================ TEST 14
-- Hardening (0017): idempotent placement, deleted address, snapshot,
-- nothing-packed, returns, UPI collection, settlement reopen, stock refusal.
do $$
declare r jsonb; r2 jsonb; v_a uuid; v_key uuid := gen_random_uuid(); v_res int;
begin
  select reserved into v_res from inventory where product_id = '22222222-0000-0000-0000-000000000002';

  perform as_user('77777777-0000-0000-0000-000000000001');
  r := place_order('44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb, 'COD', null, null, v_key);
  r2 := place_order('44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
                    '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb, 'COD', null, null, v_key);
  perform as_service();
  perform assert_eq('T14 first placement ok', r->>'ok', 'true');
  perform assert_eq('T14 retry with same key returns the same order', r2->>'order_id', r->>'order_id');
  perform assert_eq('T14 retry is flagged as a replay', r2->>'replayed', 'true');
  perform assert_eq('T14 stock reserved once',
    (select reserved from inventory where product_id = '22222222-0000-0000-0000-000000000002'), v_res + 1);
  v_a := (r->>'order_id')::uuid;
  perform assert_eq('T14 delivery address snapshotted',
    (select delivery_snapshot->>'line1' from orders where id = v_a), '2nd Cross, Chittawadgi');
  perform assert_eq('T14 promise stamped from the zone SLA',
    (select promised_at = placed_at + interval '15 minutes' from orders where id = v_a), true);

  -- Duplicate product lines are rejected rather than half-reserved.
  r := place_order('44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1},{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb, 'COD');
  perform assert_eq('T14 duplicate lines refused', r->>'error', 'INVALID_QTY');

  -- Nothing packed is a cancellation, not a fee-only delivery.
  perform transition_order(v_a, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_a, 'PICKING', 'ADMIN');
  r := transition_order(v_a, 'PACKED', 'ADMIN', null, null,
                        '[{"product_id":"22222222-0000-0000-0000-000000000002","fulfilled_qty":0}]'::jsonb);
  perform assert_eq('T14 packing nothing refused', r->>'error', 'NOTHING_PACKED');
  perform assert_eq('T14 order still picking', (select status::text from orders where id = v_a), 'PICKING');
  perform transition_order(v_a, 'CANCELLED', 'ADMIN');

  -- A deleted address cannot take a new order.
  perform as_user('77777777-0000-0000-0000-000000000002');
  r := upsert_my_address(null, '33333333-0000-0000-0000-000000000001', 'Temporary', null, 'OTHER', false, null, null);
  v_a := (r->>'id')::uuid;
  perform delete_my_address(v_a);
  r := place_order('44444444-0000-0000-0000-000000000002', v_a,
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb, 'COD');
  perform as_service();
  perform assert_eq('T14 deleted address refused', r->>'error', 'INVALID_ADDRESS');
end $$;

-- ============================================================ TEST 15
-- Failed delivery: stock waits for the return; UPI waits for verification;
-- cash after settlement reopens the day.
do $$
declare r jsonb; v_order uuid; v_hand int; v_cash int;
begin
  select on_hand into v_hand from inventory where product_id = '22222222-0000-0000-0000-000000000002';
  r := place_order('44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":2}]'::jsonb, 'COD');
  v_order := (r->>'order_id')::uuid;
  perform transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_order, 'PICKING',   'ADMIN');
  perform transition_order(v_order, 'PACKED',    'ADMIN');
  perform assert_eq('T15 packed leaves the shelf',
    (select on_hand from inventory where product_id = '22222222-0000-0000-0000-000000000002'), v_hand - 2);
  perform assign_rider(v_order, '66666666-0000-0000-0000-000000000001');
  perform transition_order(v_order, 'OUT_FOR_DELIVERY', 'ADMIN');

  perform as_user('77777777-0000-0000-0000-000000000011');
  r := transition_order(v_order, 'FAILED', 'RIDER', null, 'door locked');
  perform as_service();
  perform assert_eq('T15 failed ok', r->>'ok', 'true');
  perform assert_eq('T15 failed does NOT restock by itself',
    (select on_hand from inventory where product_id = '22222222-0000-0000-0000-000000000002'), v_hand - 2);

  perform as_user('77777777-0000-0000-0000-000000000002');           -- a customer
  r := admin_receive_return(v_order);
  perform as_service();
  perform assert_eq('T15 customer cannot receive a return', r->>'error', 'NOT_AUTHORIZED');

  perform as_user('77777777-0000-0000-0000-000000000021');           -- owner
  r := admin_receive_return(v_order, '[{"product_id":"22222222-0000-0000-0000-000000000002","good_qty":1}]'::jsonb);
  perform as_service();
  perform assert_eq('T15 return received', r->>'ok', 'true');
  perform assert_eq('T15 one unit not resellable', (r->>'not_resellable')::int, 1);
  perform assert_eq('T15 only the good unit restocked',
    (select on_hand from inventory where product_id = '22222222-0000-0000-0000-000000000002'), v_hand - 1);
  r := admin_receive_return(v_order);
  perform assert_eq('T15 second receipt refused', r->>'error', 'ALREADY_RETURNED');

  -- UPI at the door: reported by the rider, pending until staff verify, no rider cash.
  r := place_order('44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb, 'COD');
  v_order := (r->>'order_id')::uuid;
  perform transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_order, 'PICKING',   'ADMIN');
  perform transition_order(v_order, 'PACKED',    'ADMIN');
  perform assign_rider(v_order, '66666666-0000-0000-0000-000000000001');
  perform transition_order(v_order, 'OUT_FOR_DELIVERY', 'ADMIN');
  select coalesce(cash_expected_paise, 0) into v_cash from rider_settlements
   where rider_id = '66666666-0000-0000-0000-000000000001' and settlement_date = business_date();

  perform as_user('77777777-0000-0000-0000-000000000011');
  r := rider_deliver(v_order, 'UPI', ' UPI-123 ');
  perform as_service();
  perform assert_eq('T15 UPI delivery ok', r->>'ok', 'true');
  perform assert_eq('T15 order delivered', (select status::text from orders where id = v_order), 'DELIVERED');
  perform assert_eq('T15 payment still pending', (select status::text from payments where order_id = v_order), 'PENDING');
  perform assert_eq('T15 reported as UPI', (select reported_method::text from payments where order_id = v_order), 'UPI');
  perform assert_eq('T15 reference trimmed', (select reported_reference from payments where order_id = v_order), 'UPI-123');
  perform assert_eq('T15 no rider cash for UPI',
    (select coalesce(cash_expected_paise, 0) from rider_settlements
      where rider_id = '66666666-0000-0000-0000-000000000001' and settlement_date = business_date()), v_cash);

  perform as_user('77777777-0000-0000-0000-000000000011');
  r := admin_verify_payment(v_order);
  perform as_service();
  perform assert_eq('T15 rider cannot verify payment', r->>'error', 'NOT_AUTHORIZED');
  perform as_user('77777777-0000-0000-0000-000000000021');
  r := admin_verify_payment(v_order);
  perform as_service();
  perform assert_eq('T15 staff verified', r->>'ok', 'true');
  perform assert_eq('T15 payment now PAID', (select status::text from payments where order_id = v_order), 'PAID');
  perform assert_eq('T15 order payment_status PAID', (select payment_status::text from orders where id = v_order), 'PAID');

  -- Settle the day, then deliver cash: the day reopens.
  perform settle_rider_cash('66666666-0000-0000-0000-000000000001', business_date(),
    (select cash_expected_paise from rider_settlements
      where rider_id = '66666666-0000-0000-0000-000000000001' and settlement_date = business_date()), 'closed');
  perform assert_eq('T15 day settled', (select status::text from rider_settlements
      where rider_id = '66666666-0000-0000-0000-000000000001' and settlement_date = business_date()), 'SETTLED');
  r := place_order('44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":1}]'::jsonb, 'COD');
  v_order := (r->>'order_id')::uuid;
  perform transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_order, 'PICKING',   'ADMIN');
  perform transition_order(v_order, 'PACKED',    'ADMIN');
  perform transition_order(v_order, 'OUT_FOR_DELIVERY', 'ADMIN', null, null, null, '66666666-0000-0000-0000-000000000001');
  perform transition_order(v_order, 'DELIVERED', 'RIDER', '66666666-0000-0000-0000-000000000001');
  perform assert_eq('T15 late cash reopens the day', (select status::text from rider_settlements
      where rider_id = '66666666-0000-0000-0000-000000000001' and settlement_date = business_date()), 'OPEN');
end $$;

-- ============================================================ TEST 16
-- A refused stock count fails the product save and the import row.
do $$
declare r jsonb; v_res int; v_name text; v_order uuid;
begin
  perform as_user('77777777-0000-0000-0000-000000000021');
  perform admin_adjust_stock('22222222-0000-0000-0000-000000000002', 10, 'RESTOCK');
  perform as_service();
  r := place_order('44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000002","qty":2}]'::jsonb, 'COD');
  perform assert_eq('T16 setup order placed', r->>'ok', 'true');
  v_order := (r->>'order_id')::uuid;
  select reserved into v_res from inventory where product_id = '22222222-0000-0000-0000-000000000002';
  select name into v_name from products where id = '22222222-0000-0000-0000-000000000002';

  perform as_user('77777777-0000-0000-0000-000000000021');
  r := admin_upsert_product('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
                            'Renamed Dal', '1 kg', 16500, null, null, null, true, v_res - 1, null);
  perform as_service();
  perform assert_eq('T16 below-reserved save refused', r->>'error', 'BELOW_RESERVED');
  perform assert_eq('T16 product untouched by the refused save',
    (select name from products where id = '22222222-0000-0000-0000-000000000002'), v_name);

  perform as_user('77777777-0000-0000-0000-000000000021');
  r := admin_bulk_upsert_products(jsonb_build_array(jsonb_build_object(
         'name', v_name, 'unit', '1 kg', 'mrp_paise', 16500, 'stock', v_res - 1, 'category', 'Staples', 'brand', 'Nope')));
  perform as_service();
  perform assert_eq('T16 import row reports the refusal', r->'results'->0->>'status', 'error');
  perform assert_eq('T16 import brand not applied on the refused row',
    (select brand from products where id = '22222222-0000-0000-0000-000000000002') is distinct from 'Nope', true);
  perform transition_order(v_order, 'CANCELLED', 'ADMIN');
end $$;

-- ============================================================ TEST 17
-- Deal prices (0019): charged by place_order, recorded on the line,
-- refused when not below the MRP.
do $$
declare r jsonb; v_order uuid;
begin
  perform as_user('77777777-0000-0000-0000-000000000021');
  perform admin_adjust_stock('22222222-0000-0000-0000-000000000001', 10, 'RESTOCK');
  r := admin_upsert_product('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
                            'Sona Masoori Rice', '5 kg', 35000, null, null, null, true, null, null, 40000);
  perform assert_eq('T17 deal above MRP refused', r->>'error', 'INVALID_DEAL_PRICE');
  r := admin_upsert_product('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
                            'Sona Masoori Rice', '5 kg', 35000, null, null, null, true, null, null, 29900);
  perform assert_eq('T17 deal set', r->>'ok', 'true');
  perform as_service();

  r := place_order('44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":2}]'::jsonb, 'COD', 61800);
  perform assert_eq('T17 deal price charged (2 x 299 + 20 fee)', r->>'ok', 'true');
  v_order := (r->>'order_id')::uuid;
  perform assert_eq('T17 line records the price paid',
    (select unit_mrp_paise from order_items where order_id = v_order), 29900);
  perform assert_eq('T17 subtotal at deal price',
    (select subtotal_paise from orders where id = v_order), 59800);
  perform transition_order(v_order, 'CANCELLED', 'ADMIN');

  perform as_user('77777777-0000-0000-0000-000000000021');
  r := admin_upsert_product('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
                            'Sona Masoori Rice', '5 kg', 35000, null, null, null, true, null, null, null);
  perform as_service();
  perform assert_eq('T17 deal cleared',
    (select sale_price_paise from products where id = '22222222-0000-0000-0000-000000000001'), null::int);
end $$;

-- ============================================================ TEST 18
-- Category shelf order (0020): an imported category lands after the last
-- one, in file order; a second import of the same name keeps its slot.
do $$
declare r jsonb; v_max int; v_a int; v_b int;
begin
  select max(sort_order) into v_max from categories;
  perform as_user('77777777-0000-0000-0000-000000000021');
  r := admin_bulk_upsert_products('[
    {"name":"T18 Bananas","category":"T18 Fresh Fruit","unit":"1 dozen","mrp_paise":6000,"stock":5},
    {"name":"T18 Broom","category":"T18 Home Care","unit":"1 pc","mrp_paise":9000,"stock":5},
    {"name":"T18 Apples","category":"T18 Fresh Fruit","unit":"1 kg","mrp_paise":18000,"stock":5}
  ]'::jsonb);
  perform as_service();
  perform assert_eq('T18 import ok', r->>'ok', 'true');
  select sort_order into v_a from categories where name = 'T18 Fresh Fruit';
  select sort_order into v_b from categories where name = 'T18 Home Care';
  perform assert_eq('T18 first new category after the shelf', v_a, v_max + 10);
  perform assert_eq('T18 second new category after the first', v_b, v_max + 20);
  perform assert_eq('T18 repeated category reused, not re-added',
    (select count(*) from categories where name = 'T18 Fresh Fruit'), 1::bigint);
end $$;

-- ============================================================ TEST 19
-- Google identity (0021): a session with an email and no phone claim gets
-- its own customer row; checkout needs a contact number; staff lookup finds
-- the customer by that number; phone customers keep contact = sign-in.
create or replace function as_google(p_uid text, p_email text, p_name text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'email', p_email, 'phone', '',
                       'user_metadata', jsonb_build_object('full_name', p_name))::text, true);
  execute 'set local role authenticated';
end $$;

do $$
declare r jsonb; v_cust uuid; v_addr uuid; v_order uuid; v_found uuid; v_err text;
begin
  perform assert_eq('T19 phone customers got contact_phone backfilled',
    (select contact_phone from customers where id = '44444444-0000-0000-0000-000000000001'),
    (select phone from customers where id = '44444444-0000-0000-0000-000000000001'));

  -- link by email identity
  perform as_google('77777777-0000-0000-0000-000000000031', 'Asha@Gmail.com', 'Asha Kulkarni');
  v_cust := link_current_user_to_customer(null, null);
  perform assert_eq('T19 second link is idempotent', link_current_user_to_customer(null, null), v_cust);
  perform assert_eq('T19 email lowercased', (select email from customers where id = v_cust), 'asha@gmail.com');
  perform assert_eq('T19 name from Google profile', (select name from customers where id = v_cust), 'Asha Kulkarni');
  perform assert_eq('T19 no phone yet', (select phone from customers where id = v_cust), null::text);
  perform assert_eq('T19 no contact yet', (select contact_phone from customers where id = v_cust), null::text);

  r := upsert_my_address(null, '33333333-0000-0000-0000-000000000001', '3rd Cross, Chittawadgi', 'Near the tank');
  perform assert_eq('T19 google customer can add an address', r->>'ok', 'true');
  v_addr := (r->>'id')::uuid;
  perform as_service();

  perform as_user('77777777-0000-0000-0000-000000000021');
  perform admin_adjust_stock('22222222-0000-0000-0000-000000000001', 10, 'RESTOCK');
  perform as_service();
  r := place_order(v_cust, v_addr,
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb, 'COD', 37000);
  perform assert_eq('T19 checkout refused without a number', r->>'error', 'NO_CONTACT_PHONE');

  perform as_google('77777777-0000-0000-0000-000000000031', 'asha@gmail.com', 'Asha Kulkarni');
  r := set_my_contact_phone('12345');
  perform assert_eq('T19 short number refused', r->>'error', 'INVALID_PHONE');
  r := set_my_contact_phone('098765 43210');
  perform assert_eq('T19 contact number saved', r->>'phone', '+919876543210');
  perform as_service();

  r := place_order(v_cust, v_addr,
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb, 'COD', 37000);
  perform assert_eq('T19 checkout ok with a contact number', r->>'ok', 'true');
  v_order := (r->>'order_id')::uuid;
  perform assert_eq('T19 snapshot carries the callable number',
    (select delivery_snapshot->>'phone' from orders where id = v_order), '+919876543210');
  perform transition_order(v_order, 'CANCELLED', 'ADMIN');

  -- staff lookup by the contact number finds her, not a duplicate
  perform as_user('77777777-0000-0000-0000-000000000021');
  v_found := find_or_create_customer('+919876543210', null);
  perform as_service();
  perform assert_eq('T19 staff lookup matches the contact number', v_found, v_cust);

  -- a session with neither phone nor email still cannot link
  perform as_user('77777777-0000-0000-0000-000000000032');
  begin
    perform link_current_user_to_customer(null, null);
    v_err := 'no error';
  exception when insufficient_privilege then v_err := 'refused';
  end;
  perform as_service();
  perform assert_eq('T19 no phone, no email: refused', v_err, 'refused');
end $$;

drop function as_google(text, text, text);

-- ============================================================ TEST 20
-- Order alerts (0022): the message reads well, the trigger runs at commit
-- without pg_net, and targets are admin-only.
do $$
declare r jsonb; v_order uuid; v_text text;
begin
  perform as_user('77777777-0000-0000-0000-000000000021');
  perform admin_adjust_stock('22222222-0000-0000-0000-000000000001', 10, 'RESTOCK');
  insert into notify_targets (kind, label, target) values ('ntfy', 'Owner phone', 'faa-orders-test');
  perform as_service();

  r := place_order('44444444-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":2}]'::jsonb, 'COD', 72000,
                   'Ring the bell twice');
  perform assert_eq('T20 order placed with the alert trigger armed', r->>'ok', 'true');
  v_order := (r->>'order_id')::uuid;
  v_text := order_alert_text(v_order);
  perform assert_eq('T20 alert names the order', position((select order_no from orders where id = v_order) in v_text) > 0, true);
  perform assert_eq('T20 alert lists the item', position('2× Sona Masoori Rice' in v_text) > 0, true);
  perform assert_eq('T20 alert carries the note', position('Note: Ring the bell twice' in v_text) > 0, true);
  perform assert_eq('T20 alert shows rupees', position('₹720' in v_text) > 0, true);
  perform assert_eq('T20 rupees with paise', rupees(20550), '₹205.50');
  perform transition_order(v_order, 'CANCELLED', 'ADMIN');

  perform as_user('77777777-0000-0000-0000-000000000021');
  r := admin_notify_test();
  perform assert_eq('T20 test send reports the target count', (r->>'targets')::int, 1);
  perform assert_eq('T20 nothing sent without pg_net', (r->>'sent')::int, case when (r->>'pg_net')::boolean then 1 else 0 end);
  perform as_service();

  perform as_user('77777777-0000-0000-0000-000000000001', '+919900000001');
  perform assert_eq('T20 customers cannot see alert targets', (select count(*) from notify_targets), 0::bigint);
  perform as_service();
  delete from notify_targets where target = 'faa-orders-test';
end $$;

-- ============================================================ TEST 21
-- Auto zone (0023): with one zone and no centres, anywhere resolves to it;
-- with a centre and radius, only pins inside; two active zones without
-- centres are ambiguous; the address form may omit the zone.
do $$
declare r jsonb; v_zone uuid := '33333333-0000-0000-0000-000000000001'; v_other uuid; v_addr uuid;
begin
  perform assert_eq('T21 single zone, no centre: anything resolves', resolve_zone(12.97, 77.59), v_zone);
  perform assert_eq('T21 single zone, no coords: still resolves', resolve_zone(null, null), v_zone);

  perform as_user('77777777-0000-0000-0000-000000000001', '+919900000001');
  r := upsert_my_address(null, null, '5th Cross, Chittawadgi', 'Opp. school', 'WORK', false, 15.28, 76.375);
  perform assert_eq('T21 address saved without a zone', r->>'ok', 'true');
  v_addr := (r->>'id')::uuid;
  perform assert_eq('T21 zone filled in from the pin', (select zone_id from addresses where id = v_addr), v_zone);
  perform as_service();

  update zones set lat = 15.28, lng = 76.375, radius_m = 1500 where id = v_zone;
  perform assert_eq('T21 inside the radius', resolve_zone(15.281, 76.376), v_zone);
  perform assert_eq('T21 outside the radius: null', resolve_zone(12.97, 77.59), null::uuid);

  perform as_user('77777777-0000-0000-0000-000000000001', '+919900000001');
  r := upsert_my_address(null, null, 'MG Road, Bengaluru', null, 'OTHER', false, 12.97, 77.59);
  perform assert_eq('T21 pin outside every area is refused', r->>'error', 'OUTSIDE_DELIVERY_AREA');
  perform as_service();

  update zones set lat = null, lng = null, radius_m = null where id = v_zone;
  insert into zones (name, delivery_fee_paise, min_order_paise) values ('T21 Other', 2000, 10000) returning id into v_other;
  perform assert_eq('T21 two zones, no centres: ambiguous', resolve_zone(15.28, 76.375), null::uuid);
  delete from zones where id = v_other;
  perform delete_my_address(v_addr);
  update addresses set deleted_at = null where id = v_addr; -- keep fixture state tidy either way
  delete from addresses where id = v_addr;
end $$;

drop function as_user(text, text);
drop function as_service();
