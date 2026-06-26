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
