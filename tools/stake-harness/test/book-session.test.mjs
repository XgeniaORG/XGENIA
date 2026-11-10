/**
 * The runtime's Stake Book Session (packages/xgenia-runtime/.../stake-book-session.js) against the emulator:
 * the Book Connector must turn a game that asks once per round (XRGS habit) into ONE paid play per book, the
 * free rounds answered locally, the round ended exactly once, a reload resumed, replay kept off the wallet —
 * and the emulator, which records every contract breach, must have nothing to say.
 *
 *   node --test tools/stake-harness/test/book-session.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writePackage, loadPackage } from '../lib/package.mjs';
import { makeFixtureModes } from '../lib/fixture.mjs';
import { createEmulator } from '../lib/emulator.mjs';

const require = createRequire(import.meta.url);
const { createStakeBookSession, stakeBookSessionForPage, StakeError } = require('../../../packages/xgenia-runtime/src/nodes/std-library/data/stake-book-session.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stake-session-test-'));
function pkgOf(flavour) {
  const dir = path.join(TMP, flavour);
  if (!fs.existsSync(dir)) writePackage(dir, makeFixtureModes({ baseBooks: 4000, bonusBooks: 300, flavour }));
  return loadPackage(dir);
}

// Fixture XRGS books: data.totalWin is the round's win at an export bet of 100 (hundredths of the bet).
const CFG = { exportBet: 100, betField: 'bet', winField: 'totalWin', modeField: 'mode', modes: { bonus_buy: 'bonus' } };

async function withEmu(fn, { flavour = 'xrgs', ...opts } = {}) {
  const emu = await createEmulator(pkgOf(flavour), opts).listen();
  try {
    return await fn(emu);
  } finally {
    await emu.close();
  }
}
const state = async (emu) => (await fetch(emu.origin + '/__harness/state')).json();
const force = (emu, f) => fetch(emu.origin + '/__harness/force', { method: 'POST', body: JSON.stringify(f) });
function session(emu, sid, extra = '') {
  return createStakeBookSession({ fetch, location: { search: `?sessionID=${sid}&rgs_url=${emu.host}&currency=USD${extra}`, protocol: 'http:' } });
}
const calls = (st, sid, call) => st.transcript.filter((c) => c.sessionID === sid && c.call === call);

/** Fire Spin until the book says the round is complete, like a game's free-spin loop would. */
async function playToEnd(s, payload = { bet: 1 }) {
  const answers = [];
  for (let i = 0; i < 3000; i++) {
    const b = await s.request('Spin', payload, CFG);
    answers.push(b);
    if (b.__stake.roundComplete) return answers;
  }
  throw new Error('book never completed');
}

test('a bonus is ONE paid play, its free rounds answered locally, ended exactly once', async () => {
  await withEmu(async (emu) => {
    const s = session(emu, 'bonus');
    await force(emu, { mode: 'base', kind: 'featureWin', sessionID: 'bonus' });
    const before = (await s.info(CFG)).rgsBalance;
    const answers = await playToEnd(s);
    assert.ok(answers.length > 1, 'forced bonus should have several rounds');
    assert.ok(answers.slice(0, -1).every((a) => a.__stake.inFeature), 'every round but the last is in the feature');
    await s._state.ending;
    const st = await state(emu);
    assert.equal(calls(st, 'bonus', '/wallet/play').length, 1, 'one paid play for the whole bonus');
    assert.equal(calls(st, 'bonus', '/bet/event').length, answers.length, 'progress saved at every round');
    assert.equal(calls(st, 'bonus', '/wallet/end-round').length, 1, 'ended exactly once');
    assert.deepEqual(st.violations, []);
    const play = calls(st, 'bonus', '/wallet/play')[0];
    const paid = play.round.payout / 1e6;
    const shownWins = answers.reduce((a, b) => a + b.totalWin, 0);
    assert.ok(Math.abs(shownWins - paid) < 1e-9, `rounds show ${shownWins}, Stake paid ${paid}`);
    const last = answers[answers.length - 1];
    assert.ok(Math.abs(last.__rgs.balance_after - (before - 1 + paid)) < 1e-9, 'balance shown after the bonus includes its win');
    assert.ok(Math.abs(last.__rgs.win_amount - paid) < 1e-9);
  });
});

