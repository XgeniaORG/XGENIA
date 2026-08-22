// Deploy history for a game's Math Components — the panel's "Commits" subsection.
//
// A deploy upserts the component's `game_edge_functions` row, so the previous
// script and authored graph are gone the moment it is re-deployed. The platform
// therefore keeps a separate, append-only record of each Deploy press
// (`game_component_commits` + `game_component_commit_files`, migration
// 20260806120000), with a frozen snapshot of every component that press pushed.
// That snapshot is why a superseded version can still be opened.
//
// Three actions on `maths-deployer`, all scoped by the same ownership check as
// every other game action:
//   create-component-commit    — record what a deploy just did
//   list-component-commits     — the history, without the snapshot bodies
//   download-component-commit  — one commit's snapshots, in full

import { XRGS_URL, rgsHeaders } from './rgsClient';

/** How a component changed in a commit — the same three words git uses. */
export type CommitChangeKind = 'added' | 'modified' | 'deleted';

/** One component's entry in a commit, as the history list shows it. */
export interface CommitFileSummary {
  function_slug: string;
  function_name: string | null;
  change_kind: CommitChangeKind;
}

/** The same entry with its snapshot — only ever fetched one commit at a time. */
export interface CommitFile extends CommitFileSummary {
  /** The compiled script as of this commit. Null for a deletion. */
  script: string | null;
  /** The authored graph as of this commit, project.json-shaped. Null for a deletion. */
  project_json: Record<string, any> | null;
}

export interface ComponentCommit {
  id: string;
  game_id: string;
  deployment_id: string;
  message: string;
  author: string | null;
  created_at: string;
  /** Present on list responses; the bodies are not. */
  files?: CommitFileSummary[];
}

/** What a deploy asks to have recorded, per component. */
export interface CommitFileInput {
  function_slug: string;
  function_name?: string;
  change_kind: CommitChangeKind;
  script?: string;
  project_json?: Record<string, any>;
}

/**
 * Shared error handling. A platform that predates these actions answers
 * "Invalid action. Use: …" — say what to do about it rather than showing the raw
 * list, the same way every other action in this folder does.
 */
async function postCommitAction(apiKey: string, action: string, body: Record<string, any>): Promise<any> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({ action, ...body })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    if (res.status === 400 && /invalid action/i.test(serverError) && !serverError.includes(action)) {
      throw new Error(
        'XGENIA RGS backend is out of date — it does not keep component commit history yet. ' +
          'Apply the component_commit_history migration and redeploy the `maths-deployer` function ' +
          'to the RGS project, then try again.'
      );
    }
    throw new Error(serverError || `${action} failed (HTTP ${res.status})`);
  }
  return data;
}

/**
 * Records one Deploy press.
 *
 * Called AFTER the components are deployed, never before: a commit describes
 * something that happened, and one written up front would claim a deploy that
 * might still fail. A failure here therefore leaves the components live and only
 * the history entry missing, which is the right way round — the caller should say
 * so rather than reporting the deploy as failed.
 */
export async function createComponentCommit(
  apiKey: string,
  gameId: string,
  deploymentId: string,
  message: string,
  files: CommitFileInput[],
  author?: string
): Promise<{ commitId: string; createdAt: string; componentCount: number }> {
  const data = await postCommitAction(apiKey, 'create-component-commit', {
    game_id: gameId,
    deployment_id: deploymentId,
    message,
    author,
    files
  });
  return {
    commitId: data.commit_id,
    createdAt: data.created_at,
    componentCount: data.component_count ?? files.length
  };
}

/** The history of one Server Version, newest first. */
export async function listComponentCommits(
  apiKey: string,
  gameId: string,
  deploymentId?: string,
  limit = 50
): Promise<ComponentCommit[]> {
  const data = await postCommitAction(apiKey, 'list-component-commits', {
    game_id: gameId,
    deployment_id: deploymentId,
    limit
  });
  return (data.commits ?? []) as ComponentCommit[];
}

/**
 * One commit's snapshots. Pass `functionSlug` when opening a single component —
 * a commit that pushed a dozen components carries a dozen graphs, and the caller
 * usually wants one.
 */
export async function downloadComponentCommit(
  apiKey: string,
  commitId: string,
  functionSlug?: string
): Promise<{ commit: ComponentCommit; files: CommitFile[] }> {
  const data = await postCommitAction(apiKey, 'download-component-commit', {
    commit_id: commitId,
    function_slug: functionSlug
  });
  return { commit: data.commit, files: (data.files ?? []) as CommitFile[] };
}

/** "a3f9c1" — the short hash a commit is recognised by in the list. */
export function shortCommitId(id: string): string {
  return String(id || '').replace(/-/g, '').slice(0, 6);
}
