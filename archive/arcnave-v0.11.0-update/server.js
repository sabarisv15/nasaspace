'use strict';
// ARCNAVE backend: static files + a small CORS-free proxy for IRSA (SPHEREx), CDS Sesame,
// IMCCE SkyBoT and JPL Horizons. Zero dependencies, needs Node 18+.
//
// Speed (v0.4): a SPHEREx cutout from IRSA is ~6.4 MB, of which ~4.9 MB is a PSF cube the app never uses. The server keeps
// only IMAGE, FLAGS, ZODI and WCS-WAVE (~1.1 MB) and gzips it (~0.6 MB): about 11x less to the browser. Results are also
// kept on disk (cache/), so a field loads instantly the second time and still works when IRSA or the internet is down
// (offline demo). Identical requests in flight share one download.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const P = require('./lib/parsers');
const FITS = require('./lib/fits');

const PORT = +process.env.PORT || 8080;
const ROOT = __dirname;
const UA = 'ARCNAVE/0.4 (educational sky viewer)';
const CACHE_DIR = process.env.SKYSHIFT_CACHE_DIR || path.join(ROOT, 'cache');
const CACHE_MB = +process.env.SKYSHIFT_CACHE_MB || 2000;      // disk cache limit; oldest files are removed beyond it
const MAX_UPSTREAM = +process.env.SKYSHIFT_UPSTREAM || 8;     // parallel downloads from IRSA and the other services
const SEED_DIR = process.env.SKYSHIFT_SEED_DIR || path.join(ROOT, 'demo-cache');   // real results shipped with the site (examples open instantly)
const KEEP_HDUS = new Set(['PRIMARY', 'IMAGE', 'FLAGS', 'ZODI', 'WCS-WAVE']);
const LOG = require.main === module || process.env.SKYSHIFT_LOG === '1';   // speed log in the terminal when run directly

/* ---------- memory cache, concurrency limit, upstream fetch ---------- */
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.p;
  const p = fn().catch(e => { cache.delete(key); throw e; });
  cache.set(key, { exp: Date.now() + ttlMs, p });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return p;
}
let active = 0; const waiting = [];
async function limited(fn) {
  while (active >= MAX_UPSTREAM) await new Promise(r => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}
// IRSA answers "503 Server busy" when it gets many cutout requests at once (seen live: 17 of 24 failed with 8 in parallel,
// each worked when asked again). So: at most IRSA_PARALLEL cutout downloads at a time, and busy/timeout answers are retried
// a few times with growing pauses (the concurrency slot is free while waiting).
const RETRIES = process.env.SKYSHIFT_RETRIES != null ? +process.env.SKYSHIFT_RETRIES : 3;
const RETRY_MS = +process.env.SKYSHIFT_RETRY_MS || 2500;
const IRSA_PARALLEL = +process.env.SKYSHIFT_IRSA_PARALLEL || 4;
const retryable = e => [408, 429, 500, 502, 503, 504].includes(e.status) || e.name === 'AbortError' || /fetch failed|ECONNRESET|socket|terminated|timeout/i.test(e.message || '');
async function upstream(url, opts = {}) {
  const tries = opts.retries != null ? opts.retries : RETRIES;
  for (let k = 0; ; k++) {
    try { return await upstreamOnce(url, opts); }
    catch (e) {
      if (k >= tries || !retryable(e)) throw e;
      stats.retries = (stats.retries || 0) + 1;
      if (LOG) console.log(`  upstream busy or slow (${String(e.status || e.name || '')} ${String(e.message || '').slice(0, 50)}), retry ${k + 1} of ${tries}...`);
      await new Promise(r => setTimeout(r, Math.min(20000, RETRY_MS * 2 ** k) + Math.random() * RETRY_MS * 0.4));
    }
  }
}
let irsaActive = 0; const irsaWaiting = [];
async function irsaLimited(fn) {
  while (irsaActive >= IRSA_PARALLEL) await new Promise(r => irsaWaiting.push(r));
  irsaActive++;
  try { return await fn(); } finally { irsaActive--; irsaWaiting.shift()?.(); }
}
async function upstreamOnce(url, opts = {}) {
  return limited(async () => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), opts.timeout || 60000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal });
      if (!r.ok) { const body = (await r.text()).slice(0, 300); const e = new Error(`Upstream ${r.status}: ${body}`); e.status = r.status; throw e; }
      // read the body inside the timeout and the concurrency slot
      return opts.binary ? Buffer.from(await r.arrayBuffer()) : opts.json ? await r.json() : await r.text();
    } finally { clearTimeout(t); }
  });
}

