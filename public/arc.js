/* ARCNAVE v0.37.0-redesign: presentation layer only. The landing page, its languages, Beginner/Advanced, the quick-start
   tips, the status line, plain-words tooltips and "How sure are we?". It calls app.js the way its own buttons do
   (runChallenge, closeIntro, writeHash, embedCode, toast, phoneSheet) and never changes data, numbers or science.
   Loaded last, after app.js, i18n.js and tour.js. */
(() => {
  const $ = id => document.getElementById(id), qa = (s, r = document) => [...r.querySelectorAll(s)];
  const html = document.documentElement, LP = window.ARC_LP || {};
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* not kept */ } } };
  // the language: tour.js owns it once loaded; on the start page (tour.js not loaded yet) the same stored choice and #lang=
  const IDS = ['en', 'ta', 'hi', 'es'];
  let lpLang = (() => { const m = /(?:[#&?])lang=([a-z]{2})\b/.exec(location.hash + location.search), st = store.get('arcnave.lang');
    return m && IDS.includes(m[1]) ? m[1] : IDS.includes(st) ? st : 'en'; })();
  const lang = () => (window.Tour && Tour.lang) || lpLang;

  /* ---------- the tool's scripts on demand (start page only; a link loads them while the page parses) ---------- */
  let toolP = null;
  const addScript = (src, ordered) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.charset = 'utf-8';
    if (ordered) s.async = false; s.onload = res; s.onerror = () => rej(new Error(src)); document.body.append(s); });
  function loadTool() {
    if (typeof S !== 'undefined') return Promise.resolve();
    if (!toolP) { const t = window.ARC_TOOL;
      toolP = addScript(t.aladin).catch(() => {}).then(() => window.A ? null : addScript(t.aladinCds).catch(() => {}))   // CDS copy only as a fallback, as before
        .then(() => Promise.all(t.rest.map(s => addScript(s, true))))
        .then(() => { if (window.Tour && Tour.lang !== lpLang) Tour.setLang(lpLang); const t = $('toast'); if (t && t.dataset.arc) { t.hidden = true; delete t.dataset.arc; } }); }
    // a word while the viewer starts (the app's own toasts replace it)
    const t = $('toast'); if (t && t.hidden) { t.textContent = 'Starting the sky viewer…'; t.dataset.arc = '1'; t.hidden = false; }
    return toolP;
  }
  const T = (key, en) => { const d = LP[lang()]; return (d && d[key]) || en; };
  const ready = fn => { let k = 0; const go = () => (typeof S !== 'undefined' && S.al) ? fn() : k++ < 600 && setTimeout(go, 100); go(); };   // after Aladin has started (boot)

  /* ---------- languages for the new copy (the tool's own labels stay English, as in i18n.js) ---------- */
  const orig = new WeakMap();
  function applyLang() {
    const l = lang(), d = LP[l];
    for (const el of qa('[data-i18n],[data-i18n-html]')) {
      const htmlKey = el.dataset.i18nHtml, key = htmlKey || el.dataset.i18n;
      if (!orig.has(el)) orig.set(el, htmlKey ? el.innerHTML : el.textContent);
      const v = (l !== 'en' && d && d[key]) || orig.get(el);
      if (htmlKey) el.innerHTML = v; else el.textContent = v;
    }
    for (const el of qa('[data-i18n-ph]')) {   // v0.55: translated placeholders (the landing's place box)
      if (!orig.has(el)) orig.set(el, el.placeholder);
      el.placeholder = (l !== 'en' && d && d[el.dataset.i18nPh]) || orig.get(el);
    }
    if ($('landing')) $('landing').lang = l;
    syncLangSelects();
    if (coach.on) coach.show(coach.i);
  }
  document.addEventListener('change', e => {
    if (!(e.target.matches && e.target.matches('select[data-lang]'))) return;
    if (!window.Tour) { lpLang = IDS.includes(e.target.value) ? e.target.value : 'en'; store.set('arcnave.lang', lpLang); }   // tour.js does this itself once loaded
    setTimeout(applyLang, 0);
  });
  const syncLangSelects = () => qa('select[data-lang]').forEach(s => { s.value = lang(); });

  /* ---------- landing page ---------- */
  const landing = $('landing');
  const showTool = () => { html.classList.remove('landing'); stopStars(); };
  const hideIntro = () => { if (typeof closeIntro === 'function') closeIntro(); else { document.body.classList.remove('intro'); $('intro').hidden = true; } };
  function launch() {
    showTool(); hideIntro();
    loadTool().then(() => ready(() => { hideIntro(); $('go').click(); setTimeout(() => coach.auto(), 900); }));
  }
  function launchCt(id) { showTool(); hideIntro(); loadTool().then(() => ready(() => { hideIntro(); runChallenge(id); })); }
  function launchTour(kind) { showTool(); loadTool().then(() => ready(() => window.Tour && Tour.start(kind))); }
  // v0.55: the landing's place box: the tool opens and the place goes through its own search box, as if typed there
  function launchPlace(q) { showTool(); hideIntro(); loadTool().then(() => ready(() => { hideIntro(); const i = $('q'), f = $('sf'); if (!i || !f) return; i.value = q; f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); })); }
  // v0.55: "Try it" links open the tool and then start the tool that card is about, with the app's own functions;
  // anything that needs a field waits for that field's report (the agents' run), as a user would
  const afterReport = (fn, ms = 240000) => { const t0 = Date.now(); let started = false; const go = () => {
      if (typeof S === 'undefined') return Date.now() - t0 < ms && setTimeout(go, 250);
      const running = Object.values(S.ag || {}).some(a => a && a.state === 'run'); if (running) started = true;
      if (S.report && (started || !running)) return fn(); if (Date.now() - t0 < ms) setTimeout(go, 250); }; go(); };
  function launchTry(kind, ct) {
    showTool(); hideIntro();
    loadTool().then(() => ready(() => {
      hideIntro();
      if (kind === 'game') { const b = $('playb'); if (b) b.click(); return; }
      if (kind === 'px') { if (typeof runExample === 'function') runExample('proof'); afterReport(() => { const t = document.querySelector('[role=tab][data-m="px"]'); if (t) t.click(); if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('panel'); }); return; }
      if (ct && typeof runChallenge === 'function') runChallenge(ct);
      afterReport(() => {
        if (kind === 'film' && typeof movieStart === 'function') movieStart();
        else if (kind === 'wise') { const b = $('cwb'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); }
        else if (kind === 'share') { const g = $('g-share'); if (g) {
          // v0.55: Share & report is an Advanced section, folded at first: show it open before focusing the button
          if (!document.body.classList.contains('adv')) setLevel(true);
          g.classList.remove('shut'); const gh = g.querySelector('.gh'); if (gh) gh.setAttribute('aria-expanded', 'true');
          if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('panel'); g.scrollIntoView({ block: 'center' }); const b = $('share'); if (b) b.focus({ preventScroll: true }); } }
      });
    }));
  }
  function showLanding() {
    if (html.classList.contains('embed')) return;
    html.classList.add('landing'); landing.scrollTop = 0; startStars();
    const b = landing.querySelector('[data-launch]'); if (b) b.focus({ preventScroll: true });
  }
  if (landing) {
    /* v0.58: the new start page (#landing.nh): in-page links scroll, every button opens the tool through the same
       launch functions as before, and the tool's scripts are fetched once the visitor shows interest. */
    landing.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      if (a) { e.preventDefault(); const t = a.getAttribute('href').slice(1); const el = t && $(t);   // never a hash: a hash opens the tool on reload
        if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); return; }
      const b = e.target.closest('[data-launch],[data-launch-ct],[data-launch-tour],[data-try]'); if (!b) return;
      e.preventDefault();
      if (b.dataset.mode) setLevel(b.dataset.mode === 'adv');
      if (b.dataset.try) launchTry(b.dataset.try, b.dataset.launchCt); else if (b.dataset.launchCt) launchCt(b.dataset.launchCt); else if (b.dataset.launchTour) launchTour(b.dataset.launchTour); else { launch(); if (b.dataset.sky != null) loadTool().then(() => ready(() => { const w = $('wsky'); if (w) w.click(); })); }
    });
    const lpq = $('lpq'); if (lpq) lpq.addEventListener('submit', e => { e.preventDefault(); const v = $('lpqi').value.trim(); if (v) launchPlace(v); else $('lpqi').focus(); });
    let pre = false; const prefetch = () => { if (pre || typeof S !== 'undefined' || !window.ARC_TOOL) return; pre = true;
      for (const href of [ARC_TOOL.aladin, ...ARC_TOOL.rest]) { const l = document.createElement('link'); l.rel = 'prefetch'; l.as = 'script'; l.href = href; document.head.append(l); } };
    for (const ev of ['pointerover', 'touchstart', 'focusin']) landing.addEventListener(ev, e => { if (e.target.closest && e.target.closest('[data-launch],[data-launch-ct],[data-launch-tour],[data-try],#lpq')) prefetch(); }, { passive: true });
  }
  window.ARC_NAV = { showLanding, launch, launchCt, launchPlace, launchTour, launchTry };   // v0.58: for the new viewer bar (nv.js)
  // the brand in the tool goes back to the start page
  if ($('brandb')) $('brandb').onclick = showLanding;
  // H (Clear view) must not act on the hidden tool while the start page is open
  document.addEventListener('keydown', e => { if (html.classList.contains('landing') && /^[hH]$/.test(e.key)) e.stopPropagation(); }, true);

  /* ---------- v0.55 black sky with parallax behind the whole landing (decorative; drawn, not data) ----------
     A black night sky made of four depth layers of stars (real star colours, from orange K stars to blue B stars), a faint
     Milky Way and a little dust, all fixed behind the page. Scrolling moves the layers at different speeds (near stars
     faster), so the page seems to glide through space all the way down; the pointer (or the phone's tilt) shifts them a
     little the same way. Now and then a shooting star, and rarely a comet crossing from one side to the other. About 30
     frames a second, nothing while the tab is hidden, one still frame for "reduce motion". */
  const cv = $('starfield'); let raf = 0, drift = 0, bgC = null, W3 = 0, H3 = 0, DPR = 1, PAGE = 0;
  let layers = [], comets = [], shooters = [], nextComet = 0, nextShoot = 0;
  const cam = { x: 0, y: 0, tx: 0, ty: 0 };
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const STAR_COL = [[255, 196, 150], [255, 228, 196], [255, 246, 236], [232, 240, 255], [196, 216, 255], [170, 198, 255]];   // K, G, F, A, B (white most)
  const pickCol = () => { const r = rnd(); return STAR_COL[r < .1 ? 0 : r < .25 ? 1 : r < .55 ? 2 : r < .8 ? 3 : r < .93 ? 4 : 5]; };
  // depth: how fast a layer moves with the scroll and the pointer (far 0.06 ... near 0.5), and how bright and big its stars are
  const DEPTH = [{ d: .06, n: .5, r: [.35, .7], a: [.25, .55] }, { d: .14, n: .3, r: [.5, 1], a: [.35, .75] }, { d: .28, n: .14, r: [.7, 1.4], a: [.5, .9] }, { d: .5, n: .06, r: [1, 2.1], a: [.7, 1] }];
  function sizeStars() {
    if (!cv) return; DPR = Math.min(devicePixelRatio || 1, 1.5); W3 = cv.width = Math.round(innerWidth * DPR); H3 = cv.height = Math.round(innerHeight * DPR);
    const land = $('landing'); PAGE = land ? Math.max(0, land.scrollHeight - innerHeight) : 0;
    const total = Math.round(Math.min(innerWidth < 700 ? 420 : 1100, innerWidth * innerHeight / 1500)); seed = 11;
    // each layer is a sky tile as tall as the screen plus what it travels over the whole page; it wraps, so it never ends
    layers = DEPTH.map(L => { const tall = H3 + PAGE * DPR * L.d + 40 * DPR, k = Math.round(total * L.n * tall / H3);
      return { ...L, tall, stars: Array.from({ length: k }, () => ({ x: rnd() * W3, y: rnd() * tall, r: (L.r[0] + rnd() ** 2 * (L.r[1] - L.r[0])) * DPR, a: L.a[0] + rnd() * (L.a[1] - L.a[0]), c: pickCol(), tw: rnd() * 6.283, sp: .5 + rnd() * 1.5 })) }; });
    bgC = null; comets = []; shooters = [];
  }
  // painted once per size: black, a faint neutral Milky Way with dark dust lanes and a haze of unresolved stars
  function paintBg() {
    const tall = H3 + PAGE * DPR * .03 + 40 * DPR; bgC = document.createElement('canvas'); bgC.width = W3; bgC.height = Math.round(tall); const g = bgC.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W3, tall);
    g.save(); g.translate(W3 * .55, tall * .35); g.rotate(-0.5); const bw = Math.hypot(W3, tall) * 1.4, bh = Math.min(W3, H3) * .3;
    const band = g.createLinearGradient(0, -bh, 0, bh); band.addColorStop(0, 'rgba(210,205,190,0)'); band.addColorStop(.38, 'rgba(210,205,190,.028)'); band.addColorStop(.5, 'rgba(225,220,205,.05)'); band.addColorStop(.62, 'rgba(210,205,190,.028)'); band.addColorStop(1, 'rgba(210,205,190,0)');
    g.fillStyle = band; g.fillRect(-bw / 2, -bh, bw, bh * 2);
    for (let i = 0; i < 30; i++) { const x = (rnd() - .5) * bw, y = (rnd() - .5) * bh * .45, r = (40 + rnd() * 140) * DPR, d = g.createRadialGradient(x, y, 0, x, y, r); d.addColorStop(0, 'rgba(0,0,0,.5)'); d.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = d; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < (innerWidth < 700 ? 1400 : 4200); i++) { const y = (rnd() + rnd() + rnd() - 1.5) / 1.5 * bh, x = (rnd() - .5) * bw;
      g.fillStyle = `rgba(235,235,240,${.05 + rnd() * .22})`; const s = DPR * (rnd() < .92 ? .6 : 1); g.fillRect(x, y, s, s); }
    g.restore();
  }
  function spawnComet(t) { const ltr = rnd() < .5, y0 = H3 * (.1 + rnd() * .45), y1 = y0 + H3 * (rnd() - .3) * .4, x0 = ltr ? -W3 * .1 : W3 * 1.1, x1 = ltr ? W3 * 1.1 : -W3 * .1;
    comets.push({ t0: t, dur: 9000 + rnd() * 5000, p0: [x0, y0], p1: [(x0 + x1) / 2, Math.min(y0, y1) - H3 * (.05 + rnd() * .12)], p2: [x1, y1], hist: [], w: (1.2 + rnd()) * DPR }); }
  function spawnShooter(t) { const right = rnd() < .5; shooters.push({ t0: t, x: W3 * (.15 + rnd() * .7), y: H3 * rnd() * .45, a: right ? Math.PI * (.15 + rnd() * .15) : Math.PI * (.7 + rnd() * .15), v: (.6 + rnd() * .5) * DPR, len: (120 + rnd() * 160) * DPR, life: 650 + rnd() * 450 }); }
  const qb = (p0, p1, p2, f) => [(1 - f) ** 2 * p0[0] + 2 * (1 - f) * f * p1[0] + f * f * p2[0], (1 - f) ** 2 * p0[1] + 2 * (1 - f) * f * p1[1] + f * f * p2[1]];
  function drawStars(time = 0) {
    if (!cv || !W3 || !H3) return;   // v0.56.1: a zero-size page (hidden window, mid-resize) made drawImage throw every frame
    const g = cv.getContext('2d'); if (!bgC || bgC.width !== W3) paintBg();
    cam.x += (cam.tx - cam.x) * .05; cam.y += (cam.ty - cam.y) * .05;   // the camera eases towards the pointer
    g.globalCompositeOperation = 'source-over'; g.fillStyle = '#000'; g.fillRect(0, 0, W3, H3);
    g.drawImage(bgC, -cam.x * 6 * DPR - 10 * DPR, -drift * DPR * .03 - cam.y * 4 * DPR - 10 * DPR);
    g.globalCompositeOperation = 'lighter';
    for (const L of layers) {
      const oy = drift * DPR * L.d + cam.y * 60 * L.d * DPR, ox = cam.x * 80 * L.d * DPR;
      for (const s of L.stars) {
        let y = s.y - oy; y = ((y % L.tall) + L.tall) % L.tall; if (y > H3 + 4) continue;
        let x = s.x - ox; if (x < -4) x += W3; else if (x > W3 + 4) x -= W3;
        const tw = reduce ? 1 : .72 + .28 * Math.sin(time / 1000 * s.sp + s.tw), a = s.a * tw, [cr, cg, cb] = s.c;
        g.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
        if (s.r < 1.1 * DPR) g.fillRect(x - s.r / 2, y - s.r / 2, s.r, s.r);
        else { g.beginPath(); g.arc(x, y, s.r * .6, 0, 6.283); g.fill();
          const h = g.createRadialGradient(x, y, 0, x, y, s.r * 4); h.addColorStop(0, `rgba(${cr},${cg},${cb},${a * .3})`); h.addColorStop(1, `rgba(${cr},${cg},${cb},0)`); g.fillStyle = h; g.fillRect(x - s.r * 4, y - s.r * 4, s.r * 8, s.r * 8);
          if (s.r > 1.8 * DPR) { g.strokeStyle = `rgba(${cr},${cg},${cb},${a * .25})`; g.lineWidth = .6 * DPR; g.beginPath(); g.moveTo(x - s.r * 5, y); g.lineTo(x + s.r * 5, y); g.moveTo(x, y - s.r * 5); g.lineTo(x, y + s.r * 5); g.stroke(); } }   // the brightest: small diffraction spikes
      }
    }
    if (!reduce) {
      if (time > nextComet) { if (nextComet) spawnComet(time); nextComet = time + 14000 + rnd() * 12000; }
      comets = comets.filter(c => time - c.t0 < c.dur + 2500);
      for (const c of comets) { const f = Math.min(1, (time - c.t0) / c.dur), e = f < .5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2, p = qb(c.p0, c.p1, c.p2, e);
        if (f < 1) c.hist.push(p); if (c.hist.length > 80 || (f >= 1 && c.hist.length)) c.hist.shift();
        const n = c.hist.length, K = 8, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        for (let k = 0; k < K && n > 2; k++) { const i0 = Math.floor(k * (n - 1) / K), i1 = Math.min(n - 1, Math.ceil((k + 1) * (n - 1) / K) + 1), q = (k + 1) / K;
          g.strokeStyle = `rgba(215,230,255,${q * q * .38})`; g.lineWidth = c.w * (.25 + q * 1.3); g.lineCap = 'butt'; g.lineJoin = 'round';
          g.beginPath(); g.moveTo(c.hist[i0][0], c.hist[i0][1]); for (let i = i0 + 1; i < i1; i++) { const m = mid(c.hist[i], c.hist[i + 1] || c.hist[i]); g.quadraticCurveTo(c.hist[i][0], c.hist[i][1], m[0], m[1]); } g.stroke(); }
        if (f < 1) { const hd = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], 12 * DPR); hd.addColorStop(0, 'rgba(255,255,255,.9)'); hd.addColorStop(.3, 'rgba(210,228,255,.4)'); hd.addColorStop(1, 'rgba(210,228,255,0)'); g.fillStyle = hd; g.beginPath(); g.arc(p[0], p[1], 12 * DPR, 0, 6.283); g.fill(); } }
      if (time > nextShoot) { if (nextShoot) spawnShooter(time); nextShoot = time + 2500 + rnd() * 4000; }
      shooters = shooters.filter(m => time - m.t0 < m.life);
      for (const m of shooters) { const el = time - m.t0, f = el / m.life, d = el * m.v, hx = m.x + Math.cos(m.a) * d, hy = m.y + Math.sin(m.a) * d;
        const Lm = m.len * Math.min(1, f * 3), tx = hx - Math.cos(m.a) * Lm, ty = hy - Math.sin(m.a) * Lm, al = f < .75 ? 1 : (1 - f) / .25;
        const gr = g.createLinearGradient(hx, hy, tx, ty); gr.addColorStop(0, `rgba(255,255,255,${.85 * al})`); gr.addColorStop(.3, `rgba(200,220,255,${.35 * al})`); gr.addColorStop(1, 'rgba(200,220,255,0)');
        g.strokeStyle = gr; g.lineWidth = 1.6 * DPR; g.lineCap = 'round'; g.beginPath(); g.moveTo(hx, hy); g.lineTo(tx, ty); g.stroke(); }
    }
    g.globalCompositeOperation = 'source-over';
  }
  addEventListener('pointermove', e => { if (!html.classList.contains('landing') || e.pointerType === 'touch') return; cam.tx = (e.clientX / innerWidth - .5) * 2; cam.ty = (e.clientY / innerHeight - .5) * 2; }, { passive: true });
  addEventListener('deviceorientation', e => { if (!html.classList.contains('landing') || e.gamma == null) return; cam.tx = Math.max(-1, Math.min(1, e.gamma / 30)); cam.ty = Math.max(-1, Math.min(1, (e.beta - 40) / 30)); }, { passive: true });
  // about 30 frames a second over the whole page (the parallax follows the scroll); nothing while the tab is hidden.
  // "Reduce motion": no animation, but the still sky is redrawn after a scroll so it stays behind the page.
  let lastDraw = 0;
  function loop(t) { raf = requestAnimationFrame(loop); if (document.hidden || t - lastDraw < 32) return; lastDraw = t; drawStars(t); }
  function startStars() { if (!cv) return; sizeStars(); cancelAnimationFrame(raf); if (reduce) drawStars(); else raf = requestAnimationFrame(loop); }
  function stopStars() { cancelAnimationFrame(raf); raf = 0; }
  let rsT = 0; addEventListener('resize', () => { if (!html.classList.contains('landing')) return; clearTimeout(rsT); rsT = setTimeout(() => { sizeStars(); if (reduce) drawStars(); }, 150); });
  if (reduce && $('landing')) $('landing').addEventListener('scroll', () => requestAnimationFrame(() => drawStars()), { passive: true });
  // the page grows as its pictures load: re-measure it once everything is in
  addEventListener('load', () => { if (html.classList.contains('landing')) { sizeStars(); if (reduce) drawStars(); } });
  // the hero film card tilts in 3D with the pointer (a small, smooth turn; none for "reduce motion")
  const tiltEl = document.querySelector('#landing #lp-see') || document.querySelector('#landing .lp-viz');
  if (tiltEl && !reduce) { let tx = 0, ty = 0, ax = 0, ay = 0, on = false;
    const step = () => { ax += (tx - ax) * .1; ay += (ty - ay) * .1; tiltEl.style.transform = `perspective(1100px) rotateX(${(-ay * 6).toFixed(2)}deg) rotateY(${(ax * 8).toFixed(2)}deg) translateZ(0)`;
      if (Math.abs(tx - ax) + Math.abs(ty - ay) > 0.002) requestAnimationFrame(step); else on = false; };
    addEventListener('pointermove', e => { if (!html.classList.contains('landing') || e.pointerType === 'touch' || innerWidth < 900) return; tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5; if (!on) { on = true; requestAnimationFrame(step); } }, { passive: true }); }
  if (html.classList.contains('landing')) startStars();

  /* ---------- Beginner / Advanced ---------- */
  function setLevel(adv) {
    document.body.classList.toggle('adv', adv); store.set('arcnave.level', adv ? 'adv' : 'beg');
    qa('[data-lvl]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.lvl === 'adv') === adv)));
  }
  qa('[data-lvl]').forEach(b => b.onclick = () => {
    const adv = b.dataset.lvl === 'adv'; if (adv === document.body.classList.contains('adv')) return;
    setLevel(adv);
    if (typeof toast === 'function') toast(adv ? `Advanced: ${qa('.adv:not(body):not(dd)').length} more tools and settings, marked with a violet dot.` : 'Beginner: the main tools only, as numbered steps.', 3500);
  });
  setLevel(store.get('arcnave.level') === 'adv');

  /* ---------- left panel collapse (desktop) ---------- */
  if ($('pcol')) $('pcol').onclick = () => { document.body.classList.add('lcol'); $('popen').focus(); };
  if ($('popen')) $('popen').onclick = () => { document.body.classList.remove('lcol'); $('pcol').focus(); };

  /* ---------- share: link, embed code, the phone tab ---------- */
  if ($('embb')) $('embb').onclick = async () => {
    try { writeHash(); } catch { /* sky not ready */ }
    const code = typeof embedCode === 'function' ? embedCode() : '';
    try { await navigator.clipboard.writeText(code); toast('Embed code copied: paste it into any web page'); } catch { prompt('Embed code', code); }
  };
  qa('[data-share-sheet]').forEach(b => b.onclick = () => $('share').click());

  /* ---------- Light curve in the Measure group: tap a star, and app.js's own light curve runs at the slider's colour ---------- */
  // The same route the R Draconis / RW Aurigae cards use (spectrumAt with lcOnly). Arming reuses the Spectrum tap (S.specArm),
  // so the star is picked and centred exactly as for a spectrum.
  let lcArm = false;
  const lcSet = on => { lcArm = on; if ($('lcb')) $('lcb').setAttribute('aria-pressed', String(on)); };
  function lcWrap() {
    if (window.spectrumAt && !window.spectrumAt.arcLc) {
      const orig = window.spectrumAt;
      window.spectrumAt = function (ra, dec, opts = {}) {
        if (lcArm && !opts.lcOnly) { lcSet(false); return orig(ra, dec, { ...opts, lcOnly: +S.band.toFixed(2) }); }
        return orig(ra, dec, opts);
      };
      window.spectrumAt.arcLc = true;
    }
  }
  if ($('lcb')) $('lcb').onclick = () => {
    if (typeof S === 'undefined' || !S.al) return;
    lcWrap(); const on = !lcArm; lcSet(on); S.specArm = on; $('specb').setAttribute('aria-pressed', 'false');
    if (on) toast(`Tap a star to see its light curve at ${S.band.toFixed(2)} µm (the Color slider): its brightness in every pass.`, 5000);
  };
  if ($('specb')) $('specb').addEventListener('click', () => lcSet(false));   // Spectrum takes the tap back

  // the Measure button whose result is on the right stays lit (glow) until that card is closed or replaced
  let lastTool = null;
  const toolLit = () => {
    const card = $('card'), h = card && !card.hidden && card.querySelector('h3'), t = h ? h.textContent : '';
    const showing = lastTool && (lastTool === 'deepb' ? /^Deep view/.test(t) : /^Spectrum of/.test(t));
    if (!showing && card && (card.hidden || t)) lastTool = (lastTool && !t) ? lastTool : null;   // keep while the card is still being built
    ['specb', 'lcb', 'deepb'].forEach(id => $(id) && $(id).classList.toggle('is-on', !!showing && id === lastTool));
  };
  ['specb', 'lcb', 'deepb'].forEach(id => $(id) && $(id).addEventListener('click', () => { lastTool = id; setTimeout(toolLit, 50); }));
  if ($('card')) new MutationObserver(toolLit).observe($('card'), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  qa('[data-open-tb]').forEach(b => b.onclick = () => $('tb').click());

  /* ---------- status line: images, passes, data release, newest image; Aladin link ---------- */
  // v0.57.9: text is written only when it changes (status runs every second, sync every 0.25 s: unconditional writes made
  // every following layout read force a layout of the whole page)
  const setTxt = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  let stImgs = null, stRel = null;
  function status() {
    if (typeof S === 'undefined') return;
    try {
      const n = S.images ? S.images.length : 0;
      setTxt($('tn'), n ? String(n) : 'none');
      setTxt($('tps'), S.eps && S.eps.length ? S.eps.map(e => fmtMonth(e.t0)).join(' · ') : 'none');
      if (n) {
        if (stImgs !== S.images || stImgs.length !== n) { stImgs = S.images; stRel = [[...new Set(S.images.map(releaseOf).filter(Boolean))], Math.max(...S.images.map(i => i.mjd))]; }
        const [rel, last] = stRel;
        setTxt($('trel'), `${rel.length ? rel.join(' + ') : 'archive'} · newest ${fmtDay(last)}`);
        $('trel').classList.toggle('qr3', rel.includes('QR3'));
        $('trel').classList.toggle('newrel', typeof NASA_REL !== 'undefined' && !!NASA_REL && rel.includes(NASA_REL.newest));   // v0.57.1: the newest release NASA has out
      } else setTxt($('trel'), 'none');
      if (S.al) { const [ra, dec] = S.al.getRaDec(), fov = S.al.getFov()[0];
        $('aladinl').href = `https://aladin.cds.unistra.fr/AladinLite/?target=${ra.toFixed(4)}%20${dec >= 0 ? '%2B' : ''}${dec.toFixed(4)}&fov=${Math.min(fov, 180).toFixed(3)}&survey=CDS%2FP%2F2MASS%2Fcolor`; }
    } catch { /* state mid-update */ }
  }
  setInterval(() => { status(); placeHelp(); }, 1000);
  // the mode's help line sits with the mode's controls: under the Watch tabs, or above Hide Planet X in the Test group
  function placeHelp() {
    if (typeof S === 'undefined') return;
    const help = $('help'), px = S.mode === 'px' && !S.lab, home = px ? $('pxp') : document.querySelector('#g-watch .tabs');
    if (!help || !home) return;
    if (px ? help.nextElementSibling !== home : help.previousElementSibling !== home) { if (px) home.before(help); else home.after(help); }
  }
  document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[role=tab][data-m]'); if (!t) return;
    setTimeout(() => { placeHelp(); if (/^(px|lab)$/.test(t.dataset.m)) $('g-test').scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); }, 0); });

  /* ---------- v0.55 light theme: ☀ / ☾ next to ◐ (the choice is kept; index.html applies it before first paint) ---------- */
  const themeSync = () => { const light = document.documentElement.dataset.theme === 'light';
    qa('[data-theme-t]').forEach(b => { b.textContent = light ? '☾' : '☀'; b.setAttribute('aria-pressed', String(light)); const t = light ? 'Dark theme' : 'Light theme'; b.setAttribute('aria-label', t); b.title = t + ' (the sky images stay dark)'; });
    const m = document.querySelector('meta[name=color-scheme]'), c = document.querySelector('meta[name=theme-color]'); if (m) m.content = light ? 'light' : 'dark'; if (c) c.content = light ? '#eef2f8' : '#050913'; };
  qa('[data-theme-t]').forEach(b => b.addEventListener('click', () => { const light = document.documentElement.dataset.theme !== 'light';
    if (light) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme; store.set('arcnave.theme', light ? 'light' : 'dark'); themeSync(); }));
  themeSync();

  /* ---------- plain-words tooltips and the glossary ---------- */
  const TERMS = {
    ra: ['RA (right ascension)', 'A position on the sky measured east-west, in degrees from 0 to 360, like longitude on Earth.'],
    dec: ['Dec (declination)', 'A position on the sky measured north-south, in degrees from -90 to +90, like latitude on Earth.'],
    lam: ['Wavelength (λ), µm', 'The colour of infrared light in the image, in microns (millionths of a metre). SPHEREx sees 0.75 to 5 µm; our eyes stop at about 0.7.'],
    epoch: ['Epoch / pass', 'One full-sky survey by SPHEREx, about six months long. Comparing passes shows what changed in between.'],
    fov: ['Field of view', 'How wide a piece of sky you are looking at, in degrees. The full Moon is about 0.5°.'],
    imgs: ['Images', 'How many real SPHEREx images of this spot are loaded right now.'],
    passes: ['Passes', 'The six-month sky surveys these images come from, with the month each one started.'],
    qr: ['QR2, QR3 (data release)', 'NASA publishes SPHEREx images in Quick Releases. QR3 is the newest; quick releases are early data, so the pipeline flags matter. ARCNAVE asks the archive live, so new releases appear on their own.'],
    stack: ['Stack', 'Several images of one pass added together (a median), so faint things show and one-off glitches like cosmic rays disappear.'],
    arcsec: ['Arcsecond (″)', 'A tiny angle: 1/3600 of a degree. One SPHEREx pixel is about 6.2″. Barnard\'s Star moves about 10″ a year.'],
    pm: ['Proper motion', 'A star\'s slow drift across the sky over years, because it moves through space near us.'],
    snr: ['SNR, σ (sigma)', 'Signal-to-noise: how much a signal stands above the random noise. 3σ can still be chance; above about 5σ it is rarely noise.'],
    ab: ['AB magnitude', 'A brightness scale used across many colours. Bigger numbers are fainter: AB 17 is about 100 times fainter than AB 12.'],
    mag: ['mag (magnitude)', 'Astronomers\' brightness scale. A change of 1 mag is about 2.5 times in brightness; 0.1 mag is about 10 %.'],
    sat: ['Saturated', 'So bright that the detector\'s pixels fill up, like an overexposed photo. Those pixels cannot be measured.'],
    cand: ['Candidate', 'Something ARCNAVE cannot explain yet. It needs an astronomer to check it. It is never a discovery by itself.'],
    // v0.55 U8
    dwarf: ['Brown dwarf', 'Bigger than a planet, too small to be a star: it never starts burning hydrogen, so it cools and glows mostly in the infrared. WISE 0855 is the coldest known, about 0 °C. Nearby ones move fast across the sky.'],
    variable: ['Variable star', 'A star whose brightness changes. R Draconis (a Mira) swells and fades over about eight months; RW Aurigae (a young T Tauri star) flickers as dust passes in front of it. A light curve shows the change.'],
    plx: ['Parallax', 'A nearby star\'s small yearly back-and-forth on the sky, because Earth goes round the Sun. Its size gives the distance: a parallax of 1″ means 3.26 light years. Gaia measures it; ARCNAVE takes it off before fitting a motion.'],
    measpred: ['Measured vs predicted', 'Measured: found on the SPHEREx images themselves, with its own error (±). Predicted: where a catalogue (Gaia, WISE, an orbit) says it should be. ARCNAVE shows both and says whether they agree.']
  };
  // v0.55 U8: what each Advanced section is for (the "?" next to its title); not words, so not in the glossary
  const SEC = {
    'g-when': ['Time', 'Step through the passes, or every image in time order. Stars stay put; anything that shifts is moving.'],
    'g-colour': ['Bands & spectra', 'SPHEREx sees 102 infrared colours. The Color slider picks one; Spectrum measures a star in all of them; Colour composite paints the patch in three detector groups (blue, green, red).'],
    'g-motion': ['Motion', 'What moves between passes: the film, a bright-star search, a deep search for faint sources and slow-mover difference images. Each find is labelled known mover, catalogue prediction or candidate.'],
    'g-over': ['Overlays', 'Other surveys on top of the SPHEREx images: Gaia and WISE stars with arrows for their motion, the ecliptic, and the base sky behind.'],
    'g-measure': ['Measure', 'Ask one star: its light curve (brightness over time, with a significance), or a deep view that adds up each detector\'s images.'],
    'g-test': ['Planet X & agents', 'A sensitivity test, not a search: hide a fake planet and see whether the agents find it. Also the false-alarm and brightness tests.'],
    'g-share': ['Share & report', 'A link to this view, embed code, Python that fetches the same images, a discovery card and a PNG of the sky.'],
    'g-data': ['Data release', 'Which SPHEREx releases and passes are loaded, how old the archive list is, and a button to ask NASA/IPAC IRSA for new images now.']
  };
  for (const [id, [t]] of Object.entries(SEC)) { const hh = document.querySelector(`#${id} > .gh`); if (!hh || hh.querySelector('.secq')) continue;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'secq'; b.dataset.tip = 'sec:' + id; b.textContent = '?'; b.setAttribute('aria-label', `What is ${t} for?`);
    // a click (or Enter) opens it; a second click closes it. Hover and focus already show it, so "open" is tracked per click
    b.addEventListener('click', e => { e.stopPropagation(); if (b._open) { hideTip(); b._open = false; } else { showTip(b); b._open = true; } });
    b.addEventListener('blur', () => { b._open = false; });
    b.addEventListener('keydown', e => e.stopPropagation());   // Enter/Space on "?" must not fold the section
    const sm = hh.querySelector('small'); sm ? hh.insertBefore(b, sm) : hh.append(b); }
  const tip = $('tipbox');
  function showTip(el) {
    const k = el.dataset.tip, t = k.startsWith('sec:') ? SEC[k.slice(4)] : TERMS[k]; if (!t || !tip) return; tip.dataset.for = k;   // v0.55 U8: section help
    tip.innerHTML = `<b></b><br><span></span>`; tip.querySelector('b').textContent = t[0]; tip.querySelector('span').textContent = t[1];
    const r = el.getBoundingClientRect(); tip.classList.add('on'); tip.setAttribute('aria-hidden', 'false');
    const w = tip.offsetWidth, h = tip.offsetHeight, x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const y = r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8; tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => { if (tip) { tip.classList.remove('on'); tip.setAttribute('aria-hidden', 'true'); } };
  qa('dt[data-tip]').forEach(el => { el.tabIndex = 0; el.classList.add('term'); });
  qa('label[data-tip]').forEach(el => el.classList.add('term'));
  document.addEventListener('pointerover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); });
  document.addEventListener('pointerout', e => { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); else hideTip(); });
  const gl = $('glossl');
  if (gl) for (const [, [w, d]] of Object.entries(TERMS)) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = w; dd.textContent = d; gl.append(dt, dd); }
  const gloss = o => { const p = $('glossp'); if (p) p.hidden = !o; if (o) p.querySelector('.x').focus(); };
  qa('[data-gloss]').forEach(b => b.onclick = () => gloss($('glossp').hidden));
  qa('[data-gloss-x]').forEach(b => b.onclick = () => gloss(false));

  /* ---------- "How sure are we?" under the result's badge (same wording as the labels in the Tested drawer) ---------- */
  const SURE = {
    ok: 'Strong. It matches a known value or a known object and passes ARCNAVE\'s checks. It is a measurement of something already known, not a new discovery.',
    near: 'Partly. One check fails, or the change is only a few times bigger than the scatter of comparison stars. Treat it as a candidate to look at again, not as a result.',
    art: 'Probably not real. Sharper than any star, or missing from most images: a cosmic-ray hit, hot pixel or glint.',
    unc: 'Not explained yet. A candidate for an astronomer to check, never a discovery. In the crowded Milky Way most of these are noise.'
  };
  const card = $('card');
  if (card) new MutationObserver(() => {
    // v0.55: not the badge inside a "SPHEREx vs catalogue" row (U4): that is a comparison, not the result's own verdict
    const b = [...card.querySelectorAll('.badge')].find(x => !x.closest('.catrow')); if (!b || card.querySelector('.sure')) return;
    const k = b.classList.contains('ok') ? 'ok' : b.classList.contains('near') ? (/artefact|artifact/i.test(b.textContent) ? 'art' : 'near') : 'unc';
    const d = document.createElement('details'); d.className = 'sure ' + (k === 'ok' ? 'ok' : 'near');
    const s = document.createElement('summary'); s.textContent = 'How sure are we?'; const p = document.createElement('p'); p.textContent = SURE[k];
    d.append(s, p); b.after(d);
  }).observe(card, { childList: true });

  /* ---------- quick start: four tips, once, skippable (Tour menu > Quick start replays it) ---------- */
  const narrow = () => innerWidth <= 1099;
  const STEPS = [
    { k: 1, el: () => $('sf'), h: 'Where to look', p: 'Type a name (M42, Barnard\'s Star) or two numbers in degrees: RA 0 to 360, then Dec -90 to +90 (e.g. 83.82 -5.39, the Orion Nebula). On the whole-sky map, point anywhere to read its RA and Dec. ARCNAVE flies there and fetches the SPHEREx images.' },
    { k: 2, el: () => document.querySelector('#g-where .chips'), sheet: 'panel', h: 'Targets in one tap', p: 'NASA\'s five test targets live here. Tap one and in about 2 minutes you get a result on real images.' },
    { k: 3, el: () => document.querySelector('#g-watch .tabs'), sheet: 'panel', h: 'Watch what moves', p: 'Time machine plays the images in order. Blink and Difference make anything that moves jump out.' },
    { k: 4, el: () => narrow() ? document.querySelector('#mnav [data-sheet=card]') : document.querySelector('.rhead'), h: 'What am I seeing?', p: 'The plain-words explanation and "How sure are we?" appear here. Want more tools? Switch on Advanced.' }
  ];
  const coach = {
    on: false, i: 0, box: null, ring: null,
    auto() { if (store.get('arcnave.coach') === 'done' || html.classList.contains('embed') || document.body.classList.contains('touring') || (window.Tour && Tour.on)) return; this.start(); },
    start() {
      if (html.classList.contains('landing')) return;
      this.on = true; this.i = 0;
      if (!this.box) {
        this.ring = document.createElement('div'); this.ring.className = 'coachring'; this.ring.setAttribute('aria-hidden', 'true');
        this.box = document.createElement('div'); this.box.className = 'coach'; this.box.setAttribute('role', 'dialog'); this.box.setAttribute('aria-live', 'polite'); this.box.setAttribute('aria-labelledby', 'coachh');
        document.body.append(this.ring, this.box);
      }
      this.show(0);
    },
    show(i) {
      const s = STEPS[i]; if (!s) return this.end(true);
      this.i = i;
      if (s.sheet && narrow() && typeof phoneSheet === 'function') phoneSheet(s.sheet);
      const el = s.el(); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      const last = i === STEPS.length - 1;
      this.box.innerHTML = `<span class="cn"></span><h3 id="coachh"></h3><p></p><div class="cb"><span class="dots">${STEPS.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</span>` +
        `<button type="button" class="skip"></button>${i ? '<button type="button" class="back"></button>' : ''}<button type="button" class="hbtn nx"></button></div>`;
      this.box.querySelector('.cn').textContent = `${T('c.step', 'Step')} ${i + 1} / ${STEPS.length}`;
      this.box.querySelector('h3').textContent = T('c.' + s.k + 'h', s.h); this.box.querySelector('p').textContent = T('c.' + s.k + 'p', s.p);
      this.box.querySelector('.skip').textContent = T('c.skip', 'Skip'); this.box.querySelector('.nx').textContent = last ? T('c.done', 'Start exploring') : T('c.next', 'Next');
      if (i) { const b = this.box.querySelector('.back'); b.textContent = T('c.back', 'Back'); b.onclick = () => this.show(i - 1); }
      this.box.querySelector('.skip').onclick = () => this.end(true); this.box.querySelector('.nx').onclick = () => this.show(i + 1);
      requestAnimationFrame(() => this.place(el)); this.box.querySelector('.nx').focus({ preventScroll: true });
    },
    place(el) {
      const r = el && el.getBoundingClientRect(), b = this.box, pad = 6;
      if (!r || !r.width) { this.ring.style.cssText = 'display:none'; b.style.left = '50%'; b.style.top = '30%'; b.style.transform = 'translateX(-50%)'; return; }
      Object.assign(this.ring.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      b.style.transform = ''; const w = b.offsetWidth, h = b.offsetHeight;
      let x = Math.max(12, Math.min(innerWidth - w - 12, r.left)), y = r.bottom + 14;
      if (y + h > innerHeight - 12) y = r.top - h - 14;
      if (y < 12) { y = Math.max(12, Math.min(innerHeight - h - 12, r.top)); x = r.right + 14 + w < innerWidth ? r.right + 14 : Math.max(12, r.left - w - 14); }
      b.style.left = x + 'px'; b.style.top = y + 'px';
    },
    end(done) { this.on = false; if (this.box) { this.box.remove(); this.ring.remove(); this.box = this.ring = null; } if (done) store.set('arcnave.coach', 'done'); }
  };
  qa('[data-coach]').forEach(b => b.addEventListener('click', () => { $('tmenu').hidden = true; $('tourm').setAttribute('aria-expanded', 'false'); coach.start(); }));
  addEventListener('resize', () => { if (coach.on) coach.place(STEPS[coach.i].el()); });
  addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (coach.on) coach.end(true); if ($('glossp') && !$('glossp').hidden) gloss(false); });

  /* ---------- v0.55 tool layout: top-bar buttons, Beginner's three steps, Advanced's sections ----------
     Every button here calls a function app.js already has (or clicks the existing control), so both modes run the same
     code; the mode only changes what is shown. */
  const toolReady = () => typeof S !== 'undefined' && S.field && S.report;
  const needField = () => { if (toolReady()) return true; if (typeof toast === 'function') toast('Pick a spot or a target first: the agents need a field with images.', 4500); return false; };
  if ($('homeb')) $('homeb').onclick = showLanding;
  if ($('sharetop')) $('sharetop').onclick = () => { const b = $('share'); if (b) b.click(); };
  if ($('begfilm')) $('begfilm').onclick = () => { if (needField() && typeof movieStart === 'function') movieStart(); };
  qa('[data-begplay]').forEach(b => b.onclick = () => { const p = $('playb'); if (p) p.click(); });
  if ($('agentsb')) $('agentsb').onclick = () => { const a = $('agents'); if (!a) return; a.open = true;
    if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('agents'); else a.scrollIntoView({ block: 'nearest' }); };
  // Motion: the four searches and the known paths, the same functions as Changes -> "Watch it move"
  qa('[data-mot]').forEach(b => b.onclick = () => {
    if (!needField()) return;
    const k = b.dataset.mot;
    if (k === 'ms' && typeof motionSearch === 'function') motionSearch();
    else if (k === 'ds' && typeof deepSearch === 'function') deepSearch();
    else if (k === 'df' && typeof diffSearch === 'function') diffSearch();
    else if (k === 'sc' && typeof motionScan === 'function') motionScan();
    else if (k === 'kp' && typeof showKnownPaths === 'function') {
      if (S.mode !== 'change' && typeof setMode === 'function') setMode('change');
      if (typeof CHGW !== 'undefined') CHGW.show = 'known';
      if (typeof renderChgPanel === 'function') renderChgPanel(); showKnownPaths();
    }
    if (typeof phoneSheet === 'function' && innerWidth <= 700) phoneSheet('card');
  });
  // Advanced: each group is a section that folds away (remembered); a tool switched on inside a folded section opens it,
  // and the guided tour always sees every section open (CSS: body.touring)
  const SECK = 'arcnave.sec.', FOLD = { 'g-colour': 1, 'g-measure': 1, 'g-test': 1, 'g-share': 1, 'g-data': 1 };   // folded until opened once (v0.55: g-data, U7)
  qa('.panel .grp').forEach(g => {
    const h = g.querySelector('.gh'); if (!h || !g.id) return;
    const saved = store.get(SECK + g.id), shut = saved ? saved === 'shut' : !!FOLD[g.id];
    g.classList.toggle('shut', shut);
    h.setAttribute('aria-expanded', String(!shut)); h.tabIndex = 0;
    const flip = () => { if (!document.body.classList.contains('adv')) return; const s = !g.classList.contains('shut'); g.classList.toggle('shut', s); h.setAttribute('aria-expanded', String(!s)); store.set(SECK + g.id, s ? 'shut' : 'open'); };
    h.addEventListener('click', flip);
    h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  });
  const panelEl = document.querySelector('.panel');
  if (panelEl) new MutationObserver(ms => { for (const m of ms) { const el = m.target; if (el.getAttribute(m.attributeName) !== 'true') continue;
      const g = el.closest('.grp.shut'); if (g) { g.classList.remove('shut'); const h = g.querySelector('.gh'); if (h) h.setAttribute('aria-expanded', 'true'); } } })
    .observe(panelEl, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-selected'] });
  // Beginner: a long result card shows its first lines and "Show details"; buttons always stay visible
  if ($('card')) {
    const card = $('card'); let busy = false;
    const short = () => { if (busy) return; busy = true;
      const kids = [...card.children].filter(x => !x.classList.contains('cdet'));
      let tog = card.querySelector(':scope > .cdet');
      const long = kids.length > 6;
      card.classList.toggle('short', long);
      if (long && !tog) { tog = document.createElement('button'); tog.type = 'button'; tog.className = 'cdet'; tog.setAttribute('aria-expanded', 'false'); tog.textContent = 'Show details';
        tog.onclick = () => { const o = card.classList.toggle('open'); tog.setAttribute('aria-expanded', String(o)); tog.textContent = o ? 'Show less' : 'Show details'; }; }
      // never between a line and its progress bar (.cbar): the bar code would add another bar and the two would loop
      if (long) { let i = 5; while (kids[i] && kids[i].classList.contains('cbar')) i++; const at = kids[i] || null;
        if (tog.parentNode !== card || tog.nextElementSibling !== at) card.insertBefore(tog, at); }
      else if (tog) tog.remove();
      busy = false; };
    // a new card (its title changed) starts short again; a card that grows while you read it stays as you left it
    let title = '';
    new MutationObserver(() => { const h = card.querySelector('h3'), t0 = h ? h.textContent : '';
      if (t0 !== title) { title = t0; card.classList.remove('open'); const t = card.querySelector(':scope > .cdet'); if (t) { t.setAttribute('aria-expanded', 'false'); t.textContent = 'Show details'; } }
      short(); })
      .observe(card, { childList: true });
  }

  /* ---------- v0.40 playback bar on the image: play/pause, step, a scrubber with the pass dates, the date on screen ----------
     It moves the existing #tm slider and sends the same "input" event a drag does, so app.js does all the work; it reads
     the slider's range back every 250 ms. Space plays/pauses and the arrow keys step (not while typing, in a tour or the
     game). Hidden in the Changes view (it shows every image at once), on the start page and in embeds. */
  (() => {
    const tm = $('tm'); if (!tm || html.classList.contains('embed')) return;
    const svg = d => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
    const I = { play: svg('<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>'), pause: svg('<path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/>'),
      prev: svg('<path d="M6 5v14M19 5 9 12l10 7z"/>'), next: svg('<path d="M18 5v14M5 5l10 7-10 7z"/>') };
    const hud = document.createElement('div'); hud.id = 'hud'; hud.className = 'hud'; hud.setAttribute('role', 'group'); hud.setAttribute('aria-label', 'Playback'); hud.hidden = true;
    hud.innerHTML = `<button type="button" class="hbt" data-h="prev" aria-label="Previous image" title="Previous (←)">${I.prev}</button>` +
      `<button type="button" class="hbt hplay" data-h="play" aria-label="Play" aria-pressed="false" title="Play / pause (Space)">${I.play}</button>` +
      `<button type="button" class="hbt" data-h="next" aria-label="Next image" title="Next (→)">${I.next}</button>` +
      `<div class="htrack"><input type="range" id="hudr" min="0" max="0" step="1" value="0" aria-label="Image in time order"><div class="hticks" aria-hidden="true"></div></div>` +
      `<div class="hwhen"><b class="hdate"></b><span class="hsub"></span></div>` +
      `<label class="hspd"><span class="sr">Speed</span><select aria-label="Playback speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>` +
      `<span class="hkeys" aria-hidden="true"><kbd>Space</kbd> play <kbd>←</kbd><kbd>→</kbd> step <kbd>H</kbd> clear view <kbd>B</kbd> blink</span>`;   // v0.55 U9: B
    document.body.append(hud);
    const r = $('hudr'), playB = hud.querySelector('[data-h=play]'), ticks = hud.querySelector('.hticks');
    let timer = 0, dragging = false, tickKey = '';
    const go = v => { const lo = +tm.min, hi = +tm.max; if (hi <= lo) return; v = v > hi ? lo : v < lo ? hi : v; tm.value = v; tm.dispatchEvent(new Event('input', { bubbles: true })); sync(); };
    const step = d => go(+tm.value + d);
    const setPlay = on => { clearInterval(timer); timer = 0; playB.setAttribute('aria-pressed', String(on)); playB.setAttribute('aria-label', on ? 'Pause' : 'Play'); playB.innerHTML = on ? I.pause : I.play;
      if (on) timer = setInterval(() => { if (hud.hidden || (window.Tour && Tour.on)) return setPlay(false); step(1); }, (S && S.mode === 'time' ? 650 : 1300) / speed); };
    // v0.55: playback speed (0.5x, 1x, 2x), remembered; a running play picks it up at once
    let speed = +(store.get('arcnave.speed') || 1) || 1; const spd = hud.querySelector('.hspd select'); spd.value = String(speed);
    spd.addEventListener('change', () => { speed = +spd.value || 1; store.set('arcnave.speed', String(speed)); if (timer) setPlay(true); });
    hud.querySelector('[data-h=prev]').onclick = () => { setPlay(false); step(-1); };
    hud.querySelector('[data-h=next]').onclick = () => { setPlay(false); step(1); };
    playB.onclick = () => setPlay(!timer);
    r.addEventListener('pointerdown', () => { dragging = true; setPlay(false); });
    addEventListener('pointerup', () => { dragging = false; });
    r.addEventListener('input', () => go(+r.value));
    // the date of the image (or pass) on screen, from app.js's own sequence
    const when = () => { try {
      if (S.mode === 'time' && typeof multi === 'function' && multi()) { const x = seqAt(); return [fmtDay(x.im.mjd), `Image ${x.i + 1} of ${S.seq.length} · pass ${x.e + 1}`]; }
      const t = $('tmo').textContent || ''; const e = S.eps[+tm.value]; return [e ? fmtMonth(e.t0) : t, t];
    } catch { return [$('tmo').textContent || '', '']; } };
    // tick marks where each pass starts, labelled with its month
    function drawTicks() {
      const tw = ticks.clientWidth || 0;   // v0.56.1: the track can be narrow (film, small screens): space the labels by their real width
      const lo = +tm.min, hi = +tm.max, key = `${S.mode}|${lo}|${hi}|${S.eps.length}|${S.seq ? S.seq.length : 0}|${Math.round(tw / 16)}`; if (key === tickKey) return; tickKey = key;
      const gap = tw > 0 ? Math.max(12, 100 * 1.6 * 54 / tw) : 12;
      const marks = []; try {
        if (S.mode === 'time' && S.seq && hi === S.seq.length - 1) S.seq.forEach((x, i) => { if (!i || x.e !== S.seq[i - 1].e) marks.push([i, fmtMonth(S.eps[x.e].t0)]); });
        else if (hi === S.eps.length - 1) for (let i = lo; i <= hi; i++) marks.push([i, fmtMonth(S.eps[i].t0)]);
      } catch { }
      // a label closer than 12 % to the one before keeps its tick but not its text (a pass of 3 images among 43)
      let last = -99; ticks.innerHTML = hi > lo ? marks.map(([i, t]) => { const x = (i - lo) / (hi - lo) * 100, show = x - last >= gap; if (show) last = x;
        return `<span style="left:${x.toFixed(2)}%"${show ? '' : ' class="nl"'}><i></i>${show ? t : ''}</span>`; }).join('') : '';
      // v0.56.1: then measure the real labels and drop any that would touch the one before (the last one wins over its neighbour)
      if (tw > 0) { const sp = [...ticks.children].filter(s => s.textContent); const box = s => s.getBoundingClientRect();
        for (let i = 1; i < sp.length; i++) { const a = box(sp[i - 1]), c = box(sp[i]); if (c.left < a.right + 6) { const drop = i === sp.length - 1 && i > 1 ? sp[i - 1] : sp[i]; drop.innerHTML = '<i></i>'; drop.classList.add('nl'); sp.splice(sp.indexOf(drop), 1); i--; } } }
    }
    function sync() {
      const tmr = $('tmr'), live = typeof S !== 'undefined' && S.eps && S.eps.length && tmr && !tmr.hidden && S.mode !== 'change' && !html.classList.contains('landing');
      if (hud.hidden !== !live) hud.hidden = !live; document.body.classList.toggle('has-hud', !!live);
      if (!live) { if (timer) setPlay(false); return; }
      r.min = tm.min; r.max = tm.max; if (!dragging) r.value = tm.value;
      const one = +tm.max <= +tm.min; hud.classList.toggle('one', one);
      const [d, s] = when(), rel = (($('trel') || {}).textContent || '').trim(); setTxt(hud.querySelector('.hdate'), d);
      setTxt(hud.querySelector('.hsub'), s + (rel && rel !== 'none' ? ` · ${rel}` : ''));   // v0.55: the data release, as in the status line
      const vt = `${d}${s ? ', ' + s : ''}`; if (r.getAttribute('aria-valuetext') !== vt) r.setAttribute('aria-valuetext', vt);
      drawTicks();
    }
    setInterval(sync, 250);
    addEventListener('keydown', e => {
      if (hud.hidden || e.ctrlKey || e.metaKey || e.altKey || (window.Tour && Tour.on) || (typeof GAME !== 'undefined' && GAME.on)) return;
      const t = e.target; if (!(t === document.body || t === $('aladin') || t === r)) return;
      if (e.key === ' ' && t !== r) { setPlay(!timer); e.preventDefault(); }
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && t !== r) { setPlay(false); step(e.key === 'ArrowRight' ? 1 : -1); e.preventDefault(); }
    });
  })();

  /* ---------- v0.40 result card: a paragraph that starts with a bold lead-in ("What SPHEREx shows:") gets it as a small
     label above the text, so a long card reads as short sections. Only a class is added; the words stay app.js's own. ---------- */
  if ($('card')) { const lab = () => qa('#card p').forEach(p => { const f = p.firstChild; if (f && f.nodeType === 1 && f.tagName === 'B' && !p.classList.contains('lbl')) p.classList.add('lbl'); });
    new MutationObserver(lab).observe($('card'), { childList: true, subtree: true }); }

  /* ---------- v0.40 loading: what is happening, how far, and something true to read meanwhile ---------- */
  const FACTS = ['SPHEREx maps the whole sky about every six months, in 102 colours of infrared light.',
    'Clyde Tombaugh found Pluto in 1930 by flipping between two photographs: the same trick as Blink.',
    'Barnard\'s Star crosses about 10″ of sky a year, faster than any other star.',
    'One SPHEREx pixel covers about 6.2″ of sky.',
    'WISE 0855 is the coldest brown dwarf known: about 0 °C, 7.4 light years away.',
    'SPHEREx was launched in March 2025. Its archive is open to everyone.',
    'Every image ARCNAVE downloads is kept, so this spot opens in seconds the next time.'];
  let factI = Math.floor(Math.random() * FACTS.length);
  // the loading card: which phase, and a fact that changes every 8 s (app.js keeps writing the title, time and bar)
  if ($('wait')) {
    const w = $('wait'), steps = document.createElement('ol'), fact = document.createElement('p');
    steps.className = 'wsteps'; steps.setAttribute('aria-hidden', 'true');
    steps.innerHTML = [['search', 'Find images'], ['first', 'Download'], ['known', 'Known objects'], ['rest', 'Deeper stacks']].map(([k, t]) => `<li data-ph="${k}">${t}</li>`).join('');
    fact.className = 'wfact'; w.append(steps, fact);
    const show = () => { fact.innerHTML = '<b>While you wait</b> ' + FACTS[factI % FACTS.length]; };
    show(); setInterval(() => { if (!w.hidden) { factI++; show(); } }, 8000);
    setInterval(() => { if (w.hidden || typeof WAIT === 'undefined') return; qa('li', steps).forEach(li => li.classList.toggle('on', li.dataset.ph === WAIT.phase)); }, 400);
  }
  // the right dock while the agents work and no result is shown yet: a skeleton with the working agent's own message
  if ($('rempty')) {
    const sk = document.createElement('div'); sk.className = 'rskel'; sk.setAttribute('aria-hidden', 'true');
    sk.innerHTML = '<span class="rk-eye">Building the report</span><b class="rk-now"></b><small class="rk-msg"></small>' +
      '<i class="sk sk-h"></i><i class="sk"></i><i class="sk"></i><i class="sk sk-s"></i><i class="sk sk-box"></i><p class="rk-fact"></p>';
    $('rempty').append(sk);
    setInterval(() => { const run = document.querySelector('#alist .ag.run'); if (!run) return;
      sk.querySelector('.rk-now').textContent = (run.querySelector('b') || {}).firstChild ? run.querySelector('b').firstChild.textContent : '';
      sk.querySelector('.rk-msg').textContent = (run.querySelector('small') || {}).textContent || '';
      sk.querySelector('.rk-fact').innerHTML = '<b>While you wait</b> ' + FACTS[factI % FACTS.length]; }, 500);
  }
  // "Reading 12 of 126 …" / "Measuring 4 of 36 …" lines in a card get a real progress bar under them
  if ($('card')) { const bars = () => qa('#card p').forEach(p => {
      const m = /\b(?:Reading|Measuring|Downloading|Choosing)\D{0,20}?(\d+) of (\d+)/.exec(p.textContent); const nx = p.nextElementSibling, has = nx && nx.classList.contains('cbar');
      if (!m) { if (has) nx.remove(); return; }
      const f = Math.max(3, Math.min(100, Math.round(+m[1] / Math.max(1, +m[2]) * 100)));
      if (has) nx.firstChild.style.width = f + '%'; else { const b = document.createElement('div'); b.className = 'cbar'; b.setAttribute('aria-hidden', 'true'); b.innerHTML = `<i style="width:${f}%"></i>`; p.after(b); } });
    new MutationObserver(bars).observe($('card'), { childList: true, subtree: true, characterData: true }); }

  /* ---------- v0.40 charts: point at (or tap near) a dot in a spectrum or light curve to read its numbers ---------- */
  if ($('card')) {
    const tip = document.createElement('div'); tip.className = 'ctip'; tip.setAttribute('role', 'status'); tip.hidden = true; document.body.append(tip);
    let hot = null;
    const clear = () => { if (hot) hot.classList.remove('hot'); hot = null; tip.hidden = true; };
    const near = e => { const svg = e.target.closest && e.target.closest('.specsvg'); if (!svg) return clear();
      let best = null, bd = e.pointerType === 'touch' ? 26 : 16;
      for (const d of svg.querySelectorAll('[data-v]')) { const r = d.getBoundingClientRect(), dx = r.left + r.width / 2 - e.clientX, dy = r.top + r.height / 2 - e.clientY, dd = Math.hypot(dx, dy); if (dd < bd) { bd = dd; best = d; } }
      if (!best) return clear();
      if (best !== hot) { if (hot) hot.classList.remove('hot'); hot = best; hot.classList.add('hot'); tip.textContent = best.getAttribute('data-v'); }
      tip.hidden = false; const r = best.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px'; tip.style.top = Math.max(8, r.top - h - 10) + 'px'; };
    $('card').addEventListener('pointermove', near); $('card').addEventListener('pointerdown', near);
    // a finger lifting also "leaves": on touch the readout stays until the next tap or a scroll
    $('card').addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') clear(); }); $('card').addEventListener('scroll', clear, { passive: true });
  }

  /* ---------- v0.40 phones: a one-row header (logo, search, More). The header's other buttons open from More, and the
     menu opens by itself while a tour step points at one of them. Every button keeps its ID and handler. ---------- */
  (() => {
    const top = document.querySelector('header.top'), acts = top && top.querySelector('.acts'); if (!acts || html.classList.contains('embed')) return;
    acts.id = acts.id || 'acts';
    const b = document.createElement('button'); b.type = 'button'; b.id = 'moreb'; b.className = 'moreb';
    b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', acts.id); b.setAttribute('aria-label', 'More: game, examples, tour, learn, tests, view and language');
    b.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/></svg><span>More</span>';
    acts.before(b);
    let byTour = false;
    const set = on => { top.classList.toggle('open', on); b.setAttribute('aria-expanded', String(on)); };
    b.onclick = e => { e.stopPropagation(); byTour = false; set(!top.classList.contains('open')); };
    acts.addEventListener('click', e => { const t = e.target.closest('button'); if (t && t.id !== 'tourm' && !byTour) set(false); });   // a choice closes it; Tour opens its own menu
    document.addEventListener('pointerdown', e => { if (!byTour && top.classList.contains('open') && !top.contains(e.target)) set(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && top.classList.contains('open') && !byTour) { set(false); b.focus(); } });
    setInterval(() => { const st = window.Tour && Tour.on && Tour.step, want = !!st && st.els.some(el => acts.contains(el));
      if (want !== byTour) { byTour = want; set(want); } }, 300);
  })();

  /* ---------- v0.40 phones, guided tour: the guide checks once, when a step opens, whether its tools fit a half sheet; a
     panel that fills in a moment later (Changes) can outgrow it. While a step is open this re-checks every 0.4 s and opens
     the sheet fully when the step's tools need it, and puts it back to half when the step changes. ---------- */
  (() => {
    let mine = null, recentre = null, grown = 0, lastRoom = -1;
    setInterval(() => {
      if (innerWidth > 700) return;
      const st = window.Tour && Tour.on && Tour.step, body = document.body;
      if (!st) { mine = recentre = null; return; }
      // the next step: back to half, and its tools placed again for the half sheet (the guide placed them for a full one)
      if (mine && mine !== st.t) { if (body.dataset.snap === 'full') body.dataset.snap = 'half'; mine = null; recentre = st.t; return; }
      // v0.53: already full for this step, but its tools grew after they were placed (since v0.52 the Changes panel fills
      // in when the worker is done, after the step opens; seen as 47 % of it on screen): place them again
      if (mine === st.t && body.dataset.snap === 'full') { const p2 = document.querySelector('.panel'), els = p2 ? st.els.filter(el => p2.contains(el) && el.getClientRects().length) : [];
        if (els.length) { const r2 = els.map(el => el.getBoundingClientRect()), t2 = Math.min(...r2.map(r => r.top)), need2 = Math.max(...r2.map(r => r.bottom)) - t2;
          if (grown && Math.abs(need2 - grown) > 4) p2.scrollTop += t2 - p2.getBoundingClientRect().top - 8; grown = need2; }
        return; }
      grown = 0;
      const pan = document.querySelector('.panel'); if (!pan || body.dataset.sheet !== 'panel' || body.dataset.snap !== 'half') return;
      const inP = st.els.filter(el => pan.contains(el) && el.getClientRects().length); if (!inP.length) { recentre = null; return; }
      const rs = inP.map(el => el.getBoundingClientRect()), top = Math.min(...rs.map(r => r.top)), need = Math.max(...rs.map(r => r.bottom)) - top, room = pan.clientHeight;
      if (need > room - 16) { body.dataset.snap = 'full'; mine = st.t; recentre = null; setTimeout(() => { pan.scrollTop += inP[0].getBoundingClientRect().top - pan.getBoundingClientRect().top - 8; }, 350); }
      // v0.55: the sheet animates from full back to half; centre the tools only once its height holds still (measured
      // mid-animation, they ended 7-35 % on screen once Changes, built early since v0.55, always opened the sheet fully)
      // ...and also whenever they fit but sit partly outside the sheet: the tour placed them while the sheet was taller (seen
      // on step 14, Hide Planet X: 57 % on screen after Changes had opened the sheet fully)
      else { const pr = pan.getBoundingClientRect(), bottom = Math.max(...rs.map(r => r.bottom)), out = top < pr.top - 1 || bottom > pr.bottom + 1;
        if (recentre === st.t || out) { if (Math.abs(room - lastRoom) > 2) { lastRoom = room; return; } recentre = null; pan.scrollTop += (top - pr.top) - (room - need) / 2; } }
      lastRoom = room;
    }, 400);
  })();

  applyLang();
})();

