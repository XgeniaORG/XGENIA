// Drag-and-drop rules for the Hierarchy panel. Pure; unit-tested.
//
// The model operation the panel runs for an accepted drop is the graph's own drag-to-reparent:
// NodeGraphModel.detachNode (child -> end of roots) then attachNode(parent, child, index). So
// `index` here is the position in the new parent's children AFTER the dragged node has left
// its current parent.

import { type HierarchyItem, indexTree, isInSubtree } from './hierarchyTree';

export type DropPosition = 'before' | 'inside' | 'after';

export type DropRefusal =
  | 'unknown' // dragged or target id is not in the tree
  | 'self' // dropped on itself
  | 'descendant' // would go inside its own subtree
  | 'not-accepted' // the new parent cannot take this child
  | 'root-order' // reordering among roots: the model has no ordered move for roots
  | 'no-op'; // it is already exactly there

export type DropResult =
  | { ok: true; kind: 'reorder' | 'reparent'; parentId: string | null; index: number }
  | { ok: false; reason: DropRefusal };

/** Where in a row the pointer is: top quarter before, bottom quarter after, middle onto. */
export function dropPositionForOffset(offsetY: number, rowHeight: number, canBeParent: boolean): DropPosition {
  const t = rowHeight > 0 ? offsetY / rowHeight : 0.5;
  if (!canBeParent) return t < 0.5 ? 'before' : 'after';
  if (t < 0.25) return 'before';
  if (t > 0.75) return 'after';
  return 'inside';
}

/**
 * @param canAccept whether `parentId` can take `childId` as a child (the panel answers with
 *   NodeGraphNode.canAcceptChildren). Not asked for a move to the root level.
 */
export function resolveDrop(
  roots: readonly HierarchyItem[],
  draggedId: string,
  targetId: string,
  position: DropPosition,
  canAccept: (parentId: string, childId: string) => boolean
): DropResult {
  const index = indexTree(roots);
  const dragged = index.get(draggedId);
  const target = index.get(targetId);
  if (!dragged || !target) return { ok: false, reason: 'unknown' };
  if (draggedId === targetId) return { ok: false, reason: 'self' };
  if (isInSubtree(index, targetId, draggedId)) return { ok: false, reason: 'descendant' };

  const parentId = position === 'inside' ? targetId : target.parentId;
  let insertAt =
    position === 'inside' ? target.item.children.length : position === 'before' ? target.index : target.index + 1;

  if (parentId === null) {
    // Root level. detachNode only appends to the roots, so a root cannot be moved among
    // roots; a child dropped there is detached (the same as dragging it off in the graph).
    if (dragged.parentId === null) return { ok: false, reason: 'root-order' };
    return { ok: true, kind: 'reparent', parentId: null, index: -1 };
  }

  if (!canAccept(parentId, draggedId)) return { ok: false, reason: 'not-accepted' };

  const sameParent = dragged.parentId === parentId;
  if (sameParent) {
    if (dragged.index < insertAt) insertAt -= 1;
    if (insertAt === dragged.index) return { ok: false, reason: 'no-op' };
  }
  return { ok: true, kind: sameParent ? 'reorder' : 'reparent', parentId, index: insertAt };
}
