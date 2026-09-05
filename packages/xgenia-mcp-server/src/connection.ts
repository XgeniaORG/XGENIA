import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page, type Frame } from 'playwright-core';
import { userDataDirs } from './platform.js';
import { SELECTORS } from './selectors.js';

export type Target = 'app' | 'dev';

export const DEFAULT_PORT = 9223;

/**
 * Chromium writes the live debugging port here on startup. Reading it beats
 * hardcoding, because it survives a port change without a harness release.
 */
export function readDevToolsActivePort(dir: string): number | null {
  try {
    const first = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    const port = Number(first.trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function discoverPort(dirs: string[] = userDataDirs()): number {
  const fromEnv = Number(process.env.XGENIA_CDP_PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  for (const dir of dirs) {
    const port = readDevToolsActivePort(dir);
    if (port) return port;
  }
  return DEFAULT_PORT;
}

export function classifyTarget(url: string): Target {
  return url.startsWith('file:') ? 'app' : 'dev';
}

interface Connection {
  browser: Browser;
  page: Page;
  target: Target;
  port: number;
}

let cached: Connection | null = null;

export function resetConnection(): void {
  cached = null;
}

/**
 * Attach to the editor window.
 *
 * The page is selected by URL, never by position: a running editor also exposes
 * a viewer webview and a cloud-runtime page, and their order is not a contract.
 */
export async function connect(port = discoverPort()): Promise<Connection> {
  if (cached && cached.browser.isConnected() && !cached.page.isClosed()) return cached;
  cached = null;

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  } catch (e) {
    const err = new Error(
      `Could not reach XGENIA on 127.0.0.1:${port}. Is it running? (${String(e)})`
    );
    (err as Error & { code?: string }).code = 'not-running';
    throw err;
  }

  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => p.url().includes(SELECTORS.editorPageUrlSuffix));
  if (!page) {
    const err = new Error(
      `Connected on ${port} but no editor page was found. Saw: ${pages.map((p) => p.url()).join(', ') || '(none)'}`
    );
    (err as Error & { code?: string }).code = 'no-editor-page';
    throw err;
  }

  cached = { browser, page, target: classifyTarget(page.url()), port };
  return cached;
}

export function getChatFrame(page: Page): Frame | null {
  return page.frames().find((f) => f.url().includes('xgenia-ai-app')) ?? null;
}
