import React, { JSX, useCallback } from 'react';
import {
  getBranches,
  getRemote,
  Git,
  GitActionError,
  GitActionErrorCode,
  pull as gitPull,
  push as gitPush
} from '@xgenia/git';
import { merge } from '@xgenia/git/src/core/merge';
import { Branch } from '@xgenia/git/src/core/models/branch';
import { Stash } from '@xgenia/git/src/core/models/snapshot';
import { GitResetMode, reset } from '@xgenia/git/src/core/reset';
import { createStashEntry, dropStashEntry, popStashEntry, popStashEntryToBranch } from '@xgenia/git/src/core/stash';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { useConfirmationDialog } from '@xgenia-core-ui/components/popups/ConfirmationDialog/ConfirmationDialog.hooks';

import { EventDispatcher } from '../../../../../../shared/utils/EventDispatcher';
import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { IVersionControlActions, IVersionControlContextFetch } from './types';

export interface UseVersionControlActionsArgs {
  git: Git;
  repositoryPath: string;
  fetch: IVersionControlContextFetch;
  localChangesCount: number;
  commitMessage: string;
  setCommitMessage: (value: string) => void;
  setActiveTabId: (value: string) => void;
  setSelectedCommit: (value: string) => void;
  setIsPerformingAction: (value: boolean) => void;
}

/**
 * The git commands the panel exposes, in one place.
 *
 * Like VS Code, the same command is reachable from several places (the status
 * button, the panel's action menu, the commit button's dropdown), so the
 * implementations live here instead of in whichever component happened to need
 * them first.
 *
 * Returns `actionDialogs`, which the provider has to render: the confirmation
 * dialogs these commands need belong to the commands, not to the component that
 * happened to trigger them.
 */
