// The Stake Engine maths package, as files — the pure half of "Deploy to Stake" exporting maths.
//
// Stake's RGS plays a game from a directory of pre-simulated rounds: for every bet mode a
// `books_<mode>.jsonl.zst` (one JSON round per line, zstd) and a `lookUpTable_<mode>_0.csv`
// (`id,weight,payoutMultiplier` per round), tied together by a strictly-shaped `index.json`
// (stake-sdk/math-sdk docs/rgs_docs/data_format.md). XGENIA RGS plays the deployed component
// and returns the books (`_shared/stake-books.ts`); this module turns them into those files and
// re-runs the checks Stake's uploader runs (the Math SDK's utils/rgs_verification.py) BEFORE
// anything is written, so a package that would be refused is refused here, with the reason.
//
// Deliberately dependency-free: unit-tested under plain Node (tests/deploy/stakeMathsFormat.test.ts),
// so it must not pull in editor models or the platform layer. The byte-for-byte shapes here
// mirror the server's helpers; the server's suite proves its books satisfy them.

export interface StakeModeInfo {
  name: string;
  cost: number;
  kind: 'base' | 'buy' | 'special';
  optionId: string | null;
  label: string;
}

export interface StakeLutRow {
  id: number;
  payout: number;
  weight?: number;
  /** As the platform reports a kept book (stake-books.ts runStakeChunk): its criteria and sampled stratum. */
  criteria?: string;
  /** null: a rare book, always kept (win cap, a feature in the base game, a win of 10× the price or more). */
  stratum?: string | null;
}

/** A rare book's weight in an oversampled package; a sampled book weighs this × its stratum's 1-in-N. */
export const RARE_BOOK_WEIGHT = 1000;

/**
 * The lookup-table weights of an oversampled run (2026-11-09, the editor half of XRGS SYSTEM_MAP I-138).
 *
 * With `oversample` N the platform simulates N rounds per book asked for, keeps every rare one and a hash-chosen
 * 1-in-N of the rest, and reports how many rounds it simulated in each payout stratum. Weighting each stratum's
 * kept books by (rounds simulated in it ÷ books kept from it) makes the package pay exactly what the simulation
 * paid — no weight is chosen to fit an RTP. Rare books weigh RARE_BOOK_WEIGHT (one simulated round each).
 *
 * Refuses rather than guesses: a sampled book whose stratum has no simulated count would get an invented weight.
 */
export function strataWeightedRows(rows: StakeLutRow[], strata: { stratum: string; simulations: number }[] | undefined, oversample: number): StakeLutRow[] {
  if (!(oversample > 1)) return rows.map((r) => ({ ...r, weight: 1 }));
  const sims = new Map((strata || []).map((s) => [s.stratum, Number(s.simulations) || 0]));
  const kept = new Map<string, number>();
  for (const r of rows) if (r.stratum) kept.set(r.stratum, (kept.get(r.stratum) || 0) + 1);
  const weightOf = new Map<string, number>();
  for (const [stratum, n] of kept) {
    const simulated = sims.get(stratum);
    if (!simulated) throw new Error(`The platform reported no simulated rounds for stratum "${stratum}" but kept ${n} of its books: cannot weight them.`);
    weightOf.set(stratum, Math.max(1, Math.round((RARE_BOOK_WEIGHT * simulated) / n)));
  }
  return rows.map((r) => ({ ...r, weight: r.stratum ? weightOf.get(r.stratum)! : RARE_BOOK_WEIGHT }));
}

/** RTP of a weighted table, as Stake computes it: Σ(weight × payout) ÷ Σweight ÷ 100 ÷ cost. */
export function lookupTableRtp(rows: StakeLutRow[], cost: number): number {
  let w = 0;
  let wp = 0;
  for (const r of rows) {
    const weight = r.weight ?? 1;
    w += weight;
    wp += weight * r.payout;
  }
  return w > 0 ? wp / w / 100 / cost : 0;
}

export function stakeBooksFileName(mode: string): string {
  return `books_${mode}.jsonl.zst`;
}

export function stakeLookupFileName(mode: string): string {
  return `lookUpTable_${mode}_0.csv`;
}

