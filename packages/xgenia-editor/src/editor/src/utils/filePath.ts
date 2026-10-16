/**
 * The absolute path on disk of a File the user dropped or picked, or '' when it has none
 * (pasted, synthesized, or dragged from a browser).
 *
 * Electron 32 removed the non-standard `File.path`; `webUtils.getPathForFile` replaces it.
 * Required lazily so the modules that use this still load outside Electron (unit tests).
 */
export function getPathForFile(file: File): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('electron').webUtils.getPathForFile(file) || '';
  } catch {
    return '';
  }
}
