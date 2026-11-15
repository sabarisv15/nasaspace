'use strict';
// ARCNAVE front end. Aladin Lite draws the base sky; a transparent canvas on top draws
// real SPHEREx cutouts (reprojected onto a tangent grid) and known movers.
const $ = id => document.getElementById(id), F = window.SkyFits;
const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
const PX = 6.15 / 3600, MAXN = 700; // SPHEREx pixel is about 6.2 arcsec
const S = { al: null, field: null, images: [], eps: [], frames: new Map(), movers: new Map(), tracks: new Map(),
  band: 3, mode: 'time', ei: 0, split: 50, flipped: false, sel: null, ecl: false, rt: 0, diff: null, hits: [], lab: false,
  run: 0, load: 0, ref: null, auto: true, geo: new Map(), ag: {}, cands: [], known: [], report: null, mvp: new Map(), fp: new Map(), lastErr: '',
  depth: 8, slots: [], seq: [], ti: 0, bi: 0, stacks: new Map(), alignVer: 0, inside: null, blinkAt: -1, cv: 'ep', chg: null };

/* ---------- helpers ---------- */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}
const mjdDate = m => new Date((m - 40587) * 864e5);
const fmtMonth = m => mjdDate(m).toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDay = m => mjdDate(m).toISOString().slice(0, 10);
const fmtAng = as => as < 90 ? `${as.toFixed(0)}″` : `${(as / 60).toFixed(1)}′`;          // small motions in arcsec, not "0.0′"
const fmtDur = hrs => hrs < 1 ? `${Math.round(hrs * 60)} min` : hrs < 48 ? `${hrs.toFixed(1)} h` : `${(hrs / 24).toFixed(1)} days`;
async function api(path) {
  const r = await fetch(path); let j = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
  return j;
}
function toast(t) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.i); toast.i = setTimeout(() => e.hidden = true, 3200); }
function stat(msg, bad) { const e = $('stat'); e.textContent = msg; e.classList.toggle('err', !!bad); }

/* ---------- epochs and image choice ---------- */
function groupEpochs(imgs) {
  const eps = []; let cur = null;
  for (const im of imgs) {
    if (!cur || im.mjd - cur.t1 > 60) { cur = { imgs: [], t0: im.mjd, t1: im.mjd }; eps.push(cur); }
    cur.imgs.push(im); cur.t1 = im.mjd;
  }
  return eps;
}
// Wavelength maps per detector (WCS-WAVE tables). D4 ships with the app; others are learned from their first cutout.
const TABLES = Object.assign({}, window.SkyWave ? SkyWave.BUILTIN_TABLES : {});
// Where the field lands on each image's detector, what fraction of the field it covers, and the real wavelength there.
// Predicted from the archive footprint (poly) before downloading anything; null when the archive gave no footprint.
function geo(im) {
  if (!S.field || !window.SkyWave) return null;
  if (S.geo.has(im.url)) return S.geo.get(im.url);
  let g = null;
  if (im.poly) {
    const pos = SkyWave.detPosFromPoly(im.poly, S.field.ra, S.field.dec);
    if (pos) {
      const t = TABLES[im.det], w = t ? SkyWave.lamAtDetector(t, pos.x, pos.y) : null;
      g = { pos, cover: SkyWave.coverage(pos, S.field.size / 2 / PX), lam: w ? w.lam : null };
    }
  }
  S.geo.set(im.url, g); return g;
}
// Best estimate of an image's wavelength at this field: measured (if downloaded) > predicted > middle of the detector's band.
const lamOf = im => { const f = S.frames.get(im.url); if (f && f.lamReal != null) return f.lamReal; const g = geo(im); return g && g.lam != null ? g.lam : im.lam; };
// For CHOOSING images use a value that does not change when an image is downloaded (predicted first), so the choice cannot
// flip back and forth between near-identical images; the measured value is shown and reported.
const lamRank = im => { const g = geo(im); if (g && g.lam != null) return g.lam; const f = S.frames.get(im.url); return f && f.lamReal != null ? f.lamReal : im.lam; };
// For colour b, pick the image of this epoch whose real wavelength at the field is closest to b, preferring images that
// cover the whole field. Before v0.3 every image of a detector looked the same (same nominal band), so the first one was
// taken: on a real field that gave 3.58 vs 3.82 micron and half the field missing.
function pickImage(ep, b) {
  let pool = ep.imgs.filter(im => b >= im.lam0 && b <= im.lam1);
  if (!pool.length) pool = ep.imgs;
  let best = null, bd = Infinity;
  for (const im of pool) {
    const g = geo(im), known = g && g.lam != null;
    const d = Math.abs(lamRank(im) - b) + 0.5 * (1 - (g ? g.cover : 0.5)) + (known ? 0 : 0.05);
    if (d < bd) { bd = d; best = im; }
  }
  return best;
}
// Slot 0 of every epoch: the image whose colour matches the other epochs best (v0.5 behaviour). With several images per
// epoch (v0.6) more slots are added at other matched colours; see buildSlotsNow().
const chosen = i => (S.slots.length && S.slots[0][i]) || pickImage(S.eps[i], S.band);
const multi = () => S.depth > 1 && S.slots.length > 1;
const epochImgs = i => multi() ? S.slots.map(sl => sl[i]) : [chosen(i)];
const rawOf = i => S.eps[i] && S.frames.get(chosen(i).url);
const refFrame = () => rawOf(0);
// What the comparison views and the Analyst use for an epoch: the median stack of its images (several images) or its one image.
const frameOf = i => !S.eps[i] ? null : multi() ? stackOf(i) : rawOf(i);
function buildSlotsNow() {
  const first = S.eps.map(ep => pickImage(ep, S.band));
  if (S.depth <= 1 || S.eps.length < 1 || !window.SkySlots) { S.slots = [first]; buildSeq(); return; }
  const item = (im, e) => { const g = geo(im); return { id: im.id, det: im.det, mjd: im.mjd, lam: lamRank(im), cover: g ? g.cover : null, im, e }; };
  // Strict colour match first (about a quarter of a channel); if that gives too few images, accept up to about half a channel
  // (bands 1 to 4 step about 0.08 um between pointings, band 6 much finer). The largest difference used is reported.
  const lists = S.eps.map((ep, e) => ep.imgs.map(im => item(im, e))), f0 = first.map((im, e) => item(im, e));
  let sl = SkySlots.buildSlots(lists, S.depth, { first: f0, tolFrac: 0.008 });
  if (sl.length < S.depth) { const wide = SkySlots.buildSlots(lists, S.depth, { first: f0, tolFrac: 0.015 }); if (wide.length > sl.length) sl = wide; }
  S.slots = sl.length ? sl.map(x => x.items.map(it => it.im)) : [first];
  S.slotDLam = sl.length ? Math.max(...sl.map(x => x.dLam)) : 0;
  buildSeq();
}
// All images of all slots in time order (what Time machine steps through).
function buildSeq() {
  S.seq = [];
  S.eps.forEach((ep, e) => epochImgs(e).forEach((im, k) => S.seq.push({ e, k, im })));
  S.seq.sort((p, q) => p.e - q.e || p.im.mjd - q.im.mjd);
  S.seq.forEach((x, i) => { x.i = i; x.n = S.seq.filter(y => y.e === x.e).length; x.pos = S.seq.filter(y => y.e === x.e && y.i < i).length + 1; });
  S.stacks.clear();
}
// Median stack of an epoch's loaded images, cached until anything is re-aligned.
function stackOf(i) {
  const frs = epochImgs(i).map(im => S.frames.get(im.url)).filter(Boolean), key = i + '|' + frs.map(f => f.im.url).join(',') + '|' + S.alignVer;
  if (frs.length < 2) return rawOf(i);
  const c = S.stacks.get(i); if (c && c.key === key) return c.f;
  const n = S.field.n, ms = F.medianStack(frs.map(f => f.flat), n, { touched: frs.map(f => f.touched) });
  const st = F.robustStats(ms.flat); if (!st) return rawOf(i);
  const touched = new Float32Array(n * n); for (let p = 0; p < touched.length; p++) touched[p] = ms.touched[p] >= 0.5 ? 1 : 0;
  const base = rawOf(i) || frs[0], cv = document.createElement('canvas'); cv.width = cv.height = n;
  const f = { im: base.im, flat: ms.flat, flat0: ms.flat, touched, st, canvas: cv, rgb: base.rgb, shift: base.shift, lamReal: base.lamReal, mask: base.mask, check: base.check, stack: frs.length, frames: frs };
  paint(f); S.stacks.set(i, { key, f }); return f;
}
const seqAt = () => S.seq[Math.max(0, Math.min(S.ti, S.seq.length - 1))];
const blinkList = () => S.bi < S.eps.length ? S.seq.filter(x => x.e === S.bi) : S.seq;
function view() {
  const E = S.eps.length;
  if (S.mode === 'time') { if (multi() && S.seq.length) { const e = seqAt().e; return { a: e, b: e }; } return { a: S.ei, b: S.ei }; }
  if ((S.mode === 'blink' && multi()) || S.mode === 'change') return { a: 0, b: E - 1 };
  return { a: 0, b: E > 1 ? Math.max(1, Math.min(S.ei, E - 1)) : 0 };
}
const epLabel = i => `Epoch ${i + 1}, ${fmtMonth(S.eps[i].t0)}`;

/* ---------- loading a field ---------- */
// Archivist's search: list SPHEREx images for this spot and group them into epochs. Returns true on success.
async function loadField(ra, dec, opts = {}) {
  if (!S.al) return false;
  const mine = ++S.load, size = +$('csize').value, n = Math.min(MAXN, Math.round(size / PX));
  S.rt++; S.frames.clear(); S.fp.clear(); S.geo.clear(); S.movers.clear(); S.mvp.clear(); S.tracks.clear(); S.diff = null; S.sel = null; S.ref = null;
  S.cands = []; S.known = []; S.report = null; S.eps = []; S.images = []; S.slots = []; S.seq = []; S.stacks.clear(); S.inside = null; S.chg = null; if (S.px) { S.px.res = null; S.px.ctx = null; S.px.spot = null; S.px.map = null; $('pxc').hidden = true; $('pxs').textContent = ''; $('pxt').textContent = ''; } S.ti = 0; S.bi = 0; $('card').hidden = true; renderStrip();
  S.field = { ra, dec, size, n, s: PX };
  $('load').disabled = true; stat('Searching the IRSA archive for SPHEREx images...');
  let r;
  try { r = await api(`/api/spherex/search?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}`); }
  catch (e) {
    if (mine !== S.load) return false;
    S.lastErr = 'IRSA search failed: ' + e.message; stat(S.lastErr, true); S.field = null; $('load').disabled = false; return false;
  }
  if (mine !== S.load) return false;   // a newer search took over
  $('load').disabled = false;
  S.images = r.images; S.eps = groupEpochs(r.images);
  if (!S.eps.length) { S.lastErr = 'No SPHEREx images cover this spot in the archive yet. Try another position.'; stat(S.lastErr, true); S.field = null; return false; }
  S.ei = S.eps.length - 1; // start on the latest epoch
  if (opts.auto) { S.band = bestBand(); $('band').value = S.band; }
  buildSlotsNow(); renderStrip();
  setSlider();
  stat(`${r.count} spectral images in ${S.eps.length} epoch${S.eps.length > 1 ? 's' : ''}.`);
  return true;
}
// Colour at which every epoch has an image closest in wavelength to the others, so stars match best when subtracted.
function bestBand() {
  let best = S.band, bc = Infinity;
  for (let l = 0.8; l <= 4.95; l += 0.05) {
    const ims = S.eps.map(ep => pickImage(ep, l)), lams = ims.map(lamRank);
    const miss = ims.reduce((s_, im) => { const g = geo(im); return s_ + (g ? 1 - g.cover : 0.5); }, 0);
    const cost = Math.max(...lams) - Math.min(...lams) + 0.01 * Math.abs(l - 3) + 0.3 * miss;
    if (cost < bc) { bc = cost; best = l; }
  }
  return +best.toFixed(2);
}
function setSlider() {
  const E = S.eps.length, t = $('tm');
  if (multi() && S.mode === 'time') { t.min = 0; t.max = Math.max(0, S.seq.length - 1); t.value = Math.min(S.ti, +t.max); S.ti = +t.value; $('tml').textContent = 'Image'; }
  else if (multi() && S.mode === 'blink') { t.min = 0; t.max = E; t.value = Math.min(S.bi, E); S.bi = +t.value; $('tml').textContent = 'Blink'; blinkList().forEach(x => moversFor(x)); }
  else {
    t.min = S.mode === 'time' ? 0 : Math.min(1, E - 1); t.max = Math.max(0, E - 1); t.value = Math.max(+t.min, Math.min(S.ei, +t.max));
    S.ei = +t.value; $('tml').textContent = 'Epoch';
  }
  updateLabels();
}
// Known movers for one image of the sequence: slot 0 uses the epoch's lookup, other images their own exact time.
const moversFor = x => x.im === chosen(x.e) ? (ensureMovers(x.e), moversOf(x.e)) : (ensureMoversIm(x.im), moversIm(x.im));
let rtimer = null;
function refreshSoon() { clearTimeout(rtimer); rtimer = setTimeout(refresh, 350); }
async function refresh() {
  if (!S.field || !S.eps.length) return;
  const t = ++S.rt, { a, b } = view(), need = [...new Set([a, b])];
  S.diff = null;
  for (const i of need) {
    stat(`Loading ${epLabel(i)}...`);
    try { await ensureFrame(i); } catch (e) { if (t === S.rt) stat(`${epLabel(i)}: ${e.message}`, true); return; }
    if (t !== S.rt) return;
  }
  need.forEach(ensureMovers);
  if (S.mode !== 'time' && S.eps.length < 2) stat('Only one epoch is available here so far, so there is nothing to compare yet.', true);
  else stat(`Showing ${need.map(i => epLabel(i)).join(' vs ')}.`);
  updateLabels(); writeHash();
}
function ensureFrame(i) { return ensureImg(chosen(i)); }
function ensureImg(im) {
  const f = S.frames.get(im.url);
  if (f) return Promise.resolve(f);
  let p = S.fp.get(im.url);
  if (!p) { p = loadFrame(im).finally(() => S.fp.delete(im.url)); S.fp.set(im.url, p); }
  return p;
}
async function loadFrame(im) {
  const fld = S.field;
  const r = await fetch(`/api/spherex/cutout?url=${encodeURIComponent(im.url)}&ra=${fld.ra}&dec=${fld.dec}&size=${fld.size}`);
  if (S.field !== fld) throw new Error('cancelled');
  if (!r.ok) { let m = 'cutout failed (HTTP ' + r.status + ')'; try { m = (await r.json()).error; } catch { /* keep */ } throw new Error(m); }
  const buf = await r.arrayBuffer();
  if (S.field !== fld) throw new Error('cancelled');
  const f = buildFrame(buf, im, fld);
  S.frames.set(im.url, f);
  while (S.frames.size > 60) S.frames.delete(S.frames.keys().next().value);
  if (im.url === chosen(0).url) for (const o of S.frames.values()) alignFrame(o);   // new reference: re-register everything on it
  else alignFrame(f);
  renderStrip();
  return f;
}
function buildFrame(buf, im, fld) {
  // Shared with the tests (lib/fits.js prepareCutout): ZODI removed, FLAGS bad pixels masked (unmasked, single glitch pixels look
  // like very bright stars and fake "changes"; seen on the first live run), reprojected onto the field grid, background flattened.
  const grid = { ra0: fld.ra, dec0: fld.dec, s: fld.s, n: fld.n };
  const pc = F.prepareCutout(buf, grid), g = pc.flat, st = pc.st, touched = pc.touched, mask = pc.mask, hd = pc.hdus, hi = { header: pc.header };
  if (!st) throw new Error('this image has no valid pixels at this spot');
  // Real wavelength at the field centre, from the file's WCS-WAVE table (null if the table is missing). The first cutout of a
  // detector also teaches the app that detector's wavelength map, so later image choices use real wavelengths.
  let lamReal = null, check = null;
  if (window.SkyWave) {
    try { const w = SkyWave.waveAtSky(F, buf, fld.ra, fld.dec); if (w && !w.outside) lamReal = w.lam; } catch { /* keep prediction */ }
    try { if (!TABLES[im.det]) { const t = SkyWave.readWaveTable(buf, hd); if (t) { TABLES[im.det] = t; S.geo.clear(); } } } catch { /* ignore */ }
    try {   // how good was the footprint-based prediction for this image?
      const gp = geo(im), real = SkyWave.detPosFromHeader(F, hi.header, fld.ra, fld.dec);
      if (gp && real) check = { detErrPx: +Math.hypot(gp.pos.x - real.x, gp.pos.y - real.y).toFixed(1), lamPred: gp.lam, lamReal };
    } catch { /* no check */ }
  }
  const lamShow = lamReal ?? im.lam;
  const rgb = F.hslToRgb(190 - (lamShow - 0.75) / 4.25 * 150, 0.85, 0.58);
  const cv = document.createElement('canvas'); cv.width = cv.height = fld.n;
  const f = { im, flat0: g, touched0: touched, flat: g, touched, st, canvas: cv, rgb, shift: null, lamReal, mask, check,
    keep0: pc.flatKeep, flatKeep: pc.flatKeep, hard0: pc.touchedHard, touchedHard: pc.touchedHard };
  paint(f);
  return f;
}
// Shown as measured: OUTLIER-only pixels (the pipeline also flags moving asteroids with it) at their real values.
const seeOf = f => f.flatKeep || f.flat;
function paint(f) { const n = S.field.n; f.canvas.getContext('2d').putImageData(new ImageData(F.renderRGBA(seeOf(f), f.st, f.rgb), n, n), 0, 0); }

