import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';

/**
 * Gives a node's type adapter a chance to refresh the node's dynamic ports before the
 * inspector reads them.
 *
 * This exists for RouterNavigate, whose ports depend on the route it points at: the
 * adapter builds one input port per path parameter, and without this call a node
 * opened before its route was edited shows the old parameter list. It ran inside the
 * old jQuery panel's `render()`; it moved here rather than being dropped, because
 * "the ports are stale until you reselect the node" is a bug that looks like the
 * inspector's fault.
 *
 * Everything here is best-effort. A missing adapter module, or an adapter that throws,
 * must leave the panel rendering the ports the node already has.
 */
export function ensureNodeTypeAdapter(node: NodeGraphNode): void {
  if (!node?.typename) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const registeradapters = require('../../../models/NodeTypeAdapters/registeradapters');
    const getNodeTypeAdapter = registeradapters && registeradapters.getNodeTypeAdapter;
    if (typeof getNodeTypeAdapter !== 'function') return;

    // Narrowed to RouterNavigate on purpose. Other adapters also expose
    // `updatePortsForNode`, but nothing has ever called it on panel open for them,
    // and doing so now would mutate ports on node types this change never looked at.
    if (node.typename !== 'RouterNavigate') return;

    const adapter = getNodeTypeAdapter(node.typename);
    if (adapter && typeof adapter.updatePortsForNode === 'function') {
      adapter.updatePortsForNode(node);
    }
  } catch (e) {
    console.warn('[Inspector] node type adapter unavailable for', node.typename, e);
  }
}
