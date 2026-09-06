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
