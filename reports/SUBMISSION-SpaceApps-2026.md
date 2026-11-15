# ARCNAVE: NASA Space Apps 2026 project submission text

Copy each section into the matching field on the team's Project page (My Team → Project → Edit).
Everything below is in English, as the rules require. Fill the three `[...]` links before you submit.

Submission closes **Sunday 15 Nov 2026, 11:59 p.m. (local time of your Local Event)**. Only the last saved
version is judged. Tick "Terms and Conditions" and "Confirm All Work is Original", then press **Submit for Judging**.

---

## 1. Project Name

ARCNAVE: Watch the sky change. Find what moves.

---

## 2. High-Level Project Summary

ARCNAVE is a free public web tool that turns NASA SPHEREx's all-sky infrared survey into a film anyone can watch.
Type any RA/Dec or a star's name: ARCNAVE fetches every real SPHEREx image of that spot from NASA/IPAC IRSA, lines
the images up on ESA Gaia DR3 stars and plays the passes in time order, so anything that moves or changes stands out.
Moving stars are circled pass by pass, measured in arcseconds per year, and checked against Gaia DR3, NASA's
CatWISE2020 and the known-asteroid services. It answers every objective of the "Planet X and SPHEREx" challenge and
all five of NASA's test targets with measured numbers: Barnard's Star moves 9.9″/yr (Gaia DR3 10.4″), Epsilon Indi B
4.3 ± 0.3″/yr (4.7″), WISE 0855 8.82 ± 1.10″/yr (CatWISE2020 7.94″), RW Aurigae faded 0.74 mag and R Draconis
changed 1.24 mag. To show how far it can be trusted, we hid 19,880 fake planets in real SPHEREx images on 18 sky
fields chosen in advance: a Planet X at 1,000 AU was found in 18 of 18 fields down to AB 17 (a Planet Nine as
predicted would be fainter still, and we say so). It matters because SPHEREx data is
public but arrives as 65 MB scientific files; ARCNAVE reads only the 4 MB a field needs and lets a student, a
citizen scientist or a researcher see the changing infrared sky in seconds, in English, Tamil, Hindi or Spanish.
Nothing is ever called a discovery: every result says how sure it is.

---

## 3. Link to Project Demo

[PASTE PUBLIC LINK to the 7-slide deck: upload `reports/ARCNAVE-Deck.pdf` to Google Drive, set "Anyone with the link: Viewer", paste the link here]

(Test the link in a private window before submitting. No login, no permission request.)

---

## 4. Link to Final Project

https://arcnave.vldeena2008.workers.dev  ·  Code: https://github.com/deen2923/arcnave

One-click NASA test targets (append to the live link): `#ct=barnard` · `#ct=epsindb` · `#ct=wise0855` ·
`#ct=rwaur` · `#ct=rdra`. Validation scorecard: `#scorecard`. Methods and limits: `/about.html`.

---

## 5. Detailed Project Description

### What it does

The challenge asked for "a public-facing web tool to display images of the sky from the SPHEREx mission, making it
easy for anyone to quickly see how they change over time." ARCNAVE does exactly that, and then measures what it shows.

1. **Pick any spot.** Type RA/Dec ("190 -4"), a name (resolved by CDS Sesame), or click the whole-sky map.
2. **Watch it change.** ARCNAVE lists every SPHEREx image of the spot in every release (QR2, QR3 and DR1) and shows
   them five ways: a 🎬 Film with each mover circled pass by pass (P1, P2…), a Time-machine slider, Blink (the way
   Clyde Tombaugh found Pluto), Swipe, and Difference / Changes maps that colour brightenings, fadings and movers by epoch.
3. **Measure it.** Click a star to measure its motion (″/yr with an error), its light curve (magnitudes against three
   steady comparison stars) or its spectrum (~100 colours from 0.75 to 5 µm, compared with 2MASS and AllWISE).
4. **Check it.** Gaia DR3 and CatWISE2020 overlays with motion arrows; known asteroids from IMCCE SkyBoT, the Minor
   Planet Center and JPL Horizons; SPHEREx pipeline FLAGS (saturation, ghosts, cosmic rays) shown on screen. Every
   result card has a "How sure are we?" note.
5. **Search for Planet X.** Automatic searches for bright movers, deep sources, differences, and a 625-motion
   shift-and-stack scan for faint slow movers. Candidates go through the Backyard Worlds checks automatically (seen
   again, known asteroid, Gaia/CatWISE match, NASA flags) and stay "unconfirmed".
6. **Share and reproduce.** Every view has a URL (`#ra=…&dec=…`), an embed code, "Copy Python" and a downloadable
   Jupyter notebook that redoes the work with Astropy/astroquery in the style of the SPHEREx tutorial notebooks.

### Every challenge objective, answered

