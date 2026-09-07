import React from 'react';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { PrimaryButton, PrimaryButtonSize } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { TextArea } from '@xgenia-core-ui/components/inputs/TextArea';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { ScrollArea } from '@xgenia-core-ui/components/layout/ScrollArea';
import { HStack } from '@xgenia-core-ui/components/layout/Stack';
import { ContextMenu } from '@xgenia-core-ui/components/popups/ContextMenu';
import { Label } from '@xgenia-core-ui/components/typography/Label';

import { useVersionControlContext } from '../context';
import { LocalChangesDiff } from './LocalChangesDiff';
import { Stashes } from './Stashes';

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
const COMMIT_SHORTCUT_LABEL = isMac ? '⌘Enter' : 'Ctrl+Enter';

export interface LocalChangesProps {
  hasConflictsInProject: boolean;
}

export function LocalChanges({ hasConflictsInProject }: LocalChangesProps) {
  const { git, actions, commitMessage, setCommitMessage, localChangesCount, localDiff, fetch } =
    useVersionControlContext();
  const { gitStatus, currentBranch, localCommitCount, remoteCommitCount, stashes } = fetch;

  const canInteract = gitStatus.kind !== 'fetch';
  const hasChanges = localChangesCount > 0;
  const hasRemote = gitStatus.kind !== 'push-repository' && Boolean(git.OriginUrl);

  const canCommit = canInteract && hasChanges && !hasConflictsInProject;

  // Mirrors VS Code's input box hint: "Message (press ⌘Enter to commit on 'main')".
  const commitPlaceholder = currentBranch
    ? `Message (press ${COMMIT_SHORTCUT_LABEL} to commit on '${currentBranch.nameWithoutRemote}')`
    : `Message (press ${COMMIT_SHORTCUT_LABEL} to commit)`;

  return (
    <Container direction={ContainerDirection.Vertical} UNSAFE_style={{ height: '100%' }}>
      <Container direction={ContainerDirection.Vertical} hasXSpacing hasYSpacing>
        {!hasConflictsInProject && (
          <TextArea
            value={commitMessage}
            onChange={(ev) => setCommitMessage(ev.target.value)}
            onKeyDown={(ev) => {
              if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter' && canCommit) {
                ev.preventDefault();
                actions.commit();
              }
            }}
            placeholder={commitPlaceholder}
            hasBottomSpacing
          />
        )}

        <HStack>
          <PrimaryButton
            label="Commit"
            size={PrimaryButtonSize.Small}
            isDisabled={!canCommit}
            isGrowing
            hasRightSpacing
            onClick={() => actions.commit()}
          />
          {/* The caret next to Commit, like VS Code's split commit button. */}
          <ContextMenu
            icon={IconName.CaretDown}
            size={IconSize.Large}
            menuItems={[
              {
                label: 'Commit',
                icon: IconName.Check,
                isDisabled: !canCommit,
                onClick: () => actions.commit()
              },
              {
                label: 'Commit & Push',
                icon: IconName.ArrowUp,
                isDisabled: !canCommit || !hasRemote,
                onClick: () => actions.commit({ thenPush: true })
              },
              {
                label: 'Commit & Sync',
                icon: IconName.Refresh,
                isDisabled: !canCommit || !hasRemote,
                endSlot: remoteCommitCount > 0 ? `↓ ${remoteCommitCount}` : undefined,
                onClick: () => actions.commit({ thenSync: true })
              },
              {
                label: 'Commit (Amend)',
                icon: IconName.Reset,
                // Amending a pushed commit needs a force push, so only offer it
                // while the last commit is still local.
                isDisabled: !canInteract || hasConflictsInProject || !localCommitCount,
                tooltip: localCommitCount
                  ? 'Rewrite the last local commit'
                  : 'The last commit is already pushed, so it can not be amended',
                onClick: () => actions.commit({ amend: true })
              },
              'divider',
              {
                label: 'Stash Changes',
                onClick: () => actions.stashChanges(),
                icon: IconName.Stash,
                isDisabled: !hasChanges || hasConflictsInProject
              },
              {
                label: 'Pop Latest Stash',
                onClick: () => actions.popStash(stashes?.[0]),
                icon: IconName.ImportDown,
                isDisabled: !stashes?.length
              },
              'divider',
              {
                label: 'Discard All Changes',
                onClick: () => actions.discardAllChanges(),
                isDangerous: true,
                icon: IconName.Trash,
                isDisabled: !hasChanges
              }
            ]}
          />
        </HStack>
      </Container>

      <ScrollArea UNSAFE_style={{ width: '100%', minHeight: 81 }}>
        {hasChanges || !localDiff ? (
          <LocalChangesDiff />
        ) : (
          <Container direction={ContainerDirection.Vertical} hasXSpacing hasYSpacing>
            <Label>You have no local changes</Label>
          </Container>
        )}
      </ScrollArea>

      <Stashes />
    </Container>
  );
}
