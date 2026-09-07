import { filesystem } from '@xgenia/platform';
import { ProjectModel } from '../../../models/projectmodel';

// Real filesystem operations for the Asset panel. Mirrors the LOGIC of the backend
// manage_asset tool (.trash recycle bin, sanitize, conflict checks) but translated to
// the in-process @xgenia/platform `filesystem` singleton (Electron real disk). Every
// destructive op asserts the resolved path stays under <project>/assets.

function projectRoot(): string {
  const root = ProjectModel.instance?._retainedProjectDirectory;
  if (!root) throw new Error('No project is open');
  return String(root);
}

function assertUnderAssets(root: string, abs: string): void {
  const assetsRoot = filesystem.join(root, 'assets');
  if (abs !== assetsRoot && !abs.startsWith(assetsRoot + '/') && !abs.startsWith(assetsRoot + '\\')) {
    throw new Error(`Refusing to operate outside assets/: ${abs}`);
  }
}

/** Split "name.ext" into ["name", ".ext"]; folders / dotfiles → ["whole", ""]. */
function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  if (i <= 0) return [name, ''];
  return [name.slice(0, i), name.slice(i)];
}

function trashTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Move an asset (file or folder) to <project>/.trash with a timestamped, collision-free
 * name. Recoverable, mirrors the AI tool. `relPath` must be project-relative ('assets/...').
 */
export async function deleteToTrash(relPath: string): Promise<void> {
  if (!filesystem) throw new Error('Filesystem unavailable');
  const root = projectRoot();

  const abs = filesystem.join(root, relPath);
  assertUnderAssets(root, abs);
  if (!filesystem.exists(abs)) return; // already gone — treat as success

  const trashDir = filesystem.join(root, '.trash');
  if (!filesystem.exists(trashDir)) {
    await filesystem.makeDirectory(trashDir);
  }

  const base = relPath.split('/').pop() || relPath;
  const [stem, ext] = splitExt(base);
  const stamp = trashTimestamp();

  // Same-millisecond multi-delete collides; renameFile would silently overwrite, so
  // bump a counter until the trash target is unique.
  let target = filesystem.join(trashDir, `${stem}.${stamp}${ext}`);
  let n = 1;
  while (filesystem.exists(target)) {
    target = filesystem.join(trashDir, `${stem}.${stamp}-${n}${ext}`);
    n++;
  }

  await filesystem.renameFile(abs, target);
}

/** Sanitize a user-entered name: no path separators, no traversal, trimmed. */
function sanitizeName(name: string): string {
  return (name || '').replace(/\.\./g, '').replace(/[/\\]/g, '').trim();
}

/**
 * Rename a file or folder in place. `relPath` is project-relative ('assets/...').
 * Throws on empty/duplicate names; refuses to escape assets/.
 */
export async function renameAsset(relPath: string, newName: string): Promise<string> {
  if (!filesystem) throw new Error('Filesystem unavailable');
  const root = projectRoot();

  const clean = sanitizeName(newName);
  if (!clean) throw new Error('Name cannot be empty');

  const abs = filesystem.join(root, relPath);
  assertUnderAssets(root, abs);
  if (!filesystem.exists(abs)) throw new Error('Asset no longer exists');

  const parent = relPath.split('/').slice(0, -1).join('/');
  const newRel = parent ? `${parent}/${clean}` : clean;
  if (newRel === relPath) return relPath;

  const target = filesystem.join(filesystem.dirname(abs), clean);
  assertUnderAssets(root, target);
  if (filesystem.exists(target)) throw new Error(`"${clean}" already exists in this folder`);

  await filesystem.renameFile(abs, target);
  return newRel;
}

/**
 * Move a file or folder INTO another folder. `relPath` is project-relative ('assets/...');
 * `destFolderRel` is the target folder ('assets' or 'assets/sub'). Returns the new
 * project-relative path. No-op if already there; refuses to move a folder into itself or a
 * descendant, to overwrite an existing entry, or to escape assets/.
 */
export async function moveAsset(relPath: string, destFolderRel: string): Promise<string> {
  if (!filesystem) throw new Error('Filesystem unavailable');
  const root = projectRoot();

  const abs = filesystem.join(root, relPath);
  assertUnderAssets(root, abs);
  if (!filesystem.exists(abs)) throw new Error('Asset no longer exists');

  const base = relPath.split('/').pop() || relPath;
  const destClean = (destFolderRel || 'assets').replace(/\/+$/, '');
  const newRel = `${destClean}/${base}`;
  if (newRel === relPath) return relPath; // already in that folder

  if (destClean === relPath || destClean.startsWith(relPath + '/')) {
    throw new Error('Cannot move a folder into itself');
  }

  const destAbs = filesystem.join(root, destClean);
  assertUnderAssets(root, destAbs);
  if (!filesystem.exists(destAbs)) throw new Error('Destination folder does not exist');

  const target = filesystem.join(destAbs, base);
  assertUnderAssets(root, target);
  if (filesystem.exists(target)) throw new Error(`"${base}" already exists in the destination`);

  await filesystem.renameFile(abs, target);
  return newRel;
}

