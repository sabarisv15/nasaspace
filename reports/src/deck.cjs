// ARCNAVE project presentation (pptxgenjs, 16:9 wide, dark "space" theme like the app).
const path = require('path'), fs = require('fs');
const pptxgen = require('pptxgenjs');
const { applyTheme } = require(process.env.APPLY_THEME);
const DIR = __dirname, SHOT = path.join(DIR, 'shots'), EXIST = 'D:/ARCNAVE-SPHEREX/ARCNAVE SPHEREX/archive/redesign-docs/ui-after/0.55.0';
const OUT = process.argv[2];

const THEME = { name: 'ARCNAVE Space', headFontFace: 'Calibri', bodyFontFace: 'Calibri',
  colors: { dk1: '05070D', lt1: 'F2F5F9', dk2: '111826', lt2: 'A9B3C2', accent1: '2DD4BF', accent2: 'FFB547', accent3: '8B9BFF',
    accent4: '34D399', accent5: 'F472B6', accent6: '60A5FA', hlink: '2DD4BF', folHlink: '8B9BFF' } };
const HEX = { bg: '05070D', card: '111826', line: '263244', teal: '2DD4BF' };

// image size from the file header (PNG / JPEG)
function dims(f) {
  const b = fs.readFileSync(f);
  if (b[0] === 0x89) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  let i = 2; while (i < b.length) { if (b[i] !== 0xFF) { i++; continue; } const m = b[i + 1], L = b.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + L; }
  throw new Error('no size ' + f);
}

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';            // 13.333 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'ARCNAVE: Watch the sky change. Find what moves.';
pres.subject = 'NASA Space Apps Challenge 2026 · Planet X and SPHEREx';
pres.author = 'ARCNAVE team';
const C = pres.SchemeColor;

pres.defineSlideMaster({ title: 'ARC_TITLE', background: { color: HEX.bg },
  objects: [] });
pres.defineSlideMaster({ title: 'ARC_CONTENT', background: { color: HEX.bg }, margin: [0.5, 0.6, 0.6, 0.6],
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.35, w: 12.1, h: 0.85, fontSize: 30, bold: true, color: C.background1, valign: 'middle', margin: 0 }, text: '' } },
    { text: { text: 'ARCNAVE · NASA Space Apps 2026 · Planet X and SPHEREx', options: { x: 0.6, y: 7.05, w: 8, h: 0.3, fontSize: 10, color: C.background2, margin: 0 } } },
  ],
  slideNumber: { x: 12.2, y: 7.05, w: 0.5, h: 0.3, fontSize: 10, color: 'A9B3C2', align: 'right' } });

