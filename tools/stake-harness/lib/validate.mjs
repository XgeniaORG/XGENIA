/**
 * Validate a Stake maths package: Stake's own upload checks, then the checks that catch a bonus
 * that will not play.
 *
 * ── STAKE'S CHECKS (math-sdk utils/rgs_verification.py, HEAD 2026-11-02) ─────────────────────────
 * Every book has id/payoutMultiplier/events; payouts are integers, ≥10 and a multiple of 10 when
 * non-zero; the LUT's payout column equals the books' payouts line for line; SUBMISSION_LIMITS:
 * RTP 96.0–96.7 %, cheapest mode costs exactly 1×, cost ≤ 50,000×, max win ≤ 1,000,000×, base-game
 * standard deviation ≥ 0.6. The docs add: every mode within 0.5 % RTP of base, 100k–1M books per mode,
 * max win reachable (1 in 20M or better).
 *
 * ── WHY MORE THAN STAKE CHECKS ────────────────────────────────────────────────────────────────────
 * Stake's verifier passes a package whose bonus can never play. The faults we found in XGENIA
 * exports (2026-11-09) all pass it:
 *   - the base game never produces a multi-round book (free spins dropped at export);
 *   - a bought book is one ordinary spin (the buy never entered the feature);
 *   - event `index` is not the array position (resume slices by position: wrong resume point);
 *   - the events show a different total from the payout Stake pays;
 *   - no `finalWin`, so the frontend's win counter has nothing to count up to.
 * These are errors here, because each one is a stuck or wrong bonus in front of a player.
 *
 * Silent success is this codebase's failure mode: a package with no modes, no books or a mode we
 * could not read FAILS; it never passes with nothing checked.
 */
import { loadPackage, PackageError } from './package.mjs';
import { describeBook } from './rounds.mjs';

export const LIMITS = {
  minRtp: 0.96,
  maxRtp: 0.967,
  modeRtpSpread: 0.005,
  baseCost: 1,
  maxCost: 50_000,
  maxWin: 1_000_000,
  minBaseStd: 0.6,
  minBooks: 100_000,
  maxBooks: 1_000_000,
  maxWinOdds: 20_000_000,
  truncatedRounds: 2_000,
};

/** A mode is a buy (must open in the feature) from this cost up, unless named explicitly. */
export const BUY_COST_THRESHOLD = 10;

class Issues {
  constructor() {
    this.map = new Map();
  }
  add(level, code, mode, message, example) {
    const key = `${level}|${code}|${mode ?? ''}`;
    let it = this.map.get(key);
    if (!it) {
      it = { level, code, mode: mode ?? null, message, count: 0, examples: [] };
      this.map.set(key, it);
    }
    it.count++;
    if (example !== undefined && it.examples.length < 5) it.examples.push(example);
  }
  list(level) {
    return [...this.map.values()].filter((i) => i.level === level);
  }
}

function pct(x) {
  return `${(x * 100).toFixed(3)}%`;
}

/**
 * @param {string|object} pkgOrDir  a directory or a loaded package
 * @param {{ limits?: Partial<typeof LIMITS>, buyModes?: string[], requireStandard?: boolean, expectFeature?: boolean }} opts
 */
