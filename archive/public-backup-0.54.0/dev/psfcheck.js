/* ARCNAVE developer check: ARCNAVE's PSF vs the official SPHEREx PSF (the "PSF" extension of each image).
   Shared by public/dev/psfcheck.html (live, through the local server) and test/psf.official.test.js (offline fixtures).
   The official PSF (zone of the spot, 10x oversampled) is put on the image's NATIVE detector pixels and sent through
   ARCNAVE's own resampling (F.resample), so it can be compared like for like with the real stars on our grid. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkyPsfCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const med = a => { a = a.filter(x => x != null && x === x).sort((p, r) => p - r); return a.length ? a[a.length >> 1] : null; };
  function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
  /** Shapes of the bright stars (same rule as F.starShapeMedian), with the standard error of their median. */
  function starShapes(F, v, n, st) {
    const lim = st.med + 30 * st.sigma, r = [];
    for (let y = 3; y < n - 3; y++) for (let x = 3; x < n - 3; x++) { const c = v[y * n + x]; if (!(c > lim)) continue;
      let mx = true; for (let j = -1; j <= 1 && mx; j++) for (let i = -1; i <= 1; i++) if ((i || j) && v[(y + j) * n + x + i] >= c) { mx = false; break; }
      if (mx) { const s = F.peakShape(v, n, x, y); if (s != null) r.push(s); } }
    r.sort((p, q) => p - q); const m = r[r.length >> 1], mad = med(r.map(x => Math.abs(x - m)));
    return { med: m, n: r.length, se: 1.4826 * mad * 1.25 / Math.sqrt(r.length) };
  }
  /** Median shape of 40 fakes injected one at a time at blank spots with an ARCNAVE PSF. */
  function fakeShape(F, img, n, P) {
    const pk = F.detectPeaks(img.flat, n, img.st, 3, 5000), blank = new Float32Array(n * n), sh = [], rnd = rng(7);
    for (let k = 0; k < 800 && sh.length < 40; k++) { const x = 12 + rnd() * (n - 24), y = 12 + rnd() * (n - 24);
      if (pk.some(p => Math.hypot(p.x - x, p.y - y) < 8)) continue; sh.push(F.peakShape(F.injectPSF(blank, n, P, x, y, 1000), n, x, y)); }
    return med(sh);
  }
  /** Official PSF plane -> f(dx, dy) in NATIVE pixels. 'sample' = value at the pixel centre; 'integrate' = mean over the pixel. */
  function officialFn(z, mode) {
    const W = z.nx, os = z.oversamp, a = z.data; let sx = 0, sy = 0, sw = 0;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const v = a[y * W + x]; if (v > 0) { sx += v * x; sy += v * y; sw += v; } }
    const cx = sx / sw, cy = sy / sw;
    const bil = (fx, fy) => { if (!(fx >= 0 && fy >= 0 && fx <= W - 1 && fy <= W - 1)) return 0; const x0 = Math.min(Math.floor(fx), W - 2), y0 = Math.min(Math.floor(fy), W - 2), tx = fx - x0, ty = fy - y0;
      return a[y0 * W + x0] * (1 - tx) * (1 - ty) + a[y0 * W + x0 + 1] * tx * (1 - ty) + a[(y0 + 1) * W + x0] * (1 - tx) * ty + a[(y0 + 1) * W + x0 + 1] * tx * ty; };
    if (mode === 'sample') return { f: (dx, dy) => bil(cx + dx * os, cy + dy * os), cx, cy };
    return { f: (dx, dy) => { let s = 0; for (let j = 0; j < os; j++) for (let i = 0; i < os; i++) s += bil(cx + (dx - 0.5 + (i + 0.5) / os) * os, cy + (dy - 0.5 + (j + 0.5) / os) * os); return s / (os * os); }, cx, cy };
  }
  /** 60 copies of f on an empty native image, resampled like prepareCutout; star shape and FWHM measured on our grid. */
  function throughPipeline(F, img, G, fn) {
    const n = G.n, nx = img.nx, ny = img.ny, wcs = F.makeWCS(img.header), nat = new Float32Array(nx * ny), spots = [], rnd = rng(11);
    for (let k = 0; k < 4000 && spots.length < 60; k++) { const x = 12 + rnd() * (nx - 24), y = 12 + rnd() * (ny - 24); if (spots.some(s => Math.hypot(s[0] - x, s[1] - y) < 16)) continue; spots.push([x, y]); }
    for (const [x0, y0] of spots) { const st = []; let tot = 0;
      for (let j = -7; j <= 7; j++) for (let i = -7; i <= 7; i++) { const X = Math.round(x0) + i, Y = Math.round(y0) + j, v = Math.max(0, fn(X - x0, Y - y0)); st.push([X, Y, v]); tot += v; }
      for (const [X, Y, v] of st) if (X >= 0 && Y >= 0 && X < nx && Y < ny) nat[Y * nx + X] += 1000 * v / tot; }
    const g = F.resample(nat, nx, ny, wcs, G); for (let k = 0; k < g.length; k++) if (!(g[k] === g[k])) g[k] = 0;
    const shapes = [];
    for (const [x0, y0] of spots) { const sky = F.pix2sky(wcs, x0 + 1, y0 + 1), p = F.skyToGrid(sky[0], sky[1], G); if (!p || p[0] < 8 || p[1] < 8 || p[0] > n - 9 || p[1] > n - 9) continue; shapes.push(F.peakShape(g, n, p[0], p[1])); }
    const P = F.empiricalPSF(g, n, { med: 0, sigma: 1 }, { method: 'epsf' });
    return { shape: med(shapes), nShapes: shapes.length, fwhmGrid: P ? P.fwhm : null };
  }
  /** Everything for one image. img = F.prepareCutout(...), z = /api/spherex/psf answer, G = the grid. */
  function checkImage(F, img, z, G, opts) {
    opts = opts || {}; const n = G.n, stars = starShapes(F, img.flat, n, img.st);
    const A = officialFn(z, 'sample'), B = officialFn(z, 'integrate');
    const out = { zone: z.zone, headerPlane: z.headerPlane, version: z.version, det: z.det, headerFwhm: z.psfFwhmHeader,
      offFwhmNative: F.fwhmOf(A.f, 5) * 6.15, stars, offSample: throughPipeline(F, img, G, A.f), offInt: throughPipeline(F, img, G, B.f) };
    for (const m of opts.methods || ['epsf', 'model']) { const P = F.empiricalPSF(img.flat, n, img.st, { method: m }); out[m] = P && { fake: fakeShape(F, img, n, P), fwhm: P.fwhm, n: P.nStars }; }
    return out;
  }
  return { starShapes, fakeShape, officialFn, throughPipeline, checkImage, med };
});