let sec = '';
function slide(title, section, notes) {
  if (section && section !== sec) { pres.addSection({ title: section }); sec = section; }
  const s = pres.addSlide({ masterName: 'ARC_CONTENT', sectionTitle: sec });
  if (title) s.addText(title, { placeholder: 'title' });
  if (notes) s.addNotes(notes);
  return s;
}
function img(s, file, x, y, W, H, opt = {}) {
  const d = dims(file); const r = Math.min(W / d.w, H / d.h); const w = d.w * r, h = d.h * r;
  const ix = x + (opt.align === 'left' ? 0 : (W - w) / 2), iy = y + (opt.valign === 'top' ? 0 : (H - h) / 2);
  s.addShape(pres.shapes.RECTANGLE, { x: ix - 0.03, y: iy - 0.03, w: w + 0.06, h: h + 0.06, fill: { color: HEX.card }, line: { color: HEX.line, width: 1 }, objectName: 'frame' });
  s.addImage({ path: file, x: ix, y: iy, w, h, altText: opt.alt || '', objectName: 'shot' });
  if (opt.cap) s.addText(opt.cap, { x: ix, y: iy + h + 0.08, w, h: opt.capH || 0.45, fontSize: 11, color: C.background2, valign: 'top', margin: 0, isTextBox: true });
  return { x: ix, y: iy, w, h };
}
function card(s, x, y, w, h) { s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: HEX.card }, line: { color: HEX.line, width: 1 }, objectName: 'card' }); }
function stat(s, x, y, w, h, big, label, col = C.accent1) {
  card(s, x, y, w, h);
  s.addText(big, { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.7, fontSize: 30, bold: true, color: col, margin: 0, valign: 'middle', isTextBox: true });
  s.addText(label, { x: x + 0.2, y: y + 0.85, w: w - 0.4, h: h - 0.95, fontSize: 12, color: C.background2, margin: 0, valign: 'top', isTextBox: true });
}
function bullets(s, items, x, y, w, h, size = 15) {
  const runs = items.map((t, i) => {
    const parts = Array.isArray(t) ? t : [t];
    return parts.map((p, j) => ({ text: typeof p === 'string' ? p : p.text, options: { bullet: j === 0 ? { indent: 16 } : undefined, bold: typeof p !== 'string' && p.b, color: typeof p !== 'string' && p.b ? C.background1 : C.background1,
      breakLine: j === parts.length - 1 && i < items.length - 1, paraSpaceAfter: 8 } }));
  }).flat();
  s.addText(runs, { x, y, w, h, fontSize: size, color: C.background1, valign: 'top', margin: 0, isTextBox: true });
}
function chip(s, x, y, w, text, col = C.accent1) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.36, rectRadius: 0.18, fill: { color: '0E2A2A' }, line: { color: '1F5F58', width: 1 } });
  s.addText(text, { x, y, w, h: 0.36, fontSize: 11, bold: true, color: col, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
}
const B = t => ({ text: t, b: true });

/* 1 · title */
{
  pres.addSection({ title: 'Introduction' }); sec = 'Introduction';
  const s = pres.addSlide({ masterName: 'ARC_TITLE', sectionTitle: sec });
  const bgf = 'D:/ARCNAVE-SPHEREX/ARCNAVE SPHEREX/public/img/hero/film-epsindi.jpg';
  s.addImage({ path: bgf, x: 0, y: 0, w: 13.333, h: 7.5, sizing: { type: 'cover', w: 13.333, h: 7.5 }, transparency: 40, objectName: 'background film' });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: HEX.bg, transparency: 15 }, line: { type: 'none' } });
  chip(s, 0.8, 1.0, 6.4, 'NASA SPACE APPS CHALLENGE 2026 · PLANET X AND SPHEREx');
  s.addText('ARCNAVE', { x: 0.8, y: 1.7, w: 11, h: 1.4, fontSize: 72, bold: true, color: C.background1, margin: 0, isTextBox: true });
  s.addText([{ text: 'Watch the sky change. ', options: { color: C.background1 } }, { text: 'Find what moves.', options: { color: C.accent1 } }],
    { x: 0.8, y: 3.1, w: 11.5, h: 0.8, fontSize: 32, bold: true, margin: 0, isTextBox: true });
  s.addText('A free public web tool that plays real NASA SPHEREx images of any spot in the sky as a film, measures what moves, and checks every result against ESA Gaia and NASA WISE.',
    { x: 0.8, y: 4.05, w: 8.6, h: 1.0, fontSize: 16, color: C.background2, margin: 0, isTextBox: true });
  s.addText('Project report · ARCNAVE v0.56 · November 2026', { x: 0.8, y: 6.5, w: 8, h: 0.4, fontSize: 13, color: C.background2, margin: 0, isTextBox: true });
  s.addNotes('ARCNAVE: our answer to the Planet X and SPHEREx challenge. The background is a real ARCNAVE film frame of the Epsilon Indi field.');
}

/* 2 · the challenge */
{
  const s = slide('What NASA asked for', 'Introduction', 'Summary of the challenge statement and its objectives.');
  s.addText('SPHEREx maps the whole sky every six months in 102 near-infrared colours (0.75–5 µm). Things that move between images, like asteroids, comets, nearby stars and brown dwarfs, can be found the way Pluto was in 1930.',
    { x: 0.6, y: 1.35, w: 5.4, h: 1.7, fontSize: 15, color: C.background2, margin: 0, valign: 'top', isTextBox: true });
  card(s, 0.6, 3.2, 5.4, 3.55);
  s.addText('The task', { x: 0.85, y: 3.35, w: 5, h: 0.4, fontSize: 16, bold: true, color: C.accent1, margin: 0, isTextBox: true });
  bullets(s, ['A public-facing web tool', 'User enters RA and Dec', 'Shows that patch as a little video', 'Makes moving objects easy to spot',
    'Tested on Barnard\'s Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis'], 0.85, 3.85, 4.95, 2.8, 14);
  s.addText('Suggested considerations', { x: 6.5, y: 1.35, w: 6.2, h: 0.4, fontSize: 16, bold: true, color: C.accent2, margin: 0, isTextBox: true });
  const cons = ['Easy to update with new data releases', 'Use the 102 bands; add up each of the 6 detectors', 'Spectra on the fly ("extra kudos")', 'Add or subtract images from different times',
    'Let users choose the field of view', 'Overlay Gaia and WISE', 'Coordinates in the URL; embeddable', 'Show metadata like contamination flags', 'Use Astropy and Aladin'];
  cons.forEach((t, i) => { const y = 1.9 + i * 0.54; card(s, 6.5, y, 6.2, 0.46);
    s.addText([{ text: String(i + 5).padStart(2, ' ') + '  ', options: { color: C.accent2, bold: true } }, { text: t, options: { color: C.background1 } }], { x: 6.7, y, w: 5.9, h: 0.46, fontSize: 13, valign: 'middle', margin: 0, isTextBox: true }); });
}

