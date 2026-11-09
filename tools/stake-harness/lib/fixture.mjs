/**
 * A small synthetic slot as a Stake maths package — for testing the harness itself, and as the
 * reference of what a CORRECT bonus book looks like.
 *
 * Two modes: `base` (1×; free spins trigger about 1 in 100) and `bonus` (100×; always opens the
 * free spins). Ten free spins, retrigger +5, at most 50. Events are Stake's standard ones in the
 * math-sdk's order (reveal → winInfo → setWin → setTotalWin → freeSpinTrigger →
 * (updateFreeSpin → reveal → ... → setTotalWin [→ freeSpinRetrigger])* → freeSpinEnd → finalWin),
 * indices 0..n-1, payouts on the 0.1× grid, finalWin = payoutMultiplier, weights rebalanced to 96.3 %.
 *
 * `flavour` injects ONE known defect so a test can prove the harness catches it:
 *   xrgs               the dialect XRGS stake-books.ts writes today (round/featureRound + data)
 *   drop-free-spins    base books end after the trigger spin (the export bug that loses free spins)
 *   buy-single-round   the bonus mode's books are ordinary spins (the buy never enters the feature)
 *   index-1based       event index starts at 1 (resume lands on the wrong event)
 *   finalwin-mismatch  finalWin differs from payoutMultiplier on feature books
 *   off-grid           some payouts are not multiples of 10
 *   raw-weights        every weight 1 (RTP is whatever the sample gave)
 */
import { makeRng } from './emulator.mjs';
import { rebalanceRows } from './rebalance.mjs';
import { writePackage } from './package.mjs';

const SYMBOLS = ['H1', 'H2', 'H3', 'L1', 'L2', 'L3', 'L4'];
const REELS = 5;
const ROWS = 3;

function pickWeighted(rng, table) {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [v, w] of table) {
    if ((r -= w) < 0) return v;
  }
  return table[table.length - 1][0];
}

function board(rng, scatters) {
  const b = [];
  const sc = new Set();
  while (sc.size < scatters) sc.add(Math.floor(rng() * REELS));
  for (let r = 0; r < REELS; r++) {
    const col = [];
    for (let k = 0; k < ROWS; k++) col.push({ name: SYMBOLS[Math.floor(rng() * SYMBOLS.length)] });
    if (sc.has(r)) col[Math.floor(rng() * ROWS)] = { name: 'S', scatter: true };
    b.push(col);
  }
  return b;
}

const BASE_WINS = [[0, 70], [20, 10], [50, 8], [100, 6], [200, 3], [500, 2], [1000, 0.7], [2500, 0.25], [10000, 0.05]];
const FREE_WINS = [[0, 50], [50, 15], [100, 12], [300, 10], [1000, 7], [3000, 4], [10000, 1.5], [50000, 0.4], [200000, 0.1]];

function winEvents(events, rng, win, totalSoFar) {
  if (win > 0) {
    const symbol = SYMBOLS[Math.floor(rng() * 3)];
    const positions = [0, 1, 2].map((reel) => ({ reel, row: Math.floor(rng() * ROWS) }));
    events.push({ index: events.length, type: 'winInfo', totalWin: win, wins: [{ symbol, kind: 3, win, positions, meta: { lineIndex: 0, multiplier: 1 } }] });
    events.push({ index: events.length, type: 'setWin', amount: win, winLevel: win >= 1000 ? 3 : 1 });
  }
  events.push({ index: events.length, type: 'setTotalWin', amount: totalSoFar + win });
  return totalSoFar + win;
}

function playBook(id, rng, forceFeature) {
  const events = [];
  const trigger = forceFeature || rng() < 0.01;
  events.push({ index: 0, type: 'reveal', board: board(rng, trigger ? 3 : rng() < 0.1 ? 2 : 0), paddingPositions: [0, 0, 0, 0, 0], gameType: 'basegame', anticipation: [0, 0, 0, 0, 0] });
  let total = winEvents(events, rng, forceFeature ? 0 : pickWeighted(rng, BASE_WINS), 0);
  let rounds = 1;
  if (trigger) {
    let fsTotal = 10;
    events.push({ index: events.length, type: 'freeSpinTrigger', totalFs: fsTotal, positions: [{ reel: 0, row: 1 }, { reel: 2, row: 1 }, { reel: 4, row: 1 }] });
    for (let i = 0; i < fsTotal; i++) {
      events.push({ index: events.length, type: 'updateFreeSpin', amount: i, total: fsTotal });
      const retrigger = rng() < 0.04 && fsTotal < 50;
      events.push({ index: events.length, type: 'reveal', board: board(rng, retrigger ? 3 : 0), paddingPositions: [0, 0, 0, 0, 0], gameType: 'freegame', anticipation: [0, 0, 0, 0, 0] });
      total = winEvents(events, rng, pickWeighted(rng, FREE_WINS), total);
      rounds++;
      if (retrigger) {
        fsTotal = Math.min(50, fsTotal + 5);
        events.push({ index: events.length, type: 'freeSpinRetrigger', totalFs: fsTotal, positions: [{ reel: 1, row: 0 }, { reel: 2, row: 2 }, { reel: 3, row: 1 }] });
      }
    }
    events.push({ index: events.length, type: 'freeSpinEnd', amount: total, winLevel: 4 });
  }
  events.push({ index: events.length, type: 'finalWin', amount: total });
  return { id, payoutMultiplier: total, events, criteria: trigger ? 'freegame' : total ? 'basegame' : '0', baseGameWins: 0, freeGameWins: 0 };
}

