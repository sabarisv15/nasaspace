# ARCNAVE v0.37.0-redesign

This is a redesign of the look, layout, navigation, copy and motion. Features, API routes, data processing, science code
and numbers are unchanged. `server.js`, `public/app.js`, `public/i18n.js`, `public/about.html` and `lib/*` are untouched.

## Run and test

PowerShell, from `D:\ARCNAVE-SPHEREX\ARCNAVE-REDESIGN` (Node is not on PATH on this PC, so use the portable copy):

```
$env:PORT = 8083; & D:\ARCNAVE-SPHEREX\node\node-v24.20.0-win-x64\node.exe server.js
```

Then open:
- http://localhost:8083/ shows the landing page. "Launch ARCNAVE" opens the tool.
- http://localhost:8083/#ct=barnard opens the tool directly (also `epsindb`, `wise0855`, `rwaur`, `rdra`).
- http://localhost:8083/#ra=190&dec=-4&load=1 opens a shared view directly.
- http://localhost:8083/?embed=1#ct=barnard is embed mode (try it in a 640x420 and a 390x300 window).
- Offline unit tests: `& D:\ARCNAVE-SPHEREX\node\node-v24.20.0-win-x64\npm.cmd test`

## What changed

**Landing page (new, first open only).** Sticky glass nav, a hero with a real blink of ARCNAVE's own SPHEREx frames
(asteroid 3865 Lindbloom), "What is SPHEREx?", "How ARCNAVE works" in 4 steps, "Moving things you can find", the 5 NASA
targets with expected vs measured values and "Open in ARCNAVE" deep links, a superpowers grid, the story timeline (Lowell,
Tombaugh, Planet Nine, Backyard Worlds, SPHEREx), "Honest limits", and a footer with data credits and the AI-use link. It
is in all 4 languages. It never shows for hash links or `?embed=1`; this is decided in `<head>` before first paint.
In-page links scroll and never write a hash.

**Design system (`public/arc.css`).** Replaces the six layered inline style blocks (v0.11 to v0.28) with one tokenised
file. It holds colour, type, space, radius, shadow and z-index tokens. Inter is used for the interface, Space Grotesk for
headings and JetBrains Mono for numbers. Buttons, chips, segmented controls, tabs, cards, drawers, tooltips, toasts and
progress share one style. Icons are one inline SVG set. The logo reuses the existing icon mark, so the favicon, app icons
and the on-page logo match.

**Tool shell.**
- Left panel: controls are grouped by task: **Where / Watch / Overlays / Measure / Test / Share**. The 5 NASA target chips
  are inside the panel. A Beginner/Advanced switch defaults to Beginner, and the setting is remembered. The panel can be
  collapsed.
- Right panel: **What am I seeing?** with a friendly empty state, the result card and agent progress. It widens for
  spectrum and light-curve cards.
- Status line: RA, Dec, wavelength, epoch and FoV as before. New: the number of images, the passes with their months, and
  the data release with the newest image date (QR3 highlighted).
- Plain-words tooltips on RA, Dec, λ, epoch, FoV, images, passes, QR, stack and field of view. A **Words used here**
  glossary covers arcsecond, proper motion, SNR/σ, AB mag, mag, saturated and candidate.
- **How sure are we?** appears under every result badge. Its wording mirrors the labels in the Tested drawer.
- First-time **Quick start**: 4 skippable tips, shown once and in 4 languages. Tour menu → Quick start replays it.
- Phones: the viewer is on top, with one bottom sheet and a thumb tab bar (**Explore / Controls / Learn / Progress /
  Share**). Touch targets are at least 44 px. There is no sideways scroll at 360-430 px.
- Embed: minimal chrome, a compact readout, the NASA SPHEREx/IRSA credit and "Open full ARCNAVE".
- Loading card: shimmering progress bar, plain-words status and time left (the app's own estimates).
- Reduced motion is respected everywhere: no star-field animation, the still image instead of the GIF, and no reveals.

**Small changes outside the new files.**
- `public/tour.js`: the guide's Whole sky, Base sky, Ecliptic and Share steps now open the Controls sheet on phones first,
  because those controls moved into the panel. These are 4 one-line changes.
- `public/manifest.webmanifest`: new name, description and colours.
- `public/index.html`: the markup is reorganised. Every ID, `data-*` hook and class used by `app.js` and `tour.js` is
  kept (checked: none missing, no duplicates).

## Honesty note on the landing numbers

The brief asked for RW Aurigae +0.19 mag and R Draconis 0.33-0.35 mag. Both were **withdrawn in v0.37.0** because they
were measured on saturated pixels. The landing page shows the app's current values instead: RW Aur "change likely", with
a 1.1 mag range against comparison-star scatter of 0.04-0.18. R Dra brightened 0.41 mag, then 0.91 mag by 14 Nov 2025.
Each card carries a "Corrected 29 Oct 2026" line.

## Files

Changed: `public/index.html`, `public/tour.js`, `public/manifest.webmanifest`.
New: `public/arc.css`, `public/arc.js`, `public/arc-i18n.js`, `CHANGELOG-redesign.md`, `redesign-docs/`. That folder holds
the do-not-break checklist, the pre-redesign copies of `index.html` and `tour.js`, and the before/after screenshots.

## Lighthouse (12.6.1, headless Chrome, local server, 2026-10-29)

| Page | Performance | Accessibility | Best practices | SEO | FCP / LCP / TBT / CLS |
|---|---|---|---|---|---|
| Landing, mobile | 83 | 100 | 100 | 100 | 3.3 s / 3.6 s / 0 ms / 0 |
| Landing, desktop | 95 | 100 | 100 | 100 | 1.1 s / 1.1 s / 0 ms / 0.001 |
| Tool `#ct=barnard`, mobile | 25 | 100 | 96 | 91 | 7.7 s / 24.5 s / 12.3 s / 0.013 |

The first landing audit scored 29 for performance. The page was starting the whole sky viewer (2.4 MB Aladin Lite, WebGL,
app boot) behind it, which blocked a throttled phone CPU for 14 s. Fixes:
- The start page loads none of the tool's scripts. They are prefetched once the page is idle, and they run on "Launch"
  (`arc.js` `loadTool`). Hash links and `?embed=1` still load them during parsing, exactly as before.
- Google Fonts load without blocking (the weights are cut to the ones used).
- The tool underneath is hidden while the start page is open, which removed a 0.21 layout shift.
- Two small accessibility and SEO items: the footer heading order, and the scale bar's ARIA role.

The tool page scores low for performance because of what it does. It downloads ~19 MB of real SPHEREx data and runs the
WebGL sky viewer. That loading is the app's own data processing, which the brief says not to change. Its
"errors-in-console" item is Aladin Lite's WebGL panicking in headless Chrome; the original page shows the same errors.
Reports are in `redesign-docs/lighthouse/` (HTML and JSON).

## v0.37.1 features (Deep view, light curves), 2026-10-30

This copy already had the v0.37.1 code (`deepView()` and `lightCurve()` in `public/app.js`; `package.json` 0.37.1). The
redesign had put the **Deep view** button behind "Advanced", so it was hidden in the default Beginner mode. Now:
- **Deep view** shows in Beginner mode (Measure group). The Measure note explains Deep view and where the **Light curve**
  buttons are: a star's spectrum card, and the R Draconis and RW Aurigae cards.
- The landing "Superpowers" grid has three new cards, in all 4 languages: Deep view (with the measured Barnard field
  result, noise ÷1.7 to ÷2.6 per detector), Light curves (up to 36 images plus 3 steady comparison stars), and Tested in
  the open (18 fields).
- Checked live:
  - **Deep view, Barnard field, pass 3 (Aug 2026):** 36 images in 227 s; noise ÷1.6 to ÷3.5 per detector (ideal ÷2.4).
  - **Light curve, R Draconis, 0.85 µm:** 10 images (outer glow) in 45 s; change 1.24 mag; comparison stars 0.13, 0.12,
    0.78 mag.
- **Light curve button** in the Measure group (2026-10-30). Press it, then tap a star. It runs app.js's own light curve
  (`spectrumAt` with `lcOnly`, the same route as the R Draconis and RW Aurigae cards) at the colour on the Color slider.
  Checked live on R Draconis at 0.85 µm: the same result as the target card's button (10 images, 1.24 mag change,
  comparisons 0.13 / 0.12 / 0.78). Spectrum still behaves as before.
- Main folder compared read-only on 2026-10-30, by checksum: no changes newer than this copy.

## Look 2 (2026-10-30): inspired by the visual style of resonant-planet.vercel.app

Only the visual language is borrowed, none of that site's content or branding: black space, a centred full-screen hero,
pill badges, a violet → cyan → green gradient headline, a violet → blue primary button, outline buttons, centred
section titles and violet-tinted cards. ARCNAVE's own background:
- An **eclipse** whose glowing rim is drawn in SPHEREx's spectral colours (the same 0.75 → 5 µm hue scale as the images).
- One star in the field **blinks between two spots** like a blink comparator. It is decorative, not data.

The real asteroid GIF moved to a new "See it move" section under the hero. The tool picks up the same accent: gradient
buttons and selected tabs, and colour-coded group icons. All new strings are in 4 languages, there is no sideways
scroll at 390 px, and the target results are unchanged. Files: `public/arc.css` (one appended block), `public/index.html`
(hero), `public/arc.js` (star field), `public/arc-i18n.js`. Screenshots: `redesign-docs/screenshots/after-look2/`.
- **Glowing Measure/Overlay buttons (2026-10-30).** The buttons in the Measure, Overlays and Share groups get a light
  violet glow on hover and a gradient glow while on: Spectrum or Light curve armed, Gaia or Flags shown. Spectrum, Light
  curve and Deep view stay lit while their own result card is on the right, and go dark when the card changes.
