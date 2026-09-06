-- 0022_order_alerts.sql — tell the owner about a new order wherever they are.
--
-- The admin screens already chime and flash when an order lands, but only
-- while a tab is open. This makes the database itself push a message the
-- moment an order is placed, with no server of ours to run:
--
--   notify_targets   where to send: an ntfy.sh topic (free app, the topic
--                    name is the secret) or a Telegram bot + chat id.
--                    Admin-only rows; the Telegram token lives here, never
--                    in store_config (which every customer can read).
--   pg_net           Supabase's async HTTP extension. The POST is queued and
--                    sent by a worker, so checkout never waits on Telegram.
--                    Absent locally: the sender then does nothing.
--   the trigger      a DEFERRED constraint trigger on orders: it runs at
--                    commit, after place_order() has written the items, so
--                    the message can list them.
--
-- store_config.site_url is the link in the message (admin order page).

alter table store_config add column if not exists site_url text not null default 'https://faa-dfz.pages.dev';

create table if not exists notify_targets (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('ntfy', 'telegram')),
  label        text,
  target       text not null,      -- ntfy topic, or Telegram chat id
  secret       text,               -- Telegram bot token
  is_active    boolean not null default true,
  last_sent_at timestamptz,
  created_at   timestamptz not null default now()
);

alter table notify_targets enable row level security;
drop policy if exists nt_select on notify_targets;
drop policy if exists nt_insert on notify_targets;
drop policy if exists nt_update on notify_targets;
drop policy if exists nt_delete on notify_targets;
create policy nt_select on notify_targets for select using (is_admin());
create policy nt_insert on notify_targets for insert with check (is_admin());
create policy nt_update on notify_targets for update using (is_admin()) with check (is_admin());
create policy nt_delete on notify_targets for delete using (is_admin());
grant select, insert, update, delete on notify_targets to authenticated;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not available here (%). Order alerts send only on Supabase.', sqlerrm;
end $$;

-- ================================================================
-- The message
-- ================================================================

create or replace function rupees(p_paise int) returns text
language sql immutable as $$
  select '₹' || (p_paise / 100)::text
      || case when p_paise % 100 > 0 then '.' || lpad((p_paise % 100)::text, 2, '0') else '' end
$$;

create or replace function order_alert_text(p_order_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select o.order_no || ' · ' || rupees(o.total_paise) || ' · '
      || (select count(*) from order_items oi where oi.order_id = o.id) || ' items' || E'\n'
      || coalesce((select string_agg(oi.qty || '× ' || oi.product_name, ', ' order by oi.id)
                     from order_items oi where oi.order_id = o.id), '') || E'\n'
      || coalesce(c.name, 'Customer') || ' · ' || coalesce(c.contact_phone, c.phone, '') || E'\n'
      || coalesce(a.line1, '') || coalesce(' · ' || a.landmark, '') || E'\n'
      || case o.payment_method when 'COD' then 'Cash/UPI at door' else o.payment_method::text end
      || ' · ' || to_char(o.placed_at at time zone 'Asia/Kolkata', 'HH12:MI am')
      || coalesce(E'\nNote: ' || nullif(o.note, ''), '')
  from orders o
  left join customers c on c.id = o.customer_id
  left join addresses a on a.id = o.address_id
  where o.id = p_order_id
$$;

-- ================================================================
-- The sender
-- ================================================================

create or replace function notify_targets_send(p_title text, p_text text, p_url text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 0;
  end if;
  for t in select * from notify_targets where is_active loop
    if t.kind = 'ntfy' then
      perform net.http_post(
        url  := 'https://ntfy.sh/',
        body := jsonb_build_object('topic', t.target, 'title', p_title, 'message', p_text,
                                   'priority', 4, 'tags', jsonb_build_array('shopping_cart'))
             || case when p_url is null then '{}'::jsonb else jsonb_build_object('click', p_url) end);
    elsif t.kind = 'telegram' and coalesce(t.secret, '') <> '' then
      perform net.http_post(
        url  := 'https://api.telegram.org/bot' || t.secret || '/sendMessage',
        body := jsonb_build_object('chat_id', t.target,
                                   'text', p_title || E'\n' || p_text || coalesce(E'\n' || p_url, ''),
                                   'disable_web_page_preview', true));
    else
      continue;
    end if;
    update notify_targets set last_sent_at = now() where id = t.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function notify_targets_send(text, text, text) from public, anon, authenticated;

-- ================================================================
-- Fire on every placed order, at commit
-- ================================================================

create or replace function orders_alert_on_place() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_site text;
begin
  if new.status = 'PLACED' then
    select site_url into v_site from store_config where id = true;
    perform notify_targets_send('New order ' || new.order_no, order_alert_text(new.id),
                                rtrim(coalesce(v_site, ''), '/') || '/admin/orders/' || new.id);
  end if;
  return new;
end $$;

drop trigger if exists orders_alert_on_place on orders;
create constraint trigger orders_alert_on_place
  after insert on orders
  deferrable initially deferred
  for each row execute function orders_alert_on_place();

-- ================================================================
-- "Send a test" from the settings screen
-- ================================================================

create or replace function admin_notify_test()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; v_site text;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  select site_url into v_site from store_config where id = true;
  n := notify_targets_send('FAA test alert', 'If you can read this, order alerts reach this device.', v_site);
  return jsonb_build_object('ok', true, 'sent', n,
    'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
    'targets', (select count(*) from notify_targets where is_active));
end $$;

revoke all on function admin_notify_test() from public, anon;
grant execute on function admin_notify_test() to authenticated;
