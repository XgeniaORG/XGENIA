import { roleLabel } from './assetRoles';
import type { IndexedAsset } from './assetIndex';

export interface AssetQuery {
  text: string;
  role: string | null;
  unusedOnly: boolean;
  favoritesOnly: boolean;
}

export const EMPTY_QUERY: AssetQuery = { text: '', role: null, unusedOnly: false, favoritesOnly: false };

/**
 * One place that decides what the grid shows.
 *
 * Text matches the name, the path, the tags, the role and its label, AND the AI prompt.
 * Searching by what you asked for — "the art-deco fedora" — is the reason the prompt is
 * stored at all, and the old panel could not do it: the prompt was written to
 * .xgenia-assets.json for months and read by nothing.
 */
export function filterAssets(assets: IndexedAsset[], q: AssetQuery): IndexedAsset[] {
  const text = q.text.trim().toLowerCase();
  return assets.filter((a) => {
    if (q.role && a.role !== q.role) return false;
    if (q.unusedOnly && a.used) return false;
    if (q.favoritesOnly && !a.favorite) return false;
    if (!text) return true;
    const haystack = [
      a.name,
      a.path,
      a.role,
      roleLabel(a.role),
      ...(a.tags || []),
      a.ai?.prompt || '',
      a.ai?.model || ''
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(text);
  });
}

/** Name, then path, so two files called the same thing keep a stable order. */
export function sortAssets(assets: IndexedAsset[]): IndexedAsset[] {
  return [...assets].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
