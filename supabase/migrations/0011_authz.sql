-- 0011_authz.sql — authorise the order functions from the caller's identity.
--
-- Until now transition_order(), place_order() and settle_rider_cash() trusted
-- their parameters. Any signed-in user could move any order, place an order
-- for any customer, or close out any rider's cash. Every branch below now
-- derives who is calling from auth.uid() and refuses anything that identity
-- is not allowed to do.
--
-- Invariant, relied on by the SQL test suites and by future webhooks:
--   auth.uid() IS NULL  ==>  trusted service context (psql, service_role).
-- In that context p_actor_type / p_actor_id are honoured verbatim. It is safe
-- because EXECUTE on these functions is revoked from anon (0003), and every
-- `authenticated` JWT carries a sub claim.
--
-- Also here, because they are wanted by the same functions:
--   * store_config — single-row store settings (cancel window, open/closed,
--     support phone). Created here rather than later so the cancel window
--     exists when transition_order needs it.
--   * zones.free_delivery_above_paise — optional free-delivery threshold, so
--     the promise on the home banner is something place_order() actually keeps.
--   * Riders can read the customer and address of orders assigned to them.
--   * assign_rider() — assign before dispatch so the rider sees the order.
--   * public.orders joins the realtime publication.

-- ================================================================
-- store_config
-- ================================================================

create table if not exists store_config (
  id                    boolean primary key default true check (id),
  phone                 text,
  whatsapp              text,
  cancel_window_minutes int not null default 5 check (cancel_window_minutes >= 0),
  is_open               boolean not null default true,
  closed_message        text,
  updated_at            timestamptz not null default now()
);

insert into store_config default values on conflict (id) do nothing;

drop trigger if exists store_config_touch on store_config;
create trigger store_config_touch before update on store_config
  for each row execute function touch_updated_at();

alter table store_config enable row level security;

drop policy if exists store_config_read   on store_config;
drop policy if exists store_config_update on store_config;
create policy store_config_read   on store_config for select using (true);
create policy store_config_update on store_config for update
  using (is_admin()) with check (is_admin());

-- ================================================================
-- zones.free_delivery_above_paise
-- ================================================================

alter table zones
  add column if not exists free_delivery_above_paise int
  check (free_delivery_above_paise is null or free_delivery_above_paise >= 0);

-- ================================================================
-- transition_order — same signature, now authorised.
-- ================================================================
--
-- p_actor_type is the hat the caller claims; it is verified against auth:
--   ADMIN     is_admin()                     any legal transition
--   RIDER     current_rider_id() = rider_id  PACKED->OUT_FOR_DELIVERY,
--                                            OUT_FOR_DELIVERY->DELIVERED|FAILED
--   CUSTOMER  current_customer_id() = owner  PLACED|CONFIRMED->CANCELLED,
--                                            inside store_config.cancel_window
--   SYSTEM    service context only
-- p_actor_id is ignored for JWT callers and replaced by the derived id.
--
-- Errors come back as {"ok": false, "error": ...}, never raised: the rider
-- app's offline queue drops an ok:false (already handled elsewhere) and
-- retries a thrown error (transport failure).

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
  v_new_sub    int;
  v_fee        int;
  v_legal      boolean;
  v_uid        uuid := auth.uid();
  v_actor_type actor_type;
  v_actor_id   uuid;
  v_rider      uuid;
  v_window     int;
