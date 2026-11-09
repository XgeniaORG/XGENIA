// Export a deployed Math Component as Stake Engine books — on XGENIA RGS, written here.
//
// "Deploy to Stake" shipped a front end and no maths. Stake's RGS plays from pre-simulated
// books it is given at upload (see stakeMathsFormat.ts for the files), and the only thing that
// can produce books describing THE deployed game is the platform that runs it: XGENIA RGS
// plays the row `rgs-fn` serves, through its own sandbox, with the same charging, feature,
// choice and win-cap rules as a live round (`_shared/stake-books.ts`). This module drives that
// and writes what comes back.
//
// ─── THE CHUNK LOOP ───────────────────────────────────────────
//
// An edge isolate is CPU-killed near 2s, so `export-stake-books` plays what fits one call and
// returns the books it made as JSON lines, plus a `carry` of running statistics, the
// `startup_state` every book opens from and `next_id`. This loop sends all three straight back
// until `complete`, mode by mode. Books are seeded by (master seed, id), so where the chunks
// fall changes nothing — XRGS `tests/unit/stake-books.test.ts` proves a split run writes the
// same bytes as an unsplit one.
//
// The master seed is minted by the platform on the FIRST chunk and reused for every later chunk
// and every mode of the run; it is written to the manifest, which is what makes any book
// re-derivable in a dispute. The manifest therefore lives OUTSIDE the directory uploaded to
// Stake.
//
// ─── WHAT IS WRITTEN ──────────────────────────────────────────
//
//   <folder>/math/publish_files/index.json                 ← upload THIS directory as the math
//   <folder>/math/publish_files/books_<mode>.jsonl.zst
//   <folder>/math/publish_files/lookUpTable_<mode>_0.csv
//   <folder>/math/xgenia-stake-export.json                 ← provenance + stats, keep private
//
// zstd comes from Node's zlib (22.15+ / Electron 36+). An older runtime cannot write the one
// format Stake accepts, so the export refuses rather than writing a `.jsonl` nobody can upload.

import { filesystem, platform } from '@xgenia/platform';

import { rgsFunctionsUrl, rgsHeaders } from '@xgenia-utils/rgs/rgsClient';

import {
  buildStakeExportManifest,
  lookupTableCsv,
  lookupTableRtp,
  strataWeightedRows,
  stakeBooksFileName,
  stakeIndexJson,
  stakeLookupFileName,
  verifyStakeMode,
  type StakeLutRow,
  type StakeModeExport,
  type StakeModeInfo,
  type StakeModeStats
} from './stakeMathsFormat';

/** What `stake-export-modes` says about a component before a run is committed to. */
export interface StakeExportModesInfo {
  functionSlug: string;
  functionName: string | null;
  game: { name: string | null; slug: string | null; declared_rtp: unknown } | null;
  modes: StakeModeInfo[];
  skippedOptions: string[];
  betInputPort: string | null;
  winOutputPort: string;
  maxWinMultiplier: number | null;
  defaultBet: number;
  scriptSha256: string | null;
  maxBooksPerMode: number;
}

