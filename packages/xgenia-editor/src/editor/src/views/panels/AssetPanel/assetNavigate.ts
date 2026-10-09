import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';

/** Open the component that holds `node` and select it — the same jump the References panel makes. */
export function goToNode(component: any, node: any): void {
  if (!component || !node) return;
  try {
    NodeGraphContextTmp.nodeGraph.switchToComponent(component, { node, pushHistory: true });
  } catch (e) {
    console.warn('[assets] could not navigate to node', e);
  }
}
