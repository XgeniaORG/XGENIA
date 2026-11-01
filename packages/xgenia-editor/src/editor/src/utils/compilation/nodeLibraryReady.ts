// A web build needs the browser node library: the exporter lists a component's root nodes only when
// their type says it may be a visual child (exporter/util.ts, `allowAsChild`). Those types reach the
// editor from the connected preview viewer, and they are gone while it is not connected — right after a
// project opens, while the preview reloads, or with the preview navigated away. A build made then ships
// every component with `roots: []`, and the published page is blank (2026-11-02, e2e publish of the
// Slot starter: "Made with XGENIA" on a white page). Pure; no editor imports, so it runs under Node.

export const NODE_LIBRARY_WAIT_MS = 30_000;

/** The browser runtime's types are loaded: the core visual type every page is built from is known. */
export function browserLibraryLoaded(hasType: (name: string) => boolean): boolean {
  return hasType('Group');
}

/**
 * Waits until the browser node library is loaded, polling `hasType`. Throws a plain-words error when it
 * never loads, instead of letting the build drop every visual root.
 */
export async function waitForBrowserNodeLibrary(
  hasType: (name: string) => boolean,
  { timeoutMs = NODE_LIBRARY_WAIT_MS, pollMs = 500, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!browserLibraryLoaded(hasType)) {
    if (Date.now() >= deadline) {
      throw new Error(
        'The game preview is not connected, so the editor cannot tell what your screens are made of and the build ' +
          'would be a blank page. Wait until the preview shows your game, then try again.'
      );
    }
    await sleep(pollMs);
  }
}
