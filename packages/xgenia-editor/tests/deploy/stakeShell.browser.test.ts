/**
 * The Stake shell's script (utils/stake/stakeShell.ts STAKE_SHELL_JS) in a real browser: a stand-in game page with
 * a Spin button stamped as the runtime stamps it, money words, and an AudioContext — served the way a Stake build is.
 * Needs Playwright's Chromium; skipped (not passed) when it is not installed.
 *
 *   npx tsx --test tests/deploy/stakeShell.browser.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { STAKE_SHELL_JS, injectStakeShell, stakeShellData } from '../../src/editor/src/utils/stake/stakeShell';

const require = createRequire(import.meta.url);
let chromium: any = null;
try {
  chromium = require('playwright').chromium;
} catch {
  chromium = null;
}

const GAME = injectStakeShell(`<!doctype html><html><head><meta charset="utf-8"><title>Sweet Swirl</title></head><body style="margin:0;background:#222;color:#fff">
<div data-xgenia-node-id="spin1"><button id="spin" onclick="window.spins=(window.spins||0)+1">SPIN</button></div>
<p id="bet">BET 1.00</p><p id="pays">Pays left to right</p><input id="amount" placeholder="Bet amount">
<script>window.ctx = new AudioContext();</script>
</body></html>`);
const DATA = stakeShellData({
  game: 'Sweet Swirl',
  modes: [{ name: 'base', label: 'Base game', cost: 1, rtp: 0.9641, maxWin: 330 }, { name: 'bonus', label: 'Bonus buy', cost: 100, rtp: 0.9622, maxWin: 5000 }],
  summary: { freeSpins: 'library', betModes: true },
  spinNodeIds: ['spin1']
});

async function serve(): Promise<{ origin: string; close: () => Promise<void> }> {
  const files: Record<string, [string, string]> = {
    '/index.html': [GAME, 'text/html'],
    '/stake-shell.js': [STAKE_SHELL_JS, 'text/javascript'],
    '/stake-shell.json': [JSON.stringify(DATA), 'application/json']
  };
  const server = http.createServer((req, res) => {
    const f = files[(req.url || '').split('?')[0]];
    if (!f) return void res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': f[1] }).end(f[0]);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

test('the Stake shell in a browser: rules screen, spacebar, confirmation, sound, social wording', { skip: !chromium && 'Playwright Chromium not installed' }, async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(srv.origin + '/index.html?sessionID=x&rgs_url=127.0.0.1');
    await page.evaluate(() => (window as any).__xgeniaStakeShell.ready);

    // Rules screen: the measured numbers of the uploaded books and the disclaimer.
    await page.click('[data-xg-stake=info]');
    const rules = await page.textContent('[data-xg-stake=rules]');
    assert.match(rules!, /Sweet Swirl — rules/);
    assert.match(rules!, /Bonus buy.*100× bet.*96\.22%.*5,000×/s);
    assert.match(rules!, /Malfunction voids all wins and plays/);
    await page.keyboard.press('Space'); // no bet while the rules are open
    assert.equal(await page.evaluate(() => (window as any).spins || 0), 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.$('[data-xg-stake=rules]'), null);

    // Spacebar presses Spin; not while typing in a field.
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => (window as any).spins), 1);
    await page.focus('#amount');
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => (window as any).spins), 1);
    await page.click('#bet');

    // Confirmation before a mode over 2×: Cancel → false, Buy → true; 1× modes are never asked.
    assert.equal(await page.evaluate(() => (window as any).__xgeniaStakeShell.confirmMode({ mode: 'base', cost: 1, bet: 1 })), true);
    const asked = page.evaluate(() => (window as any).__xgeniaStakeShell.confirmMode({ mode: 'bonus', cost: 100, bet: 1 }));
    await page.waitForSelector('[data-xg-stake=confirm]');
    assert.match((await page.textContent('[data-xg-stake=confirm]'))!, /Bonus buy.*100× your bet/s);
    await page.click('[data-xg-stake=cancel]');
    assert.equal(await asked, false);
    const again = page.evaluate(() => (window as any).__xgeniaStakeShell.confirmMode({ mode: 'bonus', cost: 100, bet: 1 }));
    await page.click('[data-xg-stake=confirm-yes]');
    assert.equal(await again, true);

    // Sound: one toggle suspends every AudioContext the game made, and is remembered.
    await page.click('[data-xg-stake=sound]');
    assert.equal(await page.evaluate(() => (window as any).__xgeniaStakeShell.isMuted()), true);
    await page.waitForFunction(() => (window as any).ctx.state === 'suspended');
    await page.reload();
    await page.evaluate(() => (window as any).__xgeniaStakeShell.ready);
    assert.equal(await page.evaluate(() => (window as any).__xgeniaStakeShell.isMuted()), true);
    assert.equal(await page.getAttribute('[data-xg-stake=sound]', 'aria-label'), 'Sound off');

    // Not social: the game's words stay as they are.
    assert.equal(await page.textContent('#bet'), 'BET 1.00');

    // Social (Stake.US): money words swapped on the page, in later text too, case kept.
    await page.goto(srv.origin + '/index.html?sessionID=x&rgs_url=127.0.0.1&social=true');
    await page.evaluate(() => (window as any).__xgeniaStakeShell.ready);
    assert.equal(await page.textContent('#bet'), 'PLAY 1.00');
    assert.equal(await page.textContent('#pays'), 'Wins left to right');
    assert.equal(await page.getAttribute('#amount', 'placeholder'), 'Play amount');
    await page.evaluate(() => { const p = document.createElement('p'); p.id = 'late'; p.textContent = 'You were paid 5.00'; document.body.appendChild(p); });
    await page.waitForFunction(() => document.getElementById('late')!.textContent === 'You were awarded 5.00');
    const asked2 = page.evaluate(() => (window as any).__xgeniaStakeShell.confirmMode({ mode: 'bonus', cost: 100, bet: 1 }));
    await page.waitForSelector('[data-xg-stake=confirm]');
    assert.match((await page.textContent('[data-xg-stake=confirm]'))!, /Play it\?/);
    await page.click('[data-xg-stake=cancel]');
    await asked2;

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await srv.close();
  }
});