/* v0.38 phones: three sheet heights (peek / half / full). Presentation only: it sets body[data-snap]; app.js still decides
   which sheet is shown (body[data-sheet], phoneSheet). Dragging the sky drops the sheet to a peek so the images are seen;
   opening a sheet, a tab tap, a tap on the sky (it may pick a star) or a new result brings it back to half, unless the user
   lowered it on purpose (then a running spectrum's updates do not keep pushing it up). */
(() => {
  const phone = () => innerWidth <= 700, body = document.body;
  let userPeek = false;
  const set = (s, user) => { if (user != null) userPeek = user && s === 'peek'; if (body.dataset.snap !== s) body.dataset.snap = s; };
  const g = document.createElement('button');
  g.id = 'sgrab'; g.type = 'button'; g.setAttribute('aria-label', 'Resize the panel (tap, or swipe up and down)'); g.innerHTML = '<i aria-hidden="true"></i>';
  body.appendChild(g);
  set('peek');   // first look on a phone: the sky, not a panel
  // the real header height (it wraps to two rows on a phone), so a full sheet stops under it
  // v0.40: not measured while the start page covers the tool (each measurement forced a layout of the whole page); measured
  // again the moment the tool is shown
  const top = document.querySelector('header.top, .top'), hb = () => { if (top && !document.documentElement.classList.contains('landing')) body.style.setProperty('--hbr', Math.ceil(top.getBoundingClientRect().height) + 'px'); };
  hb(); addEventListener('resize', hb); setTimeout(hb, 1500);
  new MutationObserver(() => requestAnimationFrame(hb)).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const order = ['peek', 'half', 'full'], at = () => Math.max(0, order.indexOf(body.dataset.snap || 'half'));
  let y0 = null, moved = false;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; moved = false; try { g.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
  g.addEventListener('pointermove', e => { if (y0 != null && Math.abs(e.clientY - y0) > 12) moved = true; });
  g.addEventListener('pointerup', e => {
    if (y0 == null) return; const dy = e.clientY - y0; y0 = null;
    if (moved) set(order[Math.max(0, Math.min(2, at() + (dy < 0 ? 1 : -1) * (Math.abs(dy) > 220 ? 2 : 1)))], true);
    else set(order[(at() + 1) % 3], true);   // tap: peek -> half -> full -> peek
  });
  g.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(order[Math.max(0, Math.min(2, at() + (e.key === 'ArrowUp' ? 1 : -1)))], true); } });
  // a peeking sheet opens when tapped
  ['card', 'agents', 'rempty'].map(id => document.getElementById(id)).concat([...document.querySelectorAll('.panel')])
    .forEach(el => el && el.addEventListener('click', () => { if (phone() && body.dataset.snap === 'peek') set('half', false); }, true));
  // dragging the sky lowers the sheet; a tap on the sky (it may pick a star and fill the card) lets results raise it again
  const sky = document.getElementById('aladin'); let d = null;
  if (sky) {
    sky.addEventListener('pointerdown', e => { d = { x: e.clientX, y: e.clientY, moved: false }; }, true);
    sky.addEventListener('pointermove', e => { if (d && !d.moved && phone() && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14) { d.moved = true; set('peek', true); } }, true);
    sky.addEventListener('pointerup', () => { if (d && !d.moved) userPeek = false; d = null; }, true);
  }
  const up = () => { if (phone() && !userPeek && body.dataset.snap === 'peek' && body.dataset.sheet && body.dataset.sheet !== 'none') set('half'); };
  // a sheet opened (tab tap, a result, a star picked) comes up to half
  let last = body.dataset.sheet;
  new MutationObserver(() => { const s = body.dataset.sheet; if (s !== last) { last = s; userPeek = false; up(); } }).observe(body, { attributes: true, attributeFilter: ['data-sheet'] });
  const nav = document.getElementById('mnav');
  if (nav) nav.addEventListener('click', e => { if (e.target.closest('[data-sheet]')) { userPeek = false; setTimeout(up, 0); } });
  // a new result in the card (report, spectrum, light curve, star, asteroid)
  const card = document.getElementById('card');
  if (card) { let t = 0; new MutationObserver(() => { if (body.dataset.sheet !== 'card' || card.hidden) return; clearTimeout(t); t = setTimeout(up, 80); }).observe(card, { childList: true }); }
})();

