# ARCNAVE v0.54.0 → v0.55 audit (Step 1: nothing changed yet)

Date: 2026-11-07. Only a backup was made: `public/` → `public-backup-0.54.0/` (180 files, 23.8 MB).
"Before" screenshots: `redesign-docs/ui-after/0.55.0/before/`.

---

## 1. Feature list confirmed against the code

Everything on your list exists. Where it lives today:

| # | Feature | Where now (file : function / id) |
|---|---|---|
| 1 | RA/Dec input, name search | `#sf` / `#q` (index.html), `runAgents` (app.js) |
| 1 | Whole-sky map, smooth flight, FOV | `#wsky`, `flyTo` (app.js), `#csize` |
| 1 | QR2/QR3 from IRSA + S3, demo-cache, prewarm, Images per epoch | `loadFrame` / `loadViaS3`, `lib/s3cut.js`, `#prewarm`, `#ipe` (Advanced) |
| 1 | Time machine, Blink, Swipe, Difference, Changes (+ explained), play bar | tabs `[data-m]` in `#g-watch`; `#hud` (arc.js). **There is no separate "Stack" tab**: stacking is "Images per epoch" + the median stacks behind Difference/Changes |
| 1 | 102 bands / 6 detectors, Color slider | `#band`, `#lam`, presets (Advanced) |
| 1 | Flags overlay with counts | `#flagsb`, `flagCanvas` |
| 1 | Release name + newest image date | `releaseOf` / `dataNote` (app.js), status bar `#trel` |
| 2 | 5 NASA targets (`#ct=`), thumbnail cards | `CHALLENGE`, `runChallenge`; landing `#lp-start` + `#lp-targets`; panel `.chips` |
| 2 | Two bundled examples | `#intro [data-ex=proof|false]` |
| 3 | Spectra on the fly, Compare passes, CSV | `#specb`, `spectrumAt`, `specPass`, `showSpectrum` |
| 3 | Light curve + 3 comparison stars, CSV | `#lcb`, `lightCurve`, `lcBlock`, `lcSvg` |
| 3 | Deep view per detector + false colour | `#deepb`, `deepView`, `deepComposite` |
| 3 | Brightness test | `#brighttest` (local runs), Tested drawer |
| 4 | Gaia DR3 + Measure its motion | `#gaiab`, `drawGaia`, `showGaia`, `gaiaMeasure` |
| 4 | WISE / CatWISE2020 | `#cwb`, `/api/catwise`, `drawCw`, `showCw`, `cwMatch` |
| 4 | Known asteroids (SkyBoT + MPC), track arrows, unknown dots never linked | `/api/movers`, `insideEpochs`, `drawAsteroidPaths` |
| 4 | Aladin (usage ping off), Ecliptic, Base sky | `#aladinl`, `#ecl`, `#survey` (both Advanced) |
| 5 | Watch it move (v0.41), measured track (v0.44), 🔍 🔭 ◐ 🎯 (v0.45-0.49), frame-by-frame (v0.46) | Changes → "Watch it move" row (built in `renderChgPanel`), star cards, `trackAcross`, `frameFit` |
| 6 | 🎬 film, spotlight, P-circles, measured/predicted | `movieStart`, `drawMovie`, `movieCard`; `#mvb` + Watch it move row |
| 7 | Agents, Hide Planet X + shift-and-stack, Map this field, Motion lab | `#agents`, `[data-m=px]`, `#pxmap`, `[data-m=lab]` (Advanced) |
| 7 | Null test, scorecard, Tested drawer, limits, Milky Way warning | `#nulltest`, `#scorecard`, `#tb` → `#tdrawer`, `inPlane()` |
| 8 | Discovery card + GIF, share link, embed, check-it links, Send / Copy report, Copy Python, report JSON | `#dcard` → `#dcd`, `#share`, `#embb`, `candReport`, `#pyb`, `downloadReport` |
| 9 | Story + guide in 4 languages + Listen, game, quick start, glossary, About, PWA | `tour.js`, `#playb`, arc.js `TERMS`, `about.html`, `manifest.webmanifest` |
| 10 | Speed (v0.15, v0.52), workers | `prep-worker.js`, `workerJob`, lib/fits.js |
| 11 | Honest labels | `MS_LABEL`, `msLabel`, "Planet X is hypothetical" in status bar |