/* ---------- disk cache (also the offline fallback) ---------- */
const hash = s => crypto.createHash('sha1').update(s).digest('hex');
const stats = { memHits: 0, diskHits: 0, staleServed: 0, downloads: 0, bytesFromIrsa: 0, bytesToBrowser: 0 };
async function diskRead(file) { try { return await fs.promises.readFile(file); } catch { return null; } }
async function diskWrite(file, data) {
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, file);
    if (++writes % 25 === 0) prune().catch(() => {});
  } catch { /* a read-only disk only costs speed */ }
}
let writes = 0;
async function prune() {
  const files = [];
  for (const sub of ['cutouts', 'api']) {
    const dir = path.join(CACHE_DIR, sub);
    let names = []; try { names = await fs.promises.readdir(dir); } catch { continue; }
    for (const n of names) { try { const s = await fs.promises.stat(path.join(dir, n)); files.push({ f: path.join(dir, n), size: s.size, t: s.mtimeMs }); } catch { /* gone */ } }
  }
  let total = files.reduce((a, x) => a + x.size, 0);
  files.sort((a, b) => a.t - b.t);
  for (const x of files) { if (total <= CACHE_MB * 1e6) break; try { await fs.promises.unlink(x.f); total -= x.size; } catch { /* ignore */ } }
}
async function cacheInfo() {
  let n = 0, bytes = 0;
  for (const sub of ['cutouts', 'api']) {
    let names = []; try { names = await fs.promises.readdir(path.join(CACHE_DIR, sub)); } catch { continue; }
    for (const nm of names) { try { bytes += (await fs.promises.stat(path.join(CACHE_DIR, sub, nm))).size; n++; } catch { /* gone */ } }
  }
  return { files: n, mb: +(bytes / 1e6).toFixed(1), limitMb: CACHE_MB };
}
// JSON results: fresh from disk if younger than ttl; otherwise ask upstream; if upstream fails, serve the old copy
// (marked stale) so a demo keeps working offline.
function cachedJSON(kind, key, ttlMs, fn) {
  return cached(kind + ':' + key, Math.min(ttlMs, 3600e3), async () => {
    const file = path.join(CACHE_DIR, 'api', kind + '-' + hash(key) + '.json');
    const old = await diskRead(file);
    let saved = null; try { saved = old && JSON.parse(old.toString('utf8')); } catch { saved = null; }
    if (saved && Date.now() - saved.savedAt < ttlMs) { stats.diskHits++; return saved.data; }
    try {
      const data = await fn();
      await diskWrite(file, JSON.stringify({ savedAt: Date.now(), key, data }));
      return data;
    } catch (e) {
      if (saved && !(e.status === 400 || e.status === 404)) { stats.staleServed++; return Object.assign({}, saved.data, { stale: true, savedAt: new Date(saved.savedAt).toISOString() }); }
      throw e;
    }
  });
}

// Copy the shipped demo results into the cache folder (only files that are not there yet). JSON answers get a fresh date, so
// they count as current. A host with an empty disk therefore still opens the examples at once, even when IRSA is busy.
function seedCache() {
  let n = 0;
  for (const sub of ['cutouts', 'api']) {
    let names = []; try { names = fs.readdirSync(path.join(SEED_DIR, sub)); } catch { continue; }
    try { fs.mkdirSync(path.join(CACHE_DIR, sub), { recursive: true }); } catch { continue; }
    for (const nm of names) {
      const to = path.join(CACHE_DIR, sub, nm); if (fs.existsSync(to)) continue;
      try {
        const from = path.join(SEED_DIR, sub, nm);
        if (sub === 'api') { const j = JSON.parse(fs.readFileSync(from, 'utf8')); j.savedAt = Date.now(); fs.writeFileSync(to, JSON.stringify(j)); }
        else fs.copyFileSync(from, to);
        n++;
      } catch { /* a read-only disk only costs speed */ }
    }
  }
  return n;
}

/* ---------- API handlers ---------- */
const num = (v, lo, hi, name) => {
  const x = Number(v);
  if (!Number.isFinite(x) || x < lo || x > hi) { const e = new Error(`Bad parameter: ${name}`); e.status = 400; throw e; }
  return x;
};
const DAY = 864e5;

