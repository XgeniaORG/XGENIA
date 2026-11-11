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

import type { DeclaredStakeMode } from './stakeModes';

import {
  buildStakeExportManifest,
  lookupTableCsv,
  reweightSampledBooks,
  stakeModesWithSetups,
  stakeReviewChecklist,
  stakeBooksFileName,
  stakeIndexJson,
  stakeLookupFileName,
  verifyStakeMode,
  type StakeLutRow,
  type StakeModeExport,
  type StakeModeInfo,
  type StakeModeStats,
  type StakePlaySetup,
  type StakeRoundRequest
} from './stakeMathsFormat';
import { stakeExportNotes } from './stakeExportNotes';

export { stakeExportNotes };

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
  /** 0 when the RGS predates oversampling (it then plays every round as a book, at weight 1). */
  maxOversample: number;
  maxSimulationsPerMode: number;
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
    throw stakeError(serverError || `XGENIA RGS request failed (HTTP ${res.status})`, data?.code);
  }
  return data;
}

/**
 * What the RGS found, by kind (XRGS maths-deployer): `stale_compile` — the deployed copy was built by an
 * old compiler and only a redeploy fixes it, which the Deploy to Stake tab does by itself; `no_round` —
 * nothing the component answers to is a whole paid round, a real fault in the maths; `maths_error` —
 * the maths threw while being played.
 */
export type StakeErrorCode = 'stale_compile' | 'no_round' | 'maths_error';

export function stakeError(message: string, code?: unknown): Error & { stakeCode?: StakeErrorCode } {
  const e: Error & { stakeCode?: StakeErrorCode } = new Error(message);
  if (code === 'stale_compile' || code === 'no_round' || code === 'maths_error') e.stakeCode = code;
  return e;
}

export function stakeErrorCode(e: unknown): StakeErrorCode | null {
  return (e as { stakeCode?: StakeErrorCode } | null)?.stakeCode ?? null;
}

/** Books replayed at the start of each mode to prove the package re-derives from its seed. */
const REPLAY_CHECK_BOOKS = 20;

/**
 * Rounds simulated per book asked for (XRGS stake-books.ts, RARE ROUNDS KEPT, 2026-11-09). Every max-win,
 * feature and big-win round is kept, the rest are a 1-in-N sample weighted N: the package pays what the
 * maths pays and holds the rare rounds a plain sample of the same size would miss.
 */
export const STAKE_DEFAULT_OVERSAMPLE = 10;

const OUT_OF_DATE =
  'XGENIA RGS backend is out of date — it cannot export Stake books yet. ' +
  'Try again later; if it keeps happening, contact XGENIA support.';

export async function fetchStakeExportModes(apiKey: string, deploymentId: string, functionSlug: string, stakeModes: DeclaredStakeMode[] = []): Promise<StakeExportModesInfo> {
  const d = await postMathsDeployer(
    apiKey,
    { action: 'stake-export-modes', deployment_id: deploymentId, function_slug: functionSlug, ...(stakeModes.length ? { stake_modes: stakeModes } : {}) },
    OUT_OF_DATE
  );
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
    maxBooksPerMode: Number(d.max_books_per_mode) > 0 ? Number(d.max_books_per_mode) : 1_000_000,
    maxOversample: Number(d.max_oversample) > 0 ? Math.floor(Number(d.max_oversample)) : 0,
    maxSimulationsPerMode: Number(d.max_simulations_per_mode) > 0 ? Number(d.max_simulations_per_mode) : 0
  };
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
  /** 'setup': the platform is playing the component to find its paid round; 'books': writing a mode. */
  phase?: 'setup' | 'books';
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
   * The modes the game's maths declares (stakeModes.ts, read off the Bet Mode node). Used by the platform when
   * the component has no priced options of its own; without it an editor game exports `base` alone.
   */
  stakeModes?: DeclaredStakeMode[];
  /** Named rounds to export as modes, in place of the guessed base round (stakeMathsFormat: PLAY SETUPS). */
  playSetups?: StakePlaySetup[];
  booksPerChunk?: number;
  /**
   * Rounds simulated per book (XRGS SYSTEM_MAP I-170): every rare round (win cap, base-game feature, ≥10× the price) is
   * kept, the rest sampled 1-in-N and weighted back, so rare outcomes are in the package and its RTP is the
   * simulation's. STAKE_DEFAULT_OVERSAMPLE when omitted; 1 writes the old uniform package.
   */
  oversample?: number;
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
  /** Per mode: the paid round the platform found by playing the component, where its own request was not one. */
  autoSetups: Record<string, StakeAutoSetup>;
  /** Things worth knowing that do not stop the export (stakeExportNotes). */
  notes: string[];
}


