export interface GitHubRemote {
  owner: string;
  repo: string;
}

/**
 * Read the owner and repository out of a GitHub remote URL. Handles the forms
 * git hands us: https://github.com/owner/repo(.git), with or without credentials
 * in the URL, and the SSH forms git@github.com:owner/repo(.git) and
 * ssh://git@github.com/owner/repo(.git).
 *
 * Returns null for anything that isn't a GitHub remote instead of throwing —
 * callers use this to decide whether to offer GitHub specific actions at all.
 */
export function parseGitHubRemote(gitRemoteUrl: string): GitHubRemote | null {
  if (!gitRemoteUrl) return null;

  const url = gitRemoteUrl.trim().replace(/\.git$/, '');

  const patterns = [
    // https://github.com/owner/repo and https://user:token@github.com/owner/repo
    /^(?:https?:\/\/)(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+)$/,
    // ssh://git@github.com/owner/repo
    /^ssh:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+)$/,
    // git@github.com:owner/repo
    /^(?:[^@/]+@)?github\.com:([^/]+)\/([^/]+)$/,
    // github.com/owner/repo
    /^github\.com\/([^/]+)\/([^/]+)$/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  return null;
}

/** The browsable https URL for a GitHub remote, or null if it isn't one. */
export function getGitHubRepoUrl(gitRemoteUrl: string): string | null {
  const remote = parseGitHubRemote(gitRemoteUrl);
  return remote ? `https://github.com/${remote.owner}/${remote.repo}` : null;
}

/** The browsable https URL for a commit, or null if the remote isn't GitHub. */
export function getGitHubCommitUrl(gitRemoteUrl: string, commitSha: string): string | null {
  const repoUrl = getGitHubRepoUrl(gitRemoteUrl);
  return repoUrl ? `${repoUrl}/commit/${commitSha}` : null;
}

/**
 * Turn a project name into a name GitHub accepts: it only keeps letters,
 * digits, `.`, `-` and `_`, and replaces every other character with `-`.
 */
export function suggestRepositoryName(projectName: string): string {
  const name = (projectName || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/-+$/, '');

  return name || 'xgenia-project';
}
