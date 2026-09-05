import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page, type Frame } from 'playwright-core';
import { userDataDirs, portOwner } from './platform.js';
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
 * Check if a cached connection is valid for the requested port.
 * A cache hit requires the browser to be connected, page not closed, and port to match.
 */
export function isCacheHit(cached: Connection | null, port: number): boolean {
  return (
    cached !== null &&
    cached.browser.isConnected() &&
    !cached.page.isClosed() &&
    cached.port === port
  );
}

/**
 * How long `connectOverCDP` may take before this gives up, rather than the
 * library's own default of 30 seconds.
 *
 * That default is what let a wedged editor take a full 30s to report
 * anything at all — reproduced live: `xgenia_health` failed only after
 * `TimeoutError: browserType.connectOverCDP: Timeout 30000ms exceeded`, even
 * though the websocket itself connected immediately (`<ws connected>` in the
 * debug log) — `connectOverCDP` was still waiting for every page target to
 * finish initialising, and a wedged renderer's page never does. 10s is short
 * enough to detect that quickly instead of eating half a minute on every
 * call, while remaining generous next to the in-page read bounds elsewhere
 * in this package (`PRE_KILL_READ_TIMEOUT_MS` 5s, `SAVE_READ_TIMEOUT_MS` 7s
 * in lifecycle.ts): unlike those, this also covers opening a fresh CDP
 * websocket session and enumerating browser contexts/targets from scratch,
 * which a busy-but-healthy machine can genuinely make slower than an
 * in-page evaluate on an already-open page.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Which error code a failed `connectOverCDP` attempt should report.
 *
 * Pure decision, stub-testable independent of a real port lookup: whether
 * anything is listening on the port is what distinguishes a genuinely
 * not-running editor from one that is up (something is bound to the port)
 * but never became usable within the connect timeout — e.g. a renderer
 * whose main thread is wedged. A caller told `not-running` when the editor
 * is actually just unresponsive would reasonably conclude there is nothing
 * to kill and nothing to wait for, which is exactly backwards.
 */
export function connectFailureCode(listening: boolean): 'not-running' | 'editor-unresponsive' {
  return listening ? 'editor-unresponsive' : 'not-running';
}

function connectError(port: number, cause: unknown): Error & { code: string } {
  const listening = portOwner(port) !== null;
  const code = connectFailureCode(listening);
  const message =
    code === 'editor-unresponsive'
      ? `XGENIA on 127.0.0.1:${port} is running but not responding (${String(cause)}). The renderer may be wedged.`
      : `Could not reach XGENIA on 127.0.0.1:${port}. Is it running? (${String(cause)})`;
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/**
 * Attach to the editor window.
 *
 * The page is selected by URL, never by position: a running editor also exposes
 * a viewer webview and a cloud-runtime page, and their order is not a contract.
 */
export async function connect(
  port = discoverPort(),
  opts: { timeoutMs?: number } = {}
): Promise<Connection> {
  if (isCacheHit(cached, port)) return cached!;

  // If there's a cached connection to a different port, dispose of it
  if (cached) {
    await cached.browser.close().catch(() => {});
  }
  cached = null;

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      timeout: opts.timeoutMs ?? CONNECT_TIMEOUT_MS
    });
  } catch (e) {
    throw connectError(port, e);
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
  return page.frames().find((f) => f.url().includes(SELECTORS.chatFrameUrlSubstring)) ?? null;
}
