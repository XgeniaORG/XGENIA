/**
 * A second, independent way to ask "is the editor actually alive?".
 *
 * Every other reach into the editor in this package goes through Playwright's
 * `connectOverCDP`. That turns out to be a single point of failure *and* a single point of
 * misinformation: `connectOverCDP` waits for every page target to finish initialising, so
 * one slow or stuck target makes the whole connect time out even when the editor page
 * itself is perfectly healthy. `connection.ts` then reported `editor-unresponsive` — a
 * claim about the renderer that the evidence never supported.
 *
 * That mattered. A build lost hours to it: four `editor-unresponsive` reports in a row were
 * taken as proof that instancing a particular component wedged the renderer, and a
 * workaround was designed around a symptom that was never real. Probing the same page
 * directly over raw CDP during one of those "hangs" got an answer in 9 milliseconds.
 *
 * So this module speaks CDP over plain HTTP + WebSocket with no Playwright in the path:
 *
 *   GET /json/list            -> does the browser's IO thread answer at all?
 *   Runtime.evaluate on page  -> does the renderer's main thread answer at all?
 *
 * Those two questions separate the three states that used to be one:
 *
 *   - connect-stalled     the page answers fine; Playwright is the problem. RETRY.
 *   - editor-blocked      HTTP answers, the renderer does not. Really wedged.
 *   - editor-unresponsive not even HTTP answers, though something owns the port.
 *
 * Both blocked and stalled are real and observed — they are told apart by evidence, not by
 * assumption, which is the entire point of this file.
 */

/** Node 18/20 have no global WebSocket; the evaluate leg degrades rather than throwing. */
const hasWebSocket = typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'function';

export interface RawProbeResult {
  /** Did `GET /json/list` answer? The browser process's IO thread is alive if so. */
  httpOk: boolean;
  /** Every page target the browser reported, by url. */
  targets: { type: string; url: string }[];
  /** Was a page matching the editor url suffix present? */
  editorFound: boolean;
  /** Did the editor page evaluate an expression? null when not attempted. */
  editorPageResponsive: boolean | null;
  /** Round trip for the evaluate, in ms. */
  evalMs: number | null;
  /** Value the evaluate returned, when it returned one. */
  evalResult?: unknown;
  /** Why a leg did not complete. */
  error?: string;
}

/** The three ways reaching the editor can fail, plus the healthy case. */
export type ProbeVerdict = 'ok' | 'connect-stalled' | 'editor-blocked' | 'editor-unresponsive' | 'not-running';

/**
 * Turn probe observations into a verdict. Pure, so the decision is testable without a
 * browser — which is the part that was previously untestable and wrong.
 *
 * `listening` is whether anything owns the CDP port at all.
 */
export function classifyProbe(p: {
  listening: boolean;
  httpOk: boolean;
  editorPageResponsive: boolean | null;
  /**
   * Whether a Playwright connect actually failed just now. Without this the healthy case
   * is indistinguishable from the stalled one: both have a responsive page, and only a
   * failed connect makes "stalled" the right word. Defaults to true because the original
   * caller is the failure path.
   */
  connectFailed?: boolean;
}): ProbeVerdict {
  const connectFailed = p.connectFailed ?? true;
  if (!p.listening && !p.httpOk) return 'not-running';
  // The renderer answered. Whatever failed, it was not the editor page.
  if (p.editorPageResponsive === true) return connectFailed ? 'connect-stalled' : 'ok';
  // HTTP answers but the page will not evaluate: the renderer's main thread is blocked.
  if (p.httpOk && p.editorPageResponsive === false) return 'editor-blocked';
  // Something owns the port but CDP itself is not answering.
  if (!p.httpOk) return 'editor-unresponsive';
  // HTTP fine, evaluate not attempted (no WebSocket available): cannot tell. Say the
  // least-committal thing rather than inventing a renderer diagnosis.
  return 'connect-stalled';
}

