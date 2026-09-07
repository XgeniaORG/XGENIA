import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { UndoActionGroup, UndoQueue } from '@xgenia-models/undo-queue-model';

import { ToastLayer } from '../../ToastLayer/ToastLayer';

/**
 * Node-level actions the inspector offers.
 *
 * Split out of `index.tsx` so the header can call them without importing the panel
 * that renders the header — that cycle resolves at runtime only by luck of evaluation
 * order, and breaks the moment either module grows a top-level side effect.
 */

export function NodeGraphNodeRename(model: NodeGraphNode, newname: string) {
  model.setLabel(newname, { undo: true, label: 'change label' });
}

export function NodeGraphNodeDelete(model: NodeGraphNode) {
  if (!model.canBeDeleted()) {
    ToastLayer.showError('This node cannot be deleted');
    return;
  }

  const graph = model.owner;
  const undo = new UndoActionGroup({ label: 'delete node' });
  graph.removeNode(model, { undo: undo });
  UndoQueue.instance.push(undo);
}