**On your list but worth naming separately** (so nothing gets lost in the move): Swipe view, Motion lab, Map this field
(Planet X map), JPL Horizons track (asteroid card), Asteroid Proof card, Examples intro (`#exb`), high contrast (`#hc`),
Clear view (`H`), Quick start tips, "Words used here" glossary (`[data-gloss]`), report JSON download, spectrum and
light-curve CSV, whole-sky map key.

---

## 2. Challenge objectives → where in the tool today

| Challenge asks | ARCNAVE today | Gap |
|---|---|---|
| Enter RA / Dec | `#q` search box (RA Dec or a name), `#ra=…&dec=…` | none |
| Image series "like a little video" | Time machine + play bar, Blink, 🎬 film | none |
| Spot moving objects | Changes, known asteroids, 🔍 🔭 ◐ 🎯, film | hard to find: 4 of the 5 searches are only in Changes → Watch it move |
| Test on Barnard, Eps Indi B, WISE 0855, RW Aur, R Dra | 5 target chips/cards, `#ct=` | landing numbers partly out of date (below) |
| New data releases | archive asked live, release name shown | no "check for new data"; server ignores `stale` flag |
| 102 bands, sum 6 arrays | Color slider, Deep view (6 detectors + false colour) | false colour only inside Deep view, not on the sky |
| Spectra on the fly | Spectrum (+ per pass, CSV) | none |
| Add / subtract epochs | stacks (Images per epoch), Difference, Changes | none |
| User-chosen field of view | `#csize` 0.25 / 0.5 / 1° | none |
| Gaia / WISE overlays | Gaia, WISE (CatWISE2020) | none |
| URL coordinates, embed | `#ra/#dec/#ct/#fov…`, `?embed=1`, Copy embed | none |
| Contamination flags, metadata | Flags + counts, image line, release | flags not checked on mover positions (U6) |
| Astropy / Aladin | Copy Python (Astropy + astroquery), `tools/astropy_check.py`, Aladin Lite | none |

---

## 3. Landing page today

Sections, in order (index.html:80-304):

1. **Sticky nav:** Explore, How it works, Test targets, Science, About; a language select (en, ta, hi, es); Launch.
2. **Hero:** headline, Launch, Try Barnard's Star, and the real blink of asteroid 3865 Lindbloom (GIF on a canvas).
3. **#lp-start:** 5 target thumbnail cards.
4. **#lp-science:** 3 fact cards.
5. **#lp-how:** 4 steps.
6. **#lp-find:** 5 kinds of object.
7. **#lp-targets:** 5 "expected vs measured" cards.
8. **Superpowers:** 12 cards.
9. **Story timeline:** 1900s → 2025.
10. **Honest limits.**
11. **Final CTA.**
12. **Footer.**

Translations live in `arc-i18n.js`: 141 keys, complete in ta, hi and es. 11 keys are stale.

**Problems found**

- **Numbers out of date or missing**
  - Eps Indi B shows 4.4″ measured / 4.7″ expected. That is the v0.33 two-pass, one-year value. The v0.54 film gives 5.9″ south-east over 515 days and 4 passes.
  - WISE 0855 shows only its brightness (AB 17.15, 11.8σ). Its motion is missing: 8.82 ± 1.10″/yr, with CatWISE 7.94″/yr agreeing.
  - R Dra never states the 1.24 mag at 0.85 µm.
  - Light curves say "up to 36 images" while the RW Aur card says 49.
