# Deploying Wink

The build is a static bundle plus a service worker. Any static host works;
Cloudflare Pages and Vercel are both free at this scale.

## Environment variables

Both must be set on the host, or the app throws at boot rather than failing
mysteriously on the first query:

```
VITE_SUPABASE_URL=https://troouqapzkufohftxvne.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

The anon/publishable key is safe to expose — it ships inside the frontend
bundle by design. Row Level Security is what protects the data, not the key.
Never set `service_role` here.

## Option A — Cloudflare Pages via GitHub (recommended)

No CLI, and every push to `main` redeploys automatically.

1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**
2. Pick `thanush12200/Hospet_delivery_app`
3. Build settings:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Add the two environment variables above under **Environment variables**
5. **Save and Deploy**

`public/_redirects` handles SPA routing, so `/admin` and `/order/:id` survive a
refresh.

## Option B — Vercel via GitHub

1. vercel.com/new → import the repo
2. Framework preset **Vite** is detected; `vercel.json` supplies the rewrites
3. Add the two environment variables
4. Deploy

## Auto-deploy (in use)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`.

Cloudflare's own Git integration is **not** used, because `wink` was created as
a Direct Upload project and Cloudflare cannot convert one to Git-connected.
Doing so would mean a new project on a new `*.pages.dev` URL, and that URL is
already registered in Supabase's auth configuration.

Four repository secrets are required
(GitHub → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://troouqapzkufohftxvne.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the anon / publishable key |
| `CLOUDFLARE_ACCOUNT_ID` | `6914013b02e3503e8e5e475911f3cf5d` |
| `CLOUDFLARE_API_TOKEN` | see below |

**Creating the API token:** dash.cloudflare.com → My Profile → API Tokens →
Create Token → **Edit Cloudflare Workers** template (it includes Pages), or a
custom token with `Account → Cloudflare Pages → Edit`. Scope it to this account
only.

The workflow runs `typecheck` and `lint` before building, so a type error
fails the deploy rather than shipping.

## Option C — Manual CLI

```bash
npx wrangler login          # opens a browser
npm run build
npx wrangler pages deploy dist --project-name=wink
```

## After the first deploy

1. Supabase → **Authentication → URL Configuration** → add the deployed origin
   to **Site URL** and **Redirect URLs**, otherwise auth redirects break.
2. Open the URL on a phone → **Add to Home Screen**. It should launch
   full-screen with the Wink icon and no browser chrome.
3. Check the service worker registered (DevTools → Application → Service
   Workers). The catalogue should then survive going offline.
