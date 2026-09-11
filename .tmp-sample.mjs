import { chromium } from 'playwright-core';
import fs from 'fs';
const OUT = process.argv[2];
const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
const log = (s) => fs.appendFileSync(OUT, s + '\n');
log('t=' + new Date().toISOString() + ' sampler started');
let n = 0;
const tick = async () => {
  n++;
  const rows = [];
  try {
    for (const ctx of b.contexts()) for (const p of ctx.pages()) {
      for (const f of p.frames()) {
        const u = f.url();
        if (!/8574|src\/editor\/index/.test(u)) continue;
        try {
          const r = await f.evaluate(() => {
            const cs = Array.from(document.querySelectorAll('canvas'));
            const mpx = cs.reduce((a, c) => a + (c.width * c.height) / 1e6, 0);
            let texN = null, rtN = null;
            try {
              const P = window.PIXI;
              if (P?.Cache?._cacheMap) texN = P.Cache._cacheMap.size;
              else if (P?.utils?.TextureCache) texN = Object.keys(P.utils.TextureCache).length;
            } catch {}
            try { rtN = window.__PIXI_APP__?.renderer?.texture?.managedTextures?.length ?? null; } catch {}
            return {
              tag: /8574/.test(location.href) ? 'PREVIEW' : 'editor',
              canvases: cs.length, mpx: +mpx.toFixed(1),
              sizes: cs.slice(0, 4).map(c => c.width + 'x' + c.height).join(','),
              imgs: document.images.length, texN, rtN,
              heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
            };
          });
          rows.push(r);
        } catch {}
      }
    }
  } catch (e) { log('ERR ' + String(e).slice(0, 80)); }
  const t = new Date().toISOString().slice(11, 19);
  rows.forEach(r => log(`${t} ${r.tag.padEnd(7)} canvas=${r.canvases} ${r.mpx}MPx [${r.sizes}] imgs=${r.imgs} tex=${r.texN} managed=${r.rtN} heap=${r.heap}MB`));
  if (n > 150) process.exit(0);
};
setInterval(tick, 2000);
b.on('disconnected', () => { log('DISCONNECTED (editor died) at ' + new Date().toISOString()); process.exit(0); });
