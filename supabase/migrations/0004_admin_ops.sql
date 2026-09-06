-- 0004_admin_ops.sql — what the admin console needs in order to run the business.
--
-- Two gaps in 0003 surfaced once the manual-order workflow was built:
-- an admin taking an order over WhatsApp has to be able to create the customer
-- and the address, but the WITH CHECK clauses only permitted a user acting on
-- their own rows. Fixed here.

-- ---------------------------------------------------------------- policy fixes

drop policy if exists cust_insert_self on customers;
create policy cust_insert on customers for insert
  with check (auth_uid = auth.uid() or is_admin());

drop policy if exists cust_update_self on customers;
create policy cust_update on customers for update
  using (auth_uid = auth.uid() or is_admin())
  with check (auth_uid = auth.uid() or is_admin());

drop policy if exists addr_own on addresses;
create policy addr_own on addresses for all
  using (customer_id = current_customer_id() or is_admin())
  with check (customer_id = current_customer_id() or is_admin());

-- ---------------------------------------------------------------- helpers

/**
 * Phone is a customer's identity. An order taken on WhatsApp starts here:
 * look the number up, create the record if it is new, and return the id.
 * Admin only -- a customer has no business creating other customers.
 */
create or replace function find_or_create_customer(
  p_phone text,
  p_name  text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from customers where phone = p_phone;
  if v_id is not null then
    if p_name is not null then
      update customers set name = coalesce(name, p_name) where id = v_id;
    end if;
    return v_id;
  end if;

  insert into customers (phone, name) values (p_phone, p_name) returning id into v_id;
  return v_id;
end $$;

/** Adds an address for an existing customer. Admin only. */
create or replace function admin_add_address(
  p_customer_id uuid,
  p_zone_id     uuid,
  p_line1       text,
  p_landmark    text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  insert into addresses (customer_id, zone_id, line1, landmark)
  values (p_customer_id, p_zone_id, p_line1, p_landmark)
  returning id into v_id;
  return v_id;
end $$;

/**
 * Adjusts stock outside the order flow: a delivery from a supplier, or a
 * correction after a physical count. Always writes a stock_movements row so
 * the reason for every change survives.
 */
create or replace function admin_adjust_stock(
  p_product_id uuid,
  p_new_on_hand int,
  p_reason text default 'ADJUST'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_old int; v_reserved int;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  select on_hand, reserved into v_old, v_reserved
  from inventory where product_id = p_product_id for update;

  if not found then
    insert into inventory (product_id, on_hand) values (p_product_id, p_new_on_hand);
    v_old := 0; v_reserved := 0;
  else
    if p_new_on_hand < v_reserved then
      return jsonb_build_object('ok', false, 'error', 'BELOW_RESERVED',
                                'reserved', v_reserved);
    end if;
    update inventory set on_hand = p_new_on_hand where product_id = p_product_id;
  end if;

  insert into stock_movements (product_id, delta_on_hand, reason, actor_type)
  values (p_product_id, p_new_on_hand - v_old, p_reason, 'ADMIN');

  return jsonb_build_object('ok', true, 'from', v_old, 'to', p_new_on_hand);
end $$;

/** Counts for the board, in one round trip instead of six. */
create or replace function admin_order_counts()
returns table (status order_status, n bigint)
language sql stable security definer set search_path = public as $$
  select o.status, count(*)
  from orders o
  where is_admin()
  group by o.status
$$;

revoke all on function find_or_create_customer, admin_add_address,
                      admin_adjust_stock, admin_order_counts from public, anon;
grant execute on function find_or_create_customer, admin_add_address,
                          admin_adjust_stock, admin_order_counts to authenticated;

-- ---------------------------------------------------------------- bootstrap
--
-- To create the first admin:
--   1. Supabase dashboard -> Authentication -> Users -> Add user
--      (email + password, tick "Auto Confirm User")
--   2. Run, with that user's email:
--
--        insert into admin_users (name, phone, auth_uid, role)
--        select 'Owner', '+91XXXXXXXXXX', id, 'OWNER'
--        from auth.users where email = 'you@example.com';
