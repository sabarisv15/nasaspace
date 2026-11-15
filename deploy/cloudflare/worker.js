// ARCNAVE on Cloudflare, free plan, no card, always on (docs/deploy/DEPLOY-CLOUDFLARE.md). Static files (the pages, the team PC's
// cache of archive answers, cutouts and sky tiles) are served by Cloudflare directly, without this Worker. It runs only for:
//   /_p?u=<url>&t=<s>  the archive proxy for public/edge-api.js (the archives send no CORS headers). Only the archives
//                      ARCNAVE uses; GET replies are kept at Cloudflare's edge for t seconds, so the next visitor gets them
//                      at once. Light on CPU: the reply is streamed, never parsed here (the free plan allows 10 ms a request).
//   /hips/...          a sky tile the PC did not have: from the first mirror that answers (as server.js hipsTile), kept 30 days
//   /api/neossat/preview  a NEOSSat preview picture (an <img>, so not through edge-api.js): the PC's copy, else CADC
const UA = 'ARCNAVE/0.57 (educational sky viewer; Cloudflare)';
const HOSTS = new Set(['irsa.ipac.caltech.edu', 'cds.unistra.fr', 'ned.ipac.caltech.edu', 'nasa-irsa-spherex.s3.us-east-1.amazonaws.com',
  'vizier.cds.unistra.fr', 'mast.stsci.edu', 'ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca', 'ws-cadc.canfar.net', 'ssp.imcce.fr',
  'minorplanetcenter.net', 'ssd.jpl.nasa.gov']);
const HIPS = {
  '2mass': ['https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color', 'https://casda.csiro.au/hips/2MASS/Color', 'https://hips.china-vo.org/m/CDS_P_2MASS_color', 'https://alasky.cds.unistra.fr/2MASS/Color', 'https://alasky.u-strasbg.fr/2MASS/Color'],
  'allwise': ['https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1', 'https://hips.china-vo.org/m/CDS_P_allWISE_color', 'https://alasky.cds.unistra.fr/AllWISE/RGB-W4-W2-W1', 'https://alasky.u-strasbg.fr/AllWISE/RGB-W4-W2-W1'],
  'dss2': ['https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color', 'https://hips.china-vo.org/m/CDS_P_DSS2_color', 'https://alasky.cds.unistra.fr/DSS/DSSColor', 'https://alasky.u-strasbg.fr/DSS/DSSColor'],
};
const SPX_HIPS = 'https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube';
const spxFrame = sky => { const m = /^sphx(\d{1,3})$/.exec(sky); const f = m ? +m[1] : -1; return f >= 0 && f < 102 && f !== 50 && f !== 51 ? f : null; };
const MAX_TTL = 30 * 86400;

const text = (s, status, extra) => new Response(s, { status, headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, extra) });

async function edgeCached(ctx, key, ttl, make) {
  const hit = await caches.default.match(key);
  if (hit) { const r = new Response(hit.body, hit); r.headers.set('X-Arcnave-Edge', 'HIT'); return r; }
  const res = await make();
  if (res.status === 200 && ttl > 0) {
    const keep = new Response(res.clone().body, res);
    keep.headers.set('Cache-Control', `public, max-age=${ttl}`);
    keep.headers.delete('Set-Cookie');
    ctx.waitUntil(caches.default.put(key, keep));
  }
  const out = new Response(res.body, res); out.headers.set('X-Arcnave-Edge', 'MISS');
  return out;
}

