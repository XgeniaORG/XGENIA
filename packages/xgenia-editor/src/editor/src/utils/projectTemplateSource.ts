/**
 * Where a new project's files come from.
 *
 * `newProject({ projectTemplate })` is used two ways: a template's zip URL (the New game sheet), and
 * an existing game's FOLDER (the lobby's Duplicate and Remix). (2026-10-07) Every value went to
 * templateRegistry.download(), which fetches a zip over HTTP — a folder path cannot be fetched, the
 * rejection was never caught, and the caller's callback never ran: the copy folder stayed empty and
 * the "Duplicating game" toast never went away.
 */
export type TemplateSource = { kind: 'folder'; path: string } | { kind: 'download'; url: string };

/** A local folder that exists is copied as it is; anything else is a template to download. */
export function templateSource(projectTemplate: string, isExistingPath: (p: string) => boolean): TemplateSource {
  const looksLocal = /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(projectTemplate) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(projectTemplate);
  if (looksLocal && isExistingPath(projectTemplate)) return { kind: 'folder', path: projectTemplate };
  return { kind: 'download', url: projectTemplate };
}

/**
 * Whether a path being copied into the new project is kept: a game's git history is not.
 * The `.git` folder itself is skipped as well as what is inside it — an empty `.git` left in the
 * copy reads as a broken repository.
 */
export function keepInCopy(src: string, sep: string): boolean {
  return !src.includes(sep + '.git' + sep) && !src.endsWith(sep + '.git');
}
