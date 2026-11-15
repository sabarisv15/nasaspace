# Deploy ARCNAVE on Cloudflare only: always on, no card, this PC can be off

**Result:** `https://arcnave.<your-subdomain>.workers.dev` runs ARCNAVE all the time, with HTTPS, for ₹0.
No server to keep running: Cloudflare serves everything.

```
Visitor's browser
  ├─ the pages, the PC's cache (archive answers, SPHEREx cutouts, sky tiles)  ← Cloudflare static files (free, unlimited)
  ├─ /edge-api.js (deploy/cloudflare/edge-api.js): makes the /api/... answers in the browser (same queries and parsers as server.js)
  │     └─ /_p  ← Worker: a small proxy to the archives (IRSA, CDS, IMCCE, MPC, JPL, CADC, MAST), replies kept at the edge
  └─ new SPHEREx images: read by the page itself from NASA's S3 copy (as on any public host)
```

- **Fields opened on the team's PC open at once** for every visitor (2,860 archive answers, 2,627 cutouts, 8,284 sky
  tiles, measured numbers unchanged: Barnard's Star 9.7″ in the local test, as on the PC).
- **A new field** works like a public host of the Node server with S3 off: the archive is asked through the proxy (the
  reply is then kept at Cloudflare's edge for the next visitor), and the images are read from NASA's S3 by the browser.
- **Free plan limits:** 100,000 Worker requests a day (static files do not count: only archive questions that were not
  saved, and new sky tiles); 20,000 files (this build: about 14,000); 25 MiB a file (largest: 3 MB).
- **Not on Cloudflare** (local runs only, as on any public host): the debug bundle, the scorecard saving, `/dev` pages.

| File | What it does |
|---|---|
| `deploy/cloudflare/build.mjs` | Makes `deploy/out/cf`: pages + lib + the PC's cache, `%ORIGIN%` filled in |
| `deploy/cloudflare/edge-api.js` | The browser side of `/api/...` (added to every page by the build) |
| `deploy/cloudflare/worker.js` | The proxy (`/_p`, allow-listed archives only), new sky tiles, NEOSSat previews |
| `deploy/cloudflare/wrangler.toml` | The Worker and its static files |
| `deploy/cloudflare/deploy.ps1` | Build + login + upload in one command |

## Step 1: Cloudflare account (5 minutes, no card)
1. <https://dash.cloudflare.com/sign-up>: email and password, then confirm the email.
2. **Workers & Pages** (left menu): Cloudflare asks for a **workers.dev subdomain** the first time, e.g. `arcnave-sky`.
   The site's address is then `https://arcnave.arcnave-sky.workers.dev`.

## Step 2: Build and publish (on this PC, 30-60 minutes the first time)
```
powershell -ExecutionPolicy Bypass -File deploy\cloudflare\deploy.ps1 https://arcnave.<your-subdomain>.workers.dev
```
- It builds `deploy\out\cf` (2-3 minutes), asks you to allow Wrangler in the browser (once), and uploads about 2.5 GB.
  If the upload stops, run the same command again: files already up are skipped.

## Step 3: Check, then submit
- `https://arcnave.<your-subdomain>.workers.dev/#ct=barnard` (and `epsindb`, `wise0855`, `rwaur`, `rdra`): each opens from
  the saved data and shows the same numbers as on the PC.
- `/api/health` is answered in the browser: open the site and run `fetch('/api/health').then(r => r.json())` in the console.
- Put the address in the README ("Live") and in the Space Apps form. A domain of your own (e.g. `sky.arcnave.in`) can be
  added later in the Worker's **Settings → Domains & Routes** once the domain is on Cloudflare.

## Updating later
Change the code → commit → run `deploy.ps1` again with the same address. Only changed files are uploaded.
