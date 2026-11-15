// Guided tour check (local): every step's tool must be on screen and not scrolled out of its panel. Results: window.__gc
(() => {
  const R = window.__gc = { done: false, rows: [] }, wait = ms => new Promise(r => setTimeout(r, ms));
  const clipOf = el => { let r = el.getBoundingClientRect(); for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowY + cs.overflowX)) { const q = p.getBoundingClientRect(); r = { left: Math.max(r.left, q.left), top: Math.max(r.top, q.top), right: Math.min(r.right, q.right), bottom: Math.min(r.bottom, q.bottom) }; } }
    return r; };
  (async () => {
    Tour.start('guide'); await wait(2500);
    for (let k = 0; k < 45; k++) {
      const st = Tour.step; if (!st) break;
      for (let j = 0; j < 60 && /loading|Loading/.test((document.querySelector('#tour .tnote') || {}).textContent || '') && !document.querySelector('#tour .tnote').hidden; j++) await wait(500);
      await wait(1200);
      const els = Tour.step.els.filter(el => el.getClientRects && el.getClientRects().length && !el.hidden);
      const vis = els.map(el => { const r = el.getBoundingClientRect(), c = clipOf(el); const w = Math.max(0, Math.min(c.right, innerWidth) - Math.max(c.left, 0)), h = Math.max(0, Math.min(c.bottom, innerHeight) - Math.max(c.top, 0)); return r.width * r.height ? Math.round(100 * w * h / (r.width * r.height)) : 0; });
      R.rows.push([st.i + 1, st.t, els.length ? vis.join('/') + '%' : (st.els.length ? 'HIDDEN' : 'no target'), document.querySelector('#tour .tspot').classList.contains('on') ? 'spot' : '-']);
      if (st.i + 1 >= st.n) break;
      document.querySelector('#tour [data-a=next]').click(); await wait(300);
    }
    Tour.end(); R.done = true;
  })();
})();
