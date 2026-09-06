-- 0006_images_and_ops.sql — product imagery, catalogue management, rider ops.

-- ================================================================
-- Storage: product images
-- ================================================================
-- Public read so the shop can render without a signed URL per image (and so
-- the CDN and service worker can cache them). Writes are admin-only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif'];

drop policy if exists product_images_read   on storage.objects;
drop policy if exists product_images_insert on storage.objects;
drop policy if exists product_images_update on storage.objects;
drop policy if exists product_images_delete on storage.objects;

create policy product_images_read on storage.objects for select
  using (bucket_id = 'product-images');
create policy product_images_insert on storage.objects for insert
  with check (bucket_id = 'product-images' and is_admin());
create policy product_images_update on storage.objects for update
  using (bucket_id = 'product-images' and is_admin());
create policy product_images_delete on storage.objects for delete
  using (bucket_id = 'product-images' and is_admin());

-- ================================================================
-- Catalogue management
-- ================================================================

/**
 * Creates or updates a product and its inventory row together. Passing a null
 * p_id inserts. Stock is only touched when p_on_hand is supplied, so an edit
 * to a name or price can never silently reset stock.
 */
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
  p_on_hand     int default null
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
                          mrp_paise, image_url, is_active)
    values (p_category_id, p_name, p_name_kn, p_brand, p_unit_label,
            p_mrp_paise, p_image_url, p_is_active)
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
      is_active   = p_is_active
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

create or replace function admin_upsert_category(
  p_id uuid, p_name text, p_name_kn text default null,
  p_sort_order int default 0, p_is_active boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  if p_id is null then
    insert into categories (name, name_kn, sort_order, is_active)
    values (p_name, p_name_kn, p_sort_order, p_is_active) returning id into v_id;
  else
    update categories set name = p_name, name_kn = p_name_kn,
                          sort_order = p_sort_order, is_active = p_is_active
    where id = p_id returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function admin_upsert_rider(
  p_id uuid, p_name text, p_phone text, p_is_active boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  if p_id is null then
    insert into riders (name, phone, is_active) values (p_name, p_phone, p_is_active)
    on conflict (phone) do update set name = excluded.name, is_active = excluded.is_active
    returning id into v_id;
  else
    update riders set name = p_name, phone = p_phone, is_active = p_is_active
    where id = p_id returning id into v_id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ================================================================
-- Customer self-service
-- ================================================================

/**
 * Binds the signed-in auth user to a customer record, creating it if the phone
 * is new and adopting an existing record created earlier by an admin taking a
 * WhatsApp order. Called once after login.
 */
create or replace function link_current_user_to_customer(
  p_phone text,
  p_name  text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from customers where auth_uid = v_uid;
  if v_id is not null then return v_id; end if;

  select id into v_id from customers where phone = p_phone;
  if v_id is not null then
    -- Never steal a record already bound to a different account.
    update customers
       set auth_uid = v_uid, name = coalesce(name, p_name)
     where id = v_id and auth_uid is null;
    if not found then
      raise exception 'phone already linked to another account'
        using errcode = 'unique_violation';
    end if;
    return v_id;
  end if;

  insert into customers (phone, name, auth_uid) values (p_phone, p_name, v_uid)
  returning id into v_id;
  return v_id;
end $$;

/** Adds an address for the signed-in customer. */
create or replace function add_my_address(
  p_zone_id uuid, p_line1 text, p_landmark text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_cust uuid := current_customer_id(); v_id uuid;
begin
  if v_cust is null then
    raise exception 'no customer record' using errcode = 'insufficient_privilege';
  end if;
  insert into addresses (customer_id, zone_id, line1, landmark)
  values (v_cust, p_zone_id, p_line1, p_landmark) returning id into v_id;
  return v_id;
end $$;

-- ================================================================
-- Rider ops
-- ================================================================

/** Today's work for the signed-in rider. */
create or replace function rider_my_orders()
returns setof orders
language sql stable security definer set search_path = public as $$
  select * from orders
  where rider_id = current_rider_id()
    and status in ('OUT_FOR_DELIVERY', 'PACKED')
  order by placed_at
$$;

/** What the rider owes at the end of the day. */
create or replace function rider_cash_today()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
       'expected_paise', cash_expected_paise,
       'deposited_paise', cash_deposited_paise,
       'status', status)
     from rider_settlements
     where rider_id = current_rider_id() and settlement_date = current_date),
    jsonb_build_object('expected_paise', 0, 'deposited_paise', null, 'status', 'OPEN'))
$$;

revoke all on function admin_upsert_product, admin_upsert_category,
                      admin_upsert_rider, link_current_user_to_customer,
                      add_my_address, rider_my_orders, rider_cash_today
       from public, anon;
grant execute on function admin_upsert_product, admin_upsert_category,
                          admin_upsert_rider, link_current_user_to_customer,
                          add_my_address, rider_my_orders, rider_cash_today
       to authenticated;
