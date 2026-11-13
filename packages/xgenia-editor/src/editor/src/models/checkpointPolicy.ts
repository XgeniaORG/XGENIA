// Pure rules for ProjectCheckpoints, kept apart so they test without the editor models.

export interface Checkpoint {
  id: string;
  label: string;
  createdAt: number;
  auto: boolean;
}

/** Auto checkpoints: after this many recorded changes, or this long after the first unsaved one. */
export const AUTO_EVERY_CHANGES = 15;
export const AUTO_EVERY_MS = 5 * 60 * 1000;
const KEEP_MANUAL = 30;
const KEEP_AUTO = 20;

/** Should the changes since the last checkpoint become an automatic one? */
export function shouldAutoCheckpoint(changesSince: number, msSinceFirstChange: number): boolean {
  if (changesSince <= 0) return false;
  return changesSince >= AUTO_EVERY_CHANGES || msSinceFirstChange >= AUTO_EVERY_MS;
}

/** Newest first; keeps the newest KEEP_MANUAL manual and KEEP_AUTO automatic. Returns [kept, dropped]. */
export function pruneCheckpoints(index: Checkpoint[]): [Checkpoint[], Checkpoint[]] {
  const sorted = [...index].sort((a, b) => b.createdAt - a.createdAt);
  let manual = 0;
  let auto = 0;
  const kept: Checkpoint[] = [];
  const dropped: Checkpoint[] = [];
  for (const c of sorted) {
    const keep = c.auto ? ++auto <= KEEP_AUTO : ++manual <= KEEP_MANUAL;
    (keep ? kept : dropped).push(c);
  }
  return [kept, dropped];
}