export function useVersionControlActions({
  git,
  repositoryPath,
  fetch,
  localChangesCount,
  commitMessage,
  setCommitMessage,
  setActiveTabId,
  setSelectedCommit,
  setIsPerformingAction
}: UseVersionControlActionsArgs): { actions: IVersionControlActions; actionDialogs: JSX.Element } {
  const { gitStatus, setGitStatus, currentBranch, branches, fetchLocal, fetchRemote } = fetch;

  const [StashBeforePullDialog, confirmStashBeforePull] = useConfirmationDialog({
    message: 'You have local changes. Do you want to pull and merge your local changes?',
    confirmButtonLabel: 'Yes'
  });

  const [DiscardAllDialog, confirmDiscardAll] = useConfirmationDialog({
    title: 'Confirm Reset',
    message: 'Are you sure you want to reset all your local changes? This action can not be undone.',
    confirmButtonLabel: 'Yes, reset',
    isDangerousAction: true
  });

  const [StashDialog, confirmStash] = useConfirmationDialog({
    title: 'Confirm Stash',
    message: 'Do you want to stash your local changes?',
    confirmButtonLabel: 'Yes, stash'
  });

  const [ApplyStashDialog, confirmApplyStash] = useConfirmationDialog({
    title: 'Confirm Stash',
    message: 'Do you want to apply this stash?',
    confirmButtonLabel: 'Yes, apply',
    isDangerousAction: true
  });

  const [DeleteStashDialog, confirmDeleteStash] = useConfirmationDialog({
    title: 'Confirm Stash',
    message: 'Do you want to delete this stash?',
    confirmButtonLabel: 'Yes, delete',
    isDangerousAction: true
  });

  const [CantApplyStashDialog, showCantApplyStashDialog] = useConfirmationDialog({
    isCancelButtonHidden: true,
    title: "Can't do that yet",
    message: "Can't apply stash with local changes. Commit your changes before applying.",
    confirmButtonLabel: 'OK',
    isDangerousAction: true
  });

  const [AmendPushedCommitDialog, showAmendPushedCommitDialog] = useConfirmationDialog({
    isCancelButtonHidden: true,
    title: "Can't amend that commit",
    message:
      'The last commit has already been pushed. Amending it would rewrite history on the remote, so commit your changes instead.',
    confirmButtonLabel: 'OK'
  });

  const refresh = useCallback(async () => {
    await fetchRemote();
  }, [fetchRemote]);

  /**
   * The branch to pull/push. The cached `currentBranch` is undefined until the
   * first fetchLocal has landed, and right after the first commit in a fresh
   * repository (there were no branches to list when it ran), so fall back to
   * asking git.
   */
  const resolveCurrentBranch = useCallback(async (): Promise<Branch | undefined> => {
    if (currentBranch) return currentBranch;

    const branchName = await git.getCurrentBranchName();
    const allBranches = await getBranches(repositoryPath);
    return allBranches.find((x) => x.name === branchName);
  }, [git, repositoryPath, currentBranch]);

  const pull = useCallback(async (): Promise<boolean> => {
    const branch = await resolveCurrentBranch();
    if (!branch) {
      ToastLayer.showError('No branch is checked out, so there is nothing to pull into.');
      return false;
    }

    setGitStatus({ kind: 'pull', progress: 0 });

    let didPull = false;

    try {
      let autoStash: Stash = undefined;
      const autoStashMessge = 'XGENIA autostash on pull';

      if (localChangesCount === 0) {
        await git.resetToHead();
      } else {
        try {
          await confirmStashBeforePull();
        } catch (_) {
          //user canceled
          await fetchLocal();
          return false;
        }

        ProjectModel.setSaveOnModelChange(false);
        autoStash = await createStashEntry(repositoryPath, autoStashMessge);
      }

      const remote = await getRemote(repositoryPath);

      ProjectModel.setSaveOnModelChange(false);

      await gitPull(repositoryPath, remote, branch, (progress) => {
        setGitStatus({
          kind: 'pull',
          progress: progress.value,
          message: progress.title || progress.description
        });
      });

      if (await git.isRebaseInProgress()) {
        await git.tryHandleRebaseState();
        await fetchLocal();
      }

      if (autoStash) {
        try {
          await popStashEntry(repositoryPath, autoStash.name);
        } catch (err: any) {
          //
          // Here be dragons. Thou art forewarned
          //
          if (err.toString().includes('could not restore untracked files from stash')) {
            const stashBranchName = `!!XGENIA-AutoStash-${autoStash.branchName}`;

            // Having some minor changes to project.json
            await git.resetToHead();

            // Create a new branch from the stash
            // this will also checkout the branch
            await popStashEntryToBranch(repositoryPath, autoStash.name, stashBranchName);

            // Merge our working branch into the stash branch
            await git._merge({
              theirsBranchName: branch.name,
              oursBranchName: stashBranchName,
              isSquash: false,
              message: undefined,
              allowFastForward: false
            });

            const changes = await git.status();
            if (changes.length > 0) {
              await git.commit('Merge stash');
            }

            // TODO: Should we make sure there are no issues?

            // Checkout the working branch
            await git.checkoutBranch(branch.nameWithoutRemote);

            // Squash merge our stash branch into the working branch without making any commits.
            await merge(repositoryPath, stashBranchName, {
              strategy: 'recursive',
              strategyOption: 'theirs',
              isSquash: true,
              squashNoCommit: true,
              message: undefined,
              noFastForward: true
            });

            // Delete the stash branch
            await git.deleteBranch(stashBranchName);

            // And what should be left on the working branch is our stash, that we love so much!
          } else {
            // We failed to pop the stash, this shouldn't happen, but we just log the error and return false.
            throw err;
          }
        }
      }

      didPull = true;
      EventDispatcher.instance.notifyListeners('projectChangedOnDisk');
    } catch (error: any) {
      if (error instanceof GitActionError) {
        if (error.code === GitActionErrorCode.AuthorizationFailed) {
          setGitStatus({ kind: 'set-authorization' });
        } else {
          ToastLayer.showError(error.message);
        }
      } else {
        console.error(error);
        ToastLayer.showError('Failed to pull. Error: ' + error);
      }
    }

    ProjectModel.setSaveOnModelChange(true);

    await fetchLocal();

    return didPull;
  }, [git, repositoryPath, resolveCurrentBranch, localChangesCount, fetchLocal, confirmStashBeforePull]);

  const push = useCallback(async (): Promise<boolean> => {
    const branch = await resolveCurrentBranch();
    if (!branch) {
      ToastLayer.showError('No branch is checked out, so there is nothing to push.');
      return false;
    }

    setGitStatus({ kind: 'push', progress: 0 });

    try {
      await gitPush({
        baseDir: repositoryPath,
        currentBranch: branch,
        onProgress: (progress) => {
          setGitStatus({
            kind: 'push',
            message: progress.title,
            progress: progress.value
          });
        }
      });
    } catch (error: any) {
      if (error instanceof GitActionError && error.code === GitActionErrorCode.AuthorizationFailed) {
        setGitStatus({ kind: 'set-authorization' });
      } else {
        ToastLayer.showError('Failed to push. ' + error);

        // If the error is a rejected push, we need to fetch again to get the latest state where we can pull and rebase
        if (error?.toString().includes('rejected')) {
          await fetchRemote();
        }
      }

      return false;
    }

    await fetchRemote();

    return true;
  }, [repositoryPath, resolveCurrentBranch, fetchRemote]);

  /** Pull, then push — VS Code's "Sync Changes". */
  const sync = useCallback(async () => {
    const didPull = await pull();
    if (didPull) {
      await push();
    }
  }, [pull, push]);

  const commit = useCallback(
    async (options?: { amend?: boolean; thenPush?: boolean; thenSync?: boolean }) => {
      const amend = options?.amend === true;

      // Amending a commit that is already on the remote would need a force push.
      if (amend && !fetch.localCommitCount) {
        showAmendPushedCommitDialog();
        return;
      }

      // VS Code refuses to commit without a message; amending can reuse the
      // message of the commit it rewrites, so it is exempt.
      if (!amend && !commitMessage.trim()) {
        ToastLayer.showError('Please provide a commit message.');
        return;
      }

      setIsPerformingAction(true);
      ToastLayer.showActivity(amend ? 'Amending last commit' : 'Commiting local changes', 'performing-action');

      let didCommit = false;

      try {
        // Amending without a new message keeps the message of the commit being
        // amended, the way `git commit --amend --no-edit` does.
        let message = commitMessage;
        if (amend && !message.trim()) {
          message = (await getHeadCommitMessage(git)) || message;
        }

        // Create the commit
        const commitSha = await git.commit(message, { amend });
        setCommitMessage('');
        didCommit = true;

        // Update local status
        await fetchLocal();

        // Select the history tab
        setActiveTabId('history');

        // Select the new commit
        if (commitSha) {
          setSelectedCommit(commitSha);
        }
      } catch (error: any) {
        if (error instanceof GitActionError) {
          ToastLayer.showError(error.message);
        } else {
          console.error(error);
          ToastLayer.showError('Failed to commit. Error: ' + error);
        }
      }

      ToastLayer.hideActivity('performing-action');
      setIsPerformingAction(false);

      if (!didCommit) return;

      if (options?.thenSync) {
        await sync();
      } else if (options?.thenPush) {
        await push();
      }
    },
    [
      git,
      commitMessage,
      fetch.localCommitCount,
      fetchLocal,
      setCommitMessage,
      setActiveTabId,
      setSelectedCommit,
      setIsPerformingAction,
      push,
      sync
    ]
  );

  const stashChanges = useCallback(async () => {
    try {
      await confirmStash();
    } catch (_) {
      return; //user canceled
    }

    ProjectModel.setSaveOnModelChange(false);
    const stashMessage = fetch.createStashMessage();
    await createStashEntry(repositoryPath, stashMessage);

    //note: automatically enables project saving again when the project has been reloaded
    EventDispatcher.instance.notifyListeners('projectChangedOnDisk');

    await fetchLocal();
  }, [repositoryPath, fetch.createStashMessage, fetchLocal, confirmStash]);

  const discardAllChanges = useCallback(async () => {
    try {
      await confirmDiscardAll();
    } catch (_) {
      return; //user canceled
    }

    setIsPerformingAction(true);
    ToastLayer.showActivity('Resetting local changes', 'performing-action');

    try {
      ProjectModel.setSaveOnModelChange(false);
      const remoteHasBranch = (branches || []).some((b) => b.name === currentBranch?.name && !!b.remoteName);

      if (remoteHasBranch) {
        await git.resetToMergeBase();
      } else {
        await git.resetToHead();
      }

      await fetchLocal();

      //note: the projectChangedOnDisk listener will enable ProjectModel.setSaveOnModelChange when it's done
      EventDispatcher.instance.notifyListeners('projectChangedOnDisk');
      ToastLayer.showSuccess('Reset done');
    } catch (e: any) {
      ProjectModel.setSaveOnModelChange(true);

      if (e instanceof GitActionError) {
        ToastLayer.showError(e.message);
      } else {
        ToastLayer.showError('Reset failed. ' + e.toString());
      }
    }

    ToastLayer.hideActivity('performing-action');
    setIsPerformingAction(false);
  }, [git, branches, currentBranch, fetchLocal, setIsPerformingAction, confirmDiscardAll]);

  const popStash = useCallback(
    async (stash: Stash) => {
      if (!stash) return;

      if (localChangesCount > 0) {
        showCantApplyStashDialog();
        return;
      }

      try {
        await confirmApplyStash();
      } catch (_) {
        return; //user canceled
      }

      ProjectModel.setSaveOnModelChange(false);

      //localChangesCount is zero but we might have some minor metadata changes, reset them before applying stash
      await reset(repositoryPath, GitResetMode.Hard, 'HEAD');

      try {
        await popStashEntry(repositoryPath, stash.name);
        //note: automatically enables project saving again when the project has been reloaded
        EventDispatcher.instance.notifyListeners('projectChangedOnDisk');
        await fetchLocal();
        ToastLayer.showSuccess('Stash applied');
      } catch (e: any) {
        ToastLayer.showError(e.toString());
      }

      ProjectModel.setSaveOnModelChange(true);
    },
    [repositoryPath, localChangesCount, fetchLocal, confirmApplyStash, showCantApplyStashDialog]
  );

  const dropStash = useCallback(
    async (stash: Stash) => {
      if (!stash) return;

      try {
        await confirmDeleteStash();
      } catch (_) {
        return; //user canceled
      }

      try {
        await dropStashEntry(repositoryPath, stash.name);
        await fetchLocal();
        ToastLayer.showSuccess('Stash deleted');
      } catch (e: any) {
        ToastLayer.showError(e.toString());
      }
    },
    [repositoryPath, fetchLocal, confirmDeleteStash]
  );

  const actionDialogs = (
    <>
      <StashBeforePullDialog />
      <DiscardAllDialog />
      <StashDialog />
      <ApplyStashDialog />
      <DeleteStashDialog />
      <CantApplyStashDialog />
      <AmendPushedCommitDialog />
    </>
  );

  return {
    actions: {
      refresh,
      pull,
      push,
      sync,
      commit,
      stashChanges,
      discardAllChanges,
      popStash,
      dropStash,
      // 'pull'/'push' without a progress value is the idle "you can pull/push"
      // state, not an operation in flight.
      isBusy:
        gitStatus.kind === 'fetch' ||
        ((gitStatus.kind === 'pull' || gitStatus.kind === 'push') && typeof gitStatus.progress === 'number')
    },
    actionDialogs
  };
}

/** The full message (summary + body) of the commit at HEAD, or an empty string. */
async function getHeadCommitMessage(git: Git): Promise<string> {
  try {
    const headSha = await git.getHeadCommitId();
    if (!headSha) return '';

    const commit = await git.getCommitFromId(headSha);
    return [commit?.summary, commit?.body].filter((part) => Boolean(part?.trim())).join('\n\n');
  } catch (error: any) {
    console.warn('[VersionControl] Could not read the last commit message:', error);
    return '';
  }
}
