/**
 * Play a real game build against Engine's REAL RGS (Stake Engine's dev/staging), with a session from Engine's
 * dashboard ("Start game session"), and grade it from the wallet calls the page makes (2026-11-09).
 *
 * The emulator (lib/emulator.mjs) can force a bonus and see every call server-side; Engine cannot be forced
 * and its server-side view is not ours. So this watches the page's own requests to {rgs_url}/wallet/* and
 * /bet/* and holds the game to the contract over N real rounds:
 *   - every round with a win is ended (/wallet/end-round) before the next play, and the last one too;
 *   - no play is refused because a round was still open (ERR_BE), nor for any other reason;
 *   - a reload while a round is open finishes that round (authenticate hands it back, the game ends it);
 *   - progress is saved (/bet/event) during multi-round books.
 * The game is served from a local static server (the build is static), opened with the session URL's
 * parameters. Engine's session is play money (demo=true); nothing here asks for credentials.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return createRequire(import.meta.url)('playwright');
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };

function serveStatic(root) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.resolve(base, '.' + rel);
    if (!f.startsWith(base)) return res.writeHead(403).end();
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

/** The launch parameters of an Engine session URL (anything before the `?` is ignored). */
export function sessionParams(sessionUrl) {
  const q = new URLSearchParams(String(sessionUrl).includes('?') ? String(sessionUrl).split('?')[1] : String(sessionUrl));
  const p = Object.fromEntries(q.entries());
  if (!p.sessionID || !p.rgs_url) throw new Error('The session URL needs sessionID and rgs_url (copy it from Engine\'s "Start game session").');
  return p;
}

/**
 * @param {object} o
 * @param {string} [o.gameDir]      a built Stake frontend to serve, or
 * @param {string} [o.gameUrl]      a page already served somewhere
 * @param {string} o.sessionUrl     Engine session URL (sessionID, rgs_url, …)
 * @param {number} [o.rounds]       rounds to play (default 10)
 * @param {string} [o.spinKey] [o.spinSelector]
 * @param {number} [o.roundTimeoutMs]
 * @param {string} [o.out]
 * @param {object} [o.extraParams]
 */
export async function runEngineLive(o) {
  const { chromium } = await loadPlaywright();
  const params = { ...sessionParams(o.sessionUrl), ...(o.extraParams || {}) };
  const rgsHost = String(params.rgs_url).replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
  const rounds = o.rounds ?? 10;
  const roundTimeout = o.roundTimeoutMs ?? 60_000;
  const out = o.out ? path.resolve(o.out) : null;
  if (out) fs.mkdirSync(out, { recursive: true });

  let local = null;
  let pageUrl = o.gameUrl;
  if (!pageUrl) {
    local = await serveStatic(o.gameDir);
    pageUrl = `${local.origin}/index.html`;
  }
  const u = new URL(pageUrl);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({ headless: !o.headed, ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}) });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const calls = []; // { t, path, status, body }
  const consoleErrors = [];
  const t0 = Date.now();
  context.on('response', async (res) => {
    const url = res.url();
    if (!url.includes(rgsHost)) return;
    const p = new URL(url).pathname;
    if (!/^\/(wallet|bet)\//.test(p)) return;
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    calls.push({ t: Date.now() - t0, path: p, status: res.status(), body });
  });

  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass, detail });
  const plays = () => calls.filter((c) => c.path === '/wallet/play');
  const ends = () => calls.filter((c) => c.path === '/wallet/end-round');
  const waitFor = async (pred, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return true;
      await sleep(100);
    }
    return pred();
  };
  async function bet(page) {
    if (o.spinSelector) await page.click(o.spinSelector);
    else {
      await page.mouse.move(5, 5);
      await page.keyboard.press(o.spinKey || 'Space');
    }
  }
  /** Is the round the last play opened still waiting for its end-round? */
  const openWin = () => {
    const ps = plays();
    const last = ps[ps.length - 1];
    if (!last || last.status !== 200 || !last.body?.round?.active) return false;
    return !ends().some((e) => e.t > last.t && e.status === 200);
  };

  let page = await context.newPage();
  page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)));
  try {
    await page.goto(u.toString(), { waitUntil: 'load', timeout: 60_000 });
    const authed = await waitFor(() => calls.some((c) => c.path === '/wallet/authenticate'), 30_000);
    check('authenticates', authed && calls.find((c) => c.path === '/wallet/authenticate')?.status === 200, authed ? 'authenticate 200' : 'the game never called /wallet/authenticate (does it read sessionID and rgs_url? http vs https?)');
    if (!authed) throw new Error('stop');
    await sleep(o.settleMs ?? 2000);

    let reloaded = false;
    for (let i = 0; i < rounds; i++) {
      const before = plays().length;
      await bet(page);
      const played = await waitFor(() => plays().length > before, 15_000);
      if (!played) {
        check(`round ${i + 1}`, false, 'betting did nothing: no /wallet/play (spin key/selector, or the game is still busy)');
        break;
      }
      const p = plays()[before];
      if (p.status !== 200) {
        check(`round ${i + 1}`, false, `/wallet/play refused: ${p.body?.error || p.status} ${p.body?.message || ''}`.trim());
        break;
      }
      const r = p.body.round;
      // Once, mid-test: reload while a winning round is open — the game must finish it after the reload.
      if (!reloaded && r.active && r.payout > 0) {
        reloaded = true;
        await sleep(300);
        if (openWin()) {
          await page.close();
          page = await context.newPage();
          page.on('pageerror', (e) => consoleErrors.push(String(e.message || e)));
          await page.goto(u.toString(), { waitUntil: 'load', timeout: 60_000 });
          const resumed = await waitFor(() => !openWin(), roundTimeout);
          check('resume-after-reload', resumed, resumed ? 'the open round was finished after the reload' : 'STUCK: after a reload the open round was never ended');
          await sleep(o.settleMs ?? 2000);
          continue;
        }
      }
      const closed = await waitFor(() => !openWin(), roundTimeout);
      const label = `round ${i + 1}: ${r.payoutMultiplier}× (${Array.isArray(r.state) ? r.state.length : '?'} events)`;
      if (!closed) {
        check(label, false, `STUCK: a win of ${r.payoutMultiplier}× was never ended within ${roundTimeout / 1000}s — Stake would refuse every next bet`);
        break;
      }
      check(label, true, r.active ? 'ended' : 'closed by Stake (no win)');
      await sleep(o.betweenMs ?? 800);
    }
    if (!reloaded) check('resume-after-reload', true, 'skipped: no winning round came up to reload in');
    const refused = calls.filter((c) => c.status >= 400);
    check('no refused calls', refused.length === 0, refused.length ? refused.map((c) => `${c.path} ${c.body?.error || c.status}`).join('; ') : 'none');
  } catch (e) {
    if (String(e?.message) !== 'stop') check('run', false, String(e?.message || e));
  } finally {
    if (out && page && !page.isClosed()) await page.screenshot({ path: path.join(out, 'engine-live.png') }).catch(() => {});
    await browser.close();
    if (local) local.server.close();
  }
  if (out) fs.writeFileSync(path.join(out, 'engine-calls.json'), JSON.stringify(calls.map((c) => ({ ...c, body: c.body && c.body.round ? { ...c.body, round: { ...c.body.round, state: `<${c.body.round.state?.length} events>` } } : c.body })), null, 2));
  return { ok: results.every((r) => r.pass), scenarios: results, consoleErrors, calls: calls.length };
}
