// Step 1 of Compile: make an exact on-disk copy of the current project under a
// new "__name__" folder, load it as a separate ProjectModel and register it in
// the projects list. The original project is never modified.

import path from 'path';
import { filesystem } from '@xgenia/platform';
import { projectFromDirectory } from '@xgenia-models/projectmodel.editor';
import { LocalProjectsModel } from '@xgenia-utils/LocalProjectsModel';

export interface DuplicateResult {
  copy: any; // ProjectModel
  destDir: string;
  newName: string;
}

export function isCompiledName(name: string): boolean {
  return /^__.*__$/.test(String(name || ''));
}

export async function duplicateCurrentProject(project: any): Promise<DuplicateResult> {
  const srcDir: string = project._retainedProjectDirectory;
  if (!srcDir) {
    throw new Error('The current project has not been saved to disk yet.');
  }

  const originalName: string = project.name || path.basename(srcDir);
  const newName = `__${originalName}__`;

  const parent = path.dirname(srcDir);
  const destDir = filesystem.makeUniquePath(path.join(parent, newName));

  // Recursively copy project.json, fonts/, xgenia_modules/, etc.
  await filesystem.copyFolder(srcDir, destDir);

  const copy: any = await new Promise((resolve) => {
    projectFromDirectory(destDir, (loaded?: any) => resolve(loaded), { showUpgradeModal: false });
  });
  if (!copy) {
    throw new Error('Failed to load the copied project.');
  }

  copy.name = newName;
  copy._retainedProjectDirectory = destDir;

  // Register so it appears in the projects list (assigns id, persists, notifies).
  try {
    LocalProjectsModel.instance._addProject(copy);
  } catch (e) {
    // Non-fatal: the project is still written to disk below.
    console.warn('[Compile] Could not register copied project in projects list:', e);
  }

  return { copy, destDir, newName };
}

export async function saveProject(project: any, dir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    project.toDirectory(dir, (res: any) => {
      if (res && res.result === 'success') resolve();
      else reject(new Error((res && res.message) || 'Failed to write project file.'));
    });
  });
}
