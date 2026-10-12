import { filesystem } from '@xgenia/platform';

import { ProjectModel } from '../../../models/projectmodel';
import { pickProjectScreen, type ProjectScreen } from './projectScreenPick';

export type { ProjectScreen } from './projectScreenPick';

// The last answer, per project directory. The canvas drop handler is synchronous and cannot read
// bible.json itself, so the asset panel refreshes this on every scan and the drop reads it.
let cached: { root: string; screen: ProjectScreen | null } | null = null;

function projectRoot(): string | null {
  const root = ProjectModel.instance?._retainedProjectDirectory;
  return root ? String(root) : null;
}

export async function loadProjectScreen(): Promise<ProjectScreen | null> {
  const root = projectRoot();
  if (!root) return null;
  let bible: any = null;
  try {
    const p = filesystem.join(root, '.xgenia', 'bible.json');
    if (filesystem.exists(p)) bible = JSON.parse(await filesystem.readFile(p));
  } catch {
    bible = null; // an unreadable bible is "not declared", never a default size
  }
  let pinned: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { EditorSettings } = require('../../../utils/editorsettings');
    const id = (ProjectModel.instance as any)?.id;
    pinned = id ? EditorSettings?.instance?.get(id)?.viewportSize : null;
  } catch {
    pinned = null;
  }
  const screen = pickProjectScreen(bible, pinned);
  cached = { root, screen };
  return screen;
}

/** Synchronous read for the drop handler. null when unknown or for another project. */
export function getCachedProjectScreen(): ProjectScreen | null {
  const root = projectRoot();
  return cached && cached.root === root ? cached.screen : null;
}
