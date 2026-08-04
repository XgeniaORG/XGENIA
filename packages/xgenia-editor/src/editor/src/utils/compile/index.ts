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
  /**
   * Ids of EVERY node that was extracted — each logic root plus its whole
   * subtree, the same set `flattenLogic` collects. Roots alone would be wrong
   * to highlight: a root is a tree, and a component's logic is routinely
   * several of them, so highlighting root ids would leave most of the extracted
   * graph looking untouched.
   */
  logicNodeIds: string[];
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

  // 2026-08-04: EXTRACTION IS OFF. Deployment is decided by LOCATION — a
  // `/#__maths__/` component compiles to the RGS via
  // CloudFunctionConverter.generateRgsScript(), and nothing else leaves the
  // frontend. Compile now only duplicates the project so the Vercel build has a
  // stable source tree.
  //
  // This replaced the per-node `isMath` tickbox, which asked the user to make a
  // deployment decision on every node and defaulted to "extract to the backend".
  // The two had to go together: typeIsMathDefault() returned true for any node
  // type that declared nothing, so removing the tickbox while this loop still
  // ran would have extracted PixiReelController — a WebGL renderer that is fed
  // live pixi.ReelColumn references and cannot run in an edge function. With
  // extraction off, that opt-out is unnecessary rather than load-bearing.
  //
  // Publish already tolerates this: XgeniaDeployTab skips the component setup
  // card when nothing was extracted ("a UI-only project compiles to no logic
  // components at all"), so a zero-component compile is an existing path, not a
  // new one.
  //
  // flattenLogic.ts / aggregatorNode.ts are intentionally left on disk, unused.
  // Removing them is a separate decision (see docs/RGS-RESTORATION-PLAN.md).
  const componentCounter = 0;
  const visited = 0;
  const origins: CompiledComponentOrigin[] = [];

  await saveProject(copy, destDir);

  return {
    name: newName,
    dir: destDir,
    componentsCreated: componentCounter,
    visualComponentsVisited: visited,
    origins
  };
}