async function postMathsDeployer(apiKey: string, body: Record<string, unknown>, outOfDateHint: string): Promise<any> {
  const res = await fetch(`${rgsFunctionsUrl()}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    // A stale RGS backend — deployed before these actions existed — answers with "Invalid
    // action. Use: …". Say what to do rather than dumping the action list at the user.
    if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes(String(body.action))) {
      throw new Error(outOfDateHint);
    }
    throw new Error(serverError || `XGENIA RGS request failed (HTTP ${res.status})`);
  }
  return data;
}

const OUT_OF_DATE =
  'XGENIA RGS backend is out of date — it cannot export Stake books yet. ' +
  'Try again later; if it keeps happening, contact XGENIA support.';

export async function fetchStakeExportModes(apiKey: string, deploymentId: string, functionSlug: string): Promise<StakeExportModesInfo> {
  const d = await postMathsDeployer(apiKey, { action: 'stake-export-modes', deployment_id: deploymentId, function_slug: functionSlug }, OUT_OF_DATE);
  return {
    functionSlug: String(d.function_slug || functionSlug),
    functionName: d.function_name ?? null,
    game: d.game ?? null,
    modes: Array.isArray(d.modes) ? d.modes : [],
    skippedOptions: Array.isArray(d.skipped_options) ? d.skipped_options : [],
    betInputPort: d.bet_input_port ?? null,
    winOutputPort: String(d.win_output_port || ''),
    maxWinMultiplier: typeof d.max_win_multiplier === 'number' ? d.max_win_multiplier : null,
    defaultBet: Number(d.default_bet) > 0 ? Math.floor(Number(d.default_bet)) : 100,
    scriptSha256: d.script_sha256 ?? null,
    maxBooksPerMode: Number(d.max_books_per_mode) > 0 ? Number(d.max_books_per_mode) : 1_000_000
  };
}

/**
 * The request a mode's books are played from (XRGS `stake-auto-setup`, stake-plan.ts — Abel's Stake compiler,
 * merged 2026-11-09). The platform plays the component under candidate requests until one is a whole paid round
 * for that mode: the game's own spin request when it is (null), otherwise a trigger + inputs (a buy found on
 * the Bet Mode's `mode` input, a Mines game's AutoBet + mines count). Its refusals are worded for the author.
 */
export async function findStakeRoundRequest(apiKey: string, deploymentId: string, functionSlug: string, mode: string, bet: number, choicePolicy: string): Promise<{ roundRequest: unknown | null; label: string; rtp: number }> {
  let cursor = 0;
  let closest: unknown = null;
  let defaultProblem: string | null = null;
  for (let calls = 0; calls < 200; calls++) {
    const d = await postMathsDeployer(
      apiKey,
      { action: 'stake-auto-setup', deployment_id: deploymentId, function_slug: functionSlug, mode, bet, choice_policy: choicePolicy, cursor, closest, default_problem: defaultProblem },
      OUT_OF_DATE
    );
    if (d.status === 'found') return { roundRequest: d.round_request ?? null, label: String(d.label || ''), rtp: Number(d.rtp) || 0 };
    if (d.status === 'refused') {
      const why = d.code === 'stale_compile' ? 'it was compiled by an older editor — deploy the maths again from this editor, then export' : String(d.message || d.error || 'no request plays a whole round');
      throw new Error(`Mode ${mode}: ${why}`);
    }
    if (!(Number(d.cursor) > cursor)) throw new Error(`Mode ${mode}: the platform's search made no progress — stopping rather than retrying for ever.`);
    cursor = Number(d.cursor);
    closest = d.closest ?? null;
    defaultProblem = d.default_problem ?? null;
  }
  throw new Error(`Mode ${mode}: the search for its paid round did not finish.`);
}

/**
 * Books written as they arrive, zstd-compressed on the way to disk (2026-11-09): the export held every line in
 * memory and joined a whole mode into one string, past V8's string limit at ~1M books — a run that failed at
 * the very end. Falls back to the one-shot compressor (smaller runs) where Node has no streaming zstd.
 */
function openBooksWriter(path: string, compressAll: (input: Buffer) => Buffer): { write(lines: string[]): void; close(): Promise<void> } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const zlib = require('zlib');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    if (typeof zlib.createZstdCompress === 'function') {
      const z = zlib.createZstdCompress();
      const out = fs.createWriteStream(path);
      z.pipe(out);
      const done = new Promise<void>((resolve, reject) => {
        out.on('finish', () => resolve());
        out.on('error', reject);
        z.on('error', reject);
      });
      return {
        write(lines: string[]) {
          if (lines.length) z.write(lines.join('\n') + '\n');
        },
        close() {
          z.end();
          return done;
        }
      };
    }
  } catch {
    /* no node integration: buffer below */
  }
  const buffered: string[] = [];
  return {
    write(lines: string[]) {
      for (const l of lines) buffered.push(l);
    },
    async close() {
      await filesystem.writeFileOverride(path, compressAll(Buffer.from(buffered.join('\n') + '\n', 'utf8')));
    }
  };
}

export interface StakeExportProgress {
  mode: string;
  modeIndex: number;
  modeCount: number;
  books: number;
  booksPerMode: number;
  chunks: number;
}

