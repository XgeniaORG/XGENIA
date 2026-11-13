import { filesystem } from '@xgenia/platform';

import { EventDispatcher } from '../../../shared/utils/EventDispatcher';
import { ProjectModel } from './projectmodel';
import { UndoQueue } from './undo-queue-model';

import { type Checkpoint, pruneCheckpoints, shouldAutoCheckpoint } from './checkpointPolicy';

export type { Checkpoint } from './checkpointPolicy';

/**
 * Checkpoints: whole-project snapshots that outlive the session, so history survives a
 * restart (the undo queue is closures and dies with the window). Kept outside the project —
 * under the app's user data, per project id — so they never end up in the project's git.
 * Restoring writes the snapshot back as project.json and reloads the project the way the
 * version-control panel does (projectChangedOnDisk); a "Before restore" checkpoint is taken
 * first, so a restore can itself be undone.
 */
export class ProjectCheckpoints {
  static readonly EVENT = 'projectCheckpointsChanged';

  private static changesSince = 0;
  private static firstChangeAt = 0;
  private static autoGroup = {};
  private static saving: Promise<void> = Promise.resolve();

  static dir(): string | null {
    const id = ProjectModel.instance?.id;
    if (!id) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const remote = require('@electron/remote');
      return filesystem.join(remote.app.getPath('userData'), 'checkpoints', String(id));
    } catch {
      return null;
    }
  }

  static async list(): Promise<Checkpoint[]> {
    const dir = ProjectCheckpoints.dir();
    if (!dir || !filesystem.exists(filesystem.join(dir, 'index.json'))) return [];
    try {
      const index = JSON.parse(await filesystem.readFile(filesystem.join(dir, 'index.json')));
      return Array.isArray(index) ? index.sort((a, b) => b.createdAt - a.createdAt) : [];
    } catch {
      return [];
    }
  }

  static save(label: string, opts: { auto?: boolean } = {}): Promise<void> {
    // Serialised: two overlapping saves must not race on index.json.
    ProjectCheckpoints.saving = ProjectCheckpoints.saving.then(() => ProjectCheckpoints.doSave(label, !!opts.auto)).catch((e) => {
      console.error('[Checkpoints] save failed', e);
    });
    return ProjectCheckpoints.saving;
  }

  private static async doSave(label: string, auto: boolean) {
    const dir = ProjectCheckpoints.dir();
    if (!dir || !ProjectModel.instance) return;
    if (!filesystem.exists(dir)) await filesystem.makeDirectory(dir);
    const createdAt = Date.now();
    const id = String(createdAt) + (auto ? '-a' : '-m');
    await filesystem.writeJson(filesystem.join(dir, id + '.json'), ProjectModel.instance.toJSON());
    const [kept, dropped] = pruneCheckpoints([...(await ProjectCheckpoints.list()), { id, label, createdAt, auto }]);
    for (const c of dropped) await filesystem.removeFile(filesystem.join(dir, c.id + '.json')).catch(() => undefined);
    await filesystem.writeJson(filesystem.join(dir, 'index.json'), kept);
    ProjectCheckpoints.changesSince = 0;
    ProjectCheckpoints.firstChangeAt = 0;
    EventDispatcher.instance.notifyListeners(ProjectCheckpoints.EVENT);
  }

  static async restore(id: string): Promise<boolean> {
    const dir = ProjectCheckpoints.dir();
    const projectDir = ProjectModel.instance?._retainedProjectDirectory;
    if (!dir || !projectDir) return false;
    const file = filesystem.join(dir, id + '.json');
    if (!filesystem.exists(file)) return false;
    const json = JSON.parse(await filesystem.readFile(file));
    await ProjectCheckpoints.save('Before restore', { auto: true });
    // Same sequence as the version-control panel's stash: stop saving, change the file, and
    // let the editor reload from disk (which turns saving back on).
    ProjectModel.setSaveOnModelChange(false);
    await filesystem.writeJson(filesystem.join(projectDir, 'project.json'), json);
    EventDispatcher.instance.notifyListeners('projectChangedOnDisk');
    return true;
  }

  /** Count recorded changes and take an automatic checkpoint now and then. Idempotent. */
  static startAuto() {
    UndoQueue.instance.off(ProjectCheckpoints.autoGroup);
    ProjectCheckpoints.changesSince = 0;
    ProjectCheckpoints.firstChangeAt = 0;
    UndoQueue.instance.on(
      'undoHistoryChanged',
      () => {
        if (!ProjectModel.instance) return;
        if (ProjectCheckpoints.changesSince === 0) ProjectCheckpoints.firstChangeAt = Date.now();
        ProjectCheckpoints.changesSince++;
        if (shouldAutoCheckpoint(ProjectCheckpoints.changesSince, Date.now() - ProjectCheckpoints.firstChangeAt)) {
          const history = UndoQueue.instance.getHistory();
          const last = history[UndoQueue.instance.getHistoryLocation() - 1];
          void ProjectCheckpoints.save('Auto · ' + (last?.label || 'changes'), { auto: true });
        }
      },
      ProjectCheckpoints.autoGroup
    );
  }

  static stopAuto() {
    UndoQueue.instance.off(ProjectCheckpoints.autoGroup);
  }
}
