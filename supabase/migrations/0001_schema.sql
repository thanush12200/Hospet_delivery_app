-- 0001_schema.sql — core schema for the Hospet local delivery platform
--
-- Conventions:
--   * All money is integer PAISE. Never float, never numeric.
--   * All stock is integer units.
--   * order_items copies the price at order time; never join products for a historical price.
--   * orders.status may only be changed by transition_order() (enforced in 0002).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums

create type order_status as enum (
  'PLACED',
  'CONFIRMED',
  'PICKING',
  'PACKED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'FAILED'
);

create type payment_method as enum ('COD', 'UPI');
create type payment_status as enum ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
create type actor_type    as enum ('CUSTOMER', 'ADMIN', 'RIDER', 'SYSTEM');
create type settlement_status as enum ('OPEN', 'SETTLED', 'SHORT');

-- ---------------------------------------------------------------- catalogue

create table categories (
  id          uuid primary key default gen_random_uuid(),
  name        text    not null,
  name_kn     text,
  sort_order  int     not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table products (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  name        text not null,
  name_kn     text,                       -- Kannada name. Required in practice for Hospet.
  brand       text,
  unit_label  text not null,              -- '1 kg', '500 ml', '6 pcs'
  mrp_paise   int  not null check (mrp_paise > 0),
  image_url   text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on products (category_id) where is_active;

-- Bumped whenever the catalogue changes, so clients know to refetch their
-- cached copy instead of polling. See the client-side IndexedDB cache.
create table catalogue_version (
  id         boolean primary key default true check (id),
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);
insert into catalogue_version default values;

create or replace function bump_catalogue_version() returns trigger
language plpgsql as $$
begin
  update catalogue_version set version = version + 1, updated_at = now();
  return null;
end $$;

create trigger products_bump_catalogue
  after insert or update or delete on products
  for each statement execute function bump_catalogue_version();

create trigger categories_bump_catalogue
  after insert or update or delete on categories
  for each statement execute function bump_catalogue_version();

-- ---------------------------------------------------------------- inventory

create table inventory (
  product_id uuid primary key references products(id) on delete cascade,
  on_hand    int not null default 0 check (on_hand  >= 0),
  reserved   int not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  constraint reserved_not_over_hand check (reserved <= on_hand)
);

-- available = on_hand - reserved
create view inventory_available as
  select product_id, on_hand, reserved, (on_hand - reserved) as available
  from inventory;

-- Every stock movement is recorded. Makes shrinkage findable.
create table stock_movements (
  id          bigserial primary key,
  product_id  uuid not null references products(id),
  delta_on_hand  int not null default 0,
  delta_reserved int not null default 0,
  reason      text not null,             -- 'ORDER_RESERVE','ORDER_PACK','ORDER_CANCEL','RESTOCK','ADJUST'
  order_id    uuid,
  actor_type  actor_type not null default 'SYSTEM',
  actor_id    uuid,
  created_at  timestamptz not null default now()
);

create index on stock_movements (product_id, created_at desc);

-- ---------------------------------------------------------------- people & places

create table zones (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  name_kn            text,
  delivery_fee_paise int not null default 0 check (delivery_fee_paise >= 0),
  min_order_paise    int not null default 0 check (min_order_paise    >= 0),
  is_active          boolean not null default true
);

create table customers (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null unique,        -- E.164, e.g. +919900000000
  name       text,
  auth_uid   uuid unique,                 -- supabase auth.users.id
  created_at timestamptz not null default now()
);

create table addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  zone_id     uuid not null references zones(id),
  line1       text not null,
  landmark    text,                       -- matters more than lat/lng in Hospet
  lat         double precision,
  lng         double precision,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index on addresses (customer_id);

create table riders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null unique,
  auth_uid   uuid unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table admin_users (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null unique,
  auth_uid   uuid unique,
  role       text not null default 'STAFF' check (role in ('OWNER','STAFF')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- orders

create sequence order_no_seq start 1001;

create table orders (
  id                 uuid primary key default gen_random_uuid(),
  order_no           text not null unique default 'H' || nextval('order_no_seq')::text,
  customer_id        uuid not null references customers(id),
  address_id         uuid not null references addresses(id),
  zone_id            uuid not null references zones(id),
  status             order_status not null default 'PLACED',
  subtotal_paise     int not null check (subtotal_paise     >= 0),
  delivery_fee_paise int not null check (delivery_fee_paise >= 0),
  total_paise        int not null check (total_paise        >= 0),
  payment_method     payment_method not null,
  payment_status     payment_status not null default 'PENDING',
  rider_id           uuid references riders(id),
  note               text,
  placed_at          timestamptz not null default now(),
  delivered_at       timestamptz
);

create index on orders (status, placed_at desc);
create index on orders (customer_id, placed_at desc);
create index on orders (rider_id, placed_at desc) where rider_id is not null;

create table order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  product_id      uuid not null references products(id),
  qty             int  not null check (qty > 0),
  fulfilled_qty   int,                    -- null until PACKED; may be < qty on a short pick
  unit_mrp_paise  int  not null check (unit_mrp_paise > 0),  -- COPIED at order time
  line_total_paise int not null check (line_total_paise >= 0),
  product_name    text not null,          -- snapshot, so history survives a rename
  unique (order_id, product_id)
);

create index on order_items (order_id);

-- Append-only. Nothing here is ever updated or deleted.
create table order_events (
  id          bigserial primary key,
  order_id    uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status   order_status not null,
  actor_type  actor_type not null,
  actor_id    uuid,
  note        text,
  created_at  timestamptz not null default now()
);

create index on order_events (order_id, created_at);

-- ---------------------------------------------------------------- money

create table payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id) on delete cascade,
  method              payment_method not null,
  amount_paise        int not null check (amount_paise >= 0),
  status              payment_status not null default 'PENDING',
  razorpay_order_id   text,
  razorpay_payment_id text,
  collected_by_rider_id uuid references riders(id),
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);

create index on payments (order_id);
create unique index on payments (razorpay_payment_id) where razorpay_payment_id is not null;

create table rider_settlements (
  id                   uuid primary key default gen_random_uuid(),
  rider_id             uuid not null references riders(id),
  settlement_date      date not null,
  cash_expected_paise  int not null default 0,
  cash_deposited_paise int,
  status               settlement_status not null default 'OPEN',
  note                 text,
  created_at           timestamptz not null default now(),
  settled_at           timestamptz,
  unique (rider_id, settlement_date)
);

-- ---------------------------------------------------------------- updated_at

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger products_touch  before update on products  for each row execute function touch_updated_at();
create trigger inventory_touch before update on inventory for each row execute function touch_updated_at();
