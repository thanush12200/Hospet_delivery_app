-- 0017_hardening.sql — the essential fixes from the app-flow audit (PR #3).
--
-- Findings taken, in the smallest shape that closes them:
--   F01  idempotent placement: orders.client_key, same key -> same order
--   F13  deleted addresses cannot be ordered to
--   F06  orders snapshot the delivery address and the promised time
--   F09  packing with nothing packed is refused (cancel instead)
--   F03  a failed delivery does not restock by itself; staff confirm the
--        return (admin_receive_return) and stock moves once
--   F02  the rider records what was actually collected; UPI stays pending
--        until staff mark it received (admin_verify_payment); a cash order
--        paid by UPI never becomes rider cash
--   F12  a delivery after settlement reopens the day; business date in
--        Asia/Kolkata
--   F08  a refused stock update fails the product save / the import row
--
-- Signatures: place_order gains a trailing p_client_key (old 6-argument
-- callers keep working through the default); transition_order is unchanged.

-- ================================================================
-- columns
-- ================================================================

alter table orders
  add column if not exists client_key        uuid,
  add column if not exists promised_at       timestamptz,
  add column if not exists delivery_snapshot jsonb,
  add column if not exists returned_at       timestamptz;

create unique index if not exists orders_client_key_idx on orders (customer_id, client_key) where client_key is not null;

alter table payments
  add column if not exists reported_method    payment_method,
  add column if not exists reported_reference text,
  add column if not exists reported_at        timestamptz,
  add column if not exists verified_by        uuid,
  add column if not exists verified_at        timestamptz;

-- The business day for cash: the store's clock, not the server's.
create or replace function business_date() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- ================================================================
-- place_order — idempotent, snapshotting, deleted-address-safe
-- ================================================================

drop function if exists place_order(uuid, uuid, jsonb, payment_method, int, text);

create or replace function place_order(
  p_customer_id     uuid,
  p_address_id      uuid,
  p_items           jsonb,
  p_payment_method  payment_method,
  p_client_total_paise int default null,
  p_note            text default null,
  p_client_key      uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zone_id      uuid;
  v_zone_name    text;
  v_zone_fee     int;
  v_free_above   int;
  v_fee          int;
  v_min_order    int;
  v_sla          int;
  v_addr         addresses%rowtype;
  v_phone        text;
  v_subtotal     int := 0;
  v_total        int;
  v_order_id     uuid;
  v_order_no     text;
  v_existing     record;
  v_shortages    jsonb := '[]'::jsonb;
  v_uid          uuid := auth.uid();
  v_actor_type   actor_type := 'CUSTOMER';
  v_actor_id     uuid := p_customer_id;
  v_is_staff     boolean := false;
  v_open         boolean;
  v_closed_msg   text;
  r              record;
begin
  -- ---- who is calling ------------------------------------------------------

  if v_uid is null then
    v_is_staff := true;
  elsif p_customer_id = current_customer_id() then
    v_actor_type := 'CUSTOMER';
    v_actor_id   := p_customer_id;
  elsif is_admin() then
    v_is_staff   := true;
    v_actor_type := 'ADMIN';
    select id into v_actor_id from admin_users where auth_uid = v_uid;
  else
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  -- ---- replay: the same attempt returns the same order ---------------------
  -- A lost response makes the customer tap again. With the key the retry is
  -- the same order, not a second reservation.

  if p_client_key is not null then
    select id, order_no, total_paise into v_existing
      from orders where client_key = p_client_key and customer_id = p_customer_id;
    if found then
      return jsonb_build_object('ok', true, 'order_id', v_existing.id,
                                'order_no', v_existing.order_no,
                                'total_paise', v_existing.total_paise, 'replayed', true);
    end if;
  end if;

  if not v_is_staff then
    select is_open, closed_message into v_open, v_closed_msg from store_config;
    if v_open is not null and not v_open then
      return jsonb_build_object('ok', false, 'error', 'STORE_CLOSED', 'message', v_closed_msg);
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_CART');
  end if;

  -- Address must belong to this customer, be live, and be in an active zone.
  select a.* into v_addr from addresses a
   where a.id = p_address_id and a.customer_id = p_customer_id and a.deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ADDRESS');
  end if;
  select z.id, z.name, z.delivery_fee_paise, z.free_delivery_above_paise, z.min_order_paise, z.sla_minutes
    into v_zone_id, v_zone_name, v_zone_fee, v_free_above, v_min_order, v_sla
  from zones z where z.id = v_addr.zone_id and z.is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ADDRESS');
  end if;
  select phone into v_phone from customers where id = p_customer_id;

  if to_regclass('pg_temp._req') is not null then
    drop table _req;
  end if;
  create temp table _req on commit drop as
  select (i->>'product_id')::uuid as product_id,
         (i->>'qty')::int         as qty
  from jsonb_array_elements(p_items) i;

  if exists (select 1 from _req where qty is null or qty <= 0) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_QTY');
  end if;
  if (select count(*) from _req) <> (select count(distinct product_id) from _req) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_QTY');
  end if;

  perform 1
  from inventory inv
  join _req r2 on r2.product_id = inv.product_id
  order by inv.product_id
  for update of inv;

  for r in
    select req.product_id, req.qty, p.name, p.is_active, p.mrp_paise,
           coalesce(inv.on_hand - inv.reserved, 0) as available
    from _req req
    left join products  p   on p.id   = req.product_id
    left join inventory inv on inv.product_id = req.product_id
  loop
    if r.name is null or not r.is_active then
      return jsonb_build_object('ok', false, 'error', 'PRODUCT_UNAVAILABLE', 'product_id', r.product_id);
    end if;
    if r.available < r.qty then
      v_shortages := v_shortages || jsonb_build_object(
        'product_id', r.product_id, 'name', r.name,
        'requested', r.qty, 'available', greatest(r.available, 0));
    end if;
    v_subtotal := v_subtotal + (r.mrp_paise * r.qty);
  end loop;

  if jsonb_array_length(v_shortages) > 0 then
    return jsonb_build_object('ok', false, 'error', 'OUT_OF_STOCK', 'shortages', v_shortages);
  end if;

  if v_subtotal < v_min_order then
    return jsonb_build_object('ok', false, 'error', 'BELOW_MIN_ORDER',
                              'min_order_paise', v_min_order, 'subtotal_paise', v_subtotal);
  end if;

  v_fee := case
    when v_free_above is not null and v_subtotal >= v_free_above then 0
    else v_zone_fee
  end;
  v_total := v_subtotal + v_fee;

  if p_client_total_paise is not null and p_client_total_paise <> v_total then
    return jsonb_build_object('ok', false, 'error', 'PRICE_MISMATCH',
                              'server_total_paise', v_total, 'client_total_paise', p_client_total_paise);
  end if;

  begin
    insert into orders (customer_id, address_id, zone_id, status,
                        subtotal_paise, delivery_fee_paise, total_paise,
                        payment_method, note, client_key, promised_at, delivery_snapshot)
    values (p_customer_id, p_address_id, v_zone_id, 'PLACED',
            v_subtotal, v_fee, v_total, p_payment_method, p_note, p_client_key,
            now() + make_interval(mins => coalesce(v_sla, 15)),
            jsonb_build_object(
              'line1', v_addr.line1, 'landmark', v_addr.landmark, 'label', v_addr.label,
              'lat', v_addr.lat, 'lng', v_addr.lng,
              'zone_id', v_zone_id, 'zone_name', v_zone_name, 'phone', v_phone))
    returning id, order_no into v_order_id, v_order_no;
  exception when unique_violation then
    -- Two identical attempts raced; the first one won. Return it.
    select id, order_no, total_paise into v_existing
      from orders where client_key = p_client_key and customer_id = p_customer_id;
    return jsonb_build_object('ok', true, 'order_id', v_existing.id,
                              'order_no', v_existing.order_no,
                              'total_paise', v_existing.total_paise, 'replayed', true);
  end;

  insert into order_items (order_id, product_id, qty, unit_mrp_paise, line_total_paise, product_name)
  select v_order_id, req.product_id, req.qty, p.mrp_paise, p.mrp_paise * req.qty, p.name
  from _req req join products p on p.id = req.product_id;

  update inventory inv set reserved = inv.reserved + req.qty
    from _req req where inv.product_id = req.product_id;

  insert into stock_movements (product_id, delta_reserved, reason, order_id, actor_type, actor_id)
  select req.product_id, req.qty, 'ORDER_RESERVE', v_order_id, v_actor_type, v_actor_id
  from _req req;

  insert into payments (order_id, method, amount_paise, status)
  values (v_order_id, p_payment_method, v_total, 'PENDING');

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id)
  values (v_order_id, null, 'PLACED', v_actor_type, v_actor_id);

  return jsonb_build_object('ok', true, 'order_id', v_order_id, 'order_no', v_order_no,
                            'total_paise', v_total);
end $$;

revoke all on function place_order(uuid, uuid, jsonb, payment_method, int, text, uuid) from public, anon;
grant execute on function place_order(uuid, uuid, jsonb, payment_method, int, text, uuid) to authenticated;

-- ================================================================
-- transition_order — nothing-packed guard, no auto-restock on FAILED,
-- collection by what was actually received, settlement reopen
-- ================================================================

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
  v_order      orders%rowtype;
  v_from       order_status;
  v_total      int;
  v_method     payment_method;
  v_collected  payment_method;
  v_new_sub    int;
  v_fee        int;
  v_legal      boolean;
  v_uid        uuid := auth.uid();
  v_actor_type actor_type;
  v_actor_id   uuid;
  v_rider      uuid;
  v_window     int;
  v_date       date := business_date();
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ORDER');
  end if;

  v_from   := v_order.status;
  v_total  := v_order.total_paise;
  v_method := v_order.payment_method;
  v_fee    := v_order.delivery_fee_paise;

  if v_uid is null then
    v_actor_type := p_actor_type;
    v_actor_id   := p_actor_id;
  elsif p_actor_type = 'ADMIN' then
    if not is_admin() then
      return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
    end if;
    select id into v_actor_id from admin_users where auth_uid = v_uid;
    v_actor_type := 'ADMIN';
  elsif p_actor_type = 'RIDER' then
    v_actor_id := current_rider_id();
    if v_actor_id is null or v_order.rider_id is distinct from v_actor_id then
      return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
    end if;
    if not ((v_from = 'PACKED' and p_to_status = 'OUT_FOR_DELIVERY') or
            (v_from = 'OUT_FOR_DELIVERY' and p_to_status in ('DELIVERED', 'FAILED'))) then
      return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
    end if;
    v_actor_type := 'RIDER';
  elsif p_actor_type = 'CUSTOMER' then
    v_actor_id := current_customer_id();
    if v_actor_id is null or v_order.customer_id <> v_actor_id
       or p_to_status <> 'CANCELLED' or v_from not in ('PLACED', 'CONFIRMED') then
      return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
    end if;
    select cancel_window_minutes into v_window from store_config;
    if now() > v_order.placed_at + make_interval(mins => coalesce(v_window, 5)) then
      return jsonb_build_object('ok', false, 'error', 'CANCEL_WINDOW_CLOSED',
                                'window_minutes', coalesce(v_window, 5));
    end if;
    v_actor_type := 'CUSTOMER';
  else
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  v_legal := case v_from
    when 'PLACED'           then p_to_status in ('CONFIRMED','CANCELLED')
    when 'CONFIRMED'        then p_to_status in ('PICKING','CANCELLED')
    when 'PICKING'          then p_to_status in ('PACKED','CANCELLED')
    when 'PACKED'           then p_to_status in ('OUT_FOR_DELIVERY','CANCELLED')
    when 'OUT_FOR_DELIVERY' then p_to_status in ('DELIVERED','FAILED')
    else false
  end;
  if not v_legal then
    return jsonb_build_object('ok', false, 'error', 'ILLEGAL_TRANSITION', 'from', v_from, 'to', p_to_status);
  end if;

  if p_rider_id is not null
     and not exists (select 1 from riders where id = p_rider_id and is_active) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_RIDER');
  end if;
  v_rider := coalesce(p_rider_id, v_order.rider_id);
  if p_to_status = 'OUT_FOR_DELIVERY' and v_rider is null then
    return jsonb_build_object('ok', false, 'error', 'NO_RIDER');
  end if;

  -- What was actually collected at the door: the rider's report when there
  -- is one, else the method chosen at checkout.
  select coalesce(reported_method, method) into v_collected
    from payments where order_id = p_order_id and status = 'PENDING';
  v_collected := coalesce(v_collected, v_method);

  if p_to_status = 'DELIVERED' and v_collected = 'COD' and v_rider is null then
    return jsonb_build_object('ok', false, 'error', 'NO_RIDER');
  end if;

  -- ---- stock side effects -------------------------------------------------

  if p_to_status = 'PACKED' then
    if p_fulfilment is not null then
      if exists (select 1 from jsonb_array_elements(p_fulfilment) f
                 where coalesce((f->>'fulfilled_qty')::int, -1) < 0) then
        return jsonb_build_object('ok', false, 'error', 'INVALID_QTY');
      end if;
      update order_items oi
         set fulfilled_qty = least((f->>'fulfilled_qty')::int, oi.qty)
        from jsonb_array_elements(p_fulfilment) f
       where oi.order_id = p_order_id and oi.product_id = (f->>'product_id')::uuid;
    end if;
    update order_items set fulfilled_qty = qty
     where order_id = p_order_id and fulfilled_qty is null;

    -- Nothing to send out: that is a cancellation, not a delivery-fee-only order.
    if not exists (select 1 from order_items where order_id = p_order_id and fulfilled_qty > 0) then
      update order_items set fulfilled_qty = null where order_id = p_order_id;
      return jsonb_build_object('ok', false, 'error', 'NOTHING_PACKED');
    end if;

    update inventory inv
       set reserved = inv.reserved - oi.qty,
           on_hand  = inv.on_hand  - oi.fulfilled_qty
      from order_items oi
     where oi.order_id = p_order_id and inv.product_id = oi.product_id;

    insert into stock_movements (product_id, delta_on_hand, delta_reserved, reason, order_id, actor_type, actor_id)
    select oi.product_id, -oi.fulfilled_qty, -oi.qty, 'ORDER_PACK', p_order_id, v_actor_type, v_actor_id
    from order_items oi where oi.order_id = p_order_id;

    select coalesce(sum(unit_mrp_paise * fulfilled_qty), 0) into v_new_sub
      from order_items where order_id = p_order_id;
    if v_new_sub <> (v_total - v_fee) then
      v_total := v_new_sub + v_fee;
      update orders set subtotal_paise = v_new_sub, total_paise = v_total where id = p_order_id;
      update payments set amount_paise = v_total where order_id = p_order_id and status = 'PENDING';
      update order_items set line_total_paise = unit_mrp_paise * fulfilled_qty where order_id = p_order_id;
    end if;

  elsif p_to_status = 'CANCELLED' then
    if v_from in ('PLACED','CONFIRMED','PICKING') then
      update inventory inv set reserved = inv.reserved - oi.qty
        from order_items oi
       where oi.order_id = p_order_id and inv.product_id = oi.product_id;
      insert into stock_movements (product_id, delta_reserved, reason, order_id, actor_type, actor_id)
      select oi.product_id, -oi.qty, 'ORDER_CANCEL', p_order_id, v_actor_type, v_actor_id
      from order_items oi where oi.order_id = p_order_id;
    else
      -- Cancelled after packing, at the store: the goods are on the shelf again.
      update inventory inv set on_hand = inv.on_hand + coalesce(oi.fulfilled_qty, oi.qty)
        from order_items oi
       where oi.order_id = p_order_id and inv.product_id = oi.product_id;
      insert into stock_movements (product_id, delta_on_hand, reason, order_id, actor_type, actor_id)
      select oi.product_id, coalesce(oi.fulfilled_qty, oi.qty), 'ORDER_RESTOCK', p_order_id, v_actor_type, v_actor_id
      from order_items oi where oi.order_id = p_order_id;
    end if;

  elsif p_to_status = 'FAILED' then
    -- The goods are on a bike somewhere. Nothing is sellable until the store
    -- has them back and has looked at them: admin_receive_return().
    null;
  end if;

  -- ---- money side effects -------------------------------------------------

  if p_to_status = 'DELIVERED' then
    if v_collected = 'COD' then
      update payments
         set status = 'PAID', paid_at = now(), collected_by_rider_id = v_rider,
             reported_method = coalesce(reported_method, 'COD'), reported_at = coalesce(reported_at, now())
       where order_id = p_order_id and status = 'PENDING';
      update orders set payment_status = 'PAID' where id = p_order_id;

      insert into rider_settlements (rider_id, settlement_date, cash_expected_paise)
      values (v_rider, v_date, v_total)
      on conflict (rider_id, settlement_date) do update
        set cash_expected_paise = rider_settlements.cash_expected_paise + excluded.cash_expected_paise,
            -- Cash arriving after the day was closed reopens it.
            status = 'OPEN',
            note = case when rider_settlements.status <> 'OPEN'
                        then coalesce(rider_settlements.note || ' | ', '') || 'reopened: delivery after settlement'
                        else rider_settlements.note end;
    else
      -- UPI to the store's QR: the rider reports it, staff confirm the credit.
      update payments
         set reported_method = 'UPI', reported_at = coalesce(reported_at, now()),
             collected_by_rider_id = v_rider
       where order_id = p_order_id and status = 'PENDING';
    end if;
  end if;

  -- ---- commit the status change -------------------------------------------

  perform set_config('app.allow_status_change', 'on', true);
  update orders
     set status = p_to_status,
         rider_id = coalesce(v_rider, rider_id),
         delivered_at = case when p_to_status = 'DELIVERED' then now() else delivered_at end
   where id = p_order_id;
  perform set_config('app.allow_status_change', 'off', true);

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, note)
  values (p_order_id, v_from, p_to_status, v_actor_type, v_actor_id, p_note);

  return jsonb_build_object('ok', true, 'from', v_from, 'to', p_to_status, 'total_paise', v_total);
