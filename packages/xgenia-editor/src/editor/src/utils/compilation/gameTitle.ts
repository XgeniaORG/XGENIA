/** The title the editor used to fall back to, and that some games saved as their own. */
export const OLD_DEFAULT_TITLE = 'XGENIA Viewer';

/**
 * The published page's title (the browser tab): the title set in Settings › Project, else the
 * game's own name. An unset title, or the old placeholder saved as one, used to publish every game
 * as "XGENIA Viewer".
 */
export function gameTitle(htmlTitle: string | undefined, projectName: string | undefined): string {
  const set = (htmlTitle || '').trim();
  if (set && set !== OLD_DEFAULT_TITLE) return set;
  return (projectName || '').trim() || OLD_DEFAULT_TITLE;
}
