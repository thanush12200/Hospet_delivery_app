-- 0002_functions.sql — the two functions that guard stock and money.
--
-- Nothing outside this file is permitted to change orders.status or inventory.
-- Both functions are SECURITY DEFINER and must be the only granted path.

-- ================================================================
-- Guard: orders.status can only move through transition_order().
-- ================================================================

create or replace function guard_order_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.allow_status_change', true), '') <> 'on' then
    raise exception
      'orders.status may only be changed via transition_order() (attempted % -> %)',
      old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger orders_guard_status
  before update on orders
  for each row execute function guard_order_status();

-- order_events is append-only.
create or replace function block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'check_violation';
end $$;

create trigger order_events_no_update before update or delete on order_events
  for each row execute function block_mutation();

-- ================================================================
-- place_order — atomic reserve + create. The most important function here.
-- ================================================================
--
-- p_items: [{"product_id": "...", "qty": 2}, ...]
--
-- Returns on success:
--   {"ok": true, "order_id": "...", "order_no": "H1001", "total_paise": 45000}
-- Returns on stock shortage (nothing written):
--   {"ok": false, "error": "OUT_OF_STOCK",
--    "shortages": [{"product_id":"...","name":"...","requested":3,"available":1}]}

create or replace function place_order(
  p_customer_id     uuid,
  p_address_id      uuid,
  p_items           jsonb,
  p_payment_method  payment_method,
  p_client_total_paise int default null,
  p_note            text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zone_id      uuid;
  v_fee          int;
  v_min_order    int;
  v_subtotal     int := 0;
  v_total        int;
  v_order_id     uuid;
  v_order_no     text;
  v_shortages    jsonb := '[]'::jsonb;
  r              record;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_CART');
  end if;

  -- Address must belong to this customer. Never trust the client on this.
  select a.zone_id, z.delivery_fee_paise, z.min_order_paise
    into v_zone_id, v_fee, v_min_order
  from addresses a
  join zones z on z.id = a.zone_id
  where a.id = p_address_id
    and a.customer_id = p_customer_id
    and z.is_active;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ADDRESS');
  end if;

  -- Lock every inventory row in a deterministic order (product_id) so that
  -- concurrent orders queue instead of deadlocking.
  create temp table _req on commit drop as
  select (i->>'product_id')::uuid as product_id,
         (i->>'qty')::int         as qty
  from jsonb_array_elements(p_items) i;

  if exists (select 1 from _req where qty is null or qty <= 0) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_QTY');
  end if;

  perform 1
  from inventory inv
  join _req r2 on r2.product_id = inv.product_id
  order by inv.product_id
  for update of inv;

  -- Collect shortages and inactive products in one pass.
  for r in
    select req.product_id,
           req.qty,
           p.name,
           p.is_active,
           p.mrp_paise,
           coalesce(inv.on_hand - inv.reserved, 0) as available
    from _req req
    left join products  p   on p.id   = req.product_id
    left join inventory inv on inv.product_id = req.product_id
  loop
    if r.name is null or not r.is_active then
      return jsonb_build_object('ok', false, 'error', 'PRODUCT_UNAVAILABLE',
                                'product_id', r.product_id);
    end if;
    if r.available < r.qty then
      v_shortages := v_shortages || jsonb_build_object(
        'product_id', r.product_id,
        'name',       r.name,
        'requested',  r.qty,
        'available',  greatest(r.available, 0));
    end if;
    -- Price is recomputed server-side from products.mrp_paise. The client's
    -- number is only ever used as a cross-check, never as input.
    v_subtotal := v_subtotal + (r.mrp_paise * r.qty);
  end loop;

  if jsonb_array_length(v_shortages) > 0 then
    return jsonb_build_object('ok', false, 'error', 'OUT_OF_STOCK',
                              'shortages', v_shortages);
  end if;

  if v_subtotal < v_min_order then
    return jsonb_build_object('ok', false, 'error', 'BELOW_MIN_ORDER',
                              'min_order_paise', v_min_order,
                              'subtotal_paise',  v_subtotal);
  end if;

  v_total := v_subtotal + v_fee;

  if p_client_total_paise is not null and p_client_total_paise <> v_total then
    return jsonb_build_object('ok', false, 'error', 'PRICE_MISMATCH',
                              'server_total_paise', v_total,
                              'client_total_paise', p_client_total_paise);
  end if;

  insert into orders (customer_id, address_id, zone_id, status,
                      subtotal_paise, delivery_fee_paise, total_paise,
                      payment_method, note)
  values (p_customer_id, p_address_id, v_zone_id, 'PLACED',
          v_subtotal, v_fee, v_total, p_payment_method, p_note)
  returning id, order_no into v_order_id, v_order_no;

  insert into order_items (order_id, product_id, qty, unit_mrp_paise,
                           line_total_paise, product_name)
  select v_order_id, req.product_id, req.qty, p.mrp_paise,
         p.mrp_paise * req.qty, p.name
  from _req req join products p on p.id = req.product_id;

  -- Reserve. The CHECK on inventory is the last line of defence.
  update inventory inv
     set reserved = inv.reserved + req.qty
    from _req req
   where inv.product_id = req.product_id;

  insert into stock_movements (product_id, delta_reserved, reason, order_id,
                               actor_type, actor_id)
  select req.product_id, req.qty, 'ORDER_RESERVE', v_order_id,
         'CUSTOMER', p_customer_id
  from _req req;

  insert into payments (order_id, method, amount_paise, status)
  values (v_order_id, p_payment_method, v_total, 'PENDING');

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id)
  values (v_order_id, null, 'PLACED', 'CUSTOMER', p_customer_id);

  return jsonb_build_object('ok', true,
                            'order_id', v_order_id,
                            'order_no', v_order_no,
                            'total_paise', v_total);
