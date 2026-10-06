import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page, type Frame } from 'playwright-core';
import { userDataDirs, portOwner } from './platform.js';
import { SELECTORS, isChatFrameUrl } from './selectors.js';

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

export interface RawCdpTarget {
  type: string;
  url: string;
  /** Whether a bounded Runtime.evaluate on this target answered. Only probed for the editor page. */
  responsive?: boolean;
  evaluateMs?: number;
}

export interface RawCdpProbe {
  /** Whether http://127.0.0.1:<port>/json/list answered within the bound. */
  httpOk: boolean;
  targets: RawCdpTarget[];
  /** Whether the editor page target itself answered a Runtime.evaluate over a fresh raw websocket. null when it could not be probed (no editor target, no WebSocket in this Node). */
  editorPageResponsive: boolean | null;
  error?: string;
}

const RAW_PROBE_TIMEOUT_MS = 3_000;

/**
 * Ask Chromium directly what is on the port, bypassing Playwright entirely.
 *
 * `connectOverCDP` initialises EVERY page target before it resolves, so one
 * hung or mid-teardown target — the editor also hosts a cloud-runtime shell
 * page and the viewer — stalls the whole connect even when the editor page is
 * perfectly responsive. Reproduced 2026-09-19: connect timed out at 10s with
 * `<ws connected>` and nothing after, while a raw websocket to the editor
 * page answered `Runtime.evaluate` in 11ms and `/json/list` showed a third
 * (second cloud-runtime) page that was gone a minute later. Reporting that as
 * "the renderer may be wedged" was a guess dressed as a diagnosis; this probe
 * is what lets the failure report say which it actually was.
 */
export async function probeRawCdp(port: number, timeoutMs = RAW_PROBE_TIMEOUT_MS): Promise<RawCdpProbe> {
  const withTimeout = <T>(p: Promise<T>, label: string): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs))
    ]);

  let list: { type: string; url: string; webSocketDebuggerUrl?: string }[];
  try {
    const res = await withTimeout(fetch(`http://127.0.0.1:${port}/json/list`), 'GET /json/list');
    list = (await res.json()) as typeof list;
  } catch (e) {
    return { httpOk: false, targets: [], editorPageResponsive: null, error: (e as Error).message };
  }

  const targets: RawCdpTarget[] = list.map((t) => ({ type: t.type, url: t.url }));
  const editor = list.find((t) => t.url.includes(SELECTORS.editorPageUrlSuffix));
  const editorTarget = targets.find((t) => t.url.includes(SELECTORS.editorPageUrlSuffix));
  const WS = (globalThis as { WebSocket?: new (url: string) => WebSocket }).WebSocket;
  if (!editor?.webSocketDebuggerUrl || !WS || !editorTarget) {
    return { httpOk: true, targets, editorPageResponsive: null };
  }

  const started = Date.now();
  try {
    const responsive = await withTimeout(
      new Promise<boolean>((resolve, reject) => {
        const ws = new WS(editor.webSocketDebuggerUrl!);
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.readyState', returnByValue: true } }));
        });
        ws.addEventListener('message', (ev: MessageEvent) => {
          try {
            const msg = JSON.parse(String(ev.data));
            if (msg.id === 1) {
              ws.close();
              resolve(!msg.error);
            }
          } catch (e) {
            ws.close();
            reject(e);
          }
        });
        ws.addEventListener('error', () => reject(new Error('websocket error')));
      }),
      'Runtime.evaluate on the editor page'
    );
    editorTarget.responsive = responsive;
    editorTarget.evaluateMs = Date.now() - started;
    return { httpOk: true, targets, editorPageResponsive: responsive };
  } catch (e) {
    editorTarget.responsive = false;
    editorTarget.evaluateMs = Date.now() - started;
    return { httpOk: true, targets, editorPageResponsive: false, error: (e as Error).message };
  }
}

/**
 * Which error code a failed connect should carry once the raw probe has spoken.
 *
 *   not-running          nothing owns the port
 *   editor-unresponsive  something owns it but the editor page itself did not answer
 *   connect-stalled      the editor page answered raw CDP; Playwright's connect is what stalled
 *                        (another target hung or churning, or the connect timeout too short for a loaded machine)
 */
export function connectFailureCodeFromProbe(
  listening: boolean,
  probe: RawCdpProbe | null
): 'not-running' | 'editor-unresponsive' | 'connect-stalled' {
  if (!listening) return 'not-running';
  if (probe?.editorPageResponsive === true) return 'connect-stalled';
  return 'editor-unresponsive';
}

export function describeProbe(probe: RawCdpProbe | null): string {
  if (!probe) return 'raw CDP not probed';
  if (!probe.httpOk) return `raw CDP HTTP did not answer (${probe.error ?? 'no detail'})`;
  const list = probe.targets.map((t) => `${t.type} ${t.url}${t.responsive === undefined ? '' : t.responsive ? ` [answered in ${t.evaluateMs}ms]` : ' [did NOT answer]'}`);
  return `raw CDP sees ${probe.targets.length} target(s): ${list.join('; ')}`;
}

async function connectError(port: number, cause: unknown): Promise<Error & { code: string; probe?: RawCdpProbe }> {
  const listening = portOwner(port) !== null;
  const probe = listening ? await probeRawCdp(port).catch(() => null) : null;
  const code = connectFailureCodeFromProbe(listening, probe);
  const detail = describeProbe(probe);
  const message =
    code === 'connect-stalled'
      ? `XGENIA on 127.0.0.1:${port} is up and its editor page answers raw CDP, but Playwright's connectOverCDP did not finish within the timeout (${String(cause)}). ${detail}. connectOverCDP waits for every page target to initialise, so a hung or churning non-editor target (cloud-runtime shell, viewer) stalls it. Retry; a forced restart is NOT indicated by this alone.`
      : code === 'editor-unresponsive'
        ? `XGENIA on 127.0.0.1:${port} is running but its editor page did not answer (${String(cause)}). ${detail}. The renderer may be wedged; xgenia_restart with force is the recovery.`
        : `Could not reach XGENIA on 127.0.0.1:${port}. Is it running? (${String(cause)})`;
  const err = new Error(message) as Error & { code: string; probe?: RawCdpProbe };
  err.code = code;
  if (probe) err.probe = probe;
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
    throw await connectError(port, e);
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
  return page.frames().find((f) => isChatFrameUrl(f.url())) ?? null;
}
