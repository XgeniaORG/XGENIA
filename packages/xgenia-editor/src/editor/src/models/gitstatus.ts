// Uncommitted file count for the rail's Version control badge. The panel's own
// `localChangesCount` (a React context inside the panel) is a richer, different figure —
// components diffed against HEAD — and only exists once the panel has been opened. This
// counts files reported by `git status`, project.json included, and lives outside React.
import { Git } from '@xgenia/git';
import { mergeProject } from '@xgenia-utils/projectmerger';
import { LocalProjectsModel } from '@xgenia-utils/LocalProjectsModel';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { EventDispatcher } from '../../../shared/utils/EventDispatcher';

let count: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

function set(next: number | null) {
  if (next === count) return;
  count = next;
  EventDispatcher.instance.emit('git-status-changed', { count });
}

export const GitStatus = {
  getSnapshot() {
    return { count };
  },

  async refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const dir = ProjectModel.instance?._retainedProjectDirectory;
      if (!dir) return set(null);
      try {
        // `Git.openRepository` does NOT throw for a non-repo directory: `open()` runs
        // `rev-parse --show-cdup`, treats exit code 128 as success and resolves to null,
        // so `Git`'s internal baseDir becomes null and every later git-cli call spawns
        // with cwd: null — which Node resolves to *this process's* cwd, i.e. the
        // xgenia-editor monorepo in a dev checkout. Without this pre-check the badge would
        // confidently show the monorepo's uncommitted count on a project that isn't a git
        // repo at all. Pre-check with the same authority three other call sites already use
        // (VersionControlPanel.tsx, EditorBridge's git.isAvailable/git.ensureInitialized)
        // and never construct a Git client when the project isn't a repo.
        const isGitProject = await LocalProjectsModel.instance.isGitProject(ProjectModel.instance);
        if (!isGitProject) return set(null);
        const g = new Git(mergeProject);
        await g.openRepository(String(dir));
        const files = await g.status();
        set(files.length);
      } catch {
        // Not a repo, or git unavailable: hide the badge, retry on the next trigger.
        set(null);
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  },

  scheduleRefresh(delayMs = 5000) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void GitStatus.refresh();
    }, delayMs);
  },

  reset() {
    if (timer) clearTimeout(timer);
    timer = null;
    set(null);
  }
};
