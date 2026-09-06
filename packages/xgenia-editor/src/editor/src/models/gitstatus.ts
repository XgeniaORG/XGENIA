// Uncommitted file count for the rail's Version control badge. The panel's own
// `localChangesCount` (a React context inside the panel) is a richer, different figure —
// components diffed against HEAD — and only exists once the panel has been opened. This
// counts files reported by `git status`, project.json included, and lives outside React.
import { Git } from '@xgenia/git';
import { mergeProject } from '@xgenia-utils/projectmerger';
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
