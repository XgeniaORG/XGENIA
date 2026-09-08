import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect, getChatFrame } from './connection.js';

/**
 * Pull the chat panel's debug export and summarise it.
 *
 * WHY THIS EXISTS. The export is the only view of what the panel's AI actually did:
 * every tool call with its arguments and result, the thinking log, the raw API
 * history, the console of both surfaces, and the token spend. Before this tool the
 * only way to get one was to ask a human to click the bug icon and hand over the
 * file, so an agent driving a build over MCP was blind to its own subject.
 *
 * The bundle is large — 7.2MB / 640 tool calls for one slot build — so this never
 * returns the file. It writes it to disk and returns a census: which tools failed,
 * with which codes, what the editor logged as errors, and what the run cost. Read
 * the file directly when a specific call needs inspecting.
 *
 * The panel downloads through the PARENT document (ChatPanel.tsx's strategy 1), so
 * the file lands in the browser's download directory rather than anywhere this
 * process chooses. Rather than guess, this records the newest matching file before
 * the click and waits for a newer one to appear.
 */

const EXPORT_GLOB = /^xgenia-debug-export-(\d+)\.json$/;

function downloadDirs(): string[] {
  const home = os.homedir();
  return [path.join(home, 'Downloads'), home, os.tmpdir()];
}

/** Newest export file across the candidate directories, or null. */
function newestExport(): { file: string; mtimeMs: number } | null {
  let best: { file: string; mtimeMs: number } | null = null;
  for (const dir of downloadDirs()) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!EXPORT_GLOB.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const { mtimeMs } = fs.statSync(file);
        if (!best || mtimeMs > best.mtimeMs) best = { file, mtimeMs };
      } catch {
        /* raced with a delete */
      }
    }
  }
  return best;
}

/**
 * A tool result is a JSON envelope OR a human-readable string.
 *
 * The panel's condenser rewrites large results into prose ("[Tool output pruned to
 * save context …]"), and several tools answer in prose by design. Counting those as
 * failures inflated a first census of this same export from 77 genuine failures to
 * 382 — so only a parsed envelope that SAYS it failed is counted, and prose results
 * are reported separately as `unparsed`.
 */
function classify(raw: unknown): { ok: boolean; code: string | null; parsed: boolean; pruned: boolean } {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  const pruned = /Tool output pruned to save context/.test(text);
  let parsed: any = null;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: true, code: null, parsed: false, pruned };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: true, code: null, parsed: false, pruned };
  if (parsed.ok === false) return { ok: false, code: parsed.code ?? '?', parsed: true, pruned };
  if (parsed.result && parsed.result.success === false) {
    return { ok: false, code: parsed.result.code ?? parsed.code ?? '?', parsed: true, pruned };
  }
  return { ok: true, code: null, parsed: true, pruned };
}

export interface DebugExportOptions {
  /** Summarise the newest export already on disk instead of clicking for a fresh one. */
  reuseExisting?: boolean;
  /** How long to wait for the downloaded file to appear. */
  timeoutMs?: number;
  /** Copy the bundle here as well, so it survives a Downloads clear-out. */
  copyTo?: string;
}

