-- 0018_free_delivery_200.sql — free delivery on orders of ₹200 and above.
-- Zones without a threshold get ₹200; new zones default to it. A zone
-- deliberately set to another figure is left alone. Editable per area in
-- Admin -> Delivery areas.
alter table zones alter column free_delivery_above_paise set default 20000;
update zones set free_delivery_above_paise = 20000 where free_delivery_above_paise is null;
