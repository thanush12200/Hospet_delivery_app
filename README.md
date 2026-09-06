# Hospet Delivery

Local grocery delivery for **Hospet (Hosapete), Vijayanagara district, Karnataka** — a customer PWA, a rider app and an admin console over a Postgres core.

No national quick-commerce platform serves Hospet. Blinkit, Zepto, Swiggy Instamart and Flipkart Minutes have all skipped it, and Amazon Hub Delivery is not open for pincode 583201 (verified September 2026). Around 200,000 people here have no delivery service at all.

This project serves that market from an existing FMCG distributorship — the stock, warehouse and vehicles already exist. It is a single dark store, not a marketplace.

---

## What makes this different from a 10-minute clone

| | Quick-commerce majors | This |
|---|---|---|
| Delivery promise | 10 minutes | **45–60 minutes** |
| Catalogue | 2,000+ SKUs | **300–500 fast movers** |
| Pricing | Discounted below MRP | **At MRP** — the retail margin is the business |
| Break-even | 1,000+ orders/day | **30–50 orders/day** |

Ten-minute delivery is what makes those cost structures impossible. In a town where the alternative is walking to the shop, 45 minutes is an excellent service — and it is profitable at a volume this market can actually produce.

---

## Architecture

Deliberately boring: one repo, one database, three surfaces.

- **Frontend** — React 18 · TypeScript (strict) · Vite · MUI v7 · React Router 6
- **Backend** — Supabase (Postgres + Auth + RLS). No separate API tier.
- **Database region** — `ap-south-1` (Mumbai). Non-negotiable for latency.
- **PWA** — `vite-plugin-pwa` + Workbox. Installable, offline catalogue, no Play Store.
- **Payments** — Cash on delivery, and UPI via Razorpay (UPI has zero MDR in India).

There is intentionally **no Node backend**. Row Level Security plus a handful of Postgres functions covers this domain; an API tier would be a month of work that buys nothing at this scale.

### The two functions that matter

Everything that touches stock or money goes through one of these. Nothing else may.

**`place_order()`** — atomic reserve-and-create. Locks every inventory row in a deterministic order (by `product_id`, to avoid deadlock), verifies availability, **recomputes the total server-side** from `products.mrp_paise`, and reserves stock — all in one transaction. A total sent by the client is used only as a cross-check and is rejected on mismatch.

**`transition_order()`** — the only legal way to move an order's status. Validates the transition, applies the stock and cash side effects, and writes an audit event, atomically.

```
PLACED ──> CONFIRMED ──> PICKING ──> PACKED ──> OUT_FOR_DELIVERY ──> DELIVERED
   │            │            │           │                │
   └──> CANCELLED <──────────┘           └──> ... ────────┴──> FAILED
```

A database trigger rejects any direct `UPDATE orders SET status`. `order_events` is append-only and cannot be edited or deleted.

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

## Getting started

```bash
npm install
cp .env.example .env      # point at your Supabase project (ap-south-1)
npm run dev               # http://localhost:3020
```

### Database

```bash
npm run db:reset          # create hospet_test, apply migrations, seed
npm run db:test           # reset, then run the full test suite
```

Or apply to Supabase by running the files in `supabase/migrations/` in order.

### Verifying correctness

```bash
npm run db:reset
psql -d hospet_test -f supabase/tests/lifecycle_test.sql
psql -d hospet_test -f supabase/tests/rls_test.sql
./supabase/tests/oversell_test.sh hospet_test 40
```

`local_auth_shim.sql` stubs `auth.uid()` and the `anon`/`authenticated` roles so the RLS policies can be exercised on plain Postgres. **Never run the shim against Supabase** — it has real versions of all of it.

The lifecycle suite covers 36 assertions: price-tamper rejection, illegal transitions, reservation release on cancel, restocking after a cancelled pack, bill recomputation on a short pick, COD cash reconciliation, and the append-only guarantee.

**The oversell test is the important one.** It fires N concurrent `place_order()` calls at a product with limited stock and asserts that exactly as many succeed as there were units — no more. Verified at 40-way concurrency with zero deadlocks.

```
Firing 40 concurrent orders for a product with available=5 ...
  succeeded : 5
  out_of_stock: 35
  errors    : 0
PASS  no oversell under 40-way concurrency (sold exactly 5 of 5)
```

Overselling destroys customer trust faster than slow delivery does. It is the one thing in this system that cannot be wrong.

The RLS suite (8 assertions) proves the anon key can read the catalogue but cannot read another customer's orders, insert an order, alter stock, delete records, or call `place_order()` without logging in.

One subtlety worth knowing when reading these tests: **RLS filters rows, it does not raise.** A blocked `UPDATE` matches zero rows and returns successfully. Assertions must therefore check rows affected, not catch an exception.

---

## Project structure

```
src/
  api/          typed Supabase queries — catalogue, orders, inventory
  components/   ProductCard, QtyStepper, StickyCartBar
  hooks/        useCatalogue — cache-first load with live availability
  lib/          supabase client, money helpers (paise ⇄ rupees)
  pages/
    shop/       customer surface  (lazy)
    rider/      rider surface     (lazy)
    admin/      admin surface     (lazy)
  store/        cart (localStorage-backed, survives refresh)
  theme/        MUI theme
supabase/
  migrations/   0001_schema.sql, 0002_functions.sql
  tests/        lifecycle_test.sql, oversell_test.sh
  seed.sql
```

Routes are code-split so a customer never downloads the admin or rider bundle.

---

## Roadmap

- [x] **Phase 1** — schema, atomic order functions, RLS policies, test suite, app scaffold
- [ ] **Phase 2** — customer PWA: checkout, phone OTP, order tracking
- [ ] **Phase 3** — rider app: assigned orders, offline-tolerant delivery marking, cash collection
- [ ] **Phase 4** — Razorpay UPI with webhook verification, FCM push, daily rider settlement

**Out of scope for v1**, deliberately: ratings, wallets, referrals, coupons, loyalty points, live GPS tracking, scheduled orders, multi-warehouse. Each is a week not spent getting customers.

---

## Design notes

The interface follows the conventions Indian quick-commerce users already know — a category rail, a two-column product grid, an ADD button that becomes a quantity stepper in place, a sticky cart bar. Familiarity reduces friction for first-time users.

The visual identity, colours and assets are this project's own. No third-party branding is copied.

Product names carry a Kannada field (`name_kn`) alongside English, and search matches both. In Hospet that is a usability requirement, not a nicety.

---

## Licence

Private and unlicensed. All rights reserved.
