import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { connect } from './connection.js';
import { SELECTORS } from './selectors.js';
import {
  readProject,
  describePageState,
  describePageStateText,
  waitForChatReady,
  type ChatReadiness
} from './editor-state.js';
import { recentsFilePath, readRecents, addRecentEntry, type RecentEntry } from './recents.js';

export function projectNameFromDir(dir: string): string | null {
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const name = typeof raw?.name === 'string' ? raw.name : '';
    return name || path.basename(dir);
  } catch {
    return path.basename(dir);
  }
}

export function validateProjectDir(
  dir: string
): { ok: true; name: string } | { ok: false; reason: string } {
  if (!fs.existsSync(dir)) return { ok: false, reason: `No such directory: ${dir}` };
  if (!fs.statSync(dir).isDirectory()) return { ok: false, reason: `Not a directory: ${dir}` };
  const name = projectNameFromDir(dir);
  if (!name) return { ok: false, reason: `No project.json in ${dir}` };
  return { ok: true, name };
}

function fail(code: string, tried: string, hint: string) {
  return { error: code, tried, hint };
}

/**
 * How long `openProject` waits for the projects screen to render ANY tile
 * at all, before even looking for the specific one requested.
 *
 * The old single 20s wait on just the target tile was observed to fail
 * against a real machine that renders 317 recents entries while a freshly
 * launched dev build is still settling — indistinguishable, under that one
 * wait, from the login screen never having rendered the screen at all (see
 * NOT_TILE_TIMEOUT_MS below and describePageState). This ceiling is
 * deliberately far more patient than that.
 */
const PROJECTS_LIST_TIMEOUT_MS = 90_000;
/**
 * How long `openProject` waits for the SPECIFIC named tile once the screen
 * has already proven it can render at least one tile. Shorter than
 * PROJECTS_LIST_TIMEOUT_MS because by this point the list is already
 * rendering — the remaining risk is that this particular entry (just added
 * to recents) needs one more render pass, not that the screen itself is
 * still booting.
 */
const PROJECT_TILE_TIMEOUT_MS = 30_000;

/**
 * How long `openProject` waits, after confirming the right project is open,
 * for the AI chat panel to finish mounting before reporting the project
 * ready to a caller.
 *
 * Measured live: right after `waitForRetainedDirectory` confirmed the
 * correct project was open, the chat iframe's `.rich-chat-input` was NOT yet
 * present — a caller driving "open a project, then use the chat", the
 * harness's primary workflow, got `chat-frame-missing` on the very first
 * attempt even though the panel was never actually missing, only still
 * mounting. Sampling the same editor every 10s afterward showed it mounted
 * at every sample from t+10s on, so it settles within a few seconds. This
 * ceiling is deliberately about double that observed worst case, and
 * `waitForChatReady` returns the moment it's actually ready rather than
 * always waiting the full window.
 */
const CHAT_READY_TIMEOUT_MS = 20_000;

/**
 * Attach chat-readiness fields to an `openProject`/`newProject` success
 * result: whether the AI chat panel finished mounting, and — when it did
 * not — the reason straight from `readChatState` (no-frame /
 * evaluate-failed / neither, meaning the panel is genuinely closed or
 * entitlement-gated). A project can legitimately be open with the AI panel
 * closed, so this is never a hard failure — it lets a caller tell "ready to
 * chat" apart from "project open, chat unavailable" without guessing.
 */
export async function withChatReadiness<T extends Record<string, unknown>>(
  page: Page,
  result: T,
  timeoutMs: number = CHAT_READY_TIMEOUT_MS,
  pollMs = 250
): Promise<T & { chatReady: boolean; chatUnavailable?: 'no-frame' | 'evaluate-failed'; chatError?: string }> {
  const chat: ChatReadiness = await waitForChatReady(page, timeoutMs, pollMs);
  return {
    ...result,
    chatReady: chat.ready,
    chatUnavailable: chat.state.unavailable,
    chatError: chat.state.error
  };
}