// Aligner's core: epoch 1's frame is the reference; every other frame is registered onto it by matching stars (median
// offset of matched bright stars), with cross-correlation as a fallback. On real SPHEREx data the star method found a
// 0.03 px offset from 72 stars, while cross-correlation (fooled by one-pixel-wide stars and colour differences) said 0.2 px.
function alignFrame(f) {
  const n = S.field.n, ref = refFrame();
  if (!ref || ref === f) { f.shift = { ok: true, ref: true, dx: 0, dy: 0, method: 'reference' }; f.flatKeep = f.keep0; f.touchedHard = f.hard0; setFlat(f, f.flat0, f.touched0); S.ref = f; return; }
  const st = F.alignByStars(ref.flat0, f.flat0, n), sh = st.ok ? st : Object.assign(F.estimateShift(ref.flat0, f.flat0, n, 6), { method: 'correlation' });
  f.shift = sh;
  const apply = sh.ok && Math.hypot(sh.dx, sh.dy) > 0.05 && Math.hypot(sh.dx, sh.dy) < 4;
  const mv = a => a && apply ? F.shiftImage(a, n, sh.dx, sh.dy) : a;
  f.flatKeep = mv(f.keep0); f.touchedHard = mv(f.hard0);
  setFlat(f, mv(f.flat0), mv(f.touched0));
}
function setFlat(f, flat, touched) { f.flat = flat; f.touched = touched; paint(f); S.diff = null; S.alignVer++; f.thumb = null; }
const shiftText = sh => !sh ? '?' : sh.method === 'reference' ? 'reference frame' : sh.method === 'stars' ? `${sh.nMatch} stars matched, scatter ${sh.spread.toFixed(2)} px` : `match quality ${(sh.ncc ?? 0).toFixed(2)}`;

/* ---------- known movers (SkyBoT) ---------- */
function ensureMovers(i) {
  const im = chosen(i), fld = S.field, key = i + ':' + im.url;
  if (S.mvp.has(key)) return S.mvp.get(key);
  S.movers.set(key, { items: [], loading: true });
  const p = api(`/api/movers?ra=${fld.ra.toFixed(5)}&dec=${fld.dec.toFixed(5)}&radius=${(fld.size * 0.75).toFixed(3)}&mjd=${im.mjd.toFixed(4)}`)
    .then(r => { if (S.field === fld) S.movers.set(key, { items: r.items, mjd: im.mjd }); })
    .catch(e => { if (S.field === fld) { S.movers.set(key, { items: [], err: e.message }); toast('Known movers unavailable: ' + e.message); } });
  S.mvp.set(key, p); return p;
}
const moversOf = i => S.eps[i] ? S.movers.get(i + ':' + chosen(i).url) : null;
// SkyBoT for one image's exact time (used for the images of an epoch beyond slot 0).
function ensureMoversIm(im) {
  const fld = S.field, key = 'im:' + im.url;
  if (S.mvp.has(key)) return S.mvp.get(key);
  const p = api(`/api/movers?ra=${fld.ra.toFixed(5)}&dec=${fld.dec.toFixed(5)}&radius=${(fld.size * 0.75).toFixed(3)}&mjd=${im.mjd.toFixed(4)}`)
    .then(r => { if (S.field === fld) S.movers.set(key, { items: r.items, mjd: im.mjd }); })
    .catch(e => { if (S.field === fld) S.movers.set(key, { items: [], err: e.message }); });
  S.mvp.set(key, p); return p;
}
const moversIm = im => S.movers.get('im:' + im.url);
const itemKey = it => it.num || it.name;

