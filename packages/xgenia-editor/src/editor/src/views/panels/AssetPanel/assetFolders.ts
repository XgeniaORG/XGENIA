// The folder tree under assets/, built from the scan's file list. Folders are not the primary way
// to find things (roles and search are), but they are where files live and where imports land.

export interface FolderNode {
  /** Project-relative, e.g. 'assets/ui/buttons'. */
  path: string;
  name: string;
  /** Files in this folder and every folder below it. */
  count: number;
  children: FolderNode[];
}

export function buildFolderTree(filePaths: string[], extraFolders: string[] = []): FolderNode {
  const root: FolderNode = { path: 'assets', name: 'assets', count: 0, children: [] };
  const byPath = new Map<string, FolderNode>([['assets', root]]);

  const ensure = (folder: string): FolderNode => {
    const existing = byPath.get(folder);
    if (existing) return existing;
    const parentPath = folder.split('/').slice(0, -1).join('/') || 'assets';
    const parent = ensure(parentPath);
    const node: FolderNode = { path: folder, name: folder.split('/').pop() || folder, count: 0, children: [] };
    parent.children.push(node);
    byPath.set(folder, node);
    return node;
  };

  for (const folder of extraFolders) {
    if (folder.startsWith('assets/')) ensure(folder.replace(/\/+$/, ''));
  }
  for (const file of filePaths) {
    if (!file.startsWith('assets/')) continue;
    const segments = file.split('/').slice(0, -1);
    ensure(segments.join('/'));
    // Count the file once in its folder and in every ancestor up to assets/.
    for (let i = segments.length; i >= 1; i--) byPath.get(segments.slice(0, i).join('/'))!.count++;
  }

  const sortRec = (n: FolderNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}
