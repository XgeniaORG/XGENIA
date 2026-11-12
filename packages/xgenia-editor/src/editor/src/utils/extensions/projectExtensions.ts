import { registerConflictPreview } from './conflictPreviews';

/**
 * Extension points for optional project extensions, loaded at build time through the
 * `@xgenia/project-extensions` alias (a stub that registers nothing when the module is absent).
 */

export interface PublishHook {
  id: string;
  /**
   * Runs before the project files are copied for a publish; returns globs to leave out.
   * Globs are relative to the project folder with forward slashes and match whole paths: `**` spans
   * folders, `*` and `?` stay inside one name. To leave out a folder use `dir/**` (`dir` alone matches
   * only a file named `dir`). No braces, character classes or negation.
   */
  prepare(projectDir: string): Promise<{ exclude: string[] }>;
}

export type ProjectEventType = 'opened' | 'pulled' | 'merged' | 'checkout' | 'reverted';
export interface ProjectEvent {
  type: ProjectEventType;
  projectDir: string;
}
export type ProjectEventListener = (e: ProjectEvent) => void | Promise<void>;

const publishHooks = new Map<string, PublishHook>();
const projectListeners = new Set<ProjectEventListener>();

/** Register a hook that runs before every publish. A hook with the same id replaces the earlier one. */
export function registerPublishHook(hook: PublishHook): void {
  publishHooks.set(hook.id, hook);
}

/** Tests only: forget every publish hook and project listener. */
export function resetProjectExtensionsForTests(): void {
  publishHooks.clear();
  projectListeners.clear();
}

/** Run every publish hook in registration order; returns all their exclude globs. A failing hook fails the publish. */
export async function runPublishHooks(projectDir: string): Promise<string[]> {
  const exclude: string[] = [];
  for (const hook of publishHooks.values()) {
    let result: { exclude?: string[] } | undefined;
    try {
      result = await hook.prepare(projectDir);
    } catch (e: any) {
      throw new Error(`Publish step "${hook.id}" failed: ${e?.message || String(e)}`);
    }
    for (const glob of result?.exclude || []) {
      if (typeof glob === 'string' && glob) exclude.push(glob);
    }
  }
  return exclude;
}

/** Listen for project events; returns a function that stops listening. */
export function onProjectEvent(fn: ProjectEventListener): () => void {
  projectListeners.add(fn);
  return () => {
    projectListeners.delete(fn);
  };
}

/** Tell every listener; one failing listener does not stop the others. */
export function emitProjectEvent(e: ProjectEvent): void {
  if (!e?.projectDir) return;
  for (const fn of Array.from(projectListeners)) {
    const warn = (err: unknown) => console.warn(`[projectExtensions] ${e.type} listener failed:`, err);
    try {
      Promise.resolve(fn(e)).catch(warn);
    } catch (err) {
      warn(err);
    }
  }
}

const globCache = new Map<string, RegExp>();

/** `**` spans folders, `*` and `?` stay inside one path segment. Patterns are project-relative. */
function globToRegExp(glob: string): RegExp {
  let re = globCache.get(glob);
  if (re) return re;
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  re = new RegExp('^' + out + '$');
  globCache.set(glob, re);
  return re;
}

/** Whether a project-relative path matches any of the exclude globs. */
export function isPublishExcluded(relativePath: string, exclude: ReadonlyArray<string>): boolean {
  if (!exclude.length) return false;
  const p = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return exclude.some((glob) => globToRegExp(glob).test(p));
}

export interface ProjectExtensionApi {
  registerMergeHandler: (...args: any[]) => unknown;
  registerConflictPreview: typeof registerConflictPreview;
  registerPublishHook: typeof registerPublishHook;
  onProjectEvent: typeof onProjectEvent;
}

interface LoadOptions {
  /** Loads the extension module; defaults to the build-time alias. */
  load?: () => { register?: (api: ProjectExtensionApi) => void | Promise<void> } | undefined;
  registerMergeHandler?: ProjectExtensionApi['registerMergeHandler'];
}

/** Load the optional extension module and let it register. Returns whether a module registered. */
export function loadProjectExtensions(options: LoadOptions = {}): boolean {
  let mod: { register?: (api: ProjectExtensionApi) => void | Promise<void> } | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = options.load ? options.load() : require('@xgenia/project-extensions');
  } catch {
    return false; // not in this build
  }
  if (!mod || typeof mod.register !== 'function') return false;

  try {
    const api: ProjectExtensionApi = {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      registerMergeHandler: options.registerMergeHandler ?? require('@xgenia/git').registerMergeHandler,
      registerConflictPreview,
      registerPublishHook,
      onProjectEvent
    };
    Promise.resolve(mod.register(api)).catch((e) => console.warn('[projectExtensions] register failed:', e));
    return true;
  } catch (e) {
    console.warn('[projectExtensions] register failed:', e);
    return false;
  }
}
