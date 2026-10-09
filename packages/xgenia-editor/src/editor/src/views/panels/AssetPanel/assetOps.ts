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
export async function deleteToTrash(relPath: string): Promise<string | null> {
  if (!filesystem) throw new Error('Filesystem unavailable');
  const root = projectRoot();

  const abs = filesystem.join(root, relPath);
  assertUnderAssets(root, abs);
  if (!filesystem.exists(abs)) return null; // already gone — treat as success

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
  return `.trash/${target.split(/[\\/]/).pop()}`;
}

/** Sanitize a user-entered name: no path separators, no traversal, trimmed. */
function sanitizeName(name: string): string {
  return (name || '').replace(/\.\./g, '').replace(/[/\\]/g, '').trim();
}

/**
 * Rename a file or folder in place. `relPath` is project-relative ('assets/...').
 * Throws on empty/duplicate names; refuses to escape assets/.
 */
export async function renameAsset(relPath: string, newName: string, opts?: { exact?: boolean }): Promise<string> {
  if (!filesystem) throw new Error('Filesystem unavailable');
  const root = projectRoot();

  // `exact` is for putting a file back under the name it really had (undo): that name came off the
  // disk, so only path separators are refused — `..` inside a name is not traversal without one.
  const clean = opts?.exact ? (/[/\\]/.test(newName) ? '' : newName) : sanitizeName(newName);
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

/** Open a project file in the OS default app (Preview for images). A browser tab is the wrong tool. */
export function openInDefaultApp(relPath: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  void require('@electron/remote').shell.openPath(filesystem.join(projectRoot(), relPath));
}

/** Reveal a file/folder in the OS file manager. Electron-only (caller must gate). */
export function revealInOS(relPath: string): void {
  if (!filesystem) throw new Error('Filesystem unavailable');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const shell = require('@electron/remote').shell;
  shell.showItemInFolder(filesystem.join(projectRoot(), relPath));
}

/** Copy files from absolute OS paths into `destRel` (same collision rule as importFiles). */
export async function importPaths(absPaths: string[], destRel: string = 'assets'): Promise<string[]> {
  const files = absPaths.map((p) => ({ name: p.split(/[\\/]/).pop() || 'file', path: p }) as unknown as File);
  return importFiles(files, destRel);
}

/** Native multi-file picker. Electron-only; resolves to [] when cancelled. */
export async function pickFilesToImport(): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { dialog, getCurrentWindow } = require('@electron/remote');
  const res = await dialog.showOpenDialog(getCurrentWindow(), {
    title: 'Import assets',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Assets', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'mov', 'ttf', 'otf', 'woff', 'woff2', 'json', 'atlas'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  return res?.canceled ? [] : res?.filePaths || [];
}

/**
 * Make an earlier version live again, without losing the current one.
 *
 * The current bytes are COPIED into `.trash` under the same `<folder_slug>_<name>.<stamp><ext>`
 * shape the AI's save uses, so they show up as the newest version and can be restored in turn.
 * Then the version's bytes are copied over the live path. The live path never changes, so every
 * graph reference — raw path or uid:// — shows the restored art. Metadata stays with the live path.
 */
export async function restoreVersion(liveRel: string, versionRel: string): Promise<string> {
  if (!filesystem) throw new Error('Filesystem unavailable');
  const root = projectRoot();

  const liveAbs = filesystem.join(root, liveRel);
  assertUnderAssets(root, liveAbs);
  const cleanVersion = versionRel.replace(/\.\./g, '').replace(/^\/+/, '');
  if (!cleanVersion.startsWith('.trash/') && !cleanVersion.startsWith('assets/')) {
    throw new Error('A version must live in .trash or assets/');
  }
  const versionAbs = filesystem.join(root, cleanVersion);
  if (!filesystem.exists(versionAbs)) throw new Error('That version is no longer on disk');

  const backupRel = await backupLiveToTrash(liveRel);
  await filesystem.copyFile(versionAbs, liveAbs);
  return backupRel;
}

/**
 * COPY the live bytes into `.trash` under the `<folder_slug>_<name>.<stamp><ext>` name the version
 * scanner reads, so the current art becomes the newest earlier version. Returns '' when there is no
 * live file. The live path and its metadata are untouched.
 */
export async function backupLiveToTrash(liveRel: string): Promise<string> {
  if (!filesystem) throw new Error('Filesystem unavailable');
  const root = projectRoot();
  const liveAbs = filesystem.join(root, liveRel);
  assertUnderAssets(root, liveAbs);
  if (!filesystem.exists(liveAbs)) return '';
  const trashDir = filesystem.join(root, '.trash');
  if (!filesystem.exists(trashDir)) await filesystem.makeDirectory(trashDir);
  const parts = liveRel.split('/');
  const [stem, ext] = splitExt(parts.pop() || 'asset');
  const slug = parts.join('_');
  let name = `${slug}_${stem}.${trashTimestamp()}${ext}`;
  while (filesystem.exists(filesystem.join(trashDir, name))) {
    // Same-millisecond collision. Wait for the stamp to move rather than invent a suffix the
    // version scanner's name pattern would not recognise.
    await new Promise((r) => setTimeout(r, 2));
    name = `${slug}_${stem}.${trashTimestamp()}${ext}`;
  }
  await filesystem.copyFile(liveAbs, filesystem.join(trashDir, name));
  return `.trash/${name}`;
}

/**
 * Downscale an image in place so its longest side is `maxSide` — Unity's Max Size, applied to the
 * file. The previous bytes are kept as a version first; the path, uid, placement and every graph
 * reference stay as they are (placement is fractions of the screen, so it is unaffected).
 * Always writes PNG bytes, so it refuses anything but .png rather than mislabel a JPEG.
 */
export async function downscaleImage(relPath: string, url: string, maxSide: number): Promise<{ width: number; height: number; scale: number; backup: string } | null> {
  if (!/\.png$/i.test(relPath)) throw new Error('Only PNG files can be downscaled in place');
  const { planDownscale } = await import('./assetImagePlan');
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    // The project web server sends Access-Control-Allow-Origin: *, so the canvas is not tainted.
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not load the image'));
    el.src = url;
  });
  const plan = planDownscale(img.naturalWidth, img.naturalHeight, maxSide);
  if (!plan) return null;
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas available');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, plan.width, plan.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the PNG');
  // Encode fully BEFORE backing up, so a failure here leaves no duplicate "version" behind.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const root = projectRoot();
  const abs = filesystem.join(root, relPath);
  assertUnderAssets(root, abs);
  const backup = await backupLiveToTrash(relPath);
  await filesystem.writeFile(abs, bytes as any);
  return { width: plan.width, height: plan.height, scale: plan.scale, backup };
}

