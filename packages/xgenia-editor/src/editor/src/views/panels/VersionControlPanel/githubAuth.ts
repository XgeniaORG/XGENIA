import { ConnectionStore } from '@xgenia-services/ConnectionStore';
import { OAuthFlowManager } from '@xgenia-services/OAuthFlowManager';
import { GitStore } from '@xgenia-store/GitStore';

export const GITHUB_PAT_DOCS_URL =
  'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens';

/**
 * A GitHub token this project can publish with, or null when the user has to
 * sign in first.
 *
 * Two sources, in order:
 *   1. The project's git credentials (GitStore) — the same token the panel
 *      already pushes with, so publishing reuses whatever the user set up.
 *   2. An explicit GitHub connection from ConnectionStore, i.e. one the user
 *      created through the OAuth flow.
 *
 * Deliberately NOT used: the shared deploy token that ConnectionStore hands out
 * for GitHub by default (`connectedAt === 0`, see buildDefaultConnection). It
 * belongs to the team account, so publishing with it would create the
 * repository on that account rather than the user's.
 */
export async function loadStoredGitHubToken(projectId: string): Promise<string | null> {
  try {
    const config = await GitStore.get('github', projectId);
    if (config?.password) {
      return config.password;
    }
  } catch (error: any) {
    console.warn('[githubAuth] Could not read the stored git credentials:', error);
  }

  try {
    const connection = await ConnectionStore.getInstance().getConnection('github');
    if (connection?.accessToken && connection.connectedAt > 0) {
      return connection.accessToken;
    }
  } catch (error: any) {
    console.warn('[githubAuth] Could not read the GitHub connection:', error);
  }

  return null;
}

/**
 * Run the GitHub OAuth flow (opens the browser) and return the access token.
 *
 * This needs the local callback server that runs in the Electron main process.
 * When that isn't available the flow reports a failure, which the caller shows
 * next to the personal access token field — the fallback that always works.
 */
export async function signInToGitHub(): Promise<string> {
  const result = await OAuthFlowManager.getInstance().startOAuthFlow('github');

  if (!result.success || !result.connection?.accessToken) {
    throw new Error(result.message || 'Could not sign in to GitHub.');
  }

  return result.connection.accessToken;
}
