/* ARCNAVE guided tours (v0.14, v0.19 in English and Tamil). Two scripts told over the live app, not over screenshots:
   - Story, "90 seconds": ten chapters that auto-advance (Neptune found with a pen, 1846 -> Tombaugh's blink, 1930 ->
     Planet Nine, 2016 -> SPHEREx -> agents -> the real asteroid 3865 Lindbloom under a spotlight -> the game -> Hide
     Planet X -> the 18-field scorecard -> your turn). The first three chapters have small illustrations, labelled so.
   - v0.19: every caption, the guide and the intro in English or Tamil (தமிழ்); the button on the intro and on the tour
     card switches, the choice is remembered, #tour&lang=ta opens it in Tamil. The rest of the app stays in English.
   - Guide, "Learn every tool": one step per tool, each with What it is and How to use it, stepped by hand. Steps that
     need images switch the app to that mode on the bundled real example, so every tool is shown on real SPHEREx data.
   Both open the bundled example in the background. Every number in a caption is read from the app's own results
   (the example run and public/scorecard.json), none is typed in. The overlay never blocks the app: only the caption
   takes clicks. Esc leaves, the arrow keys step.
   v0.14 speed: the spotlight's dimming is a static shadow (the v0.13 pulse animated a full-screen shadow, a repaint
   of the whole window every frame), and the spotlight is only moved when its target really moved. */
