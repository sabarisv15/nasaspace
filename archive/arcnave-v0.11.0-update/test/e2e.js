'use strict';
// End-to-end check in headless Chromium. The real app code runs; only the network edges are faked:
//  - Aladin Lite is replaced by a tiny stub (no internet needed)
//  - /api/* is answered with a synthetic two-epoch SPHEREx field: misregistered by (1.3, -0.8) px,
//    one slow mover (known to nobody), one fast asteroid (known to SkyBoT) and one known-but-faint object.
// Run:  node test/e2e.js   (needs Playwright + Chromium, which are preinstalled in the Claude sandbox)
const assert = require('assert');
const path = require('path');
const F = require('../lib/fits');
const server = require('../server');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const PXS = 6.15 / 3600, NX = 300, SHIFT = [1.3, -0.8];
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const card = (k, v) => (k.padEnd(8) + '= ' + (typeof v === 'string' ? `'${v}'`.padEnd(20) : typeof v === 'boolean' ? (v ? 'T' : 'F').padStart(20) : String(v).padStart(20))).padEnd(80);
const header = cards => { const s = cards.map(([k, v]) => card(k, v)).join('') + 'END'.padEnd(80); return s.padEnd(Math.ceil(s.length / 2880) * 2880); };
const wcsCards = (crpix) => [['CTYPE1', 'RA---TAN'], ['CTYPE2', 'DEC--TAN'], ['CRPIX1', crpix[0]], ['CRPIX2', crpix[1]], ['CRVAL1', 190], ['CRVAL2', -4], ['CD1_1', -PXS], ['CD1_2', 0], ['CD2_1', 0], ['CD2_2', PXS]];
const ext = (name, fn, extra = []) => {
  const hd = header([['XTENSION', 'IMAGE'], ['BITPIX', -32], ['NAXIS', 2], ['NAXIS1', NX], ['NAXIS2', NX], ['PCOUNT', 0], ['GCOUNT', 1], ['EXTNAME', name], ...extra]);
  const data = Buffer.alloc(Math.ceil(NX * NX * 4 / 2880) * 2880);
  for (let i = 0; i < NX * NX; i++) data.writeFloatBE(fn[i], i * 4);
  return Buffer.concat([Buffer.from(hd, 'ascii'), data]);
};
function makeCutout(epoch, seed, misalign) {
  const r = rng(seed), img = new Float32Array(NX * NX), R = rng(99);
  for (let y = 0; y < NX; y++) for (let x = 0; x < NX; x++) img[y * NX + x] = 40 + 0.03 * x + 0.02 * y + (r() + r() + r() + r() - 2) * 1.7;
  const stars = []; for (let i = 0; i < 70; i++) stars.push([20 + R() * 260, 20 + R() * 260, 25 + R() * 250]);
  const src = stars.map(([x, y, a]) => misalign && epoch === 1 && x > 150 ? [x + 5, y + 3, a] : [x, y, a]);
  src.push(epoch === 0 ? [100, 200, 70] : [109, 205, 70]);          // slow mover (moves 9,5 px)
  src.push(epoch === 0 ? [200, 90, 90] : [60, 210, 90]);            // fast asteroid, far apart in the two epochs
  for (const [sx, sy, a] of src) for (let y = Math.max(0, Math.floor(sy - 8)); y < Math.min(NX, sy + 9); y++) for (let x = Math.max(0, Math.floor(sx - 8)); x < Math.min(NX, sx + 9); x++)
    img[y * NX + x] += a * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * 1.5 ** 2));
  const crpix = epoch === 0 ? [150.5, 150.5] : [150.5 + SHIFT[0], 150.5 + SHIFT[1]];
  return Buffer.concat([Buffer.from(header([['SIMPLE', true], ['BITPIX', 8], ['NAXIS', 0], ['EXTEND', true]]), 'ascii'), ext('IMAGE', img, wcsCards(crpix)), ext('ZODI', new Float32Array(NX * NX))]);
}
const wcs1 = F.makeWCS(Object.fromEntries(wcsCards([150.5, 150.5])));
const skyOf = (x, y) => F.pix2sky(wcs1, x + 1, y + 1);

