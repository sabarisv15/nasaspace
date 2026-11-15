# Deploy ARCNAVE 24/7 with no card: Hugging Face Space + Cloudflare

> **Tried 15 Nov 2026: Hugging Face now refuses Docker Spaces on the free plan** ("hosting Gradio and Docker Spaces on
> free cpu-basic requires a PRO subscription", 402 at create). Use **`DEPLOY-CLOUDFLARE.md`** instead (no card, no
> server). This page stays for the day a PRO account is available; `deploy/cloudflare/worker.js` is now the Cloudflare-only
> Worker, so step 5 below needs the earlier front-door Worker from git history (commit e2f4384).

**Result:** `https://sky.arcnave.in` runs ARCNAVE all the time, with HTTPS, for ₹0, and this PC can be off.

```
Visitor → Cloudflare (sky.arcnave.in: HTTPS, edge cache near the visitor; free plan, no card)
            → Hugging Face Space (Docker; free CPU basic: 2 vCPU, 16 GB RAM)
                 └─ ARCNAVE + this PC's cache (every field opened here) built into the image
```

- **Fields opened on this PC open at once**: the cache (SPHEREx cutouts, archive answers, sky tiles) is inside the image,
  so it survives restarts and rebuilds.
- **A new field**: the first visitor waits while NASA's images are read (about 20 s). The cutouts are then kept in
  Cloudflare's edge cache for 30 days, so the next visitor gets them at once, even after the Space restarts.
- **Limits:** a free Space sleeps after 48 hours with no visitor and wakes on the next visit (about a minute).
  New fields cached on the Space's own disk are lost when it restarts (Cloudflare still has them). The free Workers plan
  allows 100,000 requests a day (one visit uses a few hundred to a few thousand).

| File | What it does |
|---|---|
| `deploy/hf/Dockerfile` | The Space's image: Node 24, public mode, S3 on, port 7860, the cache in `/app/cache` |
| `deploy/hf/README.md` | The Space's card (`sdk: docker`, `app_port: 7860`) |
| `deploy/hf/pack-hf.ps1` | Makes `deploy\out\hf-space`: the app + this PC's cache + the two files above |
| `deploy/hf/upload-hf.py` | Uploads that folder to the Space (resumes if cut off; only changed files go up later) |
| `deploy/cloudflare/worker.js` | The front door on Cloudflare: passes requests to the Space, keeps cutouts and tiles at the edge |
| `deploy/cloudflare/wrangler.toml` | The Worker's settings, for `npx wrangler deploy` (or use the dashboard instead) |

---

## Step 1: Hugging Face account (5 minutes)
1. Go to <https://huggingface.co/join> and sign up (email; no card).
2. **Settings → Access Tokens → Create new token**, type **Write**, name `arcnave-upload`. Copy it (keep it secret:
   do not paste it into chat or into any file in the repo).

## Step 2: Pack the Space (on this PC, about 5 minutes)
PowerShell, in the repo folder:
```
powershell -ExecutionPolicy Bypass -File deploy\hf\pack-hf.ps1
```
It prints the folder and its size (about 15,000 files, 2.6 GB). Run it again before each upload, so the newest code and
cache go up.

## Step 3: Upload (about 20-60 minutes for 2.6 GB, depending on the upload speed)
```
python -m pip install --user -U huggingface_hub
& "$env:APPDATA\Python\Python314\Scripts\hf.exe" auth login
python deploy\hf\upload-hf.py <your-hf-name>/arcnave
```
- `hf auth login` asks for the token from step 1 (paste it there, in the terminal). Answer **n** to "add as git credential".
- The script creates the Space (Docker, public) if it does not exist and uploads the folder. If it stops, run the same
  command again: it continues where it stopped.
- When it says *Done*, open `https://huggingface.co/spaces/<your-hf-name>/arcnave`. The **Building** badge turns
  **Running** after a few minutes. The address of the app itself is `https://<your-hf-name>-arcnave.hf.space`.

**If Hugging Face asks for a card for a Docker Space:** stop here and tell the team; the Space's other free option is
not suitable (Static Spaces cannot run the server).

## Step 4: Space settings (2 minutes)
On the Space page, **Settings → Variables and secrets → New variable**:
- `PUBLIC_URL` = `https://sky.arcnave.in` (link previews and share links use the site's own address)

The Space restarts by itself. Check `https://<your-hf-name>-arcnave.hf.space/api/health`: it shows `"ok":true` and the
version.

## Step 5: Cloudflare in front (15 minutes, free plan, no card)
1. <https://dash.cloudflare.com> → sign up (email only) → **Add a domain** → `arcnave.in` → **Free** plan.
   Cloudflare shows two nameservers: put them in the domain registrar's settings for `arcnave.in`, in place of the
   current ones. Cloudflare says *Active* when it sees them (minutes to a few hours). It copies the domain's existing
   DNS records (email included); check that the list looks complete before changing the nameservers.
2. **Workers & Pages → Create → Create Worker** → name `arcnave` → **Deploy** → **Edit code**: replace everything with
   `deploy/cloudflare/worker.js` → **Deploy**.
3. The Worker's **Settings → Variables and secrets → Add**: `ORIGIN` = `https://<your-hf-name>-arcnave.hf.space`
   (type Text) → **Deploy**.
4. The Worker's **Settings → Domains & Routes → Add → Custom domain**: `sky.arcnave.in`.
   Cloudflare makes the DNS record and the HTTPS certificate itself.
5. Open `https://sky.arcnave.in`. ARCNAVE opens. On a cutout or a sky tile, the response header `X-Arcnave-Edge`
   says `MISS` the first time and `HIT` after that.

(With Node on the PC, steps 2-4 can also be done with `npx wrangler login` then `npx wrangler deploy` in
`deploy/cloudflare`, after putting the Space address in `wrangler.toml`.)

## Step 6: Check, then submit
- `https://sky.arcnave.in/#ct=barnard` (and `epsindb`, `wise0855`, `rwaur`, `rdra`): each opens from the cache.
- A field never opened on the PC (e.g. `120 -30`): it loads in about 20 s; open it again from another browser: at once.
- Put `https://sky.arcnave.in` in the README ("Live") and in the Space Apps form.

## Updating later
Change the code → commit → `deploy\hf\pack-hf.ps1` → `python deploy\hf\upload-hf.py <your-hf-name>/arcnave`.
Only changed files go up; the Space rebuilds in a few minutes. Cloudflare's edge copies of cutouts stay valid (the
images never change); the page itself always comes fresh from the Space.