begin
  select * into v_order from orders where id = p_order_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ORDER');
  end if;

  v_from   := v_order.status;
  v_total  := v_order.total_paise;
  v_method := v_order.payment_method;
  v_fee    := v_order.delivery_fee_paise;

  -- ---- who is calling ------------------------------------------------------

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
    -- SYSTEM claimed by a JWT caller.
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  -- ---- legality --------------------------------------------------------------

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

  -- ---- rider resolution --------------------------------------------------------
  -- The rider on the order is whoever was assigned, unless this call names one.
  -- Dispatch and COD delivery need one; the office marking an order delivered
  -- must not book the cash against itself.

  if p_rider_id is not null
     and not exists (select 1 from riders where id = p_rider_id and is_active) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_RIDER');
  end if;

  v_rider := coalesce(p_rider_id, v_order.rider_id);

  if p_to_status = 'OUT_FOR_DELIVERY' and v_rider is null then
    return jsonb_build_object('ok', false, 'error', 'NO_RIDER');
  end if;
  if p_to_status = 'DELIVERED' and v_method = 'COD' and v_rider is null then
    return jsonb_build_object('ok', false, 'error', 'NO_RIDER');
  end if;

  -- ---- stock side effects -------------------------------------------------

  if p_to_status = 'PACKED' then
    if p_fulfilment is not null then
      update order_items oi
         set fulfilled_qty = least((f->>'fulfilled_qty')::int, oi.qty)
        from jsonb_array_elements(p_fulfilment) f
       where oi.order_id = p_order_id
         and oi.product_id = (f->>'product_id')::uuid;
    end if;
    update order_items set fulfilled_qty = qty
     where order_id = p_order_id and fulfilled_qty is null;

    update inventory inv
       set reserved = inv.reserved - oi.qty,
           on_hand  = inv.on_hand  - oi.fulfilled_qty
      from order_items oi
     where oi.order_id = p_order_id and inv.product_id = oi.product_id;

    insert into stock_movements (product_id, delta_on_hand, delta_reserved,
                                 reason, order_id, actor_type, actor_id)
    select oi.product_id, -oi.fulfilled_qty, -oi.qty, 'ORDER_PACK',
           p_order_id, v_actor_type, v_actor_id
    from order_items oi where oi.order_id = p_order_id;

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
      update inventory inv
         set reserved = inv.reserved - oi.qty
        from order_items oi
       where oi.order_id = p_order_id and inv.product_id = oi.product_id;

      insert into stock_movements (product_id, delta_reserved, reason, order_id,
                                   actor_type, actor_id)
      select oi.product_id, -oi.qty, 'ORDER_CANCEL', p_order_id,
             v_actor_type, v_actor_id
      from order_items oi where oi.order_id = p_order_id;
    else
      update inventory inv
         set on_hand = inv.on_hand + coalesce(oi.fulfilled_qty, oi.qty)
        from order_items oi
       where oi.order_id = p_order_id and inv.product_id = oi.product_id;

      insert into stock_movements (product_id, delta_on_hand, reason, order_id,
                                   actor_type, actor_id)
      select oi.product_id, coalesce(oi.fulfilled_qty, oi.qty), 'ORDER_RESTOCK',
             p_order_id, v_actor_type, v_actor_id
      from order_items oi where oi.order_id = p_order_id;
    end if;

  elsif p_to_status = 'FAILED' then
    update inventory inv
       set on_hand = inv.on_hand + coalesce(oi.fulfilled_qty, oi.qty)
      from order_items oi
     where oi.order_id = p_order_id and inv.product_id = oi.product_id;

    insert into stock_movements (product_id, delta_on_hand, reason, order_id,
                                 actor_type, actor_id)
    select oi.product_id, coalesce(oi.fulfilled_qty, oi.qty), 'ORDER_RESTOCK',
           p_order_id, v_actor_type, v_actor_id
    from order_items oi where oi.order_id = p_order_id;
  end if;

  -- ---- money side effects -------------------------------------------------

  if p_to_status = 'DELIVERED' and v_method = 'COD' then
    update payments
       set status = 'PAID',
           paid_at = now(),
           collected_by_rider_id = v_rider
     where order_id = p_order_id and status = 'PENDING';

    update orders set payment_status = 'PAID' where id = p_order_id;

    insert into rider_settlements (rider_id, settlement_date, cash_expected_paise)
    values (v_rider, current_date, v_total)
    on conflict (rider_id, settlement_date) do update
      set cash_expected_paise = rider_settlements.cash_expected_paise + excluded.cash_expected_paise;
  end if;

  -- ---- commit the status change -------------------------------------------

  perform set_config('app.allow_status_change', 'on', true);

  update orders
     set status   = p_to_status,
         rider_id = coalesce(v_rider, rider_id),
         delivered_at = case when p_to_status = 'DELIVERED' then now() else delivered_at end
   where id = p_order_id;

  perform set_config('app.allow_status_change', 'off', true);

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, note)
  values (p_order_id, v_from, p_to_status, v_actor_type, v_actor_id, p_note);

  return jsonb_build_object('ok', true, 'from', v_from, 'to', p_to_status,
                            'total_paise', v_total);
end $$;

-- ================================================================
-- place_order — same signature; the caller must be the customer or staff.
-- ================================================================
--
-- Adds: NOT_AUTHORIZED, STORE_CLOSED (with the message to show), and the
-- free-delivery threshold. Admin-placed orders (the WhatsApp screen) are
-- recorded as ADMIN in the audit rows; customer-placed ones as before.

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
  v_zone_fee     int;
  v_free_above   int;
  v_fee          int;
  v_min_order    int;
  v_subtotal     int := 0;
  v_total        int;
  v_order_id     uuid;
  v_order_no     text;
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
    v_is_staff := true;                          -- service context
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

  if not v_is_staff then
    select is_open, closed_message into v_open, v_closed_msg from store_config;
    if v_open is not null and not v_open then
      return jsonb_build_object('ok', false, 'error', 'STORE_CLOSED',
                                'message', v_closed_msg);
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_CART');
  end if;

  -- Address must belong to this customer. Never trust the client on this.
  select a.zone_id, z.delivery_fee_paise, z.free_delivery_above_paise, z.min_order_paise
    into v_zone_id, v_zone_fee, v_free_above, v_min_order
  from addresses a
  join zones z on z.id = a.zone_id
  where a.id = p_address_id
    and a.customer_id = p_customer_id
    and z.is_active;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ADDRESS');
  end if;

  -- Two calls inside one transaction (a batch job, a test) must not collide.
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

  -- Lock every inventory row in a deterministic order (product_id) so that
  -- concurrent orders queue instead of deadlocking.
  perform 1
  from inventory inv
  join _req r2 on r2.product_id = inv.product_id
  order by inv.product_id
  for update of inv;

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

  -- The one fee rule. src/lib/pricing.ts mirrors this for the cart preview.
  v_fee := case
    when v_free_above is not null and v_subtotal >= v_free_above then 0
    else v_zone_fee
  end;

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

  update inventory inv
     set reserved = inv.reserved + req.qty
    from _req req
   where inv.product_id = req.product_id;

  insert into stock_movements (product_id, delta_reserved, reason, order_id,
                               actor_type, actor_id)
  select req.product_id, req.qty, 'ORDER_RESERVE', v_order_id,
         v_actor_type, v_actor_id
  from _req req;

  insert into payments (order_id, method, amount_paise, status)
  values (v_order_id, p_payment_method, v_total, 'PENDING');

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id)
  values (v_order_id, null, 'PLACED', v_actor_type, v_actor_id);

  return jsonb_build_object('ok', true,
                            'order_id', v_order_id,
                            'order_no', v_order_no,
                            'total_paise', v_total);