export function validatePackage(pkgOrDir, opts = {}) {
  const limits = { ...LIMITS, ...(opts.limits || {}) };
  const issues = new Issues();
  let pkg;
  try {
    pkg = typeof pkgOrDir === 'string' ? loadPackage(pkgOrDir) : pkgOrDir;
  } catch (e) {
    const code = e instanceof PackageError ? e.code : 'PACKAGE_UNREADABLE';
    issues.add('error', code, null, e.message);
    return finish(issues, [], null);
  }

  const buyNames = new Set((opts.buyModes || []).map((s) => s.toLowerCase()));
  const isBuy = (m) => (buyNames.size ? buyNames.has(m.name.toLowerCase()) : m.cost >= BUY_COST_THRESHOLD);

  // ── index.json ──────────────────────────────────────────────────────────────────────────────
  const names = new Set();
  for (const m of pkg.modes) {
    if (!/^[a-z0-9_]+$/i.test(m.name)) issues.add('error', 'MODE_NAME', m.name, 'Mode names must be letters, digits and underscores.', m.name);
    if (names.has(m.name.toLowerCase())) issues.add('error', 'MODE_DUPLICATE', m.name, 'Two modes share a name (Stake matches mode names ignoring case).', m.name);
    names.add(m.name.toLowerCase());
    if (!Number.isFinite(m.cost) || m.cost <= 0) issues.add('error', 'MODE_COST', m.name, 'cost must be a positive number.', m.cost);
    if (m.cost > limits.maxCost) issues.add('error', 'COST_TOO_HIGH', m.name, `cost above Stake's ${limits.maxCost}× limit.`, m.cost);
  }
  const cheapest = Math.min(...pkg.modes.map((m) => m.cost));
  if (cheapest !== limits.baseCost) {
    issues.add('error', 'NO_BASE_COST_MODE', null, `The cheapest mode must cost exactly ${limits.baseCost}× (cheapest here: ${cheapest}×).`);
  }

  // ── per mode ────────────────────────────────────────────────────────────────────────────────
  const stats = [];
  for (const m of pkg.modes) stats.push(validateMode(m, isBuy(m), limits, issues, opts));

  // ── across modes ────────────────────────────────────────────────────────────────────────────
  const base = stats.find((s) => s.cost === limits.baseCost) || null;
  if (base && Number.isFinite(base.rtp)) {
    for (const s of stats) {
      if (s === base || !Number.isFinite(s.rtp)) continue;
      if (Math.abs(s.rtp - base.rtp) > limits.modeRtpSpread) {
        issues.add('error', 'RTP_MODE_SPREAD', s.mode, `RTP ${pct(s.rtp)} is more than ${pct(limits.modeRtpSpread)} from base (${pct(base.rtp)}).`);
      }
    }
    if (base.std < limits.minBaseStd) {
      issues.add('error', 'BASE_STD_LOW', base.mode, `Base-game standard deviation ${base.std.toFixed(3)} is below Stake's ${limits.minBaseStd}.`);
    }
    // The bonus exists (a buy mode plays it) but the base game never reaches it: the export
    // dropped the free spins, or the trigger never fires. Stake's verifier passes this.
    // `expectFeature`: the game has a bonus even if no buy mode shows it — a base-only export
    // (what editor games produce while nothing publishes bet_options) can only be caught this way.
    const anyBuy = stats.some((s) => s.isBuy) || !!opts.expectFeature;
    if (anyBuy && base.featureBooks === 0) {
      issues.add('error', 'BASE_NEVER_TRIGGERS_FEATURE', base.mode,
        'The base game has no multi-round book, but the game has a feature (a buy mode, or --expect-feature). Free spins are being dropped from base books (or the trigger never fires).');
    }
  }

  return finish(issues, stats, pkg);
}

