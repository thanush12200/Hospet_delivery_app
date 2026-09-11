# FAA repository guide

FAA is a single-store grocery delivery system for Hospet. The same React app serves shoppers, store staff and delivery partners. Its transactional backend is Supabase/Postgres; there is no separate application server.

## Entry points and ownership

| Module | Responsibility |
| --- | --- |
| `src/main.tsx` | React root, global storefront styles, and development-only `/preview` entry. |
| `src/App.tsx` | Theme, error boundary, authentication, customer/cart providers, lazy routes and customer route guards. |
| `src/auth/AuthProvider.tsx`, `authContext.ts` | Supabase session and staff-role resolution, password sign-in and sign-out. |
| `src/auth/RequireAuth.tsx` | Defers customer authentication until a protected screen; preserves the destination. |
| `src/store/customer.tsx`, `customerContext.ts` | Customer profile, address book, selected area, public store settings and delivery zone. |
| `src/store/cart.tsx`, `cartContext.ts` | Local persistent basket, integer quantities and subtotal in paise. Preview uses a separate storage key. |
| `src/hooks/useCatalogue.ts` | Shared catalogue and live availability; explicit product IDs support baskets containing previously listed products. |
| `src/hooks/usePricing.ts` | Basket pricing for the chosen address/zone, shared across browsing and checkout. |
| `src/types/db.ts` | Product, address, order, zone, payment and RPC result types matching SQL contracts. |

## Customer screens

| Route / module | Workflow |
| --- | --- |
| `ShopLayout.tsx` | Shared header, navigation, catalogue context, product sheet, toast and basket bar. `ShopFrame` can receive isolated preview data. |
| `/`, `/category/:categoryId` / `ShopHome.tsx` | Catalogue browsing, category selection, stock filter, price/name sorting, product details and add/remove. |
| `/categories` / `CategoriesPage.tsx` | Complete live category directory and product counts. |
| `/search` / `SearchPage.tsx` | URL-backed search, recent queries, English/Kannada/brand matches, result cards. |
| `/cart` / `CartPage.tsx` | Quantity changes, removal, refreshed availability, delivery fee and minimum-order checks. |
| `/login` / `Login.tsx` | Phone OTP, resend cooldown, verified customer linking and return navigation. |
| `/checkout` / `Checkout.tsx` | Saved address, COD or UPI at the door, delivery note and server-validated order placement. Clears the cart after success. |
| `/order/:id` / `OrderTracking.tsx` | Realtime status plus polling fallback, ETA, timeline, assigned rider, cancellation window and store contact. |
| `/orders` / `OrdersPage.tsx` | Order history, paging and reorder using current catalogue prices. |
| `/account` / `AccountPage.tsx` | Profile name editing, address/order/help links and sign-out. |
| `/account/addresses` / `AddressesPage.tsx` | Address labels, default selection, editing and soft deletion. |
| `/account/addresses/new`, `/account/addresses/:id` / `AddressEditPage.tsx` | Zone and landmark entry, geolocation and optional draggable map pin. |
| `/help` / `HelpPage.tsx` | Configured store contact details, FAQs and brand information. |
| `/product/:id` | Redirects to the shareable product sheet on the home screen. |

## Store operations

`/admin` requires a session linked to `admin_users`. The UI checks the role; database policies and RPCs independently enforce it.

| Screen | Responsibility |
| --- | --- |
| `AdminLayout.tsx`, `AdminLogin.tsx` | Responsive operations navigation, role indicator and staff password sign-in. |
| `OrderBoard.tsx` | Realtime active orders grouped by status, operational counts, customer/order search and legal next actions. |
| `OrderDetail.tsx` | Customer/address/items, short picks, bill adjustments, rider assignment and transitions. |
| `NewOrder.tsx` | Staff-entered phone/WhatsApp orders, customer lookup, address creation and the same atomic order placement RPC. |
| `Catalogue.tsx` | Product creation/editing, activation, description, bilingual name, MRP and camera/uploaded photos. |
| `ImportCsv.tsx` | Local spreadsheet parsing/validation, preview and bulk product import. |
| `Inventory.tsx` | Stock adjustment through an audited RPC; reserved units cannot be removed. |
| `Riders.tsx` | Delivery-partner records, activation and cash reconciliation. |
| `Zones.tsx` | Delivery areas, fees, minimum order, free-delivery threshold, SLA and optional location/radius. |

`/rider` is implemented in `MyDeliveries.tsx`: assigned packed orders, pickup, navigation/calling, delivered/failed actions and COD collection confirmation. It shows connection status and queued actions. Delivery actions are persisted before sync so transport failures can be retried.

## Shared components

- `ProductCard`, `QtyStepper`, `shop/ProductImage`: stable product layout, quantity limits and image failure state.
- `shop/ShopHeader`, `BottomNav`, `StickyCartBar`: delivery destination, search and responsive navigation/basket access.
- `shop/CategoryTiles`, `CategoryIconRail`, `PromoBanner`: category discovery and store promises derived from zone settings.
- `BottomSheet`: native modal dialog with focus containment, Escape, backdrop dismissal and focus restoration.
- `shop/ProductSheet`: URL-driven details, tax-inclusive MRP, live stock and related products.
- `shop/AddressChooserSheet`: common delivery-area/address selection across home and checkout.
- `shop/BrandLockup`, `BrandSheet`, `SubPageBar`: brand identity and navigation for secondary screens.
- `AddressMap`: lazily loaded map pin editor; switches between `GoogleAddressMap` (fixed centre pin, needs `VITE_GOOGLE_MAPS_KEY`) and `LeafletAddressMap` (OpenStreetMap fallback).
- `Toast`, `toastContext`, `ErrorBoundary`: transient feedback and recoverable render failures.
- `theme/index.ts`, `theme/brand.ts`, `theme/storefront.css`: shared tokens, MUI defaults and responsive layouts.
- `constants/categoryIcons.ts`: legacy category glyph fallback used on secondary screens.

