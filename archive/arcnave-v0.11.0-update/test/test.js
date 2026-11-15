'use strict';
process.env.SKYSHIFT_RETRY_MS = '5';   // retries are tested, but without real pauses
process.env.SKYSHIFT_CACHE_DIR = require('path').join(require('os').tmpdir(), 'skyshift-test-cache-' + process.pid);
// Offline tests: synthetic FITS + WCS round trips, parsers, and the server with a mocked network.
const assert = require('assert');
const F = require('../lib/fits');
const P = require('../lib/parsers');

let passed = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('ok  ' + name); }, e => { console.log('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; });

/* ---- build a synthetic SPHEREx-like MEF: empty primary + IMAGE + ZODI ---- */
function card(k, v) {
  let val = typeof v === 'string' ? `'${v}'`.padEnd(20) : typeof v === 'boolean' ? (v ? 'T' : 'F').padStart(20) : String(v).padStart(20);
  return (k.padEnd(8) + '= ' + val).padEnd(80);
}
function header(cards) {
  let s = cards.map(([k, v]) => card(k, v)).join('') + 'END'.padEnd(80);
  return s.padEnd(Math.ceil(s.length / 2880) * 2880);
}
function makeMEF({ nx, ny, wcs, stars, zodi }) {
  const prim = header([['SIMPLE', true], ['BITPIX', 8], ['NAXIS', 0], ['EXTEND', true]]);
  const mk = (name, f) => {
    const hd = header([['XTENSION', 'IMAGE'], ['BITPIX', -32], ['NAXIS', 2], ['NAXIS1', nx], ['NAXIS2', ny], ['PCOUNT', 0], ['GCOUNT', 1], ['EXTNAME', name], ...(name === 'IMAGE' ? wcs : [])]);
    const data = Buffer.alloc(Math.ceil(nx * ny * 4 / 2880) * 2880);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) data.writeFloatBE(f(x, y), (y * nx + x) * 4);
    return Buffer.concat([Buffer.from(hd, 'ascii'), data]);
  };
  const noise = (x, y) => ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 0.3;
  const img = mk('IMAGE', (x, y) => 100 + 0.02 * x + noise(x, y) + stars.reduce((s, st) => s + st.a * Math.exp(-((x - st.x) ** 2 + (y - st.y) ** 2) / (2 * 1.5 ** 2)), 0));
  const zod = mk('ZODI', () => 0);
  return Buffer.concat([Buffer.from(prim, 'ascii'), img, zod]);
}
const PXS = 6.15 / 3600;
const baseWCS = (ra, dec, nx, ny, extra = []) => [['CTYPE1', 'RA---TAN'], ['CTYPE2', 'DEC--TAN'], ['CRPIX1', (nx + 1) / 2], ['CRPIX2', (ny + 1) / 2], ['CRVAL1', ra], ['CRVAL2', dec], ['CD1_1', -PXS], ['CD1_2', 0], ['CD2_1', 0], ['CD2_2', PXS], ...extra];

(async () => {
  await t('FITS header and image extension are found', () => {
    const buf = makeMEF({ nx: 40, ny: 30, wcs: baseWCS(190, -4, 40, 30), stars: [{ x: 20, y: 15, a: 500 }] });
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    const hd = F.parseFITS(ab), hi = F.findHDU(hd, 'IMAGE');
    assert.strictEqual(hd.length, 3); assert.strictEqual(hi.header.NAXIS1, 40);
    const im = F.readImage(ab, hi);
    assert.ok(Math.abs(im.data[15 * 40 + 20] - 600) < 5);
    assert.ok(F.findHDU(hd, 'ZODI') && F.findHDU(hd, 'NOPE') === null);
  });

  await t('TAN WCS round trip pix->sky->pix', () => {
    const w = F.makeWCS(Object.fromEntries(baseWCS(190, -4, 300, 300)));
    for (const [x, y] of [[1, 1], [150.5, 150.5], [290, 40]]) {
      const s = F.pix2sky(w, x, y), p = F.sky2pix(w, s[0], s[1]);
      assert.ok(Math.hypot(p[0] - x, p[1] - y) < 1e-6, `${x},${y} -> ${p}`);
    }
  });

  await t('SIP distortion is inverted by sky2pix', () => {
    const hdr = Object.fromEntries(baseWCS(10, 40, 300, 300, [['A_ORDER', 2], ['B_ORDER', 2], ['A_2_0', 2e-5], ['A_1_1', -1e-5], ['B_0_2', 3e-5]]));
    const w = F.makeWCS(hdr);
    assert.ok(w.sipA);
    const s = F.pix2sky(w, 250, 60), p = F.sky2pix(w, s[0], s[1]);
    assert.ok(Math.hypot(p[0] - 250, p[1] - 60) < 1e-4, String(p));
  });

  await t('reprojection puts a star at the right grid pixel, even with a rotated image', () => {
    const ra = 190, dec = -4, nx = 200, ny = 200, theta = 25 * Math.PI / 180;
    const cd = [-PXS * Math.cos(theta), PXS * Math.sin(theta), PXS * Math.sin(theta), PXS * Math.cos(theta)];
    const wcsCards = baseWCS(ra, dec, nx, ny).filter(c => !/^CD/.test(c[0])).concat([['CD1_1', cd[0]], ['CD1_2', cd[1]], ['CD2_1', cd[2]], ['CD2_2', cd[3]]]);
    const buf = makeMEF({ nx, ny, wcs: wcsCards, stars: [{ x: 120, y: 80, a: 800 }] });
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    const hd = F.parseFITS(ab), hi = F.findHDU(hd, 'IMAGE'), im = F.readImage(ab, hi), w = F.makeWCS(hi.header);
    const grid = { ra0: ra, dec0: dec, s: PXS, n: 150 };
    const out = F.resample(im.data, nx, ny, w, grid);
    // expected grid position of source pixel (x=120,y=80) in 1-based FITS coords is (121,81)
    const sky = F.pix2sky(w, 121, 81), tp = F.tanFwd(sky[0], sky[1], ra, dec), c = (grid.n - 1) / 2;
    const ex = c + tp[0] / PXS, ey = c - tp[1] / PXS;
    let bx = 0, by = 0, bv = -1;
    for (let y = 0; y < 150; y++) for (let x = 0; x < 150; x++) { const v = out[y * 150 + x]; if (v > bv) { bv = v; bx = x; by = y; } }
    assert.ok(Math.hypot(bx - ex, by - ey) <= 1.5, `peak at ${bx},${by} expected ${ex.toFixed(1)},${ey.toFixed(1)}`);
    assert.ok(bv > 300);
  });

  await t('flatten removes a gradient and keeps NaN; stretch and diff behave', () => {
    const n = 100, a = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = 50 + 0.5 * x + 0.3 * y + (((x * 7 + y * 13) % 11) - 5) * 0.05;
    a[0] = NaN; a[5050] += 400;
    const f = F.flatten(a, n), st = F.robustStats(f);
    assert.ok(Number.isNaN(f[0]));
    assert.ok(Math.abs(st.med) < 0.5 && st.sigma < 1, JSON.stringify(st));
    const b = Float32Array.from(f); b[3030] += 50; // a "mover" appears only in B
    const d = F.renderDiff(f, b);
    assert.ok(d.rgba[3030 * 4] > 150 && d.rgba[3030 * 4 + 3] === 255);
    assert.strictEqual(F.renderRGBA(f, st, [255, 176, 90]).length, n * n * 4);
  });

  await t('analysis: finds a mover pair, ignores a static star, counts a dipole', () => {
    const n = 140, mk = (stars) => {
      const a = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let v = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 0.5;
        for (const s of stars) v += s.a * Math.exp(-((x - s.x) ** 2 + (y - s.y) ** 2) / (2 * 1.6 ** 2));
        a[y * n + x] = v;
      }
      return a;
    };
    const A = mk([{ x: 30, y: 30, a: 300 }, { x: 100, y: 40, a: 200 }, { x: 60, y: 90, a: 40 }]);          // static star, dipole star, mover
    const B = mk([{ x: 30, y: 30, a: 300 }, { x: 101.2, y: 40, a: 200 }, { x: 75, y: 100, a: 40 }]);
    // A 1.2 px shift of a sigma=1.6 star leaves +/- lobes about 3.8 px apart, so minSep must be above that.
    const r = F.findSources(A, B, n, 6), pr = F.pairUp(r.srcs, 5, 60);
    assert.strictEqual(pr.pairs.length, 1, JSON.stringify(pr.pairs.map(p => p.sep)));
    assert.ok(Math.abs(pr.pairs[0].sep - Math.hypot(15, 10)) < 1.5);
    assert.ok(pr.pairs[0].pos.x > 70 && pr.pairs[0].neg.x < 65);   // positive lobe is where it is in B
    assert.strictEqual(pr.dipoles, 1);
    assert.ok(!r.srcs.some(s => Math.hypot(s.x - 30, s.y - 30) < 4));
  });

  await t('aligner: finds and removes a sub-pixel offset; analyst finds a new source but not stars', () => {
    const n = 160, mk = (ox, oy, extra) => {
      const a = new Float32Array(n * n);
      const stars = [[30, 40, 300], [100, 50, 250], [60, 120, 400], [130, 130, 200], [20, 100, 150], [90, 90, 500]];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let v = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 0.5;
        for (const [sx, sy, A] of stars.concat(extra || [])) v += A * Math.exp(-((x - sx - ox) ** 2 + (y - sy - oy) ** 2) / (2 * 1.6 ** 2));
        a[y * n + x] = v;
      }
      return a;
    };
    const A = mk(0, 0), B = mk(1.4, -0.8, [[75, 20, 40]]); // b is shifted and also has a new faint source
    const e = F.estimateShift(A, B, n);
    assert.ok(e.ncc > 0.5 && Math.abs(e.dx + 1.4) < 0.35 && Math.abs(e.dy - 0.8) < 0.35, JSON.stringify(e));
    const B2 = F.shiftImage(B, n, e.dx, e.dy);
    const r = F.findTransients(A, B2, n, { s: PXS, ra0: 190, dec0: -4 });
    const hit = r.cands.find(k => k.kind === 'new' && Math.hypot(k.x - 76.4 + 1.4, k.y - 19.2 - 0.8) < 3.5 || (k.kind === 'new' && Math.hypot(k.x - 75, k.y - 20) < 4));
    assert.ok(hit, 'new source not found: ' + JSON.stringify(r.cands.slice(0, 5)));
    assert.ok(Number.isFinite(hit.ra) && Number.isFinite(hit.dec));
    assert.ok(!r.cands.some(k => [[30, 40], [100, 50], [60, 120], [90, 90]].some(([sx, sy]) => Math.hypot(k.x - sx, k.y - sy) < 4)), 'a star was reported as a transient');
    const none = F.findTransients(A, F.shiftImage(mk(0, 0), n, 0, 0), n, {});
    assert.strictEqual(none.cands.length, 0);
  });

  await t('transients: a slow mover becomes one pair with sky coordinates; grid and sky round-trip', () => {
    const n = 160, grid = { ra0: 190, dec0: -4, s: PXS, n };
    const mk = (extra) => {
      const a = new Float32Array(n * n);
      const stars = [[30, 40, 300], [100, 50, 250], [60, 120, 400], [130, 130, 200]];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let v = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 0.5;
        for (const [sx, sy, A] of stars.concat(extra)) v += A * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * 1.6 ** 2));
        a[y * n + x] = v;
      }
      return a;
    };
    const r = F.findTransients(mk([[40, 80, 60]]), mk([[48, 84, 60]]), n, grid);
    assert.strictEqual(r.cands.length, 1, JSON.stringify(r.cands));
    const c = r.cands[0];
    assert.strictEqual(c.kind, 'pair');
    assert.ok(Math.hypot(c.from.x - 40, c.from.y - 80) < 1 && Math.hypot(c.to.x - 48, c.to.y - 84) < 1);
    assert.ok(Math.abs(c.sepPx - Math.hypot(8, 4)) < 1);
    const back = F.skyToGrid(c.to.ra, c.to.dec, grid);
    assert.ok(Math.hypot(back[0] - c.to.x, back[1] - c.to.y) < 1e-6);
    assert.ok(Math.abs(F.gridToSky(79.5, 79.5, grid)[0] - 190) < 1e-9);
  });

  await t('transients: a mover that lands in the wing of a bright star (5 px away) is still found', () => {
    const n = 160, grid = { ra0: 190, dec0: -4, s: PXS, n };
    const mk = (extra) => {
      const a = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let v = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 0.5;
        for (const [sx, sy, A] of [[30, 40, 300], [100, 50, 250], [90, 90, 300]].concat(extra)) v += A * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * 1.6 ** 2));
        a[y * n + x] = v;
      }
      return a;
    };
    // mover goes (60,100) -> (95,90). Its new spot sits in the wing of the 300-count star at (90,90): the star's wing there is
    // several sigma, so testing raw flux in the other epoch would wrongly reject it. Two sources closer than ~2 sigma would blend, which no peak finder can split.
    const r = F.findTransients(mk([[60, 100, 70]]), mk([[95, 90, 70]]), n, grid, { maxSep: 40 });
    const pr = r.cands.find(c => c.kind === 'pair');
    assert.ok(pr, JSON.stringify(r.cands.map(c => [c.kind, c.x, c.y])));
    assert.ok(Math.hypot(pr.to.x - 95, pr.to.y - 90) < 2.5 && Math.hypot(pr.from.x - 60, pr.from.y - 100) < 1.5);
    assert.ok(!r.cands.some(c => Math.hypot(c.x - 90, c.y - 90) < 1 && c.kind !== 'pair'));
  });

  // Shared synthetic field for the guard tests: 40 stars on a 200 px grid, plus optional extras and a per-star offset.
  const field = (n, opts = {}) => {
    const R = (s => () => { s = (s * 16807) % 2147483647; return s / 2147483647; })(7);
    const stars = []; for (let i = 0; i < 40; i++) stars.push([15 + R() * (n - 30), 15 + R() * (n - 30), 60 + R() * 300]);
    const a = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) a[y * n + x] = ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 0.5;
    for (const [sx0, sy0, A] of stars.concat(opts.extra || [])) {
      const [ox, oy] = opts.offset ? opts.offset(sx0, sy0) : [0, 0], sx = sx0 + ox, sy = sy0 + oy;
      for (let y = Math.max(0, Math.floor(sy - 8)); y < Math.min(n, sy + 9); y++) for (let x = Math.max(0, Math.floor(sx - 8)); x < Math.min(n, sx + 9); x++)
        a[y * n + x] += A * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * 1.6 ** 2));
    }
    if (opts.nanLeft) for (let y = 0; y < n; y++) for (let x = 0; x < opts.nanLeft; x++) a[y * n + x] = NaN;
    return a;
  };

  await t('guards: epochs that line up give no near misses; a local misalignment (like a wavelength or distortion mismatch) is flagged', () => {
    const n = 200, grid = { ra0: 190, dec0: -4, s: PXS, n };
    const good = F.findTransients(field(n), field(n), n, grid, { maxSep: 0.5 });
    assert.strictEqual(good.cands.length, 0); assert.strictEqual(good.nearMiss, 0); assert.ok(good.matched >= 35, 'matched ' + good.matched);
    // Right half of B is displaced by (5, 3) px: the global shift is ~0 but half the stars "jump". This is what the live run looked like.
    const bad = F.findTransients(field(n), field(n, { offset: x => x > n / 2 ? [5, 3] : [0, 0] }), n, grid, { maxSep: 0.5 });
    assert.ok(bad.nearMiss >= 5 && bad.nearMiss >= 0.05 * bad.matched, JSON.stringify({ nearMiss: bad.nearMiss, matched: bad.matched }));
    assert.ok(!bad.cands.some(c => c.kind === 'pair'), 'pair search must be off when stars cannot move a pixel');
    assert.strictEqual(bad.pairSearch, false);
  });

  await t('guards: pairing obeys the physical limit; a source near the footprint edge is not reported', () => {
    const n = 200, grid = { ra0: 190, dec0: -4, s: PXS, n };
    const A = field(n, { extra: [[100, 150, 80]] }), B = field(n, { extra: [[108, 154, 80]] });
    const loose = F.findTransients(A, B, n, grid, { maxSep: 12 });
    assert.ok(loose.cands.some(c => c.kind === 'pair'), 'pairing allowed: expected a pair');
    const strict = F.findTransients(A, B, n, grid, { maxSep: 0.9 });     // e.g. 11"/yr over half a year = 0.9 px
    assert.deepStrictEqual(strict.cands.map(c => c.kind).sort(), ['gone', 'new'], JSON.stringify(strict.cands.map(c => c.kind)));
    // A new source 3 px from a NaN (off-footprint) strip must be rejected; the same source well inside must be kept.
    const edgeA = field(n, { nanLeft: 20 }), edgeB = field(n, { nanLeft: 20, extra: [[23, 25, 120]] });
    const e1 = F.findTransients(edgeA, edgeB, n, grid, { maxSep: 0.5 });
    assert.ok(!e1.cands.some(c => Math.hypot(c.x - 23, c.y - 25) < 3) && e1.edgeRejected >= 1, JSON.stringify(e1.cands));
    const inB = field(n, { nanLeft: 20, extra: [[60, 25, 120]] });
    assert.ok(F.findTransients(edgeA, inB, n, grid, { maxSep: 0.5 }).cands.some(c => c.kind === 'new' && Math.hypot(c.x - 60, c.y - 25) < 2));
  });

  await t('guards: a new object landing on a faint star is still found (brightness-aware matching)', () => {
    const n = 200, grid = { ra0: 190, dec0: -4, s: PXS, n };
    const A = field(n, { extra: [[40, 110, 25]] }), B = field(n, { extra: [[40, 110, 25], [40.5, 110.3, 150]] });
    const r = F.findTransients(A, B, n, grid, { maxSep: 0.5 });
    assert.ok(r.cands.some(c => c.kind === 'new' && Math.hypot(c.x - 40.4, c.y - 110.2) < 2), JSON.stringify(r.cands));
  });

  await t('parsers: CSV, SPHEREx rows, Sesame, SkyBoT, Horizons', () => {
    const rows = P.parseCSV('download_url,obs_publisher_did,time_bounds_lower,time_bounds_upper,energy_bandpassname,energy_bounds_lower,energy_bounds_upper\n"https://irsa.ipac.caltech.edu/ibe/data/spherex/qr/a.fits",ivo://irsa.ipac/spherex_qr?2025W23_1C_0051_3/D4,60830.1,60830.2,SPHEREx-D4,3.0e-6,3.1e-6\n');
    const im = P.normaliseSpherex(rows);
    assert.strictEqual(im.length, 1); assert.strictEqual(im[0].det, 'D4'); assert.ok(Math.abs(im[0].lam - 3.05) < 1e-9); assert.strictEqual(im[0].id, '2025W23_1C_0051_3');
    assert.strictEqual(im[0].poly, undefined);   // old query without footprint still works
    const hexA = '0103000020E6100000010000000500000074A2A4991B8E65C03DACD3EEF57519407FF72347962665C04D9FE6CA5F2E1440F628FF65925465C0AA6B5367BCDDFD3F4090FCD2B9BC65C0B6F11BFEEA7F094074A2A4991B8E65C03DACD3EEF5751940';
    const wp = P.normaliseSpherex(P.parseCSV('download_url,obs_publisher_did,time_bounds_lower,time_bounds_upper,energy_bandpassname,energy_bounds_lower,energy_bounds_upper,poly\nhttps://irsa.ipac.caltech.edu/ibe/a.fits,ivo://irsa.ipac/spherex_qr2?2025W22_2B_0360_1/D4,60826.57938,60826.58071,SPHEREx-D4,2.4027e-6,3.8473e-6,' + hexA + '\n'));
    assert.ok(wp[0].poly && wp[0].poly.length === 4 && Math.abs(wp[0].poly[0][0] - 187.559131) < 1e-5 && Math.abs(wp[0].poly[2][1] - 1.866635) < 1e-5, JSON.stringify(wp[0].poly));
    assert.deepStrictEqual(P.parseSesame('# M1\n%J 083.63308 +22.01450 = 05:34:31.94 +22:00:52.2\n'), { ra: 83.63308, dec: 22.0145, name: null });
    assert.strictEqual(P.parseSesame('nothing'), null);
    assert.ok(Math.abs(P.parseSexa('12 30 00') - 12.5) < 1e-9 && Math.abs(P.parseSexa('-04 30 00') + 4.5) < 1e-9);
    const sk = P.parseSkybot(JSON.stringify([{ Num: 4, Name: 'Vesta', 'RA (hour)': '12 40 00', 'DEC (deg)': '-04 30 00', Class: 'MB>Inner', 'VMag (mag)': 7.2, 'Err (arcsec)': 0.01, 'dRA (arcsec/h)': 30, 'dDEC (arcsec/h)': -5, 'dg (ua)': 2.1, 'dh (ua)': 2.5 }]));
    assert.ok(sk.ok && sk.items[0].ra === 190 && sk.items[0].dec === -4.5 && sk.items[0].num === 4);
    assert.ok(P.parseSkybot('').ok && P.parseSkybot('[]').items.length === 0);
    // Real SkyBoT reply captured from the IMCCE docs example (keys are "RA (hms)" / "DEC (dms)")
    const real = '[{"Num":737718,"Name":"2016 EW8","RA (hms)":"09 54 47.4627","DEC (dms)":"+16 21 54.744","Class":"MB>Outer","VMag (mag)":22.7,"Err (arcsec)":0.05,"d (arcsec)":116.939,"dRA (arcsec\\/h)":46.9155,"dDEC (arcsec\\/h)":-10.6879,"dg (ua)":3.42189704461,"dh (ua)":2.98721813769}]';
    const rs = P.parseSkybot(real);
    assert.ok(rs.ok && rs.items.length === 1 && rs.items[0].name === '2016 EW8');
    assert.ok(Math.abs(rs.items[0].ra - 148.69776) < 1e-4 && Math.abs(rs.items[0].dec - 16.36521) < 1e-4, JSON.stringify(rs.items[0]));
    assert.ok(rs.items[0].dra === 46.9155 && rs.items[0].dgeo > 3);
    assert.strictEqual(P.parseSkybot('[{"Name":"x","RA (weird)":"1","DEC (weird)":"2"}]').ok, false); // unreadable format must not look like "0 objects"
    assert.strictEqual(P.parseSkybot('<VOTABLE></VOTABLE>').ok, false);
    const hz = P.parseHorizons('x\n$$SOE\n 2026-Oct-13 00:00, , , 190.12345, -4.54321,  15.2,  5.1,\n 2026-Oct-14 00:00, , , 190.2, -4.6,  15.2,  5.1,\n$$EOE\n');
    assert.strictEqual(hz.length, 2); assert.strictEqual(hz[0].ra, 190.12345); assert.strictEqual(hz[0].mag, 15.2);
  });

  await t('server: static files, validation, SSRF guard, mocked upstreams', async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      const u = String(url);
      const ok = (body, type = 'text/plain') => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body), arrayBuffer: async () => Buffer.from(body) });
      if (u.includes('/TAP/sync')) return ok('download_url,obs_publisher_did,time_bounds_lower,time_bounds_upper,energy_bandpassname,energy_bounds_lower,energy_bounds_upper\nhttps://irsa.ipac.caltech.edu/ibe/data/spherex/x.fits,ivo://irsa.ipac/spherex_qr?W1/D1,60800,60801,SPHEREx-D1,1e-6,1.1e-6\n');
      if (u.includes('skybot')) return ok('[]');
      if (u.includes('/ibe/data/spherex/busy') && (global.__busy = (global.__busy || 0) + 1) <= 2) return { ok: false, status: 503, text: async () => 'Server busy, retry later' };
      if (u.includes('/ibe/data/spherex/withpsf') || u.includes('/ibe/data/spherex/busy')) return { ok: true, status: 200, arrayBuffer: async () => { const b = fitsWithPsf(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } };
      if (u.includes('/ibe/data/')) return ok('FITSBYTES');
      if (u.includes('sesame')) return ok('%J 10.5 20.5 = x\n');
      return { ok: false, status: 500, text: async () => 'boom' };
    };
    const server = require('../server'), S = server, fs = require('fs'), path = require('path');
    // a small multi-extension FITS like an IRSA cutout: PRIMARY, IMAGE, FLAGS, VARIANCE, ZODI, PSF (big)
    const fitsWithPsf = () => {
      const card = (k, v) => (k.padEnd(8) + '= ' + (typeof v === 'string' ? `'${v}'`.padEnd(20) : typeof v === 'boolean' ? (v ? 'T' : 'F').padStart(20) : String(v).padStart(20))).padEnd(80);
      const hdr = cards => { const t = cards.map(([k, v]) => card(k, v)).join('') + 'END'.padEnd(80); return Buffer.from(t.padEnd(Math.ceil(t.length / 2880) * 2880), 'ascii'); };
      const ext = (name, nx, ny, nz) => Buffer.concat([hdr([['XTENSION', 'IMAGE'], ['BITPIX', -32], ['NAXIS', nz ? 3 : 2], ['NAXIS1', nx], ['NAXIS2', ny], ...(nz ? [['NAXIS3', nz]] : []), ['PCOUNT', 0], ['GCOUNT', 1], ['EXTNAME', name]]),
        Buffer.alloc(Math.ceil(nx * ny * (nz || 1) * 4 / 2880) * 2880)]);
      return Buffer.concat([hdr([['SIMPLE', true], ['BITPIX', 8], ['NAXIS', 0], ['EXTEND', true]]), ext('IMAGE', 20, 20), ext('FLAGS', 20, 20), ext('VARIANCE', 20, 20), ext('ZODI', 20, 20), ext('PSF', 30, 30, 20)]);
    };
    await new Promise(r => server.listen(0, r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const get = async p => { const r = await global.__realFetch(base + p); return { s: r.status, t: await r.text() }; };
    global.__realFetch = require('http').get && ((url) => new Promise((res, rej) => {
      require('http').get(url, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, text: async () => b })); }).on('error', rej);
    }));
    assert.strictEqual((await get('/')).s, 200);
    assert.strictEqual((await get('/lib/fits.js')).s, 200);
    assert.strictEqual((await get('/../server.js')).s, 404);
    assert.strictEqual((await get('/lib/parsers.js')).s, 404);
    assert.strictEqual((await get('/api/spherex/search?ra=999&dec=0')).s, 400);
    const sr = await get('/api/spherex/search?ra=190&dec=-4'); assert.strictEqual(sr.s, 200); assert.strictEqual(JSON.parse(sr.t).count, 1);
    assert.strictEqual((await get('/api/spherex/cutout?url=' + encodeURIComponent('https://evil.example/ibe/x.fits') + '&ra=1&dec=1&size=0.5')).s, 400);
    assert.strictEqual((await get('/api/spherex/cutout?url=' + encodeURIComponent('https://irsa.ipac.caltech.edu/other/x.fits') + '&ra=1&dec=1&size=0.5')).s, 400);
    const co = await get('/api/spherex/cutout?url=' + encodeURIComponent('https://irsa.ipac.caltech.edu/ibe/data/spherex/x.fits') + '&ra=190&dec=-4&size=0.5');
    assert.strictEqual(co.s, 200); assert.strictEqual(co.t, 'FITSBYTES');
    assert.ok(calls.some(c => c.includes('?center=190,-4&size=0.5')));
    assert.strictEqual(JSON.parse((await get('/api/movers?ra=190&dec=-4&radius=0.4&mjd=60800')).t).count, 0);
    assert.strictEqual(JSON.parse((await get('/api/resolve?q=M1')).t).ra, 10.5);
    assert.strictEqual((await get('/api/horizons?num=4&start=bad&stop=2026-01-01')).s, 400);
    // Debug bundle: works from this computer, writes the cached cutout + index, refused when SKYSHIFT_PUBLIC=1.
    const post = (p, body) => new Promise((res, rej) => {
      const rq = require('http').request(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ s: r.statusCode, t: b })); });
      rq.on('error', rej); rq.end(body);
    });
    const ds = await post('/api/debug/save', JSON.stringify({ report: { hello: 1 } }));
    assert.strictEqual(ds.s, 200, ds.t);
    const dj = JSON.parse(ds.t), ddir = require('path').join(__dirname, '..', dj.dir);
    assert.strictEqual(dj.cutouts, 1);
    const idx = JSON.parse(require('fs').readFileSync(require('path').join(ddir, 'index.json'), 'utf8'));
    assert.strictEqual(require('fs').readFileSync(require('path').join(ddir, 'cutout_01.fits'), 'utf8'), 'FITSBYTES');
    assert.ok(idx.page.report.hello === 1 && idx.searches.length >= 1 && idx.cutouts[0].url.includes('center=190,-4'));
    require('fs').rmSync(require('path').join(__dirname, '..', 'debug-cutouts'), { recursive: true, force: true });
    assert.strictEqual((await post('/api/debug/save', 'not json')).s, 400);
    process.env.SKYSHIFT_PUBLIC = '1';
    assert.strictEqual((await post('/api/debug/save', '{}')).s, 404);
    delete process.env.SKYSHIFT_PUBLIC;
    assert.strictEqual((await post('/api/spherex/search', '{}')).s, 405);
    // Speed: PSF/VARIANCE stripped, gzip when asked, shared downloads, memory then disk cache, offline (stale) fallback
    const zlib = require('zlib'), getRaw = (p, headers = {}) => new Promise((res, rej) => {
      require('http').get(base + p, { headers }, r => { const parts = []; r.on('data', d => parts.push(d)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(parts) })); }).on('error', rej);
    });
    const cu = '/api/spherex/cutout?url=' + encodeURIComponent('https://irsa.ipac.caltech.edu/ibe/data/spherex/withpsf.fits') + '&ra=190&dec=-4&size=0.5';
    const n0 = calls.length;
    const [g1, g2] = await Promise.all([getRaw(cu, { 'Accept-Encoding': 'gzip' }), getRaw(cu, { 'Accept-Encoding': 'gzip' })]);
    assert.strictEqual(calls.length - n0, 1, 'two parallel requests must share one download');
    assert.strictEqual(g1.headers['content-encoding'], 'gzip');
    const fits1 = zlib.gunzipSync(g1.body), names = F.parseFITS(fits1.buffer.slice(fits1.byteOffset, fits1.byteOffset + fits1.length)).map(h => h.header.EXTNAME || 'PRIMARY');
    assert.deepStrictEqual(names, ['PRIMARY', 'IMAGE', 'FLAGS', 'ZODI'], 'PSF and VARIANCE must be removed');
    assert.ok(fits1.length < fitsWithPsf().length / 3, 'stripped cutout should be much smaller');
    assert.ok(g2.body.equals(g1.body));
    const g3 = await getRaw(cu); assert.strictEqual(g3.headers['x-arcnave-cache'], 'memory'); assert.ok(!g3.headers['content-encoding'] && g3.body.equals(fits1));
    S._test.clearMemory();
    const g4 = await getRaw(cu); assert.strictEqual(g4.headers['x-arcnave-cache'], 'disk'); assert.strictEqual(calls.length - n0, 1, 'disk cache: no new download');
    // IRSA "503 Server busy" (seen live with 24 parallel cutouts): retried, and the image still arrives
    const cb = '/api/spherex/cutout?url=' + encodeURIComponent('https://irsa.ipac.caltech.edu/ibe/data/spherex/busy.fits') + '&ra=190&dec=-4&size=0.5', n1 = calls.length;
    const gb = await getRaw(cb);
    assert.strictEqual(gb.status, 200, 'busy IRSA should be retried'); assert.strictEqual(calls.length - n1, 3, '2 busy answers + 1 success');
    // offline: search cached on disk is served when IRSA fails, marked stale once older than a day
    const cacheDir = path.join(process.env.SKYSHIFT_CACHE_DIR, 'api'), sfile = fs.readdirSync(cacheDir).find(f => f.startsWith('search-'));
    const sj = JSON.parse(fs.readFileSync(path.join(cacheDir, sfile), 'utf8')); sj.savedAt -= 2 * 864e5; fs.writeFileSync(path.join(cacheDir, sfile), JSON.stringify(sj));
    S._test.clearMemory();
    const realFetch = global.fetch; global.fetch = async () => { throw new Error('offline'); };
    const off = JSON.parse((await get('/api/spherex/search?ra=190&dec=-4')).t);
    assert.ok(off.stale === true && off.count === 1, 'offline search should come from the disk cache: ' + JSON.stringify(off).slice(0, 200));
    assert.strictEqual((await get('/api/spherex/search?ra=10&dec=10')).s, 502, 'never-seen field offline must fail honestly');
    global.fetch = realFetch;
    const h = JSON.parse((await get('/api/health')).t); assert.ok(h.ok && h.cache.files >= 2 && h.stats.downloads >= 1, JSON.stringify(h));
    fs.rmSync(process.env.SKYSHIFT_CACHE_DIR, { recursive: true, force: true });
    await new Promise(r => server.close(r));
  });

  console.log(`\n${passed} passed`);
  process.exit(process.exitCode || 0);
})();
