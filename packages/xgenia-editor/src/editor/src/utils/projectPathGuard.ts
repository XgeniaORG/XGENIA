/**
 * Resolve a path the AI bridge was handed against the open project, refusing anything that lands
 * outside it: `..`, absolute paths elsewhere, a sibling folder that merely shares the prefix, and a
 * symlink inside the project that points out (the deepest existing ancestor is resolved for real).
 * The project's own root is resolved for real too, so a project reached through a symlink (/tmp on
 * macOS, a linked synced folder) still works.
 */
export function resolveInsideProject(projectDir: string | null | undefined, p: string, op: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  if (!projectDir) throw new Error(`FileSystem.${op} refused: no project is open, so nothing can be resolved safely.`);
  const root = path.resolve(projectDir);
  const resolved = path.resolve(root, p || '');
  let realRoot = root;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    /* a root that does not exist yet: lexical */
  }
  const within = (candidate: string, base: string) => candidate === base || candidate.startsWith(base + path.sep);
  // The deepest ancestor that is THERE — lstat, not existsSync: existsSync follows links, so a dangling
  // link (`notes -> /elsewhere/not-yet.txt`) read as absent, the walk climbed past it, and a write then
  // followed it out of the project.
  const present = (p2: string) => {
    try {
      fs.lstatSync(p2);
      return true;
    } catch {
      return false;
    }
  };
  let probe = resolved;
  while (probe !== path.dirname(probe) && !present(probe)) probe = path.dirname(probe);
  let check: string;
  try {
    check = path.resolve(fs.realpathSync(probe), path.relative(probe, resolved));
  } catch {
    // A link whose target cannot be resolved (dangling, or a loop): where it leads is unknown, so no.
    throw new Error(
      `FileSystem.${op} refused: "${p}" goes through a link that cannot be resolved; the AI bridge only follows links that stay inside the project.`
    );
  }
  if (!within(check, realRoot) || !within(resolved, root)) {
    throw new Error(
      `FileSystem.${op} refused: "${p}" resolves outside the project directory. The AI bridge may only touch files inside the open project.`
    );
  }
  return resolved;
}
