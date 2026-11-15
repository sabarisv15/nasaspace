# ARCNAVE

**Watch the sky change. Find what moves.** A free public web tool that plays NASA SPHEREx's real infrared images of any
spot in the sky as a film, circles what moves, measures it, and checks it against ESA Gaia DR3 and NASA WISE.

NASA Space Apps Challenge 2026 · challenge **"Planet X and SPHEREx"**

- **Live:** <https://arcnave.vldeena2008.workers.dev> (always on, no sign-up, works on phones)
- **Code:** <https://github.com/deen2923/arcnave>
- **Demo deck (7 slides):** [`reports/ARCNAVE-Deck.pdf`](reports/ARCNAVE-Deck.pdf)

## Judge it in 60 seconds

1. Open <https://arcnave.vldeena2008.workers.dev/#ct=barnard>. Barnard's Star opens from saved NASA images in a few seconds.
2. Press **Play the film**. Each SPHEREx pass plays in date order and the star is circled in each pass.
3. Read **"What am I seeing?"** on the right: what ARCNAVE measured, what the catalogue says, and **"How sure are we?"**.
4. Try the other four NASA targets: `#ct=epsindb` · `#ct=wise0855` · `#ct=rwaur` · `#ct=rdra`.
5. Type any position (e.g. `190 -4`) or a name. A spot nobody has opened before is downloaded live from NASA:
   **20-90 s the first time**, a few seconds after that.

