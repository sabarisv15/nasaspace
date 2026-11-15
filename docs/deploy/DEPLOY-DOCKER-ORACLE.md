# Deploy ARCNAVE publicly: free and fast (Oracle Cloud Always Free)

**Result:** `https://<your-name>.duckdns.org` runs ARCNAVE 24/7, with HTTPS, for **₹0**.
- It never sleeps.
- The SPHEREx cache is kept on disk.
- The server sits in Ashburn, Virginia, next to NASA's SPHEREx copy on AWS S3 (`nasa-irsa-spherex`, us-east-1), so new fields load fast.

Time needed: about 1–2 hours the first time. Do it **before Nov 14** (hackathon Nov 14–15, judging from Nov 16).

**You need:**
- An email.
- A phone number.
- A debit or credit card. Oracle uses it only for verification; it charges nothing within Always Free.

| File | What it does |
|---|---|
| `Dockerfile` | The app image (Node 24, public mode, S3 on, cache in `/data`, health check) |
| `.dockerignore` | Keeps the local cache, backups and docs out of the image |
| `deploy/compose.yaml` | ARCNAVE + Caddy (automatic HTTPS), restart on crash or reboot |
| `deploy/Caddyfile` | HTTPS + security headers + long timeouts for SPHEREx downloads |
| `deploy/.env.example` | Your domain (copy to `.env` on the server) |
| `deploy/oracle-setup.sh` | One-time VM setup: Docker, firewall ports 80/443, swap |
| `deploy/pack.ps1` | Makes `deploy\out\arcnave-deploy.tgz` on Windows, to copy to the server |

---

## Step 1: Oracle Cloud account
1. Go to <https://www.oracle.com/cloud/free/> and click **Start for free**.
2. **Home Region: choose `US East (Ashburn)`.** This cannot be changed later, and it is what makes ARCNAVE fast.
3. Finish the email, phone and card verification.
4. Recommended once it works: **Billing → Upgrade to Pay As You Go**.
   - Always Free resources stay free.
   - Oracle does not reclaim idle Always Free VMs on paid accounts.
   - Then set **Billing → Budgets** to ₹100 with an email alert, so you are told if anything ever costs money.

## Step 2: Create the VM
**Compute → Instances → Create instance**, then fill in:
- **Name:** `arcnave`
- **Image:** Canonical **Ubuntu 24.04** (the default image may be Oracle Linux; change it).
- **Shape:** Ampere → **VM.Standard.A1.Flex**, **2 OCPU, 12 GB memory** (the Always Free limit since June 2026).
  - If you see *"Out of capacity"*, try another Availability Domain, or try again a few hours later.
  - Last resort: **VM.Standard.E2.1.Micro** (AMD, Always Free). It is slower, but it works.
- **Networking:** *Create new virtual cloud network* + *public subnet*, and tick **Assign a public IPv4 address**.
- **SSH keys:** *Generate a key pair for me*, then **Save private key**.
  - Save it as `C:\Users\Admin\.ssh\arcnave-oracle.key`.
- **Boot volume:** tick *Specify a custom size*, **100 GB**. Always Free allows 200 GB in total.

Click **Create**. When it is *Running*, copy its **Public IP address**.

## Step 3: Open ports 80 and 443 in Oracle's network
1. Open the instance page, then **Subnet**, then **Security Lists**, then **Default Security List**, then **Add Ingress Rules**.
2. Add two rules:
   - Source `0.0.0.0/0`, TCP, destination port **80**
   - Source `0.0.0.0/0`, TCP, destination port **443**

## Step 4: A free address (DuckDNS)
1. Go to <https://www.duckdns.org> and sign in (GitHub or Google).
2. Add a sub domain, e.g. `arcnave-sphere` → `arcnave-sphere.duckdns.org`.
3. Put the VM's **public IP** in *current ip* and click **update ip**.

The IP stays the same while the VM exists. If you ever re-create the VM, update the IP here.

## Step 5: Log in and set up the VM (once)
PowerShell on your PC. The first command makes Windows accept the key file:

```powershell
icacls "$HOME\.ssh\arcnave-oracle.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"
scp -i "$HOME\.ssh\arcnave-oracle.key" "D:\ARCNAVE-SPHEREX\ARCNAVE SPHEREX\deploy\oracle-setup.sh" ubuntu@<PUBLIC-IP>:
ssh -i "$HOME\.ssh\arcnave-oracle.key" ubuntu@<PUBLIC-IP>
```

On the VM:

```sh
sh oracle-setup.sh
exit
```

Log in again with the same `ssh` command, so Docker works without `sudo`.

## Step 6: Send ARCNAVE to the server and start it
On your PC (PowerShell):

