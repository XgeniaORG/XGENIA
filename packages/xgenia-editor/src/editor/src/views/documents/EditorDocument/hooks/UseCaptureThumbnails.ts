import { ProjectModel } from '@xgenia-models/projectmodel';
import { useEffect } from 'react';
import { CanvasView } from '../../../VisualCanvas/CanvasView';
import { ipcRenderer } from 'electron';

/**
 * How often the project thumbnail is refreshed, when there is any reason to.
 *
 * 2026-08-12 perf audit. This was a bare `setInterval` with no dirty check and no
 * visibility check, running for the whole session. Every tick took a full
 * `capturePage`, encoded it to PNG, decoded it back into an `Image`, drew it to a
 * canvas and encoded it to PNG a SECOND time — around 60-90ms of main-thread work
 * — and then handed the result to `LocalProjectsModel`, whose store is a cacheless
 * `conf` instance, so it rewrote the whole `recently_opened_project.json`
 * synchronously. That file measured 7.7MB packaged and 120MB in dev.
 *
 * So: a periodic multi-hundred-millisecond — in dev, multi-SECOND — freeze, three
 * times a minute, to refresh a picture that usually had not changed.
 */
const THUMBNAIL_INTERVAL_MS = 20 * 1000;

export function useCaptureThumbnails(canvasView: CanvasView, viewerDetached: boolean) {
  useEffect(() => {
    let cancelled = false;

    /**
     * Whether anything might have changed since the last capture.
     *
     * Deliberately keyed on raw user input rather than on a project event. There
     * is no single "the project changed" event on ProjectModel — it emits a dozen
     * specific ones (componentAdded, rootNodeChanged, variantRenamed, …) and
     * listening for a subset would silently stop refreshing thumbnails for
     * whichever edit was left off the list. Input is the conservative signal: it
     * over-captures slightly while the user is working, and captures NOTHING
     * while the editor sits idle, which is the case that was burning the CPU.
     *
     * Starts true so the first tick after opening a project always captures.
     *
     * ─── AND THE AI IS INPUT NOBODY TYPES (2026-08-19) ───────────────────────
     * Raw input was the conservative signal for a human editing by hand. It is the WRONG
     * signal for this product, because the thing that changes the project most is the AI, and
     * it mutates through the ChatPanel bridge without generating a single pointer, key or
     * wheel event. So an entire AI build produced ZERO captures and the home screen kept
     * whatever picture it had from the last time a person clicked something. The user noticed
     * before any test did: "it used to take screenshots of the game as you built and saved it
     * to homepage — that seems broken now."
     *
     * EditorBridge.executeCommand emits `xgenia:project-mutated` for every non-read command,
     * which is the same conservative shape as input — it says "something is happening", not
     * "this specific thing changed" — and it keeps the property the interval fix was really
     * after: nothing is captured while the editor sits idle.
     */
    let dirty = true;
    const markDirty = () => {
      dirty = true;
    };

    window.addEventListener('pointerdown', markDirty, true);
    window.addEventListener('keydown', markDirty, true);
    window.addEventListener('wheel', markDirty, { capture: true, passive: true });
    window.addEventListener('xgenia:project-mutated', markDirty);

    const timer = setInterval(async () => {
      // Nothing has happened since the last capture, or nobody is looking at it.
      if (!dirty || document.hidden) return;
      dirty = false;

      if (viewerDetached) {
        // A `once` per tick leaked a listener on every tick whose reply never
        // arrived — and a detached viewer that has gone away never replies.
        const onReply = (_event: unknown, url: string) => {
          if (!cancelled) ProjectModel.instance.setThumbnailFromDataURI(url);
        };
        ipcRenderer.once('viewer-capture-thumb-reply', onReply);
        ipcRenderer.send('viewer-capture-thumb');
        setTimeout(() => ipcRenderer.removeListener('viewer-capture-thumb-reply', onReply), 5000);
      } else {
        const thumb = await canvasView?.captureThumbnail();
        if (cancelled) return;
        if (thumb?.toDataURL) {
          ProjectModel.instance.setThumbnailFromDataURI(thumb.toDataURL());
        }
      }
    }, THUMBNAIL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('pointerdown', markDirty, true);
      window.removeEventListener('keydown', markDirty, true);
      window.removeEventListener('wheel', markDirty, { capture: true } as EventListenerOptions);
      window.removeEventListener('xgenia:project-mutated', markDirty);
    };
  }, [canvasView, viewerDetached]);
}
