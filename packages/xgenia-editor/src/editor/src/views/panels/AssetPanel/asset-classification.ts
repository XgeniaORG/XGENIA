// Asset classification — EDITOR-OWNED MIRROR of the backend's hermetic helper at
// private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/utils/asset-listing.ts.
//
// Kept dependency-free and semantically identical so the Asset panel agrees with
// the AI's list_project_assets tool on what counts as an asset, how it is typed,
// and how paths are shaped. The editor (GPL) must not import the proprietary
// submodule, so this is a duplicate guarded by a regression-lock test:
//   private/xgenia-ai/src/__tests__/regression-lock/asset-classification-mirror.test.ts
// If you change one table, change BOTH — the lock test fails on drift.

const ASSET_EXT: Record<string, string[]> = {
  image: ['png', 'jpeg', 'jpg', 'svg', 'gif', 'webp'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac'],
  font: ['otf', 'ttf', 'woff', 'woff2'],
  video: ['mp4', 'webm', 'mov'],
  document: ['pdf', 'doc', 'docx', 'txt'],
};

export type AssetKind = 'image' | 'audio' | 'font' | 'video' | 'document' | 'unknown';

/** Classify by extension. Order matches the backend (image → audio → font → video →
 *  document) so 'ogg' resolves to audio, not video. */
export function classifyAssetType(ext: string): AssetKind {
  const e = (ext || '').toLowerCase();
  if (ASSET_EXT.image.includes(e)) return 'image';
  if (ASSET_EXT.audio.includes(e)) return 'audio';
  if (ASSET_EXT.font.includes(e)) return 'font';
  if (ASSET_EXT.video.includes(e)) return 'video';
  if (ASSET_EXT.document.includes(e)) return 'document';
  return 'unknown';
}

/** The extensions a `type` filter accepts. 'all'/empty → every known asset extension. */
export function extensionsForType(type?: string): string[] {
  if (!type || type === 'all') {
    return [...ASSET_EXT.image, ...ASSET_EXT.audio, ...ASSET_EXT.font, ...ASSET_EXT.video, ...ASSET_EXT.document];
  }
  const byPlural: Record<string, string[]> = {
    images: ASSET_EXT.image, audio: ASSET_EXT.audio, fonts: ASSET_EXT.font,
    videos: ASSET_EXT.video, documents: ASSET_EXT.document,
  };
  return byPlural[type] || [];
}

export interface AssetEntry {
  name: string;
  fullPath: string;
  folder: string;
  type: AssetKind;
  extension: string;
}

/** Shape a flat list of asset paths into entries, filtered by `type` and (optional) `search`,
 *  de-duped by path, dropping anything whose extension isn't an asset of the requested type. */
export function shapeAssetPaths(paths: string[], type: string = 'all', search?: string): AssetEntry[] {
  const wantExt = new Set(extensionsForType(type));
  const seen = new Set<string>();
  let out: AssetEntry[] = [];
  for (const raw of paths) {
    const p = (raw || '').replace(/^\.?\//, '').trim();
    if (!p || seen.has(p)) continue;
    const name = p.split('/').pop() || p;
    const ext = (name.includes('.') ? name.split('.').pop() : '')!.toLowerCase();
    if (!ext || (wantExt.size > 0 && !wantExt.has(ext))) continue;
    seen.add(p);
    out.push({
      name,
      fullPath: p,
      folder: p.split('/').slice(0, -1).join('/') || '/',
      type: classifyAssetType(ext),
      extension: ext,
    });
  }
  if (search && search.trim()) {
    const s = search.toLowerCase();
    out = out.filter((a) =>
      a.name.toLowerCase().includes(s) ||
      a.fullPath.toLowerCase().includes(s) ||
      a.folder.toLowerCase().includes(s));
  }
  return out;
}