async function resolve(q) {
  const name = String(q.q || '').trim();
  if (!name || name.length > 100) { const e = new Error('Missing name'); e.status = 400; throw e; }
  return cachedJSON('resolve', name.toLowerCase(), 30 * DAY, async () => {
    const hit = P.parseSesame(await upstream('https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/SNV?' + encodeURIComponent(name)));
    if (!hit) { const e = new Error('Name not found'); e.status = 404; throw e; }
    return hit;
  });
}

const SEARCHES = []; // last few archive searches, for the debug bundle
async function spherexSearch(q) {
  const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec');
  // Archive lists change only when IRSA adds a data release: one day is fresh enough.
  return cachedJSON('search', `${ra.toFixed(3)},${dec.toFixed(3)}`, DAY, async () => {
    const adql =
      "SELECT TOP 4000 'https://irsa.ipac.caltech.edu/' || a.uri AS download_url, p.obs_publisher_did, " +
      'p.time_bounds_lower, p.time_bounds_upper, p.energy_bandpassname, p.energy_bounds_lower, p.energy_bounds_upper, p.poly ' +
      'FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid ' +
      `WHERE CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly) = 1 ORDER BY p.time_bounds_lower`;
    const url = 'https://irsa.ipac.caltech.edu/TAP/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=csv&QUERY=' + encodeURIComponent(adql);
    const images = P.normaliseSpherex(P.parseCSV(await upstream(url, { timeout: 90000 })));
    const out = { ra, dec, count: images.length, images };
    SEARCHES.push({ at: new Date().toISOString(), adql, ...out }); if (SEARCHES.length > 5) SEARCHES.shift();
    return out;
  });
}

/** Keep only the extensions the app reads. Header and data blocks are copied byte for byte (FITS stays valid). */
function stripFits(buf) {
  let hdus;
  try { hdus = FITS.parseFITS(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); } catch { return buf; }
  const parts = []; let start = 0;
  hdus.forEach((h, i) => {
    const end = h.dataStart + Math.ceil(h.dataLen / 2880) * 2880;
    const name = i === 0 ? 'PRIMARY' : String(h.header.EXTNAME || '').trim().toUpperCase();
    if (KEEP_HDUS.has(name)) parts.push(buf.subarray(start, Math.min(end, buf.length)));
    start = end;
  });
  return parts.length ? Buffer.concat(parts) : buf;
}