/**
 * Canonicalise a project directory for comparison.
 *
 * `path.resolve` collapses a trailing slash and any `.`/`..` segments, which
 * is exactly what lets a caller-supplied path and the editor's own stored
 * value agree despite superficial differences. Nothing beyond `path.resolve`
 * may be applied here: real project directories on this machine carry
 * meaningful trailing spaces (`"...Amazing thing. "`), so a `.trim()` or any
 * case-folding would break every one of them.
 */
export function canonicalDir(dir: string): string {
  return path.resolve(dir);
}

/** Escape a string for safe use inside a `new RegExp(...)`. No dependency. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type NameResolution =
  | { ok: true; dir: string }
  | { ok: false; kind: 'not-found' }
  | { ok: false; kind: 'ambiguous'; reason: string };

/**
 * Resolve a recents `name` to exactly one directory, or fail closed.
 *
 * `findRecent` (recents.ts) returns the first match in file order with no
 * signal that more exist, which is fine for its own contract but wrong for
 * this call site: this machine has 317 recents entries with nothing
 * enforcing name uniqueness, so a bare first-match here could silently open
 * the wrong one of several identically-named projects. This scans every
 * entry and refuses to guess when more than one matches.
 */
export function resolveByName(entries: RecentEntry[], name: string): NameResolution {
  const matches = entries.filter((e) => e.name === name);
  if (matches.length === 0) return { ok: false, kind: 'not-found' };
  if (matches.length > 1) {
    const candidates = matches
      .map((m) => `${m.retainedProjectDirectory} (latestAccessed: ${m.latestAccessed})`)
      .join(', ');
    return {
      ok: false,
      kind: 'ambiguous',
      reason: `Ambiguous: ${matches.length} recents entries are named '${name}'. Candidates: ${candidates}. Pass dir instead.`
    };
  }
  return { ok: true, dir: canonicalDir(matches[0].retainedProjectDirectory) };
}

export type SaveOutcome =
  | { confirmed: true; reason: 'saved' }
  | { confirmed: false; reason: 'no-project' | 'timeout' }
  | { confirmed: false; reason: 'evaluate-threw'; error: string };

/**
 * Write the open project to disk using the editor's own save call, and report
 * what actually happened instead of always resolving as if it succeeded.
 *
 * The previous version returned `Promise<void>` unconditionally: the in-page
 * promise resolved the same way whether `pm.toDirectory`'s own callback fired
 * (a real save) or the 5s ceiling fired first (a save that never confirmed),
 * and the whole `evaluate` was wrapped in a blanket `.catch(() => undefined)`.
 * A caller could not distinguish "saved", "gave up waiting", "the read itself
 * threw", and "there was nothing to save" — a read-only project.json, a save
 * slower than 5s, or a thrown evaluate all looked identical to success right
 * before a kill or reload that would discard unsaved work.
 */
