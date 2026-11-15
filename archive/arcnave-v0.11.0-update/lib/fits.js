/* ARCNAVE: FITS parsing, TAN(+SIP) WCS, reprojection, stretch.
   Works in the browser (window.SkyFits) and in Node (require). No dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkyFits = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  /* ---------- FITS container ---------- */
  function parseValue(raw) {
    let s = raw.trim();
    if (s[0] === "'") {
      let out = '', i = 1;
      while (i < s.length) {
        if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } break; }
        out += s[i++];
      }
      return out.trimEnd();
    }
    const slash = s.indexOf('/');
    if (slash >= 0) s = s.slice(0, slash).trim();
    if (s === 'T') return true;
    if (s === 'F') return false;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$/.test(s)) return parseFloat(s.replace(/[dD]/, 'e'));
    return s;
  }

  /** Walk every HDU. Returns [{header, dataStart, dataLen}]. */
  function parseFITS(buf) {
    const u8 = new Uint8Array(buf);
    const dec = new TextDecoder('ascii');
    const hdus = [];
    let pos = 0;
    if (u8.length < 2880 || dec.decode(u8.subarray(0, 6)) !== 'SIMPLE') throw new Error('Not a FITS file');
    while (pos + 2880 <= u8.length) {
      const header = {};
      let ended = false;
      while (pos + 80 <= u8.length) {
        const card = dec.decode(u8.subarray(pos, pos + 80));
        pos += 80;
        const key = card.slice(0, 8).trim();
        if (key === 'END') { ended = true; break; }
        if (card[8] === '=') header[key] = parseValue(card.slice(10));
        else if (key === 'HIERARCH') {
          // ESO HIERARCH convention for long keywords, used by SPHEREx (e.g. "HIERARCH MP_OUTLIER = 19 / ...").
          const m = /^HIERARCH\s+(.+?)\s*=\s?(.*)$/.exec(card);
          if (m) header[m[1].trim()] = parseValue(m[2]);
        }
      }
      if (!ended) throw new Error('Truncated FITS header');
      pos = Math.ceil(pos / 2880) * 2880;
      const naxis = header.NAXIS || 0;
      let prod = naxis ? 1 : 0;
      for (let i = 1; i <= naxis; i++) prod *= header['NAXIS' + i] || 0;
      const dataLen = (Math.abs(header.BITPIX || 8) / 8) * (header.GCOUNT || 1) * ((header.PCOUNT || 0) + prod);
      hdus.push({ header, dataStart: pos, dataLen });
      pos += Math.ceil(dataLen / 2880) * 2880;
    }
    return hdus;
  }

  function findHDU(hdus, name) {
    const hit = hdus.find(h => String(h.header.EXTNAME || '').toUpperCase() === name);
    if (hit) return hit;
    if (name === 'IMAGE') return hdus.find(h => (h.header.NAXIS || 0) >= 2 && h.dataLen > 0 && !h.header.ZIMAGE) || null;
    return null;
  }

  /** Decode an image HDU to Float32Array (BSCALE/BZERO applied, BLANK -> NaN). */
  function readImage(buf, hdu) {
    const h = hdu.header;
    if (h.ZIMAGE) throw new Error('Tile-compressed FITS images are not supported');
    if ((h.NAXIS || 0) < 2) throw new Error('HDU is not a 2-D image');
    const nx = h.NAXIS1, ny = h.NAXIS2, n = nx * ny, bp = h.BITPIX;
    const bytes = Math.abs(bp) / 8;
    if (hdu.dataStart + n * bytes > buf.byteLength) throw new Error('Truncated FITS data');
    const dv = new DataView(buf, hdu.dataStart, n * bytes);
    const bz = h.BZERO || 0, bs = h.BSCALE === undefined ? 1 : h.BSCALE, blank = h.BLANK;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v;
      switch (bp) {
        case -32: v = dv.getFloat32(i * 4, false); break;
        case -64: v = dv.getFloat64(i * 8, false); break;
        case 8: v = dv.getUint8(i); break;
        case 16: v = dv.getInt16(i * 2, false); break;
        case 32: v = dv.getInt32(i * 4, false); break;
        default: throw new Error('Unsupported BITPIX ' + bp);
      }
      out[i] = (bp > 0 && blank !== undefined && v === blank) ? NaN : v * bs + bz;
    }
    return { data: out, nx, ny };
  }

  /** Integer image (e.g. a FLAGS bitmask) as exact unsigned 32-bit values. readImage returns Float32, which cannot hold
      integers above 2^24 exactly, so high flag bits (GHOST, BLOOM, HALO...) would be corrupted there. */
  function readFlags(buf, hdu) {
    const h = hdu.header, nx = h.NAXIS1, ny = h.NAXIS2, n = nx * ny, bp = h.BITPIX;
    if (bp !== 32 && bp !== 16 && bp !== 8) throw new Error('FLAGS must be an integer image, got BITPIX ' + bp);
    const bytes = bp / 8;
    if (hdu.dataStart + n * bytes > buf.byteLength) throw new Error('Truncated FITS data');
    const dv = new DataView(buf, hdu.dataStart, n * bytes), bz = h.BZERO || 0, out = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const v = bp === 32 ? dv.getInt32(i * 4, false) : bp === 16 ? dv.getInt16(i * 2, false) : dv.getUint8(i);
      out[i] = (v + bz) >>> 0;
    }
    return { data: out, nx, ny };
  }

  /* ---------- SPHEREx bad-pixel mask ----------
     The FLAGS extension is a bitmask; its header names each bit with MP_<NAME> = <bit number>. These bits mark pixels whose
     value cannot be trusted (cosmic-ray hits, readout errors, dead/hot pixels, persistence...). Seen on real QR2 data:
     single pixels 1000x brighter than their neighbours, all flagged, which otherwise look like bright "stars".
     MP_SOURCE (a known star sits here), MP_FULLSAMPLE, MP_PHANMISS and MP_DICHROIC (low throughput but calibrated) are kept.
     Two groups: GLITCH bits are single bad pixels, blanked then filled from neighbours; AREA bits mark regions that are
     unreliable for change detection (saturation, bleeding, halos, optical ghosts: a ghost can sit in one epoch only and look
     like a new object), blanked and left blank so nothing is reported there. Newer pipeline versions add GHOST/BLOOM/HALO bits. */
  const GLITCH_FLAGS = ['TRANSIENT', 'SUR_ERROR', 'PHANTOM', 'REFERENCE', 'NONFUNC', 'MISSING_DATA', 'HOT', 'COLD', 'PERSIST', 'OUTLIER', 'SNOWBALL'];
  const AREA_FLAGS = ['OVERFLOW', 'NONLINEAR', 'BLOOM', 'HALO', 'GHOST', 'GHOST_FPA', 'GHOST_EXT'];
  // Bit numbers as found in QR2 FLAGS headers, used only when a file does not name its bits.
  const DEFAULT_FLAG_BITS = { TRANSIENT: 0, OVERFLOW: 1, SUR_ERROR: 2, PHANTOM: 4, REFERENCE: 5, NONFUNC: 6, MISSING_DATA: 9, HOT: 10, COLD: 11,
    NONLINEAR: 15, PERSIST: 17, OUTLIER: 19, GHOST: 22, GHOST_FPA: 23, GHOST_EXT: 24, BLOOM: 26, SNOWBALL: 27, HALO: 28 };
  function badFlagMask(flagHeader) {
    let glitch = 0, area = 0, named = false;
    const bit = nm => { const b = flagHeader && flagHeader['MP_' + nm]; return typeof b === 'number' && b >= 0 && b < 32 ? b : null; };
    for (const nm of GLITCH_FLAGS.concat(AREA_FLAGS)) if (bit(nm) !== null) named = true;
    for (const nm of GLITCH_FLAGS) { const b = named ? bit(nm) : DEFAULT_FLAG_BITS[nm]; if (b !== null && b !== undefined) glitch |= 2 ** b; }
    for (const nm of AREA_FLAGS) { const b = named ? bit(nm) : DEFAULT_FLAG_BITS[nm]; if (b !== null && b !== undefined) area |= 2 ** b; }
    return { glitch, area, mask: glitch + area, named };
  }
  // Flags are unsigned 32-bit; '&' works on them once both sides are taken as 32-bit (bit 31 included), then compared to 0.
  const hasAny = (v, m) => ((v & m) >>> 0) !== 0;
  /** Blank flagged pixels. Glitch pixels with at least 3 good neighbours get their median (up to 3 passes), so a real star next
      to one bad pixel survives. Area pixels and large holes stay NaN and are treated like footprint edges. */
  // MP_OUTLIER marks pixels that differ from the static sky. On real SPHEREx data (field 189.957 -4.182, v0.7 check) the
  // pipeline set it on the pixels of the known asteroid 3865 Lindbloom (V 16.7) in both exposures of one visit, as well as
  // on cosmic-ray hits. So OUTLIER-only pixels are still repaired in the main image (safe comparisons), but their raw values
  // are kept in a second image (keepOutliers) where moving objects are searched for; a repeat in the same visit then tells
  // an asteroid from a cosmic ray.
  function maskBadPixels(data, flags, nx, ny, flagHeader) {
    const { glitch, area, named } = badFlagMask(flagHeader), out = Float32Array.from(data), keep = new Uint8Array(out.length);
    const touched = new Float32Array(out.length);   // 1 where the value was replaced or blanked: changes there cannot be trusted
    const hard = new Float32Array(out.length);      // same, but not counting pixels whose only flag is OUTLIER
    const ob = flagHeader && typeof flagHeader.MP_OUTLIER === 'number' ? flagHeader.MP_OUTLIER : (named ? null : DEFAULT_FLAG_BITS.OUTLIER);
    const outlierBit = ob == null ? 0 : 2 ** ob;
    let nBad = 0, nArea = 0, nFilled = 0, nOutlier = 0;
    for (let i = 0; i < out.length; i++) {
      const f = flags[i]; if (!f) continue;
      if (hasAny(f, area)) { out[i] = NaN; keep[i] = 1; nArea++; touched[i] = 1; hard[i] = 1; }
      else if (hasAny(f, glitch)) {
        out[i] = NaN; nBad++; touched[i] = 1;
        if (outlierBit && hasAny(f, glitch - (glitch & outlierBit)) === false && hasAny(f, outlierBit)) nOutlier++; else hard[i] = 1;
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      const fill = [];
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const i = y * nx + x; if (out[i] === out[i] || keep[i]) continue;
        const nb = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
          const v = out[yy * nx + xx]; if (v === v) nb.push(v);
        }
        if (nb.length >= 3) { nb.sort((a, b) => a - b); fill.push([i, nb[nb.length >> 1]]); }
      }
      if (!fill.length) break;
      for (const [i, v] of fill) out[i] = v;
      nFilled += fill.length;
    }
    // copy with OUTLIER-only pixels back at their measured values
    const kept = Float32Array.from(out);
    for (let i = 0; i < out.length; i++) if (touched[i] && !hard[i]) kept[i] = data[i];
    return { data: out, kept, touched, hard, nBad, nArea, nFilled, nOutlier, named };
  }


  /** One SPHEREx cutout -> analysis-ready grid, exactly as the app uses it: subtract the ZODI model, mask FLAGS bad pixels,
      reproject IMAGE (and the map of repaired pixels) onto the shared tangent grid, remove the residual background plane.
      grid = {ra0, dec0, s, n}. Returns {flat, touched, st, mask, header, nx, ny}. */
  function prepareCutout(buf, grid) {
    const hd = parseFITS(buf), hi = findHDU(hd, 'IMAGE');
    if (!hi) throw new Error('No image extension in the cutout');
    const img = readImage(buf, hi); let data = img.data;
    const hz = findHDU(hd, 'ZODI');
    if (hz && hz !== hi && hz.header.NAXIS1 === img.nx && hz.header.NAXIS2 === img.ny) {
      try { const z = readImage(buf, hz).data; data = data.map((v, k) => v - z[k]); } catch (e) { /* keep raw image */ }
    }
    const wcs = makeWCS(hi.header);
    let touched = null, mask = null, kept = null, hard = null;
    const hf = findHDU(hd, 'FLAGS');
    if (hf && hf.header.NAXIS1 === img.nx && hf.header.NAXIS2 === img.ny) {
      try {
        const m = maskBadPixels(data, readFlags(buf, hf).data, img.nx, img.ny, hf.header);
        data = m.data; touched = resample(m.touched, img.nx, img.ny, wcs, grid); hard = resample(m.hard, img.nx, img.ny, wcs, grid);
        if (m.nOutlier) kept = m.kept;
        mask = { glitch: m.nBad, area: m.nArea, filled: m.nFilled, outlierOnly: m.nOutlier };
      } catch (e) { /* unreadable flags: keep the raw image */ }
    }
    const flat = flatten(resample(data, img.nx, img.ny, wcs, grid), grid.n);
    // flatKeep: same image with OUTLIER-only pixels at their measured values (for finding movers); null when identical
    const flatKeep = kept ? flatten(resample(kept, img.nx, img.ny, wcs, grid), grid.n) : null;
    return { flat, flatKeep, touched, touchedHard: hard, st: robustStats(flat), mask, header: hi.header, hdus: hd, nx: img.nx, ny: img.ny };
  }

  /* ---------- TAN (+SIP) WCS. Pixel coordinates are FITS 1-based. ---------- */
  function sipTerms(h, L) {
    const order = h[L + '_ORDER'];
    if (order === undefined) return null;
    const t = [];
    for (let p = 0; p <= order; p++) for (let q = 0; p + q <= order; q++) {
      const c = h[`${L}_${p}_${q}`];
      if (c) t.push({ p, q, c });
    }
    return t;
  }

  function makeWCS(h) {
    const ct = String(h.CTYPE1 || '');
    if (!/TAN/.test(ct)) throw new Error('Unsupported WCS projection: ' + (ct || 'none'));
    const crpix = [h.CRPIX1, h.CRPIX2], crval = [h.CRVAL1, h.CRVAL2];
    if ([...crpix, ...crval].some(v => typeof v !== 'number')) throw new Error('Incomplete WCS header');
    let cd;
    if (h.CD1_1 !== undefined) cd = [[h.CD1_1, h.CD1_2 || 0], [h.CD2_1 || 0, h.CD2_2]];
    else {
      const d1 = h.CDELT1, d2 = h.CDELT2;
      cd = [[d1 * (h.PC1_1 ?? 1), d1 * (h.PC1_2 ?? 0)], [d2 * (h.PC2_1 ?? 0), d2 * (h.PC2_2 ?? 1)]];
    }
    const det = cd[0][0] * cd[1][1] - cd[0][1] * cd[1][0];
    if (!det) throw new Error('Singular WCS matrix');
    const inv = [[cd[1][1] / det, -cd[0][1] / det], [-cd[1][0] / det, cd[0][0] / det]];
    const a = sipTerms(h, 'A'), b = sipTerms(h, 'B');
    return { crpix, crval, cd, inv, sipA: a && b ? a : null, sipB: a && b ? b : null };
  }

  function sip(terms, u, v) {
    let s = 0;
    for (const t of terms) s += t.c * Math.pow(u, t.p) * Math.pow(v, t.q);
    return s;
  }

  function tanInv(xi, eta, ra0, dec0) {
    const x = xi * D2R, y = eta * D2R, r = Math.hypot(x, y);
    if (r === 0) return [ra0, dec0];
    const p0 = dec0 * D2R, c = Math.atan(r), sc = Math.sin(c), cc = Math.cos(c), sp0 = Math.sin(p0), cp0 = Math.cos(p0);
    const dec = Math.asin(cc * sp0 + (y * sc * cp0) / r);
    const ra = ra0 * D2R + Math.atan2(x * sc, r * cp0 * cc - y * sp0 * sc);
    return [((ra * R2D) % 360 + 360) % 360, dec * R2D];
  }

  function tanFwd(ra, dec, ra0, dec0) {
    const l = (ra - ra0) * D2R, p = dec * D2R, p0 = dec0 * D2R;
    const cc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
    if (cc <= 1e-9) return null;
    return [(Math.cos(p) * Math.sin(l) / cc) * R2D,
            ((Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l)) / cc) * R2D];
  }

  function pix2sky(w, x, y) {
    let u = x - w.crpix[0], v = y - w.crpix[1];
    if (w.sipA) { const du = sip(w.sipA, u, v), dv = sip(w.sipB, u, v); u += du; v += dv; }
    return tanInv(w.cd[0][0] * u + w.cd[0][1] * v, w.cd[1][0] * u + w.cd[1][1] * v, w.crval[0], w.crval[1]);
  }

  function sky2pix(w, ra, dec) {
    const t = tanFwd(ra, dec, w.crval[0], w.crval[1]);
    if (!t) return null;
    const u2 = w.inv[0][0] * t[0] + w.inv[0][1] * t[1], v2 = w.inv[1][0] * t[0] + w.inv[1][1] * t[1];
    let u = u2, v = v2;
    if (w.sipA) for (let k = 0; k < 8; k++) { const du = sip(w.sipA, u, v), dv = sip(w.sipB, u, v); u = u2 - du; v = v2 - dv; }
    return [u + w.crpix[0], v + w.crpix[1]];
  }

  /* ---------- Reprojection onto a tangent-plane grid centred on (ra0,dec0) ----------
     Grid pixel (gx,gy): xi grows with gx (towards increasing RA), eta grows upward (gy down). */
  function resample(img, nx, ny, wcs, grid) {
    const { ra0, dec0, s, n } = grid, c = (n - 1) / 2;
    const out = new Float32Array(n * n).fill(NaN);
    for (let gy = 0; gy < n; gy++) {
      const eta = (c - gy) * s;
      for (let gx = 0; gx < n; gx++) {
        const sky = tanInv((gx - c) * s, eta, ra0, dec0);
        const p = sky2pix(wcs, sky[0], sky[1]);
        if (!p) continue;
        const fx = p[0] - 1, fy = p[1] - 1;
        if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) continue;
        const x0 = Math.min(Math.floor(fx), nx - 2), y0 = Math.min(Math.floor(fy), ny - 2);
        const tx = fx - x0, ty = fy - y0;
        const v = [img[y0 * nx + x0], img[y0 * nx + x0 + 1], img[(y0 + 1) * nx + x0], img[(y0 + 1) * nx + x0 + 1]];
        const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
        let sum = 0, ws = 0;
        for (let k = 0; k < 4; k++) if (v[k] === v[k]) { sum += v[k] * w[k]; ws += w[k]; }
        if (ws > 0) out[gy * n + gx] = sum / ws;
      }
    }
    return out;
  }

  /* ---------- Background and stretch ---------- */
  function median(a) { const b = Array.from(a).sort((x, y) => x - y); return b[b.length >> 1]; }

  function fitPlane(pts) {
    const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (const [x, y, z] of pts) {
      const r = [1, x, y];
      for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; M[i][3] += r[i] * z; }
    }
    for (let i = 0; i < 3; i++) {
      let piv = i;
      for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      [M[i], M[piv]] = [M[piv], M[i]];
      if (Math.abs(M[i][i]) < 1e-12) return [0, 0, 0];
      for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  /** Remove a sigma-clipped best-fit plane (residual zodiacal gradient). NaNs are kept. */
  function flatten(a, n) {
    const step = Math.max(1, Math.floor(Math.sqrt(a.length / 4000)));
    const pts = [];
    for (let y = 0; y < n; y += step) for (let x = 0; x < n; x += step) {
      const v = a[y * n + x];
      if (v === v) pts.push([x / n - 0.5, y / n - 0.5, v]);
    }
    let c = [median(pts.map(p => p[2])) || 0, 0, 0];
    if (pts.length >= 20) {
      let keep = pts;
      for (let it = 0; it < 4; it++) {
        c = fitPlane(keep);
        const res = pts.map(p => p[2] - (c[0] + c[1] * p[0] + c[2] * p[1]));
        const sd = 1.4826 * median(res.map(Math.abs)) || 1e-12;
        const k2 = pts.filter((p, i) => Math.abs(res[i]) < 3 * sd);
        if (k2.length < 20) break;
        keep = k2;
      }
    }
    const out = new Float32Array(a.length);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = a[y * n + x];
      out[y * n + x] = v === v ? v - (c[0] + c[1] * (x / n - 0.5) + c[2] * (y / n - 0.5)) : NaN;
    }
    return out;
  }

  function robustStats(arr) {
    const step = Math.max(1, Math.floor(arr.length / 20000)), tmp = new Float64Array(Math.ceil(arr.length / step));
    let m = 0;
    for (let i = 0; i < arr.length; i += step) if (arr[i] === arr[i]) tmp[m++] = arr[i];
    if (m < 10) return null;
    // Typed-array sort (no comparator) gives the same order as the numeric comparator sort, about 8x faster; the Hide Planet X
    // map calls this 3x per fake planet, over a thousand fake planets.
    const v = tmp.subarray(0, m).sort();
    const med = v[v.length >> 1];
    const dev = new Float64Array(m); for (let i = 0; i < m; i++) dev[i] = Math.abs(v[i] - med); dev.sort();
    return { med, sigma: 1.4826 * dev[dev.length >> 1] || 1e-9, hi: v[Math.floor(v.length * 0.995)] };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
  }

  /** flat image -> RGBA bytes. Colour is a single false-colour hue (the image is one wavelength). */
  function renderRGBA(flat, st, rgb) {
    const out = new Uint8ClampedArray(flat.length * 4);
    if (!st) return out;
    const soft = 2 * st.sigma, top = Math.max(st.hi, 5 * st.sigma), norm = Math.asinh(top / soft);
    for (let i = 0; i < flat.length; i++) {
      const v = flat[i], o = i * 4;
      if (v !== v) continue;
      let t = Math.asinh(Math.max(v, -st.sigma) / soft) / norm;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const w = Math.pow(Math.max(0, (t - 0.6) / 0.4), 2);
      out[o] = 6 + rgb[0] * t + (255 - rgb[0]) * w;
      out[o + 1] = 10 + rgb[1] * t + (255 - rgb[1]) * w;
      out[o + 2] = 24 + rgb[2] * t + (255 - rgb[2]) * w;
      out[o + 3] = 255;
    }
    return out;
  }

  /** B minus A (both flattened). Brighter in B = orange, fainter in B = cyan. Stars cancel, movers leave a pair. */
  function renderDiff(fa, fb) {
    const d = new Float32Array(fa.length);
    for (let i = 0; i < d.length; i++) d[i] = fa[i] === fa[i] && fb[i] === fb[i] ? fb[i] - fa[i] : NaN;
    const st = robustStats(d), out = new Uint8ClampedArray(d.length * 4);
    if (!st) return { rgba: out, stats: null };
    const scale = 6 * st.sigma;
    for (let i = 0; i < d.length; i++) {
      const v = d[i], o = i * 4;
      if (v !== v) continue;
      const t = Math.max(-1, Math.min(1, (v - st.med) / scale)), m = Math.abs(t);
      const c = t >= 0 ? [255, 176, 90] : [95, 227, 240];
      out[o] = 6 + c[0] * m; out[o + 1] = 10 + c[1] * m; out[o + 2] = 24 + c[2] * m; out[o + 3] = 255;
    }
    return { rgba: out, stats: st };
  }

  /* ---------- Analysis: find change between two aligned, flattened grids ---------- */
  /** Peaks of |B-A| above k sigma. Positive = brighter in B, negative = brighter in A. Pixel coords are 0-based grid indices. */
  function findSources(fa, fb, n, k) {
    k = k || 6;
    const d = new Float32Array(n * n);
    for (let i = 0; i < d.length; i++) d[i] = fa[i] === fa[i] && fb[i] === fb[i] ? fb[i] - fa[i] : NaN;
    const st = robustStats(d);
    if (!st) return { srcs: [], sigma: 0, med: 0 };
    const thr = k * st.sigma, R = 2, found = [];
    for (let y = R + 1; y < n - R - 1; y++) for (let x = R + 1; x < n - R - 1; x++) {
      const v = d[y * n + x] - st.med;
      if (!(Math.abs(v) > thr)) continue;
      let ok = true, sw = 0, sx = 0, sy = 0;
      for (let dy = -R; dy <= R && ok; dy++) for (let dx = -R; dx <= R; dx++) {
        const w = d[(y + dy) * n + x + dx] - st.med;
        if (w !== w) { ok = false; break; }                       // too close to the edge of the footprint
        if (Math.sign(w) === Math.sign(v)) {
          if (Math.abs(w) > Math.abs(v)) { ok = false; break; }    // not the local maximum
          sw += Math.abs(w); sx += Math.abs(w) * (x + dx); sy += Math.abs(w) * (y + dy);
        }
      }
      if (ok && sw > 0) found.push({ x: sx / sw, y: sy / sw, snr: v / st.sigma });
    }
    found.sort((p, q) => Math.abs(q.snr) - Math.abs(p.snr));
    const srcs = [];
    for (const f of found) { if (!srcs.some(s => Math.hypot(s.x - f.x, s.y - f.y) < 2.5 && Math.sign(s.snr) === Math.sign(f.snr))) srcs.push(f); if (srcs.length >= 80) break; }
    return { srcs, sigma: st.sigma, med: st.med };
  }

  /** Match positive and negative peaks into mover pairs. Pairs closer than minSep are star residuals (dipoles), not movers. */
  function pairUp(srcs, minSep, maxSep) {
    const pos = srcs.filter(s => s.snr > 0), neg = srcs.filter(s => s.snr < 0), used = new Set(), pairs = [];
    let dipoles = 0;
    for (const p of pos) {
      let best = null, bd = 1e9;
      for (const q of neg) {
        if (used.has(q)) continue;
        const sep = Math.hypot(p.x - q.x, p.y - q.y), ratio = Math.abs(p.snr / q.snr);
        if (sep <= maxSep && ratio > 0.33 && ratio < 3 && sep < bd) { bd = sep; best = q; }
      }
      if (!best) continue;
      used.add(best); used.add(p);
      if (bd < minSep) dipoles++; else pairs.push({ pos: p, neg: best, sep: bd });
    }
    const single = srcs.filter(s => !used.has(s));
    return { pairs, dipoles, single };
  }

  /* ---------- Agent toolkit: grid <-> sky, registration, source lists, change detection ---------- */
  /** Grid pixel (0-based, as produced by resample) <-> sky. g = {ra0, dec0, s (deg/px), n}. */
  function skyToGrid(ra, dec, g) {
    const t = tanFwd(ra, dec, g.ra0, g.dec0), c = (g.n - 1) / 2;
    return t ? [c + t[0] / g.s, c - t[1] / g.s] : null;
  }
  function gridToSky(x, y, g) {
    if (!g || !(g.s > 0) || !(g.n > 0)) return [NaN, NaN];
    const c = (g.n - 1) / 2;
    return tanInv((x - c) * g.s, (c - y) * g.s, g.ra0, g.dec0);
  }

  /** Highest value in the 3x3 around (x,y). -Infinity when there is no valid pixel there. */
  function sampleMax(a, n, x, y) {
    const xi = Math.round(x), yi = Math.round(y);
    let m = -Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = xi + dx, yy = yi + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const v = a[yy * n + xx];
      if (v === v && v > m) m = v;
    }
    return m;
  }
  /** Signal-to-noise of the brightest pixel near (x,y), or null when there is no data. */
  function snrAt(a, n, st, x, y) {
    const m = sampleMax(a, n, x, y);
    return m === -Infinity ? null : (m - st.med) / st.sigma;
  }

  /** Point sources: 3x3 local maxima above nsig robust sigmas, with a 3x3 centroid. Sorted brightest first. */
  function detectPeaks(a, n, st, nsig, max) {
    nsig = nsig || 5; max = max || 400;
    const thr = st.med + nsig * st.sigma, out = [];
    for (let y = 2; y < n - 2; y++) for (let x = 2; x < n - 2; x++) {
      const v = a[y * n + x];
      if (!(v > thr)) continue;
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const w = a[(y + dy) * n + x + dx];
        if (w > v || (w === v && (dy < 0 || (dy === 0 && dx < 0)))) { ok = false; break; }
      }
      if (!ok) continue;
      let sx = 0, sy = 0, sw = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const w = a[(y + dy) * n + x + dx] - st.med;
        if (w > 0) { sx += w * (x + dx); sy += w * (y + dy); sw += w; }
      }
      out.push({ x: sx / sw, y: sy / sw, flux: v - st.med, snr: (v - st.med) / st.sigma });
    }
    out.sort((p, q) => q.flux - p.flux);
    return out.slice(0, max);
  }

  /** Translate image content by (dx,dy) pixels (bilinear): out(x,y) = img(x-dx, y-dy). Uncovered pixels are NaN. */
  function shiftImage(a, n, dx, dy) {
    const out = new Float32Array(a.length).fill(NaN);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x - dx, fy = y - dy;
      if (fx < 0 || fy < 0 || fx > n - 1 || fy > n - 1) continue;
      const x0 = Math.min(Math.floor(fx), n - 2), y0 = Math.min(Math.floor(fy), n - 2), tx = fx - x0, ty = fy - y0;
      const v = [a[y0 * n + x0], a[y0 * n + x0 + 1], a[(y0 + 1) * n + x0], a[(y0 + 1) * n + x0 + 1]];
      const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      let s = 0, ws = 0;
      for (let k = 0; k < 4; k++) if (v[k] === v[k]) { s += v[k] * w[k]; ws += w[k]; }
      if (ws > 0) out[y * n + x] = s / ws;
    }
    return out;
  }

  /** Registration by normalised cross-correlation over integer shifts, then a parabola for the sub-pixel part.
      Returns the translation to APPLY to B so that it lands on A: shiftImage(B, n, dx, dy). ncc is the match quality (0..1). */
  function estimateShift(A, B, n, maxShift) {
    const R = maxShift || 6, w = 2 * R + 1, cc = new Float64Array(w * w);
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      let s = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = Math.max(0, -oy); y < Math.min(n, n - oy); y++) {
        const ra = y * n, rb = (y + oy) * n + ox;
        for (let x = Math.max(0, -ox); x < Math.min(n, n - ox); x++) {
          const a = A[ra + x], b = B[rb + x];
          if (a !== a || b !== b) continue;
          s++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
        }
      }
      const va = saa - sa * sa / s, vb = sbb - sb * sb / s;
      cc[(oy + R) * w + ox + R] = s > 50 && va > 0 && vb > 0 ? (sab - sa * sb / s) / Math.sqrt(va * vb) : -1;
    }
    let bi = 0;
    for (let i = 1; i < cc.length; i++) if (cc[i] > cc[bi]) bi = i;
    const bx = bi % w, by = (bi - bx) / w, peak = cc[bi];
    const vertex = (m, c, p) => { const d = m - 2 * c + p; return d < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (m - p) / d)) : 0; };
    const sx = bx > 0 && bx < w - 1 ? vertex(cc[by * w + bx - 1], peak, cc[by * w + bx + 1]) : 0;
    const sy = by > 0 && by < w - 1 ? vertex(cc[(by - 1) * w + bx], peak, cc[(by + 1) * w + bx]) : 0;
    return { dx: -(bx - R + sx), dy: -(by - R + sy), ncc: peak, ok: peak > 0.2, edge: bx === 0 || by === 0 || bx === w - 1 || by === w - 1 };
  }

  /** True when a 0..1 "touched" grid exceeds 0.05 anywhere within r px of (x,y). */
  function nearTouched(t, n, x, y, r) {
    const xi = Math.round(x), yi = Math.round(y);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = xi + dx, yy = yi + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      if (t[yy * n + xx] > 0.05) return true;
    }
    return false;
  }

  /** True when any pixel within r of (x,y) is NaN or off the grid: the source sits on a footprint edge, where
      reprojection and background fitting are least reliable. */
  function nearEdge(a, n, x, y, r) {
    const xi = Math.round(x), yi = Math.round(y);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = xi + dx, yy = yi + dy;
      if (xx < 0 || yy < 0 || xx >= n || yy >= n) return true;
      const v = a[yy * n + xx];
      if (v !== v) return true;
    }
    return false;
  }

  /** Registration from matched stars: the median offset between bright peaks of A and their nearest B peak (within maxR px).
      More robust than cross-correlation for SPHEREx, whose stars are about one pixel wide and whose epochs differ in colour.
      Returns the translation to APPLY to B (same convention as estimateShift), the number of matched stars and the scatter. */
  function alignByStars(A, B, n, opts) {
    opts = opts || {};
    const stA = robustStats(A), stB = robustStats(B);
    if (!stA || !stB) return { ok: false, dx: 0, dy: 0, nMatch: 0, method: 'stars' };
    const maxR = opts.maxR || 2, top = opts.top || 150;
    const pa = detectPeaks(A, n, stA, 10, top);
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    const measure = (Bc, stc) => {
      const pb = detectPeaks(Bc, n, stc, 10, top * 2), offs = [];
      for (const p of pa) {
        let best = null, bd = maxR;
        for (const q of pb) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }
        if (best) offs.push([best.x - p.x, best.y - p.y]);
      }
      return offs;
    };
    // A 3x3 centroid is pulled towards pixel centres, so one pass under-estimates a shift of ~1 px by ~0.2 px. Apply the
    // estimate, measure what is left, repeat: the residual (and its bias) shrinks each time.
    let dx = 0, dy = 0, offs = measure(B, stB), spread = 0;
    for (let it = 0; it < 4; it++) {
      if (offs.length < (opts.minMatch || 8)) return { ok: false, dx: 0, dy: 0, nMatch: offs.length, method: 'stars' };
      const mx = med(offs.map(o => o[0])), my = med(offs.map(o => o[1]));
      spread = med(offs.map(o => Math.hypot(o[0] - mx, o[1] - my)));
      dx -= mx; dy -= my;
      if (Math.hypot(mx, my) < 0.01) break;
      const Bs = shiftImage(B, n, dx, dy);
      offs = measure(Bs, robustStats(Bs) || stB);
    }
    return { ok: true, dx, dy, nMatch: offs.length, spread, method: 'stars' };
  }

  /** Compare two registered, flattened grids by their source lists (stars never produce candidates, only real change does).
      kind 'pair'  = a source vanished at `from` and one appeared at `to`, within maxSep px. The caller sets maxSep from physics
                     (how far anything can move in the time between the images). maxSep below matchRadius turns pairing off.
      kind 'new'   = bright in B, no counterpart in A.   kind 'gone' = bright in A, no counterpart in B.
      Also returns quality numbers: matched = sources seen in both epochs; nearMiss = vanished/appeared sources that sit
      2.5 to 12 px from each other. Many near misses mean the epochs do not line up locally, so every "change" is suspect. */
  function findTransients(A, B, n, grid, opts) {
    opts = opts || {};
    const empty = (sa, sb) => ({ cands: [], sourcesA: sa, sourcesB: sb, matched: 0, nearMiss: 0, edgeRejected: 0, flagRejected: 0, pairSearch: false });
    const stA = opts.stats ? opts.stats.A : robustStats(A), stB = opts.stats ? opts.stats.B : robustStats(B);
    if (!stA || !stB) return empty(0, 0);
    const pa = detectPeaks(A, n, stA, 5, 600), pb = detectPeaks(B, n, stB, 5, 600);
    const near = opts.matchRadius || 2.5, maxSep = opts.maxSep ?? 12, lone = opts.loneSnr || 7;
    const edgeR = opts.edgePx ?? 4, missMax = opts.nearMissPx || 12;
    const pairSearch = maxSep > near;
    const g = grid && grid.s > 0 ? { ra0: grid.ra0, dec0: grid.dec0, s: grid.s, n } : null;
    // Changes are found as peaks of the difference image itself (B-A for "appeared", A-B for "vanished"), not by comparing
    // the two source lists: a new object 3 px from a star blends with it in B and has no peak of its own there, but in B-A
    // the star cancels and the object stands alone.
    const D = new Float32Array(A.length), ND = new Float32Array(A.length);
    for (let i = 0; i < D.length; i++) { const v = A[i] === A[i] && B[i] === B[i] ? B[i] - A[i] : NaN; D[i] = v; ND[i] = -v; }
    const stD = opts.stats ? opts.stats.D : robustStats(D);
    if (!stD) return empty(pa.length, pb.length);
    const dPos = detectPeaks(D, n, stD, 5, 600), dNeg = detectPeaks(ND, n, { med: -stD.med, sigma: stD.sigma }, 5, 600);
    // A difference peak is "explained" (not a change) when the other epoch has a source right there that is at least as bright
    // as the change: an ordinary star that got somewhat brighter/fainter (colour, variability) or a small alignment residual.
    // A new object sitting on a much fainter star is NOT explained, so it is still found. Interpolation also leaves a faint
    // ring about 3 px around bright stars, so a peak within 2*near of a source at least 5x brighter is a residual too.
    // (Trade-off: a faint new object within 5 px of a star 5x brighter than it is not reported.)
    const explained = (list, p) => list.some(q => { const d = Math.hypot(q.x - p.x, q.y - p.y); return (d <= near && q.flux >= p.flux) || (d <= 2 * near && q.flux >= 5 * p.flux); });
    const edge = p => edgeR > 0 && (nearEdge(A, n, p.x, p.y, edgeR) || nearEdge(B, n, p.x, p.y, edgeR));
    // A change where either epoch had flagged pixels (replaced by their neighbours) may just be the repair: a star whose
    // own pixels were flagged loses its peak, which looks like it vanished. Such changes are counted, not reported.
    const tA = opts.touchedA, tB = opts.touchedB, flagR = opts.flagPx ?? 2;
    const touched = p => [tA, tB].some(t => t && sampleMax(t, n, p.x, p.y) > 0.05 || t && flagR > 1 && nearTouched(t, n, p.x, p.y, flagR));
    let flagRejected = 0;
    const gone = [], fresh = [];
    let edgeRejected = 0;
    // matched = sources seen in both epochs at about the same brightness (for the reliability check)
    const matched = pa.filter(p => pb.some(q => Math.hypot(q.x - p.x, q.y - p.y) <= near && q.flux > 0.5 * p.flux && q.flux < 2 * p.flux)).length;
    for (const p of dNeg) {
      if (explained(pb, p)) continue;
      if (edge(p)) { edgeRejected++; continue; }
      if (touched(p)) { flagRejected++; continue; }
      gone.push(p);
    }
    for (const p of dPos) {
      if (explained(pa, p)) continue;
      if (edge(p)) { edgeRejected++; continue; }
      if (touched(p)) { flagRejected++; continue; }
      fresh.push(p);
    }
    const at = p => { const s = gridToSky(p.x, p.y, g); return { x: p.x, y: p.y, ra: s[0], dec: s[1] }; };
    const allLinks = [];
    for (const a of gone) for (const b of fresh) { const d = Math.hypot(b.x - a.x, b.y - a.y); if (d <= Math.max(maxSep, missMax)) allLinks.push({ a, b, d }); }
    allLinks.sort((p, q) => p.d - q.d);
    // Near misses, counted one-to-one whatever maxSep is.
    let nearMiss = 0;
    { const ua = new Set(), ub = new Set(); for (const l of allLinks) { if (l.d > missMax || ua.has(l.a) || ub.has(l.b)) continue; ua.add(l.a); ub.add(l.b); nearMiss++; } }
    const ua = new Set(), ub = new Set(), cands = [];
    if (pairSearch) for (const l of allLinks) {
      if (l.d > maxSep || ua.has(l.a) || ub.has(l.b)) continue;
      ua.add(l.a); ub.add(l.b);
      const to = at(l.b);
      cands.push({ kind: 'pair', x: to.x, y: to.y, ra: to.ra, dec: to.dec, from: at(l.a), to, sepPx: l.d, snr: Math.min(l.a.snr, l.b.snr) });
    }
    for (const p of fresh) if (!ub.has(p) && p.snr >= lone) cands.push({ kind: 'new', ...at(p), sepPx: 0, snr: p.snr });
    for (const p of gone) if (!ua.has(p) && p.snr >= lone) cands.push({ kind: 'gone', ...at(p), sepPx: 0, snr: p.snr });
    cands.sort((p, q) => (p.kind === 'pair' ? 0 : 1) - (q.kind === 'pair' ? 0 : 1) || q.snr - p.snr);
    return { cands: cands.slice(0, 50), sourcesA: pa.length, sourcesB: pb.length, matched, nearMiss, edgeRejected, flagRejected, pairSearch, stats: { A: stA, B: stB, D: stD } };
  }

  /* ---------- several images per epoch (v0.6) ---------- */

  /** Pixel-wise median of aligned images (NaN = no data). A pixel needs data in at least minValid images (default
      min(k,3)), so one image cannot decide it alone: a cosmic ray or a fast mover present in a single image is removed.
      touched = fraction of images whose pixel was repaired from flagged neighbours. */
  function medianStack(flats, n, opts) {
    opts = opts || {};
    const k = flats.length, minValid = opts.minValid || Math.min(k, 3), N = n * n;
    const out = new Float32Array(N).fill(NaN), count = new Uint8Array(N), touched = new Float32Array(N);
    const buf = new Float64Array(k), tz = opts.touched || [];
    for (let i = 0; i < N; i++) {
      let m = 0, t = 0;
      for (let j = 0; j < k; j++) { const v = flats[j][i]; if (v === v) buf[m++] = v; if (tz[j] && tz[j][i] > 0.05) t++; }
      count[i] = m; touched[i] = k ? t / k : 0;
      if (m < minValid) continue;
      const a = Array.prototype.slice.call(buf, 0, m).sort((x, y) => x - y);
      out[i] = m & 1 ? a[m >> 1] : 0.5 * (a[(m >> 1) - 1] + a[m >> 1]);
    }
    return { flat: out, count, touched };
  }

  /** Shape of a peak: mean of the 4 side neighbours / peak, after moving to the local maximum within 1 px. Anything on the
      sky is blurred by the telescope, so it cannot be much sharper than the stars of the same image. null at edges. */
  function peakShape(v, n, x, y) {
    let bx = Math.round(x), by = Math.round(y);
    const X0 = bx, Y0 = by;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const X = X0 + i, Y = Y0 + j;
      if (X > 0 && Y > 0 && X < n - 1 && Y < n - 1 && v[Y * n + X] > (v[by * n + bx] === v[by * n + bx] ? v[by * n + bx] : -Infinity)) { bx = X; by = Y; }
    }
    if (bx < 1 || by < 1 || bx > n - 2 || by > n - 2) return null;
    const c = v[by * n + bx]; if (!(c > 0)) return null;
    const s = v[(by - 1) * n + bx] + v[(by + 1) * n + bx] + v[by * n + bx - 1] + v[by * n + bx + 1];
    return s === s ? s / (4 * c) : null;
  }
  /** Median shape of the bright stars (local maxima above 30 sigma) of an image; null if fewer than 8. */
  function starShapeMedian(v, n, st) {
    const lim = st.med + 30 * st.sigma, r = [];
    for (let y = 3; y < n - 3; y++) for (let x = 3; x < n - 3; x++) {
      const c = v[y * n + x]; if (!(c > lim)) continue;
      let max = true;
      for (let j = -1; j <= 1 && max; j++) for (let i = -1; i <= 1; i++) if ((i || j) && v[(y + j) * n + x + i] >= c) { max = false; break; }
      if (max) { const q = peakShape(v, n, x, y); if (q != null) r.push(q); }
    }
    if (r.length < 8) return null;
    r.sort((a, b) => a - b);
    return { median: r[r.length >> 1], n: r.length };
  }

  /** Sources that are in image j but NOT at the same spot in the epoch's images taken at another visit (more than
      opts.visitDays apart, default 0.1 d = 2.4 h; a main-belt asteroid moves about 10 SPHEREx pixels in that time). Stars are
      in every image, so they drop out; what is left is something that moved, or an artefact (checked by shape).
      frames: [{flat, st, touched, mjd}]. Images of the same visit (minutes apart) should show the source too: counted. */
  function singleVisitSources(frames, j, n, opts) {
    opts = opts || {};
    const me = frames[j], nsig = opts.nsig || 7, visit = opts.visitDays ?? 0.1, edgeR = opts.edgePx ?? 4;
    const img = f => f.flatKeep || f.flat;   // OUTLIER pixels kept: the pipeline flags moving objects as OUTLIER too
    const others = frames.filter((f, k) => k !== j && Math.abs(f.mjd - me.mjd) > visit);
    const mates = frames.filter((f, k) => k !== j && Math.abs(f.mjd - me.mjd) <= visit);
    if (others.length < 2) return { sources: [], others: others.length, reason: 'fewer than 2 other visits' };
    const shapeRef = starShapeMedian(me.flat, n, me.st), sharpFrac = opts.sharpFrac || 0.5;
    const peaks = detectPeaks(img(me), n, me.st, nsig, 400), out = [];
    let starLike = 0, edge = 0, flagged = 0, sharp = 0, single = 0;
    for (const p of peaks) {
      const snrs = [];
      for (const o of others) { const s = snrAt(o.flat, n, o.st, p.x, p.y); if (s !== null) snrs.push(s); }
      if (snrs.length < 2) { edge++; continue; }
      snrs.sort((a, b) => a - b);
      const present = snrs.filter(s => s >= 3).length;
      // present at this spot in other visits -> a star (or something fixed): not a mover
      if (snrs[snrs.length >> 1] >= 2 || present > Math.floor(0.25 * snrs.length)) { starLike++; continue; }
      if (edgeR > 0 && nearEdge(me.flat, n, p.x, p.y, edgeR)) { edge++; continue; }
      const hardMap = me.touchedHard || me.touched;
      if (hardMap && nearTouched(hardMap, n, p.x, p.y, 2)) { flagged++; continue; }
      // Repeat check: images of the same visit are minutes apart, so an asteroid is still (almost) at the same spot with a
      // similar brightness; a cosmic ray or glint is in one exposure only.
      const need = Math.max(3, 0.2 * p.snr);
      const mateSeen = mates.filter(m => { const s = snrAt(img(m), n, m.st, p.x, p.y); return s !== null && s >= need; }).length;
      const repeat = mates.length ? mateSeen > 0 : null;
      const shape = peakShape(img(me), n, p.x, p.y), shapeOk = shapeRef && shape != null ? shape >= sharpFrac * shapeRef.median : null;
      if (repeat === false) { single++; continue; }
      // Without a mate exposure the shape is the only artefact test; with a repeat, the repeat wins (SPHEREx stars are
      // undersampled, so a source centred on one pixel can look sharper than the median star).
      if (repeat === null && shapeOk === false) { sharp++; continue; }
      // A hot pixel also "repeats" (same pointing, same detector pixel, minutes apart). Live field 189.957 -4.182: repeated
      // sources with shape 0.05 to 0.13 next to stars at 0.42; the confirmed asteroid 3865 Lindbloom had 0.23 and 0.34.
      // So repeated sources still need at least 0.35 x the stars' median.
      if (repeat === true && shapeRef && shape != null && shape < (opts.repeatSharpFrac || 0.35) * shapeRef.median) { sharp++; continue; }
      out.push({ x: p.x, y: p.y, snr: p.snr, flux: p.flux, shape, shapeOk, repeat, otherVisits: snrs.length, mates: mates.length, matesSeen: mateSeen });
    }
    return { sources: out, others: others.length, starLike, edge, flagged, sharp, single, shapeRef };
  }


  /** Colours that add up to white: 2 epochs cyan + red, 3 epochs blue + green + red, more: hues normalised per channel. */
  function epochColours(E) {
    if (E <= 1) return [[1, 1, 1]];
    if (E === 2) return [[0, 1, 1], [1, 0, 0]];
    if (E === 3) return [[0, 0, 1], [0, 1, 0], [1, 0, 0]];
    const c = []; for (let e = 0; e < E; e++) c.push(hslToRgb(240 - 240 * e / (E - 1), 1, 0.5).map(v => v / 255));
    const sum = [0, 1, 2].map(j => c.reduce((s, x) => s + x[j], 0));
    return c.map(x => x.map((v, j) => v / sum[j]));
  }
  /** "Changes" view (v0.8). stacks: one {flat, st} per epoch (time order); frames: every image {flat, keep, st} in time order.
      epochRGBA: each epoch in its own colour (epochColours), so anything present in every epoch adds up to white and a
      change keeps its epoch's colour. timeRGBA: the median of all images in grey, plus, for every pixel, the image where it
      is brightest above that median, coloured by time (violet = first image, red = last). Stars cancel; a mover leaves a
      chain of colours, a cosmic ray one sharp dot. peaks: local maxima of that excess (>= nsig), with the image index,
      a shape check (sharper than the stars = artefact) and whether a bright star sits there (brightness change, not motion). */
  function changeMaps(stacks, frames, n, opts) {
    opts = opts || {};
    const N = n * n, E = stacks.length, K = frames.length, nsig = opts.nsig || 8, edge = opts.edge == null ? 3 : opts.edge;
    const cols = epochColours(E), ep = new Uint8ClampedArray(N * 4), softE = 2, topE = Math.asinh(80 / softE);
    for (let p = 0; p < N; p++) {
      let r = 0, g = 0, b = 0;
      for (let e = 0; e < E; e++) {
        const s = stacks[e], v = (s.flat[p] - s.st.med) / s.st.sigma;
        if (v > 0) { const t = Math.min(1, Math.asinh(v / softE) / topE); r += cols[e][0] * t; g += cols[e][1] * t; b += cols[e][2] * t; }
      }
      const o = p * 4; ep[o] = r * 255; ep[o + 1] = g * 255; ep[o + 2] = b * 255; ep[o + 3] = 255;
    }
    const ref = medianStack(frames.map(f => f.flat), n, { minValid: Math.min(K, 3) }).flat, refSt = robustStats(ref) || { med: 0, sigma: 1 };
    // Pixels the pipeline flagged as outliers are repaired in "flat" and kept in "keep" (a moving asteroid is flagged too).
    // Live field 189.957 -4.182: using "keep" everywhere gave 946 spots, 731 of them cosmic rays. So a kept pixel is used only
    // when the exposure minutes apart (same visit) also has light there; a cosmic ray hits one exposure only.
    const visit = opts.visitDays || 0.1, relFrac = opts.relFrac == null ? 0.25 : opts.relFrac;
    const matesOf = frames.map((f, k) => f.mjd == null ? [] : frames.filter((m, j) => j !== k && m.mjd != null && Math.abs(m.mjd - f.mjd) <= visit));
    const lit = (m, p) => { const a = m.keep || m.flat, x = p % n, y = (p - x) / n;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = x + i, Y = y + j; if (X < 0 || Y < 0 || X >= n || Y >= n) continue; if ((a[Y * n + X] - m.st.med) / m.st.sigma >= 3) return true; }
      return false; };
    // Light is compared in 3x3 boxes, not single pixels: SPHEREx pixels (6.2") are about as wide as a star's image, so a star
    // shifted by a fraction of a pixel puts much more light in one pixel and less in its neighbour. The box total does not.
    const box = a => { const o = new Float32Array(N).fill(NaN);
      for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += a[(y + j) * n + x + i]; o[y * n + x] = s; }
      return o; };
    // Each image is compared with the images of the SAME colour (slot) in the other epochs. The 8 images of an epoch span
    // 4.46 to 4.95 um on the live field, and stars change brightness with colour: against the median of all 24 images,
    // 31 bright stars looked "changed". frames[k].slot groups them; without slots every image uses the median of all.
    const groups = new Map(); frames.forEach((f, k) => { const g = f.slot == null ? 'all' : f.slot; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(k); });
    const refFor = new Array(K), refBoxFor = new Array(K);
    for (const [g, ks] of groups) {
      const use = ks.length >= 2 ? ks : frames.map((_, k) => k), r = use === ks ? medianStack(use.map(k => frames[k].flat), n, { minValid: Math.min(use.length, 2) }).flat : ref;
      const rb = box(r); for (const k of ks) { refFor[k] = r; refBoxFor[k] = rb; }
    }
    const best = new Float32Array(N), who = new Int16Array(N).fill(-1), cur = new Float32Array(N), diff = new Float32Array(N);
    let keptUsed = 0, keptDropped = 0;
    const boxSigma = [];
    for (let k = 0; k < K; k++) {
      const f = frames[k], mates = matesOf[k], rb = refBoxFor[k], rk = refFor[k], rkSt = robustStats(rk) || refSt;
      for (let p = 0; p < N; p++) {
        let v = f.flat[p];
        if (f.keep && f.keep[p] !== v && f.keep[p] === f.keep[p]) { if (mates.length && mates.some(m => lit(m, p))) { v = f.keep[p]; keptUsed++; } else keptDropped++; }
        cur[p] = v;
      }
      const vb = box(cur);
      for (let p = 0; p < N; p++) diff[p] = vb[p] - rb[p];
      // noise of the box difference, measured (reprojected pixels are correlated, so it is not simply 3 sigma)
      const ds = robustStats(diff), sg = ds && ds.sigma > 0 ? ds.sigma : 3 * f.st.sigma, d0 = ds ? ds.med : 0; boxSigma.push(sg);
      const med9 = 9 * rkSt.med;
      for (let p = 0; p < N; p++) {
        const d = diff[p] - d0; if (d !== d) continue;
        // a bright star a little brighter in one image (noise, focus) is not a change: the excess must also be a good part of its own light
        if (d < relFrac * Math.max(0, rb[p] - med9)) continue;
        const x = d / sg; if (x > best[p]) { best[p] = x; who[p] = k; }
      }
    }
    const hues = frames.map((_, k) => hslToRgb(K > 1 ? 275 - 275 * k / (K - 1) : 0, 1, 0.55));
    const shapes = frames.map(f => starShapeMedian(f.flat, n, f.st)), peaks = [], counts = new Array(K).fill(0), sharpCounts = new Array(K).fill(0);
    for (let y = edge; y < n - edge; y++) for (let x = edge; x < n - edge; x++) {
      const p = y * n + x, v = best[p]; if (!(v >= nsig)) continue;
      let max = true;
      for (let j = -1; j <= 1 && max; j++) for (let i = -1; i <= 1; i++) if ((i || j) && best[p + j * n + i] > v) { max = false; break; }
      if (!max) continue;
      const k = who[p], f = frames[k], img = f.keep || f.flat, ref_ = shapes[k];
      // the box peak can sit one pixel off a single bright pixel: move to the brightest real pixel around it
      let bx = x, by = y;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const q = (y + j) * n + x + i; if (img[q] > img[by * n + bx]) { bx = x + i; by = y + j; } }
      const sh = peakShape(img, n, bx, by);
      const sharp = sh != null && ref_ ? sh < 0.5 * ref_.median : false, onStar = (ref[p] - refSt.med) / refSt.sigma > 10;
      // Repeat check, as for single-visit sources: exposures of the same visit are minutes apart, so a real object (even a
      // moving one) is still there; a cosmic ray is not. null when this image has no partner exposure.
      let repeat = null;
      if (f.mjd != null) {
        const mates = frames.filter((m, j) => j !== k && m.mjd != null && Math.abs(m.mjd - f.mjd) <= (opts.visitDays || 0.1));
        if (mates.length) { const own = snrAt(img, n, f.st, bx, by) || v, need = Math.max(3, 0.2 * own);
          repeat = mates.some(m => { const q = snrAt(m.keep || m.flat, n, m.st, bx, by); return q !== null && q >= need; }); }
      }
      if (peaks.some(q => q.k === k && Math.abs(q.x - bx) <= 1 && Math.abs(q.y - by) <= 1)) continue;   // several box maxima on one bright pixel
      peaks.push({ x: bx, y: by, k, snr: +v.toFixed(1), shape: sh, sharp, onStar, repeat });
      counts[k]++; if (sharp || repeat === false) sharpCounts[k]++;   // "sharpCounts" = looks like an artefact
    }
    peaks.sort((a, b) => b.snr - a.snr);
    // The time picture: grey sky (median of all images) plus, per pixel, the image where it is brightest, in that image's
    // colour of time. Spots judged artefacts (missing from the exposure minutes apart, or sharper than stars) stay grey.
    const quiet = new Uint8Array(N);
    for (const pk of peaks) if (pk.repeat === false || pk.sharp) for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const X = pk.x + i, Y = pk.y + j; if (X >= 0 && Y >= 0 && X < n && Y < n) quiet[Y * n + X] = 1; }
    const tm = new Uint8ClampedArray(N * 4), topT = Math.asinh(40 / 3), topR = Math.asinh(60 / 2), cthr = Math.max(3, nsig / 2);
    for (let p = 0; p < N; p++) {
      const rv = (ref[p] - refSt.med) / refSt.sigma, g0 = rv > 0 ? Math.min(1, Math.asinh(rv / 2) / topR) * 90 : 0, o = p * 4;
      let r = g0, g = g0, b = g0;
      if (!quiet[p] && best[p] >= cthr && who[p] >= 0) { const t = Math.min(1, Math.asinh((best[p] - cthr) / 3) / topT), c = hues[who[p]]; r = g0 * (1 - t) + c[0] * t; g = g0 * (1 - t) + c[1] * t; b = g0 * (1 - t) + c[2] * t; }
      tm[o] = r; tm[o + 1] = g; tm[o + 2] = b; tm[o + 3] = 255;
    }
    return { epochRGBA: ep, timeRGBA: tm, peaks, counts, sharpCounts, hues, cols, refStats: refSt, keptUsed, keptDropped, boxSigma };
  }


  /* ---------- Empirical PSF (v0.10): the shape of a point source, measured on the image's own stars ----------
     Used to inject fake sources ("Hide Planet X"): a fake made with this PSF looks exactly as sharp or as soft as the
     real stars of that image, so the detector cannot tell it apart by shape. */
  function bilinear(a, n, fx, fy) {
    if (!(fx >= 0 && fy >= 0 && fx <= n - 1 && fy <= n - 1)) return NaN;
    const x0 = Math.min(Math.floor(fx), n - 2), y0 = Math.min(Math.floor(fy), n - 2), tx = fx - x0, ty = fy - y0;
    return a[y0 * n + x0] * (1 - tx) * (1 - ty) + a[y0 * n + x0 + 1] * tx * (1 - ty) + a[(y0 + 1) * n + x0] * (1 - tx) * ty + a[(y0 + 1) * n + x0 + 1] * tx * ty;
  }
  /** Centroid of the light within radius r of (x,y), background removed, iterated 3 times. */
  function centroid(a, n, x, y, bg, r) {
    for (let it = 0; it < 3; it++) {
      let sx = 0, sy = 0, sw = 0; const X0 = Math.round(x), Y0 = Math.round(y);
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (i * i + j * j > r * r) continue;
        const X = X0 + i, Y = Y0 + j; if (X < 0 || Y < 0 || X >= n || Y >= n) return null;
        const w = a[Y * n + X] - bg; if (!(w === w)) return null;
        if (w > 0) { sx += w * X; sy += w * Y; sw += w; }
      }
      if (!(sw > 0)) return null;
      x = sx / sw; y = sy / sw;
    }
    return { x, y };
  }
  /** FWHM of a PSF given as a function f(dx, dy) of the offset in pixels: azimuthal average on rings 0.01 px apart
      (64 directions), radius where it falls to half the centre value, times 2. Continuous (not tied to any grid). */
  function fwhmOf(f, maxR) {
    maxR = maxR || 5; const A = 64, ring = r => { let s = 0; for (let k = 0; k < A; k++) { const t = 2 * Math.PI * k / A; s += f(r * Math.cos(t), r * Math.sin(t)); } return s / A; };
    const c = f(0, 0); let prev = c;
    for (let r = 0.01; r <= maxR; r += 0.01) { const v = ring(r); if (v <= c / 2) return 2 * (r - 0.01 + 0.01 * (prev - c / 2) / Math.max(1e-15, prev - v)); prev = v; }
    return null;
  }
  /** Measure the PSF from bright isolated stars, as an oversampled "effective PSF" (ePSF, the Anderson & King idea):
      every star sits at a different sub-pixel position, so together their pixels sample the PSF on a finer grid. No image
      is shifted or interpolated, so a sharp, undersampled core (SPHEREx stars are only ~2 px wide) stays sharp.
      a: background-flattened image (n x n), st: robustStats(a). opts: half (default 5), os (oversampling, default 4),
      minSnr (default 25), maxStars (default 80).
      Returns {ep, os, half, at(dx,dy), psf (pixel-sampled, centred, sums to 1), size, nStars, fwhm (px), peakFrac, shape} or null. */
  function epsfGrid(a, n, st, opts) {
    opts = opts || {};
    const half = opts.half || 5, size = 2 * half + 1, OS = opts.os || 4, minSnr = opts.minSnr || 25, maxStars = opts.maxStars || 50;
    const G = 2 * half * OS + 1, C = half * OS;   // ePSF grid: offsets -half..half pixels in steps of 1/OS
    // a may be one image, or a list [{flat, st}] of aligned images of the same detector and colour (more stars, finer sampling)
    const imgs = Array.isArray(a) ? a : [{ flat: a, st }], stars = [];
    for (const im of imgs) { a = im.flat; st = im.st; const before = stars.length, cap = Array.isArray(arguments[0]) ? maxStars * imgs.length : maxStars;
    const all = detectPeaks(a, n, st, 5, 3000), bright = all.filter(p => p.snr >= minSnr);
    if (bright.length > 10) { const cut = bright[Math.floor(bright.length * 0.05)].flux; for (let i = bright.length - 1; i >= 0; i--) if (bright[i].flux > cut) bright.splice(i, 1); }
    for (const p of bright) {
      if (stars.length - before >= maxStars || stars.length >= cap) break;
      if (p.x < half + 4 || p.y < half + 4 || p.x > n - half - 5 || p.y > n - half - 5) continue;
      if (all.some(q => q !== p && Math.hypot(q.x - p.x, q.y - p.y) < half + 2 && q.flux > 0.02 * p.flux)) continue;
      const ring = [], X0 = Math.round(p.x), Y0 = Math.round(p.y);
      for (let j = -half - 2; j <= half + 2; j++) for (let i = -half - 2; i <= half + 2; i++) {
        const r = Math.hypot(i, j); if (r < half + 0.5 || r > half + 2) continue;
        const v = a[(Y0 + j) * n + X0 + i]; if (v === v) ring.push(v);
      }
      if (ring.length < 20) continue;
      const bg = median(ring), c = centroid(a, n, p.x, p.y, bg, 2); if (!c) continue;
      const px = []; let sum = 0, bad = false;
      for (let j = -half; j <= half && !bad; j++) for (let i = -half; i <= half; i++) {
        const v = a[(Y0 + j) * n + X0 + i]; if (!(v === v)) { bad = true; break; }
        px.push([X0 + i, Y0 + j, v - bg]); sum += v - bg;
      }
      if (bad || !(sum > 0)) continue;
      stars.push({ x: c.x, y: c.y, px, sum });
    }
    }
    if (stars.length < 5) return null;
    const build = list => {
      const cells = Array.from({ length: G * G }, () => []);
      for (const s of list) for (const [X, Y, v] of s.px) {
        const gx = Math.round((X - s.x) * OS) + C, gy = Math.round((Y - s.y) * OS) + C;
        if (gx >= 0 && gy >= 0 && gx < G && gy < G) cells[gy * G + gx].push(v / s.sum);
      }
      let ep = new Float64Array(G * G).fill(NaN);
      for (let k = 0; k < ep.length; k++) if (cells[k].length) ep[k] = median(cells[k]);
      for (let pass = 0; pass < 8; pass++) {   // fill empty cells from their neighbours
        let left = 0; const nx = Float64Array.from(ep);
        for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { if (ep[y * G + x] === ep[y * G + x]) continue;
          let s = 0, w = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = x + i, Y = y + j; if (X >= 0 && Y >= 0 && X < G && Y < G && ep[Y * G + X] === ep[Y * G + X]) { s += ep[Y * G + X]; w++; } }
          if (w) nx[y * G + x] = s / w; else left++; }
        ep = nx; if (!left) break;
      }
      if (!opts.smooth) return ep.map(v => v === v ? v : 0);   // tested on real D4/D6: smoothing makes fakes softer than the stars
      const sm = new Float64Array(G * G), K = [1, 2, 1];   // light 3x3 smoothing of the fine grid (removes cell noise)
      for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { let s = 0, w = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = x + i, Y = y + j; if (X >= 0 && Y >= 0 && X < G && Y < G && ep[Y * G + X] === ep[Y * G + X]) { const k = K[i + 1] * K[j + 1]; s += k * ep[Y * G + X]; w += k; } }
        sm[y * G + x] = w ? s / w : 0; }
      return sm;
    };
    const at = (ep, dx, dy) => { const fx = dx * OS + C, fy = dy * OS + C; if (!(fx >= 0 && fy >= 0 && fx <= G - 1 && fy <= G - 1)) return 0;
      const x0 = Math.min(Math.floor(fx), G - 2), y0 = Math.min(Math.floor(fy), G - 2), tx = fx - x0, ty = fy - y0;
      return ep[y0 * G + x0] * (1 - tx) * (1 - ty) + ep[y0 * G + x0 + 1] * tx * (1 - ty) + ep[(y0 + 1) * G + x0] * (1 - tx) * ty + ep[(y0 + 1) * G + x0 + 1] * tx * ty; };
    let ep = build(stars), use = stars;
    for (let it = 0; it < 3; it++) {
      // re-centre every star on the ePSF (least squares over sub-pixel offsets), drop the ones that do not fit, rebuild
      const chi = [];
      for (const s of use) {
        let best = Infinity, bx = s.x, by = s.y;
        const tryAt = (cx, cy) => { let r = 0; for (const [X, Y, v] of s.px) { const d = v / s.sum - at(ep, X - cx, Y - cy); r += d * d; } if (r < best) { best = r; bx = cx; by = cy; } };
        const x0 = s.x, y0 = s.y;   // coarse 0.1 px search, then 0.025 px around the best
        for (let oy = -0.5; oy <= 0.5001; oy += 0.05) for (let ox = -0.5; ox <= 0.5001; ox += 0.05) tryAt(x0 + ox, y0 + oy);
        s.x = bx; s.y = by; s.chi = best; chi.push(best);
      }
      const cm = median(chi), keep = use.filter(s => s.chi <= 4 * cm);
      if (keep.length >= 5) use = keep;
      ep = build(use);
    }
    // the ePSF's own centre may sit off (0,0) by a fraction of a cell: shift so its light-weighted centre is at 0
    let sx = 0, sy = 0, sw = 0; for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) { const v = ep[y * G + x]; if (v > 0 && Math.hypot(x - C, y - C) < 2 * OS) { sx += v * (x - C); sy += v * (y - C); sw += v; } }
    const ox = sx / sw / OS, oy = sy / sw / OS, sh = new Float64Array(G * G);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) sh[y * G + x] = at(ep, (x - C) / OS + ox, (y - C) / OS + oy);
    ep = sh;
    // normalise: a source centred on a pixel puts total light 1 in the stamp
    const psf = new Float32Array(size * size); let tot = 0;
    for (let j = -half; j <= half; j++) for (let i = -half; i <= half; i++) { const v = Math.max(0, at(ep, i, j)); psf[(j + half) * size + i + half] = v; tot += v; }
    for (let k = 0; k < ep.length; k++) ep[k] /= tot; for (let k = 0; k < psf.length; k++) psf[k] /= tot;
    return { ep: Float32Array.from(ep), os: OS, half, at: (dx, dy) => at(ep, dx, dy), psf, size, nStars: use.length, nCandidates: stars.length,
             fwhm: fwhmOf((dx, dy) => at(ep, dx, dy), half), peakFrac: psf[half * size + half], shape: peakShape(psf, size, half, half), method: 'epsf' };
  }

  /** Bright isolated stars of one or more images, background removed: [{px:[[X,Y,v]...], x, y, sum, sig}]. */
  function psfStars(a, n, st, opts) {
    const half = opts.half || 5, minSnr = opts.minSnr || 25, maxStars = opts.maxStars || 80;
    const imgs = Array.isArray(a) ? a : [{ flat: a, st }], stars = [];
    for (const im of imgs) {
      const v = im.flat, s0 = im.st, all = detectPeaks(v, n, s0, 5, 3000), bright = all.filter(p => p.snr >= minSnr);
      if (bright.length > 10) { const cut = bright[Math.floor(bright.length * 0.05)].flux; for (let i = bright.length - 1; i >= 0; i--) if (bright[i].flux > cut) bright.splice(i, 1); }
      let got = 0;
      for (const p of bright) {
        if (got >= maxStars) break;
        if (p.x < half + 4 || p.y < half + 4 || p.x > n - half - 5 || p.y > n - half - 5) continue;
        if (all.some(q => Math.hypot(q.x - p.x, q.y - p.y) > 0.7 && Math.hypot(q.x - p.x, q.y - p.y) < half + 2 && q.flux > 0.02 * p.flux)) continue;
        const ring = [], X0 = Math.round(p.x), Y0 = Math.round(p.y);
        for (let j = -half - 2; j <= half + 2; j++) for (let i = -half - 2; i <= half + 2; i++) {
          const r = Math.hypot(i, j); if (r < half + 0.5 || r > half + 2) continue;
          const w = v[(Y0 + j) * n + X0 + i]; if (w === w) ring.push(w);
        }
        if (ring.length < 20) continue;
        const bg = median(ring), c = centroid(v, n, p.x, p.y, bg, 2); if (!c) continue;
        const px = []; let sum = 0, bad = false;
        for (let j = -half; j <= half && !bad; j++) for (let i = -half; i <= half; i++) {
          const w = v[(Y0 + j) * n + X0 + i]; if (!(w === w)) { bad = true; break; }
          px.push([X0 + i, Y0 + j, w - bg]); sum += w - bg;
        }
        if (bad || !(sum > 0)) continue;
        stars.push({ x: c.x, y: c.y, px, sum, sig: s0.sigma }); got++;
      }
    }
    return stars;
  }
  function erfA(x) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
  /** Pixel-integrated PSF model: (1-w) core + w wing, both elliptical Gaussians with the same shape (e1, e2).
      p = [sigma (px), wing/core width ratio, wing fraction, e1, e2]. Returns f(dx,dy) = light in the pixel whose centre is
      (dx,dy) from the source, for total light 1. Separable erf when round; otherwise 6x6 sub-pixel sampling. */
  function psfModel(p) {
    const s = Math.max(0.25, p[0]), k = Math.max(1.05, p[1]), w = Math.min(0.9, Math.max(0, p[2])), e1 = Math.max(-0.4, Math.min(0.4, p[3])), e2 = Math.max(-0.4, Math.min(0.4, p[4]));
    const a = 1 + e1, d = 1 - e1, b = e2, det = a * d - b * b;   // shape matrix M (det > 0 for |e| < 0.56), covariance sigma^2 * M
    if (Math.abs(e1) < 1e-4 && Math.abs(e2) < 1e-4) {
      const g1 = (u, sg) => 0.5 * (erfA((u + 0.5) / (Math.SQRT2 * sg)) - erfA((u - 0.5) / (Math.SQRT2 * sg)));
      return (dx, dy) => (1 - w) * g1(dx, s) * g1(dy, s) + w * g1(dx, s * k) * g1(dy, s * k);
    }
    const ia = d / det, ib = -b / det, id = a / det, S = 6, nrm1 = 1 / (2 * Math.PI * s * s * Math.sqrt(det)), nrm2 = 1 / (2 * Math.PI * s * s * k * k * Math.sqrt(det));
    return (dx, dy) => {
      let t = 0;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const x = dx - 0.5 + (i + 0.5) / S, y = dy - 0.5 + (j + 0.5) / S, q = ia * x * x + 2 * ib * x * y + id * y * y;
        t += (1 - w) * nrm1 * Math.exp(-q / (2 * s * s)) + w * nrm2 * Math.exp(-q / (2 * s * s * k * k));
      }
      return t / (S * S);
    };
  }
  function nelderMead(f, x0, steps, iters) {
    const N = x0.length; let P = [x0.slice()]; for (let i = 0; i < N; i++) { const x = x0.slice(); x[i] += steps[i]; P.push(x); }
    let F = P.map(f);
    for (let it = 0; it < iters; it++) {
      const o = F.map((v, i) => i).sort((i, j) => F[i] - F[j]); P = o.map(i => P[i]); F = o.map(i => F[i]);
      const c = new Array(N).fill(0); for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) c[k] += P[i][k] / N;
      const at = t => c.map((v, k) => v + t * (P[N][k] - v)), xr = at(-1), fr = f(xr);
      if (fr < F[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { P[N] = xe; F[N] = fe; } else { P[N] = xr; F[N] = fr; } }
      else if (fr < F[N - 1]) { P[N] = xr; F[N] = fr; }
      else { const xc = at(0.5), fc = f(xc); if (fc < F[N]) { P[N] = xc; F[N] = fc; } else { for (let i = 1; i <= N; i++) { P[i] = P[i].map((v, k) => P[0][k] + 0.5 * (v - P[0][k])); F[i] = f(P[i]); } } }
    }
    const b = F.indexOf(Math.min(...F)); return { x: P[b], f: F[b] };
  }
  /** Measure the PSF of an image by FITTING a pixel-integrated model to its bright isolated stars (each star gets its own
      position and brightness; the PSF parameters are shared). Nothing is binned, shifted or interpolated, so the sharp
      core of SPHEREx's ~2 px stars is kept. a: flattened image (or a list [{flat, st}]), st: robustStats(a).
      opts.method: 'epsf' (default: oversampled 4x grid, v0.9.1) or 'model'. Returns {at(dx,dy), psf, size, half, ...} or null.
      Default chosen on REAL data (test/psf.official.test.js, 22 SPHEREx images with the pipeline's own PSF): fakes made with
      the ePSF have the real stars' shape (ratio 1.02); fakes from this model are 9-10 % softer than the stars. */
  function empiricalPSF(a, n, st, opts) {
    opts = opts || {};
    if (opts.method !== 'model') return epsfGrid(a, n, st, opts);
    const half = opts.half || 5, size = 2 * half + 1, stars = psfStars(a, n, st, opts);
    if (stars.length < 5) return null;
    // chi2 of all stars for model f; per star the flux is solved exactly (linear), noise = sky sigma + 3 % of the model
    const chi = (f, list) => { let tot = 0;
      for (const s of list) { const m = s.px.map(([X, Y]) => f(X - s.x, Y - s.y)); let num = 0, den = 0;
        for (let k = 0; k < m.length; k++) { num += m[k] * s.px[k][2]; den += m[k] * m[k]; }
        const F = den > 0 ? num / den : 0; s.flux = F; let c = 0;
        for (let k = 0; k < m.length; k++) { const r = s.px[k][2] - F * m[k], v = s.sig * s.sig + (0.03 * F * m[k]) ** 2; c += r * r / v; }
        s.chi = c; tot += c; }
      return tot; };
    const recentre = (f, list) => { for (const s of list) for (const step of [0.1, 0.03, 0.01]) {
      let bx = s.x, by = s.y, best = Infinity;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const t = { x: s.x + i * step, y: s.y + j * step, px: s.px, sig: s.sig }; const c = chi(f, [t]); if (c < best) { best = c; bx = t.x; by = t.y; } }
      s.x = bx; s.y = by; } };
    let p = [0.75, 2.5, 0.15, 0, 0], use = stars;
    for (let it = 0; it < 3; it++) {
      recentre(psfModel(p), use);
      p = nelderMead(q => chi(psfModel(q), use), p, [0.15, 0.6, 0.08, 0.05, 0.05], 160).x;
      chi(psfModel(p), use);   // drop stars that the model cannot fit (blends, hot pixels, saturated): 3x the median chi2
      const cm = median(use.map(s => s.chi)), keep = use.filter(s => s.chi <= 3 * cm);
      if (keep.length >= 5) use = keep;
    }
    const f = psfModel(p), psf = new Float32Array(size * size); let tot = 0;
    for (let j = -half; j <= half; j++) for (let i = -half; i <= half; i++) { const v = f(i, j); psf[(j + half) * size + i + half] = v; tot += v; }
    for (let k = 0; k < psf.length; k++) psf[k] /= tot;
    const dof = use.reduce((q, s) => q + s.px.length - 3, 0), chi2 = use.reduce((q, s) => q + s.chi, 0);
    return { at: (dx, dy) => f(dx, dy) / tot, psf, size, half, params: { sigma: p[0], wingRatio: p[1], wingFrac: p[2], e1: p[3], e2: p[4] },
             nStars: use.length, nCandidates: stars.length, fwhm: fwhmOf(f, half), peakFrac: psf[half * size + half],
             shape: peakShape(psf, size, half, half), redChi2: chi2 / Math.max(1, dof), method: 'model' };
  }
  /** Add a point source of total light `flux` (image units x pixels) at (x,y) with an empiricalPSF result. Returns a copy. */
  function injectPSF(a, n, P, x, y, flux) {
    const out = Float32Array.from(a), h = P.half, X0 = Math.round(x), Y0 = Math.round(y), w = [];
    let tot = 0;
    for (let j = -h; j <= h; j++) for (let i = -h; i <= h; i++) { const v = Math.max(0, P.at(X0 + i - x, Y0 + j - y)); w.push(v); tot += v; }
    let k = 0;   // weights renormalised at this sub-pixel position, so the total added light is exactly `flux`
    for (let j = -h; j <= h; j++) for (let i = -h; i <= h; i++, k++) {
      const X = X0 + i, Y = Y0 + j; if (X < 0 || Y < 0 || X >= n || Y >= n || !(tot > 0)) continue;
      if (out[Y * n + X] === out[Y * n + X]) out[Y * n + X] += flux * w[k] / tot;
    }
    return out;
  }
  return { parseFITS, findHDU, readImage, makeWCS, pix2sky, sky2pix, tanInv, tanFwd, resample, flatten, robustStats, hslToRgb, renderRGBA, renderDiff, findSources, pairUp,
           skyToGrid, gridToSky, sampleMax, snrAt, detectPeaks, shiftImage, estimateShift, findTransients, nearEdge, badFlagMask, maskBadPixels,
           readFlags, alignByStars, prepareCutout, medianStack, peakShape, starShapeMedian, singleVisitSources, epochColours, changeMaps,
           empiricalPSF, injectPSF, centroid, bilinear, psfModel, psfStars, fwhmOf, epsfGrid };
});
