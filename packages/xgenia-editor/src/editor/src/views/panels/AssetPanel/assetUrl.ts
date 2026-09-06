// Where an asset's bytes can actually be fetched from in the editor.
//
// The old panel had `getAssetThumbnail`, which returned the path only when it already began
// http/blob/data — i.e. never, for a project file on disk — and `undefined` otherwise. That
// is why the grid showed icons instead of art: the thumbnail was not missing, it was never
// asked for.
//
// The editor already runs a project web server (src/main/src/web-server.js) on XGENIAPORT,
// default 8574, serving the project directory. `assets/keyart/key-art.png` is fetchable at
// `http://localhost:8574/assets/keyart/key-art.png` today. Use it, and never inline image
// bytes as base64 into React state — that is what made autosave and the thumbnail store
// blow up (see the disk-backed-media work).

const DEFAULT_PORT = 8574;

function projectPort(): number | string {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.XGENIAPORT) {
      return process.env.XGENIAPORT;
    }
  } catch {
    /* no process in some contexts */
  }
  return DEFAULT_PORT;
}

/** Origin of the editor's project web server. */
export function projectOrigin(): string {
  return `http://localhost:${projectPort()}`;
}

/**
 * URL for a project-relative asset path.
 *
 * `version` is appended as a cache-buster so that replacing an asset in place — which is
 * exactly what a versioned save does, keeping the path stable — actually shows the new art
 * instead of the browser's cached copy. Pass the index's run timestamp, not a random number,
 * so the URL is stable between renders and the image is not refetched on every keystroke.
 */
export function assetUrl(relPath: string, version?: number): string {
  const clean = String(relPath || '').replace(/^\/+/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  const suffix = version ? `?v=${version}` : '';
  return `${projectOrigin()}/${encoded}${suffix}`;
}

/** Whether this asset kind has art worth showing in a thumbnail. */
export function isPreviewable(kind: string): boolean {
  return kind === 'image';
}