/** Human-facing guidance per verdict, so callers do not have to re-derive it. */
export function probeHint(v: ProbeVerdict): string {
  switch (v) {
    case 'connect-stalled':
      return 'The editor page answered a direct CDP evaluate, so the renderer is alive and the Playwright connect is what stalled. Retry the call. Do not restart the editor and do not change the project.';
    case 'editor-blocked':
      return 'CDP answers but the editor page will not evaluate: the renderer main thread is genuinely blocked. It may recover on its own within a few minutes. xgenia_console_tail attached before the triggering action is how to learn why; xgenia_restart { force: true } recovers it, losing unsaved work.';
    case 'editor-unresponsive':
      return 'Something owns the CDP port but CDP itself is not answering. The process may be starting, dying, or hung below the renderer. Check the port owner and its age before relaunching.';
    case 'not-running':
      return 'Nothing is listening on the CDP port. Launch the editor.';
    case 'ok':
      return 'The editor page is responsive.';
  }
}

async function httpJson(url: string, timeoutMs: number): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Evaluate an expression on a page over a bare CDP websocket.
 *
 * Deliberately minimal: one message, one reply, a hard timeout. Anything cleverer risks
 * reintroducing the "waits for the whole browser to be ready" failure this exists to avoid.
 */
async function wsEvaluate(wsUrl: string, expression: string, timeoutMs: number): Promise<unknown> {
  const WS = (globalThis as unknown as { WebSocket: new (u: string) => WebSocket }).WebSocket;
  const ws = new WS(wsUrl);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`evaluate timed out after ${timeoutMs}ms`)), timeoutMs);
      const done = (fn: () => void) => {
        clearTimeout(timer);
        fn();
      };
      ws.addEventListener('open', () =>
        ws.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise: false }
          })
        )
      );
      ws.addEventListener('message', (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { id?: number; result?: { result?: { value?: unknown } } };
          if (msg.id === 1) done(() => resolve(msg.result?.result?.value));
        } catch {
          /* not our frame */
        }
      });
      ws.addEventListener('error', () => done(() => reject(new Error('websocket error'))));
      ws.addEventListener('close', () => done(() => reject(new Error('websocket closed before replying'))));
    });
  } finally {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
  }
}

/**
 * Probe the editor without Playwright.
 *
 * `editorUrlSuffix` selects the editor page among the browser's targets, the same way
 * `connect()` does, so both agree on which page "the editor" means.
 */
export async function rawProbe(
  port: number,
  editorUrlSuffix: string,
  opts: { timeoutMs?: number; expression?: string } = {}
): Promise<RawProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const expression = opts.expression ?? '({ready:document.readyState})';
  const out: RawProbeResult = {
    httpOk: false,
    targets: [],
    editorFound: false,
    editorPageResponsive: null,
    evalMs: null
  };

  let list: { type: string; url: string; webSocketDebuggerUrl?: string }[];
  try {
    list = (await httpJson(`http://127.0.0.1:${port}/json/list`, timeoutMs)) as typeof list;
    out.httpOk = true;
  } catch (e) {
    out.error = `json/list: ${(e as Error).message}`;
    return out;
  }

  out.targets = list.map((t) => ({ type: t.type, url: t.url }));
  const editor = list.find((t) => t.type === 'page' && t.url.includes(editorUrlSuffix));
  out.editorFound = Boolean(editor);
  if (!editor?.webSocketDebuggerUrl) {
    out.error = out.editorFound ? 'editor page has no websocket debugger url' : 'no editor page among targets';
    return out;
  }
  if (!hasWebSocket) {
    out.error = 'no global WebSocket on this Node version; skipped the evaluate leg';
    return out;
  }

  const started = Date.now();
  try {
    out.evalResult = await wsEvaluate(editor.webSocketDebuggerUrl, expression, timeoutMs);
    out.editorPageResponsive = true;
  } catch (e) {
    out.editorPageResponsive = false;
    out.error = `evaluate: ${(e as Error).message}`;
  }
  out.evalMs = Date.now() - started;
  return out;
}
