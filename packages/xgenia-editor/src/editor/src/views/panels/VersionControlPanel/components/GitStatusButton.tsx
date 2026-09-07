import React, { useEffect, useState } from 'react';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { ActionButton, ActionButtonProps, ActionButtonVariant } from '@xgenia-core-ui/components/inputs/ActionButton';

import { useVersionControlContext } from '../context';

export type GitStatusButtonProps = {
  openGitSettingsPopout: () => void;
  /** Opens the "Publish to GitHub" dialog, the action offered when there is no remote. */
  openPublishToGitHubDialog: () => void;
};

/**
 * The panel's primary git action, mirroring what VS Code puts in its status bar:
 * "Sync Changes" when the branch has diverged, "Publish Branch" when it has no
 * upstream yet, "Publish to GitHub" when the repository has no remote at all,
 * and pull/push/refresh otherwise.
 */
export function GitStatusButton({ openGitSettingsPopout, openPublishToGitHubDialog }: GitStatusButtonProps) {
  const { git, actions, fetch } = useVersionControlContext();

  const { gitStatus, currentBranch, lastFetchTime, localCommitCount, remoteCommitCount } = fetch;

  const [lastUpdate, setLastUpdate] = useState(undefined);

  useEffect(() => {
    if (lastFetchTime) {
      const date = new Date(lastFetchTime);
      const text = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      setLastUpdate(text);
    }
  }, [lastFetchTime]);

  function lastUpdateText() {
    return lastUpdate ? `Last updated ${lastUpdate}` : 'Fetching...';
  }

  const props = (function (): ActionButtonProps {
    switch (gitStatus.kind) {
      case 'default':
        return {
          icon: IconName.Refresh,
          label: 'Up to date',
          affixText: lastUpdateText()
        };

      case 'error':
        return {
          icon: IconName.Refresh,
          label: 'Failed',
          affixText: gitStatus.message
        };

      case 'error-fetch':
        return {
          icon: IconName.Refresh,
          label: 'Failed to update',
          affixText: gitStatus.message
        };

      case 'fetch': {
        if (typeof gitStatus.progress === 'number') {
          return {
            icon: IconName.ArrowDown,
            isDisabled: true,
            variant: ActionButtonVariant.Background,
            label: 'Receiving Updates...',
            affixText: `${Math.ceil(gitStatus.progress * 100)}%`
          };
        } else {
          return {
            icon: IconName.Refresh,
            isDisabled: true,
            variant: ActionButtonVariant.Background,
            label: 'Checking for updates...',
            affixText: lastUpdateText()
          };
        }
      }

      case 'pull': {
        if (typeof gitStatus.progress === 'number') {
          return {
            icon: IconName.ArrowDown,
            isDisabled: true,
            variant: ActionButtonVariant.BackgroundAction,
            label: 'Pull in progress...',
            affixText: `${gitStatus.message}: ${Math.ceil(gitStatus.progress * 100)}%`
          };
        } else {
          return {
            icon: IconName.ArrowDown,
            variant: ActionButtonVariant.CallToAction,
            label: remoteCommitCount === 1 ? `Pull 1 remote commit` : `Pull ${remoteCommitCount} remote commits`,
            affixText: lastUpdateText()
          };
        }
      }

      case 'sync': {
        return {
          icon: IconName.Refresh,
          variant: ActionButtonVariant.CallToAction,
          label: 'Sync Changes',
          // The counts VS Code shows next to its sync button.
          affixText: `↓ ${remoteCommitCount}  ↑ ${localCommitCount}`
        };
      }

      case 'push-repository': {
        return {
          icon: IconName.CloudUpload,
          variant: ActionButtonVariant.CallToAction,
          label: 'Publish to GitHub',
          affixText: 'No remote set'
        };
      }

      case 'push': {
        if (typeof gitStatus.progress === 'number') {
          return {
            icon: IconName.ArrowUp,
            isDisabled: true,
            variant: ActionButtonVariant.BackgroundAction,
            label: 'Push in progress...',
            affixText: `${Math.ceil(gitStatus.progress * 100)}%`
          };
        } else {
          // Generic text to fit all edge cases
          let label = 'Push local changes';
          let icon = IconName.ArrowUp;

          if (localCommitCount > 0) {
            // Pluralize the text
            label = localCommitCount === 1 ? `Push 1 local commit` : `Push ${localCommitCount} local commits`;
          } else if (currentBranch?.isLocal) {
            // There are no local commits and the branch has no upstream yet,
            // which is what VS Code calls publishing a branch.
            label = 'Publish Branch';
            icon = IconName.CloudUpload;
          }

          return {
            icon,
            variant: ActionButtonVariant.CallToAction,
            label,
            affixText: currentBranch?.isLocal && !localCommitCount ? currentBranch.nameWithoutRemote : lastUpdateText()
          };
        }
      }

      case 'set-authorization': {
        if (git.Provider === 'xgenia') {
          return {
            icon: IconName.WarningTriangle,
            variant: ActionButtonVariant.CallToAction,
            label: 'Migration required',
            affixText: 'XGENIA git hosting is deprecated'
          };
        }

        return {
          icon: IconName.Setting,
          variant: ActionButtonVariant.CallToAction,
          label: 'Update credentials',
          affixText: 'Invalid credentials'
        };
      }
    }
  })();

  async function onAction() {
    switch (gitStatus.kind) {
      case 'default':
      case 'fetch':
      case 'error':
      case 'error-fetch':
        return actions.refresh();

      case 'pull':
        return actions.pull();

      case 'sync':
        return actions.sync();

      case 'push':
        return actions.push();

      case 'push-repository':
        return openPublishToGitHubDialog();

      case 'set-authorization':
        if (git.Provider === 'xgenia') {
          // The deprecated XGENIA remote can't be authorized anymore, publishing
          // to GitHub is the way out of it.
          return openPublishToGitHubDialog();
        }
        return openGitSettingsPopout();
    }
  }

  return <ActionButton {...props} onClick={onAction} />;
}
