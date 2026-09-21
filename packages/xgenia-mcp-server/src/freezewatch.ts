/**
 * xgenia_freeze_watch — find out WHY the renderer froze, not just that it did.
 *
 * Every other tool here can tell you the editor stopped answering. None of them could tell
 * you what it was doing, and that gap cost a project most of a day: four separate theories
 * about a freeze, each plausible, each wrong, because "the renderer is blocked" is the end
 * of the information rather than the start of it.
 *
 * The trick is that you cannot ask after the fact. `Debugger.enable` needs the very thread
 * that is stuck, so a debugger attached after the freeze times out — which is exactly what
 * made this look unknowable. Attach and enable the debugger while the page is still
 * healthy, hold that one session open, and when health checks start timing out send
 * `Debugger.pause` on it. V8 services a pause via an interrupt, so it breaks into a running
 * synchronous loop and hands back the call frames.
 *
 * Used that way this turned a day of guessing into one stack:
 *
 *   xgeniaRuntime._doUpdate -> NodeContext.updateDirtyNodes
 *     -> Node._updateDependencies -> Node.update -> _updateDependencies -> ...
 *
 * — the runtime resolving values by walking data dependencies, with no cycle guard, on a
 * graph that contained a data cycle. Repeated frames are the signature; `repeatedFrames`
 * surfaces them directly.
 *
 * If the pre-armed pause never fires either, that is also an answer, and the result says
 * so: the thread is not spinning in JavaScript at all (native call, IPC wait, GC), and no
 * JS-level tool will show it.
 *
 * Run this BEFORE the risky action: start it, then perform the action with another call.
 */

import { discoverPort } from './connection.js';
import { SELECTORS } from './selectors.js';

interface Frame {
  fn: string;
  url: string;
  line?: number;
}

type CdpMessage = {
  id?: number;
  method?: string;
  params?: { callFrames?: { functionName?: string; url?: string; location?: { lineNumber?: number } }[]; reason?: string };
  result?: unknown;
  error?: unknown;
};

export async function freezeWatch(
  opts: { port?: number; watchMs?: number; pollMs?: number; evaluateTimeoutMs?: number } = {}
) {
  const port = opts.port ?? discoverPort();
  const watchMs = Math.min(Math.max(opts.watchMs ?? 120_000, 5_000), 900_000);
  const pollMs = Math.min(Math.max(opts.pollMs ?? 4_000, 500), 30_000);
  const evalTimeout = Math.min(Math.max(opts.evaluateTimeoutMs ?? 5_000, 1_000), 30_000);

  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'function') {
    return { error: 'no-websocket', hint: 'This Node version has no global WebSocket; freeze_watch needs Node 21+.' };
  }

  let list: { type: string; url: string; webSocketDebuggerUrl?: string }[];
  try {
    list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as typeof list;
  } catch (e) {
    return { error: 'cdp-unreachable', detail: (e as Error).message, port };
  }
  const target = list.find((t) => t.type === 'page' && t.url.includes(SELECTORS.editorPageUrlSuffix));
  if (!target?.webSocketDebuggerUrl) return { error: 'no-editor-page', targets: list.map((t) => t.url) };

  const WS = (globalThis as unknown as { WebSocket: new (u: string) => WebSocket }).WebSocket;
  const ws = new WS(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  let pausedParams: CdpMessage['params'] | null = null;

  ws.addEventListener('message', (ev: MessageEvent) => {
    let m: CdpMessage;
    try {
      m = JSON.parse(String(ev.data)) as CdpMessage;
    } catch {
      return;
    }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id)!;
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
    if (m.method === 'Debugger.paused') pausedParams = m.params ?? null;
  });

  const send = (method: string, params: Record<string, unknown> = {}, timeoutMs = 8_000) =>
    new Promise<unknown>((res, rej) => {
      const id = ++nextId;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          rej(new Error('timeout'));
        }
      }, timeoutMs);
    });

  try {
    await new Promise<void>((res, rej) => {
      const to = setTimeout(() => rej(new Error('websocket open timed out')), 10_000);
      ws.addEventListener('open', () => {
        clearTimeout(to);
        res();
      });
      ws.addEventListener('error', () => {
        clearTimeout(to);
        rej(new Error('websocket error'));
      });
    });

    // Arm while healthy. This is the whole point — doing it later cannot work.
    let armed = true;
    try {
      await send('Debugger.enable');
    } catch {
      armed = false;
    }

    const startedAt = Date.now();
    let blockedAtMs: number | null = null;
    let polls = 0;
    while (Date.now() - startedAt < watchMs) {
      try {
        await send('Runtime.evaluate', { expression: '1', returnByValue: true }, evalTimeout);
        polls += 1;
      } catch {
        blockedAtMs = Date.now() - startedAt;
        break;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }

    if (blockedAtMs === null) {
      return {
        froze: false,
        watchedMs: Date.now() - startedAt,
        healthyPolls: polls,
        armed,
        hint: 'The renderer answered for the whole window. If you expected a freeze, the triggering action may not have run yet — start this watch first, then perform the action.'
      };
    }

    if (!armed) {
      return {
        froze: true,
        blockedAfterMs: blockedAtMs,
        armed: false,
        verdict: 'no-stack-debugger-was-not-armed',
        hint: 'Debugger.enable failed while the page was healthy, so no stack could be captured. Retry the whole sequence from a healthy editor.'
      };
    }

    send('Debugger.pause', {}, 20_000).catch(() => {});
    const until = Date.now() + 25_000;
    while (Date.now() < until && !pausedParams) await new Promise((r) => setTimeout(r, 250));

    if (!pausedParams) {
      return {
        froze: true,
        blockedAfterMs: blockedAtMs,
        armed: true,
        verdict: 'not-blocked-in-javascript',
        hint: 'A pre-armed Debugger.pause never fired, so the main thread is NOT spinning in JS. Suspect a native/IPC wait, a synchronous layout storm, or GC thrash. No JS-level tool will show this; the editor may still recover on its own.'
      };
    }

    // Read through a local: the analyzer cannot see that the message listener assigns this,
    // so the earlier null-check narrows it to `never` without the explicit type here.
    const paused: NonNullable<CdpMessage['params']> = pausedParams;
    const frames: Frame[] = (paused.callFrames ?? []).slice(0, 30).map((f) => ({
      fn: f.functionName || '(anonymous)',
      url: (f.url ?? '').replace(/^https?:\/\/[^/]+/, ''),
      line: f.location?.lineNumber
    }));
    const counts = new Map<string, number>();
    for (const f of frames) {
      const k = `${f.fn} @${f.line}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const repeated = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    await send('Debugger.resume', {}, 5_000).catch(() => {});

    return {
      froze: true,
      blockedAfterMs: blockedAtMs,
      armed: true,
      verdict: 'js-stack-captured',
      reason: paused.reason,
      frames,
      repeatedFrames: repeated.map(([frame, count]) => ({ frame, count })),
      hint: repeated.length
        ? 'Repeated frames are the signature of a loop. Frames named around dependency/update resolution point at a graph cycle — run xgenia_project_audit and look for data-dependency-cycle or self-instancing-component.'
        : 'No frame repeated within the captured depth; the loop may be deeper than 30 frames, or the thread was busy rather than recursing.'
    };
  } catch (e) {
    return { error: 'freeze-watch-failed', detail: (e as Error).message };
  } finally {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
  }
}
