import type { Page } from 'playwright-core';
import { connect, discoverPort, getChatFrame, type RawCdpProbe, type Target } from './connection.js';
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
  /**
   * Display name of the model the panel will run the next turn on, read from
   * the footer's model selector — null when that control is not rendered.
   * The model is chosen inside XGENIA, not by the caller, and a frontier
   * model turns a long build into real money, so this is surfaced as text
   * rather than leaving callers to read it off a screenshot.
   */
  model?: string | null;
  /** Running conversation cost as the header shows it (e.g. "$0.42"), or null when not shown. */
  cost?: string | null;
  /** Context-window usage as the header shows it (e.g. "12% of context"), or null when not shown. */
  contextUsage?: string | null;
}

const MAX_ERROR_LEN = 300;

export async function readChatState(page: Page): Promise<ChatState> {
  const frame = getChatFrame(page);
  if (!frame) return { mounted: false, busy: false, messageCount: 0, unavailable: 'no-frame' };
  try {
    return await frame.evaluate(
      (sel) => {
        // The trigger renders three spans: a status glyph, the model name, and a
        // caret ("●", "Glm 5.3 Flashx", "▲"). innerText of the whole control is
        // all three on separate lines, so take the longest span — the name.
        const trigger = document.querySelector(sel.chatModelTrigger);
        const model = trigger
          ? Array.from(trigger.querySelectorAll('span'))
              .map((el) => (el.textContent ?? '').trim())
              .filter(Boolean)
              .sort((a, b) => b.length - a.length)[0] ?? null
          : null;
        // The context meter is a role=progressbar with aria-valuenow in percent
        // and one child per segment carrying `title="Input: 0.1%"` etc.
        const meter = document.querySelector(sel.chatContextUsage);
        const valueNow = meter?.getAttribute('aria-valuenow');
        const contextPercent = valueNow !== null && valueNow !== undefined ? Number(valueNow) : null;
        const contextBreakdown = meter
          ? Array.from(meter.children)
              .map((el) => el.getAttribute('title') ?? '')
              .filter(Boolean)
          : [];
        // The cost is a pill in the header whose text starts with "$"; nothing
        // labels it, so it is found by its text rather than a selector.
        let cost: string | null = null;
        for (const el of Array.from(document.querySelectorAll('span'))) {
          const t = (el.textContent ?? '').trim();
          if (/^\$\d[\d.,]*$/.test(t) && el.children.length <= 1) {
            cost = t;
            break;
          }
        }
        return {
          mounted: !!document.querySelector(sel.chatInput),
          busy: !!document.querySelector(sel.chatStop),
          messageCount: document.querySelectorAll('[aria-label="Copy message to clipboard"]').length,
          model,
          cost,
          contextUsage:
            contextPercent !== null && Number.isFinite(contextPercent)
              ? `${contextPercent}%${contextBreakdown.length ? ` (${contextBreakdown.join(', ')})` : ''}`
              : null
        };
      },
      {
        chatInput: SELECTORS.chatInput,
        chatStop: SELECTORS.chatStop,
        chatModelTrigger: SELECTORS.chatModelTrigger,
        chatContextUsage: SELECTORS.chatContextUsage
      }
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
  cap: number,
  /** Messages the panel has collapsed before the first rendered one; added to every index. */
  indexOffset = 0
): ChatMessageOut[] {
  return messages.slice(since, since + limit).map((m, i) => ({
    index: indexOffset + since + i,
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
  /** Active model's display name from the panel footer, or null when the panel is not showing one. See ChatState.model. */
  chatModel?: string | null;
  /** Running conversation cost as shown in the panel header, or null. */
  chatCost?: string | null;
  /** Context-window usage as shown in the panel header, or null. */
  chatContextUsage?: string | null;
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
  /**
   * Present when `running` is false and something owned the port: what a raw
   * CDP probe (HTTP /json/list + one Runtime.evaluate on the editor page over
   * a fresh websocket, bypassing Playwright) saw. This is the evidence behind
   * `code`: `connect-stalled` means the editor page answered here and only
   * Playwright's connect failed, so a restart is not indicated.
   */
  rawCdp?: RawCdpProbe;
}

/**
 * Build the `HealthReport` for "connect() itself failed" -- pure and
 * stub-testable independent of a real CDP connection, matching the pattern
 * of the other decision points in this package (`combinePreKillReads`,
 * `unresponsiveRefusal`, etc.).
 */
export function unresponsiveHealthReport(
  port: number,
  code: string,
  hint: string,
  rawCdp?: RawCdpProbe
): HealthReport {
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
    hint,
    ...(rawCdp ? { rawCdp } : {})
  };
}

export async function health(): Promise<HealthReport> {
  const port = discoverPort();
  let page: Page;
  let target: Target;
  try {
    ({ page, target } = await connect(port));
  } catch (e) {
    const err = e as Error & { code?: string; probe?: RawCdpProbe };
    return unresponsiveHealthReport(port, err.code ?? 'not-running', err.message, err.probe);
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
    chatModel: chat.model ?? null,
    chatCost: chat.cost ?? null,
    chatContextUsage: chat.contextUsage ?? null,
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
    for (const name of ['chatInput', 'chatStop', 'chatSend', 'chatModelTrigger', 'chatContextUsage'] as const) {
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
  // chatModelTrigger/chatContextUsage feed the model/cost/context read-outs;
  // their absence degrades those to null rather than breaking the harness.
  const optional = new Set(['chatStop', 'chatSend', 'chatModelTrigger', 'chatContextUsage']);
  const required = checks.filter((c) => !optional.has(c.name));
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
