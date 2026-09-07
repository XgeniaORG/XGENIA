/**
 * save-dialog-filters.ts — which file types the native Save panel offers.
 *
 * (2026-08-29) A Photoshop export came back unopenable. The document itself was fine — the
 * writer was verified byte-for-byte against two independent readers — but `saveFile()` chose
 * its dialog filters from the MIME prefix, and `image/vnd.adobe.photoshop` is neither video nor
 * audio, so it fell through to `Images: png, jpg, jpeg, svg`. Windows appends the selected
 * filter's extension when the typed name's extension is not in that filter's list
 * (electron/electron#9455), so `art.psd` landed on disk as `art.psd.png`: a perfectly good PSD
 * with a name no viewer will open.
 *
 * The rule here is the general one, not a psd special-case: the file's OWN extension is always
 * the first filter offered, so the panel has nothing to "correct" the name to. Known families
 * keep their friendly group names; anything else gets a filter of its own.
 *
 * Pure and Electron-free on purpose, so it can be tested without a renderer.
 */

export interface SaveDialogFilter {
  name: string;
  extensions: string[];
}

const ALL_FILES: SaveDialogFilter = { name: 'All Files', extensions: ['*'] };

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v', 'ogg'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'];

/** Extensions that carry a name of their own rather than a family name. */
const NAMED: Record<string, string> = {
  psd: 'Photoshop Document',
  svg: 'SVG Image',
  json: 'JSON',
  zip: 'ZIP Archive',
  pdf: 'PDF Document'
};

export function extensionOf(filename: string): string {
  const base = String(filename || '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function saveDialogFilters(filename: string, mimeType: string): SaveDialogFilter[] {
  const ext = extensionOf(filename);
  const mime = String(mimeType || '').toLowerCase();

  if (ext === 'psd' || mime === 'image/vnd.adobe.photoshop') {
    return [{ name: NAMED.psd, extensions: ['psd'] }, ALL_FILES];
  }

  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext)) {
    return [withOwnExtensionFirst({ name: 'Videos', extensions: VIDEO_EXTENSIONS }, ext), ALL_FILES];
  }

  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext)) {
    return [withOwnExtensionFirst({ name: 'Audio', extensions: AUDIO_EXTENSIONS }, ext), ALL_FILES];
  }

  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext) || !ext) {
    return [withOwnExtensionFirst({ name: 'Images', extensions: IMAGE_EXTENSIONS }, ext), ALL_FILES];
  }

  // Something this editor has never saved before. Offer exactly what was asked for.
  return [{ name: NAMED[ext] || `${ext.toUpperCase()} File`, extensions: [ext] }, ALL_FILES];
}

/**
 * The extension being saved must be in the group's list, and first in it — on Windows the
 * first extension of the selected filter is the one the panel will append.
 */
function withOwnExtensionFirst(group: SaveDialogFilter, ext: string): SaveDialogFilter {
  if (!ext) return group;
  const rest = group.extensions.filter((e) => e !== ext);
  return { name: group.name, extensions: [ext, ...rest] };
}
