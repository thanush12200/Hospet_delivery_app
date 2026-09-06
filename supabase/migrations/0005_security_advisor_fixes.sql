-- 0005_security_advisor_fixes.sql
--
-- Fixes raised by Supabase's Security Advisor against 0001-0004.

-- ================================================================
-- 1. CRITICAL — Security Definer View: public.inventory_available
-- ================================================================
-- A Postgres view runs with the privileges of its OWNER by default, which
-- means it bypasses RLS on the tables underneath it. Today inventory has a
-- permissive read policy so nothing leaks, but the view would keep returning
-- rows even if that policy were tightened later -- a trap for whoever changes
-- it next. security_invoker makes the view respect the caller's own RLS.

alter view inventory_available set (security_invoker = true);

-- ================================================================
-- 2. Function Search Path Mutable
-- ================================================================
-- A SECURITY DEFINER function without a pinned search_path can be hijacked:
-- an attacker who can create objects in a schema earlier on the path can
-- shadow a table or operator the function relies on. Pin all of them.

create or replace function bump_catalogue_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update catalogue_version set version = version + 1, updated_at = now();
  return null;
end $$;

create or replace function touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function guard_order_status() returns trigger
language plpgsql set search_path = public as $$
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

create or replace function block_mutation() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'check_violation';
end $$;

-- A test helper that should never have reached the live database: it was
-- created there by running lifecycle_test.sql against Supabase.
drop function if exists assert_eq(text, anyelement, anyelement);

-- ================================================================
-- 3. Auth RLS Initialization Plan
-- ================================================================
-- auth.uid() written bare in a policy is re-evaluated for EVERY row scanned.
-- Wrapping it as (select auth.uid()) lets the planner treat it as a one-time
-- initplan instead. On a big orders table that is the difference between one
-- call and hundreds of thousands.

drop policy if exists cust_self   on customers;
drop policy if exists cust_insert on customers;
drop policy if exists cust_update on customers;

create policy cust_select on customers for select
  using (auth_uid = (select auth.uid()) or is_admin());
create policy cust_insert on customers for insert
  with check (auth_uid = (select auth.uid()) or is_admin());
create policy cust_update on customers for update
  using (auth_uid = (select auth.uid()) or is_admin())
  with check (auth_uid = (select auth.uid()) or is_admin());

drop policy if exists rider_self  on riders;
drop policy if exists rider_admin on riders;

create policy rider_select on riders for select
  using (auth_uid = (select auth.uid()) or is_admin());
create policy rider_insert on riders for insert with check (is_admin());
create policy rider_update on riders for update using (is_admin()) with check (is_admin());
create policy rider_delete on riders for delete using (is_admin());

-- Same treatment inside the helpers, which every other policy calls.
create or replace function current_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from customers where auth_uid = (select auth.uid())
$$;

create or replace function current_rider_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from riders where auth_uid = (select auth.uid()) and is_active
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where auth_uid = (select auth.uid()))
$$;

-- ================================================================
-- 4. Multiple Permissive Policies
-- ================================================================
-- The catalogue tables each had a FOR SELECT read policy AND a FOR ALL write
-- policy. FOR ALL includes SELECT, so every read evaluated two policies and
-- OR'd them. Splitting the write policies into explicit INSERT/UPDATE/DELETE
-- leaves exactly one policy per read.

drop policy if exists cat_write  on categories;
drop policy if exists prod_write on products;
drop policy if exists zone_write on zones;
drop policy if exists inv_write  on inventory;

create policy cat_insert on categories for insert with check (is_admin());
create policy cat_update on categories for update using (is_admin()) with check (is_admin());
create policy cat_delete on categories for delete using (is_admin());

create policy prod_insert on products for insert with check (is_admin());
create policy prod_update on products for update using (is_admin()) with check (is_admin());
create policy prod_delete on products for delete using (is_admin());

create policy zone_insert on zones for insert with check (is_admin());
create policy zone_update on zones for update using (is_admin()) with check (is_admin());
create policy zone_delete on zones for delete using (is_admin());

create policy inv_insert on inventory for insert with check (is_admin());
create policy inv_update on inventory for update using (is_admin()) with check (is_admin());
create policy inv_delete on inventory for delete using (is_admin());

-- addresses had a single FOR ALL policy covering reads too; split it likewise.
drop policy if exists addr_own on addresses;

create policy addr_select on addresses for select
  using (customer_id = current_customer_id() or is_admin());
create policy addr_insert on addresses for insert
  with check (customer_id = current_customer_id() or is_admin());
create policy addr_update on addresses for update
  using (customer_id = current_customer_id() or is_admin())
  with check (customer_id = current_customer_id() or is_admin());
create policy addr_delete on addresses for delete
  using (customer_id = current_customer_id() or is_admin());
