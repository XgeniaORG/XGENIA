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