/** Rewrite a standard book in the XRGS dialect: one event per round, data = what the maths returned. */
function toXrgs(book) {
  const out = [];
  let cur = null;
  for (const e of book.events) {
    if (e.type === 'reveal') {
      cur = { index: out.length, type: out.length === 0 ? 'round' : 'featureRound', winMultiplier: 0, data: { board: e.board, totalWin: 0 } };
      out.push(cur);
    } else if (e.type === 'setWin' && cur) {
      cur.winMultiplier = e.amount / 100;
      cur.data.totalWin = e.amount;
    }
  }
  return { id: book.id, payoutMultiplier: book.payoutMultiplier, events: out };
}

export function makeFixtureModes({ seed = 7, baseBooks = 20_000, bonusBooks = 2_000, rtp = 0.963, flavour = 'standard' } = {}) {
  const rng = makeRng(seed);
  const firstId = flavour === 'zero-ids' ? 0 : 1;
  let base = Array.from({ length: baseBooks }, (_, i) => playBook(i + firstId, rng, false));
  let bonus = Array.from({ length: bonusBooks }, (_, i) => playBook(i + firstId, rng, true));

  if (flavour === 'drop-free-spins') {
    base = base.map((b) => {
      const cut = b.events.findIndex((e, k) => k > 0 && e.type === 'freeSpinTrigger');
      if (cut < 0) return b;
      const kept = b.events.slice(0, cut);
      const total = kept.filter((e) => e.type === 'setWin').reduce((a, e) => a + e.amount, 0);
      kept.push({ index: kept.length, type: 'finalWin', amount: total });
      return { ...b, payoutMultiplier: total, events: kept };
    });
  }
  if (flavour === 'buy-single-round') {
    bonus = bonus.map((b, i) => {
      const single = playBook(b.id, rng, false);
      // priced like the bonus so only the shape is wrong
      const win = Math.max(10, Math.round((b.payoutMultiplier) / 10) * 10);
      single.events = single.events.filter((e) => e.type === 'reveal').slice(0, 1);
      single.events.push({ index: 1, type: 'setWin', amount: win, winLevel: 3 }, { index: 2, type: 'setTotalWin', amount: win }, { index: 3, type: 'finalWin', amount: win });
      single.payoutMultiplier = win;
      return single;
    });
  }
  if (flavour === 'index-1based') {
    for (const b of [...base, ...bonus]) b.events.forEach((e, k) => (e.index = k + 1));
  }
  if (flavour === 'finalwin-mismatch') {
    for (const b of bonus) b.events[b.events.length - 1].amount += 10;
  }
  if (flavour === 'off-grid') {
    for (let i = 0; i < base.length; i += 97) {
      if (base[i].payoutMultiplier > 0) {
        base[i].payoutMultiplier += 5;
        base[i].events[base[i].events.length - 1].amount += 5;
      }
    }
  }
  if (flavour === 'xrgs') {
    base = base.map(toXrgs);
    bonus = bonus.map(toXrgs);
  }

  const lutFor = (books, cost) => {
    const rows = books.map((b) => ({ id: b.id, weight: 1n, payout: b.payoutMultiplier }));
    return flavour === 'raw-weights' ? rows : rebalanceRows(rows, cost, rtp).rows;
  };
  return [
    { name: 'base', cost: 1, books: base, lut: lutFor(base, 1) },
    { name: 'bonus', cost: 100, books: bonus, lut: lutFor(bonus, 100) },
  ];
}

export function writeFixture(dir, opts = {}) {
  return writePackage(dir, makeFixtureModes(opts));
}
