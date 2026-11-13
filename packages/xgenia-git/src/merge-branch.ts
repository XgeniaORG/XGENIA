import { git } from './core/client';
import { createCommit } from './core/commit';
import { merge, MergeResult, mergeTreeCommit } from './core/merge';
import { ComputedAction } from './core/models/computed-action';
import { MergeTreeResult } from './core/models/merge';
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

/** The paths git left unmerged in the index (`git ls-files -u`). */
async function unmergedPaths(repoDir: string): Promise<Set<string>> {
  const r = await git(['ls-files', '-u', '-z'], repoDir, 'unmergedPaths');
  const paths = new Set<string>();
  for (const line of r.output.toString().split('\0')) {
    const tab = line.indexOf('\t');
    if (tab >= 0) paths.add(line.slice(tab + 1));
  }
  return paths;
}

/**
 * The conflicts of a merge (or stash pop) git just ran, as merge-tree entries.
 * The legacy merge-tree has no rename detection, so a rename on one side and an
 * edit on the other reads there as modify/delete although git merged it cleanly.
 * Only entries for paths git actually left unmerged count; when there are none
 * the result is clean.
 */
async function conflictsLeftByGit(repoDir: string, oursRev: string, theirsRev: string): Promise<MergeTreeResult | null> {
  const tree = await mergeTreeCommit(repoDir, oursRev, theirsRev);
  if (tree?.kind !== ComputedAction.Conflicts) return tree;
  const unmerged = await unmergedPaths(repoDir);
  const entries = tree.conflictedEntries.filter((e) =>
    [e.base, e.our, e.their, e.result].some((b) => b && unmerged.has(b.path))
  );
  return entries.length > 0
    ? { kind: ComputedAction.Conflicts, conflictedFiles: entries.length, conflictedEntries: entries }
    : { kind: ComputedAction.Clean, entries: [] };
}

/**
 * After `git merge` ran (it may have stopped on conflicts): settle what git left
 * unmerged through the merge strategy. Returns true when something was settled
 * and still has to be committed; false when git's own merge needs nothing more.
 */
export async function solveMergeConflicts(
  repoDir: string,
  mergeProject: MergeStrategyFunc,
  oursSha: string,
  theirsSha: string
): Promise<boolean> {
  const tree = await conflictsLeftByGit(repoDir, oursSha, theirsSha);
  if (tree?.kind === ComputedAction.Conflicts) {
    await new MergeStrategy(repoDir, mergeProject, 'our', { oursRev: oursSha, theirsRev: theirsSha }).solveConflicts(tree);
    return true;
  }
  if (tree?.kind !== ComputedAction.Clean) throw new Error('Failed to merge, ' + tree?.kind);
  return false;
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

  const tree = await conflictsLeftByGit(repoDir, oursSha, theirsSha);
  if (tree?.kind !== ComputedAction.Conflicts) {
    throw failure instanceof Error ? failure : new Error('Failed to merge, ' + tree?.kind);
  }
  await new MergeStrategy(repoDir, mergeProject, 'our', { oursRev: oursSha, theirsRev: theirsSha }).solveConflicts(tree);
  if (message) await createCommit(repoDir, message);
  // strip: git's default message lists the conflicted files as '#' comment lines
  else await git(['commit', '--no-edit', '--cleanup=strip'], repoDir, 'mergeBranchIntoCurrent');
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
  const tree = await conflictsLeftByGit(repoDir, stashSha, headSha);
  if (tree?.kind === ComputedAction.Conflicts) {
    await new MergeStrategy(repoDir, mergeProject, 'our', { oursRev: stashSha, theirsRev: headSha }).solveConflicts(tree);
  } else if (tree?.kind !== ComputedAction.Clean) {
    throw new Error('Failed to merge stash, ' + tree?.kind);
  }
}
