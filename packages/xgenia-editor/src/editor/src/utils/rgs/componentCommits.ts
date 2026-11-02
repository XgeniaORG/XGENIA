// Deploy history for a game's Math Components.
//
// A deploy upserts the component's `game_edge_functions` row, so the previous
// script and authored graph are gone the moment it is re-deployed. The platform
// therefore keeps a separate, append-only record of each Deploy press
// (`game_component_commits` + `game_component_commit_files`, migration
// 20260806120000), with a frozen snapshot of every component that press pushed.
// That snapshot is why a superseded version can still be recovered.
//
// The editor only writes it (`create-component-commit`, scoped by the same
// ownership check as every other game action): Publish records one commit per
// maths deploy. `maths-deployer` also serves `list-component-commits` and
// `download-component-commit` for reading the history back.

import type { MathsDeployResult } from './deployMathsComponents';
import type { MathsStatus } from './mathsComponentStatus';
import { XRGS_URL, rgsHeaders } from './rgsClient';

/** How a component changed in a commit — the same three words git uses. */
export type CommitChangeKind = 'added' | 'modified' | 'deleted';

/** What a deploy asks to have recorded, per component. */
export interface CommitFileInput {
  function_slug: string;
  function_name?: string;
  change_kind: CommitChangeKind;
  script?: string;
  project_json?: Record<string, any>;
}

/**
 * The files one maths deploy records: one per component it deployed, carrying
 * exactly what was sent (the result's script and authored graph) and marked
 * added or modified as the comparison the deploy ran from said. A deploy from
 * the editor (deployChangedMathsComponents) never deletes, so it records no
 * deletions.
 */
export function commitFilesForDeploy(results: MathsDeployResult[], status: MathsStatus): CommitFileInput[] {
  const kindBySlug = new Map(status.changed.map((c) => [c.slug, c.kind]));
  return results.map((r) => ({
    function_slug: r.slug,
    function_name: r.functionName,
    change_kind: kindBySlug.get(r.slug) === 'added' ? 'added' : 'modified',
    script: r.script,
    project_json: r.projectJson
  }));
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
 * Records one maths deploy.
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
