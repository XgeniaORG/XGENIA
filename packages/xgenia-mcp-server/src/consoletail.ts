/**
 * xgenia_console_tail — capture the editor's renderer console for a window of time.
 *
 * The debug export carries the console, but only for a panel that survived to export
 * it. When the renderer hangs on project open, nothing gets exported and
 * `xgenia_health` can only say "editor-unresponsive". What was logged in the seconds
 * before the hang is the evidence that names the cause — and it is only obtainable by
 * attaching a listener BEFORE the action and reading it back afterwards.
 *
 * Usage pattern: start this with a duration that covers the risky action, then perform
 * the action (open a project, instance a component) with another call. Entries come back
 * with type, text, a relative timestamp and the frame they came from; pageerror entries
 * are the uncaught exceptions.
 *
 * WHY THIS HOOKS FRAMES DIRECTLY. The first version listened only on `page.on('console')`.
 * Under `connectOverCDP` that stream never delivered a single message from the PREVIEW
 * frame — the local-origin iframe the game actually runs in — while the frame's own
 * `XgeniaRuntimeLogs` buffer proved three spins had logged there during the window. So the
 * tool built to catch "what the renderer said as it died" was blind to the one frame where
 * the runtime lives. Now every non-editor frame on a local http origin gets a console hook
 * installed in-page (all levels, plus window error / unhandledrejection), drained on a
 * short poll. The poll also re-installs the hook if a frame reloads — opening a project
 * re-mounts the preview — and every frame evaluate is raced against a timeout, so a wedged
 * frame costs a two-second gap in the record rather than hanging the tool.
 *
 * Doing this by hand (a throwaway Playwright script) captured the load sequence up to
 * the hang and showed six `[Node.connectInput] … has no output "LedgerRow0Text"`
 * warnings — phantom ports the hand-edited graph had introduced — followed by silence,
 * which is the signature of a synchronous loop rather than a crash.
 */

import { connect } from './connection.js';
import type { Frame } from 'playwright-core';

export interface ConsoleEntry {
  atMs: number;
  type: string;
  text: string;
  /** 'editor' for the editor page's own console; otherwise the frame's origin. */
  frame: string;
}

const PREVIEW_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+\//;
const FRAME_POLL_MS = 2_000;
const FRAME_EVAL_TIMEOUT_MS = 2_000;

/** Runs in the frame. Wraps console + error events into an in-page buffer, once. */
function installHook(): boolean {
  const w = window as unknown as {
    __xgTailHooked?: boolean;
    __xgTailBuffer?: { t: number; type: string; text: string }[];
  };
  if (w.__xgTailHooked) return true;
  w.__xgTailHooked = true;
  w.__xgTailBuffer = [];
  const push = (type: string, args: unknown[]) => {
    try {
      const text = args
        .map((a) => {
          if (typeof a === 'string') return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ');
      const buf = w.__xgTailBuffer!;
      buf.push({ t: Date.now(), type, text: text.slice(0, 600) });
      if (buf.length > 2000) buf.splice(0, buf.length - 2000);
    } catch {
      /* never let the hook break the page */
    }
  };
  const c = console as unknown as Record<string, (...a: unknown[]) => void>;
  for (const lvl of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = c[lvl];
    c[lvl] = function (...args: unknown[]) {
      push(lvl, args);
      return orig ? orig.apply(this, args) : undefined;
    };
  }
  window.addEventListener('error', (e) => push('pageerror', [e.message]));
  window.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason as { message?: string } | undefined;
    push('pageerror', ['unhandledrejection: ' + (r && r.message ? r.message : String(r))]);
  });
  return false;
}

/** Runs in the frame. Hands back and clears everything buffered so far. */
function drainHook(): { t: number; type: string; text: string }[] {
  const w = window as unknown as { __xgTailBuffer?: { t: number; type: string; text: string }[] };
  const b = w.__xgTailBuffer || [];
  return b.splice(0, b.length);
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

export async function consoleTail(opts: { durationMs?: number; filter?: string; maxEntries?: number } = {}) {
  const durationMs = Math.min(Math.max(opts.durationMs ?? 30_000, 1_000), 600_000);
  const maxEntries = Math.min(Math.max(opts.maxEntries ?? 300, 10), 2_000);
  const re = opts.filter ? new RegExp(opts.filter, 'i') : null;

  const { page } = await connect();
  const startedAt = Date.now();
  const entries: ConsoleEntry[] = [];
  let dropped = 0;
  const hookedFrames = new Set<string>();
  let frameEvalTimeouts = 0;

  const push = (frame: string, type: string, text: string, atMs = Date.now() - startedAt) => {
    if (re && !re.test(text)) return;
    if (entries.length >= maxEntries) {
      dropped += 1;
      return;
    }
    entries.push({ atMs, type, text: text.slice(0, 600), frame });
  };

  // The editor page's own console, as before.
  const onConsole = (m: { type(): string; text(): string }) => push('editor', m.type(), m.text());
  const onError = (e: Error) => push('editor', 'pageerror', `${e.name}: ${e.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onError);

  // The frames the runtime actually lives in: hook in-page, drain on a poll, survive reloads.
  const previewFrames = (): Frame[] =>
    page.frames().filter((f) => PREVIEW_ORIGIN.test(f.url()) && !f.url().includes('/src/editor/'));

  const pollFrames = async () => {
    for (const f of previewFrames()) {
      const tag = f.url().replace(/^https?:\/\//, '').split('/')[0] ?? 'preview';
      const already = await withTimeout(f.evaluate(installHook), FRAME_EVAL_TIMEOUT_MS);
      if (already === undefined) {
        frameEvalTimeouts += 1;
        continue; // wedged or mid-reload; try again next poll
      }
      hookedFrames.add(tag);
      const drained = await withTimeout(f.evaluate(drainHook), FRAME_EVAL_TIMEOUT_MS);
      if (!drained) {
        frameEvalTimeouts += 1;
        continue;
      }
      for (const e of drained) push(tag, e.type, e.text, Math.max(0, e.t - startedAt));
    }
  };

  await pollFrames();
  const timer = setInterval(() => {
    void pollFrames();
  }, FRAME_POLL_MS);

  // A hung renderer stops emitting; the tail still returns at the deadline, so the
  // caller gets whatever was logged before the silence rather than a timeout error.
  await new Promise((r) => setTimeout(r, durationMs));

  clearInterval(timer);
  await pollFrames(); // final drain
  page.off('console', onConsole);
  page.off('pageerror', onError);

  let responsiveAtEnd: boolean;
  try {
    await Promise.race([
      page.evaluate(() => 1),
      new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate timeout')), 5_000))
    ]);
    responsiveAtEnd = true;
  } catch {
    responsiveAtEnd = false;
  }

  entries.sort((a, b) => a.atMs - b.atMs);
  const byType: Record<string, number> = {};
  const byFrame: Record<string, number> = {};
  for (const e of entries) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    byFrame[e.frame] = (byFrame[e.frame] ?? 0) + 1;
  }

  return {
    durationMs,
    captured: entries.length,
    dropped,
    byType,
    byFrame,
    hookedFrames: [...hookedFrames],
    ...(frameEvalTimeouts ? { frameEvalTimeouts, frameEvalTimeoutsHint: 'A frame evaluate timed out during the window: that frame was wedged or reloading at the time, so up to one poll interval of its output may be missing.' } : {}),
    responsiveAtEnd,
    lastEntryAtMs: entries.length ? entries[entries.length - 1]!.atMs : null,
    entries
  };
}
