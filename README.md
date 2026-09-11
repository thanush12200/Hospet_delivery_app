# FAA — Fast at any Accuracy

**FAA it, get it, love it.** Everyday essentials, delivered in minutes. 🛵

Local grocery delivery for **Hospet (Hosapete), Vijayanagara district, Karnataka** — a customer PWA, a rider app and an admin console over a Postgres core. (The project began as "Wink"; the Cloudflare Pages project and a few internal names still carry that.)

No national quick-commerce platform serves Hospet. Blinkit, Zepto, Swiggy Instamart and Flipkart Minutes have all skipped it, and Amazon Hub Delivery is not open for pincode 583201 (verified September 2026). Around 200,000 people here have no delivery service at all.

This project serves that market from an existing FMCG distributorship — the stock, warehouse and vehicles already exist. It is a single dark store, not a marketplace.

An end-to-end flow audit with the decisions taken on it lives in [docs/APP_FLOW_AUDIT.md](docs/APP_FLOW_AUDIT.md).

---

## What makes this different from a 10-minute clone

| | Quick-commerce majors | This |
|---|---|---|
| Delivery promise | 10 minutes | **15 minutes** (per-area `zones.sla_minutes`) |
| Catalogue | 2,000+ SKUs | **300–500 fast movers** |
| Pricing | Discounted below MRP | **MRP by default, deals when the store chooses** — the retail margin is the business |
| Break-even | 1,000+ orders/day | **30–50 orders/day** |

In a town where the alternative is walking to the shop, a 15-minute promise from a single store a few minutes away is achievable without the cost structure of the metro players, and it is profitable at a volume this market can actually produce.

---

## Architecture

Deliberately boring: one repo, one database, three surfaces.

- **Frontend** — React 18 · TypeScript (strict) · Vite · MUI v7 · React Router 6
- **Backend** — Supabase (Postgres + Auth + RLS). No separate API tier.
- **Database region** — `ap-south-1` (Mumbai). Non-negotiable for latency.
- **PWA** — `vite-plugin-pwa` + Workbox. Installable, offline catalogue, no Play Store.
- **Payments** — Cash or UPI at the door, paid to the store's own UPI QR. The rider records what was collected; staff confirm UPI credits before an order counts as paid. No gateway yet; see the flow audit for the reasoning.

There is intentionally **no Node backend**. Row Level Security plus a handful of Postgres functions covers this domain; an API tier would be a month of work that buys nothing at this scale.

### The two functions that matter

Everything that touches stock or money goes through one of these. Nothing else may.

**`place_order()`** — atomic reserve-and-create. Locks every inventory row in a deterministic order (by `product_id`, to avoid deadlock), verifies availability, **recomputes the total server-side** from `products.mrp_paise`, and reserves stock — all in one transaction. A total sent by the client is used only as a cross-check and is rejected on mismatch.

**`transition_order()`** — the only legal way to move an order's status. Validates the transition, applies the stock and cash side effects, and writes an audit event, atomically.

Both derive **who is calling from `auth.uid()`**, never from their parameters (`0011_authz.sql`): staff may do anything legal, the assigned rider may pick up and deliver, the customer may cancel their own order inside `store_config.cancel_window_minutes`, and anyone else gets `NOT_AUTHORIZED`. A null `auth.uid()` is the trusted service context (psql, `service_role`), which is what the SQL suites and any future webhook run as.

```
PLACED ──> CONFIRMED ──> PICKING ──> PACKED ──> OUT_FOR_DELIVERY ──> DELIVERED
   │            │            │           │                │
   └──> CANCELLED <──────────┘           └──> ... ────────┴──> FAILED
```

A database trigger rejects any direct `UPDATE orders SET status`. `order_events` is append-only and cannot be edited or deleted.

### Security Advisor

`0005` resolves everything Supabase's Security Advisor raised, and the reasoning is worth keeping:

