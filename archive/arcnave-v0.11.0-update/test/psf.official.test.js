'use strict';
// ARCNAVE's PSF vs the OFFICIAL SPHEREx PSF, offline. Fixtures: test/fixtures/psf_official = the pipeline's own PSF
// (PSF extension, zone of RA 189.957 Dec -4.182, 101x101 at 10x) for 22 of the 24 demo images, fetched through
// /api/spherex/psf on 2026-10-21; the images themselves are demo-cache/. Same code as public/dev/psfcheck.html.
// Slow (about 3 minutes). Run: node test/psf.official.test.js
const assert = require('assert'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const F = require('../lib/fits.js'), C = require('../public/dev/psfcheck.js');
const PX = 6.15 / 3600, G = { ra0: 189.957, dec0: -4.182, s: PX, n: Math.round(0.5 / PX) }, FX = path.join(__dirname, 'fixtures', 'psf_official');
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex'), rows = [];
for (const f of fs.readdirSync(FX).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8')), base = j.key.split('?')[0];
  const gz = path.join(__dirname, '..', 'demo-cache', 'cutouts', sha1(`${base}?center=189.957,-4.182&size=0.5`) + '.fits.gz');
  const b = zlib.gunzipSync(fs.readFileSync(gz)), img = F.prepareCutout(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), G);
  const r = C.checkImage(F, img, j.data, G); r.id = base.split('level2_')[1].slice(0, 19); rows.push(r);
  console.log(`  ${r.id} zone ${r.zone.plane} | official FWHM ${r.offFwhmNative.toFixed(2)}" | shape: stars ${r.stars.med.toFixed(3)}, official ${r.offSample.shape.toFixed(3)}-${r.offInt.shape.toFixed(3)}, ePSF fake ${r.epsf.fake.toFixed(3)}, model fake ${r.model.fake.toFixed(3)}`);
}
const med = C.med, ratio = k => rows.reduce((s, r) => s + r[k].fake / r.stars.med, 0) / rows.length;
const ok = (v, r) => Math.abs(v - r.stars.med) < Math.max(0.1 * r.stars.med, 2.5 * r.stars.se);
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok ', name); };
t('we read the right zone: plane y*11+x agrees with the (fixed) header in every image', () => {
  assert.strictEqual(rows.length, 22); for (const r of rows) assert.strictEqual(r.zone.plane, r.headerPlane, r.id);
});
t('official PSF is as wide as SPHEREx says: FWHM 6.0-6.5" on the native pixels (header PSF_FWHM 6.61")', () => {
  const m = med(rows.map(r => r.offFwhmNative)); console.log(`     median ${m.toFixed(2)}"`);
  for (const r of rows) assert.ok(r.offFwhmNative > 6.0 && r.offFwhmNative < 6.5, r.id + ' ' + r.offFwhmNative);
});
t('real stars on our grid sit between the two readings of the official PSF (pixel-sampled sharper, pixel-averaged softer)', () => {
  const s = med(rows.map(r => r.stars.med)), a = med(rows.map(r => r.offSample.shape)), b = med(rows.map(r => r.offInt.shape));
  console.log(`     median shape: official sampled ${a.toFixed(3)} < stars ${s.toFixed(3)} < official averaged ${b.toFixed(3)}`); assert.ok(a < s && s < b);
});
t('ARCNAVE ePSF (the default) gives the same FWHM on our grid as the official PSF sent through our pipeline (within 10 %)', () => {
  const e = med(rows.map(r => r.epsf.fwhm * 6.15)), o = med(rows.map(r => r.offSample.fwhmGrid * 6.15)), o2 = med(rows.map(r => r.offInt.fwhmGrid * 6.15));
  console.log(`     ePSF ${e.toFixed(2)}", official ${o.toFixed(2)}"-${o2.toFixed(2)}"`); assert.ok(e > 0.9 * o && e < 1.1 * o2);
});
t('fakes from the ePSF look like the real stars (>= 20 of 22 images; mean ratio within 5 %); the model PSF is worse', () => {
  const ne = rows.filter(r => ok(r.epsf.fake, r)).length, re = ratio('epsf'), rm = ratio('model');
  console.log(`     ePSF ${ne}/22, mean fake/star ${re.toFixed(3)} | model ${rows.filter(r => ok(r.model.fake, r)).length}/22, ${rm.toFixed(3)}`);
  assert.ok(ne >= 20 && Math.abs(re - 1) < 0.05 && Math.abs(re - 1) < Math.abs(rm - 1));
});
t('default empiricalPSF is the ePSF', () => { const r = rows[0]; assert.ok(r); const b = fs.readdirSync(FX)[0]; assert.ok(F.empiricalPSF.toString().includes("opts.method !== 'model'")); });
console.log(`\n${pass} passed`);
