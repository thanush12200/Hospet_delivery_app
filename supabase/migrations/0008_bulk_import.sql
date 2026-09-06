-- 0008_bulk_import.sql — bulk catalogue import.
--
-- Typing 50 products through a dialog is a couple of hours. A distributor
-- already has this data in a spreadsheet, so the import takes it whole.

/**
 * Upserts many products in one transaction.
 *
 * p_rows: [{
 *   name, name_kn, brand, unit, mrp_paise, stock, category, is_active
 * }, ...]
 *
 * Matching is on (lower(name), lower(unit_label)) rather than name alone --
 * "Toor Dal 1 kg" and "Toor Dal 500 g" are different products, and matching on
 * name only would silently collapse a pack-size range into one row.
 *
 * Categories are resolved by name, case-insensitively, and created when new,
 * so an import never fails merely because a category does not exist yet.
 *
 * Returns one result per input row, in order, so the UI can show exactly which
 * line failed rather than a single opaque error.
 */
create or replace function admin_bulk_upsert_products(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          jsonb;
  idx        int := 0;
  results    jsonb := '[]'::jsonb;
  v_cat_id   uuid;
  v_prod_id  uuid;
  v_name     text;
  v_unit     text;
  v_mrp      int;
  v_stock    int;
  v_catname  text;
  v_action   text;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'EXPECTED_ARRAY');
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    v_name    := nullif(btrim(coalesce(r->>'name', '')), '');
    v_unit    := nullif(btrim(coalesce(r->>'unit', '')), '');
    v_catname := nullif(btrim(coalesce(r->>'category', '')), '');
    v_mrp     := nullif(r->>'mrp_paise', '')::int;
    v_stock   := nullif(r->>'stock', '')::int;

    if v_name is null then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Name is required');
      continue;
    end if;
    if v_mrp is null or v_mrp <= 0 then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'MRP must be greater than zero');
      continue;
    end if;
    if v_unit is null then v_unit := '1 pc'; end if;

    -- category: find case-insensitively, create if new
    if v_catname is null then v_catname := 'General'; end if;
    select id into v_cat_id from categories where lower(name) = lower(v_catname) limit 1;
    if v_cat_id is null then
      insert into categories (name, sort_order) values (v_catname, 100)
      returning id into v_cat_id;
    end if;

    select id into v_prod_id
      from products
     where lower(name) = lower(v_name) and lower(unit_label) = lower(v_unit)
     limit 1;

    if v_prod_id is null then
      insert into products (category_id, name, name_kn, brand, unit_label, mrp_paise, is_active)
      values (v_cat_id, v_name,
              nullif(btrim(coalesce(r->>'name_kn','')), ''),
              nullif(btrim(coalesce(r->>'brand','')), ''),
              v_unit, v_mrp,
              coalesce((r->>'is_active')::boolean, true))
      returning id into v_prod_id;

      insert into inventory (product_id, on_hand) values (v_prod_id, coalesce(v_stock, 0));
      v_action := 'created';
    else
      update products set
        category_id = v_cat_id,
        name_kn     = coalesce(nullif(btrim(coalesce(r->>'name_kn','')), ''), name_kn),
        brand       = coalesce(nullif(btrim(coalesce(r->>'brand','')), ''), brand),
        mrp_paise   = v_mrp,
        is_active   = coalesce((r->>'is_active')::boolean, is_active)
      where id = v_prod_id;

      -- Stock is only touched when the column was actually supplied, so a
      -- price-only reimport cannot wipe counts.
      if v_stock is not null then
        perform admin_adjust_stock(v_prod_id, v_stock, 'IMPORT');
      end if;
      v_action := 'updated';
    end if;

    results := results || jsonb_build_object(
      'row', idx, 'status', v_action, 'id', v_prod_id, 'name', v_name);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created', (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'created'),
    'updated', (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'updated'),
    'errors',  (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'error'),
    'results', results);
end $$;

revoke all on function admin_bulk_upsert_products from public, anon;
grant execute on function admin_bulk_upsert_products to authenticated;
