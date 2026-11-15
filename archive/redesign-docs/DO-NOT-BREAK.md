# ARCNAVE redesign: do-not-break checklist (Phase 0)

Front-end files: `public/index.html` (markup + inline CSS), `public/app.js` (all tool logic), `public/tour.js`
(story / guide tours + language switch for intro/tour), `public/i18n.js` (Hindi/Spanish dictionaries),
`public/about.html`. Science code lives in `lib/*.js` (not touched). `server.js` not touched.

## JS hooks that must keep working
- IDs used by app.js / tour.js (never rename): `aladin ov sf q survey ecl playb exb share wsky clearv tourm tmenu lb tb hc
  ra dec bd ep zm scl sclb scll card agents alist aauto dbg alive lab lc2 ly lyo ld ldo lt load dcard csize ipe stat help
  tmr tm tml tmo strip chg chgl chgt pxp pxd pxdo pxm pxmo pxgo pxmap pxt pxc pxs swr sw flip bandr band bo lam flagsb
  gaiab deepb specb gaialeg flagleg drawer lc totb tdrawer tc scv ntv btv intro go toast embedbar wait waith waitt waitbar
  waitfill waitp dcd dcdh dcdx dcdimg dcdsize dcdshare dcddl dcdcopy dcdtxt game gh gx glev gmsg gcv gframe gdots gprev
  gplay gnext gctl2 ghint gshow gres gresh grest grests gcard gagain mnav skyinfo`.
- Bound globally by attribute (any element with it works, wherever it sits):
  `[role=tab][data-m]` view modes, `[data-ct]` NASA targets, `[data-ex]` examples, `[data-play]` game, `[data-b]` colour
  presets, `[data-cv]` change colouring, `[data-sheet]` phone sheets, `[data-tour]` `[data-guide]` tours,
  `select[data-lang]` language pickers (filled + switched by tour.js).
- Classes read by JS/tour: `.acts .tabs` (scroll fade), `.brand .loadrow .presets .tele` (tour spotlights),
  body classes `intro clearv waiting touring`, `body[data-sheet]`, `html.embed`, `#intro` hidden state.
- Boot (app.js `boot()`): hash keys `ra dec fov b m e sz ipe load fra fdec ct ex tour guide play scorecard prewarm
  nulltest brighttest lang`, plus `?embed=1` / `#embed=1`. Any of these must open the tool directly (no landing).

## Features to re-test after every phase
RA/Dec/name box ("190 -4") · smooth flight · Time machine · Blink · Swipe · Difference · Changes · stacks (images per
epoch) · Color slider · field 0.25/0.5/1° · Flags + counts · Gaia overlay, arrows, star card, Measure its motion ·
Spectrum / Its spectrum · Deep view · Light curve · known asteroid names + track arrow · "?" dots · Hide Planet X ·
false-alarm + brightness tests (Tested drawer) · whole-sky map · game · narration (Listen) · QR3 images · data-release
note · Share + Copy embed code · Discovery card · 4 languages · embed 640x420 and 390x300.

## Honest numbers (from CHALLENGE in app.js, v0.37 corrections)
Barnard 9.7″ vs 10.2″ · Eps Indi B 4.4″ vs 4.7″ (one year, 2 passes); 4.3 ± 0.3″/yr over 4 passes, 515 days (film, v0.56.2; was 5.03 ± 0.41 on the landing, WITHDRAWN) · WISE 0855 11.8σ, AB 17.15 · RW Aur: the +0.19 mag was WITHDRAWN
(saturated centres); now "change likely", outer glow at 4.0 µm, 1.1 mag range, comparisons 0.04-0.18 · R Dra: the
0.33-0.35 mag was WITHDRAWN; now 0.41 mag (5 Sep → 25 Oct 2025) and 0.91 mag by 14 Nov 2025 at 0.85 µm.