/** What `stake-auto-setup` found: the request each book is played from, and how it played. */
export interface StakeAutoSetup {
  roundRequest: StakeRoundRequest;
  label: string;
  rtp: number;
  hitRate: number;
}

/**
 * Let the platform find the request that is one paid round (XRGS _shared/stake-autoplay.ts), so an author
 * does not have to: MinesMaths needed AutoBet with a mines count and tiles, a re-seed and a fixed client
 * seed, and each was its own failed export before. Null when the game's own request already is one —
 * then nothing about the export changes. A platform without the action answers as before (null).
 */
export async function findStakeAutoSetup(
  apiKey: string,
  deploymentId: string,
  functionSlug: string,
  bet: number,
  mode: string,
  onStep?: (tried: number) => void,
  shouldCancel?: () => boolean,
  extra: { choicePolicy?: string; stakeModes?: DeclaredStakeMode[] } = {}
): Promise<StakeAutoSetup | null> {
  let cursor = 0;
  let closest: unknown = null;
  let defaultProblem: string | null = null;
  const stakeModes = extra.stakeModes ?? [];
  for (let call = 0; call < 200; call++) {
    if (shouldCancel?.()) return null;
    let d: any;
    try {
      d = await postMathsDeployer(
        apiKey,
        {
          action: 'stake-auto-setup',
          deployment_id: deploymentId,
          function_slug: functionSlug,
          bet,
          mode,
          cursor,
          closest,
          default_problem: defaultProblem,
          ...(extra.choicePolicy ? { choice_policy: extra.choicePolicy } : {}),
          ...(stakeModes.length ? { stake_modes: stakeModes } : {})
        },
        AUTO_SETUP_UNAVAILABLE
      );
    } catch (e) {
      // An RGS from before the action plays the game's own request, exactly as it always did.
      if (e instanceof Error && e.message === AUTO_SETUP_UNAVAILABLE) return null;
      throw e;
    }
    if (d.status === 'refused') throw stakeError(String(d.error || d.message || 'No paid round was found.'), d.code);
    if (d.status === 'found') {
      if (!d.round_request) return null;
      return { roundRequest: d.round_request, label: String(d.label || ''), rtp: Number(d.rtp) || 0, hitRate: Number(d.hit_rate) || 0 };
    }
    if (!(Number(d.cursor) > cursor)) throw new Error("The platform made no progress finding this game's paid round — stopping rather than retrying for ever.");
    cursor = Number(d.cursor);
    closest = d.closest ?? null;
    defaultProblem = d.default_problem ?? null;
    onStep?.(Number(d.tried) || cursor);
  }
  throw new Error("Finding this game's paid round took too long. Name it in Play setups and export again.");
}

const AUTO_SETUP_UNAVAILABLE = '__stake_auto_setup_unavailable__';

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

/** An export failure, with what the platform said about the component — the diagnosis reads its ports. */
export type StakeExportFailure = Error & { stakeInfo?: StakeExportModesInfo | null };

export async function exportStakeMaths(opts: StakeExportOptions): Promise<StakeExportResult> {
  let seen: StakeExportModesInfo | null = null;
  try {
    return await runStakeExport(opts, (i) => {
      seen = i;
    });
  } catch (e) {
    const failure: StakeExportFailure = e instanceof Error ? e : stakeError(String(e));
    failure.stakeInfo = seen;
    throw failure;
  }
}

