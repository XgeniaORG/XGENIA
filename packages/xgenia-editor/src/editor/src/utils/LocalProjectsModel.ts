import path from 'node:path';
import { GitStore } from '@xgenia-store/GitStore';
import { isEqual } from 'underscore';
import {
  // RequestGitAccountFuncReturn,
  setRequestGitAccount
} from '@xgenia/git/src/core/trampoline/trampoline-askpass-handler';
import { filesystem, platform } from '@xgenia/platform';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { templateRegistry } from '@xgenia-utils/forge';

import Model from '../../../shared/model';
import { projectFromDirectory, unzipIntoDirectory } from '../models/projectmodel.editor';
import { makeTile } from './thumbnails/thumbnail-tile';
import { planThumbnailWrite, saveThumbnailFile, type ThumbnailFileIO } from './thumbnails/thumbnail-store';
import { needsTitleCard, shouldCaptureCanvas, type ThumbnailSource } from './thumbnails/thumbnail-policy';
import FileSystem from './filesystem';
import { tracker } from './tracker';
import { guid } from './utils';
import { getTopLevelWorkingDirectory } from '@xgenia/git/src/core/open';

// Simple localStorage-based store for WEB_MODE (mimics electron-store interface)
class WebStore {
  private storeName: string;
  constructor(opts: { name: string }) {
    this.storeName = opts.name;
  }
  get(key: string): any {
    try {
      const raw = localStorage.getItem(`${this.storeName}:${key}`);
      return raw ? JSON.parse(raw) : undefined;
    } catch { return undefined; }
  }
  set(key: string, value: any): void {
    try {
      localStorage.setItem(`${this.storeName}:${key}`, JSON.stringify(value));
    } catch (e) {
      console.warn('[WebStore] Failed to persist:', e);
    }
  }
}

function createStore(opts: { name: string }) {
  if (process.env.WEB_MODE) {
    return new WebStore(opts);
  }
  const Store = require('electron-store');
  return new Store(opts);
}

export interface ProjectItem {
  id: string;
  name: string;
  latestAccessed: number;
  /**
   * Inline thumbnail. Legacy entries, and the WEB_MODE fallback — see thumbnail-store.ts.
   * Prefer `thumbPath`; read both through `resolveThumbSrc` rather than either directly.
   */
  thumbURI: string;
  /** Path to the thumbnail on disk. Written since 2026-08-22. */
  thumbPath?: string;
  /** What last wrote the thumbnail. See utils/thumbnails/thumbnail-policy. */
  thumbSource?: ThumbnailSource;
  /** The style anchor a title card was built from. */
  thumbAnchorId?: string;
  retainedProjectDirectory: string;
}
export class LocalProjectsModel extends Model {
  public static instance = new LocalProjectsModel();

  projectEntries: ProjectItem[] = [];

  private recentProjectsStore = createStore({
    name: 'recently_opened_project'
  });

  /**
   * How much of a project's thumbnail we are willing to keep in this file.
   *
   * 2026-08-12. `recently_opened_project.json` is a settings file, and it was
   * holding a full-resolution PNG data URL per project, forever. Measured on
   * real profiles: 7.7MB across 21 entries packaged, and **120MB across 272
   * entries** in dev — 99.9% and 100% `thumbURI` respectively. electron-store is
   * backed by `conf`, which has no cache: `get store()` is a bare `readFileSync`,
   * so a single `set()` is a full read + parse + stringify + atomic whole-file
   * write, synchronously, on the renderer's main thread. Driven by a 20-second
   * thumbnail interval, that is a multi-second freeze three times a minute.
   *
   * ─── AND IT DELETED EVERY COVER IMAGE (2026-08-22) ───────────────────────
   * This cap was the stopgap, and the comment here named the durable fix: write to
   * `userData/thumbs/<id>.png` and keep a path. The stopgap did not survive contact with
   * 458aea9, which had already raised the capture to a 1024px short side so the AI's vision
   * pass could read UI detail off it. A 1024-short-side PNG of a game screen is 200KB-2MB, so
   * `cappedThumb` returned '' for essentially every capture and the home screen went blank:
   * 13 of the 14 most recently opened projects held a zero-length thumbURI, the survivor being
   * a near-empty screen at 44KB. Nothing threw and nothing logged.
   *
   * So the durable fix is now in place — see thumbnails/thumbnail-store.ts. Thumbnails go to
   * disk and the entry keeps a path. This limit still applies to the WEB_MODE fallback, which
   * has no thumbnail directory, but it now measures a ~30KB tile rather than a full capture,
   * and a value over it is reported instead of being silently swallowed.
   */
  private static readonly MAX_THUMB_BYTES = 96 * 1024;