| Challenge asks | ARCNAVE |
|---|---|
| Enter RA and Dec | RA/Dec, any name, or click the all-sky map |
| Show images like a little video | Film, Time machine, Blink, Swipe |
| Make moving objects easy to spot | Movers circled in every pass, "was here, now there", automatic searches |
| Test on the 5 named targets | 5 of 5, one click each, measured value next to the catalogue value |
| Easy to update with new releases | No release filter: SPHEREx DR1 (Nov 2026) appeared with no code change |
| Use the 102 bands; spectra on the fly | Colour slider; Deep view per detector; spectrum of any star |
| Add or subtract images in time | Stacks per pass, Difference, Changes, shift-and-stack |
| Choose the field of view | 0.25°, 0.5° or 1° |
| Overlay Gaia or WISE | Gaia DR3 and CatWISE2020 overlays with motion arrows |
| Query by coordinates in the URL | `#ra=…&dec=…` links, `?embed=1`, "Copy embed code" |
| Show metadata such as contamination flags | FLAGS overlay and counts; release and date of every image |
| Use tools like Astropy and Aladin | Aladin Lite is the sky viewer; Python and Jupyter export use Astropy |

### Results on NASA's five test targets (measured by ARCNAVE on real SPHEREx images)

| Target | ARCNAVE measured | Reference |
|---|---|---|
| Barnard's Star | 9.7″ north in 359 days = 9.9″/yr | Gaia DR3 10.4″/yr (10.2″ expected in 359 days) |
| Epsilon Indi B | 4.3 ± 0.3″/yr south-east over 4 passes | catalogue 4.7″/yr |
| WISE 0855−0714 | 8.82 ± 1.10″/yr west, AB 17.15 at 11.8σ | CatWISE2020 7.94″/yr (agrees) |
| RW Aurigae | faded 0.74 mag, Sep 2025 → Sep 2026, in 6 of 6 colours | comparison stars steady to 0.13 mag |
| R Draconis | changed 1.24 mag at 0.85 µm over 10 images | comparison stars steady to 0.12–0.13 mag |

### How it works

Find (IRSA TAP lists every SPHEREx image of the spot) → Read (only the field's rows of each 65 MB image, about 4 MB,
from NASA's open copy on AWS S3) → Clean (FLAGS bits and zodiacal light removed) → Match (images of the same colour in
every pass) → Align (on Gaia DR3 stars moved to each image's date) → Measure (an empirical PSF built from each image's
own stars, checked against the official SPHEREx PSF; a straight-line fit through the passes) → Check (Gaia, CatWISE,
SkyBoT/MPC/Horizons, "How sure are we?").

### How far to trust it

Four tests on 18 sky fields chosen on a grid before any run (along the ecliptic every 60°, on it and 40° above and
below), with the fields where ARCNAVE does badly kept in the tables:

- **Hide Planet X:** 19,880 fake planets injected into real SPHEREx images and searched for. A planet at 1,000 AU was
  found in 18 of 18 fields (median faintest AB 17.0); at 300 AU in 12 of 18. This measures how deep the method
  reaches. A Planet Nine as predicted (V ≈ 19-24, Batygin et al. 2019) is fainter than that, so we do not claim
  SPHEREx can see it; nearby cold brown dwarfs like WISE 0855 (AB 17.15) are within reach.
- **Brightness:** stars made 1.5× brighter were caught in 82% of 720 cases, 2× brighter in 89%.
- **False alarms:** measured by comparing two stacks that differ in nothing real. Crowded Milky Way fields give many
  more, and the app warns the user there.
- **Movers:** fake movers of known speed and brightness injected and recovered, reported cell by cell.

### Benefits

- **For the public and students:** the infrared sky as a film, a "Find the asteroid" game, a 90-second story and guided
  tours with narration in English, Tamil, Hindi and Spanish; works on phones; 48 tools explained in plain words.
- **For citizen scientists:** WiseView-style blinking for SPHEREx, plus automatic Backyard Worlds checks and a ready
  candidate report.
- **For researchers:** real measurements with errors, catalogue cross-checks and a Jupyter notebook to reproduce them.
- **For NASA:** a working public window on SPHEREx that picks up each new data release by itself.

### What we hope to achieve

Make every new SPHEREx release explorable by anyone on the day it comes out, and give citizen scientists an honest,
tested tool to look for nearby brown dwarfs and slow distant movers, the kind of object a Planet X would be.

### Tools, languages and software

JavaScript in the browser (Web Workers for image processing), a small Node.js server with no npm dependencies, CDS
Aladin Lite for the sky viewer, FITS reading and PSF fitting written by the team, Python/Astropy/astroquery for the
exported notebooks, Docker and Caddy for deployment, headless Chrome for end-to-end tests.

### Honest limits

SPHEREx pixels are 6.2″, so slow movers need several passes; crowded Milky Way fields give more false alarms;
Planet X is always called hypothetical and candidates are always "unconfirmed"; a Planet Nine as predicted is fainter
than SPHEREx's single-field limit, so the realistic targets are nearby brown dwarfs, fast stars and asteroids.

---

## 6. Use of Super Intelligence (SI)

(Seen only by organisers, not by judges.)

