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
      rule: 'book i is played from Isaac.fromHex(sha256(master_seed + ":" + i)); the start-up request runs once from index -1 and its state opens every book'
    },
    declared_rtp: i.declaredRtp ?? null,
    modes: i.modes.map((m) => ({
      name: m.mode.name,
      cost: m.mode.cost,
      kind: m.mode.kind,
      option_id: m.mode.optionId,
      files: { events: stakeBooksFileName(m.mode.name), weights: stakeLookupFileName(m.mode.name) },
      weights: 'uniform (1 per book) — the Math SDK\'s unoptimised table; run its optimizer on the CSV to target an RTP',
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
      return `${m.mode.name}: ${s.books.toLocaleString()} books, RTP ${(s.rtp * 100).toFixed(2)}%, hit ${(s.hit_rate * 100).toFixed(1)}%` +
        (flags.length ? ` — ${flags.join('; ')}` : '');
    })
    .join('\n');
}
