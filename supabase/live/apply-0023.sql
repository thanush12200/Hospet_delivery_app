-- FAA: migrations 0023-0023 in one paste for the Supabase SQL editor.
-- Safe to run more than once. Generated from supabase/migrations/ by scripts/live-bundle.sh.

-- ======================= supabase/migrations/0023_auto_zone.sql =======================
-- 0023_auto_zone.sql — the delivery area is found, not asked for.
--
-- The address form no longer has an "Area" dropdown. The pin (GPS or a
-- place search) decides the zone:
--
--   resolve_zone(lat, lng)
--     1. the nearest active zone that has a centre, when the pin is inside
--        its radius (no radius = unlimited);
--     2. else, if no zone has a centre yet and exactly one zone is active,
--        that zone — a one-store town needs no geography to work;
--     3. else null: we do not deliver there, or the zones are ambiguous.
--
-- upsert_my_address() accepts a null zone and resolves it the same way, so
-- an old client that still sends a zone keeps working and a new one need
-- not. OUTSIDE_DELIVERY_AREA replaces INVALID_ZONE for customers.

create or replace function resolve_zone(p_lat double precision, p_lng double precision)
returns uuid
language sql stable security definer set search_path = public as $$
  with placed as (
    select z.id,
           2 * 6371000 * asin(sqrt(
             power(sin(radians(z.lat - p_lat) / 2), 2)
             + cos(radians(p_lat)) * cos(radians(z.lat)) * power(sin(radians(z.lng - p_lng) / 2), 2)
           )) as d,
           z.radius_m
      from zones z
     where z.is_active and z.lat is not null and z.lng is not null
       and p_lat is not null and p_lng is not null
  )
  select coalesce(
    (select id from placed where d <= coalesce(radius_m, 1e12) order by d limit 1),
    (select id from zones
      where is_active
        and not exists (select 1 from zones z2 where z2.is_active and z2.lat is not null and z2.lng is not null)
        and (select count(*) from zones z3 where z3.is_active) = 1)
  )
$$;

grant execute on function resolve_zone(double precision, double precision) to anon, authenticated;

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
