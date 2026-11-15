'use strict';
// Tiny animated-GIF encoder for the Discovery card (v0.15). No library, no network: one shared 256-colour palette
// (median cut of the image pixels plus fixed colours for the card's text and rings), LZW, looping forever.
// Works in the browser (window.SkyGif) and in Node (require) so the tests can decode what it writes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkyGif = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Colours the card draws on purpose (background, text, rings, badges): always in the palette, exactly.
  const FIXED = ['#05070f', '#0a0e1a', '#070a12', '#000000', '#ffffff', '#eef1f7', '#8e98ae', '#5a6378', '#222b40', '#323d57',
    '#ffb05a', '#5fe3f0', '#5ff0a0', '#9b8cff', '#c4b5ff', '#ff7a7a', '#ffc46b'];
  const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

  // Median cut on a sample of RGB pixels -> up to n colours (box averages).
  function medianCut(px, n) {
    if (!px.length) return [];
    let boxes = [px];
    const range = b => {
      let lo = [255, 255, 255], hi = [0, 0, 0];
      for (const p of b) for (let c = 0; c < 3; c++) { if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; }
      const r = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], ch = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
      return { ch, size: r[ch] };
    };
    while (boxes.length < n) {
      let bi = -1, best = 0, bch = 0;
      boxes.forEach((b, i) => { if (b.length < 2) return; const r = range(b), score = r.size * Math.sqrt(b.length); if (score > best) { best = score; bi = i; bch = r.ch; } });
      if (bi < 0) break;
      const b = boxes[bi].sort((p, q) => p[bch] - q[bch]), m = b.length >> 1;
      boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
    }
    return boxes.map(b => { const s = [0, 0, 0]; for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return s.map(v => Math.round(v / b.length)); });
  }

  // One palette for all frames, so the sky does not flicker between frames.
  function buildPalette(frames, maxSample = 120000) {
    const fixed = FIXED.map(hex), total = frames.reduce((s, f) => s + f.length / 4, 0), step = Math.max(1, Math.floor(total / maxSample));
    const sample = []; let k = 0;
    for (const f of frames) for (let i = 0; i < f.length; i += 4) { if (k++ % step === 0) sample.push([f[i], f[i + 1], f[i + 2]]); }
    const pal = fixed.concat(medianCut(sample, 256 - fixed.length));
    while (pal.length < 256) pal.push([0, 0, 0]);
    return pal;
  }

  // Nearest palette colour, cached per 15-bit colour.
  function mapper(pal) {
    const cache = new Int16Array(32768).fill(-1);
    return (r, g, b) => {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let v = cache[key]; if (v >= 0) return v;
      let bd = Infinity; v = 0;
      const rr = (r & 0xf8) | 4, gg = (g & 0xf8) | 4, bb = (b & 0xf8) | 4;
      for (let i = 0; i < pal.length; i++) {
        const p = pal[i], d = (p[0] - rr) * (p[0] - rr) * 3 + (p[1] - gg) * (p[1] - gg) * 4 + (p[2] - bb) * (p[2] - bb) * 2;
        if (d < bd) { bd = d; v = i; }
      }
      cache[key] = v; return v;
    };
  }
  // Exact matches for the fixed colours (text and rings stay crisp), nearest otherwise.
  function indexFrame(rgba, pal, near) {
    const n = rgba.length / 4, out = new Uint8Array(n), exact = new Map();
    for (let i = 0; i < FIXED.length; i++) { const [r, g, b] = pal[i]; exact.set((r << 16) | (g << 8) | b, i); }
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2], e = exact.get((r << 16) | (g << 8) | b);
      out[i] = e !== undefined ? e : near(r, g, b);
    }
    return out;
  }

  // GIF LZW (variable code size, 8-bit minimum), packed LSB-first into 255-byte sub-blocks.
  function lzw(idx, out) {
    const MIN = 8, CLEAR = 256, EOI = 257;
    let size = MIN + 1, next = EOI + 1, dict = new Map(), cur = 0, nbits = 0;
    const bytes = [];
    const emit = code => {
      cur |= code << nbits; nbits += size;
      while (nbits >= 8) { bytes.push(cur & 255); cur >>>= 8; nbits -= 8; }
    };
    out.push(MIN);
    emit(CLEAR);
    let prefix = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const k = idx[i], key = (prefix << 8) | k, hit = dict.get(key);
      if (hit !== undefined) { prefix = hit; continue; }
      emit(prefix);
      if (next < 4096) {
        if (next > (1 << size) - 1 && size < 12) size++;
        dict.set(key, next++);
      } else { emit(CLEAR); dict = new Map(); size = MIN + 1; next = EOI + 1; }
      prefix = k;
    }
    emit(prefix);
    if (next > (1 << size) - 1 && size < 12) size++;
    emit(EOI);
    if (nbits > 0) bytes.push(cur & 255);
    for (let i = 0; i < bytes.length; i += 255) { const c = bytes.slice(i, i + 255); out.push(c.length, ...c); }
    out.push(0);
  }

  /**
   * frames: [{ rgba: Uint8ClampedArray(width*height*4), delay: ms }]. Returns a Uint8Array holding the GIF file.
   */
  function encode({ width, height, frames, loop = 0 }) {
    if (!frames.length) throw new Error('no frames');
    const pal = buildPalette(frames.map(f => f.rgba)), near = mapper(pal), out = [];
    const u16 = v => out.push(v & 255, (v >> 8) & 255);
    for (const c of 'GIF89a') out.push(c.charCodeAt(0));
    u16(width); u16(height); out.push(0xf7, 0, 0);
    for (const p of pal) out.push(p[0], p[1], p[2]);
    out.push(0x21, 0xff, 11); for (const c of 'NETSCAPE2.0') out.push(c.charCodeAt(0)); out.push(3, 1); u16(loop); out.push(0);
    for (const f of frames) {
      out.push(0x21, 0xf9, 4, 0x04); u16(Math.max(2, Math.round((f.delay || 700) / 10))); out.push(0, 0);
      out.push(0x2c); u16(0); u16(0); u16(width); u16(height); out.push(0);
      lzw(indexFrame(f.rgba, pal, near), out);
    }
    out.push(0x3b);
    return Uint8Array.from(out);
  }
  return { encode, buildPalette, FIXED };
});
