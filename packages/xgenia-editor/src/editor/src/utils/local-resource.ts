/**
 * local-resource.ts — what a resource IS decides how it is loaded.
 *
 * ─── why this exists (2026-08-23) ───────────────────────────────────────────
 * `FileSystem.downloadAsDataURI` only ever did `XMLHttpRequest.open('GET', url)`. Three of its
 * four callers pass an absolute filesystem path rather than a URL:
 *
 *   thumbnailcache.js:43   fileEntry.fullPath   (asset and image-picker thumbnails)
 *   fontpicker.js:210      fileEntry.fullPath   (font previews)
 *   fontloader.js:17       fullPath             (loading a project's fonts at all)
 *
 * An XHR resolves such a path against the page's origin, so
 * `/Users/x/project/assets/ui/spin-button.png` was requested from
 * `http://localhost:8080/Users/x/project/assets/ui/spin-button.png` and 404'd — every asset and
 * every font, on every launch, since the initial commit. The picker then bound the failed result
 * as an `<img src>`, which requested the literal string "undefined".
 *
 * EditorBridge had already worked around it in ONE place ("Directly read and return as Base64 to
 * bypass ThumbnailCache's broken XHR"), which fixed what the AI could see and left the three
 * editor-side callers exactly as broken. This puts the decision at the shared chokepoint instead,
 * so it reaches all of them at once.
 *
 * Split out of filesystem.js so the classification can be tested — that file is CommonJS and
 * pulls in electron's remote, mkdirp, jszip and fs-extra at import time.
 */

/**
 * Whether this target should be fetched over the network rather than read from disk.
 *
 * Errs toward the network: anything not recognisably a local absolute path keeps the old
 * behaviour, so a caller that legitimately passes a relative URL is unaffected. A relative path
 * is *meant* to resolve against the page, and rerouting one to disk would be a new bug.
 */
export function isRemoteResource(target: string | undefined | null): boolean {
    if (!target || typeof target !== 'string') return true;

    const value = target.trim();

    // Already inlined, or genuinely remote.
    if (/^(https?|blob|data):/i.test(value)) return true;

    // A file URL names a local file; it is only wearing a scheme.
    if (/^file:\/\//i.test(value)) return false;

    // Absolute posix path, or a Windows drive path in either slash direction.
    if (value.startsWith('/')) return false;
    if (/^[a-zA-Z]:[\\/]/.test(value)) return false;

    return true;
}

/** Strip a `file://` scheme so the result is a path the filesystem understands. */
export function toLocalPath(target: string): string {
    const value = String(target || '').trim();
    if (!/^file:\/\//i.test(value)) return value;

    try {
        return decodeURIComponent(value.replace(/^file:\/\//i, ''));
    } catch {
        return value.replace(/^file:\/\//i, '');
    }
}

/**
 * The MIME type for a path's extension.
 *
 * Fonts are listed explicitly: this is the path a project's fonts are loaded through, and a font
 * handed over as `application/octet-stream` is refused by some pipelines. Guessing `image/<ext>`
 * from the extension — as the EditorBridge workaround does — produces `image/woff2` for a font
 * and `image/jpg` for a jpeg, neither of which is a real type.
 */
export function mimeForPath(path: string): string {
    const ext = (String(path || '').split(/[?#]/)[0].match(/\.([a-zA-Z0-9]+)$/)?.[1] || '').toLowerCase();

    switch (ext) {
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        case 'bmp': return 'image/bmp';
        case 'svg': return 'image/svg+xml';
        case 'ico': return 'image/x-icon';
        case 'avif': return 'image/avif';

        case 'woff2': return 'font/woff2';
        case 'woff': return 'font/woff';
        case 'ttf': return 'font/ttf';
        case 'otf': return 'font/otf';
        case 'eot': return 'application/vnd.ms-fontobject';

        case 'mp3': return 'audio/mpeg';
        case 'wav': return 'audio/wav';
        case 'ogg': return 'audio/ogg';
        case 'm4a': return 'audio/mp4';
        case 'mp4': return 'video/mp4';
        case 'webm': return 'video/webm';

        case 'json': return 'application/json';
        case 'txt': return 'text/plain';

        default: return 'application/octet-stream';
    }
}