/* ---------- overlay drawing ---------- */
const ov = $('ov'), ctx = ov.getContext('2d'); let W = 0, H = 0, dpr = 1;
function sizeOv() { dpr = devicePixelRatio || 1; W = innerWidth; H = innerHeight; ov.width = W * dpr; ov.height = H * dpr; }
addEventListener('resize', sizeOv); sizeOv();
function proj(ra, dec) { try { const p = S.al.world2pix(ra, dec); return p && isFinite(p[0]) && isFinite(p[1]) ? p : null; } catch { return null; } }
function affine() {
  const f = S.field; if (!f) return null;
  const step = Math.max(f.size / 4, 0.02), c = (f.n - 1) / 2;
  const e = F.tanInv(step, 0, f.ra, f.dec), nn = F.tanInv(0, step, f.ra, f.dec);
  const P0 = proj(f.ra, f.dec), Px = proj(e[0], e[1]), Py = proj(nn[0], nn[1]);
  if (!P0 || !Px || !Py) return null;
  const k = f.s / step, ex = [(Px[0] - P0[0]) * k, (Px[1] - P0[1]) * k], ey = [-(Py[0] - P0[0]) * k, -(Py[1] - P0[1]) * k];
  return { a: ex[0], b: ex[1], c: ey[0], d: ey[1], e: P0[0] - (c + 0.5) * (ex[0] + ey[0]), f: P0[1] - (c + 0.5) * (ex[1] + ey[1]) };
}
function drawImg(T, cv, alpha = 1) {
  if (!cv) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(dpr * T.a, dpr * T.b, dpr * T.c, dpr * T.d, dpr * T.e, dpr * T.f); ctx.drawImage(cv, 0, 0); ctx.restore();
}
function diffCanvas(fa, fb) {
  if (!fa || !fb) return null;
  if (S.diff && S.diff.a === fa && S.diff.b === fb) return S.diff.cv;
  const n = S.field.n, d = F.renderDiff(fa.flat, fb.flat), cv = document.createElement('canvas'); cv.width = cv.height = n;
  cv.getContext('2d').putImageData(new ImageData(d.rgba, n, n), 0, 0);
  S.diff = { a: fa, b: fb, cv }; return cv;
}
/* ---------- Changes view (v0.8): every epoch in its own colour, or every image in a colour of time ---------- */
// The images in time order that the view uses: all loaded images (several per epoch) or the one image of each epoch.
function changeItems() {
  const list = multi() && S.seq.length ? S.seq : S.eps.map((ep, e) => ({ e, im: chosen(e), i: e, pos: 1, n: 1 }));
  return list.map(x => ({ x, fr: S.frames.get(x.im.url) })).filter(o => o.fr);
}
function changeData() {
  if (!S.field || S.eps.length < 2) return null;
  if (!S.report && Object.keys(S.ag).length) return null;   // agents still running: build it once, after the report (it takes a second or two)
  const items = changeItems(), stacks = S.eps.map((_, e) => frameOf(e));
  if (items.length < 2 || stacks.some(f => !f)) return null;
  const key = items.map(o => o.x.im.url).join(',') + '|' + S.alignVer + '|' + stacks.length;
  if (S.chg && S.chg.key === key) return S.chg;
  const n = S.field.n, t0 = performance.now();
  const r = F.changeMaps(stacks.map(f => ({ flat: f.flat, st: f.st })), items.map(o => ({ flat: o.fr.flat, keep: o.fr.flatKeep, st: o.fr.st, mjd: o.x.im.mjd, slot: multi() ? o.x.k : null })), n, { nsig: 8 });
  const mk = rgba => { const cv = document.createElement('canvas'); cv.width = cv.height = n; cv.getContext('2d').putImageData(new ImageData(rgba, n, n), 0, 0); return cv; };
  const grid = { ra0: S.field.ra, dec0: S.field.dec, s: S.field.s, n };
  // a known asteroid caught inside an epoch explains its dots
  const ast = []; if (S.inside) for (const a of S.inside.asteroids) for (const sg of a.sightings) ast.push({ a, sg });
  for (const pk of r.peaks) {
    const sky = F.gridToSky(pk.x, pk.y, grid); pk.ra = sky[0]; pk.dec = sky[1]; pk.item = items[pk.k].x;
    const m = ast.find(o => o.sg.im.url === pk.item.im.url && Math.hypot(o.sg.x - pk.x, o.sg.y - pk.y) <= 2);
    pk.known = m ? m.a : knownOnTrack(pk);
    pk.kind = pk.known ? 'known' : pk.repeat === false ? 'single' : pk.sharp ? 'sharp' : pk.onStar ? 'star' : 'other';
  }
  S.chg = { key, items, r, epCv: mk(r.epochRGBA), imCv: mk(r.timeRGBA), ms: Math.round(performance.now() - t0) };
  renderChgPanel();
  return S.chg;
}
// A confirmed asteroid's measured positions (2+ sightings in one epoch) give its track; a dot on that track at this image's time is it.
function knownOnTrack(pk) {
  if (!S.inside) return null;
  const t = pk.item.im.mjd;
  for (const a of S.inside.asteroids) {
    if (!a.confirmed || a.sightings.length < 2 || a.e !== pk.item.e) continue;
    const sg = a.sightings.slice().sort((p, q) => p.mjd - q.mjd), s0 = sg[0], s1 = sg[sg.length - 1], dt = s1.mjd - s0.mjd; if (!(dt > 0)) continue;
    const u = (t - s0.mjd) / dt; if (u < -1 || u > 2) continue;
    if (Math.hypot(s0.x + u * (s1.x - s0.x) - pk.x, s0.y + u * (s1.y - s0.y) - pk.y) <= 2.5) return a;
  }
  return null;
}
const chgCss = c => `rgb(${c.map(v => Math.round(v)).join(',')})`;
function renderChgPanel() {
  const box = $('chg'); if (!box) return;
  box.hidden = S.mode !== 'change' || S.lab;
  document.querySelectorAll('[data-cv]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cv === S.cv));
  const L = $('chgl'), T = $('chgt'); L.replaceChildren(); T.replaceChildren();
  if (box.hidden) return;
  const d = S.chg && S.chg.key ? S.chg : null;
  if (!d) { L.append('Run the agents on a field with at least two epochs to see what changed.'); return; }
  if (S.cv === 'ep') {
    d.r.cols.forEach((c, e) => L.append(h('span', {}, h('i', { style: `background:${chgCss(c.map(v => v * 255))}` }), `Epoch ${e + 1} (${fmtMonth(S.eps[e].t0)}) only`)));
    L.append(h('span', {}, h('i', { style: 'background:#fff' }), 'in every epoch: unchanged'));
  } else {
    const it = d.items, first = it[0].x.im, last = it[it.length - 1].x.im;
    L.append(h('span', {}, `${fmtDay(first.mjd)}`, h('span', { class: 'grad' }), `${fmtDay(last.mjd)}`),
      h('span', {}, h('i', { style: 'background:#5a5a5a' }), 'grey: the sky that stays the same'));
  }
  // timeline: one bar per image (time order), height = spots brighter there than in the other images; faded part = too sharp (artefacts)
  const max = Math.max(4, ...d.r.counts); let lastE = -1;
  d.items.forEach((o, k) => {
    if (o.x.e !== lastE) { if (lastE >= 0) T.append(h('span', { class: 'sep' })); lastE = o.x.e; }
    const nAll = d.r.counts[k], nSh = d.r.sharpCounts[k], col = chgCss(d.r.hues[k]), hpx = v => Math.round(32 * v / max) + 'px';
    const b = h('button', { 'data-k': k, title: `Image ${k + 1} of ${d.items.length}: epoch ${o.x.e + 1}, ${fmtDay(o.x.im.mjd)} ${mjdDate(o.x.im.mjd).toISOString().slice(11, 16)} UTC. ${nAll} spot${nAll === 1 ? '' : 's'} brighter than in the other images (${nSh} look like artefacts: too sharp, or missing from the exposure minutes apart). Click to show this image.`,
      'aria-label': `Image ${k + 1}: ${nAll} changes`, onclick: () => { if (multi()) { S.ti = o.x.i; } else S.ei = o.x.e; S.sel = null; setMode('time'); } },
      h('span', { class: 'sh', style: `height:${hpx(nSh)};background:${col}` }), h('span', { style: `height:${hpx(nAll - nSh)};background:${col}` }));
    if (o.x.pos === 1) b.append(h('span', { class: 'el', style: 'left:0' }, 'E' + (o.x.e + 1)));
    T.append(b);
  });
}
function drawChangePeaks(T) {
  const d = S.chg; if (!d || S.cv !== 'im') return;
  // artefacts (cosmic rays) are only counted in the timeline (faded bars); drawing them all would bury the real changes
  const shown = d.r.peaks.filter(pk => pk.kind !== 'sharp' && pk.kind !== 'single').slice(0, 60);
  for (const pk of shown) {
    const p = proj(pk.ra, pk.dec); if (!p) continue;
    ctx.lineWidth = 1.5; ctx.strokeStyle = pk.kind === 'known' ? '#5ff0a0' : pk.kind === 'star' ? 'rgba(255,214,102,.9)' : chgCss(d.r.hues[pk.k]);
    if (pk.kind === 'star') ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(p[0], p[1], pk.kind === 'known' ? 10 : 8, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    S.hits.push({ x: p[0], y: p[1], chg: pk });
  }
}
function showChange(pk) {
  S.sel = { chg: pk }; const c = $('card'), x = pk.item, d = S.chg; c.replaceChildren(); c.hidden = false;
  const kindTxt = { known: ['ok', '✓ Known asteroid ' + (pk.known && pk.known.name)], single: ['near', 'One exposure only: a cosmic ray'], sharp: ['near', 'Too sharp: probably a cosmic ray or hot pixel'],
    star: ['unc', 'A star brighter in this image: maybe a variable star'], other: ['unc', 'Unexplained: unconfirmed'] }[pk.kind];
  c.append(h('h3', {}, 'Change spot'), h('span', { class: 'badge ' + kindTxt[0] }, kindTxt[1]),
    h('p', {}, h('b', {}, 'Brightest in: '), `image ${pk.k + 1} of ${d.items.length} (epoch ${x.e + 1}, ${fmtDay(x.im.mjd)} ${mjdDate(x.im.mjd).toISOString().slice(11, 16)} UTC, ${lamOf(x.im).toFixed(2)} µm)`),
    h('p', {}, h('b', {}, 'How much: '), `${pk.snr.toFixed(0)}σ above the median of all ${d.items.length} images`),
    h('p', {}, h('b', {}, 'Position: '), `RA ${pk.ra.toFixed(4)}°, Dec ${pk.dec.toFixed(4)}°`),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, pk.kind === 'known' ? 'SPHEREx caught this known asteroid here; its proof card has all the checks.'
      : pk.kind === 'single' ? 'The exposure taken minutes before or after, at the same spot, shows nothing here. Anything real (even a fast asteroid) would still be there, so this is a cosmic-ray hit.'
      : pk.kind === 'sharp' ? 'Sharper than any star in the same image. Light from the sky is always blurred by the telescope, so this is a detector effect.'
      : pk.kind === 'star' ? 'This star gives more light here than in the images of the same colour from the other epochs, and the exposure minutes apart agrees. Some stars really vary (pulsating giants do, a lot, in the infrared); it could also be an image effect. Unconfirmed.'
      : 'Brighter here in this image than in the others. It may be a moving object too faint for the catalogues, or an artefact. Nothing here is claimed as a discovery.'),
    h('button', { class: 'hbtn', onclick: () => { if (multi()) S.ti = x.i; else S.ei = x.e; setMode('time'); S.al.gotoRaDec(pk.ra, pk.dec); S.al.setFov(0.12); } }, 'Show this image'), ' ',
    pk.known ? h('button', { onclick: () => showAsteroid(pk.known) }, 'Proof card') : null, ' ',
    h('button', { onclick: showReport }, 'Back to report'));
}
function rings(set, color, clip, dashFrom) {
  if (!set || !set.items) return;
  const fov = S.al.getFov()[0];
  for (const it of set.items) {
    const p = proj(it.ra, it.dec); if (!p) continue;
    if (p[0] < -30 || p[1] < -30 || p[0] > W + 30 || p[1] > H + 30) continue;
    if (clip && !clip(p[0])) continue;
    // Known movers outside the compared square are context only: faint, no label, so they do not look like missing detections.
    let inside = true;
    if (S.field) { const g = F.skyToGrid(it.ra, it.dec, { ra0: S.field.ra, dec0: S.field.dec, s: S.field.s, n: S.field.n }); inside = !!g && g[0] >= 0 && g[1] >= 0 && g[0] < S.field.n && g[1] < S.field.n; }
    // too faint for one SPHEREx image (V > 19): context only, like objects outside the square
    const faint = Number.isFinite(it.vmag) && it.vmag > PROOF.vLimit && !(S.sel && S.sel.it && itemKey(S.sel.it) === itemKey(it));
    ctx.globalAlpha = inside && !faint ? 1 : 0.28;
    const sel = !!(S.sel && S.sel.it) && itemKey(S.sel.it) === itemKey(it);   // S.sel can also be a candidate ({cand}), which has no .it
    if (dashFrom) {
      const o = dashFrom.items.find(x => itemKey(x) === itemKey(it)), q = o && proj(o.ra, o.dec);
      if (q) { ctx.strokeStyle = 'rgba(255,176,90,.5)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); ctx.setLineDash([]); }
    }
    ctx.strokeStyle = sel ? '#5fe3f0' : color; ctx.lineWidth = sel ? 2.4 : 1.5;
    ctx.beginPath(); ctx.arc(p[0], p[1], sel ? 17 : 12, 0, 7); ctx.stroke();
    if (fov < 1 && inside && !faint) { ctx.fillStyle = color; ctx.font = '500 11px Archivo,sans-serif'; ctx.fillText(it.name, p[0] + 16, p[1] - 12); }
    ctx.globalAlpha = 1;
    S.hits.push({ x: p[0], y: p[1], it, ep: set.ep });
  }
}
function drawEcliptic() {
  const eps = 23.4393 * Math.PI / 180; let prev = null;
  ctx.strokeStyle = 'rgba(95,227,240,.55)'; ctx.lineWidth = 1.2; ctx.setLineDash([8, 6]); ctx.beginPath();
  for (let l = 0; l <= 360; l += 1) {
    const L = l * Math.PI / 180, dec = Math.asin(Math.sin(eps) * Math.sin(L)) * 180 / Math.PI, ra = ((Math.atan2(Math.cos(eps) * Math.sin(L), Math.cos(L)) * 180 / Math.PI) + 360) % 360;
    const p = proj(ra, dec);
    if (p && prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 120) ctx.lineTo(p[0], p[1]); else if (p) ctx.moveTo(p[0], p[1]);
    prev = p;
  }
  ctx.stroke(); ctx.setLineDash([]);
}
function drawTracks() {
  for (const t of S.tracks.values()) {
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.3; ctx.beginPath(); let first = true;
    for (const r of t.rows) { const p = proj(r.ra, r.dec); if (!p) continue; if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
    for (const r of t.rows) { const p = proj(r.ra, r.dec); if (p) { ctx.fillStyle = '#fff'; ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3); } }
  }
}
// Known asteroids caught moving inside an epoch (S.inside): a green circle where SPHEREx saw it in this image.
function drawSightings(im) {
  if (!S.inside) return;
  for (const a of S.inside.asteroids) for (const sg of a.sightings) {
    if (sg.im !== im) continue;
    const p = proj(sg.ra, sg.dec); if (!p) continue;
    ctx.strokeStyle = a.confirmed ? '#5ff0a0' : '#ffb05a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p[0], p[1], 15, 0, 7); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.font = '600 12px Archivo,sans-serif'; ctx.fillText(a.name, p[0] + 18, p[1] - 10);
    S.hits.push({ x: p[0], y: p[1], ast: a });
  }
}
// Its path through the epoch: dashed line through all its sightings, in time order.
function drawAsteroidPaths() {
  if (!S.inside || !(S.mode === 'time' || S.mode === 'blink')) return;
  for (const a of S.inside.asteroids) {
    if (a.sightings.length < 2) continue;
    const pts = a.sightings.slice().sort((p, q) => p.mjd - q.mjd).map(sg => proj(sg.ra, sg.dec)).filter(Boolean);
    ctx.strokeStyle = a.confirmed ? 'rgba(95,240,160,.6)' : 'rgba(255,176,90,.5)'; ctx.lineWidth = 1.4; ctx.setLineDash([5, 4]);
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.setLineDash([]);
  }
}
/* ---------- film strip: every image of every epoch ---------- */
function renderStrip() {
  const box = $('strip'); if (!box) return;
  box.replaceChildren(); box.hidden = !multi() || S.mode === 'change';
  if (!multi()) return;
  const astIn = new Set(); if (S.inside) for (const a of S.inside.asteroids) for (const sg of a.sightings) astIn.add(sg.im.url);
  S.eps.forEach((ep, e) => {
    const g = h('div', { class: 'sg' }, h('span', { class: 'sgl' }, 'E' + (e + 1)));
    for (const x of S.seq.filter(y => y.e === e)) {
      const fr = S.frames.get(x.im.url), cv = document.createElement('canvas'); cv.width = cv.height = 40;
      if (fr) { const c = cv.getContext('2d'); c.imageSmoothingEnabled = true; c.drawImage(fr.canvas, 0, 0, 40, 40); }
      g.append(h('button', { class: 'th' + (fr ? '' : ' wait') + (astIn.has(x.im.url) ? ' ast' : ''), 'data-i': x.i,
        title: `Epoch ${e + 1}, image ${x.pos} of ${x.n}: ${fmtDay(x.im.mjd)}, ${lamOf(x.im).toFixed(3)} µm, detector ${x.im.det}`,
        'aria-label': `Show epoch ${e + 1} image ${x.pos}`, onclick: () => { S.ti = x.i; S.sel = null; setMode('time'); moversFor(x); markStrip(); } }, cv));
    }
    box.append(g);
  });
  markStrip();
}
function markStrip() {
  const cur = S.mode === 'time' ? S.ti : S.mode === 'blink' ? S.blinkAt : -1;
  document.querySelectorAll('#strip .th').forEach(b => b.classList.toggle('on', +b.dataset.i === cur));
}
function drawCands() {
  for (const c of S.cands) {
    const p = proj(c.to.ra, c.to.dec); if (!p) continue;
    if (p[0] < -30 || p[1] < -30 || p[0] > W + 30 || p[1] > H + 30) continue;
    const q = c.kind === 'pair' ? proj(c.from.ra, c.from.dec) : null, sel = S.sel && S.sel.cand === c;
    ctx.strokeStyle = sel ? '#5fe3f0' : '#c4b5ff'; ctx.lineWidth = sel ? 2.4 : 1.6;
    if (q) { ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); ctx.setLineDash([]); ctx.strokeRect(q[0] - 5, q[1] - 5, 10, 10); }
    ctx.beginPath(); ctx.moveTo(p[0], p[1] - 11); ctx.lineTo(p[0] + 11, p[1]); ctx.lineTo(p[0], p[1] + 11); ctx.lineTo(p[0] - 11, p[1]); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#c4b5ff'; ctx.font = '500 11px Archivo,sans-serif'; ctx.fillText('C' + c.id, p[0] + 14, p[1] + 4);
    S.hits.push({ x: p[0], y: p[1], cand: c });
  }
}
let lastTele = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (!S.al) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); S.hits = [];
  const T = affine();
  if (T && S.eps.length) {
    const { a, b } = view(), fa = frameOf(a), fb = frameOf(b), A = moversOf(a), B = moversOf(b);
    const withEp = (s, i) => s && { ...s, ep: i };
    if (multi() && (S.mode === 'time' || S.mode === 'blink') && S.seq.length) {
      // one real image at a time: Time machine = the slider's image; Blink = flip-book through an epoch's images (or all)
      let x;
      if (S.mode === 'time') x = seqAt();
      else { const list = blinkList(), k = reduce ? (S.flipIdx || 0) % list.length : Math.floor(ts / 650) % list.length; x = list[k]; }
      const fr = S.frames.get(x.im.url), m = x.im === chosen(x.e) ? moversOf(x.e) : moversIm(x.im);
      drawImg(T, fr && fr.canvas); rings(withEp(m, x.e), 'rgba(255,176,90,.9)'); drawSightings(x.im);
      if (S.blinkAt !== x.i) { S.blinkAt = x.i; markStrip(); }
      ctx.fillStyle = '#ffb05a'; ctx.font = '500 13px Archivo,sans-serif';
      ctx.fillText(`Epoch ${x.e + 1} · image ${x.pos} of ${x.n} · ${fmtDay(x.im.mjd)} ${mjdDate(x.im.mjd).toISOString().slice(11, 16)} UTC · ${lamOf(x.im).toFixed(2)} µm${fr ? '' : ' (loading)'}`, W / 2 - 190, 110);
    }
    else if (S.mode === 'time') { drawImg(T, fa && fa.canvas); rings(withEp(A, a), 'rgba(255,176,90,.9)', null, a > 0 ? withEp(moversOf(0), 0) : null); }
    else if (S.mode === 'blink') {
      const flip = reduce ? S.flipped : Math.floor(ts / 700) % 2;
      drawImg(T, (flip ? fb : fa) && (flip ? fb : fa).canvas);
      rings(withEp(flip ? B : A, flip ? b : a), 'rgba(255,176,90,.9)');
      ctx.fillStyle = '#ffb05a'; ctx.font = '500 13px Archivo,sans-serif'; ctx.fillText(epLabel(flip ? b : a), W / 2 - 60, 110);
    } else if (S.mode === 'swipe') {
      const sx = W * S.split / 100;
      drawImg(T, fa && fa.canvas);
      ctx.save(); ctx.beginPath(); ctx.rect(sx, 0, W - sx, H); ctx.clip(); drawImg(T, fb && fb.canvas); ctx.restore();
      rings(withEp(A, a), 'rgba(255,176,90,.9)', x => x < sx); rings(withEp(B, b), 'rgba(255,176,90,.9)', x => x >= sx);
      ctx.fillStyle = '#fff'; ctx.fillRect(sx - 1, 0, 2, H);
    } else if (S.mode === 'diff') {
      drawImg(T, diffCanvas(fa, fb));
      rings(withEp(A, a), 'rgba(95,227,240,.95)'); rings(withEp(B, b), 'rgba(255,176,90,.95)');
    } else if (S.mode === 'change') {
      const d = changeData();
      if (d) { drawImg(T, S.cv === 'im' ? d.imCv : d.epCv); drawChangePeaks(T); }
      else drawImg(T, fa && fa.canvas);
    } else if (S.mode === 'px') {
      drawImg(T, S.px.res && S.px.cv ? S.px.cv : diffCanvas(fa, fb)); drawPx(T);
    }
    const f = S.field, c = (f.n - 1) / 2;   // footprint outline
    ctx.save(); ctx.setTransform(dpr * T.a, dpr * T.b, dpr * T.c, dpr * T.d, dpr * T.e, dpr * T.f);
    ctx.strokeStyle = 'rgba(159,176,220,.45)'; ctx.lineWidth = 1 / Math.max(0.0001, Math.hypot(T.a, T.b)); ctx.strokeRect(0, 0, f.n, f.n); ctx.restore();
    drawTracks(); drawCands(); drawAsteroidPaths();
  }
  if (S.ecl) drawEcliptic();
  if (ts - lastTele > 150) { lastTele = ts; telemetry(); }
}
function telemetry() {
  const [ra, dec] = S.al.getRaDec();
  $('ra').textContent = ra.toFixed(3) + '°'; $('dec').textContent = dec.toFixed(3) + '°'; $('zm').textContent = S.al.getFov()[0].toFixed(2) + '°';
}
function updateLabels() {
  $('bo').textContent = S.band.toFixed(2) + ' µm';
  if (!S.eps.length) { $('tmo').textContent = '-'; $('ep').textContent = 'none'; $('bd').textContent = 'none'; $('lam').textContent = ''; return; }
  let { a, b } = view(); if (S.mode === 'px' && !S.lab && S.px.ctx) { a = S.px.ctx.a; b = S.px.ctx.b; }   // the two passes Hide Planet X really compares
  let im = chosen(b);
  $('tmo').textContent = S.mode === 'time' ? epLabel(S.ei) : `${epLabel(a)} vs ${epLabel(b)}`;
  $('ep').textContent = S.mode === 'time' ? `${S.ei + 1} of ${S.eps.length}` : `${a + 1} vs ${b + 1}`;
  if (multi()) {
    const E = S.eps.length;
    if (S.mode === 'time') { const x = seqAt(); im = x.im; $('tmo').textContent = `${x.i + 1} of ${S.seq.length} · E${x.e + 1} #${x.pos}`; $('ep').textContent = `${x.e + 1} of ${E}, image ${x.pos}/${x.n}`; }
    else if (S.mode === 'blink') { $('tmo').textContent = S.bi < E ? `Epoch ${S.bi + 1}: ${blinkList().length} images` : `All ${S.seq.length} images`; $('ep').textContent = S.bi < E ? `${S.bi + 1} (flip-book)` : 'all (flip-book)'; }
    else $('tmo').textContent = `${epLabel(a)} vs ${epLabel(b)} (stacks of ${S.slots.length})`;
  }
  const fr = S.frames.get(im.url), g = geo(im), measured = fr && fr.lamReal != null;
  $('bd').textContent = lamOf(im).toFixed(2) + ' µm';
  const how = measured ? 'measured in the image' : g && g.lam != null ? 'predicted from its footprint' : `detector range ${im.lam0.toFixed(2)} to ${im.lam1.toFixed(2)} µm`;
  const cov = g ? ` Covers ${Math.round(g.cover * 100)}% of the field.` : '';
  const pair = S.mode !== 'time' && a !== b ? ` Other epoch: ${lamOf(chosen(a)).toFixed(3)} µm.` : '';
  $('lam').textContent = (multi() && (S.mode === 'swipe' || S.mode === 'diff') ? `Each epoch is the median of its ${S.slots.length} images (colours within ${S.slotDLam.toFixed(3)} µm across epochs). Slot 1: ` : '') +
    `Image at this spot: ${lamOf(im).toFixed(3)} µm (${how}, detector ${im.det}), taken ${fmtDay(im.mjd)}.${cov}${pair}`;
}