  /**
   * Where thumbnails are written, or null on a platform that has no such directory.
   *
   * electron-store puts `recently_opened_project.json` in userData and exposes its own path, so
   * the thumbs directory is derived from it rather than reaching for electron's `app` from the
   * renderer. WebStore has no path, which is exactly the "no file store" case.
   */
  private get thumbnailIO(): ThumbnailFileIO | null {
    const storePath = (this.recentProjectsStore as any)?.path;
    if (!storePath || typeof storePath !== 'string') return null;

    return {
      dir: path.join(path.dirname(storePath), 'thumbs'),
      join: (...parts: string[]) => path.join(...parts),
      makeDirectory: (p: string) => filesystem.makeDirectory(p),
      writeFile: (p: string, blob: Buffer | string) => filesystem.writeFileOverride(p, blob)
    };
  }

  /**
   * Point an entry at a newly captured thumbnail.
   *
   * Returns whether anything changed, so callers can avoid a whole-file rewrite for a capture
   * that stored nothing. Every failure leaves the previous cover art in place: a thumbnail is
   * decoration, and losing the new one must never also lose the old one.
   */
  private async applyThumbnail(
    entry: ProjectItem,
    captured: string | undefined,
    meta?: { source?: ThumbnailSource; anchorId?: string }
  ): Promise<boolean> {
    if (!captured) return false;

    const source: ThumbnailSource = meta?.source || 'capture';

    // A capture must not overwrite a title card. The periodic hook already checks this before
    // spending a `capturePage`, but the rule is enforced here too: this is the only door into
    // the stored thumbnail, and a rule that lives only at the caller is a rule with one hole
    // per caller.
    if (source === 'capture' && !shouldCaptureCanvas(entry)) return false;

    const io = this.thumbnailIO;

    // The capture is sized for the AI's vision pass, not for a card on the home screen.
    // Derive the tile once, here, so both storage paths carry the same small image.
    const tile = await makeTile(captured);

    const plan = planThumbnailWrite({
      dataUri: tile,
      hasFileStore: !!io,
      maxInlineBytes: LocalProjectsModel.MAX_THUMB_BYTES
    });

    if (plan.kind === 'drop') {
      console.warn(`[LocalProjectsModel] Thumbnail not stored for "${entry.name}": ${plan.reason}`);
      return false;
    }

    const ownershipChanged = entry.thumbSource !== source || entry.thumbAnchorId !== meta?.anchorId;
    entry.thumbSource = source;
    if (meta?.anchorId) entry.thumbAnchorId = meta.anchorId;
    else delete entry.thumbAnchorId;

    if (plan.kind === 'inline') {
      if (entry.thumbURI === plan.uri && !entry.thumbPath && !ownershipChanged) return false;
      entry.thumbURI = plan.uri;
      delete entry.thumbPath;
      return true;
    }

    const written = await saveThumbnailFile(io!, entry.id, tile);
    if (!written) return false;

    // The bytes changed even though the path did not, so the entry is only rewritten when the
    // path itself is new. The file on disk is already current either way.
    const pathChanged = entry.thumbPath !== written;
    entry.thumbPath = written;

    // A legacy inline copy is dead weight once the file exists, and dropping it is what
    // actually drains `recently_opened_project.json`.
    const hadInline = !!entry.thumbURI;
    if (hadInline) entry.thumbURI = '';

    return pathChanged || hadInline || ownershipChanged;
  }

  /**
   * Whether the periodic canvas capture may write this project's thumbnail.
   * Read by UseCaptureThumbnails before it spends a `capturePage`.
   */
  mayCaptureThumbnail(projectId: string): boolean {
    return shouldCaptureCanvas(this.getProjectEntryWithId(projectId));
  }