- **Right panel, no gap (2026-10-30).** When a result card was open, the Agents list was capped at 36 % of the screen, so
  it was cut mid-list and the bottom of the panel stayed empty. Now the card takes up to 60 % of the panel and Agents
  fills the rest, scrolling inside it with a soft fade at the bottom. Checked at 1918x828: with the Deep view card open,
  Agents runs from the card to the panel's bottom edge and the whole list fits.
- **Meteor shower on the start page (2026-10-30).** Shooting stars cross the landing background from the upper right
  towards the lower left, every 1-3 s, sometimes three together. They have glowing tails in violet, cyan, blue and amber.
  They are decorative, not data, and drawn on the existing star-field canvas (`public/arc.js`). They are off when the
  device asks for reduced motion and never shown over the sky viewer, where only real images belong. Checked with a 20 s
  simulation (no bad values, at most 4 at once) and live. Screenshot: `after-look2/landing-meteor-shower.jpg`.

## Beginner and Advanced, made clearly different (2026-11-02)

Before, Beginner hid only 6 small items, so the two modes looked the same. Now:
- **Beginner:** the main tools as numbered steps (1 Where → 6 Share), with bigger buttons and short notes. It shows:
  - Run agents here, Whole sky map and the 5 NASA targets;
  - Time machine, Blink and Difference;
  - the Color slider with the one-tap Dust & Ice / Hot stars / Cool worlds presets (these used to be Advanced-only);
  - Gaia;
  - Spectrum, Light curve and Deep view;
  - Hide Planet X and the Tested drawer;
  - Copy link;
  - λ, epoch, images, passes and data in the status line.
- **Advanced:** adds 16 tools and settings, each marked with a violet dot:
  - Field of view and Images per epoch;
  - Swipe and Changes;
  - Flags, Ecliptic, Base sky and the Aladin link;
  - the full Measure notes;
  - Motion lab and Map this field;
  - Copy embed code and Copy Python;
  - the Auto-run switch;
  - RA, Dec and FoV in the status line.
- **Both modes:**
  - A line under the switch says which mode you are in, and switching shows a short message.
  - A tool that is on (a selected view, Gaia or Flags shown) never hides when you go back to Beginner.
  - The guided tour still shows every tool.
- **Files:** `public/index.html` (classes and two notes only; no ID or hook changed), `public/arc.css` (the level block)
  and `public/arc.js` (the message).
- **Checked:**
  - 1440x900 desktop and 375x812 phone, with no sideways scroll in either mode;
  - the tour, in Beginner mode;
  - Flags turned on while switching to Beginner.

## v0.40.0 UI upgrade, Stage 1: design tokens and landing (2026-11-02)

The concept is "a mission-control observatory for everyone". Audit, tokens and before/after screenshots are in
`redesign-docs/UI-UPGRADE.md`. The backup is `D:\ARCNAVE-SPHEREX\ARCNAVE-BACKUP-before-ui`.