export async function saveOpenProject(page: Page): Promise<SaveOutcome> {
  try {
    const result = await page.evaluate(
      () =>
        new Promise<{ reason: 'saved' | 'no-project' | 'timeout' }>((resolve) => {
          const pm = (
            window as unknown as {
              ProjectModel?: {
                instance?: {
                  _retainedProjectDirectory?: string;
                  toDirectory?: (dir: string, cb: () => void) => void;
                };
              };
            }
          ).ProjectModel?.instance;
          if (!pm?.toDirectory || !pm._retainedProjectDirectory) {
            resolve({ reason: 'no-project' });
            return;
          }
          let done = false;
          const finish = (reason: 'saved' | 'timeout') => {
            if (!done) {
              done = true;
              resolve({ reason });
            }
          };
          setTimeout(() => finish('timeout'), 5000);
          pm.toDirectory(pm._retainedProjectDirectory, () => finish('saved'));
        })
    );
    return result.reason === 'saved'
      ? { confirmed: true, reason: 'saved' }
      : { confirmed: false, reason: result.reason };
  } catch (e) {
    return {
      confirmed: false,
      reason: 'evaluate-threw',
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

/**
 * Poll the editor's own model until its retained directory - canonicalised
 * the same way as the caller's - matches, or time out.
 *
 * The comparison cannot run inside the page: `path.resolve` needs Node, and
 * a caller's directory can differ from the editor's stored value by nothing
 * more than a trailing slash, which a raw `===` inside `page.evaluate` would
 * treat as a mismatch. So the editor's value is read out with a plain
 * `page.evaluate` and compared here, in Node, with `canonicalDir` applied to
 * both sides.
 */
async function waitForRetainedDirectory(
  page: Page,
  expected: string,
  timeoutMs: number,
  pollMs = 250
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let current: string | null;
    try {
      current = await page.evaluate(() => {
        const pm = (
          window as unknown as {
            ProjectModel?: { instance?: { _retainedProjectDirectory?: string } };
          }
        ).ProjectModel;
        return pm?.instance?._retainedProjectDirectory ?? null;
      });
    } catch {
      return null;
    }
    if (current !== null && canonicalDir(current) === expected) return current;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Close the current project and return to the projects screen.
 *
 * There is no clickable exit control to target: `SidePanel` passes a `header`
 * prop, so `SideNavigation`'s `onExitClick` logo never renders, and the other
 * exit is an unlabelled IconButton inside a Tooltip. `App.instance` is not on
 * `window` either. What IS guaranteed is that the router boots to the
 * projects screen, so a reload gets there with nothing more than waiting for
 * a project tile. Save first, because a reload discards anything autosave
 * has not flushed — exactly like a kill does.
 *
 * `openProject` used to inline this exact sequence for leaving whatever
 * project was open before switching to another one; it now calls this
 * instead, so there is one implementation of "how to leave a project",
 * not two.
 */
export async function closeProject(opts: { force?: boolean } = {}) {
  const { page } = await connect();
  const current = await readProject(page);
  if (!current) {
    return { closed: false as const, reason: 'no-project' as const };
  }

  // A reload discards anything unsaved exactly like a kill does, so the save
  // must actually be confirmed before proceeding — see saveOpenProject's doc
  // comment for why the previous unconditional call could not tell a real
  // save from a save that silently failed to confirm.
  const saveOutcome = await saveOpenProject(page);
  if (!saveOutcome.confirmed && !opts.force) {
    return fail(
      'save-unconfirmed',
      `save '${current.name}' before closing it`,
      `The editor's save could not be confirmed (${saveOutcome.reason}${
        'error' in saveOutcome ? `: ${saveOutcome.error}` : ''
      }) before reloading to close the project. Reloading now would risk unsaved work, so the close was refused. Retry, or pass force to close anyway.`
    );
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector(SELECTORS.projectItem, { timeout: 60_000 });
  } catch {
    return fail(
      'selector-missing',
      `${SELECTORS.projectItem} after reload`,
      'The projects screen did not appear after reloading the editor.'
    );
  }

  return { closed: true as const, project: current, save: saveOutcome };
}

/**
 * Open a project by directory or by name.
 *
 * The editor's own `openProjectFromFolder` is unreachable — the router exposes
 * only `ProjectModel` on window, and LocalProjectsModel is module-scoped — so
 * this drives the projects screen the way a person would. The recents file is
 * the seam: the projects screen re-reads it from disk on render and on mouse
 * movement, so a directory the harness appends there becomes clickable.
 */
export async function openProject(q: { dir?: string; name?: string }) {
  if (!q.dir && !q.name) {
    return fail('project-dir-missing', 'no argument', 'Pass either dir or name.');
  }

  const { page, target } = await connect();
  // CRITICAL: read from the recents file for the target we are actually
  // connected to, never from whichever profile's file happens to exist. An
  // installed XGENIA and a dev checkout keep entirely separate recents
  // files, and both commonly exist on the same machine, so guessing here
  // used to open the wrong profile's projects — see recentsFilePath's doc
  // comment.
  const file = recentsFilePath(target);
  if (!file) {
    return fail(
      'project-dir-missing',
      'recently_opened_project.json',
      `No recents file found in the ${target} userData directory.`
    );
  }

  // Resolve the request to a concrete directory. Canonicalised once, here,
  // and that resolved value is what's used everywhere downstream: the
  // already-open check, validateProjectDir, addRecentEntry, and the final
  // verification.
  let dir = q.dir ? canonicalDir(q.dir) : null;
  if (!dir && q.name) {
    const resolved = resolveByName(readRecents(file), q.name);
    if (!resolved.ok) {
      if (resolved.kind === 'ambiguous') {
        return fail('project-dir-missing', q.name, resolved.reason);
      }
      return fail(
        'project-dir-missing',
        `name '${q.name}' in recents`,
        'No recent project by that name. Pass an absolute dir instead.'
      );
    }
    dir = resolved.dir;
  }

  const valid = validateProjectDir(dir!);
  if (!valid.ok) return fail('project-dir-missing', dir!, valid.reason);

  // Already there? Nothing to do.
  const current = await readProject(page);
  if (current?.dir && canonicalDir(current.dir) === dir) {
    return withChatReadiness(page, { opened: true, alreadyOpen: true, project: current });
  }

  // Leave the current project first, so no in-project write races our
  // append. `closeProject` never overrides an unconfirmed save with `force`
  // here, matching this function's previous behaviour of refusing outright
  // rather than risking unsaved work.
  if (current) {
    const closeResult = await closeProject({ force: false });
    if ('error' in closeResult) {
      return closeResult;
    }
  }

  // Make sure the tile exists, then make the screen re-read the file.
  //
  // addRecentEntry fails closed: if the recents file exists but cannot be
  // read or parsed, it throws rather than silently starting from `{}` and
  // clobbering the user's real entries. That must not escape as an
  // unhandled rejection here.
  try {
    addRecentEntry(file, dir!, valid.name);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(
      'project-dir-missing',
      file,
      `Could not add ${dir} to the recents file: ${message}`
    );
  }
  await page.mouse.move(10, 10);
  await page.mouse.move(11, 11);

  // Exact label match, not substring: `hasText` with a string matches
  // anywhere in the label, so a project named "Amazing thing" would also
  // match a tile labelled "Amazing thing 2". Anchoring on the raw (untrimmed)
  // name — labels genuinely carry a trailing space — makes the match exact.
  const tile = page
    .locator(SELECTORS.projectItem)
    .filter({
      has: page.locator(SELECTORS.projectItemLabel, {
        hasText: new RegExp(`^${escapeRegExp(valid.name)}$`)
      })
    })
    .first();

  // Phase 1: wait for the projects screen to have rendered ANY tile at all
  // — not the specific one yet — before concluding anything about the
  // specific tile's absence. A generic "the selector did not appear" here
  // used to send the caller hunting for a renamed selector when the real
  // cause could be the login gate (Defect 1) or simply a slow-to-settle
  // screen (Defect 3), so a timeout at this phase is diagnosed against the
  // page's actual state instead of guessed at.
  try {
    await page.locator(SELECTORS.projectItem).first().waitFor({
      state: 'visible',
      timeout: PROJECTS_LIST_TIMEOUT_MS
    });
  } catch {
    const state = await describePageState(page);
    if (state.kind === 'login-screen') {
      return fail(
        'not-authenticated',
        `${SELECTORS.projectItem} (any) within ${PROJECTS_LIST_TIMEOUT_MS}ms`,
        'The projects screen never appeared because nobody is signed in. A human must sign in once — this harness cannot and must not handle credentials.'
      );
    }
    return fail(
      'selector-missing',
      `${SELECTORS.projectItem} (any) within ${PROJECTS_LIST_TIMEOUT_MS}ms`,
      `The projects screen never rendered any tiles. Actual state: ${describePageStateText(state)}. Run xgenia_probe.`
    );
  }

  // Phase 2: the screen can render, so now wait specifically for the tile
  // just added to recents.
  try {
    await tile.waitFor({ state: 'visible', timeout: PROJECT_TILE_TIMEOUT_MS });
  } catch {
    const state = await describePageState(page);
    if (state.kind === 'login-screen') {
      return fail(
        'not-authenticated',
        `${SELECTORS.projectItem} containing '${valid.name}' within ${PROJECT_TILE_TIMEOUT_MS}ms`,
        'The projects screen was replaced by the login screen mid-wait — nobody is signed in. A human must sign in once — this harness cannot and must not handle credentials.'
      );
    }
    return fail(
      'selector-missing',
      `${SELECTORS.projectItem} containing '${valid.name}' within ${PROJECT_TILE_TIMEOUT_MS}ms`,
      `The projects screen rendered tiles, but not one named '${valid.name}'. Actual state: ${describePageStateText(state)}. Run xgenia_probe.`
    );
  }

  await tile.click();

  // Verify by value, not by "the click did not throw".
  const finalDir = await waitForRetainedDirectory(page, dir!, 60_000);
  if (finalDir === null) {
    const now = await readProject(page);
    return fail(
      'project-mismatch',
      `clicked tile for '${valid.name}'`,
      `Expected ${dir}, editor reports ${now?.dir ?? '(none)'}.`
    );
  }

  return withChatReadiness(page, { opened: true, alreadyOpen: false, project: await readProject(page) });
}

/**
 * The exact `project.json` shape the editor's own no-template branch writes.
 * Reproduced verbatim (down to key order and the literal `'root-node'` id)
 * so the editor loads a harness-created project without complaint.
 */
export function defaultProjectJson(name: string): Record<string, unknown> {
  return {
    name,
    version: '4',
    settings: {},
    components: [
      {
        name: '/App',
        graph: {
          roots: [
            { id: 'root-node', type: 'Group', x: 0, y: 0, parameters: {}, ports: [], children: [] }
          ],
          connections: []
        }
      }
    ],
    rootNodeId: 'root-node'
  };
}

/**
 * Where to put a new project when the caller doesn't supply a directory: a
 * sibling of whatever project was opened most recently in the given recents
 * file, falling back to `home` when there is no recents file for this
 * target, or it holds no entries.
 *
 * Takes the recents file path rather than resolving it itself so this stays
 * a pure function of its inputs — the target-to-file resolution (and the
 * critical "never guess between profiles" rule it enforces) lives in
 * `recentsFilePath` alone.
 */
export function defaultProjectsParentDir(
  recentsFile: string | null,
  home: string = os.homedir()
): string {
  if (recentsFile) {
    const entries = readRecents(recentsFile);
    if (entries.length > 0) {
      const mostRecent = entries.reduce((a, b) => (b.latestAccessed > a.latestAccessed ? b : a));
      return path.dirname(mostRecent.retainedProjectDirectory);
    }
  }
  return home;
}

/**
 * Refuse to let `newProject` clobber existing work: a path that exists and
 * is non-empty (including one that exists but isn't even a directory) fails
 * closed rather than being written into.
 */
export function checkProjectDirClobber(dir: string): { ok: true } | { ok: false; reason: string } {
  if (!fs.existsSync(dir)) return { ok: true };
  if (!fs.statSync(dir).isDirectory()) {
    return { ok: false, reason: `${dir} exists and is not a directory.` };
  }
  if (fs.readdirSync(dir).length > 0) {
    return {
      ok: false,
      reason: `${dir} already exists and is not empty. Pass a different dir, or remove it first.`
    };
  }
  return { ok: true };
}

/**
 * Create a new project directory with a fresh `project.json`, then open it.
 *
 * The editor's own `LocalProjectsModel.newProject` is module-scoped and
 * unreachable from `window`, exactly like `openProjectFromFolder` was, so
 * this writes the same no-template `project.json` shape the editor itself
 * would and then reuses `openProject` — inheriting its recents handling, its
 * tile click, and its verify-by-value check — rather than duplicating any of
 * that.
 */
export async function newProject(q: { name: string; dir?: string }) {
  if (!q.name) {
    return fail('project-dir-missing', 'no name', 'Pass a name for the new project.');
  }

  const { target } = await connect();

  const dir = q.dir
    ? canonicalDir(q.dir)
    : canonicalDir(path.join(defaultProjectsParentDir(recentsFilePath(target)), q.name));

  const clobberCheck = checkProjectDirClobber(dir);
  if (!clobberCheck.ok) {
    return fail('project-dir-missing', dir, clobberCheck.reason);
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(defaultProjectJson(q.name), null, 2));

  const opened = await openProject({ dir });
  return { ...opened, createdDir: dir };
}