(() => {
  const $ = id => document.getElementById(id), q = s => document.querySelector(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  const phone = () => innerWidth <= 1099;   // v0.26: tablets use the one-dock switch too
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scs = null, root, spot, card, bar, ix = -1, timer = 0, left = 0, paused = false, runP = null, raf = 0, token = 0, CH = [], kind = 'story', lastR = '';

  const astro = () => S.inside && S.inside.asteroids && S.inside.asteroids.find(a => a.confirmed);
  // the guide loads it quietly (no flight, no card), so its Whole sky step can stay on the whole sky; tool steps fly there when they need it
  const example = () => { runP = runP || (S.report && Math.abs(S.field.ra - EXAMPLES.proof.ra) < 0.01 ? Promise.resolve() : runExample('proof', kind === 'guide' ? { skipNav: true, focus: null } : {})); return runP; };
  const sheet = s => { if (phone()) phoneSheet(s); };

  /* ---------- Language (v0.19): English or Tamil for the intro, the story and the guide. The rest of the app stays English. ---------- */
  // v0.20: English, Tamil, Hindi, Spanish (public/i18n.js). Strings are [English, Tamil] (or [en, ta, hi, es] for captions
  // with live numbers); Hindi and Spanish come from the dictionary in i18n.js, English when a sentence is missing.
  const I18N = window.ARC_I18N || { langs: [{ id: 'en', name: 'English' }, { id: 'ta', name: 'தமிழ்' }] }, IDS = I18N.langs.map(l => l.id), IX = { en: 0, ta: 1, hi: 2, es: 3 };
  let lang = 'en';
  try { const m = /(?:[#&?])lang=([a-z]{2})\b/.exec((window.BOOT_HASH || '') + location.hash + location.search), st = localStorage.getItem('arcnave.lang');
    lang = m && IDS.includes(m[1]) ? m[1] : IDS.includes(st) ? st : 'en'; } catch { /* storage blocked: English */ }
  const tr = v => { if (!Array.isArray(v)) return v; if (lang === 'en') return v[0]; if (lang === 'ta') return v[1] ?? v[0];
    if (v.length > 2 && v[IX[lang]] != null) return v[IX[lang]]; const d = I18N[lang]; return (d && d[v[0]]) || v[0]; };
  const UI = {
    next: ['Next', 'அடுத்து'], pause: ['Pause', 'நிறுத்து'], play: ['Play', 'தொடர்'], close: ['Close', 'மூடு'], skip: ['Skip story', 'கதையைத் தவிர்'],
    start: ['Start exploring', 'ஆராயத் தொடங்கு'], what: ['What it is', 'இது என்ன'], how: ['How to use it', 'எப்படிப் பயன்படுத்துவது'],
    loading: ['Loading the real example images...', 'உண்மையான உதாரணப் படங்கள் ஏறுகின்றன...'],
    slow: ['NASA\'s archive is slow right now, so the images are still on their way. The tour carries on; they appear when they arrive.',
      'நாசாவின் களஞ்சியம் இப்போது மெதுவாக இருக்கிறது, அதனால் படங்கள் இன்னும் வந்துகொண்டிருக்கின்றன. கதை தொடர்கிறது; படங்கள் வந்ததும் தெரியும்.'],
    listen: ['🔊 Listen', '🔊 கேளுங்கள்', '🔊 सुनिए', '🔊 Escuchar'], stop: ['🔇 Stop', '🔇 நிறுத்து', '🔇 बंद करें', '🔇 Parar'],
    noVoice: ['This device has no English voice, so the tour is captions only.', 'இந்தச் சாதனத்தில் தமிழ்க் குரல் இல்லை, அதனால் எழுத்துகள் மட்டும் காட்டப்படும். (Windows/Android அமைப்புகளில் தமிழ்க் குரலைச் சேர்க்கலாம்.)',
      'इस डिवाइस पर हिन्दी आवाज़ नहीं है, इसलिए केवल लिखा हुआ दिखेगा। (Windows/Android सेटिंग में हिन्दी आवाज़ जोड़ी जा सकती है।)', 'Este dispositivo no tiene voz en español, así que el recorrido solo muestra el texto.'],
    langLabel: ['Language', 'மொழி', 'भाषा', 'Idioma'], prev: ['Previous', 'முந்தையது'], jump: ['Jump to a tool', 'ஒரு கருவிக்குச் செல்'], tourLabel: ['Guided tour', 'வழிகாட்டும் சுற்றுலா'],
  };
  const INTRO = [
    ['#intro .hl', 'The whole sky, photographed every six months. Find what moves.', 'முழு வானம், ஒவ்வொரு ஆறு மாதத்துக்கும் ஒரு படம். நகர்வதைக் கண்டுபிடியுங்கள்.'],
    ['#intro .lede', 'Pick any spot on the sky. Agents fetch the real NASA SPHEREx images of it, line them up and show you what changed.', 'வானில் எந்த இடத்தையும் தேர்ந்தெடுங்கள். ஏஜென்ட்கள் அதன் உண்மையான நாசா SPHEREx படங்களைக் கொண்டு வந்து, வரிசைப்படுத்தி, என்ன மாறியது என்று காட்டும்.'],
    ['#intro .hist', 'In 1930 Clyde Tombaugh found Pluto by flipping between two photographs taken days apart. ARCNAVE does the same with a space telescope.', '1930-ல் கிளைட் டாம்பா, சில நாள் இடைவெளியில் எடுத்த இரண்டு படங்களை மாறி மாறிப் பார்த்து புளூட்டோவைக் கண்டுபிடித்தார். ARCNAVE அதையே ஒரு விண்வெளித் தொலைநோக்கியுடன் செய்கிறது.'],
    ['#go', 'Explore the whole sky', 'முழு வானையும் ஆராயுங்கள்'],
    ['#intro .tourb', '90-second story', '90 வினாடிக் கதை'],
    ['#intro .cta [data-guide]', 'Learn every tool', 'ஒவ்வொரு கருவியையும் கற்க'],
    ['#intro .abl a', 'How it works, the data and its limits →', 'இது எப்படி வேலை செய்கிறது, தரவு, வரம்புகள் (ஆங்கிலத்தில்) →'],
    ['#intro .exs > small', 'Or open a real example, ready in seconds', 'அல்லது ஒரு உண்மையான உதாரணத்தைத் திறங்கள், சில வினாடிகளில் தயார்'],
    ['#intro .ex.play b', 'Play: find the asteroid', 'விளையாடு: சிறுகோளைக் கண்டுபிடி'],
    ['#intro .ex.play span', 'Flip through real SPHEREx images like Tombaugh did. One dot is moving. Can you spot it?', 'டாம்பா செய்தது போல உண்மையான SPHEREx படங்களைப் புரட்டுங்கள். ஒரு புள்ளி நகர்கிறது. உங்களால் கண்டுபிடிக்க முடியுமா?'],
    ['#intro [data-ex=proof] b', 'Catch a real asteroid', 'ஒரு உண்மையான சிறுகோளைப் பிடியுங்கள்'],
    ['#intro [data-ex=proof] span', '3865 Lindbloom, caught moving in real SPHEREx images and checked against its known orbit', '3865 லிண்ட்ப்ளூம்: உண்மையான SPHEREx படங்களில் நகரும்போது பிடிபட்டு, அதன் அறியப்பட்ட சுற்றுப்பாதையுடன் சரிபார்க்கப்பட்டது'],
    ['#intro [data-ex=false] b', 'See a false alarm caught', 'ஒரு பொய் எச்சரிக்கை பிடிபடுவதைப் பாருங்கள்'],
    ['#intro [data-ex=false] span', 'One image per epoch shows a 922σ "change". It is a hot pixel', 'ஒரு சுற்றுக்கு ஒரு படம் மட்டும் பார்த்தால் 922σ "மாற்றம்" தெரிகிறது. அது ஒரு கெட்ட பிக்சல் (hot pixel) மட்டுமே'],
    ['#intro .rlab span:nth-child(2)', '102 colours of infrared, one tick each', '102 அகச்சிவப்பு நிறங்கள், ஒவ்வொன்றும் ஒரு கோடு'],
    ['#intro .look', 'Behind this: the whole sky in near-infrared light (2MASS survey), the Milky Way across the middle.', 'இதன் பின்னால்: அருகிய-அகச்சிவப்பு ஒளியில் முழு வானம் (2MASS ஆய்வு), நடுவில் பால்வெளி.'],
    ['#tmenu [data-tour] b', '90-second story', '90 வினாடிக் கதை'],
  ];
  function setLang(l) {
    lang = IDS.includes(l) ? l : 'en';
    try { localStorage.setItem('arcnave.lang', lang); } catch { /* not kept */ }
    for (const [sel, en, ta] of INTRO) document.querySelectorAll(sel).forEach(el => { el.textContent = tr([en, ta]); });
    const intro = $('intro'); if (intro) intro.lang = lang;
    document.querySelectorAll('select[data-lang]').forEach(fillLangs);
    if (root) { root.lang = lang; uiText(); if (ix >= 0) { relabel(); show(ix); } }
  }
  function fillLangs(sel) {   // the language picker: each language named in itself
    if (sel.options.length !== I18N.langs.length) sel.replaceChildren(...I18N.langs.map(l => { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; o.lang = l.id; return o; }));
    sel.value = lang; sel.setAttribute('aria-label', tr(UI.langLabel) + (lang === 'en' ? '' : ' / Language')); sel.onchange = () => setLang(sel.value);
  }
  function uiText() {
    root.setAttribute('aria-label', tr(UI.tourLabel));
    root.querySelector('.tg dt:nth-of-type(1)').textContent = tr(UI.what); root.querySelector('.tg dt:nth-of-type(2)').textContent = tr(UI.how);
    root.querySelector('[data-a=back]').setAttribute('aria-label', tr(UI.prev)); root.querySelector('.tjump').setAttribute('aria-label', tr(UI.jump));
    root.querySelector('[data-a=pause]').textContent = tr(paused ? UI.play : UI.pause);
    root.querySelector('.tskip').textContent = tr(kind === 'guide' ? UI.close : UI.skip);
    fillLangs(root.querySelector('select[data-lang]'));
    const vb = root.querySelector('[data-a=voice]'); vb.hidden = !('speechSynthesis' in window) && typeof Audio === 'undefined'; vb.textContent = tr(SPEECH.on ? UI.stop : UI.listen); vb.setAttribute('aria-pressed', SPEECH.on);
  }

  /* ---------- Listen (v0.20, v0.24): each caption read aloud in the chosen language ---------- */
  // v0.24: recorded narration first. public/audio/<lang>/<key>.mp3, one file per caption, key = hash of the exact caption text
  // (tools/make-voices.py records them; public/audio/index.json lists what exists). So Tamil, Hindi and Spanish speak on
  // every phone and computer, even with no voice installed. A caption with no recording (different live numbers) falls back
  // to the device's own voice (Web Speech API); with no voice either, the tour says so and stays in captions.
  const SPEECH = { on: false, busy: false, target: -1 };
  const AUD = { idx: null, p: null, el: null };
  const keyOf = t => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const audioIdx = () => AUD.p || (AUD.p = fetch('audio/index.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(j => (AUD.idx = j || {})));
  const voiceFor = l => { if (!('speechSynthesis' in window)) return null; const vs = speechSynthesis.getVoices(), m = v => v.lang.toLowerCase().replace('_', '-').startsWith(l);
    return vs.find(v => m(v) && /natural|online|google|neural/i.test(v.name)) || vs.find(m) || null; };
  try { if ('speechSynthesis' in window) speechSynthesis.getVoices(); } catch { /* ignore */ }   // Chrome loads voices on first ask
  const hush = () => { try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch { /* ignore */ } if (AUD.el) { AUD.el.onended = AUD.el.onerror = null; AUD.el.pause(); } };
  function speak(text, my) {
    hush(); SPEECH.busy = false; SPEECH.target = -1;
    if (!SPEECH.on || !text) return;
    const note = root.querySelector('.tnote');
    if (!AUD.idx) { SPEECH.busy = true; SPEECH.target = my; audioIdx().then(() => { if (SPEECH.target === my && SPEECH.on) speak(text, my); }); return; }
    const k = keyOf(text), rec = (AUD.idx[lang] || []).includes(k);
    if (rec) {   // the recorded narration
      const a = AUD.el || (AUD.el = new Audio()); SPEECH.busy = true; SPEECH.target = my; SPEECH.src = 'file';
      const url = `audio/${lang}/${k}.mp3`, mine = () => SPEECH.target === my && a.dataset.k === url;   // a newer speak() owns the player now
      const done = () => { if (mine()) SPEECH.busy = false; };
      a.onended = done; a.onerror = () => { a.onerror = null; if (mine()) device(text, my, note); };
      a.dataset.k = url; a.src = url; a.playbackRate = 1;
      const pr = a.play(); if (pr && pr.catch) pr.catch(e => { if (e && e.name === 'AbortError') return; if (mine()) device(text, my, note); });
      return;
    }
    device(text, my, note);
  }
  function device(text, my, note) {   // the device's own voice (Web Speech API)
    SPEECH.busy = false;
    const v = voiceFor(lang);
    if (!v) { note.hidden = false; note.className = 'tnote'; note.textContent = tr(UI.noVoice); return; }
    const parts = text.match(/[^.!?।]+[.!?।]*/g) || [text];   // sentence by sentence: Chrome drops very long utterances
    SPEECH.busy = true; SPEECH.target = my; SPEECH.src = 'device';
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p.trim()); u.voice = v; u.lang = v.lang; u.rate = lang === 'en' ? 1 : 0.95;
      if (i === parts.length - 1) u.onend = u.onerror = () => { if (SPEECH.target === my) SPEECH.busy = false; };
      speechSynthesis.speak(u);
    });
  }
  function toggleVoice() {
    SPEECH.on = !SPEECH.on; uiText();
    if (!SPEECH.on) { speak('', -1); return; }
    if (ix >= 0) speakNow();
  }
  const spokenOf = c => `${tr(c.t)}. ${kind === 'guide' || c.what ? `${tr(c.what)} ${tr(c.how)}` : tr(typeof c.x === 'function' ? c.x() : c.x)}`;
  function speakNow() { const c = CH[ix]; if (c) speak(spokenOf(c), token); }
  function relabel() { root.querySelectorAll('.tjump option').forEach((o, i) => { o.textContent = `${i + 1}. ${tr(CH[i].t)}`; }); }

  /* ---------- Story: 90 seconds, from Neptune to your own blink ---------- */
  // Three illustrations (labelled as such) and the rest on the live app: the real example loads from chapter 1 on.
  const STORY = [
    { yr: '1846', t: ['A planet found with a pen', 'பேனாவால் கண்டுபிடித்த கோள்'], ms: 11000, pic: 'orbits',
      x: ['Uranus kept drifting off its predicted path. In 1846 Urbain Le Verrier worked out, on paper, where an unseen planet pulling it had to be. Johann Galle pointed a telescope there and found Neptune, less than one degree from the spot. Astronomers have asked ever since: is there another one?',
        'யுரேனஸ் கோள் கணித்த பாதையிலிருந்து விலகிக்கொண்டே இருந்தது. அதை இழுக்கும் கண்ணுக்குத் தெரியாத ஒரு கோள் எங்கே இருக்க வேண்டும் என்று 1846-ல் உர்பென் லு வெரியே காகிதத்திலேயே கணக்குப் போட்டார். யோஹான் காலே தொலைநோக்கியை அங்கே திருப்பினார்; குறித்த இடத்திலிருந்து ஒரு டிகிரிக்குள் நெப்டியூன் இருந்தது. அன்றிலிருந்து வானியலாளர்கள் கேட்கிறார்கள்: இன்னொன்று இருக்குமா?'],
      go() { example(); } },   // start the real example now, so it is ready by chapter 5
    { yr: '1930', t: ['One dot jumped', 'ஒரு புள்ளி மட்டும் தாவியது'], ms: 11000, pic: 'plates',
      x: ['Percival Lowell named the missing world "Planet X". At his observatory in January 1930, Clyde Tombaugh, 24, photographed the same stars six days apart and flipped between the two plates in a blink comparator. Stars stayed still. One faint dot jumped. It was Pluto.',
        'காணாமல் போன அந்த உலகத்துக்கு பெர்சிவல் லோவெல் "பிளானெட் X" என்று பெயர் வைத்தார். 1930 ஜனவரியில் அவருடைய ஆய்வகத்தில், 24 வயது கிளைட் டாம்பா ஒரே நட்சத்திரங்களை ஆறு நாள் இடைவெளியில் இரண்டு முறை படம் எடுத்து, "பிளிங்க்" கருவியில் அந்த இரண்டு படத்தகடுகளையும் மாறி மாறிப் பார்த்தார். நட்சத்திரங்கள் அசையவில்லை. ஒரே ஒரு மங்கலான புள்ளி தாவியது. அதுதான் புளூட்டோ.'] },
    { yr: '2016', t: ['A ninth planet?', 'ஒன்பதாவது கோளா?'], ms: 11000, pic: 'herd',
      x: ['In 2016 Konstantin Batygin and Mike Brown noticed that some of the most distant icy worlds beyond Neptune swing out in the same direction, as if something big were herding them. They proposed "Planet Nine", several times heavier than Earth. Nobody has seen it. It is still a hypothesis.',
        '2016-ல் கான்ஸ்டன்டின் பாட்டிஜின், மைக் பிரவுன் இருவரும் ஒன்றைக் கவனித்தனர்: நெப்டியூனுக்கு அப்பால் உள்ள மிகத் தொலைவான பனி உலகங்கள் சில, ஏதோ ஒரு பெரிய பொருள் மேய்ப்பது போல ஒரே திசையில் சுற்றிச் செல்கின்றன. பூமியை விடப் பல மடங்கு கனமான "பிளானெட் நைன்" இருக்கலாம் என்று முன்மொழிந்தனர். இதுவரை யாரும் அதைப் பார்க்கவில்லை. அது இன்னும் ஒரு கருதுகோள் மட்டுமே.'] },
    { yr: '2025', t: ['Now a telescope does the whole sky', 'இப்போது ஒரு தொலைநோக்கி முழு வானையும் படம் பிடிக்கிறது'], ms: 9000, at: () => q('.brand'),
      x: ['NASA\'s SPHEREx, launched in March 2025, maps the entire sky every six months in 102 colours of infrared light, one tick each on this ruler. Its archive is open to everyone, and that is what you are about to use.',
        'நாசாவின் SPHEREx மார்ச் 2025-ல் ஏவப்பட்டது. ஒவ்வொரு ஆறு மாதத்துக்கும் முழு வானையும் 102 அகச்சிவப்பு (infrared) நிறங்களில் படம் பிடிக்கிறது; இந்த அளவுகோலில் ஒவ்வொரு கோடும் ஒரு நிறம். அதன் தரவுக் களஞ்சியம் எல்லோருக்கும் திறந்திருக்கிறது. நீங்கள் இப்போது பயன்படுத்தப் போவது அதைத்தான்.'] },
    { yr: 'Live', t: ['Five agents fetch real images', 'ஐந்து ஏஜென்ட்கள் உண்மையான படங்களைக் கொண்டு வருகின்றன'], ms: 8000, wait: true, at: () => $('agents'),
      x: () => S.report ? [`Done. They found ${S.images.length} SPHEREx images of this patch of sky in NASA's archive, downloaded the ${S.eps.length * S.slots.length} best colour-matched ones from ${S.eps.length} sky passes, lined them up on the stars and compared them.`,
          `முடிந்தது. இந்த வானப் பகுதியின் ${S.images.length} SPHEREx படங்களை நாசாவின் களஞ்சியத்தில் கண்டுபிடித்து, ${S.eps.length} வானச் சுற்றுகளிலிருந்து நிறத்தில் பொருந்தும் சிறந்த ${S.eps.length * S.slots.length} படங்களைப் பதிவிறக்கி, நட்சத்திரங்களை வைத்து வரிசைப்படுத்தி, ஒப்பிட்டன.`,
          `हो गया। उन्होंने NASA के संग्रह में आकाश के इस हिस्से की ${S.images.length} SPHEREx तस्वीरें ढूँढीं, ${S.eps.length} आकाश चक्करों से रंग में मेल खाती ${S.eps.length * S.slots.length} सबसे अच्छी तस्वीरें डाउनलोड कीं, उन्हें तारों के सहारे मिलाया और तुलना की।`,
          `Listo. Encontraron ${S.images.length} imágenes de SPHEREx de esta zona del cielo en el archivo de la NASA, descargaron las ${S.eps.length * S.slots.length} mejores con el mismo color de ${S.eps.length} pasadas por el cielo, las alinearon con las estrellas y las compararon.`]
        : ['Right now they are pulling real SPHEREx images of one patch of sky from NASA\'s archive, lining them up on the stars and comparing them. Watch the steps tick.',
          'இப்போது அவை ஒரு வானப் பகுதியின் உண்மையான SPHEREx படங்களை நாசாவின் களஞ்சியத்திலிருந்து எடுத்து, நட்சத்திரங்களை வைத்து வரிசைப்படுத்தி, ஒப்பிடுகின்றன. ஒவ்வொரு படியும் முடிவதைப் பாருங்கள்.',
          'अभी वे NASA के संग्रह से आकाश के एक हिस्से की असली SPHEREx तस्वीरें ला रहे हैं, उन्हें तारों के सहारे मिला रहे हैं और तुलना कर रहे हैं। हर कदम पूरा होते देखिए।',
          'Ahora mismo están trayendo del archivo de la NASA imágenes reales de SPHEREx de una zona del cielo, alineándolas con las estrellas y comparándolas. Mira cómo se completa cada paso.'],
      go() { sheet('agents'); $('agents').open = true; } },
    { yr: 'Blink', t: ['Your turn to be Tombaugh', 'இப்போது நீங்கள்தான் டாம்பா'], ms: 12000, circle: true,
      x: () => { const a = astro(); return a ? [`The images of one sky pass now flip like Tombaugh's plates. Stars stay put. Inside the ring: asteroid ${a.name}, a real one, caught moving in ${a.sightings.length} SPHEREx images, right where its known orbit says it should be.`,
          `ஒரு வானச் சுற்றின் படங்கள் இப்போது டாம்பாவின் படத்தகடுகள் போல மாறி மாறித் தெரிகின்றன. நட்சத்திரங்கள் அசையாமல் இருக்கின்றன. வட்டத்துக்குள்: ${a.name} என்ற உண்மையான சிறுகோள் (asteroid). SPHEREx அதை ${a.sightings.length} படங்களில் நகரும்போது பிடித்தது, அதன் அறியப்பட்ட சுற்றுப்பாதை சொல்லும் இடத்திலேயே.`,
          `एक आकाश चक्कर की तस्वीरें अब टॉमबॉ की प्लेटों की तरह बदल रही हैं। तारे अपनी जगह रहते हैं। घेरे के अंदर: क्षुद्रग्रह ${a.name}, एक असली क्षुद्रग्रह, जिसे SPHEREx ने ${a.sightings.length} तस्वीरों में चलते हुए पकड़ा, ठीक वहीं जहाँ उसकी ज्ञात कक्षा कहती है।`,
          `Las imágenes de una pasada se alternan ahora como las placas de Tombaugh. Las estrellas se quedan quietas. Dentro del anillo: el asteroide ${a.name}, uno real, captado en movimiento en ${a.sightings.length} imágenes de SPHEREx, justo donde dice su órbita conocida.`]
        : ['The images now flip like Tombaugh\'s plates. Stars stay put; anything that jumps is moving.', 'படங்கள் இப்போது டாம்பாவின் படத்தகடுகள் போல மாறி மாறித் தெரிகின்றன. நட்சத்திரங்கள் அசையாது; தாவுவது எதுவோ அது நகர்கிறது.',
          'तस्वीरें अब टॉमबॉ की प्लेटों की तरह बदल रही हैं। तारे अपनी जगह रहते हैं; जो उछले, वह चल रहा है।', 'Las imágenes ahora se alternan como las placas de Tombaugh. Las estrellas se quedan quietas; lo que salta se está moviendo.']; },
      go() { blinkOnAsteroid(); sheet('none'); } },
    { yr: 'Play', t: ['Now find one yourself', 'இப்போது நீங்களே ஒன்றைக் கண்டுபிடியுங்கள்'], ms: 9000, at: () => $('playb'),
      x: ['No ring, no help: in Find the asteroid you flip through the same real images and tap the dot that moves. It takes about a minute, and you can send your result to a friend as a challenge.',
        'வட்டமும் இல்லை, உதவியும் இல்லை: "Find the asteroid" விளையாட்டில் இதே உண்மையான படங்களைப் புரட்டி, நகரும் புள்ளியைத் தொட்டால் போதும். ஒரு நிமிடம் ஆகும். உங்கள் முடிவை நண்பருக்குச் சவாலாக அனுப்பலாம்.'],
      go() { const b = $('playb'); if (b) b.scrollIntoView({ inline: 'center', block: 'nearest' }); } },
    { yr: '?', t: ['Hide your own Planet X', 'உங்கள் சொந்த பிளானெட் X-ஐ ஒளித்து வையுங்கள்'], ms: 11000, at: () => $('pxp').hidden ? q('[data-m=px]') : $('pxp'),
      x: ['Planet X is a hypothesis: no one has seen it, and ARCNAVE does not claim to. So we turn the question around. You hide a fake planet in these real images, the agents hunt for it, and you learn how faint and far a planet could be and still be caught.',
        'பிளானெட் X ஒரு கருதுகோள் மட்டுமே: யாரும் அதைப் பார்த்ததில்லை, ARCNAVE-ம் பார்த்ததாகச் சொல்லவில்லை. அதனால் கேள்வியைத் திருப்பிக் கேட்கிறோம்: இந்த உண்மையான படங்களில் நீங்கள் ஒரு போலிக் கோளை ஒளித்து வைக்கிறீர்கள், ஏஜென்ட்கள் அதைத் தேடுகின்றன. ஒரு கோள் எவ்வளவு மங்கலாக, எவ்வளவு தொலைவில் இருந்தாலும் பிடிபடும் என்று இதிலிருந்து தெரிந்துகொள்ளலாம்.'],
      go() { setMode('px'); sheet('panel'); } },
    { yr: '18', t: ['Tested on 18 fields, misses included', '18 பகுதிகளில் சோதனை, தோல்விகளும் சேர்த்து'], ms: 12000, at: () => $('scv'),
      x: () => { const s = scs && scs.summary; if (!s) return ['We ran the same test across a grid of sky fields chosen before the run, and we publish every field, including where it fails.', 'சோதனைக்கு முன்பே தேர்ந்தெடுத்த வானப் பகுதிகளில் ஒரே சோதனையை நடத்தினோம்; தோல்வியடைந்த இடங்கள் உட்பட ஒவ்வொரு பகுதியையும் வெளியிடுகிறோம்.',
          'हमने वही परीक्षण पहले से चुने गए आकाश क्षेत्रों पर चलाया, और हर क्षेत्र प्रकाशित करते हैं, जहाँ यह विफल हुआ वह भी।', 'Hicimos la misma prueba en una cuadrícula de campos del cielo elegidos antes de empezar, y publicamos todos los campos, también donde falla.'];
        return [`We hid ${s.fakes.toLocaleString('en-US')} fake planets across ${s.fields} fields picked before the run. A planet 1000 AU away was caught in ${s.at1000.found} of ${s.at1000.of} fields, down to magnitude ${s.at1000.median.toFixed(1)} on a typical field. At 300 AU only in ${s.at300.found} of ${s.at300.of}, and we show you those misses too.`,
          `சோதனைக்கு முன்பே தேர்ந்தெடுத்த ${s.fields} வானப் பகுதிகளில் ${s.fakes.toLocaleString('en-US')} போலிக் கோள்களை ஒளித்து வைத்தோம். 1000 AU தொலைவில் உள்ள கோள் ${s.at1000.of} பகுதிகளில் ${s.at1000.found}-ல் பிடிபட்டது; வழக்கமான பகுதியில் magnitude ${s.at1000.median.toFixed(1)} வரை. 300 AU-ல் ${s.at300.of}-ல் ${s.at300.found} பகுதிகளில் மட்டுமே; அந்தத் தோல்விகளையும் உங்களுக்குக் காட்டுகிறோம்.`,
          `हमने पहले से चुने गए ${s.fields} क्षेत्रों में ${s.fakes.toLocaleString('en-US')} नकली ग्रह छिपाए। 1000 AU दूर का ग्रह ${s.at1000.of} में से ${s.at1000.found} क्षेत्रों में पकड़ा गया, एक सामान्य क्षेत्र में मैग्निट्यूड ${s.at1000.median.toFixed(1)} तक। 300 AU पर केवल ${s.at300.of} में से ${s.at300.found} में, और हम वे चूकें भी दिखाते हैं।`,
          `Escondimos ${s.fakes.toLocaleString('en-US')} planetas falsos en ${s.fields} campos elegidos antes de empezar. Un planeta a 1000 UA se detectó en ${s.at1000.found} de ${s.at1000.of} campos, hasta magnitud ${s.at1000.median.toFixed(1)} en un campo típico. A 300 UA solo en ${s.at300.found} de ${s.at300.of}, y también te mostramos esos fallos.`]; },
      async go() {
        for (let k = 0; k < 3 && !(scs && scs.summary); k++) { scs = await loadScorecard(); if (!scs.summary) await sleep(800); }
        drawer(true, 'tdrawer');   // phone: the caption sits on top, so bring the table up under it
        setTimeout(() => { const t = phone() && $('scv').querySelector('.sct'); (t || $('scv')).scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: t ? 'end' : 'start' }); }, 350);
      } },
    { yr: 'You', t: ['The sky is yours now', 'வானம் இப்போது உங்களுடையது'], ms: 0, end: true,
      x: ['Type any place in the sky and the agents start. Look for what jumps. If you find something, check it against the known-object rings before you believe it: that is how real astronomers work too.',
        'வானில் எந்த இடத்தின் பெயரையும் தட்டச்சு செய்யுங்கள், ஏஜென்ட்கள் தொடங்கும். எது தாவுகிறது என்று பாருங்கள். ஏதாவது கண்டால், நம்புவதற்கு முன் அறியப்பட்ட பொருட்களின் வட்டங்களுடன் சரிபாருங்கள்: உண்மையான வானியலாளர்களும் அப்படித்தான் வேலை செய்கிறார்கள்.'],
      go() { drawer(false); sheet('panel'); } }
  ];
  function blinkOnAsteroid() {
    setMode('blink'); const a = astro();
    if (!a) return;
    S.al.gotoRaDec(a.sightings[0].ra, a.sightings[0].dec); S.al.setFov(0.3);
    const t = $('tm'), e = a.sightings[0].e;   // flip the pass the asteroid was caught in, not the first one
    if (Number.isInteger(e) && +t.max >= e) { t.value = e; t.dispatchEvent(new Event('input')); }
  }

  /* ---------- Guide: every tool, what it is and how to use it ---------- */
  const tab = m => q(`[data-m=${m}]`);
  const G = (yr, t, what, how, at, go, extra = {}) => ({ yr, t, what, how, at, go, ...extra });
  const GUIDE = [
    G('Guide', ['Every tool, one by one', 'ஒவ்வொரு கருவியாக'],
      ['This guide lights up each tool in ARCNAVE and says what it is for and how to use it. A real example (asteroid 3865 Lindbloom in real SPHEREx images) loads behind it, so every tool shows real data.',
        'இந்த வழிகாட்டி ARCNAVE-இன் ஒவ்வொரு கருவியையும் ஒளிரச் செய்து, அது எதற்கு, எப்படிப் பயன்படுத்துவது என்று சொல்கிறது. பின்னணியில் ஒரு உண்மையான உதாரணம் (உண்மையான SPHEREx படங்களில் 3865 லிண்ட்ப்ளூம் சிறுகோள்) ஏறுகிறது, அதனால் ஒவ்வொரு கருவியும் உண்மையான தரவைக் காட்டும்.'],
      ['Press Next or the → key. Jump straight to any tool with the menu above. Esc closes the guide.', 'Next அல்லது → விசையை அழுத்துங்கள். மேலே உள்ள பட்டியலில் எந்தக் கருவிக்கும் நேரடியாகச் செல்லலாம். Esc அழுத்தினால் வழிகாட்டி மூடும்.'], null, () => { example(); }),
    G('Sky', ['Whole sky', 'முழு வானம்'],
      ['Zooms out to the entire sky in one oval: the 2MASS near-infrared survey, light SPHEREx also sees (1.2 to 2.2 µm), with the Milky Way across the middle. White dots are famous places, the orange ring is the asteroid example, cyan squares are our 18 test fields.',
        'முழு வானையும் ஒரு நீள்வட்டத்தில் காட்டுகிறது: 2MASS அருகிய-அகச்சிவப்பு ஆய்வு (SPHEREx-ம் பார்க்கும் 1.2–2.2 µm ஒளி), நடுவில் பால்வெளி. வெள்ளைப் புள்ளிகள் புகழ்பெற்ற இடங்கள், ஆரஞ்சு வட்டம் சிறுகோள் உதாரணம், சியான் நிறச் சதுரங்கள் எங்கள் 18 சோதனைப் பகுதிகள்.'],
      ['Press Whole sky. Drag to turn the sky, scroll or pinch to zoom, click a marker to dive in and start the agents there.', 'Whole sky அழுத்துங்கள். வானைத் திருப்ப இழுங்கள், பெரிதாக்க ஸ்க்ரோல் அல்லது பிஞ்ச் செய்யுங்கள், ஒரு குறியைத் தட்டினால் அங்கே சென்று ஏஜென்ட்கள் தொடங்கும்.'],
      () => $('wsky'), () => { $('wsky').scrollIntoView({ inline: 'center', block: 'nearest' }); wholeSky(true); }),   // show it, not just the button
    G('Sky', ['Fly to', 'Fly to (பறந்து செல்)'],
      ['Takes you to any place in the sky and starts the agents there.', 'வானில் எந்த இடத்துக்கும் அழைத்துச் சென்று அங்கே ஏஜென்ட்களைத் தொடங்குகிறது.'],
      ['Type a name such as M42, Andromeda or Pleiades, or a position as RA and Dec in degrees, like 190 -4. Press Enter or Fly to.', 'M42, Andromeda, Pleiades போன்ற ஒரு பெயரை, அல்லது RA, Dec இடத்தை டிகிரியில் (உதா. 190 -4) தட்டச்சு செய்யுங்கள். Enter அல்லது Fly to அழுத்துங்கள்.'], () => $('sf')),
    G('Sky', ['Base sky', 'பின்னணி வானம்'],
      ['The background picture of the sky, taken by other surveys, for context. The real SPHEREx images are drawn on top of it.', 'சூழலுக்காக மற்ற ஆய்வுகள் எடுத்த வானின் பின்னணிப் படம். உண்மையான SPHEREx படங்கள் அதன் மேல் வரையப்படுகின்றன.'],
      ['2MASS (near-infrared) is the default. Switch to AllWISE (longer infrared) or DSS2 (visible light, what your eyes would see) to compare.', '2MASS (அருகிய-அகச்சிவப்பு) இயல்பாக இருக்கும். ஒப்பிட AllWISE (நீண்ட அகச்சிவப்பு) அல்லது DSS2 (கண்ணுக்குத் தெரியும் ஒளி) தேர்ந்தெடுங்கள்.'],
      () => $('survey'), () => { $('survey').scrollIntoView({ inline: 'center', block: 'nearest' }); }),
    G('Sky', ['Ecliptic', 'கிரகணப் பாதை (Ecliptic)'],
      ['The path the Sun and the planets follow across the sky. Asteroids, comets and any far-off planet stay close to it, so it tells you where to look.', 'சூரியனும் கோள்களும் வானில் செல்லும் பாதை. சிறுகோள்கள், வால்நட்சத்திரங்கள், தொலைவான எந்தக் கோளும் இதற்கு அருகில்தான் இருக்கும்; அதனால் எங்கே தேடுவது என்று இது சொல்கிறது.'],
      ['Press it to draw the ecliptic as a dashed cyan line. Press again to hide it.', 'அழுத்தினால் கிரகணப் பாதை சியான் நிறப் புள்ளிக்கோடாக வரையப்படும். மீண்டும் அழுத்தினால் மறையும்.'],
      () => $('ecl'), () => { $('ecl').scrollIntoView({ inline: 'center', block: 'nearest' }); }),
    G('Sky', ['Examples', 'உதாரணங்கள்'],
      ['Two real cases saved with the site. They open in seconds, even when NASA\'s archive is busy.', 'தளத்துடன் சேமிக்கப்பட்ட இரண்டு உண்மையான நிகழ்வுகள். நாசாவின் களஞ்சியம் பிஸியாக இருந்தாலும் சில வினாடிகளில் திறக்கும்.'],
      ['Press it, then choose Catch a real asteroid or See a false alarm caught.', 'அழுத்தி, Catch a real asteroid அல்லது See a false alarm caught தேர்ந்தெடுங்கள்.'],
      () => $('exb'), () => { $('exb').scrollIntoView({ inline: 'center', block: 'nearest' }); }),
    G('Read', ['Readout', 'விவரப் பலகை'],
      ['Where you are and what you are looking at: the sky position (RA, Dec), the wavelength of the image, which sky pass (epoch) and how wide the view is (FoV).', 'நீங்கள் எங்கே இருக்கிறீர்கள், எதைப் பார்க்கிறீர்கள்: வான இடம் (RA, Dec), படத்தின் அலைநீளம், எந்த வானச் சுற்று (epoch), பார்வை எவ்வளவு அகலம் (FoV).'],
      ['Nothing to press: it updates as you move around.', 'அழுத்த எதுவும் இல்லை: நீங்கள் நகரும்போது தானாக மாறும்.'], () => q('.tele'), null, { deskOnly: true }),   // hidden on phones to keep the sky clear
    G('Agents', ['The five agents', 'ஐந்து ஏஜென்ட்கள்'],
      ['Small programs that do the work in order: Navigator points the sky, Archivist finds the SPHEREx images, Aligner downloads them and lines them up on the stars, Analyst compares them, Reporter writes it up. Ordinary code, not AI.',
        'வேலையை வரிசையாகச் செய்யும் சிறிய நிரல்கள்: Navigator வானைத் திருப்புகிறது, Archivist SPHEREx படங்களைக் கண்டுபிடிக்கிறது, Aligner அவற்றைப் பதிவிறக்கி நட்சத்திரங்களை வைத்து வரிசைப்படுத்துகிறது, Analyst ஒப்பிடுகிறது, Reporter எழுதுகிறது. இவை சாதாரண நிரல்கள், AI அல்ல.'],
      ['Watch each step tick. With Auto-run on, typing a place starts them; switch it off to look around without loading.', 'ஒவ்வொரு படியும் முடிவதைப் பாருங்கள். Auto-run இயக்கத்தில் இருந்தால், ஒரு இடத்தைத் தட்டச்சு செய்ததும் தொடங்கும்; படங்களை ஏற்றாமல் சுற்றிப் பார்க்க அதை அணையுங்கள்.'],
      () => $('agents'), () => { sheet('agents'); $('agents').open = true; }),
    G('Agents', ['Run agents here', 'இங்கே ஏஜென்ட்களை இயக்கு'],
      ['Loads SPHEREx images for the spot in the middle of the screen, with your settings.', 'திரையின் நடுவில் உள்ள இடத்துக்கு உங்கள் அமைப்புகளுடன் SPHEREx படங்களை ஏற்றுகிறது.'],
      ['Pan to a spot, pick the Field size (0.25° to 1° wide) and Images per epoch (8 gives deeper, cleaner pictures but loads slower), then press Run agents here.', 'ஒரு இடத்துக்கு நகர்ந்து, Field size (0.25° முதல் 1° அகலம்), Images per epoch (8 என்றால் ஆழமான, தெளிவான படங்கள், ஆனால் ஏற நேரம் ஆகும்) தேர்ந்தெடுத்து Run agents here அழுத்துங்கள்.'],
      () => q('.loadrow'), () => sheet('panel')),
    G('Compare', ['Time machine', 'கால இயந்திரம்'],
      ['Every real image of this spot, one at a time, in the order they were taken.', 'இந்த இடத்தின் ஒவ்வொரு உண்மையான படமும், எடுத்த வரிசையில், ஒன்றன்பின் ஒன்றாக.'],
      ['Drag the Image slider, or click a thumbnail in the strip. E1, E2, E3 are sky passes about six months apart.', 'Image ஸ்லைடரை இழுங்கள், அல்லது கீழே உள்ள சிறுபடத்தைத் தட்டுங்கள். E1, E2, E3 என்பவை சுமார் ஆறு மாத இடைவெளியில் உள்ள வானச் சுற்றுகள்.'],
      () => [tab('time'), $('tmr'), $('strip')], () => { setMode('time'); sheet('panel'); }, { data: true }),
    G('Compare', ['Blink', 'பிளிங்க்'],
      ['Tombaugh\'s method: the images flip by themselves like a flip-book. Stars stay still; anything that jumps is moving.', 'டாம்பாவின் முறை: படங்கள் தானாகவே ஒரு புரட்டும் புத்தகம் போல மாறுகின்றன. நட்சத்திரங்கள் அசையாது; தாவுவது எதுவோ அது நகர்கிறது.'],
      ['Just watch the sky. The slider picks which sky pass to flip through, or all of them.', 'வானைப் பாருங்கள் போதும். எந்த வானச் சுற்றைப் புரட்டுவது, அல்லது எல்லாவற்றையும், என்று ஸ்லைடர் தேர்ந்தெடுக்கும்.'],
      () => [tab('blink'), $('tmr')], () => { setMode('blink'); sheet('panel'); }, { data: true }),
    G('Compare', ['Swipe', 'ஸ்வைப்'],
      ['Two sky passes on top of each other with a dividing line: the earlier one on the left, the later one on the right.', 'இரண்டு வானச் சுற்றுகள் ஒன்றின் மேல் ஒன்று, நடுவில் ஒரு பிரிகோடு: இடப்பக்கம் முந்தையது, வலப்பக்கம் பிந்தையது.'],
      ['Drag the Swipe slider across and look for anything that is on one side but not the other.', 'Swipe ஸ்லைடரை இழுத்து, ஒரு பக்கத்தில் இருந்து மறுபக்கத்தில் இல்லாததைத் தேடுங்கள்.'],
      () => [tab('swipe'), $('swr')], () => { setMode('swipe'); sheet('panel'); }, { data: true }),
    G('Compare', ['Difference', 'வித்தியாசம்'],
      ['The earlier pass subtracted from the later one. Stars cancel out. A moving object leaves an orange spot (where it is now) next to a cyan spot (where it was).', 'பிந்தைய சுற்றிலிருந்து முந்தைய சுற்று கழிக்கப்படுகிறது. நட்சத்திரங்கள் மறைந்துவிடும். நகரும் பொருள் ஒரு ஆரஞ்சுப் புள்ளியையும் (இப்போது இருக்கும் இடம்) அருகில் ஒரு சியான் புள்ளியையும் (முன்பு இருந்த இடம்) விட்டுச் செல்லும்.'],
      ['Look for orange-and-cyan pairs on the sky. Leftover speckle is just noise.', 'வானில் ஆரஞ்சு-சியான் ஜோடிகளைத் தேடுங்கள். மீதமுள்ள சிறு புள்ளிகள் வெறும் இரைச்சல் (noise).'],
      () => [tab('diff'), $('help')], () => { setMode('diff'); sheet('panel'); }, { data: true }),
    G('Compare', ['Changes', 'மாற்றங்கள்'],
      ['Every change the agents found, explained: a known asteroid passing by, a star that got brighter, or something not explained yet. Detector glitches are counted but hidden. By epoch and By image show the same changes as colour maps.', 'ஏஜென்ட்கள் கண்ட ஒவ்வொரு மாற்றமும் விளக்கத்துடன்: கடந்து செல்லும் அறியப்பட்ட சிறுகோள், பிரகாசமான நட்சத்திரம், அல்லது இன்னும் விளக்க முடியாதது. கருவிப் பிழைகள் (glitches) எண்ணப்படும், ஆனால் காட்டப்படாது. By epoch, By image இதே மாற்றங்களை நிற வரைபடமாகக் காட்டும்.'],
      ['Tap a kind to step through its spots; each card flips between that image and the usual sky there. Or choose By epoch or By image and click a bar on the timeline.', 'ஒரு வகையைத் தட்டி அதன் இடங்களை ஒவ்வொன்றாகப் பாருங்கள்; ஒவ்வொரு அட்டையிலும் அந்தப் படமும் அங்குள்ள வழக்கமான வானமும் மாறி மாறித் தெரியும். அல்லது By epoch / By image தேர்ந்தெடுத்து காலவரிசையில் ஒரு பட்டையைத் தட்டுங்கள்.'],
      () => [tab('change'), $('chg')], () => { setMode('change'); sheet('panel'); }, { data: true }),
    G('Test', ['Hide Planet X', 'பிளானெட் X-ஐ ஒளித்து வை'],
      ['A test, not a search: you hide a fake planet in these real images and the agents try to find it. Planet X itself is only a hypothesis, and ARCNAVE does not search for it.', 'இது ஒரு சோதனை, தேடல் அல்ல: இந்த உண்மையான படங்களில் நீங்கள் ஒரு போலிக் கோளை ஒளித்து வைக்கிறீர்கள், ஏஜென்ட்கள் அதைக் கண்டுபிடிக்க முயல்கின்றன. பிளானெட் X ஒரு கருதுகோள் மட்டுமே; ARCNAVE அதைத் தேடுவதில்லை.'],
      ['Set Distance and Brightness, then press Hide it, agents seek. Map this field tries 1,120 fake planets and draws which ones can be caught.', 'Distance, Brightness அமைத்து Hide it, agents seek அழுத்துங்கள். Map this field 1,120 போலிக் கோள்களை முயன்று, எவை பிடிபடும் என்று வரைகிறது.'],
      () => $('pxp'), () => { setMode('px'); sheet('panel'); }, { data: true }),
    G('Learn', ['Motion lab', 'இயக்க ஆய்வகம்'],
      ['A simulation, not data: the path a distant planet would trace on the sky over the years. A yearly wobble from Earth\'s own orbit, plus a slow drift.', 'இது தரவு அல்ல, ஒரு உருவகப்படுத்துதல் (simulation): தொலைவான ஒரு கோள் பல ஆண்டுகளில் வானில் வரையும் பாதை. பூமியின் சொந்தச் சுற்றால் ஆண்டுதோறும் ஒரு ஆட்டம், அதோடு மெதுவான ஒரு நகர்வு.'],
      ['Drag Years and Distance. The farther away the planet, the smaller its wobble.', 'Years, Distance இழுங்கள். கோள் எவ்வளவு தொலைவோ, அதன் ஆட்டம் அவ்வளவு சிறியது.'],
      () => $('lab'), () => { setMode('lab'); sheet('none'); }),
    G('Colour', ['Color and presets', 'நிறமும் முன்னமைவுகளும்'],
      ['SPHEREx photographs the sky in 102 colours of infrared light. This picks which colour you see, shown in false colour.', 'SPHEREx வானை 102 அகச்சிவப்பு நிறங்களில் படம் பிடிக்கிறது. நீங்கள் எந்த நிறத்தைப் பார்க்கிறீர்கள் என்பதை இது தேர்ந்தெடுக்கிறது (போலி நிறத்தில் காட்டப்படும்).'],
      ['Drag the Color slider and let go, or press a preset: Hot stars (1 µm), Dust & Ice (3 µm, where water ice absorbs) or Cool worlds (4.5 µm). The agents then fetch the real images taken in that colour, so it takes a few seconds.', 'Color ஸ்லைடரை இழுத்து விடுங்கள், அல்லது ஒரு முன்னமைவை அழுத்துங்கள்: Hot stars (1 µm), Dust & Ice (3 µm, நீர்ப் பனி ஒளியை உறிஞ்சும் இடம்), Cool worlds (4.5 µm). பிறகு ஏஜென்ட்கள் அந்த நிறத்தில் எடுத்த உண்மையான படங்களைக் கொண்டு வரும்; சில வினாடிகள் ஆகும்.'],
      () => [$('bandr'), q('.presets')], () => { setMode('time'); sheet('panel'); }, { data: true }),
    G('Result', ['Result card', 'முடிவு அட்டை'],
      ['The evidence for one object: a status (Confirmed known asteroid, Likely artefact or Unconfirmed), image crops from before and after, and the numbers behind it.', 'ஒரு பொருளுக்கான சான்று: ஒரு நிலை (Confirmed known asteroid, Likely artefact, Unconfirmed), முன்னும் பின்னும் எடுத்த பட வெட்டுகள், அதன் பின்னால் உள்ள எண்கள்.'],
      ['Click any ring or mark on the sky to open its card. On phones it is under Result at the bottom.', 'வானில் எந்த வட்டத்தையும் குறியையும் தட்டினால் அதன் அட்டை திறக்கும். போனில் அது கீழே Result-ல் இருக்கும்.'],
      () => $('card'), () => { setMode('change'); if (typeof focusExample === 'function') focusExample('asteroid'); sheet('card'); }, { data: true }),
    G('Share', ['Discovery card', 'கண்டுபிடிப்பு அட்டை'],
      ['Turns what you are looking at into a looping GIF you can post: the same patch of sky from each SPHEREx image, with its position, dates and infrared colour, and an honest label (known asteroid, unconfirmed change, or just a field).', 'நீங்கள் பார்ப்பதைப் பகிரக்கூடிய ஒரு சுழலும் GIF ஆக மாற்றுகிறது: ஒவ்வொரு SPHEREx படத்திலிருந்தும் அதே வானப் பகுதி, அதன் இடம், தேதிகள், அகச்சிவப்பு நிறம், ஒரு நேர்மையான குறிப்புடன் (அறியப்பட்ட சிறுகோள், உறுதிப்படுத்தாத மாற்றம், அல்லது வெறும் வானப் பகுதி).'],
      ['Pick an object (or just zoom to a spot) and press Discovery card. Then Share, Download GIF, or copy the ready-made post text with a link back to this view.', 'ஒரு பொருளைத் தேர்ந்தெடுத்து (அல்லது ஒரு இடத்தைப் பெரிதாக்கி) Discovery card அழுத்துங்கள். பிறகு Share, Download GIF, அல்லது இந்தக் காட்சிக்கான இணைப்புடன் தயாரான பதிவு உரையை நகலெடுங்கள்.'],
      () => $('dcard'), () => { setMode('blink'); sheet('panel'); }, { data: true }),
    G('Play', ['Find the asteroid', 'சிறுகோளைக் கண்டுபிடி'],
      ['A one-minute game on real SPHEREx images: the same patch of sky flips by, and one dot is a real asteroid. Easy level takes the stars away; Real level shows the images as SPHEREx took them.', 'உண்மையான SPHEREx படங்களில் ஒரு நிமிட விளையாட்டு: அதே வானப் பகுதி மாறி மாறித் தெரியும், அதில் ஒரு புள்ளி உண்மையான சிறுகோள். Easy நிலையில் நட்சத்திரங்கள் நீக்கப்படும்; Real நிலையில் SPHEREx எடுத்தபடியே படங்கள் தெரியும்.'],
      ['Press Find the asteroid and tap the dot that moves. Pause and the arrows step image by image; Hint helps if you are stuck. Win, then make a discovery card to challenge a friend.', 'Find the asteroid அழுத்தி, நகரும் புள்ளியைத் தட்டுங்கள். Pause, அம்புக்குறிகள் வைத்து ஒவ்வொரு படமாகப் பாருங்கள்; மாட்டிக்கொண்டால் Hint. வென்றதும் கண்டுபிடிப்பு அட்டை செய்து நண்பருக்குச் சவால் விடுங்கள்.'],
      () => $('playb'), () => { $('playb').scrollIntoView({ inline: 'center', block: 'nearest' }); }),
    G('Share', ['Share', 'பகிர்'],
      ['Copies a link that reopens exactly this view: the place, zoom, colour and mode.', 'இதே காட்சியை (இடம், பெரிதாக்கம், நிறம், முறை) அப்படியே மீண்டும் திறக்கும் ஒரு இணைப்பை நகலெடுக்கிறது.'],
      ['Press Share and paste the link in a message or a post.', 'Share அழுத்தி, இணைப்பை ஒரு செய்தியில் அல்லது பதிவில் ஒட்டுங்கள்.'],
      () => $('share'), () => { $('share').scrollIntoView({ inline: 'center', block: 'nearest' }); }),
    G('Learn', ['Learn', 'கற்க'],
      ['Plain-language explanations, a glossary and the full test scorecard for all 18 fields.', 'எளிய விளக்கங்கள், ஒரு சொற்களஞ்சியம், 18 பகுதிகளுக்குமான முழுச் சோதனை மதிப்பெண் அட்டவணை (ஆங்கிலத்தில்).'],
      ['Press Learn to open it. Close or Esc brings you back.', 'Learn அழுத்தித் திறங்கள். Close அல்லது Esc மூலம் திரும்பலாம்.'],
      () => $('lb'), () => { $('lb').scrollIntoView({ inline: 'center', block: 'nearest' }); }),
    G('Access', ['High contrast', 'அதிக மாறுபாடு'],
      ['Stronger outlines and brighter text, for easier reading.', 'எளிதாகப் படிக்க, தடித்த விளிம்புகளும் பிரகாசமான எழுத்துகளும்.'],
      ['Press it to switch on or off.', 'அழுத்தி இயக்கவும் அணைக்கவும்.'], () => $('hc'), () => { $('hc').scrollIntoView({ inline: 'center', block: 'nearest' }); }),
    G('You', ['You know every tool', 'எல்லாக் கருவிகளும் இப்போது உங்களுக்குத் தெரியும்'],
      ['That is all of ARCNAVE.', 'ARCNAVE முழுவதும் இவ்வளவுதான்.'],
      ['Start with the whole sky, click a landmark and blink. Or take the 90-second story.', 'முழு வானத்தில் தொடங்கி, ஒரு அடையாளத்தைத் தட்டி, பிளிங்க் செய்யுங்கள். அல்லது 90 வினாடிக் கதையைப் பாருங்கள்.'], null, () => { sheet('panel'); }, { end: true })
  ];
  // the phone bottom bar is a tool too, shown only on phones
  GUIDE.splice(GUIDE.length - 1, 0, G('Phone', ['Bottom bar', 'கீழ்ப் பட்டை'],
    ['On phones the controls, the agents and the result card share one sheet, so the sky stays visible.', 'போனில் கட்டுப்பாடுகள், ஏஜென்ட்கள், முடிவு அட்டை மூன்றும் ஒரே தாளில் இருக்கும், அதனால் வானம் தெரிந்துகொண்டே இருக்கும்.'],
    ['Tap Controls, Agents or Result to switch. Tap the open one again to fold it away. A dot on Result means a new result.', 'Controls, Agents, Result தட்டி மாற்றுங்கள். திறந்ததை மீண்டும் தட்டினால் மடியும். Result மேல் ஒரு புள்ளி என்றால் புதிய முடிவு.'], () => $('mnav'), null, { phoneOnly: true }));

  function build() {
    root = document.createElement('div'); root.id = 'tour'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Guided tour');
    root.innerHTML = `<div class="tspot"><i class="tring"></i></div><div class="tcard" aria-live="polite">
      <div class="tprog" aria-hidden="true"><i></i></div>
      <div class="thead"><span class="tyr"></span><select class="tjump" aria-label="Jump to a tool"></select><span class="tnum"></span><select class="tb tlang" data-lang></select></div>
      <h3 class="tt"></h3><div class="tpl" hidden aria-hidden="true"><canvas width="240" height="150"></canvas><span class="tpd"></span></div>
      <p class="tx"></p><dl class="tg" hidden><dt>What it is</dt><dd class="tgw"></dd><dt>How to use it</dt><dd class="tgh"></dd></dl><p class="tnote" hidden></p>
      <div class="tbtns"><button class="tb" data-a="back" aria-label="Previous">←</button><button class="tb" data-a="pause" aria-pressed="false">Pause</button>
      <button class="tb tnext hbtn" data-a="next">Next</button><button class="tb tvoice" data-a="voice" aria-pressed="false"></button><button class="tb tskip" data-a="skip">Close</button></div></div>`;
    document.body.append(root);
    spot = root.querySelector('.tspot'); card = root.querySelector('.tcard'); bar = root.querySelector('.tprog i');
    root.querySelector('[data-a=back]').onclick = () => show(ix - 1);
    root.querySelector('[data-a=next]').onclick = () => ix >= CH.length - 1 ? end() : show(ix + 1);
    root.querySelector('[data-a=skip]').onclick = end;
    root.querySelector('[data-a=pause]').onclick = e => { paused = !paused; e.target.setAttribute('aria-pressed', paused); e.target.textContent = tr(paused ? UI.play : UI.pause);
      try { if ('speechSynthesis' in window) paused ? speechSynthesis.pause() : speechSynthesis.resume(); } catch { /* ignore */ }
      if (AUD.el && SPEECH.src === 'file' && SPEECH.busy) { if (paused) AUD.el.pause(); else AUD.el.play().catch(() => {}); } };
    root.querySelector('[data-a=voice]').onclick = toggleVoice;
    root.querySelector('.tjump').onchange = e => show(+e.target.value);
    card.addEventListener('pointerenter', () => card.dataset.hover = '1'); card.addEventListener('pointerleave', () => delete card.dataset.hover);
    root.lang = lang; uiText();
  }

  // Story pictures: ILLUSTRATIONS (labelled as such), not data. 1846: Neptune where the pen said; 1930: the two plates;
  // 2016: distant orbits pointing one way, and a question mark where Planet Nine might be.
  let picI = 0, picKind = null, picK = 0;
  const PIC_LABEL = {
    orbits: [['Predicted position', 'கணித்த இடம்'], ['Neptune found here', 'நெப்டியூன் இங்கே']],
    plates: [['Plate A', 'படத்தகடு A'], ['Plate B · 6 days later', 'படத்தகடு B · 6 நாள் கழித்து']],
    herd: [['Distant orbits line up', 'தொலைவான சுற்றுப்பாதைகள் ஒரே திசையில்'], ['Planet Nine? Not seen', 'பிளானெட் நைன்? பார்க்கப்படவில்லை']],
  };
  function drawPic() {
    const c = root.querySelector('.tpl canvas'), g = c.getContext('2d'), W = c.width, H = c.height, k = picK;
    let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    if (picKind === 'plates') {
      const stars = Array.from({ length: 70 }, () => [r() * W, r() * H, 0.6 + r() * 1.6]);
      g.fillStyle = '#d9d4c7'; g.fillRect(0, 0, W, H);   // a photographic plate: the negative, dark stars on pale glass
      g.fillStyle = '#1a1712'; for (const [x, y, z] of stars) { g.beginPath(); g.arc(x, y, z, 0, 7); g.fill(); }
      const px = k ? 132 : 118, py = k ? 70 : 74; g.beginPath(); g.arc(px, py, 1.4, 0, 7); g.fill();
      g.strokeStyle = 'rgba(200,60,20,.85)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(px - 12, py); g.lineTo(px - 5, py); g.stroke();
    } else {
      g.fillStyle = '#05070f'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(220,225,240,${0.15 + r() * 0.35})`; g.fillRect(r() * W, r() * H, 1, 1); }
      const cx = picKind === 'herd' ? 70 : W / 2, cy = H / 2;
      g.fillStyle = '#ffc46b'; g.beginPath(); g.arc(cx, cy, 4, 0, 7); g.fill();   // the Sun
      if (picKind === 'orbits') {
        g.strokeStyle = 'rgba(150,170,210,.45)'; g.lineWidth = 1;
        g.beginPath(); g.ellipse(cx, cy, 46, 30, 0, 0, 7); g.stroke(); g.beginPath(); g.ellipse(cx, cy, 92, 60, 0, 0, 7); g.stroke();
        const ua = 2.2, ux = cx + 46 * Math.cos(ua), uy = cy + 30 * Math.sin(ua); g.fillStyle = '#7fd8e6'; g.beginPath(); g.arc(ux, uy, 3, 0, 7); g.fill();
        const na = 2.65, nx = cx + 92 * Math.cos(na), ny = cy + 60 * Math.sin(na);
        g.strokeStyle = 'rgba(255,107,107,.9)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(nx - 6, ny - 6 + 4); g.lineTo(nx + 6, ny + 6 + 4); g.moveTo(nx + 6, ny - 6 + 4); g.lineTo(nx - 6, ny + 6 + 4); g.stroke();   // the pen's ✕
        if (k) { g.fillStyle = '#5f8dff'; g.beginPath(); g.arc(nx + 3, ny + 2, 4, 0, 7); g.fill(); g.strokeStyle = '#5ff0a0'; g.beginPath(); g.arc(nx + 3, ny + 2, 9, 0, 7); g.stroke(); }
        g.strokeStyle = 'rgba(255,196,107,.5)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(ux, uy); g.lineTo(nx, ny + 4); g.stroke(); g.setLineDash([]);   // the pull
      } else {   // herd: elongated orbits, all swung out the same way, and a ? on the far side
        g.lineWidth = 1;
        for (let i = 0; i < 5; i++) { const a = -0.25 + i * 0.12; g.strokeStyle = `rgba(150,170,210,${0.35 + 0.1 * i})`; g.beginPath(); g.ellipse(cx + 58 * Math.cos(a), cy + 58 * Math.sin(a), 66, 18 + i * 3, a, 0, 7); g.stroke(); }
        g.strokeStyle = k ? 'rgba(255,196,107,.85)' : 'rgba(255,196,107,.35)'; g.setLineDash([4, 4]); g.beginPath(); g.ellipse(cx - 6, cy, 160, 70, Math.PI, 0, 7); g.stroke(); g.setLineDash([]);
        g.fillStyle = k ? '#ffc46b' : 'rgba(255,196,107,.5)'; g.font = '700 22px system-ui, sans-serif'; g.fillText('?', 210, 40);
      }
    }
    const lb = PIC_LABEL[picKind]; root.querySelector('.tpd').textContent = `${tr(lb[k])} · ${tr(['illustration', 'விளக்கப்படம்'])}`;
  }
  function setPic(kind) {
    clearInterval(picI); picI = 0; picKind = kind; picK = 0;
    root.querySelector('.tpl').hidden = !kind; if (!kind) return;
    drawPic(); picI = setInterval(() => { if (!root || root.querySelector('.tpl').hidden) return; picK ^= 1; drawPic(); }, picKind === 'plates' ? (reduce ? 1600 : 650) : (reduce ? 2600 : 1400));
  }

  function rectOf(c) {
    if (c.circle) {
      const a = astro(), p = a && proj(a.sightings[0].ra, a.sightings[0].dec);
      const R = phone() ? 70 : 95, x = p ? p[0] : innerWidth / 2, y = p ? p[1] : innerHeight / 2;
      return { left: x - R, top: y - R, width: 2 * R, height: 2 * R, round: true };
    }
    if (!c.at) return null;
    let els = c.at(); els = (Array.isArray(els) ? els : [els]).filter(el => el && !el.hidden && el.getClientRects().length);   // not offsetParent: it is null for every position:fixed panel
    let L = 1e9, T = 1e9, R = -1e9, B = -1e9;
    for (const el of els) { const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue; L = Math.min(L, b.left); T = Math.min(T, b.top); R = Math.max(R, b.right); B = Math.max(B, b.bottom); }
    if (R < L) return null;
    L = Math.max(L, 2); T = Math.max(T, 2); R = Math.min(R, innerWidth - 2); B = Math.min(B, innerHeight - 2);
    return { left: L - 6, top: T - 6, width: R - L + 12, height: B - T + 12 };
  }
  function place() {   // follows the target (panels move, the sky pans), but only touches the page when something changed
    raf = requestAnimationFrame(place);
    if (!root || ix < 0) return;
    const r = rectOf(CH[ix]);
    const key = r ? `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0},${r.round ? 1 : 0}` : `0,${innerWidth},${innerHeight}`;
    if (key === lastR) return; lastR = key;
    if (r) { Object.assign(spot.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: r.round ? '50%' : '12px' }); spot.classList.add('on'); }
    else { Object.assign(spot.style, { left: innerWidth / 2 + 'px', top: innerHeight / 2 + 'px', width: '0px', height: '0px' }); spot.classList.remove('on'); }   // no target: dim everything
    // keep the caption away from what it points at: beside a tall right-hand target, else above or below it
    const side = !!r && !phone() && r.left > innerWidth * 0.45 && r.height > innerHeight * 0.4;
    const upper = !!r && r.top + r.height / 2 < innerHeight * 0.5;
    const lowOnPhone = phone() && !!r && r.top < innerHeight * 0.42;   // phone: caption at the bottom when the target is up top
    card.classList.toggle('side', side); card.classList.toggle('low', !side && upper && !phone()); card.classList.toggle('plow', lowOnPhone);
  }

  async function show(i) {
    if (i < 0 || i >= CH.length) return;
    const my = ++token; ix = i; const c = CH[i], guide = kind === 'guide';
    root.querySelector('.tyr').textContent = c.yr;
    root.querySelector('.tnum').textContent = `${i + 1} / ${CH.length}`;
    root.querySelector('.tjump').value = String(i);
    root.querySelector('.tt').textContent = tr(c.t);
    if (!guide) setPic(c.pic || null); else setPic(null);
    root.querySelector('.tnote').hidden = true;
    root.querySelector('.tx').hidden = guide; root.querySelector('.tg').hidden = !guide;
    if (guide) { root.querySelector('.tgw').textContent = tr(c.what); root.querySelector('.tgh').textContent = tr(c.how); }   // not .th: that is the strip's thumbnail class
    root.querySelector('[data-a=back]').disabled = i === 0;
    root.querySelector('[data-a=next]').textContent = tr(c.end ? UI.start : UI.next);
    root.querySelector('[data-a=pause]').hidden = guide || !!c.end;
    bar.style.width = `${(i + 1) / CH.length * 100}%`;
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
    lastR = '';
    const txt = () => { if (!guide) root.querySelector('.tx').textContent = tr(typeof c.x === 'function' ? c.x() : c.x); };
    txt();
    const note = root.querySelector('.tnote');
    if ((c.data || c.wait) && runP && !S.report) {   // steps that show images wait for the example (bundled, so seconds)
      note.hidden = false; note.className = 'tnote wait'; note.textContent = tr(UI.loading);
      try { await Promise.race([runP, sleep(45000)]); } catch { /* reported below */ }
      if (my !== token) return;
      note.hidden = true;
      if (!S.report) { note.hidden = false; note.className = 'tnote'; note.textContent = tr(UI.slow); }
    }
    const far = () => { const [ra, dec] = S.al.getRaDec(); return Math.hypot((ra - S.field.ra) * Math.cos(dec * Math.PI / 180), dec - S.field.dec) > 1; };
    if ((c.data || c.circle) && S.field && (allSky() || far())) { try { await flyTo(S.field.ra, S.field.dec, Math.max(0.6, S.field.size * 2)); } catch { /* stay */ } if (my !== token) return; }   // back from the whole sky to the example field
    try { await (c.go && c.go()); } catch (e) { console.warn('tour step', e); }
    if (my !== token) return;
    txt(); lastR = '';
    if (SPEECH.on) speakNow();
    left = c.ms || 0; clearInterval(timer);
    if (guide || !c.ms) return;
    let last = performance.now();
    timer = setInterval(() => {   // story only: pauses while the reader hovers the caption, presses Pause, or switches tabs
      const now = performance.now(), dt = now - last; last = now;
      if (paused || card.dataset.hover || document.hidden) return;
      if (SPEECH.on && SPEECH.target === my) { if (SPEECH.busy) return; left = Math.min(left, 1500); }   // read aloud: next chapter 1.5 s after the reading ends
      left -= dt; if (left <= 0) { clearInterval(timer); if (my === token) show(ix + 1); }
    }, 100);
  }

  function start(which = 'story') {
    if (Tour.on) end();
    Tour.on = true; paused = false; kind = which;
    document.body.classList.remove('clearv'); { const cb = document.getElementById('clearv'); if (cb) cb.setAttribute('aria-pressed', 'false'); }   // the tour points at the panels
    CH = which === 'guide' ? GUIDE.filter(c => phone() ? !c.deskOnly : !c.phoneOnly) : STORY;
    try { closeIntro(); } catch { /* app not ready */ }
    if (!root) build(); root.hidden = false; document.body.classList.add('touring');
    card.classList.toggle('guide', which === 'guide');
    const sel = root.querySelector('.tjump'); sel.hidden = which !== 'guide';
    sel.replaceChildren(...CH.map((c, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${i + 1}. ${tr(c.t)}`; return o; }));
    uiText();
    cancelAnimationFrame(raf); lastR = ''; place(); show(0);
    try { history.replaceState(null, '', which === 'guide' ? '#guide' : '#tour'); } catch { /* ignore */ }
  }
  function end() {
    Tour.on = false; token++; clearInterval(timer); cancelAnimationFrame(raf); clearInterval(picI); picI = 0;
    hush(); SPEECH.busy = false;
    if (root) root.hidden = true; document.body.classList.remove('touring'); ix = -1;
    try { drawer(false); } catch { /* ignore */ }
    try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  }
  addEventListener('keydown', e => {
    if (!Tour.on || e.target.closest && e.target.closest('input,select,textarea')) return;
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (e.key === 'ArrowRight') show(ix + 1);
    else if (e.key === 'ArrowLeft') show(ix - 1);
  });
  window.Tour = { start, end, on: false, setLang, get lang() { return lang; }, get speech() { return { on: SPEECH.on, busy: SPEECH.busy, src: SPEECH.src || '' }; },
    // for tools/make-voices: every caption Listen can read, per language, with its file key (story: call after the example is loaded)
    spoken() { const out = {}, keepL = lang, keepK = kind; for (const l of IDS) { lang = l; const list = [];
      kind = 'story'; for (const c of STORY) { const t = spokenOf(c); list.push({ key: keyOf(t), text: t }); }
      kind = 'guide'; for (const c of GUIDE) { const t = spokenOf(c); list.push({ key: keyOf(t), text: t }); }
      out[l] = list; } lang = keepL; kind = keepK; return out; },
    // for the tests: every sentence of the story, the guide, the intro and the buttons, in every language (missing = English)
    missing() { const out = {}; for (const l of IDS) { if (l === 'en') continue; const keep = lang; lang = l; const miss = [];
      const chk = v => { if (Array.isArray(v) && tr(v) === v[0] && !/^(Fly to|SPHEREx)$/.test(v[0])) miss.push(v[0]); };
      for (const c of STORY) { chk(c.t); if (!(typeof c.x === 'function')) chk(c.x); }
      for (const c of GUIDE) { chk(c.t); chk(c.what); chk(c.how); }
      for (const k of Object.keys(UI)) chk(UI[k]); for (const [, en, ta] of INTRO) chk([en, ta]); Object.values(PIC_LABEL).flat().forEach(chk);
      lang = keep; out[l] = miss; } return out; } };
  setLang(lang);
  document.querySelectorAll('[data-tour]').forEach(b => b.onclick = () => start('story'));
  document.querySelectorAll('[data-guide]').forEach(b => b.onclick = () => start('guide'));
  // header: one Tour button with a small menu (story or every tool), so the header stays on one line
  const tb = $('tourm'), tm = $('tmenu');
  if (tb && tm) {
    const open = o => { tm.hidden = !o; tb.setAttribute('aria-expanded', String(o)); if (o) tm.querySelector('button').focus(); };
    tb.onclick = e => { e.stopPropagation(); open(tm.hidden); };
    tm.querySelectorAll('button').forEach(b => b.addEventListener('click', () => open(false)));
    addEventListener('click', e => { if (!tm.hidden && !tm.contains(e.target)) open(false); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && !tm.hidden) { open(false); tb.focus(); } });
  }
})();