/* ---------- picking and the mover card ---------- */
function pickAt(x, y) {
  if (S.mode === 'px' && !S.lab && S.report && pxClick(x, y)) return;
  let best = null, bd = 26;
  for (const h_ of S.hits) { const d = Math.hypot(h_.x - x, h_.y - y); if (d < bd) { bd = d; best = h_; } }
  if (best) { if (best.cand) showCand(best.cand); else if (best.ast) showAsteroid(best.ast); else if (best.chg) showChange(best.chg); else showMover(best); } else { S.sel = null; showList(); }
}
function showList() {
  const c = $('card'); c.replaceChildren();
  if (!S.eps.length) { c.hidden = true; return; }
  const { b } = view(), set = moversOf(b); c.hidden = false;
  c.append(h('h3', {}, 'Known movers'), S.report ? h('button', { onclick: showReport }, 'Agent report') : null);
  if (!set || set.loading) { c.append(h('p', {}, 'Asking SkyBoT...')); return; }
  if (set.err) { c.append(h('p', {}, 'Unavailable: ' + set.err)); return; }
  c.append(h('p', {}, `${set.items.length} known solar-system object${set.items.length === 1 ? '' : 's'} in this field at ${fmtDay(set.mjd)}. Rings do not guarantee a visible detection.`));
  [...set.items].sort((p, q) => (p.vmag || 99) - (q.vmag || 99)).slice(0, 12).forEach(it => {
    c.append(h('button', { class: 'mv', onclick: () => { S.al.gotoRaDec(it.ra, it.dec); S.al.setFov(0.15); showMover({ it, ep: b }); } },
      h('b', {}, (it.num ? it.num + ' ' : '') + it.name), h('small', {}, `${it.cls || 'object'}, V ${Number.isFinite(it.vmag) ? it.vmag.toFixed(1) : '?'}`)));
  });
}
function showMover(hit) {
  S.sel = hit; const it = hit.it, c = $('card'); c.replaceChildren(); c.hidden = false;
  const id = encodeURIComponent(it.num || it.name), speed = Math.hypot(it.dra, it.ddec);
  c.append(h('h3', {}, (it.num ? it.num + ' ' : '') + it.name),
    h('p', {}, h('b', {}, 'Class: '), it.cls || 'unknown'),
    h('p', {}, h('b', {}, 'Brightness: '), Number.isFinite(it.vmag) ? `V ${it.vmag.toFixed(1)} (visible light)` : 'unknown'),
    h('p', {}, h('b', {}, 'Distance: '), `${it.dgeo?.toFixed?.(2) ?? '?'} au from Earth, ${it.dsun?.toFixed?.(2) ?? '?'} au from the Sun`),
    h('p', {}, h('b', {}, 'Sky motion: '), Number.isFinite(speed) ? `${speed.toFixed(1)} arcsec/hour (${(speed * 24 / 60).toFixed(1)} arcmin/day)` : 'unknown'));
  const { a, b } = view(), oe = hit.ep === a ? b : a, other = a !== b && moversOf(oe), o = other && other.items && other.items.find(x => itemKey(x) === itemKey(it));
  if (o) {
    const dx = (o.ra - it.ra) * Math.cos(it.dec * Math.PI / 180), dy = o.dec - it.dec, days = Math.abs(S.movers.get(hit.ep + ':' + chosen(hit.ep).url).mjd - other.mjd);
    c.append(h('p', {}, h('b', {}, 'Shift between these images: '), `${(Math.hypot(dx, dy) * 60).toFixed(1)} arcmin over ${days.toFixed(0)} days`));
  }
  c.append(h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'Position comes from the orbit catalogue, not from SPHEREx pixels. In Difference view, look for an orange and cyan pair at the ring.'),
    h('p', {}, h('a', { href: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=' + id, target: '_blank', rel: 'noopener' }, 'JPL SBDB'), ' · ',
      h('a', { href: 'https://minorplanetcenter.net/db_search/show_object?object_id=' + id, target: '_blank', rel: 'noopener' }, 'Minor Planet Center')),
    h('button', { class: 'hbtn', id: 'trk', onclick: () => drawTrack(it) }, 'Draw JPL Horizons track'), ' ', h('button', { onclick: () => { S.sel = null; showList(); } }, 'All movers'));
}
async function drawTrack(it) {
  const { a, b } = view(), m0 = Math.min(chosen(a).mjd, chosen(b).mjd) - 2, m1 = Math.max(chosen(a).mjd, chosen(b).mjd) + 2, span = m1 - m0;
  const q = `${it.num ? 'num=' + encodeURIComponent(it.num) : 'name=' + encodeURIComponent(it.name)}&start=${fmtDay(m0)}&stop=${fmtDay(m1)}&step=${span > 200 ? '5 d' : span > 60 ? '2 d' : '1 d'}`;
  $('trk').disabled = true;
  try { const r = await api('/api/horizons?' + q); S.tracks.set(itemKey(it), r); toast(`Horizons track: ${r.rows.length} points`); }
  catch (e) { toast(e.message); }
  $('trk').disabled = false;
}

/* ---------- modes and controls ---------- */
const helps = {
  time: 'Step the slider through epochs. Stars stay. Rings and dashed lines show where known movers went.',
  blink: 'Flips between the first epoch and the one on the slider. Stars stay, movers jump.',
  swipe: 'Drag the divider. Left is the first epoch, right is the later one.',
  diff: 'Later minus first. Stars cancel. A mover leaves an orange blob next to a cyan one.',
  timeM: 'Step through every image, in time order. Stars stay put. Green circles: known asteroids SPHEREx caught moving.',
  blinkM: 'Flip-book through one epoch\'s images (slider) or all of them. Stars stay. Anything that hops is moving.',
  swipeM: 'Drag the divider. Each side is the median of an epoch\'s images, so cosmic rays and fast movers are gone.',
  diffM: 'Later stack minus first stack. Stars cancel. What is left changed between epochs.',
  lab: 'Why a far-off planet takes years to spot: its track on the sky.',
  change: 'Every epoch in its own colour. What never changed adds up to white; a coloured spot is only in that epoch.',
  px: 'Hide a FAKE planet in these real images and see if the agents find it. Click the sky to choose the spot. A test of what SPHEREx could catch, not a search.',
  changeIm: 'Every image in a colour of time (violet first, red last). The unchanging sky is grey. A chain of coloured dots is something moving; a dashed yellow ring is a star that got brighter. Cosmic rays are left grey and only counted (faded bars).'
};
function setMode(m) {
  S.lab = m === 'lab'; if (!S.lab) S.mode = m;
  document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.m === m));
  $('help').textContent = m === 'change' && S.cv === 'im' ? helps.changeIm : (multi() && helps[m + 'M']) || helps[m]; $('swr').hidden = S.mode !== 'swipe'; $('sw').hidden = S.mode !== 'swipe';
  const chg = (S.mode === 'change' || S.mode === 'px') && !S.lab; $('tmr').hidden = chg; $('lam').hidden = chg; $('pxp').hidden = S.mode !== 'px' || S.lab; $('bandr').hidden = S.mode === 'px' && !S.lab; if (S.mode === 'px' && !S.lab) pxLabels(); if ($('strip')) $('strip').hidden = chg || !multi(); renderChgPanel();
  $('flip').hidden = !(reduce && S.mode === 'blink'); if (!$('flip').hidden) $('swr').hidden = false;
  $('lab').hidden = !S.lab;
  if (S.lab) drawLab();
  if (S.eps.length) { setSlider(); refresh(); }
  markStrip(); writeHash();
}
document.querySelectorAll('[role=tab]').forEach(b => b.onclick = () => setMode(b.dataset.m));
document.querySelectorAll('[data-cv]').forEach(b => b.onclick = () => { S.cv = b.dataset.cv; S.sel = null; setMode('change'); });
$('tm').oninput = e => {
  const v = +e.target.value;
  if (multi() && S.mode === 'time') { S.ti = v; moversFor(seqAt()); } else if (multi() && S.mode === 'blink') { S.bi = v; blinkList().forEach(x => moversFor(x)); } else S.ei = v;
  S.sel = null; updateLabels(); markStrip(); refreshSoon();
};
$('sw').oninput = e => S.split = +e.target.value;
$('flip').onclick = () => { S.flipped = !S.flipped; S.flipIdx = (S.flipIdx || 0) + 1; };
$('band').oninput = e => { S.band = +e.target.value; updateLabels(); refreshSoon(); };
document.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { S.band = +b.dataset.b; $('band').value = S.band; updateLabels(); refreshSoon(); });
$('load').onclick = () => { if (!S.al) return; const [ra, dec] = S.al.getRaDec(); runAgents({ ra, dec, label: 'Current view' }, { skipNav: true }); };
$('csize').onchange = () => { if (S.field) toast('Press "Run agents here" to apply the new field size.'); };
$('ipe').onchange = e => {
  S.depth = +e.target.value; writeHash();
  if (S.field) runAgents({ ra: S.field.ra, dec: S.field.dec, label: 'Same field' }, { skipNav: true });
};
$('ecl').onclick = e => { S.ecl = !S.ecl; e.target.setAttribute('aria-pressed', S.ecl); };
$('survey').onchange = e => {
  try { S.al.setBaseImageLayer(S.al.newImageSurvey ? S.al.newImageSurvey(e.target.value) : e.target.value); }
  catch (err) { try { S.al.setImageSurvey(e.target.value); } catch (e2) { toast('Could not switch the base sky.'); } }
};
// Real examples: the field below is bundled with the site (demo-cache), so they open in seconds even when IRSA is busy.
const EXAMPLES = {
  proof: { ra: 189.957, dec: -4.182, depth: 8, label: 'Example: a real asteroid', focus: 'asteroid' },
  false: { ra: 189.957, dec: -4.182, depth: 1, label: 'Example: a false alarm', focus: 'artefact' }
};
function runExample(id) {
  const x = EXAMPLES[id]; if (!x || !S.al) return;
  S.depth = x.depth; $('ipe').value = x.depth;
  try { history.replaceState(null, '', '#ex=' + id); } catch { /* ignore */ }
  runAgents({ ra: x.ra, dec: x.dec, label: x.label }, { focus: x.focus });
}
function focusExample(kind) {   // after the run: open the card the example is about
  try {
    if (kind === 'asteroid') { const a = S.inside && S.inside.asteroids.find(q => q.confirmed); if (a) { S.al.gotoRaDec(a.sightings[0].ra, a.sightings[0].dec); S.al.setFov(0.3); showAsteroid(a); } }
    else if (kind === 'artefact') { const k = S.report && S.report.candidates.find(q => q.status === 'artefact'); if (k) { S.al.gotoRaDec(k.to.ra, k.to.dec); S.al.setFov(0.12); showCand(k); } }
  } catch { /* the example still works without the focus */ }
}
document.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => runExample(b.dataset.ex));
$('exb').onclick = () => { const i = $('intro'); i.hidden = false; i.style.opacity = 1; };
function closeIntro() { const i = $('intro'); if (i.hidden) return; i.style.opacity = 0; setTimeout(() => i.hidden = true, 900); }
$('go').onclick = closeIntro;
$('lb').onclick = () => drawer(true); $('lc').onclick = () => drawer(false);
function drawer(o) { $('drawer').classList.toggle('open', o); $('drawer').setAttribute('aria-hidden', !o); $('lb').setAttribute('aria-expanded', o); (o ? $('lc') : $('lb')).focus(); }
addEventListener('keydown', e => { if (e.key === 'Escape') drawer(false); });
$('hc').onclick = e => { const on = document.documentElement.dataset.hc !== '1'; document.documentElement.dataset.hc = on ? '1' : '0'; e.target.setAttribute('aria-pressed', on); };

function go(ra, dec) { S.al.gotoRaDec(ra, dec); S.al.setFov(1.2); }
$('sf').onsubmit = async e => {
  e.preventDefault(); const q = $('q').value.trim(); if (!q || !S.al) return;
  const n = q.split(/[\s,]+/).map(Number), isCoord = n.length === 2 && n.every(Number.isFinite) && n[0] >= 0 && n[0] <= 360 && Math.abs(n[1]) <= 90;
  if (S.auto) { runAgents(isCoord ? { ra: n[0], dec: n[1], label: 'Coordinates' } : { name: q }); return; }
  if (isCoord) { go(n[0], n[1]); return; }
  try { const r = await api('/api/resolve?q=' + encodeURIComponent(q)); go(r.ra, r.dec); toast(r.name || q); }
  catch (err) { toast(err.message === 'Name not found' ? 'No match. Try an object name, or RA Dec like 190 -4.' : err.message); }
};

/* ---------- share link ---------- */
function writeHash() {
  if (!S.al) return;
  try { const [ra, dec] = S.al.getRaDec(); history.replaceState(null, '', `#ra=${ra.toFixed(4)}&dec=${dec.toFixed(4)}&fov=${S.al.getFov()[0].toFixed(3)}&b=${S.band.toFixed(2)}&m=${S.mode}&e=${S.ei}&sz=${$('csize').value}&ipe=${S.depth}${S.field ? `&load=1&fra=${S.field.ra.toFixed(5)}&fdec=${S.field.dec.toFixed(5)}` : ''}`); } catch { /* ignore */ }
}
$('share').onclick = async () => { writeHash(); try { await navigator.clipboard.writeText(location.href); toast('Link copied'); } catch { toast('Copy the address bar to share this view'); } };
addEventListener('pointerup', () => setTimeout(writeHash, 50));

/* ---------- Motion lab (teaching toy, not data) ---------- */
function drawLab() {
  const y = +$('ly').value, d = +$('ld').value, A = 206265 / d, dr = 360 / Math.pow(d, 1.5) * 3600;
  $('lyo').textContent = y + ' yr'; $('ldo').textContent = d + ' AU';
  const pt = t => [dr * t + A * Math.sin(6.2832 * t), .4 * A * (Math.cos(6.2832 * t) - 1)], c = $('lc2'), g = c.getContext('2d'), P = [];
  for (let i = 0; i <= 300; i++) P.push(pt(y * i / 300));
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys),
    s = Math.min((c.width - 30) / Math.max(Math.max(...xs) - x0, 1), (c.height - 30) / Math.max(Math.max(...ys) - y0, 1)),
    X = p => 15 + (p[0] - x0) * s, Y = p => c.height - 15 - (p[1] - y0) * s;
  g.clearRect(0, 0, c.width, c.height); g.strokeStyle = '#ffb05a'; g.lineWidth = 2; g.beginPath(); P.forEach((p, i) => i ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p))); g.stroke();
  g.fillStyle = '#5fe3f0'; for (let k = 0; k <= y; k++) { const p = pt(k); g.beginPath(); g.arc(X(p), Y(p), 3.5, 0, 7); g.fill(); }
  $('lt').textContent = `Wobble: about ±${A.toFixed(0)} arcseconds each year. Drift: about ${dr.toFixed(0)} arcseconds per year. After about ${(A / dr).toFixed(1)} years the drift outgrows the wobble. Rough estimate for a circular orbit. Planet X is hypothetical.`;
}
$('ly').oninput = $('ld').oninput = drawLab;

/* ---------- Agents: Navigator, Archivist, Aligner, Analyst, Reporter ---------- */
// Plain code stages, not language models. Each does one job and hands its result to the next.
const AGENTS = [
  ['nav', 'Navigator', 'Resolves the target and points the sky at it'],
  ['arc', 'Archivist', 'Searches IRSA and picks images of matching colour for every epoch'],
  ['ali', 'Aligner', 'Downloads cutouts, reprojects them and registers each epoch on the stars'],
  ['ana', 'Analyst', 'Compares epochs, hunts for slow movers, checks known objects'],
  ['rep', 'Reporter', 'Summarises what was and was not found']];
