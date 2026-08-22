import { useState, useEffect, useCallback } from 'react';
import { ProjectModel } from '../../../models/projectmodel';
import { Asset } from './types';
import { shapeAssetPaths } from './asset-classification';

/**
 * Loads the assets for the current folder.
 *
 * Data flow:
 *  - ProjectModel.listProjectAssets walks ONLY <projectDir>/assets (depth-capped,
 *    heavy/hidden dirs skipped) and always fires its callback.
 *  - Each FileInfo is reduced to a project-relative, forward-slash 'assets/...' path.
 *  - shapeAssetPaths (shared with the AI tool) classifies/de-dupes by extension.
 *  - We scope to `currentPath` and synthesize subfolder rows for navigation.
 *
 * `currentPath` is '/'-rooted RELATIVE to the assets folder: '/' is the assets
 * root, '/symbols' is assets/symbols, etc.
 */
export function useProjectAssets(currentPath: string) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAssets = useCallback(() => {
    const pm = ProjectModel.instance;
    const root = pm?._retainedProjectDirectory;

    // No project / no project directory → empty (never a permanent spinner).
    if (!pm || !root) {
      setAssets([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const rootNorm = String(root).replace(/\\/g, '/').replace(/\/+$/, '');
    // The folder prefix (in fullPath terms) that "currentPath" represents.
    const prefix = currentPath === '/' || currentPath === '' ? 'assets' : `assets${currentPath}`;

    try {
      pm.listProjectAssets((files: any[]) => {
        try {
          // 1) Split entries into files vs directories, each as a project-relative
          //    forward-slash 'assets/...' path.
          const fileRel: string[] = [];
          const dirRel: string[] = [];
          for (const f of files || []) {
            try {
              if (!f || !f.fullPath) continue;
              let rel = String(f.fullPath).replace(/\\/g, '/');
              if (rel.startsWith(rootNorm + '/')) rel = rel.slice(rootNorm.length + 1);
              if (!rel) continue;
              if (f.isDirectory) dirRel.push(rel);
              else fileRel.push(rel);
            } catch {
              // Skip a single malformed entry — never fatal.
            }
          }

          // 2) Shared classification/shaping for files (agrees with the AI tool).
          const entries = shapeAssetPaths(fileRel, 'all');

          // 3) Scope to currentPath; synthesize subfolder rows for navigation.
          const result: Asset[] = [];
          const folderSeen = new Set<string>();

          const addFolder = (seg: string) => {
            if (!seg) return;
            const folderPath = currentPath === '/' || currentPath === '' ? `/${seg}` : `${currentPath}/${seg}`;
            if (!folderSeen.has(folderPath)) {
              folderSeen.add(folderPath);
              result.push({ name: seg, path: folderPath, type: 'folder' });
            }
          };

          // Files directly in this folder + subfolders implied by nested files.
          for (const e of entries) {
            try {
              if (e.folder === prefix) {
                result.push({
                  name: e.name,
                  path: e.fullPath,
                  type: e.type,
                  extension: e.extension,
                  uuid: undefined
                });
              } else if (e.folder.startsWith(prefix + '/')) {
                addFolder(e.folder.slice(prefix.length + 1).split('/')[0]);
              }
            } catch {
              // Skip a single bad entry — never fatal.
            }
          }

          // Explicit directory entries (covers EMPTY folders and folders whose last
          // file was just deleted): a dir shows when its parent === the current folder.
          for (const d of dirRel) {
            const parent = d.split('/').slice(0, -1).join('/') || 'assets';
            if (parent === prefix) {
              addFolder(d.split('/').pop() || '');
            }
          }

          setAssets(result);
          setError(null);
        } catch (err: any) {
          // Reachable only on a genuine list-build fault now (FileReader removed).
          console.error('Error processing assets:', err);
          setError('Failed to process project assets');
        } finally {
          setIsLoading(false);
        }
      });
    } catch (err: any) {
      console.error('Error loading assets:', err);
      setError('Failed to load project assets');
      setIsLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // NOTE: there is no project file-change event to subscribe to (fileAdded/
  // fileRemoved/fileRenamed are emitted by nothing), so callers invoke refetch()
  // directly after any filesystem mutation.
  return { assets, isLoading, error, refetch: loadAssets };
}