/** `id,weight,payout` per line, no header, weight 1 unless given — the Math SDK's unoptimised table. */
export function lookupTableCsv(rows: StakeLutRow[]): string {
  return rows.map((r) => `${r.id},${r.weight ?? 1},${r.payout}`).join('\n') + (rows.length ? '\n' : '');
}

/** The strictly-enforced `index.json`. */
export function stakeIndexJson(modes: { name: string; cost: number }[]): string {
  return JSON.stringify(
    {
      modes: modes.map((m) => ({
        name: m.name,
        cost: m.cost,
        events: stakeBooksFileName(m.name),
        weights: stakeLookupFileName(m.name)
      }))
    },
    null,
    4
  );
}

/**
 * The checks Stake runs on upload, as the Math SDK duplicates them: payouts are non-negative
 * integers, multiples of 10 and at least 10 when non-zero; weights are non-negative integers
 * whose sum fits uint64; the table's payouts match the books' exactly, row for row.
 */
export function verifyStakeMode(lutCsv: string, bookPayouts: number[]): string[] {
  const problems: string[] = [];
  const lines = lutCsv.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length !== bookPayouts.length) {
    problems.push(`lookup table has ${lines.length} rows but there are ${bookPayouts.length} books`);
  }
  let weightTotal = BigInt(0);
  const U64 = (BigInt(1) << BigInt(64)) - BigInt(1);
  lines.forEach((line, i) => {
    const parts = line.split(',');
    if (parts.length !== 3) {
      problems.push(`row ${i}: expected 'id,weight,payout', got '${line}'`);
      return;
    }
    const [idS, wS, pS] = parts;
    if (!/^\d+$/.test(idS)) problems.push(`row ${i}: id '${idS}' is not a non-negative integer`);
    if (!/^\d+$/.test(wS)) problems.push(`row ${i}: weight '${wS}' is not a non-negative integer`);
    else weightTotal += BigInt(wS);
    if (!/^\d+$/.test(pS)) {
      problems.push(`row ${i}: payout '${pS}' is not a non-negative integer`);
      return;
    }
    const payout = Number(pS);
    if (payout > 0 && payout < 10) problems.push(`row ${i}: non-zero payout ${payout} is below the minimum of 10`);
    if (payout % 10 !== 0) problems.push(`row ${i}: payout ${payout} is not a multiple of 10`);
    if (i < bookPayouts.length && bookPayouts[i] !== payout) {
      problems.push(`row ${i}: lookup payout ${payout} does not match the book's payoutMultiplier ${bookPayouts[i]}`);
    }
  });
  if (weightTotal > U64) problems.push('sum of weights exceeds uint64');
  bookPayouts.forEach((p, i) => {
    if (!Number.isInteger(p) || p < 0) problems.push(`book ${i}: payoutMultiplier ${p} is not a non-negative integer`);
  });
  return problems;
}

/** The statistics the platform derives per mode, as its last chunk reported them. */
export interface StakeModeStats {
  books: number;
  evaluate_calls: number;
  rtp: number;
  rtp_raw: number;
  hit_rate: number;
  feature_books: number;
  feature_rounds: number;
  choice_books: number;
  truncated_books: number;
  rounded_books: number;
  capped_books: number;
  max_multiplier: number;
  elapsed_ms: number;
  /** Oversampled runs (XRGS I-138): every round simulated, what they paid, and the rounds per stratum. */
  simulations?: number;
  rtp_simulated?: number;
  strata?: { stratum: string; simulations: number }[];
}

/** One mode's finished export, before and after the files are written. */
export interface StakeModeExport {
  mode: StakeModeInfo;
  rows: StakeLutRow[];
  stats: StakeModeStats;
  /** Uncompressed JSONL size, for the summary. */
  jsonlBytes: number;
}

export interface StakeExportManifestInput {
  game: { id: string; slug?: string; name?: string } | null;
  deploymentId: string;
  functionSlug: string;
  functionName: string | null;
  scriptSha256: string | null;
  masterSeed: string;
  bet: number;
  maxWinMultiplier: number | null;
  choicePolicy: string;
  declaredRtp: unknown;
  modes: StakeModeExport[];
  skippedOptions: string[];
  /** Rounds simulated per book kept (1: a uniform package). */
  oversample?: number;
  /** The request each mode was played from, when auto-setup found one other than the game's own. */
  roundRequests?: Record<string, unknown>;
  editorVersion?: string;
  exportedAt?: string;
}

