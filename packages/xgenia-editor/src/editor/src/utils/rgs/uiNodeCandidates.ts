// The visual nodes of the open project, as things the telemetry form can offer.
//
// Two entry points, one shape:
//   * collectUiNodeCandidates — every visual node in every UI component, for the
//     "pick from the node graph" list;
//   * refForNodeId — one node by id, for an element clicked in the rendered
//     preview (the preload reports the `data-xgenia-node-id` it found).
//
// Both resolve against ProjectModel.instance, i.e. the project the user has
// open. That is also the project Publish copies byte-for-byte, so an id chosen
// here names the same node in the deployed build.

import { ProjectModel } from '@xgenia-models/projectmodel';
import { isVisualType } from '@xgenia-utils/compile/util';

import { classifyUiNode, UiNodeCandidate } from './telemetryMapping';

// Machine-made components: the old compile output and the Math Components the
// Maths RGS panel deploys. Neither renders anything a player could click.
const NON_UI_COMPONENT_PREFIXES = ['/#__cloud__/', '/#__maths__/'];

function isUiComponent(comp: any): boolean {
  const name = String(comp?.name || '');
  return !!comp?.graph && !NON_UI_COMPONENT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function candidateFor(node: any, componentName: string, pickedFrom: 'ui' | 'graph'): UiNodeCandidate {
  const type = node.type;
  const typename = String(node.typename || type?.name || '');
  const typeLabel = String(type?.displayName || type?.localName || typename);
  // `label` falls back to the type's own labelForNode when the user never named
  // the node, which is what the node graph shows too.
  let label = '';
  try {
    label = String(node.label || '');
  } catch (e) {
    /* an unknown node type can throw from labelForNode; the type name will do */
  }
  return {
    nodeId: node.id,
    label: label || typeLabel,
    typename,
    typeLabel,
    componentName,
    pickedFrom,
    kind: classifyUiNode(typename)
  };
}

/** Every visual node of every UI component, in component-tree order. */
export function collectUiNodeCandidates(project: any = ProjectModel.instance): UiNodeCandidate[] {
  const out: UiNodeCandidate[] = [];
  const components: any[] = project?.components || [];
  for (const comp of components) {
    if (!isUiComponent(comp)) continue;
    comp.graph.forEachNode((node: any) => {
      if (!isVisualType(node.type)) return;
      out.push(candidateFor(node, comp.name, 'graph'));
    });
  }
  return out;
}

/**
 * The node behind an id, or null when the open project has no such node — the
 * preview can report ids the editor cannot place (a stale frame, an element the
 * runtime created itself).
 */
export function refForNodeId(
  nodeId: string,
  pickedFrom: 'ui' | 'graph',
  project: any = ProjectModel.instance
): UiNodeCandidate | null {
  if (!nodeId || !project?.findNodeWithId) return null;
  let node: any = null;
  try {
    node = project.findNodeWithId(nodeId);
  } catch (e) {
    return null;
  }
  if (!node) return null;
  // graph -> component. A node with no owner is not part of any component.
  const componentName = String(node.owner?.owner?.name || '');
  return candidateFor(node, componentName, pickedFrom);
}