test('a single winning round: one play, no progress saves, ended once; the next spin then plays again', async () => {
  await withEmu(async (emu) => {
    const s = session(emu, 'single');
    await force(emu, { mode: 'base', kind: 'single', sessionID: 'single' });
    const a = await s.request('Spin', { bet: 1 }, CFG);
    assert.equal(a.__stake.roundComplete, true);
    // Straight into the next spin: it must wait for the end-round, never trip ERR_BE.
    const b = await s.request('Spin', { bet: 1 }, CFG);
    assert.ok(b);
    await s._state.ending;
    const st = await state(emu);
    assert.equal(calls(st, 'single', '/wallet/play').length, 2);
    assert.equal(calls(st, 'single', '/bet/event').length, 0);
    assert.deepEqual(st.violations, []);
  });
});

test('a losing round closes by itself: no end-round call', async () => {
  await withEmu(async (emu) => {
    const s = session(emu, 'loss');
    await force(emu, { mode: 'base', kind: 'loss', sessionID: 'loss' });
    const a = await s.request('Spin', { bet: 1 }, CFG);
    assert.equal(a.__stake.roundComplete, true);
    assert.equal(a.totalWin, 0);
    const st = await state(emu);
    assert.equal(calls(st, 'loss', '/wallet/end-round').length, 0);
    assert.deepEqual(st.violations, []);
  });
});

test('reload mid-bonus: the next page resumes the same book at no charge and ends it', async () => {
  await withEmu(async (emu) => {
    const first = session(emu, 'resume');
    await force(emu, { mode: 'base', kind: 'featureWin', sessionID: 'resume' });
    for (let i = 0; i < 3; i++) await first.request('Spin', { bet: 1 }, CFG); // tab closed after 3 rounds
    const second = session(emu, 'resume');
    const info = await second.info(CFG);
    assert.equal(info.stakeResumePending, true);
    const answers = await playToEnd(second);
    assert.ok(answers[0].__stake.resumed);
    assert.equal(answers[0].__stake.roundIndex, 0, 'replayed from the first round');
    await second._state.ending;
    const st = await state(emu);
    assert.equal(calls(st, 'resume', '/wallet/play').length, 1, 'no second charge for the resumed round');
    assert.equal(calls(st, 'resume', '/wallet/end-round').length, 1);
    assert.deepEqual(st.violations.filter((v) => v.code !== 'EVENT_BACKWARDS'), []);
  });
});

test('replay mode plays a book with no wallet call at all', async () => {
  await withEmu(async (emu) => {
    const c = await (await fetch(emu.origin + '/__harness/classes?mode=base')).json();
    const id = c.featureWin[0];
    const s = session(emu, 'x', `&replay=true&game=g&version=1&mode=base&event=${id}&amount=2000000`);
    const answers = await playToEnd(s);
    assert.ok(answers.length > 1);
    assert.ok(answers.every((a) => a.__stake.replay && a.__rgs === undefined));
    const st = await state(emu);
    assert.deepEqual(st.transcript.filter((t) => t.call !== 'GET /bet/replay'), []);
    // Shown at the replay's own bet (amount=2.00): the wins add up to the book's payout at that bet.
    const book = (await (await fetch(`${emu.origin}/bet/replay/g/1/base/${id}`)).json());
    assert.ok(Math.abs(answers.reduce((a, b) => a + b.totalWin, 0) - book.payoutMultiplier * 2) < 1e-9);
  });
});

test('a bet off Stake\'s levels is refused before any play, with a reason', async () => {
  await withEmu(async (emu) => {
    const s = session(emu, 'levels');
    await assert.rejects(s.request('Spin', { bet: 0.37 }, CFG), (e) => e instanceof StakeError && e.code === 'BET_NOT_ON_LEVELS');
    assert.equal(calls(await state(emu), 'levels', '/wallet/play').length, 0);
  });
});

test('the game\'s bet mode maps to the Stake mode, charged at its cost', async () => {
  await withEmu(async (emu) => {
    const s = session(emu, 'buy');
    const before = (await s.info(CFG)).rgsBalance;
    await force(emu, { mode: 'bonus', kind: 'featureWin', sessionID: 'buy' });
    const answers = await playToEnd(s, { bet: 1, mode: 'bonus_buy' });
    await s._state.ending;
    const st = await state(emu);
    const play = calls(st, 'buy', '/wallet/play')[0];
    assert.equal(play.req.mode, 'bonus');
    const last = answers[answers.length - 1];
    assert.ok(Math.abs(last.__rgs.balance_after - (before - 100 + play.round.payout / 1e6)) < 1e-9, 'charged 100× and paid the book');
    assert.deepEqual(st.violations, []);
  });
});

test('end-round waits out minimumRoundDuration', async () => {
  await withEmu(async (emu) => {
    const s = session(emu, 'slow');
    await force(emu, { mode: 'base', kind: 'single', sessionID: 'slow' });
    await s.request('Spin', { bet: 1 }, CFG);
    await s._state.ending;
    const st = await state(emu);
    assert.equal(calls(st, 'slow', '/wallet/end-round')[0].status, 200);
    assert.deepEqual(st.violations, []);
  }, { minRoundMs: 400 });
});

