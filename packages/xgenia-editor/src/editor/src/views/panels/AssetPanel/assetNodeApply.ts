import { UndoActionGroup, UndoQueue } from '../../../models/undo-queue-model';

import type { IndexedAsset } from './assetIndex';
import { getAssetReferences } from './assetGraphRefs';
import { ancestorsOf, placementParamsForNode, resolveNodeSpace } from './assetNodeSpace';
import type { ProjectScreen } from './projectScreen';

export interface ApplyReport {
  applied: string[];
  refused: Array<{ node: string; reason: string }>;
}

/**
 * Put every node that shows this asset where the asset's placement says, as ONE undo step.
 * Each node's own coordinate space is resolved (Stage design box, Container offsets); a node whose
 * space is not computable is left alone and reported with the reason.
 */
export function applyPlacementToNodes(
  asset: IndexedAsset,
  screen: ProjectScreen | null,
  dryRun = false,
  /** An undo group the caller owns and pushes; when given, nothing is pushed here. */
  outer?: UndoActionGroup
): ApplyReport {
  const report: ApplyReport = { applied: [], refused: [] };
  if (!asset.placement) return report;
  const group = outer ?? new UndoActionGroup({ label: `apply placement of ${asset.name}` });
  const seen = new Set<any>();
  for (const ref of getAssetReferences(asset.path)) {
    const node = ref.nodeModel;
    if (!node || seen.has(node)) continue;
    seen.add(node);
    const type = node.type?.name || node.typename || '';
    const space = resolveNodeSpace(ancestorsOf(node), screen);
    if ('refused' in space) {
      report.refused.push({ node: ref.node, reason: space.refused });
      continue;
    }
    const r = placementParamsForNode(type, asset.placement, space, asset.sprite, node.parameters);
    if ('refused' in r) {
      report.refused.push({ node: ref.node, reason: r.refused });
      continue;
    }
    if (!dryRun) for (const [k, v] of Object.entries(r.params)) node.setParameter(k, v, { undo: group, label: group.label });
    report.applied.push(ref.node);
  }
  if (!dryRun && !outer && !group.isEmpty()) UndoQueue.instance.push(group);
  return report;
}
