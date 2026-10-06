import { chromium } from 'playwright-core';
const OUT = process.argv[2];
const fs = await import('fs');
const log = (s) => fs.appendFileSync(OUT, `${new Date().toISOString()} ${s}\n`);
const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
log('connected');
for (const ctx of b.contexts()) {
  for (const p of ctx.pages()) {
    const u = p.url().slice(0, 70);
    p.on('console', (m) => { if (/error|warn/i.test(m.type())) log(`[console.${m.type()}] ${u} :: ${m.text().slice(0, 300)}`); });
    p.on('pageerror', (e) => log(`[pageerror] ${u} :: ${String(e && e.message).slice(0, 300)}`));
    p.on('crash', () => log(`[CRASH] ${u}`));
    p.on('close', () => log(`[closed] ${u}`));
  }
}
b.on('disconnected', () => { log('[disconnected — editor died]'); process.exit(0); });
setInterval(() => {}, 1 << 30);
