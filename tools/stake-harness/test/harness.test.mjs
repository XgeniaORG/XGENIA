/**
 * The harness grades games, so it must itself be shown to fail what it claims to catch. Every
 * defect we found in XGENIA's Stake path (2026-11-09) is injected here once — into the maths
 * (fixture flavours) or into the frontend (reference-game ?bug=) — and must turn a check red.
 * A check that stays green on its defect is the silent success this repo keeps paying for.
 *
 *   node --test tools/stake-harness/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writePackage, loadPackage } from '../lib/package.mjs';
import { makeFixtureModes } from '../lib/fixture.mjs';
import { validatePackage } from '../lib/validate.mjs';
import { createEmulator } from '../lib/emulator.mjs';
import { runBot } from '../lib/bot.mjs';
import { rebalanceRows } from '../lib/rebalance.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stake-harness-test-'));
const SMALL = { baseBooks: 6000, bonusBooks: 400 };
const fixtures = new Map();
function fixture(flavour) {
  if (!fixtures.has(flavour)) {
    const dir = path.join(TMP, flavour);
    writePackage(dir, makeFixtureModes({ ...SMALL, flavour }));
    fixtures.set(flavour, dir);
  }
  return fixtures.get(flavour);
}
const codes = (r) => r.errors.map((e) => e.code);

test('a correct package passes Stake checks and the bonus checks', () => {
  const r = validatePackage(fixture('standard'));
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
  const base = r.modes.find((m) => m.mode === 'base');
  assert.ok(base.featureBooks > 0);
  assert.ok(Math.abs(base.rtp - 0.963) < 1e-4, `base RTP ${base.rtp}`);
});

for (const [flavour, code] of [
  ['drop-free-spins', 'BASE_NEVER_TRIGGERS_FEATURE'],
  ['buy-single-round', 'BUY_NOT_IN_FEATURE'],
  ['index-1based', 'EVENT_INDEX'],
  ['finalwin-mismatch', 'FINALWIN_MISMATCH'],
  ['off-grid', 'PAYOUT_GRID'],
  ['raw-weights', 'RTP_OUT_OF_BAND'],
]) {
  test(`validator fails ${flavour} with ${code}`, () => {
    const r = validatePackage(fixture(flavour));
    assert.equal(r.ok, false);
    assert.ok(codes(r).includes(code), `expected ${code}, got ${codes(r).join(', ') || 'no error'}`);
  });
}

test('a base-only export that lost its free spins fails with --expect-feature', () => {
  const dir = path.join(TMP, 'base-only-dropped');
  const modes = makeFixtureModes({ ...SMALL, flavour: 'drop-free-spins' }).filter((m) => m.name === 'base');
  writePackage(dir, modes);
  assert.equal(validatePackage(dir).ok, true, 'without the flag nothing can tell the bonus exists');
  assert.ok(codes(validatePackage(dir, { expectFeature: true })).includes('BASE_NEVER_TRIGGERS_FEATURE'));
});

test('XRGS-dialect books ending on finalWin still show their bonus rounds', () => {
  const r = validatePackage(fixture('xrgs'), { expectFeature: true });
  const base = r.modes.find((m) => m.mode === 'base');
  assert.ok(base.featureBooks > 0, 'feature books not detected');
  assert.ok(base.dialects.xrgs > 0 && !base.dialects.custom, JSON.stringify(base.dialects));
  assert.ok(!codes(r).includes('BASE_NEVER_TRIGGERS_FEATURE'));
});

test('XRGS-dialect books are flagged (warning by default, error with --strict)', () => {
  const loose = validatePackage(fixture('xrgs'));
  assert.ok(loose.warnings.some((w) => w.code === 'EVENTS_XRGS_DIALECT'));
  const strict = validatePackage(fixture('xrgs'), { requireStandard: true });
  assert.ok(codes(strict).includes('EVENTS_XRGS_DIALECT'));
});

test('an unreadable package fails, it never passes with nothing checked', () => {
  const empty = path.join(TMP, 'empty');
  fs.mkdirSync(empty, { recursive: true });
  const r = validatePackage(empty);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('INDEX_MISSING'));
});

test('rebalance lands RTP on target', () => {
  const rows = [0, 0, 0, 20, 50, 100, 500, 2000].map((p, i) => ({ id: i + 1, weight: 1n, payout: p }));
  const r = rebalanceRows(rows, 1, 0.963);
  assert.ok(Math.abs(r.achieved - 0.963) < 1e-6, String(r.achieved));
  assert.throws(() => rebalanceRows([{ id: 1, weight: 1n, payout: 0 }], 1, 0.963));
});

async function withEmulator(flavour, fn, opts = {}) {
  const pkg = loadPackage(fixture(flavour));
  const emu = await createEmulator(pkg, opts).listen();
  try {
    return await fn(emu, pkg);
  } finally {
    await emu.close();
  }
}

test('emulator: a winning round stays active and unpaid until end-round; a second play is refused', async () => {
  await withEmulator('standard', async (emu) => {
    const post = async (p, b) => {
      const r = await fetch(emu.origin + p, { method: 'POST', body: JSON.stringify(b) });
      return { status: r.status, json: await r.json() };
    };
    await post('/wallet/authenticate', { sessionID: 's' });
    await post('/__harness/force', { mode: 'base', kind: 'featureWin' });
    const play = await post('/wallet/play', { sessionID: 's', amount: 1_000_000, mode: 'BASE' });
    assert.equal(play.status, 200);
    assert.equal(play.json.round.active, true);
    assert.equal(play.json.balance.amount, 1000 * 1e6 - 1e6, 'win must not be credited before end-round');
    const again = await post('/wallet/play', { sessionID: 's', amount: 1_000_000, mode: 'base' });
    assert.equal(again.json.error, 'ERR_BE');
    await post('/bet/event', { sessionID: 's', event: '3' });
    const auth = await post('/wallet/authenticate', { sessionID: 's' });
    assert.equal(auth.json.round.active, true);
    assert.equal(auth.json.round.event, '3');
    const end = await post('/wallet/end-round', { sessionID: 's' });
    assert.equal(end.json.balance.amount, 1000 * 1e6 - 1e6 + play.json.round.payout);
  });
});

test('emulator refuses end-round before minimumRoundDuration', async () => {
  await withEmulator('standard', async (emu) => {
    const post = (p, b) => fetch(emu.origin + p, { method: 'POST', body: JSON.stringify(b) }).then((r) => r.json());
    await post('/wallet/authenticate', { sessionID: 's' });
    await post('/__harness/force', { mode: 'base', kind: 'win' });
    await post('/wallet/play', { sessionID: 's', amount: 1_000_000, mode: 'base' });
    const end = await post('/wallet/end-round', { sessionID: 's' });
    assert.equal(end.error, 'ERR_VAL');
    const st = await (await fetch(emu.origin + '/__harness/state')).json();
    assert.ok(st.violations.some((v) => v.code === 'END_ROUND_TOO_EARLY'));
  }, { minRoundMs: 60_000 });
});

test('bot passes a correct package', async () => {
  await withEmulator('standard', async (emu, pkg) => {
    const r = await runBot(emu.origin, pkg, { soak: 50 });
    assert.equal(r.ok, true, JSON.stringify(r.scenarios.filter((s) => !s.pass), null, 2));
  });
});

for (const [flavour, scenario] of [
  ['drop-free-spins', 'base-bonus'],
  ['index-1based', 'resume-mid-bonus'],
]) {
  test(`bot fails ${flavour} at ${scenario}`, async () => {
    await withEmulator(flavour, async (emu, pkg) => {
      const r = await runBot(emu.origin, pkg, { soak: 0 });
      const s = r.scenarios.find((x) => x.name === scenario);
      assert.equal(s.pass, false, `${scenario} passed on ${flavour}`);
    });
  });
}

// ── browser: needs Playwright's Chromium ────────────────────────────────────────────────────────
let havePlaywright = true;
try {
  createRequire(import.meta.url)('playwright');
} catch {
  try {
    await import('playwright');
  } catch {
    havePlaywright = false;
  }
}

async function browse(bug) {
  const { runBrowser } = await import('../lib/browser.mjs');
  return withEmulator('standard', (emu, pkg) =>
    runBrowser(emu, pkg, {
      gameUrl: `${emu.origin}/reference/index.html`,
      buySteps: ['#buy', '#confirm-yes'],
      replaySelector: '#replay-play',
      settleMs: 300,
      roundTimeoutMs: 6000,
      extraParams: { step: 10, ...(bug ? { bug } : {}) },
    }),
  );
}

test('browser: the reference game passes', { skip: !havePlaywright && 'playwright not installed', timeout: 180_000 }, async () => {
  const r = await browse(null);
  assert.equal(r.ok, true, JSON.stringify(r.scenarios.filter((s) => !s.pass), null, 2));
});

for (const [bug, scenario] of [
  ['no-end-round', 'base-bonus'],
  ['end-early', 'base-bonus'],
  ['no-resume', 'resume-after-reload'],
  ['replay-wallet', 'replay'],
  ['spin-per-round', 'base-bonus'],
]) {
  test(`browser: catches ?bug=${bug} at ${scenario}`, { skip: !havePlaywright && 'playwright not installed', timeout: 180_000 }, async () => {
    const r = await browse(bug);
    const s = r.scenarios.find((x) => x.name === scenario);
    assert.ok(s, `no scenario ${scenario}`);
    assert.equal(s.pass, false, `${scenario} passed with bug ${bug}`);
  });
}