test('Stake-standard books are refused loudly: they carry no data for the game graph', async () => {
  await withEmu(async (emu) => {
    const s = session(emu, 'std');
    await assert.rejects(s.request('Spin', { bet: 1 }, CFG), (e) => e.code === 'NOT_AN_XGENIA_BOOK');
  }, { flavour: 'standard' });
});

test('one session per page: in-app navigation that drops the query string keeps the same session', () => {
  const a = stakeBookSessionForPage({ fetch, location: { search: '?sessionID=p1&rgs_url=127.0.0.1:1', protocol: 'http:' } });
  const b = stakeBookSessionForPage({ fetch, location: { search: '', protocol: 'http:' } });
  const c = stakeBookSessionForPage({ fetch, location: { search: '?sessionID=p1&rgs_url=127.0.0.1:1', protocol: 'http:' } });
  assert.equal(a, b);
  assert.equal(a, c);
});

test('a mode the uploaded maths does not have is refused by the connector with the real reason', async () => {
  await withEmu(async (emu) => {
    const s = session(emu, 'mode');
    const info = await s.info(CFG);
    assert.deepEqual(info.stakeModes.map((m) => m.mode), ['base', 'bonus']);
    await assert.rejects(s.request('Spin', { bet: 1, mode: 'enhanced_25' }, CFG), (e) => e.code === 'UNKNOWN_MODE' && /base, bonus/.test(e.message));
    assert.equal(calls(await state(emu), 'mode', '/wallet/play').length, 0);
  });
});

test('money fields scale from the export bet to the player\'s bet', async () => {
  await withEmu(async (emu) => {
    const s = session(emu, 'nested');
    await force(emu, { mode: 'base', kind: 'single', sessionID: 'nested' });
    const a = await s.request('Spin', { bet: 2 }, { ...CFG, winField: undefined, moneyFields: ['totalWin'] });
    const st = await state(emu);
    const play = calls(st, 'nested', '/wallet/play')[0];
    assert.ok(Math.abs(a.totalWin - play.round.payout / 1e6) < 1e-9, 'scaled at bet 2 from export bet 100');
    await s._state.ending;
  });
});

test('a pick bonus shows each prize under the tile the player clicked; prizes and payout are the book\'s', async () => {
  // One book: the paid round, then three pick rounds whose maths revealed tiles 7, 2, 4 with prizes 10, 50, 0.
  const rev = (list) => list.map(([index, prize]) => ({ index, prize }));
  const events = [
    { index: 0, type: 'round', winMultiplier: 0, data: { totalWin: 0, revealed: [] } },
    { index: 1, type: 'featureRound', winMultiplier: 0.1, data: { totalWin: 10, revealed: rev([[7, 10]]) } },
    { index: 2, type: 'featureRound', winMultiplier: 0.5, data: { totalWin: 50, revealed: rev([[7, 10], [2, 50]]) } },
    { index: 3, type: 'featureRound', winMultiplier: 0, data: { totalWin: 0, revealed: rev([[7, 10], [2, 50], [4, 0]]) } },
    { index: 4, type: 'finalWin', amount: 60 },
  ];
  const dir = path.join(TMP, 'picks');
  writePackage(dir, [{ name: 'base', cost: 1, books: [{ id: 1, payoutMultiplier: 60, events }], lut: [{ id: 1, weight: 1n, payout: 60 }] }]);
  const emu = await createEmulator(loadPackage(dir)).listen();
  try {
    const s = session(emu, 'picks');
    const cfg = { ...CFG, pickField: 'pickIndex', revealedField: 'revealed' };
    await s.request('Spin', { bet: 1 }, cfg);
    const a = await s.request('Pick', { bet: 1, pickIndex: 0 }, cfg);
    const b = await s.request('Pick', { bet: 1, pickIndex: 5 }, cfg);
    const c = await s.request('Pick', { bet: 1, pickIndex: 3 }, cfg);
    assert.deepEqual(a.revealed, [{ index: 0, prize: 10 }]);
    assert.deepEqual(b.revealed, [{ index: 0, prize: 10 }, { index: 5, prize: 50 }]);
    assert.deepEqual(c.revealed, [{ index: 0, prize: 10 }, { index: 5, prize: 50 }, { index: 3, prize: 0 }]);
    assert.equal(c.__rgs.win_amount, 0.6, 'the book\'s payout, whatever was clicked');
    await s._state.ending;
    assert.deepEqual((await state(emu)).violations, []);
  } finally {
    await emu.close();
  }
});