/* 3 · our answer in numbers */
{
  const s = slide('ARCNAVE in one look', 'Introduction', 'Headline numbers. Every number comes from the app\'s own results or the 18-field tests.');
  s.addText('Type a place in the sky. ARCNAVE fetches every SPHEREx image of it, lines them up on Gaia, plays the sky as a film, spotlights what moves, and tells you how sure it is.',
    { x: 0.6, y: 1.35, w: 12.1, h: 0.9, fontSize: 17, color: C.background2, margin: 0, isTextBox: true });
  const st = [['5 / 5', 'NASA test targets answered: 3 movers measured, 2 brightness changes seen'], ['13 / 13', 'challenge objectives and considerations with a working feature'],
    ['46', 'tools, each explained in plain words in English, Tamil, Hindi and Spanish'], ['18', 'sky fields chosen before testing: 19,880 fake planets and 416 fake movers']];
  st.forEach(([b, l], i) => stat(s, 0.6 + i * 3.1, 2.5, 2.85, 2.1, b, l));
  card(s, 0.6, 4.9, 12.1, 1.85);
  s.addText('Honest by design', { x: 0.85, y: 5.05, w: 5, h: 0.4, fontSize: 16, bold: true, color: C.accent1, margin: 0, isTextBox: true });
  s.addText('Planet X is always called hypothetical. Nothing is called a discovery. Every mover carries a label: known, target, candidate, fixed, differs or predicted. The tool publishes its own error rates and limits next to its results.',
    { x: 0.85, y: 5.5, w: 11.6, h: 1.1, fontSize: 14, color: C.background1, margin: 0, isTextBox: true });
}