/* v0.38: results come into view by themselves. Hide Planet X's controls, verdict, map and summary, the Flags and Gaia
   legends, and a NEW result card (its title changed) are scrolled into view inside their panel, so nobody has to slide down
   to find them. Progress updates of the same card (a spectrum filling in) do not move the page. */
(() => {
  const $ = id => document.getElementById(id);
  const smooth = 'auto';   // an instant jump: 'smooth' did not move at all in some views (seen in a background tab), and the user must see it
  const show = el => { if (!el || el.hidden || !el.getClientRects().length) return; try { el.scrollIntoView({ behavior: smooth, block: 'nearest', inline: 'nearest' }); } catch { /* old browser */ } };
  const soon = el => setTimeout(() => show(el), 60);
  const onShow = id => { const el = $(id); if (el) new MutationObserver(() => { if (!el.hidden) soon(el); }).observe(el, { attributes: true, attributeFilter: ['hidden'] }); };
  ['pxp', 'pxc', 'flagleg', 'gaialeg', 'cwleg'].forEach(onShow);
  ['pxt', 'pxs'].forEach(id => { const el = $(id); if (el) new MutationObserver(() => { if (el.textContent.trim()) soon(el); }).observe(el, { childList: true, characterData: true, subtree: true }); });
  const card = $('card'); let key = '';
  if (card) new MutationObserver(() => {
    if (card.hidden) return; const h = card.querySelector('h2, h3'), k = h ? h.textContent : card.textContent.slice(0, 40);
    if (k === key) return; key = k; card.scrollTop = 0; soon(card);
  }).observe(card, { childList: true });
})();