const ICON = { idle: '·', run: '…', done: '✓', warn: '!', err: '✗', skip: '–' };
const STATE_WORD = { idle: 'waiting', run: 'working', done: 'done', warn: 'done with a warning', err: 'failed', skip: 'skipped' };
const NOTES = [
  'Changes are unconfirmed. Faint stars near the noise limit, different colours in the two epochs and footprint edges can all fake a change.',
  'Between epochs months apart, stars move less than a pixel and solar-system bodies leave the field, so a source "moving" a few pixels is not physical; the tool only pairs sources when physics allows it. Asteroids and comets are checked against orbit catalogues instead.',
  'Known-object positions come from IMCCE SkyBoT for a geocentric observer. SPHEREx is in low Earth orbit, so near objects can be off by about an arcminute.',
  'Nothing here is a discovery claim. Planet X is hypothetical and is not searched for.'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function renderAgents() {
  const box = $('alist'); box.replaceChildren();
  for (const [id, name, desc] of AGENTS) {
    const a = S.ag[id] || { state: 'idle', msg: desc };
    box.append(h('li', { class: 'ag ' + a.state, title: desc }, h('span', { class: 'ai', 'aria-hidden': 'true' }, ICON[a.state]),
      h('div', {}, h('b', {}, name, h('span', { class: 'sr' }, ' ' + STATE_WORD[a.state])), h('small', {}, a.msg))));
  }
}
function setAgent(id, state, msg) {
  S.ag[id] = { state, msg }; renderAgents();
  const nm = AGENTS.find(x => x[0] === id)[1]; $('alive').textContent = `${nm}: ${STATE_WORD[state]}. ${msg}`;
}

// target = {ra, dec, label} or {name}. opts.skipNav: stay where the view already is. opts.keepMode: keep the saved view mode.
async function runAgents(target, opts = {}) {
  if (!S.al) return;
  closeIntro();   // a search typed while the welcome screen is open must not leave it over the results (seen live)
  const run = ++S.run, live = () => run === S.run;
  S.ag = {}; S.cands = []; S.known = []; S.report = null; S.sel = null; renderAgents(); $('agents').open = true;
  let cur = 'nav';
  const skipAfter = id => { let on = false; for (const [k] of AGENTS) { if (k === id) on = true; else if (on) S.ag[k] = { state: 'skip', msg: 'Skipped' }; } renderAgents(); };
  try {
    // 1. Navigator
    let { ra, dec } = target, label = target.label || '';
    setAgent('nav', 'run', target.name ? `Resolving "${target.name}"...` : 'Pointing the sky...');
    if (target.name) {
      let r; try { r = await api('/api/resolve?q=' + encodeURIComponent(target.name)); }
      catch (e) { throw new Error(e.message === 'Name not found' ? `No match for "${target.name}". Try RA Dec like 190 -4.` : e.message); }
      if (!live()) return; ra = r.ra; dec = r.dec; label = r.name || target.name;
    }
    if (!opts.skipNav) { S.al.gotoRaDec(ra, dec); S.al.setFov(Math.max(0.6, +$('csize').value * 2)); await sleep(reduce ? 100 : 900); if (!live()) return; }
    setAgent('nav', 'done', `${label ? label + ' · ' : ''}RA ${ra.toFixed(3)}°, Dec ${dec.toFixed(3)}°`);

    // 2. Archivist
    cur = 'arc'; setAgent('arc', 'run', 'Searching the IRSA archive...');
    const ok = await loadField(ra, dec, { auto: true });
    if (!live()) return;
    if (!ok) throw new Error(S.lastErr || 'Archive search failed');
    const E = S.eps.length, a = 0, b = E - 1, idx = E > 1 ? [a, b] : [a];
    const lamTxt = () => { const l = idx.map(i => lamOf(chosen(i))), d = Math.max(...l) - Math.min(...l);
      return idx.length < 2 ? `colour ${l[0].toFixed(3)} µm` : d < 0.02 ? `same colour in each epoch: ${l.map(x => x.toFixed(3)).join(' vs ')} µm`
        : `closest colours available: ${l.map(x => x.toFixed(3)).join(' vs ')} µm (Δ ${d.toFixed(3)})`; };
    setAgent('arc', E > 1 ? 'done' : 'warn', `${S.images.length} images in ${E} epoch${E > 1 ? 's' : ''}; ${lamTxt()}` + (E > 1 ? '' : '. Only one epoch so far, so nothing to compare yet'));

    // 3. Aligner
    cur = 'ali';
    // The first cutout of a detector without a built-in wavelength map teaches the app that map, which can change the best
    // images (and the best colour). Load until the choice is stable, then make sure the final choice is what was loaded.
    for (let pass = 0; pass < 4; pass++) {
      const before = idx.map(i => chosen(i).url), nTables = Object.keys(TABLES).length;
      setAgent('ali', 'run', `Downloading ${idx.length} images in parallel, cleaning bad pixels and reprojecting...`);
      await Promise.all(idx.map(i => ensureFrame(i)));   // parallel: the server fetches up to 8 at once and caches them
      if (!live()) return;
      if (Object.keys(TABLES).length !== nTables && !opts.keepMode) { S.band = bestBand(); $('band').value = S.band; }
      buildSlotsNow();   // slot 0 follows the new choice
      if (idx.every((i, k) => chosen(i).url === before[k])) break;
    }
    await Promise.all(idx.map(i => ensureFrame(i))); if (!live()) return;
    // Several images per epoch: the colour may have changed while loading, so rebuild the slots, then load them all.
    buildSlotsNow(); renderStrip();
    await Promise.all(idx.map(i => ensureFrame(i))); if (!live()) return;
    if (multi()) {
      const all = S.seq.map(x => x.im); let done = all.filter(im => S.frames.get(im.url)).length;
      const msg = () => `Downloading ${all.length} images (${S.slots.length} per epoch): ${done} of ${all.length} ready...`, tick = () => { done++; if (live()) setAgent('ali', 'run', msg()); };
      setAgent('ali', 'run', msg());
      await Promise.all(all.map(im => ensureImg(im).then(tick, () => { /* retried below */ })));
      if (!live()) return;
      // Second chance, two at a time, for images IRSA was too busy to send (live run: 17 of 24 at first; each worked when asked again).
      const q = all.filter(im => !S.frames.get(im.url));
      if (q.length) {
        setAgent('ali', 'run', `${q.length} images were not sent (IRSA busy). Asking again, two at a time... ${done} of ${all.length} ready`);
        await Promise.all([0, 1].map(async () => { while (q.length && live()) { const im = q.shift(); try { await ensureImg(im); tick(); } catch { /* stays missing */ } } }));
        if (!live()) return;
      }
      S.missing = all.filter(im => !S.frames.get(im.url)).length;
    } else S.missing = 0;
    // Register every frame on the final epoch-1 slot-0 frame (it may have been loaded after the others).
    const ref0 = rawOf(a);
    if (ref0) { alignFrame(ref0); for (const x of S.seq) { const fr = S.frames.get(x.im.url); if (fr && fr !== ref0) alignFrame(fr); } }
    if (idx.some(i => !rawOf(i))) throw new Error('Could not load the images for every epoch, so nothing was compared. Try again.');
    const sh = (rawOf(b) || {}).shift;
    const loaded = S.seq.filter(x => S.frames.get(x.im.url)), shifts = loaded.map(x => S.frames.get(x.im.url).shift).filter(z => z && z.ok && z.method === 'stars');
    const scat = shifts.length ? shifts.map(z => z.spread).sort((p, q) => p - q)[shifts.length >> 1] : null;
    if (E < 2 && !multi()) setAgent('ali', 'done', 'Reference frame ready (single epoch)');
    else if (multi()) setAgent('ali', shifts.length >= loaded.length - 1 && !S.missing ? 'done' : 'warn', `${loaded.length} of ${S.seq.length} images aligned on the stars` +
      (S.missing ? ` (${S.missing} could not be downloaded: IRSA busy, try Run agents again later)` : '') +
      (scat != null ? ` (median scatter ${scat.toFixed(2)} px)` : '') + (sh && sh.ok && E > 1 ? `; epoch ${E} moved ${sh.dx.toFixed(2)}, ${sh.dy.toFixed(2)} px onto epoch 1` : ''));
    else if (sh && sh.ok) setAgent('ali', 'done', `Epoch ${E} moved ${sh.dx.toFixed(2)}, ${sh.dy.toFixed(2)} px onto epoch 1 (${shiftText(sh)})`);
    else setAgent('ali', 'warn', `Could not refine the alignment (${shiftText(sh)}). Using sky coordinates only`);
    setAgent('arc', E > 1 ? 'done' : 'warn', `${S.images.length} images in ${E} epoch${E > 1 ? 's' : ''}; ` +
      (multi() ? `${S.slots.length} colour-matched images per epoch (${S.seq.length} in all, colours differ by at most ${S.slotDLam.toFixed(3)} µm); slot 1: ` : '') +
      lamTxt() + (E > 1 ? '' : '. Only one epoch so far, so nothing to compare yet'));
    S.ei = b; S.ti = S.seq.length ? S.seq.length - 1 : 0; setMode(opts.keepMode ? S.mode : (E > 1 ? (multi() ? 'change' : 'diff') : 'time'));

    // 4. Analyst
    cur = 'ana'; setAgent('ana', 'run', 'Asking SkyBoT which known objects are in the field...');
    await Promise.all(idx.map(i => ensureMovers(i)));
    if (!live()) return;
    S.inside = null;
    if (multi()) { setAgent('ana', 'run', 'Looking for things that move between the visits of each epoch...'); await sleep(0); S.inside = await insideEpochs(live); if (!live()) return; }
    setAgent('ana', 'run', E > 1 ? 'Comparing the aligned epochs...' : 'Checking known objects...');
    await sleep(0);
    const res = analyse(a, b, E), seen = res.known.filter(k => k.detected).length, lookupFailed = idx.some(i => { const m = moversOf(i); return m && m.err; });
    S.cands = res.cands.slice(0, 10); S.known = res.known;
    const conf = res.cands.filter(k => k.status === 'confirmed').length, faint = res.known.filter(k => k.tooFaint).length;
    const ins = S.inside, nAst = ins ? ins.asteroids.filter(x => x.confirmed).length : 0;
    const kt = `${res.known.length} known object${res.known.length === 1 ? '' : 's'} in the field (${seen} seen${faint ? `, ${faint} too faint for SPHEREx` : ''})` +
      (conf ? ` · ${conf} change${conf === 1 ? '' : 's'} proven to be a known asteroid` : '') +
      (ins ? ` · inside the epochs: ${nAst} known asteroid${nAst === 1 ? '' : 's'} caught moving` +
        (ins.unRepeat ? `, ${ins.unRepeat} other source${ins.unRepeat === 1 ? '' : 's'} seen at one visit only (twice in a row there; unknown mover or detector artefact, unconfirmed)` : '') +
        (ins.unOnce ? `, ${ins.unOnce} seen in a single image with no second exposure to check` : '') : '');
    const gated = res.quality && !res.quality.ok;
    const ct = E < 2 ? '' : gated ? 'Epochs do not line up well enough to trust changes, so none are reported · '
      : (() => { const art = res.cands.filter(k => k.status === 'artefact').length, real = res.cands.length - art;
          const per = S.eps.map((_, e) => epochImgs(e).filter(im => S.frames.get(im.url)).length);
          const stTxt = per.every(n => n === S.slots.length) ? `${S.slots.length} images each` : `${per.join(', ')} images`;
          return `${real} change${real === 1 ? '' : 's'} between epoch${multi() ? ` stacks (${stTxt})` : 's'}${art ? ` (+${art} likely artefact${art === 1 ? '' : 's'})` : ''} · `; })();
    setAgent('ana', lookupFailed || gated ? 'warn' : 'done', ct + (lookupFailed ? 'known-object lookup failed' : kt));

    // 5. Reporter
    cur = 'rep'; setAgent('rep', 'run', 'Writing the report...');
    S.report = buildReport(label, E, a, b, res); showReport(); renderStrip();
    S.chg = null; renderChgPanel();   // rebuild the Changes view now that known asteroids are known
    if (innerWidth <= 700) $('agents').open = false;   // on a phone the sky matters more than the log once the run is done
    setAgent('rep', 'done', 'Report ready. Click a marker for details, or download it');
    if (!multi()) prefetchEpochs(run);
    if (opts.focus) focusExample(opts.focus);
    stat(`Agents finished: ${E > 1 ? 'Difference view of epoch 1 vs ' + E : 'single epoch'}.`);
  } catch (e) {
    if (!live() || e.message === 'cancelled') return;
    setAgent(cur, 'err', e.message); skipAfter(cur); stat(e.message, true);
  }
}

// Fastest-moving star known (Barnard's star) is about 10.4 arcsec/yr; anything a pair-search finds faster than this between
// epochs months apart cannot be a star, and solar-system bodies move far more than a field in that time.
const STAR_PM_MAX = 11;          // arcsec per year
const MATCH_PX = 2.5;            // same-source radius used by findTransients
// Asteroid Proof Card (v0.5). A change is called a known asteroid only when all checks pass:
//  position: within 12 arcsec (2 SPHEREx pixels) plus SkyBoT's own position error of where SkyBoT puts the object at
//            that image's time;
//  brightness: SkyBoT V <= 19. SPHEREx reaches about AB 18.4 per channel at 2 um only after all four sky passes
//            (Crill et al. 2025, arXiv:2404.11017); one image is shallower, so fainter known objects cannot show.
// Without this, a bright unrelated change 37 arcsec from a V 23.3 asteroid was labelled with its name.
const PROOF = { matchArcsec: 12, searchPx: 8, vLimit: 19, sharpFrac: 0.5 };
// Shape check: anything on the sky is blurred by the telescope, so it cannot be sharper than the stars in the same image.
// Measure = mean of the 4 side neighbours / peak. Real field 189.957 -4.182: stars 0.28 to 0.63 (median 0.42); the
// 922-sigma "change" there was 0.067, a single hot pixel (cosmic-ray-like). Below half the stars' median = artefact.
function peakShape(v, n, x, y) {
  let bx = Math.round(x), by = Math.round(y);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = Math.round(x) + i, Y = Math.round(y) + j; if (X > 0 && Y > 0 && X < n - 1 && Y < n - 1 && v[Y * n + X] > v[by * n + bx]) { bx = X; by = Y; } }
  if (bx < 1 || by < 1 || bx > n - 2 || by > n - 2) return null;
  const c = v[by * n + bx]; if (!(c > 0)) return null;
  return (v[(by - 1) * n + bx] + v[(by + 1) * n + bx] + v[by * n + bx - 1] + v[by * n + bx + 1]) / (4 * c);
}
function starShape(f) {
  if (f.shapeRef !== undefined && f.shapeFlat === f.flat) return f.shapeRef;
  const n = S.field.n, v = f.flat, lim = 30 * f.st.sigma, r = [];
  for (let y = 3; y < n - 3; y++) for (let x = 3; x < n - 3; x++) {
    const c = v[y * n + x]; if (!(c > lim)) continue;
    let max = true; for (let j = -1; j <= 1 && max; j++) for (let i = -1; i <= 1; i++) if ((i || j) && v[(y + j) * n + x + i] >= c) { max = false; break; }
    if (max) r.push(peakShape(v, n, x, y));
  }
  r.sort((p, q) => p - q);
  f.shapeFlat = f.flat; f.shapeRef = r.length >= 8 ? { median: r[r.length >> 1], n: r.length } : null;
  return f.shapeRef;
}
// Reliability gate: when many sources "vanish" and "reappear" a few pixels away, the epochs do not line up locally
// (wavelength, detector or distortion differences). Changes found then are artefacts, so none are reported.
const GATE = { nearMissMin: 5, nearMissFrac: 0.05 };

// After a run, quietly load the other epochs' images so the Time machine slider is instant. One at a time, never blocks.
async function prefetchEpochs(run) {
  for (let i = 0; i < S.eps.length; i++) {
    if (run !== S.run) return;
    try { await ensureFrame(i); } catch { /* the slider will show the error if it is needed */ }
  }
}

// Inside one epoch (several images, taken at visits hours to days apart): a source in one visit that is absent at the
// same spot in the other visits moved (or is an artefact; shape-checked in F.singleVisitSources). Each one is compared with
// SkyBoT for that image's exact time. A known asteroid passes when it sits within 12" (+ SkyBoT error), is V <= 19 and has
// a star-like shape. Several sightings of the same object along its path are the strongest proof.
async function insideEpochs(live) {
  const f = S.field, n = f.n, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n }, arc = PX * 3600, found = [], perEpoch = [];
  for (let e = 0; e < S.eps.length; e++) {
    const frs = epochImgs(e).map(im => { const fr = S.frames.get(im.url); return fr && { flat: fr.flat, flatKeep: fr.flatKeep, st: fr.st, touched: fr.touched, touchedHard: fr.touchedHard, mjd: im.mjd, im }; }).filter(Boolean);
    let nsrc = 0;
    for (let j = 0; j < frs.length; j++) {
      const r = F.singleVisitSources(frs, j, n, { nsig: 7 });
      for (const s_ of r.sources.slice(0, 15)) { const sky = F.gridToSky(s_.x, s_.y, grid); found.push({ ...s_, e, im: frs[j].im, ra: sky[0], dec: sky[1] }); nsrc++; }
      await sleep(0); if (!live()) return null;
    }
    perEpoch.push({ epoch: e, images: frs.length, sources: nsrc });
  }
  // SkyBoT only for images that have something to explain (keeps the number of queries down)
  const ims = [...new Map(found.map(x => [x.im.url, x.im])).values()];
  const slot0 = im => S.eps.findIndex((ep, e) => chosen(e) === im);
  await Promise.all(ims.map(im => slot0(im) >= 0 ? ensureMovers(slot0(im)) : ensureMoversIm(im)));
  if (!live()) return null;
  const knownFor = im => { const ei = slot0(im), m = ei >= 0 ? moversOf(ei) : moversIm(im); return (m && m.items) || []; };
  const byObj = new Map(); let unmatched = 0, unRepeat = 0, unOnce = 0;
  const miss = s_ => { unmatched++; if (s_.repeat === true) unRepeat++; else unOnce++; };
  for (const s_ of found) {
    let best = null;
    for (const it of knownFor(s_.im)) { const g = F.skyToGrid(it.ra, it.dec, grid); if (!g) continue; const d = Math.hypot(g[0] - s_.x, g[1] - s_.y); if (d <= PROOF.searchPx && (!best || d < best.d)) best = { it, d, g }; }
    if (!best) { miss(s_); continue; }
    const it = best.it, off = best.d * arc, tol = PROOF.matchArcsec + (Number.isFinite(it.err) ? Math.min(it.err, 30) : 0);
    const posOk = off <= tol, vOk = Number.isFinite(it.vmag) ? it.vmag <= PROOF.vLimit : null, shapeOk = s_.shapeOk;
    if (!posOk) { miss(s_); continue; }
    const key = (it.num || it.name) + '|' + s_.e, o = byObj.get(key) || { key, e: s_.e, name: (it.num ? it.num + ' ' : '') + it.name, cls: it.cls, vmag: it.vmag, err: it.err, sightings: [] };
    o.sightings.push({ e: s_.e, im: s_.im, mjd: s_.im.mjd, x: s_.x, y: s_.y, ra: s_.ra, dec: s_.dec, snr: s_.snr, shape: s_.shape, shapeOk, offsetArcsec: +off.toFixed(1), tolArcsec: +tol.toFixed(0),
      pred: { ra: it.ra, dec: it.dec, x: best.g[0], y: best.g[1] }, matesSeen: s_.matesSeen, mates: s_.mates, repeat: s_.repeat });
    o.vOk = vOk; byObj.set(key, o);
  }
  const asteroids = [...byObj.values()].map(o => ({ ...o, confirmed: o.vOk === true && o.sightings.some(x => x.repeat === true || (x.repeat == null && x.shapeOk !== false)) }))
    .sort((p, q) => q.confirmed - p.confirmed || q.sightings.length - p.sightings.length || (p.vmag || 99) - (q.vmag || 99));
  return { asteroids, unmatched, unRepeat, unOnce, perEpoch, sources: found.length, queried: ims.length };
}