/**
 * What the export was, written next to the files: everything needed to re-derive any book
 * (the component, its script's hash, the seed, the stake) and what the sample measured. Holds
 * the master seed, so it is written OUTSIDE the directory uploaded to Stake.
 */
export function buildStakeExportManifest(i: StakeExportManifestInput): Record<string, unknown> {
  return {
    format: 'xgenia-stake-export/1',
    exported_at: i.exportedAt ?? new Date().toISOString(),
    editor_version: i.editorVersion ?? null,
    game: i.game,
    component: {
      deployment_id: i.deploymentId,
      function_slug: i.functionSlug,
      function_name: i.functionName,
      script_sha256: i.scriptSha256
    },
    reproduction: {
      master_seed: i.masterSeed,
      bet_minor_units: i.bet,
      max_win_multiplier: i.maxWinMultiplier,
      choice_policy: i.choicePolicy,
      oversample: i.oversample ?? 1,
      round_requests: i.roundRequests ?? {},
      rule: 'book i is played from Isaac.fromHex(sha256(master_seed + ":" + i)); the start-up request runs once from index -1 and its state opens every book'
    },
    declared_rtp: i.declaredRtp ?? null,
    modes: i.modes.map((m) => ({
      name: m.mode.name,
      cost: m.mode.cost,
      kind: m.mode.kind,
      option_id: m.mode.optionId,
      files: { events: stakeBooksFileName(m.mode.name), weights: stakeLookupFileName(m.mode.name) },
      weights: (i.oversample ?? 1) > 1
        ? `stratified: rare books ${RARE_BOOK_WEIGHT}, each sampled stratum ${RARE_BOOK_WEIGHT} × (rounds simulated ÷ books kept) — the package pays what the simulation paid`
        : 'uniform (1 per book): the package pays what this sample of books paid',
      stats: m.stats
    })),
    skipped_options: i.skippedOptions,
    limitations: [
      'Stake pays in tenths of the bet: each book\'s payoutMultiplier is the maths\' win rounded to the nearest 0.1×; stats.rounded_books counts the books this moved and stats.rtp vs stats.rtp_raw shows the effect.',
      'Every book starts from the state the game\'s start-up request leaves; state a component carries across rounds within a session does not carry between books.',
      'A pending player choice inside a book is answered by the choice policy, not by the player.'
    ]
  };
}

/** One line per mode for a toast: "base: 10,000 books, RTP 96.12% (hit 31.2%)". */
export function summariseStakeModes(modes: StakeModeExport[]): string {
  return modes
    .map((m) => {
      const s = m.stats;
      const flags: string[] = [];
      if (s.rounded_books > 0) flags.push(`${s.rounded_books} rounded to Stake's 0.1× grid (raw RTP ${(s.rtp_raw * 100).toFixed(2)}%)`);
      if (s.truncated_books > 0) flags.push(`${s.truncated_books} cut at the feature backstop`);
      if (s.capped_books > 0) flags.push(`${s.capped_books} hit the max-win cap`);
      // Oversampled: the package's RTP is an estimate of the simulation's; say how far it landed (2026-11-09:
      // ~0.1 point on a real slot at 1M rounds, sampling noise in the top payout bands).
      if (typeof s.rtp_simulated === 'number' && s.simulations && s.simulations > s.books) {
        flags.push(`simulated ${(s.rtp_simulated * 100).toFixed(2)}% over ${s.simulations.toLocaleString()} rounds (package ${((s.rtp - s.rtp_simulated) * 100 >= 0 ? '+' : '')}${((s.rtp - s.rtp_simulated) * 100).toFixed(2)} points)`);
      }
      return `${m.mode.name}: ${s.books.toLocaleString()} books, RTP ${(s.rtp * 100).toFixed(2)}%, hit ${(s.hit_rate * 100).toFixed(1)}%` +
        (flags.length ? ` — ${flags.join('; ')}` : '');
    })
    .join('\n');
}

