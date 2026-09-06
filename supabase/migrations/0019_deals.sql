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