// Analyst's work. Everything is in grid pixels of the shared tangent grid, then converted to sky.
function analyse(a, b, E) {
  const f = S.field, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, fa = frameOf(a), fb = frameOf(b), arc = PX * 3600;
  const dt = E > 1 ? chosen(b).mjd - chosen(a).mjd : 0;
  const knownAt = i => { const s = moversOf(i); return (s && s.items) || []; };
  const near = (items, p, r) => items.find(it => { const g = F.skyToGrid(it.ra, it.dec, grid); return g && Math.hypot(g[0] - p.x, g[1] - p.y) <= r; });
  let cands = [], quality = null;
  if (E > 1 && (!fa || !fb)) throw new Error('The images of both epochs are not loaded, so nothing was compared.');
  if (E > 1 && fa && fb) {
    const maxStarArcsec = STAR_PM_MAX * Math.abs(dt) / 365.25, maxSepPx = maxStarArcsec / arc;
    const t = F.findTransients(fa.flat, fb.flat, f.n, grid, { maxSep: maxSepPx, matchRadius: MATCH_PX, touchedA: fa.touched, touchedB: fb.touched });
    const lamA = lamOf(chosen(a)), lamB = lamOf(chosen(b)), dLam = Math.abs(lamA - lamB);
    const sh = fb.shift, aligned = !sh || sh.ok;
    const misaligned = t.nearMiss >= GATE.nearMissMin && t.nearMiss >= GATE.nearMissFrac * Math.max(1, t.matched);
    const ok = aligned && !misaligned;
    quality = { ok, matched: t.matched, nearMiss: t.nearMiss, edgeRejected: t.edgeRejected, flagRejected: t.flagRejected, sourcesA: t.sourcesA, sourcesB: t.sourcesB,
      lamA: +lamA.toFixed(4), lamB: +lamB.toFixed(4), badPixelsMasked: [fa.mask, fb.mask],
      pairSearch: t.pairSearch, maxStarMotionArcsec: +maxStarArcsec.toFixed(2), rawChanges: t.cands.length,
      text: !aligned ? 'The two epochs could not be aligned on the stars, so no changes are reported.'
        : misaligned ? `The epochs do not line up well enough: ${t.nearMiss} sources seem to jump 3 to 12 pixels, which stars cannot do ` +
          `(at most ${maxStarArcsec.toFixed(1)}″ in ${Math.abs(dt).toFixed(0)} days). This usually means the images differ in wavelength, ` +
          `detector or distortion. No changes are reported, to avoid false alarms.`
        : `${t.matched} sources matched in both epochs, compared at ${lamA.toFixed(3)} and ${lamB.toFixed(3)} µm (${dLam < 0.02 ? 'same colour' : 'Δ ' + dLam.toFixed(3) + ' µm'}). ` +
          (fa.mask || fb.mask ? `Bad pixels flagged by SPHEREx were masked; ${t.flagRejected} spot${t.flagRejected === 1 ? '' : 's'} next to them ${t.flagRejected === 1 ? 'was' : 'were'} not judged. ` : '') +
          (t.pairSearch ? '' : `Stars can move at most ${maxStarArcsec.toFixed(1)}″ in ${Math.abs(dt).toFixed(0)} days (under one pixel), so only sources that appear or vanish are checked.`) };
    if (!ok) return { cands: [], known: knownList(), dtDays: dt, quality };
    cands = t.cands.map((c, i) => {
      const to = c.to || { x: c.x, y: c.y, ra: c.ra, dec: c.dec }, from = c.from || to, sep = c.sepPx * arc;
      // the epoch(s) in which the source is actually seen: a "new" one only in the later epoch, a "gone" one only in the first
      const looks = c.kind === 'new' ? [[b, to]] : c.kind === 'gone' ? [[a, from]] : [[b, to], [a, from]];
      let best = null;
      for (const [ep, p] of looks) for (const it of knownAt(ep)) {
        const g = F.skyToGrid(it.ra, it.dec, grid); if (!g) continue;
        const d = Math.hypot(g[0] - p.x, g[1] - p.y);
        if (d <= PROOF.searchPx && (!best || d < best.dPx)) best = { it, ep, dPx: d, g };
      }
      const seenIn = c.kind === 'gone' ? fa : fb, sp = c.kind === 'gone' ? from : to, ref = starShape(seenIn);
      const shape = { value: peakShape(seenIn.flat, f.n, sp.x, sp.y), stars: ref && ref.median, nStars: ref && ref.n };
      // several images per epoch: in how many images of the epoch where it is seen is it really there, and is it absent from all
      // images of the other epoch?
      let repeat = null;
      if (multi()) {
        const cnt = ep => { const frs = epochImgs(ep).map(im => S.frames.get(im.url)).filter(Boolean); return { seen: frs.filter(fr => { const v = F.snrAt(fr.flat, f.n, fr.st, sp.x, sp.y); return v !== null && v >= 3; }).length, of: frs.length }; };
        const inE = c.kind === 'gone' ? a : b, outE = c.kind === 'gone' ? b : a;
        repeat = { ...cnt(inE), epoch: inE, other: c.kind === 'pair' ? null : { ...cnt(outE), epoch: outE } };
      }
      const proof = makeProof(c, best, arc, shape, repeat);
      return { id: i + 1, kind: c.kind, from, to, sepArcsec: sep, baselineDays: dt, rateArcsecPerYear: dt > 0 ? sep / (dt / 365.25) : null, snr: c.snr,
        epochs: [a, b], status: proof.status, proof, knownMatch: proof.status === 'confirmed' ? proof.near.name : null };
    });
  }
  return { cands, known: knownList(), dtDays: dt, quality };

  function knownList() {
    const objs = new Map();
    for (const [i, fr] of [[a, fa], [b, fb]]) {
      if (!fr) continue;
      for (const it of knownAt(i)) {
        const g = F.skyToGrid(it.ra, it.dec, grid);
        if (!g || g[0] < 1 || g[1] < 1 || g[0] > f.n - 2 || g[1] > f.n - 2) continue;   // inside the SPHEREx footprint only
        const key = it.num || it.name;
        const e = objs.get(key) || { key, num: it.num, name: it.name, cls: it.cls, vmag: it.vmag, speedArcsecPerHour: Math.hypot(it.dra, it.ddec), ra: it.ra, dec: it.dec, snr: {} };
        e.snr['E' + (i + 1)] = F.snrAt(seeOf(fr), f.n, fr.st, g[0], g[1]); e.ra = it.ra; e.dec = it.dec; objs.set(key, e);
      }
    }
    // "seen" needs signal at the predicted spot AND a brightness SPHEREx can reach; a star under a V 23 asteroid is not a detection
    const known = [...objs.values()].map(e => { const faint = Number.isFinite(e.vmag) && e.vmag > PROOF.vLimit;
      return { ...e, tooFaint: faint, detected: !faint && Object.values(e.snr).some(v => v !== null && v >= 3) }; });
    known.sort((p, q) => (q.detected - p.detected) || ((p.vmag || 99) - (q.vmag || 99)));
    return known;
  }
}

