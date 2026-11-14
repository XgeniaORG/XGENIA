/**
 * paintWait.ts — wait until what was just changed in the editor's DOM has been painted.
 *
 * Every preview capture copies OUR OWN window's last presented frame (IframeViewer.capturePage), so
 * a capture taken in the same frame as a DOM change copies the frame from BEFORE it. (2026-10-07,
 * export 1791364986355) The design capture resized the preview to 1440x810 and read the guest's
 * innerWidth — layout answers at once — then captured in that same frame: the image was the editor
 * at its normal layout, the AI was told the game was "a small thumbnail", and the user was asked to
 * widen a preview that was never the problem. Reproduced live: the same resize captured two frames
 * later is the whole game.
 *
 * Two frames: the first requestAnimationFrame callback runs BEFORE that frame is painted; by the
 * second, the frame carrying the change has been submitted. A window that is not producing frames
 * (minimised, hidden — CanvasView.staleFrameReason refuses those first) must not hang a capture,
 * so the wait also ends after `timeoutMs`.
 */
export function afterNextPaint(
  raf: (cb: () => void) => unknown = (cb) => requestAnimationFrame(() => cb()),
  timeoutMs = 250
): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    raf(() => raf(finish));
  });
}

/**
 * Re-read a value each tick until `done` says it has settled, or the time runs out.
 *
 * (2026-10-07, 3.0.2, Untitled-7) The design capture resized the preview and the guest's viewport
 * answered 1440x810 at once — but the game's canvas redraws on its own resize handler a little later,
 * and one capture in eleven still showed the old small canvas in the corner of a transparent frame,
 * with the editor behind it. The capture now waits for the canvas itself (CanvasView).
 */
export async function waitUntilSettled<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  options: { timeoutMs?: number; tick?: () => Promise<void>; now?: () => number } = {}
): Promise<{ settled: boolean; value: T }> {
  const now = options.now || (() => Date.now());
  const tick = options.tick || (() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  const deadline = now() + (options.timeoutMs ?? 1000);
  let value = await read();
  while (!done(value)) {
    if (now() >= deadline) return { settled: false, value };
    await tick();
    value = await read();
  }
  return { settled: true, value };
}

/**
 * True when every letterboxed Group (`.xgenia-ui-canvas`, Group.tsx) carries the scale its window
 * calls for. Runs in the guest, sent as source — it uses nothing but its argument and globals.
 *
 * (2026-10-07, export 1791393153568) A letterbox measures its window with a ResizeObserver and
 * re-renders its scale after the resize. The capture copied the preview before that: the game drawn
 * at the 383px pane's scale in the middle of the 1440x810 frame ("about 27% of the width"), and the AI
 * pinned the group to 1920px x 1080px to "fix" it — which crops the game in every smaller window.
 */
export function letterboxesSettled(doc: { querySelectorAll(sel: string): ArrayLike<any> }): boolean {
  const canvases = Array.prototype.slice.call(doc.querySelectorAll('.xgenia-ui-canvas'));
  for (let i = 0; i < canvases.length; i++) {
    const c = canvases[i];
    const o = c && c.parentElement;
    if (!o) continue;
    const dw = parseFloat(c.style.width);
    const dh = parseFloat(c.style.height);
    const m = /scale\(([0-9.]+)/.exec(c.style.transform || '');
    if (!(dw > 0) || !(dh > 0) || !m || !(o.clientWidth > 0) || !(o.clientHeight > 0)) continue;
    const want = Math.min(o.clientWidth / dw, o.clientHeight / dh);
    if (Math.abs(parseFloat(m[1]) - want) > Math.max(0.005, want * 0.02)) return false;
  }
  return true;
}
