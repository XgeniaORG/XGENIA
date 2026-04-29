export enum PlatformOS {
  Web = "web",
  Windows = "windows",
  MacOS = "macOS",
  Linux = "linux",
  Unknown = "unknown"
}

export interface IPlatform {
  get name(): string;

  get os(): PlatformOS;

  /**
   * @example '1'
   */
  getBuildNumber(): string | undefined;

  /**
   * @example '2.6.3-1'
   */
  getFullVersion(): string;

  /**
   * @example '2.6.3'
   */
  getVersion(): string;

  /**
   * @example '2.6.3' or '2.6.3-AI'
   */
  getVersionWithTag(): string;

  /**
   * @example Windows:  'C:/Users/Eric/AppData/Roaming/XGENIA'
   * @example OSX:      '/Users/eric/Library/Preferences/XGENIA'
   */
  getUserDataPath(): string;

  /**
   * @example Windows:  'C:/Users/Eric/OneDrive/Dokument'
   */
  getDocumentsPath(): string;

  /**
   * @example Windows:  'C:/Users/Eric/AppData/Local/Temp/'
   * @example OSX:      '/var/folders/8w/29mdvxz11f13l68p4xg_m_vc0000gn/T/'
   */
  getTempPath(): string;

  /**
   * @example Windows:  'C:/GitHub/xgenia-editor/'
   * @example OSX:      '/Users/eric/Documents/GitHub/xgenia-editor/'
   */
  getAppPath(): string;

  /**
   * Open the given external protocol URL in the desktop's default manner.
   * (For example, mailto: URLs in the user's default mail agent).
   * 
   * @param url 
   */
  openExternal(url: string): Promise<void>;

  /**
   * Write the specified text string to the system clipboard.
   *
   * @param value 
   */
  copyToClipboard(value: string): Promise<void>;

  /**
   * Request to save a file to the native filesystem (Electron-only).
   * 
   * @param filename Suggested filename
   * @param data Base64 data or string content
   * @param mimeType MIME type of the file
   */
  saveFile(filename: string, data: string, mimeType: string): Promise<void>;
}

// OSX and Windows add trailing slashes to the temp folder, Linux doesn't
export function addTrailingSlash(path: string): string {
  return path[path.length - 1] !== "/" ? path + "/" : path;
}
