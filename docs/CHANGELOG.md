# ARCNAVE changelog

Every version, newest first, as it was written at the time. Older sections describe older behaviour (for example, v0.1-v0.8 said Planet X was not searched for; the Hide Planet X search came later). The current state is in the README.

## v0.57.15: ready for judging: 7-slide deck, clean repo, honest Planet X limit (15 Nov 2026)
- **Demo deck:** `reports/ARCNAVE-Deck.pdf`, 7 slides (the Space Apps limit; the old 23-slide `.pptx` is the long talk
  version). Source `reports/src/deck7.html`, printed by `reports/src/deck7.cjs`, which refuses more than 7 slides.
- **Planet X, said plainly:** README, submission, about page and the scorecard's "In one look" now say that a Planet Nine as
  predicted (V about 19-24, Batygin et al. 2019) is fainter than ARCNAVE's limit (about AB 17), so the Hide Planet X test
  measures depth, not that SPHEREx can see it; nearby cold brown dwarfs like WISE 0855 are within reach.
- **Submission text:** Barnard's Star reference fixed (Gaia DR3 10.4″/yr; 10.2″ is the shift expected in 359 days);
  "V ≈ 17" corrected to AB 17.0.
- **Start page:** under the search box: the 5 NASA targets open in seconds, a new spot takes 20-90 s the first time
  (English, Tamil, Hindi, Spanish).
- **Repository:** README rewritten for judges (60-second path, challenge table, results, limits, layout); the version
  history moved here; old backups (`public-backup-0.54.0`, `arcnave-v0.11.0-update`, `redesign-docs`) moved to `archive/`;
  deploy guides and research notes moved to `docs/`; the stray `sync.csv` removed. Deploy and share scripts updated.
- **Team prep:** `reports/JUDGE-QA-PREP.md`, the questions judges are likely to ask with answers tied to the code.
- Tests: `npm test`, 22 suites passed.

## v0.57.14: the trip by the galactic centre made shorter, the new field opens on time (15 Nov 2026)
Asked by the team: after v0.57.13 a new field opened late.
- Measured (cached fields, report time): the 2.3 s trip made the report 2 to 5 s later than a direct jump (WISE 0855
  13.2 s vs 8.4 s), because the preview waits for the camera and the whole-sky view shared the page while the field loaded.
- Now fade 0.2 s, galactic centre 0.7 s, dive 0.45 s (about 1.4 s), and the RA/Dec grid (thousands of projections per
  draw) is skipped while the trip passes the galactic centre. Report time now equals a direct jump: R Draconis 10.9 s vs
  12.8 s, Barnard 8.8 s vs 9.0 s, WISE 0855 12.9 s vs 12.8 s.

## v0.57.13: from field to field by the galactic centre again (15 Nov 2026)
Asked by the team: a trip from one field to a far one should pass by the galactic centre, as it did before v0.57.9.
- The sky fades out, the whole-sky map comes up centred on the galactic centre (labelled), holds about 1.3 s, then dives
  towards the new field and the field fades in. The dive aims at the new field's place on the whole-sky map.
- Cheap this time: the sky viewer draws the whole sky once and the new field once. The fades and the dive are CSS
  opacity and scale on the browser's compositor, so the page keeps answering. Measured on the Intel UHD 620 laptop,
  Barnard's Star to R Draconis: worst frame 0.5–0.7 s (the old animated flight: one frame of 18.9 s).
- The whole-sky map key stays hidden during the trip. A newer trip cancels an older one; "reduce motion" and the tour still jump.

## v0.57.12: which numbers to type; where the view is, in degrees (14 Nov 2026)
Asked by the team: visitors did not know what coordinates to type, or which patch of sky they were looking at.
- **Whole-sky map: an RA/Dec grid in degrees.** RA lines every 30° (0° to 330°), Dec lines at −60°, −30°, 0°, +30°,
  +60°, the celestial poles marked. The map is in the galactic frame, so the grid curves.
