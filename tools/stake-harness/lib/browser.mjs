/**
 * Play a real game build in headless Chromium against the emulator, and grade it from what the
 * emulator saw — never from what the game claims.
 *
 * Game-agnostic on purpose: it only knows the launch URL Stake builds
 * (?sessionID&rgs_url&lang&currency&device&social, or the replay form) and how to place a bet —
 * Space by default, because Stake's approval requires the spacebar to bet. Everything else is read
 * off the emulator's transcript: did the game authenticate, play, save progress, end the round,
 * resume after a reload, stay off the wallet in replay. A "stuck bonus" is a winning round still
 * active when the timeout runs out.
 *
 * Screenshots of every scenario go to `out` so an agent (or a person) can look at what the game
 * showed, which this harness cannot judge: whether the win counter reached the payout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** The repo's playwright, or the machine's (require honours NODE_PATH; ESM import does not). */
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return createRequire(import.meta.url)('playwright');
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function harness(origin) {
  return (await fetch(`${origin}/__harness/state`)).json();
}
async function force(origin, f) {
  await fetch(`${origin}/__harness/force`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
}
async function classes(origin, mode) {
  return (await fetch(`${origin}/__harness/classes?mode=${encodeURIComponent(mode)}`)).json();
}
const callsOf = (st, sid) => st.transcript.filter((e) => e.sessionID === sid);

async function waitFor(origin, pred, timeoutMs, everyMs = 150) {
  const end = Date.now() + timeoutMs;
  let st;
  while (Date.now() < end) {
    st = await harness(origin);
    const v = pred(st);
    if (v) return { ok: true, st, v };
    await sleep(everyMs);
  }
  return { ok: false, st: st ?? (await harness(origin)) };
}

/**
 * @param {object} emu  running emulator (lib/emulator.mjs), its `origin` reachable by the browser
 * @param {object} pkg  loaded package
 * @param {object} o
 * @param {string} o.gameUrl          page URL of the game (e.g. `${emu.origin}/game/index.html`)
 * @param {string} [o.spinKey]        key that bets (default Space)
 * @param {string} [o.spinSelector]   or a selector to click instead
 * @param {string[]} [o.buySteps]     selectors clicked in order to buy the feature (e.g. "#buy", "#confirm-yes")
 * @param {string} [o.buyMode]        mode those steps buy (default: the first non-base mode)
 * @param {string} [o.replaySelector] selector that starts a replay (if the game needs a click)
 * @param {number} [o.settleMs]       wait after authenticate before betting (default 1500)
 * @param {number} [o.roundTimeoutMs] how long a round may take before it counts as stuck (default 60000)
 * @param {string} [o.out]            directory for screenshots and the transcript
 * @param {object} [o.extraParams]    added to every launch URL (e.g. {bug: 'no-end-round'} for the reference game)
 * @param {boolean} [o.headed]
 */
export async function runBrowser(emu, pkg, o) {
  const { chromium } = await loadPlaywright();
  const origin = emu.controlOrigin ?? emu.origin; // the harness's own calls; the game uses emu.origin
  const settle = o.settleMs ?? 1500;
  const roundTimeout = o.roundTimeoutMs ?? 60_000;
  const out = o.out ? path.resolve(o.out) : null;
  if (out) fs.mkdirSync(out, { recursive: true });
  const base = pkg.modes.find((m) => m.cost === 1) || pkg.modes[0];
  const buyMode = o.buyMode || pkg.modes.find((m) => m !== base)?.name || null;
  const baseClasses = await classes(origin, base.name);

  const browser = await chromium.launch({ headless: !o.headed });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const results = [];
  const consoleErrors = [];

  async function open(name, params) {
    const page = await context.newPage();
    page.on('pageerror', (e) => consoleErrors.push({ scenario: name, text: String(e.message || e) }));
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push({ scenario: name, text: m.text().slice(0, 300) }));
    await page.goto(emu.launchUrl(o.gameUrl, { ...(o.extraParams || {}), ...params }), { waitUntil: 'load', timeout: 60_000 });
    return page;
  }
  async function shot(page, name) {
    if (out && page && !page.isClosed()) await page.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {});
  }
  async function bet(page) {
    if (o.spinSelector) await page.click(o.spinSelector);
    else {
      await page.mouse.move(5, 5);
      await page.keyboard.press(o.spinKey || 'Space');
    }
  }
  async function authenticated(sid, times = 1) {
    const r = await waitFor(origin, (st) => callsOf(st, sid).filter((c) => c.call === '/wallet/authenticate').length >= times, 30_000);
    if (!r.ok) throw new Error(`the game never called /wallet/authenticate${times > 1 ? ' again after the reload' : ''} (does it read sessionID and rgs_url from the URL? http vs https?)`);
    await sleep(settle);
  }
  async function played(sid, before = 0) {
    const r = await waitFor(origin, (st) => callsOf(st, sid).filter((c) => c.call === '/wallet/play').length > before, 10_000);
    if (!r.ok) throw new Error('betting did nothing: no /wallet/play (wrong spin key/selector, or the game was not ready)');
    const plays = callsOf(r.st, sid).filter((c) => c.call === '/wallet/play');
    const p = plays[before];
    if (p.status !== 200) throw new Error(`/wallet/play was refused: ${p.error} (${p.req?.mode ? `mode ${p.req.mode}, ` : ''}amount ${p.req?.amount})`);
    return p;
  }
  /** The round is over when the session has no active round. */
  async function closed(sid, what) {
    const r = await waitFor(origin, (st) => !st.openRounds.some((x) => x.sessionID === sid), roundTimeout, 250);
    if (!r.ok) {
      const open = r.st.openRounds.find((x) => x.sessionID === sid);
      throw new Error(`STUCK: ${what} still active after ${roundTimeout / 1000}s — the game never called /wallet/end-round (book ${open?.bookId}, ${open?.rounds} rounds, last saved event ${JSON.stringify(open?.event)}). On Stake the win is not paid and every next bet is refused.`);
    }
    return r.st;
  }
  function breaches(st, sid) {
    return st.violations.filter((v) => v.sessionID === sid);
  }

  async function scenario(name, fn) {
    const sid = `br-${name}-${Date.now() % 1e6}`;
    let page = null;
    const ctx = { sid, setPage: (p) => (page = p) };
    try {
      const detail = await fn(ctx);
      const st = await harness(origin);
      const b = breaches(st, sid);
      if (b.length) throw new Error(`contract breaches: ${b.map((v) => `${v.code} (${v.message})`).join('; ')}`);
      results.push({ name, pass: true, detail: detail || '' });
    } catch (e) {
      results.push({ name, pass: false, detail: String(e.message || e) });
    } finally {
      await shot(page, name);
      if (page) await page.close().catch(() => {});
    }
  }

  await scenario('loads-and-authenticates', async ({ sid, setPage }) => {
    setPage(await open('load', { sessionID: sid }));
    await authenticated(sid);
    return 'authenticated';
  });

  await scenario('loss', async ({ sid, setPage }) => {
    if (!baseClasses.loss.length) return 'skipped: no losing book';
    await force(origin, { mode: base.name, kind: 'loss', sessionID: sid });
    const page = await open('loss', { sessionID: sid });
    setPage(page);
    await authenticated(sid);
    await bet(page);
    await played(sid);
    await sleep(1500);
    await closed(sid, 'losing round');
    return 'lost, round closed';
  });

  await scenario('single-win', async ({ sid, setPage }) => {
    if (!baseClasses.single.length) return 'skipped: no single-round win';
    await force(origin, { mode: base.name, kind: 'single', sessionID: sid });
    const page = await open('win', { sessionID: sid });
    setPage(page);
    await authenticated(sid);
    await bet(page);
    const p = await played(sid);
    await closed(sid, `winning round (book ${p.round?.bookId})`);
    return `won, ended (book ${p.round?.bookId})`;
  });

  await scenario('base-bonus', async ({ sid, setPage }) => {
    if (!baseClasses.featureWin.length) throw new Error(`mode ${base.name} has no winning multi-round book to force: the base game cannot reach its bonus`);
    await force(origin, { mode: base.name, kind: 'featureWin', sessionID: sid });
    const page = await open('bonus', { sessionID: sid });
    setPage(page);
    await authenticated(sid);
    await bet(page);
    const p = await played(sid);
    const st = await closed(sid, `bonus (book ${p.round?.bookId}, ${p.round?.rounds} rounds)`);
    const saves = callsOf(st, sid).filter((c) => c.call === '/bet/event').length;
    if (saves === 0) throw new Error(`the bonus finished but the game never saved progress with /bet/event: a reload mid-bonus restarts it from the first spin`);
    return `bonus of ${p.round?.rounds} rounds played and ended, ${saves} progress saves`;
  });

  await scenario('resume-after-reload', async ({ sid, setPage }) => {
    if (!baseClasses.featureWin.length) throw new Error('no bonus book to resume');
    await force(origin, { mode: base.name, kind: 'featureWin', sessionID: sid });
    let page = await open('resume', { sessionID: sid });
    setPage(page);
    await authenticated(sid);
    await bet(page);
    const p = await played(sid);
    // Leave mid-bonus: once the game has saved progress a few spins in, or after 2s if it saves none.
    const want = Math.max(1, Math.min(3, Math.floor((p.round?.rounds ?? 2) / 2)));
    await waitFor(origin, (st) => callsOf(st, sid).filter((c) => c.call === '/bet/event').length >= want, 2000, 50);
    await page.close();
    const mid = await harness(origin);
    const stillOpen = mid.openRounds.find((x) => x.sessionID === sid);
    if (!stillOpen) return `the game finished the ${p.round?.rounds}-round bonus before the reload; nothing to resume (slow it down to test resume)`;
    page = await open('resume-2', { sessionID: sid });
    setPage(page);
    await authenticated(sid, 2);
    await closed(sid, `bonus after a reload (resumed from event ${JSON.stringify(stillOpen.event)})`);
    return `reloaded at saved event ${JSON.stringify(stillOpen.event)}, resumed and ended`;
  });

  if (o.buySteps && o.buySteps.length && buyMode) {
    await scenario(`buy:${buyMode}`, async ({ sid, setPage }) => {
      const c = await classes(origin, buyMode);
      if (c.featureWin.length) await force(origin, { mode: buyMode, kind: 'featureWin', sessionID: sid });
      const page = await open('buy', { sessionID: sid });
      setPage(page);
      await authenticated(sid);
      for (const s of o.buySteps) {
        await page.click(s);
        await sleep(300);
      }
      const p = await played(sid);
      if (String(p.req?.mode).toLowerCase() !== buyMode.toLowerCase()) throw new Error(`the buy played mode "${p.req?.mode}", expected "${buyMode}"`);
      await closed(sid, `bought bonus (book ${p.round?.bookId})`);
      return `bought ${buyMode}, ${p.round?.rounds} rounds, ended`;
    });
  } else {
    results.push({ name: 'buy', pass: true, detail: 'skipped: no --buy-steps given (a buy needs game-specific clicks)' });
  }

  await scenario('replay', async ({ setPage }) => {
    const id = baseClasses.featureWin[0] ?? baseClasses.win[0];
    if (id === undefined) return 'skipped: no book';
    const before = (await harness(origin)).transcript.length;
    const page = await open('replay', { sessionID: null, replay: 'true', game: 'local', version: '1', mode: base.name, event: id, amount: 1_000_000 });
    setPage(page);
    const got = await waitFor(origin, (st) => st.transcript.slice(before).some((c) => c.call === 'GET /bet/replay'), 15_000);
    if (!got.ok) throw new Error('replay mode never fetched GET /bet/replay/{game}/{version}/{mode}/{event} (replay is mandatory for approval)');
    await sleep(settle);
    if (o.replaySelector) await page.click(o.replaySelector).catch(() => {});
    await sleep(Math.min(roundTimeout, 5000));
    const st = await harness(origin);
    const wallet = st.transcript.slice(before).filter((c) => c.call !== 'GET /bet/replay');
    if (wallet.length) throw new Error(`replay mode called the wallet: ${[...new Set(wallet.map((c) => c.call))].join(', ')} (replay must make no session calls)`);
    return `replayed book ${id} with no wallet calls`;
  });

  await browser.close();
  if (out) fs.writeFileSync(path.join(out, 'transcript.json'), JSON.stringify(await harness(origin), null, 2));
  return { ok: results.every((r) => r.pass), scenarios: results, consoleErrors };
}