- **Security Definer View (critical)** — a Postgres view runs with its *owner's* privileges by default, bypassing RLS on the tables beneath it. `inventory_available` is now `security_invoker = true` so it respects the caller's own policies. Nothing leaked today, because `inventory` has a permissive read policy — but the view would have kept returning rows if that policy were ever tightened, which is a trap for whoever changes it next.
- **Function Search Path Mutable** — a `SECURITY DEFINER` function without a pinned `search_path` can be hijacked by someone able to create a shadowing object in an earlier schema. All functions now pin it.
- **Auth RLS Initialization Plan** — a bare `auth.uid()` in a policy is re-evaluated for *every row scanned*. Written as `(select auth.uid())` the planner treats it as a one-time initplan. On a large `orders` table that is one call instead of hundreds of thousands.
- **Multiple Permissive Policies** — catalogue tables had both a `FOR SELECT` read policy and a `FOR ALL` write policy, so every read evaluated two and OR'd them. Write policies are now explicit `INSERT`/`UPDATE`/`DELETE`, leaving exactly one policy per read.

A test helper (`assert_eq`) had also reached the live database by running the lifecycle suite against Supabase. Dropped.

### Row Level Security

The anon key ships inside the frontend and is readable by anyone, so it is not a secret. `0003_rls.sql` makes it harmless:

- The **catalogue is public** — the shop works logged out.
- **Everything else is private to its owner.** A customer sees only their own orders, addresses and payments; a rider sees only orders assigned to them; an admin sees all.
- **No client may write to `orders`, `order_items`, `order_events`, `payments` or `inventory` at all.** Those tables have RLS enabled and deliberately *no* write policy, so every mutation must go through the `SECURITY DEFINER` functions above.

### Three rules that keep the data honest

1. **`order_items` copies the price at order time.** Never join `products` for a historical price — changing an MRP tomorrow must not rewrite what a customer paid last week.
2. **Status never changes without an `order_events` row.** When an order goes wrong at 8pm, you need to know who did what, and when.
3. **All money is integer paise.** No floats, no rounding surprises.

---

## Performance budget

The customer app has to work on a low-end Android phone over patchy 4G. These are enforced, not aspirational:

| Metric | Budget | Current |
|---|---|---|
| Initial JS, customer route (gzipped) | < 200 KB | **~186 KB** |
| Time to interactive, mid-range Android / 4G | < 3 s | to measure in the field |
| Catalogue browse and search | instant, zero network | ✅ |
| Add to cart | instant, optimistic | ✅ |

**How browsing is made instant:** the catalogue is only 300–500 SKUs — roughly 100 KB of JSON. The whole thing ships to the client once, is cached in IndexedDB, and all filtering and search happen locally. No pagination, no search endpoint, no round trip. It also works offline, and only refetches when `catalogue_version` changes.

Live stock is the deliberate exception — it is never cached. Showing a stale "in stock" is how you end up cancelling orders.

---

## Getting started on a new machine

```bash
git clone https://github.com/thanush12200/Hospet_delivery_app.git wink
cd wink
npm install
```

### 1. Environment (required)

Three files are deliberately **not** in git because they hold secrets. Recreate them:

**`.env`** — the app will not boot without it:

```
VITE_SUPABASE_URL=https://troouqapzkufohftxvne.supabase.co
VITE_SUPABASE_ANON_KEY=<Supabase -> Settings -> API Keys -> anon / publishable>
```

**`.pgpass_raw`** — only needed to run migrations or tests against the live
database from the terminal:

```bash
printf '%s' '<your Supabase database password>' > .pgpass_raw
chmod 600 .pgpass_raw
```

If you have lost the password: Supabase → Settings → Database → Reset database
password. Nothing else depends on it.

### 2. Run it

```bash
npm run dev               # http://localhost:3020
```

### 3. Deploying from this machine (optional)

Pushing to `main` deploys automatically via GitHub Actions, so this is only
needed for an out-of-band deploy:

```bash
npx wrangler@3 login      # opens a browser
npm run build
npx wrangler@3 pages deploy dist --project-name=wink
```

Wrangler v3 is pinned because v4 requires Node 22.

### 4. Local database (optional)

