# ARCNAVE UI upgrade (v0.39.1 → v0.40.0)

Concept: **a mission-control observatory for everyone.** Deep-space dark, calm and premium; the sky image is the hero;
one infrared accent that carries SPHEREx's near-infrared story. A visual and UX upgrade only: no feature, URL-hash
behaviour, data fetching, caching or science logic changes (any small logic touch is listed under "Logic touched").

Backup before any change: `D:\ARCNAVE-SPHEREX\ARCNAVE-BACKUP-before-ui` (robocopy, 9,804 files / 1,918,610,695 bytes,
identical to the source on 2 Nov 2026).

## 0. Before

Screenshots in `redesign-docs/ui-before/`. They were taken by headless Chrome at 1440x830 and 390x844 as a returning
visitor (quick start already seen):
- landing page;
- WISE 0855 result;
- Changes view;
- spectrum: loading and finished;
- phone sheet: peek, half and full.

`capture-log.txt` lists every shot. No page errors were logged. WISE 0855 opened in 20 s on desktop and 21.5 s on the
phone, from demo-cache.

### Audit: the 10 biggest UI weaknesses (honest, specific)

1. **Three accent colours, no single meaning.** The base theme is teal. The "look 2" layer re-paints primaries violet → blue →
   cyan. Amber marks "selected" in the Changes view, green marks success, and cyan rings the target. A colour does not tell you
   what kind of thing you are looking at. `arc.css` is two themes stacked: 909 lines, with the look-2 block overriding
   the first. There is no "infrared" accent, although infrared is the whole story.