- **One palette, one meaning per colour** (last block of `public/arc.css`).
  - Deep navy layers.
  - One **infrared** accent (#ff7a45) for the brand and for everything you can press.
  - Status colours for results only.
  - The older teal and violet names now point at these tokens, so the tool follows too.
  - The science colours that `app.js` draws (orange = now, cyan = before) are untouched; `app.js` uses no colour tokens
    except `--dust`.
- **Fonts:** Noto Sans Tamil and Noto Sans Devanagari join the stacks. They download only when Tamil or Hindi text is on
  screen; the language menus use the system font so they don't trigger it.
- **Landing hero:**
  - The real SPHEREx blink of asteroid 3865 Lindbloom sits beside the headline, in an observatory frame.
  - One primary button (Launch) and one secondary (Try Barnard's Star).
  - The decorative eclipse is removed.
  - On a phone the blink comes straight after the two buttons, so the first screen shows real data.
- **"Start here":** NASA's five targets as large cards. Each has a real thumbnail (ARCNAVE's own view of that target's
  images in `demo-cache`, saved by headless Chrome, 6-8 kB each), one plain line, the honest badge and "Open in ARCNAVE".
  On a phone they become a one-tap list. New text is in Tamil, Hindi and Spanish (`public/arc-i18n.js`).
- **Lighter page.**
  - The hidden tool is no longer laid out under the start page (`content-visibility`).
  - The star field draws at ~24 fps and pauses when scrolled away. Its glow is painted once, and the meteors use a
    gradient head instead of shadowBlur.
  - The blink plays on a canvas from the GIF's own frames where the browser supports ImageDecoder; other browsers get
    the GIF swap as before.
  - The tool scripts are prefetched when the visitor points at or touches a Launch or target button, or reaches the
    targets, instead of after 4 s.
- **Version:** v0.40.0 (`package.json`, header label).
- **Checked** in headless Chrome at 1440x830 and 390x844, in en/ta/hi/es:
  - no page errors and no sideways scroll;
  - all 5 thumbnails load;
  - the WISE 0855 card opens its result (18.7 s); Launch opens the tool (6.9 s);
  - the blink plays (5 frames in 2.7 s).
- **Lighthouse mobile, landing:**

  | | Performance | Accessibility | Best practices | SEO | Total blocking time | Page weight |
  |---|---|---|---|---|---|---|
  | Before | 49 | 100 | 100 | 100 | 2,680 ms | 650 KiB |
  | After | 60 | 100 | 100 | 100 | 840 ms | 692 KiB |

  LCP is 3.7 s in both. Desktop after: 91.

## v0.40.0 UI upgrade, Stage 2: result view and controls (2026-11-03)

- **Playback bar on the image** (`public/arc.js`, `#hud`): previous / play-pause / next, a scrubber with the month each
  pass starts, the date of the image on screen ("2026-05-11 · Image 43 of 43 · pass 3"), and key hints.
  - It drives the existing `#tm` slider with the same `input` event a drag sends, so app.js does all the work.
  - Space plays and ← → step (not while typing, in a tour or in the game).
  - Hidden in Changes and Hide Planet X (they use every image at once), on the start page and in embeds.
  - On a phone it is a compact bar above the sheet at peek height, hidden at half and full height.
- **Panel regrouped** as Where → Compare → When → Colour, numbered 1-4 in Beginner, then the tool groups. Every ID is
  unchanged: `#tmr`/`#strip` moved to When, `#bandr`/`#lam`/presets to Colour, and the tabs stay in `#g-watch`, now
  titled Compare. In Changes the When group says why there is no slider.
- **Result card:**
  - A paragraph that starts with a bold lead-in gets it as a small label above the text, so a long card reads as short
    sections. The words are app.js's own.
  - Badges carry a symbol as well as a colour: ✓ seen (green, solid), ≈ marginal / likely artefact (amber, dashed),
    ? unconfirmed candidate (light blue, dashed).
- **Header:** the game button uses the one accent instead of a second green.
- **Fixed while checking:**
  - The page marker class was first named like the bar and broke the layout; it is now `has-hud`.
  - Month labels closer than 12 % of the track keep their tick but drop the text (a pass of 3 images among 43).
  - The selected tab is no longer bold, so it doesn't widen.
- **Checked** in headless Chrome at 1440x830 and 390x844:
  - WISE 0855 opens (20.2 s / 14.6 s).
  - Play moves the image, → steps, Space plays; in Difference the bar shows the two passes; in Changes it hides and the
    note shows.
  - No sideways scroll and no page errors.
- **Guide check** (`public/dev/guidecheck.js`): phone 30 of 30 steps fully on screen. Desktop: every one of the 30 steps
  has its tool on screen. On step 14 (Changes) the 613 px Changes panel is 59 % visible under the tabs, because tabs,
  help and panel need 801 px of a 738 px panel. It measures exactly the same with the v0.39.1 stylesheet swapped in, so
  this is not new. It is listed for Stage 4.

## v0.40.0 UI upgrade, Stage 3: loading states and charts (2026-11-04)

- **Loading card** (`#wait`):
  - The four phases show as steps (Find images · Download · Known objects · Deeper stacks), with the current one lit
    from app.js's own `WAIT.phase`.
  - The progress bar is the infrared gradient with a moving sheen.
  - A "While you wait" fact changes every 8 s. All 7 facts are true and come from the app's own text: 102 colours /
    6 months, Tombaugh 1930, Barnard's Star ~10″ a year, 6.2″ pixels, WISE 0855 ~0 °C and 7.4 light years, launched
    March 2025, images kept for next time.
  - Title, time and time-left are still written by app.js.
- **Right dock while the agents work:** instead of "Pick a place in the sky", a skeleton report shows the working
  agent's own name and message ("Archivist · Searching the IRSA archive…") and a fact. CSS follows `#alist .ag.run`;
  the result card replaces it as before.
- **Progress bars in cards:** any "Reading 12 of 126…" / "Measuring 4 of 36…" line (spectrum, light curve, deep view)
  gets a bar under it, filled from the numbers in that line, and removed when the line goes.
- **Charts** (app.js SVG, spectrum and light curve):
  - Bigger labels: 13 units (about 12 px on screen, was about 9 px), and 14 units on phones. The narrow y axis uses
    10.5 / 11 so its numbers and title don't touch.
  - A dark plot panel, and a shimmer placeholder while the chart is still empty.
  - **A readout:** point at a dot, or tap near it on a phone (26 px reach), to read its numbers, e.g.
    "1.75 µm · 0.0126 ± 0.096 mJy (under 3× the noise) · pass 2, 2025-11-10". The hovered dot is ringed.
  - **app.js change (markup only):** each spectrum and light-curve point carries its own numbers as `data-v` and an
    SVG `<title>` (screen readers and native tooltips). The colours (pass 1 orange, 2 violet, 3 cyan; this star pink,
    comparison stars grey) and every measurement are unchanged.
- **Checked** in headless Chrome at 1440x830 and 390x844:
  - The skeleton shows while agents work and goes when the result arrives.
  - The loading card shows steps and a fact.
  - A real WISE 0855 spectrum (65 points) gives the readout at both sizes.
  - The card progress bar was seen on a live read (3 % at the start).
  - All 60 synthetic test points have `data-v` and a `<title>`, and the readout works by mouse and by touch.
  - No page errors.
- **Fixed while checking:**
  - On touch the readout vanished at once (a finger lifting also counts as "leaving"); it now stays until the next tap
    or a scroll.
  - The larger axis text touched the y-axis numbers; fixed with the smaller y-axis size above.
- **Not yet checked live:**
  - a light curve finishing with its readout (NASA's archive was very slow during this stage: an R Draconis archive
    search took over 150 s);
  - the R Draconis "Its spectrum" read.

  Both go into the Stage 4 tests.

## v0.40.0 UI upgrade, Stage 4: phones, accessibility, final tests (2026-11-05)

- **Phone header in one row (62 px, was ~104 px):** logo, search, **More**. More opens the other header buttons as a
  two-column menu; a choice, a tap outside or Escape closes it. It opens by itself while a tour step points at one of
  its buttons. Every button keeps its ID and handler. The app's frame caption is no longer half hidden under the header.
- **Phone tap targets:** every control on screen is at least 44 px tall (tabs, chips, segmented buttons, selects, strip
  images, the play bar).
- **View tabs:** a little tighter, so Time machine · Blink · Difference · Changes fit one row.
- **Accessibility:**
  - One focus ring everywhere.
  - The phone High contrast button gets its words in the More menu.
  - Accessibility stays 100 on Lighthouse (landing and tool).
- **Phone guided tour:** arc.js re-checks while a step is open whether its tools fit a half sheet. If not, it opens the
  sheet fully, and it re-centres the next step's tools when the sheet goes back to half. Without it, step 13 (Changes)
  was 50 % visible after the tighter tabs.
- **Landing speed:**
  - The star-field loop read the scroll position every frame, which forced a page layout each time; it now uses the
    value its scroll handler already keeps, and a cached window height.
  - The header measurement no longer runs while the start page covers the tool; it runs when the tool appears.
  - The 4× slowed-CPU profile went from about 10 s of forced layout in 8 s down to almost none.
- **Charts:** the y axis is back to its original 10-unit size (10.5 on phones), so its numbers never touch its rotated
  title. The rest of the chart text stays larger.
- **robots.txt** added (allow all). There was none.
- **Final checks** (all in `redesign-docs/UI-UPGRADE.md`, section 3):
  - smoke.js 29 of 29, 0 page errors.
  - guidecheck: phone 30 of 30 fully on screen; desktop 30 of 30 tools on screen, with step 14 at 59 % (same as
    v0.39.1).
  - The 5 targets open from their landing cards and play.
  - Embed 640x420 and 390x300 from another origin work.
  - Copy Python copies 50 lines.
  - A live light curve and spectrum give their readouts.
- **Lighthouse mobile:**
  - Landing performance 49 → **75** (blocking time 2,680 → 0-40 ms).
  - The tool page stays at 17.
  - Accessibility and Best practices stay 100.

## v0.41.0: watch it move (motion replay), and Changes points to it (2026-11-05)

A new feature in app.js (one block at the end, `replayAsteroid`, `replayAcross`, `replayPlayer`), plus buttons. Nothing
that is measured changed.

- **Asteroid track replay, within one pass.** A known asteroid's frames, in time order:
  - every loaded image of that pass in which its catalogue position (SkyBoT / MPC for that image, otherwise estimated
    from the catalogue's speed and direction, and labelled so) falls inside the field;
  - the same spot at up to 2 visits before and 2 after, where it is not there ("Not here at this time", with how far
    its catalogue motion puts it).

  What each frame shows:
  - + = catalogue position;
  - dashed green circle = where the Analyst actually found it ("seen ✓");
  - a dashed path with a dot per frame.

  All frames share one brightness scale. Play / pause / step, 0.8 s per frame.
  - Example field (RA 189.957, Dec −4.182), 3865 Lindbloom, pass 3: 30 May not here (catalogue motion puts it about 42′
    away), 31 May not here (about 35′), 5 Jun 16:17 UTC seen ✓, 5 Jun 16:23 UTC seen ✓. 17.6″ per hour toward the east.
- **Motion across passes,** for a star or brown dwarf that stays in the field for years. Each pass's aligned image, + =
  where its catalogued proper motion puts it at the middle of that pass. Measured live:
  - Barnard's Star: 3 passes, 10.3″ (1.67 SPHEREx pixels) in 361 days.
  - Epsilon Indi B: 4 passes, 6.6″ in 515 days.
  - WISE 0855: 3 passes, 7.9″ in 355 days.
- **Not built, on purpose:**
  - No asteroid across passes. It leaves the field within hours to days, and the next pass is six months later.
  - No tracks for unknown dots. v0.32 found no real 3-dot tracks, and two dots can always be joined.

  Both are said on the cards.
- **Where to find it:**
  - **Changes:** a new "Watch it move" row: ☄ each known asteroid in the changes · its track, and ✦ the challenge target
    · across passes.
  - The asteroid proof card and a known-asteroid change card: **▶ Replay its track**.
  - The Barnard's Star / Epsilon Indi B / WISE 0855 cards: **▶ Its motion across passes**.
  - A Gaia star card when it moves at least 1.5″ between the first and last pass: **▶ Its motion across passes**.
- **Checked** in headless Chrome at 1440x830 and 390x844: all four replays above open, step and play, with no page
  errors. Screenshots: `redesign-docs/ui-after/replay/`.
- **Regression checks on v0.41.0:**
  - smoke.js 29 of 29, 0 page errors.
  - guidecheck: phone 30 of 30 fully on screen; desktop 30 of 30 tools on screen, with step 14 Changes at 59 % (unchanged).
  - The "Watch it move" row is hidden during the guided tour. It first pushed step 14 down to 51 %; the step explains the
    kinds of change, not the replay.

## v0.42.0: known asteroids, where they went, and why "0" (2026-11-05)

A user saw "0 Known asteroid passing by" and suspected SkyBoT was down. Checked live:
- SkyBoT answered directly (8 s, 133 lines).
- The MPC checker was reachable (1 s).
- ARCNAVE's `/api/movers` returned 126 known objects for a fresh field near the ecliptic. MPC answered first because
  SkyBoT took longer than the 5 s hedge, as designed.
- No SkyBoT failures in the server log.

So the services work. A "0" means none was caught, mostly because nearly all catalogued asteroids are fainter than one
SPHEREx image shows (V 19). The card did not say so. Now:

- **The Known card says why** (Changes → Explained), with the numbers from the same per-pass lookups as the lines below:
  - "123 known crossed, 0 caught: 2 bright enough, not detected", or "all too faint (brightest V …)";
  - "None crossed this field";
  - "Lookup failed: SkyBoT and the MPC did not answer. Run again later."

  It stays tappable at 0.
- **Known paths per pass** (tap Known, or "☄ All known paths (N)" in the Watch it move row). Each known object the
  catalogue lists in each pass gets a line from where its catalogue speed and direction put it at the pass's first image
  to its last, with an arrowhead, in that pass's colour:
  - solid: SPHEREx caught it (a confirmed sighting);
  - dashed: bright enough but not detected;
  - very faint: fainter than V 19.

  Only paths that cross the images count (the lookups reach a little beyond the corners). A caught asteroid that wasn't
  in the pass's first lookup gets its line from its own sightings. Lines are never joined from one pass to the next:
  each pass, six months apart, has different objects. The card lists each pass: how many known, which were bright
  enough, and caught ✓ / not detected.
- **Checked live** at 1440x830 and 390x844, no page errors:
  - Example field 190 −4: 213 known crossed the images; 4 bright enough (brightest V 16.4); 1 caught. Pass 3 lists
    3865 Lindbloom (V 16.7, caught ✓) and 4281 Pounds (V 18.6, not detected).
  - Ecliptic field 56.75 +24.1: 123 crossed, 0 caught, 2 bright enough but not detected. Pass 1: 31, all too faint;
    pass 2: 1999 VS12, V 19.0; pass 3: 1991 VA1, V 18.6. SkyBoT answered every lookup.
- **Screenshots:** `redesign-docs/ui-after/known-paths/`.
- **Regression checks on v0.42.0:**
  - smoke.js 28 of 29, 0 page errors. The miss was "Embed 640x420 loads": it timed out at 121 s (its limit is 120 s).
    Re-tested on its own right after: the embed loads at 640x420 in 45 s and at 390x300 at once, with the credit bar.
  - guidecheck: phone 30 of 30 fully on screen; desktop 30 of 30 tools on screen, with step 14 Changes at 59 %
    (unchanged).

## v0.43.0: Aurora teal theme, and the three weak points (2026-11-05)

- **Theme: Aurora teal** (chosen by the team).
  - The accent tokens of the v0.40 design system are remapped: teal `#2dd4bf` for everything you can press (buttons,
    selected tab, a tool that is on), with lighter tints `#5eead4` / `#99f6e4`, a teal → cyan gradient, dark text on teal
    (`#032321`), cyan `#67e8f9` for focus and links, and a white → teal → cyan headline.
  - "? Unconfirmed candidate" moves from light blue to violet (`#c4b5fd`), like the app's own "?" kind, so it never looks
    like the accent.
  - The star-field glow and the motion replay's markers are teal too.
  - Image and chart science colours are unchanged.
  - All in the last blocks of `public/arc.css`, plus 3 canvas colours in arc.js / app.js.
- **Chart passes no longer depend on colour alone.**
  - Spectrum points: pass 1 ●, pass 2 ■, pass 3 ▲ (repeating), filled when above 3× the noise, hollow below, as before.
    The legend shows the same shapes.
  - Light curves: comparison stars are hollow grey rings (were small grey dots), next to this star's filled pink dots.
- **Desktop tour, step 14 (Changes):** while the guided tour runs, the kind cards show their names only (the tour card
  explains them), so the tabs and the Changes panel fit the control panel together.
- **Tool page on phones:**
  - Lighthouse's breakdown (4× slowed CPU): app.js's science pipeline (decoding the real FITS images, aligning them,
    finding changes) is about 88 s of script, and the Aladin WebGL sky about 46 s. Neither is changed here; that needs a
    separate decision (for example, moving the pipeline to a background worker).
  - What was waste is fixed: the tool page no longer downloads and decodes the landing page's 358 kB blink GIF. It starts
    only when the start page is really shown.
- **Checked on v0.43.0:**
  - smoke.js **29 of 29**, 0 page errors.
  - guidecheck: **desktop 30 of 30 fully on screen** (step 14 fixed; it was 59 % since v0.39.1); phone **30 of 30**.
  - Embed: 640x420 in 37.6 s, 390x300 at once.
  - Landing: 4 languages, no sideways scroll, the WISE 0855 card opens.
  - A real WISE 0855 spectrum: pass 2 drawn as squares, legend matches, and the readout works.
- **Lighthouse mobile** (it varies run to run on this PC; every run is listed):
  - Landing: performance 61 / 69 / 75, Accessibility 100, Best practices 100, SEO 100.
  - Tool page `#ct=barnard`: performance 25 / 25 / 17 (17 before), Accessibility 100, Best practices 100, SEO 92.
  - One run had Best practices 96 from a brief DNS failure for fonts.googleapis.com (`ERR_NAME_NOT_RESOLVED`); the
    re-run was 100.

## v0.43.1: SkyBoT answers again on this network (server.js, 2026-11-05)

**Problem:** the team saw known objects coming from the Minor Planet Center, not SkyBoT.

**Measured:** SkyBoT works from the team's network (valid answers, the server's own parser reads them: 97, 23, 155 and 93
objects on 4 fields), but each answer takes 4.6-10.1 s. The server sent the MPC checker the same question after 5 s
and took whichever answered first. It also ran only 4 SkyBoT lookups at a time, and the 5 s clock ran while a lookup was
still waiting in that queue. In a run of 20-30 lookups the MPC won almost all, and a single answer over 20 s paused
SkyBoT for 2 minutes.

**Changed in `server.js`** (defaults only, each still set by an environment variable):
- SkyBoT may run 6 lookups at a time (`SKYSHIFT_SKYBOT_MAX`).
- The MPC is asked only if SkyBoT has not answered 12 s after the request was actually sent (`SKYSHIFT_SKYBOT_HEDGE_MS`).
  Time spent waiting for a free slot no longer counts; at most 45 s in all.
- SkyBoT's timeout is 30 s (`SKYSHIFT_SKYBOT_TIMEOUT_MS`).
- The breaker pauses 1 minute after a first failure (then 3, 10, 20; was 2, 5, 10, 20).

**Checked:** 24 fresh, uncached lookups at once through `/api/movers` (like one agents run): SkyBoT answered 22, the
MPC 2, none failed, 51 s for all 24. Answers are kept 30 days, so a field opened again answers at once. The MPC still
takes over whenever SkyBoT is slow or down.

## v0.44.0: the measured track across passes, "from here to there" (2026-11-05)

ARCNAVE now **measures** where a moving star or brown dwarf is in every pass (before, the replay only marked where the
catalogue expects it) and says in plain words where it moved.

- **"▶ Track its motion across passes"** (Barnard's Star and Epsilon Indi B cards, a fast Gaia star's card, and the
  Changes "Watch it move" row):
  - Every pass's aligned image is compared with pass 1 by the same patch-sliding measurement that gives Barnard's Star
    9.7″ on its card (`ctShift`, 0.1-pixel steps, images lined up on the stars).
  - Pass 1 is the catalogue position; every later position is pass 1 plus the measured shift.
  - **The card says:** "Barnard's Star moved from RA 269.44635°, Dec +4.76719° (pass 1, Aug 2025) to RA 269.44583°,
    Dec +4.76976° (pass 3, Aug 2026): 9.4″ toward the north in 361 days. Its catalogued motion predicts 10.3″." Then a
    line per pass with measured and expected shift.
  - **On the sky:** a dot per pass (white = pass 1), a numbered tag per pass, an arrow from the first pass to the last,
    and one label with the result and the dates.
  - **In the replay:** a dashed circle at the measured position in each frame, next to the catalogue +.
- **WISE 0855** is too faint for this patch method and says so; its motion stays measured by the two-source fit on its
  card.
- **Measured live:**

  | Target | Pass 2 | Pass 3 | Pass 4 | Total | Catalogue |
  |---|---|---|---|---|---|
  | Barnard's Star (3 passes) | 6.3″ (exp. 5.9″) | 9.4″ (exp. 10.3″) | | 9.4″ north, 361 days | 10.3″ |
  | Epsilon Indi B (4 passes) | 1.7″ (2.0″) | 4.4″ (4.7″) | 6.2″ (6.6″) | 6.2″ south-east, 515 days | 6.6″ |

  Directions match the known motions. Desktop and phone, no page errors. Screenshots: `redesign-docs/ui-after/track/`.

## v0.45.0: automatic motion search, "🔍 Find moving stars" (2026-11-05)

ARCNAVE can now look for moving stars by itself, across every pass of a field, instead of only following a star you
pick.

- **Where:** Changes view, "Watch it move" row, first button "🔍 Find moving stars" (shows whenever a field has 2 or
  more passes; after a search it reads "🔍 Moving stars (N)").
- **How it works:**
  1. Up to 120 bright, isolated stars are found in pass 1. Stars too near the edge, or with a brighter star within
     5 px, are skipped.
  2. Each star's patch is slid over every later pass in 0.25-pixel steps, then 0.05-pixel steps, using the same
     matching as the star cards. A best match at the edge of the ±2.5 px search is thrown away.
  3. The shift that all stars share (left-over alignment) is removed per pass. The stars' own scatter is measured as
     a robust median.
  4. A star counts as moving only when all of these hold:
     - it moved at least 2″;
     - it moved at least 5x the scatter;
     - every pass matched well (correlation 0.9, or 0.85 for very bright stars whose saturated core changes shape);
     - every pass moved the same way.
- **Gaia check (honest labels, never "discovery"):**
  - "✓ Known mover (Gaia agrees)": a Gaia DR3 star moved to the pass date is within 6″ and its motion agrees. For
    bright stars the measured centre can sit on the rim of the blanked saturated core, so the match may reach 15″,
    25″ below G 9 and 40″ below G 6, but only when Gaia's motion agrees in size and direction.
  - "Unconfirmed candidate: no Gaia star here": for example a star too faint for the G < 18 catalogue.
  - "Gaia says it hardly moves": likely a blend or an artefact.
  - Also: "differs from Gaia", or "unchecked" when Gaia did not answer.
  - Gaia stars that should have moved at least 2″ but were not flagged are listed as missed, so nothing is hidden.
- **On the sky:** an arrow per flagged star (green = known, violet = candidate, amber = Gaia disagrees). Clicking an
  arrow or "▶ Track" opens the measured track from v0.44.
- **Measured live:**

  | Field | Stars measured | Scatter | Flagged | Missed |
  |---|---|---|---|---|
  | Barnard's Star | 120 | 0.31″ | 9.4″ north, known (Gaia predicts 10.3″) | 0 |
  | Epsilon Indi B | 87 | 0.83 to 0.94″ | Eps Indi A, 9.0″ SE, known (6.6″); Eps Indi B, 6.2″ SE, candidate (not in Gaia G < 18) | 0 |
  | Example 190 −4 | 87 | 0.83 to 1.11″ | none | 0 |
  | WISE 0855 | 16 | 0.84 to 0.94″ | none | 0 |

  Each search takes 1 to 4 s; desktop and phone, no page errors. Screenshots: `redesign-docs/ui-after/motion-search/`.
- **Limit:** Epsilon Indi A (G 4.3) is so saturated that its search shift (9.0″, from the rim peak) and its track
  (4.4″, measured at the Gaia position) differ from each other and from the catalogue's 6.6″. It is flagged and labelled
  correctly, but numbers for stars this bright are rough.
- **Code:** a new block at the end of `public/app.js` (`msShift`, `motionSearch`, `showMotionSearch`, `msTrack`,
  `drawMotionSearch`), one line in the sky-click handler, the "Watch it move" row, and `.mslist` in `arc.css`. Science
  code, data fetching, caching and URL-hash behaviour are unchanged.

## v0.46.0: frame-by-frame track, every image lined up on Gaia (2026-11-06)

The research report `reports/Moving star tracking methods.md` ranked seven steps. This version builds the first three.
The track of a moving star is now measured in **every image of every pass**, not only once per pass.

1. **Every image is lined up on Gaia DR3 by itself.**
   - Gaia stars (G 10.5 to 17, with a known motion) are moved to that image's own date and fitted in the image.
   - A small affine correction (shift, rotation, scale) is fitted with 3-sigma clipping, using up to 60 stars per image
     (a plain shift below 12 stars).
   - Typical scatter is 0.35 to 0.45″ per star, which matches the pipeline's published 0.1 to 0.4″ accuracy.
2. **The star is fitted in every image.**
   - The fit is a Gaussian integrated over each pixel (Levenberg-Marquardt, 9x9 window), solving for position, flux,
     width and background.
   - Blank pixels (flagged, or a saturated core) are left out. A saturated star is fitted on its wings only (13x13
     window), and its error is doubled.
   - Errors come from the fit and the left-over scatter, plus the image's Gaia registration error.
3. **One straight line is fitted through the passes.**
   - The images of a pass (about two weeks) are repeat measurements. They are averaged with weights, after dropping any
     more than 2″ and 4σ from the pass median, and their scatter gives the error.
   - Gaia's parallax is taken off when known: the Gaia star at that place, or a target's own value (Epsilon Indi B uses
     Gaia DR3 274.84 mas of Epsilon Indi A, the same system).
   - A weighted straight-line fit gives the motion, its error and a χ² test (99% limit).
   - **Labels:** "Motion measured" (5σ and on a straight line), "No significant motion", "Two-pass displacement only"
     (no straight-line test is possible with two passes) and "not on a straight line: check by eye". Never a discovery.
- **Card:** a "Frame by frame" box under the track, with a table per pass (images used, east and north offsets from pass
  1, error) and how it was measured.
- **Sky:** a small dot per image coloured by pass, a circle per pass (its error) and the fitted line (dashed). Drawn when
  zoomed in below 0.6°.
- **Measured live:**

  | Star | Images used | Fitted motion | Catalogue | χ² (limit) |
  |---|---|---|---|---|
  | Barnard's Star (saturated) | 15 of 20 in 3 passes | 12.7 ± 1.4″/yr north (9σ) | 10.39″/yr | 2.9 for 2 (9.2) |
  | Epsilon Indi B | 32 of 32 in 4 passes | 4.22 ± 0.18″/yr south-east (23σ) | 4.68″/yr | 9.9 for 4 (13.3) |
  | 22 still Gaia stars (G 11 to 14, 3 fields) | all | 0.06 to 0.84″/yr, all "No significant motion" | ~0 | all under the limit |

- **Parallax direction checked:**
  - Barnard's Star: χ² is 2.9 with Gaia's parallax taken off, 11.2 without it and 25 with it reversed.
  - Epsilon Indi B: χ² is 9.9 taken off, 12.7 without it and 27 reversed.
- **Speed:** about 1.5 s per track. The registration is cached per image.
- **Limits:**
  - Barnard's Star is saturated, so its fit is rough (1.7σ from the catalogue).
  - Epsilon Indi B comes out 2.5σ under its catalogue value, so the errors may be a little small.
  - Ranks 4 to 7 (deep-stack detection, difference images, a trial-motion scan, CatWISE/2MASS) are not built yet.
- **Code:** a new block at the end of `public/app.js` (`psfFit`, `gaiaReg`, `plxFactor`, `plxOf`, `frameFit`, `ffCard`,
  `drawFrameFit`), one line in `trackAcross`, one in `trackCard`, one in the frame hook, `plx` on the Epsilon Indi B
  target, and `.ffbox` / `.fftab` in `arc.css`. Science code, data fetching, caching and URL-hash behaviour are unchanged.

## v0.47.0: deep search, every image (2026-11-06)

This builds rank 4 of the research report: detect on a deep stack of all the images, then measure each source in every
image.

- **Where:**
  - Changes view, "Watch it move" row: "🔭 Deep search: every image" (after a search it reads "🔭 Deep search (N)").
  - The 🔍 moving-stars card also has the button.
- **How it works:**
  1. **Stack:** every loaded image of every pass, lined up on pass 1, becomes a significance map ((value − median) / σ).
     The maps are summed and divided by √N, which goes about √N deeper than one image (32 images: about 5.7x).
  2. **Sources:** found on the stack down to 5σ, up to 500, isolated (no brighter source within 3 px). A slow mover
     smears by under 3 px over the passes, so it is still found.
  3. **Measurement:** each source is measured frame by frame with the v0.46 method. A frame counts only when the source
     has S/N ≥ 3 in it, and every pass must see the source in at least 2 images.
  4. **Self-calibrated threshold:** for sources that do not move, motion ÷ error has a median of 1.18. If this field's
     median is larger, its errors are too small, so the 5σ bar is raised by the same factor (Epsilon Indi field: 1.35,
     so 5.7σ).
  5. **Flagged** only when all of these hold:
     - its motion is above that bar;
     - it is on a straight line (χ² under the 99% limit);
     - it moved at least 1″ in total;
     - the fit stayed on the detected source (mean position within 1.5 px; this stops a faint peak in a bright star's
       glow from borrowing the bright star's motion);
     - it is not a second peak of a source already flagged.
  6. **Labels:**
     - Gaia DR3 at the pass-1 date, within 6″ (15″ below G 12). If the Gaia star has a parallax, the source is fitted
       again with it taken off before labelling.
     - "Known mover" when the motions agree within max(3σ, 30%, 0.5″/yr).
     - Otherwise "Gaia says it hardly moves", "a different motion" or "unconfirmed candidate".
     - New: "Known mover: the NASA target", when a source is not in Gaia but matches the field's target and its
       catalogue motion (Epsilon Indi B).
     - Gaia movers that should have moved 1.5″ and were not flagged are counted. Never a discovery claim.
- **Card:** a list with motion ± error, σ, number of images and passes, a badge and "▶ Track". The track opens the v0.46
  "Frame by frame" box.
- **Sky:** a square per flagged source with an arrow along its fitted motion.
- **Measured live:**

  | Field | Images | Sources (seen in every pass) | Bar | Flagged | Time |
  |---|---|---|---|---|---|
  | Epsilon Indi B | 32 | 446 (174) | 5.7σ | Epsilon Indi B, 4.22 ± 0.18″/yr SE, 23σ, known (the NASA target, 4.68″/yr) | 12–15 s |
  | Barnard's Star | 24 | 500 (468) | 5.0σ | Barnard's Star, 13.2 ± 1.4″/yr N, 9.5σ, known (Gaia 10.39″/yr) | 10 s |
  | Example 190 −4 | 24 | 339 (134) | 5.5σ | none | 8 s |
  | WISE 0855 | 43 | 119 (41) | 6.0σ | none | 3 s |

  The same result on phone, no page errors. Screenshots: `redesign-docs/ui-after/deep-search/`.
- **Safeguards seen live:** before the position and duplicate checks, the Epsilon Indi field also flagged a faint peak in
  Epsilon Indi B's glow (it borrowed B's motion). Before the self-calibrated bar, it flagged two faint sources at 5.3σ
  and 5.6σ. All three are now rejected.
- **Limits:**
  - WISE 0855 (about 17 AB at 4.6 µm) is too faint to reach S/N 3 in single images, so the deep search does not find
    it. Its own two-source fit on its card still measures it.
  - Very bright saturated stars (Epsilon Indi A) are better handled by 🔍 Find moving stars.
  - Brown dwarfs are brightest at 3.8–5 µm, so pick that colour before running the agents.
  - Ranks 5 to 7 of the report are not built.
- **Code:**
  - A new block at the end of `public/app.js`: `deepStack`, `dsGaia`, `deepSearch`, `showDeep`, `dsTrack`, `drawDeep`.
  - v0.46's `frameFit` is split into `frameFit` and a reusable `ffCore`, plus `toRaw`.
  - One button in the Changes row, one on the 🔍 card, one branch in the sky-click handler and one call in the frame
    hook.
  - Science code, data fetching, caching and URL-hash behaviour are unchanged.

## v0.48.0: difference-image search for slow movers (2026-11-06)

This builds rank 5 of the research report: same-colour difference images, scored as light-and-dark pairs ("dipoles").

- **Where:** Changes view, "Watch it move" row: "◐ Slow movers: difference images" (after a search: "◐ Slow movers
  (N)").
- **How it works:**
  1. **Pairs:** every colour-matched image of pass 1 against the image of the same slot (same detector, closest
     wavelength) in each later pass, for example 21 pairs over 7 colours and 4 passes.
  2. **Matching** (Bramich 2008, simplest form): the later image is modelled as a 3x3 kernel applied to the pass-1
     image, plus a background. This allows a free brightness scale, blur and a sub-pixel shift. The kernel is fitted
     over the field, without the wings of saturated stars, which would steer it.
  3. **Dipole fit with the pre-image** (Rubin DMTN-007): the star's position, flux and width come from a
     pixel-integrated Gaussian fit to the matched pass-1 image. The difference is fitted as F·[(1+c)·PSF(position +
     shift) − PSF(position)] + background, for the shift and the brightness change c. A first try used slopes from
     neighbouring pixels; it was too crude for stars narrower than a pixel (wrong shifts, false flags), so it was
     replaced.
  4. **Left-over alignment:** taken off per pair, from the median shift of the 15 nearest sources at S/N ≥ 20 (it varies
     across the field).
  5. **Motion:** the colours of a pass are averaged, and a straight line through pass 1 gives the motion. Errors are
     calibrated on sources of similar brightness (S/N bins). The raw errors came out about 3x too small, and this is
     corrected.
  6. **Flagged** only when all of these hold:
     - 5σ after calibration;
     - the motion is larger than any brightness change, and the brightness change is under 30%;
     - on a straight line (with 3 or more passes);
     - at least 1″ in total;
     - no blank pixels, and no star 10x brighter within 5 px;
     - **the frame-by-frame measurement agrees** (v0.46: every image lined up on Gaia, all colours): at least 3σ, within
       60°, and the sizes within 3σ.
     Anything else is reported as a "likely artefact of the subtraction", not as a mover.
  7. **Labels** as in the deep search: Gaia DR3 or the field's NASA target. Never a discovery claim.
- **Card:** a list with motion ± error (calibrated), σ, brightness change, number of passes, a badge, "▶ Track" (the
  frame-by-frame box) and a 60 px thumbnail of the difference (light = there now, dark = there before). Likely
  artefacts are counted.
- **Sky:** a diamond per flagged source, with an arrow along its motion.
- **Measured live:**

  | Field | Pairs | Sources fitted | Flagged | Likely artefacts | Time |
  |---|---|---|---|---|---|
  | Epsilon Indi B | 21 | 277 of 436 | Epsilon Indi B, 4.43 ± 0.19″/yr SE (known: the NASA target, 4.68″/yr; frame by frame 4.22 ± 0.18) | 0 | 10–13 s |
  | Barnard's Star | 16 | 463 of 488 | none (Barnard's Star is saturated, so it is skipped here) | 1 | 11 s |
  | Example 190 −4 | 16 | 274 of 336 | none | 1 | 7 s |
  | WISE 0855 | 8 | 59 | none | 0 | 2 s |

  The same result on phone, no page errors. Screenshots: `redesign-docs/ui-after/diff-search/`.
- **Fix for all cards:** optional parts written as "cond ? part : null" were printed as the word "null" by the browser
  (seen under the new list). The card panel now skips missing parts, which also fixes older cards with the same
  pattern.
- **Limits:**
  - Saturated stars are skipped.
  - Best for motions under about one pixel (6.2″) between passes; faster stars are found by 🔍 and 🔭.
  - The difference method needs the same colour in every pass, so it uses the colour-matched images only.
  - Ranks 6 and 7 of the report are not built.
- **Code:** a new block at the end of `public/app.js` (`dfKernel`, `dfPair`, `dfFit`, `diffSearch`, `dfThumb`,
  `showDiff`, `dfTrack`, `drawDiff`, and the card guard), one button in the Changes row, one branch in the sky-click
  handler, one call in the frame hook, and `.dflist` / `.dfthumb` in `arc.css`. Science code, data fetching, caching and
  URL-hash behaviour are unchanged.

## v0.49.0: trial-motion scan for faint stars (2026-11-06)

This builds rank 6 of the research report: a KBMOD-style trial-motion scan around each source (Whidden et al. 2019).

- **Where:** Changes view, "Watch it move" row: "🎯 Motion scan: faint stars" (after a search: "🎯 Motion scan (N)").
- **How it works:**
  1. **Two maps per pass:** each pass's images are summed in their own noise units (Z), with a count of good images per
     pixel (W). For each source of the deep stack, Psi (the images matched-filtered with the star shape) and Phi (the
     star shape squared over good pixels) are evaluated on a 1/8-pixel grid within ±3 px. The pixel-integrated star
     shape is placed at each fine position itself.
     - A first version interpolated maps made on whole pixels. It could not move a peak off a pixel centre, so every
       motion under a pixel was invisible (Epsilon Indi B came out 0.3″/yr instead of 4.7).
  2. **Trial motions:** the S/N of a track is ν = ΣPsi / √ΣPhi. No pass may count for more than twice the median pass,
     so a glitch or an asteroid in one pass cannot pull a track toward itself.
     - The best "not moving" start is found within ±0.75 px.
     - 625 trial motions within ±12″/yr (1″/yr steps) are tried, from that start and from the stack position.
     - The motion (0.2, then 0.1″/yr steps) and the start (±0.25 px) are then refined in turns.
     - About 20 ms per source; 4–14 s per field.
  3. **Result:** the best trial is the motion. The error comes from the curvature of ν² (ln L = ν²/2), or from the 68%
     region of the coarse trials when the peak is not clean, with a 0.2″/yr floor. The significance is the gain in ν²
     over "not moving", calibrated per S/N bin on the field's own sources (a fixed source gains a median of 1.39 for two
     numbers). The bar is 28.7, i.e. 5σ for two numbers.
  4. **Flagged** only when all of these hold:
     - the source is seen in every pass (S/N ≥ 3) and well seen in at least two (S/N ≥ 5);
     - the motion is inside the scan and at least 1″ in total;
     - no blank (saturated) core, and no star 10x brighter within 5 px;
     - **vacancy test:** where the track ends, the first pass must be nearly empty, and where it starts, the last pass
       too (under half, or at noise level). This stops tracks hopping between two fixed stars. It is skipped when a
       catalogue matches both position and motion, because a real mover can pass right by a fixed star.
  5. **Second opinion:** the frame-by-frame measurement (v0.46) must see the same motion itself (3σ, within 60°, sizes
     within 3σ) whenever it is precise enough to tell. When the source is too faint for it, the result is labelled
     "scan only, needs confirmation".
  6. **Likely artefacts, not shown as movers:**
     - the frame-by-frame measurement disagrees;
     - the brightness changed more than 3x between passes (a variable source or a blend);
     - Gaia measures the star as fixed (Gaia's motions are far more precise);
     - faster than any known star (Barnard's Star, 10.4″/yr) with no catalogue behind it.
  7. **Labels:** the field's NASA target is now checked before Gaia. When the target's catalogue position and motion
     agree, a fixed Gaia star next to it is a neighbour, not its identity. This change also applies to the deep search.
     Never a discovery claim.
- **Card:** a list with motion ± error, σ, track S/N, S/N per pass, the second-opinion result and the label. Each source
  has a 25 x 25 map of the calibrated likelihood of every trial motion (east left, north up, a cross at "not moving"), so
  the bright spot's size is the error. "▶ Track" shows the frame-by-frame box, or the scan's own path when the source is
  too faint for it.
- **Sky:** a circle with a cross per flagged source, and an arrow along its motion.
- **Measured live:**

  | Field | Sources scanned | Flagged | Likely artefacts | Time |
  |---|---|---|---|---|
  | Epsilon Indi B | 414 | Epsilon Indi B, 4.27 ± 0.20″/yr SE, known (the NASA target, 4.68″/yr); frame by frame agrees | 0 | 6–14 s |
  | Barnard's Star | ~470 | none (Barnard's Star is saturated, so it is skipped) | 2 (Gaia fixed) | 13 s |
  | Example 190 −4 | ~330 | none | 2 (Gaia fixed) | 6 s |
  | WISE 0855 | 109 | none | 2 (one brightness, one "too fast") | 5 s |

  The same result on phone, no page errors. Screenshots: `redesign-docs/ui-after/motion-scan/`.
- **Limits:**
  - **WISE 0855:** the scan detects it (track S/N 35) moving 10.3 ± 0.8″/yr west. The direction is right, but the speed
    is 2.8″/yr from its catalogue 8.1″/yr, just outside the agreement window, so it is not labelled. Its first pass has
    only 3 images (S/N 4.5), a fixed star sits beside its path, and the scan does not model parallax (about 0.44″ for
    WISE 0855). The rules were not loosened to make it pass.
  - Saturated stars are skipped (🔍 handles them).
  - Rank 7 of the report (CatWISE2020 / 2MASS cross-match) is not built.
- **Code:**
  - A new block at the end of `public/app.js`: `scMaps`, `scPatch`, `scAt`, `scNu`, `scScan`, `motionScan`, `scHeat`,
    `showScan`, `scTrack`, `drawScan`. Its state is named `TSC`, because `SC` is already used elsewhere.
  - `dsGaia` checks the NASA target first.
  - One button in the Changes row, one branch in the sky-click handler and one call in the frame hook.
  - Science code, data fetching, caching and URL-hash behaviour are unchanged.

## v0.50.0: animate the movers, pass by pass (2026-11-06)

For any field: the moving stars ARCNAVE measured are played as a film through every pass.

- **Where:** Changes view, "Watch it move" row, first button: "🎬 Animate the movers".
- **How it works:**
  1. **Collect the movers** from the searches already run on this field: 🔭 deep search, ◐ difference images, 🎯 motion
     scan and 🔍 bright stars. If none has run yet, 🔍 and 🔭 run first. A star found by two searches is shown once.
     - Positions are measured (frame by frame, each image lined up on Gaia), not taken from a catalogue.
     - For a 🔍 star, the frame-by-frame track is used only when it agrees with 🔍's own measurement; otherwise its
       pass-by-pass patch track. Saturated Epsilon Indi A's frame fit went astray (2.5″/yr east), and its patch track
       gives 3.1″/yr south-east.
  2. **One timer (1.4 s per pass)** steps the sky through the passes in the time-machine view (the first image of each
     pass). Every mover's track grows pass by pass, with a marker gliding to its new place, its number and name. The
     sky zooms so that all movers fit.
     - While the film runs, the other overlays (search arrows, change candidates, target labels) are hidden.
     - Motions of a few ″ are under a screen pixel when zoomed out. The sky paths are then drawn longer by one stated
       factor ("paths drawn 7x longer to be seen, zoom in for true scale").
  3. **The card** shows Play/Pause, ◀ ▶ and Stop; the pass and its date ("Pass 3 of 4 · Apr 2026 · 342 days after the
     first"); and up to 6 cut-outs. Each cut-out is true scale, with the same window and one brightness scale in every
     pass, the measured place in each pass as dots, the track so far and a ring for this pass. The card also lists
     every mover with its motion, the search that found it and its label (known mover / the NASA target / unconfirmed
     candidate).
  4. **A field with no mover** plays its passes with nothing marked and says so ("like most of the sky, every star here
     stays put").
  - Opening another card stops the film. Reduced motion: it does not play by itself.
- **Measured live:**

  | Field | Movers in the film | Sky pass follows the film | Time to start (searches included) |
  |---|---|---|---|
  | Barnard's Star | Barnard's Star, 13.2″/yr N (the NASA target, 🔭) | yes | 14–17 s |
  | Epsilon Indi B | Epsilon Indi B, 4.22″/yr SE (the NASA target, 🔭); Epsilon Indi A, 3.1″/yr SE (Gaia, 🔍, saturated: rough) | yes | 21–30 s |
  | Example 190 −4 | none: the passes play with nothing marked | yes | 15 s |

  The same on phone, Stop works, no page errors. Screenshots: `redesign-docs/ui-after/movers-film/`.
- **Code:** a new block at the end of `public/app.js` (`MOVIE`, `movieMovers`, `movieShowPass`, `movieStep`,
  `moviePlay`, `movieStop`, `movieStart`, `movieCard`, `movieTiles`, `drawMovie`), one button in the Changes row, and the
  frame hook (the film's own drawing, the others hidden while it runs). `.mvgrid` / `.mvtile` / `.mvcv` / `.mvlab` are in
  `arc.css`. Science code, data fetching, caching and URL-hash behaviour are unchanged.

## v0.51.0: spotlight on the movers, glowing track lines (2026-11-06)

The 🎬 film now puts the movers in the spotlight.

- **Spotlight:** while the film plays, the rest of the sky is dimmed (62%). Soft pools of light follow each mover along
  its track so far and around where it is now, so the moving stars stand out in any field. "🔦 Spotlight on / off" in
  the film card turns it off. Only the drawing on top is dimmed; nothing in the images is changed.
- **Track line:**
  - The track so far is a glowing line in the mover's colour, with a thin white core, up to the marker as it glides.
  - An arrowhead ahead of the marker shows the direction of motion.
  - The marker is a ring with a slow pulse, and its number and name have a dark outline so they read on any background.
  - Where it is going is shown as faint dashes, with a dot per pass (filled once reached).
- **Phones:** the caption has a short form when it would not fit ("🎬 Pass 3/4 · Apr 2026 · 2 moving · paths 25x
  longer").
- **Checked live:** Barnard's Star (its arrow points north), the Epsilon Indi field (both arrows point south-east), the
  example field (no movers, so no dimming) and the Epsilon Indi field on phone. Sky and film stay in step, Stop works,
  no page errors. Screenshots: `redesign-docs/ui-after/movers-spotlight/`.
- **Code:** `drawMovie` (spotlight drawn on a reused off-screen canvas: the dim layer with the light pools cut out, then
  laid over the sky), the button in `movieCard`, and `MOVIE.spot`.

## v0.52.0: faster loading, same numbers (2026-11-07)

Measured first, then fixed the three things that cost the most. Every change gives bit-identical results; nothing that is
measured changed.

- **Where the time went** (cached Barnard field, headless Chrome on this PC, every lib/fits.js and main app.js function
  timed):
  - the main thread was blocked for 21-43 s of a 28-55 s load;
  - median stacks 7.8 s (one array allocated and sorted per pixel, ~0.5 s per 293x293 stack);
  - the Changes maps 4.7 s in one block, the longest freeze (5.2-5.5 s), right when the report appears;
  - preparing each image in the workers 0.7-1.6 s, 80 % of it the SIP distortion polynomial (two `Math.pow` per term,
    16 evaluations per grid pixel).
- **Fixes:**
  1. `medianStack` sorts each pixel's values in place (insertion sort; at most a few dozen values). Old and new compared
     on 20 synthetic sets (1 to 43 images, with NaN, 0 and -0): identical on every pixel, 8-15x faster.
  2. The SIP polynomial computes each power of u and v once per call and shares it between the A and B terms (same
     `Math.pow` values, summed in the same order). `prepareCutout` on 30 real cached cutouts, 60 runs: bit-identical,
     1,234 → 423 ms per image (2.9x).
  3. `changeMaps` runs in the existing worker pool (`prep-worker.js`, new `workerJob`). The report shows at once; the
     Changes picture follows about 2 s later, and the panel says "Comparing every image with the others…" meanwhile.
     Same result as before: peaks, kinds, both coloured maps and the agents' text have the same fingerprint (Barnard, 495
     peaks). Falls back to the main thread when workers are unavailable.
  4. The S3 header layout hint is remembered per pipeline version (`l2b-v20` … `l2b-v27`) in the browser, so even the
     first image of a new field asks for all its headers at once. Fresh field: 239 S3 requests instead of ~295, preview
     9.0 s (was 9.7-11.8 s).
- **Measured, old and new code side by side** (old copy on port 8084, new on 8083, alternating, same cache):

  | Cached Barnard field | Report ready | Main thread blocked | Longest freeze |
  |---|---|---|---|
  | Old (3 runs) | 55.2 / 28.1 / 33.8 s | 43 / 21 / 24 s | 4.7-5.5 s |
  | New (3 runs) | 22.6 / 18.2 / 18.5 s | 13 / 12 / 13 s | 2.0-2.4 s |

  This PC was at 30-50 % CPU from other programs during the runs, so single numbers vary; the order never changed.
- **New fields (never opened) are now limited by the network, not this page:** 48-61 s on three fresh fields, of which
  the IRSA archive search took 5-21 s, the S3 images ~35 s (about 180 MB at ~5 MB/s: S3 sends only whole byte ranges,
  so each image's rows are read at the full 2,040-pixel width, ~7.5 MB per image) and SkyBoT 1-41 s. The main thread
  was blocked 9-13 s in all, longest 0.8-1.4 s. On a public host near AWS us-east-1 with `SKYSHIFT_S3=1` the server cuts
  the images itself and sends ~0.5 MB each.
- **Unit tests:** `npm test` passes end to end. Two tests had already been failing before this change (checked with the
  old code) and are fixed:
  - `skybot.test.js` expected at most 4 SkyBoT lookups at once; it now checks against the server's own pool size (6
    since v0.43.1).
  - `s3cut_rice.test.js` took "the first file" in `demo-cache/cutouts`, which stopped being the fixture's source when
    more example images were added; it now names that file (`00ef98da…`, OBSID 2026W22_2A_0570_3) and says so if it is
    missing.
- **`public/dev/smoke.js`:** the check-and-report step now waits for the Changes data, which is built in a worker.
- **Code:** `lib/fits.js` (`medianStack`, `sip`, `sipUV`), `public/prep-worker.js`, `public/app.js` (`workerJob`,
  `changeData` / `changeDone`, `CHGJOB`, the S3 hint), `public/dev/smoke.js`.
- **Checked on v0.52.0:** smoke.js **29 of 29**, 0 page errors (the cached Virgo field opened in 27.4 s; the v0.43 run took
  58.5 s). Guided tour: desktop **30 of 30** and phone **30 of 30** steps fully on screen. Log:
  `redesign-docs/ui-after/v052-check/final-log.txt`. (The spectrum step's note `{"n":0,"done":119}` is the same as in
  every earlier check log since v0.41.)

## v0.53.0: WISE overlay (CatWISE2020), rank 7 of the research report (2026-11-07)

The challenge asks for overlays "from other telescopes, such as the Gaia mission or the WISE mission". Gaia was there
(v0.36); WISE is new. It matters most for brown dwarfs: WISE 0855 is not in Gaia at all, but is in CatWISE2020, which
measured motions from WISE images of 2010-2018.

- **Server: `/api/catwise`.** NASA/IPAC IRSA TAP, table `catwise_2020`: every source with W2 S/N > 5 in the field
  (2,500-19,000 per 0.5° field, 9-26 s the first time, then from the cache for 30 days). One compact array per source
  (name, position at MJD 57170 = 2015.4, motion ± error in ″/yr with cos δ, W1, W2, S/N, blend count, artefact flags),
  gzipped (~240 kB for WISE 0855's field). CDS VizieR (II/365) could not be reached from the team's network to check its
  columns, so there is no untested fallback: when IRSA does not answer, the legend says so.
- **Page: a WISE button** next to Gaia (Overlays, Beginner and Advanced). Each source is moved to the date of the pass on
  screen with its own motion:
  - **orange diamond + arrow** (20 years of motion): a mover of 1″/yr or more, at least 5x its error, with a clean fit
    (no unWISE artefact flag, at most 2 blend components, W2 S/N ≥ 10);
  - **pink diamond**: very red in WISE's two bands (W1−W2 ≥ 0.8), the colour of cool brown dwarfs and of quasars (a
    brown dwarf nearby also moves; a quasar does not). Drawn when zoomed in below 1.2°, on the SPHEREx field only.
  - The legend counts the movers, how many are fast enough for SPHEREx (1.5″ or more between the first and last pass)
    and how many were left out as halo artefacts.
- **Tap a source:** W1, W2 and the colour in plain words; the CatWISE motion ± error, toward which direction, and how far
  that is between the passes in SPHEREx pixels; a Gaia star at the same place if there is one. For a fast one: **Measure
  its motion** (the Barnard's Star method), **▶ Track its motion across passes** (v0.44), **Its spectrum**, and an Aladin
  link to the WISE images.
- **Two things CatWISE does that the overlay corrects** (found on 4 live fields):
  - It lists a fast mover several times, as pieces of its smeared image. WISE 0855 has 5 entries (7.94, 8.09, 8.01,
    5.58, 1.15″/yr). Entries within 12″ with the same motion, or both of 1″/yr or more, are one object: the one with the
    best S/N is shown, and its card lists all of them.
  - Next to a star too bright for WISE it makes fake fast movers that its own artefact flags miss: all 27 clean "movers"
    of 1″/yr or more in the Epsilon Indi field lay 5-12′ from Epsilon Indi A, in groups pointing the same way, and 9 around
    Barnard's Star. Real movers this fast are rare (rarely one per field), so **3 or more within 3′ of each other are left
    out** as artefacts, and a card opened on one says its motion is most likely not real.
  - Slower motions (0.5-0.9″/yr at W2 ~16) appear in every field, including the Virgo control, and are below what
    SPHEREx sees; they are not drawn as movers.
- **Measured live** (desktop and phone, no page errors):

  | Field | CatWISE sources | Movers shown (≥ 1″/yr) | Left out (halo) | Very red |
  |---|---|---|---|---|
  | WISE 0855 | 2,479 | 1: **WISE 0855**, 7.94 ± 0.15″/yr west, W1−W2 3.91, 5 entries merged; lands in the NASA target's ring | 0 | 108 |
  | Epsilon Indi B | 8,330 | 0 (Epsilon Indi B itself is only in CatWISE as 3-component blends with wrong motions) | 27 | 350 |
  | Virgo control | 7,005 | 1 (1.03″/yr, W2 14.6) | 0 | 249 |

- **Rank 7 in the mover labels.** The 🔭 deep search, ◐ difference images and 🎯 motion scan check a find in this order:
  the field's NASA target, Gaia DR3, then CatWISE2020 (new, for finds Gaia does not have). A CatWISE mover within 9″ at
  that date whose motion agrees within max(3σ of both errors combined, 30 %, 0.5″/yr) gives "✓ Known mover (CatWISE2020
  agrees: J…)"; a CatWISE mover with a different motion is named in the candidate's label. Each search loads CatWISE in
  the background and waits for it (at most 45 s) only before labelling. Halo entries are never used.
  - Checked: Epsilon Indi B is still "the NASA target" (🔭 4.22, 🎯 4.27″/yr); the Virgo control field still flags
    nothing in all three searches; WISE 0855's 🎯 find this time measured 13.1″/yr and stays an artefact ("too fast"), as
    CatWISE's 7.9″/yr does not agree with it. The rules were not loosened.
- **Tests:** new `test/catwise.test.js` (mocked IRSA with real CatWISE rows around WISE 0855: one query, the right table
  and circle, compact columns, WISE 0855's motion and colour intact, cached, bad input refused), in `npm test`. smoke.js
  has a WISE overlay step.
- **Not done:** the guided tour has no WISE step yet (it needs the four languages).
- **Code:** `server.js` (`catwise`, the route, `_test`), `public/app.js` (`CW`, `cwPrepare`, `cwLoad`, `updCwNote`,
  `drawCw`, `showCw`, `cwMeasure`, `cwMatch`, `msLabel`; `dsGaia` checks CatWISE; the three searches load it; the film
  keeps the CatWISE name), `public/index.html` (`#cwb`, `#cwleg`), `public/arc.js` (legend scroll), `public/dev/smoke.js`.
- **Fixed while checking (from v0.52):** on a phone, the guided tour's Changes step (13) sometimes showed only 47-96 % of the
  Changes panel. Since v0.52 that panel fills in when the worker is done, after the step has opened and the sheet has
  been placed. `public/arc.js` now places the step's tools again when they grow while the sheet is open fully.
- **Checked on v0.53.0:** smoke.js **30 of 30** (with the new WISE step), 0 page errors; guided tour desktop **30 of 30**;
  phone **30 of 30** in three runs after the fix (29 of 30 in two runs before it). `npm test` passes. Log:
  `redesign-docs/ui-after/v053-check/final-log.txt`; screenshots: `redesign-docs/ui-after/wise-overlay/`.

## v0.54.0: the film follows Gaia's and WISE's movers, with a circle in every pass (2026-11-07)

Asked by the team: "a star went from here to there", with a circle in every epoch, in the animation, in every field, using
Gaia and WISE.

- **What moves enough to see?** Measured live on 6 fields' Gaia DR3 stars: a typical star moves 0.1-0.3″/yr, 3 % of a
  SPHEREx pixel. Barnard's Star (10.4″/yr) and Epsilon Indi A (4.7″/yr) are the only Gaia stars of 1″/yr or more in their
  fields; WISE 0855 (7.9″/yr) is only in CatWISE; the Virgo control (fastest 0.77″/yr) and two random fields (0.21,
  0.27″/yr) have none.
- **🎬 film, new movers.** Besides what ARCNAVE's searches measured (v0.50), the film now takes every Gaia DR3 star and every
  CatWISE2020 mover (v0.53's cuts) whose own motion takes it 1″ or more between the first and last pass, in the field.
  - **Measured** when ARCNAVE can: the frame-by-frame fit (v0.46, every image lined up on Gaia) or the pass-by-pass patch
    track (v0.44), each kept only when it agrees with the catalogue and the catalogue shift is at least 1.5″. The patch
    track also needs S/N ≥ 5 at the star in every pass: its search starts at the catalogue place, so on a source too faint
    to see it would only follow the catalogue. Solid track; the card gives the measured motion ± error.
  - **Predicted** otherwise: the catalogue places, a dashed track, labelled "Predicted by Gaia/WISE: too faint or too small
    for SPHEREx to measure here".
  - **A field with nothing fast enough** shows its 3 fastest Gaia stars as Gaia predicts them, labelled "too small", and
    the card says plainly that SPHEREx cannot measure motions this small. The stated stretch factor makes the path visible.
  - A catalogue mover on the field's NASA target with the same motion takes the target's name ("WISE 0855−0714 (CatWISE
    J085506.91-071437.5)").
- **A circle in every pass:** each mover gets a circle at its place in every pass, numbered P1, P2… (white = the start),
  the numbers beside the path on alternating sides; dashed circles for a prediction. Paths shorter than 70 screen px are
  stretched by one stated factor (was 40 px), so the circles do not sit on each other.
- **From here to there, in words:** every mover in the card reads "Moved from RA …, Dec … (pass 1, Aug 2025) to RA …,
  Dec … (pass 3, Aug 2026): 13.0″ toward the north in 361 days", with the share of a SPHEREx pixel when under one.
- **🎬 Animate** is also in Overlays (next to Gaia and WISE), not only in Changes → Watch it move. The film loads Gaia and
  CatWISE first (at most 45 s). It frames the movers with more room (3.2x their spread, was 2.4x), and on phones puts them
  in the upper part of the sky, above the card.
- **Measured live** (desktop and phone, no page errors):

  | Field | In the film |
  |---|---|
  | Barnard's Star | Barnard's Star, measured: 13.0″ north in 361 days (the NASA target) |
  | Epsilon Indi B | Epsilon Indi B, measured 5.9″ south-east in 515 days; Epsilon Indi A (Gaia DR3 6412595290592307840), measured 4.4″ south-east (saturated: rough, its pass positions zigzag) |
  | WISE 0855 | **WISE 0855, measured for the first time in the film**: 8.82 ± 1.10″/yr west by the frame-by-frame fit (every image), 9.0″ in 355 days; CatWISE 7.94″/yr agrees. Faint (S/N 2.4-5 per pass stack), so the error is large |
  | Virgo control | no star fast enough: Gaia's two fastest in the field, predicted, 0.17 and 0.11″/yr (0.03 and 0.02 of a pixel), drawn 88x longer, labelled too small to measure |

- **smoke.js:** a step that starts the film from Overlays.
- **Code:** `public/app.js` (`movieMovers`: catalogue movers, `catAdd`, the target name, the slow fallback;
  `movieFromTo`; `movieStart` loads Gaia and CatWISE and frames the movers; `movieCard`; `drawMovie`: numbered circles,
  dashed predictions, the stretch rule), `public/index.html` (`#mvb`), `public/dev/smoke.js`. Screenshots:
  `redesign-docs/ui-after/film-catalogues/`.
- **Checked on v0.54.0:** smoke.js **31 of 31** (with the new film step), 0 page errors; guided tour desktop **30 of 30**,
  phone **30 of 30** in three runs. Log: `redesign-docs/ui-after/v054-check/final-log.txt`.
