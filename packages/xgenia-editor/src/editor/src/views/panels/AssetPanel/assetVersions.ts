// Reading version history out of `.trash`, and numbering new versions.
//
// Until this change, "a new version of an asset" was recorded by MOVING the old file into
// `<project>/.trash` with a timestamped name (save-image.ts, overwrite-backup.ts). That is a
// real history — it is just written in a place nothing ever read back. This module recovers
// it so an asset made before versioning existed still shows its past.
//
// `.trash` is READ-ONLY here. Never rename, move or delete anything in it: it is also the
// undo buffer for the AI's manage_asset delete, and re-using it would destroy that.

/** One historic file recovered from `.trash`. */
export interface TrashVersion {
  /** Filename inside `.trash`. */
  trashName: string;
  /** Project-relative path of the live asset this is a previous version of. */
  of: string;
  /** 1-based, oldest first. */
  n: number;
  /** ms epoch parsed from the filename. */
  timestamp: number;
}

// save_image writes `${folderSlug}_${name}.${isoTimestamp}${ext}` where folderSlug is the
// folder path with '/' replaced by '_'. overwrite-backup writes `${name}.${isoTimestamp}${ext}`
// with no slug at all. Both use `new Date().toISOString().replace(/[:.]/g, '-')`.
const TRASH_NAME = /^(.*)\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.([^.]+)$/;

/** Turn the ISO-with-dashes stamp back into ms epoch. Returns 0 if it will not parse. */
function parseStamp(stamp: string): number {
  // 2026-09-06T10-11-12-345Z → 2026-09-06T10:11:12.345Z
  const iso = stamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z'
  );
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export function parseTrashName(
  name: string
): { folderSlug: string; base: string; ext: string; timestamp: number } | null {
  const m = TRASH_NAME.exec(name);
  if (!m) return null;
  const [, head, stamp, ext] = m;
  const timestamp = parseStamp(stamp);
  if (!timestamp) return null;

  // The head is either `folderSlug_base` or a bare `base`. The slug always starts with the
  // scan root, so anything beginning 'assets' is a slug; everything else is a bare name.
  if (head === 'assets') return { folderSlug: 'assets', base: head, ext, timestamp };
  if (head.startsWith('assets_')) {
    const lastUnderscore = head.lastIndexOf('_');
    return {
      folderSlug: head.slice(0, lastUnderscore),
      base: head.slice(lastUnderscore + 1),
      ext,
      timestamp
    };
  }
  return { folderSlug: '', base: head, ext, timestamp };
}

/**
 * Group `.trash` backups under the live assets they are previous versions of.
 *
 * A backup is attributed ONLY when the match is unambiguous. A slugless backup whose
 * basename matches two live assets is dropped rather than guessed at: showing a version
 * under the wrong asset would invite the user to "make live" art that never belonged to it.
 */
export function deriveTrashVersions(
  trashNames: string[],
  livePaths: string[]
): Map<string, TrashVersion[]> {
  const byExactPath = new Set(livePaths);
  const byBasename = new Map<string, string[]>();
  for (const p of livePaths) {
    const base = (p.split('/').pop() || '').replace(/\.[^.]+$/, '');
    const list = byBasename.get(base) || [];
    list.push(p);
    byBasename.set(base, list);
  }

  const grouped = new Map<string, TrashVersion[]>();
  for (const name of trashNames) {
    const parsed = parseTrashName(name);
    if (!parsed) continue;

    let of: string | null = null;
    if (parsed.folderSlug && parsed.folderSlug !== 'assets') {
      const candidate = `${parsed.folderSlug.replace(/_/g, '/')}/${parsed.base}.${parsed.ext}`;
      if (byExactPath.has(candidate)) of = candidate;
    } else if (parsed.folderSlug === 'assets') {
      const candidate = `assets/${parsed.base}.${parsed.ext}`;
      if (byExactPath.has(candidate)) of = candidate;
    } else {
      const matches = byBasename.get(parsed.base) || [];
      if (matches.length === 1) of = matches[0];
    }
    if (!of) continue;

    const list = grouped.get(of) || [];
    list.push({ trashName: name, of, n: 0, timestamp: parsed.timestamp });
    grouped.set(of, list);
  }

  for (const [, list] of grouped) {
    list.sort((a, b) => a.timestamp - b.timestamp);
    list.forEach((v, i) => {
      v.n = i + 1;
    });
  }
  return grouped;
}

const VERSION_SIBLING = /^(.*)\.v(\d+)(\.[^.]+)$/;

/**
 * The path for the next archived version of `livePath`.
 *
 * Numbering continues from the HIGHEST existing version, never from the count: after a
 * v1/v2/v3 chain where v2 was deleted, counting would return v3 and overwrite real history.
 *
 * Mirrored on the AI side as `nextVersionPath` in
 * private/xgenia-ai/.../utils/asset-roles.ts, because the editor is GPL and must not import
 * that package. Change one, change both.
 */
export function nextVersionPath(livePath: string, existing: string[]): string {
  const dot = livePath.lastIndexOf('.');
  const stem = dot > 0 ? livePath.slice(0, dot) : livePath;
  const ext = dot > 0 ? livePath.slice(dot) : '';

  let highest = 0;
  for (const path of existing) {
    const m = VERSION_SIBLING.exec(path);
    if (!m) continue;
    if (m[1] !== stem || m[3] !== ext) continue;
    const n = Number(m[2]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return `${stem}.v${highest + 1}${ext}`;
}

/** Split `assets/ui/bar.v2.png` into its live path and version number, or null. */
export function splitVersionSibling(path: string): { of: string; n: number } | null {
  const m = VERSION_SIBLING.exec(path);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n) || n < 1) return null;
  return { of: `${m[1]}${m[3]}`, n };
}
