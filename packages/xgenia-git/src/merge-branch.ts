import { currentBranchName } from './core/branch';
import { git } from './core/client';
import { createCommit } from './core/commit';
import { merge, mergeTreeCommit } from './core/merge';
import { ComputedAction } from './core/models/computed-action';
import { MergeStrategy, MergeStrategyFunc } from './merge-strategy';

async function commitOf(repoDir: string, ref: string): Promise<string | null> {
  const r = await git(['rev-parse', '--verify', '-q', `${ref}^{commit}`], repoDir, 'mergeBranchIntoCurrent', {
    successExitCodes: new Set([0, 1, 128])
  });
  return r.exitCode === 0 ? r.output.toString().trim() : null;
}

/**
 * Merge another branch into the current one with a merge commit. Conflicts go
 * through the merge strategy (handlers, project.json) and are listed, never
 * settled for one side behind the user's back.
 */
export async function mergeBranchIntoCurrent(
  repoDir: string,
  theirsBranchName: string,
  mergeProject: MergeStrategyFunc,
  message?: string
): Promise<void> {
  const oursBranchName = await currentBranchName(repoDir);
  const oursSha = await commitOf(repoDir, 'HEAD');
  const theirsSha = await commitOf(repoDir, theirsBranchName);
  if (!oursSha || !theirsSha) throw new Error(`Branch '${theirsBranchName}' not found.`);
  // the same text as Git's createMergeMessage (git.ts cannot be imported outside the editor)
  const commitMessage = message || `Merge ${theirsBranchName} into ${oursBranchName}`;

  try {
    await merge(repoDir, theirsBranchName, { message: commitMessage, noFastForward: true });
  } catch (err: any) {
    console.info('merge conflicts, settling them with the merge strategy', err);
  }

  const tree = await mergeTreeCommit(repoDir, oursSha, theirsSha);
  if (tree.kind === ComputedAction.Conflicts) {
    await new MergeStrategy(repoDir, mergeProject, 'our', theirsSha).solveConflicts(tree);
    await createCommit(repoDir, commitMessage);
  } else if (tree.kind !== ComputedAction.Clean) {
    throw new Error('Failed to merge, ' + tree.kind);
  }
}
