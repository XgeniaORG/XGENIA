import { roleLabel } from './assetRoles';
import type { IndexedAsset } from './assetIndex';

export interface AssetQuery {
  /** Free text plus filter tokens — see parseSearch. */
  text: string;
  role: string | null;
  unusedOnly: boolean;
  favoritesOnly: boolean;
  /** Project-relative folder ('assets/ui'); the folder and everything below it. */
  folder: string | null;
}

export const EMPTY_QUERY: AssetQuery = {
  text: '',
  role: null,
  unusedOnly: false,
  favoritesOnly: false,
  folder: null
};

export type SortMode = 'name' | 'modified' | 'size' | 'role' | 'type';

export const SORT_LABELS: Record<SortMode, string> = {
  name: 'Name',
  modified: 'Last modified',
  size: 'File size',
  role: 'Role',
  type: 'Type'
};

// ─── search syntax ───────────────────────────────────────────────────────────
//
// Unity's project search (t:Texture l:hero) and Unreal's content-browser filters, in one box:
//   t: / type:     image | audio | video | font | document
//   r: / role:     a role slug or its label (keyart, "backgrounds", ui…)
//   l: / tag: / label:   an exact tag
//   is:            unused | used | starred | cut | placed | guessed | versioned | lost-placement
//   ext:           file extension
//   in: / folder:  a folder and everything below it
//   from:          the art a piece was cut from (name or path fragment)
// A leading `-` negates a filter. "Quoted phrases" stay whole. Anything else is free text, matched
// against the name, path, tags, role and the AI prompt.

export const SEARCH_KEYS = ['t', 'type', 'r', 'role', 'l', 'tag', 'label', 'is', 'ext', 'in', 'folder', 'from'] as const;
type SearchKey = (typeof SEARCH_KEYS)[number];

export interface SearchFilter {
  key: SearchKey;
  value: string;
  negate: boolean;
}

export interface ParsedSearch {
  filters: SearchFilter[];
  words: string[];
}

export function parseSearch(text: string): ParsedSearch {
  const filters: SearchFilter[] = [];
  const words: string[] = [];
  const tokens = String(text || '').match(/-?[a-z]+:"[^"]*"|"[^"]*"|\S+/gi) || [];
  for (const raw of tokens) {
    const m = /^(-?)([a-z]+):(.*)$/i.exec(raw);
    const key = m?.[2].toLowerCase();
    if (m && key && (SEARCH_KEYS as readonly string[]).includes(key)) {
      const value = m[3].replace(/^"|"$/g, '').trim().toLowerCase();
      if (value) filters.push({ key: key as SearchKey, value, negate: m[1] === '-' });
      continue;
    }
    const word = raw.replace(/^"|"$/g, '').trim().toLowerCase();
    if (word) words.push(word);
  }
  return { filters, words };
}

function inFolder(path: string, folder: string): boolean {
  const f = folder.replace(/\/+$/, '').toLowerCase();
  return path.toLowerCase().startsWith(f + '/');
}

function matchesFilter(a: IndexedAsset, f: SearchFilter): boolean {
  switch (f.key) {
    case 't':
    case 'type':
      return a.kind === f.value;
    case 'r':
    case 'role':
      return a.role.toLowerCase() === f.value || roleLabel(a.role).toLowerCase() === f.value;
    case 'l':
    case 'tag':
    case 'label':
      return (a.tags || []).some((t) => t.toLowerCase() === f.value);
    case 'ext':
      return a.extension === f.value.replace(/^\./, '');
    case 'in':
    case 'folder':
      return inFolder(a.path, f.value);
    case 'from': {
      const l = a.lineage;
      return !!l && [l.rootPath, l.sourcePath].some((p) => (p || '').toLowerCase().includes(f.value));
    }
    case 'is':
      switch (f.value) {
        case 'unused':
          return !a.used;
        case 'used':
          return a.used;
        case 'starred':
        case 'favorite':
          return a.favorite;
        case 'cut':
          return !!a.lineage;
        case 'placed':
          return !!a.placement;
        case 'guessed':
          return a.roleInferred;
        case 'versioned':
          return a.versions.length > 0;
        case 'lost-placement':
          return !!a.previousPlacement;
        default:
          return false;
      }
  }
}

/**
 * One place that decides what the grid shows.
 *
 * Free text matches the name, the path, the tags, the role and its label, AND the AI prompt.
 * Searching by what you asked for — "the art-deco fedora" — is the reason the prompt is stored.
 */
export function filterAssets(assets: IndexedAsset[], q: AssetQuery): IndexedAsset[] {
  const parsed = parseSearch(q.text);
  return assets.filter((a) => {
    if (q.role && a.role !== q.role) return false;
    if (q.unusedOnly && a.used) return false;
    if (q.favoritesOnly && !a.favorite) return false;
    if (q.folder && !inFolder(a.path, q.folder)) return false;
    for (const f of parsed.filters) {
      if (matchesFilter(a, f) === f.negate) return false;
    }
    if (parsed.words.length === 0) return true;
    const haystack = [
      a.name,
      a.path,
      a.role,
      roleLabel(a.role),
      ...(a.tags || []),
      a.ai?.prompt || '',
      a.ai?.model || '',
      a.lineage?.layerName || ''
    ]
      .join(' ')
      .toLowerCase();
    return parsed.words.every((w) => haystack.includes(w));
  });
}

const byName = (a: IndexedAsset, b: IndexedAsset) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path);

/** Descending on a number that may be unknown; unknowns always sink. */
const desc = (x?: number, y?: number) => (y ?? -Infinity) - (x ?? -Infinity);

/** Stable, never mutates. Name then path is the tiebreak in every mode. */
export function sortAssets(assets: IndexedAsset[], mode: SortMode = 'name'): IndexedAsset[] {
  const list = [...assets];
  switch (mode) {
    case 'modified':
      return list.sort((a, b) => desc(a.mtime, b.mtime) || byName(a, b));
    case 'size':
      return list.sort((a, b) => desc(a.size, b.size) || byName(a, b));
    case 'role':
      return list.sort((a, b) => roleLabel(a.role).localeCompare(roleLabel(b.role)) || byName(a, b));
    case 'type':
      return list.sort((a, b) => a.kind.localeCompare(b.kind) || a.extension.localeCompare(b.extension) || byName(a, b));
    default:
      return list.sort(byName);
  }
}
