-- opening_stock.sql — one-off: give every listed product an opening stock.
--
-- Paste in the Supabase SQL editor. Every active product with nothing on
-- hand gets 5, 10 or 15 units at random, and a RESTOCK movement is written
-- so the ledger (Admin → Stock, stock_movements) explains where the units
-- came from. Products that already have stock are left alone, so this is
-- safe to run again. Replace the figures from Admin → Stock as real counts
-- come in.

with seeded as (
  update inventory i
     set on_hand = i.on_hand + s.units, updated_at = now()
    from (
      select p.id as product_id, (5 * (1 + floor(random() * 3)))::int as units
        from products p join inventory i2 on i2.product_id = p.id
       where p.is_active and i2.on_hand = 0
    ) s
   where i.product_id = s.product_id
  returning i.product_id, s.units
)
insert into stock_movements (product_id, delta_on_hand, reason, actor_type)
select product_id, units, 'RESTOCK', 'SYSTEM' from seeded;

-- Products that had no inventory row at all (should not happen; the import
-- creates one) get a row too.
insert into inventory (product_id, on_hand)
select p.id, (5 * (1 + floor(random() * 3)))::int
  from products p
 where p.is_active and not exists (select 1 from inventory i where i.product_id = p.id);

select count(*) filter (where i.on_hand > 0) as stocked,
       count(*) filter (where i.on_hand = 0) as still_empty
  from products p join inventory i on i.product_id = p.id
 where p.is_active;
