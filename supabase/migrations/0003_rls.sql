-- 0003_rls.sql — Row Level Security.
--
-- The anon key ships inside the frontend and is readable by anyone. Without
-- these policies that key is a master key to every table. Nothing here is
-- optional before real customers use the system.
--
-- Principle: the catalogue is public; everything else is private to its owner;
-- and no client may ever write to orders, inventory or payments directly --
-- those go through the SECURITY DEFINER functions in 0002.

-- ---------------------------------------------------------------- helpers

create or replace function current_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from customers where auth_uid = auth.uid()
$$;

create or replace function current_rider_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from riders where auth_uid = auth.uid() and is_active
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where auth_uid = auth.uid())
$$;

-- ---------------------------------------------------------------- enable RLS

alter table categories        enable row level security;
alter table products          enable row level security;
alter table catalogue_version enable row level security;
alter table zones             enable row level security;
alter table inventory         enable row level security;
alter table stock_movements   enable row level security;
alter table customers         enable row level security;
alter table addresses         enable row level security;
alter table riders            enable row level security;
alter table admin_users       enable row level security;
alter table orders            enable row level security;
alter table order_items       enable row level security;
alter table order_events      enable row level security;
alter table payments          enable row level security;
alter table rider_settlements enable row level security;

-- ---------------------------------------------------------------- catalogue: public read

create policy cat_read     on categories        for select using (is_active or is_admin());
create policy prod_read    on products          for select using (is_active or is_admin());
create policy ver_read     on catalogue_version for select using (true);
create policy zone_read    on zones             for select using (is_active or is_admin());

-- Stock levels are readable (the shop needs to grey out sold-out items) but
-- never writable by a client.
create policy inv_read     on inventory         for select using (true);

create policy cat_write    on categories        for all using (is_admin()) with check (is_admin());
create policy prod_write   on products          for all using (is_admin()) with check (is_admin());
create policy zone_write   on zones             for all using (is_admin()) with check (is_admin());
create policy inv_write    on inventory         for all using (is_admin()) with check (is_admin());
create policy moves_read   on stock_movements   for select using (is_admin());

-- ---------------------------------------------------------------- identity

create policy cust_self on customers for select
  using (auth_uid = auth.uid() or is_admin());
create policy cust_update_self on customers for update
  using (auth_uid = auth.uid()) with check (auth_uid = auth.uid());
-- A signing-up user creates exactly one row, bound to their own auth id.
create policy cust_insert_self on customers for insert
  with check (auth_uid = auth.uid());

create policy addr_own on addresses for all
  using (customer_id = current_customer_id() or is_admin())
  with check (customer_id = current_customer_id());

create policy rider_self on riders for select
  using (auth_uid = auth.uid() or is_admin());
create policy rider_admin on riders for all
  using (is_admin()) with check (is_admin());

create policy admin_self on admin_users for select using (is_admin());

-- ---------------------------------------------------------------- orders
-- Read-only for every client. All mutation goes through place_order() and
-- transition_order(), which run as SECURITY DEFINER and bypass RLS.

create policy order_read on orders for select using (
  customer_id = current_customer_id()
  or rider_id = current_rider_id()
  or is_admin()
);

create policy item_read on order_items for select using (
  exists (
    select 1 from orders o
    where o.id = order_items.order_id
      and (o.customer_id = current_customer_id()
        or o.rider_id   = current_rider_id()
        or is_admin())
  )
);

create policy event_read on order_events for select using (
  exists (
    select 1 from orders o
    where o.id = order_events.order_id
      and (o.customer_id = current_customer_id() or is_admin())
  )
);

create policy pay_read on payments for select using (
  exists (
    select 1 from orders o
    where o.id = payments.order_id
      and (o.customer_id = current_customer_id()
        or o.rider_id   = current_rider_id()
        or is_admin())
  )
);

create policy settle_read on rider_settlements for select
  using (rider_id = current_rider_id() or is_admin());

-- Note the deliberate absence of INSERT/UPDATE/DELETE policies on orders,
-- order_items, order_events and payments. With RLS enabled and no policy,
-- those operations are denied to every client. That is the intent.

-- ---------------------------------------------------------------- grants

-- Only the guarded entry points are callable.
revoke all on function place_order      from public, anon;
revoke all on function transition_order from public, anon;
revoke all on function settle_rider_cash from public, anon;

grant execute on function place_order       to authenticated;
grant execute on function transition_order  to authenticated;
grant execute on function settle_rider_cash to authenticated;

grant execute on function current_customer_id to authenticated, anon;
grant execute on function current_rider_id    to authenticated, anon;
grant execute on function is_admin            to authenticated, anon;
