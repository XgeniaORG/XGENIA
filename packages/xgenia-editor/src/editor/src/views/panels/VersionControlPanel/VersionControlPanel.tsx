import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Git } from '@xgenia/git';
import { platform } from '@xgenia/platform';

import { AppRegistry } from '@xgenia-models/app_registry';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { WarningsModel } from '@xgenia-models/warningsmodel';
import { copyValueToClipboard } from '@xgenia-utils/copyValueToClipboard';
import { LocalProjectsModel } from '@xgenia-utils/LocalProjectsModel';
import { mergeProject } from '@xgenia-utils/projectmerger';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { PrimaryButton, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { HStack } from '@xgenia-core-ui/components/layout/Stack';
import { Tabs, TabsVariant } from '@xgenia-core-ui/components/layout/Tabs';
import { ContextMenu } from '@xgenia-core-ui/components/popups/ContextMenu';
import { MenuDialogItem } from '@xgenia-core-ui/components/popups/MenuDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { Text } from '@xgenia-core-ui/components/typography/Text';

import { VersionControlPanel_ID } from '.';
import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';
import { ComponentDiffDocumentProvider } from '../../documents/ComponentDiffDocument';
import { EditorDocumentProvider } from '../../documents/EditorDocument';
import PopupLayer from '../../popuplayer';
import { ToastLayer } from '../../ToastLayer/ToastLayer';
import { useIsActivePanel } from '../useIsActivePanel';
import { BranchMerge } from './components/BranchMerge';
import { BranchStatusButton } from './components/BranchStatusButton';
import { GitProviderPopout } from './components/GitProviderPopout/GitProviderPopout';
import { GitStatusButton } from './components/GitStatusButton';
import { History } from './components/History';
import { LocalChanges } from './components/LocalChanges';
import { MergeConflicts } from './components/MergeConflicts';
import { PublishToGitHubDialog } from './components/PublishToGitHubDialog';
import { useVersionControlContext, VersionControlProvider } from './context';
import { getGitHubRepoUrl } from './github';

enum ViewState {
  Default,
  Branches,
  BranchMerge
}

interface BaseVersionControlPanelProps {
  /** Open the publish dialog straight away, used after initializing for a publish. */
  openPublishDialogOnMount?: boolean;
}

function BaseVersionControlPanel({ openPublishDialogOnMount }: BaseVersionControlPanelProps) {
  const {
    git,
    actions,
    activeTabId,
    setActiveTabId,
    localChangesCount,
    branchStatus,
    fetch,
    updateLocalDiff
  } = useVersionControlContext();
  const historyCount = fetch.localCommitCount + fetch.remoteCommitCount;

  const isActivePanel = useIsActivePanel(VersionControlPanel_ID);
  const shouldUpdateDiff = useRef(true);

  const headerActionsRef = useRef<HTMLDivElement>(null);
  const [isPublishDialogVisible, setIsPublishDialogVisible] = useState(Boolean(openPublishDialogOnMount));

  useEffect(() => {
    const eventGroup = {};

    if (!isActivePanel) {
      //if we're switching to another panel make sure we close any open diff documents
      if (AppRegistry.instance.CurrentDocumentId === ComponentDiffDocumentProvider.ID) {
        AppRegistry.instance.openDocument(EditorDocumentProvider.ID);
      }

      //check if project is saved while we're inactive, and if so, diff next time we're active
      EventDispatcher.instance.on(
        ['ProjectModel.projectSavedToDisk', 'ProjectModel.instanceHasChanged'],
        () => {
          shouldUpdateDiff.current = true;
        },
        eventGroup
      );
    } else {
      //we're now the active panel, fetch local changes and update diff if needed
      fetch.fetchLocal().then(() => {
        if (shouldUpdateDiff.current === true) {
          shouldUpdateDiff.current = false;
          updateLocalDiff();
        }
      });

      //if project is saved and we're active, update the diff
      EventDispatcher.instance.on(
        ['ProjectModel.projectSavedToDisk', 'ProjectModel.instanceHasChanged'],
        () => {
          updateLocalDiff();
        },
        eventGroup
      );
    }

    return () => {
      EventDispatcher.instance.off(eventGroup);
    };
  }, [isActivePanel]);

  const hasConflictsInProject = useHasConflictsInProject();

  // NOTE: The keep alive stuff here is a little confusing,
  //       but are designed in a way to be performant.
  let viewState = ViewState.Default;

  if (branchStatus) {
    switch (branchStatus.kind) {
      case 'merge':
        viewState = ViewState.BranchMerge;
        break;
    }
  }

  function openGitSettingsPopout() {
    const popoutDiv = document.createElement('div');

    // Create a React root for popoutDiv and render the component
    const root = createRoot(popoutDiv);
    root.render(React.createElement(GitProviderPopout, { git }));

    // The timeout is needed to solve a bug when the popout is opened from the git status button,
    // which causes timing issues between native events and React where the popout is instantly closed.
    setTimeout(() => {
      PopupLayer.instance.showPopout({
        content: { el: [popoutDiv] },
        attachTo: $(headerActionsRef.current),
        position: 'right',
        disableDynamicPositioning: true,
        onClose: () => {
          // Clean up by unmounting the React component
          root.unmount();
          fetch.fetchRemote();
        }
      });
    }, 1);
  }

  const githubRepoUrl = getGitHubRepoUrl(git.OriginUrl);
  const hasRemote = fetch.gitStatus.kind !== 'push-repository' && Boolean(git.OriginUrl);
  const canCommit = localChangesCount > 0 && !hasConflictsInProject && !actions.isBusy;

  /**
   * The commands VS Code keeps behind "Views and More Actions..." in the Source
   * Control title bar.
   */
  const moreActionsMenuItems: (MenuDialogItem | 'divider')[] = [
    {
      label: 'Pull',
      icon: IconName.ArrowDown,
      isDisabled: !hasRemote || actions.isBusy,
      onClick: () => actions.pull()
    },
    {
      label: 'Push',
      icon: IconName.ArrowUp,
      isDisabled: !hasRemote || actions.isBusy,
      onClick: () => actions.push()
    },
    {
      label: 'Sync Changes',
      icon: IconName.Refresh,
      isDisabled: !hasRemote || actions.isBusy,
      endSlot:
        fetch.remoteCommitCount || fetch.localCommitCount
          ? `↓ ${fetch.remoteCommitCount ?? 0}  ↑ ${fetch.localCommitCount ?? 0}`
          : undefined,
      onClick: () => actions.sync()
    },
    {
      label: 'Fetch',
      icon: IconName.CloudDownload,
      isDisabled: !hasRemote || actions.isBusy,
      onClick: () => actions.refresh()
    },
    'divider',
    {
      label: 'Publish to GitHub...',
      icon: IconName.CloudUpload,
      // With a GitHub remote already set, publishing again is not the action the
      // user wants: pushing is. VS Code hides the command in the same situation.
      isHidden: Boolean(githubRepoUrl),
      onClick: () => setIsPublishDialogVisible(true)
    },
    {
      label: 'Open on GitHub',
      icon: IconName.ExternalLink,
      isHidden: !githubRepoUrl,
      onClick: () => platform.openExternal(githubRepoUrl)
    },
    {
      label: 'Copy Remote URL',
      icon: IconName.Link,
      isHidden: !git.OriginUrl,
      onClick: () => copyValueToClipboard({ value: git.OriginUrl })
    },
    'divider',
    {
      label: 'Stash Changes',
      icon: IconName.Stash,
      isDisabled: !localChangesCount || hasConflictsInProject,
      onClick: () => actions.stashChanges()
    },
    {
      label: 'Pop Latest Stash',
      icon: IconName.ImportDown,
      isDisabled: !fetch.stashes?.length,
      onClick: () => actions.popStash(fetch.stashes?.[0])
    },
    {
      label: 'Discard All Changes',
      icon: IconName.Trash,
      isDangerous: true,
      isDisabled: !localChangesCount,
      onClick: () => actions.discardAllChanges()
    },
    'divider',
    {
      label: 'Repository Settings...',
      icon: IconName.Setting,
      onClick: () => openGitSettingsPopout()
    }
  ];

  return (
    <BasePanel
      isFill
      title="Version Control"
      headerSlot={
        <HStack ref={headerActionsRef} hasSpacing={1} UNSAFE_style={{ height: 'auto' }}>
          <Tooltip content="Commit" fineType={hasConflictsInProject ? 'Resolve the conflicts first' : undefined}>
            <IconButton
              icon={IconName.Check}
              size={IconSize.Small}
              variant={IconButtonVariant.OpaqueOnHover}
              isDisabled={!canCommit}
              onClick={() => actions.commit()}
            />
          </Tooltip>
          <Tooltip content="Refresh">
            <IconButton
              icon={IconName.Refresh}
              size={IconSize.Small}
              variant={IconButtonVariant.OpaqueOnHover}
              isDisabled={actions.isBusy}
              onClick={() => actions.refresh()}
            />
          </Tooltip>
          {Boolean(githubRepoUrl) && (
            <Tooltip content="Open on GitHub">
              <IconButton
                icon={IconName.ExternalLink}
                size={IconSize.Small}
                variant={IconButtonVariant.OpaqueOnHover}
                onClick={() => platform.openExternal(githubRepoUrl)}
              />
            </Tooltip>
          )}
          <ContextMenu
            title="Version Control"
            icon={IconName.DotsThreeHorizontal}
            size={IconSize.Small}
            variant={IconButtonVariant.OpaqueOnHover}
            menuItems={moreActionsMenuItems}
          />
        </HStack>
      }
    >
      <PublishToGitHubDialog
        isVisible={isPublishDialogVisible}
        git={git}
        projectId={ProjectModel.instance.id}
        projectName={ProjectModel.instance.name}
        onClose={() => setIsPublishDialogVisible(false)}
        onPublished={(repository) => {
          ToastLayer.showSuccess(`Published to ${repository.fullName}`);
          fetch.fetchRemote();
        }}
      />

      <Container direction={ContainerDirection.Vertical} UNSAFE_style={{ height: '100%', isolation: 'isolate' }}>
        {hasConflictsInProject ? (
          <MergeConflicts />
        ) : (
          <>
            <GitStatusButton
              openGitSettingsPopout={openGitSettingsPopout}
              openPublishToGitHubDialog={() => setIsPublishDialogVisible(true)}
            />
            <BranchStatusButton />
            {viewState === ViewState.BranchMerge && <BranchMerge />}
          </>
        )}

        {viewState !== ViewState.BranchMerge && (
          <Tabs
            variant={TabsVariant.Sidebar}
            keepTabsAlive
            activeTab={activeTabId}
            onChange={(activeTab) => setActiveTabId(activeTab)}
            tabs={[
              {
                id: 'changes',
                label: localChangesCount ? `Changes (${localChangesCount})` : 'Changes',
                content: <LocalChanges hasConflictsInProject={hasConflictsInProject} />
              },
              {
                id: 'history',
                label: historyCount > 0 ? `History (${historyCount})` : 'History',
                content: <History />
              }
            ]}
          />
        )}
      </Container>
    </BasePanel>
  );
}

export function VersionControlPanel() {
  const [git, setGit] = useState<Git>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'not-git'>('loading');
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [openPublishDialogOnMount, setOpenPublishDialogOnMount] = useState(false);

  async function createGit() {
    const gitClient = new Git(mergeProject);
    await gitClient.openRepository(ProjectModel.instance._retainedProjectDirectory);
    setGit(gitClient);
  }

  useEffect(() => {
    LocalProjectsModel.instance.isGitProject(ProjectModel.instance).then(async (isGitProject) => {
      if (isGitProject) {
        await createGit();
        setState('loaded');
      } else {
        setState('not-git');
      }
    });
  }, []);

  async function initRepository(): Promise<Git> {
    const gitClient = new Git(mergeProject);
    await gitClient.initNewRepo(ProjectModel.instance._retainedProjectDirectory);
    return gitClient;
  }

  /** VS Code's "Initialize Repository": a repository with everything committed. */
  async function setupGit() {
    setIsSettingUp(true);

    try {
      const gitClient = await initRepository();
      await gitClient.commit('Initial commit');
      setGit(gitClient);
      setState('loaded');
    } catch (e: any) {
      console.error(e);
      ToastLayer.showError('Could not initialize the repository. ' + e);
    }

    setIsSettingUp(false);
  }

  /**
   * VS Code's "Publish to GitHub" from the welcome view: initialize, then let the
   * publish flow make the first commit — it needs the GitHub account first, since
   * that is where the git identity comes from on a machine that has never set one.
   */
  async function setupGitAndPublish() {
    setIsSettingUp(true);

    try {
      const gitClient = await initRepository();
      setGit(gitClient);
      setState('loaded');
      setOpenPublishDialogOnMount(true);
    } catch (e: any) {
      console.error(e);
      ToastLayer.showError('Could not initialize the repository. ' + e);
    }

    setIsSettingUp(false);
  }

  if (git === null && state === 'not-git') {
    return (
      <BasePanel isFill title="Version Control">
        <Box hasXSpacing hasYSpacing>
          <Text hasBottomSpacing>
            This project has no Git repository yet. Initialize one to enable version control, or publish the project
            straight to a new GitHub repository.
          </Text>
          <PrimaryButton
            label="Initialize Repository"
            isGrowing
            hasBottomSpacing
            isDisabled={isSettingUp}
            onClick={setupGit}
          />
          <PrimaryButton
            label="Publish to GitHub"
            variant={PrimaryButtonVariant.Muted}
            icon={IconName.CloudUpload}
            isGrowing
            isDisabled={isSettingUp}
            onClick={setupGitAndPublish}
          />
        </Box>
      </BasePanel>
    );
  }

  // TODO: Loading state? Should be really quick though
  if (git === null) {
    return null;
  }

  return (
    <VersionControlProvider git={git}>
      <BaseVersionControlPanel openPublishDialogOnMount={openPublishDialogOnMount} />
    </VersionControlProvider>
  );
}

export function useHasConflictsInProject() {
  const [hasConflicts, setHasConflicts] = useState<boolean>(false);

  // Listen for changes to conflicts
  useEffect(() => {
    const checkForWarnings = () => {
      setHasConflicts(
        WarningsModel.instance.getTotalNumberOfWarningsMatching(
          (_key, _ref, warning) =>
            warning.warning.type === 'conflict' || warning.warning.type === 'conflict-source-code'
        ) > 0
      );
    };

    const eventGroup = {};

    WarningsModel.instance.on('warningsChanged', checkForWarnings, eventGroup);

    checkForWarnings();

    return () => {
      WarningsModel.instance.off(eventGroup);
    };
  }, []);

  return hasConflicts;
}
