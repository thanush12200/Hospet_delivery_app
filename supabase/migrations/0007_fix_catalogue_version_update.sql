-- 0007_fix_catalogue_version_update.sql
--
-- bump_catalogue_version() ran `update catalogue_version set ...` with no
-- WHERE clause. Supabase blocks WHERE-less UPDATE/DELETE for the authenticated
-- role, so the trigger aborted every product and category write made through
-- the admin console -- while the same statements succeeded from psql, where
-- the guard does not apply. That is why it was invisible until the first RPC
-- write.
--
-- catalogue_version is a single-row table keyed on a boolean, so the WHERE is
-- exact rather than cosmetic.

create or replace function bump_catalogue_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update catalogue_version
     set version = version + 1, updated_at = now()
   where id = true;
  return null;
end $$;
