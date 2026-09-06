-- 0016_promise_15.sql — the delivery promise is 15 minutes.
-- New zones default to 15; zones still on the old 45-minute default move too.
-- A zone deliberately set to something else is left alone.
alter table zones alter column sla_minutes set default 15;
update zones set sla_minutes = 15 where sla_minutes = 45;
