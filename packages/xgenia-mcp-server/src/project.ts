import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { connect } from './connection.js';
import { SELECTORS } from './selectors.js';
import { readProject } from './editor-state.js';
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

/**
 * Write the open project to disk using the editor's own save call.
 *
 * Resolves either way: a save that never calls back must not strand the caller,
 * and the 5s ceiling is far longer than a real save of a loaded project.
 */
export async function saveOpenProject(page: Page): Promise<void> {
  await page
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
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
          if (!pm?.toDirectory || !pm._retainedProjectDirectory) return resolve();
          let done = false;
          const finish = () => {
            if (!done) {
              done = true;
              resolve();
            }
          };
          setTimeout(finish, 5000);
          pm.toDirectory(pm._retainedProjectDirectory, finish);
        })
    )
    .catch(() => undefined);
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

  const { page } = await connect();
  const file = recentsFilePath();
  if (!file) {
    return fail(
      'project-dir-missing',
      'recently_opened_project.json',
      'No recents file found in any Electron userData directory.'
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
    return { opened: true, alreadyOpen: true, project: current };
  }

  // Leave the current project first, so no in-project write races our append.
  //
  // There is no clickable exit control to target. SidePanel passes a `header`
  // prop, so SideNavigation's `onExitClick` logo never renders, and the other
  // exit is an unlabelled IconButton inside a Tooltip. `App.instance` is not on
  // window either. What IS guaranteed is that the router boots to the projects
  // screen, so a reload gets there with no selector at all. Save first, because
  // a reload discards anything autosave has not flushed.
  if (current) {
    await saveOpenProject(page);
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

  try {
    await tile.waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    return fail(
      'selector-missing',
      `${SELECTORS.projectItem} containing '${valid.name}'`,
      'The project tile did not appear on the projects screen. Run xgenia_probe.'
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

  return { opened: true, alreadyOpen: false, project: await readProject(page) };
}
