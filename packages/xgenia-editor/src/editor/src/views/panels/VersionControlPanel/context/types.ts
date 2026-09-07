import { Git } from '@xgenia/git';
import { Branch } from '@xgenia/git/src/core/models/branch';
import { Stash } from '@xgenia/git/src/core/models/snapshot';
import { WorkingDirectoryFileChange, WorkingDirectoryStatus } from '@xgenia/git/src/core/models/status';

import { ProjectLocalDiff } from './DiffUtils';

export type GitStatus =
  | {
      kind: 'default';
    }
  | {
      kind: 'error';
      message: string;
    }
  | {
      kind: 'error-fetch';
      message: string;
    }
  | {
      kind: 'fetch';
      progress?: number;
    }
  | {
      kind: 'pull';
      progress?: number;
      message?: string;
    }
  | {
      kind: 'push';
      progress?: number;
      message?: string;
    }
  /** Both ahead and behind the remote: pull and then push, VS Code's "Sync Changes". */
  | {
      kind: 'sync';
    }
  | {
      kind: 'push-repository';
    }
  | {
      kind: 'set-authorization';
    };

export type BranchStatus = {
  kind: 'default' | 'merge';
  to: Branch; //TODO: this should only exist when kind is merge
};

export interface IVersionControlContextFetch {
  /** Returns the current git status. */
  gitStatus: GitStatus;
  setGitStatus: (value: GitStatus) => void;

  /** Returns the current branch. */
  currentBranch: Branch;
  currentCommitSha: string;
  remoteCommitSha: string;

  /** Returns the last fetch time. */
  lastFetchTime: number | undefined;

  workingDirectoryStatus: WorkingDirectoryStatus;
  branches: readonly Branch[];
  stashes: readonly Stash[];

  localCommitCount: number | undefined;
  remoteCommitCount: number | undefined;

  fetchLocal: () => Promise<void>;
  fetchRemote: () => Promise<void>;
  createStashMessage: () => string;
}

/**
 * The git commands the panel can run. Shared by every entry point (status
 * button, panel action menu, commit button dropdown) so a command behaves the
 * same no matter where it is triggered from.
 */
export interface IVersionControlActions {
  /** Fetch from the remote and refresh the local state. */
  refresh: () => Promise<void>;
  /** Returns false when the pull was canceled or failed. */
  pull: () => Promise<boolean>;
  /** Returns false when the push failed. */
  push: () => Promise<boolean>;
  /** Pull, then push. */
  sync: () => Promise<void>;
  commit: (options?: { amend?: boolean; thenPush?: boolean; thenSync?: boolean }) => Promise<void>;
  stashChanges: () => Promise<void>;
  discardAllChanges: () => Promise<void>;
  /** Apply a stash and remove it from the stash list. */
  popStash: (stash: Stash) => Promise<void>;
  dropStash: (stash: Stash) => Promise<void>;
  /** True while a fetch, pull or push is running. */
  isBusy: boolean;
}

export interface IVersionControlContext {
  git: Git;
  repositoryPath: string;

  activeTabId: string;
  setActiveTabId: (value: string) => void;

  /**
   * The commit message. Lives here, not in the changes tab, because the panel
   * header can commit too (like VS Code's ✓ in the Source Control title bar).
   */
  commitMessage: string;
  setCommitMessage: (value: string) => void;

  actions: IVersionControlActions;

  selectedCommit: string;
  setSelectedCommit: (value: string) => void;

  isPerformingAction: boolean;
  setIsPerformingAction: (value: boolean) => void;

  /** Returns the current branch status. */
  branchStatus: BranchStatus;
  setBranchStatus: (value: BranchStatus) => void;

  updateLocalDiff: () => void;
  localDiff: ProjectLocalDiff;
  localFiles: WorkingDirectoryFileChange[];
  localChangesCount: number;

  fetch: IVersionControlContextFetch;
}
