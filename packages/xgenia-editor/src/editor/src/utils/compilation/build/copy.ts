import { filesystem, FileInfo } from '@xgenia/platform';

import { clearFolders } from './cleanup';

export async function copyProjectFilesToFolder(projectPath: string, direntry: string): Promise<void> {
  // TODO: Load something like .xgeniaignore file list
  const ignoreFiles = ['.DS_Store', '.gitignore', '.gitattributes', 'project.json', 'Dockerfile'];

  // Copy everything from the project folder
  if (!projectPath) {
    throw new Error('Couldnt open project folder.');
  }

  await filesystem.makeDirectory(direntry);

  let files = await filesystem.listDirectoryFiles(projectPath);
  files = files.filter((f) => {
    if (ignoreFiles.indexOf(f.name) !== -1) return false;
    // TODO: Make this easier to access
    if (f.fullPath.indexOf('.git') !== -1) return false; // Ignore git files
    if (f.fullPath.indexOf('.xgenia') !== -1) return false; // Ignore xgenia files

    return true;
  });

  // First clear all folders, will be recreated later
  await clearFolders({
    projectPath,
    outputPath: direntry,
    files
  });

  let filesLeftToCopy = 0;
  let totalSuccess = true;
  function fileCompleted(success: boolean) {
    filesLeftToCopy--;
    totalSuccess = totalSuccess && success;
  }

  async function makeDirectoryAndCopyFile(f: FileInfo) {
    // TODO: This requires that the project path is looking nice
    // Example:
    // C:\\Users\\Eric\\AppData\\Roaming\\Xgenia\\projects\\9acdd495-3d92-4490-ae0a-44f17bf47dca
    // C:\Users\Eric\AppData\Roaming\Xgenia\projects\9acdd495-3d92-4490-ae0a-44f17bf47dca\xgenia_modules\
    //                                                                       it will cut here ^
    const folderPath = f.fullPath.substring(projectPath.length, f.fullPath.length - f.name.length - 1);
    const localPath = f.fullPath.substring(projectPath.length);
    filesLeftToCopy++;

    const targetDir = filesystem.join(direntry, folderPath);
    await filesystem.makeDirectory(targetDir);

    try {
      await filesystem.copyFile(f.fullPath, direntry + '/' + localPath);
      fileCompleted(true);
    } catch (error: any) {
      console.error(error);
      fileCompleted(false);
    }
  }

  const tasks = files.map(makeDirectoryAndCopyFile);

  await Promise.all(tasks);

  if (!totalSuccess) {
    throw new Error('Failed to copy project files.');
  }
}

/**
 * Copy all project files into a single flat folder (no sub-folders),
 * using simple filename sanitization suitable for Stake.com.
 *
 * This keeps the existing project folder logic intact and is only used
 * by the Stake deploy flow.
 */
