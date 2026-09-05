import type { Page } from 'playwright-core';
import { connect, getChatFrame, type Target } from './connection.js';
import { SELECTORS } from './selectors.js';
import { recentsFilePath, readRecents, type RecentEntry } from './recents.js';

export interface ProjectInfo {
  name: string;
  id: string | null;
  dir: string | null;
  componentCount: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
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

export async function readChatState(
  page: Page
): Promise<{ mounted: boolean; busy: boolean; messageCount: number }> {
  const frame = getChatFrame(page);
  if (!frame) return { mounted: false, busy: false, messageCount: 0 };
  try {
    return await frame.evaluate(
      (sel) => ({
        mounted: !!document.querySelector(sel.chatInput),
        busy: !!document.querySelector(sel.chatStop),
        messageCount: document.querySelectorAll('[aria-label="Copy message to clipboard"]').length
      }),
      { chatInput: SELECTORS.chatInput, chatStop: SELECTORS.chatStop }
    );
  } catch {
    return { mounted: false, busy: false, messageCount: 0 };
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
  /** The editor page's <title>. Always the literal "XGENIA" — carries no version. */
  pageTitle: string | null;
}

export async function health(): Promise<HealthReport> {
  const { page, target, port } = await connect();

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
    pageTitle
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
  const { page } = await connect();
  const project = await readProject(page);
  if (project) return { open: true, project };

  const file = recentsFilePath();
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