- **Version mismatch:** the footer says v0.37.0-redesign, the tool says v0.54.0.
- **Duplicates and length**
  - The 5 targets appear twice (#lp-start and #lp-targets).
  - Launch appears 4 times; Barnard can be opened from 4 places.
  - 10 blocks follow the hero, including a 12-card grid.
- **Four card styles** (`.tc2`, `.lp-tc`, `.lp-card`, `.lp-sp`). The left-over "Look 2" violet CSS (arc.css:778-861) is overridden but still shipped; some rules are dead.
- **Missing from the landing:** WISE overlay, the film with P-circles, WISE 0855's motion, the 4 mover searches, and a data-source strip.
- **No light theme.** Dark only; high contrast is the only alternative.
- **Reduced motion is respected everywhere,** but read once only (not re-checked if the setting changes).

---

## 4. Tool today

**Layout**
- Header: brand, search, Find the asteroid, Examples, Tour menu, Learn, Tested, Clear view, ◐, language.
- Left panel: Where → Compare → When → Colour → Overlays → Measure → Test → Share.
- Right dock: "What am I seeing?", the result card and the Agents.
- Bottom: status bar and play bar.
- Phone: one bottom sheet (peek / half / full), tab bar (Explore / Controls / Learn / Progress / Share), More menu.

**Hidden in Beginner** (`.adv`): Images per epoch, Swipe, colour presets, Ecliptic, Base sky, Motion lab.
Everything else shows in both modes, so **Beginner and Advanced still look alike**: Beginner shows about 30 controls.

**Hard to find**
- 🔍 Find moving stars, 🔭 Deep search, ◐ Slow movers, 🎯 Motion scan and known-asteroid paths have no panel button. They are only in Changes → "Watch it move", which appears after a run.
- GIF only via Discovery card. Measure its motion only from star cards.

**Duplicates**
- Animate (`#mvb` and the Watch it move row).
- Tested (3 buttons).
- Story/guide (Tour menu and intro).
- Targets (panel chips and intro).
- Language select (header and intro).
- Share (`#share` and the phone Share tab).

**Clutter**
- An 80-word Measure note.
- 5 buttons, a note and a link in Overlays.
- The Watch it move row can reach about 10 buttons.
- Notes that are always visible (Planet X, When).

**Selectors other code depends on** (must keep working, or be updated with care):
- tour.js: ~50 selectors, e.g. `#gaiab`, `#specb`, `[data-m=…]`, `.chip.ct`, `#tmr`, `#chg`, `#intro …`.
- smoke.js: ~40 ids, e.g. `#mvb`, `#cwb`, `#dcard`, `#pyb`.
- arc.js quick start: `#sf`, `#g-where .chips`, `#g-watch .tabs`, `.rhead`.
- guidecheck.js: `Tour.*`.

**Plan:** move these elements into their new places; never rename them.

**Keyboard today**
- Space and ←/→ drive the play bar. H is Clear view. Esc closes things.
- The tour's ←/→ only run during a tour, and the play bar skips itself then, so there is no clash.
- There is no B key yet.

---

## 5. Upgrades U1–U9: exists / partial / missing

| | Upgrade | Status | Evidence | What would be built |
|---|---|---|---|---|
| U1 | Light-curve polish | **Partial** | Error bars on the target only (`lcSvg`). Colour = Color slider. Verdict compares scatter only: 3× = "real variability", 1.5× = "possibly" (`lcBlock`) | Error bars on comparison stars; a detector choice in the card; a χ² test of the target against its own errors, scaled by the comparison stars → "varies at Nσ" / "steady" |
| U2 | Spectrum per pass | **Exists** | `specPass`, per-pass legend and shapes, "Change between passes", "Compare with Pass N" | Surface only: a clearer "per pass" toggle |
| U3 | Detector colour composite | **Partial** | `deepComposite` (D1-2 blue, D3-4 green, D5-6 red), inside the Deep view card only | Show that composite on the sky as a view, with a band legend (reuses `deepComposite`) |
| U4 | Measured vs catalogue on mover cards | **Partial** | Film card: "Measured here (x ± y″/yr); Gaia/WISE agrees". Deep/diff lists put μ ± σ next to Gaia. `gaiaMeasure` / `cwMeasure` compare displacement only; `ffCard` has no badge | One shared "SPHEREx μ ± σ vs catalogue μ ± σ → agrees / differs / unchecked" row (`msLabel` rule) in Gaia, WISE, track and film cards |
| U5 | Export | **Partial** | Discovery-card GIF (`makeCard`, gif-worker), spectrum CSV, light-curve CSV, report JSON, Copy Python. No film export, no PNG, no mover CSV | Film → GIF (reuse `encodeGif`, frames from `drawMovie`); PNG snapshot of the sky; CSV/JSON of the film's movers (passes, positions, μ ± σ, label). WebM only if you want it (MediaRecorder, no library) |
| U6 | Flags on mover positions | **Missing** | `flagCanvas` / `touchedHard` exist; no card checks a mover's position | "N of M passes have flagged pixels at this position" warning on mover and film cards |
| U7 | Data-release panel | **Partial** | `dataNote`, status `#trel`; search cached 1 day; stale copies are served but the page ignores `stale` | A small panel: releases loaded, pass dates, cache age, "Check for new data" (re-asks the archive) |
| U8 | Help: tooltips + glossary | **Partial** | 26 `title`s, `data-tip`; glossary has proper motion, epoch, SNR…; parallax only in the Learn drawer | Add brown dwarf, variable star, parallax, measured vs predicted to the one glossary; "?" next to Advanced section titles |
| U9 | Polish | **Partial** | `#wait` + `.rskel` skeleton; no Cancel for 🔍 🔭 ◐ 🎯 (Spectrum/Light curve "Close" acts as cancel); Space ←/→ H, no B | A Cancel on every search card (the run counter pattern already used); B = Blink; skeleton in search cards |
| — | Light theme | **Missing** | dark only (`color-scheme: dark`) | A light token set, toggled next to ◐; sky images stay dark |

---

## 6. Wireframes

### 6a. Landing page, desktop (1440)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ ARCNAVE   How it works  Features  Test targets  Tested  About      [EN ▾]  [ Launch ARCNAVE ]│  sticky
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  NASA SPACE APPS 2026 · PLANET X AND SPHEREX                    ┌───────────────────────────┐ │
│  Watch the sky change.                                          │ REAL FILM · BARNARD'S STAR│ │
│  Find what moves.                                               │   ○P1 ─ ○P2 ─ ●P3  13.0″ N│ │
│  Real NASA SPHEREx images of any spot, played as a film,        │   (spotlight screenshot)  │ │
│  with honest checks against Gaia and WISE.                      │ ◀ blink / film toggle ▶   │ │
│  [ ▶ Launch ARCNAVE ]  [ ☆ Try Barnard's Star ]                 └───────────────────────────┘ │
│  ┌ RA Dec or name ──────────────┐[Go]   ✓ real IRSA images · free · no sign-up · phones      │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ DATA FROM  NASA SPHEREx/IRSA · ESA Gaia DR3 · NASA WISE/CatWISE2020 · IMCCE SkyBoT · MPC · CDS │  text strip,
│            images          star motions    brown dwarfs         asteroids                Aladin│  "used for"
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ HOW IT WORKS   ① Enter coordinates   ② Watch the passes play   ③ Spot movers, check honestly  │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ NASA'S FIVE TEST TARGETS  (one section: the two today are merged)                            │
│ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐                                  │
│ │ thumb    ││ thumb    ││ thumb    ││ thumb    ││ thumb    │  RA/Dec · what to look for ·     │
│ │ Barnard  ││ Eps Ind B││ WISE 0855││ RW Aur   ││ R Dra    │  ✓ real result · [Open in tool]  │
│ └──────────┘└──────────┘└──────────┘└──────────┘└──────────┘                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ FEATURES (7 groups, one line + "Try it")                                                      │
│ [Watch it change] [Find movers] [Measure] [Overlays] [Planet X & agents] [Share] [Learn & play]│
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ CHOOSE YOUR MODE   ┌ Beginner: 3 steps ┐  ┌ Advanced: every tool ┐                             │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ TESTED IN THE OPEN  18 fields · false-alarm test · Astropy check · limits →                  │
│ SPHEREx FACTS       102 bands · whole sky every 6 months · 0.75–5 µm · launched 2025 (sources)│
│ LEARN & PLAY        90-second story · guide · Find the asteroid · Hide Planet X               │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ footer: credits · challenge · team · v0.55.0 · about · limits · ↑ top                        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Cut or merged:**
- The two target sections become one.
- "What is SPHEREx?" becomes the facts strip.
- "Moving things you can find" and the 12 Superpowers merge into the 7 feature groups.
- The timeline moves into Learn & play (one line each).
- Honest limits fold into "Tested in the open".

### 6b. Landing page, phone (390)

```
┌──────────────────────────────┐
│ ◉ ARCNAVE        [EN] [☰]    │  ☰ opens the links + Launch
├──────────────────────────────┤
│ Watch the sky change.        │
│ Find what moves.             │
│ one line                     │
│ [ ▶ Launch ARCNAVE         ] │
│ [ ☆ Try Barnard's Star     ] │
│ ┌ RA Dec or name ─────┐[Go]  │
│ ┌──────────────────────────┐ │
│ │ real film / blink        │ │
│ └──────────────────────────┘ │
│ data sources (2 lines, wrap) │
│ ① ② ③ (stacked)              │
│ targets: horizontal list,    │
│ one row each with thumbnail  │
│ features: 7 rows             │
│ Beginner / Advanced          │
│ tested · facts · learn       │
│ footer                       │
└──────────────────────────────┘
```

### 6c. Tool, desktop

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ← Home ◉ ARCNAVE v0.55 │ [RA Dec / target ▾][Go] FOV[0.5°▾] │ [Beginner|Advanced] [Share] [EN] ⋯│
├───────────────┬──────────────────────────────────────────────────────────┬───────────────────┤
│ BEGINNER      │                                                          │ WHAT AM I SEEING? │
│ ① Pick a spot │                                                          │ result card:      │
│   targets ×5  │                 SKY (large)                              │ "Barnard's Star   │
│   whole sky   │          film / spotlight / P-circles                    │  moved from … to  │
│ ② Watch it    │                                                          │  …: 13.0″ north"  │
│   [🎬 Play the│                                                          │ [Show details ▾]  │
│    film]      │                                                          │───────────────────│
│   Time·Blink· │                                                          │ Agents (folded)   │
│   Changes     │ ┌ ◀ ▶ ‖  ───●──────────── 2026-08-17 · pass 3 · QR3 · 1× ┐│                   │
│ ③ Read result │ └────────────────────────────────────────────────────────┘│                   │
│ Tours · Game  │                                                          │                   │
├───────────────┴──────────────────────────────────────────────────────────┴───────────────────┤
│ RA 269.447° · Dec 4.767° · λ 4.47 µm · pass 3 of 3 · images 24 · QR2+QR3 · Planet X is hypothetical│
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Advanced** replaces the left column with collapsible sections. Every existing control moves in; none is renamed:

```
▸ Images & epochs   tabs (Time, Blink, Swipe, Difference, Changes), images per epoch, Flags, play
▸ Bands & spectra   Color slider + presets, Spectrum, (U3 composite)
▸ Measure           Deep view, Light curve, brightness test →
▸ Motion            🎬 film, 🔍 Find moving stars, 🔭 Deep search, ◐ Slow movers, 🎯 Motion scan, known paths
▸ Overlays          Gaia, WISE, Ecliptic, Base sky, Aladin
▸ Planet X & agents Hide Planet X, Map this field, Motion lab, agents, false alarms →
▸ Share & report    Copy link, embed, Python, Discovery card / GIF, (U5 exports)
```

The Motion searches get panel buttons for the first time. They call the same functions as the Watch it move row,
which stays.

### 6d. Tool, phone

```
┌──────────────────────────────┐
│ ← ◉  [RA Dec / target ][Go]⋯ │  ⋯ = More (mode, share, language, tours…)
├──────────────────────────────┤
│                              │
│        SKY (film)            │
│                              │
│ ◀ ‖ ▶ ───●── pass 3 · QR3    │  play bar, as today
├──────────── sheet ───────────┤  peek / half / full, as today
│ result card / controls       │
├──────────────────────────────┤
│ Explore Controls Learn Prog. Share │  tab bar, as today
└──────────────────────────────┘
```

---

## 7. Decisions I need from you before Part A

1. **Barnard on the landing page.** The spec asks for "13.0″ north in 361 days". That number is the frame-by-frame fit
   on a **saturated** star: 13.2 ± 1.4″/yr, while the catalogue says 10.4″/yr. Two other measurements are closer:
   v0.44 track 9.4″, card 9.7″. I suggest showing **9.4″ north in 361 days (catalogue 10.3″)** and naming the film value
   as rough. OK, or keep 13.0″?
2. **Eps Indi B on the landing page.** Should 5.9″ south-east over 515 days (4 passes, v0.54) replace 4.4″ over one
   year (v0.33)? Both are real, with different baselines. I suggest 5.9″ with "515 days".
3. **Team name for the footer.** I won't invent one. What should it say?
4. **Data-source strip:** text only, no logos (NASA/ESA logo rules). OK?
5. **Hero picture:** a real film screenshot (Barnard, P-circles, spotlight), with the existing real Lindbloom blink as a
   toggle. OK?
6. **Light theme:** build it now for landing + tool (sky images stay dark), or leave it for later?
7. **Landing sections:** merge the two target sections and fold the 12 Superpowers into 7 feature groups, as in 6a?
8. **U5 WebM:** GIF only (reuses the existing encoder), or also WebM through the browser's own MediaRecorder (no
   library)?

**Order after your OK:** Part A landing → screenshots + checks → your OK → Part B layout → checks → your OK → U1, U3, U4,
U5, U6, U7, U8, U9, then light theme (U2 is surface-only).
