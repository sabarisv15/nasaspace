'use strict';
// ARCNAVE front end. Aladin Lite draws the base sky; a transparent canvas on top draws
// real SPHEREx cutouts (reprojected onto a tangent grid) and known movers.
const $ = id => document.getElementById(id), F = window.SkyFits;
const BOOT_HASH = location.hash;
// v0.34: ?embed=1 (or #embed=1): the minimal view for embedding in other web pages
const EMBED = /[?&#]embed=1\b/.test(location.search + location.hash);
if (EMBED) document.documentElement.classList.add('embed');   // the link as opened (#tour, #play, #ex=..., lang=ta): later view updates rewrite the hash
window.BOOT_HASH = BOOT_HASH;
const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
const PX = 6.15 / 3600, MAXN = 700; // SPHEREx pixel is about 6.2 arcsec
const S = { al: null, field: null, images: [], eps: [], frames: new Map(), movers: new Map(), tracks: new Map(),
  band: 3, mode: 'time', ei: 0, split: 50, flipped: false, sel: null, ecl: false, rt: 0, diff: null, hits: [], lab: false,
  run: 0, load: 0, ref: null, auto: true, geo: new Map(), ag: {}, cands: [], known: [], report: null, mvp: new Map(), fp: new Map(), lastErr: '',
  depth: 8, slots: [], seq: [], ti: 0, bi: 0, stacks: new Map(), alignVer: 0, inside: null, blinkAt: -1, cv: 'st', chg: null };

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
// v0.38: the browser allows only 6 connections to one host. Known-mover lookups (SkyBoT / MPC) take 10-16 s each and 27 of them
// were sitting on all 6, so the image requests queued behind them (measured on a cold field: 24 image requests waited 11 s each).
// Movers now use at most 3 connections; the other 3 stay free for images.
const LANE = { active: 0, max: 3, waiting: [] };
async function api(path) {
  const slow = path.startsWith('/api/movers');
  if (slow) { while (LANE.active >= LANE.max) await new Promise(r => LANE.waiting.push(r)); LANE.active++; }
  try { return await apiOnce(path); } finally { if (slow) { LANE.active--; LANE.waiting.shift()?.(); } }
}
async function apiOnce(path) {
  const r = await fetch(path); let j = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new Error((j && j.error) || 'HTTP ' + r.status);
  return j;
}
function toast(t, ms = 3200) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.i); toast.i = setTimeout(() => e.hidden = true, ms); }
function stat(msg, bad) { const e = $('stat'); e.textContent = msg; e.classList.toggle('err', !!bad); }

/* ---------- epochs and image choice ---------- */
function groupEpochs(imgs) {
  const eps = []; let cur = null;
  for (const im of imgs) {
    if (!cur || im.mjd - cur.t1 > 60) { cur = { imgs: [], t0: im.mjd, t1: im.mjd }; eps.push(cur); }
    cur.imgs.push(im); cur.t1 = im.mjd;
  }
  // v0.33: near the ecliptic poles SPHEREx sees a field all year with no 60-day gap (R Draconis, a challenge target: 2454
  // images from 2025-04 to 2026-09 came out as ONE epoch, so nothing could be compared). A run longer than 200 days is cut
  // into 182-day passes, like the six-month passes everywhere else.
  const out = [];
  for (const ep of eps) {
    if (ep.t1 - ep.t0 <= 200) { out.push(ep); continue; }
    let c = null;
    for (const im of ep.imgs) { if (!c || im.mjd - c.t0 >= 182) { c = { imgs: [], t0: im.mjd, t1: im.mjd }; out.push(c); } c.imgs.push(im); c.t1 = im.mjd; }
  }
  return out;
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
const multi = () => S.depth > 1 && (S.slots.length > 1 || (S.extra || []).some(x => x.length));
// v0.23: an epoch's images = its colour-matched slot images, then extra images of that pass (filled up to "Images per epoch").
// The extras are not colour-matched with the other passes: they are used for flipping through a pass and for finding what
// moves inside it, never for the comparisons BETWEEN passes (stacks, Changes, Analyst epoch-to-epoch), which use matched ones.
const matchedImgs = i => multi() ? S.slots.map(sl => sl[i]).filter(Boolean) : [chosen(i)];
const epochImgs = i => multi() ? [...matchedImgs(i), ...((S.extra && S.extra[i]) || [])] : [chosen(i)];
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
  // A colour the user picked: keep every image on the same detector(s) as slot 0, i.e. in that colour range. The automatic
  // colour (and the published scorecard runs) keep the original rule, any colour that matches across epochs.
  const dets = S.userBand ? [...new Set(first.map(im => im.det))] : null;
  let sl = SkySlots.buildSlots(lists, S.depth, { first: f0, tolFrac: 0.008, dets });
  if (sl.length < S.depth) { const wide = SkySlots.buildSlots(lists, S.depth, { first: f0, tolFrac: 0.015, dets }); if (wide.length > sl.length) sl = wide; }
  S.slots = sl.length ? sl.map(x => x.items.map(it => it.im)) : [first];
  S.slotDLam = sl.length ? Math.max(...sl.map(x => x.dLam)) : 0;
  // v0.23: fill every pass up to "Images per epoch" with its own extra images: same detector (colour range) as its first image
  // first, then the closest colour, at least half the field covered, preferring visits not used yet. A pass that has fewer
  // images in the archive gets all it has, and the Archivist says so.
  S.extra = S.eps.map(() => []);
  S.eps.forEach((ep, e) => {
    const have = new Set(S.slots.map(sl => sl[e]).filter(Boolean)), need = S.depth - have.size, im0 = S.slots[0][e];
    if (need <= 0 || !im0) return;
    const l0 = lamRank(im0), mjds = [...have].map(im => im.mjd);
    const pool = ep.imgs.filter(im => !have.has(im) && (!dets || dets.includes(im.det))).map(im => ({ im, g: geo(im) })).filter(o => !o.g || o.g.cover >= 0.5);
    while (S.extra[e].length < need && pool.length) {
      let bi = 0, bs = Infinity;
      pool.forEach((o, j) => { const cover = o.g ? o.g.cover : 1, fresh = !mjds.some(t => Math.abs(t - o.im.mjd) < 0.1);
        const sc = (o.im.det === im0.det ? 0 : 1) + 20 * Math.abs(lamRank(o.im) - l0) / l0 + 2 * (1 - cover) - (fresh ? 0.5 : 0); if (sc < bs) { bs = sc; bi = j; } });
      const o = pool.splice(bi, 1)[0]; S.extra[e].push(o.im); mjds.push(o.im.mjd);
    }
  });
  buildSeq();
}
// Images per pass, said plainly (equal, or one count per pass).
const perEpochTxt = () => { const per = S.eps.map((_, e) => epochImgs(e).length); return per.every(n => n === per[0]) ? `${per[0]} per epoch` : per.join(' + '); };
// All images of all slots in time order (what Time machine steps through).
function buildSeq() {
  S.seq = [];
  S.eps.forEach((ep, e) => epochImgs(e).forEach((im, k) => S.seq.push({ e, k, im, extra: k >= S.slots.length })));
  S.seq.sort((p, q) => p.e - q.e || p.im.mjd - q.im.mjd);
  S.seq.forEach((x, i) => { x.i = i; x.n = S.seq.filter(y => y.e === x.e).length; x.pos = S.seq.filter(y => y.e === x.e && y.i < i).length + 1; });
  S.stacks.clear();
}
// Median stack of an epoch's loaded images, cached until anything is re-aligned.
// v0.57.9: the key names each member image and its own alignment version (fv): a stack is rebuilt only when one of ITS
// images changes. With the global S.alignVer every new image anywhere (the 36 of a Deep view, other colours) rebuilt every
// epoch's stack and the Changes maps again (Deep view on Barnard's Star: 78 stack builds, 10 s of frozen page)
const stackKey = i => { const frs = matchedImgs(i).map(im => S.frames.get(im.url)).filter(Boolean); return { frs, key: i + '|' + frs.map(f => f.im.url + '@' + (f.fv || 0)).join(',') }; };
function stackOf(i) {
  const { frs, key } = stackKey(i);
  if (frs.length < 2) return rawOf(i);
  const c = S.stacks.get(i); if (c && c.key === key) return c.f;
  const n = S.field.n, ms = F.medianStack(frs.map(f => f.flat), n, { touched: frs.map(f => f.touched) });
  const st = F.robustStats(ms.flat); if (!st) return rawOf(i);
  const touched = new Float32Array(n * n); for (let p = 0; p < touched.length; p++) touched[p] = ms.touched[p] >= 0.5 ? 1 : 0;
  const base = rawOf(i) || frs[0], cv = document.createElement('canvas'); cv.width = cv.height = n;
  const f = { im: base.im, flat: ms.flat, flat0: ms.flat, touched, st, canvas: cv, rgb: base.rgb, shift: base.shift, lamReal: base.lamReal, mask: base.mask, check: base.check, stack: frs.length, frames: frs };
  paint(f); S.stacks.set(i, { key, f }); return f;
}
// v0.57.8: what the sky view draws. Every image that arrives changes an epoch's stack, and the view used to rebuild the
// median stacks on the very next frame (0.05-0.2 s each, again for each of 250 images: a stutter all through loading).
// While images keep arriving the view now shows the last stack and rebuilds at most once a second, one epoch per pause.
// Measurements still call stackOf() and always get the up-to-date stack, as before.
const VSTK = { t: 0, timer: 0, n: 0, built: -1 };
function viewFrame(i) {
  if (!S.eps[i] || !multi()) return frameOf(i);
  const c = S.stacks.get(i);
  if (!c) { if (VSTK.built === VSTK.n && rawOf(i)) return rawOf(i); VSTK.built = VSTK.n; return frameOf(i); }   // first stacks: one per frame
  const { frs, key } = stackKey(i); if (frs.length < 2 || c.key === key) return frameOf(i);
  if (performance.now() - VSTK.t > 1000) { VSTK.t = performance.now(); return frameOf(i); }
  if (!VSTK.timer) VSTK.timer = setTimeout(async () => {
    VSTK.timer = 0; const fld = S.field;
    for (let e = 0; e < S.eps.length && S.field === fld; e++) { try { frameOf(e); } catch { /* drawn next frame */ } await yieldNow(); }
    VSTK.t = performance.now();   // the sky redraws on its own within 0.2 s
  }, 1000);
  return c.f;
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
// v0.56.3: every SPHEREx archive search goes through here. A test field's list is frozen by the server (the list its quoted
// numbers were measured on, opened from saved images); a spot switched to the archive's newest list ("Check for new data")
// asks with latest=1. Same 0.001° key as the server's search cache.
const spotKey = (ra, dec) => `${(+ra).toFixed(3)},${(+dec).toFixed(3)}`;
S.latest = new Set();
const searchUrl = (ra, dec) => `/api/spherex/search?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}` + (S.latest.has(spotKey(ra, dec)) ? '&latest=1' : '');
async function loadField(ra, dec, opts = {}) {
  if (!S.al) return false;
  const mine = ++S.load, size = +$('csize').value, n = Math.min(MAXN, Math.round(size / PX));
  S.rt++; S.frames.clear(); S.fp.clear(); S.geo.clear(); S.movers.clear(); S.mvp.clear(); S.need = new Set(); S.tracks.clear(); S.diff = null; S.sel = null; S.ref = null;
  S.cands = []; S.known = []; S.report = null; S.eps = []; S.images = []; S.slots = []; S.seq = []; S.stacks.clear(); S.inside = null; S.chg = null; if (typeof CHGW !== 'undefined') CHGW.show = null; if (S.px) { S.px.res = null; S.px.ctx = null; S.px.spot = null; S.px.map = null; $('pxc').hidden = true; $('pxs').textContent = ''; $('pxt').textContent = ''; } S.ti = 0; S.bi = 0; $('card').hidden = true; renderStrip();
  S.field = { ra, dec, size, n, s: PX };
  $('load').disabled = true; stat('Searching the IRSA archive for SPHEREx images...');
  let r;
  try { r = await api(searchUrl(ra, dec)); }
  catch (e) {
    if (mine !== S.load) return false;
    S.lastErr = 'IRSA search failed: ' + e.message; stat(S.lastErr, true); S.field = null; $('load').disabled = false; return false;
  }
  if (mine !== S.load) return false;   // a newer search took over
  $('load').disabled = false;
  S.images = r.images; S.eps = groupEpochs(r.images); S.dropped = null;
  S.search = { checkedAt: r.checkedAt || null, stale: !!r.stale, savedAt: r.savedAt || null, frozen: !!r.frozen, ra, dec };   // v0.55 U7: how old the image list is (v0.56.3: frozen, see searchUrl)
  if (opts.auto && S.eps.length) { S.band = bestBand(); $('band').value = S.band; spxFollow(); }   // the colour from every pass (as before), so the shipped examples and landmarks keep their images
  // (v0.22.1 left a thin pass out; v0.23 keeps every pass and fills each with its own extra images instead)
  if (!S.eps.length) { S.lastErr = 'No SPHEREx images cover this spot in the archive yet. Try another position.'; stat(S.lastErr, true); S.field = null; return false; }
  S.ei = S.eps.length - 1; // start on the latest epoch
  buildSlotsNow(); renderStrip();
  setSlider();
  stat(`${r.count} spectral images in ${S.eps.length} epoch${S.eps.length > 1 ? 's' : ''}.` + (r.stale ? ` IRSA did not answer, so this is the list saved ${fmtAge(r.savedAt)}.` : ''), !!r.stale);
  relRender();
  return true;
}
/* ---------- v0.55 U7: data-release panel ----------
   What is loaded (releases, passes and their dates, the newest image), how old the archive's image list is (the server keeps
   it a day, or serves the last copy when IRSA does not answer), and a button that asks IRSA again now. */
// v0.57.1: the SPHEREx data releases NASA has out now (server: /api/spherex/releases, S3 bucket listing, kept a day).
// A release newer than the ones this version was built with gets one note per browser; nothing else changes, because the
// archive search already includes every release.
let NASA_REL = null;
(async () => {
  try { NASA_REL = await api('/api/spherex/releases'); } catch { return; }
  if (typeof relRender === 'function') relRender();
  const nw = NASA_REL.newSinceBuild || [];
  if (nw.length) { let told = ''; try { told = localStorage.getItem('arcnave-rel-told') || ''; } catch { /* no storage */ }
    if (told !== nw.join(',')) { toast(`New SPHEREx data at NASA: ${nw.join(', ')}. ARCNAVE searches it already in every new spot.`, 6000); try { localStorage.setItem('arcnave-rel-told', nw.join(',')); } catch { /* no storage */ } } }
})();
const fmtAge = iso => { const t = iso ? Date.parse(iso) : NaN; if (!(t > 0)) return 'at an unknown time'; const m = (Date.now() - t) / 6e4;
  return m < 1.5 ? 'just now' : m < 90 ? `${Math.round(m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago (${iso.slice(0, 10)})`; };
function relRender(msg) {
  const box = $('relp'); if (!box) return;
  if (!S.images || !S.images.length || !S.search) { box.replaceChildren(h('p', { class: 'gnote' }, 'Open a patch of sky first.')); return; }
  const by = {}; for (const im of S.images) { const k = releaseOf(im) || '?'; by[k] = (by[k] || 0) + 1; }
  const s = S.search, last = Math.max(...S.images.map(i => i.mjd));
  box.replaceChildren(...[   // v0.56.3: empty slots left out (replaceChildren wrote them as the word "null")
    h('p', {}, h('b', {}, 'Releases: '), Object.entries(by).sort().map(([k, n]) => `${k === '?' ? 'unknown' : k} (${n} images)`).join(' + ') + ` · newest image ${fmtDay(last)}`),
    h('ul', { class: 'rellist' }, ...S.eps.map((ep, e) => h('li', {}, h('b', {}, `Pass ${e + 1}`), ` · ${fmtDay(ep.t0)} to ${fmtDay(ep.t1)} · ${ep.imgs.length} images` +
      ` (${[...new Set(ep.imgs.map(releaseOf).filter(Boolean))].join(', ') || '?'})`))),
    // v0.57.1: what NASA has out (the server's release watcher, asked once a day)
    NASA_REL ? h('p', {}, h('b', {}, 'At NASA now: '), `${NASA_REL.releases.join(', ')} (newest ${NASA_REL.newest}, checked ${fmtAge(NASA_REL.checkedAt)}${NASA_REL.stale ? ', saved list' : ''}). ` +
      (NASA_REL.newSinceBuild.length ? `New since this ARCNAVE version: ${NASA_REL.newSinceBuild.join(', ')}. ` : '') +
      'The archive search has no release filter, so every new release is searched by itself in every spot.') : null,
    s.frozen ? h('p', {}, h('b', {}, 'Kept as measured: '), 'this spot is one of ARCNAVE\'s test fields, so its image list is kept as it was when the numbers ARCNAVE quotes were measured, and it opens from saved images. NASA released SPHEREx Data Release 1 (DR1) in November 2026: "Check for new data" shows what IRSA lists now and can switch this spot to it.') : null,
    h('p', { class: s.stale ? 'relwarn' : '' }, h('b', {}, 'Archive asked: '), s.stale ? `IRSA did not answer, so this is the list saved ${fmtAge(s.savedAt)}.`
      : s.checkedAt ? `${fmtAge(s.checkedAt)}. ARCNAVE keeps the list a day; new images in between show after "Check for new data".` : 'time not recorded (a copy shipped with ARCNAVE, or saved before v0.55). "Check for new data" asks IRSA now.'),
    msg ? h('p', { class: 'relmsg' }, ...[].concat(msg)) : null].filter(Boolean));
}
async function relCheck() {
  if (!S.field || !S.search) { toast('Open a patch of sky first.'); return; }
  const b = $('relchk'); if (b) b.disabled = true; relRender('Asking the IRSA archive now...');
  try {
    const { ra, dec } = S.search, r = await api(searchUrl(ra, dec) + '&fresh=1');
    if (!S.search || S.search.ra !== ra) return;   // another spot was opened meanwhile
    const have = new Set(S.images.map(im => im.url)), nw = r.images.filter(im => !have.has(im.url)), gone = S.images.length - (r.images.length - nw.length);
    S.relCheck = { at: Date.now(), stale: !!r.stale, count: r.count, new: nw.length, gone };
    if (r.stale) { relRender('IRSA did not answer just now; nothing changed. Try again later.'); return; }
    // v0.57.3: the server asks IRSA at most once a minute per spot; inside that minute a test field answers with its kept
    // list, which is not "IRSA lists the same images" (review finding)
    if (r.frozen && !r.frozenKept) { relRender('IRSA was asked for this spot less than a minute ago. Try again in a minute.'); return; }
    S.search.checkedAt = r.checkedAt || new Date().toISOString();
    if (!nw.length) { relRender(`Up to date: IRSA lists the same ${r.count} images.` + (gone > 0 ? ` (${gone} no longer listed.)` : '')); return; }
    const rels = [...new Set(nw.map(releaseOf).filter(Boolean))].join(', ') || 'a release', newest = fmtDay(Math.max(...nw.map(i => i.mjd)));
    // v0.56.3: on a frozen spot the new list replaces the old one only when asked (its images are not saved yet: slower)
    const frozen = !!r.frozenKept, swap = frozen ? ` IRSA now lists ${r.count} images; ${gone > 0 ? `${gone} of the ${S.images.length} shown here are no longer listed (replaced by the new release). ` : ''}Switching downloads them, so it is slower the first time.` : '';
    relRender([`${nw.length} new image${nw.length === 1 ? '' : 's'} at IRSA (${rels}, newest ${newest}).${swap} `,
      h('button', { type: 'button', class: 'hbtn', onclick: () => { if (frozen) S.latest.add(spotKey(S.field.ra, S.field.dec)); runAgents({ ra: S.field.ra, dec: S.field.dec }); } }, frozen ? 'Switch this spot to the new list' : 'Run the agents again with them')]);
  } catch (e) { relRender('Could not ask IRSA: ' + e.message); }
  finally { if (b) b.disabled = false; }
}
if ($('relchk')) $('relchk').onclick = () => relCheck();
const dropTxt = () => !S.dropped ? '' : ` · ${S.dropped.map(d => `the ${fmtMonth(d.t0)} pass`).join(' and ')} left out: only ${S.dropped.map(d => d.n).join(' and ')} SPHEREx image${S.dropped.length === 1 && S.dropped[0].n === 1 ? '' : 's'} cover${S.dropped.length === 1 && S.dropped[0].n === 1 ? 's' : ''} this spot there, too few to match colours, so the other passes get more images`;
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
// v0.17.1: new images are read straight from NASA's open-data copy of SPHEREx on AWS S3 (lib/s3cut.js): only the rows of
// the field, a few seconds each, instead of 25-45 s from IRSA's cutout service. Pixel for pixel the same as IRSA's cutouts
// (checked live). Done here in the page: on the user's PC the browser reached S3 fine while the Node server's requests hung.
// The server still answers first when it has the image (examples, spots opened before), keeps what the page read (local
// runs), and remains the fallback (IRSA) when S3 fails.
const S3B = { active: 0, waiting: [], max: 8, fails: 0, off: false, n: 0, hint: null, ok: 0,
  hosts: ['https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/', 'https://nasa-irsa-spherex.s3.amazonaws.com/'] };   // two names: twice the browser's 6 connections per host
async function s3Get(url, a, b, alt) {
  for (let k = 0; ; k++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 60000);
    try {
      // no-store: a cached partial answer can come back without its CORS header and fail (seen in Chromium)
      // v0.22.1: the retry goes to the other S3 address; a whole-file 200 answer to a range request is refused (seen once
      // live as "FLAGS size differs": the bytes were not the ones asked for)
      const r = await fetch(k && alt ? alt : url, { cache: 'no-store', headers: { Range: `bytes=${a}-${b}` }, signal: ctl.signal });
      if (r.status !== 206 && !(r.status === 200 && a === 0)) { try { r.body && r.body.cancel(); } catch { /* ignore */ } const e = new Error('S3 HTTP ' + r.status); e.status = r.status; throw e; }
      const cr = r.headers.get('content-range');
      let buf = new Uint8Array(await r.arrayBuffer()); if (buf.length > b - a + 1) buf = buf.subarray(0, b - a + 1);
      return { buf, total: cr && /\/(\d+)$/.test(cr) ? +cr.split('/')[1] : null };
    } catch (e) { if (k >= 2 || e.status === 403 || e.status === 404 || e.status === 416) throw e; await sleep(400 * (k + 1)); }   // 416: a read-ahead past the end of a smaller file (expected, never retried)
    finally { clearTimeout(t); }
  }
}
// v0.52: where the FITS headers sit in a file (the layout "hint") is the same for every file of one pipeline version
// (l2b-v24 = QR2, l2b-v27 = QR3). It used to be learned from the first file of each visit, so the preview's first images
// walked their ~7 headers one request at a time (about 1 s each from India to S3). It is now kept per version in this
// browser, so even the first image asks for all its headers at once. A wrong or old hint only costs the walk it replaces.
const S3HINT = { key: 'arcnave.s3hint.v1', all: null };
const s3Ver = u => (String(u).match(/l2b-v\d+/) || ['any'])[0];
function s3HintGet(u) {
  if (!S3HINT.all) { S3HINT.all = {}; try { S3HINT.all = JSON.parse(localStorage.getItem(S3HINT.key) || '{}') || {}; } catch { /* private window */ } }
  const h = S3HINT.all[s3Ver(u)]; if (!h || !Array.isArray(h.o)) return S3B.hint;
  const offs = h.o.filter(o => Number.isFinite(o)); offs.minTotal = +h.m || 0; return offs;
}
function s3HintSet(u, offs) {
  if (!offs || !offs.length) return; S3B.hint = offs;
  try { S3HINT.all = S3HINT.all || {}; S3HINT.all[s3Ver(u)] = { o: [...offs], m: offs.minTotal || 0 }; localStorage.setItem(S3HINT.key, JSON.stringify(S3HINT.all)); } catch { /* not kept */ }
}
async function loadViaS3(im, fld) {
  if (S3B.off || !window.S3Cut) return null;
  const u = S3Cut.s3Url(im.url); if (!u) return null;
  const url = S3B.hosts[S3B.n++ % S3B.hosts.length] + u.slice(S3B.hosts[0].length);
  while (S3B.active >= S3B.max) await new Promise(r => S3B.waiting.push(r));
  S3B.active++;
  try {
    const c = await S3Cut.cutout((a, b) => s3Get(url, a, b, S3B.hosts[0] + u.slice(S3B.hosts[0].length)), +(+fld.ra).toFixed(5), +(+fld.dec).toFixed(5), +(+fld.size).toFixed(4), s3HintGet(u), { zodiRows: 9 });   // v0.56: ZODI from 9 rows, a third fewer bytes (lib/s3cut.js)
    s3HintSet(u, c.offsets); S3B.fails = 0; S3B.ok++;
    return c.fits;
  } catch (e) {
    if (e.status !== 404) { S3B.fails++; if (S3B.fails >= 4) S3B.off = true; }   // S3 unreachable from here: stop trying, IRSA only
    console.warn('S3 read failed, using IRSA:', e.message);
    return null;
  } finally { S3B.active--; S3B.waiting.shift()?.(); }
}
async function loadFrame(im) {
  const fld = S.field;
  const net = netStart();   // the wait indicator only speaks up when the archive (not this page) is slow
  const qs = `url=${encodeURIComponent(im.url)}&ra=${fld.ra}&dec=${fld.dec}&size=${fld.size}`;
  let r, buf;
  try {
    r = await fetch(`/api/spherex/cutout?${qs}&cached=1`);
    if (S.field !== fld) throw new Error('cancelled');
    if (r.status === 204) {
      S.netLoads = (S.netLoads || 0) + 1;   // v0.56: not in the cache: this field is new (runAgents then reports early)
      const f = r.headers.get('X-Arcnave-Server-S3') === '1' ? null : await loadViaS3(im, fld);   // server reads S3 itself on a public host
      if (S.field !== fld) throw new Error('cancelled');
      if (f) {
        buf = f.buffer.slice(f.byteOffset, f.byteOffset + f.length);
        if (r.headers.get('X-Arcnave-Put') !== '0') fetch(`/api/spherex/cutout?${qs}`, { method: 'POST', body: f }).catch(() => { /* not kept: only costs speed next time */ });   // a public host refuses uploads: do not send 7 MB per image for nothing
      } else r = await fetch(`/api/spherex/cutout?${qs}`);
    }
    if (!buf) {
      if (S.field !== fld) throw new Error('cancelled');
      if (!r.ok) { let m = 'cutout failed (HTTP ' + r.status + ')'; try { m = (await r.json()).error; } catch { /* keep */ } throw new Error(m); }
      buf = await r.arrayBuffer();
    }
  } finally { netEnd(net); }
  if (S.field !== fld) throw new Error('cancelled');
  const pc = await prepOffThread(buf, fld);
  if (S.field !== fld) throw new Error('cancelled');
  const f = buildFrame(buf, im, fld, pc);
  // v0.57.8: building, lining up and listing an image were one block of 0.1-0.3 s per image (250 images: a stutter all
  // through loading); now with a pause between the steps. An image other than the reference is lined up before it is
  // listed, so nothing ever sees it half done; the reference is listed first, as before, since everything lines up on it.
  const isRef = im.url === chosen(0).url;
  await yieldNow(); if (S.field !== fld) throw new Error('cancelled');
  if (!isRef && refFrame()) { alignFrame(f); await yieldNow(); if (S.field !== fld) throw new Error('cancelled'); }
  S.frames.set(im.url, f);
  while (S.frames.size > 110) S.frames.delete(S.frames.keys().next().value);
  if (im.url === chosen(0).url) {   // new reference: re-register everything on it (v0.57.8: with short pauses, same result)
    for (const o of [...S.frames.values()]) { if (S.field !== fld) throw new Error('cancelled'); alignFrame(o); await breathe(); }
    alignFrame(f);
  } else alignFrame(f);   // already lined up above: returns at once (same reference); or lines it up now
  renderStrip();
  return f;
}
// v0.14: the heavy per-image work (about 0.4 s each) runs in a small pool of Web Workers, several images at once, and the
// page stays responsive. Falls back to the main thread if workers are unavailable (same function, same numbers).
const PREP = { pool: null, next: 0, id: 0, wait: new Map(), off: false };
function prepPool() {
  if (PREP.pool || PREP.off) return PREP.pool;
  try {
    const k = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));   // v0.14.3: up to 6 (8-core laptops)
    PREP.pool = Array.from({ length: k }, () => {
      const w = new Worker('/prep-worker.js');
      w.onmessage = e => { const r = PREP.wait.get(e.data.id); if (!r) return; PREP.wait.delete(e.data.id); e.data.error ? r.no(new Error(e.data.error)) : r.ok(e.data.out); };
      w.onerror = () => { PREP.off = true; PREP.pool = null; for (const r of PREP.wait.values()) r.retry(); PREP.wait.clear(); };
      return w;
    });
  } catch { PREP.off = true; }
  return PREP.pool;
}
function prepOffThread(buf, fld) {
  const grid = { ra0: fld.ra, dec0: fld.dec, s: fld.s, n: fld.n }, main = () => F.prepareCutout(buf, grid);
  const pool = prepPool(); if (!pool) return Promise.resolve().then(main);
  return new Promise((ok, no) => {
    const id = ++PREP.id; PREP.wait.set(id, { ok, no, retry: () => { try { ok(main()); } catch (e) { no(e); } } });
    pool[PREP.next++ % pool.length].postMessage({ id, buf: buf.slice(0), grid });   // a copy: the main thread still reads the WCS-WAVE table from buf
  });
}
// v0.52: any other lib/fits.js job for the same pool (kind 'chg' = changeMaps). main() is the same call on this thread, used
// when workers are unavailable. The arrays are copied to the worker, so the page keeps its own.
function workerJob(kind, data, main) {
  const pool = prepPool(); if (!pool) return Promise.resolve().then(main);
  return new Promise((ok, no) => {
    const id = ++PREP.id; PREP.wait.set(id, { ok, no, retry: () => { try { ok(main()); } catch (e) { no(e); } } });
    pool[PREP.next++ % pool.length].postMessage({ id, kind, ...data });
  });
}
function buildFrame(buf, im, fld, pcIn) {
  // Shared with the tests (lib/fits.js prepareCutout): ZODI removed, FLAGS bad pixels masked (unmasked, single glitch pixels look
  // like very bright stars and fake "changes"; seen on the first live run), reprojected onto the field grid, background flattened.
  const grid = { ra0: fld.ra, dec0: fld.dec, s: fld.s, n: fld.n };
  const pc = pcIn || F.prepareCutout(buf, grid), g = pc.flat, st = pc.st, touched = pc.touched, mask = pc.mask, hd = pc.hdus, hi = { header: pc.header };
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
  f.rawFlags = rawFlagsOf(buf);   // v0.57.3: the pipeline's own FLAGS of this cutout (~0.4 MB), for a candidate's flag check
  paint(f);
  return f;
}
// Shown as measured: OUTLIER-only pixels (the pipeline also flags moving asteroids with it) at their real values.
const seeOf = f => f.flatKeep || f.flat;
function paint(f) { const n = S.field.n; f.pv = (f.pv || 0) + 1; f.canvas.getContext('2d').putImageData(new ImageData(F.renderRGBA(seeOf(f), f.st, f.rgb, S.view), n, n), 0, 0); }
// v0.57.2: WiseView-style display controls (picture only: no measurement uses them). Contrast lifts faint things; Invert
// draws dark stars on a light sky, the view many volunteers find easiest for spotting a faint moving dot.
S.view = { gain: 1, invert: false };
function setView(v) {
  Object.assign(S.view, v);
  if ($('ctro')) $('ctro').textContent = S.view.gain === 1 ? 'normal' : S.view.gain > 1 ? `×${S.view.gain.toFixed(1)} faint` : `×${S.view.gain.toFixed(2)}`;
  if ($('invb')) $('invb').setAttribute('aria-pressed', String(S.view.invert));
  // v0.57.9: the image on screen and the stacks are repainted at once; the other images one at a time with pauses (all of
  // them at once took 0.3 s per slider step on a laptop, so dragging Contrast stuttered). The thumbnails follow.
  if (S.field) {
    const now = new Set([S.shownFr, ...[...S.stacks.values()].map(c => c.f)].filter(Boolean));
    for (const f of now) try { paint(f); } catch { /* frame not ready */ }
    const run = ++VIEWP.n, rest = [...S.frames.values()].filter(f => !now.has(f));
    (async () => { for (const f of rest) { if (run !== VIEWP.n) return; try { paint(f); } catch { /* frame not ready */ } await breathe(); } if (run === VIEWP.n) renderStrip(); })();
  }
  try { refresh(); } catch { refreshSoon(); }
}
const VIEWP = { n: 0, raf: 0, gain: null };
if ($('ctr')) $('ctr').oninput = e => {   // v0.57.9: one repaint per screen frame however fast the slider moves
  VIEWP.gain = +(2 ** +e.target.value).toFixed(3);
  if (!VIEWP.raf) VIEWP.raf = requestAnimationFrame(() => { VIEWP.raf = 0; setView({ gain: VIEWP.gain }); });
};
if ($('invb')) $('invb').onclick = () => setView({ invert: !S.view.invert });

// Aligner's core: epoch 1's frame is the reference; every other frame is registered onto it by matching stars (median
// offset of matched bright stars), with cross-correlation as a fallback. On real SPHEREx data the star method found a
// 0.03 px offset from 72 stars, while cross-correlation (fooled by one-pixel-wide stars and colour differences) said 0.2 px.
function alignFrame(f) {
  const n = S.field.n, ref = refFrame();
  // v0.15: already registered on this same reference: nothing would change (the final pass used to redo all 24, ~4 s)
  if (f.shift && f.alignedTo === ref && f.alignedSrc === (ref && ref.flat0)) return;
  f.alignedTo = ref; f.alignedSrc = ref && ref.flat0;
  if (!ref || ref === f) { f.shift = { ok: true, ref: true, dx: 0, dy: 0, method: 'reference' }; f.flatKeep = f.keep0; f.touchedHard = f.hard0; setFlat(f, f.flat0, f.touched0); S.ref = f; return; }
  if (!ref.starRef || ref.starRef.src !== ref.flat0) ref.starRef = { src: ref.flat0, ...F.refPeaks(ref.flat0, n) };   // the reference's stars, found once
  const st = F.alignByStars(ref.flat0, f.flat0, n, { ref: ref.starRef }), sh = st.ok ? st : Object.assign(F.estimateShift(ref.flat0, f.flat0, n, 6), { method: 'correlation' });
  f.shift = sh;
  const apply = sh.ok && Math.hypot(sh.dx, sh.dy) > 0.05 && Math.hypot(sh.dx, sh.dy) < 4;
  const mv = a => a && apply ? F.shiftImage(a, n, sh.dx, sh.dy) : a;
  f.flatKeep = mv(f.keep0); f.touchedHard = mv(f.hard0);
  setFlat(f, mv(f.flat0), mv(f.touched0));
}
function setFlat(f, flat, touched) { f.fv = (f.fv || 0) + 1; f.flat = flat; f.touched = touched; paint(f); S.diff = null; S.alignVer++; f.thumb = null; }
const shiftText = sh => !sh ? '?' : sh.method === 'reference' ? 'reference frame' : sh.method === 'stars' ? `${sh.nMatch} stars matched, scatter ${sh.spread.toFixed(2)} px` : `match quality ${(sh.ncc ?? 0).toFixed(2)}`;

/* ---------- known movers (SkyBoT) ---------- */
// pre: asked early, while images download (v0.17). A failed early lookup only counts as "check not possible" once the
// Analyst actually needs that image (S.need), so the offline examples do not warn about images nobody looked at.
function ensureMovers(i, pre) {
  const im = chosen(i), fld = S.field, key = i + ':' + im.url;
  if (!pre) (S.need || (S.need = new Set())).add(key);
  if (S.mvp.has(key)) return S.mvp.get(key);
  S.movers.set(key, { items: [], loading: true });
  const p = api(`/api/movers?ra=${fld.ra.toFixed(5)}&dec=${fld.dec.toFixed(5)}&radius=${(fld.size * 0.75).toFixed(3)}&mjd=${im.mjd.toFixed(4)}`)
    .then(r => { if (S.field === fld) S.movers.set(key, { items: r.items, mjd: im.mjd, src: r.source }); })
    .catch(e => { if (S.field === fld) { S.movers.set(key, { items: [], err: e.message }); if (!pre && (!toast.sky || Date.now() - toast.sky > 30000)) { toast.sky = Date.now(); toast('Known movers unavailable: ' + e.message, 6000); } } });
  S.mvp.set(key, p); return p;
}
// v0.16.0: who named the known objects: IMCCE SkyBoT, or (SkyBoT unreachable) the Minor Planet Center's checker.
const viaMpc = () => [...S.movers.values()].some(m => m && m.src === 'MPC');
const KS = () => viaMpc() ? 'the Minor Planet Center' : 'SkyBoT';
const MPC_NOTE = 'SkyBoT could not be reached, so the Minor Planet Center checker named these objects (same orbit catalogue; positions printed to about 2″, no orbit class or distance).';
const moversOf = i => S.eps[i] ? S.movers.get(i + ':' + chosen(i).url) : null;
// SkyBoT for one image's exact time (used for the images of an epoch beyond slot 0).
function ensureMoversIm(im, pre) {
  const fld = S.field, key = 'im:' + im.url;
  if (!pre) (S.need || (S.need = new Set())).add(key);
  if (S.mvp.has(key)) return S.mvp.get(key);
  const p = api(`/api/movers?ra=${fld.ra.toFixed(5)}&dec=${fld.dec.toFixed(5)}&radius=${(fld.size * 0.75).toFixed(3)}&mjd=${im.mjd.toFixed(4)}`)
    .then(r => { if (S.field === fld) S.movers.set(key, { items: r.items, mjd: im.mjd, src: r.source }); })
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
  const list = multi() && S.seq.length ? S.seq.filter(x => !x.extra) : S.eps.map((ep, e) => ({ e, im: chosen(e), i: e, pos: 1, n: 1 }));
  return list.map(x => ({ x, fr: S.frames.get(x.im.url) })).filter(o => o.fr);
}
// v0.31: the "at least 25 % of its own light" rule for a star that got brighter is checked on a 5x5 box (relBox 2), not
// only on the 3x3 box. The brightness test (#brighttest) on the demo field: with 3x3 alone, 6 of 40 unchanged stars, nearly
// all of the brightest, were reported brighter (a bright star's image changes shape a little from image to image, which moves
// light between the 3x3 box and its wings); with 5x5, 1 of 40. Real brightening is caught as before (gain 1.5: 30 of 40).
const REL_BOX = 2;
function changeData() {
  if (!S.field || S.eps.length < 2) return null;
  if (!S.report && Object.keys(S.ag).length) return null;   // agents still running: build it once, after the report (it takes a second or two)
  const items = changeItems(), stacks = S.eps.map((_, e) => frameOf(e));
  if (items.length < 2 || stacks.some(f => !f)) return null;
  const key = items.map(o => o.x.im.url + '@' + (o.fr.fv || 0)).join(',') + '|' + S.eps.map((_, e) => multi() ? stackKey(e).key : ((rawOf(e) || {}).fv || 0)).join(';') + '|' + stacks.length;   // v0.57.9: its own images' versions, not S.alignVer
  if (S.chg && S.chg.key === key) return S.chg;
  if (CHGJOB.key === key) return null;   // being built in a worker
  // v0.52: changeMaps (~2 s on a 24-image field) runs in the worker pool, so the report and the sky never freeze. Until it is
  // back the sky shows the plain image and the panel says it is comparing; then this same key is finished below and drawn.
  const n = S.field.n, t0 = performance.now(), fld = S.field;
  const args = [stacks.map(f => ({ flat: f.flat, st: f.st })), items.map(o => ({ flat: o.fr.flat, keep: o.fr.flatKeep, st: o.fr.st, mjd: o.x.im.mjd, slot: multi() ? o.x.k : null })), n, { nsig: 8, relBox: REL_BOX }];
  CHGJOB.key = key;
  workerJob('chg', { stacks: args[0], frames: args[1], n, opts: args[3] }, () => F.changeMaps(...args))
    .catch(() => F.changeMaps(...args))
    .then(r => { if (CHGJOB.key !== key) return; CHGJOB.key = null; if (S.field !== fld) return; changeDone(key, items, r, n, t0); refreshSoon(); })
    .catch(e => { if (CHGJOB.key === key) CHGJOB.key = null; stat('Changes view failed: ' + e.message, true); });
  renderChgPanel();
  return null;
}
const CHGJOB = { key: null };
function changeDone(key, items, r, n, t0) {
  const mk = rgba => { const cv = document.createElement('canvas'); cv.width = cv.height = n; cv.getContext('2d').putImageData(new ImageData(rgba, n, n), 0, 0); return cv; };
  const grid = { ra0: S.field.ra, dec0: S.field.dec, s: S.field.s, n };
  // a known asteroid caught inside an epoch explains its dots
  const ast = []; if (S.inside) for (const a of S.inside.asteroids) for (const sg of a.sightings) ast.push({ a, sg });
  for (const pk of r.peaks) {
    const sky = F.gridToSky(pk.x, pk.y, grid); pk.ra = sky[0]; pk.dec = sky[1]; pk.item = items[pk.k].x;
    const m = ast.find(o => o.sg.im.url === pk.item.im.url && Math.hypot(o.sg.x - pk.x, o.sg.y - pk.y) <= 2);
    pk.known = m ? m.a : knownOnTrack(pk);
    // v0.38: 'lone' = brighter in an exposure that has no partner minutes later, so the repeat test (real object or cosmic ray?)
    // cannot be made. Seen on Epsilon Indi B's field: 204 of 264 'not explained' spots were such, 157 of them in 3 lone exposures.
    pk.kind = pk.known ? 'known' : pk.repeat === false ? 'single' : pk.sharp ? 'sharp' : pk.onStar ? 'star' : pk.repeat === null ? 'lone' : 'other';
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
/* ---------- Changes, explained (v0.22): the default Changes view, for people who are not astronomers ---------- */
// The colour maps (By epoch, By image) show everything at once, which experts read and others do not. "Explained" sorts every
// spot that changed into four plain kinds, each with an icon on the sky and a sentence: a known asteroid passing by (with its
// track), a star that got brighter, something unexplained, and detector glitches (hidden by default, only counted). Tap a
// kind to step through its spots one by one; each spot's card flips between "this image" and "the usual sky" there.
const CHG_KINDS = [
  { id: 'known', icon: '☄', col: '#5ff0a0', name: 'Known asteroid passing by', next: 'Next asteroid', one: 'known asteroid', many: 'known asteroids',
    say: 'A rock from the asteroid belt, caught moving. Where SPHEREx saw it matches its known orbit.' },
  { id: 'star', icon: '✦', col: '#ffd666', name: 'A star got brighter', next: 'Next brighter star', one: 'star got brighter', many: 'stars got brighter',
    say: 'This star gave more light in one image than usual. Some stars pulse; it can also be an image effect.' },
  { id: 'other', icon: '?', col: '#b9a5ff', name: 'Not explained yet', next: 'Next unexplained spot', one: 'spot we cannot explain', many: 'spots we cannot explain',
    say: 'Brighter in one image, no known cause. A faint mover or an artefact. Not a discovery claim.' },
  { id: 'lone', icon: '·', col: '#8e9bc0', name: 'Seen once, cannot check', next: 'Next unchecked spot', one: 'spot seen in one exposure only', many: 'spots seen in one exposure only',
    say: 'Brighter in an exposure that had no second exposure minutes later, so a real object and a cosmic-ray hit look the same. Hidden on the sky, counted.' },
  { id: 'glitch', icon: '×', col: '#8e98ae', name: 'Detector glitches', next: 'Next glitch', one: 'detector glitch', many: 'detector glitches',
    say: 'Cosmic-ray hits and hot pixels: sharper than any star, or gone in the exposure taken minutes later. Hidden on the sky.' },
];
const chgKind = pk => pk.kind === 'single' || pk.kind === 'sharp' ? 'glitch' : pk.kind;
const CHGW = { show: null, step: {} };   // show: the kind picked in the panel (null = all but glitches)
function chgByKind(d) { const m = { known: [], star: [], other: [], lone: [], glitch: [] }; for (const pk of d.r.peaks) m[chgKind(pk)].push(pk); return m; }
function renderChgStory(d, L) {
  const by = chgByKind(d), n = d.r.peaks.length, it = d.items, span = (it[it.length - 1].x.im.mjd - it[0].x.im.mjd) * 24;
  const ast = new Set(by.known.map(pk => pk.known && pk.known.name)); ast.delete(undefined); ast.delete(null);
  const part = (k, v) => v ? `${v} ${v === 1 ? k.one : k.many}` : null;
  const bits = [part(CHG_KINDS[0], ast.size), part(CHG_KINDS[1], by.star.length), part(CHG_KINDS[2], by.other.length), part(CHG_KINDS[3], by.lone.length)].filter(Boolean);
  L.append(h('p', { class: 'chgsum' }, n ? `In ${it.length} SPHEREx images taken over ${fmtDur(span)}, ${n} spot${n === 1 ? '' : 's'} changed. ` +
    `${by.glitch.length ? `${by.glitch.length} ${by.glitch.length === 1 ? 'was a detector glitch' : 'were detector glitches'}` : 'None were detector glitches'}${bits.length ? '; the rest: ' + bits.join(', ') : ''}.` : 'Nothing changed above the threshold in these images: the sky here stayed the same.'));
  const bar = h('div', { class: 'chgbar', 'aria-hidden': 'true' });
  for (const k of CHG_KINDS) { const v = by[k.id].length; if (v) bar.append(h('i', { style: `flex:${v} 1 0;background:${k.col}`, title: `${k.name}: ${v}` })); }
  if (n) L.append(bar);
  const row = h('div', { class: 'chgks' });
  for (const k of CHG_KINDS) {
    const list = by[k.id], v = k.id === 'known' ? ast.size : list.length, on = CHGW.show === k.id;
    const kn0 = k.id === 'known' && !list.length && [...S.movers.values()].some(m => m && (m.items || m.err));   // v0.42: 0 caught still opens, and says why
    row.append(h('button', { class: 'chgk' + (on ? ' on' : ''), 'aria-pressed': String(on), ...(list.length || kn0 ? {} : { disabled: '' }), style: `--kc:${k.col}`,
      onclick: () => chgStep(k.id) },
      h('b', { class: 'ki', 'aria-hidden': 'true' }, k.icon), h('span', { class: 'kt' }, h('strong', {}, `${v} `), k.name,
        on && list.length > 1 ? h('em', {}, ` · ${(CHGW.step[k.id] || 0) + 1} of ${list.length} ›`) : ''),
      ...(on || !CHGW.show ? [h('small', {}, kn0 ? knownWhy(false) : on ? k.say : k.say.split('. ')[0] + '.')] : [])));   // short line for each; the full one for the kind you picked
  }
  L.append(row);
  // v0.41: watch the movers move. Known asteroids found in the changes (within their pass), and the challenge target when it
  // moves across passes. Unknown dots are not offered: they are never joined into tracks.
  const movers = [...new Set(by.known.map(pk => pk.known).filter(Boolean))].slice(0, 4), ctT = S.ct && CHALLENGE[S.ct] && CHALLENGE[S.ct].pmra && S.eps.length > 1 ? CHALLENGE[S.ct] : null, ctId = S.ct;
  const nKnown = new Set(knownPaths().filter(p => p.inField).map(p => p.id + '|' + p.e)).size;
  if (movers.length || ctT || nKnown || S.eps.length > 1) L.append(h('div', { class: 'chgmov' }, h('b', {}, 'Watch it move'),
    h('button', { class: 'hbtn', onclick: () => movieStart() }, '🎬 Animate the movers'),   // v0.50
    h('button', { onclick: () => motionSearch() }, MS.res && MS.res.run === S.run ? `🔍 Moving stars (${MS.res.flagged.length})` : '🔍 Find moving stars'),   // v0.45
    h('button', { onclick: () => DS.res && DS.res.run === S.run ? showDS() : deepSearch() }, DS.res && DS.res.run === S.run ? `🔭 Deep search (${DS.res.flagged.length})` : '🔭 Deep search: every image'),   // v0.47
    h('button', { onclick: () => DF.res && DF.res.run === S.run ? showDiff() : diffSearch() }, DF.res && DF.res.run === S.run ? `◐ Slow movers (${DF.res.flagged.length})` : '◐ Slow movers: difference images'),   // v0.48
    h('button', { onclick: () => TSC.res && TSC.res.run === S.run ? showScan() : motionScan() }, TSC.res && TSC.res.run === S.run ? `🎯 Motion scan (${TSC.res.flagged.length})` : '🎯 Motion scan: faint stars'),   // v0.49
    ...movers.map(a => h('button', { onclick: () => replayAsteroid(a) }, '☄ ' + a.name + ' · its track')),
    ...(nKnown ? [h('button', { onclick: () => { CHGW.show = 'known'; renderChgPanel(); showKnownPaths(); if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card'); } }, `☄ All known paths (${nKnown})`)] : []),
    ...(ctT ? [h('button', { onclick: () => replayAcross(ctT, ctT.name, () => showChallenge(ctId)) }, '✦ ' + ctT.name + ' · across passes')] : [])));
  if (CHGW.show) L.append(h('button', { class: 'chgall', onclick: () => { CHGW.show = null; S.sel = null; renderChgPanel(); showReport(); } }, 'Show all kinds again'));
}
// Tap a kind: show only that kind on the sky and step through its spots (the next one on each tap), opening each card.
function chgStep(kind) {
  const d = S.chg; if (!d) return;
  const list = chgByKind(d)[kind];
  if (!list.length) {   // v0.42: no known asteroid caught: Known still opens, with why and where the known ones went
    if (kind === 'known') { CHGW.show = CHGW.show === 'known' ? null : 'known'; renderChgPanel(); if (CHGW.show) { showKnownPaths(); if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card'); } else showReport(); }
    return;
  }
  const sorted = list.slice().sort((p, q) => q.snr - p.snr);
  if (CHGW.show === kind) CHGW.step[kind] = ((CHGW.step[kind] || 0) + 1) % sorted.length; else { CHGW.show = kind; CHGW.step[kind] = 0; }
  const pk = sorted[CHGW.step[kind]];
  if (kind === 'known' && pk.known) { S.al.gotoRaDec(pk.ra, pk.dec); S.al.setFov(0.25); renderChgPanel(); showAsteroid(pk.known); if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card'); return; }
  S.al.gotoRaDec(pk.ra, pk.dec); S.al.setFov(0.15); renderChgPanel(); showChange(pk);
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
// On the sky: the latest pass dimmed, and an icon per change; known asteroids get their track with an arrow.
function drawChgStory(T) {
  const d = S.chg; if (!d) return;
  const k = CHGW.show, kinds = Object.fromEntries(CHG_KINDS.map(x => [x.id, x]));
  const want = pk => k ? chgKind(pk) === k : chgKind(pk) !== 'glitch' && chgKind(pk) !== 'lone';   // hidden unless picked: glitches, and spots that cannot be checked
  const fov = S.al.getFov()[0];
  // asteroid tracks first (under the icons)
  if (!k || k === 'known') {
    drawKnownPaths(k === 'known');   // v0.42: every known object's path per pass (bright ones always; all of them when Known is picked)
    const tracks = new Map();
    for (const pk of d.r.peaks) if (chgKind(pk) === 'known' && pk.known) { const a = tracks.get(pk.known) || []; a.push(pk); tracks.set(pk.known, a); }
    for (const [a, pks] of tracks) {
      const pts = pks.slice().sort((p, q) => p.item.im.mjd - q.item.im.mjd).map(pk => proj(pk.ra, pk.dec)).filter(Boolean);
      if (pts.length >= 2) {
        const [p0, p1] = [pts[0], pts[pts.length - 1]], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ux = (p1[0] - p0[0]) / (L || 1), uy = (p1[1] - p0[1]) / (L || 1);
        const q0 = [p0[0] - ux * 28, p0[1] - uy * 28], q1 = [p1[0] + ux * 34, p1[1] + uy * 34];   // longer than the hop, so the direction reads
        ctx.strokeStyle = 'rgba(95,240,160,.85)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#5ff0a0'; ctx.beginPath(); ctx.moveTo(q1[0] + ux * 8, q1[1] + uy * 8); ctx.lineTo(q1[0] - uy * 6, q1[1] + ux * 6); ctx.lineTo(q1[0] + uy * 6, q1[1] - ux * 6); ctx.fill();
      }
      const p = pts[pts.length - 1]; if (p && fov < 1.2) { ctx.font = '650 12px Archivo,sans-serif'; ctx.fillStyle = '#5ff0a0'; ctx.fillText(`${a.name} · moving`, p[0] + 18, p[1] + 22); }
    }
  }
  const sel = S.sel && S.sel.chg;
  for (const pk of d.r.peaks) {
    if (!want(pk) && pk !== sel) continue;
    const p = proj(pk.ra, pk.dec); if (!p) continue;
    const kd = kinds[chgKind(pk)], small = kd.id === 'glitch' || kd.id === 'lone', r = small ? 6 : 11, on = pk === sel;
    ctx.fillStyle = 'rgba(5,7,15,.75)'; ctx.beginPath(); ctx.arc(p[0], p[1], r + 2, 0, 7); ctx.fill();
    ctx.strokeStyle = kd.col; ctx.lineWidth = on ? 3 : 1.6; ctx.beginPath(); ctx.arc(p[0], p[1], on ? r + 5 : r, 0, 7); ctx.stroke();
    ctx.fillStyle = kd.col; ctx.font = `700 ${small ? 10 : 13}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(kd.icon, p[0], p[1] + 0.5); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    S.hits.push({ x: p[0], y: p[1], chg: pk });
  }
}
// Card picture: the spot in the image where it changed, flipping with the usual sky there (the median of its sky pass).
function chgFlip(pk) {
  const d = S.chg, x = pk.item, fr = S.frames.get(x.im.url), base = frameOf(x.e); if (!fr || !base) return null;
  const cv = h('canvas', { width: 168, height: 168, class: 'chgflip', role: 'img', 'aria-label': 'The changed spot: this image, then the usual sky there, one after the other' });
  const lab = h('span', { class: 'chgfl' }), wrap = h('div', { class: 'chgfw' }, cv, lab);
  const g = cv.getContext('2d'), R = 14; let k = 0;
  const draw = () => {
    if (!cv.isConnected && k > 0) { clearInterval(t); return; }
    const src = k % 2 ? base.canvas : fr.canvas; g.imageSmoothingEnabled = false; g.fillStyle = '#000'; g.fillRect(0, 0, 168, 168);
    g.drawImage(src, pk.x - R, pk.y - R, 2 * R + 1, 2 * R + 1, 0, 0, 168, 168);
    g.strokeStyle = CHG_KINDS.find(c => c.id === chgKind(pk)).col; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); g.arc(84, 84, 22, 0, 7); g.stroke(); g.setLineDash([]);
    lab.textContent = k % 2 ? `The usual sky here (median of epoch ${x.e + 1})` : `This image · ${fmtDay(x.im.mjd)} ${mjdDate(x.im.mjd).toISOString().slice(11, 16)} UTC`;
    k++;
  };
  draw(); const t = setInterval(draw, reduce ? 1800 : 900);
  return wrap;
}
const chgCss = c => `rgb(${c.map(v => Math.round(v)).join(',')})`;
function renderChgPanel() {
  const box = $('chg'); if (!box) return;
  box.hidden = S.mode !== 'change' || S.lab;
  document.querySelectorAll('[data-cv]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cv === S.cv));
  const L = $('chgl'), T = $('chgt'); L.replaceChildren(); T.replaceChildren();
  if (box.hidden) return;
  const d = S.chg && S.chg.key ? S.chg : null;
  if (!d) { L.append(CHGJOB.key ? 'Comparing every image with the others to find what changed…' : 'Run the agents on a field with at least two epochs to see what changed.'); return; }
  if (S.cv === 'st') renderChgStory(d, L);
  else if (S.cv === 'ep') {
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
      'aria-label': `${o.x.pos === 1 ? 'E' + (o.x.e + 1) + ': ' : ''}epoch ${o.x.e + 1}, image ${k + 1}: ${nAll} changes`, onclick: () => { if (multi()) { S.ti = o.x.i; } else S.ei = o.x.e; S.sel = null; setMode('time'); } },
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
    star: ['unc', 'A star brighter in this image: maybe a variable star'], other: ['unc', 'Unexplained: unconfirmed'], lone: ['unc', 'Seen in one exposure only: cannot be checked'] }[pk.kind] || ['unc', 'Unconfirmed'];
  const kd = CHG_KINDS.find(k => k.id === chgKind(pk)), flip = chgFlip(pk);
  c.append(h('h3', {}, `${kd.icon} ${kd.name}`), h('span', { class: 'badge ' + kindTxt[0] }, kindTxt[1]), ...(flip ? [flip] : []),
    h('p', {}, h('b', {}, 'Brightest in: '), `image ${pk.k + 1} of ${d.items.length} (epoch ${x.e + 1}, ${fmtDay(x.im.mjd)} ${mjdDate(x.im.mjd).toISOString().slice(11, 16)} UTC, ${lamOf(x.im).toFixed(2)} µm)`),
    h('p', {}, h('b', {}, 'How much: '), `${pk.snr.toFixed(0)}σ above the median of all ${d.items.length} images`),
    h('p', {}, h('b', {}, 'Position: '), `RA ${pk.ra.toFixed(4)}°, Dec ${pk.dec.toFixed(4)}°`),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, pk.kind === 'known' ? 'SPHEREx caught this known asteroid here; its proof card has all the checks.'
      : pk.kind === 'single' ? 'The exposure taken minutes before or after, at the same spot, shows nothing here. Anything real (even a fast asteroid) would still be there, so this is a cosmic-ray hit.'
      : pk.kind === 'sharp' ? 'Sharper than any star in the same image. Light from the sky is always blurred by the telescope, so this is a detector effect.'
      : pk.kind === 'lone' ? 'Brighter in an exposure that had no second exposure minutes later, so a real object and a cosmic-ray hit look the same here. Treat it as unchecked.'
      : pk.kind === 'star' ? 'This star gives more light here than in the images of the same colour from the other epochs, and the exposure minutes apart agrees. Some stars really vary (pulsating giants do, a lot, in the infrared); it could also be an image effect. Unconfirmed.'
      : 'Brighter here in this image than in the others. It may be a moving object too faint for the catalogues, or an artefact. Nothing here is claimed as a discovery.'),
    ...(CHGW.show === kd.id && chgByKind(d)[kd.id].length > 1 ? [h('button', { class: 'hbtn chgnext', onclick: () => chgStep(kd.id) }, `${kd.next} (${(CHGW.step[kd.id] || 0) + 2 > chgByKind(d)[kd.id].length ? 1 : (CHGW.step[kd.id] || 0) + 2}/${chgByKind(d)[kd.id].length}) ›`), ' '] : []),
    h('button', { class: S.cv === 'st' ? '' : 'hbtn', onclick: () => { if (multi()) S.ti = x.i; else S.ei = x.e; setMode('time'); S.al.gotoRaDec(pk.ra, pk.dec); S.al.setFov(0.12); } }, 'Show this image'), ' ',
    pk.known ? h('button', { onclick: () => showAsteroid(pk.known) }, 'Proof card') : null, ' ',
    pk.known ? h('button', { class: 'hbtn', onclick: () => replayAsteroid(pk.known) }, '▶ Replay its track') : null, ' ',
    h('button', { onclick: showReport }, 'Back to report'),
    ...(pk.known || chgKind(pk) === 'glitch' ? [] : [reportBox(pk)]));
}
/* ---------- v0.39: check it yourself, then tell someone (the public "pitch in" loop) ---------- */
// Every unexplained or brightened spot gets links to check it in other archives, and a plain report people can e-mail or
// paste (e.g. on the Backyard Worlds Talk board). ARCNAVE sends nothing itself: the mail opens in the person's own app,
// with no address filled in. The text always says "unconfirmed", never "discovery".
function candReport(pk) {
  const x = pk.item, d = S.chg, kd = CHG_KINDS.find(k => k.id === chgKind(pk));
  try { writeHash(); } catch { /* sky not ready */ }
  const rep = pk.repeat === true ? 'yes, also in the exposure taken minutes apart' : pk.repeat === null ? 'not possible (no second exposure minutes apart)' : 'no';
  return [
    'ARCNAVE candidate report: UNCONFIRMED, not a discovery claim.',
    `Kind: ${kd.name}`,
    `Position: RA ${pk.ra.toFixed(5)} deg, Dec ${pk.dec.toFixed(5)} deg (ICRS)`,
    `Brightest in: SPHEREx image ${x.im.id}, ${fmtDay(x.im.mjd)} ${mjdDate(x.im.mjd).toISOString().slice(11, 16)} UTC, ${lamOf(x.im).toFixed(2)} micron, detector ${x.im.det}`,
    `Signal: ${pk.snr.toFixed(0)} sigma above the median of ${d.items.length} SPHEREx images`,
    `Known asteroid on this spot at this time (ARCNAVE SkyBoT/MPC check): ${S.inside ? 'none matched' : 'not checked'}`,
    `Repeat check: ${rep}`,
    `See it: ${location.href}`,
    'Data: NASA SPHEREx via NASA/IPAC IRSA. Tool: ARCNAVE (NASA Space Apps 2026).',
  ].join('\n');
}
function reportBox(pk) {
  const enc = encodeURIComponent, ra = pk.ra.toFixed(5), dec = pk.dec.toFixed(5), sdec = (pk.dec >= 0 ? '+' : '') + dec;
  const a = (href, t) => h('a', { href, target: '_blank', rel: 'noopener' }, t);
  const mail = () => { const sub = `ARCNAVE candidate (unconfirmed): RA ${ra}, Dec ${sdec}`; location.href = `mailto:?subject=${enc(sub)}&body=${enc(candReport(pk))}`; };
  const copy = async () => { const t = candReport(pk); try { await navigator.clipboard.writeText(t); toast('Report copied: paste it in an e-mail or a forum post'); } catch { prompt('Copy this report', t); } };
  return h('div', { class: 'rpt' },
    h('h4', {}, 'Check it, then tell someone'),
    candChecklist(pk),
    h('p', {}, '1. Look at the same spot in other surveys (the checks Backyard Worlds volunteers make): ',
      a(`https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${enc(ra + ' ' + sdec)}&CooFrame=ICRS&Radius=1&Radius.unit=arcmin`, 'SIMBAD (1′)'), ' · ',
      a(`https://vizier.cds.unistra.fr/viz-bin/VizieR?-c=${enc(ra + ' ' + sdec)}&-c.rs=60&-out.add=_r&-sort=_r`, 'VizieR (motions)'), ' · ',
      a(`https://irsa.ipac.caltech.edu/applications/finderchart/?locstr=${enc(ra + ' ' + sdec)}`, 'IRSA Finder Chart'), ' · ',
      a(`http://byw.tools/wiseview#ra=${ra}&dec=${dec}&size=176&band=3&speed=500&window=0.5&zoom=9&gaia=1`, 'WiseView'), ' · ',
      a(`https://www.legacysurvey.org/viewer?ra=${ra}&dec=${dec}&layer=ls-dr10&zoom=15`, 'Legacy Surveys'), ' · ',
      a('https://minorplanetcenter.net/cgi-bin/checkmp.cgi', 'MPC asteroid checker'), ' · ',
      h('button', { type: 'button', class: 'linkbtn', onclick: () => showElsewhere(pk.ra, pk.dec, 'this candidate') }, 'every archive…'),
      '. If something known sits there, it is explained.'),
    h('p', {}, '2. Still unexplained? Send the report to an astronomer, a teacher or a club, or post it for the volunteers of ',
      a('https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9/talk', 'Backyard Worlds (Talk board)'), '.'),
    h('div', { class: 'btnrow' }, h('button', { class: 'hbtn', onclick: mail }, 'Send this candidate'), h('button', { onclick: copy }, 'Copy report')),
    h('p', { class: 'rptn' }, 'Your e-mail app opens with the report filled in; you choose who gets it. ARCNAVE sends nothing itself. Most such spots turn out to be artefacts.'));
}
/* ---------- v0.57: the Backyard Worlds checks, done for the person where ARCNAVE can ----------
   Backyard Worlds volunteers check a candidate in this order: seen more than once, not a known asteroid, nothing known at the
   spot (SIMBAD 1′, VizieR motions), then report. ARCNAVE answers the first ones from what it already has; the rest are links. */
function candChecklist(pk) {
  const x = pk.item, mjd = x && x.im ? x.im.mjd : (S.eps.length ? S.eps[S.eps.length - 1].t0 : 0), cosd = Math.cos(pk.dec * Math.PI / 180);
  const sep = (p) => { let dra = p[0] - pk.ra; dra -= 360 * Math.round(dra / 360); return Math.hypot(dra * cosd, p[1] - pk.dec) * 3600; };   // v0.57.3: RA wraps at 0/360
  const near = (list, at) => { let best = null; for (const s of list || []) { const p = at(s); if (!p) continue; const d = sep(p); if (!best || d < best.d) best = { s, d }; } return best; };
  const g = GAIA.data ? near(GAIA.data.stars, s => gAt(s, mjd)) : null, w = CW.src && CW.src.length ? near(CW.src, s => cwAt(s, mjd)) : null;
  const row = (st, txt) => h('li', { class: 'ck ' + st }, h('span', { class: 'ckm', 'aria-hidden': 'true' }, st === 'ok' ? '✓' : st === 'bad' ? '✗' : '·'), ' ', txt);
  const rep = pk.repeat === true ? row('ok', 'Seen again in the exposure taken minutes later (not a one-pixel glitch).')
    : pk.repeat === null ? row('na', 'No second exposure minutes apart to check it in.') : row('bad', 'Not seen in the exposure taken minutes later: often a cosmic ray or an artefact.');
  const ast = S.inside ? row('ok', 'No known asteroid on this spot at that time (SkyBoT / Minor Planet Center).') : row('na', 'Known asteroids not checked yet (the report checks them).');
  const gs = !GAIA.data ? row('na', 'Gaia not loaded: press Gaia to check for a known star here.')
    : g && g.d < 6.15 ? row('bad', `A Gaia DR3 star sits ${g.d.toFixed(1)}″ away (G ${g.s.g.toFixed(1)}): most likely that star.`)
    : row('ok', `No Gaia DR3 star within one SPHEREx pixel (nearest ${g ? g.d.toFixed(0) + '″' : 'none'}).`);
  const ws = !CW.data ? row('na', 'WISE not loaded: press WISE to check for a known infrared source here.')
    : w && w.d < 6.15 ? row('bad', `A CatWISE2020 source sits ${w.d.toFixed(1)}″ away (${w.s.name}): most likely that source.`)
    : row('ok', `No CatWISE2020 source within one SPHEREx pixel (nearest ${w ? w.d.toFixed(0) + '″' : 'none'}).`);
  const fl = row('na', 'SPHEREx pipeline flags at this spot: reading the image…');
  if (x && x.im) pipeFlagsAt(x.im, pk.ra, pk.dec).then(r => {
    if (!r) { fl.replaceWith(row('na', 'SPHEREx pipeline flags: this image is not saved here, so they could not be read.')); return; }
    const bad = r.names.filter(n => FLAG_ARTEFACT.includes(n)), info = r.names.filter(n => !FLAG_ARTEFACT.includes(n));
    fl.replaceWith(bad.length ? row('bad', `NASA's pipeline flagged this spot as ${bad.join(', ')} (${bad.map(n => FLAG_SAYS[n] || n.toLowerCase()).join('; ')}): most likely an artefact.`)
      : row('ok', 'No artefact flag from NASA\'s pipeline at this spot' + (info.length ? ` (it notes: ${info.map(n => FLAG_SAYS[n] || n).join('; ')}).` : '.')));
  }).catch(() => fl.replaceWith(row('na', 'SPHEREx pipeline flags could not be read.')));
  return h('div', { class: 'cklist' }, h('p', { class: 'ckh' }, h('b', {}, 'Checks ARCNAVE made for you:')), h('ul', {}, rep, ast, gs, ws, fl));
}
/* v0.57.2: which FLAGS bits NASA's pipeline set on a spot of one image (3x3 pixels around it), read from the cutout this
   server saved. Names come from the file (QR2 MP_ keys, QR3/DR1 MSKN keys), else DR1's own numbering. Labels only: the
   masks ARCNAVE measures with are not changed. CROSSTALK and STREAK are not in ARCNAVE's masks, so they are worth a word. */
const FLAG_DR1 = { 0: 'TRANSIENT', 1: 'OVERFLOW', 2: 'SUR_ERROR', 6: 'NONFUNC', 7: 'DICHROIC', 9: 'MISSING_DATA', 10: 'HOT', 11: 'COLD', 12: 'FULLSAMPLE', 14: 'PHANMISS',
  15: 'NONLINEAR', 17: 'PERSIST', 19: 'OUTLIER', 20: 'CROSSTALK', 21: 'SOURCE', 22: 'GHOST', 23: 'GHOST_FPA', 24: 'GHOST_EXT', 25: 'STREAK', 26: 'BLOOM', 27: 'SNOWBALL', 28: 'HALO' };
const FLAG_ARTEFACT = ['TRANSIENT', 'OVERFLOW', 'SUR_ERROR', 'NONFUNC', 'MISSING_DATA', 'HOT', 'COLD', 'NONLINEAR', 'PERSIST', 'CROSSTALK', 'GHOST', 'GHOST_FPA', 'GHOST_EXT', 'BLOOM', 'SNOWBALL', 'HALO'];
const FLAG_SAYS = { TRANSIENT: 'a one-off hit such as a cosmic ray', OVERFLOW: 'saturated', NONLINEAR: 'too bright to measure', PERSIST: 'afterglow of an earlier bright star',
  CROSSTALK: 'an electronic echo of a bright star elsewhere on the detector', GHOST: 'an optical ghost of a bright star', GHOST_FPA: 'an optical ghost', GHOST_EXT: 'an optical ghost',
  BLOOM: 'charge spilling from a saturated star', SNOWBALL: 'a snowball (a large cosmic-ray hit)', HALO: 'the halo of a bright star', HOT: 'a hot pixel', COLD: 'a dead pixel',
  NONFUNC: 'a faulty pixel', MISSING_DATA: 'data lost', SUR_ERROR: 'a readout error', STREAK: 'a streak (a satellite or a fast asteroid)', SOURCE: 'a known source sits here',
  OUTLIER: 'an outlier (also set on moving asteroids)', DICHROIC: 'the dichroic edge (calibrated)', FULLSAMPLE: 'full sampling', PHANMISS: 'no phantom reference' };
const FLAGSAT = new Map();
async function pipeFlagsAt(im, ra, dec) {
  const fld = S.field; if (!fld) return null;
  const key = `${im.url}|${ra.toFixed(5)}|${dec.toFixed(5)}`; if (FLAGSAT.has(key)) return FLAGSAT.get(key);
  // v0.57.3: the FLAGS the page kept when it built the frame (buildFrame), so this also works on a public host, where the
  // images the page read from S3 are not saved on the server (review finding); else the server's saved cutout
  let src = S.frames.get(im.url) && S.frames.get(im.url).rawFlags;
  if (!src) {
    const r = await fetch(`/api/spherex/cutout?url=${encodeURIComponent(im.url)}&ra=${fld.ra}&dec=${fld.dec}&size=${fld.size}&cached=1`);
    if (r.status !== 200) return null;
    src = rawFlagsOf(await r.arrayBuffer());
  }
  if (!src) return null;
  const fl = src.fl, p = F.sky2pix(src.wcs, ra, dec); if (!p) return null;
  const names = src.names, byBit = Object.keys(names).length ? Object.fromEntries(Object.entries(names).map(([n, b]) => [b, n])) : FLAG_DR1;
  let bits = 0; const x0 = Math.round(p[0] - 1), y0 = Math.round(p[1] - 1);   // sky2pix is 1-based (FITS)
  for (let y = y0 - 1; y <= y0 + 1; y++) for (let x = x0 - 1; x <= x0 + 1; x++) if (x >= 0 && y >= 0 && x < fl.nx && y < fl.ny) bits |= fl.data[y * fl.nx + x];
  const out = { bits: bits >>> 0, names: Object.keys(byBit).map(Number).filter(b => (bits >>> b) & 1).map(b => byBit[b]) };
  FLAGSAT.set(key, out); return out;
}
// The FLAGS image of one cutout with its WCS and bit names; null unless it is a plain integer image the size of IMAGE (a
// tile-compressed table read as pixels would give false flags: review finding)
function rawFlagsOf(buf, hdIn) {
  try {
    const hd = hdIn || F.parseFITS(buf), hi = F.findHDU(hd, 'IMAGE'), hf = F.findHDU(hd, 'FLAGS');
    if (!hi || !hf || hf.header.ZIMAGE || hf.header.XTENSION === 'BINTABLE' || hf.header.NAXIS1 !== hi.header.NAXIS1 || hf.header.NAXIS2 !== hi.header.NAXIS2) return null;
    return { fl: F.readFlags(buf, hf), wcs: F.makeWCS(hi.header), names: F.flagBitNames(hf.header) };
  } catch { return null; }
}
/* ---------- v0.57: this spot elsewhere: every resource the NASA challenge lists, and the archives volunteers use ----------
   NASA/IPAC IRSA (SPHEREx tools, tutorial notebooks, DR1), WiseView (the WISE tool the challenge names as a model), Gaia
   at STScI MAST, the Canadian Space Agency's NEOSSat at CADC (asked through /api/neossat: CADC sends no CORS header),
   SSOIS and DSS at CADC, plus SIMBAD, VizieR, Legacy Surveys, Pan-STARRS and the Minor Planet Center. Links only: nothing
   is sent anywhere but the position in the link itself. */
/* v0.57.4: NEOSSat's frames of this spot, as CADC's preview pictures (raw frames, visible light, 3″ pixels, inverted grey:
   stars are dark). One frame per night, oldest first; a click opens the large picture. They are shown as they are: the
   frames are pointed at different targets and turned differently, and the 2018-2019 ones carry no sky coordinates, so
   ARCNAVE measures nothing on them. */
function neoGallery(box, n) {
  const fig = nt => h('figure', { class: 'neof' },
    h('a', { href: `/api/neossat/preview?id=${nt.id}`, target: '_blank', rel: 'noopener', title: `NEOSSat frame ${nt.id} (${nt.target}), ${nt.date}: open the large picture` },
      h('img', { src: `/api/neossat/preview?id=${nt.id}&s=256`, alt: `NEOSSat frame of ${nt.target}, ${nt.date}`, loading: 'lazy', width: 96, height: 96,
        onerror: function () { this.closest('figure').classList.add('neofail'); this.alt = 'CADC did not send this picture'; } })),
    h('figcaption', {}, nt.date, h('br'), `${nt.n} frame${nt.n === 1 ? '' : 's'}`));
  box.replaceChildren(
    h('div', { class: 'neorow' }, ...n.nights.map(fig)),
    h('p', { class: 'gnote' }, `${n.nightsTotal > n.nights.length ? `${n.nights.length} of the ${n.nightsTotal} nights` : `The ${n.nights.length} night${n.nights.length === 1 ? '' : 's'}`} NEOSSat looked here, one frame each, `,
      'as CADC previews them (visible light, 3″ pixels, stars dark). They are pointed and turned differently, so they are not lined up and ARCNAVE measures nothing on them: they show the same sky through a second, Canadian telescope.'));
  box.hidden = false;
}
function elsewhereLinks(ra, dec, o = {}) {
  const enc = encodeURIComponent, r5 = (+ra).toFixed(5), d5 = (+dec).toFixed(5), sd = (dec >= 0 ? '+' : '') + d5, pos = enc(r5 + ' ' + sd);
  const a = (href, t) => h('a', { href, target: '_blank', rel: 'noopener' }, t);
  const row = (lab, ...links) => h('p', { class: 'elsrow' }, h('b', {}, lab + ': '), ...links.filter(Boolean).flatMap((l, i) => i ? [' · ', l] : [l]));
  const neo = h('span', { class: 'elsneo' }, 'asking CADC…'), neoG = h('div', { class: 'neog', hidden: true });
  api(`/api/neossat?ra=${r5}&dec=${d5}&r=${Math.min(1, Math.max(0.05, (o.r || 0.25))).toFixed(3)}`).then(n => {
    neo.replaceChildren(n.n ? `${n.n} NEOSSat frame${n.n === 1 ? '' : 's'} here, ${n.first} to ${n.last}` + (n.targets.length ? ` (targets: ${n.targets.map(t => `${t.name} ${t.n}`).join(', ')})` : '') + '. '
      : 'NEOSSat has not imaged this spot (it is pointed at chosen targets, not a survey). ',
      a('https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/search/?collection=NEOSSAT', 'Open at CADC'));
    // v0.57.4: the frames themselves: one per night it looked (up to 8, spread over the years), CADC's own preview pictures
    if (n.nights && n.nights.length) neoGallery(neoG, n);
  }).catch(() => neo.replaceChildren('CADC did not answer just now. ', a('https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/neossat/', 'NEOSSat at CADC')));
  return h('div', { class: 'els' },
    row('SPHEREx at NASA/IPAC IRSA', a('https://irsa.ipac.caltech.edu/applications/spherex/', 'SPHEREx Data Explorer'),
      a('https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry', 'Spectrophotometry Tool'),
      a('https://caltech-ipac.github.io/irsa-tutorials/spherex/', 'Python tutorial notebooks'), a('https://irsa.ipac.caltech.edu/Missions/spherex.html', 'Data releases (DR1, QR3)')),
    row('The same spot with other telescopes', a(`http://byw.tools/wiseview#ra=${r5}&dec=${d5}&size=176&band=3&speed=500&window=0.5&zoom=9&gaia=1`, 'WiseView (NASA WISE, blinking)'),
      a(`https://www.legacysurvey.org/viewer?ra=${r5}&dec=${d5}&zoom=14&layer=unwise-neo7`, 'unWISE'), a(`https://www.legacysurvey.org/viewer?ra=${r5}&dec=${d5}&zoom=15&layer=ls-dr10`, 'Legacy Surveys'),
      a(`https://ps1images.stsci.edu/cgi-bin/ps1cutouts?pos=${r5}+${sd}&filter=color&filetypes=stack&size=240`, 'Pan-STARRS'),
      a(`https://irsa.ipac.caltech.edu/applications/finderchart/?locstr=${pos}`, 'IRSA Finder Chart (DSS, SDSS, 2MASS, WISE)'),
      a('https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/dss/', 'Digitized Sky Survey at CADC (1950-2002)')),
    h('p', { class: 'elsrow' }, h('b', {}, 'Canadian Space Agency NEOSSat (visible light): '), neo), neoG,
    row('About NEOSSat', a('https://www.asc-csa.gc.ca/eng/satellites/neossat/', 'The mission (CSA)'), a('https://github.com/asc-csa/NEOSSAT_Tutorial', 'Python data tutorial'),
      a('https://data.asc-csa.gc.ca/dataset/neossat', 'Open dataset')),
    row('Catalogues', a(`https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${pos}&CooFrame=ICRS&Radius=1&Radius.unit=arcmin`, 'SIMBAD (1′)'),
      a(`https://vizier.cds.unistra.fr/viz-bin/VizieR?-c=${pos}&-c.rs=60&-out.add=_r&-sort=_r`, 'VizieR'),
      a(`https://mast.stsci.edu/portal/Mashup/Clients/Mast/Portal.html?searchQuery=${enc(r5 + ' ' + d5)}`, 'Gaia and more at MAST')),
    row('Asteroids and comets', a('https://minorplanetcenter.net/cgi-bin/checkmp.cgi', 'MPC checker'),
      a('https://irsa.ipac.caltech.edu/applications/MOST/', 'IRSA MOST (incl. SPHEREx images)'), a('https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/ssois/', 'SSOIS at CADC (who else imaged it)')),
    row('Volunteers', a('https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9/about/faq', 'Backyard Worlds: how to check a mover'),
      a('https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9/talk', 'Talk board')));
}
function showElsewhere(ra, dec, what) {
  if (ra == null) { if (S.field) ({ ra, dec } = S.field); else if (S.al) [ra, dec] = S.al.getRaDec(); else return; }
  const c = $('card'); c.replaceChildren(); c.hidden = false;
  c.append(h('h3', {}, '🔗 ' + (what ? 'Elsewhere: ' + what : 'This spot elsewhere')),
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, `RA ${(+ra).toFixed(5)}°, Dec ${(+dec).toFixed(5)}° · opens in a new tab`),
    elsewhereLinks(ra, dec, { r: S.field ? Math.min(1, S.field.size / 2) : 0.25 }),
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'Every resource NASA lists for this challenge, and the archives Backyard Worlds volunteers use to check a mover.'),
    h('button', { onclick: () => { S.report ? showReport() : (c.hidden = true); } }, 'Close'));
}
if ($('elsb')) $('elsb').onclick = () => showElsewhere();
/* ---------- v0.39: the same field in Python, for anyone who wants to go further ----------
   v0.57.5: a Jupyter notebook (public/notebook.js) in the style of IRSA's SPHEREx tutorials, which redoes this spot in the
   open: ARCNAVE's own IRSA query, one image per pass lined up (blink GIF, difference), Gaia DR3 moved to each date, and a
   spectrum on the fly from WCS-WAVE with saturated points marked. The same cells also come as one .py file. */
function pyBuild() {
  let ra, dec, size;
  if (S.field) ({ ra, dec, size } = S.field); else { [ra, dec] = S.al ? S.al.getRaDec() : [0, 0]; size = 0.1; }
  try { writeHash(); } catch { /* sky not ready */ }
  const ct = S.ct && CHALLENGE[S.ct], vEl = document.querySelector('.fine .mono');   // the version shown on the start page
  // the link back: the page's own address once it carries the spot, else one made from it (a field still loading has none yet)
  const url = location.hash.length > 1 ? location.href : location.origin + location.pathname + (S.ct ? '#ct=' + S.ct : `#ra=${(+ra).toFixed(4)}&dec=${(+dec).toFixed(4)}`);
  return ArcNotebook.build({ ra, dec, size: Math.min(size, 0.5), band: S.band, name: ct ? ct.name : '', url,
    version: vEl ? vEl.textContent.trim().replace(/^v/, '') : '' });
}
function pySnippet() { return pyBuild().py; }   // kept: the plain .py form
function saveFile(text, name, type) {
  const u = URL.createObjectURL(new Blob([text], { type })), el = h('a', { href: u, download: name });
  document.body.append(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
}
async function copyPython() {
  const nb = pyBuild();
  saveFile(nb.json, nb.file + '.ipynb', 'application/x-ipynb+json');
  const copy = async () => { try { await navigator.clipboard.writeText(nb.py); toast('Python code copied.'); } catch { toast('Copy was blocked here: use Download .py.'); } };
  const e = $('toast'); e.replaceChildren(`Notebook downloaded: ${nb.file}.ipynb. Open it in Jupyter or Google Colab (pip install astroquery matplotlib reproject). `,
    h('button', { class: 'tbtn', onclick: () => saveFile(nb.py, nb.file + '.py', 'text/x-python') }, 'Download .py'), ' ',
    h('button', { class: 'tbtn', onclick: copy }, 'Copy code'));
  e.hidden = false; clearTimeout(toast.i); toast.i = setTimeout(() => e.hidden = true, 12000);
}
if ($('pyb')) $('pyb').onclick = copyPython;
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
/* ---------- Whole-sky atlas (v0.14): the app opens on the entire sky, not on one patch ---------- */
// The background is the 2MASS near-infrared all-sky survey (the default base sky) in an Aitoff projection, Milky Way across the middle (galactic
// frame). Markers are real places: famous landmarks (their archive answer and first images ship in demo-cache, so they open fast), the bundled asteroid example, and the 18 scorecard test fields.
// Clicking one dives in and the agents start. Below about 40 degrees the view returns to the normal north-up frame.
const LANDMARKS = [
  { name: 'Galactic centre', q: 'Sgr A*', ra: 266.417, dec: -29.008, note: 'The heart of the Milky Way' },
  { name: 'Orion Nebula', q: 'M42', ra: 83.822, dec: -5.391, note: 'A star nursery' },
  { name: 'Andromeda', q: 'M31', ra: 10.685, dec: 41.269, note: 'The nearest big galaxy' },
  { name: 'Pleiades', q: 'M45', ra: 56.75, dec: 24.117, note: 'A young star cluster' },
  { name: 'Crab Nebula', q: 'M1', ra: 83.633, dec: 22.0145, note: 'What is left of a star that exploded in 1054' }   // v0.14.3: replaces the LMC, which SPHEREx has so far seen in one long pass only (nothing to compare)
];
const allSky = () => !!S.al && S.al.getFov()[0] > 40;
function wholeSky(animate) {
  const al = S.al; if (!al) return;
  try { al.setProjection && al.setProjection('AIT'); al.setFrame && al.setFrame('galactic'); } catch { /* older Aladin: keep the default view */ }
  if (animate && !reduce && al.zoomToFoV) { try { al.animateToRaDec && al.animateToRaDec(266.405, -28.936, 1.2); al.zoomToFoV(360, 1.4); return; } catch { /* fall through */ } }
  al.gotoRaDec(266.405, -28.936); al.setFov(360);
}
// a smooth flight to a field; ends in the normal north-up view the rest of the app uses.
// v0.35.2: from one field to another far away (asked by the team: "a new RA/Dec jumped there at once"), the camera now
// pulls back to the whole sky, turns, and dives in, like a flight between two places. A spot already on screen is a short
// pan + zoom. A newer flight cancels an older one. With "reduce motion" set in the system it still jumps.
const FLY = { n: 0 };
const skyEls = () => ['aladin', 'ov'].map(id => document.getElementById(id)).filter(Boolean);
const angDist = (ra1, d1, ra2, d2) => { const r = Math.PI / 180, c = Math.sin(d1 * r) * Math.sin(d2 * r) + Math.cos(d1 * r) * Math.cos(d2 * r) * Math.cos((ra1 - ra2) * r); return Math.acos(Math.min(1, Math.max(-1, c))) / r; };
async function flyTo(ra, dec, fov, quick = false) {   // quick: jump (the guided tour steps between tools)
  const al = S.al, me = ++FLY.n, from = al.getFov()[0], alive = () => me === FLY.n;
  const can = !quick && !reduce && al.zoomToFoV && al.animateToRaDec;
  const end = () => { if (!alive()) return; FLY.via = 0; try { al.setFrame && al.setFrame('ICRSd'); al.setProjection && al.setProjection('SIN'); } catch { /* ignore */ } al.gotoRaDec(ra, dec); al.setFov(fov);
    for (const el of skyEls()) if (el.style.opacity === '0' || el.style.transform) {   // v0.57.9: a faded sky always comes back (v0.57.13: and unzoomed)
      el.style.transition = 'none'; el.style.transform = ''; el.style.transformOrigin = '';
      requestAnimationFrame(() => { el.style.transition = 'opacity .3s ease'; el.style.opacity = ''; });
    }
  };
  if (!can) { end(); return; }
  try {
    let c = null; try { c = al.getRaDec(); } catch { c = null; }
    const d = c ? angDist(c[0], c[1], ra, dec) : 180;
    if (from <= 20 && d > Math.max(3, from * 1.5)) {
      // v0.57.13: from one field to another far away the trip goes by the galactic centre again (asked by the team): the
      // sky fades out, the whole-sky map comes up centred on the galactic centre, holds a moment, then dives into the new
      // field. The flight of v0.35.2 animated the sky viewer itself, which redrew the whole sky in another projection on
      // every frame while the new field's images loaded (one frame of 18.9 s, 32 s of frozen page on an Intel UHD 620).
      // Here the sky viewer draws the whole sky once and the new field once; the fades and the dive are CSS on the
      // browser's compositor (opacity and scale), which costs the page nothing.
      const els = skyEls(), css = (t, o, tr) => { for (const e of els) { e.style.transition = t; e.style.opacity = o; if (tr != null) e.style.transform = tr; } };
      // v0.57.14: shorter (2.3 s made a cached field open 2 to 5 s later): fade 0.2 s, hold 0.7 s, dive 0.45 s
      css('opacity .2s ease', '0'); await sleep(200); if (!alive()) return;
      FLY.via = me; wholeSky(false); await new Promise(r => requestAnimationFrame(r));
      css('opacity .25s ease', '1'); await sleep(700); if (!alive()) return;
      let p = null; try { p = al.world2pix(ra, dec); } catch { p = null; }   // the dive heads for the new field on the whole-sky map
      for (const e of els) e.style.transformOrigin = p && isFinite(p[0]) && isFinite(p[1]) ? `${p[0]}px ${p[1]}px` : '50% 50%';
      css('opacity .35s ease-in .1s, transform .45s cubic-bezier(.5,0,.9,.6)', '0', 'scale(6)'); await sleep(460);
      end(); return;   // end() puts the field in place, unzooms and fades it back in
    } else if (from > 20) {   // from the whole sky (as before)
      al.animateToRaDec(ra, dec, 1.4); await sleep(1500); if (!alive()) return;
      al.zoomToFoV(Math.max(fov, 8), 1.6); await sleep(1700); if (!alive()) return;
    } else if (d > 0.01) {    // close by: a short pan
      al.animateToRaDec(ra, dec, 0.9); await sleep(1000); if (!alive()) return;
    }
  } catch { /* jump instead */ }
  end();
}
// v0.57.12: an RA/Dec grid in degrees on the whole-sky map (asked by the team: "people don't know which coordinates to
// type"). RA lines every 30° (0° to 360°), Dec lines every 30° (-90° south pole to +90° north pole), each labelled, so a
// visitor can read a position off the map and type it in Fly to. The map itself is in the galactic frame, so the grid curves.
function polyline(pts) {
  let prev = null; ctx.beginPath();
  for (const [ra, dec] of pts) { const p = proj(ra, dec); if (p && prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 60) ctx.lineTo(p[0], p[1]); else if (p) ctx.moveTo(p[0], p[1]); prev = p; }
  ctx.stroke();
}
function drawCoordGrid() {
  ctx.save(); ctx.strokeStyle = 'rgba(159,176,220,.22)'; ctx.lineWidth = 1;
  for (let ra = 0; ra < 360; ra += 30) { const pts = []; for (let d = -88; d <= 88; d += 2) pts.push([ra, d]); polyline(pts); }
  for (const d of [-60, -30, 0, 30, 60]) { const pts = []; for (let ra = 0; ra <= 360; ra += 2) pts.push([ra, d]); if (d === 0) { ctx.strokeStyle = 'rgba(159,176,220,.42)'; } polyline(pts); ctx.strokeStyle = 'rgba(159,176,220,.22)'; }
  ctx.font = '500 11px "JetBrains Mono",ui-monospace,Consolas,monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const label = (t, p) => { const w = ctx.measureText(t).width + 8; ctx.fillStyle = 'rgba(6,11,24,.6)'; ctx.fillRect(p[0] - w / 2, p[1] - 8, w, 16); ctx.fillStyle = 'rgba(200,212,238,.92)'; ctx.fillText(t, p[0], p[1]); };
  for (let ra = 0; ra < 360; ra += 30) { const p = proj(ra, 0); if (p && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H) label('RA ' + ra + '°', p); }
  for (const d of [-60, -30, 30, 60]) { const p = proj(90, d); if (p && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H) label('Dec ' + (d > 0 ? '+' : '') + d + '°', p); }
  for (const d of [-90, 90]) { const p = proj(0, d); if (p && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H) label((d > 0 ? 'North pole' : 'South pole') + ' · Dec ' + (d > 0 ? '+' : '') + d + '°', p); }
  // the position under the mouse, ready to type in Fly to
  const m = S.mouse;
  if (m) {
    let s = null; try { s = S.al.pix2world(m[0], m[1], 'icrs'); } catch { s = null; }
    if (s && isFinite(s[0]) && isFinite(s[1])) {
      const t = `RA ${(((s[0] % 360) + 360) % 360).toFixed(1)}  Dec ${s[1] >= 0 ? '+' : ''}${s[1].toFixed(1)}   type this in Fly to`;
      ctx.textAlign = 'left'; ctx.font = '600 12px "JetBrains Mono",ui-monospace,Consolas,monospace';
      const er = eyeRect(), right = er ? er.right : W, w = ctx.measureText(t).width + 12, x = m[0] + 16 + w > right ? m[0] - 16 - w : m[0] + 16, y = m[1] + 22;
      ctx.fillStyle = 'rgba(6,11,24,.85)'; ctx.fillRect(x, y - 10, w, 20); ctx.strokeStyle = 'rgba(95,227,240,.6)'; ctx.strokeRect(x + .5, y - 9.5, w - 1, 19);
      ctx.fillStyle = '#8af3e8'; ctx.fillText(t, x + 6, y);
    }
  }
  ctx.restore();
}
// v0.57.12: the corners of the eyepiece say where they point (RA/Dec in degrees), and a line under the view gives the RA and
// Dec range on screen and its width, so anyone can tell which patch of sky they are looking at.
const fmtRa = v => (((v % 360) + 360) % 360).toFixed(3) + '°', fmtDec = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3) + '°';
// the eyepiece rectangle, measured only when it changes size or place (a layout read every frame would freeze the page)
const EYE = { r: null, dirty: true };
function eyeRect() {
  if (EYE.dirty) { EYE.dirty = false; const e = document.querySelector('.eye'); const r = e && e.getBoundingClientRect(); EYE.r = r && r.width > 80 && r.height > 80 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; }
  return EYE.r;
}
{ const e = document.querySelector('.eye'); const mark = () => { EYE.dirty = true; TELE.fit = null; };
  addEventListener('resize', mark);
  if (e) { e.addEventListener('transitionend', mark); if (window.ResizeObserver) new ResizeObserver(mark).observe(e); }
  if (window.MutationObserver) new MutationObserver(mark).observe(document.body, { attributes: true, attributeFilter: ['class'] }); }   // panels collapse / clear view move the eyepiece
// is something (the film's player) over the sky at this point? A hit test reads layout, so it is asked once a second at most
const COVER = { at: 0, v: {} };
function coveredAt(k, x, y) {
  const now = performance.now();
  if (EYE.dirty || now - COVER.at > 1000) { COVER.at = now; COVER.v = {}; }
  if (!(k in COVER.v)) { const el = document.elementFromPoint(x, y); COVER.v[k] = !!(el && el.id !== 'aladin' && !(el.closest && el.closest('#aladin'))); }
  return COVER.v[k];
}
function drawCorners(r) {
  if (!r) return;
  { const it = $('intro'); if (it && !it.hidden) return; }   // the start page covers the sky
  const at = (x, y) => { try { const s = S.al.pix2world(x, y, 'icrs'); return s && isFinite(s[0]) && isFinite(s[1]) ? s : null; } catch { return null; } };
  ctx.save(); ctx.font = '500 11px "JetBrains Mono",ui-monospace,Consolas,monospace'; ctx.textBaseline = 'middle';
  const box = (t, x, y, align) => { ctx.textAlign = align; const w = ctx.measureText(t).width + 10, x0 = align === 'left' ? x - 5 : x - w + 5; ctx.fillStyle = 'rgba(6,11,24,.62)'; ctx.fillRect(x0, y - 9, w, 18); ctx.fillStyle = 'rgba(138,243,232,.92)'; ctx.fillText(t, x, y); };
  const C = [[r.left, r.top, 'left', 1], [r.right, r.top, 'right', 1], [r.left, r.bottom, 'left', -1], [r.right, r.bottom, 'right', -1]];
  for (const [x, y, al, dy] of C) {
    const s = at(x, y); if (!s) continue;
    const tx = al === 'left' ? x + 36 : x - 36;
    if (dy < 0 && coveredAt(al, al === 'left' ? tx + 60 : tx - 60, y - 12)) continue;   // the film's player covers it
    box(`RA ${fmtRa(s[0])}  Dec ${fmtDec(s[1])}`, tx, y + dy * 12, al);
  }
  ctx.restore();
}
// the RA and Dec range inside the eyepiece (RA may wrap through 0°), shown in the status bar
function viewRange() {
  if (allSky()) return 'whole sky · RA 0–360° · Dec −90…+90°';
  const r = eyeRect() || { left: 0, top: 0, right: W, bottom: H }, got = [];
  for (const [x, y] of [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]) {
    let s = null; try { s = S.al.pix2world(x, y, 'icrs'); } catch { s = null; }
    if (!s || !isFinite(s[0]) || !isFinite(s[1])) return 'none'; got.push(s);
  }
  const ras = got.map(s => ((s[0] % 360) + 360) % 360), decs = got.map(s => s[1]);
  let lo = Math.min(...ras), hi = Math.max(...ras);
  if (hi - lo > 180) { const sh = ras.map(v => v > 180 ? v - 360 : v); lo = Math.min(...sh); hi = Math.max(...sh); }
  const poleIn = [proj(0, 90), proj(0, -90)].some(z => z && z[0] > r.left && z[0] < r.right && z[1] > r.top && z[1] < r.bottom);
  const f1 = v => (((v % 360) + 360) % 360).toFixed(2) + '°', f2 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '°';
  return (poleIn ? 'RA all (pole in view)' : `RA ${f1(lo)}–${f1(hi)}`) + ` · Dec ${f2(Math.min(...decs))}…${f2(Math.max(...decs))}`;
}
function drawAllSky() {
  if (!FLY.via) drawCoordGrid();   // v0.57.14: not during a flight past the galactic centre (thousands of projections per draw)
  ctx.save(); ctx.font = '600 12px Archivo,sans-serif'; ctx.textBaseline = 'middle';
  drawEcliptic();
  // label the ecliptic once, where it is on screen
  for (const l of [150, 210, 30, 330]) {
    const e = 23.4393 * Math.PI / 180, L = l * Math.PI / 180, dec = Math.asin(Math.sin(e) * Math.sin(L)) * 180 / Math.PI, ra = ((Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * 180 / Math.PI) + 360) % 360, p = proj(ra, dec);
    if (p && p[0] > 60 && p[0] < W - 160 && p[1] > 90 && p[1] < H - 220) { ctx.fillStyle = 'rgba(95,227,240,.85)'; ctx.fillText('Ecliptic · path of the planets', p[0] + 8, p[1] - 10); break; }
  }
  const sc = (typeof SC !== 'undefined' && SC && SC.rows) || [];
  ctx.strokeStyle = 'rgba(95,227,240,.8)'; ctx.lineWidth = 1.2;
  for (const r of sc) { const p = proj(r.ra, r.dec); if (!p) continue; ctx.strokeRect(p[0] - 4, p[1] - 4, 8, 8); S.hits.push({ x: p[0], y: p[1], sky: { ra: r.ra, dec: r.dec, label: 'Test field ' + r.id } }); }
  const ex = EXAMPLES.proof, pe = proj(ex.ra, ex.dec);
  if (pe) {
    ctx.strokeStyle = '#ffb05a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pe[0], pe[1], 9, 0, 7); ctx.stroke();
    ctx.fillStyle = '#ffb05a'; ctx.beginPath(); ctx.arc(pe[0], pe[1], 2.5, 0, 7); ctx.fill();
    ctx.fillText('Real asteroid example', pe[0] + 14, pe[1]); S.hits.push({ x: pe[0], y: pe[1], sky: { ex: 'proof' } });
  }
  for (const m of LANDMARKS) {
    const p = proj(m.ra, m.dec); if (!p) continue;
    ctx.fillStyle = '#eef1f7'; ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(238,241,247,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(238,241,247,.92)'; ctx.fillText(m.name, p[0] + 12, p[1]);
    S.hits.push({ x: p[0], y: p[1], sky: { ra: m.ra, dec: m.dec, label: m.name } });
  }
  ctx.restore();
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
    S.hits.push({ x: p[0], y: p[1], ast: a }); drawMotionArrow(a, sg);
  }
  // v0.32: sources seen at one visit only that match no known object: a dashed "?" ring, never linked to other images
  for (const u of S.inside.unknown || []) {
    if (u.im !== im) continue;
    const p = proj(u.ra, u.dec); if (!p) continue;
    ctx.strokeStyle = ctx.fillStyle = '#b9a5ff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p[0], p[1], 11, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '600 12px Archivo,sans-serif'; ctx.fillText('?', p[0] + 13, p[1] - 8);
    S.hits.push({ x: p[0], y: p[1], unk: u });
  }
}
// v0.32: a confirmed asteroid's motion from the orbit catalogue (dRA incl. cos dec, dDec; arcsec per hour): track arrow + card
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function astMotion(a) {
  if (!a || !Number.isFinite(a.dra) || !Number.isFinite(a.ddec)) return null;
  const v = Math.hypot(a.dra, a.ddec); if (!(v > 0)) return null;
  const pa = (Math.atan2(a.dra, a.ddec) * 180 / Math.PI + 360) % 360;   // east of north
  return { v, pxh: v / (PX * 3600), dir: COMPASS[Math.round(pa / 45) % 8], hours: Math.min(24, Math.max(3, Math.ceil(120 / v))) };
}
const skyAhead = (sg, a, hr) => [sg.ra + a.dra * hr / 3600 / Math.cos(sg.dec * Math.PI / 180), sg.dec + a.ddec * hr / 3600];
function drawMotionArrow(a, s0) {   // only in the image where it was seen (v0.32 live check: an arrow from another image's spot misleads)
  {
    const m = a.confirmed && astMotion(a); if (!m) return;
    const p0 = proj(s0.ra, s0.dec), e1 = skyAhead(s0, a, m.hours), p1 = proj(e1[0], e1[1]);
    if (!p0 || !p1) return;
    ctx.strokeStyle = ctx.fillStyle = '#5ff0a0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    const step = m.hours <= 12 ? 1 : 3;   // a tick for every hour (every 3 h on long arrows)
    for (let t = step; t < m.hours; t += step) { const s_ = skyAhead(s0, a, t), q = proj(s_[0], s_[1]); if (q) ctx.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3); }
    const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), L = 10;
    ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p1[0] - L * Math.cos(ang - 0.45), p1[1] - L * Math.sin(ang - 0.45)); ctx.lineTo(p1[0] - L * Math.cos(ang + 0.45), p1[1] - L * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
    ctx.font = '600 12px Archivo,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${m.v.toFixed(0)}″ per hour · next ${m.hours} h`, (p0[0] + p1[0]) / 2, Math.max(p0[1], p1[1]) + 20); ctx.textAlign = 'start';
    S.hits.push({ x: p1[0], y: p1[1], ast: a });
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
// v0.57.8: the strip used to be rebuilt from scratch after every image (250+ thumbnails redrawn each time, ~0.1-0.3 s per
// image, so a 250-image spot froze the page for many seconds in total). Now, while the same images are listed, only the
// thumbnails whose picture changed are redrawn (paint() counts versions); a new list still rebuilds it as before.
const STRIP = { key: '', th: new Map() };
const thTitle = x => `Epoch ${x.e + 1}, image ${x.pos} of ${x.n}: ${fmtDay(x.im.mjd)}, ${lamOf(x.im).toFixed(3)} µm, detector ${x.im.det}`;
const thumbDraw = (cv, fr) => { const c = cv.getContext('2d'); c.imageSmoothingEnabled = true; c.clearRect(0, 0, 40, 40); c.drawImage(fr.canvas, 0, 0, 40, 40); cv._pv = fr.pv; cv._fr = fr; };
function renderStrip() {
  const box = $('strip'); if (!box) return;
  box.hidden = !multi() || S.mode === 'change';
  if (!multi()) { box.replaceChildren(); STRIP.key = ''; return; }
  const astIn = new Set(); if (S.inside) for (const a of S.inside.asteroids) for (const sg of a.sightings) astIn.add(sg.im.url);
  const key = S.eps.length + '|' + S.seq.map(x => x.i + ':' + x.im.url).join(',');
  if (key === STRIP.key && box.childElementCount) {
    for (const x of S.seq) {
      const b = STRIP.th.get(x.i); if (!b) continue;
      const fr = S.frames.get(x.im.url), cv = b.firstChild;
      if (fr && (cv._fr !== fr || cv._pv !== fr.pv)) { if (cv._fr !== fr) b.title = thTitle(x); thumbDraw(cv, fr); }
      b.classList.toggle('wait', !fr); b.classList.toggle('ast', astIn.has(x.im.url));
    }
    markStrip(); return;
  }
  STRIP.key = key; STRIP.th.clear(); box.replaceChildren();
  S.eps.forEach((ep, e) => {
    const g = h('div', { class: 'sg' }, h('span', { class: 'sgl' }, 'E' + (e + 1)));
    for (const x of S.seq.filter(y => y.e === e)) {
      const fr = S.frames.get(x.im.url), cv = document.createElement('canvas'); cv.width = cv.height = 40;
      if (fr) thumbDraw(cv, fr);
      const b = h('button', { class: 'th' + (fr ? '' : ' wait') + (astIn.has(x.im.url) ? ' ast' : ''), 'data-i': x.i,
        title: thTitle(x),
        'aria-label': `Show epoch ${e + 1} image ${x.pos}`, onclick: () => { S.ti = x.i; S.sel = null; setMode('time'); moversFor(x); markStrip(); } }, cv);
      STRIP.th.set(x.i, b); g.append(b);
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
// v0.14: the overlay was redrawn 60 times a second even when nothing moved, and every redraw makes the browser re-blur
// the glass panels on top of it (backdrop-filter): on ordinary laptops that showed as a light, constant stutter. Now it
// redraws only when the view moves, a blink frame flips, the user just did something, or (for async loads) 5 times a second.
let lastKey = '', lastDraw = 0, busyUntil = 0;
// v0.57.12: where the mouse is on the sky (the whole-sky map shows its RA/Dec next to the pointer)
addEventListener('pointermove', e => { S.mouse = e.pointerType === 'mouse' && e.target && e.target.closest && e.target.closest('#aladin') ? [Math.round(e.clientX), Math.round(e.clientY)] : null; }, { passive: true });
for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'input', 'click', 'touchmove']) addEventListener(ev, () => { busyUntil = performance.now() + 700; }, { passive: true, capture: true });
function frame(ts) {
  requestAnimationFrame(frame);
  if (!S.al) return;
  VSTK.n++;
  let key = '';
  const er = eyeRect();
  try { const c = S.al.getRaDec(), f = S.al.getFov(); key = `${c[0].toFixed(6)},${c[1].toFixed(6)},${f[0].toFixed(6)},${W},${H},${S.mode},${S.lab},${er ? Math.round(er.left) + ':' + Math.round(er.right) : ''},${f[0] > 40 && S.mouse ? S.mouse.join(':') : ''}`; } catch { /* draw anyway */ }
  if (S.mode === 'blink' || S.mode === 'time') key += ',' + Math.floor(ts / (S.mode === 'blink' && !multi() ? 700 : 650));
  // v0.56: the film's glide, lock-on ring and "from here to there" callout are drawn at ~30 frames a second while a pass
  // changes (and 10 a second for the pulse after), instead of the 5 a second that made the glide jump
  if (MOVIE.on) key += ',' + Math.floor(ts / (ts - MOVIE.t0 < MOVIE.step ? 33 : 100));
  if (key && key === lastKey && ts > busyUntil && ts - lastDraw < 200) return;
  lastKey = key; lastDraw = ts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); S.hits = [];
  const T = affine();
  if (T && S.eps.length && !allSky()) {   // on the whole-sky map the field is a dot: no image layers or captions
    const { a, b } = view(), fa = viewFrame(a), fb = viewFrame(b), A = moversOf(a), B = moversOf(b);
    const withEp = (s, i) => s && { ...s, ep: i };
    if (multi() && (S.mode === 'time' || S.mode === 'blink') && S.seq.length) {
      // one real image at a time: Time machine = the slider's image; Blink = flip-book through an epoch's images (or all)
      let x;
      if (S.mode === 'time') x = seqAt();
      else { const list = blinkList(), k = reduce ? (S.flipIdx || 0) % list.length : Math.floor(ts / 650) % list.length; x = list[k]; }
      const fr = S.frames.get(x.im.url) || rawOf(x.e), m = x.im === chosen(x.e) ? moversOf(x.e) : moversIm(x.im);   // not loaded yet: show the epoch's preview image
      drawImg(T, fr && fr.canvas); S.shownFr = fr; rings(withEp(m, x.e), 'rgba(255,176,90,.9)'); drawSightings(x.im);
      if (S.blinkAt !== x.i) { S.blinkAt = x.i; markStrip(); }
      ctx.fillStyle = '#ffb05a'; ctx.font = '500 13px Archivo,sans-serif';
      ctx.fillText(`Epoch ${x.e + 1} · image ${x.pos} of ${x.n} · ${fmtDay(x.im.mjd)} ${mjdDate(x.im.mjd).toISOString().slice(11, 16)} UTC · ${lamOf(x.im).toFixed(2)} µm${S.frames.get(x.im.url) ? '' : fr ? ' (still loading: showing this pass\'s first image)' : ' (loading)'}`, W / 2 - 190, 110);
    }
    else if (S.mode === 'time') { drawImg(T, fa && fa.canvas); S.shownFr = fa; rings(withEp(A, a), 'rgba(255,176,90,.9)', null, a > 0 ? withEp(moversOf(0), 0) : null); }
    else if (S.mode === 'blink') {
      const flip = reduce ? S.flipped : Math.floor(ts / 700) % 2;
      drawImg(T, (flip ? fb : fa) && (flip ? fb : fa).canvas); S.shownFr = flip ? fb : fa;
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
      if (d && S.cv === 'st') {   // the sky as usual, dimmed, with an icon per change
        const fb2 = fb || fa; drawImg(T, fb2 && fb2.canvas);
        ctx.save(); ctx.setTransform(dpr * T.a, dpr * T.b, dpr * T.c, dpr * T.d, dpr * T.e, dpr * T.f); ctx.fillStyle = 'rgba(5,7,15,.45)'; ctx.fillRect(0, 0, S.field.n, S.field.n); ctx.restore();
        drawChgStory(T);
      } else if (d) { drawImg(T, S.cv === 'im' ? d.imCv : d.epCv); drawChangePeaks(T); }
      else drawImg(T, fa && fa.canvas);
    } else if (S.mode === 'px') {
      drawImg(T, S.px.res && S.px.cv ? S.px.cv : diffCanvas(fa, fb)); drawPx(T);
    }
    drawComp(T);   // v0.55 U3: the detector colour composite over the view, when on
    const f = S.field, c = (f.n - 1) / 2;   // footprint outline
    ctx.save(); ctx.setTransform(dpr * T.a, dpr * T.b, dpr * T.c, dpr * T.d, dpr * T.e, dpr * T.f);
    ctx.strokeStyle = 'rgba(159,176,220,.45)'; ctx.lineWidth = 1 / Math.max(0.0001, Math.hypot(T.a, T.b)); ctx.strokeRect(0, 0, f.n, f.n); ctx.restore();
    if (S.flagsOn && (S.mode === 'time' || S.mode === 'blink')) { const fc = flagCanvas(S.shownFr); if (fc) drawImg(T, fc); }
    drawTracks(); if (!MOVIE.on) { drawCands(); drawAsteroidPaths(); drawChallenge(); }   // v0.50: the film names its own movers
  }
  if (!allSky()) { drawGaia(); drawCw(); drawSpec(); if (MOVIE.on) drawMovie(); else { drawMeasTrack(); drawFrameFit(); drawMotionSearch(); drawDeep(); drawDiff(); drawScan(); } }   // v0.50: during the film only its own tracks   // v0.44: drawTrack, the measured track across passes; v0.46: drawFrameFit, every image
  const whole = allSky(); if (whole) drawAllSky(); else if (S.ecl) drawEcliptic();
  if (!whole && !MOVIE.on) drawCorners(er);
  { const si = $('skyinfo'), show = whole && !FLY.via; if (si && si.hidden === show) si.hidden = !show; }   // v0.57.13: not while a flight passes by the galactic centre   // v0.28.1: the map key only on the whole sky
  if (ts - lastTele > 150) { lastTele = ts; telemetry(); }
}
// the View range in the status bar; whether it fits is measured only when the text gets longer or the window changes
// (no layout read on every update). No room: it hides, and the corners of the view still give the limits.
const TELE = { fit: null, len: 0, txt: '', at: 0 };
function viewTele() {
  const v = $('vrng'); if (!v) return;
  const t = viewRange(), now = performance.now();
  if (t !== TELE.txt) { TELE.txt = t; v.textContent = t; }
  if (TELE.fit === null || t.length !== TELE.len || now - TELE.at > 2000) {   // the other fields (images, passes) grow as a field loads: look again every 2 s at most
    TELE.at = now;
    const tl = v.closest('.tele'), dt = v.previousElementSibling;
    v.style.display = dt.style.display = '';
    TELE.fit = !(tl && tl.scrollWidth > tl.clientWidth + 1); TELE.len = t.length;
    if (!TELE.fit) v.style.display = dt.style.display = 'none';
  }
}
function telemetry() {
  const [ra, dec] = S.al.getRaDec();
  $('ra').textContent = ra.toFixed(3) + '°'; $('dec').textContent = dec.toFixed(3) + '°'; $('zm').textContent = S.al.getFov()[0].toFixed(2) + '°'; viewTele();
  scaleBar();
}
// v0.25: a true angular scale in the eyepiece corner (the longest round length that fits in 150 px)
const SCALES = [[30 / 3600, '30″'], [1 / 60, '1′'], [2 / 60, '2′'], [5 / 60, '5′'], [10 / 60, '10′'], [15 / 60, '15′'], [0.5, '30′'], [1, '1°'], [2, '2°'], [5, '5°'], [10, '10°']];
function scaleBar() {
  const box = $('scl'); if (!box) return;
  const fov = S.al.getFov()[0], ppd = innerWidth / fov; let pick = null;
  for (const s of SCALES) if (s[0] * ppd <= 150) pick = s;
  box.classList.toggle('off', !pick || fov > 40 || pick[0] * ppd < 30);
  if (!pick) return;
  $('sclb').style.width = Math.round(pick[0] * ppd) + 'px'; $('scll').textContent = pick[1];
}
// v0.25: Clear view (desktop): the docks slide away so the whole window is sky; the button or the H key brings them back
function clearView(on) { document.body.classList.toggle('clearv', on); const b = $('clearv'); if (b) b.setAttribute('aria-pressed', String(on)); }
if ($('clearv')) $('clearv').onclick = () => clearView(!document.body.classList.contains('clearv'));
addEventListener('keydown', e => {
  if (e.key !== 'h' && e.key !== 'H' || e.ctrlKey || e.metaKey || e.altKey || (window.Tour && Tour.on) || (GAME && GAME.on)) return;
  if (e.target.closest && e.target.closest('input,select,textarea,dialog,[contenteditable]')) return;
  if (getComputedStyle($('clearv')).display === 'none') return;
  clearView(!document.body.classList.contains('clearv'));
});
// v0.55 U9: B = Blink (and back to the view before), like H for the clear view
addEventListener('keydown', e => {
  if (e.key !== 'b' && e.key !== 'B' || e.ctrlKey || e.metaKey || e.altKey || (window.Tour && Tour.on) || (GAME && GAME.on)) return;
  if (e.target.closest && e.target.closest('input,select,textarea,dialog,[contenteditable]')) return;
  if (!S.eps.length || S.lab) return;
  if (S.mode === 'blink') setMode(S.preBlink && S.preBlink !== 'blink' ? S.preBlink : 'time'); else { S.preBlink = S.mode; setMode('blink'); }
  toast(S.mode === 'blink' ? 'Blink: flipping between passes (B again to go back)' : 'Back to ' + ({ time: 'Time machine', swipe: 'Swipe', diff: 'Difference', change: 'Changes', px: 'Hide Planet X' }[S.mode] || S.mode), 2200);
});
/* ---------- v0.34 (Phase 2): data release, metadata, contamination flags, embed ---------- */
// The data release is part of every IRSA file path (.../spherex/qr2/level2/...): "QR2" = Quick Release 2.
const releaseOf = im => { const m = /\/spherex\/([a-z]+\d*)\//i.exec((im && im.url) || ''); return m ? m[1].toUpperCase() : null; };
function dataNote() {
  if (!S.images || !S.images.length) return '';
  const rel = [...new Set(S.images.map(releaseOf).filter(Boolean))], last = Math.max(...S.images.map(i => i.mjd));
  return ` Data: SPHEREx ${rel.length ? rel.join(' + ') : 'archive'} at NASA/IPAC IRSA, newest image here ${fmtDay(last)}.` + (S.search && S.search.frozen
    ? ' This test field keeps the image list its quoted numbers were measured on; NASA\'s newest release' + (NASA_REL ? ` (${NASA_REL.newest})` : '') + ' is one click away (Releases: Check for new data).'
    : ' The archive is asked live, so new releases appear without any change to ARCNAVE.');
}
// What the pipeline flagged in one image (counted in the image's own pixels, before it is put on the field grid)
function flagText(fr) {
  const m = fr && fr.mask; if (!m) return ' No flag information in this image.';
  return ` Flagged by the SPHEREx pipeline: ${m.area} pixels saturated or affected by glare/ghosts (left out), ${m.glitch} bad single pixels such as cosmic-ray hits (${m.filled} repaired from neighbours)` +
    (m.outlierOnly ? `, of which ${m.outlierOnly} marked only as "outlier" (also set on moving asteroids)` : '') + '.';
}
// Contamination flags drawn on the image on screen: orange = flagged bad (saturation, glare, ghosts, cosmic rays, hot pixels;
// left out or repaired), violet = pipeline "outlier" only (a cosmic ray, or a moving object). From the masks the app already
// uses (the per-bit type is not kept after the masks are put on the field grid, so the two groups are what can be shown).
S.flagsOn = false;
function flagCanvas(fr) {
  if (!fr || !fr.touched) return null;
  if (fr.flagCv && fr.flagCvSrc === fr.flat) return fr.flagCv;
  const n = S.field.n, rgba = new Uint8ClampedArray(n * n * 4), t = fr.touched, hd = fr.touchedHard || fr.touched;
  for (let i = 0; i < n * n; i++) {
    if (!(t[i] > 0.1)) continue;   // the 0/1 masks were interpolated onto the field grid: one bad pixel spreads over ~4
    const o = i * 4, c = hd[i] > 0.1 ? [255, 150, 40] : [185, 140, 255];
    rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 190;
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = n; cv.getContext('2d').putImageData(new ImageData(rgba, n, n), 0, 0);
  fr.flagCv = cv; fr.flagCvSrc = fr.flat; return cv;
}
/* v0.55 U6: flags at a mover's own position, pass by pass. pos: [{ e, x, y }] on the field grid (where it is in pass e).
   Every loaded image of the pass is looked at in the 3x3 pixels around that place (one SPHEREx pixel either way: the masks
   were interpolated onto the field grid, so one bad pixel spreads a little). hard = a "bad" flag (saturation, glare, ghost,
   cosmic ray, hot pixel: left out or repaired), soft = the pipeline's "outlier" alone, which a moving object itself causes. */
function flagsAt(pos) {
  const n = S.field.n;
  return pos.map(({ e, x, y }) => {
    const X = Math.round(x), Y = Math.round(y); if (X < 1 || Y < 1 || X > n - 2 || Y > n - 2) return null;
    let k = 0, hard = 0, soft = 0;
    for (const im of epochImgs(e)) { const fr = S.frames.get(im.url); if (!fr || !fr.touched) continue;
      const t = fr.touched, hd = fr.touchedHard || fr.touched, c = Y * n + X; if (!(fr.flat[c] === fr.flat[c]) && !(t[c] > 0.1)) continue;   // off this image
      k++; let hh = false, ss = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const p = c + dy * n + dx; if (hd[p] > 0.1) hh = true; else if (t[p] > 0.1) ss = true; }
      if (hh) hard++; else if (ss) soft++; }
    return k ? { e, n: k, hard, soft } : null; }).filter(Boolean);
}
// a catalogue object's place in every pass on screen
const posOf = o => S.eps.map((_, e) => { const p = F.skyToGrid(...ctAt(o, epMid(e)), cardGrid()); return p && { e, x: p[0], y: p[1] }; }).filter(Boolean);
function flagRow(pos) {
  const r = S.field ? flagsAt(pos) : []; if (!r.length) return null;
  const bad = r.filter(q => q.hard), out = r.filter(q => !q.hard && q.soft), N = r.length;
  const txt = bad.length
    ? `${bad.length} of ${N} passes have flagged pixels at this position (${bad.map(q => `pass ${q.e + 1}: ${q.hard} of ${q.n} image${q.n === 1 ? '' : 's'}`).join('; ')}): saturation, glare, a ghost, a cosmic ray or a hot pixel. Those pixels are left out of the measurement` +
      (bad.some(q => q.hard > q.n / 2) ? '; in a pass where most images are flagged here, the position rests on the star\'s wings: treat it with care.' : '.')
    : `No flagged pixels at this position in any of the ${N} passes.`;
  return h('p', { class: 'flagrow' + (bad.length ? ' warn' : '') }, h('b', {}, bad.length ? '⚠ Flags: ' : '✓ Flags: '), txt +
    (out.length ? ` ${out.length} pass${out.length === 1 ? '' : 'es'} mark${out.length === 1 ? 's' : ''} it only as a pipeline "outlier", which a moving object itself causes.` : ''));
}
function updateLabels() {
  $('bo').textContent = S.band.toFixed(2) + ' µm'; $('dcard').hidden = !S.eps.length;
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
    `Image at this spot: ${lamOf(im).toFixed(3)} µm (${how}, detector ${im.det}), taken ${fmtDay(im.mjd)}${releaseOf(im) ? `, release ${releaseOf(im)}` : ''}.${cov}${pair}` +
    (S.flagsOn ? flagText(fr) : '');
}

/* ---------- picking and the mover card ---------- */
function pickAt(x, y) {
  if (S.specArm) { specClick(x, y); return; }
  if (S.mode === 'px' && !S.lab && S.report && pxClick(x, y)) return;
  let best = null, bd = 26;
  for (const h_ of S.hits) { const d = Math.hypot(h_.x - x, h_.y - y); if (d < bd) { bd = d; best = h_; } }
  if (best && best.sky) { const k = best.sky; if (k.ex) runExample(k.ex); else runAgents({ ra: k.ra, dec: k.dec, label: k.label }); return; }
  if (best) { if (best.sc) scTrack(best.sc, best.scn); else if (best.df) dfTrack(best.df, best.dfn); else if (best.ds) dsTrack(best.ds, best.dsn); else if (best.ms) msTrack(best.ms, best.msn); else if (best.cand) showCand(best.cand); else if (best.ast) showAsteroid(best.ast); else if (best.unk) showUnknown(best.unk); else if (best.ctid) showChallenge(best.ctid); else if (best.spec) { S.sel = { spec: true }; showSpectrum(); } else if (best.gaia) showGaia(best.gaia); else if (best.cw) showCw(best.cw); else if (best.chg) showChange(best.chg); else showMover(best); } else { S.sel = null; showList(); }
}
function showList() {
  const c = $('card'); c.replaceChildren();
  if (!S.eps.length) { c.hidden = true; return; }
  const { b } = view(), set = moversOf(b); c.hidden = false;
  c.append(h('h3', {}, 'Known movers'), S.report ? h('button', { onclick: showReport }, 'Agent report') : null);
  if (!set || set.loading) { c.append(h('p', {}, 'Asking SkyBoT (or the Minor Planet Center if SkyBoT is unreachable)...')); return; }
  if (set.err) { c.append(h('p', {}, 'Unavailable: ' + set.err)); return; }
  c.append(h('p', {}, `${set.items.length} known solar-system object${set.items.length === 1 ? '' : 's'} in this field at ${fmtDay(set.mjd)}. Rings do not guarantee a visible detection.`), ...(set.src === 'MPC' ? [h('p', { style: 'font-size:.78rem;color:var(--dust)' }, MPC_NOTE)] : []));
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
    h('button', { class: 'hbtn', id: 'trk', onclick: () => drawTrack(it) }, 'Draw JPL Horizons track'), ' ', h('button', { class: 'cardb', onclick: makeCard }, 'Discovery card (GIF)'), ' ', h('button', { onclick: () => { S.sel = null; showList(); } }, 'All movers'));
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
  changeSt: 'Every spot that changed, sorted into plain kinds: ☄ known asteroid passing by, ✦ a star got brighter, ? not explained yet. Detector glitches are counted but hidden. Tap a kind below to step through its spots.',
  change: 'Every epoch in its own colour. What never changed adds up to white; a coloured spot is only in that epoch.',
  px: 'Hide a FAKE planet in these real images and see if the agents find it. Click the sky to choose the spot. A test of what SPHEREx could catch, not a search.',
  changeIm: 'Every image in a colour of time (violet first, red last). The unchanging sky is grey. A chain of coloured dots is something moving; a dashed yellow ring is a star that got brighter. Cosmic rays are left grey and only counted (faded bars).'
};
function setMode(m) {
  S.lab = m === 'lab'; if (!S.lab) S.mode = m;
  document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.m === m));
  $('help').textContent = m === 'change' && S.cv === 'im' ? helps.changeIm : m === 'change' && S.cv === 'st' ? helps.changeSt : (multi() && helps[m + 'M']) || helps[m]; $('swr').hidden = S.mode !== 'swipe'; $('sw').hidden = S.mode !== 'swipe';
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
// v0.14.1: the colour really changes. The images of a field are picked for one colour when it loads (S.slots); moving the
// slider used to only change the label, because those picked images were kept. Now letting go of the slider (or a preset)
// fetches the images at the new colour and the agents run again on them, so every view and the report use that colour.
$('band').oninput = e => { S.band = +e.target.value; $('bo').textContent = S.band.toFixed(2) + ' µm'; clearTimeout(spxFollow.t); spxFollow.t = setTimeout(spxFollow, 250); };
$('band').onchange = () => recolour();
document.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { S.band = +b.dataset.b; $('band').value = S.band; recolour(); });
/* v0.57.2: SPHEREx's own sky as the base layer: NASA's DR1 all-sky cube (IRSA, Nov 2026), 102 colours, served by this
   server as /hips/sphx<frame>. The frame follows the Color slider: the frame whose wavelength is nearest (the dichroic
   frames 50 and 51 are blank, so their neighbours are shown). */
// the 102 frame wavelengths (µm), from the cube's own properties (data_cube_crval3_arr)
const SPX_LAM = '0.753 0.771 0.790 0.809 0.828 0.848 0.868 0.889 0.910 0.932 0.955 0.978 1.001 1.025 1.050 1.075 1.102 1.113 1.139 1.167 1.195 1.224 1.254 1.284 1.315 1.346 1.378 1.412 1.446 1.481 1.517 1.554 1.592 1.631 1.656 1.695 1.735 1.775 1.818 1.861 1.905 1.949 1.995 2.041 2.089 2.139 2.189 2.240 2.292 2.345 2.399 2.445 2.506 2.575 2.646 2.719 2.794 2.871 2.951 3.033 3.118 3.204 3.293 3.383 3.476 3.570 3.667 3.768 3.833 3.867 3.901 3.935 3.970 4.005 4.040 4.076 4.112 4.148 4.184 4.220 4.257 4.294 4.331 4.368 4.405 4.435 4.467 4.500 4.533 4.566 4.600 4.635 4.669 4.704 4.739 4.773 4.808 4.843 4.879 4.915 4.951 4.988'.split(' ').map(Number);
function spxFrameFor(lam) {
  let best = 0; for (let f = 0; f < SPX_LAM.length; f++) if (f !== 50 && f !== 51 && Math.abs(SPX_LAM[f] - lam) < Math.abs(SPX_LAM[best] - lam)) best = f;
  return best;
}
let spxShown = null;
function setBaseSky(id) {
  const u = skyUrl(id);
  try { S.al.setBaseImageLayer(S.al.newImageSurvey ? S.al.newImageSurvey(u) : u); }
  catch (err) { try { S.al.setImageSurvey(u); } catch (e2) { toast('Could not switch the base sky.'); } }
}
function spxFollow() {
  if (!S.al || !$('survey') || $('survey').value !== 'spherex') { spxShown = null; return; }
  const f = spxFrameFor(S.band); if (f === spxShown) return; spxShown = f; setBaseSky('spherex');
}
function recolour() {
  spxFollow();
  updateLabels();
  if (!S.field || !S.eps.length) return;
  const now = S.slots.length && S.slots[0][0] ? lamRank(S.slots[0][0]) : null;
  if (now != null && Math.abs(now - S.band) < 0.02) return;   // already this colour
  toast(`Fetching the real SPHEREx images taken at ${S.band.toFixed(2)} µm. A colour seen for the first time comes from NASA's archive and can take a minute or two; after that it opens in seconds.`, 9000);
  runAgents({ ra: S.field.ra, dec: S.field.dec, label: `Same field at ${S.band.toFixed(2)} µm` }, { skipNav: true, keepMode: true, band: S.band });
}
$('load').onclick = () => { if (!S.al) return; if (allSky()) { toast('Zoom in on a spot first, or click a marker on the sky.'); return; } const [ra, dec] = S.al.getRaDec(); runAgents({ ra, dec, label: 'Current view' }, { skipNav: true }); };
$('csize').onchange = () => { if (S.field) toast('Press "Run agents here" to apply the new field size.'); };
$('ipe').onchange = e => {
  S.depth = +e.target.value; writeHash();
  if (S.field) runAgents({ ra: S.field.ra, dec: S.field.dec, label: 'Same field' }, { skipNav: true });
};
$('ecl').onclick = e => { S.ecl = !S.ecl; e.target.setAttribute('aria-pressed', S.ecl); };
$('survey').onchange = e => {
  if (e.target.value === 'spherex') { spxShown = null; spxFollow(); toast(`SPHEREx's own all-sky map (NASA DR1, 2026) at ${SPX_LAM[spxFrameFor(S.band)].toFixed(2)} µm: it follows the Color slider.`, 5000); return; }
  spxShown = null; setBaseSky(e.target.value);
};
// Real examples: the field below is bundled with the site (demo-cache), so they open in seconds even when IRSA is busy.
const EXAMPLES = {
  proof: { ra: 189.957, dec: -4.182, depth: 8, label: 'Example: a real asteroid', focus: 'asteroid' },
  false: { ra: 189.957, dec: -4.182, depth: 1, label: 'Example: a false alarm', focus: 'artefact' }
};
function runExample(id, more = {}) {
  const x = EXAMPLES[id]; if (!x || !S.al) return;
  S.depth = x.depth; $('ipe').value = x.depth;
  try { history.replaceState(null, '', '#ex=' + id); } catch { /* ignore */ }
  return runAgents({ ra: x.ra, dec: x.dec, label: x.label }, { focus: x.focus, ...more });   // the tour waits on it
}
/* ---------- v0.33: the five NASA challenge test targets ---------- */
// "Test your tool on Barnard's Star, Epsilon Indi B, WISE 0855, and variable stars RW Aurigae and R Draconis" (official
// challenge text). Positions and motions: Barnard's Star and Epsilon Indi A/B proper motions as listed on Wikipedia (Gaia DR3
// / Hipparcos values); Epsilon Indi B position: 2MASS, epoch 1999.855 (McCaughrean et al. 2004, A&A 413, 1029, Table 2);
// WISE 0855: WISE position of 2010 May 4 and proper motion (Luhman 2014, ApJ 786, L18; Wikipedia); RW Aur and R Dra: NED.
// res: what ARCNAVE measured on the real SPHEREx images on 2026-10-28 (8 colour-matched images per pass), misses included.
const CHALLENGE = {
  barnard: { name: "Barnard's Star", kind: 'motion', ra0: 269.452077, dec0: 4.693365, ep: 51544.5, pmra: -801.551, pmdec: 10362.394,
    what: 'A small red star 6 light years away, the fastest-moving star in our sky (10.4″ per year).',
    res: { badge: ['ok', '✓ Motion seen'], text: 'Between the first pass (Aug 2025) and the third (Aug 2026) it moved 9.7″, where its known motion predicts 10.2″ (a 6.15″ SPHEREx pixel is the scale). Five other bright stars in the same images moved 0 to 0.6″. Half-way (Mar 2026): 6.1″ measured, 5.9″ predicted.' } },
  epsindb: { name: 'Epsilon Indi B', kind: 'motion', band: 4.6, ra0: 331.04383, dec0: -56.782694, ep: 51491.54, pmra: 3981.977, pmdec: -2466.832, plx: 274.84,   // plx: Gaia DR3 for Epsilon Indi A, the same system (v0.46)
    companion: { name: 'Epsilon Indi A', ra0: 330.840223, dec0: -56.786256, ep: 51544.5, pmra: 3966.661, pmdec: -2536.192 },
    what: 'A pair of brown dwarfs (too small to shine like stars) orbiting the star Epsilon Indi A, 12 light years away. They move 4.7″ per year.',
    res: { badge: ['ok', '✓ Motion seen'], text: 'At 4.6 µm (brown dwarfs are bright there) it moved 4.4″ between Apr 2025 and Apr 2026, where its known motion predicts 4.7″. Over all four passes (Apr 2025 to Sep 2026, 515 days) the film (🎬 Animate) measures 4.3 ± 0.3″ a year south-east. Its parent star Epsilon Indi A, 6.5′ away in the same images, moved 5.3″ the same way (predicted 4.7″); four other bright stars moved 0 to 0.9″. The two brown dwarfs (0.7″ apart) are one dot to SPHEREx. Its spectrum (button below, about 40 s): brightest near 4.1 µm, with deep dips near 1.4 µm and from 2.3 to 3.6 µm where water and methane absorb, as expected for a cool brown dwarf; at J and H it matches 2MASS within 7 %.' } },
  // WISE 0855 needs every image at 4.4-5 um (43 in a 0.25 deg field) and a fit that separates it from a background object
  // 4-11" away (bg: its position measured on 24 images at 1.2 um, where WISE 0855 is invisible; scatter 0.6").
  wise0855: { name: 'WISE 0855−0714', kind: 'motion', band: 4.7, depth: 30, size: '0.25', center: [133.79513, -7.24515], bg: [133.758127, -7.241136],
    ra0: 133.795224, dec0: -7.245138, ep: 55320.4, pmra: -8123.7, pmdec: 673.2,
    what: 'The coldest brown dwarf known (about 0 °C), 7.4 light years away. It moves 8.1″ per year and is very faint except near 4.5 µm.',
    res: { badge: ['ok', '✓ Detected (faint)'], text: 'Too faint to see by eye in one image, but there. ARCNAVE used all 43 images at 4.4 to 5 µm (where it shines) and fitted two dots at once: a background object that does not move (4 to 11″ away, measured at 1.2 µm where WISE 0855 is invisible) and a dot moving along WISE 0855’s known path. The moving dot is found at 11.8σ (only 0.8 % of 261 random spots in the same images reach that). Letting the motion vary (in steps of 2″ per year), the best fit is 8″ per year west, 2″ north: its known motion is 8.1″ west, 0.7″ north; a dot that does not move fits worse. At 1.2 µm the moving dot is absent, as it must be. Its brightness, 0.50 mJy (AB 17.15), matches what WISE measured (W2 13.9, about AB 17.2). Its 2010 position, 2′ away, is empty.' } },
  rwaur: { name: 'RW Aurigae', kind: 'variable', lc: 4.0, ra0: 76.9564535, dec0: 30.4013327,
    what: 'A young star still surrounded by its dusty disk. It brightens and fades, sometimes by several magnitudes when dust passes in front.',
    res: { badge: ['ok', '✓ Change seen'], text: 'Too bright for SPHEREx at almost every colour: its centre is saturated in 104 of 109 images of one pass, so ARCNAVE measures its outer glow (a ring 13 to 26″ from the centre). Measured on 30 Oct 2026 at six separate colours from 3.9 to 4.8 µm (49 different images), it faded in every one of them: from Sep 2025 to Sep 2026 by 0.74 mag on average (0.59 to 0.92 mag per colour; average of each pass −0.30, −0.01 and +0.44 mag: brighter, average, fainter), about 10 times the uncertainty of that average (0.07 mag). Comparison stars measured the same way in the same images scatter by 0.13 mag (median). The Light curve button shows one of the six colours (4.0 µm). Method note: an earlier version reported +0.19 mag measured on the saturated centre; withdrawn on 29 Oct 2026.' } },
  rdra: { name: 'R Draconis', kind: 'variable', band: 0.85, lc: 0.85, ra0: 248.167472, dec0: 66.7549882,
    what: 'A pulsating red giant (Mira-type variable) that brightens and fades over about eight months.',
    res: { badge: ['ok', '✓ Change seen'], text: 'Too bright for SPHEREx: its centre is saturated in every image, so ARCNAVE measures its outer glow (a ring 13 to 26″ from the centre). Measured on 30 Oct 2026 at three separate colours, 0.75, 0.80 and 0.85 µm (25 clean images), all three show the same pulse: bright in mid-July 2025, 1.1 to 1.3 mag fainter in October 2025, then 0.8 to 1.4 mag brighter again by 14 Nov 2025. Steady comparison stars measured the same way scatter by 0.10 to 0.13 mag. At 0.9 µm and redder even the glow is too bright to measure cleanly (images a few days apart disagree), so those colours are not used; in 2026 the glow is too bright at these colours too. Near the ecliptic pole SPHEREx sees it all year (2454 images, split into three 6-month passes). Method note: an earlier version reported 0.33 to 0.35 mag measured on the saturated centre; withdrawn on 29 Oct 2026.' } }
};
// Where a moving target should be at a given date (proper motion only; parallax under 0.6″ is ignored)
function ctAt(t, mjd) { if (t.ep == null || !t.pmra) return [t.ra0, t.dec0]; const dy = (mjd - t.ep) / 365.25; return [t.ra0 + t.pmra / 3.6e6 * dy / Math.cos(t.dec0 * Math.PI / 180), t.dec0 + t.pmdec / 3.6e6 * dy]; }
const epMid = e => { const m = epochImgs(e).map(i => i.mjd).sort((a, b) => a - b); return m[m.length >> 1]; };
function runChallenge(id) {
  const t = CHALLENGE[id]; if (!t || !S.al) return;
  S.depth = t.depth || 8; $('ipe').value = 8; $('csize').value = t.size || '0.5';
  try { history.replaceState(null, '', '#ct=' + id); } catch { /* ignore */ }
  const p = t.center || ctAt(t, 61040);
  return runAgents({ ra: +p[0].toFixed(5), dec: +p[1].toFixed(5), label: 'NASA challenge target: ' + t.name }, { focus: 'ct:' + id, ct: id, ...(t.band ? { band: t.band } : {}) });
}
// The motion measured live on the images on screen: the target's patch in the last pass is slid over the first pass until
// they match (whole-pixel steps of 0.1, brightness scaled), after the images were lined up on the stars.
function ctShift(pa, pb, A, B, H = 7) {
  const n = S.field.n, cx = Math.round((pa[0] + pb[0]) / 2), cy = Math.round((pa[1] + pb[1]) / 2);
  const at = (fr, x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0; if (x0 < 0 || y0 < 0 || x0 + 1 >= n || y0 + 1 >= n) return NaN; const v = fr.flat, m = fr.st.med;
    return (v[y0 * n + x0] - m) * (1 - fx) * (1 - fy) + (v[y0 * n + x0 + 1] - m) * fx * (1 - fy) + (v[(y0 + 1) * n + x0] - m) * (1 - fx) * fy + (v[(y0 + 1) * n + x0 + 1] - m) * fx * fy; };
  let best = null;
  for (let dy = -4; dy <= 4.001; dy += 0.1) for (let dx = -4; dx <= 4.001; dx += 0.1) {
    let sab = 0, sbb = 0, saa = 0, np = 0;
    for (let j = -H; j <= H; j++) for (let i = -H; i <= H; i++) { const a = A.flat[(cy + j) * n + cx + i] - A.st.med, b = at(B, cx + i + dx, cy + j + dy); if (!Number.isFinite(a) || !Number.isFinite(b)) continue; sab += a * b; sbb += b * b; saa += a * a; np++; }
    const sc = sab / sbb, chi = saa - 2 * sc * sab + sc * sc * sbb; if (np > H * H && (!best || chi < best.chi)) best = { dx, dy, chi };
  }
  return best;
}
function ctMeasure(id) {
  const t = CHALLENGE[id]; if (!t || t.kind !== 'motion' || S.eps.length < 2) return null;
  const E = S.eps.length - 1, A = frameOf(0), B = frameOf(E); if (!A || !B) return null;
  const f = S.field, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, arc = PX * 3600;
  const one = o => { const pa = F.skyToGrid(...ctAt(o, epMid(0)), grid), pb = F.skyToGrid(...ctAt(o, epMid(E)), grid); if (!pa || !pb) return null; const b = ctShift(pa, pb, A, B); if (!b) return null;
    return { meas: Math.hypot(b.dx, b.dy) * arc, pred: Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * arc, diff: Math.hypot(b.dx - (pb[0] - pa[0]), b.dy - (pb[1] - pa[1])) * arc }; };
  return { me: one(t), comp: t.companion ? one(t.companion) : null, days: epMid(E) - epMid(0) };
}
// WISE 0855, live: a fixed dot at t.bg and a dot on the known path are fitted together on every loaded image (Gaussian PSF,
// sigma 0.75 px measured on bright stars at 4.6 um; a constant per image). Returns the moving dot's flux and its formal S/N.
function ctTwoSource(t, R = 4, s = 0.75) {
  const f = S.field, g = { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, n = f.n, pb = F.skyToGrid(t.bg[0], t.bg[1], g); if (!pb) return null;
  const psf = (dx, dy) => { let v = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const x = dx + a / 3, y = dy + b / 3; v += Math.exp(-(x * x + y * y) / (2 * s * s)); } return v / (9 * 2 * Math.PI * s * s); };
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, used = 0;
  for (let e = 0; e < S.eps.length; e++) for (const im of epochImgs(e)) {
    const fr = S.frames.get(im.url); if (!fr) continue;
    const pw = F.skyToGrid(...ctAt(t, im.mjd), g); if (!pw) continue;
    const cx = Math.round((pb[0] + pw[0]) / 2), cy = Math.round((pb[1] + pw[1]) / 2), rows = [];
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const X = cx + i, Y = cy + j; if (X < 0 || Y < 0 || X >= n || Y >= n) continue; const d = fr.flat[Y * n + X]; if (Number.isFinite(d)) rows.push([psf(X - pb[0], Y - pb[1]), psf(X - pw[0], Y - pw[1]), d]); }
    if (rows.length < 40) continue;
    const m = [0, 1, 2].map(k => rows.reduce((a, r) => a + r[k], 0) / rows.length), w = 1 / fr.st.sigma ** 2;
    for (const r of rows) { const p = r[0] - m[0], q = r[1] - m[1], d = r[2] - m[2]; a11 += w * p * p; a12 += w * p * q; a22 += w * q * q; b1 += w * p * d; b2 += w * q * d; }
    used++;
  }
  const det = a11 * a22 - a12 * a12; if (!(used > 5 && det > 0)) return null;
  const W = (a11 * b2 - a12 * b1) / det, sW = Math.sqrt(a11 / det), sr = (PX * Math.PI / 180) ** 2;   // image unit MJy/sr; PSF sums to 1
  const jy = W * 1e6 * sr;
  return { used, snr: W / sW, mJy: jy * 1e3, ab: jy > 0 ? -2.5 * Math.log10(jy / 3631) : null };
}
function showChallenge(id) {
  const t = CHALLENGE[id]; if (!t) return;
  S.sel = { ct: id }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const live = t.kind === 'motion' && t.res.badge[0] === 'ok' && !t.bg ? ctMeasure(id) : null, two = t.bg && S.eps.length ? ctTwoSource(t) : null;
  const pos = ctAt(t, S.eps.length ? epMid(S.eps.length - 1) : 61040), q = `${pos[0].toFixed(5)} ${pos[1] >= 0 ? '+' : ''}${pos[1].toFixed(5)}`;
  c.append(h('h3', {}, t.name), h('span', { class: 'badge ' + t.res.badge[0] }, t.res.badge[1]),
    h('p', {}, h('b', {}, 'NASA challenge target. '), t.what),
    h('p', {}, h('b', {}, 'What SPHEREx shows: '), t.res.text),
    ...(live && live.me ? [h('p', {}, h('b', {}, 'Measured just now on these images: '), `moved ${live.me.meas.toFixed(1)}″ in ${Math.round(live.days)} days; its known motion predicts ${live.me.pred.toFixed(1)}″` +
      (live.comp ? `. ${t.companion.name}: ${live.comp.meas.toFixed(1)}″ (predicted ${live.comp.pred.toFixed(1)}″)` : '') + '.')] : []),
    ...(two ? [h('p', {}, h('b', {}, 'Measured just now on these images: '), `moving dot ${two.mJy.toFixed(2)} mJy` + (two.ab ? ` (AB ${two.ab.toFixed(2)})` : '') +
      `, formal S/N ${two.snr.toFixed(1)} from ${two.used} images (formal S/N is about twice the calibrated one, because neighbouring pixels share noise).`)] : []),
    h('p', { class: 'legend' }, t.kind === 'motion' ? 'Cyan ring: where its known motion puts it in the pass on screen. Use Blink or Time machine to watch it shift against the stars.' : 'Cyan ring: the star. Use Time machine to flip through the passes.'),
    h('p', { style: 'font-size:.8rem' }, 'Check it yourself: ', h('a', { href: 'https://aladin.cds.unistra.fr/AladinLite/?target=' + encodeURIComponent(q) + '&fov=0.1', target: '_blank', rel: 'noopener' }, 'Aladin sky atlas'), ' (Gaia, WISE, 2MASS at this spot).'),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'Measured by ARCNAVE on real NASA SPHEREx images (IRSA), 2026-10-28. Not a new discovery.'),
    ...(t.pmra && S.eps.length > 1 ? [h('button', { class: 'hbtn', onclick: () => replayAcross(t, t.name, () => showChallenge(id)) }, '▶ Track its motion across passes'), ' '] : []),
    h('button', { class: t.pmra && S.eps.length > 1 ? '' : 'hbtn', onclick: () => { S.al.gotoRaDec(pos[0], pos[1]); S.al.setFov(0.1); setMode('blink'); } }, 'Watch it in Blink'), ' ',
    h('button', { onclick: () => spectrumAt(pos[0], pos[1], { name: t.name, posAt: m => ctAt(t, m) }) }, 'Its spectrum'), ' ',
    ...(t.lc ? [h('button', { onclick: () => spectrumAt(pos[0], pos[1], { name: t.name, posAt: m => ctAt(t, m), lcOnly: t.lc }) }, `Light curve at ${t.lc} µm`), ' '] : []),
    h('button', { onclick: showReport }, 'Back to report'));
}
// Cyan ring at the target's expected spot in the pass on screen
function drawChallenge() {
  const t = S.ct && CHALLENGE[S.ct]; if (!t || !S.eps.length) return;
  let e = S.ei || 0; if (S.mode === 'time' || S.mode === 'blink') { const x = S.mode === 'time' ? seqAt() : null; if (x) e = x.e; }
  const p = ctAt(t, epMid(Math.min(e, S.eps.length - 1))), q = proj(p[0], p[1]); if (!q) return;
  ctx.strokeStyle = ctx.fillStyle = '#5fe3f0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q[0], q[1], 18, 0, 7); ctx.stroke();
  ctx.font = '600 12px Archivo,sans-serif'; ctx.fillText(t.name, q[0] + 22, q[1] + 4);
  S.hits.push({ x: q[0], y: q[1], ctid: S.ct });
}
/* ---------- v0.35: spectrum on the fly ----------
   SPHEREx's filters change colour across each detector, so a star lands on a different colour in every image of a pass:
   ~120 images of one pass = the star's brightness at ~100 colours, 0.75 to 5 µm. For one star ARCNAVE reads only ~15 rows
   of each file from NASA's S3 copy (lib/spot.js) and measures it with simple aperture photometry. 2MASS and AllWISE
   magnitudes of the same star (IRSA) are drawn on the same chart as a check. Not the official SPHEREx catalogue. */
const SPEC = { run: 0, memo: {}, sp: null };
// Vega zero points: 2MASS (Cohen et al. 2003), WISE (Wright et al. 2010; Jarrett et al. 2011). [band, µm, Jy, half-width µm]
const CATBANDS = [['J', 1.235, 1594, 0.08], ['H', 1.662, 1024, 0.1], ['K', 2.159, 666.7, 0.13], ['W1', 3.353, 309.54, 0.25], ['W2', 4.603, 171.787, 0.3]];
// Why a colour was left out, in plain words, from the FLAGS bits on the star (bit numbers as in QR2 and QR3 files)
const FLAGWHY = [[[1, 15], 'saturated (too bright)'], [[22, 23, 24, 26, 28], 'glare or a ghost of a bright star'], [[0, 19, 27], 'a cosmic-ray hit or glitch'],
  [[17], 'afterglow of an earlier bright star'], [[6, 10, 11], 'a faulty detector pixel'], [[2, 9], 'data lost on board']];
const flagWhy = bits => { for (const [bs, w] of FLAGWHY) if (bs.some(b => (bits >>> b) & 1)) return w; return 'a flagged pixel'; };
const passCol = e => ['#ffb347', '#b98cff', '#5fe3f0'][e % 3];   // pass 1 orange, 2 violet, 3 cyan
// v0.43: and a shape per pass (circle, square, triangle), so the passes do not depend on colour alone
const passShape = e => ['circle', 'square', 'triangle'][e % 3];
const passShapeCss = e => ['border-radius:50%', 'border-radius:1px', 'clip-path:polygon(50% 0,100% 100%,0 100%);border-radius:0'][e % 3];
// the card is wider while it shows a spectrum chart
new MutationObserver(() => $('card').classList.toggle('wide', !!$('card').querySelector('.specsvg, .deepw'))).observe($('card'), { childList: true });
function specPassLabel(sp, e) { const ep = sp.eps[e]; return `Pass ${e + 1}, ${fmtMonth(ep.t0)}`; }
async function spectrumAt(ra, dec, opts = {}) {
  const mine = ++SPEC.run;
  const sp = SPEC.sp = { ra, dec, name: opts.name || null, posAt: opts.posAt || (() => [ra, dec]), passes: new Map(), cat: null, eps: null, lc: null, msg: 'Looking up SPHEREx images of this star...' };
  S.sel = { spec: true }; showSpectrum(); refreshSoon();
  if (!window.SkySpot || !window.S3Cut) { sp.msg = 'Spectra need lib/spot.js; reload the page.'; showSpectrum(); return; }
  // the field's own image list when the star is inside the loaded field (no new archive search), else a search at the star
  let imgs = null;
  if (S.field && S.images.length && Math.hypot((ra - S.field.ra) * Math.cos(dec * Math.PI / 180), dec - S.field.dec) < S.field.size * 0.45) imgs = S.images;
  else { try { imgs = (await api(searchUrl(ra, dec))).images; } catch (e) { if (mine === SPEC.run) { sp.msg = 'IRSA search failed: ' + e.message; showSpectrum(); } return; } }
  if (mine !== SPEC.run) return;
  sp.eps = groupEpochs(imgs);
  if (!sp.eps.length) { sp.msg = 'No SPHEREx images cover this spot yet.'; showSpectrum(); return; }
  if (opts.lcOnly) { sp.msg = null; sp.lcOnly = true; await lightCurve(sp, opts.lcOnly, mine, opts.lcForce || null); return; }
  // catalogue positions are of their own dates: 2MASS about 2000, AllWISE about 2010 (matters for fast-moving stars)
  const pc = sp.posAt(51544.5), pw = sp.posAt(55400), same = Math.hypot(pc[0] - pw[0], pc[1] - pw[1]) * 3600 < 2;
  const ask = p => api(`/api/photcat?ra=${p[0].toFixed(5)}&dec=${p[1].toFixed(5)}&r=12`);
  Promise.all(same ? [ask(pc)] : [ask(pc), ask(pw)]).then(([a, b]) => { if (mine === SPEC.run) { const c2 = catMatch(a, pc[0], pc[1]), c3 = b ? catMatch(b, pw[0], pw[1]) : c2;
      sp.cat = { tm: c2.tm, wi: c3.wi, pts: [...c2.pts.filter(p => !/^W/.test(p.b)), ...c3.pts.filter(p => /^W/.test(p.b))], via: a.via, neighbours: Math.max(c2.neighbours, c3.neighbours) }; showSpectrum(); } })
    .catch(e => { if (mine === SPEC.run) { sp.cat = { err: e.message }; showSpectrum(); } });
  // default: the latest pass that is (nearly) complete; a pass still being observed has gaps in its colours
  const most = Math.max(...sp.eps.map(ep => ep.imgs.length)); let e0 = sp.eps.length - 1; while (e0 > 0 && sp.eps[e0].imgs.length < 0.9 * most) e0--;
  await specPass(sp, opts.ep != null ? Math.min(opts.ep, sp.eps.length - 1) : e0, mine);
}
// 2MASS / AllWISE brightness at the star: the nearest source within 6″ (catalogue positions are about 2000 and 2010, so fast
// stars may sit further away) PLUS every other source within 9″ of it. SPHEREx's 6″ pixels and 15″ aperture see such
// neighbours as one star (live check: a K 11.9 star with a K 12.8 neighbour 5″ away came out 1.40× its own 2MASS flux;
// the pair together predicts 1.44×), so the check compares like with like.
function catMatch(c, ra, dec) {
  const sepTo = (o, r0, d0) => Math.hypot((o.ra - r0) * Math.cos(d0 * Math.PI / 180), o.dec - d0) * 3600;
  const best = (list, lim) => { let b = null; for (const o of list || []) { const s = sepTo(o, ra, dec); if (s <= lim && (!b || s < b.sep)) b = Object.assign({ sep: s }, o); } return b; };
  const tm = best(c.twomass, 6), wi = best(c.wise, 6), pts = [];
  const add = (main, list, bands) => {
    if (!main) return 0;
    const group = (list || []).filter(o => sepTo(o, main.ra, main.dec) <= 9);
    for (const b of bands) {
      const z = CATBANDS.find(x => x[0] === b), fl = group.map(o => o[b]).filter(m => m != null).map(m => z[2] * 10 ** (-0.4 * m) * 1e3);
      if (main[b] != null) pts.push({ b, m: main[b], lam: z[1], hw: z[3], mJy: fl.reduce((a, v) => a + v, 0), n: fl.length });
    }
    return group.length - 1;
  };
  const nTm = add(tm, c.twomass, ['J', 'H', 'K']), nWi = add(wi, c.wise, ['W1', 'W2']);
  return { tm, wi, pts, via: c.via, neighbours: Math.max(nTm, nWi) };
}
async function specPass(sp, e, mine) {
  if (sp.passes.has(e)) return;
  const imgs = sp.eps[e].imgs, P = { e, n: imgs.length, done: 0, pts: [], bad: 0, why: {}, off: 0, fail: 0, t0: performance.now() };
  sp.passes.set(e, P); sp.msg = null; showSpectrum();
  const q = imgs.slice(), bm = F.badFlagMask(null).mask; let last = 0;
  const worker = async () => {
    while (q.length && mine === SPEC.run) {
      const im = q.shift();
      try {
        const u = S3Cut.s3Url(im.url); if (!u) throw new Error('not on S3');
        const url = S3B.hosts[0] + u.slice(S3B.hosts[0].length), alt = S3B.hosts[1] + u.slice(S3B.hosts[0].length), [ra, dec] = sp.posAt(im.mjd);
        const s = await SkySpot.spot((a, b) => s3Get(url, a, b, alt), url, ra, dec, 7, SPEC.memo, bm);
        const ph = SkySpot.photometry(s);
        if (ph.ok && s.lam) P.pts.push({ lam: s.lam, bw: s.bw, mJy: ph.mJy, err: ph.err, mjd: im.mjd, det: im.det, flags: !!s.bad });
        else { P.bad++; const w = ph.bits ? flagWhy(ph.bits) : 'pixels missing'; P.why[w] = (P.why[w] || 0) + 1; }
      } catch (err) { if (err.status === 404) P.off++; else P.fail++; }
      P.done++;
      if (performance.now() - last > 400) { last = performance.now(); if (mine === SPEC.run) showSpectrum(); }
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  P.sec = (performance.now() - P.t0) / 1000; P.finished = true;
  if (mine === SPEC.run) showSpectrum();
}
const specMed = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
// SPHEREx / catalogue ratio near each catalogue band (median of the SPHEREx points within the band's half-width)
function catCheck(sp, P) {
  if (!sp.cat || !sp.cat.pts) return [];
  return sp.cat.pts.map(c => { const near = P.pts.filter(p => Math.abs(p.lam - c.lam) <= c.hw && p.mJy > 3 * p.err).map(p => p.mJy); return near.length >= 2 ? { b: c.b, ratio: specMed(near) / c.mJy, n: near.length } : null; }).filter(Boolean);
}
function specSvg(sp) {
  const W_ = 360, H_ = 210, L = 44, R = 10, T = 10, B = 30, x0 = 0.7, x1 = 5.1;
  const all = []; for (const P of sp.passes.values()) for (const p of P.pts) if (p.mJy > 0) all.push(p.mJy);
  if (sp.cat && sp.cat.pts) for (const c of sp.cat.pts) all.push(c.mJy);
  const ns = 'http://www.w3.org/2000/svg', el = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = el('svg', { viewBox: `0 0 ${W_} ${H_}`, class: 'specsvg', role: 'img', 'aria-label': 'Spectrum: brightness in millijansky against wavelength in microns' });
  if (!all.length) return svg;
  let lo = Math.log10(Math.min(...all)) - 0.15, hi = Math.log10(Math.max(...all)) + 0.15; if (hi - lo < 1) { const m = (hi + lo) / 2; lo = m - 0.5; hi = m + 0.5; }
  const X = l => L + (l - x0) / (x1 - x0) * (W_ - L - R), Y = f => T + (hi - Math.log10(Math.max(f, 10 ** lo))) / (hi - lo) * (H_ - T - B);
  const ax = 'rgba(200,210,230,.35)', tx = { fill: 'rgba(220,228,240,.8)', 'font-size': 10, 'font-family': 'Archivo,sans-serif' };
  svg.append(el('rect', { x: L, y: T, width: W_ - L - R, height: H_ - T - B, fill: 'none', stroke: ax }));
  for (let l = 1; l <= 5; l++) { svg.append(el('line', { x1: X(l), x2: X(l), y1: H_ - B, y2: H_ - B + 4, stroke: ax })); const t = el('text', { x: X(l), y: H_ - B + 15, 'text-anchor': 'middle', ...tx }); t.textContent = l; svg.append(t); }
  const xl = el('text', { x: (L + W_ - R) / 2, y: H_ - 3, 'text-anchor': 'middle', ...tx }); xl.textContent = 'wavelength (µm)'; svg.append(xl);
  for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) for (const m of [1, 2, 5]) { const v = m * 10 ** k, lv = Math.log10(v); if (lv < lo || lv > hi) continue;
    svg.append(el('line', { x1: L - 4, x2: L, y1: Y(v), y2: Y(v), stroke: ax })); const t = el('text', { x: L - 6, y: Y(v) + 3, 'text-anchor': 'end', ...tx }); t.textContent = v >= 1 ? +v.toPrecision(2) : v.toPrecision(1); svg.append(t); }
  const yl = el('text', { x: 10, y: (T + H_ - B) / 2, transform: `rotate(-90 10 ${(T + H_ - B) / 2})`, 'text-anchor': 'middle', ...tx }); yl.textContent = 'brightness (mJy)'; svg.append(yl);
  for (const [e, P] of sp.passes) {
    const col = passCol(e);
    for (const p of P.pts) {
      const x = X(p.lam), good = p.mJy > 3 * p.err;
      if (p.mJy > 0) svg.append(el('line', { x1: x, x2: x, y1: Y(p.mJy + p.err), y2: Y(Math.max(p.mJy - p.err, 10 ** lo)), stroke: col, 'stroke-opacity': 0.5 }));
      const y = p.mJy > 0 ? Y(p.mJy) : 0, sh = passShape(e), paint = { fill: good ? col : 'none', stroke: col };
      const dot = !(p.mJy > 0) ? el('path', { d: `M${x - 3},${H_ - B - 6}l3,5l3,-5z`, fill: 'none', stroke: col })
        : sh === 'square' ? el('rect', { x: x - 2.2, y: y - 2.2, width: 4.4, height: 4.4, ...paint })
        : sh === 'triangle' ? el('path', { d: `M${x},${y - 3}l2.8,5h-5.6z`, ...paint })
        : el('circle', { cx: x, cy: y, r: 2.3, ...paint });
      // v0.40: the point's own numbers, for the hover/tap readout and screen readers (markup only, nothing measured differently)
      dot.setAttribute('data-v', `${p.lam.toFixed(2)} µm · ${p.mJy > 0 ? p.mJy.toPrecision(3) : 'below 0'} ± ${p.err.toPrecision(2)} mJy${good ? '' : ' (under 3× the noise)'} · pass ${e + 1}, ${fmtDay(p.mjd)}`);
      const ti = el('title', {}); ti.textContent = dot.getAttribute('data-v'); dot.append(ti); svg.append(dot);
    }
  }
  if (sp.cat && sp.cat.pts) for (const c of sp.cat.pts) { const x = X(c.lam), y = Y(c.mJy);
    svg.append(el('path', { d: `M${x},${y - 5}l5,5l-5,5l-5,-5z`, fill: 'none', stroke: '#fff', 'stroke-width': 1.5 }));
    const t = el('text', { x, y: y - 8, 'text-anchor': 'middle', ...tx, fill: '#fff' }); t.textContent = c.b; svg.append(t); }
  return svg;
}
/* ---------- v0.37: light curves (Phase 5) ----------
   The star's brightness over time at ONE colour: every image of every pass in which the star lands where the filter passes
   that colour (predicted from the archive footprint and the detector's wavelength map, then measured exactly), up to 36
   spread over time. Three slow Gaia stars nearby are measured in the same images: they should stay flat, so their scatter
   shows how far the measurement can be trusted. Saturated images are counted, not plotted (for a variable star that is
   itself a sign it was brighter then). */
async function lcTable(det) {
  for (const k of Object.keys(SPEC.memo)) if (k.endsWith(':' + String(det).replace(/\D/g, ''))) { try { const L = await SPEC.memo[k]; if (L && L.table) return L.table; } catch { /* next */ } }
  return TABLES[det] || null;
}
async function lightCurve(sp, lam0, mine = SPEC.run, force = null) {   // force 'wing': test the wing method on an unsaturated star
  const LC = sp.lc = { lam: lam0, pts: [], wpts: [], comps: [], mode: 'core', done: 0, n: 0, sat: 0, bad: 0, status: 'Choosing the images at ' + lam0.toFixed(2) + ' µm...' };
  showSpectrum();
  const all = sp.eps.flatMap(ep => ep.imgs), dets = [...new Set(all.map(im => im.det))];
  // teach the wavelength map of each detector that can see this colour (one star read each)
  for (const det of dets) {
    const ims = all.filter(im => im.det === det && lam0 >= im.lam0 - 0.02 && lam0 <= im.lam1 + 0.02); if (!ims.length) continue;
    if (!(await lcTable(det))) { const im = ims[0], u = S3Cut.s3Url(im.url); if (!u) continue; const url = S3B.hosts[0] + u.slice(S3B.hosts[0].length);
      try { await SkySpot.spot((a, b) => s3Get(url, a, b), url, ...sp.posAt(im.mjd), 7, SPEC.memo, 0); } catch { /* skip */ } }
  }
  if (mine !== SPEC.run) return;
  const cand = [];
  for (const im of all) {
    if (!(lam0 >= im.lam0 - 0.02 && lam0 <= im.lam1 + 0.02) || !im.poly) continue;
    const t = await lcTable(im.det); if (!t) continue;
    const [ra, dec] = sp.posAt(im.mjd), pos = SkyWave.detPosFromPoly(im.poly, ra, dec); if (!pos) continue;
    const w = SkyWave.lamAtDetector(t, pos.x, pos.y); if (w && !w.outside && Math.abs(w.lam - lam0) <= 0.012 * lam0) cand.push(im);
  }
  cand.sort((a, b) => a.mjd - b.mjd);
  let use = cand; const MAX = 36;
  if (cand.length > MAX) { use = []; for (let k = 0; k < MAX; k++) use.push(cand[Math.round(k * (cand.length - 1) / (MAX - 1))]); use = [...new Set(use)]; }
  LC.n = use.length; LC.found = cand.length;
  if (!use.length) { LC.status = `No images put this star at ${lam0.toFixed(2)} µm.`; showSpectrum(); return; }
  // comparison stars: slow Gaia stars 1.5′ to 7′ away, not too bright
  try {
    // the brightest slow stars within 15′ (G 8.5 or fainter): bright enough that their noise does not hide the method's own
    // scatter (tested on R Draconis: comparison stars of G 12.5 to 13.6 scattered 0.3 to 1.5 mag in the outer-glow method,
    // pure noise; a G 9.4 star 8′ away scattered 0.10 mag, which is the method's real limit)
    const g = await api(`/api/gaia?ra=${sp.ra.toFixed(5)}&dec=${sp.dec.toFixed(5)}&r=0.25&g=13`);
    LC.comps = g.stars.filter(o => o.pmra != null && gPm(o) < 0.05 && o.g > 8.5 && Math.hypot((o.ra - sp.ra) * Math.cos(sp.dec * Math.PI / 180), o.dec - sp.dec) > 1.5 / 60 && Math.hypot((o.ra - sp.ra) * Math.cos(sp.dec * Math.PI / 180), o.dec - sp.dec) < 0.25)
      .sort((a, b) => a.g - b.g).slice(0, 3).map(o => ({ s: o, pts: [], wpts: [] }));
  } catch { LC.comps = []; }
  if (mine !== SPEC.run) return;
  LC.status = null; showSpectrum();
  const bm = F.badFlagMask(null).mask, q = use.slice(); let last = 0;
  // every star is measured two ways from the same pixels: the usual aperture, and the "wing" ring 2.2 to 4.2 pixels (for a
  // saturated centre); the way that works for the target in most images is used for all stars at the end
  const one = async (url, ra, dec) => { const s = await SkySpot.spot((a, b) => s3Get(url, a, b), url, ra, dec, 7, SPEC.memo, bm, 5);
    // in the wing, TRANSIENT and SUR_ERROR (bits 0, 2) are what a very bright star does to the up-the-ramp fit next to a
    // saturated centre (seen on R Draconis: 5 to 26 of 39 ring pixels, all with finite values); they are kept there
    const wm = (bm & ~5) >>> 0, sw = s.flags ? Object.assign({}, s, { bad: Uint8Array.from(s.flags, v => ((v & wm) >>> 0) ? 1 : 0) }) : s;
    return { s, ph: SkySpot.photometry(s), pw: SkySpot.photometry(sw, 4.2, 5, 7, 6.15, 2.2) }; };
  const worker = async () => {
    while (q.length && mine === SPEC.run) {
      const im = q.shift();
      try {
        const u = S3Cut.s3Url(im.url), url = S3B.hosts[0] + u.slice(S3B.hosts[0].length);
        const [t, ...cs] = await Promise.all([one(url, ...sp.posAt(im.mjd)), ...LC.comps.map(c => one(url, ...gAt(c.s, im.mjd)).catch(() => null))]);
        if (t.ph.ok) LC.pts.push({ mjd: im.mjd, lam: t.s.lam, mJy: t.ph.mJy, err: t.ph.err });
        else if ((t.ph.bits && flagWhy(t.ph.bits).startsWith('saturated')) || t.ph.badIn) LC.sat++; else LC.bad++;
        if (t.pw.ok) LC.wpts.push({ mjd: im.mjd, lam: t.s.lam, mJy: t.pw.mJy, err: t.pw.err });
        cs.forEach((r, k) => { if (r && r.ph.ok) LC.comps[k].pts.push({ mjd: im.mjd, mJy: r.ph.mJy, err: r.ph.err }); if (r && r.pw.ok) LC.comps[k].wpts.push({ mjd: im.mjd, mJy: r.pw.mJy, err: r.pw.err }); });
      } catch { LC.bad++; }
      LC.done++;
      if (performance.now() - last > 500) { last = performance.now(); if (mine === SPEC.run) showSpectrum(); }
    }
  };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: 6 }, worker));
  LC.sec = (performance.now() - t0) / 1000; LC.finished = true;
  LC.corePts = LC.pts.length;
  if (force === 'wing' || (LC.pts.length < 0.5 * LC.done && LC.wpts.length >= Math.max(5, 2 * LC.pts.length))) {   // saturated in most images: wing photometry for every star
    LC.mode = 'wing'; LC.pts = LC.wpts; LC.comps.forEach(c => { c.pts = c.wpts; });
  }
  if (mine === SPEC.run) showSpectrum();
}
// magnitudes relative to each star's own median (brighter = up)
const lcMags = pts => { const m = specMed(pts.filter(p => p.mJy > 0).map(p => p.mJy)); return pts.filter(p => p.mJy > 0).map(p => ({ mjd: p.mjd, dm: -2.5 * Math.log10(p.mJy / m), e: 1.0857 * p.err / p.mJy })); };
const lcStd = a => { if (a.length < 3) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
// v0.55 U1: is the change bigger than the error bars? Chi-squared of a star about its weighted mean, each error bar widened
// in quadrature by a floor s (mag) ...
const lcChi = (m, s = 0) => { if (m.length < 3) return null; const w = m.map(p => 1 / (Math.max(p.e, 1e-4) ** 2 + s * s)), W = w.reduce((a, b) => a + b, 0), mu = m.reduce((a, p, i) => a + w[i] * p.dm, 0) / W;
  return { chi: m.reduce((a, p, i) => a + w[i] * (p.dm - mu) ** 2, 0), k: m.length - 1 }; };
// ... the floor that makes a steady star's chi-squared per degree of freedom 1: the method's own error the error bars leave out
// (flat field, image sharpness, pointing), the same in magnitudes for a bright star and a faint one ...
const lcFloor = m => { const c = lcChi(m); if (!c || c.chi <= c.k) return c ? 0 : null; let lo = 0, hi = 2;
  for (let i = 0; i < 40; i++) { const s = (lo + hi) / 2; if (lcChi(m, s).chi > c.k) lo = s; else hi = s; } return (lo + hi) / 2; };
// ... turned into an equivalent one-sided Gaussian sigma (Wilson-Hilferty cube-root approximation)
const chiSigma = (chi, k) => { const v = 2 / (9 * k); return ((chi / k) ** (1 / 3) - (1 - v)) / Math.sqrt(v); };
// the floor is measured on the comparison stars (steady, same images, same method; median, so one odd star does not set it)
function lcVerdict(LC) {
  const tm = lcMags(LC.pts), t0 = lcChi(tm); if (!t0) return null;
  const fl = LC.comps.map(c => lcFloor(lcMags(c.pts))).filter(v => v != null), sys = fl.length ? specMed(fl) : 0, t = lcChi(tm, sys);
  return { raw: t0.chi / t0.k, red: t.chi / t.k, sys, floors: fl, sig: chiSigma(t.chi, t.k), k: t.k, nComp: fl.length };
}
// the detectors that saw this spot, with the wavelengths their images cover (from the image list itself)
const lcDets = sp => { const m = new Map();
  for (const im of sp.eps.flatMap(ep => ep.imgs)) { if (!(im.lam0 > 0 && im.lam1 > 0)) continue; const d = m.get(im.det) || { det: im.det, lo: 99, hi: 0 }; d.lo = Math.min(d.lo, im.lam0); d.hi = Math.max(d.hi, im.lam1); m.set(im.det, d); }
  return [...m.values()].sort((a, b) => a.lo - b.lo).map(d => ({ ...d, mid: (d.lo + d.hi) / 2 })); };
function lcSvg(LC) {
  const W_ = 360, H_ = 180, L = 44, R = 10, T = 10, B = 30;
  const tgt = lcMags(LC.pts), comps = LC.comps.map(c => lcMags(c.pts)), all = [...tgt, ...comps.flat()];
  const ns = 'http://www.w3.org/2000/svg', el = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = el('svg', { viewBox: `0 0 ${W_} ${H_}`, class: 'specsvg', role: 'img', 'aria-label': 'Light curve: change in brightness (magnitudes) against date' });
  if (!all.length) return svg;
  const t0 = Math.min(...all.map(p => p.mjd)) - 10, t1 = Math.max(...all.map(p => p.mjd)) + 10;
  let lo = Math.min(-0.1, ...all.map(p => p.dm)), hi = Math.max(0.1, ...all.map(p => p.dm)); const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const X = t => L + (t - t0) / (t1 - t0) * (W_ - L - R), Y = dm => T + (dm - lo) / (hi - lo) * (H_ - T - B);   // brighter (negative dm) up
  const ax = 'rgba(200,210,230,.35)', tx = { fill: 'rgba(220,228,240,.8)', 'font-size': 10, 'font-family': 'Archivo,sans-serif' };
  svg.append(el('rect', { x: L, y: T, width: W_ - L - R, height: H_ - T - B, fill: 'none', stroke: ax }), el('line', { x1: L, x2: W_ - R, y1: Y(0), y2: Y(0), stroke: ax, 'stroke-dasharray': '3 3' }));
  const step = (hi - lo) > 1.5 ? 0.5 : (hi - lo) > 0.6 ? 0.2 : 0.1;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { const t = el('text', { x: L - 5, y: Y(v) + 3, 'text-anchor': 'end', ...tx }); t.textContent = (v > 0.001 ? '+' : v < -0.001 ? '−' : '') + Math.abs(v).toFixed(step < 0.2 ? 1 : 1); svg.append(t); }
  const d0 = mjdDate(t0), d1 = mjdDate(t1);
  for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1; ; m += 3) { const d = new Date(Date.UTC(y, m, 1)); if (d > d1) break; const mj = d.getTime() / 864e5 + 40587; if (mj < t0) continue;
    const t = el('text', { x: X(mj), y: H_ - B + 14, 'text-anchor': 'middle', ...tx }); t.textContent = d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }) + (d.getUTCMonth() < 3 ? " '" + String(d.getUTCFullYear()).slice(2) : ''); svg.append(t); }
  const yl = el('text', { x: 10, y: (T + H_ - B) / 2, transform: `rotate(-90 10 ${(T + H_ - B) / 2})`, 'text-anchor': 'middle', ...tx }); yl.textContent = 'brighter ↑  (mag)'; svg.append(yl);
  // v0.40: each point carries its own numbers for the hover/tap readout and screen readers (markup only)
  const sgn = v => (v > 0.0005 ? '+' : v < -0.0005 ? '−' : '') + Math.abs(v).toFixed(2);
  const val = (c, v) => { c.setAttribute('data-v', v); const ti = el('title', {}); ti.textContent = v; c.append(ti); return c; };
  comps.forEach((cp, k) => cp.forEach(p => svg.append(el('line', { x1: X(p.mjd), x2: X(p.mjd), y1: Y(p.dm - p.e), y2: Y(p.dm + p.e), stroke: 'rgba(190,198,215,.5)' }), val(el('circle', { cx: X(p.mjd), cy: Y(p.dm), r: 2.1, fill: 'none', stroke: 'rgba(190,198,215,.85)', 'stroke-width': 1.1 }), `Comparison star ${k + 1} · ${fmtDay(p.mjd)} · ${sgn(p.dm)} ± ${p.e.toFixed(2)} mag`))));
  for (const p of tgt) { svg.append(el('line', { x1: X(p.mjd), x2: X(p.mjd), y1: Y(p.dm - p.e), y2: Y(p.dm + p.e), stroke: '#ff6bd6', 'stroke-opacity': 0.6 })); svg.append(val(el('circle', { cx: X(p.mjd), cy: Y(p.dm), r: 2.8, fill: '#ff6bd6' }), `This star · ${fmtDay(p.mjd)} · ${sgn(p.dm)} ± ${p.e.toFixed(2)} mag`)); }
  return svg;
}
function lcBlock(sp) {
  const LC = sp.lc, out = [h('h3', { style: 'margin-top:.6rem;font-size:.95rem' }, `Light curve at ${LC.lam.toFixed(2)} µm`)];
  if (LC.status) { out.push(h('p', {}, LC.status)); return out; }
  out.push(lcSvg(LC), h('p', { class: 'flagleg' }, h('span', {}, h('i', { style: 'background:#ff6bd6;border-radius:50%' }), 'this star'), h('span', {}, h('i', { style: 'background:none;border:1.5px solid rgba(190,198,215,.9);border-radius:50%' }), `${LC.comps.length} comparison star${LC.comps.length === 1 ? '' : 's'} (Gaia, not variable as far as known)`)));
  if (!LC.finished) { out.push(h('p', {}, `Measuring ${LC.done} of ${LC.n} images (${LC.found} put it at this colour)...`)); return out; }
  const tg = lcMags(LC.pts), range = tg.length >= 2 ? Math.max(...tg.map(p => p.dm)) - Math.min(...tg.map(p => p.dm)) : null;
  const sd = lcStd(tg.map(p => p.dm)), csd = LC.comps.map(c => lcStd(lcMags(c.pts).map(p => p.dm))).filter(v => v != null), cMax = csd.length ? specMed(csd) : null;   // median: one noisy comparison star must not hide a real change
  const ext = tg.length ? [tg.reduce((a, b) => b.dm < a.dm ? b : a), tg.reduce((a, b) => b.dm > a.dm ? b : a)] : [];
  if (LC.mode === 'wing') out.push(h('p', {}, h('b', {}, 'Saturated centre: '), `the star is too bright for SPHEREx at this colour (its centre is blanked or overflowing in ${LC.sat} of ${LC.done} images), so ARCNAVE measured only its outer glow (a ring 13 to 26″ from the centre), where the pixels are fine. ` +
    'That ring holds a fixed share of the light only if the image sharpness stays the same, so the comparison stars are measured the same way: their scatter shows how far this can be trusted.'));
  out.push(h('p', {}, `${tg.length} images measured in ${Math.round(LC.sec)} s` + (LC.mode === 'wing' ? ' (outer glow)' : LC.sat ? `; ${LC.sat} saturated (too bright to measure: a variable star may simply have been brighter then)` : '') + (LC.bad ? `; ${LC.bad} with a bad pixel` : '') + '.'));
  if (range != null) out.push(h('p', {}, h('b', {}, 'Change: '), `${range.toFixed(2)} mag from faintest to brightest (brightest ${fmtDay(ext[0].mjd)}, faintest ${fmtDay(ext[1].mjd)}); scatter ${sd != null ? sd.toFixed(2) : '?'} mag. ` +
    (cMax != null ? `The comparison stars scatter by ${csd.map(v => v.toFixed(2)).join(', ')} mag (typical ${cMax.toFixed(2)}). ` : '') +
    (cMax != null && sd != null ? (sd > 3 * cMax && range > 0.15 ? 'It changes much more than they do: real variability.' : sd > 1.5 * cMax ? 'A little more than the comparison stars: possibly variable.' : 'About as steady as the comparison stars.') : '')));
  // v0.55 U1: the same question asked against the error bars: a chi-squared significance
  const V = lcVerdict(LC);
  if (V) { const s = V.sig >= 10 ? V.sig.toFixed(0) : Math.max(0, V.sig).toFixed(1);
    out.push(h('p', { class: 'lcsig' }, h('b', {}, 'Significance: '), V.sig >= 5 ? `Varies, at ${s}σ. ` : V.sig >= 3 ? `Probably varies (${s}σ). ` : `Steady within its error bars (${s}σ). `,
      `χ²/dof ${V.red.toFixed(1)} over ${V.k} degrees of freedom` + (V.nComp ? (V.sys > 0.0005 ? `, after adding ${V.sys.toFixed(3)} mag to every error bar: the scatter the comparison stars show beyond their own error bars (${V.floors.map(v => v.toFixed(3)).join(', ')} mag), which is the method's own limit (${V.raw.toFixed(1)} before).`
        : '; the comparison stars stay within their own error bars, so those were used as they are.') : '; no comparison star to check the error bars against, so this may overstate it.') + ' 5σ or more: a real change; under 3σ: no change shown.')); }
  // v0.55 U1: run it again through another detector (each sees a different stretch of colours)
  const dets = lcDets(sp);
  if (dets.length > 1) out.push(h('p', { class: 'lcdet' }, h('b', {}, 'Detector: '), ...dets.map(d => { const on = LC.lam >= d.lo && LC.lam <= d.hi, dn = String(d.det).replace(/^D?/, 'D');
    return [h('button', { type: 'button', 'aria-pressed': String(on), title: on ? `This light curve is from detector ${dn}` : `Light curve at ${d.mid.toFixed(2)} µm, the middle of detector ${dn}`,
      onclick: on ? null : () => lightCurve(sp, +d.mid.toFixed(2)) }, `${dn} · ${d.lo.toFixed(2)}–${d.hi.toFixed(2)} µm`), ' ']; })));
  out.push(h('p', { style: 'font-size:.78rem;color:var(--dust)' }, `Images in which the star falls where SPHEREx sees ${LC.lam.toFixed(2)} µm (±${(0.012 * LC.lam).toFixed(3)} µm), up to 36 spread over time; same simple aperture photometry as the spectrum.`));
  const csv = 'mjd,date,wavelength_um,flux_mJy,error_mJy\n' + LC.pts.slice().sort((a, b) => a.mjd - b.mjd).map(p => [p.mjd.toFixed(5), fmtDay(p.mjd), p.lam.toFixed(4), p.mJy.toFixed(4), p.err.toFixed(4)].join(',')).join('\n');
  out.push(h('p', { style: 'font-size:.8rem' }, h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `arcnave_lightcurve_${sp.ra.toFixed(4)}_${sp.dec.toFixed(4)}_${LC.lam.toFixed(2)}um.csv` }, 'Download the light curve (CSV)')));
  return out;
}
function showSpectrum() {
  const sp = SPEC.sp; if (!sp || !(S.sel && S.sel.spec)) return;
  const c = $('card'); c.replaceChildren(); c.hidden = false;
  const q = `${sp.ra.toFixed(5)} ${sp.dec >= 0 ? '+' : ''}${sp.dec.toFixed(5)}`;
  c.append(h('h3', {}, (sp.lcOnly ? 'Light curve of ' : 'Spectrum of ') + (sp.name || 'this star')), h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'RA, Dec ' + q));
  if (sp.msg) { c.append(h('p', {}, sp.msg)); return; }
  if (sp.lc) c.append(...lcBlock(sp));
  if (!sp.passes.size) { c.append(h('button', { onclick: () => { SPEC.run++; SPEC.sp = null; S.sel = null; S.report ? showReport() : (c.hidden = true); refreshSoon(); } }, 'Close')); return; }
  c.append(specSvg(sp));
  const leg = h('p', { class: 'flagleg' });
  for (const [e, P] of sp.passes) leg.append(h('span', {}, h('i', { style: `background:${passCol(e)};${passShapeCss(e)}` }), specPassLabel(sp, e) + (P.finished ? '' : ` (${P.done} of ${P.n})`)));
  if (sp.cat && sp.cat.pts && sp.cat.pts.length) leg.append(h('span', {}, h('i', { style: 'border:1.5px solid #fff;transform:rotate(45deg) scale(.8)' }), '2MASS / WISE'));
  c.append(leg);
  for (const [e, P] of sp.passes) {
    if (!P.finished) { c.append(h('p', {}, `Reading ${P.done} of ${P.n} SPHEREx images of ${specPassLabel(sp, e)} (only the few pixels around the star)...`)); continue; }
    const why = [P.bad && `${P.bad} with a bad pixel on the star: ` + Object.entries(P.why).sort((a, b) => b[1] - a[1]).map(([w, k]) => `${k} ${w}`).join(', '), P.off && `${P.off} where it falls just off the image`, P.fail && `${P.fail} that could not be read`].filter(Boolean).join(', ');
    c.append(h('p', {}, h('b', {}, specPassLabel(sp, e) + ': '), `${P.pts.length} colours measured from ${P.n} images in ${Math.round(P.sec)} s` + (why ? ` (left out: ${why})` : '') + '.'));
    if (P.pts.length < P.n * 0.3 && (P.why['saturated (too bright)'] || 0) > P.n * 0.4) c.append(h('p', {}, h('b', {}, 'Too bright for SPHEREx: '), 'the star’s centre is saturated or flagged in most images, so most colours cannot be measured. SPHEREx is built for fainter stars and galaxies.'));
    const good = P.pts.filter(p => p.mJy > 3 * p.err);
    if (good.length >= 5) { const top = good.reduce((a, b) => b.mJy > a.mJy ? b : a); c.append(h('p', {}, `Brightest near ${top.lam.toFixed(2)} µm (${top.mJy >= 10 ? top.mJy.toFixed(0) : top.mJy.toFixed(1)} mJy).`)); }
    else if (P.pts.length >= 5) c.append(h('p', {}, 'Too faint to measure well in single images (hollow dots: below 3 times the noise).'));
    if (good.length && !(sp.lc && !sp.lc.finished)) { const b = good.reduce((a, q) => q.mJy / q.err > a.mJy / a.err ? q : a);
      c.append(h('p', {}, h('button', { onclick: () => lightCurve(sp, +b.lam.toFixed(2)) }, `Light curve at ${b.lam.toFixed(2)} µm`), ' (its clearest colour: brightness over time, all passes)')); }
    const ck = catCheck(sp, P);
    if (ck.length) c.append(h('p', {}, h('b', {}, 'Check against other surveys: '), ck.map(k => `${k.b} ${k.ratio.toFixed(2)}×`).join(', ') +
      ' (SPHEREx ÷ 2MASS/WISE near the same colour; 1.00 = same brightness. Differences come from different filters, different dates, and this quick method).' +
      (sp.cat.neighbours ? ` The catalogue values include ${sp.cat.neighbours} neighbour${sp.cat.neighbours > 1 ? 's' : ''} within 9″, which SPHEREx sees as part of the same dot.` : '')));
  }
  const fin = [...sp.passes.values()].filter(P => P.finished && P.pts.length >= 10);
  if (fin.length >= 2) {   // same colours, different passes: did it change?
    const [A, B] = fin.slice(-2).sort((a, b) => a.e - b.e), rs = [];
    for (const p of B.pts) { const m = A.pts.filter(o => Math.abs(o.lam - p.lam) < 0.02 && o.mJy > 5 * o.err && p.mJy > 5 * p.err); if (m.length) rs.push(p.mJy / specMed(m.map(o => o.mJy))); }
    if (rs.length >= 5) { const r = specMed(rs); c.append(h('p', {}, h('b', {}, 'Change between passes: '), `${specPassLabel(sp, B.e)} ÷ ${specPassLabel(sp, A.e)} = ${r.toFixed(2)} (median of ${rs.length} matching colours; ${(2.5 * Math.log10(r)).toFixed(2)} mag). ` +
      (Math.abs(r - 1) < 0.05 ? 'About the same.' : r > 1 ? 'Brighter in the later pass.' : 'Fainter in the later pass.'))); }
  }
  if (sp.cat && sp.cat.err) c.append(h('p', { style: 'font-size:.8rem;color:var(--dust)' }, '2MASS/WISE check unavailable: ' + sp.cat.err));
  else if (sp.cat && !sp.cat.pts.length) c.append(h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'No 2MASS or WISE source within 6″ of this spot.'));
  const others = sp.eps ? sp.eps.map((_, e) => e).filter(e => !sp.passes.has(e)) : [];
  const busy = [...sp.passes.values()].some(P => !P.finished);
  if (others.length && !busy) c.append(h('p', {}, 'Compare with: ', ...others.map(e => h('button', { onclick: () => specPass(sp, e, SPEC.run) }, specPassLabel(sp, e))), ' (variable stars change between passes)'));
  c.append(h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'Each dot is one SPHEREx image: its filters change colour across the detector, so in every image of a pass the star is seen in a different colour. ' +
    'For reference: Sun-like stars are brightest at the short end and fade towards 5 µm; dusty young stars stay bright at long wavelengths; cool brown dwarfs are brightest near 4–5 µm with a dip near 3.3 µm (methane). ' +
    'Measured by ARCNAVE with simple aperture photometry on NASA SPHEREx images (IRSA); not the official SPHEREx spectra.'));
  const all = [...sp.passes.values()].flatMap(P => P.pts.map(p => ({ ...p, pass: P.e + 1 })));
  if (all.length && !busy) {
    const csv = 'pass,mjd,detector,wavelength_um,bandwidth_um,flux_mJy,error_mJy\n' + all.sort((a, b) => a.pass - b.pass || a.lam - b.lam).map(p => [p.pass, p.mjd.toFixed(5), p.det, p.lam.toFixed(4), (p.bw || 0).toFixed(4), p.mJy.toFixed(4), p.err.toFixed(4)].join(',')).join('\n');
    c.append(h('p', { style: 'font-size:.8rem' }, h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `arcnave_spectrum_${sp.ra.toFixed(4)}_${sp.dec.toFixed(4)}.csv` }, 'Download the numbers (CSV)'), ' · ',
      h('a', { href: 'https://aladin.cds.unistra.fr/AladinLite/?target=' + encodeURIComponent(q) + '&fov=0.05', target: '_blank', rel: 'noopener' }, 'This star in Aladin')));
  }
  c.append(h('button', { onclick: () => { SPEC.run++; SPEC.sp = null; S.sel = null; S.report ? showReport() : (c.hidden = true); refreshSoon(); } }, 'Close'));
}
// Magenta ring on the star being measured
function drawSpec() {
  const sp = SPEC.sp; if (!sp) return; const p = proj(sp.ra, sp.dec); if (!p) return;
  ctx.strokeStyle = '#ff6bd6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p[0], p[1], 12, 0, 7); ctx.stroke();
  S.hits.push({ x: p[0], y: p[1], spec: true });
}
// Tap on the sky with Spectrum armed: snap to the brightest pixel within 2 pixels in the image on screen, then measure.
function specClick(x, y) {
  let s = null; try { s = S.al.pix2world(x, y); } catch { s = null; }
  if (!s || !isFinite(s[0])) return;
  if ((S.al.getFov ? S.al.getFov()[0] : 1) > 3) { toast('Zoom in on a star first (to under 3°).'); return; }
  let [ra, dec] = s; const fr = S.shownFr || (S.eps.length ? frameOf(S.eps.length - 1) : null);
  if (S.field && fr && fr.flat) {
    const g = { ra0: S.field.ra, dec0: S.field.dec, s: S.field.s, n: S.field.n }, n = g.n, p = F.skyToGrid(ra, dec, g);
    if (p) { let bx = Math.round(p[0]), by = Math.round(p[1]), bv = -Infinity;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const X_ = Math.round(p[0]) + i, Y_ = Math.round(p[1]) + j; if (X_ < 1 || Y_ < 1 || X_ >= n - 1 || Y_ >= n - 1) continue; const v = fr.flat[Y_ * n + X_]; if (v > bv) { bv = v; bx = X_; by = Y_; } }
      let sw = 0, sx = 0, sy = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = fr.flat[(by + j) * n + bx + i] - fr.st.med; if (v > 0) { sw += v; sx += v * i; sy += v * j; } }
      if (sw > 0 && bv - fr.st.med > 5 * fr.st.sigma) [ra, dec] = F.gridToSky(bx + sx / sw, by + sy / sw, g); }
  }
  S.specArm = false; $('specb').setAttribute('aria-pressed', 'false');
  spectrumAt(ra, dec);
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
/* ---------- v0.36: Gaia DR3 overlay and a motion check for any star ----------
   "Overlay data from other telescopes (Gaia)": the field's Gaia DR3 stars (IRSA, via /api/gaia) are drawn where Gaia's
   proper motions put them at the date of the SPHEREx pass on screen, with an arrow = 20 years of motion for stars moving
   0.2″/yr or more. Tapping a Gaia star opens its card; for a star that should move at least 1.5″ between the first and last
   pass, "Measure its motion" runs the Barnard's Star method on it (last pass slid over the first) and on 5 slow stars of
   similar brightness as controls (Gaia motion under 0.02″/yr: they should come out near 0). */
const GAIA = { on: false, key: null, data: null, err: null, loading: false };
const G_EPOCH = 57388.5;   // J2016.0 as MJD
const gAt = (s, mjd) => ctAt({ ra0: s.ra, dec0: s.dec, ep: G_EPOCH, pmra: s.pmra || 0, pmdec: s.pmdec || 0 }, mjd);
const gPm = s => Math.hypot(s.pmra || 0, s.pmdec || 0) / 1000;   // arcsec per year
async function gaiaLoad() {
  const f = S.field; if (!f) return;
  // v0.56: a load in progress is awaited (it returned at once, so a search started then found no Gaia stars)
  const key = `${f.ra.toFixed(4)},${f.dec.toFixed(4)},${f.size}`; if (GAIA.key === key && (GAIA.data || GAIA.loading)) return GAIA.loadP;
  GAIA.key = key; GAIA.data = null; GAIA.err = null; GAIA.loading = true; updGaiaNote();
  GAIA.loadP = (async () => {
    try { const d = await api(`/api/gaia?ra=${f.ra.toFixed(5)}&dec=${f.dec.toFixed(5)}&r=${(f.size * 0.72).toFixed(3)}&g=18`); if (GAIA.key === key) GAIA.data = d; }
    catch (e) { if (GAIA.key === key) GAIA.err = e.message; }
    if (GAIA.key === key) GAIA.loading = false; updGaiaNote(); refreshSoon();
  })();
  return GAIA.loadP;
}
function updGaiaNote() {
  const n = $('gaialeg'); if (!n) return; n.hidden = !GAIA.on;
  const fast = GAIA.data ? GAIA.data.stars.filter(s => gPm(s) >= 0.2).length : 0;
  n.textContent = !S.field ? 'Gaia: open a patch of sky first.' : GAIA.loading ? 'Gaia: asking NASA/IPAC IRSA for the Gaia DR3 stars here...' : GAIA.err ? 'Gaia unavailable right now: ' + GAIA.err :
    GAIA.data ? `Gaia DR3 (ESA): ${GAIA.data.stars.length} stars brighter than G 18 here, ${fast} moving 0.2″/yr or more (arrow = where it goes in 20 years). Positions shown at the date of the pass on screen. Tap a star.` : '';
}
function gaiaEpochMjd() { if (!S.eps.length) return 61000; let e = S.ei || 0; if (S.mode === 'time' && S.seq.length) e = seqAt().e; return epMid(Math.min(e, S.eps.length - 1)); }
function drawGaia() {
  if (!GAIA.on || !GAIA.data || !S.field) return;
  const fov = S.al.getFov()[0], m = gaiaEpochMjd(), stars = GAIA.data.stars, gLim = fov > 1.5 ? 13 : fov > 0.6 ? 16 : 18;
  ctx.save(); ctx.lineWidth = 1.2;
  for (const s of stars) {
    const pm = gPm(s); if (s.g > gLim && pm < 0.2) continue;
    const p0 = gAt(s, m), q = proj(p0[0], p0[1]); if (!q || q[0] < -20 || q[1] < -20 || q[0] > W + 20 || q[1] > H + 20) continue;
    const fast = pm >= 0.2, r = Math.max(2.5, Math.min(7, 8 - s.g / 3));
    ctx.strokeStyle = fast ? 'rgba(125,255,154,.95)' : 'rgba(125,255,154,.45)';
    ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 7); ctx.stroke();
    if (fast) {
      const p1 = gAt(s, m + 20 * 365.25), q1 = proj(p1[0], p1[1]);
      if (q1) { const dx = q1[0] - q[0], dy = q1[1] - q[1], L = Math.hypot(dx, dy);
        if (L > 4) { ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q1[0], q1[1]); const a = Math.atan2(dy, dx);
          ctx.lineTo(q1[0] - 7 * Math.cos(a - 0.4), q1[1] - 7 * Math.sin(a - 0.4)); ctx.moveTo(q1[0], q1[1]); ctx.lineTo(q1[0] - 7 * Math.cos(a + 0.4), q1[1] - 7 * Math.sin(a + 0.4)); ctx.stroke(); } }
    }
    if (fast || s.g < 14) S.hits.push({ x: q[0], y: q[1], gaia: s });
  }
  ctx.restore();
}
// The Barnard's Star method on any object {ra0, dec0, ep, pmra, pmdec} (mas/yr), first vs last pass on screen
function motionOf(o) {
  if (S.eps.length < 2) return null;
  const E = S.eps.length - 1, A = frameOf(0), B = frameOf(E); if (!A || !B) return null;
  const f = S.field, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, arc = PX * 3600;
  const pa = F.skyToGrid(...ctAt(o, epMid(0)), grid), pb = F.skyToGrid(...ctAt(o, epMid(E)), grid);
  if (!pa || !pb || [pa, pb].some(p => p[0] < 12 || p[1] < 12 || p[0] > f.n - 13 || p[1] > f.n - 13)) return null;
  const b = ctShift(pa, pb, A, B); if (!b) return null;
  return { meas: Math.hypot(b.dx, b.dy) * arc, pred: Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * arc, diff: Math.hypot(b.dx - (pb[0] - pa[0]), b.dy - (pb[1] - pa[1])) * arc, days: epMid(E) - epMid(0) };
}
function gaiaObj(s) { return { ra0: s.ra, dec0: s.dec, ep: G_EPOCH, pmra: s.pmra || 0, pmdec: s.pmdec || 0, cat: 'Gaia DR3' }; }   // v0.55: cat names the catalogue for catRow
/* v0.55 U4: one row, the same in the Gaia, WISE, track and film cards: the motion SPHEREx measured next to the catalogue's,
   and whether they agree. The rule is the motion searches' own (cwMatch): a difference counts only above 3 times both errors
   combined, and never below 30 % of the catalogue motion or 0.5″/yr. o: { mu, smu, cat, catMu, catSmu, diff } in ″/yr
   (diff: the difference as a vector when known; otherwise the difference in size). */
// the comparison itself (also used by the film's CSV/JSON export, U5): result 'agrees' | 'differs' | 'unchecked'
function catCmp(o) {
  if (o.mu == null || o.catMu == null) return { k: 'unc', result: 'unchecked', diff: null, lim: null };
  const diff = o.diff != null ? o.diff : Math.abs(o.mu - o.catMu), lim = Math.max(3 * Math.hypot(o.smu || 0, o.catSmu || 0), 0.3 * o.catMu, 0.5);
  return { k: diff < lim ? 'ok' : 'near', result: diff < lim ? 'agrees' : 'differs', diff, lim };
}
function catRow(o) {
  const f2 = v => v.toFixed(2), me = o.mu == null ? null : `${f2(o.mu)}${o.smu != null ? ' ± ' + f2(o.smu) : ''}″/yr`;
  const cat = o.cat || 'catalogue', them = o.catMu == null ? null : `${f2(o.catMu)}${o.catSmu ? ' ± ' + f2(o.catSmu) : ''}″/yr`;
  const c = catCmp(o); let verdict, why = '';
  if (me == null) verdict = 'unchecked: SPHEREx could not measure it here';
  else if (them == null) verdict = `unchecked: ${cat === 'catalogue' ? 'no catalogue' : cat} motion to compare with`;
  else { verdict = c.result === 'agrees' ? '✓ agrees' : '≠ differs';
    why = ` (difference ${f2(c.diff)}″/yr; it counts above ${f2(c.lim)})` + (o.smu == null ? '; SPHEREx error not measured here' : ''); }
  return h('p', { class: 'catrow' }, h('b', {}, 'SPHEREx vs catalogue: '), `SPHEREx ${me || '–'} · ${cat} ${them || '–'} → `, h('span', { class: 'badge ' + c.k }, verdict), why);
}
// the error of a two-pass measurement (motionOf), from slow Gaia stars measured the same way: their shifts should be 0, so
// their scatter is the method's error (per direction: the shifts are sizes in 2-D, so divided by √2); null without them
const ctlSmu = (ctl, days) => ctl && ctl.length >= 2 ? Math.sqrt(ctl.reduce((a, x) => a + x.meas ** 2, 0) / ctl.length) / Math.SQRT2 / (days / 365.25) : null;
const slowCtl = (ra, dec) => (GAIA.data ? GAIA.data.stars : []).filter(o => o.pmra != null && gPm(o) < 0.02 && o.g < 16 && Math.hypot((o.ra - ra) * Math.cos(dec * Math.PI / 180), o.dec - dec) > 1 / 60)
  .sort((a, b) => a.g - b.g).map(o => motionOf(gaiaObj(o))).filter(Boolean).slice(0, 5);
function showGaia(s, res) {
  S.sel = { gaia: s }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const pm = gPm(s), dist = s.plx > 0 ? 1000 / s.plx : null, days = S.eps.length > 1 ? epMid(S.eps.length - 1) - epMid(0) : 0, mv = pm * days / 365.25;
  const p = gAt(s, gaiaEpochMjd()), q = `${p[0].toFixed(5)} ${p[1] >= 0 ? '+' : ''}${p[1].toFixed(5)}`;
  c.append(h('h3', {}, 'Gaia DR3 ' + s.id), h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'RA, Dec ' + q + ' (at the date of the pass on screen)'),
    h('p', {}, h('b', {}, 'Brightness: '), `G ${s.g.toFixed(1)} (Gaia's visible-light band)`),
    h('p', {}, h('b', {}, 'Distance: '), dist && s.plx > 0.5 ? `about ${(dist * 3.2616).toFixed(dist < 30 ? 1 : 0)} light years (parallax ${s.plx.toFixed(2)} mas)` : s.plx != null ? 'too far for Gaia to measure well (parallax ' + s.plx.toFixed(2) + ' mas)' : 'not measured'),
    h('p', {}, h('b', {}, 'Motion across the sky: '), s.pmra == null ? 'not measured by Gaia' : `${pm >= 0.1 ? pm.toFixed(2) : (pm * 1000).toFixed(1) + ' thousandths of'}″ per year` +
      (S.eps.length > 1 ? `; between the first and last SPHEREx pass (${Math.round(days)} days) ${mv.toFixed(2)}″, ${(mv / 6.15).toFixed(2)} of a SPHEREx pixel.` : '.')));
  if (res) c.append(res);
  else if (S.eps.length > 1 && mv >= 1.5) c.append(h('p', {}, 'That is enough to measure in SPHEREx. ', h('button', { class: 'hbtn', onclick: () => gaiaMeasure(s) }, 'Measure its motion')));
  else if (S.eps.length > 1 && s.pmra != null) c.append(h('p', { style: 'font-size:.85rem' }, `Too slow to see in SPHEREx: ${mv.toFixed(2)}″ is far below one 6.15″ pixel. Like most stars, it looks fixed between passes.`));
  if (S.eps.length > 1 && s.pmra != null && mv >= 1.5) c.append(h('p', {}, h('button', { class: 'hbtn', onclick: () => replayAcross(gaiaObj(s), 'Gaia DR3 ' + s.id, () => showGaia(s)) }, '▶ Track its motion across passes')));   // v0.41
  c.append(h('p', {}, h('button', { onclick: () => spectrumAt(p[0], p[1], { name: 'Gaia DR3 ' + s.id, posAt: m => gAt(s, m) }) }, 'Its spectrum'), ' ',
    h('a', { href: 'https://aladin.cds.unistra.fr/AladinLite/?target=' + encodeURIComponent(q) + '&fov=0.05', target: '_blank', rel: 'noopener', style: 'font-size:.85rem' }, 'Aladin'), ' ',
    h('button', { type: 'button', onclick: () => showElsewhere(p[0], p[1], 'Gaia DR3 ' + s.id) }, '🔗 Elsewhere')),
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'Gaia data: ESA Gaia DR3, from NASA/IPAC IRSA. Gaia positions are for 2016, moved here with Gaia’s own proper motion.'),
    h('button', { onclick: () => { S.sel = null; S.report ? showReport() : (c.hidden = true); } }, 'Close'));
  refreshSoon();
}
function gaiaMeasure(s) {
  const me = motionOf(gaiaObj(s));
  if (!me) { showGaia(s, h('p', {}, 'Could not measure here: the star is too close to the edge of the field, or the first and last pass have no image at this colour.')); return; }
  // controls: Gaia stars of similar brightness that hardly move, at least 1′ from the target and from the edges
  // (closest in brightness first; a very bright star may have no slow star within 2 magnitudes, so the nearest ones are used)
  const ctl = (GAIA.data ? GAIA.data.stars : []).filter(o => o !== s && o.pmra != null && gPm(o) < 0.02 && o.g < 16 && Math.hypot((o.ra - s.ra) * Math.cos(s.dec * Math.PI / 180), o.dec - s.dec) > 1 / 60)
    .sort((a, b) => Math.abs(a.g - s.g) - Math.abs(b.g - s.g)).map(o => { const m = motionOf(gaiaObj(o)); return m && Object.assign(m, { g: o.g }); }).filter(Boolean).slice(0, 5);
  const ok = Math.abs(me.meas - me.pred) < Math.max(1.5, 0.25 * me.pred) && me.diff < Math.max(2, 0.35 * me.pred);
  const cMax = ctl.length ? Math.max(...ctl.map(x => x.meas)) : null;
  showGaia(s, h('div', {},
    h('span', { class: 'badge ' + (ok ? 'ok' : 'unc') }, ok ? '✓ Motion seen' : 'Not clear'),
    h('p', {}, h('b', {}, 'Measured just now: '), `it moved ${me.meas.toFixed(1)}″ in ${Math.round(me.days)} days; Gaia predicts ${me.pred.toFixed(1)}″ (difference in direction and size: ${me.diff.toFixed(1)}″).`),
    catRow({ mu: me.meas / (me.days / 365.25), smu: ctlSmu(ctl, me.days), cat: 'Gaia DR3', catMu: me.pred / (me.days / 365.25), diff: me.diff / (me.days / 365.25) }),   // v0.55 U4
    flagRow(posOf(gaiaObj(s))),   // v0.55 U6
    h('p', {}, ctl.length ? `${ctl.length} slow stars (Gaia G ${ctl.map(x => x.g.toFixed(1)).join(', ')}), measured the same way, moved ${ctl.map(x => x.meas.toFixed(1)).join(', ')}″ (they should be near 0).` : 'No slow stars in this field to compare with.'),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'Method: the images are lined up on the stars; the star’s patch in the last pass is slid over the first until they match (steps of 0.1 pixel). ' +
      (!ok ? 'A bright neighbour, saturation or too few images can spoil it.' : '') + (cMax != null && cMax > me.meas / 2 ? ' The controls moved almost as much: treat this result with care.' : ''))));
}
$('gaiab').onclick = e => { GAIA.on = !GAIA.on; e.currentTarget.setAttribute('aria-pressed', GAIA.on); updGaiaNote(); if (GAIA.on) gaiaLoad(); refreshSoon(); };
/* ---------- v0.53: CatWISE2020 (WISE) overlay, rank 7 of the research report ----------
   "Overlay data from other telescopes (the WISE mission)". Gaia cannot see cold brown dwarfs: WISE 0855 is not in Gaia
   but is in CatWISE2020, which measured motions from WISE images of 2010-2018 (positions at MJD 57170 = 2015.4).
   Shown: movers (clean fit, motion ≥ 1″/yr and ≥ 5x its error, not in a halo group; arrow = 20 years) and very red sources (W1−W2 ≥ 0.8:
   the colour of cool brown dwarfs, and of quasars, which do not move). Quality cuts, tried on 4 fields (Barnard, WISE 0855,
   Epsilon Indi, Virgo): blends with 3+ components, unWISE artefact flags and S/N under 10 gave hundreds of fake fast
   movers next to bright stars; slower motions (0.3-0.9″/yr) are common in every field and below what SPHEREx sees. CatWISE
   lists some objects more than once (WISE 0855: 3 entries); entries within 12″ of a better one with a similar motion are one
   object. Also used to label the mover searches' finds that Gaia does not know (dsGaia). */
const CW = { on: false, key: null, data: null, err: null, loading: false, src: [] };
const CW_EPOCH = 57170;
const cwPm = s => Math.hypot(s.pmra || 0, s.pmdec || 0);   // arcsec per year
const cwSig = s => { const m = cwPm(s); return m > 0 ? Math.hypot(s.pmra * s.spmra, s.pmdec * s.spmdec) / m : Math.hypot(s.spmra || 0, s.spmdec || 0) / Math.SQRT2; };
const cwObj = s => ({ ra0: s.ra, dec0: s.dec, ep: CW_EPOCH, pmra: (s.pmra || 0) * 1000, pmdec: (s.pmdec || 0) * 1000, cat: 'CatWISE2020', catSmu: cwSig(s) });   // mas/yr, as ctAt wants; v0.55: cat, catSmu for catRow
const cwAt = (s, mjd) => ctAt(cwObj(s), mjd);
const cwClean = s => s.ab === '00' && s.nb <= 2 && s.snr >= 10;
const cwMover = s => cwClean(s) && !s.halo && cwPm(s) >= 1 && cwPm(s) >= 5 * cwSig(s);
const cwRed = s => cwClean(s) && !s.halo && !(s.twinOf && s.twinOf.halo) && s.w1 != null && s.w2 != null && s.w1 - s.w2 >= 0.8;
const cwSep = (a, b) => Math.hypot((a.ra - b.ra) * Math.cos(a.dec * Math.PI / 180), a.dec - b.dec) * 3600;
function cwPrepare(d) {
  const src = d.src.map(r => { const o = {}; d.cols.forEach((k, i) => o[k] = r[i]); return o; });
  // one object listed several times: keep the entry with the best S/N, the others point at it
  const mv = src.filter(s => cwPm(s) >= 0.5 && cwPm(s) >= 3 * cwSig(s)).sort((a, b) => b.snr - a.snr);
  for (let i = 0; i < mv.length; i++) { if (mv[i].twinOf) continue;
    // the same motion, or both fast (≥ 1″/yr): CatWISE splits a fast mover's smeared image into pieces (WISE 0855 also has
    // a 4th entry 10″ away at 5.6″/yr south-west), and two unrelated fast movers within 12″ are vanishingly rare
    for (let j = i + 1; j < mv.length; j++) if (!mv[j].twinOf && cwSep(mv[i], mv[j]) < 12 && (Math.hypot(mv[i].pmra - mv[j].pmra, mv[i].pmdec - mv[j].pmdec) < Math.max(1.5, 0.3 * cwPm(mv[i])) || (cwPm(mv[i]) >= 1 && cwPm(mv[j]) >= 1))) { mv[j].twinOf = mv[i]; (mv[i].twins = mv[i].twins || []).push(mv[j]); } }
  // a bright star's halo: real movers of 1″/yr or more are rare (rarely one per field), so 3 or more within 3′ of each other
  // are artefacts. Seen live: all 27 clean "fast movers" of the Epsilon Indi field lay 5-12′ from Epsilon Indi A (too bright
  // for CatWISE), and 9 around Barnard's Star; CatWISE's own artefact flags were clear on all of them
  const fast = src.filter(s => !s.twinOf && cwPm(s) >= 1 && cwPm(s) >= 3 * cwSig(s));
  for (const s of fast) if (fast.filter(o => o !== s && cwSep(o, s) < 180).length >= 2) s.halo = true;
  return src;
}
async function cwLoad() {
  const f = S.field; if (!f) return;
  const key = `${f.ra.toFixed(4)},${f.dec.toFixed(4)},${f.size}`; if (CW.key === key && (CW.data || CW.loading)) return CW.loading;
  CW.key = key; CW.data = null; CW.err = null; CW.src = []; updCwNote();
  CW.loading = (async () => {
    try { const d = await api(`/api/catwise?ra=${f.ra.toFixed(5)}&dec=${f.dec.toFixed(5)}&r=${(f.size * 0.72).toFixed(3)}`); if (CW.key === key) { CW.src = cwPrepare(d); CW.data = d; } }
    catch (e) { if (CW.key === key) CW.err = e.message; }
    if (CW.key === key) CW.loading = false; updCwNote(); refreshSoon();
  })();
  return CW.loading;
}
function updCwNote() {
  const n = $('cwleg'); if (!n) return; n.hidden = !CW.on;
  const days = S.eps.length > 1 ? epMid(S.eps.length - 1) - epMid(0) : 0, movers = CW.src.filter(s => cwMover(s) && !s.twinOf), red = CW.src.filter(s => cwRed(s) && !s.twinOf).length;
  const halo = CW.src.filter(s => s.halo && cwClean(s)).length;
  const fastTxt = days && movers.length ? `, ${movers.filter(s => cwPm(s) * days / 365.25 >= 1.5).length} of them fast enough for SPHEREx to see (1.5″ or more between the first and last pass)` : '';
  const haloTxt = halo ? ` (${halo} more left out: they sit in groups, as artefacts in a bright star's halo do, not real movers)` : '';
  n.textContent = !S.field ? 'WISE: open a patch of sky first.' : CW.loading ? 'WISE: asking NASA/IPAC IRSA for the CatWISE2020 sources here (about 20 s the first time)...' : CW.err ? 'WISE (CatWISE2020) unavailable right now: ' + CW.err :
    CW.data ? `CatWISE2020 (NASA WISE): ${CW.src.length} sources here; ${movers.length} moving 1″/yr or more (orange arrow = where it goes in 20 years)${fastTxt}${haloTxt}; ${red} very red in WISE's two bands (W1−W2 ≥ 0.8, pink diamond: a cool brown dwarf if it moves, often a quasar if not). Positions shown at the date of the pass on screen. Tap one.` : '';
}
function drawCw() {
  if (!CW.on || !CW.data || !S.field || CW.key !== `${S.field.ra.toFixed(4)},${S.field.dec.toFixed(4)},${S.field.size}`) return;
  const m = gaiaEpochMjd(), near = S.al.getFov()[0] < 1.2, grid = { ra0: S.field.ra, dec0: S.field.dec, s: S.field.s, n: S.field.n };   // the red sources (often ~100 per field) only when zoomed in
  ctx.save(); ctx.lineWidth = 1.4;
  for (const s of CW.src) {
    if (s.twinOf) continue;
    const mover = cwMover(s), red = cwRed(s); if (!mover && !(red && near)) continue;
    const p0 = cwAt(s, m), g = F.skyToGrid(p0[0], p0[1], grid); if (!g || g[0] < -0.5 || g[1] < -0.5 || g[0] > S.field.n - 0.5 || g[1] > S.field.n - 0.5) continue;   // on the SPHEREx field only
    const q = proj(p0[0], p0[1]); if (!q || q[0] < -20 || q[1] < -20 || q[0] > W + 20 || q[1] > H + 20) continue;
    ctx.strokeStyle = mover ? 'rgba(255,170,80,.95)' : 'rgba(255,140,220,.85)';
    const r = 5; ctx.beginPath(); ctx.moveTo(q[0], q[1] - r); ctx.lineTo(q[0] + r, q[1]); ctx.lineTo(q[0], q[1] + r); ctx.lineTo(q[0] - r, q[1]); ctx.closePath(); ctx.stroke();
    if (mover && red) { ctx.fillStyle = 'rgba(255,140,220,.5)'; ctx.fill(); }
    if (mover) {
      const p1 = cwAt(s, m + 20 * 365.25), q1 = proj(p1[0], p1[1]);
      if (q1) { const dx = q1[0] - q[0], dy = q1[1] - q[1], L = Math.hypot(dx, dy);
        if (L > 6) { ctx.beginPath(); ctx.moveTo(q[0] + dx / L * 6, q[1] + dy / L * 6); ctx.lineTo(q1[0], q1[1]); const a = Math.atan2(dy, dx);
          ctx.lineTo(q1[0] - 7 * Math.cos(a - 0.4), q1[1] - 7 * Math.sin(a - 0.4)); ctx.moveTo(q1[0], q1[1]); ctx.lineTo(q1[0] - 7 * Math.cos(a + 0.4), q1[1] - 7 * Math.sin(a + 0.4)); ctx.stroke(); } }
    }
    S.hits.push({ x: q[0], y: q[1], cw: s });
  }
  ctx.restore();
}
function showCw(s, res) {
  S.sel = { cw: s }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const pm = cwPm(s), sg = cwSig(s), days = S.eps.length > 1 ? epMid(S.eps.length - 1) - epMid(0) : 0, mv = pm * days / 365.25, col = s.w1 != null && s.w2 != null ? s.w1 - s.w2 : null;
  const p = cwAt(s, gaiaEpochMjd()), q = `${p[0].toFixed(5)} ${p[1] >= 0 ? '+' : ''}${p[1].toFixed(5)}`, nm = 'CatWISE ' + s.name;
  const sure = cwClean(s) && pm >= 5 * sg, gaiaNear = GAIA.data && GAIA.data.stars.find(g => { const g0 = gAt(g, gaiaEpochMjd()); return Math.hypot((g0[0] - p[0]) * Math.cos(p[1] * Math.PI / 180), g0[1] - p[1]) * 3600 < 4; });
  c.append(h('h3', {}, nm), h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'RA, Dec ' + q + ' (at the date of the pass on screen)'),
    h('p', {}, h('b', {}, 'Brightness: '), `W1 ${s.w1 != null ? s.w1.toFixed(2) : '–'}, W2 ${s.w2 != null ? s.w2.toFixed(2) : '–'} (WISE's 3.4 and 4.6 µm bands, Vega magnitudes; W2 S/N ${s.snr})`),
    col != null ? h('p', {}, h('b', {}, 'Colour: '), `W1−W2 = ${col.toFixed(2)}` + (col >= 2 ? ': extremely red, like the coldest brown dwarfs (WISE 0855 is about 3.5).' : col >= 0.8 ? ': very red. Cool brown dwarfs (T and Y types) and quasars look like this; a brown dwarf nearby also moves, a quasar far away does not.' : ': an ordinary colour (most stars are near 0).')) : null,
    h('p', {}, h('b', {}, 'Motion across the sky (CatWISE2020): '), `${pm.toFixed(2)} ± ${sg.toFixed(2)}″ per year` + (pm >= 0.05 ? ` toward the ${COMPASS[Math.round(((Math.atan2(s.pmra, s.pmdec) * 180 / Math.PI + 360) % 360) / 45) % 8]}` : '') +
      (S.eps.length > 1 ? `; between the first and last SPHEREx pass (${Math.round(days)} days) ${mv.toFixed(2)}″, ${(mv / 6.15).toFixed(2)} of a SPHEREx pixel.` : '.') +
      (s.halo || (s.twinOf && s.twinOf.halo) ? " It sits in a group of fast-looking entries, as artefacts in a bright star's halo do: this motion is most likely not real." : sure ? '' : ' CatWISE flags this fit as less reliable (a blend, an artefact flag, or a faint source), so treat the motion with care.')),
    s.twins && s.twins.length ? h('p', { style: 'font-size:.85rem' }, `CatWISE lists this object ${s.twins.length + 1} times (${[s, ...s.twins].map(t => `${t.name}: ${cwPm(t).toFixed(2)}″/yr`).join('; ')}); shown once, using the entry with the best signal. CatWISE can split a fast mover's smeared image into pieces, which then get different motions.`) : null,
    gaiaNear ? h('p', { style: 'font-size:.85rem' }, `Gaia DR3 ${gaiaNear.id} is at the same place (G ${gaiaNear.g.toFixed(1)}), with ${gPm(gaiaNear).toFixed(2)}″/yr. Gaia's motions are far more precise.`) : null);
  if (res) c.append(res);
  else if (S.eps.length > 1 && mv >= 1.5 && !s.halo) c.append(h('p', {}, 'That is enough to measure in SPHEREx. ', h('button', { class: 'hbtn', onclick: () => cwMeasure(s) }, 'Measure its motion')));
  else if (S.eps.length > 1) c.append(h('p', { style: 'font-size:.85rem' }, `Too slow to see in SPHEREx: ${mv.toFixed(2)}″ is far below one 6.15″ pixel.`));
  if (S.eps.length > 1 && mv >= 1.5 && !s.halo) c.append(h('p', {}, h('button', { class: 'hbtn', onclick: () => replayAcross(cwObj(s), nm, () => showCw(s)) }, '▶ Track its motion across passes')));
  c.append(h('p', {}, h('button', { onclick: () => spectrumAt(p[0], p[1], { name: nm, posAt: m => cwAt(s, m) }) }, 'Its spectrum'), ' ',
    h('a', { href: 'https://aladin.cds.unistra.fr/AladinLite/?target=' + encodeURIComponent(q) + '&fov=0.05&survey=CDS%2FP%2FallWISE%2Fcolor', target: '_blank', rel: 'noopener', style: 'font-size:.85rem' }, 'Aladin (WISE)'), ' ',
    h('button', { type: 'button', onclick: () => showElsewhere(p[0], p[1], nm) }, '🔗 Elsewhere')),
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'WISE data: CatWISE2020 (Marocco et al. 2021), from NASA/IPAC IRSA. CatWISE positions are for 2015.4, moved here with its own motion. Its motions come from WISE images of 2010-2018 and are less precise than Gaia\'s; for faint sources small motions can be systematic.'),
    h('button', { onclick: () => { S.sel = null; S.report ? showReport() : (c.hidden = true); } }, 'Close'));
  refreshSoon();
}
function cwMeasure(s) {
  const me = motionOf(cwObj(s));
  if (!me) { showCw(s, h('p', {}, 'Could not measure here: it is too close to the edge of the field, or the first and last pass have no image at this colour.')); return; }
  const ok = Math.abs(me.meas - me.pred) < Math.max(1.5, 0.25 * me.pred) && me.diff < Math.max(2, 0.35 * me.pred);
  showCw(s, h('div', {}, h('span', { class: 'badge ' + (ok ? 'ok' : 'unc') }, ok ? '✓ Motion seen' : 'Not clear'),
    h('p', {}, h('b', {}, 'Measured just now: '), `it moved ${me.meas.toFixed(1)}″ in ${Math.round(me.days)} days; CatWISE predicts ${me.pred.toFixed(1)}″ (difference in direction and size: ${me.diff.toFixed(1)}″).`),
    catRow({ mu: me.meas / (me.days / 365.25), smu: ctlSmu(slowCtl(s.ra, s.dec), me.days), cat: 'CatWISE2020', catMu: me.pred / (me.days / 365.25), catSmu: cwSig(s), diff: me.diff / (me.days / 365.25) }),   // v0.55 U4
    flagRow(posOf(cwObj(s))),   // v0.55 U6
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'Method: the Barnard\'s Star method (the last pass slid over the first after lining the images up on the stars). A faint source is often too faint for it: then try 🔭 Deep search or 🎯 Motion scan in Changes, which use every image. Brown dwarfs are brightest at 3.8-5 µm, so pick that colour first.')));
}
$('mvb').onclick = () => movieStart();   // v0.54: the film, also from Overlays
$('cwb').onclick = e => { CW.on = !CW.on; e.currentTarget.setAttribute('aria-pressed', CW.on); updCwNote(); if (CW.on) cwLoad(); refreshSoon(); };
// a CatWISE mover at this place and time with this motion (for the searches' labels); null when none
function cwMatch(ra, dec, mjd, muE, muN, smu) {
  if (!CW.data) return null; let best = null, bd = Infinity;
  for (const s of CW.src) { if (s.twinOf || s.halo || !(cwPm(s) >= 3 * cwSig(s)) || cwPm(s) < 0.3) continue;
    const q = cwAt(s, mjd), d = Math.hypot((q[0] - ra) * Math.cos(dec * Math.PI / 180), q[1] - dec) * 3600; if (d < 9 && d < bd) { bd = d; best = s; } }
  if (!best) return null;
  const pm = cwPm(best), diff = Math.hypot(best.pmra - muE, best.pmdec - muN), lim = Math.max(3 * Math.hypot(smu, cwSig(best)), 0.3 * pm, 0.5);
  return { cw: best, pm, agrees: diff < lim, diff, lim, sep: bd };
}
/* ---------- v0.37: deep view (Phase 5) ----------
   "Sum data per detector array (6 arrays) for better signal-to-noise": for the pass on screen, up to 6 images of each of the
   6 detectors (different colours inside that detector's range) are lined up on the stars and averaged in units of each
   image's own noise. Faint things that are lost in one image come out; the noise drop is MEASURED on the result and shown
   next to the ideal (square root of the number of images). Plus a false-colour picture: detectors 1-2 blue, 3-4 green, 5-6 red. */
const DEEP = { run: 0, res: null };
const DETRANGE = { D1: '0.75–1.1', D2: '1.1–1.6', D3: '1.6–2.4', D4: '2.4–3.8', D5: '3.8–4.4', D6: '4.4–5.0' };
function deepPick(ep, det, k = 6) {
  const pool = ep.imgs.filter(im => im.det === det).map(im => ({ im, g: geo(im) })).filter(o => !o.g || o.g.cover >= 0.8).sort((a, b) => lamRank(a.im) - lamRank(b.im));
  if (pool.length <= k) return pool.map(o => o.im);
  const out = []; for (let i = 0; i < k; i++) out.push(pool[Math.round(i * (pool.length - 1) / (k - 1))].im); return [...new Set(out)];
}
function deepStack(frs) {   // mean of (image - median) / noise, masked pixels left out; returns the stack and its measured noise
  const n = S.field.n, sum = new Float32Array(n * n), cnt = new Uint16Array(n * n);
  for (const f of frs) { const m = f.st.med, sg = f.st.sigma; for (let p = 0; p < n * n; p++) { const v = f.flat[p]; if (v === v && !(f.touched && f.touched[p] >= 0.5)) { sum[p] += (v - m) / sg; cnt[p]++; } } }
  const out = new Float32Array(n * n); for (let p = 0; p < n * n; p++) out[p] = cnt[p] ? sum[p] / cnt[p] : NaN;
  const st = F.robustStats(out);
  // Noise gain, measured on DIFFERENCES so the sky itself (stars, faint galaxies: the same in every image) drops out:
  // one image's noise = spread of (image 1 - image 2) / √2; the stack's noise = spread of (mean of odd - mean of even) / 2.
  // (A first version took the spread of the stack itself; in a crowded field that is mostly faint stars, and it showed
  // gains of only 1.0-1.7 for 6 images on Barnard's Star's field.)
  let gain = null;
  if (frs.length >= 4) {
    const z = (f, p) => { const v = f.flat[p]; return v === v && !(f.touched && f.touched[p] >= 0.5) ? (v - f.st.med) / f.st.sigma : NaN; };
    const d1 = new Float32Array(n * n), dN = new Float32Array(n * n);
    for (let p = 0; p < n * n; p++) {
      d1[p] = (z(frs[0], p) - z(frs[1], p)) / Math.SQRT2;
      let a = 0, na = 0, b = 0, nb = 0; frs.forEach((f, k) => { const v = z(f, p); if (v === v) { if (k % 2) { b += v; nb++; } else { a += v; na++; } } });
      dN[p] = na && nb ? (a / na - b / nb) / 2 : NaN;
    }
    const s1 = F.robustStats(d1), sN = F.robustStats(dN); if (s1 && sN && sN.sigma > 0) gain = s1.sigma / sN.sigma;
  }
  return { flat: out, st, n: frs.length, gain };
}
function deepCanvas(flat, st, rgb) { const n = S.field.n, cv = document.createElement('canvas'); cv.width = cv.height = n; cv.getContext('2d').putImageData(new ImageData(F.renderRGBA(flat, st, rgb, S.view), n, n), 0, 0); return cv; }
function deepComposite(stk) {   // blue = D1+D2, green = D3+D4, red = D5+D6, each in noise units
  const n = S.field.n, img = new ImageData(n, n), ch = [['D5', 'D6'], ['D3', 'D4'], ['D1', 'D2']].map(ds => {
    const parts = ds.map(d => stk[d]).filter(Boolean); if (!parts.length) return null;
    const a = new Float32Array(n * n); for (let p = 0; p < n * n; p++) { let v = 0, c = 0; for (const s_ of parts) { const x = s_.flat[p] / s_.st.sigma; if (x === x) { v += x; c++; } } a[p] = c ? v / Math.sqrt(c) : NaN; } return a; });
  // each channel stretched to its own 99.7th percentile, so star colours show instead of every star turning white
  const tops = ch.map(a => { if (!a) return 1; const v = Array.from(a).filter(x => x === x).sort((x, y) => x - y); return Math.max(10, v[Math.floor(v.length * 0.997)] || 10); });
  for (let p = 0; p < n * n; p++) {
    // a blanked (saturated) star centre is shown bright, not as a hole: only where another channel is bright too (not at edges)
    const core = ch.some((a, c) => a && a[p] === a[p] && a[p] > 0.5 * tops[c]);
    for (let c = 0; c < 3; c++) { const a = ch[c]; let v = a ? a[p] : 0; if (!(v === v)) v = core ? tops[c] : 0;
      img.data[p * 4 + c] = Math.max(0, Math.min(255, 255 * Math.asinh(Math.max(0, v) / 2) / Math.asinh(tops[c] / 2))); }
    img.data[p * 4 + 3] = 255;
  }
  // v0.55: a centre blanked in EVERY detector (a very bright star, e.g. Barnard's Star) showed as a black hole; it is filled
  // white from its bright edge inwards (a few passes), the way the single-channel rule above fills a centre blanked in one
  const none = p => ch.every(a => !a || !(a[p] === a[p])), d = img.data;
  for (let pass = 0; pass < 6; pass++) { const fill = [];
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) { const p = y * n + x; if (d[p * 4] + d[p * 4 + 1] + d[p * 4 + 2] || !none(p)) continue;
      let lit = 0; for (const q of [p - 1, p + 1, p - n, p + n]) if (Math.max(d[q * 4], d[q * 4 + 1], d[q * 4 + 2]) > 200) lit++;
      if (lit >= 2) fill.push(p); }
    if (!fill.length) break; for (const p of fill) d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = 255; }
  const cv = document.createElement('canvas'); cv.width = cv.height = n; cv.getContext('2d').putImageData(img, 0, 0); return cv;
}
async function deepView() {
  if (!S.field || !S.eps.length) { toast('Open a patch of sky first.'); return; }
  const me = ++DEEP.run, e = S.mode === 'time' && S.seq.length ? seqAt().e : Math.min(S.ei || 0, S.eps.length - 1), ep = S.eps[e];
  const dets = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'], plan = dets.map(d => ({ d, ims: deepPick(ep, d) })), all = plan.flatMap(x => x.ims);
  DEEP.res = { e, plan, done: 0, n: all.length, stk: null, t0: performance.now() }; S.sel = { deep: true }; showDeep();
  let k = 0; const q = all.slice();
  await Promise.all(Array.from({ length: 6 }, async () => { while (q.length && me === DEEP.run) { const im = q.shift(); if (!S.frames.get(im.url)) { try { await loadFrame(im); } catch { /* left out */ } } DEEP.res.done = ++k; if (me === DEEP.run && S.sel && S.sel.deep) showDeep(); } }));
  if (me !== DEEP.run) return;
  const stk = {}; for (const x of plan) { const frs = x.ims.map(im => S.frames.get(im.url)).filter(f => f && f.st); if (frs.length) stk[x.d] = Object.assign(deepStack(frs), { lam: frs.map(f => f.lamReal ?? f.im.lam) }); }
  DEEP.res.stk = stk; DEEP.res.sec = (performance.now() - DEEP.res.t0) / 1000; showDeep();
}
function showDeep() {
  const R = DEEP.res; if (!R || !(S.sel && S.sel.deep)) return;
  const c = $('card'); c.replaceChildren(); c.hidden = false;
  c.append(h('h3', { class: 'deepw' }, `Deep view, ${epLabel(R.e)}`));
  if (!R.stk) { c.append(h('p', {}, `Reading ${R.done} of ${R.n} images (up to 6 per detector, ${R.plan.map(x => x.ims.length).join(' + ')})...`)); return; }
  const comp = deepComposite(R.stk); comp.style.cssText = 'width:100%;image-rendering:pixelated;border-radius:6px;margin:.3rem 0'; comp.setAttribute('role', 'img'); comp.setAttribute('aria-label', 'False-colour deep image of this patch: blue short wavelengths, red long');
  c.append(comp, h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'False colour: blue = detectors 1-2 (0.75-1.6 µm), green = 3-4 (1.6-3.8 µm), red = 5-6 (3.8-5 µm). Hot stars look blue, cool stars and dust red.'));
  const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:.35rem' });
  for (const d of Object.keys(R.stk)) {
    const s_ = R.stk[d], lam = s_.lam.reduce((a, b) => a + b, 0) / s_.lam.length, cv = deepCanvas(s_.flat, s_.st, F.hslToRgb(190 - (lam - 0.75) / 4.25 * 150, 0.85, 0.58));
    cv.style.cssText = 'width:100%;image-rendering:pixelated;border-radius:4px';
    const gain = s_.gain;
    grid.append(h('div', { style: 'font-size:.72rem;line-height:1.25' }, cv, h('div', {}, h('b', {}, `${d} `), `${DETRANGE[d]} µm`), h('div', { style: 'color:var(--dust)' }, `${s_.n} images · noise ÷${gain ? gain.toFixed(1) : '?'} (ideal ÷${Math.sqrt(s_.n).toFixed(1)})`)));
  }
  c.append(grid);
  const g = Object.values(R.stk).filter(s_ => s_.gain), eff = g.map(s_ => s_.gain / Math.sqrt(s_.n));
  c.append(h('p', {}, h('b', {}, 'Measured: '), `adding up ${Object.values(R.stk).reduce((a, s_) => a + s_.n, 0)} images (in ${Math.round(R.sec)} s) cut the noise by ` + (g.length ? `${Math.min(...g.map(s_ => s_.gain)).toFixed(1)}× to ${Math.max(...g.map(s_ => s_.gain)).toFixed(1)}× per detector, ${Math.round(100 * Math.min(...eff))}-${Math.round(100 * Math.max(...eff))} % of the ideal square-root gain. ` : '? (too few images). ') +
    'Fainter objects show up than in any single image. It adds images from ONE pass, so it shows what is there, not what moves or changes.'),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'How: each image is lined up on the stars, divided by its own noise, and averaged with the others of the same detector; flagged pixels are left out. Noise is measured on differences between images, so the stars themselves do not count as noise.'),
    h('button', { onclick: () => { DEEP.run++; S.sel = null; S.report ? showReport() : (c.hidden = true); } }, 'Close'));
}
$('deepb').onclick = () => deepView();
/* ---------- v0.55 U3: the detector colour composite ON THE SKY ----------
   The Deep view's false-colour picture (deepComposite: blue = D1+D2, green = D3+D4, red = D5+D6, each detector's images of the
   pass on screen lined up and added) drawn over the field instead of only in the card. Nothing new is measured: it reuses
   deepView's stacks. It belongs to one field, one pass and one view: another spot, pass or view turns it off. */
const COMP = { on: false, cv: null, field: null, e: null, mode: null, dets: [] };
function compUi() {
  const b = $('compb'); if (b) b.setAttribute('aria-pressed', String(COMP.on));
  const L = $('compleg'); if (!L) return; L.hidden = !COMP.on; L.replaceChildren();
  if (!COMP.on) return;
  if (!COMP.cv) { L.append(h('span', {}, 'Adding up each detector\'s images of this pass...')); return; }
  for (const [col, ds] of [['#4d7dff', ['D1', 'D2']], ['#3fd47a', ['D3', 'D4']], ['#ff5a4d', ['D5', 'D6']]]) {
    const have = ds.filter(d => COMP.dets.includes(d));
    L.append(h('span', {}, h('i', { style: `background:${col}` }), `${ds.join('+')} ${DETRANGE[ds[0]].split('–')[0]}–${DETRANGE[ds[1]].split('–')[1]} µm` + (have.length < 2 ? (have.length ? ` (only ${have[0]})` : ' (no image)') : '')));
  }
  L.append(h('span', {}, `${epLabel(COMP.e)} · ${COMP.n} images`));
}
async function compToggle() {
  if (COMP.on) { COMP.on = false; compUi(); return; }
  if (!S.field || !S.eps.length) { toast('Open a patch of sky first.'); return; }
  const e = S.mode === 'time' && S.seq.length ? seqAt().e : Math.min(S.ei || 0, S.eps.length - 1), f = S.field;
  Object.assign(COMP, { on: true, cv: null, field: f, e, mode: S.mode, dets: [] }); compUi();
  if (!(DEEP.res && DEEP.res.stk && DEEP.res.field === f && DEEP.res.e === e)) { const p = deepView(); if (DEEP.res) DEEP.res.field = f; await p; }
  if (!COMP.on || COMP.field !== f || !DEEP.res || !DEEP.res.stk || DEEP.res.field !== f) return;
  const stk = DEEP.res.stk; COMP.dets = Object.keys(stk); COMP.n = Object.values(stk).reduce((a, s_) => a + s_.n, 0);
  COMP.cv = COMP.dets.length ? deepComposite(stk) : null;
  if (!COMP.cv) { COMP.on = false; toast('No detector images to add up in this pass.'); }
  compUi();
}
// called from frame(): draws it while it still matches what is on screen, and turns it off when it no longer does
function drawComp(T) {
  if (!COMP.on) return;
  const e = S.mode === 'time' && S.seq.length ? seqAt().e : Math.min(S.ei || 0, S.eps.length - 1);
  if (COMP.field !== S.field || COMP.mode !== S.mode || COMP.e !== e || S.lab || MOVIE.on) { COMP.on = false; compUi(); return; }
  if (!COMP.cv) return;
  drawImg(T, COMP.cv);
  ctx.save(); ctx.fillStyle = '#e8eefc'; ctx.font = '500 13px Archivo,sans-serif';
  const cap = W < 700 ? 'Composite · blue D1-2 · green D3-4 · red D5-6' : `Colour composite · ${epLabel(COMP.e)} · blue D1-2 · green D3-4 · red D5-6`;
  ctx.fillText(cap, Math.max(8, (W - ctx.measureText(cap).width) / 2), 110); ctx.restore();
}
$('compb').onclick = () => compToggle();
$('specb').onclick = e => { S.specArm = !S.specArm; e.currentTarget.setAttribute('aria-pressed', S.specArm); if (S.specArm) toast('Tap a star to see its spectrum (its brightness in SPHEREx’s colours).', 4500); };
document.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => runChallenge(b.dataset.ct));
$('flagsb').onclick = e => { S.flagsOn = !S.flagsOn; e.currentTarget.setAttribute('aria-pressed', S.flagsOn); $('flagleg').hidden = !S.flagsOn;
  if (S.flagsOn && !(S.mode === 'time' || S.mode === 'blink')) setMode('time'); updateLabels(); refreshSoon(); };
function focusExample(kind) {   // after the run: open the card the example is about
  try {
    if (kind === 'embed') { S.bi = S.eps.length; setMode('blink'); $('card').hidden = true; S.al.gotoRaDec(S.field.ra, S.field.dec); S.al.setFov(S.field.size * 1.15); return; }
    if (kind && kind.startsWith('ct:')) { const id = kind.slice(3), t = CHALLENGE[id]; if (t && S.eps.length) { const p = ctAt(t, epMid(S.eps.length - 1)); S.al.gotoRaDec(p[0], p[1]); S.al.setFov(0.12); } showChallenge(id); if (EMBED) { S.bi = S.eps.length; setMode('blink'); } return; }
    if (kind === 'asteroid') { const a = S.inside && S.inside.asteroids.find(q => q.confirmed); if (a) { S.al.gotoRaDec(a.sightings[0].ra, a.sightings[0].dec); S.al.setFov(0.3); showAsteroid(a); } }
    else if (kind === 'artefact') { const k = S.report && S.report.candidates.find(q => q.status === 'artefact'); if (k) { S.al.gotoRaDec(k.to.ra, k.to.dec); S.al.setFov(0.12); showCand(k); } }
  } catch { /* the example still works without the focus */ }
}
document.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => runExample(b.dataset.ex));
$('exb').onclick = () => { const i = $('intro'); document.body.classList.add('intro'); i.hidden = false; i.style.opacity = 1; };
function closeIntro() { const i = $('intro'); document.body.classList.remove('intro'); if (i.hidden) return; i.style.opacity = 0; setTimeout(() => i.hidden = true, 900); }
$('go').onclick = () => { closeIntro(); if (allSky()) setTimeout(() => toast('Drag to turn the sky, scroll to zoom. Click a marker, or type a place in Fly to.', 7000), 700); };
$('wsky').onclick = () => { closeIntro(); wholeSky(true); };
$('lb').onclick = () => drawer(true); $('lc').onclick = () => drawer(false);
$('tb').onclick = () => drawer(true, 'tdrawer'); $('tc').onclick = () => drawer(false); $('totb').onclick = () => drawer(true, 'tdrawer');
// Two side drawers: Learn (#drawer) and Tested (#tdrawer, v0.29: the scorecard and the false-alarm test). One open at a time;
// drawer(false) closes both.
function drawer(o, id = 'drawer') {
  const D = [['drawer', 'lb', 'lc'], ['tdrawer', 'tb', 'tc']], was = D.find(([d]) => $(d).classList.contains('open'));
  for (const [d, b] of D) { const on = o && d === id; $(d).classList.toggle('open', on); $(d).setAttribute('aria-hidden', !on); $(b).setAttribute('aria-expanded', on); }
  if (o && id === 'tdrawer') { Promise.all([loadScorecard(), loadNulltest(), loadBrighttest(), loadMovertest()]).then(renderOneLook); }   // v0.55: mover test, in one look
  if (o) $(D.find(([d]) => d === id)[2]).focus(); else if (was) $(was[1]).focus();
}
addEventListener('keydown', e => { if (e.key === 'Escape' && !(window.Tour && Tour.on)) drawer(false); });
$('hc').onclick = e => { const on = document.documentElement.dataset.hc !== '1'; document.documentElement.dataset.hc = on ? '1' : '0'; e.target.setAttribute('aria-pressed', on); };

function go(ra, dec) { flyTo(ra, dec, 1.2).catch(() => { S.al.gotoRaDec(ra, dec); S.al.setFov(1.2); }); }
// v0.57.12: the example positions on the whole-sky caption fill Fly to and go there
document.querySelectorAll('.skyex [data-fly]').forEach(b => { b.onclick = () => { $('q').value = b.dataset.fly; $('sf').requestSubmit(); }; });
$('sf').onsubmit = async e => {
  e.preventDefault(); const q = $('q').value.trim(); if (!q || !S.al) return;
  const ctq = [[/barnard/i, 'barnard'], [/eps(ilon)?\.?\s*ind(i)?\s*b/i, 'epsindb'], [/wise\s*(j?0855|0855)/i, 'wise0855'], [/^rw\s*aur/i, 'rwaur'], [/^r\s*dra(conis)?$/i, 'rdra']].find(([re]) => re.test(q));
  if (ctq && S.auto) { closeIntro(); runChallenge(ctq[1]); return; }
  const n = q.split(/[\s,]+/).map(Number), isCoord = n.length === 2 && n.every(Number.isFinite) && n[0] >= 0 && n[0] <= 360 && Math.abs(n[1]) <= 90;
  if (S.auto) { runAgents(isCoord ? { ra: n[0], dec: n[1], label: 'Coordinates' } : { name: q }); return; }
  if (isCoord) { go(n[0], n[1]); return; }
  try { const r = await api('/api/resolve?q=' + encodeURIComponent(q)); go(r.ra, r.dec); toast(r.name || q); }
  catch (err) { toast(err.message === 'Name not found' ? 'No match. Try an object name, or RA Dec like 190 -4.' : err.message); }
};

/* ---------- share link ---------- */
function writeHash() {
  if (!S.al) return;
  // the whole-sky view is the front page: no link for it (a saved fov=360 in the north-up projection showed a broken half sky)
  if (allSky()) { try { if (location.hash && !/tour|guide|ex=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } return; }
  try { const [ra, dec] = S.al.getRaDec(); history.replaceState(null, '', `#ra=${ra.toFixed(4)}&dec=${dec.toFixed(4)}&fov=${S.al.getFov()[0].toFixed(3)}&b=${S.band.toFixed(2)}&m=${S.mode}&e=${S.ei}&sz=${$('csize').value}&ipe=${S.depthWanted || S.depth}${S.field ? `&load=1&fra=${S.field.ra.toFixed(5)}&fdec=${S.field.dec.toFixed(5)}` : ''}`); } catch { /* ignore */ }
}
const embedUrl = () => location.origin + location.pathname + '?embed=1' + location.hash;
const embedCode = () => `<iframe src="${embedUrl()}" width="640" height="420" style="border:0" loading="lazy" allowfullscreen title="ARCNAVE: this patch of sky in NASA SPHEREx images"></iframe>`;
$('share').onclick = async () => {
  writeHash(); let ok = true; try { await navigator.clipboard.writeText(location.href); } catch { ok = false; }
  const e = $('toast'); e.replaceChildren(ok ? 'Link copied. ' : 'Copy the address bar to share this view. ',
    h('button', { class: 'tbtn', onclick: async () => { try { await navigator.clipboard.writeText(embedCode()); toast('Embed code copied: paste it into any web page'); } catch { prompt('Embed code', embedCode()); } } }, 'Copy embed code'));
  e.hidden = false; clearTimeout(toast.i); toast.i = setTimeout(() => e.hidden = true, 8000);
};
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
  'Known-object positions come from IMCCE SkyBoT (or, when SkyBoT cannot be reached, the Minor Planet Center checker) for a geocentric observer. SPHEREx is in low Earth orbit, so near objects can be off by about an arcminute.',
  'Nothing here is a discovery claim. Planet X is hypothetical and is not searched for.'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* v0.57.5: the page stays alive during the long searches. Measured on Barnard's field in Chrome, starting the film froze the
   page 22 s in all, 5.5 s at once: the 24 images' star shapes (F.epsfGrid, ~0.4 s each) were built back to back inside the
   first measurement, and the loops gave the page a turn only every 20-25 sources (0.8-3 s). Now the star shapes are built
   one image at a time with a pause in between, and the loops pause every ~50 ms. Same inputs, same cached shapes: every
   number is the same, only the page answers clicks while it works. */
// The pause is a message to itself, not setTimeout (in a background tab timers run about once a second, so 50 ms setTimeout
// pauses made a search many times slower there) and not scheduler.yield (its continuation jumps the queue, so other tasks
// still waited: measured, the first 30 star shapes still froze the page 5 s). A message waits its turn behind clicks.
const yieldNow = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); });
let BREATHE_T = 0;
const breathe = async () => { if (performance.now() - BREATHE_T > 50) { await yieldNow(); BREATHE_T = performance.now(); } };
async function warmEpsf(live = () => true) {
  // v0.57.8: one image's star shape takes 0.2-0.4 s (Barnard's Star: 24 of them in a row, the page frozen each time): they
  // are now made in the worker pool, several at once, with the same function (lib/fits.js epsfGrid) and the same numbers
  if (FT.epsfMode !== 'stack' && prepPool()) {
    const todo = [...S.frames.values()].filter(fr => fr.flat0 && fr.epsf === undefined), n = S.field.n, opts = { half: 5, os: 4, minSnr: 25 };
    await Promise.all(todo.map(async fr => {
      const st = fr.st0 || (fr.st0 = F.robustStats(fr.flat0)), main = () => F.epsfGrid(fr.flat0, n, st, opts);
      let P = null; try { P = F.epsfRevive(await workerJob('epsf', { flat: fr.flat0, n, st, opts }, main)); } catch { P = undefined; }
      if (P !== undefined && fr.epsf === undefined) fr.epsf = P && P.nStars >= 8 ? P : null;   // not measured meanwhile on this thread
    }));
    if (!live()) return;
  }
  for (const fr of [...S.frames.values()]) {
    if (!live()) return;
    if (!fr.flat0 || (FT.epsfMode !== 'stack' && fr.epsf !== undefined)) continue;
    try { epsfOf(fr); } catch { /* measured later, as before */ }
    await yieldNow();
  }
  // v0.57.8: each image's Gaia line-up too (cached by gaiaReg itself, same result): the first measurement used to do all
  // of them in one go (Epsilon Indi B: 28 images, a 2.4 s freeze)
  if (GAIA.data) for (const fr of [...S.frames.values()]) {
    if (!live()) return;
    if (!fr.flat0) continue;
    try { gaiaReg(fr); } catch { /* measured later, as before */ }
    await yieldNow();
  }
}
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
  phoneSheet('agents');
  if (!S.al) return;
  closeIntro();   // a search typed while the welcome screen is open must not leave it over the results (seen live)
  const run = ++S.run, live = () => run === S.run;
  // v0.56: a run that is not the background deepening starts from the depth the user chose
  if (!opts.deepen) { S.netLoads = 0; if (S.depthWanted) { S.depth = S.depthWanted; $('ipe').value = S.depth; } S.depthWanted = 0; }
  S.ag = {}; S.cands = []; S.known = []; S.report = null; S.sel = null; S.ct = opts.ct || null; renderAgents(); $('agents').open = true;
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
    // v0.14.3: ask the archive NOW, while the camera flies (the server shares one in-flight query, so the Archivist's own
    // request below just picks up this answer). Measured live: the IRSA search alone takes about 20 s for a new spot.
    api(searchUrl(ra, dec)).catch(() => { /* the Archivist reports errors */ });
    // v0.15: the camera flies while the Archivist and the Aligner already work (the flight took 3 s before anything started)
    const navDone = () => { if (live()) setAgent('nav', 'done', `${label ? label + ' · ' : ''}RA ${ra.toFixed(3)}°, Dec ${dec.toFixed(3)}°`); };
    const flight = opts.skipNav ? Promise.resolve() : flyTo(ra, dec, Math.max(0.6, +$('csize').value * 2)).catch(() => {});
    flight.then(navDone);
    await sleep(0); if (!live()) return;

    // 2. Archivist
    cur = 'arc'; setAgent('arc', 'run', 'Searching the IRSA archive...');
    S.userBand = opts.band != null;
    if (S.userBand) { S.band = opts.band; $('band').value = S.band; spxFollow(); }
    waitStart('search');
    const ok = await loadField(ra, dec, { auto: opts.band == null });   // a colour the user picked is kept, not replaced by the best-match colour
    if (!live()) return;
    waitEnd();
    if (!ok) throw new Error(S.lastErr || 'Archive search failed');
    if (GAIA.on) gaiaLoad(); else { GAIA.key = null; GAIA.data = null; }   // v0.56: never the last field's stars
    if (CW.on) cwLoad(); else { CW.key = null; CW.data = null; CW.src = []; }
    const E = S.eps.length, a = 0, b = E - 1, idx = E > 1 ? [a, b] : [a];
    const lamTxt = () => { const l = idx.map(i => lamOf(chosen(i))), d = Math.max(...l) - Math.min(...l);
      return idx.length < 2 ? `colour ${l[0].toFixed(3)} µm` : d < 0.02 ? `same colour in each epoch: ${l.map(x => x.toFixed(3)).join(' vs ')} µm`
        : `closest colours available: ${l.map(x => x.toFixed(3)).join(' vs ')} µm (Δ ${d.toFixed(3)})`; };
    setAgent('arc', E > 1 ? 'done' : 'warn', `${S.images.length} images in ${E} epoch${E > 1 ? 's' : ''}; ${lamTxt()}` + (E > 1 ? '' : '. Only one epoch so far, so nothing to compare yet') + dropTxt());

    // 3. Aligner
    cur = 'ali';
    // The first cutout of a detector without a built-in wavelength map teaches the app that map, which can change the best
    // images (and the best colour). Load until the choice is stable, then make sure the final choice is what was loaded.
    // v0.14.2: every epoch's first image in this first wave (it was only the first and last epoch, so the middle one waited
    // for a second wave of IRSA downloads: the preview took 75 s on a live run)
    const firstWave = S.eps.map((_, i) => i);
    for (let pass = 0; pass < 4; pass++) {
      const before = idx.map(i => chosen(i).url), nTables = Object.keys(TABLES).length;
      setAgent('ali', 'run', `Downloading ${firstWave.length} images in parallel (one per sky pass), cleaning bad pixels and reprojecting...`);
      if (pass === 0) waitStart('first', firstWave.length);
      const fwTick = () => waitTick(firstWave.filter(i => rawOf(i)).length);
      await Promise.all(firstWave.map(i => idx.includes(i) ? ensureFrame(i).then(fwTick) : ensureFrame(i).then(fwTick).catch(() => { /* retried later */ })));   // parallel: the server fetches up to 4 from IRSA at once and caches them
      if (!live()) return;
      if (Object.keys(TABLES).length !== nTables && !opts.keepMode && opts.band == null) { S.band = bestBand(); $('band').value = S.band; spxFollow(); }
      buildSlotsNow();   // slot 0 follows the new choice
      if (idx.every((i, k) => chosen(i).url === before[k])) break;
    }
    await Promise.all(idx.map(i => ensureFrame(i))); if (!live()) return;
    await flight; if (!live()) return;   // show the preview only once the camera is there
    waitEnd();
    // v0.56 quick first report: a NEW field (its first images came from NASA, not the cache) at 8 images per pass costs
    // ~120 MB, about 50 s on a 2.4 MB/s line after the archive search. So the report comes first from 3 per pass (3/8 of the
    // bytes; measured: about 50 s with 4), and the other 5 per pass download afterwards and the report is redone with all 8 (runAgents deepen). Prewarm
    // and the validation runs (S.noQuick) and any other depth always load everything first.
    if (!opts.deepen && !S.noQuick && S.depth === 8 && S.netLoads > 0 && E > 1) { S.depthWanted = S.depth; S.depth = 3; }
    // Several images per epoch: the colour may have changed while loading, so rebuild the slots, then load them all.
    buildSlotsNow(); renderStrip();
    // v0.17: ask which known objects were there now, while the images download (it used to start after all 24 had arrived
    // and could add a minute at the end). The answers are kept, so the Analyst finds them ready.
    S.eps.forEach((_, i) => ensureMovers(i, true));
    S.seq.forEach(x => ensureMoversIm(x.im, true));
    await Promise.all(idx.map(i => ensureFrame(i))); if (!live()) return;
    if (multi()) {
      // v0.14.2 progressive loading: IRSA takes 25 to 45 s per cutout and the server asks for 4 at a time (more gives 503s),
      // so 24 images take 2 to 3 minutes. First one image per epoch (the first wave), shown at once as a preview, then the
      // rest for the deeper stacks and the report. Measured live: preview in about 30 s instead of waiting for all 24.
      await Promise.all(S.eps.map((_, i) => ensureFrame(i).catch(() => { /* retried with the rest */ })));
      if (!live()) return;
      const pv = S.eps.filter((_, i) => rawOf(i)).length;
      if (pv && S.seq.some(x => !S.frames.get(x.im.url))) {
        S.ei = b; updateLabels(); refreshSoon();
        toast(`Preview ready at ${lamOf(chosen(0)).toFixed(2)} µm: one image per sky pass. The other images are on their way for deeper, cleaner stacks.`, 6000);
      }
      const all = S.seq.map(x => x.im); let done = all.filter(im => S.frames.get(im.url)).length;
      const msg = () => `Preview on screen. Downloading ${all.length} images (${perEpochTxt()}) for deeper stacks: ${done} of ${all.length} ready...`, tick = () => { done = all.filter(im => S.frames.get(im.url)).length; if (live()) { setAgent('ali', 'run', msg()); waitTick(done); } };   // counted, not added up (showed "26 of 24")
      if (done < all.length) waitStart('rest', all.length, done);
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
      waitEnd();
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
      (multi() ? `${S.seq.length} images (${perEpochTxt()}): ${S.slots.length} colour-matched across epochs (colours differ by at most ${S.slotDLam.toFixed(3)} µm), used to compare the epochs` +
        (S.extra.some(x => x.length) ? `, plus ${S.extra.reduce((a, x) => a + x.length, 0)} more, each used only inside its own pass (flipping through it, finding movers inside it)` : '') +
        (S.eps.some(ep => epochImgs(S.eps.indexOf(ep)).length < S.depth) ? `; ${S.eps.map((ep, e) => epochImgs(e).length < S.depth ? `the ${fmtMonth(ep.t0)} pass has only ${epochImgs(e).length} image${epochImgs(e).length === 1 ? '' : 's'} covering this spot in the archive` : null).filter(Boolean).join(', ')}` : '') + '; slot 1: ' : '') +
      lamTxt() + (E > 1 ? '' : '. Only one epoch so far, so nothing to compare yet') + dropTxt() + '.' + dataNote());
    S.ei = b; S.ti = S.seq.length ? S.seq.length - 1 : 0; setMode(opts.keepMode ? S.mode : (E > 1 ? (multi() ? 'change' : 'diff') : 'time'));

    // 4. Analyst
    cur = 'ana'; setAgent('ana', 'run', 'Asking which known objects are in the field (SkyBoT, or the Minor Planet Center if SkyBoT is unreachable)...');
    waitStart('known'); await Promise.all(idx.map(i => ensureMovers(i))); waitEnd();
    if (!live()) return;
    S.inside = null;
    if (multi()) { setAgent('ana', 'run', 'Looking for things that move between the visits of each epoch...'); await sleep(0); S.inside = await insideEpochs(live); if (!live()) return; }
    setAgent('ana', 'run', E > 1 ? 'Comparing the aligned epochs...' : 'Checking known objects...');
    await sleep(0);
    const res = analyse(a, b, E), seen = res.known.filter(k => k.detected).length, lookupFailed = [...S.movers.entries()].some(([k, m]) => m && m.err && S.need && S.need.has(k));
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
          const per = S.eps.map((_, e) => matchedImgs(e).filter(im => S.frames.get(im.url)).length);
          const stTxt = per.every(n => n === S.slots.length) ? `${S.slots.length} images each` : `${per.join(', ')} images`;
          return `${real} change${real === 1 ? '' : 's'} between epoch${multi() ? ` stacks (${stTxt})` : 's'}${art ? ` (+${art} likely artefact${art === 1 ? '' : 's'})` : ''} · `; })();
    setAgent('ana', lookupFailed || gated ? 'warn' : 'done', (E > 1 && inPlane() ? 'Milky Way plane: changes here are mostly noise · ' : '') + ct + (lookupFailed ? 'Known-object check not possible: neither SkyBoT nor the Minor Planet Center checker (the services that know where every asteroid is) is answering right now, so nothing could be named and every change stays unconfirmed. Run the agents again in a few minutes.' : kt + (viaMpc() ? ' · named by the Minor Planet Center checker, because SkyBoT could not be reached (positions to about 2″)' : '')));

    // 5. Reporter
    cur = 'rep'; setAgent('rep', 'run', 'Writing the report...');
    S.report = buildReport(label, E, a, b, res); showReport(); renderStrip();
    S.chg = null; renderChgPanel();   // rebuild the Changes view now that known asteroids are known
    changeData();   // v0.55: start building it now, in the worker (v0.52), so Changes opens ready; same function, same result
    if (innerWidth <= 700) $('agents').open = false;   // on a phone the sky matters more than the log once the run is done
    setAgent('rep', 'done', 'Report ready. Click a marker for details, or download it');
    if (!multi()) prefetchEpochs(run);
    if (opts.focus) focusExample(opts.focus);
    stat(`Agents finished: ${E > 1 ? 'Difference view of epoch 1 vs ' + E : 'single epoch'}.`);
    if (S.depthWanted) deepenLater(run, label, opts);   // v0.56: the quick report is out; now the rest, in the background
  } catch (e) {
    if (!live() || e.message === 'cancelled') return;
    waitEnd(); setAgent(cur, 'err', e.message); skipAfter(cur); stat(e.message, true);
  }
}

/* v0.56: after a quick first report (4 images per pass on a new field), download the images the chosen depth adds, without
   touching what is on screen, then redo the run at that depth: every image is then in memory, so the agents take a few
   seconds and the report comes back with the deeper stacks. Waits while a card or the film is open, so nothing the user is
   looking at is pulled away. Any newer run (another field, a new colour) cancels it. */
async function deepenLater(run, label, opts) {
  const want = S.depthWanted, live = () => run === S.run; if (!want || !S.field) return;
  const keep = { depth: S.depth, slots: S.slots, extra: S.extra, seq: S.seq, slotDLam: S.slotDLam };
  S.depth = want; buildSlotsNow(); const ims = S.seq.map(x => x.im);
  Object.assign(S, keep);   // the screen keeps the quick run's images and order
  const todo = ims.filter(im => !S.frames.get(im.url)); let done = ims.length - todo.length;
  const say = () => { if (live()) setAgent('rep', 'done', `Report ready from ${keep.depth} images per pass. Deepening to ${want} per pass in the background: ${done} of ${ims.length} images...`); };
  say();
  await Promise.all(todo.map(im => ensureImg(im).then(() => { done++; say(); }, () => { /* the redo reports what is missing */ })));
  for (let k = 0; k < 600 && live() && ((S.sel && !S.sel.report) || MOVIE.on || S.lab); k++) await sleep(500);   // a card, the film or a lab view is open: wait
  if (!live()) return;
  S.depth = want; $('ipe').value = want; S.depthWanted = 0;
  toast(`Deeper stacks ready: the report now uses ${want} images per pass.`, 5000);
  runAgents({ ra: S.field.ra, dec: S.field.dec, label }, { ...opts, skipNav: true, keepMode: true, deepen: true, band: S.userBand ? S.band : undefined });
}

/* ---------- Wait indicator (v0.15.2) ---------- */
// The slow part of a new spot is NASA's archive, not this page: the image search takes about 20 s and each cutout 25 to 45 s
// (the server asks for 4 at a time). Say so, show elapsed time, progress and an estimate measured from the actual rate, so a
// wait never looks like a hang. Hidden when everything comes from the cache (done within about a second).
const WAIT = { phase: null, t0: 0, total: 0, done: 0, base: 0, tFirst: 0, shown: false, timer: null, pending: new Set(), slowNet: 0 };
// Downloads in flight. A cached cutout arrives in well under a second; a slow one means IRSA is cutting it right now.
function netStart() { const t = { t: performance.now() }; WAIT.pending.add(t); return t; }
function netEnd(t) { WAIT.pending.delete(t); if (performance.now() - t.t > 1500) WAIT.slowNet = performance.now(); }
const netSlow = () => { const now = performance.now(); for (const t of WAIT.pending) if (now - t.t > 1500) return true; return now - WAIT.slowNet < 4000; };
function waitStart(phase, total = 0, base = 0) {   // base: images already there when the phase starts (not counted in the rate)
  clearInterval(WAIT.timer);
  Object.assign(WAIT, { phase, t0: performance.now(), total, done: base, base, tFirst: 0, shown: false });
  WAIT.timer = setInterval(waitDraw, 500);
}
function waitTick(done) {
  if (!WAIT.phase) return;
  if (done > WAIT.done && !WAIT.tFirst) WAIT.tFirst = performance.now();
  WAIT.done = done; waitDraw();
}
function waitEnd() { clearInterval(WAIT.timer); WAIT.timer = null; WAIT.phase = null; $('wait').hidden = true; document.body.classList.remove('waiting'); }
const fmtWait = s => s < 50 ? `about ${Math.max(5, Math.round(s / 5) * 5)} s` : s < 90 ? 'about a minute' : `about ${Math.round(s / 60)} min`;
function waitDraw() {
  const w = WAIT; if (!w.phase) return;
  const el = (performance.now() - w.t0) / 1000;
  if (!w.shown && (el < (w.phase === 'known' ? 3 : 1.2) || ((w.phase === 'first' || w.phase === 'rest') && !netSlow()))) return;   // fast (cache) or busy only with our own processing: no panel
  w.shown = true; $('wait').hidden = false;
  let head, sub, frac = null, eta = '';
  if (w.phase === 'known') {
    head = 'Asking which known asteroids and comets were there at each image\'s time';
    sub = el < 15 ? 'It usually answers in a few seconds.' : 'SkyBoT is slow right now. If it does not answer within about 20 s, ARCNAVE asks the Minor Planet Center instead (a few seconds per visit). If neither answers, the agents finish without naming objects and say so.';
  } else if (w.phase === 'search') {
    head = 'Asking NASA\'s archive which SPHEREx images cover this spot';
    sub = el < 30 ? 'A new spot usually takes about 20 s. Spots opened before (and the examples and landmarks) open at once.' : 'The archive is slower than usual right now. Still waiting for its answer...';
  } else {
    const left = Math.max(0, w.total - w.done), got = w.done - w.base;
    frac = w.total ? w.done / w.total : 0;
    head = w.phase === 'first' ? `Downloading the first image of each sky pass: ${w.done} of ${w.total}` : `Preview on screen. Deeper stacks: ${w.done} of ${w.total} images`;
    if (left) {
      if (got >= 2) eta = fmtWait(left / (got / el)) + ' left';                         // measured rate
      else if (el > 8) eta = fmtWait(Math.ceil(left / 6) * 10 - (got ? 0 : Math.min(el, 8))) + ' left';   // typical pace from NASA's S3 copy
    }
    sub = (w.phase === 'first' ? 'Each image comes from NASA\'s SPHEREx archive (its open copy on AWS): a few seconds each, longer on a slow connection. ' : 'You can already explore. ') +
      'Every image is kept, so this spot opens in seconds next time.';
  }
  // v0.57.9: only what changed is written, and the panel's height reaches the page through a ResizeObserver: reading
  // offsetHeight here twice a second forced a layout of the whole page each time (17 s of a 40 s field switch, measured)
  const setT = (id, v) => { const e = $(id); if (e.textContent !== v) e.textContent = v; };
  setT('waith', head); setT('waitt', `${Math.round(el)} s${eta ? ' · ' + eta : ''}`); setT('waitp', sub);
  if ($('waitbar').hidden !== (frac == null)) $('waitbar').hidden = frac == null;
  if (frac != null) { const wd = Math.max(4, Math.round(frac * 100)) + '%'; if ($('waitfill').style.width !== wd) $('waitfill').style.width = wd; }
  if (!document.body.classList.contains('waiting')) document.body.classList.add('waiting');
  if (!WAIT.ro && window.ResizeObserver) { WAIT.ro = new ResizeObserver(es => { const h = Math.round(es[0].borderBoxSize ? es[0].borderBoxSize[0].blockSize : es[0].contentRect.height); document.body.style.setProperty('--wh', h + 'px'); }); WAIT.ro.observe($('wait')); }   // a toast moves below it
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
  waitStart('known');
  await Promise.all(ims.map(im => slot0(im) >= 0 ? ensureMovers(slot0(im)) : ensureMoversIm(im)));
  if (!live()) return null;
  waitEnd();
  const knownFor = im => { const ei = slot0(im), m = ei >= 0 ? moversOf(ei) : moversIm(im); return (m && m.items) || []; };
  const byObj = new Map(), unknown = []; let unmatched = 0, unRepeat = 0, unOnce = 0;
  // v0.32: unmatched sources seen in two exposures in a row (not a cosmic ray) are kept so they can be shown as "seen once, not
  // linked" dots. Live check (2026-10-27): single-exposure sources are NOT drawn: on RA 122.2 +20.2, 72 of them, some with
  // hundreds of sigma (bright stars missing from the other visits), would have looked like 72 mysterious objects.
  const miss = s_ => { unmatched++; if (s_.repeat === true) unRepeat++; else unOnce++;
    if (s_.repeat === true && s_.shapeOk !== false) unknown.push({ e: s_.e, im: s_.im, mjd: s_.im.mjd, x: s_.x, y: s_.y, ra: s_.ra, dec: s_.dec, snr: s_.snr, repeat: s_.repeat }); };
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
    o.vOk = vOk; o.dra = it.dra; o.ddec = it.ddec; byObj.set(key, o);
  }
  const asteroids = [...byObj.values()].map(o => ({ ...o, confirmed: o.vOk === true && o.sightings.some(x => x.repeat === true || (x.repeat == null && x.shapeOk !== false)) }))
    .sort((p, q) => q.confirmed - p.confirmed || q.sightings.length - p.sightings.length || (p.vmag || 99) - (q.vmag || 99));
  return { asteroids, unknown, unmatched, unRepeat, unOnce, perEpoch, sources: found.length, queried: ims.length };
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
      const proof = makeProof(c, best, arc, shape, repeat, glareAt(fa, fb, f.n, sp.x, sp.y));
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

/* v0.56 glare: a very bright star is blank (saturated) at its centre. When it brightens or fades between the epochs (R
   Draconis, a Mira variable, at 0.85 µm: 2 blank pixels in one epoch, 71 in the other), the halo around it changes too,
   and its rim breaks up into many "new" or "gone" spots (all 50 changes of that field lay 16 to 37 pixels from it). So: the
   saturated-core pixels within 45 pixels (4.6′), counted in each epoch; if that count differs by 15 or more, the spot is
   in a changing glare. Only blank pixels with valid data 10 pixels away on all four sides count as a core, so the blank
   edges of the footprint (which also differ between epochs) do not. Checked on R Draconis: 32 of 289 test spots flagged,
   all within 46 pixels of the star; 50 of its 50 changes. Returns null when there is no such glare. */
function glareAt(fa, fb, n, x, y) {
  if (!fa || !fb) return null;
  const ok = (fr, X, Y) => X >= 0 && Y >= 0 && X < n && Y < n && fr.flat[Y * n + X] === fr.flat[Y * n + X];
  const core = fr => { let s = 0; for (let j = -45; j <= 45; j++) for (let i = -45; i <= 45; i++) { if (i * i + j * j > 2025) continue; const X = Math.round(x) + i, Y = Math.round(y) + j;
    if (X < 0 || Y < 0 || X >= n || Y >= n || ok(fr, X, Y)) continue; if (ok(fr, X + 10, Y) && ok(fr, X - 10, Y) && ok(fr, X, Y + 10) && ok(fr, X, Y - 10)) s++; } return s; };
  const A = core(fa), B = core(fb); return Math.abs(A - B) >= 15 ? { a: A, b: B } : null;
}
function makeProof(c, best, arc, shape, repeat, glare) {
  const sharpOk = shape && shape.value != null && shape.stars ? shape.value >= PROOF.sharpFrac * shape.stars : null;
  const shapeCheck = { name: 'Shape', ok: sharpOk, text: sharpOk == null ? 'Not enough bright stars to compare its shape'
    : sharpOk ? `As blurred as a real star (${shape.value.toFixed(2)}; stars here ${shape.stars.toFixed(2)})`
    : `Much sharper than any star (${shape.value.toFixed(2)}; stars here ${shape.stars.toFixed(2)}). Real objects are blurred by the telescope, so this is probably a cosmic-ray hit or hot pixel` };
  const shapeInfo = shape ? { value: shape.value, starsMedian: shape.stars, starsUsed: shape.nStars } : null;
  const need = repeat ? Math.max(2, Math.ceil(repeat.of / 2)) : 0, repOk = repeat && repeat.of > 1 ? repeat.seen >= need : null;
  const repCheck = repOk == null ? null : { name: 'Repeat', ok: repOk, text: `Seen in ${repeat.seen} of ${repeat.of} images of epoch ${repeat.epoch + 1}` +
    (repeat.other ? `, in ${repeat.other.seen} of ${repeat.other.of} images of epoch ${repeat.other.epoch + 1}` : '') + (repOk ? '' : `. A real object would be in at least ${need}`) };
  const glareCheck = glare ? { name: 'Glare', ok: false, text: `In the glare of a very bright star whose saturated centre changed size between the epochs (${glare.a} and ${glare.b} blank pixels nearby): the star brightened or faded, so its halo changed, not a new object` } : null;
  const base = [shapeCheck, repCheck, glareCheck].filter(Boolean);
  if (sharpOk === false || repOk === false || glare) return { status: 'artefact', reason: glare ? 'glare' : sharpOk === false ? 'sharp' : 'repeat', checks: base, shape: shapeInfo, repeat, near: best ? nearInfo(best, arc) : null };
  if (!best) return { status: 'unconfirmed', checks: base, shape: shapeInfo, repeat, near: null };
  const it = best.it, off = best.dPx * arc, tol = PROOF.matchArcsec + (Number.isFinite(it.err) ? Math.min(it.err, 30) : 0);
  const vOk = Number.isFinite(it.vmag) ? it.vmag <= PROOF.vLimit : null;
  const checks = [
    { name: 'Position', ok: off <= tol, text: `${off.toFixed(1)}″ from where ${KS()} predicts it at this image's time (must be under ${tol.toFixed(0)}″, about 2 pixels)` },
    { name: 'Brightness', ok: vOk, text: vOk == null ? 'The catalogue gives no brightness' : vOk ? `V ${it.vmag.toFixed(1)}, bright enough for one SPHEREx image` : `V ${it.vmag.toFixed(1)} is too faint for one SPHEREx image (needs V ${PROOF.vLimit} or brighter)` },
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
    imagesPerEpoch: multi() ? S.slots.length : 1, imagesPerEpochAll: S.eps.map((_, e) => epochImgs(e).length),
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
    if (inPlane()) c.append(h('p', { class: 'warnbox' }, h('b', {}, 'Milky Way plane. '), PLANE_TXT + ' ', h('a', { href: '#', onclick: e => { e.preventDefault(); drawer(true, 'tdrawer'); setTimeout(() => $('ntv').scrollIntoView(), 350); } }, 'See the test')));
    const nConf = r.candidates.filter(k => k.status === 'confirmed').length, nArt = r.candidates.filter(k => k.status === 'artefact').length;
    c.append(h('p', {}, h('b', {}, `Changes between epochs (${r.candidates.length}: ${nConf} known asteroid${nConf === 1 ? '' : 's'}, ${nArt} likely artefact${nArt === 1 ? '' : 's'}, ${r.candidates.length - nConf - nArt} unconfirmed)`)));
    if (!r.candidates.length) c.append(h('p', { style: 'font-size:.82rem;color:var(--dust)' }, q && !q.ok ? 'None reported (see the data check above).' : 'Nothing changed above the threshold between the first and last epoch.'));
    r.candidates.slice(0, 10).forEach(k => c.append(h('button', { class: 'mv', onclick: () => { S.al.gotoRaDec(k.to.ra, k.to.dec); S.al.setFov(0.12); showCand(k); } },
      h('b', {}, `C${k.id} ${k.kind === 'pair' ? 'moved' : k.kind === 'new' ? 'appears' : 'vanishes'}`),
      h('small', {}, (k.kind === 'pair' ? `${k.sepArcsec.toFixed(0)}″ (${fmtRate(k.rateArcsecPerYear)}) · ` : '') + `${k.snr.toFixed(0)}σ · ` +
        (k.status === 'confirmed' ? '✓ known asteroid ' + k.knownMatch : k.status === 'artefact' ? (k.proof && k.proof.reason === 'glare' ? 'glare of a bright star that changed' : 'likely artefact (too sharp)') : k.status === 'near' ? 'near ' + k.proof.near.name + ', not a match' : 'unconfirmed')))));
  }
  if (S.inside) {
    const ins = S.inside, conf = ins.asteroids.filter(x => x.confirmed);
    c.append(h('p', {}, h('b', {}, `Caught moving inside an epoch (${conf.length} known asteroid${conf.length === 1 ? '' : 's'})`)));
    if (!ins.asteroids.length) c.append(h('p', { style: 'font-size:.82rem;color:var(--dust)' }, 'No known asteroid was seen moving between the visits of an epoch.'));
    ins.asteroids.slice(0, 8).forEach(x => c.append(h('button', { class: 'mv', onclick: () => { S.al.gotoRaDec(x.sightings[0].ra, x.sightings[0].dec); S.al.setFov(0.3); showAsteroid(x); } },
      h('b', {}, (x.confirmed ? '✓ ' : '') + x.name), h('small', {}, `V ${Number.isFinite(x.vmag) ? x.vmag.toFixed(1) : '?'} · seen in ${x.sightings.length} image${x.sightings.length === 1 ? '' : 's'} of epoch ${x.sightings[0].e + 1}` + (x.confirmed ? '' : ' · a check fails')))));
    c.append(h('p', { style: 'font-size:.78rem;color:var(--dust)' }, `Other sources at one visit only, matching no known object: ${ins.unRepeat || 0} seen in two exposures in a row ` +
      `(an unknown or faint mover, or a detector artefact), ${ins.unOnce || 0} in a single image with nothing to check against. All unconfirmed; none is claimed as a discovery. ` +
      `Only the ones seen in two exposures in a row are marked "?" in Time machine and Blink. They are not linked to each other: with 3 or 4 visits per pass, two dots can always be joined by a line, so a link would be a guess.`));
  }
  c.append(h('p', {}, h('b', {}, `Known objects in field (${r.knownObjects.length})`)));
  if (!r.knownObjects.length) c.append(h('p', { style: 'font-size:.82rem;color:var(--dust)' }, 'None listed by the orbit catalogue inside this footprint.'));
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
    { name: 'Position', ok: worst <= tol, text: `${sg.length === 1 ? '' : 'Every sighting is '}${worst.toFixed(1)}″ or less from where ${KS()} predicts it at that image's time (limit ${tol}″)` },
    { name: 'Brightness', ok: a.vOk, text: Number.isFinite(a.vmag) ? `V ${a.vmag.toFixed(1)}${a.vOk ? ', bright enough for one SPHEREx image' : ` is too faint for one SPHEREx image (needs V ${PROOF.vLimit} or brighter)`}` : 'The catalogue gives no brightness' },
    sg.some(x => x.repeat != null)
      ? { name: 'Repeat', ok: sg.some(x => x.repeat === true), text: sg.some(x => x.repeat === true) ? 'Also there in the exposure taken minutes earlier or later in the same visit. A cosmic ray hits only one exposure' : 'Not in the other exposure of the same visit, so it could be a cosmic ray' }
      : { name: 'Shape', ok: sg.some(x => x.shapeOk === true) ? true : sg.every(x => x.shapeOk === false) ? false : null, text: 'As blurred as the stars of the same image, so it is light from the sky, not a hot pixel' },
    { name: 'Gone at other visits', ok: true, text: `Nothing at this spot in the epoch's images taken more than 2.4 hours earlier or later` }];
  if (sg.length >= 2) {   // measured motion between the first and last sighting vs SkyBoT's predicted motion
    const A_ = sg[0], B_ = sg[sg.length - 1], mx = B_.x - A_.x, my = B_.y - A_.y, px = B_.pred.x - A_.pred.x, py = B_.pred.y - A_.pred.y;
    const diff = Math.hypot(mx - px, my - py) * arc, hours = (B_.mjd - A_.mjd) * 24;
    checks.push({ name: 'Motion', ok: diff <= 2 * PROOF.matchArcsec, text: `Moved ${fmtAng(Math.hypot(mx, my) * arc)} in ${fmtDur(hours)}; ${KS()} predicts ${fmtAng(Math.hypot(px, py) * arc)} (difference ${diff.toFixed(0)}″; positions are good to about one 6″ pixel)` });
  }
  const id = encodeURIComponent(a.name.replace(/^\d+\s+/, '')), mo = astMotion(a);
  c.append(h('h3', {}, a.name), h('span', { class: 'badge ' + (a.confirmed ? 'ok' : 'near') }, a.confirmed ? '✓ Confirmed known asteroid' : 'Matches a known object, but a check fails'),
    h('p', {}, `${a.cls || 'Asteroid'}, caught in ${sg.length} image${sg.length === 1 ? '' : 's'} of epoch ${e + 1}${sg.length > 1 ? `, ${fmtDur((sg[sg.length - 1].mjd - sg[0].mjd) * 24)} apart` : ''}.`),
    h('div', { class: 'proof' + (crops.length > 2 ? ' four' : '') }, ...crops),
    h('p', { class: 'legend' }, 'Dashed circle: what SPHEREx saw. + : where the orbit catalogue predicts it at that moment. All crops share one brightness scale.'),
    ...(mo ? [h('p', {}, h('b', {}, 'Track: '), `moving ${mo.v.toFixed(1)}″ per hour (about ${mo.pxh.toFixed(1)} SPHEREx pixels per hour) toward the ${mo.dir} (on the sky east is to the left), from its known orbit (${KS()}). ` +
      (a.confirmed ? `The green arrow on the image where SPHEREx saw it shows where it goes in the next ${mo.hours} hours, one tick per ${mo.hours <= 12 ? 'hour' : '3 hours'}.` : ''))] : []),
    h('ul', { class: 'checks' }, ...checks.map(x => h('li', { class: x.ok === true ? 'pass' : x.ok === false ? 'fail' : '' }, h('b', {}, (x.ok === true ? '✓ ' : x.ok === false ? '✗ ' : '? ') + x.name + ': '), x.text))),
    h('p', { style: 'font-size:.8rem' }, 'Check it yourself: ', h('a', { href: 'https://minorplanetcenter.net/db_search/show_object?object_id=' + id, target: '_blank', rel: 'noopener' }, 'Minor Planet Center'), ' · ',
      h('a', { href: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=' + id, target: '_blank', rel: 'noopener' }, 'JPL SBDB')),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'A known asteroid that SPHEREx recorded. Not a new discovery.'),
    h('button', { class: 'hbtn', onclick: () => replayAsteroid(a) }, '▶ Replay its track'), ' ',
    h('button', { onclick: () => { S.bi = e; S.al.gotoRaDec(s0.ra, s0.dec); S.al.setFov(0.3); setMode('blink'); } }, 'Watch it in Blink'), ' ',
    h('button', { class: 'cardb', onclick: makeCard }, 'Discovery card (GIF)'), ' ',
    h('button', { onclick: showReport }, 'Back to report'));
}
// v0.32: a source seen at one visit only, matching no known object. Shown honestly: no path is drawn.
function showUnknown(u) {
  S.sel = { unk: u }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const frOf = im => S.frames.get(im.url), fr = frOf(u.im), top = fr ? F.sampleMax(seeOf(fr), S.field.n, u.x, u.y) - fr.st.med : 0;
  const away = epochImgs(u.e).filter(im => Math.abs(im.mjd - u.mjd) > 0.1 && frOf(im)).sort((p, q) => Math.abs(p.mjd - u.mjd) - Math.abs(q.mjd - u.mjd))[0];
  const when = im => `${fmtDay(im.mjd)} ${mjdDate(im.mjd).toISOString().slice(11, 16)}`;
  const crops = [cropAt(fr, u, null, top, 'This image', when(u.im))]; if (away) crops.push(cropAt(frOf(away), u, null, top, 'Other visit: nothing here', when(away)));
  const pos = `${u.ra.toFixed(4)} ${u.dec >= 0 ? '+' : ''}${u.dec.toFixed(4)}`;
  c.append(h('h3', {}, 'Seen once, not linked'), h('span', { class: 'badge unc' }, 'Unconfirmed'),
    h('p', {}, `A dot in epoch ${u.e + 1}, seen at one visit only (${Number.isFinite(u.snr) ? u.snr.toFixed(0) + 'σ' : 'faint'}). ` +
      'It is also in the exposure taken minutes later in the same visit, so it is not a cosmic ray. ' +
      'No known object is listed at this spot at that moment.'),
    h('div', { class: 'proof' }, ...crops),
    h('p', {}, h('b', {}, 'Why no path is drawn: '), 'SPHEREx sees this field only 3 or 4 times per pass, hours to days apart, and most asteroids leave the field in between. ' +
      'Two dots can always be joined by a line, so linking this one to a dot in another image would be a guess. We checked our busiest asteroid field: no dot lined up in 3 images.'),
    h('p', {}, h('b', {}, 'What it could be: '), 'an asteroid missing from the catalogue, a known one fainter or off its predicted spot, or a detector artefact. Not a discovery claim.'),
    h('p', { style: 'font-size:.8rem' }, 'Check this spot in other surveys: ', h('a', { href: 'https://aladin.cds.unistra.fr/AladinLite/?target=' + encodeURIComponent(pos) + '&fov=0.05', target: '_blank', rel: 'noopener' }, 'Aladin sky atlas'),
      '. If other surveys show a star here, it is a fixed source, not a mover.'),
    h('button', { class: 'hbtn', onclick: () => { S.al.gotoRaDec(u.ra, u.dec); S.al.setFov(0.08); } }, 'Zoom here'), ' ', h('button', { onclick: showReport }, 'Back to report'));
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
    h('p', { class: 'legend' }, 'Dashed circle: the change. ', k.proof && k.proof.near ? h('span', {}, '+ : where the orbit catalogue predicts ' + k.proof.near.name + '.') : ''),
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
  } else c.append(h('p', {}, h('b', {}, 'Known object: '), 'none within 49″ (orbit catalogue)'));
  c.append(h('p', { style: 'font-size:.8rem;color:var(--dust)' }, st === 'confirmed'
      ? 'This change is a known asteroid seen by SPHEREx: it sits where the orbit catalogue predicts and is bright enough. Not a new discovery.'
      : st === 'artefact' && k.proof && k.proof.reason === 'glare' ? 'ARCNAVE does not count this as a change: a very bright star next to it changed brightness, so the glare around it changed. Look in Blink: the whole halo grows or shrinks.' : st === 'artefact' ? 'ARCNAVE does not count this as a change. Checking several images from the same epoch would settle it: a cosmic ray is in only one of them.'
      : 'Unconfirmed. It could be a real change, a variable star, or an image artefact. Look at both epochs in Blink view before believing it.'),
    h('button', { class: 'hbtn', onclick: () => { S.al.gotoRaDec(k.to.ra, k.to.dec); S.al.setFov(0.08); } }, 'Zoom here'), ' ', h('button', { class: 'cardb', onclick: makeCard }, 'Discovery card (GIF)'), ' ', h('button', { onclick: showReport }, 'Back to report'));
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
    return frs.length && st ? { frames: frs.map(f => ({ flat: f.flat, touched: f.touched, mjd: f.im.mjd, lam: lamOf(f.im) })).sort((p, q) => p.mjd - q.mjd), stack: { flat: st.flat, touched: st.touched, st: st.st } } : null; };
  const A = ep(a), B = ep(b); if (!A || !B) return { error: `The images of epochs ${a + 1} and ${b + 1} are not loaded yet.` };
  const f = S.field, dt = B.frames[0].mjd - A.frames[0].mjd;
  const ctx = SkyPlanetX.makeContext(F, [A, B], { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, { maxSep: STAR_PM_MAX * Math.abs(dt) / 365.25 / (PX * 3600), matchRadius: MATCH_PX, sharpFrac: PROOF.sharpFrac });
  if (!ctx.psf) return { error: 'Not enough bright, isolated stars in this field to measure the telescope blur.' };
  ctx.limit = SkyPlanetX.expectedLimit(ctx); ctx.a = a; ctx.b = b; ctx.earthAU = best;
  S.px.ctx = ctx; S.px.key = key; S.px.map = null; updateLabels(); return ctx;
}
async function pxHide() {
  const ctx = pxContext(); if (ctx.error) { $('pxt').textContent = ctx.error; return; }
  // v0.57.9: one trial takes about 0.5 s; the page says so first and paints, then works (the click no longer looks dead)
  if (PXH.busy) return; PXH.busy = true; const b = $('pxgo'); if (b) b.disabled = true; stat('Hiding a fake planet, the agents are looking for it...');
  try { await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); pxHideNow(ctx); } finally { PXH.busy = false; if (b) b.disabled = false; }
}
const PXH = { busy: false };
function pxHideNow(ctx) {
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
  if (e0.moveDuringEpochPx > 2.5 && r.orbitPx && r.orbitPx[0] > 1) return `At ${r.dist} AU it moves ${(e0.moveDuringEpochPx * PX * 3600).toFixed(0)}″ during one pass (${e0.spanDays.toFixed(1)} days), so the plain median of the pass's images wipes it out. Stacking along its path does not help here: its own orbit (unknown in a real search) moves it another ${(r.orbitPx[0] * PX * 3600).toFixed(0)}″ in that time, too much to line it up.`;
  if (e0.moveDuringEpochPx > 2.5) return `At ${r.dist} AU it moves ${(e0.moveDuringEpochPx * PX * 3600).toFixed(0)}″ during one pass (${e0.spanDays.toFixed(1)} days), so the plain median of the pass's images wipes it out, and even stacked along its path it did not stand out (${fainter > -0.3 ? 'too faint for this field' : 'it landed on or next to a star'}).`;
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
  const sh = r.shift || {}, shTxt = [[ctx.a, sh.snrA], [ctx.b, sh.snrB]].filter(([, v]) => v != null && v >= 5).map(([e, v]) => `epoch ${e + 1}: ${v.toFixed(0)}σ`).join(', ');
  if (r.found && !r.foundPlain) c.append(h('p', {}, `Found only by the motion-following stack (${shTxt}): it moves ${(r.epochs[0].moveDuringEpochPx * PX * 3600).toFixed(0)}″ during one pass, so the plain median of the pass's images wipes it out; shifting each image back along the path a body ${r.dist} AU away would follow, then stacking, keeps it.`));
  else if (r.found) c.append(h('p', {}, both ? `Seen in epoch ${ctx.a + 1} (${r.hitA.snr.toFixed(0)}σ) and in epoch ${ctx.b + 1} (${r.hitB.snr.toFixed(0)}σ).`
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
// The detectability map with the settings every user sees (also used by the validation scorecard, so both agree).
async function pxMapRun(ctx) {
  const L = Math.round(ctx.limit.ab * 2) / 2, mags = []; for (let m = L - 3; m <= L + 1.5 + 1e-9; m += 0.5) mags.push(+m.toFixed(2));
  const pos = SkyPlanetX.trialPositions(ctx.epochs[0].stack.flat, S.field.n, PXM.positions, 25, 7), t0 = performance.now();
  const res = await SkyPlanetX.map(ctx, { dists: PXM.dists, mags, positions: pos, progress: async q => { $('pxs').textContent = `Hiding ${PXM.dists.length * mags.length * pos.length} fake planets... ${Math.round(q * 100)}%`;
    // a hidden tab clamps timers to about once a minute, which made the scorecard map take 15 min instead of 15 s (seen
    // live); nobody sees the progress then, so only yield to the page while it is visible
    if (!document.hidden) await sleep(0); } });
  res.ms = Math.round(performance.now() - t0); res.limit = ctx.limit; return res;
}
async function pxMap() {
  const ctx = pxContext(); if (ctx.error) { $('pxt').textContent = ctx.error; return; }
  if (S.px.busy) return; S.px.busy = true; $('pxmap').disabled = true; pxStat(ctx);
  try {
    const run = S.run, res = await pxMapRun(ctx);
    if (run !== S.run) return;
    S.px.map = res; drawPxMap(res);
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
  const at = d => { const l = m.limits.find(x => x.dist === d); return l ? l.ab50 : null; }, l1000 = at(1000), l300 = at(300);
  const ep = S.px.ctx && S.px.ctx.epochs[0], span = ep ? Math.max(...ep.frames.map(f => f.mjd)) - Math.min(...ep.frames.map(f => f.mjd)) : null;
  const lim = d => { const v = at(d); return v != null ? `down to AB ${v.toFixed(1)} (${fmtMJy(SkyPlanetX.abToMJy(v))})` : null; };
  $('pxs').innerHTML = '';
  $('pxs').append(h('span', {}, h('b', {}, l1000 != null ? `A planet 1000 AU away is found at least half the time ${lim(1000)}. ` : 'Not even a bright planet 1000 AU away is found half the time here. '),
    l300 != null ? `At 300 AU: ${lim(300)}. ` : `At 300 AU it is missed even when bright (the images of one pass here are spread over ${span != null ? span.toFixed(0) + ' days' : 'many days'}). `,
    `The noise alone predicts AB ${m.limit.ab.toFixed(1)}. ${m.cells.length * m.positions} fake planets, ${(m.ms / 1000).toFixed(0)} s. Other misses at bright levels: the planet sat on a brighter star or moved too little between the passes. `,
    m.limitsPlain ? (() => { const p = d => { const l = m.limitsPlain.find(x => x.dist === d); return l && l.ab50 != null ? 'AB ' + l.ab50.toFixed(1) : 'missed'; };
      return `Without the motion-following stack (images shifted back along the planet's path before stacking): 1000 AU ${p(1000)}, 300 AU ${p(300)}, 100 AU ${p(100)}.`; })() : ''));
  // compare with the validation scorecard (other fields of the sky), when this copy has one
  if (l1000 != null) loadScorecard().then(sc => { if (!sc || !sc.summary || !sc.summary.at1000 || S.px.map !== m) return;
    const v = sc.summary.at1000, w = sc.summary.at300;
    $('pxs').append(h('span', {}, ` Across the ${v.of} fields of the validation scorecard, 1000 AU planets are found down to AB ${v.min.toFixed(1)} to ${v.max.toFixed(1)} (median ${v.median.toFixed(1)}); 300 AU planets in ${w.found} of ${w.of}. `,
      h('a', { href: '#', onclick: e => { e.preventDefault(); drawer(true, 'tdrawer'); $('scv').scrollIntoView(); } }, 'See all fields')));
  });
}

// v0.21: the base sky comes through this site (/hips/...), which takes the tiles from NASA/IPAC IRSA's mirror of the CDS
// HiPS (or other mirrors) and keeps them. Seen live: CDS unreachable from a network, and the page showed no sky at all.
const SKY_URL = { 'P/2MASS/color': '/hips/2mass', 'P/allWISE/color': '/hips/allwise', 'P/DSS2/color': '/hips/dss2' };
const skyUrl = id => id === 'spherex' ? `${location.origin}/hips/sphx${spxFrameFor(S.band || 3)}` : SKY_URL[id] ? location.origin + SKY_URL[id] : id;

/* ---------- boot ---------- */
function boot() {
  const p = new URLSearchParams(BOOT_HASH.slice(1)), has = p.has('ra') && !(+p.get('fov') > 40);   // a zoomed-out link opens the whole sky
  // v0.14: with no link to follow, open on the WHOLE sky (Aitoff, Milky Way across the middle), not on one patch
  const o = { target: has ? `${p.get('ra')} ${p.get('dec')}` : '266.405 -28.936', fov: has ? +p.get('fov') || 1.2 : 360, survey: skyUrl('P/2MASS/color'), cooFrame: has ? 'ICRSd' : 'galactic', projection: has ? 'SIN' : 'AIT',
    showReticle: false, showZoomControl: false, showFullscreenControl: false, showLayersControl: false, showGotoControl: false, showFrame: false,
    showProjectionControl: false, showCooGridControl: false, showContextMenu: false, showSimbadPointerControl: false, showShareControl: false,
    showCooLocation: false, showFov: false, showStatusBar: false, log: false };   // v0.38: no usage ping to CDS ("no tracking"; it timed out in the console)   // v0.4.1: no Aladin coordinate box over our title (our RA/Dec panel shows the same)
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
  if (!has) { wholeSky(false); loadScorecard(); }
  setTimeout(prepPool, 1500);   // v0.14.3: start the image workers early, so the first field does not wait for them   // the scorecard's 18 test fields are drawn on the whole-sky map
  if (p.has('scorecard')) { scorecardRun(p); return; }
  if (p.has('prewarm')) { prewarmRun(p); return; }
  if (p.has('nulltest')) { nullRun(p); return; }
  if (p.has('movertest')) { moverRun(p); return; }   // v0.55
  if (p.has('brighttest')) { brightRun(p); return; }
  if (p.has('tour') || p.has('guide')) { let k = 0; const go = () => window.Tour ? Tour.start(p.has('guide') ? 'guide' : 'story') : k++ < 100 && setTimeout(go, 50); go(); return; }   // tour.js may load after boot
  if (p.has('play')) { startGame(); return; }
  if (EMBED) {   // v0.34: the bare sky as a flip-book, for other web pages (iframe); everything else hidden by CSS
    $('intro').hidden = true;
    const el = $('embedbar'); el.hidden = false; el.querySelector('a').href = location.origin + location.pathname + BOOT_HASH.replace(/([#&])embed=1&?/, '$1');
    if (p.get('ct') && CHALLENGE[p.get('ct')]) { runChallenge(p.get('ct')); return; }
    if (has) { runAgents({ ra: +(p.get('fra') ?? p.get('ra')), dec: +(p.get('fdec') ?? p.get('dec')), label: 'Embedded view' }, { focus: 'embed', band: p.has('b') ? S.band : undefined }); return; }
  }
  if (p.get('ex') && EXAMPLES[p.get('ex')]) { runExample(p.get('ex')); return; }
  if (p.get('ct') && CHALLENGE[p.get('ct')]) { $('intro').hidden = true; runChallenge(p.get('ct')); return; }
  if (has && p.get('load') === '1') { $('intro').hidden = true; runAgents({ ra: +(p.get('fra') ?? p.get('ra')), dec: +(p.get('fdec') ?? p.get('dec')), label: 'Shared view' }, { skipNav: true, keepMode: true, band: p.has('b') ? S.band : undefined }); }   // a shared link keeps its colour
}
if (typeof A === 'undefined') {
  stat('Aladin Lite failed to load (check your internet connection).', true); $('intro').hidden = true;
} else (A.init && A.init.then ? A.init : Promise.resolve()).then(boot).catch(e => stat('Sky viewer failed to start: ' + e.message, true));

/* ---------- Phone layout (v0.11): one bottom sheet at a time ---------- */
// Below 700 px the controls, the agents and the result card share one bottom sheet, picked in a bottom bar, so nothing
// overlaps and the sky stays visible. Tapping the open one folds it away. A run opens Agents, a result opens Result; a
// result that changes while another sheet is open lights a dot on Result instead of jumping there.
function phoneSheet(s) {
  const nav = $('mnav'); if (!nav) return;
  document.body.dataset.sheet = s;
  nav.querySelectorAll('[data-sheet]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sheet === s)));
  if (s === 'card') nav.querySelector('.dot').hidden = true;
}
(() => {
  const nav = $('mnav'), card = $('card'); if (!nav) return;
  nav.hidden = false;
  nav.querySelectorAll('[data-sheet]').forEach(b => b.onclick = () => phoneSheet(document.body.dataset.sheet === b.dataset.sheet ? 'none' : b.dataset.sheet));
  let was = card.hidden;
  new MutationObserver(() => {
    if (was && !card.hidden) phoneSheet('card');
    else if (!card.hidden && document.body.dataset.sheet !== 'card') nav.querySelector('.dot').hidden = false;
    else if (card.hidden && document.body.dataset.sheet === 'card') phoneSheet('panel');
    was = card.hidden;
  }).observe(card, { attributes: true, attributeFilter: ['hidden'], childList: true });
  $('pxgo').addEventListener('click', () => setTimeout(() => { if (!card.hidden) phoneSheet('card'); }, 60));   // a hidden planet's result is what the user asked for
  phoneSheet('panel');
})();

/* ---------- Prewarm (v0.26, local runs only): demo fields ready before the public site goes up ---------- */
// Open http://localhost:8081/#prewarm on a local run. The agents run on each demo field one after another (8 images per
// epoch, 0.5 deg), exactly as a visitor would; the images, the archive answers and the known-object answers land in cache/.
// Then `node tools/export-demo-cache.js cache --newer-than 90` copies them into demo-cache/, which ships with the site, is
// seeded at start and never pruned. #prewarm&fields=150.8,12.4;265.2,-28.9 runs your own list.
const PREWARM = [{ ra: 150.8, dec: 12.4 }, { ra: 265.2, dec: -28.9 }, { ra: 134, dec: 5.6 }, { ra: 326.25, dec: 7.25 }];
async function prewarmRun(p) {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) { stat('Prewarm runs only on a local copy.', true); return; }
  $('intro').hidden = true; S.depth = 8; S.noQuick = true; $('ipe').value = '8'; $('csize').value = '0.5';
  const mine = (p.get('fields') || '').split(';').map(x => x.split(',').map(Number)).filter(([ra, dec]) => isFinite(ra) && isFinite(dec) && ra >= 0 && ra < 360 && Math.abs(dec) <= 90).map(([ra, dec]) => ({ ra, dec }));
  // v0.38: #prewarm=targets runs the five NASA challenge targets and the two examples through the SAME path a visitor's tap takes
  // (runChallenge / runExample), then loads the Gaia layer for each, so the answers a judge needs first are on the disk.
  const tg = p.get('prewarm') === 'targets' || p.has('targets');
  const targets = () => [...Object.keys(CHALLENGE).map(id => ({ ct: id, name: CHALLENGE[id].name })), ...Object.keys(EXAMPLES).map(id => ({ ex: id, name: EXAMPLES[id].label }))];
  // v0.56: #prewarm=start runs every place the start screen offers: the 18 test fields and 5 landmarks on the whole-sky map
  // (with the same RA/Dec a click sends, so the same cache entries), then the NASA targets and the examples. Afterwards
  // `node tools/pin-cache.js --newer-than <minutes>` keeps them in the cache for good.
  let start = null;
  if (p.get('prewarm') === 'start') { let rows = []; try { rows = (await (await fetch('/scorecard.json')).json()).rows || []; } catch { /* no test fields */ }
    start = [...rows.map(r => ({ ra: r.ra, dec: r.dec, name: 'Test field ' + r.id })), ...LANDMARKS.map(m => ({ ra: m.ra, dec: m.dec, name: m.name })), ...targets()]; }
  const list = start || (tg ? targets() : mine.length ? mine : PREWARM), out = [];
  for (const [i, f] of list.entries()) {
    const t0 = performance.now(), r = f.ct || f.ex ? { name: f.name } : { ra: f.ra, dec: f.dec };
    stat(`Prewarm ${i + 1} of ${list.length}: ${f.name || `RA ${f.ra}, Dec ${f.dec}`}`);
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 15 min')), 15 * 60e3));
      const job = f.ct ? runChallenge(f.ct) : f.ex ? runExample(f.ex) : runAgents({ ra: f.ra, dec: f.dec, label: f.name || `Prewarm ${i + 1}` });
      try { await Promise.race([job, timeout]); } catch (e) { S.run++; throw e; }
      if (f.ct || f.ex || start) { try { GAIA.on = true; GAIA.key = null; await gaiaLoad(); r.gaia = !!(GAIA.data && GAIA.data.stars); } catch { r.gaia = false; } }
      if (start) { try { await cwLoad(); r.catwise = !!CW.data; } catch { r.catwise = false; } }   // v0.56: the film's WISE movers too
      r.report = !!S.report; r.found = S.images.length; r.perEpoch = S.eps.map((_, e) => epochImgs(e).length); r.images = r.perEpoch.reduce((a, n) => a + n, 0);
      const bad = AGENTS.map(([k]) => S.ag[k] || {}).find(a => a.state === 'err'); if (bad) r.error = bad.msg;
    } catch (e) { r.error = e.message; }
    r.secs = Math.round((performance.now() - t0) / 1000); out.push(r);
    console.log('prewarm', JSON.stringify(r));
  }
  window.__prewarm = out;
  const ok = out.filter(r => r.report && !r.error).length;
  stat(`Prewarm done: ${ok} of ${out.length} fields ready (${out.map(r => `${r.name || 'RA ' + r.ra}: ${r.error ? 'failed, ' + r.error : r.images + ' images (' + r.perEpoch.join(' + ') + '), ' + r.secs + ' s'}`).join('; ')}). Next: node tools/export-demo-cache.js cache --newer-than 120`, ok < out.length);
}

/* ---------- Validation scorecard (v0.12, local runs only) ---------- */
// Open http://localhost:8081/#scorecard on a local run. The agents and the Hide Planet X map run, exactly as a user would
// run them (8 images per epoch, 0.5 deg field), on a grid of fields FIXED IN ADVANCE: ecliptic longitude 0, 60 ... 300
// deg x ecliptic latitude 0, +40, -40 deg. The grid is not chosen from results, and every field is reported, including
// those with no data or that fail. Each result goes to scorecard/<id>.json (server.js). #scorecard&from=5 resumes at the
// 6th field, #scorecard&only=L060B+40 runs one.
const SCORE_GRID = (() => {
  const eps = 23.4392911 * Math.PI / 180, d = Math.PI / 180, out = [];
  for (const B of [0, 40, -40]) for (const Lo of [0, 60, 120, 180, 240, 300]) {
    const l = Lo * d, b = B * d;
    const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
    const ra = (Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l)) / d + 360) % 360;
    const an = 192.85948 * d, dn = 27.12825 * d;   // north galactic pole (J2000)
    const gb = Math.asin(Math.sin(dec) * Math.sin(dn) + Math.cos(dec) * Math.cos(dn) * Math.cos(ra * d - an)) / d;
    out.push({ id: `L${String(Lo).padStart(3, '0')}B${B >= 0 ? '+' : '-'}${String(Math.abs(B)).padStart(2, '0')}`, eclLon: Lo, eclLat: B,
      ra: +ra.toFixed(4), dec: +(dec / d).toFixed(4), galLat: +gb.toFixed(1) });
  }
  return out;
})();
async function scorecardRun(p) {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) { stat('The scorecard runs only on a local copy.', true); return; }
  $('intro').hidden = true; S.depth = 8; S.noQuick = true; $('ipe').value = '8'; $('csize').value = '0.5';
  const only = p.get('only'), from = +p.get('from') || 0;
  // #scorecard&test=1: the demo field only (its data ships in demo-cache), to check the runner without downloads
  const list = p.has('test') ? [{ id: 'TEST_demo', eclLon: null, eclLat: null, ra: 189.957, dec: -4.182, galLat: 58.6 }]
    : only ? SCORE_GRID.filter(f => f.id === only) : SCORE_GRID.slice(from);
  const all = [];
  for (const [i, f] of list.entries()) {
    const out = { ...f, version: '0.30', depth: S.depth, fieldDeg: 0.5, startedAt: new Date().toISOString() }, t0 = performance.now();
    stat(`Scorecard ${i + 1} of ${list.length}: ${f.id} (RA ${f.ra}, Dec ${f.dec})`);
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 20 min')), 20 * 60e3));
      try { await Promise.race([runAgents({ ra: f.ra, dec: f.dec, label: 'Scorecard ' + f.id }), timeout]); }
      catch (e) { S.run++; throw e; }   // S.run++ cancels the stuck run
      out.agentSecs = Math.round((performance.now() - t0) / 1000);
      out.agents = AGENTS.map(([k]) => ({ id: k, state: (S.ag[k] || {}).state, msg: (S.ag[k] || {}).msg }));
      out.images = S.images.length; out.epochs = S.eps.length; out.perEpoch = S.slots.length;   // images per epoch really used (fewer when colours do not match)
      out.epochDates = S.eps.map(e => fmtMonth(e.t0));
      out.candidates = S.cands.length; out.knownInField = S.known.length;
      const bad = out.agents.find(a => a.state === 'err');
      if (bad) { out.status = 'error'; out.error = bad.msg; }
      else if (!S.report) { out.status = 'error'; out.error = 'no report'; }
      else if (S.eps.length < 2) { out.status = 'one-epoch'; }
      else {
        // with one image per epoch the other epochs' images load in the background after the report (prefetchEpochs):
        // wait for them (seen live on L300B+00: the map was tried before they arrived)
        let ctx = pxContext();
        for (let k = 0; k < 120 && ctx.error && /not loaded/.test(ctx.error); k++) { await sleep(1500); ctx = pxContext(); }
        if (ctx.error) { out.status = /not loaded/.test(ctx.error) ? 'error' : 'no-psf'; out.error = ctx.error; }
        else {
          out.pair = [ctx.a + 1, ctx.b + 1]; out.earthAU = +ctx.earthAU.toFixed(2);
          out.psf = { stars: ctx.psf.nStars, fwhmArcsec: +(ctx.psf.fwhmPx * PX * 3600).toFixed(1), method: ctx.psf.method };
          out.noiseLimitAB = +ctx.limit.ab.toFixed(2);
          const m = await pxMapRun(ctx);
          out.map = { limits: m.limits, limitsPlain: m.limitsPlain, cells: m.cells.map(c => [c.dist, c.ab, c.found, c.both, c.of, c.plain]), positions: m.positions, ms: m.ms };   // v0.30: + plain (no motion-following stack)
          // v0.30: the motion-following stack over the whole real field with no fake planet (false alarms of that method here)
          try { out.shiftScan = SkyPlanetX.shiftScan(ctx, PXM.dists); } catch (e) { out.shiftScanError = e.message; }
          const far = m.limits.filter(l => l.dist >= 300 && l.ab50 != null).map(l => l.ab50);
          out.limitAB300plus = far.length ? Math.min(...far) : null;   // the worst of the 300-1000 AU limits (conservative)
          out.status = 'ok';
        }
      }
    } catch (e) { out.status = out.status || 'error'; out.error = e.message; }
    out.totalSecs = Math.round((performance.now() - t0) / 1000);
    all.push(out);
    try { await fetch('/api/dev/scorecard', { method: 'POST', body: JSON.stringify(out) }); } catch (e) { console.warn('scorecard save failed', e); }
    window.__scorecard = all;
  }
  const ok = all.filter(r => r.status === 'ok');
  stat(`Scorecard done: ${all.length} fields, ${ok.length} measured. Results in the scorecard folder.`);
  try { await fetch('/api/dev/scorecard', { method: 'POST', body: JSON.stringify({ id: p.has('test') ? 'summary_test' : only ? 'summary_' + only : from ? 'summary_from' + from : 'summary', fields: all.map(r => ({ id: r.id, status: r.status, limitAB300plus: r.limitAB300plus ?? null, noiseLimitAB: r.noiseLimitAB ?? null, error: r.error || null })) }) }); } catch { /* the per-field files are already saved */ }
}

/* ---------- False-alarm test (v0.29, local runs only) ---------- */
// Open http://localhost:8081/#nulltest on a local run. On the same 18 fields as the scorecard the agents run as usual; then,
// for every pair of passes, two "swapped" stacks are built: X takes colour 1 from pass a, colour 2 from pass b, colour 3 from
// pass a ...; Y takes the other image of every colour. Both stacks hold the same 8 colours and the same mix of dates, so
// NOTHING real differs between them (a star is in both; something that moved between the passes is in half the images of
// each and the median removes it from both). Every change the Analyst's own detector and checks (findTransients, shape,
// repeat) report between X and Y is therefore a false alarm. Same depth (8 images) as the real comparison.
// Control: 16 fake point sources of a known brightness are added to Y only, and must still be found, so a zero is not a
// broken detector. Results go to scorecard/null_<id>.json. #nulltest&test=1 = the shipped demo field; &only=L060B+40; &from=5.
function nullSplit(a, b) {
  const f = S.field, n = f.n, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n };
  const pairs = S.slots.map(sl => [sl[a], sl[b]].map(im => im && S.frames.get(im.url))).filter(([p, q]) => p && q);
  const out = { pair: [a + 1, b + 1], colours: pairs.length };
  if (pairs.length < 4) return { ...out, skipped: 'fewer than 4 colours with an image in both passes' };
  const mk = hf => { const ms = F.medianStack(hf.map(x => x.flat), n, { touched: hf.map(x => x.touched) });
    const touched = new Float32Array(n * n); for (let i = 0; i < touched.length; i++) touched[i] = ms.touched[i] >= 0.5 ? 1 : 0;
    return { flat: ms.flat, touched, st: F.robustStats(ms.flat), frames: hf }; };
  const X = mk(pairs.map((p, k) => p[k % 2])), Y = mk(pairs.map((p, k) => p[1 - k % 2]));
  if (!X.st || !Y.st) return { ...out, skipped: 'empty stack' };
  const opts = { maxSep: 0, matchRadius: MATCH_PX, touchedA: X.touched, touchedB: Y.touched };
  const t = F.findTransients(X.flat, Y.flat, n, grid, opts);
  const misaligned = t.nearMiss >= GATE.nearMissMin && t.nearMiss >= GATE.nearMissFrac * Math.max(1, t.matched);
  Object.assign(out, { matched: t.matched, nearMiss: t.nearMiss, misaligned, raw: t.cands.length, artefacts: 0, shown: 0, snr: [] });
  if (!misaligned) for (const c of t.cands) {   // misaligned: the app reports nothing, as in analyse()
    const seen = c.kind === 'gone' ? X : Y, p = c.kind === 'gone' ? (c.from || c) : (c.to || c), ref = starShape(seen);
    const sh = peakShape(seen.flat, n, p.x, p.y), sharp = sh != null && ref ? sh < PROOF.sharpFrac * ref.median : false;
    const cnt = seen.frames.filter(fr => { const v = F.snrAt(fr.flat, n, fr.st, p.x, p.y); return v !== null && v >= 3; }).length;
    const repBad = seen.frames.length > 1 && cnt < Math.max(2, Math.ceil(seen.frames.length / 2));
    if (sharp || repBad) out.artefacts++; else { out.shown++; out.snr.push(+c.snr.toFixed(1)); }
  }
  const SP = window.SkyPlanetX, P = SP && F.empiricalPSF && F.empiricalPSF(Y.flat, n, Y.st);
  if (P) {
    const psf = { psf: P.psf, R: P.half, side: P.size, peakFrac: P.peakFrac, at: P.at };
    out.control = [14, 15, 16].map(ab => {
      const sum = SP.mJyToPixelSum(SP.abToMJy(ab), f.s * 3600), spots = SP.trialPositions(Y.flat, n, 16, 20, 7 + ab), Yf = Float32Array.from(Y.flat);
      for (const s of spots) for (const [i, v] of SP.sourcePixels(psf, n, s.x, s.y, sum)) if (Yf[i] === Yf[i]) Yf[i] += v;
      const tc = F.findTransients(X.flat, Yf, n, grid, opts);
      return { ab, hidden: spots.length, found: spots.filter(s => tc.cands.some(c => c.kind === 'new' && Math.hypot(c.x - s.x, c.y - s.y) <= MATCH_PX)).length };
    });
  }
  return out;
}
async function nullRun(p) {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) { stat('The false-alarm test runs only on a local copy.', true); return; }
  $('intro').hidden = true; S.depth = 8; S.noQuick = true; $('ipe').value = '8'; $('csize').value = '0.5';
  const only = p.get('only'), from = +p.get('from') || 0;
  const list = p.has('test') ? [{ id: 'TEST_demo', eclLon: null, eclLat: null, ra: 189.957, dec: -4.182, galLat: 58.6 }]
    : only ? SCORE_GRID.filter(f => f.id === only) : SCORE_GRID.slice(from);
  const all = [];
  for (const [i, f] of list.entries()) {
    const out = { ...f, id: 'null_' + f.id, field: f.id, version: '0.29', depth: S.depth, fieldDeg: 0.5, startedAt: new Date().toISOString() }, t0 = performance.now();
    stat(`False-alarm test ${i + 1} of ${list.length}: ${f.id} (RA ${f.ra}, Dec ${f.dec})`);
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 20 min')), 20 * 60e3));
      try { await Promise.race([runAgents({ ra: f.ra, dec: f.dec, label: 'False-alarm test ' + f.id }), timeout]); } catch (e) { S.run++; throw e; }
      const bad = AGENTS.map(([k]) => S.ag[k] || {}).find(a => a.state === 'err');
      if (bad) throw new Error(bad.msg);
      if (!S.report) throw new Error('no report');
      // what a visitor is shown on this real field (between the passes), for comparison
      const rc = S.report.candidates || [];
      out.real = { epochs: S.eps.length, changes: rc.length, artefacts: rc.filter(k => k.status === 'artefact').length, confirmed: rc.filter(k => k.status === 'confirmed').length,
        unconfirmed: rc.filter(k => k.status === 'unconfirmed' || k.status === 'near').length };
      out.splits = []; for (let a = 0; a < S.eps.length; a++) for (let b = a + 1; b < S.eps.length; b++) out.splits.push(nullSplit(a, b));
      const ok = out.splits.filter(s => !s.skipped);
      out.comparisons = ok.length; out.falseAlarms = ok.reduce((s, x) => s + x.shown, 0); out.rawFlags = ok.reduce((s, x) => s + x.raw, 0);
      out.status = ok.length ? 'ok' : 'no-split';
    } catch (e) { out.status = 'error'; out.error = e.message; }
    out.totalSecs = Math.round((performance.now() - t0) / 1000);
    all.push(out); console.log('nulltest', JSON.stringify(out));
    try { await fetch('/api/dev/scorecard', { method: 'POST', body: JSON.stringify(out) }); } catch (e) { console.warn('save failed', e); }
    window.__nulltest = all;
  }
  const ok = all.filter(r => r.status === 'ok'), fa = ok.reduce((s, r) => s + r.falseAlarms, 0), hv = ok.reduce((s, r) => s + r.comparisons, 0);
  stat(`False-alarm test done: ${ok.length} of ${all.length} fields, ${hv} swapped comparisons, ${fa} false alarm${fa === 1 ? '' : 's'} shown in total. Results: scorecard/null_*.json`);
}

/* ---------- v0.55 mover test on the scorecard fields (local runs only) ----------
   Open http://localhost:8083/#movertest on a local run (the same 18 fields as the scorecard; &test=1 = the demo field;
   &only=L060B+40; &from=5). On each field the agents run as usual, then the deep search (its own result without fakes), then
   moverTest() exactly as the 🧪 button runs it. Results go to scorecard/mover_<id>.json; tools/build-movertest.js turns them
   into public/movertest.json, which the Tested drawer shows. */
async function moverRun(p) {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) { stat('The mover test runs only on a local copy.', true); return; }
  $('intro').hidden = true; S.depth = 8; $('ipe').value = '8'; $('csize').value = '0.5';
  const only = p.get('only'), from = +p.get('from') || 0;
  const list = p.has('test') ? [{ id: 'TEST_demo', eclLon: null, eclLat: null, ra: 189.957, dec: -4.182, galLat: 58.6 }]
    : only ? SCORE_GRID.filter(f => f.id === only) : SCORE_GRID.slice(from);
  const all = [];
  for (const [i, f] of list.entries()) {
    const out = { ...f, id: 'mover_' + f.id, field: f.id, version: '0.55', depth: S.depth, fieldDeg: 0.5, startedAt: new Date().toISOString() }, t0 = performance.now();
    stat(`Mover test ${i + 1} of ${list.length}: ${f.id} (RA ${f.ra}, Dec ${f.dec})`);
    try {
      const timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
      try { await Promise.race([runAgents({ ra: f.ra, dec: f.dec, label: 'Mover test ' + f.id }), timeout(20 * 60e3)]); } catch (e) { S.run++; throw e; }
      if (!S.report) throw new Error('no report');
      out.epochs = S.eps.length;
      if (S.eps.length < 3) { out.status = 'too-few-passes'; throw null; }
      await Promise.race([gaiaLoad(), timeout(60e3)]).catch(() => {});
      await Promise.race([deepSearch(), timeout(15 * 60e3)]); out.dsFlagged = DS.res && DS.res.run === S.run ? DS.res.flagged.length : null;
      MT.res = null; await Promise.race([moverTest(), timeout(20 * 60e3)]);
      const r = MT.res; if (!r || r.run !== S.run) throw new Error('mover test gave no result');
      const pulls = r.meas.filter(m => m.pE != null && m.fk.snr >= 6).flatMap(m => [m.pE, m.pN]);
      Object.assign(out, { status: 'ok', fakes: r.n, nImg: r.nImg, days: Math.round(r.days), SNR: r.SNR, MU: r.MU, floor: FLOOR.res ? +FLOOR.res.floor.toFixed(3) : null,
        cells: r.SNR.map(s => r.MU.map(u => { const l = r.meas.filter(m => m.fk.snr === s && m.fk.mu === u); return { n: l.length, meas: l.filter(m => m.ok).length, blind: l.filter(m => m.blind).length }; })),
        pulls: pulls.length, pullRms: pulls.length ? +Math.sqrt(pulls.reduce((a, v) => a + v * v, 0) / pulls.length).toFixed(3) : null,
        empty: r.nul.length, emptyFalse: r.nul.filter(x => x.stays && x.sig >= 5).length, emptyWander: r.nul.filter(x => x.wander).length, extra: r.extra });
    } catch (e) { if (e) { out.status = 'error'; out.error = e.message; } }
    out.totalSecs = Math.round((performance.now() - t0) / 1000);
    all.push(out); console.log('movertest', JSON.stringify(out));
    try { await fetch('/api/dev/scorecard', { method: 'POST', body: JSON.stringify(out) }); } catch (e) { console.warn('save failed', e); }
    window.__movertest = all;
  }
  const ok = all.filter(r => r.status === 'ok');
  stat(`Mover test done: ${ok.length} of ${all.length} fields measured. Results: scorecard/mover_*.json`); window.__movertestDone = true;
}

/* ---------- Brightness-change test (v0.31, local runs only) ---------- */
// Open http://localhost:8081/#brighttest on a local run (same 18 fields as the scorecard; &test=1 = the demo field;
// &only=L060B%2B40; &from=5). After the agents run, real stars of the field are made brighter by a known factor in every
// image of the last pass (their own light, pixel by pixel, times gain - 1, added on top), and the Changes view's own code
// (SkyFits.changeMaps, nsig 8, exactly as the app calls it) looks again. A star counts as caught when a change is reported
// on it in an image of that pass and it is not judged an artefact. Gain 1 (nothing added) = how often an unchanged star is
// reported anyway. The app's rule says a star must gain at least 25 % of its light to count, so 10 % should not be caught.
const BRIGHT_GAINS = [1, 1.1, 1.25, 1.5, 2, 3];
function brightStars(f, n, max) {
  const st = f.st, L = [];
  for (let y = 10; y < n - 10; y++) for (let x = 10; x < n - 10; x++) {
    const c = f.flat[y * n + x], snr = (c - st.med) / st.sigma; if (!(snr >= 20)) continue;
    let mx = true; for (let j = -1; j <= 1 && mx; j++) for (let i = -1; i <= 1; i++) if ((i || j) && !(f.flat[(y + j) * n + x + i] < c)) { mx = false; break; }
    if (mx) L.push({ x, y, snr, v: c - st.med });
  }
  // isolated: nothing above 10 % of its peak within 6 px
  const iso = L.filter(p => !L.some(q => q !== p && Math.hypot(q.x - p.x, q.y - p.y) < 6 && q.v > 0.1 * p.v));
  iso.sort((p, q) => q.snr - p.snr);
  // spread over brightness: every k-th star, so faint and bright ones are both in
  const k = Math.max(1, Math.floor(iso.length / max)); return iso.filter((_, i) => i % k === 0).slice(0, max);
}
function brightTrial(stars, e, gain) {
  const items = changeItems(), stacks = S.eps.map((_, i) => frameOf(i)), n = S.field.n, R = 4;
  const bump = (a, st) => { if (!a) return a; const o = Float32Array.from(a);
    for (const s of stars) for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const X = s.x + i, Y = s.y + j, q = Y * n + X, v = a[q];
      if (X < 0 || Y < 0 || X >= n || Y >= n || !(v === v) || Math.hypot(i, j) > R) continue; o[q] = v + (gain - 1) * Math.max(0, v - st.med); }
    return o; };
  const fr = items.map(o => { const mine = o.x.e === e && gain !== 1;
    return { flat: mine ? bump(o.fr.flat, o.fr.st) : o.fr.flat, keep: mine ? bump(o.fr.flatKeep, o.fr.st) : o.fr.flatKeep, st: o.fr.st, mjd: o.x.im.mjd, slot: multi() ? o.x.k : null, e: o.x.e }; });
  // the stack of the brightened pass is not rebuilt: changeMaps uses the stacks only for the colour picture, not for the test
  const r = F.changeMaps(stacks.map(f => ({ flat: f.flat, st: f.st })), fr, n, { nsig: 8, relBox: REL_BOX });
  return stars.map(s => r.peaks.some(pk => fr[pk.k].e === e && !pk.sharp && pk.repeat !== false && Math.hypot(pk.x - s.x, pk.y - s.y) <= 2));
}
async function brightRun(p) {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) { stat('The brightness test runs only on a local copy.', true); return; }
  $('intro').hidden = true; S.depth = 8; S.noQuick = true; $('ipe').value = '8'; $('csize').value = '0.5';
  const only = p.get('only'), from = +p.get('from') || 0;
  const list = p.has('test') ? [{ id: 'TEST_demo', eclLon: null, eclLat: null, ra: 189.957, dec: -4.182, galLat: 58.6 }]
    : only ? SCORE_GRID.filter(f => f.id === only) : SCORE_GRID.slice(from);
  const all = [];
  for (const [i, f] of list.entries()) {
    const out = { ...f, id: 'bright_' + f.id, field: f.id, version: '0.31', depth: S.depth, startedAt: new Date().toISOString(), gains: BRIGHT_GAINS }, t0 = performance.now();
    stat(`Brightness test ${i + 1} of ${list.length}: ${f.id}`);
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 20 min')), 20 * 60e3));
      try { await Promise.race([runAgents({ ra: f.ra, dec: f.dec, label: 'Brightness test ' + f.id }), timeout]); } catch (e) { S.run++; throw e; }
      const bad = AGENTS.map(([k]) => S.ag[k] || {}).find(a => a.state === 'err'); if (bad) throw new Error(bad.msg);
      if (S.eps.length < 2) throw new Error('one pass only');
      const e = S.eps.length - 1, stars = brightStars(frameOf(0), S.field.n, 40);
      if (stars.length < 5) throw new Error('fewer than 5 isolated stars');
      const res = BRIGHT_GAINS.map(g => brightTrial(stars, e, g));
      out.stars = stars.map((s, k) => ({ x: s.x, y: s.y, snr: +s.snr.toFixed(0), caught: res.map(r => r[k]) }));
      out.byGain = BRIGHT_GAINS.map((g, j) => ({ gain: g, caught: res[j].filter(Boolean).length, of: stars.length }));
      out.status = 'ok';
    } catch (e) { out.status = 'error'; out.error = e.message; }
    out.totalSecs = Math.round((performance.now() - t0) / 1000);
    all.push(out); console.log('brighttest', JSON.stringify(out.byGain || out.error));
    try { await fetch('/api/dev/scorecard', { method: 'POST', body: JSON.stringify(out) }); } catch (e) { console.warn('save failed', e); }
    window.__brighttest = all;
  }
  const ok = all.filter(r => r.status === 'ok');
  stat(`Brightness test done: ${ok.length} of ${all.length} fields. Results: scorecard/bright_*.json`);
}

/* ---------- Milky Way plane warning (v0.29) ---------- */
// The false-alarm test (public/nulltest.json): in the 4 fields within 1 deg of the Milky Way plane the agents reported about
// as many changes between two stacks that differ in nothing real (36 per comparison, at least) as between the real passes.
// So within PLANE_DEG of the plane the Analyst and the report say changes there are mostly noise.
const PLANE_DEG = 5;
function galLatOf(ra, dec) {
  const d = Math.PI / 180, an = 192.85948 * d, dn = 27.12825 * d;   // north galactic pole (J2000)
  return Math.asin(Math.sin(dec * d) * Math.sin(dn) + Math.cos(dec * d) * Math.cos(dn) * Math.cos(ra * d - an)) / d;
}
const inPlane = () => S.field && Math.abs(galLatOf(S.field.ra, S.field.dec)) < PLANE_DEG;
const PLANE_TXT = 'This field is in the Milky Way plane. In our false-alarm test, crowded fields like this gave about as many false changes as real ones, so treat every unconfirmed change here as noise.';

/* ---------- Brightness test view (v0.31) ---------- */
// public/brighttest.json is built by tools/build-brighttest.js from a real #brighttest run. Every field is listed.
let BT = null;
async function loadBrighttest() {
  if (BT) return BT;
  try { BT = await api('/brighttest.json'); } catch { BT = { error: true }; }
  renderBrighttest(); const got = BT; if (BT.error) BT = null;
  return got;
}
function renderBrighttest() {
  const box = $('btv'); if (!box) return;
  box.innerHTML = '';
  if (!BT || BT.error || !BT.rows) { box.append(h('p', {}, 'The brightness test is not available in this copy.')); return; }
  const s = BT.summary, pc = (L, g) => { const x = L.find(q => q.gain === g); return x && x.of ? x.pct + '%' : '-'; };
  const lab = g => g === 1 ? 'unchanged' : '+' + Math.round((g - 1) * 100) + ' %';
  box.append(h('p', { class: 'scs' }, h('b', {}, `${s.stars} stars in ${s.measured} of ${s.fields} fields. `),
    `Unchanged stars reported anyway: ${pc(s.all, 1)}. Made 50 % brighter: ${pc(s.all, 1.5)} caught; twice as bright: ${pc(s.all, 2)}. `,
    'Faint stars need a bigger change to stand out from the noise, and crowded Milky Way fields do worse.'));
  const t = h('table', { class: 'sct' });
  t.append(h('tr', {}, h('th', {}, 'Star made'), h('th', { class: 'n' }, 'All fields'), h('th', { class: 'n' }, 'Away from Milky Way'), h('th', { class: 'n' }, 'Milky Way plane')));
  for (const g of s.all.map(x => x.gain)) t.append(h('tr', {}, h('td', {}, lab(g)), h('td', { class: 'n' + (g === 1 && s.all.find(x => x.gain === 1).pct >= 5 ? ' bad' : '') }, pc(s.all, g)), h('td', { class: 'n' }, pc(s.rest, g)), h('td', { class: 'n' }, pc(s.plane, g))));
  box.append(t, h('p', { class: 'ntc' }, `Share of stars reported as brighter. "Unchanged": nothing was added, so every report there is a false alarm. Up to 40 isolated stars per field, bright and faint. Fields: ${BT.rows.map(r => r.status === 'ok' ? '' : r.id + ' ' + (r.error || r.status)).filter(Boolean).join('; ') || 'all measured'}.`));
}

/* ---------- False-alarm test view (v0.29) ---------- */
// public/nulltest.json is built by tools/build-nulltest.js from a real #nulltest run. Every field is listed.
let NT = null;
async function loadNulltest() {
  if (NT) return NT;
  try { NT = await api('/nulltest.json'); } catch { NT = { error: true }; }
  renderNulltest(); const got = NT; if (NT.error) NT = null;
  return got;
}
function renderNulltest() {
  const box = $('ntv'); if (!box) return;
  box.innerHTML = '';
  if (!NT || NT.error || !NT.rows) { box.append(h('p', {}, 'The false-alarm test is not available in this copy.')); return; }
  const s = NT.summary, P = s.plane, R = s.rest, per = g => (g.falseAlarms / Math.max(1, g.comparisons)).toFixed(1);
  box.append(h('p', { class: 'scs' }, h('b', {}, `Away from the Milky Way: ${R.falseAlarms} false alarms in ${R.comparisons} comparisons (${per(R)} each), none at all on ${R.zeroFields} of ${R.fields} fields. `),
    `In the Milky Way plane: ${P.falseAlarms}${P.capped ? ' or more' : ''} in ${P.comparisons} comparisons (about ${Math.round(P.falseAlarms / Math.max(1, P.comparisons))} each). There, crowded stars make changes that are not real, so ARCNAVE warns you when a field lies in the plane. `,
    `${s.measured} of ${s.fields} fields could be measured.`));
  const sky = r => Math.abs(r.galLat) < s.planeDeg ? 'Milky Way plane' : Math.abs(r.galLat) > 50 ? 'far from Milky Way' : 'between';
  const ctl = c => c && c.of ? `${Math.round(100 * c.found / c.of)}%` : '-';
  const t = h('table', { class: 'sct' });
  t.append(h('tr', {}, h('th', {}, 'Field'), h('th', {}, 'Sky'), h('th', { class: 'n' }, 'False alarms'), h('th', { class: 'n', title: 'Fake stars of AB 16 found (the check that the agents still see real changes)' }, 'Check')));
  for (const r of NT.rows) {
    const ok = r.status === 'ok';
    t.append(h('tr', { title: `${r.id}: RA ${r.ra}°, Dec ${r.dec}°, galactic latitude ${r.galLat}°` + (ok ? `, ${r.comparisons} comparison${r.comparisons === 1 ? '' : 's'}; fake stars found: AB 14 ${ctl(r.control[14])}, AB 15 ${ctl(r.control[15])}, AB 16 ${ctl(r.control[16])}` + (r.real != null ? `; the app showed ${r.real} changes between the real passes` : '') : r.why ? ' · ' + r.why : '') },
      h('td', {}, `λ ${r.eclLon}°, β ${r.eclLat > 0 ? '+' : ''}${r.eclLat}°`), h('td', {}, sky(r)),
      ok ? h('td', { class: 'n' + (r.falseAlarms / Math.max(1, r.comparisons) >= 5 ? ' bad' : '') }, `${r.falseAlarms}${r.capped ? '+' : ''} in ${r.comparisons}`) : h('td', { class: 'n na' }, r.status === 'no-split' ? 'not measurable' : 'failed'),
      ok ? h('td', { class: 'n' }, ctl(r.control[16])) : h('td', { class: 'n na' }, '')));
  }
  box.append(t, h('p', { class: 'ntc' }, `"False alarms": changes reported between two stacks with nothing real between them, in that many comparisons (one per pair of passes). "+": at least, the agents keep at most ${s.cap} changes per comparison. "Check": share of fake AB 16 stars found; low in the most crowded fields, so faint real changes are missed there too. "Not measurable": the two passes share fewer than 4 colours.`));
}

/* ---------- v0.55 mover test view, and "in one look" ---------- */
// public/movertest.json is built by tools/build-movertest.js from a real #movertest run. Every field is listed.
let MV = null;
async function loadMovertest() {
  if (MV) return MV;
  try { MV = await api('/movertest.json'); } catch { MV = { error: true }; }
  renderMovertest(); renderOneLook(); const got = MV; if (MV.error) MV = null;
  return got;
}
// share of fakes passed in a set of grid cells: [snr index, speed index] pairs
const mvShare = (cells, pick) => { let k = 0, n = 0; for (const [i, j] of pick) { const c = cells[i] && cells[i][j]; if (c) { k += c.k; n += c.n; } } return n ? Math.round(100 * k / n) : null; };
function mvCells(g, key) { return g.cells.map(row => row.map(c => ({ k: c[key], n: c.n }))); }
function renderMovertest() {
  const box = $('mtv'); if (!box) return;
  box.innerHTML = '';
  if (!MV || MV.error || !MV.rows) { box.append(h('p', {}, 'The mover test is not available in this copy.')); return; }
  const s = MV.summary, A = s.all;
  const table = (g, key, cap) => h('table', { class: 'sct mvt' }, h('caption', {}, cap),
    h('tr', {}, h('th', {}, 'S/N per image'), ...s.MU.map(u => h('th', { class: 'n' }, `${u}″/yr`))),
    ...s.SNR.map((sn, i) => h('tr', {}, h('td', {}, String(sn)), ...s.MU.map((_, j) => { const c = g.cells[i][j], p = c.n ? Math.round(100 * c[key] / c.n) : null;
      return h('td', { class: 'n' + (p == null ? ' na' : p >= 80 ? ' good' : p < 30 ? ' bad' : '') }, p == null ? '-' : p + '%'); }))));
  box.append(h('p', { class: 'scs' }, h('b', {}, `${s.measured} of ${s.fields} fields, ${A.cells.flat().reduce((a, c) => a + c.n, 0)} fake moving stars. `),
    `Errors: the fakes' misses divided by their own errors scatter by ${A.pullRms ?? '?'} (1 = honest). Empty sky: ${A.emptyFalse} of ${A.empty} empty places showed a steady 5σ "motion". ` +
    `Blind deep search: ${A.extra} source${A.extra === 1 ? '' : 's'} flagged in all fields that it did not flag without the fakes. Passes span ${s.days} days on average.`),
    table(A, 'meas', 'Measured at its known place: motion found at 5σ or more, and right within 3σ'),
    table(A, 'blind', 'Found by the deep search on its own (blind), as a visitor would'),
    h('p', { class: 'ntc' }, `Share of the fakes of each kind (S/N per image for an optimal fit; speed in ″ per year). Milky Way plane: ${s.plane.fields} fields, blind ${mvShare(mvCells(s.plane, 'blind'), [[2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]]) ?? '-'}% for S/N 12+ and 2+″/yr; elsewhere ${mvShare(mvCells(s.rest, 'blind'), [[2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]]) ?? '-'}%. ` +
      `Fields: ${MV.rows.map(r => r.status === 'ok' ? '' : r.id + ' ' + (r.why || r.status)).filter(Boolean).join('; ') || 'all measured'}. Run it on any field yourself: Planet X & agents › 🧪 Mover test.`));
}
// v0.55: the same in one line, in the Planet X section: how faint a Planet X and how slow a star can be caught
async function fillPxLook() {
  const el = $('pxlook'); if (!el) return;
  const [sc, mv] = await Promise.all([loadScorecard(), loadMovertest()]); const s = sc && !sc.error && sc.summary, m = mv && !mv.error && mv.summary;
  if (!s) return; el.replaceChildren(); el.hidden = false;
  const fast = m ? mvShare(mvCells(m.all, 'blind'), [[2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]]) : null;
  el.append(h('b', {}, 'What SPHEREx can catch, tested on 18 fields: '), `a Planet X 1000 AU away down to AB ${s.at1000.median.toFixed(1)} (median), 300 AU away in ${s.at300.found} of ${s.at300.of} fields` +
    (m ? `; a star moving 2-8″ a year at S/N 12 or more per image, found on its own ${fast}% of the time; 1″ a year is below the limit.` : '.') + ' ',
    h('button', { type: 'button', class: 'linkb', onclick: () => $('tb').click() }, 'How we tested it'));
}
setTimeout(fillPxLook, 2500);
// one paragraph a judge can read first: what SPHEREx, through ARCNAVE, can and cannot catch, from the tests below
function renderOneLook() {
  const box = $('tlook'); if (!box) return;
  const sc = SC && !SC.error && SC.summary, mv = MV && !MV.error && MV.summary;
  if (!sc && !mv) return; box.innerHTML = '';
  const out = [];
  if (sc) out.push(h('li', {}, h('b', {}, 'Planet X: '), `a planet 1000 AU away is caught down to AB ${sc.at1000.median.toFixed(1)} (median of ${sc.at1000.of} fields, from ${sc.at1000.min.toFixed(1)} to ${sc.at1000.max.toFixed(1)}); 300 AU away, in ${sc.at300.found} of ${sc.at300.of} fields. Planet X is hypothetical: this says how faint it could be and still be seen, not that it is there. A Planet Nine as predicted (about V 19-24, Batygin et al. 2019) is fainter than this limit, so SPHEREx is not expected to see it; nearby cold brown dwarfs like WISE 0855 (AB 17.15) are within reach.`));
  if (mv) { const A = mv.all, m = mvCells(A, 'meas'), b = mvCells(A, 'blind'), fast = [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]], slow = [[1, 0], [2, 0], [3, 0]], bright = [[2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]];
    out.push(h('li', {}, h('b', {}, 'Moving stars: '), `${mvShare(m, fast)}% of fakes moving 2-8″/yr at S/N 6 or more per image are measured right; the deep search finds ${mvShare(b, bright)}% of those at S/N 12+ on its own. Motions of 1″/yr are below the limit over ${mv.days} days (${mvShare(m, slow)}% measured).`));
    out.push(h('li', {}, h('b', {}, 'Honest errors and few false alarms: '), `error-scaled misses scatter by ${A.pullRms}; ${A.emptyFalse} of ${A.empty} empty places looked like a steady motion; ${A.extra} new flag${A.extra === 1 ? '' : 's'} with fakes added, in ${mv.measured} fields.`)); }
  if (NT && !NT.error && NT.summary) out.push(h('li', {}, h('b', {}, 'Changes between passes: '), `away from the Milky Way, ${NT.summary.rest.falseAlarms} false alarms in ${NT.summary.rest.comparisons} comparisons; in its plane far more, and ARCNAVE warns there.`));
  box.append(h('h3', {}, 'In one look'), h('ul', { class: 'olk' }, ...out), h('p', { class: 'ntc' }, `All from the tests below, on 18 fields fixed before the runs; nothing left out.`));
}

/* ---------- Validation scorecard view (v0.12) ---------- */
// public/scorecard.json is built by tools/build-scorecard.js from a real #scorecard run. Every field of the fixed grid is
// listed, also those that could not be measured.
let SC = null;
async function loadScorecard() {
  if (SC) return SC;
  try { SC = await api('/scorecard.json'); } catch { SC = { error: true }; }
  renderScorecard(); const got = SC; if (SC.error) SC = null;   // a failed fetch is tried again next time, not cached
  return got;
}
function renderScorecard() {
  const box = $('scv'); if (!box) return;
  if (!SC || SC.error || !SC.rows) { box.innerHTML = ''; box.append(h('p', {}, 'The validation scorecard is not available in this copy.')); return; }
  const s = SC.summary, why = { 'one-epoch': 'one pass so far', 'no-psf': 'too few clean stars', error: 'failed' };
  const sky = r => Math.abs(r.galLat) < 10 ? 'Milky Way plane' : Math.abs(r.galLat) > 50 ? 'far from Milky Way' : 'between';
  box.innerHTML = '';
  const A = s.at1000, B = s.at300;
  box.append(h('p', { class: 'scs' }, `Hide Planet X was run on ${s.fields} fields (${s.grid}), ${s.fakes.toLocaleString()} fake planets in all, and ${s.measured} could be measured. `
    + `A planet 1000 AU away is found at least half the time down to AB ${A.min.toFixed(1)} to ${A.max.toFixed(1)} (median ${A.median.toFixed(1)}). `
    + (s.shift ? `A planet 300 AU away is found in ${B.found} of ${B.of} fields (${s.at300plain.found} of ${s.at300plain.of} without the motion-following stack: a planet that close moves tens of pixels within one pass, and the plain median of the pass removes it; shifting the images back along its path before stacking keeps it). `
      + `The cost: run over the whole real fields with no fake planet (${s.scanDists} distances), the motion-following stack gave 7-sigma peaks in one pass that no star explains in ${s.scanLoneFields} of ${s.scanFields} fields (up to ${s.scanLoneMax} in one Milky Way field), but ${s.scanPairs === 0 ? 'no' : s.scanPairs} peak${s.scanPairs === 1 ? '' : 's'} seen in both passes one parallax jump apart. So a real search with it would have to insist on both passes; the agents do not run it on real fields yet. `
      : `A planet 300 AU away is found in ${B.found} of ${B.of} fields. In the others the images of one pass are spread over weeks (32 days in one of them), a planet that close moves tens of pixels between them, and the median stack removes it. Following the planet's motion while stacking would fix that; ARCNAVE does not do it yet. `)
    + `The Milky Way's crowded star fields are the hardest: there fake planets often land on stars.`
    + (s.retried && s.retried.length ? ` Run a second time: ${s.retried.join('; ')}.` : '')));
  const t = h('table', { class: 'sct' }), lo = 13, hi = 18;
  const cell = v => v != null ? h('td', { class: 'n' }, v.toFixed(1), h('span', { class: 'bar', style: `width:${Math.max(4, Math.min(100, (v - lo) / (hi - lo) * 100))}%` })) : h('td', { class: 'n na' }, 'missed');
  t.append(h('tr', {}, h('th', {}, 'Field'), h('th', {}, 'Sky'), h('th', {}, '300 AU'), h('th', {}, '1000 AU')));
  for (const r of SC.rows) {
    const ok = r.status === 'ok';
    t.append(h('tr', { title: `${r.id}: RA ${r.ra}°, Dec ${r.dec}°, ${r.epochs ?? '-'} passes${r.psfStars ? `, PSF from ${r.psfStars} stars` : ''}${r.retried ? ' · run twice: ' + r.retried : ''}${r.error ? ' · ' + r.error : ''}${s.shift && ok ? ` · without the motion-following stack: 300 AU ${r.lim300plain ?? 'missed'}, 1000 AU ${r.lim1000plain ?? 'missed'}` : ''}` },
      h('td', {}, `λ ${r.eclLon}°, β ${r.eclLat > 0 ? '+' : ''}${r.eclLat}°`), h('td', {}, sky(r)),
      ok ? cell(r.lim300) : h('td', { class: 'n na' }, why[r.status] || r.status), ok ? cell(r.lim1000) : h('td', { class: 'n na' }, '')));
  }
  box.append(t, h('p', { class: 'scs', style: 'color:var(--dust)' }, 'Each number: the faintest fake planet (AB magnitude) still found at least half the time at that distance' + (s.shift ? ', with the plain and the motion-following stack (hover a row for the plain stack alone)' : '') + '. Bigger number = fainter = better. "missed": not found half the time even at the brightest level tried. λ, β: position along and above the ecliptic, the plane of the planets.'));
}

/* ---------- Discovery card (v0.15): the blink as a looping GIF, with where, when and in what colour ---------- */
// One image anyone can post. Every frame is the same patch of sky from a different SPHEREx image, so stars stay put and
// anything that hops is moving. The card says plainly what it is (known asteroid, unconfirmed change, or just a field)
// and where the data came from. Built on the viewer's own device: GIF encoded in a worker (public/gif.js), no upload.
const CARD = { W: 540, H: 790, X: 20, Y: 112, S: 500, MAXF: 12, busy: false, url: null };
function cardGrid() { const f = S.field; return { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }; }
const imLabel = im => `${fmtDay(im.mjd)} ${mjdDate(im.mjd).toISOString().slice(11, 16)} UTC · ${lamOf(im).toFixed(2)} µm`;
const thin = (list, max) => list.length <= max ? list : Array.from({ length: max }, (_, i) => list[Math.round(i * (list.length - 1) / (max - 1))]);
// What goes on the card: which object, which patch of the field, which frames, and the honest one-line verdict.
function cardPlan() {
  if (!S.field || !S.eps.length) return null;
  const g = cardGrid(), n = S.field.n, sel = S.sel || {};
  const epochFrame = (e, marks = []) => { const fr = frameOf(e); return fr && { fr, top: `Epoch ${e + 1}`, sub: fr.stack ? `${fmtMonth(chosen(e).mjd)} · median of ${fr.stack} images · ${lamOf(chosen(e)).toFixed(2)} µm` : imLabel(chosen(e)), marks, mjd: chosen(e).mjd, lam: lamOf(chosen(e)) }; };
  const imFrame = (im, e, marks = []) => { const fr = S.frames.get(im.url); return fr && { fr, top: `Epoch ${e + 1}`, sub: imLabel(im), marks, mjd: im.mjd, lam: lamOf(im) }; };
  if (sel.ast) {   // known asteroid caught moving inside one epoch: flip through that epoch's images
    const a = sel.ast, sg = a.sightings.slice().sort((p, q) => p.mjd - q.mjd), e = sg[0].e, col = a.confirmed ? '#5ff0a0' : '#ffb05a';
    const ims = epochImgs(e).filter(im => S.frames.get(im.url)).sort((p, q) => p.mjd - q.mjd);
    const keep = ims.length <= CARD.MAXF ? ims : [...new Set([...sg.map(x => x.im), ...thin(ims, CARD.MAXF)])].sort((p, q) => p.mjd - q.mjd).slice(0, CARD.MAXF + 2);
    const xs = sg.map(x => x.x), ys = sg.map(x => x.y), span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    // a green ring where SPHEREx caught it; in the other images a grey ring on the same spot, so you see it is gone
    const frames = keep.map(im => { const here = sg.filter(x => x.im === im);
      return imFrame(im, e, here.length ? here.map(x => ({ x: x.x, y: x.y, color: col, label: a.name.replace(/^\d+\s+/, '') })) : [{ x: sg[0].x, y: sg[0].y, color: '#8e98ae', label: 'not here now' }]); }).filter(Boolean);
    const hrs = (sg[sg.length - 1].mjd - sg[0].mjd) * 24, moved = Math.hypot(sg[sg.length - 1].x - sg[0].x, sg[sg.length - 1].y - sg[0].y) * S.field.s * 3600;
    return { title: a.name, badge: a.confirmed ? ['✓ Known asteroid, confirmed', '#5ff0a0'] : ['Matches a known object, one check fails', '#ffb05a'],
      cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, half: Math.max(30, span / 2 + 18), frames, ra: sg[0].ra, dec: sg[0].dec,
      fact: sg.length > 1 ? `Moved ${fmtAng(moved)} in ${fmtDur(hrs)} · caught in ${sg.length} images` : 'Caught in 1 image',
      note: 'A known asteroid that SPHEREx recorded, identified with ' + (viaMpc() ? 'the Minor Planet Center checker' : 'IMCCE SkyBoT') + '. Not a new discovery.', slug: a.name };
  }
  if (sel.cand) {   // a change the Analyst found between two epochs
    const k = sel.cand, [a, b] = k.epochs || [0, S.eps.length - 1], p = k.kind === 'gone' ? k.from : k.to, st = k.status || 'unconfirmed';
    const ring = { x: p.x, y: p.y, color: '#c4b5ff' };
    const frames = [epochFrame(a, k.kind === 'pair' ? [{ x: k.from.x, y: k.from.y, color: '#5fe3f0' }] : [ring]), epochFrame(b, [ring])].filter(Boolean);
    const badge = { confirmed: ['✓ Known asteroid, confirmed', '#5ff0a0'], artefact: ['Likely an image artefact', '#ffb05a'], near: ['Near a known object, not a match', '#ffb05a'], unconfirmed: ['Unconfirmed change', '#9b8cff'] }[st];
    return { title: 'Change C' + k.id + (k.proof && k.proof.near && st === 'confirmed' ? ': ' + k.proof.near.name : ''), badge, cx: p.x, cy: p.y, half: k.kind === 'pair' ? Math.max(24, Math.hypot(k.to.x - k.from.x, k.to.y - k.from.y) / 2 + 16) : 24,
      frames, ra: p.ra ?? k.to.ra, dec: p.dec ?? k.to.dec,
      fact: k.kind === 'pair' ? `Moved ${k.sepArcsec.toFixed(0)}″ over ${k.baselineDays.toFixed(0)} days · ${k.snr.toFixed(0)}σ` : `${{ new: 'Appears only in the later epoch', gone: 'Only in the first epoch' }[k.kind]} · ${k.snr.toFixed(0)}σ`,
      note: st === 'confirmed' ? 'A known asteroid seen by SPHEREx, matched with ' + (viaMpc() ? 'the Minor Planet Center checker' : 'IMCCE SkyBoT') + '. Not a new discovery.'
        : st === 'artefact' && k.proof && k.proof.reason === 'glare' ? 'The glare of a very bright star that changed brightness between the epochs, not a new object.' : st === 'artefact' ? 'Most likely an image artefact (a cosmic ray or a hot pixel), not a real object.'
        : 'Unconfirmed: could be a real change, a variable star or an image artefact. Not a discovery claim.', slug: 'change-' + k.id };
  }
  if (sel.it) {   // a known mover (SkyBoT ring): one frame per epoch, a + where the orbit puts it at each epoch's time
    const it = sel.it, key = itemKey(it), E = S.eps.length, eps = thin([...Array(E).keys()], 8);
    const at = e => { const m = moversOf(e), o = m && m.items && m.items.find(x => itemKey(x) === key), q = o && F.skyToGrid(o.ra, o.dec, g); return q && { x: q[0], y: q[1], color: '#ffb05a', plus: true }; };
    const q0 = F.skyToGrid(it.ra, it.dec, g); if (!q0) return null;
    return { title: (it.num ? it.num + ' ' : '') + it.name, badge: ['Known solar-system object (' + (viaMpc() ? 'MPC' : 'SkyBoT') + ')', '#ffb05a'], cx: q0[0], cy: q0[1], half: 40,
      frames: eps.map(e => epochFrame(e, [at(e)].filter(Boolean))).filter(Boolean), ra: it.ra, dec: it.dec,
      fact: `${it.cls || 'Object'} · V ${Number.isFinite(it.vmag) ? it.vmag.toFixed(1) : '?'} · ${it.dgeo?.toFixed?.(2) ?? '?'} au from Earth`,
      note: 'The + is where the orbit catalogue puts it, not a SPHEREx detection. Faint objects may not show.', slug: it.name };
  }
  // no object picked: the patch of the field in the middle of the screen, as the user sees it now
  const T = affine(); let cx = (n - 1) / 2, cy = cx, half = n / 2;
  if (T) {
    const det = T.a * T.d - T.b * T.c, X = W / 2 - T.e, Y = H / 2 - T.f;
    if (Math.abs(det) > 1e-9) { cx = (T.d * X - T.c * Y) / det - 0.5; cy = (-T.b * X + T.a * Y) / det - 0.5; half = Math.min(W, H) * 0.42 / Math.hypot(T.a, T.b); }
  }
  half = Math.max(20, Math.min(n / 2, half)); cx = Math.max(half - 1, Math.min(n - half, cx)); cy = Math.max(half - 1, Math.min(n - half, cy));
  let frames;
  if (multi() && S.mode === 'blink' && S.seq.length) frames = thin(blinkList(), CARD.MAXF).map(x => imFrame(x.im, x.e, S.inside ? S.inside.asteroids.flatMap(a => a.sightings.filter(sg => sg.im === x.im).map(sg => ({ x: sg.x, y: sg.y, color: a.confirmed ? '#5ff0a0' : '#ffb05a', label: a.name.replace(/^\d+\s+/, '') }))) : []) || (rawOf(x.e) && epochFrame(x.e))).filter(Boolean);
  else frames = thin([...Array(S.eps.length).keys()], 8).map(e => epochFrame(e)).filter(Boolean);
  const sky = F.gridToSky(cx, cy, g);
  return { title: 'SPHEREx sky over time', badge: ['Look for anything that hops', '#9b8cff'], cx, cy, half, frames, ra: sky[0], dec: sky[1],
    fact: multi() && S.mode === 'blink' ? `${frames.length} images from ${S.bi < S.eps.length ? `pass ${S.bi + 1} of ${S.eps.length}` : `all ${S.eps.length} passes`} SPHEREx made over this spot` : `One frame per pass: ${S.eps.length} SPHEREx pass${S.eps.length === 1 ? '' : 'es'} over this spot`,
    note: 'Real SPHEREx images. Stars stay put; something that hops between frames is moving, or an artefact. Not a discovery claim.', slug: 'field' };
}
function cardText(g, s, x, y, max) {   // one line, shortened with … if too wide
  let t = s; while (t.length > 3 && g.measureText(t).width > max) t = t.slice(0, -2);
  g.fillText(t === s ? s : t + '…', x, y);
}
function wrapText(g, s, x, y, max, lh) {
  const words = s.split(' '); let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > max && line) { g.fillText(line, x, y); y += lh; line = w; } else line = t; }
  if (line) g.fillText(line, x, y); return y + lh;
}
function drawCardFrame(g, plan, i, an = { k: 1, lock: 1 }) {   // v0.56 an: the film's glide (k) and lock-on ring (lock), 0..1
  const { W: CW, H: CH, X, Y, S: SZ } = CARD, f = plan.frames[i], n = S.field.n, half = plan.half, k = SZ / (2 * half);
  const sx = plan.cx + 0.5 - half, sy = plan.cy + 0.5 - half;   // canvas coords of the crop's corner (pixel x spans x..x+1)
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#05070f'; g.fillRect(0, 0, CW, CH);
  const font = (w, px) => `${w} ${px}px Archivo, system-ui, sans-serif`;
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = '#ffb05a'; g.font = font(750, 14); g.fillText('ARCNAVE', X, 34);
  g.fillStyle = '#8e98ae'; g.font = font(500, 12); g.textAlign = 'right'; g.fillText('Real NASA SPHEREx images', CW - X, 34); g.textAlign = 'left';
  g.fillStyle = '#eef1f7'; g.font = font(720, 24); cardText(g, plan.title, X, 66, CW - 2 * X);
  g.font = font(650, 12); const bw = g.measureText(plan.badge[0]).width + 20;
  g.fillStyle = '#0a0e1a'; g.strokeStyle = plan.badge[1]; g.lineWidth = 1; g.beginPath(); g.roundRect ? g.roundRect(X + 0.5, 78.5, bw, 22, 11) : g.rect(X + 0.5, 78.5, bw, 22); g.fill(); g.stroke();
  g.fillStyle = plan.badge[1]; g.fillText(plan.badge[0], X + 10, 94);
  // the image: crop of this frame's aligned canvas, the same sky patch in every frame
  g.fillStyle = '#000000'; g.fillRect(X, Y, SZ, SZ);
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(n, sx + 2 * half), y1 = Math.min(n, sy + 2 * half);
  g.save(); g.beginPath(); g.rect(X, Y, SZ, SZ); g.clip();
  if (x1 > x0 && y1 > y0) { g.imageSmoothingEnabled = k < 14; g.imageSmoothingQuality = 'high'; g.drawImage(f.fr.canvas, x0, y0, x1 - x0, y1 - y0, X + (x0 - sx) * k, Y + (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k); }
  const toC = p => [X + (p.x + 0.5 - sx) * k, Y + (p.y + 0.5 - sy) * k];
  const st = f.stage, ease = an.k * an.k * (3 - 2 * an.k), cur = st && toC(st.cur); let pv = st && st.prev && toC(st.prev), Fx = 1;
  // a shift of a few ″ is a pixel or two here: as in the film, the step is drawn longer by a stated factor (the ring stays
  // on the star in this pass; the dashed circle goes back along the measured direction)
  if (pv) { const dd = Math.hypot(pv[0] - cur[0], pv[1] - cur[1]); if (dd < 50) { Fx = dd > 0.05 ? Math.min(300, Math.round(56 / dd)) : 1; pv = [cur[0] + (pv[0] - cur[0]) * Fx, cur[1] + (pv[1] - cur[1]) * Fx]; } }
  const head = st && (pv ? [pv[0] + (cur[0] - pv[0]) * ease, pv[1] + (cur[1] - pv[1]) * ease] : cur);
  if (st) {   // v0.56 spotlight: the crop dims away from the mover, a soft beam falls on it from above
    const R = 46, rg = g.createRadialGradient(head[0], head[1], R * 0.8, head[0], head[1], R * 2.6);
    rg.addColorStop(0, 'rgba(2,4,10,0)'); rg.addColorStop(1, 'rgba(2,4,10,.6)'); g.fillStyle = rg; g.fillRect(X, Y, SZ, SZ);
    const src = [head[0] * 0.6 + (X + SZ / 2) * 0.4, Y - 30], bx = head[0] - src[0], by = head[1] - src[1], bl = Math.hypot(bx, by) || 1, nx = -by / bl, ny = bx / bl;
    g.globalCompositeOperation = 'lighter'; const lg = g.createLinearGradient(src[0], src[1], head[0], head[1]); lg.addColorStop(0, 'rgba(255,244,214,0)'); lg.addColorStop(1, 'rgba(255,244,214,.12)');
    g.fillStyle = lg; g.beginPath(); g.moveTo(src[0] - nx * 5, src[1] - ny * 5); g.lineTo(src[0] + nx * 5, src[1] + ny * 5); g.lineTo(head[0] + nx * 30, head[1] + ny * 30); g.lineTo(head[0] - nx * 30, head[1] - ny * 30); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  for (const m of f.marks) {
    const [px, py] = toC(m); g.strokeStyle = m.color; g.lineWidth = 2.5;
    if (m.plus) { g.beginPath(); g.moveTo(px - 12, py); g.lineTo(px - 4, py); g.moveTo(px + 4, py); g.lineTo(px + 12, py); g.moveTo(px, py - 12); g.lineTo(px, py - 4); g.moveTo(px, py + 4); g.lineTo(px, py + 12); g.stroke(); }
    else { g.setLineDash([6, 4]); g.beginPath(); g.arc(px, py, Math.max(14, 2.2 * k), 0, 7); g.stroke(); g.setLineDash([]); }
    if (m.label) { g.fillStyle = m.color; g.font = font(650, 13); g.fillText(m.label, px + Math.max(18, 2.2 * k + 4), py - 10); }
  }
  if (st) {   // v0.56 on stage: was here (dashed, dated) → the glide → a ring locking on → the dated callout
    const out = (t, x, y, c, al) => { g.textAlign = al || 'left'; g.lineWidth = 3; g.strokeStyle = 'rgba(2,4,10,.9)'; g.strokeText(t, x, y); g.fillStyle = c; g.fillText(t, x, y); g.textAlign = 'left'; };
    if (pv) { g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.6; g.setLineDash([5, 4]); g.beginPath(); g.arc(pv[0], pv[1], 17, 0, 7); g.stroke(); g.setLineDash([]);
      g.font = font(600, 12); const [lx, ly, la] = awayLabel(pv, cur, 24); out(`was here · ${st.prev.date}`, lx, ly, 'rgba(255,255,255,.9)', la);
      g.strokeStyle = st.col; g.lineWidth = 2.6; g.lineCap = 'round'; g.beginPath(); g.moveTo(pv[0], pv[1]); g.lineTo(head[0], head[1]); g.stroke(); g.lineCap = 'butt'; }
    if (an.k < 1) { g.strokeStyle = st.col; g.lineWidth = 1.6; g.setLineDash([5, 5]); g.beginPath(); g.arc(head[0], head[1], 26, 0, 7); g.stroke(); g.setLineDash([]); }
    else { const r = 15 + 20 * (1 - an.lock) ** 2, a0 = -Math.PI / 2;
      g.save(); g.shadowColor = st.col; g.shadowBlur = 12; g.strokeStyle = '#ffffff'; g.lineWidth = 2.4; g.beginPath(); g.arc(head[0], head[1], r, a0, a0 + 2 * Math.PI * Math.max(0.02, an.lock)); g.stroke(); g.restore();
      if (an.lock >= 1) { g.lineWidth = 1.8; g.strokeStyle = '#ffffff'; for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.beginPath(); g.moveTo(head[0] + ux * 18, head[1] + uy * 18); g.lineTo(head[0] + ux * 25, head[1] + uy * 25); g.stroke(); } } }
    // the callout, kept inside the image (below the scale bar, above the caption strip)
    const lines = Fx > 1 ? [...st.lines, [`step drawn ${Fx}x longer to be seen`, '#8e98ae']] : st.lines;
    const lh = 17, pad = 9; let wmax = 0; for (const [t, , fw] of lines) { g.font = fw ? font(720, 13) : font(600, 12); wmax = Math.max(wmax, g.measureText(t).width); }
    const bw = Math.min(SZ - 16, wmax + 2 * pad), bh = lines.length * lh + pad + 2;
    let bx = head[0] + 34, by = head[1] - bh - 22; if (bx + bw > X + SZ - 8) bx = head[0] - 34 - bw; if (bx < X + 8) bx = X + 8; if (by < Y + 46) by = head[1] + 40; if (by + bh > Y + SZ - 60) by = Y + SZ - 60 - bh;
    g.globalAlpha = Math.min(1, 0.3 + an.k); g.fillStyle = 'rgba(5,8,15,.88)'; g.fillRect(bx, by, bw, bh); g.strokeStyle = st.col; g.lineWidth = 1; g.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
    lines.forEach(([t, c, fw], j) => { g.font = fw ? font(720, 13) : font(600, 12); g.fillStyle = c; cardText(g, t, bx + pad, by + pad + 10 + j * lh, bw - 2 * pad); });
    g.globalAlpha = 1;
  }
  // scale bar: 1 arcminute (or 30″ when zoomed in)
  const pxArc = S.field.s * 3600, arc = 2 * half * pxArc > 240 ? 60 : 30, bar = arc / pxArc * k;
  g.fillStyle = 'rgba(5,7,15,.72)'; g.fillRect(X + SZ - bar - 26, Y + 10, bar + 16, 28);
  g.strokeStyle = '#eef1f7'; g.lineWidth = 2; g.beginPath(); g.moveTo(X + SZ - bar - 18, Y + 30); g.lineTo(X + SZ - 18, Y + 30); g.stroke();
  g.fillStyle = '#eef1f7'; g.font = font(600, 11); g.textAlign = 'center'; g.fillText(arc === 60 ? "1′" : '30″', X + SZ - 18 - bar / 2, Y + 24); g.textAlign = 'left';
  // which frame this is
  g.fillStyle = 'rgba(5,7,15,.78)'; g.fillRect(X, Y + SZ - 52, SZ, 52);
  g.fillStyle = '#ffb05a'; g.font = font(720, 15); g.fillText(`${f.top} · frame ${i + 1} of ${plan.frames.length}`, X + 12, Y + SZ - 30);
  g.fillStyle = '#eef1f7'; g.font = font(500, 13); cardText(g, f.sub, X + 12, Y + SZ - 11, SZ - 24);
  g.restore(); g.strokeStyle = '#323d57'; g.lineWidth = 1; g.strokeRect(X - 0.5, Y - 0.5, SZ + 1, SZ + 1);
  // progress dots
  const N = plan.frames.length, gap = Math.min(18, (SZ - 20) / N);
  for (let j = 0; j < N; j++) { g.fillStyle = j === i ? '#ffb05a' : '#323d57'; g.beginPath(); g.arc(X + SZ / 2 + (j - (N - 1) / 2) * gap, Y + SZ + 16, j === i ? 4.5 : 3.5, 0, 7); g.fill(); }
  // the facts
  const t0 = Math.min(...plan.frames.map(x => x.mjd)), t1 = Math.max(...plan.frames.map(x => x.mjd)), days = t1 - t0;
  const lams = plan.frames.map(x => x.lam), l0 = Math.min(...lams), l1 = Math.max(...lams);
  let y = Y + SZ + 46; g.fillStyle = '#eef1f7'; g.font = font(650, 14);
  g.fillText(`RA ${plan.ra.toFixed(4)}°   Dec ${plan.dec >= 0 ? '+' : '−'}${Math.abs(plan.dec).toFixed(4)}°`, X, y);
  g.textAlign = 'right'; g.fillText(`${(2 * half * pxArc / 60).toFixed(1)}′ wide`, X + SZ, y); g.textAlign = 'left';
  y += 21; g.font = font(500, 13); g.fillStyle = '#eef1f7';
  cardText(g, `${fmtDay(t0)}${days > 0.01 ? ' → ' + fmtDay(t1) + ` (${fmtDur(days * 24)})` : ''} · ${l1 - l0 < 0.01 ? l0.toFixed(2) : l0.toFixed(2) + '–' + l1.toFixed(2)} µm infrared`, X, y, SZ);
  y += 20; g.fillStyle = '#ffc46b'; cardText(g, plan.fact, X, y, SZ);
  y += 22; g.fillStyle = '#8e98ae'; g.font = font(500, 12); y = wrapText(g, plan.note, X, y, SZ, 16);
  g.fillStyle = '#5a6378'; g.font = font(500, 11); g.fillText(plan.credit || 'Images: NASA SPHEREx via IRSA · Orbits: ' + (viaMpc() ? 'Minor Planet Center' : 'IMCCE SkyBoT') + ' · False colour', X, CH - 16);   // v0.55: plan.credit (the film's own)
}
function encodeGif(job) {   // in a worker when possible, so the page never freezes
  return new Promise((res, rej) => {
    let w; try { w = new Worker('/gif-worker.js'); } catch { try { res(SkyGif.encode(job)); } catch (e) { rej(e); } return; }
    w.onmessage = ev => { w.terminate(); ev.data && ev.data.err ? rej(new Error(ev.data.err)) : res(ev.data); };
    w.onerror = e => { w.terminate(); rej(new Error(e.message || 'GIF worker failed')); };
    w.postMessage(job, job.frames.map(f => f.rgba.buffer));
  });
}
async function makeCard() {
  if (CARD.busy) return;
  const plan = cardPlan();
  if (!plan) { toast('Fly somewhere first: the card is made from the SPHEREx images of a field.'); return; }
  if (plan.frames.length < 2) { toast('The card needs at least two images. Wait for the images to load, then try again.'); return; }
  CARD.busy = true; const btn = $('dcard'); if (btn) btn.disabled = true; toast('Making your discovery card...', 8000);
  try {
    try { await document.fonts.ready; } catch { /* draw with fallback fonts */ }
    const cv = document.createElement('canvas'); cv.width = CARD.W; cv.height = CARD.H; const g = cv.getContext('2d', { willReadFrequently: true });
    const delay = plan.frames.length <= 3 ? 900 : 650, frames = [];
    for (let i = 0; i < plan.frames.length; i++) { drawCardFrame(g, plan, i); frames.push({ rgba: g.getImageData(0, 0, CARD.W, CARD.H).data, delay: i === plan.frames.length - 1 ? delay + 500 : delay }); if (i === 0) plan.still = cv.toDataURL('image/png'); }
    const t = performance.now(), gif = await encodeGif({ width: CARD.W, height: CARD.H, frames });
    console.log(`[card] ${plan.frames.length} frames, ${(gif.length / 1024).toFixed(0)} kB, ${(performance.now() - t).toFixed(0)} ms`);
    showCardDialog(plan, new Blob([gif], { type: 'image/gif' }));
    $('toast').hidden = true;
  } catch (e) { console.error(e); toast('Could not make the card: ' + e.message); }
  CARD.busy = false; if (btn) btn.disabled = false;
}
function cardPost(plan) {
  writeHash();
  if (GAME.share && plan.title === GAME.share.name) return `I spotted asteroid ${plan.title} moving in real NASA SPHEREx infrared images in ${GAME.share.secs} s. It is a known asteroid (no new discovery), but finding it yourself is fun. Can you? ${location.origin}/#play #SPHEREx #NASASpaceApps`;
  const where = `RA ${plan.ra.toFixed(3)}°, Dec ${plan.dec.toFixed(3)}°`;
  return `${plan.title} in real NASA SPHEREx infrared images (${where}). ${plan.badge[0].replace(/^✓ /, '')}. Stars stay put; what hops is moving. Explore it yourself: ${location.href} #SPHEREx #NASASpaceApps`;
}
function showCardDialog(plan, blob) {
  const d = $('dcd'); if (CARD.url) URL.revokeObjectURL(CARD.url); CARD.url = URL.createObjectURL(blob);
  const name = `arcnave-${String(plan.slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card'}-${plan.ra.toFixed(3)}_${plan.dec.toFixed(3)}.gif`;
  const file = new File([blob], name, { type: 'image/gif' }), post = cardPost(plan);
  $('dcdimg').src = CARD.url; $('dcdimg').alt = `Animated card: ${plan.title}, ${plan.frames.length} SPHEREx frames of the same sky patch. ${plan.badge[0]}.`;
  $('dcdtxt').value = post; $('dcdsize').textContent = `${plan.frames.length} frames · ${(blob.size / 1024).toFixed(0)} kB · GIF`;
  const dl = $('dcddl'); dl.href = CARD.url; dl.download = name;
  const canFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  $('dcdshare').hidden = !canFile && !navigator.share;
  $('dcdshare').onclick = async () => {
    try { await navigator.share(canFile ? { files: [file], title: plan.title, text: post } : { title: plan.title, text: post, url: location.href }); }
    catch (e) { if (e.name !== 'AbortError') toast('Sharing was not possible here. Download the GIF instead.'); }
  };
  $('dcdcopy').onclick = async () => { try { await navigator.clipboard.writeText(post); toast('Post text and link copied'); } catch { $('dcdtxt').select(); toast('Select the text and copy it'); } };
  CARD.last = { plan: { title: plan.title, frames: plan.frames.length, ra: plan.ra, dec: plan.dec, badge: plan.badge[0], half: plan.half }, size: blob.size, name };
  if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
}
$('dcard').onclick = makeCard;
$('dcdx').onclick = () => { const d = $('dcd'); d.close ? d.close() : d.removeAttribute('open'); };

/* ---------- Find the asteroid (v0.18): a 60-second game on real SPHEREx images ---------- */
// The same patch of sky from one sky pass, flipped like Tombaugh's blink comparator. Stars stay put; one dot is a real
// asteroid that is there in some images and gone (moved on) in the others. Tap it. Then the reveal names it, says how far
// it moved, and offers the Discovery card. Only a known asteroid the agents confirmed is used (default: 3865 Lindbloom from
// the bundled example), and the reveal says plainly that it is known, not a new discovery.
const GAME = { level: 'easy', on: false, plan: null, i: 0, timer: null, t0: 0, tries: 0, hint: false, done: false, won: false, secs: 0, share: null };
function gameAsteroid() { return S.inside && S.inside.asteroids.find(a => a.confirmed && a.sightings.length && a.sightings.every(x => S.frames.get(x.im.url))); }
function gamePlan(a) {
  const sg = a.sightings.slice().sort((p, q) => p.mjd - q.mjd), e = sg[0].e, n = S.field.n;
  // The images of the same colour as each sighting, from every sky pass: stars look the same in all of them (SPHEREx
  // images of different colours show stars at different brightness), and the asteroid is only in the images that caught it.
  const slotOf = im => multi() ? S.slots.findIndex(sl => sl[e] === im) : -1, set = new Set(sg.map(x => x.im));
  for (const x of sg) { const k = slotOf(x.im); if (k >= 0) S.slots[k].forEach(im => im && set.add(im)); else S.eps.forEach((_, i) => set.add(chosen(i))); }
  let ims = [...set].filter(im => S.frames.get(im.url)).sort((p, q) => p.mjd - q.mjd);
  if (ims.length < 3) ims = epochImgs(e).filter(im => S.frames.get(im.url)).sort((p, q) => p.mjd - q.mjd).slice(0, 8);
  if (ims.length > 10) ims = [...new Set([...sg.map(x => x.im), ...thin(ims, 10)])].sort((p, q) => p.mjd - q.mjd);
  const xs = sg.map(x => x.x), ys = sg.map(x => x.y), half = Math.min(n / 2, Math.max(34, (Math.max(...xs) - Math.min(...xs)) / 2 + 22));
  // the asteroid is not in the middle: a random spot in the inner part of the crop (so the answer is not "the centre")
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2, r = () => (Math.random() * 2 - 1) * half * 0.5;
  let cx = mx + r(), cy = my + r();
  cx = Math.max(half - 1, Math.min(n - half, cx)); cy = Math.max(half - 1, Math.min(n - half, cy));
  const hrs = (sg[sg.length - 1].mjd - sg[0].mjd) * 24, moved = Math.hypot(sg[sg.length - 1].x - sg[0].x, sg[sg.length - 1].y - sg[0].y) * S.field.s * 3600;
  // pixel-by-pixel median of these images (for the easy level)
  const arrs = ims.map(im => seeOf(S.frames.get(im.url))), med = new Float32Array(n * n), w = new Float64Array(arrs.length);
  for (let i = 0; i < n * n; i++) { let m = 0; for (const q of arrs) { const v = q[i]; if (v === v) w[m++] = v; } med[i] = m ? w.subarray(0, m).sort()[m >> 1] : NaN; }
  return { a, sg, e, ims, cx, cy, half, hrs, moved, med, inFrames: ims.filter(im => sg.some(x => x.im === im)).length };
}
// A clean view for the game: the image (with the pipeline's OUTLIER pixels kept, where moving objects are) through a 3 x 3
// median, shown from 3 sigma of that filtered noise up. Noise turns black and one- or two-pixel hits (cosmic rays, hot
// pixels) vanish, while stars and the asteroid, which spread over several pixels, stay. Same rule for every image.
// Easy level: the median of all the game's images is taken away first, so the stars (there in every image) vanish and
// what is left is what changes. Real level: the images as they are, like Tombaugh's plates.
const GCV = new WeakMap();
function gameCanvas(fr, base) {
  const key = base ? 'easy' : 'real', c0 = (GCV.get(fr) || {})[key]; if (c0 && c0.src === seeOf(fr) && c0.base === base) return c0.cv;
  const n = S.field.n, raw = seeOf(fr), a = base ? raw.map((v, i) => v - base[i]) : raw, med = base ? 0 : fr.st.med, sig = fr.st.sigma * (base ? 0.5 : 0.45), rgba = new Uint8ClampedArray(n * n * 4), w = new Float64Array(9);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let m = 0;
    for (let j = -1; j <= 1; j++) { const yy = y + j; if (yy < 0 || yy >= n) continue; for (let i = -1; i <= 1; i++) { const xx = x + i; if (xx < 0 || xx >= n) continue; const v = a[yy * n + xx]; if (v === v) w[m++] = v; } }
    const o = (y * n + x) * 4;
    if (m < 5) { rgba[o] = 11; rgba[o + 1] = 16; rgba[o + 2] = 32; rgba[o + 3] = 255; continue; }
    const v = w.subarray(0, m).sort(), t = (v[m >> 1] - med) / sig, b = Math.pow(Math.min(1, Math.max(0, (t - 3) / (base ? 8 : 14))), 0.55) * 255;
    rgba[o] = b; rgba[o + 1] = b * 0.93; rgba[o + 2] = b * 0.8; rgba[o + 3] = 255;
  }
  const cv = document.createElement('canvas'); cv.width = n; cv.height = n; cv.getContext('2d').putImageData(new ImageData(rgba, n, n), 0, 0);
  const o = GCV.get(fr) || {}; o[key] = { cv, src: raw, base }; GCV.set(fr, o); return cv;
}
function gameDraw() {
  const P = GAME.plan, cv = $('gcv'); if (!P || !cv) return;
  const dpr = Math.min(2, devicePixelRatio || 1), size = cv.clientWidth || 400;
  if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = cv.width; }
  const g = cv.getContext('2d'), Wc = cv.width, k = Wc / (2 * P.half), n = S.field.n, im = P.ims[GAME.i], fr = S.frames.get(im.url);
  const sx = P.cx + 0.5 - P.half, sy = P.cy + 0.5 - P.half;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, Wc, Wc);
  if (fr) {
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(n, sx + 2 * P.half), y1 = Math.min(n, sy + 2 * P.half);
    if (x1 > x0 && y1 > y0) { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(gameCanvas(fr, GAME.level === 'easy' ? P.med : null), x0, y0, x1 - x0, y1 - y0, (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k); }
  }
  const toC = p => [(p.x + 0.5 - sx) * k, (p.y + 0.5 - sy) * k];
  if (GAME.hint && !GAME.done) {   // a big circle that holds the asteroid somewhere inside
    const [hx, hy] = toC({ x: GAME.hint.x, y: GAME.hint.y }); g.strokeStyle = 'rgba(255,196,107,.75)'; g.lineWidth = 2 * dpr; g.setLineDash([8 * dpr, 6 * dpr]);
    g.beginPath(); g.arc(hx, hy, GAME.hint.r * k, 0, 7); g.stroke(); g.setLineDash([]);
  }
  for (const m of GAME.misses || []) { const [px, py] = toC(m); g.strokeStyle = 'rgba(255,107,107,.8)'; g.lineWidth = 2 * dpr; g.beginPath(); g.moveTo(px - 7 * dpr, py - 7 * dpr); g.lineTo(px + 7 * dpr, py + 7 * dpr); g.moveTo(px + 7 * dpr, py - 7 * dpr); g.lineTo(px - 7 * dpr, py + 7 * dpr); g.stroke(); }
  if (GAME.done) {   // the reveal: green ring where SPHEREx caught it in this image, grey ring where it was in the others
    const here = P.sg.filter(x => x.im === im), col = '#5ff0a0';
    for (const s of here.length ? here : [P.sg[0]]) {
      const [px, py] = toC(s); g.strokeStyle = here.length ? col : '#8e98ae'; g.lineWidth = 2.5 * dpr; g.setLineDash(here.length ? [] : [6 * dpr, 4 * dpr]);
      g.beginPath(); g.arc(px, py, Math.max(14 * dpr, 2.4 * k), 0, 7); g.stroke(); g.setLineDash([]);
      g.fillStyle = here.length ? col : '#8e98ae'; g.font = `650 ${13 * dpr}px Archivo, system-ui, sans-serif`;
      g.fillText(here.length ? P.a.name.replace(/^\d+\s+/, '') : 'gone from here', px + Math.max(18 * dpr, 2.4 * k + 4 * dpr), py - 8 * dpr);
    }
  }
  $('gframe').textContent = `Image ${GAME.i + 1} of ${P.ims.length} · ${fmtDay(im.mjd)} ${mjdDate(im.mjd).toISOString().slice(11, 16)} UTC`;
  $('gdots').replaceChildren(...P.ims.map((_, j) => h('i', { class: j === GAME.i ? 'on' : '' })));
}
function gamePlay(on) {
  clearInterval(GAME.timer); GAME.timer = null;
  if (on && GAME.plan) GAME.timer = setInterval(() => { if (!GAME.plan) return gamePlay(false); GAME.i = (GAME.i + 1) % GAME.plan.ims.length; gameDraw(); }, 650);
  $('gplay').textContent = on ? 'Pause' : 'Play'; $('gplay').setAttribute('aria-pressed', on);
}
function gameStep(d) { if (!GAME.plan) return; gamePlay(false); GAME.i = (GAME.i + d + GAME.plan.ims.length) % GAME.plan.ims.length; gameDraw(); }
function gameSay(t, cls = '') { const m = $('gmsg'); m.textContent = t; m.className = 'gmsg ' + cls; }
function gameOpen(a) {
  const P = gamePlan(a); Object.assign(GAME, { on: true, plan: P, i: 0, tries: 0, hint: false, done: false, won: false, misses: [], t0: performance.now() });
  $('gres').hidden = true; $('gctl2').hidden = false;
  $('glev').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lev === GAME.level));
  gameSay(`${GAME.level === 'easy' ? 'Easy level: the stars are taken away (each image minus the average of all of them), so only what changes is left. ' : 'Real level: the images as SPHEREx took them, stars and all. '}These are ${P.ims.length} real SPHEREx images of the same patch of sky, ${fmtDur((P.ims[P.ims.length - 1].mjd - P.ims[0].mjd) * 24)} apart from first to last. Stars stay put. One dot is an asteroid: it is there in some images and gone in the others. Tap it.`);
  const d = $('game'); if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
  requestAnimationFrame(() => { gameDraw(); gamePlay(true); });
}
function gameEnd(won) {
  if (!GAME.plan) return;   // v0.57.9: a button pressed before the game's images are ready
  const P = GAME.plan, a = P.a; GAME.done = true; GAME.won = won; GAME.secs = Math.round((performance.now() - GAME.t0) / 1000);
  gamePlay(false); GAME.i = P.ims.indexOf(P.sg[0].im); if (GAME.i < 0) GAME.i = 0; gameDraw(); $('gctl2').hidden = true;
  const caught = `SPHEREx caught it in ${P.sg.length} image${P.sg.length === 1 ? '' : 's'}` + (P.sg.length > 1 ? `, ${fmtDur(P.hrs)} apart, and it moved ${fmtAng(P.moved)} in that time` : '') + '. In the other images, taken at other times, it was somewhere else in the sky.';
  const who = viaMpc() ? 'the Minor Planet Center' : 'IMCCE SkyBoT';
  $('gresh').textContent = won ? `Yes! That's ${a.name}.` : `Here it is: ${a.name}.`;
  $('grest').textContent = `${caught} It is a known asteroid${a.cls && /^MB/.test(a.cls) ? ' from the main belt between Mars and Jupiter' : ''}: its position matches ${who}'s orbit prediction, so this is not a new discovery. Clyde Tombaugh found Pluto in 1930 the same way, by flipping between photographs.`;
  $('grests').textContent = won ? `Found in ${GAME.secs} s${GAME.tries > 1 ? ` on try ${GAME.tries}` : ' on the first try'}${GAME.hint ? ', with a hint' : ''}.` : 'Have another go: it is easier once you know what to look for.';
  $('gres').hidden = false; $('gcard').hidden = !won;
  gameSay(won ? 'You spotted a moving world in real space-telescope images.' : 'The green ring shows where it was. Step through the images to see it vanish.', won ? 'ok' : '');
}
$('gcv') && ($('gcv').onclick = e => {
  if (GAME.done || !GAME.plan) return;
  const cv = $('gcv'), r = cv.getBoundingClientRect(), P = GAME.plan, k = r.width / (2 * P.half);
  const gx = P.cx - P.half + (e.clientX - r.left) / k - 0.5, gy = P.cy - P.half + (e.clientY - r.top) / k - 0.5;
  // within 3 SPHEREx pixels (about 18″) of any place it was caught, or 18 screen px on a small screen
  const tol = Math.max(3, 18 / k), hit = P.sg.some(s => Math.hypot(s.x - gx, s.y - gy) <= tol);
  GAME.tries++;
  if (hit) return gameEnd(true);
  GAME.misses.push({ x: gx, y: gy }); gameDraw();
  if (GAME.tries >= 4) return gameEnd(false);
  gameSay(GAME.tries === 1 ? (GAME.level === 'easy' ? 'Not that one. A spot that flashes in only one image is usually a detector glitch. The asteroid shows up in images next to each other, a small step apart.' : 'Not that one. A star is there in every image. Look for a dot that is there in some images and missing in others.')
    : GAME.tries === 2 ? 'Not quite. Try Pause and the arrows: step image by image and watch for a dot that switches off.' : 'Last try. The Hint button draws a circle around the area.', 'no');
});
$('gplay') && ($('gplay').onclick = () => gamePlay(!GAME.timer));
$('gprev') && ($('gprev').onclick = () => gameStep(-1));
$('gnext') && ($('gnext').onclick = () => gameStep(1));
$('ghint') && ($('ghint').onclick = () => {
  const P = GAME.plan; if (!P || GAME.done) return;
  const s = P.sg[0], r = P.half * 0.35; GAME.hint = { x: s.x + (Math.random() * 2 - 1) * r * 0.5, y: s.y + (Math.random() * 2 - 1) * r * 0.5, r }; gameDraw();
  gameSay('It is somewhere inside the dashed circle.');
});
$('gshow') && ($('gshow').onclick = () => { if (!GAME.done) gameEnd(false); });
$('gagain') && ($('gagain').onclick = () => { const a = GAME.plan && GAME.plan.a; if (a) gameOpen(a); });
$('gx') && ($('gx').onclick = () => { gamePlay(false); GAME.on = false; const d = $('game'); d.close ? d.close() : d.removeAttribute('open'); });
$('game') && $('game').addEventListener('close', () => { gamePlay(false); GAME.on = false; });
$('gcard') && ($('gcard').onclick = () => {
  if (!GAME.plan) return; const a = GAME.plan.a; GAME.share = { name: a.name, secs: GAME.secs };
  $('game').close ? $('game').close() : $('game').removeAttribute('open');
  S.sel = { ast: a }; makeCard();
});
addEventListener('keydown', e => {
  if (!GAME.on || !$('game').open) return;
  if (e.key === 'ArrowRight') { gameStep(1); e.preventDefault(); } else if (e.key === 'ArrowLeft') { gameStep(-1); e.preventDefault(); } else if (e.key === ' ' && e.target === document.body) { gamePlay(!GAME.timer); e.preventDefault(); }
});
async function startGame() {
  closeIntro(); GAME.share = null;
  let a = gameAsteroid();
  if (!a) {
    toast('Loading real SPHEREx images of a field with an asteroid in it...', 6000);
    try { await runExample('proof', { focus: null }); } catch { /* reported by the agents */ }
    a = gameAsteroid();
  }
  if (!a) { toast('Could not load the game images. Try again in a moment.'); return; }
  try { history.replaceState(null, '', '#play'); } catch { /* ignore */ }
  gameOpen(a);
}
document.querySelectorAll('[data-play]').forEach(b => b.onclick = startGame);
$('glev') && $('glev').querySelectorAll('button').forEach(b => b.onclick = () => { GAME.level = b.dataset.lev; const a = GAME.plan && GAME.plan.a; if (a) gameOpen(a); });

// Phones (v0.15.4): the header buttons and the view tabs scroll sideways; fade the right edge while more is hidden there.
for (const el of document.querySelectorAll('.acts, .tabs')) {
  const upd = () => el.classList.toggle('more', el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
  el.addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd); setTimeout(upd, 300); upd();
}

/* ---------- v0.41: motion replay ----------
   Watch a mover move, frame by frame, in the real SPHEREx images, at the positions its catalogue gives:
   - a KNOWN ASTEROID within ONE pass. Asteroids leave this field within hours to days, so the next pass (six months later)
     shows other sky: never across passes. Frames: every loaded image of that pass in which the orbit catalogue puts it
     inside the field, in time order. + = the catalogue position at that image's time (the SkyBoT / MPC answer for that
     image when ARCNAVE asked, otherwise estimated from the catalogue's speed and direction, and said so); dashed circle =
     where the Analyst actually found it. No circle: not detected in that image.
   - a STAR or BROWN DWARF ACROSS passes (Barnard's Star, Epsilon Indi B, WISE 0855, a fast Gaia star): each pass's aligned
     image, + = where its catalogued proper motion puts it at the middle of that pass.
   Unknown dots are still never joined into tracks (v0.32: two dots can always be joined by a line). */
const REPLAY = { timer: 0 };
function replayStop() { clearInterval(REPLAY.timer); REPLAY.timer = 0; }
function replayPlayer(frames, win, top, hint) {
  // frames: [{ fr, mark: {x, y}, seen: {x, y} | null, label, sub }] in grid px; win: { x0, y0, w } fixed window, or null = follow the mark
  const SZ = 300, cv = h('canvas', { width: SZ, height: SZ, class: 'rpcv', role: 'img' }), g = cv.getContext('2d');
  const lab = h('b', { class: 'rpl' }), sub = h('small', { class: 'rps' }); let i = 0;
  const draw = () => {
    const f = frames[i], n = S.field.n, w = win ? win.w : 26, c0 = f.mark || f.at, x0 = win ? win.x0 : Math.round(c0.x) - (w >> 1), y0 = win ? win.y0 : Math.round(c0.y) - (w >> 1), sc = SZ / w;
    g.fillStyle = '#05070d'; g.fillRect(0, 0, SZ, SZ);
    if (f.fr) {   // one brightness scale for every frame (as in the proof cards), so "there, then gone" is honest
      const img = new ImageData(w, w), soft = 3 * f.fr.st.sigma, tp = Math.asinh(Math.max(top, 10 * f.fr.st.sigma) / soft), px = seeOf(f.fr);
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
        const X = x0 + x, Y = y0 + y, v = X >= 0 && Y >= 0 && X < n && Y < n ? px[Y * n + X] - f.fr.st.med : NaN;
        const t = Number.isFinite(v) ? Math.max(0, Math.min(1, Math.asinh(Math.max(v, 0) / soft) / tp)) : 0, o = (y * w + x) * 4;
        img.data[o] = 40 + 215 * t; img.data[o + 1] = 30 + 200 * t * t + 25 * t; img.data[o + 2] = 60 + 150 * t; img.data[o + 3] = 255;
      }
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = w; tmp.getContext('2d').putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false; g.drawImage(tmp, 0, 0, SZ, SZ);
    }
    const P = p => [(p.x - x0 + 0.5) * sc, (p.y - y0 + 0.5) * sc];
    const on = frames.filter(q => q.mark);   // frames where the catalogue puts it here ("not here" frames have no mark)
    if (win && on.length > 1) {   // the whole path: dashed line, a dot at every other frame's position (green = detected there)
      g.strokeStyle = 'rgba(153,246,228,.6)'; g.lineWidth = 1.3; g.setLineDash([3, 4]); g.beginPath();
      on.forEach((q, k) => { const [x, y] = P(q.mark); if (k) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
      on.forEach(q => { if (q === f) return; const [x, y] = P(q.mark); g.fillStyle = q.seen ? 'rgba(95,240,160,.85)' : 'rgba(153,246,228,.5)'; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); });
    }
    if (f.mark) { const [mx, my] = P(f.mark); g.strokeStyle = '#99f6e4'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(mx - 10, my); g.lineTo(mx - 4, my); g.moveTo(mx + 4, my); g.lineTo(mx + 10, my); g.moveTo(mx, my - 10); g.lineTo(mx, my - 4); g.moveTo(mx, my + 4); g.lineTo(mx, my + 10); g.stroke(); }
    else { g.fillStyle = 'rgba(5,7,14,.78)'; g.fillRect(0, SZ - 30, SZ, 30); g.fillStyle = '#99f6e4'; g.font = '600 13px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('Not here at this time', SZ / 2, SZ - 10); g.textAlign = 'left'; }
    if (f.seen) { const [sx, sy] = P(f.seen); g.strokeStyle = '#5ff0a0'; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); g.arc(sx, sy, Math.max(9, 2.2 * sc), 0, 7); g.stroke(); g.setLineDash([]); }
    lab.textContent = `${i + 1} of ${frames.length} · ${f.label}`; sub.textContent = f.sub;
    cv.setAttribute('aria-label', `Frame ${i + 1} of ${frames.length}: ${f.label}. ${f.sub}`);
  };
  const play = h('button', { class: 'hbtn rpplay', 'aria-pressed': 'false' }, 'Play');
  const go = d => { i = (i + d + frames.length) % frames.length; draw(); };
  const set = on => { replayStop(); play.setAttribute('aria-pressed', String(on)); play.textContent = on ? 'Pause' : 'Play';
    if (on) REPLAY.timer = setInterval(() => { if (!cv.isConnected) return replayStop(); go(1); }, 800); };
  play.onclick = () => set(!REPLAY.timer);
  const prev = h('button', { 'aria-label': 'Previous frame', onclick: () => { set(false); go(-1); } }, '◀');
  const next = h('button', { 'aria-label': 'Next frame', onclick: () => { set(false); go(1); } }, '▶');
  draw(); setTimeout(() => { if (cv.isConnected && !matchMedia('(prefers-reduced-motion: reduce)').matches) set(true); }, 500);
  return h('div', { class: 'replay' }, cv, h('div', { class: 'rpbar' }, prev, play, next, h('div', { class: 'rpt' }, lab, sub)), hint ? h('p', { class: 'legend' }, hint) : null);
}
// a square window around every mark (+ margin), or null when the path is too long for one window (then the view follows it)
function replayWindow(frames, minW, maxW) {
  const xs = frames.map(f => f.mark.x), ys = frames.map(f => f.mark.y), span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const w = Math.max(minW, Math.ceil(span) + 22); if (w > maxW) return null;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return { x0: Math.round(cx - w / 2), y0: Math.round(cy - w / 2), w };
}
function replayAsteroid(a) {
  if (!S.field || !a || !a.sightings || !a.sightings.length) return;
  const f = S.field, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, n = f.n, e = a.e, nm = String(a.key ? a.key.split('|')[0] : a.name);
  const sg = a.sightings.slice().sort((p, q) => p.mjd - q.mjd), slot0 = im => S.eps.findIndex((ep, k) => chosen(k) === im);
  const catAt = im => { const k = slot0(im), m = k >= 0 ? moversOf(k) : moversIm(im), it = m && m.items && m.items.find(x => String(x.num || x.name) === nm); return it ? [it.ra, it.dec] : null; };
  const near = mjd => sg.reduce((b, s) => Math.abs(s.mjd - mjd) < Math.abs(b.mjd - mjd) ? s : b, sg[0]);
  const frames = [];
  for (const im of epochImgs(e).slice().sort((p, q) => p.mjd - q.mjd)) {
    const fr = S.frames.get(im.url); if (!fr) continue;
    const s = sg.find(x => x.im.url === im.url); let sky = s ? [s.pred.ra, s.pred.dec] : catAt(im), est = false;
    if (!sky) { if (!Number.isFinite(a.dra) || !Number.isFinite(a.ddec)) continue; const s0 = near(im.mjd); sky = skyAhead({ ra: s0.pred.ra, dec: s0.pred.dec }, a, (im.mjd - s0.mjd) * 24); est = true; }
    const gp = F.skyToGrid(sky[0], sky[1], grid); if (!gp || gp[0] < 2 || gp[1] < 2 || gp[0] > n - 3 || gp[1] > n - 3) continue;
    const dt = (im.mjd - sg[0].mjd) * 24;
    frames.push({ fr, mjd: im.mjd, mark: { x: gp[0], y: gp[1] }, seen: s ? { x: s.x, y: s.y } : null,
      label: `${fmtDay(im.mjd)} ${mjdDate(im.mjd).toISOString().slice(11, 16)} UTC · ${lamOf(im).toFixed(2)} µm`,
      sub: `${dt >= 0 ? '+' : '−'}${fmtDur(Math.abs(dt))} from the first sighting · ${s ? 'seen ✓' : 'not detected here'} · ${est ? 'position estimated from its catalogue motion' : 'catalogue position'}` });
  }
  // the same spot at the visits just before and after (up to 2 each): the asteroid is not there, because its orbit has it
  // elsewhere then. That is what makes a mover show: empty, there, there, empty.
  const inF = new Set(frames.map(x => x.fr)), t0 = frames[0].mjd, t1 = frames[frames.length - 1].mjd, s0 = sg[0], arcs = PX * 3600, gone = [];
  for (const im of epochImgs(e)) {
    const fr = S.frames.get(im.url); if (!fr || inF.has(fr) || Math.abs(im.mjd - t0) < 0.04 || Math.abs(im.mjd - t1) < 0.04) continue;
    let where = 'not in this field at that time';
    if (Number.isFinite(a.dra) && Number.isFinite(a.ddec)) { const sky = skyAhead({ ra: s0.pred.ra, dec: s0.pred.dec }, a, (im.mjd - s0.mjd) * 24), gp = F.skyToGrid(sky[0], sky[1], grid);
      const d = gp ? Math.hypot(gp[0] - s0.x, gp[1] - s0.y) * arcs : null; if (d != null) where = `its catalogue motion puts it about ${fmtAng(d)} away then${gp[0] < 0 || gp[1] < 0 || gp[0] >= n || gp[1] >= n ? ', outside this field' : ''}`; }
    const dt = (im.mjd - s0.mjd) * 24;
    gone.push({ fr, mjd: im.mjd, mark: null, at: { x: s0.x, y: s0.y }, seen: null, label: `${fmtDay(im.mjd)} ${mjdDate(im.mjd).toISOString().slice(11, 16)} UTC · ${lamOf(im).toFixed(2)} µm`,
      sub: `${dt >= 0 ? '+' : '−'}${fmtDur(Math.abs(dt))} from the first sighting · not here: ${where}` });
  }
  const before = gone.filter(x => x.mjd < t0).sort((p, q) => q.mjd - p.mjd).slice(0, 2), after = gone.filter(x => x.mjd > t1).sort((p, q) => p.mjd - q.mjd).slice(0, 2);
  if (frames.length < 2 && !before.length && !after.length) { toast(`Only one image of pass ${e + 1} has ${a.name} inside this field, so there is nothing to replay.`, 6000); return; }
  const win = frames.length ? replayWindow(frames, 26, 96) : null;
  frames.unshift(...before.sort((p, q) => p.mjd - q.mjd)); frames.push(...after);
  const top = Math.max(0, ...sg.map(s => { const fr = S.frames.get(s.im.url); return fr ? F.sampleMax(seeOf(fr), n, s.x, s.y) - fr.st.med : 0; }));
  const nSeen = frames.filter(x => x.seen).length, nIn = frames.filter(x => x.mark).length, nOut = frames.length - nIn, hrs = (t1 - t0) * 24, mo = astMotion(a);
  replayStop(); S.sel = { replay: a }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  c.append(h('h3', {}, `${a.name}: its track`), h('span', { class: 'badge ' + (a.confirmed ? 'ok' : 'near') }, a.confirmed ? '✓ Confirmed known asteroid' : 'Matches a known object, but a check fails'),
    h('p', {}, `${nIn} SPHEREx image${nIn === 1 ? '' : 's'} of pass ${e + 1}${nIn > 1 ? `, ${fmtDur(hrs)} apart,` : ''} where its orbit (${KS()}) puts it in this field; SPHEREx detected it in ${nSeen}. ` +
      (nOut ? `With them, ${nOut} image${nOut === 1 ? '' : 's'} of the same spot from the visit${nOut === 1 ? '' : 's'} just ${before.length && after.length ? 'before and after' : before.length ? 'before' : 'after'}, where it is not there. ` : '') + 'In time order.' +
      (mo ? ` It moves ${mo.v.toFixed(1)}″ per hour (${mo.pxh.toFixed(1)} SPHEREx pixels per hour) toward the ${mo.dir}.` : '')),
    replayPlayer(frames, win, top, win
      ? '+ : its catalogue position in the frame on screen · dots: its positions in the other frames (green = detected there) · dashed line: its path · dashed circle: where SPHEREx saw it · "Not here": the same spot at another visit. Every frame uses one brightness scale.'
      : 'Its path is longer than one window, so the view follows it: + is its catalogue position, the dashed circle where SPHEREx saw it. Every frame uses one brightness scale.'),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'Within one pass only: an asteroid leaves this field within hours to days, so the next pass, six months later, shows other sky. A known asteroid that SPHEREx recorded, not a discovery. Unknown dots are never joined into tracks: two dots can always be joined by a line.'),
    h('p', {}, h('button', { onclick: () => { replayStop(); showAsteroid(a); } }, 'Back to its proof card')));
}
function replayAcross(o, name, back) {
  if (!S.field || S.eps.length < 2) { toast('Motion across passes needs at least two passes of this field.', 5000); return; }
  const f = S.field, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, n = f.n, arc = PX * 3600, frames = [];
  for (let i = 0; i < S.eps.length; i++) {
    const fr = frameOf(i); if (!fr) continue;
    const mj = epMid(i), p = ctAt(o, mj), gp = F.skyToGrid(p[0], p[1], grid); if (!gp || gp[0] < 2 || gp[1] < 2 || gp[0] > n - 3 || gp[1] > n - 3) continue;
    frames.push({ fr, mjd: mj, e: i, mark: { x: gp[0], y: gp[1] }, seen: null, label: `Pass ${i + 1} · ${fmtMonth(S.eps[i].t0)}`, sub: '' });
  }
  if (frames.length < 2) { toast(`${name} is not inside the images of two passes here, so there is nothing to replay.`, 6000); return; }
  const d0 = frames[0].mark, days = frames[frames.length - 1].mjd - frames[0].mjd;
  frames.forEach(fm => { const dd = Math.hypot(fm.mark.x - d0.x, fm.mark.y - d0.y);
    fm.sub = fm === frames[0] ? `${fmtDay(fm.mjd)} (middle of the pass) · the starting position` : `${fmtDay(fm.mjd)} (middle of the pass) · ${(dd * arc).toFixed(1)}″ (${dd.toFixed(2)} SPHEREx pixels) from pass ${frames[0].e + 1}`; });
  const last = frames[frames.length - 1].mark, tot = Math.hypot(last.x - d0.x, last.y - d0.y);
  const win = replayWindow(frames, 24, 80);
  const top = Math.max(0, ...frames.map(fm => F.sampleMax(seeOf(fm.fr), n, fm.mark.x, fm.mark.y) - fm.fr.st.med));
  // v0.44: its position MEASURED in every pass (not for a target too faint for the patch method, like WISE 0855)
  const tr = o.bg ? null : trackAcross(o);
  if (tr) { tr.name = name; S.track = tr; frames.forEach(fm => { const q = tr.pts.find(x => x.e === fm.e); if (q) fm.seen = { x: q.x, y: q.y }; }); }
  replayStop(); S.sel = { replayAcross: name }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  c.append(h('h3', {}, `${name}: motion across passes`),
    tr ? trackCard(name, tr) : h('p', { style: 'font-size:.85rem' }, o.bg ? `${name} is too faint for the pass-by-pass measurement; its motion is measured by the two-source fit on its card. Below: the expected positions.` : 'Could not measure its position in each pass here (too close to the edge, or a pass has no image at this colour). Below: the expected positions.'),
    h('p', {}, `The aligned image of each of ${frames.length} SPHEREx passes, the same window and one brightness scale. + : where its catalogued motion puts it at the middle of each pass${tr ? '; dashed circle: where ARCNAVE measured it' : ''}. ` +
      `In total ${(tot * arc).toFixed(1)}″ (${tot.toFixed(2)} SPHEREx pixels) in ${Math.round(days)} days` +
      (tot < 1 ? ': less than one pixel, so look closely: the blur of the star shifts a little against its neighbours.' : ': watch it shift against the stars around it.')),
    replayPlayer(frames, win || { x0: Math.round(d0.x) - 20, y0: Math.round(d0.y) - 20, w: 40 }, top, '+ : expected position in the pass on screen · dots: the other passes · dashed line: its path. The stars around it stay put; the images are aligned on them.'),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'Across passes because a nearby star or brown dwarf stays in the field for years. The + comes from the catalogue (Gaia DR3, or the challenge target\'s known motion), not from this replay.'),
    back ? h('p', {}, h('button', { onclick: () => { replayStop(); back(); } }, 'Back')) : null);
}

/* ---------- v0.42: known asteroids, where they went (Changes) ----------
   Every known object the orbit catalogue (SkyBoT, or the Minor Planet Center when SkyBoT is slow) lists inside the field at
   a pass's first lookup, drawn as a line from where its catalogue speed and direction put it at the pass's first image to
   its last: one line per object per pass, in that pass's colour. Solid = SPHEREx caught it (a confirmed sighting);
   dashed = it was there but not detected; faint = fainter than one SPHEREx image can show (V 19). Lines are never joined
   from one pass to the next: an asteroid crosses this field in hours to days, and the passes are six months apart.
   The "0 known asteroids" card now says why (none listed, all too faint, or the services did not answer). */
const KP = { cache: null, key: '' };
function knownPaths() {
  if (!S.field || !S.eps.length) return [];
  const key = S.run + '|' + S.eps.length + '|' + [...S.movers.keys()].length + '|' + ((S.inside && S.inside.asteroids) || []).length;
  if (KP.key === key && KP.cache) return KP.cache;
  const f = S.field, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, n = f.n, out = [];
  const conf = ((S.inside && S.inside.asteroids) || []).filter(a => a.confirmed), caught = new Set(conf.map(a => String(a.key || '').split('|')[0] + '|' + a.e));
  // does the straight path from a to b cross the images (the lookups reach a little beyond the field's corners)?
  const crosses = (a, b) => { for (let k = 0; k <= 20; k++) { const t = k / 20, g = F.skyToGrid(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, grid); if (g && g[0] >= 0 && g[1] >= 0 && g[0] < n && g[1] < n) return true; } return false; };
  const line = (e, it, ra, dec, tRef, ts) => { const at = t => [ra + it.dra * (t - tRef) * 24 / 3600 / Math.cos(dec * Math.PI / 180), dec + it.ddec * (t - tRef) * 24 / 3600], a = at(ts[0]), b = at(ts[ts.length - 1]), id = String(it.num || it.name);
    return { e, it, id, bright: Number.isFinite(it.vmag) && it.vmag <= PROOF.vLimit, caught: caught.has(id + '|' + e), a, b, inField: crosses(a, b) }; };
  S.eps.forEach((ep, e) => {
    const ts = epochImgs(e).map(im => im.mjd).sort((a, b) => a - b); if (!ts.length) return;
    const m = moversOf(e), seen = new Set();
    if (m && m.items) { const t0 = Number.isFinite(m.mjd) ? m.mjd : chosen(e).mjd;
      for (const it of m.items) { if (!Number.isFinite(it.dra) || !Number.isFinite(it.ddec) || !Number.isFinite(it.ra)) continue; const p = line(e, it, it.ra, it.dec, t0, ts); out.push(p); seen.add(p.id); } }
    // an asteroid SPHEREx caught in this pass but not inside the field at the pass's first lookup: its line from its sightings
    for (const a of conf.filter(x => x.e === e)) { const id = String(a.key || '').split('|')[0]; if (seen.has(id) || !Number.isFinite(a.dra)) continue;
      const s0 = a.sightings.slice().sort((p, q) => p.mjd - q.mjd)[0], num = /^\d+$/.test(id) ? +id : null;
      out.push(line(e, { num, name: num ? a.name.replace(/^\d+\s+/, '') : a.name, vmag: a.vmag, dra: a.dra, ddec: a.ddec }, s0.pred.ra, s0.pred.dec, s0.mjd, ts)); }
  });
  KP.key = key; KP.cache = out; return out;
}
function drawKnownPaths(all) {
  const fov = S.al.getFov()[0];
  for (const k of knownPaths()) {
    const strong = k.bright || k.caught; if (!k.inField || (!all && !strong)) continue;
    const p0 = proj(k.a[0], k.a[1]), p1 = proj(k.b[0], k.b[1]); if (!p0 || !p1) continue;
    const col = passCol(k.e), L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    ctx.globalAlpha = strong ? 0.95 : 0.26; ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = strong ? 2.2 : 0.9; ctx.setLineDash(k.caught ? [] : [6, 5]);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p0[0], p0[1], strong ? 3 : 1.8, 0, 7); ctx.fill();   // where it was at the pass's first image
    if (L > 8) { const ux = (p1[0] - p0[0]) / L, uy = (p1[1] - p0[1]) / L, s = strong ? 6 : 4;   // arrowhead: where it was at the last
      ctx.beginPath(); ctx.moveTo(p1[0] + ux * s, p1[1] + uy * s); ctx.lineTo(p1[0] - uy * s * 0.7, p1[1] + ux * s * 0.7); ctx.lineTo(p1[0] + uy * s * 0.7, p1[1] - ux * s * 0.7); ctx.fill(); }
    if (strong && fov < 1.5) { ctx.font = '600 11px Inter,system-ui,sans-serif'; ctx.fillText(`${k.it.num ? k.it.num + ' ' : ''}${k.it.name} · pass ${k.e + 1}${k.caught ? ' ✓' : ''}`, p1[0] + 8, p1[1] - 6); }
    ctx.globalAlpha = 1;
  }
}
function knownWhy(long) {
  const K = S.known || [], vals = [...S.movers.values()], failed = vals.filter(m => m && m.err).length, looked = vals.some(m => m && m.items);
  if (!looked && failed) return long ? 'SkyBoT and the Minor Planet Center did not answer, so ARCNAVE could not check known objects here. Run the agents again in a few minutes.'
    : 'Lookup failed: SkyBoT and the MPC did not answer. Run again later.';
  if (!looked) return long ? 'Known objects have not been looked up for this field yet.' : 'Not looked up yet.';
  // one source for every number: the per-pass paths (the same objects the lines and the list show)
  const P = knownPaths().filter(p => p.inField), ids = new Set(P.map(p => p.id + '|' + p.e)), caught = new Set(P.filter(p => p.caught).map(p => p.id + '|' + p.e)).size;
  if (!ids.size) return long ? `No known asteroid or comet crossed the images of this field during these passes (asked ${KS()}).` : `None crossed this field (asked ${KS()}).`;
  const vm = P.map(p => p.it.vmag).filter(Number.isFinite), br = vm.length ? Math.min(...vm) : null, bright = new Set(P.filter(p => p.bright).map(p => p.id + '|' + p.e)).size;
  return long ? `${ids.size} known object${ids.size === 1 ? '' : 's'} crossed the images during these passes (from ${KS()}); ${bright} bright enough for one SPHEREx image (V ${PROOF.vLimit} or brighter)${br != null ? `, the brightest V ${br.toFixed(1)}` : ''}; SPHEREx caught ${caught}.` +
      (failed ? ` ${failed} lookup${failed === 1 ? '' : 's'} failed (no answer), so a few images were not checked.` : '')
    : `${ids.size} known crossed, ${caught} caught${!caught && !bright && br != null ? `: all too faint (brightest V ${br.toFixed(1)})` : !caught ? `: ${bright} bright enough, not detected` : ''}. Tap for their paths.`;
}
function showKnownPaths() {
  S.sel = { kpaths: true }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const byE = new Map(); for (const p of knownPaths()) { if (!p.inField) continue; const a = byE.get(p.e) || []; a.push(p); byE.set(p.e, a); }
  c.append(h('h3', {}, '☄ Known asteroids: where they went'), h('p', {}, knownWhy(true)),
    h('p', {}, `On the sky: a line for each known object in each pass, in that pass's colour, from where its catalogue speed and direction (${KS()}) put it at the pass's first image to its last (arrowhead). ` +
      'Solid: SPHEREx caught it. Dashed: it was there, but not detected. Faint: fainter than one SPHEREx image can show.'),
    byE.size ? h('ul', { class: 'kplist' }, ...[...byE].sort((p, q) => p[0] - q[0]).map(([e, ps]) => {
      const strong = ps.filter(p => p.bright || p.caught).sort((p, q) => (p.it.vmag ?? 99) - (q.it.vmag ?? 99));
      return h('li', {}, h('b', { style: `color:${passCol(e)}` }, `Pass ${e + 1} (${fmtMonth(S.eps[e].t0)}): `), `${ps.length} known object${ps.length === 1 ? '' : 's'}` +
        (strong.length ? `; bright enough to see: ${strong.slice(0, 5).map(p => `${p.it.num ? p.it.num + ' ' : ''}${p.it.name} (V ${Number.isFinite(p.it.vmag) ? p.it.vmag.toFixed(1) : '?'}${p.caught ? ', caught ✓' : ', not detected'})`).join(', ')}` : '; all too faint for one SPHEREx image'));
    })) : null,
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'Each pass shows different objects: an asteroid crosses this field in hours to days, and the passes are six months apart, so the lines are never joined from one pass to the next. A path is a straight-line estimate from the catalogue speed and direction over that pass.'),
    h('p', {}, h('button', { onclick: () => { CHGW.show = null; S.sel = null; renderChgPanel(); showReport(); } }, 'Back to all changes')));
}

/* ---------- v0.44: the measured track across passes ----------
   For a star or brown dwarf that really moves (a challenge target, or a fast Gaia star): its position MEASURED in every pass,
   not just predicted. Each pass's aligned image is compared with the first pass by the same patch-sliding measurement that
   gives Barnard's Star 9.7″ (ctShift: images lined up on the stars, the star's patch slid in 0.1-pixel steps until it
   matches). The pass-1 position is the catalogue's; every later position is pass 1 + the measured shift. Drawn on the sky
   (a dot per pass with its month, an arrow first -> last) and said in words on the card. Not for WISE 0855: too faint for
   this patch method (its own two-source fit is on its card). */
function trackAcross(o) {
  if (!S.field || S.eps.length < 2) return null;
  const f = S.field, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, n = f.n, arc = PX * 3600, edge = p => !p || p[0] < 12 || p[1] < 12 || p[0] > n - 13 || p[1] > n - 13;
  const eps = []; for (let k = 0; k < S.eps.length; k++) { const fr = frameOf(k), exp = F.skyToGrid(...ctAt(o, epMid(k)), grid); if (fr && !edge(exp)) eps.push({ k, fr, exp }); }
  if (eps.length < 2) return null;
  const a = eps[0], pts = [];
  for (const q of eps) {
    let d = { dx: 0, dy: 0 };
    if (q !== a) { const b = ctShift(a.exp, q.exp, a.fr, q.fr); if (!b) continue; d = b; }
    const x = a.exp[0] + d.dx, y = a.exp[1] + d.dy, sky = F.gridToSky(x, y, grid), es = F.gridToSky(q.exp[0], q.exp[1], grid);
    pts.push({ e: q.k, mjd: epMid(q.k), x, y, ra: sky[0], dec: sky[1], exRa: es[0], exDec: es[1], shift: Math.hypot(d.dx, d.dy) * arc, expShift: Math.hypot(q.exp[0] - a.exp[0], q.exp[1] - a.exp[1]) * arc });
  }
  if (pts.length < 2) return null;
  // direction on the sky from the first to the last MEASURED position (east of north; on the sky east is to the left)
  const p0 = pts[0], p1 = pts[pts.length - 1], dE = (p1.ra - p0.ra) * Math.cos(p0.dec * Math.PI / 180) * 3600, dN = (p1.dec - p0.dec) * 3600;
  const pa = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
  const tr = { pts, total: Math.hypot(dE, dN), dir: COMPASS[Math.round(pa / 45) % 8], days: p1.mjd - p0.mjd, expTotal: p1.expShift, run: S.run };
  try { tr.ff = frameFit(o, tr); } catch (e) { tr.ff = null; console.warn('frame-by-frame fit failed', e); }   // v0.46: every image, lined up on Gaia
  return tr;
}
const fmtRaDec = (ra, dec) => `RA ${ra.toFixed(5)}°, Dec ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(5)}°`;
function trackCard(name, tr) {
  const p0 = tr.pts[0], p1 = tr.pts[tr.pts.length - 1];
  return h('div', { class: 'trk' },
    h('p', { class: 'trksum' }, h('b', {}, `${name} moved `), `from ${fmtRaDec(p0.ra, p0.dec)} (pass ${p0.e + 1}, ${fmtMonth(S.eps[p0.e].t0)}) to ${fmtRaDec(p1.ra, p1.dec)} (pass ${p1.e + 1}, ${fmtMonth(S.eps[p1.e].t0)}): ` +
      `${tr.total.toFixed(1)}″ toward the ${tr.dir} in ${Math.round(tr.days)} days.` + (tr.noCat ? ' No catalogue motion to compare with.' : ` Its catalogued motion predicts ${tr.expTotal.toFixed(1)}″.`)),
    h('ol', { class: 'trklist' }, ...tr.pts.map((q, i) => h('li', {}, h('b', {}, `Pass ${q.e + 1} · ${fmtMonth(S.eps[q.e].t0)}`), ' ',
      i === 0 ? (tr.noCat ? 'starting position (where it was in pass 1)' : 'starting position (from the catalogue)') : `measured ${q.shift.toFixed(1)}″ from pass ${p0.e + 1}` + (tr.noCat ? '' : ` (expected ${q.expShift.toFixed(1)}″)`)))),
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'Measured on the images on screen: every pass is lined up on the stars, then the star\'s patch is slid over pass 1 in 0.1-pixel steps until it matches (one SPHEREx pixel is 6.2″, so expect about 1″ of scatter). On the sky: a dot per pass with its month and an arrow from the first pass to the last.'),
    ffCard(tr.ff));
}
// v0.55: was a second "function drawTrack", which silently replaced the JPL Horizons track button's drawTrack(it). Renamed only.
function drawMeasTrack() {
  const tr = S.track; if (!tr || tr.run !== S.run) return;
  const pts = tr.pts.map(q => ({ q, p: proj(q.ra, q.dec) })).filter(x => x.p); if (pts.length < 2) return;
  const fov = S.al.getFov()[0], col = '#67e8f9';
  ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.2;
  // a line through the measured positions, long enough to read even when the shift is under a pixel on screen
  const a = pts[0].p, b = pts[pts.length - 1].p, L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = L > 0.5 ? (b[0] - a[0]) / L : 0, uy = L > 0.5 ? (b[1] - a[1]) / L : -1, ext = Math.max(0, 40 - L);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); pts.slice(1).forEach(x => ctx.lineTo(x.p[0], x.p[1])); ctx.lineTo(b[0] + ux * ext, b[1] + uy * ext); ctx.stroke();
  const tip = [b[0] + ux * ext, b[1] + uy * ext]; ctx.beginPath(); ctx.moveTo(tip[0] + ux * 9, tip[1] + uy * 9); ctx.lineTo(tip[0] - uy * 6, tip[1] + ux * 6); ctx.lineTo(tip[0] + uy * 6, tip[1] - ux * 6); ctx.fill();
  // a dot per pass with its pass number (the dots can sit within a pixel of each other, so the dates go in one label)
  ctx.font = '700 10px Inter,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  pts.forEach((x, i) => { ctx.beginPath(); ctx.arc(x.p[0], x.p[1], i === 0 ? 4 : 3, 0, 7); ctx.fillStyle = i === 0 ? '#fff' : col; ctx.fill(); });
  if (fov < 0.6) {
    const side = [-uy, ux];   // number tags fanned out on one side of the track, so they never cover each other
    pts.forEach((x, i) => { const r = 16 + i * 13, tx = a[0] + side[0] * r, ty = a[1] + side[1] * r;
      ctx.strokeStyle = 'rgba(103,232,249,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x.p[0], x.p[1]); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = 'rgba(5,8,15,.85)'; ctx.beginPath(); ctx.arc(tx, ty, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#e6fffb'; ctx.fillText(String(x.q.e + 1), tx, ty + 0.5); });
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const lines = [`${tr.name}: ${tr.total.toFixed(1)}″ toward the ${tr.dir} (measured)`, pts.map(x => `${x.q.e + 1} ${fmtMonth(S.eps[x.q.e].t0)}`).join('  →  ')];
    ctx.font = '600 11px Inter,system-ui,sans-serif'; const w = Math.max(...lines.map(s => ctx.measureText(s).width)) + 16, lx = tip[0] + 14, ly = tip[1] - 22;
    ctx.fillStyle = 'rgba(5,8,15,.82)'; ctx.fillRect(lx, ly, w, 38); ctx.strokeStyle = 'rgba(103,232,249,.5)'; ctx.strokeRect(lx, ly, w, 38);
    ctx.fillStyle = col; ctx.fillText(lines[0], lx + 8, ly + 15); ctx.fillStyle = '#e6fffb'; ctx.fillText(lines[1], lx + 8, ly + 30);
  }
  ctx.restore();
}

/* ---------- v0.45: automatic motion search across passes ----------
   ARCNAVE looks for moving stars by itself. The brightest isolated stars of the first pass (up to 120) are measured in
   every later pass with the same patch match as the targets (images lined up on the stars; the star's patch slid until it
   matches; here 0.25-pixel steps over ±2.5 pixels, then 0.05 around the best). In each pass the shift every star shares
   (left-over alignment) is taken off, and the stars' own scatter is measured (robust: from the median). A star is flagged
   when it moved at least 1.5″ AND at least 5x that scatter, in a consistent direction across the passes. Each flagged star
   is then checked against Gaia DR3: "known mover" (Gaia predicts that motion), "Gaia says fixed" (likely a blend or an
   artefact), or "unconfirmed candidate" (no Gaia star there). Never a discovery claim. Gaia stars that should have been
   flagged but were not are counted too. Stars only: an asteroid leaves the field within days. */
const MS = { res: null, busy: false };
function msShift(A, B, p, H = 6, R = 2.5) {
  const n = S.field.n, cx = Math.round(p.x), cy = Math.round(p.y), M = H + R + 2;
  if (cx - M < 0 || cy - M < 0 || cx + M >= n || cy + M >= n) return null;
  const av = [], am = A.st.med, bv = B.flat, bm = B.st.med;
  for (let j = -H; j <= H; j++) for (let i = -H; i <= H; i++) av.push(A.flat[(cy + j) * n + cx + i] - am);
  const at = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, o = y0 * n + x0;
    return (bv[o] - bm) * (1 - fx) * (1 - fy) + (bv[o + 1] - bm) * fx * (1 - fy) + (bv[o + n] - bm) * (1 - fx) * fy + (bv[o + n + 1] - bm) * fx * fy; };
  const chi = (dx, dy) => { let sab = 0, sbb = 0, saa = 0, k = 0;
    for (let j = -H; j <= H; j++) for (let i = -H; i <= H; i++) { const a = av[k++], b = at(cx + i + dx, cy + j + dy); if (!Number.isFinite(a) || !Number.isFinite(b)) continue; sab += a * b; sbb += b * b; saa += a * a; }
    if (!(sbb > 0)) return Infinity; const sc = sab / sbb; return saa - 2 * sc * sab + sc * sc * sbb; };
  let best = { dx: 0, dy: 0, c: Infinity };
  for (let dy = -R; dy <= R + 1e-6; dy += 0.25) for (let dx = -R; dx <= R + 1e-6; dx += 0.25) { const c = chi(dx, dy); if (c < best.c) best = { dx, dy, c }; }
  const c0 = best;
  for (let dy = c0.dy - 0.25; dy <= c0.dy + 0.25 + 1e-6; dy += 0.05) for (let dx = c0.dx - 0.25; dx <= c0.dx + 0.25 + 1e-6; dx += 0.05) { const c = chi(dx, dy); if (c < best.c) best = { dx, dy, c }; }
  if (!Number.isFinite(best.c) || Math.abs(best.dx) >= R - 0.1 || Math.abs(best.dy) >= R - 0.1) return null;   // at the edge of the search: no real match (seen live: 20-24″ "moves")
  // how well the star's patch matches there (correlation 0-1); a drift onto noise or a neighbour matches poorly
  // blank pixels (a saturated core is blanked) are skipped, as in the match itself
  let sab = 0, saa = 0, sbb = 0, k = 0, sa = 0, sb = 0, nn = 0; const pr = [];
  for (let j = -H; j <= H; j++) for (let i = -H; i <= H; i++) { const a = av[k++], b = at(cx + i + best.dx, cy + j + best.dy); if (!Number.isFinite(a) || !Number.isFinite(b)) continue; pr.push([a, b]); sa += a; sb += b; nn++; }
  if (nn < 20) return null;
  const ma = sa / nn, mb = sb / nn;
  for (const [a0, b0] of pr) { const a = a0 - ma, b = b0 - mb; sab += a * b; saa += a * a; sbb += b * b; }
  best.r = saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  return best;
}
const msMed = a => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
/* v0.55 U9: one progress card for the four searches (🔍 🔭 ◐ 🎯): what it is doing, a skeleton where the result will
   go, and Cancel. Cancel sets X.stop; each search's own run checks then return at the next step. A result from an earlier
   run is kept, since every search writes its result only when it finishes. */
function srchSay(X, title, txt, prog, again) {
  if (X.stop) return; const c = $('card');
  c.replaceChildren(h('h3', {}, title), h('p', {}, txt), prog ? h('p', {}, prog) : null,
    h('div', { class: 'rskel srsk', 'aria-hidden': 'true' }, h('span', { class: 'sk sk-h' }), h('span', { class: 'sk' }), h('span', { class: 'sk sk-s' }), h('span', { class: 'sk sk-box' })),
    h('p', { class: 'srcan' }, h('button', { type: 'button', onclick: () => srchCancel(X, title, again) }, 'Cancel')));
  c.hidden = false; X.card = true;
}
function srchCancel(X, title, again) {
  X.stop = true; X.card = false; const c = $('card');
  c.replaceChildren(h('h3', {}, title.replace(/:.*$/, ': stopped')), h('p', {}, 'Stopped. Nothing on the sky was changed' + (X.res && X.res.run === S.run ? '; the result of the earlier run is kept.' : '.')),
    h('p', {}, h('button', { type: 'button', class: 'hbtn', onclick: async () => { while (X.busy) await sleep(100); again(); } }, 'Run it again'), ' ',
      h('button', { type: 'button', onclick: () => { S.sel = null; S.report ? showReport() : (c.hidden = true); } }, 'Close')));
  c.hidden = false;
}
// when a search ends on a message (too few images, Gaia did not answer...), the card keeps the message without the skeleton
function srchDone(X) { if (!X.card) return; X.card = false; const c = $('card'); c.querySelectorAll('.srsk, .srcan').forEach(e => e.remove()); }
async function motionSearch() {
  if (!S.field || S.eps.length < 2) { toast('The motion search needs at least two passes of this field.', 5000); return; }
  if (MS.busy) return; MS.busy = true; MS.stop = false;
  const f = S.field, n = f.n, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n }, arc = PX * 3600, run = S.run;
  const say = (txt, i, m) => srchSay(MS, '🔍 Moving stars: searching', txt, m ? `Measuring ${i} of ${m} stars...` : null, motionSearch);   // v0.55 U9
  try {
    const eps = []; for (let k = 0; k < S.eps.length; k++) { const fr = frameOf(k); if (fr) eps.push({ k, fr }); }
    if (eps.length < 2) { say('The aligned images of two passes are not loaded yet. Run the agents first.'); return; }
    const A = eps[0].fr, later = eps.slice(1);
    say('Finding the bright stars of the first pass...');
    try { await gaiaLoad(); } catch { /* checked below */ }   // v0.56: always for THIS field (it kept the last field's stars)
    await warmEpsf(() => run === S.run && !MS.stop); await fieldFloorWarm(() => run === S.run && !MS.stop); if ((run !== S.run || MS.stop)) return;   // v0.57.5: star shapes and the field floor first, with pauses
    const peaks = F.detectPeaks(A.flat, n, A.st, 10, 300).filter(p => p.x > 16 && p.y > 16 && p.x < n - 17 && p.y < n - 17);
    const stars = peaks.filter((p, i) => !peaks.some((q, j) => j < i && Math.hypot(q.x - p.x, q.y - p.y) < 5)).slice(0, 120);   // isolated: no brighter star within 5 px
    const meas = [];
    for (let i = 0; i < stars.length; i++) {
      await breathe(); if ((run !== S.run || MS.stop)) return;   // v0.57.8: a pause every 50 ms (it was every 6th star)
      const s = stars[i], d = later.map(q => msShift(A, q.fr, s)); if (d.some(x => !x)) continue;
      meas.push({ s, d }); if (i % 6 === 0) { say(`Measuring every bright star in ${eps.length} passes (${eps.map(q => fmtMonth(S.eps[q.k].t0)).join(', ')}).`, i, stars.length); await sleep(0); }
    }
    if (meas.length < 8) { say(`Only ${meas.length} stars could be measured here: too few to know the scatter, so no search.`); return; }
    // per later pass: the shift all stars share (left-over alignment), and the stars' own scatter (robust)
    const passStats = later.map((q, j) => { const mx = msMed(meas.map(m => m.d[j].dx)), my = msMed(meas.map(m => m.d[j].dy));
      const r = meas.map(m => Math.hypot(m.d[j].dx - mx, m.d[j].dy - my)); return { mx, my, sig: Math.max(0.05, msMed(r) / 1.177) }; });   // median of a 2-D normal scatter = 1.177 sigma
    const firstMjd = epMid(eps[0].k), flagged = [];
    for (const m of meas) {
      const v = m.d.map((d, j) => ({ dx: d.dx - passStats[j].mx, dy: d.dy - passStats[j].my, z: Math.hypot(d.dx - passStats[j].mx, d.dy - passStats[j].my) / passStats[j].sig }));
      const L = v[v.length - 1], shiftArc = Math.hypot(L.dx, L.dy) * arc;
      // 2″ and 5x the scatter, and a good match in every pass (a very bright star's saturated core changes shape a little, so 0.85 there)
      const rMin = m.s.snr >= 500 ? 0.85 : 0.9;
      if (shiftArc < 2 || L.z < 5 || m.d.some(d => !(d.r >= rMin))) continue;
      // consistent: every later pass moves the same way (within 60°) and does not go backwards by more than its scatter
      const okDir = v.every((q, j) => { const r = Math.hypot(q.dx, q.dy); if (r * arc < 0.8) return true; const cos = (q.dx * L.dx + q.dy * L.dy) / (r * Math.hypot(L.dx, L.dy)); return cos > 0.5; });
      if (!okDir) continue;
      const sky0 = F.gridToSky(m.s.x, m.s.y, grid), sky1 = F.gridToSky(m.s.x + L.dx, m.s.y + L.dy, grid);
      const dE = (sky1[0] - sky0[0]) * Math.cos(sky0[1] * Math.PI / 180) * 3600, dN = (sky1[1] - sky0[1]) * 3600, pa = (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
      flagged.push({ x: m.s.x, y: m.s.y, ra: sky0[0], dec: sky0[1], ra1: sky1[0], dec1: sky1[1], shift: shiftArc, z: L.z, dir: COMPASS[Math.round(pa / 45) % 8], v, snr: m.s.snr });
    }
    flagged.sort((p, q) => q.z - p.z);
    // Gaia check: the Gaia star at this spot (within 6″ at pass 1's date) and the motion it predicts
    const days = epMid(eps[eps.length - 1].k) - firstMjd, gs = (GAIA.data && GAIA.data.stars) || [];
    for (const fl of flagged) {
      let g = null, gd = 6;
      for (const s of gs) { const p = gAt(s, firstMjd), d = Math.hypot((p[0] - fl.ra) * Math.cos(fl.dec * Math.PI / 180), p[1] - fl.dec) * 3600; if (d < gd) { gd = d; g = s; } }
      // a bright star's measured centre can sit off (its saturated core is blanked, so the peak is on the rim): up to 15″,
      // 25″ below G 9 and 40″ below G 6, and only when Gaia's motion agrees in size and direction
      if (!g) for (const s of gs) { if (s.pmra == null) continue; const p = gAt(s, firstMjd), d = Math.hypot((p[0] - fl.ra) * Math.cos(fl.dec * Math.PI / 180), p[1] - fl.dec) * 3600; if (d > (s.g < 6 ? 40 : s.g < 9 ? 25 : 15)) continue;
        const pr = gPm(s) * days / 365.25, q1 = gAt(s, firstMjd + days), gE = (q1[0] - p[0]) * Math.cos(p[1] * Math.PI / 180) * 3600, gN = (q1[1] - p[1]) * 3600;
        const mE = (fl.ra1 - fl.ra) * Math.cos(fl.dec * Math.PI / 180) * 3600, mN = (fl.dec1 - fl.dec) * 3600, cos = (gE * mE + gN * mN) / (Math.hypot(gE, gN) * Math.hypot(mE, mN) || 1);
        if (pr >= 1 && cos > 0.7 && Math.abs(pr - fl.shift) < Math.max(2, 0.4 * pr)) { g = s; break; } }
      const pred = g && g.pmra != null ? gPm(g) * days / 365.25 : null;
      fl.gaia = g; fl.pred = pred;
      fl.label = !GAIA.data ? 'unchecked' : !g ? 'candidate' : pred != null && pred >= 1 && Math.abs(pred - fl.shift) < Math.max(2, 0.4 * pred) ? 'known' : pred != null && pred < 0.5 ? 'fixed' : 'differs';
    }
    // honesty: Gaia stars moving enough to see that the search did not flag (too faint, blended, at the edge...)
    const missed = gs.filter(s => s.pmra != null && gPm(s) * days / 365.25 >= 2 && (() => { const p = gAt(s, firstMjd), g = F.skyToGrid(p[0], p[1], grid); return g && g[0] > 16 && g[1] > 16 && g[0] < n - 17 && g[1] < n - 17; })())
      .filter(s => !flagged.some(fl => fl.gaia === s));
    MS.res = { run, flagged, nStars: meas.length, passes: eps.map(q => q.k), sig: passStats.map(p => p.sig * arc), days, missed, gaiaOk: !!GAIA.data };
    showMotionSearch();
  } finally { MS.busy = false; srchDone(MS); }   // v0.55 U9
}
// v0.53: the label's words for one find, naming the catalogue that agrees (Gaia DR3 or CatWISE2020)
function msLabel(fl) {
  if (fl.label === 'known' && fl.cw) return ['ok', `✓ Known mover (CatWISE2020 agrees: ${fl.cw.name}, ${fl.pm.toFixed(2)}″/yr)`];
  if (fl.label === 'candidate' && fl.cwNear) return ['unc', `Unconfirmed candidate: not in Gaia; CatWISE2020 lists a mover here (${fl.cwNear.cw.name}) with a different motion, ${fl.cwNear.pm.toFixed(2)}″/yr`];
  return MS_LABEL[fl.label] || MS_LABEL.candidate;
}
const MS_LABEL = { known: ['ok', '✓ Known mover (Gaia agrees)'], candidate: ['unc', 'Unconfirmed candidate: no Gaia star here'], fixed: ['near', 'Gaia says it hardly moves: likely a blend or an artefact'],
  differs: ['near', 'Gaia star here, but a different motion: check it'], unchecked: ['unc', 'Not checked: Gaia did not answer'] };
function showMotionSearch() {
  const r = MS.res; if (!r || r.run !== S.run) return;
  S.sel = { msearch: true }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const lim = r.sig[r.sig.length - 1] * 5, known = r.flagged.filter(x => x.label === 'known').length;
  c.append(h('h3', {}, '🔍 Moving stars in this field'),
    h('p', {}, `ARCNAVE measured ${r.nStars} bright stars in ${r.passes.length} passes (${r.passes.map(k => fmtMonth(S.eps[k].t0)).join(', ')}, ${Math.round(r.days)} days). ` +
      `Their scatter is about ${r.sig[r.sig.length - 1].toFixed(2)}″, so a star counts as moving at 2″ and at least 5x that (${Math.max(2, lim).toFixed(1)}″ here), with its patch matching well in every pass. ` +
      `${r.flagged.length ? `${r.flagged.length} star${r.flagged.length === 1 ? '' : 's'} moved clearly${r.gaiaOk ? `; ${known} of them Gaia confirms` : ''}.` : 'No star moved clearly: like most fields, everything here looks fixed.'}`),
    r.flagged.length ? h('ul', { class: 'mslist' }, ...r.flagged.slice(0, 12).map((fl, i) => { const lb = MS_LABEL[fl.label];
      return h('li', {}, h('b', {}, `${i + 1}. Moved ${fl.shift.toFixed(1)}″ toward the ${fl.dir}`), ` (${fl.z.toFixed(0)}x the scatter) at ${fmtRaDec(fl.ra, fl.dec)}. `,
        h('span', { class: 'badge ' + lb[0] }, lb[1]), fl.gaia ? h('small', {}, ` Gaia DR3 ${fl.gaia.id}, G ${fl.gaia.g.toFixed(1)}` + (fl.pred != null ? `, predicts ${fl.pred.toFixed(1)}″` : '')) : null, ' ',
        h('button', { onclick: () => msTrack(fl, i + 1) }, '▶ Track')); })) : null,
    r.gaiaOk ? h('p', { style: 'font-size:.82rem' }, r.missed.length ? `Gaia lists ${r.missed.length} star${r.missed.length === 1 ? '' : 's'} here that should have moved 2″ or more but ${r.missed.length === 1 ? 'was' : 'were'} not flagged (too faint, blended, or near a bright star).` : 'Every star Gaia expects to move 2″ or more here was found.') : h('p', { style: 'font-size:.82rem' }, 'Gaia did not answer, so the flagged stars could not be checked.'),
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'Method: the passes are lined up on the stars; each star\'s patch in a later pass is slid over pass 1 until it matches; the shift all stars share is removed. Stars only: an asteroid leaves the field within days. A flagged star is a candidate to check, never a discovery claim. On the sky: an arrow per flagged star (green = Gaia agrees, violet = unconfirmed).'),
    h('p', {}, h('button', { onclick: () => deepSearch() }, '🔭 Deep search: fainter stars, every image'), ' ', h('button', { onclick: () => { S.sel = null; S.report ? showReport() : (c.hidden = true); } }, 'Close')));
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
function msTrack(fl, num) {
  const name = fl.gaia && fl.label === 'known' ? 'Gaia DR3 ' + fl.gaia.id : `Moving star ${num}`;
  const o = fl.gaia && fl.label === 'known' ? gaiaObj(fl.gaia) : { ra0: fl.ra, dec0: fl.dec, ep: epMid(MS.res.passes[0]), pmra: 0, pmdec: 0, noCat: true };
  S.al.gotoRaDec(fl.ra, fl.dec); S.al.setFov(0.08);
  if (!o.noCat) { replayAcross(o, name, showMotionSearch); return; }
  const tr = trackAcross(o), c = $('card'); c.replaceChildren(); c.hidden = false;
  if (tr) { tr.name = name; tr.noCat = true; S.track = tr; }
  c.append(h('h3', {}, `${name}: its track`), tr ? trackCard(name, tr) : h('p', {}, 'Could not measure it in every pass here.'),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, 'No catalogue motion to compare with: an unconfirmed candidate to check in other surveys (Gaia, the Legacy Surveys), never a discovery claim.'),
    h('p', {}, h('button', { onclick: showMotionSearch }, 'Back to the moving stars')));
}
function drawMotionSearch() {
  const r = MS.res; if (!r || r.run !== S.run || !r.flagged.length) return;
  const fov = S.al.getFov()[0]; ctx.save(); ctx.font = '600 11px Inter,system-ui,sans-serif';
  r.flagged.slice(0, 12).forEach((fl, i) => {
    const a = proj(fl.ra, fl.dec), b = proj(fl.ra1, fl.dec1); if (!a || !b) return;
    const col = fl.label === 'known' ? '#4ade80' : fl.label === 'candidate' || fl.label === 'unchecked' ? '#c4b5fd' : '#fbbf24';
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = L > 0.3 ? (b[0] - a[0]) / L : 0, uy = L > 0.3 ? (b[1] - a[1]) / L : -1, len = Math.max(28, L), t = [a[0] + ux * len, a[1] + uy * len];
    ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(a[0], a[1], 9, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a[0] + ux * 9, a[1] + uy * 9); ctx.lineTo(t[0], t[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(t[0] + ux * 8, t[1] + uy * 8); ctx.lineTo(t[0] - uy * 5, t[1] + ux * 5); ctx.lineTo(t[0] + uy * 5, t[1] - ux * 5); ctx.fill();
    if (fov < 1.2) ctx.fillText(`${i + 1} · ${fl.shift.toFixed(1)}″ ${fl.dir}`, t[0] + 10, t[1] + 4);
    S.hits.push({ x: a[0], y: a[1], ms: fl, msn: i + 1 });
  });
  ctx.restore();
}

/* ---------- v0.46: frame-by-frame track (research report "Moving star tracking methods", ranks 1 to 3) ----------
   1. Every image is lined up on Gaia DR3 by itself: Gaia stars moved to that image's own date are fitted in it, and a small
      affine correction (shift, rotation, scale) is fitted with 3-sigma clipping. The pipeline's own Gaia fit is good to
      0.1-0.4″, which is about the motion we want to see.
   2. The star's position is fitted in every image: a Gaussian integrated over each pixel (SPHEREx pixels are larger than
      the star's sharp core), blank pixels (flagged, or a saturated core) left out. A saturated star is fitted on its wings
      only, and its error is doubled.
   3. The images of one pass span about two weeks, so they are repeat measurements of one position: they are averaged with
      weights, and their scatter gives an honest error. One straight line (start + motion x time) is fitted through the
      passes, after taking off Gaia's parallax when it is known. Motion, its error and a chi-square test. "Motion measured"
      only at 5 sigma; with two passes no straight-line test is possible, and the card says so. Never a discovery claim. */
const FT = { reg: new Map(), fitter: 'hybrid', epsfMode: 'image', epsfGroups: new Map() };   // v0.55: fitter 'hybrid' (default), 'gauss' or 'epsf' (fitStar); epsfMode 'image' or 'stack'
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
function solveN(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-300)) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j]; x[r] = s / M[r][r]; }
  return x.every(Number.isFinite) ? x : null;
}
// Pixel-integrated Gaussian fit (Levenberg-Marquardt) around (gx, gy) on the field grid. Returns the position, its errors
// (pixels, from the fit's curvature and the left-over scatter, so a poor PSF match gives a wider error), and whether the
// core was blank (saturated: wings only).
function psfFit(a, n, gx, gy, H = 4, search = 2) {
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return null;
  const inside = (x, y, h) => x >= h + 1 && y >= h + 1 && x <= n - h - 2 && y <= n - h - 2;
  let cx = Math.round(gx), cy = Math.round(gy); if (!inside(cx, cy, 7)) return null;
  let bx = 0, by = 0, nb = 0;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (!Number.isFinite(a[(cy + j) * n + cx + i])) { bx += i; by += j; nb++; }
  const sat = nb >= 2;   // one blank pixel can be a flagged glitch; a blank core of 2 or more is a saturated star
  let x0 = cx, y0 = cy;
  if (sat) { x0 = cx + bx / nb; y0 = cy + by / nb; H = Math.max(H, 6); }
  else { let best = -Infinity; for (let j = -search; j <= search; j++) for (let i = -search; i <= search; i++) { const v = a[(cy + j) * n + cx + i]; if (v > best) { best = v; x0 = cx + i; y0 = cy + j; } } }
  const X = Math.round(x0), Y = Math.round(y0); if (!inside(X, Y, H)) return null;
  const px = [], py = [], pv = [];
  for (let j = -H; j <= H; j++) for (let i = -H; i <= H; i++) { const v = a[(Y + j) * n + X + i]; if (Number.isFinite(v)) { px.push(i); py.push(j); pv.push(v); } }
  const m = pv.length; if (m < 12) return null;
  const srt = pv.slice().sort((p, q) => p - q), b0 = srt[Math.floor(m * 0.2)], top = srt[m - 1] - b0; if (!(top > 0)) return null;
  const ix = new Float64Array(2 * H + 1), iy = new Float64Array(2 * H + 1);
  const model = (q, out) => { const s = Math.SQRT2 * q[3];
    for (let k = -H; k <= H; k++) { ix[k + H] = 0.5 * (erf((k + 0.5 - q[0]) / s) - erf((k - 0.5 - q[0]) / s)); iy[k + H] = 0.5 * (erf((k + 0.5 - q[1]) / s) - erf((k - 0.5 - q[1]) / s)); }
    for (let t = 0; t < m; t++) out[t] = q[4] + q[2] * ix[px[t] + H] * iy[py[t] + H]; };
  const mv = new Float64Array(m), mv2 = new Float64Array(m), J = Array.from({ length: 5 }, () => new Float64Array(m));
  const rss = q => { model(q, mv2); let s = 0; for (let t = 0; t < m; t++) { const d = pv[t] - mv2[t]; s += d * d; } return s; };
  const normal = q => { model(q, mv);
    for (let k = 0; k < 5; k++) { const hh = k === 2 ? Math.max(1e-9, Math.abs(q[2]) * 1e-5) : k === 4 ? Math.max(1e-9, top * 1e-5) : 1e-5, qq = q.slice(); qq[k] += hh; model(qq, mv2); for (let t = 0; t < m; t++) J[k][t] = (mv2[t] - mv[t]) / hh; }
    const A = Array.from({ length: 5 }, () => new Array(5).fill(0)), g = new Array(5).fill(0);
    for (let k = 0; k < 5; k++) { for (let l = k; l < 5; l++) { let s = 0; for (let t = 0; t < m; t++) s += J[k][t] * J[l][t]; A[k][l] = A[l][k] = s; } let s = 0; for (let t = 0; t < m; t++) s += J[k][t] * (pv[t] - mv[t]); g[k] = s; }
    return { A, g }; };
  let p = [x0 - X, y0 - Y, top * 2 * Math.PI * 0.5 * (sat ? 6 : 1), 0.7, b0], cur = rss(p), lam = 1e-3;
  for (let it = 0; it < 40; it++) {
    const { A, g } = normal(p); let moved = false, done = false;
    for (let tries = 0; tries < 10; tries++) {
      const d = solveN(A.map((r, k) => r.map((v, l) => l === k ? v * (1 + lam) : v)), g); if (!d) { lam *= 10; continue; }
      const q = p.map((v, k) => v + d[k]); q[3] = Math.min(3, Math.max(0.25, q[3]));
      const r = rss(q); if (r < cur) { done = Math.abs(d[0]) < 1e-4 && Math.abs(d[1]) < 1e-4; p = q; cur = r; lam = Math.max(1e-9, lam / 10); moved = true; break; }
      lam *= 10;
    }
    if (!moved || done) break;
  }
  if (Math.hypot(p[0] - (x0 - X), p[1] - (y0 - Y)) > 2.5 || !(p[2] > 0)) return null;
  const { A } = normal(p), v = cur / Math.max(1, m - 5), col = k => solveN(A, [0, 1, 2, 3, 4].map(i => i === k ? 1 : 0));
  const c0 = col(0), c1 = col(1), c2 = col(2); if (!c0 || !c1 || !c2) return null;
  const ex = Math.sqrt(Math.max(0, c0[0] * v)), ey = Math.sqrt(Math.max(0, c1[1] * v)), ef = Math.sqrt(Math.max(0, c2[2] * v));
  return { x: X + p[0], y: Y + p[1], flux: p[2], sig: p[3], ex, ey, snr: ef > 0 ? p[2] / ef : 0, sat, m };
}
/* v0.55 Phase 2: effective-PSF astrometry (Anderson & King). SPHEREx's 6.2″ pixels undersample a ~2″ star, so a Gaussian's
   centre shifts a little with where the star falls inside a pixel ("pixel-phase bias"). The ePSF is measured on each image's
   own bright isolated stars (F.epsfGrid: every star sits at another sub-pixel place, so together they sample the pixel-
   integrated PSF on a 4x finer grid; checked against the official SPHEREx PSF in test/psf.official.test.js), and a star is
   fitted with it: position by least squares, flux and background solved at each trial position. Pixels that are blank
   (a saturated core, a flag) are simply left out, so a saturated star is fitted on its wings with the true wing shape. */
function epsfOf(fr) {
  if (FT.epsfMode === 'stack') return epsfStack(fr);
  if (fr.epsf !== undefined) return fr.epsf; let P = null;
  try { const st = fr.st0 || (fr.st0 = F.robustStats(fr.flat0)); P = F.epsfGrid(fr.flat0, S.field.n, st, { half: 5, os: 4, minSnr: 25 }); } catch { P = null; }
  fr.epsf = P && P.nStars >= 8 ? P : null; return fr.epsf;
}
// v0.55: one ePSF from every loaded image of the same detector and colour (to 0.1 µm): the PSF is the same in them, and
// together they give tens of times more stars than one image, so the 4x-oversampled model is far less noisy
function epsfStack(fr) {
  const lam = fr.lamReal ?? (fr.im && fr.im.lam), key = S.run + '|' + (fr.im && fr.im.det) + '|' + (lam != null ? lam.toFixed(1) : '?');
  if (FT.epsfGroups.has(key)) return FT.epsfGroups.get(key);
  const same = [...S.frames.values()].filter(f => f.flat0 && f.im && f.im.det === fr.im.det && Math.abs((f.lamReal ?? f.im.lam) - lam) < 0.05);
  let P = null;
  try { P = F.epsfGrid(same.map(f => ({ flat: f.flat0, st: f.st0 || (f.st0 = F.robustStats(f.flat0)) })), S.field.n, null, { half: 5, os: 4, minSnr: 25, maxStars: 40 }); } catch { P = null; }
  P = P && P.nStars >= 8 ? Object.assign(P, { nImages: same.length }) : null; FT.epsfGroups.set(key, P); return P;
}
function epsfFit(a, n, gx, gy, P, H = 4, search = 2) {
  if (!Number.isFinite(gx) || !Number.isFinite(gy) || !P) return null;
  const inside = (x, y, h) => x >= h + 1 && y >= h + 1 && x <= n - h - 2 && y <= n - h - 2;
  const cx = Math.round(gx), cy = Math.round(gy); if (!inside(cx, cy, 7)) return null;
  let bx = 0, by = 0, nb = 0;
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (!Number.isFinite(a[(cy + j) * n + cx + i])) { bx += i; by += j; nb++; }
  const sat = nb >= 2; let x0 = cx, y0 = cy;
  if (sat) { x0 = cx + bx / nb; y0 = cy + by / nb; H = Math.max(H, 6); }
  else { let best = -Infinity; for (let j = -search; j <= search; j++) for (let i = -search; i <= search; i++) { const v = a[(cy + j) * n + cx + i]; if (v > best) { best = v; x0 = cx + i; y0 = cy + j; } } }
  const X = Math.round(x0), Y = Math.round(y0); if (!inside(X, Y, H)) return null;
  const px = [], py = [], pv = [];
  for (let j = -H; j <= H; j++) for (let i = -H; i <= H; i++) { const v = a[(Y + j) * n + X + i]; if (Number.isFinite(v)) { px.push(X + i); py.push(Y + j); pv.push(v); } }
  const m = pv.length; if (m < 12) return null;
  // for a trial centre: the model column, then flux and background by linear least squares, and the residual sum
  const lin = (x, y) => { let s11 = 0, s1 = 0, sy1 = 0, sy = 0; const mod = new Float64Array(m);
    for (let t = 0; t < m; t++) { const v = P.at(px[t] - x, py[t] - y); mod[t] = v; s11 += v * v; s1 += v; sy1 += v * pv[t]; sy += pv[t]; }
    const D = s11 * m - s1 * s1; if (!(D > 0)) return null; const Fx = (sy1 * m - s1 * sy) / D, b = (s11 * sy - s1 * sy1) / D;
    let r = 0; for (let t = 0; t < m; t++) { const d = pv[t] - Fx * mod[t] - b; r += d * d; } return { F: Fx, b, r, mod }; };
  // coarse 0.1 px grid over ±0.7 px (±1.2 for a saturated centre, which is only roughly known), then two finer rounds
  let best = null, bxp = x0, byp = y0; const span = sat ? 1.2 : 0.7;
  for (const [st_, sp] of [[0.1, span], [0.025, 0.12], [0.005, 0.03]]) { const ax = bxp, ay = byp;
    for (let oy = -sp; oy <= sp + 1e-9; oy += st_) for (let ox = -sp; ox <= sp + 1e-9; ox += st_) { const q = lin(ax + ox, ay + oy); if (q && q.F > 0 && (!best || q.r < best.r)) { best = q; bxp = ax + ox; byp = ay + oy; } } }
  if (!best || Math.hypot(bxp - x0, byp - y0) > 2.5) return null;
  // errors: the covariance of (x, y, flux, background) from the model's derivatives, scaled by the residual variance
  const hh = 0.01, J = Array.from({ length: 4 }, () => new Float64Array(m));
  for (let t = 0; t < m; t++) { const dx = px[t] - bxp, dy = py[t] - byp;
    J[0][t] = -best.F * (P.at(dx + hh, dy) - P.at(dx - hh, dy)) / (2 * hh); J[1][t] = -best.F * (P.at(dx, dy + hh) - P.at(dx, dy - hh)) / (2 * hh); J[2][t] = best.mod[t]; J[3][t] = 1; }
  const A = Array.from({ length: 4 }, (_, k) => Array.from({ length: 4 }, (_, l) => { let s = 0; for (let t = 0; t < m; t++) s += J[k][t] * J[l][t]; return s; }));
  const v = best.r / Math.max(1, m - 4), col = k => solveN(A, [0, 1, 2, 3].map(i => i === k ? 1 : 0)), c0 = col(0), c1 = col(1), c2 = col(2); if (!c0 || !c1 || !c2) return null;
  const ex = Math.sqrt(Math.max(0, c0[0] * v)), ey = Math.sqrt(Math.max(0, c1[1] * v)), ef = Math.sqrt(Math.max(0, c2[2] * v));
  return { x: bxp, y: byp, flux: best.F, ex, ey, snr: ef > 0 ? best.F / ef : 0, sat, m, fitter: 'epsf' };
}
// The fitter for astrometry. Tested on real fields (Gaussian vs ePSF on the same images): for a SATURATED star the ePSF's true
// wing shape wins clearly (Barnard's Star 10.21 ± 2.34″/yr against Gaia's 10.39, the Gaussian 12.68; Epsilon Indi A 5.04 ±
// 1.87 against 4.71, the Gaussian 2.45 toward the wrong side), but for ordinary stars an ePSF built from the ~12 bright stars of
// one image is too noisy at 4x oversampling (Gaia registration scatter 0.42″ → 0.91″, Epsilon Indi B χ² 5.7 → 9.3). So
// 'hybrid' (the default): the Gaussian, and the ePSF where the centre is blank. 'gauss' and 'epsf' remain for tests.
// Also tested (11 Nov 2026): one ePSF stacked from every image of a detector and colour (FT.epsfMode = 'stack', 100-330
// stars instead of ~12). Better than the per-image ePSF, but the Gaussian still misses Gaia's places by least in 3 of 4
// fields (reference stars, raw miss per pass: Barnard 0.118″ against 0.154″, RW Aurigae 0.146 / 0.216, R Draconis
// 0.207 / 0.258; only Epsilon Indi 0.391 / 0.301), and on saturated stars it was worse (R Draconis, which does not move,
// came out at 9.1 ± 2.5″/yr). The official SPHEREx PSF (FWHM 6.0-6.5″ on the native pixels, test/psf.official.test.js)
// would need fitting on each image's native pixels rather than on ARCNAVE's resampled field grid: not done.
function fitStar(fr, gx, gy, H, search) {
  const n = S.field.n; if (FT.fitter === 'gauss') return psfFit(fr.flat0, n, gx, gy, H, search);
  const g = FT.fitter === 'hybrid' ? psfFit(fr.flat0, n, gx, gy, H, search) : null;
  if (g && !g.sat) return g;
  const P = epsfOf(fr); if (P) { const r = epsfFit(fr.flat0, n, gx, gy, P, H, search); if (r) return r; }
  return g || (FT.fitter === 'epsf' ? psfFit(fr.flat0, n, gx, gy, H, search) : null);
}
// Rank 1: one image lined up on Gaia DR3 by itself (on its own grid, before ARCNAVE's star alignment). Cached per image.
function gaiaReg(fr) {
  if (!GAIA.data || !fr || !fr.flat0 || !S.field) return null;
  const key = fr.im.url + '|' + GAIA.key + '|' + FT.fitter + '|' + FT.epsfMode; if (FT.reg.has(key)) return FT.reg.get(key);
  const f = S.field, n = f.n, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n }, arc = PX * 3600, mjd = fr.im.mjd, c = (n - 1) / 2, pairs = [];
  const cand = GAIA.data.stars.filter(s => s.pmra != null && s.g >= 10.5 && s.g <= 17).sort((p, q) => p.g - q.g);
  for (const s of cand) {
    if (pairs.length >= 60) break;   // plenty for a 6-number fit; more only costs time in crowded fields
    const sk = gAt(s, mjd), g = F.skyToGrid(sk[0], sk[1], grid); if (!g || g[0] < 10 || g[1] < 10 || g[0] > n - 11 || g[1] > n - 11) continue;
    // quick look first (most faint Gaia stars are not seen in one infrared image): a pixel 10 sigma up near it, no blank core
    const X = Math.round(g[0]), Y = Math.round(g[1]); let hi = -Infinity, blank = false;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = fr.flat0[(Y + j) * n + X + i]; if (!Number.isFinite(v)) blank = true; else if (v > hi) hi = v; }
    if (blank || !(hi > fr.st.med + 10 * fr.st.sigma)) continue;
    const m = fitStar(fr, g[0], g[1], 3, 1); if (!m || m.sat || !(m.snr >= 20) || Math.hypot(m.x - g[0], m.y - g[1]) > 1.5) continue;   // v0.55: the same fitter as the target
    pairs.push({ mx: m.x - c, my: m.y - c, tx: g[0] - c, ty: g[1] - c });
  }
  const affine = P => { const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    for (const q of P) { const r = [1, q.mx, q.my]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j]; bx[i] += r[i] * q.tx; by[i] += r[i] * q.ty; } }
    const a = solveN(A, bx), b = solveN(A, by); return a && b ? (x, y) => [a[0] + a[1] * x + a[2] * y, b[0] + b[1] * x + b[2] * y] : null; };
  const shift = P => { const md = v => { const s = v.slice().sort((p, q) => p - q); return s[s.length >> 1]; }, dx = md(P.map(q => q.tx - q.mx)), dy = md(P.map(q => q.ty - q.my)); return (x, y) => [x + dx, y + dy]; };
  let use = pairs, T = null, rms = 0;
  for (let it = 0; it < 5 && use.length >= 3; it++) {
    T = use.length >= 12 ? affine(use) : shift(use); if (!T) break;
    const res = use.map(q => { const t = T(q.mx, q.my); return Math.hypot(t[0] - q.tx, t[1] - q.ty); });
    rms = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / (2 * res.length));   // per axis, pixels
    const keep = use.filter((q, i) => res[i] <= Math.max(3 * rms, 0.05) * Math.SQRT2);
    if (keep.length === use.length || keep.length < 3) break; use = keep;
  }
  const ok = !!T && use.length >= 3, o0 = ok ? T(0, 0) : [0, 0];
  const out = { ok, n: use.length, tried: pairs.length, rms: rms * arc, off: Math.hypot(o0[0], o0[1]) * arc, map: ok ? (x, y) => { const t = T(x - c, y - c); return [t[0] + c, t[1] + c]; } : null };
  FT.reg.set(key, out); return out;
}
// Where Earth's parallax moves a star (arcsec per arcsec of parallax), east and north, at a date (Sun's position: Astronomical
// Almanac low-precision formula, good to 0.01°; the observer is taken at Earth's centre, SPHEREx's 700 km orbit is negligible).
function plxFactor(ra, dec, mjd) {
  const d = mjd - 51544.5, r = Math.PI / 180, g = (357.528 + 0.9856003 * d) * r, lam = (280.460 + 0.9856474 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * r;
  const R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g), eps = 23.439 * r, a = ra * r, de = dec * r;
  const X = -R * Math.cos(lam), Y = -R * Math.cos(eps) * Math.sin(lam), Z = -R * Math.sin(eps) * Math.sin(lam);   // Earth from the Sun
  return [X * Math.sin(a) - Y * Math.cos(a), X * Math.cos(a) * Math.sin(de) + Y * Math.sin(a) * Math.sin(de) - Z * Math.cos(de)];
}
// Gaia's parallax for a tracked object: the Gaia star at its place in pass 1 whose motion agrees (mas, or null)
function plxOf(o) {
  if (o.plx > 0) return o.plx;
  if (!GAIA.data || o.noCat || !S.eps.length) return null;
  const p = ctAt(o, epMid(0)), pm = Math.hypot(o.pmra || 0, o.pmdec || 0);
  let best = null, bd = 30;
  for (const s of GAIA.data.stars) { if (!(s.plx > 0)) continue; const q = gAt(s, epMid(0)), d = Math.hypot((q[0] - p[0]) * Math.cos(p[1] * Math.PI / 180), q[1] - p[1]) * 3600;
    if (d < bd && (pm < 200 || Math.abs(Math.hypot(s.pmra || 0, s.pmdec || 0) - pm) < 0.3 * pm)) { bd = d; best = s; } }
  return best ? best.plx : null;
}
const CHI99 = { 2: 9.21, 4: 13.28, 6: 16.81, 8: 20.09 };
/* v0.55 field self-calibration. The single images' errors miss a part that is the same for a whole pass (seen on
   Epsilon Indi B: the images of a pass scatter less than their errors, the passes more; most likely the undersampled
   6.2″ pixels, where a star falls at a different place inside a pixel in each pass and a Gaussian fit shifts a little).
   So each field measures it: up to 40 Gaia stars of these same images (G 9 to 17.5, with Gaia motion and parallax, not
   saturated, three or more passes) are measured exactly like a mover and compared with where Gaia puts them in each pass.
   The floor is the error added to every pass that makes their χ² equal its degrees of freedom (0 when their errors are
   already big enough). Tested: Epsilon Indi field 0.178″ (17 stars), WISE 0855 0.133″ (21), Barnard 0 (33). Cached per
   run and per number of images loaded. */
const FLOOR = { key: null, res: null, busy: false, gen: null, genKey: null };
const floorKey = () => !GAIA.data || !S.field || S.eps.length < 2 ? null : S.run + ':' + S.frames.size + ':' + FT.fitter + ':' + FT.epsfMode;
// v0.57.5: the work is a generator that hands control back after each reference star. fieldFloor() runs it to the end at
// once (as before, same result); fieldFloorWarm() runs the same steps ahead of time with pauses, so the page does not freeze
// for seconds inside a measurement. A call that finds a warm-up half done finishes that very generator: one result, no repeat.
function fieldFloor() {
  const key = floorKey(); if (key == null) return null;
  if (FLOOR.key === key) return FLOOR.res;
  if (FLOOR.gen && FLOOR.genKey === key) { const it = FLOOR.gen; let r; do { r = it.next(); } while (!r.done); return r.value; }
  if (FLOOR.gen) FLOOR.gen.return();   // a warm-up for an older run or field: dropped (its finally clears busy)
  if (FLOOR.busy) return null;
  const it = fieldFloorSteps(key); FLOOR.gen = it; FLOOR.genKey = key; let r; do { r = it.next(); } while (!r.done); return r.value;
}
async function fieldFloorWarm(live = () => true) {
  const key = floorKey(); if (key == null || FLOOR.key === key || FLOOR.gen || FLOOR.busy) return;
  const it = fieldFloorSteps(key); FLOOR.gen = it; FLOOR.genKey = key;
  for (;;) {
    if (FLOOR.gen !== it) return;   // finished meanwhile by a measurement that needed it
    const r = it.next(); if (r.done) return;
    if (!live()) { it.return(); return; }
    await yieldNow();
  }
}
function* fieldFloorSteps(key) {
  FLOOR.busy = true; let res = null;
  try {
    const f = S.field, n = f.n, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n };
    const passRes = (ff, pmE, pmN, plx) => { const P = ff.passes, t0 = P[0].mjd, r0 = ff.frames[0];
      const m = P.map(q => { const t = (q.mjd - t0) / 365.25, pf = plxFactor(r0.ra, r0.dec, q.mjd); return { q, mE: pmE * t + plx / 1000 * pf[0], mN: pmN * t + plx / 1000 * pf[1] }; });
      const wE = m.map(x => 1 / x.q.sE ** 2), wN = m.map(x => 1 / x.q.sN ** 2), sw = a => a.reduce((x, y) => x + y, 0);
      const zE = m.reduce((a, x, i) => a + wE[i] * (x.q.E - x.mE), 0) / sw(wE), zN = m.reduce((a, x, i) => a + wN[i] * (x.q.N - x.mN), 0) / sw(wN);
      return m.map(x => ({ rE: x.q.E - x.mE - zE, rN: x.q.N - x.mN - zN, sE: x.q.sE, sN: x.q.sN })); };
    const chiWith = (rs, s) => rs.reduce((a, x) => a + x.rE ** 2 / (x.sE ** 2 + s * s) + x.rN ** 2 / (x.sN ** 2 + s * s), 0);
    const refs = GAIA.data.stars.filter(s => s.pmra != null && s.plx != null && s.g > 9 && s.g < 17.5).map(s => { const q = gAt(s, epMid(0)); return { s, g: F.skyToGrid(q[0], q[1], grid) }; })
      .filter(o => o.g && o.g[0] > 15 && o.g[1] > 15 && o.g[0] < n - 16 && o.g[1] < n - 16).sort((a, b) => a.s.g - b.s.g).slice(0, 40);
    const meas = [];
    for (const o of refs) { const obj = gaiaObj(o.s), ff = ffCore((e, fr, im) => F.skyToGrid(...ctAt(obj, im.mjd), grid), { H: 3, minSnr: 5, plx: o.s.plx, raw: true });
      if (!ff || ff.fail || ff.passes.length < Math.min(3, S.eps.length) || ff.nSat) continue;
      const rs = passRes(ff, (o.s.pmra || 0) / 1000, (o.s.pmdec || 0) / 1000, o.s.plx); meas.push({ rs, k: 2 * rs.length - 2 }); yield; }
    if (meas.length >= 5) {
      const K = meas.reduce((a, x) => a + x.k, 0), tot = s => meas.reduce((a, x) => a + chiWith(x.rs, s), 0);
      let lo = 0, hi = 3; if (tot(0) <= K) hi = 0; for (let i = 0; i < 50 && hi > 0; i++) { const s = (lo + hi) / 2; if (tot(s) > K) lo = s; else hi = s; }
      // rms: the reference stars' raw miss per pass and axis (″), which does not depend on how big the errors are
      const all = meas.flatMap(x => x.rs.flatMap(r => [r.rE, r.rN]));
      res = { floor: (lo + hi) / 2, refs: meas.length, before: tot(0) / K, rms: Math.sqrt(all.reduce((a, v) => a + v * v, 0) / all.length) };
    }
  } catch (e) { console.warn('fieldFloor', e); }
  finally { FLOOR.busy = false; FLOOR.gen = null; FLOOR.genKey = null; }
  FLOOR.key = key; FLOOR.res = res; return res;
}
// the share of a frame-by-frame measurement's images in which the star is saturated (its centre blank)
const satShare = ff => ff && ff.nKept ? ff.nSat / ff.nKept : 0;
// Ranks 2 and 3: the star in every image of every pass, then one straight line through the passes.
// A position on the aligned grid (lined up on pass 1) moved back onto one image's own grid, before ARCNAVE's star alignment.
const toRaw = (fr, x, y) => { const sh = fr.shift, ap = sh && sh.ok && !sh.ref && Math.hypot(sh.dx, sh.dy) > 0.05 && Math.hypot(sh.dx, sh.dy) < 4; return [x - (ap ? sh.dx : 0), y - (ap ? sh.dy : 0)]; };
function frameFit(o, tr) {
  if (!tr) return null;
  // first guess: the pass's measured position, or the catalogue position at this image's date
  const f = S.field, grid = f && { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n };
  const guess = (e, fr, im) => { const pt = tr.pts.find(q => q.e === e); if (pt) return toRaw(fr, pt.x, pt.y); return o.noCat ? null : F.skyToGrid(...ctAt(o, im.mjd), grid); };
  const hasCat = !o.noCat && (o.pmra || o.pmdec);   // v0.55 U4: the catalogue's motion as a vector too, and which catalogue
  return ffCore(guess, { plx: plxOf(o), muCat: hasCat ? Math.hypot(o.pmra || 0, o.pmdec || 0) / 1000 : null,
    catE: hasCat ? (o.pmra || 0) / 1000 : null, catN: hasCat ? (o.pmdec || 0) / 1000 : null, cat: o.cat || null, catSmu: o.catSmu || null });
}
// The core: guess(e, frame, image) gives a first position on that image's own grid (or null to skip it). opt: plx (mas),
// muCat (″/yr), H (fit window half-size), minSnr (a frame counts only if the star is seen at this S/N in it).
function ffCore(guess, opt = {}) {
  if (!GAIA.data || !S.field) return null;
  const f = S.field, n = f.n, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n }, arc = PX * 3600, frames = [], regs = [];
  let tried = 0;
  for (let e = 0; e < S.eps.length; e++) {
    for (const im of epochImgs(e)) {
      const fr = S.frames.get(im.url); if (!fr || !fr.flat0) continue; tried++;
      const g0 = guess(e, fr, im); if (!g0) continue; const [gx, gy] = g0;
      const reg = gaiaReg(fr); if (!reg || !reg.ok) continue; regs.push(reg);
      const m = fitStar(fr, gx, gy, opt.H || 4, 2); if (!m || (opt.minSnr && !(m.snr >= opt.minSnr))) continue;   // v0.55: ePSF or Gaussian
      const c = reg.map(m.x, m.y), sky = F.gridToSky(c[0], c[1], grid), k = m.sat ? 2 : 1;
      frames.push({ e, mjd: im.mjd, lam: im.lam, ra: sky[0], dec: sky[1], sE: k * Math.hypot(m.ex * arc, reg.rms), sN: k * Math.hypot(m.ey * arc, reg.rms), sat: m.sat });
    }
  }
  const rr = regs.map(r => r.rms).sort((p, q) => p - q), regInfo = { n: regs.length, rms: rr.length ? rr[rr.length >> 1] : null, stars: regs.length ? Math.round(regs.reduce((s, r) => s + r.n, 0) / regs.length) : 0 };
  const base = { frames, passes: [], tried, reg: regInfo, run: S.run };
  if (!frames.length) return Object.assign(base, { fail: 'it could not be fitted in any image lined up on Gaia' });
  const r0 = frames[0], cd = Math.cos(r0.dec * Math.PI / 180);
  for (const q of frames) { q.E = (q.ra - r0.ra) * cd * 3600; q.N = (q.dec - r0.dec) * 3600; }
  const md = v => { const s = v.slice().sort((p, q) => p - q); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN; }, passes = [];
  for (let e = 0; e < S.eps.length; e++) {
    const fs = frames.filter(q => q.e === e); if (!fs.length) continue;
    const mE = md(fs.map(q => q.E)), mN = md(fs.map(q => q.N));
    fs.forEach(q => { q.out = Math.hypot(q.E - mE, q.N - mN) > Math.max(2, 4 * Math.hypot(q.sE, q.sN)); });   // another star, or a glitch
    const k = fs.filter(q => !q.out); if (!k.length) continue;
    const avg = (key, sk) => { let sw = 0, sv = 0; for (const q of k) { const w = 1 / (q[sk] * q[sk]); sw += w; sv += w * q[key]; } const mu = sv / sw;
      const sc = k.length >= 3 ? Math.sqrt(k.reduce((s, q) => s + (q[key] - mu) ** 2, 0) / (k.length - 1) / k.length) : 0;
      return [mu, Math.max(1 / Math.sqrt(sw), sc, 0.03)]; };
    const [E, sE] = avg('E', 'sE'), [N, sN] = avg('N', 'sN');
    passes.push({ e, mjd: k.reduce((s, q) => s + q.mjd, 0) / k.length, E, N, sE, sN, nUsed: k.length, nAll: fs.length, sat: k.some(q => q.sat),
      ra: r0.ra + E / 3600 / cd, dec: r0.dec + N / 3600 });
  }
  // v0.55: the field's own systematic floor (fieldFloor: measured on Gaia stars of these same images) is added to every
  // pass's error; opt.raw (the calibration itself) leaves the errors as measured
  const FL = opt.raw ? null : fieldFloor();
  if (FL && FL.floor > 0) passes.forEach(q => { q.sE0 = q.sE; q.sN0 = q.sN; q.sE = Math.hypot(q.sE, FL.floor); q.sN = Math.hypot(q.sN, FL.floor); });
  base.floor = FL; base.nSat = frames.filter(q => q.sat && !q.out).length; base.nKept = frames.filter(q => !q.out).length;
  base.passes = passes;
  if (passes.length < 2) return Object.assign(base, { fail: 'only one pass could be measured' });
  const plx = opt.plx || null, t0 = passes[0].mjd;
  passes.forEach(q => { q.t = (q.mjd - t0) / 365.25; const pf = plx ? plxFactor(r0.ra, r0.dec, q.mjd) : [0, 0]; q.pE = plx ? plx / 1000 * pf[0] : 0; q.pN = plx ? plx / 1000 * pf[1] : 0; });
  const line = (yk, sk, pk) => { let S0 = 0, St = 0, Stt = 0, Sy = 0, Sty = 0;
    for (const q of passes) { const w = 1 / (q[sk] * q[sk]), y = q[yk] - q[pk]; S0 += w; St += w * q.t; Stt += w * q.t * q.t; Sy += w * y; Sty += w * q.t * y; }
    const D = S0 * Stt - St * St, mu = (S0 * Sty - St * Sy) / D, b = (Stt * Sy - St * Sty) / D;
    const chi = passes.reduce((s, q) => s + ((q[yk] - q[pk] - b - mu * q.t) / q[sk]) ** 2, 0);
    return { mu, b, s: Math.sqrt(S0 / D), chi }; };
  const lE = line('E', 'sE', 'pE'), lN = line('N', 'sN', 'pN'), mu = Math.hypot(lE.mu, lN.mu);
  const smu = mu > 0 ? Math.sqrt((lE.mu * lE.s) ** 2 + (lN.mu * lN.s) ** 2) / mu : Math.max(lE.s, lN.s), sig = smu > 0 ? mu / smu : 0;
  const chi2 = lE.chi + lN.chi, dof = 2 * (passes.length - 2), crit = CHI99[dof] || dof + 3 * Math.sqrt(2 * dof);
  const label = passes.length === 2 ? 'two' : chi2 > crit ? 'bent' : sig >= 5 ? 'moved' : 'still';
  const pa = (Math.atan2(lE.mu, lN.mu) * 180 / Math.PI + 360) % 360, last = passes[passes.length - 1];
  const at = t => [r0.ra + (lE.b + lE.mu * t) / 3600 / cd, r0.dec + (lN.b + lN.mu * t) / 3600];
  const muCat = opt.muCat ?? null;   // v0.55 U4: catE, catN, cat, catSmu kept for catRow
  return Object.assign(base, { plx, label, muCat, catE: opt.catE ?? null, catN: opt.catN ?? null, cat: opt.cat || null, catSmu: opt.catSmu || null, fit: { muE: lE.mu, muN: lN.mu, sE: lE.s, sN: lN.s, mu, smu, sig, chi2, dof, crit, pa, dir: COMPASS[Math.round(pa / 45) % 8],
    uwe: dof > 0 ? Math.sqrt(chi2 / dof) : null,   // v0.55: unit weight error, as Gaia's RUWE (1 = the passes fit within their errors)
    days: last.mjd - t0, line: [at(0), at(last.t)] }, used: passes.reduce((s, q) => s + q.nUsed, 0) });
}
const FF_COL = ['#ffffff', '#5eead4', '#c4b5fd', '#fbbf24', '#67e8f9', '#f9a8d4'];
/* v0.55 fit quality, as Gaia's RUWE: the unit weight error of the straight line through the passes, with the field's
   floor in the errors. Above 1.4 (Gaia's usual cut) the passes do not sit on one line as well as their errors say: an
   unresolved binary (its centre of light wobbles), a blend, or one bad pass. And a saturated star (most images with a
   blank centre) is fitted on its wings, which can go wrong: said plainly. */
// χ² limits by degrees of freedom: 95 % and 99 % (with 2 to 6 numbers, a fixed UWE cut like Gaia's 1.4 would flag one
// steady star in seven by chance, so the limit follows the degrees of freedom)
const CHI95_1 = { 1: 3.84, 2: 5.99, 3: 7.81, 4: 9.49, 5: 11.07, 6: 12.59, 7: 14.07, 8: 15.51 }, CHI99_1 = { 1: 6.63, 2: 9.21, 3: 11.34, 4: 13.28, 5: 15.09, 6: 16.81, 7: 18.48, 8: 20.09 };
const fitLevel = (chi, dof) => !(dof > 0) ? null : chi > (CHI99_1[dof] || dof + 3 * Math.sqrt(2 * dof)) ? 'bad' : chi > (CHI95_1[dof] || dof + 2 * Math.sqrt(2 * dof)) ? 'high' : 'ok';
function fitQuality(ff) {
  if (!ff || ff.fail || !ff.fit) return null; const t = ff.fit, sat = satShare(ff), out = [], lv = fitLevel(t.chi2, t.dof);
  if (lv) out.push(lv === 'bad' ? `⚠ Fit quality: UWE ${t.uwe.toFixed(2)} (χ² ${t.chi2.toFixed(1)} for ${t.dof} degrees of freedom, past the 99 % limit): the passes scatter more than their errors allow, even with this field's own floor. An unresolved binary (its centre of light wobbles as the pair orbits), a blend with a neighbour or one bad pass can do this: treat the motion with care.`
    : lv === 'high' ? `△ Fit quality: UWE ${t.uwe.toFixed(2)} (χ² ${t.chi2.toFixed(1)} for ${t.dof} degrees of freedom, past the 95 % but within the 99 % limit): a little more scatter than the errors say; one steady star in twenty does this by chance.`
    : `✓ Fit quality: UWE ${t.uwe.toFixed(2)} (χ² ${t.chi2.toFixed(1)} for ${t.dof} degrees of freedom): the passes fit one straight line within their errors.`);
  else out.push('Fit quality: not testable with two passes (a straight line always fits two points).');
  if (sat > 0.5) out.push(`⚠ Saturated in ${ff.nSat} of ${ff.nKept} images: too bright for SPHEREx, so it was fitted on the wings of its light only. Such a fit can be off by more than its error; the catalogue's motion is the safer number.`);
  return h('p', { class: 'fitq' + (lv === 'bad' || sat > 0.5 ? ' warn' : '') }, out.join(' '));
}
function ffCard(ff) {
  if (!ff) return null;
  const note = h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'How: every image is lined up on Gaia DR3 by itself' + (ff.reg.n ? ` (${ff.reg.stars} Gaia stars per image on average, ${ff.reg.rms.toFixed(2)}″ typical scatter)` : '') +
    '; the star is fitted in each image with a pixel-integrated Gaussian, leaving out flagged or saturated pixels; the images of one pass (about two weeks) are averaged, and their scatter gives the error; one straight line is fitted through the passes. Only a motion of 5σ or more counts as measured.' +
    // v0.55: the field's own calibration
    (ff.floor ? ff.floor.floor > 0.0005 ? ` Each pass's error also includes ${ff.floor.floor.toFixed(2)}″ that this field's images share: ${ff.floor.refs} Gaia stars here, measured the same way, scatter that much more than their own errors around where Gaia's motion and parallax put them.`
      : ` ${ff.floor.refs} Gaia stars here, measured the same way, stay within their own errors around where Gaia puts them, so the errors are used as they are.` : ''));
  if (ff.fail) return h('div', { class: 'ffbox' }, h('p', { class: 'trksum' }, h('b', {}, 'Frame by frame: '), `not possible here, ${ff.fail} (${ff.tried} images tried).`), note);
  const t = ff.fit, yrs = t.days / 365.25, cat = ff.muCat != null ? ` Its catalogue motion is ${ff.muCat.toFixed(2)}″/yr.` : '';
  const head = {
    moved: `Motion measured: ${t.mu.toFixed(2)} ± ${t.smu.toFixed(2)}″ per year toward the ${t.dir} (${t.sig.toFixed(1)}σ), from ${ff.used} images in ${ff.passes.length} passes over ${Math.round(t.days)} days.${cat} The passes lie on a straight line (χ² ${t.chi2.toFixed(1)} for ${t.dof} degrees of freedom; the limit is ${t.crit.toFixed(1)}).`,
    still: `No significant motion: ${t.mu.toFixed(2)} ± ${t.smu.toFixed(2)}″ per year is under 5σ (${ff.used} images, ${ff.passes.length} passes).${cat}`,
    two: `Two-pass displacement only: ${(t.mu * yrs).toFixed(1)}″ toward the ${t.dir} in ${Math.round(t.days)} days (${t.mu.toFixed(2)} ± ${t.smu.toFixed(2)}″ per year, ${t.sig.toFixed(1)}σ, from ${ff.used} images).${cat} A straight-line check needs a third pass.`,
    bent: `The passes do not lie on a straight line (χ² ${t.chi2.toFixed(1)} for ${t.dof} degrees of freedom, above the limit of ${t.crit.toFixed(1)}): check it by eye. A blend, an artefact or a wrong match is likely. Fitted: ${t.mu.toFixed(2)} ± ${t.smu.toFixed(2)}″ per year.`
  }[ff.label];
  const plxNote = ff.plx ? `Gaia's parallax (${ff.plx.toFixed(0)} mas) was taken off before the fit: it shifts a nearby star back and forth as Earth goes round the Sun.` : 'No parallax known, so none was taken off: a star closer than about 30 light years can shift up to about 0.2″ or more between passes six months apart.';
  return h('div', { class: 'ffbox' },
    h('p', { class: 'trksum' }, h('b', {}, 'Frame by frame: '), head),
    catRow({ mu: t.mu, smu: t.smu, cat: ff.cat, catMu: ff.muCat, catSmu: ff.catSmu, diff: ff.catE != null ? Math.hypot(t.muE - ff.catE, t.muN - ff.catN) : null }),   // v0.55 U4
    fitQuality(ff),   // v0.55: the RUWE-like check and the saturation share
    flagRow(ff.passes.map(q => { const p = F.skyToGrid(q.ra, q.dec, cardGrid()); return p && { e: q.e, x: p[0], y: p[1] }; }).filter(Boolean)),   // v0.55 U6
    h('table', { class: 'fftab' }, h('thead', {}, h('tr', {}, ...['Pass', 'Images used', 'East″', 'North″', '±″'].map(s => h('th', {}, s)))),
      h('tbody', {}, ...ff.passes.map((q, i) => h('tr', {}, h('td', {}, h('i', { class: 'ffdot', style: `background:${FF_COL[i % FF_COL.length]}` }), `${q.e + 1} · ${fmtMonth(S.eps[q.e].t0)}`),
        h('td', {}, `${q.nUsed} of ${q.nAll}${q.sat ? ' · sat.' : ''}`), h('td', {}, (q.E - ff.passes[0].E).toFixed(2)), h('td', {}, (q.N - ff.passes[0].N).toFixed(2)), h('td', {}, Math.hypot(q.sE, q.sN).toFixed(2)))))),
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, (ff.passes.some(q => q.sat) ? 'sat. = the star\'s core is saturated (blank), so it was fitted on its wings and its error doubled. ' : '') + plxNote + ' On the sky: a small dot per image, a circle per pass (its error) and the fitted line.'), note);
}
function drawFrameFit() {
  const tr = S.track, ff = tr && tr.ff; if (!ff || tr.run !== S.run || ff.fail || !ff.fit) return;
  const fov = S.al.getFov()[0]; if (fov > 0.6) return;
  const a = proj(ff.passes[0].ra, ff.passes[0].dec), b = proj(ff.passes[0].ra, ff.passes[0].dec + 1 / 3600); if (!a || !b) return;
  const pxPerArc = Math.hypot(b[0] - a[0], b[1] - a[1]); ctx.save();
  const l0 = proj(...ff.fit.line[0]), l1 = proj(...ff.fit.line[1]);
  if (l0 && l1) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(l1[0], l1[1]); ctx.stroke(); ctx.setLineDash([]); }
  ff.passes.forEach((q, i) => { const col = FF_COL[i % FF_COL.length], p = proj(q.ra, q.dec); if (!p) return;
    ff.frames.filter(x => x.e === q.e && !x.out).forEach(x => { const d = proj(x.ra, x.dec); if (!d) return; ctx.fillStyle = col; ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.arc(d[0], d[1], 1.8, 0, 7); ctx.fill(); });
    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(4, Math.hypot(q.sE, q.sN) * pxPerArc), 0, 7); ctx.stroke(); });
  ctx.restore();
}

/* ---------- v0.47: deep search, every image (research report rank 4) ----------
   Fainter movers are found by detecting on a deep stack, then measuring the source in every image:
   1. Every loaded image of every pass (lined up on pass 1) is turned into a significance map ((value - median) / sigma)
      and summed: about sqrt(N) deeper than one image. Sources are detected on it down to 5 sigma (up to 500, isolated:
      no brighter source within 3 px). A slow mover barely smears over the passes (under 3 px), so it is detected too.
   2. Each source is measured frame by frame with the v0.46 method (every image lined up on Gaia by itself, a
      pixel-integrated Gaussian fit, frames averaged per pass, one straight line through the passes). A frame counts only
      when the source is seen in it at S/N 3; every pass must have it in at least 2 images.
   3. Flagged: motion at 5 sigma or more (and above the field's own spread of significances), on a straight line (chi-square
      under the 99% limit), and at least 1″ in total (smaller shifts are within colour and registration systematics).
   4. Each flagged source is checked against Gaia DR3 (known mover / Gaia says it hardly moves / a different motion /
      unconfirmed candidate). Gaia movers that should show and were not flagged are counted. Never a discovery claim. */
const DS = { res: null, busy: false };
// v0.55: this was a second "function deepStack": declared later with the same name, it silently replaced the Deep view's
// per-detector stack (v0.37), so the Deep view and its colour picture showed one all-image stack 6 times. Renamed only.
function allStack() {
  const n = S.field.n, sum = new Float32Array(n * n), cnt = new Uint16Array(n * n); let nImg = 0;
  for (let e = 0; e < S.eps.length; e++) for (const im of epochImgs(e)) {
    const fr = S.frames.get(im.url); if (!fr || !fr.flat || !fr.st || !(fr.st.sigma > 0)) continue; nImg++;
    const a = fr.flat, m = fr.st.med, s = fr.st.sigma;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === v) { sum[i] += (v - m) / s; cnt[i]++; } }
  }
  const out = new Float32Array(n * n).fill(NaN);
  for (let i = 0; i < out.length; i++) if (cnt[i] >= Math.max(2, nImg * 0.5)) out[i] = sum[i] / Math.sqrt(cnt[i]);
  return { flat: out, nImg, st: F.robustStats(out) };
}
function dsGaia(fl, days) {
  const gs = (GAIA.data && GAIA.data.stars) || []; if (!GAIA.data) return { label: 'unchecked' };
  const p0 = fl.ff.passes[0], t = fl.ff.fit; let g = null, gd = Infinity;
  // the field's NASA target first: where its catalogue puts it at this date AND the same motion (a fixed Gaia star next to
  // it is then a neighbour it passes, not its identity: seen with WISE 0855)
  const T = S.ct && CHALLENGE[S.ct]; if (T && T.pmra) { const q = ctAt(T, p0.mjd), d = Math.hypot((q[0] - p0.ra) * Math.cos(p0.dec * Math.PI / 180), q[1] - p0.dec) * 3600, pm = Math.hypot(T.pmra, T.pmdec) / 1000;
    if (d < 9 && Math.hypot(T.pmra / 1000 - t.muE, T.pmdec / 1000 - t.muN) < Math.max(3 * t.smu, 0.3 * pm, 0.5)) return { label: 'target', target: T.name, pm }; }
  for (const s of gs) { const q = gAt(s, p0.mjd), d = Math.hypot((q[0] - p0.ra) * Math.cos(p0.dec * Math.PI / 180), q[1] - p0.dec) * 3600;
    if (d < (s.g < 12 ? 15 : 6) && d < gd) { gd = d; g = s; } }
  // v0.53 (rank 7): not in Gaia (G < 18): CatWISE2020 sees cold brown dwarfs that Gaia cannot (WISE 0855)
  if (!g) { const m = cwMatch(p0.ra, p0.dec, p0.mjd, t.muE, t.muN, t.smu); return m && m.agrees ? { label: 'known', cw: m.cw, pm: m.pm } : { label: 'candidate', cwNear: m }; }
  const pE = (g.pmra || 0) / 1000, pN = (g.pmdec || 0) / 1000, pm = Math.hypot(pE, pN), diff = Math.hypot(pE - t.muE, pN - t.muN);
  // v0.56: a measurement whose error is as large as the motion it claims agrees with anything within 3σ (Pleiades field:
  // "7.4″/yr" at a G 7.3 star that Gaia gives 0.02″/yr was called a known mover). Too uncertain to agree: then Gaia, far
  // more precise, decides (fixed or a different motion).
  const loose = !(3 * t.smu < Math.max(1, Math.hypot(t.muE, t.muN)));
  const label = g.pmra == null ? 'differs' : !loose && diff < Math.max(3 * t.smu, 0.3 * pm, 0.5) ? 'known' : pm < 0.1 ? 'fixed' : loose && diff < Math.max(0.3 * pm, 0.5) ? 'known' : 'differs';
  return { label, gaia: g, pm };
}
async function deepSearch() {
  if (!S.field || S.eps.length < 2) { toast('The deep search needs at least two passes of this field.', 5000); return; }
  if (DS.busy) return; DS.busy = true; DS.stop = false;
  const f = S.field, n = f.n, run = S.run, t0 = performance.now();
  const say = (txt, i, m) => { if ((run !== S.run || DS.stop)) return; srchSay(DS, '🔭 Deep search: working', txt, m ? `Measured ${i} of ${m} sources in every image...` : null, deepSearch); if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card'); };   // v0.55 U9
  try {
    say('Lining every image up on Gaia and stacking them all...'); await sleep(30);
    try { await gaiaLoad(); } catch { /* checked below */ } const cwP = cwLoad();   // v0.56: Gaia always for THIS field (it kept the last field's stars)
    if (!GAIA.data) { say('Gaia DR3 did not answer, and every image is lined up on Gaia here. Try again in a minute.'); return; }
    await warmEpsf(() => run === S.run && !DS.stop); await fieldFloorWarm(() => run === S.run && !DS.stop); if ((run !== S.run || DS.stop)) return;   // v0.57.5: star shapes first, one image at a time
    const D = allStack(); if (!D.st || D.nImg < 4) { say('Too few images are loaded for a deep stack. Run the agents first (Images per epoch: 4 or more).'); return; }
    const pk = F.detectPeaks(D.flat, n, D.st, 5, 2000).filter(p => p.x > 12 && p.y > 12 && p.x < n - 13 && p.y < n - 13);
    const src = pk.filter((p, i) => !pk.some((q, j) => j < i && Math.hypot(q.x - p.x, q.y - p.y) < 3)).slice(0, 500);
    const all = [];
    for (let i = 0; i < src.length; i++) {
      if ((run !== S.run || DS.stop)) return;
      // v0.55: the search decides on the errors as measured (raw), with its own field calibration (kErr below); the
      // field floor is added afterwards, for what the cards show (ffShow)
      const s = src[i], ff = ffCore((e, fr) => toRaw(fr, s.x, s.y), { H: 3, minSnr: 3, raw: true });
      if (ff && !ff.fail && ff.fit) all.push({ s, ff });
      if (i % 25 === 0) { say(`A stack of ${D.nImg} images found ${src.length} sources down to 5σ. Each is now measured in every image, lined up on Gaia.`, i, src.length); await sleep(0); }
      else await breathe();
    }
    // every pass that has images must see it at least twice (or once, if the pass has one image)
    const good = all.filter(x => S.eps.every((_, e) => { const nIm = epochImgs(e).filter(im => S.frames.get(im.url)).length; if (!nIm) return true; const p = x.ff.passes.find(q => q.e === e); return p && p.nUsed >= Math.min(2, nIm); }));
    // the field calibrates its own errors: for sources that do not move, motion/error has a median of 1.18 (a 2-D normal);
    // a larger median means the errors here are too small, so the 5-sigma bar is raised by that factor
    const sigs = good.map(x => x.ff.fit.sig), mSig = msMed(sigs), kErr = Math.max(1, (mSig || 0) / 1.177), thr = 5 * kErr;
    const days = Math.max(...good.map(x => x.ff.fit.days), 0), gridA = { ra0: f.ra, dec0: f.dec, s: f.s, n }, arc = PX * 3600;
    await Promise.race([cwP, sleep(45000)]); if ((run !== S.run || DS.stop)) return;   // v0.53: CatWISE2020 for finds that Gaia does not know
    const flagged = good.filter(x => { const t = x.ff.fit; if (!(t.sig >= thr) || x.ff.label === 'bent' || t.mu * t.days / 365.25 < 1) return false;
        // the fit must stay on the source it was detected as (not slide onto a brighter neighbour): its mean position within 1.5 px
        const sk = F.gridToSky(x.s.x, x.s.y, gridA), ps = x.ff.passes, mra = ps.reduce((s, q) => s + q.ra, 0) / ps.length, mde = ps.reduce((s, q) => s + q.dec, 0) / ps.length;
        return Math.hypot((mra - sk[0]) * Math.cos(sk[1] * Math.PI / 180), mde - sk[1]) * 3600 <= 1.5 * arc; })
      .map(x => { const p = x.ff.passes[0], fl = { ff: x.ff, ra: p.ra, dec: p.dec, snr: x.s.snr, mu: x.ff.fit.mu, dir: x.ff.fit.dir }; Object.assign(fl, dsGaia(fl, days));
        // matched to a Gaia star: fit again with its parallax taken off (a nearby star swings back and forth), then label again
        const P = fl.gaia && fl.gaia.plx > 1 ? fl.gaia.plx : fl.label === 'target' && CHALLENGE[S.ct].plx > 1 ? CHALLENGE[S.ct].plx : null;
        if (P) { const ff2 = ffCore((e, fr) => toRaw(fr, x.s.x, x.s.y), { H: 3, minSnr: 3, plx: P, muCat: fl.pm, raw: true });
          if (ff2 && !ff2.fail && ff2.fit) { fl.ff = ff2; fl.mu = ff2.fit.mu; fl.dir = ff2.fit.dir; Object.assign(fl, dsGaia(fl, days)); } }
        else if (fl.pm != null) fl.ff.muCat = fl.pm;
        fl.src = x.s; return fl; })
      .sort((a, b) => b.snr - a.snr)
      .filter((fl, i, arr) => !arr.some((o, j) => j < i && Math.hypot((o.ra - fl.ra) * Math.cos(fl.dec * Math.PI / 180), o.dec - fl.dec) * 3600 < 1.5 * arc))   // one source, two peaks: keep the brighter
      .sort((a, b) => b.ff.fit.sig - a.ff.fit.sig);
    // v0.55: what the cards, the film and the charts show: the same fit with the field's floor in the errors
    for (const fl of flagged) { const o = fl.ff, fd = ffCore((e, fr) => toRaw(fr, fl.src.x, fl.src.y), { H: 3, minSnr: 3, plx: o.plx || undefined, muCat: o.muCat ?? fl.pm ?? null });
      if (fd && !fd.fail && fd.fit) { fl.ffRaw = o; fl.ff = fd; } }
    const grid = { ra0: f.ra, dec0: f.dec, s: f.s, n }, mjd0 = epMid(0);
    const missed = GAIA.data.stars.filter(s => s.pmra != null && gPm(s) * days / 365.25 >= 1.5 && !flagged.some(fl => fl.gaia === s) && (() => { const q = gAt(s, mjd0), g = F.skyToGrid(q[0], q[1], grid); return g && g[0] > 12 && g[1] > 12 && g[0] < n - 13 && g[1] < n - 13; })());
    DS.res = { run, flagged, nSrc: src.length, nGood: good.length, nImg: D.nImg, thr, kErr, mSig, days, missed, secs: (performance.now() - t0) / 1000 };
    showDS();
  } finally { DS.busy = false; srchDone(DS); }   // v0.55 U9
}
// v0.55: was a second "function showDeep", which silently replaced the Deep view's card (v0.37). Renamed only.
/* ---------- v0.55 Phase 2: mover injection test ----------
   How well does ARCNAVE find and measure moving stars in THIS field? Fake moving point sources, of known speed, direction
   and brightness, are added to the real images (every image, at the place each one has reached by that image's date, with
   that image's own ePSF, or a 2″ Gaussian where it has too few stars), on empty sky. Then:
   (a) measurement: each fake is measured frame by frame at its known place: is the motion right, and are the errors honest
       (the "pull", error-scaled miss, should scatter by about 1)?
   (b) null: the same at empty places with nothing added: how often does pure noise look like a 5σ motion?
   (c) blind: the deep search runs as it always does: which fakes does it find on its own, and does it flag anything new
       that is neither a fake nor in its own result without fakes?
   The images are put back exactly as they were afterwards. Nothing here is a real object. */
const MT = { busy: false, stop: false, res: null };
async function moverTest() {
  if (!S.field || S.eps.length < 3) { toast('The mover test needs a field with at least three passes.', 5000); return; }
  if (MT.busy || DS.busy) return; MT.busy = true; MT.stop = false;
  const run = S.run, f = S.field, n = f.n, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n }, arc = PX * 3600, t0p = performance.now();
  const say = (txt, i, m) => { if (run !== S.run || MT.stop) return; srchSay(MT, '🧪 Mover test: working', txt, m ? `${i} of ${m}` : null, moverTest); if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card'); };
  const frames = [...S.frames.values()].filter(fr => fr.flat0 && fr.flat && fr.st && fr.im); const backup = frames.map(fr => ({ fr, flat0: fr.flat0, flat: fr.flat }));
  const savedDS = DS.res; let restored = false;
  const restore = () => { if (restored) return; restored = true; for (const b of backup) { b.fr.flat0 = b.flat0; b.fr.flat = b.flat; } DS.res = savedDS; refreshSoon(); };
  try {
    say('Choosing empty places for the fakes...'); await sleep(30);
    try { await gaiaLoad(); } catch { /* registration needs Gaia; checked by the fits */ }   // v0.56: always for THIS field (it kept the last field's stars)
    const D = allStack(); if (!D.st || D.nImg < 4) { say('Too few images are loaded. Run the agents first (Images per epoch: 4 or more).'); return; }
    const pk = F.detectPeaks(D.flat, n, D.st, 4, 4000);
    let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const free = (x, y, list) => x > 26 && y > 26 && x < n - 27 && y < n - 27 && !pk.some(p => Math.hypot(p.x - x, p.y - y) < 8) && !list.some(q => Math.hypot(q.x - x, q.y - y) < 14) && D.flat[Math.round(y) * n + Math.round(x)] === D.flat[Math.round(y) * n + Math.round(x)];
    const pick = (k, list = []) => { for (let t = 0; t < 4000 && list.length < k; t++) { const x = 26 + rnd() * (n - 53), y = 26 + rnd() * (n - 53); if (free(x, y, list)) list.push({ x, y }); } return list; };
    const t0 = epMid(0), SNR = [3, 6, 12, 25], MU = [1, 2, 4, 8];
    const spots = pick(SNR.length * MU.length * 2); if (spots.length < 8) { say('This field is too crowded to place fakes on empty sky.'); return; }
    const fakes = spots.map((p, i) => { const snr = SNR[i % 4], mu = MU[Math.floor(i / 4) % 4], pa = rnd() * 2 * Math.PI, sky = F.gridToSky(p.x, p.y, grid);
      return { i, snr, mu, muE: mu * Math.sin(pa), muN: mu * Math.cos(pa), obj: { ra0: sky[0], dec0: sky[1], ep: t0, pmra: mu * Math.sin(pa) * 1000, pmdec: mu * Math.cos(pa) * 1000 } }; });
    const empty = pick(spots.length + fakes.length, spots.slice()).slice(spots.length);   // as many empty places, away from the fakes too
    // the PSF to add: the image's ePSF, or a pixel-integrated Gaussian of 2″ FWHM
    const gs = 2 / 2.355 / arc, gauss = { half: 5, at: (dx, dy) => { const s = Math.SQRT2 * gs; return 0.25 * (erf((dx + .5) / s) - erf((dx - .5) / s)) * (erf((dy + .5) / s) - erf((dy - .5) / s)); } };
    say(`Adding ${fakes.length} fake moving stars to ${frames.length} real images...`); await sleep(30);
    for (const fr of frames) { const P = epsfOf(fr) || gauss; let w2 = 0; for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) { const v = Math.max(0, P.at(i, j)); w2 += v * v; }
      let a0 = fr.flat0, a1 = fr.flat;
      for (const fk of fakes) { const q = ctAt(fk.obj, fr.im.mjd), g = F.skyToGrid(q[0], q[1], grid); if (!g) continue; const r = toRaw(fr, g[0], g[1]), flux = fk.snr * fr.st.sigma / Math.sqrt(w2 || 0.1);
        a0 = F.injectPSF(a0, n, P, r[0], r[1], flux); a1 = F.injectPSF(a1, n, P, g[0], g[1], flux); }
      fr.flat0 = a0; fr.flat = a1; }
    if (run !== S.run || MT.stop) return;
    // (a) measurement at the known place, (b) the same at empty places
    const meas = [], nul = [];
    for (let k = 0; k < fakes.length; k++) { const fk = fakes[k];
      if (k % 4 === 0) { say('Measuring every fake frame by frame, at its known place...', k, fakes.length); await sleep(0); if (run !== S.run || MT.stop) return; }
      else await breathe();
      const ff = ffCore((e, fr, im) => { const q = ctAt(fk.obj, im.mjd), g = F.skyToGrid(q[0], q[1], grid); return g && toRaw(fr, g[0], g[1]); }, { H: 3, minSnr: 3 }), t = ff && !ff.fail && ff.fit;
      const pE = t ? (t.muE - fk.muE) / Math.max(t.sE, 1e-3) : null, pN = t ? (t.muN - fk.muN) / Math.max(t.sN, 1e-3) : null;
      meas.push({ fk, ok: !!t && t.sig >= 5 && Math.abs(pE) < 3 && Math.abs(pN) < 3, sig: t ? t.sig : 0, mu: t ? t.mu : null, smu: t ? t.smu : null, pE, pN }); }
    for (let k = 0; k < empty.length; k++) { const p = empty[k], sky = F.gridToSky(p.x, p.y, grid), o = { ra0: sky[0], dec0: sky[1], ep: t0, pmra: 0, pmdec: 0 };
      const ff = ffCore((e, fr, im) => { const g = F.skyToGrid(sky[0], sky[1], grid); return g && toRaw(fr, g[0], g[1]); }, { H: 3, minSnr: 3 }), t = ff && !ff.fail && ff.fit;
      // counts as a false motion only if, like a real source, it stays on this place in every pass (an empty-sky fit that
      // wanders onto a different noise bump in each image is not something the deep search would ever measure: it only
      // measures sources its stack detects)
      const stays = t && ff.passes.every(q => q.nUsed >= 2 && Math.hypot((q.ra - sky[0]) * Math.cos(sky[1] * Math.PI / 180), q.dec - sky[1]) * 3600 <= 1.5 * arc);
      nul.push({ fit: !!t, sig: t ? t.sig : 0, stays: !!stays, wander: !!t && !stays && t.sig >= 5 }); }
    // (c) the deep search, blind, exactly as the button runs it
    say('Running the deep search on the images with the fakes, as it always runs (it does not know where they are)...'); await sleep(30);
    DS.res = null; await deepSearch(); if (run !== S.run || MT.stop) return;
    const found = DS.res ? DS.res.flagged : [], used = new Set();
    for (const m of meas) { const fk = m.fk, hit = found.find(fl => { const q0 = fl.ff.passes[0], q = ctAt(fk.obj, q0.mjd), d = Math.hypot((q0.ra - q[0]) * Math.cos(q[1] * Math.PI / 180), q0.dec - q[1]) * 3600;
        return d < 2 * arc && Math.hypot(fl.ff.fit.muE - fk.muE, fl.ff.fit.muN - fk.muN) < Math.max(3 * fl.ff.fit.smu, 0.3 * fk.mu, 0.5); });
      m.blind = !!hit; if (hit) used.add(hit); }
    const before = savedDS && savedDS.run === run ? savedDS.flagged : null;
    const extra = found.filter(fl => !used.has(fl) && !(before || []).some(o => Math.hypot((o.ra - fl.ra) * Math.cos(fl.dec * Math.PI / 180), o.dec - fl.dec) * 3600 < 2 * arc));
    restore();
    MT.res = { run, n: fakes.length, meas, nul, extra: extra.length, extraList: extra.map(fl => ({ ra: fl.ra, dec: fl.dec, mu: fl.ff.fit.mu, label: fl.label })), hadBefore: !!before,
      nImg: frames.length, secs: (performance.now() - t0p) / 1000, SNR, MU, days: epMid(S.eps.length - 1) - t0 };
    showMoverTest();
  } finally { restore(); MT.busy = false; srchDone(MT); }
}
function showMoverTest() {
  const r = MT.res; if (!r || r.run !== S.run) return;
  S.sel = { mtest: true }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const cell = (list, key) => { const k = list.filter(m => m[key]).length; return `${k}/${list.length}`; };
  const tab = (key, title) => h('table', { class: 'fftab mttab' }, h('caption', {}, title),
    h('thead', {}, h('tr', {}, h('th', {}, 'S/N per image ↓ · speed →'), ...r.MU.map(u => h('th', {}, `${u}″/yr`)))),
    h('tbody', {}, ...r.SNR.map(s => h('tr', {}, h('td', {}, String(s)), ...r.MU.map(u => { const l = r.meas.filter(m => m.fk.snr === s && m.fk.mu === u); return h('td', { class: l.length && l.every(m => m[key]) ? 'mtok' : l.some(m => m[key]) ? 'mtpart' : 'mtno' }, l.length ? cell(l, key) : '–'); })))));
  const pulls = r.meas.filter(m => m.pE != null && m.fk.snr >= 6).flatMap(m => [m.pE, m.pN]), prms = pulls.length ? Math.sqrt(pulls.reduce((a, v) => a + v * v, 0) / pulls.length) : null;
  const fa = r.nul.filter(x => x.stays && x.sig >= 5).length, wan = r.nul.filter(x => x.wander).length;
  c.append(h('h3', {}, '🧪 Mover test: fake movers in the real images'),
    h('p', {}, `${r.n} fake moving stars were added to the ${r.nImg} real images of this field (S/N per image ${r.SNR.join(', ')}; speeds ${r.MU.join(', ')}″ per year, ${Math.round(r.days)} days from the first pass to the last), measured, searched for, and taken out again (${Math.round(r.secs)} s). None of them is real.`),
    tab('ok', 'Measured at its known place: motion found at 5σ or more, and right within 3σ'),
    h('p', { class: 'fitq' + (prms != null && (prms > 1.5 || prms < 0.6) ? ' warn' : '') }, h('b', {}, 'Are the errors honest? '), prms == null ? 'Too few fakes measured to tell.' :
      `The misses of the fakes of S/N 6 and up, divided by their own errors ("pulls"), scatter by ${prms.toFixed(2)} (1 = the errors are just right; above 1.5 they are too small, under 0.6 too large).`),
    h('p', { class: fa ? 'fitq warn' : '' }, h('b', {}, 'Noise alone: '), !r.nul.length ? 'no empty place was left for this check (a crowded field).' :
      `at ${r.nul.length} empty places with nothing added, ${fa} showed a "motion" of 5σ or more while staying on the place in every pass.` +
      (wan ? ` ${wan} more fits wandered onto a different noise bump in each image (which also reads as a "motion"): that is why ARCNAVE measures only sources its stacked image detects, never an empty spot.` : '')),
    tab('blind', 'Found by the deep search on its own (blind)'),
    h('p', { class: r.extra ? 'fitq warn' : '' }, h('b', {}, 'Side effects: '), r.hadBefore ? (r.extra ? `${r.extra} other source${r.extra === 1 ? ' was' : 's were'} flagged that the deep search did not flag without the fakes (a fake next to a star can pull it along).` : 'nothing else was flagged that the deep search did not already flag without the fakes.')
      : `${r.extra} flagged source${r.extra === 1 ? '' : 's'} that are not fakes (the deep search had not been run on this field before, so these may also be what it finds anyway).`),
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'How: each fake is added to every image at the place its motion has taken it by that image\'s date, with that image\'s own effective PSF (or a 2″ Gaussian where the image has too few bright stars), on sky at least 8 pixels from any source; S/N per image is for an optimal fit. The images are restored exactly afterwards. A green cell: every fake of that kind passed; amber: some; grey: none.'),
    h('p', {}, h('button', { type: 'button', class: 'hbtn', onclick: () => moverTest() }, 'Run again'), ' ', h('button', { type: 'button', onclick: () => { S.sel = null; S.report ? showReport() : (c.hidden = true); } }, 'Close')));
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
if ($('mtb')) $('mtb').onclick = () => moverTest();
function showDS() {
  const r = DS.res; if (!r || r.run !== S.run) return;
  S.sel = { deep: true }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const known = r.flagged.filter(x => x.label === 'known').length;
  c.append(h('h3', {}, '🔭 Deep search: every image'),
    h('p', {}, `A stack of all ${r.nImg} images found ${r.nSrc} sources down to 5σ, fainter than one image shows. ${r.nGood} of them were seen in every pass, and each was measured in every image (each image lined up on Gaia by itself). ` +
      `A source counts as moving at ${r.thr.toFixed(1)}σ or more` + (r.kErr > 1.001 ? ` (5σ, raised ${r.kErr.toFixed(2)}x because the fixed sources here scatter that much more than their errors say)` : '') + `, on a straight line, and at least 1″ in total. ` +
      (r.flagged.length ? `${r.flagged.length} source${r.flagged.length === 1 ? '' : 's'} moved${known ? `; ${known} of them Gaia confirms` : ''}.` : 'None moved: everything measured here looks fixed.')),
    r.flagged.length ? h('ul', { class: 'mslist' }, ...r.flagged.slice(0, 15).map((fl, i) => { const lb = fl.label === 'target' ? ['ok', `✓ Known mover: ${fl.target}, its catalogue motion (${fl.pm.toFixed(2)}″/yr) agrees`] : msLabel(fl), t = fl.ff.fit;
      return h('li', {}, h('b', {}, `D${i + 1}. ${t.mu.toFixed(2)} ± ${t.smu.toFixed(2)}″ per year toward the ${t.dir}`), ` (${t.sig.toFixed(1)}σ, ${fl.ff.used} images, ${fl.ff.passes.length} passes${fl.ff.label === 'two' ? ', two passes only' : ''}) at ${fmtRaDec(fl.ra, fl.dec)}. `,
        h('span', { class: 'badge ' + lb[0] }, lb[1]), fl.gaia ? h('small', {}, ` Gaia DR3 ${fl.gaia.id}, G ${fl.gaia.g.toFixed(1)}, ${fl.pm != null ? fl.pm.toFixed(2) + '″/yr' : 'no motion listed'}`) : null, ' ',
        h('button', { onclick: () => dsTrack(fl, i + 1) }, '▶ Track')); })) : null,
    h('p', { style: 'font-size:.82rem' }, r.missed.length ? `Gaia lists ${r.missed.length} star${r.missed.length === 1 ? '' : 's'} here that should have moved 1.5″ or more but ${r.missed.length === 1 ? 'was' : 'were'} not flagged. Many Gaia stars are too faint at this infrared colour, blended, or next to a bright star.` +
      (r.missed.some(s => s.g < 8) ? ` Very bright (saturated) stars are better measured by 🔍 Find moving stars.` : '') : 'Every star Gaia expects to move 1.5″ or more here was found.'),
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, `Method (${r.secs.toFixed(1)} s): all images are stacked to find faint sources; each source is fitted in every image, the images of a pass are averaged, and one straight line is fitted through the passes. Brown dwarfs are brightest at 3.8 to 5 µm: pick that colour before running the agents to search for them. A flagged source is a candidate to check, never a discovery claim. On the sky: a square per flagged source with its motion.`),
    h('p', {}, h('button', { onclick: () => { S.sel = null; S.report ? showReport() : (c.hidden = true); } }, 'Close')));
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
function dsTrack(fl, num) {
  const name = fl.label === 'target' ? fl.target : fl.gaia && fl.label === 'known' ? 'Gaia DR3 ' + fl.gaia.id : `Deep source D${num}`;
  S.al.gotoRaDec(fl.ra, fl.dec); S.al.setFov(0.03);
  S.track = { name, pts: [], ff: fl.ff, run: S.run };
  const c = $('card'); c.replaceChildren(); c.hidden = false;
  c.append(h('h3', {}, `${name}: frame by frame`), ffCard(fl.ff),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, fl.label === 'known' ? 'Gaia DR3 lists this star with a motion that agrees.' : fl.label === 'target' ? `This is ${fl.target}, the field's NASA target: its catalogue motion agrees. It is too faint at visible light for Gaia's list here.` : 'Not confirmed by a catalogue: a candidate to check in other surveys (Gaia, CatWISE, the Legacy Surveys), never a discovery claim.'),
    h('p', {}, h('button', { onclick: showDeep }, 'Back to the deep search')));
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
function drawDeep() {
  const r = DS.res; if (!r || r.run !== S.run || !r.flagged.length) return;
  const fov = S.al.getFov()[0]; ctx.save(); ctx.font = '600 11px Inter,system-ui,sans-serif';
  r.flagged.slice(0, 15).forEach((fl, i) => {
    const a = proj(fl.ra, fl.dec), t = fl.ff.fit; if (!a) return;
    const col = fl.label === 'known' || fl.label === 'target' ? '#4ade80' : fl.label === 'candidate' || fl.label === 'unchecked' ? '#c4b5fd' : '#fbbf24';
    const b = proj(fl.ra + t.muE / 3600 / Math.cos(fl.dec * Math.PI / 180), fl.dec + t.muN / 3600); if (!b) return;   // where one year of motion points on screen
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, len = 26, tip = [a[0] + ux * len, a[1] + uy * len];
    ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 2; ctx.strokeRect(a[0] - 7, a[1] - 7, 14, 14);
    ctx.beginPath(); ctx.moveTo(a[0] + ux * 8, a[1] + uy * 8); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tip[0] + ux * 7, tip[1] + uy * 7); ctx.lineTo(tip[0] - uy * 4.5, tip[1] + ux * 4.5); ctx.lineTo(tip[0] + uy * 4.5, tip[1] - ux * 4.5); ctx.fill();
    if (fov < 1.2) ctx.fillText(`D${i + 1} · ${t.mu.toFixed(1)}″/yr`, tip[0] + 9, tip[1] + 4);
    S.hits.push({ x: a[0], y: a[1], ds: fl, dsn: i + 1 });
  });
  ctx.restore();
}

/* ---------- v0.48: difference-image search (research report rank 5) ----------
   For movers smaller than about one SPHEREx pixel: a slow star leaves a light-and-dark pair (a "dipole") when two images
   of the same colour are subtracted.
   1. Pairs: every colour-matched image of pass 1 against the image of the same colour (the same slot: same detector, the
      closest wavelength) in each later pass. Both are already lined up on the stars.
   2. Matching (Bramich 2008, the simplest form): the later image is modelled as a 3x3 kernel applied to the pass-1 image
      plus a background, fitted by least squares over the whole field. The kernel takes up a free brightness scale, a
      slightly different blur and any left-over sub-pixel shift.
   3. Each source (found on the deep stack of all images, as in the deep search) is fitted in the difference with the
      pass-1 image: difference = -(shift x slope of the image) + (brightness change x image) + background. Linear, so
      fast, and it tells motion apart from a star that only changed brightness (unequal lobes = a variable star). This is
      the "use the original images in the dipole fit" advice (Rubin DMTN-007), in its first-order form: good below about
      one pixel of motion; faster stars are left to the other searches.
   4. Per later pass: the shift every source shares is taken off; the slots are averaged. One straight line through the
      origin (pass 1) gives the motion; its errors are calibrated on field sources of similar brightness (a fixed
      source has motion/error with a median of 1.18). Flagged: 5 sigma after that calibration, the motion larger than the
      brightness change, on a straight line when there are 3 or more passes, at least 1″ in total, no blank pixels and no
      much brighter star within 5 px. Checked against Gaia DR3 or the NASA target; never a discovery claim. */
const DF = { res: null, busy: false };
function dfKernel(A, B, n) {
  const st = F.robustStats(A), thr = st.med + 3 * st.sigma, M = Array.from({ length: 10 }, () => new Array(10).fill(0)), v = new Array(10).fill(0), r = new Array(10);
  let used = 0;
  for (let y = 2; y < n - 2; y++) for (let x = 2; x < n - 2; x++) {
    const i = y * n + x, a = A[i], b = B[i]; if (!(a === a) || !(b === b)) continue;
    if (!(a > thr) && (i % 7)) continue;   // every star pixel, and one background pixel in seven
    if (a > st.med + 200 * st.sigma) continue;   // not the wings of a saturated star: they would steer the whole fit
    let k = 0, bad = false; for (let dy = -1; dy <= 1 && !bad; dy++) for (let dx = -1; dx <= 1; dx++) { const w = A[i + dy * n + dx]; if (!(w === w)) { bad = true; break; } r[k++] = w; }
    if (bad) continue; r[9] = 1; used++;
    for (let p = 0; p < 10; p++) { v[p] += r[p] * b; for (let q = p; q < 10; q++) M[p][q] += r[p] * r[q]; }
  }
  for (let p = 0; p < 10; p++) for (let q = 0; q < p; q++) M[p][q] = M[q][p];
  const s = used > 200 ? solveN(M, v) : null; return s ? { K: s.slice(0, 9), b: s[9], used } : null;
}
function dfPair(A, B, n) {
  const k = dfKernel(A, B, n); if (!k) return null;
  const Mo = new Float32Array(n * n).fill(NaN), D = new Float32Array(n * n).fill(NaN);
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = y * n + x; let s = 0, kk = 0, bad = false;
    for (let dy = -1; dy <= 1 && !bad; dy++) for (let dx = -1; dx <= 1; dx++) { const w = A[i + dy * n + dx]; if (!(w === w)) { bad = true; break; } s += k.K[kk++] * w; }
    if (bad) continue; Mo[i] = s + k.b; const b = B[i]; if (b === b) D[i] = b - Mo[i];
  }
  const st = F.robustStats(D), stM = F.robustStats(Mo); return st && stM ? { Mo, D, sig: st.sigma, med: st.med, bgM: stM.med, K: k.K } : null;
}
// The dipole fit at (x, y), with the pre-image (Rubin DMTN-007): the star's position, flux and width come from a
// pixel-integrated Gaussian fit to the matched pass-1 image; the difference is then fitted as
//   D = F * [ (1 + c) * PSF(at the position + shift) - PSF(at the position) ] + background
// for the shift (px), the brightness change c (fraction) and the background. The pixel-integrated shape handles stars
// narrower than a pixel, where slopes taken from neighbouring pixels are poor. Errors come from the fit's curvature and
// its real left-over scatter. Null when the window has blank pixels or the star cannot be fitted.
function dfFit(P, n, x, y, H = 3) {
  const m0 = psfFit(P.Mo, n, x, y, H, 1); if (!m0 || m0.sat || !(m0.snr >= 3)) return null;
  const X = Math.round(m0.x), Y = Math.round(m0.y); if (X < H + 2 || Y < H + 2 || X > n - H - 3 || Y > n - H - 3) return null;
  const ii = [], jj = [], dv = [];
  for (let j = -H; j <= H; j++) for (let i = -H; i <= H; i++) { const d = P.D[(Y + j) * n + X + i]; if (!(d === d)) return null; ii.push(i + H); jj.push(j + H); dv.push(d); }
  const m = dv.length, sg = Math.SQRT2 * m0.sig, cx = m0.x - X, cy = m0.y - Y, Fx = m0.flux, W = 2 * H + 1;
  const pix = (k, c0) => 0.5 * (erf((k + 0.5 - c0) / sg) - erf((k - 0.5 - c0) / sg));
  const bx = Float64Array.from({ length: W }, (_, k) => pix(k - H, cx)), by = Float64Array.from({ length: W }, (_, k) => pix(k - H, cy)), sx = new Float64Array(W), sy = new Float64Array(W);
  const model = (q, out) => { for (let k = 0; k < W; k++) { sx[k] = pix(k - H, cx + q[0]); sy[k] = pix(k - H, cy + q[1]); }
    for (let t = 0; t < m; t++) out[t] = Fx * ((1 + q[2]) * sx[ii[t]] * sy[jj[t]] - bx[ii[t]] * by[jj[t]]) + q[3]; };
  const mv = new Float64Array(m), mv2 = new Float64Array(m), J = Array.from({ length: 4 }, () => new Float64Array(m)), hh = [1e-5, 1e-5, 1e-6, Math.max(1e-12, Math.abs(Fx) * 1e-7)];
  const rss = q => { model(q, mv2); let s = 0; for (let t = 0; t < m; t++) { const d = dv[t] - mv2[t]; s += d * d; } return s; };
  const normal = q => { model(q, mv); for (let k = 0; k < 4; k++) { const qq = q.slice(); qq[k] += hh[k]; model(qq, mv2); for (let t = 0; t < m; t++) J[k][t] = (mv2[t] - mv[t]) / hh[k]; }
    const A = Array.from({ length: 4 }, () => new Array(4).fill(0)), g = new Array(4).fill(0);
    for (let k = 0; k < 4; k++) { for (let l = k; l < 4; l++) { let s = 0; for (let t = 0; t < m; t++) s += J[k][t] * J[l][t]; A[k][l] = A[l][k] = s; } let s = 0; for (let t = 0; t < m; t++) s += J[k][t] * (dv[t] - mv[t]); g[k] = s; }
    return { A, g }; };
  let p = [0, 0, 0, 0], cur = rss(p), lam = 1e-3;
  for (let it = 0; it < 40; it++) {
    const { A, g } = normal(p); let moved = false, done = false;
    for (let tries = 0; tries < 10; tries++) {
      const d = solveN(A.map((r, k) => r.map((v, l) => l === k ? v * (1 + lam) : v)), g); if (!d) { lam *= 10; continue; }
      const q = p.map((v, k) => v + d[k]); q[0] = Math.max(-3, Math.min(3, q[0])); q[1] = Math.max(-3, Math.min(3, q[1]));
      const r = rss(q); if (r < cur) { done = Math.abs(d[0]) < 1e-4 && Math.abs(d[1]) < 1e-4; p = q; cur = r; lam = Math.max(1e-9, lam / 10); moved = true; break; }
      lam *= 10;
    }
    if (!moved || done) break;
  }
  if (Math.abs(p[0]) >= 2.9 || Math.abs(p[1]) >= 2.9) return null;   // ran to the edge: no real fit
  const { A } = normal(p), v = cur / Math.max(1, m - 4), col = k => solveN(A, [0, 1, 2, 3].map(i => i === k ? 1 : 0)), c0 = col(0), c1 = col(1), c2 = col(2); if (!c0 || !c1 || !c2) return null;
  return { dx: p[0], dy: p[1], c: p[2], ex: Math.sqrt(Math.max(0, c0[0] * v)), ey: Math.sqrt(Math.max(0, c1[1] * v)), ec: Math.sqrt(Math.max(0, c2[2] * v)) };
}
async function diffSearch() {
  if (!S.field || S.eps.length < 2) { toast('The difference search needs at least two passes of this field.', 5000); return; }
  if (DF.busy) return; DF.busy = true; DF.stop = false;
  const f = S.field, n = f.n, run = S.run, t0 = performance.now(), arc = PX * 3600, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n };
  const say = (txt, i, m) => { if ((run !== S.run || DF.stop)) return; srchSay(DF, '◐ Difference search: working', txt, m ? `${i} of ${m} done...` : null, diffSearch); if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card'); };   // v0.55 U9
  try {
    say('Subtracting images of the same colour, pass by pass...'); await sleep(30);
    try { await gaiaLoad(); } catch { /* labels say unchecked */ } const cwP = cwLoad();   // v0.56: Gaia always for THIS field (it kept the last field's stars)
    await warmEpsf(() => run === S.run && !DF.stop); await fieldFloorWarm(() => run === S.run && !DF.stop); if ((run !== S.run || DF.stop)) return;   // v0.57.5: star shapes first, one image at a time
    const slots = S.slots.length ? S.slots : [S.eps.map((_, i) => chosen(i))];
    // pairs: slot k, pass 1 against pass e
    const pairs = [];
    for (let k = 0; k < slots.length; k++) for (let e = 1; e < S.eps.length; e++) {
      const a = slots[k][0] && S.frames.get(slots[k][0].url), b = slots[k][e] && S.frames.get(slots[k][e].url); if (!a || !b || !a.flat || !b.flat) continue;
      const P = dfPair(a.flat, b.flat, n); if (P) pairs.push({ k, e, P, lamA: lamOf(a.im), lamB: lamOf(b.im) });
      say('Subtracting images of the same colour, pass by pass...', pairs.length, slots.length * (S.eps.length - 1)); await sleep(0);
      if ((run !== S.run || DF.stop)) return;
    }
    const passes = [...new Set(pairs.map(p => p.e))].sort((p, q) => p - q);
    if (!passes.length) { say('No pass has an image of the same colour as pass 1 here, so nothing can be subtracted.'); return; }
    const D = allStack(); if (!D.st) { say('The images are not loaded yet. Run the agents first.'); return; }
    const pk = F.detectPeaks(D.flat, n, D.st, 5, 2000).filter(p => p.x > 12 && p.y > 12 && p.x < n - 13 && p.y < n - 13);
    const src = pk.filter((p, i) => !pk.some((q, j) => j < i && Math.hypot(q.x - p.x, q.y - p.y) < 3)).slice(0, 500)
      .filter(p => !pk.some(q => q.flux > 10 * p.flux && Math.hypot(q.x - p.x, q.y - p.y) < 5));   // not in a much brighter star's glow
    // every source in every pair
    const meas = src.map(s => ({ s, fits: pairs.map(pr => dfFit(pr.P, n, s.x, s.y)) }));
    // the shift the sources around it share in each pair (left-over alignment, which can vary across the field: rotation,
    // scale), from the 15 nearest sources at S/N 20 or more, taken off. The field-wide value is kept for the report.
    const refs = meas.filter(m => m.s.snr >= 20);
    pairs.forEach((pr, j) => { const b = refs.filter(m => m.fits[j]); pr.mx = msMed(b.map(m => m.fits[j].dx)) || 0; pr.my = msMed(b.map(m => m.fits[j].dy)) || 0; });
    for (const m of meas) { m.near = refs.filter(r => r !== m).map(r => ({ r, d: Math.hypot(r.s.x - m.s.x, r.s.y - m.s.y) })).sort((a, b) => a.d - b.d).slice(0, 25).map(x => x.r);
      m.loc = pairs.map((pr, j) => { const b = m.near.filter(r => r.fits[j]).slice(0, 15); return b.length >= 5 ? [msMed(b.map(r => r.fits[j].dx)), msMed(b.map(r => r.fits[j].dy))] : [pr.mx, pr.my]; }); }
    const mjd0 = epMid(0), out = [];
    for (const m of meas) {
      const per = [];
      for (const e of passes) {
        const fs = pairs.map((pr, j) => pr.e === e && m.fits[j] ? { d: m.fits[j], pr, loc: m.loc[j] } : null).filter(Boolean); if (!fs.length) { per.length = 0; break; }
        const avg = (key, ek, off) => { let sw = 0, sv = 0; for (const q of fs) { const w = 1 / (q.d[ek] ** 2 || 1e-9); sw += w; sv += w * (q.d[key] - off(q)); } return [sv / sw, 1 / Math.sqrt(sw)]; };
        const [dx, ex] = avg('dx', 'ex', q => q.loc[0]), [dy, ey] = avg('dy', 'ey', q => q.loc[1]), [cc, ec] = avg('c', 'ec', () => 0);
        per.push({ e, t: (epMid(e) - mjd0) / 365.25, E: dx * arc, N: -dy * arc, sE: ex * arc, sN: ey * arc, c: cc, ec, n: fs.length });
      }
      if (per.length !== passes.length) continue;
      // straight line through the origin (pass 1): motion per year in each direction
      const lf = (yk, sk) => { let a = 0, b = 0; for (const q of per) { const w = 1 / (q[sk] * q[sk]); a += w * q.t * q.t; b += w * q.t * q[yk]; } const mu = b / a; return { mu, s: 1 / Math.sqrt(a), chi: per.reduce((s, q) => s + ((q[yk] - mu * q.t) / q[sk]) ** 2, 0) }; };
      const lE = lf('E', 'sE'), lN = lf('N', 'sN'), mu = Math.hypot(lE.mu, lN.mu), smu = mu > 0 ? Math.sqrt((lE.mu * lE.s) ** 2 + (lN.mu * lN.s) ** 2) / mu : Math.max(lE.s, lN.s);
      const cW = per.reduce((s, q) => s + q.c / (q.ec * q.ec), 0) / per.reduce((s, q) => s + 1 / (q.ec * q.ec), 0), cE = 1 / Math.sqrt(per.reduce((s, q) => s + 1 / (q.ec * q.ec), 0));
      const dof = 2 * (per.length - 1), chi2 = lE.chi + lN.chi, pa = (Math.atan2(lE.mu, lN.mu) * 180 / Math.PI + 360) % 360, sk = F.gridToSky(m.s.x, m.s.y, grid);
      out.push({ s: m.s, per, mu, smu, sig: smu > 0 ? mu / smu : 0, muE: lE.mu, muN: lN.mu, chi2, dof, c: cW, zc: cE > 0 ? Math.abs(cW) / cE : 0, dir: COMPASS[Math.round(pa / 45) % 8], ra: sk[0], dec: sk[1], days: epMid(passes[passes.length - 1]) - mjd0 });
    }
    // calibrate the errors on sources of similar brightness (S/N bins of the deep stack)
    const bins = [5, 10, 20, 50, 200, Infinity], kOf = {}, gMed = msMed(out.map(o => o.sig)), kAll = Math.max(1, (gMed || 0) / 1.177);
    for (let b = 0; b < bins.length - 1; b++) { const inb = out.filter(o => o.s.snr >= bins[b] && o.s.snr < bins[b + 1]); kOf[b] = inb.length >= 15 ? Math.max(1, msMed(inb.map(o => o.sig)) / 1.177) : kAll; }
    out.forEach(o => { const b = bins.findIndex((v, i) => o.s.snr >= v && o.s.snr < bins[i + 1]); o.k = kOf[b] ?? kAll; o.thr = 5 * o.k; });
    await Promise.race([cwP, sleep(45000)]); if ((run !== S.run || DF.stop)) return;   // v0.53: CatWISE2020 for finds that Gaia does not know
    const pre = out.filter(o => o.sig >= o.thr && o.sig > o.zc && Math.abs(o.c) < 0.3 && o.mu * o.days / 365.25 >= 1 && (o.dof === 0 || o.chi2 / (o.k * o.k) <= (CHI99[o.dof] || o.dof + 3 * Math.sqrt(2 * o.dof))))
      .map(o => { const fl = Object.assign(o, { ff: { passes: [{ ra: o.ra, dec: o.dec, mjd: mjd0 }], fit: { muE: o.muE, muN: o.muN, smu: o.smu * o.k } } }); Object.assign(fl, dsGaia(fl, o.days)); return fl; })
      .sort((a, b) => b.sig / b.k - a.sig / a.k).slice(0, 20);
    // second opinion: the frame-by-frame measurement (v0.46: every image lined up on Gaia by itself, all colours) must see
    // the same motion, at 3 sigma, within 60° and within 3 sigma in size. Otherwise: a likely artefact of the subtraction.
    const flagged = [], artefacts = [];
    for (let i = 0; i < pre.length; i++) {
      const fl = pre[i], T = S.ct && CHALLENGE[S.ct], P = fl.gaia && fl.gaia.plx > 1 ? fl.gaia.plx : fl.label === 'target' && T && T.plx > 1 ? T.plx : null;
      say('Checking each moving source with a second, independent measurement...', i + 1, pre.length); await sleep(0); if ((run !== S.run || DF.stop)) return;
      fl.fff = ffCore((e, fr) => toRaw(fr, fl.s.x, fl.s.y), { H: 3, minSnr: 2, plx: P, muCat: fl.pm ?? null, raw: true });   // v0.55: decided on raw errors
      const t = fl.fff && !fl.fff.fail && fl.fff.fit, sd = fl.smu * fl.k;
      const cos = t && t.mu > 0 ? (t.muE * fl.muE + t.muN * fl.muN) / (t.mu * fl.mu) : -1;
      fl.agree = !!t && t.sig >= 3 && cos > 0.5 && Math.abs(t.mu - fl.mu) < 3 * Math.hypot(t.smu, sd);
      if (fl.agree) { const fd = ffCore((e, fr) => toRaw(fr, fl.s.x, fl.s.y), { H: 3, minSnr: 2, plx: P, muCat: fl.pm ?? null }); if (fd && !fd.fail && fd.fit) fl.fff = fd; }   // shown with the field floor
      (fl.agree ? flagged : artefacts).push(fl);
    }
    DF.res = { run, flagged, artefacts, out: out.length, nSrc: src.length, pairs: pairs.length, passes: passes.length + 1, slots: slots.length, kAll, days: Math.max(0, ...out.map(o => o.days)), secs: (performance.now() - t0) / 1000, pairsList: pairs };
    showDiff();
  } finally { DF.busy = false; srchDone(DF); }   // v0.55 U9
}
function dfThumb(fl) {
  const r = DF.res, pr = r && r.pairsList.filter(p => p.e === Math.max(...r.pairsList.map(q => q.e)))[0]; if (!pr) return null;
  const n = S.field.n, W = 7, cv = h('canvas', { width: 2 * W + 1, height: 2 * W + 1, class: 'dfthumb', title: 'The difference (last pass minus pass 1) around it: light = brighter now, dark = brighter before' });
  const g = cv.getContext('2d'), img = g.createImageData(2 * W + 1, 2 * W + 1), X = Math.round(fl.s.x), Y = Math.round(fl.s.y);
  let mx = 0; for (let j = -W; j <= W; j++) for (let i = -W; i <= W; i++) { const v = pr.P.D[(Y + j) * n + X + i]; if (v === v && Math.abs(v) > mx) mx = Math.abs(v); }
  for (let j = -W; j <= W; j++) for (let i = -W; i <= W; i++) { const v = pr.P.D[(Y + j) * n + X + i], o = ((j + W) * (2 * W + 1) + i + W) * 4, t = v === v && mx > 0 ? Math.max(-1, Math.min(1, v / mx)) : 0;
    img.data[o] = t > 0 ? 40 + 215 * t : 40 + 80 * -t; img.data[o + 1] = t > 0 ? 40 + 172 * t : 40; img.data[o + 2] = t > 0 ? 40 + 151 * t : 40 + 160 * -t; img.data[o + 3] = 255; }
  g.putImageData(img, 0, 0); return cv;
}
function showDiff() {
  const r = DF.res; if (!r || r.run !== S.run) return;
  S.sel = { diff: true }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const known = r.flagged.filter(x => x.label === 'known' || x.label === 'target').length;
  c.append(h('h3', {}, '◐ Difference search: slow movers'),
    h('p', {}, `${r.pairs} image pairs of the same colour (pass 1 against each later pass, ${r.slots} colour${r.slots === 1 ? '' : 's'}) were subtracted. ${r.out} of ${r.nSrc} sources from the deep stack could be fitted in every pass: ` +
      `a star that moved less than a pixel leaves a light-and-dark pair, and the fit tells that apart from a star that only changed brightness. ` +
      `A source counts as moving at 5σ after its errors are checked against sources of similar brightness, on a straight line, with the motion larger than any brightness change, at least 1″ in total, and only when the frame-by-frame measurement (every image lined up on Gaia) sees the same motion. ` +
      (r.flagged.length ? `${r.flagged.length} source${r.flagged.length === 1 ? '' : 's'} moved${known ? `; ${known} of them a catalogue confirms` : ''}.` : 'None moved: nothing here shows a clear light-and-dark pair.')),
    r.flagged.length ? h('ul', { class: 'mslist dflist' }, ...r.flagged.slice(0, 15).map((fl, i) => { const lb = fl.label === 'target' ? ['ok', `✓ Known mover: ${fl.target}, its catalogue motion (${fl.pm.toFixed(2)}″/yr) agrees`] : msLabel(fl);
      return h('li', {}, dfThumb(fl), h('div', {}, h('b', {}, `F${i + 1}. ${fl.mu.toFixed(2)} ± ${(fl.smu * fl.k).toFixed(2)}″ per year toward the ${fl.dir}`), ` (${(fl.sig / fl.k).toFixed(1)}σ calibrated, brightness change ${(fl.c * 100).toFixed(0)}%, ${fl.per.length + 1} passes) at ${fmtRaDec(fl.ra, fl.dec)}. `,
        h('span', { class: 'badge ' + lb[0] }, lb[1]), fl.gaia ? h('small', {}, ` Gaia DR3 ${fl.gaia.id}, G ${fl.gaia.g.toFixed(1)}, ${fl.pm != null ? fl.pm.toFixed(2) + '″/yr' : 'no motion listed'}`) : null, ' ',
        h('button', { onclick: () => dfTrack(fl, i + 1) }, '▶ Track'))); })) : null,
    r.artefacts.length ? h('p', { style: 'font-size:.82rem' }, `${r.artefacts.length} more source${r.artefacts.length === 1 ? '' : 's'} looked like ${r.artefacts.length === 1 ? 'it' : 'they'} moved in the differences, but the frame-by-frame measurement does not agree: likely artefact${r.artefacts.length === 1 ? '' : 's'} of the subtraction (a blend, a bright neighbour, a colour difference), not shown as movers.`) : null,
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, `Method (${r.secs.toFixed(1)} s): each pair is matched with a 3x3 kernel (a free brightness scale and blur), then each source is fitted in the difference together with the pass-1 image. Best for motions under about one pixel (6.2″) between passes; faster stars are found by 🔍 and 🔭. The small square: the difference around it (light = there now, dark = there before). A flagged source is a candidate to check, never a discovery claim.`),
    h('p', {}, h('button', { onclick: () => { S.sel = null; S.report ? showReport() : (c.hidden = true); } }, 'Close')));
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
function dfTrack(fl, num) {
  // hand-off: the frame-by-frame measurement (every image lined up on Gaia) at this source
  if (!fl.fff) { const T = S.ct && CHALLENGE[S.ct], P = fl.gaia && fl.gaia.plx > 1 ? fl.gaia.plx : fl.label === 'target' && T && T.plx > 1 ? T.plx : null;
    fl.fff = ffCore((e, fr) => toRaw(fr, fl.s.x, fl.s.y), { H: 3, minSnr: 2, plx: P, muCat: fl.pm ?? null }); }
  const name = fl.label === 'target' ? fl.target : fl.gaia && fl.label === 'known' ? 'Gaia DR3 ' + fl.gaia.id : `Difference source F${num}`;
  S.al.gotoRaDec(fl.ra, fl.dec); S.al.setFov(0.03);
  S.track = { name, pts: [], ff: fl.fff, run: S.run };
  const c = $('card'); c.replaceChildren(); c.hidden = false;
  c.append(h('h3', {}, `${name}: frame by frame`),
    h('p', { class: 'trksum' }, h('b', {}, 'Difference images: '), `${fl.mu.toFixed(2)} ± ${(fl.smu * fl.k).toFixed(2)}″ per year toward the ${fl.dir}, brightness change ${(fl.c * 100).toFixed(0)}%.`),
    fl.fff ? ffCard(fl.fff) : h('p', {}, 'The frame-by-frame measurement needs Gaia DR3, which did not answer.'),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, fl.label === 'known' ? 'Gaia DR3 lists this star with a motion that agrees.' : fl.label === 'target' ? `This is ${fl.target}, the field's NASA target: its catalogue motion agrees.` : 'Not confirmed by a catalogue: a candidate to check in other surveys (Gaia, CatWISE, the Legacy Surveys), never a discovery claim. The two methods should agree before it is worth a closer look.'),
    h('p', {}, h('button', { onclick: showDiff }, 'Back to the difference search')));
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
function drawDiff() {
  const r = DF.res; if (!r || r.run !== S.run || !r.flagged.length) return;
  const fov = S.al.getFov()[0]; ctx.save(); ctx.font = '600 11px Inter,system-ui,sans-serif';
  r.flagged.slice(0, 15).forEach((fl, i) => {
    const a = proj(fl.ra, fl.dec); if (!a) return;
    const col = fl.label === 'known' || fl.label === 'target' ? '#4ade80' : fl.label === 'candidate' || fl.label === 'unchecked' ? '#c4b5fd' : '#fbbf24';
    const b = proj(fl.ra + fl.muE / 3600 / Math.cos(fl.dec * Math.PI / 180), fl.dec + fl.muN / 3600); if (!b) return;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, tip = [a[0] + ux * 24, a[1] + uy * 24];
    ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a[0], a[1] - 8); ctx.lineTo(a[0] + 8, a[1]); ctx.lineTo(a[0], a[1] + 8); ctx.lineTo(a[0] - 8, a[1]); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a[0] + ux * 8, a[1] + uy * 8); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tip[0] + ux * 7, tip[1] + uy * 7); ctx.lineTo(tip[0] - uy * 4.5, tip[1] + ux * 4.5); ctx.lineTo(tip[0] + uy * 4.5, tip[1] - ux * 4.5); ctx.fill();
    if (fov < 1.2) ctx.fillText(`F${i + 1} · ${fl.mu.toFixed(1)}″/yr`, tip[0] + 9, tip[1] + 4);
    S.hits.push({ x: a[0], y: a[1], df: fl, dfn: i + 1 });
  });
  ctx.restore();
}

// v0.48: the card panel skips missing parts. Optional parts are written as "cond ? part : null", and the browser's append
// prints null as the text "null" (seen live under the difference-search list). One guard fixes every card.
(() => { const c = document.getElementById('card'); if (!c) return; const ap = c.append.bind(c); c.append = (...xs) => ap(...xs.filter(x => x != null && x !== false)); })();

/* ---------- v0.49: trial-motion scan around each source (research report rank 6; KBMOD, Whidden et al. 2019) ----------
   For sources too faint to measure in one image. Each image is turned into two maps once (in noise units, so every image
   counts by its own quality): Psi = the image matched-filtered with the star shape, Phi = the star shape squared over the
   good pixels. They are summed per pass. Then for every source of the deep stack, every trial motion within ±12″/yr is
   tried: the source's place in each pass follows that motion, and the S/N of the whole track is nu = sum Psi / sqrt(sum Phi)
   (a few look-ups per trial: no image is shifted). The best trial is the motion; how fast nu² falls around it gives the
   error (an error map), and nu² there minus nu² for "not moving" says how much better a moving track fits.
   Coarse 1″/yr steps (625 trials, from two starting points), then the motion and the start refined in turns (0.2 and 0.1″/yr; ±0.25 px). Psi and Phi are evaluated on a 1/8-px grid around each source with the star shape placed there, not interpolated.
   Flagged when the gain is 5 sigma for 2 numbers (28.7) after the field's own calibration (a fixed source gains 1.39 on
   median), the source is seen in every pass (S/N 3, and 5 in at least two), with no pass counting for more than twice the median pass, no blank (saturated) core, the motion is inside the scan, at least 1″ in total,
   and no star 10x brighter is within 5 px. The frame-by-frame measurement is asked too: if it measures the source and
   clearly disagrees, it is a likely artefact; if the source is too faint for it, the result is "scan only". Checked
   against Gaia DR3 or the NASA target. Never a discovery claim. Parallax is not modelled in the scan. */
const TSC = { res: null, busy: false };
// Per pass: the sum of its images in noise units (Z) and how many good images each pixel has (W). Psi and Phi are linear
// in these, so they can be evaluated for a star shape centred anywhere, not only on a pixel.
function scMaps() {
  const n = S.field.n, passes = [];
  for (let e = 0; e < S.eps.length; e++) {
    const Z = new Float32Array(n * n), W = new Float32Array(n * n); let nIm = 0, mjd = 0;
    for (const im of epochImgs(e)) {
      const fr = S.frames.get(im.url); if (!fr || !fr.flat || !fr.st || !(fr.st.sigma > 0)) continue; nIm++; mjd += im.mjd;
      const a = fr.flat, m = fr.st.med, s = fr.st.sigma;
      for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === v) { Z[i] += (v - m) / s; W[i]++; } }
    }
    if (nIm) passes.push({ e, Z, W, nIm, mjd: mjd / nIm });
  }
  return passes;
}
const bil = (A, n, x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y); if (x0 < 0 || y0 < 0 || x0 >= n - 1 || y0 >= n - 1) return NaN; const tx = x - x0, ty = y - y0, i = y0 * n + x0;
  return A[i] * (1 - tx) * (1 - ty) + A[i + 1] * tx * (1 - ty) + A[i + n] * (1 - tx) * ty + A[i + n + 1] * tx * ty; };
// Psi and Phi of every pass around one source, on a fine grid (1/8 px, ±3 px): the pixel-integrated star shape is placed
// at each fine position itself. (Interpolating maps made on whole pixels cannot move a peak off a pixel centre, which hid
// every motion under a pixel: seen on Epsilon Indi B, 0.3″/yr instead of 4.7.)
function scPatch(PS, n, s, sig) {
  const H = 3, st = 0.125, R = 3, G = 2 * R / st + 1, X0 = Math.round(s.x) - R, Y0 = Math.round(s.y) - R, sg = Math.SQRT2 * sig;
  if (X0 - H - 1 < 0 || Y0 - H - 1 < 0 || X0 + 2 * R + H + 1 >= n || Y0 + 2 * R + H + 1 >= n) return null;
  const pix = d => 0.5 * (erf((d + 0.5) / sg) - erf((d - 0.5) / sg)), ax = [];
  for (let g = 0; g < G; g++) { const x = X0 + g * st, b = Math.round(x) - H, w = new Float64Array(2 * H + 1); for (let i = 0; i <= 2 * H; i++) w[i] = pix(b + i - x); ax.push({ b, w }); }
  const P = PS.map(q => {
    const Psi = new Float32Array(G * G), Phi = new Float32Array(G * G);
    for (let gy = 0; gy < G; gy++) { const ry = ax[gy] /* same offsets in y: X0 and Y0 share the fraction 0 */, by = Y0 - X0 + ry.b;
      for (let gx = 0; gx < G; gx++) { const rx = ax[gx]; let ps = 0, ph = 0;
        for (let j = 0; j <= 2 * H; j++) { const wy = ry.w[j], row = (by + j) * n + rx.b; let sz = 0, sw = 0; for (let i = 0; i <= 2 * H; i++) { const wx = rx.w[i]; sz += wx * q.Z[row + i]; sw += wx * wx * q.W[row + i]; } ps += wy * sz; ph += wy * wy * sw; }
        Psi[gy * G + gx] = ps; Phi[gy * G + gx] = ph; } }
    return { dt: q.dt, Psi, Phi };
  });
  return { X0, Y0, st, G, P };
}
// nu for a source at (x0, y0) at the reference time, moving muE, muN ″/yr
// No pass may count for more than twice the median pass (with two passes: twice the weaker one), so a glitch or an
// asteroid crossing in one pass cannot pull a track toward itself (KBMOD's outlier filter, simplest form).
const scAt = (PT, k, x, y) => { const u = (x - PT.X0) / PT.st, v = (y - PT.Y0) / PT.st, a = bil(PT.P[k].Psi, PT.G, u, v), b = bil(PT.P[k].Phi, PT.G, u, v); return [a, b]; };
function scNu(PT, x0, y0, muE, muN, arc, per) {
  const A = [], B = [];
  for (let k = 0; k < PT.P.length; k++) { const q = PT.P[k], [a, b] = scAt(PT, k, x0 + muE * q.dt / arc, y0 - muN * q.dt / arc); if (!(a === a) || !(b > 0)) return NaN; A.push(a); B.push(b); if (per) per.push(a / Math.sqrt(b)); }
  const so = A.slice().sort((p, q) => p - q), cap = 2 * (A.length === 2 ? so[0] : msMed(so));
  let ps = 0, ph = 0; for (let i = 0; i < A.length; i++) { ps += cap > 0 ? Math.min(A[i], cap) : A[i]; ph += B[i]; }
  return ps / Math.sqrt(ph);
}
function scScan(PS, n, s, arc, sig) {
  const PT = scPatch(PS, n, s, sig); if (!PT) return null;
  const R = 12, st = 1, N = Math.round(2 * R / st) + 1, grid = new Float32Array(N * N);
  // 1. not moving: the best start within ±0.75 px (a bright star's centre matters more than its motion)
  let v0 = -Infinity, sx = s.x, sy = s.y;
  for (let oy = -0.75; oy <= 0.7501; oy += 0.125) for (let ox = -0.75; ox <= 0.7501; ox += 0.125) { const v = scNu(PT, s.x + ox, s.y + oy, 0, 0, arc); if (v > v0) { v0 = v; sx = s.x + ox; sy = s.y + oy; } }
  if (!Number.isFinite(v0)) return null;
  // 2. every trial motion, 1″/yr steps (625), from there and from the stack's own position (a faint mover's stack peak can sit
  // nearer its true middle than the "not moving" best, which leans toward its brighter passes)
  let best = { v: v0, mE: 0, mN: 0, x: sx, y: sy }; grid.fill(NaN);
  for (const [x0, y0] of [[s.x, s.y], [sx, sy]])
    for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) { const mE = -R + a * st, mN = -R + b * st, v = scNu(PT, x0, y0, mE, mN, arc), i = b * N + a;
      if (v === v && !(grid[i] >= v)) grid[i] = v; if (v > best.v) best = { v, mE, mN, x: x0, y: y0 }; }
  // 3. refine, taking turns: the motion (±1″/yr in 0.2 steps), then the start (±0.25 px in 0.125 steps), three times; then
  // the motion once more in 0.1 steps
  const tryMu = (span, step) => { const c = { ...best }; for (let dn = -span; dn <= span + 1e-9; dn += step) for (let de = -span; de <= span + 1e-9; de += step) { const v = scNu(PT, c.x, c.y, c.mE + de, c.mN + dn, arc); if (v > best.v) best = { v, mE: c.mE + de, mN: c.mN + dn, x: c.x, y: c.y }; } };
  const tryXY = () => { const c = { ...best }; for (let oy = -0.25; oy <= 0.2501; oy += 0.125) for (let ox = -0.25; ox <= 0.2501; ox += 0.125) { const v = scNu(PT, c.x + ox, c.y + oy, c.mE, c.mN, arc); if (v > best.v) best = { ...c, v, x: c.x + ox, y: c.y + oy }; } };
  for (let round = 0; round < 3; round++) { tryMu(1, 0.2); tryXY(); }
  tryMu(0.3, 0.1);
  // error from the curvature of nu² (ln L = nu²/2): sigma = sqrt(2 / -d²(nu²)/dmu²); when that is not a clean peak, from
  // the spread of the coarse trials within 2.3 of the best nu² (the 68% region for two numbers)
  const h = 0.3, f = (mE, mN) => { const v = scNu(PT, best.x, best.y, mE, mN, arc); return v * v; }, f0 = best.v * best.v;
  const dE = (f(best.mE + h, best.mN) - 2 * f0 + f(best.mE - h, best.mN)) / (h * h), dN = (f(best.mE, best.mN + h) - 2 * f0 + f(best.mE, best.mN - h)) / (h * h);
  let gE = 0, gN = 0, gm = 0, sE2 = 0, sN2 = 0; const top = Math.max(...Array.from(grid).filter(Number.isFinite)) ** 2;
  for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) { const v = grid[b * N + a]; if (v === v && v * v >= top - 2.3) { const mE = -R + a * st, mN = -R + b * st; gE += mE; gN += mN; sE2 += mE * mE; sN2 += mN * mN; gm++; } }
  const gsE = gm ? Math.max(st / Math.sqrt(12), Math.sqrt(Math.max(0, sE2 / gm - (gE / gm) ** 2))) : Infinity, gsN = gm ? Math.max(st / Math.sqrt(12), Math.sqrt(Math.max(0, sN2 / gm - (gN / gm) ** 2))) : Infinity;
  const per = []; scNu(PT, best.x, best.y, best.mE, best.mN, arc, per);
  // vacancy test: where the track ends, the first pass must be (nearly) empty, and where it starts, the last pass too. A
  // real mover leaves its old place; a track hopping from one star to a fixed neighbour does not. Only when the two ends
  // are 1 px or more apart (closer, the star's own blur overlaps).
  const K = PT.P.length - 1, A = PT.P[0], B = PT.P[K], nuAt = (k, x, y) => { const [a, b] = scAt(PT, k, x, y); return b > 0 ? a / Math.sqrt(b) : NaN; };
  const pa = [best.x + best.mE * A.dt / arc, best.y - best.mN * A.dt / arc], pb = [best.x + best.mE * B.dt / arc, best.y - best.mN * B.dt / arc];
  // "nearly empty": under half of the star there, or at noise level (S/N under 2.5) when that pass sees it only faintly
  const vacant = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < 1 || (nuAt(0, ...pb) < Math.max(0.5 * nuAt(0, ...pa), 2.5) && nuAt(K, ...pa) < Math.max(0.5 * nuAt(K, ...pb), 2.5));
  return { nu: best.v, nu0: v0, gain: f0 - v0 * v0, muE: best.mE, muN: best.mN, sE: dE < 0 ? Math.sqrt(-2 / dE) : gsE, sN: dN < 0 ? Math.sqrt(-2 / dN) : gsN, per, grid, N, R, st, ox: best.x - s.x, oy: best.y - s.y, vacant };
}
async function motionScan() {
  if (!S.field || S.eps.length < 2) { toast('The motion scan needs at least two passes of this field.', 5000); return; }
  if (TSC.busy) return; TSC.busy = true; TSC.stop = false;
  const f = S.field, n = f.n, run = S.run, t0 = performance.now(), arc = PX * 3600, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n };
  const say = (txt, i, m) => { if ((run !== S.run || TSC.stop)) return; srchSay(TSC, '🎯 Motion scan: working', txt, m ? `${i} of ${m} sources scanned...` : null, motionScan); if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card'); };   // v0.55 U9
  try {
    say('Stacking every image and finding sources...'); await sleep(30);
    try { await gaiaLoad(); } catch { /* labels say unchecked */ } const cwP = cwLoad();   // v0.56: Gaia always for THIS field (it kept the last field's stars)
    await warmEpsf(() => run === S.run && !TSC.stop); await fieldFloorWarm(() => run === S.run && !TSC.stop); if ((run !== S.run || TSC.stop)) return;   // v0.57.5: star shapes first, one image at a time
    const D = allStack(); if (!D.st || D.nImg < 4) { say('Too few images are loaded. Run the agents first (Images per epoch: 4 or more).'); return; }
    const pk = F.detectPeaks(D.flat, n, D.st, 5, 2000).filter(p => p.x > 14 && p.y > 14 && p.x < n - 15 && p.y < n - 15);
    const blankNear = p => { const X = Math.round(p.x), Y = Math.round(p.y); for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (!(D.flat[(Y + j) * n + X + i] === D.flat[(Y + j) * n + X + i])) return true; return false; };
    const src = pk.filter((p, i) => !pk.some((q, j) => j < i && Math.hypot(q.x - p.x, q.y - p.y) < 3)).slice(0, 500)
      .filter(p => !pk.some(q => q.flux > 10 * p.flux && Math.hypot(q.x - p.x, q.y - p.y) < 5) && !blankNear(p));   // no saturated (blank) core: 🔍 handles those
    // the star shape: the median width of bright isolated stars in the stack
    const ws = src.slice(0, 40).map(p => psfFit(D.flat, n, p.x, p.y, 3, 1)).filter(m => m && !m.sat).map(m => m.sig), sigPsf = Math.min(1.5, Math.max(0.4, msMed(ws) || 0.7));
    say(`Building the two maps for every image (star width ${(sigPsf * 2.355 * arc).toFixed(1)}″ FWHM in the stack)...`); await sleep(30); if ((run !== S.run || TSC.stop)) return;
    const PS = scMaps(); if (PS.length < 2) { say('Fewer than two passes have images here.'); return; }
    const tRef = PS.reduce((s, q) => s + q.mjd * q.nIm, 0) / PS.reduce((s, q) => s + q.nIm, 0); PS.forEach(q => { q.dt = (q.mjd - tRef) / 365.25; });
    const days = PS[PS.length - 1].mjd - PS[0].mjd, out = [];
    for (let i = 0; i < src.length; i++) {
      if ((run !== S.run || TSC.stop)) return;
      const r = scScan(PS, n, src[i], arc, sigPsf); if (r) out.push({ s: src[i], ...r });
      if (i % 20 === 0) { say(`Trying 625 motions for each of ${src.length} sources, in ${PS.length} passes (${D.nImg} images).`, i, src.length); await sleep(0); }
      else await breathe();
    }
    // calibration by brightness: a fixed source gains 1.386 on median (2-number chi-square); brighter sources gain more from
    // small systematic shifts, so each S/N bin of the stack gets its own factor (the field-wide one when a bin has < 12)
    const kAll = Math.max(1, (msMed(out.map(o => o.gain)) || 0) / 1.386), bins = [5, 10, 20, 50, 150, 500, Infinity], kB = {};
    for (let b = 0; b < bins.length - 1; b++) { const inb = out.filter(o => o.s.snr >= bins[b] && o.s.snr < bins[b + 1]); kB[b] = inb.length >= 12 ? Math.max(1, msMed(inb.map(o => o.gain)) / 1.386) : kAll; }
    out.forEach(o => { const b = bins.findIndex((v, i) => o.s.snr >= v && o.s.snr < bins[i + 1]); o.kG = kB[b] ?? kAll; });
    const kG = Math.max(...Object.values(kB));
    await Promise.race([cwP, sleep(45000)]); if ((run !== S.run || TSC.stop)) return;   // v0.53: CatWISE2020 for finds that Gaia does not know
    const pre = out.filter(o => { const mu = Math.hypot(o.muE, o.muN), sp = o.per.slice().sort((a, b) => b - a);
        return o.gain / o.kG >= 28.7 && o.per.every(v => v >= 3) && sp[1] >= 5 && Math.abs(o.muE) < o.R - 0.5 && Math.abs(o.muN) < o.R - 0.5 && mu * days / 365.25 >= 1 && Number.isFinite(o.sE) && Number.isFinite(o.sN); })
      .map(o => { const mu = Math.hypot(o.muE, o.muN), k = Math.sqrt(o.kG), pa = (Math.atan2(o.muE, o.muN) * 180 / Math.PI + 360) % 360;
        const smu = Math.hypot(mu > 0 ? Math.sqrt((o.muE * o.sE) ** 2 + (o.muN * o.sN) ** 2) / mu * k : 9, 0.2);   // + 0.2″/yr floor (registration, colour)
        // its place in pass 1: the reference-time position moved along the motion to pass 1's date
        const x = o.s.x + o.ox, y = o.s.y + o.oy, sk0 = F.gridToSky(x + o.muE * PS[0].dt / arc, y - o.muN * PS[0].dt / arc, grid);
        const fl = Object.assign(o, { mu, smu, sig: Math.sqrt(o.gain / o.kG), dir: COMPASS[Math.round(pa / 45) % 8], ra: sk0[0], dec: sk0[1], x, y, days, ff: { passes: [{ ra: sk0[0], dec: sk0[1], mjd: PS[0].mjd }], fit: { muE: o.muE, muN: o.muN, smu } } });
        Object.assign(fl, dsGaia(fl, days)); return fl; })
      // the vacancy test guards against hops between stars; a source whose position AND motion match a catalogue is not a
      // hop (WISE 0855 passes right next to a fixed star, so its old place is never empty)
      .filter(fl => fl.vacant || fl.label === 'known' || fl.label === 'target')
      .sort((a, b) => b.sig - a.sig).slice(0, 20);
    // second opinion where possible: the frame-by-frame measurement
    const flagged = [], artefacts = [];
    for (let i = 0; i < pre.length; i++) {
      const fl = pre[i], T = S.ct && CHALLENGE[S.ct], P = fl.gaia && fl.gaia.plx > 1 ? fl.gaia.plx : fl.label === 'target' && T && T.plx > 1 ? T.plx : null;
      say('Asking the frame-by-frame measurement for a second opinion...', i + 1, pre.length); await sleep(0); if ((run !== S.run || TSC.stop)) return;
      fl.fff = ffCore((e, fr) => toRaw(fr, fl.s.x, fl.s.y), { H: 3, minSnr: 2, plx: P, muCat: fl.pm ?? null, raw: true });   // v0.55: decided on raw errors
      const t = fl.fff && !fl.fff.fail && fl.fff.fit, cat = fl.label === 'known' || fl.label === 'target';
      // no catalogue behind it: its brightness must hold between passes (more than 3x: a variable source or a blend, whose
      // light centre shifts without any motion)
      const pv = fl.per.filter(v => v > 0), ratio = pv.length ? Math.max(...pv) / Math.min(...pv) : Infinity;
      if (!cat && ratio > 3) { fl.check = 'brightness'; artefacts.push(fl); continue; }
      // faster than any star known: Barnard's Star, 10.4″/yr. Without a catalogue behind it, a faint source this fast is
      // almost surely a blend (both measurements can be pulled the same way by a neighbour)
      if (!cat && fl.mu > 10.4) { fl.check = 'too fast'; artefacts.push(fl); continue; }
      if (fl.label === 'fixed') { fl.check = 'gaia fixed'; artefacts.push(fl); continue; }   // Gaia's motions are far more precise: a fixed star here means a fake motion
      // too faint for it (no fit, or its error too large to tell a motion this size): the scan alone
      if (!t || !(t.smu <= fl.mu / 2)) { fl.check = cat ? 'catalogue' : 'scan only'; flagged.push(fl); continue; }
      const cos = t.mu > 0 ? (t.muE * fl.muE + t.muN * fl.muN) / (t.mu * fl.mu) : -1;
      fl.check = t.mu >= 3 * t.smu && Math.abs(t.mu - fl.mu) < 3 * Math.hypot(t.smu, fl.smu) && cos > 0.5 ? 'agrees' : cat ? 'catalogue' : 'disagrees';   // it must see a motion itself
      (fl.check === 'disagrees' ? artefacts : flagged).push(fl);
    }
    // v0.55: the kept finds are shown with the field floor in their errors
    for (const fl of flagged) { if (!fl.fff || fl.fff.fail) continue; const fd = ffCore((e, fr) => toRaw(fr, fl.s.x, fl.s.y), { H: 3, minSnr: 2, plx: fl.fff.plx || undefined, muCat: fl.fff.muCat ?? fl.pm ?? null }); if (fd && !fd.fail && fd.fit) fl.fff = fd; }
    TSC.res = { run, flagged, artefacts, all: out, nSrc: src.length, scanned: out.length, nImg: D.nImg, passes: PS.length, kG, sigPsf, days, PS: PS.map(q => ({ e: q.e, nIm: q.nIm, mjd: q.mjd, dt: q.dt })), secs: (performance.now() - t0) / 1000 };
    showScan();
  } finally { TSC.busy = false; srchDone(TSC); }   // v0.55 U9
}
function scHeat(fl) {
  const N = fl.N, cv = h('canvas', { width: N, height: N, class: 'dfthumb', title: `How well each trial motion fits (±${fl.R}″/yr; east to the left, north up). The bright spot is the measured motion; its size is the error. The cross is "not moving".` });
  // brightness from the calibrated fit difference to the best trial, d = (best nu² - nu²) / (2 x the field's factor):
  // 1 / sqrt(1 + d), so the region near the best glows and poor motions fade (a precise motion: a small bright area; the
  // 1″/yr cells are coarser than a bright star's error, so the exact best motion is marked with a white dot)
  const g = cv.getContext('2d'), img = g.createImageData(N, N); let mx = -Infinity;
  for (const v of fl.grid) if (v === v && v > mx) mx = v;
  const top = Math.max(mx, fl.nu) ** 2, kk = fl.kG || 1;
  for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
    const v = fl.grid[b * N + a], t = v === v ? 1 / Math.sqrt(1 + Math.max(0, top - v * v) / (2 * kk)) : 0, o = ((N - 1 - b) * N + (N - 1 - a)) * 4;   // north up, east left
    img.data[o] = 20 + 25 * t; img.data[o + 1] = 25 + 187 * t; img.data[o + 2] = 40 + 151 * t; img.data[o + 3] = 255; }
  const mid = (N - 1) / 2; for (let k = -2; k <= 2; k++) { for (const [xx, yy] of [[mid + k, mid], [mid, mid + k]]) { const o = (yy * N + xx) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; } }
  // the measured motion itself: a warm dot
  const ba = Math.round((fl.muE + fl.R) / fl.st), bb = Math.round((fl.muN + fl.R) / fl.st);
  if (ba >= 0 && ba < N && bb >= 0 && bb < N) { const o = ((N - 1 - bb) * N + (N - 1 - ba)) * 4; img.data[o] = 253; img.data[o + 1] = 230; img.data[o + 2] = 138; }
  g.putImageData(img, 0, 0); return cv;
}
const SC_CHECK = { agrees: 'the frame-by-frame measurement agrees', 'scan only': 'too faint for the frame-by-frame measurement: the scan alone, needs confirmation',
  catalogue: 'its catalogue position and motion agree (the frame-by-frame measurement could not separate it from a neighbour or was too faint)' };
function showScan() {
  const r = TSC.res; if (!r || r.run !== S.run) return;
  S.sel = { scan: true }; const c = $('card'); c.replaceChildren(); c.hidden = false;
  const known = r.flagged.filter(x => x.label === 'known' || x.label === 'target').length;
  c.append(h('h3', {}, '🎯 Motion scan: faint stars'),
    h('p', {}, `For ${r.scanned} sources of a stack of ${r.nImg} images, 625 motions within ±12″ per year were tried (then refined), each adding up all ${r.passes} passes along that motion; the best one is the measurement. ` +
      `A source counts as moving when the moving track fits clearly better than "not moving" (5σ, after the field's own calibration${r.kG > 1.001 ? `: raised ${r.kG.toFixed(1)}x` : ''}), it is seen in every pass, and it moved at least 1″. ` +
      (r.flagged.length ? `${r.flagged.length} source${r.flagged.length === 1 ? '' : 's'} moved${known ? `; ${known} of them a catalogue confirms` : ''}.` : 'None moved.')),
    r.flagged.length ? h('ul', { class: 'mslist dflist' }, ...r.flagged.slice(0, 15).map((fl, i) => { const lb = fl.label === 'target' ? ['ok', `✓ Known mover: ${fl.target}, its catalogue motion (${fl.pm.toFixed(2)}″/yr) agrees`] : msLabel(fl);
      return h('li', {}, scHeat(fl), h('div', {}, h('b', {}, `M${i + 1}. ${fl.mu.toFixed(2)} ± ${fl.smu.toFixed(2)}″ per year toward the ${fl.dir}`), ` (${fl.sig.toFixed(1)}σ, track S/N ${fl.nu.toFixed(0)}, per pass ${fl.per.map(v => v.toFixed(0)).join(' / ')}) at ${fmtRaDec(fl.ra, fl.dec)}; ${SC_CHECK[fl.check]}. `,
        h('span', { class: 'badge ' + lb[0] }, lb[1]), fl.gaia ? h('small', {}, ` Gaia DR3 ${fl.gaia.id}, G ${fl.gaia.g.toFixed(1)}, ${fl.pm != null ? fl.pm.toFixed(2) + '″/yr' : 'no motion listed'}`) : null, ' ',
        h('button', { onclick: () => scTrack(fl, i + 1) }, '▶ Track'))); })) : null,
    r.artefacts.length ? h('p', { style: 'font-size:.82rem' }, `${r.artefacts.length} more source${r.artefacts.length === 1 ? '' : 's'} seemed to move in the scan, but ${[
      r.artefacts.some(x => x.check === 'disagrees') ? `the frame-by-frame measurement clearly disagrees (${r.artefacts.filter(x => x.check === 'disagrees').length})` : '',
      r.artefacts.some(x => x.check === 'brightness') ? `the brightness changed more than 3x between passes, so a variable source or a blend is likelier than motion (${r.artefacts.filter(x => x.check === 'brightness').length})` : '',
      r.artefacts.some(x => x.check === 'gaia fixed') ? `Gaia measures the star there as fixed, far more precisely (${r.artefacts.filter(x => x.check === 'gaia fixed').length})` : '',
      r.artefacts.some(x => x.check === 'too fast') ? `it would be faster than any star known (Barnard's Star, 10.4″ per year) with no catalogue behind it, so a blend is far likelier (${r.artefacts.filter(x => x.check === 'too fast').length})` : ''].filter(Boolean).join('; or ')}: likely artefacts, not shown as movers.`) : null,
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, `Method (${r.secs.toFixed(1)} s; Whidden et al. 2019, KBMOD): every image becomes two maps once, in its own noise units; a trial motion only adds them up along its path, so faint sources gain from all ${r.nImg} images together. The small square: how well each trial motion fits (bright = fits well; east left, north up; white cross = "not moving", warm dot = the measured motion); a small bright area is a precise motion. Parallax is not modelled here. A flagged source is a candidate to check, never a discovery claim.`),
    h('p', {}, h('button', { onclick: () => { S.sel = null; S.report ? showReport() : (c.hidden = true); } }, 'Close')));
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
function scTrack(fl, num) {
  const name = fl.label === 'target' ? fl.target : fl.gaia && fl.label === 'known' ? 'Gaia DR3 ' + fl.gaia.id : `Scan source M${num}`, r = TSC.res, f = S.field, arc = PX * 3600, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n };
  S.al.gotoRaDec(fl.ra, fl.dec); S.al.setFov(0.03);
  const ok = fl.fff && !fl.fff.fail && fl.fff.fit;
  // the scan's own path (positions it implies in each pass) when the frame-by-frame measurement could not measure it
  const path = r.PS.map(q => { const sk = F.gridToSky(fl.x + fl.muE * q.dt / arc, fl.y - fl.muN * q.dt / arc, grid); return { e: q.e, mjd: q.mjd, ra: sk[0], dec: sk[1], sE: fl.smu * Math.abs(q.dt) + 0.3, sN: fl.smu * Math.abs(q.dt) + 0.3 }; });
  S.track = { name, pts: [], ff: ok ? fl.fff : { passes: path, frames: [], fit: { line: [[path[0].ra, path[0].dec], [path[path.length - 1].ra, path[path.length - 1].dec]] } }, run: S.run };
  const c = $('card'); c.replaceChildren(); c.hidden = false;
  c.append(h('h3', {}, `${name}: its motion`),
    h('div', { class: 'dflist' }, h('li', { style: 'list-style:none' }, scHeat(fl), h('p', { class: 'trksum' }, h('b', {}, 'Motion scan: '), `${fl.mu.toFixed(2)} ± ${fl.smu.toFixed(2)}″ per year toward the ${fl.dir} (${fl.sig.toFixed(1)}σ better than "not moving"; S/N ${fl.per.map(v => v.toFixed(0)).join(' / ')} in passes ${r.PS.map(q => q.e + 1).join(' / ')}).`))),
    ok ? ffCard(fl.fff) : h('p', { style: 'font-size:.85rem' }, 'Too faint to measure in single images, so there is no frame-by-frame box: on the sky, a circle per pass where the scanned motion puts it, and its path.'),
    h('p', { style: 'font-size:.8rem;color:var(--dust)' }, fl.label === 'known' ? 'Gaia DR3 lists this star with a motion that agrees.' : fl.label === 'target' ? `This is ${fl.target}, the field's NASA target: its catalogue motion agrees.` : 'Not confirmed by a catalogue: a candidate to check in other surveys (Gaia, CatWISE, the Legacy Surveys), never a discovery claim.'),
    h('p', {}, h('button', { onclick: showScan }, 'Back to the motion scan')));
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
function drawScan() {
  const r = TSC.res; if (!r || r.run !== S.run || !r.flagged.length) return;
  const fov = S.al.getFov()[0]; ctx.save(); ctx.font = '600 11px Inter,system-ui,sans-serif';
  r.flagged.slice(0, 15).forEach((fl, i) => {
    const a = proj(fl.ra, fl.dec); if (!a) return;
    const col = fl.label === 'known' || fl.label === 'target' ? '#4ade80' : fl.label === 'candidate' || fl.label === 'unchecked' ? '#c4b5fd' : '#fbbf24';
    const b = proj(fl.ra + fl.muE / 3600 / Math.cos(fl.dec * Math.PI / 180), fl.dec + fl.muN / 3600); if (!b) return;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, tip = [a[0] + ux * 24, a[1] + uy * 24];
    ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(a[0], a[1], 8, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(a[0] - 4, a[1]); ctx.lineTo(a[0] + 4, a[1]); ctx.moveTo(a[0], a[1] - 4); ctx.lineTo(a[0], a[1] + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a[0] + ux * 9, a[1] + uy * 9); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tip[0] + ux * 7, tip[1] + uy * 7); ctx.lineTo(tip[0] - uy * 4.5, tip[1] + ux * 4.5); ctx.lineTo(tip[0] + uy * 4.5, tip[1] - ux * 4.5); ctx.fill();
    if (fov < 1.2) ctx.fillText(`M${i + 1} · ${fl.mu.toFixed(1)}″/yr`, tip[0] + 9, tip[1] + 4);
    S.hits.push({ x: a[0], y: a[1], sc: fl, scn: i + 1 });
  });
  ctx.restore();
}

/* ---------- v0.50: animate the movers, pass by pass ----------
   For any field: the moving stars that ARCNAVE's searches measured (🔭 deep search, ◐ difference images, 🎯 motion scan,
   🔍 bright stars; if none has run yet, 🔍 and 🔭 run first) are played as a film. One timer steps through the passes:
   the sky shows each pass's image (time machine view), and every mover's MEASURED track grows pass by pass, with a marker
   gliding to its new place. A card shows a small cut-out per mover (the same window in every pass, one brightness scale),
   so the star itself is seen to shift against its neighbours. Positions are measurements (frame by frame, lined up on
   Gaia), not catalogue predictions. Motions of a few ″ are under a screen pixel when zoomed out, so the sky paths are then
   drawn longer by a stated factor; the cut-outs are always true scale. Never a discovery claim: the labels are the
   searches' own (known mover / unconfirmed candidate). */
const MOVIE = { on: false, timer: 0, e: 0, t0: 0, step: 1400, movers: [], run: -1, prevMode: null, tiles: [], spot: true, off: null,
  mo: false, follow: false, fi: 0 };   // v0.55: mo = motion only (the sky hidden, the measured tracks alone); follow = the view goes mover by mover
// v0.57.8: the film's tracks (trackAcross, 0.1-0.5 s each, for 🔍's stars and the catalogues' movers) are worked out one at
// a time with pauses before the film starts; movieMovers() then reuses them. Same function on the same images and settings
// (any re-alignment, new run or fitter change means they are worked out again).
const TRK = { key: '', m: new Map() };
const msObj = fl => fl.gaia && fl.label === 'known' ? gaiaObj(fl.gaia) : { ra0: fl.ra, dec0: fl.dec, ep: epMid(MS.res.passes[0]), pmra: 0, pmdec: 0, noCat: true };
function trackOf(o) {
  const ver = S.run + '|' + S.alignVer + '|' + S.frames.size + '|' + FT.fitter + '|' + FT.epsfMode; if (TRK.key !== ver) { TRK.key = ver; TRK.m.clear(); }
  const k = [o.ra0, o.dec0, o.ep, o.pmra, o.pmdec, o.plx, o.noCat, o.cat, o.catSmu].join(','); if (TRK.m.has(k)) return TRK.m.get(k);
  const tr = trackAcross(o); TRK.m.set(k, tr); return tr;
}
const filmTrack = (fl, o) => trackOf(o || msObj(fl));
async function movieWarm(live) {
  const P = S.eps.length, days = P > 1 ? epMid(P - 1) - epMid(0) : 0, objs = [];
  if (MS.res && MS.res.run === S.run) for (const fl of MS.res.flagged) objs.push(msObj(fl));
  if (P > 1 && GAIA.data) for (const st of GAIA.data.stars) if (st.pmra != null && gPm(st) * days / 365.25 >= 1.5) objs.push(gaiaObj(st));
  if (P > 1 && CW.data) for (const st of CW.src) if (!st.twinOf && cwMover(st) && cwPm(st) * days / 365.25 >= 1.5) objs.push(cwObj(st));
  for (const o of objs) { if (!live()) return; try { trackOf(o); } catch { /* done again in movieMovers */ } await yieldNow(); }
}
function movieMovers() {
  const f = S.field, grid = { ra0: f.ra, dec0: f.dec, s: f.s, n: f.n }, arc = PX * 3600, list = [];
  const nameOf = fl => fl.label === 'target' ? fl.target : fl.gaia && fl.label === 'known' ? 'Gaia DR3 ' + fl.gaia.id : fl.cw && fl.label === 'known' ? 'CatWISE ' + fl.cw.name : null;
  const add = (name, label, src, passes, mu, dir, fl) => {
    if (!passes || passes.length < 2) return; const p0 = passes[0], cd = Math.cos(p0.dec * Math.PI / 180);
    // v0.56: Gaia measures it as not moving (far more precisely than SPHEREx can): whatever a search saw, it is not a mover
    // (field 0, 0: a 🔭 deep-search star at "6.1 ± 1.2″/yr" that Gaia DR3 gives 0.04″/yr)
    if (label === 'fixed') return;
    // v0.56: a track whose passes all sit on the very same place (seen on Barnard's field: a 🔍 track of 0″/yr) moved nothing
    if (!(fl && fl.slow) && passes.every(q => Math.hypot((q.ra - p0.ra) * cd, q.dec - p0.dec) * 3600 < 0.001)) return;
    if (list.some(m => Math.hypot((m.passes[0].ra - p0.ra) * cd, m.passes[0].dec - p0.dec) * 3600 < 9)) return;   // the same star from another search
    // v0.56: the field's NASA target (or its named companion, Epsilon Indi A) by its own name, whichever search or catalogue
    // found it: where it should be in the first pass (within 15″, saturated stars are measured less precisely) and moving
    // the same way. Barnard's Star was shown as "Gaia DR3 4472832130942575872".
    const T = S.ct && CHALLENGE[S.ct], t0 = p0.mjd ?? epMid(p0.e), pL = passes[passes.length - 1], tL = pL.mjd ?? epMid(pL.e);
    for (const o of T ? [T, T.companion].filter(x => x && x.pmra != null) : []) {
      const q = ctAt(o, t0), qL = ctAt(o, tL);
      const dE = (pL.ra - p0.ra) * cd * 3600, dN = (pL.dec - p0.dec) * 3600, eE = (qL[0] - q[0]) * cd * 3600, eN = (qL[1] - q[1]) * 3600;
      if (Math.hypot((q[0] - p0.ra) * cd, q[1] - p0.dec) * 3600 < 15 && Math.hypot(dE - eE, dN - eN) < Math.max(2, 0.35 * Math.hypot(eE, eN))) {
        name = o.name; if (o === T && label !== 'predicted') label = 'target'; break; }
    }
    list.push({ name: name || `Moving star ${list.length + 1}`, label, src, mu, dir, cw: fl && fl.cw, cwNear: fl && fl.cwNear, pm: fl && fl.pm, how: (fl && fl.how) || 'measured', catPm: fl && fl.catPm, slow: fl && fl.slow,
      // v0.55 U4: a search's own error (its frame-by-frame fit) and its Gaia match, for the SPHEREx vs catalogue row
      smu: fl ? (fl.smu ?? (fl.ff && fl.ff.fit ? fl.ff.fit.smu : fl.fff && fl.fff.fit ? fl.fff.fit.smu : fl.smu)) : undefined, gaia: fl && fl.gaia,
      satNote: fl && fl.satNote,   // v0.55: "13 of 17 images" when a saturated star is shown by its catalogue motion instead
      // v0.55: a frame-by-frame pass keeps its measured offsets (E, N), their errors and the parallax shift, for the epochs chart
      passes: passes.map(q => ({ e: q.e, ra: q.ra, dec: q.dec, g: F.skyToGrid(q.ra, q.dec, grid), mjd: q.mjd ?? null,
        E: q.E ?? null, N: q.N ?? null, sE: q.sE ?? null, sN: q.sN ?? null, sE0: q.sE0 ?? null, pE: q.pE || 0, pN: q.pN || 0 })) });
  };
  const okFF = ff => ff && !ff.fail && ff.fit && ff.passes && ff.passes.length >= 2;
  if (DS.res && DS.res.run === S.run) DS.res.flagged.forEach(fl => okFF(fl.ff) && add(nameOf(fl), fl.label, '🔭', fl.ff.passes, fl.ff.fit.mu, fl.ff.fit.dir, fl));
  if (DF.res && DF.res.run === S.run) DF.res.flagged.forEach(fl => okFF(fl.fff) && add(nameOf(fl), fl.label, '◐', fl.fff.passes, fl.fff.fit.mu, fl.fff.fit.dir, fl));
  // v0.56: a 🎯 find with no catalogue behind it, within 4 pixels (25″) of a saturated star's blank core in any pass, sits
  // in that star's glare: its peak moves with the glare, not as a star (Epsilon Indi field: a peak 17″ from saturated
  // Epsilon Indi A, "4.7″/yr north" while A moves south-east; A's core is blank only in the pass where it is saturated in
  // most images). The scan only skips a blank core within 2 pixels. On that field 10 of 367 scanned sources lie this close.
  const glareOf = fl => { if (fl.label === 'known' || fl.label === 'target') return false; const n = f.n, X = Math.round(fl.s.x), Y = Math.round(fl.s.y); let hit = 0, tot = 0;
    for (let e = 0; e < S.eps.length; e++) { const fr = frameOf(e); if (!fr) continue; tot++; let blank = 0;
      for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { if (i * i + j * j > 16) continue; const x = X + i, y = Y + j; if (x >= 0 && y >= 0 && x < n && y < n && !(fr.flat[y * n + x] === fr.flat[y * n + x])) blank++; }
      if (blank >= 4) hit++; }
    return hit > 0; };
  if (TSC.res && TSC.res.run === S.run) TSC.res.flagged.forEach(fl => {
    if (glareOf(fl)) return;
    // the frame-by-frame track only where it agreed with the scan; "scan only" means it was too faint or too uncertain
    // there (Epsilon Indi field: 32 ± 5″/yr against the scan's 4.7), so the scan's own path is shown
    if (okFF(fl.fff) && fl.check !== 'scan only') return add(nameOf(fl), fl.label, '🎯', fl.fff.passes, fl.fff.fit.mu, fl.fff.fit.dir, fl);
    add(nameOf(fl), fl.label, '🎯', TSC.res.PS.map(q => { const sk = F.gridToSky(fl.x + fl.muE * q.dt / arc, fl.y - fl.muN * q.dt / arc, grid); return { e: q.e, ra: sk[0], dec: sk[1] }; }), fl.mu, fl.dir, fl); });
  if (MS.res && MS.res.run === S.run) MS.res.flagged.forEach(fl => {
    const known = fl.gaia && fl.label === 'known', o = msObj(fl);
    const tr = filmTrack(fl, o); if (!tr) return;
    // the frame-by-frame track only when it agrees with 🔍's own measurement: a saturated star's fit can go astray (seen
    // on Epsilon Indi A: 2.5″/yr east); otherwise 🔍's pass-by-pass track
    const muMS = fl.shift / (MS.res.days / 365.25);
    const cat = known ? { gaia: fl.gaia, pm: gPm(fl.gaia) } : null;   // v0.55 U4: its Gaia match, for the SPHEREx vs catalogue row
    // v0.55: saturated in most images (Epsilon Indi A: 13 of 17): neither track can be trusted, so Gaia's motion is shown
    // (dashed, "predicted") and the card says why
    // v0.56: unless 🔍's own pass-by-pass track of it (measured on the star's glow) agrees with Gaia in speed (15 %) and
    // direction: then that track is shown as measured (Barnard's Star: 9.6″ in 359 days, 9.8″/yr against Gaia's 10.39)
    if (known && satShare(tr.ff) > 0.5 && tr.pts && tr.pts.length >= 2 && tr.days > 0) { const muP = tr.total / (tr.days / 365.25), g = gPm(fl.gaia), a = tr.pts[0], z = tr.pts[tr.pts.length - 1], cdA = Math.cos(a.dec * Math.PI / 180);
      const vE = (z.ra - a.ra) * cdA * 3600, vN = (z.dec - a.dec) * 3600, cos = (vE * (fl.gaia.pmra || 0) + vN * (fl.gaia.pmdec || 0)) / (Math.hypot(vE, vN) * Math.hypot(fl.gaia.pmra || 0, fl.gaia.pmdec || 0) || 1);
      if (Math.abs(muP - g) < 0.15 * g && cos > 0.9) return add('Gaia DR3 ' + fl.gaia.id, fl.label, '🔍', tr.pts, muP, tr.dir, { ...cat, how: 'measured' }); }
    if (known && satShare(tr.ff) > 0.5) { const pa = Math.atan2(fl.gaia.pmra || 0, fl.gaia.pmdec || 0) * 180 / Math.PI;
      const exp = S.eps.map((_, e) => { if (!frameOf(e)) return null; const p = ctAt(o, epMid(e)); return { e, ra: p[0], dec: p[1] }; }).filter(Boolean);
      return add('Gaia DR3 ' + fl.gaia.id, 'predicted', '★ Gaia', exp, gPm(fl.gaia), COMPASS[Math.round(((pa + 360) % 360) / 45) % 8], { ...cat, how: 'predicted', catPm: gPm(fl.gaia), satNote: `${tr.ff.nSat} of ${tr.ff.nKept} images` }); }
    if (okFF(tr.ff) && Math.abs(tr.ff.fit.mu - muMS) < Math.max(1, 0.3 * muMS)) add(known ? 'Gaia DR3 ' + fl.gaia.id : null, fl.label, '🔍', tr.ff.passes, tr.ff.fit.mu, tr.ff.fit.dir, cat && { ...cat, smu: tr.ff.fit.smu });
    else add(known ? 'Gaia DR3 ' + fl.gaia.id : null, fl.label, '🔍', tr.pts, tr.total / (tr.days / 365.25), tr.dir, cat); });
  // v0.54: the catalogues' movers, in every field: Gaia DR3 stars and CatWISE2020 movers whose own motion takes them 1″ or
  // more between the first and last pass. Each is MEASURED in the passes on screen when it can be (the frame-by-frame track,
  // or the pass-by-pass patch track, kept only when it agrees with the catalogue and the catalogue shift is at least 1.5″);
  // otherwise its catalogue positions are shown and labelled "predicted", drawn dashed. Most fields have none: a typical
  // star moves 0.1-0.3″/yr, 3 % of a SPHEREx pixel (6 live fields: 0 to 1 Gaia star of 1″/yr or more each).
  const P = S.eps.length, days = P > 1 ? epMid(P - 1) - epMid(0) : 0, inField = p => p && p[0] >= 12 && p[1] >= 12 && p[0] <= f.n - 13 && p[1] <= f.n - 13;
  const dirOf = o => COMPASS[Math.round(((Math.atan2(o.pmra, o.pmdec) * 180 / Math.PI + 360) % 360) / 45) % 8];
  const catAdd = (o, name, src, pm, extra) => {
    const exp = S.eps.map((_, e) => { if (!frameOf(e)) return null; const p = ctAt(o, epMid(e)); return { e, ra: p[0], dec: p[1] }; }).filter(Boolean);
    if (exp.length < 2 || !exp.every(q => inField(F.skyToGrid(q.ra, q.dec, grid)))) return;
    const expTot = pm * days / 365.25; let passes = exp, how = 'predicted', mu = pm, smu = null;
    if (expTot >= 1.5) { const tr = trackOf(o);
      if (tr && satShare(tr.ff) > 0.5) extra = { ...extra, satNote: `${tr.ff.nSat} of ${tr.ff.nKept} images` };   // v0.55: saturated: stays "predicted"
      else if (tr && okFF(tr.ff) && Math.abs(tr.ff.fit.mu - pm) < Math.max(1, 0.3 * pm)) { passes = tr.ff.passes; how = 'measured'; mu = tr.ff.fit.mu; smu = tr.ff.fit.smu; }
      // the patch track only where the star is clearly there in every pass (S/N ≥ 5): its search starts at the catalogue
      // place, so on a source too faint to see it would only follow the catalogue (WISE 0855 at 4.7 µm, 2 images a pass)
      else if (tr && tr.pts.length >= 2 && Math.abs(tr.total - expTot) < Math.max(1.5, 0.4 * expTot) &&
        tr.pts.every(q => { const fr = frameOf(q.e), v = fr && F.snrAt(fr.flat, f.n, fr.st, q.x, q.y); return v != null && v >= 5; })) { passes = tr.pts; how = 'measured'; mu = tr.total / (tr.days / 365.25); } }
    // the field's NASA target, found through a catalogue (WISE 0855 through CatWISE): its own name
    const T = S.ct && CHALLENGE[S.ct]; if (T && T.pmra) { const q = ctAt(T, epMid(exp[0].e)), cd = Math.cos(q[1] * Math.PI / 180);
      if (Math.hypot((q[0] - exp[0].ra) * cd, q[1] - exp[0].dec) * 3600 < 9 && Math.hypot(T.pmra / 1000 - o.pmra / 1000, T.pmdec / 1000 - o.pmdec / 1000) < Math.max(0.5, 0.3 * pm)) name = `${T.name} (${name})`; }
    add(name, how === 'measured' ? 'known' : 'predicted', src, passes, mu, dirOf(o), { ...extra, pm, catPm: pm, how, smu });
  };
  if (P > 1 && GAIA.data) GAIA.data.stars.filter(s => s.pmra != null && gPm(s) * days / 365.25 >= 1).forEach(s => catAdd(gaiaObj(s), 'Gaia DR3 ' + s.id, '★ Gaia', gPm(s), { gaia: s }));
  if (P > 1 && CW.data) CW.src.filter(s => !s.twinOf && cwMover(s) && cwPm(s) * days / 365.25 >= 1).forEach(s => catAdd(cwObj(s), 'CatWISE ' + s.name, '◆ WISE', cwPm(s), { cw: s }));
  // nothing moves enough here: the field's fastest Gaia stars, as Gaia predicts them (clearly "too small to measure")
  if (P > 1 && !list.length && GAIA.data) GAIA.data.stars.filter(s => s.pmra != null && gPm(s) >= 0.1 && s.g < 17).sort((a, b) => gPm(b) - gPm(a)).slice(0, 3)
    .forEach(s => catAdd(gaiaObj(s), 'Gaia DR3 ' + s.id, '★ Gaia', gPm(s), { gaia: s, slow: true }));
  return list;
}
const movieCol = m => m.label === 'predicted' ? '#93c5fd' : m.label === 'known' || m.label === 'target' ? '#4ade80' : m.label === 'candidate' || m.label === 'unchecked' ? '#c4b5fd' : '#fbbf24';
// from where to where, in words: the first and last place shown for this mover
function movieFromTo(m) {
  const p0 = m.passes[0], p1 = m.passes[m.passes.length - 1], dE = (p1.ra - p0.ra) * Math.cos(p0.dec * Math.PI / 180) * 3600, dN = (p1.dec - p0.dec) * 3600, tot = Math.hypot(dE, dN);
  const dir = COMPASS[Math.round(((Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360) / 45) % 8], d = Math.round(epMid(p1.e) - epMid(p0.e));
  return `from ${fmtRaDec(p0.ra, p0.dec)} (pass ${p0.e + 1}, ${fmtMonth(S.eps[p0.e].t0)}) to ${fmtRaDec(p1.ra, p1.dec)} (pass ${p1.e + 1}, ${fmtMonth(S.eps[p1.e].t0)}): ${tot.toFixed(tot < 1 ? 2 : 1)}″ toward the ${dir} in ${d} days` +
    (tot < 6.2 ? ` (${(tot / 6.15).toFixed(2)} of a SPHEREx pixel)` : '');
}
function movieShowPass(e) {
  if (multi() && S.seq.length) { const i = S.seq.findIndex(x => x.e === e && !x.extra); S.ti = i >= 0 ? i : S.seq.findIndex(x => x.e === e); }
  S.ei = e; updateLabels(); markStrip(); refreshSoon();
}
function movieStep(d) {
  const P = S.eps.length, was = MOVIE.e; MOVIE.e = ((MOVIE.e + d) % P + P) % P; MOVIE.t0 = performance.now();
  if (d > 0 && MOVIE.e < was) MOVIE.fi++;   // v0.55: after a full run through the passes, the next mover (v0.56: on stage too, not only when following)
  movieShowPass(MOVIE.e); movieTiles(); if (MOVIE.follow) movieFollow();
}
// v0.55 follow: the view centres on one mover, zoomed so its whole track fills about a third of the screen
function movieFollow(first) {
  const m = movieStageMover(); if (!m || !S.al) return;   // v0.56: the mover on stage
  const ra = m.passes.map(q => q.ra), de = m.passes.map(q => q.dec), cd = Math.cos(de[0] * Math.PI / 180);
  const span = Math.max((Math.max(...ra) - Math.min(...ra)) * cd, Math.max(...de) - Math.min(...de));
  try { const fov = Math.max(0.025, Math.min(0.2, span * 3)); S.al.setFov(fov);
    // v0.56: on a wide screen the card covers the left side, so the mover goes in the middle of the sky that is left
    const cr = $('card') && !$('card').hidden && innerWidth > 700 ? $('card').getBoundingClientRect() : null, shift = cr && cr.left < 60 && cr.right < innerWidth * 0.6 ? cr.right / 2 : 0;
    S.al.gotoRaDec((Math.max(...ra) + Math.min(...ra)) / 2 + shift * (S.al.getFov()[0] / innerWidth) / cd, (Math.max(...de) + Math.min(...de)) / 2); } catch { /* keep the view */ }
  const lab = document.getElementById('mvlab'); if (lab && first !== undefined) lab.dataset.follow = m.name;
  refreshSoon();
}
// back to the view that shows every mover (as when the film started)
function movieFrame() {
  const ms = MOVIE.movers; if (!ms.length || !S.al) return; const ra = ms.map(m => m.passes[0].ra), de = ms.map(m => m.passes[0].dec), cd = Math.cos(S.field.dec * Math.PI / 180);
  try { S.al.gotoRaDec((Math.max(...ra) + Math.min(...ra)) / 2, (Math.max(...de) + Math.min(...de)) / 2); S.al.setFov(Math.min(S.field.size * 1.1, Math.max(0.08, 3.2 * Math.max((Math.max(...ra) - Math.min(...ra)) * cd, Math.max(...de) - Math.min(...de))))); } catch { /* keep */ }
  refreshSoon();
}
function moviePlay(on) {
  clearInterval(MOVIE.timer); MOVIE.timer = 0;
  if (on) MOVIE.timer = setInterval(() => { if (!MOVIE.on || MOVIE.run !== S.run || !(S.sel && S.sel.movie)) return movieStop(true); movieStep(1); }, MOVIE.step);   // another card opened: the film stops
  const b = document.getElementById('mvplay'); if (b) { b.textContent = on ? 'Pause' : 'Play'; b.setAttribute('aria-pressed', String(on)); }
}
function movieStop(keepCard) {
  clearInterval(MOVIE.timer); MOVIE.timer = 0; MOVIE.on = false;
  if (!keepCard) { const c = $('card'); if (S.sel && S.sel.movie) { S.sel = null; S.report ? showReport() : (c.hidden = true); } }
}
async function movieStart() {
  if (!S.field || S.eps.length < 2) { toast('An animation needs at least two passes of this field.', 5000); return; }
  movieStop(true);
  const c = $('card'), run = S.run;
  // v0.56: every search the film needs runs first, unless it already ran on this field: 🔍 bright stars, 🔭 deep search and
  // 🎯 motion scan (faint movers, all images added up along 625 trial motions), so bright and faint movers share one film
  const ran = R => R.res && R.res.run === S.run, todo = [[MS, '🔍 Find moving stars', motionSearch], [DS, '🔭 Deep search', deepSearch], [TSC, '🎯 Motion scan (faint stars)', motionScan]].filter(([R]) => !ran(R));
  if (todo.length) {
    c.replaceChildren(h('h3', {}, '🎬 Finding the moving stars first'), h('p', {}, `Running ${todo.map(t => t[1]).join(', then ')} on every pass of this field, then the film starts with every mover they find.`)); c.hidden = false;
    if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
    for (const [R, , fn] of todo) { await fn(); if (run !== S.run || R.stop) return; }   // v0.55 U9: Cancel stops the film too
  }
  // v0.54: the Gaia and WISE movers join the film, so both catalogues must be here (at most 45 s; without them the film
  // shows what the searches measured)
  await Promise.race([Promise.all([Promise.resolve(gaiaLoad()).catch(() => {}), Promise.resolve(cwLoad()).catch(() => {})]), sleep(45000)]); if (run !== S.run) return;
  await movieWarm(() => run === S.run); if (run !== S.run) return;
  Object.assign(MOVIE, { on: true, e: 0, t0: performance.now(), run: S.run, movers: movieMovers() });
  if (S.mode !== 'time') setMode('time');
  // zoom so that every mover is on screen (or the whole field when there is none)
  const ms = MOVIE.movers; if (ms.length) { const ra = ms.map(m => m.passes[0].ra), de = ms.map(m => m.passes[0].dec), cd = Math.cos(S.field.dec * Math.PI / 180);
    S.al.gotoRaDec((Math.max(...ra) + Math.min(...ra)) / 2, (Math.max(...de) + Math.min(...de)) / 2);
    S.al.setFov(Math.min(S.field.size * 1.1, Math.max(0.08, 3.2 * Math.max((Math.max(...ra) - Math.min(...ra)) * cd, Math.max(...de) - Math.min(...de))))); }   // room around them: the side panels cover the edges, and v0.54's stretched paths need room
  else S.al.gotoRaDec(S.field.ra, S.field.dec);
  // v0.54 phones: the card sheet covers the lower half of the sky, so the movers are put in the upper part (north is up)
  if (ms.length && innerWidth <= 700) { try { const c0 = S.al.getRaDec(), fv = S.al.getFov()[0]; S.al.gotoRaDec(c0[0], c0[1] - 0.22 * fv * innerHeight / innerWidth); } catch { /* keep the centre */ } }
  movieCard(); movieShowPass(0); movieTiles();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) moviePlay(true);
}
/* v0.55 line of epochs: for one mover, how far it is along its direction of motion in each pass (″, against the date),
   with each pass's error, and the straight line through them (weighted least squares). Dots on the line = steady motion.
   Frame-by-frame passes use their measured offsets with the parallax taken off (as the motion fit does); other tracks use
   their sky positions, without errors. Returns null when fewer than two passes are known. */
function epochLine(m) {
  const ps = m.passes.filter(q => q.ra != null); if (ps.length < 2) return null;
  const q0 = ps[0], cd = Math.cos(q0.dec * Math.PI / 180), t = q => (q.mjd ?? epMid(q.e)), T0 = t(q0);
  const pts = ps.map(q => { const ff = q.E != null && q0.E != null;
    const dE = ff ? (q.E - q.pE) - (q0.E - q0.pE) : (q.ra - q0.ra) * cd * 3600, dN = ff ? (q.N - q.pN) - (q0.N - q0.pN) : (q.dec - q0.dec) * 3600;
    return { q, yr: (t(q) - T0) / 365.25, dE, dN }; });
  const L = pts.at(-1), len = Math.hypot(L.dE, L.dN) || 1, uE = L.dE / len, uN = L.dN / len;
  pts.forEach(p => { p.s = p.dE * uE + p.dN * uN; p.err = p.q.sE != null ? Math.hypot(uE * p.q.sE, uN * p.q.sN) : null; });
  const w = pts.map(p => p.err ? 1 / (p.err * p.err) : 1), S0 = w.reduce((a, b) => a + b, 0), St = pts.reduce((a, p, i) => a + w[i] * p.yr, 0), Ss = pts.reduce((a, p, i) => a + w[i] * p.s, 0);
  const Stt = pts.reduce((a, p, i) => a + w[i] * p.yr * p.yr, 0), Sts = pts.reduce((a, p, i) => a + w[i] * p.yr * p.s, 0), D = S0 * Stt - St * St;
  const mu = D ? (S0 * Sts - St * Ss) / D : 0, b = D ? (Stt * Ss - St * Sts) / D : 0, hasErr = pts.every(p => p.err);
  const chi = hasErr && pts.length > 2 ? pts.reduce((a, p) => a + ((p.s - b - mu * p.yr) / p.err) ** 2, 0) : null;
  // the chart
  const W_ = 300, H_ = 128, Lm = 40, R = 26, T = 10, B = 26, ns = 'http://www.w3.org/2000/svg', el = (tg, a) => { const e = document.createElementNS(ns, tg); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const yrMax = Math.max(...pts.map(p => p.yr)) || 1, lo = Math.min(0, ...pts.map(p => p.s - (p.err || 0))), hi = Math.max(...pts.map(p => p.s + (p.err || 0))), pad = (hi - lo) * .12 || .5;
  const X = yr => Lm + yr / yrMax * (W_ - Lm - R), Y = s => T + (1 - (s - lo + pad) / (hi - lo + 2 * pad)) * (H_ - T - B);
  const svg = el('svg', { viewBox: `0 0 ${W_} ${H_}`, class: 'specsvg epc', role: 'img', 'aria-label': `${m.name}: distance moved along its direction in each pass, against the date, with a straight-line fit of ${mu.toFixed(2)}″ per year` });
  const ax = 'rgba(200,210,230,.35)', tx = { fill: 'rgba(220,228,240,.8)', 'font-size': 9.5, 'font-family': 'Inter,sans-serif' };
  svg.append(el('rect', { x: Lm, y: T, width: W_ - Lm - R, height: H_ - T - B, fill: 'none', stroke: ax }));
  const step = (hi - lo) > 8 ? 4 : (hi - lo) > 3 ? 1 : (hi - lo) > 1.2 ? .5 : .2;
  for (let v = Math.ceil((lo - pad) / step) * step; v <= hi + pad; v += step) { if (Y(v) < T || Y(v) > H_ - B) continue; const s_ = el('text', { x: Lm - 4, y: Y(v) + 3, 'text-anchor': 'end', ...tx }); s_.textContent = (Math.abs(v) < 1e-6 ? 0 : +v.toFixed(1)) + '″'; svg.append(s_); }
  const col = movieCol(m);
  svg.append(el('line', { x1: X(0), x2: X(yrMax), y1: Y(b), y2: Y(b + mu * yrMax), stroke: col, 'stroke-width': 1.6, 'stroke-dasharray': m.how === 'predicted' ? '5 4' : 'none', opacity: .9 }));
  for (const p of pts) { const x = X(p.yr);
    if (p.err) svg.append(el('line', { x1: x, x2: x, y1: Y(p.s - p.err), y2: Y(p.s + p.err), stroke: col, 'stroke-opacity': .6 }));
    const c = el('circle', { cx: x, cy: Y(p.s), r: 3.6, fill: col, 'data-e': p.q.e, stroke: 'rgba(2,4,10,.9)', 'stroke-width': 1 }); const ti = el('title', {}); ti.textContent = `Pass ${p.q.e + 1} · ${fmtMonth(S.eps[p.q.e].t0)} · ${p.s.toFixed(2)}″` + (p.err ? ` ± ${p.err.toFixed(2)}″` : ''); c.append(ti); svg.append(c);
    const lb = el('text', { x, y: H_ - B + 13, 'text-anchor': 'middle', ...tx }); lb.textContent = 'P' + (p.q.e + 1); svg.append(lb);
    const dt = el('text', { x, y: H_ - B + 23, 'text-anchor': 'middle', ...tx, 'font-size': 8, fill: 'rgba(200,210,230,.6)' }); dt.textContent = fmtMonth(S.eps[p.q.e].t0); svg.append(dt); }
  const note = `Each dot: how far it had gone along its path (toward the ${m.dir}) by that pass` + (hasErr ? ', with its measured error' : '') + `. The line through them: ${mu.toFixed(2)}″ per year.` +
    (chi != null ? ` The dots ${{ ok: 'sit on a straight line', high: 'sit near a straight line, with a little more scatter than their errors (past 95 %, within 99 %)', bad: 'scatter more than their errors allow: check it by eye' }[fitLevel(chi, pts.length - 2)]} (χ² ${chi.toFixed(1)} for ${pts.length - 2} degrees of freedom, UWE ${Math.sqrt(chi / (pts.length - 2)).toFixed(2)}).` : pts.length === 2 ? ' Two passes only: a straight line always fits; a third pass would test it.' : '') +
    (hasErr && pts.some(p => p.q.sE0 != null) && FLOOR.res ? ` The errors include ${FLOOR.res.floor.toFixed(2)}″ per pass that this field's images share (measured on ${FLOOR.res.refs} Gaia stars here).` : '') +
    (m.satNote ? ` Saturated in ${m.satNote}: not measured, the catalogue's motion is shown.` : '') +
    (pts.some(p => p.q.pE) ? ' Parallax taken off.' : '') + (m.how === 'predicted' ? ' These are the catalogue\'s predicted places, not measurements.' : '');
  return h('div', { class: 'epline' }, svg, h('p', { class: 'epnote' }, note));
}
function movieCard() {
  const c = $('card'), ms = MOVIE.movers; S.sel = { movie: true }; c.replaceChildren(); c.hidden = false;
  MOVIE.tiles = ms.slice(0, 6).map(m => {
    const cv = h('canvas', { width: 132, height: 132, class: 'mvcv', role: 'img', 'aria-label': `${m.name}, pass by pass` });
    return { m, cv, el: h('figure', { class: 'mvtile' }, cv, h('figcaption', {}, h('b', { style: `color:${movieCol(m)}` }, m.name), h('small', {}, ` ${m.mu.toFixed(1)}″/yr ${m.dir} · ${m.src}`))) };
  });
  const lab = h('p', { class: 'mvlab', id: 'mvlab' });
  c.append(h('h3', {}, '🎬 Moving stars, pass by pass'),
    h('p', {}, (() => { const meas = ms.filter(m => m.how !== 'predicted').length, pred = ms.length - meas, passTxt = `${S.eps.length} passes (${S.eps.map(ep => fmtMonth(ep.t0)).join(', ')})`;
      if (!ms.length) return `No moving star was found in this field, so the film shows the ${passTxt} with nothing marked: like most of the sky, every star here stays put.`;
      if (ms.every(m => m.slow)) return `No star here moves enough for SPHEREx to see: Gaia's fastest here move ${ms.map(m => m.catPm.toFixed(2) + '″').join(', ')} per year, a few hundredths of a SPHEREx pixel between the passes. The film shows where Gaia predicts them in each of the ${passTxt}, drawn much longer so the path can be seen (it says how much). SPHEREx cannot measure motions this small.`;
      return `${ms.length} moving star${ms.length === 1 ? '' : 's'} in this field, played through all ${passTxt}: ${meas} measured on the SPHEREx images (solid track)` + (pred ? `, ${pred} as the catalogue predicts it (dashed: too small or too faint to measure here)` : '') + '. A circle marks where each one was in every pass, numbered P1, P2…, so you can follow it from here to there.'; })()),
    lab,
    // v0.55 U5: save the film (GIF, WebM) and its movers (CSV, JSON)
    h('p', { class: 'mvexp' }, h('b', {}, 'Save: '), h('button', { type: 'button', id: 'mvgif', onclick: () => filmGif() }, '🎞 GIF'), ' ',
      window.MediaRecorder ? h('button', { type: 'button', id: 'mvwebm', onclick: () => filmWebm() }, '🎥 WebM') : null, ' ',
      h('button', { type: 'button', id: 'mvcsv', onclick: () => filmTable('csv') }, 'Movers CSV'), ' ', h('button', { type: 'button', id: 'mvjson', onclick: () => filmTable('json') }, 'Movers JSON')),
    h('div', { class: 'rpbar' }, h('button', { 'aria-label': 'Previous pass', onclick: () => { moviePlay(false); movieStep(-1); } }, '◀'),
      h('button', { class: 'hbtn rpplay', id: 'mvplay', 'aria-pressed': 'false', onclick: () => moviePlay(!MOVIE.timer) }, 'Play'),
      h('button', { 'aria-label': 'Next pass', onclick: () => { moviePlay(false); movieStep(1); } }, '▶'),
      h('button', { onclick: () => movieStop() }, 'Stop'),
      h('button', { id: 'mvspot', 'aria-pressed': String(MOVIE.spot), onclick: ev => { MOVIE.spot = !MOVIE.spot; ev.currentTarget.setAttribute('aria-pressed', String(MOVIE.spot)); ev.currentTarget.textContent = MOVIE.spot ? '🔦 Spotlight on' : '🔦 Spotlight off'; } }, MOVIE.spot ? '🔦 Spotlight on' : '🔦 Spotlight off'),
      // v0.55: motion only (the sky hidden: only the measured places, errors and tracks) and follow (the view goes mover by mover)
      h('button', { id: 'mvmo', 'aria-pressed': String(MOVIE.mo), title: 'Hide the sky and show only what moved: the place measured in each pass, its error and the track', onclick: ev => { MOVIE.mo = !MOVIE.mo; ev.currentTarget.setAttribute('aria-pressed', String(MOVIE.mo)); refreshSoon(); } }, '✦ Motion only'),
      ms.length ? h('button', { id: 'mvfol', 'aria-pressed': String(MOVIE.follow), title: 'Zoom to one mover at a time; the next one after each full run through the passes', onclick: ev => { MOVIE.follow = !MOVIE.follow; ev.currentTarget.setAttribute('aria-pressed', String(MOVIE.follow)); if (MOVIE.follow) movieFollow(true); else movieFrame(); movieTiles(); } }, '🎯 Follow') : null),
    ms.length ? h('div', { class: 'mvgrid' }, ...MOVIE.tiles.map(t => t.el)) : null,
    ms.length > 6 ? h('p', { style: 'font-size:.8rem' }, `The first 6 are shown as cut-outs; all ${ms.length} are animated on the sky.`) : null,
    ms.length ? h('ul', { class: 'mslist' }, ...ms.map((m, i) => h('li', {}, h('b', { style: `color:${movieCol(m)}` }, `${i + 1}. ${m.name}`), ` ${m.mu.toFixed(2)}″ per year toward the ${m.dir} (found by ${m.src}); `,
      h('span', { class: 'badge ' + (m.label === 'target' ? 'ok' : m.label === 'predicted' ? 'near' : msLabel(m)[0]) }, m.label === 'target' ? '✓ Known mover: the NASA target' : m.label === 'predicted' ? (m.satNote ? `Too bright for SPHEREx (saturated in ${m.satNote}): ${m.src.replace(/^\S+ /, '')}'s motion shown, ${m.catPm.toFixed(2)}″/yr` : `Predicted by ${m.src.replace(/^\S+ /, '')} (${m.catPm.toFixed(2)}″/yr): ${m.slow ? 'too small' : 'too faint or too small'} for SPHEREx to measure here`) : m.how === 'measured' && m.catPm != null ? `✓ Measured here${m.smu ? ` (${m.mu.toFixed(2)} ± ${m.smu.toFixed(2)}″/yr, every image)` : ''}; ${m.src.replace(/^\S+ /, '')} agrees (${m.catPm.toFixed(2)}″/yr)` : msLabel(m)[1]),
      h('div', { style: 'font-size:.82rem;margin-top:2px' }, (m.how === 'predicted' ? 'Predicted ' : 'Moved ') + movieFromTo(m) + '.'),
      movieCat(m) ? catRow(movieCat(m)) : null,   // v0.55 U4
      flagRow(m.passes.filter(q => q.g).map(q => ({ e: q.e, x: q.g[0], y: q.g[1] }))),   // v0.55 U6
      epochLine(m)))) : null,   // v0.55: the line of epochs
    h('p', { style: 'font-size:.78rem;color:var(--dust)' }, 'Solid track: measured on the SPHEREx images (each image lined up on Gaia, the star fitted in it). Dashed track: where Gaia or WISE (CatWISE2020) predicts it, because it is too small or too faint to measure here. A circle per pass, P1, P2…: where it was in that pass. Cut-outs: true scale, 6.2″ pixels, the same window and brightness in every pass; dots = its measured place in each pass, ring = this pass. On the sky the paths are drawn longer when zoomed out (it says how much), because a few ″ is less than a screen pixel there. Spotlight: the rest of the sky is dimmed so the movers and their glowing tracks stand out (the arrow shows the direction of motion; nothing in the images is changed). A candidate is something to check, never a discovery claim.'),
    h('p', {}, h('button', { onclick: movieStart }, '↻ Find again and replay')));
  if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
}
/* ---------- v0.55 U5: export ----------
   The film as a GIF (the Discovery card's own frame painter and GIF worker, one frame per pass, cropped on the film's main
   mover) or WebM (the same frames played into MediaRecorder, no library); the film's movers as CSV/JSON (passes, positions,
   μ ± σ, the catalogue and the U4 verdict); a PNG of the sky as on screen. Everything is made on the viewer's device. */
const EXP = { busy: false, last: null };
function saveBlob(blob, name) {
  const u = URL.createObjectURL(blob), a = h('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 8000);
  EXP.last = { name, size: blob.size, type: blob.type }; toast(`Saved ${name} (${blob.size >= 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1024)) + ' kB'})`, 4000);
}
const expSlug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field';
// one mover's SPHEREx vs catalogue numbers, as the film card's row shows them (null: nothing measured to compare)
function movieCat(m) {
  if (m.how !== 'measured' || (m.catPm ?? m.pm) == null) return null;
  return { mu: m.mu, smu: m.smu ?? null, catMu: m.catPm ?? m.pm, catSmu: m.cw ? cwSig(m.cw) : null,
    cat: m.cw || /WISE/.test(m.src) ? 'CatWISE2020' : m.gaia || /Gaia/.test(m.src) ? 'Gaia DR3' : m.label === 'target' ? 'published value' : null };
}
// the film as card frames: one per pass, cropped on its main mover (the NASA target, else the first measured one)
function filmPlan() {
  if (!S.field || !MOVIE.on) return null;
  const ms = MOVIE.movers, n = S.field.n, main = ms.find(m => m.label === 'target') || ms.find(m => m.how === 'measured') || ms[0];
  let cx = (n - 1) / 2, cy = cx, half = n / 2;
  const gs = main ? main.passes.map(q => q.g).filter(Boolean) : [];
  if (gs.length) { const xs = gs.map(p => p[0]), ys = gs.map(p => p[1]); cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    half = Math.max(30, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 18); }
  half = Math.min(n / 2, half);
  const short = m => m.name.replace(/^Gaia DR3 (\d{4})\d+/, 'Gaia $1…').replace(/ \(.*\)$/, '');
  const frames = S.eps.map((_, e) => { const fr = frameOf(e), im = chosen(e); if (!fr || !im) return null;
    // v0.56: the main mover is on stage, as in the film: spotlight, the pass before as a dashed ghost with its date, a
    // ring locking on to this pass's place and the dated "here → there" callout
    const ci = main ? main.passes.findIndex(q => q.e === e && q.g) : -1, pq = ci > 0 && main.passes[ci - 1].g ? main.passes[ci - 1] : null;
    const stage = ci >= 0 ? { col: movieCol(main), cur: { x: main.passes[ci].g[0], y: main.passes[ci].g[1] }, prev: pq && { x: pq.g[0], y: pq.g[1], date: movieDate(pq) },
      lines: movieStageLines(main, ci, pq ? ci - 1 : -1, short(main), movieCol(main)) } : null;
    const marks = ms.flatMap(m => { const now = m.passes.find(q => q.e === e && q.g), col = movieCol(m);
      return [...m.passes.filter(q => q.e < e && q.g).map(q => ({ x: q.g[0], y: q.g[1], color: col, plus: true })), ...(now && !(stage && m === main) ? [{ x: now.g[0], y: now.g[1], color: col, label: ms.length <= 3 ? short(m) : null }] : [])]; });
    return { stage, fr, top: `Pass ${e + 1}`, sub: `${fmtMonth(S.eps[e].t0)} · ${lamOf(im).toFixed(2)} µm` + (fr.stack ? ` · median of ${fr.stack} images` : ''), marks, mjd: im.mjd, lam: lamOf(im) }; }).filter(Boolean);
  const c = main && movieCat(main), cmp = c && catCmp(c), sky = F.gridToSky(cx, cy, cardGrid());
  const badge = !main ? ['Nothing here moves enough to see', '#9b8cff'] : main.label === 'target' ? ['✓ Known mover: the NASA target', '#5ff0a0'] : main.how === 'predicted' ? ['Catalogue prediction: too small to measure here', '#93c5fd']
    : cmp ? (cmp.result === 'agrees' ? [`✓ Measured; ${c.cat || 'the catalogue'} agrees`, '#5ff0a0'] : [`Measured; ${c.cat || 'the catalogue'} differs`, '#ffb05a']) : ['Unconfirmed candidate', '#9b8cff'];
  return { title: main ? main.name : 'SPHEREx sky over time', badge, cx, cy, half, frames, ra: sky[0], dec: sky[1], slug: 'film-' + (main ? main.name : 'field'),
    credit: 'Images: NASA SPHEREx via IRSA · Motions: ARCNAVE, Gaia DR3, CatWISE2020 · False colour',
    fact: main ? `${main.mu.toFixed(2)}${main.smu ? ' ± ' + main.smu.toFixed(2) : ''}″ per year toward the ${main.dir} · ${ms.length} mover${ms.length === 1 ? '' : 's'} in the film` : `${frames.length} passes · no mover`,
    note: 'Real SPHEREx images, one per pass. Spotlight: dashed circle = the pass before, ring = this pass, both dated. Other rings: this pass; +: passes before.' + (main && main.how === 'predicted' ? ' Positions are the catalogue\'s prediction, not a measurement.' : '') + ' Not a discovery claim.' };
}
async function filmFrames(plan) {
  try { await document.fonts.ready; } catch { /* fallback fonts */ }
  const cv = document.createElement('canvas'); cv.width = CARD.W; cv.height = CARD.H; return { cv, g: cv.getContext('2d', { willReadFrequently: true }) };
}
async function filmGif() {
  if (EXP.busy) return; const plan = filmPlan();
  if (!plan || plan.frames.length < 2) { toast('The film needs at least two passes with images loaded.'); return; }
  EXP.busy = true; toast('Making the film GIF...', 8000);
  try { const { g } = await filmFrames(plan), frames = [];
    // v0.56: between passes the spotlit mover glides (3 short frames) and its ring locks on (2), then the pass holds
    const push = delay => frames.push({ rgba: g.getImageData(0, 0, CARD.W, CARD.H).data, delay });
    for (let i = 0; i < plan.frames.length; i++) { const tw = i > 0 && plan.frames[i].stage && plan.frames[i].stage.prev;
      if (tw) { for (const k of [0, 0.35, 0.7]) { drawCardFrame(g, plan, i, { k, lock: 0 }); push(120); } for (const lock of [0.35, 0.7]) { drawCardFrame(g, plan, i, { k: 1, lock }); push(90); } }
      drawCardFrame(g, plan, i); push(i === plan.frames.length - 1 ? 1700 : 1000); }
    const gif = await encodeGif({ width: CARD.W, height: CARD.H, frames });
    showCardDialog(plan, new Blob([gif], { type: 'image/gif' })); $('toast').hidden = true;
    EXP.last = { name: CARD.last && CARD.last.name, size: gif.length, type: 'image/gif', frames: plan.frames.length };
  } catch (e) { console.error(e); toast('Could not make the GIF: ' + e.message); }
  EXP.busy = false;
}
async function filmWebm() {
  if (EXP.busy) return; const plan = filmPlan();
  if (!plan || plan.frames.length < 2) { toast('The film needs at least two passes with images loaded.'); return; }
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!type) { toast('This browser cannot record video. Save the GIF instead.'); return; }
  EXP.busy = true; toast('Recording the film (a few seconds)...', 12000);
  try { const { cv, g } = await filmFrames(plan), rec = new MediaRecorder(cv.captureStream(30), { mimeType: type, videoBitsPerSecond: 3e6 }), parts = [];
    rec.ondataavailable = ev => { if (ev.data && ev.data.size) parts.push(ev.data); };
    const done = new Promise(r => { rec.onstop = r; });
    drawCardFrame(g, plan, 0); rec.start(250);
    for (let loop = 0; loop < 2; loop++) for (let i = 0; i < plan.frames.length; i++) {
      // v0.56: the glide and the lock-on drawn in real time (~30 frames a second), then the pass holds
      const tw = i > 0 && plan.frames[i].stage && plan.frames[i].stage.prev, t0 = performance.now(), A = 450, B = 300;
      if (tw) for (let t = 0; t < A + B; t = performance.now() - t0) { drawCardFrame(g, plan, i, { k: Math.min(1, t / A), lock: Math.max(0, (t - A) / B) }); await sleep(33); }
      drawCardFrame(g, plan, i); await sleep(i === plan.frames.length - 1 ? 1700 : 1000); }
    rec.stop(); await done;
    saveBlob(new Blob(parts, { type: 'video/webm' }), `arcnave-${expSlug(plan.slug)}-${plan.ra.toFixed(3)}_${plan.dec.toFixed(3)}.webm`);
    EXP.last.frames = plan.frames.length;
  } catch (e) { console.error(e); toast('Could not record the video: ' + e.message); }
  EXP.busy = false;
}
// the film's movers: every pass of every mover, with μ ± σ, the catalogue's motion and the U4 verdict
function filmRows() {
  return MOVIE.movers.map((m, i) => { const c = movieCat(m), cmp = c ? catCmp(c) : null;
    return { mover: i + 1, name: m.name, label: m.label, foundBy: m.src, how: m.how, muArcsecPerYr: +m.mu.toFixed(4), muErr: m.smu != null ? +m.smu.toFixed(4) : null, direction: m.dir,
      catalogue: c ? c.cat : (m.how === 'predicted' ? m.src.replace(/^\S+ /, '') : null), catMuArcsecPerYr: c ? +c.catMu.toFixed(4) : m.catPm != null ? +m.catPm.toFixed(4) : null, catMuErr: c && c.catSmu ? +c.catSmu.toFixed(4) : null,
      verdict: cmp ? cmp.result : 'unchecked', difference: cmp && cmp.diff != null ? +cmp.diff.toFixed(4) : null, limit: cmp && cmp.lim != null ? +cmp.lim.toFixed(4) : null,
      passes: m.passes.map(q => ({ pass: q.e + 1, midMjd: +epMid(q.e).toFixed(4), date: fmtDay(epMid(q.e)), ra: +q.ra.toFixed(7), dec: +q.dec.toFixed(7) })) }; });
}
function filmTable(kind) {
  if (!MOVIE.on) { toast('Play the film first (Motion › Animate).'); return; }
  const rows = filmRows(), f = S.field, base = `arcnave_film_movers_${f.ra.toFixed(3)}_${f.dec.toFixed(3)}`;
  if (kind === 'json') { saveBlob(new Blob([JSON.stringify({ tool: 'ARCNAVE', version: '0.58.0', made: new Date().toISOString(), field: { ra: f.ra, dec: f.dec },
    passes: S.eps.map((ep, e) => ({ pass: e + 1, midMjd: +epMid(e).toFixed(4), month: fmtMonth(ep.t0) })),
    rule: 'verdict: agrees when |SPHEREx − catalogue| < max(3·√(σ² + σcat²), 0.3·μcat, 0.5″/yr); unchecked when nothing was measured to compare',
    note: 'how = measured: on the SPHEREx images; predicted: the catalogue\'s positions. A candidate is something to check, never a discovery claim.', movers: rows }, null, 2)], { type: 'application/json' }), base + '.json'); return; }
  const q = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const head = ['mover', 'name', 'label', 'found_by', 'how', 'mu_arcsec_yr', 'mu_err', 'direction', 'catalogue', 'cat_mu_arcsec_yr', 'cat_mu_err', 'verdict', 'pass', 'pass_mid_mjd', 'date', 'ra_deg', 'dec_deg'];
  const lines = rows.flatMap(r => r.passes.map(p => [r.mover, r.name, r.label, r.foundBy, r.how, r.muArcsecPerYr, r.muErr, r.direction, r.catalogue, r.catMuArcsecPerYr, r.catMuErr, r.verdict, p.pass, p.midMjd, p.date, p.ra, p.dec].map(q).join(',')));
  saveBlob(new Blob([head.join(',') + '\n' + lines.join('\n') + '\n'], { type: 'text/csv' }), base + '.csv');
}
// the sky as on screen: Aladin's background (when it can be read) with ARCNAVE's layer on top, and a caption strip
async function skyPng() {
  if (!S.field) { toast('Open a patch of sky first.'); return; }
  const w = ov.width, hh = ov.height, cap = Math.round(30 * dpr), cv = document.createElement('canvas'); cv.width = w; cv.height = hh + cap;
  const g = cv.getContext('2d'); g.fillStyle = '#05070f'; g.fillRect(0, 0, w, hh + cap);
  try { const url = await S.al.getViewDataURL({ format: 'image/png' }), img = new Image(); img.src = url; await img.decode(); g.drawImage(img, 0, 0, w, hh); } catch { /* the SPHEREx layer alone */ }
  g.drawImage(ov, 0, 0);
  const [ra, dec] = S.al.getRaDec(), fov = S.al.getFov()[0], e = S.mode === 'time' && S.seq.length ? seqAt().e : Math.min(S.ei || 0, S.eps.length - 1);
  g.fillStyle = '#eef1f7'; g.font = `600 ${Math.round(12 * dpr)}px Archivo, system-ui, sans-serif`; g.textBaseline = 'middle';
  cardText(g, `ARCNAVE · RA ${ra.toFixed(4)}° Dec ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(4)}° · ${fov.toFixed(2)}° wide · ${S.eps.length ? epLabel(e) : ''} · real NASA SPHEREx images via IRSA, false colour`, Math.round(10 * dpr), hh + cap / 2, w - 20 * dpr);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  if (!blob) { toast('Could not make the picture.'); return; }
  saveBlob(blob, `arcnave_sky_${ra.toFixed(3)}_${dec.toFixed(3)}.png`); EXP.last.w = w; EXP.last.h = hh + cap;
}
if ($('pngb')) $('pngb').onclick = () => skyPng();
function movieTiles() {
  const lab = document.getElementById('mvlab'), e = MOVIE.e, P = S.eps.length;
  if (lab) lab.textContent = `Pass ${e + 1} of ${P} · ${fmtMonth(S.eps[e].t0)}` + (e ? ` · ${Math.round(epMid(e) - epMid(0))} days after the first` : ' · the start') +
    (() => { const sm = movieStageMover(); return sm ? ` · ${MOVIE.follow ? 'following' : 'in the spotlight'}: ${sm.name}` : ''; })();
  // v0.55: the line of epochs marks the pass on screen
  document.querySelectorAll('#card .epc circle[data-e]').forEach(c => { const on = +c.dataset.e === e; c.setAttribute('r', on ? 5.6 : 3.6); c.setAttribute('stroke', on ? '#ffffff' : 'rgba(2,4,10,.9)'); c.setAttribute('stroke-width', on ? 2 : 1); });
  const fr = frameOf(e), n = S.field.n; if (!fr) return;
  for (const t of MOVIE.tiles) {
    const g = t.cv.getContext('2d'), SZ = t.cv.width, W = 21, pts = t.m.passes.filter(q => q.g), cx = pts.reduce((s, q) => s + q.g[0], 0) / pts.length, cy = pts.reduce((s, q) => s + q.g[1], 0) / pts.length;
    const x0 = Math.round(cx) - (W >> 1), y0 = Math.round(cy) - (W >> 1), sc = SZ / W, px = seeOf(fr), soft = 3 * fr.st.sigma;
    if (t.top == null) { let top = 0; for (let k = 0; k < P; k++) { const f2 = frameOf(k); if (!f2) continue; const v = F.sampleMax(seeOf(f2), n, cx, cy) - f2.st.med; if (v > top) top = v; } t.top = top; }
    const tp = Math.asinh(Math.max(t.top, 10 * fr.st.sigma) / soft), img = new ImageData(W, W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const X = x0 + x, Y = y0 + y, v = X >= 0 && Y >= 0 && X < n && Y < n ? px[Y * n + X] - fr.st.med : NaN;
      const tt = Number.isFinite(v) ? Math.max(0, Math.min(1, Math.asinh(Math.max(v, 0) / soft) / tp)) : 0, o = (y * W + x) * 4;
      img.data[o] = 40 + 215 * tt; img.data[o + 1] = 30 + 200 * tt * tt + 25 * tt; img.data[o + 2] = 60 + 150 * tt; img.data[o + 3] = 255; }
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = W; tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false; g.drawImage(tmp, 0, 0, SZ, SZ);
    const Pp = q => [(q.g[0] - x0 + 0.5) * sc, (q.g[1] - y0 + 0.5) * sc], col = movieCol(t.m), done = pts.filter(q => q.e <= e), cur = pts.find(q => q.e === e);
    g.fillStyle = 'rgba(255,255,255,.35)'; pts.forEach(q => { const [x, y] = Pp(q); g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); });
    if (done.length > 1) { g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); done.forEach((q, k) => { const [x, y] = Pp(q); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
    if (cur) { const [x, y] = Pp(cur); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(x, y, Math.max(6, 1.1 * sc), 0, 7); g.stroke(); }
    g.fillStyle = 'rgba(5,7,14,.7)'; g.fillRect(0, 0, SZ, 16); g.fillStyle = '#e6fffb'; g.font = '600 10px Inter,system-ui,sans-serif'; g.fillText(`Pass ${e + 1} · ${fmtMonth(S.eps[e].t0)}`, 4, 11);
  }
}
/* v0.56 on stage: the film tells one mover's story at a time, "here on this date, and by the next pass it had gone there".
   A spotlight beam falls on it, the place of the pass before stays as a dashed ghost circle with its date, the marker
   glides to the new place and a ring locks on to it, and a callout gives both dates and the true shift (″, measured
   positions; the drawn path may be stretched, the numbers never are). */
// the order on stage: the NASA target, then what SPHEREx measured, then catalogue predictions (the film's own order otherwise)
function movieStageList() { const rk = m => m.label === 'target' ? 0 : m.how === 'predicted' ? 2 : 1; return MOVIE.movers.filter(m => m.passes.length >= 2).map((m, j) => [m, j]).sort((a, b) => rk(a[0]) - rk(b[0]) || a[1] - b[1]).map(x => x[0]); }
function movieStageMover() { const ms = movieStageList(); return ms.length ? ms[MOVIE.fi % ms.length] : null; }
function movieShift(a, b) {   // from pass a to pass b of one mover, on the sky: ″, direction, days
  const cd = Math.cos(a.dec * Math.PI / 180), dE = (b.ra - a.ra) * cd * 3600, dN = (b.dec - a.dec) * 3600, d = Math.hypot(dE, dN);
  return { d, dir: COMPASS[Math.round(((Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360) / 45) % 8], days: Math.round((b.mjd ?? epMid(b.e)) - (a.mjd ?? epMid(a.e))) };
}
const movieDate = q => fmtDay(q.mjd ?? epMid(q.e));
const fmtShift = d => d.toFixed(d < 1 ? 2 : 1) + '″';
// where the "was here" label goes: beside the old place, on the side away from the new one, so the ring never covers it
function awayLabel(p, to, r) {
  const dx = p[0] - to[0], dy = p[1] - to[1], d = Math.hypot(dx, dy), ux = d > 2 ? dx / d : 0, uy = d > 2 ? dy / d : 1;
  return Math.abs(ux) > 0.5 ? [p[0] + ux * r, p[1] + uy * r + 4, ux > 0 ? 'left' : 'right'] : [p[0], p[1] + uy * (r + 6) + 4, 'center'];
}
// the callout's lines for pass index ci of mover m (pi: the pass before, -1 on its first pass): [text, colour, font?]
function movieStageLines(m, ci, pi, title, col) {
  const ps = m.passes, cur = ps[ci], last = ps[ps.length - 1], first = ps[0], lines = [[title, col, '700 12px']];
  if (pi >= 0) { const s = movieShift(ps[pi], cur);
    lines.push([`P${ps[pi].e + 1} · ${movieDate(ps[pi])}: here (dashed circle)`, 'rgba(230,236,245,.9)'], [`P${cur.e + 1} · ${movieDate(cur)}: there (ring)`, '#ffffff'],
      [`moved ${fmtShift(s.d)} toward the ${s.dir} in ${s.days} days`, col]); }
  else { const s = movieShift(first, last);
    lines.push([`P${first.e + 1} · ${movieDate(first)}: it starts here`, '#ffffff'], [`by P${last.e + 1} · ${movieDate(last)}: ${fmtShift(s.d)} to the ${s.dir}`, col]); }
  if (m.how === 'predicted') lines.push(['catalogue prediction, not measured here', 'rgba(147,197,253,.95)']);
  return lines;
}
function movieStage(g, now, k) {
  const { m, i, col, qs, es, head, ci, pi } = g, dpr = window.devicePixelRatio || 1, cw = ctx.canvas.width / dpr, ch = ctx.canvas.height / dpr;
  const lock = Math.max(0, Math.min(1, (now - MOVIE.t0 - 0.45 * MOVIE.step) / (0.3 * MOVIE.step))), arrived = k >= 1;
  ctx.save();
  // 1. the spotlight beam: a soft cone from above the screen onto the mover, and a pool of light around it
  if (MOVIE.spot && !MOVIE.mo) {
    const src = [head[0] * 0.55 + cw * 0.225, -60], bx = head[0] - src[0], by = head[1] - src[1], bl = Math.hypot(bx, by) || 1, nx = -by / bl, ny = bx / bl, R = 34;
    ctx.globalCompositeOperation = 'lighter';
    const lg = ctx.createLinearGradient(src[0], src[1], head[0], head[1]); lg.addColorStop(0, 'rgba(255,244,214,0)'); lg.addColorStop(0.75, 'rgba(255,244,214,.05)'); lg.addColorStop(1, 'rgba(255,244,214,.11)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(src[0] - nx * 6, src[1] - ny * 6); ctx.lineTo(src[0] + nx * 6, src[1] + ny * 6); ctx.lineTo(head[0] + nx * R, head[1] + ny * R); ctx.lineTo(head[0] - nx * R, head[1] - ny * R); ctx.closePath(); ctx.fill();
    const rg = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], R * 1.25); rg.addColorStop(0, 'rgba(255,244,214,.16)'); rg.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(head[0], head[1], R * 1.25, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  // 2. where it was in the pass before: a dashed ghost circle with that pass's date
  const lab = (t, x, y, c, al = 'left') => { ctx.textAlign = al; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(2,4,10,.9)'; ctx.strokeText(t, x, y); ctx.fillStyle = c; ctx.fillText(t, x, y); ctx.textAlign = 'start'; };
  ctx.font = '600 11px Inter,system-ui,sans-serif';
  if (pi >= 0) { const p = qs[pi]; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(p[0], p[1], 15, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    const [lx, ly, la] = awayLabel(p, qs[ci], 22); lab(`was here · ${movieDate(m.passes[pi])}`, lx, ly, 'rgba(255,255,255,.85)', la); }
  // 3. the marker on its way, then a ring that locks on to the new place (an arc that closes and tightens, with ticks)
  if (!arrived) { ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.setLineDash([5, 5]); ctx.lineDashOffset = -now / 40; ctx.beginPath(); ctx.arc(head[0], head[1], 26, 0, 7); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0; }
  else { const r = 13 + 20 * (1 - lock) * (1 - lock), a0 = -Math.PI / 2;
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(head[0], head[1], r, a0, a0 + 2 * Math.PI * Math.max(0.02, lock)); ctx.stroke(); ctx.restore();
    if (lock >= 1) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6; for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.beginPath(); ctx.moveTo(head[0] + ux * 16, head[1] + uy * 16); ctx.lineTo(head[0] + ux * 22, head[1] + uy * 22); ctx.stroke(); } } }
  // 4. the callout: name, both dates and the true shift between them
  const lines = movieStageLines(m, ci, pi, `${i + 1} ${m.name}`, col);
  const fade = Math.min(1, 0.25 + k * 1.2), lh = 15, pad = 8;
  ctx.font = '600 11px Inter,system-ui,sans-serif'; let wmax = 0; for (const [t, , f] of lines) { ctx.font = (f || '600 11px') + ' Inter,system-ui,sans-serif'; wmax = Math.max(wmax, ctx.measureText(t).width); }
  const bw = wmax + 2 * pad, bh = lines.length * lh + pad + 2;
  const [fl, fr] = movieFreeX(cw);   // v0.56.1: keep the callout on the sky the panels leave visible (it slid under the right card)
  let bx = head[0] + 30, by = head[1] - bh - 18; if (bx + bw > fr) bx = head[0] - 30 - bw; if (bx < fl) bx = fl; if (bx + bw > fr) bx = Math.max(fl, fr - bw); if (by < 96) by = head[1] + 28; if (by + bh > ch - 8) by = ch - 8 - bh;
  ctx.globalAlpha = fade; ctx.fillStyle = 'rgba(5,8,15,.86)'; ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
  const ax = Math.max(bx, Math.min(bx + bw, head[0])), ay = by + bh < head[1] ? by + bh : by;   // a leader line to the ring
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(head[0] + (ax - head[0]) * 14 / (Math.hypot(ax - head[0], ay - head[1]) || 1), head[1] + (ay - head[1]) * 14 / (Math.hypot(ax - head[0], ay - head[1]) || 1)); ctx.stroke();
  lines.forEach(([t, c, f], j) => { ctx.font = (f || '600 11px') + ' Inter,system-ui,sans-serif'; ctx.fillStyle = c; ctx.fillText(t, bx + pad, by + pad + 9 + j * lh); });
  ctx.restore();
}
// v0.56.1: the part of the overlay canvas (x, CSS px) not covered by the controls panel or the card beside it
function movieFreeX(cw) {
  let L = 8, R = cw - 8; const cv = ctx.canvas.getBoundingClientRect();
  for (const el of [document.querySelector('section.panel'), document.querySelector('.rdock'), $('card'), $('lab')]) {
    if (!el || el.hidden) continue; const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < cv.top + 40 || r.top > cv.bottom - 40) continue;
    const l = r.left - cv.left, rr = r.right - cv.left;
    if (rr < cw / 2 && rr + 8 > L) L = rr + 8; else if (l > cw / 2 && l - 8 < R) R = l - 8;
  }
  return R - L > 160 ? [L, R] : [8, cw - 8];
}
function drawMovie() {
  if (!MOVIE.on) return; if (MOVIE.run !== S.run) { movieStop(true); return; }
  const ms = MOVIE.movers, e = MOVIE.e, k = Math.min(1, (performance.now() - MOVIE.t0) / (0.45 * MOVIE.step)), ease = k * k * (3 - 2 * k);
  ctx.save();
  // paths are measured in ″: when they are shorter than ~40 screen px, draw them longer by one stated factor
  const scr = ms.map(m => m.passes.map(q => proj(q.ra, q.dec))).map(a => a.every(Boolean) ? a : null);
  const Lmax = Math.max(0, ...scr.filter(Boolean).map(a => Math.hypot(a[a.length - 1][0] - a[0][0], a[a.length - 1][1] - a[0][1])));
  const Fx = Lmax > 0 && Lmax < 70 ? Math.max(2, Math.min(300, Math.round(110 / Lmax))) : 1;   // v0.54: room for a circle per pass (was < 40 px → 60 px)
  // every mover's screen path (drawn Fx longer when needed), the part done so far, and where its marker is now
  const now = performance.now(), geo = ms.map((m, i) => {
    const a = scr[i]; if (!a) return null; const P0 = a[0], qs = a.map(p => [P0[0] + Fx * (p[0] - P0[0]), P0[1] + Fx * (p[1] - P0[1])]), es = m.passes.map(q => q.e);
    const ci = es.indexOf(e), pi = es.lastIndexOf(es.filter(x => x < e).pop());
    const from = ci >= 0 && pi >= 0 && ci > 0 ? qs[pi] : ci >= 0 ? qs[ci] : null, to = ci >= 0 ? qs[ci] : null;
    const head = to ? [from[0] + (to[0] - from[0]) * ease, from[1] + (to[1] - from[1]) * ease] : null;
    const upto = qs.filter((_, j) => es[j] < e); if (head) upto.push(head);
    return { m, i, col: movieCol(m), qs, es, head, upto, ci, pi: ci > 0 ? pi : -1 };
  }).filter(Boolean);
  // v0.56: one mover is "on stage" at a time (the followed one, else the next one after each full run): it gets the
  // spotlight beam, the lock-on ring and the dated "was here → now here" callout
  const stage = geo.length ? (geo.find(g => g.m === movieStageMover()) || geo[0]) : null;
  // v0.55 motion only: the sky is hidden, so what is left is what moved: the measured places, their errors and the tracks
  if (MOVIE.mo) { const dp = window.devicePixelRatio || 1; ctx.fillStyle = 'rgba(1,2,6,.94)'; ctx.fillRect(0, 0, ctx.canvas.width / dp, ctx.canvas.height / dp); }
  // one ″ on screen (for the error circles, which are drawn Fx larger like the paths, so they stay true to them)
  const ppa = (() => { const q = ms[0] && ms[0].passes[0], a = q && proj(q.ra, q.dec), b = q && proj(q.ra, q.dec + 1 / 3600); return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0; })();
  // v0.51 spotlight: the sky dims except soft pools of light along each mover's track so far and around where it is now
  if (MOVIE.spot && !MOVIE.mo && geo.length) {
    const dpr = window.devicePixelRatio || 1, cw = ctx.canvas.width / dpr, ch = ctx.canvas.height / dpr, R = 46;
    const off = MOVIE.off || (MOVIE.off = document.createElement('canvas')); if (off.width !== Math.ceil(cw) || off.height !== Math.ceil(ch)) { off.width = Math.ceil(cw); off.height = Math.ceil(ch); }
    const o = off.getContext('2d'); o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, off.width, off.height); o.fillStyle = 'rgba(2,4,10,.62)'; o.fillRect(0, 0, off.width, off.height);
    o.globalCompositeOperation = 'destination-out';
    for (const g of geo) {
      if (g.upto.length > 1) { o.strokeStyle = 'rgba(0,0,0,.85)'; o.lineWidth = R * 1.1; o.lineCap = o.lineJoin = 'round'; o.beginPath(); g.upto.forEach((p, j) => j ? o.lineTo(...p) : o.moveTo(...p)); o.stroke(); }
      const c = g.head || g.qs[0], rg = o.createRadialGradient(c[0], c[1], 0, c[0], c[1], R * 1.6);
      rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(0.55, 'rgba(0,0,0,.95)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      o.fillStyle = rg; o.beginPath(); o.arc(c[0], c[1], R * 1.6, 0, 7); o.fill();
    }
    ctx.drawImage(off, 0, 0, cw, ch);
  }
  for (const g of geo) {
    const { m, i, col, qs, es, head, upto } = g;
    // where it is going: faint dashes through every pass, a dot per pass (filled once reached)
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.3; ctx.setLineDash([4, 5]); ctx.beginPath(); qs.forEach((p, j) => j ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.stroke(); ctx.setLineDash([]);
    // the track so far: a glowing line up to the gliding marker, with an arrowhead showing the direction of motion
    const pred = m.how === 'predicted';   // v0.54: a catalogue prediction, not a measurement: dashed
    if (upto.length > 1) {
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 12; ctx.strokeStyle = col; ctx.lineWidth = 3.2; ctx.lineCap = ctx.lineJoin = 'round'; if (pred) ctx.setLineDash([7, 6]);
      ctx.beginPath(); upto.forEach((p, j) => j ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.beginPath(); upto.forEach((p, j) => j ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.stroke();
    }
    const d = [qs[qs.length - 1][0] - qs[0][0], qs[qs.length - 1][1] - qs[0][1]], L = Math.hypot(...d);
    // v0.54: a circle where it was in every pass, numbered P1, P2…, so it reads "from here to there" (white = the start);
    // the numbers sit beside the path, alternating sides, so close circles do not cover each other's labels
    const sx = L > 0.5 ? -d[1] / L : 1, sy = L > 0.5 ? d[0] / L : 0;
    ctx.font = '700 10px Inter,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // v0.55: the measured error of each pass (one σ), as a soft disc, drawn to the same scale as the path
    if (ppa) qs.forEach((p, j) => { const q = m.passes[j]; if (q.sE == null || es[j] > e) return; const r = Math.hypot(q.sE, q.sN) * ppa * Fx; if (r < 3) return;
      ctx.fillStyle = col; ctx.globalAlpha = MOVIE.mo ? .16 : .1; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill(); ctx.globalAlpha = MOVIE.mo ? .55 : .35; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; });
    qs.forEach((p, j) => { const on = es[j] <= e, r = on ? 7 : 5;
      if (pred) ctx.setLineDash([3, 3]); ctx.lineWidth = on ? 2 : 1.2; ctx.strokeStyle = !on ? 'rgba(255,255,255,.4)' : j === 0 ? '#ffffff' : col;
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      if (on) { const side = j % 2 ? -1 : 1, tx = p[0] + side * sx * 17, ty = p[1] + side * sy * 17, t = 'P' + (es[j] + 1);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(2,4,10,.85)'; ctx.strokeText(t, tx, ty); ctx.fillStyle = j === 0 ? '#ffffff' : col; ctx.fillText(t, tx, ty); } });
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    if (head && L > 0.5) { const ux = d[0] / L, uy = d[1] / L, t = [head[0] + ux * 16, head[1] + uy * 16];
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(t[0] + ux * 9, t[1] + uy * 9); ctx.lineTo(t[0] - uy * 6, t[1] + ux * 6); ctx.lineTo(t[0] + uy * 6, t[1] - ux * 6); ctx.closePath(); ctx.fill(); }
    // the marker: a ring with a slow pulse, and its name
    if (head) { const pulse = 0.5 + 0.5 * Math.sin(now / 260);
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(head[0], head[1], 9, 0, 7); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = col; ctx.globalAlpha = 0.55 * (1 - pulse); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(head[0], head[1], 11 + 12 * pulse, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
      if (g !== stage) { ctx.font = '700 12px Inter,system-ui,sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(2,4,10,.85)'; ctx.strokeText(`${i + 1} ${m.name}`, head[0] + 14, head[1] - 10); ctx.fillStyle = col; ctx.fillText(`${i + 1} ${m.name}`, head[0] + 14, head[1] - 10); } }
  }
  if (stage && stage.head) movieStage(stage, now, k);
  // caption
  let txt = `🎬 Pass ${e + 1} of ${S.eps.length} · ${fmtMonth(S.eps[e].t0)} · ${ms.length} moving` + (MOVIE.mo ? ' · motion only (sky hidden)' : '') + (Fx > 1 ? ` · paths drawn ${Fx}x longer to be seen (zoom in for true scale)` : '');
  ctx.font = '600 12px Inter,system-ui,sans-serif'; const cw = ctx.canvas.width / (window.devicePixelRatio || 1);
  const [fl, fr] = movieFreeX(cw), fw = fr - fl;   // v0.56.1: centred on the sky the panels leave visible
  if (ctx.measureText(txt).width + 34 > fw) txt = `🎬 Pass ${e + 1}/${S.eps.length} · ${fmtMonth(S.eps[e].t0)} · ${ms.length} moving` + (Fx > 1 ? ` · paths ${Fx}x longer` : '');   // phones and narrow skies: the short form
  const w = ctx.measureText(txt).width + 18;
  const x = Math.max(fl, fl + (fw - w) / 2), y = 64; ctx.fillStyle = 'rgba(5,8,15,.82)'; ctx.fillRect(x, y, w, 24); ctx.strokeStyle = 'rgba(45,212,191,.5)'; ctx.strokeRect(x, y, w, 24);
  ctx.fillStyle = '#e6fffb'; ctx.fillText(txt, x + 9, y + 16);
  ctx.restore();
}
