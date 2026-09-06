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
