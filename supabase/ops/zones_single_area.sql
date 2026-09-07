-- One real delivery area. The three test areas (Ggg, Kkk, Mmmm) have no centre
-- pin, so location detection cannot choose between them. Keep one, renamed,
-- and switch the others off (not deleted: addresses/orders may reference them).
-- Edit the name before running if you want something other than Hospet.
update zones set name = 'Hospet' where id = '33333333-0000-0000-0000-000000000001';
update zones set is_active = false where name in ('Kkk', 'Mmmm');
select id, name, is_active, delivery_fee_paise, min_order_paise, free_delivery_above_paise, lat, lng, radius_m from zones order by is_active desc, name;
