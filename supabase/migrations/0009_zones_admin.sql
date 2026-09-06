-- 0009_zones_admin.sql — manage delivery areas from the admin console.
--
-- Zones could previously only be created with SQL, which is not a workable
-- way to run a business.

create or replace function admin_upsert_zone(
  p_id uuid,
  p_name text,
  p_delivery_fee_paise int,
  p_min_order_paise int,
  p_name_kn text default null,
  p_is_active boolean default true
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
    insert into zones (name, name_kn, delivery_fee_paise, min_order_paise, is_active)
    values (btrim(p_name), nullif(btrim(coalesce(p_name_kn,'')), ''),
            p_delivery_fee_paise, p_min_order_paise, p_is_active)
    returning id into v_id;
  else
    update zones set
      name = btrim(p_name),
      name_kn = nullif(btrim(coalesce(p_name_kn,'')), ''),
      delivery_fee_paise = p_delivery_fee_paise,
      min_order_paise = p_min_order_paise,
      is_active = p_is_active
    where id = p_id returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ZONE');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

/**
 * How many addresses and orders reference a zone. Deactivating a zone with
 * live customers in it should be a deliberate choice, not a surprise, so the
 * UI shows the count before you do it.
 */
create or replace function admin_zone_usage()
returns table (zone_id uuid, address_count bigint, order_count bigint)
language sql stable security definer set search_path = public as $$
  select z.id,
         (select count(*) from addresses a where a.zone_id = z.id),
         (select count(*) from orders o where o.zone_id = z.id)
  from zones z
  where is_admin()
$$;

revoke all on function admin_upsert_zone, admin_zone_usage from public, anon;
grant execute on function admin_upsert_zone, admin_zone_usage to authenticated;
