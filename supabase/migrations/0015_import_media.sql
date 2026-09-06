-- 0015_import_media.sql — the CSV import carries descriptions, images and
-- Kannada category names.
--
-- Same function, same signature (jsonb in, jsonb out); each row may now also
-- carry: description, image_url, category_kn. On update these follow the
-- existing rule: a blank column leaves the stored value alone, so a
-- price-only reimport never wipes a photo or a description.

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
  v_cat_kn   text;
  v_desc     text;
  v_image    text;
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
    v_cat_kn  := nullif(btrim(coalesce(r->>'category_kn', '')), '');
    v_desc    := nullif(btrim(coalesce(r->>'description', '')), '');
    v_image   := nullif(btrim(coalesce(r->>'image_url', '')), '');
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
    if v_image is not null and v_image !~ '^https?://' then
      results := results || jsonb_build_object('row', idx, 'status', 'error', 'message', 'image_url must start with http(s)://');
      continue;
    end if;
    if v_unit is null then v_unit := '1 pc'; end if;

    if v_catname is null then v_catname := 'General'; end if;
    select id into v_cat_id from categories where lower(name) = lower(v_catname) limit 1;
    if v_cat_id is null then
      insert into categories (name, name_kn, sort_order) values (v_catname, v_cat_kn, 100)
      returning id into v_cat_id;
    elsif v_cat_kn is not null then
      update categories set name_kn = v_cat_kn where id = v_cat_id and name_kn is distinct from v_cat_kn;
    end if;

    select id into v_prod_id
      from products
     where lower(name) = lower(v_name) and lower(unit_label) = lower(v_unit)
     limit 1;

    if v_prod_id is null then
      insert into products (category_id, name, name_kn, brand, unit_label, mrp_paise, is_active,
                            description, image_url)
      values (v_cat_id, v_name,
              nullif(btrim(coalesce(r->>'name_kn','')), ''),
              nullif(btrim(coalesce(r->>'brand','')), ''),
              v_unit, v_mrp,
              coalesce((r->>'is_active')::boolean, true),
              v_desc, v_image)
      returning id into v_prod_id;

      insert into inventory (product_id, on_hand) values (v_prod_id, coalesce(v_stock, 0));
      v_action := 'created';
    else
      update products set
        category_id = v_cat_id,
        name_kn     = coalesce(nullif(btrim(coalesce(r->>'name_kn','')), ''), name_kn),
        brand       = coalesce(nullif(btrim(coalesce(r->>'brand','')), ''), brand),
        mrp_paise   = v_mrp,
        is_active   = coalesce((r->>'is_active')::boolean, is_active),
        description = coalesce(v_desc, description),
        image_url   = coalesce(v_image, image_url)
      where id = v_prod_id;

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
