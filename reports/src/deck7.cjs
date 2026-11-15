// Prints the 7-slide demo deck (deck7.html) to reports/ARCNAVE-Deck.pdf with headless Chromium (Playwright).
// Usage: node reports/src/deck7.cjs [out.pdf] [--png dir]   (--png also writes one PNG per slide, to check the layout)
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const args = process.argv.slice(2), pi = args.indexOf('--png');
  const pngDir = pi >= 0 ? args.splice(pi, 2)[1] : null;
  const out = path.resolve(args[0] || path.join(__dirname, '..', 'ARCNAVE-Deck.pdf'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file://' + path.join(__dirname, 'deck7.html'), { waitUntil: 'load' });
  const n = await page.$$eval('section.s', s => s.length);
  if (n > 7) throw new Error(`${n} slides: Space Apps allows 7 at most`);
  if (pngDir) {
    const s = await page.$$('section.s');
    for (let i = 0; i < s.length; i++) await s[i].screenshot({ path: path.join(pngDir, `slide${i + 1}.png`) });
  }
  await page.pdf({ path: out, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.log(`${n} slides -> ${out}`);
})().catch(e => { console.error(e); process.exit(1); });
