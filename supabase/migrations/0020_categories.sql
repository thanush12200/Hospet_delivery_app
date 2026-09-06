-- 0020_categories.sql — a shelf order for categories.
--
-- Categories arrived two ways: the 0001 seed ("Staples", "Beverages" at
-- sort_order 1 and 2) and the CSV import, which gave every new category the
-- same sort_order 100. The storefront therefore opened with an empty seed
-- category first and the real ones in alphabetical order, "Cleaning" ahead
-- of "Rice & Atta".
--
--   1. Known grocery categories get the order a customer walks a shop in:
--      fresh first, staples next, then snacks and drinks, then non-food.
--   2. Anything else keeps its relative order after the shelf.
--   3. Categories with no active product are hidden; the storefront also
--      hides them client-side, so an emptied category disappears at once.
--   4. Bulk import places a NEW category after the last one, in file order,
--      instead of at a fixed 100. Existing categories keep their slot.
--
-- Admins reorder, rename and hide categories from Admin → Categories; the
-- 0005 policies already allow that as row updates.

-- 1. canonical shelf order
with shelf(name, o) as (values
  ('Fruits & Vegetables', 10),
  ('Dairy & Bread',       20),
  ('Rice & Atta',         30),
  ('Dals & Pulses',       40),
  ('Oil & Ghee',          50),
  ('Masala & Spices',     60),
  ('Snacks & Biscuits',   70),
  ('Tea & Coffee',        80),
  ('Personal Care',       90),
  ('Household',          100),
  ('Cleaning',           110)
)
update categories c set sort_order = shelf.o
from shelf where lower(c.name) = lower(shelf.name);

-- 2. everything else after the shelf, keeping its current relative order
with rest as (
  select id, row_number() over (order by sort_order, name) as rn
  from categories
  where lower(name) not in (
    'fruits & vegetables', 'dairy & bread', 'rice & atta', 'dals & pulses',
    'oil & ghee', 'masala & spices', 'snacks & biscuits', 'tea & coffee',
    'personal care', 'household', 'cleaning')
)
update categories c set sort_order = 500 + rest.rn * 10 from rest where c.id = rest.id;

-- 3. hide categories that have nothing to sell
update categories c set is_active = false
where c.is_active
  and not exists (select 1 from products p where p.category_id = c.id and p.is_active);

-- 4. bulk import: new categories go after the last one, in file order
create or replace function admin_bulk_upsert_products(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; idx int := 0; results jsonb := '[]'::jsonb;
  v_cat_id uuid; v_prod_id uuid; v_name text; v_unit text; v_mrp int; v_stock int;
  v_catname text; v_cat_kn text; v_desc text; v_image text; v_action text; v_res jsonb; v_sale int;
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
    v_cat_kn  := nullif(btrim(coalesce(r->>'category_kn', '')), '');
    v_desc    := nullif(btrim(coalesce(r->>'description', '')), '');
    v_image   := nullif(btrim(coalesce(r->>'image_url', '')), '');
    v_mrp     := nullif(r->>'mrp_paise', '')::int;
    v_stock   := nullif(r->>'stock', '')::int;
    v_sale    := nullif(r->>'sale_price_paise', '')::int;

    if v_name is null then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Name is required'); continue;
    end if;
    if v_mrp is null or v_mrp <= 0 then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'MRP must be greater than zero'); continue;
    end if;
    if v_stock is not null and v_stock < 0 then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Stock cannot be negative'); continue;
    end if;
    if v_sale is not null and (v_sale <= 0 or v_sale >= v_mrp) then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'Deal price must be below the MRP'); continue;
    end if;
    if v_image is not null and v_image !~ '^https?://' then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'image_url must start with http(s)://'); continue;
    end if;
    if v_unit is null then v_unit := '1 pc'; end if;
    if v_catname is null then v_catname := 'General'; end if;

    select id into v_cat_id from categories where lower(name) = lower(v_catname) limit 1;
    if v_cat_id is null then
      insert into categories (name, name_kn, sort_order)
      values (v_catname, v_cat_kn, (select coalesce(max(sort_order), 0) + 10 from categories))
      returning id into v_cat_id;
    elsif v_cat_kn is not null then
      update categories set name_kn = v_cat_kn where id = v_cat_id and name_kn is distinct from v_cat_kn;
    end if;

    select id into v_prod_id from products
     where lower(name) = lower(v_name) and lower(unit_label) = lower(v_unit) limit 1;

    if v_prod_id is null then
      insert into products (category_id, name, name_kn, brand, unit_label, mrp_paise, is_active, description, image_url, sale_price_paise)
      values (v_cat_id, v_name, nullif(btrim(coalesce(r->>'name_kn','')), ''), nullif(btrim(coalesce(r->>'brand','')), ''),
              v_unit, v_mrp, coalesce((r->>'is_active')::boolean, true), v_desc, v_image, v_sale)
      returning id into v_prod_id;
      insert into inventory (product_id, on_hand) values (v_prod_id, coalesce(v_stock, 0));
      v_action := 'created';
    else
      -- Stock first, so a refused count leaves the row's other fields alone.
      if v_stock is not null then
        v_res := admin_adjust_stock(v_prod_id, v_stock, 'IMPORT');
        if not (v_res->>'ok')::boolean then
          results := results || jsonb_build_object('row', idx, 'status', 'error', 'name', v_name,
            'message', 'Stock ' || v_stock || ' is below the ' || coalesce(v_res->>'reserved', '?') || ' unit(s) reserved for live orders');
          continue;
        end if;
      end if;
      update products set
        category_id = v_cat_id,
        name_kn     = coalesce(nullif(btrim(coalesce(r->>'name_kn','')), ''), name_kn),
        brand       = coalesce(nullif(btrim(coalesce(r->>'brand','')), ''), brand),
        mrp_paise   = v_mrp,
        is_active   = coalesce((r->>'is_active')::boolean, is_active),
        description = coalesce(v_desc, description),
        image_url   = coalesce(v_image, image_url),
        -- a blank cell leaves a running deal alone; clear deals from the product form
        sale_price_paise = coalesce(v_sale, sale_price_paise)
      where id = v_prod_id;
      v_action := 'updated';
    end if;

    results := results || jsonb_build_object('row', idx, 'status', v_action, 'id', v_prod_id, 'name', v_name);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'created', (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'created'),
    'updated', (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'updated'),
    'errors',  (select count(*) from jsonb_array_elements(results) x where x->>'status' = 'error'),
    'results', results);
end $$;

-- Cached catalogues carry the old order; make every client refetch.
update catalogue_version set version = version + 1 where id = true;