async function runStakeExport(opts: StakeExportOptions, onInfo: (info: StakeExportModesInfo) => void): Promise<StakeExportResult> {
  const compress = zstdCompressor();
  if (!compress) {
    throw new Error(
      "This editor's runtime has no zstd compressor (Node 22.15+ / Electron 36+ needed), and Stake only accepts " +
        'zstd-compressed books. Update the editor and export again.'
    );
  }

  const stakeModes = opts.stakeModes ?? [];
  const choicePolicy = opts.choicePolicy ?? 'default';
  const info = await fetchStakeExportModes(opts.apiKey, opts.deploymentId, opts.functionSlug, stakeModes);
  onInfo(info);
  const bet = Math.floor(opts.bet && opts.bet > 0 ? opts.bet : info.defaultBet);

  const declared = stakeModesWithSetups(info.modes, opts.playSetups ?? []);
  let wanted = opts.modes && opts.modes.length ? declared.filter((m) => opts.modes!.includes(m.name)) : declared;
  if (wanted.length === 0) throw new Error('No bet modes to export.');

  // Every mode — base, each feature buy, each special bet — is played by the platform at its own price
  // to find the request that is one paid round in THAT mode, before any book is written: a buy can be a
  // different request from the base game, and a mode nothing plays fails the export now, not an hour in.
  // A mode the author named in Play setups is taken as written.
  const autoSetups: Record<string, StakeAutoSetup> = {};
  for (let mi = 0; mi < wanted.length; mi++) {
    const m = wanted[mi];
    if (m.roundRequest) continue;
    const step = (tried: number) =>
      opts.onProgress?.({ phase: 'setup', mode: m.name, modeIndex: mi, modeCount: wanted.length, books: tried, booksPerMode: 0, chunks: 0 });
    step(0);
    let found: StakeAutoSetup | null;
    try {
      found = await findStakeAutoSetup(opts.apiKey, opts.deploymentId, opts.functionSlug, bet, m.name, step, opts.shouldCancel, { choicePolicy, stakeModes });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw stakeError(wanted.length > 1 ? `Mode ${m.name}: ${why}` : why, stakeErrorCode(e));
    }
    if (found) autoSetups[m.name] = found;
  }
  wanted = wanted.map((m) => (autoSetups[m.name] ? { ...m, roundRequest: autoSetups[m.name].roundRequest } : m));
  const booksPerMode = Math.max(1, Math.min(Math.floor(opts.booksPerMode), info.maxBooksPerMode));
  // Oversample only on an RGS that says it can (max_oversample). (2026-11-10) One that does not — production
  // before the Stake compiler ships — ignores `oversample` and plays book_count rounds, and the check below
  // (rounds played = books × oversample) then failed EVERY export: "simulated N rounds, not the 10N asked for".
  const asked = Math.floor(opts.oversample ?? STAKE_DEFAULT_OVERSAMPLE);
  const oversample =
    info.maxOversample > 0
      ? Math.max(
          1,
          Math.min(
            asked,
            info.maxOversample,
            info.maxSimulationsPerMode > 0 ? Math.floor(info.maxSimulationsPerMode / booksPerMode) : Infinity
          )
        )
      : 1;
  const sampling = oversample > 1 ? { oversample } : {};
  const roundsPerMode = booksPerMode * oversample;
  const roundRequests: Record<string, unknown> = {};

  const dir = filesystem.join(opts.outputDir, 'math');
  const publishDir = stakePublishDir(opts.outputDir);
  await filesystem.makeDirectory(publishDir);

  let masterSeed: string | undefined;
  let chunks = 0;
  const done: StakeModeExport[] = [];

  for (let mi = 0; mi < wanted.length; mi++) {
    const mode = wanted[mi];
    // This mode's paid round: named in Play setups, or found by stake-auto-setup above (null = the game's own request).
    if (mode.roundRequest) roundRequests[mode.name] = mode.roundRequest;
    const modeRequest = {
      ...sampling,
      ...(stakeModes.length ? { stake_modes: stakeModes } : {}),
      ...(mode.roundRequest ? { round_request: mode.roundRequest } : {})
    };
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
        return { dir, publishDir, manifestPath: '', modes: done, info, bet, masterSeed: masterSeed || '', cancelled: true, chunks, autoSetups, notes: [] };
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
          ...modeRequest
        },
        OUT_OF_DATE
      );
      chunks++;
      if (!masterSeed) masterSeed = String(d.master_seed);
      else if (d.master_seed !== masterSeed) throw new Error('The platform changed the master seed mid-run; the books would not be reproducible. Export again.');

      const got: string[] = Array.isArray(d.lines) ? d.lines : [];
      const gotRows: StakeLutRow[] = Array.isArray(d.rows) ? d.rows : [];
      if (got.length !== gotRows.length) throw new Error('The platform returned books and lookup rows of different lengths.');

      // (2026-11-03) A book must be fixed by (master seed, id) — the manifest promises it, and a dispute
      // or a lab re-derives from it. MinesEngine mixed Date.now() into its client seed, so the same book
      // came back a different board each time and nothing said so. Replay the first books and compare
      // what they PAY: an id or a timestamp the maths writes into its response (KenoEngine's bet_id) changes
      // the bytes but not the game, while a moving board flips about half of twenty payouts.
      if (nextId === 0 && got.length > 0) {
        // Oversampled, a chunk of N rounds keeps about N / oversample books: replay enough rounds for ~20.
        const probe = Math.min(REPLAY_CHECK_BOOKS, gotRows.length) * oversample;
        const again = await postMathsDeployer(
          opts.apiKey,
          {
            action: 'export-stake-books',
            deployment_id: opts.deploymentId,
            function_slug: opts.functionSlug,
            mode: mode.name,
            book_count: booksPerMode,
            bet,
            master_seed: masterSeed,
            next_id: 0,
            books_per_chunk: probe,
            choice_policy: choicePolicy,
            ...modeRequest
          },
          OUT_OF_DATE
        );
        chunks++;
        const replayed: StakeLutRow[] = Array.isArray(again.rows) ? again.rows : [];
        const compared = Math.min(replayed.length, gotRows.length);
        const moved = gotRows.slice(0, compared).findIndex((r, i) => replayed[i].payout !== r.payout || (replayed[i].weight ?? 1) !== (r.weight ?? 1));
        if (compared === 0 || moved !== -1) {
          throw new Error(
            `Mode ${mode.name}: book ${Math.max(moved, 0)} paid differently when played again from the same seed, so no book in this ` +
              'package could be re-derived for a dispute or a test lab. The maths draws on something other than the ' +
              "round's RNG — look for Date.now(), a timestamp or a counter feeding a seed or an outcome, and derive it from the RNG instead."
          );
        }
      }
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
      opts.onProgress?.({ phase: 'books', mode: mode.name, modeIndex: mi, modeCount: wanted.length, books: nextId, booksPerMode: roundsPerMode, chunks });
      lastBooks = nextId;
      if (d.complete) break;
    }
    await writer.close();
    if (!stats) throw new Error(`No statistics came back for mode ${mode.name}.`);
    if (lastBooks !== roundsPerMode) throw new Error(`Mode ${mode.name} simulated ${lastBooks} rounds, not the ${roundsPerMode} asked for.`);

    // Oversampled: weight each stratum's sampled books by that stratum's true count (reweightSampledBooks).
    let finalRows: StakeLutRow[] = rows;
    if (oversample > 1 && Array.isArray(stats.strata) && rows.every((r) => r.stratum !== undefined)) {
      // A kept book whose stratum the platform did not count would get an invented weight: refuse instead.
      const counted = new Set(stats.strata.map((s) => s.stratum));
      const uncounted = rows.find((r) => r.stratum && !counted.has(r.stratum));
      if (uncounted) {
        throw new Error(`Mode ${mode.name}: the platform reported no simulated rounds for stratum "${uncounted.stratum}" but kept its books: cannot weight them.`);
      }
      const rw = reweightSampledBooks(rows, stats.strata, mode.cost);
      finalRows = rw.rows;
      stats = { ...stats, rtp: rw.rtp, hit_rate: rw.hitRate };
      if (rw.unrepresented.length > 0) {
        throw new Error(
          `Mode ${mode.name}: no book of ${rw.unrepresented.join(', ')} was sampled, so the package could not pay its share. ` +
            'Export with more books per mode.'
        );
      }
    }

    // Refuse before writing what Stake would refuse after uploading.
    const lut = lookupTableCsv(finalRows);
    const problems = verifyStakeMode(lut, payouts);
    if (problems.length > 0) {
      throw new Error(`Mode ${mode.name} would be refused by Stake: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`);
    }
    await filesystem.writeFileOverride(filesystem.join(publishDir, stakeLookupFileName(mode.name)), lut);

    // What Stake will pay: the weighted table's own RTP (reweightSampledBooks), not the unweighted sample's.
    done.push({ mode, rows: finalRows, stats, jsonlBytes });
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
        oversample,
        declaredRtp: info.game?.declared_rtp ?? null,
        modes: done,
        skippedOptions: info.skippedOptions,
        roundRequests,
        editorVersion
      }),
      null,
      2
    )
  );

  // The reviewer pack: per-mode numbers, replay event ids, and what to check by eye. Outside the upload folder.
  await filesystem.writeFileOverride(
    filesystem.join(dir, 'stake-review-checklist.md'),
    stakeReviewChecklist({ gameName: opts.game?.name || info.game?.name || info.functionSlug, modes: done, maxWinMultiplier: info.maxWinMultiplier })
  );

  return { dir, publishDir, manifestPath, modes: done, info, bet, masterSeed: masterSeed || '', cancelled: false, chunks, autoSetups, notes: stakeExportNotes(done) };
}
