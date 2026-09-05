import type { Page } from 'playwright-core';
import { connect, discoverPort, getChatFrame, type Target } from './connection.js';
import { SELECTORS } from './selectors.js';
import { recentsFilePath, readRecents, type RecentEntry } from './recents.js';

export interface ProjectInfo {
  name: string;
  id: string | null;
  dir: string | null;
  componentCount: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'unknown';
  text: string;
}

export interface ChatMessageOut extends ChatMessage {
  index: number;
  truncated: boolean;
}

/**
 * Read the open project straight off the editor's own model.
 *
 * `window.ProjectModel` is set by the router, so this is the same object the
 * editor itself considers current — not a guess from the title bar.
 */
export async function readProject(page: Page): Promise<ProjectInfo | null> {
  return page.evaluate(() => {
    const PM = (window as unknown as { ProjectModel?: { instance?: Record<string, unknown> } })
      .ProjectModel;
    const p = PM?.instance as
      | (Record<string, unknown> & { getComponents?: () => unknown[] })
      | undefined;
    if (!p) return null;
    return {
      name: String(p.name ?? ''),
      id: (p.id as string) ?? null,
      dir: (p._retainedProjectDirectory as string) ?? null,
      componentCount: p.getComponents?.().length ?? 0
    };
  });
}

/**
 * Detect the (unauthenticated) login screen.
 *
 * `window.ProjectModel` is defined by the router before the app decides
 * whether anyone is signed in, so its presence alone cannot distinguish an
 * authenticated editor from the login screen sitting in front of it — that
 * was the whole cause of `launch()` reporting success while the user stared
 * at an unusable login form. The login screen carries no class names or ids
 * (inline-styled React), so this matches on the structural presence of BOTH
 * an email and a password input rather than one exact selector, and rather
 * than the literal "Login with XGENIA" copy — copy changes far more easily
 * than a form that has to keep an email + password field to actually
 * authenticate. Neither selector appears anywhere in the authenticated
 * editor, the projects screen, or the chat panel (see selectors.test.ts).
 */
export async function isLoginScreen(page: Page): Promise<boolean> {
  return page.evaluate(
    (sel) =>
      !!document.querySelector(sel.loginEmailInput) &&
      !!document.querySelector(sel.loginPasswordInput),
    { loginEmailInput: SELECTORS.loginEmailInput, loginPasswordInput: SELECTORS.loginPasswordInput }
  );
}

export type PageState =
  | { kind: 'login-screen' }
  | { kind: 'project-open'; project: ProjectInfo }
  | { kind: 'projects-screen'; tileCount: number }
  | { kind: 'unreadable'; error: string };

/**
 * Classify what the page is actually showing right now.
 *
 * Exists so a caller stuck waiting for a selector that never appeared (e.g.
 * `openProject`'s project-tile wait) can report which of the three very
 * different real situations it hit — nobody signed in, an empty-but-real
 * projects screen, or an editor already holding a different project —
 * instead of a generic "the selector did not appear", which sends the
 * caller hunting for a renamed selector when the actual cause is something
 * else entirely.
 */
