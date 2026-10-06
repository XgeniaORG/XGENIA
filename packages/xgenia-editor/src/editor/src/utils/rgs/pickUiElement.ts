// "Select from UI": let the user click an element in the rendered preview and
// get back the node it belongs to.
//
// Nothing new has to be taught to the preview for this. In Edit mode the frame's
// preload already runs an inspector: a click finds the nearest element carrying
// `data-xgenia-node-id` and reports it to the host (`inspector-node-selected`),
// which CanvasView turns into an `inspectNodes` event on the EventDispatcher —
// the same event that selects the node in the graph. A pick is therefore: make
// sure the inspector is on, wait for the next `inspectNodes`, put the inspector
// back the way it was.
//
// "Back the way it was" matters. In Preview mode the inspector is OFF so the
// player can actually play; leaving it on after a pick would hijack every later
// click in the preview. The preload's `isEnabled()` says which state we found.

import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';

import { getActivePreviewHost } from '../previewHostRegistry';

export type UiPickResult =
  | { status: 'picked'; nodeId: string }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string };

export interface UiPick {
  promise: Promise<UiPickResult>;
  /** Stop waiting. Resolves the promise as cancelled and restores the inspector. */
  cancel: () => void;
}

const NO_PREVIEW = 'The preview is not showing — open the project in the editor and try again.';
const NO_INSPECTOR =
  'The preview has no inspector (it is still loading, or shows a page the editor did not render). Pick from the node graph instead.';

/** Is there a preview frame a pick could use right now? */
export function isPreviewPickerAvailable(): boolean {
  return !!getActivePreviewHost();
}

// Evaluated INSIDE the preview frame. Returns what the inspector's state was
// before we touched it — true (already on: nothing to restore), false (was off:
// restore afterwards), null (an older preload without isEnabled: leave it on,
// which is the pre-existing behaviour of Edit mode) — or 'missing' when the
// preload never ran in this frame.
const ENABLE_INSPECTOR = `(function () {
  try {
    var api = window.XgeniaEditorInspectorAPI;
    if (!api || typeof api.setEnabled !== 'function') return 'missing';
    var was = typeof api.isEnabled === 'function' ? !!api.isEnabled() : null;
    if (was !== true) api.setEnabled(true);
    return was;
  } catch (e) {
    return 'missing';
  }
})()`;

const DISABLE_INSPECTOR = `(function () {
  try {
    var api = window.XgeniaEditorInspectorAPI;
    if (api && typeof api.setEnabled === 'function') api.setEnabled(false);
  } catch (e) { /* frame is gone */ }
})()`;

export function pickUiElementFromPreview(): UiPick {
  let resolveFn: (result: UiPickResult) => void = () => undefined;
  const promise = new Promise<UiPickResult>((resolve) => {
    resolveFn = resolve;
  });

  const host = getActivePreviewHost();
  if (!host) {
    resolveFn({ status: 'unavailable', reason: NO_PREVIEW });
    return { promise, cancel: () => undefined };
  }

  let settled = false;
  // Whether WE switched the inspector on. Unknown until the enable call answers.
  let turnedOn = false;
  const group = {};

  const finish = (result: UiPickResult) => {
    if (settled) return;
    settled = true;
    EventDispatcher.instance.off(group);
    if (turnedOn) {
      host.executeJavaScript(DISABLE_INSPECTOR).catch(() => {
        /* frame reloaded or closed meanwhile — nothing left to restore */
      });
    }
    resolveFn(result);
  };

  // Subscribe BEFORE enabling, so a click that lands between the two cannot be lost.
  EventDispatcher.instance.on(
    'inspectNodes',
    (args: any) => {
      const nodeId = args && Array.isArray(args.nodeIds) ? args.nodeIds[0] : undefined;
      if (nodeId) finish({ status: 'picked', nodeId: String(nodeId) });
    },
    group
  );

  host
    .executeJavaScript(ENABLE_INSPECTOR)
    .then((was: unknown) => {
      if (settled) return;
      if (was === 'missing') {
        finish({ status: 'unavailable', reason: NO_INSPECTOR });
        return;
      }
      turnedOn = was === false;
    })
    .catch(() => {
      if (!settled) finish({ status: 'unavailable', reason: NO_INSPECTOR });
    });

  return { promise, cancel: () => finish({ status: 'cancelled' }) };
}
