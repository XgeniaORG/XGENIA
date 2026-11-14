// Every asset edit, undoable from ⌘Z — in the panel and on the canvas alike, because it goes on the
// editor's single UndoQueue next to node edits. See assetUndo.ts for the serial async runner.

import { UndoActionGroup, UndoQueue } from '../../../models/undo-queue-model';

export { UndoActionGroup, UndoQueue };
import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';
import { ToastLayer } from '../../ToastLayer';

import { applyRowPaths, createAsyncUndo, diffRowPaths, makeUndoGroup } from './assetUndo';
import { flushAssetMeta, replaceAssetMeta, snapshotAssetMeta, type AssetMetaEntry } from './assetMeta';

const history = createAsyncUndo(
  UndoQueue.instance,
  () => EventDispatcher.instance.emit('project-assets-changed', { reason: 'undo' }),
  (message) => ToastLayer.showError(`Could not undo/redo that asset change: ${message}`),
  (g) => makeUndoGroup(UndoActionGroup, g)
);

/** Record a file operation that has already happened. */
export function recordAssetChange(label: string, redo: () => Promise<void>, undo: () => Promise<void>): void {
  history.record(label, redo, undo);
}

/**
 * Change metadata rows and make the change undoable. Undo and redo write back ONLY the key paths
 * this edit changed, onto the row as it is at that moment — so a later AI re-split or scanner write
 * to the same asset survives an undo of an unrelated tag.
 *
 * Pass `group` to put the step into an undo group the caller pushes itself (one ⌘Z for a board save
 * that also moves nodes); otherwise it is pushed on its own.
 */
export async function editAssetMeta(
  label: string,
  paths: string[],
  apply: () => Promise<void> | void,
  group?: { push: (a: { do?: () => void; undo?: () => void }) => void }
): Promise<void> {
  const before = new Map<string, AssetMetaEntry | null>(paths.map((p) => [p, snapshotAssetMeta(p)]));
  await apply();
  await flushAssetMeta();
  const changes = paths
    .map((p) => ({ path: p, before: before.get(p) ?? null, after: snapshotAssetMeta(p), keys: diffRowPaths(before.get(p) as any, snapshotAssetMeta(p) as any) }))
    .filter((c) => c.keys.length > 0);
  if (changes.length === 0) return;
  const write = (side: 'before' | 'after') => async () => {
    for (const c of changes) {
      const next = applyRowPaths(snapshotAssetMeta(c.path) as any, c[side] as any, c.keys);
      await replaceAssetMeta(c.path, Object.keys(next).length ? (next as AssetMetaEntry) : null);
    }
  };
  if (group) group.push(history.actions(write('after'), write('before')));
  else history.record(label, write('after'), write('before'));
}

export function undoAssetChange(): string | null {
  return UndoQueue.instance.undo()?.label ?? null;
}

export function redoAssetChange(): string | null {
  return UndoQueue.instance.redo()?.label ?? null;
}