export async function describePageState(page: Page): Promise<PageState> {
  try {
    if (await isLoginScreen(page)) return { kind: 'login-screen' };
    const project = await readProject(page);
    if (project) return { kind: 'project-open', project };
    const tileCount = await page.evaluate(
      (sel) => document.querySelectorAll(sel).length,
      SELECTORS.projectItem
    );
    return { kind: 'projects-screen', tileCount };
  } catch (e) {
    return { kind: 'unreadable', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Render a `PageState` as a human-readable fragment for an error hint. */
export function describePageStateText(state: PageState): string {
  switch (state.kind) {
    case 'login-screen':
      return 'the login screen (nobody is signed in)';
    case 'project-open':
      return `an editor already holding a different project ('${state.project.name}')`;
    case 'projects-screen':
      return state.tileCount > 0
        ? `the projects screen with ${state.tileCount} tile(s) rendered`
        : 'the projects screen with zero tiles rendered';
    case 'unreadable':
      return `a page that could not be read (${state.error})`;
  }
}

export interface ChatState {
  mounted: boolean;
  busy: boolean;
  messageCount: number;
  /**
   * Present only when the read produced no real data. Distinguishes "no chat
   * iframe at all" from "the iframe is there but the read inside it failed" —
   * the latter must not be reported to an operator as "not mounted".
   */
  unavailable?: 'no-frame' | 'evaluate-failed';
  /** The thrown message when `unavailable === 'evaluate-failed'`, trimmed. */
  error?: string;
}

const MAX_ERROR_LEN = 300;

export async function readChatState(page: Page): Promise<ChatState> {
  const frame = getChatFrame(page);
  if (!frame) return { mounted: false, busy: false, messageCount: 0, unavailable: 'no-frame' };
  try {
    return await frame.evaluate(
      (sel) => ({
        mounted: !!document.querySelector(sel.chatInput),
        busy: !!document.querySelector(sel.chatStop),
        messageCount: document.querySelectorAll('[aria-label="Copy message to clipboard"]').length
      }),
      { chatInput: SELECTORS.chatInput, chatStop: SELECTORS.chatStop }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      mounted: false,
      busy: false,
      messageCount: 0,
      unavailable: 'evaluate-failed',
      error: message.slice(0, MAX_ERROR_LEN)
    };
  }
}

export interface ChatReadiness {
  ready: boolean;
  /** The last observed `ChatState`, whether or not it ever became ready — so a caller that gave up can still report why. */
  state: ChatState;
}

/**
 * Poll `readChatState` until it reports `mounted`, or a bounded timeout
 * elapses.
 *
 * Exists because `openProject` was observed live to return as soon as the
 * right project was verified open, while the AI chat panel iframe had not
 * mounted yet — a caller that opened a project and immediately called
 * `chatRead`/`chatSend` got `chat-frame-missing` even though the panel was
 * never actually missing, only still mounting (confirmed mounted a few
 * seconds later on repeated sampling). Shared by `openProject` (wait out
 * that whole mounting window before reporting a project ready) and the chat
 * functions (`chatRead`/`chatSend`/`chatWaitIdle` retry briefly on a panel
 * that is a moment from ready instead of failing on the very first read) so
 * there is exactly one implementation of "wait for the chat panel to
 * mount", tuned once, not two independently-guessed copies.
 */
export async function waitForChatReady(
  page: Page,
  timeoutMs: number,
  pollMs = 250
): Promise<ChatReadiness> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await readChatState(page);
    if (state.mounted) return { ready: true, state };
    if (Date.now() >= deadline) return { ready: false, state };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

let busyStartedAt: number | null = null;

export function resetBusyTracking(): void {
  busyStartedAt = null;
}

/** How long the panel has been continuously busy, or null if it is idle. */
export function busySince(busy: boolean, now: number = Date.now()): number | null {
  if (!busy) {
    busyStartedAt = null;
    return null;
  }
  if (busyStartedAt === null) busyStartedAt = now;
  return now - busyStartedAt;
}

export function summariseMessages(
  messages: ChatMessage[],
  since: number,
  limit: number,
  cap: number
): ChatMessageOut[] {
  return messages.slice(since, since + limit).map((m, i) => ({
    index: since + i,
    role: m.role,
    text: m.text.length > cap ? m.text.slice(0, cap) : m.text,
    truncated: m.text.length > cap
  }));
}

export interface HealthReport {
  running: boolean;
  target: Target | null;
  port: number | null;
  pageResponsive: boolean;
  projectOpen: boolean;
  project: ProjectInfo | null;
  chatMounted: boolean;
  chatBusy: boolean;
  busyForMs: number | null;
  /**
   * Why `chatMounted`/`chatBusy` read as false-and-empty when they aren't
   * trustworthy: no chat iframe found at all, vs. an iframe present whose
   * read threw. Absent when the read succeeded.
   */
  chatUnavailable?: 'no-frame' | 'evaluate-failed';
  /** The editor page's <title>. Always the literal "XGENIA" — carries no version. */
  pageTitle: string | null;
  /**
   * Whether the editor is past the login screen. `'unknown'` — not a
   * confident `true` — when `pageResponsive` is false, since the read that
   * would tell us is exactly what didn't respond. This is the field a
   * caller checks instead of inferring auth state from `selector-missing`
   * failures elsewhere: see `isLoginScreen`'s doc comment for why
   * `window.ProjectModel` being defined does not imply anyone is signed in.
   */
  authenticated: boolean | 'unknown';
  /**
   * Present only when `running` is false: why `connect()` itself could not
   * reach the editor at all. `not-running` means nothing is listening on
   * the CDP port; `editor-unresponsive` means something is listening but
   * the connection (or its pages) never became usable within the connect
   * timeout -- e.g. a renderer whose main thread is wedged. This used to be
   * indistinguishable: `health()` simply threw whatever `connect()` threw,
   * so a caller saw a generic `page-unresponsive` failure from `guard()`
   * with no `HealthReport` shape at all, rather than a report they could
   * inspect (`running: false` plus the reason).
   */
  code?: string;
  /** The human-readable detail behind `code`, present under the same condition. */
  hint?: string;
}

/**
 * Build the `HealthReport` for "connect() itself failed" -- pure and
 * stub-testable independent of a real CDP connection, matching the pattern
 * of the other decision points in this package (`combinePreKillReads`,
 * `unresponsiveRefusal`, etc.).
 */
export function unresponsiveHealthReport(port: number, code: string, hint: string): HealthReport {
  return {
    running: false,
    target: null,
    port,
    pageResponsive: false,
    projectOpen: false,
    project: null,
    chatMounted: false,
    chatBusy: false,
    busyForMs: null,
    pageTitle: null,
    authenticated: 'unknown',
    code,
    hint
  };
}

export async function health(): Promise<HealthReport> {
  const port = discoverPort();
  let page: Page;
  let target: Target;
  try {
    ({ page, target } = await connect(port));
  } catch (e) {
    const err = e as Error & { code?: string };
    return unresponsiveHealthReport(port, err.code ?? 'not-running', err.message);
  }

  let pageResponsive = false;
  try {
    pageResponsive =
      (await Promise.race([
        page.evaluate(() => 1 + 1),
        new Promise<number>((r) => setTimeout(() => r(-1), 3000))
      ])) === 2;
  } catch {
    pageResponsive = false;
  }

  const project = pageResponsive ? await readProject(page) : null;
  const chat = pageResponsive
    ? await readChatState(page)
    : { mounted: false, busy: false, messageCount: 0 };

  const pageTitle = pageResponsive
    ? await page
        .evaluate(() => document.querySelector('title')?.textContent ?? null)
        .catch(() => null)
    : null;

  const loginScreen = pageResponsive ? await isLoginScreen(page).catch(() => false) : false;

  return {
    running: true,
    target,
    port,
    pageResponsive,
    projectOpen: !!project,
    project,
    chatMounted: chat.mounted,
    chatBusy: chat.busy,
    busyForMs: busySince(chat.busy),
    chatUnavailable: chat.unavailable,
    pageTitle,
    authenticated: pageResponsive ? !loginScreen : 'unknown'
  };
}

export interface ProbeReport {
  ok: boolean;
  checks: { name: string; selector: string; found: boolean; detail?: string }[];
}

/**
 * Report which selectors resolve right now.
 *
 * This is the drift alarm. The Chat panel deploys independently of XGENIA, so a
 * rename there breaks the harness with no version change to notice.
 */
export async function probe(): Promise<ProbeReport> {
  const { page } = await connect();
  const checks: ProbeReport['checks'] = [];

  const iframe = await page.$(SELECTORS.chatIframe);
  checks.push({ name: 'chatIframe', selector: SELECTORS.chatIframe, found: !!iframe });

  const frame = getChatFrame(page);
  checks.push({
    name: 'chatFrame',
    selector: 'frame url contains xgenia-ai-app',
    found: !!frame,
    detail: frame?.url()
  });

  if (frame) {
    for (const name of ['chatInput', 'chatStop', 'chatSend'] as const) {
      const selector = SELECTORS[name];
      const found = await frame
        .evaluate((s) => !!document.querySelector(s), selector)
        .catch(() => false);
      checks.push({ name, selector, found });
    }
  }

  const projectModel = await page
    .evaluate(
      () => typeof (window as unknown as Record<string, unknown>).ProjectModel !== 'undefined'
    )
    .catch(() => false);
  checks.push({ name: 'window.ProjectModel', selector: 'window.ProjectModel', found: projectModel });

  // chatStop and chatSend are mutually exclusive by design, so requiring both
  // would fail on a healthy panel. Everything else must be present.
  const required = checks.filter((c) => c.name !== 'chatStop' && c.name !== 'chatSend');
  const eitherButton = checks.some((c) => (c.name === 'chatStop' || c.name === 'chatSend') && c.found);

  return { ok: required.every((c) => c.found) && eitherButton, checks };
}

export async function projectStatus(): Promise<{
  open: boolean;
  project: ProjectInfo | null;
  recents?: Pick<RecentEntry, 'name' | 'retainedProjectDirectory' | 'latestAccessed'>[];
}> {
  const { page, target } = await connect();
  const project = await readProject(page);
  if (project) return { open: true, project };

  const file = recentsFilePath(target);
  const recents = file
    ? readRecents(file)
        .sort((a, b) => b.latestAccessed - a.latestAccessed)
        .slice(0, 25)
        .map(({ name, retainedProjectDirectory, latestAccessed }) => ({
          name,
          retainedProjectDirectory,
          latestAccessed
        }))
    : [];

  return { open: false, project: null, recents };
}