/** Move a file out of `.trash` back to a live path. Refuses to overwrite. */
export async function restoreFromTrash(trashRel: string, liveRel: string): Promise<void> {
  const root = projectRoot();
  const from = filesystem.join(root, trashRel);
  const to = filesystem.join(root, liveRel);
  if (!trashRel.startsWith('.trash/')) throw new Error('Not a .trash path');
  assertUnderAssets(root, to);
  if (!filesystem.exists(from)) throw new Error(`${trashRel} is no longer in .trash`);
  if (filesystem.exists(to)) throw new Error(`${liveRel} already exists`);
  const dir = filesystem.dirname(to);
  if (!filesystem.exists(dir)) await filesystem.makeDirectory(dir);
  await filesystem.renameFile(from, to);
}

/** Remove a folder only if it is empty (undo of "New folder"). */
export async function removeEmptyFolder(relPath: string): Promise<void> {
  const root = projectRoot();
  const abs = filesystem.join(root, relPath);
  assertUnderAssets(root, abs);
  if (!filesystem.exists(abs)) return;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  await require('fs').promises.rmdir(abs); // throws ENOTEMPTY rather than deleting anything
}

/** Make a folder if it is not there (redo of "New folder" must never create "New Folder 1"). */
export async function ensureFolder(relPath: string): Promise<void> {
  const root = projectRoot();
  const abs = filesystem.join(root, relPath);
  assertUnderAssets(root, abs);
  if (!filesystem.exists(abs)) await filesystem.makeDirectory(abs);
}
