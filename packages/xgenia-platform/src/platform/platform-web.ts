import { IPlatform } from '@xgenia/platform';

import { PlatformOS } from './common';

export class PlatformWeb implements IPlatform {
  get name(): string {
    return 'Web';
  }

  get os(): PlatformOS {
    return PlatformOS.Web;
  }

  constructor(
    private readonly _version: string,
    private readonly _versionTag: string,
    private readonly _buildNumber: string
  ) {}

  getBuildNumber(): string | undefined {
    return this._buildNumber;
  }
  getFullVersion(): string {
    return this._version + '-' + this._buildNumber;
  }
  getVersion(): string {
    return this._version;
  }
  getVersionWithTag(): string {
    return this._versionTag ? `${this._version}-${this._versionTag}` : this._version;
  }

  getUserDataPath(): string {
    return '/user';
  }
  getDocumentsPath(): string {
    return '/documents';
  }
  getTempPath(): string {
    return '/tmp';
  }
  getAppPath(): string {
    return '/app';
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank').focus();
  }

  async copyToClipboard(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
  }

  async saveFile(filename: string, data: string, mimeType: string): Promise<void> {
    const a = document.createElement('a');
    // If it's base64, we need to handle it accordingly
    if (data.startsWith('data:')) {
      a.href = data;
    } else {
      const blob = new Blob([data], { type: mimeType });
      a.href = URL.createObjectURL(blob);
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (!data.startsWith('data:')) {
      URL.revokeObjectURL(a.href);
    }
  }
}