function validateMode(m, isBuy, limits, issues, opts) {
  const s = {
    mode: m.name,
    cost: m.cost,
    isBuy,
    books: m.bookCount,
    lutRows: m.lut.rows.length,
    dialects: {},
    idBase: null,
    rtp: NaN,
    hitRate: NaN,
    featureRate: NaN,
    featureBooks: 0,
    maxWin: 0,
    maxWinOdds: null,
    std: NaN,
    avgFeatureRounds: 0,
  };

  if (m.lut.problems.length) {
    for (const p of m.lut.problems) issues.add('error', 'LUT_FORMAT', m.name, 'Lookup-table rows must be `id,weight,payoutMultiplier`, unsigned integers, no header.', `line ${p.line}: ${p.text}`);
  }
  if (m.bookCount === 0) {
    issues.add('error', 'NO_BOOKS', m.name, 'The books file has no books.');
    return s;
  }
  if (m.bookCount < limits.minBooks) issues.add('warn', 'FEW_BOOKS', m.name, `${m.bookCount} books; Stake asks for ${limits.minBooks.toLocaleString()}–${limits.maxBooks.toLocaleString()} per mode.`);
  if (m.bookCount > limits.maxBooks) issues.add('warn', 'MANY_BOOKS', m.name, `${m.bookCount} books; Stake asks for at most ${limits.maxBooks.toLocaleString()}.`);
  if (m.lut.rows.length !== m.bookCount) {
    issues.add('error', 'LUT_BOOK_COUNT', m.name, `The lookup table has ${m.lut.rows.length} rows and the books file ${m.bookCount} lines; Stake requires one row per book, same order.`);
  }

  // Pass over the books.
  const payouts = [];
  const ids = [];
  const seen = new Set();
  let featureRounds = 0;
  for (const { i, text } of m.lines()) {
    let book;
    try {
      book = JSON.parse(text);
    } catch {
      issues.add('error', 'BOOK_JSON', m.name, 'A books line is not JSON.', `line ${i + 1}`);
      payouts.push(null);
      ids.push(null);
      continue;
    }
    const id = book?.id;
    const pm = book?.payoutMultiplier;
    const events = book?.events;
    if (!Number.isInteger(id) || !Number.isInteger(pm) || !Array.isArray(events)) {
      issues.add('error', 'BOOK_KEYS', m.name, 'Every book needs an integer `id`, an integer `payoutMultiplier` and an `events` array.', `line ${i + 1}`);
    }
    ids.push(id);
    payouts.push(pm);
    if (seen.has(id)) issues.add('error', 'ID_DUPLICATE', m.name, 'Two books share an id.', id);
    seen.add(id);
    if (i === 0 && Number.isInteger(id)) s.idBase = id;
    if (Number.isInteger(pm)) {
      if (pm < 0) issues.add('error', 'PAYOUT_NEGATIVE', m.name, 'payoutMultiplier is negative.', id);
      else if (pm > 0 && (pm < 10 || pm % 10 !== 0)) {
        issues.add('error', 'PAYOUT_GRID', m.name, "Non-zero payoutMultiplier must be ≥10 and a multiple of 10 (Stake's verifier; 0.1× steps).", `id ${id}: ${pm}`);
      }
      if (pm / 100 > limits.maxWin) issues.add('error', 'MAX_WIN_TOO_HIGH', m.name, `A book pays more than ${limits.maxWin.toLocaleString()}×.`, `id ${id}: ${pm / 100}×`);
    }
    if (!Array.isArray(events)) continue;
    if (events.length === 0) {
      issues.add('error', 'BOOK_NO_EVENTS', m.name, 'A book has no events: the frontend gets an empty round.state ("Empty state in data.round").', id);
      continue;
    }
    // index must be the array position: resume slices the events by POSITION using the index
    // the frontend saved with /bet/event.
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      if (!e || typeof e.type !== 'string') {
        issues.add('error', 'EVENT_NO_TYPE', m.name, 'Every event needs a string `type`.', `id ${id} event ${k}`);
        break;
      }
      if (e.index !== k) {
        issues.add('error', 'EVENT_INDEX', m.name, 'Event `index` must be 0..n-1, equal to its position in the array; resume after a reload slices by position.', `id ${id} event ${k} has index ${e.index}`);
        break;
      }
    }
    const d = describeBook(book);
    s.dialects[d.dialect] = (s.dialects[d.dialect] || 0) + 1;
    if (d.isFeature) {
      s.featureBooks++;
      featureRounds += d.rounds;
    }
    if (d.rounds >= limits.truncatedRounds) issues.add('warn', 'BOOK_TRUNCATED', m.name, `A book has ${limits.truncatedRounds}+ rounds: probably a feature that never ended and was cut.`, id);
    if (isBuy && !d.isFeature) {
      issues.add('error', 'BUY_NOT_IN_FEATURE', m.name, 'A book in a buy mode is a single round: the buy did not enter the feature, so the player paid the buy price for an ordinary spin.', id);
    }
    if (Number.isInteger(pm)) {
      if (d.hasFinalWin && d.shown !== pm) {
        issues.add('error', 'FINALWIN_MISMATCH', m.name, '`finalWin.amount` differs from payoutMultiplier: the game shows one win and Stake pays another.', `id ${id}: finalWin ${d.shown}, payout ${pm}`);
      } else if (!d.hasFinalWin && d.shown !== null && Math.abs(d.shown - pm) >= 10 && !d.hasWincap) {
        issues.add('error', 'SHOWN_WIN_MISMATCH', m.name, 'The events add up to a different win from payoutMultiplier (rounding to the 0.1× grid, or a cap applied per round): the game shows one win and Stake pays another.', `id ${id}: events ${d.shown}, payout ${pm}`);
      }
    }
  }

  // Dialect: a frontend must understand the events to play them.
  const dialects = Object.keys(s.dialects);
  if (s.dialects.xrgs) {
    issues.add(opts.requireStandard ? 'error' : 'warn', 'EVENTS_XRGS_DIALECT', m.name,
      'Books use XRGS round events ({type:"round"|"featureRound", data}), not Stake\'s (reveal, finalWin, ...). Only a frontend that plays this dialect works; Stake\'s web-sdk cannot detect the bonus or resume it.');
  }
  if (s.dialects.custom) issues.add('warn', 'EVENTS_CUSTOM', m.name, 'Some books have neither `reveal` events nor XRGS round events; each is treated as a single round.');
  if (m.lut.rows.length === 0) return s;
  if (dialects.length > 1) issues.add('warn', 'EVENTS_MIXED_DIALECTS', m.name, `Books mix event dialects: ${dialects.join(', ')}.`);
  if (!payouts.some((p) => !Number.isInteger(p) || p === 0) && !isBuy) {
    issues.add('warn', 'NO_ZERO_BOOKS', m.name, 'No losing book at all in a non-buy mode.');
  }

  // LUT ↔ books: Stake hashes the payout column against the books' payouts in order.
  const n = Math.min(m.lut.rows.length, payouts.length);
  for (let i = 0; i < n; i++) {
    if (m.lut.rows[i].payout !== payouts[i]) {
      issues.add('error', 'LUT_PAYOUT_ORDER', m.name, "The lookup table's payout column does not equal the books' payouts line for line (Stake's hash check fails).", `row ${i + 1}: LUT ${m.lut.rows[i].payout}, book ${payouts[i]}`);
    }
    if (m.lut.rows[i].id !== ids[i]) {
      issues.add('error', 'LUT_ID_ORDER', m.name, 'Lookup-table ids and book ids differ in order: the RGS would serve a different book from the one it priced.', `row ${i + 1}: LUT id ${m.lut.rows[i].id}, book id ${ids[i]}`);
    }
  }
  if (m.totalWeight === 0n) {
    issues.add('error', 'LUT_ZERO_WEIGHT', m.name, 'Every weight is 0: nothing can be drawn.');
    return s;
  }

  // Weighted statistics, as the RGS draws.
  let sumW = 0;
  let sumX = 0;
  let sumX2 = 0;
  let hitW = 0;
  let featW = 0;
  let maxW = 0;
  let maxPayout = 0;
  const total = Number(m.totalWeight);
  // A second pass for the feature flag per row would re-parse every book; we kept only payouts,
  // so weighted feature rate uses the book order (LUT row i ↔ book line i, checked above).
  const featureByLine = new Uint8Array(payouts.length);
  if (s.featureBooks > 0) {
    for (const { i, text } of m.lines()) {
      try {
        featureByLine[i] = describeBook(JSON.parse(text)).isFeature ? 1 : 0;
      } catch {
        /* reported above */
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const w = Number(m.lut.rows[i].weight);
    const p = m.lut.rows[i].payout;
    const x = p / 100 / m.cost;
    sumW += w;
    sumX += w * x;
    sumX2 += w * x * x;
    if (p > 0) hitW += w;
    if (featureByLine[i]) featW += w;
    if (p > maxPayout) {
      maxPayout = p;
      maxW = w;
    } else if (p === maxPayout) maxW += w;
  }
  s.rtp = sumX / sumW;
  s.std = Math.sqrt(Math.max(0, sumX2 / sumW - s.rtp * s.rtp));
  s.hitRate = hitW / sumW;
  s.featureRate = featW / sumW;
  s.maxWin = maxPayout / 100;
  s.maxWinOdds = maxW > 0 ? total / maxW : null;
  s.avgFeatureRounds = s.featureBooks ? featureRounds / s.featureBooks : 0;

  if (s.rtp < limits.minRtp || s.rtp > limits.maxRtp) {
    issues.add('error', 'RTP_OUT_OF_BAND', m.name, `RTP ${pct(s.rtp)} is outside Stake's ${pct(limits.minRtp)}–${pct(limits.maxRtp)}. With every weight 1 the RTP is just the sample mean: rebalance the weights (cli rebalance) or tune the maths.`);
  }
  if (!isBuy && m.cost === limits.baseCost) {
    if (s.hitRate < 1 / 20) issues.add('warn', 'HIT_RATE_LOW', m.name, `Hit rate 1 in ${(1 / s.hitRate).toFixed(1)}; Stake reviewers expect about 1 in 3–8 and never worse than 1 in 20.`);
  }
  if (s.maxWinOdds && s.maxWinOdds > limits.maxWinOdds) {
    issues.add('warn', 'MAX_WIN_UNREACHABLE', m.name, `The top win (${s.maxWin}×) is 1 in ${Math.round(s.maxWinOdds).toLocaleString()}; Stake wants it reachable at 1 in ${limits.maxWinOdds.toLocaleString()} or better.`);
  }
  return s;
}

function finish(issues, stats, pkg) {
  const errors = issues.list('error');
  const warnings = issues.list('warn');
  const ok = errors.length === 0 && stats.length > 0;
  if (stats.length === 0 && errors.length === 0) {
    errors.push({ level: 'error', code: 'NOTHING_CHECKED', mode: null, message: 'No mode was checked.', count: 1, examples: [] });
  }
  return { ok, dir: pkg?.dir ?? null, errors, warnings, modes: stats };
}

export function formatReport(r) {
  const lines = [];
  lines.push(`Stake maths package: ${r.dir ?? '(unreadable)'}`);
  lines.push(r.ok ? 'RESULT: PASS' : `RESULT: FAIL (${r.errors.length} error kind${r.errors.length === 1 ? '' : 's'})`);
  for (const s of r.modes) {
    const d = Object.entries(s.dialects).map(([k, v]) => `${k}:${v}`).join(' ');
    lines.push(
      `  mode ${s.mode} cost ${s.cost}×${s.isBuy ? ' (buy)' : ''}: ${s.books} books, RTP ${Number.isFinite(s.rtp) ? pct(s.rtp) : '-'}, ` +
        `hit ${Number.isFinite(s.hitRate) ? pct(s.hitRate) : '-'}, feature ${Number.isFinite(s.featureRate) ? pct(s.featureRate) : '-'} ` +
        `(${s.featureBooks} books, avg ${s.avgFeatureRounds.toFixed(1)} rounds), max ${s.maxWin}×, std ${Number.isFinite(s.std) ? s.std.toFixed(2) : '-'}, ` +
        `ids from ${s.idBase}, events ${d || '-'}`,
    );
  }
  for (const [label, list] of [['ERROR', r.errors], ['warn ', r.warnings]]) {
    for (const i of list) {
      lines.push(`  ${label} ${i.code}${i.mode ? ` [${i.mode}]` : ''} ×${i.count}: ${i.message}${i.examples.length ? `  e.g. ${i.examples.join('; ')}` : ''}`);
    }
  }
  return lines.join('\n');
}