export interface StakeExportOptions {
  apiKey: string;
  game: { id: string; slug?: string; name?: string } | null;
  deploymentId: string;
  functionSlug: string;
  /** The folder the front end was exported to; the maths lands in `<folder>/math/`. */
  outputDir: string;
  booksPerMode: number;
  /** Base stake in minor units; the platform's default for the game when omitted. */
  bet?: number;
  /** Only `base` and the named modes; every mode the component declares when omitted. */
  modes?: string[];
  choicePolicy?: 'default' | 'random';
  /**
   * Rounds simulated per book (XRGS I-138): every rare round (win cap, base-game feature, ≥10× the price) is
   * kept, the rest sampled 1-in-N and weighted back, so rare outcomes are in the package and its RTP is the
   * simulation's. Default 10; 1 writes the old uniform package.
   */
  oversample?: number;
  booksPerChunk?: number;
  onProgress?: (p: StakeExportProgress) => void;
  /** Polled between chunks — the only place a run can stop, and it costs nothing. */
  shouldCancel?: () => boolean;
}

export interface StakeExportResult {
  /** `<folder>/math` */
  dir: string;
  /** `<folder>/math/publish_files` — what to upload to Stake as the game's math. */
  publishDir: string;
  manifestPath: string;
  modes: StakeModeExport[];
  info: StakeExportModesInfo;
  bet: number;
  masterSeed: string;
  cancelled: boolean;
  /** Round-trips the run took. */
  chunks: number;
}

/** Node's zstd, or null on a runtime without it. */
function zstdCompressor(): ((input: Buffer) => Buffer) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const zlib = require('zlib');
    if (typeof zlib.zstdCompressSync === 'function') return (input: Buffer) => zlib.zstdCompressSync(input);
  } catch {
    /* no node integration */
  }
  return null;
}

export function stakePublishDir(outputDir: string): string {
  return filesystem.join(filesystem.join(outputDir, 'math'), 'publish_files');
}

