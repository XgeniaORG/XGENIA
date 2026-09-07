/**
 * lobbyOperations.ts — everything the lobby actually does to the world.
 *
 * The React components below this file render and route events; every side effect — opening a
 * project, creating one, importing a folder, renaming, removing, revealing in Finder — lives
 * here. That split is the point: the old projects screen mixed jQuery DOM writes with
 * `filesystem.openDialog` calls and cloud-formation setup in one 1430-line class, so there was
 * no way to change the layout without touching project creation.
 *
 * These are ports of `ProjectsView`'s handlers, with the DOM removed and nothing else changed.
 * Anything a caller must react to comes back as a value or a thrown error, never as a mutation
 * of a hidden field.
 */

import { filesystem, platform } from '@xgenia/platform';

import { CloudServiceMetadata, ProjectModel } from '@xgenia-models/projectmodel';
import { setCloudServices } from '@xgenia-models/projectmodel.editor';
import { LocalProjectsModel, ProjectItem } from '@xgenia-utils/LocalProjectsModel';

import CloudFormation from '../../utils/cloudformation';
import { templateRegistry } from '../../utils/forge';
import type { TemplateItem } from '../../utils/forge/template/template';
import { tracker } from '../../utils/tracker';
import { ToastLayer } from '../ToastLayer/ToastLayer';
import { setPendingSeed } from '../../models/lobby/lobbySeed';

/** Where a new game came from. Only ever used for analytics and for the button's own label. */
export type CreateOrigin = 'blank' | 'template' | 'remix' | 'ai';

export interface CreateGameArgs {
  name: string;
  /** Folder the game is created in. Already unique; see `chooseFolder`. */
  path: string;
  origin: CreateOrigin;
  /** Zip URL for a template, or a project folder to copy for a remix. Blank projects have neither. */
  templateUrl?: string;
  cloudServicesTemplateUrl?: string;
  templateLabel?: string;
  /** Typed in the "Describe it" lane. Handed to the chat panel once the project opens. */
  description?: string;
}

/**
 * Load a project and hand it back for routing.
 *
 * Throws on failure so the caller decides what the screen does; the toast is raised here because
 * every caller wants the same one.
 */
export async function openProject(entry: ProjectItem): Promise<ProjectModel> {
  const activityId = 'opening-project';
  ToastLayer.showActivity('Opening project', activityId);

  try {
    const project = await LocalProjectsModel.instance.loadProject(entry);
    if (!project) throw new Error('Project failed to load');
    return project;
  } catch (e: any) {
    ToastLayer.showError("Couldn't load project.");
    throw e;
  } finally {
    ToastLayer.hideActivity(activityId);
  }
}

/**
 * Pick a folder and open whatever project is in it.
 *
 * Returns null when the picker was dismissed, which is not a failure and must not toast.
 */
export async function openProjectFromFolder(): Promise<ProjectModel | null> {
  const direntry = await filesystem.openDialog({ allowCreateDirectory: false });
  if (!direntry) return null;

  return openProjectAtPath(direntry);
}

/** Open a project folder by path. Used by the picker and by a drop onto the window. */
export async function openProjectAtPath(direntry: string): Promise<ProjectModel | null> {
  const activityId = 'opening-project';
  ToastLayer.showActivity('Opening project', activityId);

  try {
    const project = await LocalProjectsModel.instance.openProjectFromFolder(direntry);
    if (!project) throw new Error('No project in that folder');

    if (!project.name) project.name = filesystem.basename(direntry);
    return project;
  } catch {
    ToastLayer.showError('Could not open project');
    return null;
  } finally {
    ToastLayer.hideActivity(activityId);
  }
}

/**
 * Ask for a parent folder and return a unique path inside it for `name`.
 *
 * Returns null when dismissed. `makeUniquePath` is what stops a second "Neon Miami" from
 * landing on top of the first.
 */
export async function chooseFolder(name: string): Promise<string | null> {
  let parent: string | undefined;

  try {
    parent = await filesystem.openDialog({ allowCreateDirectory: true });
  } catch {
    return null;
  }

  if (!parent) return null;

  return filesystem.makeUniquePath(filesystem.join(parent, name || 'Untitled'));
}

/**
 * Create a game and return it, or null.
 *
 * Cloud services are set up after the project exists, exactly as the old flow did: a template
 * that declares `cloudServicesTemplateURL` gets a stack created for it, and a failure there
 * leaves the project on disk rather than rolling it back.
 */
