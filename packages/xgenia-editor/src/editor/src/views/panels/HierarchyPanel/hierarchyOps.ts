// The Hierarchy panel's link to the editor models: snapshotting the active component's graph
// into plain HierarchyItems, and applying an accepted drop with the same model calls the node
// graph's own drag-to-reparent makes (nodegrapheditor.ts doDragNodesAndComments: detachNode +
// attachNode into one UndoActionGroup).

import type { NodeGraphModel, NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { UndoActionGroup, UndoQueue } from '@xgenia-models/undo-queue-model';

import type { NodeGraphEditor } from '../../nodegrapheditor';
import type { DropResult } from './hierarchyDrop';
import type { HierarchyItem } from './hierarchyTree';

function safe<T>(read: () => T, fallback: T): T {
  try {
    const value = read();
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function shortTypeName(node: NodeGraphNode): string {
  const display = String(safe(() => node.type?.displayName || node.type?.localName || node.type?.name, '') || '');
  // A component path ("/Slot/Reels") keeps its last segment; a bare dotted type id
  // ("net.noodl.visual.group") its last part.
  if (display) return display.split('/').pop() || display;
  const typename = String(node.typename || '');
  return typename.split('/').pop().split('.').pop() || typename;
}

function toItem(node: NodeGraphNode): HierarchyItem {
  const typeName = shortTypeName(node);
  return {
    id: node.id,
    label: String(safe(() => node.label, '') || typeName),
    typeName,
    isVisual: safe(() => !!node.type?.allowAsChild, false),
    children: (node.children || []).map(toItem)
  };
}

/** The whole graph, every child in model order. O(nodes); filters apply later. */
export function snapshotGraph(graph: NodeGraphModel | undefined | null): HierarchyItem[] {
  if (!graph || !Array.isArray(graph.roots)) return [];
  return graph.roots.map(toItem);
}

export function canAcceptChild(graph: NodeGraphModel | undefined | null, parentId: string, childId: string): boolean {
  if (!graph) return false;
  const parent = graph.findNodeWithId(parentId);
  const child = graph.findNodeWithId(childId);
  if (!parent || !child) return false;
  return safe(() => parent.canAcceptChildren([child]), false);
}

/**
 * Apply a drop `resolveDrop` accepted. One undo entry, labelled "Reorder" or "Reparent".
 * Returns false when the model no longer matches the snapshot the drop was resolved against.
 */
export function applyHierarchyDrop(
  graph: NodeGraphModel,
  nodeGraph: NodeGraphEditor | null | undefined,
  draggedId: string,
  drop: Extract<DropResult, { ok: true }>
): boolean {
  const node = graph.findNodeWithId(draggedId);
  if (!node) return false;
  const parent = drop.parentId === null ? null : graph.findNodeWithId(drop.parentId);
  if (drop.parentId !== null && (!parent || !parent.canAcceptChildren([node]))) return false;
  // The drop was resolved against a snapshot up to one debounce old: re-check the cycle on the model.
  for (let p = parent; p; p = p.parent) if (p === node) return false;

  const undo = new UndoActionGroup({ label: drop.kind === 'reorder' ? 'Reorder' : 'Reparent' });

  if (node.parent) {
    // To the end of the roots — the model's canonical detached state, and attachNode's
    // precondition. The graph view moves the existing box (its 'nodeDetached' handler).
    graph.detachNode(node, { undo });
  }

  if (parent) {
    const index = Math.max(0, Math.min(drop.index, parent.children.length));
    graph.attachNode(parent, node, index, { undo });
  } else {
    // Left as a root: keep the model position where the graph view put the box (its global
    // position at detach), as the graph's own drag does with commitMoveNode, so a reload
    // does not move it.
    const view = nodeGraph?.findNodeWithId?.(node.id);
    if (view && !view.parent && (view.x !== node.x || view.y !== node.y)) {
      const from = { x: node.x, y: node.y };
      const to = { x: view.x, y: view.y };
      undo.pushAndDo({ do: () => node.set(to), undo: () => node.set(from) });
    }
  }

  if (undo.isEmpty()) return false;
  UndoQueue.instance.push(undo);
  return true;
}