/**
 * Create a new folder under `parentRelPath` ('assets' or 'assets/sub'). Returns the
 * final (possibly de-duplicated) folder name.
 */
export async function createFolder(parentRelPath: string, name: string): Promise<string> {
  if (!filesystem) throw new Error('Filesystem unavailable');
  const root = projectRoot();

  const base = sanitizeName(name) || 'New Folder';
  const parentAbs = filesystem.join(root, parentRelPath);
  assertUnderAssets(root, parentAbs);

  let candidate = base;
  let n = 1;
  while (filesystem.exists(filesystem.join(parentAbs, candidate))) {
    candidate = `${base} ${n}`;
    n++;
  }

  const target = filesystem.join(parentAbs, candidate);
  assertUnderAssets(root, target);
  await filesystem.makeDirectory(target);
  return candidate;
}

/**
 * Duplicate a file or folder next to itself ("foo copy.png", "foo copy 2.png").
 * `isFolder` is required because the platform FS has no file-vs-folder probe.
 * Returns the new name.
 */
export async function duplicate(relPath: string, isFolder: boolean): Promise<string> {
  if (!filesystem) throw new Error('Filesystem unavailable');
  const root = projectRoot();

  const abs = filesystem.join(root, relPath);
  assertUnderAssets(root, abs);
  if (!filesystem.exists(abs)) throw new Error('Asset no longer exists');

  const base = relPath.split('/').pop() || relPath;
  const [stem, ext] = isFolder ? [base, ''] : splitExt(base);
  const dir = filesystem.dirname(abs);

  // " copy", " copy 2", ... (NOT makeUniquePath — it appends '-N' to the full
  // string and would corrupt the extension, e.g. 'foo.png-1').
  let i = 0;
  let candidate = '';
  do {
    const suffix = i === 0 ? ' copy' : ` copy ${i + 1}`;
    candidate = `${stem}${suffix}${ext}`;
    i++;
  } while (filesystem.exists(filesystem.join(dir, candidate)));

  const target = filesystem.join(dir, candidate);
  assertUnderAssets(root, target);
  if (isFolder) await filesystem.copyFolder(abs, target);
  else await filesystem.copyFile(abs, target);
  return candidate;
}

/**
 * Copy OS files into the project's assets folder. `destRel` is project-relative and must
 * be `assets` or below. Electron 31 exposes `File.path` for dropped files; a File without
 * one (pasted, synthesized) is read and written instead. Name collisions get ` 2`, ` 3`, …
 * rather than silently overwriting an existing asset. Returns the project-relative paths
 * written, in the same order as `files`.
 */
export async function importFiles(files: FileList | File[], destRel: string = 'assets'): Promise<string[]> {
  if (!filesystem) throw new Error('Filesystem unavailable');
  const root = projectRoot();
  const destAbs = filesystem.join(root, destRel);
  assertUnderAssets(root, destAbs);
  if (!filesystem.exists(destAbs)) await filesystem.makeDirectory(destAbs);

  const written: string[] = [];
  for (const file of Array.from(files as ArrayLike<File>)) {
    const [base, ext] = splitExt(file.name);
    let candidate = file.name;
    let n = 2;
    while (filesystem.exists(filesystem.join(destAbs, candidate))) {
      candidate = `${base} ${n}${ext}`;
      n += 1;
    }
    const target = filesystem.join(destAbs, candidate);
    assertUnderAssets(root, target);
    const srcPath = (file as any).path as string | undefined;
    if (srcPath) {
      await filesystem.copyFile(srcPath, target);
    } else {
      await filesystem.writeFile(target, Buffer.from(await file.arrayBuffer()));
    }
    written.push(`${destRel}/${candidate}`.replace(/\\/g, '/'));
  }
  return written;
}

/** Reveal a file/folder in the OS file manager. Electron-only (caller must gate). */
export function revealInOS(relPath: string): void {
  if (!filesystem) throw new Error('Filesystem unavailable');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const shell = require('@electron/remote').shell;
  shell.showItemInFolder(filesystem.join(projectRoot(), relPath));
}
