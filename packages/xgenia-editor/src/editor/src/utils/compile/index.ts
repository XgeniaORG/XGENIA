// "Compile" feature orchestration.
//
// Pipeline:
//   1. Duplicate the current project on disk as "__<name>__".
//   2. For every non-logic (visual) component in the copy that has logic:
//        a. recursively flatten its logic into a new cloud component
//           "/#__cloud__/__Component_N__" (embedded logic components inlined),
//        b. insert one Aggregator Node that POSTs the aggregated UI payload to
//           that cloud component (dummy localhost URL for now),
//        c. remove the original logic nodes from the visual component.
//   3. Save the transformed copy.

import { duplicateCurrentProject, isCompiledName, saveProject } from './duplicateProject';
import { buildCloudComponent, captureBoundary } from './flattenLogic';
import { insertAggregatorNode } from './aggregatorNode';
import { CLOUD_PREFIX, collectLogicRoots, isVisualComponent } from './util';

/**
 * Where one cloud component came from.
 *
 * A cloud component is machine-generated and flattened, so it is the wrong
 * thing to show someone who is trying to work out what they are looking at.
 * Its SOURCE is the component they recognise — and it is still sitting in the
 * open project, because compile only ever mutates the copy.
 *
 * The ids travel because `duplicateCurrentProject` is a byte-for-byte folder
 * copy: a node in the copy has the same id as the same node in the original, so
 * these ids resolve against `ProjectModel.instance`. (They are captured before
 * `buildCloudComponent`, which reassigns ids — but only on its clones.)
 */
export interface CompiledComponentOrigin {
  /** "/#__cloud__/__Component_1__" */
  cloudName: string;
  /** Name of the visual component whose logic was extracted, e.g. "/Slot/GameScreen". */
  sourceComponentName: string;
  /** Ids of the extracted logic ROOTS, in extraction order. */
  logicRootIds: string[];
  /** Total nodes extracted across those roots — shown as context, not used for lookup. */
  logicNodeCount: number;
}

export interface CompileResult {
  name: string;
  dir: string;
  componentsCreated: number;
  visualComponentsVisited: number;
  /** One entry per created cloud component, in creation order. */
  origins: CompiledComponentOrigin[];
}

export async function compileProject(project: any): Promise<CompileResult> {
  if (!project) throw new Error('No project is currently open.');
  if (isCompiledName(project.name)) {
    throw new Error(`"${project.name}" is already a compiled project. Open the original and compile that instead.`);
  }

  const { copy, destDir, newName } = await duplicateCurrentProject(project);

  // Snapshot the visual components up front — we add cloud components while looping.
  const visualComponents = copy.components.filter((c: any) => isVisualComponent(c));

  let componentCounter = 0;
  let visited = 0;
  const origins: CompiledComponentOrigin[] = [];

  for (const comp of visualComponents) {
    const logicRoots = collectLogicRoots(comp);
    if (logicRoots.length === 0) continue; // pure-UI component, nothing to extract
    visited++;

    componentCounter++;
    let cloudName = `${CLOUD_PREFIX}__Component_${componentCounter}__`;
    // Defensive: skip a name that somehow already exists.
    while (copy.getComponentWithName(cloudName)) {
      componentCounter++;
      cloudName = `${CLOUD_PREFIX}__Component_${componentCounter}__`;
    }

    // Record the origin before anything is cloned or removed, so the ids are
    // the ones the ORIGINAL project still uses.
    let logicNodeCount = 0;
    logicRoots.forEach((root: any) => root.forEach(() => logicNodeCount++));
    origins.push({
      cloudName,
      sourceComponentName: comp.name,
      logicRootIds: logicRoots.map((root: any) => root.id).filter(Boolean),
      logicNodeCount
    });

    const boundary = captureBoundary(comp, logicRoots);

    // a. extract logic into the cloud component (clones the logic)
    buildCloudComponent(copy, cloudName, comp, logicRoots, boundary);

    // b. insert the aggregator + rewire UI -> aggregator
    insertAggregatorNode(comp, cloudName, boundary);

    // c. remove the original logic roots from the visual component
    logicRoots.forEach((root: any) => comp.graph.removeNode(root));
  }

  await saveProject(copy, destDir);

  return {
    name: newName,
    dir: destDir,
    componentsCreated: componentCounter,
    visualComponentsVisited: visited,
    origins
  };
}