Only needed to run the SQL test suites offline:

```bash
npm run db:reset          # create hospet_test, apply migrations, seed
npm run db:test           # reset, then run the full test suite
```

### Applying migrations to Supabase

`scripts/remote-psql.sh` connects to the live database, or paste the files in
`supabase/migrations/` into the SQL editor in numeric order.

Supabase's direct host `db.<ref>.supabase.co` publishes only an IPv6 address.
On an IPv4-only network it will not resolve at all, which is why the script
goes through the Supavisor pooler (`aws-0-ap-south-1`, session mode 5432)
instead. Session mode is required — transaction mode (6543) does not support
everything migrations need.

**Never run `supabase/tests/local_auth_shim.sql` against Supabase.** It stubs
`auth.uid()` and the `anon` / `authenticated` roles for plain Postgres;
Supabase has real versions and the shim would overwrite them.

### Test phone numbers (no SMS provider needed)

Customers sign in by phone OTP. Until an SMS provider is configured, add test
numbers in Supabase → Authentication → Providers → Phone → **Test phone numbers**,
e.g. `+919900000001 → 123456`. Those numbers sign in with the fixed code and
behave exactly like real customers.

### Store settings

`store_config` is a single row: support phone and WhatsApp number (shown on
the Help screen and on every order), the customer cancellation window, and an
open/closed switch with a message. Edit it in the SQL editor for now:

```sql
update store_config set phone = '+91XXXXXXXXXX', whatsapp = '+91XXXXXXXXXX',
  cancel_window_minutes = 5, is_open = true;
```

### Delivery area boundary

A delivery area with a centre pin and a radius is a boundary (migrations 0023
and 0024). On landing the app reads the phone's position: inside the circle
the customer walks straight in; outside it they are asked "are you ordering
for someone in Hospet?" and pick the spot by name, which becomes the starting
pin of their address. The server refuses an address whose pin lies outside
the area, whatever the client says. An area with no centre accepts anyone,
which is why a fresh store starts that way. Set the pin from Admin → Delivery
areas ("Use my location" at the shop) or in SQL:

```sql
update zones set lat = 15.2689, lng = 76.3909, radius_m = 6000 where name = 'Hospet';
```

### Creating the first admin

The admin console needs a Supabase auth user linked to an `admin_users` row. Being signed in is not enough — every admin RPC re-checks `is_admin()` server-side.

1. Supabase dashboard → **Authentication → Users → Add user**. Email + password, tick **Auto Confirm User**.
2. Then run, with that email:

```sql
insert into admin_users (name, phone, auth_uid, role)
select 'Owner', '+91XXXXXXXXXX', id, 'OWNER'
from auth.users where email = 'you@example.com';
```

Sign in at `/admin`.

### Verifying correctness

```bash
npm run db:test           # reset with EVERY migration, then lifecycle + RLS + oversell
npm test                  # Vitest: phone normaliser, pricing rule, reorder, geo, money, search
node scripts/bundle-budget.mjs   # gzipped JS behind "/" after `npm run build`; fails over 200 KB
```

`db:test` needs a role that can create databases (`PGUSER=<superuser> npm run db:test` if your shell defaults to another role).

`local_auth_shim.sql` stubs `auth.uid()`, `auth.jwt()`, the `anon`/`authenticated` roles and just enough of the `storage` schema so every migration applies on plain Postgres. **Never run the shim against Supabase** — it has real versions of all of it.

The lifecycle suite covers ~110 assertions: price-tamper rejection, illegal transitions, reservation release on cancel, restocking after a cancelled pack, bill recomputation on a short pick, COD cash reconciliation, the append-only guarantee, and (T6–T13) every authorisation branch — impersonating seeded customers, the rider and the owner by setting the JWT claim and switching to the `authenticated` role — plus the address book invariants and the tracking helpers.

**The oversell test is the important one.** It fires N concurrent `place_order()` calls at a product with limited stock and asserts that exactly as many succeed as there were units — no more. Verified at 40-way concurrency with zero deadlocks.