  /**
   * Whether a title card should be generated for `anchorId`.
   *
   * The AI asks this over the bridge rather than deciding for itself, so the editor stays the
   * single authority on who owns the cover art.
   */
  needsTitleCardFor(projectId: string, anchorId: string | undefined): boolean {
    return needsTitleCard(this.getProjectEntryWithId(projectId), anchorId);
  }

  /**
   * Move thumbnails that predate the file store out of the settings file. Runs once.
   *
   * Without this, nothing shrinks: the 103MB measured on the reporting machine is 305 entries
   * of inline data URI, and entries are only rewritten as projects are reopened, so a project
   * never touched again keeps its megabyte forever. Every write of the file re-serialises all
   * of it, so this is the difference between a multi-second freeze and a rewrite of some text.
   *
   * Deliberately chunked and unawaited. It runs after the list has already been shown, decodes
   * each image on a canvas to derive the same 512px tile a fresh capture would produce, and
   * yields between chunks so a 300-entry profile does not block the first paint.
   */
  private async migrateInlineThumbnails(): Promise<void> {
    if (!this.thumbnailIO) return; // WEB_MODE keeps its inline thumbnails; there is nowhere to go
    if (this.recentProjectsStore.get('thumbsMigratedV1')) return;

    try {
      const pending = (this.projectEntries || []).filter((e) => e.thumbURI && !e.thumbPath);

      for (let i = 0; i < pending.length; i += 5) {
        const chunk = pending.slice(i, i + 5);
        await Promise.all(chunk.map((entry) => this.applyThumbnail(entry, entry.thumbURI).catch(() => false)));
        // Yield to the renderer between chunks.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (pending.length) {
        this.markDirty();
        this.store();
        this.notifyListeners('myProjectsChanged');
      }

      // Set last. A crash midway leaves the flag unset, so the next launch finishes the job —
      // entries already moved are skipped by the `!e.thumbPath` filter.
      this.recentProjectsStore.set('thumbsMigratedV1', true);
      if (pending.length) console.log(`[LocalProjectsModel] Moved ${pending.length} thumbnail(s) out of the settings file.`);
    } catch (e: any) {
      console.warn('[LocalProjectsModel] Thumbnail migration failed:', e?.message || e);
    }
  }

  /** Whether `projectEntries` differs from what is on disk. */
  private dirty = false;

  async fetch() {
    // Fetch projects from local storage and verify project folders
    const folders = (this.recentProjectsStore.get('recentProjects') || []) as ProjectItem[];

    const existingFolders = folders.filter((x) => filesystem.exists(x.retainedProjectDirectory));

    existingFolders.sort((a, b) => b.latestAccessed - a.latestAccessed);

    if (!this.projectEntries || (this.projectEntries && !isEqual(this.projectEntries, existingFolders))) {
      this.projectEntries = existingFolders;
      this.markDirty();
      this.store();

      this.notifyListeners('myProjectsChanged');
    }

    // Unawaited on purpose: the list is already rendered from the entries above, and legacy
    // entries keep rendering off their inline URI until they are moved.
    void this.migrateInlineThumbnails();
  }

  // Store model to local storage
  store() {
    if (!this.projectEntries) return; // Don't store if projects are not loaded

    // Every write is a full read + parse + stringify + atomic rewrite of the
    // whole file (see MAX_THUMB_BYTES). Callers fire this from event handlers
    // that often change nothing, so the cheapest correct thing is not to write.
    if (!this.dirty) return;
    this.dirty = false;

    this.recentProjectsStore.set('recentProjects', this.projectEntries);
  }

  /** Mark the entries as needing a write. Anything that mutates them must call this. */
  private markDirty() {
    this.dirty = true;
  }

  containsProjectWithId(id) {
    return !!this.projectEntries.find((p) => p.id === id);
  }

  // Get all project directories, sorted
  getProjects() {
    return this.projectEntries;
  }

  getProjectEntryWithId(id: string): ProjectItem {
    return this.projectEntries.find((p) => p.id === id);
  }

  // Update latests accessed time for project
  touchProject(projectEntry: ProjectItem) {
    projectEntry.latestAccessed = Date.now();
    this.markDirty();
    this.store();
    this.notifyListeners('myProjectsChanged');
  }