Tests and limits: `#scorecard` and [`/about.html`](https://arcnave.vldeena2008.workers.dev/about.html).

## What the challenge asked, and where it is

| Challenge asks | ARCNAVE |
|---|---|
| Users enter RA and Dec | Search box (RA/Dec or a name via CDS Sesame), or click the whole-sky map |
| Show the images like a little video | 🎬 Film, Time machine, Blink, Swipe |
| Make moving objects easy to spot | Movers circled in every pass, "was here, now there", four automatic searches |
| Test on the 5 named targets | All 5, one click each, measured value next to the catalogue value (below) |
| Easy to update with new releases | No release filter: QR2, QR3, DR1 and DR2 are picked up with no code change |
| Use the 102 bands; spectra on the fly | Colour slider, deep view per detector, spectrum of any star (0.75-5 µm) |
| Add or subtract images taken at different times | Stacks per pass, Difference, Changes map, shift-and-stack |
| Choose the field of view | 0.25°, 0.5° or 1° |
| Overlay Gaia or WISE | Gaia DR3 and CatWISE2020 overlays with motion arrows |
| Query by coordinates in the URL, embed | `#ra=…&dec=…`, `?embed=1`, "Copy embed code" |
| Show metadata such as contamination flags | SPHEREx FLAGS overlay and counts; release and date of every image |
| Use tools like Astropy and Aladin | Aladin Lite is the sky viewer; "Copy Python" and a Jupyter notebook use Astropy/astroquery |

## Results on NASA's five test targets

Measured by ARCNAVE on real SPHEREx images (QR2 + QR3).

| Target | ARCNAVE measured | Reference |
|---|---|---|
| Barnard's Star | 9.9″/yr north (moved 9.7″ in 359 days) | Gaia DR3 10.4″/yr (10.2″ expected in 359 days) |
| Epsilon Indi B | 4.32 ± 0.27″/yr south-east, over 4 passes | 4.68″/yr |
| WISE 0855−0714 | 8.82 ± 1.10″/yr west, AB 17.15 at 11.8σ | CatWISE2020 7.94″/yr (agrees within the error) |
| RW Aurigae | faded 0.74 mag, Sep 2025 → Sep 2026, in 6 of 6 colours | comparison stars steady to 0.13 mag |
| R Draconis | changed 1.24 mag at 0.85 µm over 10 images | comparison stars steady to 0.12-0.13 mag |

## How it works

1. **Find:** IRSA TAP (`spherex.plane`, `spherex.artifact`) lists every SPHEREx image covering the spot, in every release.
2. **Read:** only the rows of each 65 MB image that the field needs (about 4 MB), from NASA's open copy on AWS S3.
3. **Clean:** pipeline FLAGS bits (saturation, ghosts, cosmic rays) masked; zodiacal light removed.
4. **Match:** images of the same colour (wavelength) in every pass.
5. **Align:** on Gaia DR3 stars moved to each image's date.
6. **Measure:** an empirical PSF from each image's own stars (checked against the official SPHEREx PSF); a straight-line
   fit through the passes gives the motion, with an error floor from ~40 steady Gaia stars in the field.
7. **Check:** Gaia DR3, CatWISE2020, known asteroids (IMCCE SkyBoT, Minor Planet Center, JPL Horizons), and a
   "How sure are we?" note on every result.

## How far to trust it

Four tests on 18 sky fields chosen on a grid **before** any run (every 60° along the ecliptic, on it and 40° above and
below). Fields where ARCNAVE does badly stay in the tables.

- **Hide Planet X:** 19,880 fake planets injected into real SPHEREx images and searched for. A planet 1,000 AU away is
  found in 18 of 18 fields down to a median of **AB 17.0**; at 300 AU in 12 of 18 fields.
- **Brightness:** stars made 1.5× brighter are caught in 82% of 720 cases, 2× brighter in 89%.
- **False alarms:** two stacks that differ in nothing real are compared; crowded Milky Way fields give many more, and
  the app warns there.
- **Movers:** 416 fake movers of known speed and brightness injected and recovered, reported cell by cell.

## Planet X: what this can and cannot find

- **Planet X (Planet Nine) is a hypothesis** (Batygin & Brown 2016). Nothing in ARCNAVE is called a discovery, and every
  candidate stays "unconfirmed".
- **A Planet Nine as predicted is too faint for SPHEREx.** Published estimates put it at about V ≈ 19-24 (Batygin et al.
  2019). ARCNAVE's measured limit for a slow mover is about AB 17 in one field: at least 2 magnitudes (6×) brighter
  than the brightest predictions. The Hide Planet X test measures **how deep the method reaches**; it does not show
  that SPHEREx can see Planet Nine.
- **What ARCNAVE can realistically catch:** nearby cold brown dwarfs like WISE 0855 (found and measured at AB 17.15),
  fast nearby stars, asteroids, and any distant body much larger or closer than the predicted Planet Nine. These are
  the same kinds of objects that NASA WISE and Backyard Worlds: Planet 9 look for.
- SPHEREx pixels are 6.2″, so slow movers need several passes; the motion of most stars (well under 1″/yr) is too
  small to measure.

## Run it yourself

No npm install. Needs Node 18+ and internet.

```bash
node server.js
```

Then open `http://localhost:8080`. On Windows, double-click `start.bat` (opens `http://localhost:8083`). More detail is
in `HOW-TO-RUN.txt`. Public deploys: [`docs/deploy/DEPLOY-CLOUDFLARE.md`](docs/deploy/DEPLOY-CLOUDFLARE.md) (the live site),
[`docs/deploy/DEPLOY-DOCKER-ORACLE.md`](docs/deploy/DEPLOY-DOCKER-ORACLE.md) (Docker + Caddy).

## Tests

```bash
npm test
```

That runs 22 offline suites: synthetic FITS, parsers, server guards with mocked network, and real SPHEREx images in
`test/fixtures`. Browser end-to-end tests (Playwright + Chromium) are `npm run test:examples`, `test:tour`, `test:game`
and the others in `package.json`.

## Repository layout

```
server.js              small Node server: static files, archive proxy (allow-listed hosts), cache
lib/                   FITS + WCS + reprojection (fits.js), wavelengths (wave.js), S3 row reads (s3cut.js),
                       shift-and-stack (planetx.js), parsers, spot search
public/                the web app (index.html, app.js, tour, game, about.html, tools.html, i18n in 4 languages)
deploy/                Cloudflare Worker + build, Docker/Caddy, Hugging Face
demo-cache/            saved archive answers for the examples (open offline)
scorecard/             results of the 18-field tests
test/                  offline, real-data and browser tests
tools/                 scripts that build the test fields, the demo cache and the voices
reports/               submission text, the 7-slide deck, the full report and their sources
docs/                  full changelog, design changelog, deploy guides, research notes
archive/               older versions and redesign screenshots, kept for the record
```

## Data and credits

NASA/IPAC IRSA (SPHEREx QR2, QR3, DR1, DR2), ESA Gaia DR3, NASA WISE/CatWISE2020 and AllWISE, 2MASS, CSA NEOSSat via
CADC, IMCCE SkyBoT, Minor Planet Center, JPL Horizons, CDS (Aladin Lite, Sesame, SIMBAD, VizieR, HiPS). Full credits:
[`public/about.html`](public/about.html).

## Use of AI

The code was written with the help of an AI coding assistant (Claude, Anthropic). The tour narration uses Microsoft
neural text-to-speech voices. The idea, the design choices and the test plan are the team's, and every number above is
measured by the code on real archive data.

## History

Every version from v0.1 to now: [`docs/CHANGELOG.md`](docs/CHANGELOG.md).
