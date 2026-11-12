import type { MergeConflictItem } from '@xgenia/git';

export type ConflictSide = 'ours' | 'theirs';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

export function isImagePath(p: string): boolean {
  return IMAGE_EXT.test(p);
}

export interface ConflictRow {
  key: string;
  item: MergeConflictItem;
  label: string;
  isImage: boolean;
  previewKind: string | undefined;
  actions: { label: string; side: ConflictSide }[];
}

export function conflictRows(items: readonly MergeConflictItem[]): ConflictRow[] {
  return items.map((item) => ({
    key: `${item.path}\u0000${item.item ?? ''}`,
    item,
    label: item.label,
    isImage: isImagePath(item.path),
    previewKind: item.preview,
    actions: canTakeTheirs(item)
      ? [
          { label: 'Keep mine', side: 'ours' },
          { label: 'Keep theirs', side: 'theirs' }
        ]
      : [{ label: 'Keep mine', side: 'ours' }]
  }));
}

/** False when the other side could not be recorded (theirsDeleted false and no blob). */
export function canTakeTheirs(item: MergeConflictItem): boolean {
  return !(item.theirsDeleted === false && !item.theirsBlob);
}

export interface ConflictDeps {
  settle: (repoDir: string, item: MergeConflictItem, side: ConflictSide) => Promise<void>;
  read: (repoDir: string) => Promise<MergeConflictItem[]>;
}

/** Settle one item, then return the list as it stands now. */
export async function settleAndReload(
  repoDir: string,
  item: MergeConflictItem,
  side: ConflictSide,
  deps: ConflictDeps
): Promise<MergeConflictItem[]> {
  await deps.settle(repoDir, item, side);
  return deps.read(repoDir);
}

export function canCommitWith(a: {
  localChangesCount: number;
  hasConflictsInProject: boolean;
  listedConflicts: number;
  isBusy: boolean;
}): boolean {
  return a.localChangesCount > 0 && !a.hasConflictsInProject && a.listedConflicts === 0 && !a.isBusy;
}

export const CONFLICTS_BLOCK_MESSAGE = 'Resolve the conflicts first.';

/** The refusal message while listed conflicts remain (read fresh, never from panel state), else null. */
export async function conflictBlock(
  repoDir: string,
  read: (repoDir: string) => Promise<MergeConflictItem[]>
): Promise<string | null> {
  return (await read(repoDir)).length > 0 ? CONFLICTS_BLOCK_MESSAGE : null;
}

/** Pull, then push only when the pull left no listed conflicts. */
export async function syncUnlessBlocked(a: {
  pull: () => Promise<boolean>;
  push: () => Promise<boolean>;
  blocked: () => Promise<string | null>;
  onBlocked: (message: string) => void;
}): Promise<void> {
  if (!(await a.pull())) return;
  const message = await a.blocked();
  if (message) {
    a.onBlocked(message);
    return;
  }
  await a.push();
}