end $$;

-- ================================================================
-- rider_deliver — deliver with what was actually collected
-- ================================================================

create or replace function rider_deliver(
  p_order_id  uuid,
  p_method    payment_method,
  p_reference text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rider uuid := current_rider_id(); v_owner uuid;
begin
  if auth.uid() is not null then
    if v_rider is null then
      return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
    end if;
    select rider_id into v_owner from orders where id = p_order_id;
    if v_owner is distinct from v_rider then
      return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
    end if;
  end if;
  update payments
     set reported_method = p_method,
         reported_reference = nullif(left(btrim(coalesce(p_reference, '')), 64), ''),
         reported_at = now()
   where order_id = p_order_id and status = 'PENDING';
  return transition_order(p_order_id, 'DELIVERED', 'RIDER', v_rider, null, null, null);
end $$;

-- ================================================================
-- admin_verify_payment — staff saw the UPI credit
-- ================================================================

create or replace function admin_verify_payment(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_actor uuid; v_status payment_status;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  select status into v_status from payments where order_id = p_order_id;
  if v_status is null then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ORDER');
  end if;
  if v_status = 'PAID' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  select id into v_actor from admin_users where auth_uid = auth.uid();
  update payments
     set status = 'PAID', paid_at = coalesce(paid_at, now()),
         verified_by = v_actor, verified_at = now(),
         reported_method = coalesce(reported_method, 'UPI')
   where order_id = p_order_id;
  update orders set payment_status = 'PAID' where id = p_order_id;
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, note)
  select id, status, status, 'ADMIN', v_actor, 'PAYMENT_VERIFIED' from orders where id = p_order_id;
  return jsonb_build_object('ok', true);
end $$;

-- ================================================================
-- admin_receive_return — the failed delivery came back to the store
-- ================================================================
--
-- p_items: optional [{product_id, good_qty}]; omitted lines count as fully
-- returned in good condition. Only good units become sellable, once.

create or replace function admin_receive_return(p_order_id uuid, p_items jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_order orders%rowtype; v_actor uuid; v_good int; v_bad int := 0; r record;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ORDER');
  end if;
  if v_order.status <> 'FAILED' then
    return jsonb_build_object('ok', false, 'error', 'NOT_FAILED');
  end if;
  if v_order.returned_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RETURNED');
  end if;
  select id into v_actor from admin_users where auth_uid = auth.uid();

  for r in select oi.product_id, coalesce(oi.fulfilled_qty, oi.qty) as sent from order_items oi
            where oi.order_id = p_order_id loop
    v_good := r.sent;
    if p_items is not null then
      select least(greatest((f->>'good_qty')::int, 0), r.sent) into v_good
        from jsonb_array_elements(p_items) f
       where (f->>'product_id')::uuid = r.product_id;
      v_good := coalesce(v_good, r.sent);
    end if;
    v_bad := v_bad + (r.sent - v_good);
    if v_good > 0 then
      update inventory set on_hand = on_hand + v_good where product_id = r.product_id;
      insert into stock_movements (product_id, delta_on_hand, reason, order_id, actor_type, actor_id)
      values (r.product_id, v_good, 'ORDER_RETURN', p_order_id, 'ADMIN', v_actor);
    end if;
  end loop;

  update orders set returned_at = now() where id = p_order_id;
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, note)
  values (p_order_id, 'FAILED', 'FAILED', 'ADMIN', v_actor,
          'RETURN_RECEIVED' || case when v_bad > 0 then ' (' || v_bad || ' unit(s) not resellable)' else '' end);
  return jsonb_build_object('ok', true, 'not_resellable', v_bad);
end $$;

revoke all on function
  rider_deliver(uuid, payment_method, text),
  admin_verify_payment(uuid),
  admin_receive_return(uuid, jsonb)
  from public, anon;
grant execute on function
  rider_deliver(uuid, payment_method, text),
  admin_verify_payment(uuid),
  admin_receive_return(uuid, jsonb)
  to authenticated;

-- ================================================================
-- F08: a refused stock update fails the save, not just the stock
-- ================================================================

create or replace function admin_upsert_product(
  p_id          uuid,
  p_category_id uuid,
  p_name        text,
  p_unit_label  text,
  p_mrp_paise   int,
  p_name_kn     text default null,
  p_brand       text default null,
  p_image_url   text default null,
  p_is_active   boolean default true,
  p_on_hand     int default null,
  p_description text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stock jsonb;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_mrp_paise is null or p_mrp_paise <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PRICE');
  end if;
  if p_on_hand is not null and p_on_hand < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STOCK');
  end if;

  if p_id is null then
    insert into products (category_id, name, name_kn, brand, unit_label, mrp_paise, image_url, is_active, description)
    values (p_category_id, p_name, p_name_kn, p_brand, p_unit_label, p_mrp_paise, p_image_url, p_is_active,
            nullif(btrim(coalesce(p_description, '')), ''))
    returning id into v_id;
    insert into inventory (product_id, on_hand) values (v_id, coalesce(p_on_hand, 0));
  else
    -- Stock first: a refusal must leave the product untouched too.
    if p_on_hand is not null then
      v_stock := admin_adjust_stock(p_id, p_on_hand, 'ADJUST');
      if not (v_stock->>'ok')::boolean then
        return jsonb_build_object('ok', false, 'error', v_stock->>'error', 'reserved', v_stock->'reserved');
      end if;
    end if;
    update products set
      category_id = p_category_id, name = p_name, name_kn = p_name_kn, brand = p_brand,
      unit_label = p_unit_label, mrp_paise = p_mrp_paise,
      image_url = coalesce(p_image_url, image_url), is_active = p_is_active,
      description = nullif(btrim(coalesce(p_description, '')), '')
    where id = p_id returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'NO_SUCH_PRODUCT');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function admin_bulk_upsert_products(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; idx int := 0; results jsonb := '[]'::jsonb;
  v_cat_id uuid; v_prod_id uuid; v_name text; v_unit text; v_mrp int; v_stock int;
  v_catname text; v_cat_kn text; v_desc text; v_image text; v_action text; v_res jsonb;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'EXPECTED_ARRAY');
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    v_name    := nullif(btrim(coalesce(r->>'name', '')), '');
    v_unit    := nullif(btrim(coalesce(r->>'unit', '')), '');
    v_catname := nullif(btrim(coalesce(r->>'category', '')), '');
    v_cat_kn  := nullif(btrim(coalesce(r->>'category_kn', '')), '');
    v_desc    := nullif(btrim(coalesce(r->>'description', '')), '');
    v_image   := nullif(btrim(coalesce(r->>'image_url', '')), '');
    v_mrp     := nullif(r->>'mrp_paise', '')::int;
    v_stock   := nullif(r->>'stock', '')::int;

    if v_name is null then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Name is required'); continue;
    end if;
    if v_mrp is null or v_mrp <= 0 then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'MRP must be greater than zero'); continue;
    end if;
    if v_stock is not null and v_stock < 0 then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Stock cannot be negative'); continue;
    end if;
    if v_image is not null and v_image !~ '^https?://' then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'image_url must start with http(s)://'); continue;
    end if;
    if v_unit is null then v_unit := '1 pc'; end if;
    if v_catname is null then v_catname := 'General'; end if;

    select id into v_cat_id from categories where lower(name) = lower(v_catname) limit 1;
    if v_cat_id is null then
      insert into categories (name, name_kn, sort_order) values (v_catname, v_cat_kn, 100) returning id into v_cat_id;
    elsif v_cat_kn is not null then
      update categories set name_kn = v_cat_kn where id = v_cat_id and name_kn is distinct from v_cat_kn;
    end if;

    select id into v_prod_id from products
     where lower(name) = lower(v_name) and lower(unit_label) = lower(v_unit) limit 1;

    if v_prod_id is null then
      insert into products (category_id, name, name_kn, brand, unit_label, mrp_paise, is_active, description, image_url)
      values (v_cat_id, v_name, nullif(btrim(coalesce(r->>'name_kn','')), ''), nullif(btrim(coalesce(r->>'brand','')), ''),
              v_unit, v_mrp, coalesce((r->>'is_active')::boolean, true), v_desc, v_image)
      returning id into v_prod_id;
      insert into inventory (product_id, on_hand) values (v_prod_id, coalesce(v_stock, 0));
      v_action := 'created';
    else
      -- Stock first, so a refused count leaves the row's other fields alone.
      if v_stock is not null then
        v_res := admin_adjust_stock(v_prod_id, v_stock, 'IMPORT');
        if not (v_res->>'ok')::boolean then
          results := results || jsonb_build_object('row', idx, 'status', 'error', 'name', v_name,
            'message', 'Stock ' || v_stock || ' is below the ' || coalesce(v_res->>'reserved', '?') || ' unit(s) reserved for live orders');
          continue;
        end if;
      end if;
      update products set
        category_id = v_cat_id,
        name_kn     = coalesce(nullif(btrim(coalesce(r->>'name_kn','')), ''), name_kn),
        brand       = coalesce(nullif(btrim(coalesce(r->>'brand','')), ''), brand),
        mrp_paise   = v_mrp,
        is_active   = coalesce((r->>'is_active')::boolean, is_active),
        description = coalesce(v_desc, description),
        image_url   = coalesce(v_image, image_url)
      where id = v_prod_id;
      v_action := 'updated';
    end if;

    results := results || jsonb_build_object('row', idx, 'status', v_action, 'id', v_prod_id, 'name', v_name);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created', (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'created'),
    'updated', (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'updated'),
    'errors',  (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'error'),
    'results', results);
end $$;

-- Staff address entry follows the same soft-delete rule as the customer's.
create or replace function admin_add_address(
  p_customer_id uuid, p_zone_id uuid, p_line1 text,
  p_landmark text default null,
  p_lat double precision default null, p_lng double precision default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_first boolean;
begin
  if auth.uid() is not null and not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from zones where id = p_zone_id and is_active) then
    raise exception 'inactive zone' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from customers where id = p_customer_id for update;
  select not exists (select 1 from addresses where customer_id = p_customer_id and deleted_at is null) into v_first;
  insert into addresses (customer_id, zone_id, line1, landmark, lat, lng, is_default)
  values (p_customer_id, p_zone_id, p_line1, p_landmark, p_lat, p_lng, v_first)
  returning id into v_id;
  return v_id;
end $$;
