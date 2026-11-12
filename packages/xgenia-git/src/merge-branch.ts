import { git } from './core/client';
import { createCommit } from './core/commit';
import { merge, MergeResult, mergeTreeCommit } from './core/merge';
import { ComputedAction } from './core/models/computed-action';
import { MergeStrategy, MergeStrategyFunc } from './merge-strategy';

async function commitOf(repoDir: string, ref: string): Promise<string | null> {
  const r = await git(['rev-parse', '--verify', '-q', `${ref}^{commit}`], repoDir, 'mergeBranchIntoCurrent', {
    successExitCodes: new Set([0, 1, 128])
  });
  return r.exitCode === 0 ? r.output.toString().trim() : null;
}

async function mergeInProgress(repoDir: string): Promise<boolean> {
  const r = await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], repoDir, 'mergeBranchIntoCurrent', {
    successExitCodes: new Set([0, 1])
  });
  return r.exitCode === 0;
}

/**
 * Merge another branch into the current one (fast-forward when possible, like
 * `git merge`). Conflicts go through the merge strategy (handlers, project.json)
 * and are listed, never settled for one side behind the user's back. A merge git
 * refuses before it starts (local changes or untracked files in the way) throws
 * git's error and changes nothing. Without a message git's default one is used.
 */
export async function mergeBranchIntoCurrent(
  repoDir: string,
  theirsBranchName: string,
  mergeProject: MergeStrategyFunc,
  message?: string
): Promise<void> {
  const oursSha = await commitOf(repoDir, 'HEAD');
  const theirsSha = await commitOf(repoDir, theirsBranchName);
  if (!oursSha || !theirsSha) throw new Error(`Branch '${theirsBranchName}' not found.`);

  let failure: unknown = null;
  try {
    const result = await merge(repoDir, theirsBranchName, { message: message || undefined });
    if (result !== MergeResult.Failed) return;
  } catch (err) {
    failure = err;
  }

  // Only a merge that stopped on conflicts leaves MERGE_HEAD; anything else did not start.
  if (!(await mergeInProgress(repoDir))) {
    throw failure instanceof Error ? failure : new Error(`Could not merge '${theirsBranchName}'.`);
  }

  const tree = await mergeTreeCommit(repoDir, oursSha, theirsSha);
  if (tree.kind !== ComputedAction.Conflicts) {
    throw failure instanceof Error ? failure : new Error('Failed to merge, ' + tree.kind);
  }
  await new MergeStrategy(repoDir, mergeProject, 'our', { oursRev: oursSha, theirsRev: theirsSha }).solveConflicts(tree);
  if (message) await createCommit(repoDir, message);
  else await git(['commit', '--no-edit'], repoDir, 'mergeBranchIntoCurrent');
}

/**
 * After local changes (a stash) are put back over newer commits: settle what
 * conflicts. The merge tree's "our" side is the stash commit (the user's local
 * changes win) and its "their" side is HEAD, and handlers get them that way.
 */
export async function solveStashConflicts(
  repoDir: string,
  mergeProject: MergeStrategyFunc,
  stashSha: string,
  headSha: string
): Promise<void> {
  const tree = await mergeTreeCommit(repoDir, stashSha, headSha);
  if (tree.kind === ComputedAction.Conflicts) {
    await new MergeStrategy(repoDir, mergeProject, 'our', { oursRev: stashSha, theirsRev: headSha }).solveConflicts(tree);
  } else if (tree.kind !== ComputedAction.Clean) {
    throw new Error('Failed to merge stash, ' + tree.kind);
  }
}