Yes. The code was written with the help of an AI coding assistant (Claude, by Anthropic), used to speed up
programming, testing and documentation. The idea, the scientific method, the design choices and the test plan
(targets, 18 pre-chosen fields, fake-planet injection) are the team's, and every number in the project is measured by
the code on real archive data and checked against Gaia DR3 and CatWISE2020. All AI-assisted code was reviewed and
tested by the team (offline, real-data and browser test suites in the repository). The guided-tour narration audio uses
Microsoft neural text-to-speech voices; this is stated in the app's About page and README. No AI-generated images were
used, and no NASA logos, flags or mission identifiers were generated or modified. The SI disclosure is in the README
and `public/about.html`.

---

## 7. NASA Data

- **NASA SPHEREx** spectral images, Quick Release 2, Quick Release 3 and Data Release 1, via **NASA/IPAC IRSA**
  (TAP tables `spherex.plane`, `spherex.artifact`; cutout service) and NASA's open copy on **AWS S3**
- **SPHEREx DR1 all-sky spectral cube** (base sky that follows the colour slider)
- **SPHEREx tutorial notebooks** (IRSA): cutout form, TAP queries and FLAGS bit names
- **IRSA Data Explorer, SPHEREx Spectrophotometry Tool and MOST** (linked from every spot)
- **NASA WISE**: CatWISE2020 (motions of cool brown dwarfs) and AllWISE photometry
- **2MASS** photometry (IPAC/IRSA) for spectrum checks
- **NASA JPL Horizons** (asteroid orbits)
- **WiseView** and the **Backyard Worlds: Planet 9** checking steps (NASA-funded citizen science)
- **STScI MAST** copy of Gaia DR3 (fallback)

---

## 8. Space Agency Partner Data and Other References

**Space Agency Partner data**

- **ESA Gaia DR3**: astrometric reference for every image and the check for every motion (via IRSA, CDS VizieR or STScI MAST)
- **CSA NEOSSat** frames via the **Canadian Astronomy Data Centre (CADC)**: "This spot elsewhere" shows how many
  NEOSSat frames cover the spot and NEOSSat's own pictures (e.g. Barnard's Star: 652 frames, 2019–2022); links to the
  NEOSSat data tutorial and open dataset
- **CADC** SSOIS and Digitized Sky Survey links

**Other data and services**

- IMCCE SkyBoT and the Minor Planet Center (known asteroids)
- CDS Strasbourg: Aladin Lite, Sesame, SIMBAD, VizieR and HiPS sky surveys

**Software and tools**

- Node.js, JavaScript, Web Workers; Aladin Lite (CDS); Docker, Caddy
- Python, Astropy and astroquery (exported notebooks)
- Microsoft neural text-to-speech voices (tour narration)
- Claude (Anthropic) as AI coding assistant (see SI section)

Full credits and acknowledgements: `public/about.html` in the project.

---

## 9. Project Demo outline (7 slides max, English)

Built: `reports/ARCNAVE-Deck.pdf` (source `reports/src/deck7.html`). The table below is what is on it.

The rules allow a 7-slide deck (title and intro included) OR a video of 30 s or less. Going over either limit makes
the project ineligible for Global Judging. Do not show anyone under 18 in slides or video.

| # | Slide | What goes on it |
|---|---|---|
| 1 | **Title** | ARCNAVE: Watch the sky change. Find what moves. · Team name · team members · Challenge: "Planet X and SPHEREx" · hero screenshot |
| 2 | **The problem** | SPHEREx maps the whole sky in 102 infrared colours every six months, but the data is 65 MB scientific files. In 1930 Tombaugh blinked two plates and found Pluto; today nobody can blink SPHEREx. |
| 3 | **What we built** | Screenshot of the Film on Barnard's Star with circled movers. "Type any spot → real SPHEREx images play as a film → movers are circled and measured." |
| 4 | **How NASA data makes it possible** | Pipeline strip: IRSA → AWS S3 (4 MB of 65 MB) → clean FLAGS → align on ESA Gaia → measure → check with CatWISE, asteroid services. 8 of 8 challenge resources used. |
| 5 | **Results: 5 of 5 NASA targets** | The results table (measured vs catalogue). |
| 6 | **Why you can trust it** | 19,880 fake planets in 18 pre-chosen fields; Planet X at 1,000 AU found 18/18. Screenshot of the scorecard. "Nothing is called a discovery." |
| 7 | **The user experience and the future** | Tamil page screenshot and phone layout; game, story, 4 languages. Future: every SPHEREx release explorable on day one by anyone; citizen scientists hunting nearby brown dwarfs. Live link + QR code. |

## 10. 30-second video script (alternative to slides)

- **0:00** "We are team [TEAM NAME]."
- **0:02** "NASA's SPHEREx maps the whole infrared sky every six months. We took the 'Planet X and SPHEREx' challenge."
- **0:05** "This is ARCNAVE: watch the sky change, find what moves."
- **0:10** (screen: type Barnard's Star, the film plays, the star is circled) "Type any spot. Real SPHEREx images from
  NASA's archive play as a film, lined up on ESA Gaia stars. Movers are circled and measured: Barnard's Star, 9.9
  arcseconds a year; Gaia says 10.4. All five NASA targets answered."
- **0:20** (screen: scorecard, then the Tamil tour) "Tested with 19,880 hidden fake planets. In four languages, on any
  phone. Every new SPHEREx release, explorable by anyone, on day one."
