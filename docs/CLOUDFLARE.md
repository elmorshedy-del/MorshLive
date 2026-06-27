# Deploy korazero on Cloudflare

Your **Cloudflare API token never goes in the website code**. It only lives in secure places below.

## Option A — Connect GitHub in Cloudflare (easiest, no API in repo)

1. Push this repo to GitHub.
2. Open [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Select the repo, branch `main`.
4. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `.` (a single dot)
   - **Deploy command:** *(leave empty — do not use `npx wrangler deploy`)*
5. Deploy. You get: `https://korazero.pages.dev`
6. **Custom domains** → add `korazero.com` (or your domain).

No API token needed — Cloudflare connects via OAuth.

---

## Option B — GitHub Actions (API in GitHub Secrets)

Use the workflow: `.github/workflows/deploy.yml`

### Where to put the Cloudflare API

**GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|-------------|--------|
| `CLOUDFLARE_API_TOKEN` | Your API token |
| `CLOUDFLARE_ACCOUNT_ID` | Your account ID |

### Create the API token

1. [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. **Create Token** → use template **Edit Cloudflare Workers**  
   or custom permissions:
   - **Account** → **Cloudflare Pages** → **Edit**
   - **Account** → **Account Settings** → **Read**
3. Copy the token once — you won’t see it again.

### Find Account ID

Cloudflare Dashboard → pick any site → right sidebar → **Account ID**

### Create the Pages project (first time only)

Dashboard → **Workers & Pages** → **Create application** → **Pages** → **Upload assets**  
Project name: **`korazero`**

After that, every push to `main` deploys automatically.

---

## Option C — Deploy from your computer (API in `.env`)

```bash
cd MorshLive
cp .env.example .env
# Edit .env — paste CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID

npm install -g wrangler   # or: npx wrangler
npx wrangler pages deploy . --project-name=korazero
```

Wrangler reads `CLOUDFLARE_API_TOKEN` from your environment / `.env` (gitignored).

---

## Custom domain: korazero.com

1. Domain must be on Cloudflare (nameservers pointed to Cloudflare).
2. Pages project **korazero** → **Custom domains** → **Set up a domain**.
3. Add `korazero.com` and `www.korazero.com`.
4. Cloudflare creates DNS records automatically.

Nice URLs after deploy:

- `https://korazero.com`
- `https://korazero.com/watch/bein-sports-1`
- `https://korazero.com/live`

---

## What NOT to do

- Do **not** put `CLOUDFLARE_API_TOKEN` in `index.html`, `data.js`, or any public file.
- Do **not** commit `.env` to git.
- Do **not** paste the token in chat or screenshots.

The static site has **no server** — visitors never need your API key.

---

## Troubleshooting: `Missing entry-point to Worker script`

If the build log shows:

```
Executing user deploy command: npx wrangler deploy
✘ [ERROR] Missing entry-point to Worker script or to assets directory
```

Cloudflare is using the **Workers** deploy command on a **static Pages** site.

**Fix in the dashboard (phone-friendly):**

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **korazero**
2. **Settings** → **Build** (or **Builds & deployments**)
3. Set:
   - **Build command:** empty
   - **Build output directory:** `.`
   - **Deploy command:** empty *(delete `npx wrangler deploy` if present)*
4. **Save** → **Retry deployment**

This repo also includes `wrangler.toml` with `[assets]` so `npx wrangler deploy` can succeed if that command cannot be removed. Prefer clearing the deploy command so `_redirects` and `_headers` work as normal Pages files.

---

## korazero.com works on workers.dev but not the main domain

If **`morshlive.elmorshedy.workers.dev`** has the correct streams but **`korazero.com`** still shows old players or wrong games, you have **two deployments**:

| URL | Project | Status |
|-----|---------|--------|
| `morshlive.*.workers.dev` | **Worker `morshlive`** | ✅ latest code (Git `wrangler deploy`) |
| `korazero.com` / `korazero.pages.dev` | **Pages `korazero`** | ❌ old build — remove domain from here |

**Fix from your phone (Cloudflare Dashboard):**

1. **Workers & Pages** → open **korazero** (Pages) → **Custom domains**
2. **Remove** `korazero.com` and `www.korazero.com` from the Pages project
3. **Workers & Pages** → open **morshlive** (Worker) → **Settings** → **Domains & Routes**
4. **Add** custom domain → `korazero.com` and `www.korazero.com`
5. Wait 1–2 minutes, then hard-refresh korazero.com

**Check it worked:** open korazero.com/watch and view page source — script URLs should include `watch.js?v=20260626b` (or newer), not `20260625c`.

After the domain move, only **morshlive** needs Git deploys. The old Pages project can stay disconnected or be deleted later.

---

## Global CDN (faster in all countries)

**You already have a CDN** when `korazero.com` is on Cloudflare with the orange-cloud proxy enabled. Traffic is served from the nearest Cloudflare data center (300+ cities), not from a single origin.

The **morshlive Worker** + static assets binding deploys your HTML, JS, and CSS to that global edge network automatically.

### What this repo configures

| Asset | Browser | Cloudflare edge |
|-------|---------|-----------------|
| HTML (`*.html`, `/`) | Revalidate every visit | Cache 1 hour |
| JS/CSS (`/assets/js`, `/assets/css`) | 1 year (`immutable`) | Same — bump `?v=` on deploy |
| `today.json` / live snapshot | Always fresh | Cache 60s |
| `channel-bindings.json` | Always fresh | Cache 5 min |
| `/wk/albaplayer/vip1\|vip2` proxy | 30s | 60s at edge (Worker Cache API) |

Rules live in `_headers` (static files) and `worker.js` (worldkoora proxy).

### Dashboard settings (recommended)

In [Cloudflare Dashboard](https://dash.cloudflare.com) → your zone **korazero.com**:

1. **DNS** — `korazero.com` and `www` records must be **Proxied** (orange cloud), not DNS-only.
2. **Speed → Optimization** — enable **Brotli** (on by default on most plans).
3. **Caching → Configuration** — **Caching Level: Standard**; **Browser Cache TTL: Respect Existing Headers** (so our `_headers` file controls behavior).
4. **Caching → Tiered Cache** — enable if available on your plan (fewer origin hits from distant regions).

### Verify CDN is working

After deploy, open DevTools → Network → pick any `assets/js/*.js` request:

- Response header `cf-cache-status: HIT` means it was served from edge (not origin).
- Second visit to the same page should show `HIT` for CSS/JS.

Live video inside the iframe still streams from worldkoora; CDN speeds up the **site shell** and **player page HTML**, which is what makes the first load feel fast in Saudi Arabia, Europe, US, etc.

### Important: one deployment path

CDN headers in `_headers` only apply when traffic goes through the **morshlive Worker** (`wrangler deploy`). If `korazero.com` still points at an old **Pages** project, move the custom domain to the Worker (see section above) so edge caching and `/wk/` proxy both work.