end $$;

-- ================================================================
-- transition_order — the only legal way to move an order's status.
-- ================================================================
--
-- p_fulfilment (only meaningful for PACKED):
--   [{"product_id": "...", "fulfilled_qty": 1}, ...]
--   Omitted lines are treated as fully fulfilled.

create or replace function transition_order(
  p_order_id    uuid,
  p_to_status   order_status,
  p_actor_type  actor_type,
  p_actor_id    uuid default null,
  p_note        text default null,
  p_fulfilment  jsonb default null,
  p_rider_id    uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from     order_status;
  v_total    int;
  v_method   payment_method;
  v_new_sub  int;
  v_fee      int;
  v_legal    boolean;
begin
  select status, total_paise, payment_method, delivery_fee_paise
    into v_from, v_total, v_method, v_fee
  from orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ORDER');
  end if;

  v_legal := case v_from
    when 'PLACED'           then p_to_status in ('CONFIRMED','CANCELLED')
    when 'CONFIRMED'        then p_to_status in ('PICKING','CANCELLED')
    when 'PICKING'          then p_to_status in ('PACKED','CANCELLED')
    when 'PACKED'           then p_to_status in ('OUT_FOR_DELIVERY','CANCELLED')
    when 'OUT_FOR_DELIVERY' then p_to_status in ('DELIVERED','FAILED')
    else false   -- DELIVERED, CANCELLED, FAILED are terminal
  end;

  if not v_legal then
    return jsonb_build_object('ok', false, 'error', 'ILLEGAL_TRANSITION',
                              'from', v_from, 'to', p_to_status);
  end if;

  -- ---- stock side effects -------------------------------------------------

  if p_to_status = 'PACKED' then
    -- Record any short picks first.
    if p_fulfilment is not null then
      update order_items oi
         set fulfilled_qty = least((f->>'fulfilled_qty')::int, oi.qty)
        from jsonb_array_elements(p_fulfilment) f
       where oi.order_id = p_order_id
         and oi.product_id = (f->>'product_id')::uuid;
    end if;
    update order_items set fulfilled_qty = qty
     where order_id = p_order_id and fulfilled_qty is null;

    -- Release the full reservation, remove what actually went out the door.
    update inventory inv
       set reserved = inv.reserved - oi.qty,
           on_hand  = inv.on_hand  - oi.fulfilled_qty
      from order_items oi
     where oi.order_id = p_order_id and inv.product_id = oi.product_id;

    insert into stock_movements (product_id, delta_on_hand, delta_reserved,
                                 reason, order_id, actor_type, actor_id)
    select oi.product_id, -oi.fulfilled_qty, -oi.qty, 'ORDER_PACK',
           p_order_id, p_actor_type, p_actor_id
    from order_items oi where oi.order_id = p_order_id;

    -- A short pick changes what the customer owes.
    select coalesce(sum(unit_mrp_paise * fulfilled_qty), 0) into v_new_sub
      from order_items where order_id = p_order_id;

    if v_new_sub <> (v_total - v_fee) then
      v_total := v_new_sub + v_fee;
      update orders
         set subtotal_paise = v_new_sub,
             total_paise    = v_total
       where id = p_order_id;
      update payments set amount_paise = v_total
       where order_id = p_order_id and status = 'PENDING';
      update order_items
         set line_total_paise = unit_mrp_paise * fulfilled_qty
       where order_id = p_order_id;
    end if;

  elsif p_to_status = 'CANCELLED' then
    if v_from in ('PLACED','CONFIRMED','PICKING') then
      -- Still reserved, never left the shelf.
      update inventory inv
         set reserved = inv.reserved - oi.qty
        from order_items oi
       where oi.order_id = p_order_id and inv.product_id = oi.product_id;

      insert into stock_movements (product_id, delta_reserved, reason, order_id,
                                   actor_type, actor_id)
      select oi.product_id, -oi.qty, 'ORDER_CANCEL', p_order_id,
             p_actor_type, p_actor_id
      from order_items oi where oi.order_id = p_order_id;
    else
      -- Cancelled after PACKED: goods are off the shelf, put them back.
      update inventory inv
         set on_hand = inv.on_hand + coalesce(oi.fulfilled_qty, oi.qty)
        from order_items oi
       where oi.order_id = p_order_id and inv.product_id = oi.product_id;

      insert into stock_movements (product_id, delta_on_hand, reason, order_id,
                                   actor_type, actor_id)
      select oi.product_id, coalesce(oi.fulfilled_qty, oi.qty), 'ORDER_RESTOCK',
             p_order_id, p_actor_type, p_actor_id
      from order_items oi where oi.order_id = p_order_id;
    end if;

  elsif p_to_status = 'FAILED' then
    -- Went out, came back.
    update inventory inv
       set on_hand = inv.on_hand + coalesce(oi.fulfilled_qty, oi.qty)
      from order_items oi
     where oi.order_id = p_order_id and inv.product_id = oi.product_id;

    insert into stock_movements (product_id, delta_on_hand, reason, order_id,
                                 actor_type, actor_id)
    select oi.product_id, coalesce(oi.fulfilled_qty, oi.qty), 'ORDER_RESTOCK',
           p_order_id, p_actor_type, p_actor_id
    from order_items oi where oi.order_id = p_order_id;
  end if;

  -- ---- money side effects -------------------------------------------------

  if p_to_status = 'DELIVERED' and v_method = 'COD' then
    update payments
       set status = 'PAID',
           paid_at = now(),
           collected_by_rider_id = coalesce(p_actor_id, p_rider_id)
     where order_id = p_order_id and status = 'PENDING';

    update orders set payment_status = 'PAID' where id = p_order_id;

    -- Add to the rider's cash-expected for today.
    insert into rider_settlements (rider_id, settlement_date, cash_expected_paise)
    values (coalesce(p_rider_id, p_actor_id), current_date, v_total)
    on conflict (rider_id, settlement_date) do update
      set cash_expected_paise = rider_settlements.cash_expected_paise + excluded.cash_expected_paise;
  end if;

  -- ---- commit the status change -------------------------------------------

  perform set_config('app.allow_status_change', 'on', true);

  update orders
     set status   = p_to_status,
         rider_id = coalesce(p_rider_id, rider_id),
         delivered_at = case when p_to_status = 'DELIVERED' then now() else delivered_at end
   where id = p_order_id;

  perform set_config('app.allow_status_change', 'off', true);

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, note)
  values (p_order_id, v_from, p_to_status, p_actor_type, p_actor_id, p_note);

  return jsonb_build_object('ok', true, 'from', v_from, 'to', p_to_status,
                            'total_paise', v_total);
end $$;

-- ================================================================
-- settle_rider_cash — end-of-day reconciliation.
-- ================================================================

create or replace function settle_rider_cash(
  p_rider_id  uuid,
  p_date      date,
  p_deposited_paise int,
  p_note      text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_expected int;
begin
  select cash_expected_paise into v_expected
  from rider_settlements
  where rider_id = p_rider_id and settlement_date = p_date
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SETTLEMENT_ROW');
  end if;

  update rider_settlements
     set cash_deposited_paise = p_deposited_paise,
         status = case when p_deposited_paise = v_expected then 'SETTLED'::settlement_status
                       else 'SHORT'::settlement_status end,
         note = p_note,
         settled_at = now()
   where rider_id = p_rider_id and settlement_date = p_date;

  return jsonb_build_object('ok', true,
                            'expected_paise',  v_expected,
                            'deposited_paise', p_deposited_paise,
                            'difference_paise', p_deposited_paise - v_expected);
end $$;
