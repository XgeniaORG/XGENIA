import { useState, useEffect, useCallback } from 'react';

import { ProjectModel } from '../../../models/projectmodel';

export interface FolderNode {
  name: string;
  path: string; // nav-path: '/', '/sub', '/sub/child' (relative to the assets root)
  children: FolderNode[];
}

/**
 * Builds the FULL folder hierarchy of the project's assets/ tree (recursively), for the
 * two-pane folder tree. Unlike useProjectAssets (which scopes to one folder level), this
 * walks everything once and nests the directories. Returns a stable refetch().
 */
export function useProjectFolderTree() {
  const [tree, setTree] = useState<FolderNode>({ name: 'Assets', path: '/', children: [] });

  const load = useCallback(() => {
    const pm = ProjectModel.instance;
    const root = pm?._retainedProjectDirectory;
    if (!pm || !root) {
      setTree({ name: 'Assets', path: '/', children: [] });
      return;
    }
    const rootNorm = String(root).replace(/\\/g, '/').replace(/\/+$/, '');

    pm.listProjectAssets((files: any[]) => {
      // Collect every folder nav-path ('/sub', '/sub/child') from dir entries AND the
      // parent folders of every file.
      const folderPaths = new Set<string>();
      for (const f of files || []) {
        try {
          if (!f || !f.fullPath) continue;
          let rel = String(f.fullPath).replace(/\\/g, '/');
          if (rel.startsWith(rootNorm + '/')) rel = rel.slice(rootNorm.length + 1);
          const inner = rel.replace(/^assets\/?/, '');
          if (!inner) continue;
          const parts = inner.split('/').filter(Boolean);
          if (!f.isDirectory) parts.pop(); // a file → keep only its parent folders
          let acc = '';
          for (const p of parts) {
            acc += '/' + p;
            folderPaths.add(acc);
          }
        } catch {
          /* skip malformed entry */
        }
      }

      // Nest the flat folder paths into a tree.
      const rootNode: FolderNode = { name: 'Assets', path: '/', children: [] };
      const map: Record<string, FolderNode> = { '/': rootNode };
      for (const p of Array.from(folderPaths).sort()) {
        const parts = p.split('/').filter(Boolean);
        let parentPath = '/';
        let curPath = '';
        for (const seg of parts) {
          curPath += '/' + seg;
          if (!map[curPath]) {
            const node: FolderNode = { name: seg, path: curPath, children: [] };
            map[curPath] = node;
            (map[parentPath] || rootNode).children.push(node);
          }
          parentPath = curPath;
        }
      }

      const sortRec = (n: FolderNode) => {
        n.children.sort((a, b) => a.name.localeCompare(b.name));
        n.children.forEach(sortRec);
      };
      sortRec(rootNode);

      setTree(rootNode);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { tree, refetch: load };
}