```powershell
cd "D:\ARCNAVE-SPHEREX\ARCNAVE SPHEREX"   # the git repo (NOT the old ARCNAVE-REDESIGN copy, which is v0.55)
powershell -ExecutionPolicy Bypass -File deploy\pack.ps1
scp -i "$HOME\.ssh\arcnave-oracle.key" deploy\out\arcnave-deploy.tgz ubuntu@<PUBLIC-IP>:
```

On the VM:

```sh
mkdir -p ~/arcnave && tar -xzf ~/arcnave-deploy.tgz -C ~/arcnave
cd ~/arcnave/deploy
cp .env.example .env && nano .env        # set DOMAIN=arcnave-sphere.duckdns.org, then Ctrl+O, Enter, Ctrl+X
docker compose --env-file .env up -d --build
docker compose logs -f                  # wait for "ARCNAVE on ..." and Caddy's "certificate obtained"; Ctrl+C to leave
```

## Step 7: Check it
- **Health:** `https://<your-domain>/api/health` should show `{"ok":true,"version":"0.5x.x",...}`.
- **NASA targets:** open `https://<your-domain>/` and press each of the 5 NASA test targets once. They come from the shipped demo-cache.
  - The first open also fills the Gaia/CatWISE cache, so every later visitor gets them instantly.
- **A new field:** type a new RA/Dec. The first time it should load in well under a minute, and instantly after that.
- **Phone:** open the site on mobile data, not only on WiFi.
- **S3 check:** in the browser, open DevTools → Network on a `cutout` request.
  - The header `X-Arcnave-Server-S3: 1` means the server reads NASA's S3 copy.
  - If new fields hang, set `SKYSHIFT_S3: "0"` under `environment:` in `deploy/compose.yaml`, then run `docker compose --env-file .env up -d`. The server then uses IRSA directly.

## Step 8: Watch it (free)
1. Go to <https://uptimerobot.com>, then **Add New Monitor**.
2. Choose HTTP(s), URL `https://<your-domain>/api/health`, every 5 minutes.
3. You get an email if it ever goes down.

## Step 9: Update to a new version (e.g. after the UI upgrade)
On your PC, run `pack.ps1` and the `scp` line from Step 6 again. Then on the VM:

```sh
rm -rf ~/arcnave.new && mkdir ~/arcnave.new && tar -xzf ~/arcnave-deploy.tgz -C ~/arcnave.new
cp ~/arcnave/deploy/.env ~/arcnave.new/deploy/.env
rm -rf ~/arcnave.old && mv ~/arcnave ~/arcnave.old && mv ~/arcnave.new ~/arcnave
cd ~/arcnave/deploy && docker compose --env-file .env up -d --build
```

The cache and the HTTPS certificate are in Docker volumes, so they are kept.

To go back to the previous version:

```sh
cd ~ && mv arcnave arcnave.bad && mv arcnave.old arcnave && cd arcnave/deploy && docker compose --env-file .env up -d --build
```

**Freeze the code before judging:** do not deploy new versions after you submit.

## Useful commands (on the VM, in `~/arcnave/deploy`)

| Command | What it does |
|---|---|
| `docker compose ps` | Is it running and healthy? |
| `docker compose logs --tail 100 arcnave` | Last server messages |
| `docker compose restart arcnave` | Restart the app (the cache stays) |
| `docker system df` / `df -h` | Disk use (the cache is capped at 20 GB by `SKYSHIFT_CACHE_MB`) |
| `docker image prune -f` | Remove old images after updates |

## Problems

| You see | Fix |
|---|---|
| The site does not open at all | Check Step 3 (Security List 80/443) and that `oracle-setup.sh` ran. `sudo iptables -L INPUT -n` must show ACCEPT for 80 and 443 above the REJECT line. |
| Browser warns "not secure", or Caddy logs a certificate error | Check that DuckDNS points to the right IP (`ping <your-domain>`), that port 80 is open, then run `docker compose restart caddy`. |
| `ssh: permission denied` / "bad permissions" | Re-run the `icacls` line from Step 5, and use the user `ubuntu`. |
| "Out of capacity" when creating the VM | Try another Availability Domain or later, or use the E2.1.Micro shape. |
| A new field is slow | The first open of a field downloads from NASA; later opens come from the cache. Open the fields you will demo once before judging. |

## Optional: your own domain + Cloudflare
If you own a domain, you can use it instead of DuckDNS:
1. Point an `A` record to the VM IP.
2. Put the domain in `deploy/.env`.
3. Optionally put Cloudflare (free) in front for DDoS protection.
   - SSL/TLS mode must be **Full (strict)**.
   - Caddy still makes the certificate.

## Before you submit
- [ ] The public link works on a phone and on another network.
- [ ] All 5 NASA test targets open.
- [ ] `/api/health` shows the version you mean to submit.
- [ ] UptimeRobot is on.
- [ ] Backups in case the network fails during judging: a short demo video, and `make-share.bat`'s offline zip.
