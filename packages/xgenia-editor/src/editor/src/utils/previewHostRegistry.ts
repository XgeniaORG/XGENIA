// Which preview frame is currently showing the project.
//
// VisualCanvas creates the frame (an IframeViewer) and keeps it in a ref of its
// own; nothing outside the canvas could reach it. The telemetry form in the
// Publish popup needs to, once: to switch the frame's inspector on so a click in
// the rendered UI reports the element's node id, and to switch it back
// afterwards. Registering the live host here is the smallest door for that —
// one setter the canvas calls, one getter for everyone else — rather than
// threading a ref through the topbar.
//
// Type-only import: nothing here runs canvas code, it only holds a pointer.

import type { PreviewHost } from '../views/VisualCanvas/IframeViewer';

let activeHost: PreviewHost | null = null;

/** Called by VisualCanvas when it creates or disposes its frame. */
export function setActivePreviewHost(host: PreviewHost | null): void {
  activeHost = host;
}

/** Called by VisualCanvas on dispose, so a stale frame is never handed out. */
export function clearActivePreviewHost(host: PreviewHost): void {
  if (activeHost === host) activeHost = null;
}

export function getActivePreviewHost(): PreviewHost | null {
  return activeHost;
}