2. **The first 5 seconds show no real data.** The landing hero is a decorative eclipse plus four buttons of nearly equal
   weight (Launch, Try Barnard's Star, See it move, How it works). The real SPHEREx blink sits one screen down. The five
   NASA targets come five sections down, as text-only cards packed with numbers.
3. **Phone landing:**
   - The four CTAs stack into four full-width pills that compete with each other.
   - The headline breaks as "change. Find what / moves.".
   - The three pills wrap onto two lines.
4. **The result card is a wall of text.**
   - WISE 0855 shows a 12-line paragraph at 15 px before any number stands out.
   - The key result (11.8σ, 43 images) is buried mid-sentence.
   - "How sure are we?" is closed by default.
   - The badge "✓ Detected (faint)" is the only visual summary.
5. **No playback controls on the image.**
   - There is no play/pause, and the frame scrubber is in the left panel, far from the image.
   - Dates are not shown on the viewer.
   - Keyboard shortcuts exist but are never hinted.
   - In the Changes view the epoch slider disappears and nothing explains why.
6. **The tool header is crowded.**
   - Desktop: 7 action buttons, plus contrast and language.
   - Phone: the actions become a second, sideways-scrolling row cut off at "Le…", and the search placeholder is cut
     ("Name, or RA Dec: 1").
   - Together the header uses ~110 px of an 844 px screen.
7. **Small, low-contrast technical text.**
   - The Agents list, the gnotes and the status bar use 11-12 px grey (`--fg-3`) text in long runs.
   - The status bar truncates ("newest 2026-05-1") and has no hierarchy between labels and values.
8. **Loading states are thin for 9-60 s waits.**
   - The spectrum card shows an empty dark box and "Reading 0 of 126…" with no bar and no time estimate.
   - The target load reuses the generic #wait card.
   - There are no skeletons, no "what is being fetched" list and no fun fact while waiting.
9. **Tamil and Devanagari fall back to whatever the system has.** The font stack (Inter / Space Grotesk / JetBrains Mono)
   has no Tamil or Devanagari faces. Windows uses Nirmala UI, Android uses Noto, so the weight and line height differ
   from the Latin text.
10. **Inconsistent component states.**
    - Group buttons glow violet; tabs fill with a gradient; chips use a teal dot; segmented controls use a violet tint;
      "Explained" uses amber.
    - Hover, active and disabled differ per component.
    - Focus rings are amber in places and violet in others.

Charts: the spectrum chart (drawn by app.js on a canvas) has ~9 px axis labels, and its violet points don't belong to
any palette. On a phone the y-axis label is hard to read. The finished spectrum took 47 s (desktop) and 45 s (phone),
read live: a long wait behind a thin progress line.

Smaller notes:
- The intro plate (`#intro`) still shows the old layout on plain hash links.
- The landing has 10 sections, so it is long.
- The og:image predates the current look.

## 1. Design tokens

They live in the last block of `public/arc.css`, "v0.40.0 design system". The older names (`--teal`, `--violet`, `--grad`…)
are mapped onto these tokens, so every existing component follows.

| Group | Tokens | Rule |
|---|---|---|
| Background | `--bg0` #05070e · `--bg1` #0a0e1a · `--bg2` #10162a · `--bg3` #171f38 · `--surface` · `--surface-2` | Deep navy, never pure black |
| Lines | `--stroke` · `--stroke-2` · `--stroke-3` | Rest, hover, focus |
| Text | `--fg` #eef2f9 · `--fg-2` #c0c9da · `--fg-3` #95a0b8 | All AA on `--bg0` and `--surface` (`--fg-3` ≈ 7:1) |
| Infrared accent | `--ir` #ff7a45 · `--ir-2` · `--ir-3` · `--ir-dim` · `--ir-line` · `--ir-grad` · `--on-ir` #1a0903 | The brand and everything you can press: primary buttons, selected tab, a tool that is on, focus ring. Dark text on it (≈ 8:1). |
| Status (results only) | `--ok` seen · `--warn` marginal · `--info` unconfirmed candidate · `--muted` too faint · `--danger` error | Always paired with a symbol and words |
| Image colours | Drawn by app.js: orange = where a mover is now, cyan = where it was | Not touched |
| Type | `--f-disp` Space Grotesk · `--f-ui` Inter · `--f-mono` JetBrains Mono, each with Noto Sans Tamil / Devanagari as fallback | Noto faces load only for Tamil or Hindi text |
| Type scale | `--t-xs` .75 · `--t-sm` .8125 · `--t-md` .9375 · `--t-lg` 1.125 · `--t-xl` 1.5 · `--t-2xl` 2.25 rem · `--t-3xl` clamp | |
| Space | `--s1`…`--s8`: 4, 8, 12, 16, 24, 32, 48, 72 px | |
| Radius | `--r1` 8 · `--r2` 12 · `--r3` 16 · `--r4` 24 · `--rf` pill | |
| Shadow | `--sh1` · `--sh2` · `--ir-glow` | |
| Motion | `--d1` 120 ms · `--d2` 200 ms · `--d3` 360 ms · `--ease` · `--ease-out` | Everything off under prefers-reduced-motion |

## 2. What changed, stage by stage

### Stage 1: design tokens and landing

| Before | After |
|---|---|
| `ui-before/desktop-landing.png`: centred headline over a decorative eclipse, 4 equal buttons, no real data | `ui-after/stage1/desktop-landing.png`: headline left, real SPHEREx blink right, 1 primary + 1 secondary button |
| `ui-before/phone-landing.png`: 4 stacked full-width buttons, no image on the first screen | `ui-after/stage1/phone-landing.png`: 2 buttons, then the real blink on the first screen |
| The 5 targets were text-only cards 5 sections down | `ui-after/stage1/desktop-landing-targets.png`, `phone-landing-targets.png`: large cards with a real thumbnail directly under the hero |
| Teal + violet + amber accents | One infrared accent (also visible in the tool: `ui-after/stage1/desktop-tool-from-card.png`) |

- The thumbnails in `public/img/targets/` are ARCNAVE's own rendering of each target's demo-cache images (embed view,
  centre crop, JPEG). Nothing is drawn in. The rings and labels are ARCNAVE's own markers.
- Languages: `ui-after/stage1/*-landing-ta.png`, `-hi`, `-es`.
- Logic touched: none in app.js, tour.js or server.js. arc.js (presentation layer) changed in four places:
  - the star-field drawing cost;
  - the blink plays on a canvas where ImageDecoder exists;
  - the prefetch runs on intent instead of on a 4 s timer;
  - the position of the decorative "mover" star.

### Stage 2: result view and controls

| Before | After |
|---|---|
| `ui-before/desktop-result-wise0855.png`: no playback on the image; the slider is in the left panel; no dates on screen | `ui-after/stage2/desktop-result-time.png`: a playback bar on the image (play/pause, step, scrubber with the pass months, the image date, key hints) |
| The panel's "Watch" group mixed view mode, time slider and colour slider | Where → Compare → When → Colour, numbered 1-4 in Beginner, then the tool groups |
| The result card was one long block of paragraphs | `ui-after/stage2/desktop-result-card.png`: each bold lead-in ("What SPHEREx shows:") becomes a small label over its paragraph |
| Badges told results apart by colour only | ✓ seen (green, solid), ≈ marginal / likely artefact (amber, dashed), ? unconfirmed candidate (light blue, dashed). The words are app.js's own, unchanged. |
| Changes: the time slider disappeared with no reason given | `ui-after/stage2/desktop-changes.png`: the bar hides, and the When group says the view uses every image at once |
| Phone: no playback near the image | `ui-after/stage2/phone-result-time.png`: a compact bar above the sheet at peek height, hidden at half and full |

- **How the bar works:** it moves the existing `#tm` slider and sends it the same `input` event a drag does, so app.js
  picks the image, the movers and the labels exactly as before. Dates come from app.js's own `seqAt()` / `fmtDay()` /
  `fmtMonth()`.
- **Keys:** Space plays/pauses and ← → step, only when nothing is being typed and no tour or game is running.
  H (clear view) is app.js's own.
- **Logic touched:** none in app.js, tour.js or server.js. The new presentation code in arc.js is the bar and one class
  added to card paragraphs. In index.html, `#tmr`/`#strip` moved into "When" and `#bandr`/`#lam`/presets into "Colour";
  every ID is unchanged.
- **Kept as it is:** the dock title "What am I seeing?", because the quick start and the tour use that wording in 4
  languages.

### Stage 3: loading states and charts

| Before | After |
|---|---|
| `ui-before/desktop-spectrum-loading.png`: an empty dark box and "Reading 0 of 126 …" | A shimmer placeholder for the empty chart, and a progress bar under every "Reading / Measuring N of M" line |
| While a target loaded, the dock said "Pick a place in the sky" | `ui-after/stage3/desktop-loading-skeleton.png`, `phone-loading-skeleton.png`: "Building the report", the working agent's own message, skeleton lines and a true fact |
| The loading card: title, time and bar only | The same, plus phase steps 1-4 and a "While you wait" fact |
| `ui-before/desktop-spectrum.png`: ~9 px axis labels, no way to read a point | `ui-after/stage3/desktop-spectrum.png`, `phone-spectrum.png`: ~12 px labels on a plot panel; `*-spectrum-readout.png`: point or tap to read a dot's numbers |

- Logic touched: app.js gets markup only. Each chart point carries its numbers as `data-v` plus an SVG `<title>`.
  Nothing is measured, filtered or coloured differently. Everything else is in arc.js / arc.css.
- The facts are fixed text taken from what ARCNAVE already states (landing page, glossary, the WISE 0855 card).

### Stage 4: phones, accessibility, final tests

| Before | After |
|---|---|
| `ui-before/phone-result-wise0855.png`: a two-row header (~104 px) with a sideways strip cut at "Le…"; the app's frame caption half under it | `ui-after/final-screens/phone-result-wise0855.png`, `ui-after/stage4/phone-result-header.png`: one row (62 px): logo, search, **More**. The caption is visible |
| Header buttons hidden in a scrolling strip | `ui-after/stage4/phone-more-open.png`: More opens a two-column menu; a choice closes it; it opens by itself when a tour step points at one of its buttons (`phone-tour-header-step.png`) |
| Several phone controls 36-40 px tall | Every control on the phone screen at least 44 px tall: tabs, chips, segmented buttons, selects, strip images, the play bar |
| Focus ring amber in places, violet in others | One focus ring everywhere (light infrared, white on infrared buttons) |
| No robots.txt (a 404) | `public/robots.txt` allows everything |

- **Landing speed:** a profile of the first 8 s on a 4× slowed CPU showed the star field forcing a page layout on every
  frame (it read the scroll position) and a header measurement running under the start page. Both are fixed, see the
  Lighthouse table.
- **Phone tour:** the guide checks once, when a step opens, whether a half sheet is tall enough. A Changes panel that
  fills a moment later can outgrow it. arc.js re-checks while a step is open, opens the sheet fully when needed, and
  re-centres the next step's tools when the sheet goes back to half.
- **Branding kept:**
  - the original ARCNAVE mark (inline SVG), the favicon and app icons, title and description;
  - `og.jpg`, a real SPHEREx before/after of asteroid 3865 Lindbloom, with an accurate alt text.
- **Logic touched:** none in app.js (beyond Stage 3's chart markup), tour.js or server.js.

## 3. Test results (final code, 5 Nov 2026, headless Chrome 1440x830 and 390x844)

| Check | Result |
|---|---|
| `public/dev/smoke.js` | **29 of 29 pass, 0 page errors** (`ui-after/final/smoke.json`; re-check on the last code: `ui-after/final-recheck/`) |
| `public/dev/guidecheck.js`, desktop | 30 of 30 steps have their tool on screen. 29 of 30 are fully visible: step 14 Changes shows 59 % of its 613 px panel. That is identical with the v0.39.1 stylesheet, see Remaining issues |
| `public/dev/guidecheck.js`, phone | **30 of 30 fully on screen** |
| The 5 targets from their landing cards (desktop), each opened and then played with the new bar | Barnard's Star ✓ Motion seen (43 s) · Epsilon Indi B ✓ Motion seen (69 s) · WISE 0855 ✓ Detected (faint) (21 s) · RW Aurigae ✓ Change seen (64 s) · R Draconis ✓ Change seen (44 s). Play moved the image in all 5; no page errors |
| Embed `?embed=1#ct=barnard` in iframes 640x420 and 390x300 on a page from another origin | Both show the result with the NASA SPHEREx / IRSA credit and "Open full ARCNAVE"; no playback bar, no sideways scroll (`ui-after/final-embed/`) |
| Copy Python (Share → Copy Python, clicked) | 50 lines, Astropy + astroquery `Irsa.query_tap`; toast "Python code copied" (`ui-after/final/copy-python-barnard.py`) |
| Live light curve (R Draconis card) | Finished in 45 s, 95 points carry their values, readout "This star · 2025-07-17 · −1.11 ± 0.02 mag" |
| Live spectrum (WISE 0855) | 65 colours; readout on hover and on tap |
| All 4 languages on the landing | No sideways scroll at either size; new text present in ta / hi / es |

Note on the embed test: an iframe in a page with no address (about:blank / data:) stays dark, because Chrome does not let
such a page load `localhost`. Tested instead from `127.0.0.1` (a different origin), which is how another site embeds it.

### Lighthouse 12.6.1, mobile (simulated slow 4G, 4× CPU)

| Page | | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|---|
| Landing | before v0.39.1 | 49 | 100 | 100 | 100 |
| Landing | **after v0.40.0** | **75** (second run 74) | 100 | 100 | 100 |
| Tool `#ct=barnard` | before v0.39.1 | 17 | 100 | 100 | 91 |
| Tool `#ct=barnard` | after v0.40.0 | 17 (all 3 runs) | 100 | 100 | 83 / 91* |

| Landing detail | Before | After |
|---|---|---|
| Total blocking time | 2,680 ms | 0-40 ms |
| First contentful paint | 3.5 s | 3.1 s |
| Main image, observed in Lighthouse's own trace | 3.0 s | **1.7 s** (shown at first paint) |
| Main image, Lighthouse's simulated estimate | 3.7 s | 5.0 s |
| Page weight | 650 KiB | 701 KiB (5 thumbnails, the new CSS) |

\* SEO 83 in one tool run: "robots.txt is not valid". There was no robots.txt at all, before or after; one is added now.

The tool page stays at 17: it downloads several MB of real SPHEREx images and runs a WebGL sky in software (headless).
Its blocking time varies widely run to run: 20.7 s, 43.6 s and 75.9 s after, against 23.5 s before. The 75.9 s run
also downloaded 18 MB, because the image cache differed. Reports are in `redesign-docs/lighthouse/`.

## 4. Before / after comparison (same views, same sizes)

| View | Before | After |
|---|---|---|
| Landing, desktop | `ui-before/desktop-landing.png` | `ui-after/final-screens/desktop-landing.png` |
| Landing, phone | `ui-before/phone-landing.png` | `ui-after/final-screens/phone-landing.png` |
| WISE 0855 result, desktop | `ui-before/desktop-result-wise0855.png` | `ui-after/final-screens/desktop-result-wise0855.png` |
| WISE 0855 result, phone | `ui-before/phone-result-wise0855.png` | `ui-after/final-screens/phone-result-wise0855.png` |
| Changes, desktop / phone | `ui-before/*-changes.png` | `ui-after/final-screens/*-changes.png` |
| Spectrum loading | `ui-before/*-spectrum-loading.png` | `ui-after/final-screens/*-spectrum-loading.png` |
| Spectrum | `ui-before/*-spectrum.png` | `ui-after/final-screens/*-spectrum.png`, readout: `ui-after/stage3/*-spectrum-readout.png` |
| Phone sheet peek / half / full | `ui-before/phone-sheet-*.png` | `ui-after/final-screens/phone-sheet-*.png` |
| Start here (new) | none | `ui-after/stage1/*-landing-targets.png` |
| Loading skeleton (new) | none | `ui-after/stage3/*-loading-skeleton.png` |
| Phone More menu (new) | none | `ui-after/stage4/phone-more-open.png` |
| Embed | none | `ui-after/final-embed/embed-640x420-390x300.png` |

## 5. Remaining issues

- **Desktop tour step 14 (Changes):** the 613 px Changes panel doesn't fit under the tabs in the 738 px panel, so 59 %
  of it is visible (same in v0.39.1). A fix would mean a shorter Changes panel, which is content in app.js.
- **Tool page performance stays at 17** on mobile. The cost is the real data and the WebGL sky, which this visual
  upgrade was told not to change.
- **Simulated LCP on the landing is 5.0 s** although the observed paint is earlier (1.7 s). Lighthouse's model counts
  the main-thread work that follows the first paint.
- **Charts keep app.js's own pass colours** (orange / violet / cyan, pink star, grey comparisons) and the same dot shape
  for every pass. A colour-blind reader can still use the legend and the readout (it names the pass), but no shape
  tells the passes apart.
- **The tool's labels are English** in all 4 languages, as before (by design in i18n.js). The landing, quick start and
  tour are translated.

## 6. Summary

Most improved:
1. **The first five seconds.** Real SPHEREx frames beside the headline, and NASA's five targets as cards with real
   thumbnails right below. Landing performance went from 49 to 75.
2. **Watching the result.** A play bar on the image with dates, steps and keys; the controls in task order (Where →
   Compare → When → Colour); a one-row phone header with a More menu.
3. **Waiting and reading.**
   - Loading shows phase steps, true facts and a skeleton report.
   - Charts have readable labels and a hover/tap readout.
   - Badges carry a symbol as well as a colour.

Still weak:
1. The tool page's own speed on phones (17). That is data and WebGL, outside a visual upgrade.
2. The desktop tour's Changes step (59 % visible) and the very long result texts in the right panel.
3. Chart passes are told apart by colour only.