  // Load a project
  loadProject(projectEntry: ProjectItem) {
    tracker.track('Load Local Project');

    return new Promise<ProjectModel>((resolve, reject) => {
      projectFromDirectory(
        projectEntry.retainedProjectDirectory,
        (project) => {
          if (!project) {
            resolve(null);
            return;
          }
          // console.log('Loaded project', projectEntry);
          project.id = projectEntry.id; // Assign the project the id stored in the project dir entry
          project.name = projectEntry.name; // Also assign the name
          this.touchProject(projectEntry);
          this.bindProject(project);
          resolve(project);
        },
        { showUpgradeModal: false } // Upgrades now happen automatically in background
      );
    });
  }

  // Bind to a loaded project, update model when renamed of when the thumbnail is updated
  bindProject(project: ProjectModel) {
    project
      .off(this)
      .on(
        'renamed',
        () => {
          const projectdir = this.getProjectEntryWithId(project.id);

          if (projectdir) {
            this.renameProject(project.id, project.name ? project.name : 'Untitled');
            project._retainedProjectDirectory = projectdir.retainedProjectDirectory;
          }
        },
        this
      )
      .on(
        'thumbnailChanged',
        (meta?: { source?: ThumbnailSource; anchorId?: string }) => {
          const projectdir = this.getProjectEntryWithId(project.id);
          // `this.store()` used to sit OUTSIDE this guard, so a thumbnail change
          // for a project that has no entry here still rewrote the whole file.
          if (!projectdir) return;

          // Async because the tile is drawn on a canvas and the file is written off the main
          // thread. Nothing waits on a thumbnail, so this is deliberately not awaited — but
          // every rejection must still be caught, or a failed disk write becomes an unhandled
          // rejection in the renderer.
          this.applyThumbnail(projectdir, project.getThumbnailURI(), meta)
            .then((changed) => {
              if (!changed) return; // nothing to record; don't rewrite the whole settings file
              this.markDirty();
              this.store();
            })
            .catch((e) => console.warn('[LocalProjectsModel] Thumbnail update failed:', e?.message || e));
        },
        this
      );
  }

  renameProject(id: string, name: string) {
    const projectEntry = this.getProjectEntryWithId(id);
    if (!projectEntry) return;

    projectEntry.name = name;
    this.markDirty();
    this.store();
    this.notifyListeners('myProjectsChanged');
  }

  // Create a new project dir entry
  _addProject(project: ProjectModel) {
    if (!project._retainedProjectDirectory) return;

    // Push directory entry
    const id = guid();
    const entry: ProjectItem = {
      retainedProjectDirectory: project._retainedProjectDirectory,
      latestAccessed: Date.now(),
      id: id, // Generate a new project id (will be used internally to store project specific local settings)
      name: project.name ? project.name : 'Untitled',
      thumbURI: ''
    };
    this.projectEntries.push(entry);
    project.id = id;

    // A brand new project usually has no thumbnail yet, and the first capture will arrive on
    // `thumbnailChanged`. When one is already present (a duplicated or imported project) it goes
    // through exactly the same path as every other capture rather than a second, sync one that
    // could disagree about where thumbnails live.
    this.applyThumbnail(entry, project.getThumbnailURI())
      .then((changed) => {
        if (!changed) return;
        this.markDirty();
        this.store();
        this.notifyListeners('myProjectsChanged');
      })
      .catch((e) => console.warn('[LocalProjectsModel] Thumbnail for new project failed:', e?.message || e));

    // Store the project model
    this.bindProject(project);

    this.markDirty();
    this.store();
    this.notifyListeners('myProjectsChanged');
  }

  removeProject(projectId: string) {
    const idx = this.projectEntries.findIndex((p) => p.id === projectId);
    if (idx !== -1) {
      this.projectEntries.splice(idx, 1);
      this.markDirty();
      this.store();
      this.notifyListeners('myProjectsChanged');
    }
  }

