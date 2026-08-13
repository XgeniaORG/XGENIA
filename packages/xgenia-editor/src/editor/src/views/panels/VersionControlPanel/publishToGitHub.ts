import { createErrorFromMessage, Git } from '@xgenia/git';
import { push as gitPush } from '@xgenia/git/src/core/push';
import { clearCredentialsCache } from '@xgenia/git/src/core/trampoline/trampoline-askpass-handler';

import { LocalProjectsModel } from '@xgenia-utils/LocalProjectsModel';

import { createRepository, GitHubRepository, GitHubUser } from '@xgenia-services/GitHubApi';
import { GitStore } from '@xgenia-store/GitStore';

export interface PublishToGitHubOptions {
  git: Git;
  /** ProjectModel id, the key credentials are stored under. */
  projectId: string;
  token: string;
  user: GitHubUser;
  /** Login of the organization to publish to, omit to publish to the user account. */
  organization?: string;
  repositoryName: string;
  description?: string;
  isPrivate: boolean;
  /** Progress for the UI. `percent` is only set while pushing. */
  onProgress?: (label: string, percent?: number) => void;
}

/**
 * Create a GitHub repository for this project and push to it — the editor's
 * equivalent of VS Code's "Publish to GitHub".
 *
 * The local work (credentials, identity, first commit) happens before the
 * repository is created on GitHub, so a local failure can't leave an orphaned
 * empty repository behind on the account.
 */
export async function publishToGitHub({
  git,
  projectId,
  token,
  user,
  organization,
  repositoryName,
  description,
  isPrivate,
  onProgress
}: PublishToGitHubOptions): Promise<GitHubRepository> {
  const report = (label: string, percent?: number) => onProgress && onProgress(label, percent);

  report('Preparing repository');

  await storeCredentials(projectId, token);
  await ensureGitIdentity(git, user);
  await ensureInitialCommit(git, report);

  report('Creating repository on GitHub');
  const repository = await createRepository(token, {
    name: repositoryName,
    description,
    isPrivate,
    organization
  });

  // Everything below can fail with the repository already created on GitHub. The
  // panel recovers on its own: the remote is set, so the status button turns into
  // "Publish Branch" and pushing again is one click.
  await git.setRemoteURL(repository.cloneUrl);

  report('Pushing to GitHub', 0);
  await pushBranchWithUpstream(git, (percent) => report('Pushing to GitHub', percent));

  report('Published');
  return repository;
}

/**
 * Save the token where the git credential handler reads from, so the push below
 * — and every later push/pull from the panel — can authenticate. See
 * LocalProjectsModel.setCurrentGlobalGitAuth: for github.com endpoints it reads
 * GitStore('github', projectId).password and pairs it with a dummy username.
 */
async function storeCredentials(projectId: string, token: string) {
  try {
    await GitStore.set('github', projectId, { password: token });
  } catch (error: any) {
    console.error('[publishToGitHub] Could not store the GitHub token:', error);
    throw new Error('Could not save the GitHub token for this project, so the push would fail. ' + error);
  }

  // Reinstall the credential callback for this project (it is normally installed
  // when the project is opened) and drop the cached account, which may hold a
  // token that has just been replaced.
  LocalProjectsModel.instance.setCurrentGlobalGitAuth(projectId);
  clearCredentialsCache();
}

/**
 * git refuses to commit without user.name and user.email. A machine that has
 * never used git has neither, which would otherwise fail at the first commit,
 * so fall back to the GitHub account we just authenticated as.
 */
async function ensureGitIdentity(git: Git, user: GitHubUser) {
  const [name, email] = await Promise.all([git.getConfigValue('user.name'), git.getConfigValue('user.email')]);

  if (!name?.trim() && user.login) {
    await git.setConfigValue('user.name', user.name || user.login);
  }

  if (!email?.trim() && user.login) {
    // GitHub hides the email of accounts that keep it private; the noreply
    // address is the documented stand-in and is accepted by GitHub as the author.
    await git.setConfigValue('user.email', user.email || `${user.login}@users.noreply.github.com`);
  }
}

/** A repository with no commits has nothing to push, so make the first one. */
async function ensureInitialCommit(git: Git, report: (label: string, percent?: number) => void) {
  const headCommit = await git.getHeadCommitId();
  if (headCommit) return;

  const status = await git.status();
  if (status.length === 0) {
    throw new Error('There is nothing to publish yet. Save the project and try again.');
  }

  report('Creating the initial commit');
  await git.commit('Initial commit');
}

/** Push the current branch and set it to track the new remote branch. */
async function pushBranchWithUpstream(git: Git, onProgress: (percent: number) => void) {
  const branchName = await git.getCurrentBranchName();

  // 'null' is what the git layer reports for a detached HEAD.
  if (!branchName || branchName === 'null') {
    throw new Error('HEAD is not on a branch, so there is nothing to publish. Check out a branch and try again.');
  }

  const remoteName = await git.getRemoteName();
  const remote = { name: remoteName || 'origin', url: git.OriginUrl };

  try {
    // A null remote branch makes the push set the upstream (git push -u).
    await gitPush(git.repositoryPath, remote, branchName, null, [], undefined, (progress) =>
      onProgress(progress.value)
    );
  } catch (error: any) {
    const message = error.toString();

    if (message.includes('Authentication failed') || message.includes('could not read Username')) {
      throw new Error(
        'GitHub rejected the push. The token needs the "repo" scope (and SSO authorization for organization repositories).'
      );
    }

    throw createErrorFromMessage(message);
  }
}
