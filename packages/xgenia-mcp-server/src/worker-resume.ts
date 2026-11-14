/**
 * A CDP client that auto-attaches makes every new web worker wait for a debugger before it runs.
 * Playwright does not always release workers in the preview's own process, and the game then hangs
 * on anything that needs one: Pixi decodes textures in a worker, so a RevoltFX atlas never finished
 * loading while this harness was connected (2026-11-09). People without the harness never see it.
 * Releasing a worker that is not waiting does nothing, so each new one simply gets released once.
 */
export interface CdpTarget {
  id: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

export function workersToRelease(targets: CdpTarget[], seen: Set<string>): CdpTarget[] {
  return targets.filter((t) => t.type === 'worker' && !!t.webSocketDebuggerUrl && !seen.has(t.id));
}

function release(url: string): void {
  const ws = new WebSocket(url);
  ws.onopen = () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.runIfWaitingForDebugger' }));
    setTimeout(() => ws.close(), 300);
  };
  ws.onerror = () => {};
}

const started = new Set<number>();

export function keepWorkersRunning(port: number, intervalMs = 700): void {
  if (started.has(port)) return;
  started.add(port);
  const seen = new Set<string>();
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) });
      for (const t of workersToRelease((await res.json()) as CdpTarget[], seen)) {
        seen.add(t.id);
        release(t.webSocketDebuggerUrl!);
      }
    } catch {
      // Editor down or restarting; the next tick tries again.
    }
  }, intervalMs);
  timer.unref();
}
