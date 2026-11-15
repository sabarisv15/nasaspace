/* ARCNAVE: "Hide Planet X" (v0.10). An injection-recovery test on real SPHEREx images.
   A FAKE distant planet is added to the aligned images of a field, the epoch stacks are rebuilt, and the same detector
   the Analyst uses (SkyFits.findTransients + the shape check) looks for it. Nothing here searches for a real Planet X.
   Works in the browser (window.SkyPlanetX) and in Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkyPlanetX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const D2R = Math.PI / 180, ARCSEC = 180 / Math.PI * 3600, AB_ZERO_MJY = 3631e3;

  /* ---------- where Earth is ---------- */
  // Geocentric Sun, equatorial J2000-ish, in AU. Low-precision formula of the Astronomical Almanac (good to about 0.01 deg in
  // longitude 1950-2050). mjd = Modified Julian Date (UTC is fine at this precision).
  function sunVector(mjd) {
    const n = mjd - 51544.5;                                  // days from J2000.0
    const L = 280.460 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * D2R;
    const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
    const R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g), eps = (23.439 - 0.0000004 * n) * D2R;
    return [R * Math.cos(lam), R * Math.cos(eps) * Math.sin(lam), R * Math.sin(eps) * Math.sin(lam)];
  }
  const earthVector = mjd => sunVector(mjd).map(v => -v);    // heliocentric Earth (SPHEREx is in low Earth orbit: 0.00005 AU)
  const unit = (ra, dec) => [Math.cos(dec * D2R) * Math.cos(ra * D2R), Math.cos(dec * D2R) * Math.sin(ra * D2R), Math.sin(dec * D2R)];
  function toRaDec(v) {
    const r = Math.hypot(v[0], v[1], v[2]);
    let ra = Math.atan2(v[1], v[0]) / D2R; if (ra < 0) ra += 360;
    return { ra, dec: Math.asin(v[2] / r) / D2R, dist: r };
  }
  function sepArcsec(a, b) {
    const u = unit(a.ra, a.dec), w = unit(b.ra, b.dec);
    const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    return Math.atan2(Math.hypot(c[0], c[1], c[2]), u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) * ARCSEC;
  }

  /** Sky positions of a body that stays put relative to the Sun, seen from Earth. It is at (ra0, dec0) and dist AU from
      Earth at time mjd0. Its own orbital motion is left out: at 500 AU a circular orbit moves about 2 arcmin a year,
      against a parallax jump of up to about 14 arcmin between two passes six months apart. */
  function track(ra0, dec0, dist, mjd0, mjds) {
    const E0 = earthVector(mjd0), u = unit(ra0, dec0), P = [0, 1, 2].map(k => E0[k] + dist * u[k]);
    return mjds.map(t => { const E = earthVector(t); return toRaDec([P[0] - E[0], P[1] - E[1], P[2] - E[2]]); });
  }
  /** Orbital motion of a circular orbit at r AU (arcsec per year, seen from the Sun), for the caveat text. */
  const orbitArcsecPerYear = r => 360 * 3600 / Math.pow(r, 1.5);

  /* ---------- brightness ---------- */
  const abToMJy = m => AB_ZERO_MJY * Math.pow(10, -0.4 * m);
  const mJyToAb = f => -2.5 * Math.log10(f / AB_ZERO_MJY);
  /** Total of all pixels (MJy/sr) that a point source of f mJy adds to an image with square pixels of pixArcsec. */
  function mJyToPixelSum(f, pixArcsec) { const om = Math.pow(pixArcsec / ARCSEC, 2); return f * 1e-3 / (om * 1e6); }
  const pixelSumToMJy = (s, pixArcsec) => s * Math.pow(pixArcsec / ARCSEC, 2) * 1e6 * 1e3;

  /* ---------- the telescope's blur, measured on the field's own stars ---------- */
  /** Empirical PSF: median of the normalised (2R+1)^2 boxes around bright, isolated stars (peak > minSnr sigma, no other
      peak above 5% of it within isoPx, no NaN in the box), centred on the brightest pixel. Sum = 1 inside the box. */
  function buildPSF(flat, n, st, opts) {
    opts = opts || {};
    const R = opts.R || 4, minSnr = opts.minSnr || 30, iso = opts.isoPx || 7, maxStars = opts.maxStars || 60, side = 2 * R + 1;
    const lim = st.med + minSnr * st.sigma, peaks = [];
    for (let y = R + 1; y < n - R - 1; y++) for (let x = R + 1; x < n - R - 1; x++) {
      const c = flat[y * n + x]; if (!(c > lim)) continue;
      let max = true; for (let j = -1; j <= 1 && max; j++) for (let i = -1; i <= 1; i++) if ((i || j) && !(flat[(y + j) * n + x + i] < c)) { max = false; break; }
      if (max) peaks.push({ x, y, v: c - st.med });
    }
    // isolation against every local maximum above 5 sigma, not only the bright ones
    const lim5 = st.med + 5 * st.sigma, faint = [];
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const c = flat[y * n + x]; if (!(c > lim5)) continue;
      let max = true; for (let j = -1; j <= 1 && max; j++) for (let i = -1; i <= 1; i++) if ((i || j) && !(flat[(y + j) * n + x + i] < c)) { max = false; break; }
      if (max) faint.push({ x, y, v: c - st.med });
    }
    const good = peaks.filter(p => !faint.some(q => (q.x !== p.x || q.y !== p.y) && Math.hypot(q.x - p.x, q.y - p.y) < iso && q.v > 0.05 * p.v));
    good.sort((p, q) => q.v - p.v);
    const stamps = [];
    for (const p of good) {
      if (stamps.length >= maxStars) break;
      const s = new Float64Array(side * side); let sum = 0, bad = false;
      for (let j = -R; j <= R && !bad; j++) for (let i = -R; i <= R; i++) { const v = flat[(p.y + j) * n + p.x + i] - st.med; if (v !== v) { bad = true; break; } s[(j + R) * side + i + R] = v; sum += v; }
      if (bad || !(sum > 0)) continue;
      for (let k = 0; k < s.length; k++) s[k] /= sum;
      stamps.push(s);
    }
    if (stamps.length < 5) return null;
    const psf = new Float64Array(side * side), col = new Float64Array(stamps.length);
    for (let k = 0; k < psf.length; k++) { for (let m = 0; m < stamps.length; m++) col[m] = stamps[m][k]; const a = Array.from(col).sort((p, q) => p - q); psf[k] = a[a.length >> 1]; }
    let sum = 0; for (let k = 0; k < psf.length; k++) { if (psf[k] < 0) psf[k] = 0; sum += psf[k]; }
    for (let k = 0; k < psf.length; k++) psf[k] /= sum;
    // width: second moment -> Gaussian-equivalent FWHM (pixels), and the share of light in the brightest pixel
    let mxx = 0, myy = 0; for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) { const w = psf[(j + R) * side + i + R]; mxx += w * i * i; myy += w * j * j; }
    return { psf, R, side, nStars: stamps.length, peakFrac: psf[R * side + R], fwhmPx: 2.3548 * Math.sqrt((mxx + myy) / 2) };
  }

  /** Bilinear sample of the PSF box at offset (u, v) pixels from its centre (0 outside). */
  function psfAt(P, u, v) {
    if (P.at) return Math.max(0, P.at(u, v));   // SkyFits ePSF (continuous, oversampled)
    const fx = u + P.R, fy = v + P.R, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, s = P.side;
    const g = (x, y) => x < 0 || y < 0 || x >= s || y >= s ? 0 : P.psf[y * s + x];
    return g(x0, y0) * (1 - tx) * (1 - ty) + g(x0 + 1, y0) * tx * (1 - ty) + g(x0, y0 + 1) * (1 - tx) * ty + g(x0 + 1, y0 + 1) * tx * ty;
  }
  /** Pixels a point source of total `sum` (MJy/sr summed over pixels) at (x, y) adds: [[index, value], ...]. */
  function sourcePixels(P, n, x, y, sum) {
    const out = [], X0 = Math.round(x), Y0 = Math.round(y), r = P.R + 1; let tot = 0;
    for (let Y = Y0 - r; Y <= Y0 + r; Y++) for (let X = X0 - r; X <= X0 + r; X++) {
      const w = psfAt(P, X - x, Y - y); tot += w;
      if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
      if (w > 0) out.push([Y * n + X, w]);
    }
    for (const o of out) o[1] *= sum / (tot || 1);   // exactly `sum` in total at any sub-pixel position (minus what falls off the grid)
    return out;
  }

  /* ---------- one trial ---------- */
  /** Median with the rule of SkyFits.medianStack (NaN skipped, needs minValid values, even count = mean of the middle two). */
  function medianOf(vals, minValid) {
    const a = vals.filter(v => v === v); if (a.length < minValid) return NaN;
    a.sort((p, q) => p - q); const m = a.length;
    return m & 1 ? a[m >> 1] : 0.5 * (a[(m >> 1) - 1] + a[m >> 1]);
  }

  /** Context for many trials on one field. epochs: [{frames: [{flat, touched, mjd}], stack: {flat, touched, st}}] for the
      two compared epochs (a = first, b = last). One frame per epoch is fine (then the "stack" is that frame).
      grid {ra0, dec0, s (deg/px), n}. F = SkyFits. The base comparison (no fake planet) is run once here. */
  function makeContext(F, epochs, grid, opts) {
    opts = opts || {};
    const n = grid.n, pixArcsec = grid.s * 3600;
    const tOpts = { maxSep: opts.maxSep ?? 0.25, matchRadius: opts.matchRadius || 2.5 };
    const A = epochs[0].stack, B = epochs[1].stack;
    const base = F.findTransients(A.flat, B.flat, n, grid, { ...tOpts, touchedA: A.touched, touchedB: B.touched });
    // One PSF per compared epoch, measured on that epoch's stack with SkyFits.empiricalPSF (the ePSF checked against the
    // official SPHEREx PSF in test/psf.official.test.js); the simple median-of-boxes buildPSF is only a fallback.
    const fromFits = S => { if (!F.empiricalPSF) return null; const P = F.empiricalPSF(S.flat, n, S.st || F.robustStats(S.flat));
      return P && { psf: P.psf, R: P.half, side: P.size, nStars: P.nStars, peakFrac: P.peakFrac, fwhmPx: P.fwhm, at: P.at, method: 'epsf' }; };
    const psfs = opts.psf ? [opts.psf, opts.psf] : [A, B].map(S => fromFits(S) || buildPSF(S.flat, n, S.st));
    const psf = psfs[0];
    const shapeA = F.starShapeMedian(A.flat, n, A.st), shapeB = F.starShapeMedian(B.flat, n, B.st);
    return { F, epochs, grid, n, pixArcsec, tOpts, base, psf, psfs, shape: [shapeA, shapeB], sharpFrac: opts.sharpFrac || 0.5 };
  }

  /** Hide one fake planet: (x, y) grid position at the time of the first image of epoch a, geocentric distance (AU) and
      brightness (mJy, flat across the band). Returns what the detector made of it. */
  function trial(ctx, planet) {
    const { F, epochs, grid, n, psf } = ctx;
    if (!psf || (ctx.psfs && !ctx.psfs[1])) return { error: 'no PSF: fewer than 5 bright isolated stars' };
    const sky0 = F.gridToSky(planet.x, planet.y, grid), t0 = epochs[0].frames[0].mjd;
    const sum = mJyToPixelSum(planet.mJy, ctx.pixArcsec);
    const out = { mJy: planet.mJy, ab: mJyToAb(planet.mJy), dist: planet.dist, epochs: [] };
    const stacks = [];
    epochs.forEach((ep, e) => {
      const mj = ep.frames.map(f => f.mjd), pos = track(sky0[0], sky0[1], planet.dist, t0, mj).map(p => { const g = F.skyToGrid(p.ra, p.dec, grid); return { ra: p.ra, dec: p.dec, x: g ? g[0] : NaN, y: g ? g[1] : NaN }; });
      const adds = pos.map(p => p.x >= 0 && p.y >= 0 && p.x <= n - 1 && p.y <= n - 1 ? sourcePixels((ctx.psfs && ctx.psfs[e]) || psf, n, p.x, p.y, sum) : []);
      const inside = adds.filter(a => a.length).length;
      // rebuild the stack only where the fake planet touched it
      const flat = Float32Array.from(ep.stack.flat), k = ep.frames.length, minValid = Math.min(k, 3);
      const touchedPx = new Set(); adds.forEach(a => a.forEach(([i]) => touchedPx.add(i)));
      const extra = adds.map(a => new Map(a));
      for (const i of touchedPx) {
        if (k === 1) { const v = ep.frames[0].flat[i]; flat[i] = v === v ? v + (extra[0].get(i) || 0) : NaN; continue; }
        flat[i] = medianOf(ep.frames.map((f, j) => { const v = f.flat[i]; return v === v ? v + (extra[j].get(i) || 0) : NaN; }), minValid);
      }
      const mid = pos[Math.floor(pos.length / 2)];
      out.epochs.push({ frames: k, inside, at: mid, track: pos, spanDays: mj[mj.length - 1] - mj[0],
        moveDuringEpochPx: Math.hypot(pos[pos.length - 1].x - pos[0].x, pos[pos.length - 1].y - pos[0].y) });
      stacks.push({ flat, touched: ep.stack.touched });
    });
    // noise levels of the two stacks and their difference are taken from the base comparison: a fake planet changes a few
    // pixels out of tens of thousands, so re-measuring them for each of >1000 trials only costs time
    const t = F.findTransients(stacks[0].flat, stacks[1].flat, n, grid, { ...ctx.tOpts, touchedA: stacks[0].touched, touchedB: stacks[1].touched, stats: ctx.base.stats });
    const fresh = c => !ctx.base.cands.some(q => q.kind === c.kind && Math.hypot(q.x - c.x, q.y - c.y) <= 1.5);
    const r = ctx.tOpts.matchRadius;
    // epoch a: where it was ("gone"), epoch b: where it is ("new"); a pair counts for both
    const hit = (e, kinds, key) => {
      const p = out.epochs[e].at; if (!(p.x >= 0)) return null;
      const c = t.cands.find(q => kinds.includes(q.kind) && fresh(q) && Math.hypot((key(q).x) - p.x, key(q).y - p.y) <= r);
      if (!c) return null;
      const P = key(c), stk = stacks[e].flat, sh = F.peakShape(stk, n, P.x, P.y), ref = ctx.shape[e];
      const sharp = sh != null && ref ? sh < ctx.sharpFrac * ref.median : false;
      return { snr: c.snr, kind: c.kind, x: P.x, y: P.y, shape: sh, sharp };
    };
    const fa = hit(0, ['gone', 'pair'], q => q.from || q), fb = hit(1, ['new', 'pair'], q => q.to || q);
    out.foundA = !!(fa && !fa.sharp); out.foundB = !!(fb && !fb.sharp); out.hitA = fa; out.hitB = fb;
    out.found = out.foundA || out.foundB;
    out.shiftArcsec = sepArcsec(out.epochs[0].at, out.epochs[1].at);
    out.dtDays = epochs[1].frames[0].mjd - t0;
    out.stacks = stacks;
    return out;
  }

  /** Noise-based expectation: the faintest source whose brightest pixel stands 7 sigma above the difference image
      (the Analyst's limit for a source with no partner). Returns mJy and AB. */
  function expectedLimit(ctx, nsig) {
    nsig = nsig || 7;
    const A = ctx.epochs[0].stack.flat, B = ctx.epochs[1].stack.flat, d = new Float32Array(A.length);
    for (let i = 0; i < d.length; i++) d[i] = A[i] === A[i] && B[i] === B[i] ? B[i] - A[i] : NaN;
    const sd = ctx.F.robustStats(d).sigma, sum = nsig * sd / ctx.psf.peakFrac, f = pixelSumToMJy(sum, ctx.pixArcsec);
    return { mJy: f, ab: mJyToAb(f), sigmaDiff: sd, nsig };
  }

  /** Detectability map: for every distance x brightness, hide the planet at `positions` and count recoveries. Async with
      a progress callback so a browser stays responsive. */
  async function map(ctx, opts) {
    const dists = opts.dists, mags = opts.mags, pos = opts.positions, cells = [];
    let done = 0; const total = dists.length * mags.length * pos.length;
    for (const dist of dists) for (const ab of mags) {
      let found = 0, both = 0;
      for (const p of pos) { const r = trial(ctx, { x: p.x, y: p.y, dist, mJy: abToMJy(ab) }); if (r.found) found++; if (r.foundA && r.foundB) both++; done++; }
      cells.push({ dist, ab, mJy: abToMJy(ab), found, both, of: pos.length });
      if (opts.progress) await opts.progress(done / total);
    }
    // per distance: faintest magnitude still recovered at least half the time
    const limits = dists.map(d => { const ok = cells.filter(c => c.dist === d && c.found / c.of >= 0.5).map(c => c.ab); return { dist: d, ab50: ok.length ? Math.max(...ok) : null }; });
    return { cells, limits, dists, mags, positions: pos.length };
  }

  /** Spread-out trial spots: a seeded grid with jitter, at least `margin` px from the edge, never on NaN pixels. */
  function trialPositions(flat, n, count, margin, seed) {
    let s = seed || 11; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const out = [], m = margin || 20, k = Math.ceil(Math.sqrt(count)), cell = (n - 2 * m) / k;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      if (out.length >= count) break;
      for (let tries = 0; tries < 20; tries++) {
        const x = m + (i + rnd()) * cell, y = m + (j + rnd()) * cell, v = flat[Math.round(y) * n + Math.round(x)];
        if (v === v) { out.push({ x, y }); break; }
      }
    }
    return out;
  }

  return { sunVector, earthVector, track, sepArcsec, orbitArcsecPerYear, abToMJy, mJyToAb, mJyToPixelSum, pixelSumToMJy,
    buildPSF, psfAt, sourcePixels, makeContext, trial, expectedLimit, map, trialPositions };
});
