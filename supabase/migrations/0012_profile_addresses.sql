-- 0012_profile_addresses.sql — the customer's own profile and address book.
--
-- Until now an address could only be added (at checkout), never edited,
-- deleted, labelled or made the default; is_default existed but nothing set
-- it. A customer's name was captured once at first login and frozen.
--
-- Addresses are soft-deleted: orders.address_id must keep pointing at the
-- address the order was delivered to, so a delete sets deleted_at and the
-- client filters. Exactly one live default per customer is enforced by a
-- partial unique index, not just by the functions.
--
-- Writes on customers/addresses go through the functions below. Direct row
-- writes by customers are closed (customers in 0011, addresses here): the
-- functions validate the zone, keep the default invariant and never let a
-- customer touch phone/auth_uid.

-- ================================================================
-- addresses: label, soft delete, one default
-- ================================================================

alter table addresses
  add column if not exists label text not null default 'HOME'
    check (label in ('HOME', 'WORK', 'OTHER')),
  add column if not exists deleted_at timestamptz;

-- Repair before constraining: keep the newest default where there are
-- several, and give customers with none their newest address.
with ranked as (
  select id, row_number() over (partition by customer_id order by created_at desc, id) as rn
  from addresses where is_default and deleted_at is null
)
update addresses a set is_default = false
from ranked r where a.id = r.id and r.rn > 1;

with newest as (
  select distinct on (customer_id) id
  from addresses
  where deleted_at is null
    and customer_id not in (select customer_id from addresses where is_default and deleted_at is null)
  order by customer_id, created_at desc, id
)
update addresses a set is_default = true from newest n where a.id = n.id;

create unique index if not exists addresses_one_default_idx
  on addresses (customer_id) where is_default and deleted_at is null;

create index if not exists addresses_customer_live_idx
  on addresses (customer_id) where deleted_at is null;

-- ================================================================
-- Profile
-- ================================================================

create or replace function update_my_profile(p_name text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cust uuid := current_customer_id(); v_name text := nullif(trim(p_name), '');
begin
  if v_cust is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if v_name is null or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  end if;
  update customers set name = v_name where id = v_cust;
  return jsonb_build_object('ok', true, 'name', v_name);
end $$;

-- ================================================================
-- link_current_user_to_customer — phone from the JWT, not the client.
-- ================================================================
--
-- The phone number used to come from the request body, so a signed-in user
-- could adopt any unlinked customer record by naming its number. Supabase
-- puts the verified number in the JWT's `phone` claim (digits, no +); that is
-- the one that counts. The parameter remains only as a fallback for staff
-- accounts, which sign in by email and carry no phone claim.

create or replace function link_current_user_to_customer(
  p_phone text,
  p_name  text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_uid   uuid := auth.uid();
  v_jwt   text := nullif(auth.jwt() ->> 'phone', '');
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
  else
    raise exception 'no verified phone on this session' using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from customers where phone = v_phone;
  if v_id is not null then
    update customers
       set auth_uid = v_uid, name = coalesce(name, nullif(trim(p_name), ''))
     where id = v_id and auth_uid is null;
    if not found then
      raise exception 'phone already linked to another account'
        using errcode = 'unique_violation';
    end if;
    return v_id;
  end if;

  insert into customers (phone, name, auth_uid)
  values (v_phone, nullif(trim(p_name), ''), v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- ================================================================
-- Address book
-- ================================================================

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
  if not exists (select 1 from zones where id = p_zone_id and is_active) then
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
    values (v_cust, p_zone_id, v_line1, nullif(trim(p_landmark), ''), v_label,
            p_is_default or v_first, p_lat, p_lng)
    returning id into v_id;
  else
    update addresses
       set zone_id    = p_zone_id,
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

create or replace function set_default_address(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cust uuid := current_customer_id();
begin
  if v_cust is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  perform 1 from customers where id = v_cust for update;
  if not exists (select 1 from addresses
                 where id = p_id and customer_id = v_cust and deleted_at is null) then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ADDRESS');
  end if;
  update addresses set is_default = false
   where customer_id = v_cust and is_default and deleted_at is null and id <> p_id;
  update addresses set is_default = true where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function delete_my_address(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cust uuid := current_customer_id(); v_next uuid;
begin
  if v_cust is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  perform 1 from customers where id = v_cust for update;

  update addresses
     set deleted_at = now(), is_default = false
   where id = p_id and customer_id = v_cust and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SUCH_ADDRESS');
  end if;

  -- If that was the default, the newest remaining address takes over.
  if not exists (select 1 from addresses
                 where customer_id = v_cust and is_default and deleted_at is null) then
    select id into v_next from addresses
     where customer_id = v_cust and deleted_at is null
     order by created_at desc, id limit 1;
    if v_next is not null then
      update addresses set is_default = true where id = v_next;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'new_default', v_next);
end $$;

-- Keep the pre-0012 entry point working for clients that have not updated.
create or replace function add_my_address(
  p_zone_id uuid, p_line1 text, p_landmark text default null,
  p_lat double precision default null, p_lng double precision default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := upsert_my_address(null, p_zone_id, p_line1, p_landmark, 'HOME', false, p_lat, p_lng);
  if not (r->>'ok')::boolean then
    raise exception '%', r->>'error' using errcode = 'invalid_parameter_value';
  end if;
  return (r->>'id')::uuid;
end $$;

-- Staff-entered addresses follow the same default rule.
create or replace function admin_add_address(
  p_customer_id uuid, p_zone_id uuid, p_line1 text,
  p_landmark text default null,
  p_lat double precision default null, p_lng double precision default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_first boolean;
begin
  if auth.uid() is not null and not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from customers where id = p_customer_id for update;
  select not exists (select 1 from addresses where customer_id = p_customer_id and deleted_at is null)
    into v_first;
  insert into addresses (customer_id, zone_id, line1, landmark, lat, lng, is_default)
  values (p_customer_id, p_zone_id, p_line1, p_landmark, p_lat, p_lng, v_first)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function
  update_my_profile(text),
  upsert_my_address(uuid, uuid, text, text, text, boolean, double precision, double precision),
  set_default_address(uuid),
  delete_my_address(uuid)
  from public, anon;

grant execute on function
  update_my_profile(text),
  upsert_my_address(uuid, uuid, text, text, text, boolean, double precision, double precision),
  set_default_address(uuid),
  delete_my_address(uuid)
  to authenticated;

-- ================================================================
-- addresses: customers write through the functions only
-- ================================================================

drop policy if exists addr_insert on addresses;
drop policy if exists addr_update on addresses;
drop policy if exists addr_delete on addresses;
create policy addr_insert on addresses for insert with check (is_admin());
create policy addr_update on addresses for update using (is_admin()) with check (is_admin());
create policy addr_delete on addresses for delete using (is_admin());
