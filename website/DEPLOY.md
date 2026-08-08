# Deploying the Nexora website

The site is deployed to **https://nexora.suryaprakashinfo.in** (Cloudflare Pages,
connected to the `suryaprakashinfo.in` zone). The whole site lives in this folder
(`website/`) and is fully static — no build step required.

## Option A — Dashboard upload (fastest, no setup)

1. Go to [Cloudflare Dashboard → Workers & Pages](https://dash.cloudflare.com/) and open
   the **nexora** Pages project (create it if missing).
2. Click **Create deployment** → **Upload assets**.
3. Drag & drop the **contents** of this `website/` folder (or the ready-made
   `website-dist.zip` in the repo root — Cloudflare accepts it directly).
4. The deployment goes live on `nexora.suryaprakashinfo.in` automatically.

## Option B — Automated deploys from GitHub (recommended)

Add two secrets to the repository
(`Settings → Secrets and variables → Actions → New repository secret`):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with **Cloudflare Pages: Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (Dashboard → right sidebar) |

Once added, every push that changes `website/**` runs the
`.github/workflows/website-deploy.yml` workflow and deploys automatically.
You can also trigger it manually: **Actions → Deploy Website to Cloudflare Pages → Run workflow**.

> The Pages project name must match `--project-name=nexora` in the workflow
> (or change it there).

## Option C — wrangler CLI (local)

```bash
npm i -g wrangler
wrangler login            # opens a browser — authenticate as the Cloudflare account
wrangler pages deploy website --project-name=nexora
```

## Verify after deploying

```bash
curl -I https://nexora.suryaprakashinfo.in/          # expect HTTP/2 200
curl -s https://nexora.suryaprakashinfo.in/robots.txt
curl -s https://nexora.suryaprakashinfo.in/sitemap.xml
```

## Site structure

```text
website/
├── index.html        Landing page
├── docs.html         Documentation
├── 404.html          Branded not-found page
├── robots.txt        SEO
├── sitemap.xml       SEO
├── apple-touch-icon.png
└── assets/
    ├── css/style.css
    ├── js/main.js
    └── img/          logo, og-image, screenshots
```
