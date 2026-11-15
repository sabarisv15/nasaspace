// Makes deploy/out/cf: ARCNAVE as a Cloudflare Worker with static assets (free plan, no card, always on; this PC can be off).
//   node deploy/cloudflare/build.mjs https://arcnave.<your-subdomain>.workers.dev
// What goes where (see docs/deploy/DEPLOY-CLOUDFLARE.md):
//   /                  public/ (the pages, %ORIGIN% filled in with the site address, edge-api.js added to each page)
//   /lib/*.js          the browser copies of lib/ the pages load
//   /edge-parsers.js   lib/parsers.js wrapped for the browser (the archive answers are read in the visitor's browser)
//   /_c/api/*.json     every archive answer this PC has (cache/api + demo-cache/api), the answer only (no re-parsing)
//   /_c/cutouts/*.fgz  every SPHEREx cutout this PC has (gzipped FITS as the server keeps them; renamed so nothing re-encodes them)
//   /_c/neossat/*      NEOSSat previews
//   /hips/<sky>/...    the sky tiles this PC has, at the address the sky viewer asks for (served with no Worker call)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..', '..');
const site = String(process.argv[2] || '').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(site) && !/^http:\/\/localhost:\d+$/.test(site)) { console.error('Usage: node deploy/cloudflare/build.mjs https://<site address>'); process.exit(1); }
const out = path.join(root, 'deploy', 'out', 'cf');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let files = 0, bytes = 0, biggest = 0;
const LIMIT = 25 * 1024 * 1024;   // Workers static assets: 25 MiB per file
function put(rel, data) {
  const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data); files++; bytes += data.length; biggest = Math.max(biggest, data.length);
  if (data.length > LIMIT) throw new Error(`${rel} is over 25 MiB (${data.length} bytes)`);
}
function copy(from, rel) { put(rel, fs.readFileSync(from)); }
const list = d => { try { return fs.readdirSync(d); } catch { return []; } };

// 1. the pages and their files (not public/dev: developer pages are local only)
const INJECT = '<script src="/lib/wave.js"></script><script src="/edge-parsers.js"></script><script src="/edge-api.js"></script>\n';
(function walk(dir, rel) {
  for (const n of list(dir)) {
    const f = path.join(dir, n), r = rel ? rel + '/' + n : n;
    if (fs.statSync(f).isDirectory()) { if (r !== 'dev') walk(f, r); continue; }
    if (n.endsWith('.html')) {
      let t = fs.readFileSync(f, 'utf8').split('%ORIGIN%').join(site);
      t = t.replace(/<script\b/i, INJECT + '<script');   // before the page's first script, so its fetches go through edge-api.js
      put(r, Buffer.from(t, 'utf8'));
    } else copy(f, r);
  }
})(path.join(root, 'public'), '');
for (const n of ['fits.js', 'wave.js', 'slots.js', 'planetx.js', 's3cut.js', 'spot.js']) copy(path.join(root, 'lib', n), 'lib/' + n);
// lib/parsers.js for the browser: its one require is ./wave (window.SkyWave, loaded by the page before it is used)
put('edge-parsers.js', Buffer.from('/* lib/parsers.js, wrapped for the browser by deploy/cloudflare/build.mjs */\n(function () {\n' +
  'var module = { exports: {} }, exports = module.exports;\n' +
  'var require = function () { return new Proxy({}, { get: function (_, k) { return window.SkyWave[k]; } }); };\n' +
  fs.readFileSync(path.join(root, 'lib', 'parsers.js'), 'utf8') + '\nwindow.ArcParsers = module.exports;\n})();\n', 'utf8'));
copy(path.join(here, 'edge-api.js'), 'edge-api.js');
put('edge-version.json', Buffer.from(JSON.stringify({ version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, site, built: new Date().toISOString() })));

// 2. archive answers: the stored answer only. The image lists of the pinned fields and of the shipped examples are marked
// frozen, as the server does (their measured numbers were made on those lists)
const frozen = new Set(list(path.join(root, 'demo-cache', 'api')));
try { for (const n of JSON.parse(fs.readFileSync(path.join(root, 'cache', 'pinned.json'), 'utf8')).api || []) frozen.add(n); } catch { /* none pinned */ }
const done = new Set();
let answers = 0;
for (const src of [path.join(root, 'cache', 'api'), path.join(root, 'demo-cache', 'api')]) {   // the PC's cache first (newer)
  for (const n of list(src)) {
    if (!n.endsWith('.json') || done.has(n)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(src, n), 'utf8')); } catch { continue; }
    if (!j || j.data == null) continue;
    let data = j.data;
    if (n.startsWith('search-') && frozen.has(n)) data = Object.assign({}, data, { frozen: true });
    put('_c/api/' + n, Buffer.from(JSON.stringify(data))); done.add(n); answers++;
  }
}
// 3. cutouts, NEOSSat previews
let cuts = 0;
for (const src of [path.join(root, 'cache', 'cutouts'), path.join(root, 'demo-cache', 'cutouts')]) {
  for (const n of list(src)) { if (!/^[0-9a-f]{40}\.fits\.gz$/.test(n) || done.has(n)) continue; copy(path.join(src, n), '_c/cutouts/' + n.replace(/.fits.gz$/, '.fgz')); done.add(n); cuts++; }
}
for (const n of list(path.join(root, 'cache', 'neossat'))) if (/^\d{13}_raw_prev(_256)?\.png$/.test(n)) copy(path.join(root, 'cache', 'neossat', n), '_c/neossat/' + n);
// 4. sky tiles at the address the sky viewer asks for (the server stores Norder3/Dir0/Npix12.jpg as Norder3_Dir0_Npix12.jpg)
let tiles = 0;
for (const sky of list(path.join(root, 'cache', 'hips'))) {
  if (!/^[a-z0-9]+$/.test(sky)) continue;
  for (const n of list(path.join(root, 'cache', 'hips', sky))) {
    if (n.endsWith('.tmp')) continue;
    copy(path.join(root, 'cache', 'hips', sky, n), `hips/${sky}/${n.replace(/_/g, '/')}`); tiles++;
  }
}
// 5. headers for the static files (Workers static assets read _headers)
put('_headers', Buffer.from([
  '/vendor/*', '  Cache-Control: public, max-age=31536000, immutable',
  '/hips/*', '  Cache-Control: public, max-age=2592000', '  Access-Control-Allow-Origin: *',
  '/_c/*', '  Cache-Control: public, max-age=2592000',
  ''].join('\n')));
console.log(`Made ${out}: ${files} files, ${(bytes / 1e9).toFixed(2)} GB (largest ${(biggest / 1e6).toFixed(1)} MB).`);
console.log(`  ${answers} archive answers, ${cuts} cutouts, ${tiles} sky tiles. Site: ${site}`);
if (files > 20000) console.log('WARNING: over 20,000 files: the free plan takes at most 20,000 per Worker.');