export async function exportStakeMaths(opts: StakeExportOptions): Promise<StakeExportResult> {
  const compress = zstdCompressor();
  if (!compress) {
    throw new Error(
      "This editor's runtime has no zstd compressor (Node 22.15+ / Electron 36+ needed), and Stake only accepts " +
        'zstd-compressed books. Update the editor and export again.'
    );
  }

  const info = await fetchStakeExportModes(opts.apiKey, opts.deploymentId, opts.functionSlug);
  const wanted = opts.modes && opts.modes.length ? info.modes.filter((m) => opts.modes!.includes(m.name)) : info.modes;
  if (wanted.length === 0) throw new Error('No bet modes to export.');
  const booksPerMode = Math.max(1, Math.min(Math.floor(opts.booksPerMode), info.maxBooksPerMode));
  const bet = Math.floor(opts.bet && opts.bet > 0 ? opts.bet : info.defaultBet);
  const choicePolicy = opts.choicePolicy ?? 'default';
  const oversample = Math.max(1, Math.min(100, Math.floor(opts.oversample ?? 10)));
  const roundRequests: Record<string, unknown> = {};

  const dir = filesystem.join(opts.outputDir, 'math');
  const publishDir = stakePublishDir(opts.outputDir);
  await filesystem.makeDirectory(publishDir);

  let masterSeed: string | undefined;
  let chunks = 0;
  const done: StakeModeExport[] = [];

  for (let mi = 0; mi < wanted.length; mi++) {
    const mode = wanted[mi];
    // Which request is this mode's paid round? (A buy is often not the game's own spin request.)
    const plan = await findStakeRoundRequest(opts.apiKey, opts.deploymentId, opts.functionSlug, mode.name, bet, choicePolicy);
    if (plan.roundRequest) roundRequests[mode.name] = plan.roundRequest;
    const writer = openBooksWriter(filesystem.join(publishDir, stakeBooksFileName(mode.name)), compress);
    const payouts: number[] = [];
    const rows: StakeLutRow[] = [];
    let carry: unknown = undefined;
    let startupState: unknown = undefined;
    let nextId = 0;
    let stats: StakeModeStats | null = null;
    let lastBooks = 0;
    let jsonlBytes = 0;

    for (;;) {
      if (opts.shouldCancel?.()) {
        await writer.close().catch(() => undefined);
        return { dir, publishDir, manifestPath: '', modes: done, info, bet, masterSeed: masterSeed || '', cancelled: true, chunks };
      }
      const d = await postMathsDeployer(
        opts.apiKey,
        {
          action: 'export-stake-books',
          deployment_id: opts.deploymentId,
          function_slug: opts.functionSlug,
          mode: mode.name,
          book_count: booksPerMode,
          bet,
          master_seed: masterSeed,
          next_id: nextId,
          carry,
          startup_state: startupState,
          books_per_chunk: opts.booksPerChunk,
          choice_policy: choicePolicy,
          oversample,
          ...(plan.roundRequest ? { round_request: plan.roundRequest } : {})
        },
        OUT_OF_DATE
      );
      chunks++;
      if (!masterSeed) masterSeed = String(d.master_seed);
      else if (d.master_seed !== masterSeed) throw new Error('The platform changed the master seed mid-run; the books would not be reproducible. Export again.');

      const got: string[] = Array.isArray(d.lines) ? d.lines : [];
      const gotRows: StakeLutRow[] = Array.isArray(d.rows) ? d.rows : [];
      if (got.length !== gotRows.length) throw new Error('The platform returned books and lookup rows of different lengths.');
      for (const l of got) {
        jsonlBytes += l.length + 1;
        const m = /"payoutMultiplier":\s*(-?\d+)/.exec(l);
        payouts.push(m ? Number(m[1]) : NaN);
      }
      writer.write(got);
      rows.push(...gotRows);
      stats = d.stats ?? stats;
      carry = d.carry;
      startupState = d.startup_state;

      // A chunk that advanced nothing would loop for ever; the platform plays at least one
      // book per call, so this only fires if that contract is broken.
      if (!(Number(d.next_id) > nextId)) throw new Error('The platform returned no progress for this export — stopping rather than retrying for ever.');
      nextId = Number(d.next_id);
      opts.onProgress?.({ mode: mode.name, modeIndex: mi, modeCount: wanted.length, books: Math.floor(nextId / oversample), booksPerMode, chunks });
      lastBooks = nextId;
      if (d.complete) break;
    }
    await writer.close();
    if (!stats) throw new Error(`No statistics came back for mode ${mode.name}.`);
    if (lastBooks !== booksPerMode * oversample) throw new Error(`Mode ${mode.name} simulated ${lastBooks} rounds, not the ${booksPerMode * oversample} asked for.`);

    // Weights from the simulation's own counts; then refuse before writing what Stake would refuse after uploading.
    const weighted = strataWeightedRows(rows, stats.strata, oversample);
    const lut = lookupTableCsv(weighted);
    const problems = verifyStakeMode(lut, payouts);
    if (problems.length > 0) {
      throw new Error(`Mode ${mode.name} would be refused by Stake: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`);
    }
    await filesystem.writeFileOverride(filesystem.join(publishDir, stakeLookupFileName(mode.name)), lut);

    // What Stake will pay: the table's own RTP, not the unweighted sample's.
    done.push({ mode, rows: weighted, stats: { ...stats, rtp: lookupTableRtp(weighted, mode.cost) }, jsonlBytes });
  }

  await filesystem.writeFileOverride(filesystem.join(publishDir, 'index.json'), stakeIndexJson(done.map((m) => m.mode)));

  let editorVersion: string | undefined;
  try {
    const v = platform.getVersion();
    editorVersion = v ? String(v) : undefined;
  } catch {
    /* not available */
  }
  const manifestPath = filesystem.join(dir, 'xgenia-stake-export.json');
  await filesystem.writeFileOverride(
    manifestPath,
    JSON.stringify(
      buildStakeExportManifest({
        game: opts.game,
        deploymentId: opts.deploymentId,
        functionSlug: info.functionSlug,
        functionName: info.functionName,
        scriptSha256: info.scriptSha256,
        masterSeed: masterSeed || '',
        bet,
        maxWinMultiplier: info.maxWinMultiplier,
        choicePolicy,
        declaredRtp: info.game?.declared_rtp ?? null,
        modes: done,
        skippedOptions: info.skippedOptions,
        oversample,
        roundRequests,
        editorVersion
      }),
      null,
      2
    )
  );

  return { dir, publishDir, manifestPath, modes: done, info, bet, masterSeed: masterSeed || '', cancelled: false, chunks };
}