// ─── The reviewer pack (2026-11-09) ─────────────────────────────────────────────────────────────────────────
// Engine's reviewers ask, per mode, for replay event ids of a normal win, a big win, a win cap, a loss and a
// bonus trigger, and check the rules screen against each mode's RTP, max win and cost. Those numbers are in the
// export; writing them down here saves the developer hunting through a million-line books file.

export interface ReplayEventIds {
  loss: number | null;
  normal_win: number | null;
  big_win: number | null;
  wincap: number | null;
  bonus: number | null;
}

/** Book ids (the replay URL's `event`) of the outcomes reviewers ask to see; null when the package has none. */
export function replayEventIds(rows: StakeLutRow[], cost: number): ReplayEventIds {
  const price = 100 * cost;
  let loss: number | null = null;
  let normal: number | null = null;
  let big: StakeLutRow | null = null;
  let wincap: number | null = null;
  let bonus: StakeLutRow | null = null;
  for (const r of rows) {
    if (loss === null && r.payout === 0) loss = r.id;
    if (normal === null && r.payout >= price && r.payout <= 5 * price && r.criteria !== 'freegame' && r.criteria !== 'wincap') normal = r.id;
    if (wincap === null && r.criteria === 'wincap') wincap = r.id;
    if (r.criteria === 'freegame' && r.payout > 0 && (!bonus || r.payout > bonus.payout)) bonus = r;
    if (r.criteria !== 'wincap' && (!big || r.payout > big.payout)) big = r;
  }
  return { loss, normal_win: normal, big_win: big && big.payout > 0 ? big.id : null, wincap, bonus: bonus ? bonus.id : null };
}

/** The checklist to hand in with the upload: numbers per mode, replay ids, and what a person must check by eye. */
export function stakeReviewChecklist(i: { gameName: string; modes: StakeModeExport[]; maxWinMultiplier: number | null }): string {
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const id = (v: number | null) => (v === null ? '— none in this package' : String(v));
  const lines: string[] = [`# Stake review pack — ${i.gameName}`, '', '## Modes (put these exact numbers on the rules screen)', ''];
  lines.push('| Mode | Cost | RTP | Max win | Hit rate |', '|---|---|---|---|---|');
  for (const m of i.modes) {
    lines.push(`| ${m.mode.name} | ${m.mode.cost}× | ${pct(m.stats.rtp)} | ${m.stats.max_multiplier}× | ${pct(m.stats.hit_rate)} |`);
  }
  const rtps = i.modes.map((m) => m.stats.rtp);
  const spread = rtps.length ? Math.max(...rtps) - Math.min(...rtps) : 0;
  lines.push('', `Stake's limits: every mode 96.00–96.70% and within 0.50% of the others (spread here ${pct(spread)}); cheapest mode exactly 1×; max win at most 1,000,000×.`);
  for (const m of i.modes) {
    const ids = replayEventIds(m.rows, m.mode.cost);
    lines.push('', `## Replay event ids — ${m.mode.name}`, '', `- Loss: ${id(ids.loss)}`, `- Normal win: ${id(ids.normal_win)}`, `- Big win: ${id(ids.big_win)}`, `- Win cap: ${id(ids.wincap)}`, `- Bonus trigger: ${id(ids.bonus)}`);
  }
  lines.push(
    '',
    '## Check by eye before submitting',
    '',
    '- [ ] Rules screen: symbol pays, RTP and max win per mode (table above), each mode\'s cost, free-spin trigger and retrigger rules',
    '- [ ] Mandatory disclaimer on the rules screen ("Malfunction voids all wins and plays… reload the game to finish any uncompleted rounds…")',
    '- [ ] Social mode (?social=true): no "bet", "buy", "pay", "cash", "gamble" in any text, rule or image; coins shown as GC / SC',
    '- [ ] Spacebar places a bet; sound toggle; autoplay asks for confirmation',
    '- [ ] A mode costing more than 2× asks for confirmation',
    '- [ ] Every bet level Stake offers can be selected; a reload keeps the chosen bet',
    '- [ ] The win counter counts up to the final payout',
    '- [ ] Replay (?replay=true&…&event=<id above>) plays with a "Play again" button and shows the real cost (bet × mode cost)',
    '- [ ] Desktop, mobile and small popout sizes; no console errors',
    '- [ ] Played on Engine with a test session: `npm run stake:check` and `node tools/stake-harness/cli.mjs engine <build> --session-url "<session URL>"` both pass'
  );
  return lines.join('\n') + '\n';
}