const CUTOUT = new Map();    // url -> gzipped stripped FITS (memory LRU)
const INFLIGHT = new Map();  // url -> Promise, so parallel requests for one cutout share one download
async function getCutout(key) {
  const m = CUTOUT.get(key);
  if (m) { stats.memHits++; CUTOUT.delete(key); CUTOUT.set(key, m); return { gz: m, from: 'memory' }; }
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = (async () => {
    const file = path.join(CACHE_DIR, 'cutouts', hash(key) + '.fits.gz');
    let gz = await diskRead(file), from = 'disk';
    if (gz) { stats.diskHits++; if (LOG) console.log('  cutout from disk cache (instant)'); }
    else {
      const t0 = Date.now(), raw = await irsaLimited(() => upstream(key, { timeout: 180000, binary: true }));
      stats.downloads++; stats.bytesFromIrsa += raw.length;
      gz = zlib.gzipSync(stripFits(raw), { level: 1 });
      from = 'irsa';
      if (LOG) console.log(`  cutout from IRSA: ${(raw.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${(gz.length / 1e6).toFixed(2)} MB to the browser (${active} downloads running)`);
      await diskWrite(file, gz);
    }
    CUTOUT.set(key, gz);
    while (CUTOUT.size > 200) CUTOUT.delete(CUTOUT.keys().next().value);
    return { gz, from };
  })().finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, p);
  return p;
}
function cutoutUrl(q) {
  let u;
  try { u = new URL(String(q.url)); } catch { const e = new Error('Bad url'); e.status = 400; throw e; }
  // Only IRSA image paths: this must never become an open proxy.
  if (u.protocol !== 'https:' || u.hostname !== 'irsa.ipac.caltech.edu' || !u.pathname.startsWith('/ibe/') || u.search) {
    const e = new Error('URL not allowed'); e.status = 400; throw e;
  }
  let ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec'), size = num(q.size, 0.01, 1.0, 'size');
  // Round so -4.182 and -4.182000000000001 share one cache entry and one download (Cowork review found duplicates). 1e-5 deg = 0.036 arcsec.
  ra = +ra.toFixed(5); dec = +dec.toFixed(5); size = +size.toFixed(4);
  u.search = `?center=${ra},${dec}&size=${size}`;
  return { u, ra, dec, size };
}
async function spherexCutout(q, req, res) {
  const { u } = cutoutUrl(q);
  const t0 = Date.now(), { gz, from } = await getCutout(u.toString());
  const gzipOk = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const body = gzipOk ? gz : zlib.gunzipSync(gz);
  stats.bytesToBrowser += body.length;
  res.writeHead(200, { 'Content-Type': 'application/fits', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=86400',
    'Vary': 'Accept-Encoding', 'X-Arcnave-Cache': from, 'Server-Timing': `cutout;desc="${from}";dur=${Date.now() - t0}`,
    ...(gzipOk ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(body);
}

// The official SPHEREx PSF for the spot (ra, dec) of one image: the image's own "PSF" extension (11 x 11 detector zones,
// each 101 x 101 at 10x oversampling, built by the pipeline from >1000 stars per zone; Akeson et al. 2025, SPHEREx pipeline
// paper). Zone = the one containing the spot's detector position, plane = y * 11 + x (IRSA "PSF extension header error"
// note: QR files before pipeline 6.5.6 had the header's zone order wrong; the cube order itself is right). A tiny cutout
// (0.02 deg) is downloaded once; the cube comes with it. Used by /dev/psfcheck.html to test ARCNAVE's own PSF.
function readPsfZone(raw, ra, dec) {
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length), hd = FITS.parseFITS(ab);
  const hi = FITS.findHDU(hd, 'IMAGE'), hp = FITS.findHDU(hd, 'PSF');
  if (!hi || !hp) { const e = new Error('No PSF extension in this file'); e.status = 404; throw e; }
  const h = hp.header, nx = h.NAXIS1, ny = h.NAXIS2, nz = h.NAXIS3 || 1, os = h.OVERSAMP || 10;
  const p = FITS.sky2pix(FITS.makeWCS(hi.header), ra, dec), H = hi.header;
  const det = { x: (H.CRVAL1A || 0) + (H.CDELT1A || 1) * (p[0] - H.CRPIX1A), y: (H.CRVAL2A || 0) + (H.CDELT2A || 1) * (p[1] - H.CRPIX2A) };  // 0-based detector pixel
  const ng = Math.round(Math.sqrt(nz)), zw = 2040 / ng, zx = Math.max(0, Math.min(ng - 1, Math.floor(det.x / zw))), zy = Math.max(0, Math.min(ng - 1, Math.floor(det.y / zw)));
  const plane = nz > 1 ? zy * ng + zx : 0;
  // what the header keywords would pick (nearest XCTR_i/YCTR_i, 1-based), for comparison only
  let hz = null, hd2 = Infinity;
  for (let i = 1; i <= nz; i++) { const X = h['XCTR_' + i], Y = h['YCTR_' + i]; if (typeof X !== 'number') continue; const d = Math.hypot(X - 1 - det.x, Y - 1 - det.y); if (d < hd2) { hd2 = d; hz = i - 1; } }
  const dv = new DataView(ab, hp.dataStart + plane * nx * ny * 4, nx * ny * 4), bp = h.BITPIX, data = new Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) data[k] = bp === -32 ? +dv.getFloat32(k * 4, false).toPrecision(6) : NaN;
  const version = String(H.VERSION || (hd[0] && hd[0].header.VERSION) || '').trim();
  return { version, oversamp: os, nx, ny, nz, det: { x: +det.x.toFixed(2), y: +det.y.toFixed(2) }, zone: { x: zx, y: zy, plane }, headerPlane: hz,
           psfFwhmHeader: H.PSF_FWHM ?? null, detector: H.DETECTOR ?? null, data };
}
async function spherexPsf(q) {
  const { u, ra, dec } = cutoutUrl(Object.assign({}, q, { size: 0.02 }));
  return cachedJSON('psf', u.toString(), 365 * DAY, async () => {
    const raw = await irsaLimited(() => upstream(u.toString(), { timeout: 180000, binary: true }));
    stats.downloads++; stats.bytesFromIrsa += raw.length;
    return readPsfZone(raw, ra, dec);
  });
}

async function movers(q) {
  const ra = num(q.ra, 0, 360, 'ra'), dec = num(q.dec, -90, 90, 'dec');
  const rad = num(q.radius, 0.005, 10, 'radius'), mjd = num(q.mjd, 40000, 80000, 'mjd');
  const jd = (mjd + 2400000.5).toFixed(4);
  // Known-object positions at a fixed past time do not change: keep them 30 days.
  // Key at the same time precision as the query (1e-4 day = 9 s). It was 0.01 day: two exposures 6 minutes apart shared one
  // answer, so SkyBoT's predicted motion between them showed as 0 (seen live on 3865 Lindbloom).
  return cachedJSON('movers', `${ra.toFixed(3)},${dec.toFixed(3)},${rad.toFixed(2)},${jd}`, 30 * DAY, async () => {
    // Geocentric observer (code 500). SPHEREx is in low Earth orbit, so nearby objects can be off by an arcminute or so.
    const url = 'https://ssp.imcce.fr/webservices/skybot/api/conesearch.php' +
      `?-ep=${jd}&-ra=${ra}&-dec=${dec}&-rs=${Math.round(rad * 3600)}&-mime=json&-output=basic&-observer=500&-filter=120&-objFilter=111&-refsys=EQJ2000&-from=ARCNAVE`;
    const out = P.parseSkybot(await upstream(url, { timeout: 45000 }));
    if (!out.ok) { const e = new Error('SkyBoT returned an unexpected reply'); e.status = 502; throw e; }
    return { mjd, count: out.items.length, items: out.items };
  });
}

async function horizons(q) {
  const num_ = q.num ? String(q.num).replace(/\D/g, '') : '';
  const name = String(q.name || '').slice(0, 60);
  const cmd = num_ ? `${num_};` : `DES=${name};`;
  const t0 = String(q.start || ''), t1 = String(q.stop || '');
  const okT = s => /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s);
  if (!(num_ || name) || !okT(t0) || !okT(t1)) { const e = new Error('Need num or name, and start/stop as YYYY-MM-DD'); e.status = 400; throw e; }
  const step = /^\d+ ?(h|d|m)$/.test(String(q.step || '')) ? q.step : '1 d';
  const enc = encodeURIComponent;
  const url = 'https://ssd.jpl.nasa.gov/api/horizons.api?format=json' +
    `&COMMAND='${enc(cmd)}'&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&CENTER='500@399'` +
    `&START_TIME='${enc(t0)}'&STOP_TIME='${enc(t1)}'&STEP_SIZE='${enc(step)}'&QUANTITIES='1,9'&ANG_FORMAT='DEG'&CSV_FORMAT='YES'`;
  return cachedJSON('horizons', url, 30 * DAY, async () => {
    const j = await upstream(url, { timeout: 45000, json: true });
    if (j.error) { const e = new Error('Horizons: ' + String(j.error).slice(0, 200)); e.status = 502; throw e; }
    const rows = P.parseHorizons(j.result || '');
    if (!rows.length) { const e = new Error('Horizons gave no ephemeris (name may be ambiguous)'); e.status = 404; throw e; }
    return { cmd, rows };
  });
}