- **The position under the mouse** (RA, Dec in degrees) shows next to the pointer on the whole-sky map, ready to type in Fly to.
- **"Which numbers to type?"** on the whole-sky caption: RA 0° to 360°, Dec −90° to +90°, and three example positions
  (Orion Nebula, Barnard's Star, Pleiades) that fly there in one tap. The quick start's first tip says the same.
- **Zoomed in: each corner of the eyepiece gives its RA/Dec** (ICRS, degrees), and the status bar gives the RA and Dec
  range on screen ("View"). A bottom corner covered by the film's player is skipped. When the status bar has no room
  (narrow windows while a field loads), View hides and the corners still give the limits.
- Kept light: the eyepiece size is measured only when it changes (resize, panels), the status-bar fit is checked every
  2 s at most, and the "is the player in the way" hit test once a second at most (no layout read on every frame).
- Tests: `test/test.js` 15 passed, `test/real.test.js` 9 passed; checked in Chrome at 1600 and 1920 px wide.

## v0.57.9: the full project report; the right version on screen (14 Nov 2026)

- **Full report:** `reports/ARCNAVE-Full-Report-v0.57.8.pdf` (source `reports/src/report-full.html`): the challenge
  objective by objective, every listed resource and how it is used, the data pipeline, the five targets, the four tests,
  what makes ARCNAVE different, the journey from v0.9, and screenshots of every feature from the running v0.57.8.
  `reports/src/shots-full.cjs` retakes the screenshots with headless Chrome (no npm packages).
- **Version badge:** the header still said v0.56.0; it now shows the running version.

## v0.57.11: every feature walked through; the worst hangs found and removed (14 Nov 2026)
A scripted walk through the whole site on the real server (real data, real sky viewer, Chrome on this PC's Intel UHD 620
GPU): the start page, the 5 NASA targets, every view, every tool, the film, Hide Planet X, share, game, tour, the four
languages, the about/tools/scorecard pages, embed mode and a phone screen. 52 steps; every feature works. What it found:
- **Switching to a far field froze the page for up to 19 s.** The flight out to the whole sky and back (v0.35.2) made the
  sky viewer redraw the whole sky in another projection while the new images loaded: one frame of 18.9 s, 32 s of frozen
  page (Barnard's Star to R Draconis). A far switch now fades the sky out, jumps and fades it in: 5.6 s blocked in total,
  no frame over 1.3 s. Short pans and the dive from the whole sky are unchanged.
- **The wait panel forced a layout of the whole page twice a second** (it read its own height after writing its text):
  17 s of a 40 s switch in a CPU profile. It now writes only what changed, and its height reaches the page through a
  ResizeObserver. The status line and the time bar (every 1 s and 0.25 s) also write only what changed.
- **Stacks and the Changes maps were rebuilt whenever any image arrived** (their key held the global alignment counter):
  Deep view's 36 images rebuilt every epoch's stack 78 times (10 s of frozen page). Each stack is now keyed on its own
  images and their alignment; Deep view: no frame over 0.2 s.
- **Contrast slider:** every step repainted every image (0.3 s each); now the image on screen at once, the others with pauses,
  one repaint per screen frame. **Hide Planet X** says it is working before its 0.5 s trial. **Game** buttons pressed before
  its images are ready do nothing (they threw errors).
- Measured after: film playback 43 frames a second, no frame over 0.12 s; all views, tools, tour and languages with no frame
  over 0.2 s; measured motions unchanged (Epsilon Indi B 4.32″/yr, Epsilon Indi A 4.71).
- Still there, outside this code: the sky viewer's own work when it starts (its script, 1-3 s the first time on this
  laptop) and while a new field's sky tiles arrive (frames of about 1-2 s); a new spot's first file can log one harmless 416;
  the SPHEREx sky asks for a Moc.fits it deliberately does not get (v0.57.2). Turning the glass blur off was measured too:
  no real gain, so the look stays.

## v0.57.8: the page keeps answering while it works; panels scroll at once (13 Nov 2026)
Measured in headless Chrome (Long Animation Frames API, after the first 7 s), old code and new code side by side on the
same machine and saved images, film included. Every measured number is unchanged (Epsilon Indi B 4.316672016104891″/yr,
Barnard's Star 13.204205407378112; same movers in both films).

| | frames > 200 ms | main thread blocked | worst freeze |
|---|---|---|---|
| Epsilon Indi B, old → new | 20-23 → 8 | 6.6-8.0 s → 4.5 s | 0.99 s → 0.42 s |
| Barnard's Star, old → new | 42 → 10 | 12.7 s → 2.5 s | 0.89 s → 0.51 s (film ready 21 s → 12 s) |

- **Panels scroll at once, whatever the page is doing.** The report card and the drawers have see-through glass
  backgrounds, so Chrome scrolled them on the page's main thread (Chrome's layer tree: no scrolling layer of their own;
  one drawer "repaints on scroll"): while images loaded or a search ran, they did not move. `will-change: scroll-position`
  gives each its own compositor scroller (checked in the layer tree), without changing how anything inside is placed.
- **Star shapes (ePSF) are made in the worker pool**, several at once: 0.2-0.4 s each on the page before (24 in a row on
  Barnard's Star). Same function (`lib/fits.js epsfGrid`); the copy a worker sends back gets its lookup rebuilt from the
  same grid by `F.epsfRevive` (`test/epsfworker.test.js`: identical to the last bit on the real fixture images).
- **The film strip is no longer rebuilt after every image** (250+ thumbnails redrawn each time); only changed thumbnails
  are redrawn.
- **The sky view rebuilds an epoch's median stack at most once a second while images arrive** (it rebuilt them on the
  next frame after every image, 0.05-0.2 s each). Measurements still use the up-to-date stack.
- Each image's build, line-up and listing, the re-alignment when the reference image arrives, each image's Gaia line-up
  (the first measurement did 28 at once: 2.4 s) and the film's tracks (`movieMovers`: 1 s) now run one step at a time
  with a pause in between; the bright-star search pauses every 50 ms instead of every 6th star.
- Still on the page: the sky viewer itself (Aladin Lite: its script, about 1 s, and its first 2MASS sky image, about
  0.6 s, at the start) and single measurements of one star across all images (0.1-0.3 s each).
- Known, not changed here: `node test/psf.test.js` (not part of `npm test`) stops on the old code too, since
  `demo-cache/cutouts` now also holds the other test fields' images, which do not cover the field it assumes.

## v0.57.7: ready to publish: judges' quick start, AI disclosure, Cloudflare measured (13 Nov 2026)
- **README "For judges"** at the top: what ARCNAVE does, the 5 NASA targets one click each, how to run it, data credits.
- **AI (SI) disclosure**, as the Space Apps submission guide asks: the code was written with an AI assistant (Claude); the
  tour narration is Microsoft neural text-to-speech (README, `public/about.html`, and `public/audio/ABOUT-THESE-VOICES.txt`
  next to the recordings). No image, data or result is AI-generated.
- `.gitignore`: `.claude/` and `HANDOFF-PROMPT.md` (internal) stay out of the public repository.
- **Measured: a Cloudflare quick tunnel from this PC is not fast enough to host ARCNAVE.** Through
  `*.trycloudflare.com` the server's files reached a visitor at 60-130 KB/s (nothing cached: `cf-cache-status: DYNAMIC`),
  against 1.33 MB/s for this PC's own upload: Aladin Lite (840 kB) took 10 s, each saved image (0.58 MB) 7.5-8 s, so a
  saved field (24 images) would take minutes. The archive searches through it were fine (0.8 s). The public server stays
  the Oracle Cloud plan in `DEPLOY.md` (Ashburn, next to NASA's S3); Cloudflare can sit in front of it with a domain.

## v0.57.6: ready for the public server (13 Nov 2026)
- **The 18 test fields stay as measured on the public server too.** Their image lists (QR2 + QR3, 0 DR1) are now in
  `demo-cache/api` (2.3 MB), which goes into the Docker image; shipped lists are frozen like pinned ones. Before, only the 5
  NASA targets and the examples were shipped, so a fresh server would have listed DR1 for the scorecard fields and
  measured other numbers than the ones quoted. On a server near AWS the images themselves come from S3 in seconds.
- **Three NASA targets' shipped lists were older than the measured ones** (29 Oct vs 12 Nov): Barnard 357 → 359 images,
  **Epsilon Indi B 325 → 445** (the September 2026 pass was missing, so a fresh server would have shown 3 passes, not the
  quoted 4 passes over 515 days), R Draconis 2454 → 2483. `demo-cache` now has the lists the numbers were measured on.
  Checked on a fresh public-mode server with an empty cache: all 37 shipped lists frozen, no DR1, 2.5 s for all of them,
  and no archive search needed (IRSA's TAP was not answering that evening).
- **DEPLOY.md and deploy/pack.ps1 name the right folder** (`D:\ARCNAVE-SPHEREX\ARCNAVE SPHEREX`, the git repo). They still
  named the old `ARCNAVE-REDESIGN` copy (v0.55), so following them would have deployed old code.

## v0.57.5: this spot as a Jupyter notebook (13 Nov 2026)
"Copy Python" (v0.39) gave a short script: the archive query and the first and last images side by side. **Share → Python
notebook** now downloads a Jupyter notebook (`public/notebook.js`, also as one `.py`) in the style of IRSA's SPHEREx tutorial
notebooks, which redoes ARCNAVE's work for the spot in the open (`pip install astroquery matplotlib reproject`):
1. ARCNAVE's own IRSA TAP query (every release, no filter); images per release and per pass (a gap of 60+ days = new pass).
2. One image per pass (its detector covers the colour on screen), put on one sky grid with `reproject`: panels, "last minus
   first", and the blink film the challenge asks for, saved as a GIF.
3. Gaia DR3 (IRSA, brightest first) moved from J2016.0 to each image's date by proper motion; the fastest stars listed.
4. A spectrum on the fly: each image's wavelength at the star from its WCS-WAVE table (`WCS(..., key='W')`), aperture sum
   minus a sky ring, MJy/sr to mJy with the pixel's solid angle; points whose aperture has OVERFLOW / NONLINEAR / BLOOM /
   SUR_ERROR / MISSING_DATA / NONFUNC pixels (bit names read from the FLAGS header, DR1/QR3 `MSKN` or QR2 `MP_`) are drawn grey.
- Run end to end on real IRSA data (Python 3.14, astropy 8.0, astroquery 0.4.11): **Barnard's Star**: 358 images (DR1 239 +
  QR3 119), 3 passes; fastest Gaia star Barnard itself at 10.39″/yr; all 60 spectrum points flagged (too bright for SPHEREx,
  the notebook says so); 75 s. **WISE 0855's comparison spot**: 258 DR1 images, 59 spectrum points of which 7 flagged.
- Offline test `test/notebook.test.js` (valid nbformat 4, the spot in the setup cell, no release filter, strings escaped).
- Page stays responsive during the film's searches: longest freeze 7.2 s -> 2.6 s, total 48.7 s -> 19.4 s, film ready
  50 s -> 40 s (Epsilon Indi B target, headless Chrome); every measured number unchanged (Epsilon Indi B mu
  4.316672016104891). (Commit 88a6fc2, from the "Project upgrade handoff" session.)

## v0.57.4: NEOSSat's own pictures of the spot (13 Nov 2026)
Of the challenge's four Canadian Space Agency resources, ARCNAVE only counted NEOSSat frames (v0.57). Now it shows them:
- **Server:** `/api/neossat` also lists the nights NEOSSat looked (CADC TAP, raw frames; DARK/FLAT/BIAS frames have no sky
  and are left out): up to 8, spread over the years, each with its middle frame. `/api/neossat/preview?id=…[&s=256]` fetches
  CADC's own preview picture of that frame (`ws-cadc.canfar.net/minoc/files/cadc:NEOSSAT/<id>_raw_prev[_256].png`), only for
  13-digit ids, and keeps it in `cache/neossat/` (counted in the cache limit), so a demo opens them offline.
- **App:** "This spot elsewhere" shows the nights as thumbnails (date, frames that night); a click opens the large picture.
  Barnard's Star: 652 frames, 14 nights with sky (2019-10-13 to 2022-11-14), 8 shown. New row "About NEOSSat": the CSA
  mission page, the Python data tutorial and the open dataset, so all 8 challenge resources are linked from the app.
- **Honest limits:** the frames are pointed and turned differently, and the 2019 Barnard frames are 728×256 sub-frames with
  no sky coordinates (the 2022 one has only the pointing's), so ARCNAVE lines nothing up and measures nothing on them.
- Tests: nights (grouping, middle frame, darks and junk ids dropped, at most 8 with first and last kept), previews (bad id
  refused, saved, 404 when CADC has none, served offline).
- v0.57.3 (committed just before): review fixes left by another session (test-field lists during a fresh check, SPHEREx
  sky-tile bans per frame, static files gzipped once with ETags, candidate flags from the page's own FLAGS).

## v0.57.2: SPHEREx's own sky, NASA's flags on a candidate, a WiseView-style view (13 Nov 2026)
Four upgrades from the challenge's resources, none of which changes a measured number:
- **SPHEREx DR1 all-sky as the base sky** (Base sky → "SPHEREx DR1 all-sky (NASA, follows Color)"). IRSA released NASA's own
  all-sky cube on 1 Nov 2026: 102 frames, 0.75-5 µm. The server serves frame F as `/hips/sphx<F>/` (upstream tiles
  `NpixN_F.png`), cached like the other skies; the frame is the one nearest the Color slider, from the cube's own wavelength
  list (the blank dichroic frames 50 and 51 are skipped). Aladin Lite 3.8.2 stopped ("unreachable") on the cube's own
  properties, so each frame is described as a plain colour picture HiPS (no cube lines, no pixel cut, no MOC). Checked in
  Chrome on Barnard's field: SPHEREx sky, five colour changes, back to 2MASS and again, no error.
- **FLAGS bit names from QR3 and DR1 files** (`MSKN0000 = 'TRANSIENT'`; QR2 wrote `MP_TRANSIENT = 0`). QR3 and DR1 use the
  same bit numbers as before, so their masks are kept exactly as they were; a future release that moves a bit gets its own.
- **NASA's pipeline flags on a candidate:** the candidate card reads the FLAGS of that image at that spot (3×3 pixels) and
  names them: CROSSTALK, GHOST, PERSIST, HALO… say "most likely an artefact", SOURCE and OUTLIER are noted. On Barnard's field
  a G 7.6 star reads TRANSIENT, OVERFLOW, SUR_ERROR, SOURCE. Labels only: the masks are unchanged.
- **Contrast and Invert** under the Color slider, as in WiseView: contrast lifts faint things, Invert shows dark stars on a
  light sky. Picture only; at "normal" the pixels are exactly as before. In the tools list in all four languages.

## v0.57.1: new SPHEREx data releases are found by themselves (13 Nov 2026)
ARCNAVE's archive search (IRSA TAP, `spherex.plane`) has never had a release filter, so every release NASA adds is searched
in every new spot with no change to ARCNAVE (checked live: a never-opened spot now returns 271 DR1 images). Now it also says so:
- **Release watcher:** `/api/spherex/releases` lists the release folders of NASA's public S3 copy (`qr2/ qr3/ dr1/`, one
  small request), kept a day, asked again at start and once a day; the server log names any release this version was not
  built with (`newSinceBuild`, e.g. a future DR2). If S3 does not answer, the saved list is served (marked stale).
- **In the app:** the Releases panel says what NASA has out now and when it was checked; a release newer than this version
  gets one note per browser; the status line marks the newest release in amber; the data note names it.
- **Fix:** the star-spectrum reader (`lib/spot.js`) keyed its learned file layouts by `qrN` folders only, so DR1 files (and
  any later release) all shared the key `?`. Any release folder now gets its own key (`dr1:6`).
- Test fields stay frozen as in v0.56.3 (their quoted numbers were measured on QR2 + QR3); "Check for new data" switches one.
- Tests: release order, new since this build, kept a day, stale when S3 is down; DR1/DR2 layout keys.

## v0.57.0: every resource of the challenge, linked (13 Nov 2026)
The challenge's Resources tab lists NASA/IPAC IRSA, the SPHEREx tutorial notebooks, WiseView, Gaia DR3 at STScI MAST and the
Canadian Space Agency's NEOSSat, CADC data and NEOSSat tutorial. Each one is now part of ARCNAVE:
- **🔗 This spot elsewhere** (Share & report, and "Elsewhere" in every Gaia and WISE star card): the same position in IRSA's
  SPHEREx Data Explorer, Spectrophotometry Tool, tutorial notebooks and release page; WiseView (blinking NASA WISE), unWISE,
  Legacy Surveys, Pan-STARRS, IRSA Finder Chart, the Digitized Sky Survey at CADC; SIMBAD, VizieR, MAST; the MPC checker,
  IRSA MOST and CADC's SSOIS; Backyard Worlds' guide and Talk board. 19 links, all checked.
- **NEOSSat (CSA) at this spot:** the server asks CADC's TAP (`/api/neossat`, CAOM2 collection NEOSSAT; CADC sends no CORS
  header) how many NEOSSat frames cover the field, when, and of which targets. Barnard's Star's field: 652 frames,
  2018-11-14 to 2022-11-14, BarnardStar 647. Most spots have none: NEOSSat is pointed, not a survey.
- **Gaia DR3 from MAST** as the third copy (IRSA, then CDS VizieR, then MAST's TAP `dbo.gaia_source`). Tested live: Barnard's
  Star comes back with 10.36″/yr.
- **Backyard Worlds checks on every candidate:** seen again minutes later, no known asteroid, no Gaia DR3 star and no CatWISE2020
  source within one SPHEREx pixel (✓ / ✗ / not checked), then SIMBAD 1′, VizieR, Finder Chart and WiseView links.
- **About page:** a section on each resource and the acknowledgements (IRSA's SPHEREx text, the QR2, QR3 and DR1 DOIs, Gaia,
  WISE/CatWISE2020, NEOSSat under the Open Government Licence - Canada). "This spot elsewhere" is in the tools list in all
  four languages.
- Note: CDS (SIMBAD, VizieR) answered "Page unavailable" from this network on 13 Nov; the links are the standard ones.

## v0.56.3: NASA's DR1 is out; the test fields stay fast (13 Nov 2026)
NASA/IPAC IRSA released **SPHEREx Data Release 1 (DR1)** in November 2026: passes 1 and 2 reprocessed, QR2 no longer
listed (its files stay downloadable until February 2027). ARCNAVE's archive search needed no change: a new spot now lists
DR1 + QR3 by itself (Barnard's field: 239 DR1 + 119 QR3 images, no image listed twice). But every image has a new file name,
so each saved field would have refreshed its list within a day and downloaded about 100 MB again, and every number ARCNAVE
quotes was measured on the QR2 + QR3 lists.
- **Frozen test fields.** The image lists of the 29 pinned start-screen fields and the shipped examples (37 in all) are never
  asked again in the background. Barnard's Star opens with its report in 11 s and 0 images downloaded. The Releases panel
  says so ("Kept as measured"), and "Check for new data" shows what IRSA lists now without replacing the frozen list;
  "Switch this spot to the new list" then uses DR1 (kept apart, `searchl` in the cache, so it is fast the second time).
- **Measured on this PC (one DR1 image, Barnard's 0.5° field):** S3 row read 4.36 MB, 6.4 s once the header layout is known
  (IMAGE 2.45 MB, FLAGS 1.63 MB: DR1's FLAGS compress worse than QR3's 0.90 MB); IRSA's own cutout service 5.3 MB and 13-20 s
  per image (it keeps the PSF and VARIANCE), 23 s for 6 in parallel. So the page's S3 read stays; the network is the limit.
- **Fix:** the Releases panel no longer prints the word "null".

## v0.56.2: one honest number for Epsilon Indi B (13 Nov 2026)
The start page said 5.03 ± 0.41″ a year (360 days); the target card said 4.4″ in a year. Re-measured twice today with the
app's own film on the cached field (8 images per pass, all 4 passes, Apr 2025 to Sep 2026): **4.32 ± 0.27″ a year
south-east** (🔭 deep search), 5.9″ in 515 days; the catalogue says 4.68″ a year (1.4σ away). The start page (all four
languages) now says "4.3 ± 0.3″ a year over 4 passes (5.9″ in 515 days); the catalogue predicts 4.7″", and the target card
adds the same 4-pass value beside its one-year 4.4″. The 5.03 ± 0.41 is withdrawn. Epsilon Indi A is saturated in 17 of 18
images, so the film shows it as the catalogue predicts it, not as a measurement.

## v0.56.1: a calmer start page, a film that stays in view (13 Nov 2026)
- **Start page:** the hero is centred, with the picture below the words (desktop and phone). The picture is now the
  Lindbloom blink only, playing as soon as the page shows; its caption says plainly that 3865 Lindbloom is a known
  asteroid ARCNAVE caught moving. The Tamil, Hindi and Spanish film captions quote the measured Epsilon Indi B motion
  (5.03 ± 0.41″/yr, as on its target card) instead of 5.9″.
- **🎬 Film:** the "from here to there" callout and the pass caption stay on the sky between the controls panel and the
  right card (`movieFreeX` in `app.js`); before, the callout could slide under the card. Checked on Barnard's Star at
  1366 px with the card open: every callout and caption inside the free sky.
- **Time machine:** month labels are spaced by their real width, so they no longer overlap on a narrow track.
- **Fix:** the start page's star background no longer throws on every frame when the window has no size.

## v0.56: every field within a minute, the start screen ready (11 Nov 2026)
Measured on this PC (2.2-2.4 MB/s to NASA's S3, the same with 4, 8 or 16 streams): a new field at 8 images per pass took
79-90 s (archive search 6-16 s, then ~170 MB of image rows). Now:
- **Fewer bytes per image.** ZODI (the zodiacal-light model) was a third of every image read (half on QR3 files). It is
  smooth, so 9 of its rows are read and the rest rebuilt between them (`lib/s3cut.js` `zodiRows`). IMAGE and FLAGS are byte
  for byte the same; on 120 real cutouts the rebuilt ZODI is within 1.2 % of the image noise (rms, worst image), 0.3 % after
  the app's own processing. 7.5 MB → 5.1 MB per image.
- **Quick first report.** A new field (its images not in the cache) reports first from 3 images per pass, then downloads the
  rest and redoes the report with all 8 by itself (it waits while a card or the film is open). Measured from inside the app:
  first report 40 s (search 11 s), full report 85 s; before, 79-90 s for the first report.
- **Opened before = fast for good.** Archive and catalogue answers older than their time are served at once and asked for
  again in the background (they waited 6-16 s for IRSA after a day). Cache limit 2000 → 8000 MB.
- **Start screen prewarmed.** `#prewarm=start` runs the 18 test fields and 5 landmarks of the whole-sky map, the NASA targets
  and the examples (with Gaia and CatWISE); then `node tools/pin-cache.js --newer-than <minutes>` writes `cache/pinned.json`,
  and prune never removes those files. A cached field opens with its report in about 8-10 s.

## v0.54.0: from here to there, in every pass (7 Nov 2026)

**🎬 Animate** (now also in Overlays) plays the passes as a film. Every star that Gaia, WISE or ARCNAVE's searches say
moves 1″ or more gets a **circle in every pass, numbered P1, P2…**, and the card says where it went: "from RA …, Dec …
(pass 1, Aug 2025) to RA …, Dec … (pass 3, Aug 2026): 13.0″ toward the north". A solid track is measured on the SPHEREx
images; a dashed one is the catalogue's prediction (too faint or too small to measure). WISE 0855 is now measured in
the film: 8.82 ± 1.10″/yr west, and CatWISE's 7.94 agrees. Most fields have no star this fast (a typical star moves
0.1-0.3″/yr); there the film shows the fastest Gaia stars as predicted, and says SPHEREx cannot measure them.

## v0.53.0: WISE overlay, CatWISE2020 (7 Nov 2026)

A **WISE** button next to Gaia shows NASA WISE's CatWISE2020 sources at the date of the pass on screen. Gaia cannot see
cold brown dwarfs; WISE can.
- **Orange arrows:** movers of 1″/yr or more. WISE 0855 shows up at 7.94″/yr west, right in its NASA target ring.
- **Pink diamonds:** very red sources (W1−W2 ≥ 0.8), cool brown dwarfs or quasars.
- **Tap one** for its colour, its motion and how far that is in SPHEREx pixels, Measure its motion, Track and Its
  spectrum.

The overlay merges CatWISE's repeated entries for one object, and leaves out the fake fast movers it makes in a bright
star's halo (27 around Epsilon Indi A). The mover searches (🔭 ◐ 🎯) now also name finds that Gaia does not have but
CatWISE does: "Known mover (CatWISE2020 agrees)". Details: `CHANGELOG-redesign.md`.

## v0.52.0: faster loading, same numbers (7 Nov 2026)

Every result is bit-identical; the page just does the same work faster and no longer freezes.
- **Median stacks** are 8-15x faster, and **image preparation** in the workers is 2.9x faster (1.2 s → 0.4 s per
  image: the SIP distortion polynomial no longer recomputes its powers).
- **The Changes maps** are built in a worker, so the report appears without the 5 s freeze.
- **Cached Barnard field:** report in 18-23 s (was 28-55 s); main thread blocked 12-13 s (was 21-43 s); longest freeze
  2 s (was 5 s).
- **A new field** (48-61 s) is now limited by the network: NASA's archive search, ~180 MB of S3 image rows at this
  connection's ~5 MB/s, and SkyBoT. A public host near AWS with `SKYSHIFT_S3=1` sends ~0.5 MB per image instead.

Checks: smoke.js 29/29, guide 30/30 on desktop and phone. Details: `CHANGELOG-redesign.md`.

## v0.51.0: spotlight on the movers (6 Nov 2026)

In the 🎬 film the rest of the sky dims, and soft spotlights follow each moving star along its track. The track is a
glowing line with an arrowhead for the direction of motion, and a pulsing ring with the star's name. "🔦 Spotlight on /
off" is in the film card.

## v0.50.0: animate the movers (6 Nov 2026)

"🎬 Animate the movers" (Changes → "Watch it move") works on any field. It collects the moving stars that the searches
measured (running 🔍 and 🔭 first if needed) and plays them through every pass:
- **On the sky:** each pass's image in turn, every mover's measured track growing with a gliding marker.
- **In the card:** a true-scale cut-out per mover, Play/Pause, ◀ ▶ and Stop.

A field with no mover plays its passes with nothing marked. Live results:
- **Barnard's Star:** shown moving north.
- **Epsilon Indi field:** Epsilon Indi B and A shown moving south-east.

## v0.49.0: trial-motion scan for faint stars (6 Nov 2026)

"🎯 Motion scan: faint stars" (Changes → "Watch it move") tries 625 motions within ±12″/yr for every source of the deep
stack (the KBMOD method). Each trial adds up all passes along that motion, so faint sources gain from every image. The
star shape is placed at 1/8-pixel positions, so motions under a pixel show. A source counts as moving only when it beats
"not moving" by 5σ (calibrated per brightness) and passes these checks:
- **vacancy:** it is not hopping between two stars;
- **brightness:** it stays steady between passes;
- **Gaia:** Gaia does not measure it as fixed;
- **speed:** no faster than any known star;
- **second opinion:** the frame-by-frame measurement agrees.

Each mover has a small likelihood map of its motion. Live results:
- **Epsilon Indi B:** 4.27 ± 0.20″/yr, known (the target).
- **Control fields:** no false movers.
- **WISE 0855:** detected, but not labelled (see the changelog).

## v0.48.0: slow movers in difference images (6 Nov 2026)

"◐ Slow movers: difference images" (Changes → "Watch it move") subtracts each pass-1 image from the same-colour image of
every later pass, after matching the brightness and blur with a small kernel. A star that moved less than a pixel leaves
a light-and-dark pair. Each source is fitted for its shift and its brightness change, using the pass-1 image's star
shape. Errors are calibrated on stars of similar brightness. A source counts only if the frame-by-frame measurement
agrees; otherwise it is a "likely artefact". Live results:
- **Epsilon Indi B:** 4.43 ± 0.19″/yr, known (the target).
- **Control fields:** no false movers; two possible flags were caught as artefacts.

## v0.47.0: deep search, every image (6 Nov 2026)

"🔭 Deep search: every image" (Changes → "Watch it move") stacks every image of every pass to find sources fainter than
one image shows (down to 5σ). It measures each source frame by frame, lined up on Gaia, and flags those that move on a
straight line above a 5σ bar that each field calibrates on its own still stars. Each flagged source is checked against
Gaia DR3, or the field's NASA target. Live results:
- **Epsilon Indi B:** 4.22 ± 0.18″/yr, known (the target).
- **Barnard's Star:** 13.2 ± 1.4″/yr, known.
- **Example and WISE 0855 fields:** no false flags.

## v0.46.0: frame-by-frame track (6 Nov 2026)

A moving star's track is now measured in every image of every pass:
- each image is lined up on Gaia DR3 by itself;
- the star is fitted in it (pixel-integrated Gaussian; for a saturated star, the wings only);
- one straight line is fitted through the passes, with Gaia's parallax taken off.

The card's "Frame by frame" box gives the motion with its error and a straight-line (χ²) test, and labels it "Motion
measured" only at 5σ. Live results:
- **Barnard's Star:** 12.7 ± 1.4″/yr north (catalogue 10.4).
- **Epsilon Indi B:** 4.22 ± 0.18″/yr south-east (catalogue 4.68).
- **22 still control stars:** all "No significant motion".

Method and sources: `reports/Moving star tracking methods.md`.

## v0.45.0: automatic motion search (5 Nov 2026)

"🔍 Find moving stars" (Changes → "Watch it move") measures up to 120 bright stars in every pass and flags those that
moved at least 2″ and 5x the field's scatter, the same way in every pass. Each one is checked against Gaia DR3 and
labelled "known mover", "unconfirmed candidate" or "Gaia says it hardly moves" (never a discovery). Gaia movers it
missed are listed too. Live results: Barnard's Star 9.4″ north, known; Epsilon Indi A known; Epsilon Indi B a
candidate (too faint for Gaia G < 18); no false flags in the example and WISE 0855 fields. Click an arrow for the track.

## v0.44.0: the measured track across passes (5 Nov 2026)

"▶ Track its motion across passes" measures a moving star's position in every pass and says where it went. For example:
"Barnard's Star moved from RA 269.44635°, Dec +4.76719° (Aug 2025) to RA 269.44583°, Dec +4.76976° (Aug 2026): 9.4″
toward the north in 361 days (catalogue 10.3″)." On the sky it draws numbered dots per pass and an arrow; WISE 0855 is
too faint for this method. v0.43.1 also made SkyBoT answer again on slow networks (server.js timings).

## v0.43.0: Aurora teal theme, and the three weak points (5 Nov 2026)

- **New colour theme, Aurora teal:**
  - teal for what you press, cyan for focus and links;
  - a white → teal → cyan headline;
  - "? unconfirmed" in violet.
- **Chart passes:** a shape per pass (● ■ ▲) in spectra and their legends; comparison stars in light curves are hollow
  rings.
- **The guided tour's Changes step** now fits on desktop: 30 of 30 steps fully on screen on desktop and phone.
- **The tool page** no longer downloads the landing page's 358 kB GIF. Lighthouse mobile performance is 17-25 (17
  before). The rest of its cost is the science pipeline and the WebGL sky, which are not changed.

Checks: smoke.js 29/29. Details: `CHANGELOG-redesign.md`.

## v0.42.0: known asteroids, where they went (5 Nov 2026)

- **The Changes "Known asteroid" card says why it shows 0:** none crossed the field, all too faint for one SPHEREx image
  (V 19), bright but not detected, or the services did not answer. SkyBoT and the MPC were checked live and work.
- **Tap it (or "All known paths") for a line per known object per pass.** Each line runs from the pass's first image
  to its last: solid if SPHEREx caught it, dashed if not detected, faint if too faint.
- Lines are never joined across passes.

Details: `CHANGELOG-redesign.md`.

## v0.41.0: watch it move (5 Nov 2026)

- **Replay its track:** a known asteroid, frame by frame, within the one pass where SPHEREx caught it:
  - its catalogue position in every image of that pass;
  - "seen ✓" where the Analyst found it;
  - "not here" frames from the visits around it.
- **Its motion across passes:** Barnard's Star, Epsilon Indi B, WISE 0855 and fast Gaia stars, pass by pass, at their
  proper-motion positions. For example, Barnard's Star moves 10.3″ in 361 days.
- **Where:** Changes shows both in a new "Watch it move" row.
- **Not built:**
  - no asteroid across passes (it leaves the field within days);
  - no tracks for unknown dots (v0.32).

Details: `CHANGELOG-redesign.md`.

## v0.40.0: UI upgrade, "a mission-control observatory for everyone" (2-5 Nov 2026)

A visual and UX upgrade only: features, URL hashes, data fetching, caching and science are unchanged. The only app.js
change is markup: each chart point carries its own numbers, for a hover/tap readout.

- One infrared-accent design system.
- A landing that shows real SPHEREx frames and NASA's five targets as cards with real thumbnails.
- A play bar on the image, and controls in task order (Where → Compare → When → Colour).
- Loading steps with a skeleton report.
- Readable charts with a readout.
- A one-row phone header.

Checks: smoke.js 29/29, guidecheck phone 30/30, desktop 30/30 tools on screen. Lighthouse mobile landing performance
49 → 75. The audit, tokens, before/after screenshots and all results are in `redesign-docs/UI-UPGRADE.md`; every step
is in `CHANGELOG-redesign.md`.

## v0.39.1: regression run + phone guide fix (2 Nov 2026)

- Full smoke test 29 of 29 features, zero page errors; guide check 30 of 30 on desktop 1440x830. On a phone (390x844) the guide's Changes step needed more room than a half sheet: the guide now opens the sheet fully for such a step and puts it back to half on the next step.
- Copy Python stops with a clear message when no SPHEREx image covers the spot.

## v0.39.0: check it, report it, take it to Python (30 Oct 2026)

- **Check it, then tell someone.** Every unexplained or brightened spot in Changes now has links to look at the same position in SIMBAD, the Legacy Surveys viewer and the MPC asteroid checker, and two buttons: **Send this candidate** (opens the person's own e-mail app with a filled-in report and no address; ARCNAVE sends nothing) and **Copy report** (to paste on a forum such as the Backyard Worlds Talk board). The report always says "unconfirmed, not a discovery claim".
- **Copy Python.** Share → Copy Python gives Astropy + astroquery code for the current spot: ARCNAVE's own IRSA TAP query, then the first and last images in time cut out with IRSA's cutout service and shown side by side. Falls back to a .py download if the clipboard is blocked.
- Already there (v0.34): `?embed=1` view and Copy embed code; new SPHEREx releases appear without code changes (the archive is asked live, list kept one day, release name shown).

## v0.38.0: fast first look, phone panel, five green targets (30 Oct 2026)
- The five NASA targets and the two examples ship in `demo-cache/` (prewarm: `#prewarm=targets`, then
  `node tools/export-demo-cache.js cache --newer-than 180`). Checked: every image each target card asks for is in it
  (24/24/43/24/24); the cards open in 9-19 s on a local run, from saved images.
- Speed: known-mover lookups use at most 3 of the browser's 6 connections (image requests had waited ~11 s behind them);
  a public host no longer receives 7 MB uploads; on a host with `SKYSHIFT_S3=1` the server reads NASA's S3 copy and sends
  ~0.5 MB per image (time it after deploy; off locally). S3 416 answers are not retried. Aladin's usage ping is off.
- Phone: the bottom sheet has three heights (peek / half / full) with a grab handle; dragging the sky lowers it.
  On a 390x844 screen the sky visible went from ~150 px to 609 px (peek) / 319 px (half).
- RW Aurigae: faded 0.74 mag Sep 2025 → Sep 2026 in 6 of 6 colours (3.9-4.8 µm, 49 images, ~10σ): now "✓ Change seen".
  R Draconis: the same pulse in 3 of 3 colours (0.75-0.85 µm, 25 images). 0.9 and 0.95 µm not used (glow too bright).
- `tools/astropy_check.py`: WCS (with SIP) = astropy.wcs to 0.000″ on 2 real files; proper motion vs apply_space_motion
  within 0.064″.
- Guided tour: new steps for NASA's 5 targets, Flags, Gaia + motion check, Spectrum, Light curve, Deep view (4 languages).
- `public/dev/smoke.js` (local): 26 features clicked one by one; 26 work, no page errors (30 Oct 2026).

## v0.37.1: Phase 5b, deep view per detector

"Sum data per detector array (6 arrays) for better signal-to-noise": **Deep view** (next to Spectrum) takes the pass on
screen, up to 6 images of each of the 6 detectors (spread over that detector's colours, at least 80 % of the field
covered), lines them up on the stars, divides each by its own noise and averages them: 6 deep images plus a false-colour
picture (blue D1-D2, green D3-D4, red D5-D6, each channel stretched to its own 99.7th percentile; a blanked saturated
centre is drawn bright, not as a hole). The noise gain is measured on differences between images (one image: (1 - 2)/√2;
the stack: (mean of odd - mean of even)/2), so the stars themselves do not count as noise.

Live, Barnard's Star field, pass 1 (Aug 2025), 36 images: 81 s the first time, 19-21 s once cached. Noise gain per
detector 1.7, 2.6, 2.6, 2.3, 2.2, 2.2 against an ideal 2.45 (70-107 %). A first version measured the spread of the stack
itself and got 1.0-1.7: in this crowded field that spread is mostly faint stars, not noise.

## v0.37.0: Phase 5a, light curves, and a correction to two target cards

- **Light curve** button on the spectrum card (at the star's clearest colour) and on the R Draconis and RW Aurigae cards:
  every image of every pass that puts the star at that colour (predicted from the archive footprint and the detector's
  wavelength map, then measured exactly), up to 36 spread over time, plus the three brightest slow Gaia stars within 15′
  measured in the same images as comparisons. Chart of brightness change (mag) against date, verdict compared with the
  comparison stars' scatter, CSV.
- **Saturated stars**: when the centre is blanked or overflowing in most images, every star is measured from its outer
  glow (ring 2.2 to 4.2 pixels, 13 to 26″; TRANSIENT and SUR_ERROR flags allowed there, finite values only). Check of the
  method: a steady G 9.4 star 8′ from R Draconis, measured this way in 30 images, scattered 0.10 mag (its own noise
  0.015 mag), so the method's limit is about 0.1 mag. Faint comparison stars (G 12.5-13.6) were useless in this mode
  (0.3 to 1.5 mag of pure noise), so the brightest slow stars are now used.
- **Correction (found while building this):** R Draconis is saturated in EVERY image even at 0.79-0.91 µm (1 to 6 central
  pixels blanked by the pipeline, OVERFLOW flags); v0.33.1 said it was not, and its 0.33-0.35 mag came from field images
  in which those centres had been filled. RW Aurigae is saturated in 104 of 109 images of a pass; v0.33's +0.19 mag
  (3.8-4.4 µm) was measured on saturated centres too. Both numbers are withdrawn and the cards now give the outer-glow
  results:

| Star | Colour, images | Result | Comparison stars (same method) | Card |
|---|---|---|---|---|
| R Draconis | 0.85 µm, 10 of 36 usable | brightened 0.41 mag 5 Sep → 25 Oct 2025, 0.91 mag by 14 Nov; 17 Jul 2025 1.2 mag brighter than 5 Sep; 2026 too bright even in the glow | 0.13, 0.12 (and 0.78 for a fainter one; the verdict uses the median) | ✓ Change seen |
| RW Aurigae | 4.0 µm, 7 of 9 | Sep 2025 ~0.4 mag brighter than average, Mar 2026 average, Sep 2026 0.3-0.6 fainter: 1.1 mag range, scatter 0.39 | 0.04, 0.18, 0.13 | ~ Change likely (about 3× the comparison scatter) |

  RW Aurigae and R Draconis at 0.8, 1.2 and 2.2 µm: saturated in every image (core and glow), nothing measured.
  Fields away from the ecliptic poles get only 1 to 3 images per colour per pass, so their "light curves" are a few points.

## v0.36.0: Phase 4, Gaia overlay and a motion check for any star

From the official challenge's "Potential considerations" ("overlay data from other telescopes, Gaia"):
- **Gaia** button (next to Flags): the field's ESA Gaia DR3 stars brighter than G 18 (new endpoint `/api/gaia`: NASA/IPAC
  IRSA TAP `gaia_dr3_source`, VizieR `I/355/gaiadr3` fallback, cached 30 days), drawn where Gaia's proper motion puts
  them on the date of the pass on screen (Gaia positions are for J2016.0). Stars moving 0.2″/yr or more get an arrow =
  20 years of motion. A legend line says how many stars and fast movers there are.
- Tap a Gaia star: G magnitude, distance from the parallax, motion per year and between the first and last pass (in
  SPHEREx pixels), "Its spectrum", and, when it should move 1.5″ or more, **Measure its motion**: the Barnard's Star
  method (last pass slid over the first after lining up on the stars) plus up to 5 slow Gaia stars (under 0.02″/yr) as
  controls. Slower stars get "too slow to see in SPHEREx".

Live results (2026-10-29, user's PC, real SPHEREx images, 0.5° fields):

| Star | Gaia DR3 motion | Measured in SPHEREx | Controls |
|---|---|---|---|
| Wolf 359 (Gaia DR3 3864972938605115520, 7.9 ly, G 11.0), 3.85 µm | 5.0″ in 390 days | 4.1″ (vector difference 1.1″) | 3 stars: 0.0, 0.0, 0.0″ |
| Kapteyn's Star (Gaia DR3 4810594479418041856, 12.8 ly, G 8.1), 1.7 µm | 8.6″ in 364 days | 9.1″ (vector difference 0.5″); an earlier run 8.5″ (difference 2.7″) | 5 stars: 0.6, 2.5, 0.0, 0.9, 0.6″ |

The scatter between runs and in the controls (up to 2.5″, under half a pixel) is the honest limit of this simple method.

## v0.35.2: smooth flight between fields

Asked by the team: a new RA/Dec used to jump there at once. Now, from one field to a far one, the camera pulls back to the
whole sky, turns, and dives in (about 7 s, while the archive search already runs, so no extra waiting). A spot already on
screen is a short pan; a newer flight cancels an older one; "reduce motion" still jumps. The Fly to box (with auto-run off)
flies the same way. Checked in Chromium with the real Aladin Lite: field of view 1.2° → 360° → 1.2°, ending in the normal
north-up view.

## v0.35.1: Phase 3b, QR3 images from S3 (faster new fields)

QR3 files store FLAGS RICE-compressed, so `lib/s3cut.js` refused them ("FLAGS size differs from IMAGE") and every QR3
image of a field went through IRSA's cutout service (25-45 s each). The RICE decoder (now in `lib/s3cut.js`, shared with
`lib/spot.js`) reads the compressed rows through the row index and writes a plain 32-bit FLAGS layer, the same format
IRSA's cutouts have (checked on cached QR3 cutouts from IRSA). Test: `test/s3cut_rice.test.js` (a shipped cutout re-written
by astropy with RICE FLAGS: 13689 flag values identical, same processed image and masks).

Live, user's PC, fresh fields with 16 QR2 + 8 QR3 images, 24 images, Browser pane hidden:
- before: 271.003 +6.012: 142.5 s (16 from S3, 8 via IRSA)
- after: 271.497 +6.488: 92.9 s (24 of 24 from S3); QR3 frames masked as before (e.g. 438 glitch, 1148 area pixels)
- a field with QR2 only (150.512 +25.317) took 101.5 s before the fix: the fix helps where QR3 exists.

## v0.35.0: Phase 3, spectra on the fly

From the official challenge's "Potential considerations" ("creative use of the 102 bands ... spectra on the fly"):
- **Spectrum** button (next to Flags), then tap a star; NASA test-target cards have an **Its spectrum** button.
  SPHEREx's filters change colour across each detector, so the star is seen in a different colour in every image of a
  pass: one pass (about 120 images) gives about 100 colours from 0.75 to 5 µm.
- Fast one-star reads (`lib/spot.js`): only the IMAGE header and ~15 rows around the star (plus 5 FLAGS rows) are read
  from NASA's S3 copy; files of one data release and detector share their layout, so after the first file it is 3 range
  requests per image. Measured live on the user's PC: one pass of 122 images took 150 s with the field-cutout method,
  40 to 54 s now (117 to 137 images).
- QR3 files store FLAGS tile-compressed (RICE_1, one tile per row). `riceDecode()` follows cfitsio's algorithm and is
  tested against astropy (`test/spot.test.js`, exact on 40 rows incl. high-entropy, constant and flag-like rows).
  (v0.35.1: the field cutouts use the same decoder.)
- Photometry: 2.5-pixel aperture minus the median sky in a 4 to 7 pixel ring; a colour is left out when a flagged pixel
  sits on the star, and the card says why (saturated, glare/ghost, cosmic ray, faulty pixel, afterglow, data lost).
- Check against other surveys: 2MASS J/H/Ks and AllWISE W1/W2 from IRSA TAP (VizieR fallback), new endpoint
  `/api/photcat`, cached 30 days. Neighbours within 9″ are added (SPHEREx sees them as one dot).
- Compare passes: same colours in two passes, median ratio (for variable stars). CSV download of the numbers.

Live results (2026-10-29, user's PC):

| Star | Images used | Time | Result |
|---|---|---|---|
| 2MASS star at 269.42299 +4.75124 (K 11.9, neighbour K 12.8 at 5″) | 102 of 117 (pass 3) | 54 s | SPHEREx ÷ catalogue: J 0.90, H 1.00, K 0.98, W1 0.88, W2 0.87; pass 3 ÷ pass 1 = 0.98 (73 colours) |
| Epsilon Indi B (brown dwarfs) | 100 of 137 (pass 2) | 40 s | brightest near 4.1 µm (58 mJy), deep dips near 1.4 µm and 2.3 to 3.6 µm (water, methane); J 0.93, H 0.94, K 1.22, W1 0.75, W2 0.73 (broad WISE bands vs a very bumpy spectrum) |
| RW Aurigae | 2 of 109 | 38 s | saturated in 104 images: "too bright for SPHEREx" |

Before the fix above, the first live check gave 1.40× for the 2MASS star: its 5″ neighbour (K 12.8) is inside the
aperture; the pair predicts 1.44×. That is why neighbours are now added to the catalogue values.

## v0.34.0: Phase 2 quick wins (embed, contamination flags, data release)

From the official challenge's "Potential considerations":
- **Embed** ("include coordinates in the URL ... embed it in other websites"): Share now offers **Copy embed code**, an
  `<iframe>` of `?embed=1#ra=..&dec=..&load=1` (also `?embed=1#ct=barnard` for a NASA test target). Embed mode hides the
  header and panels and plays the spot's SPHEREx images as a flip-book (Blink, all images), with a link to the full tool.
- **Contamination flags** ("display metadata, like contamination flags"): a **Flags** button (Time machine and Blink) draws
  the pixels the SPHEREx pipeline flagged in the image on screen: orange = flagged bad (saturation, glare, ghosts, cosmic
  rays, hot pixels; left out or repaired), violet = "outlier" only (a cosmic ray, or a moving object). The image line then
  gives that image's counts (e.g. demo field image: 1253 saturated/glare/ghost pixels left out, 1815 bad single pixels, 1453
  of them outlier-only). Only two groups are drawn because the per-bit type is not kept once the masks are on the field grid.
- **Data releases** ("easy to update with the latest data releases"): the Archivist names the release from the file path
  (QR2) and the newest image date at the spot; the image line names the release of the image on screen; About explains that
  the archive is queried live, so new releases appear with no code change.
- Checked: flags overlay and counts on the demo field; share toast and embed code; embed at 640x420 and 390x300 (header and
  panels hidden, flip-book on, link back keeps the view); multi, changes, examples, card and tour browser tests pass.

## v0.33.0: the five NASA challenge test targets (Phase 1)

The official challenge says: "Test your tool on Barnard's Star, Epsilon Indi B, WISE 0855, and variable stars RW Aurigae
and R Draconis." Each now opens from a button (intro / Examples, "NASA's five test targets"), from a link (`#ct=barnard`,
`#ct=epsindb`, `#ct=wise0855`, `#ct=rwaur`, `#ct=rdra`) or by typing its name in Fly to, and ends on a result card.
Measured on the real SPHEREx images (IRSA) on 2026-10-28, through the PC's browser, 8 colour-matched images per pass:

| Target | Passes used | Result |
|---|---|---|
| Barnard's Star | Aug 2025, Mar 2026, Aug 2026 (3.45 µm) | **Motion seen**: 9.7″ in a year, predicted 10.2″ (Gaia DR3 proper motion via Wikipedia); half-way 6.1″ vs 5.9″. Five other bright stars: 0-0.6″. |
| Epsilon Indi B | Apr 2025, Sep 2025, Apr 2026 (4.6 µm) | **Motion seen**: 4.4″, predicted 4.7″; half-way 1.7″ vs 2.0″. Epsilon Indi A (6.5′ away) 5.3″ vs 4.7″; four other bright stars 0-0.9″. |
| WISE 0855 | May 2025 (3), Nov 2025 (19), Apr 2026 (21) images at 4.4-5 µm, 0.25° field | **Detected (faint), v0.33.2.** With 8 images per pass: 1.5σ, 2.4σ, 3.1σ (not enough). Two-source fit on all 43 images: a static background object (position measured on 24 images at 1.2 µm, where WISE 0855 is invisible; 4-11″ from the track, scatter 0.6″) plus a dot on WISE 0855's track (WISE 2010 position + proper motion, Luhman 2014). Moving dot: formal S/N 24.8, calibrated 11.8σ against 261 random spots (0.8 % reach it). Proper-motion scan (2″/yr steps): best (−8, +2)″/yr vs known (−8.1, +0.7); zero motion 22.2, reversed 17.2 (formal S/N); best position offset 0. At 1.2 µm the moving dot is −2.8σ (absent) while the background object is 144σ. Flux 0.50 mJy = AB 17.15 vs WISE W2 13.89 ≈ AB 17.2. (v0.33.1 had wrongly called the signal a background object: the plain aperture mixed the two.) |
| RW Aurigae | Sep 2025, Mar 2026, Sep 2026 (3.8-4.4 µm) | **Change seen**: 0.19 mag brighter Sep 2026 vs Sep 2025 (median of 8 colour-matched images, single images −1.2 to +0.5); 8 comparison stars ≤0.05 mag. Mar 2026 pass has flagged pixels at its centre. |
| R Draconis | 3 passes of 182 days; 0.8-1.1 µm (v0.33.1) | **Change seen**: saturated at 2.6-3.7 µm, but not at 0.8-0.9 µm in autumn 2025: brightened 0.35 mag (0.85 µm, 5 Sep → 25 Oct 2025) and 0.33 mag (0.81 µm, 6 Sep → 5 Nov 2025); 10 comparison stars ≤0.11 mag (one 0.16). By Aug 2026 saturated even at 0.85-1.09 µm in all 7 images: brighter still. The 1.09 µm pair is too noisy (comparison stars up to 0.5 mag) and is not used. |

How: motion = the target's 15x15-pixel patch in the last pass slid over the first pass (0.1-pixel steps, brightness scaled)
after all images are lined up on the stars; the same measurement on other bright stars is the control. The card repeats the
motion measurement live on the images on screen. Brightness = the star's light divided by the median of 25 comparison stars,
image by image, compared only between images of the same colour (slots); images with flagged pixels in the aperture are left
out.

Also fixed: near the ecliptic poles SPHEREx sees a field all year with no 60-day gap, so R Draconis (2454 images) came out as
one epoch. A run longer than 200 days is now cut into 182-day passes.

## v0.32.0: track arrow for known asteroids; unknown dots shown, never linked

**Feasibility check first (2026-10-27, demo field RA 189.957, Dec -4.182, the busiest asteroid field we use).** Could ARCNAVE
link unknown movers into a track? Each epoch's 8 images come from only 3 or 4 visits (several images per visit, minutes
apart; visits 0.5 to 6 days apart). Known asteroids move about 14″ per hour (median, SkyBoT), so most leave the 0.5° field
between visits. Of 45 unmatched single-visit sources (5σ), a brute-force search found **0** sets of 3 on one straight line at
constant speed. Allowing 2 images (speed up to 60″/h) gave **206** possible links: two dots can always be joined, so a
2-image link is a guess. Repeated on three more live fields on 2026-10-28 (RA 237.8 -20.2, 122.2 +20.2, 56.75 +24.1;
8 epochs of 8 images in total): 0, 2 and 0 straight-line triplets. The 2 on 122.2 +20.2 (epoch 1 of 2) do not keep one brightness (18, 6, 34 sigma and 180, 29, 5 sigma), with 37 candidate dots and about 1200
possible pairs there, so they look like chance alignments, not movers. Decision: no linking of unknown movers. Future work: the full 3.5° detector and all ~56 images of a
pass would give 3-image tracklets a chance, at about 10x the download.

What was built instead:
- **Track arrow (Time machine, Blink):** a confirmed known asteroid gets a green arrow from where SPHEREx saw it, along its
  motion from the orbit catalogue (SkyBoT dRA, dDec), one tick per hour, labelled "18″ per hour · next 7 h". Its card says
  the speed in arcsec and SPHEREx pixels per hour and the direction (on the sky east is to the left).
- **"Seen once, not linked" (?):** sources seen at one visit only, matching no known object, with a star-like shape **and
  also in the exposure minutes later in the same visit (not a cosmic ray)**, are marked with a dashed "?" ring. Found by
  the live check (RA 122.2 +20.2, 2 epochs): 72 single-exposure sources, some of hundreds of sigma, i.e. bright stars
  missing from the other visits; drawing them would have looked like 72 mysterious objects, so single-exposure sources are
  only counted in the report, as before. Demo field: 9 "?" dots remain. Their card shows this image and another visit where nothing is there, explains why no path
  is drawn, and links to the Aladin sky atlas to check the spot in other surveys.
- **Live check on 3 other fields (RA 56.75 +24.1; 122.2 +20.2; 237.8 -20.2), through the PC's browser pane**, found two
  problems, both fixed: the "?" flood above, and an asteroid's arrow also showing in images where it was not seen (now drawn
  only in the image of the sighting). On 237.8 -20.2 two known asteroids were confirmed (254 Augusta 55″/h, 20438
  Julievermersch 42″/h) and got arrows. On 56.75 +24.1 and 122.2 +20.2 none was caught, so no arrow (expected).
- Checked: planetx unit tests, px, real, multi, changes and card browser tests pass; screenshots at 1400 px and 390 px.

## v0.31: brightness-change test (#brighttest) and a fix it found

Why: the Changes view reports a star that got brighter as a "possible variable star" (it must gain at least 25 % of its
light), but how well that works had never been measured.

How (`brightRun`, `brightStars`, `brightTrial` in `public/app.js`, local runs only; `#brighttest`, `&test=1`, `&only=`,
`&from=`): after the agents run, up to 40 isolated real stars per field (picked across brightness, 20 sigma and up) are made
brighter by a known factor in every image of the last pass (their own light, pixel by pixel, times gain - 1, added on top),
and the Changes view's own code (`changeMaps`, 8 sigma, exactly as the app calls it) looks again. Caught = a change reported
on the star in an image of that pass, not judged an artefact. Gain 1 = nothing added: every report is a false alarm.

**Fix found on the demo field:** with the 25 % rule on the 3x3 box only, 6 of 40 UNCHANGED stars were reported brighter,
nearly all of the brightest (a bright star's image changes shape a little from image to image, which moves light between the
3x3 box and its wings). The rule is now also checked on a 5x5 box (`changeMaps` option `relBox: 2`): 1 of 40, and real
brightening is caught as before (gain 1.5: 30 of 40 both ways).

**18 fields (2026-10-26, user's PC, all measured, 720 stars):**

| Star made | all fields | away from Milky Way (14) | Milky Way plane (4) |
|---|---|---|---|
| unchanged | 8 % reported (false alarm) | 4 % | 19 % |
| +10 % (rule: should not count) | 17 % | 13 % | 28 % |
| +25 % (the rule's edge) | 53 % | 51 % | 63 % |
| +50 % | 82 % | 81 % | 88 % |
| x2 | 89 % | 88 % | 93 % |
| x3 | 91 % | 90 % | 94 % |

- By brightness (all but L300B-40): stars of 20-50 sigma caught 79 % at +50 %, 200 sigma and up 95 %; false alarms 6 to 9 %.
- Fields with only 2 passes (L120B+00, L120B+40) catch +25 % rarely (3 of 40): the reference is then the mean of the two
  passes, so a change looks half as big.
- Not understood yet: L300B-40 (4 passes, only 2 colour-matched images per pass) caught 5 of 40 even at x3.
- Shown in the Tested panel (test 3) from `public/brighttest.json` (`tools/build-brighttest.js`). `test/brighttest.e2e.js`.
- Not tested: stars that get fainter.

## v0.30.0: motion-following stack in Hide Planet X (shift-and-stack)

Why: a planet near 300 AU moves tens of pixels within one pass (its images are spread over days to weeks), so the plain
median of the pass removes it like a cosmic ray. That was the scorecard's main miss (300 AU found in 11 of 18 fields).

How (`lib/planetx.js`: `shiftValues`, `pathOffsets`, `shiftNoise`, `shiftHit`, `shiftScan`):
- Every image of a pass minus the image of the other pass taken in the same colour (stars cancel image by image) is shifted
  back, in whole pixels, along the path a body at that distance would follow (Earth's motion, `track`), and the shifted
  differences are median-stacked. The planet adds up at one spot.
- Counted as found with the plain detector's rules: 5 sigma in both passes, or 7 sigma in one; not where the same stack
  without the planet is already above 5 sigma; and not next to a star at least as bright (5x brighter within 5 px), the
  plain detector's "explained" rule.
- Whole-pixel shifts: interpolated shifts smooth the noise by an amount that depends on the fraction, so one noise level
  per field would not fit every spot.
- Own orbital motion is unknown in a real search and is left out of the path, so a pass counts only when that motion during
  the pass stays under one pixel (at 300 AU about 250"/yr: fine for a 6-day pass, not for a 32-day one; at 50 AU never).
- Found = plain or motion-following. The map keeps both (`limits`, `limitsPlain`); the summary under the map names both.
- **Real-data check:** `shiftScan` runs the motion-following stack over the whole real field with no fake planet, for every
  distance. Before the star rule, the demo field gave 4 to 17 peaks of 7 sigma per pass and distance, every one next to a
  star; with the rule, 0. The scorecard now records this scan per field (`shiftScan`).
- Demo field 189.957 -4.182 (pair 1-2, 16 spots): 150 and 200 AU AB 16.0 -> 16.5; 700 and 1000 AU 16.5 -> 17.0; 100, 300,
  500 AU unchanged (100 AU: own orbit too fast for its 2-6 day passes). Scan: 0 unexplained peaks at all 7 distances.
- **Not done:** the agents do not run the motion-following stack on real fields (only this test does), and the app says so.
- Tests: `test/planetx.test.js` (300 AU over a 7.5-day pass: plain misses, motion-following finds; 30 AU: not used; no fake
  planet: 0 hits at any distance; scan of a static field: 0), `test/px.e2e.js`.
- **18-field scorecard run again (2026-10-26, on the user's PC, all 18 measured, no retries).** The plain stacks give the
  same limits as the v0.12 run on the 16 fields whose data did not change (L300B+40 and L300B-40 now have 4 passes).
  Same run, plain -> with the motion-following stack:

  | | plain | + motion-following |
  |---|---|---|
  | 300 AU found (50 %) | 9 of 18 fields (median AB 16.5) | **12 of 18** (median AB 17.0) |
  | 1000 AU found | 17 of 18 (AB 14.0 to 17.0, median 17.0) | **18 of 18** (AB 14.5 to 17.5, median 17.0) |

  At 1000 AU the limit is 0.5 mag or more fainter in 13 of 18 fields (L300B+00: 14.0 -> 17.0).
- **The cost (shiftScan, no fake planet, 7 distances):** 7-sigma peaks in ONE pass that no star explains in 15 of 18
  fields (0 on L060B+00, L120B+00, L180B+00; 3 on L120B+40; up to 592 summed over distances on L300B+40 in the Milky Way);
  peaks seen in BOTH passes one parallax jump apart: **0 in all 18 fields.** A real search with this method must therefore
  insist on both passes; the test still counts a 7-sigma single pass (as the plain detector does), so its numbers are what
  the method can reach, not what a careful real search would report. The agents do not run it on real fields.
- Old v0.12 files are kept outside the project folder (scratchpad backup).

## v0.29.2: "What it can and cannot see"

The last section of the Tested drawer is now four short entries: what ARCNAVE can do, what it cannot yet (brown dwarfs:
most drift under 1″ a year, the fastest known a few, less than one 6.2″ pixel between passes six months apart; unknown
movers are not linked between passes; 300 AU planets often missed; crowded Milky Way fields), what is not tested, and what
is never claimed. Text only.

## v0.29.1: "Tested" panel and the Milky Way warning

- New header button **Tested** (next to Learn) opens its own drawer with both tests on the same 18 fields: 1. can it find
  a faint, slow planet (the scorecard, moved here from Learn), 2. how often does it cry wolf (the false-alarm test, from
  `public/nulltest.json`, built by `tools/build-nulltest.js` from `scorecard/null_*.json`), what each label means, and
  what is not tested yet. Learn keeps a short paragraph with an "Open the tests" button. The tour's scorecard chapter
  opens Tested.
- **Milky Way warning:** when a field is within 5 deg of the galactic plane, the Analyst's line starts with "Milky Way
  plane: changes here are mostly noise" and the report shows a warning box with a link to the test. 5 deg: the 4 plane
  fields of the test lie within 1 deg; the next closest are at 20 deg and behave like the rest.
- Only the page changed (no server restart).

## v0.29.0: false-alarm test (#nulltest)

Why: the 18-field scorecard says how faint a moving object can be and still be found. It does not say how often the agents
report a "change" when nothing changed. That is the other half of validity.

How (`nullRun` / `nullSplit` in `public/app.js`, local runs only): open `http://localhost:8081/#nulltest`. On the same 18
fields as the scorecard, fixed before the run, the agents run as usual. Then for every pair of passes two **swapped stacks**
are built: X takes colour 1 from pass a, colour 2 from pass b, colour 3 from pass a, and so on; Y takes the other image of
every colour. Both hold the same 8 colours and the same mix of dates, so nothing real differs between them: a star is in
both, and something that moved between the passes is in half the images of each and is removed from both by the median.
Every change the Analyst's own detector and checks (findTransients, shape, repeat, alignment gate) still report between X
and Y is a **false alarm**. Same depth (8 images) as the real comparison.
- **Control:** 16 fake point sources at AB 14, 15 and 16 (made with the stack's own PSF) are added to Y only and must be
  found, so a zero is not a broken detector.
- Each field goes to `scorecard/null_<id>.json` (`tools/build-scorecard.js` ignores these files). `#nulltest&test=1` runs the
  shipped demo field, `&only=L060B+40` one field, `&from=5` resumes.
- Demo field 189.957 -4.182 (3 passes, 3 swapped comparisons): **0 false alarms**; control found 15 of 16 at AB 14,
  11 to 15 of 16 at AB 15 and 16. `test/nulltest.e2e.js`.
- **The 18 fields (run on the user's PC, 2026-10-25):** 16 measured, 45 swapped comparisons, 494 false alarms in total,
  but almost all of them in the Milky Way plane:

  | Fields | Comparisons | False alarms |
  |---|---|---|
  | 4 in the Milky Way plane (galactic latitude under 1 deg: L060B+40, L120B-40, L240B-40, L300B+40) | 13 | 472 (36 per comparison; at least, see below) |
  | 12 others | 32 | 22 (0.7 per comparison) |

  - 0 false alarms on 7 fields (L000B+00, L000B+40, L060B+00, L120B+00, L120B+40, L180B+00, L240B+00); 1 to 12 on the
    other 5 of the 12 (L180B-40: 12).
  - In the plane fields the changes the app showed between the real passes (L120B-40: 47, L240B-40: 50, L300B+40: 42)
    are as many as in the comparisons where nothing changed, so there they are **not evidence of anything**. The control
    agrees: in L240B-40 and L300B+40 the fake sources of AB 16 were found 0 to 1 times in 16 (crowded star fields).
  - findTransients keeps at most 50 changes per comparison, and several plane comparisons reached 50: the true count there
    is higher.
  - Not measurable: L300B+00 and L300B-40 (fewer than 4 colours with an image in both passes). L300B+40 timed out in the
    full run and was run again on its own (38 s, data already cached).
  - In a URL, write + as %2B: `#nulltest&only=L300B%2B40` (a bare + reads as a space and no field matches).
- The note on the old scorecard run: it reported 0 changes between the passes on 8 fields and 2 to 50 on the others,
  the large numbers in the plane fields. This test shows those large numbers are what noise alone gives there.

## v0.28.1: a key for the whole-sky map
- While the whole sky is shown (desktop), the empty corners around the map carry its key: top left, what the map is and
  how to use it; bottom left, what the marks mean (famous places, the asteroid example, the 18 test fields, the ecliptic).
  Hidden as soon as you zoom into a field, on the intro and during the tour.

## v0.28.0: "mission control" look (desktop); intro plate removed
- The blink plate of v0.27.1 is gone (user's call): the intro keeps exactly its earlier options.
- From 1100 px: one solid header bar; the controls and the result/agents as sidebars flush with the screen edges; a status
  bar along the bottom with RA, Dec, wavelength, epoch, FoV and the credits; the sky framed in the middle. Archivo only
  (the serif titles and corner ticks of v0.27 are switched off on desktop).
- Intro: the words on the left, the three real examples as start cards on the right (colour-coded edges). Same buttons.
- Phones and tablets keep the v0.26/v0.27 layout. public/hero-*.png/gif are no longer used and can be deleted.

## v0.27.1: the blink plate on the intro
- The first screen now shows real SPHEREx frames: 8 exposures of the shipped asteroid example (May 30 to June 5, 2026),
  cropped around 3865 Lindbloom, flipping like a blink comparator, in a framed plate with a factual caption and an
  "Open this example" button. Made by `node tools/make-hero.js` from demo-cache (public/hero-blink.gif, 352 kB; a still,
  public/hero-still.png, for reduced motion). Desktop and laptop only (from 1000 px); captions in all four languages.
- server.js serves .gif/.woff2 with their types and does not gzip images (restart needed).

## v0.27.0: visual identity "plate and instrument"
- Titles (result card, tour, Learn, Agents, the intro headline) in Instrument Serif, like the labels on archive plates;
  controls stay in Archivo; readout numbers set condensed. Tamil and Hindi titles keep their own fonts.
- Registration marks: four corner ticks on every instrument surface (docks, cards, tour card, dialogs), the same marks as
  the eyepiece frame around the sky. Corners 3-6 px.
- The five agents drawn as a pipeline: one line through them, a node per agent, green when done, cyan while running.
- Intro: sentence-case kicker, serif headline, tighter spacing on short laptop screens. CSS and the font link only.

## v0.26.0: the observatory on every screen, and prewarm
- Laptops (1100-1499 px, 1366 x 768 included): compact header (nothing cut off), slimmer docks, credits in one line under
  the docks so the readout no longer sits on them.
- Tablets and small windows (701-1099 px): one dock on the left with a Controls / Agents / Result switch on top; the sky,
  the eyepiece frame, the readout and the scale bar on the right. Tap the open one again to hide the dock.
- Phones: same switch at the bottom, glass sheets, the scale bar under the header. The tour treats tablets like phones.
- Prewarm: on a local run open `http://localhost:8081/#prewarm` (or `#prewarm&fields=150.8,12.4;265.2,-28.9`). The agents
  run on each demo field in turn; then `node tools/export-demo-cache.js cache --newer-than 90` copies the downloads into
  demo-cache/ (ships with the site, seeded at start, never pruned). Test: `node test/prewarm.e2e.js`.

## v0.25.0: the observatory layout (desktop)
- The sky owns the middle of the screen, framed by four eyepiece corners. Controls dock to the left, the result card and the
  agents' log to the right; nothing floats over the field any more.
- The RA/Dec readout sits in the frame's bottom-left corner; a true angular scale bar (30″ to 10°) in the bottom-right.
- Clear view (header button, or the H key) slides both docks away for a full-window sky; the tour switches it off.
- The header actions are one toolbar. Phones and narrow windows (under 1100 px) keep the earlier layout.

## v0.24.0: the tour speaks Tamil, Hindi and Spanish on every device
- Listen used only the voices installed on the device; most Windows PCs and many phones have English only, so Tamil, Hindi and
  Spanish stayed silent. Now every caption of the story and the guide has a recorded narration in all four languages:
  `public/audio/<lang>/<key>.mp3`, key = hash of the exact caption text, listed in `public/audio/index.json`.
- A caption with no recording (e.g. different live numbers) falls back to the device voice, then to captions only.
  The story still waits for the reading to end; Pause pauses the recording; Next stops it.
- Making the recordings (needs the internet; Microsoft neural voices through the open-source edge-tts tool):
  `node tools/dump-spoken.js` (writes public/audio/texts.json from the real story) then `pip install edge-tts` and
  `python tools/make-voices.py`. Voices: en-US-AriaNeural, ta-IN-PallaviNeural, hi-IN-SwaraNeural, es-MX-DaliaNeural.
- Test: `node test/voice.e2e.js`. server.js serves .mp3 as audio/mpeg (restart needed).

## v0.23.0: every pass filled to "Images per epoch"

- v0.22.1 left a thin pass out. Now every pass is kept and each is filled up to the asked-for number (8) with its own images:
  first the colour-matched slots (the same colours in every pass), then extra images of that pass (same detector and closest
  colour first, at least half the field covered, new visits first). A pass with fewer images in the archive gets all it has,
  and the Archivist says so (live, RA 134 Dec 5.6: the April 2025 pass has only 4 images there).
- The extras are not colour-matched with the other passes, so they are used only inside their own pass (Time machine, Blink,
  finding movers inside a pass). Comparisons between passes (stacks, Changes, Analyst) still use the matched images only.

## v0.22.1: a thin sky pass no longer caps the run; sturdier S3 reads

- Every colour slot needs one image from every sky pass, so one pass with few images capped the whole run. Seen live at
  RA 134, Dec 5.6: 114 and 140 images in two passes but only 4 in April 2025 (2 covering the field), so "8 per epoch" gave 2.
  A pass with fewer than half the asked-for images covering the field is now left out (when two passes remain), and the
  Archivist says which and why. Same spot now: 8 per epoch, 16 images. The report lists it (`epochsLeftOut`).
- S3 range reads: a whole-file answer to a range request is refused, retries go to the other S3 address, 60 s timeout.

## v0.22.0: Changes, explained

- New default Changes view, "Explained": every spot that changed is sorted into plain kinds with an icon on the sky:
  ☄ known asteroid passing by (with its track and direction), ✦ a star got brighter, ? not explained yet, × detector glitch
  (counted, hidden on the sky). One sentence says it all (live example: "In 24 SPHEREx images taken over 375.7 days, 188 spots
  changed. 131 were detector glitches; the rest: 1 known asteroid, 21 stars got brighter, 35 spots we cannot explain."), with
  a bar of the proportions.
- Tap a kind to show only that kind and step through its spots (strongest first), from the panel or with "Next" on the card.
  Each change card flips between that image and the usual sky there (the median of its sky pass).
- By epoch and By image (the colour maps for experts) are unchanged. Guide text updated in all four languages.
- Test: `test/changes.e2e.js` (desktop and phone).

## v0.21.0: works when the French astronomy servers cannot be reached

- Seen live: every server in France (CDS Strasbourg, IMCCE) stopped answering from the user's network. The sky viewer
  (Aladin Lite, loaded from CDS) failed, so the page showed no sky; name search (CDS Sesame) and SkyBoT failed too.
- Aladin Lite 3.8.2 now ships with the site (`public/vendor/`, from npm `aladin-lite@3.8.2`, GPL-3.0, wrapped to load as a
  plain script); the CDS copy is only a fallback.
- Base sky tiles come through this server (`/hips/2mass|allwise|dss2/...`), from the first mirror that answers: NASA/IPAC
  IRSA, CSIRO CASDA (2MASS), China-VO, then CDS. Tiles are kept on disk (counted in the cache limit), so a sky seen once works
  offline. Only HiPS file paths are proxied.
- Name search: Sesame gets 8 s, then NASA/IPAC NED's name lookup answers; Sesame is skipped for 5 minutes after a failure.
  (NED knows galaxies, nebulae and clusters; single stars need Sesame.) Known objects already fall back to the MPC (v0.16).
- Test: `test/sky.test.js` (mirror fallback, disk cache, path guard, NED fallback). The browser tests stub the bundled Aladin.

## v0.20.0: four languages, and Listen

- The intro, the 90-second story, the tool guide and the tour buttons in English, Tamil (தமிழ்), Hindi (हिन्दी) and Spanish
  (Español). Pick from the language menu on the intro or on the tour card; remembered; `#tour&lang=hi` (or `ta`, `es`) opens
  the story in that language. The rest of the app stays in English on purpose.
- Adding a language: `public/i18n.js` maps every English sentence of the tour to its translation (one block per language,
  plus one line in `langs`); missing sentences fall back to English. Captions with live numbers are written per language in
  `public/tour.js`. `Tour.missing()` lists untranslated sentences (the test requires none).
- Listen: the tour card reads each caption aloud with the device's own voices (Web Speech API, no audio files, no server). In
  the story it waits for the reading before the next chapter. With no voice for the chosen language it says so and stays in
  captions (Windows and Android can add Tamil and Hindi voices in their language settings).
- Test: `test/tour.e2e.js` also checks Hindi and Spanish (intro and story), no missing sentences, and the Listen button.

## v0.19.0: 90-second story, and the story, guide and intro in Tamil

- The story is now ten chapters (about 90 s): Neptune found with a pen (Le Verrier and Galle, 1846) -> Tombaugh's blink and
  Pluto (1930) -> Planet Nine, still a hypothesis (Batygin and Brown, 2016) -> SPHEREx -> the agents on the real example ->
  the real asteroid under a spotlight -> the game -> Hide Planet X -> the 18-field scorecard -> your turn. The first three
  chapters have small animated illustrations, each labelled "illustration".
- English or Tamil (தமிழ்): the intro, every story chapter, every guide step and the tour buttons. Switch with the button on
  the intro or on the tour card; the choice is remembered (localStorage), and `#tour&lang=ta` opens the story in Tamil. Numbers
  in the captions are still read from the live results. The rest of the app stays in English on purpose.
- The opening link is read once at load (`BOOT_HASH`), so `#tour`, `#play` and `lang=ta` still work after the view rewrites the
  address; a `#tour` link waits for the tour script if it loads after the sky.
- Test: `test/tour.e2e.js` now checks the 10 chapters in English and the story, intro and all guide steps in Tamil.

## v0.18.0: Find the asteroid (a 60-second game on real images)

- "Find the asteroid" in the header and on the intro (link: `/#play`). Opens the bundled field (3865 Lindbloom) at once, or the
  current field when the agents confirmed a known asteroid there. Frames: the images of the same colour as each sighting from
  every sky pass (stars look alike in all of them; the asteroid is only in the images that caught it), flipped like a blink
  comparator. The asteroid sits at a random place in the crop.
- Easy level (default): the median of the game images is taken away, so stars vanish and changes remain. Real level: the
  images as taken. Display through a 3 x 3 median from 3 sigma up, so noise and single-pixel hits do not show.
- Tap within 3 SPHEREx pixels (~18") of where it was caught to win; wrong taps get a hint about what to look for, a Hint
  button draws a circle, after 4 misses it reveals. The reveal names it, says how far it moved and that it is a known
  asteroid matched to the orbit catalogue (no discovery claim). Then "Make my discovery card" with the game's post text.
- Early known-object lookups (v0.17) no longer make the Analyst warn about images it never needed (offline examples).
- Test: `test/game.e2e.js` (desktop and phone: open, wrong tap, hint, win, reveal text, card text, real level, lose path, #play link).

## v0.17.0: new spots in about 2 minutes (NASA's S3 copy, early known-object lookups)

- Measured live: IRSA's cutout service takes 25-45 s per image whatever the size (0.5 deg 32 s, 0.1 deg 26 s): waiting, not
  bandwidth, and only 4 at a time. The same files are public on AWS (`s3://nasa-irsa-spherex`, AWS Open Data, same paths as
  `/ibe/data/spherex/`). `lib/s3cut.js` reads only the headers and the rows of the field from IMAGE, FLAGS and ZODI (plus the
  WCS-WAVE table) with HTTP range requests: about 7.5 MB per image, 6 images at a time. Checked live against IRSA's own cutouts
  of the same images: every pixel of IMAGE, FLAGS and ZODI identical, headers identical except NAXIS1/2 and the reference pixels.
  IRSA's cutout service stays as the fallback. Test: `test/s3cut.test.js`.
- v0.17.1: the page does the S3 reads itself (live: from the user's PC the browser reached S3 fine while the Node server's
  requests hung). It asks the server first with `cached=1` (204 = not cached, nothing downloaded), and posts what it read
  back so the spot opens from the cache next time (local runs only). Server-side S3 only with `SKYSHIFT_S3=1`. Test: `test/cutoutput.test.js`.
- Known objects are asked for as soon as the images are chosen, while they download (they were asked for after all 24 had
  arrived). SkyBoT gets 5 s (`SKYSHIFT_SKYBOT_HEDGE_MS`); if it has not answered, the MPC checker is asked too and the first good
  answer wins (was: wait SkyBoT's whole 20 s timeout). Test: `test/hedge.test.js`.

## v0.16.0: Minor Planet Center fallback for known objects

- IMCCE (SkyBoT) was unreachable from one network while the Minor Planet Center was fine. When SkyBoT does not answer, the
  server asks the MPC's MPChecker (same orbit catalogue). Positions agree with SkyBoT to a few arcseconds (`test/mpc.test.js`).
- The MPC prints positions to 0.1 s / 1" and motion to 1"/h, and gives no orbit class, distance or position error (2" added to
  the match tolerance for the rounding). Answers carry `source: "MPC"` and every place in the page says which service answered.
- Polite use: 2 queries at a time, answers kept 30 days, one query serves every image within an hour (moved along the motion).
  `SKYSHIFT_NO_MPC=1` turns it off. Test: `test/mpcfallback.test.js`.

## v0.15.4: accessibility audit and phone layout

- **axe-core** (WCAG rules) on the intro, after the asteroid example (result card open) and the About page, desktop and
  phone: **0 violations** (was 14 on the intro: content outside landmarks; 3 on the Changes timeline: labels and contrast).
- **Lighthouse** (sandbox, Aladin and fonts blocked there, so real-network performance will be lower):
  main page mobile 97 / 100 / 96 / 100 (performance / accessibility / best practices / SEO), desktop 100 / 100 / 96 / 100;
  About page 100 / 100 / 96 / 100. The 96 is only the blocked external scripts in the sandbox.
- Phones: the intro starts below the two-row header (the header sat on top of the intro text); toasts and the wait panel
  moved below the header; header buttons and presets are taller (38 and 36 px) for thumbs; the header buttons and view
  tabs fade at the right edge while more are hidden there (they scroll sideways).
- The sky map is announced as an interactive "sky map" (role application).

## v0.15.3: the Analyst never hangs on SkyBoT

Seen live on the user's PC: the Analyst sat at "Looking for things that move..." for minutes. Cause: SkyBoT (the known-object
service) did not answer from that network. Each of the 24 lookups waited about 60 s (timeout plus retries) inside the shared
download slots, so the IRSA images queued behind them too.
- SkyBoT now has its own pool (4 at a time, not the IRSA slots), a 20 s timeout and no retries. The first failure pauses
  lookups for 2 minutes: the others fail at once, an earlier saved answer is still used. Test: 24 lookups give up within one
  timeout (`test/skybot.test.js`).
- The run finishes and the Analyst says why nothing was named: "Known-object check not possible... every change stays
  unconfirmed. Run the agents again in a few minutes." One toast, not one per image.
- The wait panel also covers this step after 3 s ("Asking SkyBoT which known asteroids and comets were there...").
- **server.js changed: restart the server once.**

## v0.15.2: professional polish (share preview, About page, honest waiting)

- **Link preview**: sharing the link (WhatsApp, X, LinkedIn, Slack...) shows a 1200x630 card made from real SPHEREx images
  (`public/og.jpg`), with title and description. Pages say `%ORIGIN%` and `server.js` fills in the site address:
  `PUBLIC_URL` when set (set it on a public host, e.g. `PUBLIC_URL=https://arcnave.example.org`), else the address the
  visitor used (also behind a proxy, via `X-Forwarded-Host/Proto`; anything that is not a plain host name is ignored).
- **App icon + manifest**: favicon, phone home-screen icon, "Add to home screen" opens full screen.
- **About page** (`/about.html`, linked from the intro, the Learn drawer and the footer): what ARCNAVE is and is not, every
  data source with links, the five agents step by step, when it says "known asteroid", the 18-field test (numbers read
  from `scorecard.json`), an honest list of limits, credits and the AI-assistance note.
- **Wait indicator**: when NASA's archive is slow (a new spot), a panel says what it is waiting for, shows elapsed time,
  a progress bar for the images and an estimate measured from the real download rate. It never appears when everything
  comes from the cache. Test: `npm run test:wait` (archive slowed on purpose).
- Intro example text fixed: the asteroid is checked against its known orbit (SkyBoT), not "NASA's orbit".
- **server.js changed: restart the server once.**

## v0.15.1: twice as fast, same answers

Measured on the user's PC (8 threads), asteroid example from demo-cache: **20.3 s → 9.5 s**, all three passes on screen
after 1.6 s, no frame of the page held up more than 100 ms.
- The camera flies while the Archivist and the Aligner already work (the 3.3 s flight used to come first).
- Each image is registered on the reference only once: the final pass re-did all 24 for nothing (alignment 8.1 s → 1.9 s).
- The reference image's stars are found once, not again for every image (`SkyFits.refPeaks`).
- Results are bit-identical to v0.15.0 (candidates, asteroids, every image's shift), checked on both examples.

## v0.15.0: Discovery card (share what you found)

- **Discovery card button** (next to Run agents here) and **Discovery card (GIF)** on every result card. It makes a looping GIF:
  the same patch of sky from each SPHEREx image, so stars stay put and anything that hops is moving.
- What is on the card: object name or "SPHEREx sky over time", an honest status badge (Known asteroid, confirmed / Unconfirmed
  change / Likely artefact / Look for anything that hops), RA and Dec, dates and time span, infrared wavelength of every frame,
  a 1′ scale bar, a note on what it is and is not ("Not a new discovery" for known asteroids), and data credits
  (NASA SPHEREx via IRSA, IMCCE SkyBoT).
- Known asteroid: frames are the images of the pass it was caught in. A green ring where SPHEREx saw it, a grey "not here now"
  ring on the same spot in the other images.
- The card window has Share (phone share sheet with the GIF, where the browser allows it), Download GIF and Copy post text
  (with a link back to the same view and #SPHEREx #NASASpaceApps).
- Made on the viewer's device (canvas + a small GIF encoder in `public/gif.js`, run in a worker: `public/gif-worker.js`).
  Nothing is uploaded. Asteroid example: 8 frames, about 0.7 MB, about 1.3 s.
- New step in the every-tool guide. Tests: `test/gif.test.js` (encoder decoded by an independent decoder),
  `npm run test:card` (asteroid and field cards on desktop and phone, from demo-cache only).

## v0.14.3: where the waiting really is, and less of it

Measured on a real laptop (Windows, local server):
- **Asteroid example**: about 12 s right after a page load, about 6.5 s warm (all from the local cache).
- **A new place**: the IRSA archive search alone takes about 20 s, then IRSA cuts out each image in 25 to 45 s (4 at a time). The preview therefore needs about a minute and all 24 images 2 to 3 minutes. That part is NASA's server, not this app.

Changes:
- The archive search now starts **while the camera flies** to the spot (it used to wait for the 3-4 s flight).
- The image workers start at page load (not at the first image), and up to 6 run on 8-core machines.
- **Whole-sky landmarks open in seconds**: their archive answer and their first image of every sky pass ship in `demo-cache` (14 images, 8 MB), so the preview shows at once; the deeper images still come from IRSA. Tested offline: preview in 1.7 to 2.8 s each (`test/landmarks.e2e.js`). Before: 66 to 300 s each on the live run.
- The Large Magellanic Cloud marker was replaced by the **Crab Nebula**: SPHEREx has seen the LMC area in one long pass so far, so there was nothing to compare.

## v0.14.2: faster colour changes, and the colour really holds

- **Where the 3 minutes went** (measured live): IRSA takes about 25 to 45 s to cut out one SPHEREx image, and the server asks for 4 at a time (more gave "503 busy" answers earlier), so 24 images take 2 to 3 minutes. Our own processing is no longer the bottleneck (v0.14.0).
- **Progressive loading** (every field, not only the example): one image per sky pass is fetched first, all passes in one wave, and shown at once as a preview with a message; the other images follow for the deeper stacks and the report. Time machine and Blink show the pass's preview image (labelled) for images still on their way. Before, the middle pass waited for a second wave (preview 75 s on a live run).
- **Colour bug 2**: with 8 images per epoch only the first image followed the chosen colour; the other 7 were whatever colours matched across epochs (live, at 1 µm: images at 3.8 to 4.95 µm). Now, when you pick a colour, every image comes from the same detector, i.e. the same colour range (D1 0.75 to 1.1 µm ... D6 4.4 to 5 µm): checked live, 1 µm gives 24 D1 images, 3 µm 24 D4, 4.5 µm 24 D6. The automatic colour of a new field keeps the original rule, so the published scorecard runs stay reproducible.
- **Preset colours ship with the site** for the asteroid example (Hot stars, Dust & Ice, Cool worlds): they open from `demo-cache` in seconds, also on a fresh host and when IRSA is busy.
- A shared link keeps its colour; the image counter no longer reads "26 of 24".

## v0.14.1: the Color slider really changes the colour

- Bug (reported by a user): moving the Color slider or pressing a preset changed only the label. The images of a field are picked for one colour when the field loads, and those picks were kept. Now letting go of the slider (or pressing Hot stars / Dust & Ice / Cool worlds) fetches the real SPHEREx images taken at the new colour and the agents run again on them, so every view, the false colour and the report use that colour. The chosen colour is kept (not replaced by the best-match colour).
- Checked live on the asteroid field: 4.45 µm -> Hot stars picked images at 0.99 to 1.00 µm in all three passes, shown in cyan; back to 4.45 µm reused the cached images. A colour seen for the first time downloads 24 images from IRSA (about 3 minutes on that run); the app says so.

## v0.14.0: no more freezing, whole-sky start, every-tool guide

- **Freezing fixed.** Measured on a real laptop: loading the asteroid example blocked the page for about 69 s in total (24 freezes of 2 to 5 s each). Cause: preparing each image (`prepareCutout`) took 1.8 s on the main thread, because the reprojection ran the full TAN + 8-step SIP solve per pixel 4 times (data, outlier-kept data, two masks). Now the pixel map is computed once and reused (identical numbers, checked on all 24 demo cutouts: 0 differing values; 39 s to 10.5 s in Node), and the work runs in a pool of Web Workers (`public/prep-worker.js`), several images at once. After the fix: no long freezes, and the example opens in about 19 s instead of 70+ s. The overlay also redraws only when something changed.
- **Opens on the whole sky**: 2MASS near-infrared (now the default base sky) in an Aitoff projection with the Milky Way across the middle. Markers: famous places, the asteroid example, and the 18 scorecard test fields. Click one to dive in and the agents start. **Whole sky** in the header zooms back out. The welcome text sits beside the sky and the instrument panels appear when exploring starts.
- **Tour menu** in the header: the 60-second story, or **Every tool, one by one** (21 to 22 steps, each with *What it is* and *How to use it*, a spotlight on the tool, a jump menu; tool steps show real data from the example). Link: `/#guide`.
- Header fits on one line (High contrast is an icon, Tour is a menu).
- Fixes: a zoomed-out view is no longer saved into links (it reopened as a broken half sky); the guide's "How to use it" text no longer clashes with the thumbnail style; panels with `position:fixed` are now found by the spotlight.

## v0.13.0: guided tour, "60 seconds as Clyde Tombaugh"

- **Take the 60-second tour** on the welcome screen, **Tour** in the header, or open `/#tour` (a link for judges).
- Seven short chapters told over the live app: 1930 (Tombaugh's blink, shown as a labelled illustration, not the real plates) → SPHEREx 2025 (the 102-tick ruler) → the agents loading the bundled real example → blink with a spotlight on the real asteroid 3865 Lindbloom → Hide Planet X → the 18-field scorecard → "the sky is yours".
- Every number in the captions is read from the app's own results (the example run and `public/scorecard.json`), none is typed in.
- Auto-advances in about 60 s; pauses while the pointer is on the caption, with Pause, or in a background tab. ← / → step, Esc leaves. The overlay never blocks the app: only the caption takes clicks. Works on phones (caption on top, sheets switch with the chapter) and with reduced motion.
- Test: `node test/tour.e2e.js` (desktop + phone, from demo-cache, no IRSA needed).
- Fix (server.js): the cache limit (2 GB) no longer deletes the shipped example files. Seen live: after the 18-field scorecard filled the cache, the examples quietly went back to downloading from IRSA (about 2 minutes instead of seconds). `test/prune.test.js` checks it. Restart the server once to pick this up.
- Fix: the Learn drawer is fully opaque (on phones the controls showed through it).

## v0.12.0: validation scorecard (18 fields)

Hide Planet X was run on 18 fields fixed before the run (ecliptic longitude 0, 60 ... 300 deg x latitude 0, +40, -40 deg),
8 images per epoch, 0.5 deg field, 19,880 fake planets. All 18 could be measured (two were run a second time: an IRSA 503
outage, and a runner bug fixed during the run). A planet 1000 AU away is found at least half the time down to AB 14.0 to
17.0 (median 16.75). A planet 300 AU away is found in 11 of 18 fields: away from the ecliptic the 8 images of one pass can
be spread over weeks (32 days at lambda 60, beta -40), the planet moves tens of pixels between them and the median stack
removes it. The Milky Way plane is the hardest (AB 13 to 15.5). Shown in Learn ("Does it work everywhere?") and under the
Hide Planet X map. Rerun: local server, open `/#scorecard`, then `node tools/build-scorecard.js`.

## v0.11.0: ARCNAVE name and design

The app is now called ARCNAVE. New design: one typeface (Archivo, wide for the name), quiet instrument-style panels, tabs with
an underline, solid primary buttons, and one bold element, a 102-tick spectral ruler for SPHEREx's 102 colours (0.75 to 5 um)
in the same false-colour scale as the images. It is the brand mark, the opening animation and the Color slider. The intro now
tells the Tombaugh story (Pluto, 1930, two plates days apart). Internals are unchanged: element ids, `SKYSHIFT_*` environment
variables and all tests stay the same.

## v0.10.1: faster Hide Planet X map

The detectability map now takes about 5 s instead of 27 s on the same field (1120 fake planets), with the same result (50% limit AB 16.5 for 300 AU and farther). `robustStats` sorts typed arrays, and each fake planet reuses the noise levels of the base comparison instead of re-measuring them (it changes a few pixels out of tens of thousands). The info box now names the two passes Hide Planet X really compares, the Color slider is hidden in that tab, and the slider values wrap on phones.

## v0.10.0: Hide Planet X (injection-recovery test, not a search)

New tab **Hide Planet X** (after a run with 2+ epochs). The user picks a distance (50-1000 AU) and a brightness (AB), clicks the
sky (or lets it pick a spot), and a FAKE planet is added to the real images: made with each epoch stack's own ePSF (checked against
the official SPHEREx PSF), at the position a body at that distance would have at the exact time of every image (Earth's orbit,
`lib/planetx.js` track; its own orbital motion is left out and said so). The stacks are rebuilt and the Analyst's own detector looks
for it. **Map this field** hides 1120 fakes (7 distances x 10 brightness levels x 16 spots) and draws the detectability map.
- The two passes compared are the pair with Earth farthest apart. On 189.957 -4.182 the first and last passes are a year apart
  (Earth back in the same place): a 1000 AU fake barely moved and cancelled out like a star. Epochs 1 and 2 (221 days, 1.9 AU) fix that.
- Units: images are MJy/sr; a source of f mJy adds f x 1e-9 / pixel solid angle (6.15") in total; AB 0 = 3631 Jy.
- Real result for 189.957 -4.182 (D6, ~4.5 um): found at least half the time down to about AB 16.5 (~0.9 mJy) from 100 to 1000 AU;
  the noise alone predicts AB 17.3. Nearer than ~50 AU the fake moves during a pass (2 days) and the median removes it.
- `node test/planetx.test.js` (units, parallax, synthetic injection-recovery, 11 tests) and `node test/px.e2e.js` (real field).

## v0.9.2: PSF checked against the official SPHEREx PSF

Every SPHEREx spectral image carries the pipeline's own PSF (extension `PSF`: 11 x 11 detector zones, 101 x 101 each at
10x oversampling, built from >1000 stars per zone; IRSA "PSF extension header error" note: plane = y * 11 + x).
- `GET /api/spherex/psf?url=&ra=&dec=` (local runs only): downloads a 0.02 deg cutout once and returns the zone plane for the
  spot, the header's choice of plane, VERSION and PSF_FWHM. `test/psfzone.test.js` checks the zone rule, including old swapped headers.
- `http://localhost:8081/dev/psfcheck.html` (local only) and `test/psf.official.test.js` (offline, fixtures in
  `test/fixtures/psf_official/`, 22 real images): the official PSF is put on the native detector pixels, sent through ARCNAVE's
  own resampling, and compared with the real stars and with ARCNAVE's PSFs.
Results (22 images, D6 4.5-4.9 um, RA 189.957 Dec -4.182):
- We read the right zone in all 22 (agrees with the fixed headers, VERSION 6.4+psffix1 / 6.5.5+psffix1 / 6.5.7).
- Official FWHM on the native pixels 6.07-6.38" (median 6.17"); header PSF_FWHM says 6.61".
- Real-star shape on our grid (median 0.398) lies between the official PSF read as pixel-sampled (0.359) and pixel-averaged (0.411).
- ARCNAVE ePSF: FWHM on our grid 10.2" vs official-through-our-pipeline 9.9-10.9"; fakes match the stars in 21 of 22 images
  (mean shape ratio 1.04). A fitted 2-Gaussian model was worse (1.10) and is no longer the default.
- Star shape changes image to image (0.31-0.52) but the official, exposure-averaged PSF does not; the per-image ePSF follows it,
  which is why fakes are made with each image's (or epoch stack's) own ePSF.
- Fixed on the way: FWHM is now measured directly at half maximum (`F.fwhmOf`); it was quantised (1.58/1.80/2.00 px) and could be
  inflated 3x by noisy wings. A faster coarse-to-fine re-centring made fakes softer on D4 and was reverted.
- Our resampling widens stars from ~6.2" to ~10" FWHM. Fine for comparing images, but it costs sensitivity (possible later improvement).

## v0.9.1: empirical PSF (step 1 of "Hide Planet X")

`F.empiricalPSF(flat, n, st)` measures the point-spread function of one image from its own bright, isolated stars, as an
oversampled "effective PSF" (4x finer grid; every star sits at a different sub-pixel position, so no image is shifted or
blurred). `F.injectPSF(flat, n, P, x, y, flux)` adds a fake point source with exactly `flux` total light.
`node test/psf.test.js`:
- synthetic Gaussian stars: FWHM measured 2.69 px vs 2.68 px expected (pixel-integrated);
- real D4 cutouts and all 24 real D6 images: fakes have the same shape (peakShape) as the image's real stars in 22 of 24
  images; on average fakes are 6 % softer, i.e. slightly harder to detect, so a detectability test stays cautious;
- the PSF changes from image to image (star shape 0.31 to 0.52 across the 24), so one PSF per image is used, not one per field.
FWHM here is measured on our reprojected 6.15" grid, so it includes the resampling blur.

## v0.9: examples and public deploy

- **Examples** (intro screen, and the *Examples* button): "Catch a real asteroid" (8 images per epoch, opens the 3865 Lindbloom proof card)
  and "See a false alarm caught" (1 image per epoch: the 922σ change that is a hot pixel). Both are real SPHEREx data
  for RA 189.957, Dec -4.182, shipped in `demo-cache/` (14 MB). At start the server copies `demo-cache/` into the cache folder
  (only missing files), so a fresh host opens them in seconds even when IRSA is busy. `node test/examples.e2e.js` proves it:
  empty cache, nothing downloaded.
- **Deploy**: `render.yaml` (Render blueprint) or `Dockerfile` (any container host). Both set `SKYSHIFT_PUBLIC=1`. Any other field
  a visitor types is fetched live from IRSA (cached after that); the example fields never need the network.
- **More examples**: see the header of `tools/export-demo-cache.js`.

## How it worked (v0.1-v0.8)

| Piece | Source |
|---|---|
| Base sky (HiPS tiles) | CDS Aladin Lite v3 (AllWISE / 2MASS / DSS2) |
| SPHEREx image list | IRSA TAP `spherex.plane` + `spherex.artifact`, queried by `server.js` |
| SPHEREx pixels | IRSA cutout service (`?center=ra,dec&size=deg`), proxied by `server.js`, parsed in the browser (`lib/fits.js`) |
| Known movers | IMCCE SkyBoT cone search at the time of each image |
| Tracks | JPL Horizons (geocentric) |
| Name search | CDS Sesame |

Flow: pan to a spot, press **Load SPHEREx here**. The server lists every SPHEREx image covering that point.
They are grouped into epochs (gap over 60 days = new epoch). For each epoch the image whose real wavelength at that
spot is closest to the **Color** slider (predicted from its archive footprint, preferring images that cover the whole field)
is cut out, cleaned of flagged bad pixels, reprojected onto a common tangent grid (TAN + SIP), background-flattened, aligned
on the stars of epoch 1 and drawn over Aladin. Time machine, Blink, Swipe and Difference all work on those aligned grids.

## v0.8 (Changes view: see what changed, by epoch and by image)

A new **Changes** tab (the default after a run with several images per epoch):
- **By epoch:** each epoch in its own colour (2 epochs: cyan and red; 3: blue, green, red). The colours add up to white, so
  everything that is the same in every epoch is white and anything only in one epoch keeps that epoch's colour.
- **By image:** the unchanging sky in grey, and each image's extra light in a colour of time (violet = first image, red =
  last). A moving object leaves a chain of coloured dots. A timeline under it has one bar per image (how many spots were
  brighter there; the faded part looks like artefacts). Click a bar to open that image; click a ring for a card.
- How it stays honest (all in `lib/fits.js` `changeMaps`, tested in `test/change.test.js`): each image is compared with the
  images of the **same colour** from the other epochs (the 8 images of an epoch span 4.46 to 4.95 um, and stars differ
  with colour); light is compared in **3x3 boxes** (a star shifted by part of a 6.2" pixel changes single pixels, not the
  box), with the noise **measured**; a pixel the pipeline flagged is used only when the **exposure minutes apart** also has
  light there; a spot missing from that partner exposure, or sharper than the stars, is counted as an **artefact** and
  left grey; a bright star must gain at least 25 % of its own light to count (then it is shown as a possible **variable
  star**, unconfirmed).
- Live field 189.957 −4.182 (24 images): first try 946 spots (731 cosmic rays); now 188 spots, of which 131 are counted
  as artefacts and not drawn, 21 brighter stars, 35 unexplained (unconfirmed), and 3865 Lindbloom labelled as the known
  asteroid. By epoch: every star is white, matching "0 changes between the stacks".
- Phone layout: two-row header, controls in a scrolling bottom sheet, cards between them, Agents panel folded on narrow
  screens (seen live: at 646 px the header buttons covered the controls).

## Live run on the user's PC (2026-10-21, v0.7.1)

Field RA 189.957, Dec −4.182, 8 images per epoch, real IRSA + SkyBoT, run in the browser on localhost:
- First try: **17 of 24 cutouts failed** (HTTP 502: IRSA answers "Server busy" to many requests at once; each worked when
  asked again), and the Analyst still said "stacks (8 images each)". Fixed: the server allows 4 IRSA image downloads at a time
  and retries busy/timeout answers 3 times (`SKYSHIFT_IRSA_PARALLEL`, `SKYSHIFT_RETRIES`); the app asks again for missing
  images two at a time; the Aligner warns about missing images and the Analyst gives the real number per epoch.
- Second try: **24 of 24** images, median alignment scatter 0.09 px, **0 changes** between the 8-image epoch stacks (the 922σ
  single-image "change" is gone), **3865 Lindbloom (V 16.7) confirmed** in epoch 3: two exposures 6 minutes apart,
  22σ and 19σ, 4.1″ and 2.0″ from SkyBoT, gone at the other visits. Re-run from the cache: about 12 s.
- Hot pixels also "repeat" in the next exposure (same pointing): repeated sources with shape 0.05 to 0.13 (stars 0.42) are now
  rejected (Lindbloom: 0.23 and 0.34). Other one-visit sources are split into "seen twice in a row" (unconfirmed) and "single
  image, nothing to check against".
- SkyBoT answers were cached per 0.01 day, so two exposures 6 minutes apart shared one prediction (predicted motion "0").
  Now cached per 1e-4 day, the same precision as the query.
- Also: the welcome screen closes when a search starts, faint (V > 19) known objects are drawn faint, short motions are given
  in arcsec and minutes, `/api/health` reports the real version.

## v0.7 (real-data check of the 24-image mode)

Checked on 24 real SPHEREx images of field RA 189.957, Dec −4.182 (3 epochs x 8, detector 6, 4.45 to 4.95 µm):
- Every image aligned on 29 to 53 stars (scatter 0.06 to 0.16 px). Noise of one image 0.037; of an 8-image stack 0.014 to 0.018.
- Comparing single images gave 2 "changes" (the 922σ C1 and a 22σ C2). Comparing the 8-image stacks gave **0**: C1 is in
  1 of 8 images of its epoch (1249σ there, 3.5 to 8.6σ in the other 7), C2 in 1 of 8 (30σ, others under 2.5σ).
- Known asteroid 3865 Lindbloom (V 16.7) shows at its SkyBoT position (21.5σ in one exposure, 7.6σ in the exposure taken
  minutes before). The SPHEREx pipeline flags those pixels MP_OUTLIER, which earlier versions repaired as glitches.
  OUTLIER-only pixels are now kept in a second copy of each image (`flatKeep`) that is shown and searched for movers; the
  comparison images still repair them. A sighting counts when it repeats in the other exposure of the same visit
  (a cosmic ray hits one exposure only).

## v0.6 (8 images per epoch)

"Images" (next to Field) chooses 1, 4 or 8 images per epoch; 8 is the default.

- **Archivist** builds up to 8 "slots": one image from every epoch, all at nearly the same wavelength at the field (first
  within 0.8 % of the wavelength, if too few then within 1.5 %, about half a SPHEREx channel; the largest difference is shown).
  On field 189.957 −4.182 all 8 slots are detector 6, 4.46 to 4.95 µm, differing by at most 0.013 µm between epochs.
- **Aligner** downloads all images (3 epochs x 8 = 24) in parallel and registers every one on the same stars.
- **Epoch stacks:** Swipe and Difference compare the median of each epoch's images. A cosmic ray, a glint or an asteroid
  in one image is gone from the median, and the noise is lower.
- **Repeat check** in the proof card: "seen in 6 of 6 images of epoch 2, in 0 of 6 of epoch 1".
- **Inside an epoch:** SPHEREx sees a spot at several visits, hours to days apart. A source at one visit that is missing at
  the same spot at the other visits moved (or is an artefact, rejected by shape). Each one is compared with SkyBoT for that
  image's exact time. A known asteroid passes when position, brightness and shape checks pass; with two or more sightings
  its measured motion is also compared with SkyBoT's. Its proof card shows crops at three visits plus one where it is gone.
- **Time machine** steps through every image (24), **Blink** is a flip-book through one epoch's images or all of them, and
  a **film strip** under the slider shows every image (green border: a known asteroid was caught there).
- Tests: `test/stack.test.js` (median stack, shape, single-visit sources) and `test/multi.e2e.js` (2 epochs x 6 images,
  a moving known asteroid confirmed in both epochs, a hot pixel never reported, a one-image glint gone from the stacks).

## v0.5 (Asteroid Proof Card)

Every change the Analyst finds now gets a proof card with two zoomed crops (same sky spot in both epochs, one shared
brightness scale) and checks with a tick or a cross:

- **Position:** within 12″ (2 SPHEREx pixels) plus SkyBoT's own error of where SkyBoT predicts the known object at that image's time.
- **Brightness:** SkyBoT V 19 or brighter. SPHEREx reaches about AB 18.4 per channel at 2 µm only after all four sky
  passes (Crill et al. 2025, arXiv:2404.11017), so one image cannot show fainter objects.
- **Shape:** anything on the sky is blurred by the telescope, so a real object cannot be sharper than the stars in the
  same image (side neighbours / peak, compared with the stars' median).
- Labels: **Confirmed known asteroid** (all pass), **Near a known object, but not a match**, **Likely artefact**, **Unconfirmed**.

Why: on field RA 189.957, Dec −4.182 the old code labelled the 922σ change "2007 TW295". The proof card shows the truth:
that asteroid is 36.9″ away and V 23.3 (too faint), and the "change" is one hot pixel (shape 0.07; stars 0.42). It is
now a likely artefact, not an asteroid. `test/replay.e2e.js` replays that real field offline from a slice of the cache.

Also: all six detector wavelength tables are built in (first load of a field now needs 2 to 3 downloads instead of up to
16), cutout cache keys are rounded (no duplicate downloads), Aladin Lite is pinned to 3.8.2 and its coordinate box no
longer covers the title, and known objects outside the compared square are drawn faint.

## v0.4 (speed and offline demo)

- **11x less data to the browser.** An IRSA cutout is ~6.4 MB, of which ~4.9 MB is a PSF cube the app never uses. The server
  keeps only IMAGE, FLAGS, ZODI and WCS-WAVE (~1.1 MB, byte-for-byte, still valid FITS) and gzips it (~0.6 MB). Measured on a
  real QR2 cutout: 6.42 MB -> 1.08 MB -> 0.58 MB. This matters most when the app runs on a server and visitors are far away.
- **Disk cache** in `cache/` (limit `SKYSHIFT_CACHE_MB`, default 8000): cutouts and archive / SkyBoT / Horizons / name
  results. A field loads instantly the second time. **Offline demo:** if IRSA or the internet fails, results already in the
  cache are served (marked `stale`), so load your demo fields once before presenting.
- **Parallel:** up to 8 downloads at once (`SKYSHIFT_UPSTREAM`), the browser asks for all epochs together, two requests for
  the same cutout share one download, and after a run the other epochs are prefetched so the Time machine slider is instant.
- The terminal shows a speed line per download; `http://localhost:8080/api/health` shows totals and cache size.

## v0.3 (checked on real SPHEREx data)

Diagnosed with a debug bundle of real QR2 cutouts (RA 189.93, Dec 4.86, May 2025 vs June 2026). Result on that field:
**50 fake changes (v0.1) -> data check passes, 0 near misses, 2 unconfirmed changes.** `node test/real.test.js` reproduces this.

- **Bad pixels.** The fake "moved" sources were single glitch pixels (cosmic rays, readout errors), up to 1000x brighter than
  their neighbours, all marked in SPHEREx's FLAGS extension. The app now masks them. The bit names (`MP_OUTLIER = 19`...) are
  long `HIERARCH` keywords, which the FITS reader used to skip; it reads them now, and reads FLAGS as exact integers.
  Glitches are filled from their neighbours; saturation, bleeding, halos and optical ghosts are left blank. Changes next to a
  repaired pixel are not reported ("not judged").
- **Alignment by stars.** Epochs are registered by the median offset of matched bright stars (iterated). On real data: 70 stars,
  offset 0.03 px, scatter 0.12 px. The old cross-correlation said 0.2 px, which was itself the error.
- **Same colour, full coverage.** Every image of a detector has the same nominal band, so v0.2 picked an arbitrary one per
  epoch (3.58 vs 3.82 um, and the later image covered only half the field). The archive query now also returns each image's
  footprint (`spherex.plane.poly`, hex WKB; corners = detector pixels (0,0), (2039,0), (2039,2039), (0,2039)). From it the app
  predicts, before downloading, where the field falls on the detector, how much of the field the image covers, and the real
  wavelength there (WCS-WAVE table; D4 is built in, other detectors are learned from their first cutout). Checked on 4 real
  images: detector position within 10 px, wavelength within 0.006 um. The Color slider now means the real colour at that spot.
- Report and labels show the measured or predicted wavelength, coverage, alignment method and the prediction check.
- v0.3.1: on detectors whose wavelength map is not built in (seen live on D5 at RA 228, Dec -8) the first download teaches the
  map and changes the best images; the comparison could run before the better images were loaded and wrongly say "nothing
  changed". Now the Aligner loads until the choice is stable, re-registers on the final epoch-1 image, images are ranked by
  their predicted wavelength (stable), and the Analyst refuses with an error if an epoch is missing. `test/real.e2e.js`
  scenario 2 reproduces it with all 59 real D4 footprints of the test field and the built-in map removed.

## v0.2 (validity fixes after the first live run)

The first live run (RA 230, Dec 4.2) listed 50 "moved" sources at 18 to 66 arcsec/yr. No star moves that fast (Barnard's star,
the fastest, is about 10.4 arcsec/yr), so those were artefacts of the two epochs not lining up. v0.2:

- **Physics limit.** Between epochs, a source is only paired as "moved" if a star could move that far in the time between the
  images (11 arcsec/yr). For epochs months apart that is under one pixel, so pairing is off and only sources that appear or vanish are listed.
- **Data check.** If many sources seem to jump 3 to 12 px (at least 5, and at least 5% of matched sources), the epochs do not line
  up (wavelength, detector or distortion differences). The Analyst then reports **no** changes and says why, instead of false alarms.
- **Difference-image detection.** Changes are peaks of B-A / A-B, ignored only when a source in the other epoch at the same spot is at
  least as bright (or within 5 px and 5x brighter). A new object next to a star is no longer swallowed by it.
- **Edge mask.** Nothing within 4 px of the footprint edge is reported.
- **Debug bundle.** On a local run, *Save debug bundle* (Agents panel) writes the downloaded cutouts, the archive search and the report
  to `debug-cutouts/<time>/`. The route answers only requests from this computer; set `SKYSHIFT_PUBLIC=1` on any public host to turn it off.

## Things to know (v0.1-v0.8)

- Written against the public docs. It was **not run against the live IRSA, SkyBoT or Horizons services** from the
  build sandbox, which could not reach them. If something fails, the status line shows the upstream error.
  First things to check: the cutout query syntax, and whether SPHEREx QR2 is in the TAP tables yet.
- Epochs only appear once SPHEREx has covered that spot more than once and IRSA has released it.
- One SPHEREx image is one narrow wavelength slice. Epochs are compared at the closest real wavelength available at that spot
  (usually within a few hundredths of a micron), so stars cancel well but not perfectly in Difference view.
- Rings are **known** objects from orbit catalogues, not detections in the pixels. Nothing here finds new objects.
- SkyBoT positions assume a geocentric observer. SPHEREx is in low Earth orbit, so close objects can be off by about an arcminute.
- Compressed (tile-compressed) FITS and non-TAN projections are rejected with a clear message.
- `server.js` only proxies `https://irsa.ipac.caltech.edu/ibe/...` for cutouts. It is not an open proxy.
- Planet X is hypothetical and is not searched for. The Motion lab is a teaching toy, not data.

## Files (v0.1-v0.8)

```
server.js          proxy + static server
lib/fits.js        FITS reader, WCS, reprojection, stretch (browser + Node)
lib/parsers.js     CSV / Sesame / SkyBoT / Horizons parsers
lib/wave.js        per-pixel wavelength (WCS-WAVE table) and wavelength-matched pairing
public/index.html  UI (same look as the first version)
public/app.js      viewer logic
test/test.js       offline tests
```