## Data access

| API module | Responsibility |
| --- | --- |
| `api/catalogue.ts` | Versioned catalogue from public tables, IndexedDB cache, bounded timeouts and stale-cache fallback. |
| `api/inventory.ts` | Live `inventory_available` reads, never persisted with the catalogue. |
| `api/customer.ts` | Profile, addresses, zones/settings, ordering/history, realtime tracking, cancellation and rider contact. |
| `api/admin.ts` | Active/recent orders, transitions, rider assignment, manual orders, stock and settlements. |
| `api/rider.ts` | Assigned orders, current rider identity, cash totals, delivery transitions and realtime subscription. |
| `api/storage.ts` | Resize uploads to 480px, bounded WebP/JPEG encoding and Supabase public image storage. |
| `lib/supabase.ts` | Environment configuration and the shared public-key Supabase client. |

## Domain helpers

| Modules | Responsibility |
| --- | --- |
| `pricing.ts`, `money.ts` | Zone fee/threshold/minimum calculations and paise formatting. |
| `phone.ts`, `address.ts` | Indian mobile normalization, labels and address presentation. |
| `eta.ts` | Arrival estimate, terminal statuses and cancellation countdown. |
| `reorder.ts` | Rebuilds a basket from historical items while reporting unavailable/repriced products. |
| `search.ts`, `recentSearches.ts` | Local bilingual search and device query history. |
| `geo.ts` | Coordinates, distances, nearest zone, geolocation errors and map links. |
| `csv.ts` | Quoted CSV parsing and integer/rupee conversion for imports. |
| `offlineQueue.ts` | Durable rider action queue; retry transport errors and discard server refusals. |
| `errors.ts`, `contact.ts`, `returnTo.ts` | User-facing RPC/auth errors, call/WhatsApp links and safe local redirects. |

## Database contracts

Read migrations in numeric order; later definitions replace earlier RPC versions.

| Migration | Purpose |
| --- | --- |
| `0001` | Schema, enums, people, catalogue, inventory, orders/items/events, payments and settlements. |
| `0002` | Atomic order placement/transitions, inventory side effects and audit/status guards. |
| `0003` | Row-level security and function privileges. |
| `0004` | Staff operations for customer/address lookup, stock and cash. |
| `0005` | Invoker-security view, fixed search paths and policy improvements. |
| `0006` | Images, storage policies and product/rider operations. |
| `0007` | Catalogue-version update correction. |
| `0008` | Bulk product import. |
| `0009` | Admin zone operations. |
| `0010` | Geolocation fields and zone matching metadata. |
| `0011` | Caller-derived authorization, store settings, fee thresholds, rider assignment and realtime publication. |
| `0012` | Profile/address RPCs, verified phone identity, soft deletion and one live default address. |
| `0013` | Product description and editable delivery SLA/free-delivery threshold. |
| `0014` | Customer cancellation and limited rider contact RPCs. |

`place_order()` locks inventory deterministically, recomputes prices on the server and reserves stock atomically. `transition_order()` enforces the state machine and records stock/payment/audit effects together. Historical item prices are snapshots. Money is integer paise. The UI must never directly mutate order status or inventory.

## Assets and development preview

`public/brand` contains the existing FAA identity. `public/storefront` adds the optimized grocery photograph and attributed sample photos. `src/preview` uses the real storefront components with isolated providers: no Supabase requests, a separate basket key and disabled ordering. It is reachable at `/preview/` during `npm run dev` and eliminated from the production JavaScript build.

`catalogue/` contains the starter spreadsheet and existing research work. These are catalogue preparation materials, not the live database. The UI does not import or publish those products to Supabase.

## Running and checking

```sh
npm run dev                 # port 3020, or the next free port
npm run typecheck
npm run lint
npm test
npm run build
node scripts/bundle-budget.mjs
node scripts/verify-ui.mjs /absolute/path/to/playwright/index.mjs
```

The browser verifier uses installed Google Chrome, writes screenshots to ignored `artifacts/ui/`, exercises the isolated storefront and reads the live public catalogue. It does not place real orders. Set `UI_ORIGIN` when using a different port. A normal `playwright` installation can be used by omitting the module argument.

The existing unit suites cover phone, money, geolocation, pricing, search, reorder and ETA. SQL suites cover lifecycle, authorization/RLS and concurrent oversell. `db:test` resets a local test database: it must not target production. No database changes are required by this redesign.

`vite.config.ts` handles aliases, chunking, the PWA manifest and image caching. `scripts/bundle-budget.mjs` traces the customer's static import graph against a 200 KB gzip budget. Preview product photos are excluded from service-worker precaching.

Deployment is described in `DEPLOY.md`. The GitHub workflow builds and deploys `main` to Cloudflare Pages. `public/_redirects` and `vercel.json` preserve SPA routing. This redesign is submitted for review and does not deploy by itself.

## Current limits

- The live catalogue observed during development has four products and two categories, with no product photos. The larger local preview is explicitly illustrative.
- Phone OTP needs a configured SMS provider or test numbers. Staff and rider access require matching Supabase records.
- UPI is collected at the door; verified online Razorpay payment is not implemented.
- Authentication, real order placement, live staff mutations and real rider sync need role-specific end-to-end testing with test accounts. The UI checks do not substitute for those checks.
- Existing backlog includes push notifications, offers, ratings and full Kannada UI. Search and product names already support Kannada.
