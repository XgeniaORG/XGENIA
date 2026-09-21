/**
 * xgenia_preview_text — read what the running game actually shows on screen.
 *
 * The gap this closes: a supervisor could inspect the graph, audit the wiring and run
 * scripts offline, but had no way to check the one thing that decides whether a build
 * works — what a player would see. That left "the readouts update after a spin" as
 * something only the builder could assert, and an unverifiable claim is exactly the kind
 * this package exists to stop accepting.
 *
 * It matters because a graph can be perfect and the screen still wrong. One project had a
 * verified, maths-driven spin chain — real RNG, real win, capital moving in the model —
 * while every readout on screen sat at its default, because the data wires from the maths
 * to the UI had never been made. Structurally sound, visibly broken, and no tool could see
 * the difference.
 *
 * The preview runs in its own iframe on a local http origin, addressed directly by URL so
 * the editor's own empty-shell contexts cannot answer in its place (the same reasoning as
 * runtimeLogs, which had to solve this to avoid intermittent `not_mounted` reports).
 *
 * Typical use: read before an action, perform it, read after, and diff. `match` pulls out
 * just the lines you care about, so a spin check is one regex rather than a wall of text.
 */

import { connect } from './connection.js';

const PREVIEW_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+\//;

export interface PreviewTextOptions {
  /** Regex; only matching lines are returned, in document order. */
  match?: string;
  /** Case-insensitive matching. Default true. */
  ignoreCase?: boolean;
  /** Cap on returned characters. Default 8000. */
  maxChars?: number;
}

export async function previewText(options: PreviewTextOptions = {}) {
  const { match, ignoreCase = true, maxChars = 8_000 } = options;
  const { page } = await connect();

  const frames = page.frames().map((f) => f.url());
  const frame = page
    .frames()
    .find((f) => PREVIEW_ORIGIN.test(f.url()) && !f.url().includes('/src/editor/'));
  if (!frame) {
    return {
      error: 'preview-frame-missing',
      tried: 'find the preview iframe (a local http origin that is not the editor page)',
      hint: 'The preview is not mounted. Open a project so the game renders, then retry.',
      frames
    };
  }

  let text: string;
  try {
    text = await frame.evaluate(() => document.body?.innerText ?? '');
  } catch (e) {
    return {
      error: 'preview-unreadable',
      detail: (e as Error).message.slice(0, 200),
      hint: 'The preview frame exists but would not evaluate. If the renderer is wedged, xgenia_editor_probe will say so.'
    };
  }

  const allLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let lines = allLines;
  let invalidPattern: string | undefined;
  if (match) {
    try {
      const re = new RegExp(match, ignoreCase ? 'i' : '');
      lines = allLines.filter((l) => re.test(l));
    } catch (e) {
      // A bad regex should narrow nothing rather than fail the read outright.
      invalidPattern = (e as Error).message;
    }
  }

  let out = lines.join('\n');
  let truncated = false;
  if (out.length > maxChars) {
    out = out.slice(0, maxChars);
    truncated = true;
  }

  return {
    frameUrl: frame.url(),
    totalLines: allLines.length,
    returnedLines: lines.length,
    ...(invalidPattern ? { invalidPattern } : {}),
    ...(truncated ? { truncated: true } : {}),
    text: out
  };
}
