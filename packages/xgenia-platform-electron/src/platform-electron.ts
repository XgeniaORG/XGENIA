import fs from 'fs';
import path from 'path';
import { app as remoteApp } from '@electron/remote';
import { app as electronApp, shell, clipboard } from 'electron';
import { addTrailingSlash, IPlatform, PlatformOS, SaveFileResult } from '@xgenia/platform';
import { processPlatformToPlatformOS } from '@xgenia/platform-node/src/helper';
import { saveDialogFilters } from './save-dialog-filters';

export class PlatformElectron implements IPlatform {
  get name(): string {
    return 'Electron';
  }

  get os(): PlatformOS {
    return this._os;
  }

  private _os: PlatformOS;
  private _userDataPath: string;
  private _documentsPath: string;
  private _tempPath: string;
  private _appPath: string;
  private _buildNumber: string;
  private _version: string;
  private _versionTag: string;
  private _versionId: string;

  constructor() {
    const app = electronApp || remoteApp;
    this._userDataPath = app.getPath('userData');
    this._documentsPath = app.getPath('documents');
    this._tempPath = addTrailingSlash(app.getPath('temp'));
    this._appPath = addTrailingSlash(app.getAppPath());

    const packagePath = path.join(this._appPath, 'package.json');
    if (!fs.existsSync(packagePath)) {
      throw 'Cannot find package.json, to get the build version.';
    }

    const packageJson = fs.readFileSync(packagePath, 'utf8');
    const packageContent = JSON.parse(packageJson);
    this._buildNumber = packageContent.buildNumber || 1;
    this._version = app.getVersion();
    this._versionId = packageContent.fullVersion;
    this._versionTag = packageContent.versionTag;

    this._os = processPlatformToPlatformOS();
  }

  getBuildNumber(): string | undefined {
    return this._buildNumber;
  }
  getFullVersion(): string {
    return this._versionId;
  }
  getVersion(): string {
    return this._version;
  }
  getVersionWithTag(): string {
    return this._versionTag ? `${this._version}-${this._versionTag}` : this._version;
  }

  getUserDataPath(): string {
    return this._userDataPath;
  }
  getDocumentsPath(): string {
    return this._documentsPath;
  }
  getTempPath(): string {
    return this._tempPath;
  }
  getAppPath(): string {
    return this._appPath;
  }

  openExternal(url: string): Promise<void> {
    const result = shell.openExternal(url);
    if (result && typeof (result as unknown as Promise<any>).then === 'function') {
      // It's a Promise
      return (result as unknown as Promise<any>).then(() => {});
    } else {
      // It's a boolean (sync)
      return Promise.resolve();
    }
  }

  async copyToClipboard(value: string): Promise<void> {
    clipboard.writeText(value);
    return Promise.resolve();
  }

  /**
   * (2026-08-29) Two things changed here, both because a Photoshop export "could not be opened":
   *
   *   - The dialog's file-type filters now come from `saveDialogFilters`, which always offers
   *     the file's own extension first. The old MIME-prefix ladder sent `image/vnd.adobe.photoshop`
   *     to the Images filter, and Windows renames the file to that filter's extension
   *     (electron/electron#9455) — `art.psd` became `art.psd.png`.
   *   - It reports what happened. A cancelled panel and a written file both used to resolve to
   *     `undefined`, so the plugin that asked could only guess — and it guessed "saved".
   */
  async saveFile(filename: string, data: string, mimeType: string): Promise<SaveFileResult> {
    const { dialog } = require('@electron/remote');
    const fs = require('fs');

    const result = await dialog.showSaveDialog({
      defaultPath: filename,
      filters: saveDialogFilters(filename, mimeType)
    });

    if (result.canceled || !result.filePath) {
      return { saved: false, cancelled: true };
    }

    let buffer: Buffer;
    if (data.includes(';base64,')) {
      const base64 = data.split(';base64,').pop()!;
      buffer = Buffer.from(base64, 'base64');
    } else {
      buffer = Buffer.from(data, 'utf-8');
    }
    fs.writeFileSync(result.filePath, buffer);
    return { saved: true, path: result.filePath };
  }
}
