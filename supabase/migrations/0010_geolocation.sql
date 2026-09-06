-- 0010_geolocation.sql — optional coordinates on zones and addresses.
--
-- Coordinates are a convenience, never a requirement: roughly half of users
-- deny the permission, GPS is unreliable indoors, and in Hospet a landmark
-- beats a pin anyway. Everything below degrades to the existing text flow.

-- A zone centre, used to guess which area a customer is standing in without
-- paying for reverse geocoding. Nearest centre wins.
alter table zones add column if not exists lat double precision;
alter table zones add column if not exists lng double precision;
alter table zones add column if not exists radius_m int;

-- addresses already carry lat/lng from 0001; they were simply never populated.

-- Adding parameters creates a NEW overload rather than replacing the old
-- function, which leaves two versions callable and makes grant/revoke
-- ambiguous. Drop the previous signatures explicitly.
drop function if exists admin_upsert_zone(uuid, text, int, int, text, boolean);
drop function if exists add_my_address(uuid, text, text);
drop function if exists admin_add_address(uuid, uuid, text, text);

create or replace function admin_upsert_zone(
  p_id uuid,
  p_name text,
  p_delivery_fee_paise int,
  p_min_order_paise int,
  p_name_kn text default null,
  p_is_active boolean default true,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_m int default null
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
  if p_delivery_fee_paise < 0 or p_min_order_paise < 0 then
    return jsonb_build_object('ok', false, 'error', 'NEGATIVE_AMOUNT');
  end if;

  if p_id is null then
    insert into zones (name, name_kn, delivery_fee_paise, min_order_paise,
                       is_active, lat, lng, radius_m)
    values (btrim(p_name), nullif(btrim(coalesce(p_name_kn,'')), ''),
            p_delivery_fee_paise, p_min_order_paise, p_is_active,
            p_lat, p_lng, p_radius_m)
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
      radius_m = coalesce(p_radius_m, radius_m)
    where id = p_id returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ZONE');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function add_my_address(
  p_zone_id uuid, p_line1 text, p_landmark text default null,
  p_lat double precision default null, p_lng double precision default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_cust uuid := current_customer_id(); v_id uuid;
begin
  if v_cust is null then
    raise exception 'no customer record' using errcode = 'insufficient_privilege';
  end if;
  insert into addresses (customer_id, zone_id, line1, landmark, lat, lng)
  values (v_cust, p_zone_id, p_line1, p_landmark, p_lat, p_lng)
  returning id into v_id;
  return v_id;
end $$;

create or replace function admin_add_address(
  p_customer_id uuid, p_zone_id uuid, p_line1 text,
  p_landmark text default null,
  p_lat double precision default null, p_lng double precision default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  insert into addresses (customer_id, zone_id, line1, landmark, lat, lng)
  values (p_customer_id, p_zone_id, p_line1, p_landmark, p_lat, p_lng)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function
  admin_upsert_zone(uuid, text, int, int, text, boolean, double precision, double precision, int),
  add_my_address(uuid, text, text, double precision, double precision),
  admin_add_address(uuid, uuid, text, text, double precision, double precision)
  from public, anon;

grant execute on function
  admin_upsert_zone(uuid, text, int, int, text, boolean, double precision, double precision, int),
  add_my_address(uuid, text, text, double precision, double precision),
  admin_add_address(uuid, uuid, text, text, double precision, double precision)
  to authenticated;
