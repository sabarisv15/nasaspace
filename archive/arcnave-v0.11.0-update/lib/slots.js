/* ARCNAVE: choose several images per epoch (v0.6). Browser (window.SkySlots) and Node (require).
   A "slot" is one image from EVERY epoch, all at nearly the same wavelength at the field, so any slot can be compared
   across epochs like-for-like. Up to N slots give N images per epoch: the epoch stacks (median of its N images) then
   contain the same colours, and the N images of one epoch, taken at different visits, show what moves inside an epoch. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkySlots = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** eps: per epoch, a list of {id, det, lam, cover, mjd} (lam = wavelength at the field, cover = fraction of the field
      on the detector). first: one item per epoch that must be slot 0 (or null). Returns slots: [{items: [per epoch], dLam}].
      Rules: cover >= minCover; |dLam| <= tolFrac * lam across epochs (about a quarter of a SPHEREx channel); an image is used
      once; prefer the same detector as slot 0 (same PSF, similar brightness), then new visits (more than visitDays apart). */
  function buildSlots(eps, N, opts) {
    opts = opts || {};
    const minCover = opts.minCover ?? 0.8, tolFrac = opts.tolFrac ?? 0.008, visit = opts.visitDays ?? 0.1;
    const E = eps.length, used = eps.map(() => new Set()), slots = [];
    const ok = it => it && Number.isFinite(it.lam) && (it.cover == null || it.cover >= minCover);
    if (opts.first && opts.first.every(Boolean)) {
      const l = opts.first.map(x => x.lam);
      slots.push({ items: opts.first.slice(), dLam: Math.max(...l) - Math.min(...l), first: true });
      opts.first.forEach((it, e) => used[e].add(it.id + '/' + it.det));
    }
    if (!E || N <= slots.length) return slots;
    const pools = eps.map(list => list.filter(ok));
    const base = pools.reduce((b, p, e) => (p.length < pools[b].length ? e : b), 0);
    const det0 = slots.length ? slots[0].items[base].det : null;
    const key = it => it.id + '/' + it.det;
    // every possible slot built around one image of the smallest epoch
    let cands = [];
    for (const b of pools[base]) {
      if (used[base].has(key(b))) continue;
      const items = [], tol = tolFrac * b.lam; let worst = 0, cover = b.cover ?? 1, fail = false;
      for (let e = 0; e < E; e++) {
        if (e === base) { items.push(b); continue; }
        let best = null, bd = Infinity;
        for (const it of pools[e]) { if (used[e].has(key(it))) continue; const d = Math.abs(it.lam - b.lam) + (it.det === b.det ? 0 : 0.5 * tol); if (d < bd) { bd = d; best = it; } }
        if (!best || Math.abs(best.lam - b.lam) > tol) { fail = true; break; }
        items.push(best); worst = Math.max(worst, Math.abs(best.lam - b.lam)); cover = Math.min(cover, best.cover ?? 1);
      }
      if (!fail) cands.push({ items, dLam: worst, cover, tol });
    }
    // greedy: closest colours first, same detector as slot 0, prefer adding visits not yet represented in each epoch
    while (slots.length < N && cands.length) {
      let best = null, bs = Infinity;
      for (const c of cands) {
        if (c.items.some((it, e) => used[e].has(key(it)))) continue;
        let newVisits = 0;
        c.items.forEach((it, e) => { if (!slots.some(s => Math.abs(s.items[e].mjd - it.mjd) <= visit)) newVisits++; });
        const score = c.dLam / c.tol + 0.5 * (1 - c.cover) + (det0 && c.items[base].det !== det0 ? 0.6 : 0) - 0.4 * newVisits / E;
        if (score < bs) { bs = score; best = c; }
      }
      if (!best) break;
      best.items.forEach((it, e) => used[e].add(key(it)));
      slots.push({ items: best.items, dLam: best.dLam });
      cands = cands.filter(c => c !== best);
    }
    return slots;
  }

  return { buildSlots };
});
