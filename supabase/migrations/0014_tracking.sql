-- 0014_tracking.sql — what the customer's order screen needs.
--
--   my_order_rider(order)   name and phone of the rider bringing MY order,
--                           only while it is out for delivery. A SECURITY
--                           DEFINER function rather than a wider riders
--                           policy: phone numbers must not become browsable.
--   cancel_my_order(order)  the customer-facing wrapper over transition_order
--                           (authorisation and the window live there, 0011).

create or replace function my_order_rider(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cust uuid := current_customer_id(); r record;
begin
  if v_cust is null then return null; end if;
  select rd.name, rd.phone
    into r
  from orders o
  join riders rd on rd.id = o.rider_id
  where o.id = p_order_id
    and o.customer_id = v_cust
    and o.status = 'OUT_FOR_DELIVERY';
  if not found then return null; end if;
  return jsonb_build_object('name', r.name, 'phone', r.phone);
end $$;

create or replace function cancel_my_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return transition_order(p_order_id, 'CANCELLED', 'CUSTOMER', null,
                          nullif(left(btrim(coalesce(p_reason, '')), 200), ''));
end $$;

revoke all on function my_order_rider(uuid), cancel_my_order(uuid, text) from public, anon;
grant execute on function my_order_rider(uuid), cancel_my_order(uuid, text) to authenticated;