function makeProof(c, best, arc, shape, repeat) {
  const sharpOk = shape && shape.value != null && shape.stars ? shape.value >= PROOF.sharpFrac * shape.stars : null;
  const shapeCheck = { name: 'Shape', ok: sharpOk, text: sharpOk == null ? 'Not enough bright stars to compare its shape'
    : sharpOk ? `As blurred as a real star (${shape.value.toFixed(2)}; stars here ${shape.stars.toFixed(2)})`
    : `Much sharper than any star (${shape.value.toFixed(2)}; stars here ${shape.stars.toFixed(2)}). Real objects are blurred by the telescope, so this is probably a cosmic-ray hit or hot pixel` };
  const shapeInfo = shape ? { value: shape.value, starsMedian: shape.stars, starsUsed: shape.nStars } : null;
  const need = repeat ? Math.max(2, Math.ceil(repeat.of / 2)) : 0, repOk = repeat && repeat.of > 1 ? repeat.seen >= need : null;
  const repCheck = repOk == null ? null : { name: 'Repeat', ok: repOk, text: `Seen in ${repeat.seen} of ${repeat.of} images of epoch ${repeat.epoch + 1}` +
    (repeat.other ? `, in ${repeat.other.seen} of ${repeat.other.of} images of epoch ${repeat.other.epoch + 1}` : '') + (repOk ? '' : `. A real object would be in at least ${need}`) };
  const base = [shapeCheck, repCheck].filter(Boolean);
  if (sharpOk === false || repOk === false) return { status: 'artefact', checks: base, shape: shapeInfo, repeat, near: best ? nearInfo(best, arc) : null };
  if (!best) return { status: 'unconfirmed', checks: base, shape: shapeInfo, repeat, near: null };
  const it = best.it, off = best.dPx * arc, tol = PROOF.matchArcsec + (Number.isFinite(it.err) ? Math.min(it.err, 30) : 0);
  const vOk = Number.isFinite(it.vmag) ? it.vmag <= PROOF.vLimit : null;
  const checks = [
    { name: 'Position', ok: off <= tol, text: `${off.toFixed(1)}″ from where SkyBoT predicts it at this image's time (must be under ${tol.toFixed(0)}″, about 2 pixels)` },
    { name: 'Brightness', ok: vOk, text: vOk == null ? 'SkyBoT gives no brightness' : vOk ? `V ${it.vmag.toFixed(1)}, bright enough for one SPHEREx image` : `V ${it.vmag.toFixed(1)} is too faint for one SPHEREx image (needs V ${PROOF.vLimit} or brighter)` },
    { name: 'Motion', ok: true, text: c.kind === 'pair' ? 'Moved between the epochs' : c.kind === 'new' ? 'Not at this spot in the first epoch' : 'Gone from this spot in the later epoch' },
    ...base];
  return { status: checks.every(k => k.ok === true) ? 'confirmed' : 'near', checks, shape: shapeInfo, repeat, near: nearInfo(best, arc) };
}
function nearInfo(best, arc) {
  const it = best.it;
  return { name: (it.num ? it.num + ' ' : '') + it.name, cls: it.cls, vmag: it.vmag, posErrArcsec: it.err, ra: it.ra, dec: it.dec, epoch: best.ep, offsetArcsec: +(best.dPx * arc).toFixed(1), gx: best.g[0], gy: best.g[1] };
}
function buildReport(label, E, a, b, res) {
  const f = S.field, sh = (frameOf(b) || {}).shift;
  const epochs = (E > 1 ? [a, b] : [a]).map(i => { const im = chosen(i), fr = frameOf(i), g = geo(im);
    return { index: i, date: fmtDay(im.mjd), imageId: im.id, detector: im.det, lam: +lamOf(im).toFixed(4), lamMeasured: fr && fr.lamReal != null, lam0: im.lam0, lam1: im.lam1,
      coverage: g ? +g.cover.toFixed(3) : null, detectorPos: g ? { x: Math.round(g.pos.x), y: Math.round(g.pos.y) } : null, predictionCheck: fr ? fr.check : null, badPixels: fr ? fr.mask : null }; });
  const alignmentText = E < 2 ? 'Single epoch, nothing to register.'
    : sh && sh.ok ? `Epoch ${E} moved ${sh.dx.toFixed(2)}, ${sh.dy.toFixed(2)} px onto epoch 1 (${shiftText(sh)}).`
      : 'Alignment could not be refined. Sky coordinates only.';
  return { generated: new Date().toISOString(), tool: 'ARCNAVE', target: { ra: f.ra, dec: f.dec, label },
    field: { sizeDeg: f.size, pixelScaleArcsec: +(PX * 3600).toFixed(2), gridPx: f.n }, wavelengthUm: S.band, imagesFound: S.images.length, epochCount: E, epochs,
    baselineDays: res.dtDays, alignment: sh ? { ok: !!sh.ok, dx: sh.dx, dy: sh.dy, method: sh.method || 'correlation', starsMatched: sh.nMatch ?? null, scatterPx: sh.spread ?? null, matchQuality: sh.ncc ?? null } : null, alignmentText,
    quality: res.quality, candidates: res.cands.map(k => ({ ...k })), knownObjects: res.known, notes: NOTES,
    imagesPerEpoch: multi() ? S.slots.length : 1,
    slots: multi() ? S.slots.map(sl => sl.map(im => ({ id: im.id, det: im.det, mjd: im.mjd, lam: +lamOf(im).toFixed(4), loaded: !!S.frames.get(im.url) }))) : null,
    insideEpochs: S.inside ? { sources: S.inside.sources, unmatched: S.inside.unmatched, unmatchedSeenTwice: S.inside.unRepeat, unmatchedNoSecondExposure: S.inside.unOnce, skybotQueries: S.inside.queried, perEpoch: S.inside.perEpoch,
      asteroids: S.inside.asteroids.map(x => ({ name: x.name, cls: x.cls, vmag: x.vmag, confirmed: x.confirmed,
        sightings: x.sightings.map(g => ({ epoch: g.e, imageId: g.im.id, det: g.im.det, mjd: g.mjd, ra: g.ra, dec: g.dec, snr: +g.snr.toFixed(1), shape: g.shape, offsetArcsec: g.offsetArcsec, predicted: { ra: g.pred.ra, dec: g.pred.dec } })) })) } : null };
}
const fmtRate = r => r == null ? '?' : r < 120 ? `${r.toFixed(1)}″/yr` : `${(r / 3600).toFixed(2)}°/yr`;
function showReport() {
  const r = S.report, c = $('card'); c.replaceChildren(); S.sel = null;
  if (!r) { c.hidden = true; return; }
  c.hidden = false;
  c.append(h('h3', {}, 'Agent report'),
    h('p', {}, `${r.target.label ? r.target.label + ' · ' : ''}RA ${r.target.ra.toFixed(3)}°, Dec ${r.target.dec.toFixed(3)}°, ${r.field.sizeDeg}° field`),
    h('p', {}, h('b', {}, 'Images: '), r.epochs.map(e => `E${e.index + 1} ${e.date} at ${e.lam.toFixed(3)} µm` + (e.coverage != null && e.coverage < 0.99 ? ` (covers ${Math.round(e.coverage * 100)}%)` : '')).join(' · ')),
    h('p', {}, h('b', {}, 'Alignment: '), r.alignmentText));
  if (r.epochCount > 1) {
    const q = r.quality;
    if (q) c.append(h('p', { class: q.ok ? '' : 'warnbox' }, h('b', {}, q.ok ? 'Data check: passed. ' : 'Data check: not reliable. '), q.text));
    const nConf = r.candidates.filter(k => k.status === 'confirmed').length, nArt = r.candidates.filter(k => k.status === 'artefact').length;
    c.append(h('p', {}, h('b', {}, `Changes between epochs (${r.candidates.length}: ${nConf} known asteroid${nConf === 1 ? '' : 's'}, ${nArt} likely artefact${nArt === 1 ? '' : 's'}, ${r.candidates.length - nConf - nArt} unconfirmed)`)));
    if (!r.candidates.length) c.append(h('p', { style: 'font-size:.82rem;color:var(--dust)' }, q && !q.ok ? 'None reported (see the data check above).' : 'Nothing changed above the threshold between the first and last epoch.'));
    r.candidates.slice(0, 10).forEach(k => c.append(h('button', { class: 'mv', onclick: () => { S.al.gotoRaDec(k.to.ra, k.to.dec); S.al.setFov(0.12); showCand(k); } },
      h('b', {}, `C${k.id} ${k.kind === 'pair' ? 'moved' : k.kind === 'new' ? 'appears' : 'vanishes'}`),
      h('small', {}, (k.kind === 'pair' ? `${k.sepArcsec.toFixed(0)}″ (${fmtRate(k.rateArcsecPerYear)}) · ` : '') + `${k.snr.toFixed(0)}σ · ` +
        (k.status === 'confirmed' ? '✓ known asteroid ' + k.knownMatch : k.status === 'artefact' ? 'likely artefact (too sharp)' : k.status === 'near' ? 'near ' + k.proof.near.name + ', not a match' : 'unconfirmed')))));
  }
  if (S.inside) {
    const ins = S.inside, conf = ins.asteroids.filter(x => x.confirmed);
    c.append(h('p', {}, h('b', {}, `Caught moving inside an epoch (${conf.length} known asteroid${conf.length === 1 ? '' : 's'})`)));
    if (!ins.asteroids.length) c.append(h('p', { style: 'font-size:.82rem;color:var(--dust)' }, 'No known asteroid was seen moving between the visits of an epoch.'));
    ins.asteroids.slice(0, 8).forEach(x => c.append(h('button', { class: 'mv', onclick: () => { S.al.gotoRaDec(x.sightings[0].ra, x.sightings[0].dec); S.al.setFov(0.3); showAsteroid(x); } },
      h('b', {}, (x.confirmed ? '✓ ' : '') + x.name), h('small', {}, `V ${Number.isFinite(x.vmag) ? x.vmag.toFixed(1) : '?'} · seen in ${x.sightings.length} image${x.sightings.length === 1 ? '' : 's'} of epoch ${x.sightings[0].e + 1}` + (x.confirmed ? '' : ' · a check fails')))));
    c.append(h('p', { style: 'font-size:.78rem;color:var(--dust)' }, `Other sources at one visit only, matching no known object: ${ins.unRepeat || 0} seen in two exposures in a row ` +
      `(an unknown or faint mover, or a detector artefact), ${ins.unOnce || 0} in a single image with nothing to check against. All unconfirmed; none is claimed as a discovery.`));
  }
  c.append(h('p', {}, h('b', {}, `Known objects in field (${r.knownObjects.length})`)));
  if (!r.knownObjects.length) c.append(h('p', { style: 'font-size:.82rem;color:var(--dust)' }, 'None listed by SkyBoT inside this footprint.'));
  r.knownObjects.slice(0, 10).forEach(k => c.append(h('button', { class: 'mv', onclick: () => { S.al.gotoRaDec(k.ra, k.dec); S.al.setFov(0.15); } },
    h('b', {}, (k.num ? k.num + ' ' : '') + k.name),
    h('small', {}, `${k.cls || 'object'}, V ${Number.isFinite(k.vmag) ? k.vmag.toFixed(1) : '?'} · ` + (k.detected ? 'seen ' : k.tooFaint ? 'too faint for SPHEREx · ' : 'not seen ') +
      Object.entries(k.snr).map(([e, v]) => `${e} ${v == null ? 'no data' : v.toFixed(1) + 'σ'}`).join(', ')))));
  c.append(h('p', { style: 'font-size:.78rem;color:var(--dust)' }, r.notes.join(' ')),
    h('button', { class: 'hbtn', onclick: downloadReport }, 'Download report (JSON)'));
}
function proofCrop(k, i, label) {
  // A zoomed piece of epoch i's aligned image around the change: same sky spot in every crop, so a mover is there in one and gone in the other.
  const fr = frameOf(i), HALF = 12, SC = 5, sz = (2 * HALF + 1) * SC, p = k.kind === 'gone' ? k.from : k.to;
  const cv = document.createElement('canvas'); cv.width = cv.height = sz; cv.className = 'crop';
  const g = cv.getContext('2d'); g.fillStyle = '#05070d'; g.fillRect(0, 0, sz, sz);
  if (fr) {   // one brightness scale for both crops, so "bright here, faint there" is honest
    const n = S.field.n, X0 = Math.round(p.x) - HALF, Y0 = Math.round(p.y) - HALF, W = 2 * HALF + 1, img = new ImageData(W, W);
    const soft = 3 * fr.st.sigma, top = Math.asinh(Math.max(k.cropMax || 0, 10 * fr.st.sigma) / soft);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const X = X0 + x, Y = Y0 + y, v = X >= 0 && Y >= 0 && X < n && Y < n ? seeOf(fr)[Y * n + X] - fr.st.med : NaN;
      const t = Number.isFinite(v) ? Math.max(0, Math.min(1, Math.asinh(Math.max(v, 0) / soft) / top)) : 0, o = (y * W + x) * 4;
      img.data[o] = 40 + 215 * t; img.data[o + 1] = 30 + 200 * t * t + 25 * t; img.data[o + 2] = 60 + 150 * t; img.data[o + 3] = 255;
    }
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = W; tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false; g.drawImage(tmp, 0, 0, sz, sz);
  }
  const cx = (HALF + 0.5 + p.x - Math.round(p.x)) * SC, cy = (HALF + 0.5 + p.y - Math.round(p.y)) * SC;
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.beginPath(); g.arc(cx, cy, 2.2 * SC, 0, 7); g.stroke(); g.setLineDash([]);
  const n = k.proof && k.proof.near;
  if (n && n.epoch === i) {   // where SkyBoT says the known object is at this image's time
    const px = (HALF + 0.5 + n.gx - Math.round(p.x)) * SC, py = (HALF + 0.5 + n.gy - Math.round(p.y)) * SC;
    g.strokeStyle = k.status === 'confirmed' ? '#5ff0a0' : '#ffb05a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(px - 7, py); g.lineTo(px + 7, py); g.moveTo(px, py - 7); g.lineTo(px, py + 7); g.stroke();
  }
  const im = chosen(i);
  return h('figure', {}, cv, h('figcaption', {}, h('b', {}, label), h('small', {}, fr && fr.stack ? `median of ${fr.stack} images` : `${fmtDay(im.mjd)} · ${lamOf(im).toFixed(2)} µm`)));
}
// Crop of one image around point p (grid px), with an optional SkyBoT "+" at q; scale shared via top.
function cropAt(fr, p, q, top, label, sub, good) {
  const HALF = 10, SC = 5, sz = (2 * HALF + 1) * SC, cv = document.createElement('canvas'); cv.width = cv.height = sz; cv.className = 'crop';
  const g = cv.getContext('2d'); g.fillStyle = '#05070d'; g.fillRect(0, 0, sz, sz);
  if (fr) {
    const n = S.field.n, X0 = Math.round(p.x) - HALF, Y0 = Math.round(p.y) - HALF, Wd = 2 * HALF + 1, img = new ImageData(Wd, Wd), soft = 3 * fr.st.sigma, tp = Math.asinh(Math.max(top, 10 * fr.st.sigma) / soft);
    for (let y = 0; y < Wd; y++) for (let x = 0; x < Wd; x++) {
      const X = X0 + x, Y = Y0 + y, v = X >= 0 && Y >= 0 && X < n && Y < n ? seeOf(fr)[Y * n + X] - fr.st.med : NaN;
      const t = Number.isFinite(v) ? Math.max(0, Math.min(1, Math.asinh(Math.max(v, 0) / soft) / tp)) : 0, o = (y * Wd + x) * 4;
      img.data[o] = 40 + 215 * t; img.data[o + 1] = 30 + 200 * t * t + 25 * t; img.data[o + 2] = 60 + 150 * t; img.data[o + 3] = 255;
    }
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = Wd; tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false; g.drawImage(tmp, 0, 0, sz, sz);
  }
  const cx = (HALF + 0.5 + p.x - Math.round(p.x)) * SC, cy = (HALF + 0.5 + p.y - Math.round(p.y)) * SC;
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.beginPath(); g.arc(cx, cy, 2.2 * SC, 0, 7); g.stroke(); g.setLineDash([]);
  if (q) { const px = (HALF + 0.5 + q.x - Math.round(p.x)) * SC, py = (HALF + 0.5 + q.y - Math.round(p.y)) * SC;
    g.strokeStyle = good ? '#5ff0a0' : '#ffb05a'; g.lineWidth = 2; g.beginPath(); g.moveTo(px - 7, py); g.lineTo(px + 7, py); g.moveTo(px, py - 7); g.lineTo(px, py + 7); g.stroke(); }
  return h('figure', {}, cv, h('figcaption', {}, h('b', {}, label), h('small', {}, sub)));
}
// Proof card for a known asteroid caught moving inside an epoch.
function showAsteroid(a) {
  S.sel = { ast: a }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const sg = a.sightings.slice().sort((p, q) => p.mjd - q.mjd), e = sg[0].e, arc = PX * 3600;
  const frOf = im => S.frames.get(im.url), peak = (fr, p) => { const v = F.sampleMax(seeOf(fr), S.field.n, p.x, p.y); return v - fr.st.med; };
  // the same spot in another visit of this epoch, where the asteroid has gone: the "before/after" pair
  const s0 = sg[0], away = epochImgs(e).filter(im => Math.abs(im.mjd - s0.mjd) > 0.1 && frOf(im)).sort((p, q) => Math.abs(p.mjd - s0.mjd) - Math.abs(q.mjd - s0.mjd))[0];
  const top = Math.max(...sg.map(x => frOf(x.im) ? peak(frOf(x.im), x) : 0));
  // up to three sightings spread over the epoch (first, middle, last), so the crops show it at different visits
  const pick = sg.length <= 3 ? sg : [sg[0], sg[sg.length >> 1], sg[sg.length - 1]];
  const crops = pick.map(x => cropAt(frOf(x.im), x, x.pred, top, `Here at +${fmtDur((x.mjd - sg[0].mjd) * 24)}`, `${fmtDay(x.mjd)} ${mjdDate(x.mjd).toISOString().slice(11, 16)}`, a.confirmed));
  if (away) crops.push(cropAt(frOf(away), s0, null, top, 'Other visit: gone', `${fmtDay(away.mjd)} ${mjdDate(away.mjd).toISOString().slice(11, 16)}`));
  const worst = Math.max(...sg.map(x => x.offsetArcsec)), tol = Math.max(...sg.map(x => x.tolArcsec));
  const checks = [
    { name: 'Position', ok: worst <= tol, text: `${sg.length === 1 ? '' : 'Every sighting is '}${worst.toFixed(1)}″ or less from where SkyBoT predicts it at that image's time (limit ${tol}″)` },
    { name: 'Brightness', ok: a.vOk, text: Number.isFinite(a.vmag) ? `V ${a.vmag.toFixed(1)}${a.vOk ? ', bright enough for one SPHEREx image' : ` is too faint for one SPHEREx image (needs V ${PROOF.vLimit} or brighter)`}` : 'SkyBoT gives no brightness' },
    sg.some(x => x.repeat != null)
      ? { name: 'Repeat', ok: sg.some(x => x.repeat === true), text: sg.some(x => x.repeat === true) ? 'Also there in the exposure taken minutes earlier or later in the same visit. A cosmic ray hits only one exposure' : 'Not in the other exposure of the same visit, so it could be a cosmic ray' }
      : { name: 'Shape', ok: sg.some(x => x.shapeOk === true) ? true : sg.every(x => x.shapeOk === false) ? false : null, text: 'As blurred as the stars of the same image, so it is light from the sky, not a hot pixel' },
    { name: 'Gone at other visits', ok: true, text: `Nothing at this spot in the epoch's images taken more than 2.4 hours earlier or later` }];
  if (sg.length >= 2) {   // measured motion between the first and last sighting vs SkyBoT's predicted motion
    const A_ = sg[0], B_ = sg[sg.length - 1], mx = B_.x - A_.x, my = B_.y - A_.y, px = B_.pred.x - A_.pred.x, py = B_.pred.y - A_.pred.y;
    const diff = Math.hypot(mx - px, my - py) * arc, hours = (B_.mjd - A_.mjd) * 24;
    checks.push({ name: 'Motion', ok: diff <= 2 * PROOF.matchArcsec, text: `Moved ${fmtAng(Math.hypot(mx, my) * arc)} in ${fmtDur(hours)}; SkyBoT predicts ${fmtAng(Math.hypot(px, py) * arc)} (difference ${diff.toFixed(0)}″; positions are good to about one 6″ pixel)` });
  }
  const id = encodeURIComponent(a.name.replace(/^\d+\s+/, ''));
  c.append(h('h3', {}, a.name), h('span', { class: 'badge ' + (a.confirmed ? 'ok' : 'near') }, a.confirmed ? '✓ Confirmed known asteroid' : 'Matches a known object, but a check fails'),
    h('p', {}, `${a.cls || 'Asteroid'}, caught in ${sg.length} image${sg.length === 1 ? '' : 's'} of epoch ${e + 1}${sg.length > 1 ? `, ${fmtDur((sg[sg.length - 1].mjd - sg[0].mjd) * 24)} apart` : ''}.`),
    h('div', { class: 'proof' + (crops.length > 2 ? ' four' : '') }, ...crops),
    h('p', { class: 'legend' }, 'Dashed circle: what SPHEREx saw. + : where SkyBoT predicts it at that moment. All crops share one brightness scale.'),
    h('ul', { class: 'checks' }, ...checks.map(x => h('li', { class: x.ok === true ? 'pass' : x.ok === false ? 'fail' : '' }, h('b', {}, (x.ok === true ? '✓ ' : x.ok === false ? '✗ ' : '? ') + x.name + ': '), x.text))),
    h('p', { style: 'font-size:.8rem' }, 'Check it yourself: ', h('a', { href: 'https://minorplanetcenter.net/db_search/show_object?object_id=' + id, target: '_blank', rel: 'noopener' }, 'Minor Planet Center'), ' · ',
      h('a', { href: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=' + id, target: '_blank', rel: 'noopener' }, 'JPL SBDB')),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'A known asteroid that SPHEREx recorded. Not a new discovery.'),
    h('button', { class: 'hbtn', onclick: () => { S.bi = e; S.al.gotoRaDec(s0.ra, s0.dec); S.al.setFov(0.3); setMode('blink'); } }, 'Watch it in Blink'), ' ',
    h('button', { onclick: showReport }, 'Back to report'));
}
function showCand(k) {
  S.sel = { cand: k }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const st = k.status || 'unconfirmed', [a, b] = k.epochs || [0, S.eps.length - 1];
  k.cropMax = 0;   // brightest pixel near the change in either epoch sets the shared crop scale
  for (const i of [a, b]) { const fr = frameOf(i), p = k.kind === 'gone' ? k.from : k.to, n = S.field.n; if (!fr) continue;
    for (let j = -12; j <= 12; j++) for (let q = -12; q <= 12; q++) { const X = Math.round(p.x) + q, Y = Math.round(p.y) + j; if (X >= 0 && Y >= 0 && X < n && Y < n) k.cropMax = Math.max(k.cropMax, fr.flat[Y * n + X] - fr.st.med); } }
  const badge = { confirmed: ['ok', '✓ Confirmed known asteroid'], artefact: ['near', 'Likely artefact, not a real object'], near: ['near', 'Near a known object, but not a match'], unconfirmed: ['unc', 'Unconfirmed change'] }[st];
  c.append(h('h3', {}, 'Candidate C' + k.id), h('span', { class: 'badge ' + badge[0] }, badge[1]),
    h('div', { class: 'proof' }, proofCrop(k, a, `Epoch ${a + 1}`), proofCrop(k, b, `Epoch ${b + 1}`)),
    h('p', { class: 'legend' }, 'Dashed circle: the change. ', k.proof && k.proof.near ? h('span', {}, '+ : where SkyBoT predicts ' + k.proof.near.name + '.') : ''),
    h('p', {}, h('b', {}, 'What: '), { pair: 'A source moved between the epochs', new: 'Appears only in the later epoch', gone: 'Visible only in the first epoch' }[k.kind]),
    h('p', {}, h('b', {}, 'Position: '), `RA ${k.to.ra.toFixed(4)}°, Dec ${k.to.dec.toFixed(4)}°`));
  if (k.kind === 'pair') c.append(h('p', {}, h('b', {}, 'Moved: '), `${k.sepArcsec.toFixed(0)}″ over ${k.baselineDays.toFixed(0)} days (${fmtRate(k.rateArcsecPerYear)})`));
  c.append(h('p', {}, h('b', {}, 'Strength: '), `${k.snr.toFixed(0)}σ`));
  if (k.proof && k.proof.checks.length) c.append(h('ul', { class: 'checks' }, ...k.proof.checks.map(x => h('li', { class: x.ok === true ? 'pass' : x.ok === false ? 'fail' : '' }, h('b', {}, (x.ok === true ? '✓ ' : x.ok === false ? '✗ ' : '? ') + x.name + ': '), x.text))));
  if (k.proof && k.proof.near) {
    const n = k.proof.near;
    c.append(h('p', {}, h('b', {}, 'Closest known object: '), `${n.name} (${n.cls || 'object'}, V ${Number.isFinite(n.vmag) ? n.vmag.toFixed(1) : '?'}), ${n.offsetArcsec}″ away`));
    const id = encodeURIComponent((n.name || '').replace(/^\d+\s+/, ''));
    c.append(h('p', { style: 'font-size:.8rem' }, 'Check it yourself: ', h('a', { href: 'https://minorplanetcenter.net/db_search/show_object?object_id=' + id, target: '_blank', rel: 'noopener' }, 'Minor Planet Center'), '.'));
  } else c.append(h('p', {}, h('b', {}, 'Known object: '), 'none within 49″ (SkyBoT)'));
  c.append(h('p', { style: 'font-size:.8rem;color:var(--dust)' }, st === 'confirmed'
      ? 'This change is a known asteroid seen by SPHEREx: it sits where SkyBoT predicts and is bright enough. Not a new discovery.'
      : st === 'artefact' ? 'ARCNAVE does not count this as a change. Checking several images from the same epoch would settle it: a cosmic ray is in only one of them.'
      : 'Unconfirmed. It could be a real change, a variable star, or an image artefact. Look at both epochs in Blink view before believing it.'),
    h('button', { class: 'hbtn', onclick: () => { S.al.gotoRaDec(k.to.ra, k.to.dec); S.al.setFov(0.08); } }, 'Zoom here'), ' ', h('button', { onclick: showReport }, 'Back to report'));
}
function downloadReport() {
  const r = S.report; if (!r) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `arcnave-report-${r.target.ra.toFixed(2)}_${r.target.dec.toFixed(2)}.json` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/* ---------- debug bundle (local runs only) ---------- */
if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) $('dbg').hidden = false;
$('dbg').onclick = async () => {
  const b = $('dbg'); b.disabled = true;
  const frames = [...S.frames.values()].map(f => ({ url: f.im.url, id: f.im.id, det: f.im.det, mjd: f.im.mjd, lamNominal: f.im.lam, lamReal: f.lamReal, shift: f.shift, stats: f.st }));
  const body = JSON.stringify({ field: S.field, band: S.band, mode: S.mode, epochs: S.eps.map((ep, i) => ({ t0: ep.t0, t1: ep.t1, n: ep.imgs.length, chosen: chosen(i) })),
    frames, report: S.report, userAgent: navigator.userAgent });
  try {
    const r = await fetch('/api/debug/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    toast(`Saved ${j.cutouts} cutouts to ${j.dir}`); stat(`Debug bundle saved in the project folder: ${j.dir}`);
  } catch (e) { toast('Could not save: ' + e.message); }
  b.disabled = false;
};
$('aauto').onclick = e => { S.auto = !S.auto; e.target.setAttribute('aria-pressed', S.auto); e.target.textContent = 'Auto-run on Fly to: ' + (S.auto ? 'on' : 'off'); };

/* ---------- Hide Planet X (v0.10): an injection-recovery test, not a search ---------- */
// A fake planet is added to the aligned images of epochs 1 and N (lib/planetx.js), the stacks are rebuilt and the
// Analyst's own detector looks for it. Click the sky in this mode to choose where it starts.
const PXD = [50, 100, 150, 200, 300, 400, 500, 600, 700, 850, 1000];
const PXM = { mags: [], dists: [100, 150, 200, 300, 500, 700, 1000], positions: 16 };
S.px = { spot: null, res: null, cv: null, map: null, busy: false };
const pxDist = () => PXD[+$('pxd').value];
const fmtMJy = f => f >= 1 ? f.toFixed(1) + ' mJy' : f >= 0.01 ? (f * 1000).toFixed(0) + ' µJy' : (f * 1000).toFixed(1) + ' µJy';
function pxLabels() {
  const m = +$('pxm').value; $('pxdo').textContent = pxDist() + ' AU'; $('pxmo').textContent = `AB ${m.toFixed(2)} (${fmtMJy(SkyPlanetX.abToMJy(m))})`;
}
// The two compared epochs with their images, as lib/planetx.js wants them. Cached until anything is re-aligned.
function pxContext() {
  const E = S.eps.length; if (E < 2 || !window.SkyPlanetX) return { error: 'Hide Planet X needs two epochs of a field. Run the agents on a field first.' };
  // Compare the two passes where Earth was farthest apart: a distant planet's jump is parallax, so passes a year apart (Earth
  // back in the same place) would show almost no jump and the fake would subtract itself out like a star (seen on 189.957 -4.182).
  let a = 0, b = E - 1, best = -1;
  for (let i = 0; i < E; i++) for (let j = i + 1; j < E; j++) {
    const ti = S.eps[i].imgs[0].mjd, tj = S.eps[j].imgs[0].mjd, p = SkyPlanetX.earthVector(ti), q = SkyPlanetX.earthVector(tj), d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (d > best + 0.05) { best = d; a = i; b = j; }
  }
  const key = S.field.ra + ',' + S.field.dec + '|' + S.alignVer + '|' + S.depth;
  if (S.px.ctx && S.px.key === key) return S.px.ctx;
  const ep = e => { const frs = epochImgs(e).map(im => S.frames.get(im.url)).filter(Boolean), st = frameOf(e);
    return frs.length && st ? { frames: frs.map(f => ({ flat: f.flat, touched: f.touched, mjd: f.im.mjd })).sort((p, q) => p.mjd - q.mjd), stack: { flat: st.flat, touched: st.touched, st: st.st } } : null; };
  const A = ep(a), B = ep(b); if (!A || !B) return { error: `The images of epochs ${a + 1} and ${b + 1} are not loaded yet.` };
  const f = S.field, dt = B.frames[0].mjd - A.frames[0].mjd;
  const ctx = SkyPlanetX.makeContext(F, [A, B], { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, { maxSep: STAR_PM_MAX * Math.abs(dt) / 365.25 / (PX * 3600), matchRadius: MATCH_PX, sharpFrac: PROOF.sharpFrac });
  if (!ctx.psf) return { error: 'Not enough bright, isolated stars in this field to measure the telescope blur.' };
  ctx.limit = SkyPlanetX.expectedLimit(ctx); ctx.a = a; ctx.b = b; ctx.earthAU = best;
  S.px.ctx = ctx; S.px.key = key; S.px.map = null; updateLabels(); return ctx;
}
function pxHide() {
  const ctx = pxContext(); if (ctx.error) { $('pxt').textContent = ctx.error; return; }
  const n = S.field.n;
  if (!S.px.spot) { const p = SkyPlanetX.trialPositions(ctx.epochs[0].stack.flat, n, 25, 25, (Date.now() & 0xffff) + 1); S.px.spot = p[Math.floor(Math.random() * p.length)]; }
  const m = +$('pxm').value, r = SkyPlanetX.trial(ctx, { x: S.px.spot.x, y: S.px.spot.y, dist: pxDist(), mJy: SkyPlanetX.abToMJy(m) });
  const d = F.renderDiff(r.stacks[0].flat, r.stacks[1].flat), cv = document.createElement('canvas'); cv.width = cv.height = n;
  cv.getContext('2d').putImageData(new ImageData(d.rgba, n, n), 0, 0);
  S.px.res = r; S.px.cv = cv; showPx(r, ctx); pxStat(ctx);
}
const pxStat = ctx => stat(`Hide Planet X: ${epLabel(ctx.a)} vs ${epLabel(ctx.b)}, the passes with Earth farthest apart (${ctx.earthAU.toFixed(1)} AU).`);
function pxWhy(r, ctx) {
  const e0 = r.epochs[0], e1 = r.epochs[1], fainter = r.ab - ctx.limit.ab;
  if (e0.moveDuringEpochPx > 2.5) return `At ${r.dist} AU it moves ${(e0.moveDuringEpochPx * PX * 3600).toFixed(0)}″ during one pass (${e0.spanDays.toFixed(1)} days), so the median of the pass's images wipes it out, like a cosmic ray. A nearer body is the job of the inside-the-epoch search.`;
  const jumpPx = Math.hypot(e1.at.x - e0.at.x, e1.at.y - e0.at.y);
  if (jumpPx < 2.5 && e1.at.x >= 0) return `It barely moved between the two passes (${(jumpPx * PX * 3600).toFixed(0)}″, under the size of a star), so it cancels itself out exactly like a star does. Farther than this, two snapshots cannot tell a planet from a star; it takes more passes or a longer baseline.`;
  if (fainter > -0.3) return `Too faint for this field: about ${fainter >= 0 ? fainter.toFixed(1) + ' mag fainter than' : 'at'} the noise limit (AB ${ctx.limit.ab.toFixed(1)}).`;
  return 'It landed on or next to a brighter star, where the Analyst ignores changes because star leftovers look the same. A real planet could hide there too.';
}
function showPx(r, ctx) {
  S.sel = { px: true }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const both = r.foundA && r.foundB, e1 = r.epochs[1], out1 = !(e1.at.x >= 0 && e1.at.y >= 0 && e1.at.x <= S.field.n - 1 && e1.at.y <= S.field.n - 1);
  c.append(h('button', { class: 'x', 'aria-label': 'Close', onclick: () => { c.hidden = true; S.sel = null; } }, '×'));
  c.append(h('p', { class: 'pxbig ' + (r.found ? 'ok' : 'no') }, r.found ? '✓ Found by the agents' : '✗ Missed'));
  c.append(h('p', {}, `Fake planet: ${r.dist} AU away, AB ${r.ab.toFixed(2)} (${fmtMJy(r.mJy)}) at ${lamOf(chosen(ctx.a)).toFixed(2)} µm.`));
  if (r.found) c.append(h('p', {}, both ? `Seen in epoch ${ctx.a + 1} (${r.hitA.snr.toFixed(0)}σ) and in epoch ${ctx.b + 1} (${r.hitB.snr.toFixed(0)}σ).`
    : r.foundA ? `Seen in epoch ${ctx.a + 1} (${r.hitA.snr.toFixed(0)}σ) ${out1 ? 'and then out of this patch' : 'but not in epoch ' + (ctx.b + 1)}.` : `Seen in epoch ${ctx.b + 1} (${r.hitB.snr.toFixed(0)}σ), not in epoch ${ctx.a + 1}.`));
  else c.append(h('p', {}, 'Why: ' + pxWhy(r, ctx)));
  c.append(h('p', {}, `Between the passes (${r.dtDays.toFixed(0)} days) it jumped ${(r.shiftArcsec / 60).toFixed(1)}′${out1 ? ', out of this 0.5° patch' : ''}. That jump is parallax: Earth moved, the planet barely did. Nearer means a bigger jump, so the jump tells the distance.`));
  c.append(h('p', { style: 'font-size:.8rem;color:var(--dust)' }, `Its own orbital motion is left out (at ${r.dist} AU about ${(SkyPlanetX.orbitArcsecPerYear(r.dist) / 60).toFixed(1)}′ a year). Blur from ${ctx.psf.nStars} stars of this field (FWHM ${(ctx.psf.fwhmPx * PX * 3600).toFixed(0)}″). This is a test with a fake planet; nothing here is a real detection.`));
  c.append(h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'White ring: where it was hidden (epoch ' + (ctx.a + 1) + '). Dashed ring: where it was in epoch ' + (ctx.b + 1) + '. Click the sky to hide it somewhere else.'));
}
function drawPx(T) {
  const r = S.px.res; if (!r) return;
  const ring = (p, dash, col) => { if (!(p.x >= 0 && p.y >= 0 && p.x <= S.field.n - 1 && p.y <= S.field.n - 1)) return null;
    const X = T.a * (p.x + 0.5) + T.c * (p.y + 0.5) + T.e, Y = T.b * (p.x + 0.5) + T.d * (p.y + 0.5) + T.f;
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2; if (dash) ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(X, Y, 13, 0, 7); ctx.stroke(); ctx.restore(); return [X, Y]; };
  const col = r.found ? '#5ff0a0' : '#ff7a7a', A = ring(r.epochs[0].at, false, '#fff'), B = ring(r.epochs[1].at, true, '#fff');
  if (A) { ctx.fillStyle = col; ctx.font = '600 13px Archivo,sans-serif'; ctx.fillText(r.found ? 'found' : 'missed', A[0] + 16, A[1] - 10); }
  if (A && B) { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.setLineDash([2, 5]); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.restore(); }
}
// click in this mode: choose the hiding spot (screen -> grid via the inverse of the image transform)
function pxClick(x, y) {
  const T = affine(); if (!T || !S.field) return false;
  const det = T.a * T.d - T.b * T.c; if (!det) return false;
  const gx = (T.d * (x - T.e) - T.c * (y - T.f)) / det - 0.5, gy = (-T.b * (x - T.e) + T.a * (y - T.f)) / det - 0.5, n = S.field.n;
  if (gx < 6 || gy < 6 || gx > n - 7 || gy > n - 7) return false;
  S.px.spot = { x: gx, y: gy }; pxHide(); return true;
}
async function pxMap() {
  const ctx = pxContext(); if (ctx.error) { $('pxt').textContent = ctx.error; return; }
  if (S.px.busy) return; S.px.busy = true; $('pxmap').disabled = true; pxStat(ctx);
  try {
    const L = Math.round(ctx.limit.ab * 2) / 2, mags = []; for (let m = L - 3; m <= L + 1.5 + 1e-9; m += 0.5) mags.push(+m.toFixed(2));
    const pos = SkyPlanetX.trialPositions(ctx.epochs[0].stack.flat, S.field.n, PXM.positions, 25, 7), t0 = performance.now();
    const run = S.run;
    const res = await SkyPlanetX.map(ctx, { dists: PXM.dists, mags, positions: pos, progress: async q => { $('pxs').textContent = `Hiding ${PXM.dists.length * mags.length * pos.length} fake planets... ${Math.round(q * 100)}%`; await sleep(0); } });
    if (run !== S.run) return;
    res.ms = Math.round(performance.now() - t0); res.limit = ctx.limit; S.px.map = res; drawPxMap(res);
  } finally { S.px.busy = false; $('pxmap').disabled = false; }
}
$('pxd').oninput = $('pxm').oninput = () => pxLabels();
$('pxgo').onclick = () => pxHide();
$('pxmap').onclick = () => pxMap();
function drawPxMap(m) {
  const cv = $('pxc'), g = cv.getContext('2d'), W2 = cv.width, H2 = cv.height, L = 70, B = 34, Tp = 14, R = 10;
  cv.hidden = false; g.clearRect(0, 0, W2, H2);
  const cw = (W2 - L - R) / m.dists.length, ch = (H2 - Tp - B) / m.mags.length;
  g.font = '11px Archivo,sans-serif'; g.fillStyle = '#9fb0dc';
  m.cells.forEach(c => { const i = m.dists.indexOf(c.dist), j = m.mags.indexOf(c.ab), q = c.found / c.of;
    g.fillStyle = `hsl(${q * 140},70%,${18 + q * 30}%)`; g.fillRect(L + i * cw + 1, Tp + j * ch + 1, cw - 2, ch - 2);
    g.fillStyle = q > 0.5 ? '#04101c' : '#eaf0ff'; g.textAlign = 'center'; g.fillText(`${c.found}/${c.of}`, L + (i + 0.5) * cw, Tp + (j + 0.5) * ch + 4); });
  g.fillStyle = '#9fb0dc'; g.textAlign = 'right';
  m.mags.forEach((ab, j) => { if (j % 2 === 0) g.fillText('AB ' + ab.toFixed(1), L - 6, Tp + (j + 0.5) * ch + 4); });
  g.textAlign = 'center'; m.dists.forEach((d, i) => g.fillText(d + ' AU', L + (i + 0.5) * cw, H2 - B + 16));
  g.fillText('distance →     (brighter at top)', W2 / 2, H2 - 4);
  const best = m.limits.filter(x => x.ab50 != null), far = best.filter(x => x.dist >= 300);
  const lim = far.length ? Math.min(...far.map(x => x.ab50)) : null;
  $('pxs').innerHTML = '';
  $('pxs').append(h('span', {}, h('b', {}, lim != null ? `This field's limit: about AB ${lim.toFixed(1)} (${fmtMJy(SkyPlanetX.abToMJy(lim))}) ` : 'No distance reached 50% recovery. '),
    lim != null ? `found at least half the time, for planets 300 AU and farther. The noise alone predicts AB ${m.limit.ab.toFixed(1)}. ` : '',
    `${m.cells.length * m.positions} fake planets, ${(m.ms / 1000).toFixed(0)} s. Misses at bright levels: the planet sat on a brighter star, moved too little between the passes (far right) or moved during a pass (far left).`));
}

/* ---------- boot ---------- */
function boot() {
  const p = new URLSearchParams(location.hash.slice(1)), has = p.has('ra');
  const o = { target: has ? `${p.get('ra')} ${p.get('dec')}` : '190 -4', fov: has ? +p.get('fov') || 1.2 : 1.5, survey: 'P/allWISE/color', cooFrame: 'ICRSd',
    showReticle: false, showZoomControl: false, showFullscreenControl: false, showLayersControl: false, showGotoControl: false, showFrame: false,
    showProjectionControl: false, showCooGridControl: false, showContextMenu: false, showSimbadPointerControl: false, showShareControl: false,
    showCooLocation: false, showFov: false, showStatusBar: false };   // v0.4.1: no Aladin coordinate box over our title (our RA/Dec panel shows the same)
  S.al = A.aladin('#aladin', o);
  if (p.get('ipe') && [1, 4, 8].includes(+p.get('ipe'))) { S.depth = +p.get('ipe'); $('ipe').value = S.depth; }
  if (has) {
    S.band = +p.get('b') || 3; $('band').value = S.band; if (p.get('sz')) $('csize').value = p.get('sz');
    S.ei = +p.get('e') || 0; if (p.get('m') && helps[p.get('m')]) S.mode = p.get('m');
  }
  setMode(S.mode); updateLabels(); renderAgents(); if (innerWidth <= 700) $('agents').open = false;
  const el = $('aladin'); let down = null;
  el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; }, true);
  el.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) pickAt(e.clientX, e.clientY); down = null; }, true);
  requestAnimationFrame(frame);
  if (p.get('ex') && EXAMPLES[p.get('ex')]) { runExample(p.get('ex')); return; }
  if (has && p.get('load') === '1') { $('intro').hidden = true; runAgents({ ra: +(p.get('fra') ?? p.get('ra')), dec: +(p.get('fdec') ?? p.get('dec')), label: 'Shared view' }, { skipNav: true, keepMode: true }); }
}
if (typeof A === 'undefined') {
  stat('Aladin Lite failed to load (check your internet connection).', true); $('intro').hidden = true;
} else (A.init && A.init.then ? A.init : Promise.resolve()).then(boot).catch(e => stat('Sky viewer failed to start: ' + e.message, true));
