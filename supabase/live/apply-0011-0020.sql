-- FAA: migrations 0011-0020 in one paste for the Supabase SQL editor.
-- Safe to run more than once. Generated from supabase/migrations/ by scripts/live-bundle.sh.

-- ======================= supabase/migrations/0011_authz.sql =======================
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

-- ======================= supabase/migrations/0012_profile_addresses.sql =======================
-- 0012_profile_addresses.sql — the customer's own profile and address book.
--
-- Until now an address could only be added (at checkout), never edited,
-- deleted, labelled or made the default; is_default existed but nothing set
-- it. A customer's name was captured once at first login and frozen.
--
-- Addresses are soft-deleted: orders.address_id must keep pointing at the
-- address the order was delivered to, so a delete sets deleted_at and the
-- client filters. Exactly one live default per customer is enforced by a
-- partial unique index, not just by the functions.
--
-- Writes on customers/addresses go through the functions below. Direct row
-- writes by customers are closed (customers in 0011, addresses here): the
-- functions validate the zone, keep the default invariant and never let a
-- customer touch phone/auth_uid.

-- ================================================================
-- addresses: label, soft delete, one default
-- ================================================================

alter table addresses
  add column if not exists label text not null default 'HOME'
    check (label in ('HOME', 'WORK', 'OTHER')),
  add column if not exists deleted_at timestamptz;

-- Repair before constraining: keep the newest default where there are
-- several, and give customers with none their newest address.
with ranked as (
  select id, row_number() over (partition by customer_id order by created_at desc, id) as rn
  from addresses where is_default and deleted_at is null
)
update addresses a set is_default = false
from ranked r where a.id = r.id and r.rn > 1;

with newest as (
  select distinct on (customer_id) id
  from addresses
  where deleted_at is null
    and customer_id not in (select customer_id from addresses where is_default and deleted_at is null)
  order by customer_id, created_at desc, id
)
update addresses a set is_default = true from newest n where a.id = n.id;

create unique index if not exists addresses_one_default_idx
  on addresses (customer_id) where is_default and deleted_at is null;

create index if not exists addresses_customer_live_idx
  on addresses (customer_id) where deleted_at is null;

-- ================================================================
-- Profile
-- ================================================================

