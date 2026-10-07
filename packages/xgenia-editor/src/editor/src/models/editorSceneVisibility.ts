import { EventDispatcher } from '../../../shared/utils/EventDispatcher';
import { ProjectModel } from './projectmodel';

const METADATA_KEY = 'editorSceneVisibility';

export interface SceneVisibility {
  /** Nodes the Edit view does not draw. */
  hidden: string[];
  /** Nodes a click or box select in the Edit view passes through. */
  locked: string[];
}

/**
 * Editor-only show/hide and lock — Unity's scene visibility and pickability, set by the eye and
 * lock icons in the Hierarchy panel. They change what the EDIT view draws and lets you pick,
 * never the game: nothing here touches a parameter, the runtime, Preview mode or a published
 * build. Locking a slot's background is the point — it stops every click landing on it.
 *
 * Kept in the project metadata so it survives a reload. Not part of undo, as in Unity.
 */
export class EditorSceneVisibility {
  static readonly EVENT = 'editorSceneVisibilityChanged';

  static get(): SceneVisibility {
    const stored = ProjectModel.instance?.getMetaData(METADATA_KEY);
    return {
      hidden: Array.isArray(stored?.hidden) ? [...stored.hidden] : [],
      locked: Array.isArray(stored?.locked) ? [...stored.locked] : []
    };
  }

  static isHidden(nodeId: string): boolean {
    return EditorSceneVisibility.get().hidden.includes(nodeId);
  }

  static isLocked(nodeId: string): boolean {
    return EditorSceneVisibility.get().locked.includes(nodeId);
  }

  static setHidden(nodeIds: string[], hidden: boolean) {
    EditorSceneVisibility.update('hidden', nodeIds, hidden);
  }

  static setLocked(nodeIds: string[], locked: boolean) {
    EditorSceneVisibility.update('locked', nodeIds, locked);
  }

  static toggleHidden(nodeId: string) {
    EditorSceneVisibility.setHidden([nodeId], !EditorSceneVisibility.isHidden(nodeId));
  }

  static toggleLocked(nodeId: string) {
    EditorSceneVisibility.setLocked([nodeId], !EditorSceneVisibility.isLocked(nodeId));
  }

  private static update(list: keyof SceneVisibility, nodeIds: string[], on: boolean) {
    if (!ProjectModel.instance) return;
    const value = EditorSceneVisibility.get();
    const set = new Set(value[list]);
    for (const id of nodeIds) {
      if (on) set.add(id);
      else set.delete(id);
    }
    value[list] = [...set];
    ProjectModel.instance.setMetaData(METADATA_KEY, value);
    EventDispatcher.instance.notifyListeners(EditorSceneVisibility.EVENT, value);
  }
}