/* ---------- debug bundle (local runs only) ---------- */
// Saves the cutouts this server has in memory (without PSF/VARIANCE since v0.4), the last archive searches and what the
// page sends (agent report, chosen images) into debug-cutouts/<time>/ so the real data can be inspected offline. Refused
// unless the request comes from this computer, and refused entirely when SKYSHIFT_PUBLIC=1 (set that on any public host).
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
function readBody(req, max) {
  return new Promise((res, rej) => {
    let n = 0; const parts = [];
    req.on('data', d => { n += d.length; if (n > max) { const e = new Error('Body too large'); e.status = 400; rej(e); req.destroy(); } else parts.push(d); });
    req.on('end', () => res(Buffer.concat(parts).toString('utf8'))); req.on('error', rej);
  });
}
async function debugSave(req) {
  if (process.env.SKYSHIFT_PUBLIC === '1' || !isLocal(req)) { const e = new Error('Debug bundle is only available on a local run'); e.status = 404; throw e; }
  let page = null;
  const body = await readBody(req, 8e6);
  if (body.trim()) { try { page = JSON.parse(body); } catch { const e = new Error('Body must be JSON'); e.status = 400; throw e; } }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(ROOT, 'debug-cutouts', stamp);
  await fs.promises.mkdir(dir, { recursive: true });
  const cutouts = []; let k = 0;
  for (const [url, gz] of CUTOUT) {
    const file = `cutout_${String(++k).padStart(2, '0')}.fits`, buf = zlib.gunzipSync(gz);
    await fs.promises.writeFile(path.join(dir, file), buf);
    cutouts.push({ file, url, bytes: buf.length });
  }
  const index = { savedAt: new Date().toISOString(), tool: 'ARCNAVE debug bundle', cutouts, searches: SEARCHES, page };
  await fs.promises.writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 1));
  return { dir: path.relative(ROOT, dir), cutouts: cutouts.length, searches: SEARCHES.length };
}