```
Firing 40 concurrent orders for a product with available=5 ...
  succeeded : 5
  out_of_stock: 35
  errors    : 0
PASS  no oversell under 40-way concurrency (sold exactly 5 of 5)
```

Overselling destroys customer trust faster than slow delivery does. It is the one thing in this system that cannot be wrong.

The RLS suite proves the anon key can read the catalogue but cannot read another customer's orders, insert an order, alter stock, delete records, or call the order functions without logging in; that a rider sees the customer and address of an assigned live order and nothing else; and that a customer sees only themself.

One subtlety worth knowing when reading these tests: **RLS filters rows, it does not raise.** A blocked `UPDATE` matches zero rows and returns successfully. Assertions must therefore check rows affected, not catch an exception.

---

## Project structure

```
src/
  api/          typed Supabase queries — catalogue, customer, inventory, rider, admin
  auth/         AuthProvider (session), RequireAuth (route guard)
  components/   ProductCard, QtyStepper, StickyCartBar, BottomSheet, ErrorBoundary,
                shop/ (ShopHeader, BrandLockup, BrandSheet, ProductSheet, AddressChooserSheet)
  hooks/        useCatalogue (shared via ShopLayout), usePricing
  lib/          pricing (mirrors place_order's fee rule), phone, eta, reorder, geo, money, errors
  pages/
    shop/       ShopLayout + Home/Category/Search/Cart/Orders/Account/Help,
                Login, Checkout, OrderTracking, Addresses, AddressEdit   (lazy)
    rider/      rider surface     (lazy)
    admin/      admin surface     (lazy)
  store/        cart (localStorage), customer (profile, addresses, zones, store settings)
  theme/        MUI theme + brand constants (colours, copy, asset paths)
public/brand/   logo assets cut from the master (mark, wordmark, full logo)
scripts/        db-reset.sh, db-test.sh, bundle-budget.mjs, remote-psql.sh
supabase/
  migrations/   0001 … 0014 (schema, functions, RLS, admin ops, images, import,
                zones, geolocation, authz, profile/addresses, catalogue detail, tracking)
  tests/        lifecycle_test.sql, rls_test.sql, oversell_test.sh,
                local_auth_shim.sql (local only)
  seed.sql
```

Routes are code-split so a customer never downloads the admin or rider bundle.

MUI is deliberately **not** forced into a single manual chunk. Doing that pulled admin-only components (Autocomplete, pickers) into the shared vendor bundle and pushed the customer route over budget — shoppers were paying to download admin UI they can never reach. Letting Rollup split by actual usage keeps the shop lean.

### The three surfaces

