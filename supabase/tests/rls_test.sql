-- rls_test.sql — proves the anon key cannot reach private data.
-- Run AFTER lifecycle_test.sql so there are real orders to try to steal.

do $$
declare n int;
begin
  -- Catalogue must remain publicly readable: the shop has to work logged out.
  set local role anon;
  select count(*) into n from products;
  if n > 0 then raise notice 'PASS  anon can read the catalogue (% products)', n;
          else raise warning 'FAIL  anon cannot read the catalogue'; end if;
  reset role;
end $$;

do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from orders;
  if n = 0 then raise notice 'PASS  anon sees no orders';
          else raise warning 'FAIL  anon read % orders', n; end if;

  select count(*) into n from customers;
  if n = 0 then raise notice 'PASS  anon sees no customers';
          else raise warning 'FAIL  anon read % customers', n; end if;

  select count(*) into n from payments;
  if n = 0 then raise notice 'PASS  anon sees no payments';
          else raise warning 'FAIL  anon read % payments', n; end if;
  reset role;
end $$;

do $$
begin
  set local role anon;
  begin
    insert into orders (customer_id, address_id, zone_id, subtotal_paise,
                        delivery_fee_paise, total_paise, payment_method)
    values ('44444444-0000-0000-0000-000000000001',
            '55555555-0000-0000-0000-000000000001',
            '33333333-0000-0000-0000-000000000001', 1, 0, 1, 'COD');
    raise warning 'FAIL  anon inserted an order directly';
  exception when others then
    raise notice 'PASS  anon cannot insert orders directly';
  end;
  reset role;
end $$;

do $$
declare n int; before int; after_ int;
begin
  select sum(on_hand) into before from inventory;

  set local role anon;
  -- RLS filters rows rather than raising: a blocked UPDATE simply matches
  -- nothing and returns cleanly. So assert on rows affected, not on an error.
  update inventory set on_hand = 99999;
  get diagnostics n = row_count;
  reset role;

  select sum(on_hand) into after_ from inventory;

  if n = 0 and before = after_ then
    raise notice 'PASS  anon cannot write inventory (0 rows affected)';
  else
    raise warning 'FAIL  anon changed % inventory rows (% -> %)', n, before, after_;
  end if;
end $$;

do $$
declare n int; before int; after_ int;
begin
  select count(*) into before from orders;
  set local role anon;
  delete from orders;
  get diagnostics n = row_count;
  reset role;
  select count(*) into after_ from orders;

  if n = 0 and before = after_ then
    raise notice 'PASS  anon cannot delete orders (0 rows affected)';
  else
    raise warning 'FAIL  anon deleted % orders', n;
  end if;
end $$;

do $$
begin
  set local role anon;
  begin
    perform place_order('44444444-0000-0000-0000-000000000001',
                        '55555555-0000-0000-0000-000000000001',
                        '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                        'COD');
    raise warning 'FAIL  anon executed place_order';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot execute place_order (login required)';
  when others then
    raise notice 'PASS  anon blocked from place_order (%)', sqlerrm;
  end;
  reset role;
end $$;

do $$
begin
  set local role anon;
  begin
    perform transition_order('00000000-0000-0000-0000-000000000000', 'CONFIRMED', 'ADMIN');
    raise warning 'FAIL  anon executed transition_order';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot execute transition_order';
  end;
  begin
    perform settle_rider_cash('66666666-0000-0000-0000-000000000001', current_date, 0);
    raise warning 'FAIL  anon executed settle_rider_cash';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot execute settle_rider_cash';
  end;
  reset role;
end $$;

-- A rider sees the customer and address of an order assigned to them while it
-- is live, and nothing once it is delivered. A customer sees only themself.
do $$
declare r jsonb; v_order uuid; n int; n_addr int;
begin
  r := place_order('44444444-0000-0000-0000-000000000001',
                   '55555555-0000-0000-0000-000000000001',
                   '[{"product_id":"22222222-0000-0000-0000-000000000001","qty":1}]'::jsonb,
                   'COD');
  v_order := (r->>'order_id')::uuid;
  perform transition_order(v_order, 'CONFIRMED', 'ADMIN');
  perform transition_order(v_order, 'PICKING',   'ADMIN');
  perform transition_order(v_order, 'PACKED',    'ADMIN');

  perform set_config('request.jwt.claim.sub', '77777777-0000-0000-0000-000000000011', true);
  set local role authenticated;
  select count(*) into n from customers where id = '44444444-0000-0000-0000-000000000001';
  reset role;
  if n = 0 then raise notice 'PASS  rider sees no customer before assignment';
           else raise warning 'FAIL  rider read an unassigned customer'; end if;

  perform set_config('request.jwt.claim.sub', '', true);            -- service context
  perform assign_rider(v_order, '66666666-0000-0000-0000-000000000001');

  perform set_config('request.jwt.claim.sub', '77777777-0000-0000-0000-000000000011', true);
  set local role authenticated;
  select count(*) into n from customers where id = '44444444-0000-0000-0000-000000000001';
  select count(*) into n_addr from addresses where id = '55555555-0000-0000-0000-000000000001';
  reset role;
  if n = 1 and n_addr = 1 then raise notice 'PASS  assigned rider sees the customer and address';
                          else raise warning 'FAIL  assigned rider got customer=% address=%', n, n_addr; end if;

  set local role authenticated;
  select count(*) into n from customers;
  reset role;
  if n = 1 then raise notice 'PASS  rider sees only that one customer';
           else raise warning 'FAIL  rider sees % customers', n; end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform transition_order(v_order, 'OUT_FOR_DELIVERY', 'ADMIN');
  perform transition_order(v_order, 'DELIVERED', 'RIDER', '66666666-0000-0000-0000-000000000001');

  perform set_config('request.jwt.claim.sub', '77777777-0000-0000-0000-000000000011', true);
  set local role authenticated;
  select count(*) into n from customers where id = '44444444-0000-0000-0000-000000000001';
  reset role;
  if n = 0 then raise notice 'PASS  rider loses the customer after delivery';
           else raise warning 'FAIL  rider still reads a delivered order''s customer'; end if;

  perform set_config('request.jwt.claim.sub', '77777777-0000-0000-0000-000000000002', true);
  set local role authenticated;
  select count(*) into n from customers;
  select count(*) into n_addr from orders where customer_id = '44444444-0000-0000-0000-000000000001';
  reset role;
  if n = 1 and n_addr = 0 then raise notice 'PASS  customer sees only themself and their own orders';
                          else raise warning 'FAIL  customer B sees % customers, % of A''s orders', n, n_addr; end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '77777777-0000-0000-0000-000000000002', true);
  update customers set phone = '+910000000000' where id = '44444444-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  reset role;
  if n = 0 then raise notice 'PASS  customer cannot rewrite their own row directly';
           else raise warning 'FAIL  customer updated % customer rows directly', n; end if;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
