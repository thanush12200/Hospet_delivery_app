-- local_auth_shim.sql — LOCAL TESTING ONLY. Never run this on Supabase.
--
-- Supabase provides the auth schema and auth.uid(). Plain Postgres does not,
-- so 0003_rls.sql cannot be applied locally without these stubs. Supabase
-- already has real versions of everything below.

create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Supabase's auth.jwt() returns the whole claims object; phone-auth users
-- carry their verified number in the `phone` claim (digits, no +).
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

do $$ begin
  create role anon;
exception when duplicate_object then null; end $$;

do $$ begin
  create role authenticated;
exception when duplicate_object then null; end $$;

-- Supabase grants table privileges to anon/authenticated and relies on RLS as
-- the real gate. Mirror that here, otherwise local tests fail on a missing
-- GRANT and never actually exercise the policies.
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

-- 0006_images_and_ops.sql creates a bucket and policies on Supabase Storage.
-- Plain Postgres has no storage schema, so stub just enough of it for the
-- migration to apply. Nothing here is exercised by the tests.
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text,
  name      text
);
alter table storage.objects enable row level security;