**Customer** (`/`) — a one-tap location prompt on first landing (the area is worked out from GPS, or the store's only area is used); tap the logo for the brand sheet; home and category grids (`/category/:id`), a product sheet over any page (`?product=<id>`), search with recent searches (`/search`), a cart that shows the same zone fee as checkout, phone-OTP sign-in (`/login?returnTo=`), an account tab with name edit and sign-out, an address book with labels, a default, soft delete, place search and a map pin that decides the delivery area, Google Maps with a fixed centre pin when a key is set and OpenStreetMap otherwise (`/account/addresses`), checkout from the address book, live tracking with ETA, timeline, rider card, cancel-within-window and WhatsApp/call to the store (`/order/:id`), order history with paging and a reorder that rebuilds the cart, and Help (`/help`).

**Admin** (`/admin`)

| Screen | Purpose |
|---|---|
| **Orders** | Live kanban board by status, updated over Supabase realtime rather than polling. One-tap advance on each card. |
| **Order detail** | Full items and customer, short-pick entry, rider assignment at any live status (the rider then sees the order and taps "Picked up"), every legal transition. |
| **New order** | Manual entry — the screen the WhatsApp pilot runs on. Goes through the same `place_order()` path as a customer checkout, so stock and pricing behave identically. |
| **Catalogue** | Add and edit products (with a description for the product sheet), including photos taken on a phone. Images are downscaled to 480px and re-encoded before upload. |
| **Categories** | The shelves, in the order a customer walks them: reorder, rename (English and Kannada), hide. A category with nothing on sale is hidden from the shop automatically; hiding one hides its products too. |
| **Stock** | Set on-hand per SKU via `admin_adjust_stock()`, which records a `stock_movements` row every time. Reserved units belong to live orders and cannot be adjusted away. |
| **Riders** | Add riders, activate/deactivate, and settle each day's cash against what the system expects. |
| **Big-screen display** (`/admin/display`) | Every live order in large type for a TV or tablet by the packing table. A new order chimes, flashes the tab title, raises a browser notification and pulses until tapped; one-tap Accept. The Orders board carries the same alarm. |
| **Reorder** tab | Everything a customer has had delivered, ready to add again: Repeat last order, every past product with a stepper, and each recent order with its own Order again. |
| **Order alerts** (Store settings) | The database pushes every new order to the owner's phone via the ntfy app or a Telegram bot the moment it is placed (`pg_net`, migration 0022), with no server to run and no tab to keep open. |

**Rider** (`/rider`) — orders assigned to them, live (a new assignment appears without a reload), with the customer's name, phone, landmark and map link; "Picked up" at the store, then Delivered (with a cash confirmation on COD) or Couldn't deliver. Built for one thumb in sunlight.

### Google sign-in

Customers can sign in with Google as well as by phone OTP. It uses Google's own button (Google Identity
Services) and `supabase.auth.signInWithIdToken()`, so the page never navigates away — the OAuth redirect flow
breaks inside an installed PWA on iOS. Setup, all free:

1. Google Cloud → Google Auth Platform → Clients → **Web application**. Authorised JavaScript origins: the
   site URL (and `http://localhost:3020` for dev). Authorised redirect URI:
   `https://<project>.supabase.co/auth/v1/callback`.
2. Supabase → Authentication → Providers → **Google**: enable, paste the client ID and secret.
3. Put the client ID in `VITE_GOOGLE_CLIENT_ID` (`.env` locally; repository variable for the deploy). The
   button is simply not rendered when it is unset.

A Google account carries a verified email and no phone, so `customers.phone` is nullable since 0021. The
number the rider calls is `customers.contact_phone`: copied from the sign-in number for phone customers, typed
once at checkout by a Google customer (no OTP; a wrong digit costs one delivery, never someone's account).
`place_order()` refuses `NO_CONTACT_PHONE` until it is set.

### Google Maps

With `VITE_GOOGLE_MAPS_KEY` set the address page shows a Google map with a fixed centre pin (pan the map
under the pin), every place search asks Google Places, and a settled pin suggests the street line by reverse
geocoding. Without the key the app uses OpenStreetMap tiles (Leaflet) and Photon search, and it falls back to
them for the rest of a session if Google ever refuses (daily cap, bad key). The delivery area is never taken
from Google: it is the nearest zone centre within its radius, pure arithmetic.

Every call is an "Essentials" SKU with 10,000 free calls a month (Dynamic Maps, Autocomplete requests,
Place Details Essentials, Geocoding). A session costs about one map load per address page with the map open,
one Place Details call per picked place (the keystrokes are free inside a session), and one geocode per settled
pan. Setup, in the same Google Cloud project as the sign-in client:

1. Billing → link a card (Google issues keys only on billed projects). The caps in step 4 keep it at ₹0.
2. APIs & Services → Library → enable **Maps JavaScript API**, **Places API (New)**, **Geocoding API**.
3. Credentials → Create credentials → API key → edit it: Application restrictions = Websites
   `https://faa-dfz.pages.dev/*`, `http://localhost:3020/*`, `http://127.0.0.1:3020/*`; API restrictions =
   the three APIs above. Never add a `no-referrer` policy to the site: the restriction relies on the Referer.
4. Quotas (each API → Quotas & System Limits, edit the per-day limit): Maps JavaScript API map loads 300;
   Places API (New) autocomplete requests 500 and place details 200; Geocoding requests 300. A cap that is hit
   degrades that day's sessions to OpenStreetMap; raise it when the store grows.
5. Billing → Budgets & alerts → ₹100 a month with alerts at 50/90/100 %.
6. `.env`: `VITE_GOOGLE_MAPS_KEY=AIza…`. Deploy: `gh variable set VITE_GOOGLE_MAPS_KEY --body "AIza…"` from the
   repo (a variable, not a secret: like the OAuth client id it ships in the bundle and is protected by the
   referrer restriction), then push.

Place results shown away from a Google map carry the Google Maps logo, as Google's policy requires; only the
chosen coordinates and name are stored, never place IDs.

### Ola Maps

The card-free alternative. Ola Maps (maps.olakrutrim.com) has its own Indian map data, gives 100,000 calls a
month free with no payment method on file, and charges prepaid credits only beyond that. With `VITE_OLA_MAPS_KEY`
set and no Google key, the address page draws Ola's vector map in MapLibre (fixed centre pin, same as the Google
map), every place search asks Ola's autocomplete (predictions already carry coordinates, so a pick costs nothing
more), and a settled pin suggests the street line through Ola's reverse geocoding. When both keys are set Google
is used first. A refusal from Ola (401/403/429: bad key, allowance used up) moves that session to OpenStreetMap.

