'use strict';
// Discovery card: encode the GIF off the main thread so the page never freezes (v0.15).
importScripts('/gif.js');
onmessage = e => {
  try { const out = SkyGif.encode(e.data); postMessage(out, [out.buffer]); }
  catch (err) { postMessage({ err: String(err && err.message || err) }); }
};
