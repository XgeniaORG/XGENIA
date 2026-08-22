import { git } from './client';
import { Branch } from './models/branch';

/**
 * Returns the current branch name.
 *
 * For example: 'main'
 */
export async function currentBranchName(repositoryDir: string): Promise<string> {
  // Used 'rev-parse' before, but
  const args = ['rev-parse', '--abbrev-ref', 'HEAD'];

  try {
    const { output } = await git(args, repositoryDir, 'currentBranchName');
    return output.toString().trim();
  } catch {
    // Unborn HEAD (no commits yet). The old code returned the literal
    // string 'null', which callers then displayed as branch "null" and
    // passed into further git commands. symbolic-ref reads the branch
    // name HEAD points at even before the first commit (normally 'main'
    // or 'master').
    try {
      const { output } = await git(
        ['symbolic-ref', '--short', 'HEAD'],
        repositoryDir,
        'currentBranchName(unborn)'
      );
      const name = output.toString().trim();
      if (name) return name;
    } catch {
      // detached HEAD with no commits, or not a repository — fall through
    }
    return 'null';
  }
}

export async function createBranch(
  basePath: string,
  name: string,
  startPoint: string | null,
  noTrack?: boolean
): Promise<void> {
  const args = startPoint !== null ? ['branch', name, startPoint] : ['branch', name];

  // if we're branching directly from a remote branch, we don't want to track it
  // tracking it will make the rest of desktop think we want to push to that
  // remote branch's upstream (which would likely be the upstream of the fork)
  if (noTrack) {
    args.push('--no-track');
  }

  await git(args, basePath, 'createBranch');
}

/** Rename the given branch to a new name. */
export async function renameBranch(repositoryDir: string, branch: Branch, newName: string): Promise<void> {
  await git(['branch', '-m', branch.nameWithoutRemote, newName], repositoryDir, 'renameBranch');
}

/**
 * Delete the branch locally.
 */
export async function deleteLocalBranch(repositoryDir: string, branchName: string): Promise<true> {
  await git(['branch', '-D', branchName], repositoryDir, 'deleteLocalBranch');
  return true;
}
