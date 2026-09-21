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
 * the action (open a project, instance a component) with another call. Console events
 * are broadcast to every attached CDP client, so the second connection does not steal
 * them. Entries come back with type, text and a relative timestamp; pageerror entries
 * are the uncaught exceptions.
 *
 * Doing this by hand (a throwaway Playwright script) captured the load sequence up to
 * the hang and showed six `[Node.connectInput] … has no output "LedgerRow0Text"`
 * warnings — phantom ports the hand-edited graph had introduced — followed by silence,
 * which is the signature of a synchronous loop rather than a crash.
 */

import { connect } from './connection.js';

export interface ConsoleEntry {
  atMs: number;
  type: string;
  text: string;
}

export async function consoleTail(opts: { durationMs?: number; filter?: string; maxEntries?: number } = {}) {
  const durationMs = Math.min(Math.max(opts.durationMs ?? 30_000, 1_000), 600_000);
  const maxEntries = Math.min(Math.max(opts.maxEntries ?? 300, 10), 2_000);
  const re = opts.filter ? new RegExp(opts.filter, 'i') : null;

  const { page } = await connect();
  const startedAt = Date.now();
  const entries: ConsoleEntry[] = [];
  let dropped = 0;

  const push = (type: string, text: string) => {
    if (re && !re.test(text)) return;
    if (entries.length >= maxEntries) {
      dropped += 1;
      return;
    }
    entries.push({ atMs: Date.now() - startedAt, type, text: text.slice(0, 600) });
  };

  const onConsole = (m: { type(): string; text(): string }) => push(m.type(), m.text());
  const onError = (e: Error) => push('pageerror', `${e.name}: ${e.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onError);

  // A hung renderer stops emitting; the tail still returns at the deadline, so the
  // caller gets whatever was logged before the silence rather than a timeout error.
  await new Promise((r) => setTimeout(r, durationMs));

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

  const byType: Record<string, number> = {};
  for (const e of entries) byType[e.type] = (byType[e.type] ?? 0) + 1;

  return {
    durationMs,
    captured: entries.length,
    dropped,
    byType,
    responsiveAtEnd,
    lastEntryAtMs: entries.length ? entries[entries.length - 1]!.atMs : null,
    entries
  };
}
