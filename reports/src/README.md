# Submission deck and report: sources

**The deck for Space Apps is `../ARCNAVE-Deck.pdf` (7 slides, the most the rules allow).** It is printed from
`deck7.html` by `node reports/src/deck7.cjs` (Playwright + Chromium; the script refuses more than 7 slides).
`../ARCNAVE-Presentation.pptx` (23 slides) is the long version for talks: do not submit it as the demo.

`../ARCNAVE-Presentation.pptx` and `../ARCNAVE-Project-Report.pdf` are built from these files. Change a number here,
rebuild both, and check that the app (landing cards, target cards) says the same.

- `deck.cjs`: the deck (PptxGenJS, 23 slides). Images from `crops/` and `shots/`, plus
  `archive/redesign-docs/ui-after/0.55.0/judge/judge-planetx.jpg` from the repo.
- `report.html` + `pdf.cjs`: the A4 report, printed by Chrome. `SHOT/` in the HTML means `shots/`.
- `shots.cjs`, `hero.cjs`: how the screenshots in `shots/` were taken (app running on port 8084).

## Rebuild (Windows, PowerShell, in the repo folder)

```
$env:Path = "D:\ARCNAVE-SPHEREX\node\node-v24.20.0-win-x64;" + $env:Path
cd reports\src; npm install; cd ..\..        # pptxgenjs only (node_modules is git-ignored)
$env:APPLY_THEME = "<pptx skill>\scripts\apply_theme.js"   # writes the deck's theme colours
node reports\src\deck.cjs reports\ARCNAVE-Presentation.pptx
node reports\src\pdf.cjs  reports\ARCNAVE-Project-Report.pdf
```

`pdf.cjs`, `shots.cjs` and `hero.cjs` load puppeteer-core from `C:/Users/Admin/AppData/Local/Temp/lh/node_modules` and use
the installed Google Chrome; change those two paths on another computer.

History: v0.56.2 (13 Nov 2026) changed Epsilon Indi B to the re-measured 4.32 ± 0.27″/yr over 4 passes (slides 7 and 9,
report pages 2 and 7); Epsilon Indi A is no longer quoted as measured (it is saturated).
