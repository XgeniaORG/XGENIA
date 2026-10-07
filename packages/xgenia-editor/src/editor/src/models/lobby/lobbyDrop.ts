/**
 * lobbyDrop.ts — what dropping something on the lobby adds.
 *
 * A game is a folder with a project.json in it, and nothing else is. The rule is applied before
 * anything starts loading: a dropped file used to be handed straight to the project loader, which
 * put "Opening project" up for something that could never open — and, because the loader threw on
 * a file, never took it down again.
 *
 * Pure, so the rule is testable without a disk: the caller says what each path is.
 */

/** What a dropped path is on disk. `other` covers files, and anything that is not there. */
export type DroppedKind = 'game' | 'folder' | 'other';

export interface DropVerdict {
  /** The dropped folders that are games, in the order they were dropped. */
  games: string[];
  /** Why there is nothing to open. Present exactly when `games` is empty. */
  reason?: 'not-a-folder' | 'no-project';
}

/**
 * Sort a drop into the games it holds, or the reason it holds none.
 *
 * A folder among the rejects decides the reason: someone who dropped a folder meant a folder, and
 * "that's not a folder" would be wrong about it. A drop that brought no paths at all — a picture
 * dragged out of a browser — is a not-a-folder rather than a silent no-op.
 */
export function judgeDrop(paths: string[], kindOf: (path: string) => DroppedKind): DropVerdict {
  const kinds = paths.map((p) => kindOf(p));
  const games = paths.filter((_, i) => kinds[i] === 'game');

  if (games.length) return { games };
  return { games, reason: kinds.includes('folder') ? 'no-project' : 'not-a-folder' };
}