export async function createGame(args: CreateGameArgs): Promise<ProjectModel | null> {
  const activityId = 'creating-project';
  ToastLayer.showActivity('Creating new game', activityId);

  try {
    const project = await new Promise<ProjectModel | null>((resolve) => {
      LocalProjectsModel.instance.newProject((p: ProjectModel) => resolve(p || null), {
        name: args.name,
        path: args.path,
        projectTemplate: args.templateUrl
      });
    });

    if (!project) {
      ToastLayer.showError('Could not create the game.');
      return null;
    }

    if (args.cloudServicesTemplateUrl) {
      try {
        const cloudServices = await prepareCloudServices(args);
        if (cloudServices) setCloudServices(project, cloudServices);
        else ToastLayer.showError('Failed to set up cloud services.');
      } catch {
        ToastLayer.showError('Failed to create cloud services for the game.');
      }
    }

    // The description the user typed is handed to the chat panel once the editor is up. See
    // models/lobby/lobbySeed.ts for why this is a stored intent rather than a direct call.
    if (args.description?.trim()) setPendingSeed(project.id, args.description.trim());

    tracker.track('Create New Project', {
      templateLabel: args.templateLabel,
      templateUrl: args.templateUrl,
      origin: args.origin
    });

    return project;
  } finally {
    ToastLayer.hideActivity(activityId);
  }
}

function prepareCloudServices(args: CreateGameArgs): Promise<CloudServiceMetadata> {
  const label = args.templateLabel || args.name;

  return new Promise((resolve, reject) => {
    new CloudFormation().setup({
      templateUrl: args.cloudServicesTemplateUrl,
      cloudServices: {
        name: `${label} cloud services`,
        desc: `Cloud services created for the ${label} project template`
      },
      success: resolve,
      error: reject
    });
  });
}

/** The template feed. Returns an empty list rather than throwing, so the sheet still renders. */
export async function listTemplates(): Promise<TemplateItem[]> {
  try {
    const templates = await templateRegistry.list({});
    // `type` marks the non-basic entries the old screen filtered out of the template grid.
    return (templates || []).filter((t) => (t as any).type === undefined);
  } catch (e: any) {
    console.warn('[lobby] Failed to fetch templates:', e?.message || e);
    return [];
  }
}

/** Rename in place. No-op for an unchanged or empty name. */
export function renameGame(id: string, name: string): void {
  const trimmed = (name || '').trim();
  if (!trimmed) return;

  const entry = LocalProjectsModel.instance.getProjectEntryWithId(id);
  if (!entry || entry.name === trimmed) return;

  LocalProjectsModel.instance.renameProject(id, trimmed);
}

/**
 * Drop entries from the list.
 *
 * The folders on disk are untouched — that is what `removeProject` does, and the confirm on the
 * card says so. This function exists so the wording and the behaviour cannot drift apart.
 */
export function removeGames(ids: string[]): void {
  for (const id of ids) LocalProjectsModel.instance.removeProject(id);
}

/** Reveal a game's folder in Finder / Explorer. */
export function revealGame(entry: ProjectItem): void {
  if (!entry?.retainedProjectDirectory) return;
  void platform.openExternal(`file://${entry.retainedProjectDirectory}`);
}

/** Open a URL in the user's browser. Every "↗" item in the help and account menus lands here. */
export function openExternal(url: string): void {
  void platform.openExternal(url);
}

/**
 * Copy a game into a new folder beside it and add it to the list.
 *
 * Implemented as a template creation whose "template" is the existing project directory:
 * `newProject` already knows how to copy a tree, skip `.git` and re-key the copy with a fresh
 * project id, which is exactly what a duplicate needs.
 */
export async function duplicateGame(entry: ProjectItem): Promise<ProjectModel | null> {
  if (!entry?.retainedProjectDirectory) return null;

  const name = `${entry.name} copy`;
  const path = filesystem.makeUniquePath(
    filesystem.join(filesystem.dirname(entry.retainedProjectDirectory), name)
  );

  const activityId = 'duplicating-project';
  ToastLayer.showActivity('Duplicating game', activityId);

  try {
    return await new Promise<ProjectModel | null>((resolve) => {
      LocalProjectsModel.instance.newProject((p: ProjectModel) => resolve(p || null), {
        name,
        path,
        projectTemplate: entry.retainedProjectDirectory
      });
    });
  } catch {
    ToastLayer.showError('Could not duplicate the game.');
    return null;
  } finally {
    ToastLayer.hideActivity(activityId);
  }
}

/**
 * A project template described by a URL, as `importFromUrl` used to build it.
 *
 * The deep link carries the zip plus optional name, thumbnail and cloud-formation URLs in its
 * query string. Parsing stays here so the sheet can be opened prefilled from it.
 */
export function parseImportUrl(uri: string): {
  projectURL: string;
  title: string;
  iconURL?: string;
  cloudServicesTemplateURL?: string;
} {
  let url = uri;
  const query: Record<string, string> = {};

  const q = url.indexOf('?');
  if (q !== -1) {
    for (const pair of url.slice(q + 1).split('&')) {
      const [k, v] = pair.split('=');
      if (k) query[k] = v;
    }
    url = url.slice(0, q);
  }

  return {
    projectURL: url,
    title: query.name !== undefined ? decodeURIComponent(query.name) : '',
    iconURL: query.thumb !== undefined ? decodeURIComponent(query.thumb) : undefined,
    cloudServicesTemplateURL: query.cf !== undefined ? decodeURIComponent(query.cf) : undefined
  };
}
