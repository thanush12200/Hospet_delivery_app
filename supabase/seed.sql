-- seed.sql — minimal fixture for local testing.
-- Fixed UUIDs so tests can reference them directly.

insert into categories (id, name, name_kn, sort_order) values
  ('11111111-0000-0000-0000-000000000001', 'Staples',    'ದಿನಸಿ',   1),
  ('11111111-0000-0000-0000-000000000002', 'Beverages',  'ಪಾನೀಯ',  2);

insert into products (id, category_id, name, name_kn, brand, unit_label, mrp_paise) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'Sona Masoori Rice', 'ಸೋನಾ ಮಸೂರಿ ಅಕ್ಕಿ', 'Local', '5 kg',  35000),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'Toor Dal',          'ತೊಗರಿ ಬೇಳೆ',      'Local', '1 kg',  16500),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002',
   'Tea Powder',        'ಚಹಾ ಪುಡಿ',        'Red Label', '250 g', 14000);

insert into inventory (product_id, on_hand, reserved) values
  ('22222222-0000-0000-0000-000000000001', 10, 0),
  ('22222222-0000-0000-0000-000000000002', 10, 0),
  ('22222222-0000-0000-0000-000000000003',  1, 0);   -- deliberately scarce

-- No free-delivery threshold on the test zone (the live default is ₹200), so
-- the fee assertions below stay exact; T10 sets one explicitly.
insert into zones (id, name, delivery_fee_paise, min_order_paise, free_delivery_above_paise) values
  ('33333333-0000-0000-0000-000000000001', 'Chittawadgi', 2000, 10000, null);

-- auth_uid values mirror what Supabase Auth would assign. Tests impersonate a
-- user by setting request.jwt.claim.sub to one of these and switching to the
-- authenticated role (see rls_test.sql for the idiom).
insert into customers (id, phone, name, auth_uid) values
  ('44444444-0000-0000-0000-000000000001', '+919900000001', 'Test Customer',
   '77777777-0000-0000-0000-000000000001'),
  ('44444444-0000-0000-0000-000000000002', '+919900000003', 'Other Customer',
   '77777777-0000-0000-0000-000000000002');

insert into addresses (id, customer_id, zone_id, line1, landmark, is_default) values
  ('55555555-0000-0000-0000-000000000001',
   '44444444-0000-0000-0000-000000000001',
   '33333333-0000-0000-0000-000000000001',
   '2nd Cross, Chittawadgi', 'Near Anjaneya Temple', true);

insert into addresses (id, customer_id, zone_id, line1, landmark, is_default) values
  ('55555555-0000-0000-0000-000000000002',
   '44444444-0000-0000-0000-000000000002',
   '33333333-0000-0000-0000-000000000001',
   'Station Road', 'Opp. bus stand', true);

insert into riders (id, name, phone, auth_uid) values
  ('66666666-0000-0000-0000-000000000001', 'Test Rider', '+919900000002',
   '77777777-0000-0000-0000-000000000011');

insert into admin_users (id, name, phone, auth_uid, role) values
  ('88888888-0000-0000-0000-000000000001', 'Test Owner', '+919900000009',
   '77777777-0000-0000-0000-000000000021', 'OWNER');
