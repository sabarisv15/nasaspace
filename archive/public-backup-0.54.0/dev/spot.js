/* ARCNAVE v0.35: a few pixels around ONE star from a SPHEREx file on S3, as fast as possible (spectra on the fly).
   The field cutout (s3cut.js) walks every header of a file (about 6 requests one after the other) and reads full rows of
   IMAGE, FLAGS and ZODI for the whole field. Measured live on 122 files of one pass: 150 s, 92 MB. For one star we need
   ~17 rows of IMAGE and FLAGS only, and files of the same data release and detector share their header layout, so:
     round 1: IMAGE header + FLAGS header, at the offsets learned from the first file of that release + detector
     round 2: the rows around the star (IMAGE, and FLAGS rows or, for compressed QR3 FLAGS, the row index)
     round 3: (QR3 only) the compressed FLAGS rows
   If a header is not where expected the full walk (s3cut.layout) is done and its offsets are learned again.
   QR3 files store FLAGS tile-compressed (RICE_1, one tile per row); riceDecode() decodes it (cfitsio's algorithm).
   Zodiacal light needs no ZODI layer here: the photometry subtracts the local sky around the star.
   Works in Node and in the browser. get(start, end) -> Promise<{ buf: Uint8Array, total }>. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fits'), require('./s3cut'), require('./wave'));
  else root.SkySpot = factory(root.SkyFits, root.S3Cut, root.SkyWave);
})(typeof self !== 'undefined' ? self : this, function (FITS, S3CUT, WAVE) {
  'use strict';
  const BLOCK = 2880;
  const ascii = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  function readCards(u8) {
    const cards = [];
    for (let p = 0; p + 80 <= u8.length; p += 80) { const c = ascii(u8.subarray(p, p + 80)); cards.push(c); if (/^END\s*$/.test(c)) return { cards, size: Math.ceil((p + 80) / BLOCK) * BLOCK }; }
    return null;
  }
  function headerOf(cards) {   // same parsing as the field cutouts (the app's own FITS reader)
    const fixed = cards.map(c => /^NAXIS\s*=/.test(c) ? 'NAXIS   =                    0'.padEnd(80) : /^(SIMPLE|XTENSION)/.test(c) ? 'SIMPLE  =                    T'.padEnd(80) : c);
    const n = Math.ceil(fixed.length * 80 / BLOCK) * BLOCK, u8 = new Uint8Array(n).fill(32), txt = fixed.join('');
    for (let i = 0; i < txt.length; i++) u8[i] = txt.charCodeAt(i);
    const h = FITS.parseFITS(u8.buffer)[0].header;
    for (const c of cards) { const m = /^(NAXIS\d?|XTENSION|PCOUNT|THEAP)\s*=\s*('?)([^'/]*)/.exec(c); if (m) h[m[1]] = m[2] ? m[3].trim() : +m[3]; }
    return h;
  }

  /** Rice decompression (cfitsio fits_rdecomp, 32-bit pixels, FSBITS 5, FSMAX 25). Returns Int32Array(n). */
  function riceDecode(c, n, nblock = 32, bytepix = 4) {
    if (bytepix !== 4) throw new Error('RICE: only 4-byte pixels');
    const out = new Int32Array(n), FSBITS = 5, FSMAX = 25, BBITS = 32;
    let p = 0;
    const byte = () => { if (p >= c.length) throw new Error('RICE: ran out of data'); return c[p++]; };
    let last = ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) | 0; p = 4;
    let b = byte(), nbits = 8;
    for (let i = 0; i < n;) {
      nbits -= FSBITS;
      while (nbits < 0) { b = ((b << 8) | byte()) >>> 0; nbits += 8; }
      const fs = (b >>> nbits) - 1; b &= (1 << nbits) - 1;
      const imax = Math.min(i + nblock, n);
      if (fs < 0) { for (; i < imax; i++) out[i] = last; }
      else if (fs === FSMAX) {
        for (; i < imax; i++) {
          let k = BBITS - nbits, diff = (b * 2 ** k) >>> 0;
          for (k -= 8; k >= 0; k -= 8) { b = byte(); diff = (diff | (b * 2 ** k)) >>> 0; }
          if (nbits > 0) { b = byte(); diff = (diff | (b >>> (-k))) >>> 0; b &= (1 << nbits) - 1; } else b = 0;
          const d = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
          last = (last + d) | 0; out[i] = last;
        }
      } else {
        for (; i < imax; i++) {
          while (b === 0) { nbits += 8; b = byte(); }
          let nzero = nbits - (31 - Math.clz32(b)) - 1;   // leading zeros inside the nbits that are left
          nbits -= nzero + 1; b ^= 1 << nbits;
          nbits -= fs;
          while (nbits < 0) { b = ((b << 8) | byte()) >>> 0; nbits += 8; }
          const diff = ((nzero << fs) | (b >>> nbits)) >>> 0; b &= (1 << nbits) - 1;
          const d = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
          last = (last + d) | 0; out[i] = last;
        }
      }
    }
    return out;
  }

  // data release + detector, e.g. "qr3:6" (files of one release and detector share their header layout)
  const keyOf = url => { const r = /\/(qr\d+)\//i.exec(url), d = /D(\d)_spx/i.exec(url); return (r ? r[1].toLowerCase() : '?') + ':' + (d ? d[1] : '?'); };

  // First file of a release + detector: the full header walk, plus the wavelength table.
  async function learn(get, url) {
    const { hdus } = await S3CUT.layout(get, null);
    const by = n => hdus.find(x => x.name === n), hi = by('IMAGE'), hf = by('FLAGS'), hw = by('WCS-WAVE');
    if (!hi) throw new Error('No IMAGE extension');
    let table = null;
    if (hw) {
      const data = hw.tail || (await get(hw.dataOff, hw.dataOff + hw.dataLen - 1)).buf;
      const ab = data.slice(0, hw.dataLen).buffer;
      try { table = WAVE.readWaveTable(ab, [{ header: Object.assign({}, hw.header, { EXTNAME: 'WCS-WAVE', XTENSION: 'BINTABLE' }), dataStart: 0 }]); } catch { table = null; }
    }
    return { img: { off: hi.off, hsize: hi.dataOff - hi.off }, flg: hf ? { off: hf.off, hsize: hf.dataOff - hf.off } : null, table, url };
  }

  /** Pixels within R of (ra, dec) on one file. memo: object shared by all calls (learned layouts per release + detector).
      Returns { data: Float32Array(w*h), bad: Uint8Array|null, w, h, cx, cy (0-based star position in the box), lam, bw,
      header, requests, bytes } or throws (status 404 when the star is not on the file). */
  async function spot(get0, url, ra, dec, R, memo, badMask) {
    let requests = 0, bytes = 0;
    const get = async (a, b) => { const r = await get0(a, b); requests++; bytes += r.buf.length; return r; };
    const key = keyOf(url);
    let L = memo[key], fresh = false;
    if (!L) { L = memo[key] = learn(get, url); fresh = true; }
    try { L = await L; } catch (e) { delete memo[key]; throw e; }
    const readHdr = async (o) => { const r = await get(o.off, o.off + o.hsize - 1); const c = readCards(r.buf); return c && c.size === o.hsize ? headerOf(c.cards) : null; };
    let [hI, hF] = await Promise.all([readHdr(L.img), L.flg ? readHdr(L.flg) : null]);
    if (!hI || (L.flg && !hF) || hI.NAXIS1 == null) {   // layout differs: learn again from this file
      if (fresh) throw new Error('Unexpected FITS layout');
      L = memo[key] = await learn(get, url); [hI, hF] = await Promise.all([readHdr(L.img), L.flg ? readHdr(L.flg) : null]);
      if (!hI) throw new Error('Unexpected FITS layout');
    }
    const nx = hI.NAXIS1, ny = hI.NAXIS2, p = FITS.sky2pix(FITS.makeWCS(hI), ra, dec);
    if (!p || !(p[0] > 0.5 && p[1] > 0.5 && p[0] < nx + 0.5 && p[1] < ny + 0.5)) { const e = new Error('The star is not on this image'); e.status = 404; throw e; }
    const x0 = Math.max(0, Math.round(p[0] - 1) - R), x1 = Math.min(nx - 1, Math.round(p[0] - 1) + R);
    const y0 = Math.max(0, Math.round(p[1] - 1) - R), y1 = Math.min(ny - 1, Math.round(p[1] - 1) + R), w = x1 - x0 + 1, h = y1 - y0 + 1;
    const dI = L.img.off + L.img.hsize, bpI = Math.abs(hI.BITPIX) / 8;
    if (hI.BITPIX !== -32) throw new Error('IMAGE BITPIX ' + hI.BITPIX);
    const jobs = [get(dI + y0 * nx * bpI, dI + (y1 + 1) * nx * bpI - 1)];
    let fl = null;
    if (hF) {
      const dF = L.flg.off + L.flg.hsize;
      if (!hF.ZIMAGE && hF.BITPIX === 32 && hF.NAXIS1 === nx) jobs.push(get(dF + y0 * nx * 4, dF + (y1 + 1) * nx * 4 - 1).then(r => ({ plain: r.buf })));
      else if (hF.ZIMAGE && /RICE/.test(hF.ZCMPTYPE || '') && hF.ZTILE2 === 1 && hF.ZTILE1 === nx && hF.ZBITPIX === 32 && hF.NAXIS1 === 8) {
        jobs.push((async () => {
          const ix = (await get(dF + y0 * 8, dF + (y1 + 1) * 8 - 1)).buf, dv = new DataView(ix.buffer, ix.byteOffset, ix.byteLength), rows = [];
          for (let j = 0; j < h; j++) rows.push({ n: dv.getInt32(j * 8, false), o: dv.getInt32(j * 8 + 4, false) });
          const heap = dF + (hF.THEAP || hF.NAXIS1 * hF.NAXIS2), lo = Math.min(...rows.map(r => r.o)), hi = Math.max(...rows.map(r => r.o + r.n));
          const hb = (await get(heap + lo, heap + hi - 1)).buf;
          return { rice: rows.map(r => riceDecode(hb.subarray(r.o - lo, r.o - lo + r.n), nx, hF.ZVAL1 || 32, hF.ZVAL2 || 4)) };
        })().catch(() => null));   // flags unreadable: measured without them (reported)
      }
    }
    const [rI, rF] = await Promise.all(jobs);
    const bufI = rI.buf; if (bufI.length !== h * nx * bpI) throw new Error('Short read');
    const dvI = new DataView(bufI.buffer, bufI.byteOffset, bufI.byteLength), data = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = dvI.getFloat32((j * nx + x0 + i) * 4, false);
    let bad = null;
    if (rF) {
      bad = new Uint8Array(w * h); const m = badMask >>> 0;
      if (rF.plain && rF.plain.length === h * nx * 4) { const dv = new DataView(rF.plain.buffer, rF.plain.byteOffset, rF.plain.byteLength); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) bad[j * w + i] = ((dv.getUint32((j * nx + x0 + i) * 4, false) & m) >>> 0) ? 1 : 0; }
      else if (rF.rice) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) bad[j * w + i] = ((rF.rice[j][x0 + i] & m) >>> 0) ? 1 : 0;
      else bad = null;
    }
    const wv = L.table ? WAVE.waveAtPixel(L.table, hI, p[0], p[1]) : null;
    return { data, bad, w, h, cx: p[0] - 1 - x0, cy: p[1] - 1 - y0, lam: wv ? wv.lam : null, bw: wv ? wv.bw : null, header: hI, flagHeader: hF, requests, bytes, key };
  }

  /** Aperture photometry on a spot: sum within rAp px minus the median sky in rIn..rOut, in mJy (image unit MJy/sr).
      Returns null when a pixel inside the aperture is flagged bad or missing. err: from the sky scatter. */
  function photometry(s, rAp = 2.5, rIn = 4, rOut = 7, pixArcsec = 6.15) {
    let sum = 0, np = 0, badIn = 0; const sky = [];
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
      const r = Math.hypot(i - s.cx, j - s.cy), k = j * s.w + i, v = s.data[k], b = (s.bad && s.bad[k]) || !Number.isFinite(v);
      if (r <= rAp) { if (b) badIn++; else { sum += v; np++; } }
      else if (r >= rIn && r <= rOut && !b) sky.push(v);
    }
    if (badIn || np < 9 || sky.length < 30) return { ok: false, badIn, np, nsky: sky.length };
    sky.sort((a, b) => a - b);
    const med = sky[sky.length >> 1], dev = sky.map(v => Math.abs(v - med)).sort((a, b) => a - b), sig = 1.4826 * dev[dev.length >> 1];
    const k = 1e9 * (pixArcsec / 206264.806) ** 2;   // MJy/sr * pixel solid angle -> mJy
    const peak = Math.max(...Array.from(s.data).filter(Number.isFinite));
    return { ok: true, mJy: (sum - np * med) * k, err: sig * Math.sqrt(np + np * np / sky.length) * k, sky: med, np, peak };
  }

  return { spot, photometry, riceDecode, keyOf };
});