async function proxy(request, url, ctx) {
  let target;
  try { target = new URL(url.searchParams.get('u') || ''); } catch { return text('Bad address', 400); }
  if (target.protocol !== 'https:' || !HOSTS.has(target.hostname)) return text('Not an archive ARCNAVE uses', 403);
  const ttl = Math.max(0, Math.min(MAX_TTL, +url.searchParams.get('t') || 0));
  const go = async () => {
    const init = { method: request.method === 'POST' ? 'POST' : 'GET', headers: { 'User-Agent': UA } };
    if (init.method === 'POST') { init.body = await request.arrayBuffer(); const ct = request.headers.get('Content-Type'); if (ct) init.headers['Content-Type'] = ct; }
    let r;
    init.signal = AbortSignal.timeout(170000);   // the longest the page waits for any archive (IRSA's cutout service)
    try { r = await fetch(target.toString(), init); }
    catch (e) { return text('The archive did not answer: ' + String(e && e.message || e).slice(0, 120), 504); }
    const h = new Headers({ 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
    return new Response(r.body, { status: r.status, headers: h });
  };
  if (request.method !== 'GET' || !ttl) return go();
  // the edge key is the archive address itself, so every visitor (and every page) shares one copy
  return edgeCached(ctx, new Request('https://arcnave-edge.invalid/p/' + encodeURIComponent(target.toString())), ttl, go);
}

async function hipsTile(url, ctx) {
  const m = /^\/hips\/([a-z0-9]+)\/((?:properties|Moc\.fits|Norder\d{1,2}\/Allsky\.(?:jpg|png)|Norder\d{1,2}\/Dir\d{1,7}\/Npix\d{1,10}\.(?:jpg|png)))$/.exec(url.pathname);
  const spx = m ? spxFrame(m[1]) : null;
  if (!m || (!HIPS[m[1]] && spx === null) || (spx !== null && (/\.jpg$/.test(m[2]) || m[2] === 'Moc.fits'))) return text('Not a sky tile', 404);
  const [, sky, rel] = m;
  const upRel = spx === null || rel === 'properties' || rel === 'Moc.fits' ? rel : rel.replace(/(Npix\d+|Allsky)\.png$/, `$1${spx ? '_' + spx : ''}.png`);
  const type = rel === 'properties' ? 'text/plain; charset=utf-8' : rel.endsWith('.png') ? 'image/png' : rel.endsWith('.fits') ? 'application/fits' : 'image/jpeg';
  return edgeCached(ctx, new Request('https://arcnave-edge.invalid/hips/' + sky + '/' + rel), MAX_TTL, async () => {
    for (const base of spx === null ? HIPS[sky] : [SPX_HIPS]) {
      let r;
      try { r = await fetch(base + '/' + upRel, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) }); } catch { continue; }
      if (r.status === 404) return text('No such tile', 404, { 'Access-Control-Allow-Origin': '*' });   // missing everywhere (empty sky)
      if (!r.ok) continue;
      let body = r.body;
      if (rel === 'properties') {
        let t = await r.text();
        if (!/hips_/.test(t.slice(0, 4000))) continue;
        if (spx !== null) {   // one frame of the cube = an ordinary picture HiPS (as server.js does)
          const keep = /^(hips_initial_fov|hips_version|hips_release_date|hips_frame|hips_order|hips_order_min|hips_tile_width|hips_status|hips_tile_format|hips_pixel_scale|obs_regime|hips_creator|hips_copyright|obs_copyright|obs_collection|t_min|t_max)\s*=/;
          const wl = (/^data_cube_crval3_arr\s*=\s*(.+)$/m.exec(t) || [])[1], lam = wl ? +wl.trim().split(/\s+/)[spx] : null;
          t = t.split('\n').filter(l => keep.test(l)).join('\n') + `\ndataproduct_type     = image\ndataproduct_subtype  = color\nobs_title            = SPHEREx DR1 all-sky, frame ${spx}${lam ? ` (${lam} um)` : ''}\n`;
        }
        body = t;
      }
      return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'X-Arcnave-From': new URL(base).hostname } });
    }
    return text('No mirror answered', 502, { 'Access-Control-Allow-Origin': '*' });
  });
}

async function neossatPreview(url, env, ctx) {
  const id = String(url.searchParams.get('id') || ''), small = url.searchParams.get('s') === '256';
  if (!/^\d{13}$/.test(id)) return text('id must be a 13-digit NEOSSat observation id', 400);
  const name = `${id}_raw_prev${small ? '_256' : ''}.png`;
  const own = await env.ASSETS.fetch(new Request(new URL('/_c/neossat/' + name, url.origin)));
  if (own.ok) return own;
  return edgeCached(ctx, new Request('https://arcnave-edge.invalid/neossat/' + name), MAX_TTL, async () => {
    const r = await fetch('https://ws-cadc.canfar.net/minoc/files/cadc:NEOSSAT/' + name, { headers: { 'User-Agent': UA } });
    if (!r.ok || !/png/i.test(r.headers.get('Content-Type') || 'png')) return text('CADC sent no picture for this frame', 502);
    return new Response(r.body, { status: 200, headers: { 'Content-Type': 'image/png' } });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/_p') return proxy(request, url, ctx);
    if (request.method !== 'GET' && request.method !== 'HEAD') return text('Method not allowed', 405);
    if (url.pathname.startsWith('/hips/')) return hipsTile(url, ctx);
    if (url.pathname === '/api/neossat/preview') return neossatPreview(url, env, ctx);
    if (url.pathname.startsWith('/_c/')) return text('Not in the saved data', 404);   // edge-api.js then asks the archive
    if (url.pathname.startsWith('/api/')) return new Response(JSON.stringify({ error: 'No such endpoint' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return env.ASSETS.fetch(request);
  }
};