create or replace function update_my_profile(p_name text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cust uuid := current_customer_id(); v_name text := nullif(trim(p_name), '');
begin
  if v_cust is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if v_name is null or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  end if;
  update customers set name = v_name where id = v_cust;
  return jsonb_build_object('ok', true, 'name', v_name);
end $$;

-- ================================================================
-- link_current_user_to_customer — phone from the JWT, not the client.
-- ================================================================
--
-- The phone number used to come from the request body, so a signed-in user
-- could adopt any unlinked customer record by naming its number. Supabase
-- puts the verified number in the JWT's `phone` claim (digits, no +); that is
-- the one that counts. The parameter remains only as a fallback for staff
-- accounts, which sign in by email and carry no phone claim.

create or replace function link_current_user_to_customer(
  p_phone text,
  p_name  text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_uid   uuid := auth.uid();
  v_jwt   text := nullif(auth.jwt() ->> 'phone', '');
  v_phone text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from customers where auth_uid = v_uid;
  if v_id is not null then return v_id; end if;

  if v_jwt is not null then
    v_phone := '+' || regexp_replace(v_jwt, '\D', '', 'g');
  elsif is_admin() then
    v_phone := p_phone;
  else
    raise exception 'no verified phone on this session' using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from customers where phone = v_phone;
  if v_id is not null then
    update customers
       set auth_uid = v_uid, name = coalesce(name, nullif(trim(p_name), ''))
     where id = v_id and auth_uid is null;
    if not found then
      raise exception 'phone already linked to another account'
        using errcode = 'unique_violation';
    end if;
    return v_id;
  end if;

  insert into customers (phone, name, auth_uid)
  values (v_phone, nullif(trim(p_name), ''), v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- ================================================================
-- Address book
-- ================================================================

create or replace function upsert_my_address(
  p_id         uuid,
  p_zone_id    uuid,
  p_line1      text,
  p_landmark   text default null,
  p_label      text default 'HOME',
  p_is_default boolean default false,
  p_lat        double precision default null,
  p_lng        double precision default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cust   uuid := current_customer_id();
  v_id     uuid;
  v_first  boolean;
  v_label  text := upper(coalesce(p_label, 'HOME'));
  v_line1  text := nullif(trim(p_line1), '');
begin
  if v_cust is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if v_line1 is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ADDRESS');
  end if;
  if v_label not in ('HOME', 'WORK', 'OTHER') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LABEL');
  end if;
  if not exists (select 1 from zones where id = p_zone_id and is_active) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ZONE');
  end if;

  -- Serialise per customer so two saves cannot both become the default.
  perform 1 from customers where id = v_cust for update;

  select not exists (
    select 1 from addresses where customer_id = v_cust and deleted_at is null
      and (p_id is null or id <> p_id)
  ) into v_first;

  if p_is_default or v_first then
    update addresses set is_default = false
     where customer_id = v_cust and is_default and deleted_at is null
       and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into addresses (customer_id, zone_id, line1, landmark, label, is_default, lat, lng)
    values (v_cust, p_zone_id, v_line1, nullif(trim(p_landmark), ''), v_label,
            p_is_default or v_first, p_lat, p_lng)
    returning id into v_id;
  else
    update addresses
       set zone_id    = p_zone_id,
           line1      = v_line1,
           landmark   = nullif(trim(p_landmark), ''),
           label      = v_label,
           is_default = is_default or p_is_default or v_first,
           lat        = p_lat,
           lng        = p_lng
     where id = p_id and customer_id = v_cust and deleted_at is null
     returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ADDRESS');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function set_default_address(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cust uuid := current_customer_id();
begin
  if v_cust is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  perform 1 from customers where id = v_cust for update;
  if not exists (select 1 from addresses
                 where id = p_id and customer_id = v_cust and deleted_at is null) then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ADDRESS');
  end if;
  update addresses set is_default = false
   where customer_id = v_cust and is_default and deleted_at is null and id <> p_id;
  update addresses set is_default = true where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function delete_my_address(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cust uuid := current_customer_id(); v_next uuid;
begin
  if v_cust is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  perform 1 from customers where id = v_cust for update;

  update addresses
     set deleted_at = now(), is_default = false
   where id = p_id and customer_id = v_cust and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ADDRESS');
  end if;

  -- If that was the default, the newest remaining address takes over.
  if not exists (select 1 from addresses
                 where customer_id = v_cust and is_default and deleted_at is null) then
    select id into v_next from addresses
     where customer_id = v_cust and deleted_at is null
     order by created_at desc, id limit 1;
    if v_next is not null then
      update addresses set is_default = true where id = v_next;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'new_default', v_next);
end $$;

-- Keep the pre-0012 entry point working for clients that have not updated.
create or replace function add_my_address(
  p_zone_id uuid, p_line1 text, p_landmark text default null,
  p_lat double precision default null, p_lng double precision default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := upsert_my_address(null, p_zone_id, p_line1, p_landmark, 'HOME', false, p_lat, p_lng);
  if not (r->>'ok')::boolean then
    raise exception '%', r->>'error' using errcode = 'invalid_parameter_value';
  end if;
  return (r->>'id')::uuid;
end $$;

-- Staff-entered addresses follow the same default rule.
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
  perform 1 from customers where id = p_customer_id for update;
  select not exists (select 1 from addresses where customer_id = p_customer_id and deleted_at is null)
    into v_first;
  insert into addresses (customer_id, zone_id, line1, landmark, lat, lng, is_default)
  values (p_customer_id, p_zone_id, p_line1, p_landmark, p_lat, p_lng, v_first)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function
  update_my_profile(text),
  upsert_my_address(uuid, uuid, text, text, text, boolean, double precision, double precision),
  set_default_address(uuid),
  delete_my_address(uuid)
  from public, anon;

grant execute on function
  update_my_profile(text),
  upsert_my_address(uuid, uuid, text, text, text, boolean, double precision, double precision),
  set_default_address(uuid),
  delete_my_address(uuid)
  to authenticated;

-- ================================================================
-- addresses: customers write through the functions only
-- ================================================================

drop policy if exists addr_insert on addresses;
drop policy if exists addr_update on addresses;
drop policy if exists addr_delete on addresses;
create policy addr_insert on addresses for insert with check (is_admin());
create policy addr_update on addresses for update using (is_admin()) with check (is_admin());
create policy addr_delete on addresses for delete using (is_admin());

-- ======================= supabase/migrations/0013_catalogue_detail.sql =======================
-- 0013_catalogue_detail.sql — what a product sheet and an ETA need.
--
--   products.description        a sentence or two for the product sheet
--   zones.sla_minutes           the delivery promise per area; the tracking
--                               screen shows placed_at + sla as the ETA
--   zones.free_delivery_above_paise (added in 0011) becomes editable here
--
-- Adding parameters to a function creates a new overload rather than
-- replacing the old one (see 0010), so the previous signatures are dropped
-- and the grants re-issued. The catalogue version is bumped at the end so
-- cached clients refetch and pick up the new column.

alter table products add column if not exists description text;

alter table zones
  add column if not exists sla_minutes int not null default 45
  check (sla_minutes between 10 and 240);

-- ================================================================
-- admin_upsert_product — + description
-- ================================================================

drop function if exists admin_upsert_product(uuid, uuid, text, text, int, text, text, text, boolean, int);

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
declare v_id uuid;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_mrp_paise is null or p_mrp_paise <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PRICE');
  end if;

  if p_id is null then
    insert into products (category_id, name, name_kn, brand, unit_label,
                          mrp_paise, image_url, is_active, description)
    values (p_category_id, p_name, p_name_kn, p_brand, p_unit_label,
            p_mrp_paise, p_image_url, p_is_active, nullif(btrim(coalesce(p_description, '')), ''))
    returning id into v_id;

    insert into inventory (product_id, on_hand) values (v_id, coalesce(p_on_hand, 0));
  else
    update products set
      category_id = p_category_id,
      name        = p_name,
      name_kn     = p_name_kn,
      brand       = p_brand,
      unit_label  = p_unit_label,
      mrp_paise   = p_mrp_paise,
      image_url   = coalesce(p_image_url, image_url),
      is_active   = p_is_active,
      description = nullif(btrim(coalesce(p_description, '')), '')
    where id = p_id
    returning id into v_id;

    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'NO_SUCH_PRODUCT');
    end if;

    if p_on_hand is not null then
      perform admin_adjust_stock(v_id, p_on_hand, 'ADJUST');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ================================================================
-- admin_upsert_zone — + free-delivery threshold and SLA
-- ================================================================

drop function if exists admin_upsert_zone(uuid, text, int, int, text, boolean, double precision, double precision, int);

create or replace function admin_upsert_zone(
  p_id uuid,
  p_name text,
  p_delivery_fee_paise int,
  p_min_order_paise int,
  p_name_kn text default null,
  p_is_active boolean default true,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_m int default null,
  p_free_delivery_above_paise int default null,
  p_sla_minutes int default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_name,'')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED');
  end if;
  if p_delivery_fee_paise < 0 or p_min_order_paise < 0
     or coalesce(p_free_delivery_above_paise, 0) < 0 then
    return jsonb_build_object('ok', false, 'error', 'NEGATIVE_AMOUNT');
  end if;
  if p_sla_minutes is not null and p_sla_minutes not between 10 and 240 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_SLA');
  end if;

  if p_id is null then
    insert into zones (name, name_kn, delivery_fee_paise, min_order_paise,
                       is_active, lat, lng, radius_m, free_delivery_above_paise, sla_minutes)
    values (btrim(p_name), nullif(btrim(coalesce(p_name_kn,'')), ''),
            p_delivery_fee_paise, p_min_order_paise, p_is_active,
            p_lat, p_lng, p_radius_m, p_free_delivery_above_paise, coalesce(p_sla_minutes, 45))
    returning id into v_id;
  else
    update zones set
      name = btrim(p_name),
      name_kn = nullif(btrim(coalesce(p_name_kn,'')), ''),
      delivery_fee_paise = p_delivery_fee_paise,
      min_order_paise = p_min_order_paise,
      is_active = p_is_active,
      -- null means "leave as is", so editing a fee never clears a centre
      lat = coalesce(p_lat, lat),
      lng = coalesce(p_lng, lng),
      radius_m = coalesce(p_radius_m, radius_m),
      -- but the threshold IS clearable: the admin form sends null for "never"
      free_delivery_above_paise = p_free_delivery_above_paise,
      sla_minutes = coalesce(p_sla_minutes, sla_minutes)
    where id = p_id returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ZONE');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function
  admin_upsert_product(uuid, uuid, text, text, int, text, text, text, boolean, int, text),
  admin_upsert_zone(uuid, text, int, int, text, boolean, double precision, double precision, int, int, int)
  from public, anon;

grant execute on function
  admin_upsert_product(uuid, uuid, text, text, int, text, text, text, boolean, int, text),
  admin_upsert_zone(uuid, text, int, int, text, boolean, double precision, double precision, int, int, int)
  to authenticated;

-- Cached catalogues predate products.description; make every client refetch.
update catalogue_version set version = version + 1 where id = true;

-- ======================= supabase/migrations/0014_tracking.sql =======================
-- 0014_tracking.sql — what the customer's order screen needs.
--
--   my_order_rider(order)   name and phone of the rider bringing MY order,
--                           only while it is out for delivery. A SECURITY
--                           DEFINER function rather than a wider riders
--                           policy: phone numbers must not become browsable.
--   cancel_my_order(order)  the customer-facing wrapper over transition_order
--                           (authorisation and the window live there, 0011).

create or replace function my_order_rider(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cust uuid := current_customer_id(); r record;
begin
  if v_cust is null then return null; end if;
  select rd.name, rd.phone
    into r
  from orders o
  join riders rd on rd.id = o.rider_id
  where o.id = p_order_id
    and o.customer_id = v_cust
    and o.status = 'OUT_FOR_DELIVERY';
  if not found then return null; end if;
  return jsonb_build_object('name', r.name, 'phone', r.phone);
end $$;

create or replace function cancel_my_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return transition_order(p_order_id, 'CANCELLED', 'CUSTOMER', null,
                          nullif(left(btrim(coalesce(p_reason, '')), 200), ''));
end $$;

revoke all on function my_order_rider(uuid), cancel_my_order(uuid, text) from public, anon;
grant execute on function my_order_rider(uuid), cancel_my_order(uuid, text) to authenticated;

-- ======================= supabase/migrations/0015_import_media.sql =======================
-- 0015_import_media.sql — the CSV import carries descriptions, images and
-- Kannada category names.
--
-- Same function, same signature (jsonb in, jsonb out); each row may now also
-- carry: description, image_url, category_kn. On update these follow the
-- existing rule: a blank column leaves the stored value alone, so a
-- price-only reimport never wipes a photo or a description.

create or replace function admin_bulk_upsert_products(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          jsonb;
  idx        int := 0;
  results    jsonb := '[]'::jsonb;
  v_cat_id   uuid;
  v_prod_id  uuid;
  v_name     text;
  v_unit     text;
  v_mrp      int;
  v_stock    int;
  v_catname  text;
  v_cat_kn   text;
  v_desc     text;
  v_image    text;
  v_action   text;
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
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Name is required');
      continue;
    end if;
    if v_mrp is null or v_mrp <= 0 then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'MRP must be greater than zero');
      continue;
    end if;
    if v_image is not null and v_image !~ '^https?://' then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'image_url must start with http(s)://');
      continue;
    end if;
    if v_unit is null then v_unit := '1 pc'; end if;

    if v_catname is null then v_catname := 'General'; end if;
    select id into v_cat_id from categories where lower(name) = lower(v_catname) limit 1;
    if v_cat_id is null then
      insert into categories (name, name_kn, sort_order) values (v_catname, v_cat_kn, 100)
      returning id into v_cat_id;
    elsif v_cat_kn is not null then
      update categories set name_kn = v_cat_kn where id = v_cat_id and name_kn is distinct from v_cat_kn;
    end if;

    select id into v_prod_id
      from products
     where lower(name) = lower(v_name) and lower(unit_label) = lower(v_unit)
     limit 1;

    if v_prod_id is null then
      insert into products (category_id, name, name_kn, brand, unit_label, mrp_paise, is_active,
                            description, image_url)
      values (v_cat_id, v_name,
              nullif(btrim(coalesce(r->>'name_kn','')), ''),
              nullif(btrim(coalesce(r->>'brand','')), ''),
              v_unit, v_mrp,
              coalesce((r->>'is_active')::boolean, true),
              v_desc, v_image)
      returning id into v_prod_id;

      insert into inventory (product_id, on_hand) values (v_prod_id, coalesce(v_stock, 0));
      v_action := 'created';
    else
      update products set
        category_id = v_cat_id,
        name_kn     = coalesce(nullif(btrim(coalesce(r->>'name_kn','')), ''), name_kn),
        brand       = coalesce(nullif(btrim(coalesce(r->>'brand','')), ''), brand),
        mrp_paise   = v_mrp,
        is_active   = coalesce((r->>'is_active')::boolean, is_active),
        description = coalesce(v_desc, description),
        image_url   = coalesce(v_image, image_url)
      where id = v_prod_id;

      if v_stock is not null then
        perform admin_adjust_stock(v_prod_id, v_stock, 'IMPORT');
      end if;
      v_action := 'updated';
    end if;

    results := results || jsonb_build_object(
      'row', idx, 'status', v_action, 'id', v_prod_id, 'name', v_name);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created', (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'created'),
    'updated', (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'updated'),
    'errors',  (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'error'),
    'results', results);
end $$;

-- ======================= supabase/migrations/0016_promise_15.sql =======================
-- 0016_promise_15.sql — the delivery promise is 15 minutes.
-- New zones default to 15; zones still on the old 45-minute default move too.
-- A zone deliberately set to something else is left alone.
alter table zones alter column sla_minutes set default 15;
update zones set sla_minutes = 15 where sla_minutes = 45;

-- ======================= supabase/migrations/0017_hardening.sql =======================
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

-- ======================= supabase/migrations/0018_free_delivery_200.sql =======================
-- 0018_free_delivery_200.sql — free delivery on orders of ₹200 and above.
-- Zones without a threshold get ₹200; new zones default to it. A zone
-- deliberately set to another figure is left alone. Editable per area in
-- Admin -> Delivery areas.
alter table zones alter column free_delivery_above_paise set default 20000;
update zones set free_delivery_above_paise = 20000 where free_delivery_above_paise is null;

-- ======================= supabase/migrations/0019_deals.sql =======================
-- 0019_deals.sql — deal prices and a promo banner.
--
-- FAA sells at MRP, and a "deal" must be a price the server actually
-- charges, not a label. products.sale_price_paise (below the MRP) is that
-- price: place_order charges it and order_items records what was paid.
-- store_config gains a promo banner (title, subtitle, end) for the home
-- page's deals board. Functions below are the 0017 bodies with the price
-- rule swapped in; nothing else changes.

alter table products
  add column if not exists sale_price_paise int
  check (sale_price_paise is null or (sale_price_paise > 0 and sale_price_paise < mrp_paise));

alter table store_config
  add column if not exists promo_title    text,
  add column if not exists promo_subtitle text,
  add column if not exists promo_until    timestamptz;

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
    select req.product_id, req.qty, p.name, p.is_active,
           coalesce(p.sale_price_paise, p.mrp_paise) as mrp_paise,
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

  -- unit_mrp_paise is the price charged per unit: the deal price when one is
  -- running, else the MRP. Historical orders keep what the customer paid.
  insert into order_items (order_id, product_id, qty, unit_mrp_paise, line_total_paise, product_name)
  select v_order_id, req.product_id, req.qty,
         coalesce(p.sale_price_paise, p.mrp_paise), coalesce(p.sale_price_paise, p.mrp_paise) * req.qty, p.name
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

drop function if exists admin_upsert_product(uuid, uuid, text, text, int, text, text, text, boolean, int, text);

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
  p_description text default null,
  p_sale_price_paise int default null
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
  if p_sale_price_paise is not null and (p_sale_price_paise <= 0 or p_sale_price_paise >= p_mrp_paise) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DEAL_PRICE');
  end if;

  if p_id is null then
    insert into products (category_id, name, name_kn, brand, unit_label, mrp_paise, image_url, is_active, description, sale_price_paise)
    values (p_category_id, p_name, p_name_kn, p_brand, p_unit_label, p_mrp_paise, p_image_url, p_is_active,
            nullif(btrim(coalesce(p_description, '')), ''), p_sale_price_paise)
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
      description = nullif(btrim(coalesce(p_description, '')), ''),
      sale_price_paise = p_sale_price_paise
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
  v_catname text; v_cat_kn text; v_desc text; v_image text; v_action text; v_res jsonb; v_sale int;
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
    v_sale    := nullif(r->>'sale_price_paise', '')::int;

    if v_name is null then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Name is required'); continue;
    end if;
    if v_mrp is null or v_mrp <= 0 then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'MRP must be greater than zero'); continue;
    end if;
    if v_stock is not null and v_stock < 0 then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Stock cannot be negative'); continue;
    end if;
    if v_sale is not null and (v_sale <= 0 or v_sale >= v_mrp) then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Deal price must be below the MRP'); continue;
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
      insert into products (category_id, name, name_kn, brand, unit_label, mrp_paise, is_active, description, image_url, sale_price_paise)
      values (v_cat_id, v_name, nullif(btrim(coalesce(r->>'name_kn','')), ''), nullif(btrim(coalesce(r->>'brand','')), ''),
              v_unit, v_mrp, coalesce((r->>'is_active')::boolean, true), v_desc, v_image, v_sale)
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
        image_url   = coalesce(v_image, image_url),
        -- a blank cell leaves a running deal alone; clear deals from the product form
        sale_price_paise = coalesce(v_sale, sale_price_paise)
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


revoke all on function admin_upsert_product(uuid, uuid, text, text, int, text, text, text, boolean, int, text, int) from public, anon;
grant execute on function admin_upsert_product(uuid, uuid, text, text, int, text, text, text, boolean, int, text, int) to authenticated;

-- Cached catalogues predate sale_price_paise; make every client refetch.
update catalogue_version set version = version + 1 where id = true;

-- ======================= supabase/migrations/0020_categories.sql =======================
-- 0020_categories.sql — a shelf order for categories.
--
-- Categories arrived two ways: the 0001 seed ("Staples", "Beverages" at
-- sort_order 1 and 2) and the CSV import, which gave every new category the
-- same sort_order 100. The storefront therefore opened with an empty seed
-- category first and the real ones in alphabetical order, "Cleaning" ahead
-- of "Rice & Atta".
--
--   1. Known grocery categories get the order a customer walks a shop in:
--      fresh first, staples next, then snacks and drinks, then non-food.
--   2. Anything else keeps its relative order after the shelf.
--   3. Categories with no active product are hidden; the storefront also
--      hides them client-side, so an emptied category disappears at once.
--   4. Bulk import places a NEW category after the last one, in file order,
--      instead of at a fixed 100. Existing categories keep their slot.
--
-- Admins reorder, rename and hide categories from Admin → Categories; the
-- 0005 policies already allow that as row updates.

-- 1. canonical shelf order
with shelf(name, o) as (values
  ('Fruits & Vegetables', 10),
  ('Dairy & Bread',       20),
  ('Rice & Atta',         30),
  ('Dals & Pulses',       40),
  ('Oil & Ghee',          50),
  ('Masala & Spices',     60),
  ('Snacks & Biscuits',   70),
  ('Tea & Coffee',        80),
  ('Personal Care',       90),
  ('Household',          100),
  ('Cleaning',           110)
)
update categories c set sort_order = shelf.o
from shelf where lower(c.name) = lower(shelf.name);

-- 2. everything else after the shelf, keeping its current relative order
with rest as (
  select id, row_number() over (order by sort_order, name) as rn
  from categories
  where lower(name) not in (
    'fruits & vegetables', 'dairy & bread', 'rice & atta', 'dals & pulses',
    'oil & ghee', 'masala & spices', 'snacks & biscuits', 'tea & coffee',
    'personal care', 'household', 'cleaning')
)
update categories c set sort_order = 500 + rest.rn * 10 from rest where c.id = rest.id;

-- 3. hide categories that have nothing to sell
update categories c set is_active = false
where c.is_active
  and not exists (select 1 from products p where p.category_id = c.id and p.is_active);

-- 4. bulk import: new categories go after the last one, in file order
create or replace function admin_bulk_upsert_products(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; idx int := 0; results jsonb := '[]'::jsonb;
  v_cat_id uuid; v_prod_id uuid; v_name text; v_unit text; v_mrp int; v_stock int;
  v_catname text; v_cat_kn text; v_desc text; v_image text; v_action text; v_res jsonb; v_sale int;
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
    v_sale    := nullif(r->>'sale_price_paise', '')::int;

    if v_name is null then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Name is required'); continue;
    end if;
    if v_mrp is null or v_mrp <= 0 then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'MRP must be greater than zero'); continue;
    end if;
    if v_stock is not null and v_stock < 0 then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Stock cannot be negative'); continue;
    end if;
    if v_sale is not null and (v_sale <= 0 or v_sale >= v_mrp) then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Deal price must be below the MRP'); continue;
    end if;
    if v_image is not null and v_image !~ '^https?://' then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'image_url must start with http(s)://'); continue;
    end if;
    if v_unit is null then v_unit := '1 pc'; end if;
    if v_catname is null then v_catname := 'General'; end if;

    select id into v_cat_id from categories where lower(name) = lower(v_catname) limit 1;
    if v_cat_id is null then
      insert into categories (name, name_kn, sort_order)
      values (v_catname, v_cat_kn, (select coalesce(max(sort_order), 0) + 10 from categories))
      returning id into v_cat_id;
    elsif v_cat_kn is not null then
      update categories set name_kn = v_cat_kn where id = v_cat_id and name_kn is distinct from v_cat_kn;
    end if;

    select id into v_prod_id from products
     where lower(name) = lower(v_name) and lower(unit_label) = lower(v_unit) limit 1;

    if v_prod_id is null then
      insert into products (category_id, name, name_kn, brand, unit_label, mrp_paise, is_active, description, image_url, sale_price_paise)
      values (v_cat_id, v_name, nullif(btrim(coalesce(r->>'name_kn','')), ''), nullif(btrim(coalesce(r->>'brand','')), ''),
              v_unit, v_mrp, coalesce((r->>'is_active')::boolean, true), v_desc, v_image, v_sale)
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
        image_url   = coalesce(v_image, image_url),
        -- a blank cell leaves a running deal alone; clear deals from the product form
        sale_price_paise = coalesce(v_sale, sale_price_paise)
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

-- Cached catalogues carry the old order; make every client refetch.
update catalogue_version set version = version + 1 where id = true;