export async function copyProjectFilesToFlatFolderStake(
  projectPath: string,
  direntry: string
): Promise<Record<string, string>> {
  // TODO: Load something like .xgeniaignore file list
  const ignoreFiles = ['.DS_Store', '.gitignore', '.gitattributes', 'project.json', 'Dockerfile'];

  if (!projectPath) {
    throw new Error('Couldnt open project folder.');
  }

  await filesystem.makeDirectory(direntry);

  let files = await filesystem.listDirectoryFiles(projectPath);
  files = files.filter((f) => {
    if (ignoreFiles.indexOf(f.name) !== -1) return false;
    if (f.fullPath.indexOf('.git') !== -1) return false;
    if (f.fullPath.indexOf('.xgenia') !== -1) return false;

    return true;
  });

  let filesLeftToCopy = 0;
  let totalSuccess = true;

  function fileCompleted(success: boolean) {
    filesLeftToCopy--;
    totalSuccess = totalSuccess && success;
  }

  function sanitizeStakeFileName(name: string): string {
    // Stake hosting is case-sensitive and URLs may be percent-encoded.
    // Normalize aggressively to avoid "works on Windows localhost, 404 on Linux/Stake".
    //
    // - Lowercase everything
    // - Replace spaces with underscores
    // - Convert "name (1).ext" -> "name_1.ext"
    // - Replace unsafe characters with underscores
    const lowered = (name || '').toLowerCase();
    const noParen = lowered.replace(/\s+\((\d+)\)(\.[^.]*)$/, '_$1$2');
    const spaces = noParen.replace(/\s+/g, '_');
    // Keep common safe URL filename chars
    return spaces.replace(/[^a-z0-9._-]/g, '_');
  }

  const usedNames = new Map<string, number>();
  const flatMap: Record<string, string> = {};

  const isTextLike = (name: string) => {
    const lower = name.toLowerCase();
    return (
      lower.endsWith('.js') ||
      lower.endsWith('.mjs') ||
      lower.endsWith('.cjs') ||
      lower.endsWith('.css') ||
      lower.endsWith('.html') ||
      lower.endsWith('.htm') ||
      lower.endsWith('.json') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.txt') ||
      lower.endsWith('.map')
    );
  };

  const normalizePosixPath = (p: string): string => {
    let s = (p || '').replace(/\\/g, '/');
    if (s.startsWith('./')) s = s.substring(2);
    s = s.replace(/\/+/g, '/');

    const parts = s.split('/');
    const out: string[] = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        out.pop();
        continue;
      }
      out.push(part);
    }
    return out.join('/');
  };

  const safeDecode = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  const dirnamePosix = (p: string): string => {
    const s = normalizePosixPath(p);
    const idx = s.lastIndexOf('/');
    return idx >= 0 ? s.substring(0, idx) : '';
  };

  const joinPosix = (a: string, b: string): string => {
    if (!a) return normalizePosixPath(b);
    if (!b) return normalizePosixPath(a);
    return normalizePosixPath(a.replace(/\/$/, '') + '/' + b.replace(/^\//, ''));
  };

  const mapRefPath = (ref: string, baseDir: string): string | null => {
    if (!ref) return null;
    if (/^(https?:)?\/\//i.test(ref) || ref.startsWith('data:')) return null;

    const m = ref.match(/^([^?#]+)([?#].*)?$/);
    const rawPath = m ? m[1] : ref;
    const suffix = m && m[2] ? m[2] : '';

    const trimmed = rawPath.trim();
    const candidate = trimmed.startsWith('/')
      ? normalizePosixPath(trimmed.substring(1))
      : joinPosix(baseDir, trimmed);

    const candidates = [
      candidate,
      safeDecode(candidate),
      candidate.toLowerCase(),
      safeDecode(candidate).toLowerCase()
    ].filter(Boolean);
    for (const c of candidates) {
      const mapped = flatMap[c];
      if (mapped) return mapped + suffix;
    }

    return null;
  };

  const rewriteTextContent = (content: string, localPath: string): string => {
    const baseDir = dirnamePosix(localPath);

    // CSS url(...)
    content = content.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (full, q, ref) => {
      const mapped = mapRefPath(ref, baseDir);
      if (!mapped) return full;
      return `url(${q || ''}${mapped}${q || ''})`;
    });

    // HTML src/href attributes
    content = content.replace(/\b(src|href)=['"]([^'"]+)['"]/g, (full, attr, ref) => {
      const mapped = mapRefPath(ref, baseDir);
      if (!mapped) return full;
      return `${attr}="${mapped}"`;
    });

    // Best-effort rewrite of absolute-looking paths "/New%20UI/Close.png" -> "New_UI_Close.png"
    // IMPORTANT: Keep it relative (no leading "/") for Stake's nested route hosting.
    content = content.replace(/\/([A-Za-z0-9._%/-]+\.[A-Za-z0-9]+)([?#][^\s"'<>]*)?/g, (full, p, suffix) => {
      const key = safeDecode(normalizePosixPath(p));
      const mapped = flatMap[key];
      if (!mapped) return full;
      return mapped + (suffix || '');
    });

    return content;
  };

  function getUniqueFlatName(fullPath: string, baseName: string): string {
    const sanitizedBase = sanitizeStakeFileName(baseName);

    if (!usedNames.has(sanitizedBase)) {
      usedNames.set(sanitizedBase, 1);
      return sanitizedBase;
    }

    // Collision: prefix with folder path (Option B) and, if still colliding, add numeric suffix (Option B from Q2)
    const localPath = fullPath.substring(projectPath.length + 1);
    const lastSlash = localPath.lastIndexOf('/');
    const dir = lastSlash >= 0 ? localPath.substring(0, lastSlash) : '';

    const dotIndex = sanitizedBase.lastIndexOf('.');
    const base = dotIndex >= 0 ? sanitizedBase.substring(0, dotIndex) : sanitizedBase;
    const ext = dotIndex >= 0 ? sanitizedBase.substring(dotIndex) : '';

    const dirPrefix = dir ? dir.replace(/[\\/]/g, '_') + '_' : '';
    let candidate = sanitizeStakeFileName(dirPrefix + base + ext);

    if (!usedNames.has(candidate)) {
      usedNames.set(candidate, 1);
      return candidate;
    }

    let counter = usedNames.get(candidate) || 1;
    let withSuffix = candidate;
    while (usedNames.has(withSuffix)) {
      counter += 1;
      withSuffix = `${base}_${counter}${ext}`;
    }
    usedNames.set(withSuffix, counter);

    return withSuffix;
  }

  // First pass: compute mapping for every file so we can rewrite internal references while copying.
  for (const f of files) {
    const localPath = normalizePosixPath(f.fullPath.substring(projectPath.length + 1).replace(/\\/g, '/'));
    const targetName = getUniqueFlatName(f.fullPath, f.name);
    const decoded = safeDecode(localPath);
    flatMap[localPath] = targetName;
    flatMap[decoded] = targetName;
    flatMap[localPath.toLowerCase()] = targetName;
    flatMap[decoded.toLowerCase()] = targetName;
  }

  async function copyFlatFile(f: FileInfo) {
    filesLeftToCopy++;

    const localPath = normalizePosixPath(f.fullPath.substring(projectPath.length + 1).replace(/\\/g, '/'));
    const targetName = flatMap[localPath] || getUniqueFlatName(f.fullPath, f.name);
    const targetPath = filesystem.join(direntry, targetName);

    try {
      if (isTextLike(f.name)) {
        let content = await filesystem.readFile(f.fullPath);
        content = rewriteTextContent(content, localPath);
        await filesystem.writeFileOverride(targetPath, content);
      } else {
        await filesystem.copyFile(f.fullPath, targetPath);
      }
      fileCompleted(true);
    } catch (error: any) {
      console.error(error);
      fileCompleted(false);
    }
  }

  const tasks = files.map(copyFlatFile);

  await Promise.all(tasks);

  if (!totalSuccess) {
    throw new Error('Failed to copy project files for Stake deploy.');
  }

  return flatMap;
}