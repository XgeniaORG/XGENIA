/**
 * A game just made in the New game sheet opens on the AI, whatever panel was open last.
 *
 * The open panel is remembered per machine (SidebarModel), so an empty game or a template game
 * opened on Assets or Settings from the previous session: a first-time user met a blank canvas and
 * an empty file list instead of the AI (2026-11-04). A game made from a description already opened
 * the chat (its seed is pending); this covers the other two lanes. In memory only: the lobby routes
 * to the editor in the same window, and a game reopened later should open where the user left it.
 */
const arriving = new Set<string>();

export function markNewGame(projectId: string): void {
  if (projectId) arriving.add(projectId);
}

/** True once for a game just created; later opens of it return false. */
export function takeNewGame(projectId: string): boolean {
  return arriving.delete(projectId);
}
