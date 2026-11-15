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
  function showLanding() {
    if (html.classList.contains('embed')) return;
    html.classList.add('landing'); landing.scrollTop = 0; startStars();
    const b = landing.querySelector('[data-launch]'); if (b) b.focus({ preventScroll: true });
  }
  if (landing) {
    landing.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      if (a) {   // in-page links scroll the landing; they must never become a hash (a hash opens the tool on reload)
        e.preventDefault(); const t = a.getAttribute('href').slice(1); const el = t && $(t);
        if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        $('lplinks').classList.remove('open'); landing.querySelector('.lp-menu').setAttribute('aria-expanded', 'false');
      }
      const b = e.target.closest('[data-launch],[data-launch-ct],[data-launch-tour]'); if (!b) return;
      e.preventDefault();
      if (b.dataset.launchCt) launchCt(b.dataset.launchCt); else if (b.dataset.launchTour) launchTour(b.dataset.launchTour); else launch();
    });
    const menu = landing.querySelector('.lp-menu');
    menu.onclick = () => { const o = $('lplinks').classList.toggle('open'); menu.setAttribute('aria-expanded', String(o)); };
    const nav = landing.querySelector('.lp-nav');
    landing.addEventListener('scroll', () => { nav.classList.toggle('stuck', landing.scrollTop > 8); drift = landing.scrollTop; }, { passive: true });
    // reveal on scroll
    if (reduce || !('IntersectionObserver' in window)) qa('.rv', landing).forEach(el => el.classList.add('in'));
    else { const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { root: landing, rootMargin: '0px 0px -8% 0px', threshold: .08 });
      qa('.rv', landing).forEach(el => io.observe(el));
      qa('.lp-hero .rv', landing).forEach(el => setTimeout(() => el.classList.add('in'), 30));   // the first screen never waits for the observer
      setTimeout(() => { if (!landing.querySelector('.lp-sec .rv.in')) qa('.rv', landing).forEach(el => el.classList.add('in')); }, 2500); }   // a page that does not render frames (hidden, throttled) shows everything
    // hero: the still frame paints first; the real blink GIF (366 kB) then plays once the page is idle.
    // v0.40: where the browser can decode it (ImageDecoder), its own frames play on a canvas over the still, at the GIF's
    // own timing, so the still stays the page's main image; elsewhere the GIF replaces the still as before.
    const img = $('lpgif');
    if (img && !reduce) { const swap = async () => {
        if ('ImageDecoder' in window) try {
          const dec = new ImageDecoder({ data: await (await fetch(img.dataset.anim)).arrayBuffer(), type: 'image/gif' }); await dec.tracks.ready;
          const n = dec.tracks.selectedTrack.frameCount, cv2 = document.createElement('canvas'), g2 = cv2.getContext('2d'); let i = 0;
          cv2.className = 'lpanim'; cv2.setAttribute('aria-hidden', 'true'); img.after(cv2);
          const step = async () => { if (!html.classList.contains('landing')) return setTimeout(step, 1000);
            const { image } = await dec.decode({ frameIndex: i }); cv2.width = image.displayWidth; cv2.height = image.displayHeight; g2.drawImage(image, 0, 0);
            const ms = Math.max(60, (image.duration || 500000) / 1000); image.close(); i = (i + 1) % n; setTimeout(step, ms); };
          return step();
        } catch { /* fall back to the GIF */ }
        const g = new Image(); g.onload = () => { img.src = g.src; }; g.src = img.dataset.anim; };
      // v0.43: only once the start page is really shown. A link straight into the tool never sees it, so it never downloads
      // or decodes the 358 kB GIF (it did, measured on the tool page); going back to the start page later starts it then.
      let blinkOn = false; const startBlink = () => { if (blinkOn || !html.classList.contains('landing')) return; blinkOn = true; (window.requestIdleCallback || (f => setTimeout(f, 1200)))(swap); };
      startBlink(); if (!blinkOn) { const mo = new MutationObserver(() => { startBlink(); if (blinkOn) mo.disconnect(); }); mo.observe(html, { attributes: true, attributeFilter: ['class'] }); } }
    // download (not run) the viewer once the visitor shows interest (points at or touches a Launch or target button, or
    // scrolls to the targets), so Launch is quick; v0.40: no 1.1 MB download for someone who only reads the page
    let pre = false; const prefetch = () => { if (pre || typeof S !== 'undefined' || !window.ARC_TOOL) return; pre = true;
      for (const href of [ARC_TOOL.aladin, ...ARC_TOOL.rest]) { const l = document.createElement('link'); l.rel = 'prefetch'; l.as = 'script'; l.href = href; document.head.append(l); } };
    for (const ev of ['pointerover', 'touchstart', 'focusin']) landing.addEventListener(ev, e => { if (e.target.closest && e.target.closest('[data-launch],[data-launch-ct],[data-launch-tour]')) prefetch(); }, { passive: true });
    if ('IntersectionObserver' in window && $('lp-start')) { const po = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { prefetch(); po.disconnect(); } }, { root: landing }); po.observe($('lp-start')); }
    const ticks = qa('.lp-ticks i', landing); let ti = 0;
    if (!reduce && ticks.length) setInterval(() => { if (!html.classList.contains('landing')) return; ticks.forEach((t, i) => t.classList.toggle('on', i === ti)); ti = (ti + 1) % ticks.length; }, 520);
  }
  // the brand in the tool goes back to the start page
  if ($('brandb')) $('brandb').onclick = showLanding;
  // H (Clear view) must not act on the hidden tool while the start page is open
  document.addEventListener('keydown', e => { if (html.classList.contains('landing') && /^[hH]$/.test(e.key)) e.stopPropagation(); }, true);

  /* ---------- star field behind the landing (decorative; drawn, not data) ---------- */
  const cv = $('starfield'); let raf = 0, drift = 0, stars = [], nebC = null;
  function sizeStars() {
    if (!cv) return; const dpr = Math.min(devicePixelRatio || 1, 1.5); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const n = Math.round(Math.min(320, innerWidth * innerHeight / 5200)); let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    stars = Array.from({ length: n }, () => ({ x: rnd(), y: rnd(), r: (rnd() ** 3) * 1.6 + .3, z: rnd() * .8 + .2, t: rnd() * 6.28, hue: rnd() < .12 ? 35 : rnd() < .3 ? 185 : 220 }));
  }
  function drawStars(time = 0) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, dpr = W / innerWidth; g.clearRect(0, 0, W, H);
    // v0.40: the two soft glows are painted once per size and copied each frame (two full-screen gradients per frame were costly)
    if (!nebC || nebC.width !== W || nebC.height !== H) { nebC = document.createElement('canvas'); nebC.width = W; nebC.height = H; const n = nebC.getContext('2d');
      const neb = n.createRadialGradient(W * .75, H * .2, 0, W * .75, H * .2, W * .55); neb.addColorStop(0, 'rgba(45,212,191,.06)'); neb.addColorStop(1, 'rgba(45,212,191,0)');
      n.fillStyle = neb; n.fillRect(0, 0, W, H);
      const neb2 = n.createRadialGradient(W * .15, H * .85, 0, W * .15, H * .85, W * .45); neb2.addColorStop(0, 'rgba(255,181,71,.045)'); neb2.addColorStop(1, 'rgba(255,181,71,0)');
      n.fillStyle = neb2; n.fillRect(0, 0, W, H); }
    g.drawImage(nebC, 0, 0);
    for (const p of stars) {
      const y = ((p.y * H - drift * dpr * p.z * .25) % H + H) % H, x = p.x * W + Math.sin(time / 9000 + p.t) * 6 * p.z * dpr;
      const a = reduce ? .7 : .45 + .45 * Math.sin(time / 1400 * p.z + p.t);
      g.fillStyle = `hsla(${p.hue},70%,88%,${a})`; g.beginPath(); g.arc(x, y, p.r * dpr, 0, 6.283); g.fill();
    }
    // one star that hops between two spots, like a mover in a blink comparator (decorative, not data)
    const nar = innerWidth < 700, ph = reduce ? 0 : Math.floor(time / 900) % 2, mx = W * (nar ? .8 : .5) + ph * 18 * dpr, my = ((H * (nar ? .14 : .17) - drift * dpr * .2) % H + H) % H - ph * 7 * dpr;   // v0.40: in the empty sky above the hero, clear of the words
    g.fillStyle = 'rgba(255,200,120,.95)'; g.beginPath(); g.arc(mx, my, 1.9 * dpr, 0, 6.283); g.fill();
    g.strokeStyle = 'rgba(255,181,71,.45)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.arc(mx, my, 9 * dpr, 0, 6.283); g.stroke();
    if (!reduce) meteors(g, time, W, H, dpr);
  }
  // v0.38: a star shower (decorative, not data): shooting stars every 1.2-3.2 s, sometimes two, across the upper sky
  let shower = [], nextAt = 0;
  function meteors(g, time, W, H, dpr) {
    if (time > nextAt) {
      const n = Math.random() < 0.3 ? 2 : 1;
      for (let k = 0; k < n; k++) shower.push({ t0: time + k * 180, x: W * (0.15 + Math.random() * 0.8), y: H * Math.random() * 0.45,
        a: Math.PI * (0.72 + Math.random() * 0.12), v: (0.55 + Math.random() * 0.5) * dpr, len: (180 + Math.random() * 140) * dpr, life: 900 + Math.random() * 600 });
      nextAt = time + 1200 + Math.random() * 2000;
    }
    shower = shower.filter(m => time - m.t0 < m.life);
    for (const m of shower) {
      const e = time - m.t0; if (e < 0) continue;
      const f = e / m.life, d = e * m.v, hx = m.x + Math.cos(m.a) * d, hy = m.y + Math.sin(m.a) * d;
      const L = m.len * Math.min(1, f * 3), tx = hx - Math.cos(m.a) * L, ty = hy - Math.sin(m.a) * L, al = f < 0.8 ? 1 : (1 - f) / 0.2;
      const gr = g.createLinearGradient(hx, hy, tx, ty); gr.addColorStop(0, `rgba(255,255,255,${0.95 * al})`); gr.addColorStop(0.3, `rgba(170,210,255,${0.5 * al})`); gr.addColorStop(1, 'rgba(120,160,255,0)');
      g.strokeStyle = gr; g.lineWidth = 3 * dpr; g.lineCap = 'round'; g.beginPath(); g.moveTo(hx, hy); g.lineTo(tx, ty); g.stroke();
      // the head: a small soft glow (v0.40: a gradient instead of shadowBlur, which re-blurs every frame)
      const hg = g.createRadialGradient(hx, hy, 0, hx, hy, 9 * dpr); hg.addColorStop(0, `rgba(255,255,255,${al})`); hg.addColorStop(.3, `rgba(200,225,255,${.55 * al})`); hg.addColorStop(1, 'rgba(190,220,255,0)');
      g.fillStyle = hg; g.beginPath(); g.arc(hx, hy, 9 * dpr, 0, 6.283); g.fill();
    }
  }
  // v0.40: about 24 frames a second, and none while the first screen is scrolled away (the field then holds still):
  // the twinkle looks the same, and a phone's main thread stays free
  let lastDraw = 0;
  // (drift is the landing's scroll position, kept by its scroll handler: reading scrollTop here forced a layout every frame)
  let vh = innerHeight; addEventListener('resize', () => { vh = innerHeight; });
  function loop(t) { raf = requestAnimationFrame(loop);
    if (t - lastDraw < 40 || drift > vh * 1.2) return; lastDraw = t; drawStars(t); }
  function startStars() { if (!cv) return; sizeStars(); cancelAnimationFrame(raf); if (reduce) drawStars(); else raf = requestAnimationFrame(loop); }
  function stopStars() { cancelAnimationFrame(raf); raf = 0; }
  addEventListener('resize', () => { if (html.classList.contains('landing')) { sizeStars(); if (reduce) drawStars(); } });
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
  function status() {
    if (typeof S === 'undefined') return;
    try {
      const n = S.images ? S.images.length : 0;
      $('tn').textContent = n ? String(n) : 'none';
      $('tps').textContent = S.eps && S.eps.length ? S.eps.map(e => fmtMonth(e.t0)).join(' · ') : 'none';
      if (n) {
        const rel = [...new Set(S.images.map(releaseOf).filter(Boolean))], last = Math.max(...S.images.map(i => i.mjd));
        $('trel').textContent = `${rel.length ? rel.join(' + ') : 'archive'} · newest ${fmtDay(last)}`;
        $('trel').classList.toggle('qr3', rel.includes('QR3'));
      } else $('trel').textContent = 'none';
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
    cand: ['Candidate', 'Something ARCNAVE cannot explain yet. It needs an astronomer to check it. It is never a discovery by itself.']
  };
  const tip = $('tipbox');
  function showTip(el) {
    const t = TERMS[el.dataset.tip]; if (!t || !tip) return;
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
    const b = card.querySelector('.badge'); if (!b || card.querySelector('.sure')) return;
    const k = b.classList.contains('ok') ? 'ok' : b.classList.contains('near') ? (/artefact|artifact/i.test(b.textContent) ? 'art' : 'near') : 'unc';
    const d = document.createElement('details'); d.className = 'sure ' + (k === 'ok' ? 'ok' : 'near');
    const s = document.createElement('summary'); s.textContent = 'How sure are we?'; const p = document.createElement('p'); p.textContent = SURE[k];
    d.append(s, p); b.after(d);
  }).observe(card, { childList: true });

  /* ---------- quick start: four tips, once, skippable (Tour menu > Quick start replays it) ---------- */
  const narrow = () => innerWidth <= 1099;
  const STEPS = [
    { k: 1, el: () => $('sf'), h: 'Where to look', p: 'Type a name (M42, Barnard\'s Star) or an RA Dec (190 -4) here. ARCNAVE flies there and fetches the SPHEREx images.' },
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
      `<span class="hkeys" aria-hidden="true"><kbd>Space</kbd> play <kbd>←</kbd><kbd>→</kbd> step <kbd>H</kbd> clear view</span>`;
    document.body.append(hud);
    const r = $('hudr'), playB = hud.querySelector('[data-h=play]'), ticks = hud.querySelector('.hticks');
    let timer = 0, dragging = false, tickKey = '';
    const go = v => { const lo = +tm.min, hi = +tm.max; if (hi <= lo) return; v = v > hi ? lo : v < lo ? hi : v; tm.value = v; tm.dispatchEvent(new Event('input', { bubbles: true })); sync(); };
    const step = d => go(+tm.value + d);
    const setPlay = on => { clearInterval(timer); timer = 0; playB.setAttribute('aria-pressed', String(on)); playB.setAttribute('aria-label', on ? 'Pause' : 'Play'); playB.innerHTML = on ? I.pause : I.play;
      if (on) timer = setInterval(() => { if (hud.hidden || (window.Tour && Tour.on)) return setPlay(false); step(1); }, S && S.mode === 'time' ? 650 : 1300); };
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
      const lo = +tm.min, hi = +tm.max, key = `${S.mode}|${lo}|${hi}|${S.eps.length}|${S.seq ? S.seq.length : 0}`; if (key === tickKey) return; tickKey = key;
      const marks = []; try {
        if (S.mode === 'time' && S.seq && hi === S.seq.length - 1) S.seq.forEach((x, i) => { if (!i || x.e !== S.seq[i - 1].e) marks.push([i, fmtMonth(S.eps[x.e].t0)]); });
        else if (hi === S.eps.length - 1) for (let i = lo; i <= hi; i++) marks.push([i, fmtMonth(S.eps[i].t0)]);
      } catch { }
      // a label closer than 12 % to the one before keeps its tick but not its text (a pass of 3 images among 43)
      let last = -99; ticks.innerHTML = hi > lo ? marks.map(([i, t]) => { const x = (i - lo) / (hi - lo) * 100, show = x - last >= 12; if (show) last = x;
        return `<span style="left:${x.toFixed(2)}%"${show ? '' : ' class="nl"'}><i></i>${show ? t : ''}</span>`; }).join('') : '';
    }
    function sync() {
      const tmr = $('tmr'), live = typeof S !== 'undefined' && S.eps && S.eps.length && tmr && !tmr.hidden && S.mode !== 'change' && !html.classList.contains('landing');
      hud.hidden = !live; document.body.classList.toggle('has-hud', !!live);
      if (!live) { if (timer) setPlay(false); return; }
      r.min = tm.min; r.max = tm.max; if (!dragging) r.value = tm.value;
      const one = +tm.max <= +tm.min; hud.classList.toggle('one', one);
      const [d, s] = when(); hud.querySelector('.hdate').textContent = d; hud.querySelector('.hsub').textContent = s;
      r.setAttribute('aria-valuetext', `${d}${s ? ', ' + s : ''}`);
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
    let mine = null, recentre = null, grown = 0;
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
      else if (recentre === st.t) { recentre = null; pan.scrollTop += (top - pan.getBoundingClientRect().top) - (room - need) / 2; }
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