  // Given a path to the project zip file locally, unzip it and launch the
  // editor
  _unzipAndLaunchProject(path, dirEntry, fn, options) {
    unzipIntoDirectory(
      path,
      dirEntry,
      (r) => {
        if (r.result !== 'success') {
          fn(r);
          return;
        }

        // Project successfully created
        r.project.name = options.name || 'Untitled';
        this._addProject(r.project);
        fn(r.project);
      },
      { noAuth: true }
    );
  }

  async newProject(
    fn,
    options: {
      name?: string;
      projectTemplate?: string;
      path?: string;
    }
  ) {
    tracker.track('New Local Project');

    const name = options?.name || 'Untitled';
    const dirEntry = options?.path || filesystem.makeUniquePath(platform.getDocumentsPath() + name);

    await filesystem.makeDirectory(dirEntry);

    const projectTemplate = options?.projectTemplate;

    if (projectTemplate) {
      const templatePath = await templateRegistry.download({ templateUrl: projectTemplate });

      // Copy unzipped project template
      if (process.env.WEB_MODE) {
        await filesystem.copyFolder(templatePath, dirEntry);
      } else {
        FileSystem.instance.copyRecursiveSync(templatePath, dirEntry, {
          filter(src) {
            //ignore all files in .git/
            return !src.includes(path.sep + '.git' + path.sep);
          }
        });
      }

      // Project extracted successfully, load it
      projectFromDirectory(
        dirEntry,
        (project) => {
          if (!project) {
            fn();
            return;
          }

          project.name = name; //update the name from the template

          // Store the project, this will make it a unique project by
          // forcing it to generate a project id
          this._addProject(project);
          project.toDirectory(project._retainedProjectDirectory, (res) => {
            if (res.result === 'success') {
              fn(project);
            } else {
              fn();
            }
          });
        },
        { showUpgradeModal: false } // Upgrades happen automatically in background
      );
    } else {
      // No template — write a minimal project.json, then load via projectFromDirectory
      const minimalProject = {
        name,
        version: '4',
        settings: {},
        components: [
          {
            name: '/App',
            graph: {
              roots: [{ id: 'root-node', type: 'Group', x: 0, y: 0, parameters: {}, ports: [], children: [] }],
              connections: []
            }
          }
        ],
        rootNodeId: 'root-node'
      };
      await filesystem.writeJson(dirEntry + '/project.json', minimalProject);

      projectFromDirectory(
        dirEntry,
        (project) => {
          if (!project) {
            console.error('[LocalProjectsModel] Failed to create blank project at', dirEntry);
            fn();
            return;
          }

          project.name = name;
          this._addProject(project);
          project.toDirectory(project._retainedProjectDirectory, (res) => {
            if (res.result === 'success') {
              fn(project);
            } else {
              console.error('[LocalProjectsModel] Failed to save blank project:', res);
              fn();
            }
          });
        },
        { showUpgradeModal: false }
      );
    }
  }

  openProjectFromFolder(direntry: string): Promise<ProjectModel> {
    //check if this project is already in the list and if so just open it
    const projectEntry = this.projectEntries.find((p) => p.retainedProjectDirectory === direntry);
    if (projectEntry) {
      return this.loadProject(projectEntry);
    }

    //project isn't in the list, add it
    return new Promise((resolve, reject) => {
      projectFromDirectory(
        direntry,
        (project) => {
          if (!project) {
            reject(null);
            return;
          }

          this._addProject(project);
          resolve(project);
        },
        { showUpgradeModal: false } // Upgrades now happen automatically in background
      );
    });
  }

  /**
   * Check if this project is in a git repository.
   *
   * @param project 
   * @returns 
   */
  async isGitProject(project: ProjectModel): Promise<boolean> {
    const gitPath = await getTopLevelWorkingDirectory(project._retainedProjectDirectory);
    return gitPath !== null;
  }

  setCurrentGlobalGitAuth(projectId: string) {
    const func = async (endpoint: string) => {
      if (endpoint.includes('github.com')) {
        const config = await GitStore.get('github', projectId);
        //username is not used by github when using a token, but git will still ask for it. Just set it to "xgenia"
        return {
          username: 'xgenia',
          password: config?.password
        };
      } else {
        const config = await GitStore.get('unknown', projectId);
        return {
          username: config?.username,
          password: config?.password
        };
      }
    };

    setRequestGitAccount(func);
  }
}