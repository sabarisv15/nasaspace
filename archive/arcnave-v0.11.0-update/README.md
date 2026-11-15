# ARCNAVE

Real SPHEREx images in a sky viewer, with known movers. Needs Node 18+ and internet. No npm install.

```
node server.js        # then open http://localhost:8080
node test/test.js     # offline tests (synthetic FITS, parsers, guards, server with mocked network)
node test/wave.test.js
node test/real.test.js # REAL SPHEREx data (test/fixtures): bad pixels, alignment, data check, wavelength prediction
node test/e2e.js      # headless browser test (needs Playwright + Chromium)
node test/real.e2e.js # the whole app in a browser on the real fixtures
node test/change.test.js # Changes view maths (epoch colours, time colours, artefacts)
node test/examples.e2e.js # both examples open from demo-cache, offline
node test/psf.test.js # empirical PSF + fake injection, on real SPHEREx images
node test/psf.official.test.js # ARCNAVE PSF vs the official SPHEREx PSF (slow, ~3 min)
```

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

## How it works

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

## What changed in v0.8 (Changes view: see what changed, by epoch and by image)

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

## What changed in v0.7 (real-data check of the 24-image mode)

Checked on 24 real SPHEREx images of field RA 189.957, Dec −4.182 (3 epochs x 8, detector 6, 4.45 to 4.95 µm):
- Every image aligned on 29 to 53 stars (scatter 0.06 to 0.16 px). Noise of one image 0.037; of an 8-image stack 0.014 to 0.018.
- Comparing single images gave 2 "changes" (the 922σ C1 and a 22σ C2). Comparing the 8-image stacks gave **0**: C1 is in
  1 of 8 images of its epoch (1249σ there, 3.5 to 8.6σ in the other 7), C2 in 1 of 8 (30σ, others under 2.5σ).
- Known asteroid 3865 Lindbloom (V 16.7) shows at its SkyBoT position (21.5σ in one exposure, 7.6σ in the exposure taken
  minutes before). The SPHEREx pipeline flags those pixels MP_OUTLIER, which earlier versions repaired as glitches.
  OUTLIER-only pixels are now kept in a second copy of each image (`flatKeep`) that is shown and searched for movers; the
  comparison images still repair them. A sighting counts when it repeats in the other exposure of the same visit
  (a cosmic ray hits one exposure only).

## What changed in v0.6 (8 images per epoch)

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

## What changed in v0.5 (Asteroid Proof Card)

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

## What changed in v0.4 (speed and offline demo)

- **11x less data to the browser.** An IRSA cutout is ~6.4 MB, of which ~4.9 MB is a PSF cube the app never uses. The server
  keeps only IMAGE, FLAGS, ZODI and WCS-WAVE (~1.1 MB, byte-for-byte, still valid FITS) and gzips it (~0.6 MB). Measured on a
  real QR2 cutout: 6.42 MB -> 1.08 MB -> 0.58 MB. This matters most when the app runs on a server and visitors are far away.
- **Disk cache** in `cache/` (limit `SKYSHIFT_CACHE_MB`, default 2000): cutouts and archive / SkyBoT / Horizons / name
  results. A field loads instantly the second time. **Offline demo:** if IRSA or the internet fails, results already in the
  cache are served (marked `stale`), so load your demo fields once before presenting.
- **Parallel:** up to 8 downloads at once (`SKYSHIFT_UPSTREAM`), the browser asks for all epochs together, two requests for
  the same cutout share one download, and after a run the other epochs are prefetched so the Time machine slider is instant.
- The terminal shows a speed line per download; `http://localhost:8080/api/health` shows totals and cache size.

## What changed in v0.3 (checked on real SPHEREx data)

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

## What changed in v0.2 (validity fixes after the first live run)

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

## Things to know

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

## Files

```
server.js          proxy + static server
lib/fits.js        FITS reader, WCS, reprojection, stretch (browser + Node)
lib/parsers.js     CSV / Sesame / SkyBoT / Horizons parsers
lib/wave.js        per-pixel wavelength (WCS-WAVE table) and wavelength-matched pairing
public/index.html  UI (same look as the first version)
public/app.js      viewer logic
test/test.js       offline tests
```