// ─── Stake's limits, checked on the export itself (2026-11-09) ──────────────────────────────────────────────
// What Studio refuses on upload (math-sdk utils/rgs_verification.py SUBMISSION_LIMITS, HEAD 2026-11-02) and what
// breaks a bonus without Studio noticing, from the weighted lookup table the export just wrote. Every problem
// carries `fix`, worded for the AI: the Stake job hands these back and the AI changes the maths and measures again.

export const STAKE_LIMITS = { minRtp: 0.96, maxRtp: 0.967, modeSpread: 0.005, maxCost: 50_000, maxWin: 1_000_000, minBaseStd: 0.6, minBooks: 100_000, maxWinOdds: 20_000_000 };

export interface StakeLimitProblem {
  level: 'error' | 'warn';
  code: string;
  mode: string | null;
  message: string;
  fix: string;
}

export interface StakeLimitsReport {
  ok: boolean;
  problems: StakeLimitProblem[];
  modes: { name: string; cost: number; rtp: number; std: number; maxWin: number; maxWinOdds: number | null; featureShare: number; books: number }[];
}

const pctOf = (x: number) => `${(x * 100).toFixed(2)}%`;

export function stakeLimitsCheck(modes: StakeModeExport[], opts: { maxWinMultiplier?: number | null; minBooks?: number } = {}): StakeLimitsReport {
  const L = { ...STAKE_LIMITS, ...(opts.minBooks ? { minBooks: opts.minBooks } : {}) };
  const problems: StakeLimitProblem[] = [];
  const add = (p: StakeLimitProblem) => problems.push(p);
  const per: StakeLimitsReport['modes'] = [];
  for (const m of modes) {
    let w = 0, x1 = 0, x2 = 0, feat = 0, maxP = 0, maxW = 0;
    for (const r of m.rows) {
      const weight = r.weight ?? 1;
      const x = r.payout / 100 / m.mode.cost;
      w += weight;
      x1 += weight * x;
      x2 += weight * x * x;
      if (r.criteria === 'freegame' || r.criteria === 'wincap') feat += weight;
      if (r.payout > maxP) {
        maxP = r.payout;
        maxW = weight;
      } else if (r.payout === maxP) maxW += weight;
    }
    const rtp = w ? x1 / w : 0;
    per.push({ name: m.mode.name, cost: m.mode.cost, rtp, std: w ? Math.sqrt(Math.max(0, x2 / w - rtp * rtp)) : 0, maxWin: maxP / 100, maxWinOdds: maxW ? w / maxW : null, featureShare: w ? feat / w : 0, books: m.rows.length });
  }
  if (!per.length) add({ level: 'error', code: 'NO_MODES', mode: null, message: 'Nothing was exported.', fix: 'Export again and read the error it gives.' });
  const cheapest = Math.min(...per.map((p) => p.cost));
  if (per.length && cheapest !== 1) add({ level: 'error', code: 'NO_BASE_COST_MODE', mode: null, message: `The cheapest mode costs ${cheapest}×; Stake needs one mode at exactly 1×.`, fix: 'Keep the base game at 1× the bet.' });
  const base = per.find((p) => p.cost === 1) || null;
  const anyBuy = modes.some((m) => m.mode.kind === 'buy');
  for (const p of per) {
    const kind = modes.find((m) => m.mode.name === p.name)!.mode.kind;
    if (p.rtp < L.minRtp || p.rtp > L.maxRtp) {
      const dir = p.rtp > L.maxRtp ? 'lower' : 'raise';
      add({ level: 'error', code: 'RTP_OUT_OF_BAND', mode: p.name, message: `${p.name}: RTP ${pctOf(p.rtp)}, outside Stake's ${pctOf(L.minRtp)}–${pctOf(L.maxRtp)}.`, fix: `${dir === 'lower' ? 'Lower' : 'Raise'} the ${p.name} mode's RTP by about ${pctOf(Math.abs(p.rtp - 0.9635))} toward 96.35%: ${kind === 'buy' ? 'change the bonus\'s payouts (free-spin multipliers or paytable during the feature)' : kind === 'special' ? 'change the ante\'s trigger boost or cost' : 'change symbol weights or base-game pays (not the feature, which the buy shares)'}; then measure again.` });
    }
    if (base && p !== base && Math.abs(p.rtp - base.rtp) > L.modeSpread) {
      add({ level: 'error', code: 'RTP_MODE_SPREAD', mode: p.name, message: `${p.name}: RTP ${pctOf(p.rtp)} is ${pctOf(Math.abs(p.rtp - base.rtp))} from base (${pctOf(base.rtp)}); Stake allows ${pctOf(L.modeSpread)}.`, fix: `Bring ${p.name} within 0.5% of the base game's RTP.` });
    }
    if (p.cost > L.maxCost) add({ level: 'error', code: 'COST_TOO_HIGH', mode: p.name, message: `${p.name} costs ${p.cost}×; Stake's limit is ${L.maxCost}×.`, fix: 'Lower the mode\'s price.' });
    if (p.maxWin > L.maxWin) add({ level: 'error', code: 'MAX_WIN_TOO_HIGH', mode: p.name, message: `${p.name} can pay ${p.maxWin}×; Stake's limit is ${L.maxWin.toLocaleString()}×.`, fix: 'Set the game\'s max win (cap) at or below 1,000,000×.' });
    if (p.maxWinOdds && p.maxWinOdds > L.maxWinOdds) add({ level: 'warn', code: 'MAX_WIN_UNREACHABLE', mode: p.name, message: `${p.name}: the top win (${p.maxWin}×) comes 1 in ${Math.round(p.maxWinOdds).toLocaleString()}; reviewers want it reachable (1 in 20,000,000 or better).`, fix: 'Lower the max win cap to what the maths actually reaches, or make the top outcomes less rare.' });
    if (kind === 'buy' && p.featureShare < 0.99) add({ level: 'error', code: 'BUY_NOT_IN_FEATURE', mode: p.name, message: `${p.name}: only ${pctOf(p.featureShare)} of bought rounds open the bonus — the rest are ordinary spins at the buy price.`, fix: 'Make the bought mode force the feature (Bet Mode.forceFeature into the scatter / trigger) and redeploy the maths.' });
    if (p.books < L.minBooks) add({ level: 'warn', code: 'FEW_BOOKS', mode: p.name, message: `${p.name}: ${p.books.toLocaleString()} books; Stake asks for 100,000–1,000,000.`, fix: 'For the final build export at least 100,000 books per mode.' });
  }
  if (base && base.std < L.minBaseStd) add({ level: 'error', code: 'BASE_STD_LOW', mode: base.name, message: `Base-game volatility (std ${base.std.toFixed(2)}) is under Stake's ${L.minBaseStd}.`, fix: 'Make the base game more volatile (bigger top pays, rarer wins).' });
  if (base && anyBuy && base.featureShare === 0) add({ level: 'error', code: 'BASE_NEVER_TRIGGERS_FEATURE', mode: base.name, message: 'The base game never reaches its bonus in the books, though a buy mode shows it has one.', fix: 'Use Calculate Free Spins States (or variables in_feature + feature_rounds_remaining) so the exporter sees the free spins, and check the natural trigger fires.' });
  if (opts.maxWinMultiplier == null) add({ level: 'warn', code: 'NO_MAX_WIN_CAP', mode: null, message: 'The game has no max win cap on XGENIA RGS, so books are uncapped.', fix: 'Set the game\'s max win (the export\'s maxWin, or the game\'s settings on XGENIA RGS).' });
  for (const m of modes) if (m.stats.truncated_books > 0) add({ level: 'warn', code: 'BOOK_TRUNCATED', mode: m.mode.name, message: `${m.mode.name}: ${m.stats.truncated_books} books were cut mid-feature (a feature that never ended).`, fix: 'Make sure the feature always ends (spins left reaches 0).' });
  return { ok: !problems.some((p) => p.level === 'error'), problems, modes: per };
}