export async function debugExport(options: DebugExportOptions = {}) {
  const { reuseExisting = false, timeoutMs = 30_000, copyTo } = options;
  const before = newestExport();
  let clicked = false;

  if (!reuseExisting) {
    const { page } = await connect();
    const frame = await getChatFrame(page);
    if (!frame) {
      return {
        error: 'chat-frame-missing',
        tried: 'locate the chat panel iframe to click its Debug Export button',
        hint: 'The chat panel is not mounted. Call xgenia_open_chat_panel, or pass reuseExisting to summarise the newest export already on disk.'
      };
    }
    const button = frame.locator('[aria-label="Debug Export"]');
    if ((await button.count()) === 0) {
      return {
        error: 'selector-missing',
        tried: '[aria-label="Debug Export"] inside the chat frame',
        hint: 'The panel deploys independently of the editor, so its header controls move. Run xgenia_probe, then read ChatPanel.tsx for the current button.'
      };
    }
    await button.click({ timeout: 10_000 });
    clicked = true;

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const now = newestExport();
      if (now && (!before || now.mtimeMs > before.mtimeMs)) break;
      if (Date.now() > deadline) {
        return {
          error: 'export-not-written',
          tried: `click Debug Export, then watch ${downloadDirs().join(', ')} for ${timeoutMs}ms`,
          hint: 'The click landed but no new file appeared. The panel falls back through three download strategies; a blocked download leaves no file. Check the editor for a save dialog.',
          clicked
        };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const found = newestExport();
  if (!found) {
    return {
      error: 'no-export-found',
      tried: `read ${downloadDirs().join(', ')}`,
      hint: 'No xgenia-debug-export-*.json exists yet. Run without reuseExisting to produce one.'
    };
  }

  const bytes = fs.statSync(found.file).size;
  let bundle: any;
  try {
    bundle = JSON.parse(fs.readFileSync(found.file, 'utf8'));
  } catch (e) {
    return {
      error: 'export-unreadable',
      tried: `parse ${found.file}`,
      hint: `The file exists (${bytes} bytes) but is not valid JSON: ${(e as Error).message}`,
      file: found.file
    };
  }

  if (copyTo) {
    try {
      fs.mkdirSync(path.dirname(copyTo), { recursive: true });
      fs.copyFileSync(found.file, copyTo);
    } catch {
      /* best effort; the original is still reported */
    }
  }

  const calls: any[] = Array.isArray(bundle.toolCallSummary) ? bundle.toolCallSummary : [];
  const perTool = new Map<string, { calls: number; failures: number; codes: Record<string, number> }>();
  const codes: Record<string, number> = {};
  let unparsed = 0;
  let pruned = 0;

  for (const call of calls) {
    const name = call?.tool ?? '?';
    const row = perTool.get(name) ?? { calls: 0, failures: 0, codes: {} };
    row.calls++;
    const verdict = classify(call?.result);
    if (!verdict.parsed) unparsed++;
    if (verdict.pruned) pruned++;
    if (!verdict.ok) {
      row.failures++;
      const code = verdict.code ?? '?';
      row.codes[code] = (row.codes[code] ?? 0) + 1;
      codes[code] = (codes[code] ?? 0) + 1;
    }
    perTool.set(name, row);
  }

  const failingTools = [...perTool.entries()]
    .filter(([, v]) => v.failures > 0)
    .sort((a, b) => b[1].failures - a[1].failures)
    .map(([tool, v]) => ({ tool, calls: v.calls, failures: v.failures, codes: v.codes }));

  const errorHistogram: Record<string, number> = {};
  for (const err of Array.isArray(bundle.errors) ? bundle.errors : []) {
    const key = String(err?.message ?? err?.error ?? JSON.stringify(err)).slice(0, 120);
    errorHistogram[key] = (errorHistogram[key] ?? 0) + 1;
  }

  return {
    file: found.file,
    copiedTo: copyTo ?? null,
    bytes,
    clicked,
    exportedAt: bundle.exportedAt ?? null,
    bundle: bundle.bundle ?? null,
    counts: {
      visibleChat: bundle.visibleChat?.length ?? 0,
      thinkingLog: bundle.thinkingLog?.length ?? 0,
      rawApiHistory: bundle.rawApiHistory?.length ?? 0,
      toolCalls: calls.length,
      errors: bundle.errors?.length ?? 0,
      errorsBeforeSession: bundle.errorsBeforeSession?.length ?? 0,
      componentGraphs: bundle.componentGraphs?.length ?? 0
    },
    toolFailures: {
      total: failingTools.reduce((sum, t) => sum + t.failures, 0),
      byTool: failingTools,
      byCode: Object.fromEntries(Object.entries(codes).sort((a, b) => b[1] - a[1])),
      unparsedResults: unparsed,
      prunedByCondenser: pruned,
      note:
        'A result is only counted as a failure when it parses as an envelope that says ok:false or result.success:false. Prose and condenser-pruned results are reported as unparsedResults/prunedByCondenser, never as failures — counting them inflated one real census from 77 to 382.'
    },
    topErrors: Object.entries(errorHistogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([message, count]) => ({ count, message })),
    tokenUsage: bundle.tokenUsage ?? null,
    hint: 'The bundle itself is far too large to return. Read the file at `file` for individual calls: toolCallSummary[] holds {tool, input, result}, thinkingLog[] the reasoning, consoleLogs.viewer the engine output.'
  };
}

/**
 * Grep the debug bundle without moving it through the caller's context.
 *
 * A 7.2MB export cannot be returned and should not have to be: nearly every real
 * question about a build ("which calls to edit_node_script failed and why", "what did
 * the engine log around the settle", "where did it decide to use globalThis") is a
 * filter over one array. This runs the filter here and returns only the hits, each
 * clipped, with the file path so the caller can open it when a hit needs full context.
 */

export type DebugSection =
  | 'toolCallSummary'
  | 'thinkingLog'
  | 'visibleChat'
  | 'rawApiHistory'
  | 'errors'
  | 'errorsBeforeSession'
  | 'consoleLogs.viewer'
  | 'consoleLogs.editor'
  | 'subAgents'
  | 'taskTracking';

export interface DebugQueryOptions {
  section?: DebugSection;
  /** JS regular expression, matched against the whole serialised entry. */
  grep?: string;
  /** Case-insensitive grep. Default true. */
  ignoreCase?: boolean;
  /** toolCallSummary only: restrict to one tool name. */
  tool?: string;
  /** toolCallSummary only: keep only calls whose envelope says it failed. */
  failuresOnly?: boolean;
  limit?: number;
  offset?: number;
  /** Characters kept per matching entry. Default 1200. */
  clip?: number;
  /** Query this bundle instead of the newest one on disk. */
  file?: string;
}

function pluck(bundle: any, section: DebugSection): any[] {
  if (section === 'consoleLogs.viewer') return bundle?.consoleLogs?.viewer ?? [];
  if (section === 'consoleLogs.editor') return bundle?.consoleLogs?.editor ?? [];
  if (section === 'subAgents') return bundle?.subAgents?.calls ?? [];
  if (section === 'taskTracking') return bundle?.taskTracking?.todos ?? [];
  const value = bundle?.[section];
  return Array.isArray(value) ? value : [];
}

export async function debugQuery(options: DebugQueryOptions = {}) {
  const {
    section = 'toolCallSummary',
    grep,
    ignoreCase = true,
    tool,
    failuresOnly = false,
    limit = 20,
    offset = 0,
    clip = 1200
  } = options;

  const file = options.file ?? newestExport()?.file;
  if (!file) {
    return {
      error: 'no-export-found',
      tried: `read ${downloadDirs().join(', ')}`,
      hint: 'No xgenia-debug-export-*.json on disk. Call xgenia_debug_export first to produce one.'
    };
  }

  let bundle: any;
  try {
    bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { error: 'export-unreadable', tried: `parse ${file}`, hint: (e as Error).message, file };
  }

  let pattern: RegExp | null = null;
  if (grep) {
    try {
      pattern = new RegExp(grep, ignoreCase ? 'i' : '');
    } catch (e) {
      return {
        error: 'bad-pattern',
        tried: `new RegExp(${JSON.stringify(grep)})`,
        hint: (e as Error).message
      };
    }
  }

  const entries = pluck(bundle, section);
  const hits: Array<{ index: number; tool?: string; failed?: boolean; code?: string | null; text: string }> = [];
  let scanned = 0;
  let matched = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    scanned++;
    if (tool && entry?.tool !== tool) continue;
    let failed: boolean | undefined;
    let code: string | null | undefined;
    if (section === 'toolCallSummary') {
      const verdict = classify(entry?.result);
      failed = !verdict.ok;
      code = verdict.code;
      if (failuresOnly && verdict.ok) continue;
    }
    const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
    if (pattern && !pattern.test(text)) continue;
    matched++;
    if (matched <= offset) continue;
    if (hits.length >= limit) continue;
    hits.push({
      index: i,
      ...(entry?.tool ? { tool: entry.tool } : {}),
      ...(failed === undefined ? {} : { failed, code: code ?? null }),
      text: text.length > clip ? text.slice(0, clip) + `… [+${text.length - clip} chars]` : text
    });
  }

  return {
    file,
    section,
    scanned,
    matched,
    returned: hits.length,
    truncated: matched > offset + hits.length,
    hits,
    hint:
      matched > offset + hits.length
        ? `${matched} entries matched; ${hits.length} returned. Raise limit or advance offset.`
        : 'All matching entries returned.'
  };
}

/**
 * Grep the ENGINE's own log buffer in the running preview, with no export at all.
 *
 * The viewer keeps its console in `window.XgeniaRuntimeLogs` (1,347 entries during one
 * slot build). It is the only place that records what the game actually did — which JS
 * function nodes ran, which reel-controller latches fired, which eval requests arrived —
 * and it is live, so it answers questions about the CURRENT state rather than about
 * whenever someone last clicked export.
 *
 * The preview is an iframe on a local port, NOT the editor page and NOT the
 * `external/cloudruntime/index.html` page that also exists in the process. That second
 * surface is an empty shell which answers broadcast evals first, which is why the panel's
 * own runtime tools intermittently report a mounted game as `not_mounted`. This addresses
 * the preview frame directly by URL and so cannot be fooled by it.
 */
export interface RuntimeLogOptions {
  grep?: string;
  ignoreCase?: boolean;
  /** Entries from the end of the buffer. Default 40. */
  tail?: number;
  clip?: number;
}

export async function runtimeLogs(options: RuntimeLogOptions = {}) {
  const { grep, ignoreCase = true, tail = 40, clip = 600 } = options;
  const { page } = await connect();

  const frames = page.frames().map((f) => f.url());
  const frame = page.frames().find((f) => /^https?:\/\/(localhost|127\.0\.0\.1):\d+\//.test(f.url()) && !f.url().includes('/src/editor/'));
  if (!frame) {
    return {
      error: 'preview-frame-missing',
      tried: 'find the preview iframe (a local http origin that is not the editor page)',
      hint: 'The preview is not mounted. Open a project and start the preview, then retry.',
      frames
    };
  }

  let entries: string[];
  try {
    entries = await frame.evaluate(() => {
      const raw = (window as any).XgeniaRuntimeLogs;
      const list = Array.isArray(raw) ? raw : (raw && (raw as any).entries) || [];
      return list.map((l: any) => (typeof l === 'string' ? l : l?.message ?? l?.text ?? JSON.stringify(l)));
    });
  } catch (e) {
    return {
      error: 'runtime-logs-unavailable',
      tried: 'read window.XgeniaRuntimeLogs in the preview frame',
      hint: `The buffer is installed by the viewer's log capture; a preview that has not booted has none. ${(e as Error).message}`,
      previewUrl: frame.url()
    };
  }

  let pattern: RegExp | null = null;
  if (grep) {
    try {
      pattern = new RegExp(grep, ignoreCase ? 'i' : '');
    } catch (e) {
      return { error: 'bad-pattern', tried: `new RegExp(${JSON.stringify(grep)})`, hint: (e as Error).message };
    }
  }

  const matched = pattern ? entries.filter((e) => pattern!.test(e)) : entries;
  const slice = matched.slice(-tail);

  return {
    previewUrl: frame.url(),
    total: entries.length,
    matched: matched.length,
    returned: slice.length,
    entries: slice.map((e) => (e.length > clip ? e.slice(0, clip) + `… [+${e.length - clip} chars]` : e)),
    hint: 'This is the live engine buffer, not an export. It resets when the preview reloads.'
  };
}
