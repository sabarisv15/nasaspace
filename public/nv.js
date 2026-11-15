/* ARCNAVE v0.58: the new viewer's own controls. Presentation only: every button calls what app.js and arc.js already do
   (the search box, runChallenge, setMode, movieStart, share, tours), so the measurements are unchanged.
   The old controls stay in the page, hidden, and open with "All tools". */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), body = document.body, html = document.documentElement;
  if (!$('nvtop')) return;
  const ready = () => typeof S !== 'undefined' && S.al;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* not kept */ } } };
  // the old four-tip quick start points at controls this layout keeps folded away: the result panel explains instead
  store.set('arcnave.coach', 'done');

  // Home
  $('nvhome').onclick = () => { closeHelp(); if (window.ARC_NAV) ARC_NAV.showLanding(); else location.href = '/'; };

  // search: the place goes through the tool's own search box, exactly as if typed there
  $('nvsf').addEventListener('submit', e => {
    e.preventDefault(); const v = $('nvq').value.trim(); if (!v) { $('nvq').focus(); return; }
    const go = () => { const q = $('q'), f = $('sf'); q.value = v; if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true })); $('nvq').blur(); };
    if (ready()) go(); else { const t = setInterval(() => { if (ready()) { clearInterval(t); go(); } }, 150); }
  });

  // Help menu
  const helpB = $('nvhelpb'), help = $('nvhelp');
  function closeHelp() { help.hidden = true; helpB.setAttribute('aria-expanded', 'false'); }
  helpB.onclick = e => { e.stopPropagation(); const o = help.hidden; help.hidden = !o; helpB.setAttribute('aria-expanded', String(o)); if (o) { const f = help.querySelector('button'); if (f) f.focus(); } };
  help.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; closeHelp();
    const k = b.dataset.nv;
    if (k === 'sky') { const w = $('wsky'); if (w) w.click(); }
    else if (k === 'learn') { const l = $('lb'); if (l) l.click(); }
    else if (k === 'tested') { const t = $('tb'); if (t) t.click(); }
  });
  document.addEventListener('click', e => { if (!help.hidden && !e.target.closest('.nv-menuw')) closeHelp(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !help.hidden) { closeHelp(); helpB.focus(); } });

  // Share: the tool's own share (link + clipboard + "Copy embed code")
  $('nvshare').onclick = () => { const b = $('share'); if (b) b.click(); };

  // All tools: the full set of controls (the earlier layout), on or off
  const tools = on => { body.classList.toggle('nv-tools', on); $('nvtools').setAttribute('aria-pressed', String(on)); store.set('arcnave.nvtools', on ? '1' : '0'); dispatchEvent(new Event('resize')); };
  $('nvtools').onclick = () => tools(!body.classList.contains('nv-tools'));
  if (store.get('arcnave.nvtools') === '1') tools(true);

  // ways to watch, on the sky
  const dock = $('nvdock');
  const tab = m => document.querySelector(`[role=tab][data-m="${m}"]`);
  dock.addEventListener('click', e => {
    const b = e.target.closest('[data-nvm]'); if (!b || !ready()) return;
    const m = b.dataset.nvm;
    if (m === 'film') { if (typeof MOVIE !== 'undefined' && MOVIE.on) { if (typeof movieStop === 'function') movieStop(); } else if (typeof movieStart === 'function') movieStart(); }
    else { if (typeof MOVIE !== 'undefined' && MOVIE.on && typeof movieStop === 'function') movieStop(true); const t = tab(m); if (t) t.click(); else if (typeof setMode === 'function') setMode(m); }
    sync();
  });
  function sync() {
    if (!ready()) return;
    const live = !!(S.field && S.eps && S.eps.length >= 2 && S.report) && !html.classList.contains('landing') && !(typeof GAME !== 'undefined' && GAME.on);
    if (dock.hidden !== !live) dock.hidden = !live;
    body.classList.toggle('nv-field', live);
    if (!live) return;
    const film = typeof MOVIE !== 'undefined' && MOVIE.on;
    for (const b of dock.querySelectorAll('[data-nvm]')) {
      const m = b.dataset.nvm, on = m === 'film' ? film : !film && S.mode === m;
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
    }
    const fb = dock.querySelector('.nv-film'), want = film ? 'Stop the film' : 'Play the film';
    if (fb.lastChild.textContent !== want) fb.lastChild.textContent = want;
  }
  setInterval(sync, 400);

  // the search box shows the place on screen (a NASA target's name, or nothing)
  setInterval(() => { if (!ready() || document.activeElement === $('nvq')) return;
    const lab = S.report && S.report.target && String(S.report.target.label || '').replace(/^NASA challenge target:\s*/i, ''); if (lab && $('nvq').dataset.shown !== lab) { $('nvq').dataset.shown = lab; $('nvq').placeholder = lab; } }, 1000);
})();
