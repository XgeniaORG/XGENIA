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

import { XRGS_URL, rgsHeaders } from '@xgenia-utils/rgs/rgsClient';

import {
  buildStakeExportManifest,
  lookupTableCsv,
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
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
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
  'Redeploy the `maths-deployer` function to the RGS project, then try again.';

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

  const dir = filesystem.join(opts.outputDir, 'math');
  const publishDir = stakePublishDir(opts.outputDir);
  await filesystem.makeDirectory(publishDir);

  let masterSeed: string | undefined;
  let chunks = 0;
  const done: StakeModeExport[] = [];

  for (let mi = 0; mi < wanted.length; mi++) {
    const mode = wanted[mi];
    const lines: string[] = [];
    const rows: StakeLutRow[] = [];
    let carry: unknown = undefined;
    let startupState: unknown = undefined;
    let nextId = 0;
    let stats: StakeModeStats | null = null;
    let lastBooks = 0;
    let jsonlBytes = 0;

    for (;;) {
      if (opts.shouldCancel?.()) {
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
          choice_policy: choicePolicy
        },
        OUT_OF_DATE
      );
      chunks++;
      if (!masterSeed) masterSeed = String(d.master_seed);
      else if (d.master_seed !== masterSeed) throw new Error('The platform changed the master seed mid-run; the books would not be reproducible. Export again.');

      const got: string[] = Array.isArray(d.lines) ? d.lines : [];
      const gotRows: StakeLutRow[] = Array.isArray(d.rows) ? d.rows : [];
      if (got.length !== gotRows.length) throw new Error('The platform returned books and lookup rows of different lengths.');
      for (const l of got) jsonlBytes += l.length + 1;
      lines.push(...got);
      rows.push(...gotRows);
      stats = d.stats ?? stats;
      carry = d.carry;
      startupState = d.startup_state;

      // A chunk that advanced nothing would loop for ever; the platform plays at least one
      // book per call, so this only fires if that contract is broken.
      if (!(Number(d.next_id) > nextId)) throw new Error('The platform returned no progress for this export — stopping rather than retrying for ever.');
      nextId = Number(d.next_id);
      opts.onProgress?.({ mode: mode.name, modeIndex: mi, modeCount: wanted.length, books: nextId, booksPerMode, chunks });
      lastBooks = nextId;
      if (d.complete) break;
    }
    if (!stats) throw new Error(`No statistics came back for mode ${mode.name}.`);

    // Refuse before writing what Stake would refuse after uploading.
    const lut = lookupTableCsv(rows);
    const payouts = lines.map((l) => {
      const m = /"payoutMultiplier":\s*(-?\d+)/.exec(l);
      return m ? Number(m[1]) : NaN;
    });
    const problems = verifyStakeMode(lut, payouts);
    if (problems.length > 0) {
      throw new Error(`Mode ${mode.name} would be refused by Stake: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`);
    }

    await filesystem.writeFileOverride(filesystem.join(publishDir, stakeBooksFileName(mode.name)), compress(Buffer.from(lines.join('\n') + '\n', 'utf8')));
    await filesystem.writeFileOverride(filesystem.join(publishDir, stakeLookupFileName(mode.name)), lut);
    lines.length = 0;

    done.push({ mode, rows, stats, jsonlBytes });
    if (lastBooks !== booksPerMode) throw new Error(`Mode ${mode.name} wrote ${lastBooks} books, not the ${booksPerMode} asked for.`);
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
        editorVersion
      }),
      null,
      2
    )
  );

  return { dir, publishDir, manifestPath, modes: done, info, bet, masterSeed: masterSeed || '', cancelled: false, chunks };
}
