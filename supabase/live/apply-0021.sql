-- FAA: migrations 0021-0021 in one paste for the Supabase SQL editor.
-- Safe to run more than once. Generated from supabase/migrations/ by scripts/live-bundle.sh.

-- ======================= supabase/migrations/0021_google_identity.sql =======================
-- 0021_google_identity.sql — customers who sign in with Google.
--
-- Until now a customer WAS a verified phone number: customers.phone was NOT
-- NULL, and link_current_user_to_customer() refused a session without a
-- phone claim. Google sign-in (Supabase provider, id-token flow) carries a
-- verified email and no phone.
--
--   phone          the verified sign-in number; now nullable. Only ever set
--                  from a JWT phone claim or by staff. Never from a form.
--   contact_phone  the number the rider calls. Copied from phone on every
--                  phone customer (trigger), typed once at checkout by a
--                  Google customer. Not unique and not an identity: a wrong
--                  digit costs one failed delivery, never someone's account.
--   email          from the Google identity, for the account page.
--
-- Why two phone columns: if a typed number went into `phone`, a Google user
-- who mistyped (or lied) would hold the identity slot of a real person, and
-- that person could never sign in by OTP. 0012 closed exactly that hole.
--
-- place_order() refuses NO_CONTACT_PHONE when neither number is known, and
-- snapshots coalesce(contact_phone, phone) into delivery_snapshot.phone.

alter table customers alter column phone drop not null;
alter table customers
  add column if not exists contact_phone text,
  add column if not exists email text;

update customers set contact_phone = phone where contact_phone is null and phone is not null;

-- Every phone customer, however created (OTP link, admin lookup, CSV), gets
-- the sign-in number as the contact number unless one was given.
create or replace function customers_contact_default() returns trigger
language plpgsql as $$
begin
  if new.contact_phone is null then
    new.contact_phone := new.phone;
  end if;
  return new;
end $$;

drop trigger if exists customers_contact_default on customers;
create trigger customers_contact_default
  before insert or update of phone, contact_phone on customers
  for each row execute function customers_contact_default();

-- ================================================================
-- link_current_user_to_customer — phone claim, else email identity
-- ================================================================

create or replace function link_current_user_to_customer(
  p_phone text,
  p_name  text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_uid   uuid := auth.uid();
  v_jwt   text := nullif(auth.jwt() ->> 'phone', '');
  v_email text := nullif(lower(auth.jwt() ->> 'email'), '');
  v_meta  jsonb := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  v_name  text := nullif(trim(coalesce(p_name, v_meta ->> 'full_name', v_meta ->> 'name', '')), '');
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
  elsif v_email is not null then
    -- Google (or any email identity): a fresh customer keyed on the auth
    -- user. Never adopts an existing phone row — the phone is unverified.
    insert into customers (phone, email, name, auth_uid)
    values (null, v_email, v_name, v_uid)
    returning id into v_id;
    return v_id;
  else
    raise exception 'no verified phone or email on this session' using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from customers where phone = v_phone;
  if v_id is not null then
    update customers
       set auth_uid = v_uid, name = coalesce(name, v_name), email = coalesce(email, v_email)
     where id = v_id and auth_uid is null;
    if not found then
      raise exception 'phone already linked to another account'
        using errcode = 'unique_violation';
    end if;
    return v_id;
  end if;

  insert into customers (phone, email, name, auth_uid)
  values (v_phone, v_email, v_name, v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- ================================================================
-- set_my_contact_phone — the number the rider calls
-- ================================================================

create or replace function set_my_contact_phone(p_phone text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cust uuid := current_customer_id();
  v_d    text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if v_cust is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if length(v_d) = 11 and left(v_d, 1) = '0' then v_d := substr(v_d, 2); end if;
  if length(v_d) = 12 and left(v_d, 2) = '91' then v_d := substr(v_d, 3); end if;
  if length(v_d) <> 10 or left(v_d, 1) not in ('6', '7', '8', '9') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PHONE');
  end if;
  update customers set contact_phone = '+91' || v_d where id = v_cust;
  return jsonb_build_object('ok', true, 'phone', '+91' || v_d);
end $$;

revoke all on function set_my_contact_phone(text) from public, anon;
grant execute on function set_my_contact_phone(text) to authenticated;

-- ================================================================
-- find_or_create_customer — staff lookup also matches a contact number
-- ================================================================

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

  -- The sign-in number wins; else the newest customer who gave it as contact.
  select id into v_id from customers
   where phone = p_phone or contact_phone = p_phone
   order by (phone = p_phone) desc nulls last, created_at desc
   limit 1;
  if v_id is not null then
    if p_name is not null then
      update customers set name = coalesce(name, p_name) where id = v_id;
    end if;
    return v_id;
  end if;

  insert into customers (phone, name) values (p_phone, p_name) returning id into v_id;
  return v_id;
end $$;

-- ================================================================
-- place_order — NO_CONTACT_PHONE, snapshot the callable number
-- ================================================================

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
  -- The number the rider will call: the contact number when the customer
  -- gave one, else the sign-in number. A Google account with neither cannot
  -- be delivered to yet; checkout asks for a number first.
  select coalesce(contact_phone, phone) into v_phone from customers where id = p_customer_id;
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'NO_CONTACT_PHONE');
  end if;

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