end $$;

-- ================================================================
-- settle_rider_cash — staff only.
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
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

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

-- ================================================================
-- Riders read the customer and address of their assigned live orders.
-- ================================================================
--
-- Extend the single SELECT policy rather than adding a second one: two
-- permissive policies on the same table is the Security Advisor finding that
-- 0005 removed. Limited to PACKED / OUT_FOR_DELIVERY so a rider cannot browse
-- past customers, and written with (select ...) initplans as in 0005.
--
-- customers.insert/update tighten to staff only: the sanctioned path for a
-- customer is link_current_user_to_customer() (which verifies the phone came
-- from the JWT) and update_my_profile() (0012). A direct row write let a
-- customer change their own phone or auth_uid.

drop policy if exists cust_select on customers;
create policy cust_select on customers for select using (
  auth_uid = (select auth.uid())
  or is_admin()
  or exists (
       select 1 from orders o
       where o.customer_id = customers.id
         and o.rider_id = (select current_rider_id())
         and o.status in ('PACKED', 'OUT_FOR_DELIVERY'))
);

drop policy if exists cust_insert on customers;
create policy cust_insert on customers for insert with check (is_admin());

drop policy if exists cust_update on customers;
create policy cust_update on customers for update
  using (is_admin()) with check (is_admin());

drop policy if exists addr_select on addresses;
create policy addr_select on addresses for select using (
  customer_id = current_customer_id()
  or is_admin()
  or exists (
       select 1 from orders o
       where o.address_id = addresses.id
         and o.rider_id = (select current_rider_id())
         and o.status in ('PACKED', 'OUT_FOR_DELIVERY'))
);

-- ================================================================
-- assign_rider — staff assigns a rider at any point before dispatch.
-- ================================================================
--
-- Until now a rider was only attached at OUT_FOR_DELIVERY, so nothing was
-- visible in the rider app until the office pressed "Send out". Assigning at
-- PACKED lets the rider see the order, then tap "Picked up" themselves.
-- rider_id is not the status column, so the guard trigger permits the update.

create or replace function assign_rider(
  p_order_id uuid,
  p_rider_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   orders%rowtype;
  v_actor   uuid;
  v_name    text;
begin
  if auth.uid() is not null and not is_admin() then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ORDER');
  end if;
  if v_order.status in ('DELIVERED', 'CANCELLED', 'FAILED') then
    return jsonb_build_object('ok', false, 'error', 'ORDER_CLOSED');
  end if;

  select name into v_name from riders where id = p_rider_id and is_active;
  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_RIDER');
  end if;

  select id into v_actor from admin_users where auth_uid = auth.uid();

  update orders set rider_id = p_rider_id where id = p_order_id;

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, note)
  values (p_order_id, v_order.status, v_order.status, 'ADMIN', v_actor, 'RIDER_ASSIGNED');

  return jsonb_build_object('ok', true, 'rider_id', p_rider_id, 'rider_name', v_name);
end $$;

revoke all on function assign_rider(uuid, uuid) from public, anon;
grant execute on function assign_rider(uuid, uuid) to authenticated;

-- ================================================================
-- Realtime: the tracking screen and the admin board subscribe to orders.
-- ================================================================
--
-- No earlier migration added the table to the publication, so those
-- subscriptions never fired on a fresh project. Idempotent, and a no-op on
-- plain Postgres where the publication does not exist.

do $$
declare v_all boolean;
begin
  select puballtables into v_all from pg_publication where pubname = 'supabase_realtime';
  if v_all is null then
    raise notice 'no supabase_realtime publication here (local database); skipping';
    return;
  end if;
  if v_all then
    return;   -- FOR ALL TABLES already covers orders
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