/* ---------- routing ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
function sendJSON(req, res, code, obj) {
  let b = Buffer.from(JSON.stringify(obj));
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Accept-Encoding' };
  if (b.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { b = zlib.gzipSync(b, { level: 4 }); headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = b.length;
  res.writeHead(code, headers);
  res.end(b);
}
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/public/index.html' : pathname;
  if (rel.startsWith('/lib/fits.js')) rel = '/lib/fits.js';
  else if (rel.startsWith('/lib/wave.js')) rel = '/lib/wave.js';
  else if (rel.startsWith('/lib/slots.js')) rel = '/lib/slots.js';
  else if (rel.startsWith('/lib/planetx.js')) rel = '/lib/planetx.js';
  else if (!rel.startsWith('/public/')) rel = '/public' + rel;
  // developer pages (public/dev/) only on a local run, never on a public host
  if (rel.startsWith('/public/dev/') && (process.env.SKYSHIFT_PUBLIC === '1' || !isLocal(req))) { res.writeHead(404); return res.end('Not found'); }
  const file = path.normalize(path.join(ROOT, rel));
  const allowed = [path.join(ROOT, 'public') + path.sep, path.join(ROOT, 'lib', 'fits.js'), path.join(ROOT, 'lib', 'wave.js'), path.join(ROOT, 'lib', 'slots.js'), path.join(ROOT, 'lib', 'planetx.js')];
  if (!allowed.some(a => file === a || file.startsWith(a))) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding' };
    if (data.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { data = zlib.gzipSync(data, { level: 6 }); headers['Content-Encoding'] = 'gzip'; }
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = Object.fromEntries(url.searchParams);
  try {
    if (url.pathname === '/api/debug/save' && req.method === 'POST') return sendJSON(req, res, 200, await debugSave(req));
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    switch (url.pathname) {
      case '/api/resolve': return sendJSON(req, res, 200, await resolve(q));
      case '/api/spherex/search': return sendJSON(req, res, 200, await spherexSearch(q));
      case '/api/spherex/cutout': return await spherexCutout(q, req, res);
      case '/api/movers': return sendJSON(req, res, 200, await movers(q));
      case '/api/spherex/psf':   // developer check (public/dev/psfcheck.html): local runs only
        if (process.env.SKYSHIFT_PUBLIC === '1' || !isLocal(req)) return sendJSON(req, res, 404, { error: 'No such endpoint' });
        return sendJSON(req, res, 200, await spherexPsf(q));
      case '/api/horizons': return sendJSON(req, res, 200, await horizons(q));
      case '/api/health': return sendJSON(req, res, 200, { ok: true, version: require('./package.json').version, upstreamLimit: MAX_UPSTREAM, stats, cache: await cacheInfo() });
      default:
        if (url.pathname.startsWith('/api/')) return sendJSON(req, res, 404, { error: 'No such endpoint' });
        return serveStatic(req, res, decodeURIComponent(url.pathname));
    }
  } catch (e) {
    const code = e.status && e.status >= 400 && e.status < 600 ? (e.status === 404 || e.status === 400 ? e.status : 502) : (e.name === 'AbortError' ? 504 : 502);
    if (!res.headersSent) sendJSON(req, res, code, { error: e.name === 'AbortError' ? 'Upstream timed out' : e.message });
    else res.end();
  }
});

if (require.main === module) { const seeded = seedCache(); if (seeded) console.log(`Demo data: ${seeded} files copied into the cache`); }
server.seedCache = seedCache;
if (require.main === module) server.listen(PORT, () => console.log(`ARCNAVE on http://localhost:${PORT}  (cache: ${CACHE_DIR}, ${MAX_UPSTREAM} parallel requests, ${IRSA_PARALLEL} IRSA image downloads at a time, ${RETRIES} retries)`));
module.exports = server;
module.exports._test = { readPsfZone, stripFits, stats, clearMemory: () => { cache.clear(); CUTOUT.clear(); } };