/* 4 · how it works */
{
  const s = slide('How it works: five agents', 'How it works', 'Server: Node.js, no packages, a cache. Science: in the browser, in Web Workers.');
  const ag = [['Navigator', 'Reads the place (RA/Dec, a name or a NASA target) and flies there on the whole-sky map'],
    ['Archivist', 'Asks NASA/IPAC IRSA for every SPHEREx image (QR2 + QR3) and picks colour-matched images per pass'],
    ['Aligner', 'Cuts out the patch, removes zodiacal light, masks flagged pixels, lines every image up on Gaia'],
    ['Analyst', 'Stacks each pass, compares passes, finds changes, checks known asteroids (SkyBoT, MPC)'],
    ['Reporter', 'Writes a plain-language card with honest labels; the film, searches and charts open from it']];
  ag.forEach(([t, d], i) => { const x = 0.6 + i * 2.48; card(s, x, 1.45, 2.28, 2.9);
    s.addShape(pres.shapes.OVAL, { x: x + 0.2, y: 1.65, w: 0.55, h: 0.55, fill: { color: '0E2A2A' }, line: { color: HEX.teal, width: 1.25 } });
    s.addText(String(i + 1), { x: x + 0.2, y: 1.65, w: 0.55, h: 0.55, fontSize: 16, bold: true, color: C.accent1, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    s.addText(t, { x: x + 0.2, y: 2.3, w: 1.95, h: 0.4, fontSize: 16, bold: true, color: C.background1, margin: 0, isTextBox: true });
    s.addText(d, { x: x + 0.2, y: 2.72, w: 1.95, h: 1.55, fontSize: 12, color: C.background2, margin: 0, valign: 'top', isTextBox: true });
    if (i < 4) s.addText('›', { x: x + 2.28, y: 2.6, w: 0.2, h: 0.5, fontSize: 22, color: C.accent1, align: 'center', margin: 0, isTextBox: true }); });
  bullets(s, [[B('Passes, not single images: '), 'the median of up to 8 colour-matched images per six-month pass lowers noise and removes cosmic rays.'],
    [B('Lined up on Gaia: '), 'each image is registered to up to 60 Gaia DR3 stars; motions are PSF fits with parallax removed and a χ² check.'],
    [B('Two opinions: '), 'every SPHEREx motion is compared with Gaia or CatWISE2020 and labelled agrees, differs or unchecked.'],
    [B('Sharable: '), 'the address holds the view (#ra, #dec, #fov, #ct); ?embed=1 gives an embeddable flip-book.']], 0.6, 4.65, 12.1, 2.2, 14);
}

/* 5 · start page */
{
  const s = slide('The start page', 'The website', 'v0.56 start page: centred hero, the Lindbloom blink below it.');
  img(s, path.join(SHOT, 'hero-w1440.png'), 0.6, 1.35, 7.2, 5.5, { alt: 'ARCNAVE start page' });
  bullets(s, [[B('One clear promise: '), '"Watch the sky change. Find what moves."'], [B('Three ways in: '), 'Launch, Try Barnard\'s Star, or the 90-second story for newcomers'],
    [B('Go anywhere: '), 'type RA Dec or a name straight from the start page'], [B('Real, not mock-up: '), 'real SPHEREx images blink below: ARCNAVE caught the known asteroid 3865 Lindbloom moving'],
    [B('Below the fold: '), 'how it works, features, NASA\'s 5 targets with their measured results, how we tested it, limits'], [B('4 languages, '), 'free, no sign-up, no tracking, works on phones']], 8.1, 1.45, 4.6, 5.4, 14);
}

/* 6 · beginner vs advanced */
{
  const s = slide('One tool, two modes', 'The website', 'Beginner and Advanced run the same functions; only what is shown changes.');
  img(s, path.join(SHOT, 'target-barnard.png'), 0.6, 1.4, 5.95, 3.7, { cap: 'Beginner: three steps (pick a spot, watch it change, read the result) and "What am I seeing?" in plain words.', capH: 0.7 });
  img(s, path.join(EXIST, 'judge/judge-planetx.jpg'), 6.75, 1.4, 5.95, 3.7, { cap: 'Advanced: 14 more tools, grouped by task, each group with a "?" explanation.', capH: 0.7 });
  bullets(s, [[B('Bottom bar: '), 'RA, Dec, colour (µm), passes, image count and data release always visible']], 0.6, 6.25, 12.1, 0.6, 13);
}

/* 7 · five targets table */
{
  const s = slide('NASA\'s five test targets: all answered', 'NASA targets', 'All numbers measured by ARCNAVE on real SPHEREx images. Open with #ct=barnard, epsindb, wise0855, rwaur, rdra.');
  const H = (t) => ({ text: t, options: { bold: true, color: '05070D', fill: { color: '2DD4BF' } } });
  const rows = [[H('Target'), H('What to look for'), H('ARCNAVE measured'), H('Reference'), H('Verdict')],
    ['Barnard\'s Star', 'Fastest star in our sky', '9.89″/yr north (9.7″ in 359 days), from its glow (saturated)', 'Gaia 10.39″/yr', '✓ Motion seen'],
    ['Epsilon Indi B', 'Brown-dwarf pair', '4.32 ± 0.27″/yr south-east (5.9″ in 515 days, 4 passes)', 'Catalogue 4.68″/yr', '✓ Motion seen'],
    ['WISE 0855−0714', 'Fast, cold, faint brown dwarf', '8.82 ± 1.10″/yr west, fit on every image', 'CatWISE2020 7.94″/yr', '✓ Agrees'],
    ['RW Aurigae', 'Variable young star', 'Faded 0.74 mag in 6 of 6 colours (3.9–4.8 µm, ~10σ)', 'Comparison stars 0.13 mag', '✓ Change seen'],
    ['R Draconis', 'Pulsating giant', 'Changed 1.24 mag at 0.85 µm, 10 images', 'Comparison stars 0.12–0.13 mag', '✓ Change seen']];
  const body = rows.map((r, i) => i === 0 ? r : r.map((c, j) => ({ text: c, options: { color: j === 4 ? '34D399' : 'F2F5F9', bold: j === 0 || j === 4, fill: { color: i % 2 ? '111826' : '0B111C' } } })));
  s.addTable(body, { x: 0.6, y: 1.45, w: 12.1, colW: [2.0, 2.4, 3.9, 2.25, 1.55], fontSize: 13, fontFace: 'Calibri', border: { type: 'solid', color: '263244', pt: 1 }, valign: 'middle', rowH: 0.62 });
  s.addText('Each target opens in about 10–20 seconds from images saved with the site, or live from NASA/IPAC IRSA.', { x: 0.6, y: 5.6, w: 12.1, h: 0.4, fontSize: 13, color: C.background2, margin: 0, isTextBox: true });
  ['#ct=barnard', '#ct=epsindb', '#ct=wise0855', '#ct=rwaur', '#ct=rdra'].forEach((t, i) => chip(s, 0.6 + i * 2.0, 6.15, 1.8, t));
}

/* 8-10 · movers */
const moverSlide = (title, file, sideTitle, stats, pts, notes) => {
  const s = slide(title, 'NASA targets', notes);
  img(s, file, 0.6, 1.35, 7.9, 5.5, { alt: title });
  stats.forEach(([b, l], i) => stat(s, 8.8, 1.35 + i * 1.5, 3.9, 1.35, b, l, i === 0 ? C.accent1 : C.accent2));
  bullets(s, pts, 8.8, 1.35 + stats.length * 1.5 + 0.1, 3.9, 5.5 - stats.length * 1.5, 13);
};
moverSlide('Barnard\'s Star: the fastest star in our sky', path.join(DIR, 'crops', 'film-barnard.png'), '', [['9.89″/yr', 'measured north by ARCNAVE'], ['10.39″/yr', 'Gaia DR3 says']],
  ['Saturated in most images, so measured from its glow, pass by pass', 'Film: spotlight, track and a dated circle in each pass'], 'Barnard\'s Star film frame from v0.56.');
moverSlide('Epsilon Indi B: a brown-dwarf pair on the move', path.join(DIR, 'crops', 'film-epsindb.png'), '', [['4.32″/yr', '± 0.27, south-east, over 4 passes'], ['4.68″/yr', 'the catalogue says: agrees']],
  ['Partner Epsilon Indi A moves too; it is saturated, so the film shows it where the catalogue predicts', 'A per-field error floor from 40 Gaia stars keeps the errors honest'], 'Epsilon Indi field film frame.');
moverSlide('WISE 0855: the coldest known brown dwarf', path.join(DIR, 'crops', 'film-wise0855.png'), '', [['8.82″/yr', '± 1.10, toward the west'], ['7.94″/yr', 'CatWISE2020 says: agrees']],
  ['Not in Gaia at all: found and checked with NASA WISE', 'Faint (S/N 2.4–5 per pass), so the error is large and the card says so'], 'WISE 0855 film frame.');

/* 11 · variable stars */
{
  const s = slide('RW Aurigae and R Draconis: brightness that changes', 'NASA targets', 'Light curves with 3 steady comparison stars; the glare check for R Draconis.');
  img(s, path.join(DIR, 'crops', 'rwaur.png'), 0.6, 1.4, 5.95, 3.6, { cap: 'RW Aurigae at 4.0 µm: the star (pink) fades while the comparison stars (open) stay flat. Faded 0.74 mag in 6 of 6 colours.', capH: 0.75 });
  img(s, path.join(DIR, 'crops', 'target-rdra.png'), 6.75, 1.4, 5.95, 3.6, { cap: 'R Draconis: saturated centre, so its outer glow is measured; the same pulse shows in 0.75, 0.80 and 0.85 µm (1.24 mag at 0.85 µm).', capH: 0.75 });
  bullets(s, [[B('Saturated centres: '), 'when a star is too bright, ARCNAVE measures its outer glow and says so on the card.']], 0.6, 6.25, 12.1, 0.6, 13);
}

/* 12 · film */
{
  const s = slide('The film: spotlight on what moves', 'Moving objects', 'The film runs every search it needs, then tells one mover\'s story at a time.');
  img(s, path.join(DIR, 'crops', 'film-barnard-b.png'), 0.6, 1.35, 6.4, 4.0, { alt: 'film' });
  img(s, path.join(DIR, 'crops', 'motionchart.png'), 0.6 + 6.6, 1.35, 5.5, 4.0, { alt: 'motion chart' });
  bullets(s, [[B('Spotlight and glowing track '), 'on each mover, with a numbered circle (P1, P2…) in every pass'],
    [B('"Was here, now there": '), 'the old place stays as a dated ghost circle; the callout gives the true shift, e.g. "moved 15.8″ toward the north-east in 178 days"'],
    [B('Measured or predicted: '), 'solid track = measured on SPHEREx; dashed = Gaia/WISE prediction for something too faint or too slow'],
    [B('Motion only + line of passes: '), 'distance against date, straight-line fit, χ², parallax removed (right)']], 0.6, 5.55, 12.1, 1.4, 13);
}

/* 13 · searches */
{
  const s = slide('Four searches for moving stars, in any field', 'Moving objects', 'Each find gets a second opinion: a frame-by-frame fit on every single image.');
  const se = [['Find moving stars', 'PSF fit of every star in each pass, lined up on Gaia; straight motion with errors and χ²', 'Bright and medium stars'],
    ['Deep search', 'Stacks all images for depth, then follows faint sources pass by pass; consistency checks keep noise out', 'Faint movers'],
    ['Slow movers', 'Kernel-matched difference images; a star that shifted leaves a +/− pair, fitted as a dipole', 'Motions under a pixel'],
    ['Motion scan', 'Adds up all images along 625 trial motions per source at 1/8-pixel steps (shift-and-stack)', 'Very faint movers']];
  se.forEach(([t, d, f], i) => { const x = 0.6 + i * 3.08; card(s, x, 1.45, 2.88, 2.75);
    s.addText(t, { x: x + 0.2, y: 1.65, w: 2.5, h: 0.45, fontSize: 17, bold: true, color: C.accent1, margin: 0, isTextBox: true });
    s.addText(d, { x: x + 0.2, y: 2.15, w: 2.5, h: 2.0, fontSize: 13, color: C.background1, margin: 0, valign: 'top', isTextBox: true });
    s.addText(f, { x: x + 0.2, y: 3.62, w: 2.5, h: 0.45, fontSize: 12, bold: true, color: C.accent2, margin: 0, isTextBox: true }); });
  bullets(s, [[B('Safety rules: '), 'finds near a saturated star\'s glare are left out; a star Gaia calls fixed never enters the film; a measurement too uncertain to agree lets Gaia decide.'],
    [B('Changes between passes: '), 'every spot that changed is sorted into plain kinds: a known asteroid (named from SkyBoT/MPC), a star that got brighter, or "not explained yet".']], 0.6, 4.55, 12.1, 2.3, 16);
}

/* 14 · 102 colours */
{
  const s = slide('102 colours: composite, spectra, light curves', 'Science tools', 'Answers the 102-band, detector-sum and spectra-on-the-fly considerations.');
  img(s, path.join(DIR, 'crops', 'composite.png'), 0.6, 1.35, 7.3, 5.5, { alt: 'colour composite' });
  bullets(s, [[B('Colour slider: '), 'any SPHEREx wavelength, 0.75–5 µm'], [B('Deep view per detector: '), 'adds up each of the 6 arrays, noise down by 1.6–3.5×'],
    [B('Colour composite on the sky: '), 'D1–2 blue, D3–4 green, D5–6 red; the cold brown dwarf WISE 0855 looks red'],
    [B('Spectrum on the fly: '), 'tap a star, get its spectrum from every image; compare passes; CSV'], [B('Light curve: '), 'error bars, 3 comparison stars, χ² verdict "varies at Nσ" or "steady"']], 8.2, 1.45, 4.5, 5.4, 14);
}

/* 15 · overlays & data */
{
  const s = slide('Other telescopes, data quality, new releases', 'Science tools', 'Gaia, WISE, asteroids, Aladin; flags; the release panel.');
  img(s, path.join(DIR, 'crops', 'release.png'), 0.6, 1.35, 7.3, 5.5, { alt: 'data release panel' });
  bullets(s, [[B('Gaia DR3: '), 'every star moved to the pass date; "Measure its motion"'], [B('WISE / CatWISE2020: '), 'orange movers with arrows, pink very red sources'],
    [B('Known asteroids: '), 'SkyBoT + MPC with tracks; JPL Horizons'], [B('Aladin Lite: '), '2MASS or DSS context sky'],
    [B('Contamination flags: '), 'flagged pixels with counts; warnings on mover positions'], [B('Data releases: '), 'asked live (QR2 + QR3 now), pass dates, "Check for new data" (left)']], 8.2, 1.45, 4.5, 5.4, 14);
}

/* 16 · share */
{
  const s = slide('Share, embed, report, reproduce', 'Science tools', 'Discovery card GIF; embed; Copy report; Copy Python.');
  img(s, path.join(DIR, 'crops', 'gif.png'), 0.6, 1.35, 7.3, 5.5, { alt: 'discovery card' });
  bullets(s, [[B('Discovery card: '), 'a looping GIF made in the browser from real images, with a link back to the exact view'], [B('Embed: '), 'share link and ?embed=1 iframe code'],
    [B('Exports: '), 'film GIF/WebM, sky PNG, movers CSV/JSON, spectrum and light-curve CSV'], [B('Check it: '), 'SIMBAD, Legacy Surveys, MPC checker'],
    [B('Report: '), 'always "unconfirmed, not a discovery claim"; ARCNAVE itself sends nothing'], [B('Copy Python: '), 'Astropy + astroquery code that repeats the query']], 8.2, 1.45, 4.5, 5.4, 14);
}

/* 17 · planet x */
{
  const s = slide('Planet X: how faint could it be and still be caught?', 'Planet X and tests', 'Planet X is hypothetical. This is a sensitivity test, not a search claim.');
  img(s, path.join(DIR, 'crops', 'planetx.png'), 0.6, 1.35, 6.9, 4.4, { alt: 'Planet X panel' });
  const st = [['AB 17.0', 'median depth for a planet 1000 AU away (18 of 18 fields)'], ['12 / 18', 'fields catch a planet 300 AU away (9 without the motion-following stack)'], ['19,880', 'fake planets hidden in real images']];
  st.forEach(([b, l], i) => stat(s, 7.8, 1.35 + i * 1.5, 4.9, 1.35, b, l));
  bullets(s, [[B('Hide Planet X: '), 'hide a fake planet with the right motion and PSF, let the agents look'], [B('Motion-following stack: '), 'shift along the path before stacking, so a close planet is not lost']], 0.6, 6.0, 12.1, 0.9, 13);
}

/* 18 · tested */
{
  const s = slide('How we tested it: 18 fields chosen in advance', 'Planet X and tests', 'Grid: ecliptic longitude every 60°, latitude 0 and ±40°. Bad fields are reported too.');
  const H = (t) => ({ text: t, options: { bold: true, color: '05070D', fill: { color: '2DD4BF' } } });
  const rows = [[H('Test'), H('How'), H('Result')],
    ['Planet X sensitivity', '19,880 fake planets, plain and motion-following stacks', '1000 AU: 18/18, median AB 17.0 · 300 AU: 12/18'],
    ['Mover injection', '416 fake movers (1–8″/yr, S/N 3–25) in 15 fields', 'Errors honest (scatter 1.03); 80% found blind at 2–8″/yr, S/N 12+'],
    ['False alarms', 'Two stacks of the same passes that differ in nothing real', 'Away from the Milky Way: 22 in 32 comparisons; warns in the plane'],
    ['Empty places', '323 places with no source', '0 showed a steady motion'],
    ['Brightness change', '720 stars made brighter by a known factor', '×1.5: 82% caught · ×2: 89%'],
    ['Against Astropy', 'astropy.wcs and apply_space_motion on real files', 'WCS 0.000″ · proper motion within 0.064″'],
    ['Whole app', 'Headless smoke test of every feature; guided tour', '31/31 features, 0 page errors; tour 30/30 (v0.54)']];
  const body = rows.map((r, i) => i === 0 ? r : r.map((c, j) => ({ text: c, options: { color: 'F2F5F9', bold: j === 0, fill: { color: i % 2 ? '111826' : '0B111C' } } })));
  s.addTable(body, { x: 0.6, y: 1.45, w: 12.1, colW: [2.4, 4.9, 4.8], fontSize: 13, fontFace: 'Calibri', border: { type: 'solid', color: '263244', pt: 1 }, valign: 'middle', rowH: 0.6 });
}

/* 19 · for everyone */
{
  const s = slide('Made for everyone', 'For everyone', 'Beginner/Advanced, 4 languages with voices, tours, tools page, game, phone layout.');
  img(s, path.join(SHOT, 'phone-epsindb.png'), 0.6, 1.35, 2.75, 5.5, { alt: 'phone view' });
  img(s, path.join(SHOT, 'tools-page.png'), 3.6, 1.35, 5.0, 3.3, { cap: '"Tools, simply": all 46 tools in plain words, in 4 languages.', capH: 0.5 });
  bullets(s, [[B('4 languages: '), 'English, Tamil, Hindi, Spanish'], [B('Guided tours: '), '90-second story and a 43-step tool guide on the live app, with recorded voices'],
    [B('Game: '), 'Find the asteroid in 60 seconds, on real images'], [B('Phones: '), 'the sky stays visible above a three-height bottom sheet'],
    [B('Accessible: '), 'keyboard shortcuts, focus rings, high contrast, dark and light themes, reduced motion']], 8.9, 1.45, 3.8, 5.4, 14);
}

/* 20 · speed */
{
  const s = slide('Speed and engineering', 'Engineering', 'v0.52 and v0.56 speed work; deploy-ready.');
  const st = [['~40 s', 'first report on a never-seen field'], ['8–10 s', 'a field opened before, full report'], ['10–20 s', 'each NASA target from saved images'], ['5.1 MB', 'per image read (was 7.5 MB)']];
  st.forEach(([b, l], i) => stat(s, 0.6 + i * 3.1, 1.45, 2.85, 1.7, b, l));
  bullets(s, [[B('Light server: '), 'Node.js with no npm packages; caches IRSA, Gaia, CatWISE, SkyBoT and MPC; 30 start-screen places prewarmed and pinned'],
    [B('Science in the browser: '), 'FITS, WCS with SIP, PSF fits and stacks in Web Workers; stacks 8–15× faster with bit-identical results'],
    [B('New data, no code change: '), 'the archive is asked live; "Check for new data" re-asks IRSA'],
    [B('Ready to deploy: '), 'Docker + Caddy HTTPS, a free always-on server guide (US East, next to NASA\'s S3 copy), and an offline package for any laptop'],
    [B('Version control: '), 'git history; every change in the changelog with what was measured']], 0.6, 3.5, 12.1, 3.4, 15);
}

/* 21 · coverage */
{
  const s = slide('Challenge coverage: 13 of 13', 'Conclusion', 'Our own mapping of each listed item to a working feature.');
  const items = [['Enter RA / Dec', 'Search box, whole-sky map, link coordinates'], ['Images like a video', 'Time machine, Blink, Swipe, film'], ['Spot moving objects', 'Changes, 4 searches, film, asteroids'],
    ['5 test targets', 'All 5 answered with measurements'], ['New data releases', 'Live archive, release panel'], ['102 bands, sum detectors', 'Slider, Deep view, composite'],
    ['Spectra on the fly', 'Any star, per pass, CSV'], ['Add / subtract epochs', 'Stacks, Difference, Changes'], ['Field of view', '0.25°, 0.5°, 1° and zoom'],
    ['Gaia / WISE overlays', 'Gaia DR3 and CatWISE2020'], ['URL + embed', '#ra/#dec/#fov/#ct, ?embed=1'], ['Contamination flags', 'Flags with counts, on movers'], ['Astropy / Aladin', 'Aladin Lite, Copy Python, Astropy checks']];
  items.forEach(([t, d], i) => { const col = i < 7 ? 0 : 1, row = i < 7 ? i : i - 7; const x = 0.6 + col * 6.15, y = 1.4 + row * 0.75;
    card(s, x, y, 5.95, 0.64);
    s.addShape(pres.shapes.OVAL, { x: x + 0.15, y: y + 0.14, w: 0.36, h: 0.36, fill: { color: '0E2A2A' }, line: { color: '34D399', width: 1 } });
    s.addText('✓', { x: x + 0.15, y: y + 0.14, w: 0.36, h: 0.36, fontSize: 13, bold: true, color: C.accent4, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
    s.addText([{ text: t + '  ', options: { bold: true, color: C.background1 } }, { text: d, options: { color: C.background2 } }], { x: x + 0.65, y, w: 5.2, h: 0.64, fontSize: 13, valign: 'middle', margin: 0, isTextBox: true }); });
  s.addText('Beyond the brief: four motion searches, Planet X sensitivity maps, published error rates, 4 languages with voices, a game, and a phone layout.',
    { x: 6.75, y: 6.62, w: 5.95, h: 0.4, fontSize: 11, color: C.accent2, margin: 0, isTextBox: true });
}

/* 22 · limits */
{
  const s = slide('Honest limits and next steps', 'Conclusion', 'The limits ARCNAVE states in the app.');
  card(s, 0.6, 1.45, 6.0, 5.4); card(s, 6.75, 1.45, 5.95, 5.4);
  s.addText('What it cannot do (and says so)', { x: 0.85, y: 1.6, w: 5.5, h: 0.45, fontSize: 17, bold: true, color: C.accent2, margin: 0, isTextBox: true });
  bullets(s, ['Most stars move far under 1″ a year: too small for 6.2″ pixels over 1–1.5 years', 'Asteroids cross a field in days: found as changes, not followed across passes',
    'S/N 3 per image or 1″/yr is below the limit', 'Saturated stars: measured from their glow, with larger errors', 'Crowded Milky Way fields raise false alarms; ARCNAVE warns',
    'No discoveries are claimed: candidates stay "unconfirmed"'], 0.85, 2.15, 5.5, 4.6, 16);
  s.addText('Next steps', { x: 7.0, y: 1.6, w: 5.5, h: 0.45, fontSize: 17, bold: true, color: C.accent1, margin: 0, isTextBox: true });
  bullets(s, ['Go live on an always-on public server (guide ready)', 'New SPHEREx releases: more passes, longer baselines, slower movers in reach',
    'Fit the official SPHEREx PSF on native pixels', 'A volunteer review queue, so more than one person checks each candidate'], 7.0, 2.15, 5.5, 4.6, 16);
}

/* 23 · close */
{
  const s = pres.addSlide({ masterName: 'ARC_TITLE', sectionTitle: 'Conclusion' });
  s.addText('ARCNAVE', { x: 0.8, y: 2.0, w: 11.7, h: 1.2, fontSize: 60, bold: true, color: C.background1, align: 'center', margin: 0, isTextBox: true });
  s.addText([{ text: 'Watch the sky change. ', options: { color: C.background1 } }, { text: 'Find what moves.', options: { color: C.accent1 } }], { x: 0.8, y: 3.2, w: 11.7, h: 0.7, fontSize: 28, bold: true, align: 'center', margin: 0, isTextBox: true });
  s.addText('Real NASA SPHEREx images · checked against ESA Gaia and NASA WISE · for everyone', { x: 0.8, y: 4.1, w: 11.7, h: 0.5, fontSize: 16, color: C.background2, align: 'center', margin: 0, isTextBox: true });
  s.addText('Data: NASA/IPAC IRSA (SPHEREx), ESA Gaia DR3, NASA WISE/CatWISE2020, IMCCE SkyBoT, Minor Planet Center, JPL Horizons, CDS. Images in false colour. Planet X is hypothetical.',
    { x: 1.3, y: 6.3, w: 10.7, h: 0.6, fontSize: 11, color: C.background2, align: 'center', margin: 0, isTextBox: true });
  s.addNotes('Thank you.');
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log('wrote', OUT);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
