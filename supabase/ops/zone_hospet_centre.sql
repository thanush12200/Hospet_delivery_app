-- Hospet becomes a real boundary: centre on the town, 6 km radius.
-- Customers whose phone places them outside this circle are asked whether
-- they are ordering for someone in Hospet; addresses must be pinned inside it.
-- Adjust radius_m to taste (metres). Admin → Delivery areas can also set it.
update zones set lat = 15.2689, lng = 76.3909, radius_m = 6000 where name = 'Hospet' and is_active;
select name, lat, lng, radius_m, is_active from zones order by is_active desc, name;