Setup: sign up at https://cloud.olakrutrim.com, create a project, create an API key (add the site origin if the
console offers allowed origins), put it in `VITE_OLA_MAPS_KEY` (`.env` locally; `gh variable set VITE_OLA_MAPS_KEY
--body "…"` for the deploy). The MapLibre chunk (about 230 KB gzipped) loads only when the Ola map opens and is
kept out of the service-worker precache.

### Product images

Photographs are taken on a phone in the admin console and uploaded to the `product-images` bucket (public read, admin write). Before upload the browser downscales to 480px and re-encodes: **WebP where supported, JPEG as fallback**. Safari lacked WebP encoding for years and some engines never invoke the `toBlob` callback at all rather than returning `null`, so the encoder is time-boxed — otherwise an admin on the wrong browser sits on a spinner with no error. Products without a photo fall back to a category glyph rather than an empty box.

### Offline-tolerant rider actions

Riders lose signal in stairwells and half the lanes in Hospet. Every rider action is written to a local queue **first** and synced after, so "delivered" always works. On drain, a server rejection (the order was already delivered from the admin console) is dropped rather than retried forever; a transport failure is kept for the next attempt.

---

## Roadmap

- [x] **Phase 1** — schema, atomic order functions, RLS policies, test suite, app scaffold
- [x] **Phase 1b** — admin console: order board, order detail, manual entry, stock
- [x] **Phase 1c** — Supabase Security Advisor findings resolved (`0005`)
- [x] **Phase 2** — customer PWA: checkout, phone OTP, order tracking, history, reorder
- [x] **Phase 3** — rider app: assigned orders, offline-tolerant delivery marking, cash collection
- [x] **Phase 3b** — product images, catalogue and rider management
- [x] **app-v2** — authorised order functions, account + address book, product sheet + search, single pricing rule, tracking with ETA/rider/cancel, rider pickup flow, FAA brand
- [ ] **Next** — web push on order events, Razorpay UPI with webhook verification, offers/banners, ratings, Kannada UI

**Phone OTP needs an SMS provider** configured in Supabase (Authentication → Providers → Phone). Until one is set, sending a code fails with a clear message rather than hanging.

**Out of scope for v1**, deliberately: ratings, wallets, referrals, coupons, loyalty points, live GPS tracking, scheduled orders, multi-warehouse. Each is a week not spent getting customers.

---

## Design notes

The interface follows the conventions Indian quick-commerce users already know — a category rail, a two-column product grid, an ADD button that becomes a quantity stepper in place, a sticky cart bar. Familiarity reduces friction for first-time users.

The visual identity, colours and assets are this project's own. No third-party branding is copied.

Product names carry a Kannada field (`name_kn`) alongside English, and search matches both. In Hospet that is a usability requirement, not a nicety.

---

## Licence

Private and unlicensed. All rights reserved.
