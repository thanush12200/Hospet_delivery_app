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