const BANDS = [[0.9, 1.0], [2.95, 3.05], [4.4, 4.5]], MJD = [60900, 61082];
const images = [];
MJD.forEach((m, e) => BANDS.forEach((b, k) => images.push({ url: `https://irsa.ipac.caltech.edu/ibe/data/spherex/e${e}_b${k}.fits`, id: `E${e}B${k}`, det: 'D' + (k + 1), mjd: m + k * 0.5, lam0: b[0], lam1: b[1], lam: (b[0] + b[1]) / 2 })));
const known = e => {
  const ast = skyOf(...(e === 0 ? [200, 90] : [60, 210])), faint = skyOf(...(e === 0 ? [120, 60] : [140, 70]));
  return [{ num: 4321, name: 'Fastrock', cls: 'MB>Inner', vmag: 17.5, err: 0.1, dra: 31, ddec: -8, dgeo: 1.2, dsun: 2.1, ra: ast[0], dec: ast[1] },
          { num: null, name: '2025 QX9', cls: 'NEO>Apollo', vmag: 24.9, err: 1, dra: 80, ddec: 5, dgeo: .1, dsun: 1, ra: faint[0], dec: faint[1] }];
};
const ALADIN_STUB = `window.A={init:Promise.resolve(),aladin(sel,o){let ra=190,dec=-4,fov=1.5;
 return{getRaDec:()=>[ra,dec],getFov:()=>[fov,fov],setFov:v=>{fov=v},gotoRaDec:(r,d)=>{ra=r;dec=d},
 world2pix:(r,d)=>{const s=innerHeight/fov;return[innerWidth/2-(r-ra)*Math.cos(dec*Math.PI/180)*s,innerHeight/2-(d-dec)*s]},
 pix2world:()=>[ra,dec],newImageSurvey:x=>x,setBaseImageLayer:()=>{},setImageSurvey:()=>{}}}};`;

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
  const errors = [], calls = [], debugPosts = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  if (process.env.E2E_DEBUG) page.on('console', m => console.log('  [page]', m.type(), m.text()));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route(/aladin\.cds\.unistra\.fr/, r => r.fulfill({ contentType: 'text/javascript', body: ALADIN_STUB }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.route(/127\.0\.0\.1:\d+\/api\//, async route => {   // our own server only, not Aladin's /AladinLite/api/ script
    const u = new URL(route.request().url()), q = Object.fromEntries(u.searchParams); calls.push(u.pathname);
    const json = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/api/spherex/search') { const im = +q.dec > -3.9995 ? images.map(x => ({ ...x, url: x.url.replace('/e', '/m') })) : images; return +q.ra > 100 ? json({ count: im.length, images: im }) : json({ count: 0, images: [] }); }
    if (u.pathname === '/api/debug/save') { debugPosts.push(JSON.parse(route.request().postData() || 'null')); return json({ dir: 'debug-cutouts/test', cutouts: 2, searches: 1 }); }
    if (u.pathname === '/api/spherex/cutout') { const m = /([em])(\d)_b(\d)/.exec(q.url); return route.fulfill({ status: 200, contentType: 'application/fits', body: makeCutout(+m[2], 10 + +m[2] * 7 + +m[3], m[1] === 'm') }); }
    if (u.pathname === '/api/movers') { const e = +q.mjd > 61000 ? 1 : 0, items = known(e); return json({ mjd: +q.mjd, count: items.length, items }); }
    return json({ error: 'unexpected ' + u.pathname }, 404);
  });

  await page.goto(base + '/');
  await page.waitForSelector('#alist li');
  await page.click('#go');
  await page.fill('#q', '190 -4');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#alist li:nth-child(5).done', { timeout: 60000 });
  await page.waitForTimeout(400);

  const states = await page.$$eval('#alist li', els => els.map(e => [e.querySelector('b').firstChild.textContent, e.className.replace('ag ', ''), e.querySelector('small').textContent]));
  console.log(states.map(s => `  ${s[0].padEnd(10)} ${s[1].padEnd(5)} ${s[2]}`).join('\n'));
  assert.deepStrictEqual(states.map(s => s[1]), ['done', 'done', 'done', 'done', 'done']);

  const rep = await page.evaluate(() => S.report);
  assert.ok(rep, 'no report');
  assert.strictEqual(rep.epochCount, 2);
  assert.ok(Math.abs(rep.wavelengthUm - 3) < 0.15, 'colour should be the shared 3 µm band, got ' + rep.wavelengthUm);
  assert.ok(rep.alignment.ok && rep.alignment.method === 'stars' && Math.abs(rep.alignment.dx + SHIFT[0]) < 0.12 && Math.abs(rep.alignment.dy + SHIFT[1]) < 0.12, JSON.stringify(rep.alignment));
  console.log('  alignment', JSON.stringify(rep.alignment));
  if (process.env.E2E_DEBUG) console.log(JSON.stringify(await page.evaluate(() => {
    const f = S.field, a = frameOf(0), b = frameOf(1), pk = fr => F.detectPeaks(fr.flat, f.n, fr.st, 5, 600), pa = pk(a), pb = pk(b);
    const near = (l, x, y) => l.filter(p => Math.hypot(p.x - x, p.y - y) < 8).map(p => [+p.x.toFixed(1), +p.y.toFixed(1), +p.snr.toFixed(0)]);
    return { n: f.n, stA: a.st, stB: b.st, nA: pa.length, nB: pb.length, shiftB: b.shift, E1mover: near(pa, 295.5 - 100, 295.5 - 200), E2mover: near(pb, 295.5 - 109, 295.5 - 205), E2ast: near(pb, 295.5 - 60, 295.5 - 210), E1ast: near(pa, 295.5 - 200, 295.5 - 90) };
  })));
  // 182 days apart: a star can move at most 11"/yr * 0.5 yr = 5.5" (< 1 px), so no "moved" pairs are allowed. The source that
  // jumps 10 px is physically impossible for a star, so it must be reported honestly as vanished + appeared, not as a mover.
  assert.ok(rep.quality && rep.quality.ok && rep.quality.pairSearch === false, 'quality: ' + JSON.stringify(rep.quality));
  assert.ok(Math.abs(rep.quality.maxStarMotionArcsec - 11 * 182 / 365.25) < 0.1, 'star limit ' + rep.quality.maxStarMotionArcsec);
  assert.ok(!rep.candidates.some(c => c.kind === 'pair'), 'no pairs allowed: ' + JSON.stringify(rep.candidates.map(c => c.kind)));
  const exp = skyOf(109, 205), jumper = rep.candidates.find(c => c.kind === 'new' && !c.knownMatch);
  assert.ok(jumper && Math.hypot((jumper.to.ra - exp[0]) * Math.cos(-4 * Math.PI / 180), jumper.to.dec - exp[1]) * 3600 < 12, 'jumper position off: ' + JSON.stringify(jumper));
  assert.ok(rep.candidates.some(c => c.kind === 'gone' && !c.knownMatch), 'jumper should also leave a "vanished" entry');
  const lone = rep.candidates;
  assert.ok(lone.some(c => c.kind === 'gone' && c.knownMatch && /Fastrock/.test(c.knownMatch)) && lone.some(c => c.kind === 'new' && c.knownMatch && /Fastrock/.test(c.knownMatch)),
    'asteroid should show up gone+new and be matched to SkyBoT: ' + JSON.stringify(lone.map(c => [c.kind, c.knownMatch])));
  // Asteroid Proof Card: the SkyBoT-matched entries pass every check (position, brightness V 17.5, shape); the faint V 24.9 NEO is never "seen"
  assert.ok(lone.filter(c => /Fastrock/.test(c.knownMatch || '')).every(c => c.status === 'confirmed' && c.proof.checks.every(x => x.ok === true)), 'proof checks: ' + JSON.stringify(lone.map(c => [c.status, c.proof && c.proof.checks.map(x => x.name + ':' + x.ok)])));
  assert.ok(!rep.knownObjects.find(k => /QX9/.test(k.name)).detected, 'V 24.9 object must not count as seen');
  assert.strictEqual(rep.candidates.length, 4, 'stars must not create candidates: ' + JSON.stringify(rep.candidates.map(c => [c.kind, +c.snr.toFixed(0)])));
  const fast = rep.knownObjects.find(k => /Fastrock/.test(k.name)), faint = rep.knownObjects.find(k => /QX9/.test(k.name));
  assert.ok(fast && fast.detected, 'Fastrock should be seen');
  assert.ok(faint && !faint.detected, 'faint object should not be claimed as seen: ' + JSON.stringify(faint));
  console.log(`  ${rep.candidates.length} candidates, ${rep.knownObjects.length} known objects (${rep.knownObjects.filter(k => k.detected).length} seen)`);

  const card_ = await page.textContent('#card');
  assert.ok(/Agent report/.test(card_) && /Fastrock/.test(card_) && /Download report/.test(card_));
  assert.ok(await page.evaluate(() => S.mode === (multi() ? 'change' : 'diff')), 'after a run: Changes view (several images per epoch) or Difference (one)');
  await page.screenshot({ path: path.join(process.env.E2E_OUT || __dirname, 'e2e-agents.png') });

  // The overlay actually painted: the difference image should leave coloured pixels on the canvas
  const painted = await page.evaluate(() => { const c = document.getElementById('ov'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  assert.ok(painted > 20000, 'overlay looks empty: ' + painted);

  // Clicking a candidate opens its card; download button produces JSON
  await page.click('#card .mv');
  await page.waitForFunction(() => /Candidate C\d/.test(document.getElementById('card').textContent));
  await page.click('text=Back to report');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Download report')]);
  assert.ok(/arcnave-report-190\.00_-4\.00\.json/.test(dl.suggestedFilename()));
  assert.ok(/Data check: passed/.test(await page.textContent('#card')), 'data check line missing');

  // Debug bundle button: visible on a local run, posts the report and the chosen images
  assert.ok(await page.isVisible('#dbg'), 'debug button should show on localhost');
  await page.click('#dbg'); await page.waitForFunction(() => /Debug bundle saved/.test(document.getElementById('stat').textContent));
  assert.ok(debugPosts.length === 1 && debugPosts[0].report && debugPosts[0].report.epochCount === 2 && debugPosts[0].frames.length >= 2 && debugPosts[0].epochs[1].chosen.url, 'debug post: ' + JSON.stringify(debugPosts[0]).slice(0, 300));

  // Misaligned field (half the stars jump 5,3 px between epochs, like the first live run): the Analyst must refuse to report changes
  await page.fill('#q', '190 -3.999'); await page.press('#q', 'Enter');
  try { await page.waitForFunction(() => S.report && S.report.target.dec > -3.9995, null, { timeout: 60000 }); }
  catch (e) { console.log('  agents:', JSON.stringify(await page.$$eval('#alist li', els => els.map(x => x.className + ' | ' + x.querySelector('small').textContent))), await page.textContent('#stat')); throw e; }
  const bad = await page.evaluate(() => ({ q: S.report.quality, n: S.report.candidates.length, st: document.querySelector('#alist li:nth-child(4)').className, msg: document.querySelector('#alist li:nth-child(4) small').textContent }));
  console.log('  misaligned field:', bad.msg, JSON.stringify({ nearMiss: bad.q.nearMiss, matched: bad.q.matched }));
  assert.ok(bad.q && !bad.q.ok && bad.n === 0 && /warn/.test(bad.st) && /do not line up/.test(bad.msg), JSON.stringify(bad));
  assert.ok(/Data check: not reliable/.test(await page.textContent('#card')));

  // Failure path: nothing covers RA 10, so Archivist fails and the rest are skipped
  await page.fill('#q', '10 20'); await page.press('#q', 'Enter');
  await page.waitForSelector('#alist li:nth-child(2).err', { timeout: 20000 });
  const st2 = await page.$$eval('#alist li', els => els.map(e => e.className.replace('ag ', '')));
  assert.deepStrictEqual(st2, ['done', 'err', 'skip', 'skip', 'skip']);
  assert.ok(/No SPHEREx images/.test(await page.textContent('#alist li:nth-child(2)')));

  // Auto-run off: Fly to just moves the view
  await page.click('#aauto'); const before = calls.length;
  await page.fill('#q', '150 2'); await page.press('#q', 'Enter'); await page.waitForTimeout(300);
  assert.strictEqual(calls.length, before, 'agents should not run when auto is off');
  assert.deepStrictEqual(await page.evaluate(() => S.al.getRaDec()), [150, 2]);

  assert.deepStrictEqual(errors, [], 'browser errors:\n' + errors.join('\n'));
  await browser.close(); server.close();
  console.log('\nE2E passed');
  process.exit(0);
})().catch(e => { console.error('\nE2E FAILED\n' + (e.stack || e)); process.exit(1); });
