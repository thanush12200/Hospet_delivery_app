-- 0024: delivery area boundary.
--
-- A delivery area with a centre pin and radius is a boundary, not a hint.
-- zone_contains() says whether a point lies inside an area (always true for
-- an area with no centre yet), and upsert_my_address refuses a pin that lies
-- outside the area it names, so a customer ordering "for someone in Hospet"
-- still has to put the door inside Hospet.

create or replace function zone_contains(p_zone_id uuid, p_lat double precision, p_lng double precision)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when z.id is null then false
    when z.lat is null or z.lng is null then true
    when p_lat is null or p_lng is null then true
    else 2 * 6371000 * asin(sqrt(
           power(sin(radians(p_lat - z.lat) / 2), 2)
         + cos(radians(z.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - z.lng) / 2), 2)))
         <= coalesce(z.radius_m, 1e12)
  end
  from (select 1) _
  left join zones z on z.id = p_zone_id;
$$;
grant execute on function zone_contains(uuid, double precision, double precision) to anon, authenticated;

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
  v_zone   uuid;
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
  -- No area from the form any more: work it out from the pin.
  v_zone := coalesce(p_zone_id, resolve_zone(p_lat, p_lng));
  if v_zone is null then
    return jsonb_build_object('ok', false, 'error', 'OUTSIDE_DELIVERY_AREA');
  end if;
  if not exists (select 1 from zones where id = v_zone and is_active) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ZONE');
  end if;
  -- A pinned area is a boundary: a pin outside its radius is refused even
  -- when the client names the area. Areas without a centre accept any pin.
  if not zone_contains(v_zone, p_lat, p_lng) then
    return jsonb_build_object('ok', false, 'error', 'OUTSIDE_DELIVERY_AREA');
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
    values (v_cust, v_zone, v_line1, nullif(trim(p_landmark), ''), v_label,
            p_is_default or v_first, p_lat, p_lng)
    returning id into v_id;
  else
    update addresses
       set zone_id    = v_zone,
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

grant execute on function upsert_my_address(uuid, uuid, text, text, text, boolean, double precision, double precision) to authenticated;
