// report.html -> PDF (A4) with Chrome. Fills in image paths, adds page numbers, then renders page PNGs for checking.
const path = require('path'), fs = require('fs');
const puppeteer = require('C:/Users/Admin/AppData/Local/Temp/lh/node_modules/puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DIR = __dirname;
const SHOT = 'file:///' + path.join(DIR, 'shots').replace(/\\/g, '/');
const EXIST = 'file:///D:/ARCNAVE-SPHEREX/ARCNAVE%20SPHEREX/archive/redesign-docs/ui-after/0.55.0';
const OUT = process.argv[2];
(async () => {
  let html = fs.readFileSync(path.join(DIR, 'report.html'), 'utf8')
    .replace(/SHOT\//g, SHOT + '/').replace(/EXIST\//g, EXIST + '/').replace('COVER_BG', 'file:///D:/ARCNAVE-SPHEREX/ARCNAVE%20SPHEREX/public/img/hero/film-epsindi.jpg');
  const tmp = path.join(DIR, 'report.built.html'); fs.writeFileSync(tmp, html);
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files'] });
  const p = await b.newPage();
  await p.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
  const missing = await p.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src')));
  console.log('missing images:', missing.length ? missing : 'none');
  await p.pdf({ path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font:8px Segoe UI,Arial;color:#8a94a2;padding:0 15mm;display:flex;justify-content:space-between"><span>ARCNAVE · NASA Space Apps 2026 · Planet X and SPHEREx</span><span class="pageNumber"></span></div>' });
  console.log('PDF', OUT, (fs.statSync(OUT).size / 1e6).toFixed(1), 'MB');
  await b.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
