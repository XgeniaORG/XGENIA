/**
 * Which dropped paths are game folders (a folder holding a project.json).
 *
 * (2026-10-07, tester report) Dropping a file — an image, a zip — onto the projects page left
 * "Opening project" up for good with no way back. Only a game FOLDER can be opened, so a drop is
 * checked here first, and one with no game folder in it starts nothing.
 */
export function gameFoldersIn(paths: string[], exists: (path: string) => boolean, join: (...parts: string[]) => string): string[] {
  return (paths || []).filter((p) => {
    if (!p) return false;
    try {
      return exists(join(p, 'project.json'));
    } catch {
      return false;
    }
  });
}

export const NOT_A_GAME_FOLDER = 'Drop a game folder here: the folder that holds its project.json.';
